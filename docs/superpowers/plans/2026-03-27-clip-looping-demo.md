# Clip Looping Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a focused demo showing how region looping works in OpenDAW — when a region's `duration` exceeds its `loopDuration`, the content tiles (repeats) automatically.

**Architecture:** Single-page React component loading the Dark Ride Drums stem at 124 BPM. The region is trimmed to a short loop via preset buttons or sliders. A custom canvas renders the tiled waveform with loop boundary markers. Transport plays the looped audio with optional metronome.

**Tech Stack:** React, Radix UI, OpenDAW SDK (`loadTracksFromFiles`, `AudioRegionBox`, `PeaksPainter`), shared hooks (`usePlaybackPosition`, `useTransportControls`)

---

### Task 1: HTML Entry Point + Vite Config

**Files:**
- Create: `clip-looping-demo.html`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create HTML entry point**

Create `clip-looping-demo.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Clip Looping Demo - OpenDAW</title>
    <meta name="description" content="Explore audio region looping in OpenDAW: set loopDuration shorter than duration and the content tiles automatically. Interactive controls with waveform visualization." />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
    <style>
        body {
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }
    </style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/clip-looping-demo.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Add build entry to vite.config.ts**

Add after the `trackAutomation` entry in `rollupOptions.input`:

```typescript
clipLooping: resolve(__dirname, "clip-looping-demo.html")
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds (clip-looping-demo.html will error until we create the tsx, but the config should parse)

- [ ] **Step 4: Commit**

```bash
git add clip-looping-demo.html vite.config.ts
git commit -m "chore: add clip looping demo entry point and build config"
```

---

### Task 2: Main Demo Component — Initialization + Presets

**Files:**
- Create: `src/clip-looping-demo.tsx`

This task creates the full demo component with initialization, presets, sliders, transport, and layout. The waveform canvas is a placeholder `<div>` that Task 3 replaces.

- [ ] **Step 1: Create clip-looping-demo.tsx**

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Button,
  Callout, Badge, Separator, Slider, Code
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const BEAT = BAR / 4; // 960

type LoopPreset = {
  name: string;
  description: string;
  loopDuration: number; // PPQN, or -1 for "full audio"
  loopOffset: number;
  duration: number; // PPQN, or -1 for "full audio"
};

const PRESETS: LoopPreset[] = [
  {
    name: "2-Bar Loop",
    description: "Classic 2-bar drum loop tiled 4x",
    loopDuration: BAR * 2,
    loopOffset: 0,
    duration: BAR * 8,
  },
  {
    name: "1-Bar Loop",
    description: "Tight 1-bar pattern tiled 8x",
    loopDuration: BAR * 1,
    loopOffset: 0,
    duration: BAR * 8,
  },
  {
    name: "Half-Bar Loop",
    description: "Rapid half-bar repeat",
    loopDuration: BEAT * 2,
    loopOffset: 0,
    duration: BAR * 4,
  },
  {
    name: "Offset Start",
    description: "Loop from bar 3 of the audio",
    loopDuration: BAR * 2,
    loopOffset: BAR * 2,
    duration: BAR * 8,
  },
  {
    name: "Long Loop",
    description: "4-bar phrase tiled 4x",
    loopDuration: BAR * 4,
    loopOffset: 0,
    duration: BAR * 16,
  },
  {
    name: "Full (No Loop)",
    description: "Plays the full stem once",
    loopDuration: -1,
    loopOffset: 0,
    duration: -1,
  },
];

function formatPpqn(ppqn: number): string {
  const bars = Math.floor(ppqn / BAR);
  const beats = Math.floor((ppqn % BAR) / BEAT);
  if (beats === 0) return `${bars} bar${bars !== 1 ? "s" : ""}`;
  return `${bars} bar${bars !== 1 ? "s" : ""} ${beats} beat${beats !== 1 ? "s" : ""}`;
}

