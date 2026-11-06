import { describe, expect, it } from "vitest";
import { ArpeggioDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { walkHash, walkIndex } from "./arpeggioWalk";

const C_E_G = ["C", "E", "G"];
const modeOf = (name: string): number => {
  const mode = ArpeggioDeviceBoxAdapter.Modes.indexOf(name);
  if (mode < 0) throw new Error(`no mode ${name}`);
  return mode;
};
/** [mode, seed, pool, the first 32 positions], from the crate's own `hash` and `walk_index` compiled with rustc at the release's tag. */
const CRATE_VECTORS: readonly (readonly [number, number, number, string])[] = [
  [6, 0, 4, "0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2"],
  [6, 999999, 7, "0 6 1 5 2 4 3 0 6 1 5 2 4 3 0 6 1 5 2 4 3 0 6 1 5 2 4 3 0 6 1 5"],
  [7, 0, 4, "2 1 3 0 2 1 3 0 2 1 3 0 2 1 3 0 2 1 3 0 2 1 3 0 2 1 3 0 2 1 3 0"],
  [7, 999999, 7, "3 4 2 5 1 6 0 3 4 2 5 1 6 0 3 4 2 5 1 6 0 3 4 2 5 1 6 0 3 4 2 5"],
  [8, 0, 4, "0 3 1 2 1 3 0 3 1 2 1 3 0 3 1 2 1 3 0 3 1 2 1 3 0 3 1 2 1 3 0 3"],
  [8, 999999, 7, "0 6 1 5 2 4 3 4 2 5 1 6 0 6 1 5 2 4 3 4 2 5 1 6 0 6 1 5 2 4 3 4"],
  [9, 0, 4, "0 3 1 3 2 3 0 3 1 3 2 3 0 3 1 3 2 3 0 3 1 3 2 3 0 3 1 3 2 3 0 3"],
  [9, 999999, 7, "0 6 1 6 2 6 3 6 4 6 5 6 0 6 1 6 2 6 3 6 4 6 5 6 0 6 1 6 2 6 3 6"],
  [10, 0, 4, "0 3 1 3 2 3 1 3 0 3 1 3 2 3 1 3 0 3 1 3 2 3 1 3 0 3 1 3 2 3 1 3"],
  [10, 999999, 7, "0 6 1 6 2 6 3 6 4 6 5 6 4 6 3 6 2 6 1 6 0 6 1 6 2 6 3 6 4 6 5 6"],
  [11, 0, 4, "0 1 0 2 0 3 0 1 0 2 0 3 0 1 0 2 0 3 0 1 0 2 0 3 0 1 0 2 0 3 0 1"],
  [11, 999999, 7, "0 1 0 2 0 3 0 4 0 5 0 6 0 1 0 2 0 3 0 4 0 5 0 6 0 1 0 2 0 3 0 4"],
  [12, 0, 4, "0 1 0 2 0 3 0 2 0 1 0 2 0 3 0 2 0 1 0 2 0 3 0 2 0 1 0 2 0 3 0 2"],
  [12, 999999, 7, "0 1 0 2 0 3 0 4 0 5 0 6 0 5 0 4 0 3 0 2 0 1 0 2 0 3 0 4 0 5 0 6"],
  [13, 0, 4, "3 2 3 1 2 3 0 0 2 2 0 2 3 0 1 0 1 0 3 0 2 0 3 1 1 3 0 2 3 3 2 2"],
  [13, 999999, 7, "3 3 5 6 1 0 5 0 6 6 0 6 2 1 5 0 5 1 5 4 5 3 1 3 6 5 4 1 3 5 3 0"],
  [14, 0, 4, "2 1 3 0 1 0 1 3 0 2 1 3 2 1 0 1 2 0 3 1 0 1 3 1 0 3 1 0 3 2 1 3"],
  [14, 999999, 7, "0 1 6 1 6 5 6 2 4 2 6 3 0 3 1 4 2 3 5 1 6 0 2 6 4 6 1 5 2 1 6 1"],
  [15, 0, 4, "3 2 0 1 2 1 0 3 2 1 3 0 2 1 3 0 1 2 0 3 2 0 1 3 2 1 3 0 0 1 2 3"],
  [15, 999999, 7, "6 4 2 0 5 3 1 2 6 4 0 5 3 1 6 0 4 5 2 1 3 3 6 5 1 0 4 2 6 3 2 0"],
  [16, 0, 4, "1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3 1 2 0 3"],
  [16, 999999, 7, "1 2 5 4 6 3 0 1 2 5 4 6 3 0 1 2 5 4 6 3 0 1 2 5 4 6 3 0 1 2 5 4"],
  [17, 0, 4, "0 1 2 1 2 3 3 2 2 3 0 0 3 2 3 3 0 1 1 1 2 3 0 3 2 3 3 2 2 3 2 3"],
  [17, 999999, 7, "0 1 1 1 0 6 0 1 2 1 1 2 1 2 3 4 4 5 5 4 5 5 6 0 6 6 0 6 0 6 0 0"],
  [13, 12345, 12, "9 4 3 7 2 10 7 8 5 11 8 10 9 9 8 1 4 9 11 2 1 7 1 2 11 1 10 9 3 2 0 7"],
  [14, 12345, 12, "4 3 1 9 1 3 7 3 11 6 2 7 1 10 7 9 6 10 8 3 6 4 3 4 10 9 7 2 6 10 6 10"],
  [15, 12345, 12, "10 9 1 8 0 6 5 3 2 7 4 11 7 5 6 4 2 11 10 1 0 3 9 8 5 4 6 1 2 9 11 8"],
  [16, 12345, 12, "2 9 4 3 8 11 7 10 0 6 1 5 2 9 4 3 8 11 7 10 0 6 1 5 2 9 4 3 8 11 7 10"],
  [17, 12345, 12, "0 1 2 2 2 3 2 1 2 3 3 3 2 1 2 3 4 4 3 4 3 4 4 5 6 7 8 8 8 9 8 7"],
];
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

  it.each(CRATE_VECTORS)("mode %i, seed %i, a pool of %i plays as the crate's walk_index does", (mode, seed, count, expected) => {
    expect(Array.from({ length: 32 }, (_, step) => walkIndex(mode, seed, step, count)).join(" ")).toBe(expected);
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

  it("Walk plays four moves up, two stays and two down per block of eight, in a seeded order", () => {
    const count = 64;
    const at = (seed: number, step: number) => walkIndex(modeOf("Walk"), seed, step, count);
    const moves = (seed: number, block: number): number[] => Array.from({ length: 8 }, (_, k) => {
      const move = at(seed, block * 8 + k + 1) - at(seed, block * 8 + k);
      return move > 1 ? move - count : move < -1 ? move + count : move;
    });
    for (let block = 0; block < 6; block++) {
      const sorted = [...moves(9, block)].sort((a, b) => a - b);
      expect(sorted).toEqual([-1, -1, 0, 0, 1, 1, 1, 1]);
    }
    expect(new Set([0, 1, 2, 3, 4, 5].map((block) => moves(9, block).join())).size).toBeGreaterThan(1);
  });

  it.each(["Random", "Random Other", "Shuffle", "Random Once", "Walk"])("%s depends on its seed", (name) => {
    const walk = (seed: number) => Array.from({ length: 64 }, (_, step) => walkIndex(modeOf(name), seed, step, 12)).join();
    expect(walk(1)).not.toBe(walk(2));
    expect(walk(1)).toBe(walk(1));
  });
});

describe("walkHash", () => {
  // from the crate's own `hash`, compiled with rustc at the release's tag
  it.each([[0, 0, 1, 1753549511], [999999, -1, 100, 3803695802], [1, -1, 100, 1114343384], [7, 1000, 4, 4125398866]])("hash(%i, %i, %i) is %i", (seed, step, salt, expected) => {
    expect(walkHash(seed, step, salt)).toBe(expected);
  });

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
