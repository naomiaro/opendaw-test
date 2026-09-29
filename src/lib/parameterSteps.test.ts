import { describe, it, expect } from "vitest";
import { stepIndexToUnit, unitToStepIndex } from "./parameterSteps";

describe("parameter steps", () => {
  it("maps the ends of the range", () => {
    expect(stepIndexToUnit(0, 7)).toBe(0);
    expect(stepIndexToUnit(6, 7)).toBe(1);
    expect(unitToStepIndex(0, 7)).toBe(0);
    expect(unitToStepIndex(1, 7)).toBe(6);
  });

  it("reads a unit value that is a hair off its step as that step", () => {
    // (2 + 3) / 6 as the integer mapping returns it, which is not 5 * (1 / 6) in floating point
    expect(unitToStepIndex(0.8333333333333334, 7)).toBe(5);
    expect(unitToStepIndex(0.8333333333333333, 7)).toBe(5);
  });

  it.each([7, 128])("round-trips every index of a %d-position parameter", positions => {
    for (let index = 0; index < positions; index++) {
      expect(unitToStepIndex(stepIndexToUnit(index, positions), positions)).toBe(index);
    }
  });

  it("moves one position per index, in both directions, from every position", () => {
    for (let index = 1; index < 7; index++) {
      const here = unitToStepIndex(stepIndexToUnit(index, 7), 7);
      expect(unitToStepIndex(stepIndexToUnit(here - 1, 7), 7)).toBe(index - 1);
    }
    for (let index = 0; index < 6; index++) {
      const here = unitToStepIndex(stepIndexToUnit(index, 7), 7);
      expect(unitToStepIndex(stepIndexToUnit(here + 1, 7), 7)).toBe(index + 1);
    }
  });

  it("clamps an index or a unit value outside the range", () => {
    expect(stepIndexToUnit(-2, 7)).toBe(0);
    expect(stepIndexToUnit(9, 7)).toBe(1);
    expect(unitToStepIndex(-0.5, 7)).toBe(0);
    expect(unitToStepIndex(1.5, 7)).toBe(6);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("reads a unit value of %d as the first position", unit => {
    expect(unitToStepIndex(unit, 7)).toBe(0);
  });

  it.each([0, 1, -3, Number.NaN])("treats a parameter of %d positions as a single position", positions => {
    expect(stepIndexToUnit(3, positions)).toBe(0);
    expect(unitToStepIndex(0.7, positions)).toBe(0);
  });
});
