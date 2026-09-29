import { describe, it, expect } from "vitest";
import { NANO_SAMPLES } from "@/lib/nanoSamples";
import { CUSTOM_PRESET, NANO_PRESETS, PARAM_RANGES, PATTERN_LENGTH, type NanoPreset } from "./nanoPresets";
import { effectiveLoop, regionBounds } from "./nanoMarkers";

const all: ReadonlyArray<readonly [string, NanoPreset]> = [
  ...Object.entries(NANO_PRESETS),
  ["custom", CUSTOM_PRESET] as const,
];

describe("NANO_PRESETS", () => {
  it("has one preset per gallery sample and no others", () => {
    expect(Object.keys(NANO_PRESETS).sort()).toEqual(NANO_SAMPLES.map(spec => spec.id).sort());
  });

  it("uses each sample's own root key", () => {
    for (const spec of NANO_SAMPLES) expect(NANO_PRESETS[spec.id].params.rootKey).toBe(spec.rootKey);
  });

  it.each(all)("%s keeps every parameter inside its range", (_id, preset) => {
    for (const [key, [min, max]] of Object.entries(PARAM_RANGES)) {
      const value = preset.params[key as keyof typeof PARAM_RANGES];
      expect(value, key).toBeGreaterThanOrEqual(min);
      expect(value, key).toBeLessThanOrEqual(max);
    }
  });

  it.each(all)("%s stores integers where the box field is an integer", (_id, preset) => {
    expect(Number.isInteger(preset.params.rootKey)).toBe(true);
    expect(Number.isInteger(preset.params.octave)).toBe(true);
  });

  // The shortest sample a preset is applied to: the kick, at the lowest common rate.
  const SHORTEST_FRAMES = Math.round(0.4 * 44100);

  it.each(all)("%s has a region that plays and a loop that is not degenerate", (_id, preset) => {
    const { sampleStart, sampleEnd, loopStart, loopEnd } = preset.params;
    const values = { sampleStart, sampleEnd, loopStart, loopEnd };
    expect(regionBounds(values, SHORTEST_FRAMES).empty).toBe(false);
    if (preset.params.loop) expect(effectiveLoop(values, SHORTEST_FRAMES).degenerate).toBe(false);
  });

  it.each(all)("%s keeps its loop fade inside half the loop, so the fade heard is the fade set", (id, preset) => {
    if (!preset.params.loop) return;
    const spec = NANO_SAMPLES.find(candidate => candidate.id === id);
    const seconds = spec === undefined ? 1 : spec.seconds;
    const span = Math.abs(preset.params.loopEnd - preset.params.loopStart) * seconds;
    expect(preset.params.loopFade).toBeLessThanOrEqual(span / 2);
  });

  it.each(all)("%s has a pattern of whole-number notes inside the loop", (_id, preset) => {
    expect(preset.pattern.length).toBeGreaterThan(0);
    for (const note of preset.pattern) {
      expect(Number.isInteger(note.position)).toBe(true);
      expect(Number.isInteger(note.duration)).toBe(true);
      expect(Number.isInteger(note.pitch)).toBe(true);
      expect(note.position).toBeGreaterThanOrEqual(0);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.position + note.duration).toBeLessThanOrEqual(PATTERN_LENGTH);
      expect(note.pitch).toBeGreaterThanOrEqual(0);
      expect(note.pitch).toBeLessThanOrEqual(127);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
    }
  });

  it.each(all)("%s never overlaps two notes of the same pitch", (_id, preset) => {
    const byPitch = new Map<number, Array<readonly [number, number]>>();
    for (const note of preset.pattern) {
      const spans = byPitch.get(note.pitch) ?? [];
      for (const [from, to] of spans) {
        expect(note.position >= to || note.position + note.duration <= from).toBe(true);
      }
      spans.push([note.position, note.position + note.duration]);
      byPitch.set(note.pitch, spans);
    }
  });

  it("reverses the riser and leaves the others forward", () => {
    expect(regionBounds(NANO_PRESETS.riser.params, SHORTEST_FRAMES).reversed).toBe(true);
    for (const id of ["pluck", "pad", "kick"] as const) {
      expect(regionBounds(NANO_PRESETS[id].params, SHORTEST_FRAMES).reversed).toBe(false);
    }
  });
});
