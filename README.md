# openDAW Headless App

This is a template to run the openDAW SDK with the least possible number of dependencies.

## Create certificates to get https on localhost (one time only)

`mkcert localhost`

## Installation and Run

* `npm install`
* `npm run dev`

## Demos

This project includes multiple demos showcasing different OpenDAW capabilities:

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
- The pause button calculates the current playback position using `audioContext.currentTime` and converts it to PPQN (Pulse Per Quarter Note)
- When resuming from pause, it uses `engine.setPosition()` to restore the exact position before starting playback again
- All audio tracks are scheduled as `AudioRegionBox` instances with corresponding `AudioFileBox` references

### 2. Audio Recording Demo (`/recording-demo.html`)

Demonstrates real-time audio recording and playback using OpenDAW's RecordingWorklet:

- **OpenDAW RecordingWorklet** - Uses OpenDAW's AudioWorklet-based recording instead of MediaRecorder API
- **Microphone Input** - Captures audio from your microphone in real-time
- **Zero-Copy Audio Transfer** - Uses SharedArrayBuffer (RingBuffer) for efficient audio data transfer
- **Waveform Visualization** - Displays recorded audio waveform
- **Playback via Tape Track** - Plays back the recording through OpenDAW's engine

**How It Works:**
- Creates a `RecordingWorklet` via `audioWorklets.createRecording(numberOfChannels, numChunks, outputLatency)`
- Connects microphone input (`MediaStreamSource`) directly to the `RecordingWorklet`
- When recording stops, retrieves the `AudioData` from the worklet's `data` property
- Stores the `AudioData` in a custom sample manager
- Creates a tape track with `AudioFileBox` and `AudioRegionBox` to play back the recording
- All audio processing happens in the audio worklet thread for optimal performance

