/** What a run of the combined MIDI + audio audit persists, to `/__verify/combined-summary-<runToken>.json`. */
import type { AuditBuildFeature } from "./recordingAuditCalibration";
import type { MidiScenario } from "./midiInputCalibration";
import type { RepeatFigures } from "./midiInputAlignment";
import type { MidiAuditNoteRow } from "./midiInputArtifacts";
import type { InputLatencyState } from "./combinedClicks";
import type { MicRoundTrip } from "./combinedCalibration";
import type { CombinedFigures, CombinedPair } from "./combinedAudio";
import type { CombinedStatus } from "./combinedVerdict";

export const COMBINED_SCHEMA_VERSION = 1;
export const COMBINED_ROW_COUNTS = ["clicksFound", "clicksMissing", "clicksExtra", "pairs", "onsetsOutsideSpan"] as const;

export interface CombinedRow extends CombinedFigures {
  scenario: MidiScenario;
  state: InputLatencyState;
  bpm: number;
  repeat: number;
  status: CombinedStatus | "pending" | "error";
  detail: string | null;
  midi: RepeatFigures | null;
  midiNotes: MidiAuditNoteRow[];
  pairsDetail: CombinedPair[];
  micRoundTripMs: number | null;
  micRoundTripSpreadMs: number | null;
  /** The output latency the calibration subtracted; the repeat's own is `outputLatencyMs` (the two can differ). */
  micOutputLatencyMs: number | null;
  micInputPartMs: number | null;
  inputLatencyAppliedMs: number | null;
  outputLatencyMs: number | null;
  compensationLatencyMs: number | null;
  heardLagMs: number | null;
  frameIntervalMs: number | null;
  frameGapMaxMs: number | null;
  sampleRate: number | null;
  anchorContextTime: number | null;
  originPpqn: number | null;
  takeRegionStartSec: number | null;
  waveformOffsetSec: number | null;
  cleanupWarning: string | null;
}

export interface CombinedCellVerdict {
  scenario: MidiScenario;
  state: InputLatencyState;
  status: CombinedStatus;
  detail: string;
}

export interface CombinedSummary {
  schemaVersion: number;
  runToken: number;
  userAgent: string;
  sdkVersion: string;
  buildFeatures: AuditBuildFeature[];
  busName: string;
  inputDevice: string;
  outputDevice: string;
  sampleRate: number;
  micRoundTrip: MicRoundTrip;
  repeatsPerCell: number;
  scenarios: MidiScenario[];
  states: InputLatencyState[];
  cellVerdicts: CombinedCellVerdict[];
  rows: CombinedRow[];
}

export function combinedSummaryFileName(runToken: number): string {
  return `combined-summary-${runToken}.json`;
}

export function parseCombinedSummary(json: unknown, runToken: number): CombinedSummary {
  if (typeof json !== "object" || json === null) throw new Error(`summary ${runToken}: not an object`);
  const summary = json as Record<string, unknown>;
  if (summary.schemaVersion !== COMBINED_SCHEMA_VERSION) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, expected ${COMBINED_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(summary.rows)) throw new Error(`summary ${runToken}: rows is not an array`);
  if (!Array.isArray(summary.cellVerdicts)) throw new Error(`summary ${runToken}: cellVerdicts is not an array`);
  const mic = summary.micRoundTrip as Record<string, unknown> | undefined;
  if (typeof mic !== "object" || mic === null || typeof mic.roundTripMs !== "number" || typeof mic.inputPartMs !== "number") {
    throw new Error(`summary ${runToken}: micRoundTrip lacks roundTripMs / inputPartMs`);
  }
  summary.rows.forEach((row: Record<string, unknown>, i: number) => {
    for (const key of COMBINED_ROW_COUNTS) {
      if (typeof row[key] !== "number") throw new Error(`summary ${runToken}: row ${i} lacks ${key}`);
    }
  });
  return summary as unknown as CombinedSummary;
}
