// Plain Node must load this file: a script reads the catalogue, so no SDK value imports.
import { exactFrame, ppqnAtBlockResidue, regionStartPpqn } from "./exportRegressionInBlock.ts";

export type LatencyCaseId =
  | "none" | "autotune-muted" | "compressor-track" | "compressor-muted" | "maximizer-muted" | "fold-muted"
  | "script-10ms-muted" | "script-150ms-parallel" | "compressor-bus" | "compressor-aux" | "several";

export type PathId =
  | "step-one" | "step-chunked-whole" | "step-chunked-odd" | "step-reset" | "step-loop-twice" | "start"
  | "section-entire" | "section-loop-once" | "section-loop-twice" | "section-marker" | "section-marker-last"
  | "stems-fx" | "stems-dry" | "stems-sends" | "stems-metronome" | "stems-start" | "stems-section-loop"
  | "stems-single-step" | "stems-single-start"
  | "bounce-pre-fx" | "bounce-pre-fader" | "bounce-post-fader" | "bounce-merge" | "bounce-loop" | "bounce-tail"
  | "setposition-on-quantum" | "setposition-off-quantum" | "loop-on-copy";

export type InvariantId =
  | "samples-equal-reference" | "samples-equal-warm-pass" | "section-is-slice" | "impulse-on-reference" | "impulse-follows-loop" | "impulse-unmoved-by-latency"
  | "impulse-on-computed-frame" | "no-jump" | "muted-latent-unchanged" | "disabled-equals-absent"
  | "stems-sum-to-mix" | "repeat-identical" | "tail-present" | "tail-absent" | "proves-something"
  | "latency-as-expected" | "differs-from-reference" | "frames-as-expected" | "clicks-on-beat-frame"
  | "impulse-follows-playback" | "jumps-crossfade" | "region-seated-on-start";

export type ExportRow = {
  id: string;
  label: string;
  group: "core" | "master" | "stems" | "bounce" | "position" | "one-frame" | "tail" | "sweep" | "in-block" | "marker" | "wrap" | "control";
  latencyCase: LatencyCaseId;
  path: PathId;
  signal: "probe" | "sweep" | "tail" | "hot";
  sourceRate: number;
  seconds: number;
  rangeStartSeconds: number;
  rangeSeconds: number;
  bpm: number;
  masterMaximizer: boolean;
  disabledDevice: boolean;
  nudgeVolume: boolean;
  withBed: boolean;
  /** How long the bed lasts where that is not `seconds`: a bed as short as a 200 ms source would leave the mix silent too. */
  bedSeconds: number | null;
  /** A third audible unit: with two, float32 addition is commutative and the summing order cannot reach the bits. */
  withThird: boolean;
  /** The case's Compressor set to compress. Every other row keeps it neutral, so those prove its latency, not that it processes. */
  engagedCompressor: boolean;
  /** The source unit's fader. Every other row keeps it at 0 dB, where a bounce's taps share one render. */
  volumeDb: number;
  /** Where a second region of the same source starts, for the rows that put a long silence inside the song. */
  secondRegionSeconds: number | null;
  /** Where the source's first region starts. Every row but the in-block ones keeps it at 0, a block's first frame. */
  regionStartPpqn: number;
  /** The loop `loop-on-copy` writes, from 0; null is `LOOP_ON_COPY_SECONDS`. */
  loopEndPpqn: number | null;
  /** Two markers on a step render, the first played `markerPlays` times. Null leaves the section paths' own markers. */
  markerPpqns: readonly [number, number] | null;
  markerPlays: number;
  /** `start`, `stems-start` and `stems-single-start` pass the row's range as `ExportConfiguration.range`. */
  exportRange: boolean;
  repeat: boolean;
  referenceId: string | null;
  noLatencyReferenceId: string | null;
  /** What a looped section's kept pass is held to: a chain with memory enters its second pass warm, so not the cold reference. */
  warmReferenceId: string | null;
  invariants: InvariantId[];
};

export const LATENCY_CASES: readonly LatencyCaseId[] = [
  "none", "autotune-muted", "compressor-track", "compressor-muted", "maximizer-muted", "fold-muted",
  "script-10ms-muted", "script-150ms-parallel", "compressor-bus", "compressor-aux", "several"
];

// [frames at 48 kHz, frames at 44.1 kHz]; "several" is a Compressor and a Fold in series
const LATENCY_FRAMES: Record<LatencyCaseId, readonly [number, number]> = {
  "none": [0, 0],
  "autotune-muted": [1280, 1280],
  "compressor-track": [240, 220],
  "compressor-muted": [240, 220],
  "maximizer-muted": [240, 221],
  "fold-muted": [15, 15],
  "script-10ms-muted": [480, 441],
  "script-150ms-parallel": [4800, 4410],
  "compressor-bus": [240, 220],
  "compressor-aux": [240, 220],
  "several": [255, 235]
};

