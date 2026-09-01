/**
 * Pure measurement library for the recording start-alignment audit:
 * reference-click schedule generation, zero-phase band splitting, and
 * click identification/anchor-time estimation.
 *
 * No SDK imports — Float32Array in, numbers (seconds) out — same contract
 * as `onsetDetection.ts`, so these functions can measure a captured
 * recording buffer (or any WAV/PCM buffer) independently of the box graph.
 *
 * Reference schedule: consecutive gaps grow monotonically
 * (`baseGapSec + k·gapIncrementSec` between click k and k+1), so a single
 * measured gap between two consecutive onsets — even from a truncated,
 * arbitrarily-shifted recording — uniquely identifies which pair of
 * schedule indices produced it. That's what lets `identifyReferenceClicks`
 * recover indices (and therefore the buffer's absolute start time) without
 * any prior knowledge of where in the schedule the recording begins.
 *
 * Band split: filtering a click stream to isolate its onset energy must not
 * itself shift onset time, or the shift would be indistinguishable from the
 * alignment error under measurement. A plain (causal) biquad has phase
 * delay that does exactly that, so `bandSplit` runs each biquad forward
 * then backward over the reversed output (filtfilt) — the two passes'
 * phase delays cancel, leaving zero net phase shift at the cost of doubled
 * filter order (attenuation) and non-causality (fine for offline analysis).
 *
 * `measureTakeAlignment`/`classifyCell` extend this file with take-level
 * measurement and cross-repeat cell classification — still pure, still no
 * SDK imports; callers resolve `regionStartSec`/`waveformOffsetSec`/etc.
 * from the box graph before calling in.
 *
 * Assumptions / non-goals (not exercised by the test suite):
 * - Beat matching assumes a constant `bpm` across the measured region (no
 *   tempo automation) — audit cells hold tempo fixed by construction.
 * - `measureTakeAlignment` expects `lowOnsets`/`highOnsets` already
 *   onset-detected and band-split by the caller (see `onsetDetection.ts`,
 *   `bandSplit`) — it does no DSP of its own.
 * - `classifyCell`'s band matching is order-sensitive (first match in the
 *   caller's array wins) — callers with overlapping band ranges must order
 *   them deliberately; this file does not detect or warn on overlap.
 * - Head/tail-missing math assumes `recordRequestContextTime` /
 *   `stopRequestContextTime`, when provided, are on the same AudioContext
 *   clock as the schedule's click times — no cross-clock correction.
 */

export interface ReferenceSchedule {
  times: number[];
  baseGapSec: number;
  gapIncrementSec: number;
}

export interface IdentifiedClick {
  index: number;
  fileTimeSec: number;
}

/**
 * Build a reference click schedule with unique, monotonically growing gaps:
 * the gap between `times[k]` and `times[k+1]` is `baseGapSec + k·gapIncrementSec`.
 * Because every gap length is distinct, a single measured gap between two
 * consecutive detected onsets identifies which schedule indices produced it.
 */
export function buildReferenceSchedule(
  startSec: number,
  count: number,
  baseGapSec: number = 0.25,
  gapIncrementSec: number = 0.005
): ReferenceSchedule {
  const times: number[] = [startSec];
  for (let k = 0; k < count - 1; k++) {
    times.push(times[k] + baseGapSec + k * gapIncrementSec);
  }
  return { times, baseGapSec, gapIncrementSec };
}

