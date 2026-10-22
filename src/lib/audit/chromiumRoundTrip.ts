// The pure half of the acoustic round trip for Chromium 388871416: finds each scheduled
// click's arrival in a capture (a tone match, below), and summarises the round trips.

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
