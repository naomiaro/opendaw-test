# Jam to Arrangement Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new demo (`jam-arrangement-demo`) that teaches clips vs regions by letting the user jam with a 4×3 audio-clip launcher grid (Dark Ride stems) and commit playing combos into a region-based arrangement they can play back linearly.

**Architecture:** Single project, four shared Tape tracks. Clips (hand-built `AudioClipBox`es, columns = 1/2/4-bar loop lengths) and committed regions (`AudioRegionBox`es in successive 4-bar sections) live on the same tracks — launching a clip takes over its track from regions (engine behavior). Pure helpers (section math, clip-state reducer, waveform peaks) are unit-tested with vitest; engine/UI wiring is verified in the browser.

**Tech Stack:** React + Radix Theme, OpenDAW SDK 0.0.164 (WASM engine), vitest, repo `CanvasPainter`, mastering-console design language.

**Spec:** `docs/superpowers/specs/2026-08-04-clips-vs-regions-jam-arrangement-design.md`

## Global Constraints

- Branch: `jam-arrangement-demo` (already exists, contains the spec commit).
- BPM fixed at **124** (Dark Ride). All bar math via `PPQN.Bar` (= 3840 PPQN).
- All box-graph writes inside `project.editing.modify(() => {...})`; never call `editing.modify` inside `editing.subscribe`; throw (don't `return`) to abort a transaction.
- Option types: never `?.`/`??`; use `.isEmpty()`/`.unwrap()`.
- Every `subscribe`/`catchupAndSubscribe` returns a `Terminable` — store and `.terminate()` in effect cleanup.
- `UUID.Bytes` is not a string — `UUID.toString(uuid)` for Map/React keys.
- Int32 PPQN fields (`position`) get `Math.round()`ed integers.
- Adapter traversal, not `boxGraph.boxes()` scans; use `getAllAudioRegions` / `audioUnitAdapterFor` from `src/lib/adapterUtils.ts`.
- Canvas colors from `CANVAS_COLORS` / literals mirroring `--mc-*` (canvas can't read CSS vars). Design language: `docs/design/2026-06-11-mastering-console-editorial.md`.
- Type-check with `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/'` — judge against parent-commit baseline, zero NEW errors.
- Unit tests: `npx vitest run <file>`.
- Verified SDK facts (do not re-derive): engine reads only `loop` from ClipPlaybackFields (default true — don't set it); launch quantizes to next bar (idle track) or the playing clip's duration grid (handover); launching starts the transport; transport stop resets the clip sequencer; one clip max per track; a clip loops the first `duration` PPQN of its file.

---

### Task 1: Arrangement section math (`arrangement.ts`)

**Files:**
- Create: `src/demos/clips/arrangement.ts`
- Test: `src/demos/clips/arrangement.test.ts`

**Interfaces:**
- Produces: `BPM = 124`, `SECTION_BARS = 4`, `SECTION_PPQN` (number), `JAM_PARK_POSITION` (ppqn number), `barSeconds(bpm)` (seconds per bar), `nextFreeSectionStart(regionEnds: ReadonlyArray<number>): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/demos/clips/arrangement.test.ts
import { describe, expect, it } from "vitest";
import { PPQN } from "@opendaw/lib-dsp";
import { SECTION_PPQN, nextFreeSectionStart, barSeconds } from "./arrangement";

describe("nextFreeSectionStart", () => {
  it("returns 0 for an empty arrangement", () => {
    expect(nextFreeSectionStart([])).toBe(0);
  });
  it("returns the next section boundary after the furthest region end", () => {
    // one committed section: regions end at 4 bars
    expect(nextFreeSectionStart([SECTION_PPQN])).toBe(SECTION_PPQN);
    // ends at bars 4 and 8 -> next free is bar 8
    expect(nextFreeSectionStart([SECTION_PPQN, 2 * SECTION_PPQN])).toBe(2 * SECTION_PPQN);
  });
  it("rounds a partial section up to the next boundary", () => {
    expect(nextFreeSectionStart([PPQN.Bar])).toBe(SECTION_PPQN);
    expect(nextFreeSectionStart([SECTION_PPQN + 1])).toBe(2 * SECTION_PPQN);
  });
});

describe("barSeconds", () => {
  it("is 4 beats at the given tempo", () => {
    expect(barSeconds(124)).toBeCloseTo((60 / 124) * 4, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/demos/clips/arrangement.test.ts`
Expected: FAIL — cannot resolve `./arrangement`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/demos/clips/arrangement.ts
// Section math for the jam-to-arrangement demo. Pure — no engine imports.
import { PPQN } from "@opendaw/lib-dsp";

export const BPM = 124; // Dark Ride
export const SECTION_BARS = 4;
export const SECTION_PPQN = SECTION_BARS * PPQN.Bar;

// While jamming the playhead free-runs; park it far past any plausible
// arrangement so committed regions on clip-less tracks never intersect it.
export const JAM_PARK_POSITION = 1000 * PPQN.Bar;

export const barSeconds = (bpm: number): number => (60 / bpm) * 4;

/** Next free 4-bar section boundary at or after every region end. Empty -> 0. */
export const nextFreeSectionStart = (regionEnds: ReadonlyArray<number>): number => {
  if (regionEnds.length === 0) return 0;
  const maxEnd = Math.max(...regionEnds);
  return Math.ceil(maxEnd / SECTION_PPQN) * SECTION_PPQN;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/demos/clips/arrangement.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demos/clips/arrangement.ts src/demos/clips/arrangement.test.ts
git commit -m "feat(clips): arrangement section math for jam-arrangement demo"
```

---

### Task 2: Clip-state reducer (`clipStates.ts`)

**Files:**
- Create: `src/demos/clips/clipStates.ts`
- Test: `src/demos/clips/clipStates.test.ts`

**Interfaces:**
- Consumes: `ClipNotification` type from `@opendaw/studio-adapters` (`{type:"waiting", clips: UUID.Bytes[]}` | `{type:"sequencing", changes:{started, stopped, obsolete}}`).
- Produces: `type ClipState = "waiting" | "playing"`, `type ClipStateMap = ReadonlyMap<string, ClipState>` (key = `UUID.toString(clipUuid)`; absent = idle), `applyClipNotification(prev: ClipStateMap, notification: ClipNotification): ClipStateMap`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/demos/clips/clipStates.test.ts
import { describe, expect, it } from "vitest";
import { UUID } from "@opendaw/lib-std";
import type { ClipNotification } from "@opendaw/studio-adapters";
import { applyClipNotification, type ClipStateMap } from "./clipStates";

const a = UUID.generate();
const b = UUID.generate();
const key = (u: UUID.Bytes) => UUID.toString(u);
const empty: ClipStateMap = new Map();

describe("applyClipNotification", () => {
  it("marks scheduled clips waiting", () => {
    const n: ClipNotification = { type: "waiting", clips: [a] };
    expect(applyClipNotification(empty, n).get(key(a))).toBe("waiting");
  });
  it("keeps an already-playing clip playing while another waits (handover)", () => {
    const playing: ClipStateMap = new Map([[key(a), "playing"]]);
    const next = applyClipNotification(playing, { type: "waiting", clips: [b] });
    expect(next.get(key(a))).toBe("playing");
    expect(next.get(key(b))).toBe("waiting");
  });
  it("promotes started clips and clears stopped/obsolete", () => {
    const prev: ClipStateMap = new Map([[key(a), "playing"], [key(b), "waiting"]]);
    const n: ClipNotification = {
      type: "sequencing",
      changes: { started: [b], stopped: [a], obsolete: [] },
    };
    const next = applyClipNotification(prev, n);
    expect(next.get(key(b))).toBe("playing");
    expect(next.has(key(a))).toBe(false);
  });
  it("does not mutate the previous map", () => {
    const prev: ClipStateMap = new Map();
    applyClipNotification(prev, { type: "waiting", clips: [a] });
    expect(prev.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/demos/clips/clipStates.test.ts`
Expected: FAIL — cannot resolve `./clipStates`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/demos/clips/clipStates.ts
// Pure reducer over engine clip notifications. Absent key = idle.
import { UUID } from "@opendaw/lib-std";
import type { ClipNotification } from "@opendaw/studio-adapters";

export type ClipState = "waiting" | "playing";
export type ClipStateMap = ReadonlyMap<string, ClipState>;

export const applyClipNotification = (
  prev: ClipStateMap,
  notification: ClipNotification,
): ClipStateMap => {
  const next = new Map(prev);
  if (notification.type === "waiting") {
    notification.clips.forEach(uuid => next.set(UUID.toString(uuid), "waiting"));
  } else {
    const { started, stopped, obsolete } = notification.changes;
    stopped.forEach(uuid => next.delete(UUID.toString(uuid)));
    obsolete.forEach(uuid => next.delete(UUID.toString(uuid)));
    started.forEach(uuid => next.set(UUID.toString(uuid), "playing"));
  }
  return next;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/demos/clips/clipStates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demos/clips/clipStates.ts src/demos/clips/clipStates.test.ts
git commit -m "feat(clips): pure clip-state reducer over engine clip notifications"
```

---

### Task 3: Waveform peaks helper (`waveform.ts`)

**Files:**
- Create: `src/demos/clips/waveform.ts`
- Test: `src/demos/clips/waveform.test.ts`

**Interfaces:**
- Produces: `computePeaks(channel: Float32Array, startFrame: number, frameCount: number, buckets: number): Float32Array` (length `buckets`, per-bucket max |sample|, clamped to channel bounds) and `drawWaveform(ctx: CanvasRenderingContext2D, buffer: AudioBuffer, opts: {x: number; y: number; width: number; height: number; color: string; startSeconds: number; durationSeconds: number}): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/demos/clips/waveform.test.ts
import { describe, expect, it } from "vitest";
import { computePeaks } from "./waveform";

describe("computePeaks", () => {
  it("takes the max absolute sample per bucket", () => {
    const channel = new Float32Array([0.1, -0.5, 0.2, 0.9]);
    const peaks = computePeaks(channel, 0, 4, 2);
    expect(Array.from(peaks)).toEqual([0.5, 0.9]);
  });
  it("clamps reads past the end of the channel to silence", () => {
    const channel = new Float32Array([0.5, 0.5]);
    const peaks = computePeaks(channel, 0, 8, 4);
    expect(peaks[0]).toBe(0.5);
    expect(peaks[3]).toBe(0);
  });
  it("respects a non-zero start frame", () => {
    const channel = new Float32Array([0.9, 0.9, 0.1, 0.2]);
    const peaks = computePeaks(channel, 2, 2, 1);
    expect(peaks[0]).toBeCloseTo(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/demos/clips/waveform.test.ts`
Expected: FAIL — cannot resolve `./waveform`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/demos/clips/waveform.ts
// Minimal waveform rendering straight from AudioBuffers the demo already holds
// (no SampleLoader/peaks subscription needed).

export const computePeaks = (
  channel: Float32Array,
  startFrame: number,
  frameCount: number,
  buckets: number,
): Float32Array => {
  const peaks = new Float32Array(buckets);
  const framesPerBucket = frameCount / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(startFrame + b * framesPerBucket);
    const to = Math.min(Math.floor(from + framesPerBucket), channel.length);
    let peak = 0;
    for (let i = Math.max(from, 0); i < to; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
  }
  return peaks;
};

export const drawWaveform = (
  ctx: CanvasRenderingContext2D,
  buffer: AudioBuffer,
  opts: {
    x: number; y: number; width: number; height: number;
    color: string; startSeconds: number; durationSeconds: number;
  },
): void => {
  const { x, y, width, height, color, startSeconds, durationSeconds } = opts;
  const buckets = Math.max(1, Math.floor(width));
  const channel = buffer.getChannelData(0);
  const startFrame = Math.floor(startSeconds * buffer.sampleRate);
  const frameCount = Math.floor(durationSeconds * buffer.sampleRate);
  const peaks = computePeaks(channel, startFrame, frameCount, buckets);
  const mid = y + height / 2;
  ctx.fillStyle = color;
  for (let b = 0; b < buckets; b++) {
    const h = Math.max(1, peaks[b] * height);
    ctx.fillRect(x + b, mid - h / 2, 1, h);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/demos/clips/waveform.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demos/clips/waveform.ts src/demos/clips/waveform.test.ts
git commit -m "feat(clips): audio-buffer waveform peaks helper"
```

---

### Task 4: Jam session boot module (`jamSetup.ts`)

**Files:**
- Create: `src/demos/clips/jamSetup.ts`
- Reference (read, don't modify): `src/lib/trackLoading.ts` (hand-built region pattern), `src/lib/audioUtils.ts` (`loadAudioFile`, `getAudioExtension`)

**Interfaces:**
- Consumes: `initializeOpenDAW`'s `Project`, `AudioContext`, and the shared `localAudioBuffers` map (page passes the same map it gave `initializeOpenDAW`); `BPM`, `barSeconds` from Task 1.
- Produces:
  - `const CLIP_COLUMNS: readonly [1, 2, 4]`
  - `type JamClip = { box: AudioClipBox; uuidString: string; bars: 1 | 2 | 4 }`
  - `type JamTrack = { name: string; color: string; trackBox: TrackBox; audioUnitBox: AudioUnitBox; fileBox: AudioFileBox; audioBuffer: AudioBuffer; clips: JamClip[] }`
  - `createJamSession(project: Project, audioContext: AudioContext, localAudioBuffers: Map<string, AudioBuffer>): Promise<JamTrack[]>`

- [ ] **Step 1: Write the implementation**

Minimal audible clip recipe (verified against openDAW's own engine test
`packages/app/wasm/test/audio-clip-playback.test.ts`): `clips` → `track.clips`,
`file` → `AudioFileBox`, `duration` (PPQN, default Musical timeBase), `events`
→ `ValueEventCollectionBox.owners`, plus `index`/`label` for the UI. Do NOT set
`timeBase` — the engine test omits it and PPQN duration is what the sequencer
loops on. (This resolves the spec's seconds-vs-PPQN caveat: hand-building with
Musical timeBase sidesteps the factory's Seconds path entirely.)

```typescript
// src/demos/clips/jamSetup.ts
// Boot for the jam-arrangement demo: 4 Tape tracks from Dark Ride stems, each
// with 3 launcher clips (1/2/4-bar loops of the stem's opening bars). No
// timeline regions are created here — the arrangement is built by Commit.
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import {
  AudioClipBox,
  AudioFileBox,
  AudioUnitBox,
  TrackBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { getAudioExtension, loadAudioFile } from "@/lib/audioUtils";

export const CLIP_COLUMNS = [1, 2, 4] as const;

export type JamClip = {
  box: AudioClipBox;
  uuidString: string;
  bars: (typeof CLIP_COLUMNS)[number];
};

export type JamTrack = {
  name: string;
  color: string; // canvas literal mirroring an --mc-* token
  trackBox: TrackBox;
  audioUnitBox: AudioUnitBox;
  fileBox: AudioFileBox;
  audioBuffer: AudioBuffer;
  clips: JamClip[];
};

// Canvas 2D can't read CSS vars — literals mirror consoleTheme tokens.
const STEMS: ReadonlyArray<{ name: string; file: string; color: string }> = [
  { name: "Drums", file: "02_Drums", color: "#e8a33d" },   // --mc-amber
  { name: "Bass", file: "03_Bass", color: "#5fb4c9" },     // --mc-cyan
  { name: "Guitars", file: "04_ElecGtrs", color: "#7fbf6a" }, // --mc-green
  { name: "Vox", file: "06_Vox", color: "#df8a76" },       // --mc-rose
];

export async function createJamSession(
  project: Project,
  audioContext: AudioContext,
  localAudioBuffers: Map<string, AudioBuffer>,
): Promise<JamTrack[]> {
  const ext = getAudioExtension();
  const boxGraph = project.boxGraph;
  const tracks: JamTrack[] = [];

  for (const stem of STEMS) {
    const audioBuffer = await loadAudioFile(
      audioContext,
      `/audio/DarkRide/${stem.file}.${ext}`,
    );
    const fileUUID = UUID.generate();
    localAudioBuffers.set(UUID.toString(fileUUID), audioBuffer);

    project.editing.modify(() => {
      const { audioUnitBox, trackBox } = project.api.createInstrument(
        InstrumentFactories.Tape,
      );
      audioUnitBox.volume.setValue(0);

      const fileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
        box.fileName.setValue(stem.name);
        box.endInSeconds.setValue(audioBuffer.duration);
      });

      const clips: JamClip[] = CLIP_COLUMNS.map((bars, column) => {
        const eventsBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());
        const clipUUID = UUID.generate();
        const box = AudioClipBox.create(boxGraph, clipUUID, clip => {
          clip.clips.refer(trackBox.clips);
          clip.file.refer(fileBox);
          clip.events.refer(eventsBox.owners);
          clip.duration.setValue(bars * PPQN.Bar);
          clip.index.setValue(column);
          clip.label.setValue(`${stem.name} ${bars} bar${bars > 1 ? "s" : ""}`);
        });
        return { box, uuidString: UUID.toString(clipUUID), bars };
      });

      tracks.push({
        name: stem.name,
        color: stem.color,
        trackBox,
        audioUnitBox,
        fileBox,
        audioBuffer,
        clips,
      });
    });
  }

  // Arrangement playback must run linearly — kill the default timeline loop.
  project.editing.modify(() => {
    project.timelineBox.loopArea.enabled.setValue(false);
  });

  await project.engine.queryLoadingComplete();
  project.engine.setPosition(0);
  return tracks;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/demos/clips/'`
Expected: no output (zero errors in the new folder). If `AudioClipBox` field
names differ, verify against
`node_modules/@opendaw/studio-boxes/dist/AudioClipBox.d.ts` (getters: `clips`,
`file`, `index`, `events`, `duration`, `label`, `mute`, `gain`, `hue`,
`playMode`, `timeBase`, `waveformOffset`, `triggerMode`).

- [ ] **Step 3: Commit**

```bash
git add src/demos/clips/jamSetup.ts
git commit -m "feat(clips): jam session boot — 4 stem tracks x 3 launcher clips"
```

---

### Task 5: `useClipStates` hook

**Files:**
- Create: `src/demos/clips/useClipStates.ts`

**Interfaces:**
- Consumes: `applyClipNotification`, `ClipStateMap` (Task 2); `project.engine.subscribeClipNotification(observer): Subscription` (verified on `EngineFacade`, SDK 0.0.164).
- Produces: `useClipStates(project: Project | null): ClipStateMap`.

- [ ] **Step 1: Write the implementation**

```typescript
// src/demos/clips/useClipStates.ts
import { useEffect, useState } from "react";
import { Project } from "@opendaw/studio-core";
import { applyClipNotification, type ClipStateMap } from "./clipStates";

/** Live clip launcher state (absent key = idle). Subscribes to the engine's
 *  clip notifications: "waiting" fires on schedule (optimistic), "sequencing"
 *  confirms started/stopped/obsolete at quantize boundaries. */
export function useClipStates(project: Project | null): ClipStateMap {
  const [states, setStates] = useState<ClipStateMap>(new Map());

  useEffect(() => {
    if (project === null) return;
    const subscription = project.engine.subscribeClipNotification(notification => {
      setStates(prev => applyClipNotification(prev, notification));
    });
    return () => {
      subscription.terminate();
      setStates(new Map());
    };
  }, [project]);

  return states;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/demos/clips/'`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/demos/clips/useClipStates.ts
git commit -m "feat(clips): useClipStates hook over engine clip notifications"
```

---

### Task 6: Clip grid component (`ClipGrid.tsx`)

**Files:**
- Create: `src/demos/clips/ClipGrid.tsx`

**Interfaces:**
- Consumes: `JamTrack`/`JamClip`/`CLIP_COLUMNS` (Task 4), `ClipStateMap` (Task 2), `drawWaveform` (Task 3), `barSeconds`/`BPM` (Task 1), `AnimationFrame` from `@opendaw/lib-dom`, `PPQN` from `@opendaw/lib-dsp`.
- Produces: `ClipGrid({ project, tracks, clipStates, onLaunch }: { project: Project; tracks: JamTrack[]; clipStates: ClipStateMap; onLaunch: () => void })` — `onLaunch` fires before every `scheduleClipPlay` so the page can enter jam mode / park the playhead.

Behavior:
- Cell click: state `"playing"` → `project.engine.scheduleClipStop([track.trackBox.address.uuid])`; otherwise `onLaunch(); project.engine.scheduleClipPlay([clip.box.address.uuid])`.
- Column header button: `onLaunch(); project.engine.scheduleClipPlay(columnClipUuids)` (the ≤4 clips at that index — "Launch scene").
- "Stop clips" button: `project.engine.scheduleClipStop(tracks.map(t => t.trackBox.address.uuid))`.
- Cell visuals: mini waveform canvas drawn once on mount from `track.audioBuffer` (`startSeconds: 0`, `durationSeconds: clip.bars * barSeconds(BPM)`, color `track.color`); `waiting` → CSS blink animation on the cell border; `playing` → bottom progress bar whose width is driven per-frame.
- Progress: ONE `AnimationFrame.add` for the whole grid (terminate on unmount). Per playing cell: `const loopPpqn = clip.bars * PPQN.Bar; el.style.setProperty("--progress", String((project.engine.position.getValue() % loopPpqn) / loopPpqn))`. Direct DOM via refs — no setState per frame (repo rule).

- [ ] **Step 1: Write the implementation**

Skeleton (implementer fills in Radix/`mc-` styling per the design doc; grid is
`<table>`-free flex/grid CSS: header row of 3 scene buttons + stop button, then
one row per track: name chip + 3 cells):

```tsx
// src/demos/clips/ClipGrid.tsx
import React, { useEffect, useRef } from "react";
import { Project } from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import { BPM, barSeconds } from "./arrangement";
import { CLIP_COLUMNS, type JamClip, type JamTrack } from "./jamSetup";
import type { ClipStateMap } from "./clipStates";
import { drawWaveform } from "./waveform";

const CELL_WIDTH = 132;
const CELL_HEIGHT = 56;

function ClipCell({ project, track, clip, state, onLaunch }: {
  project: Project;
  track: JamTrack;
  clip: JamClip;
  state: "waiting" | "playing" | undefined;
  onLaunch: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWaveform(ctx, track.audioBuffer, {
      x: 0, y: 0, width: canvas.width, height: canvas.height,
      color: track.color,
      startSeconds: 0,
      durationSeconds: clip.bars * barSeconds(BPM),
    });
  }, [track, clip]);

  const handleClick = () => {
    if (state === "playing") {
      project.engine.scheduleClipStop([track.trackBox.address.uuid]);
    } else {
      onLaunch();
      project.engine.scheduleClipPlay([clip.box.address.uuid]);
    }
  };

  return (
    <button
      type="button"
      className={`clip-cell${state ? ` clip-cell--${state}` : ""}`}
      data-clip={clip.uuidString}
      onClick={handleClick}
      aria-label={`${track.name} ${clip.bars}-bar clip: ${
        state === "playing" ? "stop track" : "launch"}`}
    >
      <canvas ref={canvasRef} width={CELL_WIDTH} height={CELL_HEIGHT} />
      <span className="clip-cell__bars">{clip.bars} bar{clip.bars > 1 ? "s" : ""}</span>
      <span className="clip-cell__progress" />
    </button>
  );
}

export function ClipGrid({ project, tracks, clipStates, onLaunch }: {
  project: Project;
  tracks: JamTrack[];
  clipStates: ClipStateMap;
  onLaunch: () => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  // One frame loop drives every playing cell's --progress (direct DOM, no setState).
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const clipByUuid = new Map<string, JamClip>(
      tracks.flatMap(t => t.clips.map(c => [c.uuidString, c])),
    );
    const frame = AnimationFrame.add(() => {
      const position = project.engine.position.getValue();
      grid.querySelectorAll<HTMLElement>(".clip-cell--playing").forEach(el => {
        const clip = clipByUuid.get(el.dataset.clip ?? "");
        if (clip === undefined) return;
        const loopPpqn = clip.bars * PPQN.Bar;
        const progress = ((position % loopPpqn) + loopPpqn) % loopPpqn / loopPpqn;
        el.style.setProperty("--progress", progress.toFixed(4));
      });
    });
    return () => frame.terminate();
  }, [project, tracks]);

  const launchScene = (column: number) => {
    onLaunch();
    project.engine.scheduleClipPlay(
      tracks.map(t => t.clips[column].box.address.uuid),
    );
  };

  const stopAll = () =>
    project.engine.scheduleClipStop(tracks.map(t => t.trackBox.address.uuid));

  return (
    <div className="clip-grid" ref={gridRef}>
      <div className="clip-grid__header">
        <span className="clip-grid__corner" />
        {CLIP_COLUMNS.map((bars, column) => (
          <button key={bars} type="button" onClick={() => launchScene(column)}>
            ▶ Scene {column + 1}
          </button>
        ))}
        <button type="button" onClick={stopAll}>■ Stop clips</button>
      </div>
      {tracks.map(track => (
        <div key={track.name} className="clip-grid__row">
          <span className="clip-grid__name" style={{ color: track.color }}>
            {track.name}
          </span>
          {track.clips.map(clip => (
            <ClipCell
              key={clip.uuidString}
              project={project}
              track={track}
              clip={clip}
              state={clipStates.get(clip.uuidString)}
              onLaunch={onLaunch}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

CSS (goes in the page's `<style>` alongside `CONSOLE_STYLES`): `.clip-cell` relative, `--mc-panel` background, `--mc-line` border; `.clip-cell--waiting` blink via `@keyframes` on border-color (respect `prefers-reduced-motion`: no blink, solid highlight); `.clip-cell--playing` border in the track color; `.clip-cell__progress` absolute bottom strip, `width: calc(var(--progress, 0) * 100%)`, background `currentColor`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/demos/clips/'`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/demos/clips/ClipGrid.tsx
git commit -m "feat(clips): clip launcher grid with scene launch and live progress"
```

---

### Task 7: Arrangement panel (`ArrangementPanel.tsx`)

**Files:**
- Create: `src/demos/clips/ArrangementPanel.tsx`
- Reference (read, don't modify): `src/lib/CanvasPainter.ts` (debounced painter — repaints only on `requestUpdate()`), `src/lib/adapterUtils.ts` (`getAllAudioRegions`), `src/lib/design/consoleTheme.ts` (`CANVAS_COLORS`, `CANVAS_FONT_SMALL`)

**Interfaces:**
- Consumes: `JamTrack` (Task 4), `SECTION_PPQN`/`SECTION_BARS` (Task 1), `drawWaveform`/`computePeaks` (Task 3), `getAllAudioRegions(project)` (returns `AudioRegionBoxAdapter[]`; adapter getters `.position`, `.duration`, `.complete` are ppqn).
- Produces: `ArrangementPanel({ project, tracks }: { project: Project; tracks: JamTrack[] })` — canvas + playhead overlay only; transport buttons stay in the page (Task 8).

Behavior:
- `CanvasPainter` with a render callback that: fills `CANVAS_COLORS.bg`; computes `visibleSections = max(4, ceil(maxRegionEnd / SECTION_PPQN))`; draws bar grid (`gridTertiary`, section boundaries `gridSupporting`, numbered every section in `label`/`CANVAS_FONT_SMALL`); draws one lane per track (row height = canvasHeight / 4) and, for each region on that track, a rounded block: `shade` fill, 1px track-color border, waveform via `drawWaveform` tiled per loop iteration (`loopDuration` slices of the buffer from 0), label text.
- Region discovery per lane: `audioUnitAdapterFor(project, track.audioUnitBox).tracks.values()[0].regions.adapters.values().filter(r => r.isAudioRegion())` — NOT `boxGraph.boxes()`.
- Invalidation: `project.editing.subscribe(() => painter.requestUpdate())` (never `editing.modify` inside it) + initial `requestUpdate()`. Terminate subscription and painter on unmount.
- Playhead: absolutely-positioned 1px div over the canvas; `AnimationFrame.add` writes `style.left` from `project.engine.position.getValue()` mapped through the same x-scale; `display: "none"` when position > visible range (covers the parked-at-bar-1000 jam state). Canvas + overlay both `boxSizing: "border-box"` with matching borders (repo rule: mismatched box models skew the x-mapping).
- Empty state: when no regions, draw centered `label`-color text "Commit a combo to start the arrangement".

- [ ] **Step 1: Write the implementation** (structure below; painter/overlay per the referenced repo patterns)

```tsx
// src/demos/clips/ArrangementPanel.tsx
import React, { useEffect, useRef } from "react";
import { Project } from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { audioUnitAdapterFor } from "@/lib/adapterUtils";
import { CANVAS_COLORS, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";
import { SECTION_PPQN } from "./arrangement";
import type { JamTrack } from "./jamSetup";
import { drawWaveform } from "./waveform";

const HEIGHT = 200;
const LANE_COUNT = 4;

export function ArrangementPanel({ project, tracks }: {
  project: Project;
  tracks: JamTrack[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const regionsOf = (track: JamTrack) => {
      const trackAdapter = audioUnitAdapterFor(project, track.audioUnitBox)
        .tracks.values()[0];
      return trackAdapter.regions.adapters.values().filter(r => r.isAudioRegion());
    };

    const visiblePpqn = () => {
      const ends = tracksRef.current.flatMap(t => regionsOf(t).map(r => r.complete));
      const sections = Math.max(4, Math.ceil(Math.max(0, ...ends) / SECTION_PPQN));
      return sections * SECTION_PPQN;
    };

    const painter = new CanvasPainter(canvas, ({ context, width, height }) => {
      // ...bar grid, lanes, region blocks with tiled drawWaveform, labels,
      // empty-state text — per the behavior list above, CANVAS_COLORS only.
    });

    const editingSub = project.editing.subscribe(() => painter.requestUpdate());
    painter.requestUpdate();

    const frame = AnimationFrame.add(() => {
      const playhead = playheadRef.current;
      if (playhead === null) return;
      const position = project.engine.position.getValue();
      const total = visiblePpqn();
      if (position < 0 || position > total) {
        playhead.style.display = "none";
        return;
      }
      playhead.style.display = "block";
      playhead.style.left = `${(position / total) * canvas.clientWidth}px`;
    });

    return () => {
      frame.terminate();
      editingSub.terminate();
      painter.terminate();
    };
  }, [project]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT, boxSizing: "border-box",
                 border: "1px solid var(--mc-line)" }}
      />
      <div
        ref={playheadRef}
        style={{ position: "absolute", top: 0, bottom: 0, width: 1,
                 background: CANVAS_COLORS.playhead, pointerEvents: "none",
                 display: "none", boxSizing: "border-box",
                 border: "1px solid transparent" }}
      />
    </div>
  );
}
```

Check `CanvasPainter`'s actual constructor/callback signature and painter
teardown method in `src/lib/CanvasPainter.ts` before wiring (`terminate` vs a
returned Terminable) and adjust.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/demos/clips/'`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/demos/clips/ArrangementPanel.tsx
git commit -m "feat(clips): arrangement timeline canvas with playhead overlay"
```

---

### Task 8: Page assembly + HTML entry + vite input

**Files:**
- Create: `src/demos/clips/jam-arrangement-demo.tsx`
- Create: `jam-arrangement-demo.html` (repo root — copy `neon-demo.html` structure: meta/OG/Twitter tags, canonical URL `https://opendaw-test.pages.dev/jam-arrangement-demo.html`, font links with `crossorigin`, GoatCounter script before `</body>`, script src `/src/demos/clips/jam-arrangement-demo.tsx`)
- Modify: `vite.config.ts` — add `jamArrangement: resolve(__dirname, "jam-arrangement-demo.html")` to `rollupOptions.input` (alphabetical-ish near the other demo entries, ~line 149)

**Interfaces:**
- Consumes: everything above plus `initializeOpenDAW` (`{ localAudioBuffers, bpm: 124, onStatusUpdate }`), `JAM_PARK_POSITION`/`nextFreeSectionStart`/`SECTION_PPQN`/`SECTION_BARS` (Task 1), `getAllAudioRegions` from `@/lib/adapterUtils`, `AudioRegionBox`/`ValueEventCollectionBox` from `@opendaw/studio-boxes`.

Page behavior (single component + boot effect, standard demo shape):
- Boot effect (once): `const buffers = new Map<string, AudioBuffer>()` → `initializeOpenDAW({ localAudioBuffers: buffers, bpm: BPM, onStatusUpdate: setStatus })` → `createJamSession(project, audioContext, buffers)` → store `{project, tracks}` in state. Errors → init error card (copy the pattern from an existing demo, e.g. neon-demo's error state).
- `mode: "idle" | "jam" | "arrangement"` React state.
- `enterJam` (passed to `ClipGrid` as `onLaunch`): if mode !== "jam" → `project.engine.setPosition(JAM_PARK_POSITION); setMode("jam")`. (Launch itself auto-starts the transport — engine behavior; no jam Play button.)
- `commit`: for each track, find its clip with state `"playing"`; if none anywhere, no-op (button disabled). Else:

```typescript
const regionEnds = getAllAudioRegions(project).map(r => r.complete);
const start = nextFreeSectionStart(regionEnds);
project.editing.modify(() => {
  active.forEach(({ track, clip }) => {
    const eventsBox = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
    AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
      box.regions.refer(track.trackBox.regions);
      box.file.refer(track.fileBox);
      box.events.refer(eventsBox.owners);
      box.position.setValue(start);            // section boundary — already integer
      box.duration.setValue(SECTION_PPQN);     // region spans the 4-bar section
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(clip.bars * PPQN.Bar); // loops tile the section
      box.label.setValue(`${track.name} · ${clip.bars} bar`);
      box.mute.setValue(false);
    });
  });
});
setLastCommit({ section: start / SECTION_PPQN + 1, bars: `${start / PPQN.Bar + 1}–${start / PPQN.Bar + SECTION_BARS}` });
```

- `playArrangement`: `project.engine.stop()` (resets the clip sequencer — all clips stop) → `project.engine.setPosition(0)` → `project.engine.play()` (facade resumes AudioContext) → `setMode("arrangement")`.
- `stopTransport`: `project.engine.stop(); setMode("idle")`.
- `clearArrangement`: `project.editing.modify(() => getAllAudioRegions(project).forEach(r => r.box.delete()))`.
- Layout top→bottom (Radix `Theme` + `CONSOLE_STYLES` + `GitHubCorner` + `BackLink` + `MoisesLogo`, design language per `docs/design/2026-06-11-mastering-console-editorial.md`, reference `src/demos/warp/warp-overview.tsx`):
  1. Title + intro prose: clips are "what if" (no timeline position, launch-quantized to the next bar, loop until stopped/replaced, take over their track), regions are "when" (positioned, linear). Mention the studio's real "Convert to Region" menu as the production equivalent of Commit.
  2. `ClipGrid` with a caption explaining the waiting-blink = quantized launch and one-clip-per-track handover.
  3. Commit row: Commit button (disabled when nothing playing) + last-commit status line ("Section 2 committed (bars 5–8)").
  4. `ArrangementPanel` + transport row: Play arrangement (disabled with 0 regions), Stop, Clear arrangement.
  5. Explainer footer: the takeover rule ("while a clip plays, its track's regions are silent — other tracks are unaffected"), scene columns, and that launching starts the transport.
- [ ] **Step 1: Write `src/demos/clips/jam-arrangement-demo.tsx`** per the behavior above.
- [ ] **Step 2: Create `jam-arrangement-demo.html`** (copy neon-demo.html; retitle: "OpenDAW Clips vs Regions — Jam to Arrangement"; description: "Jam with launch-quantized audio clips, then commit combos to a timeline arrangement. See how OpenDAW's clip launcher and region timeline differ."; og-image `og-image-jam-arrangement.png` — file lands in Task 10).
- [ ] **Step 3: Add the vite input entry.**
- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/'` (compare to parent baseline — zero new), then `npm run build`.
Expected: build succeeds; `dist/jam-arrangement-demo.html` exists.

- [ ] **Step 5: Smoke-check in dev server**

Reuse a running dev server if one is up (repo rule — don't spawn fresh ones; kill by PID via `lsof -ti :<port>` only if wedged). Otherwise `npm run dev -- --port 5180 --host 127.0.0.1` and browse `https://localhost:5180/jam-arrangement-demo.html`. Expected: page boots to "ready" (grid + empty arrangement visible), no console errors on a fresh load (ignore HMR "Workers are already installed").

- [ ] **Step 6: Commit**

```bash
git add src/demos/clips/jam-arrangement-demo.tsx jam-arrangement-demo.html vite.config.ts
git commit -m "feat(clips): jam-arrangement demo page, HTML entry, vite input"
```

---

### Task 9: Index card, sitemap, category CLAUDE.md

**Files:**
- Modify: `src/index.tsx` — new group appended to `GROUPS`
- Modify: `public/sitemap.xml` — add `https://opendaw-test.pages.dev/jam-arrangement-demo.html` (copy an existing `<url>` block)
- Create: `src/demos/clips/CLAUDE.md`

- [ ] **Step 1: Add the index group/card**

```tsx
{
  label: "Clips & Arrangement",
  color: "var(--mc-violet)",
  demos: [
    {
      href: "/jam-arrangement-demo.html",
      title: "Jam to Arrangement",
      blurb:
        "Jam with a clip launcher — launch-quantized, looping audio clips on four Dark Ride stems — then commit the combos you like to a region timeline and play the arrangement back linearly.",
    },
  ],
},
```

- [ ] **Step 2: Add the sitemap entry.**
- [ ] **Step 3: Write `src/demos/clips/CLAUDE.md`** seeding the verified SDK facts: the minimal audible AudioClipBox recipe (clips/file/duration-PPQN/events, timeBase omitted); engine reads only `loop` of ClipPlaybackFields; quantization rules (bar / playing-clip's duration grid); `scheduleClipPlay` takes CLIP uuids, `scheduleClipStop` takes TRACK uuids; launching starts the transport; transport stop resets the clip sequencer; `subscribeClipNotification` payload shapes ("waiting" is optimistic, "sequencing" is engine-confirmed); one clip per track; clip takeover silences that track's regions only. Plus any gotchas hit during implementation.
- [ ] **Step 4: Verify + commit**

Run: `npm run build` (index page compiles).

```bash
git add src/index.tsx public/sitemap.xml src/demos/clips/CLAUDE.md
git commit -m "feat(clips): index card, sitemap entry, clips category CLAUDE.md"
```

---

### Task 10: Browser verification + og-image

**Files:**
- Create: `public/og-image-jam-arrangement.png` (1200×630 screenshot)
- Possibly modify: any file with a bug found during verification

Protocol (repo conventions — audio is verified by SIGNAL, not UI state):

- [ ] **Step 1: Fresh page load** (no HMR remounts mid-verification; editing paused). Immediately after navigation, inject the `AudioNode.prototype.connect` monkeypatch that tees `AudioDestinationNode` connections through an `AnalyserNode` (repo pattern from CLAUDE.md "Verify in-browser AUDIO demos"), so the engine's connect (seconds later) is captured.
- [ ] **Step 2: Launch verification.** REAL (trusted) click on one clip cell — the transport-starting gesture must be a real click; verify: cell shows `waiting` then flips to `playing` near a bar boundary; RMS over ~2s > threshold (audible). Confirm the playhead overlay is hidden (parked position off-canvas).
- [ ] **Step 3: Layering + handover.** Launch a clip on a second track (both playing → RMS rises / two cells lit). On the first track, click a DIFFERENT cell: old stays `playing` while new blinks `waiting`, swap occurs at the loop boundary, old cell clears. One clip per track holds (never two `playing` cells in a row).
- [ ] **Step 4: Commit + arrangement.** Commit the current combo → arrangement canvas shows blocks in section 1 on exactly the playing tracks. Change the combo, Commit again → section 2. Stop clips. Click Play arrangement → playhead sweeps from bar 0; measure RMS per section (non-zero where blocks exist); after the last section RMS ≈ 0 (empty timeline ahead).
- [ ] **Step 5: Takeover proof.** With the arrangement playing (regions audible), launch a clip on a track that has a region under the playhead: when the clip starts, that track's region content is replaced by the clip loop (audibly/RMS-distinguishable — pick tracks with clearly different loop lengths, e.g. 1-bar vs 4-bar drums); stop clips (transport keeps running) → region playback on that track resumes.
- [ ] **Step 6: Clear arrangement** empties the canvas; Play arrangement is disabled again.
- [ ] **Step 7: Mobile clipping scan.** Per-element `el.scrollWidth > el.clientWidth` at ~390px width (filter known Radix thumb overhang); grid must scroll inside its own container, no document horizontal scroll.
- [ ] **Step 8: Screenshot** the page mid-jam (clips playing + 2 committed sections) at 1200×630 → save as `public/og-image-jam-arrangement.png` (Playwright screenshots: omit `filename`, collect from `.playwright-mcp/`, then copy into `public/`). Confirm the HTML og/twitter tags point at it.
- [ ] **Step 9: Commit**

```bash
git add public/og-image-jam-arrangement.png
git commit -m "feat(clips): og-image for jam-arrangement demo"
```

(If verification uncovered fixes, commit those with their own messages first.)

---

### Task 11: Final checks + PR

- [ ] **Step 1: Full test suite**: `npx vitest run` — all green (ensure no `.claude/worktrees/**` doubling; remove stray worktrees first).
- [ ] **Step 2: tsc baseline diff** (repo recipe): errors filtered to `^src/`, compared with parent-commit baseline via worktree + `comm -13` — zero new errors.
- [ ] **Step 3: `npm run build`** clean.
- [ ] **Step 4: Delete the in-flight docs in this PR** (repo rule — specs/plans are deleted by the PR that completes them; durable knowledge already graduated to `src/demos/clips/CLAUDE.md`):

```bash
git rm docs/superpowers/specs/2026-08-04-clips-vs-regions-jam-arrangement-design.md \
       docs/superpowers/plans/2026-08-04-jam-arrangement-demo.md
git commit -m "docs: remove completed jam-arrangement spec and plan"
```

- [ ] **Step 5: Push + open PR** (`gh pr create`, body ends with the repo's generated-with footer). Title: `feat: Jam to Arrangement demo — clips vs regions`.
- [ ] **Step 6: Run the comprehensive PR review** (`/pr-review-toolkit:review-pr`, applicable aspects) and FIX Critical + Important findings before merge; push fixes and note them in a PR comment (repo rule).

---

## Self-review notes

- Spec coverage: story/UX (Tasks 6–8), verified-SDK-facts propagation (Global Constraints + Task 9 CLAUDE.md), commit mechanics (Task 8), takeover verification (Task 10 Step 5), scaffolding checklist items 1–7 (Tasks 8–10), out-of-scope respected (no gain/reverse/speed UI, no clip recording).
- The spec's seconds-vs-PPQN caveat is resolved in Task 4 by hand-building clips with Musical-timeBase PPQN durations (engine-test-verified recipe) instead of the factory's Seconds path.
- Type consistency: `JamTrack`/`JamClip`/`ClipStateMap`/`nextFreeSectionStart`/`drawWaveform` signatures match across Tasks 1–8.
