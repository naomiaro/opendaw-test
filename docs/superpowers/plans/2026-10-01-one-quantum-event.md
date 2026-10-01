# One-Quantum Recording-Start Event — Resolution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to work this plan task-by-task (it is a measurement campaign: the tasks are sequential and share one dev server, so do not fan them out to subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the one-quantum recording-start event resolved. Its cause is found: Chrome's worklet clock stands still for a quantum when the main thread is changing the audio graph, and the SDK reads that clock once at the start of a take. What is left: watch the clock through an event on the harness, measure what it does to a take when it is forced, make the harness itself safe from it, and bring the user an openDAW issue draft, a Chromium bug draft and a fix proposal to decide on.

**Architecture:** The multi-mic harness already records every render quantum that goes into the loopback stream, each stamped with the `currentFrame` its `process` call read. That recording becomes a clock witness: the list of calls where the stamp did not advance by exactly one quantum. With it, natural events are collected and read; a switch on the audit page then does graph work on the main thread at the start of each take, which turns the rare event into a frequent one with the SDK in the loop.

**Tech Stack:** Vite dev server (HTTPS, port 5173), Playwright MCP (`browser_run_code_unsafe` with a `filename`), Node ≥ 23 running `.ts` scripts directly, vitest.

**Spec:** `debug/recording-start-alignment-audit.md`, section "The cause of the one-quantum event: Chrome's worklet clock stands still while the main thread changes the graph (2026-10-01)". Read it before Task 1; it has the browser source, the measurement and what is and is not established. Background: "The one-quantum repeat, looked at again (2026-09-29)" (the algebra of what each figure on a row can see) and "The one-quantum event, twice more" (inside "Standing sweep on 0.0.173, and the stop moved ahead of the next click (2026-10-01)").

## What is known (2026-10-01)

The event: on a rare repeat, a time stamp the SDK takes at the start of a take is one render quantum (128 frames, 2.667 ms at 48 kHz) EARLIER than the audio it describes.

| figure on a row | what it is | what an event looks like |
|---|---|---|
| `medianBeatErrorMsNetted` | engine's recording-start time against the engine's audio, plus constants | one quantum above the run's usual value (+3.81 where the usual is +1.146) |
| `firstFrameCheckMs` (multi-mic rows only) | recording worklet's first-quantum time against the buffer's real first frame | −2.667 instead of 0.00 |
| adjusted median − `nodeDelayMs` | the sum of the two: where the sound really sits | 1.4375 ms when the two cancel, 4.104 ms when only the engine's stamp is off |

Three sightings in 615 repeats (1 in 416 on 0.0.172, 2 in 199 on 0.0.173; Fisher one-sided p = 0.25):

| run | SDK | row | netted | first-frame check | take really misplaced? |
|---|---|---|---|---|---|
| `recaudit-mt-summary-1790721436525` | 0.0.172 | `multitrack-janked/120/r3`, both tapes | +3.813 | −2.667 on both | no (the two stamps cancel) |
| `recaudit-summary-1790872110234` | 0.0.173 | `midtimeline-start/97.3/r1` | +3.819 | not measured (single tape) | unknown |
| `recaudit-mt-summary-1790872984620` | 0.0.173 | `multitrack-janked/120/r7` | +3.813 on both | 0.00 on tape a, −2.667 on tape b | **tape a: yes, one quantum** |

**The cause.** Chromium updates the worklet scope's `currentFrame` at the end of each quantum only if it can take the audio graph lock without waiting (`BaseAudioContext::UpdateWorkletGlobalScopeOnRenderingThread`, a try-lock). The main thread holds that lock while it constructs, connects or disconnects a node. When the two coincide, every `process()` call of the next quantum reads a `currentFrame` and `currentTime` one quantum old. Measured without the SDK (`scripts/audit/recording-alignment/one-quantum/graph-lock-clock.page.js`, Chrome 154): no stale stamp with an idle or merely busy main thread; 1831 of 4446 quanta stale under connect/disconnect; and 44 of 12003 fresh worklets connected to a fresh stream source read a first `currentFrame` one quantum early (1 in 273). Never late.

**Where the SDK reads it** (checkout `/Users/naomiaro/Code/openDAWOriginal`, pinned at `@opendaw/studio-sdk@0.0.173`; the same code on 0.0.172):

- engine's recording start — `packages/studio/core-wasm/src/processor.ts`, `#announceRecordingStart`: `currentTime + RenderQuantum / sampleRate` on the first render that leaves the recording flag set;
- recording worklet's first quantum — `packages/studio/core-processors/src/RecordingProcessor.ts`, `process`: `currentTime` on the first call whose input has the expected channel count;
- placement — `packages/studio/core/src/capture/RecordAudio.ts`: `startOffset = contextTime − firstQuantumTime + outputLatency + inputLatency`, region position `floor(position)`.

Both stamps are taken in the quanta right after the SDK makes the take's recording worklet and connects it (`CaptureAudio.prepareRecording`; in the harness the tape's source node is made at that moment too), which is graph work.

**Not yet shown:** that the three harness events were this, by watching the clock through one. Everything about them fits (the register section goes through each), and on the 0.0.172 event the recorder's stamp is 128 frames before the context time at which its own source node was made, which no reading of the loopback can explain away.

## What the prep already provides

