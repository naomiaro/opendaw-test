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
  v0: -1, v1: 1 // amplitude range (always -1 to 1)
});
```
**IMPORTANT:** `renderPixelStrips` uses the current `ctx.fillStyle` — set it before calling.
It does NOT accept color parameters. Without setting fillStyle, waveforms are invisible.

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

### Voice Pop on Region Boundaries (SDK Limitation)
`RegionEditing.cut()` creates a new `PitchVoice` per region. Each voice has a forced
20ms fade-in/fade-out (`VOICE_FADE_DURATION` in `Tape/constants.ts`, not configurable).
When one region ends and the next begins, the voice eviction + creation causes an
audible pop. Pure Web Audio scheduling of consecutive `AudioBufferSourceNode`s from
the same buffer is seamless — the pop is entirely from SDK voice management.

**Workaround:** Use multi-track volume automation crossfades instead of region splitting.
Each "take" gets its own track; volume automation (`createAutomationTrack` +
`Interpolation.Curve`) handles crossfades. See `comp-lanes-demo.tsx`.

### Fade-In on Newly Created Regions May Not Apply
Setting `adapter.fading.inField.setValue()` on regions created by `RegionEditing.cut()`
/ `copyTo()` may not take effect in the audio engine, even when values read back
correctly. Fade-out on the original (left) region works reliably. Fade-in on the
new (right) region does not.

### Non-Overlapping Fades Create Pops
Fade-out + fade-in without overlap creates a V-shaped volume dip at the splice point.
For same-file consecutive regions, no fade is needed — the audio is already continuous.
Adding fades makes it worse. See `documentation/09-editing-fades-and-automation.md#advanced-region-splicing--comp-lanes`.

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
