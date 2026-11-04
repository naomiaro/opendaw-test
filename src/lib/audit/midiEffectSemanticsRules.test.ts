import { describe, expect, it } from "vitest";
import { ArpeggioDeviceBoxAdapter, GrooveShuffleBoxAdapter, ParameterFieldAdapters, VelocityDeviceBoxAdapter, type BoxAdaptersContext } from "@opendaw/studio-adapters";
import { graphWithZeitgeist, midiEffectFixture, transact } from "@/lib/testing/boxGraphFixtures";
import { READER_DEFAULTS, frequencyToPitch, readNotes } from "./midiEffectSemanticsReader";
import {
  ARPEGGIO_RATE_PPQN, DEVIATIONS, DEVIATION_SUBSETS, QUESTIONS, RULE_SENTENCES, arpeggioVelocity,
  arpeggioRule, clipToRange, composeRules, markReadability, pitchRule, questionsFor, toPredictedFigures, velocityRule, zeitgeistRule,
  type ArpeggioSettings, type DeviationName, type DeviceSetting, type RuleContext, type RuleNote,
} from "./midiEffectSemanticsRules";

const identityContext: RuleContext = { range: { from: 3840, to: 3840 + 7680 }, computeVelocity: (_p, v) => v, warp: (p) => p };

describe("arpeggioRule", () => {
  const held = (pitches: number[], from = 3840, duration = 1750, velocity = 0.8): RuleNote[] =>
    pitches.map((pitch) => ({ position: from, duration, pitch, cent: 0, velocity }));
  const base: ArpeggioSettings = { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1 };
  const range = { from: 3840, to: 3840 + 7680 };
  const pitches = (notes: RuleNote[], count: number) => notes.map((n) => n.pitch).slice(0, count);

  it("has the adapter's 17 rates as floor(3840 / d) × n", () => {
    expect(ArpeggioDeviceBoxAdapter.RateFractions).toHaveLength(17);
    expect(ARPEGGIO_RATE_PPQN).toEqual(ArpeggioDeviceBoxAdapter.RateFractions.map(([n, d]) => Math.floor(3840 / d) * n));
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
  it("UpDown over two octaves on a triad runs a sequence of 2 · 3 · 2 − 2 = 10 steps (mode_run, device-arpeggio/src/lib.rs:139-146)", () => {
    // process_length 3 · 2 = 6, sequence_length 6 · 2 − 2 = 10. From 4800 the global index is 4800 / 240 = 20, 20 % 10 = 0:
    // sequence indices 0..5 walk up (process_index = sequence_index), 6..9 back down (process_index = 10 − sequence_index:
    // 4, 3, 2, 1); local = process_index % 3, octave = process_index / 3. Index 30 starts the sequence again.
    const out = arpeggioRule(held([60, 64, 67], 3840, 7680), { ...base, modeIndex: 2, numOctaves: 2 }, new Set(), { from: 4800, to: 4800 + 11 * 240 });
    expect(pitches(out, 11)).toEqual([60, 64, 67, 72, 76, 79, 76, 72, 67, 64, 60]);
  });
  it("stacks the held notes by (start, pitch), not by pitch: a lower pitch that starts later comes after (device-arpeggio/src/lib.rs:288-303)", () => {
    // 67 from 3840, 60 from 4080. Index 16 (3840): stack [67] -> 67. Index 17 (4080): stack [67, 60], 17 % 2 = 1 -> 60.
    // Index 18: 18 % 2 = 0 -> 67; index 19 -> 60. Sorted by pitch alone the stack would be [60, 67]: 67, 67, 60, 67.
    const notes: RuleNote[] = [
      { position: 3840, duration: 1750, pitch: 67, cent: 0, velocity: 0.8 },
      { position: 4080, duration: 1510, pitch: 60, cent: 0, velocity: 0.8 },
    ];
    expect(pitches(arpeggioRule(notes, base, new Set(), range), 4)).toEqual([67, 60, 67, 60]);
  });
  it("a note ending exactly on a grid line is not in the stack at that line: start <= position < end (device-arpeggio/src/lib.rs:280)", () => {
    // 60 ends at 4320 (3840 + 480), 64 holds on. Index 16 (3840): [60, 64] -> 60. Index 17 (4080): [60, 64], 17 % 2 = 1 -> 64.
    // Index 18 (4320): 60 has ended, [64] -> 64; were the end inclusive, [60, 64] with 18 % 2 = 0 would give 60.
    const notes: RuleNote[] = [
      { position: 3840, duration: 480, pitch: 60, cent: 0, velocity: 0.8 },
      { position: 3840, duration: 1750, pitch: 64, cent: 0, velocity: 0.8 },
    ];
    expect(pitches(arpeggioRule(notes, base, new Set(), range), 3)).toEqual([60, 64, 64]);
    // alone, it sounds on 3840 and 4080 and not on 4320
    expect(arpeggioRule(held([60], 3840, 480), base, new Set(), range).map((n) => n.position)).toEqual([3840, 4080]);
  });
  it("a dotted rate starts on the absolute grid, not the note start (3/16 = 720: first step at 4320)", () => {
    expect(arpeggioRule(held([60]), { ...base, rateIndex: 4 }, new Set(), range)[0].position).toBe(4320);
  });
  it("repeat divides the absolute grid index", () => {
    const out = arpeggioRule(held([60, 64]), { ...base, repeat: 2 }, new Set(), range);
    expect(pitches(out, 4)).toEqual([60, 60, 64, 64]);
  });
  it("a step lasts the gate's length even past the held note's end (the manual: note length is a percentage of the step)", () => {
    const steps = arpeggioRule(held([60]), base, new Set(), range);
    const last = steps[steps.length - 1];
    expect(last.position).toBe(3840 + 1680);
    expect(last.duration).toBe(120);
  });
  it("velocity per the manual: one fixed velocity rising from silent at -1 to full at 0, then a blend from full toward the note's own at +1", () => {
    expect(arpeggioVelocity(-1, 0.8)).toBe(0);
    expect(arpeggioVelocity(-0.5, 0.8)).toBeCloseTo(0.5, 6);
    expect(arpeggioVelocity(0, 0.8)).toBe(1);
    expect(arpeggioVelocity(0.5, 0.8)).toBeCloseTo(0.9, 6);
    expect(arpeggioVelocity(1, 0.8)).toBeCloseTo(0.8, 6);
    // the lower half ignores the input
    expect(arpeggioVelocity(-0.5, 0.2)).toBeCloseTo(0.5, 6);
  });
  it("applies that velocity to the emitted notes, with no deviation to try", () => {
    const notes = held([60], 3840, 1750, 0.8);
    expect(arpeggioRule(notes, { ...base, velocity: 0 }, new Set(), range)[0].velocity).toBe(1);
    expect(arpeggioRule(notes, { ...base, velocity: -1 }, new Set(), range)[0].velocity).toBe(0);
    expect(arpeggioRule(notes, { ...base, velocity: 0.5 }, new Set(), range)[0].velocity).toBeCloseTo(0.9, 6);
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
  it("questions nothing about the Arpeggio's velocity: the manual now describes the engine (openDAW#524)", () => {
    const at = (velocity: number): RuleNote => ({ ...note(60), velocity });
    expect(questionsFor([arp(0.5)], identityContext, [at(0.8)])).toEqual([]);
    expect(questionsFor([arp(-1)], identityContext, [at(1)])).toEqual([]);
  });
  it("registers the one question and the one deviation with a source each", () => {
    expect(QUESTIONS.map((q) => q.name)).toEqual(["pitch-drops-out-of-range"]);
    expect(DEVIATIONS.map((d) => d.name)).toEqual(["arpeggio-drops-cent"]);
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
  it("moves the off-beat to the eased midpoint and its note-off through the same warp, so the duration changes (openDAW#525)", () => {
    const groove = grooveAdapter(0.75, 480);
    const input: RuleNote[] = [{ position: 4080, duration: 120, pitch: 60, cent: 0, velocity: 1 }];
    // amount 0.75 -> h = 0.01 + 0.98 × 0.75 = 0.745; x = 240 / 480 = 0.5; ease = xh / ((2h - 1)(x - 1) + h) = 0.3725 / 0.5 = 0.745; × 480 = 357.6
    const [note] = zeitgeistRule(input, groove);
    expect(note.position).toBeCloseTo(3840 + 357.6, 9);
    expect(note.duration).toBeCloseTo(groove.warp(4200) - groove.warp(4080), 9);
    expect(note.duration).not.toBe(120);
  });
  it("leaves a note on a cell start untouched: the warp is the identity there", () => {
    const groove = grooveAdapter(0.75, 480);
    const [note] = zeitgeistRule([{ position: 3840, duration: 480, pitch: 60, cent: 0, velocity: 1 }], groove);
    expect(note.position).toBeCloseTo(3840, 9);
    expect(note.duration).toBeCloseTo(480, 9);
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
  const options = { attackMs: 1, releaseMs: 1, gapMs: 2, minCycles: READER_DEFAULTS.minCycles, minVelocity: 0.01 };
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
  it("a velocity-0 note is silence (the Nano's gain is gain × velocity, device-nano/src/voice.rs:129): left out of the prediction", () => {
    // the shape of vel-offset-1-sixteenths: 32 sixteenths, every one at velocity 0
    const silent = Array.from({ length: 32 }, (_, k) => at(3840 + k * 240, 120, 60, 0));
    expect(markReadability(silent, 120, options)).toEqual([]);
    expect(markReadability([at(0, 480, 60, 0.005)], 120, options)[0].readability).toBe("too-quiet");
    // a silent neighbour makes nothing abutting or overlapping
    expect(markReadability([at(0, 480, 60), at(480, 480, 60, 0), at(240, 480, 60, 0)], 120, options).map((n) => [n.position, n.readability])).toEqual([[0, "readable"]]);
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
  it("a note too short or too quiet to read is not abutting, whatever its neighbour; the neighbour stays abutting", () => {
    // 3 pulses = 1.6 ms; the second note starts where the first ends
    const marked = markReadability([at(0, 480, 60), at(480, 3, 60)], 120, options);
    expect(marked.map((n) => n.readability)).toEqual(["abutting", "too-short"]);
    const quiet = markReadability([at(0, 480, 60), at(480, 480, 60, 0.005)], 120, options);
    expect(quiet.map((n) => n.readability)).toEqual(["abutting", "too-quiet"]);
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
  it("a short span is judged on its own pitch: 18.3 ms is too short at 60 and enough at 96", () => {
    // threshold = 3 × 1 ms + 4 periods; C4 (261.6 Hz) 18.29 ms, C7 (2093 Hz) 4.91 ms; 35 pulses = 18.23 ms, 36 = 18.75 ms; 10 pulses = 5.2 ms
    expect(markReadability([at(0, 35, 60)], 120, options)[0].readability).toBe("too-short");
    expect(markReadability([at(0, 36, 60)], 120, options)[0].readability).toBe("readable");
    expect(markReadability([at(0, 10, 96)], 120, options)[0].readability).toBe("readable");
  });
  it("a thirty-second at G#1 is too short: three periods fit, the reader's window needs four crossings", () => {
    // pitch 32 = 51.9 Hz, period 19.27 ms; 120 pulses = 62.5 ms, window 59.5 ms (run 1793741626351, pitch-st-36-chromatic read no pitch)
    expect(markReadability([at(0, 120, 32)], 120, options)[0].readability).toBe("too-short");
    expect(markReadability([at(0, 120, 40)], 120, options)[0].readability).toBe("readable");
  });
  it("every span it marks readable, the reader reads at its pitch, at any phase", () => {
    // the voice as the sampler renders it: sin × env², env a 1 ms linear attack and release
    const rate = 48000;
    const voice = (pitch: number, durationMs: number, phase: number): Float32Array => {
      const hz = 440 * 2 ** ((pitch - 69) / 12);
      const lead = 480;
      const length = Math.round(durationMs * rate / 1000);
      const ramp = rate / 1000;
      const out = new Float32Array(lead + length + ramp + 480);
      for (let i = 0; i < length + ramp; i++) {
        const env = i < ramp ? i / ramp : i < length ? 1 : Math.max(0, 1 - (i - length) / ramp);
        out[lead + i] = Math.sin(2 * Math.PI * hz * i / rate + phase) * env * env;
      }
      return out;
    };
    let checked = 0;
    for (let pitch = 24; pitch <= 96; pitch += 4) {
      for (let pulses = 8; pulses <= 160; pulses += 4) {
        if (markReadability([at(0, pulses, pitch)], 120, options)[0].readability !== "readable") continue;
        for (const phase of [0, 1, 2, 3, 4, 5]) {
          const notes = readNotes(voice(pitch, pulses * 500 / 960, phase), rate, READER_DEFAULTS);
          expect(notes).toHaveLength(1);
          expect(notes[0].frequencyHz, `pitch ${pitch}, ${pulses} pulses, phase ${phase}`).not.toBeNull();
          expect(frequencyToPitch(notes[0].frequencyHz!).pitch).toBe(pitch);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
  it("converts to figures in milliseconds at the tempo", () => {
    const figures = toPredictedFigures(markReadability([{ position: 960, duration: 480, pitch: 60, cent: 12.5, velocity: 0.5 }], 120, options), 120);
    expect(figures).toEqual([{ onsetMs: 500, endMs: 750, pitch: 60, cents: 12.5, velocity: 0.5, readability: "readable" }]);
  });
});

describe("DEVIATION_SUBSETS", () => {
  it("lists the empty set first, then singletons, then pairs", () => {
    // the subsets are by name only, so two labels stand in for two deviations
    const [a, b] = ["a-deviation", "b-deviation"] as unknown as DeviationName[];
    expect(DEVIATION_SUBSETS([a, b]).map((s) => [...s].sort().join("+"))).toEqual(["", a, b, `${a}+${b}`]);
  });
  it("lists 2^n sets", () => {
    const [a, b, c] = ["a-deviation", "b-deviation", "c-deviation"] as unknown as DeviationName[];
    expect(DEVIATION_SUBSETS([a, b, c])).toHaveLength(8);
    expect(DEVIATION_SUBSETS([])).toHaveLength(1);
  });
});

describe("clipToRange", () => {
  const range = { from: 3840, to: 12000 };
  const note = (position: number, duration: number): RuleNote => ({ position, duration, pitch: 60, cent: 0, velocity: 1 });
  it("clips a note crossing the render's end, drops one starting at it, leaves one inside", () => {
    const out = clipToRange([note(11880, 240), note(12000, 120), note(4000, 240)], range);
    expect(out).toEqual([note(11880, 120), note(4000, 240)]);
  });
});
