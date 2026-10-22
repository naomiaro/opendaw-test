# Chromium Watched Issues Measurement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce every open Chromium issue in the "Watched" section of `docs/known-vendor-issues.md` on this repo's own pages, so each entry moves to "Measured here" with a figure, or stays watched with "not reproduced on Chrome N, <date>" and the probe that failed to show it.

**Architecture:** One unlisted, SDK-free debug page (`chromium-watched-issues-debug-demo.html?issue=<name>`) hosts one probe per issue; each probe's measurement is a pure classifier in its own `src/lib/audit/chromium*.ts` module with a Node test, the page only drives Web Audio and renders the verdict in the repo's self-classifying shape (`#audit-state[data-audit-state]` ending in `done`, a `data-verdict` on `#verdict`). Two issues need the SDK's own path as a witness and reuse existing harnesses. Findings land in one debug note and the register.

**Tech Stack:** Web Audio API (AudioWorklet, MediaStream nodes, AnalyserNode), OPFS sync access handles in a dedicated worker, Playwright MCP for driving (real clicks, `goBack` for the cache), vitest in Node for the classifiers.

**Spec:** `docs/known-vendor-issues.md`, section "# Chromium / ## Watched — read from the tracker, not reproduced here" (six entries), plus the unmeasured half of the measured OPFS entry (the persisted usage going negative after a delete and a restart).

## Global Constraints

- Every probe page is unlisted: HTML at repo root with `<meta name="robots" content="noindex">`, not in `src/index.tsx` or `public/sitemap.xml`, a `DebugLinkBar` to the note and the tracker (root CLAUDE.md, "Unlisted debug demo pages"; model `worklet-clock-debug-demo.html` / `src/demos/recording/worklet-clock-debug-demo.tsx`).
- Probes are SDK-free unless the task says otherwise: they must say what Chrome does, not what the SDK repairs.
- Every probe self-classifies: a verdict word, the figures it was judged on, and `NOT CHECKED <reason>` when the page could not judge (the cache did not restore, the device was absent); never a verdict from a run that did not exercise the condition.
- Record the Chrome version (`navigator.userAgentData` or the UA string) and the date in every envelope and in the note; the register's "Last checked" quotes both.
- Transport and audio start from a REAL click (Playwright `click`, never a dispatched event); the tab stays visible; no edits under `src/` or `public/` while a run is on.
- Chapter docs and CLAUDE.md state the present; versions and dates go in the note and the register only.
- An upstream comment, if a finding warrants one, is drafted as `debug/2026-10-23-chromium-watched-issues/drafts/TO-REVIEW-chromium-<id>.md` and listed under "Waiting for a read" in `debug/README.md`; nothing is posted without the user's read. The Chromium tracker is reached through the user's signed-in Chrome (claude-in-chrome), not WebFetch.
- Envelopes upload through the dev server's `/__verify` sink into `.verify-output/` (untracked), named `chromium-<issue>-<runToken>.json`.

## Review Focus

- A probe that reads `currentFrame` only on the main thread's timeline would miss a stale worklet read; every clock figure must come from inside the worklet (Task 2 asserts the constructor and first three `process()` frames are the ones judged).
- The back/forward cache may refuse a cross-origin-isolated page; a run whose `pageshow.persisted` is false must read `NOT CHECKED not-cached` with the `notRestoredReasons`, never `NORMAL` (Task 3 test).
- A suspend/resume probe that judges by RMS alone would call a quiet-but-clean tone distorted; the classifier judges harmonic purity against the pre-cycle baseline (Task 4 test).
- A capture probe will see zeros at the stream's start before the source delivers; a zero run at the head is not a gap (Task 5 test).
- The OPFS usage probe reads `estimate()` after a full browser restart, which the Playwright browser cannot survive; the task says the run is through the user's Chrome and that a same-session reading proves nothing (Task 6).

---

### Task 1: The note, the page shell and the shared verdict shape

**Files:**
- Create: `debug/2026-10-23-chromium-watched-issues/note.md`
- Create: `chromium-watched-issues-debug-demo.html`
- Create: `src/demos/recording/chromium-watched-issues-debug-demo.tsx`
- Create: `src/lib/audit/chromiumWatched.ts`
- Test: `src/lib/audit/chromiumWatched.test.ts`
- Modify: `debug/README.md` (index row, newest first), `vite.config.ts` (`rollupOptions.input` entry)

