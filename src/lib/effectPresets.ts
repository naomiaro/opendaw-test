/**
 * Effect Presets for OpenDAW Effects Demo
 *
 * Professional presets for each effect type to demonstrate real-world usage
 * and help users understand how different parameter combinations sound.
 */

export interface EffectPreset<T> {
  name: string;
  description: string;
  params: T;
}

// ============================================================================
// REVERB PRESETS
// ============================================================================

export interface ReverbParams {
  wet: number;      // dB: -60 to 0
  decay: number;    // 0-1: decay time
  preDelay: number; // seconds: 0-0.1
  damp: number;     // 0-1: high frequency damping
}

export const REVERB_PRESETS: EffectPreset<ReverbParams>[] = [
  {
    name: "Small Room",
    description: "Tight, intimate space for vocals or instruments",
    params: { wet: -24, decay: 0.3, preDelay: 0.01, damp: 0.6 }
  },
  {
    name: "Medium Room",
    description: "Natural room ambience, good for most sources",
    params: { wet: -20, decay: 0.5, preDelay: 0.015, damp: 0.5 }
  },
  {
    name: "Large Hall",
    description: "Spacious concert hall with long decay",
    params: { wet: -12, decay: 0.85, preDelay: 0.03, damp: 0.4 }
  },
  {
    name: "Cathedral",
    description: "Massive space with very long, bright reverb",
    params: { wet: -15, decay: 0.95, preDelay: 0.05, damp: 0.2 }
  },
  {
    name: "Plate",
    description: "Classic plate reverb - smooth and musical",
    params: { wet: -18, decay: 0.7, preDelay: 0.02, damp: 0.5 }
  },
  {
    name: "Chamber",
    description: "Reflective chamber with moderate decay",
    params: { wet: -16, decay: 0.6, preDelay: 0.025, damp: 0.45 }
  },
  {
    name: "Vocal Booth",
    description: "Very small space for tight vocal sound",
    params: { wet: -30, decay: 0.2, preDelay: 0.005, damp: 0.7 }
  },
  {
    name: "Ambient Wash",
    description: "Heavy reverb for dreamy, atmospheric sound",
    params: { wet: -8, decay: 0.9, preDelay: 0.04, damp: 0.3 }
  }
];

// ============================================================================
// COMPRESSOR PRESETS
// ============================================================================

export interface CompressorParams {
  threshold: number; // dB: -60 to 0
  ratio: number;     // 1-20:1
  attack: number;    // ms: 0.1-100
  release: number;   // ms: 10-1000
  knee: number;      // dB: 0-12
}

export const COMPRESSOR_PRESETS: EffectPreset<CompressorParams>[] = [
  {
    name: "Vocal Smooth",
    description: "Gentle compression for consistent vocal levels",
    params: { threshold: -24, ratio: 3, attack: 5, release: 100, knee: 6 }
  },
  {
    name: "Vocal Aggressive",
    description: "Heavy compression for upfront, modern vocals",
    params: { threshold: -18, ratio: 6, attack: 1, release: 50, knee: 3 }
  },
  {
    name: "Drum Punch",
    description: "Fast attack to catch transients, adds punch",
    params: { threshold: -15, ratio: 4, attack: 0.5, release: 80, knee: 2 }
  },
  {
    name: "Bass Tight",
    description: "Controls low-end and adds sustain",
    params: { threshold: -20, ratio: 5, attack: 3, release: 120, knee: 4 }
  },
  {
    name: "Mix Glue",
    description: "Subtle compression to gel the mix together",
    params: { threshold: -12, ratio: 2, attack: 10, release: 150, knee: 6 }
  },
  {
    name: "Limiting",
    description: "Brick wall limiting to prevent clipping",
    params: { threshold: -6, ratio: 20, attack: 0.1, release: 30, knee: 0 }
  },
  {
    name: "Gentle Touch",
    description: "Very mild compression for transparency",
    params: { threshold: -30, ratio: 1.5, attack: 15, release: 200, knee: 8 }
  },
  {
    name: "Pumping",
    description: "Obvious compression with slow attack for rhythmic effect",
    params: { threshold: -18, ratio: 8, attack: 30, release: 60, knee: 2 }
  }
];

// ============================================================================
// DELAY PRESETS
// ============================================================================

export interface DelayParams {
  wet: number;      // dB: -60 to 0
  feedback: number; // 0-0.9: amount of feedback
  delay: number;    // 0-16: delay time indices (note fractions)
  filter: number;   // -1 to 1: filter amount (negative=LP, positive=HP)
}

