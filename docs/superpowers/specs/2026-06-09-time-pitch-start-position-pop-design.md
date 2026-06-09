# Time/Pitch Start-Position Pop Debug Demo — Design

**Date:** 2026-06-09
**Status:** Draft, awaiting user review
**Repo:** opendaw-headless
**Verified-against SDK:** to be filled in at implementation time (read from `node_modules/@opendaw/studio-sdk/package.json`)

## Background

The user reports an audible pop when starting playback partway into `public/audio/DarkRide/06_Vox.opus` at a position where the underlying audio is digital silence, with `AudioTimeStretchBox` (TimeStretch play-mode) attached to the region. The symptom is suspected to interact with one of the open voice/fade investigations already documented under `debug/`:

- `debug/fade-out-end-of-file-pop.md` — `PitchVoice`'s 20 ms end-of-file fade bypasses the region fade gain on `lane.fadingVoices`.
- `debug/voice-fadein-clip-fadein-product.md` — `PitchVoice` fade-in multiplies with the clip's gain buffer, turning linear clip fade-ins into quadratic ramps.
- `debug/splice-click-cross-file.md` — Cross-file region boundaries click without explicit fades.

We do not yet know whether this report is a fourth distinct symptom or a manifestation of one of the above under the TimeStretch processing path. The purpose of this work is to produce a minimal, reproducible repro page so the symptom can be heard reliably and a mechanism investigation can follow.

## Goal

Build an unlisted debug demo page that loads `06_Vox.opus`, attaches `AudioTimeStretchBox` to a single full-file region at `playbackRate = 1.0` (no actual stretching applied), renders the file's waveform, and lets the user click anywhere on the waveform to set the engine start position before pressing Play. The user listens for a pop when starting in silent regions of the file.

Ship the page alongside an initial `debug/time-pitch-start-position-pop.md` note describing the symptom and the repro steps. The mechanism section starts as an explicit "not yet identified" placeholder and is updated only after the symptom is heard and source-traced.

## Non-goals

- Offline-render sample-delta scan. The other debug demos include this as a diagnostic; here it is a follow-up, gated on whether the pop is audible.
- PitchStretch (varispeed) path. Out of scope for this first cut — TimeStretch only, per user direction. May be added later if the symptom turns out to be mode-independent.
- A fix. This page documents and reproduces; remediation is a separate decision.
- Hooking up cents / pitch adjustment to the slider as an additional axis of investigation. The cents slider is included in the UI but starts at 0 and the default-engaged configuration is `playbackRate = 1.0`. The slider exists so we can rule out "pop only fires when stretching is doing real work" without leaving the demo.

## User-facing flow

1. Visit `https://localhost:5173/time-pitch-start-position-debug-demo.html` (HTTPS required by the project dev server).
2. Page loads, status badge progresses through `Loading → Detecting transients → Ready`.
3. Waveform of the full Vox file renders in the centre card. A vertical line marks the current start position (initially 0 s).
4. Click anywhere on the waveform → start position updates to that fraction of the file. The line moves; a "Start: 12.345 s" label updates.
5. Press **Play**. Engine plays from the chosen position. Listen for a pop at the moment playback begins.
6. Press **Stop** to halt. Click a new position and try again.

The cents slider (-1200 .. +1200) is present in the controls card. Moving it off zero updates `playbackRate` while playing or stopped. Default is 0.

## Architecture

**Box-graph configuration (single `editing.modify` at init):**

- One Tape instrument track via `project.api.createInstrument(InstrumentFactories.Tape)`.
- One `AudioFileBox` for the Vox file, registered in the `localAudioBuffers` map before `initializeOpenDAW` runs (per the project CLAUDE.md rule).
- Transient detection via `ensureTransientMarkers(project, audioFileBox, audioBuffer)` — throws if zero positions, ensuring TimeStretch can't silently produce silence.
- One `AudioRegionBox` covering the full file: `position = 0`, `duration = fullDurationPpqn`, `loopOffset = 0`, `loopDuration = fullDurationPpqn`, `timeBase = Musical`, `label = "Vox"`.
- One `AudioTimeStretchBox` attached via `region.playMode.refer(timeStretchBox)`, with `playbackRate = 1.0` and `transientPlayMode = Pingpong` (matches the existing `time-pitch-demo` default).
- Two default `WarpMarkerBox`es on the time-stretch box: `(0, 0)` and `(durationPpqn, durationSeconds)`.
- Timeline loop disabled, `loopArea.from = 0`, `loopArea.to = fullDurationPpqn`.

**Playback control:**

- `setStartPositionSeconds(seconds)` — convert to PPQN with `PPQN.secondsToPulses(s, bpm)`, `Math.round` (Int32 field), store in state; `project.engine.setPosition(ppqn)` is called immediately so the engine playhead is at the requested position before Play is pressed.
- `handlePlay()` — `audioContext.resume()` if not running (iOS Safari guard), then `project.engine.play()`. No additional `setPosition` call — already done above.
- `handleStop()` — `project.engine.stop(true)`.

**Cents slider:**

- `onCentsChange(value)` — `playbackRate = 2^(value/1200)`, clamped to `[0.5, 2.0]`, written via `editing.modify`. Independent of start position.

**Waveform rendering:**

