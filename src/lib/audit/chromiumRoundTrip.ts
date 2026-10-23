// The pure half of the acoustic round trip for Chromium 388871416: finds each scheduled
// click's arrival in a capture (a tone match, below), summarises the round trips, and judges
// whether the run measured anything.

import { notChecked, type Verdict } from "./chromiumWatched";

/** The clicks a run plays, one second apart. */
export const CLICKS = 10;
/** Fewer clicks found than this is no measurement. */
export const MIN_CLICKS_FOUND = 5;
/**
 * The widest interquartile range of the clock-pair offsets (ms) allowed around any click; wider,
 * and the median offset a click is placed with is not one figure. The pairs move by a callback's
 * length on the context side and by a late main-thread read on the page's, a few ms each.
 */
export const CLOCK_PAIR_MAX_SPREAD_MS = 10;
/** The multiple of the pre-click floor the tone match must exceed. */
export const ONSET_FLOOR_MULTIPLE = 8;
/** The floor is read over this long before the expected click. */
export const FLOOR_SECONDS = 0.1;
/** How long after the expected frame an arrival is searched. */
export const SEARCH_SECONDS = 0.6;
/** A floor below this is silence: the match must still exceed it. */
export const MIN_FLOOR = 1e-5;

/**
 * For each expected frame, the offset in frames from it to the click's first frame in `samples`, or
 * null when no click is found. The click is a burst of `toneHz` lasting `burstSeconds`; the detector
 * is a match against that tone: at each lag the magnitude of the sample window's component at
 * `toneHz`. Broadband room noise adds little to it, so a click far below the noise floor in plain
 * RMS still shows. The click is found at the lag where the match peaks inside the search range,
 * accepted when that peak exceeds `ONSET_FLOOR_MULTIPLE` times the RMS of the match over the
 * `FLOOR_SECONDS` before the expected frame (stopping a burst's length short of it, so a window
 * that already reaches the click is not in the floor). A speaker's own delay is in the offset.
 */
