# Playback Demos — OpenDAW SDK Reference

### Playback
```typescript
// Set playback position (in PPQN - pulses per quarter note)
project.engine.setPosition(0);

// Start playback
project.engine.play();

// Wait for all audio samples to be loaded before playing
// NOTE: loadTracksFromFiles() calls this automatically before returning,
// so you only need this for recordings or manually created tracks
await project.engine.queryLoadingComplete();
// NOTE: queryLoadingComplete() resolves before SamplePeaks worker finishes
// (~120ms gap). To get peaks, use sampleLoader.subscribe() and wait for
// state.type === "loaded". Direct sampleLoader.peaks read immediately after
// loadTracksFromFiles returns will be empty.
```

### Timeline and Loop Area
```typescript
project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(duration);
  project.timelineBox.loopArea.enabled.setValue(false);
});

// BPM and time signature
project.timelineBox.bpm.setValue(120);
project.timelineBox.signature.nominator.setValue(4);
project.timelineBox.signature.denominator.setValue(4);
```

### Clip Fades
```typescript
// Fades are relative to region start, NOT the timeline.
// fillGainBuffer computes: startPpqn = cycle.resultStart - regionPosition
// If the region spans full audio but playback is mid-file, fades at the
// edges are never reached (early-return keeps gain at 1.0).
//
// To make fades audible, trim regions to short clips:
project.editing.modify(() => {
  adapter.box.position.setValue(clipStartPPQN);      // where on timeline
  adapter.box.duration.setValue(clipDurationPPQN);    // clip length
  adapter.box.loopOffset.setValue(clipStartPPQN);     // where to read in audio
  // loopDuration can stay at full audio length
});

// Fades can be set in the same transaction as region changes
project.editing.modify(() => {
  // Region trimming + fades together
  adapter.box.position.setValue(clipStartPPQN);
  adapter.box.duration.setValue(clipDurationPPQN);
  adapter.box.loopOffset.setValue(clipStartPPQN);

  adapter.fading.inField.setValue(fadeInPPQN);
  adapter.fading.outField.setValue(fadeOutPPQN);
  adapter.fading.inSlopeField.setValue(slope);  // 0.25=log, 0.5=linear, 0.75=exp
  adapter.fading.outSlopeField.setValue(slope);
});
```

### Fades Can Share a Transaction with Region Changes
Fading values (in, out, slopes) can be set in the same `editing.modify()` as
region property changes (position, duration, loopOffset). No separate transaction needed.

### FadingAdapter Convenience Methods
Beyond field access, `adapter.fading` provides:
- `.hasFading` — `true` if any fade value is non-zero (quick check before rendering)
- `.copyTo(targetAdapter)` — copy all fade settings (in, out, slopes) to another region's fading
- `.reset()` — clear all fades to zero (in, out, inSlope, outSlope)
- `.in` / `.out` — current fade values (read-only shorthand)
- `.inSlope` / `.outSlope` — current slope values (read-only shorthand)

### Region Adapter Full API (AudioRegionBoxAdapter)
Beyond `.box`, `.fading`, `.file`:
- `.playMode` — audio play mode
- `.offset` — content offset
- `.loopOffset` / `.loopDuration` — loop boundaries
- `.fadeIn` / `.fadeOut` — fade values (PPQN)
- `.moveContentStart(delta)` — shift content start position
- `.resolveLoopDuration(ppqn)` — compute duration at position
- `.valueAt(ppqn)` — read value at position
- `.copyTo({ target })` — copy region to another track (`target` is the pointer field)
- `.consolidate()` — bake loop into single region
- `.mute` / `.label` / `.hue` — region metadata
- `.isSelected` — selection state
- `.canResize` / `.canMirror` — capability flags

### Audio Play Modes (Time & Pitch)
`AudioRegionBox.playMode` is `Option<AudioPlayMode>` → either `AudioPitchStretchBox`
(varispeed — warp markers only, pitch follows tempo) or `AudioTimeStretchBox`
(transient-aware + independent pitch via `cents`, clamped to ±1200 via
`playbackRate` ∈ [0.5, 2.0]). Empty pointer = NoStretch (default, plays at source speed).
Adapter accessors: `isPlayModeNoStretch`, `asPlayModePitchStretch`,
`asPlayModeTimeStretch`, `optWarpMarkers`, `observableOptPlayMode`. Names are
counterintuitive — PitchStretch is the *simple* mode; TimeStretch is the sophisticated one.
See `documentation/18-time-and-pitch.md`.

### TimeStretch Renders Silence Without Transients
`AudioTimeStretchBox` needs ≥2 `TransientMarkerBox` entries on the *file* box
(not the region) or the engine produces silence with no error. Detect with
`Workers.Transients.detect(audioData): Promise<number[]>` from `@opendaw/studio-core`
(worker, non-blocking) or `TransientDetector.detect(audioData): number[]` from
`@opendaw/lib-dsp` (sync, main thread). Reusable helper at `src/lib/transientDetection.ts`
takes any `AudioBuffer` and is idempotent.

