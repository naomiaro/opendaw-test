# Track Automation Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a demo page showing volume, pan, and effect parameter automation with preset patterns, canvas envelope visualizations, and collapsible JSON blocks showing server persistence data.

**Architecture:** Single self-contained tsx file following the tempo-automation-demo pattern. Loads one audio track, creates three automation tracks (volume, pan, reverb wet), applies preset event patterns, draws envelope canvases, and renders collapsible JSON below each section. Uses `project.api.createAutomationTrack()` to create automation lanes and `ValueEventCollectionBoxAdapter.createEvent()` to add events.

**Tech Stack:** React 19, Radix UI Themes, OpenDAW SDK 0.0.128, Canvas 2D API, HTML `<details>` elements.

**Spec:** `docs/superpowers/specs/2026-03-26-track-automation-demo-design.md`

---

### Task 1: HTML Entry Point and Build Config

**Files:**
- Create: `track-automation-demo.html`
- Modify: `vite.config.ts:23-37`

- [ ] **Step 1: Create HTML entry point**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Track Automation Demo - OpenDAW</title>
    <meta
      name="description"
      content="Automate volume, pan, and effect parameters with visual envelopes and server persistence data"
    />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Oxygen, Ubuntu, Cantarell, sans-serif;
        background: #111;
        color: #fff;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/track-automation-demo.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Add build entry to vite.config.ts**

In the `rollupOptions.input` object, add after the `loopRecording` entry:

```typescript
trackAutomation: resolve(__dirname, "track-automation-demo.html")
```

- [ ] **Step 3: Verify dev server starts**

Run: `npm run dev`
Expected: Dev server starts without errors. Visiting `http://localhost:5173/track-automation-demo.html` shows a blank page (no tsx file yet).

- [ ] **Step 4: Commit**

```bash
git add track-automation-demo.html vite.config.ts
git commit -m "feat: add track automation demo entry point and build config"
```

---

### Task 2: Demo Scaffolding with Audio Loading

**Files:**
- Create: `src/track-automation-demo.tsx`

This task creates the demo shell: loads one audio track, sets up transport controls, and renders the basic page layout. No automation yet.

- [ ] **Step 1: Create the demo tsx file with imports and constants**

```typescript
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Button,
  Card,
  Code,
} from "@radix-ui/themes";
import { Project, EffectFactories, EffectBox } from "@opendaw/studio-core";
import { AudioUnitBox, ReverbDeviceBox, TrackBox } from "@opendaw/studio-boxes";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { UUID } from "@opendaw/lib-std";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";

const BAR = PPQN.fromSignature(4, 4); // 3840
const NUM_BARS = 8;
const TOTAL_PPQN = BAR * NUM_BARS; // 30720
const CANVAS_HEIGHT = 150;
```

- [ ] **Step 2: Add the automation event types and interpolation helper**

```typescript
type InterpolationType =
  | { type: "none" }
  | { type: "linear" }
  | { type: "curve"; slope: number };

type AutomationEvent = {
  position: ppqn;
  value: number;
  index: number;
  interpolation: InterpolationType;
};

type AutomationPattern = {
  name: string;
  description: string;
  events: AutomationEvent[];
};

function toSdkInterpolation(interp: InterpolationType) {
  switch (interp.type) {
    case "none":
      return Interpolation.None;
    case "linear":
      return Interpolation.Linear;
    case "curve":
      return (Interpolation as any).Curve(interp.slope);
  }
}
```

- [ ] **Step 3: Add the App component with audio loading and transport**