**Interfaces:**
- Produces: `type WatchedIssue = "first-read" | "bfcache" | "suspend-resume" | "capture-gaps" | "opfs-usage" | "opfs-flush"`; `WATCHED_ISSUES: readonly WatchedIssue[]`; `issueFrom(params: URLSearchParams): WatchedIssue` (throws on an unknown or missing value); `interface ProbeEnvelope { issue: WatchedIssue; chrome: string; date: string; runToken: string; verdict: string; figures: Record<string, number | string | null> }`; `envelopeName(issue, runToken): string` → `chromium-<issue>-<runToken>.json`.

- [ ] **Step 1: Write the failing test** — `chromiumWatched.test.ts`: `issueFrom(new URLSearchParams("issue=bfcache"))` is `"bfcache"`; an unknown value throws with the list of known names; `envelopeName("opfs-usage", "abc")` is `chromium-opfs-usage-abc.json`.
- [ ] **Step 2: Run it to see it fail** — `npx vitest run src/lib/audit/chromiumWatched.test.ts`: FAIL, module not found.
- [ ] **Step 3: Implement `chromiumWatched.ts`** with the exports above.
- [ ] **Step 4: Run the test** — PASS.
- [ ] **Step 5: Page shell** — the HTML entry (copy `worklet-clock-debug-demo.html`, retitle, noindex) and the tsx: reads `issueFrom(new URLSearchParams(location.search))`, shows the issue's title and tracker link in a `DebugLinkBar`, a Run button, `#audit-state[data-audit-state]` (`idle` → `running:<step>` → `done` | `error`), `#verdict[data-verdict]`, a figures table, and uploads the envelope. Each later task plugs a probe function `(signal: AbortSignal, report: (step: string) => void) => Promise<ProbeEnvelope>` into a switch on the issue. Add the input to `vite.config.ts`.
- [ ] **Step 6: The note** — header with the register's watched Chromium entries as a table (issue, what the probe does, verdict words, status "not yet run"), the run recipe (dev server `npm run dev -- --port 5173 --host 127.0.0.1 --strictPort`, the URL per issue, a real click, the envelope path), and a "Findings" section to fill per task. Index row in `debug/README.md`.
- [ ] **Step 7: Verify** — `npm run typecheck` 0 errors; open the page with `?issue=first-read` in Playwright and confirm the shell renders with the title and `data-audit-state="idle"`.
- [ ] **Step 8: Commit** — `git add` the six files; `git commit -m "debug: chromium watched issues — page shell, note, verdict shape"`.

### Task 2: 571344687 — stale first clock read after a slow module load

**Files:**
- Create: `src/lib/audit/chromiumFirstRead.ts`
- Test: `src/lib/audit/chromiumFirstRead.test.ts`
- Modify: `src/demos/recording/chromium-watched-issues-debug-demo.tsx` (the `first-read` probe)

