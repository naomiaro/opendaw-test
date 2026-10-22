/**
 * What a `?issue=suspend-resume` page load asks of the Chromium 560233271 probe, read from the
 * query, and how its two readings merge into one verdict. Pure, Node-tested; the probe is
 * `chromiumSuspendResumeProbe.ts`.
 *
 * - `&control=crackle|harmonic`: the positive control, from `CONTROL_FROM_CYCLE` on.
 * - `&witness=mic`: the tone also plays from the speaker and the microphone, captured in a
 *   context of its own that is never suspended, is judged too. The tracker places the fault in
 *   the output path after the graph, which an analyser inside the graph cannot see.
 * - `&pace=<ms>`: the wait between `resume()` resolving and the next `suspend()`, the window read
 *   at its end; 0 keeps the one-second window.
 * - `&cycles=<n>`: how many suspend / resume cycles, 20 without one.
 * - `&repro=tracker`: the tracker's reduced preconditions: a context at 44 100 Hz requested
 *   explicitly, one restart before the baseline, and an 80 ms synchronous task on the worklet
 *   thread before each cycle.
 */

export type SuspendResumeControl = "crackle" | "harmonic";
export type SuspendResumeWitness = "mic";
export type SuspendResumeRepro = "tracker";

export interface SuspendResumeOptions {
  control: SuspendResumeControl | null;
  witness: SuspendResumeWitness | null;
  paceMs: number;
  cycles: number;
  repro: SuspendResumeRepro | null;
}

export const DEFAULT_CYCLES = 20;
/** The cycle (from 1) a control run starts distorting the tone at. */
export const CONTROL_FROM_CYCLE = 7;
/** What `&repro=tracker` sets, from the tracker's repro page. */
export const TRACKER_SAMPLE_RATE = 44100;
export const TRACKER_BLOCK_MS = 80;

function oneOf<T extends string>(params: URLSearchParams, name: string, values: readonly T[]): T | null {
  const value = params.get(name);
  if (value === null) return null;
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new Error(`&${name}=${value}: expected ${values.join(" or ")}`);
}

function wholeNumber(params: URLSearchParams, name: string, fallback: number, min: number): number {
  const value = params.get(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < min) throw new Error(`&${name}=${value}: expected a whole number from ${min}`);
  return parsed;
}

export function suspendResumeOptionsFrom(params: URLSearchParams): SuspendResumeOptions {
  return {
    control: oneOf(params, "control", ["crackle", "harmonic"] as const),
    witness: oneOf(params, "witness", ["mic"] as const),
    paceMs: wholeNumber(params, "pace", 0, 0),
    cycles: wholeNumber(params, "cycles", DEFAULT_CYCLES, 1),
    repro: oneOf(params, "repro", ["tracker"] as const),
  };
}

/** The run's verdict: the microphone's when the witness is on, else the graph's. */
export function overallVerdict(graph: string, mic: string | null): string {
  return mic ?? graph;
}
