# Demo Audit Wave 1 (Warp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the three warp demos (correctness vs openDAW source, improvements, mastering-console design) per the campaign spec, with the audio-verify-debug page getting a correctness-only pass.

**Architecture:** The design language extracts from `warp-overview.tsx` into a shared `src/lib/design/consoleTheme.ts` (classes renamed `wo-` → `mc-`) so demo pages and future waves consume one source. A source-audit task pins findings against the exact installed tags (`@opendaw/studio-adapters@0.0.116`, `@opendaw/studio-core@0.0.152`) before any page changes. Page restyles touch chrome/headers/explanations only — functional Radix controls stay.

**Tech Stack:** existing repo stack; openDAW source checkout at `/Users/naomiaro/Code/openDAW` (tags fetched).

**Spec:** `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md`
**Branch:** `demo-audit-campaign` (already created, spec committed).

---

## Verified facts

- Installed: studio-sdk 0.0.154, studio-adapters 0.0.116, studio-core 0.0.152, studio-boxes 0.0.94, studio-enums 0.0.77. Source tags `@opendaw/studio-adapters@0.0.116` and `@opendaw/studio-core@0.0.152` exist in `/Users/naomiaro/Code/openDAW`.
- Box schemas live in `packages/studio/forge-boxes/src/schema/` upstream (studio-boxes publishes only).
- Design language: `docs/design/2026-06-11-mastering-console-editorial.md`; reference implementation `src/demos/warp/warp-overview.tsx` (its `STYLES` const + token block are the canonical CSS).
- Design scope for demo pages (per the design doc): page chrome, headers, explanatory sections. Interactive controls (Radix Switch/Button/SegmentedControl, transport, waveform canvas) keep their current structure.
- `/audio-verify` workflow + thresholds: `.claude/skills/audio-verify/SKILL.md`. Mandatory at wave end.

## File structure

```
src/lib/design/consoleTheme.ts          # Task 1 — shared CSS (mc- classes) + token docs
src/demos/warp/warp-overview.tsx        # Task 1 — consume shared module (visual no-op)
docs/superpowers/specs/...campaign....md# Task 2 appends findings? NO — findings go in the PR description
src/demos/warp/warp-varispeed-demo.tsx  # Task 3
src/demos/warp/warp-grid-follows-file-demo.tsx  # Task 4
src/demos/warp/warp-timestretch-demo.tsx        # Task 5
public/og-image-warp-{varispeed,grid-follows-file,timestretch}.png  # Tasks 3-5
CLAUDE.md                               # Task 6 — Playwright wording fix (+ any Task 2 corrections)
src/demos/warp/CLAUDE.md                # Task 2/6 — corrections if source audit finds drift
```

---

### Task 1: Extract the design language into `src/lib/design/consoleTheme.ts`

**Files:** Create `src/lib/design/consoleTheme.ts`; modify `src/demos/warp/warp-overview.tsx`.

- [ ] **Step 1:** Create `src/lib/design/consoleTheme.ts` exporting `CONSOLE_STYLES: string` — the full `STYLES` const from `warp-overview.tsx` with every `wo-` class/var renamed to `mc-` (mastering-console), plus a header comment pointing at `docs/design/2026-06-11-mastering-console-editorial.md`. Keep `body { background: var(--mc-bg); }`.
- [ ] **Step 2:** Refactor `warp-overview.tsx`: delete its local `STYLES`, import `CONSOLE_STYLES`, rename all `wo-` classNames to `mc-` in JSX. ZERO visual change intended.
- [ ] **Step 3:** Verify: `npx tsc --noEmit` clean for both files; `npm run build`; dev server + Playwright screenshot of `/warp-demos.html` at 1280px — compare against the merged look (hero, lattice, panels all identical).
- [ ] **Step 4:** Commit `refactor: extract mastering-console design language into shared consoleTheme module`.

### Task 2: Source-correctness audit (read-only investigation, fixes only if wrong)

**Files:** none expected; corrections to `src/demos/warp/CLAUDE.md` / demo code only if findings demand.

Audit against the SOURCE at the pinned tags (`git -C /Users/naomiaro/Code/openDAW show "@opendaw/studio-core@0.0.152:<path>"` etc.), not just `.d.ts`:

