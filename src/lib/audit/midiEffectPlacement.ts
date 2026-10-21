/**
 * The MIDI effect placement audit's two judgements, pure over rendered channels: a
 * pass-through row is judged by cross-correlation against the dry render of the same run, a
 * rule row by its onsets against the frames the device's rule predicts. Register:
 * `debug/2026-10-21-midi-effect-placement/note.md`.
 */
import { bestLag } from "./lagEstimate";
import { firstOnsetIndex } from "./clickHead";

export type RowVerdict =
  | { status: "as-predicted" }
  | { status: "investigate"; figure: string }
  | { status: "error"; message: string };

const msOf = (frames: number, rate: number): string => ((frames / rate) * 1000).toFixed(2);

/** Every onset in `samples`: the first frame above `threshold`, then again from `skipMs` past each hit. */
export function onsetsOf(samples: Float32Array, rate: number, threshold: number, skipMs: number): number[] {
  const skip = Math.round((skipMs / 1000) * rate);
  const onsets: number[] = [];
  for (let from = 0; ; ) {
    const hit = firstOnsetIndex(samples, threshold, from);
    if (hit < 0) return onsets;
    onsets.push(hit);
    from = hit + skip;
  }
}

export interface PassThroughJudgement {
  kind: "pass-through";
  lag: number;
  score: number;
  peak: number;
  verdict: RowVerdict;
}

const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
};

/** Expected lag 0 at a score of at least `scoreFloor`: the chain works in pulses and the instrument
 *  resolves the same pulses to the same frames in both renders. A silent candidate is an error, not a
 *  reading (two zero arrays correlate at lag 0, score 0). */
export function judgePassThrough(reference: Float32Array, candidate: Float32Array, maxLag: number, scoreFloor: number, rate: number): PassThroughJudgement {
  const peak = peakOf(candidate);
  if (peak === 0) {
    return { kind: "pass-through", lag: 0, score: 0, peak, verdict: { status: "error", message: "render is silent (peak 0): the sample did not load or the device muted it" } };
  }
  const { lag, score } = bestLag(reference, candidate, maxLag);
  let verdict: RowVerdict;
  if (score < scoreFloor) {
    verdict = { status: "investigate", figure: `score ${score.toFixed(3)} below ${scoreFloor}: shift outside ±${maxLag} frames or a different render` };
  } else if (lag !== 0) {
    verdict = { status: "investigate", figure: `lag ${lag} frames (${msOf(lag, rate)} ms), score ${score.toFixed(3)}` };
  } else {
    verdict = { status: "as-predicted" };
  }
  return { kind: "pass-through", lag, score, peak, verdict };
}

export interface RuleJudgement {
  kind: "rule";
  onsets: number[];
  expected: number[];
  deltas: number[];
  verdict: RowVerdict;
}

/** The count must match before any figure is read; then every onset within `toleranceFrames` of its expectation. */
export function judgeRule(onsets: readonly number[], expected: readonly number[], toleranceFrames: number, rate: number): RuleJudgement {
  if (onsets.length !== expected.length) {
    return {
      kind: "rule", onsets: [...onsets], expected: [...expected], deltas: [],
      verdict: { status: "investigate", figure: `${onsets.length} onsets, rule predicts ${expected.length}` },
    };
  }
  const deltas = onsets.map((onset, i) => onset - expected[i]);
  let worst = -1;
  deltas.forEach((delta, i) => { if (worst < 0 || Math.abs(delta) > Math.abs(deltas[worst])) worst = i; });
  const verdict: RowVerdict = worst >= 0 && Math.abs(deltas[worst]) > toleranceFrames
    ? { status: "investigate", figure: `onset ${worst} off by ${deltas[worst]} frames (${msOf(deltas[worst], rate)} ms)` }
    : { status: "as-predicted" };
  return { kind: "rule", onsets: [...onsets], expected: [...expected], deltas, verdict };
}
