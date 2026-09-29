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
  /**
   * The loopback path's own input delay for this take, in ms:
   * `firstQuantumTimeSec − anchorT0Sec` (the SDK's context time of the buffer's
   * first frame minus the harness's estimate of the same instant from the
   * reference clicks). Set by the cell runner on builds that report
   * `firstQuantumTime` (a release that ships PR #376); null/absent otherwise. `classifyCell`
   * nets it out of the adjusted median only when asked (`netLoopbackDelay`).
   */
  loopbackDelayMs?: number | null;
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
 * loopback signal (see `loopbackDeviceId` in `loopbackInjection.ts`): what the
 * two tapes share — the harness-path/`outputLatency` term, the metronome
 * content itself, the reference-click schedule — cancels out of the
 * DIFFERENCE between their beat errors. What does NOT cancel is each stream's
 * own delay on the way to its tape: the two differ from repeat to repeat, and
 * the raw skew carries their difference (`nettedSkewMs` takes it out). The
 * rest is where the SDK placed the two takes: each armed tape gets its own
 * RecordingWorklet, so two tracks recording the same instant can land at
 * different timeline positions.
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
export interface ClassifyCellOptions {
  /** Release profile: judge each repeat on `medianBeatErrorMsAdjusted − loopbackDelayMs`
   *  where the delay is known; repeats without one keep their adjusted median. */
  netLoopbackDelay?: boolean;
}

/** The median a repeat is judged on: netted when asked and the delay is known. */
export function judgedMedianMs(r: TakeAlignment, netLoopbackDelay: boolean): number | null {
  if (r.medianBeatErrorMsAdjusted === null) return null;
  const delay = r.loopbackDelayMs;
  if (netLoopbackDelay && typeof delay === "number" && Number.isFinite(delay)) {
    return r.medianBeatErrorMsAdjusted - delay;
  }
  return r.medianBeatErrorMsAdjusted;
}

