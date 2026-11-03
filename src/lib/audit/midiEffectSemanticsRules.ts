/**
 * What each stock MIDI effect is documented to emit, as pure functions of the input notes and the
 * device's settings, plus the registers the semantics audit judges a render against: the known
 * deviations of the engine from that rule, and the behaviours the register questions. The rule is
 * read from the crate (`openDAW/crates/stock-devices/device-*`) and the manual
 * (`openDAW/packages/app/manual/public/devices/midi/`); a deviation is a place the engine does
 * something else, named so a render can be judged with it on and off. Positions are absolute pulses.
 * The only SDK import is `PPQN`, for the one place pulses become milliseconds.
 */
import { PPQN } from "@opendaw/lib-dsp";

/** The shape of `EventRecord`'s note-on (`crates/abi/src/lib.rs:39-51`), in absolute pulses. */
export interface RuleNote { position: number; duration: number; pitch: number; cent: number; velocity: number }

export type SemanticsDevice = "arpeggio" | "pitch" | "velocity" | "zeitgeist";

export type DeviationName = "arpeggio-velocity-matrix" | "arpeggio-drops-cent" | "arpeggio-uncapped-note-off" | "zeitgeist-warps-note-off";

export type QuestionName = "pitch-drops-out-of-range" | "arpeggio-velocity-manual-gap";

export interface Deviation { name: DeviationName; device: SemanticsDevice; sentence: string; source: string }

export interface Question { name: QuestionName; device: SemanticsDevice; sentence: string; sources: string[] }

export interface ArpeggioSettings { modeIndex: 0 | 1 | 2; numOctaves: number; rateIndex: number; gate: number; repeat: number; velocity: number }
export interface PitchSettings { semiTones: number; cents: number; octaves: number }
/** The seed stays the box default 0x800. */
export interface VelocitySettings { magnetPosition: number; magnetStrength: number; randomAmount: number; offset: number; mix: number }
export interface ZeitgeistSettings { amount: number; duration: number }

export type DeviceSetting =
  | { device: "arpeggio"; settings: ArpeggioSettings }
  | { device: "pitch"; settings: PitchSettings }
  | { device: "velocity"; settings: VelocitySettings }
  | { device: "zeitgeist"; settings: ZeitgeistSettings };

/** The adapter functions a chain needs, bound by the caller; a chain holds at most one Velocity and one Zeitgeist. */
export interface RuleContext {
  /** The transport span the render covers: the engine runs every device over it, past the region's end too. */
  range: { from: number; to: number };
  computeVelocity: (position: number, original: number) => number;
  warp: (position: number) => number;
}

export const DEVIATIONS: readonly Deviation[] = [
  {
    name: "arpeggio-velocity-matrix", device: "arpeggio",
    sentence: "The engine fades the note's velocity toward the constant 1 + v below 0 and toward 1.0 above it, where the manual blends full velocity with the note's own.",
    source: "device-arpeggio/src/lib.rs:108-118"
  },
  {
    name: "arpeggio-drops-cent", device: "arpeggio",
    sentence: "The engine emits every arpeggiated note-on with cent 0, so a source note's detune is lost.",
    source: "device-arpeggio/src/lib.rs:304"
  },
  {
    name: "arpeggio-uncapped-note-off", device: "arpeggio",
    sentence: "The engine ends a step at its position plus its length, never at the end of the source note, so the last step can outlast the held note.",
    source: "device-arpeggio/src/lib.rs:303-306"
  },
  {
    name: "zeitgeist-warps-note-off", device: "zeitgeist",
    sentence: "The engine warps the note-off like any other record, so a duration stretches or shrinks with the groove where the manual says durations remain unchanged.",
    source: "device-zeitgeist/src/lib.rs:124-138"
  }
];

export const QUESTIONS: readonly Question[] = [
  {
    name: "pitch-drops-out-of-range", device: "pitch",
    sentence: "A note shifted outside 0..127 is dropped, not clamped; the crate documents it as a deviation from the TS device, and nothing says which is meant.",
    sources: ["device-pitch/src/lib.rs:8-11", "PitchDeviceProcessor (TS)"]
  },
  {
    name: "arpeggio-velocity-manual-gap", device: "arpeggio",
    sentence: "The manual describes the velocity control as full velocity at -100 %, the note's own at +100 % and a blend between; the engine's matrix gives silence at -100 % and 1.0 at 0 %.",
    sources: ["manual/public/devices/midi/arpeggio.md:84-92", "device-arpeggio/src/lib.rs:108-118"]
  }
];

