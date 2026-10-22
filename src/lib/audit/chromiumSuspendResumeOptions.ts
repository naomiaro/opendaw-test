/**
 * What a `?issue=suspend-resume` page load asks of the Chromium 560233271 probe, read from the
 * query, and how its readings merge into one verdict. Pure, Node-tested; the probe is
 * `chromiumSuspendResumeProbe.ts`.
 *
 * - `&control=crackle|harmonic`: the positive control, from `CONTROL_FROM_CYCLE` on.
 * - `&witness=mic`: the tone also plays from the speaker and the microphone, captured in a
 *   context of its own that is never suspended, is judged too. The tracker places the fault in
 *   the output path after the graph, which an analyser inside the graph cannot see.
 * - `&pace=<ms>`: the wait between `resume()` resolving and the next cycle, the window read at
 *   its end; 0 keeps the one-second window.
 * - `&cycles=<n>`: how many suspend / resume cycles, 20 without one.
 * - `&stallMs=<ms>`: before each cycle, the worklet thread busy-waits this long in its message
 *   handler and answers; the cycle waits for the answer. The tracker's repro posts 80.
 * - `&gapMs=<ms>`: a wait between `suspend()` resolving and `resume()`; 0 is back-to-back, as the
 *   tracker's repro does.
 * - `&rate=<hz>`: the sample rate the context requests (44100 or 48000); the device's without one.
 * - `&firstCycle=1`: one suspend / resume right after the node is made, the repro's
 *   "first-gesture latency workaround".
 * - `&module=file|blob`: the worklet from its file under `public/` (the default) or from a Blob URL
 *   of the same source, the control: the tracker's reporter found a Blob URL did not reproduce.
 * - `&manual=1`: one real click per cycle, as on the repro page, until Finish.
 * - `&tracker=1`: the repro page's setup, `stallMs=80&rate=44100&firstCycle=1&pace=1000`; an
 *   explicit parameter overrides its part of the preset.
 */

export type SuspendResumeControl = "crackle" | "harmonic";
export type SuspendResumeWitness = "mic";
export type SuspendResumeModule = "file" | "blob";

export interface SuspendResumeOptions {
  control: SuspendResumeControl | null;
  witness: SuspendResumeWitness | null;
  paceMs: number;
  cycles: number;
  stallMs: number;
  gapMs: number;
  rate: 44100 | 48000 | null;
  firstCycle: boolean;
  module: SuspendResumeModule;
  manual: boolean;
  tracker: boolean;
}

export const DEFAULT_CYCLES = 20;
/** The cycle (from 1) a control run starts distorting the tone at. */
export const CONTROL_FROM_CYCLE = 7;
/** The repro page's setup (github.com/pioug/chromium-audiocontext). */
export const TRACKER_PRESET = { stallMs: 80, rate: 44100, firstCycle: true, paceMs: 1000 } as const;

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

function flag(params: URLSearchParams, name: string, fallback: boolean): boolean {
  const value = oneOf(params, name, ["1", "0"] as const);
  return value === null ? fallback : value === "1";
}

export function suspendResumeOptionsFrom(params: URLSearchParams): SuspendResumeOptions {
  const tracker = flag(params, "tracker", false);
  const rate = oneOf(params, "rate", ["44100", "48000"] as const);
  return {
    control: oneOf(params, "control", ["crackle", "harmonic"] as const),
    witness: oneOf(params, "witness", ["mic"] as const),
    paceMs: wholeNumber(params, "pace", tracker ? TRACKER_PRESET.paceMs : 0, 0),
    cycles: wholeNumber(params, "cycles", DEFAULT_CYCLES, 1),
    stallMs: wholeNumber(params, "stallMs", tracker ? TRACKER_PRESET.stallMs : 0, 0),
    gapMs: wholeNumber(params, "gapMs", 0, 0),
    rate: rate === null ? (tracker ? TRACKER_PRESET.rate : null) : rate === "44100" ? 44100 : 48000,
    firstCycle: flag(params, "firstCycle", tracker && TRACKER_PRESET.firstCycle),
    module: oneOf(params, "module", ["file", "blob"] as const) ?? "file",
    manual: flag(params, "manual", false),
    tracker,
  };
}

/** The run's verdict: `HALF RATE` when the clock witness fires; else the microphone's when it is on; else the graph's. */
export function overallVerdict(graph: string, mic: string | null, halfRate: boolean): string {
  if (halfRate) return "HALF RATE";
  return mic ?? graph;
}
