# One-Quantum Recording-Start Event — Investigation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to work this plan task-by-task (it is a measurement campaign: the tasks are sequential and share one dev server, so do not fan them out to subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out whether the one-quantum recording-start event is more frequent on SDK 0.0.173 than on 0.0.172, whether the audit harness's stop lead has anything to do with it, and which of the SDK's start-of-take time stamps is off on each new event.

**Architecture:** The same harness page (`recording-alignment-audit-debug-demo.html?scenario=multitrack-all`) is run in three arms that differ in ONE thing each: the SDK release served (`SDK_DIST_OVERRIDE`) or the harness's stop (`&stopLead=off`). Every run's envelope names its SDK version and its stop, every row carries the engine's own recording-start report beside the recording worklet's first-quantum time and the source node's measured delay, and one script tallies repeats and events per arm from `.verify-output/`.

**Tech Stack:** Vite dev server (HTTPS, port 5173), Playwright MCP (`browser_run_code_unsafe` with a `filename`), Node ≥ 23 running `.ts` scripts directly, vitest.

**Spec:** `debug/recording-start-alignment-audit.md`, sections "One repeat, both tapes: the buffer starts a quantum after the time given for it", "The one-quantum repeat, looked at again (2026-09-29)" and "The one-quantum event, twice more" (inside "Standing sweep on 0.0.173, and the stop moved ahead of the next click (2026-10-01)"). Read all three before Task 1: the second one has the algebra that says what each figure can and cannot see.

## What is known (2026-10-01)

The event: on a rare repeat, a time stamp the SDK takes at the start of a take is one render quantum (128 frames, 2.667 ms at 48 kHz) EARLIER than the audio it describes.

| figure on a row | what it is | what an event looks like |
|---|---|---|
| `medianBeatErrorMsNetted` | engine's recording-start time against the engine's audio, plus constants | one quantum above the run's mode (+3.81 where the mode is +1.146) |
| `firstFrameCheckMs` (multi-mic rows only) | recording worklet's first-quantum time against the buffer's real first frame | −2.667 instead of 0.00 |
| adjusted median − `nodeDelayMs` | the sum of the two: where the sound really sits | 1.4375 ms when the two cancel, 4.104 ms when only the engine's stamp is off |

Three sightings in 609 repeats:

| run | SDK | row | netted | first-frame check | take really misplaced? |
|---|---|---|---|---|---|
| `recaudit-mt-summary-1790721436525` | 0.0.172 | `multitrack-janked/120/r3`, both tapes | +3.813 | −2.667 on both | no (the two stamps cancel) |
| `recaudit-summary-1790872110234` | 0.0.173 | `midtimeline-start/97.3/r1` | +3.819 | not measured (single tape) | unknown |
| `recaudit-mt-summary-1790872984620` | 0.0.173 | `multitrack-janked/120/r7` | +3.813 on both | 0.00 on tape a, −2.667 on tape b | **tape a: yes, one quantum** |

Tally by `node scripts/audit/recording-alignment/one-quantum-events.ts` on 2026-10-01: 0.0.172 1 in 416 repeats, 0.0.173 2 in 193; Fisher one-sided p = 0.24. On 0.0.173, 0 in 63 with the stop after the click and 2 in 130 with the stop lead; p = 0.45. Nothing is established. (Every 0.0.172 repeat so far was recorded with the stop after the click, so the two questions are not yet separated in the saved runs: that is what arm B is for.)

Observations that cost nothing to keep in mind:

- On all three events `regionPositionPpqn` and `waveformOffsetSec` are the values every other row of the run has (5 and 25.604 ms from a stopped start at 120 BPM). The SDK's placement inputs look normal; it is the audio that sits a quantum away from them.
- Both tapes whose first-frame check is −2.667 read node delay 17.333 ms (832 frames) and loopback delay 14.958 ms, in the 0.0.172 event and in the 0.0.173 one. A node delay of 17.333 also occurs on ordinary rows.
- The single-tape event was the first repeat after the tempo changed (120 → 97.3). On 0.0.173 a tempo change makes the engine refresh its tempo map and re-read Seconds-based spans after the transaction (`Engine::transact`, `TempoStamp`); on 0.0.172 it did not. One event is not a pattern.
- What 0.0.173 changed in `Engine::render` and around it: the quantum after a `set_position` on a stopped transport now runs the update clock once (`paused_locate`, `begin_quantum_position`), the tempo re-read above, and the composite / modulator reconcile. Nothing under `packages/studio/core/src/capture`, nothing in the recording worklet, nothing in `packages/studio/core-wasm/src` except `engine-modules.ts`, `script-bridge.ts` and `script-spielwerk.ts`. Source checkout: `/Users/naomiaro/Code/openDAWOriginal`, pinned at `@opendaw/studio-sdk@0.0.173`; diff a path with `git diff "@opendaw/studio-sdk@0.0.172..@opendaw/studio-sdk@0.0.173" -- <path>`.