export const RULE_SENTENCES: Record<SemanticsDevice, string> = {
  arpeggio: "On the absolute rate grid, one note per step from the notes held at that step, walked up, down or up-down over the octaves, as long as the gate says and no longer than the held note.",
  pitch: "Every note moves by octaves × 12 + semitones, its cent by the cents setting; a note shifted outside 0..127 is dropped.",
  velocity: "Every note's velocity is the device's computeVelocity at the note's absolute position.",
  zeitgeist: "Every note starts where the groove warps its position to; durations remain unchanged."
};

/** `ArpeggioDeviceBoxAdapter.RateFractions`: `floor(3840 / d) × n` (`device-arpeggio/src/lib.rs:36-47`). */
export const ARPEGGIO_RATE_PPQN: readonly number[] = [3840, 1920, 1280, 960, 720, 640, 480, 360, 320, 240, 180, 160, 120, 80, 60, 40, 30];

/** The manual's rule: -100 % full velocity ignoring the input, +100 % the note's own, 0 % a blend (`manual/.../arpeggio.md:84-92`). */
export function arpeggioIntentVelocity(v: number, vel: number): number {
  return vel + (1 - vel) * (1 - v) / 2;
}

/** The crate's matrix: silence at -1, 1.0 at 0, the note's own at +1 (`device-arpeggio/src/lib.rs:108-122`). */
export function arpeggioMatrixVelocity(v: number, vel: number): number {
  return v <= 0 ? 1 + v : vel * v + (1 - v);
}

/** The step's (stack index, octave) for a global step index (`device-arpeggio/src/lib.rs:127-151`); integer divisions throughout. */
function walk(mode: 0 | 1 | 2, count: number, octaves: number, step: number): { local: number; octave: number } {
  if (mode === 1) {
    return { local: count - 1 - step % count, octave: octaves - 1 - Math.trunc((step % (count * octaves)) / count) };
  }
  if (mode === 2) {
    const length = count * octaves;
    const sequence = Math.max(1, length * 2 - 2);
    const at = step % sequence;
    const processIndex = at < length ? at : sequence - at;
    return { local: processIndex % count, octave: Math.trunc(processIndex / count) };
  }
  return { local: step % count, octave: Math.trunc((step % (count * octaves)) / count) };
}

/** Arpeggio per `process` (`device-arpeggio/src/lib.rs:261-312`): a note-on at every absolute grid line in range with at least one held note. */
export function arpeggioRule(
  notes: readonly RuleNote[], settings: ArpeggioSettings, deviations: ReadonlySet<DeviationName>, range: { from: number; to: number }
): RuleNote[] {
  const rate = ARPEGGIO_RATE_PPQN[Math.max(0, Math.min(settings.rateIndex, ARPEGGIO_RATE_PPQN.length - 1))];
  const octaves = Math.max(1, settings.numOctaves);
  const repeat = Math.max(1, settings.repeat);
  const stepLength = rate * Math.max(settings.gate, 0);
  const length = stepLength < 1 ? 1 : Math.floor(stepLength);
  const out: RuleNote[] = [];
  // first_index: the smallest grid index whose line is at or after `from` (device-arpeggio/src/lib.rs:203-206)
  for (let index = Math.ceil(range.from / rate); index * rate < range.to; index++) {
    const position = index * rate;
    const stack = notes
      .filter((note) => note.position <= position && position < note.position + note.duration)
      .sort((a, b) => a.position - b.position || a.pitch - b.pitch);
    if (stack.length === 0) continue;
    const { local, octave } = walk(settings.modeIndex, stack.length, octaves, Math.floor(index / repeat));
    const source = stack[local];
    const sourceEnd = source.position + source.duration;
    out.push({
      position,
      duration: deviations.has("arpeggio-uncapped-note-off") ? length : Math.min(length, sourceEnd - position),
      pitch: source.pitch + 12 * octave,
      cent: deviations.has("arpeggio-drops-cent") ? 0 : source.cent,
      velocity: deviations.has("arpeggio-velocity-matrix")
        ? arpeggioMatrixVelocity(settings.velocity, source.velocity)
        : arpeggioIntentVelocity(settings.velocity, source.velocity)
    });
  }
  return out;
}

