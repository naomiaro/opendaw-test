import { describe, expect, it } from "vitest";
import { buildRows, LOOP_ON_COPY_SECONDS, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";
import { toneStep } from "./sectionRenderGap.ts";
import { computedFrame, IMPULSE_SOURCE_FRAMES, PROBE_TONE_HZ, PROBE_TONE_LEVEL } from "./exportRegressionSignals.ts";
import type { RenderRead } from "./exportRegressionReader.ts";
import {
  compareRegister, judgeInvariants, parseRegisterResponse, rowStanding,
  type InvariantResult, type RegisterEntry, type RenderedRow
} from "./exportRegressionVerdict.ts";

const read = (over: Partial<RenderRead> = {}): RenderRead => ({
  hash: "h", frames: 5, channels: 1, peak: 1, nonFinite: 0, impulseHits: [],
  largestStep: { step: 0.1, frame: 3 }, energyPastRange: null, ...over
});
const rendered = (samples: number[] | number[][], over: Partial<RenderedRow> = {}, r: Partial<RenderRead> = {}): RenderedRow => {
  const channels = (Array.isArray(samples[0]) ? samples as number[][] : [samples as number[]]).map((c) => Float32Array.from(c));
  return { read: read({ frames: channels[0].length, channels: channels.length, ...r }), samples: channels, reportedLatencyFrames: 0, repeatHash: null, ...over };
};
const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  ...buildRows(48000).find((x) => x.id === "core-none-step-one")!, rangeStartSeconds: 0, rangeSeconds: 5 / 48000, invariants: [], ...over
});
const one = (inv: InvariantId, r: ExportRow, got: RenderedRow, refs: { reference?: RenderedRow | null; noLatency?: RenderedRow | null; warm?: RenderedRow | null } = {}, rate = 48000) =>
  judgeInvariants({ ...r, invariants: [inv] }, got, { reference: refs.reference ?? null, noLatency: refs.noLatency ?? null, warm: refs.warm ?? null }, rate)[0];

