# Export Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a demo page showcasing range-bounded audio export with three modes: metronome-only, clean selected stems, and single stem + metronome.

**Architecture:** Multi-pass offline rendering using `OfflineEngineRenderer.create()` + `step()` for precise range export. Each export mode mutates project state (mutes, metronome), creates a renderer (which serializes the snapshot), then restores state. Results are previewed in-browser via `AudioBufferSourceNode` and downloadable as WAV via `WavFile.encodeFloats()`.

**Tech Stack:** React, Radix UI Theme, OpenDAW SDK (`OfflineEngineRenderer`, `WavFile`, `PPQN`), Vite

---

### Task 1: Install OfflineEngineRenderer worker URL

**Files:**
- Modify: `src/lib/projectSetup.ts`

- [ ] **Step 1: Add the offline engine worker import**

In `src/lib/projectSetup.ts`, add the import for the offline engine worker URL next to the existing worker imports (after line 22):

```typescript
import OfflineEngineUrl from "@opendaw/studio-core/offline-engine.js?worker&url";
```

- [ ] **Step 2: Add the OfflineEngineRenderer import**

Add `OfflineEngineRenderer` to the existing `@opendaw/studio-core` import (line 6):

```typescript
import {
  AudioWorklets,
  GlobalSampleLoaderManager,
  GlobalSoundfontLoaderManager,
  OpenSoundfontAPI,
  Project,
  Workers,
  SampleProvider,
  SoundfontProvider,
  SampleService,
  OfflineEngineRenderer,
} from "@opendaw/studio-core";
```

- [ ] **Step 3: Call install after Workers.install**

After line 124 (`AudioWorklets.install(WorkletsUrl);`), add:

```typescript
  OfflineEngineRenderer.install(OfflineEngineUrl);
```

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build 2>&1 | tail -5`
Expected: Build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projectSetup.ts
git commit -m "feat: install OfflineEngineRenderer worker URL in project setup"
```

---

### Task 2: Create rangeExport.ts utility

**Files:**
- Create: `src/lib/rangeExport.ts`

- [ ] **Step 1: Create the range export utility module**

Create `src/lib/rangeExport.ts` with the following content:

