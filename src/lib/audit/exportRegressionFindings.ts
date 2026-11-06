// Plain Node must load this file: the table script reads it, so no SDK value imports.
import { expectedLatencyFrames, LOOP_ON_COPY_SECONDS, type ExportRow, type InvariantId } from "./exportRegressionRows.ts";
import { IMPULSE_LEVEL, PROBE_TONE_LEVEL } from "./exportRegressionSignals.ts";

/** What the verdict measured on a failing invariant; null where the invariant took no such measurement. */
export type FindingEvidence = {
  earlyFrames: number | null;
  firstDifferingFrame: number | null;
  lastDifferingFrame: number | null;
  largestDifference: number | null;
  /** Frames a comparison held bit for bit, set when it ran out of them with nothing differing. */
  comparedFrames: number | null;
  silent: boolean | null;
  largestStep: { step: number; frame: number } | null;
  /** The largest difference from this frame of the row on. Nothing compared reads as Infinity, so no limit passes it. */
  differencePast: (frame: number) => number;
  /** Whether the row, from `frames` on, is the reference delayed by `frames`, bit for bit. */
  sameDelayedBy: (frames: number) => boolean;
};

export const NO_EVIDENCE: FindingEvidence = {
  earlyFrames: null, firstDifferingFrame: null, lastDifferingFrame: null, largestDifference: null,
  comparedFrames: null, silent: null, largestStep: null,
  differencePast: () => Infinity,
  sameDelayedBy: () => false
};

/** A claim that a behaviour has been read and is understood, not that it is right: the note says what was read. */
export type KnownFinding = {
  name: string;
  invariant: InvariantId;
  note: string;
  applies: (row: ExportRow, pageRate: number) => boolean;
  signature: (evidence: FindingEvidence, row: ExportRow, pageRate: number) => boolean;
};

// crates/engine/src/audio_region_player.rs JUMP_FADE_DURATION, in frames of the page: 220.5 at 44.1 kHz counts down over 221
const fadeFrames = (pageRate: number): number => Math.ceil(0.005 * pageRate);
// Measured: the first 8 frames past the fade still differ with a Compressor and a Fold on the source (-89 dB at 48 kHz).
const chainFrames = ({ latencyCase }: ExportRow): number => (latencyCase === "several" ? 8 : 0);
// The aux send carries the source a second time, so everything the fade and the read do arrives twice.
const paths = ({ latencyCase }: ExportRow): number => (latencyCase === "compressor-aux" ? 2 : 1);
const RATIO_SLACK = 1.05;

/**
 * What a read started at the row's own start may differ from a read that free-ran there, on an impulse. The free-running
 * read advances by `(source_rate / engine_rate) as f64` of two f32s (audio_region_player.rs), so it drifts from the exact
 * ratio per output frame; a read seated at the start has no such drift. A start between two frames adds its fraction,
 * which the comparison at the nearest whole frame sees. At equal rates and a whole frame this is 0: nothing may differ.
 */
const readOffsetLimit = (row: ExportRow, pageRate: number): number => {
  const startFrame = row.rangeStartSeconds * pageRate;
  const exact = row.sourceRate / pageRate;
  const drift = startFrame * Math.abs(Math.fround(exact) - exact);
  const betweenFrames = Math.abs(startFrame - Math.round(startFrame)) * exact;
  return (drift + betweenFrames) * IMPULSE_LEVEL * paths(row) * RATIO_SLACK;
};

const fadedStart = (invariant: InvariantId, applies: KnownFinding["applies"]): KnownFinding => ({
  name: "jump-fade-at-start",
  invariant,
  note: "the first block of a render that starts inside a region is a transport jump: the region's read fades in linearly over 5 ms, frame i at i/240 at 48 kHz (audio_region_player.rs:862, :913; upstream test transport_jump_inside_a_native_region_crossfades). A reference that ran through that point has no fade. Past the fade the row is bit-identical, or at a resampled rate within the read's own drift",
  applies,
  signature: ({ firstDifferingFrame, largestDifference, differencePast }, row, pageRate) =>
    firstDifferingFrame === 0
    && largestDifference !== null && largestDifference <= PROBE_TONE_LEVEL * paths(row)
    && differencePast(fadeFrames(pageRate) + chainFrames(row)) <= readOffsetLimit(row, pageRate)
});

// Measured at 44.1 kHz: -73.3 dB past the cold limiter's window, on a 1.5 sine: the same read drift as above, on the tone's slope.
const COLD_MAXIMIZER_READ_LIMIT: Readonly<Record<number, number>> = { 48000: 0, 44100: 2.5e-4 };
const COLD_MAXIMIZER_FRAMES = 3431;

const missingTail = (invariant: InvariantId, signature: KnownFinding["signature"]): KnownFinding => ({
  name: "range-missing-tail",
  invariant,
  note: "a range that starts after the content has ended renders silent: a render starts cold, so a Reverb has nothing to ring with, where a render that ran through that point holds the tail (-54 dB here). No pre-roll exists on any section path",
  applies: (row) => row.group === "tail" && row.path === "section-marker",
  signature
});

