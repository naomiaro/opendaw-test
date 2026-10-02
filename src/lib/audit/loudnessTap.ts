/**
 * What a loudness audit case captures: the engine's output, summarized by a tap worklet,
 * and the meter's readings. The tap is how the harness knows what the meter was fed.
 * No SDK or DOM code: the processor is text, and the rest runs in Node.
 */

export const LOUDNESS_TAP_PROCESSOR = "loudness-output-tap";
export const LOUDNESS_TAP_QUANTUM_FRAMES = 128;
/** Render quanta per posted chunk: 1024 frames, about 21 ms at 48 kHz. */
export const LOUDNESS_TAP_CHUNK_QUANTA = 8;
export const LOUDNESS_TAP_CHUNK_FRAMES = LOUDNESS_TAP_QUANTUM_FRAMES * LOUDNESS_TAP_CHUNK_QUANTA;
/** A chunk whose highest sample is at or below this is silence (-100 dBFS). */
export const LOUDNESS_TAP_QUIET = 1e-5;

/** One chunk of output as the worklet posts it: [left, right] sums of squares and highest samples. */
export interface TapStats {
  frame: number;
  frames: number;
  sumSquares: [number, number];
  peak: [number, number];
}

/** A chunk with the main-thread time it arrived, which is after its last frame was rendered. */
export interface TapChunk extends TapStats {
  atMs: number;
}

/** One reading of the engine's loudness stream, with the main-thread time it arrived. */
export interface LoudnessReading {
  atMs: number;
  momentary: number;
  shortTerm: number;
  integrated: number;
  range: number;
  peak: number;
}

export interface CaseCapture {
  readings: LoudnessReading[];
  chunks: TapChunk[];
  /** The tab was hidden at some point, so readings may be missing. */
  hidden: boolean;
}

/**
 * The tap, as the text of an AudioWorklet module. It writes nothing to its output, so
 * connecting it to the destination keeps it running and plays silence. A mono input is
 * counted on both channels; no input at all is counted as silence.
 */
export const LOUDNESS_TAP_PROCESSOR_SOURCE = `
class LoudnessOutputTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkQuanta = options.processorOptions.chunkQuanta;
    this.begin();
  }
  begin() {
    this.frame = -1;
    this.frames = 0;
    this.quanta = 0;
    this.sumSquares = [0, 0];
    this.peak = [0, 0];
  }
  process(inputs) {
    if (this.frame < 0) this.frame = currentFrame;
    const input = inputs[0];
    const channels = input.length === 0 ? [] : [input[0], input.length > 1 ? input[1] : input[0]];
    for (let channel = 0; channel < channels.length; channel++) {
      const samples = channels[channel];
      let sum = 0;
      let peak = this.peak[channel];
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i];
        sum += value * value;
        const magnitude = value < 0 ? -value : value;
        if (magnitude > peak) peak = magnitude;
      }
      this.sumSquares[channel] += sum;
      this.peak[channel] = peak;
    }
    this.frames += ${LOUDNESS_TAP_QUANTUM_FRAMES};
    this.quanta++;
    if (this.quanta === this.chunkQuanta) {
      this.port.postMessage({ frame: this.frame, frames: this.frames, sumSquares: this.sumSquares, peak: this.peak });
      this.begin();
    }
    return true;
  }
}
registerProcessor("${LOUDNESS_TAP_PROCESSOR}", LoudnessOutputTap);
`;

/**
 * The chunks the tap would post for a signal: the same arithmetic as the processor, for
 * tests. Whole chunks only. `atMs` is the time the chunk's last frame was rendered.
 */
export function chunksFromSignal(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  startFrame: number = 0
): TapChunk[] {
  const chunks: TapChunk[] = [];
  for (let offset = 0; offset + LOUDNESS_TAP_CHUNK_FRAMES <= left.length; offset += LOUDNESS_TAP_CHUNK_FRAMES) {
    const sumSquares: [number, number] = [0, 0];
    const peak: [number, number] = [0, 0];
    [left, right].forEach((channel, index) => {
      for (let quantum = 0; quantum < LOUDNESS_TAP_CHUNK_QUANTA; quantum++) {
        let sum = 0;
        for (let i = 0; i < LOUDNESS_TAP_QUANTUM_FRAMES; i++) {
          const value = channel[offset + quantum * LOUDNESS_TAP_QUANTUM_FRAMES + i];
          sum += value * value;
          peak[index] = Math.max(peak[index], Math.abs(value));
        }
        sumSquares[index] += sum;
      }
    });
    const frame = startFrame + offset;
    chunks.push({
      frame,
      frames: LOUDNESS_TAP_CHUNK_FRAMES,
      sumSquares,
      peak,
      atMs: ((frame + LOUDNESS_TAP_CHUNK_FRAMES) / sampleRate) * 1000,
    });
  }
  return chunks;
}

/** Where the signal sat in the output. Frames are exact to a chunk; times are chunk arrivals. */
export interface SignalSpan {
  startFrame: number;
  endFrame: number;
  startMs: number;
  endMs: number;
}

/** From the first loud chunk to the first quiet chunk after it. Null until both have been seen. */
export function signalSpan(chunks: readonly TapChunk[], quiet: number = LOUDNESS_TAP_QUIET): SignalSpan | null {
  const loud = (chunk: TapChunk) => Math.max(chunk.peak[0], chunk.peak[1]) > quiet;
  const first = chunks.findIndex(loud);
  if (first < 0) return null;
  for (let index = first + 1; index < chunks.length; index++) {
    if (!loud(chunks[index])) {
      return {
        startFrame: chunks[first].frame,
        endFrame: chunks[index].frame,
        startMs: chunks[first].atMs,
        endMs: chunks[index].atMs,
      };
    }
  }
  return null;
}

function wholeChunksIn(chunks: readonly TapChunk[], fromFrame: number, toFrame: number): TapChunk[] {
  return chunks.filter((chunk) => chunk.frame >= fromFrame && chunk.frame + chunk.frames <= toFrame);
}

/**
 * Each channel's level over the whole chunks inside [fromFrame, toFrame), stated as the
 * peak of a sine with that RMS, in dBFS. Null when no whole chunk lies inside.
 */
export function deliveredLevelDb(
  chunks: readonly TapChunk[],
  fromFrame: number,
  toFrame: number
): [number, number] | null {
  const inside = wholeChunksIn(chunks, fromFrame, toFrame);
  if (inside.length === 0) return null;
  const frames = inside.reduce((sum, chunk) => sum + chunk.frames, 0);
  const level = (channel: 0 | 1): number => {
    const meanSquare = inside.reduce((sum, chunk) => sum + chunk.sumSquares[channel], 0) / frames;
    return meanSquare > 0 ? 10 * Math.log10(2 * meanSquare) : -Infinity;
  };
  return [level(0), level(1)];
}

/** The highest sample on either channel over the whole chunks inside [fromFrame, toFrame), in dBFS. */
export function deliveredPeakDb(chunks: readonly TapChunk[], fromFrame: number, toFrame: number): number | null {
  const inside = wholeChunksIn(chunks, fromFrame, toFrame);
  if (inside.length === 0) return null;
  const peak = inside.reduce((highest, chunk) => Math.max(highest, chunk.peak[0], chunk.peak[1]), 0);
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
