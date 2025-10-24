# openDAW Headless App

This is a template to run the openDAW SDK with the least possible number of dependencies.

## Create certificates to get https on localhost (one time only)

`mkcert localhost`

## Installation and Run

* `npm install`
* `npm run dev`

## Critical: AnimationFrame Initialization

**⚠️ IMPORTANT**: You must call `AnimationFrame.start(window)` before using OpenDAW's engine, or observables will not work!

```typescript
import { AnimationFrame } from "@opendaw/lib-dom";

// Start the AnimationFrame loop - REQUIRED for observables to update
AnimationFrame.start(window);
```

**Why is this required?**

OpenDAW's engine uses SharedArrayBuffer to sync state from the audio worklet processor (which runs in AudioWorkletGlobalScope) to the main thread. The `AnimationFrame` loop calls `requestAnimationFrame` every frame to read from the SharedArrayBuffer and update observable values like `isPlaying`, `isRecording`, and `position`.

Without this call:
- ❌ Audio will play, but `isPlaying` will stay `false`
- ❌ Position will not update
- ❌ Recording state will not sync
- ❌ Observable subscriptions will never fire

**Where to call it:**
Call `AnimationFrame.start(window)` early in your app initialization, before creating the project or starting the audio worklet.

See `src/playback-demo.ts` and `src/recording-api-demo.ts` for examples.

## Observable Patterns

OpenDAW uses observables for state management. Understanding when to use `subscribe()` vs `catchupAndSubscribe()` is crucial:

### `subscribe()` - Future Updates Only

```typescript
project.engine.isPlaying.subscribe((obs) => {
    console.log("Playing state changed:", obs.getValue())
})
```

- ✅ Only notified on **future changes**
- ❌ Does NOT get the current value immediately
- Use when you only care about changes (e.g., detecting transitions)

### `catchupAndSubscribe()` - Current Value + Future Updates

```typescript
project.engine.isPlaying.catchupAndSubscribe((obs) => {
    console.log("Playing state:", obs.getValue())
})
```

- ✅ Immediately calls callback with **current value**
- ✅ Then notified on all **future changes**
- Use when components need to sync with existing state (e.g., React components mounting at any time)

### Real-World Example: React Components

```typescript
useEffect(() => {
    // BAD: Component won't show correct state if track was already soloed
    const sub = track.audioUnitBox.solo.subscribe((obs) => {
        setSoloed(obs.getValue())
    })

    // GOOD: Component immediately syncs with current state
    const sub = track.audioUnitBox.solo.catchupAndSubscribe((obs) => {
        setSoloed(obs.getValue())
    })

    return () => sub.terminate() // Always clean up!
}, [track])
```

**Rule of thumb:** Use `catchupAndSubscribe()` in React components or any code that can initialize after state has already changed.

### Lifecycle Management

Always terminate subscriptions when done to prevent memory leaks:

**Vanilla JS:**
```typescript
import { Terminator } from "@opendaw/lib-std"

const lifecycle = new Terminator()

// Own subscriptions
lifecycle.own(
    project.engine.isPlaying.catchupAndSubscribe((obs) => {
        console.log(obs.getValue())
    })
)

// Later, clean up everything
lifecycle.terminate()
```

**React:**
```typescript
useEffect(() => {
    const subscription = observable.catchupAndSubscribe((obs) => {
        setState(obs.getValue())
    })

    // React cleanup function automatically terminates on unmount
    return () => subscription.terminate()
}, [dependencies])
```

See `src/lifecycle-react-demo.tsx` for a complete React example with dynamic component lifecycle management.

## Demos

This project includes three demos showcasing different OpenDAW capabilities:

### 1. Multi-track Playback Demo (`/playback-demo.html`)

Demonstrates simultaneous playback of multiple audio tracks:

- **4 Tape Tracks** - Bass & Drums, Guitar, Piano & Synth, and Vocals all playing simultaneously
- **Custom Audio Loading** - Loads MP3 files from your public/audio folder
- **Custom Sample Provider** - Converts AudioBuffers to OpenDAW's format
- **Three Transport Controls:**
  - Play (Blue) - Starts playback from beginning or resumes from pause
  - Pause (Orange) - Pauses and maintains the exact playback position
  - Stop (Red) - Stops and resets to the beginning