/** Pitch per `transform` (`device-pitch/src/lib.rs:101-133`): shift, add cents, drop a result outside 0..127. */
export function pitchRule(notes: readonly RuleNote[], settings: PitchSettings): RuleNote[] {
  const out: RuleNote[] = [];
  for (const note of notes) {
    const pitch = note.pitch + settings.octaves * 12 + settings.semiTones;
    if (pitch < 0 || pitch > 127) continue;
    out.push({ ...note, pitch, cent: note.cent + settings.cents });
  }
  return out;
}

/** Velocity replaced by the adapter's `computeVelocity` at the absolute position (`VelocityDeviceBoxAdapter.ts:31-39`). */
export function velocityRule(notes: readonly RuleNote[], computeVelocity: (position: number, original: number) => number): RuleNote[] {
  return notes.map((note) => ({ ...note, velocity: computeVelocity(note.position, note.velocity) }));
}

/** Zeitgeist per `process` (`device-zeitgeist/src/lib.rs:124-138`): positions through the groove as a float; the duration stays (manual `zeitgeist.md:59`) unless the deviation warps the note-off. */
export function zeitgeistRule(
  notes: readonly RuleNote[], groove: { warp(position: number): number }, deviations: ReadonlySet<DeviationName>
): RuleNote[] {
  return notes.map((note) => {
    const position = groove.warp(note.position);
    const duration = deviations.has("zeitgeist-warps-note-off") ? groove.warp(note.position + note.duration) - position : note.duration;
    return { ...note, position, duration };
  });
}

function applyStage(stage: DeviceSetting, context: RuleContext, deviations: ReadonlySet<DeviationName>, notes: readonly RuleNote[]): RuleNote[] {
  switch (stage.device) {
    case "arpeggio": return arpeggioRule(notes, stage.settings, deviations, context.range);
    case "pitch": return pitchRule(notes, stage.settings);
    case "velocity": return velocityRule(notes, context.computeVelocity);
    case "zeitgeist": return zeitgeistRule(notes, { warp: context.warp }, deviations);
  }
}

/**
 * The render's window, not the engine: a note starting at or past `range.to` is not in the buffer, one crossing it is
 * read to the buffer's end. The region's end cuts nothing a device emits: the sequencer reads the region's notes, and a
 * device may place them past its end, where they sound through the render's tail (measured: run 1793741626351,
 * `zg-amount0.75-dur61440-sixteenths` reads notes at 6072.7 and 6243.7 ms against a region ending at 6000 ms).
 */
export function clipToRange(notes: readonly RuleNote[], range: { from: number; to: number }): RuleNote[] {
  return notes
    .filter((note) => note.position < range.to)
    .map((note) => (note.position + note.duration > range.to ? { ...note, duration: range.to - note.position } : note));
}

/** Index 0 first: the engine folds the chain so the highest index sits nearest the instrument (`crates/engine/src/audio_unit/wiring.rs:1061-1066`). */
export function composeRules(
  chain: readonly DeviceSetting[], context: RuleContext, deviations: ReadonlySet<DeviationName>, notes: readonly RuleNote[]
): RuleNote[] {
  return chain.reduce<RuleNote[]>((current, stage) => applyStage(stage, context, deviations, current), [...notes]);
}

/** The questioned behaviours a row exercises; `chain` is the enabled chain. A Pitch stage that dropped a note counts at that stage, not through the rest of the chain. */
export function questionsFor(chain: readonly DeviceSetting[], context: RuleContext, source: readonly RuleNote[]): QuestionName[] {
  const names: QuestionName[] = [];
  const none: ReadonlySet<DeviationName> = new Set();
  const dropped = chain.some((stage, index) => {
    if (stage.device !== "pitch") return false;
    const before = composeRules(chain.slice(0, index), context, none, source);
    return pitchRule(before, stage.settings).length < before.length;
  });
  if (dropped) names.push("pitch-drops-out-of-range");
  if (chain.some((stage) => stage.device === "arpeggio" && stage.settings.velocity < 1)) names.push("arpeggio-velocity-manual-gap");
  return names;
}