### Play-Mode Swap Needs Two Transactions
Swapping `region.playMode` in one `editing.modify()` races pointer resolution.
Split: transaction 1 = `region.playMode.defer()` + delete old stretch box +
flip `timeBase`; transaction 2 = create new stretch box + warp markers +
`region.playMode.refer(next)`. Same caveat as `createInstrument` + `output.refer`.

### AudioFileBoxAdapter Audio Data Access
`.audioData: Promise<AudioData>` (awaits sample loader), `.data: Option<AudioData>`
(sync, None if not loaded), `.transients: EventCollection<TransientMarkerBoxAdapter>`,
`.peaks: Option<Peaks>`. Prefer these over holding raw `AudioBuffer` refs.

### waveformOffset vs loopOffset
- `loopOffset` (PPQN) — controls which audio content maps to which timeline position. Affects audio read position indirectly through the `LoopableRegion.locateLoops()` formula: `offset = position - loopOffset` changes `rawStart`, which changes `elapsedSeconds`, which changes which samples are read. Used by `RegionEditing.cut()`, `clip-fades-demo`, and `comp-lanes-demo` to position audio within regions.
- `waveformOffset` (seconds, field 7 on AudioRegionBox) — a direct seconds offset added to the audio read position: `sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate`. Used to skip count-in audio during recording finalization.
- Both fields affect which audio is heard. `loopOffset` works in PPQN within the loop coordinate system; `waveformOffset` is a raw seconds shift applied after PPQN-to-seconds conversion.
- For waveform rendering, use `loopOffset` to compute the peaks frame range (visual), and `waveformOffset` for the engine read position offset (audio).

### Waveform Rendering (SDK 0.0.126+)
`PeaksPainter.renderBlocks()` was replaced by `PeaksPainter.renderPixelStrips()` with a new signature:
```typescript
PeaksPainter.renderPixelStrips(context, peaks, channel, {
  x0, x1,       // pixel x range on canvas
  y0, y1,       // pixel y range on canvas
  u0, u1,       // frame range in peaks data
  v0: -1.001, v1: 1.001 // amplitude range — note the headroom (see below)
});
```
**IMPORTANT:** `renderPixelStrips` uses the current `ctx.fillStyle` — set it before calling.
It does NOT accept color parameters. Without setting fillStyle, waveforms are invisible.

**Float16 unpack quirk — always use ±1.001, not ±1.0:** The SDK packs peaks as Float16 and
the unpack at `lib-std/numeric.ts` rounds away from zero on power-of-two boundaries. A peak
stored as exactly ±1.0 unpacks to ±1.0001219511032104 (the upper bucket edge). With
`v0: -1, v1: 1`, full-scale audio renders as flat-top "square" waveforms because the
renderer clamps unpacked values to canvas bounds. Use ±1.001 at every call site to absorb
this. Audio that genuinely exceeds ±1.001 still surfaces as clamping, so true over-range
input is not masked.

For reference, OpenDAW's own code uses two patterns: `SlotUtils.ts` hardcodes ±1.1 (10%
headroom for visual margin), and `studio/core/src/ui/renderer/audio.ts` parameterises as
`v0: -scale, v1: +scale` where `scale = dbToGain(-gain)`. Our ±1.001 is the minimum
sufficient value — tighter than OpenDAW's ±1.1 because we want full canvas height for
demo waveforms without visual compression.

### Mixer Groups (Sub-Mixing)
```typescript
import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";

// Create a group bus (routes to master by default)
project.editing.modify(() => {
  const audioBusBox = AudioBusFactory.create(
    project.skeleton,          // provides boxGraph + mandatory boxes
    "Rhythm",                  // group name
    IconSymbol.AudioBus,       // icon
    AudioUnitType.Bus,         // type
    Colors.blue                // color
  );
});

// IMPORTANT: Resolve pointers AFTER the creation transaction commits
const groupUnitBox = audioBusBox.output.targetVertex.unwrap().box;

// IMPORTANT: Re-route tracks in a SEPARATE transaction from createInstrument().
// Doing output.refer() in the same transaction as createInstrument() causes
// dual routing (audio reaches master both directly AND through the group).
project.editing.modify(() => {
  audioUnitBox.output.refer(audioBusBox.input);
});
```

### Dark Ride Audio
- BPM: 124 (pass to `initializeOpenDAW({ bpm: 124 })`)
- Stems: `public/audio/DarkRide/01_Intro` through `07_EffectReturns` (.opus + .m4a)
- Full song length (~235 seconds, ~117 bars at 124 BPM)
- All stems have silence at the beginning (intro/buildup)
- Guitar: audible content from bar 17+
- Drums: full drum pattern from bar 25+ (sparse/building before that)
- To skip silence: set `regionBox.waveformOffset.setValue(seconds)` to shift the audio read position
- For waveform rendering: compute peaks frame range from the PPQN offset into the audio

