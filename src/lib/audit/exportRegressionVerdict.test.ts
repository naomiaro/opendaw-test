import { describe, expect, it } from "vitest";
import { buildRows, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";
import { toneStep } from "./sectionRenderGap.ts";
import { IMPULSE_SOURCE_FRAMES, PROBE_TONE_HZ, PROBE_TONE_LEVEL } from "./exportRegressionSignals.ts";
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
const one = (inv: InvariantId, r: ExportRow, got: RenderedRow, refs: { reference?: RenderedRow | null; noLatency?: RenderedRow | null } = {}, rate = 48000) =>
  judgeInvariants({ ...r, invariants: [inv] }, got, { reference: refs.reference ?? null, noLatency: refs.noLatency ?? null }, rate)[0];

describe("judgeInvariants", () => {
  it("fails section-is-slice on one frame early, with no allowance", () => {
    const ref = rendered([0, 0, 1, 0, 0]);
    const early = rendered([0, 1, 0, 0, 0]);
    const [r] = judgeInvariants(row({ invariants: ["section-is-slice"] }), early, { reference: ref, noLatency: null }, 48000);
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
  it("compares a setposition row with the reference from its start frame", () => {
    const ref = rendered([9, 9, 1, 2, 3, 4]);
    const r = row({ rangeStartSeconds: 2 / 48000, rangeSeconds: 4 / 48000 });
    expect(one("samples-equal-reference", r, rendered([1, 2, 3, 4]), { reference: ref }).holds).toBe(true);
    expect(one("samples-equal-reference", r, rendered([9, 9, 1, 2]), { reference: ref }).holds).toBe(false);
  });
  it("fails when the reference it needs is missing, never by default", () => {
    for (const inv of ["samples-equal-reference", "impulse-on-reference", "disabled-equals-absent", "differs-from-reference", "stems-sum-to-mix"] as const) {
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
  it("holds stems-sum-to-mix within rounding only", () => {
    const mix = rendered([0.5, 0.25]);
    expect(one("stems-sum-to-mix", row(), rendered([0.5 + 4.7e-7, 0.25]), { reference: mix }).holds).toBe(true);
    expect(one("stems-sum-to-mix", row(), rendered([0.5 + 1e-4, 0.25]), { reference: mix }).holds).toBe(false);
    expect(one("stems-sum-to-mix", row(), rendered([0.5, NaN]), { reference: mix }).holds).toBe(false);
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
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const frames = Math.round(loop.rangeSeconds * 44100);
    const refHits = [5000, 20000, 40000];
    const ref = rendered([[1, 2]], {}, { impulseHits: refHits });
    const judged = (shift: number[] | number, inv: InvariantId = "impulse-on-reference") => {
      const hits = typeof shift === "number" ? refHits.map((h) => h - shift) : shift;
      return judgeInvariants({ ...loop, invariants: [inv], rangeSeconds: frames / 44100 }, rendered([[1, 2]], {}, { impulseHits: hits }), { reference: ref, noLatency: null }, 44100)[0];
    };
    expect(judged(1).holds).toBe(false);
    expect(judged(1).finding).toBe("one-frame-early-44100");
    expect(judged(1000).finding).toBeNull();
    expect(judged(37).finding).toBeNull();
    expect(judged([4999, 19999, 39998]).finding).toBeNull();
    expect(judged(0).holds).toBe(true);
    expect(judged(0).finding).toBeNull();
    const other = judgeInvariants({ ...loop, invariants: ["proves-something"] }, rendered([0], {}, { peak: 0 }), { reference: null, noLatency: null }, 44100)[0];
    expect(other.finding).toBeNull();
  });
  it("names the slice finding only on a one-frame-early measurement", () => {
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const r = { ...loop, invariants: ["section-is-slice" as const], rangeSeconds: 5 / 44100 };
    // a sample slice carries no impulses, so it measures no shift and no finding matches
    const [bad] = judgeInvariants(r, rendered([0, 1, 0, 0, 0]), { reference: rendered([0, 0, 1, 0, 0]), noLatency: null }, 44100);
    expect(bad.holds).toBe(false);
    expect(bad.finding).toBeNull();
  });
  it("gives a failure that compared nothing no finding", () => {
    const loop = buildRows(44100).find((x) => x.id === "core-none-section-loop-twice")!;
    const [r] = judgeInvariants({ ...loop, invariants: ["impulse-on-reference"] }, rendered([0], {}, { impulseHits: [1] }), { reference: null, noLatency: null }, 44100);
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
  const fails = (finding: string | null): InvariantResult => ({ invariant: "no-jump", holds: false, detail: "", finding });
  it("ranks a row's standing", () => {
    expect(rowStanding([holds()], null)).toBe("clean");
    expect(rowStanding([fails("one-frame-early-44100")], null)).toBe("known-finding");
    expect(rowStanding([fails(null), fails("x")], null)).toBe("failing");
    expect(rowStanding([holds()], "worker hung")).toBe("errored");
    expect(rowStanding([], null)).toBe("failing");
  });
});
