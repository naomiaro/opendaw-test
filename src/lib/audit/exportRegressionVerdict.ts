// Plain Node must load this file: the table script judges runs with it, so no SDK value imports.
import {
  expectedFrames, expectedLatencyFrames, loopOnCopyFrames, playbackSegments, regionStartFrameOf,
  type ExportRow, type InvariantId, type PlaybackSegment
} from "./exportRegressionRows.ts";
import { fadeLength, findingFor, KNOWN_FINDINGS, NO_EVIDENCE, type FindingEvidence, type GainBand } from "./exportRegressionFindings.ts";
import { exactFrame, metronomeClickFrame, regionStartFrame } from "./exportRegressionInBlock.ts";
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

export type Refs = { reference: RenderedRow | null; noLatency: RenderedRow | null; warm: RenderedRow | null };

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
// The rounding of a read scaled by a fade, as the findings' ROUNDING: nothing above it is a fade's arithmetic
const CROSSFADE_TOLERANCE = 2e-7;
// A click is a few ms of sound on exact zeros: the next one starts after at least this many zero frames
const CLICK_MIN_GAP_FRAMES = 1000;
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

/** Nothing to compare in the band reads as Infinity: a limit must not pass on frames that are not there. */
const largestBandExcursion = (
  rendered: RenderedRow, reference: RenderedRow, offset: number, shared: number, { from, to, low, high, readOffset }: GainBand
): number => {
  const end = Math.min(to, shared);
  if (from >= end) return Infinity;
  let largest = 0;
  for (let c = 0; c < rendered.samples.length; c++) {
    const x = rendered.samples[c];
    const y = reference.samples[c];
    for (let frame = from; frame < end; frame++) {
      const at = offset + frame;
      const here = y[at];
      const a = low(frame) * here;
      const b = high(frame) * here;
      const outside = Math.max(Math.min(a, b) - x[frame], x[frame] - Math.max(a, b), 0);
      if (Number.isNaN(x[frame]) || Number.isNaN(here)) return Infinity;
      if (outside === 0) continue;
      const slope = Math.max(Math.abs(here - (y[at - 1] ?? here)), Math.abs((y[at + 1] ?? here) - here));
      const excursion = outside - readOffset * slope;
      if (excursion > largest) largest = excursion;
    }
  }
  return largest;
};

const peakOver = (samples: readonly Float32Array[], from: number, to: number): number => {
  let peak = 0;
  for (const channel of samples) {
    const end = Math.min(to, channel.length);
    for (let frame = from; frame < end; frame++) {
      const magnitude = Math.abs(channel[frame]);
      if (Number.isNaN(magnitude)) return Infinity;
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
};

/** The render against the reference up to the wrap, then against a fresh pass plus the old read fading over `fade`. */
const wrapResidueOf = (rendered: RenderedRow, reference: RenderedRow, wrap: number, fade: number): number => {
  if (rendered.samples.length !== reference.samples.length || rendered.samples[0].length !== reference.samples[0].length) return Infinity;
  let largest = 0;
  for (let c = 0; c < rendered.samples.length; c++) {
    const x = rendered.samples[c];
    const y = reference.samples[c];
    for (let frame = 0; frame < x.length; frame++) {
      const passFrame = frame - wrap;
      const expected = passFrame < 0 ? y[frame] : y[passFrame] + y[frame] * Math.max(0, 1 - passFrame / fade);
      const delta = Math.abs(x[frame] - expected);
      if (Number.isNaN(delta)) return Infinity;
      if (delta > largest) largest = delta;
    }
  }
  return largest;
};

/** With nothing left to compare past the delay it proves nothing, so it reads false. */
const isDelayedBy = (
  rendered: RenderedRow, reference: RenderedRow, offset: number, shared: number, frames: number
): boolean => {
  if (!(frames > 0) || frames >= shared) return false;
  for (let c = 0; c < rendered.samples.length; c++) {
    const a = bitsOf(rendered.samples[c]);
    const b = bitsOf(reference.samples[c]);
    for (let frame = frames; frame < shared; frame++) {
      if (a[frame] !== b[offset + frame - frames]) return false;
    }
  }
  return true;
};

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
      {
        ...NO_EVIDENCE, firstDifferingFrame: first, lastDifferingFrame: last, largestDifference: largest, comparedFrames: shared,
        bandExcursion: (band) => largestBandExcursion(rendered, reference, offset, shared, band),
        sameDelayedBy: (frames) => isDelayedBy(rendered, reference, offset, shared, frames),
        headPeak: (frames) => peakOver(rendered.samples, 0, frames)
      }
    );
  }
  if (shared < rangeFrames) {
    return fail(
      `only ${shared} of the range's ${rangeFrames} frames could be compared (render ${rowFrames}, reference from frame ${offset}: ${reference.samples[0].length - offset})`,
      { ...NO_EVIDENCE, comparedFrames: shared }
    );
  }
  const spare = rowFrames - shared;
  const tail = spare > 0 ? `, ${spare} frames past the reference not compared` : "";
  return pass(`${shared} frames bit-identical from reference frame ${offset}${tail}`);
};