export const expectedLatencyFrames = (latencyCase: LatencyCaseId, pageRate: number): number => {
  const [at48, at44] = LATENCY_FRAMES[latencyCase];
  if (pageRate === 48000) return at48;
  if (pageRate === 44100) return at44;
  throw new Error(`no latency figures for page rate ${pageRate}`);
};

/** Where a setposition row starts from; the render path recomputes its ppqn from this. */
export const SET_POSITION_SECONDS = 1;
/** The loop `loop-on-copy` writes, from the song's start; the render path writes it and the verdict expects its repeats. */
export const LOOP_ON_COPY_SECONDS = 2;

const QUANTUM = 128;

/** The loop a `loop-on-copy` row writes, from 0, in ppqn and in frames. */
export const loopOnCopyPpqn = ({ loopEndPpqn, bpm }: ExportRow): number => loopEndPpqn ?? Math.round(LOOP_ON_COPY_SECONDS * 16 * bpm);
export const loopOnCopyFrames = (row: ExportRow, pageRate: number): number => Math.round(exactFrame(loopOnCopyPpqn(row), row.bpm, pageRate));

/** Where the source's first region starts, in frames of the page. */
export const regionStartFrameOf = (row: ExportRow, pageRate: number): number => Math.round(exactFrame(row.regionStartPpqn, row.bpm, pageRate));

/**
 * What a render plays, in order: `length` frames from frame `src` of a render that ran straight through, written at
 * `out`. `jump` marks a transport jump into the segment, where the old read fades out over the jump window and, past
 * the region's start, the new read fades in over it.
 */
export type PlaybackSegment = { out: number; src: number; length: number; jump: boolean; fadeIn: boolean };

export const playbackSegments = (row: ExportRow, pageRate: number): PlaybackSegment[] => {
  const total = Math.round(row.rangeSeconds * pageRate);
  const segments: PlaybackSegment[] = [];
  let out = 0;
  const push = (src: number, length: number, jump: boolean, fadeIn: boolean): void => {
    const kept = Math.min(length, total - out);
    if (kept <= 0) return;
    segments.push({ out, src, length: kept, jump, fadeIn });
    out += kept;
  };
  if (row.path === "loop-on-copy") {
    // the loop starts on the region's start, so a wrap fades only the old read (audio_region_player.rs:862)
    const loop = loopOnCopyFrames(row, pageRate);
    push(0, loop, false, false);
    while (out < total) push(0, loop, true, false);
    return segments;
  }
  if (row.markerPpqns !== null) {
    if (!(row.markerPlays >= 1)) throw new Error(`${row.id}: ${row.markerPlays} plays never falls through`);
    const [first, second] = row.markerPpqns.map((ppqn) => Math.round(exactFrame(ppqn, row.bpm, pageRate)));
    push(0, second, false, false);
    for (let pass = 1; pass < row.markerPlays; pass++) push(first, second - first, true, first > regionStartFrameOf(row, pageRate));
    push(second, total, false, false);
    return segments;
  }
  throw new Error(`${row.id}: neither a loop on the copy nor markers, so it plays straight through`);
};

/** The frame a ppqn lands on: ppqn * 60 / (960 * bpm) seconds, written as one division. */
const ppqnToFrame = (ppqn: number, bpm: number, pageRate: number): number => (ppqn * pageRate) / (16 * bpm);

/**
 * The frames an exact-range render holds. A loop's pass is a whole number of ppqn, as its render computes it, which at
 * 0.9 s and 137 bpm is 43204 frames at 48 kHz, not the 43200 of the row's seconds.
 */
export const expectedFrames = ({ path, rangeSeconds, bpm }: ExportRow, pageRate: number): number =>
  path === "step-loop-twice" || path === "section-loop-twice"
    ? Math.round(ppqnToFrame(Math.round(rangeSeconds * 16 * bpm), bpm, pageRate))
    : Math.round(rangeSeconds * pageRate);

/** On quantum: the first integer ppqn at or after `seconds` whose frame is a whole multiple of 128; off: that + 1. */
export const setPositionStart = (
  seconds: number, bpm: number, pageRate: number, onQuantum: boolean
): { ppqn: number; offQuantumFrames: number } => {
  let ppqn = Math.ceil(seconds * 16 * bpm);
  // Checked here, not by the loop's bound: a NaN or a -Infinity never passes it and the loop would spin for good.
  if (!Number.isFinite(ppqn)) throw new Error(`no ppqn for a start of ${seconds} s at ${bpm} bpm`);
  for (;;) {
    const frame = ppqnToFrame(ppqn, bpm, pageRate);
    const nearest = Math.round(frame / QUANTUM) * QUANTUM;
    if (Math.abs(frame - nearest) < 1e-6) break;
    ppqn++;
    if (ppqn > 1e9) throw new Error("no quantum-aligned ppqn found");
  }
  if (!onQuantum) ppqn++;
  const frame = ppqnToFrame(ppqn, bpm, pageRate);
  return { ppqn, offQuantumFrames: frame - Math.floor(frame / QUANTUM) * QUANTUM };
};

