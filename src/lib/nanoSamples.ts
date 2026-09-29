/**
 * Procedurally synthesized samples for the Nano sampler demo.
 *
 * Pure DSP on Float32Arrays: deterministic (seeded PRNG), renderable at any
 * sample rate, unit-testable in Node. Each sample exists to show one feature
 * of the sampler. Convert to an AudioBuffer with `channelsToAudioBuffer` from
 * `impulseResponses.ts`.
 */
import { mulberry32 } from "./impulseResponses";

/** The gallery's samples. Presets are keyed by this, so a sample without a preset does not compile. */
export type NanoSampleId = "pluck" | "riser" | "pad" | "kick";

export interface NanoSampleSpec {
  /** Stable slug: keys presets, the per-page-load uuid table and React keys */
  readonly id: NanoSampleId;
  readonly name: string;
  readonly description: string;
  /** Rendered duration in seconds */
  readonly seconds: number;
  /** MIDI note at which the sample plays at its native rate (note 69 is 440 Hz) */
  readonly rootKey: number;
  /** Fundamental in Hz for a pitched sample, null for an unpitched one */
  readonly fundamentalHz: number | null;
  readonly render: (sampleRate: number) => [Float32Array, Float32Array];
}

const PEAK = 0.9;
const TWO_PI = 2 * Math.PI;

const noteToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/** Scale both channels by one factor so the louder one peaks at PEAK */
function normalizeJointly(channels: [Float32Array, Float32Array]): [Float32Array, Float32Array] {
  let max = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) max = Math.max(max, Math.abs(channel[i]));
  }
  if (max === 0) return channels;
  const scale = PEAK / max;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) channel[i] *= scale;
  }
  return channels;
}

/** Raised-cosine fades at both ends, so neither direction of playback starts on a step */
function fadeEdges(samples: Float32Array, sampleRate: number, inSeconds: number, outSeconds: number): void {
  const fadeIn = Math.min(samples.length, Math.round(inSeconds * sampleRate));
  const fadeOut = Math.min(samples.length, Math.round(outSeconds * sampleRate));
  for (let i = 0; i < fadeIn; i++) samples[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  for (let i = 0; i < fadeOut; i++) {
    samples[samples.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  }
}

// --- Pluck: Karplus-Strong string. The two-point average adds half a sample
// of delay, so the loop length is chosen for a period of (length + 0.5). ---
const PLUCK_NOTE = 57;
const PLUCK_SECONDS = 1.5;

function renderPluckChannel(sampleRate: number, seed: number): Float32Array {
  const length = Math.round(PLUCK_SECONDS * sampleRate);
  const period = Math.max(2, Math.round(sampleRate / noteToHz(PLUCK_NOTE) - 0.5));
  const random = mulberry32(seed);
  const delay = new Float32Array(period);
  for (let i = 0; i < period; i++) delay[i] = random() * 2 - 1;
  const out = new Float32Array(length);
  let index = 0;
  for (let i = 0; i < length; i++) {
    const next = (index + 1) % period;
    out[i] = delay[index];
    delay[index] = 0.99 * 0.5 * (delay[index] + delay[next]);
    index = next;
  }
  fadeEdges(out, sampleRate, 0.002, 0.02);
  return out;
}

// --- Riser: exponential sine sweep with a noise layer that arrives late. ---
const RISER_SECONDS = 1.0;
const RISER_FROM_HZ = 200;
const RISER_TO_HZ = 2000;

function renderRiserChannel(sampleRate: number, seed: number): Float32Array {
  const length = Math.round(RISER_SECONDS * sampleRate);
  const random = mulberry32(seed);
  const out = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const progress = i / length;
    const hz = RISER_FROM_HZ * Math.pow(RISER_TO_HZ / RISER_FROM_HZ, progress);
    phase += (TWO_PI * hz) / sampleRate;
    const tone = Math.sin(phase) * (0.15 + 0.85 * progress * progress);
    const noise = (random() * 2 - 1) * 0.2 * progress * progress * progress;
    out[i] = tone + noise;
  }
  fadeEdges(out, sampleRate, 0.005, 0.005);
  return out;
}

// --- Pad: three band-limited saws, detuned and spread, under a slowly moving low-pass. ---
const PAD_NOTE = 48;
const PAD_SECONDS = 2.0;
const PAD_VOICES = [
  { cents: -7, left: 1.0, right: 0.4 },
  { cents: 0, left: 0.8, right: 0.8 },
  { cents: 7, left: 0.4, right: 1.0 },
] as const;
const PAD_MAX_HARMONICS = 32;

function renderPad(sampleRate: number): [Float32Array, Float32Array] {
  const length = Math.round(PAD_SECONDS * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const voice of PAD_VOICES) {
    const hz = noteToHz(PAD_NOTE) * Math.pow(2, voice.cents / 1200);
    const harmonics = Math.min(PAD_MAX_HARMONICS, Math.floor(sampleRate / 2 / hz));
    for (let i = 0; i < length; i++) {
      const phase = (TWO_PI * hz * i) / sampleRate;
      let sample = 0;
      for (let harmonic = 1; harmonic <= harmonics; harmonic++) sample += Math.sin(harmonic * phase) / harmonic;
      left[i] += sample * voice.left;
      right[i] += sample * voice.right;
    }
  }
  for (const channel of [left, right]) {
    let state = 0;
    for (let i = 0; i < length; i++) {
      const seconds = i / sampleRate;
      const coefficient = 0.06 + 0.12 * (0.5 + 0.5 * Math.sin(TWO_PI * 0.5 * seconds));
      state += coefficient * (channel[i] - state);
      channel[i] = state;
    }
    fadeEdges(channel, sampleRate, 0.03, 0.06);
  }
  return [left, right];
}

// --- Kick: a sine whose pitch drops fast, under a short decay. ---
const KICK_SECONDS = 0.4;

function renderKickChannel(sampleRate: number): Float32Array {
  const length = Math.round(KICK_SECONDS * sampleRate);
  const out = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const seconds = i / sampleRate;
    const hz = 50 + 130 * Math.exp(-seconds / 0.04);
    phase += (TWO_PI * hz) / sampleRate;
    out[i] = Math.sin(phase) * Math.exp(-seconds / 0.12);
  }
  fadeEdges(out, sampleRate, 0.001, 0.02);
  return out;
}

