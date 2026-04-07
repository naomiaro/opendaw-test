# Region Slice Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-track demo that proves the OpenDAW SDK's region splitting + micro-fades produce seamless, click-free audio at splice points.

**Architecture:** Load Dark Ride vocals as one region. User clicks waveform to split via `RegionEditing.cut()`. Each cut auto-applies 128-sample linear fades at boundaries. Playback proves splices are transparent.

**Tech Stack:** React, OpenDAW SDK (`RegionEditing`, `AudioRegionBoxAdapter`, `FadingAdapter`), Radix UI Theme, Vite

---

### Task 1: Create HTML Entry Point

**Files:**
- Create: `region-slice-demo.html`

- [ ] **Step 1: Create the HTML file**

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <!-- Primary Meta Tags -->
    <title>OpenDAW Region Slice Demo - Click-to-Split with Micro-Fades</title>
    <meta name="title" content="OpenDAW Region Slice Demo - Click-to-Split with Micro-Fades" />
    <meta name="description"
        content="Split audio regions by clicking on the waveform. Automatic 128-sample fades at each splice point prove seamless, click-free audio." />
    <meta name="keywords"
        content="OpenDAW, region editing, splitting, fades, crossfade, audio editing, browser DAW" />
    <meta name="author" content="Moises AI" />
    <meta name="theme-color" content="#30a46c" />

    <link rel="canonical" href="https://opendaw-test.pages.dev/region-slice-demo.html" />

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://opendaw-test.pages.dev/region-slice-demo.html" />
    <meta property="og:title" content="OpenDAW Region Slice Demo" />
    <meta property="og:description"
        content="Split audio regions by clicking. Automatic micro-fades prove seamless splicing." />
    <meta property="og:site_name" content="OpenDAW Demos" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="OpenDAW Region Slice Demo" />
    <meta name="twitter:description"
        content="Split audio regions by clicking. Automatic micro-fades prove seamless splicing." />

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
    <script type="module" src="/src/demos/playback/region-slice-demo.tsx"></script>
</body>

</html>
```

- [ ] **Step 2: Commit**

```bash
git add region-slice-demo.html
git commit -m "feat: add region slice demo HTML entry point"
```

---

### Task 2: Add Vite Build Entry and Index Card

**Files:**
- Modify: `vite.config.ts:40` (add entry after `export`)
- Modify: `src/index.tsx:264` (add card before closing `</div>`)

- [ ] **Step 1: Add build entry to vite.config.ts**

Add this line after the `export` entry (line 40) inside `rollupOptions.input`:

```typescript
                regionSlice: resolve(__dirname, "region-slice-demo.html")
```

The input object should end with:

```typescript
                export: resolve(__dirname, "export-demo.html"),
                regionSlice: resolve(__dirname, "region-slice-demo.html")
```

- [ ] **Step 2: Add index card to src/index.tsx**

Add this card before the closing `</div>` on line 265 (after the Audio Export card):

```tsx
            <Card asChild>
              <Link href="/region-slice-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🔪</Text>
                    <Heading size="5">Region Slicing</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Click on a waveform to split regions with automatic 128-sample micro-fades.
                    Play back to verify seamless, click-free audio at every splice point.
                  </Text>
                </Flex>
              </Link>
            </Card>
