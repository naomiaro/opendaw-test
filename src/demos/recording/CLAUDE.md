# Recording Demos — OpenDAW SDK Reference

### Recording
```typescript
// Start recording (handles everything: Tape instrument, track arming, microphone, regions, peaks)
project.startRecording(useCountIn: boolean);

// CRITICAL: Use stopRecording() to stop recording, NOT stop(true).
// stop(true) kills the audio graph, preventing RecordingProcessor from
// writing remaining data to the RingBuffer. It also resets position to 0,
// which triggers spurious loop-wrap detection in loop recording (muting
// the last take). Call stop(true) only AFTER finalization completes.
project.engine.stopRecording();
// Wait for finalization via sampleLoader.subscribe, then reset engine:
const sub = sampleLoader.subscribe((state: any) => {
  if (state.type === "loaded") {
    sub.terminate();
    project.engine.stop(true);
  }
});

// Stop everything and reset position to 0
project.engine.stop(true);

// Stop without resetting position
project.engine.stop(false);
```

### Audio Input & Capture
```typescript
import { AudioDevices, CaptureAudio } from "@opendaw/studio-core";
import type { MonitoringMode } from "@opendaw/studio-core";

// Request mic permission and enumerate devices
await AudioDevices.requestPermission();
await AudioDevices.updateInputList();
const inputs = AudioDevices.inputs; // ReadonlyArray<MediaDeviceInfo>

// Access capture device for an armed track
const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
if (capture instanceof CaptureAudio) {
  // deviceId, requestChannels, gainDb are box graph fields — require transaction
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(deviceId);
    capture.requestChannels = 1;        // 1 = mono, 2 = stereo
    capture.captureBox.gainDb.setValue(0); // dB
  });
  // monitoringMode manipulates Web Audio nodes — set outside transaction
  capture.monitoringMode = "direct";  // "off" | "direct" | "effects"

  // Monitor controls (SDK 0.0.133+) — direct property setters, no transaction
  capture.monitorVolumeDb = -6.0;     // independent monitor volume (dB)
  capture.monitorPan = 0.0;           // stereo pan (-1.0 to 1.0)
  capture.monitorMuted = false;       // mute monitor output
  await capture.setMonitorOutputDevice(Option.wrap("device-id")); // route to specific output
  // Option.None = system default destination
}

// Track arming
project.captureDevices.setArm(capture, true); // exclusive=true disarms others
const armed = project.captureDevices.filterArmed();

// Multi-device recording: arm multiple captures non-exclusively
project.captureDevices.setArm(capture1, false); // false = keep others armed
project.captureDevices.setArm(capture2, false);
// startRecording() uses filterArmed() internally — records ALL armed captures in parallel
```

### Recording Preferences (Takes)
```typescript
const settings = project.engine.preferences.settings;
settings.recording.allowTakes = true;        // enable loop-based takes (default: true since SDK 0.0.109)
settings.recording.olderTakeAction = "mute-region"; // or "disable-track"
settings.recording.olderTakeScope = "previous-only"; // or "all"
settings.recording.countInBars = 1;          // 1-8
```

**How takes work:** Takes are driven by the timeline loop area (`timelineBox.loopArea`).
When `allowTakes` is true AND `loopArea.enabled` is true, each time playback wraps past
`loopArea.to` back to `loopArea.from`, the current take is finalized and a new take begins.

- Recording can start **before** the loop region. Take 1 records from the start position
  through the first loop wrap. Subsequent takes are scoped to the loop region
  (`loopFrom` → `loopTo`).
- With `loopArea.enabled = false`, `allowTakes` has no effect — recording produces a
  single continuous region regardless of the setting.
- Loop-wrap detection uses `currentPosition < lastPosition` (position jumped backward),
  then calls `startNewTake(loopFrom)` to begin the next take at the loop start.

### capture.armed Is Not a Box Graph Field
- `capture.armed` is a `MutableObservableValue<boolean>`, not a box graph field
- Set directly: `capture.armed.setValue(false)` — do NOT wrap in `editing.modify()`
- Same as `monitoringMode` — runtime observable, not persisted in the box graph

