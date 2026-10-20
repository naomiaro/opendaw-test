/**
 * Measurement of the MIDI input alignment audit: which recorded note is which sent
 * note, the figures of one repeat, and the verdict of a cell. Pure; the page and the
 * cell runner feed it. The verdict judges the RAW error against the heard beat
 * (`SentNote.expectedPpqn`); nothing is netted out. See the register,
 * `debug/2026-10-20-midi-input-alignment/note.md`.
 */
import { BEAT_PPQN, RECORDER_MIN_NOTE_PPQN, type MidiScenario, type MidiTolerances } from "./midiInputCalibration";
import type { PatternNote } from "./midiInputPattern";
import { pulsesToMs } from "./midiClockMap";

export interface SentNote extends PatternNote {
  scheduledPerfMs: number;
  /** The page's own loopback listener stamp of the note-on; null when none arrived. */
  receiptPerfMs: number | null;
  offReceiptPerfMs: number | null;
  /** Heard position at `receiptPerfMs`; null without a receipt. */
  expectedPpqn: number | null;
  expectedRenderPpqn: number | null;
}

export interface RecordedNote {
  pitch: number;
  /** The MIDI velocity byte, `Math.round(unit * 127)`. */
  velocity: number;
  /** Region position + event position + the durations of the earlier takes. */
  absolutePpqn: number;
  durationPpqn: number;
  takeIndex: number;
  regionEndPpqn: number;
}

export interface MatchedNote {
  sent: SentNote;
  recorded: RecordedNote;
  placementErrorMs: number;
  durationErrorMs: number;
  velocityMismatch: boolean;
  /** Its release was never written: the note runs past twice its sent length AND reaches the take's last write
   *  (the recorder rounds the region end up to the next beat past it). A note of its sent length that a late
   *  take lets overhang the region end is placement, not a stuck key. */
  stuck: boolean;
  /** Written at the recorder's minimum length while it was sent longer than twice that: the release was lost. */
  collapsed: boolean;
  loopbackDelayMs: number;
}

export interface MatchResult {
  matched: MatchedNote[];
  missing: SentNote[];
  receiptsMissing: SentNote[];
  extra: RecordedNote[];
}

export function matchNotes(
  sent: readonly SentNote[],
  recorded: readonly RecordedNote[],
  bpm: number,
  windowPpqn: number,
): MatchResult {
  const unused = new Set<RecordedNote>(recorded);
  const matched: MatchedNote[] = [];
  const missing: SentNote[] = [];
  const receiptsMissing: SentNote[] = [];
  for (const note of sent) {
    if (note.expectedPpqn === null || note.receiptPerfMs === null) {
      receiptsMissing.push(note);
      continue;
    }
    const expected = note.expectedPpqn;
    let best: RecordedNote | null = null;
    for (const candidate of unused) {
      if (candidate.pitch !== note.pitch) continue;
      const distance = Math.abs(candidate.absolutePpqn - expected);
      if (distance > windowPpqn) continue;
      if (best === null || distance < Math.abs(best.absolutePpqn - expected)) best = candidate;
    }
    if (best === null) {
      missing.push(note);
      continue;
    }
    unused.delete(best);
    matched.push({
      sent: note,
      recorded: best,
      placementErrorMs: pulsesToMs(best.absolutePpqn - expected, bpm),
      durationErrorMs: pulsesToMs(best.durationPpqn - note.durationPpqn, bpm),
      velocityMismatch: Math.abs(best.velocity - note.velocity) > 1,
      stuck: best.durationPpqn > 2 * note.durationPpqn && best.absolutePpqn + best.durationPpqn >= best.regionEndPpqn - BEAT_PPQN,
      collapsed: best.durationPpqn <= RECORDER_MIN_NOTE_PPQN && note.durationPpqn > 2 * RECORDER_MIN_NOTE_PPQN,
      loopbackDelayMs: note.receiptPerfMs - note.scheduledPerfMs,
    });
  }
  return { matched, missing, receiptsMissing, extra: [...unused] };
}

export interface RepeatFigures {
  notesSent: number;
  notesRecorded: number;
  /** Matched notes less the count-in and wrap-adjacent ones; the figures below are over these. */
  judgedNotes: number;
  missing: number;
  receiptsMissing: number;
  extra: number;
  stuck: number;
  velocityMismatches: number;
  /** Releases the recorder lost (see `MatchedNote.collapsed`); their durations are kept out of the duration figures. */
  collapsed: number;
  placementMedianMs: number | null;
  placementMaxAbsDevMs: number | null;
  placementP5P95Ms: number | null;
  durationErrorMedianMs: number | null;
  durationErrorMaxMs: number | null;
  loopbackDelayMedianMs: number | null;
  loopbackDelayMaxMs: number | null;
  wrapAdjacent: number;
  /** Count-in notes sent (unanchored, never matched) and how many of them the SDK recorded. */
  countInNotes: number;
  countInRecorded: number;
}

