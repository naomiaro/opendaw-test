import { PPQN } from "@opendaw/lib-dsp";

export type AuditFamily =
  | "metronome"
  | "loop-wrap"
  | "seam"
  | "region-fencepost"
  | "note-onsets"
  | "automation"
  | "tempo-ramp"
  | "signature"
  | "transport-pos";

export const AUDIT_RATES = [44100, 48000, 88200, 96000] as const;
export const AUDIT_BPMS = [120, 90, 124, 133, 97.3] as const;

export const BAR_PPQN = PPQN.Quarter * 4; // 3840

// Scenario-specific constants derived from renderBars
const LOOP_WRAP_BARS = 2;
const LOOP_WRAP_PASSES = 8;

const SIGNATURE_BARS_3_4 = 2;
const SIGNATURE_BARS_4_4 = 5;

export interface AuditScenario {
  family: AuditFamily;
  renderBars: number;
  description: string;
}

export const AUDIT_SCENARIOS: Record<AuditFamily, AuditScenario> = {
  metronome: {
    family: "metronome",
    renderBars: 8,
    description: "8 bars, metronome click every quarter (32 quarters total)",
  },
  "loop-wrap": {
    family: "loop-wrap",
    renderBars: LOOP_WRAP_BARS * LOOP_WRAP_PASSES,
    description: "2-bar loop rendered 8 times (8 wraps), one note per wrap",
  },
  seam: {
    family: "seam",
    renderBars: 2,
    description:
      "2 bars, continuous tone split as two butt regions at bar 1 (continuity only, one origin onset)",
  },
  "region-fencepost": {
    family: "region-fencepost",
    renderBars: 4,
    description:
      "4 bars, click-train region starting at 7 sixteenths, clicks every quarter",
  },
  "note-onsets": {
    family: "note-onsets",
    renderBars: 4,
    description:
      "4 bars, synth notes at specific PPQN positions (mix of on-grid and off-grid)",
  },
  automation: {
    family: "automation",
    renderBars: 4,
    description:
      "4 bars, sustained tone gated by volume: ON at bar 0, OFF at bar 1, ON at bar 2, OFF at bar 2.5, ON at bar 3",
  },
  "tempo-ramp": {
    family: "tempo-ramp",
    renderBars: 8,
    description:
      "8 bars with linear tempo ramp from bpm to bpm*0.75, metronome quarters",
  },
  signature: {
    family: "signature",
    renderBars: SIGNATURE_BARS_3_4 + SIGNATURE_BARS_4_4,
    description:
      "7 mixed-meter bars: 2 bars of 3/4 then 5 bars of 4/4 (26 quarter onsets), metronome quarters",
  },
  "transport-pos": {
    family: "transport-pos",
    renderBars: 2,
    description:
      "2 bars rendered after setPosition to 5*960 + 240 PPQN (off-block), metronome quarters from next quarter boundary",
  },
};

/**
 * Expected audible event onsets in seconds from render start for a given family and BPM.
 * Each family defines its own onset schedule; most are metronome quarters at 60/bpm intervals.
 */
