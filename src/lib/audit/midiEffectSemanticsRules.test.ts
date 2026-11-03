import { describe, expect, it } from "vitest";
import { GrooveShuffleBoxAdapter, ParameterFieldAdapters, VelocityDeviceBoxAdapter, type BoxAdaptersContext } from "@opendaw/studio-adapters";
import { graphWithZeitgeist, midiEffectFixture, transact } from "@/lib/testing/boxGraphFixtures";
import {
  ARPEGGIO_RATE_PPQN, DEVIATIONS, DEVIATION_SUBSETS, QUESTIONS, RULE_SENTENCES, arpeggioIntentVelocity, arpeggioMatrixVelocity,
  arpeggioRule, clipToRange, composeRules, markReadability, pitchRule, questionsFor, toPredictedFigures, velocityRule, zeitgeistRule,
  type ArpeggioSettings, type DeviceSetting, type RuleContext, type RuleNote,
} from "./midiEffectSemanticsRules";

const identityContext: RuleContext = { range: { from: 3840, to: 3840 + 7680 }, computeVelocity: (_p, v) => v, warp: (p) => p };

describe("arpeggioRule", () => {
  const held = (pitches: number[], from = 3840, duration = 1750, velocity = 0.8): RuleNote[] =>
    pitches.map((pitch) => ({ position: from, duration, pitch, cent: 0, velocity }));
  const base: ArpeggioSettings = { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1 };
  const range = { from: 3840, to: 3840 + 7680 };
  const pitches = (notes: RuleNote[], count: number) => notes.map((n) => n.pitch).slice(0, count);

  it("has the 17 rates floor(3840 / d) × n", () => {
    expect(ARPEGGIO_RATE_PPQN).toEqual([3840, 1920, 1280, 960, 720, 640, 480, 360, 320, 240, 180, 160, 120, 80, 60, 40, 30]);
  });
  it("walks a triad up over two octaves from the absolute grid index (3840 / 240 = 16), steps 120 pulses long", () => {
    // crate: step_index = index / repeat with index absolute; 16 % 3 = 1, (16 % 6) / 3 = 1 -> 64 + 12; then 79, 60, 64, 67, 72, 76
    const out = arpeggioRule(held([67, 60, 64]), { ...base, numOctaves: 2 }, new Set(), range);
    expect(pitches(out, 7)).toEqual([76, 79, 60, 64, 67, 72, 76]);
    expect(out.map((n) => n.position).slice(0, 3)).toEqual([3840, 4080, 4320]);
    expect(out[0].duration).toBe(120);
  });
  it("starts the walk at the first stack note when the grid index is a multiple of notes × octaves (4320 / 240 = 18)", () => {
    const out = arpeggioRule(held([67, 60, 64], 3840, 7680), { ...base, numOctaves: 2 }, new Set(), { from: 4320, to: 4320 + 1680 });
    expect(pitches(out, 7)).toEqual([60, 64, 67, 72, 76, 79, 60]);
  });
  it("Down and UpDown walk as the crate's mode_run does", () => {
    // Down, indices 16..21: local 1,0,2,1,0,2 and octave 0,0,1,1,1,0
    expect(pitches(arpeggioRule(held([60, 64, 67]), { ...base, modeIndex: 1, numOctaves: 2 }, new Set(), range), 6)).toEqual([64, 60, 79, 76, 72, 67]);
    expect(pitches(arpeggioRule(held([60, 64, 67]), { ...base, modeIndex: 2 }, new Set(), range), 5)).toEqual([60, 64, 67, 64, 60]);
    expect(pitches(arpeggioRule(held([60]), { ...base, modeIndex: 2 }, new Set(), range), 3)).toEqual([60, 60, 60]);
  });
  it("a dotted rate starts on the absolute grid, not the note start (3/16 = 720: first step at 4320)", () => {
    expect(arpeggioRule(held([60]), { ...base, rateIndex: 4 }, new Set(), range)[0].position).toBe(4320);
  });
  it("repeat divides the absolute grid index", () => {
    const out = arpeggioRule(held([60, 64]), { ...base, repeat: 2 }, new Set(), range);
    expect(pitches(out, 4)).toEqual([60, 60, 64, 64]);
  });
  it("caps the last step at the source end under the intent and not under the deviation", () => {
    const intent = arpeggioRule(held([60]), base, new Set(), range);
    const last = intent[intent.length - 1];
    expect(last.position).toBe(3840 + 1680);
    expect(last.duration).toBe(70);
    const dev = arpeggioRule(held([60]), base, new Set(["arpeggio-uncapped-note-off"]), range);
    expect(dev[dev.length - 1].duration).toBe(120);
  });
  it("velocity: the manual's blend against the crate's matrix; they agree only at +1", () => {
    expect(arpeggioIntentVelocity(1, 0.8)).toBeCloseTo(0.8, 6);
    expect(arpeggioMatrixVelocity(1, 0.8)).toBeCloseTo(0.8, 6);
    expect(arpeggioIntentVelocity(-1, 0.8)).toBe(1);
    expect(arpeggioMatrixVelocity(-1, 0.8)).toBe(0);
    expect(arpeggioIntentVelocity(0, 0.8)).toBeCloseTo(0.9, 6);
    expect(arpeggioMatrixVelocity(0, 0.8)).toBe(1);
    expect(arpeggioIntentVelocity(0.5, 0.8)).toBeCloseTo(0.85, 6);
    expect(arpeggioMatrixVelocity(0.5, 0.8)).toBeCloseTo(0.9, 6);
  });
  it("applies the intent or the matrix velocity to the emitted notes", () => {
    const notes = held([60], 3840, 1750, 0.8);
    expect(arpeggioRule(notes, { ...base, velocity: 0 }, new Set(), range)[0].velocity).toBeCloseTo(0.9, 6);
    expect(arpeggioRule(notes, { ...base, velocity: 0 }, new Set(["arpeggio-velocity-matrix"]), range)[0].velocity).toBe(1);
  });
  it("keeps the source cent unless the deviation drops it", () => {
    const notes = [{ position: 3840, duration: 1750, pitch: 60, cent: 12.5, velocity: 1 }];
    expect(arpeggioRule(notes, base, new Set(), range)[0].cent).toBe(12.5);
    expect(arpeggioRule(notes, base, new Set(["arpeggio-drops-cent"]), range)[0].cent).toBe(0);
  });
  it("emits nothing while no note is held and a stack of one at gate 2 lasts 480", () => {
    expect(arpeggioRule([], base, new Set(), range)).toEqual([]);
    expect(arpeggioRule(held([60], 3840, 7680), { ...base, gate: 2 }, new Set(), range)[0].duration).toBe(480);
  });
  it("a gate that rounds below one pulse lasts one pulse", () => {
    expect(arpeggioRule(held([60], 3840, 7680), { ...base, gate: 0 }, new Set(), range)[0].duration).toBe(1);
  });
});

