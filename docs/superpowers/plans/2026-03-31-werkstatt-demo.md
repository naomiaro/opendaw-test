# Werkstatt Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page demo showcasing Werkstatt scriptable audio effects with an effect showcase (5 pre-built effects) and an API reference section with loadable code examples.

**Architecture:** Single React component (`werkstatt-demo.tsx`) loads one Dark Ride drum stem, applies Werkstatt effects via `EffectFactories.Werkstatt`, and manages effect lifecycle (insert/delete/parameter updates). A test signal generator uses a second Werkstatt in the chain. Reuses existing hooks (`useTransportControls`, `usePlaybackPosition`) and project setup utilities.

**Tech Stack:** React, Radix UI, OpenDAW SDK (`@opendaw/studio-core`, `@opendaw/studio-boxes`, `@opendaw/studio-adapters`, `@opendaw/lib-dsp`, `@opendaw/lib-fusion`, `@opendaw/lib-dom`)

---

## File Structure

| File | Responsibility |
|---|---|
| `werkstatt-demo.html` | HTML entry point |
| `src/werkstatt-demo.tsx` | Main page component — init, layout, state, transport |
| `src/lib/werkstattScripts.ts` | All Werkstatt DSP scripts as string constants + param metadata |
| `vite.config.ts` | Add build entry (modify) |
| `src/index.tsx` | Add homepage card (modify) |

---

### Task 1: Create Werkstatt DSP scripts module

**Files:**
- Create: `src/lib/werkstattScripts.ts`

This module contains all Werkstatt JavaScript DSP code as string constants, plus metadata for the showcase cards and API reference sections. Centralizing scripts here keeps the main component clean.

- [ ] **Step 1: Create the scripts file with showcase effect scripts**

```typescript
// src/lib/werkstattScripts.ts

// ---------------------------------------------------------------------------
// Showcase effect scripts
// ---------------------------------------------------------------------------

export interface ShowcaseEffect {
  name: string;
  description: string;
  script: string;
}

export const SHOWCASE_EFFECTS: ShowcaseEffect[] = [
  {
    name: "Tremolo",
    description: "Amplitude modulation via LFO",
    script: `// @param rate 4 0.5 20 exp Hz
// @param depth 0.5

class Processor {
  rate = 4
  depth = 0.5
  phase = 0

  paramChanged(label, value) {
    if (label === "rate") this.rate = value
    if (label === "depth") this.depth = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const phaseInc = this.rate / sampleRate
    for (let i = s0; i < s1; i++) {
      const lfo = 1 - this.depth * (0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI))
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = srcL[i] * lfo
      outR[i] = srcR[i] * lfo
    }
  }
}`,
  },
  {
    name: "Ring Modulator",
    description: "Frequency-domain multiplication with a sine carrier",
    script: `// @param frequency 440 20 20000 exp Hz
// @param mix 0.5

class Processor {
  frequency = 440
  mix = 0.5
  phase = 0

  paramChanged(label, value) {
    if (label === "frequency") this.frequency = value
    if (label === "mix") this.mix = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const phaseInc = this.frequency / sampleRate
    for (let i = s0; i < s1; i++) {
      const mod = Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      const wet = this.mix
      const dry = 1 - wet
      outL[i] = srcL[i] * dry + srcL[i] * mod * wet
      outR[i] = srcR[i] * dry + srcR[i] * mod * wet
    }
  }
}`,
  },
  {
    name: "Lowpass Filter",
    description: "Classic 2nd-order biquad IIR lowpass",
    script: `// @param cutoff 1000 20 20000 exp Hz
// @param resonance 0.707 0.1 20 exp

class Processor {
  cutoff = 1000
  resonance = 0.707
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0
  xL1 = 0; xL2 = 0; yL1 = 0; yL2 = 0
  xR1 = 0; xR2 = 0; yR1 = 0; yR2 = 0

  paramChanged(label, value) {
    if (label === "cutoff") this.cutoff = value
    if (label === "resonance") this.resonance = value
    this.recalc()
  }

  recalc() {
    const w0 = 2 * Math.PI * this.cutoff / sampleRate
    const alpha = Math.sin(w0) / (2 * this.resonance)
    const cosw0 = Math.cos(w0)
    const a0 = 1 + alpha
    this.b0 = ((1 - cosw0) / 2) / a0
    this.b1 = (1 - cosw0) / a0
    this.b2 = this.b0
    this.a1 = (-2 * cosw0) / a0
    this.a2 = (1 - alpha) / a0
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      const xL = srcL[i]
      outL[i] = this.b0*xL + this.b1*this.xL1 + this.b2*this.xL2 - this.a1*this.yL1 - this.a2*this.yL2
      this.xL2 = this.xL1; this.xL1 = xL; this.yL2 = this.yL1; this.yL1 = outL[i]
      const xR = srcR[i]
      outR[i] = this.b0*xR + this.b1*this.xR1 + this.b2*this.xR2 - this.a1*this.yR1 - this.a2*this.yR2
      this.xR2 = this.xR1; this.xR1 = xR; this.yR2 = this.yR1; this.yR1 = outR[i]
    }
  }
}`,
  },
  {
    name: "Chorus",
    description: "Modulated delay line for stereo widening",
    script: `// @param rate 1.5 0.1 10 exp Hz
