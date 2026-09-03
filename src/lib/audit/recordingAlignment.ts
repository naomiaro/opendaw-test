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
 * - Beat matching assumes a constant `bpm` from timeline zero through the end
 *   of the measured region (no tempo automation) — the expected-beat grid is
 *   absolute (multiples of the beat period from timeline zero), so a tempo
 *   change anywhere BEFORE the region would shift the grid under it, not just
 *   one inside the region. Audit cells hold tempo fixed by construction.
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
  schedule: ReferenceSchedule;
  recordRequestContextTime: number | null; // audioContext.currentTime captured just before startRecording; null if unavailable
  stopRequestContextTime: number | null; // audioContext.currentTime captured just before stopRecording; null if unavailable
  /**
   * Calibrated baseline (ms), subtracted from the raw head-missing figure
   * (clamped at 0) before classification — see `HEAD_MISSING_BASELINE_MS` in
   * `recordingAuditCalibration.ts` for the measurement and the caveat on
   * what the clamp hides. What the raw figure IS on the installed SDK: the
   * `RecordingWorklet.#finalize` head drop — finalization keeps the LAST
   * `limit` frames of the ring (`frame.slice(-limit)`), so the buffer's first
   * frame, as the loopback's reference clicks locate it, sits the ring's
   * overshoot past the true first captured frame, minus the loopback path's
   * own delay. It is a real, discarded head, not a setup gap: the SDK's first
   * captured frame follows the request by 0-3 render quanta, and a build that
   * keeps the buffer head measures a raw value of 0 on every row. The
   * baseline is an empirical constant for the installed build's rows; a
   * scenario's predicted head loss must exceed it to be visible after the
   * clamp. Default 0 (no correction) when the caller has no measured baseline.
   */
  headMissingBaselineMs?: number;
  /**
   * Task 7 recast: harness-path bias (seconds), added onto every beat's raw
   * signed error before computing `medianBeatErrorMsAdjusted` — the runtime
   * value is `audioContext.outputLatency`, the register's "term 1". The SDK
   * adds `outputLatency` to take 1's `waveformOffset` on every recording,
   * count-in or not (`RecordAudio`: `headStart + countIn + outputLatency +
   * inputLatency`) — a real hardware round-trip cost this harness's digital
   * loopback never incurs, so the compensation is unearned here and the
   * harness nets it back out on every scenario (see
   * debug/recording-start-alignment-audit.md "Bring-up calibration"). Content
   * that lands exactly `harnessPathBiasSec` early nets to ~0 adjusted error.
   * Default 0 (adjusted equals raw) when the caller has no measured bias. The
   * raw median is NEVER modified — both are always available on the result.
   */
  harnessPathBiasSec?: number;
}

export interface TakeAlignment {
  /**
   * Signed placement error per matched beat. `beat` is the ABSOLUTE timeline
   * beat index (position ÷ beat period from timeline zero), not an index
   * counted from the region start — see `measureTakeAlignment`'s expected-beat
   * derivation for why the grid is absolute.
   */
  beatErrors: { beat: number; errorMs: number }[];
  medianBeatErrorMs: number | null; // null when no beats matched
  /**
   * `medianBeatErrorMs + harnessPathBiasSec * 1000` — null exactly when the
   * raw median is null (no beats matched). `classifyCell` verdicts run on
   * THIS field, not the raw one; the raw field is preserved unmodified so it
   * stays independently auditable. See `TakeMeasurementInput.harnessPathBiasSec`.
   */
  medianBeatErrorMsAdjusted: number | null;
  anchorT0Sec: number | null;
  firstRefIndex: number | null;
  headMissingMs: number | null; // signal after the record request that never entered the buffer, in ms; null when not computable
  tailMissingMs: number | null; // signal before the stop request missing from the buffer tail: max(0, stopRequestContextTime − (anchorT0 + bufferDurationSec)) * 1000; null when not computable
  matchedBeats: number;
  missingBeats: number;
  extraLowOnsets: number;
}