```

- [ ] **Step 3: Verify dev server starts**

Run: `npm run dev`
Expected: Dev server starts without errors. Navigate to `http://localhost:5173` and see the new "Region Slicing" card. Clicking it navigates to `/region-slice-demo.html` (will be blank until Task 3).

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts src/index.tsx
git commit -m "feat: add region slice demo to build config and index"
```

---

### Task 3: Create the Region Slice Demo Component

**Files:**
- Create: `src/demos/playback/region-slice-demo.tsx`

This is the main demo component. It loads a single vocal track, handles click-to-slice, applies micro-fades, and provides transport controls.

- [ ] **Step 1: Create the demo file**

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { RegionEditing, AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TrackRow } from "@/components/TrackRow";
import { TransportControls } from "@/components/TransportControls";
import { TimelineRuler } from "@/components/TimelineRuler";
import { TracksContainer } from "@/components/TracksContainer";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksFromFiles } from "@/lib/trackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { useWaveformRendering } from "@/hooks/useWaveformRendering";
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
  Box as RadixBox
} from "@radix-ui/themes";

const BPM = 124;
const FADE_SAMPLES = 128;
const FADE_SLOPE = 0.5; // linear

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [sliceCount, setSliceCount] = useState(0);
  const [updateTrigger, setUpdateTrigger] = useState({});

  const { currentPosition, setCurrentPosition, isPlaying, pausedPositionRef } =
    usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef
  });

  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const sampleRateRef = useRef<number>(44100);

  // Get sorted regions for the track
  const getRegions = useCallback(
    (track: TrackData) => {
      const regions: {
        uuid: string;
        position: number;
        duration: number;
        label: string;
      }[] = [];
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({ box }) => {
        if (!box) return;
        const regionBox = box as AudioRegionBox;
        regions.push({
          uuid: UUID.toString(regionBox.address.uuid),
          position: regionBox.position.getValue(),
          duration: regionBox.duration.getValue(),
          label: regionBox.label.getValue()
        });
      });

      return regions.sort((a, b) => a.position - b.position);
    },
    []
  );

  // Apply micro-fades to all regions on the track
  const applyFades = useCallback(
    (project: Project, track: TrackData) => {
      const fadePPQN = PPQN.secondsToPulses(
        FADE_SAMPLES / sampleRateRef.current,
        BPM
      );

      project.editing.modify(() => {
        const pointers = track.trackBox.regions.pointerHub.incoming();
        const adapters: AudioRegionBoxAdapter[] = [];

        pointers.forEach(({ box }) => {
          if (!box) return;
          const regionBox = box as AudioRegionBox;
          const adapter = project.boxAdapters.adapterFor(
            regionBox,
            AudioRegionBoxAdapter
          );
          if (adapter) adapters.push(adapter);
        });

        // Sort by position
        adapters.sort((a, b) => a.position - b.position);

        adapters.forEach((adapter, index) => {
          // Fade-in on all except the first region
          adapter.fading.inField.setValue(index === 0 ? 0 : fadePPQN);
          adapter.fading.inSlopeField.setValue(FADE_SLOPE);
          // Fade-out on all except the last region
          adapter.fading.outField.setValue(
            index === adapters.length - 1 ? 0 : fadePPQN
          );
          adapter.fading.outSlopeField.setValue(FADE_SLOPE);
        });
      });
    },
    []
  );

  // Handle waveform click to slice (overrides default seek behavior)
  const handleSlice = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || tracks.length === 0 || isPlaying) return;

      const track = tracks[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const maxDuration = Math.max(
        ...Array.from(localAudioBuffersRef.current.values()).map(
          (buf) => buf.duration
        ),
        30
      );
      const fraction = (e.clientX - rect.left) / rect.width;
      const seconds = fraction * maxDuration;
      const cutPosition = PPQN.secondsToPulses(seconds, BPM);

      // Find and cut the region at this position
      let didCut = false;
      project.editing.modify(() => {
        const pointers = track.trackBox.regions.pointerHub.incoming();
        pointers.forEach(({ box }) => {
          if (!box || didCut) return;
          const regionBox = box as AudioRegionBox;
          const adapter = project.boxAdapters.adapterFor(
            regionBox,
            AudioRegionBoxAdapter
          );
          if (!adapter) return;

          const start = adapter.position;
          const end = start + adapter.duration;
          if (cutPosition > start && cutPosition < end) {
            RegionEditing.cut(adapter, cutPosition, true);
            didCut = true;
          }
        });
      });

      if (didCut) {
        // Apply fades in a separate transaction
        applyFades(project, track);
        setSliceCount((prev) => prev + 1);
        setUpdateTrigger({});
      }
    },
    [project, tracks, isPlaying, applyFades]
  );

  // Waveform rendering
  useWaveformRendering(
    project,
    tracks,
    canvasRefs.current,
    localAudioBuffersRef.current,
    {
      onAllRendered: () => setStatus("Ready — click on the waveform to slice!"),
      maxDuration: Math.max(
        ...Array.from(localAudioBuffersRef.current.values()).map(
          (buf) => buf.duration
        ),
        30
      ),
      updateTrigger
    }
  );

  // Initialize OpenDAW and load vocals
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setStatus("Initializing OpenDAW...");

        const localAudioBuffers = localAudioBuffersRef.current;
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({
            localAudioBuffers,
            bpm: BPM,
            onStatusUpdate: (s) => {
              if (mounted) setStatus(s);
            }
          });

        if (mounted) {
          setProject(newProject);
          setAudioContext(newAudioContext);
          sampleRateRef.current = newAudioContext.sampleRate;
        }

        const ext = getAudioExtension();
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [{ name: "Vocals", file: `/audio/DarkRide/06_Vox.${ext}` }],
          localAudioBuffers,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            }
          }
        );

        if (mounted) {
          setTracks(loadedTracks);
          setStatus("Loading waveforms...");
        }
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Region Slice Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  const isLoading = !status.startsWith("Ready");
  const maxDuration = Math.max(
    ...Array.from(localAudioBuffersRef.current.values()).map(
      (buf) => buf.duration
    ),
    30
  );
  const track = tracks[0];
  const regions = track ? getRegions(track) : [];

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex
          direction="column"
          gap="6"
          style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}
        >
          {/* Loading Overlay */}
          {isLoading && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                gap: "20px"
              }}
            >
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  border: "4px solid var(--gray-6)",
                  borderTop: "4px solid var(--green-9)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }}
              />
              <Text size="5" weight="bold">
                {status}
              </Text>
              <style>
                {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
              </style>
            </div>
          )}

          {/* Header */}
          <Flex direction="column" gap="4">
            <BackLink />
            <Heading size="8">Region Slice Demo</Heading>
            <Text size="4" color="gray">
              Click anywhere on the waveform to split the region. Each cut
              applies a 128-sample (~3ms) linear fade to prevent clicks. Play
              back to verify seamless audio across all splice points.
            </Text>
          </Flex>

          {/* Instructions */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">How to Use</Heading>
              <Flex direction="column" gap="2">
                <Text size="2">
                  <strong>1. Click on the waveform</strong> to split the region
                  at that point (only when stopped/paused)
                </Text>
                <Text size="2">
                  <strong>2. Repeat</strong> to create as many slices as you
                  want
                </Text>
                <Text size="2">
                  <strong>3. Press Play</strong> to hear that all splice points
                  are seamless
                </Text>
              </Flex>
              <Callout.Root size="1" color="blue">
                <Callout.Text>
                  Refresh the page to start over. Each slice auto-applies a
                  128-sample fade-out/fade-in at the cut boundary.
                </Callout.Text>
              </Callout.Root>
            </Flex>
          </Card>

          {/* Transport */}
          <Card>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Heading size="4">Transport</Heading>
                <Badge size="2" color="green" variant="soft">
                  {regions.length} region{regions.length !== 1 ? "s" : ""} ·{" "}
                  {sliceCount} cut{sliceCount !== 1 ? "s" : ""}
                </Badge>
              </Flex>
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={BPM}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
              <Text size="2" color="gray">
                Position:{" "}
                {PPQN.pulsesToSeconds(currentPosition, BPM).toFixed(2)}s (
                {currentPosition} PPQN)
              </Text>
            </Flex>
          </Card>

          {/* Waveform */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Waveform</Heading>

              <TracksContainer
                currentPosition={currentPosition}
                bpm={BPM}
                maxDuration={maxDuration}
                leftOffset={200}
              >
                <TimelineRuler maxDuration={maxDuration} />

                {track && (
                  <div
                    onClick={handleSlice}
                    style={{
                      cursor: isPlaying ? "default" : "crosshair",
                      position: "relative"
                    }}
                  >
                    <TrackRow
                      track={track}
                      project={project}
                      allTracks={tracks}
                      canvasRef={(canvas) => {
                        if (canvas)
                          canvasRefs.current.set(
                            UUID.toString(track.uuid),
                            canvas
                          );
                      }}
                      currentPosition={currentPosition}
                      isPlaying={isPlaying}
                      bpm={BPM}
                      audioBuffer={localAudioBuffersRef.current.get(
                        UUID.toString(track.uuid)
                      )}
                      setCurrentPosition={setCurrentPosition}
                      pausedPositionRef={pausedPositionRef}
                      maxDuration={maxDuration}
                    />
                  </div>
                )}
              </TracksContainer>

              {/* Region badges */}
              {regions.length > 1 && (
                <RadixBox>
                  <Flex gap="2" wrap="wrap">
                    {regions.map((region, idx) => (
                      <Badge key={region.uuid} size="1" color="gray" variant="soft">
                        Slice {idx + 1}:{" "}
                        {PPQN.pulsesToSeconds(region.position, BPM).toFixed(1)}s
                        {" — "}
                        {PPQN.pulsesToSeconds(
                          region.position + region.duration,
                          BPM
                        ).toFixed(1)}
                        s
                      </Badge>
                    ))}
                  </Flex>
                </RadixBox>
              )}
            </Flex>
          </Card>

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
Navigate to: `http://localhost:5173/region-slice-demo.html`
Expected: The demo loads, shows the loading spinner, then renders the vocal waveform with "Ready — click on the waveform to slice!" status.

