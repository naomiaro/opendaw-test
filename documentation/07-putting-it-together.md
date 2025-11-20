# Putting It All Together

This document combines all the concepts (PPQN, Box System, Sample Management, Timeline Rendering) into a complete working example.

## Complete DAW Application Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 React Application                        │
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
import { AudioWorklets, DefaultSampleLoaderManager, Project, Workers } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";

export async function initializeOpenDAW(localAudioBuffers: Map<string, AudioBuffer>) {
  // Start AnimationFrame loop (required for observables)
  AnimationFrame.start(window);

  // Install workers and worklets
  await Workers.install("/workers-main.js");
  AudioWorklets.install("/processors.js");

  // Create AudioContext
  const audioContext = new AudioContext({ latencyHint: 0 });

  // Configure sample manager
  const sampleManager = new DefaultSampleLoaderManager({
    fetch: async (uuid, progress) => {
      const uuidString = UUID.toString(uuid);
      const audioBuffer = localAudioBuffers.get(uuidString);

      if (audioBuffer) {
        const audioData = OpenSampleAPI.fromAudioBuffer(audioBuffer);
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
  });

  // Create worklets
  await AudioWorklets.createFor(audioContext);

  // Create project
  const project = Project.new({
    audioContext,
    sampleManager,
    soundfontManager,
    audioWorklets: AudioWorklets.get(audioContext)
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
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { AudioPlayback } from "@opendaw/studio-enums";
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
            uuid: trackBox.uuid,
            color: file.color
          });

          // Create AudioFileBox
          const fileUUID = UUID.generate();
          const audioBuffer = audioBuffers[index];

          localAudioBuffersRef.current.set(
            UUID.toString(fileUUID),
            audioBuffer
          );

          AudioFileBox.create(boxGraph, fileUUID, box => {
            box.fileName.setValue(file.name);
            box.endInSeconds.setValue(audioBuffer.duration);
          });

          // Create clips based on pattern
          const positions = getPatternPositions(file.name);

          positions.forEach(position => {
            const clipDuration = PPQN.secondsToPulses(
              audioBuffer.duration,
              120
            );

            const regionBox = AudioRegionBox.create(
              boxGraph,
              UUID.generate(),
              box => {
                box.regions.refer(trackBox.regions);
                box.file.refer(AudioFileBox.get(boxGraph, fileUUID));
                box.playback.setValue(AudioPlayback.NoSync);
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

    const playingSub = project.engine.isPlaying.subscribe(obs => {
      setIsPlaying(obs.getValue());
    });

    const positionSub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });

    const bpmSub = project.timelineBox.bpm.subscribe(field => {
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
    project.engine.stop(true);
    project.engine.setPosition(0);
  };

  const handleBpmChange = (newBpm: number) => {
    if (!project) return;

    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(newBpm);

      // Recalculate clip durations
      clips.forEach(clip => {
        const newDuration = PPQN.secondsToPulses(
          clip.audioDuration,
          newBpm
        );
        clip.regionBox.duration.setValue(newDuration);
        clip.regionBox.loopDuration.setValue(newDuration);
      });
    });

    // Update UI
    const updatedClips = clips.map(clip => ({
      ...clip,
      duration: PPQN.secondsToPulses(clip.audioDuration, newBpm)
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
const duration = PPQN.secondsToPulses(audioDuration, bpm);
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
// Configure sample manager with local buffers
const sampleManager = new DefaultSampleLoaderManager({
  fetch: async (uuid) => {
    const audioBuffer = localBuffers.get(UUID.toString(uuid));
    return [audioData, metadata];
  }
});

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
  duration: PPQN.secondsToPulses(clip.audioDuration, newBpm)
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

## Summary

Building a DAW UI with OpenDAW requires understanding:

1. **PPQN** - Musical time system (positions and durations)
2. **Box System** - Data model with transactions and observables
3. **Sample Manager** - Audio loading and peaks generation
4. **Timeline Rendering** - Converting PPQN to pixels

The key is to keep **positions** in PPQN (musical), convert to **pixels** for rendering, and recalculate **durations** when BPM changes.

This architecture provides:
- ✅ Precise musical timing
- ✅ Tempo changes without breaking positions
- ✅ Reactive UI updates
- ✅ Efficient audio processing
- ✅ Professional DAW workflow

You now have all the tools to build a fully-functional browser-based DAW!