export function classifyCell(
  repeats: TakeAlignment[],
  bands: SignatureBand[],
  alignedToleranceMs: number,
  options: ClassifyCellOptions = {}
): CellClassification {
  const netLoopbackDelay = options.netLoopbackDelay === true;
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

  const medians = repeats.map((r) => judgedMedianMs(r, netLoopbackDelay)!);
  const nettedCount = netLoopbackDelay
    ? repeats.filter((r) => typeof r.loopbackDelayMs === "number" && Number.isFinite(r.loopbackDelayMs)).length
    : 0;
  // Bands A-F describe UN-netted residuals (a pre-fix placement, or the loopback
  // delay itself). Once any repeat is judged on a netted median the bands say
  // nothing about it: a netted cell is `aligned` or `investigate`, never a band
  // match — otherwise a real 15-30 ms misplacement on a fixed build would read
  // `matches-known-defect (D)`. Head-loss bands are withheld for the same reason.
  const bandsApply = nettedCount === 0;
  const detailMedians = medians.map((m) => m.toFixed(2)).join(", ");
  const nettedNote = netLoopbackDelay
    ? ` netted on ${nettedCount}/${repeats.length}, adjusted=[${repeats.map((r) => r.medianBeatErrorMsAdjusted?.toFixed(2) ?? "null").join(", ")}]`
    : "";
  const headDeficits = repeats.map((r) => r.headMissingMs).join(", ");
  const tailDeficits = repeats.map((r) => r.tailMissingMs).join(", ");
  const spread = Math.max(...medians) - Math.min(...medians);
  const mean = medians.reduce((a, b) => a + b, 0) / medians.length;
  const detailSuffix = `medians=[${detailMedians}]${nettedNote} spread=${spread.toFixed(2)}ms headMissingMs=[${headDeficits}] tailMissingMs=[${tailDeficits}]`;

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
    const headLossBand = bandsApply ? bands.find(
      (b) =>
        b.kind === "head-loss" &&
        repeats.every(
          (r) => r.headMissingMs !== null && r.headMissingMs >= b.minAbsMs && r.headMissingMs <= b.maxAbsMs
        )
    ) : undefined;
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

  if (!bandsApply) {
    return {
      status: "investigate",
      matchedSignature: null,
      detail: `netted median outside ${alignedToleranceMs}ms tolerance (no band applies to a netted cell): ${detailSuffix}`,
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
  /** What the node taps gave the verdict to judge by; null when it read no node delays. */
  nodeDelayUse: NodeDelayUse | null;
}

/** How much of a cell the node delays judged. Counted over the repeats that were netted. */
export interface NodeDelayUse {
  /** Tapes with a node delay, of two per repeat: each had its first-frame time checked. */
  tapesRead: number;
  /** Repeats with both node delays: held to what the nodes leave of the raw skew. */
  repeatsRead: number;
  /** Repeats with a node delay missing: held to the raw limit. */
  repeatsOnRawLimit: number;
}

/** One delay per tape on one repeat: the rows' `loopbackDelayMs`, or their `nodeDelayMs`. */
export interface TapeDelayPair {
  aMs: number | null;
  bMs: number | null;
}
/** The delay of each tape's own loopback stream on one repeat (`loopbackDelayMs` of its row). */
export type LoopbackDelayPair = TapeDelayPair;

/**
 * The skew between the tapes with the two tapes' own delays taken out.
 * `skew = b's error − a's error`, and each tape's error carries its own
 * delay, so what the delays account for is `bMs − aMs`. Null when the repeat
 * has no skew or either delay is unknown. Given the loopback delays it is the
 * netted skew; given the node delays, what the nodes leave of the raw skew.
 */
export function nettedSkewMs(medianSkewMs: number | null, delays: TapeDelayPair | undefined): number | null {
  if (medianSkewMs === null || delays === undefined) return null;
  const { aMs, bMs } = delays;
  if (typeof aMs !== "number" || !Number.isFinite(aMs) || typeof bMs !== "number" || !Number.isFinite(bMs)) return null;
  return medianSkewMs - (bMs - aMs);
}

/**
 * How far a tape's `loopbackDelayMs` is from where it has to be if the SDK's
 * first-frame time is true. `loopbackDelayMs` is that first-frame time minus the
 * harness's anchor, and the anchor is the context time of the buffer's first
 * frame as the reference clicks locate it, early by `anchorOffsetMs`: the onset
 * detector marks a click some way up its attack, so every click is found late
 * in the buffer and the buffer's start is placed early by as much. The node's
 * delay is measured by the harness's own tap and uses neither. So with a true
 * first-frame time `loopbackDelayMs − nodeDelayMs` is the anchor's offset, and
 * this is zero. A capture that starts a render quantum later than it says, or
 * that lost the head of its buffer, shows here by that much. Null when either
 * delay is unknown.
 */
export function firstFrameCheckMs(
  loopbackDelayMs: number | null | undefined,
  nodeDelayMs: number | null | undefined,
  anchorOffsetMs: number
): number | null {
  if (typeof loopbackDelayMs !== "number" || !Number.isFinite(loopbackDelayMs)) return null;
  if (typeof nodeDelayMs !== "number" || !Number.isFinite(nodeDelayMs)) return null;
  return loopbackDelayMs - nodeDelayMs - anchorOffsetMs;
}

/** Two decimals, with a value that rounds to zero printed as "0.00" rather than "-0.00". */
export function formatTwoDecimals(value: number): string {
  const text = value.toFixed(2);
  return text === "-0.00" ? "0.00" : text;
}

export interface SkewBucket {
  /** Size of the skew in render quanta, to two decimals; its direction is ignored */
  quanta: number;
  count: number;
}

function requireRenderQuantum(renderQuantumMs: number): void {
  if (!Number.isFinite(renderQuantumMs) || renderQuantumMs <= 0) {
    throw new RangeError(`render quantum must be a time above zero, in ms; got ${renderQuantumMs}`);
  }
}

/**
 * How a set of repeats' skews is spread over render quanta. A description of
 * what was measured, never a verdict: the two loopback streams' delays differ
 * by a varying amount from one repeat to the next, mostly whole render quanta.
 * Throws for a quantum that is not a time above zero: an empty spread would
 * read as "no repeats".
 */
export function skewDistribution(skewsMs: ReadonlyArray<number | null>, renderQuantumMs: number): SkewBucket[] {
  requireRenderQuantum(renderQuantumMs);
  const counts = new Map<number, number>();
  for (const skew of skewsMs) {
    if (skew === null || !Number.isFinite(skew)) continue;
    const quanta = Math.round((Math.abs(skew) / renderQuantumMs) * 100) / 100;
    counts.set(quanta, (counts.get(quanta) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([quanta, count]) => ({ quanta, count }));
}

export function formatSkewDistribution(buckets: ReadonlyArray<SkewBucket>): string {
  if (buckets.length === 0) return "none";
  return buckets.map((bucket) => `${bucket.quanta} ×${bucket.count}`).join(", ");
}

export interface ClassifyMultitrackOptions {
  /**
   * Judge each repeat's skew with the two streams' own delays taken out, where
   * both are known; a repeat without them is judged on its raw skew. Needs
   * `loopbackDelays` and `rawSkewLimitMs`. When false or absent those two are
   * not read.
   */
  netLoopbackDelay?: boolean;
  /** One record per entry of `repeatSkews`, in the same order. A repeat whose
   *  delays are unknown has a record with nulls, not a missing record. */
  loopbackDelays?: ReadonlyArray<LoopbackDelayPair>;
  /** When given, the detail reports the raw skew's spread over render quanta. */
  renderQuantumMs?: number;
  /**
   * The most the raw skew of a NETTED repeat may be. Netting takes the sound's
   * offset in the buffer out of the figure altogether (it is in the skew and in
   * the delay difference alike), so a netted skew says where the two takes were
   * placed against the SDK's own first-frame times and nothing about how far apart
   * the two buffers hold the same sound. This bounds that: the raw skew has to stay
   * within what two loopback streams' delays have been measured to differ by.
   * A repeat judged on its raw skew is held to the tolerance, which is tighter.
   * A repeat whose two node delays are known is not held to this limit but to
   * what `nodeDelays` describes.
   */
  rawSkewLimitMs?: number;
  /**
   * The delay of the source node each tape recorded through, as the harness's
   * own taps measured it (`nodeTap.ts`). Read only when netting. Each test is
   * against `alignedToleranceMs`, and neither is fitted: a node's delay does
   * not go through the SDK's first-frame time.
   *  - A tape whose node delay and loopback delay are both known has its
   *    first-frame time checked (`firstFrameCheckMs`), whatever became of the
   *    other tape's tap.
   *  - A repeat with both node delays is held to what they leave of the raw
   *    skew (`nettedSkewMs` with the node delays), in place of the raw limit.
   *  - A cell in which no netted repeat has both is `investigate`: the taps
   *    were there to be read and gave nothing to judge by.
   */
  nodeDelays?: {
    /** One record per entry of `repeatSkews`, in the same order; nulls where a tap read nothing. */
    pairs: ReadonlyArray<TapeDelayPair>;
    /** What `loopbackDelayMs` exceeds a node's delay by when the first-frame time is true. */
    anchorOffsetMs: number;
  };
}

/**
 * Cell verdict for a multitrack scenario: `aligned` when both tapes' own
 * per-take alignment classifies clean (not `investigate`) against the
 * equivalent single-tape scenario's bands, every repeat's judged skew is
 * within `alignedToleranceMs`, and every netted repeat passes what it is held
 * to — otherwise `investigate`. The judged skew is the netted one where
 * netting is asked for and both delays are known, the raw one otherwise. A
 * netted repeat is held to what the two nodes' delays leave of its raw skew
 * where both are known (`options.nodeDelays`), and to `options.rawSkewLimitMs`
 * where not; a tape with a node delay has its first-frame time checked either
 * way. With node delays given and none read, the cell is `investigate`.
 * There is no `matches-known-defect` outcome for skew itself: no
 * signature band predicts it, so a skew beyond tolerance is a candidate
 * finding, named directly in the detail string rather than mapped onto a band.
 *
 * NOTE for anyone quoting an `aligned` multitrack cell. Without netting it
 * means the two tapes agree with EACH OTHER to within the tolerance and
 * neither tape's own cell classified `investigate`. It does NOT mean the takes
 * landed on the beat — a cell whose two tapes are both 22 ms late in the same
 * direction is `aligned` here. With netting it means less about the sound: the
 * two takes were placed the same way against the SDK's own first-frame times.
 * On a repeat with node delays it also means that those first-frame times are
 * true and that the two buffers hold the sound as far apart as the two source
 * nodes delivered it — which can be several render quanta, and is in the
 * detail. On a repeat without them it means only that the buffers hold the
 * sound no further apart than the raw limit, and that distance is NOT
 * attributed. Either way it does not say the two recordings line up. Read the
 * per-tape verdicts beside it.
 *
 * Lives here rather than on the harness page so the offline scripts classify a
 * persisted multitrack run exactly as the page did; `alignedToleranceMs` is a
 * parameter for the same reason `classifyCell` takes one.
 *
 * NETTING (`options.netLoopbackDelay`). Each tape records from its own
 * loopback stream through a source node of its own, and each node hands the
 * stream on with its own delay, which varies from one repeat to the next. The
 * raw skew between the tapes equals the difference of those two delays
 * (measured on every pair), so a verdict on the raw skew changes from run to
 * run. With netting the repeat is judged on what is left once both delays are
 * taken out.
 *
 * Called without options it judges the raw skew against the tolerance, and its
 * detail strings are the ones `task12a`'s saved output holds.
 *
 * Throws for options that cannot be meant: netting without one delay record
 * per repeat or without a raw limit above zero; when netting, node delays
 * without one record per repeat or without an anchor offset; and a render
 * quantum that is not a time above zero.
 */
export function classifyMultitrackCell(
  tapeAClass: CellClassification,
  tapeBClass: CellClassification,
  repeatSkews: CrossTrackSkew[],
  alignedToleranceMs: number,
  options: ClassifyMultitrackOptions = {}
): MultitrackCellVerdict {
  const netting = options.netLoopbackDelay === true;
  const { loopbackDelays, rawSkewLimitMs, renderQuantumMs } = options;
  // Node delays are read only when netting: without the loopback delays there is
  // nothing to check a first-frame time against.
  const taps = netting && options.nodeDelays !== undefined ? options.nodeDelays : null;
  if (renderQuantumMs !== undefined) requireRenderQuantum(renderQuantumMs);
  if (netting) {
    if (loopbackDelays === undefined || loopbackDelays.length !== repeatSkews.length) {
      throw new RangeError(
        `netting needs one delay record per repeat: ${loopbackDelays?.length ?? "no"} record(s) for ${repeatSkews.length} repeat(s)`
      );
    }
    if (rawSkewLimitMs === undefined || !Number.isFinite(rawSkewLimitMs) || rawSkewLimitMs <= 0) {
      throw new RangeError(`netting needs a rawSkewLimitMs above zero; got ${rawSkewLimitMs}`);
    }
    if (taps !== null) {
      if (taps.pairs.length !== repeatSkews.length) {
        throw new RangeError(
          `node delays need one record per repeat: ${taps.pairs.length} record(s) for ${repeatSkews.length} repeat(s)`
        );
      }
      if (typeof taps.anchorOffsetMs !== "number" || !Number.isFinite(taps.anchorOffsetMs)) {
        throw new RangeError(`node delays need an anchorOffsetMs; got ${taps.anchorOffsetMs}`);
      }
    }
  }
  const noUse = taps === null ? null : { tapesRead: 0, repeatsRead: 0, repeatsOnRawLimit: 0 };
  if (repeatSkews.length === 0) {
    return {
      status: "investigate",
      detail: `no successful repeats to measure skew (tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status})`,
      nodeDelayUse: noUse,
    };
  }
  const unusable = repeatSkews.filter((s) => s.medianSkewMs === null).length;
  if (unusable > 0) {
    return {
      status: "investigate",
      detail: `skew unusable (0 paired beats) on ${unusable}/${repeatSkews.length} successful repeat(s) — tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status}`,
      nodeDelayUse: noUse,
    };
  }
  // Every repeat has a skew from here on, so index i is the same repeat in
  // `repeatSkews`, `medians`, `netted`, `loopbackDelays` and the node delays.
  const medians = repeatSkews.map((s) => s.medianSkewMs!);
  const netted = medians.map((m, index) => (netting ? nettedSkewMs(m, loopbackDelays![index]) : null));
  const nettedCount = netted.filter((n) => n !== null).length;
  const judged = medians.map((m, index) => netted[index] ?? m);
  // What the two nodes' delays leave of the raw skew, on a netted repeat with both.
  const unaccounted = medians.map((m, index) =>
    taps !== null && netted[index] !== null ? nettedSkewMs(m, taps.pairs[index]) : null
  );
  const attributedCount = unaccounted.filter((u) => u !== null).length;
  // Each tape's first-frame check, on its own: one tape's tap reading nothing
  // does not make the other tape's first-frame time unknown.
  const firstFrame = medians.map((_, index) => (taps === null ? { a: null, b: null } : {
    a: firstFrameCheckMs(loopbackDelays![index].aMs, taps.pairs[index].aMs, taps.anchorOffsetMs),
    b: firstFrameCheckMs(loopbackDelays![index].bMs, taps.pairs[index].bMs, taps.anchorOffsetMs),
  }));
  const tapesRead = firstFrame.reduce((count, f) => count + (f.a === null ? 0 : 1) + (f.b === null ? 0 : 1), 0);
  const largestRaw = Math.max(...medians.map(Math.abs));
  const distribution = renderQuantumMs !== undefined
    ? ` raw skew in render quanta: ${formatSkewDistribution(skewDistribution(medians, renderQuantumMs))}`
    : "";
  const judgedList = judged
    .map((m, index) => (netted[index] === null ? `raw ${formatTwoDecimals(m)}` : formatTwoDecimals(m)))
    .join(", ");
  const nettedDetail = nettedCount > 0
    ? ` nettedSkewMs per repeat=[${judgedList}] netted on ${nettedCount}/${medians.length}`
    : netting ? ` netted on 0/${medians.length}` : "";
  const orDash = (value: number | null) => (value === null ? "—" : formatTwoDecimals(value));
  const nodeDetail = taps === null
    ? ""
    : tapesRead === 0
      ? ` node delays on 0/${medians.length} repeats (0/${2 * medians.length} tapes)`
      : ` node delays on ${attributedCount}/${medians.length} repeats (${tapesRead}/${2 * medians.length} tapes)`
        + ` unaccountedSkewMs per repeat=[${unaccounted.map(orDash).join(", ")}]`
        + ` firstFrameCheckMs per repeat a=[${firstFrame.map((f) => orDash(f.a)).join(", ")}] b=[${firstFrame.map((f) => orDash(f.b)).join(", ")}]`;
  const skewDetail = `medianSkewMs per repeat=[${medians.map(formatTwoDecimals).join(", ")}] maxAbsMedianSkewMs=${largestRaw.toFixed(2)}${nettedDetail}${nodeDetail}${distribution}`;
  const what = nettedCount === 0
    ? "skew"
    : nettedCount === medians.length ? "netted skew" : `netted skew (${nettedCount}/${medians.length} repeats, the rest raw)`;
  // The raw limit holds the netted repeats that do not have both node delays.
  const limited = medians.filter((_, index) => netted[index] !== null && unaccounted[index] === null);
  const beyondLimit = limited.filter((m) => Math.abs(m) > rawSkewLimitMs!).length;
  const off = (value: number | null) => value !== null && Math.abs(value) > alignedToleranceMs;
  const firstFrameOff = firstFrame.filter((f) => off(f.a) || off(f.b)).length;
  const leftOver = unaccounted.filter(off).length;
  const nothingRead = taps !== null && nettedCount > 0 && attributedCount === 0;
  const nodeDelayUse: NodeDelayUse | null = taps === null
    ? null
    : { tapesRead, repeatsRead: attributedCount, repeatsOnRawLimit: limited.length };
  const tapesClean = tapeAClass.status !== "investigate" && tapeBClass.status !== "investigate";
  const skewClean = beyondLimit === 0 && firstFrameOff === 0 && leftOver === 0 && !nothingRead
    && judged.every((m) => Math.abs(m) <= alignedToleranceMs);
  if (skewClean && tapesClean) {
    const notes: string[] = [];
    if (attributedCount > 0) {
      const largestLeft = Math.max(...unaccounted.map((u) => (u === null ? 0 : Math.abs(u))));
      const on = attributedCount === medians.length ? "every repeat" : `${attributedCount}/${medians.length} repeats`;
      notes.push(
        `raw skew accounted for by the two source nodes' own delays on ${on} (largest raw ${largestRaw.toFixed(2)}ms, largest left over ${largestLeft.toFixed(2)}ms)`
      );
    }
    if (tapesRead > 0) {
      const largestCheck = Math.max(...firstFrame.map((f) => Math.max(Math.abs(f.a ?? 0), Math.abs(f.b ?? 0))));
      const on = tapesRead === 2 * medians.length ? "every tape" : `${tapesRead}/${2 * medians.length} tapes`;
      notes.push(`first-frame times true on ${on} (largest deviation ${largestCheck.toFixed(2)}ms)`);
    }
    if (limited.length > 0) {
      const largestLimited = Math.max(...limited.map(Math.abs));
      notes.push(taps === null
        ? `raw skew within ${rawSkewLimitMs}ms (largest ${largestRaw.toFixed(2)}ms; not attributed — taken to be the two loopback streams' own delays)`
        : `raw skew within ${rawSkewLimitMs}ms on the ${limited.length} repeat(s) without both node delays (largest ${largestLimited.toFixed(2)}ms; not attributed)`);
    }
    const rawNote = notes.map((note) => `, ${note}`).join("");
    return {
      status: "aligned",
      detail: `${what} within ${alignedToleranceMs}ms tolerance on every repeat${rawNote} and both tapes individually clean (tapeA=${tapeAClass.status}, tapeB=${tapeBClass.status}) — ${skewDetail}`,
      nodeDelayUse,
    };
  }
  const investigate = (detail: string): MultitrackCellVerdict => ({ status: "investigate", detail: `${detail} — ${skewDetail}`, nodeDelayUse });
  if (!tapesClean) {
    return investigate(
      `at least one tape's own per-take alignment did not classify clean (tapeA=${tapeAClass.status}: ${tapeAClass.detail}; tapeB=${tapeBClass.status}: ${tapeBClass.detail})`
    );
  }
  if (beyondLimit > 0) {
    return investigate(
      `raw skew exceeds ${rawSkewLimitMs}ms on ${beyondLimit}/${medians.length} repeat(s) with both tapes otherwise clean (candidate finding — more than two loopback streams' delays have been measured to differ by, whatever the netted skew)`
    );
  }
  if (firstFrameOff > 0) {
    return investigate(
      `first-frame time off by more than ${alignedToleranceMs}ms on ${firstFrameOff}/${medians.length} repeat(s) with both tapes otherwise clean (candidate finding — measured against the source node's own delay, the buffer's first frame is not at the time the SDK gives for it)`
    );
  }
  if (leftOver > 0) {
    return investigate(
      `raw skew differs from what the two source nodes' delays account for by more than ${alignedToleranceMs}ms on ${leftOver}/${medians.length} repeat(s) with both tapes otherwise clean (candidate finding — the two buffers hold the sound further apart than the nodes delivered it)`
    );
  }
  if (nothingRead) {
    return investigate(
      `the node taps gave no repeat both of its node delays, with both tapes otherwise clean (not a finding about the SDK — the harness did not measure what it judges by; the rows say why each tap read nothing)`
    );
  }
  const finding = nettedCount > 0
    ? "candidate finding — the two loopback streams' own delays do not account for it"
    : "candidate finding — no predicted band for inter-track skew";
  return investigate(`${what} exceeds ${alignedToleranceMs}ms tolerance with both tapes otherwise clean (${finding})`);
}
