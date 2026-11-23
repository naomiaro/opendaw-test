/**
 * The stretch placement audit: where a click in the source comes out when its region plays through a
 * stretched play mode. What `stretch-placement-debug-demo.html` renders and how it reads each render.
 *
 * The source is a train of short tone bursts at known frames. A row puts it in one audio region with a
 * play mode (none, varispeed, Signalsmith), a stretch factor and a transpose, renders offline and reads
 * each burst's position against where the warp map puts it. Pure functions over Float32Arrays, tested in Node.
 */
import { PPQN } from "@opendaw/lib-dsp";

export const PLACEMENT_BPM = 120;
export const SOURCE_SECONDS = 4;
/** The first burst's centre and the distance between bursts, in seconds of source. */
export const FIRST_CLICK_SECONDS = 0.25;
export const CLICK_SPACING_SECONDS = 0.5;
export const CLICK_COUNT = 8;
/** A Hann-windowed tone burst: broadband enough to localise, low enough to survive a transpose up. */
export const CLICK_HZ = 2000;
export const CLICK_SECONDS = 0.002;
export const CLICK_LEVEL = 0.8;
/** Silence rendered after the region's end, for a stretcher's tail. */
export const RENDER_TAIL_SECONDS = 0.5;
/** A burst is read inside this much on either side of where it is expected. */
export const READ_HALF_WINDOW_SECONDS = 0.1;
/** A burst that sounds reads at least this peak; a read on less is a read on nothing. */
export const SOUNDING_FLOOR_PEAK = 0.02;
/** A row whose audio is not processed (no play mode, varispeed, Signalsmith with no stretch and no transpose) lands
 *  every burst within this of the warp map. */
export const EXACT_FRAMES = 1;
/** The engine's Signalsmith preset (`preset_default` in `crates/signalsmith/src/stretch.rs`): a 4096-frame block
 *  every 1024 frames, at any sample rate. A burst far shorter than the block comes out spread across it. */
export const SIGNALSMITH_BLOCK_FRAMES = 4096;
export const SIGNALSMITH_HOP_FRAMES = 1024;
/** A processed row has no constant offset when the median burst sits within a quarter hop of the warp map
 *  (the uuid stagger this page was built after delayed every burst by 0 to 7 render quanta, up to 896 frames).
 *  A processed row therefore cannot see a delay of one or two quanta; the unprocessed rows, held to a frame, can. */
export const CENTRED_FRAMES = SIGNALSMITH_HOP_FRAMES / 4;
/** No single burst's centroid may leave the block it was spread across. */
export const SMEAR_LIMIT_FRAMES = SIGNALSMITH_BLOCK_FRAMES / 2;

export type PlayModeKind = "none" | "varispeed" | "signalsmith";

export interface PlacementRow {
  id: string;
  label: string;
  mode: PlayModeKind;
  /** Output length over source length: 1.5 plays the source half as long again. Always 1 for `none`. */
  stretch: number;
  /** Semitones, Signalsmith only. */
  transpose: number;
  /** Where the region starts, PPQN. */
  position: number;
}

const QUARTER = PPQN.Quarter;

export const PLACEMENT_ROWS: readonly PlacementRow[] = [
  { id: "none", label: "No play mode", mode: "none", stretch: 1, transpose: 0, position: QUARTER },
  { id: "varispeed-1", label: "Varispeed, no stretch", mode: "varispeed", stretch: 1, transpose: 0, position: QUARTER },
  { id: "varispeed-1.5", label: "Varispeed, 1.5 times as long", mode: "varispeed", stretch: 1.5, transpose: 0, position: QUARTER },
  { id: "signalsmith-1-at-0", label: "Signalsmith, no stretch, region at 0", mode: "signalsmith", stretch: 1, transpose: 0, position: 0 },
  { id: "signalsmith-1", label: "Signalsmith, no stretch", mode: "signalsmith", stretch: 1, transpose: 0, position: QUARTER },
  { id: "signalsmith-1.02", label: "Signalsmith, 2% longer", mode: "signalsmith", stretch: 1.02, transpose: 0, position: QUARTER },
  { id: "signalsmith-0.98", label: "Signalsmith, 2% shorter", mode: "signalsmith", stretch: 0.98, transpose: 0, position: QUARTER },
  { id: "signalsmith-1.5", label: "Signalsmith, 1.5 times as long", mode: "signalsmith", stretch: 1.5, transpose: 0, position: QUARTER },
  { id: "signalsmith-0.75", label: "Signalsmith, three quarters as long", mode: "signalsmith", stretch: 0.75, transpose: 0, position: QUARTER },
  { id: "signalsmith-1-up3", label: "Signalsmith, no stretch, +3 semitones", mode: "signalsmith", stretch: 1, transpose: 3, position: QUARTER },
  { id: "signalsmith-1-down3", label: "Signalsmith, no stretch, −3 semitones", mode: "signalsmith", stretch: 1, transpose: -3, position: QUARTER },
  { id: "signalsmith-1.5-up3", label: "Signalsmith, 1.5 times as long, +3 semitones", mode: "signalsmith", stretch: 1.5, transpose: 3, position: QUARTER },
];

