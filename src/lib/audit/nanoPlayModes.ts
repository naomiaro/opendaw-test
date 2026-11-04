/**
 * The Nano play-mode audit: what `nano-play-modes-debug-demo.html` renders and how it reads each render. One Nano holds
 * a 1 s sine at 440 Hz with root key 60, attack and release 1 ms, loop off unless the row says. Every row writes its
 * own note pattern into the region, sets the sampler's play-mode fields, renders offline and judges the render by
 * one of four readers: the 440 Hz envelope across a second note (Mono / Poly), one note's length (One-shot), the
 * notes' frequencies (Fixed pitch), or the two channels' peaks (Pan). Pure functions over Float32Arrays, tested in Node.
 */
import { PPQN } from "@opendaw/lib-dsp";
import type { NanoDeviceBox } from "@opendaw/studio-boxes";
import { readNotes, READER_DEFAULTS, type ReadNote } from "@/lib/audit/midiEffectSemanticsReader";

export const PLAY_MODE_BPM = 120;
export const PLAY_MODE_SAMPLE_HZ = 440;
export const PLAY_MODE_SAMPLE_SECONDS = 1;
export const PLAY_MODE_ROOT_KEY = 60;
export const PLAY_MODE_ATTACK_SECONDS = 0.001;
export const PLAY_MODE_RELEASE_SECONDS = 0.001;
/** The region starts at bar 1 so the render's first bar is silence the readers can rely on. */
export const PLAY_MODE_REGION_POSITION_PPQN = PPQN.Bar;
export const PLAY_MODE_REGION_DURATION_PPQN = PPQN.Bar;
/** Past the region: the longest read note (a one-shot playing the whole sample) ends 1 s after its onset. */
export const PLAY_MODE_RENDER_TAIL_SECONDS = 0.5;

const QUARTER = PPQN.Quarter;
const EIGHTH = PPQN.Quarter / 2;
/** The crate's `FAST_RELEASE_SECONDS`: a mono retrigger fades the sounding voice over this. */
export const MONO_FADE_MS = 5;
/** The band the −40 dB crossing of the faded voice may land in: the squared 5 ms fade reaches 1 % at 4.5 ms and the
 *  envelope reader averages over one 440 Hz period (2.3 ms). */
export const MONO_FADE_BAND_MS: readonly [number, number] = [3, 9];
/** A kept voice's level may move this much across the second note's onset (the envelope reader's own ripple). */
export const KEPT_TOLERANCE_DB = 1;
/** A cut voice reads at least this far down once the fade has run. */
export const CUT_FLOOR_DB = -40;
/** A note that is meant to sound reads at least this loud (dBFS): a velocity-1 sine renders near −3 dBFS, and a
 *  relative reading on silence would otherwise pass (0 − 0 = 0 dB). */
export const SOUNDING_FLOOR_DB = -20;
/** The louder channel's peak in a pan row must clear this, or the ratio is read on nothing. */
export const SOUNDING_FLOOR_PEAK = 10 ** (SOUNDING_FLOOR_DB / 20);
/** A read frequency may miss its expectation by this much (the zero-crossing reader on a 1 ms-enveloped sine). */
export const PITCH_TOLERANCE_CENTS = 5;
/** A note's read length may miss its expectation by this much: the 1 ms release plus the reader's gap. */
export const LENGTH_TOLERANCE_MS = 10;
/** A channel's peak over the louder channel may miss the pan law by this much. */
export const PAN_TOLERANCE = 0.01;

export interface PlayModeNote {
  /** PPQN from the region's start */
  position: number;
  /** PPQN */
  duration: number;
  pitch: number;
}

export interface PlayModeSettings {
  polyphone: boolean;
  oneShot: boolean;
  fixedPitch: boolean;
  loop: boolean;
  octave: number;
  /** -1 .. 1 */
  panning: number;
}

export const DEFAULT_SETTINGS: PlayModeSettings = { polyphone: true, oneShot: false, fixedPitch: false, loop: false, octave: 0, panning: 0 };

export type PlayModeExpectation =
  /** A second note starts while the first sounds: does the first keep sounding? */
  | { kind: "overlap"; firstKeepsSounding: boolean }
  /** One note: how long does it sound, from its onset, in ms? */
  | { kind: "length"; ms: number }
  /** Notes in order: the frequency of each. */
  | { kind: "pitches"; hz: readonly number[] }
  /** One note: each channel's peak over the louder channel's. */
  | { kind: "pan"; left: number; right: number };

