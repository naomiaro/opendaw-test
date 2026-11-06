import { describe, expect, it } from "vitest";
import { buildRows, expectedLatencyFrames, setPositionStart } from "./exportRegressionRows.ts";

describe("exportRegressionRows", () => {
  it("gives the latency figures the crates and the #530 note read", () => {
    const table = [["none", 0, 0], ["autotune-muted", 1280, 1280], ["compressor-track", 240, 220], ["compressor-muted", 240, 220],
      ["maximizer-muted", 240, 221], ["fold-muted", 15, 15], ["script-10ms-muted", 480, 441], ["script-150ms-parallel", 4800, 4410],
      ["compressor-bus", 240, 220], ["compressor-aux", 240, 220], ["several", 255, 235]] as const;
    for (const [id, at48, at44] of table) {
      expect(expectedLatencyFrames(id, 48000)).toBe(at48);
      expect(expectedLatencyFrames(id, 44100)).toBe(at44);
    }
  });
  it("uses ids the verify sink accepts, each once", () => {
    const rows = buildRows(48000);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    rows.forEach((r) => expect(r.id).toMatch(/^[a-z0-9-]+$/));
  });
  it("crosses every core path with every latency case", () => {
    const rows = buildRows(44100).filter((r) => r.group === "core");
    expect(rows.length).toBe(11 * 10);
  });
  it("points every reference at a row that exists and renders first", () => {
    for (const rate of [48000, 44100]) {
      const seen = new Set<string>();
      for (const r of buildRows(rate)) {
        if (r.referenceId !== null) expect(seen.has(r.referenceId), r.id).toBe(true);
        if (r.noLatencyReferenceId !== null) expect(seen.has(r.noLatencyReferenceId), r.id).toBe(true);
        seen.add(r.id);
      }
    }
  });
  it("drives the default master Maximizer over its limit on the render paths", () => {
    const rows = buildRows(48000).filter((r) => r.group === "master" && r.masterMaximizer);
    expect(rows.length).toBe(2 * 9);
    rows.forEach((r) => expect(r.signal, r.id).toBe("hot"));
    expect(new Set(rows.map((r) => r.path)).size).toBe(9);
    expect(rows.filter((r) => r.path === "step-one").every((r) => r.invariants.includes("differs-from-reference"))).toBe(true);
    rows.forEach((r) => expect(r.invariants, r.id).not.toContain("no-jump"));
  });
  it("never gives a resampled row an exact-frame invariant", () => {
    buildRows(44100).filter((r) => r.sourceRate !== 44100)
      .forEach((r) => expect(r.invariants, r.id).not.toContain("impulse-on-computed-frame"));
  });
  it("holds the one-frame axis the note asks for", () => {
    const axis = buildRows(44100).filter((r) => r.group === "one-frame");
    expect(new Set(axis.map((r) => r.sourceRate))).toEqual(new Set([48000, 44100]));
    expect(new Set(axis.map((r) => r.seconds))).toEqual(new Set([0.9, 2, 4]));
    expect(new Set(axis.map((r) => r.bpm))).toEqual(new Set([120, 137]));
  });
  it("gives every row proves-something and every row but the disabled controls latency-as-expected", () => {
    for (const r of buildRows(48000)) {
      expect(r.invariants, r.id).toContain("proves-something");
      if (r.id.startsWith("control-disabled-")) expect(r.invariants, r.id).not.toContain("latency-as-expected");
      else expect(r.invariants, r.id).toContain("latency-as-expected");
    }
  });
  it("repeats every none and compressor-track row", () => {
    for (const r of buildRows(48000)) {
      const repeated = r.latencyCase === "none" || r.latencyCase === "compressor-track";
      expect(r.repeat, r.id).toBe(repeated);
      expect(r.invariants.includes("repeat-identical"), r.id).toBe(repeated);
    }
  });
  it("reads stems against a bed mix and only these rows and the control carry the bed", () => {
    const rows = buildRows(48000);
    const bed = rows.filter((r) => r.withBed).map((r) => r.group + ":" + r.path);
    expect(new Set(bed)).toEqual(new Set(["stems:step-one", "stems:stems-fx", "stems:stems-dry", "stems:stems-sends",
      "stems:stems-metronome", "control:step-one"]));
    rows.filter((r) => r.path.startsWith("stems-")).forEach((r) => expect(r.referenceId, r.id).toMatch(/^mix-/));
  });
  it("starts the section windows where the brief puts them", () => {
    const rows = buildRows(48000);
    const marker = rows.find((r) => r.id === "core-none-section-marker")!;
    const last = rows.find((r) => r.id === "core-none-section-marker-last")!;
    expect([marker.rangeStartSeconds, marker.rangeSeconds]).toEqual([1, 2]);
    expect([last.rangeStartSeconds, last.rangeSeconds]).toEqual([3, 1]);
  });
  it("labels the one frame only where it was measured", async () => {
    const { findingFor } = await import("./exportRegressionFindings.ts");
    const row = buildRows(44100).find((r) => r.id === "core-none-section-loop-twice")!;
    const one = { earlyFrames: 1, firstDifferingFrame: null, lastDifferingFrame: null, largestDifference: null };
    expect(findingFor(row, "section-is-slice", 44100, one)?.name).toBe("one-frame-early-44100");
    expect(findingFor(row, "section-is-slice", 48000, one)).toBeNull();
    expect(findingFor(row, "no-jump", 44100, one)).toBeNull();
  });
});

describe("setPositionStart", () => {
  it("lands a whole multiple of 128 frames at 48 kHz on quantum, and off it when asked", () => {
    const on = setPositionStart(1, 120, 48000, true);
    expect(on.offQuantumFrames).toBe(0);
    expect(Number.isInteger(on.ppqn)).toBe(true);
    expect(on.ppqn).toBeGreaterThanOrEqual(1920);
    expect(setPositionStart(1, 120, 48000, false).offQuantumFrames).toBeGreaterThan(0);
  });
  it("lands a whole multiple of 128 frames at 44.1 kHz", () => {
    const { ppqn, offQuantumFrames } = setPositionStart(1, 120, 44100, true);
    const frame = ppqn * 60 / (960 * 120) * 44100;
    expect(offQuantumFrames).toBe(0);
    expect(Math.abs(frame / 128 - Math.round(frame / 128))).toBeLessThan(1e-9);
    expect(setPositionStart(1, 120, 44100, false).ppqn).toBe(ppqn + 1);
  });
  it("starts each setposition row at its own frame", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate).filter((r) => r.path.startsWith("setposition-"));
      expect(rows.length).toBe(8);
      rows.forEach((r) => {
        expect(r.rangeStartSeconds, r.id).toBeGreaterThan(0);
        expect(r.rangeStartSeconds + r.rangeSeconds, r.id).toBeCloseTo(r.seconds, 9);
      });
    }
  });
});
