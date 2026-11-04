import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { samplerFixture } from "@/lib/testing/boxGraphFixtures";
import {
  applyPlayModeSettings, DEFAULT_SETTINGS, instrumentOffsetFrames, judgePlayModeRow, MONO_FADE_BAND_MS, MONO_FADE_MS, noteOnsetFrame,
  overlapFigures, panLaw, PLAY_MODE_BPM, PLAY_MODE_REGION_POSITION_PPQN, PLAY_MODE_ROWS, PLAY_MODE_SAMPLE_HZ, renderSeconds, resolveRows,
  toneEnvelope, type PlayModeRow,
} from "./nanoPlayModes";

const RATE = 48000;
const LENGTH = Math.round(renderSeconds() * RATE);
const row = (id: string): PlayModeRow => {
  const found = PLAY_MODE_ROWS.find((r) => r.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const ms = (n: number): number => Math.round((n * RATE) / 1000);

/** A sine of `hz` at `amplitude`, from `from` for `frames`, with a 1 ms squared attack and release, added into `into`. */
function tone(into: Float32Array, hz: number, from: number, frames: number, amplitude = 0.8, gain?: (n: number) => number): void {
  const edge = ms(1);
  for (let n = 0; n < frames && from + n < into.length; n++) {
    const env = Math.min(1, n / edge, (frames - n) / edge) ** 2;
    into[from + n] += amplitude * env * (gain === undefined ? 1 : gain(n)) * Math.sin((2 * Math.PI * hz * n) / RATE);
  }
}

/** The crate's fast release as the voice applies it: a linear level ramp over 5 ms, squared. */
const squaredFade = (at: number) => (n: number): number => (n < at ? 1 : Math.max(0, 1 - (n - at) / ms(MONO_FADE_MS)) ** 2);

const A = noteOnsetFrame(row("poly-overlap").notes[0], RATE);
const B = noteOnsetFrame(row("poly-overlap").notes[1], RATE);

function overlapRender(firstKeepsSounding: boolean): Float32Array[] {
  const left = new Float32Array(LENGTH);
  tone(left, 440, A, ms(500), 0.8, firstKeepsSounding ? undefined : squaredFade(B - A));
  tone(left, 880, B, ms(250));
  return [left, Float32Array.from(left)];
}

describe("the rows", () => {
  it("have distinct ids and keep every note inside the region", () => {
    expect(new Set(PLAY_MODE_ROWS.map((r) => r.id)).size).toBe(PLAY_MODE_ROWS.length);
    for (const r of PLAY_MODE_ROWS) for (const note of r.notes) expect(note.position + note.duration).toBeLessThanOrEqual(PPQN.Bar);
  });

  it("resolve from ?row=", () => {
    expect(resolveRows(null)).toBe(PLAY_MODE_ROWS);
    expect(resolveRows("all")).toBe(PLAY_MODE_ROWS);
    expect(resolveRows("mono-cut")).toEqual([row("mono-cut")]);
    expect(() => resolveRows("stereo")).toThrow("invalid ?row=");
  });

  it("place the region at bar 1 and render past a one-shot's whole sample", () => {
    expect(PPQN.pulsesToSeconds(PLAY_MODE_REGION_POSITION_PPQN, PLAY_MODE_BPM)).toBe(2);
    expect(renderSeconds()).toBeGreaterThanOrEqual(2 + 1 + 0.25);
  });
});

describe("panLaw", () => {
  it("keeps the near side at 1 and turns the far side down linearly", () => {
    expect(panLaw(0)).toEqual({ left: 1, right: 1 });
    expect(panLaw(-1)).toEqual({ left: 1, right: 0 });
    expect(panLaw(0.5)).toEqual({ left: 0.5, right: 1 });
  });
});

describe("applyPlayModeSettings", () => {
  it("writes every field the row names", () => {
    const { box, project } = samplerFixture();
    project.editing.modify(() => applyPlayModeSettings(box, { polyphone: false, oneShot: true, fixedPitch: true, loop: true, octave: 1, panning: -0.5 }));
    expect(box.polyphone.getValue()).toBe(false);
    expect(box.oneShot.getValue()).toBe(true);
    expect(box.fixedPitch.getValue()).toBe(true);
    expect(box.loop.getValue()).toBe(true);
    expect(box.octave.getValue()).toBe(1);
    expect(box.panning.getValue()).toBeCloseTo(-0.5, 6);
    project.editing.modify(() => applyPlayModeSettings(box, DEFAULT_SETTINGS));
    expect(box.polyphone.getValue()).toBe(true);
    expect(box.panning.getValue()).toBe(0);
  });
});

describe("toneEnvelope", () => {
  it("reads a tone's amplitude and ignores the octave above it", () => {
    const samples = new Float32Array(RATE);
    tone(samples, 440, 0, RATE, 0.5);
    const alone = toneEnvelope(samples, RATE, 440);
    expect(alone[ms(100)]).toBeCloseTo(0.5, 2);
    tone(samples, 880, 0, RATE, 0.5);
    const withOctave = toneEnvelope(samples, RATE, 440);
    expect(withOctave[ms(100)]).toBeCloseTo(0.5, 2);
    expect(Math.abs(withOctave[ms(200)] - alone[ms(200)])).toBeLessThan(0.005);
  });

  it("reads silence as silence", () => {
    expect(Math.max(...toneEnvelope(new Float32Array(4800), RATE, 440))).toBe(0);
  });
});

describe("overlapFigures", () => {
  it("reads a kept note as level and a faded one as gone after the fade", () => {
    const kept = overlapFigures(overlapRender(true)[0], RATE, PLAY_MODE_SAMPLE_HZ, B);
    expect(kept.beforeDb).toBeCloseTo(20 * Math.log10(0.8), 0);
    expect(Math.abs(kept.afterDb)).toBeLessThan(0.5);
    expect(kept.cut40Ms).toBeNull();
    const cut = overlapFigures(overlapRender(false)[0], RATE, PLAY_MODE_SAMPLE_HZ, B);
    expect(cut.afterDb).toBeLessThan(-40);
    expect(cut.cut40Ms).not.toBeNull();
    expect(cut.cut40Ms!).toBeGreaterThanOrEqual(MONO_FADE_BAND_MS[0]);
    expect(cut.cut40Ms!).toBeLessThanOrEqual(MONO_FADE_BAND_MS[1]);
  });
});

describe("judgePlayModeRow", () => {
  it("judges the overlap rows against their expectation", () => {
    expect(judgePlayModeRow(row("poly-overlap"), overlapRender(true), RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("mono-cut"), overlapRender(false), RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("poly-overlap"), overlapRender(false), RATE, 0).status).toBe("investigate");
    expect(judgePlayModeRow(row("mono-cut"), overlapRender(true), RATE, 0).status).toBe("investigate");
  });

  it("judges a note's length", () => {
    const eighth = new Float32Array(LENGTH);
    tone(eighth, 440, A, ms(250));
    const whole = new Float32Array(LENGTH);
    tone(whole, 440, A, ms(1000));
    expect(judgePlayModeRow(row("one-shot-off"), [eighth, eighth], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("one-shot"), [whole, whole], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("one-shot-loop"), [eighth, eighth], RATE, 0).status).toBe("as-expected");
    const wrong = judgePlayModeRow(row("one-shot"), [eighth, eighth], RATE, 0);
    expect(wrong.status).toBe("investigate");
    expect(wrong.figure).toContain("expected 1000");
  });

  it("judges the notes' pitches", () => {
    const two = new Float32Array(LENGTH);
    tone(two, 440, A, ms(500));
    tone(two, 440 * 2 ** (7 / 12), A + ms(1000), ms(500));
    const same = new Float32Array(LENGTH);
    tone(same, 440, A, ms(500));
    tone(same, 440, A + ms(1000), ms(500));
    const up = new Float32Array(LENGTH);
    tone(up, 880, A, ms(500));
    tone(up, 880, A + ms(1000), ms(500));
    expect(judgePlayModeRow(row("fixed-off"), [two, two], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("fixed-pitch"), [same, same], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("fixed-pitch-octave"), [up, up], RATE, 0).status).toBe("as-expected");
    const wrong = judgePlayModeRow(row("fixed-off"), [same, same], RATE, 0);
    expect(wrong.status).toBe("investigate");
    expect(wrong.figure).toContain("440 Hz (expected 659.3");
  });

  it("judges the channels' balance", () => {
    const full = new Float32Array(LENGTH);
    tone(full, 440, A, ms(250), 0.8);
    const half = new Float32Array(LENGTH);
    tone(half, 440, A, ms(250), 0.4);
    const silent = new Float32Array(LENGTH);
    expect(judgePlayModeRow(row("pan-centre"), [full, full], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("pan-left"), [full, silent], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("pan-half-right"), [half, full], RATE, 0).status).toBe("as-expected");
    expect(judgePlayModeRow(row("pan-half-right"), [full, full], RATE, 0).status).toBe("investigate");
    expect(judgePlayModeRow(row("pan-centre"), [silent, silent], RATE, 0).status).toBe("investigate");
  });

  it("reads the sampler's offset from the first note", () => {
    const late = new Float32Array(LENGTH);
    tone(late, 440, A + 7, ms(250));
    // the fixture's own 1 ms attack crosses the reader's threshold a few frames in
    const read = instrumentOffsetFrames(row("one-shot-off"), late, RATE);
    expect(read).toBeGreaterThanOrEqual(7);
    expect(read).toBeLessThan(7 + ms(1));
    expect(instrumentOffsetFrames(row("one-shot-off"), new Float32Array(LENGTH), RATE)).toBeNull();
  });
});
