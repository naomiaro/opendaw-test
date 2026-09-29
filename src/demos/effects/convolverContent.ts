import { Terminable, UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import {
  AudioFileBox,
  AudioRegionBox,
  ConvolverDeviceBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import {
  AudioBusFactory,
  ConvolverDeviceBoxAdapter,
  InstrumentFactories,
} from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";
import type { AudioBusBox, AudioUnitBox } from "@opendaw/studio-boxes";
import { loadAudioFile } from "@/lib/audioUtils";
import { audioEffectsFieldOf } from "@/lib/adapterUtils";
import { IMPULSE_RESPONSES, channelsToAudioBuffer, renderOneShot } from "@/lib/impulseResponses";
import { referSampleFile, watchSampleLoad } from "@/lib/sampleFiles";

// BassDrums30.mp3 measured at ~122 BPM (audio-analyzer rhythm_analysis, two
// windows: median 122.3, mean 121.5–122.0, stability 0.97+) — keeps the clave
// grid in step with the loop's groove.
export const DEMO_BPM = 122;
const DRUM_FILE = "/audio/BassDrums30.mp3";
const ONE_SHOT_BARS = 2;

/** The IR currently loaded in the convolver, as shown in the UI */
export interface CurrentIR {
  /** Gallery spec id, or null for a user-dropped file */
  readonly specId: string | null;
  readonly name: string;
  readonly seconds: number;
  /** Envelope source for the drop-zone preview */
  readonly channel: Float32Array;
}

/** Reports asynchronous IR sample-load failures (the pointer swap itself is synchronous) */
export type IRLoadErrorHandler = (message: string) => void;

export interface ConvolverDemoSetup {
  readonly convolverBox: ConvolverDeviceBox;
  readonly adapter: ConvolverDeviceBoxAdapter;
  readonly drumUnitBox: AudioUnitBox;
  readonly oneShotUnitBox: AudioUnitBox;
  /** Rendered gallery IR channel data (by spec id) for the card envelopes */
  readonly galleryChannels: ReadonlyMap<string, Float32Array>;
  readonly selectGalleryIR: (specId: string, onLoadError?: IRLoadErrorHandler) => CurrentIR;
  readonly setCustomIR: (name: string, buffer: AudioBuffer, onLoadError?: IRLoadErrorHandler) => CurrentIR;
  /** Returns null so all three mutators hand back the new CurrentIR state */
  readonly removeIR: () => null;
}

// Stable per-page-load UUIDs, so re-selecting a gallery IR resolves to the same
// stored sample instead of storing another copy under a fresh identity. (Its
// loader does not survive: deleting a file box ends the loader, and selecting
// the IR again builds a new one.)
const galleryUUIDs = new Map<string, UUID.Bytes>();
const galleryUUID = (specId: string): UUID.Bytes => {
  let uuid = galleryUUIDs.get(specId);
  if (uuid === undefined) {
    uuid = UUID.generate();
    galleryUUIDs.set(specId, uuid);
  }
  return uuid;
};

/**
 * Build the Convolver demo project content.
 *
 * Signal flow: Drums track + One-shot track -> "Space" bus (Convolver insert) -> Master.
 * A single bus-mounted device instance means one set of controls for both sources.
 */
export async function buildConvolverDemoContent(
  project: Project,
  audioContext: AudioContext,
  audioBuffers: Map<string, AudioBuffer>,
  onStatus?: (status: string) => void
): Promise<ConvolverDemoSetup> {
  const { boxGraph, skeleton } = project;
  const sampleRate = audioContext.sampleRate;

  onStatus?.("Loading drum loop...");
  const drumBuffer = await loadAudioFile(audioContext, DRUM_FILE);
  const drumUUID = UUID.generate();
  audioBuffers.set(UUID.toString(drumUUID), drumBuffer);

  const oneShotChannels = renderOneShot(sampleRate);
  const oneShotBuffer = channelsToAudioBuffer(oneShotChannels, sampleRate);
  const oneShotUUID = UUID.generate();
  audioBuffers.set(UUID.toString(oneShotUUID), oneShotBuffer);

  onStatus?.("Rendering impulse responses...");
  const galleryChannels = new Map<string, Float32Array>();
  const galleryBuffers = new Map<string, AudioBuffer>();
  for (const spec of IMPULSE_RESPONSES) {
    const channels = spec.render(sampleRate);
    galleryChannels.set(spec.id, channels[0]);
    galleryBuffers.set(spec.id, channelsToAudioBuffer(channels, sampleRate));
  }

  onStatus?.("Building project...");

  // Bus creation commits alone: resolving its AudioUnitBox needs the pointer
  // notifications the commit flushes.
  let busBox: AudioBusBox | null = null;
  project.editing.modify(() => {
    busBox = AudioBusFactory.create(skeleton, "Space", IconSymbol.AudioBus, AudioUnitType.Bus, Colors.purple);
  });
  const spaceBusBox: AudioBusBox = busBox!;
  const busUnitBox = spaceBusBox.output.targetVertex
    .unwrap("No AudioUnitBox for Space bus").box as AudioUnitBox;

  const loopDurationPPQN = Math.round(PPQN.secondsToPulses(drumBuffer.duration, DEMO_BPM));
  let drumUnitBox: AudioUnitBox | null = null;
  let oneShotUnitBox: AudioUnitBox | null = null;

  project.editing.modify(() => {
    // Drum loop track: the full file as one region. −6 dB headroom: the wet
    // path (default −3 dB) sums on top of the dry path — full-scale sources
    // clip the master (measured peak 1.11 at 0 dB).
    const drums = project.api.createInstrument(InstrumentFactories.Tape);
    drumUnitBox = drums.audioUnitBox;
    drums.audioUnitBox.volume.setValue(-6);
    const drumFileBox = AudioFileBox.create(boxGraph, drumUUID, box => {
      box.fileName.setValue("BassDrums30");
      box.endInSeconds.setValue(drumBuffer.duration);
    });
    const drumEvents = ValueEventCollectionBox.create(boxGraph, UUID.generate());
    AudioRegionBox.create(boxGraph, UUID.generate(), box => {
      box.regions.refer(drums.trackBox.regions);
      box.file.refer(drumFileBox);
      box.events.refer(drumEvents.owners);
      box.position.setValue(0);
      box.duration.setValue(loopDurationPPQN);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(loopDurationPPQN);
      box.label.setValue("Drums");
    });

    // One-shot track: a 0.3 s clave region-looped every ONE_SHOT_BARS bars —
    // the file plays once per cycle, the rest of the cycle is silence, so the
    // convolver tail stands alone between hits.
    const oneShot = project.api.createInstrument(InstrumentFactories.Tape);
    oneShotUnitBox = oneShot.audioUnitBox;
    oneShot.audioUnitBox.volume.setValue(-6);
    const oneShotFileBox = AudioFileBox.create(boxGraph, oneShotUUID, box => {
      box.fileName.setValue("Clave");
      box.endInSeconds.setValue(oneShotBuffer.duration);
    });
    const oneShotEvents = ValueEventCollectionBox.create(boxGraph, UUID.generate());
    AudioRegionBox.create(boxGraph, UUID.generate(), box => {
      box.regions.refer(oneShot.trackBox.regions);
      box.file.refer(oneShotFileBox);
      box.events.refer(oneShotEvents.owners);
      box.position.setValue(0);
      box.duration.setValue(loopDurationPPQN);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(ONE_SHOT_BARS * PPQN.Bar);
      box.label.setValue("Clave");
    });
  });

  // Re-routing happens after createInstrument's default master routing has
  // committed — same-transaction re-refer leaves dual routing.
  project.editing.modify(() => {
    drumUnitBox!.output.refer(spaceBusBox.input);
    oneShotUnitBox!.output.refer(spaceBusBox.input);
  });

  // Insert the Convolver on the bus channel. Chain field resolved through the
  // adapter layer, outside the transaction (repo convention).
  const effectsField = audioEffectsFieldOf(project, busUnitBox);
  let convolverBox: ConvolverDeviceBox | null = null;
  project.editing.modify(() => {
    convolverBox = project.api.insertEffect(effectsField, EffectFactories.Convolver) as ConvolverDeviceBox;
  });
  const convolver: ConvolverDeviceBox = convolverBox!;
  const adapter = project.boxAdapters.adapterFor(convolver, ConvolverDeviceBoxAdapter);

  // Drop the decoded buffer of a deleted AudioFileBox from the shared sample
  // map — repeated custom-IR drops would otherwise pin PCM for the page's
  // lifetime. Gallery entries are safe to drop too: selection re-sets them.
  const releaseDeleted = (deletedUUID: string | null): void => {
    if (deletedUUID !== null) audioBuffers.delete(deletedUUID);
  };

  const swapImpulse = (uuid: UUID.Bytes, name: string, seconds: number): void => {
    let deletedUUID: string | null = null;
    project.editing.modify(() => {
      deletedUUID = referSampleFile(project, convolver.file, uuid, name, seconds);
    });
    releaseDeleted(deletedUUID);
  };

  // One watch at a time: an error for an impulse that is no longer selected must not be shown.
  let loadWatch: Terminable = Terminable.Empty;
  const reportLoadError = (uuid: UUID.Bytes, name: string, onLoadError?: IRLoadErrorHandler): void => {
    loadWatch.terminate();
    loadWatch = Terminable.Empty;
    if (!onLoadError) return;
    loadWatch = watchSampleLoad(project, uuid, {
      onError: reason => onLoadError(`Impulse "${name}" failed to load: ${reason}`),
    });
  };

  const selectGalleryIR = (specId: string, onLoadError?: IRLoadErrorHandler): CurrentIR => {
    const spec = IMPULSE_RESPONSES.find(candidate => candidate.id === specId);
    const buffer = galleryBuffers.get(specId);
    const channel = galleryChannels.get(specId);
    if (spec === undefined || buffer === undefined || channel === undefined) {
      throw new Error(`Unknown IR spec: ${specId}`);
    }
    const uuid = galleryUUID(specId);
    audioBuffers.set(UUID.toString(uuid), buffer);
    swapImpulse(uuid, spec.name, buffer.duration);
    reportLoadError(uuid, spec.name, onLoadError);
    return { specId, name: spec.name, seconds: buffer.duration, channel };
  };

  const setCustomIR = (name: string, buffer: AudioBuffer, onLoadError?: IRLoadErrorHandler): CurrentIR => {
    const uuid = UUID.generate();
    audioBuffers.set(UUID.toString(uuid), buffer);
    swapImpulse(uuid, name, buffer.duration);
    reportLoadError(uuid, name, onLoadError);
    return {
      specId: null,
      name,
      seconds: buffer.duration,
      channel: buffer.getChannelData(0),
    };
  };

  const removeIR = (): null => {
    loadWatch.terminate();
    loadWatch = Terminable.Empty;
    let deletedUUID: string | null = null;
    project.editing.modify(() => {
      const filePointer = convolver.file;
      filePointer.targetVertex.ifSome(({ box: existingFile }) => {
        const mustDelete = existingFile.pointerHub.size() === 1;
        filePointer.defer();
        if (mustDelete) {
          deletedUUID = UUID.toString(existingFile.address.uuid);
          existingFile.delete();
        }
      });
    });
    releaseDeleted(deletedUUID);
    return null;
  };

  // Loop the timeline over the drum loop
  project.editing.modify(() => {
    project.timelineBox.loopArea.to.setValue(loopDurationPPQN);
  });

  onStatus?.("Waiting for samples...");
  const loadingComplete = await project.engine.queryLoadingComplete();
  if (!loadingComplete) throw new Error("Sample loading did not complete cleanly");
  project.engine.setPosition(0);

  return {
    convolverBox: convolver,
    adapter,
    drumUnitBox: drumUnitBox!,
    oneShotUnitBox: oneShotUnitBox!,
    galleryChannels,
    selectGalleryIR,
    setCustomIR,
    removeIR,
  };
}
