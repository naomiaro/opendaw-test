# Input-latency calibration — design spec

**Date:** 2026-09-02
**Status:** approved in conversation, awaiting written review
**Upstream target:** `andremichelle/openDAW`, one SDK-only PR stacked on #378 (reported input
latency as default) and #376 (engine-clock take anchoring). Refs #374.
**This repo:** verification page, register section, standing-sweep variant.

## 1. Problem

After #376 anchors takes on the engine's own clock and #378 applies the browser-reported input
latency by default, the term that still places a take late is the input path's own delay
whenever the browser reports nothing, reports zero, or reports a value that does not match the
device. The recording start-alignment audit measured that delay at 10–23 ms per stream on a
synthetic loopback (`debug/recording-start-alignment-audit.md`, Task 9 section) and found it
varies per stream instance, not just per device. The only remedy the SDK offers is a manual
number typed into a preference, which means the user must measure it by hand.

DAWs solve this with a loopback calibration: play a reference signal through the output, capture
it back through the armed input, measure the round trip, store the result. This spec adds that
routine to the SDK. It deliberately adds NO studio UI; the maintainer builds that on the API.

## 2. Out of scope

- Studio-app UI (button, dialog, readout). The SDK method and the verification page in this
  repo are the only callers.
- MIDI note placement (`RecordMidi.ts`) — tracked separately as openDAW#379.
- Correcting a browser's mis-reported `outputLatency`. The stored value is designed so an error
  in that report cancels within the same output device (§4.4); a changed output device with a
  wrong report is logged, not corrected.
- Per-stream-instance jitter that appears only after a stream is opened. Calibration measures
  the stream it runs on; a later stream on the same device may differ by up to a render quantum.
- Continuous or automatic re-calibration.

## 3. Measurement method (approach chosen: scheduled click train, main-thread analysis)

Ported from this repo's `src/lib/audit/recordingAlignment.ts` / `loopbackInjection.ts`, which
the audit campaign validated to sub-millisecond agreement against an independent anchor:

1. **Reference train.** N short clicks (default 12; 8 ms, band-limited around 6 kHz so they sit
   above the metronome/music band) with unique, growing gaps: gap(i) = base + i·increment
   (defaults 0.25 s and 5 ms). Any two consecutive recovered clicks identify their schedule
   indices, so a missed or spurious click cannot shift the fit.
2. **Scheduling.** Each click is an `AudioBufferSourceNode` started at an explicit context time
   `t_sched(i)` on the capture's output route (§4.2). The train starts ≥ 100 ms after the routine
   begins so the first click is never scheduled in the past.
3. **Capture.** The capture's stream source is connected to a dedicated `AudioWorkletNode`
   (a minimal recorder: appends every input quantum to a Float32 buffer and reports the context
   time of its first frame, the same contract `RecordingProcessor` gained in #376). Capture runs
   for the train's length plus 0.5 s tail.
4. **Analysis (pure functions, unit-tested).** Band-split the buffer above 1.5 kHz; detect onsets;
   identify clicks by gap pattern; least-squares fit `t_arrival(i) = t_sched(i) + RTT` over the
   identified clicks. `RTT` is the round trip; the residuals' spread (max |residual|) is the
   quality figure; the count of identified clicks is reported.
5. **Decomposition.** `outputLatency` is read AFTER the train has played (§4.3);
   `inputLatency = RTT − outputLatency`. If `outputLatency` is unreported (undefined, 0 or not
   finite after output ran), `inputLatency = RTT` and the result is flagged
   `outputLatencyReported: false`.
6. **Verdict.** `no-signal` when fewer than 3 clicks are identified (no fit is attempted);
   otherwise a fit is made and the verdict is `ok` when ≥ 6 clicks are identified AND the spread
   is ≤ 1.0 ms, else `noisy` (the result is still returned with its figures; the caller decides).
   `context-not-running` / `no-stream` / `transport-running` are precondition verdicts with no
   measurement. Bounds are named constants in `InputLatencyCalibration` and stated in the PR.

Alternatives considered and rejected: single click with peak detection (one reflection moves
the peak; no spread); engine-side cross-correlation in Rust (touches the engine crate and the
WASM build for no accuracy gain over the click-train fit).

## 4. Architecture

### 4.1 `packages/studio/core/src/capture/InputLatencyCalibration.ts` (studio-core)

```ts
export namespace InputLatencyCalibration {
    export interface Options { clickCount?: int; baseGapSeconds?: number; gapIncrementSeconds?: number; gainDb?: number }
    export type Verdict = "ok" | "noisy" | "no-signal" | "context-not-running" | "no-stream" | "transport-running"
    export interface Result {
        verdict: Verdict
        roundTripSeconds: number            // NaN unless identified
        outputLatencySeconds: number        // as read after output ran; 0 if unreported
        outputLatencyReported: boolean
        inputLatencySeconds: number         // roundTrip − outputLatency, or roundTrip if unreported
        spreadSeconds: number               // max |residual| of the fit
        identifiedClicks: int
        scheduledClicks: int
        sampleRate: number
        measuredAt: number                  // Date.now()
    }
    export const measure: (context: AudioContext, source: AudioNode, output: AudioNode, options?: Options) => Promise<Result>
}
```

`measure` owns the preconditions (§4.3), schedules the train, records, analyses, and resolves.
It never writes preferences. Pure helpers live beside it (`calibrationAnalysis.ts`: schedule,
band split, onset detection, identification, fit) with their own tests.

### 4.2 `CaptureAudio.calibrateInputLatency(options?: Options & {apply?: boolean}): Promise<Result>`

Feeds `measure` the capture's own stream source node (the same node `prepareRecording` connects
to the recording worklet) and its output route: the monitor output if `setMonitorOutputDevice`
set one, else `audioContext.destination`. With `apply: true` and a verdict of `ok` or `noisy`,
stores the result (§4.4). Also `clearInputLatencyCalibration(): void`.

