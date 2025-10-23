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

## Demos

This project includes two demos showcasing different OpenDAW capabilities:

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
- The pause button calculates the current playback position using `audioContext.currentTime` and converts it to PPQN (Pulse Per Quarter Note)
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
- Uses `project.startRecording(countIn)` to prepare recording state
- Calls `engine.play()` to actually begin recording
- Uses `engine.stopRecording()` to finalize the recording
- Observable subscriptions track recording state changes in real-time