- One `<canvas>` element, sized via `width = clientWidth * devicePixelRatio` on mount/resize, fixed visual size ~1100 × 140 px (single-channel — Vox is likely mono; if stereo, draw both channels stacked with 4 px padding, matching `useWaveformRendering`).
- Peaks via `audioFileBoxAdapter.peaks` (sync `Option<Peaks>`); a one-shot `sampleLoader.subscribe(state => state.type === "loaded" ? terminate + render : ...)` wakes the first render. After that, peaks are static — no per-frame painting needed.
- Render with `PeaksPainter.renderPixelStrips(ctx, peaks, channel, {x0, x1, y0, y1, u0: 0, u1: numberOfFrames, v0: -1.001, v1: 1.001})`. `ctx.fillStyle` set to `#4a9eff` before the call (the renderer reads it, doesn't accept colour params).
- Vertical playhead-line drawn on a separate overlay canvas (or directly on the same canvas after the peaks, since the peaks are redrawn only on resize). Implementation choice: simplest is to repaint peaks + line together whenever start position changes — full repaint is cheap at this size and rendering occurs only on user interaction.

**Click interaction:**

- `onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); const fraction = (e.clientX - rect.left) / rect.width; setStartPositionSeconds(fraction * durationSeconds); }}` — direct lift of the `comp-lanes-debug-demo` pattern.
- Click is allowed regardless of `isPlaying`; clicking during playback both updates the marker and seeks the engine. (This is intentional — the symptom is "pop on entering a silent region," so we want fast iteration without a Play/Stop cycle between attempts.)

**State:**

- `status: string`, `isPlaying: boolean`, `startSeconds: number`, `cents: number`, `transientCount: number | null`.
- `audioBufferRef`, `audioFileBoxRef`, `regionRef`, `stretchBoxRef`, `peaksRef`, `canvasRef`.
- All subscriptions returned by `catchupAndSubscribe` are stored in a cleanup array and terminated on unmount.

## File layout

- `time-pitch-start-position-debug-demo.html` — repo root, copies the structure of `fade-out-end-of-file-debug-demo.html`. Includes `<meta name="robots" content="noindex, nofollow">`. Title: "Time/Pitch Start-Position Pop Debug". No GoatCounter script (unlisted pages are not analytics-tracked).
- `src/demos/playback/time-pitch-start-position-debug-demo.tsx` — single-file React component, ~250–350 lines, follows the dark-amber Radix Theme used by the other debug pages.
- `debug/time-pitch-start-position-pop.md` — initial draft: Symptom (suspected, awaiting empirical confirmation), Repro steps, "Mechanism not yet identified" section with cross-references to `fade-out-end-of-file-pop.md`, `voice-fadein-clip-fadein-product.md`, and `splice-click-cross-file.md` as candidate-related investigations.
- `debug/README.md` — add an Index entry pointing at the new note and the new repro page.
- `vite.config.ts` — add the new HTML entry to `rollupOptions.input`.

Files explicitly NOT touched:

- `src/index.tsx` (no card on the landing page; this is unlisted).
- `public/sitemap.xml` (unlisted).
- Any analytics or OG-image config.

## Verification

Manual, in order:

1. `rm -rf node_modules/.vite && npm run dev`, open `https://localhost:5173/time-pitch-start-position-debug-demo.html`. Status reaches `Ready`. Waveform renders.
2. Click near the start of the file (the known-silent intro). Press Play. Listen.
3. Click in the middle of the file in a quieter section. Press Play. Listen.
4. Click on an audibly-loud peak. Press Play. Verify there is no pop (control case — establishes that the pop is silence-specific, not a universal start-of-play artifact).
5. Move the cents slider to ±200 c. Repeat steps 2 and 3. Does the pop differ in level / presence?

If the pop is heard, update `debug/time-pitch-start-position-pop.md` with the symptom description (which start positions, level relative to ambient, whether it's cents-dependent) and propose a candidate mechanism by source-tracing the relevant `PitchVoice` / `TapeDeviceProcessor` paths. The mechanism is marked **inferred** until empirically verified.

If the pop is NOT heard, update the same note with "Could not reproduce; configuration tried was X; report stands but is not currently audible with this configuration." This is still a useful record — empty results are saved, per the project's debug convention.

## Risks and unknowns

- **The pop may not reproduce in this configuration.** The user heard it in their own setup; ours may differ in BPM, audio file (the DarkRide Vox vs. the user's actual file), or path through the engine. If we can't hear it, the page still has documentation value but the investigation stalls until we get a more specific repro from the user.
- **Waveform peaks readiness timing.** `audioFileBoxAdapter.peaks` is `Option<Peaks>` and may be empty for ~120 ms after `queryLoadingComplete` resolves (peaks worker lag, documented in the project CLAUDE.md). Mitigated by the `sampleLoader.subscribe` one-shot.
- **Click-while-playing seek behaviour.** Calling `engine.setPosition` mid-playback may itself produce an artifact (this is a separate engine behaviour). If it interferes with the symptom, we will guard the click on `!isPlaying` and require a Stop / Play cycle. Decision deferred until we see whether it's a problem.
- **Transient detection cost on a ~235 s file.** Detection runs once at page init; expected to take a few seconds. Status badge covers this so the page doesn't appear hung.
- **Vox file channel count.** If 06_Vox.opus is stereo, the waveform renders two stacked channels. If mono, one channel. Detected from `audioBuffer.numberOfChannels` and handled at render time — no fork in the code path.

## Out of scope (potential follow-ups)

- Add PitchStretch mode toggle once the symptom is characterised under TimeStretch.
- Offline-render scan + sample-delta analysis (the `fade-out-end-of-file` / `shared-source-double-process` pattern), if the audible repro succeeds and we want empirical confirmation of a specific sample offset.
- Cross-link with `voice-fadein-clip-fadein-product.md` if the mechanism turns out to be the voice-fade-times-clip-gain interaction in a new disguise.
