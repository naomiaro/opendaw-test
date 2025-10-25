# openDAW Headless App

This is a template to run the openDAW SDK with the least possible number of dependencies.

## Create certificates to get https on localhost (one time only)

`mkcert localhost`

## Installation and Run

* `npm install`
* `npm run dev`

## Building for Production

To build the project for production:

```bash
npm run build
```

This creates a production build in the `dist/` directory. You can preview the build locally:

```bash
npm run preview
```

## Deployment

**⚠️ Important:** OpenDAW requires `SharedArrayBuffer`, which needs these HTTP headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

**GitHub Pages does not support custom HTTP headers**, so you must use one of these platforms instead:

### Recommended Free Hosting Platforms:

#### 1. **Cloudflare Pages** ⭐ (Recommended - Best Free Tier)
- 🆓 **Free**: Unlimited bandwidth, unlimited requests
- Configuration file included: `public/_headers`
- Headers automatically applied ✅

**Quick Setup:**
1. Go to https://pages.cloudflare.com/
2. Connect your GitHub repository
3. Set build command: `npm run build`
4. Set build output directory: `dist`
5. Deploy!

#### 2. **Netlify**
- 🆓 **Free**: 100 GB bandwidth/month, 300 build minutes/month
- Configuration file included: `public/_headers`
- Headers automatically applied ✅
- [Sign up free](https://www.netlify.com/)

#### 3. **Vercel**
- 🆓 **Free**: 100 GB bandwidth/month, unlimited sites
- Configuration file included: `vercel.json`
- Headers automatically applied ✅
- [Sign up free](https://vercel.com/)

All required configuration files are included in this project, so deployment is as simple as connecting your GitHub repository to any of these platforms!

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

### 1. Multi-track Playback Demo (`/playback-demo-react.html`)

Demonstrates simultaneous playback of multiple audio tracks with automatic waveform visualization:

- **4 Tape Tracks** - Bass & Drums, Guitar, Piano & Synth, and Vocals all playing simultaneously
- **Automatic Waveform Rendering** - Displays waveforms for all loaded tracks using OpenDAW's peak generation
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
- Waveforms are automatically generated by OpenDAW's peak generation system and rendered using `PeaksPainter.renderBlocks()`

### 2. Recording API Demo (`/recording-api-react-demo.html`)

Demonstrates real-time audio recording with waveform visualization using OpenDAW's Recording API:

- **Automatic Microphone Access** - CaptureAudio handles microphone permissions automatically
- **Live Waveform Visualization** - Renders growing waveform in real-time as you record
- **Project Settings** - Configure BPM and time signature (affects metronome/click track)
- **Count-in Support** - Optional metronome count-in before recording starts
- **Observable State Tracking** - Real-time status updates via `isRecording`, `isCountingIn` observables
- **Three-Step Workflow:**
  - **Configure** - Set BPM and time signature for the project
  - **Arm Track** - Creates tape instrument and arms capture device (mic access handled automatically)
  - **Start Recording** - Begins recording with optional count-in at your chosen tempo/meter
  - **Stop Recording** - Saves recording, creates audio regions, and displays final waveform

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

// 2. Use AnimationFrame to detect when AudioRegionBox is created
// AnimationFrame syncs with OpenDAW's engine update cycle
const checkForRegion = () => {
  // Access regions via pointerHub.incoming()
  const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);

  if (regions.length > 0) {
    const latestRegion = regions[regions.length - 1];

    // Check if the file pointer is set
    if (latestRegion.file.isEmpty()) {
      return; // Will check again on next animation frame
    }

    // Get the recording UUID - targetAddress is an Option type, so unwrap it
    const targetAddressOption = latestRegion.file.targetAddress;

    if (targetAddressOption.isEmpty()) {
      return; // Will check again on next animation frame
    }

    const targetAddress = targetAddressOption.unwrap();
    const recordingUUID = targetAddress.uuid;

    // Terminate region checking now that we found what we need
    regionCheckTerminable.terminate();

    // 3. Get the RecordingWorklet from sample manager
    const recordingWorklet = project.sampleManager.getOrCreate(recordingUUID);

    // 4. Monitor live peaks during recording using AnimationFrame
    // Note: This is different from waiting for loaded peaks - here we need
    // continuous updates synced with OpenDAW's animation frame cycle
    const monitorLivePeaks = () => {
      const peaksOption = recordingWorklet.peaks;

      if (peaksOption && !peaksOption.isEmpty()) {
        const peaks = peaksOption.unwrap(); // Returns PeaksWriter during recording
        const rendered = updatePeaks(peaks); // CanvasPainter renders efficiently

        // Detect if it's PeaksWriter (during recording) vs final Peaks (after recording)
        const isPeaksWriter = "dataIndex" in peaks;

        // If we got final Peaks (not PeaksWriter), stop monitoring
        if (!isPeaksWriter && rendered) {
          livePeaksTerminable.terminate(); // Stop monitoring
        }
      }
    };

    livePeaksTerminable = AnimationFrame.add(monitorLivePeaks);
  }
};

const regionCheckTerminable = AnimationFrame.add(checkForRegion);
```

**Important Box Graph Patterns:**

When working with OpenDAW's box graph, you need to understand how to access related boxes:

1. **Modifying Box Graph Values (CRITICAL):**
   ```typescript
   // WRONG: Direct modification will throw "Modification only prohibited in transaction mode"
   project.timelineBox.bpm.setValue(120);

   // RIGHT: All box graph modifications must be wrapped in a transaction
   project.editing.modify(() => {
     project.timelineBox.bpm.setValue(120);
   });
   ```

2. **Accessing Child Boxes via PointerHub:**
   ```typescript
   // WRONG: trackBox.regions.children - this doesn't exist!
   // RIGHT: Use pointerHub.incoming() to get boxes pointing to this field
   const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);
   ```

3. **Accessing Pointer Fields:**
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

4. **Working with Option Types:**
   ```typescript
   // Many values in OpenDAW are wrapped in Option types
   // Always check isEmpty() before unwrapping
   if (!someOption.isEmpty()) {
     const value = someOption.unwrap();
     // Use value...
   }
   ```

5. **Setting BPM and Time Signature:**
   ```typescript
   // Set BPM (affects metronome and count-in)
   project.editing.modify(() => {
     project.timelineBox.bpm.setValue(120);
   });

   // Set time signature
   project.editing.modify(() => {
     project.timelineBox.signature.numerator.setValue(4);
     project.timelineBox.signature.denominator.setValue(4);
   });
   ```

See `src/recording-api-react-demo.tsx` for complete examples of these patterns in action.

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

## Waveform Rendering: Accessing Peaks for Loaded Audio

OpenDAW automatically generates peaks (waveform data) for **all** audio samples loaded into the sample manager, not just recordings. This means you can render waveforms for any loaded audio file using the same `PeaksPainter` pattern.

### How Peak Generation Works

When you load audio samples via the sample manager:
1. The `DefaultSampleLoader` automatically generates peaks in a worker thread using `SamplePeakProtocol`
2. Peaks are computed asynchronously and become available via the `peaks` property
3. The same `Peaks` data structure is used for both loaded samples and recordings

### Accessing Peaks for Loaded Audio Files

There are two ways to access peaks for loaded audio:

**Method 1: Via SampleLoader (Direct UUID Access)**
```typescript
// Get the sample loader using the AudioFileBox UUID
const uuid = UUID.fromString(audioFileUUID);
const sampleLoader = project.sampleManager.getOrCreate(uuid);

