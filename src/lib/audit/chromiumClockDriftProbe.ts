/**
 * The browser half of the clock-drift probe (`?issue=clock-drift`): a running context with the
 * bfcache probe's steady graph (a worklet tone and an oscillator into a quiet gain), the pair
 * `getOutputTimestamp()` plus `outputLatency` read on a WORKER tick every 10 ms (frames stop on a
 * hidden page), through four phases of `&seconds` each: `idle`; `jank` (an 80 ms synchronous block
 * every 500 ms); `graph` (an unrelated gain pair connected and disconnected every 50 ms, the
 * 442866743 condition); `load` (with `&load=<percent>`, a worklet that burns that share of every render
 * quantum, connected for the phase only: the render thread busy like an engine's); `hidden` (the page asks the operator to hide Chrome by hand, samples while
 * hidden, asks them back, samples ten more seconds visible; the waits for the hand are labelled `await`
 * and `returned`, not conditions). A tab playing audio is not throttled by Chrome when hidden, so the
 * hidden phase is a condition to compare, not a control. The judgement is `chromiumClockDrift.ts`.
 */
import { createWorkerTicker } from "@/lib/workerTicker";
import { BFCACHE_PROCESSOR_SOURCE } from "./chromiumBfcacheProbe";
import {
  CLOCK_DRIFT_PHASES, judgeClockDrift, summarisePhases, type ClockDriftPhase, type ClockSample, type PhaseSummary,
} from "./chromiumClockDrift";
import { browserOf, makeEnvelope, newRunToken, notChecked, runDate, type Figures, type ProbeEnvelope, type Verdict } from "./chromiumWatched";

export const AWAITING_HIDE = "awaiting-hide";
export const AWAITING_RETURN = "awaiting-return";

export interface ClockDriftOptions {
  /** 44100 or 48000; the context's rate. */
  rate: 44100 | 48000;
  /** Seconds per phase, 5–120. */
  seconds: number;
  /** Run the hidden phase (needs a hand on the window). */
  hidden: boolean;
  /** The `load` phase: a worklet that burns this share of every render quantum, 0 (phase skipped) to 90 percent. */
  loadPercent: number;
}

/** `&rate=`, `&seconds=`, `&hidden=`; a bad value is refused, naming it. */
export function clockDriftOptionsFrom(params: URLSearchParams): ClockDriftOptions {
  const rateRaw = params.get("rate") ?? "44100";
  if (rateRaw !== "44100" && rateRaw !== "48000") throw new Error(`&rate=${rateRaw}: expected 44100 or 48000`);
  const secondsRaw = params.get("seconds") ?? "20";
  const seconds = Number(secondsRaw);
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) throw new Error(`&seconds=${secondsRaw}: expected an integer 5–120`);
  const hiddenRaw = params.get("hidden") ?? "1";
  if (hiddenRaw !== "1" && hiddenRaw !== "0") throw new Error(`&hidden=${hiddenRaw}: expected 1 or 0`);
  const loadRaw = params.get("load") ?? "0";
  const loadPercent = Number(loadRaw);
  if (!Number.isInteger(loadPercent) || loadPercent < 0 || loadPercent > 90) throw new Error(`&load=${loadRaw}: expected an integer 0–90 (percent of each render quantum)`);
  return { rate: rateRaw === "48000" ? 48000 : 44100, seconds, hidden: hiddenRaw === "1", loadPercent };
}

const LOAD_PROCESSOR_NAME = "chromium-clock-drift-load";

/**
 * The load: a processor that burns `loadPercent` of each render quantum's wall time in a busy loop, silent output.
 * It calibrates its loop against `Date.now()` once (the worklet scope has no `performance`), so the share is
 * approximate; the point is a render thread that is busy, like an engine's, not an exact figure.
 */
export const LOAD_PROCESSOR_SOURCE = `
class ClockDriftLoad extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const share = (options && options.processorOptions && options.processorOptions.loadPercent) || 0;
    this.targetMs = (128 / sampleRate) * 1000 * share / 100;
    let ops = 0;
    const start = Date.now();
    let x = 0.5;
    while (Date.now() - start < 50) { for (let i = 0; i < 1000; i++) x = Math.sin(x) + 0.1; ops += 1000; }
    this.opsPerMs = ops / Math.max(1, Date.now() - start);
    this.x = x;
  }
  process(_inputs, outputs) {
    const ops = Math.floor(this.opsPerMs * this.targetMs);
    let x = this.x;
    for (let i = 0; i < ops; i++) x = Math.sin(x) + 0.1;
    this.x = x;
    for (const channel of outputs[0]) channel.fill(0);
    return true;
  }
}
registerProcessor("${LOAD_PROCESSOR_NAME}", ClockDriftLoad);
`;

