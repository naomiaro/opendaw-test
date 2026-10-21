/**
 * The MIDI effect placement audit's rows: which device, which pattern, which rule, and the
 * constants every row shares (the burst, the thresholds, the tolerances with their mechanisms).
 * Page: `midi-effect-placement-audit-debug-demo.html`; register:
 * `debug/2026-10-21-midi-effect-placement/note.md`.
 */
import { PPQN } from "@opendaw/lib-dsp";
import { BAR_PPQN } from "./auditExpectations";

/** The burst: a full-scale step, then a linear fall to zero. Over within 20 ms, so each note has
 *  died before the next sixteenth at any tempo the page accepts. Not a single sample: the
 *  sampler's shortest attack would multiply a lone sample by the ramp's starting value. */
export const BURST_STEP_MS = 10;
export const BURST_FALL_MS = 10;
/** The sample the burst sits at the head of, the rest silence: the SDK's peaks stage fit returns no stage for a
 *  sample of 1200 frames or fewer and the peak worker then fails, so a 20 ms sample never loads. */
export const BURST_SAMPLE_SECONDS = 1;
/** First frame above this (of full scale) is a note's onset. */
export const ONSET_THRESHOLD = 0.05;
/** After an onset the reader steps this far before looking again: the burst's 20 ms plus a margin,
 *  short of the closest two expected onsets (the echo copies, 120 pulses = 62.5 ms at 120 bpm). */
export const ONSET_SKIP_MS = 30;
/** Cross-correlation search window for pass-through rows: 50 ms at 48 kHz. */
export const MAX_LAG_FRAMES = 2400;
/** Below this a correlation is not a lag reading but a different render. */
export const SCORE_FLOOR = 0.9;
/** One frame: the pulse-to-frame rounding of the expected position; the onset shape is the same
 *  for every note (same pitch, same attack), so the detector crosses at the same offset in each. */
export const RULE_TOLERANCE_FRAMES = 1;

export const NOTE_PITCH = 60;
/** The region starts at bar 1: nothing sounds in bar 0, so the render's start is clear of every onset. */
export const REGION_POSITION_PPQN = BAR_PPQN;
export const REGION_DURATION_PPQN = 2 * PPQN.Quarter;
export const SIXTEENTH_PPQN = PPQN.SemiQuaver;
export const THIRTY_SECOND_PPQN = PPQN.SemiQuaver / 2;

export const ARPEGGIO_RATE_INDEX = 9;
export const ARPEGGIO_RATE_PPQN = 240;
export const ZEITGEIST_AMOUNT = 0.6;
export const ZEITGEIST_DURATION_PPQN = 480;
export const ECHO_DELAY_PPQN = 120;
export const ECHO_REPEATS = 3;

export const RENDER_TAIL_SECONDS = 0.25;
export const NANO_ATTACK_SECONDS = 0.001;
export const NANO_RELEASE_SECONDS = 0.001;

export const MIDI_EFFECT_DEVICES = ["pitch", "velocity", "arpeggio", "zeitgeist", "spielwerk"] as const;
export type MidiEffectDevice = (typeof MIDI_EFFECT_DEVICES)[number];

export const MIDI_EFFECT_ROW_IDS = [
  "dry", "pitch", "velocity", "spielwerk-forward", "spielwerk-yield", "arpeggio", "zeitgeist", "spielwerk-echo",
  "pitch-disabled", "velocity-disabled", "arpeggio-disabled", "zeitgeist-disabled", "spielwerk-disabled",
] as const;
export type MidiEffectRowId = (typeof MIDI_EFFECT_ROW_IDS)[number];

/** A note in the region, region-local pulses; pitch and velocity are fixed (60, 1.0). */
export interface PatternNote {
  position: number;
  duration: number;
}