/**
 * Measure a single take's alignment against the project's beat grid, and
 * (when reference clicks are present) against the AudioContext clock via
 * `identifyReferenceClicks`/`estimateAnchorT0`.
 *
 * Expected beats sit on the project's ABSOLUTE beat grid — integer multiples
 * of `beatPeriodSec` from timeline zero — restricted to the take's presented
 * range `[regionStartSec, regionStartSec + regionDurationSec]` (see
 * `expectedBeatRange` for the 1 µs / 1 ms edge slack and why a beat within
 * 1 ms of the region end is deliberately excluded).
 *
 * The grid is deliberately NOT anchored at the region start. Anchoring it
 * there silently assumes every take begins on a beat, which holds for a take
 * started from a stopped transport (position 0), after a count-in, or at a
 * loop boundary — but NOT for one punched in while the transport is already
 * running, where the region lands wherever the punch fell. On such a take an
 * anchored grid manufactures a phantom expected beat at the region boundary
 * that no captured beat can ever reach (the first captured beat is up to a
 * full beat period later), reporting a permanent `missingBeats = 1` and
 * biasing every beat's error by the region start's off-grid phase. Measuring
 * against the absolute grid makes the reported error mean what it should:
 * how far each captured beat lands from the timeline position it was
 * captured at. For beat-aligned regions the two grids are identical, so this
 * changes nothing for takes that start on a beat, and genuine head loss is
 * still caught — a beat inside the presented range whose content never
 * reached the buffer stays unmatched under both grids.
 */
/**
 * The absolute beat indices `measureTakeAlignment` expects inside a take's
 * presented range `[regionStartSec, regionStartSec + regionDurationSec]`:
 * `firstBeat .. lastBeat` inclusive (empty when `lastBeat < firstBeat`).
 * Exported so an offline replay can enumerate the same grid the verdicts used
 * instead of re-implementing the fence.
 *
 * 1 microsecond of slack on the leading edge so a region whose start is a
 * beat position that only round-trips approximately (PPQN -> seconds) still
 * includes that beat instead of skipping to the next one; 1 ms of slack on the
 * trailing edge excludes a beat landing on (or within 1 ms before) the
 * region-end boundary, which a boundary-stopped live capture would otherwise
 * always report as missing.
 */
export function expectedBeatRange(
  regionStartSec: number,
  regionDurationSec: number,
  bpm: number
): { firstBeat: number; lastBeat: number } {
  const beatPeriodSec = 60 / bpm;
  return {
    firstBeat: Math.ceil((regionStartSec - 1e-6) / beatPeriodSec),
    lastBeat: Math.floor((regionStartSec + regionDurationSec - 0.001) / beatPeriodSec),
  };
}

export function measureTakeAlignment(input: TakeMeasurementInput): TakeAlignment {
  const {
    lowOnsets, highOnsets, regionStartSec, waveformOffsetSec, regionDurationSec,
    bufferDurationSec, bpm, schedule, recordRequestContextTime, stopRequestContextTime,
    headMissingBaselineMs = 0, harnessPathBiasSec = 0,
  } = input;

  const beatPeriodSec = 60 / bpm;
  const timelineOnsets = lowOnsets.map((t) => regionStartSec + (t - waveformOffsetSec));

  const { firstBeat, lastBeat } = expectedBeatRange(regionStartSec, regionDurationSec, bpm);
  const expectedBeats: number[] = [];
  const expectedBeatIndices: number[] = [];
  for (let k = firstBeat; k <= lastBeat; k++) {
    expectedBeats.push(k * beatPeriodSec);
    expectedBeatIndices.push(k);
  }

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
    beatErrors.push({ beat: expectedBeatIndices[c.beatK], errorMs });
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
  const medianBeatErrorMsAdjusted =
    medianBeatErrorMs === null ? null : medianBeatErrorMs + harnessPathBiasSec * 1000;

  const identified = identifyReferenceClicks(highOnsets, schedule);
  const anchorT0Sec = estimateAnchorT0(identified, schedule);
  const firstRefIndex = identified.length > 0 ? identified[0].index : null;

  const headMissingMs =
    anchorT0Sec !== null && recordRequestContextTime !== null
      ? Math.max(0, (anchorT0Sec - recordRequestContextTime) * 1000 - headMissingBaselineMs)
      : null;

  const tailMissingMs =
    anchorT0Sec !== null && stopRequestContextTime !== null
      ? Math.max(0, stopRequestContextTime - (anchorT0Sec + bufferDurationSec)) * 1000
      : null;

  return {
    beatErrors,
    medianBeatErrorMs,
    medianBeatErrorMsAdjusted,
    anchorT0Sec,
    firstRefIndex,
    headMissingMs,
    tailMissingMs,
    matchedBeats,
    missingBeats,
    extraLowOnsets,
  };
}