export type Readability = "readable" | "abutting" | "overlap" | "polyphonic" | "too-short" | "too-quiet";

export interface PredictedNote extends RuleNote { readability: Readability }

export interface PredictedFigure { onsetMs: number; endMs: number; pitch: number; cents: number; velocity: number; readability: Readability }

const EPSILON_MS = 1e-6;

const toMs = (pulses: number, bpm: number): number => PPQN.pulsesToSeconds(pulses, bpm) * 1000;

/** The only place pulses become milliseconds, so the verdict module stays SDK-free. */
export function toPredictedFigures(notes: readonly PredictedNote[], bpm: number): PredictedFigure[] {
  return notes.map((note) => ({
    onsetMs: toMs(note.position, bpm),
    endMs: toMs(note.position + note.duration, bpm),
    pitch: note.pitch,
    cents: note.cent,
    velocity: note.velocity,
    readability: note.readability
  }));
}

/**
 * Whether a monophonic reader can judge each predicted note. Audible span = `[pos, end + releaseMs]`.
 * Two spans intersecting by more than `releaseMs` make both notes `overlap` (same pitch) or `polyphonic`;
 * by at most `releaseMs` (a step ending where the next begins) both `abutting`; spans that do not intersect but
 * sit less than `gapMs` apart are `abutting` too (the reader cannot separate them). A note is `too-short` unless its
 * duration less three attacks (the reader's pitch window starts two attacks after the onset and stops one before the
 * end) holds `minCycles + 1` periods: only then does a window of that length hold the `minCycles + 1` rising zero
 * crossings the reader needs whatever the phase. A velocity below `minVelocity` is `too-quiet`.
 * Precedence: overlap, polyphonic, too-short, too-quiet, abutting (a note too short or too quiet to read is unreadable whatever its neighbours; abutting applies to the rest). Sorted by position, then pitch.
 */
export function markReadability(
  notes: readonly RuleNote[], bpm: number, options: { attackMs: number; releaseMs: number; gapMs: number; minCycles: number; minVelocity: number }
): PredictedNote[] {
  const sorted = [...notes].sort((a, b) => a.position - b.position || a.pitch - b.pitch);
  const onsets = sorted.map((note) => toMs(note.position, bpm));
  const ends = sorted.map((note) => toMs(note.position + note.duration, bpm));
  const overlap = new Set<number>();
  const polyphonic = new Set<number>();
  const abutting = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const shared = Math.min(ends[i], ends[j]) + options.releaseMs - Math.max(onsets[i], onsets[j]);
      if (shared <= EPSILON_MS) {
        if (-shared < options.gapMs - EPSILON_MS) {
          abutting.add(i);
          abutting.add(j);
        }
        continue;
      }
      const bucket = shared > options.releaseMs + EPSILON_MS ? (sorted[i].pitch === sorted[j].pitch ? overlap : polyphonic) : abutting;
      bucket.add(i);
      bucket.add(j);
    }
  }
  return sorted.map((note, i) => {
    const hz = 440 * 2 ** ((note.pitch - 69 + note.cent / 100) / 12);
    const shortest = options.attackMs * 3 + (options.minCycles + 1) * 1000 / hz;
    const readability: Readability =
      overlap.has(i) ? "overlap"
      : polyphonic.has(i) ? "polyphonic"
      : ends[i] - onsets[i] < shortest ? "too-short"
      : note.velocity < options.minVelocity ? "too-quiet"
      : abutting.has(i) ? "abutting"
      : "readable";
    return { ...note, readability };
  });
}

/** Every subset of `applicable`, ordered by size then name, the empty set first. */
export const DEVIATION_SUBSETS = (applicable: readonly DeviationName[]): ReadonlySet<DeviationName>[] => {
  const names = [...applicable].sort();
  const subsets: DeviationName[][] = [];
  for (let mask = 0; mask < 1 << names.length; mask++) subsets.push(names.filter((_, bit) => mask & (1 << bit)));
  return subsets
    .sort((a, b) => a.length - b.length || a.join("+").localeCompare(b.join("+")))
    .map((subset) => new Set(subset));
};