**How It Works:**
- Calls `AnimationFrame.start(window)` to enable observable state sync
- The pause button reads the current playback position directly from `project.engine.position.getValue()`
- When resuming from pause, it uses `engine.setPosition()` to restore the exact position before starting playback again
- All audio tracks are scheduled as `AudioRegionBox` instances with corresponding `AudioFileBox` references
- Observable subscriptions track `isPlaying` and `position` state changes in real-time

### 2. Recording API Demo (`/recording-api-react-demo.html`)

Demonstrates real-time audio recording with waveform visualization using OpenDAW's Recording API:

- **Automatic Microphone Access** - CaptureAudio handles microphone permissions automatically
- **Waveform Visualization** - Renders recorded audio peaks directly from RecordingWorklet
- **Count-in Support** - Optional metronome count-in before recording starts
- **Observable State Tracking** - Real-time status updates via `isRecording`, `isCountingIn` observables
- **Three-Step Workflow:**
  - **Arm Track** - Creates tape instrument and arms capture device (mic access handled automatically)
  - **Start Recording** - Begins recording with optional count-in
  - **Stop Recording** - Saves recording, creates audio regions, and displays waveform

**How It Works:**

**Automatic Microphone Access:**
```typescript
// Get the capture device for the tape instrument
const captureOption = project.captureDevices.get(audioUnitUUID);
const capture = captureOption.unwrap();

// Just arm it - CaptureAudio handles microphone access automatically!
capture.armed.setValue(true);
```

When you set `capture.armed.setValue(true)`:
1. CaptureAudio's observable subscription triggers
2. Calls `AudioDevices.requestStream()` to request microphone permission
3. Stores the MediaStream internally
4. Automatically stops the stream when disarmed

**You don't need to:**
- ❌ Manually call `navigator.mediaDevices.getUserMedia()`
- ❌ Store the stream in a ref or state
- ❌ Call `capture.stream.wrap()`
- ❌ Manually stop tracks on cleanup

**Recording and Waveform Visualization:**

When you call `project.startRecording()`, the `RecordAudio.start()` function automatically:
1. Creates a `RecordingWorklet` instance
2. Registers it with the sample manager via `sampleManager.record(recordingWorklet)`
3. **Automatically creates `AudioFileBox` and `AudioRegionBox`** on first position update
4. Updates the region duration in real-time as recording progresses
5. Links the boxes to the tape track

**You don't need to:**
- ❌ Manually create AudioFileBox
- ❌ Manually create AudioRegionBox
- ❌ Calculate durations in PPQN
- ❌ Link boxes to tracks

**Live Waveform Rendering During Recording:**

Since boxes are created automatically by `RecordAudio.start()`, you can access live peak data during recording:

```typescript
// 1. Start recording
project.startRecording(countIn);

// 2. Wait for RecordAudio to create the AudioRegionBox (happens on first position update)
const checkForRecording = () => {
  // Access regions via pointerHub.incoming() - same pattern as in Recording.js
  const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);

  if (regions.length > 0) {
    const latestRegion = regions[regions.length - 1];

    // Check if the file pointer is set
    if (latestRegion.file.isEmpty()) {
      setTimeout(checkForRecording, 100);
      return;
    }

    // Get the recording UUID - targetAddress is an Option type, so unwrap it
    const targetAddressOption = latestRegion.file.targetAddress;

    if (targetAddressOption.isEmpty()) {
      setTimeout(checkForRecording, 100);
      return;
    }

    const targetAddress = targetAddressOption.unwrap();
    const recordingUUID = targetAddress.uuid;

    // 3. Get the RecordingWorklet from sample manager
    const recordingWorklet = project.sampleManager.getOrCreate(recordingUUID);

    // 4. Poll for live peaks using requestAnimationFrame
    const pollForPeaks = () => {
      const peaksOption = recordingWorklet.peaks;

      if (peaksOption && !peaksOption.isEmpty()) {
        const peaks = peaksOption.unwrap(); // Returns PeaksWriter during recording

        // Detect if it's PeaksWriter (during recording) vs final Peaks (after recording)
        const isPeaksWriter = "dataIndex" in peaks;

        if (isPeaksWriter) {
          // Use actual written peaks count from dataIndex
          const numWrittenPeaks = peaks.dataIndex[0];
          const actualFrames = numWrittenPeaks * peaks.unitsEachPeak();
          // Render waveform with actualFrames using PeaksPainter.renderBlocks()...
        } else {
          // After recording completes, peaks.numFrames is available
          // Render final waveform...
        }
      }

      requestAnimationFrame(pollForPeaks);
    };

    pollForPeaks();
  } else {
    setTimeout(checkForRecording, 100);
  }
};

checkForRecording();
```

