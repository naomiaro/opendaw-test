# OpenDAW SDK Changelog: 0.0.164 → 0.0.165

One release, one headline for this repo: the Rust engine now **fades every play mode out
past a region end and in from a mid-source start, making cut seams a transparent
self-crossfade and transport stops a clean release** — the "`RegionEditing.cut()` pops"
limitation we have documented since 0.0.144 is fixed upstream. Alongside it: the
**`TrackType.Undefined` placeholder track is gone** (buses no longer carry a dummy track;
a migration deletes stored ones), new **`AudioContentFactory.createSignalsmith{Region,Clip}`**
factories, a new **`AudioUnitBox.userInterface.automationCollapsed`** schema field, and
**`ProjectApi.deleteAudioUnit` now refuses to delete the Output unit**. No breaking API
changes for this repo; no `lib-*` package changed.

Sub-package versions (installed): `studio-adapters` 0.1.6, `studio-core` 0.1.6,
`studio-core-wasm` 0.0.10, `studio-boxes` 0.0.104, `studio-enums` 0.0.84 (unchanged).

## Fix: cut-seam clicks and pause clicks, all play modes (Rust engine, core-wasm 0.0.10)

A cut splits a region into two abutting halves that read the same source contiguously —
but the old boundary declick faded A out into 0 while B did not fade in (its mid-file
start is expressed via `loopOffset`, which the fade-in guard ignored), stepping from ~0
to full at the seam: the high-pitch click we documented as the voice-pop limitation.
Transport stop likewise hard-cut sample voices (the pause click) while synths rang out.

The engine now unifies every play mode on one rule: play the region fully to its end,
then **fade out by continuing to produce audio in that mode's own way**, and **fade in
whenever a region starts partway into its source** (the guard now consults `loopOffset`,
not just the waveform offset). Equal ~20 ms linear windows make a cut seam a
self-crossfade — A's read-past-the-end tail overlaps B's fade-in over the SAME source
frames, summing to the original signal — and make a stop a clean release:

- **Native + pitch-warp (varispeed)**: a `ReleaseTail` keeps reading the source past the
  region end (at the warp rate for pitch mode) while ramping to 0.
- **Granular time-stretch**: `TimeStretchSequencer::render_release` rings the live grains
  out (advancing read heads, spawning no new grains).
- **Signalsmith (spectral)**: the player's stream continues past the end with frozen
  params, so the tail keeps the right pitch.
- **Transport stop** seeds a release for each live voice from its last state; the old
  `declick_out` hard-fade is disabled on every path — the release IS the fade now.
- Release tails render on every block including non-playing ones, so a stop rings out
  and a seam crossfades across block boundaries.

A follow-up commit fixes **Signalsmith replay free-run after a cut**: the stop-release
drives the persisted Signalsmith player's stream forward, and since those players are
never pruned (unlike granular sequencers and native cursors), the next play resumed from
the advanced read head — "a different section of the sample every time I start playing".
Idle players (not visited, not ringing a release) now get their `cycle_id` cleared in the
prune block, so the next play re-primes from the region start. Upstream regression tests
cover native seam transparency, the region-end tail, the stop release, and the replay.

Repo impact: `changelogs/sdk-0.0.140-to-0.0.147-changes.md` and the comp-lanes demo
docs describe the cut pop as a known limitation with volume-automation crossfades as the
workaround — the workaround is no longer required (still valid, just not necessary).

## TrackType.Undefined placeholder tracks removed (adapters 0.1.6, core 0.1.6)

`TrackType.Undefined` was a placeholder giving track-less units (buses, aux) a timeline
lane. The upstream timeline now renders a synthetic unit lane instead, so:

