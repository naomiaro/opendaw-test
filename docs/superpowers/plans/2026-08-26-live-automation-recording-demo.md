# Live Automation Recording Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a listed demo where dragging sliders while the transport records captures live automation (latch model) onto value regions, with loop overdubs, RDP stats, AutomationSuspension override badges, and a ghost preset comparison.

**Architecture:** DAW-style arrangement panel: three automation lanes (volume / pan / Delay wet) on one shared 8-bar time axis, each with a track-header slider. A pure render-model module feeds per-lane canvases; a content builder assembles the BassDrums30 + Delay project; the page wires transport, write plumbing, stats, and badges.

**Tech Stack:** React + Radix Themes, OpenDAW SDK 0.0.170 (WASM engine), CanvasPainter, vitest for the pure module.

**Spec:** `docs/superpowers/specs/2026-08-26-live-automation-recording-demo-design.md`

## Global Constraints

- Branch: `live-automation-recording-demo` (already created; spec committed).
- `npx tsc --noEmit` must report **zero `^src/` lines** before every commit (node_modules DOM-lib errors are environmental).
- All box-graph changes inside `project.editing.modify()`; slider-drag writes use `project.editing.modify(fn, false)` (verified: `Editing.modify<R>(modifier, mark?: boolean)` — `false` skips the undo mark).
- Option types: never `?.`/`??` — always `.isEmpty()` / `.unwrap()` / `.nonEmpty()`.
- Read SDK internals in `/Users/naomiaro/Code/openDAWOriginal`; confirm installed surface in `node_modules/@opendaw/*/dist/**/*.d.ts` before writing imports. NOTE: the checkout HEAD is newer than installed 0.0.170 — its `RecordAutomation.ts` has an `isTouched` gate the installed dist does NOT have (installed is pure latch).
- Audio start requires a REAL click in browser verification (untrusted `.click()` fine for non-audio buttons). Reuse the running dev server; don't spawn a fresh `npm run dev`.
- Design language: `docs/design/2026-06-11-mastering-console-editorial.md`; reference impl `src/demos/warp/warp-overview.tsx`; canvas colors from `CANVAS_COLORS` (`src/lib/design/consoleTheme.ts`).
- `documentation/*.md` chapter docs: present tense, NO SDK version numbers.
- PRs squash-merge; run `/pr-review-toolkit:review-pr` once the PR is open and fix Critical + Important findings.

## Verified SDK facts (research already done — trust these)

