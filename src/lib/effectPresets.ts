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
  wet: number; // dB: -60 to 0
  decay: number; // 0-1: decay time
  preDelay: number; // seconds: 0-0.1
  damp: number; // 0-1: high frequency damping
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
  ratio: number; // 1-20:1
  attack: number; // ms: 0.1-100
  release: number; // ms: 10-1000
  knee: number; // dB: 0-12
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
  wet: number; // dB: -60 to 0
  feedback: number; // 0-0.9: amount of feedback
  delayMusical: number; // 0-16: delay time indices (note fractions)
  filter: number; // -1 to 1: filter amount (negative=LP, positive=HP)
}

export const DELAY_PRESETS: EffectPreset<DelayParams>[] = [
  {
    name: "Slap Back",
    description: "Classic 50s-style short delay for vocals",
    params: { wet: -18, feedback: 0.1, delayMusical: 2, filter: 0.4 }
  },
  {
    name: "Quarter Note",
    description: "Rhythmic delay synced to tempo",
    params: { wet: -12, feedback: 0.4, delayMusical: 4, filter: 0.3 }
  },
  {
    name: "Dotted Eighth",
    description: "U2-style delay (3/16 notes)",
    params: { wet: -10, feedback: 0.45, delayMusical: 6, filter: 0.35 }
  },
  {
    name: "Ping Pong",
    description: "Bouncing delay with moderate feedback",
    params: { wet: -14, feedback: 0.5, delayMusical: 4, filter: 0.25 }
  },
  {
    name: "Ambient Wash",
    description: "Long, filtered delay for atmospheric sound",
    params: { wet: -8, feedback: 0.65, delayMusical: 8, filter: 0.6 }
  },
  {
    name: "Dub Echo",
    description: "Heavy feedback with dark tone",
    params: { wet: -6, feedback: 0.7, delayMusical: 6, filter: 0.7 }
  },
  {
    name: "Subtle Double",
    description: "Very short delay for thickening sound",
    params: { wet: -24, feedback: 0, delayMusical: 1, filter: 0.2 }
  },
  {
    name: "Tape Echo",
    description: "Vintage tape echo simulation",
    params: { wet: -15, feedback: 0.5, delayMusical: 5, filter: 0.5 }
  }
];

// ============================================================================
// CRUSHER (LO-FI) PRESETS
// ============================================================================

export interface CrusherParams {
  bits: number; // 1-16: bit depth reduction
  crush: number; // 0-1: sample rate reduction (0 = clean, 1 = max crush)
  boost: number; // 0-24 dB: pre-emphasis gain (NOT 0-1!)
  mix: number; // 0-1: dry/wet mix
}

export const CRUSHER_PRESETS: EffectPreset<CrusherParams>[] = [
  {
    name: "Subtle Lo-Fi",
    description: "Gentle vintage character without being obvious",
    params: { bits: 14, crush: 0.85, boost: 0, mix: 0.4 } // Processor inverts crush internally!
  },
  {
    name: "AM Radio",
    description: "Old radio or telephone sound",
    params: { bits: 10, crush: 0.7, boost: 0, mix: 0.7 }
  },
  {
    name: "8-bit Game",
    description: "Retro video game sound",
    params: { bits: 6, crush: 0.55, boost: 0, mix: 0.85 }
  },
  {
    name: "Destroyed",
    description: "Extreme bit crushing and distortion",
    params: { bits: 5, crush: 0.4, boost: 0, mix: 1.0 } // 5 bits min for audibility
  },
  {
    name: "Vinyl Warmth",
    description: "Subtle degradation for analog warmth",
    params: { bits: 15, crush: 0.92, boost: 0, mix: 0.25 }
  },
  {
    name: "Grungy",
    description: "Heavy distortion with character",
    params: { bits: 8, crush: 0.6, boost: 0, mix: 0.8 }
  },
  {
    name: "Glitch",
    description: "Digital artifacts and glitches",
    params: { bits: 5, crush: 0.45, boost: 0, mix: 0.9 }
  },
  {
    name: "Tape Saturation",
    description: "Warm tape-like saturation",
    params: { bits: 13, crush: 0.88, boost: 0, mix: 0.5 }
  }
];

// ============================================================================
// STEREO WIDTH PRESETS
// ============================================================================