export interface PlayModeRow {
  id: string;
  label: string;
  notes: readonly PlayModeNote[];
  settings: PlayModeSettings;
  expected: PlayModeExpectation;
}

const OVERLAP_NOTES: readonly PlayModeNote[] = [
  { position: 0, duration: QUARTER, pitch: 60 },
  { position: EIGHTH, duration: EIGHTH, pitch: 72 },
];
const ONE_NOTE: readonly PlayModeNote[] = [{ position: 0, duration: EIGHTH, pitch: 60 }];
const TWO_KEYS: readonly PlayModeNote[] = [
  { position: 0, duration: QUARTER, pitch: 60 },
  { position: 2 * QUARTER, duration: QUARTER, pitch: 67 },
];
const HZ_60 = PLAY_MODE_SAMPLE_HZ;
const HZ_67 = PLAY_MODE_SAMPLE_HZ * 2 ** (7 / 12);
const EIGHTH_MS = PPQN.pulsesToSeconds(EIGHTH, PLAY_MODE_BPM) * 1000;

/** The pan law the crate applies (`apply_panning`): the near side stays at 1, the far side is turned down linearly. */
export function panLaw(panning: number): { left: number; right: number } {
  return { left: 1 - Math.max(panning, 0), right: 1 + Math.min(panning, 0) };
}

export const PLAY_MODE_ROWS: readonly PlayModeRow[] = [
  { id: "poly-overlap", label: "Poly: a second note leaves the first sounding", notes: OVERLAP_NOTES, settings: DEFAULT_SETTINGS, expected: { kind: "overlap", firstKeepsSounding: true } },
  { id: "mono-cut", label: `Mono: a second note fades the first out over ${MONO_FADE_MS} ms`, notes: OVERLAP_NOTES, settings: { ...DEFAULT_SETTINGS, polyphone: false }, expected: { kind: "overlap", firstKeepsSounding: false } },
  { id: "one-shot-off", label: "Default: an eighth note sounds for an eighth", notes: ONE_NOTE, settings: DEFAULT_SETTINGS, expected: { kind: "length", ms: EIGHTH_MS } },
  { id: "one-shot", label: "One-shot: an eighth note plays the whole sample", notes: ONE_NOTE, settings: { ...DEFAULT_SETTINGS, oneShot: true }, expected: { kind: "length", ms: PLAY_MODE_SAMPLE_SECONDS * 1000 } },
  { id: "one-shot-loop", label: "One-shot with the loop on: the note-off still stops it", notes: ONE_NOTE, settings: { ...DEFAULT_SETTINGS, oneShot: true, loop: true }, expected: { kind: "length", ms: EIGHTH_MS } },
  { id: "fixed-off", label: "Default: two keys, two pitches", notes: TWO_KEYS, settings: DEFAULT_SETTINGS, expected: { kind: "pitches", hz: [HZ_60, HZ_67] } },
  { id: "fixed-pitch", label: "Fixed pitch: two keys, the root pitch twice", notes: TWO_KEYS, settings: { ...DEFAULT_SETTINGS, fixedPitch: true }, expected: { kind: "pitches", hz: [HZ_60, HZ_60] } },
  { id: "fixed-pitch-octave", label: "Fixed pitch with Octave +1: the root pitch an octave up, twice", notes: TWO_KEYS, settings: { ...DEFAULT_SETTINGS, fixedPitch: true, octave: 1 }, expected: { kind: "pitches", hz: [2 * HZ_60, 2 * HZ_60] } },
  { id: "pan-centre", label: "Pan centred: both channels alike", notes: ONE_NOTE, settings: DEFAULT_SETTINGS, expected: { kind: "pan", ...panLaw(0) } },
  { id: "pan-left", label: "Pan hard left: the right channel silent", notes: ONE_NOTE, settings: { ...DEFAULT_SETTINGS, panning: -1 }, expected: { kind: "pan", ...panLaw(-1) } },
  { id: "pan-half-right", label: "Pan half right: the left channel at half", notes: ONE_NOTE, settings: { ...DEFAULT_SETTINGS, panning: 0.5 }, expected: { kind: "pan", ...panLaw(0.5) } },
];

/** `?row=`: `all` or one id. */
export function resolveRows(param: string | null): readonly PlayModeRow[] {
  if (param === null || param === "all") return PLAY_MODE_ROWS;
  const row = PLAY_MODE_ROWS.find((r) => r.id === param);
  if (row === undefined) throw new Error(`invalid ?row= "${param}" — all or one of ${PLAY_MODE_ROWS.map((r) => r.id).join(", ")}`);
  return [row];
}

