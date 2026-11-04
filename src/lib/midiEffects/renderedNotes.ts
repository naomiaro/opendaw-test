/**
 * What the Rendered page draws from an offline render read back as notes: lane notes, velocity stems
 * and the spans the monophonic reader cannot read. Every value drawn solid (pitch, cents, velocity,
 * edges) comes from the render; the device rule is used only to window and mark: which read figure
 * answers which predicted note, which notes overlap, which are too short, too quiet or silenced.
 * The prediction applies EVERY known deviation of the enabled devices, the engine's variant, so its
 * windows and silences are the ones the render has (the audit's intent variant would predict full
 * velocity where an Arpeggio at −100 % is silent). Pure: the only SDK import is `PPQN`.
 */
import { PPQN } from "@opendaw/lib-dsp";
import type { LaneNote } from "@/components/NoteLane";
import type { Stem } from "@/components/VelocityStrip";
import type { NoteFigure } from "@/lib/audit/midiEffectSemanticsReader";
import {
  DEVIATIONS, clipToRange, composeRules, markReadability,
  type DeviceSetting, type DeviationName, type PredictedNote, type RuleContext, type RuleNote,
} from "@/lib/audit/midiEffectSemanticsRules";
import { TOLERANCES } from "@/lib/audit/midiEffectSemanticsVerdict";
import { REGION_START_PPQN, type Pattern } from "./patterns";

export interface ChainSetting { setting: DeviceSetting; enabled: boolean }

export interface Prediction { predicted: PredictedNote[]; silenced: RuleNote[] }

export type MarkOptions = Parameters<typeof markReadability>[2];

export interface UnreadableSpan {
  /** ppqn, region-local */
  readonly from: number;
  /** ppqn, region-local */
  readonly to: number;
  readonly reason: "polyphonic" | "overlap";
}

export interface RenderedRows {
  readonly notes: readonly LaneNote[];
  readonly stems: readonly Stem[];
  readonly ghosts: readonly Stem[];
  /** drawn as shaded spans on the lane */
  readonly unreadable: readonly UnreadableSpan[];
  readonly sentence: string | null;
}

/** How far a read onset may sit from a predicted readable onset and still answer it. */
export const MATCH_MS = 10;

export const OVERLAP_SENTENCE = "The reader reads one voice at a time: the notes in the shaded spans overlap. Use a one-voice pattern, or an Arpeggio with a gate under 100 %.";

/** A time from the render's start (the reader's figures) as region-local pulses; a float, the lane takes floats. */
export function msToRegionPpqn(ms: number, bpm: number): number {
  return PPQN.secondsToPulses(ms / 1000, bpm) - REGION_START_PPQN;
}

/** A rule note's span in the reader's milliseconds from the render's start. */
export function predictedMs(note: RuleNote, bpm: number): { onsetMs: number; endMs: number } {
  return {
    onsetMs: PPQN.pulsesToSeconds(note.position, bpm) * 1000,
    endMs: PPQN.pulsesToSeconds(note.position + note.duration, bpm) * 1000,
  };
}

/** The pattern through the enabled stages, with every known deviation of those stages, clipped to the render's range. */
export function predictChain(chain: readonly ChainSetting[], context: RuleContext, pattern: Pattern, bpm: number, mark: MarkOptions): Prediction {
  const stages = chain.filter((stage) => stage.enabled).map((stage) => stage.setting);
  const devices = new Set(stages.map((stage) => stage.device));
  const deviations = new Set<DeviationName>(DEVIATIONS.filter((d) => devices.has(d.device)).map((d) => d.name));
  const source: RuleNote[] = pattern.notes.map((note) => ({
    position: note.position + REGION_START_PPQN, duration: note.duration, pitch: note.pitch, cent: 0, velocity: note.velocity,
  }));
  const composed = clipToRange(composeRules(stages, context, deviations, source), context.range);
  return { predicted: markReadability(composed, bpm, mark), silenced: composed.filter((note) => note.velocity === 0) };
}