## What this branch already provides

Built and checked on 2026-10-01 (branch `debug/one-quantum-event-prep`); nothing here needs redoing.

| piece | where | what it does |
|---|---|---|
| A servable 0.0.172 build | `/Users/naomiaro/Code/opendaw-sdk-override-0.0.172` (outside the repo), built by `node scripts/audit/sdk-override.ts a5bf064 <dir>` | Exact versions from the lockfile at `a5bf064` (main before the upgrade). Its 32 wasm files and the `studio-core` / `studio-adapters` dists are byte-identical to the 0.0.172 install. A `midtimeline-start` cell ran on it: 3 of 3 `aligned`, no page errors |
| SDK version on every envelope | `sdkVersion` (`OPENDAW_SDK_VERSION` of the served build) | Tells two releases with the same surfaces apart. No verdict reads it |
| Stop switch | `&stopLead=off` on the audit page; envelope `stopLead` | Stops every repeat just after the click, as the harness did before the stop lead. Checked: matched beats 16, `stopLeadMs` −3…−27 |
| Engine's recording-start report on every row | `recordingStartContextTimeSec`, `recordingStartPositionPpqn` | Checked against the SDK's arithmetic: `waveformOffsetSec` = recording start − first quantum + output latency − the fraction of a pulse the Int32 region position drops (25.667 − 0.0625 = 25.604 ms) |
| Event tally | `node scripts/audit/recording-alignment/one-quantum-events.ts [--from <run id>]`; logic and tests in `src/lib/audit/oneQuantumEvents.ts` | Repeats and events per SDK and per stop, exact intervals, Fisher's test, each event with its start-of-take figures |
| Loop driver | `scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js` | One URL, `RUNS` times, a fresh page per run |

## Global Constraints

- No file under the repo is edited while a run is going: Vite may reload the page. A run that overlaps an edit is deleted (`rm .verify-output/*<runToken>*`), not quoted.
- One arm per dev-server process. Before starting a server on another build: kill the old one by port (`lsof -ti :5173 | xargs kill`), then `rm -rf node_modules/.vite`. After the last override run, do both again so the next plain `npm run dev` serves the installed SDK.
- A run belongs to the arm its ENVELOPE says: `sdkVersion` and `stopLead`. Never assign a run to an arm from memory of what was served.
- The browser window stays visible and the run is started with a real click (the driver does both; a hidden page freezes the transport and the driver skips the run).
- The test of a difference between arms uses only runs recorded under this plan: `--from <first run id of Task 2>`. The 609 earlier repeats suggested the question and cannot also answer it.
- The comparison scenario is `multitrack-all` at 120 BPM, 48000 Hz: 16 repeats per run (8 `multitrack-start`, 8 `multitrack-janked`), about 130 s, node delays on every row.
- Nothing in the measurement goes through the speakers (the loopback is inside the AudioContext). The system output can be muted for the whole campaign.
- Version numbers go in `debug/` and `changelogs/` only. Chapter docs, demo copy, code comments and CLAUDE.md additions state current behaviour.
- Nothing is posted upstream without the user reading the text first: an issue goes to `debug/drafts/<name>.md` and waits.
- `npm run typecheck` exits 0 before a commit. PRs are squash-merged; this plan file is deleted in the PR that completes the work.

## Review Focus

- **A run recorded on the wrong build.** The override not picked up (stale `node_modules/.vite`, the variable not exported to the server process) gives an arm B that is really arm A. Task 1 checks the served engine binary and the envelope's `sdkVersion`; Task 2 re-reads `sdkVersion` after every block.
- **Reading a difference into too few events.** At the rates seen so far a 400-repeat arm holds between 1 and 6 events. The stopping rule in Task 2 is fixed before the first run; a p-value looked at after every block and acted on at 0.05 is not a test.
- **The first repeat after a cold start.** After `rm -rf node_modules/.vite` the first recording of the first page load can start late (an 84 ms head deficit was measured once). It does not move the netted median and so does not make an event, but it makes the cell `investigate`. Do not count verdicts; count events.
- **An event that is not this event.** The tally flags any repeat whose netted median is more than half a quantum off the run's mode or whose first-frame check is more than half a quantum off zero. Read each flagged repeat's figures before counting it: a row that is off by something other than one quantum is a different finding and gets its own line in the write-up.
- **Editing while measuring.** The write-up is written between blocks only when no run is going; the safest order is all of Task 2, then Task 3.

