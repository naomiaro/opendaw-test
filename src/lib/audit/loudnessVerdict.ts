/**
 * From a captured case to judged rows: which readings a row takes, whether the signal was
 * delivered as synthesized, and whether each reading is within its tolerance.
 */
import {
  rowSpecs,
  type LoudnessCase,
  type LoudnessGroup,
  type LoudnessMetric,
  type MetricExpectation,
} from "./loudnessCases";
import { samplePeakDb, segmentSpans } from "./loudnessSignals";
import {
  LOUDNESS_TAP_CHUNK_FRAMES,
  deliveredLevelDb,
  deliveredPeakDb,
  signalSpan,
  type CaseCapture,
  type LoudnessReading,
} from "./loudnessTap";

/** The end-of-signal reading is the first one at least this long after the tap sees the end. */
export const END_READING_DELAY_MS = 200;
/** The late reading shows whether the meter's numbers move once the programme is over. */
export const LATE_READING_DELAY_MS = 5000;
/** A sweep tone is read this long before it ends, so the next tone is not yet in the window. */
export const SEGMENT_READING_GUARD_MS = 300;
/** A meter that has measured nothing reads -120; above this it was not empty. */
export const EMPTY_METER_MAX = -119;
export const LEVEL_TOLERANCE_DB = 0.02;
export const PEAK_TOLERANCE_DB = 0.05;
/** Left out at each end of a segment when its delivered level is measured. */
export const INTERIOR_MARGIN_SEC = 0.1;
/** The tap places the signal's start and end to a chunk each. */
export const LENGTH_SLACK_FRAMES = 2 * LOUDNESS_TAP_CHUNK_FRAMES;
/**
 * Reading times are counted from the arrival of the tap's first loud chunk. If the time
 * between that and the arrival of its first quiet chunk is not the signal's length to within
 * this, one of the two arrived late and the readings cannot be placed.
 */
export const TIMING_SLACK_MS = 150;
/** The stream carries 32-bit floats: a reading on the limit must not fail for its last bit. */
const TOLERANCE_SLACK = 1e-5;

export type MetricValues = Partial<Record<LoudnessMetric, number>>;

/** One thing the tap confirms about the signal the meter was fed. */
export interface DeliveredCheck {
  label: string;
  intendedDb: number;
  deliveredDb: number | null;
  toleranceDb: number;
}

export interface MetricResult extends MetricExpectation {
  got: number | null;
  error: number | null;
  within: boolean;
}

export type RowStatus = "pass" | "fail" | "invalid";

export interface RowVerdict {
  status: RowStatus;
  metrics: MetricResult[];
  /** Why the row is invalid. Empty for pass and fail. */
  reasons: string[];
}

export interface JudgedRow extends RowVerdict {
  rowId: string;
  caseId: string;
  group: LoudnessGroup;
  delivered: DeliveredCheck[];
  /** Integrated, range and peak five seconds after the signal ended. Reported, not judged. */
  late: MetricValues;
}

export function firstReadingAtOrAfter(readings: readonly LoudnessReading[], atMs: number): LoudnessReading | null {
  return readings.find((reading) => reading.atMs >= atMs) ?? null;
}

export function lastReadingAtOrBefore(readings: readonly LoudnessReading[], atMs: number): LoudnessReading | null {
  let found: LoudnessReading | null = null;
  for (const reading of readings) {
    if (reading.atMs > atMs) break;
    found = reading;
  }
  return found;
}

/** Integrated, range and peak just after the signal ended; the maxima over the signal. */
export function endOfSignalValues(readings: readonly LoudnessReading[], startMs: number, endMs: number): MetricValues {
  const end = firstReadingAtOrAfter(readings, endMs + END_READING_DELAY_MS);
  if (end === null) return {};
  const during = readings.filter((reading) => reading.atMs >= startMs && reading.atMs <= end.atMs);
  return {
    integrated: end.integrated,
    range: end.range,
    peak: end.peak,
    maxMomentary: during.reduce((highest, reading) => Math.max(highest, reading.momentary), -Infinity),
    maxShortTerm: during.reduce((highest, reading) => Math.max(highest, reading.shortTerm), -Infinity),
  };
}

/** Short-term loudness just before a segment ends, `segmentEndSeconds` into the signal. */
export function segmentEndValues(
  readings: readonly LoudnessReading[],
  startMs: number,
  segmentEndSeconds: number
): MetricValues {
  const reading = lastReadingAtOrBefore(readings, startMs + segmentEndSeconds * 1000 - SEGMENT_READING_GUARD_MS);
  return reading === null || reading.atMs < startMs ? {} : { shortTerm: reading.shortTerm };
}

export function lateValues(readings: readonly LoudnessReading[], endMs: number): MetricValues {
  const late = firstReadingAtOrAfter(readings, endMs + LATE_READING_DELAY_MS);
  return late === null ? {} : { integrated: late.integrated, range: late.range, peak: late.peak };
}

export interface RowInput {
  judged: readonly MetricExpectation[];
  values: MetricValues;
  delivered: readonly DeliveredCheck[];
  /** Reasons, found before judging, that the case cannot be trusted. */
  problems: readonly string[];
}

