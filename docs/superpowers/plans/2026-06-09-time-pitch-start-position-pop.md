# Time/Pitch Start-Position Pop Debug Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an unlisted debug repro page that loads `06_Vox.opus`, attaches `AudioTimeStretchBox` at `playbackRate = 1.0`, renders the file's waveform, and lets the user click anywhere to set the engine start position before pressing Play — so we can hunt for a reported pop when starting in silent sections.

**Architecture:** Single-file React page following the established `*-debug-demo.tsx` pattern at `src/demos/playback/`. Box-graph setup mirrors `time-pitch-demo.tsx` (Tape track + AudioFileBox + AudioRegionBox + AudioTimeStretchBox attached via `playMode.refer`). Waveform via `PeaksPainter.renderPixelStrips` on a single `<canvas>`. Click-to-set-position lifted from `comp-lanes-debug-demo.tsx`. Paired with a `debug/time-pitch-start-position-pop.md` note. Verification is manual ear-based listening — project has no test infra and debug demos don't carry tests by convention.

**Tech Stack:** React 19, Radix UI Themes (dark + amber), `@opendaw/studio-sdk@0.0.154` (`studio-core@0.0.152`, `studio-adapters@0.0.116`, `studio-boxes`), `@opendaw/lib-fusion` (`PeaksPainter`), Vite, TypeScript. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-09-time-pitch-start-position-pop-design.md`.

---

## File Structure

**Create:**
- `time-pitch-start-position-debug-demo.html` — Vite entry, repo root, `noindex` meta. Boots the React app. Owns nothing else.
- `src/demos/playback/time-pitch-start-position-debug-demo.tsx` — single React component, all demo logic. Target ~300–400 lines. Sections: imports → constants → component (init effect, peaks effect, render effect, click/play/stop/cents handlers, JSX) → mount.
- `debug/time-pitch-start-position-pop.md` — debug note. Symptom (suspected, pending empirical confirmation), Repro steps, "Mechanism not yet identified" with cross-refs to the three candidate-related notes.

**Modify:**
- `vite.config.ts` — add one line to `rollupOptions.input`.
- `debug/README.md` — add one Index entry.

**Not touched (deliberate, per unlisted-debug convention):**
- `src/index.tsx`, `public/sitemap.xml`, any analytics / OG-image setup.

---

## Task 1: Scaffold HTML entry, vite config entry, empty React skeleton

**Goal:** Page renders a stub "Time/Pitch Start-Position Pop Debug" heading via the dev server. No SDK wiring yet.

**Files:**
- Create: `time-pitch-start-position-debug-demo.html`
- Create: `src/demos/playback/time-pitch-start-position-debug-demo.tsx`
- Modify: `vite.config.ts` (rollupOptions.input)

- [ ] **Step 1: Create the HTML entry**

`time-pitch-start-position-debug-demo.html`:

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />

    <title>Time/Pitch Start-Position Pop Debug</title>

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
    <script type="module" src="/src/demos/playback/time-pitch-start-position-debug-demo.tsx"></script>
</body>

</html>
```

- [ ] **Step 2: Create the React skeleton**

`src/demos/playback/time-pitch-start-position-debug-demo.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Flex } from "@radix-ui/themes";

const App: React.FC = () => {
  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Time/Pitch Start-Position Pop
          </Heading>
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

- [ ] **Step 3: Add the Vite config entry**

In `vite.config.ts`, locate the `rollupOptions.input` object (around lines 22–48) and add the new entry alongside the existing debug entries (e.g. after `voiceFadeinClipFadeinProductDebug`):

```ts
                voiceFadeinClipFadeinProductDebug: resolve(__dirname, "voice-fadein-clip-fadein-product-debug-demo.html"),
                timePitchStartPositionDebug: resolve(__dirname, "time-pitch-start-position-debug-demo.html")
```

(Insert a trailing comma on the prior line, no comma on the last entry — match the existing style.)

- [ ] **Step 4: Verify dev server picks it up**

Run:

```bash
rm -rf node_modules/.vite
npm run dev
```

Then in another terminal:

```bash
curl -k -s -o /dev/null -w "%{http_code}\n" https://localhost:5173/time-pitch-start-position-debug-demo.html
```

Expected: `200`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add time-pitch-start-position-debug-demo.html \
        src/demos/playback/time-pitch-start-position-debug-demo.tsx \
        vite.config.ts
git commit -m "chore: scaffold time-pitch start-position debug demo entry"
```

---

## Task 2: Initialize OpenDAW + load Vox audio

