import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { CLICK_DURATION_SEC, clickContextTimes, inputLatencySecondsFor, playClicks, renderClickTrain } from "./combinedClicks";

describe("clickContextTimes", () => {
  it("puts each click at the render time of its note's heard instant", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const s = clickContextTimes(pattern, { contextTime: 12, position: 0 }, 120);
    expect(s[0].index).toBe(0);
    expect(s[0].contextSec).toBeCloseTo(14, 9); // one bar at 120 = 2 s after the anchor
    expect(s[1].contextSec - s[0].contextSec).toBeCloseTo(0.25, 9); // an eighth
    expect(s.length).toBe(48);
  });
  it("subtracts the anchor's own position, which is the first recording quantum's end, not zero", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const s = clickContextTimes(pattern, { contextTime: 12, position: 5.57 }, 120);
    expect(s[0].contextSec).toBeCloseTo(14 - 5.57 / 1920, 9);
    const s2 = clickContextTimes(pattern, { contextTime: 12, position: 2 * BAR_PPQN }, 120);
    expect(s2[0].contextSec).toBeCloseTo(10, 9);
  });
});

describe("inputLatencySecondsFor", () => {
  it("is zero in the default state and the measured part in seconds when calibrated", () => {
    expect(inputLatencySecondsFor("default", 40.9)).toBe(0);
    expect(inputLatencySecondsFor("calibrated", 40.9)).toBeCloseTo(0.0409, 9);
  });
});

describe("renderClickTrain", () => {
  it("renders every click into one buffer that starts at the first click, silent between clicks", () => {
    const rate = 44100;
    const schedule = [{ index: 0, contextSec: 14 }, { index: 1, contextSec: 14.25 }, { index: 2, contextSec: 14.5 }];
    const { startSec, samples } = renderClickTrain(schedule, rate);
    expect(startSec).toBe(14);
    expect(samples.length).toBe(Math.ceil((0.5 + CLICK_DURATION_SEC) * rate));
    const peak = (fromSec: number, toSec: number) => {
      let p = 0;
      for (let i = Math.round(fromSec * rate); i < Math.min(samples.length, Math.round(toSec * rate)); i++) p = Math.max(p, Math.abs(samples[i]));
      return p;
    };
    expect(peak(0, CLICK_DURATION_SEC)).toBeGreaterThan(0.4);
    expect(peak(CLICK_DURATION_SEC + 0.001, 0.249)).toBe(0);
    expect(peak(0.25, 0.25 + CLICK_DURATION_SEC)).toBeGreaterThan(0.4);
    expect(peak(0.5, 0.5 + CLICK_DURATION_SEC)).toBeGreaterThan(0.4);
  });
  it("is empty for an empty schedule", () => {
    expect(renderClickTrain([], 44100).samples.length).toBe(0);
  });
});

describe("playClicks", () => {
  it("refuses a train whose first click is already in the past, instead of playing it late and blaming the microphone", () => {
    const audioContext = {
      sampleRate: 44100, currentTime: 20,
      createBuffer: () => ({ copyToChannel: () => undefined }),
      createBufferSource: () => ({ connect: () => undefined, start: () => undefined, stop: () => undefined, onended: null, buffer: null }),
    } as unknown as BaseAudioContext;
    expect(() => playClicks(audioContext, {} as AudioNode, [{ index: 0, contextSec: 19.9 }])).toThrow(/in the past/);
    expect(() => playClicks(audioContext, {} as AudioNode, [{ index: 0, contextSec: 20.5 }])).not.toThrow();
  });
});
