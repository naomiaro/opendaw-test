# Demo Audit Wave 5 — Recording + MIDI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the three capture demos (recording-api-react, loop-recording, midi-recording) against tag-pinned openDAW source, fix what's wrong, apply the mastering-console editorial design, and correct the two category CLAUDE.mds + doc chapters they exercise — one PR on branch `demo-audit-wave-5-recording-midi`.

**Architecture:** Same machinery as waves 1–4: Task 1 produces a findings working file from tag-pinned source reads (`git show` only, never working-tree files in the upstream checkout) and settles the browser-verification approach for permission-gated pages; per-demo tasks consume those findings (audit fixes first, then restyle as a separate commit so correctness diffs stay reviewable); close-out graduates durable findings to CLAUDE.mds/docs, deletes the working file, and runs wave-integration reviews before the PR.

**Tech Stack:** React + Vite + `@opendaw/studio-sdk@0.0.154` (sub-packages: studio-adapters@0.0.116, studio-core@0.0.152, studio-boxes@0.0.94, studio-enums@0.0.77, lib-dsp@0.0.84, lib-std@0.0.78, lib-box@0.0.86, lib-dom@0.0.83). Upstream checkout for source reads: `/Users/naomiaro/Code/openDAW/` (tag names `@opendaw/<pkg>@<version>`). Design language: `docs/design/2026-06-11-mastering-console-editorial.md`; cleanest page sibling `src/demos/automation/tempo-automation-demo.tsx`; panel restraint reference `src/components/InputLatencyPanel.tsx`; canvas palette `CANVAS_COLORS`/`CANVAS_FONT*` from `src/lib/design/consoleTheme.ts`.

**Campaign rules that bind every task** (from `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md`):
- Source verification is tag-pinned `git show` only — run `git fetch --tags` in `/Users/naomiaro/Code/openDAW/` once, first.
- Restyle = chrome only. Controls, hooks, and box-graph logic do not change in restyle commits.
- One implementer subagent at a time; two-stage review per task (spec compliance, then code quality); two wave-integration review rounds + comprehensive PR review before merge.
- No silent failures: every error path reaches the UI (error card / status), never `console.warn`-only.
- audio-verify: required only if a task touches `src/lib/beats/`, warp scenarios, or shared audio paths. This wave touches recording hooks/components, not those paths — the close-out states the skip justification explicitly.
- Findings working file is compaction insurance — write findings as you go, not at the end. Tag every finding with its consumer task in brackets (`[Task 4]`) and a greppable verdict token (`CONFIRMED | NUANCED | WRONG`) — Task 8 graduates by grep; untagged findings get orphaned.

**Wave-5 specifics that differ from wave 4:**
- Three demos share recording infrastructure (`useRecordingSession`, `useRecordingTapes`, `useAudioDevicePermission`, `RecordingTapeCard`, `RecordingPreferences`, `TakeTimeline`). Grep confirmed no demo outside this wave imports any of them — restyle blast radius is contained, but a shared-module fix lands once and is re-verified on every consuming page.
- All three demo files exceed the 800-line cap (1062 / 860 / 822) — each restyle task carries a named extraction.
- Pages are permission-gated (mic, MIDI). Task 1 settles the automation approach before any browser-verification step assumes one.

---

## File Map

| File | Role in this wave |
| --- | --- |
| `docs/superpowers/plans/2026-06-11-wave5-audit-findings.md` | Create in Task 1, append throughout, **delete in Task 8** (graduate durable bits first) |
| `src/demos/recording/recording-api-react-demo.tsx` (860) | Audit fixes (Task 2) + restyle/extraction (Task 3) |
| `src/demos/recording/loop-recording-demo.tsx` (1062) | Audit fixes (Task 4) + restyle/extraction (Task 5) |
| `src/demos/midi/midi-recording-demo.tsx` (822) | Audit fixes (Task 6) + restyle/extraction (Task 7) |
| `src/hooks/useRecordingSession.ts` | Error/timeout surface fix (Task 2 — shared by both recording demos) |
| `src/hooks/useRecordingTapes.ts`, `src/hooks/useAudioDevicePermission.ts` | Audit only; fixes land in the first task that needs them (Task 2) |
| `src/components/RecordingTapeCard.tsx`, `src/components/RecordingPreferences.tsx` | Restyle in Task 3 (instrument-panel restraint), re-verified in Tasks 5/7 |
| `src/components/TakeTimeline.tsx` | Canvas palette restyle in Task 5 (only consumer is loop-recording) |
| `src/demos/recording/CLAUDE.md`, `src/demos/midi/CLAUDE.md` | Corrections in Task 8 (directive style) |
| `documentation/08-recording.md`, `documentation/16-midi.md` | Only claims the demos exercise; fix factual errors found in Task 1 |
| `public/og-image-recording.png`, `public/og-image-loop-recording.png`, `public/og-image-midi-recording.png` | Regenerate after each restyle (1200×630) |
| `recording-api-react-demo.html`, `loop-recording-demo.html`, `midi-recording-demo.html` | Font links (`crossorigin` on preconnect AND stylesheet) during restyles |