export interface MidiEffectScenario {
  id: MidiEffectRowId;
  label: string;
  device: MidiEffectDevice | null;
  enabled: boolean;
  /** Spielwerk user code (no header; the compiler prepends it). */
  script: string | null;
  pattern: readonly PatternNote[];
  judge: "pass-through" | "rule";
  rule: "arpeggio" | "zeitgeist" | "echo" | null;
}

/** Eight sixteenths on the grid of bar 1's first two beats, each held a thirty-second. */
export const DRY_PATTERN: readonly PatternNote[] = Array.from({ length: 8 }, (_, k) => ({
  position: k * SIXTEENTH_PPQN,
  duration: THIRTY_SECOND_PPQN,
}));
/** One note at beat 1, held two beats: the arpeggiator's source. */
export const HOLD_PATTERN: readonly PatternNote[] = [{ position: 0, duration: REGION_DURATION_PPQN }];
/** One note at beat 1, held a thirty-second: the echo script's source. */
export const ECHO_PATTERN: readonly PatternNote[] = [{ position: 0, duration: THIRTY_SECOND_PPQN }];

/** The generator yields nothing: the bridge forwards the input verbatim. */
export const SPIELWERK_FORWARD = `class Processor {
    * process(block, events) {
        for (const event of events) {}
    }
}
`;

/** \`// @no-pass\`, then every note-on yielded unchanged: the scheduler path. */
export const SPIELWERK_YIELD = `// @no-pass
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield { position: event.position, duration: event.duration, pitch: event.pitch, velocity: event.velocity, cent: event.cent }
            }
        }
    }
}
`;

/** The studio's echo example with its parameters fixed: delay ${ECHO_DELAY_PPQN}, ${ECHO_REPEATS} repeats, no decay.
 *  The original is forwarded; the copies are yielded. */
export const SPIELWERK_ECHO = `class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                for (let i = 1; i < ${ECHO_REPEATS}; i++) {
                    yield { position: event.position + i * ${ECHO_DELAY_PPQN}, duration: Math.min(event.duration, ${ECHO_DELAY_PPQN}), pitch: event.pitch, velocity: event.velocity, cent: event.cent }
                }
            }
        }
    }
}
`;

const passThrough = (id: MidiEffectRowId, label: string, device: MidiEffectDevice, enabled: boolean, script: string | null = null, pattern: readonly PatternNote[] = DRY_PATTERN): MidiEffectScenario =>
  ({ id, label, device, enabled, script, pattern, judge: "pass-through", rule: null });

export const MIDI_EFFECT_SCENARIOS: readonly MidiEffectScenario[] = [
  { id: "dry", label: "dry (no device)", device: null, enabled: true, script: null, pattern: DRY_PATTERN, judge: "pass-through", rule: null },
  passThrough("pitch", "Pitch (0 st, 0 ct, 0 oct)", "pitch", true),
  passThrough("velocity", "Velocity (factory: identity)", "velocity", true),
  passThrough("spielwerk-forward", "Spielwerk, forward (generator yields nothing)", "spielwerk", true, SPIELWERK_FORWARD),
  passThrough("spielwerk-yield", "Spielwerk, yield (@no-pass, every note re-yielded)", "spielwerk", true, SPIELWERK_YIELD),
  { id: "arpeggio", label: "Arpeggio (Up, 1 octave, 1/16, gate 1, repeat 1)", device: "arpeggio", enabled: true, script: null, pattern: HOLD_PATTERN, judge: "rule", rule: "arpeggio" },
  { id: "zeitgeist", label: `Zeitgeist (amount ${ZEITGEIST_AMOUNT}, duration ${ZEITGEIST_DURATION_PPQN})`, device: "zeitgeist", enabled: true, script: null, pattern: DRY_PATTERN, judge: "rule", rule: "zeitgeist" },
  { id: "spielwerk-echo", label: `Spielwerk, echo (delay ${ECHO_DELAY_PPQN}, ${ECHO_REPEATS} repeats)`, device: "spielwerk", enabled: true, script: SPIELWERK_ECHO, pattern: ECHO_PATTERN, judge: "rule", rule: "echo" },
  passThrough("pitch-disabled", "Pitch, disabled", "pitch", false),
  passThrough("velocity-disabled", "Velocity, disabled", "velocity", false),
  passThrough("arpeggio-disabled", "Arpeggio, disabled", "arpeggio", false),
  passThrough("zeitgeist-disabled", "Zeitgeist, disabled", "zeitgeist", false),
  // The echo script: a disabled forward script would be indistinguishable from an enabled one.
  passThrough("spielwerk-disabled", "Spielwerk, disabled (echo script)", "spielwerk", false, SPIELWERK_ECHO),
];

