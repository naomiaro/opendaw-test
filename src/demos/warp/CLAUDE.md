# Warp Demos — OpenDAW SDK Reference

### Beat Maps → SDK Machinery
- `.beats` parsing and beat-map math live in `src/lib/beats/` (pure, no SDK imports, vitest-covered).
  Demos only create boxes from the results — keep new beat-map math there, not in demo files.
- Warp anchors are engine-agnostic: `buildWarpAnchors()` output feeds AudioPitchStretchBox and
  AudioTimeStretchBox identically. Only the box type changes between varispeed and time-stretch.
- ~513 WarpMarkerBox creations in one `editing.modify()` are fine. WarpMarkerBox.owner is a
  mandatory pointer — deleting the stretch box cascades to its markers; repeated mode toggles
  do not accumulate boxes.

### Tempo-Event Density Limit
- Box creation in `editing.modify()` costs ~1.2 ms/box, deletion ~1.5 ms/box. 510 tempo events
  in one transaction = 594 ms create / 743 ms delete — too slow for an interactive toggle.
- Use `barsToTempoEvents()` (per-downbeat, ~130 events, ~110-160 ms) for tempo-track conforms.
  `beatsToTempoEvents()` (per-beat) is the exact reference conversion — use it only for
  precomputed/static projects, never behind a UI toggle.
- A pickup needs TWO lead-in tempo events (tick-0 audio-start anchor + pickup-span event at
  firstBeatTick). One constant lead-in BPM cannot anchor both the audio start and the first
  downbeat — the audio plays offset from the grid (90 ms for Otherside) and per-bar residual
  readouts that compare the tempo map against itself will NOT catch it. Verify audio placement
  against `tempoMap.ppqnToSeconds(firstBeatTick) === clipStartSeconds(markers)`.

### Grid-Follows-File Regions
- Keep the region `TimeBase.Seconds` — a Musical region stretches under the conformed tempo
  map, silently defeating the raw-audio comparison.
- `region.waveformOffset.setValue(s0)` trims the file's pre-beat lead-in (raw seconds shift on
  the engine read position) without touching loopOffset.
- `timelineBox.loopArea` is PPQN — a loop end set in ticks stays musically aligned under both
  rigid and conformed tempo maps.

### Demo UI
- Default `loopArea.to` is 15360 PPQN — set it to the full timeline length in setup AND in every
  mode-switch transaction that changes the timeline length (warped tick end ≠ raw seconds end).
- `pointer-events: none` on a wrapper div is mouse-only and blocks ALL descendants (children
  cannot re-enable). Disabled-state wrappers for sibling controls with different conditions must
  be siblings, and keyboard activation (Tab + Enter fires onValueChange) needs an explicit
  state guard in the handler.
- `transientPlayMode` writes do not reset engine.position — safe live control during playback.
  `playbackRate` writes do reset it.

## Reference Files
- Beat math: `src/lib/beats/beatMapConversions.ts` (anchors, tempo events, integration invariant tests)
- Shared setup: `src/demos/warp/lib/setupWarpDemo.ts`; waveform: `src/demos/warp/lib/WarpWaveform.tsx`
- Source tutorial: warp-markers repo (chapters 07-09 + in-the-wild appendix), local checkout path in `.claude/local.md` if present
