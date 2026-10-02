import { describe, it, expect } from "vitest";
import { synthesize, type ToneSegment } from "./loudnessSignals";
import {
  LOUDNESS_TAP_CHUNK_QUANTA,
  LOUDNESS_TAP_PROCESSOR_SOURCE,
  chunksFromSignal,
  deliveredLevelDb,
  deliveredPeakDb,
  isUnfilledReading,
  signalSpan,
  type TapStats,
} from "./loudnessTap";

const RATE = 48000;
const LEAD = 4096;
const TAIL = 8192;
const tone = (levelDb: number, seconds = 2): ToneSegment[] => [
  { seconds, levelDb, frequency: { hz: 1000 }, phaseDeg: 0 },
];

/** Silence, the signal, silence. */
function padded(signal: Float32Array): Float32Array {
  const out = new Float32Array(LEAD + signal.length + TAIL);
  out.set(signal, LEAD);
  return out;
}

/** Runs the worklet source in Node, one render quantum at a time, and returns what it posted. */
function runProcessor(channels: Float32Array[]): TapStats[] {
  const posted: TapStats[] = [];
  const clock = { frame: 0 };
  class FakeProcessor {
    port = { postMessage: (message: TapStats) => posted.push(structuredClone(message)) };
  }
  type Processor = { process(inputs: Float32Array[][]): boolean };
  const holder: { create: (new (options: unknown) => Processor) | null } = { create: null };
  new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "clock",
    LOUDNESS_TAP_PROCESSOR_SOURCE.replaceAll("currentFrame", "clock.frame")
  )(FakeProcessor, (_name: string, create: new (options: unknown) => Processor) => (holder.create = create), clock);
  if (holder.create === null) throw new Error("the source registered no processor");
  const processor = new holder.create({ processorOptions: { chunkQuanta: LOUDNESS_TAP_CHUNK_QUANTA } });
  const length = channels.length === 0 ? 128 * LOUDNESS_TAP_CHUNK_QUANTA : channels[0].length;
  for (let frame = 0; frame + 128 <= length; frame += 128) {
    clock.frame = frame;
    processor.process([channels.map((channel) => channel.subarray(frame, frame + 128))]);
  }
  return posted;
}

describe("signalSpan", () => {
  it("runs from the first loud chunk to the first quiet one after it", () => {
    const signal = padded(synthesize(tone(-23), RATE));
    const span = signalSpan(chunksFromSignal(signal, signal, RATE));
    // The tone covers frames 4096..100096; 100096 falls inside the chunk that starts at 99328.
    expect(span).toEqual({
      startFrame: 4096,
      endFrame: 100352,
      startMs: (5120 / RATE) * 1000,
      endMs: (101376 / RATE) * 1000,
    });
  });
  it("sees a tone at -72 dBFS", () => {
    const signal = padded(synthesize(tone(-72), RATE));
    expect(signalSpan(chunksFromSignal(signal, signal, RATE))?.startFrame).toBe(4096);
  });
  it("is null while the output is silent", () => {
    const silence = new Float32Array(RATE);
    expect(signalSpan(chunksFromSignal(silence, silence, RATE))).toBeNull();
  });
  it("is null until the signal has ended", () => {
    const signal = synthesize(tone(-23), RATE);
    expect(signalSpan(chunksFromSignal(signal, signal, RATE))).toBeNull();
  });
});

describe("deliveredLevelDb", () => {
  it("states each channel's level as the sine's peak", () => {
    const left = padded(synthesize(tone(-23), RATE));
    const right = padded(synthesize(tone(-26), RATE));
    const level = deliveredLevelDb(chunksFromSignal(left, right, RATE), LEAD + 4800, LEAD + 96000 - 4800);
    expect(level?.[0]).toBeCloseTo(-23, 2);
    expect(level?.[1]).toBeCloseTo(-26, 2);
  });
  it("is null when the range holds no whole chunk", () => {
    const signal = padded(synthesize(tone(-23), RATE));
    expect(deliveredLevelDb(chunksFromSignal(signal, signal, RATE), 5000, 5500)).toBeNull();
  });
});

