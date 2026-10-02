// The engine side of a loudness audit case: one Tape track that holds the case's signal,
// a worklet restart for an empty meter, a tap on the engine's output, and one play-through
// captured as tap chunks and meter readings.
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { LiveStreamReceiver } from "@opendaw/lib-fusion";
import { EngineAddresses, InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox, type TrackBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { waitForLoadingComplete } from "@/lib/engineLoading";
import { withDeadline } from "@/lib/deadline";
import {
  LOUDNESS_TAP_CHUNK_QUANTA,
  LOUDNESS_TAP_PROCESSOR,
  LOUDNESS_TAP_PROCESSOR_SOURCE,
  LOUDNESS_TAP_QUIET,
  signalSpan,
  type CaseCapture,
  type LoudnessReading,
  type TapChunk,
  type TapStats,
} from "@/lib/audit/loudnessTap";

const BPM = 120;
/** How long after the signal ends the capture keeps reading (the late reading). */
const LATE_SECONDS = 5;

export interface LoudnessSession {
  project: Project;
  audioContext: AudioContext;
  /** Also send the engine to the speakers. Off by default: the tones are long and loud. */
  audible: boolean;
  localAudioBuffers: Map<string, AudioBuffer>;
  trackBox: TrackBox;
  /** The boxes of the signal now on the track, replaced by the next `loadSignal`. */
  content: { region: AudioRegionBox; file: AudioFileBox } | null;
  /** The engine node now feeding the tap. */
  engineNode: AudioNode | null;
  tap: AudioWorkletNode | null;
}

/** Boots the engine at `rate` with one empty Tape track at unity gain, and loads the tap module. */
export async function openSession(rate: number, audible: boolean): Promise<LoudnessSession> {
  const localAudioBuffers = new Map<string, AudioBuffer>();
  const first: { node: AudioNode | null } = { node: null };
  const { project, audioContext } = await initializeOpenDAW({
    localAudioBuffers,
    bpm: BPM,
    audioContextSampleRate: rate,
    engineTap: (node) => {
      first.node = node;
    },
  });
  await withDeadline(audioContext.resume(), 10_000, "AudioContext resume");
  const moduleUrl = URL.createObjectURL(new Blob([LOUDNESS_TAP_PROCESSOR_SOURCE], { type: "application/javascript" }));
  try {
    await withDeadline(audioContext.audioWorklet.addModule(moduleUrl), 10_000, "the tap worklet module");
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  project.engine.preferences.settings.metronome.enabled = false;
  const { audioUnitBox, trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape))
    .unwrap("the tape instrument");
  const output = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
  if (output === undefined) throw new Error("the project has no output unit");
  // A separate transaction from createInstrument: unity gain on the track and on the output.
  project.editing.modify(() => {
    audioUnitBox.volume.setValue(0);
    audioUnitBox.panning.setValue(0);
    output.box.volume.setValue(0);
    output.box.panning.setValue(0);
  });
  return {
    project,
    audioContext,
    audible,
    localAudioBuffers,
    trackBox,
    content: null,
    engineNode: first.node,
    tap: null,
  };
}

/** Puts `signal` on the track as a stereo region from position 0, in place of the previous one. */
export function loadSignal(session: LoudnessSession, signal: Float32Array, label: string): void {
  const { project, audioContext, localAudioBuffers, trackBox } = session;
  const buffer = audioContext.createBuffer(2, signal.length, audioContext.sampleRate);
  buffer.getChannelData(0).set(signal);
  buffer.getChannelData(1).set(signal);
  const seconds = signal.length / audioContext.sampleRate;
  const durationPpqn = Math.round(PPQN.secondsToPulses(seconds, BPM));
  const uuid = UUID.generate();
  const previous = session.content;
  localAudioBuffers.clear();
  localAudioBuffers.set(UUID.toString(uuid), buffer);
  session.content = project.editing
    .modify(() => {
      previous?.region.delete();
      previous?.file.delete();
      const file = AudioFileBox.create(project.boxGraph, uuid, (box) => {
        box.fileName.setValue(label);
        box.endInSeconds.setValue(seconds);
      });
      const events = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
      const region = AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
        box.regions.refer(trackBox.regions);
        box.file.refer(file);
        box.events.refer(events.owners);
        box.position.setValue(0);
        box.duration.setValue(durationPpqn);
        box.loopOffset.setValue(0);
        box.loopDuration.setValue(durationPpqn);
        box.label.setValue(label);
        box.mute.setValue(false);
        box.gain.setValue(0);
      });
      return { region, file };
    })
    .unwrap("the signal's region");
}

