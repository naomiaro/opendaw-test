import { Terminable, UUID } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import { InstrumentFactories, NanoDeviceBoxAdapter, NoteRegionBoxAdapter } from "@opendaw/studio-adapters";
import { AudioFileBox } from "@opendaw/studio-boxes";
import type { AudioUnitBox, NanoDeviceBox, NoteRegionBox, TrackBox } from "@opendaw/studio-boxes";
import { channelsToAudioBuffer } from "@/lib/impulseResponses";
import { NANO_SAMPLES, type NanoSampleSpec } from "@/lib/nanoSamples";
import { referSampleFile, watchSampleLoad } from "@/lib/sampleFiles";
import {
  CUSTOM_PRESET, NANO_PRESETS, PATTERN_LENGTH,
  type NanoParams, type NanoPatternNote, type NanoPreset,
} from "./nanoPresets";

export const NANO_DEMO_BPM = 120;

export interface CurrentSample {
  /** Gallery sample id, or null for a dropped file */
  readonly id: string | null;
  readonly name: string;
  readonly seconds: number;
}

export interface SampleLoadCallbacks {
  readonly onLoaded?: () => void;
  readonly onError?: (message: string) => void;
}

export interface NanoDemoSetup {
  readonly audioUnitBox: AudioUnitBox;
  readonly nanoBox: NanoDeviceBox;
  readonly adapter: NanoDeviceBoxAdapter;
  readonly initialSample: CurrentSample;
  readonly selectSample: (id: string, callbacks?: SampleLoadCallbacks) => CurrentSample;
  readonly setCustomSample: (name: string, buffer: AudioBuffer, callbacks?: SampleLoadCallbacks) => CurrentSample;
}

interface GalleryEntry {
  readonly spec: NanoSampleSpec;
  readonly buffer: AudioBuffer;
  /** Stable for the page's lifetime, so re-selecting a sample reuses its cached loader */
  readonly uuid: UUID.Bytes;
}

/** Write a full parameter set. Call inside a transaction. */
function applyParams(adapter: NanoDeviceBoxAdapter, params: NanoParams): void {
  const named = adapter.namedParameter;
  named.rootKey.setValue(params.rootKey);
  named.octave.setValue(params.octave);
  named.tune.setValue(params.tune);
  named.volume.setValue(params.volume);
  named.attack.setValue(params.attack);
  named.release.setValue(params.release);
  named.sampleStart.setValue(params.sampleStart);
  named.sampleEnd.setValue(params.sampleEnd);
  named.loop.setValue(params.loop);
  named.loopFade.setValue(params.loopFade);
  named.loopStart.setValue(params.loopStart);
  named.loopEnd.setValue(params.loopEnd);
}

/**
 * Build the Nano demo project: one Nano instrument with the first gallery
 * sample attached, a two-bar looping note region, and an armed MIDI capture.
 */