/** Recorded notes at the count-in pitches, taken out of `extra` and counted on their own: reported, not judged. */
export function splitCountIn(match: MatchResult, countInPitches: readonly number[]): { match: MatchResult; countInRecorded: RecordedNote[] } {
  const countInRecorded = match.extra.filter((n) => countInPitches.includes(n.pitch));
  return { match: { ...match, extra: match.extra.filter((n) => !countInRecorded.includes(n)) }, countInRecorded };
}

const isJudged = (note: MatchedNote): boolean => note.sent.tag !== "countin" && !note.sent.wrapAdjacent;

export function measureRepeat(
  { matched, missing, receiptsMissing, extra }: MatchResult,
  countIn: { sent: number; recorded: number } = { sent: 0, recorded: 0 },
): RepeatFigures {
  const judged = matched.filter(isJudged);
  const placement = judged.map((m) => m.placementErrorMs);
  const placementMedian = median(placement);
  const durations = judged.filter((m) => !m.collapsed).map((m) => m.durationErrorMs);
  const delays = matched.map((m) => m.loopbackDelayMs);
  const sentAll = [...matched.map((m) => m.sent), ...missing, ...receiptsMissing];
  const p5 = percentile(placement, 5);
  const p95 = percentile(placement, 95);
  return {
    notesSent: sentAll.length,
    notesRecorded: matched.length + extra.length,
    judgedNotes: judged.length,
    missing: missing.length,
    receiptsMissing: receiptsMissing.length,
    extra: extra.length,
    stuck: judged.filter((m) => m.stuck).length,
    velocityMismatches: judged.filter((m) => m.velocityMismatch).length,
    collapsed: judged.filter((m) => m.collapsed).length,
    placementMedianMs: placementMedian,
    placementMaxAbsDevMs: placementMedian === null
      ? null
      : Math.max(...placement.map((v) => Math.abs(v - placementMedian))),
    placementP5P95Ms: p5 === null || p95 === null ? null : p95 - p5,
    durationErrorMedianMs: median(durations),
    durationErrorMaxMs: durations.length === 0 ? null : Math.max(...durations.map(Math.abs)),
    loopbackDelayMedianMs: median(delays),
    loopbackDelayMaxMs: delays.length === 0 ? null : Math.max(...delays),
    wrapAdjacent: sentAll.filter((n) => n.wrapAdjacent).length,
    countInNotes: sentAll.filter((n) => n.tag === "countin").length + countIn.sent,
    countInRecorded: countIn.recorded,
  };
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 50);
}

/** Linear interpolation between the two nearest ranks; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

export type MidiCellStatus = "aligned" | "matches-known-defect" | "investigate";

export interface KnownDefectBand {
  id: string;
  scenario: MidiScenario | "any";
  medianMsMin: number;
  medianMsMax: number;
  /** The jitter the defect carries; the spread tolerance when absent. */
  maxDevMsMax?: number;
  /** The release jitter the defect carries, as the largest absolute duration error; the duration tolerance when absent. */
  durationErrorMsMax?: number;
  /** The display frame interval the band was measured at; a row outside it, or without one, misses the band. */
  frameIntervalMsRange?: [number, number];
  /** Lost releases the band allows per repeat; none when absent. */
  collapsedMax?: number;
  detail: string;
}

/**
 * Bands the register pinned (`debug/2026-10-20-midi-input-alignment/note.md`, "Bring-up").
 * A band is the measured shape of a characterized defect: a release that changes it reads
 * `aligned` or `investigate`, never silently the same.
 */
const LATE_60HZ = {
  // The 41 bring-up medians (+32.2 … +33.3 ms) with 5 ms to either side.
  medianMsMin: 28,
  medianMsMax: 38,
  // The clamp moves a note at most one frame early plus a quantum of slot staleness: 20 + 2.9 ms.
  maxDevMsMax: 23,
  // The same clamp on a release.
  durationErrorMsMax: 23,
  // What a 60 Hz display gives Chrome's animation frames, under load included (18.6 ms measured).
  frameIntervalMsRange: [14, 20] as [number, number],
};

