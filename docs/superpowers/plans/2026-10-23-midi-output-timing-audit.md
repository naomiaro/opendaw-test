# MIDI Output Timing Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unlisted audit page that measures, on the AudioContext clock, when the SDK asks a hardware MIDI output to deliver each note of a pattern, with a page-scheduled control arm on the same IAC bus, and the first measurement written up.

**Architecture:** Pure, Node-tested modules under `src/lib/audit/` hold the parameters, the pattern, the per-note and per-repeat figures, the verdicts and the envelope schema; one browser module builds the project state (MIDI Output instrument + `MIDIOutputBox` + note region) and one runs a repeat (anchor from a no-capture recording, one `getOutputTimestamp` pair, the arm, the jank, the receipts); the page composes them in the layout of the MIDI input alignment page. The MIDI loopback, clock map, anchor wait, jank blocker and frame watch are reused from the input harness.

**Tech Stack:** TypeScript (strict), React + Radix (page only), Vitest (Node), `@opendaw/studio-core` / `studio-adapters` / `studio-boxes` as installed, Web MIDI over the macOS IAC Driver, the dev server's `/__verify` sink.

**Spec:** `docs/superpowers/specs/2026-10-23-midi-output-timing-design.md`

## Global Constraints

- Everything is judged on the AudioContext clock; ONE `getOutputTimestamp()` pair per repeat bridges to the Web MIDI clock, through `midiClockMap.ts` only.
- Nothing is netted out of `errorMs`; latencies, the delay and the frame interval ride on the row for attribution.
- No SDK patch, no override of `receivedMIDIFromEngine`, no intercepted `send`, no read of `midiOutNotifier`.
- The region starts at `&origin` (default bar 2) for both arms; a repeat whose anchor arrives later than origin minus 300 ms is an error row `anchor-too-late`.
- `&transport` default 1; `&delay` default the schema's 10; `&jank` default none, `&jankMs` default 80, blocks every 500 ms from the pattern midpoint.
- `MIDI_OUT_KNOWN_DEFECTS` is EMPTY until the first run's rows pin it; the note's prediction is committed BEFORE the first run.
- Repo rules: `npm run typecheck` exit 0 before every commit; tests in Node (no jsdom needed here); real click on Run; no edits under `src/` or `public/` while a browser run is on; this repo's comments say why, upstream style does not apply.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- A stray receipt whose pitch is outside the pattern (the SDK's all-notes-off at stop, a stuck key): counted as `extra`, never paired, never a crash → Task 3 test.
- `&delay=500`: every engine-arm note is late by 500 ms by design and must still pair → Task 3 test (window includes the delay).
- Transport messages on (24-ppq Clock, Start, SongPosition on the same bus): never reach the note receipts, counted per repeat → Task 1 (`classifyMidiStatus`) and Task 6 test.
- No note inside any jank block (short pattern, late blocks): `medianErrorInsideBlocksMs` is null, never NaN → Task 3 test.
- `?arm=engine` alone: engine cells read `not-judged: no-control`, and `?arm=page` alone has no engine cells → Task 4 test and Task 1 test.

---

### Task 1: Parameters and MIDI status classification

**Files:**
- Create: `src/lib/audit/midiOutputParams.ts`
- Test: `src/lib/audit/midiOutputParams.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OutputArm = "page" | "engine";
  export type Density = "32nd" | "8th" | "both";
  export type JankMode = "none" | "mid";
  export interface MidiOutputParams {
    arms: readonly OutputArm[];        // ["page","engine"] for both
    bpms: readonly number[];           // "all" → [90,120,140]; else one, 60..220
    densities: readonly Density[];     // "both" is ONE density (2 bars eighths + 1 bar 1/32), not two
    bars: number;                      // 1..8, ignored by density "both"
    repeats: number;                   // 1..10
    delayInMs: number;                 // 0..500
    janks: readonly JankMode[];        // &jank=none|mid|both → one or two entries
    jankMs: number;                    // 10..500
    transports: readonly boolean[];    // &transport=1|0|both → [true] | [false] | [true,false]
    originBar: number;                 // 1..8
    bus: string;                       // default MIDI_BUS_DEFAULT ("IAC")
  }
  export function parseMidiOutputParams(params: URLSearchParams): MidiOutputParams; // throws naming the bad param
  export type MidiStatusKind = "note-on" | "note-off" | "transport" | "other";
  export function classifyMidiStatus(status: number): MidiStatusKind; // 0x9n → note-on (velocity 0 is the caller's concern), 0x8n → note-off, 0xF8/0xFA/0xFC/0xF2 → transport
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("parseMidiOutputParams", () => {
  it("defaults to both arms, 140 bpm, 1/32, 3 bars, 2 repeats, delay 10, no jank, transport on, origin bar 2, bus IAC", () => {
    expect(parseMidiOutputParams(new URLSearchParams(""))).toEqual({
      arms: ["page", "engine"], bpms: [140], densities: ["32nd"], bars: 3, repeats: 2, delayInMs: 10,
      janks: ["none"], jankMs: 80, transports: [true], originBar: 2, bus: "IAC",
    });
  });
  it("reads bpm=all, jank=both, transport=both, arm=engine", () => {
    const p = parseMidiOutputParams(new URLSearchParams("bpm=all&jank=both&transport=both&arm=engine"));
    expect(p.bpms).toEqual([90, 120, 140]); expect(p.janks).toEqual(["none", "mid"]);
    expect(p.transports).toEqual([true, false]); expect(p.arms).toEqual(["engine"]);
  });
  it("refuses out-of-range and unknown values, naming the parameter", () => {
    for (const q of ["bpm=50", "delay=501", "repeats=0", "jankMs=5", "origin=9", "density=16th", "arm=both&arm=x", "transport=yes"]) {
      expect(() => parseMidiOutputParams(new URLSearchParams(q))).toThrow(new RegExp(q.split("=")[0]));
    }
  });
});
describe("classifyMidiStatus", () => {
  it("tells notes from transport from the rest", () => {
    expect(classifyMidiStatus(0x90)).toBe("note-on"); expect(classifyMidiStatus(0x8f)).toBe("note-off");
    for (const s of [0xf8, 0xfa, 0xfc, 0xf2]) expect(classifyMidiStatus(s)).toBe("transport");
    expect(classifyMidiStatus(0xb0)).toBe("other");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiOutputParams.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `parseMidiOutputParams` and `classifyMidiStatus` in `src/lib/audit/midiOutputParams.ts`**

Import `MIDI_BUS_DEFAULT` and `MIDI_AUDIT_BPMS` from `midiInputCalibration.ts`. Each refusal message names the parameter and the value (`&bpm=50: expected 60–220 or all`).

- [ ] **Step 4: Run the tests to verify they pass, then typecheck**

Run: `npx vitest run src/lib/audit/midiOutputParams.test.ts && npm run typecheck`
Expected: PASS; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiOutputParams.ts src/lib/audit/midiOutputParams.test.ts
git commit -m "midi output audit: parameters and MIDI status classification"
```