const TAIL_REFERENCE_LEVEL = 0.003;
// The frames `render` keeps of a 4 s region whose 200 ms burst has rung out, tail and 250 ms included.
const TRIMMED_FRAMES: Readonly<Record<number, number>> = { 48000: 80992, 44100: 74001 };
// The doubled tone's largest step at each rate, rounded up from what was measured on every case.
const WRAP_STEP_LIMIT: Readonly<Record<number, number>> = { 48000: 0.131, 44100: 0.142 };

const passIsOneFrameShort = ({ seconds, bpm }: ExportRow, pageRate: number): boolean =>
  seconds === 4 && ((pageRate === 44100 && bpm === 120) || (pageRate === 48000 && bpm === 137));

export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    name: "loop-pass-one-frame-short",
    invariant: "impulse-on-reference",
    note: "a loop's whole-frame pass runs one frame short where the accumulated position lands just under the frame count and the split truncates it: 127.999999997 to 127 at 48 kHz, 137 bpm (crates/transport/src/transport.rs emit_until, and audio_region_player.rs sample_of for a region's loop). Every other rate, length and bpm of the catalogue lands exact, as the same arithmetic predicts",
    applies: (row, pageRate) => (row.path === "section-loop-twice" || row.path === "bounce-loop") && passIsOneFrameShort(row, pageRate),
    signature: ({ earlyFrames }) => earlyFrames === 1
  },
  fadedStart("section-is-slice", (row) => row.group === "core" && row.path.startsWith("section-marker")),
  fadedStart("samples-equal-reference", (row) => row.path.startsWith("setposition-")),
  {
    name: "jump-fade-cold-maximizer",
    invariant: "section-is-slice",
    note: "the jump fade again, through a master Maximizer that starts cold where the reference's has been limiting since frame 0 (peak-hold + 200 ms release, device-maximizer). The two meet at frame 3430 at 48 kHz: until then the section is up to 1.48x the reference, inferred to be the reference's envelope still holding an older, higher sampled peak",
    applies: (row) => row.group === "master" && row.path === "section-marker",
    signature: ({ firstDifferingFrame, largestDifference, differencePast }, _row, pageRate) =>
      firstDifferingFrame === 0 && largestDifference !== null && largestDifference <= 1
      && differencePast(COLD_MAXIMIZER_FRAMES) <= (COLD_MAXIMIZER_READ_LIMIT[pageRate] ?? -1)
  },
  {
    name: "reset-keeps-compensation-delay",
    invariant: "samples-equal-reference",
    note: "a second play on one renderer keeps the compensation delay: the worker settles once and trims once per renderer (latencyToTrim, core-wasm offline-worker.ts settle and trimStart), so after a stop the first latency frames stay in. The render is the reference delayed by exactly the reported figure, bit for bit",
    applies: (row) => row.path === "step-reset" && row.latencyCase !== "none",
    signature: ({ sameDelayedBy }, row, pageRate) => sameDelayedBy(expectedLatencyFrames(row.latencyCase, pageRate))
  },
  missingTail("proves-something", ({ silent }) => silent === true),
  missingTail("section-is-slice", ({ firstDifferingFrame, lastDifferingFrame, largestDifference }, row, pageRate) =>
    firstDifferingFrame === 0 && lastDifferingFrame === Math.round(row.rangeSeconds * pageRate) - 1
    && largestDifference !== null && largestDifference <= TAIL_REFERENCE_LEVEL),
  {
    name: "trailing-silence-trimmed",
    invariant: "section-is-slice",
    note: "an entire-song or start render goes through `render`, which stops after silence and keeps 250 ms of it (core-wasm offline-worker.ts render, framesToKeep), so a region whose end is silent comes out short of the region. A bounce keeps its exact span (AudioBounce.ts audibleLength)",
    applies: (row) => row.group === "tail" && row.seconds === 4 && (row.path === "section-entire" || row.path === "start"),
    signature: ({ firstDifferingFrame, comparedFrames }, _row, pageRate) =>
      firstDifferingFrame === null && comparedFrames !== null && comparedFrames === TRIMMED_FRAMES[pageRate]
  },
  {
    name: "loop-wrap-keeps-old-read",
    invariant: "no-jump",
    note: "at a loop wrap to a region's start the new read starts at full level and only the old one fades, over 5 ms (audio_region_player.rs:322 seeds the tail, :862 fades in only past the region start; upstream test transport_jump_to_the_region_start_keeps_the_onset): in phase the two sum, here a 0.5 sine reaching 0.975 for 240 frames at 48 kHz",
    applies: (row) => row.path === "loop-on-copy",
    signature: ({ largestStep }, _row, pageRate) =>
      largestStep !== null && largestStep.frame === LOOP_ON_COPY_SECONDS * pageRate + 1
      && largestStep.step <= (WRAP_STEP_LIMIT[pageRate] ?? -1)
  }
];

export const findingFor = (
  row: ExportRow, invariant: InvariantId, pageRate: number, evidence: FindingEvidence
): KnownFinding | null =>
  KNOWN_FINDINGS.find((finding) =>
    finding.invariant === invariant && finding.applies(row, pageRate) && finding.signature(evidence, row, pageRate)) ?? null;
