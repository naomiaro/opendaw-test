# Time/Pitch start-position pop (suspected)

**Verified against:** OpenDAW SDK 0.0.154 (`@opendaw/studio-sdk@0.0.154`, `@opendaw/studio-core@0.0.152`, `@opendaw/studio-adapters@0.0.116`).

**Repro page:** [`time-pitch-start-position-debug-demo.html`](../time-pitch-start-position-debug-demo.html) (unlisted).

**Status:** Awaiting empirical confirmation. The page reproduces the configuration; whether the pop fires in this build has not yet been verified by ear at runtime. Update this note once it has.

## Suspected symptom

User reports an audible pop when starting playback partway into a silent section of an audio file that has `AudioTimeStretchBox` attached at `playbackRate = 1.0` (no actual stretching applied). The report was on `public/audio/DarkRide/06_Vox.opus`, which has obvious silence at the head of the file and quieter gaps between vocal phrases later on.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/time-pitch-start-position-debug-demo.html
```

**HTTPS is required.** Accept the self-signed cert warning on first load.

1. Wait for Status to reach `Ready` (includes transient detection on the full 230 s file).
2. Click near the start of the waveform (the file's silent intro).
3. Press Play. Listen for a pop at the moment playback begins.
4. Press Stop, click into the middle of the song on a known-loud section, press Play. Compare — is the pop absent or quieter when starting from audible content?
5. (Optional) Move the cents slider off zero and repeat — does the pop change with active stretching vs unit rate?

Configuration: BPM 124, single Tape track, one `AudioRegionBox` at `position = 0` with `duration = fullDurationPpqn`, `timeBase = Musical`. `AudioTimeStretchBox` attached via `playMode.refer`, with `playbackRate = 1.0`, `transientPlayMode = Pingpong`, and two default warp markers `(0, 0)` and `(durationPpqn, durationSeconds)`.

## Mechanism

**Not yet identified.** Candidate-related investigations to consider once the symptom is empirically observed and isolated:

- [`fade-out-end-of-file-pop.md`](./fade-out-end-of-file-pop.md) — `PitchVoice`'s 20 ms internal fade interacts with `lane.fadingVoices` processed at unit gain, bypassing the region fade. If voice creation at playback start follows a similar path, a start-of-play fade-in could miss the region's effective amplitude.
- [`voice-fadein-clip-fadein-product.md`](./voice-fadein-clip-fadein-product.md) — `PitchVoice` fade-in multiplies with the clip's gain buffer, turning linear ramps quadratic. Not obviously the same path, but listed for completeness if voice-fade-in processing differs under TimeStretch.
- [`splice-click-cross-file.md`](./splice-click-cross-file.md) — cross-file region boundaries click without explicit fades; mentioned only as a general "voice-boundary discontinuity" reference, not a likely match for this configuration (single file, single region).

Source-tracing should start at `TapeDeviceProcessor.#updateOrCreatePitchVoice` and the `PitchVoice` constructor's initial state; identify whether a new voice on a region with TimeStretch attached enters with a fade-in distinct from the NoStretch / PitchStretch paths.
