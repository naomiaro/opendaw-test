# MIDI Effects Demo (stock devices) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A listed demo page where a two-bar note pattern loops on a Vaporisateur and the visitor hears and sees each stock MIDI effect (Arpeggio, Pitch, Velocity, Zeitgeist) one at a time, then stacks and reorders them.

**Architecture:** Shared libraries under `src/lib/midiEffects/` hold the patterns, the device registry, the chain operations and the page's state reducer, all tested in Node against a real box graph. A `NoteLane` canvas component draws the written notes and, from the engine's per-frame held-note set, the emitted notes. The page composes them with a dnd-kit sortable stack. This is PR 1 of two; the Spielwerk page (plan `2026-11-03-spielwerk-demo.md`) builds on it.

**Tech Stack:** React 19, Radix Themes, `@dnd-kit/core` + `@dnd-kit/sortable` (new), OpenDAW SDK 0.0.180 (`EffectFactories`, `IndexedBox.moveIndices`, `NoteStreamReceiver`), vitest (Node, jsdom for the component).

**Spec:** `docs/superpowers/specs/2026-11-03-midi-effects-demos-design.md`

## Global Constraints

- Every box-graph write inside `project.editing.modify()`; a follow-up write that must fold into the same undo step uses `project.editing.append()`.
- The effects field is resolved OUTSIDE the transaction through `midiEffectsFieldOf(project, audioUnitBox)` (`src/lib/adapterUtils.ts`).
- Option values: `.isEmpty()` / `.unwrap()`, never `?.` or `??`.
- Every `Terminable` from a subscription is terminated in the effect cleanup.
- No `setState` per animation frame: overlays write the DOM directly; canvases repaint through `CanvasPainter.requestUpdate()`.
- Patterns are two bars at 120 bpm; `BAR = PPQN.fromSignature(4, 4)` = 3840; loop from 0 to `2 * BAR`.
- Each device at most once in the stack; Spielwerk is not on this page.
- Every chain change while the transport plays re-seeks to position 0.
- `npm run typecheck` exits 0 before every commit; `npm test` green.
- After the dependency add: `rm -rf node_modules package-lock.json && npm install`, then `npm ci` must succeed.
- The branch is `feat/midi-effects-demos` (the design is already committed on it). Commit AND push after each task (private repo rule).

## Review Focus

- Switching tabs fast while playing: two chain changes in one frame must leave exactly one device on the chain (pinned by the reducer test in Task 5 and the reconcile test in Task 4).
- A loop wrap mid-bar: the emitted lane must clear and not carry a bar from the previous pass (Task 6 test "wrap clears open bars").
- A held note that is still on when the transport stops: the lane must close it (Task 6 test "reset closes everything").
- Arpeggio with 5 octaves on the `bass` pattern reaches pitches above the lane's range: the lane must mark, not draw off-canvas (Task 7 test "out-of-range note marked").
- Removing the last chip while playing returns to Dry with an empty chain and the tab on Dry (Task 5 test "removing the last chip returns to single/dry").

---

### Task 1: Dependencies and the pattern library