---

### Task 1: Check the three arms run and say what they are

**Files:** none modified.

**Interfaces:**
- Consumes: the override directory, the driver, the tally script (table above).
- Produces: `FIRST_PLAN_RUN`, the id of the first run recorded under this plan, used by `--from` in Tasks 2 and 3.

- [ ] **Step 1: The branch builds and its tests pass**

Run: `npm run typecheck && npx vitest run src/lib/audit src/hooks`
Expected: typecheck exits 0; every test file passes.

- [ ] **Step 2: The 0.0.172 override is still there and still exact**

Run:
```bash
ls /Users/naomiaro/Code/opendaw-sdk-override-0.0.172/@opendaw | wc -l
grep OPENDAW_SDK_VERSION /Users/naomiaro/Code/opendaw-sdk-override-0.0.172/@opendaw/studio-sdk/dist/version.js
shasum -a 256 /Users/naomiaro/Code/opendaw-sdk-override-0.0.172/@opendaw/studio-core-wasm/dist/wasm/engine.wasm | cut -c1-16
```
Expected: `17`, `"0.0.172"`, `a6b14cd4d4d819fc`. If the directory is gone: `node scripts/audit/sdk-override.ts a5bf064 /Users/naomiaro/Code/opendaw-sdk-override-0.0.172` and check again.

- [ ] **Step 3: Note the baseline tally**

Run: `node scripts/audit/recording-alignment/one-quantum-events.ts`
Expected: `0.0.172: 1 in 416`, `0.0.173: 2 in 193`, three events listed. A different count means `.verify-output/` changed since 2026-10-01; say so in the write-up.

- [ ] **Step 4: One run on the installed SDK (arm A)**

Set `const RUNS = 1;` in `scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js` and leave `QUERY` as `scenario=multitrack-janked&bpm=120&rate=48000`. Then:
```bash
rm -rf node_modules/.vite
npm run dev -- --port 5173 --host 127.0.0.1 --strictPort   # in the background
```
Call the Playwright MCP's `browser_run_code_unsafe` with `filename: "scripts/audit/recording-alignment/one-quantum/run-loop.playwright.js"`.
Expected: `[{ run: 1, state: "done", line: "16 rows — …", stopLeadWarnings: 0 }]`.

Then:
```bash
node -e 'const fs=require("fs");const f=fs.readdirSync(".verify-output").filter(n=>/^recaudit-mt-summary-/.test(n)).sort().pop();const j=JSON.parse(fs.readFileSync(".verify-output/"+f,"utf8"));console.log(f,j.sdkVersion,j.stopLead,j.rows.length,j.rows.filter(r=>typeof r.recordingStartContextTimeSec==="number").length)'
```
Expected: the newest file, `0.0.173 true 16 16`. Write its run id down as `FIRST_PLAN_RUN`.

- [ ] **Step 5: One run on 0.0.172 (arm B)**

```bash
lsof -ti :5173 | xargs kill
rm -rf node_modules/.vite
SDK_DIST_OVERRIDE=/Users/naomiaro/Code/opendaw-sdk-override-0.0.172 npm run dev -- --port 5173 --host 127.0.0.1 --strictPort   # in the background
curl -sk https://localhost:5173/wasm-engine/wasm/engine.wasm | shasum -a 256 | cut -c1-16
```
Expected: `a6b14cd4d4d819fc`. Call the driver again, then the `node -e` line of Step 4.
Expected: `0.0.172 true 16 16`.

- [ ] **Step 6: One run with the stop after the click (arm C), back on the installed SDK**

```bash
lsof -ti :5173 | xargs kill
rm -rf node_modules/.vite
npm run dev -- --port 5173 --host 127.0.0.1 --strictPort   # in the background
```
Set `QUERY` in the driver to `scenario=multitrack-janked&bpm=120&rate=48000&stopLead=off`, call it, run the `node -e` line.
Expected: `0.0.173 false 16 16`. Stop the server (`lsof -ti :5173 | xargs kill`).

- [ ] **Step 7: The tally sees three arms**

Run: `node scripts/audit/recording-alignment/one-quantum-events.ts --from <FIRST_PLAN_RUN>`
Expected: three lines under "Per SDK release and harness stop" — `0.0.172 | stop-lead`, `0.0.173 | stop-after-click`, `0.0.173 | stop-lead` — each with 8 repeats.

### Task 2: Record the arms

