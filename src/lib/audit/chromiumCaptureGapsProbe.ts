/**
 * The browser half of the Chromium 40103985 probe (`?issue=capture-gaps`). The click opens a
 * context at `&rate=48000|44100` (default 48000) and captures a 1 kHz tone through a
 * `MediaStreamAudioSourceNode` for `CAPTURE_SECONDS`:
 *
 * - `&source=loopback` (default): an oscillator into a `MediaStreamAudioDestinationNode` in
 *   the SAME context, its stream cloned and consumed by the source node: the node path of the
 *   recording alignment harness's loopback (`loopbackInjection.ts`), built here without the
 *   SDK-shaped getUserMedia patch since no SDK is loaded.
 * - `&source=mic`: the microphone with echo cancellation, noise suppression and gain control
 *   off, the page playing the same tone from the speaker at −20 dB; the recorder sees only
 *   the microphone.
 *
 * A worklet recorder copies channel 0 of the source node into one-second chunks and transfers
 * them; nothing else is in the graph. The track's `ended` and `mute` events are watched and the
 * recorder counts the quanta whose input had no channel: any of them reads `NOT CHECKED
 * source-<ended|muted|empty-input>`, the counts kept as figures. The judgement is
 * `chromiumCaptureGaps.ts`.
 *
 * `&stallMs=<ms>` (default 0, none) with `&stallEvery=<ms>` (default 1000) adds a stall node
 * (`public/chromium-capture-stall.js`, its own file: the suspend/resume tone renders audio) and,
 * every `stallEvery` ms of the capture, posts `stallMs` to it: the worklet thread busy-waits that
 * long, the render thread falls behind the source, and the frame each stall began at is recorded;
 * a run or duplicate starting in a stall's span (`chromiumCaptureGaps.ts`) counts as at the stall.
 * This provokes the tracker's mechanism, the sink writing zeros on a FIFO underrun.
 */

import { withDeadline } from "@/lib/deadline";
import { browserOf, makeEnvelope, newRunToken, platformOf, runDate, type Figures, type PlatformNavigator, type ProbeEnvelope } from "./chromiumWatched";
import {
  captureVerdict,
  findDuplicateBlocks,
  findZeroRuns,
  headZerosOf,
  judgeCaptureGaps,
  recorderChunkFrames,
  sinceLastStall,
  type SourceHealth,
  type ZeroRun,
} from "./chromiumCaptureGaps";

export const CAPTURE_SECONDS = 60;

const PROCESSOR_NAME = "chromium-capture-gaps-recorder";
const TONE_HZ = 1000;
const LOOPBACK_GAIN = 0.5;
const SPEAKER_GAIN = 10 ** (-20 / 20);
const QUANTUM = 128;
const DEADLINE_MS = 5000;
/** How long the capture may run past its own length before it is given up. */
const CAPTURE_GRACE_MS = 10000;
const LISTED = 5;
const STALL_PROCESSOR = "chromium-capture-stall";
const STALL_PROCESSOR_URL = "/chromium-capture-stall.js";
/** The stall offsets listed: every zero run of a minute with a few runs per one-second stall. */
const LISTED_OFFSETS = 400;

export type CaptureSource = "loopback" | "mic";
export type CaptureRate = 48000 | 44100;

/** The source named by `&source=`; loopback without one; throws on an unknown one. */
export function sourceFrom(params: URLSearchParams): CaptureSource {
  const value = params.get("source");
  if (value === null || value === "loopback") return "loopback";
  if (value === "mic") return "mic";
  throw new Error(`&source=${value}: expected loopback or mic`);
}

/** The context rate named by `&rate=`; 48000 without one; throws on any other. */
export function rateFrom(params: URLSearchParams): CaptureRate {
  const value = params.get("rate");
  if (value === null || value === "48000") return 48000;
  if (value === "44100") return 44100;
  throw new Error(`&rate=${value}: expected 48000 or 44100`);
}

/** A whole number of milliseconds from `&<name>=`; `fallback` without one; throws on anything else. */
function msFrom(params: URLSearchParams, name: string, fallback: number, min: number): number {
  const value = params.get(name);
  if (value === null) return fallback;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < min) throw new Error(`&${name}=${value}: expected a whole number of ms, at least ${min}`);
  return ms;
}

/** `&stallMs=` (default 0: no stalls) and `&stallEvery=` (default 1000). */
export function stallFrom(params: URLSearchParams): { stallMs: number; stallEveryMs: number } {
  return { stallMs: msFrom(params, "stallMs", 0, 0), stallEveryMs: msFrom(params, "stallEvery", 1000, 1) };
}