export const DELAY_PRESETS: EffectPreset<DelayParams>[] = [
  {
    name: "Slap Back",
    description: "Classic 50s-style short delay for vocals",
    params: { wet: -18, feedback: 0.1, delay: 2, filter: 0.4 }
  },
  {
    name: "Quarter Note",
    description: "Rhythmic delay synced to tempo",
    params: { wet: -12, feedback: 0.4, delay: 4, filter: 0.3 }
  },
  {
    name: "Dotted Eighth",
    description: "U2-style delay (3/16 notes)",
    params: { wet: -10, feedback: 0.45, delay: 6, filter: 0.35 }
  },
  {
    name: "Ping Pong",
    description: "Bouncing delay with moderate feedback",
    params: { wet: -14, feedback: 0.5, delay: 4, filter: 0.25 }
  },
  {
    name: "Ambient Wash",
    description: "Long, filtered delay for atmospheric sound",
    params: { wet: -8, feedback: 0.65, delay: 8, filter: 0.6 }
  },
  {
    name: "Dub Echo",
    description: "Heavy feedback with dark tone",
    params: { wet: -6, feedback: 0.7, delay: 6, filter: 0.7 }
  },
  {
    name: "Subtle Double",
    description: "Very short delay for thickening sound",
    params: { wet: -24, feedback: 0, delay: 1, filter: 0.2 }
  },
  {
    name: "Tape Echo",
    description: "Vintage tape echo simulation",
    params: { wet: -15, feedback: 0.5, delay: 5, filter: 0.5 }
  }
];

// ============================================================================
// CRUSHER (LO-FI) PRESETS
// ============================================================================

export interface CrusherParams {
  bits: number;   // 1-16: bit depth reduction
  crush: number;  // 0-1: sample rate reduction
  boost: number;  // 0-1: compensatory gain
  mix: number;    // 0-1: dry/wet mix
}

export const CRUSHER_PRESETS: EffectPreset<CrusherParams>[] = [
  {
    name: "Subtle Lo-Fi",
    description: "Gentle vintage character without being obvious",
    params: { bits: 12, crush: 0.85, boost: 0.3, mix: 0.5 }
  },
  {
    name: "AM Radio",
    description: "Old radio or telephone sound",
    params: { bits: 8, crush: 0.7, boost: 0.5, mix: 0.9 }
  },
  {
    name: "8-bit Game",
    description: "Retro video game sound",
    params: { bits: 4, crush: 0.6, boost: 0.6, mix: 1.0 }
  },
  {
    name: "Destroyed",
    description: "Extreme bit crushing and distortion",
    params: { bits: 2, crush: 0.4, boost: 0.8, mix: 1.0 }
  },
  {
    name: "Vinyl Warmth",
    description: "Subtle degradation for analog warmth",
    params: { bits: 14, crush: 0.95, boost: 0.2, mix: 0.3 }
  },
  {
    name: "Grungy",
    description: "Heavy distortion with character",
    params: { bits: 6, crush: 0.75, boost: 0.7, mix: 0.85 }
  },
  {
    name: "Glitch",
    description: "Digital artifacts and glitches",
    params: { bits: 3, crush: 0.5, boost: 0.65, mix: 0.9 }
  },
  {
    name: "Tape Saturation",
    description: "Warm tape-like saturation",
    params: { bits: 13, crush: 0.9, boost: 0.4, mix: 0.6 }
  }
];

// ============================================================================
// STEREO WIDTH PRESETS
// ============================================================================

export interface StereoWidthParams {
  width: number; // 0-1: stereo width (0.5 = normal, 1 = wide)
  pan: number;   // -1 to 1: pan position
}

export const STEREO_WIDTH_PRESETS: EffectPreset<StereoWidthParams>[] = [
  {
    name: "Narrow (Mono)",
    description: "Collapses to mono for compatibility",
    params: { width: 0, pan: 0 }
  },
  {
    name: "Natural",
    description: "Standard stereo width",
    params: { width: 0.5, pan: 0 }
  },
  {
    name: "Wide",
    description: "Enhanced stereo width for spaciousness",
    params: { width: 0.8, pan: 0 }
  },
  {
    name: "Extra Wide",
    description: "Maximum stereo width (can cause phase issues)",
    params: { width: 1.0, pan: 0 }
  },
  {
    name: "Pan Left",
    description: "Panned to left side",
    params: { width: 0.5, pan: -0.7 }
  },
  {
    name: "Pan Right",
    description: "Panned to right side",
    params: { width: 0.5, pan: 0.7 }
  },
  {
    name: "Wide Left",
    description: "Wide stereo, biased left",
    params: { width: 0.8, pan: -0.3 }
  },
  {
    name: "Wide Right",
    description: "Wide stereo, biased right",
    params: { width: 0.8, pan: 0.3 }
  }
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get all presets for a specific effect type
 */
export function getPresetsForEffect(effectType: string) {
  switch (effectType.toLowerCase()) {
    case 'reverb':
      return REVERB_PRESETS;
    case 'compressor':
      return COMPRESSOR_PRESETS;
    case 'delay':
      return DELAY_PRESETS;
    case 'crusher':
      return CRUSHER_PRESETS;
    case 'stereowidth':
      return STEREO_WIDTH_PRESETS;
    default:
      return [];
  }
}

/**
 * Find a preset by name
 */
export function findPreset<T>(presets: EffectPreset<T>[], name: string): EffectPreset<T> | undefined {
  return presets.find(p => p.name === name);
}
