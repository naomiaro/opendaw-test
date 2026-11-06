import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { ArpeggioDeviceBoxAdapter, GrooveShuffleBoxAdapter } from "@opendaw/studio-adapters";
import { ArpeggioDeviceBox, PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox } from "@opendaw/studio-core";
import { BAR_PPQN, PATTERN_BPM, PATTERN_PPQN, patternById } from "@/lib/midiEffects/patterns";
import { midiEffectFixture, transact } from "@/lib/testing/boxGraphFixtures";
import { zeitgeistGrooveBox } from "./midiEffectChain";
import { arpeggioRule, composeRules, markReadability, type DeviceSetting, type RuleContext } from "./midiEffectSemanticsRules";
import {
  ARPEGGIO_BASE, AUDIT_PATTERNS, CALIBRATION_ROW_ID, FACTORY_KEYS, QUICK_IDS, HELD_NOTE, NOTE_FILTER_BASE, PITCH_BASE, REGION_DURATION_PPQN, REGION_POSITION_PPQN, SAMPLE_SECONDS,
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
const GROUPS: RowGroup[] = ["dry", "arpeggio", "pitch", "velocity", "zeitgeist", "note-filter", "order", "disabled"];
const quick = SEMANTICS_ROWS.filter((row) => row.quick);

describe("SEMANTICS_ROWS", () => {
  it("has unique ids, dry-sixteenths first, every group present, between 180 and 400 rows", () => {
    expect(new Set(SEMANTICS_ROWS.map((r) => r.id)).size).toBe(SEMANTICS_ROWS.length);
    expect(SEMANTICS_ROWS[0].id).toBe("dry-sixteenths");
    for (const group of GROUPS) expect(SEMANTICS_ROWS.some((r) => r.group === group)).toBe(true);
    expect(SEMANTICS_ROWS.length).toBeGreaterThanOrEqual(180);
    expect(SEMANTICS_ROWS.length).toBeLessThanOrEqual(400);
    expect(SEMANTICS_ROWS.filter((r) => r.group === "dry").map((r) => r.id)).toEqual(["dry-sixteenths", "dry-melody", "dry-chromatic", "dry-held-note"]);
    expect(SEMANTICS_ROWS.filter((r) => r.group === "dry").every((r) => r.chain.length === 0)).toBe(true);
  });
  it("counts per group follow the brief", () => {
    const count = (group: RowGroup) => SEMANTICS_ROWS.filter((r) => r.group === group).length;
    expect(GROUPS.map(count)).toEqual([4, 149, 40, 38, 105, 28, 10, 5]);
  });
  it("has 379 rows, 53 of them quick (the counts src/demos/midi/CLAUDE.md gives)", () => {
    expect(SEMANTICS_ROWS.length).toBe(379);
    expect(quick.length).toBe(53);
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
  it("every row's notes fit the sample: duration_s × 2^((pitch − 69)/12) ≤ 4 over every variant, a step running past the held note included", () => {
    for (const row of SEMANTICS_ROWS) {
      for (const variant of predictedVariants(row, context)) {
        for (const n of variant.notes) {
          const used = PPQN.pulsesToSeconds(n.duration, PATTERN_BPM) * 2 ** ((n.pitch - 69) / 12);
          expect(used, `${row.id} pitch ${n.pitch} duration ${n.duration}`).toBeLessThanOrEqual(SAMPLE_SECONDS);
        }
      }
    }
  });
  it("the held-note pattern ends off the grid (70 pulses into the last step) and the base Arpeggio row's last step runs its full 120", () => {
    const row = rowById("arp-oct1-held-note");
    expect(HELD_NOTE.notes[0].duration).toBe(1750);
    const steps = arpeggioRule(rowNotes(row), ARPEGGIO_BASE, context.range);
    expect(steps.at(-1)?.position).toBe(3840 + 1680);
    expect(steps.at(-1)?.duration).toBe(120);
    expect(predictedVariants(row, context).map((v) => [...v.deviations].sort().join("+")).sort()).toEqual([""]);
  });
  it("the zeitgeist rows cover each duration once (19 values, none listed twice)", () => {
    const distinct = [...new Set(GrooveShuffleBoxAdapter.DurationPPQNs)];
    expect(distinct.length).toBe(19);
    expect(GrooveShuffleBoxAdapter.DurationPPQNs.length).toBe(19);
    for (const d of distinct) {
      expect(SEMANTICS_ROWS.filter((r) => r.id.startsWith("zg-amount") && r.id.endsWith(`-dur${d}-sixteenths`)).length).toBe(5);
    }
    expect(SEMANTICS_ROWS.filter((r) => r.id.endsWith("-sixteenths") && r.id.startsWith("zg-")).length).toBe(95);
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
    // a Zeitgeist has no deviation: one variant, the note-off warped with the note-on
    const shifting: RuleContext = { ...context, warp: (position) => position + (position % 480 === 240 ? 60 : 0) };
    const zg = predictedVariants(rowById("zg-amount0.75-dur480-sixteenths"), shifting);
    expect(zg.map((v) => [...v.deviations])).toEqual([[]]);
    expect(zg[0].notes[1].duration).toBe(60);
  });
  it("rowNotes makes the pattern absolute", () => {
    const notes = rowNotes(rowById("dry-sixteenths"));
    expect(notes.length).toBe(32);
    expect(notes[0].position).toBe(BAR_PPQN);
    expect(notes[1].position).toBe(BAR_PPQN + 240);
    expect(AUDIT_PATTERNS.map((p) => p.id)).toEqual(["held-note", "held-chord", "held-rolled", "chromatic", "chords", "sixteenths", "melody", "melody-gaps"]);
    // the gapped melody: the demo melody with every eighth at 90 % (432 pulses), a 48-pulse (25 ms) gap the reader splits on, so a note that leaks through a filter between two survivors starts a read note of its own
    const gapped = AUDIT_PATTERNS.find((p) => p.id === "melody-gaps")!;
    expect(gapped.notes.map((n) => n.pitch)).toEqual(patternById("melody").notes.map((n) => n.pitch));
    expect(gapped.notes.every((n) => n.duration === 432)).toBe(true);
    expect(gapped.notes.map((n) => n.position)).toEqual(patternById("melody").notes.map((n) => n.position));
  });
  it("renderSeconds is the end of the region plus the tail", () => {
    expect(renderSeconds(120)).toBeCloseTo(PPQN.pulsesToSeconds(BAR_PPQN + PATTERN_PPQN, 120) + 0.25, 12);
    expect(renderSeconds(120)).toBeCloseTo(6.25, 9);
  });
  it("FACTORY_KEYS names the five factories", () => {
    expect(FACTORY_KEYS).toEqual({ arpeggio: "Arpeggio", "note-filter": "NoteFilter", pitch: "Pitch", velocity: "Velocity", zeitgeist: "Zeitgeist" });
  });
  it("labels are sentences from the settings", () => {
    expect(rowById("arp-mode2-oct3-held-chord").label).toBe("Arpeggio UpDown, 3 octaves — held chord");
    expect(rowById("pitch-st7-chromatic").label).toBe("Pitch +7 st — chromatic");
    expect(rowById("zg-amount0.75-dur480-sixteenths").label).toBe("Zeitgeist 75 %, 1/8 — sixteenths");
    expect(ArpeggioDeviceBoxAdapter.RateFractions[9]).toEqual([1, 16]);
  });
});

describe("the Note Filter rows", () => {
  const pitchesOf = (id: string) => predictedVariants(rowById(id), context).map((v) => v.notes.map((n) => n.pitch));
  it("the melody window keeps 64, 67, 67, 64, 62 per bar and drops 60, 69, 71", () => {
    expect(pitchesOf("nf-range62-67-melody-gaps")).toEqual([[64, 67, 67, 64, 62, 64, 67, 67, 64, 62]]);
  });
  it("the floor, the ceiling and the one-key window keep what the spec says", () => {
    expect(pitchesOf("nf-range65-127-melody-gaps")[0]).toEqual([67, 69, 67, 71, 67, 69, 67, 71]);
    expect(pitchesOf("nf-range0-64-melody-gaps")[0]).toEqual([60, 64, 64, 62, 60, 64, 64, 62]);
    expect(pitchesOf("nf-range64-64-melody-gaps")[0]).toEqual([64, 64, 64, 64]);
  });
  it("min above max and a transpose past either end predict silence, as one judged variant with no notes", () => {
    for (const id of ["nf-range67-62-melody-gaps", "nf-tr68-chromatic", "nf-tr-72-chromatic"]) {
      expect(predictedVariants(rowById(id), context), id).toEqual([{ deviations: new Set(), notes: [] }]);
    }
  });
  it("the inclusive ends on the chromatic run drop exactly one note one step past each end", () => {
    expect(pitchesOf("nf-range60-127-chromatic")[0].length).toBe(12);
    expect(pitchesOf("nf-range61-127-chromatic")[0]).toEqual([61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]);
    expect(pitchesOf("nf-range0-71-chromatic")[0].length).toBe(12);
    expect(pitchesOf("nf-range0-70-chromatic")[0]).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
  });
  it("set collapses every passing note to the key, after the range and ignoring the transpose", () => {
    expect(pitchesOf("nf-set-key72-melody-gaps")[0]).toEqual(Array(16).fill(72));
    expect(pitchesOf("nf-set-key72-range62-67-melody-gaps")[0]).toEqual(Array(10).fill(72));
    expect(pitchesOf("nf-set-key72-tr7-melody-gaps")[0]).toEqual(Array(16).fill(72));
    expect(pitchesOf("nf-set-key60-sixteenths")).toEqual([rowNotes(rowById("dry-sixteenths")).map((n) => n.pitch)]);
  });
  it("the transpose rows move the melody by the setting", () => {
    expect(pitchesOf("nf-tr-12-melody-gaps")[0].slice(0, 8)).toEqual([48, 52, 55, 57, 55, 52, 50, 59]);
    expect(pitchesOf("nf-tr24-melody-gaps")[0].slice(0, 8)).toEqual([84, 88, 91, 93, 91, 88, 86, 95]);
    expect(SEMANTICS_ROWS.filter((r) => r.id.startsWith("nf-tr") && r.id.endsWith("-melody-gaps")).map((r) => r.id))
      .toEqual([-12, -7, -1, 0, 1, 7, 12, 24].map((n) => `nf-tr${n}-melody-gaps`));
  });
  it("every Note Filter row on the gapped melody predicts only readable notes: a leak would start a read note of its own", () => {
    for (const row of SEMANTICS_ROWS.filter((r) => r.group === "note-filter" && r.pattern === "melody-gaps")) {
      const marked = markReadability(predictedVariants(row, context)[0].notes, PATTERN_BPM, { attackMs: 1, releaseMs: 1, gapMs: 2, minCycles: 3, minVelocity: 0.01 });
      expect(marked.every((n) => n.readability === "readable"), row.id).toBe(true);
    }
  });
  it("labels and placement in the table", () => {
    expect(rowById("nf-range62-67-melody-gaps").label).toBe("Note Filter 62..67 — melody, gapped");
    expect(rowById("nf-tr-7-melody-gaps").label).toBe("Note Filter -7 st — melody, gapped");
    expect(rowById("nf-set-key72-range62-67-melody-gaps").label).toBe("Note Filter 62..67, set to 72 — melody, gapped");
    expect(rowById("nf-set-key72-tr7-melody-gaps").label).toBe("Note Filter set to 72, +7 st — melody, gapped");
    const groups = SEMANTICS_ROWS.map((r) => r.group);
    expect(groups.lastIndexOf("zeitgeist")).toBeLessThan(groups.indexOf("note-filter"));
    expect(groups.lastIndexOf("note-filter")).toBeLessThan(groups.indexOf("order"));
    expect(SEMANTICS_ROWS.filter((r) => r.group === "note-filter").every((r) => r.chain.length === 1 && r.chain[0].setting.device === "note-filter" && r.chain[0].enabled)).toBe(true);
  });
});

describe("the Note Filter order and disabled rows", () => {
  it("the order rows pair the Note Filter with Pitch and Arpeggio both ways; the Pitch pairs on the melody, the Arpeggio pairs on the chords; the disabled row on the sixteenths", () => {
    expect(SEMANTICS_ROWS.filter((r) => r.group === "order").map((r) => r.id)).toEqual([
      "order-arpeggio-zeitgeist", "order-zeitgeist-arpeggio", "order-pitch-arpeggio", "order-arpeggio-pitch", "order-velocity-arpeggio", "order-arpeggio-velocity",
      "order-pitch-note-filter", "order-note-filter-pitch", "order-arpeggio-note-filter", "order-note-filter-arpeggio",
    ]);
    expect(rowById("order-note-filter-pitch").chain.map((c) => c.setting.device)).toEqual(["note-filter", "pitch"]);
    expect(SEMANTICS_ROWS.filter((r) => r.group === "order").map((r) => r.pattern)).toEqual([...Array(6).fill("chords"), "melody-gaps", "melody-gaps", "chords", "chords"]);
    expect(rowById("order-pitch-note-filter").label).toBe("Pitch then NoteFilter — melody, gapped");
    expect(rowById("order-arpeggio-zeitgeist").label).toBe("Arpeggio then Zeitgeist — chords");
    expect(rowById("disabled-note-filter")).toMatchObject({ group: "disabled", pattern: "sixteenths", chain: [{ enabled: false, setting: { device: "note-filter", settings: { min: 62, max: 67, set: false, transpose: 0, key: 60 } } }] });
  });
  it("the Pitch pairs on the melody judge every surviving note and differ by order: Pitch first keeps 2 notes, the filter first keeps 10", () => {
    const pitchFirst = predictedVariants(rowById("order-pitch-note-filter"), context)[0].notes;
    expect(pitchFirst.map((n) => [n.pitch, n.cent])).toEqual([[67, 12.5], [67, 12.5]]);
    const filterFirst = predictedVariants(rowById("order-note-filter-pitch"), context)[0].notes;
    expect(filterFirst.map((n) => n.pitch)).toEqual([71, 74, 74, 71, 69, 71, 74, 74, 71, 69]);
    expect(filterFirst.every((n) => n.cent === 12.5)).toBe(true);
  });
  it("every order and disabled row's Note Filter, Pitch and Arpeggio stage changes what it receives in the chain (a non-identity that is an identity there proves nothing)", () => {
    // Velocity and Zeitgeist are context-bound (the test context's computeVelocity and warp are identities). `disabled-arpeggio`
    // is the one known identity, pinned by the next test as an open item.
    for (const row of SEMANTICS_ROWS.filter((r) => (r.group === "order" || r.group === "disabled") && r.id !== "disabled-arpeggio")) {
      const source = rowNotes(row);
      row.chain.forEach((stage, index) => {
        if (stage.setting.device === "velocity" || stage.setting.device === "zeitgeist") return;
        const input = composeRules(row.chain.slice(0, index).map((c) => c.setting), context, new Set(), source);
        expect(composeRules([stage.setting], context, new Set(), input), `${row.id} ${stage.setting.device}`).not.toEqual(input);
      });
    }
  });
  it("flips when fixed: disabled-arpeggio's non-identity (Up, 1 octave, 1/16, gate 0.5, velocity 1) is an identity on the sixteenths, so the row proves nothing (open item in the note)", () => {
    const row = rowById("disabled-arpeggio");
    const source = rowNotes(row);
    expect(composeRules([row.chain[0].setting], context, new Set(), source)).toEqual(source);
  });
  it("filter then Arpeggio empties the second half bar of the chords; Arpeggio then filter walks the full triads first", () => {
    const filterFirst = predictedVariants(rowById("order-note-filter-arpeggio"), context)[0].notes;
    expect(filterFirst.some((n) => n.position >= 3840 + 1920 && n.position < 3840 + 3840)).toBe(false);
    expect(filterFirst.some((n) => n.position < 3840 + 1920)).toBe(true);
    const arpFirst = predictedVariants(rowById("order-arpeggio-note-filter"), context)[0].notes;
    expect(arpFirst.every((n) => n.pitch >= 62 && n.pitch <= 67)).toBe(true);
    expect(arpFirst).not.toEqual(filterFirst);
    // first half bar (A minor 57/60/64): the filter first leaves 64 alone and every 1/16 step plays it (8 steps);
    // the Arpeggio first walks the triad from absolute grid index 16 (16 % 3 = 1 → 60, 17 → 64, 18 → 57, …), so only
    // the steps at indices 17, 20, 23 are at 64 and survive the filter (3 of 8)
    const firstHalf = (notes: typeof arpFirst) => notes.filter((n) => n.position < 3840 + 1920);
    expect(firstHalf(filterFirst).map((n) => n.pitch)).toEqual(Array(8).fill(64));
    expect(firstHalf(arpFirst).map((n) => [n.position - 3840, n.pitch])).toEqual([[240, 64], [960, 64], [1680, 64]]);
    // second half bar (F major 53/57/60): nothing in the window either way
    expect(arpFirst.some((n) => n.position >= 3840 + 1920 && n.position < 3840 + 3840)).toBe(false);
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
    const nf = resolveRows({ ...none, device: "note-filter" });
    expect(nf.length).toBe(4 + 28);
    expect(nf.slice(4).every((r) => r.group === "note-filter")).toBe(true);
    expect(resolveRows({ ...none, device: "note-filter", rows: "quick" }).slice(4).map((r) => r.id))
      .toEqual(["nf-range62-67-melody-gaps", "nf-range61-127-chromatic", "nf-tr7-melody-gaps", "nf-set-key72-melody-gaps"]);
    expect(() => resolveRows({ ...none, rows: "nope" })).toThrow(/nope/);
    expect(() => resolveRows({ ...none, rows: "dry-melody,nope" })).toThrow(/nope/);
    expect(() => resolveRows({ ...none, device: "echo" })).toThrow(/echo/);
    expect(() => resolveRows({ ...none, pattern: "bass" })).toThrow(/bass/);
  });
});

describe("applySettings", () => {
  it("writes every Arpeggio field and the Zeitgeist groove fields", () => {
    const arp = midiEffectFixture("arpeggio");
    const settings = { modeIndex: 13, order: 1, numOctaves: 4, rateIndex: 12, gate: 1.5, repeat: 4, velocity: -0.5, offset: 7, seed: 999999 };
    transact(arp.boxGraph, () => applySettings(arp.box, { device: "arpeggio", settings }));
    const a = arp.box as ArpeggioDeviceBox;
    expect([a.modeIndex.getValue(), a.numOctaves.getValue(), a.rateIndex.getValue(), a.gate.getValue(), a.repeat.getValue(), a.velocity.getValue()]).toEqual([13, 4, 12, 1.5, 4, -0.5]);
    expect([a.order.getValue(), a.offset.getValue(), a.seed.getValue()]).toEqual([1, 7, 999999]);
    expect(settingsOf(arp.box)).toEqual({ device: "arpeggio", settings });

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
  it("reads a Note Filter at its defaults and reads back what applySettings wrote", () => {
    const nf = midiEffectFixture("note-filter");
    expect(settingsOf(nf.box)).toEqual({ device: "note-filter", settings: NOTE_FILTER_BASE });
    const settings = { min: 36, max: 48, set: true, transpose: -5, key: 72 };
    transact(nf.boxGraph, () => applySettings(nf.box, { device: "note-filter", settings }));
    expect(settingsOf(nf.box)).toEqual({ device: "note-filter", settings });
    expect(() => transact(nf.boxGraph, () => applySettings(nf.box, { device: "pitch", settings: PITCH_BASE }))).toThrow();
  });
  it("round-trips every device through applySettings", () => {
    for (const setting of [
      { device: "arpeggio", settings: { modeIndex: 2, order: 1, numOctaves: 3, rateIndex: 5, gate: 0.75, repeat: 3, velocity: 0.5, offset: 3, seed: 42 } },
      { device: "pitch", settings: { semiTones: 7, cents: -25, octaves: -1 } },
      { device: "velocity", settings: { magnetPosition: 0.25, magnetStrength: 0.5, randomAmount: 0.5, offset: -0.25, mix: 0.75 } },
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
