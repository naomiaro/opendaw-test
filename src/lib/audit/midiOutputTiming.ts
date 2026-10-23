/**
 * The MIDI output timing audit's figures, pure and Node-tested. Per note: the receipt stamp mapped
 * back to the heard context clock through the repeat's one `getOutputTimestamp` pair, minus the
 * heard context time of the note's position. Nothing is netted out of `errorMs`; the latencies, the
 * box delay and the jank blocks ride beside it for attribution. On the IAC bus the receipt stamp is
 * the time the sender ASKED for, so the figure judges what the SDK requested, never delivery.
 */
import { contextSecAtPosition, heardContextSecAt, perfMsAtHeardContextSec, pulsesToMs, type OutputStampPair, type RecordingAnchor } from "./midiClockMap";
import { median, percentile, quantumMs } from "./midiInputAlignment";
import { pairReceiptObjects, RECEIPT_WINDOW_MS, type Receipt, type ScheduledNote } from "./midiLoopback";
import { jankLabelFor, type JankBlock, type JankLabel, type OutputPatternNote } from "./midiOutputPattern";

/** The engine rounds a 0..1 velocity float back to a byte, so one byte either way is a match. */
const VELOCITY_TOLERANCE = 1;

/** The origin must be at least this far ahead of the anchor's arrival for the page arm to schedule every note in the future. */
export const ORIGIN_LEAD_MS = 300;

/** One read of `getOutputTimestamp()` and `outputLatency` during the repeat, on the frame it was taken. */
export interface PairSample {
  perfMs: number;
  contextTime: number;
  performanceTime: number;
  outputLatencyMs: number;
}

/** How far the heard-clock relation has moved from the repeat's pair, in ms: positive when the same performance time maps later on the context clock. */
export function pairOffsetDriftMs(sample: Pick<PairSample, "contextTime" | "performanceTime">, pair: OutputStampPair): number {
  return ((sample.contextTime - sample.performanceTime / 1000) - (pair.contextTime - pair.performanceTime / 1000)) * 1000;
}

export interface PairDriftSummary {
  samples: number;
  driftMinMs: number | null;
  driftMaxMs: number | null;
  outputLatencyMinMs: number | null;
  outputLatencyMaxMs: number | null;
}

export function pairDriftSummary(samples: readonly PairSample[], pair: OutputStampPair): PairDriftSummary {
  if (samples.length === 0) return { samples: 0, driftMinMs: null, driftMaxMs: null, outputLatencyMinMs: null, outputLatencyMaxMs: null };
  const drifts = samples.map((s) => pairOffsetDriftMs(s, pair));
  const latencies = samples.map((s) => s.outputLatencyMs);
  return {
    samples: samples.length,
    driftMinMs: Math.min(...drifts),
    driftMaxMs: Math.max(...drifts),
    outputLatencyMinMs: Math.min(...latencies),
    outputLatencyMaxMs: Math.max(...latencies),
  };
}

/** The last sample taken at or before `perfMs`; null before the first. Samples are in time order. */
export function livePairAt(samples: readonly PairSample[], perfMs: number): PairSample | null {
  let found: PairSample | null = null;
  for (const sample of samples) {
    if (sample.perfMs > perfMs) break;
    found = sample;
  }
  return found;
}

export interface OutputNoteRow {
  index: number;
  pitch: number;
  tag: string;
  expectedHeardCtxSec: number;
  receiptPerfMs: number | null;
  receiptHeardCtxSec: number | null;
  /** (receiptHeardCtxSec − expectedHeardCtxSec) × 1000, raw. */
  errorMs: number | null;
  /** The same, the receipt mapped through the live pair sample nearest before it: attribution for a drifting clock relation; null without samples. */
  errorLiveMs: number | null;
  /** (off receipt − on receipt) − the expected duration, ms; null without both receipts. */
  durationErrorMs: number | null;
  /** |sent − received| ≤ 1; null without an on receipt. */
  velocityMatch: boolean | null;
  jankLabel: JankLabel;
}