/** `?row=`: `all` or one id. */
export function resolveRows(param: string | null): readonly PlacementRow[] {
  if (param === null || param === "all") return PLACEMENT_ROWS;
  const row = PLACEMENT_ROWS.find((r) => r.id === param);
  if (row === undefined) throw new Error(`invalid ?row= "${param}" — all or one of ${PLACEMENT_ROWS.map((r) => r.id).join(", ")}`);
  return [row];
}

/** The centre of each burst in the source, in frames at `rate`. Whole frames at 48 000 and 44 100. */
export function clickSourceFrames(rate: number): number[] {
  return Array.from({ length: CLICK_COUNT }, (_, index) => Math.round((FIRST_CLICK_SECONDS + index * CLICK_SPACING_SECONDS) * rate));
}

/** The source: `SOURCE_SECONDS` of silence with a burst centred on each of `clickSourceFrames`. */
export function clickTrain(rate: number): Float32Array {
  const out = new Float32Array(Math.round(SOURCE_SECONDS * rate));
  const half = Math.round((CLICK_SECONDS * rate) / 2);
  for (const centre of clickSourceFrames(rate)) {
    for (let offset = -half; offset <= half; offset++) {
      const window = 0.5 * (1 + Math.cos((Math.PI * offset) / half));
      // a cosine about the centre: the burst is symmetric, so its energy centroid is its centre
      out[centre + offset] = CLICK_LEVEL * window * Math.cos((2 * Math.PI * CLICK_HZ * offset) / rate);
    }
  }
  return out;
}

/** The region's length on the timeline, PPQN: the source's length times the stretch, rounded to a whole pulse. */
export function regionPulses(row: PlacementRow): number {
  return Math.round(PPQN.secondsToPulses(SOURCE_SECONDS * row.stretch, PLACEMENT_BPM));
}

/** The stretch the two warp markers really give: the region's whole pulses over the source's length. */
export function effectiveStretch(row: PlacementRow): number {
  return PPQN.pulsesToSeconds(regionPulses(row), PLACEMENT_BPM) / SOURCE_SECONDS;
}

/** Where the warp map puts each burst's centre in the render, in (fractional) frames from the render's start. */
export function expectedFrames(row: PlacementRow, rate: number): number[] {
  const start = PPQN.pulsesToSeconds(row.position, PLACEMENT_BPM) * rate;
  const stretch = effectiveStretch(row);
  return clickSourceFrames(rate).map((frame) => start + frame * stretch);
}

export function renderSeconds(row: PlacementRow): number {
  return PPQN.pulsesToSeconds(row.position + regionPulses(row), PLACEMENT_BPM) + RENDER_TAIL_SECONDS;
}

export interface ClickRead {
  expectedFrame: number;
  /** Frames from the expected centre to the energy centroid of what was read. Null when nothing sounded. */
  centroidError: number | null;
  /** Frames from the expected centre to the largest absolute sample. Null when nothing sounded. */
  peakError: number | null;
  /** The largest absolute sample in the window. */
  peak: number;
  /** The energy's RMS width about its centroid, frames: how far the burst was smeared. */
  spread: number | null;
}

