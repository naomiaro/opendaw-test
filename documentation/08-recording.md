# Recording

> **Skip if:** you're not implementing recording, MIDI capture, or take management
> **Prerequisites:** Chapter 04 (Box System), Chapter 05 (Samples & Peaks)

This comprehensive guide covers OpenDAW's recording system: audio and MIDI capture, track arming, input configuration, monitoring, loop recording with takes, step recording, and live waveform peaks.

## Table of Contents
- [Recording Pipeline Overview](#recording-pipeline-overview)
  - [AudioUnit, Tape, and Track: The Recording Hierarchy](#audiounit-tape-and-track-the-recording-hierarchy)
  - [TrackBox.index: What It Controls (and What It Doesn't)](#trackboxindex-what-it-controls-and-what-it-doesnt)
  - [Creating TrackBoxes Manually](#creating-trackboxes-manually)
  - [Multi-Lane Tape Semantics](#multi-lane-tape-semantics)
- [Track Arming](#track-arming)
- [Audio Input Configuration](#audio-input-configuration)
- [MIDI Input Configuration](#midi-input-configuration)
- [Input Monitoring](#input-monitoring)
- [Loop Recording & Takes](#loop-recording--takes)
- [Step Recording](#step-recording)
- [Recording Preferences Reference](#recording-preferences-reference)
- [Multi-Track Recording](#multi-track-recording)
  - [Adding Recording Tracks Dynamically](#adding-recording-tracks-dynamically)
  - [Recording Multiple Devices Simultaneously](#recording-multiple-devices-simultaneously)
  - [Multi-Track Finalization (Counting Barrier)](#multi-track-finalization-counting-barrier)
- [Accessing Live Recording Peaks](#accessing-live-recording-peaks)
  - [Production Pattern (Timeline UI)](#production-pattern-timeline-ui)
  - [Demo Pattern (Preferred: Adapter Layer)](#demo-pattern-preferred-adapter-layer)
- [Smooth 60fps Rendering](#smooth-60fps-rendering)
  - [Single-Region Recording (No Takes)](#single-region-recording-no-takes)
  - [Loop Recording Takes: Use Duration, Not dataIndex](#loop-recording-takes-use-duration-not-dataindex)

## Recording Pipeline Overview

OpenDAW's recording pipeline follows this flow:

```
project.startRecording(countIn)
  → Recording.start(project, countIn)
    → captureDevices.filterArmed()     // find all armed capture devices
    → for each armed capture:
        → capture.prepareRecording()   // set up media stream / MIDI listener
        → capture.startRecording()     // begin capturing data
    → engine starts playback (with optional count-in)
```

Key classes in the pipeline:
- **`Recording`** — Static orchestrator that coordinates all armed captures
- **`CaptureDevices`** — Manages collection of capture devices on the project
- **`CaptureAudio`** — Audio-specific capture (microphone, line input)
- **`CaptureMidi`** — MIDI-specific capture (controllers, software keyboard)
- **`RecordAudio`** / **`RecordMidi`** — Internal workers that create region boxes
- **`RecordTrack`** — Finds or creates tracks for recording onto

The high-level `project.startRecording(countIn)` is a convenience wrapper. Under the hood, it calls `Recording.start()`, which:
1. Queries `captureDevices.filterArmed()` to get all armed captures
2. Creates a Tape instrument if no tracks exist (audio recording)
3. Calls `prepareRecording()` on each capture (sets up streams)
4. Calls `startRecording()` on each capture (begins data capture)
5. Starts the engine (with count-in if requested)

### AudioUnit, Tape, and Track: The Recording Hierarchy

Before diving into recording behavior, it helps to understand how these boxes relate:

- **AudioUnitBox** — The instrument channel (the "channel strip" in mixer terms). Owns volume, pan, effects, and a collection of **tracks**.
- **Tape** — A type of instrument device (`TapeDeviceBox`) hosted by an AudioUnitBox. When you call `createInstrument(InstrumentFactories.Tape)`, you get back an `audioUnitBox` (the channel) and one initial `trackBox`.
- **TrackBox** — A lane within the AudioUnitBox that holds regions. A single AudioUnitBox can have **multiple TrackBoxes**.

```
AudioUnitBox (channel strip: volume, pan, effects)
  ├─ input → TapeDeviceBox (the Tape instrument)
  └─ tracks
       ├─ TrackBox 0 ── AudioRegionBox, AudioRegionBox, ...
       ├─ TrackBox 1 ── AudioRegionBox (created by recording)
       └─ TrackBox 2 ── AudioRegionBox (created by loop take)
```

The key insight: **a Tape is not a track — it's a channel that contains tracks.** One Tape AudioUnit can hold many tracks, and the recording system creates new ones automatically.

### Recording on Tracks with Existing Content

OpenDAW's recording is non-destructive at the box graph level. When `startRecording()` runs on an armed Tape that already has audio regions, `RecordTrack.findOrCreate()` handles track selection:

1. Searches the audio unit's tracks for one with **no regions** (`trackBox.regions.pointerHub.isEmpty()`)
2. If an empty track is found, reuses it
3. If no empty track exists, **creates a new TrackBox** within the same AudioUnitBox

This means existing audio regions are never trimmed, split, or deleted by the recording system. The new recording always goes onto a separate, empty track within the audio unit.

```
audioUnitBox (Tape "Lead Vocal")
  +-- trackBox 0 ── existing audio regions (untouched)
  +-- trackBox 1 ── new recording region ("Take 1")
```

This applies to both loop and non-loop recording. For loop recording with `allowTakes`, each loop iteration creates additional TrackBoxes via the same `findOrCreate()` mechanism:

```
audioUnitBox (Tape "Lead Vocal") — loop recording with 3 takes
  +-- trackBox 0 ── AudioRegionBox "Take 1" (muted by olderTakeAction)
  +-- trackBox 1 ── AudioRegionBox "Take 2" (muted by olderTakeAction)
  +-- trackBox 2 ── AudioRegionBox "Take 3" (active — latest take)
```

All TrackBoxes share the same AudioUnitBox, so they all route through the same volume/pan/effects chain.

**Implication for DAW integrations:** A single Tape audio unit can serve as both the playback source (existing clips) and the recording target (new takes) simultaneously. There is no need to create a separate temporary Tape instrument to isolate recording from existing content — `RecordTrack.findOrCreate()` guarantees isolation at the track level within the audio unit.

**Note:** This behavior is based on the `RecordTrack.findOrCreate()` implementation in the SDK source (`RecordTrack.ts`). It is not currently exposed as a configurable option.

### TrackBox.index: What It Controls (and What It Doesn't)

Every TrackBox inside an AudioUnitBox carries a numeric `index` field. The naming suggests "lane order," but the contract is narrower:

**What `index` does:**
- Acts as a **slot identifier** for `RecordTrack.findOrCreate()`'s reuse logic. When recording starts, `findOrCreate()` walks existing TrackBoxes sorted by ascending `index` and reuses the first empty one whose `type` matches. Lower indexes get reused first.
- Is computed as `max(existingIndexes) + 1` when a new TrackBox is created.

**What `index` does NOT do:**
- Does NOT drive lane render order. `TapeDeviceProcessor` keys its lanes by TrackBox UUID via `SortedSet<UUID.Bytes, Lane>`, then iterates them in UUID-encounter order — not index order.
- Does NOT participate in mute/solo masking or take selection (those work off `regionBox.mute` and `olderTakeAction` directly).
- Is NOT an array position. After deletions, gaps are normal: a Tape with three lanes deleted in the middle can have indexes `1, 2, 4` permanently. The next `findOrCreate` will assign `5`, not `3`.

Treat `index` as opaque metadata the SDK maintains for its own reuse heuristic. Don't rewrite it to "compact" gaps after deletion — that would interfere with `findOrCreate`'s next-slot calculation if a recording is in progress on a parallel armed track.

### Creating TrackBoxes Manually

`project.api.createInstrument()` creates *both* an AudioUnitBox and an initial TrackBox in one call. To add additional lanes inside an existing Tape without going through the recording pipeline, use `TrackBox.create` directly and apply the same `max(existingIndexes) + 1` pattern that `RecordTrack.findOrCreate` uses internally:

```typescript
import { TrackType } from "@opendaw/studio-adapters";
import { TrackBox } from "@opendaw/studio-boxes";
import { UUID } from "@opendaw/lib-std";

// Compute next index from existing TrackBoxes in this AudioUnit.
let maxIndex = 0;
for (const tb of audioUnitBox.tracks.pointerHub.incoming().map(({ box }) => box)) {
  maxIndex = Math.max(maxIndex, tb.index?.getValue?.() ?? 0);
}

project.editing.modify(() => {
  TrackBox.create(project.boxGraph, UUID.generate(), (box) => {
    box.type.setValue(TrackType.Audio);
    box.index.setValue(maxIndex + 1);
    box.tracks.refer(audioUnitBox.tracks);  // membership pointer (lane belongs to this unit)
    box.target.refer(audioUnitBox);          // routing pointer (lane plays through this unit)
  });
});
```

Both the membership pointer (`tracks`) and the routing pointer (`target`) are required — the box graph rejects insertion otherwise.

**Don't update `index` after creation.** The SDK reads `index` only at `findOrCreate` time during recording. Mutating it doesn't change rendering and risks confusing `findOrCreate`'s next-slot calculation.

### Multi-Lane Tape Semantics

Once a Tape AudioUnitBox holds multiple TrackBoxes, a few invariants apply:

**Shared at the AudioUnit, per-lane on the TrackBox:**
- AudioUnitBox owns `volume`, `panning`, the effects chain, and `mute` (silences all lanes).
- TrackBox owns `regions`, `index`, `type`, and `enabled` (per-lane silence).
- Per-lane volume/effects aren't possible inside one Tape — use separate Tapes if you need that.

**Two ways to silence a lane:**
- `trackBox.enabled.setValue(false)` — disables the whole lane. The engine skips it in `TapeDeviceProcessor` (the same path `olderTakeAction: "disable-track"` uses).
- `regionBox.mute.setValue(true)` — mutes individual regions on a lane (the path `olderTakeAction: "mute-region"` uses, which is the default).

`audioUnitBox.mute` mutes the entire Tape (every lane) — don't reach for it for per-lane control.

**TrackBox.type must match the region types you'll add** — `TrackType.Audio` for `AudioRegionBox`, `TrackType.Notes` for note regions. Mismatched type silently fails to render.

**Deleting a TrackBox requires clearing pointer edges first, inside a transaction:**

```typescript
project.editing.modify(() => {
  trackBox.tracks.defer();  // clear membership pointer
  trackBox.target.defer();  // clear routing pointer
  trackBox.delete();
});
```

Like all box-graph mutations, both `defer()` and `delete()` must run inside `editing.modify()`. Skipping `defer()` causes the box graph to reject deletion (orphan-pointer error).

### Stopping Recording

**CRITICAL: Use `engine.stopRecording()` to stop recording, NOT `engine.stop(true)`.**

`engine.stop(true)` kills the audio graph immediately, which prevents `RecordingProcessor.process()` from writing remaining audio data to the RingBuffer. It also resets the playback position to 0, which in loop recording mode triggers spurious loop-wrap detection — this mutes the last recorded take via `olderTakeAction`.

The correct pattern:

```typescript
// 1. Stop recording — keeps the engine alive for finalization
project.engine.stopRecording();

// 2. Wait for finalization via sampleLoader.subscribe, then reset engine.
//    The sampleLoader is the RecordingWorklet during recording — get it via
//    project.sampleManager.getOrCreate(audioFileBox.address.uuid).
//    When #finalize() completes, it sets state to "loaded" and notifies.
const sub = sampleLoader.subscribe((state) => {
  if (state.type === "loaded") {
    sub.terminate();
    // Audio data is now available — safe to stop engine
    project.engine.stop(true);
  }
});
```

**Important notes**:
- Subscribe during recording (when the sampleLoader is first discovered) for most reliable results.
- If already loaded (short recording), the subscribe callback fires immediately.
- `queryLoadingComplete()` resolves before `sampleLoader.data` is set — do NOT use it to detect recording data availability.
- Do NOT call `setPosition(0)` after `engine.stop(true)` — `stop(true)` already resets position and calling `setPosition` separately can interfere with OpenDAW's internal finalization chain.

## Track Arming

Before recording, tracks must be "armed" — this tells the engine which tracks will receive recorded data.

```typescript
import { CaptureAudio, CaptureDevices } from "@opendaw/studio-core";

// Get capture device for a specific audio unit
const captureOpt = project.captureDevices.get(audioUnitBox.address.uuid);
if (captureOpt.nonEmpty()) {
  const capture = captureOpt.unwrap();

  // Arm exclusively (disarms all other captures)
  project.captureDevices.setArm(capture, true);

  // Arm non-exclusively (for multi-track recording)
  project.captureDevices.setArm(capture, false);

  // Check armed state
  const isArmed = capture.armed.getValue();
}

// List all armed captures
const armedCaptures = project.captureDevices.filterArmed();
```

**Auto-arming behavior**: When you call `project.startRecording()` with no tracks armed, `Recording.start()` automatically creates a Tape instrument and arms it.

## Audio Input Configuration

### Device Enumeration

```typescript
import { AudioDevices } from "@opendaw/studio-core";

// Request microphone permission (triggers browser prompt)
await AudioDevices.requestPermission();

// Refresh device list after permission grant
await AudioDevices.updateInputList();

// Get all available audio inputs
const inputs = AudioDevices.inputs; // ReadonlyArray<MediaDeviceInfo>

// Get default input device
const defaultInput = AudioDevices.defaultInput; // Optional<MediaDeviceInfo>
```

### Device Selection and Channels

```typescript
import { CaptureAudio } from "@opendaw/studio-core";

// After getting a CaptureAudio instance:
const capture = project.captureDevices.get(uuid).unwrap() as CaptureAudio;

// deviceId, requestChannels, gainDb are box graph fields — require editing.modify()
project.editing.modify(() => {
  // Select input device
  capture.captureBox.deviceId.setValue(deviceId); // string from MediaDeviceInfo.deviceId

  // Mono vs Stereo
  capture.requestChannels = 1; // mono
  capture.requestChannels = 2; // stereo (default)

  // Input gain (dB)
  capture.captureBox.gainDb.setValue(0);  // 0 dB = unity gain
  capture.captureBox.gainDb.setValue(-6); // -6 dB attenuation
  capture.captureBox.gainDb.setValue(6);  // +6 dB boost
});
```

## MIDI Input Configuration

### Device Enumeration

```typescript
import { MidiDevices } from "@opendaw/studio-core";

// Check if WebMIDI is available
if (MidiDevices.canRequestMidiAccess()) {
  await MidiDevices.requestPermission();
}

// Get all MIDI input devices (includes Software Keyboard)
const devices = MidiDevices.inputDevices(); // ReadonlyArray<MIDIInput>

// The Software Keyboard is always available
const softwareKb = MidiDevices.softwareMIDIInput;
console.log(softwareKb.name); // "Software Keyboard"
console.log(softwareKb.id);   // "software-midi-input"
```

### Software Keyboard

```typescript
// Send note events programmatically (on-screen keyboard)
MidiDevices.softwareMIDIInput.sendNoteOn(60, 0.8);  // note 60 (C4), velocity 0.8
MidiDevices.softwareMIDIInput.sendNoteOff(60);

// Set MIDI channel (0-15)
MidiDevices.softwareMIDIInput.channel = 0;

// Release all active notes
MidiDevices.softwareMIDIInput.releaseAllNotes();

// Emergency: send note-off for all notes on all channels
MidiDevices.panic();
```

### Channel Filtering

```typescript
// On the CaptureMidiBox:
captureMidiBox.channel.setValue(-1);  // -1 = listen to all channels
captureMidiBox.channel.setValue(0);   // channel 1 only (0-indexed)
captureMidiBox.channel.setValue(9);   // channel 10 (drums)

// Subscribe to filtered note events
const subscription = captureMidi.subscribeNotes((signal) => {
  if (NoteSignal.isOn(signal)) {
    console.log(`Note On: ${signal.pitch} vel:${signal.velocity}`);
  } else if (NoteSignal.isOff(signal)) {
    console.log(`Note Off: ${signal.pitch}`);
  }
});
```

## Input Monitoring

Input monitoring lets performers hear themselves while recording. OpenDAW supports three modes:

```typescript
import type { MonitoringMode } from "@opendaw/studio-core";

// MonitoringMode = "off" | "direct" | "effects"

const capture = project.captureDevices.get(uuid).unwrap() as CaptureAudio;

// Off: no monitoring (default)
capture.monitoringMode = "off";

// Direct: lowest latency, audio goes directly to output
// Bypasses all track effects and processing
capture.monitoringMode = "direct";

// Effects: audio passes through the track's effect chain
// Higher latency but lets performer hear effects (reverb, etc.)
capture.monitoringMode = "effects";

// Check current state
const isMonitoring = capture.isMonitoring; // boolean
```

**Important**: Enabling monitoring automatically arms the track if it isn't already armed.

**Note**: Unlike `captureBox.deviceId`/`gainDb`/`requestChannels`, `monitoringMode` is not a box graph field — it manipulates Web Audio nodes directly. Do **not** set it inside `editing.modify()`.

## Loop Recording & Takes

When loop mode is enabled and `allowTakes` is `true`, each loop iteration creates a new take on a separate track. This is useful for recording multiple performances and comparing them later.

### Setup

```typescript
const settings = project.engine.preferences.settings;

// Enable takes (defaults to true only in dev/localhost)
settings.recording.allowTakes = true;

// What to do with older takes when a new one is created
settings.recording.olderTakeAction = "mute-region";  // mutes the region
// OR
settings.recording.olderTakeAction = "disable-track"; // disables the entire track

// Scope of the action on older takes
settings.recording.olderTakeScope = "previous-only"; // only the immediately previous take
// OR
settings.recording.olderTakeScope = "all";           // all previous takes
```

### Loop Area Configuration

```typescript
// Set up a 4-bar loop
const barsToLoop = 4;
const loopEnd = PPQN.Quarter * 4 * barsToLoop; // 4/4 time

project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(0);
  project.timelineBox.loopArea.to.setValue(loopEnd);
  project.timelineBox.loopArea.enabled.setValue(true);
});
```

### Recording and Finding Takes

```typescript
// Start recording (loop must be enabled)
project.startRecording(useCountIn);

// After recording, find all takes
const takes = project.boxGraph.boxes()
  .filter(box => box.name === "AudioRegionBox")
  .filter(box => {
    const label = (box as any).label?.getValue();
    return label && label.startsWith("Take ");
  });

// Toggle mute on a take to compare performances
project.editing.modify(() => {
  const currentMute = takeRegionBox.mute.getValue();
  takeRegionBox.mute.setValue(!currentMute);
});
```

### How Takes Work Internally

1. `RecordAudio.start()` creates the first take region (labeled "Take 1") on an empty track
   (see "Recording on Tracks with Existing Content" above for how the track is selected)
2. When the engine position wraps past the loop end, a new take is created:
   - `RecordTrack.findOrCreate()` finds an empty track or creates a new one
   - A new `AudioRegionBox` is created (labeled "Take 2", "Take 3", etc.)
   - The previous take is muted/disabled based on preferences
3. All takes share the same underlying `AudioFileBox` (the continuous recording buffer)
4. Each take's `position` and `duration` correspond to the loop boundaries
5. Each take's `waveformOffset` (seconds) indicates where its audio starts in the shared buffer:
   - Take 1: `waveformOffset` = count-in frames duration
   - Take 2: `waveformOffset` = count-in + Take 1 duration
   - Take N: `waveformOffset` = count-in + sum of all prior take durations

### Rendering Take Peaks

Since all takes share one recording buffer, you must use `waveformOffset` and `duration` to render only the correct slice for each take.

**Note on units:** The recording system sets `timeBase` to `TimeBase.Seconds` on recorded regions, so `duration` and `loopOffset`/`loopDuration` are in **seconds** (not PPQN pulses as in manually-placed clips where `timeBase` is `TimeBase.Musical`).

```typescript
const waveformOffsetSec = regionBox.waveformOffset.getValue(); // seconds
const durationSec = regionBox.duration.getValue();             // seconds (timeBase is Seconds)
const sampleRate = audioContext.sampleRate;

const u0 = Math.round(waveformOffsetSec * sampleRate); // start of this take in buffer
const u1 = u0 + Math.round(durationSec * sampleRate);  // end of this take in buffer

PeaksPainter.renderPixelStrips(context, peaks, channel, {
  x0: 0, x1: canvas.width,
  y0, y1,
  u0, u1,  // render only this take's slice
  v0: -1, v1: 1,
});
```

**Without this**, Take 1 shows count-in silence and all other takes render the wrong portion of the buffer (appearing silent).

## Step Recording

Step recording allows entering notes one at a time at the current playhead position, without requiring real-time performance. This is the headless equivalent of the note editor's step recording mode.

### Headless Step Recording Pattern

```typescript
import { NoteEventBox, NoteEventCollectionBox, NoteRegionBox } from "@opendaw/studio-boxes";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";

// 1. Create a note region on a track (if one doesn't exist)
project.editing.modify(() => {
  const collection = NoteEventCollectionBox.create(boxGraph, UUID.generate());
  NoteRegionBox.create(boxGraph, UUID.generate(), box => {
    box.regions.refer(trackBox.regions);
    box.events.refer(collection.owners);
    box.position.setValue(0);
    box.label.setValue("Step Recording");
  });
});

// 2. Create notes at specific positions
const position = engine.position.getValue();
const duration = PPQN.Quarter; // quarter note

project.editing.modify(() => {
  NoteEventBox.create(boxGraph, UUID.generate(), box => {
    box.events.refer(eventsCollection.events);
    box.position.setValue(position);
    box.duration.setValue(duration);
    box.pitch.setValue(60);        // Middle C
    box.velocity.setValue(0.8);    // 0.0-1.0
  });
});

// 3. Advance playhead
engine.setPosition(position + duration);
```

### NoteEventBox Properties

| Property | Type | Description |
|----------|------|-------------|
| `position` | Int32 | PPQN position within the region |
| `duration` | Int32 | Note length in PPQN |
| `pitch` | Int32 | MIDI note number (0-127) |
| `velocity` | Float32 | Note velocity (0.0-1.0) |
| `playCount` | Int32 | Number of repetitions (1-128) |
| `playCurve` | Float32 | Velocity curve (-1.0 to 1.0) |
| `cent` | Float32 | Fine tuning (-50 to +50 cents) |
| `chance` | Int32 | Probability of playing (0-100%) |

## Recording Preferences Reference

All recording preferences are accessed via `project.engine.preferences.settings.recording`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `countInBars` | 1-8 | 1 | Number of count-in bars before recording |
| `allowTakes` | boolean | `isDevOrLocalhost` | Enable loop-based take recording |
| `olderTakeAction` | `"mute-region"` \| `"disable-track"` | `"mute-region"` | Action on older takes when new take created |
| `olderTakeScope` | `"all"` \| `"previous-only"` | `"previous-only"` | Which older takes are affected |

Other related preferences:

| Setting | Path | Type | Description |
|---------|------|------|-------------|
| Metronome enabled | `metronome.enabled` | boolean | Enable click track |
| Metronome gain | `metronome.gain` | number (dB) | Click volume |
| Metronome subdivision | `metronome.beatSubDivision` | 1\|2\|4\|8 | Click subdivision |

## Multi-Track Recording

OpenDAW supports recording multiple tracks simultaneously. Each armed capture device records independently with its own `MediaStream`, `RecordingWorklet`, and `SharedArrayBuffer`.

### Adding Recording Tracks Dynamically

```typescript
import { InstrumentFactories } from "@opendaw/studio-adapters";

// 1. Create a Tape instrument (auto-routes to master)
//    editing.modify() doesn't forward return values — capture via outer variable
let audioUnitBox: any = null;
project.editing.modify(() => {
  const result = project.api.createInstrument(InstrumentFactories.Tape);
  audioUnitBox = result.audioUnitBox;
  // Can also configure capture inside the same transaction:
  const captureOpt = project.captureDevices.get(result.audioUnitBox.address.uuid);
  if (!captureOpt.isEmpty()) {
    const cap = captureOpt.unwrap();
    cap.captureBox.deviceId.setValue(deviceId);
    cap.requestChannels = 1; // 1 = mono, 2 = stereo
  }
});

// 2. Get the CaptureAudio after transaction commits
const captureOpt = project.captureDevices.get(audioUnitBox.address.uuid);
if (captureOpt.isEmpty()) return;
const capture = captureOpt.unwrap();

// 3. Arm non-exclusively (keeps other tracks armed)
project.captureDevices.setArm(capture, false);
```

### Recording Multiple Devices Simultaneously

```typescript
// Arm multiple tracks (non-exclusive)
const audioCapture1 = project.captureDevices.get(uuid1).unwrap();
const audioCapture2 = project.captureDevices.get(uuid2).unwrap();

project.captureDevices.setArm(audioCapture1, false); // non-exclusive
project.captureDevices.setArm(audioCapture2, false);  // both stay armed

// Start recording — ALL armed captures record simultaneously
project.startRecording(useCountIn);

// Each capture creates its own region on its own track
// Audio capture → AudioRegionBox with peaks
// MIDI capture → NoteRegionBox with NoteEventBoxes
```

### Multi-Track Finalization (Counting Barrier)

When stopping a multi-track recording, you must wait for ALL sample loaders to finalize before resetting the engine:

```typescript
project.engine.stopRecording();

// Collect all sampleLoaders discovered during recording
const loaders: SampleLoader[] = [...allDiscoveredLoaders];

let finalized = 0;
for (const loader of loaders) {
  const sub = loader.subscribe((state) => {
    if (state.type === "loaded") {
      sub.terminate();
      finalized++;
      // Only reset engine after ALL tracks have finalized
      if (finalized === loaders.length) {
        project.engine.stop(true);
      }
    }
  });
}
```

**Why a barrier?** Calling `engine.stop(true)` kills the audio graph. If any track's `RecordingWorklet` hasn't finished writing to its `RingBuffer`, that track's audio data is lost.

## Accessing Live Recording Peaks

### SampleLoader / RecordingWorklet

During recording, `project.sampleManager.getOrCreate(uuid)` returns the `RecordingWorklet` itself — it IS the SampleLoader. Key properties:
- `peaks` → `Option<Peaks>` — PeaksWriter during recording, SamplePeaks after finalization
- `data` → `Option<AudioData>` — set by `#finalize()` before SamplePeaks are generated
- `state` → `{ type: "record" | "loaded" | ... }` — tracks lifecycle
- `subscribe(observer)` — observe state changes (fires with `{type: "loaded"}` when finalization completes)

Distinguish live vs. final peaks with `"dataIndex" in peaks`:
- **PeaksWriter** (live): has `dataIndex: Int32Array`, `data: Array<Int32Array>`
- **SamplePeaks** (final): no `dataIndex` property

### Production Pattern (Timeline UI)

This is OpenDAW's approach — iterate through regions during rendering and check loader state.

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

function renderAudioRegion(region: AudioRegionBoxAdapter) {
  const loader = region.file.getOrCreateLoader();
  const isRecording = loader.state.type === "record";

  if (isRecording) {
    const peaksOption = loader.peaks;
    if (peaksOption && !peaksOption.isEmpty()) {
      const peaks = peaksOption.unwrap();
      const isPeaksWriter = "dataIndex" in peaks;

      if (isPeaksWriter) {
        const unitsToRender = peaks.dataIndex[0] * peaks.unitsEachPeak();
        // render using PeaksPainter
      }
    }
  }
}
```

### Demo Pattern (Preferred: Adapter Layer)

For region discovery during recording, prefer the SDK adapter layer over `boxGraph.boxes()` scanning. The adapter provides typed access and automatic sampleLoader resolution:

```typescript
const allAudioUnits = project.rootBoxAdapter.audioUnits.adapters();
const audioUnitAdapter = allAudioUnits.find(au => au.box === capture.audioUnitBox);

audioUnitAdapter.tracks.catchupAndSubscribe({
  onAdd: (trackAdapter) => {
    trackAdapter.regions.catchupAndSubscribe({
      onAdded: (regionAdapter) => {
        if (!regionAdapter.isAudioRegion()) return;
        if (regionAdapter.label !== "Recording") return;

        // Adapter resolves loader internally — no manual UUID lookup
        const loader = regionAdapter.file.getOrCreateLoader();
        const peaks = regionAdapter.file.peaks; // Option<Peaks | PeaksWriter>
      },
      onRemoved: () => {},
    });
  },
  onRemove: () => {},
  onReorder: () => {},
});
```

Note: `AudioUnitTracks` uses `onAdd`/`onRemove`/`onReorder`; `TrackRegions` uses `onAdded`/`onRemoved`.

## Smooth 60fps Rendering

The key to smooth live waveform rendering is using `dataIndex` from PeaksWriter instead of `numFrames`:
- `peaks.numFrames` jumps in 0.5-second chunks → choppy rendering
- `peaks.dataIndex[0]` updates every frame → smooth progressive waveform

### Single-Region Recording (No Takes)

When there's one region spanning the entire buffer, use `dataIndex` for `u1`:

```typescript
const isPeaksWriter = "dataIndex" in peaks;
const u0 = Math.round(waveformOffsetSec * sampleRate); // skip count-in frames

if (isPeaksWriter) {
  const u1 = peaks.dataIndex[0] * peaks.unitsEachPeak();
} else {
  const u1 = peaks.numFrames; // final peaks — render all
}

PeaksPainter.renderPixelStrips(context, peaks, channel, {
  x0: 0, x1: canvas.clientWidth,
  y0, y1, u0, u1,
  v0: -1, v1: 1,
});
```

### Loop Recording Takes: Use Duration, Not dataIndex

**Do NOT use `dataIndex` for per-take rendering.** All takes share one `AudioFileBox` and one `PeaksWriter`, so `dataIndex[0] * unitsEachPeak()` returns the total accumulated frames across **all** takes — not the current take's slice. This causes finalized takes to "bleed" into subsequent takes' audio.

Instead, use `waveformOffset` + `duration` (see [Rendering Take Peaks](#rendering-take-peaks)). The SDK updates each take's `regionBox.duration` every frame, so even the currently-recording take renders smooth 60fps growth.

## Summary

| Feature | API | Demo |
|---------|-----|------|
| Basic recording | `project.startRecording()` | `recording-api-react-demo.html` |
| Audio input selection | `AudioDevices.inputs` | `recording-api-react-demo.html` |
| Mono/stereo | `capture.requestChannels` | `recording-api-react-demo.html` |
| Input gain | `capture.captureBox.gainDb` | `recording-api-react-demo.html` |
| Input monitoring | `capture.monitoringMode` | `recording-api-react-demo.html` |
| Multi-device recording | `setArm(capture, false)` | `recording-api-react-demo.html` |
| MIDI recording | `MidiDevices`, `CaptureMidi` | `midi-recording-demo.html` |
| Software keyboard | `MidiDevices.softwareMIDIInput` | `midi-recording-demo.html` |
| Step recording | `NoteEventBox.create()` | `midi-recording-demo.html` |
| Loop recording | `allowTakes` preference | `loop-recording-demo.html` |
| Take management | region `.mute` field | `loop-recording-demo.html` |

**Next Steps**: See [Timeline & Rendering](./06-timeline-and-rendering.md) for rendering waveforms in a timeline context, or [Mixer Groups](./07-building-a-complete-app.md#advanced-mixer-groups-sub-mixing) for routing recorded tracks through sub-mixes.
