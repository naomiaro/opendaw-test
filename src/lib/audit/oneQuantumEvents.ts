/**
 * Counting the one-quantum event over saved recording-audit runs.
 *
 * The event (register: "The one-quantum repeat, looked at again" and "The one-quantum
 * event, twice more" in `debug/2026-09-02-recording-start-alignment/note.md`): on a rare repeat a
 * time stamp the SDK takes at the start of a take is one render quantum early. It shows
 * in a row as a netted median one quantum off the run's usual value (the engine's
 * recording-start time), or as a first-frame check one quantum off zero (the recording
 * worklet's first-quantum time), or both. A single-tape row has no first-frame check:
 * an event in which only the recording worklet's stamp is early cannot be seen on it.
 *
 * SDK-free and DOM-free: the offline script and the tests share it.
 */

// A value import with an explicit `.ts` extension: this module is in the Node scripts' import chain.
import { clockStalls, type ClockDiscontinuity } from "./nodeTap.ts";

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
  /** Those that show nothing: the control an event is read against. */
  ordinary: RepeatReading[];
  /** The run's usual netted median; null when the run has too few repeats to tell. */
  usualMs: number | null;
}

/** The repeats of one run that carry netted medians, and what each of them shows. */
export function eventsOfRun(rows: readonly EventRow[], rate: number): RunEvents {
  const repeats = repeatsOf(rows);
  const usualMs = usualNettedMs(repeats);
  if (usualMs === null) return { repeats: repeats.length, events: [], others: [], ordinary: [], usualMs: null };
  return {
    repeats: repeats.length,
    events: repeats.filter((reading) => deviationOf(reading, usualMs, rate) === "one-quantum"),
    others: repeats.filter((reading) => deviationOf(reading, usualMs, rate) === "other"),
    ordinary: repeats.filter((reading) => deviationOf(reading, usualMs, rate) === "none"),
    usualMs,
  };
}

/** The start-of-take stamps a row carries. */
export interface StampedStart {
  firstQuantumTimeSec?: number | null;
  recordingStartContextTimeSec?: number | null;
}

export interface StaleAtStamp {
  stamp: "first quantum" | "recording start";
  /** The frame the clock stood on during the stall. */
  staleFrame: number;
  /** How many quanta the stall lasted. */
  stallQuanta: number;
  /** The stamp reads the very frame the clock stood on: it was taken in a stale quantum
   *  (early by as many quanta as the stall had run), or truly in the quantum before the
   *  stall. The two read the same number. */
  readsStaleFrame: boolean;
  /** Where the call that took the stamp was, in quanta from the stall: 0 when
   *  `readsStaleFrame`; 1 for the quantum right after the stall's last stale quantum; −2
   *  for two quanta before its first. −1 is never reported: a stamp from the quantum
   *  before the stall reads the stale frame and is given as 0. */
  quantaFromStall: number;
}

/** How far from a stall a stamping call is still listed. */
const STALL_WINDOW_QUANTA = 2;

/**
 * The stalls of a run's clock that fall within two quanta of a row's start-of-take stamps
 * (`clockStalls` over the envelope's `clockDiscontinuities`). The recording worklet's stamp
 * is the frame its first call read; the engine reports the END of the quantum it stamped in,
 * so the frame it read is one quantum before its report.
 *
 * Distances are measured from the stall itself, so that a stamp taken right after it (a
 * near miss: the stamp is true) is seen as well as one taken in it. `readsStaleFrame` does
 * not say which call took the stamp: a processor that stamped in the quantum BEFORE the
 * stall read the same number truly. Whether a stamp is early is the row's own figures' to
 * say (netted median, first-frame check); this says whether the clock stood still there.
 * A stamp that names a stale quantum's own true frame is not listed: no call can read it.
 */
export function staleQuantaAtStamps(
  steps: readonly ClockDiscontinuity[],
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
  const stalls = clockStalls(steps);
  const found: StaleAtStamp[] = [];
  for (const { stamp, frame } of stamps) {
    for (const stall of stalls) {
      const lastStaleFrame = stall.frame + stall.quanta * quantumFrames;
      let quantaFromStall: number;
      if (frame === stall.frame) {
        quantaFromStall = 0;
      } else if (frame > lastStaleFrame) {
        quantaFromStall = (frame - lastStaleFrame) / quantumFrames;
      } else if (frame < stall.frame) {
        quantaFromStall = (frame - stall.frame - quantumFrames) / quantumFrames;
      } else {
        continue; // the true frame of a stale quantum: a value no call read
      }
      if (Math.abs(quantaFromStall) <= STALL_WINDOW_QUANTA) {
        found.push({
          stamp, staleFrame: stall.frame, stallQuanta: stall.quanta,
          readsStaleFrame: frame === stall.frame, quantaFromStall,
        });
      }
    }
  }
  return found;
}

export interface ControlTally<Row> {
  /** Rows that carry at least one stamp: the ones the control can speak of. */
  rows: number;
  /** Rows with a stamp that reads a frame the clock stood on. */
  onAStall: { row: Row; found: StaleAtStamp[] }[];
  /** Rows with a stall within two quanta of a stamp that does not read its frame: near misses. */
  near: { row: Row; found: StaleAtStamp[] }[];
  /** Rows that carry neither stamp, of which nothing can be said. Not among `rows`. */
  withoutStamps: number;
}

/** The control an event is read against: what the clock did near the stamps of ordinary rows. */
export function controlTally<Row extends StampedStart>(
  rows: readonly Row[],
  steps: readonly ClockDiscontinuity[],
  rate: number
): ControlTally<Row> {
  const tally: ControlTally<Row> = { rows: 0, onAStall: [], near: [], withoutStamps: 0 };
  for (const row of rows) {
    if (typeof row.firstQuantumTimeSec !== "number" && typeof row.recordingStartContextTimeSec !== "number") {
      tally.withoutStamps++;
      continue;
    }
    tally.rows++;
    const found = staleQuantaAtStamps(steps, row, rate);
    if (found.length === 0) continue;
    (found.some((entry) => entry.readsStaleFrame) ? tally.onAStall : tally.near).push({ row, found });
  }
  return tally;
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