**Important Box Graph Patterns:**

When working with OpenDAW's box graph, you need to understand how to access related boxes:

1. **Accessing Child Boxes via PointerHub:**
   ```typescript
   // WRONG: trackBox.regions.children - this doesn't exist!
   // RIGHT: Use pointerHub.incoming() to get boxes pointing to this field
   const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);
   ```

2. **Accessing Pointer Fields:**
   ```typescript
   // PointerField doesn't have .get() or .read() methods
   // Use .targetAddress to get the Option<Address> of the pointed-to box
   const targetAddressOption = regionBox.file.targetAddress;

   // Always check if Option is empty before unwrapping
   if (!targetAddressOption.isEmpty()) {
     const targetAddress = targetAddressOption.unwrap();
     const uuid = targetAddress.uuid;
   }
   ```

3. **Working with Option Types:**
   ```typescript
   // Many values in OpenDAW are wrapped in Option types
   // Always check isEmpty() before unwrapping
   if (!someOption.isEmpty()) {
     const value = someOption.unwrap();
     // Use value...
   }
   ```

See `src/recording-api-react-demo.tsx` (lines 197-239) for a complete example of these patterns in action.

**How RecordingWorklet Peaks Work:**

The `RecordingWorklet` (which implements `SampleLoader`) provides different peak types during vs after recording:

**During Recording:**
- `peaks: Option<PeaksWriter>` - Live waveform data updated in real-time
- `PeaksWriter` has:
  - `dataIndex: Int32Array` - Tracks how many peaks written per channel
  - `data: Int32Array[]` - Packed min/max peak values per channel
  - `unitsEachPeak()` - Returns 128 (number of frames per peak)
  - Use `dataIndex[0] * unitsEachPeak()` to get actual recorded frames

**After Recording:**
- `peaks: Option<Peaks>` - Final high-quality waveform data (calculated in worker)
- `data: Option<AudioData>` - Complete audio data
- `state: SampleLoaderState` - Changes to "loaded"
- `uuid: UUID.Bytes` - Same UUID used for AudioFileBox creation

**Observable State Flow:**
- `engine.isCountingIn` → Tracks count-in state
- `engine.countInBeatsRemaining` → Shows remaining beats (4, 3, 2, 1...)
- `engine.isRecording` → Automatically transitions from count-in to recording
- Status updates happen automatically via observable subscriptions

**Key Simplification Principles:**

This demo showcases how OpenDAW handles complexity internally so you don't have to:

1. **Arming a track** → Just set `capture.armed.setValue(true)` - microphone access handled automatically
2. **Starting recording** → Just call `project.startRecording(countIn)` - boxes created automatically
3. **Getting waveforms** → Just access `loader.peaks` - RecordingWorklet provides them

The pattern: **Set state via observables, OpenDAW handles the implementation details**. This is the recommended approach for working with OpenDAW's recording system.

### 3. Lifecycle Management Demo (`/lifecycle-react-demo.html`)

Demonstrates proper subscription lifecycle management in React with dynamic components:

- **React + TypeScript** - Modern component-based architecture
- **Dynamic Component Mounting** - Add/remove monitors on the fly
- **TransportDisplay Component** - Shows global playback state with automatic cleanup
- **TrackMonitor Components** - Per-track state monitoring with individual lifecycles
- **Solo/Mute Interaction** - Demonstrates DAW-style behavior (solo overrides mute)
- **Real-time State Sync** - Uses `catchupAndSubscribe()` to sync with existing state

**How It Works:**
- Calls `AnimationFrame.start(window)` to enable observable state sync
- Uses `catchupAndSubscribe()` instead of `subscribe()` to immediately sync with current state
- Each component manages its own subscriptions via `useEffect` hooks
- React cleanup functions automatically call `subscription.terminate()` on unmount
- Demonstrates the difference between `subscribe()` (future only) vs `catchupAndSubscribe()` (current + future)
- Solo button automatically unmutes tracks when clicked (professional DAW behavior)

**Key Patterns:**
```typescript
useEffect(() => {
    // Get current value immediately + future updates
    const sub = track.audioUnitBox.solo.catchupAndSubscribe((obs) => {
        setSoloed(obs.getValue())
    })

    // Cleanup automatically called on unmount
    return () => sub.terminate()
}, [track])
```

This demo is perfect for understanding how to integrate OpenDAW with React applications in production.

