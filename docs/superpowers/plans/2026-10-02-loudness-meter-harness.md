# Loudness Meter Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unlisted debug page that plays the EBU Tech 3341 / 3342 test tones through the live engine, reads the SDK's loudness meter, and judges each reading against the EBU tolerance.

**Architecture:** Four pure modules in `src/lib/audit/` (signals, tap, cases, verdicts) are unit-tested in Node. One engine-side module in `src/demos/engine/` builds the tape region, restarts the worklet for a fresh meter, wires an output tap and captures a case. The page is a thin run loop over those. A throwaway probe page proves the two risky engine assumptions before the cases, verdicts and page are built.

**Tech Stack:** TypeScript (strict), React + Radix Themes, Vitest (Node environment), the openDAW SDK (`@opendaw/studio-sdk`), AudioWorklet, the Playwright MCP browser for verification.

**Spec:** `docs/superpowers/specs/2026-10-02-loudness-meter-harness-design.md`

## Global Constraints

- All signals are stereo, the same samples on both channels, synthesized at the AudioContext's sample rate. Levels are the sine's peak in dBFS.
- Tolerances, copied from the spec: loudness cases ±0.1 LU; range cases ±1 LU; peak cases +0.2 / −0.4 dB around −6.0 dBTP; weighting sweep ±0.1 LU.
- Signal-path limits: delivered level within 0.02 dB of intended; delivered sample peak within 0.05 dB of the analytic sample peak (peak group only). Outside either, the row is `invalid`.
- Verdicts: `pass`, `fail`, `invalid`, `error`. A hidden tab during a case makes its rows `invalid`.
- Readings: end-of-signal reading is the first one at least 200 ms after the tap sees the signal end; late reading is 5 s after the end; a sweep tone is read 300 ms before its end.
- Parameters: `?case=all | <id> | loudness | range | peak | weighting`, `?rate=48000 | 44100` (default 48000), `?audible=1`.
- The page is unlisted: `noindex`, an entry in `vite.config.ts` inputs, nothing in `src/index.tsx`, `public/sitemap.xml` or the README.
- Out of scope: export, a reference meter, real-music comparison, a Node test tier against the SDK's meter class, upstream issue drafts.
- No SDK version numbers in code comments, tests, page copy or `CLAUDE.md` text. Versions appear only under `debug/`.
- Log strings, not objects (objects collapse in the Chrome console).
- `npm run typecheck` exits 0 before every commit.
- Browser checks use the HTTPS dev server on port 5180 (`npm run dev -- --port 5180 --host 127.0.0.1`; reuse it if `lsof -ti :5180` prints a PID), the Playwright MCP browser, a real click on the button, a visible tab, and no file edits while a run is in progress (a save remounts the page).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and carry no session link.

## Review Focus

1. **`?rate=` that is not 48000 or 44100** (for example `abc` or `96000`): the page shows `error:unsupported ?rate=…` at once and never reaches `setup`. Test in Task 4 (`parseRate`), browser check in Task 6.
2. **`?case=` that names nothing**: the page shows `error:unknown ?case=…` listing the valid ids and groups, before any audio starts. Test in Task 4 (`selectCases`), browser check in Task 6.
3. **The signal never reaches the output** (sample failed to load, engine silent): the case ends within ten seconds as an `error` row naming the cause, not after the full deadline. Implemented in Task 3 (`playAndCapture`), and `judgeCapture` returns `invalid` rows when the tap saw nothing (test in Task 5).
4. **A tone at or above half the sample rate, or a reading that is NaN**: `synthesize` throws instead of aliasing silently (test in Task 1); a non-finite reading is "no reading", never a pass (test in Task 5).
5. **No summary sink** (the deployed site, or the dev server down): the run still ends `done` with every row on the page, and the state line says the summary was not saved. Implemented and browser-checked in Task 6.

---

### Task 1: Tone synthesis and the K-weighting response

**Files:**
- Create: `src/lib/audit/loudnessSignals.ts`
- Test: `src/lib/audit/loudnessSignals.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ToneFrequency = { hz: number } | { rateDivisor: number }`
  - `interface ToneSegment { seconds: number; levelDb: number; frequency: ToneFrequency; phaseDeg: number }`
  - `interface SegmentSpan { startFrame: number; endFrame: number }`
  - `frequencyHz(frequency: ToneFrequency, sampleRate: number): number`
  - `segmentSpans(segments: readonly ToneSegment[], sampleRate: number): SegmentSpan[]`
  - `synthesize(segments: readonly ToneSegment[], sampleRate: number, taperMs?: number): Float32Array`
  - `samplePeakDb(segment: ToneSegment, sampleRate: number): number`
  - `kWeightingDb(sampleRate: number, hz: number): number`
  - `expectedToneLoudness(sampleRate: number, hz: number, levelDb: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/audit/loudnessSignals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  expectedToneLoudness,
  kWeightingDb,
  samplePeakDb,
  segmentSpans,
  synthesize,
  type ToneSegment,
} from "./loudnessSignals";

const tone = (levelDb: number, seconds: number, hz = 1000): ToneSegment => ({
  seconds,
  levelDb,
  frequency: { hz },
  phaseDeg: 0,
});
const HALF_SCALE_DB = 20 * Math.log10(0.5);
const fraction = (rateDivisor: number, phaseDeg: number, levelDb = HALF_SCALE_DB): ToneSegment => ({
  seconds: 1,
  levelDb,
  frequency: { rateDivisor },
  phaseDeg,
});

/** A sine's peak in dBFS, from its RMS over [from, to). */
function levelDb(signal: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += signal[i] * signal[i];
  return 10 * Math.log10((2 * sum) / (to - from));
}

describe("segmentSpans", () => {
  it("lays segments end to end in frames", () => {
    expect(segmentSpans([tone(-26, 20), tone(-20, 20.1), tone(-26, 20)], 48000)).toEqual([
      { startFrame: 0, endFrame: 960000 },
      { startFrame: 960000, endFrame: 1924800 },
      { startFrame: 1924800, endFrame: 2884800 },
    ]);
  });
  it("refuses a tone at or above half the sample rate", () => {
    expect(() => segmentSpans([tone(-20, 1, 24000)], 48000)).toThrow(/cannot be synthesized/);
  });
  it("refuses a segment that holds no frames", () => {
    expect(() => segmentSpans([tone(-20, 0)], 48000)).toThrow(/holds no frames/);
  });
  it("refuses a level that is not a number", () => {
    expect(() => segmentSpans([tone(Number.NaN, 1)], 48000)).toThrow(/level/);
  });
});

describe("synthesize", () => {
  it("gives each segment its level", () => {
    const signal = synthesize([tone(-36, 1), tone(-23, 1)], 48000);
    expect(signal.length).toBe(96000);
    expect(levelDb(signal, 0, 48000)).toBeCloseTo(-36, 3);
    expect(levelDb(signal, 48000, 96000)).toBeCloseTo(-23, 3);
  });
  it("keeps the phase running across a level change", () => {
    // 250 Hz at 48 kHz: 48 frames is a quarter cycle, so the second segment starts on a crest.
    const signal = synthesize([tone(0, 0.001, 250), tone(HALF_SCALE_DB, 1, 250)], 48000);
    expect(signal[48]).toBeCloseTo(0.5, 4);
  });
  it("starts a new frequency at its own phase", () => {
    const signal = synthesize([tone(0, 0.001, 250), fraction(4, 90, 0)], 48000);
    expect(signal[48]).toBeCloseTo(1, 6);
    expect(signal[49]).toBeCloseTo(0, 6);
  });
  it("tapers the start and the end", () => {
    // fs/4 at 90 degrees is 1, 0, -1, 0, …; a 10 ms taper at 48 kHz is 480 frames.
    const signal = synthesize([fraction(4, 90, 0)], 48000, 10);
    expect(signal[0]).toBeCloseTo(0, 6);
    expect(signal[240]).toBeCloseTo(0.5, 6);
    expect(signal[480]).toBeCloseTo(1, 6);
    expect(signal[47760]).toBeCloseTo(239 / 480, 6);
    expect(signal[47999]).toBeCloseTo(0, 6);
  });
});

describe("samplePeakDb", () => {
  it("gives the highest sample of the EBU true-peak tones", () => {
    expect(samplePeakDb(fraction(4, 0), 48000)).toBeCloseTo(-6.0206, 3);
    expect(samplePeakDb(fraction(4, 45), 48000)).toBeCloseTo(-9.0309, 3);
    expect(samplePeakDb(fraction(6, 60), 48000)).toBeCloseTo(-7.27, 3);
    expect(samplePeakDb(fraction(8, 67.5), 48000)).toBeCloseTo(-6.7083, 3);
  });
  it("agrees with the synthesized samples", () => {
    const signal = synthesize([fraction(4, 45)], 44100);
    let peak = 0;
    for (const value of signal) peak = Math.max(peak, Math.abs(value));
    expect(20 * Math.log10(peak)).toBeCloseTo(samplePeakDb(fraction(4, 45), 44100), 4);
  });
});

describe("kWeightingDb", () => {
  /** The response of the 48 kHz coefficients printed in ITU-R BS.1770. */
  function publishedDb(hz: number): number {
    const w = (2 * Math.PI * hz) / 48000;
    const magnitude = (b: number[], a: number[]) =>
      Math.hypot(b[0] + b[1] * Math.cos(w) + b[2] * Math.cos(2 * w), b[1] * Math.sin(w) + b[2] * Math.sin(2 * w)) /
      Math.hypot(a[0] + a[1] * Math.cos(w) + a[2] * Math.cos(2 * w), a[1] * Math.sin(w) + a[2] * Math.sin(2 * w));
    return (
      20 *
      Math.log10(
        magnitude([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]) *
          magnitude([1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
      )
    );
  }
  it("reproduces the published 48 kHz filter", () => {
    for (const hz of [25, 100, 1000, 2000, 10000, 20000]) {
      expect(kWeightingDb(48000, hz)).toBeCloseTo(publishedDb(hz), 3);
    }
  });
  it("is +0.691 dB at 997 Hz, the standard's reference tone", () => {
    expect(kWeightingDb(48000, 997)).toBeCloseTo(0.691, 3);
  });
  it("cuts the low end and lifts the top", () => {
    expect(kWeightingDb(48000, 25)).toBeCloseTo(-10.393, 2);
    expect(kWeightingDb(48000, 20000)).toBeCloseTo(4.043, 2);
  });
  it("follows the sample rate", () => {
    expect(kWeightingDb(44100, 1000)).toBeCloseTo(0.7005, 3);
  });
});

describe("expectedToneLoudness", () => {
  it("is the level less 0.691 plus the weighting", () => {
    expect(expectedToneLoudness(48000, 1000, -20)).toBeCloseTo(-19.9933, 3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/loudnessSignals.test.ts`
Expected: FAIL — cannot resolve `./loudnessSignals`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/audit/loudnessSignals.ts`:

```ts
/**
 * Test tones for the loudness meter audit, and the K-weighting response a tone's
 * expected loudness is computed from. No SDK or DOM code: this runs in Node.
 */

/** A fixed frequency, or a fraction of the sample rate (`rateDivisor: 4` is fs/4). */
export type ToneFrequency = { hz: number } | { rateDivisor: number };

export interface ToneSegment {
  seconds: number;
  /** The sine's peak in dBFS. */
  levelDb: number;
  frequency: ToneFrequency;
  /** Phase of the segment's first sample, in degrees. A segment at the same frequency
   *  as the one before it continues that one's phase and ignores this. */
  phaseDeg: number;
}

/** A segment's place in the synthesized signal, in frames. `endFrame` is exclusive. */
export interface SegmentSpan {
  startFrame: number;
  endFrame: number;
}

export function frequencyHz(frequency: ToneFrequency, sampleRate: number): number {
  return "hz" in frequency ? frequency.hz : sampleRate / frequency.rateDivisor;
}

