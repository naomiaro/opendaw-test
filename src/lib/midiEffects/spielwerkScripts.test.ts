import { describe, expect, it } from "vitest";
import { ScriptDeclaration } from "@opendaw/studio-adapters";
import { PATTERNS } from "./patterns";
import { parameterCorners, sweepScript } from "@/lib/testing/spielwerkRuntime";
import { SPIELWERK_REFERENCE, SPIELWERK_SCRIPTS, type ScriptId } from "./spielwerkScripts";

const NO_PASS: readonly ScriptId[] = ["humanize", "octave-jump", "strum", "note-filter"];

interface NoteOn { gate: true; id: number; position: number; duration: number; pitch: number; velocity: number; cent: number }
interface NoteOff { gate: false; id: number; position: number; pitch: number }
interface Yielded { position: number; duration: number; pitch: number; velocity: number; cent?: number }

/** Build the script's Processor the way the runtime does (the header only wraps it), with its params at their defaults. */
function instantiate(source: string): { process(block: object, events: Iterable<NoteOn | NoteOff>): Iterable<Yielded>; reset?(): void } {
  const Processor = new Function(`${source}\nreturn Processor;`)() as new () => {
    process(block: object, events: Iterable<NoteOn | NoteOff>): Iterable<Yielded>;
    paramChanged?(label: string, value: number): void;
    reset?(): void;
  };
  const proc = new Processor();
  for (const p of ScriptDeclaration.parseParams(source)) proc.paramChanged?.(p.label, p.defaultValue);
  return proc;
}

const BLOCK = { from: 3840, to: 7680, bpm: 120, flags: 0, s0: 0, s1: 128 };
/** A C major triad at the block start, a single note a beat later, and the triad's note-offs. */
const CHORD_EVENTS: (NoteOn | NoteOff)[] = [
  { gate: true, id: 1, position: 3840, duration: 960, pitch: 60, velocity: 0.8, cent: 0 },
  { gate: true, id: 2, position: 3840, duration: 960, pitch: 64, velocity: 0.8, cent: 0 },
  { gate: true, id: 3, position: 3840, duration: 960, pitch: 67, velocity: 0.8, cent: 0 },
  { gate: true, id: 4, position: 4800, duration: 480, pitch: 61, velocity: 0.5, cent: 0 },
  { gate: false, id: 1, position: 4800, pitch: 60 },
  { gate: false, id: 2, position: 4800, pitch: 64 },
  { gate: false, id: 3, position: 4800, pitch: 67 },
];

const run = (id: ScriptId, events = CHORD_EVENTS): Yielded[] => {
  const proc = instantiate(SPIELWERK_SCRIPTS.find((s) => s.id === id)!.source);
  return [...proc.process(BLOCK, events)];
};