/** The rows `?device=` selects; the dry row is always first. */
export function resolveDevices(param: string | null): MidiEffectScenario[] {
  if (param === null || param === "all") return [...MIDI_EFFECT_SCENARIOS];
  if (!(MIDI_EFFECT_DEVICES as readonly string[]).includes(param)) {
    throw new Error(`unknown ?device= "${param}" — use all|${MIDI_EFFECT_DEVICES.join("|")}`);
  }
  return MIDI_EFFECT_SCENARIOS.filter((s) => s.device === null || s.device === param);
}

/** Bar 0 silent, bar 1 with the pattern, a quarter-second tail. */
export function renderSeconds(bpm: number): number {
  return PPQN.pulsesToSeconds(2 * BAR_PPQN, bpm) + RENDER_TAIL_SECONDS;
}

/** One channel of the burst at `rate`. */
export function burstChannel(rate: number): Float32Array {
  const step = Math.round((BURST_STEP_MS / 1000) * rate);
  const fall = Math.round((BURST_FALL_MS / 1000) * rate);
  const out = new Float32Array(step + fall);
  for (let i = 0; i < step; i++) out[i] = 1;
  for (let i = 0; i < fall; i++) out[step + i] = 1 - i / fall;
  return out;
}

/** The sample as loaded: the burst, then silence to `BURST_SAMPLE_SECONDS`. */
export function burstSample(rate: number): Float32Array {
  const out = new Float32Array(Math.round(BURST_SAMPLE_SECONDS * rate));
  out.set(burstChannel(rate));
  return out;
}

/** How many onsets the row's rule predicts. */
export function expectedOnsetCount(scenario: MidiEffectScenario): number {
  switch (scenario.rule) {
    case "arpeggio": return REGION_DURATION_PPQN / ARPEGGIO_RATE_PPQN;
    case "zeitgeist": return scenario.pattern.length;
    case "echo": return ECHO_REPEATS;
    case null: return scenario.pattern.length;
  }
}

export const RENDER_RATES = [44100, 48000] as const;
export type RenderRate = (typeof RENDER_RATES)[number];

/** `?rate=`: the render and live context rate; 48 kHz when absent. */
export function resolveRate(param: string | null): RenderRate {
  if (param === null) return 48000;
  const n = Number(param);
  if (!(RENDER_RATES as readonly number[]).includes(n)) throw new Error(`invalid ?rate= "${param}" — 44100 or 48000`);
  return n as RenderRate;
}

/** `?bpm=`: a positive tempo; 120 when absent. Capped where the echo copies (`ECHO_DELAY_PPQN` apart) would
 *  fall inside the onset skip and read as missing: 250 bpm. */
export function resolveBpm(param: string | null): number {
  if (param === null) return 120;
  const n = Number(param);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ?bpm= "${param}"`);
  if (PPQN.pulsesToSeconds(ECHO_DELAY_PPQN, n) * 1000 < ONSET_SKIP_MS) {
    throw new Error(`invalid ?bpm= "${param}": past ${Math.floor((ECHO_DELAY_PPQN * 60 * 1000) / (PPQN.Quarter * ONSET_SKIP_MS))} bpm the echo copies fall inside the ${ONSET_SKIP_MS} ms onset skip`);
  }
  return n;
}