const MUTED_HOST_CASES: readonly LatencyCaseId[] = [
  "autotune-muted", "compressor-muted", "maximizer-muted", "fold-muted", "script-10ms-muted"
];
const NO_JUMP_EXEMPT_CASES: readonly LatencyCaseId[] = ["compressor-aux", "several"];

const CORE_PATHS: readonly PathId[] = [
  "step-one", "step-chunked-whole", "step-chunked-odd", "step-reset", "step-loop-twice", "start",
  "section-entire", "section-loop-once", "section-loop-twice", "section-marker", "section-marker-last"
];
const STEMS_PATHS: readonly PathId[] = ["stems-fx", "stems-dry", "stems-sends", "stems-metronome"];
// What the studio's stem dialog calls; the stepped stems-fx, already held to the mix, is what they must equal.
const STEMS_ROUTE_PATHS: readonly PathId[] = ["stems-start", "stems-section-loop"];
// bounce-tail belongs to the tail group, where a Reverb gives it something to render
const BOUNCE_PATHS: readonly PathId[] = ["bounce-pre-fx", "bounce-pre-fader", "bounce-post-fader", "bounce-merge", "bounce-loop"];
const BASE_CASES: readonly LatencyCaseId[] = ["none", "autotune-muted", "compressor-track", "compressor-muted"];
const MASTER_CASES: readonly LatencyCaseId[] = ["none", "compressor-track"];
const MASTER_PATHS: readonly PathId[] = [
  "step-one", "step-chunked-whole", "step-chunked-odd", "step-reset", "step-loop-twice", "start",
  "section-entire", "section-loop-once", "section-loop-twice", "section-marker"
];

type Spec = Pick<ExportRow, "id" | "label" | "group" | "latencyCase" | "path"> & Partial<ExportRow>;

/** A field only some paths read: a row that sets it on another path would render without it and say nothing. */
const assertFieldsRead = (row: ExportRow): ExportRow => {
  const unread = [
    row.exportRange && !["start", "stems-start", "stems-single-start"].includes(row.path) ? "exportRange" : null,
    row.loopEndPpqn !== null && row.path !== "loop-on-copy" ? "loopEndPpqn" : null,
    // `renderSection` turns the marker track off
    row.markerPpqns !== null && !["step-one", "start"].includes(row.path) ? "markerPpqns" : null,
    row.markerPpqns === null && row.markerPlays !== 1 ? "markerPlays" : null
  ].filter((field) => field !== null);
  if (unread.length > 0) throw new Error(`${row.id}: ${row.path} does not read ${unread.join(", ")}`);
  return row;
};

const make = (spec: Spec): ExportRow => {
  const seconds = spec.seconds ?? 4;
  return assertFieldsRead({
    signal: "probe",
    sourceRate: 48000,
    seconds,
    rangeStartSeconds: 0,
    rangeSeconds: seconds,
    bpm: 120,
    masterMaximizer: false,
    disabledDevice: false,
    nudgeVolume: false,
    withBed: false,
    bedSeconds: null,
    withThird: false,
    engagedCompressor: false,
    volumeDb: 0,
    secondRegionSeconds: null,
    regionStartPpqn: 0,
    loopEndPpqn: null,
    markerPpqns: null,
    markerPlays: 1,
    exportRange: false,
    repeat: false,
    referenceId: null,
    noLatencyReferenceId: null,
    warmReferenceId: null,
    invariants: [],
    ...spec
  });
};

const coreId = (latencyCase: LatencyCaseId, path: PathId): string => `core-${latencyCase}-${path}`;

/** The path's own invariants; `probe` rows carry impulses and a sine, other signals only what holds without them. */
const pathInvariants = (
  path: PathId, latencyCase: LatencyCaseId, probe: boolean, sourceRate: number, pageRate: number
): InvariantId[] => {
  const out: InvariantId[] = [];
  if (path === "step-one") {
    if (probe) {
      if (latencyCase !== "none") out.push("impulse-unmoved-by-latency");
      if (sourceRate === pageRate) out.push("impulse-on-computed-frame");
      if (!NO_JUMP_EXEMPT_CASES.includes(latencyCase)) out.push("no-jump");
      if (MUTED_HOST_CASES.includes(latencyCase)) out.push("muted-latent-unchanged");
    }
  } else if (path === "step-loop-twice") {
    // a reference: the section-loop-twice row reading it judges the pair
    out.push("frames-as-expected");
  } else if (path.startsWith("step-")) {
    out.push("samples-equal-reference");
  } else if (path === "start" || path.startsWith("section-")) {
    out.push(path === "section-loop-twice" ? "samples-equal-warm-pass" : "section-is-slice");
    // Where the pass is longer than the range, the comparison passes once the range is covered: only the count sees a short render.
    if (path === "section-loop-twice") out.push("frames-as-expected");
    // The cold reference's hits, on a loop too: a stepped loop would carry the same shift and hide it.
    if (probe) out.push("impulse-on-reference", "no-jump");
  }
  return out;
};

const basics = (): InvariantId[] => ["proves-something", "latency-as-expected"];

