import { describe, expect, it } from "vitest";
import { buildRows, type ExportRow } from "./exportRegressionRows.ts";
import { KNOWN_FINDINGS, NO_EVIDENCE, findingFor, type FindingEvidence } from "./exportRegressionFindings.ts";

const rowOf = (pageRate: number, id: string): ExportRow => buildRows(pageRate).find((r) => r.id === id)!;
const evidence = (over: Partial<FindingEvidence>): FindingEvidence => ({ ...NO_EVIDENCE, ...over });
const early = (frames: number): FindingEvidence => evidence({ earlyFrames: frames });
/** A comparison that differs from `first` to `last` with `largest`, and by `past` from the frame `pastFrom` on. */
const differs = (first: number, last: number, largest: number, past: number, pastFrom: number): FindingEvidence => evidence({
  firstDifferingFrame: first, lastDifferingFrame: last, largestDifference: largest,
  differencePast: (frame) => (frame >= pastFrom ? past : largest)
});
const named = (name: string) => KNOWN_FINDINGS.filter((f) => f.name === name);

describe("exportRegressionFindings", () => {
  describe("loop-pass-one-frame-short", () => {
    it("applies where the position arithmetic lands one short: 44.1 kHz at 120 bpm and 48 kHz at 137 bpm, 4 s", () => {
      const applies = (rate: number, id: string) => named("loop-pass-one-frame-short")[0].applies(rowOf(rate, id), rate);
      expect(applies(44100, "core-none-section-loop-twice")).toBe(true);
      expect(applies(44100, "one-frame-none-section-loop-twice-48000-4-120")).toBe(true);
      expect(applies(44100, "bounce-none-bounce-loop")).toBe(true);
      expect(applies(48000, "one-frame-none-section-loop-twice-44100-4-137")).toBe(true);
      expect(applies(48000, "core-none-section-loop-twice")).toBe(false);
      expect(applies(48000, "bounce-none-bounce-loop")).toBe(false);
      expect(applies(44100, "one-frame-none-section-loop-twice-48000-4-137")).toBe(false);
      expect(applies(44100, "one-frame-none-section-loop-twice-48000-2-120")).toBe(false);
      expect(applies(44100, "core-none-section-loop-once")).toBe(false);
    });
    it("needs the measured shift to be exactly one frame, on impulse-on-reference", () => {
      const row = rowOf(44100, "core-none-section-loop-twice");
      expect(findingFor(row, "impulse-on-reference", 44100, early(1))?.name).toBe("loop-pass-one-frame-short");
      for (const shift of [early(37), early(0), early(-1), NO_EVIDENCE]) {
        expect(findingFor(row, "impulse-on-reference", 44100, shift)).toBeNull();
      }
      expect(findingFor(row, "samples-equal-warm-pass", 44100, early(1))).toBeNull();
      expect(findingFor(row, "section-is-slice", 44100, early(1))).toBeNull();
    });
  });

  describe("jump-fade-at-start", () => {
    const marker48 = rowOf(48000, "core-none-section-marker");
    const marker44 = rowOf(44100, "core-none-section-marker");
    it("matches a 48 kHz start that differs only inside the 240 frames of the fade", () => {
      const measured = differs(0, 239, 0.473, 0, 240);
      expect(findingFor(marker48, "section-is-slice", 48000, measured)?.name).toBe("jump-fade-at-start");
      expect(findingFor(rowOf(48000, "position-none-setposition-off-quantum"), "samples-equal-reference", 48000, measured)?.name).toBe("jump-fade-at-start");
    });
    it("reads failing when anything differs past the fade, when it does not start at frame 0, or when it is louder than the tone", () => {
      expect(findingFor(marker48, "section-is-slice", 48000, differs(0, 95999, 0.473, 1e-6, 240))).toBeNull();
      expect(findingFor(marker48, "section-is-slice", 48000, differs(5, 239, 0.473, 0, 240))).toBeNull();
      expect(findingFor(marker48, "section-is-slice", 48000, differs(0, 239, 0.6, 0, 240))).toBeNull();
      expect(findingFor(marker48, "section-is-slice", 48000, NO_EVIDENCE)).toBeNull();
    });
    it("gives the Fold on the chain 8 frames more, on that case only", () => {
      const measured = differs(0, 247, 0.473, 0, 248);
      expect(findingFor(rowOf(48000, "core-several-section-marker"), "section-is-slice", 48000, measured)?.name).toBe("jump-fade-at-start");
      expect(findingFor(marker48, "section-is-slice", 48000, measured)).toBeNull();
    });
    it("allows a resampled read only what the single-precision rate drifts by, at the row's own start", () => {
      // measured: 1 s at 44.1 kHz of a 48 kHz source, -56.6 dB
      expect(findingFor(marker44, "section-is-slice", 44100, differs(0, 88199, 0.473, 0.00148, 221))?.name).toBe("jump-fade-at-start");
      expect(findingFor(marker44, "section-is-slice", 44100, differs(0, 88199, 0.473, 0.002, 221))).toBeNull();
      const last = rowOf(44100, "core-none-section-marker-last");
      expect(findingFor(last, "section-is-slice", 44100, differs(0, 44099, 0.473, 0.00444, 221))?.name).toBe("jump-fade-at-start");
      expect(findingFor(last, "section-is-slice", 44100, differs(0, 44099, 0.473, 0.006, 221))).toBeNull();
    });
    it("takes the offset of a start between two frames into that allowance", () => {
      const off = rowOf(44100, "position-none-setposition-off-quantum");
      expect(findingFor(off, "samples-equal-reference", 44100, differs(0, 82296, 0.47, 0.0339, 221))?.name).toBe("jump-fade-at-start");
      expect(findingFor(rowOf(44100, "position-none-setposition-on-quantum"), "samples-equal-reference", 44100, differs(0, 82319, 0.47, 0.0339, 221))).toBeNull();
    });
    it("doubles the levels for the aux case, whose source is heard twice", () => {
      const aux = rowOf(44100, "core-compressor-aux-section-marker");
      expect(findingFor(aux, "section-is-slice", 44100, differs(0, 88199, 0.95, 0.00295, 221))?.name).toBe("jump-fade-at-start");
      expect(findingFor(marker44, "section-is-slice", 44100, differs(0, 88199, 0.95, 0.00148, 221))).toBeNull();
    });
    it("stays off the other paths and groups", () => {
      const fade = named("jump-fade-at-start");
      for (const [rate, id] of [[48000, "core-none-section-entire"], [48000, "position-none-loop-on-copy"], [48000, "master-none-section-marker"], [48000, "tail-none-section-marker"]] as const) {
        expect(fade.some((f) => f.applies(rowOf(rate, id), rate)), id).toBe(false);
      }
    });
  });

  describe("jump-fade-cold-maximizer", () => {
    it("matches the master's section start up to the frame the cold limiter meets the warm one, and nothing past it", () => {
      const row = rowOf(48000, "master-none-section-marker");
      expect(findingFor(row, "section-is-slice", 48000, differs(0, 3430, 0.92, 0, 3431))?.name).toBe("jump-fade-cold-maximizer");
      expect(findingFor(row, "section-is-slice", 48000, differs(0, 95999, 0.92, 1e-6, 3431))).toBeNull();
      expect(findingFor(row, "section-is-slice", 48000, differs(0, 3430, 1.2, 0, 3431))).toBeNull();
      const row44 = rowOf(44100, "master-compressor-track-section-marker");
      expect(findingFor(row44, "section-is-slice", 44100, differs(0, 88199, 0.92, 2.16e-4, 3431))?.name).toBe("jump-fade-cold-maximizer");
      expect(findingFor(row44, "section-is-slice", 44100, differs(0, 88199, 0.92, 1e-3, 3431))).toBeNull();
    });
  });

  describe("reset-keeps-compensation-delay", () => {
    it("needs the render to be the reference delayed by exactly the case's figure, at the page's rate", () => {
      const row = rowOf(44100, "core-maximizer-muted-step-reset");
      const delayedBy = (expected: number) => evidence({ sameDelayedBy: (frames) => frames === expected });
      expect(findingFor(row, "samples-equal-reference", 44100, delayedBy(221))?.name).toBe("reset-keeps-compensation-delay");
      expect(findingFor(row, "samples-equal-reference", 44100, delayedBy(240))).toBeNull();
      expect(findingFor(rowOf(48000, "core-maximizer-muted-step-reset"), "samples-equal-reference", 48000, delayedBy(240))?.name).toBe("reset-keeps-compensation-delay");
      expect(findingFor(rowOf(48000, "master-compressor-track-step-reset"), "samples-equal-reference", 48000, delayedBy(240))?.name).toBe("reset-keeps-compensation-delay");
    });
    it("does not apply to a case with no latency: a reset there must hold", () => {
      const [finding] = named("reset-keeps-compensation-delay");
      expect(finding.applies(rowOf(48000, "core-none-step-reset"), 48000)).toBe(false);
      expect(finding.applies(rowOf(48000, "master-none-step-reset"), 48000)).toBe(false);
      expect(finding.applies(rowOf(48000, "core-none-step-chunked-odd"), 48000)).toBe(false);
    });
  });

  describe("range-missing-tail", () => {
    const row = rowOf(48000, "tail-none-section-marker");
    it("has an entry for each invariant the row fails, or the row could never be labelled", () => {
      expect(named("range-missing-tail").map((f) => f.invariant).sort()).toEqual(["proves-something", "section-is-slice"]);
    });
    it("takes silence on proves-something, and nothing else that invariant fails on", () => {
      expect(findingFor(row, "proves-something", 48000, evidence({ silent: true }))?.name).toBe("range-missing-tail");
      expect(findingFor(row, "proves-something", 48000, evidence({ silent: false }))).toBeNull();
      expect(findingFor(row, "proves-something", 48000, NO_EVIDENCE)).toBeNull();
    });
    it("takes a difference over the whole range no louder than the reverb there", () => {
      expect(findingFor(row, "section-is-slice", 48000, differs(0, 95999, 0.0021, 0.0021, 240))?.name).toBe("range-missing-tail");
      expect(findingFor(row, "section-is-slice", 48000, differs(0, 95999, 0.1, 0.1, 240))).toBeNull();
      expect(findingFor(row, "section-is-slice", 48000, differs(0, 500, 0.0021, 0.0021, 240))).toBeNull();
    });
    it("stays off the rows that ring", () => {
      named("range-missing-tail").forEach((f) => expect(f.applies(rowOf(48000, "tail-none-section-entire"), 48000)).toBe(false));
    });
  });

  describe("trailing-silence-trimmed", () => {
    it("takes the two long rows at the frame count they keep, bit-identical up to there", () => {
      for (const id of ["tail-none-section-entire-long", "tail-none-start-long"]) {
        expect(findingFor(rowOf(48000, id), "section-is-slice", 48000, evidence({ comparedFrames: 80992 }))?.name).toBe("trailing-silence-trimmed");
        expect(findingFor(rowOf(44100, id), "section-is-slice", 44100, evidence({ comparedFrames: 74001 }))?.name).toBe("trailing-silence-trimmed");
      }
    });
    it("reads failing at another length, or with a difference in what it kept", () => {
      const row = rowOf(48000, "tail-none-start-long");
      expect(findingFor(row, "section-is-slice", 48000, evidence({ comparedFrames: 80000 }))).toBeNull();
      expect(findingFor(row, "section-is-slice", 48000, evidence({ comparedFrames: 80992, firstDifferingFrame: 3 }))).toBeNull();
      expect(findingFor(row, "section-is-slice", 48000, NO_EVIDENCE)).toBeNull();
      expect(named("trailing-silence-trimmed")[0].applies(rowOf(48000, "tail-none-section-entire"), 48000)).toBe(false);
    });
  });

  describe("loop-wrap-keeps-old-read", () => {
    it("takes the step on the wrap's own frame, no larger than the doubled tone's", () => {
      const row = rowOf(48000, "position-none-loop-on-copy");
      expect(findingFor(row, "no-jump", 48000, evidence({ largestStep: { step: 0.12987, frame: 96001 } }))?.name).toBe("loop-wrap-keeps-old-read");
      expect(findingFor(rowOf(44100, "position-compressor-muted-loop-on-copy"), "no-jump", 44100, evidence({ largestStep: { step: 0.14112, frame: 88201 } }))?.name).toBe("loop-wrap-keeps-old-read");
    });
    it("reads failing for a step elsewhere, a larger one, or none measured", () => {
      const row = rowOf(48000, "position-none-loop-on-copy");
      expect(findingFor(row, "no-jump", 48000, evidence({ largestStep: { step: 0.12987, frame: 50000 } }))).toBeNull();
      expect(findingFor(row, "no-jump", 48000, evidence({ largestStep: { step: 0.2, frame: 96001 } }))).toBeNull();
      expect(findingFor(row, "no-jump", 48000, NO_EVIDENCE)).toBeNull();
      expect(named("loop-wrap-keeps-old-read")[0].applies(rowOf(48000, "core-none-section-marker"), 48000)).toBe(false);
    });
  });

  it("lists each finding with a note", () => {
    KNOWN_FINDINGS.forEach((f) => expect(f.note.length).toBeGreaterThan(0));
  });
});
