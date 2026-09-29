import { describe, it, expect } from "vitest";
import { LfoModulatorBoxAdapter } from "@opendaw/studio-adapters";
import { samplerFixture } from "@/lib/testing/boxGraphFixtures";
import { applyParams } from "./nanoContent";
import { CUSTOM_PRESET, LFO_DEFAULT_RATE_LABEL, NANO_PRESETS, type NanoParams, type NanoPreset } from "./nanoPresets";

const all: ReadonlyArray<readonly [string, NanoPreset]> = [
  ...Object.entries(NANO_PRESETS),
  ["custom", CUSTOM_PRESET] as const,
];

const NUMERIC_KEYS = [
  "rootKey", "octave", "tune", "volume", "attack", "release",
  "sampleStart", "sampleEnd", "loopFade", "loopStart", "loopEnd",
] as const;

describe("applyParams", () => {
  it("covers every parameter a preset holds", () => {
    const keys = Object.keys(CUSTOM_PRESET.params).sort();
    expect([...NUMERIC_KEYS, "loop"].sort()).toEqual(keys);
  });

  // Against the SDK's own parameter mappings, so a range that moves in the SDK is caught here.
  it.each(all)("writes every value of the %s preset, each inside the parameter's own range", (_id, preset) => {
    const { adapter, box, project } = samplerFixture();

    project.editing.modify(() => applyParams(adapter, preset.params));

    for (const key of NUMERIC_KEYS) expect(box[key].getValue(), key).toBeCloseTo(preset.params[key], 6);
    expect(box.loop.getValue()).toBe(preset.params.loop);
  });

  it("leaves nothing behind from the preset that was applied before", () => {
    const { adapter, box, project } = samplerFixture();
    project.editing.modify(() => applyParams(adapter, NANO_PRESETS.pad.params));

    project.editing.modify(() => applyParams(adapter, NANO_PRESETS.kick.params));

    for (const key of NUMERIC_KEYS) expect(box[key].getValue(), key).toBeCloseTo(NANO_PRESETS.kick.params[key], 6);
    expect(box.loop.getValue()).toBe(false);
  });

  it.each<[string, Partial<NanoParams>, string]>([
    ["a tune above the range", { tune: 2400 }, "Tune"],
    ["an octave below the range", { octave: -4 }, "Octave"],
    ["a fractional octave", { octave: 1.5 }, "Octave"],
    ["a fractional root key", { rootKey: 60.5 }, "Root"],
    ["a start outside the sample", { sampleStart: 1.2 }, "Start"],
    ["a release that is not a number", { release: Number.NaN }, "Release"],
    ["a gain above the top of the range", { volume: 6 }, "Gain"],
  ])("refuses %s, names the parameter, and writes nothing", (_label, wrong, name) => {
    const { adapter, box, project } = samplerFixture();
    project.editing.modify(() => applyParams(adapter, NANO_PRESETS.pad.params));

    expect(() =>
      project.editing.modify(() => applyParams(adapter, { ...NANO_PRESETS.kick.params, ...wrong }))
    ).toThrow(name);

    for (const key of NUMERIC_KEYS) expect(box[key].getValue(), key).toBeCloseTo(NANO_PRESETS.pad.params[key], 6);
    expect(box.loop.getValue()).toBe(true);
  });
});

describe("LFO default rate", () => {
  it("is one of the rates the LFO offers", () => {
    expect(LfoModulatorBoxAdapter.RateStrings).toContain(LFO_DEFAULT_RATE_LABEL);
  });

  it("is longer than one bar, so notes on bar lines get different starts", () => {
    const index = LfoModulatorBoxAdapter.RateStrings.indexOf(LFO_DEFAULT_RATE_LABEL);
    const oneBar = LfoModulatorBoxAdapter.RateStrings.indexOf("1 bar");
    expect(LfoModulatorBoxAdapter.RatePPQNs[index]).toBeGreaterThan(LfoModulatorBoxAdapter.RatePPQNs[oneBar]);
  });
});
