import { describe, it, expect } from "vitest";
import {
  AUDIO_WRAP_LOOP_END_BARS,
  AUDIO_WRAP_LOOP_START_BARS,
  AUDIO_WRAP_RENDER_BARS,
  barSeconds,
  beatBurstFile,
  clickToneFile,
  clickToneFrequency,
  dipDbAround,
  dipToneFile,
  dipToneFrequency,
  loopSeconds,
  readWrapBeats,
  referenceBeatOnset,
  splitWrapOnsets,
  wrapBeatOnsets,
  wrapTimes,
} from "./audioWrapFixtures";
import { detectOnsets, maxStepAround } from "./onsetDetection";
import { expectedOnsets } from "./auditExpectations";

const SR = 48000;
const BPM = 120;
const FADE_SEC = 0.005;

/**
 * What the engine plays for the fixture's loop, without the engine: the file up to the loop end,
 * then the loop over and over. `fade` mimics the 0.0.179 jump crossfade (the old read released as
 * a linear fade-out tail, the new one faded in); without it, the pre-0.0.179 hard cut.
 */
function renderLoop(file: Float32Array, fade: boolean): Float32Array {
  const bar = barSeconds(BPM) * SR;
  const start = Math.round(AUDIO_WRAP_LOOP_START_BARS * bar);
  const end = Math.round(AUDIO_WRAP_LOOP_END_BARS * bar);
  const loop = end - start;
  const out = new Float32Array(Math.round(AUDIO_WRAP_RENDER_BARS * bar));
  out.set(file.subarray(0, end));
  const fadeLen = Math.round(FADE_SEC * SR);
  for (let at = end; at < out.length; at += loop) {
    for (let t = 0; t < loop && at + t < out.length; t++) {
      let v = file[start + t];
      if (fade && t < fadeLen) {
        const g = t / fadeLen;
        v = v * g + (file[end + t] ?? 0) * (1 - g);
      }
      out[at + t] = v;
    }
  }
  return out;
}

const judgedWraps = () => wrapTimes(BPM).filter((t) => t < AUDIO_WRAP_RENDER_BARS * barSeconds(BPM));

describe("audio loop-wrap geometry", () => {
  it("wraps at the end of every pass, the last in the tail", () => {
    expect(wrapTimes(120)).toEqual([6, 10, 14, 18]);
    expect(wrapBeatOnsets(120)).toEqual([6, 10, 14]);
    expect(referenceBeatOnset(120)).toBe(2);
  });

  it("judges every beat of the render but the ones a wrap lands on", () => {
    const judged = expectedOnsets("audio-wrap-onsets", 120);
    expect(judged).toHaveLength(AUDIO_WRAP_RENDER_BARS * 4 - 3);
    expect(judged).not.toContain(6);
    expect(judged).toContain(2); // pass 1's loop start: entered without a jump
    expect(judged).toContain(6.5);
  });

  it("puts the click tone half a period out, and the dip tone a whole number of periods, per loop", () => {
    for (const bpm of [120, 90, 124, 133, 97.3]) {
      const loop = loopSeconds(bpm);
      const click = clickToneFrequency(bpm) * loop;
      expect(click - Math.floor(click)).toBeCloseTo(0.5, 9);
      const dip = dipToneFrequency(bpm) * loop;
      expect(dip - Math.round(dip)).toBeCloseTo(0, 9);
    }
  });
});

describe("audio-wrap-click: the step at the wrap tells a cut from a crossfade", () => {
  const file = clickToneFile(SR, BPM);
  const steps = (out: Float32Array) => judgedWraps().map((t) => maxStepAround(out, SR, t));

  it("a hard cut steps from one peak to the opposite one", () => {
    expect(Math.min(...steps(renderLoop(file, false)))).toBeGreaterThan(0.4);
  });

  it("the crossfade steps a hundred times less: only its ramp corners show", () => {
    const crossfaded = Math.max(...steps(renderLoop(file, true)));
    expect(crossfaded).toBeLessThan(0.005);
    expect(crossfaded).toBeGreaterThan(maxStepAround(file, SR, 0.5));
  });
});

describe("audio-wrap-dip: a seamless loop dips only when crossfaded", () => {
  const file = dipToneFile(SR, BPM);

  it("the file itself has no step where it changes tone", () => {
    const changeAt = AUDIO_WRAP_LOOP_END_BARS * barSeconds(BPM);
    const higherToneOwn = maxStepAround(file, SR, changeAt + 0.1);
    expect(maxStepAround(file, SR, changeAt)).toBeLessThan(1.05 * higherToneOwn);
  });

  it("a hard cut neither steps nor dips", () => {
    const out = renderLoop(file, false);
    const own = maxStepAround(file, SR, 0.5);
    for (const t of judgedWraps()) {
      expect(maxStepAround(out, SR, t)).toBeLessThan(2 * own);
      expect(dipDbAround(out, SR, t)).toBeGreaterThan(-0.5);
    }
  });

  it("the crossfade of two unrelated tones dips about 3 dB", () => {
    const out = renderLoop(file, true);
    for (const t of judgedWraps()) {
      const dip = dipDbAround(out, SR, t);
      expect(dip).toBeLessThan(-2);
      expect(dip).toBeGreaterThan(-4.5);
    }
  });
});

describe("audio-wrap-onsets: the wrapped loop-start hit", () => {
  const file = beatBurstFile(SR, BPM);
  const read = (out: Float32Array) => {
    const onsets = detectOnsets(out, SR);
    const wraps = wrapBeatOnsets(BPM);
    const split = splitWrapOnsets(onsets, wraps, 0);
    return { split, beats: readWrapBeats(out, SR, split.nearWrap, wraps, referenceBeatOnset(BPM), 0) };
  };

  it("a hard cut plays it whole and on time, and the detector finds it", () => {
    const { beats, split } = read(renderLoop(file, false));
    for (const b of beats) {
      expect(b.levelDb).toBeCloseTo(0, 1);
      expect(Math.abs(b.shiftMs)).toBeLessThan(0.05);
      expect(b.detected).toBe(true);
    }
    expect(split.judged).toHaveLength(expectedOnsets("audio-wrap-onsets", BPM).length);
  });

  it("the crossfade's fade-in softens it and starts it later", () => {
    const { beats, split } = read(renderLoop(file, true));
    for (const b of beats) {
      expect(b.levelDb).toBeLessThan(-1);
      expect(b.levelDb).toBeGreaterThan(-6);
      expect(b.shiftMs).toBeGreaterThan(0.5);
      expect(b.shiftMs).toBeLessThan(5);
    }
    // The beats off the wrap are untouched and all still judged.
    expect(split.judged).toHaveLength(expectedOnsets("audio-wrap-onsets", BPM).length);
  });

  it("the same hit right after the loop end gives the whole hit back: the fades sum", () => {
    const withNextBar = new Float32Array(file);
    const end = Math.round(AUDIO_WRAP_LOOP_END_BARS * barSeconds(BPM) * SR);
    const start = Math.round(AUDIO_WRAP_LOOP_START_BARS * barSeconds(BPM) * SR);
    withNextBar.set(file.subarray(start, start + Math.round(0.06 * SR)), end);
    const { beats } = read(renderLoop(withNextBar, true));
    for (const b of beats) {
      expect(b.levelDb).toBeCloseTo(0, 1);
      expect(Math.abs(b.shiftMs)).toBeLessThan(0.05);
    }
  });
});
