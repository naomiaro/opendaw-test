import { PPQN } from "@opendaw/lib-dsp";
import type { NanoSampleId } from "@/lib/nanoSamples";

/**
 * The LFO's synced rate when it is first switched on. Longer than the two-bar
 * pattern's bar, so the notes that fall on bar lines land on different points
 * of the cycle. Every synced rate of one bar or less repeats on each bar line
 * and would give those notes the same start every time.
 */
export const LFO_DEFAULT_RATE_LABEL = "4 bars";

/** Every pattern is two bars, so the note region and the timeline loop never change size */
export const PATTERN_LENGTH = 2 * PPQN.Bar;

export interface NanoParams {
  readonly rootKey: number;
  readonly octave: number;
  /** cents */
  readonly tune: number;
  /** dB */
  readonly volume: number;
  /** seconds */
  readonly attack: number;
  /** seconds */
  readonly release: number;
  readonly sampleStart: number;
  readonly sampleEnd: number;
  readonly loop: boolean;
  /** seconds */
  readonly loopFade: number;
  readonly loopStart: number;
  readonly loopEnd: number;
}

/**
 * The ranges the sampler's parameters map over, for reading. The authority is
 * each parameter's own mapping, which `applyParams` checks every value against.
 * Gain is the exception to "min..max": its curve reaches -72 dB and then
 * falls to silence at the very bottom.
 */
export const PARAM_RANGES: Readonly<Record<keyof Omit<NanoParams, "loop">, readonly [number, number]>> = {
  rootKey: [0, 127],
  octave: [-3, 3],
  tune: [-1200, 1200],
  volume: [-72, 0],
  attack: [0.001, 5],
  release: [0.001, 8],
  sampleStart: [0, 1],
  sampleEnd: [0, 1],
  loopFade: [0.001, 1],
  loopStart: [0, 1],
  loopEnd: [0, 1],
};

export interface NanoPatternNote {
  /** PPQN from the start of the pattern */
  readonly position: number;
  /** PPQN */
  readonly duration: number;
  readonly pitch: number;
  /** 0..1 */
  readonly velocity: number;
}

export interface NanoPreset {
  readonly params: NanoParams;
  readonly pattern: ReadonlyArray<NanoPatternNote>;
}

const BAR = PPQN.Bar;
const QUARTER = PPQN.Quarter;
const EIGHTH = QUARTER / 2;
const SIXTEENTH = QUARTER / 4;

const DEFAULTS: NanoParams = {
  rootKey: 60,
  octave: 0,
  tune: 0,
  volume: -6,
  attack: 0.003,
  release: 0.3,
  sampleStart: 0,
  sampleEnd: 1,
  loop: false,
  loopFade: 0.05,
  loopStart: 0,
  loopEnd: 1,
};

const held = (position: number, pitch: number, velocity = 0.8): NanoPatternNote => ({
  position,
  duration: BAR - SIXTEENTH,
  pitch,
  velocity,
});

const KICK_FIGURE = [60, 60, 72, 60, 48, 60, 67, 60];

export const NANO_PRESETS: Readonly<Record<NanoSampleId, NanoPreset>> = {
  pluck: {
    params: { ...DEFAULTS, rootKey: 57, release: 0.6, loop: true, loopStart: 0.25, loopEnd: 0.6, loopFade: 0.05 },
    pattern: [held(0, 57), held(BAR, 60)],
  },
  riser: {
    params: { ...DEFAULTS, rootKey: 60, release: 0.05, sampleStart: 1, sampleEnd: 0 },
    pattern: [
      { position: 0, duration: 2 * QUARTER, pitch: 60, velocity: 0.8 },
      { position: BAR, duration: 2 * QUARTER, pitch: 67, velocity: 0.8 },
    ],
  },
  pad: {
    params: {
      ...DEFAULTS, rootKey: 48, volume: -9, attack: 0.08, release: 0.8,
      loop: true, loopStart: 0.35, loopEnd: 0.85, loopFade: 0.2,
    },
    pattern: [held(0, 48, 0.7), held(0, 55, 0.7), held(0, 63, 0.7), held(BAR, 46, 0.7), held(BAR, 53, 0.7), held(BAR, 62, 0.7)],
  },
  kick: {
    params: { ...DEFAULTS, rootKey: 60, attack: 0.001, release: 0.1 },
    pattern: [0, 1].flatMap(bar =>
      KICK_FIGURE.map((pitch, step) => ({
        position: bar * BAR + step * EIGHTH,
        duration: SIXTEENTH,
        pitch,
        velocity: step % 2 === 0 ? 0.9 : 0.6,
      }))
    ),
  },
};

/** Applied to a dropped file: nothing is known about it, so everything is neutral */
export const CUSTOM_PRESET: NanoPreset = {
  params: DEFAULTS,
  pattern: [60, 64, 67, 72].map((pitch, index) => ({
    position: index * 2 * QUARTER,
    duration: 2 * QUARTER - SIXTEENTH,
    pitch,
    velocity: 0.8,
  })),
};