**Goal:** On mount, boot OpenDAW, load `06_Vox.opus` (with Safari `.m4a` fallback), and flip a status badge to "Ready". No box-graph wiring yet.

**Files:**
- Modify: `src/demos/playback/time-pitch-start-position-debug-demo.tsx` (replace full file)

- [ ] **Step 1: Update the React file with init logic**

```tsx
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile, getAudioExtension } from "@/lib/audioUtils";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Flex, Card, Text, Badge } from "@radix-ui/themes";

const PROJECT_BPM = 124;
const AUDIO_FILE = `/audio/DarkRide/06_Vox.${getAudioExtension()}`;
const AUDIO_LABEL = "06_Vox";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({
            localAudioBuffers: localAudioBuffersRef.current,
            bpm: PROJECT_BPM,
            onStatusUpdate: setStatus,
          });
        if (cancelled) return;

        setStatus(`Loading ${AUDIO_LABEL}...`);
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (cancelled) return;
        audioBufferRef.current = audioBuffer;

        setProject(newProject);
        setAudioContext(newAudioContext);
        setStatus("Ready");
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setStatus("Failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Time/Pitch Start-Position Pop
          </Heading>
          <Card>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">Status:</Text>
              <Badge
                color={status === "Failed" ? "red" : status === "Ready" ? "green" : "blue"}
              >
                {status}
              </Badge>
              {audioBufferRef.current && (
                <Text size="2" color="gray">
                  {audioBufferRef.current.duration.toFixed(2)} s,{" "}
                  {audioBufferRef.current.numberOfChannels} ch,{" "}
                  {audioBufferRef.current.sampleRate} Hz
                </Text>
              )}
            </Flex>
            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
          </Card>
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

- [ ] **Step 2: Verify in the browser**

```bash
rm -rf node_modules/.vite
npm run dev
```

Open `https://localhost:5173/time-pitch-start-position-debug-demo.html`. Status badge transitions through "Initializing OpenDAW..." → "Loading 06_Vox..." → "Ready". Once Ready, the gray text shows `230.59 s, 2 ch, 48000 Hz` (or close — ffprobe reports 230.591187 s for the source).

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/demos/playback/time-pitch-start-position-debug-demo.tsx
git commit -m "feat: load Vox audio and surface file metadata"
```

---

## Task 3: Create box graph with TimeStretch attached at rate 1.0

**Goal:** Inside the init effect (after audio loads), create the Tape track, AudioFileBox, AudioRegionBox spanning the full file, run transient detection, and attach an `AudioTimeStretchBox` at `playbackRate = 1.0`.

**Files:**
- Modify: `src/demos/playback/time-pitch-start-position-debug-demo.tsx`

- [ ] **Step 1: Add imports**

At the top of the file, expand the existing imports:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  AudioFileBox,
  AudioRegionBox,
  AudioTimeStretchBox,
  ValueEventCollectionBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile, getAudioExtension } from "@/lib/audioUtils";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Flex, Card, Text, Badge } from "@radix-ui/themes";
```

- [ ] **Step 2: Add refs and state for box-graph handles**

Inside the `App` component, alongside the existing refs:

```tsx
  const [transientCount, setTransientCount] = useState<number | null>(null);
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
  const regionRef = useRef<AudioRegionBox | null>(null);
  const stretchBoxRef = useRef<AudioTimeStretchBox | null>(null);
  const fileUuidRef = useRef<ReturnType<typeof UUID.generate> | null>(null);
  const durationSecondsRef = useRef(0);
  const durationPpqnRef = useRef(0);
```

- [ ] **Step 3: Extend the init effect with box-graph wiring**

After `audioBufferRef.current = audioBuffer;` and before `setProject(newProject);`, insert the box-graph block. The full init effect now reads:

```tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const { project: newProject, audioContext: newAudioContext } =
          await initializeOpenDAW({
            localAudioBuffers: localAudioBuffersRef.current,
            bpm: PROJECT_BPM,
            onStatusUpdate: setStatus,
          });
        if (cancelled) return;

        setStatus(`Loading ${AUDIO_LABEL}...`);
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (cancelled) return;
        audioBufferRef.current = audioBuffer;

        const fileUuid = UUID.generate();
        fileUuidRef.current = fileUuid;
        localAudioBuffersRef.current.set(UUID.toString(fileUuid), audioBuffer);

        const durationSeconds = audioBuffer.duration;
        const durationPpqn = Math.round(
          PPQN.secondsToPulses(durationSeconds, PROJECT_BPM)
        );
        durationSecondsRef.current = durationSeconds;
        durationPpqnRef.current = durationPpqn;

        // Create Tape track + AudioFileBox + full-file AudioRegionBox (no playMode yet)
        newProject.editing.modify(() => {
          const { trackBox } = newProject.api.createInstrument(
            InstrumentFactories.Tape
          );

          const audioFileBox = AudioFileBox.create(
            newProject.boxGraph,
            fileUuid,
            (box) => {
              box.fileName.setValue(AUDIO_LABEL);
              box.endInSeconds.setValue(durationSeconds);
            }
          );
          audioFileBoxRef.current = audioFileBox;

          const events = ValueEventCollectionBox.create(
            newProject.boxGraph,
            UUID.generate()
          );

          const region = AudioRegionBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (box) => {
              box.regions.refer(trackBox.regions);
              box.file.refer(audioFileBox);
              box.events.refer(events.owners);
              box.position.setValue(0);
              box.duration.setValue(durationPpqn);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(durationPpqn);
              box.timeBase.setValue(TimeBase.Musical);
              box.label.setValue(AUDIO_LABEL);
            }
          );
          regionRef.current = region;

          // Disable loop, extend its range past region end
          newProject.timelineBox.loopArea.enabled.setValue(false);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(durationPpqn);
        });

        // Detect transients (required before attaching TimeStretch, or the
        // engine renders silence — see playback CLAUDE.md). May take a few
        // seconds on a 230s file.
        setStatus("Detecting transients...");
        const positions = await ensureTransientMarkers(
          newProject,
          audioFileBoxRef.current!,
          audioBuffer
        );
        if (cancelled) return;
        setTransientCount(positions.length);

        // Attach AudioTimeStretchBox in a separate transaction (transient
        // markers were written in their own transaction by ensureTransientMarkers).
        setStatus("Attaching TimeStretch...");
        newProject.editing.modify(() => {
          const region = regionRef.current!;
          const stretchBox = AudioTimeStretchBox.create(
            newProject.boxGraph,
            UUID.generate(),
            (b) => {
              b.transientPlayMode.setValue(TransientPlayMode.Pingpong);
              b.playbackRate.setValue(1.0);
            }
          );
          stretchBoxRef.current = stretchBox;

          // Default warp markers: 0 -> 0, durationPpqn -> durationSeconds.
          WarpMarkerBox.create(newProject.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(stretchBox.warpMarkers);
            m.position.setValue(0);
            m.seconds.setValue(0);
          });
          WarpMarkerBox.create(newProject.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(stretchBox.warpMarkers);
            m.position.setValue(durationPpqnRef.current);
            m.seconds.setValue(durationSecondsRef.current);
          });

          region.playMode.refer(stretchBox);
        });

        await newProject.engine.queryLoadingComplete();
        if (cancelled) return;

        setProject(newProject);
        setAudioContext(newAudioContext);
        setStatus("Ready");
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setStatus("Failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 4: Show transient count in the status card**

Inside the Status `<Card>`, after the existing duration line:

```tsx
              {transientCount !== null && (
                <Text size="2" color="gray">
                  · {transientCount} transients
                </Text>
              )}
```

- [ ] **Step 5: Verify in the browser**

```bash
rm -rf node_modules/.vite
npm run dev
```

Open the page. Status progresses: `Initializing... → Loading 06_Vox... → Detecting transients... → Attaching TimeStretch... → Ready`. Transient count appears in the status line — should be a positive integer (likely 200+ for a 230s vocal). No red error.

Open browser DevTools console. No box-graph errors. No CORS / 404 for the audio file.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/demos/playback/time-pitch-start-position-debug-demo.tsx
git commit -m "feat: attach TimeStretch at rate 1.0 on full-file Vox region"
```

---

## Task 4: Render Vox waveform on a single canvas

**Goal:** Render the full file's peaks on a wide canvas inside a new "Waveform" card. Stereo: two stacked channels with 4 px padding. Peaks come from `audioFileBoxAdapter.peaks`; subscribe to the sample loader once and paint when state hits "loaded".

**Files:**
- Modify: `src/demos/playback/time-pitch-start-position-debug-demo.tsx`

- [ ] **Step 1: Add waveform imports**

Add to the existing imports block:

```tsx
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
```

- [ ] **Step 2: Add waveform constants and refs**

Below the existing constants:

```tsx
const WAVEFORM_HEIGHT = 140;
const CHANNEL_PADDING = 4;
const WAVEFORM_COLOR = "#4a9eff";
```

Inside the `App` component, alongside the other refs:

