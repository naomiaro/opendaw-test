/**
 * What a run of the MIDI effect placement audit persists: one record per row and one summary
 * per run, uploaded to the dev server's `/__verify` sink as `midifx-summary-<runToken>.json`
 * and read back by `scripts/audit/midi-effect-placement/table.ts`.
 */
import type { MidiEffectDevice, MidiEffectRowId } from "./midiEffectScenarios";
import type { RowVerdict } from "./midiEffectPlacement";

/** 1: the first runs. */
export const MIDI_EFFECT_SCHEMA_VERSION = 1;

export interface MidiEffectRowRecord {
  id: MidiEffectRowId;
  label: string;
  device: MidiEffectDevice | null;
  enabled: boolean;
  judge: "pass-through" | "rule";
  status: RowVerdict["status"];
  /** The investigate figure or the error message; null when as-predicted. */
  figure: string | null;
  lag: number | null;
  score: number | null;
  peak: number;
  onsets: number[];
  expected: number[];
  deltas: number[];
  expectedCount: number;
}

export interface MidiEffectSummary {
  schemaVersion: number;
  runToken: number;
  userAgent: string;
  sdkVersion: string;
  sampleRate: number;
  bpm: number;
  instrumentOffsetFrames: number;
  deviceParam: string;
  rows: MidiEffectRowRecord[];
}

export function summaryFileName(runToken: number): string {
  return `midifx-summary-${runToken}.json`;
}

const ROW_ARRAYS = ["onsets", "expected", "deltas"] as const;

export function parseMidiEffectSummary(json: unknown, runToken: number): MidiEffectSummary {
  if (typeof json !== "object" || json === null) throw new Error(`summary ${runToken}: not an object`);
  const summary = json as Record<string, unknown>;
  if (summary.schemaVersion !== MIDI_EFFECT_SCHEMA_VERSION) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, readable: ${MIDI_EFFECT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(summary.rows)) throw new Error(`summary ${runToken}: rows is not an array`);
  summary.rows.forEach((row: Record<string, unknown>, i: number) => {
    if (typeof row.peak !== "number") throw new Error(`summary ${runToken}: row ${i} peak is ${typeof row.peak}, not a number`);
    for (const key of ROW_ARRAYS) {
      if (!Array.isArray(row[key])) throw new Error(`summary ${runToken}: row ${i} ${key} is not an array`);
    }
  });
  return summary as unknown as MidiEffectSummary;
}
