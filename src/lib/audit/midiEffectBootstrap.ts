/**
 * The project the Nano-based MIDI effect audits start from: one Nano sampler holding a sample, one note
 * region at a fixed position, the loop area off. Page-only code (it boots the engine through
 * `initializeOpenDAW`); the chain helpers a Node test needs live in `midiEffectChain.ts`.
 */
import { UUID } from "@opendaw/lib-std";
import type { ppqn } from "@opendaw/lib-dsp";
import type { Project } from "@opendaw/studio-core";
import { AudioFileBox, type AudioUnitBox, type NanoDeviceBox, type NoteRegionBox } from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { removeMasterMaximizer } from "@/lib/audit/midiEffectChain";

const SAMPLE_LOAD_DEADLINE_MS = 30_000;
const SUMMARY_UPLOAD_DEADLINE_MS = 30_000;

/** A failure that voids every later row: the run ends in `error:` instead of continuing. */
export class RunAbort extends Error {}

export interface NanoProjectOptions {
  localAudioBuffers: Map<string, AudioBuffer>;
  bpm: number;
  rate: number;
  /** One channel; the Nano gets it as a stereo file. */
  sample: Float32Array;
  fileName: string;
  rootKey: number;
  attackSeconds: number;
  releaseSeconds: number;
  regionPositionPpqn: number;
  regionDurationPpqn: number;
  /** Delete the Maximizer the skeleton puts on the master, for a render that must be level-true. */
  removeMaximizer: boolean;
  onStatus: (s: string) => void;
}

export interface NanoProject {
  project: Project;
  audioContext: AudioContext;
  audioUnitBox: AudioUnitBox;
  regionBox: NoteRegionBox;
  nanoBox: NanoDeviceBox;
}

/** The sample, the Nano with it attached, the region. Two transactions after init: the file box and the
 *  instrument together (the attachment is a mandatory-edge target), then the sampler's settings and the
 *  region. */
export async function buildNanoProject(options: NanoProjectOptions): Promise<NanoProject> {
  const { localAudioBuffers, bpm, rate, sample, onStatus } = options;
  const { project, audioContext } = await initializeOpenDAW({ localAudioBuffers, bpm, audioContextSampleRate: rate, onStatusUpdate: onStatus });
  const buffer = audioContext.createBuffer(2, sample.length, rate);
  buffer.getChannelData(0).set(sample);
  buffer.getChannelData(1).set(sample);
  const uuid = UUID.generate();
  localAudioBuffers.set(UUID.toString(uuid), buffer);
  const { audioUnitBox, instrumentBox, trackBox } = project.editing
    .modify(() => {
      const fileBox = AudioFileBox.create(project.boxGraph, uuid, (box) => {
        box.fileName.setValue(options.fileName);
        box.endInSeconds.setValue(buffer.duration);
      });
      return project.api.createInstrument(InstrumentFactories.Nano, { attachment: fileBox });
    })
    .unwrap("createInstrument");
  const nanoBox: NanoDeviceBox = instrumentBox;
  const regionBox = project.editing
    .modify(() => {
      nanoBox.attack.setValue(options.attackSeconds);
      nanoBox.release.setValue(options.releaseSeconds);
      nanoBox.rootKey.setValue(options.rootKey);
      nanoBox.loop.setValue(false);
      project.timelineBox.loopArea.enabled.setValue(false);
      return project.api.createNoteRegion({
        trackBox,
        position: options.regionPositionPpqn as ppqn,
        duration: options.regionDurationPpqn as ppqn,
        loopDuration: options.regionDurationPpqn as ppqn,
        name: "pattern",
      });
    })
    .unwrap("createNoteRegion");
  if (options.removeMaximizer) {
    const master = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
    if (master === undefined) throw new Error("the project has no master unit");
    const effects = master.audioEffects.unwrap("the master hosts no audio-effect chain").adapters();
    const removed = removeMasterMaximizer(project.editing, effects);
    // the skeleton builds exactly one; any other count means the render is not the level-true one the audit reads
    if (removed !== 1) throw new Error(`expected one Maximizer on the master, removed ${removed}`);
  }
  onStatus("Loading the sample...");
  await awaitSampleLoaded(project, uuid);
  return { project, audioContext, audioUnitBox, regionBox, nanoBox };
}

/** The loader's terminal state, read first and then awaited (the loader has `subscribe` only, and it
 *  fires synchronously for a terminal state). An error carries the loader's own reason. */
export function awaitSampleLoaded(project: Project, uuid: UUID.Bytes, deadlineMs: number = SAMPLE_LOAD_DEADLINE_MS): Promise<void> {
  const loader = project.sampleManager.getOrCreate(uuid);
  const failed = (reason: string) => new Error(`sample load failed: ${reason}`);
  if (loader.state.type === "loaded") return Promise.resolve();
  if (loader.state.type === "error") return Promise.reject(failed(loader.state.reason));
  return withDeadline(new Promise<void>((resolve, reject) => {
    let subscribed = false;
    const sub = loader.subscribe((state) => {
      if (state.type !== "loaded" && state.type !== "error") return;
      if (state.type === "loaded") resolve(); else reject(failed(state.reason));
      if (subscribed) sub.terminate();
    });
    subscribed = true;
  }), deadlineMs, "sample load");
}

/** The run's summary to the dev server's verify sink (`PUT /__verify/<fileName>`). */
export async function uploadSummary(fileName: string, body: unknown, deadlineMs: number = SUMMARY_UPLOAD_DEADLINE_MS): Promise<void> {
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/${fileName}`, { method: "PUT", body: JSON.stringify(body, null, 2) });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    deadlineMs,
    "summary upload",
  );
}
