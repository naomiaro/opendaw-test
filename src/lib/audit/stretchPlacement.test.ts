import { describe, expect, it } from "vitest";
import {
  CENTRED_FRAMES, CLICK_COUNT, clickSourceFrames, clickTrain, effectiveStretch, expectedFrames, isProcessed, judgePlacement,
  PLACEMENT_ROWS, readClick, regionPulses, renderSeconds, resolveRows, SMEAR_LIMIT_FRAMES, type PlacementRow,
} from "./stretchPlacement";

const RATE = 48000;
const row = (id: string): PlacementRow => {
  const found = PLACEMENT_ROWS.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
};

/** The source placed on a render the way an unprocessed row plays it: every burst `shift` frames after the warp map. */
function renderOf(r: PlacementRow, shift: number, shiftOne: { index: number; frames: number } | null = null): Float32Array {
  const out = new Float32Array(Math.ceil(renderSeconds(r) * RATE));
  const train = clickTrain(RATE);
  const sources = clickSourceFrames(RATE);
  expectedFrames(r, RATE).forEach((expected, index) => {
    const extra = shiftOne !== null && shiftOne.index === index ? shiftOne.frames : 0;
    for (let offset = -60; offset <= 60; offset++) out[Math.round(expected) + shift + extra + offset] = train[sources[index] + offset];
  });
  return out;
}

describe("the click train", () => {
  it("has a symmetric burst centred on each source frame", () => {
    const train = clickTrain(RATE);
    const frames = clickSourceFrames(RATE);
    expect(frames).toHaveLength(CLICK_COUNT);
    for (const frame of frames) {
      const read = readClick(train, RATE, frame);
      expect(read.centroidError).not.toBeNull();
      expect(Math.abs(read.centroidError ?? 1)).toBeLessThan(1e-6);
      expect(read.peakError).toBe(0);
    }
  });

  it("puts its bursts on whole frames at both page rates", () => {
    for (const rate of [48000, 44100]) {
      clickSourceFrames(rate).forEach((frame, index) => expect(frame).toBe((0.25 + index * 0.5) * rate));
    }
  });
});

describe("the warp map", () => {
  it("uses the stretch the region's whole pulses give, not the row's nominal one", () => {
    const slight = row("signalsmith-1.02");
    expect(regionPulses(slight)).toBe(7834);
    expect(effectiveStretch(slight)).toBeCloseTo(7834 / 7680, 12);
  });

  it("places a burst at the region's start plus its source frame times the stretch", () => {
    // region at one quarter (0.5 s), first burst 0.25 s into the source, played 1.5 times as long
    expect(expectedFrames(row("signalsmith-1.5"), RATE)[0]).toBe(0.5 * RATE + 0.25 * RATE * 1.5);
    expect(expectedFrames(row("signalsmith-1-at-0"), RATE)[0]).toBe(0.25 * RATE);
  });

  it("calls a row processed only when Signalsmith stretches or transposes", () => {
    expect(isProcessed(row("none"))).toBe(false);
    expect(isProcessed(row("varispeed-1.5"))).toBe(false);
    expect(isProcessed(row("signalsmith-1"))).toBe(false);
    expect(isProcessed(row("signalsmith-1.02"))).toBe(true);
    expect(isProcessed(row("signalsmith-1-up3"))).toBe(true);
  });
});

describe("the verdict", () => {
  it("reads an unprocessed row on the map as expected, and one render quantum late as not", () => {
    const identity = row("signalsmith-1");
    expect(judgePlacement(identity, renderOf(identity, 0), RATE).status).toBe("as-expected");
    // one slot of the uuid stagger this page was built after
    const late = judgePlacement(identity, renderOf(identity, 128), RATE);
    expect(late.status).toBe("investigate");
    expect(late.values.medianCentroidFrames).toBe(128);
  });

  it("holds an unprocessed row to a frame on every burst, not only on the median", () => {
    const none = row("none");
    expect(judgePlacement(none, renderOf(none, 0, { index: 3, frames: 5 }), RATE).status).toBe("investigate");
  });

  it("allows a processed row its smear but not a constant offset", () => {
    const stretched = row("signalsmith-1.5");
    expect(judgePlacement(stretched, renderOf(stretched, CENTRED_FRAMES - 1), RATE).status).toBe("as-expected");
    expect(judgePlacement(stretched, renderOf(stretched, CENTRED_FRAMES + 1), RATE).status).toBe("investigate");
    // one burst may wander inside the block, not out of it
    expect(judgePlacement(stretched, renderOf(stretched, 0, { index: 2, frames: SMEAR_LIMIT_FRAMES - 10 }), RATE).status).toBe("as-expected");
    expect(judgePlacement(stretched, renderOf(stretched, 0, { index: 2, frames: SMEAR_LIMIT_FRAMES + 10 }), RATE).status).toBe("investigate");
  });

  it("reads a render that lost a burst as unreadable, whatever the others say", () => {
    const none = row("none");
    const render = renderOf(none, 0);
    const lost = Math.round(expectedFrames(none, RATE)[4]);
    render.fill(0, lost - 100, lost + 100);
    const verdict = judgePlacement(none, render, RATE);
    expect(verdict.status).toBe("unreadable");
    expect(verdict.values.sounded).toBe(CLICK_COUNT - 1);
  });
});

describe("?row=", () => {
  it("resolves all, one id, and refuses another", () => {
    expect(resolveRows(null)).toBe(PLACEMENT_ROWS);
    expect(resolveRows("none")).toEqual([row("none")]);
    expect(() => resolveRows("nope")).toThrow(/invalid \?row=/);
  });
});