export interface CrossTrackSkew {
  /** Per beat present in BOTH alignments' `beatErrors`, sorted by beat index. */
  perBeatSkewMs: { beat: number; skewMs: number }[];
  /** Median of `perBeatSkewMs[*].skewMs`; null when no beats paired. */
  medianSkewMs: number | null;
  /** Max absolute skew across paired beats; null when no beats paired. */
  maxAbsSkewMs: number | null;
  /** Count of beats matched in BOTH alignments — the sample size the two above stats are drawn from. */
  pairedBeats: number;
}

/**
 * Measure inter-track skew between two tapes recorded from CLONES of the same
 * loopback signal (see `loopbackDeviceId` in `loopbackInjection.ts`): every
 * common bias — loopback-path latency, the harness-path/`outputLatency` term,
 * the metronome content itself, the reference-click schedule — is identical
 * in both tapes' captured buffers, so it cancels out of the DIFFERENCE
 * between their beat errors. What's left is genuine inter-track skew: each
 * armed tape gets its own RecordingWorklet and places its take using that
 * worklet's own frame counter + the position observed at ITS OWN creation,
 * so two tracks recording the same instant can still land at different
 * timeline positions.
 *
 * Pairs by beat index over beats matched in BOTH `a.beatErrors` and
 * `b.beatErrors` (a beat missing from either side is simply excluded, not
 * treated as an error here — `measureTakeAlignment`'s own `missingBeats`
 * count is the place a genuine content-skip is caught). Those indices are
 * ABSOLUTE timeline beat numbers, so two tapes whose regions landed at
 * different positions still pair beat-for-beat on the same musical instant —
 * a region-relative index would offset one tape's whole series against the
 * other's and read the offset as skew.
 *
 * Sign convention: `skewMs = b's errorMs − a's errorMs`. A positive skew
 * means B's content is placed LATE relative to A's (B lags A); a negative
 * skew means B is EARLY relative to A. This is symmetric in the sense that
 * swapping the two arguments negates every skew value — callers should keep
 * a consistent "tape A" / "tape B" assignment across a whole cell so the
 * sign stays comparable across repeats.
 */
export function measureCrossTrackSkew(a: TakeAlignment, b: TakeAlignment): CrossTrackSkew {
  const bByBeat = new Map(b.beatErrors.map((e) => [e.beat, e.errorMs]));
  const perBeatSkewMs = a.beatErrors
    .filter((e) => bByBeat.has(e.beat))
    .map((e) => ({ beat: e.beat, skewMs: bByBeat.get(e.beat)! - e.errorMs }))
    .sort((x, y) => x.beat - y.beat);

  const skews = perBeatSkewMs.map((s) => s.skewMs);
  return {
    perBeatSkewMs,
    medianSkewMs: median(skews),
    maxAbsSkewMs: skews.length === 0 ? null : Math.max(...skews.map(Math.abs)),
    pairedBeats: perBeatSkewMs.length,
  };
}

export type CellStatus = "aligned" | "matches-known-defect" | "investigate";

