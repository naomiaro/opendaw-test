# Hidden-Page Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure what the recorder does when the page is hidden or its main thread blocked at the start, the middle and the stop of a take, and make the demos keep their engine sync alive while hidden through a frame driver that ticks from a worker when the document is not visible.

**Architecture:** A pure frame scheduler (`src/lib/frameScheduler.ts`, Node-tested) decides whether a frame request goes to the real animation frame or to a worker tick, gated on visibility and transport activity; a thin driver binds it to `window`, `document` and a blob worker and is what `initializeOpenDAW` hands to `AnimationFrame.start`. A standalone unlisted page records a Tape through the recording harness's synthetic loopback, interrupts itself at the chosen moment (a prompt for the cover, its own `alert()` for the modal), and judges each take with pure verdict functions. Registers and drafts follow the measurement.

**Tech Stack:** TypeScript (strict), React + Radix (page only), Vitest in Node (fake clock and schedulers), openDAW SDK through the harness's existing readers, Web Workers from blob URLs, the dev server's `/__verify` sink.

**Spec:** `docs/superpowers/specs/2026-10-21-hidden-page-recording-design.md`

## Global Constraints

- Branch `audit/hidden-page-recording` (exists, holds the spec); squash-merged PR; the spec and this plan are deleted in the PR's last commit.
- Repo rules: `editing.modify()` for box changes; Option API (`isEmpty()` / `unwrap()`, never `?.` on an Option); strict TS; no version qualifiers outside `changelogs/` and `debug/`; nothing names the fork; no session URLs; browser transport started with a real click; no edits under `src/` or `public/` while a run is in progress; drafts stay `TO-REVIEW-*`, nothing posted.
- The driver must not change a visible page's behaviour: while visible every request forwards to the real animation frame, and the check is the two standing-sweep cells in Task 7 reading their registers.
- Figures fixed by the spec: `HIDDEN_TICK_MS` 20, `HIDDEN_GRACE_MS` 2000, `DURATION_TOLERANCE_MS` 50, finalization deadline 30 s (`FINALIZE_DEADLINE_MS` from `recordingCellRunner.ts`), eight bars at 120 bpm, hide at bar 1 for `mid`, default `hiddenSeconds` 5, summary name `hiddenrec-summary-<runToken>.json`.
- Verdict strings: `intact`, `not-finalized`, `audio-damaged`, `session-stuck`, `not-hidden`. `main-thread-blocked` is a figure, never a verdict.
- `npm run typecheck`, `npx vitest run`, `npm run build` clean before the PR; the comprehensive PR review runs once the PR is open and Critical/Important findings are fixed before merge.
- SDK facts relied on: `AnimationFrame.start(owner)` (`@opendaw/lib-dom` `frames.ts`) keeps `owner`, calls `owner.requestAnimationFrame(exe)` from inside `exe` once per frame, and `exe` returns early when the timestamp is within 16 ms of the last accepted one; `AnimationFrame.start` is called once, in `src/lib/projectSetup.ts`; `RecordAudio` resolves the take's file inside its `engine.position` subscription; `project.engine.isPlaying` / `isRecording` / `isCountingIn` are observables with `getValue()`.

## Review Focus

1. A page that becomes visible again while a worker tick is still in flight: the parked callback must fire once, never twice, and the next request must go to the real frame. Test in Task 1 ("the reverse move").
2. The transport going idle while hidden with a request parked: ticks keep firing for the grace period and then the request stays parked until activity resumes or the page is visible. Test in Task 1 ("grace", "idle parks, activity resumes").
3. `cancelAnimationFrame` with an id from before a visibility switch: the moved request must be the one cancelled. Test in Task 1 ("cancel across the move").
4. A `cover` run where the page never became hidden (a partial cover): the row must read `not-hidden` and judge nothing about hiding; the take's own figures still print. Test in Task 3 (`classifyRow`).
5. A `modal` run on a `start` hide: the page's own `startRecording` request and the `alert()` are in one task, so no frame can run between them; if the recorder created the take anyway, the row must still report the frame gap as the dialog's span. Test in Task 3 (`frameBlockedMs` from a watch with one gap equal to the dialog).

---

### Task 1: Worker ticker and the frame scheduler core

**Files:**
- Create: `src/lib/workerTicker.ts`, `src/lib/frameScheduler.ts`
- Test: `src/lib/frameScheduler.test.ts`

