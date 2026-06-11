# Demo Audit Wave 4 — Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the three automation demos (tempo-automation, time-signature, track-automation) against tag-pinned openDAW source, fix what's wrong, apply the mastering-console editorial design, and correct the category CLAUDE.md + doc chapters they exercise — one PR on branch `demo-audit-wave-4-automation`.

**Architecture:** Same machinery as waves 1–3: Task 1 produces a findings working file from tag-pinned source reads (`git show` only, never working-tree files in the upstream checkout); per-demo tasks consume those findings (audit fixes first, then restyle as a separate commit so correctness diffs stay reviewable); close-out graduates durable findings to CLAUDE.md/docs, deletes the working file, and runs wave-integration reviews before the PR.

**Tech Stack:** React + Vite + `@opendaw/studio-sdk@0.0.154` (sub-packages: studio-adapters@0.0.116, studio-core@0.0.152, studio-boxes@0.0.94, studio-enums@0.0.77, lib-dsp@0.0.84, lib-std@0.0.78, lib-box@0.0.86). Upstream checkout for source reads: `/Users/naomiaro/Code/openDAW/` (tag names `@opendaw/<pkg>@<version>`). Design language: `docs/design/2026-06-11-mastering-console-editorial.md`, reference implementation `src/demos/warp/warp-overview.tsx`.

**Campaign rules that bind every task** (from `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md`):
- Source verification is tag-pinned `git show` only — run `git fetch --tags` in `/Users/naomiaro/Code/openDAW/` once, first.
- Restyle = chrome only. Controls, hooks, and box-graph logic do not change in restyle commits.
- One implementer subagent at a time; two-stage review per task (spec compliance, then code quality); two wave-integration review rounds + comprehensive PR review before merge.
- No silent failures: every error path reaches the UI (error card / status), never `console.warn`-only.
- audio-verify: required only if a task touches `src/lib/beats/`, warp scenarios, or shared audio paths. Automation demos don't — each close-out commit that skips it must say why.
- Findings working file is compaction insurance — write findings as you go, not at the end.

---

## File Map

| File | Role in this wave |
| --- | --- |
| `docs/superpowers/plans/2026-06-11-wave4-audit-findings.md` | Create in Task 1, append throughout, **delete in Task 8** (graduate durable bits first) |
| `src/demos/automation/tempo-automation-demo.tsx` | Audit fixes (Task 2) + restyle (Task 3) |
| `src/demos/automation/time-signature-demo.tsx` | Audit fixes (Task 4) + restyle (Task 5) |
| `src/demos/automation/track-automation-demo.tsx` | Audit fixes (Task 6) + restyle (Task 7); 882 lines — split if restyle pushes it further over the 800 cap |
| `src/demos/automation/CLAUDE.md` | Corrections in Task 8 (directive style — no "discovered during audit" narration) |
| `documentation/02-timing-and-tempo.md`, `documentation/09-editing-fades-and-automation.md` | Only claims the demos exercise; fix factual errors found in Task 1, leave the rest alone |
| `public/og-image-tempo-automation.png`, `public/og-image-time-signature.png`, `public/og-image-track-automation.png` | Regenerate after each restyle (1200×630) |

---

### Task 1: Tag-pinned source audit → findings working file

**Files:**
- Create: `docs/superpowers/plans/2026-06-11-wave4-audit-findings.md`
- Read-only: the three demo `.tsx` files, `src/demos/automation/CLAUDE.md`, upstream checkout via `git show`

- [ ] **Step 1: Fetch tags in the upstream checkout**

Run: `git -C /Users/naomiaro/Code/openDAW fetch --tags`
Expected: exits 0 (new tags or silence).

- [ ] **Step 2: Create the findings file with the claim inventory**

Create `docs/superpowers/plans/2026-06-11-wave4-audit-findings.md` with one section per claim below, each ending in a verdict line: `CONFIRMED | NUANCED (corrected wording) | WRONG (fix)` plus the source citation (`<tag>:<path>:<line>`).

**Demo-behavior claims (the high-value questions):**

1. **Tempo curve interpolation** — tempo-automation creates `Interpolation.Curve(slope)` events on the tempo track (`tempo-automation-demo.tsx:113`). Does the engine's tempo map honor curve interpolation between tempo events, and does it use `Curve.normalizedAt` so the demo canvas matches engine behavior? Read the tempo map implementation:
   `git -C /Users/naomiaro/Code/openDAW show "@opendaw/lib-dsp@0.0.84:packages/lib/dsp/src/" | cat` to list, then show the tempo-map and value-event files (look for `VaryingTempoMap`, `ValueEvent`, interpolation handling). Also check how `studio-adapters@0.0.116` `TimelineBoxAdapter.tempoTrackEvents` wires the collection.
