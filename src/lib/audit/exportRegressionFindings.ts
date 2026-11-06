// Plain Node must load this file: the table script reads it, so no SDK value imports.
import type { ExportRow, InvariantId } from "./exportRegressionRows.ts";

export type KnownFinding = {
  name: string;
  invariant: InvariantId;
  note: string;
  applies: (row: ExportRow, pageRate: number) => boolean;
};

const oneFrameEarly = (invariant: InvariantId): KnownFinding => ({
  name: "one-frame-early-44100",
  invariant,
  note: "openDAW#530 comment: a looped section render at a 44.1 kHz page lands one frame early",
  applies: (row, pageRate) => pageRate === 44100 && row.path === "section-loop-twice" && row.seconds === 4
});

export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  oneFrameEarly("section-is-slice"),
  oneFrameEarly("impulse-on-reference"),
  {
    name: "setposition-cold-start",
    invariant: "samples-equal-reference",
    note: "a render started by setPosition with a Compressor on the chain differs from the same stretch of a step render",
    applies: (row) => row.path.startsWith("setposition-") && row.latencyCase.includes("compressor")
  },
  {
    name: "range-missing-tail",
    invariant: "section-is-slice",
    note: "a range that starts after the content has ended misses the reverb tail that the reference holds there",
    applies: (row) => row.group === "tail" && row.path === "section-marker"
  }
];

export const findingFor = (row: ExportRow, invariant: InvariantId, pageRate: number): KnownFinding | null =>
  KNOWN_FINDINGS.find((finding) => finding.invariant === invariant && finding.applies(row, pageRate)) ?? null;
