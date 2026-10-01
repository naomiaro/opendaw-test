/**
 * Counting the one-quantum event over saved recording-audit runs.
 *
 * The event (register: "The one-quantum repeat, looked at again" and "The one-quantum
 * event, twice more" in `debug/recording-start-alignment-audit.md`): on a rare repeat a
 * time stamp the SDK takes at the start of a take is one render quantum early. It shows
 * in a row as a netted median one quantum off the run's usual value (the engine's
 * recording-start time), or as a first-frame check one quantum off zero (the recording
 * worklet's first-quantum time), or both. A single-tape row has no first-frame check:
 * an event in which only the recording worklet's stamp is early cannot be seen on it.
 *
 * SDK-free and DOM-free: the offline script and the tests share it.
 */

/** Render quantum, in milliseconds, at a sample rate. */
export function quantumMs(rate: number): number {
  return (128 / rate) * 1000;
}

/** The median (the mean of the two middle values for an even count); null for no values. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The fewest repeats a run needs before one of them can be called unusual. */
export const MIN_REPEATS_FOR_USUAL = 3;

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
 * The run's usual netted median: the median over its repeats of each repeat's own
 * median. It stays on the usual value while fewer than half the repeats are off it.
 * Null for a run of fewer than `MIN_REPEATS_FOR_USUAL` repeats: with two repeats that
 * differ, nothing says which one is the usual one.
 */
export function usualNettedMs(repeats: readonly RepeatReading[]): number | null {
  if (repeats.length < MIN_REPEATS_FOR_USUAL) return null;
  return medianOf(repeats.map((reading) =>
    medianOf(reading.rows.map((row) => row.medianBeatErrorMsNetted as number)) as number
  ));
}

/**
 * What a repeat's start-of-take figures say:
 * - `none`: every netted median within half a quantum of the run's usual value and
 *   every first-frame check within half a quantum of zero;
 * - `one-quantum`: at least one of them is off, and every one that is off is off by one
 *   quantum (to within a quarter of a quantum) — the event;
 * - `other`: something is off by another amount. Not the event, and not counted as one.
 */
export type RepeatDeviation = "none" | "one-quantum" | "other";

export function deviationOf(reading: RepeatReading, usualMs: number, rate: number): RepeatDeviation {
  const quantum = quantumMs(rate);
  const off: number[] = [];
  for (const row of reading.rows) {
    if (typeof row.medianBeatErrorMsNetted === "number" && Math.abs(row.medianBeatErrorMsNetted - usualMs) > quantum / 2) {
      off.push(row.medianBeatErrorMsNetted - usualMs);
    }
    if (typeof row.firstFrameCheckMs === "number" && Math.abs(row.firstFrameCheckMs) > quantum / 2) {
      off.push(row.firstFrameCheckMs);
    }
  }
  if (off.length === 0) return "none";
  return off.every((value) => Math.abs(Math.abs(value) - quantum) < quantum / 4) ? "one-quantum" : "other";
}

export interface RunEvents {
  /** Repeats in which every row has a netted median. */
  repeats: number;
  /** Those among them that show the one-quantum event. Empty when `usualMs` is null. */
  events: RepeatReading[];
  /** Those that are off by something other than one quantum. */
  others: RepeatReading[];
  /** The run's usual netted median; null when the run has too few repeats to tell. */
  usualMs: number | null;
}

/** The repeats of one run that carry netted medians, and what each of them shows. */
export function eventsOfRun(rows: readonly EventRow[], rate: number): RunEvents {
  const repeats = repeatsOf(rows);
  const usualMs = usualNettedMs(repeats);
  if (usualMs === null) return { repeats: repeats.length, events: [], others: [], usualMs: null };
  return {
    repeats: repeats.length,
    events: repeats.filter((reading) => deviationOf(reading, usualMs, rate) === "one-quantum"),
    others: repeats.filter((reading) => deviationOf(reading, usualMs, rate) === "other"),
    usualMs,
  };
}

/** A call of the harness's reference recorder whose `currentFrame` was not one quantum
 *  after the call before it, as a multi-mic envelope carries it (`clockDiscontinuities`). */
export interface ClockStep {
  previousFrame: number;
  frame: number;
  betweenChunks: boolean;
}

/** The start-of-take stamps a row carries. */
export interface StampedStart {
  firstQuantumTimeSec?: number | null;
  recordingStartContextTimeSec?: number | null;
}

export interface StaleAtStamp {
  stamp: "first quantum" | "recording start";
  /** What the clock read in the stale quantum: one quantum less than that quantum's true frame. */
  staleFrame: number;
  /** `staleFrame` less the frame the stamp read. 0: the clock read the stamp's own value in a stale quantum. */
  distanceFrames: number;
}

/**
 * The stale clock reads of a run that fall within one quantum of a row's start-of-take
 * stamps. A stale read is a call that read the same frame as the call before it, inside
 * a chunk or at a chunk border (a lost chunk makes the frame jump forward, never repeat).
 * The recording worklet's stamp is the frame its first call read; the engine reports the
 * END of the quantum it stamped in, so the frame it read is one quantum before its report.
 *
 * A distance of 0 does not say which call took the stamp: a processor that stamped in the
 * quantum BEFORE the stale one read the same number truly. Whether a stamp is early is the
 * row's own figures' to say (netted median, first-frame check); this says whether the clock
 * stood still there.
 */
export function staleQuantaAtStamps(
  steps: readonly ClockStep[],
  row: StampedStart,
  rate: number,
  quantumFrames = 128
): StaleAtStamp[] {
  const stamps: { stamp: StaleAtStamp["stamp"]; frame: number }[] = [];
  if (typeof row.firstQuantumTimeSec === "number") {
    stamps.push({ stamp: "first quantum", frame: Math.round(row.firstQuantumTimeSec * rate) });
  }
  if (typeof row.recordingStartContextTimeSec === "number") {
    stamps.push({ stamp: "recording start", frame: Math.round(row.recordingStartContextTimeSec * rate) - quantumFrames });
  }
  const found: StaleAtStamp[] = [];
  for (const { stamp, frame } of stamps) {
    for (const step of steps) {
      if (step.frame !== step.previousFrame) continue;
      const distanceFrames = step.frame - frame;
      if (Math.abs(distanceFrames) <= quantumFrames) found.push({ stamp, staleFrame: step.frame, distanceFrames });
    }
  }
  return found;
}

/**
 * How a saved envelope without an `sdkVersion` is dated: a release-build run with this
 * id or a later one was recorded on 0.0.173, an earlier one on 0.0.172. The constant
 * describes runs already on disk; every new envelope carries its version.
 */
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
 * Which SDK release a run was recorded on, or null for a run that is not a release
 * build: those are not part of a comparison between releases.
 *
 * A release build is one the build probe calls `upstream` and whose feature list is
 * exactly `recordingStart`. A branch build served through `SDK_DIST_OVERRIDE` carries
 * its base release's version string, so the version alone cannot tell; a release that
 * exposes further surfaces needs this check widened before its runs are counted.
 * The release is the envelope's own `sdkVersion`, or for an envelope without the field
 * the one its run id falls in.
 */
export function sdkOf(run: RunIdentity): string | null {
  const release = run.sdkBuildProbe === "upstream" && run.buildFeatures !== null &&
    run.buildFeatures.length === 1 && run.buildFeatures[0] === "recordingStart";
  if (!release) return null;
  if (run.sdkVersion !== null) return run.sdkVersion;
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
