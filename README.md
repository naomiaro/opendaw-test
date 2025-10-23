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

### 2. Recording API Demo (`/recording-api-demo.html`)

Demonstrates real-time audio recording and playback using OpenDAW's Recording API:

- **Project-based Recording** - Uses `project.startRecording()` and `engine.stopRecording()` APIs
- **Microphone Input** - Captures audio from your microphone in real-time
- **Tape Track Integration** - Creates and arms a tape instrument for recording
- **Observable State Tracking** - Monitors `isRecording`, `isPlaying`, and `position` observables
- **Three-Step Workflow:**
  - Arm Track - Creates a tape track and arms it for recording
  - Start Recording - Begins recording with playback
  - Stop Recording - Stops recording and enables playback

**How It Works:**
- Calls `AnimationFrame.start(window)` to enable observable state sync
- Creates a tape instrument using `InstrumentFactories.Tape`
- Arms the capture device associated with the tape track
- Uses `project.startRecording(countIn)` to start recording
- Uses `engine.stopRecording()` to finalize the recording
- Observable subscriptions track recording state changes in real-time

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

