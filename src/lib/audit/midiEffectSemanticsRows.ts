/**
 * The MIDI effect semantics audit's rows: which device, which settings, which pattern, in a fixed order
 * with stable ids, plus the constants every row shares and the helpers a page and its tests need
 * (the URL resolver, the predicted notes, the raw field writes).
 * Page: `midi-effect-semantics-audit-debug-demo.html`; rules: `midiEffectSemanticsRules.ts`.
 *
 * Sampling: one parameter at a time across its whole range, the others at their base, so a miss names
 * its parameter; the Arpeggio's later walks, Offset and Seed are spot-sampled, and Hold, Retrigger and the lanes stay at their defaults. Two pairs are swept together because neither reads alone: the Velocity magnet's position
 * and strength (a position with no strength moves nothing), and the Arpeggio's rate and gate (the gate is a
 * fraction of the rate's step). Each parameter's identity setting is a row too, as the control. Orderings and
 * disabled devices are one row per device or pair at a single non-identity setting. Nine of the seventeen Arpeggio
 * rates are swept (1/3, 1/4, 3/16, 1/8, 3/32, 1/12, 1/16, 1/32, 1/64), the straight, dotted and triplet kinds from
 * the longest step that falls twice on the 1750-pulse hold to the first under the reader's floor. Of the eight left
 * out, 1/1 and 1/2 give a single step on the hold, 1/6, 3/64, 1/24 and 1/48 repeat a kind already swept between two
 * swept neighbours, and 1/96 and 1/128 put a gate-0.5 step under the floor at key 60, as 1/64 already does (`no rule`).
 * The Note Filter's range is sampled as windows on the GAPPED melody (some notes filtered out, every survivor read on its own, so a
 * leaked note starts a read note of its own; on the legato melody it would hide inside its neighbours' spans) and as
 * inclusive ends on the chromatic run (an off-by-one drops exactly one note); its transposes on the melody, with two rows on
 * the chromatic run that push every note past 127 or below 0 (predicted silent, judged on silence); its set on the gapped melody
 * and the sixteenths.
 *
 * Id readings: a number prints as JavaScript prints it (`-0.5`, `12.5`), no padding, so `vel-offset-1-melody`
 * is offset -1. The Zeitgeist rows take every `GrooveShuffleBoxAdapter.DurationPPQNs` value. The SDK's `Pattern.id` is a closed union that has no room for the audit's own
 * patterns, so the audit's carry `AuditPattern`, the same shape with a wider id.
 */
