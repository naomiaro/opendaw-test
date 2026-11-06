import { describe, expect, it } from "vitest";
import {
  findHits,
  largestStep,
  predictedDroppedFrames,
  readRow,
  uniformEarly,
} from "./sectionRenderGap";

describe("predictedDroppedFrames", () => {
  it("drops what the trim leaves of the first chunk's last quantum", () => {
    expect(predictedDroppedFrames(240, 192000, 1)).toBe(16);
    expect(predictedDroppedFrames(15, 192000, 1)).toBe(113);
    expect(predictedDroppedFrames(221, 192000, 1)).toBe(35);
  });

  it("drops nothing for no latency or a whole number of quanta", () => {
    expect(predictedDroppedFrames(0, 192000, 1)).toBe(0);
    expect(predictedDroppedFrames(1280, 192000, 1)).toBe(0);
  });

  it("drops nothing when the render fits one chunk, since no later step follows", () => {
    expect(predictedDroppedFrames(240, 43200, 1)).toBe(0);
    expect(predictedDroppedFrames(240, 48000, 1)).toBe(0);
    expect(predictedDroppedFrames(240, 48001, 1)).toBe(16);
  });

  it("counts every pass towards the frames rendered", () => {
    expect(predictedDroppedFrames(240, 43200, 2)).toBe(16);
  });
});

describe("findHits", () => {
  it("reports the first frame over the threshold of each burst", () => {
    const samples = new Float32Array(1000);
    samples[100] = 0.01;
    samples[101] = 0.2;
    samples[102] = 0.4;
    samples[700] = -0.3;
    expect(findHits(samples, 0.05, 200)).toEqual([101, 700]);
  });

  it("finds nothing in silence", () => {
    expect(findHits(new Float32Array(100), 0.05, 10)).toEqual([]);
  });
});

describe("largestStep", () => {
  it("finds the jump and the frame after it", () => {
    const samples = new Float32Array(100);
    samples[50] = 0.5;
    samples[51] = 0.5;
    expect(largestStep(samples, 0, 100)).toEqual({ step: 0.5, frame: 50 });
  });

  it("looks only inside the window", () => {
    const samples = new Float32Array(100);
    samples[10] = 1;
    samples[60] = 0.25;
    expect(largestStep(samples, 40, 100).frame).toBe(60);
  });
});

describe("readRow", () => {
  const base = {
    boundaryFrame: 48000,
    sliceHits: [24034, 72034, 120034],
    sliceStep: { step: 0.065, frame: 1009 },
  };

  it("reads a clean render as clean when none is predicted", () => {
    const row = readRow({
      ...base,
      predicted: 0,
      passes: 1,
      sectionHits: [24034, 72034, 120034],
      sectionStep: { step: 0.065, frame: 2000 },
    });
    expect(row.verdict).toBe("as-predicted");
    expect(row.earlyBefore).toEqual([0]);
    expect(row.earlyAfter).toEqual([0, 0]);
    expect(row.stepAtBoundary).toBe(false);
  });

  it("reads hits after the boundary early, and a jump on it, as predicted", () => {
    const row = readRow({
      ...base,
      predicted: 16,
      passes: 1,
      sectionHits: [24034, 72018, 120018],
      sectionStep: { step: 0.498, frame: 48000 },
    });
    expect(row.verdict).toBe("as-predicted");
    expect(row.earlyBefore).toEqual([0]);
    expect(row.earlyAfter).toEqual([16, 16]);
    expect(row.stepAtBoundary).toBe(true);
  });

  it("calls a predicted shift that is absent changed", () => {
    const row = readRow({
      ...base,
      predicted: 16,
      passes: 1,
      sectionHits: [24034, 72034, 120034],
      sectionStep: { step: 0.065, frame: 2000 },
    });
    expect(row.verdict).toBe("changed");
  });

  it("calls an unpredicted shift changed", () => {
    const row = readRow({
      ...base,
      predicted: 0,
      passes: 1,
      sectionHits: [24034, 72018, 120018],
      sectionStep: { step: 0.065, frame: 2000 },
    });
    expect(row.verdict).toBe("changed");
  });

  it("calls a shift without the jump changed", () => {
    const row = readRow({
      ...base,
      predicted: 16,
      passes: 1,
      sectionHits: [24034, 72018, 120018],
      sectionStep: { step: 0.065, frame: 2000 },
    });
    expect(row.verdict).toBe("changed");
  });

  it("calls a jump on a clean render changed", () => {
    const row = readRow({
      ...base,
      predicted: 0,
      passes: 1,
      sectionHits: [24034, 72034, 120034],
      sectionStep: { step: 0.498, frame: 48000 },
    });
    expect(row.verdict).toBe("changed");
  });

  it("calls a missing hit changed instead of comparing the wrong pair", () => {
    const row = readRow({
      ...base,
      predicted: 0,
      passes: 1,
      sectionHits: [24034, 72034],
      sectionStep: { step: 0.065, frame: 2000 },
    });
    expect(row.verdict).toBe("changed");
  });

  it("expects every kept hit early on a second pass, and no jump in what is kept", () => {
    const row = readRow({
      ...base,
      predicted: 16,
      passes: 2,
      sectionHits: [24018, 72018, 120018],
      sectionStep: { step: 0.065, frame: 2000 },
    });
    expect(row.verdict).toBe("as-predicted");
    expect(row.earlyBefore).toEqual([16]);
    expect(row.earlyAfter).toEqual([16, 16]);
  });

  describe("with the shift a no-latency render of the same passes shows", () => {
    const twoPasses = { ...base, passes: 2 as const, sectionStep: { step: 0.065, frame: 2000 } };

    it("reads a row at the prediction plus that shift as predicted", () => {
      const row = readRow({ ...twoPasses, predicted: 36, baseline: 1, sectionHits: [23997, 71997, 119997] });
      expect(row.earlyAfter).toEqual([37, 37]);
      expect(row.verdict).toBe("as-predicted");
    });

    it("calls the prediction alone changed", () => {
      const row = readRow({ ...twoPasses, predicted: 36, baseline: 1, sectionHits: [23998, 71998, 119998] });
      expect(row.verdict).toBe("changed");
    });

    it("calls that shift alone changed when more is predicted", () => {
      const row = readRow({ ...twoPasses, predicted: 36, baseline: 1, sectionHits: [24033, 72033, 120033] });
      expect(row.verdict).toBe("changed");
    });
  });
});

describe("uniformEarly", () => {
  it("returns the one shift every hit shows", () => {
    expect(uniformEarly([24034, 72034], [24033, 72033])).toBe(1);
    expect(uniformEarly([24034, 72034], [24034, 72034])).toBe(0);
  });

  it("returns null when the hits disagree, so a real gap cannot pass as a baseline", () => {
    expect(uniformEarly([24034, 72034], [24034, 72018])).toBeNull();
  });

  it("returns null when a hit is missing", () => {
    expect(uniformEarly([24034, 72034], [24034])).toBeNull();
  });
});