/** `predicted` gives the engine's own frames for the same events, for a finding that reads the two side by side. */
const compareHits = (
  got: readonly number[], expected: readonly number[], against: string, predicted: readonly number[] | null = null
): Outcome => {
  if (expected.length === 0) return failUncompared(`${against} has no impulse in the range, so nothing is proven`);
  const missing = expected.filter((frame) => !got.includes(frame));
  const extra = got.filter((frame) => !expected.includes(frame));
  if (missing.length === 0 && extra.length === 0) return pass(`impulses at [${got.join(", ")}]`);
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing frames ${missing.join(", ")}`);
  if (extra.length > 0) parts.push(`extra frames ${extra.join(", ")}`);
  const frameOffsets = predicted !== null && got.length === expected.length
    ? { got: got.map((frame, i) => frame - expected[i]), predicted: predicted.map((frame, i) => frame - expected[i]) }
    : null;
  return fail(`${parts.join("; ")}; got [${got.join(", ")}], ${against} [${expected.join(", ")}]`, { ...NO_EVIDENCE, frameOffsets });
};

/** The first frame of each sound on exact silence: a frame that is not 0 after `minGap` frames that are, or at the start. */
export const findOnsets = (channel: Float32Array, minGap: number): number[] => {
  const onsets: number[] = [];
  let zeros = minGap;
  for (let frame = 0; frame < channel.length; frame++) {
    if (channel[frame] === 0) {
      zeros++;
      continue;
    }
    if (zeros >= minGap) onsets.push(frame);
    zeros = 0;
  }
  return onsets;
};

/** A reference's hits carried through what the render plays: each segment's own, moved to where it is written. */
const hitsThrough = (hits: readonly number[], segments: readonly PlaybackSegment[]): number[] =>
  segments.flatMap(({ out, src, length }) => hits.filter((hit) => hit >= src && hit < src + length).map((hit) => out + hit - src));

/**
 * The render against the reference played through its segments: at a jump the new read fades in over the jump window
 * where the segment says so, and the read it left goes on from where it was, fading out over that window.
 */
const segmentResidue = (
  rendered: RenderedRow, reference: RenderedRow, segments: readonly PlaybackSegment[], fade: number
): { largest: number; frame: number } => {
  let largest = 0;
  let worst = -1;
  scan: for (let c = 0; c < rendered.samples.length; c++) {
    const x = rendered.samples[c];
    const y = reference.samples[c];
    for (const [index, { out, src, length, jump, fadeIn }] of segments.entries()) {
      const before = index > 0 ? segments[index - 1] : null;
      const left = before === null ? 0 : before.src + before.length;
      for (let i = 0; i < length; i++) {
        const frame = out + i;
        let expected = y[src + i] * (jump && fadeIn ? Math.min(1, i / fade) : 1);
        // past the window the old read is gone: its source is not read, and may lie past the reference's end
        if (jump && before !== null && i < fade) expected += y[left + i] * (1 - i / fade);
        const delta = Math.abs(x[frame] - expected);
        if (!(delta <= largest)) {
          largest = Number.isNaN(delta) ? Infinity : delta;
          worst = frame;
          if (largest === Infinity) break scan;
        }
      }
    }
  }
  return { largest, frame: worst };
};

/** Whether the render is silence up to `seat`, then the reference from its first frame, bit for bit, for all the reference holds. */
const isSeatedAt = (rendered: RenderedRow, reference: RenderedRow, seat: number): boolean => {
  if (seat < 0 || rendered.samples[0].length < seat + reference.samples[0].length) return false;
  for (let c = 0; c < rendered.samples.length; c++) {
    const a = bitsOf(rendered.samples[c]);
    const b = bitsOf(reference.samples[c]);
    for (let frame = 0; frame < seat; frame++) if (a[frame] !== 0) return false;
    for (let i = 0; i < b.length; i++) if (a[seat + i] !== b[i]) return false;
  }
  return true;
};

/** Where the engine starts the row's first region, as its own arithmetic does it. */
const regionStartFrameFromEngine = (row: ExportRow, pageRate: number): number => regionStartFrame(row.regionStartPpqn, row.bpm, pageRate);

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
    case "section-is-slice": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      if (row.path !== "loop-on-copy") return compareToSlice(rendered, refs.reference!, start, rangeFrames);
      // Past the wrap it is a second pass, which the reference does not hold: only the first pass is the reference's.
      const firstPass = loopOnCopyFrames(row, pageRate);
      return compareToSlice({ ...rendered, samples: rendered.samples.map((channel) => channel.subarray(0, firstPass)) }, refs.reference!, 0, firstPass);
    }
    case "samples-equal-warm-pass":
      return needs("warm pass", refs.warm) ?? compareToSlice(rendered, refs.warm!, 0, rangeFrames);
    case "impulse-on-reference": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const expected = refs.reference!.read.impulseHits
        .filter((hit) => hit >= start && hit < start + rangeFrames).map((hit) => hit - start);
      return compareHits(read.impulseHits, expected, "the reference");
    }
    case "impulse-follows-loop":
    case "impulse-follows-playback": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const expected = hitsThrough(refs.reference!.read.impulseHits, playbackSegments(row, pageRate));
      return compareHits(read.impulseHits, expected, `the reference's hits through the ${invariant === "impulse-follows-loop" ? "loop" : "playback"}`);
    }
    case "impulse-on-computed-frame": {
      const sourceFrames = Math.round(row.sourceRate * row.seconds);
      // A region that starts inside a block: the engine's own start for it, for a finding to read beside the exact one.
      const regionStart = regionStartFrameOf(row, pageRate);
      const engineStart = regionStart === 0 ? 0 : regionStartFrameFromEngine(row, pageRate);
      const inRange = IMPULSE_SOURCE_FRAMES.filter((frame) => frame < sourceFrames)
        .map((frame) => computedFrame(frame, row.sourceRate, pageRate))
        .filter((frame) => frame + regionStart >= start && frame + regionStart < start + rangeFrames);
      return compareHits(
        read.impulseHits, inRange.map((frame) => frame + regionStart - start), "the computed frames",
        inRange.map((frame) => frame + engineStart - start)
      );
    }
    case "clicks-on-beat-frame": {
      // the source's stem, the bed's, then the metronome's: read by position, so a missing stem must not move it
      if (hasNoFrames(rendered) || rendered.samples.length !== 6) return failUncompared(`${rendered.samples.length} channels, 6 expected: the source's, the bed's and the metronome's stems`);
      // The metronome's stem is appended after the unit stems; a click's first sample is 0, so it sounds a frame later.
      const onsets = findOnsets(rendered.samples[rendered.samples.length - 2], CLICK_MIN_GAP_FRAMES).map((frame) => frame - 1);
      const beats: number[] = [];
      for (let beat = 0; exactFrame(beat, row.bpm, pageRate) < rangeFrames; beat += 960) beats.push(beat);
      const exact = beats.map((beat) => exactFrame(beat, row.bpm, pageRate));
      if (exact.some((frame) => !Number.isInteger(frame))) return failUncompared("a beat between two frames has no frame to be held to");
      return compareHits(onsets, exact, "the beats' frames", beats.map((beat) => metronomeClickFrame(beat, row.bpm, pageRate)));
    }
    case "region-seated-on-start": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const reference = refs.reference!;
      if (hasNoFrames(rendered) || hasNoFrames(reference)) return failUncompared("a render holds no frames");
      if (rendered.samples.length !== reference.samples.length) return failUncompared("channel counts differ");
      const exact = regionStartFrameOf(row, pageRate);
      if (isSeatedAt(rendered, reference, exact)) return pass(`the reference seated on frame ${exact}, bit for bit, ${reference.samples[0].length} frames`);
      // A whole region a frame off is a seat; anything else is no seat at all, and no finding reads it.
      const off = [-1, 1].find((offset) => isSeatedAt(rendered, reference, exact + offset));
      if (off === undefined) return fail(`not the reference seated on frame ${exact}, nor a frame either side of it`);
      return fail(`the reference seated on frame ${exact + off}, bit for bit, not on ${exact}`,
        { ...NO_EVIDENCE, frameOffsets: { got: [off], predicted: [regionStartFrameFromEngine(row, pageRate) - exact] } });
    }
    case "jumps-crossfade": {
      const missing = needs("reference", refs.reference);
      if (missing !== null) return missing;
      const reference = refs.reference!;
      if (hasNoFrames(rendered) || hasNoFrames(reference)) return failUncompared("a render holds no frames");
      if (rendered.samples.length !== reference.samples.length) return failUncompared("channel counts differ");
      const segments = playbackSegments(row, pageRate);
      const last = segments[segments.length - 1];
      if (rendered.samples[0].length < last.out + last.length) return failUncompared(`${rendered.samples[0].length} frames, the playback is ${last.out + last.length}`);
      const reach = Math.max(...segments.map(({ src, length }) => src + length), ...segments.map((s, i) => (i > 0 && s.jump ? segments[i - 1].src + segments[i - 1].length + fadeLength(pageRate) : 0)));
      if (reference.samples[0].length < reach) return failUncompared(`the reference holds ${reference.samples[0].length} frames, the model reads to ${Math.ceil(reach)}`);
      const jumps = segments.filter(({ jump }) => jump).map(({ out }) => out);
      if (jumps.length === 0) return failUncompared("no jump in the range, so nothing is proven");
      const { largest, frame } = segmentResidue(rendered, reference, segments, fadeLength(pageRate));
      const detail = `jumps at [${jumps.join(", ")}], largest residue ${largest} at frame ${frame}, limit ${CROSSFADE_TOLERANCE}`;
      return largest <= CROSSFADE_TOLERANCE ? pass(detail) : fail(detail);
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
      if (step <= limit) return pass(detail);
      const { reference } = refs;
      return fail(detail, {
        ...NO_EVIDENCE, largestStep: { step, frame },
        wrapResidue: (wrap, fade) => (reference === null ? Infinity : wrapResidueOf(rendered, reference, wrap, fade))
      });
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
    case "frames-as-expected": {
      const expected = expectedFrames(row, pageRate);
      const detail = `${read.frames} frames, expected ${expected}`;
      return read.frames === expected ? pass(detail) : fail(detail);
    }
    case "latency-as-expected": {
      const expected = expectedLatencyFrames(row.latencyCase, pageRate);
      const detail = `live engine reported ${rendered.reportedLatencyFrames} frames, expected ${expected}`;
      return rendered.reportedLatencyFrames === expected ? pass(detail) : fail(detail);
    }
  }
};