2. **Delete + create tempo events in ONE `editing.modify()`** (`tempo-automation-demo.tsx:96-129`) — the category CLAUDE.md mandates one-modify-per-event for the **signature** track because `createEvent` reads `iterateAll()` internally. Does the tempo `ValueEventCollectionBoxAdapter.createEvent` have any read-after-write staleness inside one transaction, or is the single-transaction pattern safe here? Verdict decides whether Task 2 restructures `applyPattern`.
3. **Signature event deletion** — demo uses `signatureTrack.adapterAt(e.index).ifSome(a => a.box.delete())` (`time-signature-demo.tsx:89`); CLAUDE.md line 15 prescribes `signatureTrack.deleteAdapter(a)`. Read `SignatureTrackAdapter` at `studio-adapters@0.0.116` — does `deleteAdapter` exist, what does it do beyond `box.delete()`, which is correct?
4. **`durationInPulses` + `loopArea` fields** on `TimelineBox` at `studio-boxes@0.0.94` — names, types, Int32 vs Float32 (PPQN-integer rule).
5. **Pan automation mapping** — track-automation labels unitValue 0→"L", 0.5→"C", 1→"R" (`track-automation-demo.tsx:163-167`). Read the AudioUnit `panning` field's ValueMapping (bipolar -1..1?) at `studio-adapters@0.0.116` and confirm 0.5 ↦ center.
6. **Reverb `wet`/`dry` mapping** — demo writes `reverbBox.wet.setValue(-6)` raw dB then automates with unitValues labeled "Wet/50%/Dry" (`track-automation-demo.tsx:119-144,632`). Confirm wet/dry use `ValueMapping.DefaultDecibel` (`decibel(-72,-12,0)`) so unitValue 1.0 = 0 dB, 0.5 = −12 dB; flag the "50%" label if it's actually −12 dB.
7. **`VOLUME_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0)`** (`track-automation-demo.tsx:52`) — confirm `VolumeMapper` is still `decibel(-96,-9,+6)` and `.x(0)` ≈ 0.734 at `studio-adapters@0.0.116`.
8. **`createTrackRegion` return** — demo casts `regionOpt.unwrap() as ValueRegionBox` (`track-automation-demo.tsx:200`). Check the `studio-core@0.0.152` API signature — is the cast still required, is `position`/`duration` Int32-strict?
9. **`createAutomationTrack(audioUnitBox, field)`** signature and return type at `studio-core@0.0.152` (demo assigns from inside `editing.modify` via outer variable, `track-automation-demo.tsx:644-654`).
10. **Same-position composite key** — CLAUDE.md says two events at `(position, index)` identical panic. Confirm in the event-collection compare function; check whether any wave-4 preset actually hits it (Ducking's six events don't share positions — but `eventsToJson` index logic at `track-automation-demo.tsx:254` implies it can).
11. **`Curve.normalizedAt(t, slope)` formula + slope semantics** at `lib-std@0.0.78` — confirm the Möbius-Ease formula and "0.75 = steep start / 0.25 = flat start" wording in CLAUDE.md lines 66-71 (cross-check with the FadingAdapter slope semantics in the root CLAUDE.md — wave 3 corrected fade pairing; make sure the automation wording is consistent).
12. **`PPQN.fromSignature(nom, denom)`** = `Math.floor(3840/denom) * nom` at `lib-dsp@0.0.84`.
13. **Region-local event positions** — `LoopableRegion.globalToLocal` formula in CLAUDE.md lines 55-58 vs source.
14. **Tempo event deletion idiom** — demo + CLAUDE.md use `event.box.delete()` to clear; root CLAUDE.md distinguishes `unstageBox` (no cascade) vs `box.delete()` (cascade). Confirm `box.delete()` is right for ValueEventBox (any mandatory dependents?).

**API-surface claims (mechanical sweep):** the `AutomatableParameterFieldAdapter` full API block (CLAUDE.md lines 93-129), Touch Recording lifecycle (131-152), `ParameterAdapterSet` (154-161), `ValueRegionBoxAdapter` (163-170), `ValueEventBoxAdapter` (172-185) — for each listed member, confirm it exists with that signature at `studio-adapters@0.0.116`. Record only deviations.