describe("pitchRule", () => {
  it("shifts by octaves × 12 + semitones and adds cents; drops an out-of-range result", () => {
    const out = pitchRule([{ position: 0, duration: 1, pitch: 60, cent: 0, velocity: 1 }, { position: 1, duration: 1, pitch: 120, cent: 0, velocity: 1 }], { semiTones: 7, cents: 12.5, octaves: 1 });
    expect(out).toEqual([{ position: 0, duration: 1, pitch: 79, cent: 12.5, velocity: 1 }]);
  });
  it("drops below zero too and keeps 0 and 127", () => {
    const note = (pitch: number): RuleNote => ({ position: 0, duration: 1, pitch, cent: 0, velocity: 1 });
    expect(pitchRule([note(5), note(12), note(120)], { semiTones: -12, cents: 0, octaves: 0 }).map((n) => n.pitch)).toEqual([0, 108]);
    expect(pitchRule([note(120)], { semiTones: 7, cents: 0, octaves: 0 }).map((n) => n.pitch)).toEqual([127]);
  });
});

describe("questionsFor", () => {
  const note = (pitch: number): RuleNote => ({ position: 3840, duration: 1750, pitch, cent: 0, velocity: 1 });
  const pitch = (semiTones: number): DeviceSetting => ({ device: "pitch", settings: { semiTones, cents: 0, octaves: 0 } });
  const arp = (velocity: number): DeviceSetting => ({ device: "arpeggio", settings: { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity } });
  it("names the pitch drop only when a note was dropped", () => {
    expect(questionsFor([pitch(12)], identityContext, [note(60), note(120)])).toEqual(["pitch-drops-out-of-range"]);
    expect(questionsFor([pitch(12)], identityContext, [note(60), note(100)])).toEqual([]);
  });
  it("counts the drop at the Pitch stage, not through the chain: a stage before it that fills the count does not hide it", () => {
    // arpeggio first turns one held note into many; the pitch then drops the arpeggiated notes, all of them
    expect(questionsFor([arp(1), pitch(100)], identityContext, [note(60)])).toEqual(["pitch-drops-out-of-range"]);
    expect(questionsFor([arp(1), pitch(10)], identityContext, [note(60)])).toEqual([]);
  });
  it("names the velocity gap only below +1", () => {
    expect(questionsFor([arp(0.5)], identityContext, [note(60)])).toEqual(["arpeggio-velocity-manual-gap"]);
    expect(questionsFor([arp(1)], identityContext, [note(60)])).toEqual([]);
  });
  it("registers both questions and the four deviations with a source each", () => {
    expect(QUESTIONS.map((q) => q.name).sort()).toEqual(["arpeggio-velocity-manual-gap", "pitch-drops-out-of-range"]);
    expect(DEVIATIONS.map((d) => d.name).sort()).toEqual(["arpeggio-drops-cent", "arpeggio-uncapped-note-off", "arpeggio-velocity-matrix", "zeitgeist-warps-note-off"]);
    for (const d of DEVIATIONS) expect(d.source).toMatch(/lib\.rs:\d+/);
    expect(Object.keys(RULE_SENTENCES).sort()).toEqual(["arpeggio", "pitch", "velocity", "zeitgeist"]);
  });
});

