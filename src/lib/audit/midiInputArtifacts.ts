/**
 * What a run of the MIDI input alignment audit persists: one row per repeat, one
 * verdict per cell, one summary per run, uploaded to the dev server's `/__verify`
 * sink as `midiaudit-summary-<runToken>.json` and read back by
 * `scripts/audit/midi-input-alignment/table.ts`.
 */
import type { AuditBuildFeature } from "./recordingAuditCalibration";
import type { MidiScenario, MidiTolerances } from "./midiInputCalibration";
import type { NoteTag } from "./midiInputPattern";
import type { MidiCellStatus, RepeatFigures } from "./midiInputAlignment";

export const MIDI_AUDIT_SCHEMA_VERSION = 1;

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
  outcome: "matched" | "missing" | "receipt-missing" | "countin-dropped" | "countin-recorded";
}

export interface MidiAuditRow extends RepeatFigures {
  scenario: MidiScenario;
  bpm: number;
  repeat: number;
  status: MidiAuditRowStatus;
  detail: string | null;
  jankMs: number | null;
  takeCount: number;
  takeIndexSource: "label" | "order" | null;
  anchorContextTime: number | null;
  anchorPosition: number | null;
  originPpqn: number | null;
  frameIntervalMs: number | null;
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
  if (summary.schemaVersion !== MIDI_AUDIT_SCHEMA_VERSION) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, expected ${MIDI_AUDIT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(summary.rows)) throw new Error(`summary ${runToken}: rows is not an array`);
  if (!Array.isArray(summary.cellVerdicts)) throw new Error(`summary ${runToken}: cellVerdicts is not an array`);
  return summary as unknown as MidiAuditSummary;
}
