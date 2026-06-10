# Beat-Map Triptych Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three demos showing the three ways a DAW reconciles an audio file's beat map with a project grid — varispeed (warp file → grid), grid-follows-file (tempo map ← beat map), and pitch-preserving time-stretch — each built on the OpenDAW SDK.

**Architecture:** A pure, SDK-free math layer (`src/lib/beats/`) converts beat_this `.beats` markers into warp anchors and tempo events (unit-tested with Vitest). A thin shared demo layer (`src/demos/warp/lib/`) handles project setup and waveform rendering. Three demo pages each apply one conform strategy: `AudioPitchStretchBox` + `WarpMarkerBox` (demo 1), stepped tempo events on the tempo track (demo 2), `AudioTimeStretchBox` + transient markers (demo 3).

**Tech Stack:** OpenDAW SDK 0.0.154, React 19, Radix UI Themes, Vite, Vitest (new devDep).

**Spec:** `docs/superpowers/specs/2026-06-10-beat-map-triptych-demos-design.md`

**Branch:** `beat-map-triptych-demos` (already created; spec committed).

---

## Verified SDK facts (do not re-derive)

- `PPQN.Quarter` = 960, `PPQN.fromSignature(4, 4)` = 3840 (one 4/4 bar). From `@opendaw/lib-dsp`.
- `project.engine.position` is `ObservableValue<ppqn>` — read with `.getValue()`.
- Tempo events: `project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => collection.createEvent({ position, index: 0, value: bpm, interpolation }))` inside ONE `editing.modify()`. Clear with `collection.events.asArray().forEach(e => e.box.delete())`. `Interpolation.None` (stepped) from `@opendaw/lib-dsp`. Multiple `createEvent` calls in one transaction are fine (tempo track ≠ signature track).
- Warp markers: `WarpMarkerBox.create(boxGraph, UUID.generate(), m => { m.owner.refer(stretchBox.warpMarkers); m.position.setValue(intPpqn); m.seconds.setValue(fileSeconds); })`. `position` is Int32 — always `Math.round()`.
- Play-mode swap is ONE transaction: create new box → `region.playMode.refer(newBox)` (no `defer()` first) → `oldBox.delete()` → flip `timeBase`. NoStretch = `region.playMode.defer()` + `TimeBase.Seconds` + durations in seconds.
- `ensureTransientMarkers(project, audioFileBox, audioBuffer)` from `src/lib/transientDetection.ts` — required before TimeStretch; throws on zero detections.
- Metronome: `project.engine.preferences.settings.metronome.enabled = true` — plain setter, NOT inside `editing.modify()`.
- Peaks: `project.sampleManager.getOrCreate(fileUuid)` → `loader.subscribe(state => state.type === "loaded" && loader.peaks.unwrap())`. `PeaksPainter.renderPixelStrips(ctx, peaks, channel, {x0,x1,y0,y1,u0,u1,v0:-1.001,v1:1.001})` from `@opendaw/lib-fusion`; set `ctx.fillStyle` first.
- Some `editing.modify` writes reset `engine.position` to 0 (playbackRate, timeBase+duration+playMode combos). Re-call `project.engine.setPosition(...)` after the modify when it matters; gate live controls on `!isPlaying`.
- `initializeOpenDAW({ localAudioBuffers, bpm, onStatusUpdate })` from `@/lib/projectSetup`; `loadAudioFile(audioContext, path)` from `@/lib/audioUtils`; hooks `usePlaybackPosition(project)` → `{ isPlaying, pausedPositionRef }` and `useTransportControls({ project, audioContext, pausedPositionRef })` → `{ handlePlay, handlePause, handleStop }`.
- `project.tempoMap` (VaryingTempoMap): `ppqnToSeconds(ppqn)`, `secondsToPPQN(seconds)`, `getTempoAt(ppqn)`.
- Otherside.mp3 = 257.712 s. `otherside-repaired.beats` = 510 markers, 1.26 s → 249.26 s, first row `beatInBar 4` (1 pickup beat in 4/4), average ≈ 123 BPM.

## File structure

```
public/audio/Otherside.beats                     # copied beat map (Task 2)
src/lib/beats/beatsParser.ts                     # .beats text → BeatMarker[] (Task 3)
src/lib/beats/beatsParser.test.ts
src/lib/beats/beatMapConversions.ts              # pure math: anchors, tempo events (Task 4)
src/lib/beats/beatMapConversions.test.ts
src/demos/warp/lib/setupWarpDemo.ts              # shared init: project+audio+beats+region (Task 5)
src/demos/warp/lib/WarpWaveform.tsx              # canvas waveform + bar lines + playhead (Task 5)
src/demos/warp/warp-varispeed-demo.tsx           # Demo 1 (Task 6)
src/demos/warp/warp-grid-follows-file-demo.tsx   # Demo 2 (Task 7)
src/demos/warp/warp-timestretch-demo.tsx         # Demo 3 (Task 8)
warp-varispeed-demo.html                         # entries at repo root (Tasks 6-8)
warp-grid-follows-file-demo.html
warp-timestretch-demo.html
src/demos/warp/CLAUDE.md                         # SDK knowledge captured (Task 9)
```

Modified: `package.json` (vitest), `vite.config.ts` (3 inputs), `src/index.tsx` (3 cards), `public/sitemap.xml` (3 URLs), root `CLAUDE.md` (demo-category list).

---

### Task 1: Add Vitest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add devDependency and test script**

In `package.json` add to `"scripts"`:

```json
"test": "vitest run"
```

and to `"devDependencies"`:

```json
"vitest": "^3.2.4"
```

- [ ] **Step 2: Regenerate the lockfile cleanly (MANDATORY per CLAUDE.md)**

```bash
rm -rf node_modules package-lock.json && npm install
```

- [ ] **Step 3: Verify with npm ci (catches the Cloudflare lockfile failure mode)**

```bash
npm ci && npx vitest --version
```

Expected: clean install, vitest version prints.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for beat-map math unit tests"
```

---

### Task 2: Copy the beat-map asset

**Files:**
- Create: `public/audio/Otherside.beats`

- [ ] **Step 1: Copy the repaired beat map**

```bash
cp /Users/naomiaro/Code/warp-markers/08-grid-follows-file/public/samples/otherside-repaired.beats \
   public/audio/Otherside.beats
```

- [ ] **Step 2: Sanity-check shape**

```bash
grep -cv '^\s*#\|^\s*$' public/audio/Otherside.beats
```

Expected: `510` (data rows).

- [ ] **Step 3: Commit**

```bash
git add public/audio/Otherside.beats
git commit -m "feat: add Otherside beat map (beat_this output, repaired per warp-markers ch06)"
```

---

### Task 3: Beats parser (TDD)

**Files:**
- Create: `src/lib/beats/beatsParser.test.ts`
- Create: `src/lib/beats/beatsParser.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/beats/beatsParser.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseBeatsFile } from "./beatsParser";

const VALID = `# comment line
1.260000\t4

1.800000\t1
2.320000\t2
`;

