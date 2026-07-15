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
  // slope = curve height at the fade midpoint; 0.5 = exact linear.
  // Pair by DIRECTION: natural/log pair = in 0.75 / out 0.25 (SDK defaults);
  // exp pair = in 0.25 / out 0.75. Out-gain = 1 − normalizedAt(t, outSlope).
  adapter.fading.inSlopeField.setValue(inSlope);
  adapter.fading.outSlopeField.setValue(outSlope);
});
```

### Fades Can Share a Transaction with Region Changes
Fading values (in, out, slopes) can be set in the same `editing.modify()` as
region property changes (position, duration, loopOffset). No separate transaction needed.

### FadingAdapter Convenience Methods
Beyond field access, `adapter.fading` provides:
- `.hasFading` — `true` if any fade value is non-zero (quick check before rendering)
- `.copyTo(target: Fading)` — copy all fade settings (in, out, slopes) to another region's
  fading. Param is the raw `Fading` box from `@opendaw/studio-boxes`, NOT another
  `FadingAdapter`. From two region adapters: `srcRegion.fading.copyTo(dstRegion.box.fading)`.
- `.reset()` — set `in`/`out` to 0; slopes go to the schema defaults (`inSlope` 0.75,
  `outSlope` 0.25), NOT zero
- `.in` / `.out` — current fade values (read-only shorthand)
- `.inSlope` / `.outSlope` — current slope values (read-only shorthand)

### Region Adapter Full API (AudioRegionBoxAdapter)
Beyond `.box`, `.fading`, `.file`:
- `.offset` / `.loopOffset` / `.loopDuration` — content/loop boundaries (settable)
- `.position` / `.duration` / `.complete` — timeline placement (settable)
- `.gain` — `MutableObservableValue<number>` for region gain (dB)
- `.optFile` — `Option<AudioFileBoxAdapter>` if file is resolvable
- `.observableOptPlayMode` — `ObservableOption<AudioPlayMode>` for play-mode swaps
- `.timeBase` — `TimeBase` (Musical or Seconds)
- `.optCollection` — `Option<ValueEventCollectionBoxAdapter>` for region automation
- `.asPlayModePitchStretch` / `.asPlayModeTimeStretch` / `.isPlayModeNoStretch` — play-mode checks
- `.optWarpMarkers` — `Option<EventCollection<WarpMarkerBoxAdapter>>`
- `.moveContentStart(delta)` — shift content start position
- `.resolveLoopDuration(ppqn)` / `.resolveDuration(ppqn)` / `.resolveComplete(ppqn)` —
  compute boundaries at a timeline position (looped regions)
- `.copyTo({ target, position?, duration?, loopOffset?, loopDuration?, consolidate? })` —
  copy region (`target` is the destination `RegionCollection` pointer field)
- `.consolidate()` — bake loop into single region
- `.mute` / `.label` / `.hue` — region metadata
- `.isSelected` — selection state
- `.canResize` / `.canMirror` / `.isMirrowed` — capability/state flags
- `.waveformOffset` — `MutableObservableValue<number>` (seconds offset into source audio)

Fades: use `.fading.in` / `.fading.out`. For automation values at a position, use
`ValueRegionBoxAdapter.valueAt(position, fallback)`.

### Audio Play Modes (Time & Pitch)
`AudioRegionBox.playMode` is `Option<AudioPlayMode>` → `AudioPitchStretchBox`
(varispeed — warp markers only, pitch follows tempo), `AudioTimeStretchBox`
(transient-aware + independent pitch via `cents`, clamped ±1200 by
`AudioTimeStretchBoxAdapter.cents` only — the underlying `playbackRate` field has
`"positive"` constraint and accepts any value), or `AudioSignalsmithBox` (SDK 0.0.159+:
Signalsmith phase-vocoder spectral stretch — warp markers + `transpose` float field
±24 st, no transient markers needed; adapter exposes `transpose`/`cents`). Empty
pointer = NoStretch (default, plays at source speed). Adapter accessors:
`isPlayModeNoStretch`, `asPlayModePitchStretch`, `asPlayModeTimeStretch`,
`asPlayModeSignalsmith`, `optWarpMarkers`, `observableOptPlayMode`. Names are
counterintuitive — PitchStretch is the *simple* mode; TimeStretch is the
sophisticated one. Mode-swap helpers: `AudioContentModifier.toPitchStretch` /
`toTimeStretch` / `toSignalsmith`. See `documentation/18-time-and-pitch.md`.

### AudioTimeStretchBox Is Transient-Segmented Even at rate=1.0
`AudioTimeStretchBox` processes audio in transient-bounded segments regardless of
`playbackRate` — not a sample-accurate pass-through even at rate=1.0. `transientPlayMode`
(`Once`, `Repeat`, `Pingpong`) governs segment-replay. For sample-accurate file playback
or as an A/B baseline ("is this artifact TimeStretch-specific?"), use NoStretch
(`region.playMode.defer()`, `timeBase = Seconds`, duration in seconds).

### TimeStretch Without Transients Renders Silence
`AudioTimeStretchBox` needs `TransientMarkerBox` entries on the *file* box (not
the region): fewer than 2 markers render silence (`transients.length() < 2` bails
before sequencing); ≥2 = normal musical use. Detect with `Workers.Transients.detect(audioData): Promise<number[]>`
from `@opendaw/studio-core` (worker, non-blocking) or `TransientDetector.detect(audioData):
number[]` from `@opendaw/lib-dsp` (sync, main thread). Reusable helper at
`src/lib/transientDetection.ts` — `ensureTransientMarkers` throws if detection
returns fewer than 2 positions so callers can't silently end up with a silent region.

### Play-Mode Swap Works in One Transaction
SDK pattern (per `AudioContentModifier.toPitchStretch` / `toTimeStretch`):
1. Create new stretch box
2. `region.playMode.refer(newBox)` — replaces previous target atomically; no
   `defer()` needed first
3. Re-own (or copy) the old box's warp markers
4. `oldBox.delete()` (now has no incoming references)
5. Flip `timeBase` to Musical (or Seconds when going to NoStretch)

Explicitly calling `defer()` then `refer(new)` in the same transaction recreates
the `createInstrument + output.refer` race; just don't — `refer()` alone does the
swap.

### engine.position vs Box Writes (audited at core 0.0.152 / SDK 0.0.154)
- `AudioTimeStretchBox.playbackRate` writes do NOT reset `engine.position` — refuted
  empirically (live write during playback, position advanced monotonically) and by
  source: the sequencer reads `playbackRate` per render block
  (`TimeStretchSequencer.ts:39-40`), and no SDK write path mutates the playhead.
  `transientPlayMode` likewise live-reads with no reset. Live cents/pitch controls do
  not need an `!isPlaying` gate for position safety.
- Play-mode swaps (`region.timeBase` + `duration` + `loopOffset` + `loopDuration` +
  `playMode`) do NOT reset `engine.position` — TimeInfo is written only by transport
  commands (`play`, `stop`, `setPosition`). The audible "restart" heard on mid-playback
  swaps is the TimeStretchSequencer starting a new voice at the enclosing transient segment's onset
  (rewinding content behind the playhead; SDK-side, not fixable from app code). A post-swap `setPosition` call is appropriate
  when stopped (convenience reposition for the next Play), but calling it mid-playback
  is itself the source of an audible jump. Gate post-swap `setPosition` on `!isPlaying`.
  See `debug/time-pitch-start-position-pop.md` for the full resolution.

### AudioFileBoxAdapter Audio Data Access
`.audioData: Promise<AudioData>` (awaits sample loader), `.data: Option<AudioData>`
(sync, None if not loaded), `.transients: EventCollection<TransientMarkerBoxAdapter>`,
`.peaks: Option<Peaks>`. Prefer these over holding raw `AudioBuffer` refs.

### waveformOffset vs loopOffset
- `loopOffset` (PPQN) — controls which audio content maps to which timeline position. Affects audio read position indirectly through the `LoopableRegion.locateLoops()` formula: `offset = position - loopOffset` changes `rawStart`, which changes `elapsedSeconds`, which changes which samples are read. Used by `RegionEditing.cut()`, `clip-fades-demo`, and `comp-lanes-demo` to position audio within regions.
- `waveformOffset` (seconds, field 7 on AudioRegionBox) — a direct seconds offset added to the audio read position: `sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate`. Used to skip count-in audio during recording finalization.
- Both fields affect which audio is heard. `loopOffset` works in PPQN within the loop coordinate system; `waveformOffset` is a raw seconds shift applied after PPQN-to-seconds conversion.
- `AudioRegionBoxAdapter.loopOffset` is a RAW box read with no TimeBase conversion —
  unlike `duration`/`loopDuration` (which convert seconds → PPQN in Seconds timeBase),
  the stored loopOffset value is treated as PPQN by `locateLoops` in BOTH timeBases,
  despite the schema's `unit:"mixed"` label. Always write it in PPQN.
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
map to `loadTracksFromFiles`. Without this, the sample manager's fetch callback finds
no local buffer and throws `"Sample not found locally"` (our provider deliberately does
not hit any remote API — the old `OpenSampleAPI` fallback was removed from the SDK in
0.0.155 anyway).
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

### Async-Affected Controls Need a `switching` Guard
When a control triggers heavy async work (transient detection, mode switch,
sample load), wrap it in a div keyed on the same `switching` state the demo
uses elsewhere — `style={{ opacity: switching ? 0.5 : 1, pointerEvents: switching ? "none" : "auto" }}` — so rapid input during the work doesn't
silently bail through a re-entry guard. Reference pattern: the Play Mode and
Reference Pitch cards in `time-pitch-demo.tsx`.

### Voice Crossfade on Region Boundaries
`RegionEditing.cut()` creates a new `PitchVoice` per region. Voices fade in/out over
20 ms (`VOICE_FADE_DURATION` in `Tape/constants.ts`); the fade-IN applies only when the
voice starts at a non-zero read offset — a voice starting at sample 0 begins at full
amplitude. The fade-out starts from the current amplitude level, so transitions between
consecutive regions are smooth.

Multi-track volume automation crossfades (`comp-lanes-demo.tsx`) remain a valid alternative
technique for complex comp workflows.

### Seam/Crossfade Artifact Status (openDAW#311 / #312, SDK 0.0.159)
Both upstream issues this repo filed are closed as of 0.0.159 ("Fixed in SDK 0.0.159.
Make sure to run the wasm audio engine"):
- **#312 (voice-fade × clip-fade product)** — fixed on BOTH engines. `PitchVoice.process`
  combines its 20 ms declick fade with the region clip-fade by `Math.min` instead of by
  product. Authored linear crossfades between distinct sources now sum to −0.05 dB of the
  pure-Web-Audio target (was −1.21 dB). Regression page: `pure-webaudio-target-debug-demo.html`.
- **#311 (touching-seam discontinuity)** — fixed on the WASM engine ONLY (all 4 cells scan
  at seam-Δ/pre-Δ = 1.00 with `?engine=wasm`); the default TS engine still measures ≈1.87×
  at 0.0.159. Touching same-track regions remain clicky on the TS engine — keep the
  volume-automation-crossfade workaround there. Regression page:
  `shared-source-double-process-debug-demo.html`.
Both repro pages accept `?engine=wasm` (boots the WASM engine and routes the offline scan
through `OfflineEngineRenderer` `variant: true` — see `src/lib/offlineScan.ts`).

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
the bug, not the deletion. Note: for Seconds-timeBase regions, `ProjectValidation`
compares mixed units (duration in seconds, position in PPQN) — Seconds overlaps
may survive `copy()` undetected; prevent them at write time rather than relying on
validation to catch them.

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