import { PPQN } from "@opendaw/lib-dsp";
import { GrooveShuffleBoxAdapter, ArpeggioDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { ArpeggioDeviceBox, NoteFilterDeviceBox, PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox } from "@opendaw/studio-core";
import { PATTERN_PPQN, REGION_START_PPQN, patternById, withGaps, type Pattern } from "@/lib/midiEffects/patterns";
import { zeitgeistGrooveBox } from "./midiEffectChain";
import {
  DEVIATIONS, DEVIATION_SUBSETS, clipToRange, composeRules,
  type ArpeggioSettings, type DeviationName, type DeviceSetting, type NoteFilterSettings, type PitchSettings, type RuleContext, type RuleNote,
  type SemanticsDevice, type VelocitySettings, type ZeitgeistSettings,
} from "./midiEffectSemanticsRules";

/** The region starts at bar 1: nothing sounds in bar 0, so the render's start is clear of every onset. */
export const REGION_POSITION_PPQN = REGION_START_PPQN;
export const REGION_DURATION_PPQN = PATTERN_PPQN;
export const RENDER_TAIL_SECONDS = 0.25;
/** The sample every row plays: a 440 Hz tone this long. A note at pitch p consumes `duration_s × 2^((p − 69)/12)` of it, so a row's notes must keep that at or under this. */
export const SAMPLE_SECONDS = 4;
export const SAMPLE_HZ = 440;
/** The key the sample sounds at its own pitch. */
export const ROOT_KEY = 69;
export const NANO_ATTACK_SECONDS = 0.001;
export const NANO_RELEASE_SECONDS = 0.001;
/** 1750 pulses = 0.911 s at 120 bpm, and 3840 + 1750 = 5590 is not on the 1/16 grid (5520 + 70), so the held note ends 70 pulses into the last Arpeggio step: the row shows that step running its full gate length past the held note. */
export const HELD_NOTE_PPQN = 1750;

export type SemanticsPatternId = "held-note" | "held-chord" | "held-rolled" | "chromatic" | "chords" | "sixteenths" | "melody" | "melody-gaps";

export interface AuditPattern extends Omit<Pattern, "id"> { readonly id: SemanticsPatternId }

const { SemiQuaver } = PPQN;

export const HELD_NOTE: AuditPattern = {
  id: "held-note",
  label: "Held note",
  blurb: "One C3 held off the grid: the Arpeggio's last step runs its full gate length past the note's end.",
  notes: [{ position: 0, duration: HELD_NOTE_PPQN, pitch: 60, velocity: 1 }],
};

export const HELD_CHORD: AuditPattern = {
  id: "held-chord",
  label: "Held chord",
  blurb: "A C major triad held off the grid: the stack an Arpeggio walks.",
  notes: [60, 64, 67].map((pitch) => ({ position: 0, duration: HELD_NOTE_PPQN, pitch, velocity: 0.8 })),
};

/** Three notes entering top first, all held by the second step and ending together: Played order and Pitch order walk them opposite ways. */
export const HELD_ROLLED: AuditPattern = {
  id: "held-rolled",
  label: "Held rolled chord",
  blurb: "A C major triad entering from the top down: the order the notes were played is the reverse of their pitch.",
  notes: [[67, 0], [64, 60], [60, 120]].map(([pitch, position]) => ({ position, duration: HELD_NOTE_PPQN - position, pitch, velocity: 0.8 })),
};

export const CHROMATIC: AuditPattern = {
  id: "chromatic",
  label: "Chromatic",
  blurb: "Twelve sixteenths C3 to B3, each held a thirty-second: every semitone of a shift, one at a time.",
  notes: Array.from({ length: 12 }, (_, k) => ({ position: k * SemiQuaver, duration: SemiQuaver / 2, pitch: 60 + k, velocity: 1 })),
};

const demoPattern = (id: "chords" | "sixteenths" | "melody"): AuditPattern => ({ ...patternById(id), id });

/** The demo melody with every eighth at 90 % (432 pulses): a 48-pulse (25 ms) gap the one-voice reader splits on, so a note a filter should have dropped between two survivors starts a read note of its own instead of hiding inside its neighbours' legato (the Rendered page gaps its melody the same way). */
export const MELODY_GAPS: AuditPattern = { ...withGaps(patternById("melody"), 0.9), id: "melody-gaps", label: "Melody, gapped", blurb: "The demo melody with every eighth at 90 %: every survivor of a filter is read on its own." };

export const AUDIT_PATTERNS: readonly AuditPattern[] = [HELD_NOTE, HELD_CHORD, HELD_ROLLED, CHROMATIC, demoPattern("chords"), demoPattern("sixteenths"), demoPattern("melody"), MELODY_GAPS];

export type RowGroup = "dry" | "arpeggio" | "pitch" | "velocity" | "zeitgeist" | "note-filter" | "order" | "disabled";

/** One device in a row's chain; a chain holds at most one Velocity and one Zeitgeist (`RuleContext` carries one of each). */
export interface ChainStage { setting: DeviceSetting; enabled: boolean }

export interface SemanticsRow {
  id: string;
  label: string;
  group: RowGroup;
  pattern: SemanticsPatternId;
  /** Index order; `[]` for a dry row */
  chain: readonly ChainStage[];
  quick: boolean;
}

export const ARPEGGIO_BASE: ArpeggioSettings = { modeIndex: 0, order: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1, offset: 0, seed: 0 };
export const PITCH_BASE: PitchSettings = { semiTones: 0, cents: 0, octaves: 0 };
export const NOTE_FILTER_BASE: NoteFilterSettings = { min: 0, max: 127, set: false, transpose: 0, key: 60 };
export const VELOCITY_BASE: VelocitySettings = { magnetPosition: 0.5, magnetStrength: 0, randomAmount: 0, offset: 0, mix: 1 };
export const ZEITGEIST_BASE: ZeitgeistSettings = { amount: 0.6, duration: 480 };

export const FACTORY_KEYS: Record<SemanticsDevice, "Arpeggio" | "NoteFilter" | "Pitch" | "Velocity" | "Zeitgeist"> = {
  arpeggio: "Arpeggio", "note-filter": "NoteFilter", pitch: "Pitch", velocity: "Velocity", zeitgeist: "Zeitgeist",
};

const rateName = (index: number): string => {
  const [n, d] = ArpeggioDeviceBoxAdapter.RateFractions[index];
  return `${n}/${d}`;
};
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const percent = (fraction: number): string => `${Math.round(fraction * 100)} %`;
const patternLabel = (id: SemanticsPatternId): string => AUDIT_PATTERNS.find((p) => p.id === id)?.label.toLowerCase() ?? id;
const durationName = (pulses: number): string => GrooveShuffleBoxAdapter.DurationStrings[GrooveShuffleBoxAdapter.DurationPPQNs.indexOf(pulses)] ?? `${pulses}`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const arp = (settings: ArpeggioSettings): DeviceSetting => ({ device: "arpeggio", settings });
const pitch = (settings: PitchSettings): DeviceSetting => ({ device: "pitch", settings });
const noteFilter = (settings: NoteFilterSettings): DeviceSetting => ({ device: "note-filter", settings });
const velocity = (settings: VelocitySettings): DeviceSetting => ({ device: "velocity", settings });
const zeitgeist = (settings: ZeitgeistSettings): DeviceSetting => ({ device: "zeitgeist", settings });

/** The row every later row is calibrated by (reference peak, instrument offset): the first row, a dry one, always rendered. */
export const CALIBRATION_ROW_ID = "dry-sixteenths";

/** The quick subset's ids, besides every order and disabled row. */
export const QUICK_IDS: ReadonlySet<string> = new Set([
  "dry-sixteenths", "dry-melody", "dry-chromatic", "dry-held-note",
  ...[0, 1, 2].flatMap((m) => [`arp-mode${m}-oct1-held-chord`, `arp-mode${m}-oct3-held-chord`, `arp-mode${m}-oct2-gate1-held-chord`]),
  "arp-mode6-oct1-held-chord", "arp-mode13-oct1-held-chord", "arp-order1-held-rolled",
  "arp-rate9-gate1-held-note", "arp-rate6-gate0.5-held-note", "arp-rate12-gate0.5-held-note",
  "arp-repeat2-held-chord", "arp-vel0-held-chord", "arp-vel0.5-held-chord",
  "pitch-st7-chromatic", "pitch-oct1-chromatic", "pitch-ct12.5-chromatic", "pitch-oct7-chromatic",
  "vel-magnet1x1-sixteenths", "vel-random0.5-sixteenths", "vel-offset-1-sixteenths", "vel-magnet1x1-melody",
  "zg-amount0.25-dur480-sixteenths", "zg-amount0.75-dur480-sixteenths", "zg-amount0.75-dur3840-sixteenths", "zg-amount1-dur480-sixteenths",
  "nf-range62-67-melody-gaps", "nf-range61-127-chromatic", "nf-tr7-melody-gaps", "nf-set-key72-melody-gaps",
]);

type RowDraft = Omit<SemanticsRow, "quick">;
const one = (setting: DeviceSetting, enabled = true): ChainStage => ({ setting, enabled });

function dryRows(): RowDraft[] {
  return (["sixteenths", "melody", "chromatic", "held-note"] as const).map((pattern) => ({
    id: `dry-${pattern}`, label: `No effect — ${patternLabel(pattern)}`, group: "dry", pattern, chain: [],
  }));
}

const SEEDED_MODES: readonly string[] = ["Random", "Random Other", "Shuffle", "Random Once", "Walk"];

function arpeggioRows(): RowDraft[] {
  const rows: RowDraft[] = [];
  const add = (id: string, label: string, pattern: SemanticsPatternId, settings: ArpeggioSettings): void => {
    rows.push({ id, label: `${label} — ${patternLabel(pattern)}`, group: "arpeggio", pattern, chain: [one(arp(settings))] });
  };
  const walk = (mode: number, octaves: number): string => `Arpeggio ${ArpeggioDeviceBoxAdapter.Modes[mode]}, ${plural(octaves, "octave")}`;
  for (const pattern of ["held-chord", "chords"] as const) {
    for (const modeIndex of [0, 1, 2] as const) {
      for (let numOctaves = 1; numOctaves <= 5; numOctaves++) {
        add(`arp-mode${modeIndex}-oct${numOctaves}-${pattern}`, walk(modeIndex, numOctaves), pattern, { ...ARPEGGIO_BASE, modeIndex, numOctaves });
      }
    }
  }
  for (let numOctaves = 1; numOctaves <= 5; numOctaves++) {
    add(`arp-oct${numOctaves}-held-note`, `Arpeggio ${plural(numOctaves, "octave")}`, "held-note", { ...ARPEGGIO_BASE, numOctaves });
  }
  for (const rateIndex of [3, 6, 9, 12, 14, 2, 8, 4, 7]) {
    for (const gate of [0.25, 0.5, 1, 2]) {
      add(`arp-rate${rateIndex}-gate${gate}-held-note`, `Arpeggio ${rateName(rateIndex)}, gate ${percent(gate)}`, "held-note", { ...ARPEGGIO_BASE, rateIndex, gate });
    }
  }
  for (const repeat of [1, 2, 4, 16]) {
    add(`arp-repeat${repeat}-held-chord`, `Arpeggio repeat ×${repeat}`, "held-chord", { ...ARPEGGIO_BASE, repeat });
  }
  for (const modeIndex of [0, 1, 2] as const) {
    add(`arp-mode${modeIndex}-oct2-gate1-held-chord`, `${walk(modeIndex, 2)}, gate 100 %`, "held-chord", { ...ARPEGGIO_BASE, modeIndex, numOctaves: 2, gate: 1 });
  }
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    for (const pattern of ["held-chord", "held-note"] as const) {
      add(`arp-vel${v}-${pattern}`, `Arpeggio velocity ${percent(v)}`, pattern, { ...ARPEGGIO_BASE, velocity: v });
    }
  }
  // Every walk past the first three, on the stack of three alone and over two octaves (a longer pool), and on the changing stacks of the chords
  const laterModes = ArpeggioDeviceBoxAdapter.Modes.map((_, mode) => mode).filter((mode) => mode > 2);
  for (const modeIndex of laterModes) {
    for (const numOctaves of [1, 2]) {
      add(`arp-mode${modeIndex}-oct${numOctaves}-held-chord`, walk(modeIndex, numOctaves), "held-chord", { ...ARPEGGIO_BASE, modeIndex, numOctaves });
    }
    add(`arp-mode${modeIndex}-oct1-chords`, walk(modeIndex, 1), "chords", { ...ARPEGGIO_BASE, modeIndex });
  }
  // The seed reaches every random mode, over two octaves: a pool of three has too few orders for Random Once to show one. The default seed 0 is in the rows above
  for (const modeIndex of laterModes.filter((mode) => SEEDED_MODES.includes(ArpeggioDeviceBoxAdapter.Modes[mode]))) {
    for (const seed of [1, ArpeggioDeviceBoxAdapter.MaxSeed]) {
      add(`arp-mode${modeIndex}-seed${seed}-held-chord`, `${walk(modeIndex, 2)}, seed ${seed}`, "held-chord", { ...ARPEGGIO_BASE, modeIndex, numOctaves: 2, seed });
    }
  }
  for (const order of [0, 1]) {
    add(`arp-order${order}-held-rolled`, `Arpeggio ${ArpeggioDeviceBoxAdapter.Orders[order]} order`, "held-rolled", { ...ARPEGGIO_BASE, order });
  }
  for (const offset of [1, 2, 7]) {
    add(`arp-offset${offset}-held-chord`, `Arpeggio offset ${offset}`, "held-chord", { ...ARPEGGIO_BASE, offset });
  }
  // 15 is a whole number of passes over three notes, so the longest offset runs over two octaves
  add("arp-offset15-oct2-held-chord", "Arpeggio offset 15, 2 octaves", "held-chord", { ...ARPEGGIO_BASE, offset: 15, numOctaves: 2 });
  // The offset adds after the repeat's division: `effective / repeat + offset`
  add("arp-repeat2-offset1-held-chord", "Arpeggio repeat ×2, offset 1", "held-chord", { ...ARPEGGIO_BASE, repeat: 2, offset: 1 });
  return rows;
}

