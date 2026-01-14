# OpenDAW Headless Development Guide

## Project Overview
This project demonstrates headless usage of the OpenDAW SDK for browser-based audio recording and playback.

## Package Sources & Branches

This project can use either the original OpenDAW packages or the Moises fork:

| Branch | Package Scope | Source |
|--------|---------------|--------|
| `main` | `@opendaw/*` | npm registry (original OpenDAW) |
| `feature/moises-packages` | `@moises-ai/*` | GitHub Package Registry (Moises fork) |

### Moises Fork Locations
- **Moises OpenDAW repo**: `/Users/naomiaro/Code/MoisesOpenDAW`
- **Original OpenDAW repo**: `/Users/naomiaro/Code/openDAWOriginal`

### Switching Between Package Sources

**DO NOT use npm aliasing** (e.g., `"@opendaw/lib-std": "npm:@moises-ai/lib-std@^0.0.65"`). This causes module duplication issues where multiple instances of the same classes are loaded, breaking `instanceof` checks and causing runtime errors like `watchVertex called but has no edge requirement`.

**Correct approach**: Change both `package.json` dependencies AND all source file imports to use the desired scope directly:

```typescript
// For original OpenDAW (main branch)
import { Project } from "@opendaw/studio-core";

// For Moises fork (feature/moises-packages branch)
import { Project } from "@moises-ai/studio-core";
```

### Moises Package Registry Setup
The `@moises-ai` packages are hosted on GitHub Package Registry. Ensure `~/.npmrc` contains:
```
@moises-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<your-github-token>
```

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
const isLoaded = await project.engine.queryLoadingComplete();
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

## Important Patterns

### Always Use editing.modify() for State Changes
```typescript
project.editing.modify(() => {
  // All box graph modifications go here
  project.timelineBox.bpm.setValue(120);
});
```

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
// Use @opendaw on main branch, @moises-ai on feature/moises-packages
import { AnimationFrame } from "@opendaw/lib-dom";
// or: import { AnimationFrame } from "@moises-ai/lib-dom";

const terminable = AnimationFrame.add(() => {
  // Called every frame
});

// Cleanup
terminable.terminate();
```

## Reference Files
- Recording demo: `src/recording-api-react-demo.tsx`
- Project setup: `src/lib/projectSetup.ts`
- Engine preferences hook: `src/hooks/useEnginePreference.ts`
- OpenDAW original source: `/Users/naomiaro/Code/openDAWOriginal`
- Moises OpenDAW fork: `/Users/naomiaro/Code/MoisesOpenDAW`

## Troubleshooting

### "watchVertex called but has no edge requirement" Error
This error occurs when using npm aliasing to map `@opendaw/*` to `@moises-ai/*` packages. The aliasing creates duplicate module instances. **Solution**: Use direct imports with the correct scope (see "Switching Between Package Sources" above).