// @param depth 0.5
// @param mix 0.5

class Processor {
  rate = 1.5
  depth = 0.5
  mix = 0.5
  phase = 0
  bufL = new Float32Array(4096)
  bufR = new Float32Array(4096)
  writePos = 0

  paramChanged(label, value) {
    if (label === "rate") this.rate = value
    if (label === "depth") this.depth = value
    if (label === "mix") this.mix = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const maxDelay = 2048
    const phaseInc = this.rate / sampleRate
    const mask = 4095
    for (let i = s0; i < s1; i++) {
      this.bufL[this.writePos & mask] = srcL[i]
      this.bufR[this.writePos & mask] = srcR[i]
      const lfo = 0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      const delaySamples = 256 + lfo * this.depth * maxDelay
      const readPos = this.writePos - delaySamples
      const idx = Math.floor(readPos) & mask
      const frac = readPos - Math.floor(readPos)
      const idx1 = (idx + 1) & mask
      const wetL = this.bufL[idx] * (1 - frac) + this.bufL[idx1] * frac
      const wetR = this.bufR[idx] * (1 - frac) + this.bufR[idx1] * frac
      outL[i] = srcL[i] * (1 - this.mix) + wetL * this.mix
      outR[i] = srcR[i] * (1 - this.mix) + wetR * this.mix
      this.writePos++
    }
  }
}`,
  },
  {
    name: "Phaser",
    description: "All-pass filter chain with LFO modulation",
    script: `// @param rate 0.5 0.1 10 exp Hz
// @param depth 0.5
// @param stages 4 2 12 int

class Processor {
  rate = 0.5
  depth = 0.5
  stages = 4
  phase = 0
  apL = new Float64Array(12)
  apR = new Float64Array(12)

  paramChanged(label, value) {
    if (label === "rate") this.rate = value
    if (label === "depth") this.depth = value
    if (label === "stages") this.stages = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const phaseInc = this.rate / sampleRate
    for (let i = s0; i < s1; i++) {
      const lfo = 0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      const minFreq = 200
      const maxFreq = 4000
      const freq = minFreq + lfo * this.depth * (maxFreq - minFreq)
      const coeff = (Math.tan(Math.PI * freq / sampleRate) - 1) / (Math.tan(Math.PI * freq / sampleRate) + 1)
      let sL = srcL[i]
      let sR = srcR[i]
      for (let s = 0; s < this.stages; s++) {
        const inL = sL
        sL = coeff * sL + this.apL[s] - coeff * this.apL[s]
        this.apL[s] = inL
        const inR = sR
        sR = coeff * sR + this.apR[s] - coeff * this.apR[s]
        this.apR[s] = inR
      }
      outL[i] = 0.5 * (srcL[i] + sL)
      outR[i] = 0.5 * (srcR[i] + sR)
    }
  }
}`,
  },
];

// ---------------------------------------------------------------------------
// Test signal generator scripts
// ---------------------------------------------------------------------------

export const SINE_GENERATOR_SCRIPT = `// @param frequency 440 20 2000 exp Hz

class Processor {
  frequency = 440
  phase = 0

  paramChanged(label, value) {
    if (label === "frequency") this.frequency = value
  }

  process({src, out}, {s0, s1}) {
    const [, ] = src
    const [outL, outR] = out
    const phaseInc = this.frequency / sampleRate
    for (let i = s0; i < s1; i++) {
      const sample = 0.3 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = sample
      outR[i] = sample
    }
  }
}`;

export const NOISE_GENERATOR_SCRIPT = `class Processor {
  seed = 1

  process({src, out}, {s0, s1}) {
    const [, ] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
      const sample = 0.3 * (this.seed / 0x7fffffff * 2 - 1)
      outL[i] = sample
      outR[i] = sample
    }
  }
}`;

// ---------------------------------------------------------------------------
// API Reference examples
// ---------------------------------------------------------------------------

export interface ApiExample {
  id: string;
  title: string;
  description: string;
  script: string | null; // null = no loadable script (reference-only)
}

export const API_EXAMPLES: ApiExample[] = [
  {
    id: "processor-class",
    title: "The Processor Class",
    description:
      "Every Werkstatt script must define a Processor class with a process() method. " +
      "The first argument provides src (input channels) and out (output channels) as Float32Array arrays. " +
      "The second argument provides s0 (first sample index, inclusive) and s1 (last sample index, exclusive).",
    script: `class Processor {
  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i]
      outR[i] = srcR[i]
    }
  }
}`,
  },
  {
    id: "param-declarations",
    title: "Parameter Declarations",
    description:
      "Declare parameters with // @param comments. The SDK creates UI knobs and calls paramChanged(label, value) when they change. " +
      "Formats: unipolar (0-1), linear (min-max), exp (exponential), int (integer), bool (on/off).",
    script: `// @param gain 1.0
