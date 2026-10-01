/**
 * Counting the one-quantum event over saved recording-audit runs.
 *
 * The event (register: "The one-quantum repeat, looked at again" and "The one-quantum
 * event, twice more" in `debug/recording-start-alignment-audit.md`): on a rare repeat a
 * time stamp the SDK takes at the start of a take is one render quantum early. It shows
 * in a row as a netted median one quantum off the run's usual value (the engine's
 * recording-start time), or as a first-frame check one quantum off zero (the recording
 * worklet's first-quantum time), or both.
 *
 * SDK-free and DOM-free: the offline script and the tests share it.
 */

/** Render quantum, in milliseconds, at a sample rate. */
export function quantumMs(rate: number): number {
  return (128 / rate) * 1000;
}

/** The most frequent value after rounding to `resolution`; null for no values. */
export function modalValue(values: readonly number[], resolution = 0.01): number | null {
  const counts = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value / resolution);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best === null ? null : best * resolution;
}

/** What the counting reads off a persisted row, single-tape or multi-mic. */
export interface EventRow {
  scenario: string;
  bpm: number;
  repeat: number;
  takeIndex?: number;
  tape?: string;
  medianBeatErrorMsNetted?: number | null;
  firstFrameCheckMs?: number | null;
  stopLeadMs?: number | null;
}

export interface RepeatReading {
  scenario: string;
  bpm: number;
  repeat: number;
  rows: EventRow[];
}

/** Rows grouped into repeats, keeping only repeats in which every row has a netted median. */
export function repeatsOf(rows: readonly EventRow[]): RepeatReading[] {
  const byRepeat = new Map<string, RepeatReading>();
  for (const row of rows) {
    const key = `${row.scenario}/${row.bpm}/${row.repeat}`;
    const reading = byRepeat.get(key) ?? { scenario: row.scenario, bpm: row.bpm, repeat: row.repeat, rows: [] };
    reading.rows.push(row);
    byRepeat.set(key, reading);
  }
  return [...byRepeat.values()].filter((reading) =>
    reading.rows.every((row) => typeof row.medianBeatErrorMsNetted === "number")
  );
}

/**
 * Whether a repeat shows the event: a netted median more than half a quantum off the
 * run's mode, or a first-frame check more than half a quantum off zero, on any row.
 */
export function isOneQuantumEvent(reading: RepeatReading, modeMs: number, rate: number): boolean {
  const half = quantumMs(rate) / 2;
  return reading.rows.some((row) =>
    (typeof row.medianBeatErrorMsNetted === "number" && Math.abs(row.medianBeatErrorMsNetted - modeMs) > half) ||
    (typeof row.firstFrameCheckMs === "number" && Math.abs(row.firstFrameCheckMs) > half)
  );
}

export interface RunEvents {
  repeats: number;
  events: RepeatReading[];
  /** The run's usual netted median, null when no repeat has one. */
  modeMs: number | null;
}

/** The repeats of one run that carry netted medians, and those among them that show the event. */
export function eventsOfRun(rows: readonly EventRow[], rate: number): RunEvents {
  const repeats = repeatsOf(rows);
  const modeMs = modalValue(repeats.flatMap((reading) => reading.rows.map((row) => row.medianBeatErrorMsNetted as number)));
  if (modeMs === null) return { repeats: 0, events: [], modeMs: null };
  return { repeats: repeats.length, events: repeats.filter((reading) => isOneQuantumEvent(reading, modeMs, rate)), modeMs };
}

/** The first run recorded on SDK 0.0.173. Release-build envelopes before it, without an
 *  `sdkVersion`, were recorded on 0.0.172. */
export const FIRST_RUN_ON_0_0_173 = 1790871141815;
/** Runs recorded with the stop lead before rows carried `stopLeadMs`. */
export const STOP_LEAD_RUNS_WITHOUT_FIELD: readonly number[] = [
  1790872110234, 1790872569363, 1790872984620, 1790873210628, 1790873377511,
];

export interface RunIdentity {
  runId: number;
  sdkVersion: string | null;
  stopLead: boolean | null;
  sdkBuildProbe: string;
  buildFeatures: readonly string[] | null;
}

/**
 * Which SDK release a run was recorded on: the envelope's own `sdkVersion`, or for an
 * envelope older than the field the release its run id falls in. Null for a run that is
 * not a release build (a branch build, or one that predates the build probe's re-targeting):
 * those are not part of the comparison.
 */
export function sdkOf(run: RunIdentity): string | null {
  if (run.sdkVersion !== null) return run.sdkVersion;
  const release = run.sdkBuildProbe === "upstream" && run.buildFeatures !== null &&
    run.buildFeatures.length === 1 && run.buildFeatures[0] === "recordingStart";
  if (!release) return null;
  return run.runId >= FIRST_RUN_ON_0_0_173 ? "0.0.173" : "0.0.172";
}

export type HarnessStop = "stop-lead" | "stop-after-click";

/** Whether a run's repeats stopped a lead before the click or just after it. */
export function harnessOf(run: RunIdentity, rows: readonly EventRow[]): HarnessStop {
  if (run.stopLead !== null) return run.stopLead ? "stop-lead" : "stop-after-click";
  if (rows.some((row) => typeof row.stopLeadMs === "number")) return "stop-lead";
  return STOP_LEAD_RUNS_WITHOUT_FIELD.includes(run.runId) ? "stop-lead" : "stop-after-click";
}

function logChoose(n: number, k: number): number {
  let sum = 0;
  for (let i = 1; i <= k; i++) sum += Math.log(n - k + i) - Math.log(i);
  return sum;
}

/**
 * Fisher's exact test, one-sided: the chance that group B holds at least `eventsB` of the
 * events, given the group sizes and the total, if an event is as likely in either group.
 */
export function fisherOneSided(eventsA: number, repeatsA: number, eventsB: number, repeatsB: number): number {
  const total = eventsA + eventsB;
  const population = repeatsA + repeatsB;
  const denominator = logChoose(population, total);
  let probability = 0;
  for (let inB = eventsB; inB <= Math.min(total, repeatsB); inB++) {
    if (total - inB > repeatsA) continue;
    probability += Math.exp(logChoose(repeatsB, inB) + logChoose(repeatsA, total - inB) - denominator);
  }
  return Math.min(1, probability);
}

function binomialAtMost(events: number, repeats: number, rate: number): number {
  if (rate <= 0) return 1;
  if (rate >= 1) return events >= repeats ? 1 : 0;
  let sum = 0;
  for (let k = 0; k <= events; k++) {
    sum += Math.exp(logChoose(repeats, k) + k * Math.log(rate) + (repeats - k) * Math.log(1 - rate));
  }
  return Math.min(1, sum);
}

/** Exact (Clopper–Pearson) interval for an event rate, `level` two-sided. */
export function exactRateInterval(events: number, repeats: number, level = 0.95): [number, number] {
  if (repeats === 0) return [0, 1];
  const tail = (1 - level) / 2;
  const solve = (holds: (rate: number) => boolean): number => {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      if (holds(middle)) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  // lower bound: the rate at which seeing `events` or more has probability `tail`
  const lower = events === 0 ? 0 : solve((rate) => 1 - binomialAtMost(events - 1, repeats, rate) < tail);
  // upper bound: the rate at which seeing `events` or fewer has probability `tail`
  const upper = events === repeats ? 1 : solve((rate) => binomialAtMost(events, repeats, rate) > tail);
  return [lower, upper];
}