function pitchRows(): RowDraft[] {
  const rows: RowDraft[] = [];
  for (const pattern of ["chromatic", "melody"] as const) {
    const add = (id: string, label: string, settings: PitchSettings): void => {
      rows.push({ id: `${id}-${pattern}`, label: `Pitch ${label} — ${patternLabel(pattern)}`, group: "pitch", pattern, chain: [one(pitch(settings))] });
    };
    for (const semiTones of [-36, -12, -7, 0, 7, 12, 36]) add(`pitch-st${semiTones}`, `${signed(semiTones)} st`, { ...PITCH_BASE, semiTones });
    for (const octaves of [-7, -3, -1, 0, 1, 3, 7]) add(`pitch-oct${octaves}`, `${signed(octaves)} oct`, { ...PITCH_BASE, octaves });
    for (const cents of [-50, -12.5, 0, 12.5, 50]) add(`pitch-ct${cents}`, `${signed(cents)} ct`, { ...PITCH_BASE, cents });
    add("pitch-combined", "+7 st, +1 oct, +12.5 ct", { semiTones: 7, octaves: 1, cents: 12.5 });
  }
  return rows;
}

function velocityRows(): RowDraft[] {
  const rows: RowDraft[] = [];
  for (const pattern of ["sixteenths", "melody"] as const) {
    const add = (id: string, label: string, settings: VelocitySettings): void => {
      rows.push({ id: `${id}-${pattern}`, label: `Velocity ${label} — ${patternLabel(pattern)}`, group: "velocity", pattern, chain: [one(velocity(settings))] });
    };
    for (const magnetPosition of [0, 0.5, 1]) {
      for (const magnetStrength of [0, 0.5, 1]) {
        add(`vel-magnet${magnetPosition}x${magnetStrength}`, `magnet at ${percent(magnetPosition)}, strength ${percent(magnetStrength)}`, { ...VELOCITY_BASE, magnetPosition, magnetStrength });
      }
    }
    for (const randomAmount of [0, 0.5, 1]) add(`vel-random${randomAmount}`, `random ${percent(randomAmount)}`, { ...VELOCITY_BASE, randomAmount });
    for (const offset of [-1, -0.5, 0, 0.5]) add(`vel-offset${offset}`, `offset ${percent(offset)}`, { ...VELOCITY_BASE, offset });
    for (const mix of [0, 0.5, 1]) add(`vel-mix${mix}`, `mix ${percent(mix)} of a full magnet`, { ...VELOCITY_BASE, magnetPosition: 1, magnetStrength: 1, mix });
  }
  return rows;
}

