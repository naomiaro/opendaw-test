# Combined MIDI + Audio Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unlisted page that plays a key on the IAC bus and a click out of the speakers at the same heard instant, records both through the SDK (MIDI capture and a microphone Tape), and reports how far apart the two parts landed, in two input-latency states, with the microphone's round trip measured inside every run.

**Architecture:** The MIDI sweep's cell runner gains two hooks (metronome control, a schedule callback) and the combined runner wraps it: the callback schedules the speaker clicks from the same anchor and clock pair; after the MIDI repeat returns, the Tape's take is read back with the audio harness's band split and onset detector and placed with its region position and waveform offset; clicks are matched to pattern notes with an eighth-bar anchor; pairs give `partsApartMs`. A calibration worklet fed from the armed capture's own output node measures the speaker-to-microphone round trip in its own process-call frames before the first repeat. Pure modules under `src/lib/audit/combined*.ts` with Node tests; one browser runner; one page.

**Tech Stack:** TypeScript strict, React + Radix (page), Vitest (Node), OpenDAW SDK (`CaptureAudio`, `CaptureMidi`, `engine.recordingStart`), Web MIDI, Web Audio (`AudioWorklet`, `OscillatorNode`, `setSinkId`), macOS IAC Driver, built-in microphone and speakers.

**Spec:** `docs/superpowers/specs/2026-10-20-midi-audio-combined-design.md`

## Global Constraints

- Chrome, HTTPS dev server, a REAL click on Run (MIDI access, microphone permission, AudioContext resume). IAC Driver online. Chrome window uncovered for the run.
- The engine preference `recording.inputLatency` is NEVER written. The calibrated state writes the Tape capture box's `inputLatency` field (seconds). The page refuses to run if the preference is not 0 at load.
- The metronome is OFF in every scenario; `countin-start` also sets `settings.metronome.gain = -Infinity` (the schema allows it) because the count-in forces the metronome on. The master is silenced (−96 dB) unless `audible=1`.
- The calibration routine reads neither `currentTime` nor `currentFrame` in the worklet (Chromium 442866743); round trips are differences of the worklet's own process-call frame counter.
- Clicks are scheduled on the audio clock and MIDI notes on the Web MIDI clock, ahead of time; nothing is sent from a timer or a frame.
- Reuse: `midiInputCellRunner.ts` (stages, anchor, pattern, sender), `midiClockMap.ts`, `midiInputAlignment.ts` (`expectedLateMedianMs`, `clampJitterBoundMs`, `quantumMs`, `median`, `percentile`), `recordingAlignment.ts` (`bandSplit`), `onsetDetection.ts` (`detectOnsets`), `recordingCellRunner.ts` (`waitForLoaderTerminal`, `runRepeatWithDeadline`, `assertCurrent`), `withDeadline`, `detectBuildFeatures`, the `/__verify` sink.
- Unlisted page conventions (noindex HTML at root, Vite input, `#audit-state[data-audit-state]` ending in `done`), strict TypeScript, `npm run typecheck` clean before every commit, Node tests for every pure function, no SDK version numbers outside `debug/` and `changelogs/`.
- Full run `?scenario=all&bpm=120` (3 scenarios × 2 states × 3 repeats) under ten minutes in one page load.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Microphone permission denied, or no audio input device**: the page must stop at setup with a card naming the step, never run a cell whose Tape recorded silence and report it as clicks missing. Pinned in Task 7 (device picker errors) and Task 2 (calibration refuses on no click found).
2. **Headphones plugged in or an output device the microphone cannot hear**: the calibration finds no click; the run must refuse before the first repeat, naming the floor and the peak it saw. Pinned in Task 2.
3. **A noise burst inside the pattern span**: an extra onset must count as `clicksExtra` and never steal a pattern note's pair or shift later pairs. Pinned in Task 3.
4. **A lost click (microphone dropout)**: `clicksMissing` 1, the pair absent, every other pair unmoved — no matching by order. Pinned in Task 3.
5. **The microphone path changing state between the calibration and a repeat** (the 64 → 88 ms jump): the default-state row's audio median disagrees with `micInputPartMs` by more than the clamp jitter, and the verdict names the calibration, not the SDK. Pinned in Task 4.

---

### Task 1: Click times, device picking, input-latency state

**Files:**
- Create: `src/lib/audit/combinedClicks.ts`
- Create: `src/lib/audit/combinedDevices.ts`
- Test: `src/lib/audit/combinedClicks.test.ts`, `src/lib/audit/combinedDevices.test.ts`

**Interfaces:**
- Consumes: `PatternNote` (`midiInputPattern.ts`), `RecordingAnchor`, `contextSecAtPosition` (`midiClockMap.ts`).
- Produces (`combinedClicks.ts`):
  ```ts
  export const CLICK_HZ = 6000;
  export const CLICK_DURATION_SEC = 0.008;
  export const CLICK_GAIN = 0.5;            // −6 dBFS
  export interface ClickSchedule { index: number; contextSec: number }
  export function clickContextTimes(pattern: readonly PatternNote[], anchor: RecordingAnchor, bpm: number): ClickSchedule[];
  // contextSec = contextSecAtPosition(anchor, bpm, note.onPpqn): the render time whose heard time is the note's heard instant
  export type InputLatencyState = "default" | "calibrated";
  export function inputLatencySecondsFor(state: InputLatencyState, micInputPartMs: number): number; // 0 | micInputPartMs / 1000
  export interface ClickPlayer { cancel(): void }
  export function playClicks(audioContext: BaseAudioContext, destination: AudioNode, schedule: readonly ClickSchedule[]): ClickPlayer;
  // one OscillatorNode (sine, CLICK_HZ) through a GainNode per click: gain 0 → CLICK_GAIN at contextSec (setValueAtTime) → 0 at contextSec + CLICK_DURATION_SEC; osc.start(contextSec), osc.stop(contextSec + CLICK_DURATION_SEC + 0.005); cancel() stops every oscillator now
  ```
