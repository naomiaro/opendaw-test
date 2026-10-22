/**
 * The browser half of the Chromium 560233271 probe (`?issue=suspend-resume`). The click
 * starts a running context with a 440 Hz sine the worklet processor renders itself, into an
 * analyser and on through a −30 dB gain to the destination. It reads the tone for a
 * two-second baseline, then runs `SUSPEND_RESUME_CYCLES` cycles of `suspend()` / `resume()`,
 * each raced against a deadline, with a one-second window after each resume. Every window
 * reads the analyser once at its end: the spectrum gives the tone's purity, the time-domain
 * samples (the last FFT_SIZE frames, all rendered after the resume) give the dropouts. The
 * judgement is `chromiumSuspendResume.ts`.
 */

import { withDeadline } from "@/lib/deadline";
import { browserOf, newRunToken, runDate, type ProbeEnvelope } from "./chromiumWatched";
import {
  MIN_CYCLES,
  TONE_HZ,
  countDropouts,
  judgeSuspendResume,
  purityOf,
  tonePurityFromSpectrum,
  type TonePurity,
} from "./chromiumSuspendResume";

export const SUSPEND_RESUME_CYCLES = 20;

const PROCESSOR_NAME = "chromium-suspend-resume-tone";
const BASELINE_SECONDS = 2;
const WINDOW_SECONDS = 1;
const OUTPUT_GAIN = 10 ** (-30 / 20);
const FFT_SIZE = 32768;
/** One render quantum: a zero-filled partial buffer shows as one window. */
const DROPOUT_WINDOW = 128;
const DEADLINE_MS = 5000;

/** The worklet's tone: a sine it renders from its own phase at the context rate. */
const PROCESSOR_SOURCE = `
class SuspendResumeTone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    const step = (2 * Math.PI * ${TONE_HZ}) / sampleRate;
    for (let i = 0; i < channels[0].length; i++) {
      const value = 0.5 * Math.sin(this.phase);
      this.phase += step;
      for (const channel of channels) channel[i] = value;
    }
    this.phase %= 2 * Math.PI;
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", SuspendResumeTone);
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

interface Live {
  context: AudioContext;
  analyser: AnalyserNode;
}

async function startLive(): Promise<Live> {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await withDeadline(context.resume(), DEADLINE_MS, "resume");
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await withDeadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const analyser = new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
    const output = new GainNode(context, { gain: OUTPUT_GAIN });
    const tone = new AudioWorkletNode(context, PROCESSOR_NAME, { outputChannelCount: [1] });
    tone.connect(analyser).connect(output).connect(context.destination);
    return { context, analyser };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** One analyser read: the spectrum and the time-domain samples, taken together. */
function readTone(live: Live, baselineRms: number | null): { tone: TonePurity; rms: number } {
  const bins = new Float32Array(live.analyser.frequencyBinCount);
  const samples = new Float32Array(live.analyser.fftSize);
  live.analyser.getFloatFrequencyData(bins);
  live.analyser.getFloatTimeDomainData(samples);
  const rms = rmsOf(samples);
  const dropouts = countDropouts(samples, DROPOUT_WINDOW, baselineRms ?? rms);
  return { tone: tonePurityFromSpectrum(bins, live.context.sampleRate, live.analyser.fftSize, dropouts), rms };
}

/** The click: baseline, then the cycles, each followed by a one-second window; judge. */
export async function runSuspendResumeProbe(signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  report("start-audio");
  const live = await startLive();
  try {
    if (live.context.state !== "running") throw new Error(`the context is ${live.context.state} after resume`);
    report("measure-baseline");
    await wait(BASELINE_SECONDS * 1000, signal);
    const base = readTone(live, null);
    const afterCycles: TonePurity[] = [];
    const suspendMs: number[] = [];
    const resumeMs: number[] = [];
    let failedStep: string | null = null;
    for (let cycle = 1; cycle <= SUSPEND_RESUME_CYCLES; cycle++) {
      report(`cycle-${cycle}`);
      try {
        const t0 = performance.now();
        await withDeadline(live.context.suspend(), DEADLINE_MS, `suspend-${cycle}`);
        const t1 = performance.now();
        await withDeadline(live.context.resume(), DEADLINE_MS, `resume-${cycle}`);
        const t2 = performance.now();
        if (live.context.state !== "running") throw new Error(`context-${live.context.state}-${cycle}`);
        suspendMs.push(t1 - t0);
        resumeMs.push(t2 - t1);
      } catch (error) {
        failedStep = String(error instanceof Error ? error.message : error).replace(/\s+/g, "-");
        console.error("[chromium-watched] suspend-resume cycle " + cycle + " failed: " + String(error));
        break;
      }
      await wait(WINDOW_SECONDS * 1000, signal);
      afterCycles.push(readTone(live, base.rms).tone);
    }
    const cycles = afterCycles.length;
    const judged = judgeSuspendResume(base.tone, afterCycles, cycles);
    const verdict =
      failedStep !== null && cycles < MIN_CYCLES ? `NOT CHECKED ${failedStep}`
      : judged.verdict === "NOT CHECKED" ? `NOT CHECKED ${cycles}-cycles`
      : judged.verdict;
    const figures: Record<string, number | string | null> = {
      verdict,
      cycles,
      failedStep,
      baselinePurityDb: round(purityOf(base.tone), 2),
      baselineFundamentalDb: round(base.tone.fundamentalDb, 2),
      baselineHarmonicsDb: round(base.tone.harmonicsDb, 2),
      baselineDropouts: base.tone.dropouts,
      baselineRms: round(base.rms, 4),
      // Cycles count from 1 in every figure.
      purityPerCycleDb: afterCycles.map((tone) => purityOf(tone).toFixed(2)).join(" "),
      worstPurityDb: round(judged.worstPurityDb, 2),
      worstCycle: judged.worstCycle === null ? null : judged.worstCycle + 1,
      dropoutsPerCycle: afterCycles.map((tone) => tone.dropouts).join(" "),
      dropoutsAfter: judged.dropoutsAfter,
      suspendMsMedian: round(median(suspendMs), 2),
      suspendMsMax: round(suspendMs.length === 0 ? null : Math.max(...suspendMs), 2),
      resumeMsMedian: round(median(resumeMs), 2),
      resumeMsMax: round(resumeMs.length === 0 ? null : Math.max(...resumeMs), 2),
      contextStateAfterLastResume: live.context.state,
      sampleRate: live.context.sampleRate,
      os: osOf(navigator as OsNavigator),
    };
    return { issue: "suspend-resume", chrome: browserOf(navigator), date: runDate(), runToken: newRunToken(), verdict, figures };
  } finally {
    await live.context.close();
  }
}
