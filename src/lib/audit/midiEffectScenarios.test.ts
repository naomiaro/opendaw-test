import { describe, expect, it } from "vitest";
import {
  burstChannel, DRY_PATTERN, expectedOnsetCount, MIDI_EFFECT_SCENARIOS, renderSeconds, resolveDevices,
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