- `project.startRecording(countIn?: boolean): void`, `project.stopRecording(): void` (Project.d.ts). Stop pattern per `src/demos/midi/midi-recording-demo.tsx:275`: `project.engine.stopRecording()` then `project.engine.stop(true)` is safe.
- `RecordAutomation.start` (installed dist): on any parameter write while `engine.isRecording`, resolves the lane via `adapter.optTracks()` — which **falls back to the parameter's audio unit** (`ParameterOwner.audioUnitOf`) — and **auto-creates** a `TrackType.Value` track + `ValueRegionBox` + `ValueEventCollectionBox`. Start position `quantizeFloor(position, PPQN.SemiQuaver)`. Events are region-local; interpolation Linear when `adapter.valueMapping.floating()`, else None. On finalize (stop or loop wrap): duration/loopDuration set (min SemiQuaver, quantizeCeil), a hold event appended at the end, then an inline RDP-style simplifier (Epsilon 0.01, linear-only) deletes redundant events. Loop wrap creates a fresh region at `quantizeFloor(loopFrom, SemiQuaver)`.
- Automation recording toggle: `project.engine.preferences.settings.recording.automationEnabled` (default true).
- `ParameterFieldAdapters` (studio-adapters): `get(address)`, `opt(address)`, `setMode(address, AutomationMode)`, `getMode(address)`, `subscribeWrites(observer: Observer<ParameterWriteEvent>)` where `ParameterWriteEvent = { adapter: AutomatableParameterFieldAdapter; previousUnitValue: unitValue }`. `AutomationMode = "read" | "touch" | "latch"`. The engine never calls `getMode()`.
- `AutomatableParameterFieldAdapter<number>`: `setUnitValue(v)`, `getUnitValue()`, `getControlledUnitValue()` (automation+modulation-aware — poll this for fader-follows-curve), `getPrintValue()/getControlledPrintValue(): StringResult`, `.address`, `.track: Option<TrackBoxAdapter>` (the parameter's value lane, present once one exists), `.valueMapping`.
- Named parameter adapters: `audioUnitAdapter.namedParameter.volume` / `.panning`; `DelayDeviceBoxAdapter.namedParameter.wet`. Get the delay adapter via `project.boxAdapters.adapterFor(delayBox, DelayDeviceBoxAdapter)`.
- `EffectFactories.Delay` exists (studio-core). Insert pattern: resolve `audioEffectsFieldOf(project, audioUnitBox)` (from `@/lib/adapterUtils`) OUTSIDE the transaction, then `project.api.insertEffect(field, EffectFactories.Delay)` inside `editing.modify` — see `src/demos/automation/track-automation-demo.tsx:356`.
- Loop: `project.timelineBox.loopArea` → `.enabled: BooleanField`, `.from: Int32Field`, `.to: Int32Field` (ppqn).
- `AutomationSuspension` (studio-core, auto-started per Project): on any write while `engine.isPlaying`, suspends the parameter's lane (`adapter.track` uuid) in the engine; suspensions drop on pause/stop/stopRecording; the rule's local `suspended` set clears when `isPlaying` flips false. **No public observable** — the demo infers badge state locally.
- Curve segments render via `Curve.normalizedAt(t, slope)` (`@opendaw/lib-std`) — see `src/demos/automation/AutomationCanvas.tsx:137-145` for the sampling idiom, and its step/linear handling directly above.
- Content-builder pattern (Tape + AudioFileBox + AudioRegionBox, −6 dB headroom, `localAudioBuffers` map, re-route/insert in a SEPARATE transaction after `createInstrument` commits): `src/demos/effects/convolverContent.ts:167-245`; page boot pattern: `src/demos/effects/convolver-demo.tsx:170-196` (`initializeOpenDAW({ localAudioBuffers, bpm, onStatusUpdate })`).
- Lane color trio precedent (`trackAutomationPresets.ts`): volume `CANVAS_COLORS.amber`, pan `CANVAS_COLORS.cyan`, effect `CANVAS_COLORS.green`.

---

### Task 1: Pure lane render model (`laneRenderModel.ts`) — TDD

**Files:**
- Create: `src/demos/automation/laneRenderModel.ts`
- Test: `src/demos/automation/laneRenderModel.test.ts`

**Interfaces:**
- Consumes: `Interpolation` (`@opendaw/lib-dsp`), `Curve` (`@opendaw/lib-std`) — nothing from other tasks.
- Produces (used by Tasks 3–4):
  - `DEMO_BPM = 122`, `BAR = PPQN.fromSignature(4, 4)`, `LOOP_PPQN = 4 * BAR`, `WINDOW_PPQN = 8 * BAR`
  - `type LanePoint = { x: number; y: number }` — both normalized 0..1; `y` is unitValue (0 = bottom)
  - `type LaneEventModel = { position: number; value: number; interpolation: Interpolation }` (position region-local ppqn)
  - `type LaneRegionModel = { start: number; duration: number; events: LaneEventModel[] }` (start absolute ppqn)
  - `buildRegionRender(region: LaneRegionModel, windowPpqn: number): RegionRender` where `type RegionRender = { x0: number; x1: number; path: LanePoint[] }`
  - `presetGhost(events: LaneEventModel[], windowPpqn: number): LanePoint[]` (events at absolute positions, e.g. from `trackAutomationPresets`)

- [ ] **Step 1: Write the failing test**

```typescript
// src/demos/automation/laneRenderModel.test.ts
import { describe, expect, it } from "vitest";
import { Interpolation } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { BAR, buildRegionRender, presetGhost, WINDOW_PPQN } from "./laneRenderModel";

describe("buildRegionRender", () => {
  it("normalizes region bounds to the window", () => {
    const r = buildRegionRender({ start: BAR, duration: BAR, events: [] }, WINDOW_PPQN);
    expect(r.x0).toBeCloseTo(1 / 8);
    expect(r.x1).toBeCloseTo(2 / 8);
    expect(r.path).toEqual([]);
  });

  it("renders a step (interpolation none) as horizontal-then-vertical", () => {
    const r = buildRegionRender({
      start: 0, duration: BAR,
      events: [
        { position: 0, value: 0.2, interpolation: Interpolation.None },
        { position: BAR / 2, value: 0.8, interpolation: Interpolation.None },
      ],
    }, WINDOW_PPQN);
    // start point, corner at next event x with previous y, jump up, hold to region end
    expect(r.path).toEqual([
      { x: 0, y: 0.2 },
      { x: 1 / 16, y: 0.2 },
      { x: 1 / 16, y: 0.8 },
      { x: 1 / 8, y: 0.8 },
    ]);
  });

  it("renders linear interpolation as a straight segment and holds the last value", () => {
    const r = buildRegionRender({
      start: 0, duration: BAR,
      events: [
        { position: 0, value: 0, interpolation: Interpolation.Linear },
        { position: BAR / 2, value: 1, interpolation: Interpolation.Linear },
      ],
    }, WINDOW_PPQN);
    expect(r.path[0]).toEqual({ x: 0, y: 0 });
    expect(r.path[1]).toEqual({ x: 1 / 16, y: 1 });
    // hold from last event to region end
    expect(r.path[r.path.length - 1]).toEqual({ x: 1 / 8, y: 1 });
  });

  it("samples curve interpolation through Curve.normalizedAt", () => {
    const slope = 0.25;
    const r = buildRegionRender({
      start: 0, duration: BAR,
      events: [
        { position: 0, value: 0, interpolation: Interpolation.Curve(slope) },
        { position: BAR, value: 1, interpolation: Interpolation.None },
      ],
    }, WINDOW_PPQN);
    // 24 samples per curve segment: midpoint sample matches the SDK curve
    const mid = r.path.find(p => Math.abs(p.x - 1 / 16) < 1e-9)!;
    expect(mid.y).toBeCloseTo(Curve.normalizedAt(0.5, slope));
  });
});

describe("presetGhost", () => {
  it("maps absolute-position events to normalized points", () => {
    const pts = presetGhost([
      { position: 0, value: 0, interpolation: Interpolation.Linear },
      { position: 4 * BAR, value: 1, interpolation: Interpolation.None },
    ], WINDOW_PPQN);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 0.5, y: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/demos/automation/laneRenderModel.test.ts`
Expected: FAIL — module `./laneRenderModel` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/demos/automation/laneRenderModel.ts
import { Curve } from "@opendaw/lib-std";
import { Interpolation, PPQN } from "@opendaw/lib-dsp";

export const DEMO_BPM = 122;
export const BAR = PPQN.fromSignature(4, 4); // 3840
export const LOOP_PPQN = 4 * BAR;
export const WINDOW_PPQN = 8 * BAR;

export type LanePoint = { x: number; y: number };
export type LaneEventModel = { position: number; value: number; interpolation: Interpolation };
export type LaneRegionModel = { start: number; duration: number; events: LaneEventModel[] };
export type RegionRender = { x0: number; x1: number; path: LanePoint[] };

const CURVE_SAMPLES = 24;

/** Append the path for one segment [a → b] (positions already normalized to x). */
function appendSegment(path: LanePoint[], a: LanePoint & { interpolation: Interpolation },
                       b: LanePoint): void {
  if (a.interpolation.type === "none") {
    path.push({ x: b.x, y: a.y }, { x: b.x, y: b.y });
  } else if (a.interpolation.type === "linear") {
    path.push({ x: b.x, y: b.y });
  } else {
    const slope = a.interpolation.slope;
    for (let s = 1; s <= CURVE_SAMPLES; s++) {
      const t = s / CURVE_SAMPLES;
      const y = a.y + Curve.normalizedAt(t, slope) * (b.y - a.y);
      path.push({ x: a.x + (b.x - a.x) * t, y });
    }
  }
}

/** Events at ABSOLUTE ppqn positions → normalized polyline (no hold extension). */
function eventsToPath(events: ReadonlyArray<{ position: number; value: number; interpolation: Interpolation }>,
                      windowPpqn: number): LanePoint[] {
  const path: LanePoint[] = [];
  events.forEach((evt, i) => {
    const pt = { x: evt.position / windowPpqn, y: evt.value };
    if (i === 0) {
      path.push(pt);
    } else {
      const prev = events[i - 1];
      appendSegment(path, { x: prev.position / windowPpqn, y: prev.value, interpolation: prev.interpolation }, pt);
    }
  });
  return path;
}

/** One recorded value region → outline bounds + polyline, with the last value held to region end. */
export function buildRegionRender(region: LaneRegionModel, windowPpqn: number): RegionRender {
  const x0 = region.start / windowPpqn;
  const x1 = (region.start + region.duration) / windowPpqn;
  const absolute = region.events.map(evt => ({ ...evt, position: region.start + evt.position }));
  const path = eventsToPath(absolute, windowPpqn);
  if (path.length > 0) {
    const last = path[path.length - 1];
    if (last.x < x1) path.push({ x: x1, y: last.y });
  }
  return { x0, x1, path };
}

/** Preset events (absolute positions, e.g. trackAutomationPresets shapes) → dashed ghost polyline. */
export function presetGhost(events: LaneEventModel[], windowPpqn: number): LanePoint[] {
  return eventsToPath(events, windowPpqn);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/demos/automation/laneRenderModel.test.ts`
Expected: PASS (5 tests). If the step-shape assertion fails on exact point layout, fix the TEST expectation only if the drawn shape is still a correct step (horizontal to next x, then vertical) — the invariant is the shape, not the point count.

- [ ] **Step 5: tsc gate + commit**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || true` → expect no output.
```bash
git add src/demos/automation/laneRenderModel.ts src/demos/automation/laneRenderModel.test.ts
git commit -m "feat: pure render model for live automation lanes"
```

---

### Task 2: Content builder (`liveAutomationContent.ts`)

**Files:**
- Create: `src/demos/automation/liveAutomationContent.ts`

**Interfaces:**
- Consumes: `DEMO_BPM`, `BAR`, `LOOP_PPQN` from Task 1; `audioEffectsFieldOf` from `@/lib/adapterUtils`; `loadAudioFile` from `@/lib/audioUtils` (verify export name — convolverContent.ts imports it; copy its import line).
- Produces (used by Task 4):
  - `type LaneId = "volume" | "pan" | "wet"`
  - `type LaneSpec = { id: LaneId; label: string; color: string; adapter: AutomatableParameterFieldAdapter<number> }`
  - `type LiveAutomationSetup = { audioUnitBox: AudioUnitBox; delayBox: DelayDeviceBox; lanes: ReadonlyArray<LaneSpec> }`
  - `buildLiveAutomationContent(project: Project, audioContext: AudioContext, audioBuffers: Map<string, AudioBuffer>, onStatus?: (s: string) => void): Promise<LiveAutomationSetup>`

- [ ] **Step 1: Write the module**

Mirror `src/demos/effects/convolverContent.ts:167-245` (read it first). Structure:

```typescript
// src/demos/automation/liveAutomationContent.ts
import { UUID } from "@opendaw/lib-std";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, DelayDeviceBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { DelayDeviceBoxAdapter, type AutomatableParameterFieldAdapter } from "@opendaw/studio-adapters";
import { EffectFactories, InstrumentFactories, type Project } from "@opendaw/studio-core";
import { audioEffectsFieldOf, audioUnitAdapterFor } from "@/lib/adapterUtils";
import { loadAudioFile } from "@/lib/audioUtils";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { LOOP_PPQN } from "./laneRenderModel";

const DRUM_FILE = "/audio/BassDrums30.mp3";

export type LaneId = "volume" | "pan" | "wet";
export type LaneSpec = { id: LaneId; label: string; color: string; adapter: AutomatableParameterFieldAdapter<number> };
export type LiveAutomationSetup = {
  audioUnitBox: AudioUnitBox;
  delayBox: DelayDeviceBox;
  lanes: ReadonlyArray<LaneSpec>;
};

export async function buildLiveAutomationContent(
  project: Project,
  audioContext: AudioContext,
  audioBuffers: Map<string, AudioBuffer>,
  onStatus?: (status: string) => void,
): Promise<LiveAutomationSetup> {
  const { boxGraph } = project;

  onStatus?.("Loading drum loop...");
  const drumBuffer = await loadAudioFile(audioContext, DRUM_FILE);
  const drumUUID = UUID.generate();
  audioBuffers.set(UUID.toString(drumUUID), drumBuffer);

  onStatus?.("Building project...");
  // Transaction 1: instrument + region. −6 dB headroom (Delay wet sums on top).
  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    const tape = project.api.createInstrument(InstrumentFactories.Tape);
    audioUnitBox = tape.audioUnitBox;
    tape.audioUnitBox.volume.setValue(-6);
    const fileBox = AudioFileBox.create(boxGraph, drumUUID, box => {
      box.fileName.setValue("BassDrums30");
      box.endInSeconds.setValue(drumBuffer.duration);
    });
    const eventsBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());
    AudioRegionBox.create(boxGraph, UUID.generate(), box => {
      box.regions.refer(tape.trackBox.regions);
      box.file.refer(fileBox);
      box.events.refer(eventsBox.owners);
      box.position.setValue(0);
      box.duration.setValue(LOOP_PPQN);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(LOOP_PPQN);
      box.label.setValue("Drums");
    });
  });
  const unitBox = audioUnitBox!;

  // Transaction 2: insert the Delay (field resolved OUTSIDE, after tx 1 committed).
  const effectsField = audioEffectsFieldOf(project, unitBox);
  let delayBox: DelayDeviceBox | null = null;
  project.editing.modify(() => {
    delayBox = project.api.insertEffect(effectsField, EffectFactories.Delay) as DelayDeviceBox;
  });

  // Subject of the demo — explicit even though it defaults to true.
  project.engine.preferences.settings.recording.automationEnabled = true;

  // Adapters resolved AFTER commits (same-transaction traversal is stale).
  const unitAdapter = audioUnitAdapterFor(project, unitBox);
  const delayAdapter = project.boxAdapters.adapterFor(delayBox!, DelayDeviceBoxAdapter);
  const lanes: LaneSpec[] = [
    { id: "volume", label: "Volume", color: CANVAS_COLORS.amber, adapter: unitAdapter.namedParameter.volume },
    { id: "pan", label: "Pan", color: CANVAS_COLORS.cyan, adapter: unitAdapter.namedParameter.panning },
    { id: "wet", label: "Delay Wet", color: CANVAS_COLORS.green, adapter: delayAdapter.namedParameter.wet },
  ];
  return { audioUnitBox: unitBox, delayBox: delayBox!, lanes };
}
```

Check `audioEffectsFieldOf`'s return in `src/lib/adapterUtils.ts` before use — if it returns `Option<Field>`, unwrap per its doc comment (the repo convention is it hands back what `insertEffect` takes; copy the call shape from `track-automation-demo.tsx:350-360`).

- [ ] **Step 2: tsc gate**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || true` → expect no output. Fix any signature drift by reading the named reference files, not by casting.

- [ ] **Step 3: Commit**

```bash
git add src/demos/automation/liveAutomationContent.ts
git commit -m "feat: live automation demo content builder (BassDrums30 + Delay)"
```

---

### Task 3: Lane component (`LiveAutomationLane.tsx`)

**Files:**
- Create: `src/demos/automation/LiveAutomationLane.tsx`

**Interfaces:**
- Consumes: `LaneSpec` (Task 2); `buildRegionRender`, `presetGhost`, `WINDOW_PPQN`, `LanePoint` (Task 1); `CanvasPainter` (`@/lib/CanvasPainter`); `CANVAS_COLORS`.
- Produces (used by Task 4):

```typescript
export interface LiveAutomationLaneProps {
  project: Project;
  spec: LaneSpec;
  /** unitValue 0..1 shown on the slider (page owns the state) */
  sliderValue: number;
  onSliderChange: (unitValue: number) => void;   // fires per gesture sample
  overridden: boolean;                            // AutomationSuspension badge
  recording: boolean;                             // gates REC badge + live repaint loop
  stats: { captured: number; kept: number };      // RDP readout
  ghost: LanePoint[] | null;                      // dashed preset overlay, null = off
}
export const LiveAutomationLane: React.FC<LiveAutomationLaneProps>
```

- [ ] **Step 1: Write the component**

Layout: one flex row — header (~180px: label, Radix `Slider` [min 0, max 1, step 0.001, value `[sliderValue]`], printed value via `spec.adapter.getPrintValue().value` — `StringResult`, check its fields in `node_modules/@opendaw/lib-std/dist` before use — and badges `REC` (red, when `recording && stats.captured > 0`) / `OVERRIDE` (amber, when `overridden`)) + canvas (flex 1, height 110px).

Canvas paint callback (CanvasPainter):
1. Background `CANVAS_COLORS.bg`; bar grid lines every `BAR` (8 bars, `CANVAS_COLORS.gridTertiary`, loop boundary at bar 4 in `gridSupporting`).
2. Lane data: read `spec.adapter.track` (`Option<TrackBoxAdapter>`); if `nonEmpty()`, iterate `track.regions.adapters.values()`, keep `r.isValueRegion()`, and for each build `LaneRegionModel`: `start = r.position`, `duration = r.duration`, events from the region's event collection (`r.events.asArray()` on `ValueRegionBoxAdapter` — verify the exact getter in `node_modules/@opendaw/studio-adapters/dist/timeline/region/ValueRegionBoxAdapter.d.ts`; the automation CLAUDE.md documents `optCollection` → `events.asArray()`), each event contributing `{ position, value, interpolation }`. Then `buildRegionRender(model, WINDOW_PPQN)` → draw region outline (translucent fill `spec.color` at ~12% + 1px border) and the path (2px `spec.color`), dimmed to 35% alpha when `overridden`.
3. Ghost: if `ghost` present, dashed 1.5px `CANVAS_COLORS.structural` polyline (`ctx.setLineDash([4, 4])`, reset after).

Repaint wiring inside a `useEffect` (deps: `[project, spec]` — spec is stable from setup):
- `const editingSub = project.editing.subscribe(() => painter.requestUpdate())`
- An `AnimationFrame.add(() => { if (recordingRef.current) painter.requestUpdate(); })` loop — `recording` mirrored into a ref so the effect never re-runs per state change.
- Cleanup terminates both plus the painter.
- `overridden`/`ghost` changes trigger `painter.requestUpdate()` via a small separate effect.

Per the CLAUDE.md canvas rules: painter created once; frequently-changing props read from refs inside the paint callback.

- [ ] **Step 2: tsc gate + commit**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || true` → expect no output.
```bash
git add src/demos/automation/LiveAutomationLane.tsx
git commit -m "feat: automation lane component with live canvas + ghost overlay"
```

---

### Task 4: Demo page (`live-automation-recording-demo.tsx`)

**Files:**
- Create: `src/demos/automation/live-automation-recording-demo.tsx`

**Interfaces:**
- Consumes: everything above; `initializeOpenDAW` (`@/lib/projectSetup`); page chrome `GitHubCorner`, `MoisesLogo`, `BackLink` (`@/components/...`); Radix `Theme` etc. — copy the scaffold shape from `src/demos/instruments/cubed-demo.tsx`'s top and bottom (imports, `createRoot`, error card on init failure).
- Produces: the mounted page; no downstream consumers.

- [ ] **Step 1: Boot + state skeleton**

Copy the convolver boot pattern (`src/demos/effects/convolver-demo.tsx:170-196`): `initializeOpenDAW({ localAudioBuffers, bpm: DEMO_BPM, onStatusUpdate: setStatus })` → `buildLiveAutomationContent(...)` → `setSetup`, with `disposed` guard and `bootProject?.terminate()` on error.

Page state: `project`, `setup`, `status`, `isPlaying`, `isRecording`, `loopEnabled`, `mode: AutomationMode` (default `"latch"`), per-lane: `sliderValues: Record<LaneId, number>`, `overridden: Record<LaneId, boolean>`, `stats: Record<LaneId, {captured, kept}>`, `ghosts: Record<LaneId, LanePoint[] | null>`.

- [ ] **Step 2: Transport + engine subscriptions**

- Record button: `project.startRecording(false)` (no count-in). Play: `project.engine.play()` (facade already resumes AudioContext). Stop: `project.engine.stopRecording(); project.engine.stop(true);` (pattern from `midi-recording-demo.tsx:275-280`).
- `engine.isPlaying` / `engine.isRecording`: `catchupAndSubscribe(obs => set...(obs.getValue()))`, terminated on cleanup.
- On `isRecording` rising edge: reset `stats` captured counts to 0. On `isPlaying` OR `isRecording` falling edge: clear all `overridden` flags (engine drops suspensions on pause/stop/stopRecording).

- [ ] **Step 3: Write plumbing + suspension inference + stats**

```typescript
// one subscription for captured-counts; adapters compared by reference
useEffect(() => {
  if (!project || !setup) return;
  const sub = project.parameterFieldAdapters.subscribeWrites(({ adapter }) => {
    const lane = setup.lanes.find(l => l.adapter === adapter);
    if (!lane) return;
    if (project.engine.isRecording.getValue()) {
      setStats(prev => ({ ...prev, [lane.id]: { ...prev[lane.id], captured: prev[lane.id].captured + 1 } }));
    } else if (project.engine.isPlaying.getValue() && lane.adapter.track.nonEmpty()) {
      setOverridden(prev => prev[lane.id] ? prev : { ...prev, [lane.id]: true });
    }
  });
  return () => sub.terminate();
}, [project, setup]);
```

Slider write handler (per lane): set `gestureRef.current[id] = true` for the duration of the callback, `project.editing.modify(() => lane.adapter.setUnitValue(v), false)` (no undo mark), update `sliderValues`, clear the flag.

Kept-count: recompute on every `project.editing.subscribe` tick (single subscription): for each lane with `adapter.track.nonEmpty()`, sum event counts across its value regions; `setStats` only when a count changed (fingerprint compare — avoid per-write re-render storms by comparing the numbers before calling setState).

- [ ] **Step 4: Fader-follows-curve + playhead**

One `AnimationFrame.add` loop:
- While `isPlaying`, for each lane whose gesture flag is false: `const v = lane.adapter.getControlledUnitValue(); ` update `sliderValues` only if `Math.abs(v - current) > 0.001`.
- Playhead: absolutely-positioned 1px div spanning the lane stack; `style.left = (engine.position.getValue() / WINDOW_PPQN * 100) + "%"`, hidden past the window — direct DOM via ref, no setState (CLAUDE.md overlay rules; parent `position: relative`, overlay `pointer-events: none`).

- [ ] **Step 5: Loop toggle, mode selector, ghost pickers, copy**

- Loop toggle (Radix `Switch`): `project.editing.modify(() => { const la = project.timelineBox.loopArea; la.from.setValue(0); la.to.setValue(LOOP_PPQN); la.enabled.setValue(next); })`.
- Mode (`SegmentedControl`, read/touch/latch): on change, `setup.lanes.forEach(l => project.parameterFieldAdapters.setMode(l.adapter.address, mode))` (plain call, NOT inside `editing.modify` — it's registry state, not box graph). `Callout` beside it: "The engine never reads the stored mode yet — recording always behaves latch-like: the first write opens a take, only transport stop or a loop wrap closes it."
- Ghost picker per lane (`Select`: None / Fade In / Fade Out / Swell): import the preset shapes from `./trackAutomationPresets` (`volumePresets`-style configs are exported via `AutomationTrackConfig`; check its exports and reuse the volume presets' event lists for all lanes — they're normalized unitValue shapes over 8 bars, which matches `WINDOW_PPQN`), convert with `presetGhost(events, WINDOW_PPQN)`.
- Page copy (mastering-console editorial tone): hero explaining the latch model; a "how it works" strip (write → RecordAutomation → region → simplifier); per-lane RDP stat line `"{captured} writes captured → {kept} events kept (simplifier ε = 0.01)"`; AutomationSuspension explainer near the OVERRIDE badge legend.

- [ ] **Step 6: tsc gate + commit**

Run: `npx tsc --noEmit 2>&1 | grep '^src/' || true` → expect no output (watch TS6133: every `useState` you added must be READ somewhere).
```bash
git add src/demos/automation/live-automation-recording-demo.tsx
git commit -m "feat: live automation recording demo page"
```

---

### Task 5: Wiring — HTML entry, vite input, index card, sitemap, README

**Files:**
- Create: `live-automation-recording-demo.html`
- Modify: `vite.config.ts` (rollupOptions.input map), `src/index.tsx` (Automation category card list), `public/sitemap.xml`, `README.md` (demo table + source-tree listing)

**Interfaces:**
- Consumes: the page module path `/src/demos/automation/live-automation-recording-demo.tsx`.
- Produces: `https://<host>/live-automation-recording-demo.html` served in dev and built to `dist/`.

- [ ] **Step 1: HTML entry**

Copy `cubed-demo.html` verbatim, then replace: `<title>`/`meta title`/`og:title`/`twitter:title` → `OpenDAW Live Automation Recording Demo - Record Fader Moves as Automation in the Browser`; description (all 3 tags) → `Drag faders while the transport records and watch OpenDAW capture your moves as automation regions - latch-model recording, loop overdubs, RDP curve simplification and manual override during playback.`; keywords → `OpenDAW, automation recording, latch automation, DAW automation, web audio, value regions, browser DAW`; canonical/og:url → `https://opendaw-test.pages.dev/live-automation-recording-demo.html`; og:image/twitter:image → `https://opendaw-test.pages.dev/og-image-live-automation-recording.png`; script src → `/src/demos/automation/live-automation-recording-demo.tsx`. Keep the GoatCounter script, font links (with `crossorigin`), and body style.

- [ ] **Step 2: vite input + index card + sitemap + README**

- `vite.config.ts`: add `liveAutomationRecording: resolve(__dirname, "live-automation-recording-demo.html"),` next to `trackAutomation` (line ~148).
- `src/index.tsx`: in the Automation category's `demos` array, add
  `{ href: "/live-automation-recording-demo.html", title: "Live Automation Recording", blurb: "Perform volume, pan and delay-wet moves while the transport records — the SDK's latch model captures every write into value regions, simplifies the curve, and lets you overdub across loop wraps or override playback by hand." }`.
- `public/sitemap.xml`: add a `<url>` entry mirroring an existing demo entry with the new path.
- `README.md`: add a row to the demo table and an entry to the source-tree listing (match surrounding format).

- [ ] **Step 3: Build + dev smoke**

Run: `npm run build` → succeeds; `npx tsc --noEmit 2>&1 | grep '^src/' || true` → empty.
On the RUNNING dev server (find its port via `lsof -iTCP -sTCP:LISTEN | grep -i node` or ask; do not spawn a new one), load `https://localhost:<port>/live-automation-recording-demo.html` in the browser tooling: page renders, status reaches "Ready", zero console errors on a fresh load.

- [ ] **Step 4: Commit**

```bash
git add live-automation-recording-demo.html vite.config.ts src/index.tsx public/sitemap.xml README.md
git commit -m "feat: wire live automation recording demo into build, index, sitemap, README"
```

---

### Task 6: Browser verification (behavioral)

**Files:** none created (fix commits as needed, message prefix `fix:`)

**Interfaces:** consumes the deployed dev page; produces a verified demo + any fixes.

Use claude-in-chrome or Playwright MCP against the running dev server (HTTPS). All checks per repo rules: real click for Record/Play; coordinate clicks after a screenshot; `document.body.innerText.includes(...)` for text asserts; pull `project` from the React fiber for box-graph asserts; check `document.visibilityState` FIRST if the transport seems frozen.

- [ ] **Step 1: Core latch recording** — real-click Record; drive the Volume slider (click it, send `End`, then `Home` — the Radix keyboard path); after ~4 s click Stop. Assert via fiber: the volume adapter's `track` is `nonEmpty()`, ≥1 value region exists, region event count ≥ 2, and the page's stat line shows captured > kept ≥ 2.
- [ ] **Step 2: Multi-lane pass** — record again, gesture all three sliders; assert three lanes show regions (three value tracks on the audio unit).
- [ ] **Step 3: Loop overdub** — enable Loop, record through ≥1 wrap (≥ ~8.2 s at 122 BPM for 4 bars), gesture during both passes; assert ≥2 regions on the gestured lane.
- [ ] **Step 4: Playback + override** — Play (real click); confirm sliders move on their own (read two spaced `getControlledUnitValue()` samples via fiber, expect change); gesture Pan mid-playback → OVERRIDE badge appears (innerText); Stop → badge clears.
- [ ] **Step 5: Audio present** — analyser RMS tap on the destination (repo recipe: monkeypatch `AudioNode.prototype.connect` immediately after navigation, or the liveStreamReceiver-swap recovery path from CLAUDE.md) — RMS over ~2 s of playback must be > 0.01.
- [ ] **Step 6: Mode selector + callout render** — switch to "touch", confirm no behavioral claim is made by the UI beyond the callout (visual check), and `parameterFieldAdapters.getMode(volumeAddress)` returns `"touch"` via fiber.
- [ ] **Step 7: Commit any fixes** — each with tsc gate; note findings for Task 7's CLAUDE.md capture.

---

### Task 7: OG image, docs, knowledge capture, PR

**Files:**
- Create: `public/og-image-live-automation-recording.png` (1200×630 screenshot of the page with recorded lanes visible)
- Modify: `documentation/09-editing-fades-and-automation.md`, `src/demos/automation/CLAUDE.md`, README if anything shifted
- Delete: `docs/superpowers/specs/2026-08-26-live-automation-recording-demo-design.md`, `docs/superpowers/plans/2026-08-26-live-automation-recording-demo.md` (this PR completes them; git history preserves)

- [ ] **Step 1: OG image** — set the browser window to 1200×630, stage the page with recorded curves on all three lanes, screenshot, save to `public/og-image-live-automation-recording.png` (the HTML tags from Task 5 already reference it).
- [ ] **Step 2: Chapter 09** — replace the "Standalone Demo (Future)" subsection (line ~1342) with a short "Demo" subsection pointing at `src/demos/automation/live-automation-recording-demo.tsx` and what it shows (live capture, overdubs, RDP readout, suspension). Present tense; grep the edited file for `0\.0\.[0-9]` before committing — zero matches allowed.
- [ ] **Step 3: `src/demos/automation/CLAUDE.md`** — add a "Live Automation Recording" section with what implementation verified: lane auto-creation via `optTracks()` audio-unit fallback, `editing.modify(fn, false)` for gesture writes, `subscribeWrites` payload, suspension inference (no public observable), loop-wrap region splitting, kept-count recomputation pattern. Only include facts verified against the installed SDK during Tasks 2–6.
- [ ] **Step 4: Delete spec + plan, commit**

```bash
git rm docs/superpowers/specs/2026-08-26-live-automation-recording-demo-design.md docs/superpowers/plans/2026-08-26-live-automation-recording-demo.md
git add public/og-image-live-automation-recording.png documentation/09-editing-fades-and-automation.md src/demos/automation/CLAUDE.md
git commit -m "docs: chapter 09 + automation CLAUDE.md for live automation recording demo"
```

- [ ] **Step 5: PR + review** — push, `gh pr create` (body: what it demonstrates, verification evidence, 🤖 footer per repo rules). Then run `/pr-review-toolkit:review-pr` applicable aspects; fix Critical + Important findings on the branch and note them in a PR comment. Merge is the user's call (`gh pr merge <n> --squash`).
