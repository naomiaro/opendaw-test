# Time/Pitch start-position pop in mid-file silent gaps

**Verified against:** OpenDAW SDK 0.0.154 (`@opendaw/studio-sdk@0.0.154`, `@opendaw/studio-core@0.0.152`, `@opendaw/studio-adapters@0.0.116`).

**Repro page:** [`time-pitch-start-position-debug-demo.html`](../time-pitch-start-position-debug-demo.html) (unlisted).

**Status:** Empirically confirmed by ear on 2026-06-09 against the repro page above. The artifact reproduces on **mid-file silent gaps bracketed by audio**, not on the file's head silence — see the contrast pair below. Mechanism is not yet identified.

## Symptom

An audible pop fires at the moment playback begins when the engine playhead is positioned inside a silent gap *between* audio sections of a file that has `AudioTimeStretchBox` attached at `playbackRate = 1.0` (no actual stretching applied). The pop is absent when starting playback at the file's head silence — i.e. silence that has no preceding audio.

The observed pattern:

| Start position | Pop? |
| --- | --- |
| Head of file (silence with no preceding audio) | no |
| Mid-file silent gap (silence bracketed by audio on both sides) | yes |

The head-vs-mid split is the load-bearing observation: silence by itself isn't sufficient to trigger the artifact; the engine must be landing the playhead in a silent window that has audio on one or both sides.

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

Configuration: BPM 124, single Tape track, one `AudioRegionBox` at `position = 0` with `duration = fullDurationPpqn`, `timeBase = Musical`. `AudioTimeStretchBox` attached via `playMode.refer`, with `playbackRate = 1.0`, `transientPlayMode = Pingpong`, and two default warp markers `(0, 0)` and `(durationPpqn, durationSeconds)`. Audio file: `public/audio/DarkRide/06_Vox.opus` (stereo, 48 kHz, 230.59 s).

## Mechanism

**Not yet identified.** The head-vs-mid distinction is the constraint the mechanism must explain — anything that fires uniformly on silence (e.g. a voice-creation fade-in into silent audio, a generic start-of-playback discontinuity) is ruled out by the head-silence negative control.

Candidate-related investigations to weigh:

- [`fade-out-end-of-file-pop.md`](./fade-out-end-of-file-pop.md) — `PitchVoice`'s 20 ms internal fade interacts with `lane.fadingVoices` processed at unit gain, bypassing the region fade. A symmetric path on voice creation (where the lookback window pulls a buffer with non-unit content) would be consistent with the head-vs-mid asymmetry observed here.
- [`voice-fadein-clip-fadein-product.md`](./voice-fadein-clip-fadein-product.md) — `PitchVoice` enters new voices in `Fading`/`fadeDirection=1` for 20 ms and multiplies the voice fade with the clip's gain buffer. The 20 ms entry window straddles whatever audio sits behind the playhead at voice-creation time; in mid-file silent gaps that's audio from the preceding region/phrase.
- [`splice-click-cross-file.md`](./splice-click-cross-file.md) — referenced as a general voice-boundary discontinuity precedent; not a structural match for this configuration (single file, single region).

Source-tracing should start at `TapeDeviceProcessor.#updateOrCreatePitchVoice` and the `PitchVoice` constructor's initial state, with particular attention to the read window or stretcher segmentation lookup at voice-creation time. The diagnostic question is: when the playhead is set into a silent gap between two audio sections, does the voice's initial read pull samples from outside the gap (from the trailing edge of the preceding audio, or the leading edge of the following audio) in a way that's amplitude-mismatched with the silent target window?

## Open questions

Not yet tested at the time of writing this note:

- **Cents off zero:** does the pop persist, change in level, or vanish when `playbackRate != 1.0`? Would isolate whether the artifact is specific to the stretcher's unit-rate branch or rate-independent.
- **NoStretch / PitchStretch comparison:** does the same mid-file-gap start produce the pop without TimeStretch attached, or with `AudioPitchStretchBox` instead? Would isolate whether the artifact is TimeStretch-specific.
- **Region-trim variant:** does the pop reproduce on a region whose `duration < fullDurationPpqn` such that the gap sits inside the trimmed region? Would isolate whether `loopOffset` / `loopDuration` interact with the symptom.