export interface SignatureBand {
  // A-D: the campaign's predicted upstream signatures. E-F: the measured
  // signatures of the calibration branch's keep-alive build. Which set applies
  // is chosen per artifact by its persisted `buildFeatures` list, with the build
  // probe and run token as the fallback for artifacts written before that field
  // — see `profileKeyFor` / `RECORDING_AUDIT_PROFILES` in
  // recordingAuditCalibration.ts.
  id: "A" | "B" | "C" | "D" | "E" | "F";
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
 * `investigate`.
 *
 * Deficit handling (checked before the median-based verdict, so a genuine
 * deficit is never hidden behind otherwise-clean beat placement):
 * - An empty repeat list is `investigate` — a cell with no evidence must never
 *   read as the best verdict (the `every()` below is vacuously true on `[]`).
 * - A repeat with no matched median or missing beats is always unusable —
 *   forces `investigate`.
 * - A repeat whose `headMissingMs` is null is "integrity unmeasured" — forces
 *   `investigate`. `measureTakeAlignment` yields a null head deficit exactly
 *   when no reference click was identified (`anchorT0Sec` null) or no record
 *   request time was captured, and then the head AND tail gates below would
 *   both be skipped silently, letting a repeat whose reference schedule never
 *   reached the buffer classify `aligned` with no integrity check at all. A
 *   null `tailMissingMs` alongside a MEASURED head is not flagged: it only
 *   arises for offline reconstructions from rows persisted before the tail
 *   figure was (the row was anchored live; only the tail gate is unavailable,
 *   and the detail string shows the null).
 * - A **tail** deficit (`tailMissingMs > alignedToleranceMs` on any repeat)
 *   ALWAYS forces `investigate` — no band excuses it (no configured
 *   `SignatureBand` predicts tail loss; only head loss is predicted).
 * - A **head** deficit (`headMissingMs > alignedToleranceMs` on any repeat):
 *   if a `head-loss` band's range covers every repeat's `headMissingMs`,
 *   the cell matches THAT band — this is checked even when every repeat's
 *   beat median is already within tolerance, because the predicted head-loss
 *   defect (the SDK advancing the region position so content stays aligned)
 *   typically presents with aligned medians; hiding it behind an "aligned"
 *   verdict would mask exactly the case this audit exists to catch. If no
 *   band covers it, `investigate`.
 * - Only once both are clear does classification fall to the median-based
 *   verdict: `aligned` when every repeat is within tolerance, else the
 *   `random-band`/`constant-late` bands in caller order, else `investigate`.
 *
 * Task 7 recast: the median-based verdict (aligned / random-band / constant-late)
 * runs on each repeat's `medianBeatErrorMsAdjusted` (raw + harnessPathBiasSec·1000
 * — see `TakeMeasurementInput.harnessPathBiasSec`), NOT `medianBeatErrorMs`. The
 * "unusable measurement" check above still gates on the RAW field being null
 * (structural — no beats matched at all, independent of any bias adjustment).
 * Head/tail deficit gating is unaffected — those run on headMissingMs/tailMissingMs,
 * which the harness-path adjustment does not touch.
 */
export function classifyCell(
  repeats: TakeAlignment[],
  bands: SignatureBand[],
  alignedToleranceMs: number
): CellClassification {
  if (repeats.length === 0) {
    return { status: "investigate", matchedSignature: null, detail: "no repeats to classify" };
  }
  for (const r of repeats) {
    if (r.medianBeatErrorMs === null || r.missingBeats > 0) {
      return {
        status: "investigate",
        matchedSignature: null,
        detail: `repeat has unusable measurement: medianBeatErrorMs=${r.medianBeatErrorMs}, missingBeats=${r.missingBeats}`,
      };
    }
    if (r.headMissingMs === null) {
      return {
        status: "investigate",
        matchedSignature: null,
        detail: `integrity unmeasured: headMissingMs is null (no reference-click anchor for this repeat, so neither the head nor the tail gate could run); medianBeatErrorMsAdjusted=${r.medianBeatErrorMsAdjusted}`,
      };
    }
  }

  const medians = repeats.map((r) => r.medianBeatErrorMsAdjusted!);
  const detailMedians = medians.map((m) => m.toFixed(2)).join(", ");
  const headDeficits = repeats.map((r) => r.headMissingMs).join(", ");
  const tailDeficits = repeats.map((r) => r.tailMissingMs).join(", ");
  const spread = Math.max(...medians) - Math.min(...medians);
  const mean = medians.reduce((a, b) => a + b, 0) / medians.length;
  const detailSuffix = `medians=[${detailMedians}] spread=${spread.toFixed(2)}ms headMissingMs=[${headDeficits}] tailMissingMs=[${tailDeficits}]`;

  // Tail deficit: unconditional investigate, never excusable by any band.
  const hasTailDeficit = repeats.some(
    (r) => r.tailMissingMs !== null && r.tailMissingMs > alignedToleranceMs
  );
  if (hasTailDeficit) {
    return {
      status: "investigate",
      matchedSignature: null,
      detail: `tail deficit exceeds ${alignedToleranceMs}ms tolerance (no band excuses tail loss): ${detailSuffix}`,
    };
  }

  // Head deficit: excusable only by a head-loss band covering every repeat.
  const hasHeadDeficit = repeats.some(
    (r) => r.headMissingMs !== null && r.headMissingMs > alignedToleranceMs
  );
  if (hasHeadDeficit) {
    const headLossBand = bands.find(
      (b) =>
        b.kind === "head-loss" &&
        repeats.every(
          (r) => r.headMissingMs !== null && r.headMissingMs >= b.minAbsMs && r.headMissingMs <= b.maxAbsMs
        )
    );
    if (headLossBand !== undefined) {
      return {
        status: "matches-known-defect",
        matchedSignature: headLossBand.id,
        detail: `head-loss ${headLossBand.id}: ${detailSuffix}`,
      };
    }
    return {
      status: "investigate",
      matchedSignature: null,
      detail: `head deficit exceeds ${alignedToleranceMs}ms tolerance, no head-loss band covers it: ${detailSuffix}`,
    };
  }

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
    }
    // head-loss bands are resolved above (before the median-based verdict),
    // not here — a cell only reaches this loop once no repeat has a head or
    // tail deficit, at which point no head-loss band could match anyway.
  }

  return {
    status: "investigate",
    matchedSignature: null,
    detail: `no band matched: mean=${mean.toFixed(2)}ms ${detailSuffix}`,
  };
}

