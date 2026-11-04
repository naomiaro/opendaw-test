import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { ArpeggioDeviceBoxAdapter, GrooveShuffleBoxAdapter } from "@opendaw/studio-adapters";
import { ArpeggioDeviceBox, PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import { BAR_PPQN, PATTERN_BPM, PATTERN_PPQN } from "@/lib/midiEffects/patterns";
import { midiEffectFixture, transact } from "@/lib/testing/boxGraphFixtures";
import { zeitgeistGrooveBox } from "./midiEffectChain";
import type { EffectBox } from "@opendaw/studio-core";
import { arpeggioRule, type DeviceSetting, type RuleContext } from "./midiEffectSemanticsRules";
import {
  ARPEGGIO_BASE, AUDIT_PATTERNS, CALIBRATION_ROW_ID, FACTORY_KEYS, QUICK_IDS, HELD_NOTE, PITCH_BASE, REGION_DURATION_PPQN, REGION_POSITION_PPQN, SAMPLE_SECONDS,
  SEMANTICS_ROWS, VELOCITY_BASE, ZEITGEIST_BASE, applySettings, settingsOf, predictedVariants, renderRange, renderSeconds, resolveRows, rowNotes,
  type RowGroup, type SemanticsRow,
} from "./midiEffectSemanticsRows";

const context: RuleContext = {
  range: { from: REGION_POSITION_PPQN, to: REGION_POSITION_PPQN + REGION_DURATION_PPQN },
  computeVelocity: (_position, original) => original,
  warp: (position) => position,
};
const rowById = (id: string): SemanticsRow => {
  const row = SEMANTICS_ROWS.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
};
const GROUPS: RowGroup[] = ["dry", "arpeggio", "pitch", "velocity", "zeitgeist", "order", "disabled"];
const quick = SEMANTICS_ROWS.filter((row) => row.quick);

describe("SEMANTICS_ROWS", () => {
  it("has unique ids, dry-sixteenths first, every group present, between 180 and 320 rows", () => {
    expect(new Set(SEMANTICS_ROWS.map((r) => r.id)).size).toBe(SEMANTICS_ROWS.length);
    expect(SEMANTICS_ROWS[0].id).toBe("dry-sixteenths");
    for (const group of GROUPS) expect(SEMANTICS_ROWS.some((r) => r.group === group)).toBe(true);
    expect(SEMANTICS_ROWS.length).toBeGreaterThanOrEqual(180);
    expect(SEMANTICS_ROWS.length).toBeLessThanOrEqual(320);
    expect(SEMANTICS_ROWS.filter((r) => r.group === "dry").map((r) => r.id)).toEqual(["dry-sixteenths", "dry-melody", "dry-chromatic", "dry-held-note"]);
    expect(SEMANTICS_ROWS.filter((r) => r.group === "dry").every((r) => r.chain.length === 0)).toBe(true);
  });
  it("counts per group follow the brief", () => {
    const count = (group: RowGroup) => SEMANTICS_ROWS.filter((r) => r.group === group).length;
    expect(GROUPS.map(count)).toEqual([4, 88, 40, 38, 50, 6, 4]);
  });
  it("has 230 rows, 41 of them quick (the counts src/demos/midi/CLAUDE.md gives)", () => {
    expect(SEMANTICS_ROWS.length).toBe(230);
    expect(quick.length).toBe(41);
  });
  it("every quick id names a row: a renamed row cannot silently leave the quick subset", () => {
    const ids = new Set(SEMANTICS_ROWS.map((r) => r.id));
    expect([...QUICK_IDS].filter((id) => !ids.has(id))).toEqual([]);
  });
  it("the calibration row leads the table and is a dry row", () => {
    expect(SEMANTICS_ROWS[0]).toMatchObject({ id: CALIBRATION_ROW_ID, group: "dry", chain: [] });
  });
  it("every chain holds at most one Velocity and one Zeitgeist: the rule context carries one computeVelocity and one warp", () => {
    for (const row of SEMANTICS_ROWS) {
      for (const device of ["velocity", "zeitgeist"] as const) {
        expect(row.chain.filter((stage) => stage.setting.device === device).length, `${row.id} ${device}`).toBeLessThanOrEqual(1);
      }
    }
  });
  it("the quick subset has 30 to 60 rows and every order and disabled row", () => {
    expect(quick.length).toBeGreaterThanOrEqual(30);
    expect(quick.length).toBeLessThanOrEqual(60);
    for (const row of SEMANTICS_ROWS.filter((r) => r.group === "order" || r.group === "disabled")) expect(row.quick).toBe(true);
    expect(quick.slice(0, 4).map((r) => r.id)).toEqual(["dry-sixteenths", "dry-melody", "dry-chromatic", "dry-held-note"]);
    expect(rowById("arp-rate9-gate1-held-note").quick).toBe(true);
    expect(rowById("arp-rate9-gate0.5-held-note").quick).toBe(false);
  });
  it("every row's notes fit the sample: duration_s × 2^((pitch − 69)/12) ≤ 4 over every variant, including uncapped note-offs", () => {
    for (const row of SEMANTICS_ROWS) {
      for (const variant of predictedVariants(row, context)) {
        for (const n of variant.notes) {
          const used = PPQN.pulsesToSeconds(n.duration, PATTERN_BPM) * 2 ** ((n.pitch - 69) / 12);
          expect(used, `${row.id} pitch ${n.pitch} duration ${n.duration}`).toBeLessThanOrEqual(SAMPLE_SECONDS);
        }
      }
    }
  });
  it("the held-note pattern ends off the grid so the base Arpeggio row's last step is capped (70 pulses)", () => {
    const row = rowById("arp-oct1-held-note");
    expect(HELD_NOTE.notes[0].duration).toBe(1750);
    const [capped, uncapped] = [new Set<never>(), new Set(["arpeggio-uncapped-note-off" as const])].map((deviations) =>
      arpeggioRule(rowNotes(row), ARPEGGIO_BASE, deviations, context.range));
    expect(capped.at(-1)?.duration).toBe(70);
    expect(uncapped.at(-1)?.duration).toBe(120);
    expect(predictedVariants(row, context).map((v) => [...v.deviations].sort().join("+")).sort()).toEqual([
      "",
      "arpeggio-drops-cent",
      "arpeggio-drops-cent+arpeggio-uncapped-note-off",
      "arpeggio-drops-cent+arpeggio-uncapped-note-off+arpeggio-velocity-matrix",
      "arpeggio-drops-cent+arpeggio-velocity-matrix",
      "arpeggio-uncapped-note-off",
      "arpeggio-uncapped-note-off+arpeggio-velocity-matrix",
      "arpeggio-velocity-matrix",
    ]);
  });
  it("the zeitgeist rows cover each distinct duration once (8 values, 960 once)", () => {
    const distinct = [...new Set(GrooveShuffleBoxAdapter.DurationPPQNs)];
    expect(distinct.length).toBe(8);
    expect(GrooveShuffleBoxAdapter.DurationPPQNs.length).toBe(9);
    for (const d of distinct) {
      expect(SEMANTICS_ROWS.filter((r) => r.id.startsWith("zg-amount") && r.id.endsWith(`-dur${d}-sixteenths`)).length).toBe(5);
    }
    expect(SEMANTICS_ROWS.filter((r) => r.id.endsWith("-sixteenths") && r.id.startsWith("zg-")).length).toBe(40);
    expect(SEMANTICS_ROWS.filter((r) => r.id.startsWith("zg-") && r.id.endsWith("-melody")).map((r) => r.id)).toEqual(
      [0, 0.25, 0.5, 0.75, 1].flatMap((a) => [480, 3840].map((d) => `zg-amount${a}-dur${d}-melody`)));
  });
  it("predictedVariants clips a note a variant pushes past the end of the context's range", () => {
    const end = REGION_POSITION_PPQN + REGION_DURATION_PPQN;
    const pushing: RuleContext = { ...context, warp: (position) => position + 150 };
    const notes = predictedVariants(rowById("zg-amount0.75-dur480-sixteenths"), pushing).flatMap((v) => v.notes);
    expect(notes.every((n) => n.position + n.duration <= end && n.position < end)).toBe(true);
    expect(notes.some((n) => n.position + n.duration === end)).toBe(true);
  });
  it("predictedVariants skips a disabled device and takes deviations only from enabled ones", () => {
    const disabled = rowById("disabled-zeitgeist");
    expect(disabled.chain.every((c) => !c.enabled)).toBe(true);
    const variants = predictedVariants(disabled, context);
    expect(variants.length).toBe(1);
    expect(variants[0].notes.map((n) => n.position)).toEqual(rowNotes(disabled).map((n) => n.position));
    const shifting: RuleContext = { ...context, warp: (position) => position + (position % 480 === 240 ? 60 : 0) };
    const zg = predictedVariants(rowById("zg-amount0.75-dur480-sixteenths"), shifting);
    expect(zg.map((v) => [...v.deviations])).toEqual([[], ["zeitgeist-warps-note-off"]]);
    expect(zg[0].notes[1].duration).toBe(120);
    expect(zg[1].notes[1].duration).toBe(60);
  });
  it("rowNotes makes the pattern absolute", () => {
    const notes = rowNotes(rowById("dry-sixteenths"));
    expect(notes.length).toBe(32);
    expect(notes[0].position).toBe(BAR_PPQN);
    expect(notes[1].position).toBe(BAR_PPQN + 240);
    expect(AUDIT_PATTERNS.map((p) => p.id)).toEqual(["held-note", "held-chord", "chromatic", "chords", "sixteenths", "melody"]);
  });
  it("renderSeconds is the end of the region plus the tail", () => {
    expect(renderSeconds(120)).toBeCloseTo(PPQN.pulsesToSeconds(BAR_PPQN + PATTERN_PPQN, 120) + 0.25, 12);
    expect(renderSeconds(120)).toBeCloseTo(6.25, 9);
  });
  it("FACTORY_KEYS names the four factories", () => {
    expect(FACTORY_KEYS).toEqual({ arpeggio: "Arpeggio", pitch: "Pitch", velocity: "Velocity", zeitgeist: "Zeitgeist" });
  });
  it("labels are sentences from the settings", () => {
    expect(rowById("arp-mode2-oct3-held-chord").label).toBe("Arpeggio UpDown, 3 octaves — held chord");
    expect(rowById("pitch-st7-chromatic").label).toBe("Pitch +7 st — chromatic");
    expect(rowById("zg-amount0.75-dur480-sixteenths").label).toBe("Zeitgeist 75 %, 1/8 — sixteenths");
    expect(ArpeggioDeviceBoxAdapter.RateFractions[9]).toEqual([1, 16]);
  });
});

describe("resolveRows", () => {
  const none = { device: null, pattern: null, rows: null };
  it("all by default, quick, a device, a pattern, a named list; unknown values throw", () => {
    expect(resolveRows(none)).toEqual([...SEMANTICS_ROWS]);
    expect(resolveRows({ ...none, rows: "quick" })).toEqual(quick);
    const pitch = resolveRows({ ...none, device: "pitch" });
    expect(pitch.slice(0, 4).map((r) => r.group)).toEqual(["dry", "dry", "dry", "dry"]);
    expect(pitch.slice(4).every((r) => r.group === "pitch")).toBe(true);
    expect(pitch.length).toBe(44);
    const melody = resolveRows({ ...none, pattern: "melody" });
    expect(melody.filter((r) => r.group !== "dry").every((r) => r.pattern === "melody")).toBe(true);
    expect(melody.filter((r) => r.group === "dry").length).toBe(4);
    const named = resolveRows({ ...none, rows: "pitch-st7-chromatic,vel-offset0-melody" });
    expect(named.map((r) => r.id)).toEqual(["dry-sixteenths", "dry-melody", "dry-chromatic", "dry-held-note", "pitch-st7-chromatic", "vel-offset0-melody"]);
    expect(resolveRows({ ...none, rows: "dry-melody", device: "order" })[0].id).toBe("dry-sixteenths");
    expect(() => resolveRows({ ...none, rows: "nope" })).toThrow(/nope/);
    expect(() => resolveRows({ ...none, rows: "dry-melody,nope" })).toThrow(/nope/);
    expect(() => resolveRows({ ...none, device: "echo" })).toThrow(/echo/);
    expect(() => resolveRows({ ...none, pattern: "bass" })).toThrow(/bass/);
  });
});

describe("applySettings", () => {
  it("writes every Arpeggio field and the Zeitgeist groove fields", () => {
    const arp = midiEffectFixture("arpeggio");
    const settings = { modeIndex: 2 as const, numOctaves: 4, rateIndex: 12, gate: 1.5, repeat: 4, velocity: -0.5 };
    transact(arp.boxGraph, () => applySettings(arp.box, { device: "arpeggio", settings }));
    const a = arp.box as ArpeggioDeviceBox;
    expect([a.modeIndex.getValue(), a.numOctaves.getValue(), a.rateIndex.getValue(), a.gate.getValue(), a.repeat.getValue(), a.velocity.getValue()]).toEqual([2, 4, 12, 1.5, 4, -0.5]);

    const zg = midiEffectFixture("zeitgeist");
    transact(zg.boxGraph, () => applySettings(zg.box, { device: "zeitgeist", settings: { amount: 0.25, duration: 1920 } }));
    const groove = zeitgeistGrooveBox(zg.box as ZeitgeistDeviceBox);
    expect([groove.amount.getValue(), groove.duration.getValue()]).toEqual([0.25, 1920]);
  });
  it("writes Pitch and Velocity fields and refuses the wrong box", () => {
    const pitch = midiEffectFixture("pitch");
    transact(pitch.boxGraph, () => applySettings(pitch.box, { device: "pitch", settings: { semiTones: 7, cents: 12.5, octaves: -1 } }));
    const p = pitch.box as PitchDeviceBox;
    expect([p.semiTones.getValue(), p.cents.getValue(), p.octaves.getValue()]).toEqual([7, 12.5, -1]);
    const velocity = midiEffectFixture("velocity");
    transact(velocity.boxGraph, () => applySettings(velocity.box, { device: "velocity", settings: { magnetPosition: 1, magnetStrength: 0.5, randomAmount: 0.25, offset: -0.5, mix: 0.75 } }));
    const v = velocity.box as VelocityDeviceBox;
    expect([v.magnetPosition.getValue(), v.magnetStrength.getValue(), v.randomAmount.getValue(), v.offset.getValue(), v.mix.getValue()]).toEqual([1, 0.5, 0.25, -0.5, 0.75]);
    expect(() => transact(pitch.boxGraph, () => applySettings(pitch.box, { device: "velocity", settings: VELOCITY_BASE }))).toThrow();
    expect(PITCH_BASE).toEqual({ semiTones: 0, cents: 0, octaves: 0 });
    expect(ZEITGEIST_BASE).toEqual({ amount: 0.6, duration: 480 });
  });
});

describe("settingsOf", () => {
  it("round-trips every device through applySettings", () => {
    for (const setting of [
      { device: "arpeggio", settings: { ...ARPEGGIO_BASE, modeIndex: 2, gate: 0.75, repeat: 3 } },
      { device: "pitch", settings: { semiTones: 7, cents: -25, octaves: -1 } },
      { device: "velocity", settings: { ...VELOCITY_BASE, randomAmount: 0.5, offset: -0.25 } },
      { device: "zeitgeist", settings: { amount: 0.75, duration: 960 } },
    ] as DeviceSetting[]) {
      const fixture = midiEffectFixture(setting.device);
      transact(fixture.boxGraph, () => applySettings(fixture.box, setting));
      expect(settingsOf(fixture.box)).toEqual(setting);
    }
  });
  it("throws for a box it does not know", () => {
    class MaximizerDeviceBox {}
    expect(() => settingsOf(new MaximizerDeviceBox() as unknown as EffectBox)).toThrow(/no settings reader for MaximizerDeviceBox/);
  });
});

describe("renderRange", () => {
  it("runs from the region's start to the render's end: 12000 pulses at 120 bpm, a quarter second past the region", () => {
    expect(renderRange(120)).toEqual({ from: REGION_POSITION_PPQN, to: REGION_POSITION_PPQN + REGION_DURATION_PPQN + 480 });
  });
  it("keeps a note a device moved past the region's end and clips one crossing the render's end", () => {
    // a warp that moves every note 660 pulses later: 11040 lands at 11700, past the region; the last sixteenth (11280) at 11940, crossing 12000
    const row = SEMANTICS_ROWS.find((r) => r.id === "zg-amount0.75-dur480-sixteenths")!;
    const late = { ...context, range: renderRange(120), warp: (position: number) => position + 660 };
    const [intent] = predictedVariants(row, late);
    const tail = intent!.notes.filter((note) => note.position >= REGION_POSITION_PPQN + REGION_DURATION_PPQN);
    expect(tail.map((note) => [note.position, note.duration])).toEqual([[11700, 120], [11940, 60]]);
  });
});