**Interfaces:**
- Produces:
  - `createWorkerTicker(intervalMs: number): WorkerTicker` with `interface WorkerTicker { subscribe(fn: () => void): { terminate(): void }; terminate(): void }` — a dedicated worker from a blob URL (`setInterval(() => postMessage(0), intervalMs)`), created on first `subscribe`, each message calling every subscriber on the main thread. Not Node-tested (needs `Worker`); the scheduler receives its tick through an injected function.
  - `interface FrameSchedulerDeps { isHidden(): boolean; isActive(): boolean; now(): number; requestFrame(cb: (t: number) => void): number; cancelFrame(id: number): void; requestTick(cb: (t: number) => void): number; cancelTick(id: number): void; graceMs: number }`.
  - `interface FrameScheduler { requestAnimationFrame(cb: (t: number) => void): number; cancelAnimationFrame(id: number): void; visibilityChanged(): void; activityChanged(): void; transportRequested(): void }`.
  - `createFrameScheduler(deps: FrameSchedulerDeps): FrameScheduler`. Rules: visible → `requestFrame`; hidden and active → `requestTick`, where active means `isActive()` reads true, or `graceMs` has not passed since it last read true, or since the last `transportRequested()`; hidden and idle → parked (no underlying request); `visibilityChanged()` moves a pending request to the other path without firing it; `activityChanged()` and `transportRequested()` move a parked request to the tick; ids are the scheduler's own counter, mapped to the underlying id so `cancelAnimationFrame` works across a move; a fired callback receives `deps.now()`. The request gate exists because the engine's own flags reach the page through the sync these ticks pump: a page hidden and idle when a transport request arrives (a MIDI controller's Record button, a timer) would otherwise never see the flag flip and never tick.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { createFrameScheduler, type FrameSchedulerDeps } from "./frameScheduler";

function harness(opts: { hidden?: boolean; active?: boolean; graceMs?: number } = {}) {
  let hidden = opts.hidden ?? false;
  let active = opts.active ?? true;
  let now = 0;
  const frames = new Map<number, (t: number) => void>();
  const ticks = new Map<number, (t: number) => void>();
  let nextId = 100;
  const deps: FrameSchedulerDeps = {
    isHidden: () => hidden, isActive: () => active, now: () => now, graceMs: opts.graceMs ?? 2000,
    requestFrame: (cb) => { const id = nextId++; frames.set(id, cb); return id; },
    cancelFrame: (id) => { frames.delete(id); },
    requestTick: (cb) => { const id = nextId++; ticks.set(id, cb); return id; },
    cancelTick: (id) => { ticks.delete(id); },
  };
  const s = createFrameScheduler(deps);
  const fireFrames = () => { const cbs = [...frames.values()]; frames.clear(); cbs.forEach((cb) => cb(now)); };
  const fireTicks = () => { const cbs = [...ticks.values()]; ticks.clear(); cbs.forEach((cb) => cb(now)); };
  return { s, frames, ticks, fireFrames, fireTicks, setHidden: (h: boolean) => { hidden = h; s.visibilityChanged(); }, setActive: (a: boolean) => { active = a; s.activityChanged(); }, advance: (ms: number) => { now += ms; } };
}

describe("createFrameScheduler", () => {
  it("sends a visible request to the real frame and a hidden active one to the tick", () => {
    const v = harness(); let fired = 0;
    v.s.requestAnimationFrame(() => fired++);
    expect(v.frames.size).toBe(1); expect(v.ticks.size).toBe(0);
    v.fireFrames(); expect(fired).toBe(1);
    const h = harness({ hidden: true });
    h.s.requestAnimationFrame(() => fired++);
    expect(h.ticks.size).toBe(1); expect(h.frames.size).toBe(0);
  });
  it("moves a pending request to the tick when the page hides, and back on the reverse move, firing once", () => {
    const v = harness(); let fired = 0;
    v.s.requestAnimationFrame(() => fired++);
    v.setHidden(true);
    expect(v.frames.size).toBe(0); expect(v.ticks.size).toBe(1);
    v.setHidden(false);
    expect(v.ticks.size).toBe(0); expect(v.frames.size).toBe(1);
    v.fireFrames(); v.fireTicks();
    expect(fired).toBe(1);
  });
  it("cancels across the move by the scheduler's own id", () => {
    const v = harness();
    const id = v.s.requestAnimationFrame(() => { throw new Error("must not fire"); });
    v.setHidden(true);
    v.s.cancelAnimationFrame(id);
    expect(v.ticks.size).toBe(0); expect(v.frames.size).toBe(0);
  });
  it("parks a hidden idle request, keeps ticking through the grace period, and resumes on activity", () => {
    const h = harness({ hidden: true, active: true, graceMs: 2000 });
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(1);
    h.setActive(false);
    h.advance(500); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(1);            // still inside the grace period
    h.advance(2000); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(0);            // parked: idle past the grace
    h.setActive(true);
    expect(h.ticks.size).toBe(1);            // activity resumes the parked request
  });
  it("resumes a parked request on a transport request while hidden and idle, before the engine's flag can arrive", () => {
    const h = harness({ hidden: true, active: false, graceMs: 2000 });
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(0);            // parked: hidden and idle
    h.s.transportRequested();
    expect(h.ticks.size).toBe(1);            // the request counts as activity
    h.advance(1000); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(1);            // still inside the request grace, the flag not yet observed
    h.advance(2000); h.fireTicks();
    h.s.requestAnimationFrame(() => {});
    expect(h.ticks.size).toBe(0);            // the grace passed with the engine still idle: parked again
  });
  it("gives every request a distinct id and passes the clock to the callback", () => {
    const v = harness(); let seen = -1;
    const a = v.s.requestAnimationFrame((t) => { seen = t; });
    const b = v.s.requestAnimationFrame(() => {});
    expect(a).not.toBe(b);
    v.advance(16.7); v.fireFrames();
    expect(seen).toBeCloseTo(16.7, 6);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/frameScheduler.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/frameScheduler.ts` and `src/lib/workerTicker.ts`**

The scheduler keeps at most the pending requests in a map `{ id → { cb, where: "frame" | "tick" | "parked", underlying: number | null } }`; `lastActiveAt` updates whenever `isActive()` reads true at a decision point. `workerTicker.ts` builds the blob from a string `const src = "setInterval(() => postMessage(0), " + intervalMs + ")"`, `new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })))`, and `terminate()` terminates it and revokes the URL.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/frameScheduler.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/frameScheduler.ts src/lib/frameScheduler.test.ts src/lib/workerTicker.ts
git commit -m "lib: frame scheduler core — real frame while visible, worker tick while hidden and the transport active"
```

---

### Task 2: The hidden-safe driver and the `initializeOpenDAW` option

**Files:**
- Create: `src/lib/hiddenSafeFrameDriver.ts`
- Modify: `src/lib/projectSetup.ts` (the options interface and the `AnimationFrame.start(window)` call)

**Interfaces:**
- Consumes: Task 1's `createFrameScheduler`, `createWorkerTicker`.
- Produces:
  - `HIDDEN_TICK_MS = 20`, `HIDDEN_GRACE_MS = 2000`.
  - `createHiddenSafeFrameDriver(isActive: () => boolean): HiddenSafeFrameDriver` with `interface HiddenSafeFrameDriver { requestAnimationFrame(cb: (t: number) => void): number; cancelAnimationFrame(id: number): void; activityChanged(): void; transportRequested(): void; terminate(): void }` — binds the scheduler to `window.requestAnimationFrame` / `cancelAnimationFrame`, `document.visibilityState`, `performance.now`, and a `createWorkerTicker(HIDDEN_TICK_MS)` whose each message fires the one pending tick callback (`requestTick` registers it, `cancelTick` clears it); listens to `visibilitychange` and calls `visibilityChanged()`.
  - `ProjectSetupOptions.frameDriver?: "window" | "hidden-safe"` (default `"hidden-safe"`). `initializeOpenDAW` creates the driver before `AnimationFrame.start`, with `isActive` reading a `let engine` that is assigned once the project exists: `engine !== null && (engine.isPlaying.getValue() || engine.isRecording.getValue() || engine.isCountingIn.getValue())`; after the project exists it subscribes to the three observables and calls `driver.activityChanged()` on each change, and wraps the facade's `play`, `stop`, `setPosition`, `prepareRecordingState` (what `Recording.start` calls, so `project.startRecording` is covered) and `stopRecording`, plus the already-wrapped `scheduleClipPlay`, to call `driver.transportRequested()` before the original (the `play` wrap keeps its resume-first behaviour). `AnimationFrame.start(driver as unknown as Window)` (the cast `src/lib/testing/domSetup.ts` already uses). With `"window"` the call stays `AnimationFrame.start(window)`.

- [ ] **Step 1: Write the driver and the option** — no Node test: the binding is thin and needs `Worker`; its behaviour is measured in Task 5 (the `hidden-safe` rows) and Task 7 (visible pages unchanged). Keep the subscription `Terminable`s on the returned project context so a page that terminates its project does not leak them (the demos never do; store them anyway).

- [ ] **Step 2: Typecheck and the existing suite**

Run: `npm run typecheck` → exit 0. Run: `npx vitest run src/lib` → PASS (the jsdom tests drive `AnimationFrame` with their own owner and are unaffected).

- [ ] **Step 3: Smoke in the browser**

Start the dev server; open `midi-effect-placement-audit-debug-demo.html` (offline renders, fifteen seconds) and run it with a real click; expect 13 of 13 `as-predicted` as on main. This is the visible-page check at the cheapest page; the standing cells come in Task 7.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hiddenSafeFrameDriver.ts src/lib/projectSetup.ts
git commit -m "lib: hidden-safe frame driver — the demos keep the engine sync pumping while hidden and the transport is active"
```

---

### Task 3: Verdict library

**Files:**
- Create: `src/lib/audit/hiddenRecordingVerdict.ts`
- Test: `src/lib/audit/hiddenRecordingVerdict.test.ts`

**Interfaces:**
- Produces:
  - `DURATION_TOLERANCE_MS = 50`.
  - `interface PositionSample { atMs: number; positionPpqn: number; recording: boolean }`.
  - `positionFrozenMs(samples: readonly PositionSample[]): number` — the longest span between consecutive samples with `recording` true on both and an unchanged position; 0 for fewer than two such samples.
  - `syncResumeMs(samples: readonly PositionSample[], visibleAtMs: number): number | null` — from `visibleAtMs` to the first sample at or after it whose position differs from the last sample before it; null when no sample follows or the position never moved.
  - `frameBlockedMs(gaps: { maxGapMs: number | null }): number` — the watch's largest gap, 0 when null.
  - `interface TakeFigures { appeared: boolean; finalized: boolean; finalizeMs: number | null; regionDurationSec: number | null; expectedDurationSec: number; beatsMatched: number; beatsMissing: number; medianBeatErrorMs: number | null; alignedToleranceMs: number }`.
  - `type TakeVerdict = "intact" | "not-finalized" | "audio-damaged" | "session-stuck"`.
  - `classifyTake(f: TakeFigures): { verdict: TakeVerdict; detail: string }` — `not-finalized` when `!appeared` (detail `no take appeared`) or `!finalized`; `audio-damaged` when `beatsMissing > 0`, or `regionDurationSec` is null or off `expectedDurationSec` by more than `DURATION_TOLERANCE_MS`, or the median is null or outside `alignedToleranceMs`; else `intact`.
  - `classifyRow(input: { interrupt: "cover" | "modal"; hiddenSpanMs: number | null; take1: TakeFigures; take2: TakeFigures | null; take2Started: boolean }): { take1: TakeVerdict | "not-hidden"; take2: TakeVerdict | null; detail: string }` — a `cover` row with `hiddenSpanMs === null` reads `take1: "not-hidden"` (take 1's own figures stay in `detail`); a take 2 that never started (`take2Started === false`) reads `session-stuck`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyRow, classifyTake, frameBlockedMs, positionFrozenMs, syncResumeMs, type TakeFigures } from "./hiddenRecordingVerdict";

const good: TakeFigures = { appeared: true, finalized: true, finalizeMs: 120, regionDurationSec: 15.75, expectedDurationSec: 15.75, beatsMatched: 31, beatsMissing: 0, medianBeatErrorMs: 1.1, alignedToleranceMs: 3 };
const s = (atMs: number, positionPpqn: number, recording = true) => ({ atMs, positionPpqn, recording });

describe("positionFrozenMs / syncResumeMs / frameBlockedMs", () => {
  it("reads the longest unchanged run while recording and the resume after visible", () => {
    const samples = [s(0, 0), s(100, 480), s(200, 960), s(300, 960), s(400, 960), s(500, 960), s(600, 2880), s(700, 3360)];
    expect(positionFrozenMs(samples)).toBe(300);
    expect(syncResumeMs(samples, 450)).toBe(150);
    expect(syncResumeMs([s(0, 0), s(100, 0)], 50)).toBeNull();
    expect(positionFrozenMs([s(0, 0, false), s(100, 0, false)])).toBe(0);
    expect(frameBlockedMs({ maxGapMs: 5120 })).toBe(5120);
    expect(frameBlockedMs({ maxGapMs: null })).toBe(0);
  });
});

describe("classifyTake", () => {
  it("is intact only when everything holds, and names the first thing that does not", () => {
    expect(classifyTake(good).verdict).toBe("intact");
    expect(classifyTake({ ...good, appeared: false, finalized: false })).toEqual({ verdict: "not-finalized", detail: "no take appeared" });
    expect(classifyTake({ ...good, finalized: false }).verdict).toBe("not-finalized");
    expect(classifyTake({ ...good, beatsMissing: 3 }).verdict).toBe("audio-damaged");
    expect(classifyTake({ ...good, regionDurationSec: 15.60 }).verdict).toBe("audio-damaged");
    expect(classifyTake({ ...good, regionDurationSec: 15.71 }).verdict).toBe("intact");
    expect(classifyTake({ ...good, medianBeatErrorMs: 4 }).verdict).toBe("audio-damaged");
  });
});

describe("classifyRow", () => {
  it("reads not-hidden for a cover run that never hid, and session-stuck for a second take that never started", () => {
    expect(classifyRow({ interrupt: "cover", hiddenSpanMs: null, take1: good, take2: good, take2Started: true }).take1).toBe("not-hidden");
    expect(classifyRow({ interrupt: "modal", hiddenSpanMs: null, take1: good, take2: good, take2Started: true }).take1).toBe("intact");
    expect(classifyRow({ interrupt: "cover", hiddenSpanMs: 5000, take1: good, take2: null, take2Started: false }).take2).toBe("session-stuck");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail** — `npx vitest run src/lib/audit/hiddenRecordingVerdict.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/lib/audit/hiddenRecordingVerdict.ts`** with the signatures above.
- [ ] **Step 4: Run the tests to see them pass** → PASS (3 tests).
- [ ] **Step 5: Commit** — `git add src/lib/audit/hiddenRecordingVerdict.ts src/lib/audit/hiddenRecordingVerdict.test.ts && git commit -m "audit: hidden-page recording — take and row verdicts, position freeze and sync resume figures"`

---

### Task 4: Artifacts

**Files:**
- Create: `src/lib/audit/hiddenRecordingArtifacts.ts`
- Test: `src/lib/audit/hiddenRecordingArtifacts.test.ts`

**Interfaces:**
- Consumes: Task 3's `TakeFigures`, `TakeVerdict`, `PositionSample`.
- Produces: `HIDDEN_RECORDING_SCHEMA_VERSION = 1`; `interface HiddenRecordingTakeRecord extends TakeFigures { verdict: TakeVerdict | "not-hidden"; detail: string }`; `interface HiddenRecordingRow { driver: "window" | "hidden-safe"; interrupt: "cover" | "modal"; hideAt: "start" | "mid" | "stop"; hiddenSeconds: number; hiddenAtMs: number | null; visibleAtMs: number | null; hiddenSpanMs: number | null; frameGapMaxMs: number | null; positionFrozenMs: number; syncResumeMs: number | null; take1: HiddenRecordingTakeRecord; take2: HiddenRecordingTakeRecord | null; take2Started: boolean; samples: PositionSample[]; error: string | null }`; `interface HiddenRecordingSummary { schemaVersion: number; runToken: number; userAgent: string; sdkVersion: string; sampleRate: number; bpm: number; rows: HiddenRecordingRow[] }`; `summaryFileName(runToken: number)` → `hiddenrec-summary-<runToken>.json`; `parseHiddenRecordingSummary(json: unknown, runToken: number): HiddenRecordingSummary` — throws on a non-object, an unknown schema, `rows` not an array, a row without `take1` or `driver`. No SDK import in this module (the table scripts' load test in `scripts/audit/table-scripts-load.test.ts` is the reason that rule exists).

- [ ] **Step 1: Write the failing test** (names the file, parses a minimal row, rejects schema 2 and a row without `take1`).
- [ ] **Step 2: Run to see it fail.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run to see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "audit: hidden-page recording — summary schema"`

---

### Task 5: The page and the measurement runs

**Files:**
- Create: `src/demos/recording/recording-hidden-window-debug-demo.tsx`, `recording-hidden-window-debug-demo.html`
- Modify: `vite.config.ts` (rollup input `recordingHiddenWindowDebug`)

**Interfaces:**
- Consumes: Tasks 1–4; from the harness: `installLoopbackCapture`, `LOOPBACK_DEVICE_ID` (`@/lib/audit/loopbackInjection`), `buildReferenceSchedule`, `bandSplit`, `detectOnsets`, `measureTakeAlignment`, `expectedBeatRange` (`@/lib/audit/recordingAlignment`, `@/lib/audit/onsetDetection`), `waitForPosition`, `waitForPositionSettled`, `waitForTakeCount`, `waitForLoaderTerminal`, `resetForNextCell`, `resolveHarnessPathBias`, `STOP_LEAD_PPQN`, `FINALIZE_DEADLINE_MS` (`@/lib/audit/recordingCellRunner`), `ALIGNED_TOLERANCE_MS` (`@/lib/audit/recordingAuditCalibration`), `FrameWatch` (`@/lib/audit/midiInputCellRunner`), `BAR_PPQN` (`@/lib/audit/auditExpectations`), `withDeadline`, `initializeOpenDAW({ frameDriver, engineTap, audioContextSampleRate, bpm })`, `createWorkerTicker` (the 100 ms position sampler; a worker tick is not throttled while hidden).
- Produces: the page. Module-level `resolveParams()` returning `{ driver, interrupt, hideAt, hiddenSeconds, rate, bpm }` with the spec's defaults and errors `invalid ?driver=`, `invalid ?interrupt=`, `invalid ?hideAt=`, `invalid ?hiddenSeconds=`; an unknown value lands in `#audit-state` as `error:<message>` before any boot.

- [ ] **Step 1: HTML entry and Vite input** — copy `recording-alignment-audit-debug-demo.html`'s head (title `Recording Hidden Window Debug`, `noindex, nofollow`), script `src/demos/recording/recording-hidden-window-debug-demo.tsx`; add the rollup input.

- [ ] **Step 2: Context** — module-level `const loopback = installLoopbackCapture(1)`; on mount `initializeOpenDAW({ bpm, audioContextSampleRate: rate, frameDriver: driver, engineTap: (node) => loopback.engineTap(node) })`, `loopback.attach(audioContext)`, `resolveHarnessPathBias(audioContext)`, one Tape with its capture's `deviceId` set to `LOOPBACK_DEVICE_ID` and `requestChannels = 1` in a second transaction, `armed` true, as the harness's `createMatrixContext` does. Preferences: metronome off, `countInBars` 0 is not a value the schema allows, so `startRecording(false)` (no count-in) with `recording.allowTakes = true`.

- [ ] **Step 3: One take** — `runTake(options: { label: "take1" | "take2"; interrupt: boolean }): Promise<HiddenRecordingTakeRecord & { hiddenAtMs, visibleAtMs, frameGapMaxMs, samples }>`:
  1. `project.engine.setPosition(0)`, `waitForPositionSettled(project, 0, 30_000)`; schedule the reference clicks `buildReferenceSchedule(audioContext.currentTime + 0.2, 120, 0.25, 0.005)` and `loopback.scheduleReferenceClicks(schedule.times)`; start a `FrameWatch`, the 100 ms sampler (`createWorkerTicker(100)` pushing `{ atMs: performance.now(), positionPpqn: engine.position.getValue(), recording: engine.isRecording.getValue() }`), and `visibilitychange` listeners recording `hiddenAtMs` / `visibleAtMs` (the first hidden→visible pair after the record request).
  2. `recordRequestContextTime = audioContext.currentTime; project.startRecording(false)`. If `interrupt && hideAt === "start"`: interrupt now (same task).
  3. `interrupt && hideAt === "mid"`: `await waitForPosition(project, BAR_PPQN, 20_000)` then interrupt.
  4. `await waitForPosition(project, 8 * BAR_PPQN - STOP_LEAD_PPQN, 60_000)`; resolve `anyTake` and its loader as the harness does (before the stop); `project.engine.stopRecording()`; if `interrupt && hideAt === "stop"`: interrupt now (same task).
  5. Finalization: `appeared` = a take region exists within `FINALIZE_DEADLINE_MS` (`waitForTakeCount([unitAdapter], 1, …)` when none existed before the stop); `finalized` = `waitForLoaderTerminal(loader, FINALIZE_DEADLINE_MS, label)` resolved with state `loaded`; `finalizeMs` from the stop request.
  6. Read the take as the harness does: `loader.data` (Option; `isEmpty()` → `audio-damaged` with detail), `bandSplit`, `detectOnsets` (refractory 0.1 / 0.05), `measureTakeAlignment({ lowOnsets, highOnsets, regionStartSec, waveformOffsetSec, regionDurationSec, bufferDurationSec, bpm, schedule, recordRequestContextTime, stopRequestContextTime, harnessPathBiasSec: bias.seconds })`; `beatsMatched` / `beatsMissing` from the alignment, `medianBeatErrorMs` = `medianBeatErrorMsAdjusted`; `expectedDurationSec = tempoMap.intervalToSeconds(0, 8 * BAR_PPQN - STOP_LEAD_PPQN)`.
  7. Stop the watch and the sampler; `classifyTake`.
  The interrupt itself: `cover` sets `data-hide-now="1"` on the state badge and shows "Hide the page now for about N seconds" (and clears it on `visibilitychange` to visible); `modal` calls `window.alert("Recording — dismiss this after about N seconds")`.

- [ ] **Step 4: The run** — `setup` → take 1 (`interrupt: true`) → `resetForNextCell(project, loopback, unitAdapter)` → take 2 (`interrupt: false`; `take2Started` is false when its `waitForPositionSettled` or its first position advance times out) → `classifyRow` → summary PUT to `/__verify/<summaryFileName(runToken)>` under a 30 s deadline → `done`. The state badge walks `setup → recording:take1 → waiting:hide → hidden → visible → stopping → finalizing → recording:take2 → done | error:<message>`. A per-take table (verdict, detail, hidden span, frame gap max, position frozen, sync resume, finalize ms, duration vs expected, beats matched/missing, median) and the parameters line.

- [ ] **Step 5: Typecheck** — `npm run typecheck` → exit 0.

- [ ] **Step 6: The measurement runs** (real click on Run; the page visible; one fresh load per row). The cover is automated by opening a second tab in the same window for `hiddenSeconds` when `data-hide-now` flips, then closing it; the modal is run through the Playwright tooling, whose dialog handler accepts the alert after `hiddenSeconds`. Twelve rows plus one by hand:

  | driver | interrupt | hideAt |
  |---|---|---|
  | window | cover | start, mid, stop |
  | window | modal | start, mid, stop |
  | hidden-safe | cover | start, mid, stop |
  | hidden-safe | modal | start, mid, stop |
  | window | cover (another app's window dragged over Chrome by hand) | start |

  Read every row against the spec's prediction table. A row that disagrees with the prediction is the register's content either way; nothing in the library is changed to fit a row. Save each row's table output for Task 8.

- [ ] **Step 7: Commit**

```bash
git add recording-hidden-window-debug-demo.html src/demos/recording/recording-hidden-window-debug-demo.tsx vite.config.ts
git commit -m "debug: recording while the page is hidden — one page, two interruptions, three moments, two frame drivers"
```

---

### Task 6: Harness cleanup abort (small, separate commit)

**Files:**
- Modify: `src/demos/recording/recording-alignment-audit-debug-demo.tsx` (the per-repeat catch)

The sweep spent 26 rows on 30-second timeouts after one take started hidden. When a repeat fails and the page was hidden during it (`document.visibilityState !== "visible"` at any point, tracked by a `visibilitychange` counter as the MIDI page does) or its frame watch shows a gap over 1000 ms, the row's detail says so (`[the page was hidden during this repeat — not an SDK finding]`) as on the MIDI page. No abort: with the driver default-on a hidden window no longer freezes the sync, and a run that still cascades is a finding the rows should show.

- [ ] **Step 1: Add the visibility counter and the frame watch to the recording page's repeat loop, mirroring `midi-input-alignment-audit-debug-demo.tsx` lines 170–215.**
- [ ] **Step 2: Typecheck; commit** — `git commit -m "audit: recording sweep rows say when the page was hidden or frames stalled during the repeat"`

---

### Task 7: Visible pages unchanged with the driver on

- [ ] **Step 1:** `recording-alignment-audit-debug-demo.html?scenario=nominal-start&bpm=all&rate=48000` (6 rows): expect 2 of 2 cells `aligned`, netted +1.07 … +1.17 ms, 0 deficits, as today's register. Save the summarizer's lines.
- [ ] **Step 2:** `midi-input-alignment-audit-debug-demo.html?scenario=nominal-start&bpm=120` (IAC online): expect `matches-known-defect`, 48 of 48 notes, medians within the band as today.
- [ ] **Step 3:** With the recording page from Step 1 still open and idle, hide it (second tab) for ten seconds and read the console: no `[recording-alignment-audit]` activity and no repaint storm (the driver parks while idle); then with `project.engine.play()` from the console while hidden, position advances (read `engine.position.getValue()` on return). Record both readings for the register.

No commit; the readings go into Task 8.

---

### Task 8: Register, index, CLAUDE.md, drafts

**Files:**
- Create: `debug/2026-10-21-hidden-page-recording/note.md`, `debug/2026-10-21-hidden-page-recording/drafts/TO-REVIEW-openDAW-issue-hidden-page-take.md`, `debug/2026-10-21-hidden-page-recording/drafts/TO-REVIEW-openDAW-pr-hidden-safe-frames.md`
- Modify: `debug/README.md`, `CLAUDE.md`, `src/demos/recording/CLAUDE.md`

- [ ] **Step 1: The register** — header in the campaign registers' form (Title, SDK Pin `@opendaw/studio-sdk@0.0.176`, Harness with the page's parameters and the automation used per interruption, Measurement library, Design spec with the deletion note); "What a row measures"; "What #290 fixed and what it left" (the ring drain on a worker; the frame-driven sync named as related, lesser, with the file:line of `EngineWorklet`'s `AnimationFrame.add(() => reader.tryRead())` and `RecordAudio`'s position subscription); the prediction table copied from the spec; "Runs" with the thirteen rows of Task 5 and the Task 7 readings; "The driver" (what it does, the gate, the grace, the 20 ms tick and why); "Reading"; "Status" (standing check: `?driver=hidden-safe&interrupt=cover&hideAt=start`, then `mid`, then `stop`, expect both takes `intact`; the modal rows read against the register); "Open items".

- [ ] **Step 2: Index and CLAUDE.md** — a newest-first row in `debug/README.md` with the two drafts in its Drafts column and both under "Waiting for a read"; root CLAUDE.md: the "occluded/hidden window suspends `requestAnimationFrame`" bullet in "Build & Verification" gains two sentences (the demos' frame driver pumps from a worker tick while the document is hidden and the transport active, so a frozen sync on a hidden page now means the page passed `frameDriver: "window"` or the driver broke; the `?frameDriver=` of this page is the before/after) and a standing-run bullet for the page; `src/demos/recording/CLAUDE.md`: a section "Recording while the page is hidden" (the three frame-bound moments, what the page measures, the driver and its gate, the `modal` case being out of any driver's reach). No version numbers in either file.

- [ ] **Step 3: The issue draft** — from the `window` rows that failed (expected: cover at `start`, cover at `stop`, and whichever `modal` rows failed): title on the measured behaviour; SDK line; what happens in the user's words (a take begun or stopped while the page is behind a dialog or another tab); the repro URL on `opendaw-test.pages.dev` with `?driver=window&interrupt=cover&hideAt=start` and the one-line automation (open another tab for five seconds when the page says so); the rows table; "Read in the source" naming `RecordAudio`'s position subscription and `EngineWorklet`'s frame-driven `tryRead`, and #290's own paragraph that named this; the register link. No fix section.

- [ ] **Step 4: The PR draft** — `TO-REVIEW-openDAW-pr-hidden-safe-frames.md`: the PR text for `@opendaw/lib-dom` `AnimationFrame` gaining a hidden-safe path: `start(owner, options?: { isActive?: () => boolean })` where, with `document.visibilityState === "hidden"` and `isActive()` true (or within a grace of it), the next callback is scheduled from a worker tick instead of `requestAnimationFrame`; the before/after rows from this register; minimal comments (the maintainer's rule); a note that `EngineWorklet` would pass the engine's transport state as `isActive`. Header comment: not posted, offered as an option beside the issue, waits for the user's read.

- [ ] **Step 5: Copy rules** — `git diff main --name-only | grep -v '^changelogs/\|^debug/\|^docs/superpowers/' | xargs grep -nE '0\.0\.1[0-9]{2}'` → empty; `git diff main | grep '^+' | grep -i moises | grep -v MoisesLogo` → empty; `grep -rli 'claude.ai/code' debug/2026-10-21-hidden-page-recording` → empty.

- [ ] **Step 6: Commit** — `git add debug/ CLAUDE.md src/demos/recording/CLAUDE.md && git commit -m "debug: hidden-page recording register, drafts (issue and the driver offered as a PR), build-and-verification bullets"`

---

### Task 9: Verification, PR, review, cleanup

- [ ] **Step 1:** `npm run typecheck` → 0; `npx vitest run` → all pass, no warnings in the output; `npm run build` → 0.
- [ ] **Step 2:** `git rm docs/superpowers/specs/2026-10-21-hidden-page-recording-design.md docs/superpowers/plans/2026-10-21-hidden-page-recording.md`, commit `docs: remove the hidden-page recording spec and plan (shipped)`, push, `gh pr create` with a body covering: the driver (what, the gate, the standing-sweep check), the page and its thirteen rows, the two drafts, verification; ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 3:** Run `/pr-review-toolkit:review-pr` on the PR; fix Critical and Important findings on the branch; `gh pr edit --body-file` so the body reads as the final state. Merge only when the user says so.

---

## Self-review notes

- Spec coverage: driver → Tasks 1–2; page, parameters, sequence, figures → Task 5 with the library in Tasks 3–4; the "visible page unchanged" constraint → Tasks 2 (smoke) and 7; register, index, CLAUDE.md, both drafts → Task 8; the user's two decisions (default driver, issue plus PR option) → Task 2's default and Task 8's two drafts; the harness's hidden-row attribution (spec non-goal mentions it as separate; included as Task 6 because it is six lines and the sweep spent 13 minutes on it today) — a ruling the executor may drop if it grows.
- Type consistency: `TakeFigures` / `TakeVerdict` / `PositionSample` (Task 3) are what Task 4's records and Task 5's page use; `FrameScheduler.visibilityChanged` / `activityChanged` (Task 1) are what Task 2's driver calls; `frameDriver` option name used in Tasks 2, 5, 8.
- Proportion: the plan's code is tests and signatures; the page's sequence is described, not written.
