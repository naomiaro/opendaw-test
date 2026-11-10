// Plain Node must load this file: the rows and the findings read it, so no SDK value imports.
/**
 * Where the engine USED to put a pulse that falls inside a 128-frame block, written as it was written at the 0.0.183
 * tag, for a transport that started at 0 and has not jumped since: a block's start exact (a whole frame count from the
 * anchor, one division, `crates/transport/src/transport.rs:20-26`), a pulse inside the block converted from the block's
 * start pulse and truncated, so about half of the whole-frame starts landed a frame early (openDAW#536). 0.0.184 places
 * every such pulse on its frame (`dsp::ppqn::frame_at` from the block's anchor). The in-block rows still pick their
 * starts with this arithmetic, one it put early and one it put on time, so the rows and the register stay the same.
 */

const QUANTUM = 128;

// crates/transport/src/transport.rs:20, frames_to_pulses: one division
const framesToPulses = (frames: number, bpm: number, rate: number): number => (frames * bpm * 960) / (60 * rate);

/** The exact frame of a pulse, written as one division. */
export const exactFrame = (ppqn: number, bpm: number, rate: number): number => (ppqn * 60 * rate) / (960 * bpm);

const blockOf = (ppqn: number, bpm: number, rate: number): { start: number; p0: number; p1: number } => {
  const start = Math.floor(exactFrame(ppqn, bpm, rate) / QUANTUM) * QUANTUM;
  return { start, p0: framesToPulses(start, bpm, rate), p1: framesToPulses(start + QUANTUM, bpm, rate) };
};

/** A region's first frame as 0.0.183 placed it: `sample_of`, the block's share of the pulse, truncated (`audio_region_player.rs:974-976` at that tag). */
export const regionStartFrame = (ppqn: number, bpm: number, rate: number): number => {
  const { start, p0, p1 } = blockOf(ppqn, bpm, rate);
  return start + Math.trunc(QUANTUM * ((ppqn - p0) / (p1 - p0)));
};

/** Whether a pulse lands on a whole frame that is not a block's first. */
const isWholeMidBlock = (ppqn: number, bpm: number, rate: number): boolean => {
  const frame = exactFrame(ppqn, bpm, rate);
  return Math.abs(frame - Math.round(frame)) < 1e-9 && Math.round(frame) % QUANTUM !== 0;
};

/**
 * The first integer pulse at or after `seconds` that is a whole frame inside a block, and that 0.0.183's engine placed
 * one frame early (`early`) or on its frame. A row picks its region start with this: a pulse on a block's first
 * frame is exact by construction and proves nothing.
 */
export const regionStartPpqn = (seconds: number, bpm: number, rate: number, early: boolean): number => {
  const first = Math.ceil(seconds * 16 * bpm);
  if (!Number.isFinite(first)) throw new Error(`no ppqn for a start of ${seconds} s at ${bpm} bpm`);
  for (let ppqn = first; ppqn < first + 1e6; ppqn++) {
    if (!isWholeMidBlock(ppqn, bpm, rate)) continue;
    const offBy = regionStartFrame(ppqn, bpm, rate) - Math.round(exactFrame(ppqn, bpm, rate));
    if (offBy === (early ? -1 : 0)) return ppqn;
  }
  throw new Error(`no ${early ? "early" : "on-time"} region start after ${seconds} s at ${bpm} bpm and ${rate} Hz`);
};

/**
 * The first integer pulse at or after `seconds` on a whole frame `residue` frames into its block: 0 is a block's
 * first frame, the end of the block before it.
 */
export const ppqnAtBlockResidue = (seconds: number, bpm: number, rate: number, residue: number): number => {
  const first = Math.ceil(seconds * 16 * bpm);
  if (!Number.isFinite(first)) throw new Error(`no ppqn for ${seconds} s at ${bpm} bpm`);
  const wanted = ((residue % QUANTUM) + QUANTUM) % QUANTUM;
  for (let ppqn = first; ppqn < first + 1e6; ppqn++) {
    const frame = exactFrame(ppqn, bpm, rate);
    if (Math.abs(frame - Math.round(frame)) < 1e-9 && Math.round(frame) % QUANTUM === wanted) return ppqn;
  }
  throw new Error(`no ppqn on block residue ${residue} after ${seconds} s at ${bpm} bpm and ${rate} Hz`);
};
