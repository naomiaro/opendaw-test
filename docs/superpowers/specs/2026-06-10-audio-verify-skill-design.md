# audio-verify Skill — Design

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation

## Purpose

Close the "needs human ears" verification gap: render a warp-demo scenario's OpenDAW
project offline to a WAV on disk, analyze it with the audio-analyzer MCP, and assert
beat alignment and pitch behavior numerically. First target: the warp triptych
(PR #67); the harness is shaped so other demos can add scenarios later.

## Why a browser harness (not Node)

The OpenDAW engine requires AudioWorklet + SharedArrayBuffer + its worker stack —
there is no headless-Node render path. The harness is therefore an unlisted debug
page driven by Playwright, per the repo's existing debug-page convention.

## Components

### 1. Shared scenario builders — `src/demos/warp/lib/warpScenarios.ts`

The mode-switch transactions currently live inline in the three demo pages. Factor
them into pure apply-functions so the demos and the verify harness execute the SAME
box-graph logic (no drift between what users hear and what gets verified):

- `applyRaw(ctx)` — NoStretch, Seconds timeBase, full-file durations, loop end at
  seconds-derived ticks.
- `applyVarispeed(ctx, anchors)` — PitchStretch + one WarpMarkerBox per anchor,
  Musical timeBase, loop end at last anchor tick.
- `applyTimeStretch(ctx, anchors, transientPlayMode)` — TimeStretchBox (playbackRate
  1.0) + markers; caller awaits `ensureTransientMarkers` first.
- `applyGridConform(ctx, events)` / `applyGridRigid(ctx, projectBpm)` — tempo-track
  rewrite + region placement (position firstBeatTick, waveformOffset s0).

`ctx = { project, region, audioFileBox, audioBuffer, markers, projectBpm, prevStretchBox }`;
each returns the created stretch box (or null). One `editing.modify()` per call,
preserving the reviewed transaction patterns. The three demo pages are refactored to
call these (UI state stays in the pages).

### 2. WAV transport — Vite dev-server middleware (no Playwright-download dependency)

A dev-only Vite plugin in `vite.config.ts` (`configureServer`): `PUT
/__verify/<name>.wav` writes the request body to `.verify-output/<name>.wav`
(directory gitignored). Name is sanitized (`[a-z0-9-]+\.wav` only). The harness page
fetch-PUTs the encoded WAV; the analyzer MCP reads the deterministic path
`<worktree>/.verify-output/verify-<scenario>.wav`. Dev-mode only — never part of the
production build. Verifiable independently with `curl -X PUT --data-binary`.

WAV encoding: 16-bit PCM interleaved encoder. Reuse an existing repo encoder if one
exists (check `src/lib/` and the export demo at plan time); otherwise add
`src/lib/wavEncode.ts` (`encodeWavPcm16(audioBuffer): ArrayBuffer`).

### 3. Harness page — `audio-verify-debug.html` + `src/demos/warp/audio-verify-debug.tsx`

Unlisted (noindex, not in index/sitemap), repo-root HTML + vite input. Flow:

1. Read `?scenario=` — one of `raw | varispeed | timestretch | grid-conform | grid-rigid`.
2. `setupWarpDemo()` (existing), then the matching `warpScenarios` apply-function.
   For `timestretch`, await `ensureTransientMarkers` first.
3. Offline render via the **manual pipeline** from `src/demos/export/CLAUDE.md`
   (`project.copy()` → disable loop on the copy → `OfflineAudioContext` →
   `AudioWorklets.createFor` → `createEngine` → `startRendering`), NOT
   `AudioOfflineRenderer.start` — the manual path exposes
   `engineWorklet.preferences`, which the metronome control requires (preferences do
   not travel with `project.copy()`).
   - Metronome OFF for `raw | varispeed | timestretch` (music onsets only).
   - Metronome ON at 0 dB for `grid-conform | grid-rigid` — the audio is identical in
     both grid scenarios by design; the *grid* is only audible via the metronome, so
     the clicks must be in the render.
   - Render length: full song (user decision — validates cumulative drift).
4. Encode WAV, PUT to `/__verify/verify-<scenario>.wav`.
5. Progress + result via a `data-verify-state` attribute on a status element:
   `setup → rendering → uploading → done | error:<message>` — Playwright polls it.
   All errors surface there (project rule: no silent failures).

### 4. Expected-values script — `scripts/expected-beats.ts`

Run with `node scripts/expected-beats.ts` (Node >= 23 type-stripping; `engines`
already requires >= 23). Imports `src/lib/beats/` (SDK-free), reads
`public/audio/Otherside.beats`, prints JSON:

- `gridTimes`: expected onset seconds for locked scenarios — anchor ticks converted
  at the rigid project BPM (`round(averageBpm)`, 123 for this file): `tick/960 · 60/bpm`.
- `fileTimes`: marker seconds — what `raw` plays (region at position 0, file from 0)
  and what `grid-conform` music AND clicks land on (the conformed map anchors
  `ppqnToSeconds(firstBeatTick) = s0`, so render time = file time).
- `fileTimesRigid`: grid-rigid music — the region still sits at `firstBeatTick`, but
  the rigid map puts that tick at `firstBeatTick/960 · 60/bpm` (≈ 1.463 s, not s0 =
  1.26 s): `thatSecond + (marker.second − s0)` per marker.
- `rigidClickTimes`: grid-rigid metronome clicks — beat ticks at the flat project BPM.
All lists are render-relative seconds (render starts at tick 0).

### 5. The skill — `.claude/skills/audio-verify/SKILL.md`

Project skill, user-invocable (`/audio-verify`) and Claude-invocable after
audio-engine changes. Documented workflow:

1. Start the dev server (HTTPS, custom port) from the branch/worktree under test.
2. Per scenario: navigate Playwright to the harness URL, poll `data-verify-state`
   until `done` (full-song offline render — allow minutes; `error:*` aborts with the
   message).
3. Run `scripts/expected-beats.ts` for expected values.
4. Analyze each WAV with audio-analyzer `rhythm_analysis`: full-track summary +
   three 20 s windows at high resolution — intro [10, 30] s, mid [120, 140] s,
   outro [220, 240] s, render-relative — windowed zoom per the analyzer's
   long-track guidance, not per-beat lists over 250 s.
5. Compare per window and report a pass/fail table.

**Assertions:**
- `raw` (negative control): median |detected − gridTimes| < 100 ms in the intro
  window AND > 300 ms in the outro window — drift must GROW. If raw doesn't drift,
  the harness is broken; stop.
- `varispeed`, `timestretch`: median |detected − gridTimes| ≤ 35 ms per window
  (measured onset-detection jitter is ~20–50 ms), no window's median worse than 60 ms.
- `grid-conform`: median |detected − fileTimes| ≤ 35 ms per window (music and clicks
  coincide on the conformed grid).
- `grid-rigid` (negative control): outro-window onsets split into two diverging
  populations (clicks at `rigidClickTimes`, music at `fileTimesRigid`) — assert the
  two expected lists themselves diverge > 300 ms by the outro AND detected onsets
  match the UNION better than either list alone.
- Pitch (informational on first run, promoted to hard assertion once real numbers
  exist): `harmonic_analysis` pitch-class distribution on the same mid-song window —
  `timestretch` must correlate with `raw`; `varispeed` must deviate.

**Troubleshooting section:** dev server not running / wrong port; HTTPS cert; COOP/COEP;
`.verify-output/` missing (middleware not loaded = production build or stale config);
render hangs (check `data-verify-state` and browser console via Playwright).

## Error handling

- Harness: every failure path lands in `data-verify-state="error:<msg>"`.
- Middleware: rejects non-PUT, oversized (> 100 MB), or bad-name requests with 4xx.
- Skill: stops at the first failed scenario with the numbers collected so far.

## Testing the skill itself

1. Run end-to-end on PR #67's branch: all five scenarios must pass.
2. Prove it can fail: analyze the `raw` WAV against `gridTimes` with the locked-mode
   assertion (must fail), and confirm a killed dev server produces the documented
   troubleshooting outcome, not a hang.

## Out of scope

- Scenarios beyond the warp triptych (the harness page's scenario switch is the
  extension point).
- CI integration (manual/agent-invoked only).
- Pitch-shift cents *measurement* (only distribution-correlation checks).
