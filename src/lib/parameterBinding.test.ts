import { describe, it, expect } from "vitest";
import {
  formatParameterPrint, observeParameter, readParameter, writeParameterUnit, type ParameterSnapshot,
} from "./parameterBinding";
import { stepIndexToUnit, unitToStepIndex } from "./parameterSteps";
import { samplerFixture } from "./testing/boxGraphFixtures";

describe("readParameter", () => {
  it("reads the unit value and the printed value of a parameter at its default", () => {
    const { adapter } = samplerFixture();
    expect(readParameter(adapter.namedParameter.octave)).toEqual({ unit: 0.5, print: "0 oct" });
    expect(readParameter(adapter.namedParameter.sampleEnd)).toEqual({ unit: 1, print: "100 %" });
  });

  it("prints a parameter that has no unit without a trailing space", () => {
    const { adapter } = samplerFixture();
    const print = formatParameterPrint(adapter.namedParameter.rootKey);
    expect(print).toBe(print.trim());
    expect(print.length).toBeGreaterThan(0);
  });
});

describe("writeParameterUnit", () => {
  it("writes through the parameter's own mapping", () => {
    const { adapter, box, project } = samplerFixture();

    writeParameterUnit(project, adapter.namedParameter.tune, 1);

    expect(box.tune.getValue()).toBeCloseTo(1200, 3);
    expect(readParameter(adapter.namedParameter.tune).print).toBe("1200 ct");
  });

  it("commits one undo step per write", () => {
    const { adapter, box, project } = samplerFixture();
    const before = box.sampleStart.getValue();

    writeParameterUnit(project, adapter.namedParameter.sampleStart, 0.4);
    expect(box.sampleStart.getValue()).toBeCloseTo(0.4, 6);

    project.editing.undo();
    expect(box.sampleStart.getValue()).toBeCloseTo(before, 6);
  });

  // The binding relies on the parameter's mapping for this. If a mapping ever
  // stops clamping, these fail and the binding needs a clamp of its own.
  it.each([
    ["above the range", 1.5, 1],
    ["below the range", -0.5, 0],
  ])("lands a unit value %s on the end of the range", (_label, unit, expected) => {
    const { adapter, box, project } = samplerFixture();
    writeParameterUnit(project, adapter.namedParameter.sampleStart, 0.5);

    writeParameterUnit(project, adapter.namedParameter.sampleStart, unit);

    expect(box.sampleStart.getValue()).toBe(expected);
  });

  it.each([
    ["tune", 1.5, 1200],
    ["tune", -0.5, -1200],
    ["octave", 1.5, 3],
    ["attack", -0.5, 0.001],
    ["volume", 1.5, 0],
  ] as const)("keeps %s inside its range for a unit value of %d", (name, unit, expected) => {
    const { adapter, box, project } = samplerFixture();

    writeParameterUnit(project, adapter.namedParameter[name], unit);

    expect(box[name].getValue()).toBeCloseTo(expected, 3);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "ignores a unit value of %d",
    unit => {
      const { adapter, box, project } = samplerFixture();
      writeParameterUnit(project, adapter.namedParameter.tune, 0.75);

      writeParameterUnit(project, adapter.namedParameter.tune, unit);

      expect(box.tune.getValue()).toBeCloseTo(600, 3);
    }
  );

  it("writes a boolean parameter", () => {
    const { adapter, box, project } = samplerFixture();

    writeParameterUnit(project, adapter.namedParameter.loop, 1);
    expect(box.loop.getValue()).toBe(true);

    writeParameterUnit(project, adapter.namedParameter.loop, 0);
    expect(box.loop.getValue()).toBe(false);
  });
});

describe("observeParameter", () => {
  it("reports the current value at once", () => {
    const { adapter } = samplerFixture();
    const seen: ParameterSnapshot[] = [];

    observeParameter(adapter.namedParameter.octave, snapshot => seen.push(snapshot));

    expect(seen).toEqual([{ unit: 0.5, print: "0 oct" }]);
  });

  it("reports a write made through the binding", () => {
    const { adapter, project } = samplerFixture();
    const seen: ParameterSnapshot[] = [];
    observeParameter(adapter.namedParameter.tune, snapshot => seen.push(snapshot));

    writeParameterUnit(project, adapter.namedParameter.tune, 1);

    expect(seen[seen.length - 1]).toEqual({ unit: 1, print: "1200 ct" });
  });

  it("reports a write made elsewhere, such as a preset or an undo", () => {
    const { adapter, box, project } = samplerFixture();
    const seen: ParameterSnapshot[] = [];
    observeParameter(adapter.namedParameter.octave, snapshot => seen.push(snapshot));

    project.editing.modify(() => box.octave.setValue(2));
    expect(seen[seen.length - 1].print).toBe("2 oct");

    project.editing.undo();
    expect(seen[seen.length - 1].print).toBe("0 oct");
  });

  it("reports nothing after it is terminated", () => {
    const { adapter, project } = samplerFixture();
    const seen: ParameterSnapshot[] = [];
    const observation = observeParameter(adapter.namedParameter.tune, snapshot => seen.push(snapshot));
    const before = seen.length;

    observation.terminate();
    writeParameterUnit(project, adapter.namedParameter.tune, 1);

    expect(seen.length).toBe(before);
  });
});

describe("integer parameters step by whole positions", () => {
  it.each([
    ["octave", 7, -3],
    ["rootKey", 128, 0],
  ] as const)("every position of %s is reachable and reads back as itself", (name, positions, lowest) => {
    const { adapter, box, project } = samplerFixture();
    const parameter = adapter.namedParameter[name];

    for (let index = 0; index < positions; index++) {
      writeParameterUnit(project, parameter, stepIndexToUnit(index, positions));

      expect(box[name].getValue()).toBe(lowest + index);
      expect(unitToStepIndex(readParameter(parameter).unit, positions)).toBe(index);
    }
  });

  it("steps down from every octave, one at a time", () => {
    const { adapter, box, project } = samplerFixture();
    const parameter = adapter.namedParameter.octave;
    writeParameterUnit(project, parameter, 1);

    for (let expected = 2; expected >= -3; expected--) {
      const here = unitToStepIndex(readParameter(parameter).unit, 7);
      writeParameterUnit(project, parameter, stepIndexToUnit(here - 1, 7));
      expect(box.octave.getValue()).toBe(expected);
    }
  });
});