// @param mix 0.5 0 1 linear
// @param cutoff 1000 20 20000 exp Hz
// @param steps 4 1 16 int
// @param bypass false

class Processor {
  gain = 1
  mix = 0.5
  cutoff = 1000
  steps = 4
  bypass = 0

  paramChanged(label, value) {
    this[label] = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i] * this.gain
      outR[i] = srcR[i] * this.gain
    }
  }
}`,
  },
  {
    id: "block-object",
    title: "The Block Object",
    description:
      "The second argument to process() contains timing and transport info: " +
      "s0/s1 (sample range), index (block counter), bpm (tempo), p0/p1 (PPQN position), " +
      "flags (bitmask: 1=transporting, 2=discontinuous, 4=playing, 8=bpmChanged).",
    script: `// @param depth 0.5

class Processor {
  depth = 0.5
  phase = 0

  paramChanged(label, value) {
    if (label === "depth") this.depth = value
  }

  process({src, out}, block) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    // Tempo-synced tremolo: rate = 1/4 note = bpm/60 Hz
    const rate = block.bpm / 60
    const phaseInc = rate / sampleRate
    for (let i = block.s0; i < block.s1; i++) {
      const lfo = 1 - this.depth * (0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI))
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = srcL[i] * lfo
      outR[i] = srcR[i] * lfo
    }
  }
}`,
  },
  {
    id: "sample-rate",
    title: "The sampleRate Global",
    description:
      "sampleRate is the only global variable available in a Werkstatt script. " +
      "It reflects the AudioContext sample rate (typically 44100 or 48000). " +
      "Use it to compute phase increments, filter coefficients, and delay times.",
    script: `// @param frequency 440 20 2000 exp Hz

class Processor {
  frequency = 440
  phase = 0

  paramChanged(label, value) {
    if (label === "frequency") this.frequency = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    // Phase increment = frequency / sampleRate
    // One full cycle (0 to 1) = one period of the wave
    const phaseInc = this.frequency / sampleRate
    for (let i = s0; i < s1; i++) {
      const osc = 0.2 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = srcL[i] + osc
      outR[i] = srcR[i] + osc
    }
  }
}`,
  },
  {
    id: "safety",
    title: "Safety Constraints",
    description:
      "Werkstatt scripts run in an AudioWorklet thread. " +
      "No DOM access, no fetch/setTimeout/imports. " +
      "Never allocate memory inside process() — no new, no array/object literals, no closures, no string concatenation (causes GC pauses). " +
      "Output is validated every block: NaN or amplitude > 1000 (~60dB) silences the processor. " +
      "JavaScript only — no WASM.",
    script: null,
  },
];
```

- [ ] **Step 2: Verify the file has no syntax errors**

Run: `npx tsc --noEmit --esModuleInterop --moduleResolution node --jsx react-jsx src/lib/werkstattScripts.ts 2>&1 || echo "TypeScript not standalone — will verify via Vite build later"`

Expected: The file is pure TypeScript with no SDK imports, so it should parse cleanly. If `tsc` isn't available standalone, the Vite build in a later task will catch errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/werkstattScripts.ts
git commit -m "feat(werkstatt): add DSP scripts module with showcase effects and API examples"
```

---

### Task 2: Create HTML entry point and build integration

**Files:**
- Create: `werkstatt-demo.html`
- Modify: `vite.config.ts:38`

- [ ] **Step 1: Create the HTML entry point**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Werkstatt Scriptable FX - OpenDAW</title>
    <meta name="description" content="Write custom audio effects in JavaScript with OpenDAW's Werkstatt scriptable effect. Browse pre-built effects and explore the API with runnable examples." />
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
<script type="module" src="/src/werkstatt-demo.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Add build entry to vite.config.ts**

In `vite.config.ts`, add the werkstatt entry after the `clipLooping` line (around line 38):

```typescript
// Before:
                clipLooping: resolve(__dirname, "clip-looping-demo.html")

// After:
                clipLooping: resolve(__dirname, "clip-looping-demo.html"),
                werkstatt: resolve(__dirname, "werkstatt-demo.html")