---

### Task 2: Pattern and jank schedule

**Files:**
- Create: `src/lib/audit/midiOutputPattern.ts`
- Test: `src/lib/audit/midiOutputPattern.test.ts`

**Interfaces:**
- Consumes: `pitchForIndex`, `velocityForIndex`, `type PatternNote` from `midiInputPattern.ts`; `BAR_PPQN` from `auditExpectations.ts`; `BEAT_PPQN`, `EIGHTH_BARS`, `THIRTYSECOND_BARS` from `midiInputCalibration.ts`; `Density` from Task 1.
- Produces:
  ```ts
  export interface OutputPatternNote extends PatternNote {}   // wrapAdjacent always false, tag "eighth" | "thirtysecond"
  export function buildOutputPattern(density: Density, bars: number, originPpqn: number): OutputPatternNote[];
  export function patternEndPpqnOf(notes: readonly OutputPatternNote[]): number; // last onPpqn + its step (2 × durationPpqn)
  export const JANK_PERIOD_MS = 500;
  export interface JankBlock { startPerfMs: number; endPerfMs: number; } // planned span; the runner overwrites with measured
  export function jankSchedule(midPerfMs: number, endPerfMs: number, jankMs: number): JankBlock[]; // starts at mid, every JANK_PERIOD_MS while start < end
  export type JankLabel = "clear" | "inside" | "first-after";
  export function jankLabelFor(renderPerfMs: number, blocks: readonly JankBlock[], stepMs: number): JankLabel; // inside: start ≤ t ≤ end; first-after: end < t ≤ end + stepMs
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("builds 96 thirty-second notes over 3 bars from the origin, held half a step, pitches cycling, no pitch held twice", () => {
  const notes = buildOutputPattern("32nd", 3, 2 * BAR_PPQN);
  expect(notes).toHaveLength(96);
  expect(notes[0]).toMatchObject({ index: 0, onPpqn: 2 * BAR_PPQN, durationPpqn: BEAT_PPQN / 16, tag: "thirtysecond", wrapAdjacent: false });
  expect(notes[95].onPpqn).toBe(2 * BAR_PPQN + 95 * (BEAT_PPQN / 8));
  expect(new Set(notes.slice(0, 48).map((n) => n.pitch)).size).toBe(48);
});
it("builds eighths, and 'both' as two bars of eighths then one bar of 1/32 regardless of bars", () => {
  expect(buildOutputPattern("8th", 2, 0)).toHaveLength(16);
  const both = buildOutputPattern("both", 8, 0);
  expect(both).toHaveLength(EIGHTH_BARS * 8 + THIRTYSECOND_BARS * 32);
  expect(patternEndPpqnOf(both)).toBe((EIGHTH_BARS + THIRTYSECOND_BARS) * BAR_PPQN);
});
it("schedules jank blocks from the midpoint every 500 ms until the end", () => {
  expect(jankSchedule(1000, 2100, 80)).toEqual([{ startPerfMs: 1000, endPerfMs: 1080 }, { startPerfMs: 1500, endPerfMs: 1580 }, { startPerfMs: 2000, endPerfMs: 2080 }]);
  expect(jankSchedule(1000, 900, 80)).toEqual([]);
});
it("labels a note by where its render time falls against the blocks", () => {
  const blocks = [{ startPerfMs: 1000, endPerfMs: 1080 }];
  expect(jankLabelFor(999, blocks, 107)).toBe("clear");
  expect(jankLabelFor(1000, blocks, 107)).toBe("inside");
  expect(jankLabelFor(1080, blocks, 107)).toBe("inside");
  expect(jankLabelFor(1150, blocks, 107)).toBe("first-after");
  expect(jankLabelFor(1188, blocks, 107)).toBe("clear");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiOutputPattern.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the four functions and the constant in `src/lib/audit/midiOutputPattern.ts`**

- [ ] **Step 4: Run the tests to verify they pass, then typecheck**

Run: `npx vitest run src/lib/audit/midiOutputPattern.test.ts && npm run typecheck`
Expected: PASS; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiOutputPattern.ts src/lib/audit/midiOutputPattern.test.ts
git commit -m "midi output audit: pattern builder and jank schedule"
```

