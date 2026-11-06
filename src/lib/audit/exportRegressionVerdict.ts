// Plain Node must load this file: the table script judges runs with it, so no SDK value imports.
import { expectedLatencyFrames, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";
import { findingFor } from "./exportRegressionFindings.ts";
import { IMPULSE_SOURCE_FRAMES, PROBE_TONE_HZ, PROBE_TONE_LEVEL } from "./exportRegressionSignals.ts";
import { toneStep } from "./sectionRenderGap.ts";
import type { RenderRead } from "./exportRegressionReader.ts";

export type RenderedRow = {
  read: RenderRead;
  samples: readonly Float32Array[];
  reportedLatencyFrames: number;
  repeatHash: string | null;
};

export type InvariantResult = {
  invariant: InvariantId;
  holds: boolean;
  detail: string;
  finding: string | null;
};

export type Refs = { reference: RenderedRow | null; noLatency: RenderedRow | null };

export type RegisterEntry = {
  hash: string;
  frames: number;
  channels: number;
  peak: number;
  impulseHits: number[];
  wav: string;
};
export type RegisterVerdict = "identical" | "changed" | "unregistered";

const NO_JUMP_RATIO = 1.05;
const TAIL_PRESENT_RMS = 1e-4;
// 2^-21, the rounding of summing float32 stems; nothing above it is rounding
const STEM_SUM_TOLERANCE = 4.8e-7;

type Outcome = { holds: boolean; detail: string };
const pass = (detail: string): Outcome => ({ holds: true, detail });
const fail = (detail: string): Outcome => ({ holds: false, detail });

const bitsOf = (channel: Float32Array): Uint32Array =>
  new Uint32Array(channel.buffer, channel.byteOffset, channel.length);

const rangeFramesOf = (row: ExportRow, pageRate: number): number => Math.round(row.rangeSeconds * pageRate);
const rangeStartFrame = (row: ExportRow, pageRate: number): number => Math.round(row.rangeStartSeconds * pageRate);

/** Bit patterns of the row's frames against the reference from `offset`, over the frames both hold. */
const compareToSlice = (rendered: RenderedRow, reference: RenderedRow, offset: number): Outcome => {
  if (rendered.samples.length !== reference.samples.length) {
    return fail(`channel counts differ: ${rendered.samples.length} against the reference's ${reference.samples.length}`);
  }
  const shared = Math.min(rendered.samples[0].length, reference.samples[0].length - offset);
  if (!(shared > 0)) return fail(`no frames to compare from reference frame ${offset}`);
  for (let frame = 0; frame < shared; frame++) {
    for (let c = 0; c < rendered.samples.length; c++) {
      if (bitsOf(rendered.samples[c])[frame] !== bitsOf(reference.samples[c])[offset + frame]) {
        return fail(`differs at frame ${frame} of channel ${c} (reference frame ${offset + frame}), ${shared} frames compared`);
      }
    }
  }
  return pass(`${shared} frames bit-identical from reference frame ${offset}`);
};

const compareHits = (got: readonly number[], expected: readonly number[], against: string): Outcome => {
  if (expected.length === 0) return fail(`${against} has no impulse in the range, so nothing is proven`);
  const missing = expected.filter((frame) => !got.includes(frame));
  const extra = got.filter((frame) => !expected.includes(frame));
  if (missing.length === 0 && extra.length === 0) return pass(`impulses at [${got.join(", ")}]`);
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing frames ${missing.join(", ")}`);
  if (extra.length > 0) parts.push(`extra frames ${extra.join(", ")}`);
  return fail(`${parts.join("; ")}; got [${got.join(", ")}], ${against} [${expected.join(", ")}]`);
};

const needs = (what: string, ref: RenderedRow | null): Outcome | null =>
  ref === null ? fail(`no ${what} read, so nothing can be compared`) : null;

const judge = (
  invariant: InvariantId, row: ExportRow, rendered: RenderedRow, refs: Refs, pageRate: number
): Outcome => {
  const { read } = rendered;
  const start = rangeStartFrame(row, pageRate);
  const rangeFrames = rangeFramesOf(row, pageRate);
  switch (invariant) {
    case "samples-equal-reference":
    case "section-is-slice":
      return needs("reference", refs.reference) ?? compareToSlice(rendered, refs.reference!, start);
    case "impulse-on-reference": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const expected = refs.reference!.read.impulseHits
        .filter((hit) => hit >= start && hit < start + rangeFrames).map((hit) => hit - start);
      return compareHits(read.impulseHits, expected, "the reference");
    }
    case "impulse-on-computed-frame": {
      const sourceFrames = Math.round(row.sourceRate * row.seconds);
      const expected = IMPULSE_SOURCE_FRAMES.filter((frame) => frame < sourceFrames)
        // the same rounding as computedFrame in exportRegressionReader, which this file cannot import
        .map((frame) => Math.round((frame * pageRate) / row.sourceRate))
        .filter((frame) => frame >= start && frame < start + rangeFrames).map((frame) => frame - start);
      return compareHits(read.impulseHits, expected, "the computed frames");
    }
    case "impulse-unmoved-by-latency": {
      const missing = needs("no-latency", refs.noLatency);
      if (missing !== null) return missing;
      return compareHits(read.impulseHits, refs.noLatency!.read.impulseHits, "the no-latency render");
    }
    case "no-jump": {
      if (row.referenceId !== null && refs.reference === null) return fail("no reference read, so the limit is unknown");
      const base = refs.reference !== null
        ? refs.reference.read.largestStep.step
        : toneStep(PROBE_TONE_LEVEL, PROBE_TONE_HZ, pageRate);
      const limit = base * NO_JUMP_RATIO;
      const { step, frame } = read.largestStep;
      const detail = `largest step ${step} at frame ${frame}, limit ${limit}`;
      return step <= limit ? pass(detail) : fail(detail);
    }
    case "muted-latent-unchanged": {
      const missing = needs("no-latency", refs.noLatency);
      if (missing !== null) return missing;
      const other = refs.noLatency!;
      if (rendered.samples.length !== other.samples.length || rendered.samples[0].length !== other.samples[0].length) {
        return fail(`shape differs: ${rendered.samples.length} x ${rendered.samples[0].length} against ${other.samples.length} x ${other.samples[0].length}`);
      }
      let last = -1;
      for (let c = 0; c < rendered.samples.length; c++) {
        const a = bitsOf(rendered.samples[c]);
        const b = bitsOf(other.samples[c]);
        for (let f = a.length - 1; f > last; f--) {
          if (a[f] !== b[f]) {
            last = f;
            break;
          }
        }
      }
      return last < 0 ? pass("bit-identical") : fail(`differs up to frame ${last}`);
    }
    case "disabled-equals-absent": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      return read.hash === refs.reference!.read.hash ? pass("hash equals the absent-device render") : fail(`hash ${read.hash} differs from the absent-device render's ${refs.reference!.read.hash}`);
    }
    case "differs-from-reference": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      return read.hash !== refs.reference!.read.hash ? pass("hash differs from the reference") : fail("hash equals the reference's: the change had no effect");
    }
    case "stems-sum-to-mix": {
      const missing = needs("mix", refs.reference);
      if (missing !== null) return missing;
      const mix = refs.reference!;
      if (rendered.samples.length !== mix.samples.length || rendered.samples[0].length !== mix.samples[0].length) {
        return fail(`shape differs: ${rendered.samples.length} x ${rendered.samples[0].length} against the mix's ${mix.samples.length} x ${mix.samples[0].length}`);
      }
      let worst = 0;
      for (let c = 0; c < rendered.samples.length; c++) {
        for (let f = 0; f < rendered.samples[c].length; f++) {
          const delta = Math.abs(rendered.samples[c][f] - mix.samples[c][f]);
          if (Number.isNaN(delta)) return fail(`non-finite difference at frame ${f} of channel ${c}`);
          if (delta > worst) worst = delta;
        }
      }
      const detail = `largest difference ${worst}, limit ${STEM_SUM_TOLERANCE}`;
      return worst <= STEM_SUM_TOLERANCE ? pass(detail) : fail(detail);
    }
    case "repeat-identical":
      if (rendered.repeatHash === null) return fail("no repeat read");
      return rendered.repeatHash === read.hash ? pass("repeat hash equals the first render's") : fail(`repeat hash ${rendered.repeatHash} differs from ${read.hash}`);
    case "tail-present": {
      const energy = read.energyPastRange;
      if (energy === null) return fail(`no frames past the range (${read.frames} of ${rangeFrames})`);
      return energy > TAIL_PRESENT_RMS ? pass(`rms past the range ${energy}`) : fail(`rms past the range ${energy}, needs over ${TAIL_PRESENT_RMS}`);
    }
    case "tail-absent": {
      const energy = read.energyPastRange;
      if (read.frames !== rangeFrames) return fail(`${read.frames} frames, the range is ${rangeFrames}`);
      return energy === null || energy === 0 ? pass(`exactly the range's ${rangeFrames} frames`) : fail(`rms past the range ${energy}`);
    }
    case "proves-something": {
      if (read.nonFinite > 0) return fail(`${read.nonFinite} non-finite samples`);
      if (!(read.peak > 0) || read.frames === 0) return fail(`silent render: peak ${read.peak}, ${read.frames} frames`);
      return pass(`peak ${read.peak}, ${read.frames} frames`);
    }
    case "latency-as-expected": {
      const expected = expectedLatencyFrames(row.latencyCase, pageRate);
      const detail = `reported ${rendered.reportedLatencyFrames} frames, expected ${expected}`;
      return rendered.reportedLatencyFrames === expected ? pass(detail) : fail(detail);
    }
  }
};