describe("velocityRule", () => {
  it("calls the adapter's computeVelocity with the absolute position and matches it exactly", () => {
    const { adapter, boxGraph, box } = midiEffectFixture("velocity");
    if (!(adapter instanceof VelocityDeviceBoxAdapter) || !("magnetStrength" in box)) throw new Error("not a velocity fixture");
    transact(boxGraph, () => { box.magnetStrength.setValue(1); box.magnetPosition.setValue(0.25); box.randomAmount.setValue(0.5); });
    const out = velocityRule([{ position: 4080, duration: 120, pitch: 60, cent: 0, velocity: 0.6 }], (p, v) => adapter.computeVelocity(p, v));
    expect(out[0].velocity).toBe(adapter.computeVelocity(4080, 0.6));
    expect(out[0].velocity).not.toBe(adapter.computeVelocity(4081, 0.6));
  });
});

const grooveAdapter = (amount: number, duration: number) => {
  const { boxGraph, groove } = graphWithZeitgeist();
  transact(boxGraph, () => { groove.amount.setValue(amount); groove.duration.setValue(duration); });
  const context = { parameterFieldAdapters: new ParameterFieldAdapters(), isMainThread: false } as unknown as BoxAdaptersContext;
  return new GrooveShuffleBoxAdapter(context, groove);
};

describe("zeitgeistRule", () => {
  it("moves the off-beat to the eased midpoint, keeps the duration under the intent and warps the off under the deviation", () => {
    const groove = grooveAdapter(0.75, 480);
    const input: RuleNote[] = [{ position: 4080, duration: 120, pitch: 60, cent: 0, velocity: 1 }];
    // amount 0.75 -> h = 0.01 + 0.98 × 0.75 = 0.745; x = 240 / 480 = 0.5; ease = xh / ((2h - 1)(x - 1) + h) = 0.3725 / 0.5 = 0.745; × 480 = 357.6
    const [note] = zeitgeistRule(input, groove, new Set());
    expect(note.position).toBeCloseTo(3840 + 357.6, 9);
    expect(note.duration).toBe(120);
    const [dev] = zeitgeistRule(input, groove, new Set(["zeitgeist-warps-note-off"]));
    expect(dev.position).toBeCloseTo(3840 + 357.6, 9);
    expect(dev.duration).toBeCloseTo(groove.warp(4200) - groove.warp(4080), 9);
    expect(dev.duration).not.toBe(120);
  });
});