/** The sampler's play-mode fields as the row wants them. Call inside a transaction. */
export function applyPlayModeSettings(box: NanoDeviceBox, settings: PlayModeSettings): void {
  box.polyphone.setValue(settings.polyphone);
  box.oneShot.setValue(settings.oneShot);
  box.fixedPitch.setValue(settings.fixedPitch);
  box.loop.setValue(settings.loop);
  box.octave.setValue(settings.octave);
  box.panning.setValue(settings.panning);
}

export function renderSeconds(): number {
  return PPQN.pulsesToSeconds(PLAY_MODE_REGION_POSITION_PPQN + PLAY_MODE_REGION_DURATION_PPQN, PLAY_MODE_BPM) + PLAY_MODE_RENDER_TAIL_SECONDS;
}

/**
 * The amplitude of the `hz` component, frame by frame: the signal demodulated at `hz` and averaged over exactly
 * `periods` periods of it. A tone averages out of the window when the window holds a whole number of ITS periods too:
 * one 440 Hz period holds two of 880 Hz, so the octave above averages out of a 440 Hz read, but a 440 Hz tone does not
 * average out of a one-period 880 Hz read (half a period of it), which is what `periods` is for. The period is a
 * fractional frame count (109.09 at 48 kHz, 100.23 at 44.1 kHz), so the window's ends are interpolated (a cubic
 * through the prefix sums) rather than rounded to frames: a pure 880 Hz sine reads under −80 dB at 440 Hz at both
 * rates, where rounding left it at −47 dB at 44.1 kHz. Entry `i` is the amplitude of the window ENDING at frame `i`;
 * the first window reads as a ramp. Returns the whole buffer's length.
 */
export function toneEnvelope(samples: Float32Array, rate: number, hz: number, periods: number = 1): Float32Array {
  const span = (periods * rate) / hz;
  const length = samples.length;
  const out = new Float32Array(length);
  // prefix sums of the demodulated signal, in doubles: the window is a difference of two of them
  const cumI = new Float64Array(length + 1);
  const cumQ = new Float64Array(length + 1);
  const w = (2 * Math.PI * hz) / rate;
  for (let n = 0; n < length; n++) {
    cumI[n + 1] = cumI[n] + samples[n] * Math.cos(w * n);
    cumQ[n + 1] = cumQ[n] - samples[n] * Math.sin(w * n);
  }
  // the prefix sum at a fractional index: a Catmull-Rom cubic through its four neighbours (linear at the edges)
  const at = (cum: Float64Array, x: number): number => {
    const k = Math.floor(x);
    const t = x - k;
    if (k >= length) return cum[length];
    if (k < 1 || k + 2 > length) return cum[k] + t * (cum[k + 1] - cum[k]);
    const p0 = cum[k - 1];
    const p1 = cum[k];
    const p2 = cum[k + 1];
    const p3 = cum[k + 2];
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  };
  for (let n = 0; n < length; n++) {
    const end = n + 1;
    const start = Math.max(0, end - span);
    out[n] = (2 * Math.hypot(cumI[end] - at(cumI, start), cumQ[end] - at(cumQ, start))) / span;
  }
  return out;
}

const DB_FLOOR = -120;
export const toDb = (amplitude: number): number => (amplitude <= 0 ? DB_FLOOR : Math.max(DB_FLOOR, 20 * Math.log10(amplitude)));

function meanOver(values: Float32Array, from: number, to: number): number {
  const lo = Math.max(0, from);
  const hi = Math.min(values.length, to);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let n = lo; n < hi; n++) sum += values[n];
  return sum / (hi - lo);
}

export interface OverlapFigures {
  /** The first note's level (at `hz`) over the 100 ms before the second note, dBFS. */
  beforeDb: number;
  /** The first note's level over 20..40 ms after the second note's onset, relative to before, dB. */
  afterDb: number;
  /** Ms after the second note's onset where the first note's level first reads 40 dB under `before`; null when it never does. */
  cut40Ms: number | null;
  /** The second note's level (at `secondHz`) over the same 20..40 ms, dBFS: the second note must itself be sounding. */
  secondDb: number;
}

