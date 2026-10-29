/**
 * Audio-region loop-wrap families for the sample-rate alignment audit: the synthetic files,
 * where the wraps land, and the measurements the page takes around them. Pure (Float32Array
 * in, numbers out), so the fixtures and the measurements are tested in Node.
 *
 * Geometry shared by the three families: one audio region from bar 0 to bar 4 holding a
 * four-bar file, the timeline loop from bar 1 to bar 3, rendered from bar 0 for one bar of
 * pre-roll and AUDIO_WRAP_PASSES passes. Both loop edges sit inside the region, so every wrap
 * jumps from the middle of the file back to the middle of the file — the case the engine
 * crossfades over 5 ms at a discontinuous block; a hard cut there is what these families catch.
 * Pass 1 enters the loop start from bar 0 without a jump, so its loop-start beat is the reference.
 */

export const AUDIO_WRAP_LOOP_START_BARS = 1;
export const AUDIO_WRAP_LOOP_END_BARS = 3;
export const AUDIO_WRAP_FILE_BARS = 4;
export const AUDIO_WRAP_PASSES = 4;
/** Pre-roll bar plus every pass. */
export const AUDIO_WRAP_RENDER_BARS =
  AUDIO_WRAP_LOOP_START_BARS + AUDIO_WRAP_PASSES * (AUDIO_WRAP_LOOP_END_BARS - AUDIO_WRAP_LOOP_START_BARS);

const AMPLITUDE = 0.25;
/** The RMS of a fixture tone, the level `toneLevelDbBefore` reads a wrap's lead-in against. */
export const FIXTURE_TONE_RMS = AMPLITUDE / Math.SQRT2;
/** The click family's tone: low, so its own sample-to-sample curvature is tiny next to a cut. */
const CLICK_TONE_HZ = 110;
/** The dip family's tones: high enough that a 1 ms window holds whole periods of either. */
const DIP_TONE_HZ = 2000;
const DIP_AFTER_RATIO = 1.5;
/** A drum-like hit: an attack in the first sample, then an exponential decay. */
const BURST_SEC = 0.06;
const BURST_DECAY_SEC = 0.015;
const BURST_HZ = 2000;
const BURST_AMPLITUDE = 0.8;

export const barSeconds = (bpm: number): number => (4 * 60) / bpm;
export const loopSeconds = (bpm: number): number =>
  (AUDIO_WRAP_LOOP_END_BARS - AUDIO_WRAP_LOOP_START_BARS) * barSeconds(bpm);

/** Render times of the wraps: every pass's end, the last one inside the render's tail padding. */
export function wrapTimes(bpm: number): number[] {
  const bar = barSeconds(bpm);
  const times: number[] = [];
  for (let pass = 1; pass <= AUDIO_WRAP_PASSES; pass++) {
    times.push((AUDIO_WRAP_LOOP_START_BARS + pass * (AUDIO_WRAP_LOOP_END_BARS - AUDIO_WRAP_LOOP_START_BARS)) * bar);
  }
  return times;
}

/**
 * A tone with (n + 1/2) periods per loop: the loop end and the loop start meet at opposite peaks
 * (the loop start sits half a loop into the file and the loop end a loop and a half, so both land
 * on a peak), the largest step a cut can make on it.
 */
export function clickToneFrequency(bpm: number): number {
  const loop = loopSeconds(bpm);
  return (Math.round(CLICK_TONE_HZ * loop) + 0.5) / loop;
}

/** A tone with a whole number of periods per loop, so a hard cut at the wrap is seamless. */
export function dipToneFrequency(bpm: number): number {
  const loop = loopSeconds(bpm);
  return Math.round(DIP_TONE_HZ * loop) / loop;
}

function fileLength(sampleRate: number, bpm: number): number {
  return Math.round(AUDIO_WRAP_FILE_BARS * barSeconds(bpm) * sampleRate);
}

/** `audio-wrap-click`: one steady tone through the whole file, half a period out at the wrap. */
export function clickToneFile(sampleRate: number, bpm: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(fileLength(sampleRate, bpm));
  const f = clickToneFrequency(bpm);
  for (let i = 0; i < data.length; i++) data[i] = AMPLITUDE * Math.sin((2 * Math.PI * f * i) / sampleRate);
  return data;
}

