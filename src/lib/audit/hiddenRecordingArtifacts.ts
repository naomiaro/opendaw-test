/**
 * What a run of the hidden-page recording page persists: one row per run (two takes), uploaded
 * to the dev server's `/__verify` sink (which writes `.verify-output/`) as
 * `hiddenrec-summary-<runToken>.json`. No SDK import here: the audit table scripts load their
 * summaries under Node, where the SDK's dist does not resolve.
 */
import type { PositionSample, TakeFigures, TakeVerdict } from "./hiddenRecordingVerdict";

/** 1: the first runs. */
export const HIDDEN_RECORDING_SCHEMA_VERSION = 1;

export type HiddenRecordingDriver = "window" | "hidden-safe";
export type HiddenRecordingInterrupt = "cover" | "modal";
export type HiddenRecordingHideAt = "start" | "mid" | "stop";

export interface HiddenRecordingTakeRecord extends TakeFigures {
  verdict: TakeVerdict | "not-hidden";
  detail: string;
}

export interface HiddenRecordingRow {
  driver: HiddenRecordingDriver;
  interrupt: HiddenRecordingInterrupt;
  hideAt: HiddenRecordingHideAt;
  hiddenSeconds: number;
  hiddenAtMs: number | null;
  visibleAtMs: number | null;
  hiddenSpanMs: number | null;
  frameGapMaxMs: number | null;
  positionFrozenMs: number;
  syncResumeMs: number | null;
  take1: HiddenRecordingTakeRecord;
  take2: HiddenRecordingTakeRecord | null;
  take2Started: boolean;
  samples: PositionSample[];
  error: string | null;
}

export interface HiddenRecordingSummary {
  schemaVersion: number;
  runToken: number;
  userAgent: string;
  sdkVersion: string;
  sampleRate: number;
  bpm: number;
  rows: HiddenRecordingRow[];
}

export function summaryFileName(runToken: number): string {
  return `hiddenrec-summary-${runToken}.json`;
}

export function parseHiddenRecordingSummary(json: unknown, runToken: number): HiddenRecordingSummary {
  if (typeof json !== "object" || json === null) throw new Error(`summary ${runToken}: not an object`);
  const summary = json as Record<string, unknown>;
  if (summary.schemaVersion !== HIDDEN_RECORDING_SCHEMA_VERSION) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, readable: ${HIDDEN_RECORDING_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(summary.rows)) throw new Error(`summary ${runToken}: rows is not an array`);
  summary.rows.forEach((row: Record<string, unknown>, i: number) => {
    if (typeof row.driver !== "string") throw new Error(`summary ${runToken}: row ${i} lacks driver`);
    if (typeof row.take1 !== "object" || row.take1 === null) throw new Error(`summary ${runToken}: row ${i} lacks take1`);
  });
  return summary as unknown as HiddenRecordingSummary;
}
