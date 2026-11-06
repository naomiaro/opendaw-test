// Plain Node must load this file: the table script judges runs with it, so no SDK value imports.
import { expectedLatencyFrames, LOOP_ON_COPY_SECONDS, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";
import { findingFor, NO_EVIDENCE, type FindingEvidence } from "./exportRegressionFindings.ts";
import { computedFrame, IMPULSE_SOURCE_FRAMES, PROBE_TONE_HZ, PROBE_TONE_LEVEL } from "./exportRegressionSignals.ts";
import { toneStep, uniformEarly } from "./sectionRenderGap.ts";
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

// `compared` is false for a failure that looked at nothing (a missing read, a shape mismatch): no finding fits it
type Outcome = { holds: boolean; detail: string; compared: boolean; evidence: FindingEvidence };
const pass = (detail: string, evidence: FindingEvidence = NO_EVIDENCE): Outcome =>
  ({ holds: true, detail, compared: true, evidence });
const fail = (detail: string, evidence: FindingEvidence = NO_EVIDENCE): Outcome =>
  ({ holds: false, detail, compared: true, evidence });
const failUncompared = (detail: string): Outcome =>
  ({ holds: false, detail, compared: false, evidence: NO_EVIDENCE });

const bitsOf = (channel: Float32Array): Uint32Array =>
  new Uint32Array(channel.buffer, channel.byteOffset, channel.length);

const hasNoFrames = (r: RenderedRow): boolean => r.samples.length === 0 || r.samples[0].length === 0;

const rangeFramesOf = (row: ExportRow, pageRate: number): number => Math.round(row.rangeSeconds * pageRate);
const rangeStartFrame = (row: ExportRow, pageRate: number): number => Math.round(row.rangeStartSeconds * pageRate);

/**
 * Bit patterns of the row's frames against the reference from `offset`, over the frames both hold. The
 * range's frames must all be compared: a short render or a short reference fails by itself.
 */
const compareToSlice = (rendered: RenderedRow, reference: RenderedRow, offset: number, rangeFrames: number): Outcome => {
  if (hasNoFrames(rendered) || hasNoFrames(reference)) return failUncompared("a render holds no frames");
  if (rendered.samples.length !== reference.samples.length) {
    return failUncompared(`channel counts differ: ${rendered.samples.length} against the reference's ${reference.samples.length}`);
  }
  const rowFrames = rendered.samples[0].length;
  const shared = Math.min(rowFrames, reference.samples[0].length - offset);
  if (!(shared > 0)) return failUncompared(`no frames to compare from reference frame ${offset}`);
  let first = -1;
  let last = -1;
  let largest = 0;
  let firstChannel = 0;
  for (let c = 0; c < rendered.samples.length; c++) {
    const a = bitsOf(rendered.samples[c]);
    const b = bitsOf(reference.samples[c]);
    const x = rendered.samples[c];
    const y = reference.samples[c];
    for (let frame = 0; frame < shared; frame++) {
      if (a[frame] === b[offset + frame]) continue;
      if (first < 0 || frame < first) {
        first = frame;
        firstChannel = c;
      }
      if (frame > last) last = frame;
      const delta = Math.abs(x[frame] - y[offset + frame]);
      largest = Number.isNaN(delta) ? Infinity : Math.max(largest, delta);
    }
  }
  if (first >= 0) {
    return fail(
      `differs at frame ${first} of channel ${firstChannel} (reference frame ${offset + first}), last at ${last}, ${shared} frames compared`,
      { earlyFrames: null, firstDifferingFrame: first, lastDifferingFrame: last, largestDifference: largest }
    );
  }
  if (shared < rangeFrames) return fail(`only ${shared} of the range's ${rangeFrames} frames could be compared (render ${rowFrames}, reference from frame ${offset}: ${reference.samples[0].length - offset})`);
  const spare = rowFrames - shared;
  const tail = spare > 0 ? `, ${spare} frames past the reference not compared` : "";
  return pass(`${shared} frames bit-identical from reference frame ${offset}${tail}`);
};

const compareHits = (got: readonly number[], expected: readonly number[], against: string): Outcome => {
  if (expected.length === 0) return failUncompared(`${against} has no impulse in the range, so nothing is proven`);
  const evidence = { ...NO_EVIDENCE, earlyFrames: uniformEarly([...expected], [...got]) };
  const missing = expected.filter((frame) => !got.includes(frame));
  const extra = got.filter((frame) => !expected.includes(frame));
  if (missing.length === 0 && extra.length === 0) return pass(`impulses at [${got.join(", ")}]`, evidence);
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing frames ${missing.join(", ")}`);
  if (extra.length > 0) parts.push(`extra frames ${extra.join(", ")}`);
  return fail(`${parts.join("; ")}; got [${got.join(", ")}], ${against} [${expected.join(", ")}]`, evidence);
};

const needs = (what: string, ref: RenderedRow | null): Outcome | null =>
  ref === null ? failUncompared(`no ${what} read, so nothing can be compared`) : null;

/** One side of the stems' stereo pairs; a Float32Array rounds each add to 32 bits, as the engine's bus does. */
const sumStems = (samples: readonly Float32Array[], side: number): Float32Array => {
  const sum = new Float32Array(samples[0].length);
  for (let c = side; c < samples.length; c += 2) {
    for (let f = 0; f < sum.length; f++) sum[f] += samples[c][f];
  }
  return sum;
};

const judge = (
  invariant: InvariantId, row: ExportRow, rendered: RenderedRow, refs: Refs, pageRate: number
): Outcome => {
  const { read } = rendered;
  const start = rangeStartFrame(row, pageRate);
  const rangeFrames = rangeFramesOf(row, pageRate);
  switch (invariant) {
    case "samples-equal-reference":
    case "section-is-slice":
      return needs("reference", refs.reference) ?? compareToSlice(rendered, refs.reference!, start, rangeFrames);
    case "impulse-on-reference": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const expected = refs.reference!.read.impulseHits
        .filter((hit) => hit >= start && hit < start + rangeFrames).map((hit) => hit - start);
      return compareHits(read.impulseHits, expected, "the reference");
    }
    case "impulse-follows-loop": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const loopFrames = Math.round(LOOP_ON_COPY_SECONDS * pageRate);
      const inLoop = refs.reference!.read.impulseHits.filter((hit) => hit < loopFrames);
      const expected = [...inLoop, ...inLoop.map((hit) => hit + loopFrames)].filter((hit) => hit < rangeFrames);
      return compareHits(read.impulseHits, expected, "the reference's hits through the loop");
    }
    case "impulse-on-computed-frame": {
      const sourceFrames = Math.round(row.sourceRate * row.seconds);
      const expected = IMPULSE_SOURCE_FRAMES.filter((frame) => frame < sourceFrames)
        .map((frame) => computedFrame(frame, row.sourceRate, pageRate))
        .filter((frame) => frame >= start && frame < start + rangeFrames).map((frame) => frame - start);
      return compareHits(read.impulseHits, expected, "the computed frames");
    }
    case "impulse-unmoved-by-latency": {
      const missing = needs("no-latency", refs.noLatency);
      if (missing !== null) return missing;
      return compareHits(read.impulseHits, refs.noLatency!.read.impulseHits, "the no-latency render");
    }
    case "no-jump": {
      if (row.referenceId !== null && refs.reference === null) return failUncompared("no reference read, so the limit is unknown");
      const base = refs.reference !== null
        ? refs.reference.read.largestStep.step
        : toneStep(PROBE_TONE_LEVEL, PROBE_TONE_HZ, pageRate);
      const limit = base * NO_JUMP_RATIO;
      const { step, frame } = read.largestStep;
      const detail = `largest step ${step} at frame ${frame}, limit ${limit}`;
      if (frame < 0 || step === 0) return failUncompared(`no step measured (${detail}): a silent or empty window proves nothing`);
      return step <= limit ? pass(detail) : fail(detail);
    }
    case "muted-latent-unchanged": {
      const missing = needs("no-latency", refs.noLatency);
      if (missing !== null) return missing;
      const other = refs.noLatency!;
      if (hasNoFrames(rendered) || hasNoFrames(other)) return failUncompared("a render holds no frames");
      if (rendered.samples.length !== other.samples.length || rendered.samples[0].length !== other.samples[0].length) {
        return failUncompared(`shape differs: ${rendered.samples.length} x ${rendered.samples[0].length} against ${other.samples.length} x ${other.samples[0].length}`);
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
      if (hasNoFrames(rendered) || hasNoFrames(mix)) return failUncompared("a render holds no frames");
      if (rendered.samples.length % 2 !== 0) return failUncompared(`${rendered.samples.length} channels do not make stereo stems`);
      if (mix.samples.length !== 2) return failUncompared(`the mix has ${mix.samples.length} channels, stems sum to 2`);
      const frames = mix.samples[0].length;
      const uneven = [...rendered.samples, ...mix.samples].find((channel) => channel.length !== frames);
      if (uneven !== undefined) return failUncompared(`a channel holds ${uneven.length} frames, the mix ${frames}`);
      let worst = 0;
      for (let side = 0; side < 2; side++) {
        const sum = sumStems(rendered.samples, side);
        for (let f = 0; f < frames; f++) {
          const delta = Math.abs(sum[f] - mix.samples[side][f]);
          if (Number.isNaN(delta)) return fail(`non-finite difference at frame ${f} of side ${side}`);
          if (delta > worst) worst = delta;
        }
      }
      const detail = `largest difference ${worst}, limit ${STEM_SUM_TOLERANCE}`;
      return worst <= STEM_SUM_TOLERANCE ? pass(detail) : fail(detail);
    }
    case "repeat-identical":
      if (rendered.repeatHash === null) return failUncompared("no repeat read");
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

/**
 * The one shift every impulse of the row shows against the reference's hits in its range (positive: early),
 * read once per row so every invariant of the row sees the same measurement; null when nothing can be read.
 */
const rowEarlyFrames = (
  row: ExportRow, rendered: RenderedRow, reference: RenderedRow | null, pageRate: number
): number | null => {
  if (reference === null) return null;
  const start = rangeStartFrame(row, pageRate);
  const end = start + rangeFramesOf(row, pageRate);
  const expected = reference.read.impulseHits.filter((hit) => hit >= start && hit < end).map((hit) => hit - start);
  return uniformEarly(expected, [...rendered.read.impulseHits]);
};

export function judgeInvariants(row: ExportRow, rendered: RenderedRow, refs: Refs, pageRate: number): InvariantResult[] {
  const earlyFrames = rowEarlyFrames(row, rendered, refs.reference, pageRate);
  return row.invariants.map((invariant) => {
    const outcome = judge(invariant, row, rendered, refs, pageRate);
    const { holds, detail, compared } = outcome;
    const evidence = { ...outcome.evidence, earlyFrames };
    const finding = holds || !compared ? null : findingFor(row, invariant, pageRate, evidence)?.name ?? null;
    return { invariant, holds, detail, finding };
  });
}

export function compareRegister(
  read: RenderRead, entry: RegisterEntry | null
): { verdict: RegisterVerdict; shiftFrames: number | null; framesChanged: boolean } {
  if (entry === null) return { verdict: "unregistered", shiftFrames: null, framesChanged: false };
  const framesChanged = read.frames !== entry.frames;
  if (read.hash === entry.hash) return { verdict: "identical", shiftFrames: null, framesChanged };
  // uniformEarly reads first minus second: the run's hits against the register's, so earlier reads negative
  return { verdict: "changed", shiftFrames: uniformEarly(read.impulseHits, entry.impulseHits), framesChanged };
}

export function rowStanding(
  results: readonly InvariantResult[], error: string | null
): "clean" | "known-finding" | "failing" | "errored" {
  if (error !== null) return "errored";
  if (results.length === 0) return "failing";
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
