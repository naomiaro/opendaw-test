/**
 * The MIDI effect semantics audit's rows: which device, which settings, which pattern, in a fixed order
 * with stable ids, plus the constants every row shares and the helpers a page and its tests need
 * (the URL resolver, the predicted notes, the raw field writes).
 * Page: `midi-effect-semantics-audit-debug-demo.html`; rules: `midiEffectSemanticsRules.ts`.
 *
 * Sampling: one parameter at a time across its whole range, the others at their base, so a miss names
 * its parameter. Two pairs are swept together because neither reads alone: the Velocity magnet's position
 * and strength (a position with no strength moves nothing), and the Arpeggio's rate and gate (the gate is a
 * fraction of the rate's step). Each parameter's identity setting is a row too, as the control. Orderings and
 * disabled devices are one row per device or pair at a single non-identity setting. Arpeggio rates 1/48 and
 * finer are left out: a step at gate 0.5 is under the reader's floor at pitch 60.
 *
 * Id readings: a number prints as JavaScript prints it (`-0.5`, `12.5`), no padding, so `vel-offset-1-melody`
 * is offset -1. The Zeitgeist rows take every DISTINCT `GrooveShuffleBoxAdapter.DurationPPQNs` value, 8 of
 * 9 (960 is listed twice). The SDK's `Pattern.id` is a closed union that has no room for the audit's own
 * patterns, so the audit's carry `AuditPattern`, the same shape with a wider id.
 */
