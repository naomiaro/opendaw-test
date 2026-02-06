# OpenDAW Headless Development Guide

## Project Overview
This project demonstrates headless usage of the OpenDAW SDK for browser-based audio recording and playback.

## Key OpenDAW APIs

### Recording
```typescript
// Start recording (handles everything: Tape instrument, track arming, microphone, regions, peaks)
project.startRecording(useCountIn: boolean);

// Stop recording only (keeps engine running)
project.engine.stopRecording();

// Stop everything and reset position to 0
project.engine.stop(true);

// Stop without resetting position
project.engine.stop(false);
```

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
```

### Engine State Observables
```typescript
// Subscribe to engine state changes
project.engine.isRecording.catchupAndSubscribe(obs => {
  const recording = obs.getValue();
});

project.engine.isPlaying.catchupAndSubscribe(obs => {
  const playing = obs.getValue();
});

project.engine.isCountingIn.catchupAndSubscribe(obs => {
  const countingIn = obs.getValue();
});

project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
  const beats = Math.ceil(obs.getValue());
});
```

### Engine Preferences (SDK 0.0.87+)
```typescript
// Access via project.engine.preferences.settings
const settings = project.engine.preferences.settings;

// Metronome
settings.metronome.enabled = true;
settings.metronome.gain = -6; // dB
settings.metronome.beatSubDivision = 1; // 1=quarter, 2=eighth, 4=16th, 8=32nd

// Recording
settings.recording.countInBars = 1; // 1-8 bars
```

### Finding Recording Regions
```typescript
// Recording regions are labeled "Take N" (SDK 0.0.91+) or "Recording" (older)
const boxes = project.boxGraph.boxes();
const recordingRegion = boxes.find((box: any) => {
  const label = box.label?.getValue?.();
  return label === "Recording" || (label && label.startsWith("Take "));
});

// Get duration for setting up playback
const duration = recordingRegion.duration.getValue();
```

### Accessing Live Peaks During Recording
```typescript
// 1. Find the recording region
const recordingRegion = boxes.find(box => /* ... */);

// 2. Get the AudioFileBox from the region's file pointer
const fileVertexOption = recordingRegion.file.targetVertex;
const audioFileBox = fileVertexOption.unwrap();

// 3. Get SampleLoader via sampleManager
const uuid = audioFileBox.address.uuid;
const sampleLoader = project.sampleManager.getOrCreate(uuid);

// 4. Access peaks (Option type - check isEmpty())
const peaksOption = sampleLoader.peaks;
if (!peaksOption.isEmpty()) {
  const peaks = peaksOption.unwrap();

  // Check if live recording (PeaksWriter) or final (Peaks)
  const isPeaksWriter = "dataIndex" in peaks;

  if (isPeaksWriter) {
    // Live recording - render based on dataIndex
    const unitsToRender = peaks.dataIndex[0] * peaks.unitsEachPeak();
  } else {
    // Final peaks - render all
    const unitsToRender = peaks.numFrames;
  }
}
```

### Time Signature Events
```typescript
// Access signature track
const signatureTrack = project.timelineBoxAdapter.signatureTrack;

// Create event at PPQN position
signatureTrack.createEvent(position, nominator, denominator);

// Iterate all events (index -1 is storage signature)
const events = Array.from(signatureTrack.iterateAll());

// Delete event
signatureTrack.adapterAt(event.index).ifSome(a => a.box.delete());

// PPQN per bar: PPQN.fromSignature(nom, denom) = Math.floor(3840/denom) * nom
```

### Tempo Automation Events
```typescript
// Access tempo track events
project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
  // Clear existing
  collection.events.asArray().forEach(event => event.box.delete());
  // Create event
  collection.createEvent({ position, index: 0, value: bpm, interpolation });
});
// Interpolation: Interpolation.Linear, Interpolation.None from @opendaw/lib-dsp
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

### AudioContext Suspension
Browser autoplay policy means `AudioContext` starts suspended until a user gesture.
`initializeOpenDAW()` registers click/keydown listeners to auto-resume it (one-shot).
iOS Safari can re-suspend after backgrounding/locking. Before calling `play()`:
```typescript
if (audioContext.state !== "running") {
  await audioContext.resume();
  // iOS Safari may not be "running" yet — wait for statechange event
}
```

