import { describe, expect, it } from "vitest";
import { ArpeggioDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { walkHash, walkIndex } from "./arpeggioWalk";

const C_E_G = ["C", "E", "G"];
const modeOf = (name: string): number => {
  const mode = ArpeggioDeviceBoxAdapter.Modes.indexOf(name);
  if (mode < 0) throw new Error(`no mode ${name}`);
  return mode;
};
const notes = (name: string, length = 6): string => Array.from({ length }, (_, step) => C_E_G[walkIndex(modeOf(name), 0, step, 3)]).join(" ");

describe("walkIndex", () => {
  // the manual's table, "With C, E, G held" (arpeggio.md, "1. Walk")
  it.each([
    ["Up", "C E G C E G"],
    ["Down", "G E C G E C"],
    ["UpDown", "C E G E C E"],
    ["DownUp", "G E C E G E"],
    ["Up & Down", "C E G G E C"],
    ["Down & Up", "G E C C E G"],
    ["Converge", "C G E C G E"],
    ["Diverge", "E G C E G C"],
    ["Con & Diverge", "C G E G C G"],
    ["Pinky Up", "C G E G C G"],
    ["Pinky UpDown", "C G E G C G"],
    ["Thumb Up", "C E C G C E"],
    ["Thumb UpDown", "C E C G C E"],
  ])("%s plays %s, as the manual's table", (name, expected) => {
    expect(notes(name)).toBe(expected);
  });

  it("every mode of the adapter's list stays inside the pool, and a pool of one has one position", () => {
    ArpeggioDeviceBoxAdapter.Modes.forEach((_, mode) => {
      for (const count of [1, 2, 3, 7, 15]) {
        for (let step = 0; step < 200; step++) {
          const index = walkIndex(mode, 12345, step, count);
          expect(Number.isInteger(index), `${mode} ${count} ${step}`).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(count);
        }
      }
    });
  });

  it("Random Other never plays the same position twice in a row", () => {
    for (const count of [2, 3, 5, 12]) {
      for (let step = 1; step < 300; step++) {
        expect(walkIndex(modeOf("Random Other"), 7, step, count), `${count} ${step}`).not.toBe(walkIndex(modeOf("Random Other"), 7, step - 1, count));
      }
    }
  });

  it("Shuffle plays every position once per cycle, in a new order each cycle", () => {
    const cycle = (at: number) => Array.from({ length: 6 }, (_, k) => walkIndex(modeOf("Shuffle"), 3, at * 6 + k, 6));
    for (let at = 0; at < 10; at++) expect([...cycle(at)].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(Array.from({ length: 10 }, (_, at) => cycle(at).join())).size).toBeGreaterThan(1);
  });

  it("Random Once repeats one order", () => {
    const pass = (at: number) => Array.from({ length: 6 }, (_, k) => walkIndex(modeOf("Random Once"), 3, at * 6 + k, 6)).join();
    expect(pass(1)).toBe(pass(0));
    expect(pass(5)).toBe(pass(0));
  });

  it("Walk moves at most one position per step and climbs two per block of eight", () => {
    const count = 64;
    const at = (step: number) => walkIndex(modeOf("Walk"), 9, step, count);
    const apart = (a: number, b: number) => Math.min(Math.abs(a - b), count - Math.abs(a - b));
    for (let step = 1; step < 40; step++) expect(apart(at(step), at(step - 1))).toBeLessThanOrEqual(1);
    expect(at(8)).toBe(2);
    expect(at(16)).toBe(4);
  });

  it("a random mode depends on its seed", () => {
    const random = (seed: number) => Array.from({ length: 32 }, (_, step) => walkIndex(modeOf("Random"), seed, step, 12)).join();
    expect(random(1)).not.toBe(random(2));
    expect(random(1)).toBe(random(1));
  });
});

describe("walkHash", () => {
  it("gives an unsigned 32-bit value and takes a negative step as its two's complement", () => {
    for (const step of [0, 1, -1, 1000, -1000]) {
      const value = walkHash(999999, step, 100);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
    expect(walkHash(1, -1, 100)).not.toBe(walkHash(1, 1, 100));
  });
});
