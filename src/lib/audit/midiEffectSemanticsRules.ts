/**
 * What each stock MIDI effect is documented to emit, as pure functions of the input notes and the
 * device's settings, plus the registers the semantics audit judges a render against: the known
 * deviations of the engine from that rule, and the behaviours the register questions. The rule is
 * read from the crate (`openDAW/crates/stock-devices/device-*`) and the manual
 * (`openDAW/packages/app/manual/public/devices/midi/`; since openDAW#524 and #525 the Arpeggio's velocity
 * control and the Zeitgeist's note-offs are documented as the engine has them); a
 * deviation is a place the engine does something else, named so a render can be judged with it on and off.
 * Positions are absolute pulses.
 * The only SDK import is `PPQN`, for the one place pulses become milliseconds. The Arpeggio's rule covers its walk, Order,
 * Octaves, Rate, Gate, Repeat, Velocity, Offset and Seed; Hold, Retrigger and the step lanes stay at the box defaults here,
 * where the crate's step reduces to that walk (its `tests/golden.rs`).
 */
import { PPQN } from "@opendaw/lib-dsp";
import { walkIndex } from "./arpeggioWalk";

/** The shape of `EventRecord`'s note-on (`crates/abi/src/lib.rs:39-51`), in absolute pulses. */
export interface RuleNote { position: number; duration: number; pitch: number; cent: number; velocity: number }

/** None today: every deviation the audit has named was answered upstream and retired (`debug/2026-11-03-midi-effect-semantics/note.md`). */
export type DeviationName = never;

export type QuestionName = "pitch-drops-out-of-range";

export interface Deviation { name: DeviationName; device: SemanticsDevice; sentence: string; source: string }

export interface Question { name: QuestionName; device: SemanticsDevice; sentence: string; sources: string[] }

export interface ArpeggioSettings {
  /** An index into `ArpeggioDeviceBoxAdapter.Modes` */
  modeIndex: number;
  /** 0 played, 1 pitch */
  order: number;
  numOctaves: number; rateIndex: number; gate: number; repeat: number; velocity: number; offset: number; seed: number;
}
export interface PitchSettings { semiTones: number; cents: number; octaves: number }
export interface NoteFilterSettings { min: number; max: number; set: boolean; transpose: number; key: number }
/** The seed stays the box default 0x800. */
export interface VelocitySettings { magnetPosition: number; magnetStrength: number; randomAmount: number; offset: number; mix: number }
export interface ZeitgeistSettings { amount: number; duration: number }

export type DeviceSetting =
  | { device: "arpeggio"; settings: ArpeggioSettings }
  | { device: "note-filter"; settings: NoteFilterSettings }
  | { device: "pitch"; settings: PitchSettings }
  | { device: "velocity"; settings: VelocitySettings }
  | { device: "zeitgeist"; settings: ZeitgeistSettings };

export type SemanticsDevice = DeviceSetting["device"];

/** The adapter functions a chain needs, bound by the caller; a chain holds at most one Velocity and one Zeitgeist. */
export interface RuleContext {
  /** The transport span the render covers: the engine runs every device over it, past the region's end too. */
  range: { from: number; to: number };
  computeVelocity: (position: number, original: number) => number;
  warp: (position: number) => number;
}

export const DEVIATIONS: readonly Deviation[] = [];

export const QUESTIONS: readonly Question[] = [
  {
    name: "pitch-drops-out-of-range", device: "pitch",
    sentence: "A note shifted outside 0..127 is dropped, not clamped; the crate documents it as a deviation from the TS device, and nothing says which is meant.",
    sources: ["device-pitch/src/lib.rs:8-11", "PitchDeviceProcessor (TS)"]
  }
];

export const RULE_SENTENCES: Record<SemanticsDevice, string> = {
  arpeggio: "On the absolute rate grid, one note per step from the notes held at that step, in played or pitch order, walked by its mode over the octaves from the offset, each as long as the gate says, past the held note's end too; the velocity one fixed value rising from silent at -100 % to full at 0 %, then a blend from full toward the note's own at +100 %.",
  "note-filter": "Only a note between min and max, both included, passes; it then moves by the transpose semitones, or plays as the key when set is on; a result outside 0..127 is dropped.",
  pitch: "Every note moves by octaves × 12 + semitones, its cent by the cents setting; a note shifted outside 0..127 is dropped.",
  velocity: "Every note's velocity is the device's computeVelocity at the note's absolute position.",
  zeitgeist: "Every note starts where the groove warps its position to and ends where it warps its note-off to, so its duration changes with its place in the cell."
};

/** `ArpeggioDeviceBoxAdapter.RateFractions`: `floor(3840 / d) × n` (`device-arpeggio/src/lib.rs:42-51`). */
export const ARPEGGIO_RATE_PPQN: readonly number[] = [3840, 1920, 1280, 960, 720, 640, 480, 360, 320, 240, 180, 160, 120, 80, 60, 40, 30];

/**
 * The manual's rule (`manual/.../arpeggio.md:122-132`) and the crate's matrix
 * (`device-arpeggio/src/lib.rs:193-205`): below 0 one fixed velocity `1 + v`, ignoring the input; above it a blend
 * from full toward the note's own.
 */
export function arpeggioVelocity(v: number, vel: number): number {
  return v <= 0 ? 1 + v : vel * v + (1 - v);
}

/**
 * Arpeggio per `step` and the grid loop in `process_in` (`device-arpeggio/src/lib.rs:589-643,679-687`): a note-on at every absolute grid line in range with at least
 * one held note, each `gate × rate` long (the manual, "3. Note": note length as a percentage of the step rate; the held
 * note's end does not cut it, `arpeggio.md`, "5. Technical Notes"), keeping the cents of the note it comes from (openDAW#526).
 */