| piece | where | what it does |
|---|---|---|
| The clock probe | `scripts/audit/recording-alignment/one-quantum/graph-lock-clock.page.js`, runner `run-graph-lock-clock.playwright.js` | No SDK. Stamp against true frame for every quantum under five kinds of main-thread work; result in `.verify-output/graph-lock-clock-<time>.json` |
| Engine's recording-start report on every row | `recordingStartContextTimeSec`, `recordingStartPositionPpqn` | Checked against the SDK's arithmetic: `waveformOffsetSec` = recording start − first quantum + output latency − the fraction of a pulse the Int32 region position drops |
| Event tally | `node scripts/audit/recording-alignment/one-quantum-events.ts [--from <run id>]`, `RECAUDIT_MAX_RUN=<run id>` for an upper bound; logic and tests in `src/lib/audit/oneQuantumEvents.ts` | Repeats and events per SDK, per stop and per scenario, exact intervals, Fisher's test, each event with its start-of-take figures. Counts release builds only; a repeat off by something other than one quantum is listed apart |
| Loop driver | `scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js` | One URL, `RUNS` times, a fresh page per run |
| SDK version and stop on every envelope | `sdkVersion`, `stopLead`; `&stopLead=off` on the audit page | For Task 6 only |
| A servable 0.0.172 build | `/Users/naomiaro/Code/opendaw-sdk-override-0.0.172` (outside the repo), built by `node scripts/audit/sdk-override.ts a5bf064 <dir>` | For Task 6 only. Served engine binary sha-256 `a6b14cd4d4d819fc…`; the audit page's version import resolves into it (0.0.172). The installed build's is `edf2c4a1e5f11b1d…` |

## Global Constraints

