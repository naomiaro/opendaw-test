/**
 * What a run of the MIDI output timing audit persists, to `/__verify/midiout-summary-<runToken>.json`
 * (the dev server writes `.verify-output/`), and the one reader the table script uses.
 */
import type { RecordingAnchor } from "./midiClockMap";
import type { Density, JankMode, MidiOutputParams, OutputArm } from "./midiOutputParams";
import type { JankBlock } from "./midiOutputPattern";
import type { OutputNoteRow, OutputRepeatFigures, PairDriftSummary } from "./midiOutputTiming";
import type { OutputCellStatus } from "./midiOutputVerdict";

/** 2 added the drift witness (`medianErrorLiveMs`, `maxAbsDevLiveMs`, `pairDrift`, a note's `errorLiveMs`); a 1 is read with those null. */
export const MIDI_OUTPUT_SCHEMA_VERSION = 2;
export const MIDI_OUTPUT_SCHEMA_VERSIONS_READABLE = [1, 2] as const;

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
  /** How far the heard-clock relation and the output latency moved during the repeat (per-frame reads); null when nothing was sampled. */
  pairDrift: PairDriftSummary | null;
}

export interface OutputCellRecord extends OutputCellKey {
  status: OutputCellStatus;
  detail: string;
  repeats: OutputRepeatRow[];
}

export interface MidiOutputSummary {
  schemaVersion: (typeof MIDI_OUTPUT_SCHEMA_VERSIONS_READABLE)[number];
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
  if (!(MIDI_OUTPUT_SCHEMA_VERSIONS_READABLE as readonly unknown[]).includes(summary.schemaVersion)) {
    throw new Error(`summary ${runToken}: schemaVersion ${String(summary.schemaVersion)}, readable: ${MIDI_OUTPUT_SCHEMA_VERSIONS_READABLE.join(", ")}`);
  }
  if (summary.runToken !== runToken) throw new Error(`summary ${runToken}: runToken ${String(summary.runToken)} does not match the file`);
  if (!Array.isArray(summary.cells)) throw new Error(`summary ${runToken}: cells is not an array`);
  const current = summary.schemaVersion === MIDI_OUTPUT_SCHEMA_VERSION;
  const witnessFields = ["medianErrorLiveMs", "maxAbsDevLiveMs", "pairDrift"] as const;
  summary.cells.forEach((cell: Record<string, unknown>, c: number) => {
    if (!Array.isArray(cell.repeats)) throw new Error(`summary ${runToken}: cell ${c} repeats is not an array`);
    cell.repeats.forEach((row: Record<string, unknown>, i: number) => {
      for (const field of witnessFields) {
        if (row[field] === undefined) {
          if (current) throw new Error(`summary ${runToken}: cell ${c} repeat ${i} lacks ${field}`);
          row[field] = null;
        }
      }
      if (Array.isArray(row.notes)) {
        for (const note of row.notes as Record<string, unknown>[]) {
          if (note.errorLiveMs === undefined) {
            if (current) throw new Error(`summary ${runToken}: cell ${c} repeat ${i} has a note without errorLiveMs`);
            note.errorLiveMs = null;
          }
        }
      }
    });
  });
  return summary as unknown as MidiOutputSummary;
}

const ms = (v: number | null): string => (v === null ? "—" : v.toFixed(2));

export const CELL_TABLE_HEADER =
  "arm | bpm | density | jank | transport | status | median ms (per repeat) | max dev ms | late tail ms | inside-blocks median ms | live median ms (per repeat) | live max dev ms | pair drift min..max ms | missing/extra/stuck/velocity | transport msgs (max per repeat) | delay ms | frame ms | heard lag ms | detail";

/** One line per cell, the columns of `CELL_TABLE_HEADER`; an error repeat adds `r<n> error: <stage>` at the end. */
export function cellTableLines(summary: MidiOutputSummary): string[] {
  const present = (values: Array<number | null>): number[] => values.filter((v): v is number => v !== null);
  const max = (values: Array<number | null>): number | null => (present(values).length === 0 ? null : Math.max(...present(values)));
  const min = (values: Array<number | null>): number | null => (present(values).length === 0 ? null : Math.min(...present(values)));
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
      rows.map((r) => ms(r.medianErrorLiveMs)).join(" / "),
      ms(max(rows.map((r) => r.maxAbsDevLiveMs))),
      rows.every((r) => r.pairDrift === null)
        ? "—"
        : `${ms(min(rows.map((r) => r.pairDrift?.driftMinMs ?? null)))}..${ms(max(rows.map((r) => r.pairDrift?.driftMaxMs ?? null)))}`,
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