---

### Task 1: Tag-pinned source audit → findings working file + verification spike

**Files:**
- Create: `docs/superpowers/plans/2026-06-11-wave5-audit-findings.md`
- Read-only: the three demo `.tsx` files, the shared hooks/components above, both category CLAUDE.mds, upstream checkout via `git show`

- [ ] **Step 1: Fetch tags in the upstream checkout**

Run: `git -C /Users/naomiaro/Code/openDAW fetch --tags`
Expected: exits 0.

- [ ] **Step 2: Create the findings file with the recording-behavior claim inventory**

One section per claim, each ending in a verdict line `CONFIRMED | NUANCED (corrected wording) | WRONG (fix)` plus source citation (`<tag>:<path>:<line>`) and consumer tag.

**Recording claims (recording CLAUDE.md + demos):**

1. **[Task 8 — carry-over from wave 3] BlockFlag.discontinuous loop-wrap crossfade** — CLAUDE.md:251-256 claims: at loop wrap the engine sets `BlockFlag.discontinuous`; old voices fade out over `VOICE_FADE_DURATION = 0.020s`; fade-in applies when the read offset is non-zero; fade-out starts from the current amplitude. Search `studio-core@0.0.152` + `studio-adapters@0.0.116` for `VOICE_FADE_DURATION` and `discontinuous` (`git -C /Users/naomiaro/Code/openDAW grep -n "VOICE_FADE_DURATION" "@opendaw/studio-core@0.0.152" -- packages/`). Verify each sub-claim separately — who sets the flag, who consumes it, the exact fade trigger conditions. Cross-check the memory note that the 20ms fade can double with user fades (`debug/` convention if a new mystery emerges).
2. **[Task 2/4] `stop(true)` vs `stopRecording()` semantics** — CLAUDE.md:8-12,111-118: `stop(true)` during finalization kills the audio graph and prevents the RecordingProcessor from flushing; position reset triggers spurious loop-wrap muting; OpenDAW's own transport never calls `stop(true)` after `stopRecording()`. Read the engine facade + recording teardown in `studio-core@0.0.152`.
3. **[Task 4] Takes mechanism** — CLAUDE.md:69-88: takes require `allowTakes && loopArea.enabled`; wrap detection is `currentPosition < lastPosition` → `startNewTake(loopFrom)`; take 1 records from start through first wrap; `olderTakeAction` ∈ {"mute-region","disable-track"}, `olderTakeScope` ∈ {"previous-only","all"}; `allowTakes` default true since 0.0.109. Read `RecordAudio.ts` (or successor) at `studio-core@0.0.152`.
4. **[Task 4] waveformOffset accumulation + playback read formula** — CLAUDE.md:231-260: buffer layout (count-in | take 1 | take 2 …), take 1 offset = countIn + outputLatency + workletHeadStart, set once and never modified; duration overshoot ≈ one audio block; `TapeDeviceProcessor.ts` formula `sampleIndex = ((elapsedSeconds + waveformOffset) * sampleRate) | 0` with `elapsedSeconds = tempoMap.intervalToSeconds(cycle.rawStart, cycle.resultStart)`.
5. **[Task 2] PeaksWriter discrimination** — `"dataIndex" in peaks`; `dataIndex[0] * unitsEachPeak()` = total accumulated frames across ALL takes; final peaks expose `numFrames`; the SDK updates `regionBox.duration` every frame during recording. Locate `PeaksWriter`/`Peaks` types (lib-fusion or studio-core) and the per-frame duration write.
6. **[Task 2] Capture field taxonomy** — `captureBox.deviceId`/`gainDb`/`inputLatency` are box fields; `capture.requestChannels` setter writes an Int32Field; `capture.armed` is a `MutableObservableValue<boolean>` NOT a box field; `monitoringMode` manipulates Web Audio nodes only. Check `CaptureAudioBox` schema at `studio-boxes@0.0.94` (upstream: `packages/studio/forge-boxes/src/schema/`) + `CaptureAudio` at `studio-core@0.0.152`.
7. **[Task 2] Monitor signal chain (0.0.133+)** — CLAUDE.md:95-109: `monitorVolumeDb`/`monitorPan`/`monitorMuted` direct setters; `setMonitorOutputDevice(Option<string>)` routes via `HTMLAudioElement.setSinkId()` + `MediaStreamAudioDestinationNode`; "effects" mode routes through the engine then back through monitor nodes; chain order `sourceNode → monitorGain → monitorPan → destination`.
8. **[Task 2/6] Arming semantics** — `setArm(capture, exclusive)` exclusive=true disarms others; `filterArmed()`; `startRecording()` records all armed captures; `startRecording()` auto-creates a Tape when no instruments exist (midi CLAUDE.md:31). Read `CaptureDevices` + the recording bootstrap at `studio-core@0.0.152`.
9. **[Task 4] SampleLoader contract** — subscribe-only (no catchupAndSubscribe); synchronous callback + `Terminable.Empty` return for terminal states; `state.type` union; error field is `state.reason`; `queryLoadingComplete()` resolves before `sampleLoader.data` is set (CLAUDE.md:271).
10. **[Task 2/4] Take labels** — regions labeled `"Take N"` (0.0.91+) or `"Recording"` — confirm the label format string at 0.0.152 (the demos string-match on it).
11. **[Task 4] Take-to-track matching chain** — `regionBox.regions.targetVertex` → TrackBox → `trackBox.tracks.targetVertex` → AudioUnitBox (CLAUDE.md:226-229) — confirm pointer names in the box schema.