export async function buildNanoDemoContent(
  project: Project,
  audioContext: AudioContext,
  audioBuffers: Map<string, AudioBuffer>,
  onStatus?: (status: string) => void
): Promise<NanoDemoSetup> {
  const { boxGraph } = project;
  const sampleRate = audioContext.sampleRate;

  onStatus?.("Rendering samples...");
  const gallery = new Map<string, GalleryEntry>();
  for (const spec of NANO_SAMPLES) {
    const buffer = channelsToAudioBuffer(spec.render(sampleRate), sampleRate);
    gallery.set(spec.id, { spec, buffer, uuid: UUID.generate() });
  }
  const first = gallery.get(NANO_SAMPLES[0].id);
  if (first === undefined) throw new Error("The sample gallery is empty.");
  audioBuffers.set(UUID.toString(first.uuid), first.buffer);

  onStatus?.("Building project...");
  let createdUnit: AudioUnitBox | null = null;
  let createdNano: NanoDeviceBox | null = null;
  let createdTrack: TrackBox | null = null;
  project.editing.modify(() => {
    const fileBox = AudioFileBox.create(boxGraph, first.uuid, box => {
      box.fileName.setValue(first.spec.name);
      box.endInSeconds.setValue(first.buffer.duration);
    });
    const product = project.api.createInstrument(InstrumentFactories.Nano, { attachment: fileBox });
    createdUnit = product.audioUnitBox;
    createdNano = product.instrumentBox;
    createdTrack = product.trackBox;
  });
  if (!createdUnit || !createdNano || !createdTrack) throw new Error("Failed to create the Nano instrument.");
  // Casts defeat closure narrowing to never after the modify() callback.
  const audioUnitBox = createdUnit as AudioUnitBox;
  const nanoBox = createdNano as NanoDeviceBox;
  const trackBox = createdTrack as TrackBox;
  const adapter = project.boxAdapters.adapterFor(nanoBox, NanoDeviceBoxAdapter);

  // Resolved after the creation transaction commits. `armed` is a runtime
  // observable, not a box field, so it is set outside any transaction.
  const captureOption = project.captureDevices.get(audioUnitBox.address.uuid);
  if (captureOption.isEmpty()) {
    throw new Error("Could not arm the MIDI capture, so the keyboard would be silent.");
  }
  captureOption.unwrap().armed.setValue(true);

  let createdRegion: NoteRegionBox | null = null;
  project.editing.modify(() => {
    applyParams(adapter, NANO_PRESETS[first.spec.id].params);
    createdRegion = project.api.createNoteRegion({
      trackBox,
      position: 0,
      duration: PATTERN_LENGTH,
      loopOffset: 0,
      loopDuration: PATTERN_LENGTH,
      name: "Nano Pattern",
    });
    const { loopArea, durationInPulses } = project.timelineBox;
    loopArea.from.setValue(0);
    loopArea.to.setValue(PATTERN_LENGTH);
    loopArea.enabled.setValue(true);
    durationInPulses.setValue(PATTERN_LENGTH);
  });
  if (!createdRegion) throw new Error("Failed to create the note region.");

  // The region's event collection resolves only once its transaction has committed.
  const regionAdapter = project.boxAdapters.adapterFor(createdRegion as NoteRegionBox, NoteRegionBoxAdapter);
  const collectionOption = regionAdapter.optCollection;
  if (collectionOption.isEmpty()) throw new Error("The note region has no event collection.");
  const collection = collectionOption.unwrap();

  /**
   * Replace the pattern. Deleting and creating run as two commits because a
   * collection does not see its own in-flight changes; `append` folds the
   * second commit into the first one's undo step.
   */
  const writePattern = (pattern: ReadonlyArray<NanoPatternNote>): void => {
    const create = (): void => {
      for (const note of pattern) {
        collection.createEvent({
          position: note.position,
          duration: note.duration,
          pitch: note.pitch,
          cent: 0,
          velocity: note.velocity,
          chance: 100,
          playCount: 1,
        });
      }
    };
    const existing = collection.events.asArray().slice();
    if (existing.length === 0) {
      project.editing.modify(create);
      return;
    }
    project.editing.modify(() => existing.forEach(event => event.box.delete()));
    project.editing.append(create);
  };
  writePattern(NANO_PRESETS[first.spec.id].pattern);

  let loadWatch: Terminable = Terminable.Empty;

  const swap = (
    uuid: UUID.Bytes,
    name: string,
    buffer: AudioBuffer,
    preset: NanoPreset,
    callbacks?: SampleLoadCallbacks
  ): void => {
    // A watch for a sample that is no longer selected must not report.
    loadWatch.terminate();
    audioBuffers.set(UUID.toString(uuid), buffer);
    let deletedUUID: string | null = null;
    project.editing.modify(() => {
      deletedUUID = referSampleFile(project, nanoBox.file, uuid, name, buffer.duration);
      applyParams(adapter, preset.params);
    });
    if (deletedUUID !== null) audioBuffers.delete(deletedUUID);
    writePattern(preset.pattern);
    loadWatch = watchSampleLoad(project, uuid, {
      onLoaded: callbacks?.onLoaded,
      onError: reason => callbacks?.onError?.(`"${name}" failed to load: ${reason}`),
    });
  };

  const selectSample = (id: string, callbacks?: SampleLoadCallbacks): CurrentSample => {
    const entry = gallery.get(id);
    if (entry === undefined) throw new Error(`Unknown sample: ${id}`);
    swap(entry.uuid, entry.spec.name, entry.buffer, NANO_PRESETS[id], callbacks);
    return { id, name: entry.spec.name, seconds: entry.buffer.duration };
  };

  const setCustomSample = (name: string, buffer: AudioBuffer, callbacks?: SampleLoadCallbacks): CurrentSample => {
    swap(UUID.generate(), name, buffer, CUSTOM_PRESET, callbacks);
    return { id: null, name, seconds: buffer.duration };
  };

  onStatus?.("Waiting for samples...");
  const loadingComplete = await project.engine.queryLoadingComplete();
  if (!loadingComplete) throw new Error("Sample loading did not complete cleanly.");
  project.engine.setPosition(0);

  return {
    audioUnitBox,
    nanoBox,
    adapter,
    initialSample: { id: first.spec.id, name: first.spec.name, seconds: first.buffer.duration },
    selectSample,
    setCustomSample,
  };
}