/**
 * `audio-wrap-dip`: a tone seamless across the loop up to the loop end, then a different tone
 * from the loop end on, phase-continuous so the file itself has no step. A hard cut never reads
 * past the loop end; the crossfade's tail does, so its 5 ms mix two unrelated tones.
 */
export function dipToneFile(sampleRate: number, bpm: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(fileLength(sampleRate, bpm));
  const f0 = dipToneFrequency(bpm);
  const f1 = f0 * DIP_AFTER_RATIO;
  const endSample = Math.round(AUDIO_WRAP_LOOP_END_BARS * barSeconds(bpm) * sampleRate);
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] = AMPLITUDE * Math.sin(phase);
    phase += (2 * Math.PI * (i < endSample ? f0 : f1)) / sampleRate;
  }
  return data;
}

/**
 * `audio-wrap-onsets`: a burst on every beat from the file start up to the loop end, silence
 * after it. The silence matters: when the bar after the loop end starts with the same hit as the
 * loop start, the outgoing and incoming fades sum back to the whole hit, so the loop-start hit
 * is only softened when what follows the loop end differs — the case this measures.
 */
export function beatBurstFile(sampleRate: number, bpm: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(fileLength(sampleRate, bpm));
  const beat = 60 / bpm;
  const burst = Math.round(BURST_SEC * sampleRate);
  const beatsBeforeEnd = AUDIO_WRAP_LOOP_END_BARS * 4;
  for (let k = 0; k < beatsBeforeEnd; k++) {
    const start = Math.round(k * beat * sampleRate);
    for (let i = 0; i < burst && start + i < data.length; i++) {
      const env = Math.exp(-i / sampleRate / BURST_DECAY_SEC);
      data[start + i] = BURST_AMPLITUDE * Math.sin((2 * Math.PI * BURST_HZ * i) / sampleRate) * env;
    }
  }
  return data;
}

/** Every beat the onsets family plays, in render seconds: the pre-roll bar, then each pass. */
export function beatOnsets(bpm: number): number[] {
  const beat = 60 / bpm;
  const beats = AUDIO_WRAP_RENDER_BARS * 4;
  return Array.from({ length: beats }, (_, k) => k * beat);
}

/** The beats a wrap lands on (the loop start of passes 2 on), in render seconds. */
export function wrapBeatOnsets(bpm: number): number[] {
  return wrapTimes(bpm).filter((t) => t < AUDIO_WRAP_RENDER_BARS * barSeconds(bpm) - 1e-9);
}

/** The loop-start beat of pass 1, entered without a jump: the full hit the wrapped ones are read against. */
export function referenceBeatOnset(bpm: number): number {
  return AUDIO_WRAP_LOOP_START_BARS * barSeconds(bpm);
}

function rms(channel: Float32Array, from: number, to: number): number {
  const lo = Math.max(0, from);
  const hi = Math.min(channel.length, to);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += channel[i] * channel[i];
  return Math.sqrt(sum / (hi - lo));
}

function peakAbs(channel: Float32Array, from: number, to: number): number {
  let peak = 0;
  for (let i = Math.max(0, from); i < Math.min(channel.length, to); i++) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
}

/**
 * The deepest level around a wrap, in dB against the steady level before it: the lowest 1 ms
 * RMS over the wrap's first 8 ms, against a 10 ms RMS ending 20 ms before the wrap. Two linear
 * fades of unrelated signals of equal level dip to about −3 dB at their midpoint; a hard cut on a
 * seamless loop does not dip at all.
 */
export function dipDbAround(channel: Float32Array, sampleRate: number, atSec: number): number {
  const at = Math.round(atSec * sampleRate);
  const ms = sampleRate / 1000;
  const steady = rms(channel, at - Math.round(30 * ms), at - Math.round(20 * ms));
  if (steady === 0) return NaN;
  const window = Math.max(1, Math.round(ms));
  const hop = Math.max(1, Math.round(ms / 10));
  let lowest = Infinity;
  for (let start = at - Math.round(ms); start + window <= at + Math.round(8 * ms); start += hop) {
    lowest = Math.min(lowest, rms(channel, start, start + window));
  }
  return 20 * Math.log10(Math.max(lowest, 1e-12) / steady);
}

