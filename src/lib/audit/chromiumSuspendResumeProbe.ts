/**
 * The browser half of the Chromium 560233271 probe (`?issue=suspend-resume`). The click starts a
 * running context with the tracker's tone, a stateless 440 Hz sine at 0.2 that the worklet renders
 * from `currentFrame` (`public/chromium-suspend-resume-tone.js`, loaded from the file unless
 * `&module=blob`), into an analyser and on through a gain to the destination (−30 dB, or −20 dB
 * with the microphone witness; the repro page connects the node to the destination with no gain).
 * It reads a two-second baseline, then runs the cycles. One cycle is what the repro page's click
 * does: the optional worklet-thread stall, `suspend()`, the optional gap, `resume()`, each raced
 * against a deadline; then the window, whose end is read. A window reads the analyser once: the
 * spectrum gives the tone's purity, the time-domain samples the dropouts and the clicks. Each
 * window also measures the context clock against the wall clock, and the processor's `process()`
 * calls per second: the tracker's trace shows the failure as one render quantum per 256-frame
 * callback, half the render rate.
 *
 * With `&witness=mic` the microphone, captured in a second context that is never suspended, is
 * read the same way and judged against its own baseline window, and the whole capture is saved
 * as a WAV beside the envelope. With `&manual=1` each cycle waits for a click on the page's
 * "Suspend / resume" button (`chromiumSuspendResumeManual.ts`) instead of the pace timer.
 * The options are `chromiumSuspendResumeOptions.ts`; the judgement is `chromiumSuspendResume.ts`.
 */

import { WavFile } from "@opendaw/lib-dsp";
import { withDeadline } from "@/lib/deadline";
import { browserOf, newRunToken, platformOf, runDate, type PlatformNavigator, type ProbeEnvelope } from "./chromiumWatched";
import { type ClockRatioSample } from "./chromiumBfcache";
import {
  MIN_CYCLES,
  TONE_HZ,
  clickThreshold,
  countClicks,
  countDropouts,
  judgeHalfRate,
  judgeSuspendResume,
  purityOf,
  tonePurityFromSpectrum,
  type TonePurity,
} from "./chromiumSuspendResume";
import {
  CONTROL_FROM_CYCLE,
  MIC_ONLY_VERDICT,
  overallVerdict,
  suspendResumeOptionsFrom,
  type SuspendResumeOptions,
} from "./chromiumSuspendResumeOptions";
import { manualSession } from "./chromiumSuspendResumeManual";

const PROCESSOR_URL = "/chromium-suspend-resume-tone.js";
const PROCESSOR_NAME = "chromium-suspend-resume-tone";
const RECORDER_NAME = "chromium-suspend-resume-recorder";
const BASELINE_SECONDS = 2;
const WINDOW_SECONDS = 1;
const GRAPH_GAIN = 10 ** (-30 / 20);
const SPEAKER_GAIN = 10 ** (-20 / 20);
const FFT_SIZE = 32768;
/** One render quantum: a zero-filled partial buffer shows as one window. */
const DROPOUT_WINDOW = 128;
const DEADLINE_MS = 5000;
/** The microphone's purity leaves out the room's rumble below this; the tone's harmonics and crackle sit above it. */
const MIC_MIN_HZ = 200;

/** Copies channel 0 of its input into chunks of about a second until told to stop; the last chunk is partial. */
const RECORDER_SOURCE = `
class SuspendResumeRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.begin();
    this.port.onmessage = () => { this.stopped = true; };
  }
  begin() {
    this.chunk = new Float32Array(Math.ceil(sampleRate / 128) * 128);
    this.filled = 0;
  }
  flush(final) {
    const out = this.chunk.slice(0, this.filled);
    this.port.postMessage({ samples: out, final }, [out.buffer]);
    this.begin();
  }
  process(inputs) {
    if (this.stopped) {
      this.flush(true);
      return false;
    }
    const input = inputs[0];
    if (input.length > 0) this.chunk.set(input[0], this.filled);
    this.filled += 128;
    if (this.filled === this.chunk.length) this.flush(false);
    return true;
  }
}
registerProcessor("${RECORDER_NAME}", SuspendResumeRecorder);
`;

