# Input-Latency Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a loopback input-latency calibration routine to the openDAW SDK (MLS bursts scheduled on the AudioContext clock, analysed in the SDK worker), store its result per input device, make take placement use it, and verify it against a known injected delay with this repo's harness.

**Architecture:** Pure DSP and the worker protocol live in `lib-dsp`; the worker executor is registered in `studio-core-workers`; `studio-core` gets a typed `Workers.LatencyCalibration` sender, a minimal capture worklet, the `InputLatencyCalibration.measure` routine, a `calibrated` rung in `InputLatency.resolveWithSource`, an array-valued preference `recording.inputLatencyCalibrations`, and `CaptureAudio.calibrateInputLatency`/`clearInputLatencyCalibration`. This repo gets a debug page that runs the routine through the loopback injection with a `DelayNode` of known delay, then records a harness cell with the result applied.

**Tech Stack:** TypeScript, Web Audio (`AudioWorkletNode`, `AudioBufferSourceNode`), `@opendaw/lib-dsp` `FFT`, `@opendaw/lib-runtime` `Communicator`/`Messenger`, vitest, zod (preferences schema), Vite dev server + `SDK_DIST_OVERRIDE` (this repo).

**Spec:** `docs/superpowers/specs/2026-09-02-input-latency-calibration-design.md`

## Global Constraints

