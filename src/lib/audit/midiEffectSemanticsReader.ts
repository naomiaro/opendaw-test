/**
 * Monophonic note reader for the MIDI effect semantics audit. An offline render of a Nano sampler
 * playing a sine sample is read back as notes: onset, end, pitch, velocity. The sampler's voice
 * outputs `sin × env²` (1 ms linear attack and release on `env`), scaled linearly by velocity, so
 * the pitch comes from the steady middle of a note and the peak from the first full cycle after
 * the attack. Pure over `Float32Array`s, no SDK imports.
 */
export interface ReaderOptions {
  /** `|x|` above this opens a note. */
  onsetThreshold: number;
  /** A run of frames at or below the threshold this long ends a note. A sine's envelope sits under the
   *  threshold only for microseconds around a zero crossing, so 2 ms never splits a tone, and it separates
   *  notes that end and begin a few ms apart (a Zeitgeist-warped note-off 4.8 ms before the next onset: run 1793740770955,
   *  `zg-amount1-dur480-sixteenths`). */
  gapMs: number;
  /** The voice's attack and release length. */
  attackMs: number;
  /** A pitch needs at least this many whole cycles: `minCycles + 1` rising zero crossings. */
  minCycles: number;
}

export const READER_DEFAULTS: ReaderOptions = { onsetThreshold: 0.002, gapMs: 2, attackMs: 1, minCycles: 3 };

export interface ReadNote {
  onsetFrame: number;
  endFrame: number;
  peak: number;
  frequencyHz: number | null;
  jitterCents: number | null;
  cycles: number;
}

export interface NoteFigure {
  onsetMs: number;
  endMs: number;
  pitch: number | null;
  cents: number | null;
  velocity: number;
  jitterCents: number | null;
}

/** One channel of a unit-amplitude sine at `hz`, phase 0. */
export function sineSample(rate: number, seconds: number, hz: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin(2 * Math.PI * hz * i / rate);
  return out;
}

/** The nearest MIDI pitch at A4 = 440 and the residual in cents (-50..50); a half-semitone tie rounds up. */
export function frequencyToPitch(hz: number): { pitch: number; cents: number } {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const pitch = Math.round(midi);
  return { pitch, cents: (midi - pitch) * 100 };
}

interface PitchRead { frequencyHz: number | null; jitterCents: number | null; cycles: number; periodFrames: number }

/** Mean period of linearly interpolated rising zero crossings over `[from, to]`. */
function readPitch(samples: Float32Array, rate: number, from: number, to: number, minCycles: number): PitchRead {
  const crossings: number[] = [];
  const last = Math.min(to, samples.length - 1);
  for (let i = Math.max(from, 1); i <= last; i++) {
    const before = samples[i - 1];
    const after = samples[i];
    if (before < 0 && after >= 0) crossings.push(i - 1 + before / (before - after));
  }
  const cycles = Math.max(0, crossings.length - 1);
  if (crossings.length < minCycles + 1) return { frequencyHz: null, jitterCents: null, cycles, periodFrames: 0 };
  let minPeriod = Infinity;
  let maxPeriod = 0;
  for (let i = 1; i < crossings.length; i++) {
    const period = crossings[i] - crossings[i - 1];
    minPeriod = Math.min(minPeriod, period);
    maxPeriod = Math.max(maxPeriod, period);
  }
  const periodFrames = (crossings[crossings.length - 1] - crossings[0]) / cycles;
  return { frequencyHz: rate / periodFrames, jitterCents: 1200 * Math.log2(maxPeriod / minPeriod), cycles, periodFrames };
}

/** The vertex of the parabola through `|x|` at `at` and its two neighbours; the sample itself when the three are flat. */
function vertexAt(samples: Float32Array, at: number): number {
  const y0 = Math.abs(samples[at - 1]);
  const y1 = Math.abs(samples[at]);
  const y2 = Math.abs(samples[at + 1]);
  const denominator = y0 - 2 * y1 + y2;
  return denominator === 0 ? y1 : y1 - (y0 - y2) ** 2 / (8 * denominator);
}

/**
 * The largest `|x|` in `[from, to]`, lifted to the vertex of a parabola through it and its neighbours, so a crest between
 * two frames is not read low. Only neighbours inside the window are used: a max on the window's edge may be the flank of a
 * crest outside it, and a parabola through a larger outside sample can put its vertex anywhere. Such a max is not refined;
 * the window's largest interior crest (a sample no smaller than either neighbour) is refined instead, and the larger of the
 * two is the peak. A refined crest lies within half a frame of its sample, so it stays within a quarter of its level.
 */
