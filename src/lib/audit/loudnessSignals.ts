/**
 * Test tones for the loudness meter audit, and the K-weighting response a tone's
 * expected loudness is computed from. No SDK or DOM code: this runs in Node.
 */

/** A fixed frequency, or a fraction of the sample rate (`rateDivisor: 4` is fs/4). */
export type ToneFrequency = { hz: number } | { rateDivisor: number };

export interface ToneSegment {
  seconds: number;
  /** The sine's peak in dBFS. */
  levelDb: number;
  frequency: ToneFrequency;
  /** Phase of the segment's first sample, in degrees. A segment at the same frequency
   *  as the one before it continues that one's phase and ignores this. */
  phaseDeg: number;
}

/** A segment's place in the synthesized signal, in frames. `endFrame` is exclusive. */
export interface SegmentSpan {
  startFrame: number;
  endFrame: number;
}

export function frequencyHz(frequency: ToneFrequency, sampleRate: number): number {
  return "hz" in frequency ? frequency.hz : sampleRate / frequency.rateDivisor;
}

/** Where each segment falls. Throws for a segment that cannot be synthesized as stated. */
export function segmentSpans(segments: readonly ToneSegment[], sampleRate: number): SegmentSpan[] {
  if (!(sampleRate > 0)) throw new Error(`sample rate must be positive, got ${sampleRate}`);
  const spans: SegmentSpan[] = [];
  let frame = 0;
  for (const segment of segments) {
    const frames = Math.round(segment.seconds * sampleRate);
    if (!(frames > 0)) throw new Error(`a segment of ${segment.seconds} s holds no frames`);
    if (!Number.isFinite(segment.levelDb)) throw new Error(`a segment's level must be a number, got ${segment.levelDb}`);
    const hz = frequencyHz(segment.frequency, sampleRate);
    if (!(hz > 0 && hz < sampleRate / 2)) {
      throw new Error(`${hz} Hz cannot be synthesized at ${sampleRate} Hz (must be above 0 and below ${sampleRate / 2})`);
    }
    spans.push({ startFrame: frame, endFrame: frame + frames });
    frame += frames;
  }
  return spans;
}

/** One channel of the signal. `taperMs` is a linear fade at the very start and the very end. */
export function synthesize(segments: readonly ToneSegment[], sampleRate: number, taperMs: number = 0): Float32Array {
  const spans = segmentSpans(segments, sampleRate);
  const total = spans.length === 0 ? 0 : spans[spans.length - 1].endFrame;
  const out = new Float32Array(total);
  let phase = 0;
  let previousHz: number | null = null;
  segments.forEach((segment, index) => {
    const hz = frequencyHz(segment.frequency, sampleRate);
    const step = (2 * Math.PI * hz) / sampleRate;
    const gain = Math.pow(10, segment.levelDb / 20);
    if (hz !== previousHz) phase = (segment.phaseDeg * Math.PI) / 180;
    const { startFrame, endFrame } = spans[index];
    for (let frame = startFrame; frame < endFrame; frame++) {
      out[frame] = gain * Math.sin(phase + (frame - startFrame) * step);
    }
    phase += (endFrame - startFrame) * step;
    previousHz = hz;
  });
  const taperFrames = Math.min(Math.round((taperMs / 1000) * sampleRate), Math.floor(total / 2));
  for (let i = 0; i < taperFrames; i++) {
    const gain = i / taperFrames;
    out[i] *= gain;
    out[total - 1 - i] *= gain;
  }
  return out;
}

/** The highest sample the tone reaches, in dBFS: below its true peak when no sample lands on a crest. */
export function samplePeakDb(segment: ToneSegment, sampleRate: number): number {
  const step = (2 * Math.PI * frequencyHz(segment.frequency, sampleRate)) / sampleRate;
  const phase = (segment.phaseDeg * Math.PI) / 180;
  let peak = 0;
  for (let frame = 0; frame < sampleRate; frame++) {
    peak = Math.max(peak, Math.abs(Math.sin(phase + frame * step)));
  }
  return segment.levelDb + 20 * Math.log10(peak);
}

/** Magnitude of a biquad `b / a` (with `a[0]` = 1) at angular frequency `w`. */
function biquadMagnitude(b: readonly number[], a: readonly number[], w: number): number {
  const real = (c: readonly number[]) => c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w);
  const imaginary = (c: readonly number[]) => c[1] * Math.sin(w) + c[2] * Math.sin(2 * w);
  return Math.hypot(real(b), imaginary(b)) / Math.hypot(real(a), imaginary(a));
}

/**
 * Gain of ITU-R BS.1770 K-weighting at `hz`, in dB. The standard prints coefficients for
 * 48 kHz only; these are its two stages as analog prototypes, transformed at `sampleRate`,
 * which gives the printed coefficients back at 48 kHz.
 */
export function kWeightingDb(sampleRate: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  // Stage 1: high shelf, +4 dB above about 1.7 kHz.
  const shelfQ = 0.7071752369554196;
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelfB = [
    (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    (2 * (shelfK * shelfK - vh)) / shelfA0,
    (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
  ];
  const shelfA = [1, (2 * (shelfK * shelfK - 1)) / shelfA0, (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0];
  // Stage 2: high-pass at about 38 Hz. Its numerator stays 1, -2, 1, as the standard has it.
  const highQ = 0.5003270373238773;
  const highK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const highA0 = 1 + highK / highQ + highK * highK;
  const highA = [1, (2 * (highK * highK - 1)) / highA0, (1 - highK / highQ + highK * highK) / highA0];
  return 20 * Math.log10(biquadMagnitude(shelfB, shelfA, w) * biquadMagnitude([1, -2, 1], highA, w));
}

/**
 * Loudness, in LUFS, of a sine at `levelDb` played in phase on both channels of a stereo
 * signal: each channel's mean square is half the peak squared, and the two are summed.
 */
export function expectedToneLoudness(sampleRate: number, hz: number, levelDb: number): number {
  return levelDb - 0.691 + kWeightingDb(sampleRate, hz);
}