```

- [ ] **Step 3: Commit**

```bash
git add werkstatt-demo.html vite.config.ts
git commit -m "feat(werkstatt): add HTML entry point and vite build config"
```

---

### Task 3: Create main demo component — initialization and transport

**Files:**
- Create: `src/werkstatt-demo.tsx`

This task creates the component with project initialization, drum stem loading with waveformOffset, and transport controls. No effects yet — just audio playback of the offset drums.

- [ ] **Step 1: Create the main demo component with initialization**

```tsx
// src/werkstatt-demo.tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { AudioRegionBox, AudioUnitBox, WerkstattDeviceBox } from "@opendaw/studio-boxes";
import type { Peaks } from "@opendaw/lib-fusion";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { usePlaybackPosition } from "./hooks/usePlaybackPosition";
import { useTransportControls } from "./hooks/useTransportControls";
import {
  SHOWCASE_EFFECTS,
  SINE_GENERATOR_SCRIPT,
  NOISE_GENERATOR_SCRIPT,
  API_EXAMPLES,
} from "./lib/werkstattScripts";
import type { ShowcaseEffect } from "./lib/werkstattScripts";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Button,
  Callout, Badge, Separator, Slider, Code, SegmentedControl,
  Box as RadixBox,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon, PauseIcon, StopIcon } from "@radix-ui/react-icons";

const BPM = 124;
const BAR = PPQN.fromSignature(4, 4); // 3840
const CONTENT_START = BAR * 24; // bar 25 — where full drum pattern starts

type AudioSource = "drums" | "sine" | "noise";