---

### Task 3: Per-note and per-repeat figures

**Files:**
- Modify: `src/lib/audit/midiLoopback.ts:59-85` (`pairReceipts` gains an optional window)
- Create: `src/lib/audit/midiOutputTiming.ts`
- Test: `src/lib/audit/midiOutputTiming.test.ts`, `src/lib/audit/midiLoopback.test.ts` (one case added)

**Interfaces:**
- Consumes: `pairReceipts`, `type Receipt`, `type ScheduledNote` (`midiLoopback.ts`); `heardContextSecAt`, `contextSecAtPosition`, `perfMsAtHeardContextSec`, `pulsesToMs`, `type OutputStampPair`, `type RecordingAnchor` (`midiClockMap.ts`); `median`, `percentile`, `quantumMs` (`midiInputAlignment.ts`); `OutputPatternNote`, `JankBlock`, `jankLabelFor`, `JankLabel` (Task 2).
- Produces:
  ```ts
  // midiLoopback.ts
  export const RECEIPT_WINDOW_MS = 50;  // exported now
  export function pairReceipts(scheduled, receipts, windowMs: number = RECEIPT_WINDOW_MS): Array<{ onPerfMs: number | null; offPerfMs: number | null }>;

  // midiOutputTiming.ts
  export interface OutputNoteRow {
    index: number; pitch: number; tag: string;
    expectedHeardCtxSec: number; receiptPerfMs: number | null; receiptHeardCtxSec: number | null;
    errorMs: number | null;            // (receiptHeardCtxSec − expectedHeardCtxSec) × 1000, raw
    durationErrorMs: number | null;    // (off receipt − on receipt) − expected duration, ms; null without both
    velocityMatch: boolean | null;     // |sent − received| ≤ 1 (the engine rounds a 0..1 float back to a byte)
    jankLabel: JankLabel;
  }
  export interface OutputRepeatFigures {
    medianErrorMs: number | null; maxAbsDevMs: number | null; p5p95WidthMs: number | null; lateTailMs: number | null; // p95 − median
    missing: number; extra: number; stuck: number; velocityMismatches: number; transportMessages: number;
    notesInsideBlocks: number; medianErrorInsideBlocksMs: number | null;
  }
  export interface MeasureInput {
    pattern: readonly OutputPatternNote[]; receipts: readonly Receipt[]; transportMessages: number;
    anchor: RecordingAnchor; pair: OutputStampPair; bpm: number;
    delayInMs: number; jankMs: number; blocks: readonly JankBlock[]; outputLatencyMs: number; sampleRate: number;
  }
  export function expectedSchedule(pattern, anchor, pair, bpm): ScheduledNote[]; // onPerfMs/offPerfMs at the HEARD times (what the page arm sends)
  export function receiptWindowMs(delayInMs: number, jankMs: number, sampleRate: number): number; // RECEIPT_WINDOW_MS + delayInMs + jankMs + quantumMs(sampleRate)
  export function measureOutputRepeat(input: MeasureInput): { notes: OutputNoteRow[]; figures: OutputRepeatFigures };
  export function anchorTooLate(anchor: RecordingAnchor, originPpqn: number, bpm: number, nowCtxSec: number, leadMs?: number /* 300 */): boolean; // now + lead is past the origin's heard context time
  ```
  Render time for the jank label: `perfMsAtHeardContextSec(pair, expectedHeardCtxSec) − outputLatencyMs`. Step for `first-after`: the note's 2 × durationPpqn in ms.

- [ ] **Step 1: Write the failing tests**

Fixtures: `anchor = { contextTime: 10, position: 0 }`, `pair = { contextTime: 10.02, performanceTime: 5000 }`, bpm 140, a 1/32 pattern at origin 0 of one bar (32 notes); a helper `receiptsAt(notes, offsetMs)` that makes on/off receipts at the heard perf times plus `offsetMs`, velocity as sent.