```tsx
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const [peaksReady, setPeaksReady] = useState(false);
```

(`fileUuidRef` is already declared in Task 3 Step 2 and assigned in Task 3 Step 3.)

- [ ] **Step 3: Subscribe to the sample loader after init**

Add a new `useEffect` below the init effect:

```tsx
  // One-shot: wait for peaks. sampleLoader.peaks is Option<Peaks> and may
  // lag queryLoadingComplete by ~120 ms (peaks worker). Same pattern as
  // useWaveformRendering and drum-scheduling-demo.
  useEffect(() => {
    if (!project) return;
    const fileUuid = fileUuidRef.current;
    if (!fileUuid) return;

    const sampleLoader = project.sampleManager.getOrCreate(fileUuid);

    // Peaks may already be present — promote synchronously and bail.
    const peaksOpt = sampleLoader.peaks;
    if (peaksOpt.nonEmpty()) {
      peaksRef.current = peaksOpt.unwrap();
      setPeaksReady(true);
      return;
    }

    const sub = sampleLoader.subscribe((state: any) => {
      if (state.type === "loaded") {
        const opt = sampleLoader.peaks;
        if (opt.nonEmpty()) {
          peaksRef.current = opt.unwrap();
          setPeaksReady(true);
        }
        sub.terminate();
      }
    });
    return () => sub.terminate();
  }, [project]);
```

- [ ] **Step 4: Render the waveform**

Add a render effect below the peaks effect:

```tsx
  // Render waveform when peaks are ready, or when the canvas remounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!canvas || !peaks || !audioBuffer) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = WAVEFORM_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, WAVEFORM_HEIGHT);

    const channels = audioBuffer.numberOfChannels;
    const numberOfFrames = audioBuffer.length;
    const channelHeight =
      (WAVEFORM_HEIGHT - CHANNEL_PADDING * (channels - 1)) / channels;

    ctx.fillStyle = WAVEFORM_COLOR;
    for (let ch = 0; ch < channels; ch++) {
      const y0 = ch * (channelHeight + CHANNEL_PADDING);
      const y1 = y0 + channelHeight;
      // Float16 unpack quirk: ±1.001 not ±1.0 (see playback CLAUDE.md).
      PeaksPainter.renderPixelStrips(ctx, peaks, ch, {
        x0: 0,
        x1: width,
        y0,
        y1,
        u0: 0,
        u1: numberOfFrames,
        v0: -1.001,
        v1: 1.001,
      });
    }
  }, [peaksReady]);
```

- [ ] **Step 5: Add the waveform card to the JSX**

Below the Status card and before `</Flex>`:

```tsx
          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Waveform</Text>
              <canvas
                ref={canvasRef}
                style={{
                  width: "100%",
                  height: WAVEFORM_HEIGHT,
                  display: "block",
                  background: "#111",
                  borderRadius: 4,
                }}
              />
              {!peaksReady && (
                <Text size="1" color="gray">
                  Waiting for peaks...
                </Text>
              )}
            </Flex>
          </Card>
```

- [ ] **Step 6: Verify in the browser**

```bash
rm -rf node_modules/.vite
npm run dev
```

Open the page. After Status reaches "Ready", a stereo waveform appears in the Waveform card. Two channels stacked vertically, ~140 px tall total. Background is dark. The waveform should show the obvious silence at the start of the Vox file (flat near zero), then the vocal entries.

If peaks don't appear: check `sampleLoader.peaks` in DevTools after `Ready` — should be `Option.Some`. If it's `Option.None`, the loader subscription is missing a `state.type === "loaded"` event (timing/race) — re-check the effect cleanup.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/demos/playback/time-pitch-start-position-debug-demo.tsx
git commit -m "feat: render stereo Vox waveform"
```

---

## Task 5: Click-to-set-start-position + playhead marker

**Goal:** Clicking anywhere on the waveform sets the start position. A vertical line marks the current start. Calls `engine.setPosition` so the engine playhead matches the marker. Works both when stopped and when playing.

**Files:**
- Modify: `src/demos/playback/time-pitch-start-position-debug-demo.tsx`

- [ ] **Step 1: Add start-position state**

Inside the `App` component:

```tsx
  const [startSeconds, setStartSeconds] = useState(0);
