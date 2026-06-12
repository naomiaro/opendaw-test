# Recording Demos — OpenDAW SDK Reference

### Recording
```typescript
// Start recording — records ALL armed captures (streams, regions, peaks, takes).
// Arming is explicit (see Track arming below); with zero armed captures the
// engine enters recording state but records nothing.
project.startRecording(useCountIn: boolean);

// CRITICAL: Use stopRecording() to stop recording, NOT stop(true).
// stopRecording() stops transport and clears the recording flags without
// resetting position or processors; finalization (sample import, peaks)
// completes asynchronously on the main thread. stop(true) additionally
// resets position to 0 — triggering spurious loop-wrap detection in loop
// recording (muting the last take) — and resets all processors, racing the
// in-flight async finalization. Call stop(true) only AFTER finalization completes.
project.engine.stopRecording();
// Wait for finalization, then reset engine. Pre-check loader.state —
// subscribe() fires synchronously for terminal states, so sub.terminate()
// inside the callback would hit `const sub` in its TDZ. Barriers also
// count "error" and keep a timeout — see SampleLoader section.
if (sampleLoader.state.type === "loaded") {
  project.engine.stop(true);
} else {
  const sub = sampleLoader.subscribe((state: any) => {
    if (state.type === "loaded") {
      sub.terminate();
      project.engine.stop(true);
    }
  });
}

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

// Track arming — capture.armed.setValue() is the deterministic arm/disarm
capture.armed.setValue(true);
capture.armed.setValue(false);

// setArm() is a TOGGLE: arming = !capture.armed.getValue(). The second param
// is exclusivity only — when the toggle lands on armed AND exclusive=true,
// all other captures are disarmed. Calling setArm on an already-armed capture
// DISARMS it. Reserve setArm for exclusive-arm (radio-button) UX.
project.captureDevices.setArm(capture, true);

// filterArmed() returns captures that are armed AND have an instrument/input
// connected AND whose audio unit is not frozen
const armed = project.captureDevices.filterArmed();

// Multi-device recording: arm multiple captures
capture1.armed.setValue(true);
capture2.armed.setValue(true);
// startRecording() uses filterArmed() internally — records ALL armed captures
// in parallel. With ZERO armed captures the engine enters recording state but
// records nothing and creates no instrument.
```

### Recording Preferences (Takes)
```typescript
const settings = project.engine.preferences.settings;
settings.recording.allowTakes = true;        // enable loop-based takes (default: true)
settings.recording.olderTakeAction = "mute-region"; // or "disable-track"
settings.recording.olderTakeScope = "previous-only"; // "none" | "all" | "previous-only"
settings.recording.countInBars = 1;          // 1-8
settings.recording.inputLatency = 0;         // seconds, ≥ -1; engine-wide mic→engine compensation
settings.recording.automationEnabled = true; // record parameter automation (RecordAutomation)
```
`olderTakeScope: "none"` skips older-take muting/disabling entirely. Allowed-value
constants are exported as `EngineSettings.RecordingCountInBars`,
`EngineSettings.OlderTakeActionOptions`, `EngineSettings.OlderTakeScopeOptions`
(`@opendaw/studio-adapters`) — prefer them over hard-coded literal unions.

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
- Zero-duration takes are deleted at the wrap instead of being finalized.

### Input Latency Compensation
`settings.recording.inputLatency` (seconds, ≥ -1) is the engine-wide default;
`captureBox.inputLatency` (Float32 box graph field — needs `editing.modify()`)
overrides it per capture. Sentinels from `InputLatency` (`@opendaw/studio-core`):
- `InputLatency.Inherit` (-2, field default) — use the engine preference
- `InputLatency.EqualsOutput` (-1) — equal to output latency (doubles the compensation)
- values ≥ 0 — seconds added to output latency
`InputLatency.resolve(localOverride, preference, outputLatency)` returns the
resolved seconds; the result feeds take 1's `waveformOffset`.

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
`stopRecording()` stops transport; the SDK then finalizes asynchronously on the main
thread (imports sample, generates peaks). Calling `stop(true)` during this window
resets position (spurious loop-wrap muting) and resets all processors, racing the
in-flight finalization. OpenDAW's record button calls `stopRecording()` only —
`stop(true)` is a separate user action. Only call `stop(true)` for:
- Cancelling count-in (no loaders to finalize)
- Stopping playback (state is "ready" or "playing")
- Resetting position before `play()` for playback