export interface StereoWidthParams {
  width: number; // 0-1: stereo width (0.5 = normal, 1 = wide)
  pan: number; // -1 to 1: pan position
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
// EQ PRESETS (3-Band Parametric EQ)
// ============================================================================

export interface EQParams {
  lowGain: number; // dB: -24 to 24 (250 Hz)
  midGain: number; // dB: -24 to 24 (1 kHz)
  highGain: number; // dB: -24 to 24 (4 kHz)
}

export const EQ_PRESETS: EffectPreset<EQParams>[] = [
  {
    name: "Vocal Presence",
    description: "Enhance vocal clarity and presence",
    params: { lowGain: -2, midGain: 4, highGain: 3 }
  },
  {
    name: "Bass Boost",
    description: "Add weight and warmth to low end",
    params: { lowGain: 6, midGain: 0, highGain: -1 }
  },
  {
    name: "Bright & Airy",
    description: "Lift highs for sparkle and air",
    params: { lowGain: -3, midGain: 2, highGain: 5 }
  },
  {
    name: "Warm & Full",
    description: "Rich, warm sound with body",
    params: { lowGain: 4, midGain: 2, highGain: -2 }
  },
  {
    name: "Smiley Face",
    description: "Boost lows and highs, scoop mids",
    params: { lowGain: 5, midGain: -4, highGain: 5 }
  },
  {
    name: "Telephone",
    description: "Narrow midrange band",
    params: { lowGain: -12, midGain: 6, highGain: -10 }
  },
  {
    name: "De-Muddy",
    description: "Reduce muddiness in mids",
    params: { lowGain: 0, midGain: -6, highGain: 2 }
  },
  {
    name: "Radio Voice",
    description: "Classic radio announcer sound",
    params: { lowGain: -4, midGain: 8, highGain: 1 }
  }
];

// ============================================================================
// WAVEFOLDER PRESETS
// ============================================================================

export interface FoldParams {
  drive: number; // dB: 0 to 40 (input drive)
  volume: number; // dB: -40 to 20 (output level)
}

export const FOLD_PRESETS: EffectPreset<FoldParams>[] = [
  {
    name: "Subtle Warmth",
    description: "Gentle saturation and harmonics",
    params: { drive: 8, volume: -2 }
  },
  {
    name: "Soft Clip",
    description: "Smooth overdrive character",
    params: { drive: 15, volume: -4 }
  },
  {
    name: "Aggressive",
    description: "Heavy distortion with bite",
    params: { drive: 25, volume: -6 }
  },
  {
    name: "Extreme Fold",
    description: "Maximum folding and harmonics",
    params: { drive: 35, volume: -8 }
  },
  {
    name: "Tube Amp",
    description: "Warm tube amplifier simulation",
    params: { drive: 12, volume: -3 }
  },
  {
    name: "Fuzz",
    description: "Classic fuzz pedal sound",
    params: { drive: 30, volume: -7 }
  },
  {
    name: "Crunch",
    description: "Crunchy guitar amp overdrive",
    params: { drive: 18, volume: -4 }
  },
  {
    name: "Clean Boost",
    description: "Transparent boost with character",
    params: { drive: 6, volume: 2 }
  }
];

// ============================================================================
// DATTORRO REVERB PRESETS
// ============================================================================

export interface DattorroReverbParams {
  preDelay: number; // seconds: 0-0.1
  bandwidth: number; // 0-1: input bandwidth
  decay: number; // 0-1: decay time
  damping: number; // 0-1: high frequency damping
  excursionRate: number; // 0-1: modulation rate
  excursionDepth: number; // 0-1: modulation depth
  wet: number; // dB: -60 to 0
  dry: number; // dB: -60 to 0
}

export const DATTORRO_REVERB_PRESETS: EffectPreset<DattorroReverbParams>[] = [
  {
    name: "Small Space",
    description: "Intimate room with subtle modulation",
    params: { preDelay: 0.01, bandwidth: 0.95, decay: 0.3, damping: 0.6, excursionRate: 0.3, excursionDepth: 0.3, wet: -18, dry: 0 }
  },
  {
    name: "Medium Hall",
    description: "Balanced hall reverb for most uses",
    params: { preDelay: 0.02, bandwidth: 0.9, decay: 0.5, damping: 0.5, excursionRate: 0.5, excursionDepth: 0.5, wet: -12, dry: 0 }
  },
  {
    name: "Large Hall",
    description: "Spacious concert hall with long decay",
    params: { preDelay: 0.03, bandwidth: 0.85, decay: 0.75, damping: 0.4, excursionRate: 0.4, excursionDepth: 0.6, wet: -10, dry: 0 }
  },
  {
    name: "Cathedral",
    description: "Massive space with very long, bright reverb",
    params: { preDelay: 0.05, bandwidth: 0.8, decay: 0.9, damping: 0.25, excursionRate: 0.3, excursionDepth: 0.7, wet: -8, dry: 0 }
  },
  {
    name: "Shimmer",
    description: "Ethereal reverb with heavy modulation",
    params: { preDelay: 0.04, bandwidth: 0.7, decay: 0.85, damping: 0.3, excursionRate: 0.8, excursionDepth: 0.9, wet: -6, dry: 0 }
  },
  {
    name: "Dark Ambient",
    description: "Moody, heavily damped reverb",
    params: { preDelay: 0.03, bandwidth: 0.6, decay: 0.7, damping: 0.8, excursionRate: 0.2, excursionDepth: 0.4, wet: -10, dry: 0 }
  },
  {
    name: "Bright Plate",
    description: "Crisp plate-like reverb",
    params: { preDelay: 0.015, bandwidth: 0.98, decay: 0.6, damping: 0.2, excursionRate: 0.6, excursionDepth: 0.5, wet: -14, dry: 0 }
  },
  {
    name: "Infinite",
    description: "Near-infinite decay for drones",
    params: { preDelay: 0.02, bandwidth: 0.85, decay: 0.98, damping: 0.35, excursionRate: 0.4, excursionDepth: 0.6, wet: -6, dry: -12 }
  }
];

// ============================================================================
// TIDAL (LFO) PRESETS
// ============================================================================

export interface TidalParams {
  slope: number; // 0-1: waveform slope
  symmetry: number; // 0-1: waveform symmetry
  rate: number; // Hz: LFO rate
  depth: number; // 0-1: modulation depth
  offset: number; // 0-1: phase offset
  channelOffset: number; // 0-1: stereo phase offset
}

export const TIDAL_PRESETS: EffectPreset<TidalParams>[] = [
  {
    name: "Subtle Tremolo",
    description: "Gentle volume modulation",
    params: { slope: 0.5, symmetry: 0.5, rate: 4, depth: 0.2, offset: 0, channelOffset: 0 }
  },
  {
    name: "Classic Tremolo",
    description: "Standard tremolo effect",
    params: { slope: 0.5, symmetry: 0.5, rate: 6, depth: 0.5, offset: 0, channelOffset: 0 }
  },
  {
    name: "Deep Tremolo",
    description: "Heavy, dramatic tremolo",
    params: { slope: 0.5, symmetry: 0.5, rate: 5, depth: 0.8, offset: 0, channelOffset: 0 }
  },
  {
    name: "Auto-Pan",
    description: "Stereo panning effect",
    params: { slope: 0.5, symmetry: 0.5, rate: 0.5, depth: 0.7, offset: 0, channelOffset: 0.5 }
  },
  {
    name: "Fast Pan",
    description: "Quick stereo movement",
    params: { slope: 0.5, symmetry: 0.5, rate: 3, depth: 0.6, offset: 0, channelOffset: 0.5 }
  },
  {
    name: "Square Wave",
    description: "Choppy on/off modulation",
    params: { slope: 1, symmetry: 0.5, rate: 4, depth: 0.7, offset: 0, channelOffset: 0 }
  },
  {
    name: "Sawtooth",
    description: "Ramping modulation",
    params: { slope: 0, symmetry: 1, rate: 2, depth: 0.5, offset: 0, channelOffset: 0 }
  },
  {
    name: "Slow Drift",
    description: "Very slow, subtle movement",
    params: { slope: 0.5, symmetry: 0.5, rate: 0.1, depth: 0.3, offset: 0, channelOffset: 0.25 }
  }
];

// ============================================================================
// MAXIMIZER PRESETS
// ============================================================================

export interface MaximizerParams {
  threshold: number; // dB: -30 to 0
}

export const MAXIMIZER_PRESETS: EffectPreset<MaximizerParams>[] = [
  {
    name: "Subtle Limiting",
    description: "Gentle peak limiting",
    params: { threshold: -1 }
  },
  {
    name: "Light Squeeze",
    description: "Moderate loudness boost",
    params: { threshold: -3 }
  },
  {
    name: "Radio Ready",
    description: "Competitive loudness for broadcast",
    params: { threshold: -6 }
  },
  {
    name: "Heavy Limiting",
    description: "Strong limiting for maximum loudness",
    params: { threshold: -9 }
  },
  {
    name: "Crushed",
    description: "Extreme limiting, pumping may occur",
    params: { threshold: -12 }
  },
  {
    name: "Brick Wall",
    description: "Maximum limiting, -15dB threshold",
    params: { threshold: -15 }
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
    case "reverb":
      return REVERB_PRESETS;
    case "compressor":
      return COMPRESSOR_PRESETS;
    case "delay":
      return DELAY_PRESETS;
    case "crusher":
      return CRUSHER_PRESETS;
    case "stereowidth":
      return STEREO_WIDTH_PRESETS;
    case "eq":
      return EQ_PRESETS;
    case "fold":
      return FOLD_PRESETS;
    case "dattorroreverb":
      return DATTORRO_REVERB_PRESETS;
    case "tidal":
      return TIDAL_PRESETS;
    case "maximizer":
      return MAXIMIZER_PRESETS;
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
