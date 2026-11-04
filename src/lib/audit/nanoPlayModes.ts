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
 * The amplitude of the `hz` component, frame by frame: the signal demodulated at `hz` and averaged over one period
 * of it, so a tone at a multiple of `hz` (the second note an octave up) averages out. Entry `i` is the amplitude of
 * the period ENDING at frame `i`; the first period reads as a ramp. Returns the whole buffer's length.
 */
export function toneEnvelope(samples: Float32Array, rate: number, hz: number): Float32Array {
  const period = Math.max(1, Math.round(rate / hz));
  const out = new Float32Array(samples.length);
  const i = new Float32Array(samples.length);
  const q = new Float32Array(samples.length);
  const w = (2 * Math.PI * hz) / rate;
  for (let n = 0; n < samples.length; n++) {
    i[n] = samples[n] * Math.cos(w * n);
    q[n] = -samples[n] * Math.sin(w * n);
  }
  let sumI = 0;
  let sumQ = 0;
  for (let n = 0; n < samples.length; n++) {
    sumI += i[n];
    sumQ += q[n];
    if (n >= period) {
      sumI -= i[n - period];
      sumQ -= q[n - period];
    }
    out[n] = (2 * Math.hypot(sumI, sumQ)) / period;
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
  /** The 440 Hz level over the 100 ms before the second note, dB. */
  beforeDb: number;
  /** The 440 Hz level over 20..40 ms after the second note's onset, relative to before, dB. */
  afterDb: number;
  /** Ms after the second note's onset where the 440 Hz level first reads 40 dB under `before`; null when it never does. */
  cut40Ms: number | null;
}

/** The first note's level before and after the second note starts (`secondOnsetFrame`), and when it is gone. */
export function overlapFigures(samples: Float32Array, rate: number, hz: number, secondOnsetFrame: number): OverlapFigures {
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
  return { beforeDb, afterDb: toDb(after) - beforeDb, cut40Ms };
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

function judgeOverlap(row: PlayModeRow, expected: Extract<PlayModeExpectation, { kind: "overlap" }>, left: Float32Array, rate: number, offsetFrames: number): PlayModeVerdict {
  const second = row.notes[1];
  const figures = overlapFigures(left, rate, PLAY_MODE_SAMPLE_HZ, noteOnsetFrame(second, rate) + offsetFrames);
  const values = { beforeDb: round(figures.beforeDb), afterDb: round(figures.afterDb), cut40Ms: figures.cut40Ms === null ? null : round(figures.cut40Ms) };
  if (expected.firstKeepsSounding) {
    const kept = Math.abs(figures.afterDb) <= KEPT_TOLERANCE_DB;
    return { status: kept ? "as-expected" : "investigate", figure: `first note ${figures.afterDb >= 0 ? "+" : ""}${values.afterDb} dB across the second's onset (kept within ±${KEPT_TOLERANCE_DB} dB)`, values };
  }
  const gone = figures.afterDb <= CUT_FLOOR_DB;
  const inBand = figures.cut40Ms !== null && figures.cut40Ms >= MONO_FADE_BAND_MS[0] && figures.cut40Ms <= MONO_FADE_BAND_MS[1];
  const cut = values.cut40Ms === null ? "never" : `${values.cut40Ms} ms`;
  return {
    status: gone && inBand ? "as-expected" : "investigate",
    figure: `first note ${values.afterDb} dB at 20..40 ms (expected ≤ ${CUT_FLOOR_DB}), 40 dB down after ${cut} (expected ${MONO_FADE_BAND_MS[0]}..${MONO_FADE_BAND_MS[1]} ms)`,
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
  const read = notes.map((note, index) => `${note.frequencyHz === null ? "unreadable" : round(note.frequencyHz, 1)} Hz (expected ${round(expected.hz[index], 1)}${cents[index] === null ? "" : `, ${cents[index]! >= 0 ? "+" : ""}${round(cents[index]!, 1)} ct`})`);
  return { status: within ? "as-expected" : "investigate", figure: read.join("; "), values };
}

function judgePan(expected: Extract<PlayModeExpectation, { kind: "pan" }>, leftPeak: number, rightPeak: number): PlayModeVerdict {
  const louder = Math.max(leftPeak, rightPeak);
  const left = louder === 0 ? 0 : leftPeak / louder;
  const right = louder === 0 ? 0 : rightPeak / louder;
  const within = louder > 0 && Math.abs(left - expected.left) <= PAN_TOLERANCE && Math.abs(right - expected.right) <= PAN_TOLERANCE;
  return { status: within ? "as-expected" : "investigate", figure: `left ${round(left, 3)} / right ${round(right, 3)} of the louder (expected ${expected.left} / ${expected.right})`, values: { left: round(left, 3), right: round(right, 3), peak: round(louder, 4) } };
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let n = 0; n < samples.length; n++) peak = Math.max(peak, Math.abs(samples[n]));
  return peak;
}

/**
 * Judge one row's render. `offsetFrames` is the sampler's own latency, frames between a note's pulse and its read
 * onset, taken from the first row's first note (the overlap reader places its windows on the second note's pulse).
 */
export function judgePlayModeRow(row: PlayModeRow, channels: readonly Float32Array[], rate: number, offsetFrames: number): PlayModeVerdict {
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
