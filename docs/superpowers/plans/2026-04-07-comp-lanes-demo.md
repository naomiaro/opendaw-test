# Comp Lanes Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comp lanes demo that crossfades between simulated takes using per-track volume automation — zero pops, no region splitting.

**Architecture:** Load same audio file onto 3 tracks at slightly different beat offsets. User defines comp zones via Shift+Click and selects active take per zone. Volume automation handles crossfades with `Interpolation.Curve` for equal-power transitions. All tracks play continuously.

**Tech Stack:** React, OpenDAW SDK (volume automation, `AudioUnitBoxAdapter.VolumeMapper`, `Interpolation.Curve`), Radix UI Theme, Vite

---

### Task 1: Create HTML Entry Point and Build Config

**Files:**
- Create: `comp-lanes-demo.html`
- Modify: `vite.config.ts`
- Modify: `src/index.tsx`

- [ ] **Step 1: Create the HTML file**

Create `comp-lanes-demo.html` at the project root:

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenDAW Comp Lanes Demo - Take Comping with Volume Automation Crossfades</title>
    <meta name="description"
        content="Comp between simulated takes using volume automation crossfades. Zero pops — no region splitting needed." />
    <meta name="author" content="Moises AI" />
    <meta name="theme-color" content="#30a46c" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
        body {
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
    </style>
</head>

<body>
    <div id="root"></div>
    <script type="module" src="/src/demos/playback/comp-lanes-demo.tsx"></script>
</body>

</html>
```

- [ ] **Step 2: Add build entry to vite.config.ts**

Add inside `rollupOptions.input` after the `regionSlice` entry:

```typescript
                compLanes: resolve(__dirname, "comp-lanes-demo.html")
```

- [ ] **Step 3: Add index card to src/index.tsx**

Add this card after the Region Slicing card (before the closing `</div>`):

```tsx
            <Card asChild>
              <Link href="/comp-lanes-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎚️</Text>
                    <Heading size="5">Comp Lanes</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Comp between simulated takes using volume automation crossfades.
                    Select which take is active per zone with seamless equal-power transitions.
                  </Text>
                </Flex>
              </Link>
            </Card>
```

- [ ] **Step 4: Commit**

```bash
git add comp-lanes-demo.html vite.config.ts src/index.tsx
git commit -m "feat: add comp lanes demo entry point and build config"
```

---

### Task 2: Create the Comp Lanes Demo Component

**Files:**
- Create: `src/demos/playback/comp-lanes-demo.tsx`

This is the main demo. It handles audio loading, take creation, comp state management, volume automation, and the UI.

- [ ] **Step 1: Create the demo file**

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox, AudioUnitBox, TrackBox, ValueRegionBox } from "@opendaw/studio-boxes";
import { AudioUnitBoxAdapter, ValueRegionBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TransportControls } from "@/components/TransportControls";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import type { TrackData } from "@/lib/types";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Callout,
  Badge,
  Button,
  Box as RadixBox
} from "@radix-ui/themes";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const BEAT = BAR / 4; // 960
const NUM_BARS = 8;
const TOTAL_PPQN = BAR * NUM_BARS;
const NUM_TAKES = 3;
// Offsets for simulated takes (fractions of a beat)
const TAKE_OFFSETS = [0, Math.round(BEAT * 0.25), Math.round(BEAT * 0.5)]; // 0, 240, 480 PPQN
const TAKE_COLORS = ["#4ade80", "#f59e0b", "#ef4444"];
const TAKE_LABELS = ["Take 1", "Take 2", "Take 3"];

// Volume automation values
const VOL_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0); // unitValue for 0 dB
const VOL_SILENT = 0.0; // unitValue for -inf

interface TakeData {
  trackData: TrackData;
  automationTrackBox: TrackBox;
  offset: number; // PPQN offset into the audio file
  color: string;
  label: string;
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [takes, setTakes] = useState<TakeData[]>([]);
  const [compBoundaries, setCompBoundaries] = useState<number[]>([]); // PPQN positions
  const [compAssignments, setCompAssignments] = useState<number[]>([0]); // take index per zone
  const [crossfadeMs, setCrossfadeMs] = useState(20);
  const [isDragOver, setIsDragOver] = useState(false);

  const { currentPosition, setCurrentPosition, isPlaying, pausedPositionRef } =
    usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef
  });

  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // ─── Playback range (set after takes are created) ───
  const playbackStartRef = useRef<number>(0);

  // ─── Rebuild volume automation from current comp state ───
  const rebuildAutomation = useCallback(
    (project: Project, takes: TakeData[], boundaries: number[], assignments: number[], xfadeMs: number) => {
      const crossfadePPQN = Math.round(PPQN.secondsToPulses(xfadeMs / 1000, BPM));
      const playbackStart = playbackStartRef.current;

      for (let t = 0; t < takes.length; t++) {
        const take = takes[t];
        const trackBox = take.automationTrackBox;

        // Delete existing automation regions
        const boxes = project.boxGraph.boxes();
        const existingRegions = boxes.filter(
          (box: any) =>
            box instanceof ValueRegionBox &&
            box.regions.targetVertex.nonEmpty() &&
            box.regions.targetVertex.unwrap().box === trackBox
        );

        if (existingRegions.length > 0) {
          project.editing.modify(() => {
            for (const region of existingRegions) {
              const adapter = project.boxAdapters.adapterFor(region, ValueRegionBoxAdapter);
              const collectionOpt = adapter.optCollection;
              if (collectionOpt.nonEmpty()) {
                collectionOpt.unwrap().events.asArray().forEach((evt: any) => evt.box.delete());
              }
              region.delete();
            }
          });
        }

        // Create new automation region and events
        project.editing.modify(() => {
          const regionOpt = project.api.createTrackRegion(
            trackBox,
            playbackStart as ppqn,
            TOTAL_PPQN as ppqn
          );
          if (regionOpt.isEmpty()) return;
          const regionBox = regionOpt.unwrap() as ValueRegionBox;
          const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
          const collectionOpt = adapter.optCollection;
          if (collectionOpt.isEmpty()) return;
          const collection = collectionOpt.unwrap();

          // Build zone boundaries (region-local: 0 to TOTAL_PPQN)
          const zoneBounds = [0, ...boundaries.map(b => b - playbackStart), TOTAL_PPQN];

          for (let z = 0; z < assignments.length; z++) {
            const zoneStart = zoneBounds[z];
            const zoneEnd = zoneBounds[z + 1];
            const isActive = assignments[z] === t;

            if (isActive) {
              // Fade in at zone start (except first zone)
              if (z > 0 && crossfadePPQN > 0) {
                collection.createEvent({
                  position: Math.max(0, zoneStart - crossfadePPQN) as ppqn,
                  index: 0,
                  value: VOL_SILENT,
                  interpolation: Interpolation.Curve(0.75) // exponential fade-in
                });
              }
              collection.createEvent({
                position: (z > 0 && crossfadePPQN > 0 ? zoneStart : zoneStart) as ppqn,
                index: 0,
                value: VOL_0DB,
                interpolation: Interpolation.None
              });

              // Hold at 0dB through the zone, then fade out (except last zone)
              if (z < assignments.length - 1 && crossfadePPQN > 0) {
                collection.createEvent({
                  position: Math.max(zoneStart, zoneEnd - crossfadePPQN) as ppqn,
                  index: 0,
                  value: VOL_0DB,
                  interpolation: Interpolation.Curve(0.25) // logarithmic fade-out
                });
                collection.createEvent({
                  position: zoneEnd as ppqn,
                  index: 0,
                  value: VOL_SILENT,
                  interpolation: Interpolation.None
                });
              } else if (z < assignments.length - 1) {
                collection.createEvent({
                  position: zoneEnd as ppqn,
                  index: 0,
                  value: VOL_SILENT,
                  interpolation: Interpolation.None
                });
              }
            } else {
              // Inactive: ensure silence
              collection.createEvent({
                position: zoneStart as ppqn,
                index: 0,
                value: VOL_SILENT,
                interpolation: Interpolation.None
              });
            }
          }
        });
      }
    },
    []
  );

  // ─── Load takes from audio file ───
  const loadTakes = useCallback(
    async (name: string, fileUrl: string) => {
      if (!project || !audioContext) return;

      setStatus(`Loading ${name}...`);
      const localAudioBuffers = localAudioBuffersRef.current;

      // Load the same file 3 times as separate tracks
      const fileConfigs = TAKE_LABELS.map((label) => ({ name: label, file: fileUrl }));
      const loadedTracks = await loadTracksFromFiles(
        project,
        audioContext,
        fileConfigs,
        localAudioBuffers,
        { onProgress: (i, total, trackName) => setStatus(`Loading ${trackName} (${i}/${total})...`) }
      );

      if (loadedTracks.length !== NUM_TAKES) {
        setStatus("Error: failed to create all takes");
        return;
      }

      // Determine playback start (skip silence for Dark Ride, start at 0 for other files)
      const isDarkRide = name.toLowerCase().includes("dark ride");
      const playbackStart = isDarkRide ? BAR * 16 : 0; // bar 17 for Dark Ride
      playbackStartRef.current = playbackStart;

      // Adjust each track's region offset and create automation tracks
      const takeData: TakeData[] = [];
      for (let i = 0; i < NUM_TAKES; i++) {
        const track = loadedTracks[i];
        const offset = TAKE_OFFSETS[i];

        // Adjust region position and loopOffset for the take offset
        project.editing.modify(() => {
          const pointers = track.trackBox.regions.pointerHub.incoming();
          pointers.forEach(({ box }) => {
            if (!box) return;
            const regionBox = box as AudioRegionBox;
            regionBox.position.setValue(playbackStart);
            regionBox.duration.setValue(TOTAL_PPQN);
            regionBox.loopOffset.setValue(playbackStart + offset);
          });
        });

        // Create volume automation track
        let automationTrackBox: TrackBox | null = null;
        project.editing.modify(() => {
          automationTrackBox = project.api.createAutomationTrack(
            track.audioUnitBox,
            track.audioUnitBox.volume
          );
        });

        if (!automationTrackBox) {
          setStatus("Error: failed to create automation track");
          return;
        }

        takeData.push({
          trackData: track,
          automationTrackBox,
          offset,
          color: TAKE_COLORS[i],
          label: TAKE_LABELS[i]
        });
      }

      // Set loop area and position
      project.editing.modify(() => {
        project.timelineBox.loopArea.from.setValue(playbackStart);
        project.timelineBox.loopArea.to.setValue(playbackStart + TOTAL_PPQN);
        project.timelineBox.loopArea.enabled.setValue(false);
      });
      project.engine.setPosition(playbackStart);
      setCurrentPosition(playbackStart);
      if (pausedPositionRef) pausedPositionRef.current = playbackStart;

      // Initial comp state: take 0 active across whole range
      const initialAssignments = [0];
      setCompBoundaries([]);
      setCompAssignments(initialAssignments);

      // Apply initial automation
      rebuildAutomation(project, takeData, [], initialAssignments, crossfadeMs);

      setTakes(takeData);
      setStatus("Ready — Shift+Click to add comp boundaries!");
    },
    [project, audioContext, crossfadeMs, rebuildAutomation, setCurrentPosition, pausedPositionRef]
  );

  // ─── File handlers ───
  const handleFile = useCallback(
    async (file: File) => {
      if (!audioContext) return;
      try {
        const blobUrl = URL.createObjectURL(file);
        await loadTakes(file.name, blobUrl);
        URL.revokeObjectURL(blobUrl);
      } catch (error) {
        console.error("Failed to load audio file:", error);
        setStatus(`Error: Could not load "${file.name}".`);
      }
    },
    [audioContext, loadTakes]
  );

  const handleLoadDemo = useCallback(async () => {
    if (!project || !audioContext) return;
    try {
      const ext = getAudioExtension();
      await loadTakes("Dark Ride - Vocals", `/audio/DarkRide/06_Vox.${ext}`);
    } catch (error) {
      console.error("Failed to load demo:", error);
      setStatus(`Error: ${error}`);
    }
  }, [project, audioContext, loadTakes]);

  // ─── Comp interaction ───
  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || takes.length === 0 || isPlaying) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      const ppqnPos = Math.round(playbackStartRef.current + fraction * TOTAL_PPQN);

      if (e.shiftKey) {
        // Add comp boundary
        const newBoundaries = [...compBoundaries, ppqnPos].sort((a, b) => a - b);
        // Add assignment for new zone (default to take 0)
        const newAssignments: number[] = [];
        for (let i = 0; i <= newBoundaries.length; i++) {
          newAssignments.push(i < compAssignments.length ? compAssignments[i] : 0);
        }
        setCompBoundaries(newBoundaries);
        setCompAssignments(newAssignments);
        rebuildAutomation(project, takes, newBoundaries, newAssignments, crossfadeMs);
      } else {
        // Position playhead
        project.engine.setPosition(ppqnPos);
        setCurrentPosition(ppqnPos);
        if (pausedPositionRef) pausedPositionRef.current = ppqnPos;
      }
    },
    [project, takes, isPlaying, compBoundaries, compAssignments, crossfadeMs, rebuildAutomation, setCurrentPosition, pausedPositionRef]
  );

  const setZoneTake = useCallback(
    (zone: number, takeIndex: number) => {
      if (!project || takes.length === 0) return;
      const newAssignments = [...compAssignments];
      newAssignments[zone] = takeIndex;
      setCompAssignments(newAssignments);
      rebuildAutomation(project, takes, compBoundaries, newAssignments, crossfadeMs);
    },
    [project, takes, compBoundaries, compAssignments, crossfadeMs, rebuildAutomation]
  );

  const handleCrossfadeChange = useCallback(
    (ms: number) => {
      setCrossfadeMs(ms);
      if (project && takes.length > 0) {
        rebuildAutomation(project, takes, compBoundaries, compAssignments, ms);
      }
    },
    [project, takes, compBoundaries, compAssignments, rebuildAutomation]
  );

  // ─── Waveform rendering ───
  const drawWaveform = useCallback(
    (canvas: HTMLCanvasElement, takeIndex: number) => {
      if (!canvas || takes.length === 0) return;
      const take = takes[takeIndex];
      const uuidString = UUID.toString(take.trackData.uuid);
      const audioBuffer = localAudioBuffersRef.current.get(uuidString);
      if (!audioBuffer) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, w, h);

      const data = audioBuffer.getChannelData(0);
      const sr = audioBuffer.sampleRate;
      const startSample = Math.floor((playbackStartRef.current / (BEAT * 4)) * (60 / BPM) * sr) + Math.floor((take.offset / (BEAT * 4)) * (60 / BPM) * sr);
      const durationSamples = Math.floor(PPQN.pulsesToSeconds(TOTAL_PPQN, BPM) * sr);
      const endSample = Math.min(startSample + durationSamples, data.length);
      const totalSamples = endSample - startSample;
      const step = Math.ceil(totalSamples / w);

      ctx.fillStyle = take.color;
      for (let x = 0; x < w; x++) {
        const s = startSample + x * step;
        let min = 0, max = 0;
        for (let j = s; j < s + step && j < endSample; j++) {
          if (data[j] < min) min = data[j];
          if (data[j] > max) max = data[j];
        }
        const yMin = (1 + min) * h / 2;
        const yMax = (1 + max) * h / 2;
        ctx.fillRect(x, yMax, 1, Math.max(1, yMin - yMax));
      }
    },
    [takes]
  );

  // Draw waveforms when takes change
  useEffect(() => {
    if (takes.length === 0) return;
    requestAnimationFrame(() => {
      for (let i = 0; i < takes.length; i++) {
        const canvas = canvasRefs.current.get(i);
        if (canvas) drawWaveform(canvas, i);
      }
    });
  }, [takes, drawWaveform]);

  // ─── Drag and drop ───
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) handleFile(file);
  }, [handleFile]);

  // ─── Initialize OpenDAW ───
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const localAudioBuffers = localAudioBuffersRef.current;
        const { project: p, audioContext: ac } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: (s) => { if (mounted) setStatus(s); }
        });
        if (mounted) {
          setProject(p);
          setAudioContext(ac);
          setStatus("ready-for-audio");
        }
      } catch (error) {
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ─── Pre-audio loading screen ───
  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Comp Lanes Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  const hasTakes = takes.length > 0;
  const isLoading = hasTakes && !status.startsWith("Ready");
  const playbackStart = playbackStartRef.current;
  const zoneBounds = [playbackStart, ...compBoundaries, playbackStart + TOTAL_PPQN];

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>

          {/* Loading overlay */}
          {isLoading && (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", zIndex: 9999, gap: "20px"
            }}>
              <div style={{
                width: "50px", height: "50px", border: "4px solid var(--gray-6)",
                borderTop: "4px solid var(--green-9)", borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
              <Text size="5" weight="bold">{status}</Text>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Header */}
          <Flex direction="column" gap="4">
            <BackLink />
            <Heading size="8">Comp Lanes Demo</Heading>
            <Text size="4" color="gray">
              Simulated takes from different sections of the same audio file. Shift+Click
              to add comp boundaries, select which take is active per zone. Crossfades use
              volume automation with equal-power curves — no region splitting, no pops.
            </Text>
          </Flex>

          {/* Audio source selection */}
          {!hasTakes && (
            <Card>
              <Flex direction="column" gap="4" align="center">
                <Heading size="4">Choose Audio</Heading>
                <div
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: "100%", padding: "48px 24px",
                    border: `2px dashed ${isDragOver ? "var(--green-9)" : "var(--gray-7)"}`,
                    borderRadius: "var(--radius-3)",
                    backgroundColor: isDragOver ? "var(--green-2)" : "var(--gray-2)",
                    cursor: "pointer", textAlign: "center", transition: "all 0.2s ease"
                  }}
                >
                  <Flex direction="column" gap="2" align="center">
                    <Text size="6">{isDragOver ? "Drop it!" : "Drop an audio file here"}</Text>
                    <Text size="2" color="gray">or click to browse</Text>
                  </Flex>
                  <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </div>
                <Flex align="center" gap="3" style={{ width: "100%" }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--gray-6)" }} />
                  <Text size="2" color="gray">or</Text>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--gray-6)" }} />
                </Flex>
                <Button size="3" variant="soft" onClick={handleLoadDemo}>
                  Use demo vocals (Dark Ride)
                </Button>
              </Flex>
            </Card>
          )}

          {/* Instructions */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="3">
                <Heading size="4">How to Use</Heading>
                <Flex direction="column" gap="2">
                  <Text size="2"><strong>1. Shift+Click on the lanes</strong> to add a comp boundary</Text>
                  <Text size="2"><strong>2. Select active take</strong> per zone using the buttons below</Text>
                  <Text size="2"><strong>3. Press Play</strong> to hear the comp with crossfades</Text>
                </Flex>
                <Callout.Root size="1" color="blue">
                  <Callout.Text>Refresh to start over. Crossfades use volume automation — no region splitting.</Callout.Text>
                </Callout.Root>
              </Flex>
            </Card>
          )}

          {/* Controls */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center">
                  <Heading size="4">Transport</Heading>
                  <Flex gap="3" align="center">
                    <label style={{ fontSize: "14px", color: "var(--gray-11)" }}>
                      Crossfade:{" "}
                      <input type="number" value={crossfadeMs} min={0} max={200} step={5}
                        onChange={(e) => handleCrossfadeChange(parseInt(e.target.value) || 0)}
                        style={{ width: "60px", background: "var(--gray-3)", color: "var(--gray-12)",
                          border: "1px solid var(--gray-7)", padding: "4px 8px", borderRadius: "4px" }}
                      /> ms
                    </label>
                    <Badge size="2" color="green" variant="soft">
                      {compBoundaries.length + 1} zone{compBoundaries.length > 0 ? "s" : ""}
                    </Badge>
                  </Flex>
                </Flex>
                <TransportControls
                  isPlaying={isPlaying} currentPosition={currentPosition} bpm={BPM}
                  onPlay={handlePlay} onPause={handlePause} onStop={handleStop}
                />
                <Text size="2" color="gray">
                  Position: {PPQN.pulsesToSeconds(currentPosition, BPM).toFixed(2)}s ({currentPosition} PPQN)
                </Text>
              </Flex>
            </Card>
          )}

          {/* Take lanes */}
          {hasTakes && (
            <Card>
              <Flex direction="column" gap="4">
                <Heading size="4">Take Lanes</Heading>
                <div
                  onClick={handleLaneClick}
                  style={{ position: "relative", cursor: isPlaying ? "default" : "crosshair",
                    border: "1px solid var(--gray-6)", borderRadius: "var(--radius-3)", overflow: "hidden" }}
                >
                  {takes.map((take, i) => (
                    <div key={i} style={{ position: "relative", height: "60px", borderBottom: i < takes.length - 1 ? "1px solid var(--gray-6)" : "none" }}>
                      <canvas
                        ref={(el) => { if (el) canvasRefs.current.set(i, el); }}
                        style={{ width: "100%", height: "100%", display: "block" }}
                      />
                      <div style={{ position: "absolute", left: 8, top: 4, fontSize: "11px", color: "rgba(255,255,255,0.7)", pointerEvents: "none" }}>
                        {take.label}
                      </div>
                      {/* Active zone highlights */}
                      {compAssignments.map((assignedTake, z) => {
                        if (assignedTake !== i) return null;
                        const zoneStart = zoneBounds[z];
                        const zoneEnd = zoneBounds[z + 1];
                        const left = ((zoneStart - playbackStart) / TOTAL_PPQN) * 100;
                        const width = ((zoneEnd - zoneStart) / TOTAL_PPQN) * 100;
                        return (
                          <div key={z} style={{
                            position: "absolute", top: 0, bottom: 0,
                            left: `${left}%`, width: `${width}%`,
                            background: take.color, opacity: 0.3, pointerEvents: "none"
                          }} />
                        );
                      })}
                    </div>
                  ))}

                  {/* Comp boundary lines */}
                  {compBoundaries.map((b, i) => {
                    const frac = ((b - playbackStart) / TOTAL_PPQN) * 100;
                    return (
                      <div key={`b-${i}`} style={{
                        position: "absolute", top: 0, bottom: 0, left: `${frac}%`,
                        width: 0, borderLeft: "1.5px dashed rgba(255, 180, 80, 0.6)",
                        pointerEvents: "none", zIndex: 5
                      }} />
                    );
                  })}

                  {/* Playhead */}
                  {currentPosition >= playbackStart && (
                    <div style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: `${((currentPosition - playbackStart) / TOTAL_PPQN) * 100}%`,
                      width: "2px", background: "#fff", pointerEvents: "none", zIndex: 10
                    }} />
                  )}
                </div>

                {/* Zone take selectors */}
                <Flex direction="column" gap="2">
                  {zoneBounds.slice(0, -1).map((_, z) => {
                    const startSec = PPQN.pulsesToSeconds(zoneBounds[z], BPM).toFixed(2);
                    const endSec = PPQN.pulsesToSeconds(zoneBounds[z + 1], BPM).toFixed(2);
                    return (
                      <Flex key={z} gap="2" align="center">
                        <Text size="1" color="gray" style={{ width: "140px" }}>
                          Zone {z + 1} ({startSec}s–{endSec}s)
                        </Text>
                        {takes.map((take, t) => (
                          <Button
                            key={t} size="1" variant={compAssignments[z] === t ? "solid" : "soft"}
                            style={compAssignments[z] === t ? { background: take.color, borderColor: take.color } : {}}
                            onClick={() => setZoneTake(z, t)}
                          >
                            {take.label}
                          </Button>
                        ))}
                      </Flex>
                    );
                  })}
                </Flex>
              </Flex>
            </Card>
          )}

          {/* Footer */}
          <Flex justify="center" pt="6">
            <MoisesLogo />
          </Flex>
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");
createRoot(rootElement).render(<App />);
```

- [ ] **Step 2: Verify the demo loads in the browser**

Run: `npm run dev`
Navigate to: `http://localhost:5173/comp-lanes-demo.html`
Expected: The demo loads, shows the drop zone. Drop an audio file or click "Use demo vocals" — 3 take lanes should render with waveforms.

- [ ] **Step 3: Test the comp interaction**

1. Shift+Click on the lanes to add a comp boundary
2. Click zone buttons to switch active take per zone
3. Press Play — should hear take switching at boundaries with crossfade
4. Adjust crossfade ms and replay — should hear smoother/sharper transitions
5. Verify no pops at comp boundaries

- [ ] **Step 4: Commit**

```bash
git add src/demos/playback/comp-lanes-demo.tsx
git commit -m "feat: add comp lanes demo with volume automation crossfades"
```

---

### Task 3: Build Verification

**Files:** (none — verification only)

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Final manual test**

Test checklist:
1. Page loads and shows drop zone
2. Drop audio file — 3 take lanes render
3. "Use demo vocals" — loads Dark Ride vocals
4. Click positions playhead
5. Shift+Click adds comp boundary with dashed line
6. Zone buttons switch active take, lane highlights update
7. Play — hear comp with crossfades, no pops
8. Adjusting crossfade ms changes transition
9. Index page shows "Comp Lanes" card

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "feat: comp lanes demo complete"
```
