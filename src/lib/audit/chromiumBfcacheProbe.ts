/**
 * The browser half of the Chromium 575891839 probe (`?issue=bfcache`). The click starts a
 * running context with a sine the worklet processor renders itself and an OscillatorNode
 * control, each into its own analyser, and measures the context clock against the wall
 * clock for two seconds. The figures go to `sessionStorage`; the page then offers a link
 * away. Back again, one of two things happens:
 * - the page comes out of the back/forward cache (`pageshow` with `persisted`): the same
 *   context and nodes are still alive, the probe measures three more seconds and judges;
 * - the page was not cached and loads afresh: `judgeStoredBfcacheOnLoad` finds the stored
 *   figures, reads the navigation's `notRestoredReasons`, and judges `NOT CHECKED`. The
 *   promise of the first run never settles in that case; the new document carries the run.
 * The judgement is `chromiumBfcache.ts`.
 */

import { browserOf, newRunToken, runDate, type ProbeEnvelope } from "./chromiumWatched";
import { clockRatio, judgeBfcache, type BfcacheJudgement, type ClockRatioSample } from "./chromiumBfcache";

/** The step the page shows the "Navigate away" link on. */
export const AWAITING_NAVIGATION = "awaiting-navigation";

/** Where the link goes: a same-origin static page that only links back. */
export const BLANK_RETURN_URL = "/blank-return.html";

const STORAGE_KEY = "chromium-watched:bfcache";
const PROCESSOR_NAME = "chromium-bfcache-tone";
const WORKLET_HZ = 440;
const CONTROL_HZ = 660;
const BEFORE_SECONDS = 2;
const AFTER_SECONDS = 3;
const OUTPUT_GAIN = 0.02;
const FFT_SIZE = 32768;
const DEADLINE_MS = 5000;

/** The worklet's tone: a sine it renders from its own phase at the context rate. */
export const BFCACHE_PROCESSOR_SOURCE = `
class BfcacheTone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    const step = (2 * Math.PI * ${WORKLET_HZ}) / sampleRate;
    for (let i = 0; i < channels[0].length; i++) {
      const value = 0.5 * Math.sin(this.phase);
      this.phase += step;
      for (const channel of channels) channel[i] = value;
    }
    this.phase %= 2 * Math.PI;
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", BfcacheTone);
`;

/** Both tones' pitch as the analysers read them, in Hz. */
interface Pitches {
  control: number;
  worklet: number;
}

/** What the first document keeps for a later load to judge. */
interface StoredRun {
  runToken: string;
  chrome: string;
  date: string;
  before: ClockRatioSample;
  pitchBefore: Pitches;
  sampleRate: number;
  /** `Date.now()` when the baseline was stored: the time away is measured from here. */
  startedAt: number;
}

interface Live {
  context: AudioContext;
  controlAnalyser: AnalyserNode;
  workletAnalyser: AnalyserNode;
}

function deadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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

/** The context clock's and the wall clock's advance over `seconds` of wall time. */
async function measureClock(context: AudioContext, seconds: number, signal: AbortSignal): Promise<ClockRatioSample> {
  const contextStart = context.currentTime;
  const wallStart = performance.now();
  await wait(seconds * 1000, signal);
  return {
    contextAdvanceSec: context.currentTime - contextStart,
    wallAdvanceSec: (performance.now() - wallStart) / 1000,
  };
}

/** The loudest bin's frequency, refined by a parabola through it and its neighbours. */
function peakHz(analyser: AnalyserNode, sampleRate: number): number {
  const bins = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(bins);
  let peak = 1;
  for (let i = 2; i < bins.length - 1; i++) if (bins[i] > bins[peak]) peak = i;
  const [a, b, c] = [bins[peak - 1], bins[peak], bins[peak + 1]];
  const denominator = a - 2 * b + c;
  const offset = denominator === 0 ? 0 : (0.5 * (a - c)) / denominator;
  return ((peak + offset) * sampleRate) / analyser.fftSize;
}

function pitchesOf(live: Live): Pitches {
  const rate = live.context.sampleRate;
  return { control: peakHz(live.controlAnalyser, rate), worklet: peakHz(live.workletAnalyser, rate) };
}