describe("judgeInvariants", () => {
  it("fails section-is-slice on one frame early, with no allowance", () => {
    const ref = rendered([0, 0, 1, 0, 0]);
    const early = rendered([0, 1, 0, 0, 0]);
    const [r] = judgeInvariants(row({ invariants: ["section-is-slice"] }), early, { reference: ref, noLatency: null, warm: null }, 48000);
    expect(r.holds).toBe(false);
    expect(r.detail).toContain("frame 1");
    expect(one("section-is-slice", row(), rendered([0, 0, 1, 0, 0]), { reference: ref }).holds).toBe(true);
  });
  it("compares a longer render over the reference's frames", () => {
    const ref = rendered([1, 2, 3]);
    const r = row({ rangeSeconds: 3 / 48000 });
    const longer = one("samples-equal-reference", r, rendered([1, 2, 3, 9, 9]), { reference: ref });
    expect(longer.holds).toBe(true);
    expect(longer.detail).toContain("2 frames past the reference not compared");
    expect(one("samples-equal-reference", r, rendered([1, 2, 4, 9, 9]), { reference: ref }).holds).toBe(false);
  });
  it("fails a render or a reference too short for the range, naming both counts", () => {
    const ref = rendered([1, 2, 3, 4, 5]);
    const short = one("section-is-slice", row(), rendered([1, 2]), { reference: ref });
    expect(short.holds).toBe(false);
    expect(short.detail).toContain("2 of the range's 5");
    const shortRef = one("section-is-slice", row(), rendered([1, 2, 3, 4, 5]), { reference: rendered([1, 2, 3]) });
    expect(shortRef.holds).toBe(false);
    expect(shortRef.detail).toContain("3 of the range's 5");
  });
  it("compares every channel of a stem render with the stepped stems", () => {
    const stepped = rendered([[1, 2, 3, 4, 5], [6, 7, 8, 9, 1], [2, 3, 4, 5, 6], [7, 8, 9, 1, 2]]);
    const same = () => [[1, 2, 3, 4, 5], [6, 7, 8, 9, 1], [2, 3, 4, 5, 6], [7, 8, 9, 1, 2]];
    expect(one("section-is-slice", row(), rendered(same()), { reference: stepped }).holds).toBe(true);
    // the last channel is the bed's right: a comparison of the source's pair alone would pass this
    const bedOff = same();
    bedOff[3][4] = 2.5;
    const off = one("section-is-slice", row(), rendered(bedOff), { reference: stepped });
    expect(off.holds).toBe(false);
    expect(off.detail).toContain("differs at frame 4 of channel 3");
    // `start` runs on past the range: the frames past the stepped render are not its to judge
    const longer = one("section-is-slice", row(), rendered(same().map((c) => [...c, 9, 9])), { reference: stepped });
    expect(longer.holds).toBe(true);
    expect(longer.detail).toContain("2 frames past the reference not compared");
    const sourceOnly = one("section-is-slice", row(), rendered(same().slice(0, 2)), { reference: stepped });
    expect(sourceOnly.holds).toBe(false);
    expect(sourceOnly.detail).toContain("channel counts differ: 2 against the reference's 4");
  });
  it("compares a setposition row with the reference from its start frame", () => {
    const ref = rendered([9, 9, 1, 2, 3, 4]);
    const r = row({ rangeStartSeconds: 2 / 48000, rangeSeconds: 4 / 48000 });
    expect(one("samples-equal-reference", r, rendered([1, 2, 3, 4]), { reference: ref }).holds).toBe(true);
    expect(one("samples-equal-reference", r, rendered([9, 9, 1, 2]), { reference: ref }).holds).toBe(false);
  });
  it("fails when the reference it needs is missing, never by default", () => {
    for (const inv of ["samples-equal-reference", "impulse-on-reference", "impulse-follows-loop", "disabled-equals-absent", "differs-from-reference", "stems-sum-to-mix"] as const) {
      expect(one(inv, row(), rendered([1])).holds).toBe(false);
    }
    expect(one("muted-latent-unchanged", row(), rendered([1])).detail).toContain("no no-latency");
    expect(one("impulse-unmoved-by-latency", row(), rendered([1])).holds).toBe(false);
    expect(one("no-jump", row({ referenceId: "x" }), rendered([1])).holds).toBe(false);
  });
  it("compares impulses with the reference's hits inside the range, shifted back", () => {
    const ref = rendered([0], {}, { impulseHits: [100, 5000, 9000] });
    const r = row({ rangeStartSeconds: 4000 / 48000, rangeSeconds: 4000 / 48000 });
    expect(one("impulse-on-reference", r, rendered([0], {}, { impulseHits: [1000] }), { reference: ref }).holds).toBe(true);
    const missing = one("impulse-on-reference", r, rendered([0], {}, { impulseHits: [] }), { reference: ref });
    expect(missing.holds).toBe(false);
    expect(missing.detail).toContain("missing frames 1000");
    const extra = one("impulse-on-reference", r, rendered([0], {}, { impulseHits: [1000, 2000] }), { reference: ref });
    expect(extra.detail).toContain("extra frames 2000");
    expect(one("impulse-on-reference", r, rendered([0], {}, { impulseHits: [999] }), { reference: ref }).holds).toBe(false);
  });
  it("fails impulse-on-reference when the reference has no hit in range", () => {
    const ref = rendered([0], {}, { impulseHits: [] });
    expect(one("impulse-on-reference", row(), rendered([0], {}, { impulseHits: [] }), { reference: ref }).holds).toBe(false);
  });
  it("reads impulse-on-computed-frame against the source impulses in range, converted to the page rate", () => {
    const r = row({ sourceRate: 44100, seconds: 4, rangeSeconds: 4 });
    const frames = IMPULSE_SOURCE_FRAMES.map((f) => Math.round((f * 48000) / 44100));
    expect(one("impulse-on-computed-frame", r, rendered([0], {}, { impulseHits: frames })).holds).toBe(true);
    expect(one("impulse-on-computed-frame", r, rendered([0], {}, { impulseHits: frames.map((f) => f - 1) })).holds).toBe(false);
    const short = row({ seconds: 0.9, rangeSeconds: 0.9 });
    expect(one("impulse-on-computed-frame", short, rendered([0], {}, { impulseHits: [4096, 24037] })).holds).toBe(true);
  });
  it("holds impulse-unmoved-by-latency on equal hits only", () => {
    const base = rendered([0], {}, { impulseHits: [4096, 24037] });
    expect(one("impulse-unmoved-by-latency", row(), rendered([0], {}, { impulseHits: [4096, 24037] }), { noLatency: base }).holds).toBe(true);
    expect(one("impulse-unmoved-by-latency", row(), rendered([0], {}, { impulseHits: [4096, 24036] }), { noLatency: base }).holds).toBe(false);
  });
  it("holds no-jump on the tone's own step and fails on a join", () => {
    const tone = toneStep(PROBE_TONE_LEVEL, PROBE_TONE_HZ, 48000);
    expect(one("no-jump", row(), rendered([0], {}, { largestStep: { step: tone * 1.04, frame: 1 } })).holds).toBe(true);
    expect(one("no-jump", row(), rendered([0], {}, { largestStep: { step: tone * 1.06, frame: 1 } })).holds).toBe(false);
    const ref = rendered([0], {}, { largestStep: { step: 0.2, frame: 1 } });
    const r = row({ referenceId: "x" });
    expect(one("no-jump", r, rendered([0], {}, { largestStep: { step: 0.21, frame: 1 } }), { reference: ref }).holds).toBe(true);
    expect(one("no-jump", r, rendered([0], {}, { largestStep: { step: 0.22, frame: 1 } }), { reference: ref }).holds).toBe(false);
  });
  it("fails no-jump when no step was measured", () => {
    expect(one("no-jump", row(), rendered([0], {}, { largestStep: { step: 0, frame: -1 } })).holds).toBe(false);
    expect(one("no-jump", row(), rendered([0], {}, { largestStep: { step: 0, frame: 7 } })).holds).toBe(false);
  });
  it("fails on zero frames or zero channels", () => {
    const empty = rendered([[]]);
    const none: RenderedRow = { ...empty, samples: [] };
    for (const bad of [empty, none]) {
      expect(one("muted-latent-unchanged", row(), bad, { noLatency: bad }).holds).toBe(false);
      expect(one("stems-sum-to-mix", row(), bad, { reference: bad }).holds).toBe(false);
      expect(one("samples-equal-reference", row(), bad, { reference: bad }).holds).toBe(false);
    }
  });
  it("says what muted-latent-unchanged read: exact, or past how many frames", () => {
    const base = rendered(Array.from({ length: 300 }, (_, i) => i));
    const same = one("muted-latent-unchanged", row(), rendered(Array.from({ length: 300 }, (_, i) => i)), { noLatency: base });
    expect(same.holds).toBe(true);
    expect(same.detail).toBe("bit-identical");
    const late = Array.from({ length: 300 }, (_, i) => (i < 200 ? i + 1000 : i));
    const diff = one("muted-latent-unchanged", row(), rendered(late), { noLatency: base });
    expect(diff.holds).toBe(false);
    expect(diff.detail).toBe("differs up to frame 199");
  });
  describe("stems-sum-to-mix", () => {
    const mix = rendered([[0.75, 0.5], [0.25, 0.125]]);
    const stems = (bedLeft: number, sourceRight = 0.25) =>
      rendered([[0.5, 0.25], [sourceRight, 0.125], [bedLeft, 0.25], [0, 0]]);
    const judged = (got: RenderedRow, against: RenderedRow = mix) => one("stems-sum-to-mix", row(), got, { reference: against });

    it("holds a source and a bed that sum to the mix, within rounding only", () => {
      expect(judged(stems(0.25)).holds).toBe(true);
      expect(judged(stems(0.25 + 4.7e-7)).holds).toBe(true);
      const off = judged(stems(0.25 + 1e-4));
      expect(off.holds).toBe(false);
      expect(off.detail).toContain("largest difference");
      expect(judged(stems(0.25, 0.25 + 1e-4)).holds).toBe(false);
      expect(judged(stems(NaN)).holds).toBe(false);
    });
    it("pairs channels 0,2,… as the left and 1,3,… as the right", () => {
      const got = rendered([[0.5], [0.25], [0.125], [0.5]]);
      expect(judged(got, rendered([[0.625], [0.75]])).holds).toBe(true);
      expect(judged(got, rendered([[0.75], [0.625]])).holds).toBe(false);
    });
    it("sums every pair, not only the first two", () => {
      const three = rendered([[0.5], [0.25], [0.125], [0.25], [0.125], [0.25]]);
      expect(judged(three, rendered([[0.75], [0.75]])).holds).toBe(true);
      expect(judged(three, rendered([[0.625], [0.5]])).holds).toBe(false);
    });
    it("sums in 32-bit float, as the mix did", () => {
      const got = rendered([[1], [0], [1e-8], [0]]);
      expect(judged(got, rendered([[1], [0]])).detail).toBe("largest difference 0, limit 4.8e-7");
    });
    it("fails uncompared on an odd channel count, a mix that is not stereo, or a length that differs", () => {
      const odd = judged(rendered([[0.5, 0.25], [0.25, 0.125], [0.25, 0.25]]));
      expect(odd.holds).toBe(false);
      expect(odd.detail).toContain("3 channels");
      const mono = judged(stems(0.25), rendered([[0.75, 0.5]]));
      expect(mono.holds).toBe(false);
      expect(mono.detail).toContain("1 channels");
      const short = judged(rendered([[0.5], [0.25], [0.25], [0]]));
      expect(short.holds).toBe(false);
      expect(short.detail).toContain("frames");
      const uneven = judged(rendered([[0.5, 0.25], [0.25, 0.125], [0.25], [0, 0]]));
      expect(uneven.holds).toBe(false);
      expect(uneven.detail).toContain("frames");
    });
  });
  describe("impulse-follows-loop", () => {
    const looped = (rate: number): ExportRow => buildRows(rate).find((x) => x.id === "position-none-loop-on-copy")!;
    const reference = (rate: number): number[] => IMPULSE_SOURCE_FRAMES.map((f) => computedFrame(f, 48000, rate));
    const pattern = (rate: number): number[] => {
      const loop = Math.round(LOOP_ON_COPY_SECONDS * rate);
      const first = reference(rate).filter((hit) => hit < loop);
      return [...first, ...first.map((hit) => hit + loop)];
    };
    const judged = (rate: number, hits: number[], over: Partial<ExportRow> = {}, refHits: number[] = reference(rate)) =>
      one("impulse-follows-loop", { ...looped(rate), ...over }, rendered([0], {}, { impulseHits: hits }),
        { reference: rendered([0], {}, { impulseHits: refHits }) }, rate);

    it("spells the pattern the loop gives at 48 kHz", () => {
      expect(pattern(48000)).toEqual([4096, 24037, 72064, 100096, 120037, 168064]);
    });
    it("holds on the exact pattern at both page rates", () => {
      for (const rate of [48000, 44100]) expect(judged(rate, pattern(rate)).holds, String(rate)).toBe(true);
    });
    it("fails a hit one frame off, naming both frames", () => {
      for (const rate of [48000, 44100]) {
        const hits = pattern(rate);
        const moved = hits.map((hit, index) => (index === 3 ? hit - 1 : hit));
        const result = judged(rate, moved);
        expect(result.holds, String(rate)).toBe(false);
        expect(result.detail).toContain(`missing frames ${hits[3]}`);
        expect(result.detail).toContain(`extra frames ${hits[3] - 1}`);
      }
    });
    it("fails the unlooped reference's hits: the loop did not repeat", () => {
      for (const rate of [48000, 44100]) {
        const result = judged(rate, reference(rate));
        expect(result.holds, String(rate)).toBe(false);
        expect(result.detail).toContain(`missing frames ${pattern(rate)[3]}`);
      }
    });
    it("fails an extra hit", () => {
      const result = judged(48000, [...pattern(48000), 180000]);
      expect(result.holds).toBe(false);
      expect(result.detail).toContain("extra frames 180000");
    });
    it("expects only the hits inside the range", () => {
      const threeSeconds = { rangeSeconds: 3 };
      expect(judged(48000, [4096, 24037, 72064, 100096, 120037], threeSeconds).holds).toBe(true);
      expect(judged(48000, pattern(48000), threeSeconds).holds).toBe(false);
    });
    it("takes no hit at the loop's end into the loop", () => {
      expect(judged(48000, [4096, 100096], {}, [4096, 96000]).holds).toBe(true);
    });
    it("fails uncompared when the reference has no hit inside the loop", () => {
      const result = judged(48000, [], {}, [96000, 120037]);
      expect(result.holds).toBe(false);
      expect(result.detail).toContain("no impulse in the range");
    });
  });
  it("holds repeat-identical on equal hashes and fails without a repeat", () => {
    expect(one("repeat-identical", row(), rendered([1], { repeatHash: "h" })).holds).toBe(true);
    expect(one("repeat-identical", row(), rendered([1], { repeatHash: "g" })).holds).toBe(false);
    expect(one("repeat-identical", row(), rendered([1])).holds).toBe(false);
  });
  it("reads the tail by energy past the range and the frame count", () => {
    const r = row({ rangeSeconds: 5 / 48000 });
    expect(one("tail-present", r, rendered([1], {}, { energyPastRange: 0.01 })).holds).toBe(true);
    expect(one("tail-present", r, rendered([1], {}, { energyPastRange: 1e-4 })).holds).toBe(false);
    expect(one("tail-present", r, rendered([1])).holds).toBe(false);
    expect(one("tail-absent", r, rendered([1, 1, 1, 1, 1])).holds).toBe(true);
    expect(one("tail-absent", r, rendered([1, 1, 1, 1, 1, 1], {}, { energyPastRange: 0 })).holds).toBe(false);
    expect(one("tail-absent", r, rendered([1, 1, 1, 1, 1], {}, { energyPastRange: 0.01 })).holds).toBe(false);
  });
  it("compares hashes for disabled-equals-absent and differs-from-reference", () => {
    const ref = rendered([1], {}, { hash: "a" });
    expect(one("disabled-equals-absent", row(), rendered([1], {}, { hash: "a" }), { reference: ref }).holds).toBe(true);
    expect(one("disabled-equals-absent", row(), rendered([1], {}, { hash: "b" }), { reference: ref }).holds).toBe(false);
    expect(one("differs-from-reference", row(), rendered([1], {}, { hash: "b" }), { reference: ref }).holds).toBe(true);
    expect(one("differs-from-reference", row(), rendered([1], {}, { hash: "a" }), { reference: ref }).holds).toBe(false);
  });
  it("fails proves-something on a silent or non-finite render", () => {
    expect(one("proves-something", row(), rendered([1])).holds).toBe(true);
    expect(one("proves-something", row(), rendered([0], {}, { peak: 0 })).holds).toBe(false);
    expect(one("proves-something", row(), rendered([1], {}, { nonFinite: 2 })).holds).toBe(false);
  });
  it("fails latency-as-expected and still reports the figures", () => {
    const r = row({ latencyCase: "script-150ms-parallel" });
    const bad = one("latency-as-expected", r, rendered([1], { reportedLatencyFrames: 240 }));
    expect(bad.holds).toBe(false);
    expect(bad.detail).toContain("240");
    expect(bad.detail).toContain("4800");
    expect(one("latency-as-expected", r, rendered([1], { reportedLatencyFrames: 4800 })).holds).toBe(true);
  });
  it("puts a known finding's name on a failing invariant whose measurement matches, and only there", () => {
    const trimmed = buildRows(48000).find((x) => x.id === "tail-none-start-long")!;
    const frames = Math.round(trimmed.rangeSeconds * 48000);
    const source = Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 7));
    const ref: RenderedRow = { ...rendered([0]), samples: [source], read: read({ frames }) };
    const judged = (kept: number, change: (channel: Float32Array) => void = () => {}, inv: InvariantId = "section-is-slice") => {
      const channel = source.slice(0, kept);
      change(channel);
      const got: RenderedRow = { ...rendered([0]), samples: [channel], read: read({ frames: kept }) };
      return judgeInvariants({ ...trimmed, invariants: [inv] }, got, { reference: ref, noLatency: null, warm: null }, 48000)[0];
    };
    expect(judged(81120).holds).toBe(false);
    expect(judged(81120).finding).toBe("trailing-silence-trimmed");
    expect(judged(81119).finding).toBeNull();
    expect(judged(81121).finding).toBeNull();
    expect(judged(81120, (channel) => { channel[3] += 1e-3; }).finding).toBeNull();
    expect(judged(81120, () => {}, "samples-equal-reference").finding).toBeNull();
    expect(judged(frames).holds).toBe(true);
    expect(judged(frames).finding).toBeNull();
    const other = judgeInvariants({ ...trimmed, invariants: ["proves-something"] }, rendered([0], {}, { peak: 0 }), { reference: null, noLatency: null, warm: null }, 48000)[0];
    expect(other.finding).toBeNull();
  });
  it("names no finding on a warm pass that differs, whatever it measured", () => {
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const r = { ...loop, invariants: ["samples-equal-warm-pass" as const], rangeSeconds: 5 / 44100 };
    // no label sits on samples-equal-warm-pass: a differing warm pass must stay failing, unnamed
    const [bad] = judgeInvariants(r, rendered([0, 1, 0, 0, 0]), { reference: rendered([0, 0, 1, 0, 0]), noLatency: null, warm: rendered([0, 0, 1, 0, 0]) }, 44100);
    expect(bad.holds).toBe(false);
    expect(bad.finding).toBeNull();
  });
  it("holds a loop's kept pass to the warm pass sample for sample, from its first frame", () => {
    const warm = rendered([[1, 2, 3, 4, 5], [6, 7, 8, 9, 1]]);
    const held = one("samples-equal-warm-pass", row(), rendered([[1, 2, 3, 4, 5], [6, 7, 8, 9, 1]]), { warm });
    expect(held.holds).toBe(true);
    expect(held.detail).toContain("5 frames bit-identical");
  });
  it("fails a warm pass one frame off, with no allowance", () => {
    const warm = rendered([0, 0, 1, 0, 0]);
    const off = one("samples-equal-warm-pass", row(), rendered([0, 1, 0, 0, 0]), { warm });
    expect(off.holds).toBe(false);
    expect(off.detail).toContain("differs at frame 1");
  });
  it("fails a render too short for the warm pass's range, naming both counts", () => {
    const short = one("samples-equal-warm-pass", row(), rendered([1, 2]), { warm: rendered([1, 2, 3, 4, 5]) });
    expect(short.holds).toBe(false);
    expect(short.detail).toContain("2 of the range's 5");
  });
  it("reads the warm reference, never the cold one, for the warm pass", () => {
    const cold = rendered([9, 9, 9, 9, 9]);
    expect(one("samples-equal-warm-pass", row(), rendered([1, 2, 3, 4, 5]), { reference: cold, warm: rendered([1, 2, 3, 4, 5]) }).holds).toBe(true);
    expect(one("section-is-slice", row(), rendered([1, 2, 3, 4, 5]), { reference: cold, warm: rendered([1, 2, 3, 4, 5]) }).holds).toBe(false);
  });
  it("fails uncompared with no warm reference, and gives that no finding", () => {
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const hits = [5000, 20000, 40000];
    const cold = rendered([1], {}, { impulseHits: hits });
    const [r] = judgeInvariants({ ...loop, invariants: ["samples-equal-warm-pass"] }, rendered([1], {}, { impulseHits: hits.map((h) => h - 1) }), { reference: cold, noLatency: null, warm: null }, 44100);
    expect(r.holds).toBe(false);
    expect(r.detail).toContain("no warm pass read");
    expect(r.finding).toBeNull();
  });
  it("judges the impulses on the cold reference, where the warm pass carries the same shift", () => {
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const coldHits = [3, 6, 8];
    const cold = rendered([0], {}, { impulseHits: coldHits });
    const got = rendered([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {}, { impulseHits: coldHits.map((h) => h - 1) });
    // the warm pass carries the same shift as the row, so only the cold reference can see it
    const warm = rendered([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {}, { impulseHits: coldHits.map((h) => h - 1) });
    const [held, early] = judgeInvariants({ ...loop, invariants: ["samples-equal-warm-pass", "impulse-on-reference"], rangeSeconds: 10 / 44100 }, got, { reference: cold, noLatency: null, warm }, 44100);
    expect(held.holds).toBe(true);
    expect(early.holds).toBe(false);
  });
  it("fails a section loop 4 frames short of its pass, which still covers the row's 43200-frame range", () => {
    const r = buildRows(48000).find((x) => x.id === "one-frame-none-section-loop-twice-48000-0p9-137")!;
    expect(r.invariants).toContain("frames-as-expected");
    const of = (frames: number) => one("frames-as-expected", r, rendered([0.5], {}, { frames }));
    expect(of(43204).holds).toBe(true);
    const short = of(43200);
    expect(short.holds).toBe(false);
    expect(short.detail).toContain("43200 frames, expected 43204");
  });
  it("fails frames-as-expected on a bounce 128 frames short, and on one too long", () => {
    const r = buildRows(48000).find((x) => x.id === "bounce-none-bounce-pre-fader")!;
    const of = (frames: number) => one("frames-as-expected", r, rendered([0.5], {}, { frames }));
    expect(of(192000).holds).toBe(true);
    expect(of(192000 - 128).holds).toBe(false);
    expect(of(192000 - 128).detail).toContain("191872 frames, expected 192000");
    expect(of(192000 + 1).holds).toBe(false);
  });
  it("fails a bounce tap whose render equals the tap before it: the fader or the device did not reach it", () => {
    const byId = (id: string) => buildRows(48000).find((x) => x.id === id)!;
    const earlier = rendered([1, 2, 3, 4, 5], {}, { hash: "earlier" });
    for (const id of ["control-bounce-tap-pre-fader", "control-bounce-tap-post-fader"]) {
      const same = one("differs-from-reference", byId(id), rendered([1, 2, 3, 4, 5], {}, { hash: "earlier" }), { reference: earlier });
      expect(same.holds, id).toBe(false);
      expect(same.finding, id).toBeNull();
      expect(one("differs-from-reference", byId(id), rendered([5, 4, 3, 2, 1], {}, { hash: "later" }), { reference: earlier }).holds, id).toBe(true);
    }
    const preFx = byId("control-bounce-tap-pre-fx");
    const clean = Float32Array.from({ length: 192000 }, (_, i) => Math.sin(i / 9));
    const reference = { ...rendered([0]), samples: [clean], read: read({ frames: 192000 }) };
    const reached = { ...rendered([0]), samples: [clean.map((v) => v / 2)], read: read({ frames: 192000 }) };
    const [hit] = judgeInvariants({ ...preFx, invariants: ["section-is-slice"] }, reached, { reference, noLatency: null, warm: null }, 48000);
    expect(hit.holds).toBe(false);
    expect(hit.finding).toBeNull();
  });
  it("gives a failure that compared nothing no finding", () => {
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const [r] = judgeInvariants({ ...loop, invariants: ["impulse-on-reference"] }, rendered([0], {}, { impulseHits: [1] }), { reference: null, noLatency: null, warm: null }, 44100);
    expect(r.holds).toBe(false);
    expect(r.finding).toBeNull();
  });
});