import { PPQN } from "@opendaw/lib-dsp";
import { GrooveShuffleBoxAdapter, ArpeggioDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { ArpeggioDeviceBox, PitchDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox } from "@opendaw/studio-core";
import { BAR_PPQN, PATTERN_PPQN, patternById, type Pattern } from "@/lib/midiEffects/patterns";
import { zeitgeistGrooveBox } from "./midiEffectChain";
import {
  DEVIATIONS, DEVIATION_SUBSETS, clipToRange, composeRules,
  type ArpeggioSettings, type DeviationName, type DeviceSetting, type PitchSettings, type RuleContext, type RuleNote,
  type SemanticsDevice, type VelocitySettings, type ZeitgeistSettings,
} from "./midiEffectSemanticsRules";

/** The region starts at bar 1: nothing sounds in bar 0, so the render's start is clear of every onset. */
export const REGION_POSITION_PPQN = BAR_PPQN;
export const REGION_DURATION_PPQN = PATTERN_PPQN;
export const RENDER_TAIL_SECONDS = 0.25;
/** The sample every row plays: a 440 Hz tone this long. A note at pitch p consumes `duration_s × 2^((p − 69)/12)` of it, so a row's notes must keep that at or under this. */
export const SAMPLE_SECONDS = 4;
export const SAMPLE_HZ = 440;
/** The key the sample sounds at its own pitch. */
export const ROOT_KEY = 69;
export const NANO_ATTACK_SECONDS = 0.001;
export const NANO_RELEASE_SECONDS = 0.001;
/** 1750 pulses = 0.911 s at 120 bpm, and 3840 + 1750 = 5590 is not on the 1/16 grid (5520 + 70): the last Arpeggio step is capped at 70 pulses where the engine does not cap it. */
export const HELD_NOTE_PPQN = 1750;
export const ONSET_TOLERANCE_MS = 1;
export const CENTS_TOLERANCE = 2;
export const VELOCITY_TOLERANCE = 0.01;
export const END_TOLERANCE_MS = 2;
/** A pitch track that wanders more than this over a note is a tone the reader cannot name, not a pitch. */
export const UNSTABLE_JITTER_CENTS = 10;

export type SemanticsPatternId = "held-note" | "held-chord" | "chromatic" | "chords" | "sixteenths" | "melody";

export interface AuditPattern extends Omit<Pattern, "id"> { readonly id: SemanticsPatternId }

const { SemiQuaver } = PPQN;

export const HELD_NOTE: AuditPattern = {
  id: "held-note",
  label: "Held note",
  blurb: "One C4 held off the grid: the Arpeggio's last step is capped by the note.",
  notes: [{ position: 0, duration: HELD_NOTE_PPQN, pitch: 60, velocity: 1 }],
};

export const HELD_CHORD: AuditPattern = {
  id: "held-chord",
  label: "Held chord",
  blurb: "A C major triad held off the grid: the stack an Arpeggio walks.",
  notes: [60, 64, 67].map((pitch) => ({ position: 0, duration: HELD_NOTE_PPQN, pitch, velocity: 0.8 })),
};

export const CHROMATIC: AuditPattern = {
  id: "chromatic",
  label: "Chromatic",
  blurb: "Twelve sixteenths C4 to B4, each held a thirty-second: every semitone of a shift, one at a time.",
  notes: Array.from({ length: 12 }, (_, k) => ({ position: k * SemiQuaver, duration: SemiQuaver / 2, pitch: 60 + k, velocity: 1 })),
};

const demoPattern = (id: "chords" | "sixteenths" | "melody"): AuditPattern => ({ ...patternById(id), id });

export const AUDIT_PATTERNS: readonly AuditPattern[] = [HELD_NOTE, HELD_CHORD, CHROMATIC, demoPattern("chords"), demoPattern("sixteenths"), demoPattern("melody")];

export type RowGroup = "dry" | "arpeggio" | "pitch" | "velocity" | "zeitgeist" | "order" | "disabled";

export interface SemanticsRow {
  id: string;
  label: string;
  group: RowGroup;
  pattern: SemanticsPatternId;
  /** Index order; `[]` for a dry row */
  chain: readonly { setting: DeviceSetting; enabled: boolean }[];
  quick: boolean;
}

export const ARPEGGIO_BASE: ArpeggioSettings = { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1 };
export const PITCH_BASE: PitchSettings = { semiTones: 0, cents: 0, octaves: 0 };
export const VELOCITY_BASE: VelocitySettings = { magnetPosition: 0.5, magnetStrength: 0, randomAmount: 0, offset: 0, mix: 1 };
export const ZEITGEIST_BASE: ZeitgeistSettings = { amount: 0.6, duration: 480 };

export const FACTORY_KEYS: Record<SemanticsDevice, "Arpeggio" | "Pitch" | "Velocity" | "Zeitgeist"> = {
  arpeggio: "Arpeggio", pitch: "Pitch", velocity: "Velocity", zeitgeist: "Zeitgeist",
};

const MODE_NAMES = ["Up", "Down", "UpDown"] as const;
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
const velocity = (settings: VelocitySettings): DeviceSetting => ({ device: "velocity", settings });
const zeitgeist = (settings: ZeitgeistSettings): DeviceSetting => ({ device: "zeitgeist", settings });

const QUICK_IDS: ReadonlySet<string> = new Set([
  "dry-sixteenths", "dry-melody", "dry-chromatic", "dry-held-note",
  ...[0, 1, 2].flatMap((m) => [`arp-mode${m}-oct1-held-chord`, `arp-mode${m}-oct3-held-chord`, `arp-mode${m}-oct2-gate1-held-chord`]),
  "arp-rate9-gate1-held-note", "arp-rate6-gate0.5-held-note", "arp-rate12-gate0.5-held-note",
  "arp-repeat2-held-chord", "arp-vel0-held-chord", "arp-vel0.5-held-chord",
  "pitch-st7-chromatic", "pitch-oct1-chromatic", "pitch-ct12.5-chromatic", "pitch-oct7-chromatic",
  "vel-magnet1x1-sixteenths", "vel-random0.5-sixteenths", "vel-offset-1-sixteenths", "vel-magnet1x1-melody",
  "zg-amount0.25-dur480-sixteenths", "zg-amount0.75-dur480-sixteenths", "zg-amount0.75-dur3840-sixteenths", "zg-amount1-dur480-sixteenths",
]);

type RowDraft = Omit<SemanticsRow, "quick">;
const one = (setting: DeviceSetting, enabled = true): { setting: DeviceSetting; enabled: boolean } => ({ setting, enabled });

function dryRows(): RowDraft[] {
  return (["sixteenths", "melody", "chromatic", "held-note"] as const).map((pattern) => ({
    id: `dry-${pattern}`, label: `No effect — ${patternLabel(pattern)}`, group: "dry", pattern, chain: [],
  }));
}

function arpeggioRows(): RowDraft[] {
  const rows: RowDraft[] = [];
  const add = (id: string, label: string, pattern: SemanticsPatternId, settings: ArpeggioSettings): void => {
    rows.push({ id, label: `${label} — ${patternLabel(pattern)}`, group: "arpeggio", pattern, chain: [one(arp(settings))] });
  };
  const walk = (mode: 0 | 1 | 2, octaves: number): string => `Arpeggio ${MODE_NAMES[mode]}, ${plural(octaves, "octave")}`;
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

const NON_IDENTITY: Record<SemanticsDevice, DeviceSetting> = {
  arpeggio: arp(ARPEGGIO_BASE),
  pitch: pitch({ ...PITCH_BASE, semiTones: 7, cents: 12.5 }),
  velocity: velocity({ ...VELOCITY_BASE, magnetPosition: 1, magnetStrength: 1 }),
  zeitgeist: zeitgeist({ amount: 0.75, duration: 480 }),
};

const ORDERS: readonly (readonly [SemanticsDevice, SemanticsDevice])[] = [
  ["arpeggio", "zeitgeist"], ["zeitgeist", "arpeggio"], ["pitch", "arpeggio"], ["arpeggio", "pitch"], ["velocity", "arpeggio"], ["arpeggio", "velocity"],
];

function orderRows(): RowDraft[] {
  return ORDERS.map(([first, second]) => ({
    id: `order-${first}-${second}`,
    label: `${FACTORY_KEYS[first]} then ${FACTORY_KEYS[second]} — chords`,
    group: "order", pattern: "chords", chain: [one(NON_IDENTITY[first]), one(NON_IDENTITY[second])],
  }));
}

function disabledRows(): RowDraft[] {
  return (["arpeggio", "pitch", "velocity", "zeitgeist"] as const).map((device) => ({
    id: `disabled-${device}`,
    label: `${FACTORY_KEYS[device]} switched off — sixteenths`,
    group: "disabled", pattern: "sixteenths", chain: [one(NON_IDENTITY[device], false)],
  }));
}

export const SEMANTICS_ROWS: readonly SemanticsRow[] = [
  ...dryRows(), ...arpeggioRows(), ...pitchRows(), ...velocityRows(), ...zeitgeistRows(), ...orderRows(), ...disabledRows(),
].map((row) => ({ ...row, quick: QUICK_IDS.has(row.id) || row.group === "order" || row.group === "disabled" }));

export interface RowParams { device: string | null; pattern: string | null; rows: string | null }

const DEVICE_FILTERS: readonly string[] = ["all", "arpeggio", "pitch", "velocity", "zeitgeist", "order", "disabled"];

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