```typescript
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const audioUnitBoxRef = useRef<AudioUnitBox | null>(null);
  const audioBuffersRef = useRef(new Map<string, AudioBuffer>());
  const [isReady, setIsReady] = useState(false);

  const { currentPosition: playheadPosition, isPlaying } =
    usePlaybackPosition(project);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { project: newProject, audioContext } = await initializeOpenDAW({
        onStatusUpdate: setStatus,
      });
      if (cancelled) return;

      const ext = getAudioExtension();
      const tracks = await loadTracksFromFiles(
        newProject,
        audioContext,
        [{ name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` }],
        audioBuffersRef.current,
        { autoSetLoopEnd: false },
      );
      if (cancelled) return;

      // Set timeline to 8 bars with looping
      newProject.editing.modify(() => {
        newProject.timelineBox.durationInPulses.setValue(TOTAL_PPQN);
        newProject.timelineBox.loopArea.from.setValue(0);
        newProject.timelineBox.loopArea.to.setValue(TOTAL_PPQN);
        newProject.timelineBox.loopArea.enabled.setValue(true);
      });

      audioUnitBoxRef.current = tracks[0].audioUnitBox;
      projectRef.current = newProject;
      setProject(newProject);
      setStatus("Ready");
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlay = () => {
    const p = projectRef.current;
    if (!p) return;
    p.engine.setPosition(0);
    p.engine.play();
  };

  const handleStop = () => {
    const p = projectRef.current;
    if (!p) return;
    p.engine.stop(true);
  };

  return (
    <Theme appearance="dark" accentColor="purple" radius="large">
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex
          direction="column"
          gap="6"
          style={{ maxWidth: 900, margin: "0 auto" }}
        >
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Track Automation</Heading>
            <Text size="3" color="gray">
              Automate volume, pan, and effect parameters with visual envelopes
              and server persistence data
            </Text>
          </Flex>

          {!isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <Flex direction="column" gap="5">
              <Flex gap="3" align="center">
                {!isPlaying ? (
                  <Button size="3" onClick={handlePlay}>
                    Play
                  </Button>
                ) : (
                  <Button size="3" color="red" onClick={handleStop}>
                    Stop
                  </Button>
                )}
              </Flex>
            </Flex>
          )}
        </Flex>
        <MoisesLogo />
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

- [ ] **Step 4: Verify the page loads and plays audio**

Run: `npm run dev`, navigate to `http://localhost:5173/track-automation-demo.html`
Expected: Page loads, shows "Track Automation" heading, Play button starts audio playback.

- [ ] **Step 5: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: scaffold track automation demo with audio loading"
```

---

### Task 3: Automation Canvas Component

**Files:**
- Modify: `src/track-automation-demo.tsx`

Add a reusable `AutomationCanvas` component that draws the automation envelope with grid, curve, event dots, playhead, and y-axis labels. This component is used by all three automation sections.

- [ ] **Step 1: Add the AutomationCanvas component**

Insert this before the `App` component in `src/track-automation-demo.tsx`:

```typescript
interface AutomationCanvasProps {
  events: AutomationEvent[];
  playheadPosition: ppqn;
  isPlaying: boolean;
  color: string;
  yLabels: { value: number; label: string }[];
}