**MIDI claims (midi CLAUDE.md + demo):**

12. **[Task 6] MidiDevices API surface** — `canRequestMidiAccess()`, `requestPermission()`, `inputDevices()` (includes the software input), `softwareMIDIInput.sendNoteOn(note, velocity /* 0-1 */)` / `sendNoteOff(note)`, `subscribeMessageEvents(callback, channel?)` at `studio-core@0.0.152`.
13. **[Task 6] CaptureMidi has no implicit arming** — compare `CaptureAudio` vs `CaptureMidi` arming paths; confirm un-armed CaptureMidi neither monitors nor records (midi CLAUDE.md:19-24).
14. **[Task 6] NoteEventBox creation** — demo creates events manually (`NoteEventBox.create` + `box.events.refer(collection.events)` + field setValues, midi-recording-demo.tsx:292-297) while the CLAUDE.md prescribes the adapter-layer `collection.createEvent({...})`. Verify the field set (position, duration, pitch int 0-127, velocity float 0-1, cent, chance 0-100, playCount), Int32 vs Float32 typing per the schema, the pointer direction, and whether `createEvent` makes the manual path obsolete — verdict decides whether Task 6 migrates the demo.
15. **[Task 6/8] Note event deletion** — midi CLAUDE.md:81,103 prescribes `boxGraph.unstageBox(adapter.box)`. Wave 4 found curve events own a mandatory dependent box, making bare `unstageBox` WRONG there. Check the `NoteEventBox` schema for mandatory dependents — if any exist, the deletion idiom must become `box.delete()`.
16. **[Task 8] NoteRegionBoxAdapter / NoteEventCollectionBoxAdapter / NoteEventBoxAdapter API sweep** — midi CLAUDE.md:41-103: every listed member confirmed at `studio-adapters@0.0.116` (mechanical; record only deviations).
17. **[Task 8] CaptureMidiBox.channel** — `-1` = all channels, `0-15` specific; field type in the schema.
18. **[Task 8] MIDI effect + instrument adapter lists** — the five MIDI effects and seven instrument adapters exist by those names; `project.api.insertEffect(...)` signature matches midi CLAUDE.md:114.
19. **[Task 6] Step-recording traversal** — demo does `region.box as NoteRegionBox` then `noteBox.events.targetVertex.unwrap().box as NoteEventCollectionBox` (midi-recording-demo.tsx:236-240). Root CLAUDE.md says adapter `.box` is already typed and `optCollection` exists — confirm the cast-free adapter path (`region.optCollection.unwrap().events`/`.createEvent`) and verdict whether Task 6 rewrites it.

