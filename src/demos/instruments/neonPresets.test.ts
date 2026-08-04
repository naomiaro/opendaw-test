import { describe, expect, it } from "vitest";
import { CzSysex, CzTone } from "@opendaw/studio-adapters";
import { NEON_PRESETS } from "./neonPresets";

const flatten = (tone: CzTone): number[] => [
  tone.lineSelect, tone.modulation, tone.octave, tone.detuneNote, tone.detuneFine,
  tone.vibratoWave, tone.vibratoDelay, tone.vibratoRate, tone.vibratoDepth,
  ...tone.lines.flatMap((line) => [
    line.wave1, line.wave2, line.dcwKeyFollow, line.dcaKeyFollow,
    ...[line.pitchEnv, line.dcwEnv, line.dcaEnv].flatMap((env) => [
      ...env.rates, ...env.levels, env.sustain, env.end,
    ]),
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

  it("decode(encode(tone)) is a codec fixpoint within ±1 of authored values", () => {
    for (const preset of NEON_PRESETS) {
      const once = CzSysex.decode(CzSysex.encode(preset.tone));
      const twice = CzSysex.decode(CzSysex.encode(once));
      expect(twice).toEqual(once); // fixpoint: second round-trip exact
      const authored = flatten(preset.tone);
      const projected = flatten(once);
      expect(projected.length).toBe(authored.length);
      projected.forEach((value, i) => {
        expect(Math.abs(value - authored[i]), `${preset.name} field #${i}`).toBeLessThanOrEqual(1);
      });
    }
  });
});
