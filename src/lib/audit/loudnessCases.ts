/**
 * The loudness audit's cases: test signals whose loudness is known, and what a meter must
 * read for each. The EBU rows are Table 1 of EBU Tech 3341 (loudness and true peak) and
 * Table 1 of EBU Tech 3342 (loudness range). The weighting sweep is this harness's own.
 */
import { expectedToneLoudness, frequencyHz, type ToneSegment } from "./loudnessSignals";

export type LoudnessGroup = "loudness" | "range" | "peak" | "weighting";
export const LOUDNESS_GROUPS: readonly LoudnessGroup[] = ["loudness", "range", "peak", "weighting"];

export type LoudnessMetric = "integrated" | "maxMomentary" | "maxShortTerm" | "range" | "peak" | "shortTerm";

export interface MetricExpectation {
  metric: LoudnessMetric;
  expected: number;
  /** How far above `expected` a reading may be. */
  tolerancePlus: number;
  /** How far below `expected` a reading may be. */
  toleranceMinus: number;
  unit: "LUFS" | "LU" | "dBTP";
}

export interface LoudnessCase {
  id: string;
  group: LoudnessGroup;
  /** Where the case comes from, for the page and the summary. */
  source: string;
  segments: ToneSegment[];
  /** Fade at the start and end of the whole signal, in ms. */
  taperMs: number;
  /** What the end-of-signal reading is judged by. Empty for the sweep, which is judged per tone. */
  judged: MetricExpectation[];
}

export type ReadAt = { kind: "signalEnd" } | { kind: "segmentEnd"; segment: number };

/** One row of the result table: which reading it takes and what that reading is judged by. */
export interface RowSpec {
  rowId: string;
  readAt: ReadAt;
  judged: MetricExpectation[];
}

export const LOUDNESS_RATES: readonly number[] = [48000, 44100];
export const WEIGHTING_HZ: readonly number[] = [
  25, 40, 60, 100, 250, 500, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 16000, 20000,
];
export const WEIGHTING_LEVEL_DB = -20;
const WEIGHTING_TONE_SECONDS = 6;
/** The harness's own tolerance for the sweep, chosen to match the EBU loudness cases. */
const WEIGHTING_TOLERANCE = 0.1;
/** "0.50 FS" in Tech 3341. */
const HALF_SCALE_DB = 20 * Math.log10(0.5);

const tone = (levelDb: number, seconds: number, hz: number = 1000): ToneSegment => ({
  seconds,
  levelDb,
  frequency: { hz },
  phaseDeg: 0,
});
const peakTone = (rateDivisor: number, phaseDeg: number): ToneSegment => ({
  seconds: 5,
  levelDb: HALF_SCALE_DB,
  frequency: { rateDivisor },
  phaseDeg,
});
const lufs = (metric: LoudnessMetric, expected: number): MetricExpectation => ({
  metric,
  expected,
  tolerancePlus: 0.1,
  toleranceMinus: 0.1,
  unit: "LUFS",
});
const allThree = (expected: number): MetricExpectation[] => [
  lufs("integrated", expected),
  lufs("maxMomentary", expected),
  lufs("maxShortTerm", expected),
];
const rangeOf = (expected: number): MetricExpectation[] => [
  { metric: "range", expected, tolerancePlus: 1, toleranceMinus: 1, unit: "LU" },
];
const truePeak = (): MetricExpectation[] => [
  { metric: "peak", expected: -6, tolerancePlus: 0.2, toleranceMinus: 0.4, unit: "dBTP" },
];
const loudness = (id: string, segments: ToneSegment[], judged: MetricExpectation[]): LoudnessCase => ({
  id: `3341-${id}`,
  group: "loudness",
  source: `EBU Tech 3341 case ${id}`,
  segments,
  taperMs: 0,
  judged,
});
const range = (id: string, levels: number[], expected: number): LoudnessCase => ({
  id: `3342-${id}`,
  group: "range",
  source: `EBU Tech 3342 case ${id}`,
  segments: levels.map((level) => tone(level, 20)),
  taperMs: 0,
  judged: rangeOf(expected),
});
const peak = (id: string, rateDivisor: number, phaseDeg: number): LoudnessCase => ({
  id: `3341-${id}`,
  group: "peak",
  source: `EBU Tech 3341 case ${id}`,
  segments: [peakTone(rateDivisor, phaseDeg)],
  taperMs: 10,
  judged: truePeak(),
});