```typescript
import { Project, OfflineEngineRenderer } from "@opendaw/studio-core";
import { WavFile, PPQN, ppqn } from "@opendaw/lib-dsp";
import { Option, UUID } from "@opendaw/lib-std";
import type { ExportStemsConfiguration } from "@opendaw/studio-adapters";
import type { TrackData } from "./types";

export interface ExportResult {
  label: string;
  channels: Float32Array[];
  sampleRate: number;
  durationSeconds: number;
}

interface RangeExportOptions {
  project: Project;
  startPpqn: ppqn;
  endPpqn: ppqn;
  sampleRate?: number;
}

/**
 * Snapshot mutable project state, run a callback, then restore.
 * The callback receives the project with mutated state — the renderer
 * serializes the project on creation, so restoration is safe after that.
 */
async function withProjectState<T>(
  project: Project,
  mutate: () => void,
  restore: () => void,
  action: () => Promise<T>
): Promise<T> {
  mutate();
  try {
    return await action();
  } finally {
    restore();
  }
}

/**
 * Core render function: create renderer, set position, step exact samples.
 */
async function renderRange(
  project: Project,
  exportConfig: Option<ExportStemsConfiguration>,
  startPpqn: ppqn,
  endPpqn: ppqn,
  sampleRate: number
): Promise<Float32Array[]> {
  const renderer = await OfflineEngineRenderer.create(project, exportConfig, sampleRate);
  try {
    await renderer.waitForLoading();
    renderer.setPosition(startPpqn);
    renderer.play();
    const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
    const numSamples = Math.ceil(durationSeconds * sampleRate);
    const channels = await renderer.step(numSamples);
    return channels;
  } finally {
    renderer.terminate();
  }
}

/**
 * Get all AudioUnitBox mute states, and functions to mute all / restore.
 */
function createMuteHelper(project: Project, tracks: TrackData[]) {
  const originalMutes = new Map<string, boolean>();
  for (const track of tracks) {
    originalMutes.set(
      UUID.toString(track.audioUnitBox.address.uuid),
      track.audioUnitBox.mute.getValue()
    );
  }

  return {
    muteAll() {
      project.editing.modify(() => {
        for (const track of tracks) {
          track.audioUnitBox.mute.setValue(true);
        }
      });
    },
    muteAllExcept(keepUuid: string) {
      project.editing.modify(() => {
        for (const track of tracks) {
          const uuid = UUID.toString(track.audioUnitBox.address.uuid);
          track.audioUnitBox.mute.setValue(uuid !== keepUuid);
        }
      });
    },
    restore() {
      project.editing.modify(() => {
        for (const track of tracks) {
          const uuid = UUID.toString(track.audioUnitBox.address.uuid);
          track.audioUnitBox.mute.setValue(originalMutes.get(uuid) ?? false);
        }
      });
    },
  };
}

/**
 * Save and restore metronome state.
 */
function createMetronomeHelper(project: Project) {
  const settings = project.engine.preferences.settings;
  const wasEnabled = settings.metronome.enabled;
  const previousGain = settings.metronome.gain;

  return {
    enable(gain?: number) {
      settings.metronome.enabled = true;
      if (gain !== undefined) settings.metronome.gain = gain;
    },
    disable() {
      settings.metronome.enabled = false;
    },
    restore() {
      settings.metronome.enabled = wasEnabled;
      settings.metronome.gain = previousGain;
    },
  };
}

/**
 * Mode 1: Export metronome only for a range.
 * Mutes all tracks, enables metronome, renders via Option.None (mixdown path).
 */
export async function exportMetronomeOnly(
  options: RangeExportOptions & { tracks: TrackData[]; metronomeGain?: number }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, metronomeGain } = options;
  const muteHelper = createMuteHelper(project, tracks);
  const metronomeHelper = createMetronomeHelper(project);

  const channels = await withProjectState(
    project,
    () => {
      muteHelper.muteAll();
      metronomeHelper.enable(metronomeGain);
    },
    () => {
      muteHelper.restore();
      metronomeHelper.restore();
    },
    () => renderRange(project, Option.None, startPpqn, endPpqn, sampleRate)
  );

  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  return { label: "Metronome", channels, sampleRate, durationSeconds };
}

/**
 * Mode 2: Export clean stems for a range (selected tracks only).
 * Disables metronome, renders via ExportStemsConfiguration.
 */
export async function exportStemsRange(
  options: RangeExportOptions & { tracks: TrackData[]; selectedUuids: string[] }
): Promise<ExportResult[]> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, selectedUuids } = options;
  const metronomeHelper = createMetronomeHelper(project);

  // Build ExportStemsConfiguration for selected tracks only
  const selectedTracks = tracks.filter((t) =>
    selectedUuids.includes(UUID.toString(t.audioUnitBox.address.uuid))
  );
  const exportConfig: ExportStemsConfiguration = {};
  for (const track of selectedTracks) {
    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
    exportConfig[uuid] = {
      includeAudioEffects: true,
      includeSends: true,
      useInstrumentOutput: true,
      fileName: track.name,
    };
  }

  const channels = await withProjectState(
    project,
    () => metronomeHelper.disable(),
    () => metronomeHelper.restore(),
    () => renderRange(project, Option.wrap(exportConfig), startPpqn, endPpqn, sampleRate)
  );

  // Split interleaved channels into per-stem results
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  const results: ExportResult[] = [];
  for (let i = 0; i < selectedTracks.length; i++) {
    const left = channels[i * 2];
    const right = channels[i * 2 + 1];
    if (left && right) {
      results.push({
        label: selectedTracks[i].name,
        channels: [left, right],
        sampleRate,
        durationSeconds,
      });
    }
  }
  return results;
}

/**
 * Mode 3: Export single stem + metronome for a range.
 * Mutes all tracks except selected, enables metronome, renders via Option.None.
 */
export async function exportStemWithMetronome(
  options: RangeExportOptions & {
    tracks: TrackData[];
    audioUnitUuid: string;
    metronomeGain?: number;
  }
): Promise<ExportResult> {
  const { project, startPpqn, endPpqn, sampleRate = 48000, tracks, audioUnitUuid, metronomeGain } =
    options;
  const muteHelper = createMuteHelper(project, tracks);
  const metronomeHelper = createMetronomeHelper(project);

  const channels = await withProjectState(
    project,
    () => {
      muteHelper.muteAllExcept(audioUnitUuid);
      metronomeHelper.enable(metronomeGain);
    },
    () => {
      muteHelper.restore();
      metronomeHelper.restore();
    },
    () => renderRange(project, Option.None, startPpqn, endPpqn, sampleRate)
  );

  const selectedTrack = tracks.find(
    (t) => UUID.toString(t.audioUnitBox.address.uuid) === audioUnitUuid
  );
  const durationSeconds = project.tempoMap.intervalToSeconds(startPpqn, endPpqn);
  return {
    label: `${selectedTrack?.name ?? "Track"} + Metronome`,
    channels,
    sampleRate,
    durationSeconds,
  };
}

/**
 * Create an AudioBuffer from Float32Array channels for in-browser preview.
 */
export function channelsToAudioBuffer(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buffer = new AudioBuffer({
    length,
    numberOfChannels: channels.length,
    sampleRate,
  });
  for (let i = 0; i < channels.length; i++) {
    buffer.copyToChannel(channels[i], i);
  }
  return buffer;
}

/**
 * Encode channels to WAV and trigger browser download.
 */
export function downloadAsWav(
  channels: Float32Array[],
  sampleRate: number,
  fileName: string
): void {
  const audioBuffer = channelsToAudioBuffer(channels, sampleRate);
  const wavArrayBuffer = WavFile.encodeFloats(audioBuffer);
  const blob = new Blob([wavArrayBuffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.wav`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build 2>&1 | tail -5`
Expected: Build completes without errors. (The module is not imported yet, but Vite will tree-shake it — this confirms there are no syntax errors.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/rangeExport.ts
git commit -m "feat: add range export utility with metronome, stems, and stem+metronome modes"
```

