import { CzEnvelope, CzTone } from "@opendaw/studio-adapters";

export type NeonPresetDef = { name: string; description: string; tone: CzTone };

const env = (
  rates: number[], levels: number[], sustain: number, end: number,
): CzEnvelope => ({
  rates: [...rates, ...Array(8 - rates.length).fill(0)],
  levels: [...levels, ...Array(8 - levels.length).fill(0)],
  sustain, end,
});

// Flat pitch envelope shared by patches that don't bend.
const FLAT_PITCH = env([99], [0], 0, 1);

// Wave indices (Neon.Waves): 0 Saw, 1 Square, 2 Pulse, 3 Double Sine, 4 Saw-Pulse,
// 5 Resonance Saw, 6 Resonance Triangle, 7 Resonance Trapezoid. wave2: 0 = Off, 1-8 = wave+1.
// modulation: 0 Off, 1 Ring, 2 Noise. vibratoWave: 0 Triangle, 1 Saw Up, 2 Saw Down, 3 Square.

export const NEON_PRESETS: ReadonlyArray<NeonPresetDef> = [
  {
    name: "PD Bass",
    description: "Punchy phase-distortion bass — fast DCW sweep, tight decay",
    tone: {
      lineSelect: 0, modulation: 0, octave: -1, detuneNote: 0, detuneFine: 0,
      vibratoWave: 0, vibratoDelay: 0, vibratoRate: 0, vibratoDepth: 0,
      lines: [
        {
          wave1: 0, wave2: 2, dcwKeyFollow: 2, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 45], [99, 20], 2, 3),
          dcaEnv: env([99, 60], [99, 0], 0, 2),
        },
        {
          wave1: 0, wave2: 0, dcwKeyFollow: 0, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH, dcwEnv: env([99], [50], 1, 2), dcaEnv: env([99], [99], 1, 2),
        },
      ],
    },
  },
  {
    name: "Glass Bell",
    description: "Ring-modulated bell — detuned second line, long DCA release",
    tone: {
      lineSelect: 3, modulation: 1, octave: 0, detuneNote: 7, detuneFine: 4,
      vibratoWave: 0, vibratoDelay: 0, vibratoRate: 0, vibratoDepth: 0,
      lines: [
        {
          wave1: 3, wave2: 0, dcwKeyFollow: 4, dcaKeyFollow: 3,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 30], [90, 10], 0, 2),
          dcaEnv: env([99, 25], [99, 0], 0, 2),
        },
        {
          wave1: 1, wave2: 0, dcwKeyFollow: 5, dcaKeyFollow: 3,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 22], [80, 0], 0, 2),
          dcaEnv: env([99, 20], [99, 0], 0, 2),
        },
      ],
    },
  },
  {
    name: "Hollow Pad",
    description: "Slow square pad — gentle DCW bloom, both lines, slow release",
    tone: {
      lineSelect: 2, modulation: 0, octave: 0, detuneNote: 0, detuneFine: 12,
      vibratoWave: 0, vibratoDelay: 40, vibratoRate: 30, vibratoDepth: 12,
      lines: [
        {
          wave1: 1, wave2: 0, dcwKeyFollow: 1, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([28, 18], [70, 45], 2, 3),
          dcaEnv: env([35, 30, 18], [99, 90, 0], 2, 3),
        },
        {
          wave1: 1, wave2: 0, dcwKeyFollow: 1, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([25, 15], [60, 40], 2, 3),
          dcaEnv: env([30, 28, 16], [99, 88, 0], 2, 3),
        },
      ],
    },
  },
  {
    name: "Rez Brass",
    description: "Resonance-saw brass — DCW attack blip, key-followed brightness",
    tone: {
      lineSelect: 0, modulation: 0, octave: 0, detuneNote: 0, detuneFine: 0,
      vibratoWave: 0, vibratoDelay: 55, vibratoRate: 45, vibratoDepth: 10,
      lines: [
        {
          wave1: 5, wave2: 1, dcwKeyFollow: 6, dcaKeyFollow: 2,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([70, 40, 50], [99, 55, 70], 3, 4),
          dcaEnv: env([85, 50], [99, 85], 2, 3),
        },
        {
          wave1: 0, wave2: 0, dcwKeyFollow: 0, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH, dcwEnv: env([99], [50], 1, 2), dcaEnv: env([99], [99], 1, 2),
        },
      ],
    },
  },
  {
    name: "Noise Perc",
    description: "Noise-modulated percussive hit — instant attack, no sustain",
    tone: {
      lineSelect: 3, modulation: 2, octave: 1, detuneNote: 0, detuneFine: 0,
      vibratoWave: 0, vibratoDelay: 0, vibratoRate: 0, vibratoDepth: 0,
      lines: [
        {
          wave1: 2, wave2: 0, dcwKeyFollow: 7, dcaKeyFollow: 5,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 70], [99, 0], 0, 2),
          dcaEnv: env([99, 75], [99, 0], 0, 2),
        },
        {
          wave1: 7, wave2: 0, dcwKeyFollow: 7, dcaKeyFollow: 5,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 72], [90, 0], 0, 2),
          dcaEnv: env([99, 78], [99, 0], 0, 2),
        },
      ],
    },
  },
];