describe("composeRules", () => {
  const source: RuleNote[] = [{ position: 3840, duration: 1750, pitch: 60, cent: 0, velocity: 0.8 }, { position: 3840, duration: 1750, pitch: 64, cent: 0, velocity: 0.8 }];
  const arp: DeviceSetting = { device: "arpeggio", settings: { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1 } };
  const pitch: DeviceSetting = { device: "pitch", settings: { semiTones: 3, cents: 12.5, octaves: 0 } };
  it("applies index 0 first: Pitch then Arpeggio walks the shifted stack; Arpeggio then Pitch shifts the walk", () => {
    const pitchFirst = composeRules([pitch, arp], identityContext, new Set(), source);
    const arpFirst = composeRules([arp, pitch], identityContext, new Set(), source);
    expect(pitchFirst.length).toBeGreaterThan(0);
    expect(pitchFirst.map((n) => n.pitch)).toEqual(arpFirst.map((n) => n.pitch));
    expect(pitchFirst.map((n) => n.position)).toEqual(arpFirst.map((n) => n.position));
    expect(pitchFirst.every((n) => n.cent === 12.5)).toBe(true);
    expect(arpFirst.every((n) => n.cent === 12.5)).toBe(true);
    const dropped = new Set(["arpeggio-drops-cent" as const]);
    expect(composeRules([pitch, arp], identityContext, dropped, source).every((n) => n.cent === 0)).toBe(true);
    expect(composeRules([arp, pitch], identityContext, dropped, source).every((n) => n.cent === 12.5)).toBe(true);
  });
  it("hands the context's range, velocity function and warp to the stages that use them", () => {
    const context: RuleContext = { range: { from: 3840, to: 4320 }, computeVelocity: () => 0.25, warp: (p) => p + 1 };
    const out = composeRules([arp, { device: "velocity", settings: { magnetPosition: 0, magnetStrength: 0, randomAmount: 0, offset: 0, mix: 1 } }, { device: "zeitgeist", settings: { amount: 0.5, duration: 480 } }], context, new Set(), source);
    expect(out.map((n) => n.position)).toEqual([3841, 4081]);
    expect(out.every((n) => n.velocity === 0.25)).toBe(true);
  });
});

