import { describe, expect, it } from "vitest";
import { CALIBRATION_PROCESSOR_SOURCE, roundTripsFrom, summarizeRoundTrips } from "./combinedCalibration";

const rate = 44100;
const synth = (delays: Array<number | null>, noise = 0.001) => {
  const lead = rate, gap = rate;
  const input = new Float32Array(lead + delays.length * gap + rate / 2);
  for (let i = 0; i < input.length; i++) input[i] = (Math.random() * 2 - 1) * noise;
  const emitFrames = delays.map((_, i) => lead + i * gap);
  delays.forEach((d, i) => {
    if (d === null) return;
    const at = emitFrames[i] + d;
    for (let k = 0; k < 353; k++) input[at + k] += 0.5 * Math.sin((2 * Math.PI * 6000 * k) / rate);
  });
  return { sampleRate: rate, input, emitFrames };
};

describe("roundTripsFrom", () => {
  it("finds each click after its emit frame and reports the round trip in ms", () => {
    const trips = roundTripsFrom(synth([2822, 2822, 2822])); // 64 ms
    expect(trips.map((t) => t.roundTripMs!).every((ms) => Math.abs(ms - 64) < 4)).toBe(true); // the detector's hop is 1.45 ms at 44.1 kHz
    expect(trips.every((t) => (t.peakOverFloorDb ?? 0) > 20)).toBe(true);
  });
  it("reports a click it cannot find as null instead of taking noise", () => {
    const trips = roundTripsFrom(synth([2822, null, 2822]));
    expect(trips.map((t) => t.detectFrame === null)).toEqual([false, true, false]);
  });
});

describe("summarizeRoundTrips", () => {
  const trip = (ms: number | null) => ({ emitFrame: 0, detectFrame: ms === null ? null : 1, roundTripMs: ms, peakOverFloorDb: ms === null ? 3 : 30 });
  it("takes the median and the spread and the input part past the output latency", () => {
    const r = summarizeRoundTrips([trip(63.9), trip(64.7), trip(64.4)], 23, -60, -20);
    expect(r).toMatchObject({ roundTripMs: 64.4, clicksFound: 3 });
    expect((r as { roundTripSpreadMs: number }).roundTripSpreadMs).toBeCloseTo(0.8, 6);
    expect((r as { inputPartMs: number }).inputPartMs).toBeCloseTo(41.4, 6);
  });
  it("refuses with the floor and the peak when a click was not found", () => {
    expect(summarizeRoundTrips([trip(64), trip(null), trip(64)], 23, -60, -58)).toMatchObject({ error: expect.stringMatching(/2 of 3.*-60.*-58/s) });
  });
});

describe("the processor source", () => {
  it("never reads the worklet clock", () => {
    expect(CALIBRATION_PROCESSOR_SOURCE).not.toMatch(/currentTime|currentFrame/);
    expect(CALIBRATION_PROCESSOR_SOURCE).toContain("registerProcessor(");
  });
});
