import { describe, expect, it } from "vitest";
import {
  boundaryInOutput,
  findHits,
  joinMove,
  jumpIsReadable,
  largestStep,
  measurementProblem,
  predictedDroppedFrames,
  readBaseline,
  readRow,
  toneStep,
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
    expect(predictedDroppedFrames(240, 24000, 2)).toBe(0);
    expect(predictedDroppedFrames(240, 24001, 2)).toBe(16);
  });
});

describe("boundaryInOutput", () => {
  it("is frame 48000 of a one-pass render past one chunk", () => {
    expect(boundaryInOutput(192000, 1)).toBe(48000);
    expect(boundaryInOutput(48001, 1)).toBe(48000);
  });

  it("does not exist when the render fits one chunk", () => {
    expect(boundaryInOutput(43200, 1)).toBeNull();
    expect(boundaryInOutput(48000, 1)).toBeNull();
    expect(boundaryInOutput(24000, 2)).toBeNull();
  });

  it("falls in the discarded first pass of a two-pass section of a chunk or more", () => {
    expect(boundaryInOutput(192000, 2)).toBeNull();
    expect(boundaryInOutput(48000, 2)).toBeNull();
  });

  it("falls inside the kept pass of a shorter two-pass section", () => {
    expect(boundaryInOutput(43200, 2)).toBe(4800);
    expect(boundaryInOutput(39690, 2)).toBe(8310);
    expect(boundaryInOutput(47999, 2)).toBe(1);
    expect(boundaryInOutput(24001, 2)).toBe(23999);
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

  it("does not read a NaN sample as a hit", () => {
    expect(findHits(new Float32Array(10).fill(NaN), 0.05, 2)).toEqual([]);
  });

  it("reads a burst longer than the gap as one hit", () => {
    const samples = new Float32Array(1000);
    samples.fill(0.3, 100, 400);
    expect(findHits(samples, 0.05, 100)).toEqual([100]);
  });

  it("starts a new hit at exactly the gap after the last sample over", () => {
    const samples = new Float32Array(100);
    samples[10] = 0.5;
    samples[20] = 0.5;
    samples[29] = 0.5;
    expect(findHits(samples, 0.05, 10)).toEqual([10, 20]);
  });

  it("needs a sample strictly over the threshold", () => {
    const samples = new Float32Array(10);
    samples[3] = 0.5;
    samples[7] = 0.75;
    expect(findHits(samples, 0.5, 1)).toEqual([7]);
  });
});

describe("largestStep", () => {
  it("finds a rising jump and the frame after it", () => {
    const samples = new Float32Array(100);
    samples[50] = 0.5;
    samples[51] = 0.5;
    expect(largestStep(samples, 0, 100)).toEqual({ step: 0.5, frame: 50 });
  });

  it("finds a falling jump", () => {
    const samples = new Float32Array(100);
    samples.fill(0.5, 0, 50);
    expect(largestStep(samples, 1, 100)).toEqual({ step: 0.5, frame: 50 });
  });

  it("looks from `from` up to but not including `to`", () => {
    const samples = new Float32Array(100);
    samples[10] = 1;
    samples[60] = 0.25;
    samples[80] = 1;
    expect(largestStep(samples, 40, 80).frame).toBe(60);
  });

  it("counts the move onto `from` itself", () => {
    const samples = new Float32Array(100);
    samples[40] = 1;
    expect(largestStep(samples, 40, 41)).toEqual({ step: 1, frame: 40 });
  });

  it("reads silence as no step and no frame", () => {
    expect(largestStep(new Float32Array(100), 0, 100)).toEqual({ step: 0, frame: -1 });
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

  it("returns null when a hit is missing or extra", () => {
    expect(uniformEarly([24034, 72034], [24034])).toBeNull();
    expect(uniformEarly([24034], [24034, 72034])).toBeNull();
  });

  it("returns null with no hits", () => {
    expect(uniformEarly([], [])).toBeNull();
  });
});

describe("readBaseline", () => {
  it("accepts a shift of up to one frame either way", () => {
    expect(readBaseline([24034, 72034], [24034, 72034])).toBe(0);
    expect(readBaseline([24034, 72034], [24033, 72033])).toBe(1);
    expect(readBaseline([24034, 72034], [24035, 72035])).toBe(-1);
  });

  it("refuses a larger uniform shift, which a second defect could hide in", () => {
    expect(readBaseline([24034, 72034], [24032, 72032])).toBeNull();
    expect(readBaseline([24034, 72034], [24534, 72534])).toBeNull();
  });

  it("refuses hits that disagree", () => {
    expect(readBaseline([24034, 72034], [24034, 72018])).toBeNull();
  });
});

describe("readRow", () => {
  const onePass = {
    boundaryFrame: 48000 as number | null,
    sliceHits: [24034, 72034, 120034],
    sliceStep: { step: 0.065, frame: 1009 },
  };
  const quiet = { step: 0.065, frame: 2000 };
  const jump = { step: 0.498, frame: 48000 };

  it("reads a clean render as clean when none is predicted", () => {
    const row = readRow({ ...onePass, predicted: 0, sectionHits: [24034, 72034, 120034], sectionStep: quiet });
    expect(row.verdict).toBe("as-predicted");
    expect(row.earlyBefore).toEqual([0]);
    expect(row.earlyAfter).toEqual([0, 0]);
    expect(row.jump).toBe("none");
  });

  it("reads hits after the boundary early, and a jump on it, as predicted", () => {
    const row = readRow({ ...onePass, predicted: 16, sectionHits: [24034, 72018, 120018], sectionStep: jump });
    expect(row.verdict).toBe("as-predicted");
    expect(row.earlyBefore).toEqual([0]);
    expect(row.earlyAfter).toEqual([16, 16]);
    expect(row.jump).toBe("on-boundary");
  });

  describe("calls it changed", () => {
    it("when the predicted shift is absent, the jump being there", () => {
      const row = readRow({ ...onePass, predicted: 16, sectionHits: [24034, 72034, 120034], sectionStep: jump });
      expect(row.verdict).toBe("changed");
    });

    it("when a shift nobody predicted is there", () => {
      const row = readRow({ ...onePass, predicted: 0, sectionHits: [24034, 72018, 120018], sectionStep: quiet });
      expect(row.verdict).toBe("changed");
    });

    it("when the shift is right and the jump is missing", () => {
      const row = readRow({ ...onePass, predicted: 16, sectionHits: [24034, 72018, 120018], sectionStep: quiet });
      expect(row.verdict).toBe("changed");
    });

    it("when a hit before the boundary moved as well", () => {
      const row = readRow({ ...onePass, predicted: 16, sectionHits: [24018, 72018, 120018], sectionStep: jump });
      expect(row.verdict).toBe("changed");
    });

    it("when a jump shows on a row predicting none", () => {
      const row = readRow({ ...onePass, predicted: 0, sectionHits: [24034, 72034, 120034], sectionStep: jump });
      expect(row.jump).toBe("on-boundary");
      expect(row.verdict).toBe("changed");
    });

    it("when the jump is away from the boundary on a row predicting none", () => {
      const row = readRow({
        ...onePass,
        predicted: 0,
        sectionHits: [24034, 72034, 120034],
        sectionStep: { step: 0.498, frame: 96000 },
      });
      expect(row.jump).toBe("off-boundary");
      expect(row.verdict).toBe("changed");
    });

    it("when the jump is away from the boundary on a row predicting one", () => {
      for (const frame of [2000, 96000]) {
        const row = readRow({
          ...onePass,
          predicted: 16,
          sectionHits: [24034, 72018, 120018],
          sectionStep: { step: 0.498, frame },
        });
        expect(row.jump).toBe("off-boundary");
        expect(row.verdict).toBe("changed");
      }
    });

    it("when a hit is missing or extra", () => {
      const missing = readRow({ ...onePass, predicted: 0, sectionHits: [24034, 72034], sectionStep: quiet });
      expect(missing.verdict).toBe("changed");
      const extra = readRow({
        ...onePass,
        predicted: 0,
        sliceHits: [24034, 72034],
        sectionHits: [24034, 72034, 120034],
        sectionStep: quiet,
      });
      expect(extra.verdict).toBe("changed");
    });

    it("when there is nothing to read", () => {
      const row = readRow({ ...onePass, predicted: 0, sliceHits: [], sectionHits: [], sectionStep: quiet });
      expect(row.verdict).toBe("changed");
    });

    it("when a shift is predicted and no hit lies where it would show", () => {
      const row = readRow({ ...onePass, predicted: 16, sliceHits: [24034], sectionHits: [24034], sectionStep: jump });
      expect(row.verdict).toBe("changed");
    });
  });

  describe("reading the jump", () => {
    const at = (step: number, frame: number): string =>
      readRow({
        ...onePass,
        sliceStep: { step: 0.25, frame: 1 },
        predicted: 16,
        sectionHits: [24034, 72018, 120018],
        sectionStep: { step, frame },
      }).jump;

    it("needs more than twice the reference's step", () => {
      expect([0.3, 0.5, 0.5001, 1.5].map((step) => at(step, 48000))).toEqual([
        "none",
        "none",
        "on-boundary",
        "on-boundary",
      ]);
    });

    it("allows one frame either side of the boundary", () => {
      expect([47998, 47999, 48000, 48001, 48002].map((frame) => at(0.5001, frame))).toEqual([
        "off-boundary",
        "on-boundary",
        "on-boundary",
        "on-boundary",
        "off-boundary",
      ]);
    });
  });

  it("splits hits by where the reference has them, the boundary itself counting as after", () => {
    const row = readRow({
      ...onePass,
      predicted: 16,
      sliceHits: [47999, 48000, 48010],
      sectionHits: [47999, 47984, 47994],
      sectionStep: jump,
    });
    expect(row.earlyBefore).toEqual([0]);
    expect(row.earlyAfter).toEqual([16, 16]);
    expect(row.verdict).toBe("as-predicted");
  });

  describe("with the boundary in the discarded pass", () => {
    const discarded = { ...onePass, boundaryFrame: null };

    it("expects every kept hit early and no jump", () => {
      const row = readRow({ ...discarded, predicted: 16, sectionHits: [24018, 72018, 120018], sectionStep: quiet });
      expect(row.earlyBefore).toEqual([]);
      expect(row.earlyAfter).toEqual([16, 16, 16]);
      expect(row.verdict).toBe("as-predicted");
    });

    it("calls a jump changed, on or off where the boundary would be", () => {
      for (const frame of [48000, 96000]) {
        const row = readRow({
          ...discarded,
          predicted: 16,
          sectionHits: [24018, 72018, 120018],
          sectionStep: { step: 0.498, frame },
        });
        expect(row.jump).toBe("off-boundary");
        expect(row.verdict).toBe("changed");
      }
    });

    it("calls a kept hit on time changed", () => {
      const row = readRow({ ...discarded, predicted: 16, sectionHits: [24034, 72018, 120018], sectionStep: quiet });
      expect(row.verdict).toBe("changed");
    });
  });

  describe("with the boundary inside the kept pass of a short two-pass section", () => {
    it("expects hits before it on time, hits after it early, and the jump on it", () => {
      const row = readRow({
        ...onePass,
        boundaryFrame: 4800,
        predicted: 16,
        sliceHits: [2000, 24034],
        sectionHits: [2000, 24018],
        sectionStep: { step: 0.498, frame: 4800 },
      });
      expect(row.earlyBefore).toEqual([0]);
      expect(row.earlyAfter).toEqual([16]);
      expect(row.jump).toBe("on-boundary");
      expect(row.verdict).toBe("as-predicted");
    });

    it("calls a jump at frame 48000 changed", () => {
      const row = readRow({
        ...onePass,
        boundaryFrame: 4800,
        predicted: 16,
        sliceHits: [24034],
        sectionHits: [24018],
        sectionStep: { step: 0.498, frame: 48000 },
      });
      expect(row.verdict).toBe("changed");
    });
  });

  describe("with the shift a no-latency render of the same passes shows", () => {
    const discarded = { ...onePass, boundaryFrame: null, sectionStep: quiet };

    it("reads a row at the prediction plus that shift as predicted", () => {
      const row = readRow({ ...discarded, predicted: 36, baseline: 1, sectionHits: [23997, 71997, 119997] });
      expect(row.earlyAfter).toEqual([37, 37, 37]);
      expect(row.verdict).toBe("as-predicted");
    });

    it("calls the prediction alone changed", () => {
      const row = readRow({ ...discarded, predicted: 36, baseline: 1, sectionHits: [23998, 71998, 119998] });
      expect(row.verdict).toBe("changed");
    });

    it("calls that shift alone changed when more is predicted", () => {
      const row = readRow({ ...discarded, predicted: 36, baseline: 1, sectionHits: [24033, 72033, 120033] });
      expect(row.verdict).toBe("changed");
    });

    it("expects it on hits before a boundary as well", () => {
      const row = readRow({
        ...onePass,
        predicted: 16,
        baseline: 1,
        sectionHits: [24033, 72017, 120017],
        sectionStep: jump,
      });
      expect(row.earlyBefore).toEqual([1]);
      expect(row.earlyAfter).toEqual([17, 17]);
      expect(row.verdict).toBe("as-predicted");
    });
  });
});

describe("toneStep", () => {
  it("is the largest move a sine makes between neighbouring samples", () => {
    expect(toneStep(0.5, 997, 48000)).toBeCloseTo(0.0652, 4);
    expect(toneStep(0.5, 997, 44100)).toBeCloseTo(0.071, 4);
  });
});

describe("joinMove", () => {
  it("gives the moves the joins measured", () => {
    expect(joinMove(0.5, 997, 48000, 48000, 16)).toBeCloseTo(0.5, 2);
    expect(joinMove(0.5, 997, 48000, 48000, 113)).toBeCloseTo(0.475, 2);
    expect(joinMove(0.5, 997, 44100, 48000, 36)).toBeCloseTo(0.449, 2);
    expect(joinMove(0.5, 997, 44100, 48000, 113)).toBeCloseTo(0.893, 2);
  });

  it("is small where the tone sits at the same level on both sides of the join", () => {
    expect(joinMove(0.5, 997, 44100, 8310, 36)).toBeLessThan(toneStep(0.5, 997, 44100));
  });
});

describe("jumpIsReadable", () => {
  it("needs a join moving more than twice the tone's own step", () => {
    expect(jumpIsReadable(0.5, 997, 48000, 48000, 16)).toBe(true);
    expect(jumpIsReadable(0.5, 997, 44100, 48000, 36)).toBe(true);
    expect(jumpIsReadable(0.5, 997, 44100, 8310, 36)).toBe(false);
  });
});

describe("readRow with a jump the tone cannot show", () => {
  const row = {
    boundaryFrame: 8310 as number | null,
    predicted: 36,
    jumpReadable: false,
    sliceHits: [22081],
    sectionHits: [22045],
    sliceStep: { step: 0.071, frame: 28044 },
  };

  it("expects none, and still holds the shift to the prediction", () => {
    expect(readRow({ ...row, sectionStep: { step: 0.071, frame: 28008 } }).verdict).toBe("as-predicted");
    expect(readRow({ ...row, sectionHits: [22081], sectionStep: { step: 0.071, frame: 28008 } }).verdict).toBe("changed");
  });

  it("calls a jump showing anyway changed", () => {
    expect(readRow({ ...row, sectionStep: { step: 0.449, frame: 8310 } }).verdict).toBe("changed");
  });
});

describe("measurementProblem", () => {
  const good = {
    expectedHits: 4,
    expectedFrames: 192000,
    expectedStep: 0.0652,
    burst: { sliceHits: [1, 2, 3, 4], sectionHits: [1, 2, 3, 4], sectionFrames: 192000 },
    tone: { sliceStep: 0.0652, sectionStep: 0.0652, sectionFrames: 192000 },
  };

  it("passes a render that measured what it set out to", () => {
    expect(measurementProblem(good)).toBeNull();
  });

  it("passes a section with a jump in it, which is the finding", () => {
    expect(measurementProblem({ ...good, tone: { ...good.tone, sectionStep: 0.5 } })).toBeNull();
  });

  it("passes a section missing some hits, which the row reads as changed", () => {
    const burst = { ...good.burst, sectionHits: [1, 2, 3] };
    expect(measurementProblem({ ...good, burst })).toBeNull();
  });

  it("names a burst reference missing hits", () => {
    const burst = { ...good.burst, sliceHits: [1] };
    expect(measurementProblem({ ...good, burst })).toMatch(/burst.*reference.*1 of 4/);
  });

  it("names a silent burst section", () => {
    const burst = { ...good.burst, sectionHits: [] };
    expect(measurementProblem({ ...good, burst })).toMatch(/burst.*renderSection.*no hits/);
  });

  it("names a section of the wrong length, in either signal", () => {
    const burst = { ...good.burst, sectionFrames: 100 };
    expect(measurementProblem({ ...good, burst })).toMatch(/burst.*100 frames.*192000/);
    const tone = { ...good.tone, sectionFrames: 100 };
    expect(measurementProblem({ ...good, tone })).toMatch(/tone.*100 frames.*192000/);
  });

  it("names a tone reference silent or off its expected step", () => {
    for (const sliceStep of [0, 0.03, 0.09]) {
      const tone = { ...good.tone, sliceStep };
      expect(measurementProblem({ ...good, tone })).toMatch(/tone.*reference/);
    }
  });

  it("names a tone section that is silent or too quiet to read", () => {
    for (const sectionStep of [0, 0.03]) {
      const tone = { ...good.tone, sectionStep };
      expect(measurementProblem({ ...good, tone })).toMatch(/tone.*renderSection/);
    }
  });
});