function applyLoopSettings(
  project: Project,
  regionBox: AudioRegionBox,
  loopDuration: number,
  loopOffset: number,
  duration: number,
  fullAudioPpqn: number
): void {
  const ld = loopDuration === -1 ? fullAudioPpqn : loopDuration;
  const d = duration === -1 ? fullAudioPpqn : duration;

  project.editing.modify(() => {
    regionBox.loopDuration.setValue(ld);
    regionBox.loopOffset.setValue(loopOffset);
    regionBox.duration.setValue(d);
  });

  // Update timeline loop area to match
  project.editing.modify(() => {
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(d);
    project.timelineBox.loopArea.enabled.setValue(true);
    project.timelineBox.durationInPulses.setValue(d);
  });
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [regionBox, setRegionBox] = useState<AudioRegionBox | null>(null);
  const [fullAudioPpqn, setFullAudioPpqn] = useState(0);
  const [activePresetIndex, setActivePresetIndex] = useState(0);

  // Slider state
  const [loopDuration, setLoopDuration] = useState(BAR * 2);
  const [loopOffset, setLoopOffset] = useState(0);
  const [duration, setDuration] = useState(BAR * 8);

  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  // Initialize
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;
        setAudioContext(newAudioContext);
        setProject(newProject);

        // Enable metronome
        const settings = newProject.engine.preferences.settings;
        settings.metronome.enabled = true;
        settings.metronome.gain = -6;

        const ext = getAudioExtension();
        const tracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [{ name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }],
          localAudioBuffers,
          { onProgress: (c, t, name) => { if (mounted) setStatus(`Loading ${name}...`); } }
        );

        if (!mounted) return;

        // Find the AudioRegionBox
        const boxes = newProject.boxGraph.boxes();
        let foundRegion: AudioRegionBox | null = null;
        for (const box of boxes) {
          if (box instanceof AudioRegionBox) {
            foundRegion = box;
            break;
          }
        }

        if (!foundRegion) {
          setStatus("Error: no region found");
          return;
        }

        const audioPpqn = foundRegion.duration.getValue();
        setFullAudioPpqn(audioPpqn);
        setRegionBox(foundRegion);

        // Apply default preset (2-Bar Loop)
        const preset = PRESETS[0];
        const ld = preset.loopDuration === -1 ? audioPpqn : preset.loopDuration;
        const d = preset.duration === -1 ? audioPpqn : preset.duration;
        applyLoopSettings(newProject, foundRegion, ld, preset.loopOffset, d, audioPpqn);
        setLoopDuration(ld);
        setLoopOffset(preset.loopOffset);
        setDuration(d);

        if (mounted) setStatus("Ready");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => { mounted = false; };
  }, []);

  const handlePreset = useCallback((index: number) => {
    if (!project || !regionBox) return;
    if (isPlaying) project.engine.stop(true);

    const preset = PRESETS[index];
    const ld = preset.loopDuration === -1 ? fullAudioPpqn : preset.loopDuration;
    const lo = preset.loopOffset;
    const d = preset.duration === -1 ? fullAudioPpqn : preset.duration;

    applyLoopSettings(project, regionBox, ld, lo, d, fullAudioPpqn);
    setActivePresetIndex(index);
    setLoopDuration(ld);
    setLoopOffset(lo);
    setDuration(d);
  }, [project, regionBox, isPlaying, fullAudioPpqn]);

  const handleSliderApply = useCallback(() => {
    if (!project || !regionBox) return;
    applyLoopSettings(project, regionBox, loopDuration, loopOffset, duration, fullAudioPpqn);
    setActivePresetIndex(-1); // Deselect presets when using sliders
  }, [project, regionBox, loopDuration, loopOffset, duration, fullAudioPpqn]);

  // Apply slider changes on commit (not during drag)
  const handleLoopDurationCommit = useCallback((value: number[]) => {
    setLoopDuration(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, value[0], loopOffset, duration, fullAudioPpqn);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopOffset, duration, fullAudioPpqn]);

  const handleLoopOffsetCommit = useCallback((value: number[]) => {
    setLoopOffset(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, loopDuration, value[0], duration, fullAudioPpqn);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopDuration, duration, fullAudioPpqn]);

  const handleDurationCommit = useCallback((value: number[]) => {
    setDuration(value[0]);
    if (project && regionBox) {
      applyLoopSettings(project, regionBox, loopDuration, loopOffset, value[0], fullAudioPpqn);
      setActivePresetIndex(-1);
    }
  }, [project, regionBox, loopDuration, loopOffset, fullAudioPpqn]);

  const handleMetronomeToggle = useCallback(() => {
    if (!project) return;
    const next = !metronomeEnabled;
    setMetronomeEnabled(next);
    project.engine.preferences.settings.metronome.enabled = next;
  }, [project, metronomeEnabled]);

  const tileCount = loopDuration > 0 ? Math.ceil(duration / loopDuration) : 1;

  const isReady = status === "Ready";

  return (
    <Theme appearance="dark" accentColor="orange" radius="large">
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Clip Looping</Heading>
            <Text size="3" color="gray">
              Set a loop region within a clip and extend it to tile automatically
            </Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Every region has a <Code>loopDuration</Code> (content that repeats) and a <Code>duration</Code> (total
              visible length). When duration exceeds loopDuration, the content tiles automatically.
              Use <Code>loopOffset</Code> to shift which part of the audio loops.
            </Callout.Text>
          </Callout.Root>

          {!isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <>
              {/* Presets */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Presets</Text>
                  <Flex gap="2" wrap="wrap">
                    {PRESETS.map((preset, index) => (
                      <Button
                        key={preset.name}
                        variant={activePresetIndex === index ? "solid" : "outline"}
                        onClick={() => handlePreset(index)}
                      >
                        {preset.name}
                      </Button>
                    ))}
                  </Flex>
                  {activePresetIndex >= 0 && (
                    <Text size="2" color="gray">{PRESETS[activePresetIndex].description}</Text>
                  )}
                </Flex>
              </Card>

              {/* Waveform canvas placeholder — replaced in Task 3 */}
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">Waveform</Text>
                  <div style={{
                    width: "100%",
                    height: 120,
                    backgroundColor: "#1a1a2e",
                    borderRadius: "var(--radius-3)",
                    border: "1px solid var(--gray-6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <Text size="2" color="gray">Waveform canvas (Task 3)</Text>
                  </div>
                </Flex>
              </Card>

              {/* Sliders + Info */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Loop Controls</Text>

                  {/* Loop Duration slider */}
                  <Flex direction="column" gap="1">
                    <Flex justify="between">
                      <Text size="2">Loop Duration</Text>
                      <Text size="2" color="gray">{formatPpqn(loopDuration)}</Text>
                    </Flex>
                    <Slider
                      value={[loopDuration]}
                      onValueChange={(v) => setLoopDuration(v[0])}
                      onValueCommit={handleLoopDurationCommit}
                      min={BEAT}
                      max={BAR * 8}
                      step={BEAT}
                    />
                  </Flex>

                  {/* Loop Offset slider */}
                  <Flex direction="column" gap="1">
                    <Flex justify="between">
                      <Text size="2">Loop Offset</Text>
                      <Text size="2" color="gray">{formatPpqn(loopOffset)}</Text>
                    </Flex>
                    <Slider
                      value={[loopOffset]}
                      onValueChange={(v) => setLoopOffset(v[0])}
                      onValueCommit={handleLoopOffsetCommit}
                      min={0}
                      max={Math.max(BAR * 8, fullAudioPpqn - loopDuration)}
                      step={BEAT}
                    />
                  </Flex>

                  {/* Region Duration slider */}
                  <Flex direction="column" gap="1">
                    <Flex justify="between">
                      <Text size="2">Region Duration</Text>
                      <Text size="2" color="gray">{formatPpqn(duration)}</Text>
                    </Flex>
                    <Slider
                      value={[duration]}
                      onValueChange={(v) => setDuration(v[0])}
                      onValueCommit={handleDurationCommit}
                      min={BAR}
                      max={BAR * 16}
                      step={BAR}
                    />
                  </Flex>

                  <Separator size="4" />

                  {/* Info panel */}
                  <Flex gap="4" wrap="wrap">
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Tiles</Text>
                      <Badge size="2" color="orange">{tileCount} repetition{tileCount !== 1 ? "s" : ""}</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Loop Duration</Text>
                      <Badge size="2" variant="outline">{loopDuration} PPQN</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Region Duration</Text>
                      <Badge size="2" variant="outline">{duration} PPQN</Badge>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">Source Audio</Text>
                      <Badge size="2" variant="outline">{formatPpqn(fullAudioPpqn)}</Badge>
                    </Flex>
                  </Flex>
                </Flex>
              </Card>

              {/* Transport */}
              <Card>
                <Flex gap="3" align="center">
                  {!isPlaying ? (
                    <Button size="3" onClick={handlePlay}>Play</Button>
                  ) : (
                    <Button size="3" color="red" onClick={handleStop}>Stop</Button>
                  )}
                  <Button
                    variant={metronomeEnabled ? "solid" : "outline"}
                    onClick={handleMetronomeToggle}
                  >
                    Metronome {metronomeEnabled ? "On" : "Off"}
                  </Button>
                  {isPlaying && (
                    <Text size="2" color="gray">
                      Bar {Math.floor(currentPosition / BAR) + 1}, Beat {Math.floor((currentPosition % BAR) / BEAT) + 1}
                    </Text>
                  )}
                </Flex>
              </Card>

              {/* API Reference */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="4" weight="bold">API Reference</Text>
                  <Separator size="4" />
                  <Code
                    size="2"
                    style={{
                      display: "block",
                      padding: "12px",
                      backgroundColor: "var(--gray-3)",
                      borderRadius: "4px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
{`// Region looping: when duration > loopDuration, content tiles
project.editing.modify(() => {
  // Content that repeats (e.g., 2 bars of drums)
  regionBox.loopDuration.setValue(PPQN.fromSignature(4, 4) * 2);

  // Where in the source audio the loop starts
  regionBox.loopOffset.setValue(0);

  // Total region length (e.g., 8 bars = 4 repetitions)
  regionBox.duration.setValue(PPQN.fromSignature(4, 4) * 8);
});`}
                  </Code>
                </Flex>
              </Card>

              {/* Attribution */}
              <Card>
                <Text size="2" color="gray">
                  Drum stems from Dark Ride's 'Deny Control'. Provided for educational purposes. See{" "}
                  <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent-9)" }}>cambridge-mt.com</a> for details.
                </Text>
              </Card>
            </>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual test in dev**

Run: `npm run dev`
Navigate to `http://localhost:5173/clip-looping-demo.html`
Expected: Drums load, preset buttons change loop settings, sliders adjust values, transport plays looped audio. Waveform area shows placeholder.

- [ ] **Step 4: Commit**

```bash
git add src/clip-looping-demo.tsx
git commit -m "feat: add clip looping demo with presets, sliders, and transport"
```

---

### Task 3: Looped Waveform Canvas

**Files:**
- Modify: `src/clip-looping-demo.tsx`

Replace the waveform placeholder with a canvas component that renders the tiled waveform using `PeaksPainter.renderPixelStrips()`.

- [ ] **Step 1: Add imports and canvas component**

Add to the imports at the top of `clip-looping-demo.tsx`:

```tsx
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import { UUID } from "@opendaw/lib-std";
```

Add this component before the `App` component:

```tsx
const CANVAS_HEIGHT = 120;

const LoopedWaveformCanvas: React.FC<{
  peaks: Peaks | null;
  sampleRate: number;
  loopDuration: number;
  loopOffset: number;
  duration: number;
  fullAudioPpqn: number;
  playheadPosition: number;
  isPlaying: boolean;
  bpm: number;
}> = ({ peaks, sampleRate, loopDuration, loopOffset, duration, fullAudioPpqn, playheadPosition, isPlaying, bpm }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = CANVAS_HEIGHT;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const numFrames = peaks.numFrames;
    const tileCount = loopDuration > 0 ? Math.ceil(duration / loopDuration) : 1;

    // Compute frame ranges for loop content
    const loopOffsetFrames = Math.floor((loopOffset / fullAudioPpqn) * numFrames);
    const loopDurationFrames = Math.floor((loopDuration / fullAudioPpqn) * numFrames);
    const u0 = loopOffsetFrames;
    const u1 = u0 + loopDurationFrames;

    // Draw each tile
    for (let tile = 0; tile < tileCount; tile++) {
      const tileStartX = (tile * loopDuration / duration) * width;
      const tileEndX = Math.min(((tile + 1) * loopDuration / duration) * width, width);
      const tileWidth = tileEndX - tileStartX;

      if (tileWidth <= 0) continue;

      // Slightly different bg for repeated tiles
      if (tile > 0) {
        ctx.fillStyle = "rgba(255, 150, 50, 0.03)";
        ctx.fillRect(tileStartX, 0, tileWidth, height);
      }

      // Create offscreen canvas for this tile's waveform
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = Math.ceil(tileWidth * dpr);
      tileCanvas.height = height * dpr;
      const tileCtx = tileCanvas.getContext("2d");
      if (!tileCtx) continue;

      tileCtx.scale(dpr, dpr);

      PeaksPainter.renderPixelStrips(
        tileCtx,
        peaks,
        Math.ceil(tileWidth),
        height,
        u0,
        u1,
        "rgba(255, 150, 50, 0.7)",
        "rgba(255, 150, 50, 0.4)"
      );

      ctx.drawImage(tileCanvas, 0, 0, tileCanvas.width, tileCanvas.height,
        tileStartX, 0, tileWidth, height);
    }

    // Bar grid lines
    const barsInDuration = duration / BAR;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let bar = 1; bar < barsInDuration; bar++) {
      const x = (bar / barsInDuration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Bar number labels
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    for (let bar = 0; bar < barsInDuration; bar++) {
      const x = (bar / barsInDuration) * width;
      ctx.fillText(`${bar + 1}`, x + 4, height - 4);
    }

    // Loop boundary lines (dashed, brighter)
    ctx.strokeStyle = "rgba(255, 180, 80, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (let tile = 1; tile < tileCount; tile++) {
      const x = (tile * loopDuration / duration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Playhead
    if (isPlaying && playheadPosition >= 0 && playheadPosition < duration) {
      const px = (playheadPosition / duration) * width;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [peaks, sampleRate, loopDuration, loopOffset, duration, fullAudioPpqn, playheadPosition, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: CANVAS_HEIGHT,
        borderRadius: "var(--radius-3)",
        border: "1px solid var(--gray-6)",
      }}
    />
  );
};
```

- [ ] **Step 2: Add peaks state to App and wire up canvas**

Add state to the App component (after the existing state declarations):

```tsx
const [peaks, setPeaks] = useState<Peaks | null>(null);
const [sampleRate, setSampleRate] = useState(48000);
```

After `setRegionBox(foundRegion)` in the init effect, add peak loading:

```tsx
// Get peaks for waveform rendering
const fileVertex = foundRegion.file.targetVertex;
if (fileVertex.nonEmpty()) {
  const audioFileBox = fileVertex.unwrap().box;
  const uuid = audioFileBox.address.uuid;
  const sampleLoader = newProject.sampleManager.getOrCreate(uuid);
  const sub = sampleLoader.subscribe((state: any) => {
    if (state.type === "loaded") {
      const peaksOpt = sampleLoader.peaks;
      if (peaksOpt.nonEmpty()) {
        setPeaks(peaksOpt.unwrap());
      }
      setSampleRate(newAudioContext.sampleRate);
      sub.terminate();
    }
  });
  // Peaks may already be loaded
  const peaksOpt = sampleLoader.peaks;
  if (peaksOpt.nonEmpty()) {
    setPeaks(peaksOpt.unwrap());
    setSampleRate(newAudioContext.sampleRate);
  }
}
```

- [ ] **Step 3: Replace the placeholder div with the canvas**

Replace the waveform placeholder card with:

```tsx
{/* Waveform */}
<Card>
  <Flex direction="column" gap="2">
    <Text size="2" weight="bold" color="gray">Waveform</Text>
    <LoopedWaveformCanvas
      peaks={peaks}
      sampleRate={sampleRate}
      loopDuration={loopDuration}
      loopOffset={loopOffset}
      duration={duration}
      fullAudioPpqn={fullAudioPpqn}
      playheadPosition={currentPosition}
      isPlaying={isPlaying}
      bpm={BPM}
    />
  </Flex>
</Card>
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Builds with no errors.

- [ ] **Step 5: Manual test in dev**

Run: `npm run dev`, navigate to clip looping demo.
Expected: Waveform renders showing tiled drums with loop boundary markers. Playhead moves during playback. Switching presets redraws the waveform with different tile counts.

- [ ] **Step 6: Commit**

```bash
git add src/clip-looping-demo.tsx
git commit -m "feat: add looped waveform canvas with PeaksPainter tiling"
```

---

### Task 4: Homepage Card + Build Entry

**Files:**
- Modify: `src/index.tsx`

- [ ] **Step 1: Add card to index.tsx**

Add before the Track Automation card (the last card in the grid):

```tsx
<Card asChild>
  <Link href="/clip-looping-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
    <Flex direction="column" gap="3">
      <Flex direction="column" align="center" gap="2">
        <Text size="8">🔁</Text>
        <Heading size="5">Clip Looping</Heading>
      </Flex>
      <Text size="2" color="gray">
        Set a loop region within an audio clip and extend it to tile automatically.
        Interactive controls for loop duration, offset, and region length with waveform visualization.
      </Text>
    </Flex>
  </Link>
</Card>
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build succeeds. Homepage shows the new Clip Looping card.

- [ ] **Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat: add clip looping demo card to homepage"
```

---

### Task 5: Final Polish + Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add to README demos table**

Add after the Track Automation row in the demos table:

```markdown
| **Clip Looping** | Set loop regions within audio clips and extend to tile automatically with waveform visualization |
```

Add to the documentation links section:

```markdown
- [Clip Looping](./documentation/20-clip-looping.md) — Region looping and tiling
```

Add to the project structure:

```markdown
├── clip-looping-demo.tsx              # Region loop tiling
```

- [ ] **Step 2: Add reference to CLAUDE.md**

Add to the Reference Files section:

```markdown
- Clip looping demo: `src/clip-looping-demo.tsx` (region loopDuration/loopOffset/duration tiling)
```

- [ ] **Step 3: Build final verification**

Run: `npm run build`
Expected: Clean build, all demos included.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add clip looping demo to README and CLAUDE.md"
```