### SampleLoader Has subscribe() Only (Not catchupAndSubscribe)
`sampleLoader.subscribe()` invokes the callback synchronously when the loader is
already in a terminal state ("loaded"/"error") and returns `Terminable.Empty`.
Always read `loader.state.type` synchronously first and handle terminal states
directly — short recordings may be `"loaded"` before `subscribe()` is called.
`loader.state` is typed as `SampleLoaderState` with
`.type: "idle" | "record" | "progress" | "error" | "loaded"`.
Finalization barriers must count `"error"` as terminal AND keep a safety timeout:
`RecordingWorklet` (the loader during recording) emits only `"loaded"` — a
finalization failure produces NO terminal state (the loader stays in `"record"`),
so the timeout is the only safety net on that path. `"error"` fires on
`DefaultSampleLoader` paths (post-reload loads, decode failures) and must still
be handled there.
Inside the subscribe callback, a one-shot `sub.terminate()` call will hit the
`const sub` binding in its TDZ if the callback fires synchronously; use the
pre-check pattern (handle terminal state before subscribing) to avoid this.

### AnimationFrame Is for Rendering Only
Use `AnimationFrame.add()` exclusively for continuous visual updates (waveform peaks,
meters, progress bars). Never use it to drive state transitions — use SDK subscriptions
(`catchupAndSubscribe`, `sampleLoader.subscribe`) instead. AnimationFrame polling is
unreliable for detecting one-time events like finalization completion.

### Use SDK Adapter Layer for Region Discovery
Prefer `project.rootBoxAdapter.audioUnits` → `AudioUnitBoxAdapter.tracks.catchupAndSubscribe`
→ `TrackRegions.catchupAndSubscribe` → `AudioFileBoxAdapter.getOrCreateLoader()` over raw
`pointerHub` or `boxGraph.boxes()` scanning. The adapter layer is typed (no `as any` casts),
resolves sampleLoaders internally, and matches OpenDAW's own architecture.
Note: `AudioUnitTracks` uses `onAdd`/`onRemove`/`onReorder`; `TrackRegions` uses `onAdded`/`onRemoved`.

### Don't Gate AnimationFrame on React State via Refs
React batching can skip intermediate renders (e.g., finalizing→ready→recording batched
into one commit). A ref assigned during render (`ref.current = derivedValue`) may never
see the intermediate value. AnimationFrame callbacks that guard on such refs will miss
state changes. Instead, let AnimationFrame run unconditionally — when there's nothing to
render it's a no-op.

### Finding Recording Regions
Every audio recording region is labeled `"Take N"` starting at N=1, including single
non-loop recordings (`RecordMidi` labels MIDI takes the same way). Discover via
`getAllAudioRegions(project)` from `src/lib/adapterUtils.ts`:
```typescript
import { getAllAudioRegions } from "@/lib/adapterUtils";

const audioRegions = getAllAudioRegions(project);
const recordingAdapter = audioRegions.find(adapter => adapter.label.startsWith("Take "));

// Adapter exposes typed getters/setters — no .getValue() on field access
const durationPpqn = recordingAdapter.duration;
const regionBox = recordingAdapter.box; // AudioRegionBox (already typed)
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
`captureBox.deviceId.setValue()` and `captureBox.gainDb.setValue()` write box graph fields
directly. `capture.requestChannels = 1` is a `CaptureAudio` setter that writes the
underlying `captureBox.requestChannels` (Int32Field) — also a box graph mutation. All
three need `editing.modify()`. `capture.monitoringMode` is NOT a box graph field (it
manipulates Web Audio nodes), so set it outside the transaction. As of SDK 0.0.133,
`monitoringMode` is properly typed — no `(capture as any)` cast needed.
Setting any non-`"off"` monitoring mode auto-arms the capture (`armed.setValue(true)`).
`captureBox.recordMode` (`"normal" | "replace" | "punch"`) exists in the schema but
has no runtime consumer — don't build on it.

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
Then `UUID.toString(audioUnitBox.address.uuid)` matches `RecordingTape.id`.

### Loop Take Buffer Layout and Offsets
All takes record into a single continuous audio buffer. The count-in offset is only
explicitly set for take 1; subsequent takes inherit it transitively through accumulation:
```
Buffer: [count-in frames | Take 1 audio | Take 2 audio | Take 3 audio ...]