**Files:**
- Modify: `package.json` (dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- Create: `src/lib/midiEffects/patterns.ts`
- Test: `src/lib/midiEffects/patterns.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PATTERN_BPM = 120;
  export const BAR_PPQN: number;            // PPQN.fromSignature(4, 4)
  export const PATTERN_PPQN: number;        // 2 * BAR_PPQN
  export type PatternId = "chords" | "sixteenths" | "melody" | "bass";
  export interface PatternNote { position: number; duration: number; pitch: number; velocity: number }
  export interface Pattern { id: PatternId; label: string; blurb: string; notes: readonly PatternNote[] }
  export const PATTERNS: readonly Pattern[];           // in the order chords, sixteenths, melody, bass
  export function patternById(id: PatternId): Pattern;
  export function writePattern(project: Pick<Project, "editing" | "api">, regionBox: NoteRegionBox, held: readonly NoteEventBox[], pattern: Pattern): NoteEventBox[];
  ```

- [ ] **Step 1: Add the dnd-kit packages and regenerate the lockfile**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities && rm -rf node_modules package-lock.json && npm install && npm ci`
Expected: `npm ci` exits 0 (an audit advisory line is not a failure).

- [ ] **Step 2: Write the failing pattern tests**

```ts
import { describe, expect, it } from "vitest";
import { PATTERNS, PATTERN_PPQN, patternById } from "./patterns";

describe("patterns", () => {
  it("has the four patterns in order", () => {
    expect(PATTERNS.map((p) => p.id)).toEqual(["chords", "sixteenths", "melody", "bass"]);
  });
  it("keeps every note inside two bars with a positive duration", () => {
    for (const p of PATTERNS) for (const n of p.notes) {
      expect(n.position).toBeGreaterThanOrEqual(0);
      expect(n.duration).toBeGreaterThan(0);
      expect(n.position + n.duration).toBeLessThanOrEqual(PATTERN_PPQN);
      expect(Number.isInteger(n.position)).toBe(true);
      expect(n.velocity).toBeGreaterThan(0); expect(n.velocity).toBeLessThanOrEqual(1);
    }
  });
  it("chords: four triads, one per half bar, each held its half bar", () => {
    const notes = patternById("chords").notes;
    expect(notes).toHaveLength(12);
    const starts = [...new Set(notes.map((n) => n.position))];
    expect(starts).toEqual([0, 1920, 3840, 5760]);
    for (const n of notes) expect(n.duration).toBe(1920);
  });
  it("sixteenths: 32 notes on one pitch, each a thirty-second, velocities alternating 1 and 0.6", () => {
    const notes = patternById("sixteenths").notes;
    expect(notes).toHaveLength(32);
    expect(new Set(notes.map((n) => n.pitch)).size).toBe(1);
    expect(notes.map((n) => n.velocity).slice(0, 4)).toEqual([1, 0.6, 1, 0.6]);
    for (const n of notes) expect(n.duration).toBe(120);
  });
  it("melody: 16 eighths, bar two repeats bar one, velocities rise 0.4 to 1.0 within a bar", () => {
    const notes = patternById("melody").notes;
    expect(notes).toHaveLength(16);
    for (let i = 0; i < 8; i++) {
      expect(notes[i + 8].pitch).toBe(notes[i].pitch);
      expect(notes[i + 8].position).toBe(notes[i].position + 3840);
    }
    expect(notes[0].velocity).toBeCloseTo(0.4); expect(notes[7].velocity).toBeCloseTo(1.0);
  });
  it("bass: 8 quarter-note roots around C2 at velocity 0.9", () => {
    const notes = patternById("bass").notes;
    expect(notes).toHaveLength(8);
    for (const n of notes) { expect(n.duration).toBe(960); expect(n.velocity).toBe(0.9); expect(n.pitch).toBeGreaterThanOrEqual(36); expect(n.pitch).toBeLessThanOrEqual(47); }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/midiEffects/patterns.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `patterns.ts`**

Pitches: `chords` = Am (57, 60, 64), F (53, 57, 60), C (60, 64, 67), G (55, 59, 62); `sixteenths` on 60; `melody` eight eighths from the C major scale within 60–72 (the builder picks the tune); `bass` roots 45, 41, 36, 43 repeated. `writePattern` follows the placement audit's `writePattern` (`midi-effect-placement-audit-debug-demo.tsx`): delete the held boxes that are still attached inside `editing.modify`, then create the new ones with `project.api.createNoteEvent({ owner: regionBox, position, duration, pitch, velocity })` inside `editing.append`, returning the new boxes.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/lib/midiEffects/patterns.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit and push**

```bash
git add package.json package-lock.json src/lib/midiEffects/patterns.ts src/lib/midiEffects/patterns.test.ts
git commit -m "feat(midi-effects): dnd-kit dependency and the four demo patterns"
git push
```

---

### Task 2: Device registry and parameter descriptors

**Files:**
- Create: `src/lib/midiEffects/devices.ts`
- Modify: `src/lib/testing/boxGraphFixtures.ts` (add `midiEffectFixture`)
- Test: `src/lib/midiEffects/devices.test.ts`

**Interfaces:**
- Consumes: `UnitParameter` from `src/lib/parameterBinding.ts`; `GrooveShuffleBoxAdapter`, the four device adapters from `@opendaw/studio-adapters`; `EffectFactories` from `@opendaw/studio-core`.
- Produces:
  ```ts
  export type DeviceId = "arpeggio" | "pitch" | "velocity" | "zeitgeist";
  export const DEVICE_IDS: readonly DeviceId[];        // tab order: arpeggio, pitch, velocity, zeitgeist
  export interface DeviceSpec { id: DeviceId; label: string; factory: EffectFactory; what: string; listenFor: string; snippet: string }
  export const DEVICES: Readonly<Record<DeviceId, DeviceSpec>>;
  export interface DeviceParameter { key: string; label: string; parameter: UnitParameter; positions?: number }
  export function deviceIdOf(box: EffectBox): DeviceId | null;     // by box class
  export function deviceParameters(adapter: MidiEffectDeviceAdapter): DeviceParameter[];
  ```
  `positions` is set for integer parameters (Arpeggio mode 3, rate `RateFractions.length`, octaves 5, repeat 16; Pitch semitones 73, octaves 15; Zeitgeist duration `DurationStrings.length`) so `ParamSlider` steps whole values. Zeitgeist's parameters come from `adapter.groove()` narrowed with `instanceof GrooveShuffleBoxAdapter` (throw otherwise).
- Fixture: `midiEffectFixture(id: DeviceId): { boxGraph; unit: AudioUnitBox; box: EffectBox; adapter: MidiEffectDeviceAdapter; editing: BoxEditing }` creating the device box by hand on `unit.midiEffects` the way `graphWithZeitgeist` does (a Zeitgeist gets its own groove box), with an adapter built on the minimal context `{ parameterFieldAdapters: new ParameterFieldAdapters(), isMainThread: false }` as `samplerFixture` does.

- [ ] **Step 1: Write the failing tests**

```ts
describe("devices", () => {
  it("registers the four devices with midi factories", () => {
    expect(DEVICE_IDS).toEqual(["arpeggio", "pitch", "velocity", "zeitgeist"]);
    for (const id of DEVICE_IDS) expect(DEVICES[id].factory.type).toBe("midi");
  });
  it("arpeggio parameters carry the SDK's string mappings", () => {
    const { adapter } = midiEffectFixture("arpeggio");
    const params = deviceParameters(adapter);
    expect(params.map((p) => p.key)).toEqual(["modeIndex", "rate", "numOctaves", "gate", "repeat", "velocity"]);
    const mode = params[0];
    expect(mode.positions).toBe(3);
    expect(mode.parameter.getPrintValue().value).toBe("Up");
  });
  it("zeitgeist parameters come from its own groove", () => {
    const { adapter } = midiEffectFixture("zeitgeist");
    const params = deviceParameters(adapter);
    expect(params.map((p) => p.key)).toEqual(["amount", "duration"]);
  });
  it("deviceIdOf names a box by its class", () => {
    expect(deviceIdOf(midiEffectFixture("pitch").box)).toBe("pitch");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/midiEffects/devices.test.ts` → FAIL.

- [ ] **Step 3: Implement `devices.ts` and the fixture**

`what` / `listenFor` prose and the `snippet` strings are copy for the cards: two short sentences each, the snippet showing `insertEffect(midiEffectsFieldOf(project, audioUnitBox), EffectFactories.X)` and one parameter write through `namedParameter`.

- [ ] **Step 4: Run tests and typecheck** → PASS, exit 0.

- [ ] **Step 5: Commit and push** — `git commit -m "feat(midi-effects): device registry, parameter descriptors, fixture"`.

---

### Task 3: Chain operations

**Files:**
- Create: `src/lib/midiEffects/chain.ts`
- Test: `src/lib/midiEffects/chain.test.ts`

**Interfaces:**
- Consumes: `midiEffectFixture` (Task 2); `removeMidiEffect` from `src/lib/audit/midiEffectChain.ts` (re-exported here as `removeDevice`); `IndexedBox` from `@opendaw/lib-box`.
- Produces:
  ```ts
  export function chainBoxes(field: Field<Pointers.MIDIEffectHost>): EffectBox[];    // sorted by index
  export function insertDevice(project: Pick<Project, "editing" | "api">, field: Field<Pointers.MIDIEffectHost>, id: DeviceId): EffectBox;
  export function removeDevice(editing: Editing, box: EffectBox): void;
  export function setDeviceEnabled(editing: Editing, box: EffectBox, enabled: boolean): void;
  export function moveDevice(editing: Editing, field: Field<Pointers.MIDIEffectHost>, fromIndex: number, toIndex: number): void;
  ```
  `moveDevice` has `arrayMove` semantics (the item at `fromIndex` ends at `toIndex`). `IndexedBox.moveIndices(field, [fromIndex], dropIndex)` takes a gap index in the ORIGINAL order, so `dropIndex = fromIndex < toIndex ? toIndex + 1 : toIndex`.

- [ ] **Step 1: Write the failing tests** (a graph with Pitch at 0, Velocity at 1, Arpeggio at 2, built by hand like the fixture; `editing = new BoxEditing(boxGraph)`)

```ts
it("moveDevice(2, 0) puts the last device first", () => {
  moveDevice(editing, unit.midiEffects, 2, 0);
  expect(chainBoxes(unit.midiEffects).map(deviceIdOf)).toEqual(["arpeggio", "pitch", "velocity"]);
});
it("moveDevice(0, 2) puts the first device last", () => {
  moveDevice(editing, unit.midiEffects, 0, 2);
  expect(chainBoxes(unit.midiEffects).map(deviceIdOf)).toEqual(["velocity", "arpeggio", "pitch"]);
});
it("setDeviceEnabled writes the enabled field", () => {
  setDeviceEnabled(editing, boxes[0], false);
  expect(boxes[0].enabled.getValue()).toBe(false);
});
it("removeDevice leaves the chain without it and a zeitgeist takes its groove", () => { /* three boxes → two; graphWithZeitgeist → groove detached */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement `chain.ts`** — `insertDevice` is `editing.modify(() => project.api.insertEffect(field, DEVICES[id].factory)).unwrap("insertEffect")`.
- [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat(midi-effects): chain insert, remove, enable, move"`.

---

### Task 4: Reconcile the chain to a desired list

**Files:**
- Modify: `src/lib/midiEffects/chain.ts`
- Test: `src/lib/midiEffects/chain.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function reconcileChain(project: Pick<Project, "editing" | "api">, field: Field<Pointers.MIDIEffectHost>, desired: readonly DeviceId[]): { changed: boolean };
  ```
  Removes boxes whose id is not in `desired`, inserts missing ids, then moves until `chainBoxes(field).map(deviceIdOf)` equals `desired`. `changed` is false when nothing was written (the caller re-seeks only on true).

- [ ] **Step 1: Write the failing tests.** The insert path needs `project.api`; the test builds a `Project`-free double: `api: { insertEffect: (field, factory) => <create the box by hand on the field> }` typed through `Pick`. Cases: `[]` → `["arpeggio"]` inserts one; `["arpeggio"]` → `["pitch"]` removes and inserts, leaving one box; `["pitch","velocity","arpeggio"]` → `["arpeggio","velocity","pitch"]` reorders with no insert or remove; same list twice → `changed === false`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat(midi-effects): reconcileChain"`.

---

### Task 5: Page state reducer

**Files:**
- Create: `src/lib/midiEffects/pageState.ts`
- Test: `src/lib/midiEffects/pageState.test.ts`

**Interfaces:**
```ts
export type Tab = "dry" | DeviceId;
export interface PageState { mode: "single" | "stack"; tab: Tab; stack: readonly DeviceId[] }
export const INITIAL_STATE: PageState;   // { mode: "single", tab: "dry", stack: [] }
export type PageAction =
  | { type: "selectTab"; tab: Tab }
  | { type: "addToStack"; id: DeviceId }
  | { type: "removeFromStack"; id: DeviceId }
  | { type: "moveInStack"; from: number; to: number }
  | { type: "clearStack" };
export function pageReducer(state: PageState, action: PageAction): PageState;
export function desiredChain(state: PageState): readonly DeviceId[];   // single: [] or [tab]; stack: stack
```

- [ ] **Step 1: Write the failing tests**

```ts
it("selectTab in single mode sets the tab", ...);                       // desiredChain → ["pitch"]
it("selectTab in stack mode is ignored", ...);
it("addToStack from a single device carries that device as the first chip", () => {
  const s = pageReducer({ mode: "single", tab: "arpeggio", stack: [] }, { type: "addToStack", id: "pitch" });
  expect(s).toEqual({ mode: "stack", tab: "arpeggio", stack: ["arpeggio", "pitch"] });
});
it("addToStack from dry starts the stack with the added device", ...);
it("addToStack of a device already stacked is ignored", ...);
it("moveInStack reorders with arrayMove semantics", ...);
it("removing the last chip returns to single/dry", () => {
  expect(pageReducer({ mode: "stack", tab: "arpeggio", stack: ["arpeggio"] }, { type: "removeFromStack", id: "arpeggio" })).toEqual(INITIAL_STATE);
});
it("clearStack returns to single/dry", ...);
it("desiredChain never has a duplicate", ...);
```

- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat(midi-effects): page state reducer"`.

---

### Task 6: Emitted-notes bar builder

**Files:**
- Create: `src/lib/midiEffects/emittedNotes.ts`
- Test: `src/lib/midiEffects/emittedNotes.test.ts`

**Interfaces:**
```ts
export interface Bar { pitch: number; from: number; to: number | null }   // ppqn; to null = still sounding
export class EmittedBars {
  sample(isOn: (pitch: number) => boolean, position: number): void;   // call once per frame
  reset(): void;                                                      // closes nothing: drops all bars
  readonly bars: readonly Bar[];
}
```
Rules: a pitch newly on opens a bar at `position`; newly off closes the open bar at `position`; `position` lower than the previous sample (a loop wrap or a seek backwards) drops every bar first, then opens bars for every pitch on at the new position; bars older than `PATTERN_PPQN` behind the position are dropped.

- [ ] **Step 1: Write the failing tests**

```ts
const on = (...pitches: number[]) => (p: number) => pitches.includes(p);
it("opens a bar when a pitch turns on and closes it when it turns off", () => {
  const e = new EmittedBars();
  e.sample(on(60), 100); e.sample(on(60), 200); e.sample(on(), 300);
  expect(e.bars).toEqual([{ pitch: 60, from: 100, to: 300 }]);
});
it("keeps a sounding bar open", ...);                        // to === null after two samples on
it("wrap clears open bars", () => {
  const e = new EmittedBars();
  e.sample(on(60), 7000); e.sample(on(60), 100);
  expect(e.bars).toEqual([{ pitch: 60, from: 100, to: null }]);
});
it("reset drops everything", ...);
it("two pitches at once make two bars", ...);
```

- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat(midi-effects): frame-sampled emitted-note bars"`.

---

### Task 7: NoteLane component

**Files:**
- Create: `src/components/NoteLane.tsx`
- Test: `src/components/NoteLane.dom.test.tsx` (`// @vitest-environment jsdom`, imports `@/lib/testing/domSetup` first)

**Interfaces:**
```ts
export interface LaneNote { pitch: number; from: number; to: number | null; velocity?: number }
export interface NoteLaneHandle { requestUpdate(): void }
export interface NoteLaneProps {
  title: string; caption?: string;
  notes: () => readonly LaneNote[];        // read inside the painter's render callback
  rangePpqn: number;                        // PATTERN_PPQN
  pitchLow: number; pitchHigh: number;      // inclusive; C2 (36) to C7 (96) on the page
  height: number;
  shadeByVelocity: boolean;
  position?: () => number;                  // when given, a playhead overlay div follows it per frame
}
export const NoteLane: React.ForwardRefExoticComponent<NoteLaneProps & React.RefAttributes<NoteLaneHandle>>;
```
Canvas via `CanvasPainter` (repaints only on `requestUpdate()` / resize); the painter's render callback calls `notes()`. A note outside `[pitchLow, pitchHigh]` is drawn as a 3 px marker at the top or bottom edge in `--mc-amber` and counted in a "n notes out of range" corner label. Bars with `to === null` extend to `position()` if given, else to the canvas edge. Playhead: an absolutely positioned div, `pointer-events: none`, `style.left` written in an `AnimationFrame.add` callback from `position()`; the canvas and overlay share the box model (`boxSizing: "border-box"`, `border: 1px solid transparent`). Colours from `CANVAS_COLORS`.

- [ ] **Step 1: Write the failing tests**

```ts
it("draws one bar at the note's x range", () => {
  const ctx = installFakeContext2d();
  const { container } = render(<NoteLane title="t" notes={() => [{ pitch: 60, from: 1920, to: 3840 }]} rangePpqn={7680} pitchLow={36} pitchHigh={96} height={96} shadeByVelocity={false} />);
  const canvas = container.querySelector("canvas")!;
  layOut(canvas, { left: 0, top: 0, width: 400, height: 96 });
  resize(canvas);
  driveFrames().tick();
  expect(ctx.calls.some((c) => c.startsWith("fillRect(100,"))).toBe(true);   // 1920/7680 × 400
});
it("out-of-range note marked", () => { /* pitch 100 → a fillRect at y 0 of height 3 and the text "1 out of range" */ });
it("requestUpdate repaints with the new notes", () => { /* ref.current.requestUpdate(); tick; a second fillRect set */ });
```
After writing, break the x mapping on purpose and watch the first test fail, then restore.

- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat: NoteLane canvas component"`.

---

### Task 8: The page

**Files:**
- Create: `src/demos/midi/midi-effects-demo.tsx`, `src/demos/midi/MidiEffectCard.tsx`, `src/demos/midi/MidiEffectStack.tsx`, `src/demos/midi/useMidiChain.ts`
- Create: `midi-effects-demo.html` (copy `midi-recording-demo.html`; title "OpenDAW MIDI Effects Demo", description "Hear and see what Arpeggio, Pitch, Velocity and Zeitgeist do to a looping pattern, one at a time and stacked"; og-image `og-image-midi-effects.png`; script `src/demos/midi/midi-effects-demo.tsx`)
- Modify: `vite.config.ts` (input `midiEffects`), `src/index.tsx` ("Recording & MIDI" card after MIDI Recording), `public/sitemap.xml`, `README.md` (demo table row and tree entry)

**Interfaces:**
- `useMidiChain(project, audioUnitBox): ChainEntry[]` where `ChainEntry = { box: EffectBox; id: DeviceId; enabled: boolean }`, from `audioUnitAdapterFor(project, audioUnitBox).midiEffects.unwrap().catchupAndSubscribe({ onAdd, onRemove, onReorder })` plus each box's `enabled.subscribe`; state is rebuilt from `chainBoxes(field)` on every callback (never from page-held order).
- `MidiEffectCard({ project, entry, spec })`: enabled `Switch`, `ParamSlider` per `deviceParameters(adapter)` (adapter via `project.boxAdapters.adapterFor(entry.box, <adapter class by id>)`), `what` and `listenFor`, a collapsible `<pre>` with `snippet`.
- `MidiEffectStack({ entries, onMove(from, to), onRemove(id), onAdd(id), onClear, renderCard(entry) })`: `DndContext` + `SortableContext` (`horizontalListSortingStrategy`), `PointerSensor` and `KeyboardSensor` with `sortableKeyboardCoordinates`, `useSortable` per chip keyed by `UUID.toString(entry.box.address.uuid)`; `onDragEnd` maps `active`/`over` to indices and calls `onMove`; a click on a chip expands its card beneath the row; "+ add" is a Radix `DropdownMenu` of `DEVICE_IDS` not in the stack.

Page wiring:
1. `initializeOpenDAW({ onStatusUpdate })`; create the Vaporisateur (`createInstrument(InstrumentFactories.Vaporisateur)`, keep `audioUnitBox` and `trackBox`), set `release` 0.2, `attack` 0.005, `cutoff` to the builder's taste, in a second transaction; set `timelineBox.bpm` to `PATTERN_BPM`; create the region with `project.api.createNoteRegion({ trackBox, position: 0, duration: PATTERN_PPQN, name: "pattern" })` then `writePattern(project, region, [], patternById("chords"))`; `useTimelineLoop(project, { from: 0, to: PATTERN_PPQN, enabled: true })`.
2. `useReducer(pageReducer, INITIAL_STATE)`; a `useEffect` on `desiredChain(state)` calls `reconcileChain` and, when `changed` and `project.engine.isPlaying.getValue()`, `project.engine.setPosition(0)`. Enabled toggles and parameter writes do NOT go through the reducer (they are not chain membership changes); an enabled toggle re-seeks the same way.
3. Written lane: `notes={() => currentPattern.notes.map(...)}` with `velocity`, `shadeByVelocity`, `requestUpdate()` on pattern change. Emitted lane: a `NoteStreamReceiver(project.liveStreamReceiver, audioUnitBox.address)`, an `EmittedBars`, and one `AnimationFrame.add` that calls `bars.sample((p) => receiver.isNoteOn(p), project.engine.position.getValue())` then `emittedRef.current.requestUpdate()` while playing; `bars.reset()` on stop. Caption: "frame-sampled from the engine's held-note set: shows Arpeggio steps and Pitch moves; cannot show velocity; Zeitgeist's shift only roughly".
4. Tabs: Radix `SegmentedControl` over `["dry", ...DEVICE_IDS]`, disabled in stack mode; under it the single device's `MidiEffectCard` (or a "No device: the pattern as written" line for Dry).
5. Transport: Play → `project.engine.play()`, Stop → `project.engine.stop(true)`; `isPlaying` from `engine.isPlaying.catchupAndSubscribe`. Pattern picker: `Select` over `PATTERNS`; on change `writePattern` with the held boxes, then re-seek if playing.
6. Page shell: `Theme`, `GitHubCorner`, `BackLink`, `MoisesLogo`, `CONSOLE_STYLES`, intro prose with a link to the Spielwerk page (`/spielwerk-demo.html`, which PR 2 adds; the link text says "scriptable MIDI effect").

- [ ] **Step 1: Write the `useMidiChain` hook and a jsdom test** that renders a probe component over a `graphWithZeitgeist`-style fixture is not possible without a `Project`; instead test the pure order mapping: `entriesFrom(boxes: EffectBox[]): ChainEntry[]` (exported from the hook file) on the Task 3 three-device graph returns ids in index order with `enabled`. Run, see it fail, implement, see it pass.
- [ ] **Step 2: Build the components and the page.** `npm run typecheck` exits 0.
- [ ] **Step 3: Checklist edits** (HTML entry, vite input, index card, sitemap, README). Build: `npm run build` exits 0.
- [ ] **Step 4: Run it.** `npm run dev` (or reuse the running server), open `https://localhost:5173/midi-effects-demo.html` in the Playwright browser, real click on Play. Check: the written lane shows the chords; the emitted lane shows bars once playing; the Arpeggio tab shows sixteenth steps on the emitted lane; dragging a chip reorders (the chain order in the box graph, read via the React fiber's `project`, matches the chips); removing the last chip returns to Dry. Fix what is wrong.
- [ ] **Step 5: Commit and push** — `"feat(midi-effects): the MIDI Effects demo page"`.

---

### Task 9: Audio verification, og-image, PR

**Files:**
- Create: `public/og-image-midi-effects.png` (1200×630 screenshot of the page)

- [ ] **Step 1: Measure the output.** In the Playwright browser on a fresh load: inject the CLAUDE.md destination tap (monkeypatch `AudioNode.prototype.connect` to tee `AudioDestinationNode` connections through an `AnalyserNode`) before the engine connects; real click on Play with Dry on the `chords` pattern; count onsets over two bars from the analyser (a rise above 0.05 full scale after 30 ms below it); select the Arpeggio tab; count again. Expected: Dry 4 onsets per two bars (the four chords), Arpeggio 32 (sixteenths). Record both figures for the PR body. If the tap race is lost, use the worklet-restart recovery in CLAUDE.md, not a reload.
- [ ] **Step 2: Screenshot** the page at 1200×630 with the Arpeggio tab active and the emitted lane populated; save as `public/og-image-midi-effects.png`.
- [ ] **Step 3: Typecheck, test, build** — all exit 0.
- [ ] **Step 4: Commit and push** — `"feat(midi-effects): og-image"`.
- [ ] **Step 5: Open the PR** against `main` with `gh pr create`: body states what the page does, the onset figures from Step 1, the dnd-kit addition and lockfile regeneration, the emitted lane's limits, and that the Spielwerk page follows in a stacked PR. End the body with the attribution line. Then run `/pr-review-toolkit:review-pr` and fix Critical and Important findings on the branch.
