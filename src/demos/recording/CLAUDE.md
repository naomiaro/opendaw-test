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
have `waveformOffset > 0`, so the 20 ms voice fade-in applies; since SDK 0.0.165 the
guard also consults `loopOffset`, so mid-source region starts fade in too). During this window, both the
outgoing and incoming take audio overlap briefly. The fade-out starts from the current
amplitude level, making these transitions smooth and click-free.

**Playback audio read formula** (engine audio-region playback — Rust `render_region`
in `crates/engine/src/audio_region_player.rs`):
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

### Loop Recording Finalizes Takes Only on Loop Wrap
A take finalizes each time the loop **wraps**, not continuously — recording must run
through the count-in AND ≥1 full loop before the first take exists (1-bar count-in +
2-bar loop @120 BPM ≈ 6s minimum). Too-short recordings finalize 0 takes. Watch for
`[RecordAudio] createTakeRegion → finalizeTake` per wrap in the console.

### Don't Synthesize Input to Verify Recording — Use the Real Mic
A `getUserMedia` override returning a `MediaStreamAudioDestinationNode` stream reads
as SILENT when the engine consumes it cross-AudioContext (the oscillator taps fine
directly, but no signal reaches capture), and a shared dest stream dies once any
consumer calls `track.stop()` (tape disarm/remove). Verify capture with the real mic;
the engine faithfully renders silence as flat peaks (that's correct, not a bug).

**Verified exception (SAME-context only):** a `MediaStreamAudioDestinationNode`
created in the SAME `AudioContext` the engine captures into works — measured
rms=0.074515 (14.9x the 0.005 pass threshold) on a 4s take recorded through it. Hand
out `stream.clone()` per `getUserMedia` call so a consumer's `track.stop()` (tape
disarm/remove) can't kill the source stream — see `src/lib/audit/loopbackInjection.ts`.
Note: the SDK's take-region creation is gated on `engine.position` actually advancing
(`RecordAudio.js`'s `fileBox.isEmpty()` branch, driven by
`engine.position.catchupAndSubscribe`) — the documented transport-position-start delay
(see `src/demos/engine/CLAUDE.md`) can produce a "0 regions" result unrelated to
capture routing; poll `engine.position`/`isRecording` if a recording produces no take.

### Monitoring Peaks Across Recording Lifecycle
Run the peaks AnimationFrame unconditionally for the component's lifetime — do NOT
gate it on recording/session state. A state gate can miss batched transitions (see
"Don't Gate AnimationFrame on React State via Refs"), and an idle frame is a no-op:
```typescript
useEffect(() => {
  if (!project) return;

  const animationFrame = AnimationFrame.add(() => {
    const loader = tapeStateRef.current?.sampleLoader; // resolved via discovery subs
    if (!loader) return; // nothing recorded yet — no-op frame

    const peaksOption = loader.peaks;
    if (!peaksOption.isEmpty()) painter.requestUpdate();
  });

  return () => animationFrame.terminate();
}, [project]);
```
Reference implementation: `src/demos/recording/useTapePeaks.ts`.

### Recording Start-Alignment Harness (standing regression sweep)

Unlisted debug demo that measures where a recorded take actually lands on the timeline,
against a synthetic in-context digital loopback (no real mic, no device latency):

```
recording-alignment-audit-debug-demo.html?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>
```

Scenarios: `nominal-start`, `janked-start`, `midtimeline-start`, `countin-start`,
`loop-wrap`, plus `multitrack-start` / `multitrack-janked` for two simultaneously armed
tapes (`?scenario=multitrack-all`). `?scenario=probe` runs the loopback feasibility
probe instead of the matrix. `&defaultInput=1` arms on the SDK's default input (the capture
box names no device and the injection withholds every audio input from `enumerateDevices`) —
on THIS harness the only configuration in which the SDK reuses one audio chain across a
cell's takes, because its loopback leaves `reportDeviceId` off, so a named synthetic device
never matches the empty id the stream reports and the chain is rebuilt per take (a real
named device, which reports its id, reuses on every build); single-tape scenarios only,
since the multi-mic ones name two distinct devices — the page refuses the combination.