- **`AudioBusFactory.create` no longer creates a placeholder `TrackBox`** — a freshly
  created bus audio unit now has ZERO tracks (our `groupTrackLoading.ts` only resolves
  the bus's `AudioUnitBox` via the output pointer, so it is unaffected).
- **New migration `migrateUndefinedTracks(boxGraph)`** (exported from
  `studio-core/project/migration`, wired into `ProjectMigration`): deletes all Undefined
  placeholder tracks from loaded projects and compacts each affected unit's remaining
  track indexes to a contiguous 0..n-1 sequence preserving relative order. The enum
  VALUE stays reserved — stored projects contain it.
- **`RecordAudio` / `RecordMidi`** no longer special-case Undefined tracks in the
  older-take scan (they can no longer exist).
- **`DawProjectImport`** skips creating a track when the resolved content type would be
  Undefined (the unit renders as a synthetic lane instead).

## New: AudioContentFactory.createSignalsmithRegion / createSignalsmithClip (core 0.1.6)

The factory family gains the third stretch mode: `SignalsmithProps = { transpose?: number }
& Props`. Both create an `AudioSignalsmithBox` play mode (setting `transpose` when given)
and route through the same warp-marker helper as the TimeStretch/PitchStretch variants —
`createRegionWithWarpMarkers` / `createClipWithWarpMarkers` now accept
`AudioSignalsmithBox` as a play mode. Our warp demos hand-create `AudioSignalsmithBox`
via `applySignalsmith()` (predates this factory); both paths are valid.

## AudioUnitBox schema: `user-interface` object field (boxes 0.0.104, adapters 0.1.6)

`AudioUnitBox` gains field 30, an object `user-interface` of new class
`AudioUnitUserInterface` with one boolean `automation-collapsed` — backing the upstream
timeline's collapse-automation-lanes UI. `AudioUnitBoxAdapter` gains the getter
`automationCollapsed(): BooleanField`. Additive; old projects load (missing object
fields default).

## ProjectApi.deleteAudioUnit guards the Output unit (core 0.1.6)

`deleteAudioUnit` now returns early (silent no-op) when the unit's type is
`AudioUnitType.Output` — the output unit is mandatory, and deleting it desynced the
engine (it rejects the transaction).

## Misc

- **`DevicesClipboard.duplicate(context)`** (core): duplicate the current device
  selection in place through an internal clipboard entry (backs the studio's Ctrl+D
  on audio effects); paste inserts right after the selection and re-selects.
- **`StudioSettings`** (core, studio-app preferences surface): new
  `interface.show-output-track` (default false) and
  `time-display.count-bars-from-zero` (default false) settings.
- Upstream studio-app work not in the SDK surface: synthetic unit lanes in the timeline
  (selection/capture on lane bands, moving tracks, tree guides, gradients), collapse
  automation UI, output-track display when it has automation, snapping-grid hotkeys,
  history-swipe navigation guard over the timeline, output mute placement when solo is
  hidden.

## opendaw-headless follow-ups shipped with this upgrade

- **No code changes needed** — the release is additive for this repo's surfaces.
  `AudioBusFactory.create`'s dropped placeholder track does not affect
  `groupTrackLoading.ts` (verified: it never reads bus tracks). `npm ci`,
  `npx tsc --noEmit` (0 src errors), `npm run build`, and all 63 tests pass unchanged.
- `engine.wasm` binary verified changed vs 0.0.9 (SHA-256 differs) — the seam/pause fix
  ships in the installed dist. Every API claim above verified against the installed
  tarballs (`automationCollapsed`, `migrateUndefinedTracks`, `createSignalsmithRegion`,
  the `deleteAudioUnit` guard, `AudioUnitUserInterface`, `DevicesClipboard.duplicate`,
  and the removed `TrackBox.create` in `AudioBusFactory`).
- **Seam regression measured on 0.0.165** (`shared-source-double-process-debug-demo`,
  2026-08-05): all four cells (shared/distinct × block-aligned/off-boundary) scan at
  seam-Δ/pre-Δ = **1.00**, seam-band max |Δ| 0.02878 ≈ the clean-sine baseline 0.02880
  — touching seams stay transparent under the new release-tail implementation.
- **Full audio-verify suite re-run on 0.0.165** (seven scenarios, calibrated windows):
  raw 30/40 ms vs file (negative control vs grid 174/118 ms), varispeed 33/32 ms,
  timestretch 71/68 ms, signalsmith 17.9 ms, signalsmith-transposed 19.6/20.4 ms,
  grid-conform 30/35 ms, grid-rigid 33/33 ms vs placement (negative control vs clicks
  92/153 ms); pitch ordering 0.985 > 0.953; transpose rotation corr peaks at the
  3-semitone lag (0.682 vs −0.292 at 0). Cell-for-cell identical to the 2026-07-16
  WASM calibration — the engine declick rewrite regressed nothing.
- Docs updated: `documentation/09-editing-fades-and-automation.md` clean-edits section
  now describes the automatic edit-point crossfade; playback `CLAUDE.md` voice-crossfade
  section rewritten; resolution addendum added to `debug/splice-click-cross-file.md`
  (open question answered: automatic SDK handling); re-verify note added to
  `debug/time-pitch-start-position-pop.md`.