export function judgeInvariants(row: ExportRow, rendered: RenderedRow, refs: Refs, pageRate: number): InvariantResult[] {
  return row.invariants.map((invariant) => {
    const outcome = judge(invariant, row, rendered, refs, pageRate);
    const { holds, detail, compared } = outcome;
    const evidence: FindingEvidence = {
      ...outcome.evidence,
      silent: rendered.read.frames > 0 && rendered.read.nonFinite === 0 && rendered.read.peak === 0,
      referenceRangePeak: () => {
        if (refs.reference === null) return Infinity;
        const start = rangeStartFrame(row, pageRate);
        return peakOver(refs.reference.samples, start, start + rangeFramesOf(row, pageRate));
      }
    };
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

/** Whether a failed result's label is one this build still knows, of that invariant: a stored summary can hold a retired one. */
export const namesKnownFinding = ({ invariant, finding }: Pick<InvariantResult, "invariant" | "finding">): boolean =>
  KNOWN_FINDINGS.some((known) => known.name === finding && known.invariant === invariant);

export function rowStanding(
  results: readonly InvariantResult[], error: string | null
): "clean" | "known-finding" | "failing" | "errored" {
  if (error !== null) return "errored";
  if (results.length === 0) return "failing";
  const failed = results.filter((r) => !r.holds);
  if (failed.length === 0) return "clean";
  return failed.every(namesKnownFinding) ? "known-finding" : "failing";
}

/** Null for an answer that is not a register: the SPA fallback is HTML with status 200. Bad JSON throws. */
export function parseRegisterResponse(contentType: string | null, body: string): unknown | null {
  if (contentType !== null && contentType.includes("text/html")) return null;
  if (body.trimStart().startsWith("<")) return null;
  return JSON.parse(body);
}