**Files:** none modified. Keep a block log in the session (run ids per block and arm); it goes into the register in Task 4.

**Interfaces:**
- Consumes: `FIRST_PLAN_RUN`.
- Produces: per arm, the repeats and the events recorded under this plan.

The three arms, all `scenario=multitrack-all&bpm=120&rate=48000`:

| arm | server | driver `QUERY` |
|---|---|---|
| A | installed (0.0.173) | `scenario=multitrack-all&bpm=120&rate=48000` |
| B | `SDK_DIST_OVERRIDE=/Users/naomiaro/Code/opendaw-sdk-override-0.0.172` | `scenario=multitrack-all&bpm=120&rate=48000` |
| C | installed (0.0.173) | `scenario=multitrack-all&bpm=120&rate=48000&stopLead=off` |

A block is `RUNS = 5`: 80 repeats, about 11 minutes. A round is one block of each arm in the order A, C, B (A and C share a server).

**Stopping rule, fixed now:** record 5 rounds (400 repeats per arm, about 3 hours of recording) unless one of these happens first:

1. After a completed round, one of the tally's Fisher lines is below 0.01 on the plan's own runs: `stop-lead only` (arms A and B, the SDK question) or `on 0.0.173` (arms A and C, the harness question), in either of the two directions each line prints. Then record one more round and stop.
2. A block ends with error rows, or a run is skipped as not visible, twice in a row. Then stop and find out why before recording more.

No other look at the numbers changes how much is recorded.

- [ ] **Step 1: Round 1, arm A**

Set `RUNS = 5` and the arm's `QUERY` in the driver. Start the installed-SDK server as in Task 1 Step 4. Call the driver. It returns after about 11 minutes (the tool reports it as a background task).
Expected: five entries, each `state: "done"`, `line` starting `32 rows`.

- [ ] **Step 2: Round 1, arm C**

Same server. Change `QUERY` to arm C's — this edit is made while no run is going. Call the driver.
Expected: five entries `done`.

- [ ] **Step 3: Round 1, arm B**

Restart the server on the override as in Task 1 Step 5, including the `curl … | shasum` check. Set `QUERY` back to arm B's (the same as arm A's). Call the driver.
Expected: five entries `done`.

- [ ] **Step 4: Check the round**

```bash
node scripts/audit/recording-alignment/one-quantum-events.ts --from <FIRST_PLAN_RUN>
```
Expected: each arm's repeat count grew by 80 (plus Task 1's 8). Confirm no block landed in the wrong arm. Read each event's lines. Apply the stopping rule.

- [ ] **Step 5: Rounds 2 to 5**

Repeat Steps 1 to 4. After the last arm-B block: `lsof -ti :5173 | xargs kill && rm -rf node_modules/.vite`.

### Task 3: Read the events

**Files:**
- Create: `.verify-output/one-quantum-events-<date>.txt` (the tally's full output, kept beside the artifacts like the other scripts' oracles)

**Interfaces:**
- Consumes: the runs of Task 2.
- Produces: per event, which stamp is off and whether the take is misplaced; per arm, a rate with its interval.

- [ ] **Step 1: Save the tally**

```bash
node scripts/audit/recording-alignment/one-quantum-events.ts --from <FIRST_PLAN_RUN> > .verify-output/one-quantum-events-$(date +%F).txt
node scripts/audit/recording-alignment/one-quantum-events.ts > .verify-output/one-quantum-events-all-$(date +%F).txt
```

- [ ] **Step 2: Classify every event of the plan's runs**

For each event the tally prints, per tape: netted median, first-frame check, node delay, "adjusted − node delay", loopback delay, region position, waveform offset, "recording start − first quantum" in quanta, recording-start position. Fill one row per event:

| question | read it from | answer means |
|---|---|---|
| Is the engine's stamp early? | netted median one quantum above the mode | yes: the recording-start `contextTime` is a quantum before the engine's audio |
| Is the worklet's stamp early? | first-frame check −2.667 | yes: `firstQuantumTime` is a quantum before the buffer's first frame |
| Is the take misplaced? | "adjusted − node delay" against the run's usual 1.4375 ms | one quantum off (4.1042): yes |
| Is the recording-start position the usual one? | "recording-start position" against the other rows of the run (5.120 at 120 BPM from a stopped start) | a different value says the report came from a different quantum than usual, not only with a different time |
| Is recording start − first quantum a whole number of quanta, and which? | that figure, against the run's other rows (1.000 and 2.000 are usual) | a value the run's other rows never show points at the order in which the two processors first ran |

- [ ] **Step 3: Compare the arms**

