import { describe, expect, it } from "vitest";
import { CALIBRATION_PROCESSOR, CALIBRATION_PROCESSOR_SOURCE, measureMicRoundTrip, roundTripsFrom, summarizeRoundTrips } from "./combinedCalibration";

const rate = 44100;
const synth = (delays: Array<number | null>, noise = 0.001) => {
  const lead = rate, gap = rate;
  const input = new Float32Array(lead + delays.length * gap + rate / 2);
  for (let i = 0; i < input.length; i++) input[i] = (Math.random() * 2 - 1) * noise;
  const emitFrames = delays.map((_, i) => lead + i * gap);
  delays.forEach((d, i) => {
    if (d === null) return;
    const at = emitFrames[i] + d;
    for (let k = 0; k < 353; k++) input[at + k] += 0.5 * Math.sin((2 * Math.PI * 6000 * k) / rate);
  });
  return { sampleRate: rate, input, emitFrames };
};

describe("roundTripsFrom", () => {
  it("finds each click after its emit frame and reports the round trip in ms", () => {
    const trips = roundTripsFrom(synth([2822, 2822, 2822])); // 64 ms
    expect(trips.map((t) => t.roundTripMs!).every((ms) => Math.abs(ms - 64) < 4)).toBe(true); // the detector's hop is 1.45 ms at 44.1 kHz
    expect(trips.every((t) => (t.peakOverFloorDb ?? 0) > 20)).toBe(true);
  });
  it("takes the onset of the click itself, not a noise rise earlier in the search window", () => {
    const capture = synth([2822, 2822, 2822]);
    // a rise of a quarter of the click's level 20 ms before the second click, inside its search window
    const at = capture.emitFrames[1] + 2822 - Math.round(0.02 * rate);
    for (let k = 0; k < 353; k++) capture.input[at + k] += 0.12 * Math.sin((2 * Math.PI * 6000 * k) / rate);
    const trips = roundTripsFrom(capture);
    expect(Math.abs((trips[1].roundTripMs as number) - 64)).toBeLessThan(4);
  });
  it("reports a click it cannot find as null instead of taking noise", () => {
    const trips = roundTripsFrom(synth([2822, null, 2822]));
    expect(trips.map((t) => t.detectFrame === null)).toEqual([false, true, false]);
  });
});

describe("summarizeRoundTrips", () => {
  const trip = (ms: number | null) => ({ emitFrame: 0, detectFrame: ms === null ? null : 1, roundTripMs: ms, peakOverFloorDb: ms === null ? 3 : 30 });
  it("takes the median and the spread and the input part past the output latency", () => {
    const r = summarizeRoundTrips([trip(63.9), trip(64.7), trip(64.4)], 23, -60, -20);
    expect(r).toMatchObject({ roundTripMs: 64.4, clicksFound: 3 });
    expect((r as { roundTripSpreadMs: number }).roundTripSpreadMs).toBeCloseTo(0.8, 6);
    expect((r as { inputPartMs: number }).inputPartMs).toBeCloseTo(41.4, 6);
  });
  it("refuses a spread wider than the band's margin and a negative input part", () => {
    expect(summarizeRoundTrips([trip(60), trip(64), trip(76)], 23, -60, -20)).toMatchObject({ error: expect.stringMatching(/spread 16/) });
    expect(summarizeRoundTrips([trip(20), trip(20.1), trip(20.2)], 23, -60, -20)).toMatchObject({ error: expect.stringMatching(/input part -2.9/) });
  });
  it("refuses with the floor and the peak when a click was not found", () => {
    expect(summarizeRoundTrips([trip(64), trip(null), trip(64)], 23, -60, -58)).toMatchObject({ error: expect.stringMatching(/2 of 3.*-60.*-58/s) });
  });
});

describe("the processor source", () => {
  it("never reads the worklet clock", () => {
    expect(CALIBRATION_PROCESSOR_SOURCE).not.toMatch(/currentTime|currentFrame/);
    expect(CALIBRATION_PROCESSOR_SOURCE).toContain("registerProcessor(");
  });
});

