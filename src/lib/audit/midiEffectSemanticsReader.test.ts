import { describe, expect, it } from "vitest";
import {
  calibrationFrom, channelPeak, frequencyToPitch, msToFrame, readFigureAt, readNotes, readWindow, refinedPeak, sineSample, toFigure, READER_DEFAULTS
} from "./midiEffectSemanticsReader";

const RATE = 48000;
const hzOf = (pitch: number, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12);
/** A Nano-shaped note: a sine at `hz`, amplitude `level`, a 1 ms squared attack, a 1 ms squared release, `ms` long, at `atMs`. */
function tone(out: Float32Array, atMs: number, ms: number, hz: number, level: number, rate: number = RATE): void {
  const start = Math.round(atMs * rate / 1000);
  const body = Math.round(ms * rate / 1000);
  const ramp = Math.round(rate / 1000);
  for (let i = 0; i < body + ramp && start + i < out.length; i++) {
    const env = i < ramp ? i / ramp : i < body ? 1 : 1 - (i - body) / ramp;
    out[start + i] += level * env * env * Math.sin(2 * Math.PI * hz * i / rate);
  }
}

describe("readNotes", () => {
  it("finds each note once with its onset, end and peak", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 60, hzOf(60), 0.7); tone(out, 300, 60, hzOf(64), 0.7); tone(out, 500, 60, hzOf(67), 0.35);
    const notes = readNotes(out, RATE);
    expect(notes.length).toBe(3);
    expect(notes[0].onsetFrame).toBeGreaterThanOrEqual(4800);
    expect(notes[0].onsetFrame).toBeLessThan(4800 + 48);           // within the 1 ms attack
    expect(notes[0].endFrame).toBeGreaterThan(4800 + Math.round(0.06 * RATE) - 48);
    expect(notes[2].peak / notes[0].peak).toBeCloseTo(0.5, 2);
  });
  it("reads pitch within 0.5 cents at 65 Hz, 261.6 Hz, 4186 Hz and, at 44.1 kHz, 5274 Hz, with cents", () => {
    for (const [rate, pitch, cents] of [[RATE, 36, 0], [RATE, 60, 12.5], [RATE, 108, -45], [44100, 112, 0], [44100, 112, 12.5]] as const) {
      const out = new Float32Array(rate);
      tone(out, 100, 200, hzOf(pitch, cents), 0.7, rate);
      const [note] = readNotes(out, rate);
      const read = frequencyToPitch(note.frequencyHz!);
      expect(read.pitch, `${rate} Hz pitch ${pitch}`).toBe(pitch);
      expect(Math.abs(read.cents - cents), `${rate} Hz pitch ${pitch}`).toBeLessThan(0.5);
      // linear interpolation of a crossing leaves a period spread that grows as the cycle shortens: 1.67 cents at 11.5
      // frames per cycle (4186 Hz at 48 kHz); at 8.4 (5274 Hz at 44.1 kHz) it must still sit under the unstable threshold
      expect(note.jitterCents!, `${rate} Hz pitch ${pitch}`).toBeLessThan(pitch === 112 ? 10 : pitch === 108 ? 2 : 1);
    }
  });
  it("a quiet note is read: velocity 0.02 lands within 0.002 and its onset within 1 ms", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 60, hzOf(60), 0.7); tone(out, 300, 60, hzOf(60), 0.7 * 0.02);
    const notes = readNotes(out, RATE);
    expect(notes.length).toBe(2);
    expect(Math.abs(notes[1].peak / notes[0].peak - 0.02)).toBeLessThan(0.002);
    expect(Math.abs(notes[1].onsetFrame - 0.3 * RATE)).toBeLessThan(48);
  });
  it("two overlapping pitches read as one unstable note, a note too short for three cycles has no pitch", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 100, hzOf(60), 0.5); tone(out, 150, 100, hzOf(64), 0.5);
    const [note] = readNotes(out, RATE);
    expect(note.jitterCents!).toBeGreaterThan(10);
    const short = new Float32Array(RATE);
    tone(short, 100, 8, hzOf(36), 0.7);                              // 36.7 ms per three cycles at 65 Hz
    expect(readNotes(short, RATE)[0].frequencyHz).toBeNull();
  });
  it("readWindow reads the second of two abutting notes cleanly: pitch and velocity of B, not a blend with A's release", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 100, hzOf(60), 0.7); tone(out, 200, 100, hzOf(64), 0.35);   // B starts where A's 1 ms release starts
    expect(readNotes(out, RATE).length).toBe(1);                              // the detector sees one run
    const b = readWindow(out, RATE, Math.round(0.2 * RATE), Math.round(0.3 * RATE));
    expect(frequencyToPitch(b.frequencyHz!).pitch).toBe(64);
    expect(Math.abs(b.peak / 0.7 - 0.5)).toBeLessThan(0.002);
    expect(b.jitterCents!).toBeLessThan(1);
  });
  it("a sampled crest at high pitch does not bias velocity: half the level reads 0.5 within 0.002", () => {
    for (const pitch of [96, 100, 103, 105, 106, 107, 107.3, 107.6, 107.9, 108].flatMap(p => [p, p + 0.17, p + 0.41])) {
      const out = new Float32Array(RATE);
      tone(out, 100, 100, hzOf(60), 0.7); tone(out, 300, 100, hzOf(pitch), 0.35);
      const [low, high] = readNotes(out, RATE);
      expect(Math.abs(high.peak / low.peak - 0.5), `readNotes pitch ${pitch}`).toBeLessThan(0.002);
      const window = readWindow(out, RATE, high.onsetFrame, high.endFrame);
      expect(Math.abs(window.peak / low.peak - 0.5), `readWindow pitch ${pitch}`).toBeLessThan(0.002);
    }
  });
  it("the same at 44.1 kHz up to pitch 112, about 8.4 frames per cycle", () => {
    const rate = 44100;
    for (const pitch of [108, 110, 111, 112].flatMap(p => [p, p + 0.17, p + 0.41])) {
      const out = new Float32Array(rate);
      tone(out, 100, 100, hzOf(60), 0.7, rate); tone(out, 300, 100, hzOf(pitch), 0.35, rate);
      const [low, high] = readNotes(out, rate);
      expect(Math.abs(high.peak / low.peak - 0.5), `readNotes pitch ${pitch}`).toBeLessThan(0.002);
      const window = readWindow(out, rate, high.onsetFrame, high.endFrame);
      expect(Math.abs(window.peak / low.peak - 0.5), `readWindow pitch ${pitch}`).toBeLessThan(0.002);
    }
  });
  it("returns nothing for silence and does not split a sine at its zero crossings", () => {
    expect(readNotes(new Float32Array(RATE), RATE)).toEqual([]);
    const out = new Float32Array(RATE); tone(out, 100, 500, hzOf(36), 0.7);
    expect(readNotes(out, RATE, { ...READER_DEFAULTS }).length).toBe(1);
  });
  it("reads two 243 ms notes of one pitch 4.8 ms apart as two notes", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 243, hzOf(60), 0.7); tone(out, 348.8, 243, hzOf(60), 0.7);
    expect(readNotes(out, RATE).length).toBe(2);
  });
});