Take 1: waveformOffset = workletHeadStart + countInSeconds + outputLatency + inputLatency (set by SDK)
Take 2: waveformOffset = take1.waveformOffset + take1.duration
Take 3: waveformOffset = take2.waveformOffset + take2.duration
```
The count-in frames sit at the start of the buffer and are never referenced after take 1
skips past them. Each take's `waveformOffset` is set once at creation time in
`RecordAudio.ts` and never modified afterward.

**Take durations:** Wrap-finalized takes get deterministic tempo-map durations —
at each loop wrap the SDK sets the finalized take's duration to
`tempoMap.intervalToSeconds(regionBox.position, loopTo)`, so there is no overshoot
past the loop boundary. The FINAL take (teardown-finalized at stop) keeps the last
live duration write (`numberOfFrames / sampleRate - waveformOffset`), which is
RenderQuantum-granular — expect up to one audio block of extra tail on that take only.

**20ms voice crossfade at loop boundaries:** When the loop action proceeds (i.e.
`playback.pauseOnLoopDisabled` is off — with it enabled the engine pauses at the wrap
and no crossfade occurs), the engine sets `BlockFlag.discontinuous`, which fades out
old voices over `VOICE_FADE_DURATION = 0.020s`
(20ms) and fades in new voices when the read offset is non-zero (typical loop-wrap takes
have `waveformOffset > 0`, so the 20 ms voice fade-in applies). During this window, both the
outgoing and incoming take audio overlap briefly. The fade-out starts from the current
amplitude level, making these transitions smooth and click-free.

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
`stop(true)` after all have reached a terminal state — `"loaded"` or `"error"` (counting
barrier pattern). Keep a safety timeout: a RecordingWorklet finalization failure emits
no terminal state at all (see the SampleLoader section).
**Note**: `queryLoadingComplete()` resolves before `sampleLoader.data` is set — do NOT use it to detect recording data availability.

### Stop Button Behavior
- `stopRecording()` - Stops transport and clears recording flags; does not reset
  position or processors — finalization completes asynchronously
- `stop(true)` - Resets position to 0, clears all voices, resets processors (like DAW stop button)
- `stop(false)` - Pauses without resetting position
- **NEVER call `stop(true)` while recording or before loaders reach a terminal state** —
  the position reset triggers spurious loop-wrap muting and the processor reset races
  the async finalization

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
- Recording tape card: `src/components/RecordingTapeCard.tsx`
- Take timeline: `src/components/TakeTimeline.tsx`
- Engine preferences hook: `src/hooks/useEnginePreference.ts`
- Takes preferences panel: `src/demos/recording/TakesPreferencesPanel.tsx`
- Loop setup panel: `src/demos/recording/LoopSetupPanel.tsx`

## Shared Recording Hooks
- `src/hooks/useRecordingSession.ts` — state machine (idle → counting-in → recording → finalizing → ready → playing), engine subscriptions, eager sampleLoader finalization barrier
- `src/hooks/useAudioDevicePermission.ts` — mic permission + input/output device enumeration
- `src/hooks/useRecordingTapes.ts` — Tape instrument creation, capture config, arming, tape add/remove
- `src/demos/recording/useTapePeaks.ts` — live + finalized peaks rendering per tape (CanvasPainter lifecycle)
- `src/demos/recording/useTakeDiscovery.ts` — reactive take discovery/grouping via pointerHub subscriptions
