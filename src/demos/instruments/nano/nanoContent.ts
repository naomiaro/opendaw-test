import { Terminable, UUID } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import { InstrumentFactories, NanoDeviceBoxAdapter, NoteRegionBoxAdapter } from "@opendaw/studio-adapters";
import type { AutomatableParameterFieldAdapter } from "@opendaw/studio-adapters";
import { AudioFileBox } from "@opendaw/studio-boxes";
import type { AudioUnitBox, NanoDeviceBox, NoteRegionBox, TrackBox } from "@opendaw/studio-boxes";
import { channelsToAudioBuffer } from "@/lib/impulseResponses";
import { NANO_SAMPLES, type NanoSampleId, type NanoSampleSpec } from "@/lib/nanoSamples";
import { withDeadline } from "@/lib/deadline";
import { referSampleFile, watchSampleLoad } from "@/lib/sampleFiles";
import {
  CUSTOM_PRESET, NANO_PRESETS, PATTERN_LENGTH,
  type NanoParams, type NanoPatternNote, type NanoPreset,
} from "./nanoPresets";

export const NANO_DEMO_BPM = 120;

export interface CurrentSample {
  /** Gallery sample id, or null for a dropped file */
  readonly id: NanoSampleId | null;
  readonly name: string;
  readonly seconds: number;
}

export interface SampleLoadCallbacks {
  readonly onLoaded?: () => void;
  /** The message is ready to show and already names the sample */
  readonly onError?: (message: string) => void;
}

export interface NanoDemoSetup {
  readonly audioUnitBox: AudioUnitBox;
  readonly nanoBox: NanoDeviceBox;
  readonly adapter: NanoDeviceBoxAdapter;
  readonly initialSample: CurrentSample;
  readonly selectSample: (id: NanoSampleId, callbacks?: SampleLoadCallbacks) => CurrentSample;
  readonly setCustomSample: (name: string, buffer: AudioBuffer, callbacks?: SampleLoadCallbacks) => CurrentSample;
}

interface GalleryEntry {
  readonly spec: NanoSampleSpec;
  readonly buffer: AudioBuffer;
  /** Stable for the page's lifetime, so re-selecting a sample resolves to the same stored sample */
  readonly uuid: UUID.Bytes;
}

/** How long the first sample may take to load before the page reports it */
const LOADING_DEADLINE_MS = 30_000;

/**
 * Write one preset value. Box fields do not clamp, so a value the parameter's
 * own mapping would change (out of range, not a number, a fraction for an
 * integer) is refused. The throw aborts the surrounding transaction.
 */
function writeChecked<T extends number | boolean>(parameter: AutomatableParameterFieldAdapter<T>, value: T): void {
  if (parameter.valueMapping.clamp(value) !== value) {
    throw new Error(`Preset value ${String(value)} is outside the range of "${parameter.name}".`);
  }
  parameter.setValue(value);
}

/** Write a full parameter set. Call inside a transaction; a refused value aborts it. */
export function applyParams(adapter: NanoDeviceBoxAdapter, params: NanoParams): void {
  const named = adapter.namedParameter;
  writeChecked(named.rootKey, params.rootKey);
  writeChecked(named.octave, params.octave);
  writeChecked(named.tune, params.tune);
  writeChecked(named.volume, params.volume);
  writeChecked(named.attack, params.attack);
  writeChecked(named.release, params.release);
  writeChecked(named.sampleStart, params.sampleStart);
  writeChecked(named.sampleEnd, params.sampleEnd);
  writeChecked(named.loop, params.loop);
  writeChecked(named.loopFade, params.loopFade);
  writeChecked(named.loopStart, params.loopStart);
  writeChecked(named.loopEnd, params.loopEnd);
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
  const gallery = new Map<NanoSampleId, GalleryEntry>();
  for (const spec of NANO_SAMPLES) {
    const buffer = channelsToAudioBuffer(spec.render(sampleRate), sampleRate);
    gallery.set(spec.id, { spec, buffer, uuid: UUID.generate() });
  }
  const galleryKeys = new Set<string>([...gallery.values()].map(entry => UUID.toString(entry.uuid)));
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
    isGallerySample: boolean,
    callbacks?: SampleLoadCallbacks
  ): void => {
    const key = UUID.toString(uuid);
    // The buffer must be in the map before the transaction that refers to it:
    // the loader asks for it as soon as the file box exists.
    audioBuffers.set(key, buffer);
    let deletedUUID: string | null = null;
    try {
      project.editing.modify(() => {
        deletedUUID = referSampleFile(project, nanoBox.file, uuid, name, buffer.duration);
        applyParams(adapter, preset.params);
      });
    } catch (error) {
      // Nothing was committed: the previous sample is still current and keeps
      // its watch. A dropped file's buffer would otherwise stay in the map for good.
      if (!isGallerySample) audioBuffers.delete(key);
      throw error;
    }
    // From here on the new sample IS the sampler's sample, whatever happens next.
    loadWatch.terminate();
    loadWatch = watchSampleLoad(project, uuid, {
      onLoaded: callbacks?.onLoaded,
      onError: reason => callbacks?.onError?.(`"${name}" failed to load: ${reason}`),
    });
    // Gallery buffers stay: the gallery holds them anyway, and a load that is
    // still running for one of them would fail if its buffer were taken away.
    if (deletedUUID !== null && !galleryKeys.has(deletedUUID)) audioBuffers.delete(deletedUUID);
    try {
      writePattern(preset.pattern);
    } catch (error) {
      console.error("Nano demo: pattern write failed: " + String(error));
      callbacks?.onError?.(
        `"${name}" is loaded, but its pattern could not be written: ` +
        (error instanceof Error ? error.message : String(error))
      );
    }
  };

  const selectSample = (id: NanoSampleId, callbacks?: SampleLoadCallbacks): CurrentSample => {
    const entry = gallery.get(id);
    if (entry === undefined) throw new Error(`Unknown sample: ${id}`);
    swap(entry.uuid, entry.spec.name, entry.buffer, NANO_PRESETS[id], true, callbacks);
    return { id, name: entry.spec.name, seconds: entry.buffer.duration };
  };

  const setCustomSample = (name: string, buffer: AudioBuffer, callbacks?: SampleLoadCallbacks): CurrentSample => {
    swap(UUID.generate(), name, buffer, CUSTOM_PRESET, false, callbacks);
    return { id: null, name, seconds: buffer.duration };
  };

  onStatus?.("Waiting for samples...");
  // The engine's answer does not tell a loaded sample from a failed one (a
  // failed sample resolves too, as silence), and a loader that never settles
  // would leave the page waiting for good. So: a deadline, then the loader's own state.
  const loadingComplete = await withDeadline(
    project.engine.queryLoadingComplete(), LOADING_DEADLINE_MS, `Loading "${first.spec.name}"`
  );
  if (!loadingComplete) throw new Error("Sample loading did not complete cleanly.");
  const firstState = project.sampleManager.getOrCreate(first.uuid).state;
  if (firstState.type === "error") {
    throw new Error(`"${first.spec.name}" failed to load: ${firstState.reason}`);
  }
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