From the saved tally: repeats, events, rate and interval per arm; the Fisher line `stop-lead only` (arms A and B, the SDK question) and the line `on 0.0.173` (arms A and C, the harness question), each in the direction the counts point. State the result as one of:

- "a difference": p < 0.01 under the stopping rule;
- "no difference seen at this size": otherwise, with the two intervals and the largest ratio of rates they still allow.

Split the events by scenario (`multitrack-start` against `multitrack-janked`) in the same way: it says whether holding the main thread for 150 ms at the recording flip matters.

### Task 4: Follow the mechanism, as far as the events allow

Only if Task 3 has at least three events that carry `recordingStartContextTimeSec`. Otherwise skip to Task 5 and say the mechanism is still open.

**Files:** read-only in `/Users/naomiaro/Code/openDAWOriginal`:
- `packages/studio/core-wasm/src/processor.ts` and `packages/studio/core-wasm/src/recording-start-edge.ts` — where the engine's report is stamped (`currentTime + 128 / sampleRate` on the first render that sees the recording flag).
- `packages/studio/core-processors/src/RecordingProcessor.ts` — where the recording worklet stamps its first quantum.
- `packages/studio/core/src/capture/RecordAudio.ts` — the placement (`startOffset = contextTime − firstQuantumTime + outputLatency + inputLatency`, position floored).
- `packages/studio/core/src/EngineWorklet.ts` — the generation counter that drops a stale report.
- `crates/engine/src/lib.rs` (`render`, `prepare_recording_state`, `set_position`, `begin_quantum_position`, `transact`) — what the engine does in the quanta around a recording start.

- [ ] **Step 1: Say what the events have in common**

From Task 3's table: same stamp off every time or not; same "recording start − first quantum"; same node delay; first repeat after a tempo change or after a server start; which scenario. Write the common part down in one paragraph before reading any source.

- [ ] **Step 2: Read the two stamping sites against that paragraph**

For each site, answer in writing: which clock value is read, in which callback, and what would have to happen for that value to be one quantum behind the audio of the same callback. Check each candidate against the events: a candidate that predicts a different "recording-start position" or a different "recording start − first quantum" than the events show is out.

- [ ] **Step 3: If the SDK arms differ, bisect the engine changes by reading**

`git diff "@opendaw/studio-sdk@0.0.172..@opendaw/studio-sdk@0.0.173" -- crates/engine/src/lib.rs` and judge the three candidates named under "What is known" against Step 2. A change that cannot run between `set_position(0)` settling and the first recorded quantum is out.

- [ ] **Step 4: Decide whether a repro page is possible**

A repro page needs the event on demand, or at least at a rate a page can show in a minute. If Step 2 names a condition that can be forced (a tempo write just before the start, a start within a given number of quanta of a locate), try it on a scratch copy of the audit page with `?scenario=multitrack-janked` and count. Twenty forced repeats with at least five events is a repro; anything less is not.

### Task 5: Write it up

**Files:**
- Modify: `debug/recording-start-alignment-audit.md` (append a section)
- Modify: `debug/README.md` (the register's index line)
- Modify: `src/demos/recording/CLAUDE.md` (only if a rule for reading runs changed)
- Create, only with a repro: `debug/drafts/issue-recording-start-one-quantum.md`
- Delete: `docs/superpowers/plans/2026-10-01-one-quantum-event.md` (this file, in the PR that completes the work)

- [ ] **Step 1: Append the register section**

Title: `## The one-quantum event, counted on two releases (<date>)`. Contents, in this order: what was run (arms, block log with run ids, total repeats per arm); the tally table as the script printed it; the per-event table of Task 3 Step 2; the comparison of Task 3 Step 3 in the words fixed there; what Task 4 found, with what is ruled out and what is not; a "Reading" list in the register's style — what is established, what is open, what is not established.

- [ ] **Step 2: Update the index and the memory**

`debug/README.md`: prepend the new section's one-line result to the register's entry. Memory: update `project_first_frame_quantum_anomaly.md` and its line in `MEMORY.md` with the counts, the result and what is left.

- [ ] **Step 3: Only with a repro — draft the issue**

`debug/drafts/issue-recording-start-one-quantum.md`: the symptom, the measured signature, the repro page's URL, the link to the register section. Describe the cause precisely where it is known; no suggested fix. Stop and ask the user to read it. Do not post.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npx vitest run
git add -A && git commit -m "docs(debug): the one-quantum event counted on 0.0.172 and 0.0.173"
```
Expected: typecheck 0, all tests pass. Push and open the PR only when the user asks.