describe("SPIELWERK_SCRIPTS", () => {
  it("lists the seven scripts, blank last", () => {
    expect(SPIELWERK_SCRIPTS.map((s) => s.id)).toEqual(["echo", "chord", "humanize", "octave-jump", "strum", "note-filter", "blank"]);
  });

  it("every script is a Processor with a process generator", () => {
    for (const s of SPIELWERK_SCRIPTS) {
      expect(s.source).toMatch(/class Processor/);
      expect(s.source).toMatch(/\*\s*process\s*\(\s*block\s*,\s*events\s*\)/);
    }
  });

  it("declared params match the @param lines, as the SDK parses them", () => {
    for (const s of SPIELWERK_SCRIPTS) {
      expect(ScriptDeclaration.parseParams(s.source).map((p) => p.label)).toEqual([...s.params]);
    }
  });

  it("no-pass scripts say so and the others forward", () => {
    for (const s of SPIELWERK_SCRIPTS) {
      expect(ScriptDeclaration.parsePassThrough(s.source)).toBe(!NO_PASS.includes(s.id));
    }
  });

  it("every yielded note is valid for the runtime", () => {
    for (const s of SPIELWERK_SCRIPTS) {
      for (const n of run(s.id)) {
        expect(Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127, `${s.id} pitch ${n.pitch}`).toBe(true);
        expect(n.velocity >= 0 && n.velocity <= 1, `${s.id} velocity ${n.velocity}`).toBe(true);
        expect(n.duration > 0, `${s.id} duration ${n.duration}`).toBe(true);
        expect(n.position >= BLOCK.from, `${s.id} position ${n.position}`).toBe(true);
      }
    }
  });

  it("echo yields `repeats` copies per note-on, each `delay` later, quieter each time", () => {
    const out = run("echo");
    expect(out).toHaveLength(4 * 3);
    const first = out.slice(0, 3);
    expect(first.map((n) => n.position)).toEqual([3840 + 240, 3840 + 480, 3840 + 720]);
    expect(first[0].velocity).toBeGreaterThan(first[1].velocity);
    expect(first.every((n) => n.pitch === 60)).toBe(true);
  });

  it("chord yields a third and a fifth above every note-on", () => {
    const out = run("chord");
    expect(out.filter((n) => n.position === 3840).map((n) => n.pitch).sort((a, b) => a - b)).toEqual([64, 67, 68, 71, 71, 74]);
  });

  it("humanize re-yields every note-on, nudged forward within `timing` and with velocity in range", () => {
    const out = run("humanize");
    expect(out).toHaveLength(4);
    for (const [i, n] of out.entries()) {
      const src = CHORD_EVENTS.filter((e): e is NoteOn => e.gate)[i];
      expect(n.position).toBeGreaterThanOrEqual(src.position);
      expect(n.position).toBeLessThanOrEqual(src.position + 30);
      expect(n.pitch).toBe(src.pitch);
    }
  });

  it("octave jump raises every third note-on by an octave and reset starts the count over", () => {
    const proc = instantiate(SPIELWERK_SCRIPTS.find((s) => s.id === "octave-jump")!.source);
    const out = [...proc.process(BLOCK, CHORD_EVENTS)];
    expect(out.map((n) => n.pitch)).toEqual([60, 64, 79, 61]);
    proc.reset?.();
    expect([...proc.process(BLOCK, CHORD_EVENTS)].map((n) => n.pitch)).toEqual([60, 64, 79, 61]);
  });

  it("strum spreads a chord's notes low to high by `spread` pulses and leaves a lone note alone", () => {
    const out = run("strum");
    expect(out.filter((n) => n.pitch !== 61).map((n) => [n.pitch, n.position])).toEqual([[60, 3840], [64, 3900], [67, 3960]]);
    expect(out.find((n) => n.pitch === 61)?.position).toBe(4800);
  });

  it("note filter keeps the C major notes and drops the C#", () => {
    expect(run("note-filter").map((n) => n.pitch)).toEqual([60, 64, 67]);
  });

  it("blank forwards and yields nothing", () => {
    expect(run("blank")).toEqual([]);
  });

  it("every reference entry has a runnable example whose params parse", () => {
    for (const e of SPIELWERK_REFERENCE) {
      expect(e.example).toMatch(/class Processor/);
      expect(() => instantiate(e.example)).not.toThrow();
    }
  });
});

describe("the scripts through the installed runtime", () => {
  /** Headroom under the runtime's scheduler limit (128): a slider corner must not get near it. */
  const SCHEDULED_CEILING = 96;
  const sources = [
    ...SPIELWERK_SCRIPTS.map((s) => ({ name: s.id, source: s.source })),
    ...SPIELWERK_REFERENCE.map((e) => ({ name: `reference:${e.name}`, source: e.example })),
  ];

  for (const { name, source } of sources) {
    it(`${name}: every parameter corner on every pattern runs three loops without a runtime error`, () => {
      for (const corner of parameterCorners(source)) {
        for (const pattern of PATTERNS) {
          const result = sweepScript(source, corner, pattern.notes);
          expect(result.error, `${name} ${JSON.stringify(corner)} on ${pattern.id}`).toBeNull();
          expect(result.maxScheduled, `${name} ${JSON.stringify(corner)} on ${pattern.id}: scheduled`).toBeLessThanOrEqual(SCHEDULED_CEILING);
        }
      }
    });
  }
});
