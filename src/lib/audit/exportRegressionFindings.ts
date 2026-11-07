// Plain Node must load this file: the table script reads it, so no SDK value imports.
import { expectedLatencyFrames, LOOP_ON_COPY_SECONDS, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";
import { PROBE_TONE_HZ, PROBE_TONE_LEVEL } from "./exportRegressionSignals.ts";
import { toneStep } from "./sectionRenderGap.ts";

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
  earlyFrames: number | null;
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
  /** The row's peak on one frame, across its channels. */
  framePeak: (frame: number) => number;
  /** How far the row sits from a loop of the reference that wraps at `wrap`: a fresh pass, with the old read fading over `fade`. */
  wrapResidue: (wrap: number, fade: number) => number;
  /** The reference's peak over the row's range. */
  referenceRangePeak: () => number;
  /** The reference's peak over these of its frames. */
  referencePeakOver: (from: number, to: number) => number;
  /** Whether the row's samples equal the warm pass it is held to, bit for bit, this frame aside (-1 for none). */
  warmHolds: (exceptFrame: number) => boolean;
};

export const NO_EVIDENCE: FindingEvidence = {
  earlyFrames: null, firstDifferingFrame: null, lastDifferingFrame: null, largestDifference: null,
  comparedFrames: null, silent: null, largestStep: null,
  bandExcursion: () => Infinity,
  sameDelayedBy: () => false,
  headPeak: () => Infinity,
  framePeak: () => Infinity,
  wrapResidue: () => Infinity,
  referenceRangePeak: () => Infinity,
  referencePeakOver: () => Infinity,
  warmHolds: () => false
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
const fadeLength = (pageRate: number): number => 0.005 * pageRate;
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
    return firstDifferingFrame === 0 && comparedFrames === rangeFrames(row, pageRate)
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
// The frames `render` keeps of a 4 s region whose 200 ms burst has rung out, tail and 250 ms included.
const TRIMMED_FRAMES: Readonly<Record<number, number>> = { 48000: 80992, 44100: 74001 };
// The doubled tone's largest step at each rate, rounded up from what was measured on every case.
const WRAP_STEP_LIMIT: Readonly<Record<number, number>> = { 48000: 0.131, 44100: 0.142 };

const GAP_ROWS: ReadonlySet<string> = new Set(["gap-none-start", "gap-none-section-entire", "gap-none-stem-start"]);
const QUANTUM_FRAMES = 128;
// Measured: the reference's second burst peaks at 0.5 at 48 kHz, 0.49997 at 44.1.
const GAP_SECOND_BURST_LOW = 0.49;

/**
 * Where `render` stops after a row's first burst (core-wasm offline-worker.ts:424-426, :440). The burst's last frame is
 * audible (measured: 9599, 8819). The quantum that ends the 10 s of silence is counted and not kept, then a quarter
 * second stays. 21472 at 48 kHz, 19729 at 44.1.
 */
const framesKeptBeforeGap = ({ seconds }: ExportRow, pageRate: number): number =>
  Math.ceil(Math.round(seconds * pageRate) / QUANTUM_FRAMES) * QUANTUM_FRAMES - QUANTUM_FRAMES + pageRate / 4;

const passIsOneFrameShort = ({ seconds, bpm }: ExportRow, pageRate: number): boolean =>
  seconds === 4 && ((pageRate === 44100 && bpm === 120) || (pageRate === 48000 && bpm === 137));

export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    name: "loop-pass-one-frame-short",
    invariant: "impulse-on-reference",
    note: "a loop's whole-frame pass runs one frame short where the accumulated position lands just under the frame count and the split truncates it: 127.999999997 to 127 at 48 kHz, 137 bpm, and 15.9999999955 to 15 at 44.1 kHz, 120 bpm (crates/transport/src/transport.rs emit_until, and audio_region_player.rs sample_of for a region's loop). Every other rate, length and bpm of the catalogue lands exact, as the same arithmetic predicts",
    applies: (row, pageRate) => (row.path === "section-loop-twice" || row.path === "bounce-loop") && passIsOneFrameShort(row, pageRate),
    // A shift says nothing about the samples: they must still be the stepped loop's, or this is another defect.
    signature: ({ earlyFrames, warmHolds }, row, pageRate) =>
      earlyFrames === 1 && warmHolds(row.path === "bounce-loop" ? rangeFrames(row, pageRate) - 1 : -1)
  },
  {
    name: "loop-bounce-last-frame-silent",
    invariant: "samples-equal-warm-pass",
    note: "the same accumulated position, seen at a bounce's end. A bounce has no loop area: its second cycle starts through sample_of, truncated, a frame early (audio_region_player.rs:868-869, :974-976), while the region still ends on the span's end. So the read reaches the source's end one frame early and the span's last frame reads past it, exactly 0 on both channels (:903-905, base >= source_frames), where the stepped loop is already in its next pass. The source is exactly one loop long here; a longer one would go on reading (read, not measured). Every other frame is bit-identical",
    applies: (row, pageRate) => row.path === "bounce-loop" && passIsOneFrameShort(row, pageRate),
    signature: ({ firstDifferingFrame, lastDifferingFrame, comparedFrames, framePeak, largestDifference }, row, pageRate) => {
      const last = rangeFrames(row, pageRate) - 1;
      return firstDifferingFrame === last && lastDifferingFrame === last && comparedFrames === last + 1
        && framePeak(last) === 0
        && largestDifference !== null && largestDifference <= toneStep(PROBE_TONE_LEVEL, PROBE_TONE_HZ, pageRate);
    }
  },
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
  fadedStart("section-is-slice", (row) => row.group === "core" && row.path.startsWith("section-marker")),
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
    note: "by design: an entire-song or start render goes through `render`, which stops after silence and keeps 250 ms of it (core-wasm offline-worker.ts render, framesToKeep), so a song whose end is silent comes out shorter than its last region, with nothing lost. A bounce keeps its exact span (AudioBounce.ts audibleLength)",
    applies: (row) => row.group === "tail" && row.seconds === 4 && (row.path === "section-entire" || row.path === "start"),
    signature: ({ firstDifferingFrame, comparedFrames }, _row, pageRate) =>
      firstDifferingFrame === null && comparedFrames !== null && comparedFrames === TRIMMED_FRAMES[pageRate]
  },
  {
    name: "long-silence-ends-render",
    invariant: "section-is-slice",
    note: "a defect, drafted for upstream, see Finding 2 in the export regression note: `render` stops after 10 s at or below -72 dB and keeps a quarter second (core-wasm offline-worker.ts:424-426, :440), whatever regions come later, and resolves normally. So a song with a 15.8 s gap comes out at 0.45 s with its second region missing. With a stem alone, the stem's own silence is what it reads. Bit-identical to the stepped render as far as it goes",
    applies: (row) => GAP_ROWS.has(row.id),
    signature: ({ firstDifferingFrame, comparedFrames, referencePeakOver }, row, pageRate) => {
      const kept = framesKeptBeforeGap(row, pageRate);
      const second = (row.secondRegionSeconds ?? Infinity) * pageRate;
      return firstDifferingFrame === null && comparedFrames === kept
        && referencePeakOver(kept, second) === 0
        && referencePeakOver(second, rangeFrames(row, pageRate)) >= GAP_SECOND_BURST_LOW;
    }
  },
  {
    name: "loop-wrap-keeps-old-read",
    invariant: "no-jump",
    note: "at a loop wrap to a region's start the new read starts at full level and only the old one fades, over 5 ms (audio_region_player.rs:322 seeds the tail, :862 fades in only past the region start; upstream test transport_jump_to_the_region_start_keeps_the_onset): in phase the two sum, here a 0.5 sine reaching 0.975 for 240 frames at 48 kHz. The signature holds the whole render to that: the reference up to the wrap, the fresh pass and the fading old read over 5 ms, the fresh pass after, so no other jump passes under the wrap's step",
    applies: (row) => row.path === "loop-on-copy",
    signature: ({ largestStep, wrapResidue }, _row, pageRate) => {
      const wrap = LOOP_ON_COPY_SECONDS * pageRate;
      return largestStep !== null && largestStep.frame === wrap + 1
        && largestStep.step <= (WRAP_STEP_LIMIT[pageRate] ?? -1)
        && wrapResidue(wrap, fadeLength(pageRate)) <= ROUNDING;
    }
  }
];

export const findingFor = (
  row: ExportRow, invariant: InvariantId, pageRate: number, evidence: FindingEvidence
): KnownFinding | null =>
  KNOWN_FINDINGS.find((finding) =>
    finding.invariant === invariant && finding.applies(row, pageRate) && finding.signature(evidence, row, pageRate)) ?? null;