## Important Patterns

### Always Use editing.modify() for State Changes
```typescript
project.editing.modify(() => {
  // All box graph modifications go here
  project.timelineBox.bpm.setValue(120);
});
```

### SignatureTrack: One editing.modify() Per Event
`SignatureTrackAdapter.createEvent()` calls `iterateAll()` internally. Inside a single
`editing.modify()` transaction, adapter collection notifications are deferred, so subsequent
calls see stale state. Use separate `editing.modify()` per `createEvent` and per deletion.

### Fades Can Share a Transaction with Region Changes
Fading values (in, out, slopes) can be set in the same `editing.modify()` as
region property changes (position, duration, loopOffset). No separate transaction needed.

### Region Sorting When Positions Match
When regions share the same position, sort by label for deterministic ordering:
`regionAdapters.sort((a, b) => labelIndex(a) - labelIndex(b))`
Set custom labels with `adapter.box.label.setValue("name")`.

### Recording Peaks Include Count-In Frames
The SDK captures audio during count-in. `waveformOffset` on the region (in seconds)
tells playback to skip it. When rendering peaks, use `waveformOffset * sampleRate`
as the `u0` parameter to `PeaksPainter.renderBlocks()` to skip count-in frames.

### Safari Audio Format Compatibility
Safari can't decode Ogg Opus via `decodeAudioData` (even though `canPlayType` returns
`"maybe"`). Provide m4a (AAC) fallback. Detect Safari via UA string, not feature detection.
See `src/lib/audioUtils.ts` `getAudioExtension()`.

### Proper Recording to Playback Flow
1. Call `project.startRecording(useCountIn)`
2. Monitor `isRecording` observable for when recording stops
3. Wait for final peaks (not PeaksWriter) to be received
4. Wait for `queryLoadingComplete()` before playing
5. Call `project.engine.stop(true)` to reset, then `project.engine.play()`

### Stop Button Behavior
- `stop(true)` - Resets position to 0, clears all voices, resets processors (like DAW stop button)
- `stop(false)` - Pauses without resetting position

## React Integration Tips

### Monitoring Peaks Across Recording Lifecycle
Use state (not refs) to track monitoring status, since refs don't trigger effect re-runs:
```typescript
const [shouldMonitorPeaks, setShouldMonitorPeaks] = useState(false);

// Start monitoring when recording starts
useEffect(() => {
  if (isRecording && !shouldMonitorPeaks) {
    setShouldMonitorPeaks(true);
  }
}, [isRecording, shouldMonitorPeaks]);

// Effect runs while shouldMonitorPeaks is true
useEffect(() => {
  if (!project || !shouldMonitorPeaks) return;

  const animationFrame = AnimationFrame.add(() => {
    // Monitor peaks here...
    // When final peaks received, call setShouldMonitorPeaks(false)
  });

  return () => animationFrame.terminate();
}, [project, shouldMonitorPeaks]);
```

### Using AnimationFrame from OpenDAW
```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

const terminable = AnimationFrame.add(() => {
  // Called every frame
});

// Cleanup
terminable.terminate();
```

### Demo Layout Structure
GitHubCorner, BackLink, content, and MoisesLogo all go *inside* `<Container>`, not as siblings.
See `src/looping-demo.tsx` for the reference layout pattern.

## Reference Files
- Recording demo: `src/recording-api-react-demo.tsx`
- Project setup: `src/lib/projectSetup.ts`
- Track loading: `src/lib/trackLoading.ts` (handles queryLoadingComplete automatically)
- Engine preferences hook: `src/hooks/useEnginePreference.ts`
- Tempo automation demo: `src/tempo-automation-demo.tsx`
- Time signature demo: `src/time-signature-demo.tsx`
- Clip fades demo: `src/clip-fades-demo.tsx`
- Audio utilities: `src/lib/audioUtils.ts` (format detection, file loading)
- OpenDAW original source: `/Users/naomiaro/Code/openDAWOriginal`
