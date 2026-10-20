/**
 * The verdict of a combined MIDI + audio cell. `together` is the player's wish: key and
 * sound within a quantum. The band is the two recorders' known shapes computed from the
 * row's own figures: the MIDI recorder's late term minus whatever microphone latency the
 * SDK was not told about. Before any band, in either state, a row whose audio median disagrees
 * with the run's own calibration names the microphone path, not the SDK.
 */
import {
  clampJitterBoundMs, expectedLateMedianMs, LATE_MEDIAN_MARGIN_MS, quantumMs, type BandContext, type RepeatFigures,
} from "./midiInputAlignment";
import type { MidiScenario } from "./midiInputCalibration";
import type { InputLatencyState } from "./combinedClicks";
import type { CombinedFigures } from "./combinedAudio";

export type CombinedStatus = "together" | "matches-known-defect" | "investigate";

export interface CombinedContext extends BandContext {
  state: InputLatencyState;
  /** The run's calibration. */
  micRoundTripMs: number;
  micInputPartMs: number;
  inputLatencyAppliedMs: number;
}

/** Where the SDK should land the sound: the round trip less what the audio recorder subtracts — the output latency of
 *  THIS repeat, the compensation latency, and the field; an output-latency drift since the calibration therefore cancels. */
export function expectedAudioMs(ctx: CombinedContext): number {
  return ctx.micRoundTripMs - ctx.outputLatencyMs - ctx.compensationLatencyMs - ctx.inputLatencyAppliedMs;
}

/** Where the key lands relative to the sound on this machine, by the two recorders' rules. */
export function expectedPartsApartMs(ctx: CombinedContext): number {
  return expectedLateMedianMs(ctx) - expectedAudioMs(ctx);
}

export interface CombinedRepeatInput {
  midi: RepeatFigures;
  combined: CombinedFigures;
  context: CombinedContext | null;
}

const fmt = (value: number): string => String(Number(value.toFixed(2)));
const MIDI_INTEGRITY = ["missing", "receiptsMissing", "extra", "stuck", "velocityMismatches"] as const;

export function classifyCombinedCell(
  _scenario: MidiScenario,
  repeats: readonly CombinedRepeatInput[],
): { status: CombinedStatus; detail: string } {
  if (repeats.length === 0) return { status: "investigate", detail: "no repeats" };
  for (const [i, r] of repeats.entries()) {
    const on = ` on repeat ${i + 1}`;
    for (const key of MIDI_INTEGRITY) {
      if (r.midi[key] > 0) return { status: "investigate", detail: `${key} ${r.midi[key]}${on}` };
    }
    if (r.combined.clicksMissing > 0) return { status: "investigate", detail: `clicksMissing ${r.combined.clicksMissing}${on}` };
    if (r.combined.clicksExtra > 0) return { status: "investigate", detail: `clicksExtra ${r.combined.clicksExtra}${on}` };
    if (r.combined.pairs === 0 || r.combined.partsApartMedianMs === null || r.combined.partsApartMaxAbsDevMs === null) {
      return { status: "investigate", detail: `no pairs${on}` };
    }
  }
  const medians = repeats.map((r) => r.combined.partsApartMedianMs as number);
  const devs = repeats.map((r) => r.combined.partsApartMaxAbsDevMs as number);
  const contextless = repeats.findIndex((r) => r.context === null);
  if (contextless >= 0) {
    return { status: "investigate", detail: `no band context on repeat ${contextless + 1} (no frame interval or latency figure)` };
  }
  // Attribution first, in both states: an audio side off the run's own calibration by more than the band's
  // margin would break the band on its own, and that is the microphone path (or a drifted calibration), not the SDK.
  for (const [i, r] of repeats.entries()) {
    const ctx = r.context as CombinedContext;
    const expectedAudio = expectedAudioMs(ctx);
    if (r.combined.audioMedianMs !== null && Math.abs(r.combined.audioMedianMs - expectedAudio) > LATE_MEDIAN_MARGIN_MS) {
      return {
        status: "investigate",
        detail: `audio median ${fmt(r.combined.audioMedianMs)} ms disagrees with the calibration (expected ${fmt(expectedAudio)} ms from `
          + `round trip ${fmt(ctx.micRoundTripMs)} − output latency ${fmt(ctx.outputLatencyMs)} − applied ${fmt(ctx.inputLatencyAppliedMs)})`
          + ` on repeat ${i + 1} (the microphone path moved, not the SDK)`,
      };
    }
  }
  const jitterBound = (r: CombinedRepeatInput): number => clampJitterBoundMs(r.context as CombinedContext);
  const quantum = (r: CombinedRepeatInput): number => quantumMs((r.context as CombinedContext).sampleRate);
  if (repeats.every((r, i) => Math.abs(medians[i]) <= quantum(r) && devs[i] <= jitterBound(r))) {
    return { status: "together", detail: `parts within a quantum: medians ${medians.map(fmt).join(", ")} ms` };
  }
  const expected = repeats.map((r) => expectedPartsApartMs(r.context as CombinedContext));
  const inBand = repeats.every((r, i) =>
    Math.abs(medians[i] - expected[i]) <= LATE_MEDIAN_MARGIN_MS && devs[i] <= jitterBound(r));
  if (inBand) {
    return {
      status: "matches-known-defect",
      detail: `the two recorders' known shapes: medians ${medians.map(fmt).join(", ")} ms against expected ${expected.map(fmt).join(", ")} ms `
        + "(MIDI late by 2 × latency − a stale frame, audio late by the microphone latency the SDK was not told)",
    };
  }
  const offender = repeats.findIndex((r, i) => Math.abs(medians[i] - expected[i]) > LATE_MEDIAN_MARGIN_MS || devs[i] > jitterBound(r));
  return {
    status: "investigate",
    detail: `partsApartMedianMs ${fmt(medians[offender])} (expected ${fmt(expected[offender])} ± ${LATE_MEDIAN_MARGIN_MS}), max dev ${fmt(devs[offender])} on repeat ${offender + 1}`,
  };
}