const AutomationCanvas: React.FC<AutomationCanvasProps> = ({
  events,
  playheadPosition,
  isPlaying,
  color,
  yLabels,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = CANVAS_HEIGHT;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const toX = (ppqnPos: number) => (ppqnPos / TOTAL_PPQN) * width;
    const toY = (value: number) => height - value * height;

    // Bar grid lines
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let bar = 0; bar <= NUM_BARS; bar++) {
      const x = toX(bar * BAR);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (bar < NUM_BARS) {
        ctx.fillStyle = "#666";
        ctx.font = "11px sans-serif";
        ctx.fillText(`${bar + 1}`, x + 4, height - 4);
      }
    }

    // Y-axis labels
    ctx.fillStyle = "#555";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    for (const yl of yLabels) {
      const y = toY(yl.value);
      ctx.fillText(yl.label, width - 4, y - 2);
      ctx.strokeStyle = "#222";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.textAlign = "left";

    // Draw automation curve
    if (events.length > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const x = toX(event.position);
        const y = toY(event.value);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prev = events[i - 1];
          const prevX = toX(prev.position);
          const prevY = toY(prev.value);

          if (prev.interpolation.type === "none") {
            // Step: horizontal then vertical
            ctx.lineTo(x, prevY);
            ctx.lineTo(x, y);
          } else if (prev.interpolation.type === "linear") {
            ctx.lineTo(x, y);
          } else if (prev.interpolation.type === "curve") {
            // Approximate curve with quadratic bezier
            // slope < 0.5 = logarithmic (control point near start)
            // slope > 0.5 = exponential (control point near end)
            const slope = prev.interpolation.slope;
            const cpX = prevX + (x - prevX) * slope;
            const cpY = prevY + (y - prevY) * (1 - slope);
            ctx.quadraticCurveTo(cpX, cpY, x, y);
          }
        }
      }

      // Extend last point to end
      const last = events[events.length - 1];
      if (last.position < TOTAL_PPQN) {
        ctx.lineTo(toX(TOTAL_PPQN), toY(last.value));
      }
      ctx.stroke();

      // Event dots
      ctx.fillStyle = color;
      for (const event of events) {
        ctx.beginPath();
        ctx.arc(toX(event.position), toY(event.value), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Playhead
    if (isPlaying && playheadPosition >= 0) {
      const px = toX(playheadPosition);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [events, playheadPosition, isPlaying, color, yLabels]);

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

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds (component is defined but not yet used — tree-shaking will keep it).

- [ ] **Step 3: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: add AutomationCanvas component for envelope visualization"
```

---

### Task 4: Collapsible JSON Block Component and Helpers

**Files:**
- Modify: `src/track-automation-demo.tsx`

Add the `ServerDataBlock` component for collapsible JSON display and the `eventsToJson` helper.

- [ ] **Step 1: Add the JSON serialization helper and ServerDataBlock component**

Insert after the `AutomationCanvas` component:

```typescript
function eventsToJson(
  targetParameter: string,
  targetUnitId: string,
  events: AutomationEvent[],
  targetDevice?: string,
): object {
  return {
    automationTrack: {
      targetParameter,
      targetUnitId,
      ...(targetDevice && { targetDevice }),
      enabled: true,
      events: events.map((e) => ({
        position: e.position,
        value: e.value,
        index: e.index,
        interpolation:
          e.interpolation.type === "curve"
            ? { type: "curve", slope: e.interpolation.slope }
            : { type: e.interpolation.type },
      })),
    },
  };
}

interface ServerDataBlockProps {
  data: object;
}

const ServerDataBlock: React.FC<ServerDataBlockProps> = ({ data }) => (
  <details
    style={{
      background: "var(--color-surface)",
      borderRadius: "var(--radius-3)",
      border: "1px solid var(--gray-6)",
      padding: "var(--space-3)",
    }}
  >
    <summary
      style={{
        cursor: "pointer",
        color: "var(--gray-11)",
        fontSize: "var(--font-size-2)",
      }}
    >
      Server Data (JSON)
    </summary>
    <pre
      style={{
        margin: "var(--space-3) 0 0",
        padding: "var(--space-3)",
        background: "var(--gray-2)",
        borderRadius: "var(--radius-2)",
        overflow: "auto",
        fontSize: "12px",
        lineHeight: 1.5,
        color: "var(--gray-11)",
      }}
    >
      <code>{JSON.stringify(data, null, 2)}</code>
    </pre>
  </details>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: add ServerDataBlock component and JSON serialization helper"
```

---

### Task 5: Volume Automation Section

**Files:**
- Modify: `src/track-automation-demo.tsx`

Add the volume automation presets and wire them up with `createAutomationTrack`.

- [ ] **Step 1: Add volume preset patterns**

Insert after the `ServerDataBlock` component:

```typescript
const VOLUME_PATTERNS: AutomationPattern[] = [
  {
    name: "Fade In",
    description: "Logarithmic fade in over 4 bars",
    events: [
      { position: 0 as ppqn, value: 0.0, index: 0, interpolation: { type: "curve", slope: 0.25 } },
      { position: (BAR * 4) as ppqn, value: 1.0, index: 0, interpolation: { type: "none" } },
    ],
  },
  {
    name: "Fade Out",
    description: "Exponential fade out over 8 bars",
    events: [
      { position: 0 as ppqn, value: 1.0, index: 0, interpolation: { type: "curve", slope: 0.75 } },
      { position: (BAR * 8) as ppqn, value: 0.0, index: 0, interpolation: { type: "none" } },
    ],
  },
  {
    name: "Swell",
    description: "Curved rise to bar 4, then fall",
    events: [
      { position: 0 as ppqn, value: 0.2, index: 0, interpolation: { type: "curve", slope: 0.3 } },
      { position: (BAR * 4) as ppqn, value: 1.0, index: 0, interpolation: { type: "curve", slope: 0.7 } },
      { position: (BAR * 8) as ppqn, value: 0.2, index: 0, interpolation: { type: "none" } },
    ],
  },
  {
    name: "Ducking",
    description: "Fast duck at bar 3, slow rise at bar 5",
    events: [
      { position: 0 as ppqn, value: 1.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 2) as ppqn, value: 1.0, index: 0, interpolation: { type: "curve", slope: 0.75 } },
      { position: (BAR * 3) as ppqn, value: 0.2, index: 0, interpolation: { type: "none" } },
      { position: (BAR * 5) as ppqn, value: 0.2, index: 0, interpolation: { type: "curve", slope: 0.25 } },
      { position: (BAR * 6) as ppqn, value: 1.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 8) as ppqn, value: 1.0, index: 0, interpolation: { type: "none" } },
    ],
  },
];

const VOLUME_Y_LABELS = [
  { value: 1.0, label: "0 dB" },
  { value: 0.5, label: "-6 dB" },
  { value: 0.0, label: "-inf" },
];
```

- [ ] **Step 2: Add AutomationSection component**

This is a reusable card component for each automation type. Insert after the preset arrays:

```typescript
interface AutomationSectionProps {
  title: string;
  patterns: AutomationPattern[];
  activeIndex: number;
  onSelect: (index: number) => void;
  events: AutomationEvent[];
  playheadPosition: ppqn;
  isPlaying: boolean;
  color: string;
  yLabels: { value: number; label: string }[];
  jsonData: object;
}

const AutomationSection: React.FC<AutomationSectionProps> = ({
  title,
  patterns,
  activeIndex,
  onSelect,
  events,
  playheadPosition,
  isPlaying,
  color,
  yLabels,
  jsonData,
}) => (
  <Card>
    <Flex direction="column" gap="3" p="4">
      <Heading size="5">{title}</Heading>
      <Flex gap="2" wrap="wrap">
        {patterns.map((pattern, index) => (
          <Button
            key={pattern.name}
            variant={activeIndex === index ? "solid" : "outline"}
            size="1"
            onClick={() => onSelect(index)}
          >
            {pattern.name}
          </Button>
        ))}
      </Flex>
      <Text size="2" color="gray">
        {patterns[activeIndex].description}
      </Text>
      <AutomationCanvas
        events={events}
        playheadPosition={playheadPosition}
        isPlaying={isPlaying}
        color={color}
        yLabels={yLabels}
      />
      <ServerDataBlock data={jsonData} />
    </Flex>
  </Card>
);
```

- [ ] **Step 3: Wire up volume automation in the App component**

Add state and the automation application function. In the `App` component, add after the existing refs:

```typescript
const volumeTrackBoxRef = useRef<TrackBox | null>(null);
const [volumePatternIndex, setVolumePatternIndex] = useState(0);
```

Add the `applyAutomationEvents` function inside the App component (it uses projectRef):

```typescript
const applyAutomationEvents = (
  trackBox: TrackBox | null,
  events: AutomationEvent[],
) => {
  const p = projectRef.current;
  if (!p || !trackBox) return;

  // Find the ValueEventCollectionBox via the track's regions
  const boxes = p.boxGraph.boxes();
  const regions = boxes.filter((box: any) => {
    const regionTarget = box.regions?.targetVertex;
    if (!regionTarget) return false;
    return regionTarget.nonEmpty() && regionTarget.unwrap() === trackBox;
  });

  // Try to find existing value event collection on this track
  // createAutomationTrack creates a track with a region containing events
  p.editing.modify(() => {
    // Access the track adapter to find the event collection
    const audioUnitBox = audioUnitBoxRef.current!;
    const unitAdapter = p.boxAdapters.getOrCreate(audioUnitBox);
    const trackAdapter = (unitAdapter as any).tracks
      .controls(trackBox.target.targetVertex.unwrap())
      .unwrap();

    // Clear existing events from all regions
    for (const region of trackAdapter.regions.values()) {
      const collection = (region as any).collection;
      if (collection) {
        collection.events.asArray().forEach((event: any) => event.box.delete());
      }
    }

    // If no regions exist, create events via the track's value at mechanism
    // For now, we create a fresh region approach
  });

  // Create new events — separate transaction for clean state
  p.editing.modify(() => {
    const audioUnitBox = audioUnitBoxRef.current!;
    const unitAdapter = p.boxAdapters.getOrCreate(audioUnitBox);
    const trackAdapter = (unitAdapter as any).tracks
      .controls(trackBox.target.targetVertex.unwrap())
      .unwrap();

    const region = trackAdapter.regions.values()[0];
    if (region) {
      const collection = (region as any).collection;
      if (collection) {
        for (const event of events) {
          collection.createEvent({
            position: event.position,
            index: event.index,
            value: event.value,
            interpolation: toSdkInterpolation(event.interpolation),
          });
        }
      }
    }
  });
};
```

**Important note for the implementer:** The exact path to access the ValueEventCollectionBoxAdapter from a TrackBox created by `createAutomationTrack` needs to be verified at runtime. The approach above uses `trackAdapter.regions` → first region → `collection`. If this doesn't work, alternative approaches:
1. Scan `boxGraph.boxes()` for `ValueEventCollectionBox` instances that are linked to this track
2. Use `trackBox.target` to find the automation field, then trace back to find the event collection
3. Check if `createAutomationTrack` also creates a ValueRegionBox that can be found via `boxGraph.boxes()`

The implementer should `console.log` the track adapter and its properties to find the correct access path. The tempo automation demo uses `timelineBoxAdapter.tempoTrackEvents` which is a special case — generic automation tracks may expose events differently.

- [ ] **Step 4: Create the volume automation track during initialization**

In the init `useEffect`, after setting up the timeline, add:

```typescript
// Create volume automation track
let volumeTrackBox: TrackBox | null = null;
const audioUnitBox = tracks[0].audioUnitBox;
newProject.editing.modify(() => {
  volumeTrackBox = newProject.api.createAutomationTrack(
    audioUnitBox,
    audioUnitBox.volume,
  );
});
volumeTrackBoxRef.current = volumeTrackBox;

// Apply initial volume pattern
// (will be called after all refs are set, in next step)
```

- [ ] **Step 5: Add volume section to the render**

In the JSX, inside the `isReady` branch, after the transport controls Flex, add:

```typescript
<AutomationSection
  title="Volume Automation"
  patterns={VOLUME_PATTERNS}
  activeIndex={volumePatternIndex}
  onSelect={(index) => {
    if (isPlaying) projectRef.current?.engine.stop(true);
    setVolumePatternIndex(index);
    applyAutomationEvents(
      volumeTrackBoxRef.current,
      VOLUME_PATTERNS[index].events,
    );
  }}
  events={VOLUME_PATTERNS[volumePatternIndex].events}
  playheadPosition={playheadPosition as ppqn}
  isPlaying={isPlaying}
  color="#a855f7"
  yLabels={VOLUME_Y_LABELS}
  jsonData={eventsToJson(
    "volume",
    audioUnitBoxRef.current
      ? UUID.toString(audioUnitBoxRef.current.address.uuid)
      : "",
    VOLUME_PATTERNS[volumePatternIndex].events,
  )}
/>
```

- [ ] **Step 6: Apply initial volume pattern after init**

At the end of the init useEffect (after all refs are set, before `setIsReady(true)`):

```typescript
// Apply initial patterns
applyAutomationEvents(volumeTrackBox, VOLUME_PATTERNS[0].events);
```

- [ ] **Step 7: Verify volume automation works**

Run: `npm run dev`, navigate to demo
Expected: Volume automation card renders with 4 preset buttons. Selecting a preset updates the canvas. Playing audio should apply volume automation (you hear the volume change). Collapsible JSON block shows the event data.

- [ ] **Step 8: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: add volume automation section with presets and canvas"
```

---

### Task 6: Pan Automation Section

**Files:**
- Modify: `src/track-automation-demo.tsx`

- [ ] **Step 1: Add pan preset patterns**

Insert after `VOLUME_Y_LABELS`:

```typescript
const PAN_PATTERNS: AutomationPattern[] = [
  {
    name: "L-R Sweep",
    description: "Linear sweep from left to right",
    events: [
      { position: 0 as ppqn, value: 0.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 8) as ppqn, value: 1.0, index: 0, interpolation: { type: "linear" } },
    ],
  },
  {
    name: "Ping-Pong",
    description: "Bounce between left and right every 2 bars",
    events: [
      { position: 0 as ppqn, value: 0.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 2) as ppqn, value: 1.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 4) as ppqn, value: 0.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 6) as ppqn, value: 1.0, index: 0, interpolation: { type: "linear" } },
      { position: (BAR * 8) as ppqn, value: 0.0, index: 0, interpolation: { type: "linear" } },
    ],
  },
  {
    name: "Center Hold",
    description: "Stay centered (no panning)",
    events: [
      { position: 0 as ppqn, value: 0.5, index: 0, interpolation: { type: "none" } },
      { position: (BAR * 8) as ppqn, value: 0.5, index: 0, interpolation: { type: "none" } },
    ],
  },
];

const PAN_Y_LABELS = [
  { value: 1.0, label: "R" },
  { value: 0.5, label: "C" },
  { value: 0.0, label: "L" },
];
```

- [ ] **Step 2: Add pan state and track creation**

In the App component, add state:

```typescript
const panTrackBoxRef = useRef<TrackBox | null>(null);
const [panPatternIndex, setPanPatternIndex] = useState(0);
```

In the init useEffect, after volume track creation:

```typescript
// Create pan automation track
let panTrackBox: TrackBox | null = null;
newProject.editing.modify(() => {
  panTrackBox = newProject.api.createAutomationTrack(
    audioUnitBox,
    audioUnitBox.panning,
  );
});
panTrackBoxRef.current = panTrackBox;
```

And apply initial pattern (alongside volume):

```typescript
applyAutomationEvents(panTrackBox, PAN_PATTERNS[0].events);
```

- [ ] **Step 3: Add pan section to the render**

After the volume `AutomationSection`:

```typescript
<AutomationSection
  title="Pan Automation"
  patterns={PAN_PATTERNS}
  activeIndex={panPatternIndex}
  onSelect={(index) => {
    if (isPlaying) projectRef.current?.engine.stop(true);
    setPanPatternIndex(index);
    applyAutomationEvents(
      panTrackBoxRef.current,
      PAN_PATTERNS[index].events,
    );
  }}
  events={PAN_PATTERNS[panPatternIndex].events}
  playheadPosition={playheadPosition as ppqn}
  isPlaying={isPlaying}
  color="#38bdf8"
  yLabels={PAN_Y_LABELS}
  jsonData={eventsToJson(
    "panning",
    audioUnitBoxRef.current
      ? UUID.toString(audioUnitBoxRef.current.address.uuid)
      : "",
    PAN_PATTERNS[panPatternIndex].events,
  )}
/>
```

- [ ] **Step 4: Verify pan automation works**

Run: `npm run dev`
Expected: Pan section shows preset buttons, canvas with blue curve. Selecting "Ping-Pong" and playing should move audio between left and right channels.

- [ ] **Step 5: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: add pan automation section with presets"
```

---

### Task 7: Effect Parameter (Reverb Wet) Automation Section

**Files:**
- Modify: `src/track-automation-demo.tsx`

- [ ] **Step 1: Add reverb mix preset patterns**

Insert after `PAN_Y_LABELS`:

```typescript
const REVERB_PATTERNS: AutomationPattern[] = [
  {
    name: "Dry to Wet",
    description: "Logarithmic ramp from dry to full reverb",
    events: [
      { position: 0 as ppqn, value: 0.0, index: 0, interpolation: { type: "curve", slope: 0.25 } },
      { position: (BAR * 8) as ppqn, value: 1.0, index: 0, interpolation: { type: "linear" } },
    ],
  },
  {
    name: "Wet to Dry",
    description: "Exponential ramp from full reverb to dry",
    events: [
      { position: 0 as ppqn, value: 1.0, index: 0, interpolation: { type: "curve", slope: 0.75 } },
      { position: (BAR * 8) as ppqn, value: 0.0, index: 0, interpolation: { type: "linear" } },
    ],
  },
  {
    name: "Pulse",
    description: "Reverb kicks in every 2 bars",
    events: [
      { position: 0 as ppqn, value: 0.0, index: 0, interpolation: { type: "none" } },
      { position: (BAR * 2) as ppqn, value: 0.8, index: 0, interpolation: { type: "none" } },
      { position: (BAR * 4) as ppqn, value: 0.0, index: 0, interpolation: { type: "none" } },
      { position: (BAR * 6) as ppqn, value: 0.8, index: 0, interpolation: { type: "none" } },
      { position: (BAR * 8) as ppqn, value: 0.0, index: 0, interpolation: { type: "none" } },
    ],
  },
];

const REVERB_Y_LABELS = [
  { value: 1.0, label: "Wet" },
  { value: 0.5, label: "50%" },
  { value: 0.0, label: "Dry" },
];
```

- [ ] **Step 2: Add reverb state and track creation**

In the App component, add state:

```typescript
const reverbTrackBoxRef = useRef<TrackBox | null>(null);
const reverbDeviceBoxRef = useRef<ReverbDeviceBox | null>(null);
const [reverbPatternIndex, setReverbPatternIndex] = useState(0);
```

In the init useEffect, after pan track creation:

```typescript
// Insert reverb effect and create automation track for its wet parameter
let reverbEffectBox: EffectBox | null = null;
newProject.editing.modify(() => {
  reverbEffectBox = newProject.api.insertEffect(
    audioUnitBox.audioEffects,
    EffectFactories.AudioNamed.Reverb,
  );
  reverbEffectBox!.label.setValue("Reverb");
});

// Get the reverb device box from the effect box (separate transaction)
const reverbDevice = (reverbEffectBox as any)?.device as ReverbDeviceBox;
reverbDeviceBoxRef.current = reverbDevice;

// Create automation track targeting the reverb wet parameter
let reverbTrackBox: TrackBox | null = null;
newProject.editing.modify(() => {
  reverbTrackBox = newProject.api.createAutomationTrack(
    audioUnitBox,
    reverbDevice.wet,
  );
});
reverbTrackBoxRef.current = reverbTrackBox;
```

And apply initial pattern:

```typescript
applyAutomationEvents(reverbTrackBox, REVERB_PATTERNS[0].events);
```

**Note for implementer:** The `EffectBox` → device box access may be via `effectBox.device`, `effectBox.deviceBox`, or by scanning `boxGraph.boxes()` for a `ReverbDeviceBox` whose pointer chain leads back to this effect. Console.log the effectBox to find the correct property. Check the effects demo's `useDynamicEffect.ts` for how it accesses device boxes (e.g., `effectBox.boxes.at(0)` or similar).

- [ ] **Step 3: Add reverb section to the render**

After the pan `AutomationSection`:

```typescript
<AutomationSection
  title="Effect Automation (Reverb Wet)"
  patterns={REVERB_PATTERNS}
  activeIndex={reverbPatternIndex}
  onSelect={(index) => {
    if (isPlaying) projectRef.current?.engine.stop(true);
    setReverbPatternIndex(index);
    applyAutomationEvents(
      reverbTrackBoxRef.current,
      REVERB_PATTERNS[index].events,
    );
  }}
  events={REVERB_PATTERNS[reverbPatternIndex].events}
  playheadPosition={playheadPosition as ppqn}
  isPlaying={isPlaying}
  color="#34d399"
  yLabels={REVERB_Y_LABELS}
  jsonData={eventsToJson(
    "wet",
    audioUnitBoxRef.current
      ? UUID.toString(audioUnitBoxRef.current.address.uuid)
      : "",
    REVERB_PATTERNS[reverbPatternIndex].events,
    "reverb",
  )}
/>
```

- [ ] **Step 4: Verify reverb automation works**

Run: `npm run dev`
Expected: Reverb section renders with 3 presets. "Dry to Wet" should gradually add reverb. "Pulse" should toggle reverb on/off. Green canvas curve with collapsible JSON.

- [ ] **Step 5: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: add reverb wet automation section with presets"
```

---

### Task 8: Full Project JSON Card

**Files:**
- Modify: `src/track-automation-demo.tsx`

- [ ] **Step 1: Add the full project JSON card to the render**

After the reverb `AutomationSection`, add:

```typescript
<Card>
  <Flex direction="column" gap="3" p="4">
    <Heading size="5">Full Project Automation Data</Heading>
    <Text size="2" color="gray">
      Combined automation state — what a server would store to save and
      restore all automation for this project.
    </Text>
    <ServerDataBlock
      data={{
        projectAutomation: {
          tracks: [
            eventsToJson(
              "volume",
              audioUnitBoxRef.current
                ? UUID.toString(audioUnitBoxRef.current.address.uuid)
                : "",
              VOLUME_PATTERNS[volumePatternIndex].events,
            ).automationTrack,
            eventsToJson(
              "panning",
              audioUnitBoxRef.current
                ? UUID.toString(audioUnitBoxRef.current.address.uuid)
                : "",
              PAN_PATTERNS[panPatternIndex].events,
            ).automationTrack,
            eventsToJson(
              "wet",
              audioUnitBoxRef.current
                ? UUID.toString(audioUnitBoxRef.current.address.uuid)
                : "",
              REVERB_PATTERNS[reverbPatternIndex].events,
              "reverb",
            ).automationTrack,
          ],
          timeline: {
            bpm: 120,
            timeSignature: { numerator: 4, denominator: 4 },
            durationPpqn: TOTAL_PPQN,
            loopEnabled: true,
            loopFrom: 0,
            loopTo: TOTAL_PPQN,
          },
        },
      }}
    />
  </Flex>
</Card>
```

- [ ] **Step 2: Verify the full project JSON renders**

Run: `npm run dev`
Expected: Card at the bottom shows a collapsible JSON block with all three automation tracks and timeline metadata combined.

- [ ] **Step 3: Commit**

```bash
git add src/track-automation-demo.tsx
git commit -m "feat: add full project automation JSON card"
```

---

### Task 9: Home Page Card

**Files:**
- Modify: `src/index.tsx`

- [ ] **Step 1: Add the demo card to the home grid**

In `src/index.tsx`, add a new `Card` inside the grid div, after the Loop Recording card (before the closing `</div>`):

```typescript
<Card asChild>
  <Link href="/track-automation-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
    <Flex direction="column" gap="3">
      <Flex direction="column" align="center" gap="2">
        <Text size="8">📈</Text>
        <Heading size="5">Track Automation</Heading>
      </Flex>
      <Text size="2" color="gray">
        Automate volume, pan, and effect parameters with preset patterns.
        Visualize automation envelopes and see the JSON data a server would
        store to save and restore automation state.
      </Text>
    </Flex>
  </Link>
</Card>
```

Note: The Clip Fades demo already uses the 📈 emoji. Use 🎛 instead to differentiate:

```typescript
<Text size="8">🔀</Text>
```

Actually, check what emojis are already used by other cards and pick an unused one. The automation concept maps well to 📉 (chart with downtrend, suggesting curves) or use the existing pattern and pick something like `⚡` or keep `📈` since there's no strict uniqueness requirement.

- [ ] **Step 2: Verify home page shows the card**

Run: `npm run dev`, navigate to `http://localhost:5173/`
Expected: New "Track Automation" card appears in the grid. Clicking it navigates to the demo.

- [ ] **Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat: add track automation card to home page"
```

---

### Task 10: Build Verification and Final Cleanup

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: Build completes successfully with no TypeScript errors.

- [ ] **Step 2: Test all demo functionality**

Run: `npm run dev`

Verify:
1. Home page shows Track Automation card and links to the demo
2. Demo loads audio and shows "Ready" state
3. Volume presets: each button updates canvas, JSON updates in collapsible block
4. Pan presets: same verification
5. Reverb presets: same verification
6. Full Project JSON: combines all current selections
7. Play button starts audio, playhead moves on all three canvases
8. Automation is audible (volume fades, pan sweeps, reverb changes)
9. Stop button resets playback

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final cleanup for track automation demo"
```

(Only if there are changes to commit.)