/** The window of a section path, in seconds from the source's start. */
const sectionWindow = (path: PathId, seconds: number): { start: number; length: number } => {
  if (path === "section-marker") return { start: 1, length: 2 };
  if (path === "section-marker-last") return { start: 3, length: seconds - 3 };
  return { start: 0, length: seconds };
};

const withWindow = (path: PathId, seconds: number): Pick<ExportRow, "rangeStartSeconds" | "rangeSeconds"> => {
  const { start, length } = sectionWindow(path, seconds);
  return { rangeStartSeconds: start, rangeSeconds: length };
};

const secondsTag = (seconds: number): string => String(seconds).replace(".", "p");

const buildCore = (pageRate: number): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const latencyCase of LATENCY_CASES) {
    for (const path of CORE_PATHS) {
      const reference = path === "step-one" || path === "step-loop-twice" ? null : coreId(latencyCase, "step-one");
      rows.push(make({
        id: coreId(latencyCase, path),
        label: `${latencyCase} through ${path}`,
        group: "core", latencyCase, path,
        ...withWindow(path, 4),
        referenceId: reference,
        noLatencyReferenceId: path === "step-one" && latencyCase !== "none" ? coreId("none", "step-one") : null,
        warmReferenceId: path === "section-loop-twice" ? coreId(latencyCase, "step-loop-twice") : null,
        invariants: [...basics(), ...pathInvariants(path, latencyCase, true, 48000, pageRate)]
      }));
    }
  }
  return rows;
};

const buildMaster = (pageRate: number): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const latencyCase of MASTER_CASES) {
    const bypassId = `master-${latencyCase}-bypass`;
    rows.push(make({
      id: bypassId, label: `${latencyCase}, hot signal, master Maximizer removed`,
      group: "master", latencyCase, path: "step-one", signal: "hot",
      invariants: basics()
    }));
    for (const path of MASTER_PATHS) {
      const stepOne = `master-${latencyCase}-step-one`;
      const invariants = [...basics(), ...pathInvariants(path, latencyCase, false, 48000, pageRate)];
      if (path === "step-one") invariants.push("differs-from-reference");
      rows.push(make({
        id: stepOne.replace("step-one", path), label: `${latencyCase}, hot signal, master Maximizer, ${path}`,
        group: "master", latencyCase, path, signal: "hot", masterMaximizer: true,
        ...withWindow(path, 4),
        referenceId: path === "step-one" ? bypassId : path === "step-loop-twice" ? null : stepOne,
        warmReferenceId: path === "section-loop-twice" ? stepOne.replace("step-one", "step-loop-twice") : null,
        invariants
      }));
    }
  }
  return rows;
};

const buildStems = (): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const latencyCase of BASE_CASES) {
    const mixId = `mix-${latencyCase}-step-one`;
    rows.push(make({
      id: mixId, label: `${latencyCase} mix with the bed`, group: "stems", latencyCase, path: "step-one",
      withBed: true, invariants: basics()
    }));
    for (const path of STEMS_PATHS) {
      rows.push(make({
        id: `stems-${latencyCase}-${path}`, label: `${latencyCase} through ${path}`,
        group: "stems", latencyCase, path, withBed: true, referenceId: mixId,
        invariants: [
          ...basics(), "frames-as-expected",
          ...(path === "stems-fx" ? ["stems-sum-to-mix" as const] : []),
          // 120 bpm: every beat is a whole frame at both page rates, so each click has one frame to start on
          ...(path === "stems-metronome" ? ["clicks-on-beat-frame" as const] : [])
        ]
      }));
    }
    for (const path of STEMS_ROUTE_PATHS) {
      rows.push(make({
        id: `stems-${latencyCase}-${path}`, label: `${latencyCase} through ${path}`,
        group: "stems", latencyCase, path, withBed: true, referenceId: `stems-${latencyCase}-stems-fx`,
        invariants: [...basics(), "section-is-slice"]
      }));
    }
  }
  return rows;
};

// What each bounce's samples are the same as. The source unit alone, the master removed and the faders at 0 dB, a tap
// after the devices is the case's own render. A pre-fx tap is before them, so it is the render with no device at all.
const bounceSamples = (path: PathId, latencyCase: LatencyCaseId): Pick<ExportRow, "referenceId" | "warmReferenceId"> & { held: InvariantId } => {
  if (path === "bounce-loop") return { referenceId: coreId(latencyCase, "step-one"), warmReferenceId: coreId(latencyCase, "step-loop-twice"), held: "samples-equal-warm-pass" };
  return { referenceId: coreId(path === "bounce-pre-fx" ? "none" : latencyCase, "step-one"), warmReferenceId: null, held: "section-is-slice" };
};

const buildBounce = (): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const latencyCase of BASE_CASES) {
    for (const path of BOUNCE_PATHS) {
      const { held, ...references } = bounceSamples(path, latencyCase);
      rows.push(make({
        id: `bounce-${latencyCase}-${path}`, label: `${latencyCase} through ${path}`,
        group: "bounce", latencyCase, path, ...references,
        invariants: [...basics(), "frames-as-expected", held, "impulse-on-reference", "no-jump"]
      }));
    }
  }
  return rows;
};

