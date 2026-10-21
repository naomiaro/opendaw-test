/**
 * What a run of the MIDI input alignment audit persists: one row per repeat, one
 * verdict per cell, one summary per run, uploaded to the dev server's `/__verify`
 * sink as `midiaudit-summary-<runToken>.json` and read back by
 * `scripts/audit/midi-input-alignment/table.ts`.
 */
import type { AuditBuildFeature } from "./recordingAuditCalibration";
import { isMidiEffectArm, type MidiEffectArm, type MidiScenario, type MidiTolerances } from "./midiInputCalibration";
import type { NoteTag } from "./midiInputPattern";
import type { MidiCellStatus, RepeatFigures } from "./midiInputAlignment";

/** 1: the first sweeps; 2: `collapsed`, `countInRecorded`, `heardLagMs`, `frameGapMaxMs`, `sampleRate` on every row;
 *  3: `effect` on every row and on the run. */
export const MIDI_AUDIT_SCHEMA_VERSION = 3;
/** Schema 1 summaries are read with their missing figures as undefined; the table prints them as absent.
 *  Schemas 1 and 2 are read with `effect` filled as `"none"`. */
export const MIDI_AUDIT_SCHEMA_VERSIONS_READABLE = [1, 2, 3] as const;
/** The per-row counts the table sums; a readable summary must carry each as a number or leave it undefined (schema 1). */
export const MIDI_AUDIT_ROW_COUNTS = ["missing", "receiptsMissing", "extra", "stuck", "collapsed", "countInNotes", "countInRecorded"] as const;

export type MidiAuditRowStatus = MidiCellStatus | "pending" | "error";

export interface MidiAuditNoteRow {
  index: number;
  tag: NoteTag;
  pitch: number;
  velocity: number;
  wrapAdjacent: boolean;
  scheduledPerfMs: number;
  receiptPerfMs: number | null;
  loopbackDelayMs: number | null;
  expectedPpqn: number | null;
  expectedRenderPpqn: number | null;
  recordedPpqn: number | null;
  recordedDurationPpqn: number | null;
  recordedVelocity: number | null;
  takeIndex: number | null;
  placementErrorMs: number | null;
  durationErrorMs: number | null;
  outcome: "matched" | "missing" | "receipt-missing" | "countin-dropped" | "countin-recorded" | "countin-receipt-missing";
}

export interface MidiAuditRow extends RepeatFigures {
  scenario: MidiScenario;
  bpm: number;
  repeat: number;
  /** The MIDI effect on the recorded unit during this repeat. */
  effect: MidiEffectArm;
  status: MidiAuditRowStatus;
  detail: string | null;
  jankMs: number | null;
  takeCount: number;
  takeIndexSource: "label" | "order" | null;
  anchorContextTime: number | null;
  anchorPosition: number | null;
  originPpqn: number | null;
  /** The context's rate: a quantum's length, which the band computation needs. */
  sampleRate: number | null;
  frameIntervalMs: number | null;
  /** The longest gap between animation frames during the repeat; a stalled window shows here. */
  frameGapMaxMs: number | null;
  outputLatencyMs: number | null;
  baseLatencyMs: number | null;
  compensationLatencyMs: number | null;
  /** What the SDK adds to a note's write position: output plus compensation latency. */
  sdkLatencyTermMs: number | null;
  /** How far the heard clock lagged the render clock at the output timestamp pair: `(currentTime − pair.contextTime)
   *  − (now − pair.performanceTime)`, in ms. The browser's own figure for the output latency the mapping assumes. */
  heardLagMs: number | null;
  cleanupWarning: string | null;
  notes: MidiAuditNoteRow[];
}

export interface MidiCellVerdictRecord {
  scenario: MidiScenario;
  bpm: number;
  status: MidiCellStatus;
  detail: string;
}

export interface MidiAuditSummary {
  schemaVersion: number;
  runToken: number;
  userAgent: string;
  sdkVersion: string;
  buildFeatures: AuditBuildFeature[];
  busName: string;
  inputId: string;
  outputId: string;
  sampleRate: number;
  displayRefreshHz: number | null;
  repeatsPerCell: number;
  /** The MIDI effect on the recorded unit for the whole run. */
  effect: MidiEffectArm;
  tolerances: MidiTolerances;
  scenarios: MidiScenario[];
  bpms: number[];
  cellVerdicts: MidiCellVerdictRecord[];
  rows: MidiAuditRow[];
}

export function summaryFileName(runToken: number): string {
  return `midiaudit-summary-${runToken}.json`;
}

export function parseMidiAuditSummary(json: unknown, runToken: number): MidiAuditSummary {
  if (typeof json !== "object" || json === null) throw new Error(`summary ${runToken}: not an object`);
  const summary = json as Record<string, unknown>;
  if (!(MIDI_AUDIT_SCHEMA_VERSIONS_READABLE as readonly unknown[]).includes(summary.schemaVersion)) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, readable: ${MIDI_AUDIT_SCHEMA_VERSIONS_READABLE.join(", ")}`);
  }
  if (!Array.isArray(summary.rows)) throw new Error(`summary ${runToken}: rows is not an array`);
  if (!Array.isArray(summary.cellVerdicts)) throw new Error(`summary ${runToken}: cellVerdicts is not an array`);
  const current = summary.schemaVersion === MIDI_AUDIT_SCHEMA_VERSION;
  if (summary.effect === undefined) {
    if (current) throw new Error(`summary ${runToken}: run lacks effect`);
    summary.effect = "none";
  }
  if (typeof summary.effect !== "string" || !isMidiEffectArm(summary.effect)) throw new Error(`summary ${runToken}: effect "${String(summary.effect)}" is not an arm`);
  summary.rows.forEach((row: Record<string, unknown>, i: number) => {
    if (row.effect === undefined) {
      if (current) throw new Error(`summary ${runToken}: row ${i} lacks effect`);
      row.effect = "none";
    }
    if (typeof row.effect !== "string" || !isMidiEffectArm(row.effect)) throw new Error(`summary ${runToken}: row ${i} effect "${String(row.effect)}" is not an arm`);
    for (const key of MIDI_AUDIT_ROW_COUNTS) {
      const value = row[key];
      if (value !== undefined && typeof value !== "number") throw new Error(`summary ${runToken}: row ${i} ${key} is ${typeof value}, not a number`);
      if (summary.schemaVersion === MIDI_AUDIT_SCHEMA_VERSION && value === undefined) throw new Error(`summary ${runToken}: row ${i} lacks ${key}`);
    }
  });
  return summary as unknown as MidiAuditSummary;
}