/** One burst, read in `READ_HALF_WINDOW_SECONDS` either side of `expectedFrame`. */
export function readClick(samples: Float32Array, rate: number, expectedFrame: number): ClickRead {
  const half = Math.round(READ_HALF_WINDOW_SECONDS * rate);
  const from = Math.max(0, Math.round(expectedFrame) - half);
  const to = Math.min(samples.length, Math.round(expectedFrame) + half + 1);
  let peak = 0;
  let peakFrame = from;
  let energy = 0;
  let moment = 0;
  for (let n = from; n < to; n++) {
    const value = samples[n];
    const magnitude = Math.abs(value);
    if (magnitude > peak) {
      peak = magnitude;
      peakFrame = n;
    }
    energy += value * value;
    moment += value * value * n;
  }
  if (peak < SOUNDING_FLOOR_PEAK || energy === 0) return { expectedFrame, centroidError: null, peakError: null, peak, spread: null };
  const centroid = moment / energy;
  let variance = 0;
  for (let n = from; n < to; n++) variance += samples[n] * samples[n] * (n - centroid) * (n - centroid);
  return { expectedFrame, centroidError: centroid - expectedFrame, peakError: peakFrame - expectedFrame, peak, spread: Math.sqrt(variance / energy) };
}

export type PlacementStatus = "as-expected" | "investigate" | "unreadable";

export interface PlacementVerdict {
  status: PlacementStatus;
  figure: string;
  values: Readonly<Record<string, number | null>>;
  clicks: readonly ClickRead[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

/** Whether the row's play mode changes the audio: Signalsmith with a stretch or a transpose. Varispeed resamples,
 *  which keeps a burst a burst. */
export function isProcessed(row: PlacementRow): boolean {
  // whole pulses on both sides, so the comparison is exact at any tempo
  const unstretched = Math.round(PPQN.secondsToPulses(SOURCE_SECONDS, PLACEMENT_BPM));
  return row.mode === "signalsmith" && (regionPulses(row) !== unstretched || row.transpose !== 0);
}

/** How far the median burst, and any one burst, may sit from the warp map. */
export function toleranceFrames(row: PlacementRow): { median: number; each: number } {
  return isProcessed(row) ? { median: CENTRED_FRAMES, each: SMEAR_LIMIT_FRAMES } : { median: EXACT_FRAMES, each: EXACT_FRAMES };
}

/**
 * Judge one row's render (one channel). `as-expected` when every burst sounded, the median centroid sits within the
 * row's median tolerance of the warp map and no burst's centroid is further than the row's per-burst tolerance;
 * `unreadable` when any burst did not sound, since a median over the rest would judge a render that lost a click.
 */
export function judgePlacement(row: PlacementRow, samples: Float32Array, rate: number): PlacementVerdict {
  const clicks = expectedFrames(row, rate).map((frame) => readClick(samples, rate, frame));
  const centroids = clicks.flatMap((click) => (click.centroidError === null ? [] : [click.centroidError]));
  const peaks = clicks.flatMap((click) => (click.peakError === null ? [] : [click.peakError]));
  const spreads = clicks.flatMap((click) => (click.spread === null ? [] : [click.spread]));
  if (centroids.length < clicks.length) {
    return {
      status: "unreadable", clicks,
      figure: `${centroids.length} of ${clicks.length} bursts sounded (peak ≥ ${SOUNDING_FLOOR_PEAK})`,
      values: { sounded: centroids.length, medianCentroidFrames: null, medianCentroidMs: null },
    };
  }
  const medianCentroid = median(centroids);
  const tolerance = toleranceFrames(row);
  const worst = Math.max(...centroids.map(Math.abs));
  const values = {
    sounded: centroids.length,
    medianCentroidFrames: round(medianCentroid),
    medianCentroidMs: round((medianCentroid * 1000) / rate, 3),
    minCentroidFrames: round(Math.min(...centroids)),
    maxCentroidFrames: round(Math.max(...centroids)),
    medianPeakFrames: round(median(peaks)),
    medianSpreadFrames: round(median(spreads)),
    medianLevel: round(median(clicks.map((click) => click.peak)), 3),
  };
  const sign = medianCentroid >= 0 ? "+" : "";
  return {
    status: Math.abs(medianCentroid) <= tolerance.median && worst <= tolerance.each ? "as-expected" : "investigate",
    figure: `centroid ${sign}${values.medianCentroidFrames} frames (${sign}${values.medianCentroidMs} ms), ${values.minCentroidFrames} … ${values.maxCentroidFrames}; `
      + `peak ${values.medianPeakFrames}; spread ${values.medianSpreadFrames}; level ${values.medianLevel} (expected: median within ±${tolerance.median}, each within ±${tolerance.each})`,
    values, clicks,
  };
}