**After SDK upgrades, re-run `?scenario=all&bpm=all&rate=48000` and `…&rate=44100`,
then `?scenario=multitrack-all&bpm=120&rate=48000`** — same standing-sweep role as the
sample-rate/quantum-alignment sweep in root CLAUDE.md's Build & Verification.

**Reading a multi-mic verdict.** On a build whose profile nets the loopback delay, a
multi-mic cell is `aligned` when (1) each tape classifies clean on its own, (2) the
NETTED skew — raw skew minus the difference between the two tapes' `loopbackDelayMs` —
is within `ALIGNED_TOLERANCE_MS` on every repeat, and (3) every netted repeat passes
what it is held to, each test against the tolerance. A TAPE whose node delay was read
(`nodeDelayMs`, below) has its first-frame time checked: `firstFrameCheckMs` is
`loopbackDelayMs` − node delay − `ANCHOR_OFFSET_MS`, whatever became of the other
tape's tap. A REPEAT with both node delays is held to `medianSkewMsUnaccounted` (raw
skew − the difference of the two node delays). A repeat without both is held to
`MULTITRACK_RAW_SKEW_LIMIT_MS`, which is fitted, and the detail counts those repeats as
not attributed. A cell in which no repeat has both is `investigate`, and its detail
says that this is not a finding about the SDK. How much the node delays judged is in the
cell's `nodeDelayUse`. A repeat that lacks a loopback delay is judged on its raw skew against
the tolerance and marked `raw` in the detail. On a build whose profile does not net, the
rule is (1) and the raw skew within the tolerance.

**Node delays.** The multi-mic page listens to the source node each tape records
through (`nodeTaps` in `loopbackInjection.ts`, `measureNodeDelay` in
`src/lib/audit/nodeTap.ts`) and every row carries that node's delay, read on the context
clock with nothing of the SDK's in it. It is null, with the reason in
`nodeDelayUnmeasured`, unless three windows of the tap match what went into the stream
exactly and at one lag. The taps attach once both takes have a region, so the SDK alone
decides when a node starts being pulled. Every node built on a tape's device since the
repeat before is tapped: the one the SDK dropped is silent, the one that carries signal
is the one recording, and with two that carry signal no delay is given.
`firstFrameCheckMs` is the only figure that tells a buffer not starting at the time the
SDK gives for it apart from the node's own delay: `loopbackDelayMs` carries both, and
the netted skew and the netted median cancel it out. Single-tape rows carry no node
delay.

The raw skew itself is NOT a verdict: it moves by 0 to 4 render quanta from one repeat
to the next (measured up to 10.67 ms; at 48 kHz the streams' delays sit on a lattice of
a quarter quantum), so it is reported as a spread over render quanta in the cell's
detail, over `MULTITRACK_REPEATS_PER_CELL` repeats.

What a netted `aligned` says is narrow: the SDK placed both takes the same way against
its own first-frame times. Where the sound sits in each buffer cancels out of the netted
skew, and so does any error in a first-frame time, which is why rule 3 exists. With node
delays it adds that the first-frame times are true and that the buffers hold the sound
as far apart as the two source nodes delivered it, which can be four render quanta.
Never quote a raw multi-mic skew as an SDK finding, and never quote a netted `aligned`
as "the two recordings line up".

**Where the raw skew comes from.** Each `MediaStreamAudioSourceNode` delivers its stream
with a delay of its own, set when the node starts: two nodes on the SAME stream clone,
created in one task, are a render quantum apart in a third to a half of the pairs, and nodes
started at different moments differ by up to 12 ms. So a second node opened on a stream
measures itself, not the stream and not the SDK's node. A second LISTENER on the same
node reads that node's delay exactly. The injected probe in
`scripts/audit/recording-alignment/stream-tap/` listens to the SDK's own source nodes
that way, from outside the page; the multi-mic page does the same from inside, and the
two agree on every row both read. Measured, the raw skew equals the difference of the
two nodes' delays and `loopbackDelayMs` equals the node's delay plus the harness's
anchor offset (14 frames at 48 kHz, 13 at 44.1 kHz), on every row read. At 44.1 kHz a
node's delay can step by 441 frames (10 ms) in its first second, and a tap that sees it
reports the delay as not read. Anything that loads an AudioWorklet module must have it
loaded before the first take: a load still running when a take starts delays that
take's first frame (117 ms measured).