describe("deliveredPeakDb", () => {
  it("is the highest sample, not the tone's crest", () => {
    const signal = padded(
      synthesize([{ seconds: 2, levelDb: 20 * Math.log10(0.5), frequency: { rateDivisor: 4 }, phaseDeg: 45 }], RATE)
    );
    const peak = deliveredPeakDb(chunksFromSignal(signal, signal, RATE), LEAD + 4800, LEAD + 96000 - 4800);
    expect(peak).toBeCloseTo(-9.031, 2);
  });
});

describe("the worklet processor", () => {
  it("posts what chunksFromSignal computes", () => {
    const left = synthesize(tone(-23), RATE);
    const right = synthesize(tone(-26), RATE);
    const posted = runProcessor([left, right]);
    const expected = chunksFromSignal(left, right, RATE);
    expect(posted.length).toBe(expected.length);
    posted.forEach((stats, index) => {
      expect(stats.frame).toBe(expected[index].frame);
      expect(stats.frames).toBe(1024);
      expect(stats.sumSquares[0]).toBeCloseTo(expected[index].sumSquares[0], 9);
      expect(stats.sumSquares[1]).toBeCloseTo(expected[index].sumSquares[1], 9);
      expect(stats.peak).toEqual(expected[index].peak);
    });
  });
  it("mirrors a mono input onto both channels", () => {
    const left = synthesize(tone(-23), RATE);
    const posted = runProcessor([left]);
    expect(posted[3].sumSquares[1]).toBe(posted[3].sumSquares[0]);
    expect(posted[3].peak[1]).toBeGreaterThan(0);
  });
  it("stops when it is told to over its port", () => {
    const posted: TapStats[] = [];
    class FakeProcessor {
      port: { postMessage: (message: TapStats) => void; onmessage: (() => void) | null } = {
        postMessage: (message) => posted.push(message),
        onmessage: null,
      };
    }
    type Processor = FakeProcessor & { process(inputs: Float32Array[][]): boolean };
    const holder: { create: (new (options: unknown) => Processor) | null } = { create: null };
    new Function("AudioWorkletProcessor", "registerProcessor", "currentFrame", LOUDNESS_TAP_PROCESSOR_SOURCE)(
      FakeProcessor,
      (_name: string, create: new (options: unknown) => Processor) => (holder.create = create),
      0
    );
    if (holder.create === null) throw new Error("the source registered no processor");
    const processor = new holder.create({ processorOptions: { chunkQuanta: LOUDNESS_TAP_CHUNK_QUANTA } });
    expect(processor.process([[]])).toBe(true);
    processor.port.onmessage?.();
    expect(processor.process([[]])).toBe(false);
  });
  it("counts frames when nothing is connected", () => {
    const posted = runProcessor([]);
    expect(posted).toEqual([{ frame: 0, frames: 1024, sumSquares: [0, 0], peak: [0, 0] }]);
  });
});

describe("isUnfilledReading", () => {
  const reading = (momentary: number, shortTerm: number, integrated: number, range: number, peak: number) => ({
    atMs: 0,
    momentary,
    shortTerm,
    integrated,
    range,
    peak,
  });
  it("is true for the stream's array before the meter has filled it", () => {
    expect(isUnfilledReading(reading(0, 0, 0, 0, 0))).toBe(true);
  });
  it("is false for an empty meter, which reads -120 with a range of 0", () => {
    expect(isUnfilledReading(reading(-120, -120, -120, 0, -120))).toBe(false);
  });
  it("is false for a meter that kept an earlier measurement", () => {
    expect(isUnfilledReading(reading(-120, -120, -23.27, 4.2, -23))).toBe(false);
  });
  it("is false when only some values are zero", () => {
    expect(isUnfilledReading(reading(0, 0, 0, 0, -6))).toBe(false);
  });
});
