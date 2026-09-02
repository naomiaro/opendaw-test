import { describe, expect, it } from "vitest";
import { measureTakeAlignment, buildReferenceSchedule } from "./recordingAlignment";
import { matchGrid } from "../../../scripts/audit/recording-alignment/task7c-fix1-replay.ts";

// PR review (tests I3): the register's replay, regression and fencepost tables
// are computed by the offline replay's `matchGrid`, not by `measureTakeAlignment`.
// Mode "new" now delegates to the library; this pins that the two agree on every
// figure the tables quote (matched, missing, median, adjusted, matched indices)
// across the geometries the campaign exercised, so a later edit to the fence or
// tolerance cannot desynchronise the tables from the verdicts.
describe("task7c-fix1-replay matchGrid('new') parity with measureTakeAlignment", () => {
  const schedule = buildReferenceSchedule(0, 4, 0.25, 0.005);
  const cases: { name: string; bpm: number; regionStartSec: number; waveformOffsetSec: number; regionDurationSec: number; lowOnsets: number[]; biasSec: number }[] = [
    { name: "beat-aligned region, perfect capture", bpm: 120, regionStartSec: 0, waveformOffsetSec: 2.0, regionDurationSec: 4.0, lowOnsets: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => 2.0 + k * 0.5), biasSec: 0.023 },
    { name: "punch-in off the grid (4.045 s), content 30 ms late", bpm: 120, regionStartSec: 4.045, waveformOffsetSec: 0, regionDurationSec: 2.0, lowOnsets: [0.485, 0.985, 1.485, 1.985], biasSec: 0.023 },
    { name: "punch-in with an absent in-range beat", bpm: 120, regionStartSec: 4.045, waveformOffsetSec: 0, regionDurationSec: 2.0, lowOnsets: [0.955, 1.455, 1.955], biasSec: 0 },
    { name: "97.3 bpm, non-zero waveform offset (loop-wrap take)", bpm: 97.3, regionStartSec: 13 * (60 / 97.3), waveformOffsetSec: 3.2, regionDurationSec: 4 * (60 / 97.3), lowOnsets: [0, 1, 2, 3].map((k) => 3.2 + k * (60 / 97.3) + 0.011), biasSec: 0.023 },
    { name: "no onsets at all", bpm: 120, regionStartSec: 0, waveformOffsetSec: 0, regionDurationSec: 2.0, lowOnsets: [], biasSec: 0.023 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const lib = measureTakeAlignment({
        lowOnsets: c.lowOnsets, highOnsets: [], regionStartSec: c.regionStartSec, waveformOffsetSec: c.waveformOffsetSec,
        regionDurationSec: c.regionDurationSec, bufferDurationSec: 10, bpm: c.bpm, schedule,
        recordRequestContextTime: null, stopRequestContextTime: null, harnessPathBiasSec: c.biasSec,
      });
      const replay = matchGrid(c.lowOnsets, c.regionStartSec, c.waveformOffsetSec, c.regionDurationSec, c.bpm, "new", c.biasSec);
      expect(replay.matched).toBe(lib.matchedBeats);
      expect(replay.missing).toBe(lib.missingBeats);
      expect(replay.median).toBe(lib.medianBeatErrorMs);
      expect(replay.adjusted).toBe(lib.medianBeatErrorMsAdjusted);
      expect(replay.matchedIndices).toEqual(lib.beatErrors.map((e) => e.beat));
      expect(replay.expectedCount).toBe(lib.matchedBeats + lib.missingBeats);
      // Every expected index is either matched or reported unmatched, never both.
      expect(replay.unmatchedIndices.length).toBe(lib.missingBeats);
      expect(replay.unmatchedIndices.some((k) => replay.matchedIndices.includes(k))).toBe(false);
    });
  }
});
