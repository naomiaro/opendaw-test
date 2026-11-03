import { describe, expect, it } from "vitest";
import { frequencyToPitch, readNotes, readWindow, sineSample, toFigure, READER_DEFAULTS } from "./midiEffectSemanticsReader";

const RATE = 48000;
const hzOf = (pitch: number, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12);
/** A Nano-shaped note: a sine at `hz`, amplitude `level`, a 1 ms squared attack, a 1 ms squared release, `ms` long, at `atMs`. */
function tone(out: Float32Array, atMs: number, ms: number, hz: number, level: number): void {
  const start = Math.round(atMs * RATE / 1000);
  const body = Math.round(ms * RATE / 1000);
  const ramp = Math.round(RATE / 1000);
  for (let i = 0; i < body + ramp && start + i < out.length; i++) {
    const env = i < ramp ? i / ramp : i < body ? 1 : 1 - (i - body) / ramp;
    out[start + i] += level * env * env * Math.sin(2 * Math.PI * hz * i / RATE);
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
  it("reads pitch within 0.5 cents at 65 Hz, 261.6 Hz and 4186 Hz, with cents", () => {
    for (const [pitch, cents] of [[36, 0], [60, 12.5], [108, -45]] as const) {
      const out = new Float32Array(RATE);
      tone(out, 100, 200, hzOf(pitch, cents), 0.7);
      const [note] = readNotes(out, RATE);
      const read = frequencyToPitch(note.frequencyHz!);
      expect(read.pitch).toBe(pitch);
      expect(Math.abs(read.cents - cents)).toBeLessThan(0.5);
      // linear interpolation of a crossing at 11.5 frames per cycle (4186 Hz) leaves 1.67 cents of period spread
      expect(note.jitterCents!).toBeLessThan(pitch === 108 ? 2 : 1);
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
  it("returns nothing for silence and does not split a sine at its zero crossings", () => {
    expect(readNotes(new Float32Array(RATE), RATE)).toEqual([]);
    const out = new Float32Array(RATE); tone(out, 100, 500, hzOf(36), 0.7);
    expect(readNotes(out, RATE, { ...READER_DEFAULTS, gapMs: 5 }).length).toBe(1);
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
