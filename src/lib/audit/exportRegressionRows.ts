// Plain Node must load this file: a script reads the catalogue, so no SDK value imports.

export type LatencyCaseId =
  | "none" | "autotune-muted" | "compressor-track" | "compressor-muted" | "maximizer-muted" | "fold-muted"
  | "script-10ms-muted" | "script-150ms-parallel" | "compressor-bus" | "compressor-aux" | "several";

export type PathId =
  | "step-one" | "step-chunked-whole" | "step-chunked-odd" | "step-reset" | "start"
  | "section-entire" | "section-loop-once" | "section-loop-twice" | "section-marker" | "section-marker-last"
  | "stems-fx" | "stems-dry" | "stems-sends" | "stems-metronome"
  | "bounce-pre-fx" | "bounce-pre-fader" | "bounce-post-fader" | "bounce-merge" | "bounce-loop" | "bounce-tail"
  | "setposition-on-quantum" | "setposition-off-quantum" | "loop-on-copy";

export type InvariantId =
  | "samples-equal-reference" | "section-is-slice" | "impulse-on-reference" | "impulse-follows-loop" | "impulse-unmoved-by-latency"
  | "impulse-on-computed-frame" | "no-jump" | "muted-latent-unchanged" | "disabled-equals-absent"
  | "stems-sum-to-mix" | "repeat-identical" | "tail-present" | "tail-absent" | "proves-something"
  | "latency-as-expected" | "differs-from-reference";

export type ExportRow = {
  id: string;
  label: string;
  group: "core" | "master" | "stems" | "bounce" | "position" | "one-frame" | "tail" | "sweep" | "control";
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
  repeat: boolean;
  referenceId: string | null;
  noLatencyReferenceId: string | null;
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

/** The frame a ppqn lands on: ppqn * 60 / (960 * bpm) seconds, written as one division. */
const ppqnToFrame = (ppqn: number, bpm: number, pageRate: number): number => (ppqn * pageRate) / (16 * bpm);

/** On quantum: the first integer ppqn at or after `seconds` whose frame is a whole multiple of 128; off: that + 1. */
export const setPositionStart = (
  seconds: number, bpm: number, pageRate: number, onQuantum: boolean
): { ppqn: number; offQuantumFrames: number } => {
  let ppqn = Math.ceil(seconds * 16 * bpm);
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
  "step-one", "step-chunked-whole", "step-chunked-odd", "step-reset", "start",
  "section-entire", "section-loop-once", "section-loop-twice", "section-marker", "section-marker-last"
];
const STEMS_PATHS: readonly PathId[] = ["stems-fx", "stems-dry", "stems-sends", "stems-metronome"];
// bounce-tail belongs to the tail group, where a Reverb gives it something to render
const BOUNCE_PATHS: readonly PathId[] = ["bounce-pre-fx", "bounce-pre-fader", "bounce-post-fader", "bounce-merge", "bounce-loop"];
const BASE_CASES: readonly LatencyCaseId[] = ["none", "autotune-muted", "compressor-track", "compressor-muted"];
const MASTER_CASES: readonly LatencyCaseId[] = ["none", "compressor-track"];
const MASTER_PATHS: readonly PathId[] = [
  "step-one", "step-chunked-whole", "step-chunked-odd", "step-reset", "start",
  "section-entire", "section-loop-once", "section-loop-twice", "section-marker"
];

type Spec = Pick<ExportRow, "id" | "label" | "group" | "latencyCase" | "path"> & Partial<ExportRow>;

const make = (spec: Spec): ExportRow => {
  const seconds = spec.seconds ?? 4;
  return {
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
    repeat: false,
    referenceId: null,
    noLatencyReferenceId: null,
    invariants: [],
    ...spec
  };
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
  } else if (path.startsWith("step-")) {
    out.push("samples-equal-reference");
  } else if (path === "start" || path.startsWith("section-")) {
    out.push("section-is-slice");
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
      const reference = path === "step-one" ? null : coreId(latencyCase, "step-one");
      rows.push(make({
        id: coreId(latencyCase, path),
        label: `${latencyCase} through ${path}`,
        group: "core", latencyCase, path,
        ...withWindow(path, 4),
        referenceId: reference,
        noLatencyReferenceId: path === "step-one" && latencyCase !== "none" ? coreId("none", "step-one") : null,
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
        referenceId: path === "step-one" ? bypassId : stepOne,
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
        invariants: [...basics(), ...(path === "stems-fx" ? ["stems-sum-to-mix" as const] : [])]
      }));
    }
  }
  return rows;
};

const buildBounce = (): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const latencyCase of BASE_CASES) {
    for (const path of BOUNCE_PATHS) {
      rows.push(make({
        id: `bounce-${latencyCase}-${path}`, label: `${latencyCase} through ${path}`,
        group: "bounce", latencyCase, path, referenceId: coreId(latencyCase, "step-one"),
        invariants: [...basics(), "impulse-on-reference", "no-jump"]
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
          // the loop repeats the reference's first hits, so its hits are not the reference's
          invariants: [...basics(), "impulse-follows-loop", "no-jump"]
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
        for (const path of ["section-loop-twice", "step-chunked-whole"] as const) {
          rows.push(make({
            ...common, id: `one-frame-none-${path}-${tag}`, label: `${path}, ${tag}`, path,
            referenceId: stepOneId,
            invariants: [...basics(), ...pathInvariants(path, "none", true, sourceRate, pageRate)]
          }));
        }
      }
    }
  }
  return rows;
};

const buildTail = (): ExportRow[] => {
  const common = { group: "tail" as const, latencyCase: "none" as const, signal: "tail" as const };
  const referenceId = "tail-none-step-one";
  const tailRow = (path: PathId, invariants: InvariantId[], extra: Partial<ExportRow> = {}): ExportRow =>
    make({
      ...common, id: `tail-none-${path}`, label: `reverb tail, ${path}`, path, referenceId,
      invariants: [...basics(), ...invariants], ...extra
    });
  return [
    make({ ...common, id: referenceId, label: "reverb tail, step-one", path: "step-one", invariants: basics() }),
    tailRow("section-entire", ["tail-present"]),
    tailRow("bounce-tail", ["tail-present"]),
    tailRow("bounce-pre-fader", ["tail-absent"]),
    // the 200 ms of content has ended before 1 s: what the reference holds in the range is the ringing reverb
    tailRow("section-marker", ["section-is-slice"], { ...withWindow("section-marker", 4) })
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
        invariants: [...basics(), ...pathInvariants(path, latencyCase, false, 48000, pageRate)]
      }));
    }
  }
  return rows;
};

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
    })
  ];
};

const REPEATED_CASES: readonly LatencyCaseId[] = ["none", "compressor-track"];

export const buildRows = (pageRate: number): ExportRow[] =>
  [
    ...buildCore(pageRate), ...buildMaster(pageRate), ...buildStems(), ...buildBounce(),
    ...buildPosition(pageRate), ...buildOneFrame(pageRate), ...buildTail(), ...buildSweep(pageRate),
    ...buildControl()
  ].map((row) => REPEATED_CASES.includes(row.latencyCase)
    ? { ...row, repeat: true, invariants: [...row.invariants, "repeat-identical" as const] }
    : row);
