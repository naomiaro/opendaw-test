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

### waveformOffset vs loopOffset
- `loopOffset` (PPQN) — controls which loop cycle aligns with which timeline position on playback. Does NOT shift audio read position in the file.
- `waveformOffset` (seconds, field 7 on AudioRegionBox) — shifts where TapeDeviceProcessor reads in the audio buffer: `sampleIndex = (elapsedSeconds + waveformOffset) * sampleRate`
- To skip silence at the start of an audio file, set `waveformOffset` in seconds. `loopOffset` alone won't change what audio you hear.
- For waveform rendering, use `loopOffset` to compute the peaks frame range (visual), and `waveformOffset` for the engine read position (audio).

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

## Reference Files
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
