/**
 * Measurement helpers for the stale-metronome-click repro page
 * (`metronome-stale-click-debug-demo.html`): where a recorded output restarts
 * after silence, how much of the last click before a stop was rendered, and how
 * hard the restart's first millisecond hits relative to the click's full level.
 */
import { describe, expect, it } from "vitest";
import {
  CLEAN_HEAD_RATIO_MAX, CUT_BODY_MAX_MS, CUT_BODY_MIN_MS, HEAD_WINDOW_MS, STALE_HEAD_RATIO_MIN,
  analyzeRestart, cutInsideBody, firstOnsetIndex, lastBurstMs, lastBurstPeak, headRatio, peakIn,
} from "./clickHead";

const RATE = 48000;
const RATES = [48000, 44100];

/** A synthesized metronome click: `attackMs` linear ramp to `level`, then a
 *  linear release to zero over `releaseMs`, `freqHz` sine. Mirrors the engine's
 *  default (2 ms attack, 50 ms release). */
function click(level: number, attackMs = 2, releaseMs = 50, freqHz = 880, lengthMs = releaseMs + attackMs, rate = RATE): Float32Array {
  const n = Math.round((lengthMs / 1000) * rate);
  const out = new Float32Array(n);
  const attack = Math.round((attackMs / 1000) * rate);
  for (let i = 0; i < n; i++) {
    const env = i < attack ? i / attack : Math.max(0, 1 - (i - attack) / ((releaseMs / 1000) * rate));
    out[i] = level * env * Math.sin((2 * Math.PI * freqHz * i) / rate);
  }
  return out;
}

function silence(ms: number, rate = RATE): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * rate));
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
  it("stays under the clean bound for a downbeat that starts from zero, normalised by the quieter beat click, at both rates", () => {
    // Engine defaults: downbeat 880 Hz at 0.581, beat 440 Hz at 0.508 — the
    // reference is the interrupted BEAT click, the restart is the DOWNBEAT.
    for (const rate of RATES) {
      const x = concat(silence(5, rate), click(0.581, 2, 50, 880, 52, rate));
      const onset = firstOnsetIndex(x, 0.01);
      expect(headRatio(x, rate, onset, HEAD_WINDOW_MS, 0.508)).toBeLessThan(CLEAN_HEAD_RATIO_MAX);
    }
  });
  it("exceeds the stale bound when a beat click body is already sounding at the restart, whatever the sine phase, at both rates", () => {
    // The stale click: the head of the recording IS the body of the 440 Hz beat
    // click, cut anywhere inside the accepted window (release level ≥ 80 %).
    for (const rate of RATES) {
      for (const cutMs of [CUT_BODY_MIN_MS, 4.1, 6.3, 8.9, 10.2, CUT_BODY_MAX_MS]) {
        const stale = click(0.508, 2, 50, 440, 52, rate).subarray(Math.round((cutMs / 1000) * rate));
        const x = concat(silence(5, rate), stale);
        const onset = firstOnsetIndex(x, 0.01);
        expect(headRatio(x, rate, onset, HEAD_WINDOW_MS, 0.508)).toBeGreaterThan(STALE_HEAD_RATIO_MIN);
      }
    }
  });
  it("guards: no onset or no level reads 0", () => {
    const x = concat(silence(5), click(0.5));
    expect(headRatio(x, RATE, -1, HEAD_WINDOW_MS, 0.5)).toBe(0);
    expect(headRatio(x, RATE, 10, HEAD_WINDOW_MS, 0)).toBe(0);
  });
});

describe("cutInsideBody", () => {
  it("accepts the attack-complete to release-still-high window, inclusive", () => {
    expect(cutInsideBody(CUT_BODY_MIN_MS)).toBe(true);
    expect(cutInsideBody(CUT_BODY_MAX_MS)).toBe(true);
    expect(cutInsideBody(CUT_BODY_MIN_MS - 0.1)).toBe(false);
    expect(cutInsideBody(CUT_BODY_MAX_MS + 0.1)).toBe(false);
    expect(cutInsideBody(0)).toBe(false);
  });
});

describe("peakIn / silence contracts", () => {
  it("peakIn reads the window's peak and clamps to the buffer", () => {
    const x = concat(silence(5), click(0.5));
    expect(peakIn(x, RATE, 0, 5)).toBe(0);
    expect(peakIn(x, RATE, Math.round(0.005 * RATE), 60)).toBeCloseTo(0.5, 1);
    expect(peakIn(x, RATE, x.length - 2, 60)).toBeGreaterThanOrEqual(0);
  });
  it("lastBurstMs and lastBurstPeak read 0 on silence; firstOnsetIndex honours `from`", () => {
    expect(lastBurstMs(silence(50), RATE, 0.01)).toBe(0);
    expect(lastBurstPeak(silence(50), RATE, 0.01)).toBe(0);
    const x = concat(silence(5), click(0.5), silence(200), click(0.5));
    const first = firstOnsetIndex(x, 0.01);
    const second = firstOnsetIndex(x, 0.01, first + Math.round(0.1 * RATE));
    expect(second).toBeGreaterThan(first + Math.round(0.2 * RATE));
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
  it("a silent post recording (restart never captured) reports restartOnset −1 and head ratio 0 — the page must gate on it", () => {
    const pre = concat(silence(20), click(0.5), silence(200), click(0.508, 2, 50, 440), silence(10));
    const r = analyzeRestart(pre, silence(400), RATE);
    expect(r.restartOnset).toBe(-1);
    expect(r.headRatio).toBe(0);
    const empty = analyzeRestart(new Float32Array(0), new Float32Array(0), RATE);
    expect(empty).toEqual({ cutBodyMs: 0, fullLevel: 0, restartOnset: -1, headRatio: 0 });
  });
  it("a cut shorter than the attack falls back to a whole click after the restart, else to the restart's own 60 ms", () => {
    const cut = click(0.508, 2, 50, 440).subarray(0, Math.round(0.0015 * RATE)); // 1.5 ms: attack incomplete
    const pre = concat(silence(20), click(0.581, 2, 50, 880), silence(200), cut);
    const withLaterClick = concat(silence(30), click(0.581, 2, 50, 880), silence(300), click(0.5, 2, 50, 440));
    expect(analyzeRestart(pre, withLaterClick, RATE).fullLevel).toBeCloseTo(0.5, 1);
    const restartOnly = concat(silence(30), click(0.581, 2, 50, 880), silence(300));
    expect(analyzeRestart(pre, restartOnly, RATE).fullLevel).toBeCloseTo(0.581, 1); // last resort: the restart click itself
  });
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