/** "+25¢" / "−3¢" (a true minus sign), rounded; none under the audit's cents tolerance, without a reading or for a figure that is not a number. */
function centsLabel(cents: number | null): string | undefined {
  if (cents === null || !Number.isFinite(cents) || Math.abs(cents) < TOLERANCES.cents) return undefined;
  const rounded = Math.round(cents);
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded)}¢`;
}

const regionSpan = (note: RuleNote): { from: number; to: number } =>
  ({ from: note.position - REGION_START_PPQN, to: note.position + note.duration - REGION_START_PPQN });

/** A note at its predicted span, outline only, with the reason it holds no reading. */
const hollowAt = (note: RuleNote, label: string): LaneNote => ({ pitch: note.pitch, ...regionSpan(note), hollow: true, label });

/** A velocity the reader could not turn into a number (a NaN peak) is drawn hollow, "unreadable", with no stem. */
const readableVelocity = (velocity: number): boolean => Number.isFinite(velocity);

/** A read figure drawn as what was read; `fallbackPitch` is the row a pitchless figure sits on. */
function readNote(figure: NoteFigure, fallbackPitch: number, bpm: number): LaneNote {
  const span = { from: msToRegionPpqn(figure.onsetMs, bpm), to: msToRegionPpqn(figure.endMs, bpm) };
  if (!readableVelocity(figure.velocity)) return { pitch: figure.pitch ?? fallbackPitch, ...span, hollow: true, label: "unreadable" };
  const base = { ...span, velocity: figure.velocity };
  if (figure.pitch === null) return { pitch: fallbackPitch, ...base, hollow: true, label: "no pitch" };
  const label = centsLabel(figure.cents);
  return { pitch: figure.pitch, ...base, ...(label === undefined ? {} : { label }) };
}

/** Polyphonic and overlapping notes as region-local spans, merged when they touch; a merged span holding any polyphony is polyphonic. */
function unreadableSpans(predicted: readonly PredictedNote[]): UnreadableSpan[] {
  const spans = predicted
    .filter((note): note is PredictedNote & { readability: UnreadableSpan["reason"] } =>
      note.readability === "polyphonic" || note.readability === "overlap")
    .map((note) => ({ ...regionSpan(note), reason: note.readability }))
    .sort((a, b) => a.from - b.from);
  const merged: UnreadableSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.from <= last.to) {
      merged[merged.length - 1] = {
        from: last.from,
        to: Math.max(last.to, span.to),
        reason: last.reason === "polyphonic" || span.reason === "polyphonic" ? "polyphonic" : "overlap",
      };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * The page's rows from the render's read figures and the chain's prediction.
 * A read figure whose onset lies within `TOLERANCES.onsetMs` of the predicted span of any predicted note that is not
 * `readable` (abutting, too-short, too-quiet, polyphonic, overlap) is that note's counterpart and is never drawn as an extra,
 * and a silenced note absorbs nothing.
 */
export function renderedRows(
  read: readonly NoteFigure[], prediction: Prediction, pattern: Pattern, bpm: number,
  readAt: (onsetMs: number, endMs: number) => NoteFigure,
): RenderedRows {
  const ghosts: Stem[] = pattern.notes.map((note) => ({ at: note.position, velocity: note.velocity }));
  const unreadable = unreadableSpans(prediction.predicted);
  const notes: LaneNote[] = [];
  const stems: Stem[] = [];
  const stem = (at: number, velocity: number): void => {
    if (readableVelocity(velocity)) stems.push({ at, velocity });
  };

  const inside = (figure: NoteFigure, note: PredictedNote): boolean => {
    const { onsetMs, endMs } = predictedMs(note, bpm);
    return figure.onsetMs >= onsetMs - TOLERANCES.onsetMs && figure.onsetMs <= endMs + TOLERANCES.onsetMs;
  };
  // owned figures leave before matching, so a figure inside a non-readable note's span is never a readable note's match
  const owners = prediction.predicted.filter((n) => n.readability !== "readable");
  const remaining = new Set(read.filter((figure) => !owners.some((note) => inside(figure, note))));

  for (const note of prediction.predicted) {
    if (note.readability !== "readable") continue;
    const { onsetMs } = predictedMs(note, bpm);
    let best: NoteFigure | null = null;
    for (const figure of remaining) {
      const distance = Math.abs(figure.onsetMs - onsetMs);
      if (distance <= MATCH_MS && (best === null || distance < Math.abs(best.onsetMs - onsetMs))) best = figure;
    }
    if (best === null) {
      notes.push(hollowAt(note, "silent"));
      continue;
    }
    remaining.delete(best);
    notes.push(readNote(best, note.pitch, bpm));
    stem(msToRegionPpqn(best.onsetMs, bpm), best.velocity);
  }

  for (const note of prediction.predicted) {
    if (note.readability === "abutting") {
      const { onsetMs, endMs } = predictedMs(note, bpm);
      const figure = readAt(onsetMs, endMs);
      if (!readableVelocity(figure.velocity)) {
        notes.push({ ...hollowAt(note, "unreadable"), dashedEdges: true });
        continue;
      }
      if (figure.pitch === null) {
        // nothing measured to draw: the predicted pitch only places the row
        notes.push({ ...hollowAt(note, "no pitch"), dashedEdges: true });
        continue;
      }
      const label = centsLabel(figure.cents);
      notes.push({
        pitch: figure.pitch, ...regionSpan(note), velocity: figure.velocity, dashedEdges: true,
        ...(label === undefined ? {} : { label }),
      });
      // the stem sits at the PREDICTED onset: the reader could not find this note's edges
      stem(note.position - REGION_START_PPQN, figure.velocity);
    } else if (note.readability === "too-short") {
      notes.push(hollowAt(note, "too short"));
    } else if (note.readability === "too-quiet") {
      notes.push(hollowAt(note, "too quiet"));
    }
  }

  for (const note of prediction.silenced) notes.push(hollowAt(note, "silent"));

  for (const figure of remaining) {
    notes.push(readNote(figure, 0, bpm));
    stem(msToRegionPpqn(figure.onsetMs, bpm), figure.velocity);
  }

  notes.sort((a, b) => a.from - b.from);
  stems.sort((a, b) => a.at - b.at);
  return { notes, stems, ghosts, unreadable, sentence: unreadable.length > 0 ? OVERLAP_SENTENCE : null };
}
