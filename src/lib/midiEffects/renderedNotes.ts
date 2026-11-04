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

export interface RenderedNote extends LaneNote { readonly measured: boolean }

export interface UnreadableSpan {
  /** ppqn, region-local */
  readonly from: number;
  /** ppqn, region-local */
  readonly to: number;
  readonly reason: "polyphonic" | "overlap";
}

export interface RenderedRows { notes: RenderedNote[]; stems: Stem[]; ghosts: Stem[]; unreadable: UnreadableSpan[]; sentence: string | null }

/** How far a read onset may sit from a predicted readable onset and still answer it. */
export const MATCH_MS = 10;

export const OVERLAP_SENTENCE = "The reader reads one voice at a time: these notes overlap. Add an Arpeggio, or pick a one-voice pattern.";

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

/** "+25¢" / "−3¢" (a true minus sign), rounded; none under the audit's cents tolerance or without a reading. */
function centsLabel(cents: number | null): string | undefined {
  if (cents === null || Math.abs(cents) < TOLERANCES.cents) return undefined;
  const rounded = Math.round(cents);
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded)}¢`;
}

const regionSpan = (note: RuleNote): { from: number; to: number } =>
  ({ from: note.position - REGION_START_PPQN, to: note.position + note.duration - REGION_START_PPQN });

/** A note at its predicted span, outline only, with the reason it holds no reading. */
const hollowAt = (note: RuleNote, label: string): RenderedNote => ({ pitch: note.pitch, ...regionSpan(note), hollow: true, label, measured: false });

/** A read figure drawn as what was read; `fallbackPitch` is the row a pitchless figure sits on. */
function readNote(figure: NoteFigure, fallbackPitch: number, bpm: number): RenderedNote {
  const base = { from: msToRegionPpqn(figure.onsetMs, bpm), to: msToRegionPpqn(figure.endMs, bpm), velocity: figure.velocity, measured: true };
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
 * The page's rows from the render's read figures and the chain's prediction. A figure whose onset lies in the predicted span
 * (± the audit's onset tolerance) of a note that is not `readable` belongs to that note, as in the audit's judge: inside a
 * polyphonic or overlapping span it is a blob, not a note, and is dropped; inside an abutting, too-short or too-quiet note it
 * is that note's own reading and is not drawn a second time. A silenced note owns nothing: a figure there is drawn.
 */
export function renderedRows(
  read: readonly NoteFigure[], prediction: Prediction, pattern: Pattern, bpm: number,
  readAt: (onsetMs: number, endMs: number) => NoteFigure,
): RenderedRows {
  const ghosts: Stem[] = pattern.notes.map((note) => ({ at: note.position, velocity: note.velocity }));
  const unreadable = unreadableSpans(prediction.predicted);
  const notes: RenderedNote[] = [];
  const stems: Stem[] = [];

  const inside = (figure: NoteFigure, note: PredictedNote): boolean => {
    const { onsetMs, endMs } = predictedMs(note, bpm);
    return figure.onsetMs >= onsetMs - TOLERANCES.onsetMs && figure.onsetMs <= endMs + TOLERANCES.onsetMs;
  };
  const unreadableNotes = prediction.predicted.filter((n) => n.readability === "polyphonic" || n.readability === "overlap");
  const remaining = new Set(read.filter((figure) => !unreadableNotes.some((note) => inside(figure, note))));

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
    stems.push({ at: msToRegionPpqn(best.onsetMs, bpm), velocity: best.velocity });
  }

  for (const note of prediction.predicted) {
    if (note.readability === "abutting") {
      const { onsetMs, endMs } = predictedMs(note, bpm);
      const figure = readAt(onsetMs, endMs);
      const label = centsLabel(figure.cents);
      notes.push({
        pitch: figure.pitch ?? note.pitch, ...regionSpan(note), velocity: figure.velocity, dashedEdges: true, measured: false,
        ...(label === undefined ? {} : { label }),
      });
      stems.push({ at: note.position - REGION_START_PPQN, velocity: figure.velocity });
    } else if (note.readability === "too-short") {
      notes.push(hollowAt(note, "too short"));
    } else if (note.readability === "too-quiet") {
      notes.push(hollowAt(note, "too quiet"));
    }
  }

  for (const note of prediction.silenced) notes.push(hollowAt(note, "silent"));

  const owned = prediction.predicted.filter((n) => n.readability !== "readable");
  for (const figure of remaining) {
    if (owned.some((note) => inside(figure, note))) continue;
    notes.push(readNote(figure, 0, bpm));
    stems.push({ at: msToRegionPpqn(figure.onsetMs, bpm), velocity: figure.velocity });
  }

  notes.sort((a, b) => a.from - b.from);
  stems.sort((a, b) => a.at - b.at);
  return { notes, stems, ghosts, unreadable, sentence: unreadable.length > 0 ? OVERLAP_SENTENCE : null };
}