```

- [ ] **Step 2: Extend the render effect to also paint the playhead line**

Replace the existing render effect with:

```tsx
  useEffect(() => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!canvas || !peaks || !audioBuffer) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = WAVEFORM_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, WAVEFORM_HEIGHT);

    const channels = audioBuffer.numberOfChannels;
    const numberOfFrames = audioBuffer.length;
    const channelHeight =
      (WAVEFORM_HEIGHT - CHANNEL_PADDING * (channels - 1)) / channels;

    ctx.fillStyle = WAVEFORM_COLOR;
    for (let ch = 0; ch < channels; ch++) {
      const y0 = ch * (channelHeight + CHANNEL_PADDING);
      const y1 = y0 + channelHeight;
      PeaksPainter.renderPixelStrips(ctx, peaks, ch, {
        x0: 0,
        x1: width,
        y0,
        y1,
        u0: 0,
        u1: numberOfFrames,
        v0: -1.001,
        v1: 1.001,
      });
    }

    // Playhead marker
    const x = (startSeconds / audioBuffer.duration) * width;
    ctx.fillStyle = "#ffb020"; // amber
    ctx.fillRect(x - 1, 0, 2, WAVEFORM_HEIGHT);
  }, [peaksReady, startSeconds]);
```

- [ ] **Step 3: Add the click handler**

Below the existing callbacks (after the useEffects):

```tsx
  const handleWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!project || !audioBufferRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    const seconds = fraction * audioBufferRef.current.duration;
    setStartSeconds(seconds);
    const bpm = project.timelineBox.bpm.getValue();
    const ppqn = Math.round(PPQN.secondsToPulses(seconds, bpm));
    project.engine.setPosition(ppqn);
  };
```

- [ ] **Step 4: Wire the handler to the canvas**

Update the `<canvas>` element in the Waveform card:

```tsx
              <canvas
                ref={canvasRef}
                onClick={handleWaveformClick}
                style={{
                  width: "100%",
                  height: WAVEFORM_HEIGHT,
                  display: "block",
                  background: "#111",
                  borderRadius: 4,
                  cursor: project ? "crosshair" : "default",
                }}
              />
```

- [ ] **Step 5: Show the chosen start position**

Below the canvas, inside the same Waveform `<Card>`:

```tsx
              <Text size="2" color="gray">
                Start: {startSeconds.toFixed(3)} s
              </Text>
```

- [ ] **Step 6: Verify in the browser**

```bash
rm -rf node_modules/.vite
npm run dev
```

Open the page. Click various positions on the waveform. An amber vertical line moves to the click position. The "Start: X.XXX s" label updates. Clicking far left → near 0 s. Clicking far right → near 230.59 s.

Open DevTools, check the Console — no errors when clicking.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/demos/playback/time-pitch-start-position-debug-demo.tsx
git commit -m "feat: click waveform to set start position"
```

---

## Task 6: Play / Stop + cents slider

**Goal:** Wire a Play button (calls `engine.play()` after `audioContext.resume()`), Stop button (`engine.stop(true)`), and a cents slider (-1200..+1200) that updates the TimeStretch box's `playbackRate`. Subscribe to `engine.isPlaying` for live UI state.

**Files:**
- Modify: `src/demos/playback/time-pitch-start-position-debug-demo.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { Button, Slider, Code, Separator } from "@radix-ui/themes";
import { PlayIcon, StopIcon } from "@radix-ui/react-icons";
```

(Merge into the existing Radix imports.)

- [ ] **Step 2: Add playback state and isPlaying subscription**

Inside the `App` component:

```tsx
  const [isPlaying, setIsPlaying] = useState(false);
  const [cents, setCents] = useState(0);
```

Add a new `useEffect` for the engine subscription:

```tsx
  useEffect(() => {
    if (!project) return;
    const sub = project.engine.isPlaying.catchupAndSubscribe((obs) => {
      setIsPlaying(obs.getValue());
    });
    return () => sub.terminate();
  }, [project]);
```

- [ ] **Step 3: Add transport + cents callbacks**

```tsx
  const handlePlay = async () => {
    if (!project || !audioContext) return;
    if (audioContext.state !== "running") {
      await audioContext.resume();
    }
    // Position already set by handleWaveformClick; no need to set again.
    project.engine.play();
  };

  const handleStop = () => {
    if (!project) return;
    project.engine.stop(true);
  };

  const handleCentsChange = (value: number) => {
    if (!project) return;
    const box = stretchBoxRef.current;
    if (!box) return;
    const clamped = Math.max(-1200, Math.min(1200, value));
    const rate = Math.max(0.5, Math.min(2.0, Math.pow(2, clamped / 1200)));
    project.editing.modify(() => {
      box.playbackRate.setValue(rate);
    });
    setCents(clamped);
  };
```

- [ ] **Step 4: Add the Controls card to JSX**