function zeitgeistRows(): RowDraft[] {
  const rows: RowDraft[] = [];
  const add = (amount: number, duration: number, pattern: SemanticsPatternId): void => {
    rows.push({
      id: `zg-amount${amount}-dur${duration}-${pattern}`,
      label: `Zeitgeist ${percent(amount)}, ${durationName(duration)} — ${patternLabel(pattern)}`,
      group: "zeitgeist", pattern, chain: [one(zeitgeist({ amount, duration }))],
    });
  };
  const amounts = [0, 0.25, 0.5, 0.75, 1];
  for (const amount of amounts) for (const duration of new Set(GrooveShuffleBoxAdapter.DurationPPQNs)) add(amount, duration, "sixteenths");
  for (const amount of amounts) for (const duration of [480, 3840]) add(amount, duration, "melody");
  return rows;
}

function noteFilterRows(): RowDraft[] {
  const rows: RowDraft[] = [];
  const add = (id: string, label: string, pattern: SemanticsPatternId, settings: NoteFilterSettings): void => {
    rows.push({ id: `${id}-${pattern}`, label: `Note Filter ${label} — ${patternLabel(pattern)}`, group: "note-filter", pattern, chain: [one(noteFilter(settings))] });
  };
  const ranges: readonly (readonly [number, number, SemanticsPatternId])[] = [
    [0, 127, "melody-gaps"], [62, 67, "melody-gaps"], [65, 127, "melody-gaps"], [0, 64, "melody-gaps"], [64, 64, "melody-gaps"], [67, 62, "melody-gaps"],
    [60, 127, "chromatic"], [61, 127, "chromatic"], [0, 71, "chromatic"], [0, 70, "chromatic"],
  ];
  for (const [min, max, pattern] of ranges) add(`nf-range${min}-${max}`, `${min}..${max}`, pattern, { ...NOTE_FILTER_BASE, min, max });
  for (const transpose of [-12, -7, -1, 0, 1, 7, 12, 24]) add(`nf-tr${transpose}`, `${signed(transpose)} st`, "melody-gaps", { ...NOTE_FILTER_BASE, transpose });
  for (const transpose of [68, -72]) add(`nf-tr${transpose}`, `${signed(transpose)} st`, "chromatic", { ...NOTE_FILTER_BASE, transpose });
  for (const key of [48, 60, 72]) {
    for (const pattern of ["melody-gaps", "sixteenths"] as const) add(`nf-set-key${key}`, `set to ${key}`, pattern, { ...NOTE_FILTER_BASE, set: true, key });
  }
  add("nf-set-key72-range62-67", "62..67, set to 72", "melody-gaps", { ...NOTE_FILTER_BASE, min: 62, max: 67, set: true, key: 72 });
  add("nf-set-key72-tr7", "set to 72, +7 st", "melody-gaps", { ...NOTE_FILTER_BASE, set: true, key: 72, transpose: 7 });
  return rows;
}