export function expectedOnsets(family: AuditFamily, bpm: number): number[] {
  const beat = 60 / bpm; // seconds per quarter

  switch (family) {
    case "metronome": {
      // 8 bars = 32 quarters, one click per quarter
      const quarters = AUDIT_SCENARIOS.metronome.renderBars * 4;
      const onsets: number[] = [];
      for (let k = 0; k < quarters; k++) {
        onsets.push(k * beat);
      }
      return onsets;
    }

    case "loop-wrap": {
      // 2-bar loop, 8 wraps (16 bars total), one note per wrap at loop start
      // Loop duration = LOOP_WRAP_BARS bars = LOOP_WRAP_BARS * 4 quarters
      const loopDuration = LOOP_WRAP_BARS * BAR_PPQN;
      const loopDurationSeconds = (loopDuration / PPQN.Quarter) * beat;
      const onsets: number[] = [];
      for (let n = 0; n < LOOP_WRAP_PASSES; n++) {
        onsets.push(n * loopDurationSeconds);
      }
      return onsets;
    }

    case "seam": {
      // Continuity family: single origin onset
      return [0];
    }

    case "region-fencepost": {
      // Region starts at 7 sixteenths = 7 * PPQN.Quarter / 4 PPQN
      // 4 bars = 4 * PPQN.Quarter = 3840 PPQN
      // Clicks every quarter starting from 7/4 quarter position
      // Click positions: 7/4, 11/4, 15/4 quarters (all within 4 bars)
      const startBeats = (7 * PPQN.Quarter) / 4 / PPQN.Quarter; // 1.75 beats
      const maxBeats = AUDIT_SCENARIOS["region-fencepost"].renderBars * 4; // 4 bars = 16 beats
      const onsets: number[] = [];
      for (let k = 0; k < maxBeats - startBeats; k++) {
        onsets.push((startBeats + k) * beat);
      }
      return onsets;
    }

    case "note-onsets": {
      // Notes at specific PPQN positions
      const positions = [0, 960, 1920, 2400, 3840, 5040, 7680, 9600, 11520, 13200];
      const onsets = positions.map((ppqn) => (ppqn / PPQN.Quarter) * beat);
      return onsets;
    }

    case "automation": {
      // Rising edges at bars 0, 2, 3
      // bar = 4 * beat seconds
      const barDuration = 4 * beat;
      return [0, 2 * barDuration, 3 * barDuration];
    }

    case "tempo-ramp": {
      // 8 bars = 32 quarters, tempo ramps from bpm to 0.75*bpm linearly
      // For beat i, tempo(i) = bpm * (1 - i/(K-1)) = bpm * (1 - i/31)
      // Actually, the brief says "tempo linear in *beat index*", so:
      // bpm(i) = bpm + (0.75*bpm - bpm) * (i/K) where K = total beats
      // bpm(i) = bpm * (1 - 0.25*i/K)
      // Time of beat i = sum_{j<i} 60/bpm(j)
      const K = AUDIT_SCENARIOS["tempo-ramp"].renderBars * 4; // renderBars = 8 beats
      const onsets: number[] = [];
      let currentTime = 0;
      for (let i = 0; i < K; i++) {
        onsets.push(currentTime);
        // Tempo at beat i
        const tempoAtBeat = bpm * (1 - (0.25 * i) / K);
        currentTime += 60 / tempoAtBeat;
      }
      return onsets;
    }

    case "signature": {
      // 7 mixed-meter bars: 2 bars of 3/4, then 5 bars of 4/4
      // Total quarters: SIGNATURE_BARS_3_4*3 + SIGNATURE_BARS_4_4*4 = 2*3 + 5*4 = 26 quarters
      const quarters = SIGNATURE_BARS_3_4 * 3 + SIGNATURE_BARS_4_4 * 4;
      const onsets: number[] = [];
      for (let k = 0; k < quarters; k++) {
        onsets.push(k * beat);
      }
      return onsets;
    }

    case "transport-pos": {
      // 2 bars rendered after setPosition to 5*960 + 240 PPQN
      // Next quarter boundary: 6*960 PPQN
      // Offset from render start: (6*960 - (5*960 + 240)) / 960 = 0.75 beats
      // Then every beat after: 0.75, 1.75, 2.75, ..., up to renderBars beats
      const startOffsetBeats = 0.75; // 3/4 beat after transport-pos
      const maxBeats = AUDIT_SCENARIOS["transport-pos"].renderBars * 4; // 2 bars
      const onsets: number[] = [];
      for (let k = 0; startOffsetBeats + k < maxBeats; k++) {
        onsets.push((startOffsetBeats + k) * beat);
      }
      return onsets;
    }
  }
}

/**
 * Expected downbeat indices in the onset list for families with time signatures.
 * Only "signature" family exports downbeat indices.
 * @param _family Type-only parameter to enforce caller passes "signature" (never used at runtime).
 */
export function expectedDownbeatIndices(_family: "signature"): number[] {
  // 7 mixed-meter bars: 2 bars of 3/4, then 5 bars of 4/4
  // Bar 0 (3/4): downbeat at index 0, beats 0-2 (indices 0, 1, 2)
  // Bar 1 (3/4): downbeat at index 3, beats 3-5 (indices 3, 4, 5)
  // Bar 2 (4/4): downbeat at index 6, beats 6-9 (indices 6, 7, 8, 9)
  // Bar 3 (4/4): downbeat at index 10, beats 10-13 (indices 10, 11, 12, 13)
  // Bar 4 (4/4): downbeat at index 14, beats 14-17 (indices 14, 15, 16, 17)
  // Bar 5 (4/4): downbeat at index 18, beats 18-21 (indices 18, 19, 20, 21)
  // Bar 6 (4/4): downbeat at index 22, beats 22-25 (indices 22, 23, 24, 25)
  return [0, 3, 6, 10, 14, 18, 22];
}
