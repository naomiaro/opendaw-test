# Demo Audit Wave 2 (Playback Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit + restyle the five playback-core demos (looping, clip-looping, clip-fades, timebase, track-editing) per the campaign spec.

**Architecture:** Same machinery as wave 1: one source-audit task first (tag-pinned reads only), then one task per demo applying the audit checklist + mastering-console chrome via the shared `consoleTheme.ts`, then close-out. Shared components (`TimelineRuler`, `TrackRow`, `TracksContainer`, `TransportControls`, `Playhead`) are used by OTHER categories — they are OUT OF SCOPE; chrome-only restyling guarantees this.

**Spec:** `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md`
**Branch:** `demo-audit-wave-2-playback-core`
**Source tags (verified to match origin):** `@opendaw/studio-adapters@0.0.116`, `@opendaw/studio-core@0.0.152`, `@opendaw/studio-sdk@0.0.154`; checkout `/Users/naomiaro/Code/openDAW`; tag-pinned `git show`/`git grep` ONLY.

---

### Task 1: Source-correctness audit (playback-core claims)

Read-only investigation; fix only WRONG. Output: findings table (claim → file:line @ tag → CONFIRMED/WRONG/NUANCED/UNVERIFIABLE) for the PR; NUANCED wording suggestions for close-out; improvement candidates list.

Claims (from `src/demos/playback/CLAUDE.md` and the demos' inline comments):
- [ ] 1. `LoopableRegion.locateLoops()` mapping: `offset = position − loopOffset` changes the read position; `loopOffset` PPQN within the loop coordinate system vs `waveformOffset` raw-seconds shift applied after PPQN→seconds (`sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate`).
- [ ] 2. Fades are region-relative: `fillGainBuffer` computes `startPpqn = cycle.resultStart − regionPosition`; fades at edges unreached when playback starts mid-file (early-return keeps gain 1.0).
- [ ] 3. Fade fields + region fields CAN share one `editing.modify` transaction (no ordering hazard).
- [ ] 4. "Fade-in on regions created by `RegionEditing.cut()`/`copyTo()` may not apply in the engine even when values read back" — find the mechanism or mark UNVERIFIABLE/empirical.
- [ ] 5. `RegionEditing.cut()` creates a new `PitchVoice` per region with 20 ms `VOICE_FADE_DURATION` crossfade from current amplitude.
- [ ] 6. Overlapping regions on one track: live engine tolerates; `project.copy()` validator deletes BOTH (console "Overlapping regions" → "Deleting 2 invalid boxes").
- [ ] 7. `timeBase` semantics: `duration`/`loopDuration`/`loopOffset` are Float32 `unit:"mixed"` (PPQN in Musical, seconds in Seconds); `position` always Int32 PPQN regardless of timeBase — verify the SECONDS-timeBase position unit claim specifically against engine reads.
- [ ] 8. `FadingAdapter.copyTo(target)` takes the raw `Fading` box, not an adapter; slope semantics 0.25=log / 0.5=linear / 0.75=exp as rendered by the engine gain curve.
- [ ] 9. Peaks `Float16` unpack: ±1.0 stored unpacks to ±1.0001219511032104 (the ±1.001 headroom rule) — confirm in lib-std numeric at the sdk tag.
- [ ] 10. `project.copy()` shares the `sampleManager` but NOT engine preferences.

### Tasks 2–6: per-demo audit + restyle (one task each)

Order: looping (2), clip-looping (3), clip-fades (4), timebase (5), track-editing (6). Per task:

- [ ] **Audit checklist** (campaign spec): demo loads + primary interaction works via Playwright real clicks; SDK calls match Task 1 findings; error handling at the current bar (error card exists? async guards? — note gaps, fix CHEAP ones only, file the rest); improvement candidates listed for the PR.
- [ ] **Restyle (chrome only)** per the wave-1 pattern (reference commits: varispeed restyle on main, `git log --oneline main | head`):
  - HTML entry: three crossorigin font links, body `background: #0d0c0a`, theme-color `#e8a33d`.
  - Page: `CONSOLE_STYLES` style tag inside Theme, `accentColor="amber"`, `--mc-bg` background.
  - Header → `mc-kicker` (`Playback — <Name> · OpenDAW SDK`) + `h1.mc-title` (clamp 28–44px, uppercase text) + intro verbatim in `p.mc-intro`.
  - Bottom explanation Card(s) → `section.mc-anchors` (+ `h2.mc-anchors-head`), links → plain `<a>`.
  - Primary waveform/timeline visual container → `div.mc-lattice-frame` ONLY if it's a plain Card today (the TracksContainer-based demos may already have their own framing — do not double-wrap; judge per page and report).
  - Shared components and all interactive controls untouched; copy verbatim.
- [ ] og-image regenerated 1200×630, most-visual state.
- [ ] Verify: CLI tsc clean for the file (incl. unused-import sweep), build green, console clean, focus ring on anchors links.
- [ ] Commit `feat: apply mastering-console design to <name> demo (wave 2)` (+ separate `fix:` commits for any cheap audit fixes).

### Task 7: Close-out

- [ ] Apply NUANCED clarifications from Task 1 to `src/demos/playback/CLAUDE.md` (directive style).
- [ ] `/audio-verify` ONLY if any audit fix touched shared audio paths (`src/lib/beats`, scenario/region/engine-adjacent code) — chrome-only waves skip it; state which in the PR.
- [ ] `npm test` + `npm ci` + `npm run build`; click through all five pages.
- [ ] Final wave review subagent over the whole branch diff; fix findings.
- [ ] Comprehensive PR review per the project rule (code + comments aspects; others if the diff warrants) AFTER the PR opens; fix Critical+Important.
- [ ] PR with the findings table + per-demo checklist + follow-ups. Delete THIS plan file in the PR (campaign spec stays).

## Done criteria

Spec's per-wave done criteria; findings table in the PR; both review rounds complete.