const App: React.FC = () => {
  // Core state
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [status, setStatus] = useState("Click Start to initialize audio...");
  const [isInitialized, setIsInitialized] = useState(false);

  // Audio source
  const [audioSource, setAudioSource] = useState<AudioSource>("drums");

  // Showcase state
  const [activeEffect, setActiveEffect] = useState<string | null>(null);
  const [effectParams, setEffectParams] = useState<Record<string, number>>({});

  // Refs for SDK objects (not in React state to avoid unnecessary re-renders)
  const audioBoxRef = useRef<AudioUnitBox | null>(null);
  const regionBoxRef = useRef<AudioRegionBox | null>(null);
  const werkstattBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const generatorBoxRef = useRef<WerkstattDeviceBox | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [fullAudioPpqn, setFullAudioPpqn] = useState(0);

  // Transport hooks
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext,
    pausedPositionRef,
  });

  // --- Initialization ---
  const handleInit = useCallback(async () => {
    if (isInitialized) return;
    setStatus("Initializing audio engine...");

    try {
      const localAudioBuffers = new Map<string, AudioBuffer>();
      localAudioBuffersRef.current = localAudioBuffers;

      const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
        localAudioBuffers,
        bpm: BPM,
        onStatusUpdate: setStatus,
      });

      setAudioContext(newAudioContext);
      setProject(newProject);

      const settings = newProject.engine.preferences.settings;
      settings.metronome.enabled = false;

      const ext = getAudioExtension();
      setStatus("Loading drums...");
      const tracks = await loadTracksFromFiles(
        newProject,
        newAudioContext,
        [{ name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` }],
        localAudioBuffers,
        { onProgress: (c, t, name) => setStatus(`Loading ${name}...`) }
      );

      if (tracks.length === 0) {
        setStatus("Failed to load audio.");
        return;
      }

      // Find the audio region and audio unit
      const boxes = newProject.boxGraph.boxes();
      let foundRegion: AudioRegionBox | null = null;
      for (const box of boxes) {
        if (box instanceof AudioRegionBox) {
          foundRegion = box;
          break;
        }
      }

      if (!foundRegion) {
        setStatus("No audio region found.");
        return;
      }

      const audioPpqn = foundRegion.duration.getValue();
      setFullAudioPpqn(audioPpqn);
      regionBoxRef.current = foundRegion;
      audioBoxRef.current = tracks[0].audioUnitBox;

      // Apply waveformOffset to skip silence (bar 25)
      const waveformOffsetSeconds = PPQN.pulsesToSeconds(CONTENT_START, BPM);
      const playbackDuration = BAR * 16; // 16 bars of drums
      newProject.editing.modify(() => {
        foundRegion!.position.setValue(0);
        foundRegion!.loopOffset.setValue(0);
        foundRegion!.duration.setValue(playbackDuration);
        foundRegion!.loopDuration.setValue(playbackDuration);
        foundRegion!.waveformOffset.setValue(waveformOffsetSeconds);
      });

      // Timeline loop
      newProject.editing.modify(() => {
        newProject.timelineBox.loopArea.from.setValue(0);
        newProject.timelineBox.loopArea.to.setValue(playbackDuration);
        newProject.timelineBox.loopArea.enabled.setValue(true);
        newProject.timelineBox.durationInPulses.setValue(playbackDuration);
      });

      // Subscribe for peaks
      const track = tracks[0];
      const sampleLoader = newProject.sampleManager.getOrCreate(track.uuid);
      const sub = sampleLoader.subscribe((state: any) => {
        if (state.type === "loaded") {
          const peaksOpt = sampleLoader.peaks;
          if (!peaksOpt.isEmpty()) {
            setPeaks(peaksOpt.unwrap());
          }
          sub.terminate();
        }
      });
      // Check if already loaded
      const peaksOpt = sampleLoader.peaks;
      if (!peaksOpt.isEmpty()) {
        setPeaks(peaksOpt.unwrap());
        sub.terminate();
      }

      setIsInitialized(true);
      setStatus("Ready");
    } catch (err) {
      console.error("Init failed:", err);
      setStatus(`Error: ${err}`);
    }
  }, [isInitialized]);

  // --- Render ---
  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          <Flex direction="column" gap="2">
            <Heading size="8">Werkstatt &mdash; Scriptable Audio Effects</Heading>
            <Text size="3" color="gray">
              Write custom audio effects in JavaScript that run in the AudioWorklet thread.
              Browse pre-built effects or explore the API with runnable code examples.
            </Text>
          </Flex>

          {!isInitialized ? (
            <Card>
              <Flex direction="column" align="center" gap="3" p="6">
                <Text size="3">{status}</Text>
                <Button size="3" onClick={handleInit}>
                  Start Audio Engine
                </Button>
              </Flex>
            </Card>
          ) : (
            <>
              {/* Transport */}
              <Flex gap="2" align="center">
                <Button
                  variant={isPlaying ? "soft" : "solid"}
                  onClick={isPlaying ? handlePause : handlePlay}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  {isPlaying ? "Pause" : "Play"}
                </Button>
                <Button variant="soft" onClick={handleStop}>
                  <StopIcon /> Stop
                </Button>
                <Text size="2" color="gray" ml="3">
                  Bar {Math.floor(currentPosition / BAR) + 1}, Beat{" "}
                  {Math.floor((currentPosition % BAR) / (BAR / 4)) + 1}
                </Text>
              </Flex>

              {/* Placeholder for showcase and API ref sections */}
              <Text size="2" color="gray">Effect showcase and API reference sections coming next...</Text>
            </>
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

- [ ] **Step 2: Verify the demo loads in the browser**

Run: `npm run dev`

Open `https://localhost:5173/werkstatt-demo.html` in the browser. Click "Start Audio Engine". Verify:
- Audio engine initializes
- Drums load
- Play/Pause/Stop transport works
- Drums play from bar 25 (full drum pattern, not silence)

- [ ] **Step 3: Commit**

```bash
git add src/werkstatt-demo.tsx
git commit -m "feat(werkstatt): add main component with drum loading and transport"
```

---

### Task 4: Add effect showcase section

**Files:**
- Modify: `src/werkstatt-demo.tsx`

Add the showcase UI: 5 effect cards, parameter sliders, and code display. Clicking a card inserts the Werkstatt effect, and parameter sliders update values via the SDK.

- [ ] **Step 1: Add Werkstatt effect lifecycle functions**

Add these functions inside the `App` component, after the transport hooks and before the `handleInit` callback:

```tsx
  // --- Werkstatt effect management ---
  const loadShowcaseEffect = useCallback((effect: ShowcaseEffect) => {
    if (!project || !audioBoxRef.current) return;

    // Delete existing showcase effect
    if (werkstattBoxRef.current) {
      project.editing.modify(() => {
        werkstattBoxRef.current!.delete();
      });
      werkstattBoxRef.current = null;
    }

    // Insert new Werkstatt effect
    let newBox: WerkstattDeviceBox | null = null;
    project.editing.modify(() => {
      const effectBox = project.api.insertEffect(
        audioBoxRef.current!.audioEffects,
        EffectFactories.Werkstatt
      );
      newBox = effectBox as WerkstattDeviceBox;
      newBox.label.setValue(effect.name);
      newBox.code.setValue(effect.script);
    });

    werkstattBoxRef.current = newBox;
    setActiveEffect(effect.name);

    // Read initial parameter values from the WerkstattParameterBoxes
    // Parameters are created by the SDK when code is set
    // Give SDK a frame to create parameter boxes, then read them
    requestAnimationFrame(() => {
      if (!newBox) return;
      const params: Record<string, number> = {};
      const paramPointers = newBox.parameters.pointerHub.incoming();
      for (const pointer of paramPointers) {
        const paramBox = pointer.box as any;
        const label = paramBox.label?.getValue?.();
        const value = paramBox.value?.getValue?.();
        if (label != null && value != null) {
          params[label] = value;
        }
      }
      setEffectParams(params);
    });
  }, [project]);

  const updateEffectParam = useCallback((paramName: string, value: number) => {
    if (!project || !werkstattBoxRef.current) return;

    const paramPointers = werkstattBoxRef.current.parameters.pointerHub.incoming();
    for (const pointer of paramPointers) {
      const paramBox = pointer.box as any;
      if (paramBox.label?.getValue?.() === paramName) {
        project.editing.modify(() => {
          paramBox.value.setValue(value);
        });
        break;
      }
    }

    setEffectParams(prev => ({ ...prev, [paramName]: value }));
  }, [project]);

  const clearShowcaseEffect = useCallback(() => {
    if (!project || !werkstattBoxRef.current) return;
    project.editing.modify(() => {
      werkstattBoxRef.current!.delete();
    });
    werkstattBoxRef.current = null;
    setActiveEffect(null);
    setEffectParams({});
  }, [project]);
```

- [ ] **Step 2: Add the showcase UI section**

Replace the placeholder text `{/* Placeholder for showcase and API ref sections */}` and the Text below it with:

```tsx
              {/* Effect Showcase */}
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center">
                  <Heading size="6">Effect Showcase</Heading>
                  {activeEffect && (
                    <Button variant="ghost" size="1" onClick={clearShowcaseEffect}>
                      Clear Effect
                    </Button>
                  )}
                </Flex>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
                  {SHOWCASE_EFFECTS.map((effect) => (
                    <Card
                      key={effect.name}
                      style={{
                        cursor: "pointer",
                        border: activeEffect === effect.name
                          ? "2px solid var(--accent-9)"
                          : "2px solid transparent",
                      }}
                      onClick={() => loadShowcaseEffect(effect)}
                    >
                      <Flex direction="column" gap="1" p="2">
                        <Text size="2" weight="bold">{effect.name}</Text>
                        <Text size="1" color="gray">{effect.description}</Text>
                      </Flex>
                    </Card>
                  ))}
                </div>

                {/* Parameter sliders */}
                {activeEffect && Object.keys(effectParams).length > 0 && (
                  <Card>
                    <Flex direction="column" gap="3" p="3">
                      <Text size="2" weight="bold">Parameters</Text>
                      {Object.entries(effectParams).map(([name, value]) => {
                        // Parse param metadata from the active script
                        const effect = SHOWCASE_EFFECTS.find(e => e.name === activeEffect);
                        const paramLine = effect?.script
                          .split("\n")
                          .find(line => line.startsWith(`// @param ${name}`));
                        const parts = paramLine?.split(/\s+/) || [];
                        // // @param name [default] [min max type [unit]]
                        const min = parts.length >= 5 ? parseFloat(parts[4]) : 0;
                        const max = parts.length >= 6 ? parseFloat(parts[5]) : 1;
                        const unit = parts.length >= 8 ? parts[7] : "";
                        const step = parts[6] === "int" ? 1 : (max - min) / 200;

                        return (
                          <Flex key={name} direction="column" gap="1">
                            <Flex justify="between">
                              <Text size="1" color="gray">{name}</Text>
                              <Text size="1" color="gray">
                                {parts[6] === "int" ? value.toFixed(0) : value.toFixed(2)}{unit ? ` ${unit}` : ""}
                              </Text>
                            </Flex>
                            <Slider
                              min={min}
                              max={max}
                              step={step}
                              value={[value]}
                              onValueChange={([v]) => updateEffectParam(name, v)}
                            />
                          </Flex>
                        );
                      })}
                    </Flex>
                  </Card>
                )}

                {/* Code display */}
                {activeEffect && (
                  <Card>
                    <Flex direction="column" gap="2" p="3">
                      <Text size="2" weight="bold">Source Code</Text>
                      <pre style={{
                        margin: 0,
                        padding: "1rem",
                        backgroundColor: "var(--gray-2)",
                        borderRadius: "var(--radius-2)",
                        overflow: "auto",
                        fontSize: "0.8rem",
                        lineHeight: 1.5,
                      }}>
                        <code>{SHOWCASE_EFFECTS.find(e => e.name === activeEffect)?.script}</code>
                      </pre>
                    </Flex>
                  </Card>
                )}
              </Flex>

              <Separator size="4" />

              {/* API Reference placeholder */}
              <Text size="2" color="gray">API Reference section coming next...</Text>