async function startLive(): Promise<Live> {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await deadline(context.resume(), DEADLINE_MS, "resume");
    const url = URL.createObjectURL(new Blob([BFCACHE_PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await deadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const output = new GainNode(context, { gain: OUTPUT_GAIN });
    output.connect(context.destination);
    const analyser = () => new AnalyserNode(context, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 });
    const controlAnalyser = analyser();
    const workletAnalyser = analyser();
    const control = new OscillatorNode(context, { frequency: CONTROL_HZ });
    const tone = new AudioWorkletNode(context, PROCESSOR_NAME, { outputChannelCount: [1] });
    control.connect(controlAnalyser).connect(output);
    tone.connect(workletAnalyser).connect(output);
    control.start();
    return { context, controlAnalyser, workletAnalyser };
  } catch (error) {
    await context.close();
    throw error;
  }
}

function waitForRestore(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      window.removeEventListener("pageshow", onShow);
      resolve();
    };
    window.addEventListener("pageshow", onShow);
    signal.addEventListener("abort", () => {
      window.removeEventListener("pageshow", onShow);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function envelopeFrom(
  run: StoredRun,
  judged: BfcacheJudgement,
  verdict: string,
  extra: Record<string, number | string | null>
): ProbeEnvelope {
  const figures: Record<string, number | string | null> = {
    verdict,
    ratioBefore: round(judged.ratioBefore, 4),
    ratioAfter: round(judged.ratioAfter, 4),
    contextAdvanceBeforeSec: round(run.before.contextAdvanceSec, 4),
    wallAdvanceBeforeSec: round(run.before.wallAdvanceSec, 4),
    controlHzBefore: round(run.pitchBefore.control, 2),
    workletHzBefore: round(run.pitchBefore.worklet, 2),
    sampleRate: run.sampleRate,
    reason: judged.reason,
    ...extra,
  };
  return { issue: "bfcache", chrome: run.chrome, date: run.date, runToken: run.runToken, verdict, figures };
}

/** The click: baseline, store, wait for a restore from the cache, re-measure, judge. */
export async function runBfcacheProbe(signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  report("start-audio");
  const live = await startLive();
  try {
    if (live.context.state !== "running") throw new Error(`the context is ${live.context.state} after resume`);
    report("measure-before");
    const before = await measureClock(live.context, BEFORE_SECONDS, signal);
    const run: StoredRun = {
      runToken: newRunToken(),
      chrome: browserOf(navigator),
      date: runDate(),
      before,
      pitchBefore: pitchesOf(live),
      sampleRate: live.context.sampleRate,
      startedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    console.log("[chromium-watched] bfcache baseline ratio " + clockRatio(before).toFixed(4) + ", stored; awaiting navigation");
    report(AWAITING_NAVIGATION);
    await waitForRestore(signal);
    sessionStorage.removeItem(STORAGE_KEY);
    const stateAfterRestore = live.context.state;
    report("measure-after");
    const extra: Record<string, number | string | null> = {
      persisted: "true",
      notRestoredReasons: null,
      contextStateAfterRestore: stateAfterRestore,
    };
    if (stateAfterRestore !== "running") {
      const judged = judgeBfcache(before, null, true, null);
      return envelopeFrom(run, judged, `NOT CHECKED context-${stateAfterRestore}`, extra);
    }
    const after = await measureClock(live.context, AFTER_SECONDS, signal);
    const pitchAfter = pitchesOf(live);
    const judged = judgeBfcache(before, after, true, null);
    const verdict = judged.verdict === "NOT CHECKED" ? `NOT CHECKED ${judged.reason}` : judged.verdict;
    return envelopeFrom(run, judged, verdict, {
      ...extra,
      contextAdvanceAfterSec: round(after.contextAdvanceSec, 4),
      wallAdvanceAfterSec: round(after.wallAdvanceSec, 4),
      controlHzAfter: round(pitchAfter.control, 2),
      workletHzAfter: round(pitchAfter.worklet, 2),
      secondsAway: round((Date.now() - run.startedAt) / 1000, 1),
    });
  } finally {
    await live.context.close();
  }
}

/**
 * The navigation entry's not-restored reasons, serialized; null when this browser has no such
 * API or reports none (Chrome reports none when the cache is switched off, as Playwright's is).
 */
function notRestoredReasons(entry: PerformanceNavigationTiming | undefined): string | null {
  if (entry === undefined || !("notRestoredReasons" in entry)) return null;
  const reasons = (entry as { notRestoredReasons: unknown }).notRestoredReasons;
  return reasons === null || reasons === undefined ? null : JSON.stringify(reasons);
}

/**
 * On a fresh load: a baseline stored by an earlier document means the page was not
 * restored from the cache. Judges it `NOT CHECKED` with the reasons, and clears it.
 */
export function judgeStoredBfcacheOnLoad(): ProbeEnvelope | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  const run = JSON.parse(raw) as StoredRun;
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const reasons = notRestoredReasons(entry);
  const navigationType = entry?.type ?? null;
  const judged = judgeBfcache(run.before, null, false, reasons);
  const verdict = navigationType === "back_forward" ? "NOT CHECKED not-cached" : `NOT CHECKED not-back-forward-${navigationType}`;
  return envelopeFrom(run, judged, verdict, {
    persisted: "false",
    navigationType,
    notRestoredReasons: reasons,
    secondsAway: round((Date.now() - run.startedAt) / 1000, 1),
  });
}