function biquadCoeffs(type: "lowpass" | "highpass", f0: number, rate: number) {
  const w0 = (2 * Math.PI * f0) / rate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2 / 1); // Q = sqrt(2)/2 → alpha = sin/ (2Q)
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  if (type === "lowpass") {
    return {
      b0: (1 - cosw) / 2 / a0,
      b1: (1 - cosw) / a0,
      b2: (1 - cosw) / 2 / a0,
      a1: (-2 * cosw) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  return {
    b0: (1 + cosw) / 2 / a0,
    b1: -(1 + cosw) / a0,
    b2: (1 + cosw) / 2 / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Zero-phase (forward-backward) biquad application over a fresh copy — never mutates `x`. */
function filtfilt(x: Float32Array, c: ReturnType<typeof biquadCoeffs>): Float32Array {
  const pass = (input: Float32Array): Float32Array => {
    const y = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const v = c.b0 * input[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = input[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  const forward = pass(x);
  forward.reverse();
  const backward = pass(forward);
  backward.reverse();
  return backward;
}

/**
 * Split `channel` into a low band (below `lowCutoffHz`) and a high band
 * (above `highCutoffHz`) via zero-phase (filtfilt) RBJ biquads (Q = 1/√2),
 * so filtering adds no onset-time bias — a click's peak position survives
 * within ~1ms of its unfiltered location.
 */
export function bandSplit(
  channel: Float32Array,
  sampleRate: number,
  lowCutoffHz: number = 1500,
  highCutoffHz: number = 3000
): { low: Float32Array; high: Float32Array } {
  const low = filtfilt(channel, biquadCoeffs("lowpass", lowCutoffHz, sampleRate));
  const high = filtfilt(channel, biquadCoeffs("highpass", highCutoffHz, sampleRate));
  return { low, high };
}

/**
 * Recover which schedule indices produced `onsets` (buffer-relative
 * seconds, ascending) and the buffer's start context-time offset.
 *
 * Pass 1 — index recovery: for each consecutive onset pair, the gap
 * uniquely identifies a schedule index `i` (the growing-gap design);
 * accepted pairs vote `T0 = times[i] − onsets[k]`, and the median vote
 * becomes the working anchor.
 *
 * Pass 2 — final assignment: every onset is assigned to its nearest
 * schedule time under that anchor, kept only within `gapToleranceSec·2`,
 * with duplicate/outlier assignments (a spurious onset close to a real
 * click, or two onsets competing for one schedule slot) resolved by
 * preferring the closer match. This second pass — not pass 1 — is what
 * drops a spurious onset that happens to fall near a real click.
 */
export function identifyReferenceClicks(
  onsets: number[],
  schedule: ReferenceSchedule,
  gapToleranceSec: number = 0.002
): IdentifiedClick[] {
  if (onsets.length < 2) return [];

  const { times, baseGapSec, gapIncrementSec } = schedule;

  const votes: number[] = [];
  for (let k = 0; k < onsets.length - 1; k++) {
    const gap = onsets[k + 1] - onsets[k];
    const i = Math.round((gap - baseGapSec) / gapIncrementSec);
    if (i < 0 || i >= times.length - 1) continue;
    const expected = baseGapSec + i * gapIncrementSec;
    if (Math.abs(gap - expected) > gapToleranceSec) continue;
    votes.push(times[i] - onsets[k]);
  }
  if (votes.length === 0) return [];

  votes.sort((a, b) => a - b);
  const midVote = Math.floor(votes.length / 2);
  const anchorT0 =
    votes.length % 2 === 1 ? votes[midVote] : (votes[midVote - 1] + votes[midVote]) / 2;

  const assignTolerance = gapToleranceSec * 2;
  const candidates: { onsetIdx: number; scheduleIdx: number; diff: number }[] = [];
  for (let o = 0; o < onsets.length; o++) {
    const contextTime = onsets[o] + anchorT0;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i] - contextTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestDiff <= assignTolerance) {
      candidates.push({ onsetIdx: o, scheduleIdx: bestIdx, diff: bestDiff });
    }
  }

  // Resolve duplicates (two onsets competing for one schedule slot, or one
  // onset in range of two slots) by accepting the closest matches first.
  candidates.sort((a, b) => a.diff - b.diff);
  const usedSchedule = new Set<number>();
  const usedOnset = new Set<number>();
  const result: IdentifiedClick[] = [];
  for (const c of candidates) {
    if (usedSchedule.has(c.scheduleIdx) || usedOnset.has(c.onsetIdx)) continue;
    usedSchedule.add(c.scheduleIdx);
    usedOnset.add(c.onsetIdx);
    result.push({ index: c.scheduleIdx, fileTimeSec: onsets[c.onsetIdx] });
  }
  result.sort((a, b) => a.index - b.index);
  return result;
}

/**
 * Median, over identified clicks, of `schedule.times[index] − fileTimeSec`
 * — the context time of the buffer's first frame. `null` when `identified`
 * is empty.
 */
export function estimateAnchorT0(
  identified: IdentifiedClick[],
  schedule: ReferenceSchedule
): number | null {
  if (identified.length === 0) return null;
  const diffs = identified
    .map((c) => schedule.times[c.index] - c.fileTimeSec)
    .sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 === 1 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TakeMeasurementInput {
  lowOnsets: number[]; // file-time onsets (s), metronome band
  highOnsets: number[]; // file-time onsets (s), reference band
  regionStartSec: number; // tempoMap.ppqnToSeconds(region position)
  waveformOffsetSec: number;
  regionDurationSec: number;
  bufferDurationSec: number; // data.numberOfFrames / data.sampleRate
  bpm: number;
  countInBeats: number; // 0 when recording started without count-in
  schedule: ReferenceSchedule;
  recordRequestContextTime: number | null; // audioContext.currentTime captured just before startRecording; null if unavailable
  stopRequestContextTime: number | null; // audioContext.currentTime captured just before stopRecording; null if unavailable
}

export interface TakeAlignment {
  beatErrors: { beat: number; errorMs: number }[]; // signed; beat 0 = region start
  medianBeatErrorMs: number | null; // null when no beats matched
  anchorT0Sec: number | null;
  firstRefIndex: number | null;
  headMissingMs: number | null; // signal after the record request that never entered the buffer, in ms; null when not computable
  tailMissingMs: number | null; // signal before the stop request missing from the buffer tail: max(0, stopRequestContextTime − (anchorT0 + bufferDurationSec)) * 1000; null when not computable
  matchedBeats: number;
  missingBeats: number;
  extraLowOnsets: number;
}

/**
 * Measure a single take's alignment against the region's expected beat
 * grid, and (when reference clicks are present) against the AudioContext
 * clock via `identifyReferenceClicks`/`estimateAnchorT0`.
 *
 * Expected beats run `k = 0 … floor((regionDurationSec − ε) / beatPeriod)`
 * — the `ε` excludes a beat landing exactly on the region-end boundary
 * (which a boundary-stopped live capture would otherwise always report as
 * missing) without excluding any beat that actually falls inside the
 * presented range.
 */
export function measureTakeAlignment(input: TakeMeasurementInput): TakeAlignment {
  const {
    lowOnsets, highOnsets, regionStartSec, waveformOffsetSec, regionDurationSec,
    bufferDurationSec, bpm, schedule, recordRequestContextTime, stopRequestContextTime,
  } = input;

  const beatPeriodSec = 60 / bpm;
  const timelineOnsets = lowOnsets.map((t) => regionStartSec + (t - waveformOffsetSec));

  const lastBeat = Math.floor((regionDurationSec - 0.001) / beatPeriodSec);
  const expectedBeats: number[] = [];
  for (let k = 0; k <= lastBeat; k++) expectedBeats.push(regionStartSec + k * beatPeriodSec);

  // Greedy nearest-first matching within half a beat period.
  const matchTolerance = beatPeriodSec / 2;
  const candidates: { beatK: number; onsetIdx: number; diff: number }[] = [];
  for (let k = 0; k < expectedBeats.length; k++) {
    for (let o = 0; o < timelineOnsets.length; o++) {
      const diff = Math.abs(timelineOnsets[o] - expectedBeats[k]);
      if (diff <= matchTolerance) candidates.push({ beatK: k, onsetIdx: o, diff });
    }
  }
  candidates.sort((a, b) => a.diff - b.diff);
  const usedBeat = new Set<number>();
  const usedOnset = new Set<number>();
  const beatErrors: { beat: number; errorMs: number }[] = [];
  for (const c of candidates) {
    if (usedBeat.has(c.beatK) || usedOnset.has(c.onsetIdx)) continue;
    usedBeat.add(c.beatK);
    usedOnset.add(c.onsetIdx);
    const errorMs = (timelineOnsets[c.onsetIdx] - expectedBeats[c.beatK]) * 1000;
    beatErrors.push({ beat: c.beatK, errorMs });
  }
  beatErrors.sort((a, b) => a.beat - b.beat);

  const matchedBeats = usedBeat.size;
  const missingBeats = expectedBeats.length - matchedBeats;

  // Extra low onsets: onsets inside the presented range with no matched beat.
  const rangeStart = regionStartSec;
  const rangeEnd = regionStartSec + regionDurationSec;
  let extraLowOnsets = 0;
  for (let o = 0; o < timelineOnsets.length; o++) {
    if (usedOnset.has(o)) continue;
    if (timelineOnsets[o] >= rangeStart && timelineOnsets[o] <= rangeEnd) extraLowOnsets++;
  }

  const medianBeatErrorMs = median(beatErrors.map((e) => e.errorMs));

  const identified = identifyReferenceClicks(highOnsets, schedule);
  const anchorT0Sec = estimateAnchorT0(identified, schedule);
  const firstRefIndex = identified.length > 0 ? identified[0].index : null;

  const headMissingMs =
    anchorT0Sec !== null && recordRequestContextTime !== null
      ? Math.max(0, anchorT0Sec - recordRequestContextTime) * 1000
      : null;

  const tailMissingMs =
    anchorT0Sec !== null && stopRequestContextTime !== null
      ? Math.max(0, stopRequestContextTime - (anchorT0Sec + bufferDurationSec)) * 1000
      : null;

  return {
    beatErrors,
    medianBeatErrorMs,
    anchorT0Sec,
    firstRefIndex,
    headMissingMs,
    tailMissingMs,
    matchedBeats,
    missingBeats,
    extraLowOnsets,
  };
}

export type CellStatus = "aligned" | "matches-known-defect" | "investigate";

export interface SignatureBand {
  id: "A" | "B" | "C" | "D";
  kind: "random-band" | "constant-late" | "head-loss";
  minAbsMs: number;
  maxAbsMs: number;
}

export interface CellClassification {
  status: CellStatus;
  matchedSignature: SignatureBand["id"] | null;
  detail: string;
}

/**
 * Classify a cell (a group of repeated takes of the same scenario/rate/bpm
 * combination) as `aligned`, a known upstream defect signature, or
 * `investigate`. A repeat with no matched median, missing beats, or a
 * head/tail deficit beyond tolerance forces `investigate` unless a
 * `head-loss` band matches the deficit — those are structural failures, not
 * alignment error, and no signature band should paper over them. Tail
 * deficits are treated exactly like head deficits (same tolerance check,
 * same `head-loss` band exception) — the brief has no separate "tail-loss"
 * band kind.
 */
export function classifyCell(
  repeats: TakeAlignment[],
  bands: SignatureBand[],
  alignedToleranceMs: number
): CellClassification {
  const headLossBand = bands.find((b) => b.kind === "head-loss");
  const excusedByHeadLossBand = (deficitMs: number) =>
    headLossBand !== undefined && deficitMs >= headLossBand.minAbsMs && deficitMs <= headLossBand.maxAbsMs;
  for (const r of repeats) {
    const headDeficitBroken =
      r.headMissingMs !== null &&
      r.headMissingMs > alignedToleranceMs &&
      !excusedByHeadLossBand(r.headMissingMs);
    const tailDeficitBroken =
      r.tailMissingMs !== null &&
      r.tailMissingMs > alignedToleranceMs &&
      !excusedByHeadLossBand(r.tailMissingMs);
    if (r.medianBeatErrorMs === null || r.missingBeats > 0 || headDeficitBroken || tailDeficitBroken) {
      return {
        status: "investigate",
        matchedSignature: null,
        detail: `repeat has unusable measurement: medianBeatErrorMs=${r.medianBeatErrorMs}, missingBeats=${r.missingBeats}, headMissingMs=${r.headMissingMs}, tailMissingMs=${r.tailMissingMs}`,
      };
    }
  }

  const medians = repeats.map((r) => r.medianBeatErrorMs!);
  const detailMedians = medians.map((m) => m.toFixed(2)).join(", ");
  const headDeficits = repeats.map((r) => r.headMissingMs).join(", ");
  const tailDeficits = repeats.map((r) => r.tailMissingMs).join(", ");
  const spread = Math.max(...medians) - Math.min(...medians);
  const mean = medians.reduce((a, b) => a + b, 0) / medians.length;
  const detailSuffix = `medians=[${detailMedians}] spread=${spread.toFixed(2)}ms headMissingMs=[${headDeficits}] tailMissingMs=[${tailDeficits}]`;

  if (medians.every((m) => Math.abs(m) <= alignedToleranceMs)) {
    return {
      status: "aligned",
      matchedSignature: null,
      detail: `all repeats within ${alignedToleranceMs}ms tolerance: ${detailSuffix}`,
    };
  }

  for (const band of bands) {
    if (band.kind === "random-band") {
      const withinBand = medians.every((m) => Math.abs(m) <= band.maxAbsMs);
      const reachesMin = medians.some((m) => Math.abs(m) >= band.minAbsMs);
      if (spread > 2 * alignedToleranceMs && withinBand && reachesMin) {
        return {
          status: "matches-known-defect",
          matchedSignature: band.id,
          detail: `random-band ${band.id}: ${detailSuffix}`,
        };
      }
    } else if (band.kind === "constant-late") {
      // Not gated on spread: random-band bands (checked earlier in the
      // caller's array) already claim scattered-but-in-range data via their
      // own spread>2·tol test, so a redundant spread cap here only risks
      // rejecting genuine constant-late repeats with a few ms of ordinary
      // jitter (measured: real repeats land a spread of ~7ms against a 2ms
      // tolerance, well outside a literal 2·tol cap).
      if (mean > 0 && mean >= band.minAbsMs && mean <= band.maxAbsMs) {
        return {
          status: "matches-known-defect",
          matchedSignature: band.id,
          detail: `constant-late ${band.id}: mean=${mean.toFixed(2)}ms ${detailSuffix}`,
        };
      }
    } else if (band.kind === "head-loss") {
      const everyHeadInBand = repeats.every(
        (r) => r.headMissingMs !== null && r.headMissingMs >= band.minAbsMs && r.headMissingMs <= band.maxAbsMs
      );
      if (everyHeadInBand) {
        return {
          status: "matches-known-defect",
          matchedSignature: band.id,
          detail: `head-loss ${band.id}: ${detailSuffix}`,
        };
      }
    }
  }

  return {
    status: "investigate",
    matchedSignature: null,
    detail: `no band matched: mean=${mean.toFixed(2)}ms ${detailSuffix}`,
  };
}