### Monitor Signal Chain (SDK 0.0.133+)
Direct monitoring taps from `sourceNode` (before recording gain), allowing independent
control of recording level vs monitoring level:
```
sourceNode → monitorGainNode → monitorPanNode → destination (or custom output device)
         ↘ recordGainNode → RecordingWorklet (recording path)
```
- `monitorVolumeDb`, `monitorPan`, `monitorMuted` are direct property setters (no transaction)
- `setMonitorOutputDevice(Option<string>)` routes monitor audio to a specific output device
  via `HTMLAudioElement.setSinkId()` and `MediaStreamAudioDestinationNode`
- `Option.None` = system default `audioContext.destination`
- In "effects" mode, the source is routed through the engine for processing, then back
  through `monitorGainNode` → `monitorPanNode` → destination
- Output device enumeration: use `navigator.mediaDevices.enumerateDevices()` filtering
  for `kind === "audiooutput"` (not handled by `AudioDevices` class)

### Never Call stop(true) During Recording Finalization
After `stopRecording()`, the SDK finalizes internally (imports sample, generates peaks).
Calling `stop(true)` during this window kills the audio graph and prevents finalization.
OpenDAW's transport never calls `stop(true)` after `stopRecording()` — finalization
completes asynchronously while the engine keeps playing. Only call `stop(true)` for:
- Cancelling count-in (no loaders to finalize)
- Stopping playback (state is "ready" or "playing")
- Resetting position before `play()` for playback

### SampleLoader Has subscribe() Only (Not catchupAndSubscribe)
`sampleLoader.subscribe()` fires only for future state changes. Check `loader.state.type`
before subscribing — short recordings may already be `"loaded"` by the time you subscribe.
`loader.state` is typed as `SampleLoaderState` with
`.type: "idle" | "record" | "progress" | "error" | "loaded"`.

### AnimationFrame Is for Rendering Only
Use `AnimationFrame.add()` exclusively for continuous visual updates (waveform peaks,
meters, progress bars). Never use it to drive state transitions — use SDK subscriptions
(`catchupAndSubscribe`, `sampleLoader.subscribe`) instead. AnimationFrame polling is
unreliable for detecting one-time events like finalization completion.

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

### Capture Settings Require editing.modify()
`captureBox.deviceId`, `captureBox.gainDb`, and `capture.requestChannels` are box graph fields —
wrap in `editing.modify()`. `capture.monitoringMode` is NOT a box graph field (it manipulates
Web Audio nodes), so set it outside the transaction. As of SDK 0.0.133, `monitoringMode` is
properly typed — no `(capture as any)` cast needed.

### Recording Peaks Include Count-In Frames
The SDK captures audio during count-in. `waveformOffset` on the region (in seconds)
tells playback to skip it. When rendering peaks, use `waveformOffset * sampleRate`
as the `u0` parameter to `PeaksPainter.renderPixelStrips()` to skip count-in frames.

For **loop recording takes**, all takes share one `AudioFileBox` (continuous buffer).
Each take's `waveformOffset` = count-in + sum of prior take durations. Render each take
with `u0 = waveformOffset * sampleRate`, `u1 = u0 + duration * sampleRate`.

### Take Waveform Rendering: Shared Buffer Gotcha
All takes share ONE PeaksWriter during recording. `dataIndex[0] * unitsEachPeak()`
returns total accumulated frames across ALL takes — NOT per-take. Using it as `u1`
causes finalized takes to render audio from subsequent takes.
**Always use `u0 + durationFrames` for per-take waveform bounds.** The SDK updates
`regionBox.duration` every frame via `RecordAudio.ts`, so even the live take grows
smoothly. Only fall back to `dataIndex` when `durationFrames === 0`.