- Produces (`combinedDevices.ts`):
  ```ts
  export interface DeviceLike { deviceId: string; label: string; kind: "audioinput" | "audiooutput" | "videoinput" }
  export interface PickedDevice { deviceId: string; label: string }
  export function pickAudioDevice(devices: readonly DeviceLike[], kind: "audioinput" | "audiooutput", substring: string | null): PickedDevice | { error: string };
  // substring null: the first device whose label contains both "MacBook" and "Built-in" (case-insensitive), else the first of the kind; substring given: the first whose label contains it, else error listing the labels; no device of the kind: error naming the kind and the permission step
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// combinedClicks.test.ts
import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { clickContextTimes, inputLatencySecondsFor } from "./combinedClicks";

describe("clickContextTimes", () => {
  it("puts each click at the render time of its note's heard instant", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const s = clickContextTimes(pattern, { contextTime: 12, position: 0 }, 120);
    expect(s[0].index).toBe(0);
    expect(s[0].contextSec).toBeCloseTo(14, 9);                      // one bar at 120 = 2 s after the anchor
    expect(s[1].contextSec - s[0].contextSec).toBeCloseTo(0.25, 9);  // an eighth
    expect(s.length).toBe(48);
  });
});
describe("inputLatencySecondsFor", () => {
  it("is zero in the default state and the measured part in seconds when calibrated", () => {
    expect(inputLatencySecondsFor("default", 40.9)).toBe(0);
    expect(inputLatencySecondsFor("calibrated", 40.9)).toBeCloseTo(0.0409, 9);
  });
});

// combinedDevices.test.ts
import { describe, expect, it } from "vitest";
import { pickAudioDevice } from "./combinedDevices";
const d = (deviceId: string, label: string, kind: "audioinput" | "audiooutput" = "audioinput") => ({ deviceId, label, kind });
describe("pickAudioDevice", () => {
  it("prefers the built-in MacBook device when no substring is given", () => {
    expect(pickAudioDevice([d("x", "USB Audio CODEC"), d("m", "MacBook Pro Microphone (Built-in)")], "audioinput", null))
      .toEqual({ deviceId: "m", label: "MacBook Pro Microphone (Built-in)" });
  });
  it("falls back to the first device of the kind", () => {
    expect(pickAudioDevice([d("s", "Speakers", "audiooutput"), d("x", "USB Audio CODEC")], "audioinput", null)).toEqual({ deviceId: "x", label: "USB Audio CODEC" });
  });
  it("matches a substring case-insensitively and lists the labels when nothing matches", () => {
    expect(pickAudioDevice([d("x", "USB Audio CODEC")], "audioinput", "usb")).toEqual({ deviceId: "x", label: "USB Audio CODEC" });
    expect(pickAudioDevice([d("x", "USB Audio CODEC")], "audioinput", "Scarlett")).toMatchObject({ error: expect.stringContaining("USB Audio CODEC") });
  });
  it("names the permission step when there is no device of the kind", () => {
    expect(pickAudioDevice([d("s", "Speakers", "audiooutput")], "audioinput", null)).toMatchObject({ error: expect.stringMatching(/microphone|permission/i) });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/combinedClicks.test.ts src/lib/audit/combinedDevices.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules per the Interfaces block**

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/audit/combinedClicks.test.ts src/lib/audit/combinedDevices.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/combinedClicks.ts src/lib/audit/combinedDevices.ts src/lib/audit/combinedClicks.test.ts src/lib/audit/combinedDevices.test.ts
git commit -m "audit: combined MIDI + audio — click times from the anchor, device picking, input-latency state"
```

---

### Task 2: The round-trip calibration worklet

**Files:**
- Create: `src/lib/audit/combinedCalibration.ts`
- Test: `src/lib/audit/combinedCalibration.test.ts`

**Interfaces:**
- Consumes: `bandSplit` (`recordingAlignment.ts`), `detectOnsets` (`onsetDetection.ts`), `median` (`midiInputAlignment.ts`), `withDeadline`.
- Produces:
  ```ts
  export const CALIBRATION_CLICKS = 3;
  export const CALIBRATION_GAP_SEC = 1.0;
  export const CALIBRATION_LEAD_SEC = 1.0;          // input recorded before the first click: the noise floor
  export const CALIBRATION_MIN_RATIO_DB = 20;        // click peak over the floor, else "not found"
  export const CALIBRATION_PROCESSOR = "combined-calibration";
  export const CALIBRATION_PROCESSOR_SOURCE: string;  // registerProcessor(CALIBRATION_PROCESSOR, …), see below
  export interface CalibrationCapture { sampleRate: number; input: Float32Array; emitFrames: number[] } // input indexed by the worklet's own frame counter from its first process call
  export interface RoundTrip { emitFrame: number; detectFrame: number | null; roundTripMs: number | null; peakOverFloorDb: number | null }
  export function roundTripsFrom(capture: CalibrationCapture): RoundTrip[];
  // per emit: band-split the input above 3 kHz, floor = RMS of the lead second, peak and first onset inside [emitFrame, emitFrame + 0.5 s) via detectOnsets on that window (refractory 0.05); detectFrame null when peak/floor < CALIBRATION_MIN_RATIO_DB
  export interface MicRoundTrip { roundTripMs: number; roundTripSpreadMs: number; inputPartMs: number; clicksFound: number; floorDb: number; peakDb: number; perClick: RoundTrip[] }
  export function summarizeRoundTrips(trips: readonly RoundTrip[], outputLatencyMs: number, floorDb: number, peakDb: number): MicRoundTrip | { error: string };
  // error when fewer than CALIBRATION_CLICKS found: "calibration found N of 3 clicks (floor … dBFS, peak … dBFS): check the output device, headphones, volume"
  export async function measureMicRoundTrip(audioContext: AudioContext, source: AudioNode, outputLatencyMs: number): Promise<MicRoundTrip>;
  // addModule(blob url of the source), new AudioWorkletNode(…, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }); source → node → destination; node.port receives { input, emitFrames, sampleRate } when done (lead + 3 clicks + 0.5 s), deadline 10 s; disconnect; roundTripsFrom + summarizeRoundTrips; throws the error string
  ```
  The processor: counts frames from its first `process` call; copies input channel 0 into a preallocated buffer of `(CALIBRATION_LEAD_SEC + CALIBRATION_CLICKS × CALIBRATION_GAP_SEC + 0.5) × sampleRate` frames; at frame `lead + i × gap × sampleRate` (rounded to a quantum boundary) writes an 8 ms 6 kHz click at 0.5 into its output; posts the buffer and the emit frames once full; never touches `currentTime`/`currentFrame`.

