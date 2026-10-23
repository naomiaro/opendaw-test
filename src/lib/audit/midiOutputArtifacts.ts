/**
 * What a run of the MIDI output timing audit persists, to `/__verify/midiout-summary-<runToken>.json`
 * (the dev server writes `.verify-output/`), and the one reader the table script uses.
 */
import type { RecordingAnchor } from "./midiClockMap";
import type { Density, JankMode, MidiOutputParams, OutputArm } from "./midiOutputParams";
import type { JankBlock } from "./midiOutputPattern";
import type { OutputNoteRow, OutputRepeatFigures } from "./midiOutputTiming";
import type { OutputCellStatus } from "./midiOutputVerdict";

export const MIDI_OUTPUT_SCHEMA_VERSION = 1;

export interface OutputCellKey {
  arm: OutputArm;
  bpm: number;
  density: Density;
  jank: JankMode;
  transport: boolean;
}

export interface OutputRepeatRow extends OutputRepeatFigures {
  repeat: number;
  /** `<stage>: <message>` when the repeat threw; the figures are then null, not NaN. */
  error: string | null;
  notes: OutputNoteRow[];
  anchor: RecordingAnchor | null;
  originPpqn: number;
  heardLagMs: number | null;
  outputLatencyMs: number | null;
  /** The worklet adds this beside the output latency; 0 unless delay compensation is active. */
  compensationLatencyMs: number | null;
  delayInMs: number;
  quantumMs: number;
  frameIntervalMs: number | null;
  frameGapMaxMs: number | null;
  /** The measured spans; empty without jank. */
  jankBlocks: JankBlock[];
  jankMs: number | null;
}

export interface OutputCellRecord extends OutputCellKey {
  status: OutputCellStatus;
  detail: string;
  repeats: OutputRepeatRow[];
}

export interface MidiOutputSummary {
  schemaVersion: typeof MIDI_OUTPUT_SCHEMA_VERSION;
  runToken: number;
  sdkVersion: string;
  chrome: string;
  date: string;
  sampleRate: number;
  params: MidiOutputParams;
  cells: OutputCellRecord[];
}

export function summaryFileName(runToken: number): string {
  return `midiout-summary-${runToken}.json`;
}

export function parseMidiOutputSummary(json: unknown, runToken: number): MidiOutputSummary {
  if (typeof json !== "object" || json === null) throw new Error(`summary ${runToken}: not an object`);
  const summary = json as Record<string, unknown>;
  if (summary.schemaVersion !== MIDI_OUTPUT_SCHEMA_VERSION) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, readable: ${MIDI_OUTPUT_SCHEMA_VERSION}`);
  }
  if (summary.runToken !== runToken) throw new Error(`summary ${runToken}: runToken ${String(summary.runToken)} does not match the file`);
  if (!Array.isArray(summary.cells)) throw new Error(`summary ${runToken}: cells is not an array`);
  return summary as unknown as MidiOutputSummary;
}

const ms = (v: number | null): string => (v === null ? "—" : v.toFixed(2));

export const CELL_TABLE_HEADER =
  "arm | bpm | density | jank | transport | status | median ms (per repeat) | max dev ms | late tail ms | inside-blocks median ms | missing/extra/stuck/velocity | transport msgs (max per repeat) | delay ms | frame ms | heard lag ms | detail";

/** One line per cell, the columns of `CELL_TABLE_HEADER`; an error repeat adds `r<n> error: <stage>` at the end. */
export function cellTableLines(summary: MidiOutputSummary): string[] {
  const max = (values: Array<number | null>): number | null => {
    const present = values.filter((v): v is number => v !== null);
    return present.length === 0 ? null : Math.max(...present);
  };
  const sum = (rows: OutputRepeatRow[], key: "missing" | "extra" | "stuck" | "velocityMismatches"): number =>
    rows.reduce((acc, r) => acc + r[key], 0);
  return summary.cells.map((cell) => {
    const rows = cell.repeats;
    return [
      cell.arm,
      cell.bpm,
      cell.density,
      cell.jank,
      cell.transport ? "on" : "off",
      cell.status,
      rows.map((r) => ms(r.medianErrorMs)).join(" / "),
      ms(max(rows.map((r) => r.maxAbsDevMs))),
      ms(max(rows.map((r) => r.lateTailMs))),
      ms(max(rows.map((r) => r.medianErrorInsideBlocksMs))),
      `${sum(rows, "missing")}/${sum(rows, "extra")}/${sum(rows, "stuck")}/${sum(rows, "velocityMismatches")}`,
      max(rows.map((r) => r.transportMessages)) ?? "—", // per repeat, the largest
      rows[0]?.delayInMs ?? "—",
      ms(max(rows.map((r) => r.frameIntervalMs))),
      ms(max(rows.map((r) => r.heardLagMs))),
      cell.detail,
      ...rows.filter((r) => r.error !== null).map((r) => `r${r.repeat} error: ${r.error}`),
    ].join(" | ");
  });
}
