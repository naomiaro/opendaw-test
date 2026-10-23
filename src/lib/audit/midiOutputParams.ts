/**
 * The MIDI output timing audit's parameters (`midi-output-timing-audit-debug-demo.html?…`), parsed
 * once per page load, and the MIDI status classification its receipt listener uses. Every refusal
 * names the parameter and the value, and happens before any setup.
 */
import { MIDI_AUDIT_BPMS, MIDI_BUS_DEFAULT } from "./midiInputCalibration";

export type OutputArm = "page" | "engine";
export type Density = "32nd" | "8th" | "both";
export type JankMode = "none" | "mid";

export interface MidiOutputParams {
  /** `["page", "engine"]` for both; the page arm runs first in each repeat. */
  arms: readonly OutputArm[];
  /** `all` is the input sweep's three tempi; else one tempo, 60–220. */
  bpms: readonly number[];
  /** `both` is ONE density (two bars of eighths, then one bar of 1/32), not two cells. */
  densities: readonly Density[];
  /** 1–8; ignored by density `both`. */
  bars: number;
  repeats: number;
  /** `MIDIOutputBox.delayInMs` written for the run, 0–500; the schema default is the default. */
  delayInMs: number;
  /** `&jank=none|mid|both` → one or two tuples (jank is part of the cell key). */
  janks: readonly JankMode[];
  jankMs: number;
  /** `&transport=1|0|both`; default on, the schema's and the studio's default. */
  transports: readonly boolean[];
  /** The bar the pattern starts on, 2–8 (bar 2 = one bar in): the anchor reaches the page after position 0 has passed, so bar 1 can never be scheduled ahead. */
  originBar: number;
  bus: string;
}

const ARMS: readonly OutputArm[] = ["page", "engine"];
const DENSITIES: readonly Density[] = ["32nd", "8th", "both"];

function refuse(name: string, value: string, expected: string): never {
  throw new Error(`&${name}=${value}: expected ${expected}`);
}

function integer(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) refuse(name, raw, `an integer ${min}–${max}`);
  return value;
}

function oneOf<T extends string>(params: URLSearchParams, name: string, fallback: T, allowed: readonly T[]): T {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) refuse(name, raw, allowed.join("|"));
  return raw as T;
}

export function parseMidiOutputParams(params: URLSearchParams): MidiOutputParams {
  const arm = oneOf<OutputArm | "both">(params, "arm", "both", ["both", ...ARMS]);
  const bpmRaw = params.get("bpm");
  const bpms: number[] = bpmRaw === null ? [140] : bpmRaw === "all" ? [...MIDI_AUDIT_BPMS] : [integer(params, "bpm", 140, 60, 220)];
  const density = oneOf<Density>(params, "density", "32nd", DENSITIES);
  const jank = oneOf<JankMode | "both">(params, "jank", "none", ["none", "mid", "both"]);
  const transport = oneOf<"1" | "0" | "both">(params, "transport", "1", ["1", "0", "both"]);
  return {
    arms: arm === "both" ? [...ARMS] : [arm],
    bpms,
    densities: [density],
    bars: integer(params, "bars", 3, 1, 8),
    repeats: integer(params, "repeats", 2, 1, 10),
    delayInMs: integer(params, "delay", 10, 0, 500),
    janks: jank === "both" ? ["none", "mid"] : [jank],
    jankMs: integer(params, "jankMs", 80, 10, 500),
    transports: transport === "both" ? [true, false] : [transport === "1"],
    originBar: integer(params, "origin", 2, 2, 8),
    bus: params.get("bus") ?? MIDI_BUS_DEFAULT,
  };
}

export type MidiStatusKind = "note-on" | "note-off" | "transport" | "other";

/** Status byte → kind. A note-on with velocity 0 is still `note-on` here; the receipt builder reads it as a release. */
export function classifyMidiStatus(status: number): MidiStatusKind {
  const command = status & 0xf0;
  if (command === 0x90) return "note-on";
  if (command === 0x80) return "note-off";
  if (status === 0xf8 || status === 0xfa || status === 0xfc || status === 0xf2) return "transport";
  return "other";
}

/**
 * What a repeat needs beyond its transport time: the sum of the runner's own deadlines (reset 10 s, position settle
 * 30 s, anchor 30 s, stop 10 s) plus a margin, so the outer deadline never pre-empts a stage-named error row.
 */
export const REPEAT_SLACK_MS = 10_000 + 30_000 + 30_000 + 10_000 + 10_000;
/** Density `both` is the input page's shape: two bars of eighths and one of 1/32, whatever `bars` says. */
const BOTH_DENSITY_BARS = 3;

/** The outer deadline of one repeat: the bars before the origin, the pattern, the trailing bar, plus the slack. Derived, so no allowed cell is cut off. */
export function repeatDeadlineMs({ bpm, density, bars, originBar }: { bpm: number; density: Density; bars: number; originBar: number }): number {
  const patternBars = density === "both" ? BOTH_DENSITY_BARS : bars;
  const transportBars = originBar - 1 + patternBars + 1;
  return transportBars * (4 * 60_000 / bpm) + REPEAT_SLACK_MS;
}

