/**
 * Measurement helpers for the stale-metronome-click repro page
 * (`metronome-stale-click-debug-demo.html`): where a recorded output restarts
 * after silence, how much of the last click before a stop was rendered, and how
 * hard the restart's first millisecond hits relative to the click's full level.
 */
import { describe, expect, it } from "vitest";
import { HEAD_WINDOW_MS, analyzeRestart, firstOnsetIndex, lastBurstMs, lastBurstPeak, headRatio } from "./clickHead";

const RATE = 48000;

/** A synthesized metronome click: `attackMs` linear ramp to `level`, then a
 *  linear release to zero over `releaseMs`, `freqHz` sine. Mirrors the engine's
 *  default (2 ms attack, 50 ms release). */
function click(level: number, attackMs = 2, releaseMs = 50, freqHz = 880, lengthMs = releaseMs + attackMs): Float32Array {
  const n = Math.round((lengthMs / 1000) * RATE);
  const out = new Float32Array(n);
  const attack = Math.round((attackMs / 1000) * RATE);
  for (let i = 0; i < n; i++) {
    const env = i < attack ? i / attack : Math.max(0, 1 - (i - attack) / ((releaseMs / 1000) * RATE));
    out[i] = level * env * Math.sin((2 * Math.PI * freqHz * i) / RATE);
  }
  return out;
}

function silence(ms: number): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * RATE));
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe("firstOnsetIndex", () => {
  it("finds the first sample above the threshold", () => {
    const x = concat(silence(10), click(0.5));
    const onset = firstOnsetIndex(x, 0.01);
    expect(onset).toBeGreaterThanOrEqual(Math.round(0.01 * RATE));
    expect(onset).toBeLessThan(Math.round(0.01 * RATE) + 12); // inside the 2 ms attack ramp
  });
  it("returns -1 for silence", () => {
    expect(firstOnsetIndex(silence(5), 0.01)).toBe(-1);
  });
});

describe("headRatio", () => {
  it("stays under 0.35 for a downbeat that starts from zero, normalised by the quieter beat click", () => {
    // Engine defaults: downbeat 880 Hz at 0.581, beat 440 Hz at 0.508 — the
    // reference is the interrupted BEAT click, the restart is the DOWNBEAT.
    const x = concat(silence(5), click(0.581, 2, 50, 880));
    const onset = firstOnsetIndex(x, 0.01);
    expect(headRatio(x, RATE, onset, HEAD_WINDOW_MS, 0.508)).toBeLessThan(0.35);
  });
  it("exceeds 0.45 when a beat click body is already sounding at the restart, whatever the sine phase", () => {
    // The stale click: the head of the recording IS the body of the 440 Hz beat
    // click, cut anywhere in its first 12 ms (release level ≥ 80 %).
    for (const cutMs of [2.5, 4.1, 6.3, 8.9, 10.2, 12]) {
      const stale = click(0.508, 2, 50, 440).subarray(Math.round((cutMs / 1000) * RATE));
      const x = concat(silence(5), stale);
      const onset = firstOnsetIndex(x, 0.01);
      expect(headRatio(x, RATE, onset, HEAD_WINDOW_MS, 0.508)).toBeGreaterThan(0.45);
    }
  });
});

describe("lastBurstMs", () => {
  it("measures the rendered body of the last click before the recording ends", () => {
    const x = concat(silence(20), click(0.5), silence(200), click(0.5).subarray(0, Math.round(0.012 * RATE)));
    expect(lastBurstMs(x, RATE, 0.01)).toBeCloseTo(12, 0);
  });
  it("reports the whole body when the last click was not cut", () => {
    const x = concat(silence(20), click(0.5), silence(200), click(0.5), silence(1));
    expect(lastBurstMs(x, RATE, 0.01)).toBeGreaterThan(40);
  });
});

describe("lastBurstPeak", () => {
  it("is the peak of the interrupted click", () => {
    const x = concat(silence(20), click(0.581, 2, 50, 880), silence(200), click(0.508, 2, 50, 440).subarray(0, Math.round(0.012 * RATE)));
    expect(lastBurstPeak(x, RATE, 0.01)).toBeCloseTo(0.508, 1);
  });
});

describe("analyzeRestart", () => {
  it("classifies a clean restart", () => {
    const pre = concat(silence(20), click(0.5), silence(200), click(0.508, 2, 50, 440), silence(10));
    const post = concat(silence(30), click(0.581, 2, 50, 880), silence(300), click(0.508, 2, 50, 440));
    const r = analyzeRestart(pre, post, RATE);
    expect(r.cutBodyMs).toBeGreaterThan(40);
    expect(r.headRatio).toBeLessThan(0.35);
    expect(r.fullLevel).toBeCloseTo(0.508, 1); // the interrupted (whole) beat click's own peak
  });
  it("classifies a stale-click restart", () => {
    const cut = click(0.508, 2, 50, 440).subarray(0, Math.round(0.008 * RATE));
    const pre = concat(silence(20), click(0.581, 2, 50, 880), silence(200), cut);
    const resumed = click(0.508, 2, 50, 440).subarray(Math.round(0.008 * RATE));
    const post = concat(silence(30), resumed, silence(300), click(0.581, 2, 50, 880));
    const r = analyzeRestart(pre, post, RATE);
    expect(r.cutBodyMs).toBeCloseTo(8, 0);
    expect(r.fullLevel).toBeCloseTo(0.508, 1);
    expect(r.headRatio).toBeGreaterThan(0.45);
  });
});