/** The first note's level before and after the second note starts (`secondOnsetFrame`), when it is gone, and the second note's own level. */
export function overlapFigures(samples: Float32Array, rate: number, hz: number, secondHz: number, secondOnsetFrame: number): OverlapFigures {
  const envelope = toneEnvelope(samples, rate, hz);
  const ms = (n: number): number => Math.round((n * rate) / 1000);
  const before = meanOver(envelope, secondOnsetFrame - ms(100), secondOnsetFrame);
  const after = meanOver(envelope, secondOnsetFrame + ms(20), secondOnsetFrame + ms(40));
  const beforeDb = toDb(before);
  let cut40Ms: number | null = null;
  const floor = before * 10 ** (CUT_FLOOR_DB / 20);
  for (let n = secondOnsetFrame; n < Math.min(envelope.length, secondOnsetFrame + ms(100)); n++) {
    if (envelope[n] <= floor) {
      cut40Ms = ((n - secondOnsetFrame) * 1000) / rate;
      break;
    }
  }
  // the window holds one period of the LOWER tone, so the other note averages out of this read too
  const periods = Math.max(1, Math.round(secondHz / hz));
  const second = meanOver(toneEnvelope(samples, rate, secondHz, periods), secondOnsetFrame + ms(20), secondOnsetFrame + ms(40));
  return { beforeDb, afterDb: toDb(after) - beforeDb, cut40Ms, secondDb: toDb(second) };
}

export type PlayModeStatus = "as-expected" | "investigate";

export interface PlayModeVerdict {
  status: PlayModeStatus;
  /** The row's figures as a reader prints them. */
  figure: string;
  /** The same figures by name, for the summary. */
  values: Readonly<Record<string, number | null>>;
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

/** Frames from the render's start to a note's onset, as the pattern places it. */
export function noteOnsetFrame(note: PlayModeNote, rate: number): number {
  return Math.round(PPQN.pulsesToSeconds(PLAY_MODE_REGION_POSITION_PPQN + note.position, PLAY_MODE_BPM) * rate);
}

/** The frequency a key plays the 440 Hz sample at, with the row's octave. */
function keyHz(pitch: number, octave: number): number {
  return PLAY_MODE_SAMPLE_HZ * 2 ** ((pitch - PLAY_MODE_ROOT_KEY) / 12 + octave);
}

function judgeOverlap(row: PlayModeRow, expected: Extract<PlayModeExpectation, { kind: "overlap" }>, left: Float32Array, rate: number, offsetFrames: number | null): PlayModeVerdict {
  if (offsetFrames === null) return { status: "investigate", figure: "no note read for the sampler's offset, so the second note's onset cannot be placed", values: { offsetFrames: null } };
  const [first, second] = row.notes;
  const figures = overlapFigures(left, rate, keyHz(first.pitch, row.settings.octave), keyHz(second.pitch, row.settings.octave), noteOnsetFrame(second, rate) + offsetFrames);
  const values = {
    offsetFrames, beforeDb: round(figures.beforeDb), afterDb: round(figures.afterDb), cut40Ms: figures.cut40Ms === null ? null : round(figures.cut40Ms), secondDb: round(figures.secondDb),
  };
  // both notes must sound, or a relative reading on silence passes
  if (figures.beforeDb < SOUNDING_FLOOR_DB) return { status: "investigate", figure: `first note not sounding before the second: ${values.beforeDb} dBFS (expected ≥ ${SOUNDING_FLOOR_DB})`, values };
  if (figures.secondDb < SOUNDING_FLOOR_DB) return { status: "investigate", figure: `second note not sounding: ${values.secondDb} dBFS at 20..40 ms (expected ≥ ${SOUNDING_FLOOR_DB})`, values };
  if (expected.firstKeepsSounding) {
    const kept = Math.abs(figures.afterDb) <= KEPT_TOLERANCE_DB;
    return { status: kept ? "as-expected" : "investigate", figure: `first note ${figures.afterDb >= 0 ? "+" : ""}${values.afterDb} dB across the second's onset (kept within ±${KEPT_TOLERANCE_DB} dB), first ${values.beforeDb} dBFS, second ${values.secondDb} dBFS`, values };
  }
  const gone = figures.afterDb <= CUT_FLOOR_DB;
  const inBand = figures.cut40Ms !== null && figures.cut40Ms >= MONO_FADE_BAND_MS[0] && figures.cut40Ms <= MONO_FADE_BAND_MS[1];
  const cut = values.cut40Ms === null ? "never" : `${values.cut40Ms} ms`;
  return {
    status: gone && inBand ? "as-expected" : "investigate",
    figure: `first note ${values.afterDb} dB at 20..40 ms (expected ≤ ${CUT_FLOOR_DB}), 40 dB down after ${cut} (expected ${MONO_FADE_BAND_MS[0]}..${MONO_FADE_BAND_MS[1]} ms), second ${values.secondDb} dBFS`,
    values,
  };
}

function judgeLength(expected: Extract<PlayModeExpectation, { kind: "length" }>, notes: readonly ReadNote[], rate: number): PlayModeVerdict {
  if (notes.length !== 1) return { status: "investigate", figure: `${notes.length} notes read, expected 1`, values: { notes: notes.length, lengthMs: null } };
  const lengthMs = ((notes[0].endFrame - notes[0].onsetFrame) * 1000) / rate;
  const within = Math.abs(lengthMs - expected.ms) <= LENGTH_TOLERANCE_MS;
  return { status: within ? "as-expected" : "investigate", figure: `sounds ${round(lengthMs, 1)} ms (expected ${round(expected.ms, 1)} ± ${LENGTH_TOLERANCE_MS})`, values: { notes: 1, lengthMs: round(lengthMs, 1) } };
}

function judgePitches(expected: Extract<PlayModeExpectation, { kind: "pitches" }>, notes: readonly ReadNote[]): PlayModeVerdict {
  const values: Record<string, number | null> = { notes: notes.length };
  notes.forEach((note, index) => { values[`hz${index}`] = note.frequencyHz === null ? null : round(note.frequencyHz, 1); });
  if (notes.length !== expected.hz.length) return { status: "investigate", figure: `${notes.length} notes read, expected ${expected.hz.length}`, values };
  const cents = notes.map((note, index) => (note.frequencyHz === null ? null : 1200 * Math.log2(note.frequencyHz / expected.hz[index])));
  const within = cents.every((c) => c !== null && Math.abs(c) <= PITCH_TOLERANCE_CENTS);
  const read = notes.map((note, index) => {
    const c = cents[index];
    return `${note.frequencyHz === null ? "unreadable" : round(note.frequencyHz, 1)} Hz (expected ${round(expected.hz[index], 1)}${c === null ? "" : `, ${c >= 0 ? "+" : ""}${round(c, 1)} ct`})`;
  });
  return { status: within ? "as-expected" : "investigate", figure: read.join("; "), values };
}

function judgePan(expected: Extract<PlayModeExpectation, { kind: "pan" }>, leftPeak: number, rightPeak: number): PlayModeVerdict {
  const louder = Math.max(leftPeak, rightPeak);
  const values = { left: round(louder === 0 ? 0 : leftPeak / louder, 3), right: round(louder === 0 ? 0 : rightPeak / louder, 3), peak: round(louder, 4) };
  // the ratio is read on nothing when neither channel sounds
  if (louder < SOUNDING_FLOOR_PEAK) return { status: "investigate", figure: `the louder channel peaks at ${values.peak} (expected ≥ ${round(SOUNDING_FLOOR_PEAK, 3)}, a sounding note)`, values };
  const within = Math.abs(leftPeak / louder - expected.left) <= PAN_TOLERANCE && Math.abs(rightPeak / louder - expected.right) <= PAN_TOLERANCE;
  return { status: within ? "as-expected" : "investigate", figure: `left ${values.left} / right ${values.right} of the louder (expected ${expected.left} / ${expected.right}), peak ${values.peak}`, values };
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let n = 0; n < samples.length; n++) peak = Math.max(peak, Math.abs(samples[n]));
  return peak;
}