const NON_IDENTITY: Record<SemanticsDevice, DeviceSetting> = {
  arpeggio: arp(ARPEGGIO_BASE),
  "note-filter": noteFilter({ ...NOTE_FILTER_BASE, min: 62, max: 67 }),
  pitch: pitch({ ...PITCH_BASE, semiTones: 7, cents: 12.5 }),
  velocity: velocity({ ...VELOCITY_BASE, magnetPosition: 1, magnetStrength: 1 }),
  zeitgeist: zeitgeist({ amount: 0.75, duration: 480 }),
};

/** A pair with an Arpeggio sits on the chords (the Arpeggio makes single notes of the held triads); the Pitch and Note Filter pair sits on the gapped melody, where the one-voice reader judges every surviving note on its own. */
const ORDERS: readonly (readonly [SemanticsDevice, SemanticsDevice, SemanticsPatternId])[] = [
  ["arpeggio", "zeitgeist", "chords"], ["zeitgeist", "arpeggio", "chords"], ["pitch", "arpeggio", "chords"], ["arpeggio", "pitch", "chords"],
  ["velocity", "arpeggio", "chords"], ["arpeggio", "velocity", "chords"],
  ["pitch", "note-filter", "melody-gaps"], ["note-filter", "pitch", "melody-gaps"], ["arpeggio", "note-filter", "chords"], ["note-filter", "arpeggio", "chords"],
];