/** The parts of `navigator` the OS is read from. */
interface OsNavigator {
  userAgent: string;
  userAgentData?: { platform?: string };
}

/** The OS: `navigator.userAgentData.platform`, else the platform the user-agent string names. */
export function osOf(nav: OsNavigator): string {
  const platform = nav.userAgentData?.platform;
  if (platform !== undefined && platform !== "") return platform;
  const match = /\(([^;)]+)/.exec(nav.userAgent);
  return match === null ? nav.userAgent : match[1];
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value: number | null, digits: number): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function stepOf(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, "-");
}

/** What the baseline window sets for every later one. */
interface Reference {
  rms: number;
  clickThreshold: number;
}

/** One analyser read: the spectrum and the time-domain samples, taken together. */
function readTone(
  analyser: AnalyserNode,
  sampleRate: number,
  reference: Reference | null,
  minHz: number = 0,
): { tone: TonePurity; reference: Reference } {
  const bins = new Float32Array(analyser.frequencyBinCount);
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatFrequencyData(bins);
  analyser.getFloatTimeDomainData(samples);
  const ref = reference ?? { rms: rmsOf(samples), clickThreshold: clickThreshold(samples) };
  const dropouts = countDropouts(samples, DROPOUT_WINDOW, ref.rms);
  const clicks = countClicks(samples, ref.clickThreshold);
  return { tone: tonePurityFromSpectrum(bins, sampleRate, analyser.fftSize, dropouts, clicks, TONE_HZ, minHz), reference: ref };
}

/** The processor's `process()` calls so far, as last reported, and the worklet's Date.now() then. */
interface CallsReport {
  calls: number;
  at: number;
}

interface Live {
  context: AudioContext;
  analyser: AnalyserNode;
  tone: AudioWorkletNode;
  /** Every calls report so far, oldest first. */
  reports: CallsReport[];
  /** The worklet thread busy for `ms`; resolves when it answers. */
  stall: (ms: number) => Promise<void>;
}

