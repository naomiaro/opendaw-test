import { describe, expect, it } from "vitest";
import { resolveEffectArm } from "./midiInputCalibration";

describe("resolveEffectArm", () => {
  it("defaults to none and rejects an unknown arm", () => {
    expect(resolveEffectArm(null)).toBe("none");
    expect(resolveEffectArm("arpeggio")).toBe("arpeggio");
    expect(() => resolveEffectArm("zeitgeist")).toThrow(/unknown \?effect=/);
  });
});