export interface OutputRepeatFigures {
  medianErrorMs: number | null;
  /** The largest |errorMs − median|. */
  maxAbsDevMs: number | null;
  p5p95WidthMs: number | null;
  /** p95 − median: the hop's shape is one-sided. */
  lateTailMs: number | null;
  /** The live-pair figures; null without pair samples. The engine cell is judged on these when present. */
  medianErrorLiveMs: number | null;
  maxAbsDevLiveMs: number | null;
  /** The spread of the notes CLEAR of every block (label `clear` or `first-after`), so a band for janked notes cannot hide a defect beside them. */
  maxAbsDevOutsideBlocksMs: number | null;
  maxAbsDevOutsideBlocksLiveMs: number | null;
  missing: number;
  extra: number;
  stuck: number;
  /** The stuck notes whose render time fell inside a block: the off-before-on inversion lives there. */
  stuckInsideBlocks: number;
  velocityMismatches: number;
  transportMessages: number;
  notesInsideBlocks: number;
  medianErrorInsideBlocksMs: number | null;
}

export interface MeasureInput {
  pattern: readonly OutputPatternNote[];
  receipts: readonly Receipt[];
  transportMessages: number;
  anchor: RecordingAnchor;
  pair: OutputStampPair;
  bpm: number;
  delayInMs: number;
  jankMs: number;
  blocks: readonly JankBlock[];
  outputLatencyMs: number;
  sampleRate: number;
  /** The repeat's per-frame pair reads, in time order; absent on a page without the witness. */
  pairSamples?: readonly PairSample[];
}

/** Each note at the performance time its heard position is reached: what the page arm sends, and the pairing's reference. */
export function expectedSchedule(pattern: readonly OutputPatternNote[], anchor: RecordingAnchor, pair: OutputStampPair, bpm: number): ScheduledNote[] {
  const perfAt = (ppqn: number): number => perfMsAtHeardContextSec(pair, contextSecAtPosition(anchor, bpm, ppqn));
  return pattern.map((note) => ({ pitch: note.pitch, velocity: note.velocity, onPerfMs: perfAt(note.onPpqn), offPerfMs: perfAt(note.onPpqn + note.durationPpqn) }));
}

/** The engine arm is late by the box delay by design, and a janked note by the block, so the window covers both plus a quantum. */
export function receiptWindowMs(delayInMs: number, jankMs: number, sampleRate: number): number {
  return RECEIPT_WINDOW_MS + delayInMs + jankMs + quantumMs(sampleRate);
}