export function arpeggioRule(notes: readonly RuleNote[], settings: ArpeggioSettings, range: { from: number; to: number }): RuleNote[] {
  const rate = ARPEGGIO_RATE_PPQN[Math.max(0, Math.min(settings.rateIndex, ARPEGGIO_RATE_PPQN.length - 1))];
  const octaves = Math.max(1, settings.numOctaves);
  const repeat = Math.max(1, settings.repeat);
  const stepLength = rate * Math.max(settings.gate, 0);
  const length = stepLength < 1 ? 1 : Math.floor(stepLength);
  const byPitch = settings.order === 1;
  const out: RuleNote[] = [];
  // first_index: the smallest grid index whose line is at or after `from` (device-arpeggio/src/lib.rs:414-417)
  for (let index = Math.ceil(range.from / rate); index * rate < range.to; index++) {
    const position = index * rate;
    const stack = notes
      .filter((note) => note.position <= position && position < note.position + note.duration)
      .sort((a, b) => (byPitch ? a.pitch - b.pitch || a.position - b.position : a.position - b.position || a.pitch - b.pitch));
    if (stack.length === 0) continue;
    const picked = walkIndex(settings.modeIndex, settings.seed, Math.floor(index / repeat) + settings.offset, stack.length * octaves);
    const source = stack[picked % stack.length];
    out.push({
      position,
      duration: length,
      pitch: source.pitch + 12 * Math.floor(picked / stack.length),
      cent: source.cent,
      velocity: arpeggioVelocity(settings.velocity, source.velocity)
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

/** Note Filter per `output_pitch` and `transform` (`device-note-filter/src/lib.rs:45-49,105-118`): min..max both included, then transpose or set, a result outside 0..127 dropped. Not modelled, as for Pitch: the 64 held-note cap (`MAX_HELD`), which no pattern reaches. */
export function noteFilterRule(notes: readonly RuleNote[], settings: NoteFilterSettings): RuleNote[] {
  const out: RuleNote[] = [];
  for (const note of notes) {
    if (note.pitch < settings.min || note.pitch > settings.max) continue;
    const pitch = settings.set ? settings.key : note.pitch + settings.transpose;
    if (pitch < 0 || pitch > 127) continue;
    out.push({ ...note, pitch });
  }
  return out;
}

/** Velocity replaced by the adapter's `computeVelocity` at the absolute position (`VelocityDeviceBoxAdapter.ts:31-39`). */
export function velocityRule(notes: readonly RuleNote[], computeVelocity: (position: number, original: number) => number): RuleNote[] {
  return notes.map((note) => ({ ...note, velocity: computeVelocity(note.position, note.velocity) }));
}

/** Zeitgeist per `process` (`device-zeitgeist/src/lib.rs:35-50`): every record through the groove as a float, the note-off too (manual `zeitgeist.md:53`, as corrected for openDAW#525). */
export function zeitgeistRule(notes: readonly RuleNote[], groove: { warp(position: number): number }): RuleNote[] {
  return notes.map((note) => {
    const position = groove.warp(note.position);
    return { ...note, position, duration: groove.warp(note.position + note.duration) - position };
  });
}

function applyStage(stage: DeviceSetting, context: RuleContext, notes: readonly RuleNote[]): RuleNote[] {
  switch (stage.device) {
    case "arpeggio": return arpeggioRule(notes, stage.settings, context.range);
    case "note-filter": return noteFilterRule(notes, stage.settings);
    case "pitch": return pitchRule(notes, stage.settings);
    case "velocity": return velocityRule(notes, context.computeVelocity);
    case "zeitgeist": return zeitgeistRule(notes, { warp: context.warp });
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
  chain: readonly DeviceSetting[], context: RuleContext, _deviations: ReadonlySet<DeviationName>, notes: readonly RuleNote[]
): RuleNote[] {
  return chain.reduce<RuleNote[]>((current, stage) => applyStage(stage, context, current), [...notes]);
}

/**
 * The questioned behaviours a row exercises; `chain` is the enabled chain. Each is read at its own stage, from the notes that
 * reach it: a Pitch that dropped a note.
 */
export function questionsFor(chain: readonly DeviceSetting[], context: RuleContext, source: readonly RuleNote[]): QuestionName[] {
  const names: QuestionName[] = [];
  const none: ReadonlySet<DeviationName> = new Set();
  const before = (index: number): RuleNote[] => composeRules(chain.slice(0, index), context, none, source);
  const dropped = chain.some((stage, index) => stage.device === "pitch" && pitchRule(before(index), stage.settings).length < before(index).length);
  if (dropped) names.push("pitch-drops-out-of-range");
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
 * end) is at least `minCycles + 1` periods long: a window that long holds `minCycles + 1` rising zero crossings whatever
 * the phase, the `minCycles` whole cycles the reader needs. A velocity below `minVelocity` is `too-quiet`. A velocity of exactly 0 is
 * silence, not a quiet note: the Nano's voice gain is `gain × velocity` (`device-nano/src/voice.rs:129`), so the note is
 * left out of the prediction before anything is marked, and it neither sounds nor touches a neighbour.
 * Precedence: overlap, polyphonic, too-short, too-quiet, abutting (a note too short or too quiet to read is unreadable whatever its neighbours; abutting applies to the rest). Sorted by position, then pitch.
 */
export function markReadability(
  notes: readonly RuleNote[], bpm: number, options: { attackMs: number; releaseMs: number; gapMs: number; minCycles: number; minVelocity: number }
): PredictedNote[] {
  const sorted = notes.filter((note) => note.velocity !== 0).sort((a, b) => a.position - b.position || a.pitch - b.pitch);
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
