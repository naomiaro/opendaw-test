// Plain Node must load this file: the table script reads it, so no SDK value imports.
import { expectedLatencyFrames, loopOnCopyFrames, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";

/** How far a row may sit from the reference: between `low` and `high` times it, per frame, on a read offset by `readOffset` frames. */
export type GainBand = {
  from: number;
  to: number;
  low: (frame: number) => number;
  high: (frame: number) => number;
  readOffset: number;
};

/** What the verdict measured on a failing invariant; null where the invariant took no such measurement. */
export type FindingEvidence = {
  firstDifferingFrame: number | null;
  lastDifferingFrame: number | null;
  largestDifference: number | null;
  /** The frames the comparison reached, whatever it found on them. */
  comparedFrames: number | null;
  /** The render holds no signal at all, and nothing non-finite. */
  silent: boolean | null;
  largestStep: { step: number; frame: number } | null;
  /** The largest distance outside the band, past what the read's offset explains. Nothing compared reads as Infinity. */
  bandExcursion: (band: GainBand) => number;
  /** Whether the row, from `frames` on, is the reference delayed by `frames`, bit for bit. */
  sameDelayedBy: (frames: number) => boolean;
  /** The row's peak over its first frames. */
  headPeak: (frames: number) => number;
  /** How far the row sits from a loop of the reference that wraps at `wrap`: a fresh pass, with the old read fading over `fade`. */
  wrapResidue: (wrap: number, fade: number) => number;
  /** The reference's peak over the row's range. */
  referenceRangePeak: () => number;
};

export const NO_EVIDENCE: FindingEvidence = {
  firstDifferingFrame: null, lastDifferingFrame: null, largestDifference: null,
  comparedFrames: null, silent: null, largestStep: null,
  bandExcursion: () => Infinity,
  sameDelayedBy: () => false,
  headPeak: () => Infinity,
  wrapResidue: () => Infinity,
  referenceRangePeak: () => Infinity
};

/** A claim that a behaviour has been read and is understood, not that it is right: the note says what was read. */
export type KnownFinding = {
  name: string;
  invariant: InvariantId;
  note: string;
  applies: (row: ExportRow, pageRate: number) => boolean;
  signature: (evidence: FindingEvidence, row: ExportRow, pageRate: number) => boolean;
};

const rangeFrames = (row: ExportRow, pageRate: number): number => Math.round(row.rangeSeconds * pageRate);

// crates/engine/src/audio_region_player.rs JUMP_FADE_DURATION, in frames of the page; 220.5 at 44.1 kHz counts down over 221
export const fadeLength = (pageRate: number): number => 0.005 * pageRate;
const fadeFrames = (pageRate: number): number => Math.ceil(fadeLength(pageRate));
const rampOf = (pageRate: number) => (frame: number): number => Math.min(1, frame / fadeLength(pageRate));
const unity = (): number => 1;

// Measured: the rounding of a read scaled by the ramp, 4e-8 on every row without a device on its chain.
const ROUNDING = 2e-7;
// Measured on `several` alone, a Compressor and a Fold on the source: the ramp reaches their memory, 5.6e-5 inside the
// fade and 3.5e-5 over the 8 frames after it, -89 dB. Bit-identical from there at 48 kHz.
const chainFrames = ({ latencyCase }: ExportRow): number => (latencyCase === "several" ? 8 : 0);
const windowTolerance = ({ latencyCase }: ExportRow): number => (latencyCase === "several" ? 7e-5 : ROUNDING);

/**
 * Frames a read started at the row's own start sits from a read that free-ran there. The free-running read advances by
 * `(source_rate / engine_rate) as f64` of two f32s (audio_region_player.rs:849), so it drifts from the exact ratio per
 * output frame; a read seated at the start has no such drift. A start between two frames adds its fraction, which the
 * comparison at the nearest whole frame sees. At equal rates and a whole frame this is 0: nothing may differ.
 * The slack is on a frame's local slope, which understates a linearly interpolated impulse: measured up to 1.7, and 5.3
 * through the Fold of `several`.
 */
const readOffset = (row: ExportRow, pageRate: number, startFrame: number = row.rangeStartSeconds * pageRate): number => {
  const exact = row.sourceRate / pageRate;
  const drift = startFrame * Math.abs(Math.fround(exact) - exact);
  const betweenFrames = Math.abs(startFrame - Math.round(startFrame));
  const slack = row.latencyCase === "several" ? 6 : 2;
  return (drift / exact + betweenFrames) * slack;
};

const fadedStart = (invariant: InvariantId, applies: KnownFinding["applies"]): KnownFinding => ({
  name: "jump-fade-at-start",
  invariant,
  note: "the first block of a render that starts inside a region is a transport jump: the region's read fades in linearly over 5 ms, frame i at i/240 at 48 kHz (audio_region_player.rs:862, :913; upstream test transport_jump_inside_a_native_region_crossfades). A reference that ran through that point has no fade. The signature holds the row to that ramp inside the window and to the reference past it, bit for bit at 48 kHz, within the read's own drift at a resampled rate",
  applies,
  signature: ({ firstDifferingFrame, comparedFrames, bandExcursion }, row, pageRate) => {
    const offset = readOffset(row, pageRate);
    const ramp = rampOf(pageRate);
    const settled = fadeFrames(pageRate) + chainFrames(row);
    // `start` keeps a quarter second past a range it was given, so it compares more than the range, never less
    const covered = comparedFrames !== null
      && (row.exportRange
        // the quarter second `render` keeps after the last sound, and the quantum it keeps that sound in
        ? comparedFrames >= rangeFrames(row, pageRate) && comparedFrames <= rangeFrames(row, pageRate) + Math.ceil(0.25 * pageRate) + 128
        : comparedFrames === rangeFrames(row, pageRate));
    return firstDifferingFrame === 0 && covered
      && bandExcursion({ from: 0, to: settled, low: ramp, high: ramp, readOffset: offset }) <= windowTolerance(row)
      && bandExcursion({ from: settled, to: Infinity, low: unity, high: unity, readOffset: offset }) <= ROUNDING;
  }
});

// Measured: the frame the cold limiter is within rounding of the warm one (bit-identical from 3431 at 48 kHz), and what
// it holds until then. Against the faded reference it runs from 1.0 to 1.50 at 48 kHz, 0.996 to 1.504 at 44.1, where the
// read's drift moves the ratio a little.
const COLD_MAXIMIZER_FRAMES: Readonly<Record<number, number>> = { 48000: 1168, 44100: 1627 };
const COLD_MAXIMIZER_LOW = 0.99;
const COLD_MAXIMIZER_HIGH = 1.51;

const missingTail = (invariant: InvariantId, signature: KnownFinding["signature"]): KnownFinding => ({
  name: "range-missing-tail",
  invariant,
  note: "a range that starts after the content has ended renders silent: a render starts cold, so a Reverb has nothing to ring with, where a render that ran through that point holds the tail (-54 dB here). No pre-roll exists on any section path",
  applies: (row) => row.group === "tail" && row.path === "section-marker",
  signature
});

// Measured: the reverb's peak over the range, 0.0021 at 48 kHz and 0.0020 at 44.1. Silent there too, no tail is missing.
const TAIL_REFERENCE_LOW = 0.001;
const TAIL_REFERENCE_HIGH = 0.003;
// Measured: the head of a reset is exact silence, except through `several` (0.0031 at 48 kHz, 0.0023 at 44.1).
const resetHeadLimit = ({ latencyCase }: ExportRow): number => (latencyCase === "several" ? 0.0035 : 0);
// Measured: the frames `render` keeps of a 4 s region whose 200 ms burst has rung out. It keeps every render quantum up
// to the last one holding a sample over -72 dB, then exactly a quarter second of the silence after it (core-wasm
// silence-tail.ts:39-41, framesToKeep).
const TRIMMED_FRAMES: Readonly<Record<number, number>> = { 48000: 81120, 44100: 74129 };
// The doubled tone's largest step at each rate, rounded up from what was measured on every case.
const WRAP_STEP_LIMIT: Readonly<Record<number, number>> = { 48000: 0.131, 44100: 0.142 };

// Measured: `render` keeps every quantum up to the one holding the last sound, then exactly a quarter second (0.0.183)
const QUANTUM_FRAMES = 128;
const renderedToSongEnd = (row: ExportRow, pageRate: number): number =>
  Math.ceil(Math.round(row.seconds * pageRate) / QUANTUM_FRAMES) * QUANTUM_FRAMES + Math.round(0.25 * pageRate);

export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    name: "merge-seam-reseats-read",
    invariant: "section-is-slice",
    note: "at a cut's seam the second region's read is seated at the exact position and the first's old read fades out across its 20 ms fade-in (audio_region_player.rs:942, a transparent self-crossfade). So the merge is bit-identical up to the seam, within rounding across the crossfade (-150.5 dB at 48 kHz), and at a resampled rate within the free-running read's drift from there on, as at a start inside a region",
    applies: (row) => row.path === "bounce-merge",
    signature: ({ firstDifferingFrame, comparedFrames, bandExcursion }, row, pageRate) => {
      const seam = (row.seconds / 2) * pageRate;
      return firstDifferingFrame !== null && firstDifferingFrame >= seam && comparedFrames === rangeFrames(row, pageRate)
        && bandExcursion({ from: 0, to: Infinity, low: unity, high: unity, readOffset: readOffset(row, pageRate, seam) }) <= ROUNDING;
    }
  },
  fadedStart("section-is-slice", (row) => (row.group === "core" && row.path.startsWith("section-marker")) || row.exportRange),
  fadedStart("samples-equal-reference", (row) => row.path.startsWith("setposition-")),
  {
    name: "jump-fade-cold-maximizer",
    invariant: "section-is-slice",
    note: "the jump fade again, through a master Maximizer that starts cold where the reference's has been limiting since frame 0 (peak-hold + 200 ms release, device-maximizer). The two are within rounding from frame 1168 and bit-identical from 3431 at 48 kHz: until then the section is up to 1.5x the reference, inferred to be the reference's envelope still holding an older, higher sampled peak",
    applies: (row) => row.group === "master" && row.path === "section-marker",
    signature: ({ firstDifferingFrame, comparedFrames, bandExcursion }, row, pageRate) => {
      const offset = readOffset(row, pageRate);
      const ramp = rampOf(pageRate);
      const settled = COLD_MAXIMIZER_FRAMES[pageRate] ?? Infinity;
      return firstDifferingFrame === 0 && comparedFrames === rangeFrames(row, pageRate)
        && bandExcursion({
          from: 0, to: settled, readOffset: offset,
          low: (frame) => ramp(frame) * COLD_MAXIMIZER_LOW, high: (frame) => ramp(frame) * COLD_MAXIMIZER_HIGH
        }) <= ROUNDING
        && bandExcursion({ from: settled, to: Infinity, low: unity, high: unity, readOffset: offset }) <= ROUNDING;
    }
  },
  {
    name: "reset-keeps-compensation-delay",
    invariant: "samples-equal-reference",
    note: "a second play on one renderer keeps the compensation delay: the worker settles once and trims once per renderer (latencyToTrim, core-wasm offline-worker.ts settle and trimStart), so after a stop the first latency frames stay in. The render is a silent head, then the reference delayed by exactly the reported figure, bit for bit",
    applies: (row) => row.path === "step-reset" && row.latencyCase !== "none",
    signature: ({ comparedFrames, sameDelayedBy, headPeak }, row, pageRate) => {
      const latency = expectedLatencyFrames(row.latencyCase, pageRate);
      return comparedFrames === rangeFrames(row, pageRate) && sameDelayedBy(latency) && headPeak(latency) <= resetHeadLimit(row);
    }
  },
  missingTail("proves-something", ({ silent, referenceRangePeak }) => {
    if (silent !== true) return false;
    const peak = referenceRangePeak();
    return peak >= TAIL_REFERENCE_LOW && peak <= TAIL_REFERENCE_HIGH;
  }),
  missingTail("section-is-slice", ({ silent, firstDifferingFrame, lastDifferingFrame, comparedFrames, largestDifference }, row, pageRate) =>
    silent === true && comparedFrames === rangeFrames(row, pageRate)
    && firstDifferingFrame === 0 && lastDifferingFrame === rangeFrames(row, pageRate) - 1
    && largestDifference !== null && largestDifference <= TAIL_REFERENCE_HIGH),
  {
    name: "trailing-silence-trimmed",
    invariant: "section-is-slice",
    note: "by design: an entire-song or start render goes through `render`, which stops after silence and keeps exactly 250 ms of it (core-wasm silence-tail.ts:39-41 framesToKeep, which offline-worker.ts render reads), so a song whose end is silent comes out shorter than its last region, with nothing lost. A bounce keeps its exact span (AudioBounce.ts audibleLength)",
    applies: (row) => row.group === "tail" && row.seconds === 4 && (row.path === "section-entire" || row.path === "start"),
    signature: ({ firstDifferingFrame, comparedFrames }, _row, pageRate) =>
      firstDifferingFrame === null && comparedFrames !== null && comparedFrames === TRIMMED_FRAMES[pageRate]
  },
  {
    name: "loop-wrap-keeps-old-read",
    invariant: "no-jump",
    note: "at a loop wrap to a region's start the new read starts at full level and only the old one fades, over 5 ms (audio_region_player.rs:322 seeds the tail, :862 fades in only past the region start; upstream test transport_jump_to_the_region_start_keeps_the_onset): in phase the two sum, here a 0.5 sine reaching 0.975 for 240 frames at 48 kHz. The signature holds the whole render to that: the reference up to the wrap, the fresh pass and the fading old read over 5 ms, the fresh pass after, so no other jump passes under the wrap's step",
    applies: (row) => row.path === "loop-on-copy",
    signature: ({ largestStep, wrapResidue }, row, pageRate) => {
      const wrap = loopOnCopyFrames(row, pageRate);
      return largestStep !== null && largestStep.frame === wrap + 1
        && largestStep.step <= (WRAP_STEP_LIMIT[pageRate] ?? -1)
        && wrapResidue(wrap, fadeLength(pageRate)) <= ROUNDING;
    }
  },
  {
    name: "range-end-is-a-minimum",
    invariant: "frames-as-expected",
    note: "an `ExportConfiguration.range` passed to `start` sets the render's minimum length, not its end: `minDurationSeconds` is the range's length and `maxDurationSeconds` 30 s more (OfflineEngineRenderer.ts:271-282), and `render` stops only on 10 s of silence past the minimum (offline-worker.ts). A range ending inside sound comes back running on to the song's end, here 2 s of music past the range, then a quarter second, bit for bit the song. Upstream's plan records it (openDAW plans/issues/434-mixdown-sections.md:21-24: a range \"still renders a tail, never ends sample-exact\") and answered with `renderSection`; no studio caller passes a range",
    applies: (row) => row.exportRange && row.path === "start",
    signature: ({ comparedFrames }, row, pageRate) => comparedFrames === renderedToSongEnd(row, pageRate)
  }
];

export const findingFor = (
  row: ExportRow, invariant: InvariantId, pageRate: number, evidence: FindingEvidence
): KnownFinding | null =>
  KNOWN_FINDINGS.find((finding) =>
    finding.invariant === invariant && finding.applies(row, pageRate) && finding.signature(evidence, row, pageRate)) ?? null;