- [ ] **Step 1: Write the failing tests**

```ts
// combinedCalibration.test.ts
import { describe, expect, it } from "vitest";
import { CALIBRATION_PROCESSOR_SOURCE, roundTripsFrom, summarizeRoundTrips } from "./combinedCalibration";

const rate = 44100;
const synth = (delays: Array<number | null>, noise = 0.001) => {
  const lead = rate, gap = rate;
  const input = new Float32Array(lead + delays.length * gap + rate / 2);
  for (let i = 0; i < input.length; i++) input[i] = (Math.random() * 2 - 1) * noise;
  const emitFrames = delays.map((_, i) => lead + i * gap);
  delays.forEach((d, i) => { if (d === null) return; const at = emitFrames[i] + d; for (let k = 0; k < 353; k++) input[at + k] += 0.5 * Math.sin((2 * Math.PI * 6000 * k) / rate); });
  return { sampleRate: rate, input, emitFrames };
};
describe("roundTripsFrom", () => {
  it("finds each click after its emit frame and reports the round trip in ms", () => {
    const trips = roundTripsFrom(synth([2822, 2822, 2822])); // 64 ms
    expect(trips.map((t) => t.roundTripMs!).every((ms) => Math.abs(ms - 64) < 4)).toBe(true); // the detector's hop is 1.45 ms at 44.1 kHz
    expect(trips.every((t) => (t.peakOverFloorDb ?? 0) > 20)).toBe(true);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/combinedCalibration.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `combinedCalibration.ts` per the Interfaces block**

Follow `src/lib/audit/loudnessTap.ts` for the processor-source-as-string pattern and `loudnessSession.ts` for `addModule` of a Blob URL with a deadline.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/audit/combinedCalibration.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/combinedCalibration.ts src/lib/audit/combinedCalibration.test.ts
git commit -m "audit: combined MIDI + audio — speaker-to-microphone round trip in the worklet's own frames"
```

---

### Task 3: The audio side: placement, matching, figures

**Files:**
- Create: `src/lib/audit/combinedAudio.ts`
- Test: `src/lib/audit/combinedAudio.test.ts`

**Interfaces:**
- Consumes: `PatternNote`; `pulsesToMs` (`midiClockMap.ts`); `median`, `percentile` (`midiInputAlignment.ts`); `MidiAuditNoteRow` (`midiInputArtifacts.ts`); `BEAT_PPQN` (`midiInputCalibration.ts`); `PPQN` (`@opendaw/lib-dsp`).
- Produces:
  ```ts
  export function onsetsToTimelineSec(onsetsFileSec: readonly number[], regionStartSec: number, waveformOffsetSec: number): number[]; // regionStartSec + (t − waveformOffsetSec)
  export function withinSpan(timelineSec: readonly number[], spanStartSec: number, spanEndSec: number): { inside: number[]; outside: number } // span = origin to last release
  export interface ClickPair { index: number; expectedPpqn: number; clickPpqn: number; audioErrorMs: number }
  export interface ClickMatch { pairs: ClickPair[]; clicksMissing: number[]; clicksExtraPpqn: number[]; anchorOffsetMs: number | null }
  export function matchClicks(pattern: readonly PatternNote[], clickPpqn: readonly number[], bpm: number): ClickMatch;
  // 1. eighth notes: nearest unused click within half an eighth (BEAT_PPQN / 4) of note.onPpqn; anchorOffsetMs = median of their errors (null when none matched)
  // 2. thirty-second notes: nearest unused click within half a 1/32 (BEAT_PPQN / 16) of note.onPpqn + anchor offset in pulses; errors reported RAW (against note.onPpqn)
  // 3. unmatched notes → clicksMissing (indices); unused clicks → clicksExtraPpqn
  export interface CombinedPair { index: number; midiRecordedPpqn: number; clickPpqn: number; partsApartMs: number }
  export interface CombinedFigures {
    clicksFound: number; clicksMissing: number; clicksExtra: number; onsetsOutsideSpan: number;
    audioMedianMs: number | null; audioMaxAbsDevMs: number | null;
    pairs: number; partsApartMedianMs: number | null; partsApartMaxAbsDevMs: number | null; partsApartP5P95Ms: number | null;
    anchorOffsetMs: number | null;
  }
  export function measureCombined(match: ClickMatch, midiNotes: readonly MidiAuditNoteRow[], bpm: number, onsetsOutsideSpan: number): { figures: CombinedFigures; pairs: CombinedPair[] };
  // a pair exists for every pattern index with a matched click AND a matched MIDI row (outcome "matched"); partsApartMs = pulsesToMs(midi.recordedPpqn − clickPpqn, bpm); medians/devs as the MIDI figures do
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// combinedAudio.test.ts
import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { matchClicks, measureCombined, onsetsToTimelineSec, withinSpan } from "./combinedAudio";

const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
const late = (ms: number, bpm = 120) => (ms / (60_000 / bpm)) * 960;

describe("onsetsToTimelineSec / withinSpan", () => {
  it("maps file time through the region start and waveform offset and splits the span", () => {
    expect(onsetsToTimelineSec([0.5, 1.5], 2.0, 0.1)).toEqual([2.4, 3.4]);
    expect(withinSpan([1.9, 2.4, 3.4, 9.0], 2.0, 8.0)).toEqual({ inside: [2.4, 3.4], outside: 2 });
  });
});

describe("matchClicks", () => {
  it("anchors on the eighth bars and matches a 65 ms late 1/32 bar to the right notes", () => {
    const clicks = pattern.map((n) => n.onPpqn + late(65));
    const m = matchClicks(pattern, clicks, 120);
    expect(m.pairs.length).toBe(48);
    expect(m.anchorOffsetMs).toBeCloseTo(65, 6);
    expect(m.pairs.every((p) => Math.abs(p.audioErrorMs - 65) < 1e-6)).toBe(true);
    expect(m.clicksMissing).toEqual([]);
  });
  it("leaves a lost click missing without shifting the pairs after it", () => {
    const clicks = pattern.filter((n) => n.index !== 20).map((n) => n.onPpqn + late(40));
    const m = matchClicks(pattern, clicks, 120);
    expect(m.clicksMissing).toEqual([20]);
    expect(m.pairs.find((p) => p.index === 21)!.audioErrorMs).toBeCloseTo(40, 6);
  });
  it("counts a noise burst as extra and never pairs it", () => {
    const clicks = [...pattern.map((n) => n.onPpqn + late(40)), pattern[5].onPpqn + late(40) + 200];
    const m = matchClicks(pattern, clicks, 120);
    expect(m.clicksExtraPpqn).toEqual([pattern[5].onPpqn + late(40) + 200]);
    expect(m.pairs.find((p) => p.index === 5)!.audioErrorMs).toBeCloseTo(40, 6);
  });
});

describe("measureCombined", () => {
  it("pairs a matched click with a matched MIDI row and reports midi minus audio", () => {
    const clicks = pattern.map((n) => n.onPpqn + late(40));
    const m = matchClicks(pattern, clicks, 120);
    const rows = pattern.map((n) => ({ index: n.index, outcome: "matched", recordedPpqn: n.onPpqn + late(32) } as never));
    const { figures, pairs } = measureCombined(m, rows, 120, 1);
    expect(pairs.length).toBe(48);
    expect(figures.partsApartMedianMs).toBeCloseTo(-8, 6);
    expect(figures).toMatchObject({ clicksFound: 48, clicksMissing: 0, clicksExtra: 0, onsetsOutsideSpan: 1 });
    expect(figures.audioMedianMs).toBeCloseTo(40, 6);
  });
  it("drops a pair whose MIDI row is missing and keeps the figures over the rest", () => {
    const clicks = pattern.map((n) => n.onPpqn);
    const rows = pattern.map((n) => ({ index: n.index, outcome: n.index === 3 ? "missing" : "matched", recordedPpqn: n.index === 3 ? null : n.onPpqn } as never));
    expect(measureCombined(matchClicks(pattern, clicks, 120), rows, 120, 0).pairs.length).toBe(47);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/combinedAudio.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `combinedAudio.ts` per the Interfaces block**

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/audit/combinedAudio.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/combinedAudio.ts src/lib/audit/combinedAudio.test.ts
git commit -m "audit: combined MIDI + audio — click placement, eighth-anchored matching, parts-apart figures"
```