/**
 * Copies channel 0 of its input into chunks of whole quanta, about a second (the last one shorter), until
 * `frames` frames are taken, transferring each; a quantum whose input has no channel is
 * recorded as zeros and counted in `emptyQuanta`. Every message carries `firstFrame`, the
 * `currentFrame` of the first quantum taken: frame 0 of the capture.
 */
const PROCESSOR_SOURCE = `
class CaptureGapsRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.total = options.processorOptions.frames;
    this.chunkFrames = options.processorOptions.chunkFrames;
    this.taken = 0;
    this.emptyQuanta = 0;
    this.firstFrame = -1;
    this.begin();
  }
  begin() {
    this.chunk = new Float32Array(Math.min(this.chunkFrames, this.total - this.taken));
    this.filled = 0;
  }
  process(inputs) {
    if (this.taken >= this.total) return false;
    if (this.firstFrame < 0) this.firstFrame = currentFrame;
    const input = inputs[0];
    if (input.length === 0) this.emptyQuanta++;
    const count = Math.min(${QUANTUM}, this.chunk.length - this.filled);
    if (input.length > 0) this.chunk.set(input[0].subarray(0, count), this.filled);
    this.filled += count;
    this.taken += count;
    if (this.filled === this.chunk.length) {
      this.port.postMessage({ samples: this.chunk, emptyQuanta: this.emptyQuanta, firstFrame: this.firstFrame }, [this.chunk.buffer]);
      if (this.taken < this.total) this.begin();
    }
    return this.taken < this.total;
  }
}
registerProcessor("${PROCESSOR_NAME}", CaptureGapsRecorder);
`;

/** What the recorder hears through, and how the source was opened. */
interface Source {
  node: MediaStreamAudioSourceNode;
  track: MediaStreamTrack;
  deviceLabel: string;
  /** Every stream opened, stopped at the end. */
  streams: MediaStream[];
}

function loopbackSource(context: AudioContext): Source {
  const oscillator = new OscillatorNode(context, { frequency: TONE_HZ });
  const gain = new GainNode(context, { gain: LOOPBACK_GAIN });
  const destination = new MediaStreamAudioDestinationNode(context);
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const stream = destination.stream.clone();
  const node = new MediaStreamAudioSourceNode(context, { mediaStream: stream });
  return { node, track: stream.getAudioTracks()[0], deviceLabel: "loopback (same-context destination stream, cloned)", streams: [destination.stream, stream] };
}

async function micSource(context: AudioContext): Promise<Source> {
  const stream = await withDeadline(
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
    30000,
    "getUserMedia",
  );
  try {
    const track = stream.getAudioTracks()[0];
    if (track === undefined) throw new Error("no-audio-track");
    const deviceId = track.getSettings().deviceId;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const listed = devices.find((device) => device.kind === "audioinput" && device.deviceId === deviceId);
    const oscillator = new OscillatorNode(context, { frequency: TONE_HZ });
    oscillator.connect(new GainNode(context, { gain: SPEAKER_GAIN })).connect(context.destination);
    oscillator.start();
    const node = new MediaStreamAudioSourceNode(context, { mediaStream: stream });
    return { node, track, deviceLabel: listed?.label || track.label, streams: [stream] };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
}

interface Captured {
  samples: Float32Array;
  emptyQuanta: number;
  /** The context frame of the capture's frame 0. */
  firstFrame: number;
}

/** Records `frames` frames of the source node's channel 0; resolves with them, the empty-input quanta and the first frame. */
function record(context: AudioContext, source: Source, frames: number): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const recorder = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      processorOptions: { frames, chunkFrames: recorderChunkFrames(context.sampleRate) },
    });
    const samples = new Float32Array(frames);
    let offset = 0;
    recorder.port.onmessage = (event: MessageEvent<Captured>) => {
      samples.set(event.data.samples, offset);
      offset += event.data.samples.length;
      if (offset >= frames) {
        source.node.disconnect();
        resolve({ samples, emptyQuanta: event.data.emptyQuanta, firstFrame: event.data.firstFrame });
      }
    };
    recorder.port.onmessageerror = () => reject(new Error("recorder-chunk-unreadable"));
    recorder.onprocessorerror = () => reject(new Error("recorder-threw"));
    source.node.connect(recorder);
  });
}