`classifyMultitrackCell` throws when asked to net without one delay record per repeat or
without a limit above zero. Replay saved runs (one sample rate at a time) with
`node scripts/audit/recording-alignment/task13-multitrack-netted-verdict.ts [runId …]`.

- Measurement library: `src/lib/audit/recordingAlignment.ts`; calibration constants:
  `src/lib/audit/recordingAuditCalibration.ts`; loopback injection:
  `src/lib/audit/loopbackInjection.ts`; persisted row/envelope contract and the
  schema-generation table (G1-G6) with the one loader the offline scripts use:
  `src/lib/audit/recordingAuditArtifacts.ts` (+ `scripts/audit/recording-alignment/artifacts.ts`).
  Envelopes written now carry `schemaVersion: 2`, `beatGrid: "absolute"`, `cellVerdicts`
  (one record per attempted cell, all-error cells included), `wavUploadFailures`,
  `harnessPathBiasSettleMs`; rows carry `harnessPathBiasSec` (the run-wide value they
  were adjusted with, read ONCE after output started — never Chrome's initial 0) and
  `wavName`/`wavUploadError`. Legacy files are mapped by the loader, never rewritten.
- Every repeat stops an eighth note BEFORE the next metronome click (`STOP_LEAD_PPQN` in
  `src/lib/audit/recordingCellRunner.ts`): a linear take runs four bars less the lead and
  matches 15 beats; `loop-wrap` stops a lead before beat 2 of the pass its last wrap opened.
  A stop just after a click leaves that click 190–280 ms ahead of the next repeat's start,
  a double click on every repeat boundary. Every row persists `stopLeadMs` (the
  request's distance from the click it ends before, read off `engine.position`); under
  `STOP_ROUND_TRIP_MS` the page warns, since no verdict would show a missed lead. An eighth
  note clears the stop's trail up to about 220 BPM (`recordingCellRunner.test.ts` pins the
  matrix tempos).
- `&stopLead=off` stops every repeat just AFTER the click instead (the envelope's `stopLead`
  says which a run did), for telling the harness's own effect apart from the SDK's.
- An envelope names the SDK release that served the run (`sdkVersion`, the
  `OPENDAW_SDK_VERSION` of the served `@opendaw/studio-sdk`), and every row carries the
  engine's own recording-start report (`recordingStartContextTimeSec`,
  `recordingStartPositionPpqn`, read at the stop request). With `firstQuantumTimeSec` they
  reproduce the SDK's placement: `waveformOffsetSec` = recording start − first quantum +
  output latency − the fraction of a pulse the Int32 region position drops. No verdict
  reads either. To run the page against another release, build an override with
  `node scripts/audit/sdk-override.ts <git-rev> <dir>` and serve it through
  `SDK_DIST_OVERRIDE`; count rare events over saved runs with
  `node scripts/audit/recording-alignment/one-quantum-events.ts`.
- The engine boots once per page load (`Workers.install` asserts on a second
  `initializeOpenDAW`): "Re-run" on the matrix/multitrack pages re-runs the matrix on the
  cached project/tape(s) under a fresh run token; the probe page is one-shot.
- Campaign register (baselines, prediction outcomes, every known defect and harness
  gap): `debug/recording-start-alignment-audit.md`. Upstream outcome: PR
  andremichelle/openDAW#376 (the reworked fix) is merged and in the installed SDK, and #375
  (simultaneous-take `AudioFileBox` collision) is closed with it — the capture owns the
  recording uuid, there is no box swap after save; #374 (residual start-placement bias)
  stays open with PRs #378 / #380. The sweep results per SDK release are in the register.
