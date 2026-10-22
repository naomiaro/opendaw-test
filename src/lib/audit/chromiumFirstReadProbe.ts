/**
 * The browser half of the Chromium 571344687 probe (`?issue=first-read`): builds a worklet
 * node right after `addModule()` resolves and has its processor report `currentFrame` from
 * its constructor and first three `process()` calls. Each run gets a fresh AudioContext:
 * the issue's window opens when a context's worklet global scope is first made, which
 * happens once per context. The judgement is `chromiumFirstRead.ts`.
 */

import { browserOf, newRunToken, runDate, type ProbeEnvelope } from "./chromiumWatched";
import { FIRST_READ_QUANTUM, judgeFirstRead, type FirstReadSample, type FirstReadVerdict } from "./chromiumFirstRead";

/** What is loaded before the probe module: nothing, a module that is slow to evaluate, one that is slow to parse. */
export type FirstReadVariant = "none" | "large" | "slow";

export const FIRST_READ_VARIANTS: readonly FirstReadVariant[] = ["none", "large", "slow"];

export const FIRST_READ_RUNS_PER_VARIANT = 5;

const PROCESSOR_NAME = "chromium-first-read-probe";

/** The probe processor: posts the constructor's and the first three calls' `currentFrame`, then stops. */
export const FIRST_READ_PROCESSOR_SOURCE = `
class FirstReadProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.constructorFrame = currentFrame;
    this.processFrames = [];
  }
  process() {
    this.processFrames.push(currentFrame);
    if (this.processFrames.length < 3) return true;
    this.port.postMessage({ constructorFrame: this.constructorFrame, processFrames: this.processFrames });
    return false;
  }
}
registerProcessor("${PROCESSOR_NAME}", FirstReadProbe);
`;

/** A module whose top level busy-waits: slow to evaluate. */
export const SLOW_MODULE_MS = 100;
export const SLOW_MODULE_SOURCE = `const start = Date.now(); while (Date.now() - start < ${SLOW_MODULE_MS}) {}`;

/** A module of many small exported functions: slow to parse. */
export const LARGE_MODULE_FUNCTIONS = 12000;
export function largeModuleSource(functions: number = LARGE_MODULE_FUNCTIONS): string {
  return Array.from({ length: functions }, (_, i) => `export function f${i}(x) { return x + ${i}; }`).join("\n");
}

/** How long the context runs before the module load starts, so the clock is well past zero. */
const SETTLE_SECONDS = 0.3;
const RUN_DEADLINE_MS = 5000;

function blobUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

class NotRunning extends Error {}

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