const entry = (over: Partial<RegisterEntry> = {}): RegisterEntry => ({ hash: "a", frames: 5, channels: 1, peak: 1, impulseHits: [], wav: "x.wav", ...over });

describe("compareRegister", () => {
  it("reads a shift from the register's impulses", () => {
    expect(compareRegister(read({ hash: "b", impulseHits: [99] }), entry({ hash: "a", impulseHits: [100] })))
      .toEqual({ verdict: "changed", shiftFrames: -1, framesChanged: false });
  });
  it("reads no shift when the hits disagree, and a frame count change", () => {
    expect(compareRegister(read({ hash: "b", frames: 6, impulseHits: [99, 300] }), entry({ impulseHits: [100, 300] })))
      .toEqual({ verdict: "changed", shiftFrames: null, framesChanged: true });
  });
  it("reads an equal hash as identical", () => {
    expect(compareRegister(read({ hash: "a" }), entry()).verdict).toBe("identical");
  });
  it("reads a missing entry as unregistered", () => expect(compareRegister(read({}), null).verdict).toBe("unregistered"));
});

describe("parseRegisterResponse", () => {
  it("takes an HTML answer for no register", () => {
    expect(parseRegisterResponse("text/html", "<!doctype html>")).toBeNull();
    expect(parseRegisterResponse("application/json", "<html>")).toBeNull();
    expect(parseRegisterResponse("application/json", '{"rows":{}}')).toEqual({ rows: {} });
  });
});

describe("rowStanding", () => {
  const holds = (): InvariantResult => ({ invariant: "proves-something", holds: true, detail: "", finding: null });
  const fails = (finding: string | null, invariant: InvariantResult["invariant"] = "no-jump"): InvariantResult => ({ invariant, holds: false, detail: "", finding });
  const LABEL = "loop-wrap-keeps-old-read";
  it("ranks a row's standing", () => {
    expect(rowStanding([holds()], null)).toBe("clean");
    expect(rowStanding([fails(LABEL, "no-jump")], null)).toBe("known-finding");
    expect(rowStanding([fails(null, "impulse-on-reference"), fails(LABEL, "no-jump")], null)).toBe("failing");
    expect(rowStanding([holds()], "worker hung")).toBe("errored");
    expect(rowStanding([], null)).toBe("failing");
  });
  it("reads a label no known finding holds as failing: retired, or of another invariant", () => {
    expect(rowStanding([fails("a-label-since-retired", "impulse-on-reference")], null)).toBe("failing");
    expect(rowStanding([fails(LABEL, "impulse-on-reference")], null)).toBe("failing");
  });
});
