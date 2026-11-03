/**
 * Drive a Spielwerk script through the SDK's INSTALLED runtime in Node, the way the engine's
 * bridge does: the pattern's note-ons and note-offs are written as 40-byte event records into a
 * shared buffer per render block, `runSpielwerk` runs the script's generator over them, and the
 * runtime's own validation and scheduler limits apply. For tests only.
 */
import { ScriptDeclaration } from "@opendaw/studio-adapters";
// The package's exports map does not expose the module; import it by relative path (as CLAUDE.md does for `sync/`).
import { runSpielwerk, SpielwerkRuntime } from "../../../node_modules/@opendaw/studio-core-wasm/dist/script-spielwerk.js";
import { PATTERN_BPM, PATTERN_PPQN, type PatternNote } from "@/lib/midiEffects/patterns";

/** EventRecord (abi, 40 bytes, little-endian): position f64@0, offset u32@8, kind u32@12, id u32@16, pitch u32@20, velocity f32@24, cent f32@28, duration f64@32. */
const RECORD_BYTES = 40;
const IN_MAX = 128;
const OUT_MAX = 128;
const KIND_NOTE_ON = 0;
const KIND_NOTE_OFF = 1;
const FLAG_TRANSPORTING = 1;
const FLAG_DISCONTINUOUS = 2;
/** The engine's render quantum at 48 kHz and the patterns' tempo, in pulses. */
const PULSES_PER_BLOCK = (128 / 48000) * (PATTERN_BPM / 60) * 960;

export interface SweepResult {
  /** The runtime's message when a block threw, with where; null when every block ran. */
  error: string | null;
  /** The most notes the runtime held for later blocks at any point. */
  maxScheduled: number;
  /** Note-ons and note-offs emitted over the whole run. */
  emitted: number;
}

/** Every combination of each `@param` at its min and at its max; one empty set when the script declares none. */
export function parameterCorners(source: string): Record<string, number>[] {
  const declarations = ScriptDeclaration.parseParams(source);
  if (declarations.length === 0) return [{}];
  const corners: Record<string, number>[] = [];
  for (let mask = 0; mask < 1 << declarations.length; mask++) {
    corners.push(Object.fromEntries(declarations.map((d, i) => [d.label, mask & (1 << i) ? d.max : d.min])));
  }
  return corners;
}

interface Record40 { kind: number; position: number; id: number; pitch: number; velocity: number; duration: number }

function writeRecord(view: DataView, slot: number, r: Record40): void {
  const base = slot * RECORD_BYTES;
  view.setFloat64(base, r.position, true);
  view.setUint32(base + 8, 0, true);
  view.setUint32(base + 12, r.kind, true);
  view.setUint32(base + 16, r.id, true);
  view.setUint32(base + 20, r.pitch, true);
  view.setFloat32(base + 24, r.velocity, true);
  view.setFloat32(base + 28, 0, true);
  view.setFloat64(base + 32, r.duration, true);
}

/**
 * Run `source` with `params` over `notes` (a two-bar pattern) for `loops` passes, the loop wrap
 * flagged discontinuous as the engine flags it.
 */
export function sweepScript(source: string, params: Record<string, number>, notes: readonly PatternNote[], loops = 3): SweepResult {
  const Processor = new Function(`${source}\nreturn Processor;`)() as new () => {
    process(block: object, events: Iterable<unknown>): Iterable<unknown>;
    paramChanged?(label: string, value: number): void;
  };
  const proc = new Processor();
  for (const [label, value] of Object.entries(params)) proc.paramChanged?.(label, value);
  const pass = ScriptDeclaration.parsePassThrough(source);
  const runtime = new SpielwerkRuntime();
  const memory = new ArrayBuffer(RECORD_BYTES * (IN_MAX + OUT_MAX));
  const inPtr = 0;
  const outPtr = RECORD_BYTES * IN_MAX;
  const view = new DataView(memory, inPtr);
  let maxScheduled = 0;
  let emitted = 0;
  let nextId = 1;
  for (let loop = 0; loop < loops; loop++) {
    const ids = new Map<number, number>();
    for (let from = 0; from < PATTERN_PPQN; from += PULSES_PER_BLOCK) {
      const to = Math.min(PATTERN_PPQN, from + PULSES_PER_BLOCK);
      const records: Record40[] = [];
      notes.forEach((n, index) => {
        if (n.position >= from && n.position < to) {
          ids.set(index, nextId++);
          records.push({ kind: KIND_NOTE_ON, position: n.position, id: ids.get(index)!, pitch: n.pitch, velocity: n.velocity, duration: n.duration });
        }
        const end = n.position + n.duration;
        if (end >= from && end < to) {
          records.push({ kind: KIND_NOTE_OFF, position: end, id: ids.get(index) ?? 0, pitch: n.pitch, velocity: 0, duration: 0 });
        }
      });
      records.sort((a, b) => a.position - b.position || a.kind - b.kind);
      records.forEach((r, slot) => writeRecord(view, slot, r));
      const flags = from === 0 && loop > 0 ? FLAG_TRANSPORTING | FLAG_DISCONTINUOUS : FLAG_TRANSPORTING;
      try {
        emitted += runSpielwerk(runtime, proc, memory, inPtr, records.length, outPtr, OUT_MAX, from, to, PATTERN_BPM, flags, 0, 128, pass);
      } catch (error) {
        return {
          error: `loop ${loop}, block from ${from.toFixed(0)}: ${error instanceof Error ? error.message : String(error)}`,
          maxScheduled,
          emitted,
        };
      }
      maxScheduled = Math.max(maxScheduled, runtime.scheduled.length);
    }
  }
  return { error: null, maxScheduled, emitted };
}
