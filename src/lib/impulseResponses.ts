/**
 * Procedurally synthesized impulse responses for the Convolver demo.
 *
 * Everything here is pure DSP on Float32Arrays — deterministic (seeded PRNG),
 * renderable at any sample rate, and unit-testable in Node without Web Audio.
 * `channelsToAudioBuffer` is the only browser-dependent helper.
 */

export interface ImpulseResponseSpec {
  /** Stable slug, used for stable AudioFileBox UUIDs and React keys */
  id: string;
  name: string;
  description: string;
  /** Rendered duration in seconds */
  seconds: number;
  /** Render stereo channel data at the given sample rate */
  render: (sampleRate: number) => [Float32Array, Float32Array];
}

/** Deterministic PRNG (mulberry32) — the gallery must render identically every load */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise shaped by an RT60 exponential decay */
function decayingNoise(length: number, sampleRate: number, rt60Seconds: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(length);
  const decayPerSample = -6.907755278982137 / (rt60Seconds * sampleRate); // ln(1/1000) over RT60
  for (let i = 0; i < length; i++) {
    out[i] = (random() * 2 - 1) * Math.exp(decayPerSample * i);
  }
  return out;
}

/**
 * One-pole lowpass whose cutoff coefficient slides from `startCoeff` to
 * `endCoeff` across the buffer — late reflections darken over time, which is
 * what separates a "hall" from filtered noise.
 */
function progressiveLowpass(samples: Float32Array, startCoeff: number, endCoeff: number): void {
  let state = 0;
  const lastIndex = Math.max(1, samples.length - 1);
  for (let i = 0; i < samples.length; i++) {
    const coeff = startCoeff + (endCoeff - startCoeff) * (i / lastIndex);
    state += coeff * (samples[i] - state);
    samples[i] = state;
  }
}

/** Feedback comb — turns a noise burst into a pitched metallic ring */
function combResonate(samples: Float32Array, periodSamples: number, feedback: number): void {
  for (let i = periodSamples; i < samples.length; i++) {
    samples[i] += feedback * samples[i - periodSamples];
  }
}

/** Short raised-cosine fade-out ending at `endIndex`; hard zeros after it */
function gateAt(samples: Float32Array, cutIndex: number, fadeSamples: number): void {
  const fadeEnd = Math.min(samples.length, cutIndex + fadeSamples);
  for (let i = cutIndex; i < fadeEnd; i++) {
    const t = (i - cutIndex) / fadeSamples;
    samples[i] *= 0.5 * (1 + Math.cos(Math.PI * t));
  }
  samples.fill(0, fadeEnd);
}

/** Raised-cosine fade-out over the last `fadeSamples` samples */
function fadeOutTail(samples: Float32Array, fadeSamples: number): void {
  const start = Math.max(0, samples.length - fadeSamples);
  for (let i = start; i < samples.length; i++) {
    const t = (i - start) / Math.max(1, samples.length - start);
    samples[i] *= 0.5 * (1 + Math.cos(Math.PI * t));
  }
}

/** Normalize both channels jointly to the target peak (default 0.9) */
function normalizeStereo(channels: [Float32Array, Float32Array], targetPeak = 0.9): [Float32Array, Float32Array] {
  let max = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      max = Math.max(max, Math.abs(channel[i]));
    }
  }
  if (max > 0) {
    const gain = targetPeak / max;
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) channel[i] *= gain;
    }
  }
  return channels;
}

const HALL_SECONDS = 3.2;
const PLATE_SECONDS = 2.0;
const ROOM_SECONDS = 0.45;
const GATED_SECONDS = 0.8;
const GATED_CUT_SECONDS = 0.5;
const REVERSE_SECONDS = 1.6;
const COMB_SECONDS = 2.4;

