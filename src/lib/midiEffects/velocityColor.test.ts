import { describe, expect, it } from "vitest";
import { VELOCITY_RAMP, velocityColor } from "./velocityColor";

describe("velocityColor", () => {
  it("is the accent at velocity 1 and the soft tint at 0", () => {
    expect(velocityColor(1)).toBe("rgb(232, 163, 61)");
    expect(velocityColor(0)).toBe(`rgb(${VELOCITY_RAMP.soft.join(", ")})`);
  });
  it("squares the velocity: 0.5 sits a quarter of the way", () => {
    const [r] = VELOCITY_RAMP.soft;
    const [R] = VELOCITY_RAMP.loud;
    expect(velocityColor(0.5)).toMatch(new RegExp(`^rgb\\(${Math.round(r + (R - r) * 0.25)}, `));
  });
  it("clamps outside 0..1", () => {
    expect(velocityColor(1.5)).toBe(velocityColor(1));
    expect(velocityColor(-1)).toBe(velocityColor(0));
  });
});