---

### Task 4: Verdict and artifacts

**Files:**
- Create: `src/lib/audit/combinedVerdict.ts`, `src/lib/audit/combinedArtifacts.ts`
- Test: `src/lib/audit/combinedVerdict.test.ts`, `src/lib/audit/combinedArtifacts.test.ts`

**Interfaces:**
- Consumes: `CombinedFigures`, `CombinedPair` (Task 3); `InputLatencyState` (Task 1); `MicRoundTrip` (Task 2); `RepeatFigures`, `BandContext`, `expectedLateMedianMs`, `clampJitterBoundMs`, `quantumMs`, `LATE_MEDIAN_MARGIN_MS` (`midiInputAlignment.ts`); `MidiScenario`; `MidiAuditNoteRow`; `AuditBuildFeature`.
- Produces (`combinedVerdict.ts`):
  ```ts
  export type CombinedStatus = "together" | "matches-known-defect" | "investigate";
  export interface CombinedContext extends BandContext { state: InputLatencyState; micInputPartMs: number; inputLatencyAppliedMs: number }
  export function expectedPartsApartMs(ctx: CombinedContext): number; // expectedLateMedianMs(ctx) − (micInputPartMs − inputLatencyAppliedMs)
  export function classifyCombinedCell(scenario: MidiScenario, repeats: ReadonlyArray<{ midi: RepeatFigures; combined: CombinedFigures; context: CombinedContext | null }>): { status: CombinedStatus; detail: string };
  // order: MIDI integrity (missing/receiptsMissing/extra/stuck/velocityMismatches > 0) → investigate naming it; clicksMissing/clicksExtra > 0 → investigate; no pairs → investigate; "together" when every |partsApartMedianMs| ≤ quantumMs(sampleRate) and partsApartMaxAbsDevMs ≤ clampJitterBoundMs; else, with every context present: default-state attribution — if |audioMedianMs − micInputPartMs| > clampJitterBoundMs → investigate "audio median … disagrees with the calibration … on repeat N (microphone path, not the SDK)"; band: every |partsApartMedianMs − expectedPartsApartMs| ≤ LATE_MEDIAN_MARGIN_MS and dev ≤ clampJitterBoundMs → matches-known-defect with the expected value in the detail; context missing → investigate "no band context"; else investigate naming the median
  ```