export function findClickOffsets(
  samples: Float32Array,
  rate: number,
  expectedFrames: readonly number[],
  toneHz: number,
  burstSeconds: number
): (number | null)[] {
  const length = Math.round(burstSeconds * rate);
  const re = new Float64Array(samples.length + 1);
  const im = new Float64Array(samples.length + 1);
  const step = (2 * Math.PI * toneHz) / rate;
  for (let n = 0; n < samples.length; n++) {
    re[n + 1] = re[n] + samples[n] * Math.cos(step * n);
    im[n + 1] = im[n] - samples[n] * Math.sin(step * n);
  }
  const match = (lag: number): number => Math.hypot(re[lag + length] - re[lag], im[lag + length] - im[lag]);
  const last = samples.length - length;
  return expectedFrames.map((expected) => {
    const start = Math.round(expected);
    const floorFrom = Math.max(0, start - Math.round(FLOOR_SECONDS * rate));
    const floorTo = start - length;
    if (start < 0 || start > last || floorTo <= floorFrom) return null;
    let sum = 0;
    for (let lag = floorFrom; lag < floorTo; lag++) sum += match(lag) ** 2;
    const floor = Math.max(Math.sqrt(sum / (floorTo - floorFrom)), MIN_FLOOR);
    const end = Math.min(last, start + Math.round(SEARCH_SECONDS * rate));
    let best = start;
    let bestValue = -1;
    for (let lag = start; lag <= end; lag++) {
      const value = match(lag);
      if (value > bestValue) {
        bestValue = value;
        best = lag;
      }
    }
    return bestValue > ONSET_FLOOR_MULTIPLE * floor ? best - start : null;
  });
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The nearest-rank percentile (`p` in 0..100); null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** One reading of a context's clock against the page's: `AudioContext.currentTime` and `performance.now()` read together. */
export interface ClockPair {
  contextTime: number;
  performanceMs: number;
}

/** Pairs closer than this to a context time (seconds) are the ones its clock offset is taken from. */
export const CLOCK_WINDOW_SECONDS = 1;

/**
 * The offset (ms) to add to a context time in milliseconds to get the page's `performance.now()`,
 * the median over the pairs within `CLOCK_WINDOW_SECONDS` of `contextTime` (the nearest pair when none
 * is). A median, because a pair read late on the main thread is only ever late.
 */
export function clockOffsetMs(pairs: readonly ClockPair[], contextTime: number): number {
  if (pairs.length === 0) throw new Error("no clock pairs");
  const near = pairs.filter((p) => Math.abs(p.contextTime - contextTime) <= CLOCK_WINDOW_SECONDS);
  const used = near.length > 0 ? near : [[...pairs].sort((a, b) => Math.abs(a.contextTime - contextTime) - Math.abs(b.contextTime - contextTime))[0]];
  return median(used.map((p) => p.performanceMs - p.contextTime * 1000)) as number;
}

/** The interquartile range of a list; 0 for one value. */
function interquartile(values: readonly number[]): number {
  return (percentile(values, 75) as number) - (percentile(values, 25) as number);
}

/**
 * The widest interquartile range (ms) of `performanceMs - contextTime * 1000` over the pairs
 * `clockOffsetMs` takes for each of `contextTimes` (those within `CLOCK_WINDOW_SECONDS`, else the
 * nearest one, whose spread is 0). Null without pairs.
 */
export function clockPairSpreadMs(pairs: readonly ClockPair[], contextTimes: readonly number[]): number | null {
  if (pairs.length === 0) return null;
  let widest = 0;
  for (const time of contextTimes) {
    const near = pairs.filter((p) => Math.abs(p.contextTime - time) <= CLOCK_WINDOW_SECONDS);
    if (near.length === 0) continue;
    widest = Math.max(widest, interquartile(near.map((p) => p.performanceMs - p.contextTime * 1000)));
  }
  return widest;
}

export function contextTimeToPerformanceMs(pairs: readonly ClockPair[], contextTime: number): number {
  return contextTime * 1000 + clockOffsetMs(pairs, contextTime);
}

/** The context time (seconds) whose `performance.now()` is `performanceMs`. */
export function performanceMsToContextTime(pairs: readonly ClockPair[], performanceMs: number): number {
  let time = (performanceMs - clockOffsetMs(pairs, pairs[pairs.length - 1].contextTime)) / 1000;
  for (let i = 0; i < 3; i++) time = (performanceMs - clockOffsetMs(pairs, time)) / 1000;
  return time;
}

/**
 * The frame in a capture (the context's frame counter at the capture's first frame is `captureStartFrame`)
 * that coincides with a click scheduled at `clickContextTime` on ANOTHER context: through the page's
 * clock, so the two contexts need not share a device.
 */
export function expectedCaptureFrame(
  outputPairs: readonly ClockPair[],
  capturePairs: readonly ClockPair[],
  clickContextTime: number,
  captureRate: number,
  captureStartFrame: number
): number {
  const performanceMs = contextTimeToPerformanceMs(outputPairs, clickContextTime);
  return performanceMsToContextTime(capturePairs, performanceMs) * captureRate - captureStartFrame;
}

/** What a round-trip run is judged on. */
export interface RoundTripReading {
  /** One per click, in order; null for a click not found. */
  roundTripsMs: readonly (number | null)[];
  clicks: number;
  /** The label of the output the context played through, as the page read it. */
  outputLabel: string;
  /** `clockPairSpreadMs` of the pairs the clicks were placed through; null when no pairs placed them (one context). */
  pairSpreadMs: number | null;
}

/**
 * `NOT CHECKED <n>-of-<N>-clicks-found-…` naming the missed clicks and the output under
 * `MIN_CLICKS_FOUND`; `NOT CHECKED clock-pair-unstable` when the pairs that placed the clicks spread
 * wider than `CLOCK_PAIR_MAX_SPREAD_MS`; `NOT CHECKED non-positive-round-trip` when a click arrived at
 * or before its scheduled time (no sound arrives before it is played); else `MEASURED`.
 */
export function judgeRoundTrip(reading: RoundTripReading): Verdict {
  const found = reading.roundTripsMs.filter((v): v is number => v !== null);
  if (found.length < MIN_CLICKS_FOUND) {
    const missed = reading.roundTripsMs.flatMap((v, i) => (v === null ? [i + 1] : []));
    return notChecked(
      `${found.length}-of-${reading.clicks}-clicks-found-missed-${missed.join("-")}-check-the-system-output-device-which-was-${reading.outputLabel.replace(/\s+/g, "-")}`,
    );
  }
  if (reading.pairSpreadMs !== null && reading.pairSpreadMs > CLOCK_PAIR_MAX_SPREAD_MS) return notChecked("clock-pair-unstable");
  if (found.some((v) => v <= 0)) return notChecked("non-positive-round-trip");
  return "MEASURED";
}

/** The click amplitude `&gain=` names (above 0, at most 1), `fallback` without one; throws on anything else. */
export function clickGainFrom(params: URLSearchParams, fallback: number): number {
  const value = params.get("gain");
  if (value === null) return fallback;
  const gain = value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(gain) || gain <= 0 || gain > 1) throw new Error(`&gain=${value}: expected an amplitude above 0 and at most 1`);
  return gain;
}