async function loadModule(context: AudioContext, options: SuspendResumeOptions): Promise<void> {
  if (options.module === "file") {
    await withDeadline(context.audioWorklet.addModule(PROCESSOR_URL), DEADLINE_MS, "addModule");
    return;
  }
  const source = await withDeadline(fetch(PROCESSOR_URL).then((response) => response.text()), DEADLINE_MS, "fetch-module");
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await withDeadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule-blob");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function startLive(options: SuspendResumeOptions): Promise<Live> {
  const context = new AudioContext(options.rate === null ? { latencyHint: "interactive" } : { sampleRate: options.rate, latencyHint: "interactive" });
  try {
    await withDeadline(context.resume(), DEADLINE_MS, "resume");
    await loadModule(context, options);
    const analyser = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
    const output = new GainNode(context, { gain: options.witness === "mic" ? SPEAKER_GAIN : GRAPH_GAIN });
    const tone = new AudioWorkletNode(context, PROCESSOR_NAME, { processorOptions: { control: options.control } });
    const reports: CallsReport[] = [];
    let stalled: (() => void) | null = null;
    tone.port.onmessage = (event: MessageEvent<{ type: "calls"; calls: number; at: number } | { type: "stalled" }>) => {
      if (event.data.type === "calls") reports.push({ calls: event.data.calls, at: event.data.at });
      else if (stalled !== null) {
        const done = stalled;
        stalled = null;
        done();
      }
    };
    tone.connect(analyser).connect(output).connect(context.destination);
    const stall = (ms: number) =>
      withDeadline(
        new Promise<void>((resolve) => {
          stalled = resolve;
          tone.port.postMessage({ stall: ms });
        }),
        DEADLINE_MS,
        "stall",
      );
    return { context, analyser, tone, reports, stall };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Calls per second over the reports that arrived inside a window: the first and the last of
 * them, so no stretch before the window (a stall, a suspension) counts. Null with fewer than two.
 */
function callsPerSecond(inWindow: CallsReport[]): number | null {
  if (inWindow.length < 2) return null;
  const from = inWindow[0];
  const to = inWindow[inWindow.length - 1];
  return (to.calls - from.calls) / ((to.at - from.at) / 1000);
}

/** The microphone, in a context of its own that is never suspended, into an analyser and a recorder. */
interface Witness {
  context: AudioContext;
  analyser: AnalyserNode;
  stream: MediaStream;
  deviceLabel: string;
  settings: MediaTrackSettings;
  /** The witness context's time when the recorder was connected: the WAV's zero. */
  recordStart: number;
  /** Stops the recorder; resolves with everything it captured. */
  stop: () => Promise<Float32Array>;
}

async function openWitness(): Promise<Witness> {
  const stream = await withDeadline(
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
    30000,
    "getUserMedia",
  );
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    const track = stream.getAudioTracks()[0];
    if (track === undefined) throw new Error("no-audio-track");
    const settings = track.getSettings();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const listed = devices.find((device) => device.kind === "audioinput" && device.deviceId === settings.deviceId);
    await withDeadline(context.resume(), DEADLINE_MS, "witness-resume");
    const url = URL.createObjectURL(new Blob([RECORDER_SOURCE], { type: "text/javascript" }));
    try {
      await withDeadline(context.audioWorklet.addModule(url), DEADLINE_MS, "witness-addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = new MediaStreamAudioSourceNode(context, { mediaStream: stream });
    const analyser = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
    const recorder = new AudioWorkletNode(context, RECORDER_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
    });
    source.connect(analyser);
    source.connect(recorder);
    const recordStart = context.currentTime;
    const chunks: Float32Array[] = [];
    let finished: ((samples: Float32Array) => void) | null = null;
    recorder.port.onmessage = (event: MessageEvent<{ samples: Float32Array; final: boolean }>) => {
      chunks.push(event.data.samples);
      if (!event.data.final || finished === null) return;
      const all = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      finished(all);
    };
    const stop = () =>
      withDeadline(
        new Promise<Float32Array>((resolve) => {
          finished = resolve;
          recorder.port.postMessage("stop");
        }),
        DEADLINE_MS,
        "witness-stop",
      );
    return { context, analyser, stream, deviceLabel: listed?.label || track.label, settings, recordStart, stop };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    await context.close();
    throw error;
  }
}

/** Writes the capture to `.verify-output/` on the dev server; the file's name, or why there is none. */
async function saveWav(samples: Float32Array, sampleRate: number, runToken: string): Promise<{ name: string | null; error: string | null }> {
  const name = `chromium-suspend-resume-${runToken}.wav`;
  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return { name: null, error: "not-dev-server" };
  try {
    const body = WavFile.encodeFloats({ sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples });
    const put = await fetch("/__verify/" + name, { method: "PUT", body });
    return put.ok ? { name, error: null } : { name: null, error: `http-${put.status}` };
  } catch (error) {
    return { name: null, error: stepOf(error) };
  }
}

/** A verdict string from a judgement, with the cycle count when it could not judge. */
function verdictOf(tones: TonePurity[], baseline: TonePurity, failedStep: string | null): { word: string; judged: ReturnType<typeof judgeSuspendResume> } {
  const judged = judgeSuspendResume(baseline, tones, tones.length);
  const word =
    failedStep !== null && tones.length < MIN_CYCLES ? `NOT CHECKED ${failedStep}`
    : judged.verdict === "NOT CHECKED" ? `NOT CHECKED ${tones.length}-cycles`
    : judged.verdict;
  return { word, judged };
}

/** One measurement window: the clock, the render rate and both readings at its end. */
interface WindowReading {
  clock: ClockRatioSample;
  callsPerSecond: number | null;
  graph: TonePurity;
  mic: TonePurity | null;
}

/** What one cycle measured. */
interface CycleResult extends WindowReading {
  suspendMs: number;
  resumeMs: number;
  /** Where the resume resolved in the microphone's WAV, in seconds; null without the witness. */
  resumeAtWav: number | null;
}

/** Everything a run's cycles share. */
interface Rig {
  options: SuspendResumeOptions;
  live: Live;
  witness: Witness | null;
  graphReference: Reference;
  micReference: Reference | null;
  signal: AbortSignal;
}

/** Waits `ms` with the tone playing, then reads the window. */
async function measureWindow(rig: Rig, ms: number, graphReference: Reference | null, micReference: Reference | null): Promise<WindowReading & { graphRef: Reference; micRef: Reference | null }> {
  const { context } = rig.live;
  const contextStart = context.currentTime;
  const wallStart = performance.now();
  const reportsBefore = rig.live.reports.length;
  await wait(ms, rig.signal);
  const clock = { contextAdvanceSec: context.currentTime - contextStart, wallAdvanceSec: (performance.now() - wallStart) / 1000 };
  const graph = readTone(rig.live.analyser, context.sampleRate, graphReference);
  const mic = rig.witness === null ? null : readTone(rig.witness.analyser, rig.witness.context.sampleRate, micReference, MIC_MIN_HZ);
  return {
    clock,
    callsPerSecond: callsPerSecond(rig.live.reports.slice(reportsBefore)),
    graph: graph.tone,
    mic: mic === null ? null : mic.tone,
    graphRef: graph.reference,
    micRef: mic === null ? null : mic.reference,
  };
}

/** One cycle, as the repro page's click: stall, suspend, gap, resume; then the window. */
async function runCycle(rig: Rig, cycle: number, windowMs: number): Promise<CycleResult> {
  const { context } = rig.live;
  if (rig.options.stallMs > 0) await rig.live.stall(rig.options.stallMs);
  const t0 = performance.now();
  await withDeadline(context.suspend(), DEADLINE_MS, `suspend-${cycle}`);
  const t1 = performance.now();
  if (rig.options.gapMs > 0) await wait(rig.options.gapMs, rig.signal);
  const t2 = performance.now();
  await withDeadline(context.resume(), DEADLINE_MS, `resume-${cycle}`);
  const t3 = performance.now();
  if (context.state !== "running") throw new Error(`context-${context.state}-${cycle}`);
  const resumeAtWav = rig.witness === null ? null : rig.witness.context.currentTime - rig.witness.recordStart;
  if (rig.options.control !== null && cycle === CONTROL_FROM_CYCLE) rig.live.tone.port.postMessage({ control: true });
  const reading = await measureWindow(rig, windowMs, rig.graphReference, rig.micReference);
  return { ...reading, suspendMs: t1 - t0, resumeMs: t3 - t2, resumeAtWav };
}

/** The click: baseline, then the cycles (timed, or one per click in manual mode); judge. */
export async function runSuspendResumeProbe(signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  const options = suspendResumeOptionsFrom(new URLSearchParams(window.location.search));
  const platform = await platformOf(navigator as PlatformNavigator);
  const runToken = newRunToken();
  const envelope = (verdict: string, figures: Record<string, number | string | null>): ProbeEnvelope => ({
    issue: "suspend-resume",
    chrome: browserOf(navigator),
    date: runDate(),
    runToken,
    verdict,
    figures: {
      verdict,
      tracker: options.tracker ? "yes" : null,
      manual: options.manual ? "yes" : null,
      control: options.control === null ? null : `${options.control} from cycle ${CONTROL_FROM_CYCLE}`,
      witness: options.witness,
      paceMs: options.paceMs,
      cyclesRequested: options.manual ? null : options.cycles,
      stallMs: options.stallMs,
      gapMs: options.gapMs,
      rateRequested: options.rate,
      firstCycle: options.firstCycle ? "yes" : null,
      module: options.module,
      toneAmplitude: 0.2,
      outputGainDb: options.witness === "mic" ? -20 : -30,
      ...figures,
      os: osOf(navigator as OsNavigator),
      osVersion: platform.platformVersion,
      chromeFullVersion: platform.uaFullVersion,
      userAgent: platform.userAgent,
    },
  });

  let witness: Witness | null = null;
  if (options.witness === "mic") {
    report("open-mic");
    try {
      witness = await openWitness();
    } catch (error) {
      console.error("[chromium-watched] suspend-resume could not open the microphone: " + String(error));
      return envelope(`NOT CHECKED mic-${error instanceof Error ? error.name : "error"}-${stepOf(error)}`, {});
    }
  }
  report("start-audio");
  let live: Live | null = null;
  try {
    live = await startLive(options);
    const { context } = live;
    if (context.state !== "running") throw new Error(`the context is ${context.state} after resume`);
    if (options.firstCycle) {
      report("first-cycle");
      await withDeadline(context.suspend(), DEADLINE_MS, "first-suspend");
      await withDeadline(context.resume(), DEADLINE_MS, "first-resume");
    }
    report("measure-baseline");
    const partial: Rig = { options, live, witness, graphReference: { rms: 0, clickThreshold: 0 }, micReference: null, signal };
    const baseline = await measureWindow(partial, BASELINE_SECONDS * 1000, null, null);
    const rig: Rig = { ...partial, graphReference: baseline.graphRef, micReference: baseline.micRef };
    const results: CycleResult[] = [];
    let failedStep: string | null = null;
    const windowMs = options.paceMs > 0 ? options.paceMs : WINDOW_SECONDS * 1000;
    const attempt = async (cycle: number, ms: number): Promise<boolean> => {
      report(`cycle-${cycle}`);
      try {
        results.push(await runCycle(rig, cycle, ms));
        return true;
      } catch (error) {
        failedStep = stepOf(error);
        console.error("[chromium-watched] suspend-resume cycle " + cycle + " failed: " + String(error));
        return false;
      }
    };
    if (options.manual) {
      manualSession.start();
      try {
        for (let cycle = 1; ; cycle++) {
          report("awaiting-click");
          if ((await manualSession.nextAction()) === "finish") break;
          if (!(await attempt(cycle, WINDOW_SECONDS * 1000))) break;
          const last = results[results.length - 1];
          manualSession.addRow({
            cycle,
            graphPurityDb: purityOf(last.graph),
            micPurityDb: last.mic === null ? null : purityOf(last.mic),
            micClicks: last.mic === null ? null : last.mic.clicks,
            clockRatio: last.clock.contextAdvanceSec / last.clock.wallAdvanceSec,
          });
        }
      } finally {
        manualSession.end();
      }
    } else {
      for (let cycle = 1; cycle <= options.cycles; cycle++) if (!(await attempt(cycle, windowMs))) break;
    }
    report("judge");
    const graphTones = results.map((r) => r.graph);
    const micTones = results.flatMap((r) => (r.mic === null ? [] : [r.mic]));
    const graph = verdictOf(graphTones, baseline.graph, failedStep);
    const mic = baseline.mic === null ? null : verdictOf(micTones, baseline.mic, failedStep);
    const clock = judgeHalfRate(baseline.clock, results.map((r) => r.clock));
    const verdict = overallVerdict(graph.word, mic === null ? null : mic.word, clock.halfRate);
    let wav: { name: string | null; error: string | null } = { name: null, error: null };
    if (witness !== null) {
      report("save-wav");
      try {
        wav = await saveWav(await witness.stop(), witness.context.sampleRate, runToken);
      } catch (error) {
        wav = { name: null, error: stepOf(error) };
      }
    }
    const micFigures: Record<string, number | string | null> =
      witness === null || baseline.mic === null || baseline.micRef === null || mic === null ? {}
      : {
          micVerdict: mic.word,
          micPurityMinHz: MIC_MIN_HZ,
          micBaselinePurityDb: round(purityOf(baseline.mic), 2),
          micBaselineFundamentalDb: round(baseline.mic.fundamentalDb, 2),
          micBaselineHarmonicsDb: round(baseline.mic.harmonicsDb, 2),
          micBaselineClicks: baseline.mic.clicks,
          micClickThreshold: baseline.micRef.clickThreshold.toExponential(3),
          micPurityPerCycleDb: micTones.map((tone) => purityOf(tone).toFixed(2)).join(" "),
          micWorstPurityDb: round(mic.judged.worstPurityDb, 2),
          micWorstCycle: mic.judged.worstCycle === null ? null : mic.judged.worstCycle + 1,
          micClicksPerCycle: micTones.map((tone) => tone.clicks).join(" "),
          micWorstClicks: mic.judged.worstClicks,
          micDropoutsPerCycle: micTones.map((tone) => tone.dropouts).join(" "),
          micResumeAtWavSec: results.map((r) => (r.resumeAtWav === null ? "-" : r.resumeAtWav.toFixed(2))).join(" "),
          micDeviceLabel: witness.deviceLabel,
          micTrackSettings: JSON.stringify({
            sampleRate: witness.settings.sampleRate,
            channelCount: witness.settings.channelCount,
            echoCancellation: witness.settings.echoCancellation,
            noiseSuppression: witness.settings.noiseSuppression,
            autoGainControl: witness.settings.autoGainControl,
          }),
          micSampleRate: witness.context.sampleRate,
          wavName: wav.name,
          wavError: wav.error,
        };
    const calls = results.map((r) => r.callsPerSecond);
    return envelope(verdict, {
      verdictDetail:
        verdict === MIC_ONLY_VERDICT
          ? "only the microphone heard distortion: a candidate, not a reproduction (a sound in the room reads the same)"
          : null,
      clockVerdict: clock.halfRate ? "HALF RATE" : "TRUE",
      graphVerdict: graph.word,
      cycles: results.length,
      manualClicks: options.manual ? results.length : null,
      failedStep,
      // The context clock's advance over the wall clock's per window: 1 is true, the tracker's failure reads 0.5.
      ratioBefore: round(clock.ratioBefore, 4),
      clockRatioPerCycle: clock.ratios.map((ratio) => ratio.toFixed(3)).join(" "),
      clockRatioMin: round(clock.ratios.length === 0 ? null : Math.min(...clock.ratios), 4),
      firstHalfRateCycle: clock.firstHalfCycle === null ? null : clock.firstHalfCycle + 1,
      // The processor's process() calls per second of the worklet's Date.now(): sampleRate / 128 is true.
      callsPerSecondBefore: round(baseline.callsPerSecond, 1),
      callsPerSecondPerCycle: calls.map((c) => (c === null ? "-" : c.toFixed(1))).join(" "),
      callsPerSecondAfterMedian: round(median(calls.flatMap((c) => (c === null ? [] : [c]))), 1),
      baselinePurityDb: round(purityOf(baseline.graph), 2),
      baselineFundamentalDb: round(baseline.graph.fundamentalDb, 2),
      baselineHarmonicsDb: round(baseline.graph.harmonicsDb, 2),
      baselineDropouts: baseline.graph.dropouts,
      baselineRms: round(baseline.graphRef.rms, 4),
      baselineClicks: baseline.graph.clicks,
      clickThreshold: baseline.graphRef.clickThreshold.toExponential(3),
      // Cycles count from 1 in every figure.
      purityPerCycleDb: graphTones.map((tone) => purityOf(tone).toFixed(2)).join(" "),
      worstPurityDb: round(graph.judged.worstPurityDb, 2),
      worstCycle: graph.judged.worstCycle === null ? null : graph.judged.worstCycle + 1,
      dropoutsPerCycle: graphTones.map((tone) => tone.dropouts).join(" "),
      dropoutsAfter: graph.judged.dropoutsAfter,
      clicksPerCycle: graphTones.map((tone) => tone.clicks).join(" "),
      worstClicks: graph.judged.worstClicks,
      worstClicksCycle: graph.judged.worstClicksCycle === null ? null : graph.judged.worstClicksCycle + 1,
      ...micFigures,
      suspendMsMedian: round(median(results.map((r) => r.suspendMs)), 2),
      suspendMsMax: round(results.length === 0 ? null : Math.max(...results.map((r) => r.suspendMs)), 2),
      resumeMsMedian: round(median(results.map((r) => r.resumeMs)), 2),
      resumeMsMax: round(results.length === 0 ? null : Math.max(...results.map((r) => r.resumeMs)), 2),
      contextStateAfterLastResume: context.state,
      sampleRate: context.sampleRate,
      baseLatency: context.baseLatency,
      outputLatency: context.outputLatency,
    });
  } finally {
    if (witness !== null) {
      for (const track of witness.stream.getTracks()) track.stop();
      await witness.context.close();
    }
    if (live !== null) await live.context.close();
  }
}
