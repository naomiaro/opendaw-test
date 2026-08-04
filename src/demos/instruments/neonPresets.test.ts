import { describe, expect, it } from "vitest";
import { CzSysex, CzTone } from "@opendaw/studio-adapters";
import { NEON_PRESETS } from "./neonPresets";

// Continuous panel values: the codec quantizes these (levels through 0-127,
// DCW rates through a 119-step table), so authored vs projected may drift by ±1.
const flattenQuantized = (tone: CzTone): [string, number][] => [
  ["detuneNote", tone.detuneNote], ["detuneFine", tone.detuneFine],
  ["vibratoDelay", tone.vibratoDelay], ["vibratoRate", tone.vibratoRate],
  ["vibratoDepth", tone.vibratoDepth],
  ...tone.lines.flatMap((line, l): [string, number][] =>
    [["pitchEnv", line.pitchEnv], ["dcwEnv", line.dcwEnv], ["dcaEnv", line.dcaEnv]].flatMap(
      ([envName, env]: any): [string, number][] => [
        ...env.rates.map((r: number, i: number): [string, number] => [`line${l}.${envName}.rate${i}`, r]),
        ...env.levels.map((v: number, i: number): [string, number] => [`line${l}.${envName}.level${i}`, v]),
      ],
    ),
  ),
];

// Categorical/discrete fields: the codec maps these losslessly, and an off-by-one
// is a different sound (wave index, sustain stage…), not a rounding error —
// these must round-trip EXACTLY.
const flattenExact = (tone: CzTone): [string, number][] => [
  ["lineSelect", tone.lineSelect], ["modulation", tone.modulation],
  ["octave", tone.octave], ["vibratoWave", tone.vibratoWave],
  ...tone.lines.flatMap((line, l): [string, number][] => [
    [`line${l}.wave1`, line.wave1], [`line${l}.wave2`, line.wave2],
    [`line${l}.dcwKeyFollow`, line.dcwKeyFollow], [`line${l}.dcaKeyFollow`, line.dcaKeyFollow],
    ...[["pitchEnv", line.pitchEnv], ["dcwEnv", line.dcwEnv], ["dcaEnv", line.dcaEnv]].flatMap(
      ([envName, env]: any): [string, number][] => [
        [`line${l}.${envName}.sustain`, env.sustain], [`line${l}.${envName}.end`, env.end],
      ],
    ),
  ]),
];

describe("NEON_PRESETS", () => {
  it("has 4-6 uniquely named presets", () => {
    expect(NEON_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(NEON_PRESETS.length).toBeLessThanOrEqual(6);
    expect(new Set(NEON_PRESETS.map((p) => p.name)).size).toBe(NEON_PRESETS.length);
  });

  it("every preset encodes to a valid tone dump", () => {
    for (const preset of NEON_PRESETS) {
      expect(CzSysex.isToneDump(CzSysex.encode(preset.tone))).toBe(true);
    }
  });

  it("rejects garbage bytes", () => {
    expect(CzSysex.isToneDump(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(CzSysex.isToneDump(new Uint8Array(300).fill(0x42))).toBe(false);
  });

  it("decode is total on framing-valid junk (the demo's only gate before decode is isToneDump)", () => {
    // F0 44 … F7 framing with junk payload — isToneDump accepts it, so the
    // drop zone will call decode() on it; decode must not throw.
    const junk = new Uint8Array(300).fill(0x55);
    junk[0] = 0xf0;
    junk[1] = 0x44;
    junk[junk.length - 1] = 0xf7;
    expect(CzSysex.isToneDump(junk)).toBe(true);
    expect(() => CzSysex.decode(junk)).not.toThrow();
  });

  it("decode(encode(tone)) is a codec fixpoint; categorical fields exact, quantized within ±1", () => {
    for (const preset of NEON_PRESETS) {
      const once = CzSysex.decode(CzSysex.encode(preset.tone));
      const twice = CzSysex.decode(CzSysex.encode(once));
      expect(twice).toEqual(once); // fixpoint: second round-trip exact

      const authoredExact = flattenExact(preset.tone);
      const projectedExact = flattenExact(once);
      expect(projectedExact.length).toBe(authoredExact.length);
      projectedExact.forEach(([name, value], i) => {
        expect(value, `${preset.name} ${name}`).toBe(authoredExact[i][1]);
      });

      const authoredQuantized = flattenQuantized(preset.tone);
      const projectedQuantized = flattenQuantized(once);
      expect(projectedQuantized.length).toBe(authoredQuantized.length);
      projectedQuantized.forEach(([name, value], i) => {
        expect(Math.abs(value - authoredQuantized[i][1]), `${preset.name} ${name}`).toBeLessThanOrEqual(1);
      });
    }
  });

  it("PD Bass encodes to the pinned wire bytes (golden fixture — SDK codec tripwire)", () => {
    // Snapshot of CzSysex.encode(NEON_PRESETS[0].tone) at SDK 0.0.164. A change here
    // means the wire format moved: re-verify .syx interop, then update the fixture.
    const GOLDEN_PD_BASS_BASE64 =
      "8EQAAHAgYAgAAAAAAAAACAAAAAAAAAAAAAAAAAIAAAAAAQAGAAAAAAAAAAIADAIBAAcHDwcIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAHBw8HDgsJCQgIAAAIAAAACAAAAAgAAAAIAAAACAAAAAAADwcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAcHDw8ACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAHBwAMCAgAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAAADwcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD3";
    const golden = Uint8Array.from(atob(GOLDEN_PD_BASS_BASE64), (c) => c.charCodeAt(0));
    expect(Array.from(CzSysex.encode(NEON_PRESETS[0].tone))).toEqual(Array.from(golden));
  });
});