export function judgeInvariants(row: ExportRow, rendered: RenderedRow, refs: Refs, pageRate: number): InvariantResult[] {
  return row.invariants.map((invariant) => {
    const { holds, detail } = judge(invariant, row, rendered, refs, pageRate);
    const finding = holds ? null : findingFor(row, invariant, pageRate)?.name ?? null;
    return { invariant, holds, detail, finding };
  });
}

export function compareRegister(
  read: RenderRead, entry: RegisterEntry | null
): { verdict: RegisterVerdict; shiftFrames: number | null; framesChanged: boolean } {
  if (entry === null) return { verdict: "unregistered", shiftFrames: null, framesChanged: false };
  const framesChanged = read.frames !== entry.frames;
  if (read.hash === entry.hash) return { verdict: "identical", shiftFrames: null, framesChanged };
  const hits = read.impulseHits;
  let shiftFrames: number | null = null;
  if (hits.length > 0 && hits.length === entry.impulseHits.length) {
    const first = hits[0] - entry.impulseHits[0];
    if (hits.every((hit, i) => hit - entry.impulseHits[i] === first)) shiftFrames = first;
  }
  return { verdict: "changed", shiftFrames, framesChanged };
}

export function rowStanding(
  results: readonly InvariantResult[], error: string | null
): "clean" | "known-finding" | "failing" | "errored" {
  if (error !== null) return "errored";
  const failed = results.filter((r) => !r.holds);
  if (failed.length === 0) return "clean";
  return failed.every((r) => r.finding !== null) ? "known-finding" : "failing";
}

/** Null for an answer that is not a register: the SPA fallback is HTML with status 200. Bad JSON throws. */
export function parseRegisterResponse(contentType: string | null, body: string): unknown | null {
  if (contentType !== null && contentType.includes("text/html")) return null;
  if (body.trimStart().startsWith("<")) return null;
  return JSON.parse(body);
}
