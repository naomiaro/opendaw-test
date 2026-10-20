/**
 * Measurement of the MIDI input alignment audit: which recorded note is which sent
 * note, the figures of one repeat, and the verdict of a cell. Pure; the page and the
 * cell runner feed it. The verdict judges the RAW error against the heard beat
 * (`SentNote.expectedPpqn`); nothing is netted out. See the register,
 * `debug/2026-10-20-midi-input-alignment/note.md`.
 */
import type { MidiScenario, MidiTolerances } from "./midiInputCalibration";
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
  /** Its release was never written: the note reaches the end of its region AND runs past twice its sent length
   *  (a late take lets a note of its sent length overhang the region end; that is placement, not a stuck key). */
  stuck: boolean;
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
      stuck: best.absolutePpqn + best.durationPpqn >= best.regionEndPpqn - 1 && best.durationPpqn > 2 * note.durationPpqn,
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
  placementMedianMs: number | null;
  placementMaxAbsDevMs: number | null;
  placementP5P95Ms: number | null;
  durationErrorMedianMs: number | null;
  durationErrorMaxMs: number | null;
  loopbackDelayMedianMs: number | null;
  loopbackDelayMaxMs: number | null;
  wrapAdjacent: number;
  countInNotes: number;
}

const isJudged = (note: MatchedNote): boolean => note.sent.tag !== "countin" && !note.sent.wrapAdjacent;

export function measureRepeat({ matched, missing, receiptsMissing, extra }: MatchResult): RepeatFigures {
  const judged = matched.filter(isJudged);
  const placement = judged.map((m) => m.placementErrorMs);
  const placementMedian = median(placement);
  const durations = judged.map((m) => m.durationErrorMs);
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
    countInNotes: sentAll.filter((n) => n.tag === "countin").length,
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
  detail: string;
}

/** Empty until the register pins a measured band. */
export const MIDI_KNOWN_DEFECTS: readonly KnownDefectBand[] = [];

const fmt = (value: number): string => String(Number(value.toFixed(2)));

export function classifyMidiCell(
  scenario: MidiScenario,
  repeats: readonly RepeatFigures[],
  tolerances: MidiTolerances,
  bands: readonly KnownDefectBand[] = MIDI_KNOWN_DEFECTS,
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
    if (r.placementMaxAbsDevMs > tolerances.spreadMs) {
      return { status: "investigate", detail: `placementMaxAbsDevMs ${fmt(r.placementMaxAbsDevMs)} > ${tolerances.spreadMs}${on}` };
    }
    if (r.durationErrorMaxMs !== null && Math.abs(r.durationErrorMaxMs) > tolerances.durationMs) {
      return { status: "investigate", detail: `durationErrorMaxMs ${fmt(r.durationErrorMaxMs)} > ${tolerances.durationMs}${on}` };
    }
  }
  const medians = repeats.map((r) => r.placementMedianMs as number);
  if (medians.every((m) => Math.abs(m) <= tolerances.placementMs)) {
    return { status: "aligned", detail: `medians ${medians.map(fmt).join(", ")} ms within ±${tolerances.placementMs}` };
  }
  const band = bands.find((b) =>
    (b.scenario === "any" || b.scenario === scenario)
    && medians.every((m) => m >= b.medianMsMin && m <= b.medianMsMax));
  if (band !== undefined) {
    return { status: "matches-known-defect", detail: `${band.id}: ${band.detail} (medians ${medians.map(fmt).join(", ")} ms)` };
  }
  const offender = medians.findIndex((m) => Math.abs(m) > tolerances.placementMs);
  return {
    status: "investigate",
    detail: `placementMedianMs ${fmt(medians[offender])} > ${tolerances.placementMs} on repeat ${offender + 1}`,
  };
}
