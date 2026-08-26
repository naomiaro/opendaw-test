import type { CubedPatternData, CubedStep } from "@opendaw/studio-adapters";

/**
 * Hand-authored acid lines for the Cubed demo. Each preset carries the pattern
 * (note/gate/slide/accent per 16th step) plus the knob settings that make it
 * sound like the description — both are applied together on preset click.
 *
 * Note numbers follow the SDK's MidiKeys.toFullString octave convention
 * (60 = C3), the same convention CubedPatternData.parseNote reads.
 */

export interface CubedSoundParams {
  /** unit values (0..1) written via namedParameter.*.setUnitValue() */
  readonly cutoff: number;
  readonly resonance: number;
  readonly envMod: number;
  readonly decay: number;
  readonly accent: number;
  /** 0 = sawtooth, 1 = square (raw waveform field value) */
  readonly waveform: 0 | 1;
}

export interface CubedPreset {
  readonly name: string;
  readonly description: string;
  readonly pattern: CubedPatternData;
  readonly sound: CubedSoundParams;
}

/** Compact step literal: [note, active, slide, accent] */
type StepSpec = readonly [number, 0 | 1, 0 | 1, 0 | 1];

function steps(specs: ReadonlyArray<StepSpec>): ReadonlyArray<CubedStep> {
  return specs.map(([note, active, slide, accent]) => ({
    note,
    active: active === 1,
    slide: slide === 1,
    accent: accent === 1,
  }));
}

// A1 = 45, C2 = 48, D2 = 50, E2 = 52, G2 = 55, A2 = 57 in the 60=C3 convention.

export const CUBED_PRESETS: ReadonlyArray<CubedPreset> = [
  {
    name: "Acid Classic",
    description: "Off-beat accents, octave jumps, slides — high resonance, plenty of env mod.",
    pattern: {
      length: 16,
      steps: steps([
        [45, 1, 0, 1], // A1 accented downbeat
        [45, 1, 0, 0],
        [57, 1, 0, 0], // octave jump
        [45, 1, 1, 0], // slide into…
        [48, 1, 0, 0], // …C2
        [45, 1, 0, 1],
        [57, 1, 1, 0],
        [55, 1, 0, 0],
        [45, 1, 0, 1],
        [43, 1, 0, 0], // G1 passing tone
        [45, 1, 0, 0],
        [57, 1, 1, 1], // accented slide from the octave
        [52, 1, 0, 0],
        [48, 1, 0, 0],
        [47, 1, 1, 0],
        [45, 1, 0, 0],
      ]),
    },
    sound: { cutoff: 0.28, resonance: 0.8, envMod: 0.65, decay: 0.35, accent: 0.7, waveform: 0 },
  },
  {
    name: "Rubber Sub",
    description: "Sparse low line, slides on every second note, hardly any accents — cutoff low.",
    pattern: {
      length: 16,
      steps: steps([
        [38, 1, 0, 0], // D1
        [38, 0, 0, 0],
        [38, 1, 1, 0],
        [41, 1, 0, 0], // F1
        [38, 0, 0, 0],
        [38, 1, 0, 0],
        [45, 1, 1, 0], // A1 slides down
        [38, 1, 0, 0],
        [38, 0, 0, 0],
        [38, 1, 0, 1],
        [36, 1, 1, 0], // C1
        [38, 1, 0, 0],
        [38, 0, 0, 0],
        [43, 1, 1, 0], // G1
        [41, 1, 0, 0],
        [38, 0, 0, 0],
      ]),
    },
    sound: { cutoff: 0.16, resonance: 0.25, envMod: 0.3, decay: 0.55, accent: 0.3, waveform: 0 },
  },
  {
    name: "Squelch Lead",
    description: "Square wave, resonance near maximum, long decay — a chirpy top line.",
    pattern: {
      length: 16,
      steps: steps([
        [57, 1, 0, 1], // A2
        [60, 1, 0, 0], // C3
        [57, 1, 1, 0],
        [64, 1, 0, 1], // E3
        [57, 0, 0, 0],
        [62, 1, 0, 0], // D3
        [60, 1, 1, 0],
        [57, 1, 0, 0],
        [55, 1, 0, 1], // G2
        [57, 1, 0, 0],
        [60, 1, 1, 1],
        [64, 1, 0, 0],
        [62, 1, 0, 0],
        [60, 1, 0, 0],
        [57, 1, 1, 0],
        [55, 1, 0, 0],
      ]),
    },
    sound: { cutoff: 0.4, resonance: 0.95, envMod: 0.5, decay: 0.75, accent: 0.55, waveform: 1 },
  },
];