export interface MultitrackCellVerdict {
  status: CellStatus;
  detail: string;
}

/**
 * Cell verdict for a multitrack scenario: `aligned` when every repeat's
 * skew magnitude is within `alignedToleranceMs` AND both tapes' own
 * per-take alignment independently classifies as clean (not `investigate`)
 * against the equivalent single-tape scenario's bands —
 * otherwise `investigate`. There is no `matches-known-defect` outcome for
 * skew itself: no signature band predicts it (the single-tape sections
 * never provoked or measured simultaneous capture), so any measured skew
 * beyond tolerance is a candidate finding, named directly in the detail
 * string rather than mapped onto a band.
 *
 * NOTE for anyone quoting an `aligned` multitrack cell: it means the two tapes
 * agree with EACH OTHER to within the tolerance and neither tape's own cell
 * classified `investigate`. It does NOT mean the takes landed on the beat — a
 * cell whose two tapes are both 22 ms late in the same direction is `aligned`
 * here, because the skew that this scenario exists to measure is zero. Read the
 * per-tape verdicts beside it.
 *
 * Lives here rather than on the harness page so the offline scripts classify a
 * persisted multitrack run exactly as the page did; `alignedToleranceMs` is a
 * parameter for the same reason `classifyCell` takes one.
 */
export function classifyMultitrackCell(
  tapeAClass: CellClassification,
  tapeBClass: CellClassification,
  repeatSkews: CrossTrackSkew[],
  alignedToleranceMs: number
): MultitrackCellVerdict {
  if (repeatSkews.length === 0) {
    return {
      status: "investigate",
      detail: `no successful repeats to measure skew (tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status})`,
    };
  }
  const usable = repeatSkews.filter((s) => s.medianSkewMs !== null);
  if (usable.length !== repeatSkews.length) {
    return {
      status: "investigate",
      detail: `skew unusable (0 paired beats) on ${repeatSkews.length - usable.length}/${repeatSkews.length} successful repeat(s) — tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status}`,
    };
  }
  const medians = usable.map((s) => s.medianSkewMs!);
  const skewDetail = `medianSkewMs per repeat=[${medians.map((m) => m.toFixed(2)).join(", ")}] maxAbsMedianSkewMs=${Math.max(...medians.map(Math.abs)).toFixed(2)}`;
  const tapesClean = tapeAClass.status !== "investigate" && tapeBClass.status !== "investigate";
  const skewClean = medians.every((m) => Math.abs(m) <= alignedToleranceMs);
  if (skewClean && tapesClean) {
    return {
      status: "aligned",
      detail: `skew within ${alignedToleranceMs}ms tolerance on every repeat and both tapes individually clean (tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status}) — ${skewDetail}`,
    };
  }
  if (!tapesClean) {
    return {
      status: "investigate",
      detail: `at least one tape's own per-take alignment did not classify clean (tapeA=${tapeAClass.status}: ${tapeAClass.detail}; tapeB=${tapeBClass.status}: ${tapeBClass.detail}) — ${skewDetail}`,
    };
  }
  return {
    status: "investigate",
    detail: `skew exceeds ${alignedToleranceMs}ms tolerance with both tapes otherwise clean (candidate finding — no predicted band for inter-track skew) — ${skewDetail}`,
  };
}