### Take-to-Track Matching (Multi-Track Loop Recording)
SDK creates take regions on new TrackBoxes under the same AudioUnitBox. Match via:
`regionBox.regions.targetVertex` → `TrackBox` → `trackBox.tracks.targetVertex` → `AudioUnitBox`
Then `UUID.toString(audioUnitBox.address.uuid)` matches `RecordingTrack.id`.

### Loop Take Buffer Layout and Offsets
All takes record into a single continuous audio buffer. The count-in offset is only
explicitly set for take 1; subsequent takes inherit it transitively through accumulation:
```
Buffer: [count-in frames | Take 1 audio | Take 2 audio | Take 3 audio ...]

Take 1: waveformOffset = preRecordingSeconds (count-in duration)
Take 2: waveformOffset = take1.waveformOffset + take1.duration
Take 3: waveformOffset = take2.waveformOffset + take2.duration
```
The count-in frames sit at the start of the buffer and are never referenced after take 1
skips past them. Each take's `waveformOffset` is set once at creation time in
`RecordAudio.ts` and never modified afterward.

**Duration overshoot (~2-3ms):** Loop-wrap detection (`currentPosition < lastPosition`)
fires at audio block boundaries (~128 frames), so each take's `duration` includes a few
extra frames past the exact loop boundary. The next take's `waveformOffset` compensates
(starts after those frames), so audio reads stay aligned. This causes a minor visual
artifact where each take's waveform shows ~2-3ms of extra audio at the tail.

**20ms voice crossfade at loop boundaries:** At loop wrap, the engine sets
`BlockFlag.discontinuous`, which fades out old voices over `VOICE_FADE_DURATION = 0.020s`
(20ms) and fades in new voices over the same duration. During this window, both the
outgoing and incoming take audio overlap briefly. This is SDK-level behavior to prevent
clicks — not a bug.

**Playback audio read formula** (TapeDeviceProcessor.ts):
`sampleIndex = ((elapsedSeconds + waveformOffset) * sampleRate) | 0`
where `elapsedSeconds = tempoMap.intervalToSeconds(cycle.rawStart, cycle.resultStart)`

### Proper Recording to Playback Flow
1. Call `project.startRecording(useCountIn)`
2. During recording, discover `sampleLoader` via `sampleManager.getOrCreate(audioFileBox.address.uuid)`
3. Call `engine.stopRecording()` (NOT `stop(true)`) to stop recording
4. Subscribe to `sampleLoader.subscribe()` — wait for `state.type === "loaded"`
5. Call `engine.stop(true)` to reset, then `engine.play()`
**Multi-device**: When recording multiple tracks, subscribe to ALL sampleLoaders and only call
`stop(true)` after all have emitted `"loaded"` (counting barrier pattern). Add a safety
timeout (~10s) to force-finalize if any loader fails to emit.
**Note**: `queryLoadingComplete()` resolves before `sampleLoader.data` is set — do NOT use it to detect recording data availability.

### Stop Button Behavior
- `stopRecording()` - Stops recording but keeps engine alive for finalization
- `stop(true)` - Resets position to 0, clears all voices, resets processors (like DAW stop button)
- `stop(false)` - Pauses without resetting position
- **NEVER call `stop(true)` while recording** — kills the audio graph and prevents finalization

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

## Reference Files
- Recording demo: `src/demos/recording/recording-api-react-demo.tsx`
- Loop recording demo: `src/demos/recording/loop-recording-demo.tsx`
- Recording track card: `src/components/RecordingTrackCard.tsx`
- Take timeline: `src/components/TakeTimeline.tsx`
- Engine preferences hook: `src/hooks/useEnginePreference.ts`

## Shared Recording Hooks
- `src/hooks/useRecordingSession.ts` — state machine (idle → counting-in → recording → finalizing → ready → playing), engine subscriptions, eager sampleLoader finalization barrier
- `src/hooks/useAudioDevicePermission.ts` — mic permission + input/output device enumeration
- `src/hooks/useRecordingTracks.ts` — Tape instrument creation, capture config, arming, track add/remove