export const IMPULSE_RESPONSES: ReadonlyArray<ImpulseResponseSpec> = [
  {
    id: "hall",
    name: "Concert Hall",
    description: "Long 3 s decay that darkens over time — big, smooth space.",
    seconds: HALL_SECONDS,
    render: sampleRate => {
      const length = Math.round(HALL_SECONDS * sampleRate);
      const channels: [Float32Array, Float32Array] = [
        decayingNoise(length, sampleRate, 2.8, 0xa11ce),
        decayingNoise(length, sampleRate, 2.8, 0xb0b),
      ];
      for (const channel of channels) {
        progressiveLowpass(channel, 0.5, 0.08);
        fadeOutTail(channel, Math.round(0.05 * sampleRate));
      }
      return normalizeStereo(channels);
    },
  },
  {
    id: "plate",
    name: "Bright Plate",
    description: "Dense, bright 2 s decay — the classic vocal/snare plate sheen.",
    seconds: PLATE_SECONDS,
    render: sampleRate => {
      const length = Math.round(PLATE_SECONDS * sampleRate);
      const channels: [Float32Array, Float32Array] = [
        decayingNoise(length, sampleRate, 1.7, 0x9147e),
        decayingNoise(length, sampleRate, 1.7, 0x51a7e),
      ];
      // High-tilt: mix in the first difference to keep the top end sizzling
      for (const channel of channels) {
        let previous = 0;
        for (let i = 0; i < channel.length; i++) {
          const current = channel[i];
          channel[i] = current * 0.6 + (current - previous) * 0.4;
          previous = current;
        }
        fadeOutTail(channel, Math.round(0.04 * sampleRate));
      }
      return normalizeStereo(channels);
    },
  },
  {
    id: "room",
    name: "Small Room",
    description: "Tight 0.45 s ambience — adds air without washing anything out.",
    seconds: ROOM_SECONDS,
    render: sampleRate => {
      const length = Math.round(ROOM_SECONDS * sampleRate);
      const channels: [Float32Array, Float32Array] = [
        decayingNoise(length, sampleRate, 0.3, 0x500),
        decayingNoise(length, sampleRate, 0.3, 0x501),
      ];
      for (const channel of channels) {
        progressiveLowpass(channel, 0.6, 0.25);
        fadeOutTail(channel, Math.round(0.03 * sampleRate));
      }
      return normalizeStereo(channels);
    },
  },
  {
    id: "gated",
    name: "Gated",
    description: "Big decay chopped dead at 500 ms — the 80s drum trick.",
    seconds: GATED_SECONDS,
    render: sampleRate => {
      const length = Math.round(GATED_SECONDS * sampleRate);
      const channels: [Float32Array, Float32Array] = [
        decayingNoise(length, sampleRate, 2.5, 0x6a7ed),
        decayingNoise(length, sampleRate, 2.5, 0x6a7ee),
      ];
      const cutIndex = Math.round(GATED_CUT_SECONDS * sampleRate);
      for (const channel of channels) {
        gateAt(channel, cutIndex, Math.round(0.02 * sampleRate));
      }
      return normalizeStereo(channels);
    },
  },
  {
    id: "reverse",
    name: "Reverse Swell",
    description: "A decay played backwards — everything blooms into place.",
    seconds: REVERSE_SECONDS,
    render: sampleRate => {
      const length = Math.round(REVERSE_SECONDS * sampleRate);
      const channels: [Float32Array, Float32Array] = [
        decayingNoise(length, sampleRate, 1.3, 0x4e5e4),
        decayingNoise(length, sampleRate, 1.3, 0x4e5e5),
      ];
      for (const channel of channels) {
        progressiveLowpass(channel, 0.45, 0.15);
        channel.reverse();
        fadeOutTail(channel, Math.round(0.04 * sampleRate));
      }
      return normalizeStereo(channels);
    },
  },
  {
    id: "comb",
    name: "Metal Tank",
    description: "Noise burst ringing through a tuned comb — resonant and metallic.",
    seconds: COMB_SECONDS,
    render: sampleRate => {
      const length = Math.round(COMB_SECONDS * sampleRate);
      const channels: [Float32Array, Float32Array] = [
        decayingNoise(length, sampleRate, 0.12, 0xc0143),
        decayingNoise(length, sampleRate, 0.12, 0xc0144),
      ];
      // Slightly detuned periods per side keep the ring wide instead of mono
      const periods = [Math.round(sampleRate / 220), Math.round(sampleRate / 222)];
      channels.forEach((channel, index) => {
        combResonate(channel, periods[index], 0.93);
        fadeOutTail(channel, Math.round(0.2 * sampleRate));
      });
      return normalizeStereo(channels);
    },
  },
];

const ONE_SHOT_SECONDS = 0.3;

/**
 * Percussive clave-style one-shot for the dry source track: a 2.5 kHz sine
 * ping plus a short noise click, fully decayed well before the buffer ends so
 * everything heard after it is the convolver's tail.
 */
export function renderOneShot(sampleRate: number): [Float32Array, Float32Array] {
  const length = Math.round(ONE_SHOT_SECONDS * sampleRate);
  const random = mulberry32(0xc1a7e);
  const left = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const ping = Math.sin(2 * Math.PI * 2500 * t) * Math.exp(-t / 0.03);
    const click = (random() * 2 - 1) * Math.exp(-t / 0.004) * 0.5;
    left[i] = ping + click;
  }
  return normalizeStereo([left, left.slice()]);
}

/** Wrap rendered channel data in a Web Audio AudioBuffer (browser only) */
export function channelsToAudioBuffer(
  channels: ReadonlyArray<Float32Array>,
  sampleRate: number
): AudioBuffer {
  const buffer = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
  });
  channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  return buffer;
}
