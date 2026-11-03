import { describe, expect, it } from "vitest";
import { PATTERNS, PATTERN_PPQN, patternById } from "./patterns";

describe("patterns", () => {
  it("has the four patterns in order", () => {
    expect(PATTERNS.map((p) => p.id)).toEqual(["chords", "sixteenths", "melody", "bass"]);
  });

  it("keeps every note inside two bars with a positive duration", () => {
    for (const p of PATTERNS) {
      for (const n of p.notes) {
        expect(n.position).toBeGreaterThanOrEqual(0);
        expect(n.duration).toBeGreaterThan(0);
        expect(n.position + n.duration).toBeLessThanOrEqual(PATTERN_PPQN);
        expect(Number.isInteger(n.position)).toBe(true);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("chords: four triads, one per half bar, each held its half bar", () => {
    const notes = patternById("chords").notes;
    expect(notes).toHaveLength(12);
    const starts = [...new Set(notes.map((n) => n.position))];
    expect(starts).toEqual([0, 1920, 3840, 5760]);
    for (const n of notes) expect(n.duration).toBe(1920);
  });

  it("sixteenths: 32 notes on one pitch, each a thirty-second, velocities alternating 1 and 0.6", () => {
    const notes = patternById("sixteenths").notes;
    expect(notes).toHaveLength(32);
    expect(new Set(notes.map((n) => n.pitch)).size).toBe(1);
    expect(notes.map((n) => n.velocity).slice(0, 4)).toEqual([1, 0.6, 1, 0.6]);
    for (const n of notes) expect(n.duration).toBe(120);
  });

  it("melody: 16 eighths, bar two repeats bar one, velocities rise 0.4 to 1.0 within a bar", () => {
    const notes = patternById("melody").notes;
    expect(notes).toHaveLength(16);
    for (let i = 0; i < 8; i++) {
      expect(notes[i + 8].pitch).toBe(notes[i].pitch);
      expect(notes[i + 8].position).toBe(notes[i].position + 3840);
    }
    expect(notes[0].velocity).toBeCloseTo(0.4);
    expect(notes[7].velocity).toBeCloseTo(1.0);
  });

  it("bass: 8 quarter-note roots around C2 at velocity 0.9", () => {
    const notes = patternById("bass").notes;
    expect(notes).toHaveLength(8);
    for (const n of notes) {
      expect(n.duration).toBe(960);
      expect(n.velocity).toBe(0.9);
      expect(n.pitch).toBeGreaterThanOrEqual(36);
      expect(n.pitch).toBeLessThanOrEqual(47);
    }
  });
});