/**
 * The positive control of the continuity families: the tone's level in the 10 ms ending 20 ms
 * before a wrap, in dB against the fixture's own level. A render that went silent, or played
 * past the file's end because the loop never wrapped, reads far below 0 here, where a missing
 * step alone would read as a pass.
 */
export function toneLevelDbBefore(channel: Float32Array, sampleRate: number, atSec: number): number {
  const at = Math.round(atSec * sampleRate);
  const ms = sampleRate / 1000;
  const level = rms(channel, at - Math.round(30 * ms), at - Math.round(20 * ms));
  return level > 0 ? 20 * Math.log10(level / FIXTURE_TONE_RMS) : -Infinity;
}

export interface WrapBeatReading {
  /** Render seconds the beat is expected at. */
  expectedSec: number;
  /**
   * When the hit starts, against the pass-1 hit, in ms (NaN when either hit is silent): the first sample above 25% of the hit's
   * own peak (the onset detector's refinement rule), read the same way on both hits. Read
   * directly because a 5 ms fade-in spreads the attack over several detector hops and the
   * detector, which looks for one sharp rise, can miss the hit entirely.
   */
  shiftMs: number;
  /** Peak of the hit's first 20 ms, in dB against the pass-1 loop-start hit. */
  levelDb: number;
  /** Whether the onset detector found the hit at all (within 50 ms). */
  detected: boolean;
}

const PAIR_WINDOW_SEC = 0.05;
const HIT_SPAN_SEC = 0.02;
const HIT_LEAD_SEC = 0.01;
const START_RATIO = 0.25;

/** Split detected onsets into the ones near a wrap beat and the rest. */
export function splitWrapOnsets(
  onsets: readonly number[],
  wrapBeats: readonly number[],
  calibrationSec: number,
): { judged: number[]; nearWrap: number[] } {
  const judged: number[] = [];
  const nearWrap: number[] = [];
  for (const onset of onsets) {
    const adjusted = onset - calibrationSec;
    (wrapBeats.some((w) => Math.abs(adjusted - w) <= PAIR_WINDOW_SEC) ? nearWrap : judged).push(onset);
  }
  return { judged, nearWrap };
}

/** The hit at `expectedSec`: its peak and where it first passes a quarter of it, relative to `expectedSec`. */
function readHit(channel: Float32Array, sampleRate: number, expectedSec: number): { peak: number; startSec: number } {
  const from = Math.round((expectedSec - HIT_LEAD_SEC) * sampleRate);
  const to = Math.round((expectedSec + HIT_SPAN_SEC) * sampleRate);
  const peak = peakAbs(channel, from, to);
  if (peak === 0) return { peak, startSec: NaN };
  let start = to;
  for (let i = Math.max(0, from); i < Math.min(channel.length, to); i++) {
    if (Math.abs(channel[i]) >= START_RATIO * peak) {
      start = i;
      break;
    }
  }
  return { peak, startSec: start / sampleRate - expectedSec };
}

/** What each wrapped loop-start hit came out as, against the pass-1 hit. */
export function readWrapBeats(
  channel: Float32Array,
  sampleRate: number,
  nearWrapOnsets: readonly number[],
  wrapBeats: readonly number[],
  referenceSec: number,
  calibrationSec: number,
): WrapBeatReading[] {
  const reference = readHit(channel, sampleRate, referenceSec);
  return wrapBeats.map((expectedSec) => {
    const hit = readHit(channel, sampleRate, expectedSec);
    return {
      expectedSec,
      shiftMs: (hit.startSec - reference.startSec) * 1000,
      levelDb: reference.peak > 0 && hit.peak > 0 ? 20 * Math.log10(hit.peak / reference.peak) : -Infinity,
      detected: nearWrapOnsets.some((o) => Math.abs(o - calibrationSec - expectedSec) <= PAIR_WINDOW_SEC),
    };
  });
}