function joinFirst(values: readonly (number | null)[], count: number = LISTED): string {
  return values.slice(0, count).map((value) => (value === null ? "-" : String(value))).join(" ");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What the stalls did: the context frame each began at and how long each post took to answer. */
interface Stalls {
  frames: number[];
  roundTripMs: number[];
  failed: string | null;
}

/** Every `everyMs` until `done()`, posts `stallMs` to the stall node and awaits its answer. */
async function stallUntil(node: AudioWorkletNode, stallMs: number, everyMs: number, done: () => boolean): Promise<Stalls> {
  const stalls: Stalls = { frames: [], roundTripMs: [], failed: null };
  while (true) {
    await wait(everyMs);
    if (done()) return stalls;
    const t0 = performance.now();
    try {
      const frame = await withDeadline(
        new Promise<number>((resolve) => {
          node.port.onmessage = (event: MessageEvent<{ type: string; frame: number }>) => {
            if (event.data.type === "stalled") resolve(event.data.frame);
          };
          node.port.postMessage({ stall: stallMs });
        }),
        stallMs + DEADLINE_MS,
        `stall-${stalls.frames.length + 1}`,
      );
      stalls.frames.push(frame);
      stalls.roundTripMs.push(performance.now() - t0);
    } catch (error) {
      stalls.failed = stepOf(error);
      return stalls;
    }
  }
}

function stepOf(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, "-");
}