/**
 * Judge one row's render. `offsetFrames` is the sampler's own latency, frames between a note's pulse and its read
 * onset, taken from the first row's first note (the overlap reader places its windows on the second note's pulse);
 * null when no note was read for it, which an overlap row reports instead of assuming zero.
 */
export function judgePlayModeRow(row: PlayModeRow, channels: readonly Float32Array[], rate: number, offsetFrames: number | null): PlayModeVerdict {
  const [left, right] = channels;
  if (left === undefined || right === undefined) return { status: "investigate", figure: `${channels.length} channels rendered, expected 2`, values: {} };
  const expected = row.expected;
  switch (expected.kind) {
    case "overlap": return judgeOverlap(row, expected, left, rate, offsetFrames);
    case "length": return judgeLength(expected, readNotes(left, rate, READER_DEFAULTS), rate);
    case "pitches": return judgePitches(expected, readNotes(left, rate, READER_DEFAULTS));
    case "pan": return judgePan(expected, peakOf(left), peakOf(right));
  }
}

/** The sampler's offset: the first read note's onset against its pulse. Null when nothing was read. */
export function instrumentOffsetFrames(row: PlayModeRow, left: Float32Array, rate: number): number | null {
  const notes = readNotes(left, rate, READER_DEFAULTS);
  if (notes.length === 0) return null;
  return notes[0].onsetFrame - noteOnsetFrame(row.notes[0], rate);
}