Below the Waveform card, inside the main `<Flex>`:

```tsx
          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">Controls</Text>
              <Separator size="4" />
              <Flex gap="3" align="center">
                <Button
                  onClick={handlePlay}
                  disabled={!project || status !== "Ready" || isPlaying}
                  color="green"
                  size="3"
                >
                  <PlayIcon /> Play
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={!isPlaying}
                  variant="soft"
                  size="3"
                >
                  <StopIcon /> Stop
                </Button>
                {isPlaying && (
                  <Badge color="amber">Playing from {startSeconds.toFixed(3)} s</Badge>
                )}
              </Flex>

              <Flex direction="column" gap="2">
                <Flex justify="between" align="center">
                  <Text size="2">Cents (pitch offset)</Text>
                  <Code size="2">
                    {cents.toFixed(0)} c (rate{" "}
                    {Math.pow(2, cents / 1200).toFixed(4)})
                  </Code>
                </Flex>
                <Slider
                  value={[cents]}
                  onValueChange={([v]) => handleCentsChange(v)}
                  min={-1200}
                  max={1200}
                  step={1}
                  disabled={!project || status !== "Ready"}
                />
              </Flex>
            </Flex>
          </Card>
```

- [ ] **Step 5: Verify in the browser**

```bash
rm -rf node_modules/.vite
npm run dev
```