/** Where each segment falls. Throws for a segment that cannot be synthesized as stated. */
export function segmentSpans(segments: readonly ToneSegment[], sampleRate: number): SegmentSpan[] {
  if (!(sampleRate > 0)) throw new Error(`sample rate must be positive, got ${sampleRate}`);
  const spans: SegmentSpan[] = [];
  let frame = 0;
  for (const segment of segments) {
    const frames = Math.round(segment.seconds * sampleRate);
    if (!(frames > 0)) throw new Error(`a segment of ${segment.seconds} s holds no frames`);
    if (!Number.isFinite(segment.levelDb)) throw new Error(`a segment's level must be a number, got ${segment.levelDb}`);
    const hz = frequencyHz(segment.frequency, sampleRate);
    if (!(hz > 0 && hz < sampleRate / 2)) {
      throw new Error(`${hz} Hz cannot be synthesized at ${sampleRate} Hz (must be above 0 and below ${sampleRate / 2})`);
    }
    spans.push({ startFrame: frame, endFrame: frame + frames });
    frame += frames;
  }
  return spans;
}

/** One channel of the signal. `taperMs` is a linear fade at the very start and the very end. */
export function synthesize(segments: readonly ToneSegment[], sampleRate: number, taperMs: number = 0): Float32Array {
  const spans = segmentSpans(segments, sampleRate);
  const total = spans.length === 0 ? 0 : spans[spans.length - 1].endFrame;
  const out = new Float32Array(total);
  let phase = 0;
  let previousHz: number | null = null;
  segments.forEach((segment, index) => {
    const hz = frequencyHz(segment.frequency, sampleRate);
    const step = (2 * Math.PI * hz) / sampleRate;
    const gain = Math.pow(10, segment.levelDb / 20);
    if (hz !== previousHz) phase = (segment.phaseDeg * Math.PI) / 180;
    const { startFrame, endFrame } = spans[index];
    for (let frame = startFrame; frame < endFrame; frame++) {
      out[frame] = gain * Math.sin(phase + (frame - startFrame) * step);
    }
    phase += (endFrame - startFrame) * step;
    previousHz = hz;
  });
  const taperFrames = Math.min(Math.round((taperMs / 1000) * sampleRate), Math.floor(total / 2));
  for (let i = 0; i < taperFrames; i++) {
    const gain = i / taperFrames;
    out[i] *= gain;
    out[total - 1 - i] *= gain;
  }
  return out;
}

/** The highest sample the tone reaches, in dBFS: below its true peak when no sample lands on a crest. */
export function samplePeakDb(segment: ToneSegment, sampleRate: number): number {
  const step = (2 * Math.PI * frequencyHz(segment.frequency, sampleRate)) / sampleRate;
  const phase = (segment.phaseDeg * Math.PI) / 180;
  let peak = 0;
  for (let frame = 0; frame < sampleRate; frame++) {
    peak = Math.max(peak, Math.abs(Math.sin(phase + frame * step)));
  }
  return segment.levelDb + 20 * Math.log10(peak);
}

/** Magnitude of a biquad `b / a` (with `a[0]` = 1) at angular frequency `w`. */
function biquadMagnitude(b: readonly number[], a: readonly number[], w: number): number {
  const real = (c: readonly number[]) => c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w);
  const imaginary = (c: readonly number[]) => c[1] * Math.sin(w) + c[2] * Math.sin(2 * w);
  return Math.hypot(real(b), imaginary(b)) / Math.hypot(real(a), imaginary(a));
}

/**
 * Gain of ITU-R BS.1770 K-weighting at `hz`, in dB. The standard prints coefficients for
 * 48 kHz only; these are its two stages as analog prototypes, transformed at `sampleRate`,
 * which gives the printed coefficients back at 48 kHz.
 */