### 4.3 Preconditions (enforced by `measure`)

- Context running: `await context.resume()`; if `state !== "running"` afterwards → verdict
  `context-not-running`. (Same rule #376's `prepareRecording` now applies.)
- A live stream source (`no-stream` otherwise).
- Transport stopped and no recording in progress (`transport-running` otherwise) — the click
  train must not land in a take, and the engine must not be producing output that would confuse
  onset detection.
- `outputLatency` is read only after the last click's scheduled time has passed on the context
  clock, because Chrome reports 0 until audio has been rendered to the device.

### 4.4 Storage and resolution

- New engine preference `recording.inputLatencyCalibrations`:
  `Record<deviceId, {inputLatency: number, outputLatencyAtCalibration: number, spread: number, measuredAt: number}>`,
  schema default `{}`. Persisted with the other preferences (local storage: per browser, per
  origin — the same scope as `getUserMedia` device ids, so a calibration can never be applied by
  a different browser).
- Resolution order (extends #378 by one rung):
  per-capture override (unless `Inherit`) → calibration entry for the capture's device id →
  engine preference (`Reported` default / `EqualsOutput` / number).
  `InputLatency.resolveWithSource` gains a `calibrated: Optional<number>` input and a
  `"calibrated"` source; `CaptureAudio`'s placement-time latency provider (#376) looks the entry
  up by `track.getSettings().deviceId`.
- Why "input part only" is stored: at record time the SDK adds the live `outputLatency` back, so
  on the same output device any error in the browser's report cancels; even a browser reporting
  0 lands the take where calibration measured it. If the live output latency differs from
  `outputLatencyAtCalibration` by more than 2 ms, the calibrated input part is still applied and
  one debug line notes the output device changed since calibration.

## 5. Deliverables

Upstream PR (branch `feat/input-latency-calibration`, based on `feat/reported-input-latency`
with `fix/recording-start-alignment` merged in; PR text states it stacks on #378 and #376):
1. `calibrationAnalysis.ts` + tests (ported functions, cases in §6).
2. `InputLatencyCalibration.ts` + tests for verdicts/preconditions through fakes.
3. `CaptureAudio.calibrateInputLatency` / `clearInputLatencyCalibration`; resolver rung; schema
   entry; `InputLatency.test.ts` cases for the rung.
4. PR description drafted for user review before posting; no session links; no origin naming.

This repo (branch `input-latency-calibration`):
5. Unlisted debug page `input-latency-calibration-debug-demo.html` (+ tsx under
   `src/demos/recording/`): loopback injection with a configurable `DelayNode` D in the return
   path; runs calibration for D ∈ {0, 10, 25, 50} ms; then runs the harness's `nominal-start` cell
   with `apply: true` and reports the placement residual. Persists a JSON to `.verify-output/`.
6. Register section "Input-latency calibration (2026-09-02)" in
   `debug/recording-start-alignment-audit.md` with the slope/offset table and the `aligned` result.
7. Standing sweep: `recording-alignment-audit-debug-demo.html?scenario=calibrated…` variant and
   the CLAUDE.md pointer.

## 6. Verification and tests

Unit (upstream, TDD): synthetic capture with known delay recovers it within one sample; missed
click and spurious click still identify; reflections (delayed attenuated copies) do not move
the fit; silence → `no-signal`; spread above bound → `noisy`; preconditions via fakes;
resolver rung and schema default; `apply` writes and `clear` removes the entry.

Ground truth (this repo): result tracks D with slope 1.00 ± 0.01; the constant offset equals the
stream's own hop as measured independently by the harness's first-frame time within 2 ms.

Headline: after `apply`, the harness `nominal-start` cell on the same stream classifies
`aligned` (|median| ≤ 2 ms, head/tail integrity clean), the first time the campaign metric can
reach it. Register + PR before/after.

Real device: one acoustic run on the user's laptop; value and spread reported for sanity only.

## 7. Risks

- **Acoustic runs.** Speaker-to-mic paths add reflections and noise; identification by gap
  pattern is the mitigation, and `noisy` is a first-class verdict rather than a failure.
- **Clicks audible.** Calibration plays 12 clicks at −6 dB by default; the caller can lower gain.
  Documented; no attempt to hide it.
- **Stacked PRs.** If the maintainer reworks #376 or #378, this branch rebases; the spec ties to
  their APIs (`Reported`, the placement-time provider) by name so drift is visible.
- **Browser reports.** The cancellation argument (§4.4) covers wrong reports within one output
  device only. Stated in the PR's Limits.

## 8. Success criteria

1. Unit tests green upstream; scoped build green; no origin identifiers; Co-Authored-By only.
2. Ground-truth slope and offset within the bounds in §6, with the JSON persisted.
3. A harness cell reads `aligned` after calibration, recorded in the register.
4. PR description reviewed by the user before posting; issue #374 comment links the PR.