/** Runs the worklet processor source in Node with stub globals; `process` is driven by the test. */
function instantiateProcessor(sampleRate: number, options: Record<string, number>) {
  const registry = new Map<string, new (o: { processorOptions: Record<string, number> }) => { process(i: Float32Array[][], o: Float32Array[][]): boolean; port: { onmessage: ((e: { data: unknown }) => void) | null } }>();
  class AudioWorkletProcessor {
    port = { posted: [] as unknown[], onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(data: unknown) { this.posted.push(data); } };
  }
  const registerProcessor = (name: string, ctor: never) => registry.set(name, ctor);
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", CALIBRATION_PROCESSOR_SOURCE)(AudioWorkletProcessor, registerProcessor, sampleRate);
  const Ctor = registry.get(CALIBRATION_PROCESSOR)!;
  return new Ctor({ processorOptions: options }) as unknown as { process(i: Float32Array[][], o: Float32Array[][]): boolean; port: { posted: unknown[] } };
}

describe("the processor, executed", () => {
  it("emits its clicks on quantum boundaries, records its input by its own frame counter, and posts the capture once full", () => {
    const rate = 44100;
    const lead = rate, gap = rate, tail = rate / 2;
    const proc = instantiateProcessor(rate, { lead, gap, tail, clicks: 3, clickFrames: 353, clickHz: 6000, gain: 0.5 });
    const echoFrames = 2822; // 64 ms round trip: the output comes back on the input that much later
    const fifo: number[] = new Array(echoFrames).fill(0);
    let calls = 0;
    let running = true;
    while (running && calls < 10_000) {
      const input = new Float32Array(128);
      for (let i = 0; i < 128; i++) input[i] = fifo.shift() as number;
      const output = new Float32Array(128);
      running = proc.process([[input]], [[output]]);
      for (let i = 0; i < 128; i++) fifo.push(output[i]);
      calls++;
    }
    expect(running).toBe(false);
    expect(proc.port.posted.length).toBe(1);
    const capture = proc.port.posted[0] as { input: Float32Array; emitFrames: number[]; sampleRate: number };
    expect(capture.sampleRate).toBe(rate);
    expect(capture.emitFrames.every((f) => f % 128 === 0)).toBe(true);
    expect(capture.input.length).toBe(lead + 3 * gap + tail);
    const trips = roundTripsFrom(capture);
    expect(trips.map((t) => t.roundTripMs)).toHaveLength(3);
    expect(trips.every((t) => t.roundTripMs !== null && Math.abs(t.roundTripMs - (echoFrames / rate) * 1000) < 4)).toBe(true);
  });
});

describe("measureMicRoundTrip", () => {
  it("reads the output latency after the capture has run, not before, and disconnects its node", async () => {
    const rate = 44100;
    let outputLatency = 0.031; // what Chrome reports before output has started
    const connected: unknown[] = [];
    const disconnected: unknown[] = [];
    class FakeNode {
      port: { onmessage: ((e: { data: unknown }) => void) | null } = { onmessage: null };
      connect(target: unknown) { connected.push(target); }
      disconnect() { disconnected.push("node"); }
    }
    let node: FakeNode | null = null;
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = class { constructor() { node = new FakeNode(); return node; } };
    const audioContext = {
      sampleRate: rate,
      get outputLatency() { return outputLatency; },
      audioWorklet: { addModule: async () => undefined },
      destination: "destination",
    } as unknown as AudioContext;
    const source = { connect: (t: unknown) => connected.push(t), disconnect: (t: unknown) => disconnected.push(t) } as unknown as AudioNode;
    const pending = measureMicRoundTrip(audioContext, source);
    await new Promise((r) => setTimeout(r, 5));
    // the capture arrives; by then output has run and the latency reads its live value
    const lead = rate, gap = rate, input = new Float32Array(lead + 3 * gap + rate / 2);
    const emitFrames = [lead, lead + gap, lead + 2 * gap];
    for (const e of emitFrames) for (let k = 0; k < 353; k++) input[e + 2822 + k] = 0.5 * Math.sin((2 * Math.PI * 6000 * k) / rate);
    outputLatency = 0.023;
    (node as unknown as FakeNode).port.onmessage!({ data: { input, emitFrames, sampleRate: rate } });
    const result = await pending;
    expect(result.outputLatencyMs).toBeCloseTo(23, 6);
    expect(result.inputPartMs).toBeCloseTo(result.roundTripMs - 23, 6);
    expect(disconnected.length).toBeGreaterThanOrEqual(2);
    delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  });
});