- [ ] **Step 3: Test the slicing interaction**

1. Click on the waveform at roughly the middle — the region should split into two
2. The badge area should show "Slice 1" and "Slice 2" with their time ranges
3. The transport badge should show "2 regions · 1 cut"
4. Click on one of the resulting regions to split again — should now show 3 regions
5. Press Play — audio should play seamlessly across all splice points with no clicks

- [ ] **Step 4: Verify slicing is disabled during playback**

1. Press Play
2. Click on the waveform while playing
3. Expected: No split occurs (the `isPlaying` guard prevents it)
4. Press Stop, then click — split should work again

- [ ] **Step 5: Commit**

```bash
git add src/demos/playback/region-slice-demo.tsx
git commit -m "feat: add region slice demo with click-to-split and micro-fades"
```

---

### Task 4: Build Verification

**Files:** (none — verification only)

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: Build succeeds with no errors. The `region-slice-demo.html` is included in the output.

- [ ] **Step 2: Final manual test**

Run: `npm run dev`
Navigate to: `http://localhost:5173/region-slice-demo.html`

Test checklist:
1. Page loads and shows vocal waveform
2. Click waveform while stopped — region splits, badges appear
3. Click again on a different region — more splits
4. Press Play — seamless audio across all cuts, no clicks or pops
5. Clicking while playing does nothing
6. Navigate back to index — "Region Slicing" card is present
7. Clicking the card navigates to the demo

- [ ] **Step 3: Commit any fixes if needed, then final commit**

```bash
git add -A
git commit -m "feat: region slice demo complete"
```
