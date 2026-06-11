# Time/Pitch start-position pop in mid-file silent gaps

**Verified against:** OpenDAW SDK 0.0.154 (`@opendaw/studio-sdk@0.0.154`, `@opendaw/studio-core@0.0.152`, `@opendaw/studio-adapters@0.0.116`).

**Repro page:** [`time-pitch-start-position-debug-demo.html`](../time-pitch-start-position-debug-demo.html) (unlisted).

**Status:** Empirically confirmed by ear on 2026-06-09 against the repro page above. The artifact reproduces on **mid-file silent gaps bracketed by audio**, not on the file's head silence — see the contrast pair below. Mechanism is not yet identified.

**Refined 2026-06-09:** The pop **does not reproduce in NoStretch mode** (same file, same click position, region's `playMode` pointer left empty). The artifact is **TimeStretch-specific** — it requires `AudioTimeStretchBox` to be attached. This rules out the engine voice-management path (which is identical in both modes) and points the mechanism into the `AudioTimeStretchBox` processing path.

**Refined 2026-06-09:** The pop reproduces **identically at `transientPlayMode = Once`, `Repeat`, and `Pingpong`** (verified by ear via the demo's SegmentedControl). Segment-replay behaviour at voice creation is therefore NOT the mechanism. The two remaining candidates in the Mechanism section are transient-segment quantization at `setPosition` and stretcher lookback/windowing.

**Refined 2026-06-09:** The pop's pitch **tracks the cents slider** — different `playbackRate` values produce the artifact at different audible pitches, shifted by the corresponding amount. This confirms the artifact is **actual audio content being rendered through the stretcher's pitch-shift pipeline**, not a glitch / discontinuity / sample-step / voice-fade artifact (those would all be rate-independent). The remaining mechanistic question is where the content comes from; both remaining candidates (segment quantization, stretcher lookback) are consistent with this. Rate-independent explanations are ruled out.

## Symptom

An audible pop fires at the moment playback begins when the engine playhead is positioned inside a silent gap *between* audio sections of a file that has `AudioTimeStretchBox` attached at `playbackRate = 1.0` (no actual stretching applied). The pop is absent when starting playback at the file's head silence — i.e. silence that has no preceding audio.

The observed pattern:

| Start position | Play mode | Pop? |
| --- | --- | --- |
| Head of file (silence with no preceding audio) | TimeStretch | no |
| Mid-file silent gap (silence bracketed by audio) | TimeStretch | yes |
| Mid-file silent gap (same position as above) | NoStretch | no |

The asymmetry along two axes — head vs mid-file silence, and TimeStretch vs NoStretch — is the constraint the mechanism must explain. Silence alone isn't sufficient (head-silence in TimeStretch is clean); the voice path alone isn't sufficient (NoStretch on the same gap is clean). Both conditions must hold: the engine must be reading via `AudioTimeStretchBox` AND landing in a silent window bracketed by audio.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/time-pitch-start-position-debug-demo.html
```

**HTTPS is required.** Accept the self-signed cert warning on first load.

1. Wait for Status to reach `Ready` (includes transient detection on the full 230 s file).
2. **Negative control:** click near the start of the waveform (within the first ~1 s — the file's head silence). Press Play. No pop.
3. **Positive case:** Press Stop. Click into a low-amplitude gap between vocal phrases in the middle of the song (look for a short flat section visually surrounded by tall peaks). Press Play. Pop fires at the start of playback.
4. Repeat the positive case at multiple gaps to confirm.
5. **Negative control 2:** Use the **NoStretch / TimeStretch** SegmentedControl above the Play/Stop row to switch to NoStretch. Click the same mid-file silent gap as step 3. Press Play. **No pop** — confirms the artifact is TimeStretch-specific.

Configuration: BPM 124, single Tape track, one `AudioRegionBox` at `position = 0` with `duration = fullDurationPpqn`, `timeBase = Musical`. `AudioTimeStretchBox` attached via `playMode.refer`, with `playbackRate = 1.0`, `transientPlayMode = Pingpong`, and two default warp markers `(0, 0)` and `(durationPpqn, durationSeconds)`. Audio file: `public/audio/DarkRide/06_Vox.opus` (stereo, 48 kHz, 230.59 s).

## Mechanism

**Not yet identified.** The two-axis asymmetry — head-vs-mid file silence AND TimeStretch-vs-NoStretch — rules out generic voice-creation artifacts (NoStretch fires the same voice path and is clean). The mechanism lives inside `AudioTimeStretchBox`'s processing of a `setPosition` that lands inside a silent window bracketed by audio. The pitch-tracks-cents finding further constrains it to a code path that emits actual audio content through the stretcher's pitch-shift pipeline — not a glitch, sample-step, or DC discontinuity.

Source-tracing should focus on:

- **Transient-segment quantization at voice creation.** `AudioTimeStretchBox` reads via warp markers and segments audio at transient markers. The diagnostic question: when the engine sets position to a PPQN inside a silent gap, does the voice's initial read pull samples from the transient segment *containing* that PPQN — which would put the read window at the transient marker bracketing the gap, i.e. inside the surrounding audio?
- **Stretcher lookback / windowing.** Many time-stretching DSP paths require a lookback window to seed phase / segment state. If that window straddles the silent gap and pulls from the preceding audio, the first emitted samples would be non-zero where the visual playhead suggests silence.

**Ruled out:** Pingpong-mode replay at segment start — verified by ear that the pop reproduces identically at `Once`, `Repeat`, and `Pingpong`. Segment-replay choice is not the mechanism.

Previously listed candidate-related notes (`fade-out-end-of-file-pop.md`, `voice-fadein-clip-fadein-product.md`, `splice-click-cross-file.md`) all describe artifacts in the engine's voice path, which is shared by NoStretch and TimeStretch. The NoStretch-clean observation rules them out as direct causes for this artifact.

## Open questions

Not yet tested at the time of writing this note:

- **PitchStretch comparison:** does `AudioPitchStretchBox` (varispeed) reproduce the pop, or only `AudioTimeStretchBox` (transient-aware)? Would isolate whether the artifact is unique to the transient-segment processing or shared by both stretchers.
- **Region-trim variant:** does the pop reproduce on a region whose `duration < fullDurationPpqn` such that the gap sits inside the trimmed region? Would isolate whether `loopOffset` / `loopDuration` interact with the symptom.

---

## Addendum 2026-06-11 — mechanism identified; mode-swap reset RESOLVED (core 0.0.152)

### Mode-swap "playhead reset" RESOLVED

`TimeInfo` (`core-processors/src/TimeInfo.ts`) is written only by explicit transport commands (`#play` / `#stop` / `#setPosition` / `#reset` / `#prepareRecordingState` (count-in) / `BlockRenderer` advance); no box-graph subscription writes position. A `postMessage`-interceptor probe over two live swaps (click at 92.14 s, BPM 124, `06_Vox`) captured exactly one position write per swap — the debug page's then-ungated post-swap `setPosition` call (gated on live `isPlaying` as of this branch). The playhead trace over 8027 samples is monotonic except for two jumps landing exactly at the write target. The ungated reset was the confounder: mid-playback it **causes** the jump it was intended to guard against. Removing the mid-playback call (now gated on `!isPlaying`) eliminates the jump. The SDK itself does not reset position on a mode swap.

### Mechanism for the audible "restart" on engaging TimeStretch

`TimeStretchSequencer.#handleTransientBoundary` starts each new voice at:

```
voiceStartSamples = startSamples − fadeSamplesInFile
```

where `startSamples = transient.position × sampleRate` — the **segment onset** (the transient marker before the playhead), not the playhead's intra-segment offset. Engaging TimeStretch mid-segment therefore rewinds audio content to the previous transient onset and hard-realigns at the next boundary, producing the audible content-from-earlier-in-the-file effect.

### Likely mechanism for this note's mid-file-silent-gap pop

The same `#handleTransientBoundary` line is the most consistent explanation for the silent-gap pop: starting playback inside a gap makes `floorLastIndex` select the onset **before** the gap, causing the stretcher to replay that phrase's onset through the pitch-shift pipeline where the timeline says silence. This is consistent with all five recorded empirical facts:

1. Pitch tracks the cents slider (audio content, not a glitch).
2. Identical across `Once` / `Repeat` / `Pingpong` (segment-replay mode is not the variable).
3. Head silence clean (no preceding transient ⟹ `floorLastIndex < 0` ⟹ no voice emitted).
4. NoStretch clean (no `AudioTimeStretchBox` path; `floorLastIndex` not consulted).
5. Mid-file silent gap with TimeStretch: gap has a preceding transient ⟹ voice emits pre-gap content.

**Suggested SDK fix:** clamp voice start to `max(segmentStart, playhead-in-file position)`, or suppress emission until the timeline position catches up to the segment onset — so that starting playback inside a silent gap produces silence rather than the preceding phrase.