export function kWeightingDb(sampleRate: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  // Stage 1: high shelf, +4 dB above about 1.7 kHz.
  const shelfQ = 0.7071752369554196;
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelfB = [
    (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    (2 * (shelfK * shelfK - vh)) / shelfA0,
    (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
  ];
  const shelfA = [1, (2 * (shelfK * shelfK - 1)) / shelfA0, (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0];
  // Stage 2: high-pass at about 38 Hz. Its numerator stays 1, -2, 1, as the standard has it.
  const highQ = 0.5003270373238773;
  const highK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const highA0 = 1 + highK / highQ + highK * highK;
  const highA = [1, (2 * (highK * highK - 1)) / highA0, (1 - highK / highQ + highK * highK) / highA0];
  return 20 * Math.log10(biquadMagnitude(shelfB, shelfA, w) * biquadMagnitude([1, -2, 1], highA, w));
}

/**
 * Loudness, in LUFS, of a sine at `levelDb` played in phase on both channels of a stereo
 * signal: each channel's mean square is half the peak squared, and the two are summed.
 */
export function expectedToneLoudness(sampleRate: number, hz: number, levelDb: number): number {
  return levelDb - 0.691 + kWeightingDb(sampleRate, hz);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/loudnessSignals.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/audit/loudnessSignals.ts src/lib/audit/loudnessSignals.test.ts
git commit -m "feat(audit): test tones and the K-weighting response for the loudness harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The output tap

**Files:**
- Create: `src/lib/audit/loudnessTap.ts`
- Test: `src/lib/audit/loudnessTap.test.ts`

**Interfaces:**
- Consumes: nothing at runtime. The tests use `synthesize` and `ToneSegment` from Task 1.
- Produces:
  - `LOUDNESS_TAP_PROCESSOR: string`, `LOUDNESS_TAP_PROCESSOR_SOURCE: string`
  - `LOUDNESS_TAP_QUANTUM_FRAMES = 128`, `LOUDNESS_TAP_CHUNK_QUANTA = 8`, `LOUDNESS_TAP_CHUNK_FRAMES = 1024`, `LOUDNESS_TAP_QUIET = 1e-5`
  - `interface TapStats { frame: number; frames: number; sumSquares: [number, number]; peak: [number, number] }`
  - `interface TapChunk extends TapStats { atMs: number }`
  - `interface LoudnessReading { atMs: number; momentary: number; shortTerm: number; integrated: number; range: number; peak: number }`
  - `interface CaseCapture { readings: LoudnessReading[]; chunks: TapChunk[]; hidden: boolean }`
  - `interface SignalSpan { startFrame: number; endFrame: number; startMs: number; endMs: number }`
  - `chunksFromSignal(left: Float32Array, right: Float32Array, sampleRate: number, startFrame?: number): TapChunk[]`
  - `signalSpan(chunks: readonly TapChunk[], quiet?: number): SignalSpan | null`
  - `deliveredLevelDb(chunks: readonly TapChunk[], fromFrame: number, toFrame: number): [number, number] | null`
  - `deliveredPeakDb(chunks: readonly TapChunk[], fromFrame: number, toFrame: number): number | null`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/audit/loudnessTap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { synthesize, type ToneSegment } from "./loudnessSignals";
import {
  LOUDNESS_TAP_CHUNK_QUANTA,
  LOUDNESS_TAP_PROCESSOR_SOURCE,
  chunksFromSignal,
  deliveredLevelDb,
  deliveredPeakDb,
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
  it("counts frames when nothing is connected", () => {
    const posted = runProcessor([]);
    expect(posted).toEqual([{ frame: 0, frames: 1024, sumSquares: [0, 0], peak: [0, 0] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/loudnessTap.test.ts`
Expected: FAIL — cannot resolve `./loudnessTap`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/audit/loudnessTap.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/loudnessTap.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/audit/loudnessTap.ts src/lib/audit/loudnessTap.test.ts
git commit -m "feat(audit): an output tap for the loudness harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The engine session, and the probe that decides whether to go on

This task writes the engine-side module and proves it in a browser with a throwaway page. Nothing after this task is built until the probe's four checks pass.

**Files:**
- Create: `src/demos/engine/loudnessSession.ts`
- Create, then delete before the commit: `loudness-probe-debug-demo.html`, `src/demos/engine/loudness-probe-debug-demo.tsx`
- Create: `debug/2026-10-02-loudness-meter/note.md` (probe results only; Task 7 completes it)

**Interfaces:**
- Consumes: Task 1 `synthesize`, `samplePeakDb`, `ToneSegment`; Task 2 `LOUDNESS_TAP_*`, `signalSpan`, `deliveredLevelDb`, `deliveredPeakDb`, `CaseCapture`, `LoudnessReading`, `TapChunk`, `TapStats`. From the repo: `initializeOpenDAW({ localAudioBuffers, bpm, audioContextSampleRate, engineTap })` in `src/lib/projectSetup.ts`, `waitForLoadingComplete(project, timeoutMs)` in `src/lib/engineLoading.ts`, `withDeadline(promise, ms, label)` in `src/lib/deadline.ts`.
- Produces:
  - `interface LoudnessSession` (fields below)
  - `openSession(rate: number, audible: boolean): Promise<LoudnessSession>`
  - `loadSignal(session: LoudnessSession, signal: Float32Array, label: string): void`
  - `freshMeter(session: LoudnessSession): Promise<void>`
  - `playAndCapture(session: LoudnessSession, signalSeconds: number, lateSeconds?: number): Promise<CaseCapture>`

- [ ] **Step 1: Confirm the SDK names this module uses**

Run:

```bash
rg -n "LiveStreamReceiver" node_modules/@opendaw/lib-fusion/dist/index.d.ts
rg -n "LOUDNESS" node_modules/@opendaw/studio-adapters/dist/EngineAddresses.d.ts
rg -n "secondsToPulses" node_modules/@opendaw/lib-dsp/dist/ppqn.d.ts
rg -n "liveStreamReceiver|startAudioWorklet" node_modules/@opendaw/studio-core/dist/project/Project.d.ts
```

Expected: each prints at least one line. If a name is gone, read the replacement in the SDK checkout at `/Users/naomiaro/Code/openDAWOriginal` before writing the module.

- [ ] **Step 2: Write the session module**

Create `src/demos/engine/loudnessSession.ts`:

```ts
// The engine side of a loudness audit case: one Tape track that holds the case's signal,
// a worklet restart for an empty meter, a tap on the engine's output, and one play-through
// captured as tap chunks and meter readings.
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { LiveStreamReceiver } from "@opendaw/lib-fusion";
import { EngineAddresses, InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox, type TrackBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { waitForLoadingComplete } from "@/lib/engineLoading";
import { withDeadline } from "@/lib/deadline";
import {
  LOUDNESS_TAP_CHUNK_QUANTA,
  LOUDNESS_TAP_PROCESSOR,
  LOUDNESS_TAP_PROCESSOR_SOURCE,
  LOUDNESS_TAP_QUIET,
  signalSpan,
  type CaseCapture,
  type LoudnessReading,
  type TapChunk,
  type TapStats,
} from "@/lib/audit/loudnessTap";

const BPM = 120;
/** How long after the signal ends the capture keeps reading (the late reading). */
const LATE_SECONDS = 5;

export interface LoudnessSession {
  project: Project;
  audioContext: AudioContext;
  /** Also send the engine to the speakers. Off by default: the tones are long and loud. */
  audible: boolean;
  localAudioBuffers: Map<string, AudioBuffer>;
  trackBox: TrackBox;
  /** The boxes of the signal now on the track, replaced by the next `loadSignal`. */
  content: { region: AudioRegionBox; file: AudioFileBox } | null;
  /** The engine node now feeding the tap. */
  engineNode: AudioNode | null;
  tap: AudioWorkletNode | null;
}

/** Boots the engine at `rate` with one empty Tape track at unity gain, and loads the tap module. */
export async function openSession(rate: number, audible: boolean): Promise<LoudnessSession> {
  const localAudioBuffers = new Map<string, AudioBuffer>();
  const first: { node: AudioNode | null } = { node: null };
  const { project, audioContext } = await initializeOpenDAW({
    localAudioBuffers,
    bpm: BPM,
    audioContextSampleRate: rate,
    engineTap: (node) => {
      first.node = node;
    },
  });
  await withDeadline(audioContext.resume(), 10_000, "AudioContext resume");
  const moduleUrl = URL.createObjectURL(new Blob([LOUDNESS_TAP_PROCESSOR_SOURCE], { type: "application/javascript" }));
  try {
    await withDeadline(audioContext.audioWorklet.addModule(moduleUrl), 10_000, "the tap worklet module");
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  project.engine.preferences.settings.metronome.enabled = false;
  const { audioUnitBox, trackBox } = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape))
    .unwrap("the tape instrument");
  const output = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
  if (output === undefined) throw new Error("the project has no output unit");
  // A separate transaction from createInstrument: unity gain on the track and on the output.
  project.editing.modify(() => {
    audioUnitBox.volume.setValue(0);
    audioUnitBox.panning.setValue(0);
    output.box.volume.setValue(0);
    output.box.panning.setValue(0);
  });
  return {
    project,
    audioContext,
    audible,
    localAudioBuffers,
    trackBox,
    content: null,
    engineNode: first.node,
    tap: null,
  };
}

/** Puts `signal` on the track as a stereo region from position 0, in place of the previous one. */
export function loadSignal(session: LoudnessSession, signal: Float32Array, label: string): void {
  const { project, audioContext, localAudioBuffers, trackBox } = session;
  const buffer = audioContext.createBuffer(2, signal.length, audioContext.sampleRate);
  buffer.getChannelData(0).set(signal);
  buffer.getChannelData(1).set(signal);
  const seconds = signal.length / audioContext.sampleRate;
  const durationPpqn = Math.round(PPQN.secondsToPulses(seconds, BPM));
  const uuid = UUID.generate();
  const previous = session.content;
  localAudioBuffers.clear();
  localAudioBuffers.set(UUID.toString(uuid), buffer);
  session.content = project.editing
    .modify(() => {
      previous?.region.delete();
      previous?.file.delete();
      const file = AudioFileBox.create(project.boxGraph, uuid, (box) => {
        box.fileName.setValue(label);
        box.endInSeconds.setValue(seconds);
      });
      const events = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
      const region = AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
        box.regions.refer(trackBox.regions);
        box.file.refer(file);
        box.events.refer(events.owners);
        box.position.setValue(0);
        box.duration.setValue(durationPpqn);
        box.loopOffset.setValue(0);
        box.loopDuration.setValue(durationPpqn);
        box.label.setValue(label);
        box.mute.setValue(false);
        box.gain.setValue(0);
      });
      return { region, file };
    })
    .unwrap("the signal's region");
}

/**
 * Restarts the engine worklet, which is the only way to empty the loudness meter: the meter
 * lives in the worklet processor and has no reset. The new node reaches the destination
 * through the tap alone unless the session is audible.
 */
export async function freshMeter(session: LoudnessSession): Promise<void> {
  const { project, audioContext } = session;
  session.tap?.disconnect();
  session.engineNode?.disconnect();
  // The receiver is a plain field; a worklet cannot connect to one that is already connected.
  (project as { liveStreamReceiver: LiveStreamReceiver }).liveStreamReceiver = new LiveStreamReceiver();
  const worklet = project.startAudioWorklet();
  await withDeadline(worklet.isReady(), 30_000, "the worklet restart");
  worklet.disconnect(); // startAudioWorklet connected it to the speakers
  const tap = new AudioWorkletNode(audioContext, LOUDNESS_TAP_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { chunkQuanta: LOUDNESS_TAP_CHUNK_QUANTA },
  });
  worklet.connect(tap, 0);
  tap.connect(audioContext.destination);
  if (session.audible) worklet.connect(audioContext.destination, 0);
  session.engineNode = worklet;
  session.tap = tap;
  await waitForLoadingComplete(project, 30_000);
}

/** Polls on a timer, not on animation frames, so a hidden tab still reaches its timeout. */
function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 50);
  });
}

/**
 * Plays the loaded signal once from position 0 and returns everything seen: the tap's chunks
 * and the meter's readings, from before play until `lateSeconds` after the signal ended.
 * The subscription is what switches the meter on, so it is made before play.
 */
export async function playAndCapture(
  session: LoudnessSession,
  signalSeconds: number,
  lateSeconds: number = LATE_SECONDS
): Promise<CaseCapture> {
  const { project, tap } = session;
  if (tap === null) throw new Error("freshMeter must run before playAndCapture");
  const readings: LoudnessReading[] = [];
  const chunks: TapChunk[] = [];
  let hidden = document.visibilityState === "hidden";
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hidden = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  tap.port.onmessage = (event: MessageEvent<TapStats>) => {
    chunks.push({ ...event.data, atMs: performance.now() });
  };
  const subscription = project.liveStreamReceiver.subscribeFloats(EngineAddresses.LOUDNESS, (values) => {
    readings.push({
      atMs: performance.now(),
      momentary: values[0],
      shortTerm: values[1],
      integrated: values[2],
      range: values[3],
      peak: values[4],
    });
  });
  const loud = (chunk: TapChunk) => Math.max(chunk.peak[0], chunk.peak[1]) > LOUDNESS_TAP_QUIET;
  try {
    await waitFor(() => readings.length > 0, 5_000, "the first loudness reading (is the tab visible?)");
    project.engine.setPosition(0);
    project.engine.play();
    await waitFor(() => chunks.some(loud), 10_000, "the signal to reach the output");
    await waitFor(
      () => {
        const span = signalSpan(chunks);
        return span !== null && readings.some((reading) => reading.atMs >= span.endMs + lateSeconds * 1000);
      },
      (signalSeconds + lateSeconds + 30) * 1000,
      "the end of the signal"
    );
  } finally {
    project.engine.stop(true);
    project.engine.setPosition(0);
    subscription.terminate();
    tap.port.onmessage = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }
  return { readings, chunks, hidden };
}
```

- [ ] **Step 3: Write the throwaway probe page**

Create `loudness-probe-debug-demo.html`:

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex, nofollow" />
    <title>loudness probe (throwaway)</title>
</head>

<body>
    <div id="root"></div>
    <script type="module" src="/src/demos/engine/loudness-probe-debug-demo.tsx"></script>
</body>

</html>
```

Create `src/demos/engine/loudness-probe-debug-demo.tsx`:

```tsx
// THROWAWAY probe for the loudness harness plan, Task 3. Deleted before the task's commit.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { samplePeakDb, synthesize, type ToneSegment } from "@/lib/audit/loudnessSignals";
import { deliveredLevelDb, deliveredPeakDb, signalSpan } from "@/lib/audit/loudnessTap";
import { freshMeter, loadSignal, openSession, playAndCapture, type LoudnessSession } from "./loudnessSession";

const SECONDS = 5;
const TONE: ToneSegment[] = [{ seconds: SECONDS, levelDb: -23, frequency: { hz: 1000 }, phaseDeg: 0 }];
const PEAK: ToneSegment[] = [
  { seconds: SECONDS, levelDb: 20 * Math.log10(0.5), frequency: { rateDivisor: 4 }, phaseDeg: 45 },
];

async function measure(
  session: LoudnessSession,
  label: string,
  segments: ToneSegment[],
  taperMs: number,
  log: (line: string) => void
): Promise<void> {
  const rate = session.audioContext.sampleRate;
  const margin = Math.round(0.1 * rate);
  loadSignal(session, synthesize(segments, rate, taperMs), label);
  await freshMeter(session);
  const capture = await playAndCapture(session, SECONDS, 1);
  const span = signalSpan(capture.chunks);
  if (span === null) throw new Error(`${label}: the tap never saw the signal`);
  const from = span.startFrame + margin;
  const to = span.startFrame + SECONDS * rate - margin;
  const level = deliveredLevelDb(capture.chunks, from, to);
  const peak = deliveredPeakDb(capture.chunks, from, to);
  const end = capture.readings.find((reading) => reading.atMs >= span.endMs + 200);
  log(`${label}: first reading integrated ${capture.readings[0].integrated.toFixed(2)}`);
  log(`${label}: delivered level L ${level?.[0].toFixed(3)} R ${level?.[1].toFixed(3)} dBFS`);
  log(`${label}: delivered sample peak ${peak?.toFixed(3)} dBFS`);
  log(`${label}: delivered length ${((span.endFrame - span.startFrame) / rate).toFixed(3)} s`);
  log(`${label}: SDK integrated ${end?.integrated.toFixed(2)} LUFS, SDK peak ${end?.peak.toFixed(2)} dB`);
  log(`${label}: readings ${capture.readings.length}, hidden ${String(capture.hidden)}`);
}

async function runProbe(log: (line: string) => void): Promise<void> {
  const session = await openSession(48000, false);
  log(`sample rate ${session.audioContext.sampleRate}`);
  await measure(session, "tone-1", TONE, 0, log);
  await measure(session, "tone-2", TONE, 0, log);
  await measure(session, "peak", PEAK, 10, log);
  log(`peak: analytic sample peak ${samplePeakDb(PEAK[0], session.audioContext.sampleRate).toFixed(3)} dBFS`);
}

function Probe() {
  const [state, setState] = useState("idle");
  const [lines, setLines] = useState<string[]>([]);
  const run = () => {
    setState("running");
    runProbe((line) => setLines((previous) => [...previous, line]))
      .then(() => setState("done"))
      .catch((error) => {
        console.error(`[loudness-probe] ${String(error)}`);
        setState(`error:${error instanceof Error ? error.message : String(error)}`);
      });
  };
  return (
    <div style={{ fontFamily: "monospace", padding: "1rem" }}>
      <button id="run" onClick={run} disabled={state !== "idle"}>
        Run probe
      </button>
      <div id="probe-state" data-state={state}>
        {state}
      </div>
      <pre id="probe-log">{lines.join("\n")}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Probe />);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Fix type errors in the session module before going to the browser.

- [ ] **Step 5: Run the probe in the browser**

1. Dev server: `lsof -ti :5180` — if it prints nothing, run `npm run dev -- --port 5180 --host 127.0.0.1` in the background.
2. In the Playwright MCP browser, navigate to `https://localhost:5180/loudness-probe-debug-demo.html`.
3. Click the "Run probe" button with a real click (`browser_click`), not `button.click()`.
4. Wait until `document.querySelector("#probe-state").dataset.state` is `done` or starts with `error:` (about 40 seconds). Do not edit any file while it runs.
5. Read `document.querySelector("#probe-log").innerText`.

- [ ] **Step 6: Judge the probe against its four checks**

| Check | Lines | Passes when |
|---|---|---|
| 1. A restart gives an empty meter | `first reading integrated` on `tone-1`, `tone-2` and `peak` | all three read `-120.00` |
| 2. The tone arrives at unity | `delivered level` on `tone-1` and `tone-2` | L and R both within 0.02 of `-23.000`; on `peak`, both within 0.02 of `-6.021` |
| 3. The path is sample-exact | `delivered sample peak` on `peak` against `analytic sample peak` | within 0.05 dB (analytic is `-9.031`) |
| 4. Replacing the region works | `delivered length` on all three, and the run reaching `done` | each within 0.043 s of `5.000` |

The `SDK integrated` and `SDK peak` lines are information for Task 7, not checks. From the Node measurements they should read near `-23.25` and `-9.03`.

**If a check fails, stop and report to the user before any further task:**

- Check 1 fails: the spec's fallback applies (one case per page load), which changes Task 6. The plan is revised with the user first.
- Check 2 fails: find which stage changes the level (track volume, pan law, output unit) by reading the SDK source in `/Users/naomiaro/Code/openDAWOriginal`, and make the session unity. Do not compensate in the synthesized signal.
- Check 3 fails: the engine resampled or interpolated. Find out why before any peak case is trusted.
- Check 4 fails, or the run ends `error:`: report the message. A transaction panic on `delete()` means the region replacement in `loadSignal` needs a different deletion; decide with the user.

- [ ] **Step 7: Record the probe results**

Create `debug/2026-10-02-loudness-meter/note.md` with the header and the probe section. Paste the probe's log lines verbatim in the fenced block, and state the SDK version from `node_modules/@opendaw/studio-sdk/package.json`:

````markdown
# The SDK's loudness meter against the EBU test signals

Verified against: `@opendaw/studio-sdk` <version>.
Harness: [`loudness-meter-audit-debug-demo.html`](../../loudness-meter-audit-debug-demo.html).

## Bring-up probe (2026-10-02)

Before the harness was built, a throwaway page checked the two things it rests on: that
restarting the engine worklet empties the meter, and that a tone on a Tape track reaches the
engine's output at its synthesized level, sample for sample.

```
<the probe's log lines>
```

- A restarted worklet reads integrated −120.00 before anything plays: yes / no.
- A −23 dBFS tone arrives at −23.00 dBFS on both channels: yes / no.
- An fs/4 tone at 45° arrives with its sample peak unchanged (−9.03 dBFS): yes / no.
````

Replace each `yes / no` with what the probe showed.

- [ ] **Step 8: Delete the probe page and commit**

```bash
rm loudness-probe-debug-demo.html src/demos/engine/loudness-probe-debug-demo.tsx
npm run typecheck
git add src/demos/engine/loudnessSession.ts debug/2026-10-02-loudness-meter/note.md
git status --short
git commit -m "feat(audit): the engine session for the loudness harness, probed in the browser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `git status --short` shows only the two added files staged and no probe files.

---

### Task 4: The case table

**Files:**
- Create: `src/lib/audit/loudnessCases.ts`
- Test: `src/lib/audit/loudnessCases.test.ts`

**Interfaces:**
- Consumes: Task 1 `ToneSegment`, `frequencyHz`, `expectedToneLoudness`.
- Produces:
  - `type LoudnessGroup = "loudness" | "range" | "peak" | "weighting"`
  - `type LoudnessMetric = "integrated" | "maxMomentary" | "maxShortTerm" | "range" | "peak" | "shortTerm"`
  - `interface MetricExpectation { metric: LoudnessMetric; expected: number; tolerancePlus: number; toleranceMinus: number; unit: "LUFS" | "LU" | "dBTP" }`
  - `interface LoudnessCase { id: string; group: LoudnessGroup; source: string; segments: ToneSegment[]; taperMs: number; judged: MetricExpectation[] }`
  - `type ReadAt = { kind: "signalEnd" } | { kind: "segmentEnd"; segment: number }`
  - `interface RowSpec { rowId: string; readAt: ReadAt; judged: MetricExpectation[] }`
  - `LOUDNESS_CASES: readonly LoudnessCase[]`, `LOUDNESS_GROUPS`, `LOUDNESS_RATES`, `WEIGHTING_HZ`, `WEIGHTING_LEVEL_DB`
  - `caseSeconds(testCase: LoudnessCase): number`
  - `rowSpecs(testCase: LoudnessCase, sampleRate: number): RowSpec[]`
  - `selectCases(selector: string | null): LoudnessCase[]` (throws on an unknown selector)
  - `parseRate(param: string | null): number` (throws on an unsupported rate)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/audit/loudnessCases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LOUDNESS_CASES, WEIGHTING_HZ, caseSeconds, parseRate, rowSpecs, selectCases } from "./loudnessCases";

describe("LOUDNESS_CASES", () => {
  it("has unique ids", () => {
    const ids = LOUDNESS_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("runs for 610.1 seconds in all", () => {
    expect(LOUDNESS_CASES.reduce((sum, testCase) => sum + caseSeconds(testCase), 0)).toBeCloseTo(610.1, 6);
  });
  it("states Tech 3341 case 5 as published", () => {
    const [case5] = selectCases("3341-5");
    expect(case5.segments.map((segment) => [segment.levelDb, segment.seconds])).toEqual([
      [-26, 20],
      [-20, 20.1],
      [-26, 20],
    ]);
    expect(case5.judged).toEqual([
      { metric: "integrated", expected: -23, tolerancePlus: 0.1, toleranceMinus: 0.1, unit: "LUFS" },
    ]);
  });
  it("judges momentary, short-term and integrated on cases 1 and 2", () => {
    for (const id of ["3341-1", "3341-2"]) {
      expect(selectCases(id)[0].judged.map((expectation) => expectation.metric)).toEqual([
        "integrated",
        "maxMomentary",
        "maxShortTerm",
      ]);
    }
  });
  it("states Tech 3342 case 4 as published", () => {
    const [case4] = selectCases("3342-4");
    expect(case4.segments.map((segment) => segment.levelDb)).toEqual([-50, -35, -20, -35, -50]);
    expect(case4.judged).toEqual([{ metric: "range", expected: 15, tolerancePlus: 1, toleranceMinus: 1, unit: "LU" }]);
  });
  it("gives the true-peak cases the asymmetric tolerance and a 10 ms taper, and no other case a taper", () => {
    for (const testCase of LOUDNESS_CASES) {
      if (testCase.group !== "peak") {
        expect(testCase.taperMs).toBe(0);
        continue;
      }
      expect(testCase.taperMs).toBe(10);
      expect(testCase.judged).toEqual([
        { metric: "peak", expected: -6, tolerancePlus: 0.2, toleranceMinus: 0.4, unit: "dBTP" },
      ]);
    }
  });
});

describe("selectCases", () => {
  it("returns every case for all, and for no selector", () => {
    expect(selectCases("all")).toHaveLength(14);
    expect(selectCases(null)).toHaveLength(14);
  });
  it("returns a group", () => {
    expect(selectCases("loudness").map((testCase) => testCase.id)).toEqual([
      "3341-1",
      "3341-2",
      "3341-3",
      "3341-4",
      "3341-5",
    ]);
    expect(selectCases("peak")).toHaveLength(4);
  });
  it("returns one case by id", () => {
    expect(selectCases("3342-2").map((testCase) => testCase.id)).toEqual(["3342-2"]);
  });
  it("names the valid selectors when it knows none by that name", () => {
    expect(() => selectCases("nope")).toThrow(/unknown \?case= "nope".*weighting.*3341-1/s);
  });
});

describe("rowSpecs", () => {
  it("gives an EBU case one row, read at the end of the signal", () => {
    const [case3] = selectCases("3341-3");
    expect(rowSpecs(case3, 48000)).toEqual([{ rowId: "3341-3", readAt: { kind: "signalEnd" }, judged: case3.judged }]);
  });
  it("gives the weighting sweep one row per tone, read at that tone's end", () => {
    const [sweep] = selectCases("weighting");
    const rows = rowSpecs(sweep, 48000);
    expect(rows.map((row) => row.rowId)).toEqual(WEIGHTING_HZ.map((hz) => `kweight-${hz}`));
    expect(rows[6].readAt).toEqual({ kind: "segmentEnd", segment: 6 });
    expect(rows[6].judged[0].metric).toBe("shortTerm");
    expect(rows[6].judged[0].expected).toBeCloseTo(-19.9933, 3);
    expect(rows[6].judged[0].tolerancePlus).toBe(0.1);
  });
  it("computes the sweep's expectations at the running sample rate", () => {
    const [sweep] = selectCases("weighting");
    expect(rowSpecs(sweep, 44100)[6].judged[0].expected).toBeCloseTo(-19.9905, 3);
  });
  it("makes 28 rows for a full run", () => {
    expect(LOUDNESS_CASES.flatMap((testCase) => rowSpecs(testCase, 48000))).toHaveLength(28);
  });
});

describe("parseRate", () => {
  it("defaults to 48000", () => {
    expect(parseRate(null)).toBe(48000);
  });
  it("accepts 44100", () => {
    expect(parseRate("44100")).toBe(44100);
  });
  it("refuses anything else, naming what it accepts", () => {
    expect(() => parseRate("96000")).toThrow(/unsupported \?rate= "96000".*48000 or 44100/);
    expect(() => parseRate("abc")).toThrow(/unsupported \?rate= "abc"/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/loudnessCases.test.ts`
Expected: FAIL — cannot resolve `./loudnessCases`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/audit/loudnessCases.ts`:

```ts
/**
 * The loudness audit's cases: test signals whose loudness is known, and what a meter must
 * read for each. The EBU rows are Table 1 of EBU Tech 3341 (loudness and true peak) and
 * Table 1 of EBU Tech 3342 (loudness range). The weighting sweep is this harness's own.
 */
import { expectedToneLoudness, frequencyHz, type ToneSegment } from "./loudnessSignals";

export type LoudnessGroup = "loudness" | "range" | "peak" | "weighting";
export const LOUDNESS_GROUPS: readonly LoudnessGroup[] = ["loudness", "range", "peak", "weighting"];

export type LoudnessMetric = "integrated" | "maxMomentary" | "maxShortTerm" | "range" | "peak" | "shortTerm";

export interface MetricExpectation {
  metric: LoudnessMetric;
  expected: number;
  /** How far above `expected` a reading may be. */
  tolerancePlus: number;
  /** How far below `expected` a reading may be. */
  toleranceMinus: number;
  unit: "LUFS" | "LU" | "dBTP";
}

export interface LoudnessCase {
  id: string;
  group: LoudnessGroup;
  /** Where the case comes from, for the page and the summary. */
  source: string;
  segments: ToneSegment[];
  /** Fade at the start and end of the whole signal, in ms. */
  taperMs: number;
  /** What the end-of-signal reading is judged by. Empty for the sweep, which is judged per tone. */
  judged: MetricExpectation[];
}

export type ReadAt = { kind: "signalEnd" } | { kind: "segmentEnd"; segment: number };

/** One row of the result table: which reading it takes and what that reading is judged by. */
export interface RowSpec {
  rowId: string;
  readAt: ReadAt;
  judged: MetricExpectation[];
}

export const LOUDNESS_RATES: readonly number[] = [48000, 44100];
export const WEIGHTING_HZ: readonly number[] = [
  25, 40, 60, 100, 250, 500, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 16000, 20000,
];
export const WEIGHTING_LEVEL_DB = -20;
const WEIGHTING_TONE_SECONDS = 6;
/** The harness's own tolerance for the sweep, chosen to match the EBU loudness cases. */
const WEIGHTING_TOLERANCE = 0.1;
/** "0.50 FS" in Tech 3341. */
const HALF_SCALE_DB = 20 * Math.log10(0.5);

const tone = (levelDb: number, seconds: number, hz: number = 1000): ToneSegment => ({
  seconds,
  levelDb,
  frequency: { hz },
  phaseDeg: 0,
});
const peakTone = (rateDivisor: number, phaseDeg: number): ToneSegment => ({
  seconds: 5,
  levelDb: HALF_SCALE_DB,
  frequency: { rateDivisor },
  phaseDeg,
});
const lufs = (metric: LoudnessMetric, expected: number): MetricExpectation => ({
  metric,
  expected,
  tolerancePlus: 0.1,
  toleranceMinus: 0.1,
  unit: "LUFS",
});
const allThree = (expected: number): MetricExpectation[] => [
  lufs("integrated", expected),
  lufs("maxMomentary", expected),
  lufs("maxShortTerm", expected),
];
const rangeOf = (expected: number): MetricExpectation[] => [
  { metric: "range", expected, tolerancePlus: 1, toleranceMinus: 1, unit: "LU" },
];
const truePeak = (): MetricExpectation[] => [
  { metric: "peak", expected: -6, tolerancePlus: 0.2, toleranceMinus: 0.4, unit: "dBTP" },
];
const loudness = (id: string, segments: ToneSegment[], judged: MetricExpectation[]): LoudnessCase => ({
  id: `3341-${id}`,
  group: "loudness",
  source: `EBU Tech 3341 case ${id}`,
  segments,
  taperMs: 0,
  judged,
});
const range = (id: string, levels: number[], expected: number): LoudnessCase => ({
  id: `3342-${id}`,
  group: "range",
  source: `EBU Tech 3342 case ${id}`,
  segments: levels.map((level) => tone(level, 20)),
  taperMs: 0,
  judged: rangeOf(expected),
});
const peak = (id: string, rateDivisor: number, phaseDeg: number): LoudnessCase => ({
  id: `3341-${id}`,
  group: "peak",
  source: `EBU Tech 3341 case ${id}`,
  segments: [peakTone(rateDivisor, phaseDeg)],
  taperMs: 10,
  judged: truePeak(),
});

export const LOUDNESS_CASES: readonly LoudnessCase[] = [
  loudness("1", [tone(-23, 20)], allThree(-23)),
  loudness("2", [tone(-33, 20)], allThree(-33)),
  loudness("3", [tone(-36, 10), tone(-23, 60), tone(-36, 10)], [lufs("integrated", -23)]),
  loudness(
    "4",
    [tone(-72, 10), tone(-36, 10), tone(-23, 60), tone(-36, 10), tone(-72, 10)],
    [lufs("integrated", -23)]
  ),
  loudness("5", [tone(-26, 20), tone(-20, 20.1), tone(-26, 20)], [lufs("integrated", -23)]),
  range("1", [-20, -30], 10),
  range("2", [-20, -15], 5),
  range("3", [-40, -20], 20),
  range("4", [-50, -35, -20, -35, -50], 15),
  peak("15", 4, 0),
  peak("16", 4, 45),
  peak("17", 6, 60),
  peak("18", 8, 67.5),
  {
    id: "kweight",
    group: "weighting",
    source: "K-weighting sweep (this harness)",
    segments: WEIGHTING_HZ.map((hz) => tone(WEIGHTING_LEVEL_DB, WEIGHTING_TONE_SECONDS, hz)),
    taperMs: 0,
    judged: [],
  },
];

export function caseSeconds(testCase: LoudnessCase): number {
  return testCase.segments.reduce((sum, segment) => sum + segment.seconds, 0);
}

/** The rows a case produces. The sweep's expectations depend on the running sample rate. */
export function rowSpecs(testCase: LoudnessCase, sampleRate: number): RowSpec[] {
  if (testCase.group !== "weighting") {
    return [{ rowId: testCase.id, readAt: { kind: "signalEnd" }, judged: testCase.judged }];
  }
  return testCase.segments.map((segment, index) => {
    const hz = frequencyHz(segment.frequency, sampleRate);
    return {
      rowId: `kweight-${hz}`,
      readAt: { kind: "segmentEnd", segment: index },
      judged: [
        {
          metric: "shortTerm",
          expected: expectedToneLoudness(sampleRate, hz, segment.levelDb),
          tolerancePlus: WEIGHTING_TOLERANCE,
          toleranceMinus: WEIGHTING_TOLERANCE,
          unit: "LUFS",
        },
      ],
    };
  });
}

/** `all` (or nothing), a group name, or one case id. Throws for anything else. */
export function selectCases(selector: string | null): LoudnessCase[] {
  if (selector === null || selector === "all") return [...LOUDNESS_CASES];
  const group = LOUDNESS_CASES.filter((testCase) => testCase.group === selector);
  if (group.length > 0) return group;
  const one = LOUDNESS_CASES.filter((testCase) => testCase.id === selector);
  if (one.length > 0) return one;
  const known = ["all", ...LOUDNESS_GROUPS, ...LOUDNESS_CASES.map((testCase) => testCase.id)];
  throw new Error(`unknown ?case= "${selector}" (use one of: ${known.join(", ")})`);
}

export function parseRate(param: string | null): number {
  if (param === null) return LOUDNESS_RATES[0];
  const rate = Number(param);
  if (!LOUDNESS_RATES.includes(rate)) {
    throw new Error(`unsupported ?rate= "${param}" (use ${LOUDNESS_RATES.join(" or ")})`);
  }
  return rate;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/loudnessCases.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/audit/loudnessCases.ts src/lib/audit/loudnessCases.test.ts
git commit -m "feat(audit): the loudness harness's EBU cases and weighting sweep

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Verdicts

**Files:**
- Create: `src/lib/audit/loudnessVerdict.ts`
- Test: `src/lib/audit/loudnessVerdict.test.ts`

**Interfaces:**
- Consumes: Task 1 `samplePeakDb`, `segmentSpans`, `synthesize`, `expectedToneLoudness`; Task 2 `signalSpan`, `deliveredLevelDb`, `deliveredPeakDb`, `chunksFromSignal`, `LOUDNESS_TAP_CHUNK_FRAMES`, `CaseCapture`, `LoudnessReading`; Task 4 `rowSpecs`, `selectCases`, `WEIGHTING_HZ`, `LoudnessCase`, `LoudnessGroup`, `LoudnessMetric`, `MetricExpectation`.
- Produces:
  - `type MetricValues = Partial<Record<LoudnessMetric, number>>`
  - `interface DeliveredCheck { label: string; intendedDb: number; deliveredDb: number | null; toleranceDb: number }`
  - `interface MetricResult extends MetricExpectation { got: number | null; error: number | null; within: boolean }`
  - `type RowStatus = "pass" | "fail" | "invalid"`
  - `interface RowVerdict { status: RowStatus; metrics: MetricResult[]; reasons: string[] }`
  - `interface JudgedRow extends RowVerdict { rowId: string; caseId: string; group: LoudnessGroup; delivered: DeliveredCheck[]; late: MetricValues }`
  - `firstReadingAtOrAfter`, `lastReadingAtOrBefore`, `endOfSignalValues`, `segmentEndValues`, `lateValues`
  - `judgeRow(input: RowInput): RowVerdict`
  - `judgeCapture(testCase: LoudnessCase, sampleRate: number, capture: CaseCapture): JudgedRow[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/audit/loudnessVerdict.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WEIGHTING_HZ, selectCases, type LoudnessCase } from "./loudnessCases";
import { expectedToneLoudness, synthesize } from "./loudnessSignals";
import { chunksFromSignal, type CaseCapture, type LoudnessReading } from "./loudnessTap";
import {
  firstReadingAtOrAfter,
  judgeCapture,
  judgeRow,
  lastReadingAtOrBefore,
} from "./loudnessVerdict";

const RATE = 48000;
const LEAD_SECONDS = 1;
const TAIL_SECONDS = 6.5;

type Values = Omit<LoudnessReading, "atMs">;
/** What the meter reads `seconds` into the signal (negative before it starts). */
type Meter = (seconds: number) => Values;

const EMPTY: Values = { momentary: -120, shortTerm: -120, integrated: -120, range: 0, peak: -120 };
const steady =
  (level: number, overrides: Partial<Values> = {}): Meter =>
  (seconds) =>
    seconds < 0
      ? EMPTY
      : { momentary: level, shortTerm: level, integrated: level, range: 0, peak: level, ...overrides };

/** A capture of `testCase` as the page would make it: a second of silence, the signal, silence. */
function captureOf(testCase: LoudnessCase, meter: Meter, gain: number = 1): CaseCapture {
  const signal = synthesize(testCase.segments, RATE, testCase.taperMs);
  const lead = LEAD_SECONDS * RATE;
  const output = new Float32Array(lead + signal.length + TAIL_SECONDS * RATE);
  for (let i = 0; i < signal.length; i++) output[lead + i] = signal[i] * gain;
  const readings: LoudnessReading[] = [];
  for (let atMs = 0; atMs <= (output.length / RATE) * 1000; atMs += 100) {
    readings.push({ atMs, ...meter(atMs / 1000 - LEAD_SECONDS) });
  }
  return { readings, chunks: chunksFromSignal(output, output, RATE), hidden: false };
}

const case1 = selectCases("3341-1")[0];
const case16 = selectCases("3341-16")[0];
const sweep = selectCases("weighting")[0];

describe("reading lookup", () => {
  const readings = [100, 200, 300].map((atMs) => ({ atMs, ...EMPTY }));
  it("finds the first reading at or after a time", () => {
    expect(firstReadingAtOrAfter(readings, 200)?.atMs).toBe(200);
    expect(firstReadingAtOrAfter(readings, 201)?.atMs).toBe(300);
    expect(firstReadingAtOrAfter(readings, 301)).toBeNull();
  });
  it("finds the last reading at or before a time", () => {
    expect(lastReadingAtOrBefore(readings, 200)?.atMs).toBe(200);
    expect(lastReadingAtOrBefore(readings, 299)?.atMs).toBe(200);
    expect(lastReadingAtOrBefore(readings, 99)).toBeNull();
  });
});

describe("judgeRow", () => {
  const judged = selectCases("3341-3")[0].judged;
  const row = (integrated: number) => judgeRow({ judged, values: { integrated }, delivered: [], problems: [] });
  it("passes a reading exactly on the limit, as the stream's 32-bit floats state it", () => {
    expect(row(Math.fround(-23.1)).status).toBe("pass");
    expect(row(Math.fround(-22.9)).status).toBe("pass");
  });
  it("fails a reading just past the limit", () => {
    expect(row(-23.11).status).toBe("fail");
    expect(row(-22.89).status).toBe("fail");
  });
  it("never passes a reading that is not a number", () => {
    const verdict = row(Number.NaN);
    expect(verdict.status).toBe("invalid");
    expect(verdict.reasons).toEqual(["no reading for integrated"]);
    expect(verdict.metrics[0].got).toBeNull();
  });
  it("is invalid when a delivered level was not measured", () => {
    const verdict = judgeRow({
      judged,
      values: { integrated: -23 },
      delivered: [{ label: "segment 1 level L", intendedDb: -36, deliveredDb: null, toleranceDb: 0.02 }],
      problems: [],
    });
    expect(verdict.status).toBe("invalid");
    expect(verdict.reasons).toEqual(["segment 1 level L: not measured"]);
  });
});

describe("judgeCapture", () => {
  it("passes a case whose readings are within tolerance", () => {
    const rows = judgeCapture(case1, RATE, captureOf(case1, steady(-23)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].reasons).toEqual([]);
    expect(rows[0].metrics.map((metric) => metric.got)).toEqual([-23, -23, -23]);
    expect(rows[0].delivered.map((check) => check.label)).toEqual(["segment 1 level L", "segment 1 level R"]);
    expect(rows[0].delivered[0].deliveredDb).toBeCloseTo(-23, 2);
  });
  it("fails a case whose readings are outside tolerance, and says by how much", () => {
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23.25)));
    expect(row.status).toBe("fail");
    expect(row.reasons).toEqual([]);
    expect(row.metrics[0].error).toBeCloseTo(-0.25, 6);
    expect(row.metrics[0].within).toBe(false);
  });
  it("takes the maxima from the whole signal, not from the end", () => {
    const meter: Meter = (seconds) => ({
      ...steady(-23)(seconds),
      ...(seconds >= 5 && seconds < 6 ? { momentary: -22.5 } : {}),
    });
    const [row] = judgeCapture(case1, RATE, captureOf(case1, meter));
    expect(row.metrics.find((metric) => metric.metric === "maxMomentary")?.got).toBe(-22.5);
    expect(row.status).toBe("fail");
  });
  it("is invalid when the signal was not delivered at its level, though the readings would pass", () => {
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23), 0.99));
    expect(row.status).toBe("invalid");
    expect(row.reasons[0]).toMatch(/^segment 1 level L: delivered -23\.09 dB, intended -23\.00 dB$/);
    expect(row.metrics.every((metric) => metric.within)).toBe(true);
  });
  it("is invalid when the tab was hidden", () => {
    const capture = { ...captureOf(case1, steady(-23)), hidden: true };
    const [row] = judgeCapture(case1, RATE, capture);
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["the tab was hidden during the case"]);
  });
  it("is invalid when the meter was not empty at the start", () => {
    const meter: Meter = (seconds) => (seconds < 0 ? { ...EMPTY, integrated: -30 } : steady(-23)(seconds));
    const [row] = judgeCapture(case1, RATE, captureOf(case1, meter));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toEqual(["the meter was not empty at the start (integrated -30.00)"]);
  });
  it("is invalid when nothing reached the output", () => {
    const [row] = judgeCapture(case1, RATE, captureOf(case1, steady(-23), 0));
    expect(row.status).toBe("invalid");
    expect(row.reasons).toContain("the tap never saw the signal start and end");
    expect(row.metrics.every((metric) => metric.got === null)).toBe(true);
  });
  it("is invalid when no reading arrived", () => {
    const capture = { ...captureOf(case1, steady(-23)), readings: [] };
    const [row] = judgeCapture(case1, RATE, capture);
    expect(row.status).toBe("invalid");
    expect(row.reasons).toContain("no loudness reading arrived");
  });
  it("reports the late reading without judging it", () => {
    const meter: Meter = (seconds) => (seconds > 22 ? steady(-23, { integrated: -25 })(seconds) : steady(-23)(seconds));
    const [row] = judgeCapture(case1, RATE, captureOf(case1, meter));
    expect(row.late.integrated).toBe(-25);
    expect(row.status).toBe("pass");
  });
  it("applies the true-peak tolerance, wider below than above", () => {
    const status = (peak: number) => judgeCapture(case16, RATE, captureOf(case16, steady(-9, { peak })))[0].status;
    expect(status(-6.3)).toBe("pass");
    expect(status(-5.7)).toBe("fail");
    expect(status(-6.5)).toBe("fail");
  });
  it("checks a peak case's delivered sample peak against the tone's own", () => {
    const [row] = judgeCapture(case16, RATE, captureOf(case16, steady(-9, { peak: -6 })));
    const check = row.delivered.find((entry) => entry.label === "segment 1 sample peak");
    expect(check?.intendedDb).toBeCloseTo(-9.031, 2);
    expect(check?.deliveredDb).toBeCloseTo(-9.031, 2);
    expect(row.status).toBe("pass");
  });
  it("judges each sweep tone by the short-term reading at that tone's end", () => {
    // Every tone reads its expected loudness, except 1500 Hz, which reads 0.49 low.
    const meter: Meter = (seconds) => {
      if (seconds < 0) return EMPTY;
      const hz = WEIGHTING_HZ[Math.min(Math.floor(seconds / 6), WEIGHTING_HZ.length - 1)];
      const shortTerm = expectedToneLoudness(RATE, hz, -20) - (hz === 1500 ? 0.49 : 0);
      return { ...steady(-20)(seconds), shortTerm };
    };
    const rows = judgeCapture(sweep, RATE, captureOf(sweep, meter));
    expect(rows.map((row) => row.rowId)).toEqual(WEIGHTING_HZ.map((hz) => `kweight-${hz}`));
    expect(rows.filter((row) => row.status === "fail").map((row) => row.rowId)).toEqual(["kweight-1500"]);
    expect(rows.filter((row) => row.status === "pass")).toHaveLength(14);
    expect(rows[7].metrics[0].error).toBeCloseTo(-0.49, 6);
    expect(rows[7].delivered.map((check) => check.label)).toEqual(["segment 8 level L", "segment 8 level R"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/loudnessVerdict.test.ts`
Expected: FAIL — cannot resolve `./loudnessVerdict`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/audit/loudnessVerdict.ts`:

```ts
/**
 * From a captured case to judged rows: which readings a row takes, whether the signal was
 * delivered as synthesized, and whether each reading is within its tolerance.
 */
import {
  rowSpecs,
  type LoudnessCase,
  type LoudnessGroup,
  type LoudnessMetric,
  type MetricExpectation,
} from "./loudnessCases";
import { samplePeakDb, segmentSpans } from "./loudnessSignals";
import {
  LOUDNESS_TAP_CHUNK_FRAMES,
  deliveredLevelDb,
  deliveredPeakDb,
  signalSpan,
  type CaseCapture,
  type LoudnessReading,
} from "./loudnessTap";

/** The end-of-signal reading is the first one at least this long after the tap sees the end. */
export const END_READING_DELAY_MS = 200;
/** The late reading shows whether the meter's numbers move once the programme is over. */
export const LATE_READING_DELAY_MS = 5000;
/** A sweep tone is read this long before it ends, so the next tone is not yet in the window. */
export const SEGMENT_READING_GUARD_MS = 300;
/** A meter that has measured nothing reads -120; above this it was not empty. */
export const EMPTY_METER_MAX = -119;
export const LEVEL_TOLERANCE_DB = 0.02;
export const PEAK_TOLERANCE_DB = 0.05;
/** Left out at each end of a segment when its delivered level is measured. */
export const INTERIOR_MARGIN_SEC = 0.1;
/** The tap places the signal's start and end to a chunk each. */
export const LENGTH_SLACK_FRAMES = 2 * LOUDNESS_TAP_CHUNK_FRAMES;
/** The stream carries 32-bit floats: a reading on the limit must not fail for its last bit. */
const TOLERANCE_SLACK = 1e-5;

export type MetricValues = Partial<Record<LoudnessMetric, number>>;

/** One thing the tap confirms about the signal the meter was fed. */
export interface DeliveredCheck {
  label: string;
  intendedDb: number;
  deliveredDb: number | null;
  toleranceDb: number;
}

export interface MetricResult extends MetricExpectation {
  got: number | null;
  error: number | null;
  within: boolean;
}

export type RowStatus = "pass" | "fail" | "invalid";

export interface RowVerdict {
  status: RowStatus;
  metrics: MetricResult[];
  /** Why the row is invalid. Empty for pass and fail. */
  reasons: string[];
}

export interface JudgedRow extends RowVerdict {
  rowId: string;
  caseId: string;
  group: LoudnessGroup;
  delivered: DeliveredCheck[];
  /** Integrated, range and peak five seconds after the signal ended. Reported, not judged. */
  late: MetricValues;
}

export function firstReadingAtOrAfter(readings: readonly LoudnessReading[], atMs: number): LoudnessReading | null {
  return readings.find((reading) => reading.atMs >= atMs) ?? null;
}

export function lastReadingAtOrBefore(readings: readonly LoudnessReading[], atMs: number): LoudnessReading | null {
  let found: LoudnessReading | null = null;
  for (const reading of readings) {
    if (reading.atMs > atMs) break;
    found = reading;
  }
  return found;
}

/** Integrated, range and peak just after the signal ended; the maxima over the signal. */
export function endOfSignalValues(readings: readonly LoudnessReading[], startMs: number, endMs: number): MetricValues {
  const end = firstReadingAtOrAfter(readings, endMs + END_READING_DELAY_MS);
  if (end === null) return {};
  const during = readings.filter((reading) => reading.atMs >= startMs && reading.atMs <= end.atMs);
  return {
    integrated: end.integrated,
    range: end.range,
    peak: end.peak,
    maxMomentary: during.reduce((highest, reading) => Math.max(highest, reading.momentary), -Infinity),
    maxShortTerm: during.reduce((highest, reading) => Math.max(highest, reading.shortTerm), -Infinity),
  };
}

/** Short-term loudness just before a segment ends, `segmentEndSeconds` into the signal. */
export function segmentEndValues(
  readings: readonly LoudnessReading[],
  startMs: number,
  segmentEndSeconds: number
): MetricValues {
  const reading = lastReadingAtOrBefore(readings, startMs + segmentEndSeconds * 1000 - SEGMENT_READING_GUARD_MS);
  return reading === null || reading.atMs < startMs ? {} : { shortTerm: reading.shortTerm };
}

export function lateValues(readings: readonly LoudnessReading[], endMs: number): MetricValues {
  const late = firstReadingAtOrAfter(readings, endMs + LATE_READING_DELAY_MS);
  return late === null ? {} : { integrated: late.integrated, range: late.range, peak: late.peak };
}

export interface RowInput {
  judged: readonly MetricExpectation[];
  values: MetricValues;
  delivered: readonly DeliveredCheck[];
  /** Reasons, found before judging, that the case cannot be trusted. */
  problems: readonly string[];
}

/** Invalid when anything says the meter was not fed the intended signal; otherwise pass or fail. */
export function judgeRow({ judged, values, delivered, problems }: RowInput): RowVerdict {
  const reasons = [...problems];
  for (const check of delivered) {
    if (check.deliveredDb === null || Number.isNaN(check.deliveredDb)) {
      reasons.push(`${check.label}: not measured`);
    } else if (!(Math.abs(check.deliveredDb - check.intendedDb) <= check.toleranceDb)) {
      reasons.push(
        `${check.label}: delivered ${check.deliveredDb.toFixed(2)} dB, intended ${check.intendedDb.toFixed(2)} dB`
      );
    }
  }
  const metrics = judged.map((expectation): MetricResult => {
    const got = values[expectation.metric];
    if (got === undefined || !Number.isFinite(got)) {
      reasons.push(`no reading for ${expectation.metric}`);
      return { ...expectation, got: null, error: null, within: false };
    }
    const error = got - expectation.expected;
    const within =
      error <= expectation.tolerancePlus + TOLERANCE_SLACK && error >= -expectation.toleranceMinus - TOLERANCE_SLACK;
    return { ...expectation, got, error, within };
  });
  const status: RowStatus = reasons.length > 0 ? "invalid" : metrics.every((metric) => metric.within) ? "pass" : "fail";
  return { status, metrics, reasons };
}

/** Every row of a case, judged from what its one play-through captured. */
export function judgeCapture(testCase: LoudnessCase, sampleRate: number, capture: CaseCapture): JudgedRow[] {
  const spans = segmentSpans(testCase.segments, sampleRate);
  const totalFrames = spans[spans.length - 1].endFrame;
  const margin = Math.round(INTERIOR_MARGIN_SEC * sampleRate);
  const span = signalSpan(capture.chunks);

  const problems: string[] = [];
  if (capture.hidden) problems.push("the tab was hidden during the case");
  if (capture.readings.length === 0) {
    problems.push("no loudness reading arrived");
  } else if (capture.readings[0].integrated > EMPTY_METER_MAX) {
    problems.push(`the meter was not empty at the start (integrated ${capture.readings[0].integrated.toFixed(2)})`);
  }
  if (span === null) {
    problems.push("the tap never saw the signal start and end");
  } else if (Math.abs(span.endFrame - span.startFrame - totalFrames) > LENGTH_SLACK_FRAMES) {
    const delivered = ((span.endFrame - span.startFrame) / sampleRate).toFixed(3);
    problems.push(`signal length delivered ${delivered} s, synthesized ${(totalFrames / sampleRate).toFixed(3)} s`);
  }

  const checksFor = (index: number): DeliveredCheck[] => {
    const segment = testCase.segments[index];
    const from = span === null ? 0 : span.startFrame + spans[index].startFrame + margin;
    const to = span === null ? 0 : span.startFrame + spans[index].endFrame - margin;
    const level = span === null ? null : deliveredLevelDb(capture.chunks, from, to);
    const name = `segment ${index + 1}`;
    const checks: DeliveredCheck[] = [
      {
        label: `${name} level L`,
        intendedDb: segment.levelDb,
        deliveredDb: level === null ? null : level[0],
        toleranceDb: LEVEL_TOLERANCE_DB,
      },
      {
        label: `${name} level R`,
        intendedDb: segment.levelDb,
        deliveredDb: level === null ? null : level[1],
        toleranceDb: LEVEL_TOLERANCE_DB,
      },
    ];
    if (testCase.group === "peak") {
      checks.push({
        label: `${name} sample peak`,
        intendedDb: samplePeakDb(segment, sampleRate),
        deliveredDb: span === null ? null : deliveredPeakDb(capture.chunks, from, to),
        toleranceDb: PEAK_TOLERANCE_DB,
      });
    }
    return checks;
  };

  return rowSpecs(testCase, sampleRate).map((spec): JudgedRow => {
    const { readAt } = spec;
    const segmentIndexes = readAt.kind === "segmentEnd" ? [readAt.segment] : testCase.segments.map((_, index) => index);
    const delivered = segmentIndexes.flatMap(checksFor);
    let values: MetricValues = {};
    if (span !== null) {
      values =
        readAt.kind === "segmentEnd"
          ? segmentEndValues(capture.readings, span.startMs, spans[readAt.segment].endFrame / sampleRate)
          : endOfSignalValues(capture.readings, span.startMs, span.endMs);
    }
    return {
      rowId: spec.rowId,
      caseId: testCase.id,
      group: testCase.group,
      delivered,
      late: span === null ? {} : lateValues(capture.readings, span.endMs),
      ...judgeRow({ judged: spec.judged, values, delivered, problems }),
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/loudnessVerdict.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Prove the tests can fail**

In `loudnessVerdict.ts`, change `reasons.length > 0 ? "invalid"` to `false ? "invalid"`, run the same command, and confirm every test that expects `invalid` fails. Restore the line and confirm all pass again.

- [ ] **Step 6: Run the whole suite, typecheck and commit**

```bash
npm test
npm run typecheck
git add src/lib/audit/loudnessVerdict.ts src/lib/audit/loudnessVerdict.test.ts
git commit -m "feat(audit): verdicts for the loudness harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `npm test` reports no failures and prints nothing else; `npm run typecheck` exits 0.

---

### Task 6: The page

**Files:**
- Create: `loudness-meter-audit-debug-demo.html`
- Create: `src/demos/engine/loudness-meter-audit-debug-demo.tsx`
- Modify: `vite.config.ts` (one line in `rollupOptions.input`, after the `recordingAlignmentAudit` entry)

**Interfaces:**
- Consumes: Task 1 `synthesize`; Task 3 `openSession`, `loadSignal`, `freshMeter`, `playAndCapture`; Task 4 `caseSeconds`, `parseRate`, `rowSpecs`, `selectCases`, `LOUDNESS_CASES`, `LOUDNESS_GROUPS`, `LOUDNESS_RATES`, `LoudnessCase`, `LoudnessGroup`; Task 5 `judgeCapture`, `JudgedRow`, `MetricValues`; `OPENDAW_SDK_VERSION` from `@opendaw/studio-sdk`; `withDeadline` from `src/lib/deadline.ts`.
- Produces: the page at `/loudness-meter-audit-debug-demo.html`. DOM contract: `#run` (the button), `#audit-state[data-audit-state]` walking `idle → setup → running:<caseId> → uploading → done` or `error:<message>`, `#summary-note`, and one table row per result with `data-row-id` and `data-row-status`.

- [ ] **Step 1: Create the HTML entry**

Create `loudness-meter-audit-debug-demo.html`:

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />

    <title>loudness-meter-audit harness (unlisted)</title>

    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
        body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
        }
    </style>
</head>

<body>
    <div id="root"></div>
    <script type="module" src="/src/demos/engine/loudness-meter-audit-debug-demo.tsx"></script>
</body>

</html>
```

- [ ] **Step 2: Add the build input**

In `vite.config.ts`, directly after the line

```ts
                recordingAlignmentAudit: resolve(__dirname, "recording-alignment-audit-debug-demo.html"),
```

add:

```ts
                loudnessMeterAudit: resolve(__dirname, "loudness-meter-audit-debug-demo.html"),
```

- [ ] **Step 3: Write the page**

Create `src/demos/engine/loudness-meter-audit-debug-demo.tsx`:

```tsx
// src/demos/engine/loudness-meter-audit-debug-demo.tsx
// Unlisted harness for the engine's loudness meter. Plays test tones whose loudness is
// known (EBU Tech 3341 and Tech 3342, plus a K-weighting sweep) through the live engine,
// reads the engine's loudness stream, and judges each reading against its tolerance.
// Per case:
//   synthesize -> loadSignal -> freshMeter (worklet restart) -> playAndCapture ->
//   judgeCapture -> table rows.
// A case that throws becomes error rows and the run goes on. At the end the rows are
// uploaded as JSON to the dev server's /__verify sink; without a sink the run still ends
// "done" and says the summary was not saved.
//
// URL contract:
//   ?case=<all|group|id>   default "all". Groups: loudness, range, peak, weighting.
//   ?rate=<48000|44100>    default 48000. The AudioContext's sample rate.
//   ?audible=1             also send the engine to the speakers (silent by default).
//
// DOM contract: #run starts the run (it needs a real click). #audit-state carries
// data-audit-state walking idle -> setup -> running:<caseId> -> uploading -> done, or
// error:<message>. Each result row carries data-row-id and data-row-status.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { withDeadline } from "@/lib/deadline";
import {
  LOUDNESS_CASES,
  LOUDNESS_GROUPS,
  LOUDNESS_RATES,
  caseSeconds,
  parseRate,
  rowSpecs,
  selectCases,
  type LoudnessGroup,
} from "@/lib/audit/loudnessCases";
import { synthesize } from "@/lib/audit/loudnessSignals";
import { judgeCapture, type JudgedRow, type MetricValues } from "@/lib/audit/loudnessVerdict";
import { freshMeter, loadSignal, openSession, playAndCapture } from "./loudnessSession";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Badge, Button, Table } from "@radix-ui/themes";

interface ErrorRow {
  rowId: string;
  caseId: string;
  group: LoudnessGroup;
  status: "error";
  errorMessage: string;
}
type AuditRow = JudgedRow | ErrorRow;

interface AuditEnvelope {
  sdkVersion: string;
  sampleRate: number;
  userAgent: string;
  selector: string;
  startedAt: string;
  rows: AuditRow[];
}

const STATUS_COLOR = { pass: "green", fail: "amber", invalid: "gray", error: "red" } as const;

const dash = "—";
const fixed = (value: number | null | undefined, digits: number = 2): string =>
  value === null || value === undefined || !Number.isFinite(value) ? dash : value.toFixed(digits);
const signed = (value: number | null): string =>
  value === null ? dash : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
const lateText = (late: MetricValues): string =>
  `I ${fixed(late.integrated)} · LRA ${fixed(late.range)} · peak ${fixed(late.peak)}`;

/** Uploads the summary. Returns what to show beside the state; never throws. */
async function uploadSummary(envelope: AuditEnvelope): Promise<string> {
  const name = `loudness-audit-${Date.now()}.json`;
  try {
    await withDeadline(
      (async () => {
        const response = await fetch(`/__verify/${name}`, { method: "PUT", body: JSON.stringify(envelope, null, 2) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      })(),
      30_000,
      "the summary upload"
    );
    return `summary saved as ${name}`;
  } catch (error) {
    console.warn(`[loudness-audit] summary not saved: ${String(error)}`);
    return `summary not saved (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function runAudit(setState: (state: string) => void, onRow: (row: AuditRow) => void): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const selector = params.get("case");
  // Both throw for a bad parameter, before any audio starts.
  const cases = selectCases(selector);
  const rate = parseRate(params.get("rate"));
  const startedAt = new Date().toISOString();

  setState("setup");
  const session = await openSession(rate, params.get("audible") === "1");
  const sampleRate = session.audioContext.sampleRate;
  const rows: AuditRow[] = [];
  const add = (row: AuditRow) => {
    rows.push(row);
    onRow(row);
  };

  for (const testCase of cases) {
    setState(`running:${testCase.id}`);
    try {
      loadSignal(session, synthesize(testCase.segments, sampleRate, testCase.taperMs), testCase.id);
      await freshMeter(session);
      const capture = await playAndCapture(session, caseSeconds(testCase));
      judgeCapture(testCase, sampleRate, capture).forEach(add);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[loudness-audit] case ${testCase.id} failed: ${errorMessage}`);
      for (const spec of rowSpecs(testCase, sampleRate)) {
        add({ rowId: spec.rowId, caseId: testCase.id, group: testCase.group, status: "error", errorMessage });
      }
    }
  }

  setState("uploading");
  const note = await uploadSummary({
    sdkVersion: OPENDAW_SDK_VERSION,
    sampleRate,
    userAgent: navigator.userAgent,
    selector: selector ?? "all",
    startedAt,
    rows,
  });
  setState("done");
  return note;
}

function ResultRow({ row }: { row: AuditRow }) {
  if (row.status === "error") {
    return (
      <Table.Row data-row-id={row.rowId} data-row-status="error">
        <Table.Cell>{row.rowId}</Table.Cell>
        <Table.Cell colSpan={5}>{row.errorMessage}</Table.Cell>
        <Table.Cell>
          <Badge color="red">error</Badge>
        </Table.Cell>
      </Table.Row>
    );
  }
  const lines = (text: (index: number) => string) =>
    row.metrics.map((metric, index) => <div key={metric.metric}>{text(index)}</div>);
  const worst = row.delivered.reduce(
    (highest, check) =>
      check.deliveredDb === null ? highest : Math.max(highest, Math.abs(check.deliveredDb - check.intendedDb)),
    0
  );
  return (
    <Table.Row data-row-id={row.rowId} data-row-status={row.status}>
      <Table.Cell>{row.rowId}</Table.Cell>
      <Table.Cell>
        {lines((i) => {
          const metric = row.metrics[i];
          return `${metric.metric} ${metric.expected.toFixed(2)} ${metric.unit} +${metric.tolerancePlus}/−${metric.toleranceMinus}`;
        })}
      </Table.Cell>
      <Table.Cell>{lines((i) => fixed(row.metrics[i].got))}</Table.Cell>
      <Table.Cell>{lines((i) => signed(row.metrics[i].error))}</Table.Cell>
      <Table.Cell title={row.delivered.map((check) => `${check.label} ${fixed(check.deliveredDb, 3)}`).join("\n")}>
        {row.delivered.length} checks, worst {worst.toFixed(3)} dB
      </Table.Cell>
      <Table.Cell>{lateText(row.late)}</Table.Cell>
      <Table.Cell>
        <Badge color={STATUS_COLOR[row.status]} title={row.reasons.join("\n")}>
          {row.status}
        </Badge>
        {row.reasons.map((reason) => (
          <div key={reason}>
            <Text size="1" color="gray">
              {reason}
            </Text>
          </div>
        ))}
      </Table.Cell>
    </Table.Row>
  );
}

function LoudnessAudit() {
  const [auditState, setAuditState] = useState("idle");
  const [summaryNote, setSummaryNote] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);

  const run = () => {
    setRows([]);
    runAudit(setAuditState, (row) => setRows((previous) => [...previous, row]))
      .then(setSummaryNote)
      .catch((error) => {
        console.error(`[loudness-audit] ${String(error)}`);
        setAuditState(`error:${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const count = (status: AuditRow["status"]) => rows.filter((row) => row.status === status).length;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Loudness Meter Audit Harness
          </Heading>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Button id="run" onClick={run} disabled={auditState !== "idle"}>
                Run
              </Button>
              <Text size="2" weight="bold">
                State:
              </Text>
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
              <Text size="2" color="gray">
                {rows.length} row{rows.length === 1 ? "" : "s"} — {count("pass")} pass, {count("fail")} fail,{" "}
                {count("invalid")} invalid, {count("error")} error
              </Text>
              <Text id="summary-note" size="2" color="gray">
                {summaryNote}
              </Text>
            </Flex>
            <Text as="p" size="2" color="gray" style={{ marginTop: "0.5rem" }}>
              The run is silent and takes about twelve minutes for every case. Keep this tab visible: a hidden tab
              stops receiving the meter's readings and its cases are marked invalid.
            </Text>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>meter</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>error</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>delivered signal</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>5 s after the end</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>verdict</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <ResultRow key={row.rowId} row={row} />
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>
              Configuration
            </Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?case=<all|group|id>   default "all"
                       groups: ${LOUDNESS_GROUPS.join(", ")}
                       ids:    ${LOUDNESS_CASES.map((testCase) => testCase.id).join(", ")}
?rate=<${LOUDNESS_RATES.join("|")}>    default ${LOUDNESS_RATES[0]}
?audible=1             also play the run through the speakers
pass     every judged reading within its tolerance
fail     a judged reading outside its tolerance
invalid  the signal did not reach the meter as synthesized, or the tab was hidden
error    the case threw or timed out
Uploads: loudness-audit-<timestamp>.json (all rows) via PUT /__verify`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<LoudnessAudit />);
```

- [ ] **Step 4: Typecheck and run the unit suite**

```bash
npm run typecheck
npm test
```

Expected: both exit 0.

- [ ] **Step 5: Browser check — bad parameters fail at once**

Dev server on 5180 as in Task 3. In the Playwright MCP browser:

1. Navigate to `https://localhost:5180/loudness-meter-audit-debug-demo.html?case=nope`, click Run with a real click.
   Expected within a second: `#audit-state` reads `error:unknown ?case= "nope" (use one of: all, loudness, …)` and no row appears.
2. Navigate to `…/loudness-meter-audit-debug-demo.html?rate=abc`, click Run.
   Expected: `error:unsupported ?rate= "abc" (use 48000 or 44100)`.

Read the state with `document.querySelector("#audit-state").dataset.auditState`.

- [ ] **Step 6: Browser check — one loudness case end to end**

1. Navigate to `…/loudness-meter-audit-debug-demo.html?case=3341-1`, click Run with a real click, keep the tab visible, edit nothing.
2. Wait for `data-audit-state` to be `done` (about 35 seconds).
3. Read the row: `document.querySelector('[data-row-id="3341-1"]').innerText` and its `dataset.rowStatus`.

Expected: the row is `pass` or `fail`, not `invalid` or `error`; "delivered signal" shows `2 checks, worst 0.0xx dB` with worst at most 0.020; the meter column has three numbers; `#summary-note` reads `summary saved as loudness-audit-<n>.json`, and that file exists under `.verify-output/`. From the Node measurements the three readings should be near −23.25 and the verdict `fail`.

If the row is `invalid` or `error`, read its reasons, fix the cause, and repeat this step before going on.

- [ ] **Step 7: Browser check — the peak group and the sweep**

1. Navigate to `…?case=peak`, click Run, wait for `done` (about 50 seconds). Expected: four rows, none `invalid` or `error`; each has `3 checks`.
2. Navigate to `…?case=weighting`, click Run, wait for `done` (about 2 minutes). Expected: fifteen rows `kweight-25` … `kweight-20000`, none `invalid` or `error`.

- [ ] **Step 8: Browser check — the run survives a missing sink**

In the Playwright browser, on a fresh load of `…?case=3341-15`, before clicking Run, make the upload fail by evaluating:

```js
const realFetch = window.fetch;
window.fetch = (input, init) =>
  String(input).startsWith("/__verify/") ? Promise.resolve(new Response("", { status: 404 })) : realFetch(input, init);
```

Click Run and wait. Expected: state `done`, one row present, and `#summary-note` reads `summary not saved (HTTP 404)`.

- [ ] **Step 9: Prove the build includes the page**

Run: `npm run build`
Expected: exit 0, and `dist/loudness-meter-audit-debug-demo.html` exists.

- [ ] **Step 10: Commit**

```bash
git add loudness-meter-audit-debug-demo.html src/demos/engine/loudness-meter-audit-debug-demo.tsx vite.config.ts
git commit -m "feat(audit): a harness page that judges the engine's loudness meter against the EBU test signals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The full run, the register and the documentation

**Files:**
- Modify: `debug/2026-10-02-loudness-meter/note.md` (complete it)
- Modify: `debug/README.md` (one index row, at the top of the table)
- Modify: `CLAUDE.md` (one bullet under "Build & Verification", after the recording start-alignment sweep bullet)
- Modify: `src/demos/engine/CLAUDE.md` (one section, before "## Reference Files")
- Delete: `docs/superpowers/specs/2026-10-02-loudness-meter-harness-design.md`, `docs/superpowers/plans/2026-10-02-loudness-meter-harness.md`

**Interfaces:**
- Consumes: the page from Task 6 and the summaries it saves under `.verify-output/`.
- Produces: the register every later sweep is compared with.

- [ ] **Step 1: Run every case at 48 kHz**

In the Playwright MCP browser, on a fresh load of `https://localhost:5180/loudness-meter-audit-debug-demo.html?case=all`: click Run with a real click, keep the tab visible, edit no file, and wait for `data-audit-state` to be `done` (about twelve minutes; poll every 60 seconds).

Expected: 28 rows, none `invalid` or `error`. If any is, read its reasons, resolve the cause and re-run that case with `?case=<id>` before going on. Note the summary file name from `#summary-note`.

- [ ] **Step 2: Run every case at 44.1 kHz**

Fresh load of `…?case=all&rate=44100`, same procedure. Expected: 28 rows, none `invalid` or `error`.

- [ ] **Step 3: Compare with what was expected**

From the Node measurements made before the harness existed, the expectation was: the five loudness cases `fail` near −0.25 LU; the four range cases `pass`; `3341-15` passes and `3341-16`, `-17`, `-18` `fail` at about −3.0, −1.3 and −0.7 dB; the sweep fails from 1000 to 3000 Hz and passes elsewhere.

Build the register rows from the two summary files:

```bash
node -e '
const fs = require("fs");
for (const file of process.argv.slice(1)) {
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`\n${file}: SDK ${run.sdkVersion}, ${run.sampleRate} Hz`);
  for (const row of run.rows) {
    const metrics = (row.metrics ?? []).map(m => `${m.metric} ${m.got === null ? "none" : m.got.toFixed(2)} (${m.error === null ? "n/a" : (m.error >= 0 ? "+" : "") + m.error.toFixed(2)})`).join(", ");
    const late = row.late ? `late I ${row.late.integrated?.toFixed(2)} LRA ${row.late.range?.toFixed(2)}` : "";
    console.log(`| ${row.rowId} | ${row.status} | ${metrics} | ${late} |`);
  }
}' .verify-output/<48k summary>.json .verify-output/<44.1k summary>.json
```

Any row that differs from the expectation above is a finding about the engine path or the harness. Resolve it, or state it plainly in the note under "What differs from the Node measurements", before the register is written.

- [ ] **Step 4: Complete the debug note**

Append to `debug/2026-10-02-loudness-meter/note.md`, below the probe section, filling every table from the two summary files (no cell left empty; write the reading and its error exactly as the summary has them):

````markdown
## What is measured

The engine worklet runs a loudness meter on its main stereo output while something is
subscribed to `EngineAddresses.LOUDNESS`, and publishes
`[momentary, shortTerm, integrated, loudnessRange, peak]`. The harness plays tones whose
loudness is known through a Tape track at unity gain and judges what the meter reads:

- EBU Tech 3341 (2023), Table 1, cases 1–5 (loudness) and 15–18 (true peak).
- EBU Tech 3342 (2023), Table 1, cases 1–4 (loudness range).
- A sweep of fifteen tones against the ITU-R BS.1770 K-weighting response.

A tap on the engine's output confirms each tone arrived at its synthesized level before the
meter is judged. The meter has no reset, and both EBU documents require one before each
measurement, so each case runs on a restarted worklet.

## How to run

`loudness-meter-audit-debug-demo.html?case=all` (add `&rate=44100` for the second rate). Click
Run, keep the tab visible. About twelve minutes, silent unless `&audible=1`. The summary lands
in `.verify-output/loudness-audit-<timestamp>.json`.

## Register

### SDK <version>, 48 kHz, <date>, <browser and version>

| Row | Verdict | Meter (error) | 5 s after the end |
|---|---|---|---|
<one line per row, from the script in the plan>

### SDK <version>, 44.1 kHz, <date>, <browser and version>

| Row | Verdict | Meter (error) | 5 s after the end |
|---|---|---|---|
<one line per row>

## Observed

<One bullet per observation, each a statement of what the rows show and nothing more. Write
only those the runs support:>

- Tones at 1 kHz read <n> LU below their level in every loudness case.
- The range cases read <n>.
- The fifth value equals the delivered sample peak in cases 15–18: <readings> against
  delivered sample peaks of <values>.
- The sweep is within tolerance below <n> Hz and above <n> Hz, and low by up to <n> LU between.
- Five seconds after the signal ends, integrated reads <same / changed by n> and range reads
  <same / changed by n>.

## Inferred from the source, not observed

Read in `studio-core-wasm/src/analysis-dsp.ts` at the version above. These are readings of the
code, and the rows above do not prove them:

- The K-weighting shelf is built with lib-dsp's general high-shelf, and the high-pass is
  normalized to unity; BS.1770's two stages differ from both.
- The fifth value is `max(|l|, |r|)` per sample; the comment above the class says 4x
  oversampled.
- Blocks are 100 ms without overlap; BS.1770 gates 400 ms blocks at 75 % overlap.

## What differs from the Node measurements

<"Nothing." or one bullet per difference with what resolved it.>
````

Delete the instruction lines in angle brackets as each is filled. The note must not contain a `<` placeholder when this step is done: check with `rg -n "<[a-z0-9 /.,]+>" debug/2026-10-02-loudness-meter/note.md` (expected: no output).

- [ ] **Step 5: Add the index row**

In `debug/README.md`, add as the first row of the index table (directly under the `|---|---|…` separator line):

```markdown
| 2026-10-02 | [loudness-meter](./2026-10-02-loudness-meter/note.md) | What the engine's loudness meter reads for the EBU Tech 3341 / 3342 test signals and a K-weighting sweep, played through the live engine. | **Standing sweep** after SDK upgrades | [`loudness-meter-audit-debug-demo.html`](../loudness-meter-audit-debug-demo.html) |  |
```

- [ ] **Step 6: Add the standing sweep to `CLAUDE.md`**

In `CLAUDE.md`, under "## Build & Verification", directly after the bullet that begins "After SDK upgrades, also re-run the standing recording start-alignment sweep" (it ends "…carry no predictive content on them."), add:

```markdown
- After SDK upgrades, also re-run the standing loudness meter sweep:
  `loudness-meter-audit-debug-demo.html?case=all` (then `&rate=44100`) — a real click on Run,
  the tab visible throughout, about twelve minutes, silent unless `&audible=1`. Compare the
  rows with the register in `debug/2026-10-02-loudness-meter/note.md`: a row that changed is
  the finding, a `fail` the register already lists is not. Cases and tolerances:
  `src/lib/audit/loudnessCases.ts`; verdicts: `src/lib/audit/loudnessVerdict.ts`.
```

- [ ] **Step 7: Document the loudness stream in `src/demos/engine/CLAUDE.md`**

Directly before the line `## Reference Files`, add the section below. Keep only the bullets the runs support, and state the third bullet as the register shows it:

```markdown
## Loudness Stream (Live Only)
- `project.liveStreamReceiver.subscribeFloats(EngineAddresses.LOUDNESS, values => …)` delivers
  `[momentary, shortTerm, integrated]` in LUFS, `loudnessRange` in LU and `peak` in dB, measured
  on the engine's main stereo output. `EngineAddresses` comes from `@opendaw/studio-adapters`.
  The array is reused: copy the numbers out inside the callback.
- The meter runs only while the address has a subscriber, and it has no reset: integrated and
  range accumulate for the life of the worklet processor, across play and stop. An empty meter
  needs a restarted worklet — `freshMeter` in `loudnessSession.ts` (a new `LiveStreamReceiver`
  on the project, then `project.startAudioWorklet()`).
- The fifth value is the highest sample, not an oversampled true peak.
- The offline renderer does not run the meter and the class is not importable, so a rendered
  file cannot be measured with SDK code.
- `startAudioWorklet()` connects the engine to the speakers. To measure in silence, disconnect
  it and route it through a node that outputs nothing (the harness's tap worklet).
- What the readings are for signals of known loudness, per SDK version:
  `debug/2026-10-02-loudness-meter/note.md`. Harness: `loudness-meter-audit-debug-demo.html`.
```

- [ ] **Step 8: Check the documentation rules**

```bash
git diff main --stat
git diff main -- . ':!debug' ':!changelogs' ':!docs/superpowers' | rg -n "^\+.*0\.0\.1[0-9]{2}"
```

Expected: the second command prints nothing (no SDK version outside `debug/`).

- [ ] **Step 9: Remove the spec and the plan, verify, commit**

The spec's durable content now lives in the debug note, the two `CLAUDE.md` files and the code.

```bash
git rm docs/superpowers/specs/2026-10-02-loudness-meter-harness-design.md docs/superpowers/plans/2026-10-02-loudness-meter-harness.md
npm run typecheck
npm test
npm run build
git add debug/2026-10-02-loudness-meter/note.md debug/README.md CLAUDE.md src/demos/engine/CLAUDE.md
git commit -m "docs(audit): the loudness meter's readings registered, and the sweep made standing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: all three checks exit 0.

- [ ] **Step 10: Open the pull request and review it**

Push the branch and open a PR against `main` whose body states what the harness measures, the register's headline results, and how to run it, ending with the Claude Code attribution line. Then run `/pr-review-toolkit:review-pr` on it, fix every Critical and Important finding on the branch, and keep the PR body describing the current state. Do not merge without the user's word.