describe("parseBeatsFile", () => {
  it("parses rows, skipping comments and blank lines", () => {
    const markers = parseBeatsFile(VALID);
    expect(markers).toEqual([
      { second: 1.26, beatInBar: 4 },
      { second: 1.8, beatInBar: 1 },
      { second: 2.32, beatInBar: 2 },
    ]);
  });

  it("accepts space-separated columns too", () => {
    expect(parseBeatsFile("0.5 1\n1.0 2\n")).toEqual([
      { second: 0.5, beatInBar: 1 },
      { second: 1.0, beatInBar: 2 },
    ]);
  });

  it("rejects rows that are not two numeric columns", () => {
    expect(() => parseBeatsFile("0.5 1\nbogus row\n")).toThrow(/row 2/i);
  });

  it("rejects beatInBar < 1 or non-integer", () => {
    expect(() => parseBeatsFile("0.5 0\n1.0 1\n")).toThrow(/beatInBar/i);
    expect(() => parseBeatsFile("0.5 1.5\n1.0 2\n")).toThrow(/beatInBar/i);
  });

  it("rejects non-monotonic seconds (warp map needs an inverse)", () => {
    expect(() => parseBeatsFile("1.0 1\n0.9 2\n")).toThrow(/monotonic/i);
  });

  it("rejects fewer than 2 markers (no segment to derive tempo from)", () => {
    expect(() => parseBeatsFile("1.0 1\n")).toThrow(/at least 2/i);
  });

  it("parses the real bundled Otherside beat map", () => {
    const text = readFileSync(
      resolve(__dirname, "../../../public/audio/Otherside.beats"),
      "utf-8"
    );
    const markers = parseBeatsFile(text);
    expect(markers).toHaveLength(510);
    expect(markers[0]).toEqual({ second: 1.26, beatInBar: 4 });
    expect(markers[markers.length - 1].second).toBeCloseTo(249.26, 5);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/lib/beats/beatsParser.test.ts
```

Expected: FAIL — cannot resolve `./beatsParser`.

- [ ] **Step 3: Implement the parser**

```typescript
// src/lib/beats/beatsParser.ts

/** One row of a beat_this `.beats` file: a tracked beat. */
export interface BeatMarker {
  /** Position of the beat in the audio file, in seconds. */
  readonly second: number;
  /** 1-based position within the bar; 1 = downbeat. */
  readonly beatInBar: number;
}

/**
 * Parse beat_this `.beats` text: one `<seconds> <beatInBar>` row per beat,
 * `#` comments and blank lines ignored. Validates at the boundary so the
 * math layer can assume a well-formed, strictly-monotonic marker list.
 */
export function parseBeatsFile(text: string): BeatMarker[] {
  const markers: BeatMarker[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const second = Number(parts[0]);
    const beatInBar = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(second) || !Number.isFinite(beatInBar)) {
      throw new Error(`Invalid .beats row ${i + 1}: "${line}" — expected "<seconds> <beatInBar>"`);
    }
    if (!Number.isInteger(beatInBar) || beatInBar < 1) {
      throw new Error(`Invalid .beats row ${i + 1}: beatInBar must be an integer >= 1, got ${parts[1]}`);
    }
    const prev = markers[markers.length - 1];
    if (prev !== undefined && second <= prev.second) {
      throw new Error(
        `Invalid .beats row ${i + 1}: seconds must be strictly monotonic ` +
          `(${second} after ${prev.second}) — a non-monotonic warp map has no inverse`
      );
    }
    markers.push({ second, beatInBar });
  }
  if (markers.length < 2) {
    throw new Error(`Beat map needs at least 2 markers to derive a tempo, got ${markers.length}`);
  }
  return markers;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/lib/beats/beatsParser.test.ts
```

Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/beats/beatsParser.ts src/lib/beats/beatsParser.test.ts
git commit -m "feat: .beats parser with boundary validation"
```

---

### Task 4: Beat-map conversions (TDD)

**Files:**
- Create: `src/lib/beats/beatMapConversions.test.ts`
- Create: `src/lib/beats/beatMapConversions.ts`

Pure math, no SDK imports — `quarterPpqn` is a plain number parameter (callers pass `PPQN.Quarter`). Test fixtures are the worked numbers from warp-markers docs ch 07/08.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/beats/beatMapConversions.test.ts
import { describe, it, expect } from "vitest";
import type { BeatMarker } from "./beatsParser";
import {
  segmentBpms,
  averageBpm,
  pickupBeats,
  gridAnchorTicks,
  buildWarpAnchors,
  beatsToTempoEvents,
  clipStartSeconds,
  warpTickToSeconds,
} from "./beatMapConversions";

const Q = 960; // PPQN.Quarter

// warp-markers ch07 worked example: beats at 0.5, 1.1, 1.6 s
// → segments of 0.6 s (100 BPM) and 0.5 s (120 BPM). No pickup.
const CH07: BeatMarker[] = [
  { second: 0.5, beatInBar: 1 },
  { second: 1.1, beatInBar: 2 },
  { second: 1.6, beatInBar: 3 },
];

// Otherside head: first row beatInBar 4 → one pickup beat in 4/4.
const PICKUP: BeatMarker[] = [
  { second: 1.26, beatInBar: 4 },
  { second: 1.8, beatInBar: 1 },
  { second: 2.32, beatInBar: 2 },
];

describe("segmentBpms", () => {
  it("derives per-gap BPM (ch07 worked numbers)", () => {
    const bpms = segmentBpms(CH07);
    expect(bpms[0]).toBeCloseTo(100, 6);
    expect(bpms[1]).toBeCloseTo(120, 6);
  });
});

describe("averageBpm", () => {
  it("is (N-1) beats over the total span", () => {
    expect(averageBpm(CH07)).toBeCloseTo((2 * 60) / 1.1, 6); // ≈ 109.09
  });
});

describe("pickupBeats", () => {
  it("is 0 when the file starts on a downbeat", () => {
    expect(pickupBeats(CH07)).toBe(0);
  });
  it("is 1 when the first row is beat 4 of 4", () => {
    expect(pickupBeats(PICKUP)).toBe(1);
  });
});

describe("gridAnchorTicks (ch08 full-bars rule)", () => {
  it("degenerates to tick 0 with no pickup", () => {
    expect(gridAnchorTicks(CH07, Q)).toEqual({ firstBeatTick: 0, firstDownbeatTick: 0 });
  });
  it("bar-aligns the first downbeat with a pickup", () => {
    // p=1: firstDownbeatTick = ceil(960/3840)*3840 = 3840; firstBeatTick = 3840-960 = 2880
    expect(gridAnchorTicks(PICKUP, Q)).toEqual({ firstBeatTick: 2880, firstDownbeatTick: 3840 });
  });
});

describe("buildWarpAnchors", () => {
  it("pins beat n at firstBeatTick + n*quarter and extends to file end at the last segment tempo", () => {
    const anchors = buildWarpAnchors(CH07, 2.0, Q);
    // No pickup → no lead-in anchor (audio before 0.5 s is trimmed, ch08 degenerate case).
    // Outro: 0.4 s remaining at 0.5 s/beat → 768 extra ticks.
    expect(anchors).toEqual([
      { tick: 0, second: 0.5 },
      { tick: 960, second: 1.1 },
      { tick: 1920, second: 1.6 },
      { tick: 2688, second: 2.0 },
    ]);
  });

  it("prepends a tick-0 lead-in anchor when there is a pickup", () => {
    const anchors = buildWarpAnchors(PICKUP, 3.0, Q);
    // Lead-in would be 3 beats at the first segment's 0.54 s/beat = 1.62 s,
    // but only 1.26 s of audio exists before the first beat → clamp to second 0.
    expect(anchors[0]).toEqual({ tick: 0, second: 0 });
    expect(anchors[1]).toEqual({ tick: 2880, second: 1.26 });
    expect(anchors[2]).toEqual({ tick: 3840, second: 1.8 });
    expect(anchors[3]).toEqual({ tick: 4800, second: 2.32 });
    // Outro: 0.68 s remaining at 0.52 s/beat → round(0.68/0.52*960) = 1255 ticks.
    expect(anchors[4]).toEqual({ tick: 4800 + 1255, second: 3.0 });
  });

  it("emits integer ticks only (Int32 box field)", () => {
    for (const a of buildWarpAnchors(PICKUP, 3.0, Q)) {
      expect(Number.isInteger(a.tick)).toBe(true);
    }
  });
});

describe("beatsToTempoEvents", () => {
  it("emits one stepped event per segment, anchored per the grid", () => {
    expect(beatsToTempoEvents(CH07, Q)).toEqual([
      { tick: 0, bpm: 100 },
      { tick: 960, bpm: 120 },
    ]);
  });

  it("covers the lead-in bars with the first segment tempo when there is a pickup", () => {
    const events = beatsToTempoEvents(PICKUP, Q);
    expect(events[0].tick).toBe(0);
    expect(events[0].bpm).toBeCloseTo(60 / 0.54, 6); // ≈ 111.11, lead-in + segment 0
    expect(events[1].tick).toBe(3840); // tempo changes at marker 1 (the downbeat)
    expect(events[1].bpm).toBeCloseTo(60 / 0.52, 6); // ≈ 115.38
    expect(events).toHaveLength(2);
  });
});

describe("clipStartSeconds", () => {
  it("is the first marker's second", () => {
    expect(clipStartSeconds(PICKUP)).toBe(1.26);
  });
});

describe("warpTickToSeconds", () => {
  const anchors = buildWarpAnchors(CH07, 2.0, Q);
  it("hits every anchor exactly", () => {
    for (const a of anchors) {
      expect(warpTickToSeconds(anchors, a.tick)).toBeCloseTo(a.second, 9);
    }
  });
  it("interpolates linearly between anchors", () => {
    expect(warpTickToSeconds(anchors, 480)).toBeCloseTo(0.8, 9); // mid segment 0
  });
  it("clamps outside the anchor range", () => {
    expect(warpTickToSeconds(anchors, -100)).toBeCloseTo(0.5, 9);
    expect(warpTickToSeconds(anchors, 99999)).toBeCloseTo(2.0, 9);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/lib/beats/beatMapConversions.test.ts
```

Expected: FAIL — cannot resolve `./beatMapConversions`.

- [ ] **Step 3: Implement the conversions**

```typescript
// src/lib/beats/beatMapConversions.ts
import type { BeatMarker } from "./beatsParser";

/** A warp anchor: timeline tick ↔ audio-file second. The DAW-persistable pair. */
export interface WarpAnchor {
  readonly tick: number;
  readonly second: number;
}

/** A stepped tempo event for the project tempo track. */
export interface TempoEvent {
  readonly tick: number;
  readonly bpm: number;
}

/** Instantaneous BPM per marker gap: 60 / (s[n+1] - s[n]). */
export function segmentBpms(markers: ReadonlyArray<BeatMarker>): number[] {
  const bpms: number[] = [];
  for (let n = 0; n < markers.length - 1; n++) {
    bpms.push(60 / (markers[n + 1].second - markers[n].second));
  }
  return bpms;
}

/** (N-1) beats over the total tracked span. */
export function averageBpm(markers: ReadonlyArray<BeatMarker>): number {
  const span = markers[markers.length - 1].second - markers[0].second;
  return ((markers.length - 1) * 60) / span;
}

/** Beats sounding before the first downbeat, from the first row's beatInBar. */
export function pickupBeats(
  markers: ReadonlyArray<BeatMarker>,
  beatsPerBar: number = 4
): number {
  return (beatsPerBar - markers[0].beatInBar + 1) % beatsPerBar;
}

/**
 * warp-markers ch08 full-bars rule: a DAW grid is always full bars, so the
 * first downbeat must land on a bar boundary; the pickup fills the end of
 * the bar before it.
 */
export function gridAnchorTicks(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): { firstBeatTick: number; firstDownbeatTick: number } {
  const p = pickupBeats(markers, beatsPerBar);
  const ticksPerBar = beatsPerBar * quarterPpqn;
  const firstDownbeatTick = Math.ceil((p * quarterPpqn) / ticksPerBar) * ticksPerBar;
  return { firstBeatTick: firstDownbeatTick - p * quarterPpqn, firstDownbeatTick };
}

/** The audio-file second of the first tracked beat (ch08's clip offset). */
export function clipStartSeconds(markers: ReadonlyArray<BeatMarker>): number {
  return markers[0].second;
}

/**
 * The full anchor list a stretch box consumes: one anchor per tracked beat
 * (beat n pinned at firstBeatTick + n*quarter), plus
 * - a tick-0 lead-in anchor when there is a pickup, placed so the lead-in
 *   plays at the first segment's tempo (clamped to second 0 when the file
 *   has less lead-in audio than the lead-in bars ask for), and
 * - an outro anchor pinning the file end, continuing the last segment's tempo
 *   so audio after the final tracked beat still plays.
 */
export function buildWarpAnchors(
  markers: ReadonlyArray<BeatMarker>,
  fileDurationSeconds: number,
  quarterPpqn: number,
  beatsPerBar: number = 4
): WarpAnchor[] {
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const anchors: WarpAnchor[] = markers.map((m, n) => ({
    tick: firstBeatTick + n * quarterPpqn,
    second: m.second,
  }));

  if (firstBeatTick > 0) {
    const firstSegSecondsPerBeat = markers[1].second - markers[0].second;
    const leadInSeconds = (firstBeatTick / quarterPpqn) * firstSegSecondsPerBeat;
    anchors.unshift({
      tick: 0,
      second: Math.max(0, markers[0].second - leadInSeconds),
    });
  }

  const last = anchors[anchors.length - 1];
  const remaining = fileDurationSeconds - last.second;
  if (remaining > 1e-6) {
    const lastSegSecondsPerBeat =
      markers[markers.length - 1].second - markers[markers.length - 2].second;
    anchors.push({
      tick: last.tick + Math.round((remaining / lastSegSecondsPerBeat) * quarterPpqn),
      second: fileDurationSeconds,
    });
  }
  return anchors;
}

/**
 * One stepped tempo event per segment for the project tempo track.
 * The tick-0 event carries the first segment's BPM so lead-in bars (and the
 * pickup) tick at the incoming tempo; segment n's BPM takes effect at
 * marker n's grid tick.
 */
export function beatsToTempoEvents(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  beatsPerBar: number = 4
): TempoEvent[] {
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const bpms = segmentBpms(markers);
  const events: TempoEvent[] = [{ tick: 0, bpm: bpms[0] }];
  for (let n = 1; n < bpms.length; n++) {
    events.push({ tick: firstBeatTick + n * quarterPpqn, bpm: bpms[n] });
  }
  return events;
}

/**
 * Evaluate the piecewise-linear warp map at a tick (for playhead → file-second
 * mapping in the demos). Clamps outside the anchor range.
 */
export function warpTickToSeconds(
  anchors: ReadonlyArray<WarpAnchor>,
  tick: number
): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (tick <= first.tick) return first.second;
  if (tick >= last.tick) return last.second;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (tick <= b.tick) {
      const t = (tick - a.tick) / (b.tick - a.tick);
      return a.second + t * (b.second - a.second);
    }
  }
  return last.second;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/lib/beats/
```

Expected: all passing (parser + conversions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/beats/beatMapConversions.ts src/lib/beats/beatMapConversions.test.ts
git commit -m "feat: beat-map conversions — warp anchors, tempo events, grid anchoring"
```

---

### Task 5: Shared demo layer — setup + waveform component

**Files:**
- Create: `src/demos/warp/lib/setupWarpDemo.ts`
- Create: `src/demos/warp/lib/WarpWaveform.tsx`

No unit tests here (SDK/browser-bound); verified through the demo pages in Tasks 6–8.

- [ ] **Step 1: Write the shared setup function**

```typescript
// src/demos/warp/lib/setupWarpDemo.ts
import { UUID } from "@opendaw/lib-std";
import { TimeBase } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import {
  AudioFileBox,
  AudioRegionBox,
  TrackBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile } from "@/lib/audioUtils";
import { parseBeatsFile, type BeatMarker } from "@/lib/beats/beatsParser";
import { averageBpm } from "@/lib/beats/beatMapConversions";

const AUDIO_PATH = "/audio/Otherside.mp3";
const BEATS_PATH = "/audio/Otherside.beats";
const SAMPLE_NAME = "Otherside";

export interface WarpDemoSetup {
  project: Project;
  audioContext: AudioContext;
  audioBuffer: AudioBuffer;
  fileUuid: UUID.Bytes;
  audioFileBox: AudioFileBox;
  trackBox: TrackBox;
  region: AudioRegionBox;
  markers: BeatMarker[];
  /** round(averageBpm(markers)) — the rigid project tempo. */
  projectBpm: number;
}

/**
 * Common bootstrap for the warp triptych demos: project at the beat map's
 * average tempo, Otherside loaded onto a Tape track as a raw NoStretch /
 * Seconds-timeBase region spanning the whole file, metronome on. Each demo
 * applies its own conform strategy on top.
 */
export async function setupWarpDemo(opts: {
  localAudioBuffers: Map<string, AudioBuffer>;
  onStatusUpdate?: (status: string) => void;
}): Promise<WarpDemoSetup> {
  const { localAudioBuffers, onStatusUpdate } = opts;

  onStatusUpdate?.("Fetching beat map...");
  const beatsResponse = await fetch(BEATS_PATH);
  if (!beatsResponse.ok) {
    throw new Error(`Failed to fetch ${BEATS_PATH}: HTTP ${beatsResponse.status}`);
  }
  const markers = parseBeatsFile(await beatsResponse.text());
  const projectBpm = Math.round(averageBpm(markers));

  const { project, audioContext } = await initializeOpenDAW({
    localAudioBuffers,
    bpm: projectBpm,
    onStatusUpdate,
  });

  onStatusUpdate?.("Loading audio file...");
  const audioBuffer = await loadAudioFile(audioContext, AUDIO_PATH);
  const fileUuid = UUID.generate();
  localAudioBuffers.set(UUID.toString(fileUuid), audioBuffer);

  let audioFileBox: AudioFileBox = null as unknown as AudioFileBox;
  let trackBox: TrackBox = null as unknown as TrackBox;
  let region: AudioRegionBox = null as unknown as AudioRegionBox;
  project.editing.modify(() => {
    const created = project.api.createInstrument(InstrumentFactories.Tape);
    trackBox = created.trackBox;
    audioFileBox = AudioFileBox.create(project.boxGraph, fileUuid, (box) => {
      box.fileName.setValue(SAMPLE_NAME);
      box.endInSeconds.setValue(audioBuffer.duration);
    });
    const events = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
    region = AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
      box.regions.refer(trackBox.regions);
      box.file.refer(audioFileBox);
      box.events.refer(events.owners);
      box.position.setValue(0);
      box.duration.setValue(audioBuffer.duration);
      box.loopDuration.setValue(audioBuffer.duration);
      box.timeBase.setValue(TimeBase.Seconds);
      box.label.setValue(SAMPLE_NAME);
    });
  });

  // Plain setter — not a box field, must NOT be inside editing.modify().
  project.engine.preferences.settings.metronome.enabled = true;

  await project.engine.queryLoadingComplete();
  return {
    project,
    audioContext,
    audioBuffer,
    fileUuid,
    audioFileBox,
    trackBox,
    region,
    markers,
    projectBpm,
  };
}
```

- [ ] **Step 2: Write the shared waveform component**

The component is deliberately dumb: the parent supplies three pure callbacks
returning fractions of canvas width, and the component owns the
CanvasPainter, the peaks subscription, and a direct-DOM playhead overlay
(no per-frame setState). Re-render is requested by bumping `repaintKey`.

```tsx
// src/demos/warp/lib/WarpWaveform.tsx
import React, { useEffect, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import type { Peaks } from "@opendaw/lib-fusion";
import { Project } from "@opendaw/studio-core";
import { CanvasPainter } from "@/lib/CanvasPainter";

export interface WaveformSegment {
  /** Canvas x-range, fractions 0..1. */
  x0: number;
  x1: number;
  /** Peaks frame range, fractions 0..1 of the audio file. */
  u0: number;
  u1: number;
}

interface WarpWaveformProps {
  project: Project;
  fileUuid: UUID.Bytes;
  height?: number;
  /** Waveform slices to draw — fractions, evaluated on every repaint. */
  getSegments: () => WaveformSegment[];
  /** Bar-line positions — fractions of canvas width. */
  getBarLines: () => number[];
  /** Playhead position — fraction of canvas width. Read every frame. */
  getPlayheadFrac: () => number;
  /** Bump to request a repaint (e.g. after a conform toggle). */
  repaintKey?: unknown;
}

export function WarpWaveform({
  project,
  fileUuid,
  height = 140,
  getSegments,
  getBarLines,
  getPlayheadFrac,
  repaintKey,
}: WarpWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const getSegmentsRef = useRef(getSegments);
  getSegmentsRef.current = getSegments;
  const getBarLinesRef = useRef(getBarLines);
  getBarLinesRef.current = getBarLines;
  const getPlayheadFracRef = useRef(getPlayheadFrac);
  getPlayheadFracRef.current = getPlayheadFrac;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const painter = new CanvasPainter(canvas, (_painter, ctx) => {
      const width = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, width, h);

      const peaks = peaksRef.current;
      if (peaks) {
        ctx.fillStyle = "#4a9eff";
        const channelHeight = h / peaks.numChannels;
        for (const seg of getSegmentsRef.current()) {
          for (let channel = 0; channel < peaks.numChannels; channel++) {
            PeaksPainter.renderPixelStrips(ctx, peaks, channel, {
              x0: Math.floor(seg.x0 * width),
              x1: Math.floor(seg.x1 * width),
              y0: channel * channelHeight + 2,
              y1: (channel + 1) * channelHeight - 2,
              u0: Math.max(0, Math.min(peaks.numFrames, Math.floor(seg.u0 * peaks.numFrames))),
              u1: Math.max(0, Math.min(peaks.numFrames, Math.floor(seg.u1 * peaks.numFrames))),
              // Headroom for SDK Float16 unpack quirk (±1.0 unpacks to ±1.000122).
              v0: -1.001,
              v1: 1.001,
            });
          }
        }
      }

      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      for (const frac of getBarLinesRef.current()) {
        const x = frac * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    });
    painterRef.current = painter;

    // Peaks arrive asynchronously from the SamplePeaks worker.
    const loader = project.sampleManager.getOrCreate(fileUuid);
    const sub = loader.subscribe((state: { type: string }) => {
      if (state.type === "loaded") {
        const peaksOption = loader.peaks;
        if (!peaksOption.isEmpty()) {
          peaksRef.current = peaksOption.unwrap();
          painter.requestUpdate();
          sub.terminate();
        }
      }
    });

    // Direct-DOM playhead: no setState per frame.
    const playheadTerminable = AnimationFrame.add(() => {
      const playhead = playheadRef.current;
      if (!playhead) return;
      const frac = Math.max(0, Math.min(1, getPlayheadFracRef.current()));
      playhead.style.left = `${frac * canvas.clientWidth}px`;
    });

    return () => {
      sub.terminate();
      playheadTerminable.terminate();
      painter.terminate();
      painterRef.current = null;
    };
  }, [project, fileUuid]);

  useEffect(() => {
    painterRef.current?.requestUpdate();
  }, [repaintKey]);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div
        ref={playheadRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 2,
          background: "#ff5555",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check via LSP (Vite skips tsc; TS6133 and import errors hide otherwise)**

Use the typescript-lsp plugin (hover/diagnostics) on both new files, or:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/demos/warp\|src/lib/beats" || echo CLEAN
```

Expected: CLEAN (note: `tsc` may not exist as a devDep — if the command fails for that reason, rely on the LSP diagnostics).

- [ ] **Step 4: Commit**

```bash
git add src/demos/warp/lib/setupWarpDemo.ts src/demos/warp/lib/WarpWaveform.tsx
git commit -m "feat: shared setup and waveform component for warp demos"
```

---

### Task 6: Demo 1 — Varispeed (warp file → grid)

**Files:**
- Create: `src/demos/warp/warp-varispeed-demo.tsx`
- Create: `warp-varispeed-demo.html`
- Modify: `vite.config.ts` (add input)

- [ ] **Step 1: Write the demo page**

```tsx
// src/demos/warp/warp-varispeed-demo.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { AudioPitchStretchBox, WarpMarkerBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import {
  buildWarpAnchors,
  segmentBpms,
  gridAnchorTicks,
  type WarpAnchor,
} from "@/lib/beats/beatMapConversions";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import { WarpWaveform, type WaveformSegment } from "./lib/WarpWaveform";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Badge, Separator, Switch, Link,
} from "@radix-ui/themes";

const QUARTER = PPQN.Quarter; // 960
const BAR = PPQN.fromSignature(4, 4); // 3840

function WarpVarispeedDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [warped, setWarped] = useState(false);
  const [repaintKey, setRepaintKey] = useState(0);

  const anchorsRef = useRef<WarpAnchor[]>([]);
  const warpedRef = useRef(false);
  const stretchBoxRef = useRef<AudioPitchStretchBox | null>(null);
  const segmentReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  const project = setup?.project ?? null;
  const { isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext: setup?.audioContext ?? null,
    pausedPositionRef,
  });

  useEffect(() => {
    let cancelled = false;
    setupWarpDemo({ localAudioBuffers, onStatusUpdate: setStatus })
      .then((result) => {
        if (cancelled) return;
        anchorsRef.current = buildWarpAnchors(
          result.markers,
          result.audioBuffer.duration,
          QUARTER
        );
        setSetup(result);
        setStatus("Ready — warp is OFF, the file will drift off the click");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  // Live per-segment readout: direct DOM, no per-frame setState.
  useEffect(() => {
    if (!setup) return undefined;
    const bpms = segmentBpms(setup.markers);
    const { firstBeatTick } = gridAnchorTicks(setup.markers, QUARTER);
    const terminable = AnimationFrame.add(() => {
      const el = segmentReadoutRef.current;
      if (!el) return;
      if (!warpedRef.current) {
        el.textContent = "— (unwarped: file plays at its own wobbly tempo)";
        return;
      }
      const tick = setup.project.engine.position.getValue();
      const n = Math.floor((tick - firstBeatTick) / QUARTER);
      if (n < 0 || n >= bpms.length) {
        el.textContent = "— (outside the tracked beats)";
        return;
      }
      const rate = setup.projectBpm / bpms[n];
      const cents = 1200 * Math.log2(rate);
      el.textContent =
        `segment ${n + 1}/${bpms.length} · source ${bpms[n].toFixed(1)} BPM · ` +
        `rate ${rate.toFixed(3)} · ${cents >= 0 ? "+" : ""}${cents.toFixed(0)} cents`;
    });
    return () => terminable.terminate();
  }, [setup]);

  const toggleWarp = useCallback(
    (next: boolean) => {
      if (!setup) return;
      const { project, region, audioBuffer } = setup;
      const anchors = anchorsRef.current;
      const endTick = anchors[anchors.length - 1].tick;
      // Single transaction per the SDK's AudioContentModifier pattern.
      project.editing.modify(() => {
        const prev = stretchBoxRef.current;
        if (!next) {
          region.playMode.defer();
          if (prev) prev.delete();
          stretchBoxRef.current = null;
          region.timeBase.setValue(TimeBase.Seconds);
          region.duration.setValue(audioBuffer.duration);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(audioBuffer.duration);
          return;
        }
        const stretch = AudioPitchStretchBox.create(project.boxGraph, UUID.generate());
        for (const anchor of anchors) {
          WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
            m.owner.refer(stretch.warpMarkers);
            m.position.setValue(anchor.tick);
            m.seconds.setValue(anchor.second);
          });
        }
        region.playMode.refer(stretch);
        if (prev) prev.delete();
        stretchBoxRef.current = stretch;
        region.timeBase.setValue(TimeBase.Musical);
        region.duration.setValue(endTick);
        region.loopOffset.setValue(0);
        region.loopDuration.setValue(endTick);
      });
      // timeBase+duration+playMode writes reset engine.position to 0 — restore.
      project.engine.setPosition(0);
      pausedPositionRef.current = 0;
      warpedRef.current = next;
      setWarped(next);
      setRepaintKey((k) => k + 1);
    },
    [setup, pausedPositionRef]
  );

  // ---- Waveform callbacks (fractions of canvas width) ----
  const getSegments = useCallback((): WaveformSegment[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    if (!warpedRef.current) return [{ x0: 0, x1: 1, u0: 0, u1: 1 }];
    // Warped: each anchor pair is one slice, stretched to its grid slot.
    const endTick = anchors[anchors.length - 1].tick;
    const duration = setup.audioBuffer.duration;
    const segments: WaveformSegment[] = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      segments.push({
        x0: anchors[i].tick / endTick,
        x1: anchors[i + 1].tick / endTick,
        u0: anchors[i].second / duration,
        u1: anchors[i + 1].second / duration,
      });
    }
    return segments;
  }, [setup]);

  const getBarLines = useCallback((): number[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    const endTick = anchors[anchors.length - 1].tick;
    const lines: number[] = [];
    if (warpedRef.current) {
      for (let tick = 0; tick <= endTick; tick += BAR) lines.push(tick / endTick);
    } else {
      // Unwarped axis is file seconds; bars at the rigid project tempo.
      const barSeconds = (BAR / QUARTER) * (60 / setup.projectBpm);
      for (let s = 0; s <= setup.audioBuffer.duration; s += barSeconds) {
        lines.push(s / setup.audioBuffer.duration);
      }
    }
    return lines;
  }, [setup]);

  const getPlayheadFrac = useCallback((): number => {
    if (!setup) return 0;
    const tick = setup.project.engine.position.getValue();
    const anchors = anchorsRef.current;
    if (warpedRef.current) return tick / anchors[anchors.length - 1].tick;
    // Unwarped: region is Seconds-timeBase at the rigid tempo; axis is file seconds.
    const seconds = (tick / QUARTER) * (60 / setup.projectBpm);
    return seconds / setup.audioBuffer.duration;
  }, [setup]);

  return (
    <Theme appearance="dark" accentColor="iris">
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7">Warp to Grid: Varispeed</Heading>
          <Text color="gray">
            A beat map pins every tracked beat of <em>Otherside</em> to the project grid
            with one <code>WarpMarkerBox</code> per beat on an{" "}
            <code>AudioPitchStretchBox</code>. Between markers the engine reads the file
            at the rate the pins imply — beats lock to the metronome, and pitch scales
            with rate (Ableton's <em>Re-Pitch</em>). Where the source ran slower than the
            project, it plays sharp; faster, flat.
          </Text>
          {error && (
            <Card>
              <Text color="red">{error}</Text>
            </Card>
          )}
          <Card>
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Text weight="bold">Status</Text>
                <Badge color={setup ? "green" : "orange"}>{status}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex align="center" gap="3">
                <Switch
                  checked={warped}
                  onCheckedChange={toggleWarp}
                  disabled={!setup || isPlaying}
                />
                <Text>
                  Warp to grid ({setup?.projectBpm ?? "..."} BPM) — toggle while stopped
                </Text>
              </Flex>
              <Text size="2" color="gray">
                Current segment: <span ref={segmentReadoutRef}>—</span>
              </Text>
            </Flex>
          </Card>
          {setup && (
            <Card>
              <WarpWaveform
                project={setup.project}
                fileUuid={setup.fileUuid}
                getSegments={getSegments}
                getBarLines={getBarLines}
                getPlayheadFrac={getPlayheadFrac}
                repaintKey={repaintKey}
              />
            </Card>
          )}
          <Flex gap="3">
            <button onClick={handlePlay} disabled={!setup}>Play</button>
            <button onClick={handlePause} disabled={!setup}>Pause</button>
            <button onClick={handleStop} disabled={!setup}>Stop</button>
          </Flex>
          <Card>
            <Flex direction="column" gap="2">
              <Heading size="4">The math (warp-markers ch 07)</Heading>
              <Text size="2" color="gray">
                Each segment's rate is <code>projectBpm / segmentBpm</code> — the ratio of
                what the file supplies to what the grid allots. A rate above 1 plays the
                source faster (and sharper, by <code>1200·log₂(rate)</code> cents). The
                marker list itself is engine-agnostic: the{" "}
                <Link href="/warp-timestretch-demo.html">time-stretch demo</Link> consumes
                the identical anchors with pitch preserved, and the{" "}
                <Link href="/warp-grid-follows-file-demo.html">grid-follows-file demo</Link>{" "}
                inverts the direction entirely.
              </Text>
            </Flex>
          </Card>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpVarispeedDemo />);
```

NOTE for the implementer: transport buttons — match the exact button/IconButton
markup used in `src/demos/playback/time-pitch-demo.tsx` (Radix `Button` with
play/pause/stop icons) rather than the bare `<button>` shown above; bare
buttons are a placeholder for brevity ONLY in this one JSX block, the rest of
the file is literal. Copy the transport `Flex` from time-pitch-demo verbatim.

- [ ] **Step 2: Create the HTML entry**

Copy `time-pitch-demo.html` → `warp-varispeed-demo.html` and adjust title,
descriptions, canonical/og URLs (`warp-varispeed-demo.html`), og-image name
(`og-image-warp-varispeed.png`), and the script src:

```html
<script type="module" src="/src/demos/warp/warp-varispeed-demo.tsx"></script>
```

Keep the GoatCounter script line as-is. Title: `OpenDAW Warp Demo — Varispeed: Conform a Beat Map to the Grid`. Description: `Pin every tracked beat of a real song to the project grid with warp markers on an AudioPitchStretchBox. Beats lock, pitch follows rate — Ableton Re-Pitch style, built with the OpenDAW SDK.`

- [ ] **Step 3: Register in vite.config.ts**

In `build.rollupOptions.input` add:

```typescript
warpVarispeed: resolve(__dirname, "warp-varispeed-demo.html"),
```

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev -- --port 5180 --host 127.0.0.1
```

Open `https://localhost:5180/warp-varispeed-demo.html` (HTTPS, self-signed) with
Playwright MCP. Verify: status reaches Ready; waveform renders; Play with warp
OFF → music drifts against the metronome click; Stop, toggle warp ON, Play →
beats click in time and the song is audibly pitch-bent in slow/fast sections;
segment readout updates; no console errors (filter the known
`engine-preferences` noise).

- [ ] **Step 5: Commit**

```bash
git add src/demos/warp/warp-varispeed-demo.tsx warp-varispeed-demo.html vite.config.ts
git commit -m "feat: varispeed warp demo — beat map conformed to grid via PitchStretch"
```

---

### Task 7: Demo 2 — Grid follows file (tempo map ← beat map)

**Files:**
- Create: `src/demos/warp/warp-grid-follows-file-demo.tsx`
- Create: `warp-grid-follows-file-demo.html`
- Modify: `vite.config.ts`

**Spike first (Step 1) — this is the plan's riskiest unknown:** ~509 stepped
tempo events through `VaryingTempoMap`.

- [ ] **Step 1: Write the demo page (spike + final are the same artifact)**

```tsx
// src/demos/warp/warp-grid-follows-file-demo.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import {
  beatsToTempoEvents,
  gridAnchorTicks,
  clipStartSeconds,
  type TempoEvent,
} from "@/lib/beats/beatMapConversions";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import { WarpWaveform, type WaveformSegment } from "./lib/WarpWaveform";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Badge, Separator, Switch, Link,
} from "@radix-ui/themes";

const QUARTER = PPQN.Quarter;
const BAR = PPQN.fromSignature(4, 4);

function WarpGridFollowsFileDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [conformed, setConformed] = useState(false);
  const [eventCount, setEventCount] = useState(1);
  const [repaintKey, setRepaintKey] = useState(0);

  const conformedRef = useRef(false);
  const tempoEventsRef = useRef<TempoEvent[]>([]);
  const firstBeatTickRef = useRef(0);
  const endTickRef = useRef(0);
  const bpmReadoutRef = useRef<HTMLSpanElement | null>(null);
  const driftReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  const project = setup?.project ?? null;
  const { isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext: setup?.audioContext ?? null,
    pausedPositionRef,
  });

  useEffect(() => {
    let cancelled = false;
    setupWarpDemo({ localAudioBuffers, onStatusUpdate: setStatus })
      .then((result) => {
        if (cancelled) return;
        const { markers, audioBuffer, project, region } = result;
        const { firstBeatTick } = gridAnchorTicks(markers, QUARTER);
        firstBeatTickRef.current = firstBeatTick;
        tempoEventsRef.current = beatsToTempoEvents(markers, QUARTER);
        const s0 = clipStartSeconds(markers);
        // End tick: last tracked beat + one bar of outro headroom.
        endTickRef.current = firstBeatTick + (markers.length - 1) * QUARTER + BAR;

        // The whole point: the audio NEVER changes. NoStretch, Seconds timeBase,
        // placed so the file's first tracked beat sounds exactly at firstBeatTick.
        // waveformOffset trims the file's pre-beat lead-in (a raw seconds shift
        // on the engine read position).
        project.editing.modify(() => {
          region.position.setValue(firstBeatTick);
          region.duration.setValue(audioBuffer.duration - s0);
          region.loopDuration.setValue(audioBuffer.duration - s0);
          region.waveformOffset.setValue(s0);
        });
        project.engine.setPosition(0);
        setSetup(result);
        setStatus("Ready — grid is RIGID, the metronome fights the music");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  // Live BPM + beat-residual readout (direct DOM, no per-frame setState).
  useEffect(() => {
    if (!setup) return undefined;
    const { project, markers } = setup;
    const s0 = clipStartSeconds(markers);
    const terminable = AnimationFrame.add(() => {
      const tick = project.engine.position.getValue();
      const bpmEl = bpmReadoutRef.current;
      if (bpmEl) bpmEl.textContent = project.tempoMap.getTempoAt(tick).toFixed(1);
      const driftEl = driftReadoutRef.current;
      if (driftEl) {
        if (!conformedRef.current) {
          driftEl.textContent = "n/a while rigid";
          return;
        }
        // Residual at the nearest tracked beat: grid second minus audio second.
        const n = Math.max(
          0,
          Math.min(
            markers.length - 1,
            Math.round((tick - firstBeatTickRef.current) / QUARTER)
          )
        );
        const gridSecond = project.tempoMap.ppqnToSeconds(
          firstBeatTickRef.current + n * QUARTER
        );
        const audioSecond =
          project.tempoMap.ppqnToSeconds(firstBeatTickRef.current) +
          (markers[n].second - s0);
        driftEl.textContent = `beat ${n + 1}: ${((gridSecond - audioSecond) * 1000).toFixed(2)} ms`;
      }
    });
    return () => terminable.terminate();
  }, [setup]);

  const toggleConform = useCallback(
    (next: boolean) => {
      if (!setup) return;
      const { project, projectBpm } = setup;
      const adapter = project.timelineBoxAdapter;
      const t0 = performance.now();
      project.editing.modify(() => {
        adapter.tempoTrackEvents.ifSome((collection: any) => {
          collection.events.asArray().forEach((event: any) => event.box.delete());
          const events: TempoEvent[] = next
            ? tempoEventsRef.current
            : [{ tick: 0, bpm: projectBpm }];
          for (const event of events) {
            collection.createEvent({
              position: event.tick as ppqn,
              index: 0,
              value: event.bpm,
              interpolation: Interpolation.None,
            });
          }
        });
      });
      // SPIKE INSTRUMENTATION — keep until verified, then remove:
      console.log(
        JSON.stringify({
          conform: next,
          events: next ? tempoEventsRef.current.length : 1,
          modifyMs: Math.round(performance.now() - t0),
        })
      );
      conformedRef.current = next;
      setConformed(next);
      setEventCount(next ? tempoEventsRef.current.length : 1);
      setRepaintKey((k) => k + 1);
    },
    [setup]
  );

  // ---- Waveform callbacks. Axis: real seconds (audio plays raw at rate 1.0).
  const totalSeconds = useCallback((): number => {
    if (!setup) return 1;
    return setup.project.tempoMap.ppqnToSeconds(endTickRef.current);
  }, [setup]);

  const getSegments = useCallback((): WaveformSegment[] => {
    if (!setup) return [];
    const { markers, audioBuffer, project } = setup;
    const s0 = clipStartSeconds(markers);
    const total = totalSeconds();
    const audioStart = project.tempoMap.ppqnToSeconds(firstBeatTickRef.current);
    return [
      {
        x0: audioStart / total,
        x1: (audioStart + (audioBuffer.duration - s0)) / total,
        u0: s0 / audioBuffer.duration,
        u1: 1,
      },
    ];
  }, [setup, totalSeconds]);

  const getBarLines = useCallback((): number[] => {
    if (!setup) return [];
    const total = totalSeconds();
    const lines: number[] = [];
    for (let tick = 0; tick <= endTickRef.current; tick += BAR) {
      lines.push(setup.project.tempoMap.ppqnToSeconds(tick) / total);
    }
    return lines;
  }, [setup, totalSeconds]);

  const getPlayheadFrac = useCallback((): number => {
    if (!setup) return 0;
    const tick = setup.project.engine.position.getValue();
    return setup.project.tempoMap.ppqnToSeconds(tick) / totalSeconds();
  }, [setup, totalSeconds]);

  return (
    <Theme appearance="dark" accentColor="iris">
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7">Warp the Grid: Set Tempo from Clip</Heading>
          <Text color="gray">
            The inverse of warping audio: the project's <em>tempo map</em> becomes the
            file's beat map — one stepped tempo event per tracked beat on OpenDAW's tempo
            track. The audio is scheduled once and never touched; it plays raw at rate
            1.0, bit-identical in both states. Only the metronome, the bar ruler, and the
            grid bend (Ableton <em>Set tempo from clip</em>, Logic Smart Tempo{" "}
            <em>ADAPT</em>).
          </Text>
          {error && (
            <Card>
              <Text color="red">{error}</Text>
            </Card>
          )}
          <Card>
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Text weight="bold">Status</Text>
                <Badge color={setup ? "green" : "orange"}>{status}</Badge>
              </Flex>
              <Separator size="4" />
              <Flex align="center" gap="3">
                <Switch checked={conformed} onCheckedChange={toggleConform} disabled={!setup} />
                <Text>Conform grid to file</Text>
                <Badge variant="soft">{eventCount} tempo events</Badge>
              </Flex>
              <Text size="2" color="gray">
                Tempo at playhead: <span ref={bpmReadoutRef}>—</span> BPM · Beat residual:{" "}
                <span ref={driftReadoutRef}>—</span>
              </Text>
            </Flex>
          </Card>
          {setup && (
            <Card>
              <WarpWaveform
                project={setup.project}
                fileUuid={setup.fileUuid}
                getSegments={getSegments}
                getBarLines={getBarLines}
                getPlayheadFrac={getPlayheadFrac}
                repaintKey={repaintKey}
              />
            </Card>
          )}
          <Flex gap="3">
            <button onClick={handlePlay} disabled={!setup}>Play</button>
            <button onClick={handlePause} disabled={!setup}>Pause</button>
            <button onClick={handleStop} disabled={!setup}>Stop</button>
          </Flex>
          <Card>
            <Flex direction="column" gap="2">
              <Heading size="4">The math (warp-markers ch 08)</Heading>
              <Text size="2" color="gray">
                One tempo event per beat segment — <code>tick = firstBeatTick + n·960</code>,{" "}
                <code>bpm = 60 / (s[n+1] − s[n])</code>, stepped interpolation. The file's
                pickup beat fills the end of the lead-in bar (the full-bars rule), and the
                region stays in Seconds timeBase: a Musical region would stretch under the
                new tempo map, defeating the point. Compare{" "}
                <Link href="/warp-varispeed-demo.html">varispeed</Link> (bends the sound)
                and <Link href="/warp-timestretch-demo.html">time-stretch</Link> (bends
                neither — it slices).
              </Text>
            </Flex>
          </Card>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpGridFollowsFileDemo />);
```

Same transport-button note as Task 6: copy the real transport markup from
time-pitch-demo.

Type the `collection` callback properly if `tempoTrackEvents`' adapter type
(`ValueEventCollectionBoxAdapter`) is exported from `@opendaw/studio-adapters` —
check `node_modules/@opendaw/studio-adapters/dist/*.d.ts` and replace the two
`any`s if so.

- [ ] **Step 2: HTML entry + vite input**

Copy `time-pitch-demo.html` → `warp-grid-follows-file-demo.html`; adjust title
(`OpenDAW Warp Demo — Set Tempo from Clip: the Grid Follows the File`),
description (`Conform the project tempo map to a real song's beat map with one stepped tempo event per beat. The audio plays untouched while the metronome and bar ruler bend — Ableton Set-tempo-from-clip / Logic Smart Tempo ADAPT, built with the OpenDAW SDK.`),
URLs, og-image (`og-image-warp-grid-follows-file.png`), script src
(`/src/demos/warp/warp-grid-follows-file-demo.tsx`). In `vite.config.ts` add:

```typescript
warpGridFollowsFile: resolve(__dirname, "warp-grid-follows-file-demo.html"),
```

- [ ] **Step 3: RUN THE SPIKE — verify 509-event tempo density**

With the dev server up, open `https://localhost:5180/warp-grid-follows-file-demo.html`
via Playwright MCP:

1. Toggle conform ON. Read the spike log line: `modifyMs` must be well under
   500 ms (one-off cost is acceptable; multi-second jank is not).
2. Play from the top through ≥ 30 s. The metronome click must land on the
   music's beats; the BPM readout must wobble per-beat (≈ 111–135).
3. Watch the beat-residual readout: must stay within single-digit milliseconds
   (float accumulation tolerance) while conformed.
4. Toggle conform OFF while stopped, play: metronome drifts against the music
   again, audio itself sounds identical.

**Fallback if the spike fails** (jank, engine stalls, or residual > 10 ms):
emit tempo events per *downbeat* instead — in `beatsToTempoEvents`, derive
events only at markers with `beatInBar === 1` using the bar-average BPM
`(60 * beatsInBar) / (nextDownbeatSecond - downbeatSecond)`; 4× sparser. Update
the unit tests accordingly and note the simplification in the demo explanation
card. Decide based on evidence, then delete the spike `console.log`.

- [ ] **Step 4: Remove spike instrumentation, verify, commit**

Delete the `console.log` block (CLAUDE.md: no stray debug logging). Re-run the
manual checks briefly, then:

```bash
git add src/demos/warp/warp-grid-follows-file-demo.tsx warp-grid-follows-file-demo.html vite.config.ts
git commit -m "feat: grid-follows-file demo — project tempo map conformed to beat map"
```

---

### Task 8: Demo 3 — Time-stretch (pitch preserved)

**Files:**
- Create: `src/demos/warp/warp-timestretch-demo.tsx`
- Create: `warp-timestretch-demo.html`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the demo page**

Structure is demo 1 with a 3-way mode switch instead of a 2-way toggle, an
async TimeStretch path (transient detection), and a `transientPlayMode`
control. Full file:

```tsx
// src/demos/warp/warp-timestretch-demo.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  AudioPitchStretchBox,
  AudioTimeStretchBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import {
  buildWarpAnchors,
  segmentBpms,
  gridAnchorTicks,
  type WarpAnchor,
} from "@/lib/beats/beatMapConversions";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import { WarpWaveform, type WaveformSegment } from "./lib/WarpWaveform";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Badge, Separator,
  SegmentedControl, Link,
} from "@radix-ui/themes";

const QUARTER = PPQN.Quarter;
const BAR = PPQN.fromSignature(4, 4);

type WarpMode = "raw" | "varispeed" | "timestretch";

function WarpTimestretchDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WarpMode>("raw");
  const [transientMode, setTransientMode] = useState<TransientPlayMode>(
    TransientPlayMode.Pingpong
  );
  const [transientCount, setTransientCount] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [repaintKey, setRepaintKey] = useState(0);

  const anchorsRef = useRef<WarpAnchor[]>([]);
  const modeRef = useRef<WarpMode>("raw");
  const stretchBoxRef = useRef<AudioPitchStretchBox | AudioTimeStretchBox | null>(null);
  // Re-entrancy guard for the async transient-detection path (stale-closure-proof).
  const switchingRef = useRef(false);
  const segmentReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  const project = setup?.project ?? null;
  const { isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({
    project,
    audioContext: setup?.audioContext ?? null,
    pausedPositionRef,
  });

  useEffect(() => {
    let cancelled = false;
    setupWarpDemo({ localAudioBuffers, onStatusUpdate: setStatus })
      .then((result) => {
        if (cancelled) return;
        anchorsRef.current = buildWarpAnchors(
          result.markers,
          result.audioBuffer.duration,
          QUARTER
        );
        setSetup(result);
        setStatus("Ready — raw playback drifts off the click");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("Failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  // Live segment readout, as in the varispeed demo — but in timestretch mode
  // the rate line notes that pitch stays put.
  useEffect(() => {
    if (!setup) return undefined;
    const bpms = segmentBpms(setup.markers);
    const { firstBeatTick } = gridAnchorTicks(setup.markers, QUARTER);
    const terminable = AnimationFrame.add(() => {
      const el = segmentReadoutRef.current;
      if (!el) return;
      if (modeRef.current === "raw") {
        el.textContent = "— (raw: file plays at its own wobbly tempo)";
        return;
      }
      const tick = setup.project.engine.position.getValue();
      const n = Math.floor((tick - firstBeatTick) / QUARTER);
      if (n < 0 || n >= bpms.length) {
        el.textContent = "— (outside the tracked beats)";
        return;
      }
      const rate = setup.projectBpm / bpms[n];
      const cents = 1200 * Math.log2(rate);
      el.textContent =
        modeRef.current === "varispeed"
          ? `segment ${n + 1}/${bpms.length} · rate ${rate.toFixed(3)} · ` +
            `${cents >= 0 ? "+" : ""}${cents.toFixed(0)} cents pitch shift`
          : `segment ${n + 1}/${bpms.length} · rate ${rate.toFixed(3)} · pitch unchanged`;
    });
    return () => terminable.terminate();
  }, [setup]);

  const switchMode = useCallback(
    async (next: WarpMode) => {
      if (!setup || switchingRef.current) return;
      const { project, region, audioBuffer, audioFileBox } = setup;
      const anchors = anchorsRef.current;
      const endTick = anchors[anchors.length - 1].tick;
      switchingRef.current = true;
      setSwitching(true);
      try {
        if (next === "timestretch") {
          setStatus("Detecting transients...");
          const positions = await ensureTransientMarkers(project, audioFileBox, audioBuffer);
          setTransientCount(positions.length);
        }
        // Single transaction per the SDK's AudioContentModifier pattern:
        // create new → refer (replaces atomically) → delete old → flip timeBase.
        project.editing.modify(() => {
          const prev = stretchBoxRef.current;
          if (next === "raw") {
            region.playMode.defer();
            if (prev) prev.delete();
            stretchBoxRef.current = null;
            region.timeBase.setValue(TimeBase.Seconds);
            region.duration.setValue(audioBuffer.duration);
            region.loopOffset.setValue(0);
            region.loopDuration.setValue(audioBuffer.duration);
            return;
          }
          const nextBox =
            next === "varispeed"
              ? AudioPitchStretchBox.create(project.boxGraph, UUID.generate())
              : AudioTimeStretchBox.create(project.boxGraph, UUID.generate(), (b) => {
                  b.transientPlayMode.setValue(transientMode);
                  b.playbackRate.setValue(1.0); // pitch preserved: rate 1, timing from markers
                });
          // The identical anchor list both engines consume — the ch09 thesis.
          for (const anchor of anchors) {
            WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
              m.owner.refer(nextBox.warpMarkers);
              m.position.setValue(anchor.tick);
              m.seconds.setValue(anchor.second);
            });
          }
          region.playMode.refer(nextBox);
          if (prev) prev.delete();
          stretchBoxRef.current = nextBox;
          region.timeBase.setValue(TimeBase.Musical);
          region.duration.setValue(endTick);
          region.loopOffset.setValue(0);
          region.loopDuration.setValue(endTick);
        });
        project.engine.setPosition(0);
        pausedPositionRef.current = 0;
        modeRef.current = next;
        setMode(next);
        setRepaintKey((k) => k + 1);
        setStatus("Ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        // editing.modify is atomic — reconcile UI to actual box state on throw.
        const current = stretchBoxRef.current;
        if (current === null) setMode("raw");
        else if (current instanceof AudioTimeStretchBox) setMode("timestretch");
        else setMode("varispeed");
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [setup, transientMode, pausedPositionRef]
  );

  const onTransientModeChange = useCallback(
    (value: string) => {
      const nextMode = Number(value) as TransientPlayMode;
      setTransientMode(nextMode);
      if (!setup) return;
      const box = stretchBoxRef.current;
      if (box instanceof AudioTimeStretchBox) {
        // transientPlayMode writes do NOT reset engine.position (verified) —
        // safe as a live control.
        setup.project.editing.modify(() => {
          box.transientPlayMode.setValue(nextMode);
        });
      }
    },
    [setup]
  );

  // ---- Waveform callbacks: identical mapping logic to the varispeed demo,
  // with "warped" meaning either conform mode.
  const getSegments = useCallback((): WaveformSegment[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    if (modeRef.current === "raw") return [{ x0: 0, x1: 1, u0: 0, u1: 1 }];
    const endTick = anchors[anchors.length - 1].tick;
    const duration = setup.audioBuffer.duration;
    const segments: WaveformSegment[] = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      segments.push({
        x0: anchors[i].tick / endTick,
        x1: anchors[i + 1].tick / endTick,
        u0: anchors[i].second / duration,
        u1: anchors[i + 1].second / duration,
      });
    }
    return segments;
  }, [setup]);

  const getBarLines = useCallback((): number[] => {
    if (!setup) return [];
    const anchors = anchorsRef.current;
    const endTick = anchors[anchors.length - 1].tick;
    const lines: number[] = [];
    if (modeRef.current !== "raw") {
      for (let tick = 0; tick <= endTick; tick += BAR) lines.push(tick / endTick);
    } else {
      const barSeconds = (BAR / QUARTER) * (60 / setup.projectBpm);
      for (let s = 0; s <= setup.audioBuffer.duration; s += barSeconds) {
        lines.push(s / setup.audioBuffer.duration);
      }
    }
    return lines;
  }, [setup]);

  const getPlayheadFrac = useCallback((): number => {
    if (!setup) return 0;
    const tick = setup.project.engine.position.getValue();
    const anchors = anchorsRef.current;
    if (modeRef.current !== "raw") return tick / anchors[anchors.length - 1].tick;
    const seconds = (tick / QUARTER) * (60 / setup.projectBpm);
    return seconds / setup.audioBuffer.duration;
  }, [setup]);

  return (
    <Theme appearance="dark" accentColor="iris">
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7">Warp to Grid: Time-Stretch</Heading>
          <Text color="gray">
            The triptych on one page. <em>Raw</em> drifts off the metronome.{" "}
            <em>Varispeed</em> locks the beats and changes the key.{" "}
            <em>Time-stretch</em> locks the beats and keeps it — the{" "}
            <strong>identical warp-marker list</strong> consumed by an{" "}
            <code>AudioTimeStretchBox</code>, which plays transient-bounded segments at
            rate 1.0 and resynchronizes at each transient (closer to Ableton's{" "}
            <em>Beats</em> mode than to a granular engine).
          </Text>
          {error && (
            <Card>
              <Text color="red">{error}</Text>
            </Card>
          )}
          <Card>
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center">
                <Text weight="bold">Status</Text>
                <Badge color={setup ? "green" : "orange"}>{status}</Badge>
              </Flex>
              <Separator size="4" />
              <div
                style={{
                  opacity: switching ? 0.5 : 1,
                  pointerEvents: switching ? "none" : "auto",
                }}
              >
                <Flex direction="column" gap="3">
                  <SegmentedControl.Root
                    value={mode}
                    onValueChange={(v) => switchMode(v as WarpMode)}
                    disabled={!setup || isPlaying}
                  >
                    <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
                    <SegmentedControl.Item value="varispeed">Varispeed</SegmentedControl.Item>
                    <SegmentedControl.Item value="timestretch">Time-Stretch</SegmentedControl.Item>
                  </SegmentedControl.Root>
                  <Flex align="center" gap="3">
                    <Text size="2">Transient play mode</Text>
                    <SegmentedControl.Root
                      value={String(transientMode)}
                      onValueChange={onTransientModeChange}
                      disabled={mode !== "timestretch"}
                    >
                      <SegmentedControl.Item value={String(TransientPlayMode.Once)}>
                        Once
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value={String(TransientPlayMode.Repeat)}>
                        Repeat
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value={String(TransientPlayMode.Pingpong)}>
                        Pingpong
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                    {transientCount !== null && (
                      <Badge variant="soft">{transientCount} transients</Badge>
                    )}
                  </Flex>
                </Flex>
              </div>
              <Text size="2" color="gray">
                Current segment: <span ref={segmentReadoutRef}>—</span>
              </Text>
            </Flex>
          </Card>
          {setup && (
            <Card>
              <WarpWaveform
                project={setup.project}
                fileUuid={setup.fileUuid}
                getSegments={getSegments}
                getBarLines={getBarLines}
                getPlayheadFrac={getPlayheadFrac}
                repaintKey={repaintKey}
              />
            </Card>
          )}
          <Flex gap="3">
            <button onClick={handlePlay} disabled={!setup}>Play</button>
            <button onClick={handlePause} disabled={!setup}>Pause</button>
            <button onClick={handleStop} disabled={!setup}>Stop</button>
          </Flex>
          <Card>
            <Flex direction="column" gap="2">
              <Heading size="4">The thesis (warp-markers ch 09)</Heading>
              <Text size="2" color="gray">
                The warp math does not change. The same anchors driving{" "}
                <Link href="/warp-varispeed-demo.html">varispeed</Link> drive this engine
                untouched — swapping the stretch algorithm never moves a marker, which is
                why Ableton lets you change a clip's warp <em>mode</em> without touching
                its warp <em>markers</em>. Honest limits apply: transients can smear or
                double under heavy stretching, and extreme rates expose segment looping.
                The third direction —{" "}
                <Link href="/warp-grid-follows-file-demo.html">bend the grid instead</Link>{" "}
                — costs no DSP at all.
              </Text>
            </Flex>
          </Card>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpTimestretchDemo />);
```

Same transport-button note as Task 6. Verify `SegmentedControl.Root` accepts
`disabled` in the installed Radix version (time-pitch-demo wraps in a dimmed
div instead if not — copy that pattern on mismatch).

- [ ] **Step 2: HTML entry + vite input**

Copy `time-pitch-demo.html` → `warp-timestretch-demo.html`; title
(`OpenDAW Warp Demo — Time-Stretch: Lock the Beats, Keep the Key`), description
(`The warp triptych audible on one page: raw drifts, varispeed locks beats but detunes, time-stretch locks beats with pitch preserved — the identical warp markers through OpenDAW's transient-aware stretch engine.`),
URLs, og-image (`og-image-warp-timestretch.png`), script src
(`/src/demos/warp/warp-timestretch-demo.tsx`). In `vite.config.ts`:

```typescript
warpTimestretch: resolve(__dirname, "warp-timestretch-demo.html"),
```

- [ ] **Step 3: Verify in the browser**

`https://localhost:5180/warp-timestretch-demo.html` via Playwright MCP:
Raw → drifts; Varispeed → locked + detuned; Time-Stretch → "Detecting
transients..." then locked at original pitch; transient count badge shows;
transient play-mode switch audibly changes texture while playing; A/B/C all
clean of console errors.

- [ ] **Step 4: Commit**

```bash
git add src/demos/warp/warp-timestretch-demo.tsx warp-timestretch-demo.html vite.config.ts
git commit -m "feat: time-stretch warp demo — same anchors, pitch preserved"
```

---

### Task 9: Registration sweep + knowledge capture

**Files:**
- Modify: `src/index.tsx`, `public/sitemap.xml`, `CLAUDE.md` (root)
- Create: `src/demos/warp/CLAUDE.md`, `public/og-image-warp-varispeed.png`, `public/og-image-warp-grid-follows-file.png`, `public/og-image-warp-timestretch.png`

- [ ] **Step 1: Add three cards to src/index.tsx**

Insert after the Time & Pitch card (`/time-pitch-demo.html`, ~line 226), same
`Card asChild > Link > Flex` markup as existing cards:

```tsx
<Card asChild>
  <Link href="/warp-varispeed-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
    <Flex direction="column" gap="3">
      <Flex direction="column" align="center" gap="2">
        <Text size="8">📌</Text>
        <Heading size="5">Warp: Varispeed</Heading>
      </Flex>
      <Text size="2" color="gray">
        Pin every tracked beat of a real song to the project grid with warp
        markers. Beats lock to the metronome; pitch follows rate, tape-style.
      </Text>
    </Flex>
  </Link>
</Card>
<Card asChild>
  <Link href="/warp-grid-follows-file-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
    <Flex direction="column" gap="3">
      <Flex direction="column" align="center" gap="2">
        <Text size="8">📐</Text>
        <Heading size="5">Warp: Set Tempo from Clip</Heading>
      </Flex>
      <Text size="2" color="gray">
        Conform the project tempo map to a song's beat map — one stepped tempo
        event per beat. The audio plays untouched while the grid bends to it.
      </Text>
    </Flex>
  </Link>
</Card>
<Card asChild>
  <Link href="/warp-timestretch-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
    <Flex direction="column" gap="3">
      <Flex direction="column" align="center" gap="2">
        <Text size="8">🧩</Text>
        <Heading size="5">Warp: Time-Stretch</Heading>
      </Flex>
      <Text size="2" color="gray">
        The triptych on one page: raw drifts, varispeed detunes, time-stretch
        locks the beats and keeps the key — identical warp markers throughout.
      </Text>
    </Flex>
  </Link>
</Card>
```

- [ ] **Step 2: Add three URLs to public/sitemap.xml**

Copy an existing `<url>` block for each:
`warp-varispeed-demo.html`, `warp-grid-follows-file-demo.html`,
`warp-timestretch-demo.html`.

- [ ] **Step 3: og-images**

With the dev server running, use Playwright MCP at 1200×630 viewport to
screenshot each demo page in its most visual state (waveform rendered; demo 2
conformed), save as `public/og-image-warp-varispeed.png`,
`public/og-image-warp-grid-follows-file.png`,
`public/og-image-warp-timestretch.png`. The HTML files from Tasks 6–8 already
reference these names.

- [ ] **Step 4: Write src/demos/warp/CLAUDE.md**

Capture as directives (per the CLAUDE.md style memory — no narrative,
observation → directive) what implementation actually confirmed. Seed list, to
be corrected against reality:

```markdown
# Warp Demos — OpenDAW SDK Reference

### Beat Maps → SDK Machinery
- `.beats` parsing and all beat-map math live in `src/lib/beats/` (pure, unit-tested).
  Demos only create boxes from the results. Keep new beat-map math there, not in demo files.
- Warp anchors are engine-agnostic: `buildWarpAnchors()` output feeds AudioPitchStretchBox
  and AudioTimeStretchBox identically. Only the box type changes between varispeed and
  time-stretch.
- One `WarpMarkerBox` per tracked beat (~510 for a full song) is fine — creation in a
  single `editing.modify()` transaction. [CONFIRM during Task 6]
- Tempo track accepts ~509 stepped events in one transaction; `VaryingTempoMap` follows
  them at audio rate. [CONFIRM during Task 7 spike; replace with the per-downbeat
  fallback note if it failed]
- Grid-follows-file regions must stay `TimeBase.Seconds` — a Musical region stretches
  under the conformed tempo map, silently defeating the comparison.
- `region.waveformOffset.setValue(s0)` trims a beat map's pre-beat lead-in audio
  (raw seconds shift on the engine read position) without touching loopOffset.

## Reference Files
- Beat math: `src/lib/beats/beatMapConversions.ts`
- Shared setup: `src/demos/warp/lib/setupWarpDemo.ts`
- Source tutorial: /Users/naomiaro/Code/warp-markers (chapters 07–09 + appendix)
```

- [ ] **Step 5: Add the category line to root CLAUDE.md**

In the "Demo-Specific SDK Knowledge" list add:

```markdown
- `src/demos/warp/CLAUDE.md` — beat maps, warp markers, tempo-map conform, time-stretch
```

- [ ] **Step 6: Full verification**

```bash
npm test && npm run build
```

Expected: all unit tests pass; Vite + VitePress build clean. Then click through
all three pages once more on the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/index.tsx public/sitemap.xml public/og-image-warp-*.png src/demos/warp/CLAUDE.md CLAUDE.md
git commit -m "feat: register warp triptych demos — index cards, sitemap, og-images, demo CLAUDE.md"
```

---

## Done criteria

- `npm test` green (parser + conversions, including real-file fixture).
- `npm ci && npm run build` green (lockfile integrity — the Cloudflare failure mode).
- All three pages load over HTTPS, play, and demonstrate their A/B audibly without console errors.
- Demo 2 spike result documented in `src/demos/warp/CLAUDE.md` (either density confirmed or fallback noted).
- Branch ready for PR (per user workflow memory: substantive work goes through a PR).
