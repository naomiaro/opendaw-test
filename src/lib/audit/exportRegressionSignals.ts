// Plain Node must load this file: a script reads the constants, so no SDK value imports.

/** Source frames of the probe's impulses: three on a 128-frame quantum boundary, two off one. */
export const IMPULSE_SOURCE_FRAMES: readonly number[] = [4096, 24037, 72064, 120037, 168064];
export const PROBE_TONE_HZ = 997;
export const PROBE_TONE_LEVEL = 0.5;
export const IMPULSE_LEVEL = 0.9;

type Stereo = [Float32Array, Float32Array];

const framesOf = (sourceRate: number, seconds: number): number => Math.round(sourceRate * seconds);

const sine = (sourceRate: number, frames: number, hz: number, level: number): Float32Array => {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = level * Math.sin((2 * Math.PI * hz * i) / sourceRate);
  return out;
};

/** Left a sine, right one-sample impulses on silence; impulses past the end are left out. */
export const probeSource = (sourceRate: number, seconds: number): Stereo => {
  const frames = framesOf(sourceRate, seconds);
  const right = new Float32Array(frames);
  for (const frame of IMPULSE_SOURCE_FRAMES) if (frame < frames) right[frame] = IMPULSE_LEVEL;
  return [sine(sourceRate, frames, PROBE_TONE_HZ, PROBE_TONE_LEVEL), right];
};

/** Log sweep 20 Hz to 20 kHz at 0.4, the same on both channels. */
export const sweepSource = (sourceRate: number, seconds: number): Stereo => {
  const frames = framesOf(sourceRate, seconds);
  const f0 = 20;
  const f1 = 20000;
  const k = Math.log(f1 / f0);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / sourceRate;
    // phase = 2 pi * integral of f0 * exp(k t / T) dt
    const phase = 2 * Math.PI * f0 * seconds / k * (Math.exp((k * t) / seconds) - 1);
    out[i] = 0.4 * Math.sin(phase);
  }
  return [out, out.slice()];
};

/** A 200 ms 440 Hz burst at 0.5 from the start, then silence. */
export const tailSource = (sourceRate: number, seconds: number): Stereo => {
  const frames = framesOf(sourceRate, seconds);
  const burst = Math.min(frames, framesOf(sourceRate, 0.2));
  const left = new Float32Array(frames);
  left.set(sine(sourceRate, burst, 440, 0.5));
  return [left, left.slice()];
};

/** 220 Hz plus 3329.6 Hz at 0.15 each: the second unit in mix and stem rows. */
export const bedSource = (sourceRate: number, seconds: number): Stereo => {
  const frames = framesOf(sourceRate, seconds);
  const low = sine(sourceRate, frames, 220, 0.15);
  const high = sine(sourceRate, frames, 3329.6, 0.15);
  const left = new Float32Array(frames);
  for (let i = 0; i < frames; i++) left[i] = low[i] + high[i];
  return [left, left.slice()];
};

/** A 997 Hz sine at 1.5 on both channels, so the master Maximizer must limit it. */
export const hotSource = (sourceRate: number, seconds: number): Stereo => {
  const left = sine(sourceRate, framesOf(sourceRate, seconds), PROBE_TONE_HZ, 1.5);
  return [left, left.slice()];
};
