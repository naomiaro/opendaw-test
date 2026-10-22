/**
 * The browser half of the Chromium 560233271 probe (`?issue=suspend-resume`). The click starts a
 * running context with a 440 Hz sine the worklet processor renders itself
 * (`public/chromium-suspend-resume-tone.js`, loaded from the file: the tracker's reduced case
 * did not reproduce from a Blob URL), into an analyser and on through a gain to the destination
 * (−30 dB, or −20 dB with the microphone witness). It reads the tone for a two-second baseline,
 * then runs the cycles of `suspend()` / `resume()`, each raced against a deadline, and reads a
 * window at the end of the wait after each resume. Every window reads the analyser once: the
 * spectrum gives the tone's purity, the time-domain samples the dropouts and the clicks. Each
 * wait also measures the context clock against the wall clock: the tracker's trace shows the
 * failure as one render quantum per 256-frame callback, half the render rate.
 *
 * With `&witness=mic` the microphone, captured in a second context that is never suspended, is
 * read the same way and judged against its own baseline window, and the whole capture is saved
 * as a WAV beside the envelope. The options are `chromiumSuspendResumeOptions.ts`; the judgement
 * is `chromiumSuspendResume.ts`.
 */

import { WavFile } from "@opendaw/lib-dsp";
import { withDeadline } from "@/lib/deadline";
import { browserOf, newRunToken, platformOf, runDate, type PlatformNavigator, type ProbeEnvelope } from "./chromiumWatched";
import {
  MIN_CYCLES,
  TONE_HZ,
  clickThreshold,
  countClicks,
  countDropouts,
  judgeSuspendResume,
  purityOf,
  tonePurityFromSpectrum,
  type TonePurity,
} from "./chromiumSuspendResume";
import {
  CONTROL_FROM_CYCLE,
  TRACKER_BLOCK_MS,
  TRACKER_SAMPLE_RATE,
  overallVerdict,
  suspendResumeOptionsFrom,
  type SuspendResumeOptions,
} from "./chromiumSuspendResumeOptions";

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

interface Live {
  context: AudioContext;
  analyser: AnalyserNode;
  tone: AudioWorkletNode;
}