function orderRows(): RowDraft[] {
  return ORDERS.map(([first, second, pattern]) => ({
    id: `order-${first}-${second}`,
    label: `${FACTORY_KEYS[first]} then ${FACTORY_KEYS[second]} — ${patternLabel(pattern)}`,
    group: "order", pattern, chain: [one(NON_IDENTITY[first]), one(NON_IDENTITY[second])],
  }));
}

function disabledRows(): RowDraft[] {
  return (["arpeggio", "pitch", "velocity", "zeitgeist", "note-filter"] as const).map((device) => ({
    id: `disabled-${device}`,
    label: `${FACTORY_KEYS[device]} switched off — sixteenths`,
    group: "disabled", pattern: "sixteenths", chain: [one(NON_IDENTITY[device], false)],
  }));
}

export const SEMANTICS_ROWS: readonly SemanticsRow[] = [
  ...dryRows(), ...arpeggioRows(), ...pitchRows(), ...velocityRows(), ...zeitgeistRows(), ...noteFilterRows(), ...orderRows(), ...disabledRows(),
].map((row) => ({ ...row, quick: QUICK_IDS.has(row.id) || row.group === "order" || row.group === "disabled" }));

export interface RowParams { device: string | null; pattern: string | null; rows: string | null }

const DEVICE_FILTERS: readonly string[] = ["all", "arpeggio", "pitch", "velocity", "zeitgeist", "note-filter", "order", "disabled"];

