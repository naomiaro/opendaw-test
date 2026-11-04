# MIDI Effects Overview and Rendered Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An overview page for the MIDI effect demos and a third sub-demo, "Rendered", whose lower rows show exactly what the engine emits from the chain: onset, end, pitch with cents and velocity, read back from an offline render of a Nano sine.

**Architecture:** The Rendered page boots the semantics audit's Nano project (`buildNanoProject`), reuses the MIDI Effects page's chain controls, and after each settled change renders the pattern through `renderOfflineSlice` and reads it with the audit's reader. A pure module (`renderedNotes.ts`) turns the read figures plus the rule's readability marks into lane notes, velocity stems and "cannot read" spans; a pure scheduler coalesces requests; one hook owns calibration, subscriptions and the render. `NoteLane` gains a velocity colour ramp (shared by both pages) and the hollow / dashed / label forms; a new `VelocityStrip` canvas draws ghost and emitted stems.

**Tech Stack:** React 18, TypeScript strict, Radix Themes, `@opendaw/*` SDK 0.0.180 (WASM offline renderer), Vitest (Node for logic, jsdom for components), Vite multi-page build.

**Spec:** `docs/superpowers/specs/2026-11-03-midi-effects-overview-and-rendered-page-design.md`

## Global Constraints

- Every repo rule in `CLAUDE.md` and `src/demos/midi/CLAUDE.md`: Option types never `?.`-ed; all box writes inside `editing.modify`; a box created in one transaction is read in the next; every `Terminable` terminated; no per-frame `setState`; console logs are strings.
- `npm run typecheck` exits 0 and `npm test` passes before every commit; `strict`, `noUnusedLocals`, `noUnusedParameters` are on.
- The audit library under `src/lib/audit/` stays pure and never imports demo code; the demo imports it. The shared patterns and the audit's `SAMPLE_SECONDS` are not changed.
- Pattern notes on the Rendered page are shortened to **90 %** of their written length (`withGaps(pattern, 0.9)`); the Rendered page's sample is **20 s**; the settle time is **300 ms**; the match window between a read and a predicted onset is **10 ms**; a cents label appears when `|cents| ≥ 2` (the audit's `TOLERANCES.cents`).
- Both the MIDI Effects page and the Rendered page put the region at **bar 2** (`REGION_START_PPQN = BAR_PPQN`, which is the audit's `REGION_POSITION_PPQN`); every lane position is region-local.
- The velocity ramp squares the velocity before mapping (openDAW's `PitchPainter`); `shadeByVelocity={false}` draws the lane's one solid colour.
- Page files follow the "Adding a New Demo" checklist in `CLAUDE.md` (HTML entry with meta tags and `og:image`, Vite input, index card, sitemap, GoatCounter, README table row and source-tree line). Design language: `docs/design/2026-06-11-mastering-console-editorial.md`.
- Commit messages: imperative, scoped (`feat(midi-rendered): …`), ending with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Nothing is pushed to the upstream openDAW repository; the PR is on `naomiaro/opendaw-test`, branch `feat/midi-effects-overview-rendered`.

## Review Focus

1. **A Pitch shift that drops every note out of 0..127**: the prediction and the render are both empty; the rendered rows must show no bars and no error, not the overlap sentence. Pinned in Task 5 (`renderedRows` with empty inputs).
2. **A read note whose pitch the reader could not name** (`pitch === null`, a jittery tone outside every unreadable span): drawn hollow at the lane's bottom mark with the label "no pitch", never dropped and never thrown on. Pinned in Task 5.
3. **A chain change while a render is in flight**: the rows must stay marked stale until the render that includes the change lands; the in-flight render's result must not be shown as current. Pinned in Task 6 (scheduler) and Task 8 (hook).
4. **A disabled device** must be left out of the prediction (the engine skips it) while its box stays on the chain. Pinned in Task 5 (`predictChain` with `enabled: false`).
5. **A failed calibration** (the dry render read a wrong note count or a zero peak): the rendered rows show the error sentence, the written lane and Play still work, and the next pattern change does not retry calibration in a loop. Pinned in Task 8.

---

### Task 1: Gapped patterns and the shared region start

**Files:**
- Modify: `src/lib/midiEffects/patterns.ts`
- Modify: `src/lib/audit/midiEffectSemanticsRows.ts:35` (`REGION_POSITION_PPQN`)
- Test: `src/lib/midiEffects/patterns.test.ts`

**Interfaces:**
- Produces: `export const REGION_START_PPQN: ppqn` (= `BAR_PPQN`) in `patterns.ts`; `export function withGaps(pattern: Pattern, ratio: number): Pattern` returning the same `id`, `label`, `blurb` and a `notes` array with each `duration` replaced by `Math.round(duration * ratio)` (position, pitch, velocity unchanged). `REGION_POSITION_PPQN` in the Rows module becomes `REGION_START_PPQN` re-exported (same value, so the audit's register is unchanged).

- [ ] **Step 1: Write the failing tests** in `patterns.test.ts`

```ts
describe("withGaps", () => {
  it("shortens every note to the ratio of its length and leaves everything else", () => {
    const melody = patternById("melody");
    const gapped = withGaps(melody, 0.9);
    expect(gapped.id).toBe("melody");
    expect(gapped.notes.length).toBe(melody.notes.length);
    gapped.notes.forEach((note, i) => {
      expect(note.duration).toBe(Math.round(melody.notes[i].duration * 0.9));
      expect(note.position).toBe(melody.notes[i].position);
      expect(note.pitch).toBe(melody.notes[i].pitch);
      expect(note.velocity).toBe(melody.notes[i].velocity);
    });
  });
  it("leaves at least 25 ms between the Melody's eighths at 120 bpm", () => {
    const [a, b] = withGaps(patternById("melody"), 0.9).notes;
    const gapSeconds = PPQN.pulsesToSeconds(b.position - (a.position + a.duration), PATTERN_BPM);
    expect(gapSeconds).toBeGreaterThanOrEqual(0.025);
  });
  it("does not touch the shared pattern", () => {
    const before = patternById("bass").notes.map((n) => n.duration);
    withGaps(patternById("bass"), 0.5);
    expect(patternById("bass").notes.map((n) => n.duration)).toEqual(before);
  });
});
it("REGION_START_PPQN is one bar", () => expect(REGION_START_PPQN).toBe(BAR_PPQN));
```

- [ ] **Step 2: Run** `npx vitest run src/lib/midiEffects/patterns.test.ts` — expect FAIL: `withGaps` / `REGION_START_PPQN` not exported.

- [ ] **Step 3: Implement** `REGION_START_PPQN` and `withGaps` in `patterns.ts`; in `midiEffectSemanticsRows.ts` replace `export const REGION_POSITION_PPQN = BAR_PPQN;` with `export const REGION_POSITION_PPQN = REGION_START_PPQN;` (import from `@/lib/midiEffects/patterns`).

- [ ] **Step 4: Run** `npx vitest run src/lib/midiEffects src/lib/audit` and `npm run typecheck` — expect PASS, 0 errors.

- [ ] **Step 5: Commit** `feat(midi-effects): withGaps pattern variant and the shared region start`

---

### Task 2: Velocity colour ramp and the lane's hollow, dashed and labelled forms

**Files:**
- Create: `src/lib/midiEffects/velocityColor.ts`
- Modify: `src/components/NoteLane.tsx`
- Test: `src/lib/midiEffects/velocityColor.test.ts`, `src/components/NoteLane.dom.test.tsx`

**Interfaces:**
- Produces: `export const VELOCITY_RAMP: { soft: [number, number, number]; loud: [number, number, number] }` (RGB; `loud` is `CANVAS_COLORS.amber` `#e8a33d` = `[232, 163, 61]`; `soft` is the builder's pale, low-saturation tint, readable against `CANVAS_COLORS.gridSupporting`, e.g. `[96, 78, 54]`); `export function velocityColor(velocity: number): string` returning `rgb(r, g, b)` with each channel `soft + (loud − soft) × clamp(velocity, 0, 1)²`, rounded.
- `LaneNote` gains optional fields: `hollow?: boolean` (outline only, no fill), `dashedEdges?: boolean` (the bar's left and right edges drawn as dashed 1 px lines over the fill), `label?: string` (drawn in `CANVAS_FONT_SMALL`, `CANVAS_COLORS.label`, just right of the bar's left edge, 1 px inside the row).
- `NoteLane` keeps its props; with `shadeByVelocity` and a `velocity` on the note the fill is `velocityColor(velocity)`; without, `CANVAS_COLORS.amber` at alpha 1 (no alpha ramp anywhere any more).

- [ ] **Step 1: Write the failing tests** in `velocityColor.test.ts`

```ts
it("is the accent at velocity 1 and the soft tint at 0", () => {
  expect(velocityColor(1)).toBe("rgb(232, 163, 61)");
  expect(velocityColor(0)).toBe(`rgb(${VELOCITY_RAMP.soft.join(", ")})`);
});
it("squares the velocity: 0.5 sits a quarter of the way", () => {
  const [r] = VELOCITY_RAMP.soft; const [R] = VELOCITY_RAMP.loud;
  expect(velocityColor(0.5)).toMatch(new RegExp(`^rgb\\(${Math.round(r + (R - r) * 0.25)}, `));
});
it("clamps outside 0..1", () => { expect(velocityColor(1.5)).toBe(velocityColor(1)); expect(velocityColor(-1)).toBe(velocityColor(0)); });
```

and in `NoteLane.dom.test.tsx` (the file's `show` helper; `ctx.calls` records every call with its arguments, property sets included as `fillStyle=…`):

```ts
it("fills a shaded bar with the velocity ramp colour", () => {
  const { ctx } = showShaded(() => [{ pitch: 60, from: 1920, to: 3840, velocity: 0.6 }]);
  const i = ctx.calls.findIndex((c) => c.startsWith("fillRect(100,"));
  expect(ctx.calls.slice(0, i).filter((c) => c.startsWith("fillStyle=")).at(-1)).toBe(`fillStyle=${velocityColor(0.6)}`);
});
it("draws a hollow note as an outline and no fill", () => {
  const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840, hollow: true }]);
  expect(ctx.calls.some((c) => c.startsWith("strokeRect(100,"))).toBe(true);
  expect(ctx.calls.some((c) => c.startsWith("fillRect(100,") && c.split(",")[2] === "100")).toBe(false);
});
it("dashes the edges of a rule-placed bar", () => {
  const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840, dashedEdges: true }]);
  expect(ctx.calls.some((c) => c.startsWith("setLineDash("))).toBe(true);
});
it("writes a note's label beside it", () => {
  const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840, label: "+25¢" }]);
  expect(ctx.calls.some((c) => c.startsWith("fillText(+25¢,"))).toBe(true);
});
```

Add a `showShaded` helper that renders with `shadeByVelocity`. If `installFakeContext2d` does not record `fillStyle` sets or `setLineDash`, extend it in `src/lib/testing/domSetup.ts` (it throws for names a real context lacks, so add only real ones).

- [ ] **Step 2: Run** both test files — expect FAIL.

- [ ] **Step 3: Implement** `velocityColor.ts` and the `NoteLane` paint changes. Paint order per note: fill (or `strokeRect` with `CANVAS_COLORS.structural` when hollow), then dashed edges (`setLineDash([2, 2])`, `strokeStyle` `CANVAS_COLORS.playhead` at `globalAlpha` 0.7, reset to `[]` after), then the label. Out-of-range marks keep their current form.

- [ ] **Step 4: Run** `npx vitest run src/components src/lib/midiEffects` and `npm run typecheck` — expect PASS. Open `https://localhost:5173/midi-effects-demo.html` (dev server; see CLAUDE.md on HTTPS) and confirm the written lane's Melody ramp reads pale to amber.

- [ ] **Step 5: Commit** `feat(note-lane): velocity colour ramp, hollow, dashed-edge and labelled notes`

---

### Task 3: VelocityStrip component

**Files:**
- Create: `src/components/VelocityStrip.tsx`
- Test: `src/components/VelocityStrip.dom.test.tsx`

**Interfaces:**
- Produces: `export interface Stem { readonly at: number /* ppqn, region-local */; readonly velocity: number /* 0..1 */ }`; `export interface VelocityStripHandle { requestUpdate(): void }`; `export interface VelocityStripProps { title: string; caption?: string; ghosts: () => readonly Stem[]; stems: () => readonly Stem[]; rangePpqn: number; height: number; beatPpqn?: number; barPpqn?: number }`; `export const VelocityStrip = forwardRef<VelocityStripHandle, VelocityStripProps>(…)`.
- Drawing, same `CanvasPainter` + `propsRef` pattern as `NoteLane`: background and grid as the lane; each ghost a 3 px wide rect in `CANVAS_COLORS.structural` from the bottom up to `velocity × (height − 14)`; each stem a 3 px rect in `velocityColor(velocity)` 1 px to the right of where its ghost would sit, same height rule; ghosts drawn first; title at top-left; caption below the canvas as in `NoteLane`.

- [ ] **Step 1: Write the failing tests** (`show` helper as in `NoteLane.dom.test.tsx`, width 400, range 7680, height 64)

```ts
it("draws one stem per emitted note with height by velocity", () => {
  const { ctx } = show(() => [], () => [{ at: 1920, velocity: 0.5 }]);
  const rects = fillRects(ctx.calls).map(args).filter(([x]) => x >= 100 && x <= 104);
  expect(rects.length).toBe(1);
  expect(rects[0][3]).toBeCloseTo(0.5 * (64 - 14), 1);
});
it("draws a ghost before the stem at the same onset, in the structural colour", () => {
  const { ctx } = show(() => [{ at: 1920, velocity: 1 }], () => [{ at: 1920, velocity: 0.5 }]);
  const styles = ctx.calls.filter((c) => c.startsWith("fillStyle="));
  expect(styles.indexOf(`fillStyle=${CANVAS_COLORS.structural}`)).toBeLessThan(styles.indexOf(`fillStyle=${velocityColor(0.5)}`));
});
it("repaints on requestUpdate", () => { /* ref.current.requestUpdate(); frames.tick(); expect a second fillRect pass */ });
```

- [ ] **Step 2: Run** `npx vitest run src/components/VelocityStrip.dom.test.tsx` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `VelocityStrip.tsx`.

- [ ] **Step 4: Run** the test file and `npm run typecheck` — expect PASS.

- [ ] **Step 5: Commit** `feat(velocity-strip): ghost and emitted velocity stems on a canvas`

---

### Task 4: `settingsOf` (box → DeviceSetting) and `mutateCopy` on the offline render

**Files:**
- Modify: `src/lib/audit/midiEffectSemanticsRows.ts` (beside `applySettings`)
- Modify: `src/lib/offlineScan.ts:10-23,56-70`
- Test: `src/lib/audit/midiEffectSemanticsRows.test.ts`

**Interfaces:**
- Produces: `export function settingsOf(box: EffectBox): DeviceSetting` — the inverse of `applySettings`: reads the same fields with `getValue()`; for a Zeitgeist through `zeitgeistGrooveBox(box)`; `modeIndex` cast to `0 | 1 | 2`; throws `Error(\`no settings reader for ${box.constructor.name}\`)` for any other box.
- `RenderOfflineSliceOptions` gains `mutateCopy?: (copy: Project) => void`, called on the copy right after `project.copy()` and the loop-disable write, before `OfflineEngineRenderer.create`; a throw inside it propagates (the copy is still terminated by the existing `finally`).

- [ ] **Step 1: Write the failing test** in `midiEffectSemanticsRows.test.ts`, using `midiEffectFixture` / `transact` as the file already does for `applySettings`:

```ts
describe("settingsOf", () => {
  it("round-trips every device through applySettings", () => {
    for (const setting of [
      { device: "arpeggio", settings: { ...ARPEGGIO_BASE, modeIndex: 2, gate: 0.75, repeat: 3 } },
      { device: "pitch", settings: { semiTones: 7, cents: -25, octaves: -1 } },
      { device: "velocity", settings: { ...VELOCITY_BASE, randomAmount: 0.5, offset: -0.25 } },
      { device: "zeitgeist", settings: { amount: 0.7, duration: 960 } },
    ] as DeviceSetting[]) {
      const box = /* fixture box for setting.device */;
      transact(graph, () => applySettings(box, setting));
      expect(settingsOf(box)).toEqual(setting);
    }
  });
  it("throws for a box it does not know", () => { expect(() => settingsOf(/* a MaximizerDeviceBox or any non-midi EffectBox from the fixtures */)).toThrow(/no settings reader/); });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/audit/midiEffectSemanticsRows.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `settingsOf` and the `mutateCopy` option (one line in the options interface with a doc comment, one `if (mutateCopy) mutateCopy(projectCopy);` inside the existing `try`).

- [ ] **Step 4: Run** the test file and `npm run typecheck` — expect PASS.

- [ ] **Step 5: Commit** `feat(audit): settingsOf reads a device's DeviceSetting back; renderOfflineSlice takes a mutateCopy hook`

---

### Task 5: `renderedNotes.ts` — figures and marks to lane notes, stems and spans

**Files:**
- Create: `src/lib/midiEffects/renderedNotes.ts`
- Test: `src/lib/midiEffects/renderedNotes.test.ts`

**Interfaces:**
- Consumes: `RuleNote`, `PredictedNote`, `RuleContext`, `DeviceSetting`, `DEVIATIONS`, `composeRules`, `clipToRange`, `markReadability` (Rules); `NoteFigure` (Reader); `TOLERANCES` (Verdict); `LaneNote` (NoteLane) and `Stem` (VelocityStrip) as `import type` only, the way a type crosses from a component into a lib module without pulling React in; `Pattern`, `REGION_START_PPQN` (patterns); `PPQN` from `@opendaw/lib-dsp`.
- Produces:
  - `export interface ChainSetting { setting: DeviceSetting; enabled: boolean }`
  - `export interface Prediction { predicted: PredictedNote[]; silenced: RuleNote[] }`
  - `export function predictChain(chain: readonly ChainSetting[], context: RuleContext, pattern: Pattern, bpm: number, mark: MarkOptions): Prediction` — source notes = the pattern's notes at `position + REGION_START_PPQN`, `cent 0`; enabled stages only; `composeRules` with the set of EVERY `DEVIATIONS` name whose `device` is in the enabled chain; `clipToRange(…, context.range)`; `silenced` = the composed notes with `velocity === 0`; `predicted` = `markReadability(composed, bpm, mark)`.
  - `export type MarkOptions = Parameters<typeof markReadability>[2]`
  - `export interface RenderedNote extends LaneNote { readonly measured: boolean }`
  - `export interface UnreadableSpan { readonly from: number; readonly to: number /* ppqn, region-local */; readonly reason: "polyphonic" | "overlap" }`
  - `export interface RenderedRows { notes: RenderedNote[]; stems: Stem[]; ghosts: Stem[]; unreadable: UnreadableSpan[]; sentence: string | null }`
  - `export function renderedRows(read: readonly NoteFigure[], prediction: Prediction, pattern: Pattern, bpm: number, readAt: (onsetMs: number, endMs: number) => NoteFigure): RenderedRows`
  - `export const MATCH_MS = 10`; `export function msToRegionPpqn(ms: number, bpm: number): number` = `PPQN.secondsToPulses(ms / 1000, bpm) − REGION_START_PPQN` (float, the lane takes floats); `export function predictedMs(note: RuleNote, bpm: number): { onsetMs: number; endMs: number }`.
- `renderedRows` rules (each pinned by a test below):
  1. `ghosts` = one per pattern note at its written onset and velocity.
  2. `unreadable` = each predicted note with readability `polyphonic` or `overlap`, as a region-local span, merged when they touch; `sentence` = `"The reader reads one voice at a time: these notes overlap. Add an Arpeggio, or pick a one-voice pattern."` when the list is non-empty, else null.
  3. A read figure whose onset (region-local) lies inside an unreadable span is dropped.
  4. Each predicted `readable` note takes the nearest remaining read figure whose onset is within `MATCH_MS` of the predicted onset; the note becomes `{ pitch: read.pitch ?? predicted.pitch, from: read onset, to: read end, velocity: read.velocity, measured: true, label: cents label when read.cents !== null && |read.cents| ≥ TOLERANCES.cents (format "+25¢" / "−3¢", rounded), hollow: read.pitch === null, label "no pitch" in that case }`; a stem at the read onset with the read velocity. A readable predicted note with no match becomes a hollow note at its predicted span with label `"silent"` and no stem.
  5. Each predicted `abutting` note is read with `readAt(predictedMs)`: `{ from/to: predicted span, pitch: figure.pitch ?? predicted.pitch, velocity: figure.velocity, dashedEdges: true, measured: false, cents label as in 4 }`; a stem at the predicted onset with the figure's velocity.
  6. Each predicted `too-short` / `too-quiet` note is hollow at its predicted span with label `"too short"` / `"too quiet"`, no stem.
  7. Each `silenced` note is hollow at its predicted span with label `"silent"`, no stem.
  8. Every remaining read figure (unmatched, outside every span) is drawn solid at what was read (`pitch ?? 0` with `hollow: true` and label `"no pitch"` when null), `measured: true`, with a stem.
  9. `notes` sorted by `from`; `stems` sorted by `at`.

- [ ] **Step 1: Write the failing tests** in `renderedNotes.test.ts` (Node; build `NoteFigure`s by hand; `readAt` is a stub returning a fixed figure; `bpm = PATTERN_BPM`; `context = { range: renderRange(PATTERN_BPM), computeVelocity: (_p, v) => v, warp: (p) => p }`; `mark` = the audit page's `MARK_OPTIONS` values):

```ts
describe("predictChain", () => {
  it("applies every known deviation of the enabled devices", () => {
    const chain = [{ setting: { device: "arpeggio", settings: { ...ARPEGGIO_BASE, velocity: -1 } }, enabled: true }];
    const { silenced, predicted } = predictChain(chain, context, patternById("melody"), PATTERN_BPM, mark);
    expect(predicted).toEqual([]);                 // the engine is silent at −100 % (arpeggio-velocity-matrix)
    expect(silenced.length).toBeGreaterThan(0);
  });
  it("skips a disabled device", () => {
    const chain = [{ setting: { device: "pitch", settings: { semiTones: 12, cents: 0, octaves: 0 } }, enabled: false }];
    const { predicted } = predictChain(chain, context, withGaps(patternById("melody"), 0.9), PATTERN_BPM, mark);
    expect(predicted.map((n) => n.pitch)).toEqual(patternById("melody").notes.map((n) => n.pitch));
  });
  it("marks the Chords pattern polyphonic without an Arpeggio", () => { /* every predicted readability === "polyphonic" */ });
});
describe("renderedRows", () => {
  it("a matched readable note takes the read onset, end, pitch and velocity and gets a stem", () => { /* figure 1 ms off the predicted onset → measured: true, velocity from the figure */ });
  it("labels cents of 2 or more and not below", () => { /* cents 25 → "+25¢"; cents 1.5 → no label */ });
  it("drops a read blob inside a polyphonic span and writes the sentence", () => { /* Chords dry: one figure inside the span → notes [] , sentence non-null */ });
  it("draws an abutting note dashed at the predicted span with the readAt figure's velocity", () => {});
  it("draws a silenced note hollow with the label silent and no stem", () => {});
  it("keeps an unmatched read note outside every span, hollow with no pitch when the pitch is null", () => {});
  it("a readable predicted note with no read counterpart is hollow and labelled silent", () => {});
  it("empty prediction and empty read give no notes, no stems and no sentence", () => {});
  it("one ghost per written note at the written velocity", () => {});
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/midiEffects/renderedNotes.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `renderedNotes.ts` per the rules above.

- [ ] **Step 4: Run** the test file and `npm run typecheck` — expect PASS.

- [ ] **Step 5: Commit** `feat(midi-rendered): renderedNotes — read figures and rule marks to lane notes, stems and unreadable spans`

---

### Task 6: `RenderScheduler` — coalesce requests, one follow-up at most

**Files:**
- Create: `src/lib/midiEffects/renderScheduler.ts`
- Test: `src/lib/midiEffects/renderScheduler.test.ts`

**Interfaces:**
- Produces: `export type SchedulerStatus = "idle" | "stale" | "rendering"`; `export class RenderScheduler { constructor(run: () => Promise<void>, options: { settleMs: number; onStatus: (status: SchedulerStatus) => void; onError: (message: string) => void }); request(): void; dispose(): void }`.
- Behaviour: `request()` sets status `stale` (if not already) and (re)starts a settle timer; when the timer fires with no run in flight, status `rendering`, `run()` is awaited; a `request()` during a run marks `pending`; after the run, if `pending`, one more settle-and-run cycle follows (status stays `stale`, never `idle`, in between); otherwise status `idle`. A run that rejects calls `onError(String(message))`, then status `idle` (or `stale` if pending). `dispose()` clears the timer and ignores the in-flight run's result (no callbacks after dispose).

- [ ] **Step 1: Write the failing tests** (Vitest fake timers, `vi.useFakeTimers()`):

```ts
it("three requests within the settle time run once, after the settle", async () => { /* request ×3 at 0, 100, 200 ms; advance 299 → runs 0; advance 1 → runs 1 */ });
it("goes stale on request, rendering on run, idle after", async () => { /* onStatus calls: ["stale", "rendering", "idle"] */ });
it("a request during a run runs exactly one more time after it", async () => { /* run returns a deferred promise; request() ×2 while pending; resolve; advance settle → runs 2; status never "idle" between */ });
it("reports a rejected run and returns to idle", async () => { /* onError("boom"); status idle */ });
it("dispose cancels the timer and silences the in-flight run", async () => {});
```

- [ ] **Step 2: Run** the test file — expect FAIL.

- [ ] **Step 3: Implement** `renderScheduler.ts` (plain class, `setTimeout`/`clearTimeout`, no React).

- [ ] **Step 4: Run** the test file and `npm run typecheck` — expect PASS.

- [ ] **Step 5: Commit** `feat(midi-rendered): RenderScheduler coalesces render requests with one follow-up`

---

### Task 7: Lift the chain sections out of the MIDI Effects page; move its region to bar 2; the captions

**Files:**
- Create: `src/demos/midi/MidiChainSections.tsx`
- Modify: `src/demos/midi/midi-effects-demo.tsx` (boot, loop, reseek, lanes, intro, the two sections replaced by the component)
- Modify: `src/lib/midiEffects/devices.ts:71` (`velocity.listenFor`)
- Modify: `src/lib/midiEffects/emittedNotes.ts` (doc only: the position passed is region-local)
- Test: `src/demos/midi/MidiChainSections.dom.test.tsx`

**Interfaces:**
- Produces: `export interface MidiChainSectionsProps { state: PageState; dispatch: React.Dispatch<PageAction>; entries: readonly ChainEntry[]; project: Project | null; renderCard: (entry: ChainEntry, compact: boolean) => React.ReactNode }`; `export const MidiChainSections: React.FC<MidiChainSectionsProps>` rendering the "One at a time" and "Stack them" sections exactly as the page does today (the `SegmentedControl`, the single card or the two hints, the `MidiEffectStack` with its handlers dispatching the page actions, the stack prose with the "Adding carries … over" sentence).
- The MIDI Effects page after this task: `createNoteRegion({ trackBox, position: REGION_START_PPQN, … })`; `useTimelineLoop(project, { from: REGION_START_PPQN, to: REGION_START_PPQN + PATTERN_PPQN, enabled: true })`; `reseekIfPlaying` seeks to `REGION_START_PPQN`; `position` passed to the lanes and to `EmittedBars.sample` is `project.engine.position.getValue() − REGION_START_PPQN`; the emitted lane's caption reads `"frame-sampled from the engine's held-note set: shows Arpeggio steps and Pitch moves; carries no velocity, so every bar is one colour (the Rendered page shows it); Zeitgeist's shift only roughly"`; the intro's last sentence links the overview: `For the exact view, velocity included, see the Rendered page; all three pages are on the MIDI Effects overview.` with `/midi-effects-rendered-demo.html` and `/midi-effects-demos.html` links in `var(--mc-amber)`; the kicker reads `MIDI 01 — Effects · OpenDAW SDK`.
- `DEVICES.velocity.listenFor` becomes: `"On Sixteenths, a strong magnet flattens the loud-soft alternation. On Melody, random breaks the ramp. The emitted lane here cannot show any of it: it reads which pitches are sounding, not how loud, so its bars break the velocity convention and stay one colour. The Rendered page shows every note's emitted velocity."`

- [ ] **Step 1: Write the failing test** `MidiChainSections.dom.test.tsx` (jsdom; `project: null`, `entries: []`; `renderCard` returns a marker div):

```ts
it("in single mode with the dry tab shows the no-device hint", () => { /* "No device: the pattern as written." in document.body.innerText */ });
it("selecting a device tab dispatches selectTab", async () => { /* userEvent.click on "Pitch" → dispatch called with { type: "selectTab", tab: "pitch" } */ });
it("in stack mode the tabs are inert and the hint says the stack owns the chain", () => {});
```

- [ ] **Step 2: Run** the test — expect FAIL (module missing).

- [ ] **Step 3: Implement** `MidiChainSections.tsx` by moving the two sections' JSX out of the page; wire the page to it; make the region, loop, seek, position and caption changes listed above; update `listenFor`.

- [ ] **Step 4: Run** `npx vitest run src/demos/midi src/lib/midiEffects` and `npm run typecheck` — expect PASS. Load `https://localhost:5173/midi-effects-demo.html`, click Play with a real click, confirm the playhead starts at the lane's left edge and the emitted lane draws bars from the left (region-local), and that Arpeggio on Chords still runs.

- [ ] **Step 5: Commit** `refactor(midi-effects): MidiChainSections lifted; region at bar 2; the emitted lane names the velocity convention it breaks`

---

### Task 8: `useRenderedNotes` — calibration, subscriptions, the render

**Files:**
- Create: `src/demos/midi/useRenderedNotes.ts`
- Test: `src/demos/midi/useRenderedNotes.dom.test.tsx`

**Interfaces:**
- Consumes: `RenderScheduler` (Task 6); `predictChain`, `renderedRows`, `MarkOptions` (Task 5); `settingsOf` (Task 4); `renderOfflineSlice` with `mutateCopy` (Task 4); `calibrationFrom`, `readNotes`, `readFigureAt`, `toFigure`, `READER_DEFAULTS`, `Calibration` (Reader); `renderRange`, `renderSeconds`, `NANO_ATTACK_SECONDS`, `NANO_RELEASE_SECONDS`, `REGION_POSITION_PPQN` (Rows); `removeMasterMaximizer` (`src/lib/audit/midiEffectChain.ts`); `deviceParameters` (devices); `ChainEntry` (useMidiChain); `VelocityDeviceBoxAdapter`, `ZeitgeistDeviceBoxAdapter`, `Devices` (adapters).
- Produces:
  - `export interface RenderedState { status: "calibrating" | "idle" | "stale" | "rendering" | "error"; rows: RenderedRows | null; error: string | null; renderMs: number | null }`
  - `export interface RenderedNotesOptions { project: Project | null; audioUnitBox: AudioUnitBox | null; entries: readonly ChainEntry[]; pattern: Pattern /* already gapped */; bpm: number; rate: number; calibration: Calibration | null; calibrationError?: string | null; render?: RenderFn /* test seam */ }`
  - `export type RenderFn = (project: Project, seconds: number, rate: number) => Promise<Float32Array>`; `export const renderChannel: RenderFn` — the default: `renderOfflineSlice(project, 0, seconds, rate, { mutateCopy })` where `mutateCopy` removes the master Maximizer on the copy through the adapter layer (`removeMasterMaximizer`; throw unless it removed exactly 1) and returns `channels[0]`.
  - `export function useRenderedNotes(options: RenderedNotesOptions): RenderedState`
  - `export async function calibrateRendered(project: Project, bpm: number, rate: number, render: RenderFn = renderChannel): Promise<Calibration>` — renders the region AS IT STANDS (the caller has written the gapped Sixteenths first; see Task 9) over `renderSeconds(bpm)`, `readNotes`, then `calibrationFrom(notes, rate, PPQN.pulsesToSeconds(REGION_POSITION_PPQN, bpm), 32)`.
  - `export const MARK: MarkOptions = { attackMs: 1, releaseMs: 1, gapMs: READER_DEFAULTS.gapMs, minCycles: READER_DEFAULTS.minCycles, minVelocity: 0.01 }`
- Hook behaviour: with a non-null `calibrationError` the status is `error` with that message and the hook never requests a render (no scheduler, no subscriptions); with `calibration === null` and no error the status is `calibrating` and nothing renders. Otherwise one `RenderScheduler` (settle 300 ms) lives for the hook's life; every change to `entries` or `pattern` calls `request()`; for each entry, subscriptions: each `deviceParameters(adapter).parameter.catchupAndSubscribe(request)` (the catch-up fires once per subscription, which the settle absorbs) and, for a Velocity, `entry.box.randomSeed.subscribe(request)`; all terminated on entry change and unmount. The run: build `RuleContext` from the live adapters as the audit page does (`range: renderRange(bpm)`), `chain = entries.map(e => ({ setting: settingsOf(e.box), enabled: e.enabled }))`, `prediction = predictChain(chain, context, pattern, bpm, MARK)`, `channel = await render(project, renderSeconds(bpm), rate)`, `read = readNotes(channel, rate).map(n => toFigure(n, rate, calibration.referencePeak, calibration.instrumentOffsetFrames))`, `readAt = (on, off) => readFigureAt(channel, rate, on, off, calibration)`, `rows = renderedRows(read, prediction, pattern, bpm, readAt)`; `setState` once at the end with `rows` and `renderMs`. Status maps from the scheduler's (`stale` keeps the previous `rows`). An error from the run → `status: "error"`, `error: message`, `rows` kept; `console.error("[midi-rendered] render failed: " + message)`.

- [ ] **Step 1: Write the failing tests** (jsdom, `vi.useFakeTimers()`, `renderHook` from `@testing-library/react`; `project` and `audioUnitBox` as minimal fakes is NOT possible for the adapter calls, so the tests pass `entries: []` and a `render` stub, and assert the scheduler wiring and state transitions; the adapter path is verified in the browser in Task 9):

```ts
it("is calibrating without a calibration and renders nothing", () => {});
it("a calibration error is the error state and never requests a render", () => { /* calibrationError: "read 31 notes, expected 32" → status "error", render stub never called even after 300 ms and a pattern change */ });
it("requests a render when the pattern changes and goes stale → rendering → idle with rows", async () => { /* render stub resolves a sineSample-built channel with one note; rows.notes.length === 1 after advancing 300 ms + flush */ });
it("keeps the previous rows while stale", async () => {});
it("reports a failed render and keeps the rows", async () => { /* render rejects → status "error", error "boom", rows unchanged */ });
it("a pattern change during a render leaves the rows stale until the follow-up lands", async () => {});
```

- [ ] **Step 2: Run** the test — expect FAIL.

- [ ] **Step 3: Implement** `useRenderedNotes.ts` and `calibrateRendered`.

- [ ] **Step 4: Run** `npx vitest run src/demos/midi` and `npm run typecheck` — expect PASS.

- [ ] **Step 5: Commit** `feat(midi-rendered): useRenderedNotes — calibration, parameter subscriptions, coalesced offline render and read`

---

### Task 9: The Rendered page

**Files:**
- Create: `midi-effects-rendered-demo.html` (copy `midi-effects-demo.html`; title `OpenDAW MIDI Effects: Rendered — what the engine emits, read back`; description: `A chain of stock MIDI effects on a pure sine, rendered offline and read back note by note: onset, end, pitch with cents and velocity, exactly as the engine emitted them.`; canonical/og URLs for `/midi-effects-rendered-demo.html`; `og:image` `/og-image-midi-effects-rendered.png`; script `/src/demos/midi/midi-effects-rendered-demo.tsx`)
- Create: `src/demos/midi/midi-effects-rendered-demo.tsx`
- Modify: `vite.config.ts:164-165` (add `midiEffectsRendered: resolve(__dirname, "midi-effects-rendered-demo.html")`)

**Interfaces:**
- Consumes: Tasks 1–8; `buildNanoProject`, `NanoProject` (bootstrap); `sineSample` (Reader); `ROOT_KEY`, `NANO_ATTACK_SECONDS`, `NANO_RELEASE_SECONDS`, `REGION_POSITION_PPQN`, `REGION_DURATION_PPQN` (Rows); `MidiChainSections`, `MidiEffectCard`, `useMidiChain`, `useTimelineLoop`; `PATTERNS`, `PATTERN_BPM`, `PATTERN_PPQN`, `BAR_PPQN`, `withGaps`, `writePattern`, `patternById`.
- Page constants: `RATE = 48000`; `SAMPLE_SECONDS = 20`; `GAP_RATIO = 0.9`; `DEFAULT_PATTERN: PatternId = "melody"`; `PITCH_LOW = 36`, `PITCH_HIGH = 96`, `LANE_HEIGHT = 112`, `STRIP_HEIGHT = 64`; `FACTORIES = EffectFactories.MidiNamed`.
- Boot (one effect, as the MIDI Effects page): `buildNanoProject({ localAudioBuffers, bpm: PATTERN_BPM, rate: RATE, sample: sineSample(RATE, SAMPLE_SECONDS, 440), fileName: "sine-440-20s.wav", rootKey: ROOT_KEY, attackSeconds: NANO_ATTACK_SECONDS, releaseSeconds: NANO_RELEASE_SECONDS, regionPositionPpqn: REGION_POSITION_PPQN, regionDurationPpqn: REGION_DURATION_PPQN, removeMaximizer: false, onStatus: setStatus })`; then `held = writePattern(project, regionBox, [], withGaps(patternById("sixteenths"), GAP_RATIO))`, `calibration = await calibrateRendered(project, PATTERN_BPM, RATE)` (a throw is caught into `calibrationError` state, passed to the hook, and shown in the rendered lane's caption; the page still reaches "Ready"), then `held = writePattern(project, regionBox, held, withGaps(patternById(DEFAULT_PATTERN), GAP_RATIO))`, `setBuilt`. `isPlaying` subscription as the MIDI Effects page.
- The rendered lane's caption, when `rows.notes` holds any `dashedEdges` note, appends: `dashed edges: the step boundaries come from the device rule; a gate under 1 makes them measured`.
- Layout, top to bottom: `GitHubCorner`, `BackLink`, header (kicker `MIDI 02 — Rendered · OpenDAW SDK`, title `Rendered`, intro: the chain on a pure sine, rendered offline after every change and read back; what you hear is what the reader reads; the live output carries the master limiter and the render does not; links to the overview and the MIDI Effects demo), error callouts, transport row (Play / Stop / `120 bpm · 2 bars · loop` / pattern `Select`), pattern blurb plus the sentence `Notes are shortened to 90 % of their written length so the reader finds the gap between them.`, three rows in a `Flex column gap 3`: `NoteLane` "As written" (`shadeByVelocity`, caption `the region's notes, colour by velocity`), `NoteLane` "As rendered" (ref; `notes={() => rows?.notes ?? []}`; caption per status: idle → `read back from an offline render of the chain: onset, end, pitch, cents, velocity · ${renderMs} ms`; stale/rendering → `rendering…`; error → the message; the overlap sentence when `rows.sentence` is non-null; the lane wrapped in a div at `opacity 0.5` while stale/rendering/calibrating), `VelocityStrip` "Velocity" (ghosts/stems from `rows`, same opacity rule, caption `ghost: written · solid: emitted`), then `MidiChainSections`, then the SDK reference section with three snippets: the render (`renderOfflineSlice(project, 0, renderSeconds(bpm), rate, { mutateCopy })`), the read (`readNotes` → `toFigure`), and the settle rule in prose.
- `useRenderedNotes({ project, audioUnitBox, entries, pattern: gappedPattern, bpm: PATTERN_BPM, rate: RATE, calibration })`; after every `state.rows` change call `renderedLane.current?.requestUpdate()` and `strip.current?.requestUpdate()`.
- Chain reconcile effect, `reseekIfPlaying` (to `REGION_START_PPQN`), `changePattern` (writes `withGaps(pattern, GAP_RATIO)`), `renderCard`, `position` (region-local): as the MIDI Effects page after Task 7.

- [ ] **Step 1: Create the HTML entry and the Vite input**; create the page; run `npm run typecheck` — 0 errors.

- [ ] **Step 2: Browser verification** on `https://localhost:5173/midi-effects-rendered-demo.html` (dev server already running; a REAL click on Play):
  - Boot reaches "Ready"; the rendered lane shows the Melody's 16 notes solid within a second or two, the strip shows 16 ghost+stem pairs of equal height.
  - Velocity tab, drag Random to 100 %: within a second the stems scatter and the bar colours change; click Reseed: they reshuffle. Drag Magnet strength to 100 %: stems level.
  - Pitch tab, cents +25: every bar carries `+25¢`.
  - Zeitgeist tab on Sixteenths: every other bar shifts right by about 1.5 % of the lane (47 pulses of 7680).
  - Chords, dry: no bars, the overlap sentence; add Arpeggio: bars appear; set Gate to 1: bars get dashed edges; Gate 2: the sentence again.
  - Arpeggio Velocity at −100 %: hollow "silent" outlines, no stems.
  - Console: no errors; one `[midi-rendered]` line per render is acceptable only at debug level (none required).
- [ ] **Step 3: Measure rendering while the transport plays**: play Sixteenths, drag Random back and forth for ten seconds; listen for a dropout; read `performance.now()` deltas of an `AnimationFrame.add` probe in the console or the page's own frame gap if it logs one. Record the result (a sentence with the longest frame gap) in the PR body. If a dropout is audible, implement the spec's fallback (defer the render to the next stop; stale caption `rendering after stop`) in `useRenderedNotes` with a test, and record that too.

- [ ] **Step 4: Commit** `feat(midi-rendered): the Rendered page — chain on a Nano sine, rendered offline after each change and read back as notes`

---

### Task 10: The overview page, the index card, the sitemap, the README and the sub-demo kickers

**Files:**
- Create: `midi-effects-demos.html` (title `OpenDAW MIDI Effects — three demos: hear them, see them exactly, write your own`; description from the spec's lead; `og:image` `/og-image-midi-effects-demos.png`; script `/src/demos/midi/midi-effects-overview.tsx`)
- Create: `src/demos/midi/midi-effects-overview.tsx`
- Modify: `vite.config.ts` (add `midiEffectsOverview: resolve(__dirname, "midi-effects-demos.html")`)
- Modify: `src/index.tsx:165-176` (replace the MIDI Effects and Spielwerk cards with one card `href: "/midi-effects-demos.html"`, `title: "MIDI Effects"`, blurb: `Three demos on the MIDI chain: hear Arpeggio, Pitch, Velocity and Zeitgeist on a synth, see exactly what the engine emits from them on a rendered sine (velocity and cents included), and write your own device in JavaScript with Spielwerk.`)
- Modify: `public/sitemap.xml:13-14` (add `midi-effects-demos.html` before and `midi-effects-rendered-demo.html` after the two existing entries)
- Modify: `README.md:22-23` (one row for the overview in place of the two, listing the three sub-demos as the warp row does; the source-tree listing gains `midi-effects-overview.tsx` and `midi-effects-rendered-demo.tsx` lines)
- Modify: `src/demos/midi/spielwerk-demo.tsx:226-234` (kicker `MIDI 03 — Spielwerk · OpenDAW SDK`; intro's last sentence links the overview as well as the MIDI Effects demo)

**Interfaces:**
- The overview is built like `warp-overview.tsx`: a `SCENARIOS`-style `const PAGES = [...] as const` with `index` ("01", "02", "03"), `chip` (`var(--mc-amber)`, `var(--mc-cyan)`, `var(--mc-violet)`), `name` (MIDI Effects, Rendered, Spielwerk), `direction` (one line: `HEAR IT ON A SYNTH`, `SEE IT EXACTLY`, `WRITE YOUR OWN`), two `dl` rows (`SEE` — what the page's lanes show; `CANNOT` — what it cannot), `prose`, `href`; the card markup copied from the warp overview (`mc-panel`, `mc-panel-head`, `mc-chip`, `mc-index`, `mc-name`, `mc-direction`, `mc-rows`, `mc-prose`, `mc-open`).
- Header: kicker `MIDI Effects — OpenDAW SDK`, title `WHAT GETS THROUGH<span className="mc-q">?</span>` (the builder may choose another two-to-four-word title in the same register), intro = the spec's conventions paragraph: notes are bars on a pitch grid; a bar's length is the note's duration; a bar's colour is its velocity, pale when soft and saturated when loud; a velocity strip under the roll shows one stem per note whose height is the velocity; openDAW's own note editor, Ableton, Logic and Cubase all do this; the pages here follow it where they can, and say where they cannot.
- After the cards, `mc-anchors` sections: "What the devices do", in sentences with the four facts and the two linked issues from the spec (`https://github.com/andremichelle/openDAW/issues/524`, `/525`), and "Sources" linking `documentation/16-midi.md` (as `/docs/16-midi.html` if the docs build serves it so; otherwise the GitHub blob URL) and the audit note's GitHub URL (`https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-midi-effect-semantics/note.md`).
- No `Lattice`-style diagram is required.

- [ ] **Step 1: Write the overview page, the HTML entry, the Vite input, the index card, the sitemap, the README rows, the Spielwerk kicker and intro.** Run `npm run typecheck` — 0 errors.

- [ ] **Step 2: Browser check**: `https://localhost:5173/midi-effects-demos.html` renders three cards whose Open links reach the three pages; the index shows one MIDI Effects card pointing at the overview; each sub-demo's intro links the overview.

- [ ] **Step 3: Commit** `feat(midi-effects): overview page with the piano-roll conventions and the three sub-demos; index, sitemap and README`

---

### Task 11: Open Graph images and the production build

**Files:**
- Create: `public/og-image-midi-effects-rendered.png`, `public/og-image-midi-effects-demos.png` (1200×630)

- [ ] **Step 1: Capture** each page at a 1200×630 viewport (Playwright MCP `browser_resize` 1200×630 then `browser_take_screenshot` without a filename; the file lands in `.playwright-mcp/`; for the Rendered page wait for the rows to show the Melody at Random 100 % so velocity is visible), move the files to `public/` under the names above.
- [ ] **Step 2: Run** `npm run build` — expect exit 0 with both new HTML entries in `dist/`.
- [ ] **Step 3: Commit** `feat(midi-effects): og images for the overview and the Rendered page`

---

### Task 12: Docs, housekeeping and the PR

**Files:**
- Modify: `src/demos/midi/CLAUDE.md` (a section "MIDI Effects Rendered page": the render-on-settle rule and why the seed needs its own subscription; the gapped patterns and the one abutting case left; the engine's deviation variant for marks; the live maximizer kept and removed on the copy; the 20 s sample and the pitch at which it runs out; the measurement result from Task 9 Step 3)
- Modify: `CLAUDE.md` only if a repo-wide rule changed (the `mutateCopy` option is worth one line under the offline-render notes)
- Delete: `docs/superpowers/specs/2026-11-03-midi-effects-demos-design.md`, `docs/superpowers/plans/2026-11-03-spielwerk-demo.md`, and this plan with its spec (`docs/superpowers/specs/2026-11-03-midi-effects-overview-and-rendered-page-design.md`, `docs/superpowers/plans/2026-11-03-midi-effects-overview-and-rendered-page.md`)

- [ ] **Step 1: Write the docs**, delete the four files, run `npm run typecheck && npm test && npm run build` — all exit 0.
- [ ] **Step 2: Commit** `docs(midi): the Rendered page's rules in CLAUDE.md; completed specs and plans removed`
- [ ] **Step 3: Push and open the PR** with `gh pr create` on `feat/midi-effects-overview-rendered` → `main`. Body: what the overview and the Rendered page are, the eight calls from the spec's hand-over list, the Task 9 measurement sentence, the housekeeping deletions, and the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Hand the user the merge command (`gh pr merge <n> --squash`); the merge is theirs.
- [ ] **Step 4: Run** `/pr-review-toolkit:review-pr` on the PR and fix Critical and Important findings on the branch; note the fixes in the PR body (not as comments).