async function startLive(options: SuspendResumeOptions): Promise<Live> {
  const context = new AudioContext(
    options.repro === "tracker" ? { sampleRate: TRACKER_SAMPLE_RATE, latencyHint: "interactive" } : { latencyHint: "interactive" },
  );
  try {
    await withDeadline(context.resume(), DEADLINE_MS, "resume");
    await withDeadline(context.audioWorklet.addModule(PROCESSOR_URL), DEADLINE_MS, "addModule");
    const analyser = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
    const output = new GainNode(context, { gain: options.witness === "mic" ? SPEAKER_GAIN : GRAPH_GAIN });
    const tone = new AudioWorkletNode(context, PROCESSOR_NAME, {
      outputChannelCount: [1],
      processorOptions: { control: options.control },
    });
    tone.connect(analyser).connect(output).connect(context.destination);
    return { context, analyser, tone };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The tracker's long task: the worklet thread busy for `ms`, awaited before the cycle. */
function blockWorklet(tone: AudioWorkletNode, ms: number): Promise<void> {
  return withDeadline(
    new Promise<void>((resolve) => {
      tone.port.onmessage = () => resolve();
      tone.port.postMessage({ block: ms });
    }),
    DEADLINE_MS,
    "block",
  );
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

/** The click: baseline, then the cycles, each followed by a window read at the end of its wait; judge. */
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
      control: options.control === null ? null : `${options.control} from cycle ${CONTROL_FROM_CYCLE}`,
      witness: options.witness,
      paceMs: options.paceMs,
      cyclesRequested: options.cycles,
      repro: options.repro === null ? null : `${options.repro}: ${TRACKER_SAMPLE_RATE} Hz requested, one restart, ${TRACKER_BLOCK_MS} ms worklet task per cycle`,
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
    if (options.repro === "tracker") {
      report("initial-restart");
      await withDeadline(context.suspend(), DEADLINE_MS, "initial-suspend");
      await withDeadline(context.resume(), DEADLINE_MS, "initial-resume");
    }
    report("measure-baseline");
    const baselineContext = context.currentTime;
    const baselineWall = performance.now();
    await wait(BASELINE_SECONDS * 1000, signal);
    const baselineClockRatio = (context.currentTime - baselineContext) / ((performance.now() - baselineWall) / 1000);
    const graphBase = readTone(live.analyser, context.sampleRate, null);
    const micBase = witness === null ? null : readTone(witness.analyser, witness.context.sampleRate, null, MIC_MIN_HZ);
    const graphTones: TonePurity[] = [];
    const micTones: TonePurity[] = [];
    const clockRatios: number[] = [];
    const suspendMs: number[] = [];
    const resumeMs: number[] = [];
    /** Where each resume resolved in the microphone's WAV, in seconds (the witness context's clock, about one quantum coarse). */
    const resumeAtWav: number[] = [];
    const waitMs = options.paceMs > 0 ? options.paceMs : WINDOW_SECONDS * 1000;
    let failedStep: string | null = null;
    for (let cycle = 1; cycle <= options.cycles; cycle++) {
      report(`cycle-${cycle}`);
      try {
        if (options.repro === "tracker") await blockWorklet(live.tone, TRACKER_BLOCK_MS);
        const t0 = performance.now();
        await withDeadline(context.suspend(), DEADLINE_MS, `suspend-${cycle}`);
        const t1 = performance.now();
        await withDeadline(context.resume(), DEADLINE_MS, `resume-${cycle}`);
        const t2 = performance.now();
        if (context.state !== "running") throw new Error(`context-${context.state}-${cycle}`);
        suspendMs.push(t1 - t0);
        resumeMs.push(t2 - t1);
        if (witness !== null) resumeAtWav.push(witness.context.currentTime - witness.recordStart);
        if (options.control !== null && cycle === CONTROL_FROM_CYCLE) live.tone.port.postMessage({ control: true });
      } catch (error) {
        failedStep = stepOf(error);
        console.error("[chromium-watched] suspend-resume cycle " + cycle + " failed: " + String(error));
        break;
      }
      const contextStart = context.currentTime;
      const wallStart = performance.now();
      await wait(waitMs, signal);
      clockRatios.push((context.currentTime - contextStart) / ((performance.now() - wallStart) / 1000));
      graphTones.push(readTone(live.analyser, context.sampleRate, graphBase.reference).tone);
      if (witness !== null && micBase !== null) micTones.push(readTone(witness.analyser, witness.context.sampleRate, micBase.reference, MIC_MIN_HZ).tone);
    }
    report("judge");
    const graph = verdictOf(graphTones, graphBase.tone, failedStep);
    const mic = micBase === null ? null : verdictOf(micTones, micBase.tone, failedStep);
    const verdict = overallVerdict(graph.word, mic === null ? null : mic.word);
    let wav: { name: string | null; error: string | null } = { name: null, error: null };
    if (witness !== null) {
      report("save-wav");
      try {
        wav = await saveWav(await witness.stop(), witness.context.sampleRate, runToken);
      } catch (error) {
        wav = { name: null, error: stepOf(error) };
      }
    }
    const minRatio = clockRatios.length === 0 ? null : Math.min(...clockRatios);
    const micFigures: Record<string, number | string | null> =
      witness === null || micBase === null || mic === null ? {}
      : {
          micVerdict: mic.word,
          micPurityMinHz: MIC_MIN_HZ,
          micBaselinePurityDb: round(purityOf(micBase.tone), 2),
          micBaselineFundamentalDb: round(micBase.tone.fundamentalDb, 2),
          micBaselineHarmonicsDb: round(micBase.tone.harmonicsDb, 2),
          micBaselineClicks: micBase.tone.clicks,
          micClickThreshold: micBase.reference.clickThreshold.toExponential(3),
          micPurityPerCycleDb: micTones.map((tone) => purityOf(tone).toFixed(2)).join(" "),
          micWorstPurityDb: round(mic.judged.worstPurityDb, 2),
          micWorstCycle: mic.judged.worstCycle === null ? null : mic.judged.worstCycle + 1,
          micClicksPerCycle: micTones.map((tone) => tone.clicks).join(" "),
          micWorstClicks: mic.judged.worstClicks,
          micDropoutsPerCycle: micTones.map((tone) => tone.dropouts).join(" "),
          micResumeAtWavSec: resumeAtWav.map((at) => at.toFixed(2)).join(" "),
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
    return envelope(verdict, {
      graphVerdict: graph.word,
      cycles: graphTones.length,
      failedStep,
      baselinePurityDb: round(purityOf(graphBase.tone), 2),
      baselineFundamentalDb: round(graphBase.tone.fundamentalDb, 2),
      baselineHarmonicsDb: round(graphBase.tone.harmonicsDb, 2),
      baselineDropouts: graphBase.tone.dropouts,
      baselineRms: round(graphBase.reference.rms, 4),
      baselineClicks: graphBase.tone.clicks,
      clickThreshold: graphBase.reference.clickThreshold.toExponential(3),
      // Cycles count from 1 in every figure.
      purityPerCycleDb: graphTones.map((tone) => purityOf(tone).toFixed(2)).join(" "),
      worstPurityDb: round(graph.judged.worstPurityDb, 2),
      worstCycle: graph.judged.worstCycle === null ? null : graph.judged.worstCycle + 1,
      dropoutsPerCycle: graphTones.map((tone) => tone.dropouts).join(" "),
      dropoutsAfter: graph.judged.dropoutsAfter,
      clicksPerCycle: graphTones.map((tone) => tone.clicks).join(" "),
      worstClicks: graph.judged.worstClicks,
      worstClicksCycle: graph.judged.worstClicksCycle === null ? null : graph.judged.worstClicksCycle + 1,
      // The context clock's advance over the wall clock's in each wait: 1 is true, the tracker's failure reads 0.5.
      baselineClockRatio: round(baselineClockRatio, 4),
      clockRatioPerCycle: clockRatios.map((ratio) => ratio.toFixed(3)).join(" "),
      clockRatioMin: round(minRatio, 4),
      ...micFigures,
      suspendMsMedian: round(median(suspendMs), 2),
      suspendMsMax: round(suspendMs.length === 0 ? null : Math.max(...suspendMs), 2),
      resumeMsMedian: round(median(resumeMs), 2),
      resumeMsMax: round(resumeMs.length === 0 ? null : Math.max(...resumeMs), 2),
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