/** Invalid when anything says the meter was not fed the intended signal; otherwise pass or fail. */
export function judgeRow({ judged, values, delivered, problems }: RowInput): RowVerdict {
  const reasons = [...problems];
  for (const check of delivered) {
    if (check.deliveredDb === null || Number.isNaN(check.deliveredDb)) {
      reasons.push(`${check.label}: not measured`);
    } else if (!(Math.abs(check.deliveredDb - check.intendedDb) <= check.toleranceDb)) {
      reasons.push(
        `${check.label}: delivered ${check.deliveredDb.toFixed(2)} dB, intended ${check.intendedDb.toFixed(2)} dB`
      );
    }
  }
  const metrics = judged.map((expectation): MetricResult => {
    const got = values[expectation.metric];
    if (got === undefined || !Number.isFinite(got)) {
      reasons.push(`no reading for ${expectation.metric}`);
      return { ...expectation, got: null, error: null, within: false };
    }
    const error = got - expectation.expected;
    const within =
      error <= expectation.tolerancePlus + TOLERANCE_SLACK && error >= -expectation.toleranceMinus - TOLERANCE_SLACK;
    return { ...expectation, got, error, within };
  });
  const status: RowStatus = reasons.length > 0 ? "invalid" : metrics.every((metric) => metric.within) ? "pass" : "fail";
  return { status, metrics, reasons };
}

/** Every row of a case, judged from what its one play-through captured. */
export function judgeCapture(testCase: LoudnessCase, sampleRate: number, capture: CaseCapture): JudgedRow[] {
  const spans = segmentSpans(testCase.segments, sampleRate);
  const totalFrames = spans[spans.length - 1].endFrame;
  const margin = Math.round(INTERIOR_MARGIN_SEC * sampleRate);
  const span = signalSpan(capture.chunks);

  const problems: string[] = [];
  if (capture.hidden) problems.push("the tab was hidden during the case");
  if (capture.readings.length === 0) {
    problems.push("no loudness reading arrived");
  } else if (capture.readings[0].integrated > EMPTY_METER_MAX) {
    problems.push(`the meter was not empty at the start (integrated ${capture.readings[0].integrated.toFixed(2)})`);
  }
  const totalSeconds = (totalFrames / sampleRate).toFixed(3);
  if (span === null) {
    problems.push("the tap never saw the signal start and end");
  } else if (Math.abs(span.endFrame - span.startFrame - totalFrames) > LENGTH_SLACK_FRAMES) {
    const delivered = ((span.endFrame - span.startFrame) / sampleRate).toFixed(3);
    problems.push(`signal length delivered ${delivered} s, synthesized ${totalSeconds} s`);
  } else if (Math.abs(span.endMs - span.startMs - (totalFrames / sampleRate) * 1000) > TIMING_SLACK_MS) {
    const timed = ((span.endMs - span.startMs) / 1000).toFixed(3);
    problems.push(`the tap timed the signal at ${timed} s, it is ${totalSeconds} s long`);
  }

  const checksFor = (index: number): DeliveredCheck[] => {
    const segment = testCase.segments[index];
    const from = span === null ? 0 : span.startFrame + spans[index].startFrame + margin;
    const to = span === null ? 0 : span.startFrame + spans[index].endFrame - margin;
    const level = span === null ? null : deliveredLevelDb(capture.chunks, from, to);
    const name = `segment ${index + 1}`;
    const checks: DeliveredCheck[] = [
      {
        label: `${name} level L`,
        intendedDb: segment.levelDb,
        deliveredDb: level === null ? null : level[0],
        toleranceDb: LEVEL_TOLERANCE_DB,
      },
      {
        label: `${name} level R`,
        intendedDb: segment.levelDb,
        deliveredDb: level === null ? null : level[1],
        toleranceDb: LEVEL_TOLERANCE_DB,
      },
    ];
    if (testCase.group === "peak") {
      checks.push({
        label: `${name} sample peak`,
        intendedDb: samplePeakDb(segment, sampleRate),
        deliveredDb: span === null ? null : deliveredPeakDb(capture.chunks, from, to),
        toleranceDb: PEAK_TOLERANCE_DB,
      });
    }
    return checks;
  };

  return rowSpecs(testCase, sampleRate).map((spec): JudgedRow => {
    const { readAt } = spec;
    const segmentIndexes = readAt.kind === "segmentEnd" ? [readAt.segment] : testCase.segments.map((_, index) => index);
    const delivered = segmentIndexes.flatMap(checksFor);
    if (testCase.group === "peak") {
      // The meter holds its peak from the moment it is switched on, so the whole capture must
      // stay at or below the tone's highest sample, not only the interior measured above.
      delivered.push({
        label: "whole capture sample peak",
        intendedDb: Math.max(...testCase.segments.map((segment) => samplePeakDb(segment, sampleRate))),
        deliveredDb: deliveredPeakDb(capture.chunks, -Infinity, Infinity),
        toleranceDb: PEAK_TOLERANCE_DB,
      });
    }
    let values: MetricValues = {};
    if (span !== null) {
      values =
        readAt.kind === "segmentEnd"
          ? segmentEndValues(capture.readings, span.startMs, spans[readAt.segment].endFrame / sampleRate)
          : endOfSignalValues(capture.readings, span.startMs, span.endMs);
    }
    return {
      rowId: spec.rowId,
      caseId: testCase.id,
      group: testCase.group,
      delivered,
      late: span === null ? {} : lateValues(capture.readings, span.endMs),
      ...judgeRow({ judged: spec.judged, values, delivered, problems }),
    };
  });
}