const buildPosition = (pageRate: number): ExportRow[] => {
  const rows: ExportRow[] = [];
  const bpm = 120;
  const seconds = 4;
  for (const latencyCase of BASE_CASES) {
    for (const path of ["setposition-on-quantum", "setposition-off-quantum", "loop-on-copy"] as const) {
      const reference = coreId(latencyCase, "step-one");
      if (path === "loop-on-copy") {
        rows.push(make({
          id: `position-${latencyCase}-${path}`, label: `${latencyCase} through ${path}`,
          group: "position", latencyCase, path, referenceId: reference,
          // the loop repeats the reference's first hits, so its hits are not the reference's; its first pass is the reference's
          invariants: [...basics(), "samples-equal-reference", "impulse-follows-loop", "no-jump"]
        }));
        continue;
      }
      const { ppqn } = setPositionStart(SET_POSITION_SECONDS, bpm, pageRate, path === "setposition-on-quantum");
      const start = ppqnToFrame(ppqn, bpm, pageRate) / pageRate;
      rows.push(make({
        id: `position-${latencyCase}-${path}`, label: `${latencyCase} through ${path}`,
        group: "position", latencyCase, path, seconds, bpm,
        rangeStartSeconds: start, rangeSeconds: seconds - start,
        referenceId: reference,
        invariants: [...basics(), "samples-equal-reference"]
      }));
    }
  }
  return rows;
};

const buildOneFrame = (pageRate: number): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const sourceRate of [48000, 44100]) {
    for (const seconds of [0.9, 2, 4]) {
      for (const bpm of [120, 137]) {
        const tag = `${sourceRate}-${secondsTag(seconds)}-${bpm}`;
        const common = { group: "one-frame" as const, latencyCase: "none" as const, sourceRate, seconds, bpm };
        const stepOneId = `one-frame-none-step-one-${tag}`;
        rows.push(make({
          ...common, id: stepOneId, label: `step-one, ${tag}`, path: "step-one",
          invariants: [...basics(), ...pathInvariants("step-one", "none", true, sourceRate, pageRate)]
        }));
        const warmId = `one-frame-none-step-loop-twice-${tag}`;
        rows.push(make({
          ...common, id: warmId, label: `step-loop-twice, ${tag}`, path: "step-loop-twice",
          invariants: [...basics(), ...pathInvariants("step-loop-twice", "none", true, sourceRate, pageRate)]
        }));
        for (const path of ["section-loop-twice", "step-chunked-whole"] as const) {
          rows.push(make({
            ...common, id: `one-frame-none-${path}-${tag}`, label: `${path}, ${tag}`, path,
            referenceId: stepOneId,
            warmReferenceId: path === "section-loop-twice" ? warmId : null,
            invariants: [...basics(), ...pathInvariants(path, "none", true, sourceRate, pageRate)]
          }));
        }
      }
    }
  }
  return rows;
};

const TAIL_BURST_SECONDS = 0.2;
const GAP_SECOND_REGION_SECONDS = 16;
const GAP_SPAN_SECONDS = 18;
/** Inside the first burst, so the range holds sound before the gap: a range that starts silent never counts its silence. */
const GAP_RANGE_START_SECONDS = 0.1;

/**
 * A long silence inside the song: 200 ms at 0 and at 16 s. These rows take no Reverb (`rowTakesReverb`), so the gap is
 * exact zeros, well under `render`'s -72 dB, and nothing but the regions decides where silence starts. The reference
 * steps the whole 18 s span. The two render paths are held to the second region's end, not the span's: `render` also
 * trims silence after the last sound, which the 4 s rows above read, and these rows judge the gap alone.
 */
