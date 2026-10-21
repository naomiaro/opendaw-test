import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { onsetsOf } from "./midiEffectPlacement";
import {
  burstChannel, burstSample, DRY_PATTERN, ECHO_DELAY_PPQN, ONSET_SKIP_MS, ONSET_THRESHOLD, expectedOnsetCount, MIDI_EFFECT_SCENARIOS, renderSeconds, resolveBpm, resolveDevices, resolveRate,
  SPIELWERK_ECHO, SPIELWERK_FORWARD, SPIELWERK_YIELD,
} from "./midiEffectScenarios";

const byId = (id: string) => {
  const scenario = MIDI_EFFECT_SCENARIOS.find((s) => s.id === id);
  if (scenario === undefined) throw new Error(`no scenario ${id}`);
  return scenario;
};

describe("MIDI_EFFECT_SCENARIOS", () => {
  it("starts with the dry row and judges every device row by exactly one method", () => {
    expect(MIDI_EFFECT_SCENARIOS[0].id).toBe("dry");
    for (const s of MIDI_EFFECT_SCENARIOS) {
      expect(s.judge === "rule").toBe(s.rule !== null);
      expect(s.script !== null).toBe(s.device === "spielwerk");
    }
  });
  it("carries the echo script on the disabled Spielwerk row and the hold pattern on the arpeggio row", () => {
    expect(byId("spielwerk-disabled").script).toBe(SPIELWERK_ECHO);
    expect(byId("spielwerk-disabled").enabled).toBe(false);
    expect(byId("arpeggio").pattern).toEqual([{ position: 0, duration: 1920 }]);
    expect(byId("zeitgeist").pattern).toBe(DRY_PATTERN);
  });
  it("declares the pass-through directive only on the yield script", () => {
    expect(SPIELWERK_YIELD).toMatch(/^\/\/ @no-pass$/m);
    expect(SPIELWERK_FORWARD).not.toMatch(/@no-pass/);
    expect(SPIELWERK_ECHO).not.toMatch(/@no-pass/);
  });
});

describe("resolveDevices", () => {
  it("keeps the dry row in every selection and rejects an unknown device", () => {
    expect(resolveDevices(null).length).toBe(13);
    expect(resolveDevices("pitch").map((s) => s.id)).toEqual(["dry", "pitch", "pitch-disabled"]);
    expect(resolveDevices("spielwerk").map((s) => s.id)).toEqual(["dry", "spielwerk-forward", "spielwerk-yield", "spielwerk-echo", "spielwerk-disabled"]);
    expect(() => resolveDevices("compressor")).toThrow(/unknown \?device=/);
  });
});

describe("expectations", () => {
  it("counts the onsets each rule predicts and sizes the render to two bars plus the tail", () => {
    expect(expectedOnsetCount(byId("dry"))).toBe(8);
    expect(expectedOnsetCount(byId("arpeggio"))).toBe(8);
    expect(expectedOnsetCount(byId("spielwerk-echo"))).toBe(3);
    expect(renderSeconds(120)).toBeCloseTo(4.25, 6);
  });
  it("builds a burst with a full-scale head that is over within 20 ms", () => {
    const burst = burstChannel(48000);
    expect(burst.length).toBe(960);
    expect(burst[0]).toBe(1);
    expect(burst[479]).toBe(1);
    expect(burst[959]).toBeCloseTo(0, 2);
    expect(burst[720]).toBeCloseTo(0.5, 1);
  });
});

describe("page parameters", () => {
  it("accepts the two render rates and a positive tempo, defaults otherwise, rejects the rest", () => {
    expect(resolveRate(null)).toBe(48000);
    expect(resolveRate("44100")).toBe(44100);
    expect(() => resolveRate("96000")).toThrow(/invalid \?rate=/);
    expect(resolveBpm(null)).toBe(120);
    expect(resolveBpm("90")).toBe(90);
    expect(() => resolveBpm("0")).toThrow(/invalid \?bpm=/);
    expect(() => resolveBpm("fast")).toThrow(/invalid \?bpm=/);
    // Past 250 bpm the echo copies (120 pulses apart) fall inside the 30 ms onset skip and would read as missing.
    expect(resolveBpm("250")).toBe(250);
    expect(() => resolveBpm("251")).toThrow(/echo copies/);
  });
});

describe("the onset skip against the real burst", () => {
  it("reads the real burst once per note and both echo copies at the default tempo, and does not count a burst inside another's body", () => {
    const rate = 48000;
    const delay = Math.round(PPQN.pulsesToSeconds(ECHO_DELAY_PPQN, 120) * rate);
    const out = new Float32Array(rate);
    out.set(burstChannel(rate), 10000);
    out.set(burstChannel(rate), 10000 + delay);
    expect(onsetsOf(out, rate, ONSET_THRESHOLD, ONSET_SKIP_MS)).toEqual([10000, 10000 + delay]);
    const inside = new Float32Array(rate);
    inside.set(burstChannel(rate), 10000);
    // A second burst 5 ms into the first: one onset. (A burst that begins one frame before the skip ends is
    // still above threshold at the skip's end and IS found there, a frame late; the skip is not a dead zone.)
    inside.set(burstChannel(rate), 10000 + Math.round(0.005 * rate));
    expect(onsetsOf(inside, rate, ONSET_THRESHOLD, ONSET_SKIP_MS)).toEqual([10000]);
  });
});

describe("burstSample", () => {
  it("pads the burst into a one-second sample, the loader refusing anything up to 1200 frames", () => {
    const sample = burstSample(48000);
    expect(sample.length).toBe(48000);
    expect(sample.subarray(0, 960)).toEqual(burstChannel(48000));
    expect(sample.subarray(960).some((v) => v !== 0)).toBe(false);
  });
});
