import { bestLag } from "./lagEstimate.ts";

export const ROUNDING_DB = -100;
const MAX_LAG = 256;
const MIN_SCORE = 0.5;

export type RenderDiff = {
  kind: "identical" | "bit-only" | "rounding-sized" | "different";
  acceptedFrames: number;
  nextFrames: number;
  firstDifferingFrame: number | null;
  largestDifference: number;
  largestDifferenceDb: number | null;
  shiftFrames: number | null;
};

/**
 * Compares bit patterns, so NaN and -0 count as differences. A change of channel count or frame count is
 * `different` by itself; the figures then cover the shared frames. A shift is only read when something differs.
 */
export function diffRenders(accepted: readonly Float32Array[], next: readonly Float32Array[]): RenderDiff {
  const acceptedFrames = accepted[0]?.length ?? 0;
  const nextFrames = next[0]?.length ?? 0;
  const shared = Math.min(acceptedFrames, nextFrames);
  const sharedChannels = Math.min(accepted.length, next.length);
  let firstDifferingFrame: number | null = null;
  let largestDifference = 0;
  for (let c = 0; c < sharedChannels; c++) {
    const a = accepted[c];
    const n = next[c];
    const aBits = new Uint32Array(a.buffer, a.byteOffset, a.length);
    const nBits = new Uint32Array(n.buffer, n.byteOffset, n.length);
    for (let f = 0; f < shared; f++) {
      if (aBits[f] === nBits[f]) continue;
      if (firstDifferingFrame === null || f < firstDifferingFrame) firstDifferingFrame = f;
      const delta = Math.abs(a[f] - n[f]);
      // NaN against anything, or an infinity, is no figure: it is as large as a difference gets
      largestDifference = Number.isNaN(delta) ? Infinity : Math.max(largestDifference, delta);
    }
  }
  const sameShape = accepted.length === next.length && acceptedFrames === nextFrames;
  const largestDifferenceDb = largestDifference > 0 ? 20 * Math.log10(largestDifference) : null;
  const base = { acceptedFrames, nextFrames, firstDifferingFrame, largestDifference, largestDifferenceDb };
  if (sameShape && firstDifferingFrame === null) return { kind: "identical", ...base, shiftFrames: null };
  const shiftFrames = readShift(accepted, next, shared);
  let kind: RenderDiff["kind"];
  if (!sameShape || (shiftFrames !== null && shiftFrames !== 0)) kind = "different";
  else if (largestDifference === 0) kind = "bit-only";
  else kind = largestDifferenceDb! < ROUNDING_DB ? "rounding-sized" : "different";
  return { kind, ...base, shiftFrames };
}

/** Channel 1 carries the impulse in the stereo signals; a mono render has only channel 0. */
function readShift(accepted: readonly Float32Array[], next: readonly Float32Array[], shared: number): number | null {
  const channel = Math.min(1, accepted.length - 1, next.length - 1);
  if (channel < 0 || shared <= 2 * MAX_LAG) return null;
  const reference = accepted[channel].subarray(0, shared);
  const candidate = next[channel].subarray(0, shared);
  for (let i = 0; i < shared; i++) {
    if (!Number.isFinite(reference[i]) || !Number.isFinite(candidate[i])) return null;
  }
  const { lag, score } = bestLag(reference, candidate, MAX_LAG);
  return score < MIN_SCORE ? null : lag;
}