export function refinedPeak(samples: Float32Array, from: number, to: number): number {
  let at = -1;
  let best = 0;
  for (let i = from; i <= to; i++) {
    const level = Math.abs(samples[i]);
    if (level > best) { best = level; at = i; }
  }
  if (at > from && at < to) return vertexAt(samples, at);
  let refined = best;
  for (let i = from + 1; i < to; i++) {
    const level = Math.abs(samples[i]);
    if (level >= Math.abs(samples[i - 1]) && level >= Math.abs(samples[i + 1])) refined = Math.max(refined, vertexAt(samples, i));
  }
  return refined;
}

/** The pitch and peak passes over a GIVEN span; the peak covers one cycle after the attack (the whole span when there is no pitch). */
export function readWindow(samples: Float32Array, rate: number, onsetFrame: number, endFrame: number, options: ReaderOptions = READER_DEFAULTS): ReadNote {
  const attackFrames = Math.round(options.attackMs * rate / 1000);
  const pitch = readPitch(samples, rate, onsetFrame + 2 * attackFrames, endFrame - attackFrames, options.minCycles);
  const peakFrom = onsetFrame + attackFrames;
  const peakTo = pitch.frequencyHz === null ? endFrame : Math.min(endFrame, peakFrom + Math.ceil(pitch.periodFrames) + attackFrames);
  const peak = refinedPeak(samples, Math.max(peakFrom, 0), Math.min(peakTo, samples.length - 1));
  return { onsetFrame, endFrame, peak, frequencyHz: pitch.frequencyHz, jitterCents: pitch.jitterCents, cycles: pitch.cycles };
}

/** Every note in the buffer: an onset is the first frame above the threshold after a gap, the end the last one above it before the next gap. */
export function readNotes(samples: Float32Array, rate: number, options: ReaderOptions = READER_DEFAULTS): ReadNote[] {
  const gapFrames = Math.round(options.gapMs * rate / 1000);
  const spans: Array<[number, number]> = [];
  let onset = -1;
  let lastLoud = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= options.onsetThreshold) continue;
    if (onset >= 0 && i - lastLoud > gapFrames) {
      spans.push([onset, lastLoud]);
      onset = -1;
    }
    if (onset < 0) onset = i;
    lastLoud = i;
  }
  if (onset >= 0) spans.push([onset, lastLoud]);
  return spans.map(([from, to]) => readWindow(samples, rate, from, to, options));
}

/** The largest `|x|` in the channel: 0 is a silent render. */
export function channelPeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

/** What the calibration row gives every later row: the loudest note's peak (velocity 1) and the frames between the first note's pulse and its read onset. */
export interface Calibration { referencePeak: number; instrumentOffsetFrames: number }

/** From the calibration row's read notes; `firstOnsetSeconds` is where its first note's pulse falls in the render. Throws unless
 *  exactly `expectedNotes` were read, and unless the reference peak is a positive finite level (every velocity divides by it). */
export function calibrationFrom(notes: readonly ReadNote[], rate: number, firstOnsetSeconds: number, expectedNotes: number): Calibration {
  if (notes.length !== expectedNotes) throw new Error(`read ${notes.length} notes, expected ${expectedNotes}`);
  const referencePeak = Math.max(...notes.map((note) => note.peak));
  if (!(Number.isFinite(referencePeak) && referencePeak > 0)) throw new Error(`reference peak ${referencePeak} is not a positive finite level`);
  return {
    referencePeak,
    instrumentOffsetFrames: notes[0].onsetFrame - Math.round(firstOnsetSeconds * rate),
  };
}

/** A time in the register's frame (the instrument offset netted out) as a frame of the render. */
export function msToFrame(ms: number, rate: number, instrumentOffsetFrames: number): number {
  return Math.round(ms / 1000 * rate) + instrumentOffsetFrames;
}

/** `readWindow` over a span given in the register's milliseconds, as a figure: how the judge reads an abutting note at its predicted span. */
export function readFigureAt(
  samples: Float32Array, rate: number, onsetMs: number, endMs: number, calibration: Calibration, options: ReaderOptions = READER_DEFAULTS
): NoteFigure {
  const { referencePeak, instrumentOffsetFrames } = calibration;
  const note = readWindow(samples, rate, msToFrame(onsetMs, rate, instrumentOffsetFrames), msToFrame(endMs, rate, instrumentOffsetFrames), options);
  return toFigure(note, rate, referencePeak, instrumentOffsetFrames);
}

/** A read note as the register's figures: times net the instrument offset, velocity is the peak over the reference. */
export function toFigure(note: ReadNote, rate: number, referencePeak: number, instrumentOffsetFrames: number): NoteFigure {
  const read = note.frequencyHz === null ? null : frequencyToPitch(note.frequencyHz);
  return {
    onsetMs: (note.onsetFrame - instrumentOffsetFrames) * 1000 / rate,
    endMs: (note.endFrame - instrumentOffsetFrames) * 1000 / rate,
    pitch: read === null ? null : read.pitch,
    cents: read === null ? null : read.cents,
    velocity: note.peak / referencePeak,
    jitterCents: note.jitterCents
  };
}