---

### Task 3: Create export-demo.html entry point

**Files:**
- Create: `export-demo.html`

- [ ] **Step 1: Create the HTML entry point**

Create `export-demo.html` in the project root:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Export Demo - OpenDAW</title>
    <meta name="description" content="Export audio with range selection and metronome control using OpenDAW's offline rendering API." />
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
    <script type="module" src="/src/export-demo.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add export-demo.html
git commit -m "feat: add export demo HTML entry point"
```

---

### Task 4: Register build entry and index card

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/index.tsx`

- [ ] **Step 1: Add build entry to vite.config.ts**

In `vite.config.ts`, add the export entry to `rollupOptions.input` after the `werkstatt` line (line 39):

```typescript
                werkstatt: resolve(__dirname, "werkstatt-demo.html"),
                export: resolve(__dirname, "export-demo.html")
```

- [ ] **Step 2: Add demo card to src/index.tsx**

In `src/index.tsx`, add a new card inside the grid `<div>` after the Werkstatt card (before the closing `</div>` at line 250):

```tsx
            <Card asChild>
              <Link href="/export-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">📦</Text>
                    <Heading size="5">Audio Export</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Export audio with range selection and metronome control. Render metronome-only,
                    clean stems, or stem + metronome mixes for any bar range using offline rendering.
                  </Text>
                </Flex>
              </Link>
            </Card>
```

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts src/index.tsx
git commit -m "feat: register export demo in build config and index page"
```

---

### Task 5: Create export-demo.tsx — initialization and track loading

**Files:**
- Create: `src/export-demo.tsx`

- [ ] **Step 1: Create the main demo file with initialization logic**

Create `src/export-demo.tsx`:

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TransportControls } from "./components/TransportControls";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
import {
  exportMetronomeOnly,
  exportStemsRange,
  exportStemWithMetronome,
  channelsToAudioBuffer,
  downloadAsWav,
  type ExportResult,
} from "./lib/rangeExport";
import type { TrackData } from "./lib/types";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Button,
  Select,
  Slider,
  Switch,
  TextField,
  Separator,
  Badge,
  Callout,
  CheckboxGroup,
} from "@radix-ui/themes";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840

interface PreviewResult extends ExportResult {
  audioBuffer: AudioBuffer;
}

const App: React.FC = () => {
  // --- Initialization state ---
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);

  // --- Transport ---
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  // --- Metronome settings ---
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeGain, setMetronomeGain] = useState(-6);

  // --- Range selection ---
  const [startBar, setStartBar] = useState(1);
  const [endBar, setEndBar] = useState(1);
  const [maxBar, setMaxBar] = useState(1);

  // --- Stem selection ---
  const [selectedStemUuids, setSelectedStemUuids] = useState<string[]>([]);
  const [stemWithMetronomeUuid, setStemWithMetronomeUuid] = useState<string>("");

  // --- Export state ---
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [results, setResults] = useState<PreviewResult[]>([]);

  // --- Preview playback ---
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [playingPreviewIndex, setPlayingPreviewIndex] = useState<number | null>(null);

  // --- Initialize project and load tracks ---
  useEffect(() => {
    let mounted = true;
    const localAudioBuffers = new Map<string, AudioBuffer>();

    (async () => {
      try {
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: (s) => mounted && setStatus(s),
        });

        const ext = getAudioExtension();
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [
            { name: "Intro", file: `/audio/DarkRide/01_Intro.${ext}` },
            { name: "Vocals", file: `/audio/DarkRide/06_Vox.${ext}` },
            { name: "Guitar Lead", file: `/audio/DarkRide/05_ElecGtrsLead.${ext}` },
            { name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
            { name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` },
            { name: "Bass", file: `/audio/DarkRide/03_Bass.${ext}` },
            { name: "Effect Returns", file: `/audio/DarkRide/07_EffectReturns.${ext}` },
          ],
          localAudioBuffers,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            },
          }
        );

        if (!mounted) return;

        // Calculate max bar from last region
        const lastPpqn = newProject.lastRegionAction();
        const totalBars = Math.ceil(lastPpqn / BAR);
        setMaxBar(totalBars);
        setEndBar(totalBars);

        // Default: all stems selected
        const uuids = loadedTracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid));
        setSelectedStemUuids(uuids);
        setStemWithMetronomeUuid(uuids[0] ?? "");

        setProject(newProject);
        setAudioContext(newAudioContext);
        setTracks(loadedTracks);
        setStatus("Ready");
      } catch (error) {
        if (mounted) setStatus(`Error: ${error}`);
        console.error(error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // --- Sync metronome toggle to engine preferences ---
  useEffect(() => {
    if (!project) return;
    project.engine.preferences.settings.metronome.enabled = metronomeEnabled;
  }, [project, metronomeEnabled]);

  useEffect(() => {
    if (!project) return;
    project.engine.preferences.settings.metronome.gain = metronomeGain;
  }, [project, metronomeGain]);

  // --- Range to PPQN helpers ---
  const startPpqn = ((startBar - 1) * BAR) as import("@opendaw/lib-dsp").ppqn;
  const endPpqn = (endBar * BAR) as import("@opendaw/lib-dsp").ppqn;
  const rangeDurationSeconds = project
    ? project.tempoMap.intervalToSeconds(startPpqn, endPpqn)
    : 0;

  // --- Export handlers ---
  const handleExportMetronome = useCallback(async () => {
    if (!project || !audioContext) return;
    setIsExporting(true);
    setExportStatus("Rendering metronome...");
    try {
      const result = await exportMetronomeOnly({
        project,
        startPpqn,
        endPpqn,
        tracks,
        metronomeGain,
      });
      const audioBuffer = channelsToAudioBuffer(result.channels, result.sampleRate);
      setResults((prev) => [...prev, { ...result, audioBuffer }]);
      setExportStatus("Metronome export complete");
    } catch (error) {
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, metronomeGain]);

  const handleExportStems = useCallback(async () => {
    if (!project || !audioContext || selectedStemUuids.length === 0) return;
    setIsExporting(true);
    setExportStatus("Rendering stems...");
    try {
      const stemResults = await exportStemsRange({
        project,
        startPpqn,
        endPpqn,
        tracks,
        selectedUuids: selectedStemUuids,
      });
      const previewResults = stemResults.map((r) => ({
        ...r,
        audioBuffer: channelsToAudioBuffer(r.channels, r.sampleRate),
      }));
      setResults((prev) => [...prev, ...previewResults]);
      setExportStatus(`Exported ${stemResults.length} stem(s)`);
    } catch (error) {
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, selectedStemUuids]);

  const handleExportStemWithMetronome = useCallback(async () => {
    if (!project || !audioContext || !stemWithMetronomeUuid) return;
    setIsExporting(true);
    setExportStatus("Rendering stem + metronome...");
    try {
      const result = await exportStemWithMetronome({
        project,
        startPpqn,
        endPpqn,
        tracks,
        audioUnitUuid: stemWithMetronomeUuid,
        metronomeGain,
      });
      const audioBuffer = channelsToAudioBuffer(result.channels, result.sampleRate);
      setResults((prev) => [...prev, { ...result, audioBuffer }]);
      setExportStatus("Stem + metronome export complete");
    } catch (error) {
      setExportStatus(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
    }
  }, [project, audioContext, startPpqn, endPpqn, tracks, stemWithMetronomeUuid, metronomeGain]);

  // --- Preview playback ---
  const stopPreview = useCallback(() => {
    if (previewSourceRef.current) {
      previewSourceRef.current.stop();
      previewSourceRef.current.disconnect();
      previewSourceRef.current = null;
    }
    setPlayingPreviewIndex(null);
  }, []);

  const playPreview = useCallback(
    (index: number) => {
      if (!audioContext) return;
      stopPreview();
      const result = results[index];
      if (!result) return;
      const source = audioContext.createBufferSource();
      source.buffer = result.audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => setPlayingPreviewIndex(null);
      source.start();
      previewSourceRef.current = source;
      setPlayingPreviewIndex(index);
    },
    [audioContext, results, stopPreview]
  );

  // --- Format helpers ---
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1);
    return `${m}:${s.padStart(4, "0")}`;
  };

  const formatFileSize = (channels: Float32Array[]) => {
    // WAV: 44 byte header + samples * 4 bytes (32-bit float) * channels
    const bytes = 44 + (channels[0]?.length ?? 0) * 4 * channels.length;
    return bytes > 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(0)} KB`;
  };

  // --- Loading state ---
  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="3" px="4" py="8">
          <Flex direction="column" align="center" gap="4" style={{ paddingTop: 100 }}>
            <Heading size="6">{status}</Heading>
          </Flex>
        </Container>
      </Theme>
    );
  }

  const currentBar = Math.floor(currentPosition / BAR) + 1;

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Header */}
          <Flex direction="column" gap="3">
            <Heading size="8">Audio Export Demo</Heading>
            <Text size="4" color="gray">
              Export audio with range selection and metronome control using OpenDAW's offline
              rendering API
            </Text>
          </Flex>

          {/* Transport */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Transport</Heading>
              <Flex align="center" gap="3">
                <TransportControls
                  isPlaying={isPlaying}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onStop={handleStop}
                />
                <Text size="2" color="gray">
                  Bar {currentBar} | {BPM} BPM
                </Text>
              </Flex>
            </Flex>
          </Card>

          {/* Metronome Settings */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Metronome</Heading>
              <Flex align="center" gap="3">
                <Text as="label" size="2">
                  <Flex gap="2" align="center">
                    <Switch
                      checked={metronomeEnabled}
                      onCheckedChange={setMetronomeEnabled}
                    />
                    Enable Metronome
                  </Flex>
                </Text>
              </Flex>
              <Flex align="center" gap="3">
                <Text size="2" style={{ minWidth: 80 }}>
                  Gain: {metronomeGain} dB
                </Text>
                <Slider
                  min={-60}
                  max={0}
                  step={1}
                  value={[metronomeGain]}
                  onValueChange={([v]) => setMetronomeGain(v)}
                  style={{ flex: 1 }}
                />
              </Flex>
            </Flex>
          </Card>

          {/* Range Selection */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Range Selection</Heading>
              <Flex align="center" gap="3">
                <Text size="2">Start Bar:</Text>
                <TextField.Root
                  type="number"
                  value={String(startBar)}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(endBar, parseInt(e.target.value) || 1));
                    setStartBar(v);
                  }}
                  style={{ width: 80 }}
                />
                <Text size="2">End Bar:</Text>
                <TextField.Root
                  type="number"
                  value={String(endBar)}
                  onChange={(e) => {
                    const v = Math.max(startBar, Math.min(maxBar, parseInt(e.target.value) || 1));
                    setEndBar(v);
                  }}
                  style={{ width: 80 }}
                />
                <Text size="2" color="gray">
                  / {maxBar} bars
                </Text>
              </Flex>
              <Text size="2" color="gray">
                Duration: {formatDuration(rangeDurationSeconds)} | Bars {startBar}-{endBar} (
                {endBar - startBar + 1} bars)
              </Text>
            </Flex>
          </Card>

          <Separator size="4" />

          {/* Export Mode 1: Metronome Only */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Metronome Only</Heading>
              <Text size="2" color="gray">
                Renders only metronome clicks for the selected range (all tracks muted).
              </Text>
              <Button onClick={handleExportMetronome} disabled={isExporting}>
                Export Metronome
              </Button>
            </Flex>
          </Card>

          {/* Export Mode 2: Clean Stems */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Clean Stems</Heading>
              <Text size="2" color="gray">
                Renders selected tracks as individual stems (no metronome).
              </Text>
              <CheckboxGroup.Root
                value={selectedStemUuids}
                onValueChange={setSelectedStemUuids}
              >
                <Flex direction="column" gap="2">
                  {tracks.map((track) => {
                    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
                    return (
                      <CheckboxGroup.Item key={uuid} value={uuid}>
                        {track.name}
                      </CheckboxGroup.Item>
                    );
                  })}
                </Flex>
              </CheckboxGroup.Root>
              <Flex gap="2">
                <Button
                  variant="soft"
                  size="1"
                  onClick={() =>
                    setSelectedStemUuids(
                      tracks.map((t) => UUID.toString(t.audioUnitBox.address.uuid))
                    )
                  }
                >
                  Select All
                </Button>
                <Button variant="soft" size="1" onClick={() => setSelectedStemUuids([])}>
                  Deselect All
                </Button>
              </Flex>
              <Button
                onClick={handleExportStems}
                disabled={isExporting || selectedStemUuids.length === 0}
              >
                Export {selectedStemUuids.length} Stem(s)
              </Button>
            </Flex>
          </Card>

          {/* Export Mode 3: Stem + Metronome */}
          <Card>
            <Flex direction="column" gap="3" p="4">
              <Heading size="4">Export Stem + Metronome</Heading>
              <Text size="2" color="gray">
                Renders a single track mixed with metronome clicks for the selected range.
              </Text>
              <Select.Root value={stemWithMetronomeUuid} onValueChange={setStemWithMetronomeUuid}>
                <Select.Trigger placeholder="Select track..." />
                <Select.Content>
                  {tracks.map((track) => {
                    const uuid = UUID.toString(track.audioUnitBox.address.uuid);
                    return (
                      <Select.Item key={uuid} value={uuid}>
                        {track.name}
                      </Select.Item>
                    );
                  })}
                </Select.Content>
              </Select.Root>
              <Button
                onClick={handleExportStemWithMetronome}
                disabled={isExporting || !stemWithMetronomeUuid}
              >
                Export Stem + Metronome
              </Button>
            </Flex>
          </Card>

          {/* Export Status */}
          {exportStatus && (
            <Callout.Root>
              <Callout.Text>{exportStatus}</Callout.Text>
            </Callout.Root>
          )}

          <Separator size="4" />

          {/* Results */}
          {results.length > 0 && (
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Heading size="4">Export Results</Heading>
                <Button
                  variant="soft"
                  color="red"
                  size="1"
                  onClick={() => {
                    stopPreview();
                    setResults([]);
                  }}
                >
                  Clear All
                </Button>
              </Flex>
              {results.map((result, index) => (
                <Card key={index}>
                  <Flex direction="column" gap="2" p="3">
                    <Flex justify="between" align="center">
                      <Text weight="bold">{result.label}</Text>
                      <Flex gap="2">
                        <Badge size="1" variant="soft">
                          {formatDuration(result.durationSeconds)}
                        </Badge>
                        <Badge size="1" variant="soft">
                          {result.sampleRate / 1000}kHz
                        </Badge>
                        <Badge size="1" variant="soft">
                          {formatFileSize(result.channels)}
                        </Badge>
                      </Flex>
                    </Flex>
                    <Flex gap="2">
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() =>
                          playingPreviewIndex === index ? stopPreview() : playPreview(index)
                        }
                      >
                        {playingPreviewIndex === index ? "Stop" : "Play"}
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() =>
                          downloadAsWav(
                            result.channels,
                            result.sampleRate,
                            result.label.replace(/[^a-zA-Z0-9-_]/g, "_")
                          )
                        }
                      >
                        Download WAV
                      </Button>
                    </Flex>
                  </Flex>
                </Card>
              ))}
            </Flex>
          )}

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build 2>&1 | tail -10`
Expected: Build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add src/export-demo.tsx
git commit -m "feat: add export demo page with metronome, stems, and stem+metronome modes"
```

---

### Task 6: Manual testing and fixes

- [ ] **Step 1: Start dev server and test**

Run: `npm run dev`

Open `https://localhost:5173/export-demo.html` in a browser.

Verify:
1. Page loads, Dark Ride stems load successfully
2. Transport controls work (play/pause/stop)
3. Metronome toggle enables/disables clicks during live playback
4. Range inputs constrain properly (start <= end, end <= max)

- [ ] **Step 2: Test Mode 1 — Metronome export**

1. Set range to bars 25-33 (where drums have full patterns)
2. Click "Export Metronome"
3. Verify a result appears with correct duration
4. Click "Play" — should hear metronome clicks only
5. Click "Download WAV" — should download a WAV file

- [ ] **Step 3: Test Mode 2 — Clean stems export**

1. Deselect all, then select only "Drums" and "Bass"
2. Click "Export 2 Stem(s)"
3. Verify 2 results appear (Drums and Bass)
4. Play each — should hear the individual track without metronome

- [ ] **Step 4: Test Mode 3 — Stem + metronome export**

1. Select "Drums" from the dropdown
2. Click "Export Stem + Metronome"
3. Play the result — should hear drums mixed with metronome clicks

- [ ] **Step 5: Fix any issues found during testing**

Address any build errors, runtime errors, or UI issues discovered.

- [ ] **Step 6: Commit fixes if any**

```bash
git add -A
git commit -m "fix: address issues found during export demo manual testing"
```

---

### Task 7: Build verification

- [ ] **Step 1: Run production build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build completes without errors and includes the export demo in the output.

- [ ] **Step 2: Verify no regressions**

Run: `npm run build 2>&1 | grep -E "(error|warning)" | head -20`
Expected: No new errors or warnings compared to before.

- [ ] **Step 3: Final commit if needed**

If any build fixes were needed:

```bash
git add -A
git commit -m "fix: resolve build issues for export demo"
```