**API-surface sweep (mechanical):** the remaining recording CLAUDE.md blocks — `AudioDevices` (requestPermission/updateInputList/inputs), recording preferences paths (`recording.allowTakes`/`olderTakeAction`/`olderTakeScope`/`countInBars` 1-8), monitoring-peaks lifecycle (lines 279-302), region-discovery idioms (lines 139-167) — each listed member exists with that signature at the pinned tags. Record only deviations.

**Changelog sweep:** read `changelogs/` entries newer than these demos for recording/MIDI-relevant additions (newer capture helpers, peaks APIs, MIDI adapter conveniences). List candidates as improvements, not mandates.

- [ ] **Step 3: Audit the doc chapters' exercised claims**

In `documentation/08-recording.md` and `documentation/16-midi.md`, locate the sections covering: start/stop semantics, takes + loop area, waveformOffset/buffer layout, capture device config, monitoring, finalization barriers, MidiDevices, note-event creation/deletion. Check only claims the three demos exercise against the Step-2 verdicts. Append a "doc corrections" section (file, line, wrong claim, correction). Out of scope: prose quality, untouched sections.

- [ ] **Step 4: Record the known code-level issues as findings (verify, don't assume)**

- loop-recording finalization barrier handles only `state.type === "loaded"` (loop-recording-demo.tsx:480-495) — violates recording CLAUDE.md:127-128 (must handle `"error"` too; an errored loader blocks the barrier until the 10s timeout). `[Task 4]`
- `useRecordingSession` finalization timeout (30s) and loader-error paths are console-only — UI stays on "Processing…" forever. Needs an error surface consumed by both recording demos. `[Task 2]`
- Init error handling per demo: confirm each `initializeOpenDAW` path has `.catch` → visible UI error (wave-4 red Callout idiom), not just status text or nothing. `[Tasks 2/4/6]`
- loop-recording: peaks/adapter subscriptions collected in refs — confirm tape-removal mid-recording terminates them (suspected leak). `[Task 4]`
- midi-recording: `let audioUnitBox: any = null` (midi-recording-demo.tsx:439) — type it (`AudioUnitBox | null`). `[Task 6]`
- `RecordingTapeCard.setMonitorOutputDevice` failure reverts to default with `console.debug` only (RecordingTapeCard.tsx:161-166) — classify: the select reverting IS user-visible feedback; decide whether a status line is still required by the error bar. `[Task 2]`
- mute-subscription callback typed `(obs: any)` (loop-recording-demo.tsx:367). `[Task 4]`
- All three demos exceed 800 lines — extraction seams: recording-api (peaks state + waveform canvas → hook/component), loop-recording (take discovery → hook), midi (PianoKeyboard + StepRecordingSection already isolated inline → own files). `[Tasks 3/5/7]`

- [ ] **Step 5: Verification spike — settle the browser-automation approach**

The recording pages need `getUserMedia`; the MIDI page needs Web MIDI only for its hardware path (the software keyboard path needs no permission). Decide and record in the findings file:

1. Can the Playwright MCP browser grant mic permission / use fake media (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`)? Try: load `https://localhost:5180/recording-api-react-demo.html`, click "Request Microphone Permission", observe. (Start the dev server first: `npm run dev -- --port 5180 --host 127.0.0.1`, background.)
2. If fake media works: record-stop-play E2E is automatable — write the exact steps the per-demo tasks will reuse.
3. If not: per-demo tasks verify everything up to the permission gate (init, UI, console cleanliness, design checks) via Playwright, and the record→finalize→playback paths are listed for **user manual verification** in the close-out — flagged in the PR, never silently skipped.
4. MIDI page: the software-keyboard + step-recording paths must be verified headlessly regardless (no permission needed). Record whether `MidiDevices.requestPermission()` can also be exercised (Chromium grants Web MIDI without SysEx silently in some configs).

- [ ] **Step 6: Commit the findings file**

```bash
git add docs/superpowers/plans/2026-06-11-wave5-audit-findings.md
git commit -m "docs: wave-5 recording+midi audit findings (working file)"
```

---

### Task 2: recording-api-react + shared hooks — audit fixes

**Files:**
- Modify: `src/demos/recording/recording-api-react-demo.tsx`, `src/hooks/useRecordingSession.ts`, possibly `src/hooks/useRecordingTapes.ts`, `src/components/RecordingTapeCard.tsx`
- Read: findings file (Task 1 verdicts drive every step)

- [ ] **Step 1: Surface `useRecordingSession` failures.** Extend the hook's return with an error slot so both consuming demos can render it:

```ts
// useRecordingSession.ts — add alongside existing state
const [error, setError] = useState<string | null>(null);

// loader subscribe callback: on state.type === "error"
setError(`Recording finalization failed: ${state.reason ?? "unknown"}`);
// count the errored loader toward the barrier so it still completes

// timeout path (replace console.warn-only):
setError("Finalization timed out after 30s — engine reset");

// expose: return { state, countInBeatsRemaining, error, clearError, registerLoader, resetLoaders }
```

`clearError` resets the slot when a new recording starts. In recording-api-react-demo, render `error` as a red Callout (wave-4 idiom; pre-restyle Radix Callout is fine — Task 3 styles it). Errored loaders must count toward the finalization barrier (per CLAUDE.md:127-128) so the state machine reaches "ready".

- [ ] **Step 2: Verify init error handling** meets the bar (`.catch` → visible error card + `cancelled` guard). If the existing try/catch only sets status text that gets hidden once panels render, route it to the same error slot.

- [ ] **Step 3: Apply the Task-1 verdicts tagged `[Task 2]`** — capture field taxonomy deviations, monitor-chain corrections, PeaksWriter discrimination changes, take-label format fixes, the `setMonitorOutputDevice` classification outcome. Skip items whose verdict is CONFIRMED (note them for Task 8).

- [ ] **Step 4: Verify in browser** — per the Task-1 spike decision: full record→stop→play E2E with fake media, or up-to-permission-gate checks with the rest queued for manual verification. Either way: page loads, tape add/remove works, preferences toggle, console clean (`document.body.innerText.includes(...)` for text assertions).

- [ ] **Step 5: Run checks** — `npx tsc --noEmit --ignoreDeprecations "6.0"` (zero new errors vs parent), `npm test` (all pass; no `.claude/worktrees` inflation).

- [ ] **Step 6: Commit**

```bash
git add src/demos/recording/recording-api-react-demo.tsx src/hooks/ src/components/
git commit -m "fix: recording-api audit — finalization error surface + source-verified corrections"
```

(Adjust message to the actual findings applied.)

- [ ] **Step 7: Two-stage review** — spec compliance (every `[Task 2]` finding landed; nothing else changed), then code quality. Fix findings before Task 3.

---

### Task 3: recording-api-react — restyle + extraction + og-image

**Files:**
- Modify: `src/demos/recording/recording-api-react-demo.tsx`, `recording-api-react-demo.html`, `src/components/RecordingTapeCard.tsx`, `src/components/RecordingPreferences.tsx`, `public/og-image-recording.png`
- Possibly create: `src/demos/recording/useTapePeaks.ts` or `src/demos/recording/TapeWaveform.tsx` (extraction)

- [ ] **Step 1: Read the design doc + references** — `docs/design/2026-06-11-mastering-console-editorial.md` in full; `src/demos/automation/tempo-automation-demo.tsx` for the page idiom; `src/components/InputLatencyPanel.tsx` for instrument-panel restraint (the tape cards are panels, not editorial chrome).

- [ ] **Step 2: Apply the design language — chrome only.** Page header, section labels, explanation copy, buttons to console tokens; IBM Plex Mono display with `crossorigin` on BOTH preconnect and stylesheet links; micro-labels ≥10px at ≥4.5:1; `:focus-visible` on every interactive element; `prefers-reduced-motion` guards. `RecordingTapeCard` + `RecordingPreferences` move to instrument-panel styling (these serve loop-recording too — keep them theme-neutral, no page-specific styling). The live waveform canvases are this page's ONE signature element — move `#000`/`#4a9eff` hardcodes to `CANVAS_COLORS`, drawing logic unchanged. **Do not touch:** recording flow, hooks wiring, peaks math.

- [ ] **Step 3: Extraction** — the file is 860 lines pre-restyle. Extract the peaks-monitoring state + canvas rendering (lines ~44-300) to `src/demos/recording/useTapePeaks.ts` (hook) or `TapeWaveform.tsx` (component) — pure move, no logic change, demo under 800 lines after.

- [ ] **Step 4: Verify in browser** — Task-2 pass plus: mobile 390px per-element clipping (`el.scrollWidth > el.clientWidth`), keyboard-only tab pass shows focus rings, fonts load under COOP/COEP, console clean.

- [ ] **Step 5: Regenerate og-image** — 1200×630 screenshot (omit `filename`; move from `.playwright-mcp/` to `public/og-image-recording.png`).

- [ ] **Step 6: Commit**

```bash
git add src/demos/recording/ src/components/ recording-api-react-demo.html public/og-image-recording.png
git commit -m "feat: recording-api — mastering-console editorial restyle + extraction + og-image"
```

- [ ] **Step 7: Two-stage review** — spec: design conformance + zero behavior diff (`git diff HEAD~1 -- src/` chrome/move only); then quality. Fix findings.

---

### Task 4: loop-recording — audit fixes

**Files:**
- Modify: `src/demos/recording/loop-recording-demo.tsx`

- [ ] **Step 1: Fix the finalization barrier** to handle `"error"` (loop-recording-demo.tsx:480-495):

```tsx
const sub = loader.subscribe((state: SampleLoaderState) => {
  if (state.type !== "loaded" && state.type !== "error") return;
  if (state.type === "error") {
    setFinalizationError(`A take failed to finalize: ${state.reason ?? "unknown"}`);
  }
  finalized++;
  if (finalized === total) {
    clearTimeout(timeoutId);
    project.engine.stop(true);
    // existing post-barrier state transitions
  }
});
```

Apply the pre-check pattern first (read `loader.state` synchronously; terminal states handled without subscribing — TDZ rule). The 10s timeout also surfaces to the UI (`setFinalizationError("Finalization timed out — engine reset")`), not just `console.warn`. Render the error as a red Callout, cleared on next record start.

- [ ] **Step 2: Verify init error handling** — same bar as Task 2 Step 2.

- [ ] **Step 3: Fix the subscription leak** if the Task-1 verdict confirms it — take adapter/mute/peaks subscriptions terminated when a tape is removed mid-session, not only on unmount.

- [ ] **Step 4: Apply remaining `[Task 4]` verdicts** — takes-mechanism deviations, waveformOffset/duration-overshoot corrections (these mostly land in CLAUDE.md via Task 8, but any demo-side rendering math the verdicts contradict gets fixed here), `(obs: any)` → typed mute callback.

- [ ] **Step 5: Verify in browser** — per the Task-1 spike decision: with fake media, run lead-in + 2-loop take recording, confirm takes appear in TakeTimeline, toggle mute on an older take, play back; otherwise verify up to the permission gate + preferences/loop-config UI, queue the rest for manual verification. Console clean.

- [ ] **Step 6: Run checks** — `npx tsc --noEmit --ignoreDeprecations "6.0"`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add src/demos/recording/loop-recording-demo.tsx
git commit -m "fix: loop-recording audit — error-aware finalization barrier, subscription cleanup"
```

- [ ] **Step 8: Two-stage review**, fix findings before Task 5.

---

### Task 5: loop-recording — restyle + extraction + og-image

**Files:**
- Modify: `src/demos/recording/loop-recording-demo.tsx`, `loop-recording-demo.html`, `src/components/TakeTimeline.tsx`, `public/og-image-loop-recording.png`
- Possibly create: `src/demos/recording/useTakeDiscovery.ts` (extraction)

- [ ] **Step 1–6:** Same procedure as Task 3 (design doc → chrome-only restyle → extraction → browser + mobile + focus verification → og-image → commit → two-stage review). Page specifics: the TakeTimeline lanes canvas is this page's ONE signature element — `#1a1a2e`/`#0a0a1a`/`#555577`/`#f59e0b` hardcodes move to `CANVAS_COLORS` (muted-vs-live distinction follows the data-canvas tier rule: line weight/value by meaning, amber for the live take only); bar ruler `var(--gray-6)`/`var(--amber-9)` to console tokens. `RecordingTapeCard`/`RecordingPreferences` arrive already restyled from Task 3 — verify them in situ, do not fork their styling. Extraction: take-discovery logic (lines ~235-400) → `src/demos/recording/useTakeDiscovery.ts`, file under 800 after. Commit:

```bash
git add src/demos/recording/ src/components/TakeTimeline.tsx loop-recording-demo.html public/og-image-loop-recording.png
git commit -m "feat: loop-recording — mastering-console editorial restyle + extraction + og-image"
```

---

### Task 6: midi-recording — audit fixes

**Files:**
- Modify: `src/demos/midi/midi-recording-demo.tsx`

- [ ] **Step 1: Verify init + MIDI-permission error handling** — `initializeOpenDAW` failure → error card (same bar as Task 2 Step 2); `MidiDevices.requestPermission()` denial already has a UI path? If console-only, surface it (the software keyboard keeps working — say so in the message).

- [ ] **Step 2: Apply the note-event verdicts** — per Task 1 items 14/15/19:
  - If `collection.createEvent({...})` supersedes manual `NoteEventBox.create` → migrate step recording to the adapter path and drop the `as NoteRegionBox` / `as NoteEventCollectionBox` casts via `region.optCollection`.
  - If `NoteEventBox` has mandatory dependents → deletion switches to `box.delete()` (and Task 8 fixes both CLAUDE.md prescriptions).
  - Type `audioUnitBox` (`AudioUnitBox | null`, drop the `any`).

- [ ] **Step 3: Apply remaining `[Task 6]` verdicts** — MidiDevices surface deviations, arming-path corrections, velocity/pitch typing fixes.

- [ ] **Step 4: Verify in browser** — headless-safe path regardless of spike outcome: software keyboard plays notes (synth audible state changes), step recording inserts events, record via software keyboard → stop → playback. Hardware-MIDI path per the spike decision. Console clean.

- [ ] **Step 5: Run checks** — `npx tsc --noEmit --ignoreDeprecations "6.0"`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/demos/midi/midi-recording-demo.tsx
git commit -m "fix: midi-recording audit — adapter-path note events, typed boxes, error surfaces"
```

- [ ] **Step 7: Two-stage review**, fix findings before Task 7.

---

### Task 7: midi-recording — restyle + extraction + og-image

**Files:**
- Modify: `src/demos/midi/midi-recording-demo.tsx`, `midi-recording-demo.html`, `public/og-image-midi-recording.png`
- Possibly create: `src/demos/midi/PianoKeyboard.tsx`, `src/demos/midi/StepRecordingSection.tsx` (extraction)

- [ ] **Step 1–6:** Same procedure as Task 3. Page specifics: the piano keyboard is this page's ONE signature element — `#6366f1`/`#818cf8`/`#f0f0f0`/`#333`/`#999` hardcodes move to console tokens (pressed-key state must stay ≥3:1 against unpressed; keyboard is interactive — `:focus-visible` per key if keys are focusable, and `prefers-reduced-motion` on any press animation). Extraction: `PianoKeyboard` (lines ~65-161) and `StepRecordingSection` (lines ~194-390) to sibling files — pure moves, demo under 800 after. Commit:

```bash
git add src/demos/midi/ midi-recording-demo.html public/og-image-midi-recording.png
git commit -m "feat: midi-recording — mastering-console editorial restyle + extraction + og-image"
```

---

### Task 8: CLAUDE.md + doc corrections, delete working file

**Files:**
- Modify: `src/demos/recording/CLAUDE.md`, `src/demos/midi/CLAUDE.md`, `documentation/08-recording.md`, `documentation/16-midi.md` (only lines with verdicts), root `CLAUDE.md` (only if a finding contradicts it)
- Delete: `docs/superpowers/plans/2026-06-11-wave5-audit-findings.md`

- [ ] **Step 1: Grep the findings file for every `WRONG`/`NUANCED` token** and apply each to the owning CLAUDE.md. Directive style: no "discovered during the wave-5 audit", no "note that" — state the rule, show the signature. New durable knowledge (the BlockFlag.discontinuous verdict, the note-event deletion verdict, the createEvent-vs-manual verdict) gets added the same way. If new shared hooks/files were extracted (Tasks 3/5/7), update the Reference Files sections.

- [ ] **Step 2: Apply the doc-corrections section** to doc08/doc16 — factual fixes only, present tense, no audit narration.

- [ ] **Step 3: Confirm nothing durable remains** in the findings file (every verdict landed in code, CLAUDE.md, or docs), then:

```bash
git rm docs/superpowers/plans/2026-06-11-wave5-audit-findings.md
git add src/demos/recording/CLAUDE.md src/demos/midi/CLAUDE.md documentation/ CLAUDE.md
git commit -m "docs: recording+midi CLAUDE.md and doc08/doc16 corrections from wave-5 source audit"
```

- [ ] **Step 4: Two-stage review** — spec: every findings-file verdict accounted for; quality: directive style, no stale claims left.

---

### Task 9: Close-out — integration reviews, full verification, PR

- [ ] **Step 1: Wave-integration review round 1** — reviewer over `git diff main...HEAD`: cross-demo consistency (same error-surface shape, same panel idiom, shared-code opportunities missed between the two recording demos), CLAUDE.mds/demos agreement, leftover debug code. Fix everything found.

- [ ] **Step 2: Wave-integration review round 2** — fresh reviewer, same scope, on the fixed tree. Fix remaining findings.

- [ ] **Step 3: Full verification suite**

```bash
npm test                                       # all pass; no .claude/worktrees inflation
npm run build                                  # Vite + VitePress green
npx tsc --noEmit --ignoreDeprecations "6.0"    # zero NEW errors vs main
```

Browser-verify all three pages once more on the final tree. audio-verify: **skipped** — no `src/lib/beats/`, warp-scenario, or shared-audio-path changes this wave; state this in the PR. If the Task-1 spike left manual-verification items, list them in the PR and ask the user to run them before merge.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin demo-audit-wave-5-recording-midi
gh pr create --title "feat: demo audit wave 5 — recording + midi (source-verified, console design applied)" --body "<wave-4-shaped body>"
```

PR body mirrors PR #74's shape: per-demo checklist results (campaign spec's 7 items), audit-results table (confirmed/nuanced/wrong), design section, verification section (audio-verify skip justification + any manual-verification asks), follow-ups list.

- [ ] **Step 5: Comprehensive PR review** — `/pr-review-toolkit:review-pr` (applicable aspects), fix Critical + Important on the branch, push, note the round in a PR comment.

- [ ] **Step 6: Update campaign memory** — wave 5 done, wave 6 (effects + export) next and last; reminder to delete the campaign spec in the wave-6 PR.

---

## Self-review notes

- Spec coverage: campaign dimension 1 (Tasks 1, 2, 4, 6), dimension 2 (improvement findings in Task 1, fixes in 2/4/6, follow-ups in PR body), dimension 3 (Tasks 3, 5, 7) ✓; per-demo checklist items all mapped; sitemap/index untouched (descriptions unchanged) ✓; carry-over BlockFlag.discontinuous item is Task 1 claim 1 ✓.
- Verdict-dependent steps carry both branches (apply / record-confirmed-and-skip) — the verdict is the input.
- Shared-module risk handled: `useRecordingSession` error surface lands once in Task 2 and is consumed by both recording demos; `RecordingTapeCard`/`RecordingPreferences` restyle lands once in Task 3 and is re-verified in Task 5; grep confirmed no out-of-wave consumers.
- Permission-gated verification is decided by the Task-1 spike, with an explicit manual-verification escape hatch that reaches the PR description — never silently skipped.
- Type consistency: `error`/`clearError` on `useRecordingSession` (Task 2) is the same slot rendered in Tasks 2/4; `SampleLoaderState.reason` matches the root CLAUDE.md's documented field name.