/** The click: open the source, record the minute, judge. A source that cannot be opened reads NOT CHECKED. */
export async function runCaptureGapsProbe(_signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  const params = new URLSearchParams(window.location.search);
  const sourceKind = sourceFrom(params);
  const requestedRate = rateFrom(params);
  const { stallMs, stallEveryMs } = stallFrom(params);
  const platform = await platformOf(navigator as PlatformNavigator);
  report("start-audio");
  const context = new AudioContext({ sampleRate: requestedRate, latencyHint: "interactive" });
  let source: Source | null = null;
  try {
    await withDeadline(context.resume(), DEADLINE_MS, "resume");
    if (context.state !== "running") throw new Error(`the context is ${context.state} after resume`);
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await withDeadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    let stallNode: AudioWorkletNode | null = null;
    if (stallMs > 0) {
      await withDeadline(context.audioWorklet.addModule(STALL_PROCESSOR_URL), DEADLINE_MS, "addModule-stall");
      stallNode = new AudioWorkletNode(context, STALL_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1 });
    }
    report("open-" + sourceKind);
    let failedStep: string | null = null;
    try {
      source = sourceKind === "mic" ? await micSource(context) : loopbackSource(context);
    } catch (error) {
      failedStep = `${sourceKind}-${error instanceof Error ? error.name : "error"}-${stepOf(error)}`;
      console.error("[chromium-watched] capture-gaps could not open the " + sourceKind + ": " + String(error));
    }
    let captured: Captured = { samples: new Float32Array(0), emptyQuanta: 0, firstFrame: 0 };
    let stalls: Stalls = { frames: [], roundTripMs: [], failed: null };
    const events = { ended: 0, mute: 0 };
    let mutedAtStart = false;
    if (source !== null) {
      const track = source.track;
      mutedAtStart = track.muted;
      track.addEventListener("ended", () => events.ended++);
      track.addEventListener("mute", () => events.mute++);
      report("capture");
      const frames = CAPTURE_SECONDS * context.sampleRate;
      let capturing = true;
      const stalling = stallNode === null ? null : stallUntil(stallNode, stallMs, stallEveryMs, () => !capturing);
      try {
        captured = await withDeadline(record(context, source, frames), CAPTURE_SECONDS * 1000 + CAPTURE_GRACE_MS, "capture");
      } catch (error) {
        failedStep = stepOf(error);
        console.error("[chromium-watched] capture-gaps capture failed: " + String(error));
      } finally {
        capturing = false;
      }
      if (stalling !== null) {
        stalls = await stalling;
        if (stalls.failed !== null && failedStep === null) failedStep = stalls.failed;
      }
    }
    report("judge");
    const samples = captured.samples;
    const captureSeconds = samples.length / context.sampleRate;
    const headZeros = headZerosOf(samples);
    const stallFrames = stalls.frames.map((frame) => frame - captured.firstFrame).filter((frame) => frame >= 0 && frame < samples.length);
    const stallLengthFrames = Math.round((stallMs * context.sampleRate) / 1000);
    const judged = judgeCaptureGaps(
      findZeroRuns(samples), findDuplicateBlocks(samples), headZeros, captureSeconds, context.sampleRate, stallFrames, stallLengthFrames,
    );
    const endedAtEnd = source !== null && source.track.readyState === "ended";
    const mutedAtEnd = source !== null && source.track.muted;
    const health: SourceHealth = {
      ended: events.ended > 0 || endedAtEnd,
      muted: events.mute > 0 || mutedAtStart || mutedAtEnd,
      emptyQuanta: captured.emptyQuanta,
    };
    const verdict = captureVerdict(judged, failedStep, health, captureSeconds);
    const settings: MediaTrackSettings = source === null ? {} : source.track.getSettings();
    const starts = (runs: readonly ZeroRun[]) => joinFirst(runs.map((run) => run.start));
    const lengths = (runs: readonly ZeroRun[]) => joinFirst(runs.map((run) => run.length));
    const figures: Figures = {
      source: sourceKind,
      requestedRate,
      sampleRate: context.sampleRate,
      recorderChunkFrames: recorderChunkFrames(context.sampleRate),
      captureSeconds: Number(captureSeconds.toFixed(3)),
      headZeros,
      zeroRunCount: judged.zeroRunCount,
      longestRunFrames: judged.longestRunFrames,
      longestRunMs: Number(((judged.longestRunFrames / context.sampleRate) * 1000).toFixed(2)),
      zeroRunStarts: starts(judged.zeroRuns),
      zeroRunLengths: lengths(judged.zeroRuns),
      duplicateCount: judged.duplicateCount,
      duplicateStarts: joinFirst(judged.duplicates),
      startZeroRunCount: judged.startZeroRuns.length,
      startZeroRunStarts: starts(judged.startZeroRuns),
      startZeroRunLengths: lengths(judged.startZeroRuns),
      startDuplicateCount: judged.startDuplicates.length,
      startDuplicateStarts: joinFirst(judged.startDuplicates),
      stallMs,
      stallEveryMs: stallMs > 0 ? stallEveryMs : null,
      stallCount: stalls.frames.length,
      stallFramesInCapture: stallFrames.length,
      stallFrames: stallFrames.join(" "),
      stallSpanFrames: stallMs > 0 ? `-128..+${2 * stallLengthFrames + 128}` : null,
      stallRoundTripMsMin: stalls.roundTripMs.length === 0 ? null : Number(Math.min(...stalls.roundTripMs).toFixed(1)),
      stallRoundTripMsMax: stalls.roundTripMs.length === 0 ? null : Number(Math.max(...stalls.roundTripMs).toFixed(1)),
      stallFailed: stalls.failed,
      verdictDetail: judged.detail,
      stallZeroRunCount: judged.stallZeroRuns.length,
      stallZeroRunStarts: starts(judged.stallZeroRuns),
      stallZeroRunLengths: lengths(judged.stallZeroRuns),
      stallDuplicateCount: judged.stallDuplicates.length,
      stallDuplicateStarts: joinFirst(judged.stallDuplicates),
      zeroRunFramesSinceStall: joinFirst(judged.zeroRuns.map((run) => sinceLastStall(run.start, stallFrames)), LISTED_OFFSETS),
      zeroRunLengthsAll: joinFirst(judged.zeroRuns.map((run) => run.length), LISTED_OFFSETS),
      emptyInputQuanta: captured.emptyQuanta,
      trackEndedEvents: events.ended,
      trackMuteEvents: events.mute,
      trackMutedAtStart: source === null ? null : String(mutedAtStart),
      trackStateAtEnd: source === null ? null : source.track.readyState,
      deviceLabel: source === null ? null : source.deviceLabel,
      trackSampleRate: settings.sampleRate ?? null,
      trackChannelCount: settings.channelCount ?? null,
      trackDeviceId: settings.deviceId ?? null,
      trackEchoCancellation: settings.echoCancellation === undefined ? null : String(settings.echoCancellation),
      baseLatency: context.baseLatency,
      outputLatency: context.outputLatency,
      osVersion: platform.platformVersion,
      chromeFullVersion: platform.uaFullVersion,
      userAgent: platform.userAgent,
    };
    return makeEnvelope({ issue: "capture-gaps", chrome: browserOf(navigator), date: runDate(), runToken: newRunToken() }, verdict, figures);
  } finally {
    for (const stream of source?.streams ?? []) for (const track of stream.getTracks()) track.stop();
    await context.close();
  }
}