```ts
it("reads a receipt exactly at the heard time as 0.00 ms, and one 12 ms later as +12.00", () => {
  const exact = measureOutputRepeat({ ...base, receipts: receiptsAt(pattern, 0) });
  expect(exact.figures.medianErrorMs).toBeCloseTo(0, 6); expect(exact.figures.maxAbsDevMs).toBeCloseTo(0, 6);
  expect(exact.figures.missing).toBe(0); expect(exact.figures.extra).toBe(0);
  const late = measureOutputRepeat({ ...base, receipts: receiptsAt(pattern, 12) });
  expect(late.figures.medianErrorMs).toBeCloseTo(12, 6); expect(late.notes[0].errorMs).toBeCloseTo(12, 6);
});
it("pairs a note late by a 500 ms delay, because the window includes the delay", () => {
  const r = measureOutputRepeat({ ...base, delayInMs: 500, receipts: receiptsAt(pattern, 500) });
  expect(r.figures.missing).toBe(0); expect(r.figures.medianErrorMs).toBeCloseTo(500, 6);
  expect(receiptWindowMs(500, 80, 48000)).toBeCloseTo(50 + 500 + 80 + quantumMs(48000), 6);
});
it("counts a receipt of a pitch outside the pattern as extra, pairs nothing to it, and does not throw", () => {
  const stray: Receipt = { kind: "off", pitch: 120, velocity: 0, timeStamp: 5100 };
  const r = measureOutputRepeat({ ...base, receipts: [...receiptsAt(pattern, 0), stray] });
  expect(r.figures.extra).toBe(1); expect(r.figures.missing).toBe(0);
});
it("reports a note without its off as stuck, and a sent velocity one byte off as matching", () => { /* drop one off receipt; velocity 101 for 100 */ });
it("labels notes inside a block, takes their median apart, and gives null when no note is inside", () => {
  // blocks covering notes 10..11 (render time = heard perf − outputLatencyMs), those two receipts late by 80
  expect(r.figures.notesInsideBlocks).toBe(2); expect(r.figures.medianErrorInsideBlocksMs).toBeCloseTo(80, 6);
  expect(measureOutputRepeat({ ...base, blocks: [] }).figures.medianErrorInsideBlocksMs).toBeNull();
});
it("passes the transport count through and reads a late tail as p95 minus median", () => { /* transportMessages: 56 → figures.transportMessages 56; three notes late by 40 → lateTailMs > 0 */ });
it("says the anchor is too late when the origin is under 300 ms ahead of now", () => {
  // origin bar 2 = one bar in = 1.714 s at 140 bpm; the anchor's context time is 10
  expect(anchorTooLate(anchor, BAR_PPQN, 140, 10 + 1.714 - 0.5)).toBe(false);
  expect(anchorTooLate(anchor, BAR_PPQN, 140, 10 + 1.714 - 0.2)).toBe(true);
});
// midiLoopback.test.ts
it("pairReceipts takes a window: a receipt 300 ms late pairs at 400 and not at the default 50", () => { … });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiOutputTiming.test.ts src/lib/audit/midiLoopback.test.ts`
Expected: FAIL, module not found / `pairReceipts` ignores the third argument.

- [ ] **Step 3: Add the `windowMs` parameter to `pairReceipts` (default `RECEIPT_WINDOW_MS`, now exported) and implement `midiOutputTiming.ts`**

`measureOutputRepeat` builds the expected schedule, pairs with `receiptWindowMs(...)`, maps each receipt stamp back with `heardContextSecAt`, and counts `extra` as receipts left unused by the pairing (on and off alike).

- [ ] **Step 4: Run the whole audit test folder and typecheck**