/** `?rows=all|quick|<id,id,…>`, `?device=` filters by group, `?pattern=` by pattern id; the dry rows always stay, in table order, so `dry-sixteenths` leads. */
export function resolveRows(params: RowParams): SemanticsRow[] {
  const ids = new Set(SEMANTICS_ROWS.map((row) => row.id));
  let selected: ReadonlySet<string>;
  if (params.rows === null || params.rows === "all") selected = ids;
  else if (params.rows === "quick") selected = new Set(SEMANTICS_ROWS.filter((row) => row.quick).map((row) => row.id));
  else {
    const named = params.rows.split(",").map((id) => id.trim()).filter((id) => id !== "");
    for (const id of named) if (!ids.has(id)) throw new Error(`unknown row "${id}"`);
    selected = new Set(named);
  }
  if (params.device !== null && !DEVICE_FILTERS.includes(params.device)) throw new Error(`unknown device "${params.device}"`);
  if (params.pattern !== null && !AUDIT_PATTERNS.some((p) => p.id === params.pattern)) throw new Error(`unknown pattern "${params.pattern}"`);
  return SEMANTICS_ROWS.filter((row) =>
    row.group === "dry"
    || (selected.has(row.id)
      && (params.device === null || params.device === "all" || row.group === params.device)
      && (params.pattern === null || row.pattern === params.pattern)));
}

export function renderSeconds(bpm: number): number {
  return PPQN.pulsesToSeconds(REGION_POSITION_PPQN + REGION_DURATION_PPQN, bpm) + RENDER_TAIL_SECONDS;
}

/** The rules' range: from the region's start to the render's end, the span over which the engine runs the chain and the reader reads. */
export function renderRange(bpm: number): { from: number; to: number } {
  return { from: REGION_POSITION_PPQN, to: PPQN.secondsToPulses(renderSeconds(bpm), bpm) };
}

/** The row's pattern as the engine receives it: absolute pulses, no detune. */
export function rowNotes(row: SemanticsRow): RuleNote[] {
  const pattern = AUDIT_PATTERNS.find((p) => p.id === row.pattern);
  if (pattern === undefined) throw new Error(`row "${row.id}" has unknown pattern "${row.pattern}"`);
  return pattern.notes.map((note) => ({
    position: note.position + REGION_POSITION_PPQN, duration: note.duration, pitch: note.pitch, cent: 0, velocity: note.velocity,
  }));
}

/** The rule's prediction under every subset of the deviations that apply to the enabled devices; a disabled device is skipped (`wiring.rs:1063`). */
export function predictedVariants(row: SemanticsRow, context: RuleContext): { deviations: ReadonlySet<DeviationName>; notes: RuleNote[] }[] {
  const enabled = row.chain.filter((stage) => stage.enabled).map((stage) => stage.setting);
  const devices = new Set(enabled.map((stage) => stage.device));
  const applicable = DEVIATIONS.filter((deviation) => devices.has(deviation.device)).map((deviation) => deviation.name);
  const source = rowNotes(row);
  return DEVIATION_SUBSETS(applicable).map((deviations) => ({ deviations, notes: clipToRange(composeRules(enabled, context, deviations, source), context.range) }));
}