export function measureOutputRepeat(input: MeasureInput): { notes: OutputNoteRow[]; figures: OutputRepeatFigures } {
  const { pattern, receipts, anchor, pair, bpm } = input;
  const scheduled = expectedSchedule(pattern, anchor, pair, bpm);
  const window = receiptWindowMs(input.delayInMs, input.jankMs, input.sampleRate);
  const paired = pairReceiptObjects(scheduled, receipts, window);
  const used = new Set<Receipt>();
  const notes: OutputNoteRow[] = pattern.map((note, i) => {
    const { on: onReceipt, off: offReceipt } = paired[i];
    const onPerfMs = onReceipt?.timeStamp ?? null;
    const offPerfMs = offReceipt?.timeStamp ?? null;
    const expectedHeardCtxSec = contextSecAtPosition(anchor, bpm, note.onPpqn);
    const receiptHeardCtxSec = onPerfMs === null ? null : heardContextSecAt(pair, onPerfMs);
    const live = onPerfMs === null ? null : livePairAt(input.pairSamples ?? [], onPerfMs);
    const receiptLiveCtxSec = live === null || onPerfMs === null ? null : heardContextSecAt({ contextTime: live.contextTime, performanceTime: live.performanceTime }, onPerfMs);
    const expectedDurationMs = pulsesToMs(note.durationPpqn, bpm);
    if (onReceipt !== null) used.add(onReceipt);
    if (offReceipt !== null) used.add(offReceipt);
    const renderPerfMs = scheduled[i].onPerfMs - input.outputLatencyMs;
    return {
      index: note.index,
      pitch: note.pitch,
      tag: note.tag,
      expectedHeardCtxSec,
      receiptPerfMs: onPerfMs,
      receiptHeardCtxSec,
      errorMs: receiptHeardCtxSec === null ? null : (receiptHeardCtxSec - expectedHeardCtxSec) * 1000,
      errorLiveMs: receiptLiveCtxSec === null ? null : (receiptLiveCtxSec - expectedHeardCtxSec) * 1000,
      durationErrorMs: onPerfMs === null || offPerfMs === null ? null : offPerfMs - onPerfMs - expectedDurationMs,
      velocityMatch: onReceipt === null ? null : Math.abs(onReceipt.velocity - note.velocity) <= VELOCITY_TOLERANCE,
      jankLabel: jankLabelFor(renderPerfMs, input.blocks, 2 * pulsesToMs(note.durationPpqn, bpm)),
    };
  });
  const errors = notes.map((n) => n.errorMs).filter((e): e is number => e !== null);
  const medianErrorMs = median(errors);
  const p5 = percentile(errors, 5);
  const p95 = percentile(errors, 95);
  const inside = notes.filter((n) => n.jankLabel === "inside" && n.errorMs !== null).map((n) => n.errorMs as number);
  const liveErrors = notes.map((n) => n.errorLiveMs).filter((e): e is number => e !== null);
  const medianErrorLiveMs = median(liveErrors);
  const outside = notes.filter((n) => n.jankLabel !== "inside");
  const outsideErrors = outside.map((n) => n.errorMs).filter((e): e is number => e !== null);
  const outsideLiveErrors = outside.map((n) => n.errorLiveMs).filter((e): e is number => e !== null);
  const maxAbsDevFrom = (centre: number | null, values: readonly number[]): number | null =>
    centre === null || values.length === 0 ? null : Math.max(...values.map((e) => Math.abs(e - centre)));
  // Receipts the pairing left unused, by object: stray pitches, duplicate messages, anything outside every window.
  const extra = receipts.length - used.size;
  return {
    notes,
    figures: {
      medianErrorMs,
      maxAbsDevMs: maxAbsDevFrom(medianErrorMs, errors),
      p5p95WidthMs: p5 === null || p95 === null ? null : p95 - p5,
      lateTailMs: medianErrorMs === null || p95 === null ? null : p95 - medianErrorMs,
      medianErrorLiveMs,
      maxAbsDevLiveMs: maxAbsDevFrom(medianErrorLiveMs, liveErrors),
      maxAbsDevOutsideBlocksMs: maxAbsDevFrom(medianErrorMs, outsideErrors),
      maxAbsDevOutsideBlocksLiveMs: maxAbsDevFrom(medianErrorLiveMs, outsideLiveErrors),
      missing: notes.filter((n) => n.receiptPerfMs === null).length,
      extra,
      stuck: notes.filter((n) => n.receiptPerfMs !== null && n.durationErrorMs === null).length,
      stuckInsideBlocks: notes.filter((n) => n.receiptPerfMs !== null && n.durationErrorMs === null && n.jankLabel === "inside").length,
      velocityMismatches: notes.filter((n) => n.velocityMatch === false).length,
      transportMessages: input.transportMessages,
      notesInsideBlocks: notes.filter((n) => n.jankLabel === "inside").length,
      medianErrorInsideBlocksMs: median(inside),
    },
  };
}

/** True when `nowCtxSec` plus the lead is already past the origin's heard context time: the page arm could not schedule every note ahead. */
export function anchorTooLate(anchor: RecordingAnchor, originPpqn: number, bpm: number, nowCtxSec: number, leadMs: number = ORIGIN_LEAD_MS): boolean {
  return nowCtxSec + leadMs / 1000 > contextSecAtPosition(anchor, bpm, originPpqn);
}