- **Two repositories.** Tasks 1–9 run in `/Users/naomiaro/Code/openDAWOriginal` on branch `feat/input-latency-calibration`, created in Task 1 FROM `feat/reported-input-latency` (PR #378) with `fix/recording-start-alignment` (PR #376) merged in. Tasks 10–12 run in `/Users/naomiaro/Code/opendaw-test` on branch `input-latency-calibration`. The openDAW checkout must be returned to `git checkout "@opendaw/studio-sdk@0.0.170"` at the end of every task that touches it, and stated in the report.
- **No origin naming:** committed text, commit messages and drafts never name the downstream fork the earlier fixes came from; greplist in the gitignored `/Users/naomiaro/Code/opendaw-test/.claude/local.md` ("Recording Start-Alignment Audit"). Grep every diff and message; zero hits.
- **No session links:** commit messages end with only `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no `Claude-Session:` line, no claude.ai URLs anywhere.
- **Attribution:** the module doc comment of `packages/lib/dsp/src/latency-calibration.ts` carries, verbatim: `Gil Panal, J. M., Richard, G., & David, A. (2025). A Maximum Length Sequence–Based Method for Robust Round-Trip Latency Estimation in online Digital Audio Workstations. In Proceedings of the Web Audio Conference (WAC 2025). https://doi.org/10.5281/zenodo.17642262` and `Reference implementation: https://github.com/gilpanal/weblatencytest (MIT)`, plus one sentence: taken = MLS probe, correlation-peak location, peak-to-mean ratio gate; differs = emission and arrival anchored on the AudioContext clock instead of `MediaRecorder.start()`. No code is copied from that repository.
- **Constants (spec §3):** MLS order 15; burst count 3; burst spacing = MLS length + 0.5 s; gain −12 dBFS; first burst ≥ 0.1 s after the routine begins; search window `maxRoundTripSeconds` 0.6; ratio gate 18 dB; `ok` requires every scheduled burst identified AND spread ≤ 0.001 s; output-latency mismatch note bound 0.002 s. All named constants.
- **Resolution order (spec §4.4):** per-capture override (unless `Inherit`) → calibration entry for the capture's device id → engine preference (`Reported` default / `EqualsOutput` / number).
- **Store shape:** `recording.inputLatencyCalibrations: ReadonlyArray<{deviceId: string, inputLatency: number, outputLatencyAtCalibration: number, spread: number, measuredAt: number}>`, default `[]`, replaced wholesale on write and clear (the preferences proxy does not deep-proxy arrays and has no delete trap).
- **Upstream style:** no single-letter lambda parameters; `Optional<T>` from `@opendaw/lib-std` for optional parameters; comments describe mechanism only, no measurement claims; TDD for every pure module; `npm test` in the touched package green before each commit; scoped build `npx turbo run build --filter=@opendaw/lib-dsp --filter=@opendaw/studio-core --filter=@opendaw/studio-core-processors --filter=@opendaw/studio-core-workers` green.
- **This repo:** `npx tsc --noEmit 2>&1 | grep -E '^(src|scripts)/'` empty and `npx vitest run` green before each commit; unlisted debug demo (`<meta name="robots" content="noindex, nofollow">`, NOT in `src/index.tsx`/sitemap/README, IS in `vite.config.ts` rollup input); `/__verify` sink names match `^[a-z0-9-]+\.(wav|json)$`; log strings not objects; Option types via `.isEmpty()`/`.unwrap()`.
- **Nothing is pushed or posted by any task.** Task 9 produces a draft; the controller/user push.

---

## File structure

Upstream (`openDAWOriginal`):
- Create `packages/lib/dsp/src/latency-calibration.ts` — MLS, FFT correlation, peak refinement, ratio, `analyzeBursts`, protocol + types. One responsibility: pure analysis.
- Create `packages/lib/dsp/src/latency-calibration.test.ts`.
- Modify `packages/lib/dsp/src/index.ts` — export the module.
- Modify `packages/studio/core-workers/src/workers-main.ts` — executor on channel `"latency-calibration"`.
- Modify `packages/studio/core/src/Workers.ts` — `LatencyCalibration` sender.
- Create `packages/studio/core-processors/src/LatencyCaptureProcessor.ts`; modify `packages/studio/core-processors/src/register.ts`.
- Create `packages/studio/core/src/capture/LatencyCaptureNode.ts` — main-thread wrapper of the processor.
- Create `packages/studio/core/src/capture/InputLatencyCalibration.ts` + `.test.ts` — the routine.
- Modify `packages/studio/core/src/capture/InputLatency.ts` + `.test.ts` — `calibrated` rung.
- Modify `packages/studio/adapters/src/engine/EnginePreferencesSchema.ts` — the array preference.
- Modify `packages/studio/core/src/capture/CaptureAudio.ts` + `CaptureAudio.test.ts` — lookup in the latency provider, `calibrateInputLatency`, `clearInputLatencyCalibration`.
- Modify `packages/studio/core/src/capture/index.ts` — exports.

This repo (`opendaw-test`):
- Modify `src/lib/audit/loopbackInjection.ts` — `setReturnDelay(seconds)` on `LoopbackHandle`.
- Create `input-latency-calibration-debug-demo.html`, `src/demos/recording/input-latency-calibration-debug-demo.tsx`.
- Modify `vite.config.ts` (rollup input), `debug/recording-start-alignment-audit.md` (new section), `src/demos/recording/CLAUDE.md`, root `CLAUDE.md` (sweep line), `debug/README.md`.
- Delete `docs/superpowers/specs/2026-09-02-input-latency-calibration-design.md` and this plan in the final task.

---

### Task 1: Branch setup and MLS generation (lib-dsp)

**Files:**
- Create: `packages/lib/dsp/src/latency-calibration.ts`
- Create: `packages/lib/dsp/src/latency-calibration.test.ts`
- Modify: `packages/lib/dsp/src/index.ts` (add `export * from "./latency-calibration"` next to the `./bpm-protocol` line)

**Interfaces:**
- Produces: `generateMls(order: int): Float32Array` — values are exactly `+1` or `−1`, length `2^order − 1`, deterministic (LFSR seeded with all ones).
- Produces: `MLS_TAPS: ReadonlyMap<int, ReadonlyArray<int>>` for orders 10–16.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/naomiaro/Code/openDAWOriginal
git fetch fork
git checkout -b feat/input-latency-calibration fork/feat/reported-input-latency
git merge --no-edit fork/fix/recording-start-alignment
# Resolve the single expected conflict in packages/studio/core/src/capture/CaptureAudio.ts:
# keep #376's readLatency() provider AND pass #378's fourth argument
# `trackSettings?.latency` to InputLatency.resolve inside it. Then:
cd packages/studio/core && npm test && cd ../../..
git log --oneline -6
```
Expected: both PR histories present; studio-core tests green (count ≥ 432 + 422 − shared ≈ the union; report the number).

- [ ] **Step 2: Write the failing MLS tests**

`packages/lib/dsp/src/latency-calibration.test.ts`:
```ts
import {describe, expect, test} from "vitest"
import {generateMls} from "./latency-calibration"

describe("generateMls", () => {
    test("has length 2^order − 1 and values ±1", () => {
        const mls = generateMls(10)
        expect(mls.length).toBe(1023)
        for (const value of mls) {expect(Math.abs(value)).toBe(1)}
    })
    test("is balanced: one more +1 than −1", () => {
        const mls = generateMls(10)
        let sum = 0
        for (const value of mls) {sum += value}
        expect(sum).toBe(1)
    })
    test("circular autocorrelation is N at lag 0 and −1 elsewhere", () => {
        const order = 10
        const mls = generateMls(order)
        const length = mls.length
        const autocorrelation = (lag: number): number => {
            let sum = 0
            for (let index = 0; index < length; index++) {
                sum += mls[index] * mls[(index + lag) % length]
            }
            return sum
        }
        expect(autocorrelation(0)).toBe(length)
        for (const lag of [1, 2, 7, 100, 511, 1022]) {expect(autocorrelation(lag)).toBe(-1)}
    })
    test("is deterministic", () => {
        expect(Array.from(generateMls(12))).toEqual(Array.from(generateMls(12)))
    })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/lib/dsp && npx vitest run src/latency-calibration.test.ts`
Expected: FAIL — cannot resolve `./latency-calibration`.

- [ ] **Step 4: Implement `generateMls`**

`packages/lib/dsp/src/latency-calibration.ts` (module header carries the attribution from Global Constraints):
```ts
/**
 * Input-latency calibration analysis: an MLS probe located by cross-correlation.
 *
 * The probe and its trust figure follow:
 *   Gil Panal, J. M., Richard, G., & David, A. (2025). A Maximum Length Sequence–Based Method for
 *   Robust Round-Trip Latency Estimation in online Digital Audio Workstations.
 *   In Proceedings of the Web Audio Conference (WAC 2025). https://doi.org/10.5281/zenodo.17642262
 *   Reference implementation: https://github.com/gilpanal/weblatencytest (MIT)
 * Taken from that work: the MLS probe, locating it by the cross-correlation peak, and the
 * peak-to-mean ratio as the gate for a trustworthy estimate. Different here: the burst's emission
 * time and the capture's first-frame time are both AudioContext clock readings, so the delay is
 * measured against the engine's own clock rather than against MediaRecorder.start(). No code is
 * copied from that repository.
 */
import {int} from "@opendaw/lib-std"

/** Primitive-polynomial taps per register length; x^n + x^a + … + 1 with the constant term implied. */
export const MLS_TAPS: ReadonlyMap<int, ReadonlyArray<int>> = new Map<int, ReadonlyArray<int>>([
    [10, [10, 7]],
    [11, [11, 9]],
    [12, [12, 11, 10, 4]],
    [13, [13, 12, 11, 8]],
    [14, [14, 13, 12, 2]],
    [15, [15, 14]],
    [16, [16, 15, 13, 4]]
])

/** A maximum-length sequence of the given register order as ±1 samples, length 2^order − 1. */
export const generateMls = (order: int): Float32Array => {
    const taps = MLS_TAPS.get(order)
    if (taps === undefined) {throw new Error(`No MLS taps for order ${order}`)}
    const length = (1 << order) - 1
    const sequence = new Float32Array(length)
    let register = (1 << order) - 1 // all ones; any non-zero seed works
    for (let index = 0; index < length; index++) {
        sequence[index] = (register & 1) === 1 ? 1.0 : -1.0
        let feedback = 0
        for (const tap of taps) {feedback ^= (register >>> (tap - 1)) & 1}
        register = (register >>> 1) | (feedback << (order - 1))
    }
    return sequence
}
```
Add to `packages/lib/dsp/src/index.ts`: `export * from "./latency-calibration"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/lib/dsp && npx vitest run src/latency-calibration.test.ts`
Expected: 4 passed. If "balanced" or "autocorrelation" fails, the tap set is not primitive for that order — the table above is the standard one (Fibonacci form); check the shift direction before changing taps.

- [ ] **Step 6: Commit**

```bash
git add packages/lib/dsp/src/latency-calibration.ts packages/lib/dsp/src/latency-calibration.test.ts packages/lib/dsp/src/index.ts
git commit -m "feat(dsp): maximum-length-sequence generator for latency calibration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: FFT cross-correlation, peak refinement and ratio (lib-dsp)

**Files:**
- Modify: `packages/lib/dsp/src/latency-calibration.ts`
- Modify: `packages/lib/dsp/src/latency-calibration.test.ts`

**Interfaces:**
- Consumes: `FFT` from `./fft` (`new FFT(n)`, `process(real, imag)`, `inverse(real, imag)` — inverse is normalized; n must be a power of two).
- Produces: `crossCorrelate(segment: Float32Array, reference: Float32Array, maxLag: int): Float32Array` — `result[lag] = Σ_n segment[n + lag] · reference[n]` for `lag ∈ [0, maxLag]`.
- Produces: `refinePeak(correlation: Float32Array, index: int): number` — sub-sample offset in `(−0.5, 0.5)` by parabolic interpolation; `0` at the edges.
- Produces: `peakToMeanRatioDb(correlation: Float32Array, index: int): number` — `10·log10(peak² / mean(others²))`.

- [ ] **Step 1: Write the failing tests**

Append to the test file:
```ts
import {crossCorrelate, peakToMeanRatioDb, refinePeak} from "./latency-calibration"

const delayed = (reference: Float32Array, delaySamples: number, totalLength: number, gain = 1.0): Float32Array => {
    const out = new Float32Array(totalLength)
    const whole = Math.floor(delaySamples)
    const fraction = delaySamples - whole
    for (let index = 0; index < reference.length; index++) {
        // linear interpolation between neighbouring output samples for a fractional delay
        const target = index + whole
        if (target < totalLength) {out[target] += reference[index] * (1 - fraction) * gain}
        if (target + 1 < totalLength) {out[target + 1] += reference[index] * fraction * gain}
    }
    return out
}

describe("crossCorrelate", () => {
    const reference = generateMls(10)
    test("peaks at the integer delay", () => {
        const segment = delayed(reference, 137, 2048)
        const correlation = crossCorrelate(segment, reference, 400)
        let best = 0
        for (let lag = 1; lag <= 400; lag++) {if (correlation[lag] > correlation[best]) {best = lag}}
        expect(best).toBe(137)
        expect(correlation[137]).toBeCloseTo(reference.length, 0)
    })
    test("matches the direct definition for a few lags", () => {
        const segment = delayed(reference, 5, 1400)
        const correlation = crossCorrelate(segment, reference, 20)
        for (const lag of [0, 3, 5, 9]) {
            let direct = 0
            for (let index = 0; index < reference.length; index++) {direct += segment[index + lag] * reference[index]}
            expect(correlation[lag]).toBeCloseTo(direct, 2)
        }
    })
    test("recovers a fractional delay within 0.1 sample after refinement", () => {
        const segment = delayed(reference, 137.3, 2048)
        const correlation = crossCorrelate(segment, reference, 400)
        let best = 0
        for (let lag = 1; lag <= 400; lag++) {if (correlation[lag] > correlation[best]) {best = lag}}
        expect(best + refinePeak(correlation, best)).toBeCloseTo(137.3, 1)
    })
    test("still locates the peak at 0 dB SNR with a strong ratio", () => {
        const segment = delayed(reference, 137, 2048)
        let seed = 12345
        const random = (): number => {seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1}
        for (let index = 0; index < segment.length; index++) {segment[index] += random()}
        const correlation = crossCorrelate(segment, reference, 400)
        let best = 0
        for (let lag = 1; lag <= 400; lag++) {if (correlation[lag] > correlation[best]) {best = lag}}
        expect(best).toBe(137)
        expect(peakToMeanRatioDb(correlation, best)).toBeGreaterThan(18)
    })
    test("a delayed attenuated copy does not move the peak", () => {
        const segment = delayed(reference, 137, 2048)
        const echo = delayed(reference, 190, 2048, 0.5)
        for (let index = 0; index < segment.length; index++) {segment[index] += echo[index]}
        const correlation = crossCorrelate(segment, reference, 400)
        let best = 0
        for (let lag = 1; lag <= 400; lag++) {if (correlation[lag] > correlation[best]) {best = lag}}
        expect(best).toBe(137)
    })
})

describe("refinePeak", () => {
    test("returns 0 for a symmetric peak and the parabola vertex otherwise", () => {
        expect(refinePeak(new Float32Array([1, 3, 1]), 1)).toBeCloseTo(0, 6)
        expect(refinePeak(new Float32Array([2, 3, 1]), 1)).toBeCloseTo(-0.25, 6)
        expect(refinePeak(new Float32Array([1, 3, 2]), 1)).toBeCloseTo(0.25, 6)
    })
    test("returns 0 at the array edges", () => {
        expect(refinePeak(new Float32Array([3, 1, 1]), 0)).toBe(0)
        expect(refinePeak(new Float32Array([1, 1, 3]), 2)).toBe(0)
    })
})

describe("peakToMeanRatioDb", () => {
    test("is large for a lone peak and small for flat data", () => {
        const lone = new Float32Array(1000).fill(0.01)
        lone[400] = 1
        expect(peakToMeanRatioDb(lone, 400)).toBeGreaterThan(30)
        const flat = new Float32Array(1000).fill(1)
        expect(peakToMeanRatioDb(flat, 400)).toBeCloseTo(0, 6)
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/lib/dsp && npx vitest run src/latency-calibration.test.ts`
Expected: FAIL — `crossCorrelate`, `refinePeak`, `peakToMeanRatioDb` not exported.

- [ ] **Step 3: Implement**

Append to `latency-calibration.ts`:
```ts
import {FFT} from "./fft"

const nextPowerOfTwo = (value: int): int => 1 << Math.ceil(Math.log2(value))

/**
 * result[lag] = Σ_n segment[n + lag] · reference[n], for lag in [0, maxLag], computed through an FFT
 * of size ≥ segment.length + reference.length so the circular correlation carries no wrap-around.
 */
export const crossCorrelate = (segment: Float32Array, reference: Float32Array, maxLag: int): Float32Array => {
    const size = nextPowerOfTwo(segment.length + reference.length)
    const fft = new FFT(size)
    const segmentReal = new Float32Array(size)
    const segmentImag = new Float32Array(size)
    const referenceReal = new Float32Array(size)
    const referenceImag = new Float32Array(size)
    segmentReal.set(segment)
    referenceReal.set(reference)
    fft.process(segmentReal, segmentImag)
    fft.process(referenceReal, referenceImag)
    // S · conj(R)
    for (let bin = 0; bin < size; bin++) {
        const real = segmentReal[bin] * referenceReal[bin] + segmentImag[bin] * referenceImag[bin]
        const imag = segmentImag[bin] * referenceReal[bin] - segmentReal[bin] * referenceImag[bin]
        segmentReal[bin] = real
        segmentImag[bin] = imag
    }
    fft.inverse(segmentReal, segmentImag)
    return segmentReal.slice(0, Math.min(maxLag + 1, size))
}

/** Sub-sample offset of the vertex of the parabola through the peak and its two neighbours. */
export const refinePeak = (correlation: Float32Array, index: int): number => {
    if (index <= 0 || index >= correlation.length - 1) {return 0.0}
    const left = correlation[index - 1]
    const centre = correlation[index]
    const right = correlation[index + 1]
    const denominator = left - 2.0 * centre + right
    return denominator === 0.0 ? 0.0 : 0.5 * (left - right) / denominator
}

/** 10·log10 of the peak's power over the mean power of every other lag. */
export const peakToMeanRatioDb = (correlation: Float32Array, index: int): number => {
    const peakPower = correlation[index] * correlation[index]
    let sum = 0.0
    for (let lag = 0; lag < correlation.length; lag++) {
        if (lag !== index) {sum += correlation[lag] * correlation[lag]}
    }
    const meanPower = sum / Math.max(1, correlation.length - 1)
    return meanPower === 0.0 ? Number.POSITIVE_INFINITY : 10.0 * Math.log10(peakPower / meanPower)
}
```
If `FFT.inverse` turns out NOT to divide by `n` (check `fft.ts` lines 71–80 — the existing test says it recovers the original, so it does), scale `segmentReal` by `1 / size` before slicing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/lib/dsp && npx vitest run src/latency-calibration.test.ts`
Expected: all passed (4 + 8).

- [ ] **Step 5: Commit**

```bash
git add packages/lib/dsp/src/latency-calibration.ts packages/lib/dsp/src/latency-calibration.test.ts
git commit -m "feat(dsp): FFT cross-correlation, peak refinement and peak-to-mean ratio for latency calibration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `analyzeBursts` and the worker protocol (lib-dsp)

**Files:**
- Modify: `packages/lib/dsp/src/latency-calibration.ts`
- Modify: `packages/lib/dsp/src/latency-calibration.test.ts`

**Interfaces:**
- Produces (exported from lib-dsp):
```ts
export interface LatencyCalibrationInput {
    sampleRate: number
    capture: Float32Array            // mono, transferred to the worker
    captureStartTime: number         // context time of capture[0]
    mlsOrder: int
    burstStartTimes: ReadonlyArray<number>   // context times the bursts were scheduled at
    maxRoundTripSeconds: number
    ratioThresholdDb: number
}
export interface LatencyCalibrationAnalysis {
    delays: ReadonlyArray<number>    // per burst, seconds; NaN when not identified
    ratiosDb: ReadonlyArray<number>  // per burst
    roundTripSeconds: number         // median of identified delays; NaN if none
    spreadSeconds: number            // max |delay − roundTrip| over identified; 0 if ≤ 1 identified
    identifiedBursts: int
}
export interface LatencyCalibrationProtocol {
    analyze(input: LatencyCalibrationInput): Promise<LatencyCalibrationAnalysis>
}
export const analyzeBursts: (input: LatencyCalibrationInput) => LatencyCalibrationAnalysis
```

- [ ] **Step 1: Write the failing tests**

Append:
```ts
import {analyzeBursts, LatencyCalibrationInput} from "./latency-calibration"

describe("analyzeBursts", () => {
    const sampleRate = 48000
    const order = 12 // short MLS keeps the test fast; the routine uses 15
    const mls = generateMls(order)
    const spacingSeconds = mls.length / sampleRate + 0.5
    const captureStartTime = 10.0
    const burstStartTimes = [10.1, 10.1 + spacingSeconds, 10.1 + 2 * spacingSeconds]
    const captureLength = Math.ceil((burstStartTimes[2] + spacingSeconds - captureStartTime) * sampleRate)

    const synthesize = (delaysSeconds: ReadonlyArray<number>, gains: ReadonlyArray<number> = [1, 1, 1]): Float32Array => {
        const capture = new Float32Array(captureLength)
        burstStartTimes.forEach((startTime, burst) => {
            const offset = (startTime - captureStartTime + delaysSeconds[burst]) * sampleRate
            const whole = Math.floor(offset)
            const fraction = offset - whole
            for (let index = 0; index < mls.length; index++) {
                capture[whole + index] += mls[index] * (1 - fraction) * gains[burst]
                capture[whole + index + 1] += mls[index] * fraction * gains[burst]
            }
        })
        return capture
    }
    const input = (capture: Float32Array): LatencyCalibrationInput => ({
        sampleRate, capture, captureStartTime, mlsOrder: order, burstStartTimes,
        maxRoundTripSeconds: 0.6, ratioThresholdDb: 18
    })

    test("recovers the same delay on every burst", () => {
        const analysis = analyzeBursts(input(synthesize([0.0213, 0.0213, 0.0213])))
        expect(analysis.identifiedBursts).toBe(3)
        analysis.delays.forEach(delay => expect(delay).toBeCloseTo(0.0213, 4))
        expect(analysis.roundTripSeconds).toBeCloseTo(0.0213, 4)
        expect(analysis.spreadSeconds).toBeLessThan(0.0001)
        analysis.ratiosDb.forEach(ratio => expect(ratio).toBeGreaterThan(18))
    })
    test("reports the spread when one burst is late", () => {
        const analysis = analyzeBursts(input(synthesize([0.020, 0.020, 0.023])))
        expect(analysis.identifiedBursts).toBe(3)
        expect(analysis.roundTripSeconds).toBeCloseTo(0.020, 4)
        expect(analysis.spreadSeconds).toBeCloseTo(0.003, 4)
    })
    test("a silent burst is not identified and does not enter the median", () => {
        const analysis = analyzeBursts(input(synthesize([0.020, 0.020, 0.020], [1, 0, 1])))
        expect(analysis.identifiedBursts).toBe(2)
        expect(Number.isNaN(analysis.delays[1])).toBe(true)
        expect(analysis.ratiosDb[1]).toBeLessThan(18)
        expect(analysis.roundTripSeconds).toBeCloseTo(0.020, 4)
    })
    test("all silent → nothing identified, NaN round trip", () => {
        const analysis = analyzeBursts(input(new Float32Array(captureLength)))
        expect(analysis.identifiedBursts).toBe(0)
        expect(Number.isNaN(analysis.roundTripSeconds)).toBe(true)
        expect(analysis.spreadSeconds).toBe(0)
    })
    test("a burst whose window runs past the capture end is skipped, not thrown", () => {
        const short = synthesize([0.020, 0.020, 0.020]).slice(0, Math.floor((burstStartTimes[2] - captureStartTime) * sampleRate) + 100)
        const analysis = analyzeBursts(input(short))
        expect(analysis.identifiedBursts).toBe(2)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/lib/dsp && npx vitest run src/latency-calibration.test.ts`
Expected: FAIL — `analyzeBursts` not exported.

- [ ] **Step 3: Implement**

Append:
```ts
export interface LatencyCalibrationInput {
    sampleRate: number
    capture: Float32Array
    captureStartTime: number
    mlsOrder: int
    burstStartTimes: ReadonlyArray<number>
    maxRoundTripSeconds: number
    ratioThresholdDb: number
}

export interface LatencyCalibrationAnalysis {
    delays: ReadonlyArray<number>
    ratiosDb: ReadonlyArray<number>
    roundTripSeconds: number
    spreadSeconds: number
    identifiedBursts: int
}

export interface LatencyCalibrationProtocol {
    analyze(input: LatencyCalibrationInput): Promise<LatencyCalibrationAnalysis>
}

const median = (values: ReadonlyArray<number>): number => {
    const sorted = [...values].sort((left, right) => left - right)
    const middle = sorted.length >> 1
    return sorted.length % 2 === 1 ? sorted[middle] : 0.5 * (sorted[middle - 1] + sorted[middle])
}

/** Locates each scheduled burst in the capture and reduces the per-burst delays to one round trip. */
export const analyzeBursts = (input: LatencyCalibrationInput): LatencyCalibrationAnalysis => {
    const {sampleRate, capture, captureStartTime, mlsOrder, burstStartTimes, maxRoundTripSeconds, ratioThresholdDb} = input
    const mls = generateMls(mlsOrder)
    const maxLag = Math.ceil(maxRoundTripSeconds * sampleRate)
    const delays: Array<number> = []
    const ratiosDb: Array<number> = []
    for (const startTime of burstStartTimes) {
        const startFrame = Math.round((startTime - captureStartTime) * sampleRate)
        const endFrame = startFrame + mls.length + maxLag
        if (startFrame < 0 || endFrame > capture.length) {
            delays.push(Number.NaN)
            ratiosDb.push(Number.NEGATIVE_INFINITY)
            continue
        }
        const correlation = crossCorrelate(capture.subarray(startFrame, endFrame), mls, maxLag)
        let peak = 0
        for (let lag = 1; lag < correlation.length; lag++) {if (correlation[lag] > correlation[peak]) {peak = lag}}
        const ratio = peakToMeanRatioDb(correlation, peak)
        ratiosDb.push(ratio)
        delays.push(ratio >= ratioThresholdDb ? (peak + refinePeak(correlation, peak)) / sampleRate : Number.NaN)
    }
    const identified = delays.filter(delay => !Number.isNaN(delay))
    const roundTripSeconds = identified.length === 0 ? Number.NaN : median(identified)
    const spreadSeconds = identified.length <= 1 ? 0.0
        : Math.max(...identified.map(delay => Math.abs(delay - roundTripSeconds)))
    return {delays, ratiosDb, roundTripSeconds, spreadSeconds, identifiedBursts: identified.length}
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/lib/dsp && npx vitest run` (whole package)
Expected: all green, including the 5 new cases. Then `npm run build` in `packages/lib/dsp` (or the scoped turbo filter) to confirm the export compiles.

- [ ] **Step 5: Commit**

```bash
git add packages/lib/dsp/src/latency-calibration.ts packages/lib/dsp/src/latency-calibration.test.ts
git commit -m "feat(dsp): analyzeBursts and the latency-calibration worker protocol

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Worker executor and `Workers.LatencyCalibration` sender

**Files:**
- Modify: `packages/studio/core-workers/src/workers-main.ts`
- Modify: `packages/studio/core/src/Workers.ts`

**Interfaces:**
- Consumes: `LatencyCalibrationProtocol`, `LatencyCalibrationInput`, `LatencyCalibrationAnalysis`, `analyzeBursts` from `@opendaw/lib-dsp` (Task 3).
- Produces: `Workers.LatencyCalibration: LatencyCalibrationProtocol` (throws "Workers are not installed" if `Workers.install` has not run, like the siblings).

- [ ] **Step 1: Register the executor**

In `workers-main.ts`, add `analyzeBursts`, `LatencyCalibrationInput`, `LatencyCalibrationAnalysis`, `LatencyCalibrationProtocol` to the `@opendaw/lib-dsp` import and, after the `"material"` executor:
```ts
Communicator.executor(messenger.channel("latency-calibration"), new class implements LatencyCalibrationProtocol {
    async analyze(input: LatencyCalibrationInput): Promise<LatencyCalibrationAnalysis> {
        return analyzeBursts(input)
    }
})
```

- [ ] **Step 2: Add the sender**

In `Workers.ts`, add the three types to the `@opendaw/lib-dsp` type import and, after the `Opfs` getter:
```ts
    @Lazy
    static get LatencyCalibration(): LatencyCalibrationProtocol {
        return Communicator
            .sender<LatencyCalibrationProtocol>(this.messenger.unwrap("Workers are not installed").channel("latency-calibration"),
                router => new class implements LatencyCalibrationProtocol {
                    analyze(input: LatencyCalibrationInput): Promise<LatencyCalibrationAnalysis> {
                        return router.dispatchAndReturn(this.analyze, input)
                    }
                })
    }
```
Check how the existing senders transfer large buffers (`Peak.generateAsync` passes `frames`); if `dispatchAndReturn` accepts a transfer list, pass `[input.capture.buffer]` the same way; otherwise the structured clone is acceptable (≈ 1 MB) — say which in the report.

- [ ] **Step 3: Build**

Run: `npx turbo run build --filter=@opendaw/lib-dsp --filter=@opendaw/studio-core --filter=@opendaw/studio-core-workers`
Expected: green; `packages/studio/core/dist/workers-main.js` regenerated (grep it for `latency-calibration`).

- [ ] **Step 4: Commit**

```bash
git add packages/studio/core-workers/src/workers-main.ts packages/studio/core/src/Workers.ts
git commit -m "feat(core): run the latency-calibration analysis in the SDK worker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Minimal capture worklet (`LatencyCaptureProcessor` + `LatencyCaptureNode`)

**Files:**
- Create: `packages/studio/core-processors/src/LatencyCaptureProcessor.ts`
- Modify: `packages/studio/core-processors/src/register.ts` (add `registerProcessor("latency-capture-processor", LatencyCaptureProcessor)`)
- Create: `packages/studio/core/src/capture/LatencyCaptureNode.ts`
- Modify: `packages/studio/core/src/capture/index.ts` (export)

**Interfaces:**
- Produces: `class LatencyCaptureNode extends AudioWorkletNode` with `static create(context: BaseAudioContext): LatencyCaptureNode`, `stop(): Promise<LatencyCapture>` where `interface LatencyCapture {startTime: number; frames: Float32Array}` (`startTime` = context time of `frames[0]`; frames mono, channel 0).
- Browser-only wiring; verified in Task 11's page, not unit-tested (same convention as `RecordingWorklet`).

- [ ] **Step 1: Processor**

`LatencyCaptureProcessor.ts` (follow `RecordingProcessor.ts`'s style on this branch — it posts `{type: "first-quantum", contextTime: currentTime}`):
```ts
/** Records channel 0 of its input from the first quantum with input until told to stop, then hands the frames back. */
export class LatencyCaptureProcessor extends AudioWorkletProcessor {
    readonly #chunks: Array<Float32Array> = []
    #startTime: number = Number.NaN
    #running = true

    constructor() {
        super()
        this.port.onmessage = ({data}: MessageEvent) => {
            if (data === "stop") {
                this.#running = false
                const total = this.#chunks.reduce((sum, chunk) => sum + chunk.length, 0)
                const frames = new Float32Array(total)
                let offset = 0
                for (const chunk of this.#chunks) {frames.set(chunk, offset); offset += chunk.length}
                this.port.postMessage({type: "frames", startTime: this.#startTime, frames}, [frames.buffer])
            }
        }
    }

    process(inputs: ReadonlyArray<ReadonlyArray<Float32Array>>): boolean {
        if (!this.#running) {return false}
        const channel = inputs[0]?.[0]
        if (channel === undefined) {return true}
        if (Number.isNaN(this.#startTime)) {this.#startTime = currentTime}
        this.#chunks.push(channel.slice())
        return true
    }
}
```

- [ ] **Step 2: Main-thread node**

`LatencyCaptureNode.ts`:
```ts
import {Promises} from "@opendaw/lib-runtime"

export interface LatencyCapture {
    startTime: number
    frames: Float32Array
}

/** Main-thread handle of LatencyCaptureProcessor: connect a source, call stop() to receive the frames. */
export class LatencyCaptureNode extends AudioWorkletNode {
    static create(context: BaseAudioContext): LatencyCaptureNode {
        return new LatencyCaptureNode(context)
    }

    readonly #result = Promise.withResolvers<LatencyCapture>()

    private constructor(context: BaseAudioContext) {
        super(context, "latency-capture-processor", {numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit"})
        this.port.onmessage = ({data}: MessageEvent) => {
            if (data?.type === "frames") {this.#result.resolve({startTime: data.startTime, frames: data.frames})}
        }
    }

    stop(): Promise<LatencyCapture> {
        this.port.postMessage("stop")
        return this.#result.promise
    }
}
```
(If `Promise.withResolvers` is not available in the package's TS lib target, use the pattern `Workers.install` uses on this branch — it already calls `Promise.withResolvers`, so it is.) Export from `capture/index.ts`.

- [ ] **Step 3: Build**

Run: `npx turbo run build --filter=@opendaw/studio-core --filter=@opendaw/studio-core-processors`
Expected: green; `packages/studio/core/dist/processors.js` contains `latency-capture-processor`.

- [ ] **Step 4: Commit**

```bash
git add packages/studio/core-processors/src/LatencyCaptureProcessor.ts packages/studio/core-processors/src/register.ts packages/studio/core/src/capture/LatencyCaptureNode.ts packages/studio/core/src/capture/index.ts
git commit -m "feat(core): minimal capture worklet reporting its first-frame time, for latency calibration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `InputLatencyCalibration.measure` (studio-core)

**Files:**
- Create: `packages/studio/core/src/capture/InputLatencyCalibration.ts`
- Create: `packages/studio/core/src/capture/InputLatencyCalibration.test.ts`
- Modify: `packages/studio/core/src/capture/index.ts` (export)

**Interfaces:**
- Consumes: `generateMls`, `LatencyCalibrationProtocol`, `LatencyCalibrationAnalysis` (lib-dsp); `Workers.LatencyCalibration` (Task 4); `LatencyCaptureNode` (Task 5).
- Produces:
```ts
export namespace InputLatencyCalibration {
    export const MlsOrder = 15
    export const BurstCount = 3
    export const BurstTailSeconds = 0.5
    export const LeadInSeconds = 0.1
    export const MaxRoundTripSeconds = 0.6
    export const RatioThresholdDb = 18.0
    export const SpreadBoundSeconds = 0.001
    export const GainDb = -12.0
    export interface Options { burstCount?: int; mlsOrder?: int; burstSpacingSeconds?: number; gainDb?: number }
    export type Verdict = "ok" | "noisy" | "no-signal" | "context-not-running" | "no-stream" | "transport-running"
    export interface Result { verdict: Verdict; roundTripSeconds: number; outputLatencySeconds: number; outputLatencyReported: boolean; inputLatencySeconds: number; spreadSeconds: number; correlationRatioDb: number; identifiedBursts: int; scheduledBursts: int; sampleRate: number; measuredAt: number }
    export interface Dependencies { analyze: LatencyCalibrationProtocol["analyze"]; createCapture: (context: BaseAudioContext) => {connectFrom(source: AudioNode): void; stop(): Promise<{startTime: number; frames: Float32Array}>}; waitUntil: (context: BaseAudioContext, time: number) => Promise<void>; now: () => number }
    export const measure: (context: AudioContext, source: AudioNode, output: AudioNode, options?: Options, dependencies?: Partial<Dependencies>) => Promise<Result>
    export const precondition: (context: AudioContext, source: Optional<AudioNode>, transportRunning: boolean) => Optional<Verdict>
}
```
The `transport-running` precondition needs engine state the routine does not have; `measure` takes a `transportRunning` flag through `Options`? No — keep `measure` engine-agnostic: `CaptureAudio.calibrateInputLatency` (Task 8) checks the transport and returns the verdict itself before calling `measure`. `precondition` covers context state and source presence only.

- [ ] **Step 1: Write the failing tests (through injected dependencies; no real audio)**

```ts
import {describe, expect, test} from "vitest"
import {InputLatencyCalibration} from "./InputLatencyCalibration"

const makeContext = (state: AudioContextState, outputLatency: number | undefined, resumeTo: AudioContextState = state) => {
    const context: any = {
        state, sampleRate: 48000, currentTime: 100.0,
        outputLatency,
        resume: async () => {context.state = resumeTo},
        createBuffer: (channels: number, length: number, sampleRate: number) =>
            ({numberOfChannels: channels, length, sampleRate, getChannelData: () => new Float32Array(length)}),
        createBufferSource: () => ({buffer: null, connect() {}, disconnect() {}, start(time: number) {context.started.push(time)}}),
        createGain: () => ({gain: {value: 1}, connect() {}, disconnect() {}}),
        started: [] as Array<number>
    }
    return context
}
const fakeNode = (): AudioNode => ({connect() {}, disconnect() {}} as unknown as AudioNode)
const analysisOf = (delays: Array<number>, ratios: Array<number>) => async () => {
    const identified = delays.filter(delay => !Number.isNaN(delay))
    const roundTripSeconds = identified.length === 0 ? Number.NaN : identified.sort((left, right) => left - right)[identified.length >> 1]
    const spreadSeconds = identified.length <= 1 ? 0 : Math.max(...identified.map(delay => Math.abs(delay - roundTripSeconds)))
    return {delays, ratiosDb: ratios, roundTripSeconds, spreadSeconds, identifiedBursts: identified.length}
}
const deps = (analyze: any, latencyDuringRun?: (context: any) => void) => ({
    analyze,
    createCapture: () => ({connectFrom() {}, stop: async () => ({startTime: 100.05, frames: new Float32Array(16)})}),
    waitUntil: async (context: any, time: number) => {context.currentTime = time; latencyDuringRun?.(context)},
    now: () => 1700000000000
})

describe("InputLatencyCalibration.measure", () => {
    test("ok: subtracts the output latency read after the bursts played", async () => {
        const context = makeContext("running", 0) // 0 until output has run
        const result = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {},
            deps(analysisOf([0.0312, 0.0311, 0.0312], [30, 31, 29]), ctx => {ctx.outputLatency = 0.023}))
        expect(result.verdict).toBe("ok")
        expect(result.outputLatencyReported).toBe(true)
        expect(result.outputLatencySeconds).toBe(0.023)
        expect(result.roundTripSeconds).toBeCloseTo(0.0312, 6)
        expect(result.inputLatencySeconds).toBeCloseTo(0.0082, 6)
        expect(result.identifiedBursts).toBe(3)
        expect(result.scheduledBursts).toBe(3)
        expect(result.correlationRatioDb).toBe(29)
        expect(result.measuredAt).toBe(1700000000000)
    })
    test("schedules the bursts at increasing context times starting after the lead-in", async () => {
        const context = makeContext("running", 0.02)
        await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([0.03, 0.03, 0.03], [30, 30, 30])))
        expect(context.started.length).toBe(3)
        expect(context.started[0]).toBeGreaterThanOrEqual(100.0 + InputLatencyCalibration.LeadInSeconds)
        const spacing = (Math.pow(2, InputLatencyCalibration.MlsOrder) - 1) / 48000 + InputLatencyCalibration.BurstTailSeconds
        expect(context.started[1] - context.started[0]).toBeCloseTo(spacing, 6)
    })
    test("unreported output latency: input part equals the round trip and is flagged", async () => {
        const context = makeContext("running", undefined)
        const result = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([0.03, 0.03, 0.03], [30, 30, 30])))
        expect(result.outputLatencyReported).toBe(false)
        expect(result.outputLatencySeconds).toBe(0)
        expect(result.inputLatencySeconds).toBeCloseTo(0.03, 6)
        expect(result.verdict).toBe("ok")
    })
    test("noisy when the spread exceeds the bound or a burst is missing", async () => {
        const context = makeContext("running", 0.02)
        const wide = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([0.030, 0.030, 0.033], [30, 30, 30])))
        expect(wide.verdict).toBe("noisy")
        expect(wide.spreadSeconds).toBeCloseTo(0.003, 6)
        const missing = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([0.030, Number.NaN, 0.030], [30, 5, 30])))
        expect(missing.verdict).toBe("noisy")
        expect(missing.identifiedBursts).toBe(2)
    })
    test("no-signal when nothing is identified", async () => {
        const context = makeContext("running", 0.02)
        const result = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([Number.NaN, Number.NaN, Number.NaN], [3, 2, 4])))
        expect(result.verdict).toBe("no-signal")
        expect(Number.isNaN(result.roundTripSeconds)).toBe(true)
    })
    test("context-not-running when resume does not bring the context up; no bursts scheduled", async () => {
        const context = makeContext("suspended", 0.02, "suspended")
        const result = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([0.03, 0.03, 0.03], [30, 30, 30])))
        expect(result.verdict).toBe("context-not-running")
        expect(context.started.length).toBe(0)
    })
    test("a suspended context that resumes proceeds", async () => {
        const context = makeContext("suspended", 0.02, "running")
        const result = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {}, deps(analysisOf([0.03, 0.03, 0.03], [30, 30, 30])))
        expect(result.verdict).toBe("ok")
    })
    test("respects burstCount and gainDb options", async () => {
        const context = makeContext("running", 0.02)
        const result = await InputLatencyCalibration.measure(context, fakeNode(), fakeNode(), {burstCount: 2, gainDb: -20}, deps(analysisOf([0.03, 0.03], [30, 30])))
        expect(result.scheduledBursts).toBe(2)
        expect(context.started.length).toBe(2)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/studio/core && npx vitest run src/capture/InputLatencyCalibration.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
import {int, Optional} from "@opendaw/lib-std"
import {dbToGain} from "@opendaw/lib-dsp"
import {generateMls, LatencyCalibrationProtocol} from "@opendaw/lib-dsp"
import {Workers} from "../Workers"
import {LatencyCaptureNode} from "./LatencyCaptureNode"

/**
 * Loopback input-latency calibration: scheduled MLS bursts on the AudioContext clock, captured through a
 * worklet that reports its first-frame context time, located by cross-correlation in the SDK worker.
 * See @opendaw/lib-dsp latency-calibration for the probe's origin and the analysis.
 */
export namespace InputLatencyCalibration {
    export const MlsOrder = 15
    export const BurstCount = 3
    export const BurstTailSeconds = 0.5
    export const LeadInSeconds = 0.1
    export const MaxRoundTripSeconds = 0.6
    export const RatioThresholdDb = 18.0
    export const SpreadBoundSeconds = 0.001
    export const GainDb = -12.0

    export interface Options {burstCount?: int, mlsOrder?: int, burstSpacingSeconds?: number, gainDb?: number}
    export type Verdict = "ok" | "noisy" | "no-signal" | "context-not-running" | "no-stream" | "transport-running"
    export interface Result {
        verdict: Verdict
        roundTripSeconds: number
        outputLatencySeconds: number
        outputLatencyReported: boolean
        inputLatencySeconds: number
        spreadSeconds: number
        correlationRatioDb: number
        identifiedBursts: int
        scheduledBursts: int
        sampleRate: number
        measuredAt: number
    }
    export interface Capture {connectFrom(source: AudioNode): void, stop(): Promise<{startTime: number, frames: Float32Array}>}
    export interface Dependencies {
        analyze: LatencyCalibrationProtocol["analyze"]
        createCapture: (context: BaseAudioContext) => Capture
        waitUntil: (context: BaseAudioContext, time: number) => Promise<void>
        now: () => number
    }

    const defaultDependencies = (): Dependencies => ({
        analyze: input => Workers.LatencyCalibration.analyze(input),
        createCapture: context => {
            const node = LatencyCaptureNode.create(context)
            return {connectFrom: source => source.connect(node), stop: () => node.stop()}
        },
        waitUntil: (context, time) => new Promise(resolve => {
            const tick = () => context.currentTime >= time ? resolve() : setTimeout(tick, 20)
            tick()
        }),
        now: () => Date.now()
    })

    const empty = (verdict: Verdict, sampleRate: number, scheduledBursts: int, now: number): Result => ({
        verdict, roundTripSeconds: Number.NaN, outputLatencySeconds: 0.0, outputLatencyReported: false,
        inputLatencySeconds: Number.NaN, spreadSeconds: 0.0, correlationRatioDb: Number.NEGATIVE_INFINITY,
        identifiedBursts: 0, scheduledBursts, sampleRate, measuredAt: now
    })

    export const measure = async (context: AudioContext, source: AudioNode, output: AudioNode,
                                  options: Options = {}, dependencies: Partial<Dependencies> = {}): Promise<Result> => {
        const {analyze, createCapture, waitUntil, now} = {...defaultDependencies(), ...dependencies}
        const burstCount = options.burstCount ?? BurstCount
        const mlsOrder = options.mlsOrder ?? MlsOrder
        const gainDb = options.gainDb ?? GainDb
        const {sampleRate} = context
        if (context.state !== "running") {await context.resume()}
        if (context.state !== "running") {return empty("context-not-running", sampleRate, burstCount, now())}
        const mls = generateMls(mlsOrder)
        const burstSpacingSeconds = options.burstSpacingSeconds ?? (mls.length / sampleRate + BurstTailSeconds)
        const buffer = context.createBuffer(1, mls.length, sampleRate)
        buffer.getChannelData(0).set(mls)
        const gainNode = context.createGain()
        gainNode.gain.value = dbToGain(gainDb)
        gainNode.connect(output)
        const capture = createCapture(context)
        capture.connectFrom(source)
        const firstBurst = context.currentTime + LeadInSeconds
        const burstStartTimes: Array<number> = []
        for (let burst = 0; burst < burstCount; burst++) {
            const startTime = firstBurst + burst * burstSpacingSeconds
            const node = context.createBufferSource()
            node.buffer = buffer
            node.connect(gainNode)
            node.start(startTime)
            burstStartTimes.push(startTime)
        }
        const lastEnd = burstStartTimes[burstCount - 1] + mls.length / sampleRate
        await waitUntil(context, lastEnd + MaxRoundTripSeconds)
        // Read only now: Chrome reports 0 until audio has been rendered to the device.
        const reported: Optional<number> = context.outputLatency
        const outputLatencyReported = reported !== undefined && Number.isFinite(reported) && reported > 0.0
        const outputLatencySeconds = outputLatencyReported ? reported : 0.0
        const {startTime, frames} = await capture.stop()
        gainNode.disconnect()
        const analysis = await analyze({
            sampleRate, capture: frames, captureStartTime: startTime, mlsOrder, burstStartTimes,
            maxRoundTripSeconds: MaxRoundTripSeconds, ratioThresholdDb: RatioThresholdDb
        })
        if (analysis.identifiedBursts === 0) {return empty("no-signal", sampleRate, burstCount, now())}
        const identifiedRatios = analysis.ratiosDb.filter((_, index) => !Number.isNaN(analysis.delays[index]))
        const verdict: Verdict = analysis.identifiedBursts === burstCount && analysis.spreadSeconds <= SpreadBoundSeconds ? "ok" : "noisy"
        return {
            verdict,
            roundTripSeconds: analysis.roundTripSeconds,
            outputLatencySeconds,
            outputLatencyReported,
            inputLatencySeconds: analysis.roundTripSeconds - outputLatencySeconds,
            spreadSeconds: analysis.spreadSeconds,
            correlationRatioDb: Math.min(...identifiedRatios),
            identifiedBursts: analysis.identifiedBursts,
            scheduledBursts: burstCount,
            sampleRate,
            measuredAt: now()
        }
    }
}
```
Check `dbToGain`'s actual export location (`@opendaw/lib-dsp` or `@opendaw/lib-std`; `CaptureAudio.ts` imports it — copy that import). Export the namespace from `capture/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/studio/core && npx vitest run src/capture/InputLatencyCalibration.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/core/src/capture/InputLatencyCalibration.ts packages/studio/core/src/capture/InputLatencyCalibration.test.ts packages/studio/core/src/capture/index.ts
git commit -m "feat(capture): InputLatencyCalibration.measure — scheduled MLS bursts anchored on the context clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Preference store and the `calibrated` resolver rung

**Files:**
- Modify: `packages/studio/adapters/src/engine/EnginePreferencesSchema.ts`
- Modify: `packages/studio/core/src/capture/InputLatency.ts`
- Modify: `packages/studio/core/src/capture/InputLatency.test.ts`
- Modify: `packages/studio/core/src/capture/CaptureAudio.ts` (`readLatency` provider from #376: look up the entry, pass it, note a mismatch)
- Modify: `packages/studio/core/src/capture/CaptureAudio.test.ts` (one case)

**Interfaces:**
- Produces (schema): `recording.inputLatencyCalibrations: Array<InputLatencyCalibrationEntry>`, default `[]`, with
  `export type InputLatencyCalibrationEntry = {deviceId: string, inputLatency: number, outputLatencyAtCalibration: number, spread: number, measuredAt: number}` exported from the schema module.
- Produces: `InputLatency.resolveWithSource(localOverride, preference, outputLatency, reportedLatency: Optional<number> = undefined, calibratedLatency: Optional<number> = undefined): Resolution`; `Source` gains `"calibrated"`; `InputLatency.OutputLatencyMismatchSeconds = 0.002`; `InputLatency.findCalibration(entries, deviceId: Optional<string>): Optional<InputLatencyCalibrationEntry>`.

- [ ] **Step 1: Schema**

In `EnginePreferencesSchema.ts`, inside `recording`:
```ts
        inputLatencyCalibrations: z.array(z.object({
            deviceId: z.string(),
            inputLatency: z.number().min(0),
            outputLatencyAtCalibration: z.number().min(0),
            spread: z.number().min(0),
            measuredAt: z.number()
        })).default([])
```
and `inputLatencyCalibrations: []` in the `.default({...})` block. Export `export type InputLatencyCalibrationEntry = z.infer<typeof _InputLatencyCalibrationEntry>` by hoisting the object schema into a `const _InputLatencyCalibrationEntry = z.object({...})`. Comment on the array: "replaced wholesale on write; entries are keyed by the capture device id, which is per browser and per origin".

- [ ] **Step 2: Failing resolver tests**

Append to `InputLatency.test.ts` (fixtures: `outputLatency = 0.05`, reported `0.02`, calibrated `0.0175`, preference numeric `0.005`):
```ts
describe("InputLatency calibrated rung", () => {
    const outputLatency = 0.05
    test("a calibration entry beats a Reported preference", () => {
        expect(InputLatency.resolveWithSource(InputLatency.Inherit, InputLatency.Reported, outputLatency, 0.02, 0.0175))
            .toEqual({seconds: 0.0175, source: "calibrated"})
    })
    test("a calibration entry beats a numeric preference", () => {
        expect(InputLatency.resolveWithSource(InputLatency.Inherit, 0.005, outputLatency, undefined, 0.0175))
            .toEqual({seconds: 0.0175, source: "calibrated"})
    })
    test("a per-capture override beats a calibration entry", () => {
        expect(InputLatency.resolveWithSource(0.01, InputLatency.Reported, outputLatency, 0.02, 0.0175))
            .toEqual({seconds: 0.01, source: "capture"})
    })
    test("no entry falls through to the preference", () => {
        expect(InputLatency.resolveWithSource(InputLatency.Inherit, InputLatency.Reported, outputLatency, 0.02, undefined))
            .toEqual({seconds: 0.02, source: "reported"})
    })
    test("findCalibration matches the device id and ignores others", () => {
        const entries = [
            {deviceId: "a", inputLatency: 0.01, outputLatencyAtCalibration: 0.05, spread: 0.0001, measuredAt: 1},
            {deviceId: "b", inputLatency: 0.02, outputLatencyAtCalibration: 0.05, spread: 0.0001, measuredAt: 2}
        ]
        expect(InputLatency.findCalibration(entries, "b")?.inputLatency).toBe(0.02)
        expect(InputLatency.findCalibration(entries, "c")).toBeUndefined()
        expect(InputLatency.findCalibration(entries, undefined)).toBeUndefined()
    })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/studio/core && npx vitest run src/capture/InputLatency.test.ts`
Expected: FAIL — `findCalibration` missing; the 5-argument calls return the wrong source.

- [ ] **Step 4: Implement the rung**

In `InputLatency.ts`: add `"calibrated"` to `Source`; add
```ts
    /** Live output latency may differ from the one seen at calibration by this much before it is worth a note. */
    export const OutputLatencyMismatchSeconds = 0.002

    export const findCalibration = (entries: ReadonlyArray<InputLatencyCalibrationEntry>,
                                    deviceId: Optional<string>): Optional<InputLatencyCalibrationEntry> =>
        deviceId === undefined ? undefined : entries.find(entry => entry.deviceId === deviceId)
```
(import the entry type from `@opendaw/studio-adapters`). In `resolveWithSource`, after the per-capture override check and before interpreting the preference:
```ts
        if (localOverride === Inherit && calibratedLatency !== undefined && Number.isFinite(calibratedLatency)) {
            return {seconds: Math.max(0.0, calibratedLatency), source: "calibrated"}
        }
```
Both `resolve` and `resolveWithSource` gain `calibratedLatency: Optional<number> = undefined` as the fifth parameter.

- [ ] **Step 5: Wire the lookup into `CaptureAudio.readLatency`**

In the provider from #376 (the merged `readLatency` in `startRecording`), before calling `InputLatency.resolve…`:
```ts
            const deviceId = trackSettings?.deviceId
            const calibration = InputLatency.findCalibration(recording.inputLatencyCalibrations, deviceId)
            if (calibration !== undefined
                && Math.abs(outputLatency - calibration.outputLatencyAtCalibration) > InputLatency.OutputLatencyMismatchSeconds) {
                console.debug(`[CaptureAudio] output latency ${outputLatency.toFixed(4)}s differs from ${calibration.outputLatencyAtCalibration.toFixed(4)}s seen at calibration; the calibrated input part is applied unchanged`)
            }
```
and pass `calibration?.inputLatency` as the fifth argument; switch the provider to `resolveWithSource` and log `source` in the existing latency report (it already logs the source on #378 — keep that). Add a `CaptureAudio.test.ts` case: with a stored entry for the fake track's device id, the provider's input term is the entry's value and the log names `calibrated`.

- [ ] **Step 6: Run tests and build**

Run: `cd packages/studio/core && npm test` then the scoped turbo build (adapters + core).
Expected: green; report counts.

- [ ] **Step 7: Commit**

```bash
git add packages/studio/adapters/src/engine/EnginePreferencesSchema.ts packages/studio/core/src/capture/InputLatency.ts packages/studio/core/src/capture/InputLatency.test.ts packages/studio/core/src/capture/CaptureAudio.ts packages/studio/core/src/capture/CaptureAudio.test.ts
git commit -m "feat(capture): per-device input-latency calibration entries and the calibrated resolver rung

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `CaptureAudio.calibrateInputLatency` and `clearInputLatencyCalibration`

**Files:**
- Modify: `packages/studio/core/src/capture/CaptureAudio.ts`
- Modify: `packages/studio/core/src/capture/CaptureAudio.test.ts`

**Interfaces:**
- Consumes: `InputLatencyCalibration.measure` (Task 6), `findCalibration`/entries (Task 7), `#audioChain.sourceNode`, `#monitorDestination()`, `engine.isPlaying`/`isRecording` observables, `engine.preferences.settings.recording`.
- Produces: `calibrateInputLatency(options?: InputLatencyCalibration.Options & {apply?: boolean}, dependencies?: Partial<InputLatencyCalibration.Dependencies>): Promise<InputLatencyCalibration.Result>`; `clearInputLatencyCalibration(): void`.

- [ ] **Step 1: Failing tests** (extend the fakes from `CaptureAudio.test.ts` on the branch: they already fake the context, stream/track with `getSettings().deviceId`, and the engine surface)

```ts
describe("CaptureAudio.calibrateInputLatency", () => {
    test("transport-running: refuses without touching audio", async () => {
        const capture = makeCapture({isPlaying: true})
        const result = await capture.calibrateInputLatency({}, {analyze: async () => {throw new Error("must not run")}})
        expect(result.verdict).toBe("transport-running")
    })
    test("no-stream when the capture has no audio chain", async () => {
        const capture = makeCapture({isPlaying: false, hasChain: false})
        const result = await capture.calibrateInputLatency({})
        expect(result.verdict).toBe("no-stream")
    })
    test("apply stores one entry per device id, replacing an older one", async () => {
        const capture = makeCapture({isPlaying: false, deviceId: "mic-1", existingEntries: [{deviceId: "mic-1", inputLatency: 0.5, outputLatencyAtCalibration: 0.02, spread: 0, measuredAt: 1}, {deviceId: "mic-2", inputLatency: 0.011, outputLatencyAtCalibration: 0.02, spread: 0, measuredAt: 1}]})
        const result = await capture.calibrateInputLatency({apply: true}, fakeMeasureDeps({roundTrip: 0.0312, outputLatency: 0.023}))
        expect(result.verdict).toBe("ok")
        const entries = capture.engine.preferences.settings.recording.inputLatencyCalibrations
        expect(entries.map(entry => entry.deviceId).sort()).toEqual(["mic-1", "mic-2"])
        expect(entries.find(entry => entry.deviceId === "mic-1")?.inputLatency).toBeCloseTo(0.0082, 6)
        expect(entries.find(entry => entry.deviceId === "mic-2")?.inputLatency).toBe(0.011)
    })
    test("without apply nothing is stored", async () => {
        const capture = makeCapture({isPlaying: false, deviceId: "mic-1"})
        await capture.calibrateInputLatency({}, fakeMeasureDeps({roundTrip: 0.0312, outputLatency: 0.023}))
        expect(capture.engine.preferences.settings.recording.inputLatencyCalibrations).toEqual([])
    })
    test("no-signal is never stored even with apply", async () => {
        const capture = makeCapture({isPlaying: false, deviceId: "mic-1"})
        await capture.calibrateInputLatency({apply: true}, fakeMeasureDeps({roundTrip: Number.NaN, outputLatency: 0.023, identified: 0}))
        expect(capture.engine.preferences.settings.recording.inputLatencyCalibrations).toEqual([])
    })
    test("clearInputLatencyCalibration removes only this device's entry", () => {
        const capture = makeCapture({isPlaying: false, deviceId: "mic-1", existingEntries: [{deviceId: "mic-1", inputLatency: 0.01, outputLatencyAtCalibration: 0.02, spread: 0, measuredAt: 1}, {deviceId: "mic-2", inputLatency: 0.011, outputLatencyAtCalibration: 0.02, spread: 0, measuredAt: 1}]})
        capture.clearInputLatencyCalibration()
        expect(capture.engine.preferences.settings.recording.inputLatencyCalibrations.map(entry => entry.deviceId)).toEqual(["mic-2"])
    })
})
```
`fakeMeasureDeps` builds `InputLatencyCalibration.Dependencies` whose `analyze` returns three equal delays (`roundTrip`) with ratio 30 (or `identified: 0` → all NaN), `waitUntil` sets `context.outputLatency`, `createCapture` returns a stub. `makeCapture` extends the file's existing factory with `isPlaying`, `hasChain`, `deviceId`, `existingEntries`.

- [ ] **Step 2: Run to verify failure** — Run: `cd packages/studio/core && npx vitest run src/capture/CaptureAudio.test.ts`; expected: methods missing.

- [ ] **Step 3: Implement**

In `CaptureAudio`:
```ts
    /**
     * Measures this capture's input-path delay with a loopback probe played through its monitor route (or the
     * context destination) and captured through its own stream. Stores the result per device id when apply is set.
     */
    async calibrateInputLatency(options: InputLatencyCalibration.Options & {apply?: boolean} = {},
                                dependencies: Partial<InputLatencyCalibration.Dependencies> = {}): Promise<InputLatencyCalibration.Result> {
        const {project} = this.manager
        const {engine, env: {audioContext}} = project
        const now = dependencies.now ?? (() => Date.now())
        if (engine.isPlaying.getValue() || engine.isRecording.getValue()) {
            return InputLatencyCalibration.emptyResult("transport-running", audioContext.sampleRate, options.burstCount ?? InputLatencyCalibration.BurstCount, now())
        }
        const chain = this.#audioChain
        if (!isDefined(chain)) {
            return InputLatencyCalibration.emptyResult("no-stream", audioContext.sampleRate, options.burstCount ?? InputLatencyCalibration.BurstCount, now())
        }
        const result = await InputLatencyCalibration.measure(audioContext, chain.sourceNode, this.#monitorDestination(), options, dependencies)
        if (options.apply === true && (result.verdict === "ok" || result.verdict === "noisy")) {
            const deviceId = this.streamMediaTrack.map(track => track.getSettings().deviceId ?? "").unwrapOrUndefined()
            if (deviceId !== undefined && deviceId !== "") {
                const {recording} = engine.preferences.settings
                recording.inputLatencyCalibrations = [
                    ...recording.inputLatencyCalibrations.filter(entry => entry.deviceId !== deviceId),
                    {deviceId, inputLatency: Math.max(0.0, result.inputLatencySeconds), outputLatencyAtCalibration: result.outputLatencySeconds, spread: result.spreadSeconds, measuredAt: result.measuredAt}
                ]
            }
        }
        return result
    }

    clearInputLatencyCalibration(): void {
        const deviceId = this.streamMediaTrack.map(track => track.getSettings().deviceId ?? "").unwrapOrUndefined()
        if (deviceId === undefined) {return}
        const {recording} = this.manager.project.engine.preferences.settings
        recording.inputLatencyCalibrations = recording.inputLatencyCalibrations.filter(entry => entry.deviceId !== deviceId)
    }
```
Export `emptyResult` from `InputLatencyCalibration` (rename the private `empty` from Task 6 and export it). If `engine.preferences.settings` is typed `Readonly` in studio-core, assign through the engine's preferences API the studio uses (check `PreferencePanel.tsx` on the branch: it writes `preferences.settings.<section>.<key> = value` through the proxy); do the same, and note in the report.

- [ ] **Step 4: Run tests and build** — `cd packages/studio/core && npm test`; scoped turbo build. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/core/src/capture/CaptureAudio.ts packages/studio/core/src/capture/CaptureAudio.test.ts packages/studio/core/src/capture/InputLatencyCalibration.ts
git commit -m "feat(capture): CaptureAudio.calibrateInputLatency and clearInputLatencyCalibration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Upstream verification pass and PR description draft (no push)

**Files:**
- Create (in this repo, gitignored scratch is fine): `/private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/e2300171-0287-4790-a50c-4b0919231681/scratchpad/pr-calibration-draft.md`

- [ ] **Step 1: Full verification on the branch**

```bash
cd /Users/naomiaro/Code/openDAWOriginal
npx turbo run build --filter=@opendaw/lib-dsp --filter=@opendaw/studio-adapters --filter=@opendaw/studio-core --filter=@opendaw/studio-core-processors --filter=@opendaw/studio-core-workers
(cd packages/lib/dsp && npm test) && (cd packages/studio/core && npm test)
(cd packages/studio/core-wasm && npm run build:bundles)
git log --oneline fork/feat/reported-input-latency..HEAD
git diff fork/feat/reported-input-latency..HEAD | grep -i -c "<origin greplist patterns from .claude/local.md>"   # expect 0
git log --format=%B fork/feat/reported-input-latency..HEAD | grep -c -i "claude-session\|session_"                  # expect 0
git checkout "@opendaw/studio-sdk@0.0.170"
```

- [ ] **Step 2: Draft the PR description** (title `feat(capture): loopback input-latency calibration`), body sections: Problem (what remains after #376/#378, in upstream terms); Method (bursts on the context clock, worker analysis, the WAC 2025 citation verbatim, what differs); API (`InputLatencyCalibration.measure`, `CaptureAudio.calibrateInputLatency`/`clear…`, the preference entry, the `calibrated` rung and resolution order); Behaviour for existing users (nothing changes until someone calibrates); Limits (audible bursts; acoustic paths; the cancellation argument for output-latency errors; per-browser store); Verification (unit counts; the ground-truth delay sweep from Task 11 — filled in after Task 11 runs; leave the table with the column headers and a "pending" marker that Task 12 replaces); "Stacks on #378 and #376"; "Refs #374"; footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and nothing after. No session links, no origin names.

- [ ] **Step 3: Report** the branch head, test counts, and the draft path. Do not push.

---

### Task 10: Override layout from the calibration branch (this repo)

**Files:**
- Modify (gitignored): `/Users/naomiaro/Code/opendaw-test/.claude/local.md` — record the new layout path under "Task 7 build/layout".

- [ ] **Step 1: Build the branch's SDK packages** (JS only; no Rust): in the openDAW checkout on `feat/input-latency-calibration`, the scoped turbo build above plus `npm run build:bundles` in `packages/studio/core-wasm`.

- [ ] **Step 2: Lay out the override** exactly as the "Task 7 build/layout" section of `.claude/local.md` describes (`<dir>/@opendaw/<pkg>/` = package.json + dist for every package the scoped build produced, INCLUDING `lib-dsp` this time since it changed; `studio-core-wasm` = the installed package's full `dist/` with the rebuilt `wasm-processor.js`/`wasm-offline-worker.js` overlaid and the installed `dist/wasm/` as is; `nam-wasm` installed wholesale). New directory; path only in `.claude/local.md`.

- [ ] **Step 3: Prove engagement.** Kill the dev server by PID (`lsof -ti :5173`), start `SDK_DIST_OVERRIDE=<dir> npm run dev -- --port 5173 --host 127.0.0.1`, open `recording-alignment-audit-debug-demo.html?scenario=probe` fresh, and confirm: the build probe reads the branch marker; `project.captureDevices` captures expose `calibrateInputLatency` (evaluate `typeof` in the console); `workers-main.js` served contains `latency-calibration`. Record the three checks in the report. Return the checkout to the tag.

---

### Task 11: Ground-truth debug page (this repo)

**Files:**
- Modify: `src/lib/audit/loopbackInjection.ts` — `LoopbackHandle.setReturnDelay(seconds: number): void` inserting/adjusting a `DelayNode` between the engine tap and the loopback `MediaStreamAudioDestinationNode` (max delay 1 s).
- Create: `input-latency-calibration-debug-demo.html` (copy `recording-alignment-audit-debug-demo.html`; noindex meta; script src to the new tsx; DebugLinkBar).
- Create: `src/demos/recording/input-latency-calibration-debug-demo.tsx`.
- Modify: `vite.config.ts` (rollup input entry `inputLatencyCalibrationDebugDemo`).
- Modify: `src/lib/audit/loopbackInjection.test.ts` if one exists; otherwise browser-verified (repo convention).

**Interfaces:**
- Consumes: `installLoopbackCapture` (existing), `initializeOpenDAW`, `project.captureDevices`, the harness's `runCellRepeat`-equivalent for one `nominal-start` cell (reuse the exported pieces of `recording-alignment-audit-debug-demo.tsx`; if they are not exported, extract the cell runner into `src/lib/audit/recordingCellRunner.ts` in this task and have both pages import it).
- Produces: a persisted `calib-summary-<runToken>.json` (`/__verify` sink; name matches the regex) with, per D: `requestedDelaySec`, the full `Result`, and the harness's independently measured loopback hop for the same stream (`firstQuantumTimeSec`-based, as the register's Task 9 section defines it); plus the `nominal-start` cell rows after `apply`.

- [ ] **Step 1: `setReturnDelay`** — in `installLoopbackCapture`, keep a `DelayNode` (`delayTime` 0, `maxDelayTime` 1) in the return path from the start; `setReturnDelay(seconds)` sets `delayTime.value`. Log a string.

- [ ] **Step 2: The page** — `?delays=0,10,25,50&bpm=120&rate=48000`: initialise, install loopback (1 device), arm one Tape, then for each D: `setReturnDelay(D/1000)`, `capture.calibrateInputLatency({})`, record the result row; after the sweep: `setReturnDelay(0)`, `calibrateInputLatency({apply: true})`, then run ONE `nominal-start` cell (3 repeats) through the shared runner with the calibration applied and classify it. Render a table (D, round trip, input part, output latency reported, spread, ratio, verdict, harness hop) and the cell verdict; upload the JSON. Real first click for the transport; visible window; fresh navigation per run.

- [ ] **Step 3: Run it** on the override server for rate 48000 and 44100; persist both JSONs; compute slope/intercept of `inputLatencySeconds` vs D by least squares in the page and print them.
Expected: slope 1.00 ± 0.01; intercept = the stream's hop within 2 ms; the `nominal-start` cell classifies `aligned`.

- [ ] **Step 4: tsc + vitest** in this repo; commit.

```bash
git add input-latency-calibration-debug-demo.html src/demos/recording/input-latency-calibration-debug-demo.tsx src/lib/audit/loopbackInjection.ts vite.config.ts src/lib/audit/recordingCellRunner.ts
git commit -m "feat(audit): input-latency calibration ground-truth page — delay sweep through the loopback and an aligned cell after apply

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Register section, standing sweep, docs, retire spec + plan

**Files:**
- Modify: `debug/recording-start-alignment-audit.md` — new section "Input-latency calibration (2026-09-02)": method (with the citation), the delay-sweep table for both rates with JSON names, slope/intercept, the `aligned` cell rows, real-device acoustic run (value and spread, sanity only), what remains.
- Modify: `src/demos/recording/CLAUDE.md` (harness section: the new page, its params, the JSON fields), root `CLAUDE.md` "Build & Verification" (add the calibration page to the standing sweep line), `debug/README.md` (index entry).
- Modify: the PR draft from Task 9 — replace the "pending" verification table with the measured one.
- Delete: `docs/superpowers/specs/2026-09-02-input-latency-calibration-design.md`, `docs/superpowers/plans/2026-09-02-input-latency-calibration.md`.

- [ ] **Step 1:** Write the register section with every number recomputed from the persisted JSONs (name them).
- [ ] **Step 2:** Docs edits; grep `documentation/*.md` untouched.
- [ ] **Step 3:** One acoustic run on the laptop (built-in mic + speakers, plain server on the override): record value, spread, ratio, verdict in the register as sanity only.
- [ ] **Step 4:** Origin grep over the full branch diff in this repo; tsc; vitest.
- [ ] **Step 5:** Commits: `docs: input-latency calibration verified against injected delays — recording-start audit` then `chore: retire the calibration spec + plan`.

---

## Self-review

- **Spec coverage:** §3 method → Tasks 1–3 (probe, correlation, verdict maths), 5–6 (scheduling, capture, output-latency read after the bursts, verdicts); §4.1 layout → Tasks 1–6; §4.2 → Task 8; §4.3 preconditions → Task 6 (context, stream via caller) + Task 8 (transport); §4.4 store/resolution/mismatch note → Task 7 (+ Task 8 writes); attribution → Task 1 header + Task 9 PR text; §5 deliverables 1–4 → Tasks 1–9, 5–7 → Tasks 10–12; §6 verification → Tasks 3, 6, 11, 12; §7/§8 → Tasks 9, 11, 12.
- **Placeholders:** none; the only deferred content is the measured table in the PR draft, explicitly filled by Task 12.
- **Type consistency:** `LatencyCalibrationInput`/`Analysis`/`Protocol` (Task 3) are what Tasks 4 and 6 consume; `Result`/`Verdict`/`Dependencies`/`emptyResult` (Task 6, renamed in Task 8) are what Task 8 consumes; `InputLatencyCalibrationEntry` (Task 7 schema) is what `findCalibration` and Task 8 use; the fifth `calibratedLatency` argument is added to both `resolve` and `resolveWithSource`.