/** Raw field writes; the caller holds the transaction. */
export function applySettings(box: EffectBox, setting: DeviceSetting): void {
  const mismatch = (): never => { throw new Error(`a ${setting.device} setting cannot be applied to ${box.constructor.name}`); };
  switch (setting.device) {
    case "arpeggio": {
      if (!(box instanceof ArpeggioDeviceBox)) return mismatch();
      const s = setting.settings;
      box.modeIndex.setValue(s.modeIndex);
      box.numOctaves.setValue(s.numOctaves);
      box.rateIndex.setValue(s.rateIndex);
      box.gate.setValue(s.gate);
      box.repeat.setValue(s.repeat);
      box.velocity.setValue(s.velocity);
      box.order.setValue(s.order);
      box.offset.setValue(s.offset);
      box.seed.setValue(s.seed);
      return;
    }
    case "note-filter": {
      if (!(box instanceof NoteFilterDeviceBox)) return mismatch();
      const s = setting.settings;
      box.min.setValue(s.min);
      box.max.setValue(s.max);
      box.set.setValue(s.set);
      box.transpose.setValue(s.transpose);
      box.key.setValue(s.key);
      return;
    }
    case "pitch": {
      if (!(box instanceof PitchDeviceBox)) return mismatch();
      box.semiTones.setValue(setting.settings.semiTones);
      box.cents.setValue(setting.settings.cents);
      box.octaves.setValue(setting.settings.octaves);
      return;
    }
    case "velocity": {
      if (!(box instanceof VelocityDeviceBox)) return mismatch();
      const s = setting.settings;
      box.magnetPosition.setValue(s.magnetPosition);
      box.magnetStrength.setValue(s.magnetStrength);
      box.randomAmount.setValue(s.randomAmount);
      box.offset.setValue(s.offset);
      box.mix.setValue(s.mix);
      return;
    }
    case "zeitgeist": {
      if (!(box instanceof ZeitgeistDeviceBox)) return mismatch();
      const groove = zeitgeistGrooveBox(box);
      groove.amount.setValue(setting.settings.amount);
      groove.duration.setValue(setting.settings.duration);
      return;
    }
  }
}

/** The inverse of `applySettings`: reads a device box's fields back into its setting. */
export function settingsOf(box: EffectBox): DeviceSetting {
  if (box instanceof ArpeggioDeviceBox) {
    return {
      device: "arpeggio",
      settings: {
        modeIndex: box.modeIndex.getValue(), order: box.order.getValue(), numOctaves: box.numOctaves.getValue(), rateIndex: box.rateIndex.getValue(),
        gate: box.gate.getValue(), repeat: box.repeat.getValue(), velocity: box.velocity.getValue(), offset: box.offset.getValue(), seed: box.seed.getValue(),
      },
    };
  }
  if (box instanceof NoteFilterDeviceBox) {
    return {
      device: "note-filter",
      settings: { min: box.min.getValue(), max: box.max.getValue(), set: box.set.getValue(), transpose: box.transpose.getValue(), key: box.key.getValue() },
    };
  }
  if (box instanceof PitchDeviceBox) {
    return { device: "pitch", settings: { semiTones: box.semiTones.getValue(), cents: box.cents.getValue(), octaves: box.octaves.getValue() } };
  }
  if (box instanceof VelocityDeviceBox) {
    return {
      device: "velocity",
      settings: {
        magnetPosition: box.magnetPosition.getValue(), magnetStrength: box.magnetStrength.getValue(),
        randomAmount: box.randomAmount.getValue(), offset: box.offset.getValue(), mix: box.mix.getValue(),
      },
    };
  }
  if (box instanceof ZeitgeistDeviceBox) {
    const groove = zeitgeistGrooveBox(box);
    return { device: "zeitgeist", settings: { amount: groove.amount.getValue(), duration: groove.duration.getValue() } };
  }
  throw new Error(`no settings reader for ${box.constructor.name}`);
}