**Interfaces:**
- Produces: `interface FirstReadSample { creationFrame: number; constructorFrame: number; processFrames: [number, number, number] }` (all in frames at the context rate; `creationFrame` = `Math.round(context.currentTime * sampleRate)` read on the main thread just before `new AudioWorkletNode`); `judgeFirstRead(samples: FirstReadSample[], quantum?: number): { verdict: "STALE FIRST READ" | "FIRST READ TRUE" | "NOT CHECKED"; staleRuns: number; largestLagQuanta: number; jumpQuanta: number[] }` — a run is stale when `constructorFrame < creationFrame − quantum` AND `processFrames[1] − processFrames[0] > quantum` (the issue's signature: the first read lags, the second call jumps); `NOT CHECKED` below three samples.

- [ ] **Step 1: Write the failing test** — three cases from the tracker's own lines: busy (creation 10240, constructor 5120, process 5120/10368/10496 → stale, jump 41 quanta), none (creation 5120, constructor 5120, process 5120/5248/5376 → true), two samples → `NOT CHECKED`.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement `judgeFirstRead`** in `chromiumFirstRead.ts`.
- [ ] **Step 4: Run it** — PASS.
- [ ] **Step 5: The probe** — three variants per click, five runs each, in a RUNNING context started by the click: `slow` (`addModule` of a blob module whose top level busy-waits 100 ms, then `addModule` of the probe processor and `new AudioWorkletNode` at once), `large` (a blob module with 12 000 small exported functions), `none` (the probe module alone). The probe processor posts `{constructorFrame, processFrames}` from its constructor and first three `process()` calls (`currentFrame` inside the worklet). Verdict per variant and overall; figures: stale runs per variant, largest lag in quanta and ms, the jumps.
- [ ] **Step 6: SDK witness, no new code** — note how the SDK is exposed: the engine worklet on boot is constructed in `addModule().then` (the issue's window) and stamps from `QuantumClock`, whose anchor is the largest `currentFrame − calls·128` seen, so a low first read is overridden by the first true read; the recording-alignment sweep's placement (netted +1.07…+1.17 ms on 0.0.177) is the figure that says the repair holds. Record that reading in the note's finding, with the probe's own figures beside it.
- [ ] **Step 7: Run on the release** — Chrome, real click, five runs per variant; save the envelope; write the finding (verdict, lags, whether `large` and `slow` differ as the tracker says: 32–43 ms vs 96–107 ms).
- [ ] **Step 8: Commit** — `git commit -m "debug: 571344687 probe — stale first worklet clock read after a slow module load"`.

### Task 3: 575891839 — half-speed worklet clock after a back/forward-cache restore

**Files:**
- Create: `src/lib/audit/chromiumBfcache.ts`
- Test: `src/lib/audit/chromiumBfcache.test.ts`
- Create: `public/blank-return.html` (a same-origin page with one link back, under the same COOP/COEP headers)
- Modify: the page (the `bfcache` probe)

**Interfaces:**
- Produces: `interface ClockRatioSample { contextAdvanceSec: number; wallAdvanceSec: number }`; `clockRatio(sample): number`; `judgeBfcache(before: ClockRatioSample, after: ClockRatioSample | null, persisted: boolean, notRestoredReasons: string | null): { verdict: "HALF SPEED" | "NORMAL" | "NOT CHECKED"; ratioBefore: number; ratioAfter: number | null; reason: string | null }` — `NOT CHECKED` with the reasons when `persisted` is false or `after` is null; `HALF SPEED` when `ratioAfter < 0.75` with `ratioBefore ≥ 0.9`.

- [ ] **Step 1: Write the failing test** — the tracker's figures: before 0.967, after 0.501, persisted → `HALF SPEED`; after 0.98 → `NORMAL`; persisted false → `NOT CHECKED` carrying the reasons string.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement** `chromiumBfcache.ts`.
- [ ] **Step 4: Run it** — PASS.
- [ ] **Step 5: The probe** — on the click: an AudioWorkletNode tone (a sine the processor renders itself) plus an OscillatorNode control into an AnalyserNode, a two-second clock-ratio measurement (`currentTime` advance over `performance.now()` advance), the figures kept in `sessionStorage`; a "Navigate away" link to `/blank-return.html`. On `pageshow` with `event.persisted` true the page re-measures for three seconds and judges; on `persisted` false it reads `performance.getEntriesByType("navigation")[0].notRestoredReasons` (serialized) and judges `NOT CHECKED`. Also measure the control oscillator's pitch through the analyser before and after (the tracker says the control stays right) and record it as a figure.
- [ ] **Step 6: Run** — Playwright: click Run, wait three seconds, `page.goto("/blank-return.html")`, `page.goBack()`, poll `#audit-state`. If `NOT CHECKED not-cached`, record the reasons: a cross-origin-isolated page may be ineligible, and that itself is the finding for the register ("the demos cannot enter the cache on Chrome N because …" moves the entry to measured with that reading). If restored: the verdict.
- [ ] **Step 7: Commit** — `git commit -m "debug: 575891839 probe — worklet clock after a back/forward-cache restore"`.

### Task 4: 560233271 — distortion after suspend/resume cycles (macOS)

**Files:**
- Create: `src/lib/audit/chromiumSuspendResume.ts`
- Test: `src/lib/audit/chromiumSuspendResume.test.ts`
- Modify: the page (the `suspend-resume` probe)

**Interfaces:**
- Produces: `interface TonePurity { fundamentalDb: number; harmonicsDb: number; dropouts: number }` (from an analyser's FFT: the 440 Hz bin against the sum of all other bins above −80 dB; dropouts = analyser time-domain windows whose RMS fell below 10 % of the baseline RMS while the tone plays); `judgeSuspendResume(baseline: TonePurity, afterCycles: TonePurity[], cycles: number): { verdict: "DISTORTED" | "CLEAN" | "NOT CHECKED"; worstPurityDb: number; dropoutsAfter: number }` — `DISTORTED` when any post-cycle purity (`fundamentalDb − harmonicsDb`) is more than 12 dB below the baseline or dropouts exceed 0 for two consecutive windows; `NOT CHECKED` with fewer than 10 cycles.

- [ ] **Step 1: Write the failing test** — baseline purity 60 dB; a run whose purity after cycle 7 is 40 dB → `DISTORTED`; all within 3 dB → `CLEAN`; 5 cycles → `NOT CHECKED`.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement** `chromiumSuspendResume.ts`.
- [ ] **Step 4: Run it** — PASS.
- [ ] **Step 5: The probe** — a worklet-rendered 440 Hz tone into an AnalyserNode and the destination (the SDK's output tap recipe in root CLAUDE.md; mute the speakers or keep the gain at −30 dB); measure the baseline for two seconds; then 20 cycles of `await context.suspend(); await context.resume();` with a one-second purity window after each; judge. Record the OS (the tracker reproduces on macOS only) and the Chrome version.
- [ ] **Step 6: Run** — real click; the finding says whether Chrome N on this macOS reproduces, with the worst purity and the cycle it happened at. Note in the finding that neither the demos nor the SDK call `suspend()`, so a `DISTORTED` reading moves the entry up with "avoid suspend/resume" as the standing rule, not a code change.
- [ ] **Step 7: Commit** — `git commit -m "debug: 560233271 probe — tone purity across suspend/resume cycles"`.

### Task 5: 40103985 — zero-filled gaps and duplicated blocks in captured input

**Files:**
- Create: `src/lib/audit/chromiumCaptureGaps.ts`
- Test: `src/lib/audit/chromiumCaptureGaps.test.ts`
- Modify: the page (the `capture-gaps` probe); reuse `src/lib/audit/loopbackInjection.ts` for the synthetic source

**Interfaces:**
- Consumes: the loopback injection's same-context `MediaStreamAudioDestinationNode` stream (`loopbackInjection.ts`; hand out `stream.clone()` per consumer).
- Produces: `findZeroRuns(frames: Float32Array, minRun?: number): { start: number; length: number }[]` (runs of exact 0 of at least `minRun` = 100 frames, the head run before the first non-zero frame excluded and reported separately as `headZeros`); `findDuplicateBlocks(frames: Float32Array, block?: number): number[]` (starts of 128-frame blocks byte-identical to the block before them, where the block is not silence); `judgeCaptureGaps(zeroRuns, duplicates, headZeros, durationSec): { verdict: "GAPS" | "CLEAN" | "NOT CHECKED"; zeroRunCount: number; longestRunFrames: number; duplicateCount: number }` — `GAPS` when any run or any duplicate after the head; `NOT CHECKED` under 30 s of capture.

- [ ] **Step 1: Write the failing test** — a synthetic 48 kHz minute of a 1 kHz tone with one 480-zero insert at 30 s → one run of 480 at that index, `GAPS`; the same signal with a repeated 128-block at 45 s → one duplicate; a head of 2 000 zeros then a clean tone → `CLEAN` with `headZeros` 2000; 10 s of signal → `NOT CHECKED`.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement** `chromiumCaptureGaps.ts`.
- [ ] **Step 4: Run it** — PASS.
- [ ] **Step 5: The probe** — two sources selected by `&source=loopback|mic`: the loopback (a 1 kHz tone the page generates into the same-context destination stream, the recipe the alignment harness uses) and the real microphone (the laptop playing the same tone from its speaker, the room quiet — the combined audit's setup); a worklet recorder collects 60 s of the `MediaStreamAudioSourceNode` output into a Float32Array (transfer in 1 s chunks); judge on the main thread; figures include the sample rate (run at 48 000 and 44 100: the register's 441-frame step was 44.1 kHz only). Keep the rest of the graph empty (the tracker ties the gaps to a large graph).
- [ ] **Step 6: Runs** — loopback at both rates, mic at both rates; four envelopes. A `GAPS` reading on the loopback relates to the register's 441-frame delay step (the same node path); say in the finding whether the step and a zero run coincide.
- [ ] **Step 7: Commit** — `git commit -m "debug: 40103985 probe — zero runs and duplicate blocks in captured input"`.

### Task 6: 436552046 — persisted OPFS usage after a delete and a restart; 40909520 — flush cost

**Files:**
- Create: `src/lib/audit/chromiumOpfs.ts`
- Test: `src/lib/audit/chromiumOpfs.test.ts`
- Create: `src/lib/audit/chromiumOpfsWorker.ts` (a dedicated worker: write N MB through a sync access handle, flush timing, truncate-then-remove option)
- Modify: the page (the `opfs-usage` and `opfs-flush` probes)

**Interfaces:**
- Produces: `judgeOpfsUsage(reported: { beforeWrite: number; afterWrite: number; afterDelete: number; afterRestart: number | null }, writtenBytes: number): { verdict: "NEGATIVE USAGE" | "COUNTED" | "NOT COUNTED" | "NOT CHECKED"; detail: string }` — `NOT COUNTED` when `afterWrite − beforeWrite < writtenBytes / 2` (the under-report half, judged in-session), `NEGATIVE USAGE` when `afterRestart` is present and above 1 GiB with no files, `NOT CHECKED` when `afterRestart` is null; `summarizeFlush(ms: number[]): { median: number; p95: number; max: number }`.

- [ ] **Step 1: Write the failing test** — usage 0 / 0 / 0 / 4 032 000 000 with 64 MB written → `NEGATIVE USAGE`; 0 / 67 108 864 / 0 / null → `COUNTED` and `NOT CHECKED` for the restart half (two fields in the detail); flush medians from a list.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement** both modules; the worker writes `test/<runToken>.bin` of 64 MiB in 1 MiB `write()` calls, `flush()`, `close()`, reports `estimate()` at each stage, and on `&truncateFirst=1` truncates to 0 through the handle before `removeEntry()` (the tracker's workaround, to test it too).
- [ ] **Step 4: Run it** — PASS.
- [ ] **Step 5: The usage run, through the user's Chrome** — the restart half cannot run in the Playwright browser (its profile does not survive a close). Recipe in the note: open the page in the user's Chrome (claude-in-chrome), click Run (writes, reads, deletes, stores the readings in `localStorage`), ask the user to quit Chrome fully and reopen the page; the page reads `estimate()` on load, finds the stored readings, judges and uploads. Run once plain and once with `&truncateFirst=1`.
- [ ] **Step 6: The flush run** — `?issue=opfs-flush`: 20 writes of 1 MiB and 20 of 16 MiB each followed by `flush()`, timed in the worker; figures median / p95 / max per size; no verdict word beyond `MEASURED` (the tracker's claim is "very slow on Mac compared with other browsers", a comparison this repo does not make — record the figures).
- [ ] **Step 7: Out of scope, said in the note** — the quota-sentinel half of the watched OPFS entry (541725401 / 40068799) needs the origin's quota exhausted or an incognito profile; it stays watched with that reason.
- [ ] **Step 8: Commit** — `git commit -m "debug: OPFS probes — persisted usage after delete and restart, flush timing"`.

### Task 7: 388871416 — `outputLatency` with a Bluetooth headset (needs hardware)

**Files:**
- Modify: the page (an `output-latency` readout: `baseLatency`, `outputLatency`, the sink's label from `enumerateDevices()`, re-read every second) — no classifier; the figures are the finding.
- Modify: `src/lib/audit/chromiumWatched.ts` (add `"output-latency"` to `WatchedIssue`; extend the Task 1 test).

- [ ] **Step 1: Extend the Task 1 test** for the new issue name; run; FAIL; add the name; PASS.
- [ ] **Step 2: The readout** — a table that appends a row per second with the two latencies in ms and the current output device label; a Run button that resumes the context.
- [ ] **Step 3: Run with the user** — built-in speaker first, then AirPods (or any Bluetooth output) connected while the page runs; the finding is the before / after pair (the tracker: 33 ms then 200+ ms on current builds). If no Bluetooth device is at hand, the task ends with the readout shipped and the entry's "Last checked" unchanged; say so in the note.
- [ ] **Step 4: Commit** — `git commit -m "debug: output latency readout for 388871416"`.

### Task 8: The register, the note and the PR

**Files:**
- Modify: `docs/known-vendor-issues.md` (move each reproduced entry under "Measured here" with the probe's figures, the Chrome version and the date; keep the rest watched with "not reproduced on Chrome N, <date>, probe `?issue=…`"), `debug/2026-10-23-chromium-watched-issues/note.md` (every finding, the envelopes by name), `debug/README.md` (status), `.claude/skills/sdk-upgrade/SKILL.md` (section 5: the probe page joins the sweep table as a hardware-free row set, with the two rows that need a hand or hardware marked).

- [ ] **Step 1: Register and note** — one bullet per entry; an entry moves up only on a verdict that reproduced the issue; a `NOT CHECKED` run is recorded as such, not as "not reproduced".
- [ ] **Step 2: Gates** — `npm run typecheck`, `npx vitest run`, `npm run build`; `grep -rnE '0\.0\.1[0-9]{2}' src documentation CLAUDE.md` finds no new version qualifier; `git diff main | grep -ic moises` is 0.
- [ ] **Step 3: PR** — `gh pr create --base main` with the findings table in the body; run `/pr-review-toolkit:review-pr`, fix Critical and Important, `gh pr edit --body-file`. Delete this plan in the PR (root CLAUDE.md: a plan is deleted in the PR that completes it; the note and the register carry the decisions).
- [ ] **Step 4: Memory** — update the memory pointer for this plan to "done, see the note", and the Cloudflare / sweep items left open.