/**
 * Restarts the engine worklet, which is the only way to empty the loudness meter: the meter
 * lives in the worklet processor and has no reset. The new node reaches the destination
 * through the tap alone unless the session is audible.
 */
export async function freshMeter(session: LoudnessSession): Promise<void> {
  const { project, audioContext } = session;
  session.tap?.disconnect();
  session.engineNode?.disconnect();
  // The receiver is a plain field; a worklet cannot connect to one that is already connected.
  (project as { liveStreamReceiver: LiveStreamReceiver }).liveStreamReceiver = new LiveStreamReceiver();
  const worklet = project.startAudioWorklet();
  await withDeadline(worklet.isReady(), 30_000, "the worklet restart");
  worklet.disconnect(); // startAudioWorklet connected it to the speakers
  const tap = new AudioWorkletNode(audioContext, LOUDNESS_TAP_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { chunkQuanta: LOUDNESS_TAP_CHUNK_QUANTA },
  });
  worklet.connect(tap, 0);
  tap.connect(audioContext.destination);
  if (session.audible) worklet.connect(audioContext.destination, 0);
  session.engineNode = worklet;
  session.tap = tap;
  await waitForLoadingComplete(project, 30_000);
}

/** Polls on a timer, not on animation frames, so a hidden tab still reaches its timeout. */
function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 50);
  });
}

/**
 * Plays the loaded signal once from position 0 and returns everything seen: the tap's chunks
 * and the meter's readings, from before play until `lateSeconds` after the signal ended.
 * The subscription is what switches the meter on, so it is made before play.
 */
export async function playAndCapture(
  session: LoudnessSession,
  signalSeconds: number,
  lateSeconds: number = LATE_SECONDS
): Promise<CaseCapture> {
  const { project, tap } = session;
  if (tap === null) throw new Error("freshMeter must run before playAndCapture");
  const readings: LoudnessReading[] = [];
  const chunks: TapChunk[] = [];
  let hidden = document.visibilityState === "hidden";
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hidden = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  tap.port.onmessage = (event: MessageEvent<TapStats>) => {
    chunks.push({ ...event.data, atMs: performance.now() });
  };
  const subscription = project.liveStreamReceiver.subscribeFloats(EngineAddresses.LOUDNESS, (values) => {
    readings.push({
      atMs: performance.now(),
      momentary: values[0],
      shortTerm: values[1],
      integrated: values[2],
      range: values[3],
      peak: values[4],
    });
  });
  const loud = (chunk: TapChunk) => Math.max(chunk.peak[0], chunk.peak[1]) > LOUDNESS_TAP_QUIET;
  try {
    await waitFor(() => readings.length > 0, 5_000, "the first loudness reading (is the tab visible?)");
    project.engine.setPosition(0);
    project.engine.play();
    await waitFor(() => chunks.some(loud), 10_000, "the signal to reach the output");
    await waitFor(
      () => {
        const span = signalSpan(chunks);
        return span !== null && readings.some((reading) => reading.atMs >= span.endMs + lateSeconds * 1000);
      },
      (signalSeconds + lateSeconds + 30) * 1000,
      "the end of the signal"
    );
  } finally {
    project.engine.stop(true);
    project.engine.setPosition(0);
    subscription.terminate();
    tap.port.onmessage = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }
  return { readings, chunks, hidden };
}
