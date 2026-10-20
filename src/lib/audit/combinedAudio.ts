/**
 * The audio side of the combined MIDI + audio audit: clicks found in the Tape's take are
 * placed on the timeline, matched to the pattern's notes, and paired with the MIDI rows of
 * the same notes. Matching anchors on the eighth bars: a 1/32 step is 62 ms at 120 bpm and
 * an uncalibrated audio side reads about 64 ms late, a whole step, which would pair every
 * 1/32 click with the next note; so the eighth clicks (a 250 ms step) are matched first,
 * their median offset becomes the anchor, the eighths are matched again centred on it (so a
 * noise burst nearer the raw grid cannot take a pair) and the 1/32 bar is matched around
 * it; every error is reported raw. A lost click stays lost: nothing is matched by order.
 */
import { PPQN } from "@opendaw/lib-dsp";
import { BEAT_PPQN } from "./midiInputCalibration";
import { pulsesToMs } from "./midiClockMap";
import type { PatternNote } from "./midiInputPattern";
import { median, percentile } from "./midiInputAlignment";
import type { MidiAuditNoteRow } from "./midiInputArtifacts";

/** File time → timeline time: the region starts `waveformOffsetSec` into the buffer. */
export function onsetsToTimelineSec(onsetsFileSec: readonly number[], regionStartSec: number, waveformOffsetSec: number): number[] {
  return onsetsFileSec.map((t) => regionStartSec + (t - waveformOffsetSec));
}

export function withinSpan(timelineSec: readonly number[], spanStartSec: number, spanEndSec: number): { inside: number[]; outside: number } {
  const inside = timelineSec.filter((t) => t >= spanStartSec && t <= spanEndSec);
  return { inside, outside: timelineSec.length - inside.length };
}

export interface ClickPair {
  index: number;
  expectedPpqn: number;
  clickPpqn: number;
  audioErrorMs: number;
}

export interface ClickMatch {
  pairs: ClickPair[];
  clicksMissing: number[];
  clicksExtraPpqn: number[];
  anchorOffsetMs: number | null;
}

export function matchClicks(pattern: readonly PatternNote[], clickPpqn: readonly number[], bpm: number): ClickMatch {
  let unused = new Set<number>(clickPpqn.map((_, i) => i));
  let pairs: ClickPair[] = [];
  let clicksMissing: number[] = [];
  const take = (note: PatternNote, centrePpqn: number, windowPpqn: number): boolean => {
    let best: number | null = null;
    for (const i of unused) {
      const distance = Math.abs(clickPpqn[i] - centrePpqn);
      if (distance > windowPpqn) continue;
      if (best === null || distance < Math.abs(clickPpqn[best] - centrePpqn)) best = i;
    }
    if (best === null) {
      clicksMissing.push(note.index);
      return false;
    }
    unused.delete(best);
    pairs.push({ index: note.index, expectedPpqn: note.onPpqn, clickPpqn: clickPpqn[best], audioErrorMs: pulsesToMs(clickPpqn[best] - note.onPpqn, bpm) });
    return true;
  };
  for (const note of pattern) if (note.tag === "eighth") take(note, note.onPpqn, BEAT_PPQN / 4);
  const anchorOffsetMs = median(pairs.map((p) => p.audioErrorMs));
  if (anchorOffsetMs === null) {
    // No eighth click: nothing anchors the 1/32 bar, and an unanchored match would pair its clicks with the wrong notes.
    return { pairs: [], clicksMissing: pattern.map((n) => n.index), clicksExtraPpqn: [...clickPpqn], anchorOffsetMs: null };
  }
  const anchorPpqn = PPQN.secondsToPulses(anchorOffsetMs / 1000, bpm);
  // Second pass: with the anchor known, the eighths are matched around it, so a stray onset nearer the raw grid loses.
  unused = new Set<number>(clickPpqn.map((_, i) => i));
  pairs = [];
  clicksMissing = [];
  for (const note of pattern) if (note.tag === "eighth") take(note, note.onPpqn + anchorPpqn, BEAT_PPQN / 4);
  for (const note of pattern) if (note.tag === "thirtysecond") take(note, note.onPpqn + anchorPpqn, BEAT_PPQN / 16);
  pairs.sort((a, b) => a.index - b.index);
  clicksMissing.sort((a, b) => a - b);
  return { pairs, clicksMissing, clicksExtraPpqn: [...unused].map((i) => clickPpqn[i]), anchorOffsetMs };
}

export interface CombinedPair {
  index: number;
  midiRecordedPpqn: number;
  clickPpqn: number;
  /** Where the key landed minus where the sound landed. */
  partsApartMs: number;
}

export interface CombinedFigures {
  clicksFound: number;
  clicksMissing: number;
  clicksExtra: number;
  onsetsOutsideSpan: number;
  audioMedianMs: number | null;
  audioMaxAbsDevMs: number | null;
  pairs: number;
  partsApartMedianMs: number | null;
  partsApartMaxAbsDevMs: number | null;
  partsApartP5P95Ms: number | null;
  anchorOffsetMs: number | null;
}

const maxAbsDev = (values: readonly number[], centre: number | null): number | null =>
  centre === null || values.length === 0 ? null : Math.max(...values.map((v) => Math.abs(v - centre)));

export function measureCombined(
  match: ClickMatch,
  midiNotes: readonly MidiAuditNoteRow[],
  bpm: number,
  onsetsOutsideSpan: number,
): { figures: CombinedFigures; pairs: CombinedPair[] } {
  const midiByIndex = new Map(midiNotes.filter((n) => n.outcome === "matched" && n.recordedPpqn !== null).map((n) => [n.index, n]));
  const pairs: CombinedPair[] = [];
  for (const click of match.pairs) {
    const midi = midiByIndex.get(click.index);
    if (midi === undefined) continue;
    const midiRecordedPpqn = midi.recordedPpqn as number;
    pairs.push({ index: click.index, midiRecordedPpqn, clickPpqn: click.clickPpqn, partsApartMs: pulsesToMs(midiRecordedPpqn - click.clickPpqn, bpm) });
  }
  const audioErrors = match.pairs.map((p) => p.audioErrorMs);
  const apart = pairs.map((p) => p.partsApartMs);
  const audioMedianMs = median(audioErrors);
  const partsApartMedianMs = median(apart);
  const p5 = percentile(apart, 5);
  const p95 = percentile(apart, 95);
  return {
    figures: {
      clicksFound: match.pairs.length,
      clicksMissing: match.clicksMissing.length,
      clicksExtra: match.clicksExtraPpqn.length,
      onsetsOutsideSpan,
      audioMedianMs,
      audioMaxAbsDevMs: maxAbsDev(audioErrors, audioMedianMs),
      pairs: pairs.length,
      partsApartMedianMs,
      partsApartMaxAbsDevMs: maxAbsDev(apart, partsApartMedianMs),
      partsApartP5P95Ms: p5 === null || p95 === null ? null : p95 - p5,
      anchorOffsetMs: match.anchorOffsetMs,
    },
    pairs,
  };
}