```

- [ ] **Step 3: Verify the showcase in the browser**

Run: `npm run dev`

Open the demo. After initializing:
1. Click each of the 5 effect cards — verify each loads and audio changes
2. Move parameter sliders — verify audio responds in real-time
3. Click a different effect card — verify the previous one is replaced
4. Click "Clear Effect" — verify effect is removed and dry drums play

- [ ] **Step 4: Commit**

```bash
git add src/werkstatt-demo.tsx
git commit -m "feat(werkstatt): add effect showcase with parameter sliders and code display"
```

---

### Task 5: Add audio source toggle (Drums / Sine / Noise)

**Files:**
- Modify: `src/werkstatt-demo.tsx`

Add the segmented control to switch between drum audio and generated test signals. The generator is a separate Werkstatt effect inserted before the showcase effect in the chain.

- [ ] **Step 1: Add the audio source switching logic**

Add this callback inside the `App` component, after `clearShowcaseEffect`:

```tsx
  const switchAudioSource = useCallback((source: AudioSource) => {
    if (!project || !audioBoxRef.current) return;

    // Remove existing generator
    if (generatorBoxRef.current) {
      project.editing.modify(() => {
        generatorBoxRef.current!.delete();
      });
      generatorBoxRef.current = null;
    }

    if (source === "sine" || source === "noise") {
      // Mute the drum region so only the generator is heard
      if (regionBoxRef.current) {
        project.editing.modify(() => {
          regionBoxRef.current!.mute.setValue(true);
        });
      }

      // Insert generator Werkstatt at the beginning of the effect chain
      const script = source === "sine" ? SINE_GENERATOR_SCRIPT : NOISE_GENERATOR_SCRIPT;
      let genBox: WerkstattDeviceBox | null = null;
      project.editing.modify(() => {
        const effectBox = project.api.insertEffect(
          audioBoxRef.current!.audioEffects,
          EffectFactories.Werkstatt
        );
        genBox = effectBox as WerkstattDeviceBox;
        genBox.label.setValue(source === "sine" ? "Sine Generator" : "Noise Generator");
        genBox.code.setValue(script);
        // Move to index 0 so it runs before the showcase effect
        genBox.index.setValue(0);
      });
      generatorBoxRef.current = genBox;
    } else {
      // Drums: unmute the region
      if (regionBoxRef.current) {
        project.editing.modify(() => {
          regionBoxRef.current!.mute.setValue(false);
        });
      }
    }

    setAudioSource(source);
  }, [project]);