const PROCESSOR_NAME = "chromium-bfcache-tone";
const TICK_MS = 10;
const JANK_MS = 80;
const JANK_PERIOD_MS = 500;
const GRAPH_PERIOD_MS = 50;
const RETURN_SECONDS = 10;
const HIDE_WAIT_MS = 120_000;
const DEADLINE_MS = 5000;

interface Live {
  context: AudioContext;
  churnSource: GainNode;
  /** The load worklet, made when `loadPercent` > 0 and connected for the `load` phase only. */
  load: AudioWorkletNode | null;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
}

function deadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function startLive(rate: number, loadPercent: number): Promise<Live> {
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: rate });
  try {
    await deadline(context.resume(), DEADLINE_MS, "resume");
    const url = URL.createObjectURL(new Blob([BFCACHE_PROCESSOR_SOURCE + LOAD_PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await deadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const output = new GainNode(context, { gain: 0.02 });
    output.connect(context.destination);
    const control = new OscillatorNode(context, { frequency: 660 });
    const tone = new AudioWorkletNode(context, PROCESSOR_NAME, { outputChannelCount: [1] });
    control.connect(output);
    tone.connect(output);
    control.start();
    // The churn source: silent, so connecting and disconnecting it changes the graph and nothing audible.
    const churnSource = new GainNode(context, { gain: 0 });
    control.connect(churnSource);
    const load = loadPercent > 0 ? new AudioWorkletNode(context, LOAD_PROCESSOR_NAME, { outputChannelCount: [1], processorOptions: { loadPercent } }) : null;
    return { context, churnSource, load };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Waits for the document to reach `state`, through `visibilitychange`; resolves at once when it is there already. */
function waitForVisibility(state: DocumentVisibilityState, ms: number, signal: AbortSignal): Promise<void> {
  if (document.visibilityState === state) return Promise.resolve();
  return deadline(new Promise<void>((resolve, reject) => {
    const onChange = (): void => {
      if (document.visibilityState !== state) return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
    signal.addEventListener("abort", () => { document.removeEventListener("visibilitychange", onChange); reject(new Error("aborted")); }, { once: true });
  }), ms, `visibility ${state}`);
}

function phaseFigures(phases: readonly PhaseSummary[]): Figures {
  const figures: Figures = {};
  for (const p of phases) {
    figures[`${p.phase}Samples`] = p.samples;
    figures[`${p.phase}HiddenSamples`] = p.hiddenSamples;
    figures[`${p.phase}OffsetFramesMinMax`] = `${p.minOffsetFrames.toFixed(1)}..${p.maxOffsetFrames.toFixed(1)}`;
    figures[`${p.phase}Steps`] = p.steps.length === 0 ? "none" : p.steps.map((s) => `${Math.round(s.frames)}@${(s.atMs / 1000).toFixed(2)}s`).join(" ");
    figures[`${p.phase}OnLattice`] = `${p.lattice.onLattice}/${p.steps.length}`;
    figures[`${p.phase}RampFramesPerSec`] = p.rampFramesPerSec === null ? null : Number(p.rampFramesPerSec.toFixed(2));
    figures[`${p.phase}OutputLatencyMs`] = p.outputLatenciesMs.map((v) => v.toFixed(2)).join(" ");
  }
  return figures;
}

/** The output device's native rate: a context made with no rate hint takes it. */
async function deviceRateHz(): Promise<number> {
  const probe = new AudioContext();
  const rate = probe.sampleRate;
  await probe.close();
  return rate;
}

export async function runClockDriftProbe(signal: AbortSignal, report: (step: string) => void, options: ClockDriftOptions): Promise<ProbeEnvelope> {
  const head = { issue: "clock-drift" as const, chrome: browserOf(navigator), date: runDate(), runToken: newRunToken() };
  report("device-rate");
  const deviceRate = await deviceRateHz();
  report("start-audio");
  const live = await startLive(options.rate, options.loadPercent);
  const samples: ClockSample[] = [];
  const frameStamps: number[] = [];
  let phase: ClockDriftPhase = "idle";
  const ticker = createWorkerTicker(TICK_MS);
  const sub = ticker.subscribe(() => {
    const raw = live.context.getOutputTimestamp();
    if (raw.contextTime === undefined || raw.performanceTime === undefined) return;
    samples.push({
      perfMs: performance.now(),
      contextTime: raw.contextTime,
      performanceTime: raw.performanceTime,
      outputLatencyMs: live.context.outputLatency * 1000,
      visibility: document.visibilityState === "hidden" ? "hidden" : "visible",
      phase,
    });
  });
  let frameSub = 0;
  const onFrame = (): void => { frameStamps.push(performance.now()); frameSub = requestAnimationFrame(onFrame); };
  frameSub = requestAnimationFrame(onFrame);
  const phaseMs = options.seconds * 1000;
  let hideWaitMs: number | null = null;
  let returnWaitMs: number | null = null;
  let contextStateAtEnd = "unknown";
  try {
    if (live.context.state !== "running") throw new Error(`the context is ${live.context.state} after resume`);
    report("idle");
    phase = "idle";
    await wait(phaseMs, signal);

    report("jank");
    phase = "jank";
    const jankEnd = performance.now() + phaseMs;
    while (performance.now() < jankEnd) {
      await wait(Math.max(0, Math.min(JANK_PERIOD_MS, jankEnd - performance.now())), signal);
      if (performance.now() >= jankEnd) break;
      const until = performance.now() + JANK_MS;
      while (performance.now() < until) { /* spin */ }
    }

    report("graph");
    phase = "graph";
    const graphEnd = performance.now() + phaseMs;
    let connected = false;
    while (performance.now() < graphEnd) {
      await wait(GRAPH_PERIOD_MS, signal);
      if (connected) live.churnSource.disconnect(live.context.destination);
      else live.churnSource.connect(live.context.destination);
      connected = !connected;
    }
    if (connected) live.churnSource.disconnect(live.context.destination);

    if (live.load !== null) {
      // A worklet node is pulled only while it reaches the destination: the load runs for this phase alone.
      report("load");
      phase = "load";
      live.load.connect(live.context.destination);
      try {
        await wait(phaseMs, signal);
      } finally {
        live.load.disconnect(live.context.destination);
      }
    }

    if (options.hidden) {
      report(AWAITING_HIDE);
      phase = "await";
      const askedAt = performance.now();
      await waitForVisibility("hidden", HIDE_WAIT_MS, signal);
      hideWaitMs = performance.now() - askedAt;
      phase = "hidden";
      report("hidden");
      await wait(phaseMs, signal);
      report(AWAITING_RETURN);
      const askedBackAt = performance.now();
      await waitForVisibility("visible", HIDE_WAIT_MS, signal);
      returnWaitMs = performance.now() - askedBackAt;
      phase = "returned";
      report("returned");
      await wait(RETURN_SECONDS * 1000, signal);
    }
    report("judge");
  } finally {
    sub.terminate();
    ticker.terminate();
    cancelAnimationFrame(frameSub);
    // The state the run ENDED in: a context that stopped running partway (a device change, an interruption) freezes the pair.
    contextStateAtEnd = live.context.state;
    try {
      await deadline(live.context.close(), DEADLINE_MS, "close");
    } catch (closeError) {
      console.warn(`[chromium-watched] clock-drift: the context did not close: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
    }
  }
  const phases = summarisePhases(samples, options.rate);
  const judged = judgeClockDrift(phases, { hiddenRequested: options.hidden, contextState: contextStateAtEnd });
  const verdict: Verdict = judged.verdict === "STEPS" || judged.verdict === "STEADY" ? judged.verdict : notChecked(judged.verdict.replace(/^NOT CHECKED /, ""));
  const frameGaps = frameStamps.slice(1).map((t, i) => t - frameStamps[i]);
  return makeEnvelope(head, verdict, {
    reason: judged.reason,
    steppedPhases: judged.steppedPhases.join(" ") || "none",
    totalSteps: judged.totalSteps,
    onLattice: `${judged.lattice.onLattice}/${judged.totalSteps}`,
    sampleRate: options.rate,
    loadPercent: options.loadPercent,
    deviceRateHz: deviceRate,
    resampled: deviceRate === options.rate ? "false" : "true",
    secondsPerPhase: options.seconds,
    tickMs: TICK_MS,
    phasesRun: CLOCK_DRIFT_PHASES.filter((p) => phases.some((s) => s.phase === p)).join(" "),
    samples: samples.length,
    hideWaitMs: hideWaitMs === null ? null : Math.round(hideWaitMs),
    returnWaitMs: returnWaitMs === null ? null : Math.round(returnWaitMs),
    frameGapMaxMs: frameGaps.length === 0 ? null : Math.round(Math.max(...frameGaps)),
    contextStateAtEnd,
    ...phaseFigures(phases),
  });
}