- Produces (`combinedArtifacts.ts`):
  ```ts
  export const COMBINED_SCHEMA_VERSION = 1;
  export const COMBINED_ROW_COUNTS = ["clicksFound", "clicksMissing", "clicksExtra", "pairs", "onsetsOutsideSpan"] as const;
  export interface CombinedRow extends CombinedFigures {
    scenario: MidiScenario; state: InputLatencyState; bpm: number; repeat: number; status: CombinedStatus | "pending" | "error"; detail: string | null;
    midi: RepeatFigures | null; midiNotes: MidiAuditNoteRow[]; pairsDetail: CombinedPair[];
    micRoundTripMs: number | null; micRoundTripSpreadMs: number | null; micInputPartMs: number | null; inputLatencyAppliedMs: number | null;
    outputLatencyMs: number | null; compensationLatencyMs: number | null; heardLagMs: number | null; frameIntervalMs: number | null; frameGapMaxMs: number | null; sampleRate: number | null;
    anchorContextTime: number | null; originPpqn: number | null; takeRegionStartSec: number | null; waveformOffsetSec: number | null; cleanupWarning: string | null;
  }
  export interface CombinedCellVerdict { scenario: MidiScenario; state: InputLatencyState; status: CombinedStatus; detail: string }
  export interface CombinedSummary { schemaVersion: number; runToken: number; userAgent: string; sdkVersion: string; buildFeatures: AuditBuildFeature[]; busName: string; inputDevice: string; outputDevice: string; sampleRate: number; micRoundTrip: MicRoundTrip; repeatsPerCell: number; scenarios: MidiScenario[]; states: InputLatencyState[]; cellVerdicts: CombinedCellVerdict[]; rows: CombinedRow[] }
  export function combinedSummaryFileName(runToken: number): string; // `combined-summary-${runToken}.json`
  export function parseCombinedSummary(json: unknown, runToken: number): CombinedSummary; // version must equal COMBINED_SCHEMA_VERSION; rows array; every COMBINED_ROW_COUNTS key a number on every row
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// combinedVerdict.test.ts
import { describe, expect, it } from "vitest";
import { classifyCombinedCell, expectedPartsApartMs } from "./combinedVerdict";
const ctx = (state: "default" | "calibrated", micInputPartMs = 40.9) => ({
  outputLatencyMs: 23, compensationLatencyMs: 0, frameIntervalMs: 16.7, sampleRate: 44100, state, micInputPartMs, inputLatencyAppliedMs: state === "calibrated" ? micInputPartMs : 0,
});
const midi = (over = {}) => ({ notesSent: 48, notesRecorded: 48, judgedNotes: 48, missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, velocityMismatches: 0, collapsed: 0, placementMedianMs: 32.8, placementMaxAbsDevMs: 9, placementP5P95Ms: 8, durationErrorMedianMs: 0, durationErrorMaxMs: 8, loopbackDelayMedianMs: 0, loopbackDelayMaxMs: 0, wrapAdjacent: 0, countInNotes: 0, countInRecorded: 0, ...over });
const combined = (apart: number, audio: number, over = {}) => ({ clicksFound: 48, clicksMissing: 0, clicksExtra: 0, onsetsOutsideSpan: 0, audioMedianMs: audio, audioMaxAbsDevMs: 3, pairs: 48, partsApartMedianMs: apart, partsApartMaxAbsDevMs: 9, partsApartP5P95Ms: 8, anchorOffsetMs: audio, ...over });

describe("expectedPartsApartMs", () => {
  it("is the MIDI late term minus what the SDK was not told about the microphone", () => {
    expect(expectedPartsApartMs(ctx("default"))).toBeCloseTo(32.2 - 40.9, 1);
    expect(expectedPartsApartMs(ctx("calibrated"))).toBeCloseTo(32.2, 1);
  });
});
describe("classifyCombinedCell", () => {
  it("is together only within a quantum and a frame of jitter", () => {
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(1.5, 40.9, { partsApartMaxAbsDevMs: 5 }), context: ctx("default") }]).status).toBe("together");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-8.6, 40.9), context: ctx("default") }]).status).toBe("matches-known-defect");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(32.5, 0.4), context: ctx("calibrated") }]).status).toBe("matches-known-defect");
  });
  it("names a microphone path that moved after the calibration, before any band", () => {
    const v = classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-32, 64.8), context: ctx("default") }]);
    expect(v.status).toBe("investigate");
    expect(v.detail).toMatch(/disagrees with the calibration/);
  });
  it("fails on a lost click or a MIDI integrity count and on a missing context", () => {
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-8.6, 40.9, { clicksMissing: 1 }), context: ctx("default") }]).detail).toContain("clicksMissing 1");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi({ missing: 1 }), combined: combined(-8.6, 40.9), context: ctx("default") }]).detail).toContain("missing 1");
    expect(classifyCombinedCell("nominal-start", [{ midi: midi(), combined: combined(-8.6, 40.9), context: null }]).detail).toContain("no band context");
  });
});

// combinedArtifacts.test.ts
import { describe, expect, it } from "vitest";
import { COMBINED_SCHEMA_VERSION, combinedSummaryFileName, parseCombinedSummary } from "./combinedArtifacts";
describe("combinedArtifacts", () => {
  it("names the file and validates the counts", () => {
    expect(combinedSummaryFileName(5)).toBe("combined-summary-5.json");
    const row = { clicksFound: 48, clicksMissing: 0, clicksExtra: 0, pairs: 48, onsetsOutsideSpan: 0 };
    const ok = { schemaVersion: COMBINED_SCHEMA_VERSION, rows: [row], cellVerdicts: [], runToken: 5 };
    expect(parseCombinedSummary(ok, 5).rows.length).toBe(1);
    expect(() => parseCombinedSummary({ ...ok, schemaVersion: 9 }, 5)).toThrow(/schemaVersion/);
    expect(() => parseCombinedSummary({ ...ok, rows: [{ ...row, pairs: undefined }] }, 5)).toThrow(/lacks pairs/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/combinedVerdict.test.ts src/lib/audit/combinedArtifacts.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules per the Interfaces block**

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/audit/combinedVerdict.test.ts src/lib/audit/combinedArtifacts.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/combinedVerdict.ts src/lib/audit/combinedArtifacts.ts src/lib/audit/combinedVerdict.test.ts src/lib/audit/combinedArtifacts.test.ts
git commit -m "audit: combined MIDI + audio — cell verdict with the calibration attribution, artifact types"
```

---

### Task 5: Hooks on the MIDI runner, metronome off, copy fix