```

- [ ] **Step 2: Add the segmented control UI**

Add this right before the transport controls `<Flex gap="2" align="center">`:

```tsx
              {/* Audio Source Selector */}
              <Flex gap="3" align="center">
                <Text size="2" weight="bold">Audio Source</Text>
                <SegmentedControl.Root
                  value={audioSource}
                  onValueChange={(v) => switchAudioSource(v as AudioSource)}
                >
                  <SegmentedControl.Item value="drums">Drums</SegmentedControl.Item>
                  <SegmentedControl.Item value="sine">Sine</SegmentedControl.Item>
                  <SegmentedControl.Item value="noise">Noise</SegmentedControl.Item>
                </SegmentedControl.Root>
              </Flex>
```

- [ ] **Step 3: Verify audio source switching in the browser**

Run: `npm run dev`

1. Start audio engine and hit Play
2. Switch to "Sine" — should hear a 440Hz sine tone
3. Load a showcase effect (e.g., Lowpass Filter) — should hear the filter on the sine
4. Switch to "Noise" — should hear filtered noise
5. Switch back to "Drums" — should hear filtered drums
6. Clear effect — should hear dry drums

- [ ] **Step 4: Commit**

```bash
git add src/werkstatt-demo.tsx
git commit -m "feat(werkstatt): add audio source toggle (drums/sine/noise)"
```

---

### Task 6: Add API Reference section

**Files:**
- Modify: `src/werkstatt-demo.tsx`

Add the collapsible API reference accordion with loadable code examples.

- [ ] **Step 1: Add the loadApiExample function**

Add this callback inside the `App` component, after `switchAudioSource`:

```tsx
  const loadApiExample = useCallback((script: string) => {
    if (!project || !audioBoxRef.current) return;

    // Delete existing showcase effect
    if (werkstattBoxRef.current) {
      project.editing.modify(() => {
        werkstattBoxRef.current!.delete();
      });
      werkstattBoxRef.current = null;
    }

    // Insert the API example as a Werkstatt effect
    let newBox: WerkstattDeviceBox | null = null;
    project.editing.modify(() => {
      const effectBox = project.api.insertEffect(
        audioBoxRef.current!.audioEffects,
        EffectFactories.Werkstatt
      );
      newBox = effectBox as WerkstattDeviceBox;
      newBox.label.setValue("API Example");
      newBox.code.setValue(script);
    });

    werkstattBoxRef.current = newBox;
    setActiveEffect(null); // Deselect showcase cards
    setEffectParams({});

    // Read params after SDK processes the code
    requestAnimationFrame(() => {
      if (!newBox) return;
      const params: Record<string, number> = {};
      const paramPointers = newBox.parameters.pointerHub.incoming();
      for (const pointer of paramPointers) {
        const paramBox = pointer.box as any;
        const label = paramBox.label?.getValue?.();
        const value = paramBox.value?.getValue?.();
        if (label != null && value != null) {
          params[label] = value;
        }
      }
      setEffectParams(params);
    });
  }, [project]);