- [ ] **Step 1:** Warp-marker engine behavior (core: Tape engine / PitchVoice / TimeStretch processing): confirm (a) linear interpolation between consecutive markers; (b) what plays BEFORE the first marker and AFTER the last (our lead-in `{0, s}` and outro anchors rely on assumed extrapolation/clamping — verify which); (c) `transientPlayMode` live-write safety and `playbackRate` position-reset claims.
- [ ] **Step 2:** Tempo map (adapters: VaryingTempoMap + tempo track events): confirm stepped `Interpolation.None` semantics, event-at-tick-0 requirement (what happens before the first event?), and that `loopArea` PPQN end behaves musically under a varying map.
- [ ] **Step 3:** Box schemas (forge-boxes): WarpMarkerBox field types/constraints, `owner` pointer mandatory-ness (cascade-delete claim), AudioTimeStretchBox defaults.
- [ ] **Step 4:** `audio-verify-debug` correctness-only pass: re-read the page against the rendering pipeline source (`EngineProcessor` mixdown branch, metronome inclusion) — confirm the harness's metronome-in-mixdown assumption against core source.
- [ ] **Step 5:** Produce a findings table (claim → source file:line at tag → CONFIRMED / WRONG / NUANCED). Fix WRONG items (code or CLAUDE.md) in this task; NUANCED items become CLAUDE.md clarifications in Task 6. The table goes verbatim into the PR description.

### Tasks 3–5: Apply the design language per demo page (one task each)

**Files per task:** the demo tsx + its og-image. Order: varispeed (3), grid-follows-file (4), timestretch (5).

Common transformation (the shared module from Task 1 is the implementation spec; `warp-overview.tsx` is the live reference):

- [ ] **Step 1:** Add `<style>{CONSOLE_STYLES}</style>` inside the Theme; Theme `accentColor` → `"amber"`. Add the IBM Plex Mono `<link>`s (with `crossorigin`) to the page's HTML entry, copying the exact three lines from `warp-demos.html`; add `background: #0d0c0a` to the HTML's body style.
- [ ] **Step 2:** Header: replace `<Heading size="7">` + intro `<Text>` with the mc pattern — `.mc-kicker` (e.g. `WARP 01 — VARISPEED`, `WARP 02 — SET TEMPO FROM CLIP`, `WARP 03 — TIME-STRETCH`, matching the scenario indices/chips from the overview), an `.mc-title` at demo scale (override font-size via inline style `clamp(28px, 4.5vw, 44px)`), and the existing intro copy inside `.mc-intro`. Copy text unchanged.
- [ ] **Step 3:** Explanation card (the "The math…"/"The thesis…" Card at the bottom): convert to the `.mc-anchors` strip pattern (amber-ruled, `.mc-anchors-head` micro-label heading, prose + links unchanged — keep all cross-links including the overview link).
- [ ] **Step 4:** Waveform Card: wrap in `.mc-lattice-frame` (border/padding/pinstripe) instead of a plain Radix Card. Status/controls Cards: leave Radix structure; restyle ONLY the status badge row heading to `.mc-kicker`-style micro-label if trivially cheap, otherwise leave (controls are instrument-panel scope, not this wave's).
- [ ] **Step 5:** Verify: tsc clean; build; Playwright — page loads, primary interaction works (varispeed: warp toggle + readout; grid: conform toggle + 130-events badge + residual; timestretch: 3-way switch + transient flip while playing), console clean, `:focus-visible` ring visible on Tab to the demo's links/buttons.
- [ ] **Step 6:** Regenerate the page's og-image at 1200×630 in its most visual state; commit page + image: `feat: apply mastering-console design to <page> (wave 1)`.

### Task 6: Wave close-out

- [ ] **Step 1:** CLAUDE.md: fix the Playwright screenshot line — custom-named screenshots land in the **project root** (not "outside the repo"); default names land in `.playwright-mcp/`. Apply any NUANCED clarifications from Task 2.
- [ ] **Step 2:** Run `/audio-verify` end-to-end (controller, all five scenarios) — the restyles must not have touched audio paths; all assertions per SKILL.md must pass unmodified.
- [ ] **Step 3:** `npm test` + `npm ci` + `npm run build`; click through all four warp pages once.
- [ ] **Step 4:** Wave-level final review subagent over the whole branch diff; fix findings.
- [ ] **Step 5:** PR with the per-demo checklist results + Task 2 findings table + follow-ups list. (Campaign spec stays — deleted only after wave 6.)

## Done criteria

Spec's per-wave done criteria + the Task 2 findings table present in the PR + audio-verify green with unchanged thresholds.
