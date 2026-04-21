# Building a Complete App

> **Skip if:** you want a specific feature guide, not a full walkthrough
> **Prerequisites:** Chapters 01-06

## Table of Contents

- [Complete DAW Application Architecture](#complete-daw-application-architecture)
- [Step-by-Step Implementation](#step-by-step-implementation)
  - [Step 1: Project Initialization](#step-1-project-initialization)
  - [Step 2: Main App Component](#step-2-main-app-component)
  - [Step 3: Timeline Component](#step-3-timeline-component)
  - [Step 4: Transport Component](#step-4-transport-component)
- [Key Concepts Applied](#key-concepts-applied)
- [Testing the Application](#testing-the-application)
- [Common Issues and Solutions](#common-issues-and-solutions)
- [Next Steps](#next-steps)
- [Advanced: Mixer Groups (Sub-Mixing)](#advanced-mixer-groups-sub-mixing)
  - [Architecture](#architecture)
  - [Creating Group Buses](#creating-group-buses)
  - [Routing Tracks to Groups](#routing-tracks-to-groups)
  - [Complete Example](#complete-example)
  - [Solo Behavior](#solo-behavior)
  - [Subscribing to Group State](#subscribing-to-group-state)
  - [Master Output Access](#master-output-access)
  - [Groups vs Aux Units](#groups-vs-aux-units)

---

This document combines all the concepts (PPQN, Box System, Sample Management, Timeline Rendering) into a complete working example.

## Complete DAW Application Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Your Application                        │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐             │
│  │ Timeline        │  │ Transport        │             │
│  │ - Grid lines    │  │ - Play/Stop      │             │
│  │ - Clips (PPQN)  │  │ - BPM control    │             │
│  │ - Playhead      │  │ - Position       │             │
│  └─────────────────┘  └──────────────────┘             │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────┐             │
│  │ Track List      │  │ Waveform Display │             │
│  │ - Volume/Pan    │  │ - Peaks rendering│             │
│  │ - Mute/Solo     │  │ - Canvas painter │             │
│  └─────────────────┘  └──────────────────┘             │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  OpenDAW Engine                          │
│  - Project (Box Graph)                                   │
│  - Sample Manager (Audio Loading + Peaks)               │
│  - Engine (Playback, PPQN Timing)                       │
└─────────────────────────────────────────────────────────┘
```

## Step-by-Step Implementation

### Step 1: Project Initialization

```typescript
// src/lib/projectSetup.ts
import { AnimationFrame } from "@opendaw/lib-dom";
import { AudioWorklets, GlobalSampleLoaderManager, Project, Workers, SampleProvider, SampleService } from "@opendaw/studio-core";
import { PPQN, AudioData } from "@opendaw/lib-dsp";
import { UUID, Progress } from "@opendaw/lib-std";

// Helper to convert browser AudioBuffer to OpenDAW's AudioData format
function audioBufferToAudioData(audioBuffer: AudioBuffer): AudioData {
  const { numberOfChannels, length: numberOfFrames, sampleRate } = audioBuffer;
  const audioData = AudioData.create(sampleRate, numberOfFrames, numberOfChannels);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    audioData.frames[channel].set(audioBuffer.getChannelData(channel));
  }
  return audioData;
}

export async function initializeOpenDAW(localAudioBuffers: Map<string, AudioBuffer>) {
  // Start AnimationFrame loop (required for observables)
  AnimationFrame.start(window);

  // Install workers and worklets
  await Workers.install("/workers-main.js");
  AudioWorklets.install("/processors.js");

  // Create AudioContext
  const audioContext = new AudioContext({ latencyHint: 0 });

  // Configure sample manager (API changed in 0.0.87)
  const sampleProvider: SampleProvider = {
    fetch: async (uuid: UUID.Bytes, progress: Progress.Handler) => {
      const uuidString = UUID.toString(uuid);
      const audioBuffer = localAudioBuffers.get(uuidString);

      if (audioBuffer) {
        const audioData = audioBufferToAudioData(audioBuffer);
        const metadata = {
          name: uuidString,
          bpm: 120,
          duration: audioBuffer.duration,
          sample_rate: audioBuffer.sampleRate,
          origin: "import"
        };
        return [audioData, metadata];
      }

      throw new Error(`Audio buffer not found: ${uuidString}`);
    }
  };
  const sampleManager = new GlobalSampleLoaderManager(sampleProvider);

  // Create worklets
  await AudioWorklets.createFor(audioContext);

  // Create services (0.0.124+)
  const sampleService = new SampleService(audioContext);
  // SoundfontService skipped — constructor fetches from api.opendaw.studio (CORS issues).
  // SDK declares soundfontService in ProjectEnv but never reads it (verified in 0.0.128).

  // Create project (soundfontManager/soundfontService omitted — not used in headless demos)
  const project = Project.new({
    audioContext,
    sampleManager,
    soundfontManager: undefined as any,
    audioWorklets: AudioWorklets.get(audioContext),
    sampleService,
    soundfontService: undefined as any,
  });

  // Start audio engine
  project.startAudioWorklet();
  await project.engine.isReady();

  return { project, audioContext };
}
```

### Step 2: Main App Component

```typescript
// src/App.tsx
import React, { useEffect, useState, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadAudioFile } from "./lib/audioUtils";
import { Timeline } from "./components/Timeline";
import { Transport } from "./components/Transport";
import { TrackList } from "./components/TrackList";

const { Quarter } = PPQN;

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [clips, setClips] = useState<Clip[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);

  const localAudioBuffersRef = useRef(new Map<string, AudioBuffer>());

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      // Initialize OpenDAW
      const { project: newProject, audioContext: newAudioContext } =
        await initializeOpenDAW(localAudioBuffersRef.current);

      if (!mounted) return;

      // Load audio files
      const audioFiles = [
        { name: "Kick", url: "/audio/kick.wav", color: "#ef4444" },
        { name: "Snare", url: "/audio/snare.wav", color: "#f59e0b" },
        { name: "Hi-Hat", url: "/audio/hihat.wav", color: "#10b981" }
      ];

      const audioBuffers = await Promise.all(
        audioFiles.map(file => loadAudioFile(newAudioContext, file.url))
      );

      if (!mounted) return;

      // Create tracks and clips
      const { editing, api, boxGraph } = newProject;
      const createdClips: Clip[] = [];
      const createdTracks: Track[] = [];

      editing.modify(() => {
        audioFiles.forEach((file, index) => {
          // Create track
          const { audioUnitBox, trackBox } = api.createInstrument(
            InstrumentFactories.Tape
          );

          audioUnitBox.volume.setValue(0);
          trackBox.label.setValue(file.name);

          createdTracks.push({
            name: file.name,
            uuid: trackBox.address.uuid,
            color: file.color
          });

          // Create AudioFileBox
          const fileUUID = UUID.generate();
          const audioBuffer = audioBuffers[index];

          localAudioBuffersRef.current.set(
            UUID.toString(fileUUID),
            audioBuffer
          );

          const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
            box.fileName.setValue(file.name);
            box.endInSeconds.setValue(audioBuffer.duration);
          });

          // Create clips based on pattern
          const positions = getPatternPositions(file.name);

          positions.forEach(position => {
            const clipDuration = Math.round(PPQN.secondsToPulses(
              audioBuffer.duration,
              120
            ));

            // Create events collection (required in 0.0.87+)
            const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

            const regionBox = AudioRegionBox.create(
              boxGraph,
              UUID.generate(),
              box => {
                box.regions.refer(trackBox.regions);
                box.file.refer(audioFileBox);
                box.events.refer(eventsCollectionBox.owners); // Required in 0.0.87+
                box.position.setValue(position);
                box.duration.setValue(clipDuration);
                box.loopOffset.setValue(0);
                box.loopDuration.setValue(clipDuration);
                box.label.setValue(file.name);
                box.mute.setValue(false);
              }
            );

            createdClips.push({
              trackName: file.name,
              position,
              duration: clipDuration,
              audioDuration: audioBuffer.duration,
              color: file.color,
              regionBox
            });
          });
        });
      });

      setClips(createdClips);
      setTracks(createdTracks);
      setProject(newProject);
      setAudioContext(newAudioContext);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to engine state
  useEffect(() => {
    if (!project) return;

    const playingSub = project.engine.isPlaying.catchupAndSubscribe(obs => {
      setIsPlaying(obs.getValue());
    });

    const positionSub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });

    const bpmSub = project.timelineBox.bpm.catchupAndSubscribe(field => {
      setBpm(field.getValue());
    });

    return () => {
      playingSub.terminate();
      positionSub.terminate();
      bpmSub.terminate();
    };
  }, [project]);

  // Helper function for pattern positions
  function getPatternPositions(instrumentName: string): number[] {
    const BARS = 4;

    switch (instrumentName) {
      case "Kick":
        // Beats 1 and 3 of each bar
        return Array.from(
          { length: BARS * 2 },
          (_, i) => i * Quarter * 2
        );

      case "Snare":
        // Beats 2 and 4 of each bar
        return Array.from(
          { length: BARS * 2 },
          (_, i) => Quarter + i * Quarter * 2
        );

      case "Hi-Hat":
        // Every eighth note
        return Array.from(
          { length: BARS * 4 * 2 },
          (_, i) => i * (Quarter / 2)
        );

      default:
        return [];
    }
  }

  // Transport handlers
  const handlePlay = async () => {
    if (!project || !audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    project.engine.play();
  };

  const handleStop = () => {
    if (!project) return;
    project.engine.stop(true); // also resets position to 0
  };

  const handleBpmChange = (newBpm: number) => {
    if (!project) return;

    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(newBpm);

      // Recalculate clip durations
      clips.forEach(clip => {
        const newDuration = Math.round(PPQN.secondsToPulses(
          clip.audioDuration,
          newBpm
        ));
        clip.regionBox.duration.setValue(newDuration);
        clip.regionBox.loopDuration.setValue(newDuration);
      });
    });

    // Update UI
    const updatedClips = clips.map(clip => ({
      ...clip,
      duration: Math.round(PPQN.secondsToPulses(clip.audioDuration, newBpm))
    }));
    setClips(updatedClips);
  };

  if (!project) {
    return <div>Loading...</div>;
  }

  return (
    <div className="app">
      <h1>My DAW</h1>

      <Timeline
        clips={clips}
        tracks={tracks.map(t => t.name)}
        currentPosition={currentPosition}
        isPlaying={isPlaying}
      />

      <Transport
        isPlaying={isPlaying}
        bpm={bpm}
        onPlay={handlePlay}
        onStop={handleStop}
        onBpmChange={handleBpmChange}
      />

      <TrackList
        tracks={tracks}
        project={project}
      />
    </div>
  );
}

export default App;
```

### Step 3: Timeline Component

```typescript
// src/components/Timeline.tsx
import React from "react";
import { PPQN } from "@opendaw/lib-dsp";

const { Quarter } = PPQN;

interface TimelineProps {
  clips: Clip[];
  tracks: string[];
  currentPosition: number;
  isPlaying: boolean;
}

export function Timeline({ clips, tracks, currentPosition, isPlaying }: TimelineProps) {
  const BARS = 4;
  const BEATS_PER_BAR = 4;
  const TOTAL_BEATS = BARS * BEATS_PER_BAR;
  const totalDuration = BARS * BEATS_PER_BAR * Quarter;
  const timelineWidth = 800;
  const trackHeight = 90;

  return (
    <div style={{ position: "relative", width: timelineWidth, margin: "20px auto" }}>
      <svg
        width={timelineWidth}
        height={tracks.length * trackHeight}
        style={{ background: "#1a1a1a", borderRadius: "8px" }}
      >
        {/* SVG Filter for glow effect */}
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {Array.from({ length: TOTAL_BEATS + 1 }, (_, beat) => {
          const x = (beat * Quarter / totalDuration) * timelineWidth;
          const isMeasure = beat % BEATS_PER_BAR === 0;

          return (
            <line
              key={`grid-${beat}`}
              x1={x}
              y1={0}
              x2={x}
              y2={tracks.length * trackHeight}
              stroke={isMeasure ? "#555" : "#333"}
              strokeWidth={isMeasure ? 2 : 1}
            />
          );
        })}

        {/* Track separators */}
        {tracks.map((_, i) => (
          <line
            key={`track-${i}`}
            x1={0}
            y1={(i + 1) * trackHeight}
            x2={timelineWidth}
            y2={(i + 1) * trackHeight}
            stroke="#333"
            strokeWidth={1}
          />
        ))}

        {/* Track labels */}
        {tracks.map((track, i) => {
          const trackClip = clips.find(c => c.trackName === track);
          const color = trackClip?.color || "#888";

          return (
            <g key={`label-${i}`}>
              <rect
                x={0}
                y={i * trackHeight}
                width={100}
                height={20}
                fill="#000"
                opacity={0.7}
              />
              <text
                x={8}
                y={i * trackHeight + 14}
                fill={color}
                fontSize="14"
                fontWeight="bold"
              >
                {track}
              </text>
            </g>
          );
        })}

        {/* Clips */}
        {clips.map((clip, i) => {
          const trackIndex = tracks.indexOf(clip.trackName);
          const x = (clip.position / totalDuration) * timelineWidth;
          const width = Math.max(4, (clip.duration / totalDuration) * timelineWidth);
          const y = trackIndex * trackHeight + 25;
          const height = trackHeight - 30;

          // Check if playhead is inside this clip
          const isActive = isPlaying &&
            currentPosition >= clip.position &&
            currentPosition < clip.position + clip.duration;

          return (
            <g key={`clip-${i}`}>
              {/* Glow when active */}
              {isActive && (
                <rect
                  x={x - 2}
                  y={y - 2}
                  width={width + 4}
                  height={height + 4}
                  fill={clip.color}
                  rx={5}
                  opacity={0.4}
                  filter="url(#glow)"
                />
              )}

              {/* Main clip */}
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={clip.color}
                rx={3}
                opacity={isActive ? 1.0 : 0.8}
              />
            </g>
          );
        })}

        {/* Playhead */}
        {isPlaying && (
          <line
            x1={(currentPosition / totalDuration) * timelineWidth}
            y1={0}
            x2={(currentPosition / totalDuration) * timelineWidth}
            y2={tracks.length * trackHeight}
            stroke="#fff"
            strokeWidth={2}
          />
        )}
      </svg>

      {/* Bar labels */}
      <div style={{ position: "relative", marginTop: 8, height: 32 }}>
        {Array.from({ length: BARS }, (_, barIndex) => {
          const x = (barIndex * BEATS_PER_BAR * Quarter / totalDuration) * timelineWidth;
          const width = (BEATS_PER_BAR * Quarter / totalDuration) * timelineWidth;
          const isOdd = barIndex % 2 === 0;

          return (
            <div
              key={barIndex}
              style={{
                position: "absolute",
                left: x,
                width,
                height: "100%",
                backgroundColor: isOdd ? "#2a2a2a" : "#333",
                display: "flex",
                alignItems: "center",
                paddingLeft: 8,
                borderLeft: "2px solid #555"
              }}
            >
              <span style={{ color: "#fff", fontWeight: "bold", fontSize: 12 }}>
                Bar {barIndex + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Step 4: Transport Component

```typescript
// src/components/Transport.tsx
import React from "react";

interface TransportProps {
  isPlaying: boolean;
  bpm: number;
  onPlay: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
}

export function Transport({ isPlaying, bpm, onPlay, onStop, onBpmChange }: TransportProps) {
  return (
    <div style={{ padding: 20, background: "#2a2a2a", borderRadius: 8, margin: "20px auto", maxWidth: 800 }}>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        {/* Play/Stop buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onPlay}
            disabled={isPlaying}
            style={{
              padding: "10px 20px",
              background: isPlaying ? "#666" : "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: isPlaying ? "not-allowed" : "pointer"
            }}
          >
            ▶ Play
          </button>

          <button
            onClick={onStop}
            disabled={!isPlaying}
            style={{
              padding: "10px 20px",
              background: !isPlaying ? "#666" : "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: !isPlaying ? "not-allowed" : "pointer"
            }}
          >
            ■ Stop
          </button>
        </div>

        {/* BPM control */}
        <div style={{ flex: 1 }}>
          <label style={{ color: "#fff", display: "block", marginBottom: 8 }}>
            Tempo: {bpm} BPM
          </label>
          <input
            type="range"
            min="60"
            max="180"
            value={bpm}
            onChange={(e) => onBpmChange(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}
```

## Key Concepts Applied

### 1. PPQN for Positioning

```typescript
// Clip positions are musical (never change)
const kickPosition = 0 * Quarter;        // Beat 1
const snarePosition = 1 * Quarter;       // Beat 2

// Clip durations are temporal (recalculate on BPM change)
const duration = Math.round(PPQN.secondsToPulses(audioDuration, bpm));
```

### 2. Box System for Data

```typescript
// All changes in transactions
project.editing.modify(() => {
  trackBox.label.setValue("Drums");
  audioUnitBox.volume.setValue(-3);
});

// Subscribe to changes
project.timelineBox.bpm.subscribe(field => {
  setBpm(field.getValue());
});
```

### 3. Sample Manager for Audio

```typescript
// Configure sample manager with local buffers (API changed in 0.0.87)
const sampleProvider: SampleProvider = {
  fetch: async (uuid, progress) => {
    const audioBuffer = localBuffers.get(UUID.toString(uuid));
    const audioData = audioBufferToAudioData(audioBuffer);
    return [audioData, metadata];
  }
};
const sampleManager = new GlobalSampleLoaderManager(sampleProvider);

// Subscribe to peaks
sampleLoader.subscribe(state => {
  if (state.type === "loaded") {
    const peaks = sampleLoader.peaks.unwrap();
    // Render waveform
  }
});
```

### 4. Timeline Rendering

```typescript
// Convert PPQN to pixels
const x = (clip.position / totalDuration) * timelineWidth;
const width = (clip.duration / totalDuration) * timelineWidth;

// Render SVG
<rect x={x} y={y} width={width} height={height} fill={color} />
```

## Testing the Application

1. **Start dev server**: `npm run dev`
2. **Click Play** - Audio should play, playhead moves
3. **Adjust BPM** - Tempo changes, clips resize
4. **Watch clips light up** - Active clips glow when playing

## Common Issues and Solutions

### Issue: No audio plays
```typescript
// Solution: Resume AudioContext
if (audioContext.state === "suspended") {
  await audioContext.resume();
}
```

### Issue: Clips don't update when BPM changes
```typescript
// Solution: Recalculate durations and update state
const updatedClips = clips.map(clip => ({
  ...clip,
  duration: Math.round(PPQN.secondsToPulses(clip.audioDuration, newBpm))
}));
setClips(updatedClips);
```

### Issue: Playhead stutters
```typescript
// Solution: Use AnimationFrame throttling
const sub = AnimationFrame.add(() => {
  setCurrentPosition(project.engine.position.getValue());
});
```

## Next Steps

### Enhancements to Add

1. **Waveform Display** - Add canvas rendering with peaks
2. **Click to Seek** - Click timeline to jump to position
3. **Drag Clips** - Move clips to different positions
4. **Track Volume/Pan** - Add mixer controls
5. **Recording** - Add microphone input and recording
6. **Effects** - Add reverb, delay, EQ
7. **MIDI Support** - Add virtual instruments

### Production Considerations

1. **Cross-Origin Isolation** - Required for SharedArrayBuffer
2. **Error Handling** - Catch audio loading failures
3. **Loading States** - Show progress during initialization
4. **Responsive Design** - Adapt to different screen sizes
5. **Keyboard Shortcuts** - Space to play/pause, etc.
6. **Project Save/Load** - Serialize and deserialize projects

---

## Advanced: Mixer Groups (Sub-Mixing)

> **Skip if:** you don't need sub-mixing or track routing yet

OpenDAW supports **group buses** (also called sub-groups or submixes) — intermediate mixing stages where multiple tracks are summed together before reaching the master output. This is a standard DAW mixing pattern for controlling related tracks as a unit.

**Signal flow:** Track → Group Bus → Master Output

For example, routing Drums and Bass to a "Rhythm" group lets you mute, solo, or adjust the volume of the entire rhythm section with a single control.

### Architecture

#### Audio Routing Graph

```
┌──────────┐     ┌──────────────────┐     ┌──────────────┐
│  Drums   │────▸│                  │     │              │
│ AudioUnit│     │  Rhythm Group    │────▸│              │
│  Box     │     │  AudioBusBox     │     │    Master    │
├──────────┤     │  + AudioUnitBox  │     │  AudioBus    │
│  Bass    │────▸│                  │     │  + AudioUnit │
│ AudioUnit│     └──────────────────┘     │              │
│  Box     │                              │              │
├──────────┤     ┌──────────────────┐     │              │
│  Vocals  │────▸│                  │────▸│              │
│ AudioUnit│     │  Melodic Group   │     │              │
│  Box     │     │  AudioBusBox     │     └──────────────┘
├──────────┤     │  + AudioUnitBox  │
│  Guitar  │────▸│                  │
│ AudioUnit│     └──────────────────┘
│  Box     │
└──────────┘
```

#### Box Structure per Group

Each group bus consists of two connected boxes:

| Box | Purpose |
|-----|---------|
| **AudioBusBox** | Receives and sums multiple input signals. Has `input` (pointer hub) and `output` (pointer field). |
| **AudioUnitBox** | Applies channel strip processing (volume, panning, mute, solo). Connected to the AudioBusBox's output. Routes to master by default. |

`AudioBusFactory.create()` creates both boxes and wires them together in a single call.

#### Default Routing

When a track is created via `project.api.createInstrument()`, its `AudioUnitBox.output` is automatically connected to the master bus's input. To route through a group instead, you re-assign this output pointer to the group's `AudioBusBox.input`.

### Creating Group Buses

#### AudioBusFactory API

```typescript
import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";

// Create the bus in its own transaction
project.editing.modify(() => {
  const audioBusBox = AudioBusFactory.create(
    project.skeleton,       // { boxGraph, mandatoryBoxes }
    "Rhythm",               // display name
    IconSymbol.AudioBus,    // icon enum
    AudioUnitType.Bus,      // type discriminator
    Colors.blue             // color from @opendaw/studio-enums
  );
});
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `skeleton` | `ProjectSkeleton` | Access via `project.skeleton`. Provides `boxGraph` and `mandatoryBoxes` (rootBox, primaryAudioBus, etc.) |
| `name` | `string` | Display label for the group |
| `icon` | `IconSymbol` | Icon enum (e.g., `IconSymbol.AudioBus`, `IconSymbol.Mix`) |
| `type` | `AudioUnitType` | `AudioUnitType.Bus` for groups, `AudioUnitType.Aux` for auxiliary sends |
| `color` | `Color` | Pre-defined colors from `Colors` (blue, purple, green, red, orange, etc.) |

**Returns:** `AudioBusBox` — the bus box. The paired `AudioUnitBox` is accessible via pointer traversal (see below).

#### Accessing the Group's AudioUnitBox

The `AudioBusBox.output` pointer connects to the `AudioUnitBox.input`. Traverse it to get the AudioUnitBox for volume/mute/solo control:

```typescript
// IMPORTANT: Do this AFTER the creation transaction commits.
// targetVertex traversal within the same transaction may return stale data.
const audioUnitBox = audioBusBox.output.targetVertex
  .unwrap("No AudioUnitBox found").box as AudioUnitBox;
```

The AudioUnitBox provides the same mixer controls as instrument tracks:

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `.volume` | float | -inf to +12 dB | Group volume |
| `.mute` | boolean | — | Mutes all audio through the group |
| `.solo` | boolean | — | Solos the group (virtual solo propagates to child tracks) |
| `.panning` | float | -1.0 to 1.0 | Stereo panning |

### Routing Tracks to Groups

#### Critical: Use Separate Transactions

`createInstrument()` internally routes `audioUnitBox.output` to the master bus. Re-routing with `output.refer()` **in the same `editing.modify()` transaction** may not properly disconnect the old connection, causing **dual routing** — audio reaches master both directly and through the group.

Always re-route in a separate transaction:

```typescript
// Step 1: Create the track (routes to master by default)
let trackAudioUnitBox: AudioUnitBox;

project.editing.modify(() => {
  const { audioUnitBox, trackBox } = project.api.createInstrument(
    InstrumentFactories.Tape
  );
  trackAudioUnitBox = audioUnitBox;
  // ... create AudioFileBox, AudioRegionBox, etc.
});

// Step 2: Re-route to group in a SEPARATE transaction
project.editing.modify(() => {
  trackAudioUnitBox.output.refer(groupBusBox.input);
});
```

#### Why Separate Transactions?

OpenDAW's box graph defers pointer hub notifications within a single `editing.modify()` transaction. When `createInstrument()` connects the track to master, the pointer hub on the master bus records the incoming connection. If you immediately call `output.refer(newTarget)` in the same transaction, the hub notification to remove the old connection may not fire until after the transaction commits — leaving both connections active.

This is analogous to the documented [SignatureTrack one-transaction-per-event](./02-timing-and-tempo.md#critical-one-transaction-per-event) requirement, which is caused by the same deferred notification mechanism.

### Complete Example

```typescript
import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";
import { AudioUnitBox } from "@opendaw/studio-boxes";

// 1. Create group buses
const busBoxes = new Map<string, AudioBusBox>();

project.editing.modify(() => {
  busBoxes.set("Rhythm", AudioBusFactory.create(
    project.skeleton, "Rhythm", IconSymbol.AudioBus,
    AudioUnitType.Bus, Colors.blue
  ));
  busBoxes.set("Melodic", AudioBusFactory.create(
    project.skeleton, "Melodic", IconSymbol.AudioBus,
    AudioUnitType.Bus, Colors.purple
  ));
});

// 2. Resolve AudioUnitBoxes (after transaction commits)
const rhythmUnitBox = busBoxes.get("Rhythm")!.output
  .targetVertex.unwrap().box as AudioUnitBox;
const melodicUnitBox = busBoxes.get("Melodic")!.output
  .targetVertex.unwrap().box as AudioUnitBox;

// 3. Create tracks (each gets default master routing)
const tracks: { name: string; audioUnitBox: AudioUnitBox }[] = [];

for (const file of audioFiles) {
  project.editing.modify(() => {
    const { audioUnitBox, trackBox } = project.api.createInstrument(
      InstrumentFactories.Tape
    );
    // ... create AudioFileBox, AudioRegionBox ...
    tracks.push({ name: file.name, audioUnitBox });
  });
}

// 4. Re-route to groups (separate transaction)
project.editing.modify(() => {
  for (const track of tracks) {
    if (track.name === "Drums" || track.name === "Bass") {
      track.audioUnitBox.output.refer(busBoxes.get("Rhythm")!.input);
    } else {
      track.audioUnitBox.output.refer(busBoxes.get("Melodic")!.input);
    }
  }
});

// 5. Control group mixer parameters
project.editing.modify(() => {
  rhythmUnitBox.volume.setValue(-3);  // -3 dB
  melodicUnitBox.volume.setValue(-6); // -6 dB
});
```

### Solo Behavior

OpenDAW's `Mixer` class automatically handles solo propagation through the routing graph:

| Action | Result |
|--------|--------|
| Solo a group | All tracks routed to that group are **virtually soloed** — they keep playing. All other groups and their tracks are muted. |
| Solo a track | The track's output chain (its group, then master) is virtually soloed. Other tracks in the same group are muted. |
| Solo master | Everything plays (effectively un-solos all). |

Virtual solo is bidirectional: the `Mixer` traverses both upstream (inputs to the soloed channel) and downstream (outputs from the soloed channel) to determine which channels should remain audible. No special handling is needed in your code — create the routing structure and the solo buttons work correctly.

### Subscribing to Group State

Use `catchupAndSubscribe` to observe group mixer state changes, the same pattern used for instrument tracks:

```typescript
useEffect(() => {
  const box = group.audioUnitBox;

  const volSub = box.volume.catchupAndSubscribe(obs =>
    setVolume(obs.getValue())
  );
  const muteSub = box.mute.catchupAndSubscribe(obs =>
    setMuted(obs.getValue())
  );
  const soloSub = box.solo.catchupAndSubscribe(obs =>
    setSoloed(obs.getValue())
  );

  return () => {
    volSub.terminate();
    muteSub.terminate();
    soloSub.terminate();
  };
}, [group]);
```

### Master Output Access

The master output's AudioUnitBox is accessible via the root box's output device pointer hub:

```typescript
const masterAudioBox = project.rootBox.outputDevice
  .pointerHub.incoming().at(0)?.box as AudioUnitBox;

// Control master volume
project.editing.modify(() => {
  masterAudioBox.volume.setValue(-3);
});
```

### Groups vs Aux Units

OpenDAW supports two types of bus units:

| Feature | Group (`AudioUnitType.Bus`) | Aux (`AudioUnitType.Aux`) |
|---------|---------------------------|--------------------------|
| Routing | **Serial** — track output → group → master | **Parallel** — track sends a copy to aux |
| Use case | Submixing related tracks (drums group, vocal group) | Effects processing (reverb bus, delay bus) |
| Signal path | Replaces the track's default master routing | Runs alongside the main signal path |
| Creation | `AudioBusFactory.create(..., AudioUnitType.Bus, ...)` | `AudioBusFactory.create(..., AudioUnitType.Aux, ...)` |

The mixer groups demo uses serial group routing. For parallel aux/send routing, see the retro example in the OpenDAW source.

### Demo

See `src/demos/playback/mixer-groups-demo.tsx` for a complete working example that:

- Creates two group buses (Rhythm and Melodic) using `AudioBusFactory`
- Loads 7 audio stems and routes them to the appropriate group
- Provides per-track volume/mute/solo controls
- Provides per-group volume/mute/solo controls
- Provides master output volume control
- Displays a visual signal flow diagram

The track loading logic is in `src/lib/groupTrackLoading.ts`.

### References

- [Box System & Reactivity](./04-box-system-and-reactivity.md) — Understanding boxes, pointers, and transactions
- [Clip Fades](./09-editing-fades-and-automation.md#clip-fades) — Another example of transaction-sensitive operations
- [Time Signature Changes](./02-timing-and-tempo.md#advanced-time-signature-changes) — Documents the same deferred notification behavior