export const NANO_SAMPLES: ReadonlyArray<NanoSampleSpec> = [
  {
    id: "pluck",
    name: "Pluck",
    description: "A plucked string that dies away. The crossfade loop keeps it sounding.",
    seconds: PLUCK_SECONDS,
    rootKey: PLUCK_NOTE,
    fundamentalHz: noteToHz(PLUCK_NOTE),
    render: sampleRate =>
      normalizeJointly([renderPluckChannel(sampleRate, 0x504c5543), renderPluckChannel(sampleRate, 0x504c5544)]),
  },
  {
    id: "riser",
    name: "Riser",
    description: "An upward sweep, loaded with its start past its end so it plays backwards. Swap them to hear it rise.",
    seconds: RISER_SECONDS,
    rootKey: 60,
    fundamentalHz: null,
    render: sampleRate =>
      normalizeJointly([renderRiserChannel(sampleRate, 0x52495345), renderRiserChannel(sampleRate, 0x52495346)]),
  },
  {
    id: "pad",
    name: "Pad",
    description: "An evolving tone. Move the loop points and the fade to hear the seam change.",
    seconds: PAD_SECONDS,
    rootKey: PAD_NOTE,
    fundamentalHz: noteToHz(PAD_NOTE),
    render: sampleRate => normalizeJointly(renderPad(sampleRate)),
  },
  {
    id: "kick",
    name: "Kick",
    description: "A short hit. Root key, octave and tune move it across the keyboard.",
    seconds: KICK_SECONDS,
    rootKey: 60,
    fundamentalHz: null,
    render: sampleRate => {
      const channel = renderKickChannel(sampleRate);
      return normalizeJointly([channel, channel.slice()]);
    },
  },
];

export const MAX_CUSTOM_SAMPLE_SECONDS = 60;

/** Decide whether a decoded file can be used as a sample. Returns the reason when it cannot. */
export function checkCustomSample(seconds: number, frames: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(frames) || frames < 2) {
    return "the file holds no audio";
  }
  if (seconds > MAX_CUSTOM_SAMPLE_SECONDS) {
    // Two decimals: a file a few hundredths over the limit must not print as the limit itself.
    return `it is ${seconds.toFixed(2)} s long and the sampler page takes samples up to ${MAX_CUSTOM_SAMPLE_SECONDS} s`;
  }
  return null;
}