Open the page. Click somewhere on the waveform to choose a start position. Press Play — audio plays from that position (you'll hear silence if you clicked at the head of the file; vocals if you clicked into the song body). Press Stop — playback halts. Move the cents slider — pitch shifts; the rate display updates and is bounded at 0.5/2.0 when slider hits the ends.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/demos/playback/time-pitch-start-position-debug-demo.tsx
git commit -m "feat: transport controls and cents slider"
```

---

## Task 7: Add the Callout intro + Configuration summary card

**Goal:** Add a blue info Callout at the top explaining what the page is for, and a Configuration card at the bottom showing the current state in a code block (BPM, file, transients, rate, start position) — both match the existing debug-demo layout so the page screenshots well.

**Files:**
- Modify: `src/demos/playback/time-pitch-start-position-debug-demo.tsx`

- [ ] **Step 1: Add Callout imports**

Merge into the existing Radix import:

```tsx
import { Callout } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
```

- [ ] **Step 2: Add the intro Callout**

Place between the Heading and the Status card:

```tsx
          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              Hunting for a reported pop when starting playback inside a silent
              section of <Code>06_Vox.opus</Code> with{" "}
              <Code>AudioTimeStretchBox</Code> attached at{" "}
              <Code>playbackRate = 1.0</Code>. Click anywhere on the waveform to
              set the start position, then press Play. Look for a click/pop at
              the moment playback begins.
            </Callout.Text>
          </Callout.Root>
```

- [ ] **Step 3: Add the Configuration card**

After the Controls card and before `</Flex>`:

```tsx
          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Configuration</Text>
              <Separator size="4" />
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {`BPM:             ${PROJECT_BPM}
File:            ${AUDIO_FILE}
Duration:        ${
                  audioBufferRef.current
                    ? `${audioBufferRef.current.duration.toFixed(6)} s (${
                        audioBufferRef.current.numberOfChannels
                      } ch, ${audioBufferRef.current.sampleRate} Hz)`
                    : "..."
                }
Play mode:       AudioTimeStretchBox
Transients:      ${transientCount ?? "..."}
Playback rate:   ${Math.pow(2, cents / 1200).toFixed(6)} (cents=${cents.toFixed(0)})
Start position:  ${startSeconds.toFixed(3)} s`}
              </Code>
            </Flex>
          </Card>
```

- [ ] **Step 4: Verify in the browser**

Reload the page. The blue Callout appears at the top with the hunt description. The Configuration card appears at the bottom and updates live as you click positions and move the cents slider. No layout breakage.

- [ ] **Step 5: Commit**

```bash
git add src/demos/playback/time-pitch-start-position-debug-demo.tsx
git commit -m "chore: intro callout and configuration summary"
```

---

## Task 8: Write the debug note + add to debug/README.md

**Goal:** Create `debug/time-pitch-start-position-pop.md` with Symptom (suspected), Repro, and "Mechanism not yet identified" sections cross-referencing the three candidate-related notes. Add an Index entry in `debug/README.md`.

**Files:**
- Create: `debug/time-pitch-start-position-pop.md`
- Modify: `debug/README.md`

- [ ] **Step 1: Create the debug note**

`debug/time-pitch-start-position-pop.md`:

```markdown
# Time/Pitch start-position pop (suspected)

**Verified against:** OpenDAW SDK 0.0.154 (`@opendaw/studio-sdk@0.0.154`, `@opendaw/studio-core@0.0.152`, `@opendaw/studio-adapters@0.0.116`).

**Repro page:** [`time-pitch-start-position-debug-demo.html`](../time-pitch-start-position-debug-demo.html) (unlisted).

**Status:** Awaiting empirical confirmation. The page reproduces the configuration; whether the pop fires in this build has not yet been verified by ear at runtime. Update this note once it has.

## Suspected symptom

User reports an audible pop when starting playback partway into a silent section of an audio file that has `AudioTimeStretchBox` attached at `playbackRate = 1.0` (no actual stretching applied). The report was on `public/audio/DarkRide/06_Vox.opus`, which has obvious silence at the head of the file and quieter gaps between vocal phrases later on.

## How to reproduce

```bash
npm run dev
# open https://localhost:5173/time-pitch-start-position-debug-demo.html
```

**HTTPS is required.** Accept the self-signed cert warning on first load.

1. Wait for Status to reach `Ready` (includes transient detection on the full 230 s file).
2. Click near the start of the waveform (the file's silent intro).
3. Press Play. Listen for a pop at the moment playback begins.
4. Press Stop, click into the middle of the song on a known-loud section, press Play. Compare — is the pop absent or quieter when starting from audible content?
5. (Optional) Move the cents slider off zero and repeat — does the pop change with active stretching vs unit rate?

Configuration: BPM 124, single Tape track, one `AudioRegionBox` at `position = 0` with `duration = fullDurationPpqn`, `timeBase = Musical`. `AudioTimeStretchBox` attached via `playMode.refer`, with `playbackRate = 1.0`, `transientPlayMode = Pingpong`, and two default warp markers `(0, 0)` and `(durationPpqn, durationSeconds)`.

## Mechanism

**Not yet identified.** Candidate-related investigations to consider once the symptom is empirically observed and isolated:

- [`fade-out-end-of-file-pop.md`](./fade-out-end-of-file-pop.md) — `PitchVoice`'s 20 ms internal fade interacts with `lane.fadingVoices` processed at unit gain, bypassing the region fade. If voice creation at playback start follows a similar path, a start-of-play fade-in could miss the region's effective amplitude.
- [`voice-fadein-clip-fadein-product.md`](./voice-fadein-clip-fadein-product.md) — `PitchVoice` fade-in multiplies with the clip's gain buffer, turning linear ramps quadratic. Not obviously the same path, but listed for completeness if voice-fade-in processing differs under TimeStretch.
- [`splice-click-cross-file.md`](./splice-click-cross-file.md) — cross-file region boundaries click without explicit fades; mentioned only as a general "voice-boundary discontinuity" reference, not a likely match for this configuration (single file, single region).

Source-tracing should start at `TapeDeviceProcessor.#updateOrCreatePitchVoice` and the `PitchVoice` constructor's initial state; identify whether a new voice on a region with TimeStretch attached enters with a fade-in distinct from the NoStretch / PitchStretch paths.
```

- [ ] **Step 2: Add the Index entry**

In `debug/README.md`, locate the `## Index` section. Insert a new bullet alphabetically/topically — place it near the other voice/fade items, e.g. just before `splice-click-cross-file.md`:

```markdown
- [time-pitch-start-position-pop.md](./time-pitch-start-position-pop.md) — Suspected audible pop when starting playback inside silent sections of a file with `AudioTimeStretchBox` attached at `playbackRate = 1.0`. Awaiting empirical confirmation. Repro: [`time-pitch-start-position-debug-demo.html`](../time-pitch-start-position-debug-demo.html).
```

- [ ] **Step 3: Verify the docs build still works**

The `debug/` folder is plain Markdown and not part of the VitePress site, but run the build anyway to catch link warnings or other regressions:

```bash
npm run build
```

Expected: build completes without errors. The new HTML entry shows up under `dist/`.

- [ ] **Step 4: Commit**

```bash
git add debug/time-pitch-start-position-pop.md debug/README.md
git commit -m "docs: initial debug note for time-pitch start-position pop"
```

---

## Task 9: End-to-end manual verification

**Goal:** Run the page end-to-end against the dev server, listen for the pop, and produce one of two outcomes — either "we hear it" (note + spec gain runtime confirmation) or "we don't" (note updated to record the negative result and configuration tried).

**Files:**
- Modify: `debug/time-pitch-start-position-pop.md` (status update only, based on what was heard)

- [ ] **Step 1: Start the dev server**

```bash
rm -rf node_modules/.vite
npm run dev
```

- [ ] **Step 2: Open the page and run the listening protocol**

Open `https://localhost:5173/time-pitch-start-position-debug-demo.html` in a browser with audio output you trust (good headphones recommended; the pop reported is described as subtle).

Run the protocol from the debug note's "How to reproduce" section:

1. Wait for `Ready` status. Note the transient count.
2. **Silence at head:** Click at the far-left of the waveform (within the first 1–2 s). Press Play. Listen. Press Stop after ~2 s of audio.
3. **Loud content:** Click into a known-loud vocal peak (somewhere mid-waveform where the peaks are tall). Press Play. Listen. Press Stop.
4. **Mid-file silence:** Click into a quieter gap between vocal phrases (look for low-amplitude sections). Press Play. Listen.
5. Repeat steps 2 and 4 at cents = -300, 0, +300 to check whether active stretching matters.

- [ ] **Step 3: Update the debug note based on outcome**

**If the pop is audible:**

Edit `debug/time-pitch-start-position-pop.md`:
- Change `**Status:**` to `**Status:** Empirically confirmed.` and add details: at which start positions, at which cents values, approximate level.
- Remove the "Awaiting empirical confirmation" sentence.
- If a mechanism becomes clear from source-tracing, add it. If not, leave the Mechanism section as "not yet identified" but with a sharper "what was observed" record.

**If the pop is NOT audible:**

Edit `debug/time-pitch-start-position-pop.md`:
- Change `**Status:**` to `**Status:** Not reproduced in this configuration as of YYYY-MM-DD.`
- Add a "Configurations tried" section listing the BPM, cents values, and start positions exercised.
- Keep the page in the repo; the negative result is a useful record per the debug convention.

- [ ] **Step 4: Commit the status update**

```bash
git add debug/time-pitch-start-position-pop.md
git commit -m "docs: record empirical outcome of pop hunt"
```

- [ ] **Step 5: Push the branch**

```bash
git push -u origin debug/time-pitch-start-position-pop
```

- [ ] **Step 6: Open a draft PR**

```bash
gh pr create --draft --title "debug: time-pitch start-position pop repro" --body "$(cat <<'EOF'
## Summary

- Adds an unlisted debug repro page (`time-pitch-start-position-debug-demo.html`) that loads `06_Vox.opus`, attaches `AudioTimeStretchBox` at `playbackRate = 1.0`, renders a click-to-set-position waveform, and lets the user start playback at any point.
- Adds `debug/time-pitch-start-position-pop.md` documenting the suspected symptom and repro protocol, with the empirical outcome recorded after manual listening.
- Spec at `docs/superpowers/specs/2026-06-09-time-pitch-start-position-pop-design.md`.

## Test plan

- [ ] `npm run build` completes cleanly.
- [ ] Page loads at `https://localhost:5173/time-pitch-start-position-debug-demo.html` with HTTPS.
- [ ] Status reaches `Ready` (includes transient detection on a 230 s file).
- [ ] Stereo waveform renders, click sets the start position with an amber marker.
- [ ] Play / Stop work; cents slider shifts pitch.
- [ ] Debug note describes the empirical outcome (heard / not heard) accurately.
EOF
)"
```

Mark "Ready for review" once the empirical outcome is confirmed and the note reflects it.

---

## Self-review notes

- **Spec coverage:** All sections of the spec (goal, user flow, architecture, file layout, verification, risks) are covered by Tasks 1–8. Risks are flagged in the spec and surface during Task 9 verification (peaks readiness lag → handled in Task 4's one-shot subscribe; click-while-playing seek behaviour → exercised in Task 9 step 5).
- **Placeholder scan:** Clean. `sampleManager.getOrCreate(uuid)` is the established pattern in this repo (used by `useWaveformRendering.ts:281`, `drum-scheduling-demo.tsx:257`, `timebase-demo.tsx:109`) — no fallback path needed.
- **Type consistency:** `stretchBoxRef` is `AudioTimeStretchBox | null` everywhere. `audioFileBoxRef` is `AudioFileBox | null`. `regionRef` is `AudioRegionBox | null`. Refs are introduced in Task 3 and used in Tasks 4, 5, 6 with consistent names.
- **No tests:** Project has no test infra (no Vitest / Playwright in `package.json`) and the existing debug demos rely on manual verification. Each task ends with a manual browser check; Task 9 is the formal end-to-end protocol. Aligns with the project convention.