- No file under the repo is edited while a run is going: Vite reloads the page. A run that overlaps an edit is deleted (`rm .verify-output/*<runToken>*`), not quoted.
- Starting a dev server always goes: `lsof -ti :5173 | xargs kill; rm -rf node_modules/.vite`, then the start in the background, then wait until `curl -sk -o /dev/null https://localhost:5173/` succeeds, then `curl -sk https://localhost:5173/wasm-engine/wasm/engine.wasm | shasum -a 256 | cut -c1-16` and compare with the build wanted (`edf2c4a1e5f11b1d` installed, `a6b14cd4d4d819fc` override). After the last run of a session: kill and clear the cache again.
- The browser window stays visible and a run is started with a real click (the drivers do both; a hidden page freezes the transport and the loop driver skips the run).
- The tally counts natural events only. A forced run (Task 2) carries `graphChurn: true` on its envelope and the tally leaves it out.
- Nothing in the measurement goes through the speakers (the loopback is inside the AudioContext). The system output can be muted; tell the user so before the first long block.
- A change to the harness must not move what it measures: after it, a `multitrack-all` run has 32 rows, netted 1.146 on every ordinary row and a node delay on every row.
- Version numbers go in `debug/`, `changelogs/` and this plan only. Chapter docs, demo copy, code comments and CLAUDE.md additions state current behaviour.
- Nothing is posted anywhere without the user reading the text first: an issue or a browser bug goes to `debug/drafts/<name>.md` and waits. A fix is proposed to the user in the debug note, never put into an issue.
- `npm run typecheck` exits 0 before a commit; commit named paths, not `git add -A` (the loop driver's `RUNS` and `QUERY` are edited during the campaign: restore them with `git checkout -- scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js` before committing). PRs are squash-merged; this plan file is deleted in the PR that completes the work.

## Review Focus

- **A coincidence taken for a confirmation.** A stale quantum somewhere in a run and an event somewhere in the same run prove nothing. The stale quantum has to be the one a stamp of that event was taken in, and repeats without an event must have none there. Task 3 compares both.
- **A lost message read as a stale clock.** The reference recorder posts chunks of 64 quanta. A chunk that never arrives leaves a gap BETWEEN chunks; a clock that stood still shows INSIDE a chunk, as a stamp equal to the one before it. Task 1 keeps the two apart.
- **The harness measuring its own exposure.** Taps and the reference are laid out by their stamps. Under forced graph work a stale stamp inside a tap would move the harness's reference, not the SDK's take. Task 2 ends the graph work before the taps attach and checks that node delays are still read on every row.
- **Forced runs in the count.** They would swamp the natural rate. The envelope flag and the tally's skip are tested in Task 2.
- **An event that is not this event.** The tally lists a repeat that is off by something other than one quantum apart from the events. Read those too: a second kind of finding gets its own line in the write-up.

---

### Task 1: A clock witness in the harness

The reference recorder in `src/lib/audit/loopbackInjection.ts` (started by `prepareNodeTaps`, multi-mic runs only) stamps every quantum with `currentFrame`. Its chunks are trimmed to 30 seconds; the list of stamps that did not advance by one quantum is kept for the whole run and goes on the envelope.

**Files:**
- Modify: `src/lib/audit/nodeTap.ts`, `src/lib/audit/nodeTap.test.ts`
- Modify: `src/lib/audit/loopbackInjection.ts`
- Modify: `src/lib/audit/recordingAuditArtifacts.ts`
- Modify: `src/demos/recording/recording-alignment-audit-debug-demo.tsx` (multi-mic summary)
- Modify: `scripts/audit/recording-alignment/one-quantum-events.ts`

**Interfaces:**
- Produces: `frameDiscontinuities(chunks: readonly TapChunk[], previousFrame: number | null): { found: ClockDiscontinuity[]; lastFrame: number | null }` with `ClockDiscontinuity = { previousFrame: number; frame: number; betweenChunks: boolean }`; `LoopbackHandle.clockDiscontinuities(): ClockDiscontinuity[]`; envelope field `clockDiscontinuities?: ClockDiscontinuity[]`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/audit/nodeTap.test.ts` (add `frameDiscontinuities` to its import from `./nodeTap`; `TapChunk` and `NODE_TAP_QUANTUM_FRAMES` are already imported):

```ts
describe("frameDiscontinuities", () => {
  /** A chunk of `frames.length` quanta stamped with the given frames; the samples do not matter here. */
  const stamped = (frames: number[]): TapChunk => ({
    frames: Float64Array.from(frames),
    samples: new Float32Array(frames.length * NODE_TAP_QUANTUM_FRAMES),
    count: frames.length,
  });

  it("finds nothing in a clock that advances one quantum per call, across chunks too", () => {
    const { found, lastFrame } = frameDiscontinuities([stamped([0, 128, 256]), stamped([384, 512])], null);
    expect(found).toEqual([]);
    expect(lastFrame).toBe(512);
  });

  it("reports a clock that stood still for one call: the same frame, then two quanta on", () => {
    const { found } = frameDiscontinuities([stamped([0, 128, 128, 384])], null);
    expect(found).toEqual([
      { previousFrame: 128, frame: 128, betweenChunks: false },
      { previousFrame: 128, frame: 384, betweenChunks: false },
    ]);
  });

  it("marks a gap between two chunks as such: a chunk that never arrived looks the same", () => {
    const { found } = frameDiscontinuities([stamped([0, 128]), stamped([512, 640])], null);
    expect(found).toEqual([{ previousFrame: 128, frame: 512, betweenChunks: true }]);
  });

  it("carries the last frame over from an earlier call", () => {
    expect(frameDiscontinuities([stamped([256, 384])], 128).found).toEqual([]);
    expect(frameDiscontinuities([stamped([384, 512])], 128).found)
      .toEqual([{ previousFrame: 128, frame: 384, betweenChunks: true }]);
  });

  it("reads only the quanta a chunk says it holds", () => {
    const partial = stamped([0, 128, 999]);
    partial.count = 2;
    const { found, lastFrame } = frameDiscontinuities([partial], null);
    expect(found).toEqual([]);
    expect(lastFrame).toBe(128);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/lib/audit/nodeTap.test.ts`
Expected: FAIL, `frameDiscontinuities is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/audit/nodeTap.ts`, after `NODE_TAP_PROCESSOR_SOURCE`:

```ts
/** A `process` call whose `currentFrame` was not one quantum after the call before it. */
export interface ClockDiscontinuity {
  previousFrame: number;
  frame: number;
  /** True when the two calls are in different posted chunks: a chunk that never arrived looks the same. */
  betweenChunks: boolean;
}

/**
 * The calls among `chunks` whose `currentFrame` is not exactly one quantum after the
 * previous call's. `previousFrame` is the last frame of an earlier batch, null for the
 * first. A worklet's clock can stand still for a call while the main thread changes the
 * audio graph: that shows INSIDE a chunk, as a frame equal to the one before it and then
 * a step of two quanta. A step BETWEEN two chunks is either the clock or a posted chunk
 * that was lost.
 */
export function frameDiscontinuities(
  chunks: readonly TapChunk[],
  previousFrame: number | null
): { found: ClockDiscontinuity[]; lastFrame: number | null } {
  const found: ClockDiscontinuity[] = [];
  let last = previousFrame;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.count; index++) {
      const frame = chunk.frames[index];
      if (last !== null && frame !== last + NODE_TAP_QUANTUM_FRAMES) {
        found.push({ previousFrame: last, frame, betweenChunks: index === 0 });
      }
      last = frame;
    }
  }
  return { found, lastFrame: last };
}
```

- [ ] **Step 4: Run them and see them pass, then break it on purpose**

Run: `npx vitest run src/lib/audit/nodeTap.test.ts` — expected PASS.
Change `frame !== last + NODE_TAP_QUANTUM_FRAMES` to `frame > last + NODE_TAP_QUANTUM_FRAMES`: the "stood still" test must fail. Put it back.

- [ ] **Step 5: Collect in the loopback and expose**

In `src/lib/audit/loopbackInjection.ts`:

1. Import `frameDiscontinuities` and `type ClockDiscontinuity` from `./nodeTap`.
2. Beside `let referenceChunks: TapChunk[] = [];` add:
```ts
  // Every reference call whose currentFrame did not advance by one quantum, for the whole
  // run: the reference itself is trimmed, this list is not.
  let clockDiscontinuities: ClockDiscontinuity[] = [];
  let lastReferenceFrame: number | null = null;
```
3. In the reference recorder's chunk callback inside `prepareNodeTaps`, before `referenceChunks.push(chunk);`:
```ts
          const { found, lastFrame } = frameDiscontinuities([chunk], lastReferenceFrame);
          lastReferenceFrame = lastFrame;
          for (const discontinuity of found) {
            clockDiscontinuities.push(discontinuity);
            console.warn(
              "[loopbackInjection] reference clock: frame " + String(discontinuity.frame) + " after " +
              String(discontinuity.previousFrame) + (discontinuity.betweenChunks ? " (between chunks)" : " (inside a chunk)")
            );
          }
```
4. Where `referenceChunks = [];` is reset on uninstall, also `clockDiscontinuities = [];` and `lastReferenceFrame = null;`.
5. Add to the `LoopbackHandle` interface and to the returned object:
```ts
  /**
   * Every call of the reference recorder, since `prepareNodeTaps()`, whose `currentFrame`
   * was not one quantum after the call before it. Empty without the `nodeTaps` option.
   * A copy: the caller may keep it.
   */
  clockDiscontinuities(): ClockDiscontinuity[];
```
```ts
    clockDiscontinuities() {
      return clockDiscontinuities.map((discontinuity) => ({ ...discontinuity }));
    },
```

- [ ] **Step 6: Persist and print**

`src/lib/audit/recordingAuditArtifacts.ts`, on `MultitrackAuditSummary` (import `type ClockDiscontinuity` from `./nodeTap`):
```ts
  /** Every call of the reference recorder during the run whose `currentFrame` did not
   *  advance by one quantum (see `frameDiscontinuities`). No verdict reads it. */
  clockDiscontinuities?: ClockDiscontinuity[];
```
In the multi-mic summary builder of `recording-alignment-audit-debug-demo.tsx` (beside `stopLead: STOP_LEAD,`): `clockDiscontinuities: loopback.clockDiscontinuities(),`.

`scripts/audit/recording-alignment/one-quantum-events.ts`: read the field off the raw envelope for each counted multi-mic run (the loaded type does not carry it: `JSON.parse(readFileSync(`${VERIFY_DIR}/recaudit-mt-summary-${runId}.json`, "utf8")).clockDiscontinuities`), and print after the event list:

```
Clock discontinuities (multi-mic runs that carry the field): <runs with any> of <runs with the field>
  run <id>: <n> — frames <previousFrame>→<frame> (inside a chunk | between chunks), …
```
and add to each multi-mic event tape's line, when the run carries the field, `stale quantum at a stamp: yes | no`, where "yes" means the run has an in-chunk discontinuity with `frame === previousFrame` whose frame is within one quantum of the tape's `firstQuantumTimeSec × rate` or of `recordingStartContextTimeSec × rate − 128`.

Run: `npm run typecheck && npx vitest run src/lib/audit` — expected: exit 0, all pass.

- [ ] **Step 7: One run; the witness must not move the measurement**

Start the installed-SDK server (Global Constraints). In the loop driver set `RUNS = 1`, `QUERY = "scenario=multitrack-all&bpm=120&rate=48000"` and call it through the Playwright MCP with `filename: "scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js"`.
Expected: one entry with `state: "done"` and `line` starting `32 rows`.

```bash
node -e 'const fs=require("fs");const f=fs.readdirSync(".verify-output").filter(n=>/^recaudit-mt-summary-/.test(n)).sort().pop();const j=JSON.parse(fs.readFileSync(".verify-output/"+f,"utf8"));console.log(f,j.sdkVersion,j.rows.length,"netted",[...new Set(j.rows.map(r=>r.medianBeatErrorMsNetted.toFixed(3)))].join(","),"node delays",j.rows.filter(r=>typeof r.nodeDelayMs==="number").length,"discontinuities",JSON.stringify(j.clockDiscontinuities))'
```
Expected: `0.0.173 32 netted 1.146 node delays 32 discontinuities []` (or a list: then read it before going on; a `betweenChunks: true` entry on an idle run means posted chunks are being lost and the witness needs a look first). Write the run id down as `FIRST_PLAN_RUN`.

- [ ] **Step 8: Commit**

```bash
git checkout -- scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js
npm run typecheck && npx vitest run
git add src/lib/audit/nodeTap.ts src/lib/audit/nodeTap.test.ts src/lib/audit/loopbackInjection.ts src/lib/audit/recordingAuditArtifacts.ts src/demos/recording/recording-alignment-audit-debug-demo.tsx scripts/audit/recording-alignment/one-quantum-events.ts
git commit -m "feat(audit): a clock witness on the multi-mic harness"
```

### Task 2: Force the event, with the SDK in the loop

`&graphChurn=on` makes the main thread connect and disconnect two gain nodes that are in nobody's path, in short stretches, from the record request on. If the cause is right, the SDK's stamps go stale on a large share of repeats and the harness's own figures show it: first-frame checks and netted medians off by whole quanta. This is the measured signature for the upstream report.

**Files:**
- Create: `src/lib/audit/graphChurn.ts`, `src/lib/audit/graphChurn.test.ts`
- Modify: `src/demos/recording/recording-alignment-audit-debug-demo.tsx`
- Modify: `src/lib/audit/recordingAuditArtifacts.ts` (+ its test)
- Modify: `scripts/audit/recording-alignment/one-quantum-events.ts`

**Interfaces:**
- Produces: `churnGraph(audioContext: BaseAudioContext, durationMs: number, timing?: { stretchMs: number; gapMs: number }): Promise<number>` (resolves with the number of connect/disconnect pairs done); envelope field `graphChurn?: boolean`; loaded summaries gain `graphChurn: boolean`.

- [ ] **Step 1: The failing test**

`src/lib/audit/graphChurn.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { churnGraph } from "./graphChurn";

/** A stand-in for the two things the churn touches: `createGain`, and a node's connect/disconnect. */
function fakeContext() {
  const calls: string[] = [];
  const node = () => ({
    connect: () => { calls.push("connect"); },
    disconnect: () => { calls.push("disconnect"); },
  });
  return { calls, context: { createGain: node } as unknown as BaseAudioContext };
}

describe("churnGraph", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("connects and disconnects in pairs until the duration is over, then resolves with the count", async () => {
    const { calls, context } = fakeContext();
    const done = churnGraph(context, 20, { stretchMs: 2, gapMs: 1 });
    await vi.advanceTimersByTimeAsync(60);
    const pairs = await done;
    expect(pairs).toBeGreaterThan(0);
    expect(calls.length).toBe(pairs * 2);
    expect(calls[0]).toBe("connect");
    expect(calls[calls.length - 1]).toBe("disconnect");
    const settled = calls.length;
    await vi.advanceTimersByTimeAsync(60);
    expect(calls.length).toBe(settled);
  });

  it("does nothing for a duration of zero", async () => {
    const { calls, context } = fakeContext();
    const done = churnGraph(context, 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(await done).toBe(0);
    expect(calls).toEqual([]);
  });
});
```

`vi.useFakeTimers()` also fakes `performance.now()`, which the stretches read; inside a stretch the clock does not move, so the implementation bounds a stretch by a pair count as well as by time (below). Run: `npx vitest run src/lib/audit/graphChurn.test.ts` — expected FAIL (no module).

- [ ] **Step 2: Implement**

`src/lib/audit/graphChurn.ts`:

```ts
/**
 * Graph work on the main thread, for forcing the worklet clock to stand still.
 *
 * Every `connect` and `disconnect` takes the audio graph lock. Chrome moves the worklet
 * scope's `currentFrame` on at the end of a render quantum only if that lock is free, so
 * a main thread that is inside one of these calls at that instant leaves every worklet
 * reading the previous quantum's time for one quantum. The two nodes here are in nobody's
 * path: nothing audible changes.
 */

/** The most pairs one stretch does, so a stretch ends even where the clock does not move. */
const MAX_PAIRS_PER_STRETCH = 20_000;

export function churnGraph(
  audioContext: BaseAudioContext,
  durationMs: number,
  timing: { stretchMs: number; gapMs: number } = { stretchMs: 2, gapMs: 1 }
): Promise<number> {
  if (durationMs <= 0) return Promise.resolve(0);
  const from = audioContext.createGain();
  const to = audioContext.createGain();
  const end = performance.now() + durationMs;
  let pairs = 0;
  return new Promise((resolve) => {
    const stretch = () => {
      if (performance.now() >= end) { resolve(pairs); return; }
      const until = Math.min(end, performance.now() + timing.stretchMs);
      let inStretch = 0;
      do {
        from.connect(to);
        from.disconnect(to);
        pairs++;
        inStretch++;
      } while (performance.now() < until && inStretch < MAX_PAIRS_PER_STRETCH);
      setTimeout(stretch, timing.gapMs);
    };
    stretch();
  });
}
```

Run the test: PASS. Break it (drop the `disconnect`): the pair-count assertion must fail. Put it back.

- [ ] **Step 3: The switch on the page, the flag on the envelope, the skip in the tally**

`recording-alignment-audit-debug-demo.tsx`:
- beside `STOP_LEAD`: 
```ts
/** `&graphChurn=on` does graph work on the main thread from each record request on, to
 *  force the worklet clock to stand still while the SDK takes its start-of-take stamps.
 *  Multi-mic scenarios only. Such a run is not part of any count. */
const GRAPH_CHURN = params.get("graphChurn") === "on";
/** It has to be over before the node taps attach, about 220 ms after a take's first quantum. */
const GRAPH_CHURN_MS = 150;
```
- in the multi-mic runner, right before the `if (scenario === "multitrack-janked")` that calls `project.startRecording(false)`: `if (GRAPH_CHURN) void churnGraph(audioContext, GRAPH_CHURN_MS);`
- in the multi-mic summary: `graphChurn: GRAPH_CHURN,`
- in the single-tape `runAudit`, beside `assertStopLeadParam();`: `if (GRAPH_CHURN) throw new Error("?graphChurn=on is for the multitrack scenarios");`

`recordingAuditArtifacts.ts`: `graphChurn?: boolean` on `SummaryBase` ("True when the run was made with `?graphChurn=on`: the main thread did graph work at each take's start. Not a measurement of the SDK as it runs."), `graphChurn: boolean` on both loaded types via `json.graphChurn === true`; a test in `recordingAuditArtifacts.test.ts` that an envelope without the field loads as `false` and one with `true` as `true`.

`one-quantum-events.ts`: add `graphChurn: boolean` to its `Run`, skip `run.graphChurn` runs before `sdkOf`, count them, and print `forced runs left out: <n>` in the header line.

Run: `npm run typecheck && npx vitest run src/lib/audit` — exit 0, all pass.

- [ ] **Step 4: Measure**

Installed-SDK server. Driver: `RUNS = 3`, `QUERY = "scenario=multitrack-start&bpm=120&rate=48000&graphChurn=on"`. Then:

```bash
node -e 'const fs=require("fs");for(const f of fs.readdirSync(".verify-output").filter(n=>/^recaudit-mt-summary-/.test(n)).sort().slice(-3)){const j=JSON.parse(fs.readFileSync(".verify-output/"+f,"utf8"));const q=128/j.rate*1000;const h={};for(const r of j.rows){const k="netted "+(typeof r.medianBeatErrorMsNetted==="number"?Math.round((r.medianBeatErrorMsNetted-1.146)/q):"null")+"q, check "+(typeof r.firstFrameCheckMs==="number"?Math.round(r.firstFrameCheckMs/q):"null")+"q";h[k]=(h[k]||0)+1}console.log(f,"churn",j.graphChurn,"rows",j.rows.length,"node delays",j.rows.filter(r=>typeof r.nodeDelayMs==="number").length,"discontinuities",(j.clockDiscontinuities||[]).length,JSON.stringify(h))}'
```

Expected if the cause is right: `churn true`, 16 rows per run, a node delay on every row (the churn ended before the taps), many clock discontinuities, and a good share of rows away from `netted 0q, check 0q`, by whole quanta, with the check never positive and the netted never negative (a stale stamp is only ever early). Then `node scripts/audit/recording-alignment/one-quantum-events.ts --from <FIRST_PLAN_RUN>` must print `forced runs left out: 3` and count none of their repeats.

If every row reads `netted 0q, check 0q`: the churn missed the stamps. Read `recordRequestContextTime` against `firstQuantumTimeSec` on the rows to see how long after the request the first quantum comes, and move the churn's start or length (it must still end before the taps attach). If node delays go missing: the churn ran into the taps; shorten it.

- [ ] **Step 5: Commit**

```bash
git checkout -- scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js
npm run typecheck && npx vitest run
git add src/lib/audit/graphChurn.ts src/lib/audit/graphChurn.test.ts src/lib/audit/recordingAuditArtifacts.ts src/lib/audit/recordingAuditArtifacts.test.ts src/demos/recording/recording-alignment-audit-debug-demo.tsx scripts/audit/recording-alignment/one-quantum-events.ts
git commit -m "feat(audit): force the stale worklet clock at a take's start"
```

### Task 3: Watch the clock through natural events

**Files:** none modified.

- [ ] **Step 1: Loop `multitrack-janked` on the installed SDK**

Driver: `RUNS = 10`, `QUERY = "scenario=multitrack-janked&bpm=120&rate=48000"` (8 repeats and about 70 s per run; two of the three sightings were in this scenario). About 12 minutes per call; the Playwright MCP moves a call past two minutes to the background and reports when it is done. After each call:
```bash
node scripts/audit/recording-alignment/one-quantum-events.ts --from <FIRST_PLAN_RUN>
```
**Stop at 3 events, or after 8 calls (640 repeats, about 1.6 hours), whichever comes first.** A run the driver reports as anything but `done` is noted and not topped up. With fewer than 3 events after 8 calls, go on with what there is and say so in the write-up.

- [ ] **Step 2: Read them**

For each event tape the tally prints `stale quantum at a stamp: yes | no`. And the control: among the runs without an event, how many have any discontinuity, and is any of them within a quantum of a stamp of an ordinary repeat?

| what the events show | conclusion |
|---|---|
| every event has a stale quantum at a stamp; ordinary repeats have none there | the harness events are the stale clock. Go to Task 4 |
| some events have none | a second cause exists beside the stale clock. Write down each kind with its count and its figures; Task 5's reports cover the stale clock only, and the register names the rest as open |
| ordinary repeats have stale quanta at their stamps without being events | the reading of "at a stamp" is too loose (which quantum the engine or recorder actually stamped in). Tighten it from the row's own times before concluding anything |

- [ ] **Step 3: Save the tally**

```bash
node scripts/audit/recording-alignment/one-quantum-events.ts --from <FIRST_PLAN_RUN> > .verify-output/one-quantum-events-$(date +%F).txt
```
The write-up quotes this file; a later tally uses `RECAUDIT_MAX_RUN=<last run id of this task>`.

### Task 4: Make the harness's own stamps safe

Taps and the reference are laid out by their stamps (`layOutRange`). A stale stamp puts a quantum on top of the one before it and leaves its own place empty. Since a stale stamp is only ever behind, a sequence of calls can be repaired: a stamp less than one quantum after the previous call's frame is replaced by that frame plus a quantum; a stamp at or beyond it is taken as read (a recorder that was not called for a while jumps forward).

**Files:**
- Modify: `src/lib/audit/nodeTap.ts`, `src/lib/audit/nodeTap.test.ts`
- Modify: `src/lib/audit/loopbackInjection.ts`

**Interfaces:**
- Produces: `repairFrames(chunks: readonly TapChunk[], previousFrame: number | null): { repaired: number; lastFrame: number | null }` — rewrites `chunk.frames` in place.

- [ ] **Step 1: Failing tests** (in `nodeTap.test.ts`, with the `stamped` helper of Task 1 moved to the top of the file):

```ts
describe("repairFrames", () => {
  it("leaves a true clock alone", () => {
    const chunk = stamped([0, 128, 256]);
    expect(repairFrames([chunk], null)).toEqual({ repaired: 0, lastFrame: 256 });
    expect([...chunk.frames]).toEqual([0, 128, 256]);
  });

  it("moves a stamp that stood still to one quantum after the call before it", () => {
    const chunk = stamped([0, 128, 128, 384]);
    expect(repairFrames([chunk], null).repaired).toBe(1);
    expect([...chunk.frames]).toEqual([0, 128, 256, 384]);
  });

  it("repairs a clock that stood still for several calls", () => {
    const chunk = stamped([0, 128, 128, 128, 512]);
    expect(repairFrames([chunk], null).repaired).toBe(2);
    expect([...chunk.frames]).toEqual([0, 128, 256, 384, 512]);
  });

  it("takes a jump forward as read: the recorder was not called in between", () => {
    const chunk = stamped([0, 128, 512, 640]);
    expect(repairFrames([chunk], null).repaired).toBe(0);
    expect([...chunk.frames]).toEqual([0, 128, 512, 640]);
  });

  it("repairs across a chunk border from the frame carried over", () => {
    const chunk = stamped([256, 384]);
    expect(repairFrames([chunk], 256)).toEqual({ repaired: 1, lastFrame: 512 });
    expect([...chunk.frames]).toEqual([384, 512]);
  });
});
```
Run: FAIL (`repairFrames is not a function`).

- [ ] **Step 2: Implement** in `nodeTap.ts`:

```ts
/**
 * Put each call's stamp where the call really was. A worklet's `currentFrame` can be
 * behind for a call, never ahead: a stamp less than one quantum after the call before it
 * is moved to exactly that; a stamp at or beyond it stays (a recorder that was not called
 * for a while jumps forward). The first stamp of a recorder stays as read, so a recorder
 * whose very first call read a stale clock keeps that call one quantum early.
 * Rewrites `frames` in place; returns how many stamps it moved.
 */
export function repairFrames(
  chunks: readonly TapChunk[],
  previousFrame: number | null
): { repaired: number; lastFrame: number | null } {
  let repaired = 0;
  let last = previousFrame;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.count; index++) {
      if (last !== null && chunk.frames[index] < last + NODE_TAP_QUANTUM_FRAMES) {
        chunk.frames[index] = last + NODE_TAP_QUANTUM_FRAMES;
        repaired++;
      }
      last = chunk.frames[index];
    }
  }
  return { repaired, lastFrame: last };
}
```
Run: PASS. Break it (`<` to `<=`): the true-clock test must fail. Put it back.

- [ ] **Step 3: Use it**

In `loopbackInjection.ts`: in the reference's chunk callback, AFTER the `frameDiscontinuities` call of Task 1 (the witness reads the stamps as the worklet gave them) and before `referenceChunks.push(chunk)`, call `repairFrames([chunk], lastRepairedReferenceFrame)` and keep its `lastFrame` (a new `let lastRepairedReferenceFrame: number | null = null`, reset where the others are). In `tapSourceNodes`, where a tap settles, call `repairFrames(tapChunks, null)` before the chunks are handed on, and warn with the tape's device id when it moved any. Update the comment on `layOutRange` ("each quantum at the frame it was stamped with…") to say the stamps it gets are repaired ones and why.

- [ ] **Step 4: Check and commit**

Run one `multitrack-all` run as in Task 1 Step 7: same expected line. Then one `&graphChurn=on` run with `GRAPH_CHURN_MS` raised to 600 for this check only (so the churn overlaps the taps): node delays must still be read on every row, and the console must show the repair warnings. Put `GRAPH_CHURN_MS` back to its Task 2 value.

```bash
git checkout -- scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js
npm run typecheck && npx vitest run
git add src/lib/audit/nodeTap.ts src/lib/audit/nodeTap.test.ts src/lib/audit/loopbackInjection.ts
git commit -m "fix(audit): lay taps out by repaired stamps"
```

### Task 5: Write it up and bring it to the user

**Files:**
- Create: `debug/worklet-clock-stale-under-graph-work.md` (by the convention in `debug/README.md`: verified-against line, symptom, mechanism, evidence, repro, and a last section "Fix idea (internal — does not go in an issue)")
- Create: `debug/drafts/issue-recording-start-stale-worklet-clock.md` (openDAW)
- Create: `debug/drafts/chromium-bug-worklet-current-frame-stale.md` (Chromium)
- Modify: `debug/recording-start-alignment-audit.md` (append a section), `debug/README.md`
- Modify: `src/demos/recording/CLAUDE.md` (the rule for reading a row; current behaviour only)
- Delete: `docs/superpowers/plans/2026-10-01-one-quantum-event.md` (this file, in the PR that completes the work)

- [ ] **Step 1: A repro anyone can open.** The probe needs the dev server and Playwright. Make it a page: an unlisted debug demo (`comp-lanes-debug-demo.tsx` as the reference for layout, `<meta name="robots" content="noindex">`, not on the index or the sitemap) `worklet-clock-debug-demo.html` → `src/demos/recording/worklet-clock-debug-demo.tsx`, which runs the five conditions of `graph-lock-clock.page.js` on a button press and classifies itself: `STALE CLOCK: <n> of <N> fresh worklets read their first currentFrame early` or `CLOCK TRUE` or `THREW <stage>`, with the table of conditions under it. Move the probe's measuring code into `src/lib/audit/workletClockProbe.ts` so the page and the Playwright runner share it; keep the logic out of the component. Run it in Chrome; if Firefox or Safari are at hand, run it there too and write down what they read (it decides whether the SDK report says "Chrome" or "browsers").

- [ ] **Step 2: The note.** Symptom (a take one quantum off, about 1 in 200 take starts on this machine); mechanism (the try-lock, the two stamping sites); evidence (the probe's table, the forced runs of Task 2, the natural events of Task 3 with the witness); repro (the page of Step 1; `&graphChurn=on`). Last section, internal: what would make each stamp robust. Two starting points to weigh there, not to post:
  - the engine processor is called every quantum, so it can keep its own frame count and take the larger of `currentFrame` and its own count plus one quantum (the repair of Task 4), and report from that;
  - the recorder is new at each take and has no history at its first call. It can hold its report back for a few calls and take the largest `stamp − 128 × call index` among them, or read a clock the engine processor keeps for the scope.
  The user has open PRs on this code (openDAW #378, #380, #418); whether this becomes another PR, and on top of which, is theirs to decide.

- [ ] **Step 3: The two drafts.** openDAW: what a user sees, the measured signature, the repro page URL, the link to the note, the cause stated precisely (both stamps are one read of the worklet clock, taken while the graph is being built; in Chrome that clock can be a quantum behind then). No suggested fix. Chromium: `currentFrame` / `currentTime` in `AudioWorkletGlobalScope` are stale for a quantum when the graph lock is held at the end of the previous one; what the spec says they are; the repro page; the source lines. Before drafting, search the Chromium tracker for an existing report of the same thing and cite it if there is one.

- [ ] **Step 4: Register and index.** Register section `## The one-quantum event, resolved to the worklet clock (<date>)`: runs and counts, the per-event table with the witness, the forced runs, the harness repair, what is established, what is open. `debug/README.md`: prepend the result to the register's entry, add the note's entry. `src/demos/recording/CLAUDE.md`: how to read a row with a clock discontinuity and what `&graphChurn=on` is. Memory: `project_first_frame_quantum_anomaly.md` and its line in `MEMORY.md`.

- [ ] **Step 5: Verify, commit, stop.**
```bash
npm run typecheck && npx vitest run && npm run build
git add debug src docs scripts worklet-clock-debug-demo.html vite.config.ts
git commit -m "docs(debug): the one-quantum recording-start event is Chrome's worklet clock standing still"
```
Then STOP and ask the user to read the two drafts and the fix idea. Nothing is posted, and no upstream branch is pushed, before they answer. Push and open the PR when they ask.

### Task 6 (only if the user still wants it): Is it more frequent on 0.0.173?

With the cause in the browser, the rate depends on how much graph work the page does around the stamps and on timing, not on the release as such; nothing in the 0.0.173 diff touches the capture path or either stamping site. Ask the user before spending three hours on it. If it is wanted:

Arms, on `scenario=multitrack-all&bpm=120&rate=48000` (16 repeats per run, about 130 s; a block is `RUNS = 5`, 80 repeats, about 11 minutes):

| arm | server | driver `QUERY` |
|---|---|---|
| A | installed (0.0.173) | `scenario=multitrack-all&bpm=120&rate=48000` |
| B | `SDK_DIST_OVERRIDE=/Users/naomiaro/Code/opendaw-sdk-override-0.0.172` | the same |
| C | installed (0.0.173) | `scenario=multitrack-all&bpm=120&rate=48000&stopLead=off` |

- [ ] **Step 1: Check the override.** `ls /Users/naomiaro/Code/opendaw-sdk-override-0.0.172/@opendaw | wc -l` → `17`; `grep OPENDAW_SDK_VERSION /Users/naomiaro/Code/opendaw-sdk-override-0.0.172/@opendaw/studio-sdk/dist/version.js` → `"0.0.172"`. If the directory is gone: `node scripts/audit/sdk-override.ts a5bf064 /Users/naomiaro/Code/opendaw-sdk-override-0.0.172`.

- [ ] **Step 2: Record rounds.** A round is one block of each arm in the order A, C, B. Every block starts with the server start of the Global Constraints (kill first, then the hash of the build that arm wants) and ends with:
```bash
node -e 'const fs=require("fs");for(const f of fs.readdirSync(".verify-output").filter(n=>/^recaudit-mt-summary-/.test(n)).sort().slice(-5)){const j=JSON.parse(fs.readFileSync(".verify-output/"+f,"utf8"));console.log(f,j.sdkVersion,"stopLead",j.stopLead,j.rows.length,"rows")}'
```
Expected: five files, each with the arm's `sdkVersion` and `stopLead` and 32 rows. A block that reads otherwise was recorded on the wrong build: delete its five runs and record it again. Write down the first run id of the first block as `FIRST_AB_RUN`; every tally of this task is `--from <FIRST_AB_RUN>`.

**Stopping rule, fixed now.** Record 5 rounds. After each completed round read the two tally lines `stop-lead only` (arms A and B) and `on 0.0.173` (arms A and C), each in both directions, as the tally prints them (three decimals). If any of the four figures prints below `0.010` after rounds 1 to 4, record exactly one more round and stop there. The result is read off the tally after the LAST round recorded, whatever an earlier look showed. A run that ends in anything but `done` (an error row, a skip for a hidden window, the driver's deadline) is not topped up; two such runs in one block: stop and find out why before recording more.

- [ ] **Step 3: State it** as "a difference" (a figure below 0.010 after the last round) or "no difference seen at this size", with each arm's rate and exact interval, and the by-scenario lines the tally prints (`multitrack-start` against `multitrack-janked`). At the rates seen so far the second is the likely outcome even if they are real: say what size of difference this many repeats could have shown. Kill the server and clear the cache after the last arm-B block.