Run: `npx vitest run src/lib/audit && npm run typecheck`
Expected: PASS (the input harness tests still pass with the default window); tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiLoopback.ts src/lib/audit/midiLoopback.test.ts src/lib/audit/midiOutputTiming.ts src/lib/audit/midiOutputTiming.test.ts
git commit -m "midi output audit: per-note and per-repeat figures on the heard clock"
```

---

### Task 4: Verdicts

**Files:**
- Create: `src/lib/audit/midiOutputVerdict.ts`
- Test: `src/lib/audit/midiOutputVerdict.test.ts`

**Interfaces:**
- Consumes: `OutputRepeatFigures` (Task 3); `quantumMs` (`midiInputAlignment.ts`).
- Produces:
  ```ts
  export type OutputCellStatus = "bus-true" | "on-time" | "matches-known-defect" | "investigate" | "not-judged";
  export interface OutputVerdict { status: OutputCellStatus; detail: string; } // not-judged details: "bus", "no-control"
  export const PAGE_ARM_MAX_ABS_MS = 1;
  export interface OutputBandContext { delayInMs: number; jankMs: number; jankActive: boolean; sampleRate: number; }
  export interface OutputKnownDefectBand { id: string; applies(ctx: OutputBandContext): boolean; matches(f: OutputRepeatFigures, ctx: OutputBandContext): boolean; detail: string; }
  export const MIDI_OUT_KNOWN_DEFECTS: readonly OutputKnownDefectBand[] = []; // pinned by the first run (Task 9)
  export function isClean(f: OutputRepeatFigures): boolean; // missing, extra, stuck, velocityMismatches all 0
  export function classifyPageCell(repeats: readonly OutputRepeatFigures[]): OutputVerdict;
  export function classifyEngineCell(repeats: readonly OutputRepeatFigures[], control: OutputVerdict | null, ctx: OutputBandContext, bands?: readonly OutputKnownDefectBand[]): OutputVerdict;
  ```
  Rules (spec): page `bus-true` when every repeat is clean, `|medianErrorMs| ≤ 1` and `maxAbsDevMs ≤ 1`; engine `not-judged` (`no-control`) when `control` is null, `not-judged` (`bus`) when the control is not `bus-true`; `on-time` when every repeat is clean, `|medianErrorMs − delayInMs| ≤ ½ quantum` and `maxAbsDevMs ≤ 1 quantum`; else the first band whose `applies` and `matches` hold on every repeat → `matches-known-defect` with its id; else `investigate` naming the first failing figure and repeat.

- [ ] **Step 1: Write the failing tests**

```ts
const clean = (median: number, maxDev: number): OutputRepeatFigures => ({ medianErrorMs: median, maxAbsDevMs: maxDev, p5p95WidthMs: maxDev, lateTailMs: maxDev, missing: 0, extra: 0, stuck: 0, velocityMismatches: 0, transportMessages: 0, notesInsideBlocks: 0, medianErrorInsideBlocksMs: null });
const ctx = { delayInMs: 10, jankMs: 80, jankActive: false, sampleRate: 48000 };
const bus: OutputVerdict = { status: "bus-true", detail: "" };
it("reads a page arm at 0 ± 1 ms as bus-true, and one 2 ms off or unclean as investigate naming the figure", () => {
  expect(classifyPageCell([clean(0.1, 0.4)]).status).toBe("bus-true");
  expect(classifyPageCell([clean(0.1, 2)])).toMatchObject({ status: "investigate", detail: expect.stringMatching(/maxAbsDevMs 2/) });
  expect(classifyPageCell([{ ...clean(0, 0), missing: 1 }]).detail).toMatch(/missing 1/);
});
it("reads an engine arm at the delay within half a quantum and a quantum of spread as on-time", () => {
  expect(classifyEngineCell([clean(10.8, 2.0)], bus, ctx).status).toBe("on-time");   // 48 kHz quantum 2.67 ms
  expect(classifyEngineCell([clean(14, 2.0)], bus, ctx).status).toBe("investigate");  // 4 ms off the delay
  expect(classifyEngineCell([clean(10, 3.0)], bus, ctx).status).toBe("investigate");  // spread over a quantum
});
it("does not judge an engine arm without a true control", () => {
  expect(classifyEngineCell([clean(10, 0)], null, ctx)).toEqual({ status: "not-judged", detail: "no-control" });
  expect(classifyEngineCell([clean(10, 0)], { status: "investigate", detail: "x" }, ctx)).toEqual({ status: "not-judged", detail: "bus" });
});
it("names a band that applies and matches every repeat, and ignores one that does not apply", () => {
  const band = { id: "test-band", applies: (c) => c.jankActive, matches: (f) => f.medianErrorMs !== null && f.medianErrorMs > 20, detail: "late" };
  expect(classifyEngineCell([clean(40, 30)], bus, { ...ctx, jankActive: true }, [band])).toMatchObject({ status: "matches-known-defect", detail: expect.stringMatching(/test-band/) });
  expect(classifyEngineCell([clean(40, 30)], bus, ctx, [band]).status).toBe("investigate");
});
it("ships with no bands", () => { expect(MIDI_OUT_KNOWN_DEFECTS).toEqual([]); });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiOutputVerdict.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/audit/midiOutputVerdict.ts`**

- [ ] **Step 4: Run the tests to verify they pass, then typecheck**

Run: `npx vitest run src/lib/audit/midiOutputVerdict.test.ts && npm run typecheck`
Expected: PASS; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiOutputVerdict.ts src/lib/audit/midiOutputVerdict.test.ts
git commit -m "midi output audit: cell verdicts with an empty band table"
```

---

### Task 5: Envelope schema and the table script

