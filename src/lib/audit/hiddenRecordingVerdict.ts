/**
 * Verdicts for a take recorded while the page was hidden or its main thread blocked
 * (`recording-hidden-window-debug-demo.html`), pure over the figures the page reads.
 * Register: `debug/2026-10-21-hidden-page-recording/note.md`.
 */

/** The stop request is issued at a position read up to a frame old and lands on a quantum. */
export const DURATION_TOLERANCE_MS = 50;

export interface PositionSample {
  atMs: number;
  positionPpqn: number;
  recording: boolean;
}

/** The longest span between consecutive samples taken while recording with the position unchanged. */
export function positionFrozenMs(samples: readonly PositionSample[]): number {
  let longest = 0;
  let runStart: number | null = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.recording && b.recording && a.positionPpqn === b.positionPpqn) {
      runStart ??= a.atMs;
      longest = Math.max(longest, b.atMs - runStart);
    } else {
      runStart = null;
    }
  }
  return longest;
}

/** From `visibleAtMs` to the first later sample whose position differs from the last sample before it. */
export function syncResumeMs(samples: readonly PositionSample[], visibleAtMs: number): number | null {
  const before = [...samples].reverse().find((s) => s.atMs < visibleAtMs);
  if (before === undefined) return null;
  const moved = samples.find((s) => s.atMs >= visibleAtMs && s.positionPpqn !== before.positionPpqn);
  return moved === undefined ? null : moved.atMs - visibleAtMs;
}

export function frameBlockedMs(gaps: { maxGapMs: number | null }): number {
  return gaps.maxGapMs ?? 0;
}

export interface TakeFigures {
  appeared: boolean;
  finalized: boolean;
  finalizeMs: number | null;
  regionDurationSec: number | null;
  expectedDurationSec: number;
  beatsMatched: number;
  beatsMissing: number;
  medianBeatErrorMs: number | null;
  alignedToleranceMs: number;
}

export type TakeVerdict = "intact" | "not-finalized" | "audio-damaged" | "session-stuck";

export function classifyTake(f: TakeFigures): { verdict: TakeVerdict; detail: string } {
  if (!f.appeared) return { verdict: "not-finalized", detail: "no take appeared" };
  if (!f.finalized) return { verdict: "not-finalized", detail: "the take's file never finished loading" };
  if (f.beatsMissing > 0) return { verdict: "audio-damaged", detail: `${f.beatsMissing} beats missing of ${f.beatsMatched + f.beatsMissing}` };
  if (f.regionDurationSec === null) return { verdict: "audio-damaged", detail: "no region length" };
  const offMs = (f.regionDurationSec - f.expectedDurationSec) * 1000;
  if (Math.abs(offMs) > DURATION_TOLERANCE_MS) {
    return { verdict: "audio-damaged", detail: `region ${f.regionDurationSec.toFixed(3)} s, expected ${f.expectedDurationSec.toFixed(3)} s (${offMs >= 0 ? "+" : ""}${offMs.toFixed(1)} ms)` };
  }
  if (f.medianBeatErrorMs === null) return { verdict: "audio-damaged", detail: "no beat matched" };
  if (Math.abs(f.medianBeatErrorMs) > f.alignedToleranceMs) {
    return { verdict: "audio-damaged", detail: `median beat error ${f.medianBeatErrorMs.toFixed(2)} ms past ${f.alignedToleranceMs} ms` };
  }
  return { verdict: "intact", detail: `finalized in ${f.finalizeMs === null ? "?" : f.finalizeMs.toFixed(0)} ms, ${f.beatsMatched} beats, median ${f.medianBeatErrorMs.toFixed(2)} ms` };
}

export interface RowInput {
  interrupt: "cover" | "modal";
  hiddenSpanMs: number | null;
  take1: TakeFigures;
  take2: TakeFigures | null;
  take2Started: boolean;
}

export function classifyRow(input: RowInput): { take1: TakeVerdict | "not-hidden"; take2: TakeVerdict | null; detail: string } {
  const first = classifyTake(input.take1);
  const take1: TakeVerdict | "not-hidden" = input.interrupt === "cover" && input.hiddenSpanMs === null ? "not-hidden" : first.verdict;
  let take2: TakeVerdict | null = null;
  let second = "";
  if (!input.take2Started) {
    take2 = "session-stuck";
    second = "take 2 never started";
  } else if (input.take2 !== null) {
    const c = classifyTake(input.take2);
    take2 = c.verdict;
    second = c.detail;
  }
  const detail = take1 === "not-hidden"
    ? `the page never became hidden; take 1 on its own: ${first.verdict} (${first.detail}); take 2: ${second}`
    : `take 1: ${first.detail}; take 2: ${second}`;
  return { take1, take2, detail };
}