- **Release profile.** `auditProfileFor()` resolves a build whose `buildFeatures` carry
  `recordingStart` but not `latencyProbes` (any installed release that ships PR #376) to the
  `release` profile: `classifyCell(..., { netLoopbackDelay: true })` judges each repeat on
  `medianBeatErrorMsAdjusted − loopbackDelayMs`, where `loopbackDelayMs =
  (firstQuantumTimeSec − anchorT0Sec) · 1000` is the loopback path's own input delay for
  that row (persisted per row with `medianBeatErrorMsNetted`, a G6 sub-case in the artifacts
  generation table). Measured on the first release sweeps: netted +0.97…+1.19 ms on 120/120
  rows, so a correctly placed take reads `aligned` and a misplacement fails it — a netted
  cell is `aligned` or `investigate`, never a band match. Bands A–D stay as the profile's
  fallback for rows without a delay. The offline scripts do NOT net (they replay the
  persisted A–D verdicts; their oracle files are unchanged) — a script wanting the netted
  verdict passes the option explicitly.
- **Signature bands are per SDK build.** `signatureBandsFor()` picks the band table from
  the `buildFeatures` list the page probes off the live SDK and persists on the envelope:
  bands A–D (predicted, written before their data existed) for the installed release, and
  the descriptive bands E/F for the calibration branch — selected by the presence of
  `LatencyProbes`, a proxy that exists only from the build after the keep-alive sink.
  The served build decides, not the `sdkBuildProbe` label: a future release that ships
  `LatencyProbes` resolves to E/F even though the marker stamps it `upstream` (INTENDED —
  A–D were fitted to the pre-#376 release and stop describing such a build; pinned in
  `recordingAuditCalibration.test.ts`). Envelopes written before the field fall back to a
  documented run-token threshold. E/F
  were FITTED to the two sweeps they classify, so a match on those runs is the envelope's
  construction, not a reproduced prediction — quote the 8-of-20 figure under A–D beside
  any 20-of-20 under E/F.
- Runs upload `recaudit-summary-<timestamp>.json` / `recaudit-mt-summary-<timestamp>.json`
  plus one WAV per repeat into `.verify-output/` via the dev server's `/__verify` sink.
  Capture WAV names carry the build probe and a per-run token — do NOT join a summary
  row to a WAV by filename alone, that collided silently before the token existed.
- Take placement is judged on the project's **absolute** beat grid (integer multiples of
  the beat period from timeline zero), not a region-anchored one. A region-anchored grid
  manufactures a phantom expected beat whenever no click was captured before the region
  start, which reads as a false content loss on every punch-in take.
- Two reasons a run used to lose repeats, neither a harness bug, both fixed in the installed
  SDK and characterized in the register: `loop-wrap` finalization timed out at a high rate
  (the stop path set a `limit` above the delivered frames; it now limits to
  `numberOfFrames`), and two simultaneous takes of byte-identical audio collided on a
  content-addressed `AudioFileBox` uuid (the capture now owns the uuid).
- Start the transport with a REAL click and keep the window visible — see root
  CLAUDE.md's browser-automation notes.