**Files:**
- Modify: `src/lib/audit/midiInputCellRunner.ts` (`MidiCellRepeatOptions`, the prefs stage, the schedule stage)
- Modify: `src/demos/midi/midi-input-alignment-audit-debug-demo.tsx` (the configuration card's `?audible=1` line)
- Modify: `src/demos/midi/CLAUDE.md` (the "silent" sentence, if any)
- Test: `src/lib/audit/midiInputCellRunner.test.ts` (the hook context builder)

**Interfaces:**
- Produces (added to `midiInputCellRunner.ts`):
  ```ts
  export interface ScheduleContext { pattern: PatternNote[]; scheduled: ScheduledNote[]; anchor: RecordingAnchor; pair: OutputStampPair; bpm: number; originPpqn: number; perfAt: (ppqn: number) => number; contextSecAt: (ppqn: number) => number }
  export function scheduleContext(pattern, scheduled, anchor, pair, bpm, originPpqn): ScheduleContext; // perfAt and contextSecAt from midiClockMap
  // MidiCellRepeatOptions gains:
  //   metronome?: { enabled: boolean; gainDb?: number }   // default { enabled: false }; the prefs stage writes settings.metronome.enabled and, when gainDb is given, settings.metronome.gain
  //                                                       // engine preferences PERSIST in localStorage across pages: the runner remembers the gain it found and restores it in a finally around the repeat, so a −Infinity set for a count-in never leaks into another demo
  //   onScheduled?: (context: ScheduleContext) => void     // called right after loopback.schedule(scheduled), before the jank is armed
  //   beforeStop?: () => void                               // called at the start of the "stopping" stage (the combined runner reads the Tape loader before the stop)
  ```
  The MIDI page passes nothing (metronome off from now on). The configuration card's `?audible=1` line reads "hear the synth (the metronome is off; the engine mixes it after the master, so a silenced master would not have silenced it)".

- [ ] **Step 1: Write the failing test**

```ts
// appended to midiInputCellRunner.test.ts
import { scheduleContext } from "./midiInputCellRunner";
describe("scheduleContext", () => {
  it("gives the render context time and the performance time of a position from one anchor and pair", () => {
    const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });
    const c = scheduleContext(pattern, scheduleFor(pattern, anchor, pair, 120), anchor, pair, 120, BAR_PPQN);
    expect(c.contextSecAt(BAR_PPQN)).toBeCloseTo(14, 9);
    expect(c.perfAt(BAR_PPQN)).toBeCloseTo(9000, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/audit/midiInputCellRunner.test.ts`
Expected: FAIL, `scheduleContext` is not exported.

- [ ] **Step 3: Implement the hooks and the metronome option; flip the MIDI page's metronome off and fix its copy**

In the prefs stage replace `settings.metronome.enabled = true;` with the option (default off); when `gainDb` is given, remember `settings.metronome.gain` first and restore it in a `finally` that wraps the rest of the repeat. Call `options.onScheduled?.(scheduleContext(...))` after `loopback.schedule(scheduled)`. Call `options.beforeStop?.()` at the top of the stopping stage.

- [ ] **Step 4: Run the MIDI suite and typecheck**

Run: `npx vitest run src/lib/audit/midi && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiInputCellRunner.ts src/lib/audit/midiInputCellRunner.test.ts src/demos/midi/midi-input-alignment-audit-debug-demo.tsx src/demos/midi/CLAUDE.md
git commit -m "audit: MIDI runner — schedule and stop hooks, metronome off by default (the engine mixes it after the master)"
```

---

### Task 6: The combined cell runner

**Files:**
- Create: `src/lib/audit/combinedCellRunner.ts`
- Test: `src/lib/audit/combinedCellRunner.test.ts` (pure pieces: `takeSpanSec`, `audioFiguresFrom`)

**Interfaces:**
- Consumes: Tasks 1–5; `runMidiCellRepeat`, `resetForNextMidiCell`, `FrameWatch`, `type RepeatToken` (`midiInputCellRunner.ts`); `waitForLoaderTerminal` (`recordingCellRunner.ts`); `bandSplit`, `detectOnsets`; `CaptureAudio` (`@opendaw/studio-core`); `AudioUnitBoxAdapter`.
- Produces:
  ```ts
  export interface CombinedRepeatOptions {
    project: Project; audioContext: AudioContext; loopback: MidiLoopbackSender; frameWatch: FrameWatch;
    midiUnitBox: AudioUnitBox; tapeAdapter: AudioUnitBoxAdapter; tapeCapture: CaptureAudio;
    scenario: MidiScenario; state: InputLatencyState; bpm: number; repeat: number; micRoundTrip: MicRoundTrip;
    onStage: (stage: string) => void; token: RepeatToken;
  }
  export interface CombinedRepeatResult { midi: MidiCellRepeatResult; figures: CombinedFigures; pairs: CombinedPair[]; takeRegionStartSec: number; waveformOffsetSec: number; inputLatencyAppliedMs: number }
  export function takeSpanSec(originPpqn: number, pattern: readonly PatternNote[], tempoMap: { ppqnToSeconds(ppqn: number): number }): { startSec: number; endSec: number }; // origin to the last note's release
  export function audioFiguresFrom(input: { mono: Float32Array; sampleRate: number; regionStartSec: number; waveformOffsetSec: number; span: { startSec: number; endSec: number }; pattern: readonly PatternNote[]; bpm: number; tempoMap: { secondsToPPQN(sec: number): number }; midiNotes: readonly MidiAuditNoteRow[] }): { figures: CombinedFigures; pairs: CombinedPair[] };
  // bandSplit → detectOnsets(high, { refractorySec: 0.03 }) → onsetsToTimelineSec → withinSpan → secondsToPPQN → matchClicks → measureCombined
  export function applyInputLatencyState(project: Project, tapeCapture: CaptureAudio, state: InputLatencyState, micInputPartMs: number): number; // editing.modify(captureBox.inputLatency.setValue(seconds)); returns the ms applied
  export async function runCombinedRepeat(options: CombinedRepeatOptions): Promise<CombinedRepeatResult>;
  // assert the Tape has no audio region and the capture is armed; applyInputLatencyState; runMidiCellRepeat with metronome: { enabled: false, gainDb: scenario === "countin-start" ? -Infinity : undefined } (the count-in forces the metronome on; the runner restores the gain); const player = playClicks on onScheduled with clickContextTimes(context.pattern, context.anchor, bpm) connected to audioContext.destination; beforeStop: grab the Tape's first audio region adapter and its loader; after runMidiCellRepeat returns: waitForLoaderTerminal(loader, 30_000), loader.data.unwrap(), frames[0]; regionStartSec = tempoMap.ppqnToSeconds(region.position); waveformOffsetSec = region.box.waveformOffset.getValue(); audioFiguresFrom; player.cancel() on any throw
  export async function resetForNextCombinedCell(project: Project, midiUnitBox: AudioUnitBox, tapeAdapter: AudioUnitBoxAdapter, tapeCapture: CaptureAudio, loopback: MidiLoopbackSender): Promise<string | null>;
  // resetForNextMidiCell, then the audio harness's cleanup shape: wait for the loader terminal (10 s grace, warning on timeout), delete the Tape's regions and file box in one transaction, captureBox.inputLatency back to 0
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// combinedCellRunner.test.ts
import { describe, expect, it } from "vitest";
import { BAR_PPQN } from "./auditExpectations";
import { buildPattern } from "./midiInputPattern";
import { audioFiguresFrom, takeSpanSec } from "./combinedCellRunner";

const tempo120 = { ppqnToSeconds: (p: number) => p / 1920, secondsToPPQN: (s: number) => s * 1920 };
const pattern = buildPattern({ originPpqn: BAR_PPQN, loopEndPpqn: null });

describe("takeSpanSec", () => {
  it("runs from the origin to the last release", () => {
    const span = takeSpanSec(BAR_PPQN, pattern, tempo120);
    expect(span.startSec).toBeCloseTo(2, 9);
    expect(span.endSec).toBeCloseTo((pattern.at(-1)!.onPpqn + pattern.at(-1)!.durationPpqn) / 1920, 9);
  });
});

describe("audioFiguresFrom", () => {
  it("finds synthetic clicks in a take and pairs them with MIDI rows", () => {
    const rate = 44100, regionStartSec = 2, waveformOffsetSec = 0.05;
    const mono = new Float32Array(rate * 8);
    for (const n of pattern) { const t = n.onPpqn / 1920 + 0.040 - regionStartSec + waveformOffsetSec; const at = Math.round(t * rate); for (let k = 0; k < 353; k++) mono[at + k] += 0.5 * Math.sin((2 * Math.PI * 6000 * k) / rate); }
    const midiNotes = pattern.map((n) => ({ index: n.index, outcome: "matched", recordedPpqn: n.onPpqn + 61.4 } as never)); // +32 ms at 120
    const { figures } = audioFiguresFrom({ mono, sampleRate: rate, regionStartSec, waveformOffsetSec, span: takeSpanSec(BAR_PPQN, pattern, tempo120), pattern, bpm: 120, tempoMap: tempo120, midiNotes });
    expect(figures.clicksFound).toBe(48);
    expect(figures.clicksMissing).toBe(0);
    expect(Math.abs((figures.audioMedianMs as number) - 40)).toBeLessThan(3);        // onset hop 1.45 ms plus envelope lag
    expect(Math.abs((figures.partsApartMedianMs as number) + 8)).toBeLessThan(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/combinedCellRunner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `combinedCellRunner.ts` per the Interfaces block**

Read `recordingCellRunner.ts` `resetForNextCell` (lines ~906–945) and the measuring stage (~736–790) before writing the audio read-back; keep the token asserts.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/audit/combinedCellRunner.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/combinedCellRunner.ts src/lib/audit/combinedCellRunner.test.ts
git commit -m "audit: combined MIDI + audio — the repeat: clicks on the MIDI schedule, the take read back and paired"
```

---

### Task 7: The page

**Files:**
- Create: `midi-audio-combined-audit-debug-demo.html` (copy the MIDI sweep's HTML; title "Combined MIDI + Audio Audit harness (unlisted)"; script `/src/demos/midi/midi-audio-combined-audit-debug-demo.tsx`)
- Create: `src/demos/midi/midi-audio-combined-audit-debug-demo.tsx`
- Modify: `vite.config.ts` (input `midiAudioCombinedAudit` after `midiInputAlignmentAudit`)

**Interfaces:**
- Consumes: Tasks 1–6; `initializeOpenDAW`; `detectBuildFeatures`; `runRepeatWithDeadline`; `MidiDevices`, `CaptureMidi`, `CaptureAudio`; `InstrumentFactories`; `pickIacPorts`, `MidiLoopbackSender`; `OPENDAW_SDK_VERSION`; the Radix components and `DebugLinkBar` as the MIDI page.
- Produces: the page. Params per the spec: `scenario` (`all` = `nominal-start`, `countin-start`, `janked-mid`; else one of them), `bpm` (default 120), `repeats` (default 3), `state` (`default` | `calibrated` | `both`, default `both`), `bus`, `input`, `output`, `audible`.

- [ ] **Step 1: Write the page**

Mirror the MIDI page's structure. `createMatrixContext()`:
1. `initializeOpenDAW({ bpm: 120 })`; `detectBuildFeatures`, require `recordingStart`; refuse if `project.engine.preferences.settings.recording.inputLatency !== 0` (name the value and the page that may have left it).
2. `await navigator.mediaDevices.getUserMedia({ audio: true })` once (labels need a granted permission), stop its tracks; `enumerateDevices()`; `pickAudioDevice` for input and output; if the output is not the default and `setSinkId` exists on the context, `await audioContext.setSinkId(deviceId)`; without `setSinkId` refuse a non-default `output`.
3. MIDI access, IAC ports, sender, Vaporisateur + pinned MIDI capture, as the MIDI page.
4. Tape: `createInstrument(InstrumentFactories.Tape)`; capture `instanceof CaptureAudio`; in a second transaction `captureBox.deviceId.setValue(inputDeviceId)`, `capture.requestChannels = 1`, `captureBox.inputLatency.setValue(0)`; `capture.monitoringMode = "off"`; `capture.armed.setValue(true)`; wait until `capture.outputNode.nonEmpty()` (poll 100 ms, 10 s deadline).
5. Master to −96 dB unless `audible=1`.
6. Calibration: `measureMicRoundTrip(audioContext, capture.outputNode.unwrap(), audioContext.outputLatency * 1000)`; show the figures in the state card; refuse on error.
`runAudit`: for scenario × state × repeat: `runRepeatWithDeadline(token => runCombinedRepeat({...}), 150_000, label)`; `resetForNextCombinedCell` unconditionally; row from the result or an error row (with the hidden/frame-gap diagnostics as the MIDI page); per cell `classifyCombinedCell`; summary with `micRoundTrip`, PUT to `/__verify/${combinedSummaryFileName(runToken)}`. Table columns: scenario, state, repeat, status, pairs, clicks found/missing/extra, parts-apart median / max dev / p5–p95, MIDI median, audio median, mic round trip / input part / applied, frame, heard lag, detail. Configuration card: the params, the prediction sentence from the spec ("about −8 ms uncalibrated — the audio lands later than the key — and about +32 ms calibrated, at 60 Hz with 23 ms output latency and a 41 ms input part"), the no-preference-write rule, "keep the room quiet and the window uncovered".

- [ ] **Step 2: Typecheck and serve**

Run: `npm run typecheck`; dev server on 5173 if not running.
Expected: exit 0; the page renders.

- [ ] **Step 3: Smoke one cell with a real click**

Open `?scenario=nominal-start&bpm=120&repeats=1&state=default` in Chrome. The first run prompts for the microphone: if the prompt does not appear in the automation view, ask the user to click Allow once (Chrome remembers it per origin). Expected after `done`: one row, `clicksFound` 48, `clicksMissing` 0, a `micRoundTripMs` in the 60–90 ms range, a `partsApartMedianMs` near the prediction, `status` `matches-known-defect` or `investigate` with a named figure, and `combined-summary-<token>.json` in `.verify-output/`. If `clicksFound` is 0: check `audible` paths and the output device before touching the detector.

- [ ] **Step 4: Commit**

```bash
git add midi-audio-combined-audit-debug-demo.html src/demos/midi/midi-audio-combined-audit-debug-demo.tsx vite.config.ts
git commit -m "audit: combined MIDI + audio — the unlisted page"
```

---

### Task 8: Table script

**Files:**
- Create: `scripts/audit/midi-audio-combined/table.ts`

- [ ] **Step 1: Write it** on the model of `scripts/audit/midi-input-alignment/table.ts`: one line per (scenario, state) cell: status | parts-apart median per repeat | max dev | clicks found/missing/extra | MIDI median | audio median | mic round trip / input part | detail, plus error rows' details; the run line with the input and output device labels and the mic figures.

- [ ] **Step 2: Run it on the smoke summary**

Run: `node scripts/audit/midi-audio-combined/table.ts`
Expected: one cell line and the run line.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit/midi-audio-combined/table.ts
git commit -m "audit: combined MIDI + audio — register table from a summary"
```

---

### Task 9: Bring-up, register, docs

**Files:**
- Create: `debug/2026-10-20-midi-audio-combined/note.md`
- Modify: `debug/README.md` (index row, newest first), `debug/2026-10-20-midi-input-alignment/note.md` (a cross-link under "Against the audio recorder"), `CLAUDE.md` (Build & Verification bullet after the MIDI sweep's), `src/demos/midi/CLAUDE.md` (a section)

- [ ] **Step 1: Write the prediction into the note BEFORE the run**: header as the other registers (SDK pin from `node_modules/@opendaw/studio-sdk/package.json`, harness, library, reading a row, what `together` says), then "Prediction (before the first run)": `partsApartMs ≈ expectedLateMedianMs − (micInputPartMs − applied)`: about −8 ms in the default state (the audio part lands later than the key), about +32 ms calibrated, at 60 Hz, 23 ms, with the input part this run measures; the round-trip figures of the audio campaign (64 / 88 ms) as the range to expect.

- [ ] **Step 2: Run the full sweep** with the window uncovered and the room quiet: `?scenario=all&bpm=120` (both states, three repeats). Then `node scripts/audit/midi-audio-combined/table.ts`. Expected: no lost click, no MIDI integrity failure, every cell `matches-known-defect` or `together`; any `investigate` gets its own subsection with the figure named.

- [ ] **Step 3: Fill the register**: the table, the mic round trip of this run against the audio campaign's, the per-state medians against the prediction, the attribution rows (audio median vs input part), one sentence per mechanism confirmed or not, open items (the manual mode, the interface arm), the hold on upstream issues. Index row in `debug/README.md`; cross-link from the MIDI register's "Against the audio recorder (inferred…)" section to this note's measured section and update its heading if the measurement now exists.

- [ ] **Step 4: Docs**: root CLAUDE.md bullet (`midi-audio-combined-audit-debug-demo.html?scenario=all&bpm=120`, laptop devices, IAC online, room quiet, window uncovered, read against the register; no versions); `src/demos/midi/CLAUDE.md` section (parameters, the two states, the calibration and why it reads the capture's own node, the eighth-anchor matching, what the figure says and does not say, the metronome rule, the no-preference-write rule).

- [ ] **Step 5: Commit**

```bash
git add debug CLAUDE.md src/demos/midi/CLAUDE.md
git commit -m "debug: combined MIDI + audio — bring-up sweep, prediction check, register, docs"
```

---

### Task 10: Review, retire the spec and plan, PR

- [ ] **Step 1: Final checks**: `npm run typecheck && npx vitest run`; `git diff main | grep -nE '^\+.*0\.0\.1[0-9]{2}' | grep -v debug/` empty; `grep -ic moises` on the PR body 0.
- [ ] **Step 2: Whole-branch review** per the executing skill; fix Critical and Important; then `git rm` the spec and this plan (decisions live in the register and the CLAUDE.md files).
- [ ] **Step 3: Push and open the PR** against `main` with a body in the style of PR #162 (what it measures, the two states, the bring-up table, the hold on upstream issues, deferred items); then `/pr-review-toolkit:review-pr` and fix Critical + Important before merge.