const buildGap = (common: Pick<ExportRow, "group" | "latencyCase" | "signal">): ExportRow[] => {
  const referenceId = "gap-none-step-one";
  const gap = { ...common, seconds: TAIL_BURST_SECONDS, secondRegionSeconds: GAP_SECOND_REGION_SECONDS };
  const end = GAP_SECOND_REGION_SECONDS + TAIL_BURST_SECONDS;
  // The bed is in the project and not in the stems configuration, so the stem falls silent where the mix does not.
  const bedded = { ...gap, withBed: true, bedSeconds: GAP_SPAN_SECONDS };
  return [
    make({ ...gap, id: referenceId, label: "silent gap, step-one", path: "step-one", rangeSeconds: GAP_SPAN_SECONDS, invariants: basics() }),
    ...(["start", "section-entire"] as const).map((path) => make({
      ...gap, id: `gap-none-${path}`, label: `silent gap, ${path}`, path, rangeSeconds: end, referenceId,
      invariants: [...basics(), "section-is-slice" as const]
    })),
    make({
      ...bedded, id: "gap-none-stem-step", label: "silent gap, the source's stem alone, step", path: "stems-single-step",
      rangeSeconds: GAP_SPAN_SECONDS, invariants: [...basics(), "frames-as-expected"]
    }),
    make({
      ...bedded, id: "gap-none-stem-start", label: "silent gap, the source's stem alone, start", path: "stems-single-start",
      rangeSeconds: end, referenceId: "gap-none-stem-step", invariants: [...basics(), "section-is-slice"]
    }),
    // A stem render hands back only its stems, so nothing in it shows the mix: this is that project's mix over that span.
    make({
      ...bedded, id: "gap-none-stem-mix", label: "silent gap, the stem rows' project as a mix", path: "step-one",
      rangeSeconds: GAP_SPAN_SECONDS, invariants: basics()
    }),
    // The positive control of the short stem: the same project and path, judged on the mix's channels, which never fall silent.
    make({
      ...bedded, id: "gap-none-stem-mix-start", label: "silent gap, the stem rows' project as a mix, start", path: "start",
      rangeSeconds: end, referenceId: "gap-none-stem-mix", invariants: [...basics(), "section-is-slice"]
    }),
    // The gap inside an `ExportConfiguration.range` that is not the song: the render's minimum is the range's length.
    // The range starts inside the first burst, a jump into a region, so its first 5 ms fade in.
    make({
      ...gap, id: "gap-none-range-start", label: "silent gap inside an export range from 0.1 s, start", path: "start",
      exportRange: true, rangeStartSeconds: GAP_RANGE_START_SECONDS, rangeSeconds: end - GAP_RANGE_START_SECONDS, referenceId,
      invariants: [...basics(), "section-is-slice"]
    }),
    make({
      ...bedded, id: "gap-none-range-stem-start", label: "silent gap inside an export range from 0.1 s, the source's stem alone, start",
      path: "stems-single-start", exportRange: true, rangeStartSeconds: GAP_RANGE_START_SECONDS,
      rangeSeconds: end - GAP_RANGE_START_SECONDS, referenceId: "gap-none-stem-step", invariants: [...basics(), "section-is-slice"]
    })
  ];
};

const buildTail = (): ExportRow[] => {
  const common = { group: "tail" as const, latencyCase: "none" as const, signal: "tail" as const };
  const referenceId = "tail-none-step-one";
  const tailRow = (path: PathId, invariants: InvariantId[], extra: Partial<ExportRow> = {}): ExportRow =>
    make({
      ...common, id: `tail-none-${path}`, label: `reverb tail, ${path}`, path, referenceId,
      invariants: [...basics(), ...invariants], ...extra
    });
  // On these the burst fills the region, so the Reverb still rings where the region ends. On the 4 s region it has
  // faded by about 1.4 s, a tail has nothing to show, and a bounce keeps its exact span by design (upstream's
  // audio-bounce.test.ts: "with tail but nothing ringing"). The 4 s reference has no frames of the region's to compare.
  const ringing = { seconds: TAIL_BURST_SECONDS, rangeSeconds: TAIL_BURST_SECONDS, referenceId: null };
  return [
    make({ ...common, id: referenceId, label: "reverb tail, step-one", path: "step-one", invariants: basics() }),
    // An entire-song render goes through `render`, which trims trailing silence: held to the region's 4 s, it comes up short.
    tailRow("section-entire", ["section-is-slice"], { id: "tail-none-section-entire-long", label: "reverb tail, section-entire, 4 s region" }),
    tailRow("start", ["section-is-slice"], { id: "tail-none-start-long", label: "reverb tail, start, 4 s region" }),
    tailRow("section-entire", ["tail-present"], ringing),
    tailRow("bounce-tail", ["tail-present"], ringing),
    tailRow("bounce-pre-fader", ["frames-as-expected", "tail-absent"], ringing),
    // the 200 ms of content has ended before 1 s: what the reference holds in the range is the ringing reverb
    tailRow("section-marker", ["section-is-slice"], { ...withWindow("section-marker", 4) }),
    ...buildGap(common),
    // A range that ends while the probe still sounds, held to the range's own frames: what comes after its end?
    make({
      id: "range-none-start-ends-in-sound", label: "an export range 0..2 s of a 4 s probe that sounds throughout, start",
      group: "tail", latencyCase: "none", path: "start", exportRange: true, rangeSeconds: 2,
      referenceId: coreId("none", "step-one"), invariants: [...basics(), "section-is-slice", "frames-as-expected"]
    })
  ];
};

const buildSweep = (pageRate: number): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const latencyCase of LATENCY_CASES) {
    const stepOneId = `sweep-${latencyCase}-step-one`;
    for (const path of ["step-one", "section-loop-once"] as const) {
      rows.push(make({
        id: `sweep-${latencyCase}-${path}`, label: `${latencyCase} sweep through ${path}`,
        group: "sweep", latencyCase, path, signal: "sweep",
        referenceId: path === "step-one" ? null : stepOneId,
        invariants: [...basics(), "frames-as-expected", ...pathInvariants(path, latencyCase, false, 48000, pageRate)]
      }));
    }
  }
  return rows;
};