**Files:**
- Create: `src/lib/audit/midiOutputArtifacts.ts`, `scripts/audit/midi-output-timing/table.ts`
- Test: `src/lib/audit/midiOutputArtifacts.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 types; `JankBlock` (Task 2); `RecordingAnchor` (`midiClockMap.ts`).
- Produces:
  ```ts
  export const MIDI_OUTPUT_SCHEMA_VERSION = 1;
  export interface OutputCellKey { arm: OutputArm; bpm: number; density: Density; jank: JankMode; transport: boolean; }
  export interface OutputRepeatRow extends OutputRepeatFigures {
    repeat: number; error: string | null;            // an error row carries NaN-free nulls and the stage in `error`
    notes: OutputNoteRow[]; anchor: RecordingAnchor | null; originPpqn: number;
    heardLagMs: number | null; outputLatencyMs: number | null; compensationLatencyMs: number | null; delayInMs: number;
    quantumMs: number; frameIntervalMs: number | null; frameGapMaxMs: number | null;
    jankBlocks: JankBlock[]; jankMs: number | null;
  }
  export interface OutputCellRecord extends OutputCellKey { status: OutputCellStatus; detail: string; repeats: OutputRepeatRow[]; }
  export interface MidiOutputSummary {
    schemaVersion: typeof MIDI_OUTPUT_SCHEMA_VERSION; runToken: number; sdkVersion: string; chrome: string; date: string;
    sampleRate: number; params: MidiOutputParams; cells: OutputCellRecord[];
  }
  export function summaryFileName(runToken: number): string;          // `midiout-summary-${runToken}.json`
  export function parseMidiOutputSummary(json: unknown, runToken: number): MidiOutputSummary; // throws on another schemaVersion or a token mismatch
  export function cellTableLines(summary: MidiOutputSummary): string[]; // one line per cell: key, status, median per repeat, maxAbsDev, lateTail, inside-blocks median, counts, delay, transport count
  ```
  The script mirrors `scripts/audit/midi-input-alignment/table.ts`: newest `midiout-summary-*.json` in `.verify-output/` unless a token is given; prints `cellTableLines` then the run line (chrome, sdkVersion, date, sampleRate, params).

- [ ] **Step 1: Write the failing tests**

```ts
it("names the file and parses its own schema, refusing another version or token", () => {
  expect(summaryFileName(42)).toBe("midiout-summary-42.json");
  expect(parseMidiOutputSummary(summary, 42)).toEqual(summary);
  expect(() => parseMidiOutputSummary({ ...summary, schemaVersion: 2 }, 42)).toThrow(/schemaVersion/);
  expect(() => parseMidiOutputSummary(summary, 43)).toThrow(/runToken/);
});
it("prints one line per cell with the status, the medians per repeat and the counts", () => {
  // `summary` is a two-cell fixture built in the test: an engine cell (140, 32nd, none, transport on, on-time, medians 10.8 / 11.1) and its page cell
  const lines = cellTableLines(summary);
  expect(lines).toHaveLength(summary.cells.length);
  expect(lines[0]).toMatch(/engine.*140.*32nd.*none.*on.*on-time.*10\.80 \/ 11\.10/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiOutputArtifacts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `midiOutputArtifacts.ts` and `scripts/audit/midi-output-timing/table.ts`**

The script imports with an explicit `.ts` extension (`node scripts/<name>.ts` type stripping, repo rule).

- [ ] **Step 4: Run the tests, typecheck, and the script against no summary**

Run: `npx vitest run src/lib/audit/midiOutputArtifacts.test.ts && npm run typecheck && node scripts/audit/midi-output-timing/table.ts; echo "exit $?"`
Expected: PASS; tsc exit 0; the script prints `no midiout summary in …` and exits 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiOutputArtifacts.ts src/lib/audit/midiOutputArtifacts.test.ts scripts/audit/midi-output-timing/table.ts
git commit -m "midi output audit: envelope schema and table script"
```

---

### Task 6: Project state and receipts (browser)

**Files:**
- Create: `src/lib/audit/midiOutputProject.ts`
- Modify: `src/lib/audit/midiLoopback.ts:94-131` (`MidiLoopbackSender` counts transport messages)
- Test: `src/lib/audit/midiLoopback.test.ts` (one pure case: the receipt-classifying helper)

**Interfaces:**
- Consumes: `InstrumentFactories.MIDIOutput` (`@opendaw/studio-adapters`); `MIDIOutputBox` (`@opendaw/studio-boxes`); `project.api.createNoteRegion` / `createNoteEvent`; `classifyMidiStatus` (Task 1); `OutputPatternNote` (Task 2).
- Produces:
  ```ts
  // midiLoopback.ts — MidiLoopbackSender
  transportCount(): number;        // 0xF8 / 0xFA / 0xFC / 0xF2 receipts since the last clear(); clear() resets it
  export function receiptFrom(data: Uint8Array, timeStamp: number): Receipt | "transport" | null; // pure: used by onmidimessage; a note-on with velocity 0 is an "off"

  // midiOutputProject.ts
  export interface OutputProjectState { audioUnitBox: AudioUnitBox; trackBox: TrackBox; midiOutputBox: MIDIOutputBox; regionBox: NoteRegionBox | null; }
  export function buildOutputProject(project: Project, port: { id: string; name: string | null }, delayInMs: number, sendTransport: boolean): OutputProjectState;
  // one transaction: createInstrument(MIDIOutput); MIDIOutputBox.create under rootBox.outputMidiDevices with id/label/delayInMs/sendTransportMessages;
  // instrumentBox.device.refer(midiOutputBox.device). A SECOND transaction is not needed here (no capture fields are read).
  export function writeOutputPattern(project: Project, state: OutputProjectState, pattern: readonly OutputPatternNote[], originPpqn: number): void;
  // deletes the previous region (box.delete()), creates one at originPpqn with duration = patternEnd − origin (loopDuration defaults to it),
  // then in an editing.append() creates the events region-local (position − origin, duration = durationPpqn, velocity = byte / 127, cent 0, chance 100)
  export function setOutputArm(project: Project, state: OutputProjectState, arm: OutputArm, portId: string, delayInMs: number, sendTransport: boolean): void;
  // page arm: midiOutputBox.id = "" (the engine interns "" to −1 and queues nothing); engine arm: id = portId; delay and transport rewritten each time
  export function resetOutputTransport(project: Project): Promise<string | null>; // stopRecording if recording, wait not-recording (10 s), engine.stop(true), setPosition(0); returns a warning or null (as resetForNextMidiCell)
  ```

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
it("turns raw bytes into a receipt, a transport mark, or nothing", () => {
  expect(receiptFrom(new Uint8Array([0x90, 60, 100]), 5)).toEqual({ kind: "on", pitch: 60, velocity: 100, timeStamp: 5 });
  expect(receiptFrom(new Uint8Array([0x90, 60, 0]), 5)).toEqual({ kind: "off", pitch: 60, velocity: 0, timeStamp: 5 });
  expect(receiptFrom(new Uint8Array([0x80, 60, 64]), 5)).toEqual({ kind: "off", pitch: 60, velocity: 0, timeStamp: 5 });
  expect(receiptFrom(new Uint8Array([0xf8]), 5)).toBe("transport");
  expect(receiptFrom(new Uint8Array([0xb0, 123, 0]), 5)).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/audit/midiLoopback.test.ts`
Expected: FAIL, `receiptFrom` not exported.

- [ ] **Step 3: Implement `receiptFrom`, route `onmidimessage` through it, add `transportCount()`; write `midiOutputProject.ts`**

The region must have `loopDuration` set (it is, through `createNoteRegion`); the events go in an `editing.append()` after the region's transaction (CLAUDE.md: a box created in a transaction is not in the adapter's collection until it commits). `writeOutputPattern` asserts the region's event collection holds `pattern.length` events afterwards and throws naming the count if not.

- [ ] **Step 4: Run the audit tests and typecheck**

Run: `npx vitest run src/lib/audit && npm run typecheck`
Expected: PASS; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiLoopback.ts src/lib/audit/midiLoopback.test.ts src/lib/audit/midiOutputProject.ts
git commit -m "midi output audit: project state, arm switch, transport-message counting"
```

---

### Task 7: The repeat runner (browser)

**Files:**
- Create: `src/lib/audit/midiOutputCellRunner.ts`

**Interfaces:**
- Consumes: `waitForRecordingStart`, `jankBetweenFrames`, `FrameWatch`, `waitUntilPerf` (`midiInputCellRunner.ts`); `RepeatToken`, `assertCurrent` (`recordingCellRunner.ts`); `MidiLoopbackSender` (`midiLoopback.ts`); `midiClockMap.ts`; Tasks 2, 3, 5, 6.
- Produces:
  ```ts
  export interface OutputRepeatOptions {
    project: Project; audioContext: AudioContext; loopback: MidiLoopbackSender; state: OutputProjectState; portId: string;
    key: OutputCellKey; params: MidiOutputParams; repeat: number; token: RepeatToken; frameWatch: FrameWatch;
    onStage: (stage: string) => void;
  }
  export async function runOutputRepeat(options: OutputRepeatOptions): Promise<OutputRepeatRow>;
  ```
  Stages, in order (each reported through `onStage`, each `assertCurrent`-guarded): `reset` (`resetOutputTransport`, `loopback.clear()`), `arm` (`setOutputArm`, `writeOutputPattern` with origin = `originBar − 1` bars, pattern from `buildOutputPattern`), `armed-check` (throw if `project.captureDevices.filterArmed().length > 0`: nothing may be armed), `record` (`recordRequestContextTime = audioContext.currentTime`; `project.startRecording(false)`), `anchor` (`waitForRecordingStart(project, recordRequestContextTime, 30_000)`), `pair` (one `getOutputTimestamp()`; throw when unusable; `heardLagMs`, `outputLatencyMs`, `compensationLatencyMs = project.engine.compensationLatency.getValue() * 1000`), `origin-check` (`anchorTooLate(anchor, originPpqn, bpm, audioContext.currentTime)` → throw `anchor-too-late`), `schedule` (page arm only: `loopback.schedule(expectedSchedule(...))`), `jank` (when `key.jank === "mid"`: `jankSchedule(midPerfMs, endPerfMs, jankMs)` with mid/end from `perfMsAtHeardContextSec` of the pattern's midpoint and end; each block run through `jankBetweenFrames`, its measured span recorded), `play` (`waitUntilPerf(endPerfMs + one bar, …)`), `stop` (`project.stopRecording()`, wait not recording, `engine.stop(true)`), `measure` (`measureOutputRepeat` with `loopback.receipts()` and `loopback.transportCount()`). A throw at any stage yields a row with `error: "<stage>: <message>"`, nulls for the figures, and whatever blocks and frame summary exist.

- [ ] **Step 1: Implement `runOutputRepeat` in `src/lib/audit/midiOutputCellRunner.ts`**

No unit test (browser half, repo convention). The frame watch is started at `record` and stopped at `measure`; `frameIntervalMs` / `frameGapMaxMs` come from its summary.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit/midiOutputCellRunner.ts
git commit -m "midi output audit: the repeat runner"
```

---

### Task 8: The page, the entry, the docs section

**Files:**
- Create: `midi-output-timing-audit-debug-demo.html` (copy `midi-input-alignment-audit-debug-demo.html`, retitle, point at the new tsx), `src/demos/midi/midi-output-timing-audit-debug-demo.tsx`
- Modify: `vite.config.ts:197` (add `midiOutputTimingAudit` next to the input entry), `src/demos/midi/CLAUDE.md` (a "MIDI Output Timing Audit (unlisted)" section after the combined audit's, lines ~301–339)

**Interfaces:**
- Consumes: Tasks 1–7; `initializeOpenDAW({ bpm })` (`@/lib/projectSetup`); `MidiDevices.requestPermission / inputDevices / outputDevices / findInputDeviceById / findOutputDeviceById`; `pickIacPorts`; `runRepeatWithDeadline`; `withDeadline`; `OPENDAW_SDK_VERSION`; `DebugLinkBar`.
- Produces: the page. DOM contract: `#audit-state[data-audit-state]` = `setup` → `running:<cellLabel>` → `done` | `error:<message>`; a `Run` button (real click); a rows table with one row per repeat (arm, bpm, density, jank, transport, median, maxAbsDev, lateTail, inside-blocks median, counts, heardLag, frame interval, status badge); `#verdict`-less, the per-cell status is in the table as on the input page. DebugLinkBar: the note (`debug/2026-10-23-midi-output-timing/note.md`), openDAW#356, the capture plan commit URL from the spec, the input alignment page.

- [ ] **Step 1: Write the page**

Setup once per load: `initializeOpenDAW({ bpm: params.bpms[0] })`, MIDI permission, `pickIacPorts`, `buildOutputProject` with the IAC output port. The matrix: for each (bpm, density, jank, transport) tuple, for each repeat: the `page` repeat then the `engine` repeat (only the arms in `params.arms`), each through `runRepeatWithDeadline(…, 60_000, label)`. The tempo is written per tuple (`project.editing.modify(() => project.timelineBox.bpm.setValue(bpm))`). After the matrix: `classifyPageCell` per tuple, `classifyEngineCell` with that tuple's page verdict (null when the page arm did not run), the summary assembled and PUT to `/__verify/${summaryFileName(runToken)}` (30 s deadline), `data-audit-state` → `done`. Parameter refusals from `parseMidiOutputParams` show as `error:<message>` before setup.

- [ ] **Step 2: Add the Vite entry and the CLAUDE.md section**

The section states: the URL and every parameter, the clock rule (one pair per repeat, nothing netted), what the figure IS (the time the SDK asked for) and is not (delivery), the no-capture recording anchor, the origin rule and `anchor-too-late`, the empty-id arm switch, the verdict words, the table script, and the note's path.

- [ ] **Step 3: Typecheck, build, and a smoke run in Chrome**

Run: `npm run typecheck && npm run build 2>&1 | tail -3`
Expected: exit 0; the new page in `dist/`.
Then, on the dev server in the user's Chrome (claude-in-chrome; a real click on Run; the IAC Driver online): `https://localhost:5173/midi-output-timing-audit-debug-demo.html?repeats=1` → `data-audit-state` reaches `done`, the page cell reads `bus-true`, the engine cell reads a status with figures, the summary is saved under `.verify-output/`. If the page cell is not `bus-true`, stop and fix the harness before anything is read from the engine arm.

- [ ] **Step 4: Commit**

```bash
git add midi-output-timing-audit-debug-demo.html src/demos/midi/midi-output-timing-audit-debug-demo.tsx vite.config.ts src/demos/midi/CLAUDE.md
git commit -m "midi output audit: the page, build entry and docs"
```

---

### Task 9: Prediction, first measurement, bands, write-up, PR

**Files:**
- Create: `debug/2026-10-23-midi-output-timing/note.md`, `debug/2026-10-23-midi-output-timing/drafts/TO-REVIEW-opendaw-356-comment.md`
- Modify: `debug/README.md` (index row, newest first; the draft under "Waiting for a read"), `CLAUDE.md` (Build & Verification: one "after SDK upgrades, also run …" bullet), `src/lib/audit/midiOutputVerdict.ts` + test (bands from the run, if any), `src/demos/midi/CLAUDE.md` (the verdict words once bands exist)
- Delete: `docs/superpowers/specs/2026-10-23-midi-output-timing-design.md`, `docs/superpowers/plans/2026-10-23-midi-output-timing-audit.md` (repo rule: in-flight docs go in the PR that completes the work)

- [ ] **Step 1: Write the note's "What a cell measures" and "Prediction" sections and commit them BEFORE the run**

Copy the spec's prediction verbatim, dated. Commit: `git commit -m "midi output audit: note with the prediction, before the first run"`.

- [ ] **Step 2: Run the first measurement in the user's Chrome**

Runs, each a fresh navigation, a real click on Run, window visible, room irrelevant (no audio):
```
?bpm=140&density=32nd&transport=both&repeats=2
?bpm=140&density=32nd&transport=both&jank=mid&repeats=2
?bpm=all&density=both&repeats=2
```
After each: `node scripts/audit/midi-output-timing/table.ts` and paste the table into the note. Any `anchor-too-late` or a page arm not `bus-true` is a harness finding to fix first (Task 8 is reopened), not a row to interpret.

- [ ] **Step 3: Derive the bands, if the rows warrant one**

A band is written only from a repeated, explained shape (e.g. `midi-out-main-thread-base`: median in `[delayInMs, delayInMs + 2 quanta]`, `lateTailMs` under a frame interval without jank; with jank, `medianErrorInsideBlocksMs` in `[delayInMs + jankMs − 1 quantum, delayInMs + jankMs + 1 quantum]`), computed from `OutputBandContext`, never a fitted constant. Add it to `MIDI_OUT_KNOWN_DEFECTS` with a test that the measured rows (as fixtures with the run token named) match it and that a clean row does not; re-run the table and record which rows pinned it in the note.

Run: `npx vitest run src/lib/audit && npm run typecheck`
Expected: PASS; exit 0.

- [ ] **Step 4: Finish the note, the draft comment, the indexes**

Note sections: findings with status (confirmed / not reproduced / harness), the band derivation, "what it does not say" (delivery time, the start burst), "what remains". The draft comment for openDAW#356: the measured signature (median, tail, the jank rows), the mechanism in one paragraph (ring read on the main thread, `performance.now()` base), the page URL, the note link; no suggested-fix section. `debug/README.md`: the index row and the draft under "Waiting for a read". Root `CLAUDE.md`: the standing-sweep bullet with the three URLs above and the reading rule (page arm first). Delete the spec and this plan.

- [ ] **Step 5: Verify, commit, push, PR, review**

Run: `npx vitest run && npm run typecheck`
Expected: all pass; exit 0.

```bash
git add -A
git commit -m "midi output audit: first measurement, bands, note and draft for openDAW#356"
git push -u origin midi-output-timing-audit
gh pr create --title "MIDI output timing audit: where the SDK asks a hardware output to deliver each note (openDAW#356 harness)" --body-file <body>
```
Then `/pr-review-toolkit:review-pr`, fix Critical + Important, push, note the fixes in a PR comment. The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Merge is the user's call (squash).