export const LOUDNESS_CASES: readonly LoudnessCase[] = [
  loudness("1", [tone(-23, 20)], allThree(-23)),
  loudness("2", [tone(-33, 20)], allThree(-33)),
  loudness("3", [tone(-36, 10), tone(-23, 60), tone(-36, 10)], [lufs("integrated", -23)]),
  loudness(
    "4",
    [tone(-72, 10), tone(-36, 10), tone(-23, 60), tone(-36, 10), tone(-72, 10)],
    [lufs("integrated", -23)]
  ),
  loudness("5", [tone(-26, 20), tone(-20, 20.1), tone(-26, 20)], [lufs("integrated", -23)]),
  range("1", [-20, -30], 10),
  range("2", [-20, -15], 5),
  range("3", [-40, -20], 20),
  range("4", [-50, -35, -20, -35, -50], 15),
  peak("15", 4, 0),
  peak("16", 4, 45),
  peak("17", 6, 60),
  peak("18", 8, 67.5),
  {
    id: "kweight",
    group: "weighting",
    source: "K-weighting sweep (this harness)",
    segments: WEIGHTING_HZ.map((hz) => tone(WEIGHTING_LEVEL_DB, WEIGHTING_TONE_SECONDS, hz)),
    taperMs: 0,
    judged: [],
  },
];

export function caseSeconds(testCase: LoudnessCase): number {
  return testCase.segments.reduce((sum, segment) => sum + segment.seconds, 0);
}

/** The rows a case produces. The sweep's expectations depend on the running sample rate. */
export function rowSpecs(testCase: LoudnessCase, sampleRate: number): RowSpec[] {
  if (testCase.group !== "weighting") {
    return [{ rowId: testCase.id, readAt: { kind: "signalEnd" }, judged: testCase.judged }];
  }
  return testCase.segments.map((segment, index) => {
    const hz = frequencyHz(segment.frequency, sampleRate);
    return {
      rowId: `kweight-${hz}`,
      readAt: { kind: "segmentEnd", segment: index },
      judged: [
        {
          metric: "shortTerm",
          expected: expectedToneLoudness(sampleRate, hz, segment.levelDb),
          tolerancePlus: WEIGHTING_TOLERANCE,
          toleranceMinus: WEIGHTING_TOLERANCE,
          unit: "LUFS",
        },
      ],
    };
  });
}

/** `all` (or nothing), a group name, or one case id. Throws for anything else. */
export function selectCases(selector: string | null): LoudnessCase[] {
  if (selector === null || selector === "all") return [...LOUDNESS_CASES];
  const group = LOUDNESS_CASES.filter((testCase) => testCase.group === selector);
  if (group.length > 0) return group;
  const one = LOUDNESS_CASES.filter((testCase) => testCase.id === selector);
  if (one.length > 0) return one;
  const known = ["all", ...LOUDNESS_GROUPS, ...LOUDNESS_CASES.map((testCase) => testCase.id)];
  throw new Error(`unknown ?case= "${selector}" (use one of: ${known.join(", ")})`);
}

export function parseRate(param: string | null): number {
  if (param === null) return LOUDNESS_RATES[0];
  const rate = Number(param);
  if (!LOUDNESS_RATES.includes(rate)) {
    throw new Error(`unsupported ?rate= "${param}" (use ${LOUDNESS_RATES.join(" or ")})`);
  }
  return rate;
}
