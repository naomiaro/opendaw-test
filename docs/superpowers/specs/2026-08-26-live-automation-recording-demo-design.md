# Live Automation Recording Demo — Design

**Date:** 2026-08-26
**Status:** Approved design, pre-implementation
**Backlog:** item 4 of the post-0.0.170 demo backlog (user-approved list)
**Docs anchor:** `documentation/09-editing-fades-and-automation.md` → "Live Automation Recording"

## Purpose

Demonstrate the SDK's latch-based live automation recording: drag sliders while the
transport records and watch value regions appear on automation lanes in real time.
Complements `track-automation-demo` (programmatic event creation) with the capture
side: real gestures → `RecordAutomation` → `ValueRegionBox` events → RDP
simplification → playback that rides the recorded curves — plus the
`AutomationSuspension` manual-override rule during non-recording playback.

## Page structure (Approach A — DAW-style arrangement panel)

One timeline panel with **three automation lanes on a shared time axis** (4 bars at
122 BPM, extending if overdubs run long), each lane paired with a DAW-style track
header on the left. A single playhead overlay spans all lanes.

Lane header contents: parameter name, slider (Radix), live numeric value, status
badge (idle / REC / OVERRIDE).

## Audio path & recordable parameters

- Tape instrument audio unit; **BassDrums30 loop** as an audio region, looped over
  4 bars; project tempo **122 BPM** (measured value — see memory
  `project_bassdrums30_bpm_122`).
- One insert effect on the unit — candidate: SDK **Delay**, recording its `wet`
  param (`DefaultDecibel` mapping). Exact factory + field name verified against the
  installed d.ts during implementation; any comparable always-audible effect param
  is an acceptable substitute if Delay's surface differs.
- Three recordable parameters, each resolved to its
  `AutomatableParameterFieldAdapter` through the adapter layer:
  1. Audio unit **volume**
  2. Audio unit **panning**
  3. Effect **wet**
- `settings.recording.automationEnabled = true` set explicitly (default, but it is
  the demo's subject); `recording.countInBars = 0` so Record starts immediately.

## Recording flow

- Transport: **Record / Play / Stop** buttons (real click required to start audio).
- Slider gestures write via `project.editing.modify(() => adapter.setUnitValue(v))`.
  Implementation checks the `Editing` d.ts for a no-undo-mark variant so a drag
  doesn't spam the undo stack; if none exists, accepted demo tradeoff (noted in
  page copy).
- Automation lanes are **not pre-created**: `RecordAutomation` resolves the lane via
  `adapter.optTracks()` fallback (the parameter's audio unit) — first write during
  recording creates the track/region, which itself demonstrates the latch model.
  Verified at implementation; fallback plan is pre-creating the three automation
  tracks via `project.api.createAutomationTrack` if required.
- Latch model on display: **any** write while `engine.isRecording` opens the take;
  only transport stop or a loop wrap closes it.

## Lane rendering

- Each lane is a canvas using the repo's CanvasPainter (debounced) pattern; regions
  and events read via `ValueRegionBoxAdapter` traversal of the parameter's
  automation track.
- Invalidation: `project.editing.subscribe(() => painter.requestUpdate())` for
  box-graph-driven repaints, plus an AnimationFrame `requestUpdate()` loop **only
  while recording** so the lane fills live under the playhead.
- Playhead: one absolutely-positioned DOM overlay across all lanes, written
  directly in an AnimationFrame callback (no per-frame setState), following the
  border-box alignment rules in CLAUDE.md.
- Colors from `CANVAS_COLORS` (`src/lib/design/consoleTheme.ts`).

## Playback & AutomationSuspension

- During playback each slider follows its recorded curve: subscribe to the
  parameter adapter's value observable (`catchupAndSubscribe`); a guard flag
  distinguishes observable-driven updates from user gestures.
- **Manual override**: a gesture while `isPlaying && !isRecording` triggers the
  SDK's built-in `AutomationSuspension` rule (engine suspends that lane's
  automation; suspensions drop on pause/stop/stopRecording). Demo surfaces it:
  badge flips to **OVERRIDE**, lane curve dims; clears on stop/pause. State is
  inferred locally (gesture + transport state); if the engine exposes a suspension
  observable in the d.ts, subscribe to that instead.

## Automation mode selector

- Segmented control **read / touch / latch** (`AutomationMode` from
  `@opendaw/studio-adapters`), wired for real to
  `parameterFieldAdapters.setMode(address, mode)`.
- Educational callout beside it: the engine never calls `getMode()` — recording
  always behaves latch-like regardless. The control demonstrates the storage API
  honestly without pretending it changes behavior.

## Loop recording overdubs

- Loop toggle sets a 4-bar timeline loop (loop area + enabled flag on the timeline
  box). Recording across a wrap finalizes the current take at the boundary and
  opens a new region; each pass renders as a distinct region outline labeled
  "pass 1 / pass 2 / …".

## RDP simplification readout

- During a take, count raw writes per parameter via
  `parameterFieldAdapters.subscribeWrites`.
- On take finalize (stop or loop wrap), read the final region's event count.
- Per-lane stat line: `142 writes captured → 9 events kept (RDP ε = 0.01)`.

## Preset curve comparison (ghost overlay)

- Per lane, a picker offering 2–3 preset shapes from the existing
  `trackAutomationPresets.ts` (e.g. linear fade, S-curve), drawn as a **dashed
  ghost line** over the recorded curve — comparison only, no box-graph mutation,
  no second region. Caption notes presets are what `track-automation-demo` writes
  programmatically.

## Files

**New**
- `live-automation-recording-demo.html` (entry: meta/OG tags, GoatCounter; listed demo, no noindex)
- `src/demos/automation/live-automation-recording-demo.tsx`
- Supporting lane components in `src/demos/automation/` (reuse `AutomationCanvas.tsx` where possible; variant component if not)
- `public/og-image-live-automation-recording.png` (1200×630)

**Touched**
- `vite.config.ts` (rollup input), `src/index.tsx` (card), `public/sitemap.xml`,
  README (demo table + source-tree listing)
- `documentation/09-editing-fades-and-automation.md`: replace "Standalone Demo
  (Future)" with a reference to the shipped demo (present tense, no version pins)
- `src/demos/automation/CLAUDE.md`: new SDK knowledge from the build
  (RecordAutomation lane resolution, suspension observability, slider-drag
  transaction pattern)

## Verification

- `npx tsc --noEmit` → zero `^src/` lines; `npm run build` passes.
- Browser verification on the **reused** dev server (no fresh `npm run dev`):
  - Real click on Record; drive sliders via the Radix `End`/`Home` key pattern.
  - Assert value regions + events exist in the box graph (React-fiber `project` handle).
  - RDP readout shows captured > kept.
  - Audible output confirmed via analyser RMS tap.
  - OVERRIDE badge appears on a gesture during non-recording playback and clears on stop.
  - Loop overdub: record across ≥1 wrap, assert ≥2 regions on a lane.
- Standard flow: feature branch → PR → `/pr-review-toolkit:review-pr` applicable
  aspects → fix Critical/Important → squash-merge. Delete this spec in the PR that
  completes the work.

## Out of scope

- Touch/read mode engine behavior (engine has no mode distinction yet).
- Writing preset curves into the box graph (covered by `track-automation-demo`).
- MIDI-controller-driven automation writes.
