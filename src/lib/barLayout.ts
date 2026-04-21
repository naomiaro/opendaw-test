import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import type { Project } from "@opendaw/studio-core";

export type BarInfo = {
  readonly startPpqn: ppqn;
  readonly durationPpqn: ppqn;
  readonly nominator: number;
  readonly denominator: number;
  /** 1-based bar number (first bar is 1, not 0). */
  readonly barNumber: number;
};

/**
 * Read bar layout from the SDK after signature events have been committed.
 * Requires timelineBox.durationInPulses to be set (determines the end of the last section).
 * Uses signatureTrack.iterateAll() to get section boundaries (accumulatedPpqn),
 * then expands each section into individual bars.
 */
export function computeBarsFromSDK(project: Project): BarInfo[] {
  const signatureTrack = project.timelineBoxAdapter.signatureTrack;
  const totalPpqn = project.timelineBox.durationInPulses.getValue();
  const sections = Array.from(signatureTrack.iterateAll());
  const bars: BarInfo[] = [];
  let barNumber = 1;

  for (let s = 0; s < sections.length; s++) {
    const { accumulatedPpqn: sectionStart, nominator, denominator } = sections[s];
    const sectionEnd = (s + 1 < sections.length) ? sections[s + 1].accumulatedPpqn : totalPpqn;
    const barDuration = PPQN.fromSignature(nominator, denominator);

    for (let pos = sectionStart; pos < sectionEnd; pos += barDuration) {
      bars.push({
        startPpqn: pos as ppqn,
        durationPpqn: barDuration as ppqn,
        nominator,
        denominator,
        barNumber: barNumber++,
      });
    }
  }

  return bars;
}