/** A render of the source at the page's own rate, 4 s at 120 bpm: no resampling, so a read seated anywhere is exact. */
const sameRateReference = (pageRate: number): string => `one-frame-none-step-one-${pageRate}-4-120`;

/**
 * A region that starts inside a block, on a whole frame: the engine converts its start from the block's start pulse
 * (`sample_of`), which can land one frame early. One start the engine's arithmetic places early, one it places on its
 * frame, both near 1 s; `exportRegressionInBlock.ts` writes that arithmetic out.
 */
const buildInBlock = (pageRate: number): ExportRow[] =>
  ([["predicted-early", true], ["predicted-on-time", false]] as const).map(([tag, early]) => {
    const bpm = 120;
    const ppqn = regionStartPpqn(1, bpm, pageRate, early);
    return make({
      id: `in-block-none-region-start-${tag}`, label: `a region starting inside a block at ppqn ${ppqn}, ${tag}`,
      group: "in-block", latencyCase: "none", path: "step-one", sourceRate: pageRate, bpm, regionStartPpqn: ppqn,
      rangeSeconds: exactFrame(ppqn, bpm, pageRate) / pageRate + 4, referenceId: sameRateReference(pageRate),
      invariants: [...basics(), "impulse-on-computed-frame", "region-seated-on-start"]
    });
  });

const MARKER_FIRST_PPQN = 1920;

/**
 * Two markers on a step render, the first section played twice and then falling through. A section's end on a
 * block's end is the case 0.0.183 fixed (a marker there was missed); one inside a block is the control. Played once,
 * the markers change nothing. At the page's own rate, so the read seated at the jump is the reference's, exactly.
 */
const buildMarker = (pageRate: number): ExportRow[] => {
  const bpm = 120;
  const referenceId = sameRateReference(pageRate);
  const common = { group: "marker" as const, latencyCase: "none" as const, sourceRate: pageRate, bpm, referenceId };
  const ends = { "block-end": ppqnAtBlockResidue(2, bpm, pageRate, 0), "mid-block": ppqnAtBlockResidue(2, bpm, pageRate, 64) };
  const sectionSeconds = (end: number): number => (exactFrame(end, bpm, pageRate) - exactFrame(MARKER_FIRST_PPQN, bpm, pageRate)) / pageRate;
  const played = (tag: keyof typeof ends): Partial<ExportRow> => ({
    markerPpqns: [MARKER_FIRST_PPQN, ends[tag]], markerPlays: 2, rangeSeconds: 4 + sectionSeconds(ends[tag])
  });
  return [
    make({
      ...common, id: "marker-none-plays1-block-end", label: "markers, the first section played once, its end on a block's end",
      path: "step-one", markerPpqns: [MARKER_FIRST_PPQN, ends["block-end"]], markerPlays: 1,
      invariants: [...basics(), "samples-equal-reference"]
    }),
    ...(["block-end", "mid-block"] as const).map((tag) => make({
      ...common, id: `marker-none-plays2-${tag}`, label: `markers, the first section played twice, its end ${tag === "block-end" ? "on a block's end" : "inside a block"}`,
      path: "step-one", ...played(tag), invariants: [...basics(), "impulse-follows-playback", "jumps-crossfade"]
    })),
    // `start` leaves the markers on (`renderSection` turns them off), so the song plays as the stepped render does.
    make({
      ...common, id: "marker-none-plays2-block-end-start", label: "markers, the first section played twice, through start",
      path: "start", ...played("block-end"), referenceId: "marker-none-plays2-block-end", invariants: [...basics(), "section-is-slice"]
    })
  ];
};

/**
 * A loop on the copy whose end is on a block's end, its last frame, or a frame past it: the wrap's jump must reach the
 * block after it (0.0.183 fixed a wrap on a block's end losing the flag), and `jumps-crossfade` sees whether it did.
 */
const buildWrap = (pageRate: number): ExportRow[] => {
  const bpm = 120;
  return ([["block-end", 0], ["block-end-minus-1", -1], ["block-end-plus-1", 1]] as const).map(([tag, residue]) => {
    // From 1.5 s: at 44.1 kHz a whole frame on a given residue comes round only every 4096 ppqn, and from 2 s the
    // last-frame end would be 3.75 s, leaving the second pass a quarter second.
    const loopEndPpqn = ppqnAtBlockResidue(1.5, bpm, pageRate, residue);
    return make({
      id: `wrap-none-loop-on-copy-${tag}`, label: `a loop on the copy to ppqn ${loopEndPpqn}, its end ${tag}`,
      group: "wrap", latencyCase: "none", path: "loop-on-copy", sourceRate: pageRate, bpm, loopEndPpqn,
      referenceId: sameRateReference(pageRate),
      invariants: [...basics(), "samples-equal-reference", "impulse-follows-loop", "jumps-crossfade"]
    });
  });
};