- Build probe: the page labels each run `candidate` when `CaptureAudio.prototype`
  exposes `calibrateInputLatency` (the loopback calibration, upstream PR #380 — still
  unreleased) and `upstream` otherwise; the label lands in the summary's `sdkBuildProbe`
  and in every WAV name. The marker is always the newest campaign surface the installed
  release lacks (it was `engine.recordingStart` until PR #376 shipped), so re-target
  `detectSdkBuildProbe` (both audit demos) when a release ships #380. Band selection does
  NOT read the label — `profileKeyFor` keys on the persisted `buildFeatures` list; an
  installed release's `[recordingStart]` resolves to bands A–D, the table the Task 9
  (#376-branch) runs were judged against. Rows also persist `firstQuantumTimeSec` (every
  build that ships #376); `firstQuantumTimeSec − anchorT0Sec` is the loopback path's own
  input delay for that row.
- Finalization probe, persisted per row on every build: `finalizeNumberOfFramesAtStop`,
  `finalizeLimitCalls`, `finalizeNumberOfFramesAtLimit`, `finalizeOvershootFrames`,
  `finalizeNumberOfFramesAfter`, `finalizeLoaderState`. The harness patches `limit()` on
  the take's live `RecordingWorklet` instance before it calls `stopRecording()`; a hung
  finalization is an empty `finalizeLimitCalls` with `finalizeLoaderState: "record"`, and
  an error row carries the probe of the repeat that failed.

### Input-Latency Calibration Ground-Truth Page (unlisted)

Measures the SDK's loopback input-latency calibration against a delay the harness injects
itself. It sweeps a `DelayNode` in the synthetic loopback's return path, calibrates at each
value, fits the measured input part against the injected delay, applies the calibration, and
runs ONE `nominal-start` cell through the standing sweep's own runner
(`src/lib/audit/recordingCellRunner.ts`) so the verdict is the campaign's metric:

```
input-latency-calibration-debug-demo.html?delays=0,10,25,50&bpm=120&rate=48000
    &armState=steady|fresh&defaultInput=1&repeat=<n>
```

- `?delays=` — injected return delays in ms (default `0,10,25,50`). Refused twice: at parse
  time against a 550 ms static ceiling, and per point against the round trip the run is
  actually measuring, because the SDK searches only 600 ms of lag and an over-long delay
  comes back as a `no-signal` row that looks like a failure. Refused points land in
  `skipped` with the reason.
- `?armState=steady|fresh` — `fresh` disarms and re-arms after `apply`, so take 1 runs on a
  chain the SDK rebuilt. That is the configuration that exposes the two-state chain lottery:
  the calibration is right only for the state it measured.
- `?defaultInput=1` — leave the capture box's `deviceId` unset and withhold every audio input
  from `enumerateDevices`, so the SDK asks for the default device without naming one. NOT a
  reuse-versus-rebuild switch on this page: its loopback reports the device id back
  (`reportDeviceId: true`), so the named mode reuses its chain too and both modes persist
  `getUserMediaOpens: 1`. It selects WHICH reuse rule runs — the unnamed-box rule from
  `546b5bfaa` instead of the named-device one. It cannot coexist with a real device in the
  same page load. (The alignment harness, whose loopback leaves `reportDeviceId` off, is
  where default input is the only reusing configuration.)
- `?repeat=<n>` — after the sweep, run n more calibrations back to back on the same chain,
  CYCLING the delays `?delays=` names (call k at `delays[k mod len]`, with the same settle
  before each call as the sweep), and report the one-quantum miss rate. Each call persists the
  delay it ran at and the previous call's.

Envelope `calib-summary-<runToken>.json`: `sweep` (one row per delay, the full SDK `Result`
plus the requested delay), `warmup` (the discarded priming call), `fit` / `fitIncludingNoisy` /
`fitExcludedNoisy` (the headline fit is `ok` rows only; the all-rows answer is kept so the
exclusion's effect is visible), `applied`, `storedEntry`, `cell` (the runner's verdict and
rows), `harnessLoopbackHopPerRowSec` and `cellRowStates` (the harness's own
`firstQuantumTimeSec − anchorT0Sec` per take, plus `first-after-arm` vs `reused`), `repeats` /
`repeatSummary`, and the shared `buildFeatures` / `captureMode` / `getUserMediaOpens`.
**`getUserMediaOpens` is cumulative per page load**, not per run — a "Re-run" persists the
total since load, so navigate fresh per run if the count is the evidence.

**Real-input mode (`?input=real`).** Same page, same SDK routine, against a PHYSICAL
input instead of the synthetic loopback — the evidence the loopback cannot give: the
detector's hit rate on a real device and the answer's repeatability there.

```
input-latency-calibration-debug-demo.html?input=real&rate=48000&bpm=120
    &repeat=<n>&armState=steady|fresh&deviceId=<id>&label=<text>
```

- Nothing of the loopback is installed in this mode (no `getUserMedia` override, no
  DelayNode, no destination tee; `loopback` is `null` and every loopback-only path throws
  through `requireLoopback()`). `?delays=` and `?defaultInput=` are rejected.
- `?repeat=` defaults to 10 (1–200): the run IS the repeat phase — N direct
  `calibrateInputLatency({})` calls on the chosen device, then one `{apply: true}`.
  `?armState=fresh` disarms and re-arms HALFWAY through (after call ⌈N/2⌉), so the second
  half measures a chain the SDK rebuilt; each persisted call carries `chainIndex` 0/1.
- `?deviceId=` preselects an enumerated input; `?label=` prefills the free-text run label
  (persisted as `runLabel` — say what was plugged in: "cable loopback", "laptop mic +
  speakers").
- No applied take cell: `cell.status` is `"skipped"` (its reference clicks and band split
  assume the loopback tap). No injected delay: `sweep: []`, `fit: null`. The probe
  traverses the real output device, so `harnessPathBiasSec` is 0 and a 0
  `audioContext.outputLatency` read is recorded (`outputLatencyAtStartSec`,
  `outputLatencyAfterFirstCallSec`, `baseLatencySec`), not refused.
- A call that throws or times out is persisted as an `error` row (verdict `"error"`, the
  message in `reason`, NaN figures) and the run continues — one deadline must not lose the
  calls before it. `getUserMediaOpens` counts the page's ACTUAL opens since load, the label
  unlock included (expected 2 on a steady run and 3 on a fresh one — not yet measured: the
  six 2026-09-03 envelopes predate the counter and persist the arm count, 1 or 2, and no
  `armedStreamDeviceIds`). The stored entry is looked up under the stream the apply ran on
  (`deviceId`); every armed stream's id is in `armedStreamDeviceIds`, and
  `streamDeviceIdChanged` says whether a re-arm reported a different one. Every arm also
  compares the reported id with the REQUESTED one: the SDK's `#updateStream` falls back to
  the default input when `{exact: deviceId}` fails (a console.warn only), so
  `deviceFallback` / `requestedDeviceId` / `arms` (per chain: ids, fallback flag, the
  track's `getSettings()` re-read after each re-arm, also `trackSettingsPerChain`) label
  the run instead of throwing. A re-arm that fails is an `error` row, the envelope is still
  uploaded, and the run ends `error:<message>`. Real mode persists `repeatSummary: null`
  and `repeats` as the SDK `Result` plus `index`/`chainIndex` only — never the loopback
  page's pooled-mode per-row fields — `realSummary` is the authority (the six 2026-09-03
  envelopes predate this and carry a pooled `repeatSummary` and per-row miss flags to be
  ignored). The status trail is cumulative per page load (setup → device at load, then the
  run's stages, `rearming` on a fresh run).
- Envelope additions: `inputMode: "real"`, `runLabel`, `device` (`deviceId`/`label`/
  `groupId`), `trackSettings` (the armed track's `getSettings()`: deviceId, latency,
  sampleRate, channelCount, echo/noise/AGC flags — proof of the processing state and the
  browser's own latency figure), `realSummary` (`src/lib/audit/realInputSummary.ts`,
  pure + tested: counts per verdict, usable-call stats, and PER CHAIN the modes, clusters
  and round-trip states; a descriptive `repeatable` / `two-state` / `scattered` /
  `unusable` verdict decided on the chain's clusters (steady) or on the two chain medians
  (fresh), `verdictBasis` says which — no band, no pass/fail). Three things a call off
  its chain's mode can be are kept apart: `anchorDisagreements` (A vs B > ½ quantum, the
  SDK's detector), `stateTransitions` (a ≥ ½-quantum step from the previous agreeing call,
  anchors agreeing — counted on a last call too; `confirmedByFollowingCall` says whether a
  later agreeing call held the new state; `isOneQuantumStep` within 25 % of a quantum) and
  `isolatedDeviations` (one call off, anchors agreeing, previous and next at the mode —
  expected 0; a chain's off FIRST call is `firstCallOff` instead). Clusters are read on
  the input part unless `outputLatencyReported` flips within the run, then on the round
  trip (`verdictSeries`).
  Never judge a fresh run's second chain against the pooled mode: the rebuilt chain lands
  where it lands, and that difference is `chainMedianDifferenceQuanta` only. Loopback
  envelopes gain only `inputMode: "loopback"`. `#real-verdict` carries `data-verdict`.
- Run recipe: serve the calibration-branch build through `SDK_DIST_OVERRIDE`; open the URL
  on a visible window; grant the mic permission (the page asks once to unlock device
  labels); pick the device in the select and type a label; click Start with a REAL click.
  Acoustic case: keep the room quiet — every call plays three audible bursts out of the
  speakers, and the mic must hear them. Cable case: route the interface's output into the
  chosen input physically. One fresh navigation per run.
- **Measured so far** (2026-09-03, branch `9d0cccb88`, Chrome/macOS): ONE device — a MacBook
  Pro built-in microphone, acoustically — six runs (2 + 5 × 30 calls; 48 and 44.1 kHz; steady
  and fresh). Every call 3/3 bursts at 30.55–38.16 dB; round trip constant to ≤ 0.024 frame
  within a chain state; the browser's track `latency` (0.002666 s) sits 35–63 ms under the
  measured input part; the second-anchor detector's first real hit (1 in 152, anchor B one
  quantum off, A at the mode); the input path stepping DOWN one render quantum mid-chain and
  holding (2 of 5 chains at 48 kHz, 0 of 3 at 44.1) — a stored calibration 2.67 ms off until
  recalibrated, and invisible to the anchor check by construction; page loads ~24 ms apart at
  48 kHz, re-arms under one quantum, neither on a 32- or 128-frame lattice. NOT measured: a
  cable loopback, other browsers/devices, a take cell on a real path. Tables, findings with
  status, what remains: `debug/recording-start-alignment-audit.md`, section "Real-device
  calibration (2026-09-03)"; recompute with
  `node scripts/audit/recording-alignment/task12c-real-input-tables.ts [runs|chains|events|all]`.

**Branch API shim.** `calibrateInputLatency`, `clearInputLatencyCalibration` and
`recording.inputLatencyCalibrations` exist only on the upstream calibration branch, and this
repo's tsc resolves `@opendaw/*` types from the installed release, so the page reaches them
through local structural interfaces plus a runtime feature check. Delete the interfaces and
the check when a release ships the API. The page needs the branch build served through
`SDK_DIST_OVERRIDE` and says so when it is missing.

Measurements, findings and what remains: `debug/recording-start-alignment-audit.md`,
section "Input-latency calibration (2026-09-02)" (loopback) and "Real-device calibration
(2026-09-03)". Offline recomputation:
`node scripts/audit/recording-alignment/task12b-calibration-tables.ts` (loopback) and
`node scripts/audit/recording-alignment/task12c-real-input-tables.ts` (real device).

## Reference Files
- Recording demo: `src/demos/recording/recording-api-react-demo.tsx`
- Loop recording demo: `src/demos/recording/loop-recording-demo.tsx`
- Recording tape card: `src/components/RecordingTapeCard.tsx`
- Take timeline: `src/demos/recording/TakeTimeline.tsx`
- Engine preferences hook: `src/hooks/useEnginePreference.ts`
- Takes preferences panel: `src/demos/recording/TakesPreferencesPanel.tsx`
- Loop setup panel: `src/demos/recording/LoopSetupPanel.tsx`

## Shared Recording Hooks
- `src/hooks/useRecordingSession.ts` — state machine (idle → counting-in → recording → finalizing → ready → playing), engine subscriptions, eager sampleLoader finalization barrier
- `src/hooks/useAudioDevicePermission.ts` — mic permission + input/output device enumeration
- `src/hooks/useRecordingTapes.ts` — Tape instrument creation, capture config, arming, tape add/remove
- `src/demos/recording/useTapePeaks.ts` — live + finalized peaks rendering per tape (CanvasPainter lifecycle)
- `src/demos/recording/useTakeDiscovery.ts` — reactive take discovery/grouping via adapter-layer subscriptions