```

- [ ] **Step 2: Replace the API reference placeholder**

Replace the API reference placeholder `<Text size="2" color="gray">API Reference section coming next...</Text>` with:

```tsx
              {/* API Reference */}
              <Flex direction="column" gap="4">
                <Heading size="6">API Reference</Heading>
                <Text size="2" color="gray">
                  Each section below documents a part of the Werkstatt API. Click "Load" to hear
                  the example applied to the current audio source.
                </Text>

                {API_EXAMPLES.map((example) => (
                  <Card key={example.id}>
                    <Flex direction="column" gap="3" p="3">
                      <Flex justify="between" align="center">
                        <Heading size="4">{example.title}</Heading>
                        {example.script && (
                          <Button
                            variant="soft"
                            size="1"
                            onClick={() => loadApiExample(example.script!)}
                          >
                            Load
                          </Button>
                        )}
                      </Flex>

                      <Text size="2" color="gray">{example.description}</Text>

                      {example.id === "param-declarations" && (
                        <RadixBox>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--gray-6)" }}>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Declaration</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Type</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Range</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>Default</th>
                                <th style={{ textAlign: "left", padding: "0.5rem" }}>paramChanged receives</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                ["// @param gain", "unipolar", "0\u20131", "0", "0.0\u20131.0"],
                                ["// @param gain 0.5", "unipolar", "0\u20131", "0.5", "0.0\u20131.0"],
                                ["// @param time 500 1 2000", "linear", "1\u20132000", "500", "raw value"],
                                ["// @param cutoff 1000 20 20000 exp Hz", "exponential", "20\u201320000", "1000", "raw value"],
                                ["// @param steps 4 1 16 int", "integer", "1\u201316", "4", "integer"],
                                ["// @param bypass false", "boolean", "\u2014", "Off", "0 or 1"],
                              ].map(([decl, type, range, def, receives], idx) => (
                                <tr key={idx} style={{ borderBottom: "1px solid var(--gray-4)" }}>
                                  <td style={{ padding: "0.5rem" }}><Code size="1">{decl}</Code></td>
                                  <td style={{ padding: "0.5rem" }}>{type}</td>
                                  <td style={{ padding: "0.5rem" }}>{range}</td>
                                  <td style={{ padding: "0.5rem" }}>{def}</td>
                                  <td style={{ padding: "0.5rem" }}>{receives}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </RadixBox>
                      )}

                      {example.script && (
                        <pre style={{
                          margin: 0,
                          padding: "1rem",
                          backgroundColor: "var(--gray-2)",
                          borderRadius: "var(--radius-2)",
                          overflow: "auto",
                          fontSize: "0.8rem",
                          lineHeight: 1.5,
                        }}>
                          <code>{example.script}</code>
                        </pre>
                      )}
                    </Flex>
                  </Card>
                ))}
              </Flex>
```

- [ ] **Step 3: Verify the API reference in the browser**

Run: `npm run dev`

1. Scroll to the API Reference section
2. Click "Load" on "The Processor Class" — should hear passthrough (unchanged audio)
3. Click "Load" on "Parameter Declarations" — should hear gain effect
4. Click "Load" on "The Block Object" — should hear tempo-synced tremolo
5. Click "Load" on "The sampleRate Global" — should hear audio with added sine tone
6. Verify "Safety Constraints" has no Load button
7. Verify switching between showcase effects and API examples works without issues

- [ ] **Step 4: Commit**

```bash
git add src/werkstatt-demo.tsx
git commit -m "feat(werkstatt): add API reference section with loadable examples"
```

---

### Task 7: Add homepage card

**Files:**
- Modify: `src/index.tsx:234`

- [ ] **Step 1: Add the Werkstatt demo card to the homepage**

In `src/index.tsx`, add a new card after the Track Automation card (before the closing `</div>`). Insert after the Track Automation `</Card>` (around line 234):

```tsx
            <Card asChild>
              <Link href="/werkstatt-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🔧</Text>
                    <Heading size="5">Werkstatt — Scriptable FX</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Write custom audio effects in JavaScript. Browse pre-built effects (tremolo, ring mod,
                    filter, chorus, phaser) or explore the Werkstatt API with runnable code examples.
                  </Text>
                </Flex>
              </Link>
            </Card>
```

- [ ] **Step 2: Verify the homepage card**

Run: `npm run dev`

Open `https://localhost:5173/`. Verify the Werkstatt card appears and clicking it navigates to the demo.

- [ ] **Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat(werkstatt): add homepage card"
```

---

### Task 8: Build verification and final polish

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run the production build**

Run: `npm run build`

Expected: Build succeeds with no errors. Check that `werkstatt-demo.html` appears in the output.

- [ ] **Step 2: Fix any build errors**

If there are TypeScript or build errors, fix them. Common issues:
- Missing imports (check `WerkstattDeviceBox` is exported from `@opendaw/studio-boxes`)
- Type mismatches on Radix UI components

- [ ] **Step 3: Manual browser test of the full flow**

Test the complete flow in the dev server:
1. Homepage → click Werkstatt card → demo loads
2. Click "Start Audio Engine" → drums load
3. Play drums → hear drum pattern from bar 25
4. Click each showcase effect → hear effect, see params and code
5. Adjust sliders → hear parameter changes
6. Switch audio source to Sine → hear sine through effect
7. Switch to Noise → hear noise through effect
8. Switch back to Drums → hear drums through effect
9. Clear effect → hear dry audio
10. Scroll to API Reference → load each example → hear changes
11. Stop → Play again → verify state is consistent

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix(werkstatt): build and polish fixes"
```

(Skip this step if no fixes were needed.)