describe("markReadability", () => {
  const options = { attackMs: 1, releaseMs: 1, gapMs: 2, minCycles: 3, minVelocity: 0.01 };
  const at = (position: number, duration: number, pitch: number, velocity = 1): RuleNote => ({ position, duration, pitch, cent: 0, velocity });
  const readabilityAt = (marked: ReturnType<typeof markReadability>, position: number, pitch: number) =>
    marked.find((n) => n.position === position && n.pitch === pitch)?.readability;
  it("marks same-pitch intersections overlap, different-pitch polyphonic, a 2 ms note too-short, velocity 0.005 too-quiet, the rest readable", () => {
    // bpm 120: one pulse is 0.5208 ms
    const marked = markReadability([
      at(0, 480, 60), at(240, 480, 60),
      at(2400, 480, 62), at(2640, 480, 64),
      at(5000, 4, 60),
      at(6000, 480, 60, 0.005),
      at(7000, 480, 60),
    ], 120, options);
    expect(marked.map((n) => n.readability)).toEqual(["overlap", "overlap", "polyphonic", "polyphonic", "too-short", "too-quiet", "readable"]);
  });
  it("steps that touch are abutting (gate 1), steps that overlap a whole step polyphonic (gate 2), steps with a gap readable (gate 0.5)", () => {
    const steps = (duration: number) => markReadability([at(3840, duration, 60), at(4080, duration, 62)], 120, options).map((n) => n.readability);
    expect(steps(240)).toEqual(["abutting", "abutting"]);
    expect(steps(480)).toEqual(["polyphonic", "polyphonic"]);
    expect(steps(120)).toEqual(["readable", "readable"]);
  });
  it("spans less than gapMs apart after the release are abutting, further apart readable", () => {
    // bpm 120: 480 pulses = 250 ms, release to 251 ms; 485 pulses = 252.6 ms (1.6 ms), 489 pulses = 254.7 ms (3.7 ms)
    expect(markReadability([at(0, 480, 60), at(485, 240, 60)], 120, options).map((n) => n.readability)).toEqual(["abutting", "abutting"]);
    expect(markReadability([at(0, 480, 60), at(489, 240, 60)], 120, options).map((n) => n.readability)).toEqual(["readable", "readable"]);
  });
  it("same-pitch steps that touch are abutting too, not overlap", () => {
    const marked = markReadability([at(3840, 240, 60), at(4080, 240, 60)], 120, options);
    expect(marked.map((n) => n.readability)).toEqual(["abutting", "abutting"]);
    expect(readabilityAt(marked, 4080, 60)).toBe("abutting");
  });
  it("sorts by position, then pitch, and keeps the note's fields", () => {
    const marked = markReadability([at(960, 480, 64), at(960, 480, 60), at(0, 480, 70)], 120, options);
    expect(marked.map((n) => [n.position, n.pitch])).toEqual([[0, 70], [960, 60], [960, 64]]);
    expect(marked[0]).toMatchObject({ duration: 480, cent: 0, velocity: 1 });
  });
  it("a short span is judged on its own pitch: 13 ms is too short at 60 and enough at 96", () => {
    // threshold = 2 × 1 ms + 3 cycles; C4 (261.6 Hz) 13.47 ms, C7 (2093 Hz) 3.43 ms; 26 pulses = 13.54 ms; 10 pulses = 5.2 ms
    expect(markReadability([at(0, 25, 60)], 120, options)[0].readability).toBe("too-short");
    expect(markReadability([at(0, 26, 60)], 120, options)[0].readability).toBe("readable");
    expect(markReadability([at(0, 10, 96)], 120, options)[0].readability).toBe("readable");
  });
  it("converts to figures in milliseconds at the tempo", () => {
    const figures = toPredictedFigures(markReadability([{ position: 960, duration: 480, pitch: 60, cent: 12.5, velocity: 0.5 }], 120, options), 120);
    expect(figures).toEqual([{ onsetMs: 500, endMs: 750, pitch: 60, cents: 12.5, velocity: 0.5, readability: "readable" }]);
  });
});

describe("DEVIATION_SUBSETS", () => {
  it("lists the empty set first, then singletons, then pairs", () => {
    expect(DEVIATION_SUBSETS(["arpeggio-drops-cent", "arpeggio-velocity-matrix"]).map((s) => [...s].sort().join("+"))).toEqual(["", "arpeggio-drops-cent", "arpeggio-velocity-matrix", "arpeggio-drops-cent+arpeggio-velocity-matrix"]);
  });
  it("lists 2^n sets", () => {
    expect(DEVIATION_SUBSETS(["arpeggio-drops-cent", "arpeggio-velocity-matrix", "arpeggio-uncapped-note-off"])).toHaveLength(8);
    expect(DEVIATION_SUBSETS([])).toHaveLength(1);
  });
});

describe("clipToRange", () => {
  const range = { from: 3840, to: 11520 };
  const note = (position: number, duration: number): RuleNote => ({ position, duration, pitch: 60, cent: 0, velocity: 1 });
  it("clips a note crossing the end, drops one starting at it, leaves one inside", () => {
    const out = clipToRange([note(11400, 240), note(11520, 120), note(4000, 240)], range);
    expect(out).toEqual([note(11400, 120), note(4000, 240)]);
  });
});