// Access peaks (returns Option<Peaks>)
const peaksOption = sampleLoader.peaks;

if (!peaksOption.isEmpty()) {
  const peaks = peaksOption.unwrap();
  // Render waveform using PeaksPainter...
}
```

**Method 2: Via AudioFileBoxAdapter**
```typescript
// If you have an AudioFileBox instance, you can get its adapter
const audioFileBoxAdapter = ...; // Get adapter from box
const peaksOption = audioFileBoxAdapter.peaks; // Direct peaks access

// Or get the loader from the adapter
const sampleLoader = audioFileBoxAdapter.getOrCreateLoader();
const peaksOption = sampleLoader.peaks;
```

### Rendering Waveforms with CanvasPainter

The recommended approach is to use the **CanvasPainter pattern** for efficient, optimized rendering:

```typescript
import { PeaksPainter } from "@opendaw/lib-fusion";
import { AnimationFrame } from "@opendaw/lib-dom";

// CanvasPainter manages AnimationFrame scheduling, resize handling, and HiDPI scaling
class CanvasPainter {
  private needsUpdate = true;
  private animationFrameTerminable: any;

  constructor(
    private canvas: HTMLCanvasElement,
    private render: (context: CanvasRenderingContext2D) => void
  ) {
    // AnimationFrame integration - syncs with OpenDAW's engine updates
    this.animationFrameTerminable = AnimationFrame.add(() => this.update());
  }

  requestUpdate(): void {
    this.needsUpdate = true; // Debounced - renders once per frame
  }

  private update(): void {
    if (!this.needsUpdate) return;
    this.needsUpdate = false;

    const context = this.canvas.getContext("2d");
    if (context) {
      this.render(context); // Call user's render function
    }
  }

  terminate(): void {
    this.animationFrameTerminable?.terminate();
  }
}

// Usage: Create painter with rendering callback
const currentPeaksRef = { current: null };