**Changelog sweep:** read `changelogs/` entries since these demos were written for automation/tempo/signature-relevant additions the demos should use (e.g., newer adapter helpers). List candidates as improvements, not mandates.

- [ ] **Step 3: Audit the doc chapters' exercised claims**

In `documentation/02-timing-and-tempo.md` and `documentation/09-editing-fades-and-automation.md`, locate the sections covering tempo events, signature events, value regions/events, curve interpolation, and ValueMapping. Check only claims the three demos exercise against the Step-2 verdicts. Append a "doc corrections" section to the findings file (file, line, wrong claim, correction). Out of scope: prose quality, structure, untouched sections.

- [ ] **Step 4: Record the known code-level issues as findings**

Append these (already visible from reading the demos — verify, don't assume):
- tempo-automation + time-signature: `initializeOpenDAW(...).then(...)` with **no `.catch`** — a thrown init leaves "Loading..." forever (silent failure; violates the error bar).
- tempo-automation: `usePlaybackPosition` per-frame `setState` feeds `TempoCanvas` whose `useEffect` repaints on every `playheadPosition` change — full canvas redraw per frame. Root CLAUDE.md prescribes direct-DOM overlay for playheads. Classify: bug or acceptable for one small canvas? Record verdict + recommendation.
- time-signature: `getInitialSignature` / `getLastSectionBars` switch on pattern **names/shape** — data belongs in the pattern declarations (`initialSignature`, `lastSectionBars` fields). Cheap improvement.
- track-automation: `console.warn`-only failures (`:197,205,619,652`) — must surface to UI.
- track-automation: 882 lines (cap 800). Extraction candidates: presets+configs (~160 lines) and/or `AutomationCanvas` to sibling files.
- track-automation: `automationTrackBoxesRef`/`reverbDeviceBoxRef` accumulation across StrictMode re-init — wave 3 fixed the same shape in drum-scheduling; check whether `cancelled` guards actually prevent double box creation here, since box-graph writes happen after awaits.

- [ ] **Step 5: Commit the findings file**

```bash
git add docs/superpowers/plans/2026-06-11-wave4-audit-findings.md
git commit -m "docs: wave-4 automation audit findings (working file)"
```

---

### Task 2: tempo-automation — audit fixes

**Files:**
- Modify: `src/demos/automation/tempo-automation-demo.tsx`
- Read: findings file (Task 1 verdicts drive every step)

- [ ] **Step 1: Add init error handling** (pattern matches track-automation's existing try/catch):

```tsx
useEffect(() => {
  let cancelled = false;
  initializeOpenDAW({ onStatusUpdate: setStatus })
    .then(({ project: newProject }) => {
      if (cancelled) return;
      projectRef.current = newProject;
      setProject(newProject);
      const settings = newProject.engine.preferences.settings;
      settings.metronome.enabled = true;
      settings.metronome.gain = -6;
      applyPattern(newProject, PATTERNS[0]);
      setStatus("Ready");
      setIsReady(true);
    })
    .catch((error) => {
      console.error("Tempo automation demo initialization failed:", error);
      if (!cancelled) setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    });
  return () => { cancelled = true; };
}, []);
```

The pre-restyle UI shows `status` when `!isReady`, so the message is visible without new UI; Task 3 upgrades it to the console-design error card.

- [ ] **Step 2: Apply the Task-1 verdicts** — exactly the findings tagged `tempo-automation` in the working file. The two likely ones (skip whichever Task 1 confirmed safe):
  - If single-transaction delete+create is unsafe for tempo events → split `applyPattern` into one `editing.modify` for the clear and one per (or one for all, per the verdict) creation, mirroring the time-signature pattern.
  - If tempo curve interpolation is **not** honored by the engine → remove/replace the three curve patterns (Logarithmic Accel., Exponential Rit., Breath) or re-document them as canvas-only, per the verdict. If honored, keep and note `CONFIRMED` for the CLAUDE.md addition in Task 8.

- [ ] **Step 3: Verify in browser**

Run dev server if not running: `npm run dev -- --port 5180 --host 127.0.0.1` (background). With Playwright MCP: load `https://localhost:5180/tempo-automation-demo.html`, click each of the 7 patterns, Play, confirm the metronome follows, Stop. Console must be clean (no errors/warnings). Use `document.body.innerText.includes(...)` for text assertions.

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep tempo-automation` → no new errors vs parent (`git stash` compare if unsure). Run: `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/demos/automation/tempo-automation-demo.tsx
git commit -m "fix: tempo-automation audit — init error surface + source-verified corrections"
```

(Adjust message to the actual findings applied.)

- [ ] **Step 6: Two-stage review** — dispatch spec-compliance review (did every `tempo-automation` finding land; nothing else changed), then code-quality review. Fix findings before Task 3.

---

### Task 3: tempo-automation — restyle + og-image

**Files:**
- Modify: `src/demos/automation/tempo-automation-demo.tsx`, `tempo-automation-demo.html` (font links if missing `crossorigin`), `public/og-image-tempo-automation.png`

- [ ] **Step 1: Read the design doc + reference page** — `docs/design/2026-06-11-mastering-console-editorial.md` in full, then skim `src/demos/warp/warp-overview.tsx` for the implemented idiom. Reuse the page-chrome patterns wave 2/3 settled on (check a wave-3 page like `src/demos/playback/time-pitch-demo.tsx` for the demo-page variant with interactive panels).

- [ ] **Step 2: Apply the design language — chrome only.** Page header, section labels, explanation copy, buttons/cards to console tokens; IBM Plex Mono display with `crossorigin` on BOTH preconnect and stylesheet links; micro-labels ≥10px at ≥4.5:1; `:focus-visible` on every interactive element; `prefers-reduced-motion` guards on any motion. The tempo-curve canvas is this page's ONE data-drawn signature element — restyle its palette to console tokens (replace `#1a1a2e`/`#667eea` hardcodes with the design palette) but do not change what it draws. **Do not touch:** `applyPattern`, handlers, `usePlaybackPosition` wiring.

- [ ] **Step 3: Verify in browser** — same Playwright pass as Task 2 Step 3, plus: mobile width (390px) per-element clipping check (`el.scrollWidth > el.clientWidth`), keyboard-only tab pass shows focus rings, console clean.

- [ ] **Step 4: Regenerate og-image** — 1200×630 Playwright screenshot of the restyled page (omit `filename`; move from `.playwright-mcp/` to `public/og-image-tempo-automation.png`).

- [ ] **Step 5: Commit**

```bash
git add src/demos/automation/tempo-automation-demo.tsx tempo-automation-demo.html public/og-image-tempo-automation.png
git commit -m "feat: tempo-automation — mastering-console editorial restyle + og-image"
```

- [ ] **Step 6: Two-stage review** — spec: design-doc conformance checklist + "zero behavior diff" (`git diff HEAD~1 -- src/` shows chrome only); then quality review. Fix findings.

---

### Task 4: time-signature — audit fixes

**Files:**
- Modify: `src/demos/automation/time-signature-demo.tsx`

- [ ] **Step 1: Add init error handling** — same pattern as Task 2 Step 1 (`.catch` + `cancelled` guard + `Error:` status).

- [ ] **Step 2: Resolve the deletion-idiom finding** — per the Task-1 verdict on `deleteAdapter` vs `adapterAt(...).ifSome(a => a.box.delete())`: align the demo to the correct idiom (and queue the CLAUDE.md side for Task 8 if the doc is the stale half).

- [ ] **Step 3: Make patterns data-driven** — move the hardcoded helpers into the data:

```tsx
type SignaturePattern = {
  name: string;
  description: string;
  initialSignature: [number, number];
  lastSectionBars: number;
  changes: SignatureChange[];
};
```

Set `initialSignature: [4, 4]` everywhere except Film Score `[6, 8]`; `lastSectionBars: 4` for Standard → Waltz, `2` for the rest. Delete `getInitialSignature` / `getLastSectionBars`; read the fields in `applyPattern`.

- [ ] **Step 4: Apply any remaining Task-1 verdicts** tagged `time-signature` (e.g., `durationInPulses` typing — wrap `totalPpqn` in `Math.round()` if the field is Int32 and the accumulation can go fractional via `PPQN.fromSignature(7,8)`-style odd denominators; check the verdict).

- [ ] **Step 5: Verify in browser** — load `https://localhost:5180/time-signature-demo.html`, click all 4 patterns (bar canvas re-renders with correct signatures), Play (metronome adapts), Stop. Console clean.

- [ ] **Step 6: Run checks** — `npx tsc --noEmit --ignoreDeprecations "6.0"` (no new errors), `npm test`.

- [ ] **Step 7: Commit**

```bash
git add src/demos/automation/time-signature-demo.tsx
git commit -m "fix: time-signature audit — init error surface, data-driven patterns, source-verified deletion idiom"
```

- [ ] **Step 8: Two-stage review**, fix findings before Task 5.

---

### Task 5: time-signature — restyle + og-image

**Files:**
- Modify: `src/demos/automation/time-signature-demo.tsx`, `time-signature-demo.html`, `public/og-image-time-signature.png`

- [ ] **Step 1–6:** Identical procedure to Task 3 (design doc → chrome-only restyle → browser + mobile + focus verification → og-image → commit → two-stage review). This page's ONE signature element is the bar-structure timeline canvas (signature labels + beat grids) — console palette, same drawing logic. Commit:

```bash
git add src/demos/automation/time-signature-demo.tsx time-signature-demo.html public/og-image-time-signature.png
git commit -m "feat: time-signature — mastering-console editorial restyle + og-image"
```

---

### Task 6: track-automation — audit fixes

**Files:**
- Modify: `src/demos/automation/track-automation-demo.tsx`
- Possibly create: `src/demos/automation/trackAutomationPresets.ts` (if the line-count split lands here rather than Task 7)

- [ ] **Step 1: Surface the silent failures.** Replace `console.warn`-only paths with UI state. `applyAutomationEvents` cannot set React state directly (module-level function) — return a result instead:

```tsx
function applyAutomationEvents(project: Project, trackBox: TrackBox, events: AutomationEvent[]): boolean {
  // ... existing logic; replace bare `return` after each warn with keeping newRegionCreated=false
  return newRegionCreated;
}
```

Call sites set an error banner/status when it returns `false` (e.g., `setStatus("Error: failed to apply automation — see console")` pre-restyle; Task 7 styles it). Same for the `createAutomationTrack` failure loop (`:652`) and the missing-Guitar-region warn (`:619`): the warns stay (detailed context), but the UI must also show the degraded state.

- [ ] **Step 2: Resolve the StrictMode re-init finding** — per the Task-1 verdict: if double-init can double-create reverb + automation tracks, add the wave-3 drum-scheduling fix shape (reset the refs at init start, or guard box creation on `cancelled` immediately before each `editing.modify`). If `initializeOpenDAW` already makes re-init impossible, record `CONFIRMED safe` and skip.

- [ ] **Step 3: Apply remaining Task-1 verdicts** tagged `track-automation`: mapping-label corrections (pan "C", wet "50%" if they misstate the actual mapped values), the `as ValueRegionBox` cast (drop if the API now returns typed), `index: 0` composite-key hardening in `applyAutomationEvents` (assign incrementing index per duplicate position, mirroring `eventsToJson`'s logic) if any preset/finding warrants it.

- [ ] **Step 4: Line-count split (if needed now)** — if Steps 1–3 push the file meaningfully past 882, extract `volumePresets`/`panPresets`/`reverbWetPresets`/`TRACK_CONFIGS` + the `AutomationEvent` types to `src/demos/automation/trackAutomationPresets.ts` (pure data move, no logic change). Otherwise defer the split decision to Task 7.

- [ ] **Step 5: Verify in browser** — load `https://localhost:5180/track-automation-demo.html`, wait for Dark Ride guitar load, per section (Volume, Pan, Reverb Wet): select each preset, Play, hear the parameter move, Stop. Check the JSON `<details>` blocks render. Console clean.

- [ ] **Step 6: Run checks** — `npx tsc --noEmit --ignoreDeprecations "6.0"`, `npm test`.

- [ ] **Step 7: Commit**

```bash
git add src/demos/automation/
git commit -m "fix: track-automation audit — surface silent failures, source-verified corrections"
```

- [ ] **Step 8: Two-stage review**, fix findings before Task 7.

---

### Task 7: track-automation — restyle + og-image

**Files:**
- Modify: `src/demos/automation/track-automation-demo.tsx`, `track-automation-demo.html`, `public/og-image-track-automation.png`
- Possibly create: `src/demos/automation/trackAutomationPresets.ts` (if not done in Task 6 and the file is over 800 lines)

- [ ] **Step 1–6:** Same procedure as Task 3. Page-specific notes: the three automation-envelope canvases are collectively this page's signature element — console palette (replace per-config hex accents `#a855f7`/`#38bdf8`/`#34d399` with design-token-derived hues that keep the three sections distinguishable), drawing logic unchanged. The gradient `<Heading>` goes (console pages don't use gradient text). `ServerDataBlock` becomes a console-styled code block. If the file exceeds 800 lines after restyle, do the presets extraction described in Task 6 Step 4 within this commit. Commit:

```bash
git add src/demos/automation/ track-automation-demo.html public/og-image-track-automation.png
git commit -m "feat: track-automation — mastering-console editorial restyle + og-image"
```

---

### Task 8: CLAUDE.md + doc corrections, delete working file

**Files:**
- Modify: `src/demos/automation/CLAUDE.md`, `documentation/02-timing-and-tempo.md`, `documentation/09-editing-fades-and-automation.md` (only lines with verdicts), root `CLAUDE.md` (only if a finding contradicts it)
- Delete: `docs/superpowers/plans/2026-06-11-wave4-audit-findings.md`

- [ ] **Step 1: Apply every `WRONG`/`NUANCED` verdict to the category CLAUDE.md.** Directive style (per the established feedback): no "discovered during the wave-4 audit", no "note that" — state the rule, show the signature. New durable knowledge from Task 1 (e.g., the tempo-curve-interpolation verdict, the tempo-collection transaction-safety verdict) gets added the same way.

- [ ] **Step 2: Apply the doc-corrections section** of the findings file to doc02/doc09 — factual fixes only, present tense, no audit narration.

- [ ] **Step 3: Confirm nothing durable remains** in the findings file (every verdict either landed in code, CLAUDE.md, or docs), then:

```bash
git rm docs/superpowers/plans/2026-06-11-wave4-audit-findings.md
git add src/demos/automation/CLAUDE.md documentation/ CLAUDE.md
git commit -m "docs: automation CLAUDE.md + doc02/doc09 corrections from wave-4 source audit"
```

- [ ] **Step 4: Two-stage review** — spec: every findings-file verdict accounted for; quality: directive style, no stale claims left.

---

### Task 9: Close-out — integration reviews, full verification, PR

- [ ] **Step 1: Wave-integration review round 1** — dispatch a reviewer over the full branch diff (`git diff main...HEAD`): cross-demo consistency (same error-handling shape, same design idiom, shared-code opportunities missed), CLAUDE.md/demos agreement, leftover debug code. Fix everything found.

- [ ] **Step 2: Wave-integration review round 2** — fresh reviewer, same scope, on the fixed tree. Fix remaining findings.

- [ ] **Step 3: Full verification suite**

```bash
npm test                 # all pass; check no .claude/worktrees inflating counts
npm run build            # Vite + VitePress green
npx tsc --noEmit --ignoreDeprecations "6.0"   # zero NEW errors vs main (extract main's baseline via git stash or worktree)
```

Browser-verify all three pages once more on the final tree (primary interaction + console clean). audio-verify: **skipped** — no `src/lib/beats/`, warp, or shared-audio-path changes this wave; state this in the PR.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin demo-audit-wave-4-automation
gh pr create --title "feat: demo audit wave 4 — automation (source-verified, console design applied)" --body "<wave-3-shaped body>"
```

PR body mirrors PR #73's shape: per-demo checklist results (campaign spec's 7 items), audit-results table (claims confirmed/nuanced/wrong), design section, verification section (incl. the audio-verify skip justification), follow-ups list (improvement candidates not applied).

- [ ] **Step 5: Comprehensive PR review** — run `/pr-review-toolkit:review-pr` (applicable aspects), fix Critical + Important on the branch, push, note the round in a PR comment.

- [ ] **Step 6: Update campaign memory** — wave 4 done, wave 5 (recording + midi) next, including the carry-over: verify the recording CLAUDE.md loop-wrap crossfade "BlockFlag.discontinuous" mechanism.

---

## Self-review notes

- Spec coverage: campaign dimensions 1 (Tasks 1, 2, 4, 6), 2 (improvement findings in Tasks 1/4/6, follow-ups in PR body), 3 (Tasks 3, 5, 7) ✓; per-demo checklist items all mapped (source verify, CLAUDE.md re-verify, browser run, error bar, improvements, design, sitemap untouched — descriptions unchanged) ✓.
- The fix steps that depend on Task-1 verdicts deliberately carry both branches (apply / record-confirmed-and-skip) rather than fake certainty — the verdict is the input, the plan states what each verdict implies.
- Type consistency: `SignaturePattern` extension in Task 4 matches the existing type's fields; `applyAutomationEvents` boolean return in Task 6 matches its single call-site usage.