describe("refinedPeak", () => {
  it("refines a crest inside the window to the parabola's vertex", () => {
    const crest = Float32Array.from([0, 0.5, 0.9, 0.8, 0]);
    expect(refinedPeak(crest, 0, 4)).toBeCloseTo(0.9 - (0.5 - 0.8) ** 2 / (8 * (0.5 - 1.8 + 0.8)), 6);
  });
  it("a max on the window's edge next to a larger sample outside it stays within the window's own values", () => {
    // unrefined, the parabola through 0.5, 0.9 and the outside 1.29 puts its vertex at 8.7
    const samples = Float32Array.from([0, 0.1, 0.5, 0.9, 1.29, 1.3]);
    const peak = refinedPeak(samples, 1, 3);
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-7);
    expect(peak).toBeGreaterThanOrEqual(0.9 - 1e-7);
    expect(refinedPeak(samples, 3, 5)).toBeLessThanOrEqual(1.3 + 1e-6);
  });
});

describe("calibration and windows", () => {
  it("calibrationFrom takes the loudest note's peak and the first onset's frames past its pulse", () => {
    const out = new Float32Array(RATE);
    tone(out, 500, 60, hzOf(60), 0.7); tone(out, 700, 60, hzOf(60), 0.42);
    const notes = readNotes(out, RATE);
    const calibration = calibrationFrom(notes, RATE, 0.5, 2);
    expect(calibration.referencePeak).toBe(notes[0]!.peak);
    expect(calibration.instrumentOffsetFrames).toBe(notes[0]!.onsetFrame - 24000);
    expect(calibration.instrumentOffsetFrames).toBeGreaterThan(0);
    expect(() => calibrationFrom(notes, RATE, 0.5, 32)).toThrow(/read 2 notes, expected 32/);
  });
  it("msToFrame rounds the time to a frame and adds the instrument offset", () => {
    expect(msToFrame(100, RATE, 6)).toBe(4806);
    expect(msToFrame(100.01, 44100, 6)).toBe(4416);
  });
  it("readFigureAt reads a window given in ms with the calibration, as toFigure would", () => {
    const out = new Float32Array(RATE);
    tone(out, 200, 100, hzOf(64), 0.35);
    const calibration = { referencePeak: 0.7, instrumentOffsetFrames: 0 };
    const figure = readFigureAt(out, RATE, 200, 300, calibration);
    expect(figure.pitch).toBe(64);
    expect(Math.abs(figure.velocity - 0.5)).toBeLessThan(0.002);
    expect(figure.onsetMs).toBeCloseTo(200, 6);
    expect(figure.endMs).toBeCloseTo(300, 6);
  });
  it("channelPeak is the largest absolute sample, 0 on silence", () => {
    expect(channelPeak(new Float32Array(16))).toBe(0);
    expect(channelPeak(Float32Array.from([0.1, -0.6, 0.3]))).toBeCloseTo(0.6, 6);
  });
});

describe("sineSample / frequencyToPitch / toFigure", () => {
  it("sineSample is unit amplitude at the asked frequency", () => {
    const s = sineSample(RATE, 1, 440);
    expect(s.length).toBe(RATE);
    expect(frequencyToPitch(readNotes(s, RATE)[0].frequencyHz!).pitch).toBe(69);
  });
  it("frequencyToPitch maps 440 to 69/0 and the half-semitone tie up to 70/-50", () => {
    expect(frequencyToPitch(440)).toEqual({ pitch: 69, cents: 0 });
    const tie = frequencyToPitch(440 * 2 ** (0.5 / 12));
    expect(tie.pitch).toBe(70);
    expect(tie.cents).toBeCloseTo(-50, 3);
  });
  it("toFigure nets the instrument offset and normalises the peak", () => {
    const figure = toFigure({ onsetFrame: 4812, endFrame: 7692, peak: 0.35, frequencyHz: 261.6, jitterCents: 0.1, cycles: 10 }, RATE, 0.7, 12);
    expect(figure.onsetMs).toBeCloseTo(100, 3);
    expect(figure.velocity).toBeCloseTo(0.5, 6);
    expect(figure.pitch).toBe(60);
  });
});