const painter = new CanvasPainter(canvas, (context) => {
  const peaks = currentPeaksRef.current;
  if (!peaks) return;

  // Clear canvas
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  // Set waveform color
  context.fillStyle = "#4a9eff";

  // Channel padding (4px matches OpenDAW pattern)
  const CHANNEL_PADDING = 4;
  const channelHeight = canvas.clientHeight / peaks.numChannels;

  // Render each channel with padding
  for (let channel = 0; channel < peaks.numChannels; channel++) {
    const y0 = channel * channelHeight + CHANNEL_PADDING / 2;
    const y1 = (channel + 1) * channelHeight - CHANNEL_PADDING / 2;

    PeaksPainter.renderBlocks(context, peaks, channel, {
      x0: 0,
      x1: canvas.clientWidth,
      y0,
      y1,
      u0: 0,
      u1: peaks.numFrames,
      v0: -1,
      v1: 1
    });
  }
});

// Update peaks and request render
const updatePeaks = (peaks) => {
  currentPeaksRef.current = peaks;
  painter.requestUpdate(); // Efficient - debounced to one render per frame
};

// Clean up
painter.terminate();
```

**Benefits of CanvasPainter:**
- ✅ **Efficient rendering**: AnimationFrame integration syncs with OpenDAW's engine
- ✅ **Automatic debouncing**: Multiple `requestUpdate()` calls batch to single render
- ✅ **HiDPI support**: Handles devicePixelRatio for sharp displays
- ✅ **Clean lifecycle**: Terminable pattern for proper cleanup

### Waiting for Peaks to be Generated

Since peaks are generated asynchronously, the best approach is to **subscribe to the sample loader's state changes**:

```typescript
const sampleLoader = project.sampleManager.getOrCreate(audioFileUUID);

// Subscribe to state changes - callback receives state directly
const subscription = sampleLoader.subscribe(state => {
  // When state becomes "loaded", peaks are ready
  if (state.type === "loaded") {
    const peaksOption = sampleLoader.peaks;

    if (!peaksOption.isEmpty()) {
      const peaks = peaksOption.unwrap();
      updatePeaks(peaks); // CanvasPainter efficiently renders on next frame
    }
  }
});

// Clean up when done
subscription.terminate();
```

**SampleLoaderState Types:**
- `"idle"` - Initial state
- `"progress"` - Loading in progress (has `progress: number` field)
- `"loaded"` - Sample and peaks are ready ✅
- `"record"` - Currently recording
- `"error"` - Loading failed (has `reason: string` field)

**React Pattern:**
```typescript
useEffect(() => {
  if (!project || tracks.length === 0) return;

  const subscriptions: Array<{ terminate: () => void }> = [];
  let renderedCount = 0;

  tracks.forEach(track => {
    const canvas = canvasRefs.current.get(track.uuid);
    if (!canvas) return;

    const sampleLoader = project.sampleManager.getOrCreate(track.uuid);

    // Subscribe to state changes
    const subscription = sampleLoader.subscribe(state => {
      // When state becomes "loaded", peaks are ready
      if (state.type === "loaded") {
        const peaksOption = sampleLoader.peaks;

        if (!peaksOption.isEmpty()) {
          const peaks = peaksOption.unwrap();
          renderWaveform(canvas, peaks);
          renderedCount++;

          if (renderedCount === tracks.length) {
            setPeaksReady(true);
          }
        }
      }
    });

    subscriptions.push(subscription);
  });

  return () => {
    // Clean up all subscriptions
    subscriptions.forEach(sub => sub.terminate());
  };
}, [project, tracks]);
```

### Key Differences: PeaksWriter vs Peaks

When accessing peaks, you may encounter two types:

**During Recording: `PeaksWriter`**
- Live waveform data updated in real-time
- Has `dataIndex: Int32Array` tracking written peaks
- Use `dataIndex[0] * unitsEachPeak()` to get actual frames
- Detect with: `const isPeaksWriter = "dataIndex" in peaks;`

**After Loading/Recording: `Peaks`**
- Final high-quality waveform data
- Has `numFrames: number` property
- Ready to render immediately
- Used for all loaded samples

### Complete Example

See `src/playback-demo-react.tsx` for a complete example showing:
- Loading multiple audio files
- Storing track UUIDs for peak access
- Subscribing to sample loader state changes
- Rendering waveforms for all tracks
- React integration with proper cleanup

The pattern is identical whether you're rendering waveforms for:
- ✅ Loaded audio files (MP3, WAV, etc.)
- ✅ Live recordings (during recording)
- ✅ Completed recordings (after recording stops)

**The key insight:** All samples in OpenDAW's sample manager automatically get peaks generated, making waveform rendering consistent across all audio sources.

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