export const MIDI_KNOWN_DEFECTS: readonly KnownDefectBand[] = [
  {
    id: "midi-late-60hz-release-lost",
    scenario: "janked-mid",
    ...LATE_60HZ,
    // The note at the jank instant: its release lands inside the block and is lost when a frame runs before its handler.
    collapsedMax: 1,
    detail: "the 60 Hz band, plus one release lost inside the main-thread block (written at the minimum length)",
  },
  {
    id: "midi-late-60hz",
    scenario: "any",
    ...LATE_60HZ,
    detail: "notes written at the rendered position plus the output latency, extrapolated from a frame-stale base "
      + "(about +32 ms at 60 Hz with 23 ms output latency); the clamp of a stamp before the last frame read spreads them up to a frame early",
  },
];

const fmt = (value: number): string => String(Number(value.toFixed(2)));

export function classifyMidiCell(
  scenario: MidiScenario,
  repeats: readonly RepeatFigures[],
  tolerances: MidiTolerances,
  bands: readonly KnownDefectBand[] = MIDI_KNOWN_DEFECTS,
  frameIntervalsMs: ReadonlyArray<number | null> = [],
): { status: MidiCellStatus; detail: string } {
  if (repeats.length === 0) return { status: "investigate", detail: "no repeats" };
  const integrity: Array<keyof RepeatFigures> = ["missing", "receiptsMissing", "extra", "stuck", "velocityMismatches"];
  for (const [i, r] of repeats.entries()) {
    const on = ` on repeat ${i + 1}`;
    for (const key of integrity) {
      const count = r[key] as number;
      if (count > 0) return { status: "investigate", detail: `${key} ${count}${on}` };
    }
    if (r.placementMedianMs === null || r.placementMaxAbsDevMs === null) {
      return { status: "investigate", detail: `no judged notes${on}` };
    }
  }
  const medians = repeats.map((r) => r.placementMedianMs as number);
  const spreads = repeats.map((r) => r.placementMaxAbsDevMs as number);
  const durations = repeats.map((r) => Math.abs(r.durationErrorMaxMs ?? 0));
  const collapsedCounts = repeats.map((r) => r.collapsed);
  const spreadOffender = spreads.findIndex((v) => v > tolerances.spreadMs);
  const medianOffender = medians.findIndex((m) => Math.abs(m) > tolerances.placementMs);
  const durationOffender = durations.findIndex((v) => v > tolerances.durationMs);
  const collapsedOffender = collapsedCounts.findIndex((v) => v > 0);
  if (spreadOffender < 0 && medianOffender < 0 && durationOffender < 0 && collapsedOffender < 0) {
    return { status: "aligned", detail: `medians ${medians.map(fmt).join(", ")} ms within ±${tolerances.placementMs}` };
  }
  const band = bands.find((b) =>
    (b.scenario === "any" || b.scenario === scenario)
    && medians.every((m) => m >= b.medianMsMin && m <= b.medianMsMax)
    && spreads.every((v) => v <= (b.maxDevMsMax ?? tolerances.spreadMs))
    && durations.every((v) => v <= (b.durationErrorMsMax ?? tolerances.durationMs))
    && collapsedCounts.every((v) => v <= (b.collapsedMax ?? 0))
    && (b.frameIntervalMsRange === undefined || repeats.every((_, i) => {
      const f = frameIntervalsMs[i];
      return f !== null && f !== undefined && f >= b.frameIntervalMsRange![0] && f <= b.frameIntervalMsRange![1];
    })));
  if (band !== undefined) {
    return { status: "matches-known-defect", detail: `${band.id}: ${band.detail} (medians ${medians.map(fmt).join(", ")} ms)` };
  }
  if (collapsedOffender >= 0) {
    return { status: "investigate", detail: `collapsed ${collapsedCounts[collapsedOffender]} on repeat ${collapsedOffender + 1}` };
  }
  if (durationOffender >= 0) {
    return { status: "investigate", detail: `durationErrorMaxMs ${fmt(durations[durationOffender])} > ${tolerances.durationMs} on repeat ${durationOffender + 1}` };
  }
  if (spreadOffender >= 0) {
    return { status: "investigate", detail: `placementMaxAbsDevMs ${fmt(spreads[spreadOffender])} > ${tolerances.spreadMs} on repeat ${spreadOffender + 1}` };
  }
  return {
    status: "investigate",
    detail: `placementMedianMs ${fmt(medians[medianOffender])} > ${tolerances.placementMs} on repeat ${medianOffender + 1}`,
  };
}