const bounceTap = (path: "bounce-pre-fx" | "bounce-pre-fader" | "bounce-post-fader", referenceId: string, held: InvariantId): ExportRow =>
  make({
    id: `control-bounce-tap-${path.slice("bounce-".length)}`, label: `an engaged Compressor and a fader at -6 dB through ${path}`,
    group: "control", latencyCase: "compressor-track", path, engagedCompressor: true, volumeDb: -6, referenceId,
    invariants: [...basics(), "frames-as-expected", held]
  });

const buildControl = (): ExportRow[] => {
  const disabled = (latencyCase: LatencyCaseId): ExportRow =>
    make({
      id: `control-disabled-${latencyCase}`, label: `${latencyCase} present but disabled`,
      group: "control", latencyCase, path: "step-one", disabledDevice: true,
      referenceId: coreId("none", "step-one"),
      invariants: ["proves-something", "disabled-equals-absent"]
    });
  return [
    make({
      id: "control-nudged", label: "source volume nudged by 0.0001 dB", group: "control",
      latencyCase: "none", path: "step-one", nudgeVolume: true,
      referenceId: coreId("none", "step-one"),
      invariants: [...basics(), "differs-from-reference"]
    }),
    disabled("compressor-track"),
    disabled("fold-muted"),
    make({
      id: "control-master-maximizer", label: "master Maximizer with the bed", group: "control",
      latencyCase: "none", path: "step-one", masterMaximizer: true, withBed: true, invariants: basics()
    }),
    // What ?uuid=descending must read as changed; its impulses sit under the other units, so they are not read.
    make({
      id: "control-mix-three-units", label: "three audible units, no master Maximizer", group: "control",
      latencyCase: "none", path: "step-one", withBed: true, withThird: true, invariants: basics()
    }),
    make({
      id: "control-compressor-engaged", label: "a Compressor that compresses", group: "control",
      latencyCase: "compressor-track", path: "step-one", engagedCompressor: true,
      referenceId: coreId("compressor-track", "step-one"),
      invariants: [...basics(), "differs-from-reference"]
    }),
    // A device and a fader that both act, or the taps read the same: each must show what the tap before it does not.
    bounceTap("bounce-pre-fx", coreId("none", "step-one"), "section-is-slice"),
    bounceTap("bounce-pre-fader", "control-bounce-tap-pre-fx", "differs-from-reference"),
    bounceTap("bounce-post-fader", "control-bounce-tap-pre-fader", "differs-from-reference")
  ];
};

const REPEATED_CASES: readonly LatencyCaseId[] = ["none", "compressor-track"];

export const buildRows = (pageRate: number): ExportRow[] =>
  [
    ...buildCore(pageRate), ...buildMaster(pageRate), ...buildStems(), ...buildBounce(),
    ...buildPosition(pageRate), ...buildOneFrame(pageRate), ...buildTail(), ...buildSweep(pageRate),
    ...buildInBlock(pageRate), ...buildMarker(pageRate), ...buildWrap(pageRate), ...buildControl()
  ].map((row) => REPEATED_CASES.includes(row.latencyCase)
    ? { ...row, repeat: true, invariants: [...row.invariants, "repeat-identical" as const] }
    : row);

const referencesOf = ({ referenceId, noLatencyReferenceId, warmReferenceId }: ExportRow): string[] =>
  [referenceId, noLatencyReferenceId, warmReferenceId].filter((id): id is string => id !== null);

/**
 * The rows of a run, in catalogue order. A partial run still renders what its rows read against, or every one of
 * them would read "no reference": the references they name come along, and read like any other row.
 */
export const selectRows = (
  catalogue: readonly ExportRow[], filter: { rows: string | null; group: string | null }
): ExportRow[] => {
  if (filter.rows !== null && filter.group !== null) throw new Error("?rows= and ?group= do not combine: pick one of them");
  if (filter.rows === null && filter.group === null) return [...catalogue];
  const byId = new Map(catalogue.map((row) => [row.id, row]));
  let picked: readonly ExportRow[];
  if (filter.rows !== null) {
    const ids = filter.rows.split(",").map((id) => id.trim()).filter((id) => id !== "");
    if (ids.length === 0) throw new Error("?rows= names no row");
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new Error(`?rows= names rows the catalogue does not have: ${unknown.join(", ")}`);
    picked = ids.map((id) => byId.get(id)!);
  } else {
    picked = catalogue.filter((row) => row.group === filter.group);
    if (picked.length === 0) throw new Error(`?group= names a group the catalogue does not have: ${filter.group}`);
  }
  const wanted = new Set<string>();
  const add = (row: ExportRow): void => {
    if (wanted.has(row.id)) return;
    wanted.add(row.id);
    for (const id of referencesOf(row)) add(byId.get(id)!);
  };
  picked.forEach(add);
  return catalogue.filter((row) => wanted.has(row.id));
};

/** Per referenced row, the index of the last row that reads it: a run can let its samples go after that one. */
export const lastReaders = (rows: readonly ExportRow[]): Map<string, number> => {
  const last = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const id of referencesOf(row)) last.set(id, index);
  });
  return last;
};