### localAudioBuffers Must Be Passed to initializeOpenDAW
The sample manager's fetch callback checks `localAudioBuffers` map at init time.
Create the map BEFORE calling `initializeOpenDAW`, pass it in, then pass the same
map to `loadTracksFromFiles`. Without this, the sample manager falls back to
OpenSampleAPI (CORS error in dev).
```typescript
const localAudioBuffers = new Map<string, AudioBuffer>();
const { project, audioContext } = await initializeOpenDAW({ localAudioBuffers, bpm: 124 });
const tracks = await loadTracksFromFiles(project, audioContext, files, localAudioBuffers);
```

### Region Sorting When Positions Match
When regions share the same position, sort by label for deterministic ordering:
`regionAdapters.sort((a, b) => labelIndex(a) - labelIndex(b))`
Set custom labels with `adapter.box.label.setValue("name")`.

### Demo Layout Structure
GitHubCorner, BackLink, content, and MoisesLogo all go *inside* `<Container>`, not as siblings.
See `src/looping-demo.tsx` for the reference layout pattern.

### Voice Crossfade on Region Boundaries
`RegionEditing.cut()` creates a new `PitchVoice` per region. Each voice has a
20ms fade-in/fade-out (`VOICE_FADE_DURATION` in `Tape/constants.ts`). The fade-out starts
from the current amplitude level, so transitions between consecutive regions are smooth.

Multi-track volume automation crossfades (`comp-lanes-demo.tsx`) remain a valid alternative
technique for complex comp workflows.

### Fade-In on Newly Created Regions May Not Apply
Setting `adapter.fading.inField.setValue()` on regions created by `RegionEditing.cut()`
/ `copyTo()` may not take effect in the audio engine, even when values read back
correctly. Fade-out on the original (left) region works reliably. Fade-in on the
new (right) region does not.

### Non-Overlapping Fades Create Pops
Fade-out + fade-in without overlap creates a V-shaped volume dip at the splice point.
For same-file consecutive regions, no fade is needed — the audio is already continuous.
Adding fades makes it worse. See `documentation/09-editing-fades-and-automation.md#advanced-region-splicing--comp-lanes`.

### Overlapping Regions Need Separate Tracks
Overlapping regions on a single track are **disallowed by design** in OpenDAW (Andre
confirmed 2026-05-21). The live engine tolerates them at runtime but `project.copy()`'s
validator deletes both regions, with console output `_AudioRegionBox _AudioRegionBox
Overlapping regions` → `Deleting 2 invalid boxes`. Anything that depends on `copy()`
(export, offline render via the standard `project.copy() → OfflineAudioContext →
AudioWorklets.createFor(...) → createEngine(...)` pattern) will produce silence with
no error. Any UI path that lets a user position two regions to overlap on one lane is
the bug, not the deletion.

For crossfade-via-overlap (e.g. linear crossfade between two regions that overlap by
the fade duration), put each region on its **own** Tape track. Each track has its own
`regions` collection; the overlap is between tracks and the crossfade emerges from
mixing the track outputs at the master. See `pure-webaudio-target-debug-demo.tsx` and
`voice-fadein-clip-fadein-product-debug-demo.tsx` for the working pattern, and
`debug/project-copy-deletes-overlapping-regions.md` for full context including the
sub-PPQN overlap footgun (an `Int32` `position` + `Float32` `duration` at non-integer
PPQN can produce a 0.5-PPQN overlap that triggers the same deletion without the
consumer intending any).

### Phase-Correlate Shifts: Don't Double-Compensate Source Delay
When applying a phase-correlation result via `loopOffset` to align two regions reading
different `AudioBuffer`s, the integer-sample shift returned by phase correlation
operates on the **raw resampled buffers** as they exist in memory and already encodes
whatever delay is between them — including any authored-time offset from the original
WAV (e.g. a file recorded with a known time delay) that survives `decodeAudioData`'s
resample.

Do not separately add a "source offset" or "file delay" seconds term on top of the
shift; the shift is absolute, not relative to a delay-corrected origin. Concretely, if
phase-correlate returns `shiftSamples = N` against the raw buffers, set
`loopOffset = (seam − halfFade) + N / sampleRate` for the incoming region — nothing
else. Adding `+ sourceDelaySeconds` on top double-counts the delay and produces a
phase mismatch at the seam (we measured −13.92 dB instead of the expected ~−1.16 dB
in `pure-webaudio-target-debug-demo.tsx` until this was fixed).

## Reference Files
- Comp lanes demo: `src/demos/playback/comp-lanes-demo.tsx`
- Looping demo: `src/demos/playback/looping-demo.tsx`
- Clip looping demo: `src/demos/playback/clip-looping-demo.tsx`
- Clip fades demo: `src/demos/playback/clip-fades-demo.tsx`
- Track editing demo: `src/demos/playback/track-editing-demo.tsx`
- TimeBase demo: `src/demos/playback/timebase-demo.tsx`
- Mixer groups demo: `src/demos/playback/mixer-groups-demo.tsx`
- Drum scheduling demo: `src/demos/playback/drum-scheduling-demo.tsx`
- Track loading: `src/lib/trackLoading.ts`
- Group track loading: `src/lib/groupTrackLoading.ts`
- Audio utilities: `src/lib/audioUtils.ts`