async function waitUntilClockPast(context: AudioContext, seconds: number): Promise<void> {
  const start = performance.now();
  while (context.currentTime < seconds) {
    if (performance.now() - start > RUN_DEADLINE_MS) {
      throw new Error(`the context clock read ${context.currentTime.toFixed(3)} s after ${RUN_DEADLINE_MS} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface RunResult {
  sample: FirstReadSample;
  /** How long the variant module's `addModule()` took on the main thread. */
  variantLoadMs: number;
  sampleRate: number;
}

/** One run: a fresh running context, the variant module, the probe module, the node at once. */
async function runOnce(variantUrl: string | null, processorUrl: string): Promise<RunResult> {
  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    await deadline(context.resume(), RUN_DEADLINE_MS, "resume");
    if (context.state !== "running") throw new NotRunning(`state ${context.state}`);
    await waitUntilClockPast(context, SETTLE_SECONDS);
    const loadStart = performance.now();
    if (variantUrl !== null) await deadline(context.audioWorklet.addModule(variantUrl), RUN_DEADLINE_MS, "variant addModule");
    const variantLoadMs = performance.now() - loadStart;
    await deadline(context.audioWorklet.addModule(processorUrl), RUN_DEADLINE_MS, "probe addModule");
    if (context.state !== "running") throw new NotRunning(`state ${context.state}`);
    const creationFrame = Math.round(context.currentTime * context.sampleRate);
    const node = new AudioWorkletNode(context, PROCESSOR_NAME);
    const reads = new Promise<{ constructorFrame: number; processFrames: number[] }>((resolve) => {
      node.port.onmessage = (event) => resolve(event.data);
    });
    node.connect(context.destination);
    const { constructorFrame, processFrames } = await deadline(reads, RUN_DEADLINE_MS, "processor reads");
    node.disconnect();
    return {
      sample: { creationFrame, constructorFrame, processFrames: [processFrames[0], processFrames[1], processFrames[2]] },
      variantLoadMs,
      sampleRate: context.sampleRate,
    };
  } finally {
    await context.close();
  }
}

function joined(values: number[], digits: number): string {
  return values.map((value) => value.toFixed(digits)).join(" ");
}

/** Five runs of each variant, interleaved, each in a fresh running context; the envelope judges each variant and the whole. */
export async function runFirstReadProbe(signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  const processorUrl = blobUrl(FIRST_READ_PROCESSOR_SOURCE);
  const variantUrls: Record<FirstReadVariant, string | null> = {
    none: null,
    large: blobUrl(largeModuleSource()),
    slow: blobUrl(SLOW_MODULE_SOURCE),
  };
  const results: Record<FirstReadVariant, RunResult[]> = { none: [], large: [], slow: [] };
  let sampleRate: number | null = null;
  let notRunning: string | null = null;
  try {
    for (let run = 0; run < FIRST_READ_RUNS_PER_VARIANT && notRunning === null; run++) {
      for (const variant of FIRST_READ_VARIANTS) {
        if (signal.aborted) throw new Error("aborted");
        report(`${variant} ${run + 1}/${FIRST_READ_RUNS_PER_VARIANT}`);
        try {
          const result = await runOnce(variantUrls[variant], processorUrl);
          sampleRate = result.sampleRate;
          results[variant].push(result);
        } catch (error) {
          if (!(error instanceof NotRunning)) throw error;
          notRunning = error.message;
          break;
        }
      }
    }
  } finally {
    for (const url of [processorUrl, variantUrls.large, variantUrls.slow]) if (url !== null) URL.revokeObjectURL(url);
  }

  const figures: Record<string, number | string | null> = {
    sampleRate,
    quantum: FIRST_READ_QUANTUM,
    runsPerVariant: FIRST_READ_RUNS_PER_VARIANT,
  };
  const verdicts: FirstReadVerdict[] = [];
  for (const variant of FIRST_READ_VARIANTS) {
    const samples = results[variant].map((result) => result.sample);
    const judged = judgeFirstRead(samples);
    verdicts.push(judged.verdict);
    const msPerQuantum = sampleRate === null ? null : (FIRST_READ_QUANTUM / sampleRate) * 1000;
    const lags = samples.map((s) => (s.creationFrame - s.constructorFrame) / FIRST_READ_QUANTUM);
    figures[`${variant}.verdict`] = judged.verdict;
    figures[`${variant}.staleRuns`] = judged.staleRuns;
    figures[`${variant}.largestLagQuanta`] = Number(judged.largestLagQuanta.toFixed(2));
    figures[`${variant}.largestLagMs`] =
      msPerQuantum === null ? null : Number((judged.largestLagQuanta * msPerQuantum).toFixed(1));
    figures[`${variant}.lagsQuanta`] = joined(lags, 2);
    figures[`${variant}.jumpQuanta`] = joined(judged.jumpQuanta, 2);
    figures[`${variant}.loadMs`] = joined(results[variant].map((result) => result.variantLoadMs), 1);
  }

  const verdict =
    notRunning !== null ? "NOT CHECKED context-not-running"
    : verdicts.includes("STALE FIRST READ") ? "STALE FIRST READ"
    : verdicts.includes("NOT CHECKED") ? "NOT CHECKED too-few-runs"
    : "FIRST READ TRUE";
  if (notRunning !== null) figures.notRunning = notRunning;
  figures.verdict = verdict;

  return { issue: "first-read", chrome: browserOf(navigator), date: runDate(), runToken: newRunToken(), verdict, figures };
}
