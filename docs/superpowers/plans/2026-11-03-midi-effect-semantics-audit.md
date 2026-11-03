# MIDI Effect Semantics Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standing offline sweep that renders the four stock MIDI effects across their parameter range, reads every row back as notes (when, which pitch, how loud, how long), and judges each row against the device's rule and against the register of the last accepted run, so an SDK upgrade reports a behaviour change and says whether it looks like a regression.

**Architecture:** Third PR after the MIDI Effects (#189) and Spielwerk (#190) demos. The page reuses the placement audit's bootstrap (extracted into `midiEffectBootstrap.ts`), the demo's patterns and `writePattern`, and the chain helpers. New: a pure monophonic reader over `Float32Array`s (gap-segmented onsets, interpolated zero-crossing pitch, attack-window peak velocity), pure rule functions per device with a registry of known engine deviations, a row table swept one parameter at a time (the Cartesian product only where the rule couples parameters), a two-axis verdict (rule × register), a JSON register under `debug/` written only by a person through the table script's `--accept`. The spec file is deleted in this PR.

**Tech Stack:** React 19, Radix Themes, OpenDAW SDK 0.0.180 (`EffectFactories.{Arpeggio,Pitch,Velocity,Zeitgeist}`, `InstrumentFactories.Nano`, `OfflineEngineRenderer` through `renderOfflineSlice`), vitest, Node ≥ 23 type stripping for the table script.

**Spec:** `docs/superpowers/specs/2026-11-03-midi-effect-semantics-audit-design.md`

## Global Constraints

- Branch `feat/midi-effect-semantics-audit` (already carries the design commit); PR base `main`; squash-merged.
- Offline render only through `renderOfflineSlice`; no live-transport rows; no Spielwerk rows; no change to the demo pages (`midi-effects-demo`, `spielwerk-demo`).
- Every rule is derived from the device crate and the adapter's mapping and cites `crate/file:line` (or `package/file:line`) in the register note; never fitted to a render. Where a rule needs the adapter's own function, call it: `VelocityDeviceBoxAdapter.computeVelocity` and `GrooveShuffleBoxAdapter.warp` (the TS `Random.create()` is the same Mulberry32 the crate seeds, `openDAW/packages/lib/std/src/random.ts:13`).
- Known engine deviations are register entries beside the rule, not part of it; the verdict names them.
- Instrument: a Nano sampler, a 4 s sine at 440 Hz as its sample, root key 69, attack and release 0.001 s, loop off; the master Maximizer removed after init (`Project.new` creates one when the studio preference `auto-create-output-maximizer` is true, its default: `openDAW/packages/studio/core/src/project/Project.ts:108`, `packages/studio/adapters/src/project/ProjectSkeleton.ts:66`).
- Every row renders bar 0 silent and the pattern from bar 1 (position 3840); the render is 3 bars plus 0.25 s.
- Tolerances: onset ±1 ms after the instrument offset is netted; pitch ±2 cents; velocity ±0.01; note end ±2 ms. The reader's own tested accuracy: pitch within 0.5 cents, velocity within 0.002, on synthetic tones.
- Verdict strings exactly: `as-registered`, `rule holds, unregistered`, `changed, rule holds`, `changed, rule broken`, `rule broken, unregistered`, `matches-known-deviation <names>` (with `, unregistered` / `changed, ` / `as-registered, ` qualifiers as Task 5 defines), `no rule`, `error`.
- Register JSON at `debug/2026-11-03-midi-effect-semantics/register/<rate>.json`, written only by `node scripts/audit/midi-effect-semantics/table.ts <runToken> --accept`; the page reads it over `fetch("/debug/2026-11-03-midi-effect-semantics/register/<rate>.json")` (Vite serves the repo root in dev) and treats a 404 as unregistered.
- Envelope `midisem-summary-<runToken>.json` through the dev server's `/__verify` sink.
- Page: `midi-effect-semantics-audit-debug-demo.html` (unlisted, `noindex, nofollow`, not in `src/index.tsx` or `public/sitemap.xml`); `#audit-state[data-audit-state]` walks `idle → setup → running:<row> → done | error:<message>`; a real click on Run.
- Every repo rule in CLAUDE.md: Option API (`isEmpty()` / `unwrap()`), adapter layer for effect fields (`midiEffectsFieldOf`), insert in one transaction and settings in the next, no value import of `@opendaw/studio-core` in anything tested in Node (the factory-key pattern), `npm run typecheck` exits 0 before every commit, tests in Node unless they need a DOM.
- Runs: both sample rates (48 000 then 44 100), the Mac's device rate noted in the register note (leave it at 44.1 kHz between sessions), edit only `.md` files while a run is on.
- Upstream style does not apply: this is repo code, comments saying why are welcome.

## Review Focus

1. A row whose rule predicts silence (Arpeggio velocity −1, Velocity offset −1 at mix 1, Pitch octaves +7 on every note) but which renders sound must read `rule broken` naming the extra notes, never `rule holds` on a trivially empty prediction: Task 5 test "a sounding render against a silent prediction is broken".
2. A row id the register has no entry for (a row added after the last accept) must read `unregistered`, not `changed`: Task 5 test "a missing register entry is unregistered".
3. A note at velocity 0.02 sits 17 dB above the onset threshold, not 40: the reader must still find its onset within 1 ms and read its velocity within 0.002: Task 2 test "a quiet note is read".
4. A predicted note that plays past the end of the 4 s sample at its playback rate would end early and read as a false duration finding: Task 4 test "every row's notes fit the sample" asserts `duration_s × 2^((pitch − 69)/12) ≤ 4` over every row and variant.
5. Accepting a run that contains an `error` row or a `rule broken` row would make the register agree with a broken rule: Task 8 test "accept refuses a run with an error or a broken row" (`--force` overrides, printed loudly).

---

### Task 1: Shared bootstrap for the Nano-based MIDI effect audits

**Files:**
- Create: `src/lib/audit/midiEffectBootstrap.ts`
- Create: `src/lib/audit/midiEffectBootstrap.test.ts`
- Modify: `src/lib/audit/midiEffectChain.ts` (add `removeMidiEffects`)
- Modify: `src/lib/audit/midiEffectChain.test.ts`
- Modify: `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx:103-166, 393-402` (use the shared bootstrap; rows unchanged)

**Interfaces:**
- Produces, in `midiEffectBootstrap.ts`:
  - `class RunAbort extends Error` (a failure that voids every later row).
  - `interface NanoProjectOptions { localAudioBuffers: Map<string, AudioBuffer>; bpm: number; rate: number; sample: Float32Array; fileName: string; rootKey: number; attackSeconds: number; releaseSeconds: number; regionPositionPpqn: number; regionDurationPpqn: number; removeMaximizer: boolean; onStatus: (s: string) => void }`
  - `interface NanoProject { project: Project; audioContext: AudioContext; audioUnitBox: AudioUnitBox; regionBox: NoteRegionBox; nanoBox: NanoDeviceBox }`
  - `async function buildNanoProject(options: NanoProjectOptions): Promise<NanoProject>` — `initializeOpenDAW({ localAudioBuffers, bpm, audioContextSampleRate: rate, onStatusUpdate })`, the stereo `AudioBuffer` from `sample`, then the two transactions the placement page does today (file box + `createInstrument(InstrumentFactories.Nano, { attachment })`; then the Nano fields, `loopArea.enabled` false, `createNoteRegion`), then `removeMasterMaximizer` when asked, then `awaitSampleLoaded`.
  - `function awaitSampleLoaded(project: Project, uuid: UUID.Bytes, deadlineMs?: number): Promise<void>` (moved verbatim from the placement page).
  - `function removeMasterMaximizer(editing: { modify(fn: () => void): unknown }, outputUnitBox: AudioUnitBox): number` — deletes every `MaximizerDeviceBox` on `outputUnitBox.audioEffects` in one transaction, returns the count.
  - `async function uploadSummary(fileName: string, body: unknown, deadlineMs?: number): Promise<void>` — the `PUT /__verify/<fileName>` with `withDeadline`, throwing on a non-OK status.
- Produces, in `midiEffectChain.ts`: `function removeMidiEffects(editing, boxes: readonly EffectBox[]): void` — one transaction per box in REVERSE array order; a throw names the box's label and leaves the earlier boxes removed.
- Consumed by the placement page now and the semantics page (Task 7).

- [ ] **Step 1: Write the failing tests**

`src/lib/audit/midiEffectBootstrap.test.ts` (Node, real box graph):

```ts
import { describe, expect, it } from "vitest";
import { BoxEditing } from "@opendaw/lib-box";
import { MaximizerDeviceBox, type AudioUnitBox } from "@opendaw/studio-boxes";
import { ProjectSkeleton } from "@opendaw/studio-adapters";
import { removeMasterMaximizer } from "./midiEffectBootstrap";

const outputUnitOf = (skeleton: ReturnType<typeof ProjectSkeleton.empty>): AudioUnitBox =>
  skeleton.mandatoryBoxes.rootBox.audioUnits.pointerHub.incoming().map((p) => p.box as AudioUnitBox)
    .find((box) => box.audioEffects.pointerHub.incoming().some((p) => p.box instanceof MaximizerDeviceBox))!;

describe("removeMasterMaximizer", () => {
  it("deletes the Master Maximizer the skeleton created and reports one", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: true, createDefaultUser: false });
    const unit = outputUnitOf(skeleton);
    expect(removeMasterMaximizer(new BoxEditing(skeleton.boxGraph), unit)).toBe(1);
    expect(unit.audioEffects.pointerHub.incoming().length).toBe(0);
  });
  it("reports zero on a master without one", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    const units = skeleton.mandatoryBoxes.rootBox.audioUnits.pointerHub.incoming().map((p) => p.box as AudioUnitBox);
    expect(removeMasterMaximizer(new BoxEditing(skeleton.boxGraph), units[0])).toBe(0);
  });
});
```

(If `mandatoryBoxes` names the output unit directly, use that name instead of the pointer-hub walk; check `node_modules/@opendaw/studio-adapters/dist/project/ProjectSkeleton.d.ts` first.)

Add to `src/lib/audit/midiEffectChain.test.ts`:

```ts
it("removeMidiEffects removes in reverse order and names a box that cannot go", () => {
  // two devices on one unit via midiEffectFixture-style creation (Pitch at index 0, Velocity at index 1)
  removeMidiEffects(editing, [pitchBox, velocityBox]);
  expect(unit.midiEffects.pointerHub.incoming().length).toBe(0);
  expect(() => removeMidiEffects(editing, [pitchBox])).toThrow(/Pitch/); // a detached box: isAttached() false
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectBootstrap.test.ts src/lib/audit/midiEffectChain.test.ts`
Expected: FAIL with "does not provide an export named removeMasterMaximizer" / "removeMidiEffects".

- [ ] **Step 3: Implement `midiEffectBootstrap.ts` and `removeMidiEffects`**

Move `awaitSampleLoaded`, `RunAbort` and the project-building transactions out of the placement page into `buildNanoProject`; the page's `burstSample` becomes the `sample` argument and `NOTE_PITCH` its `rootKey`. `removeMasterMaximizer` resolves the boxes through `outputUnitBox.audioEffects.pointerHub.incoming()` and calls `box.delete()` on each `MaximizerDeviceBox`. `removeMidiEffects` loops `[...boxes].reverse()` and wraps each `removeMidiEffect` in a try that rethrows `new Error(\`${box.label.getValue()} could not be removed: ${cause}\`)`. The bootstrap file imports `Project` and `InstrumentFactories` as values; it is page-only code, never imported by a Node test except for `removeMasterMaximizer`, so keep `removeMasterMaximizer` free of `@opendaw/studio-core` value imports (import `type Project` only; `InstrumentFactories` comes from `@opendaw/studio-adapters`, which Node loads).

- [ ] **Step 4: Refactor the placement page onto the bootstrap**

Replace `buildProject`'s body with `buildNanoProject({ ..., sample: burstSample(RATE, SAMPLE_MS), fileName: "burst.wav", rootKey: NOTE_PITCH, attackSeconds: NANO_ATTACK_SECONDS, releaseSeconds: NANO_RELEASE_SECONDS, regionPositionPpqn: REGION_POSITION_PPQN, regionDurationPpqn: REGION_DURATION_PPQN, removeMaximizer: false, onStatus })`, keeping `importShortRecording` on the page; replace the summary `fetch` with `uploadSummary(summaryFileName(runToken), summary)`. `removeMaximizer: false` keeps the placement rows byte-identical to the register.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/lib/audit && npm run typecheck`
Expected: all PASS, typecheck exit 0.

- [ ] **Step 6: Re-verify the placement audit in the browser**

Start the dev server (reuse a running one), open `https://localhost:5173/midi-effect-placement-audit-debug-demo.html?device=all`, a REAL click on "Run audit", wait for `#audit-state` = `done`, then `node scripts/audit/midi-effect-placement/table.ts` — every row `as-predicted`, instrument offset 12–13 frames, as the register lists.

- [ ] **Step 7: Commit**

```bash
git add src/lib/audit/midiEffectBootstrap.ts src/lib/audit/midiEffectBootstrap.test.ts src/lib/audit/midiEffectChain.ts src/lib/audit/midiEffectChain.test.ts src/demos/midi/midi-effect-placement-audit-debug-demo.tsx
git commit -m "refactor(audit): shared Nano bootstrap for the MIDI effect audits; master Maximizer removal; reverse-order chain removal"
```

---

### Task 2: The monophonic reader

**Files:**
- Create: `src/lib/audit/midiEffectSemanticsReader.ts`
- Create: `src/lib/audit/midiEffectSemanticsReader.test.ts`

**Interfaces:**
- Produces:
  - `function sineSample(rate: number, seconds: number, hz: number): Float32Array` — one channel, unit amplitude, phase 0.
  - `interface ReaderOptions { onsetThreshold: number; gapMs: number; attackMs: number; minCycles: number }` and `const READER_DEFAULTS: ReaderOptions = { onsetThreshold: 0.002, gapMs: 5, attackMs: 1, minCycles: 3 }`.
  - `interface ReadNote { onsetFrame: number; endFrame: number; peak: number; frequencyHz: number | null; jitterCents: number | null; cycles: number }`
  - `function readNotes(samples: Float32Array, rate: number, options?: ReaderOptions): ReadNote[]` — an onset is the first frame with `|x| > onsetThreshold` after at least `gapMs` of frames at or below it (or from the start); the note ends at the last frame above the threshold before the next such gap. `peak` is the largest `|x|` in `[onset + attackFrames, onset + attackFrames + oneCycleFrames + attackFrames]` where one cycle is derived from the first pitch pass (fall back to the whole note when the pitch is null). `frequencyHz` is the mean period of rising zero crossings, each crossing instant linearly interpolated between the two straddling samples, over `[onset + 2 × attackFrames, end − attackFrames]`; null when fewer than `minCycles + 1` crossings fit. `jitterCents = 1200 × log2(maxPeriod / minPeriod)` over those cycles. `cycles` is the crossing count minus one.
  - `function frequencyToPitch(hz: number): { pitch: number; cents: number }` — nearest MIDI pitch at A4 = 440 and the residual in cents (−50..50).
  - `interface NoteFigure { onsetMs: number; endMs: number; pitch: number | null; cents: number | null; velocity: number; jitterCents: number | null }`
  - `function toFigure(note: ReadNote, rate: number, referencePeak: number, instrumentOffsetFrames: number): NoteFigure` — `onsetMs` and `endMs` net the instrument offset; `velocity = peak / referencePeak`; rounding to the register's resolution happens in Task 6, not here.
- Reference approach: the SDK's own base-frequency test counts rising zero crossings over a steady segment (`openDAW/packages/studio/core-wasm/test/base-frequency.test.ts:18`, AGPL, the approach only); this reader interpolates each crossing instant so the ±2 cent judgement has margin.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { frequencyToPitch, readNotes, sineSample, toFigure, READER_DEFAULTS } from "./midiEffectSemanticsReader";

const RATE = 48000;
const hzOf = (pitch: number, cents = 0) => 440 * 2 ** ((pitch - 69 + cents / 100) / 12);
/** A Nano-shaped note: a sine at `hz`, amplitude `level`, a 1 ms squared attack, a 1 ms squared release, `ms` long, at `atMs`. */
function tone(out: Float32Array, atMs: number, ms: number, hz: number, level: number): void { /* env² × sin, as device-nano/src/voice.rs:129 */ }

describe("readNotes", () => {
  it("finds each note once with its onset, end and peak", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 60, hzOf(60), 0.7); tone(out, 300, 60, hzOf(64), 0.7); tone(out, 500, 60, hzOf(67), 0.35);
    const notes = readNotes(out, RATE);
    expect(notes.length).toBe(3);
    expect(notes[0].onsetFrame).toBeGreaterThanOrEqual(4800);
    expect(notes[0].onsetFrame).toBeLessThan(4800 + 48);           // within the 1 ms attack
    expect(notes[0].endFrame).toBeGreaterThan(4800 + Math.round(0.06 * RATE) - 48);
    expect(notes[2].peak / notes[0].peak).toBeCloseTo(0.5, 2);
  });
  it("reads pitch within 0.5 cents at 65 Hz, 261.6 Hz and 4186 Hz, with cents", () => {
    for (const [pitch, cents] of [[36, 0], [60, 12.5], [108, -50]] as const) {
      const out = new Float32Array(RATE);
      tone(out, 100, 200, hzOf(pitch, cents), 0.7);
      const [note] = readNotes(out, RATE);
      const read = frequencyToPitch(note.frequencyHz!);
      expect(read.pitch).toBe(pitch);
      expect(Math.abs(read.cents - cents)).toBeLessThan(0.5);
      expect(note.jitterCents!).toBeLessThan(1);
    }
  });
  it("a quiet note is read: velocity 0.02 lands within 0.002 and its onset within 1 ms", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 60, hzOf(60), 0.7); tone(out, 300, 60, hzOf(60), 0.7 * 0.02);
    const notes = readNotes(out, RATE);
    expect(notes.length).toBe(2);
    expect(Math.abs(notes[1].peak / notes[0].peak - 0.02)).toBeLessThan(0.002);
    expect(Math.abs(notes[1].onsetFrame - 0.3 * RATE)).toBeLessThan(48);
  });
  it("two overlapping pitches read as one unstable note, a note too short for three cycles has no pitch", () => {
    const out = new Float32Array(RATE);
    tone(out, 100, 100, hzOf(60), 0.5); tone(out, 150, 100, hzOf(64), 0.5);
    const [note] = readNotes(out, RATE);
    expect(note.jitterCents!).toBeGreaterThan(10);
    const short = new Float32Array(RATE);
    tone(short, 100, 8, hzOf(36), 0.7);                              // 36.7 ms per three cycles at 65 Hz
    expect(readNotes(short, RATE)[0].frequencyHz).toBeNull();
  });
  it("returns nothing for silence and does not split a sine at its zero crossings", () => {
    expect(readNotes(new Float32Array(RATE), RATE)).toEqual([]);
    const out = new Float32Array(RATE); tone(out, 100, 500, hzOf(36), 0.7);
    expect(readNotes(out, RATE, { ...READER_DEFAULTS, gapMs: 5 }).length).toBe(1);
  });
});

describe("sineSample / frequencyToPitch / toFigure", () => {
  it("sineSample is unit amplitude at the asked frequency", () => {
    const s = sineSample(RATE, 1, 440);
    expect(s.length).toBe(RATE);
    expect(frequencyToPitch(readNotes(s, RATE)[0].frequencyHz!).pitch).toBe(69);
  });
  it("frequencyToPitch maps 440 to 69/0 and 452.9 to 69/+50", () => {
    expect(frequencyToPitch(440)).toEqual({ pitch: 69, cents: 0 });
    expect(frequencyToPitch(440 * 2 ** (0.5 / 12)).cents).toBeCloseTo(50, 3);
  });
  it("toFigure nets the instrument offset and normalises the peak", () => {
    const figure = toFigure({ onsetFrame: 4812, endFrame: 7692, peak: 0.35, frequencyHz: 261.6, jitterCents: 0.1, cycles: 10 }, RATE, 0.7, 12);
    expect(figure.onsetMs).toBeCloseTo(100, 3);
    expect(figure.velocity).toBeCloseTo(0.5, 6);
    expect(figure.pitch).toBe(60);
  });
});
```

The `gapMs: 5` case at 65 Hz: half a cycle is 7.7 ms of `|x|` near zero only for the frames where the sine itself is tiny; at `onsetThreshold` 0.002 and amplitude 0.7 that is under 0.02 ms per crossing, far under the gap. The test pins it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsReader.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the reader**

Pure functions over `Float32Array`, no SDK imports. The segmentation loop tracks `lastLoud` and opens a note when `i − lastLoud > gapFrames`; the pitch pass collects crossing instants `i − 1 + x[i−1] / (x[i−1] − x[i])` for each `x[i−1] < 0 ≤ x[i]` inside the window.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsReader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsReader.ts src/lib/audit/midiEffectSemanticsReader.test.ts
git commit -m "feat(audit): monophonic note reader for the MIDI effect semantics audit"
```

---

### Task 3: The rules, readability and the deviation registry

**Files:**
- Create: `src/lib/audit/midiEffectSemanticsRules.ts`
- Create: `src/lib/audit/midiEffectSemanticsRules.test.ts`

**Interfaces:**
- Produces:
  - `interface RuleNote { position: number; duration: number; pitch: number; cent: number; velocity: number }` — absolute pulses; the shape of `EventRecord`'s note-on (`openDAW/crates/abi/src/lib.rs:39-51`).
  - `type DeviationName = "arpeggio-velocity-matrix" | "arpeggio-drops-cent" | "arpeggio-uncapped-note-off" | "zeitgeist-warps-note-off"`
  - `interface Deviation { name: DeviationName; device: SemanticsDevice; sentence: string; source: string }` and `const DEVIATIONS: readonly Deviation[]` with these four entries and sources: `device-arpeggio/src/lib.rs:103-116` (`set_velocity_matrix`), `:254` (`cent: 0.0` on the emitted note-on), `:250-259` (`complete = position + duration`, never the source end), `device-zeitgeist/src/lib.rs:128-141` (`process` warps every record).
  - `type SemanticsDevice = "arpeggio" | "pitch" | "velocity" | "zeitgeist"`
  - `interface ArpeggioSettings { modeIndex: 0 | 1 | 2; numOctaves: number; rateIndex: number; gate: number; repeat: number; velocity: number }`, `interface PitchSettings { semiTones: number; cents: number; octaves: number }`, `interface VelocitySettings { magnetPosition: number; magnetStrength: number; randomAmount: number; offset: number; mix: number }` (seed stays the box default 0x800), `interface ZeitgeistSettings { amount: number; duration: number }`.
  - `type DeviceSetting = { device: "arpeggio"; settings: ArpeggioSettings } | { device: "pitch"; settings: PitchSettings } | { device: "velocity"; settings: VelocitySettings } | { device: "zeitgeist"; settings: ZeitgeistSettings }`
  - `const ARPEGGIO_RATE_PPQN: readonly number[]` — the 17 entries `floor(3840 / d) × n` of `ArpeggioDeviceBoxAdapter.RateFractions` (`device-arpeggio/src/lib.rs:36-47`): `[3840, 1920, 1280, 960, 720, 640, 480, 360, 320, 240, 180, 160, 120, 80, 60, 40, 30]`.
  - `function arpeggioIntentVelocity(v: number, vel: number): number` = `v >= 0 ? vel + (1 - vel) * v : vel * (1 + v)`; `function arpeggioMatrixVelocity(v: number, vel: number): number` = `v <= 0 ? 1 + v : vel * v + (1 - v)` (the crate).
  - `function arpeggioRule(notes: readonly RuleNote[], settings: ArpeggioSettings, deviations: ReadonlySet<DeviationName>, range: { from: number; to: number }): RuleNote[]` — for every grid index `k` with `k × rate` in `[range.from, range.to)`: the stack is every note with `start ≤ p < end`, sorted by `(start, pitch)`; empty stack emits nothing; `stepIndex = floor(k / repeat)`; `(pitch, octave)` from the mode walk ported from `mode_run` (`device-arpeggio/src/lib.rs:122-152`): Up `local = step % count, octave = (step % (count × octaves)) / count`; Down `local = count − 1 − step % count, octave = octaves − 1 − (step % (count × octaves)) / count`; UpDown `len = max(1, 2 × count × octaves − 2), seq = step % len, proc = seq < count × octaves ? seq : len − seq, local = proc % count, octave = proc / count` (integer divisions); emitted pitch `stack[local].pitch + 12 × octave`; step length `max(1, floor(rate × max(gate, 0)))`; duration = that length, capped at `sourceNote.end − p` unless `arpeggio-uncapped-note-off`; velocity = `arpeggioIntentVelocity` unless `arpeggio-velocity-matrix` → `arpeggioMatrixVelocity`; cent = the source note's unless `arpeggio-drops-cent` → 0.
  - `function pitchRule(notes, settings: PitchSettings): RuleNote[]` — `pitch + octaves × 12 + semiTones`, `cent + cents`; a result outside 0..127 is dropped (`device-pitch/src/lib.rs:8-11`, the crate's documented contract; TS passed the raw value, noted in the register, no deviation entry).
  - `function velocityRule(notes, computeVelocity: (position: number, original: number) => number): RuleNote[]` — velocity replaced by `computeVelocity(position, velocity)` with the ABSOLUTE position (what the sequencer hands the chain).
  - `function zeitgeistRule(notes, groove: { warp(p: number): number }, deviations): RuleNote[]` — position → `warp(position)`; duration unchanged, unless `zeitgeist-warps-note-off` → `warp(position + duration) − warp(position)`.
  - `function composeRules(chain: readonly DeviceSetting[], context: RuleContext, deviations: ReadonlySet<DeviationName>, notes: readonly RuleNote[]): RuleNote[]` — applies index 0 first (the engine folds the chain so the highest index is nearest the instrument, `openDAW/crates/engine/src/audio_unit/wiring.rs:1061-1066`); `interface RuleContext { range: { from: number; to: number }; computeVelocity: (position: number, original: number) => number; warp: (position: number) => number }`.
  - `const RULE_SENTENCES: Record<SemanticsDevice, string>` — one sentence per device, the rule as the register states it (printed beside a broken verdict).
  - `type Readability = "readable" | "overlap" | "polyphonic" | "too-short" | "too-quiet"`; `interface PredictedNote extends RuleNote { readability: Readability }`; `interface PredictedFigure { onsetMs: number; endMs: number; pitch: number; cents: number; velocity: number; readability: Readability }`; `function toPredictedFigures(notes: readonly PredictedNote[], bpm: number): PredictedFigure[]` (`PPQN.pulsesToSeconds`; the only place pulses become ms, so the verdict module stays SDK-free for the table script); `function markReadability(notes: readonly RuleNote[], bpm: number, options: { attackMs: number; releaseMs: number; minCycles: number; minVelocity: number }): PredictedNote[]` — audible span `[pos, pos + duration]` in ms plus `releaseMs`; two spans that intersect: same pitch → both `overlap`, different pitches → both `polyphonic`; a span shorter than `attackMs × 2 + minCycles × 1000 / hz(pitch, cent)` → `too-short`; velocity below `minVelocity` (0.01) → `too-quiet`; precedence in that order. Sorted by position, then pitch.
  - `const DEVIATION_SUBSETS: (applicable: readonly DeviationName[]) => ReadonlySet<DeviationName>[]` — every subset ordered by size then name, the empty set first.

- [ ] **Step 1: Write the failing tests**

Hand-computed expectations only; no render in the loop. Cases (each an `it`):

```ts
describe("arpeggioRule", () => {
  const held = (pitches: number[], from = 3840, duration = 1750, velocity = 0.8): RuleNote[] =>
    pitches.map((pitch) => ({ position: from, duration, pitch, cent: 0, velocity }));
  const base: ArpeggioSettings = { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1 };
  const range = { from: 3840, to: 3840 + 7680 };
  it("walks a triad up over two octaves on the absolute 1/16 grid, steps 120 pulses long", () => {
    const out = arpeggioRule(held([67, 60, 64]), { ...base, numOctaves: 2 }, new Set(), range);
    expect(out.map((n) => n.pitch).slice(0, 7)).toEqual([60, 64, 67, 72, 76, 79, 60]);
    expect(out.map((n) => n.position).slice(0, 3)).toEqual([3840, 4080, 4320]);
    expect(out[0].duration).toBe(120);
  });
  it("Down and UpDown walk as the crate's mode_run does", () => {
    expect(arpeggioRule(held([60, 64, 67]), { ...base, modeIndex: 1, numOctaves: 2 }, new Set(), range).map((n) => n.pitch).slice(0, 6)).toEqual([79, 76, 72, 67, 64, 60]);
    expect(arpeggioRule(held([60, 64, 67]), { ...base, modeIndex: 2 }, new Set(), range).map((n) => n.pitch).slice(0, 5)).toEqual([60, 64, 67, 64, 60]);
    expect(arpeggioRule(held([60]), { ...base, modeIndex: 2 }, new Set(), range).map((n) => n.pitch).slice(0, 3)).toEqual([60, 60, 60]);
  });
  it("a dotted rate starts on the absolute grid, not the note start (3/16 = 720: first step at 4320)", () => {
    expect(arpeggioRule(held([60]), { ...base, rateIndex: 4 }, new Set(), range)[0].position).toBe(4320);
  });
  it("repeat divides the absolute grid index", () => {
    const out = arpeggioRule(held([60, 64]), { ...base, repeat: 2 }, new Set(), range);
    expect(out.map((n) => n.pitch).slice(0, 4)).toEqual([60, 60, 64, 64]);
  });
  it("caps the last step at the source end under the intent and not under the deviation", () => {
    const intent = arpeggioRule(held([60]), base, new Set(), range);
    const last = intent[intent.length - 1];
    expect(last.position).toBe(3840 + 1680);
    expect(last.duration).toBe(70);
    const dev = arpeggioRule(held([60]), base, new Set(["arpeggio-uncapped-note-off"]), range);
    expect(dev[dev.length - 1].duration).toBe(120);
  });
  it("velocity: intent passes the note at 0, the matrix emits 1.0; both agree at 1 and at -1", () => {
    expect(arpeggioIntentVelocity(0, 0.8)).toBe(0.8);
    expect(arpeggioMatrixVelocity(0, 0.8)).toBe(1);
    expect(arpeggioIntentVelocity(1, 0.8)).toBe(1);   // magnet fully toward 1.0
    expect(arpeggioMatrixVelocity(1, 0.8)).toBeCloseTo(0.8, 6);
    expect(arpeggioIntentVelocity(-1, 0.8)).toBe(0);
    expect(arpeggioMatrixVelocity(-1, 0.8)).toBe(0);
    expect(arpeggioIntentVelocity(0.5, 0.8)).toBeCloseTo(0.9, 6);
    expect(arpeggioMatrixVelocity(0.5, 0.8)).toBeCloseTo(0.9, 6);
  });
  it("keeps the source cent unless the deviation drops it", () => {
    const notes = [{ position: 3840, duration: 1750, pitch: 60, cent: 12.5, velocity: 1 }];
    expect(arpeggioRule(notes, base, new Set(), range)[0].cent).toBe(12.5);
    expect(arpeggioRule(notes, base, new Set(["arpeggio-drops-cent"]), range)[0].cent).toBe(0);
  });
  it("emits nothing while no note is held and a stack of one at gate 2 lasts 480", () => {
    expect(arpeggioRule([], base, new Set(), range)).toEqual([]);
    expect(arpeggioRule(held([60], 3840, 7680), { ...base, gate: 2 }, new Set(), range)[0].duration).toBe(480);
  });
});

describe("pitchRule", () => {
  it("shifts by octaves × 12 + semitones and adds cents; drops an out-of-range result", () => {
    const out = pitchRule([{ position: 0, duration: 1, pitch: 60, cent: 0, velocity: 1 }, { position: 1, duration: 1, pitch: 120, cent: 0, velocity: 1 }], { semiTones: 7, cents: 12.5, octaves: 1 });
    expect(out).toEqual([{ position: 0, duration: 1, pitch: 79, cent: 12.5, velocity: 1 }]);
  });
});

describe("velocityRule", () => {
  it("calls the adapter's computeVelocity with the absolute position and matches it exactly", () => {
    const { adapter, boxGraph, box } = midiEffectFixture("velocity");  // VelocityDeviceBoxAdapter
    transact(boxGraph, () => { box.magnetStrength.setValue(1); box.magnetPosition.setValue(0.25); box.randomAmount.setValue(0.5); });
    const out = velocityRule([{ position: 4080, duration: 120, pitch: 60, cent: 0, velocity: 0.6 }], (p, v) => adapter.computeVelocity(p, v));
    expect(out[0].velocity).toBe(adapter.computeVelocity(4080, 0.6));
    expect(out[0].velocity).not.toBe(adapter.computeVelocity(4081, 0.6)); // the per-note seed is the position
  });
});

describe("zeitgeistRule", () => {
  it("moves the off-beat to the eased midpoint, keeps the duration under the intent and warps the off under the deviation", () => {
    const groove = grooveAdapter(0.75, 480);                            // graphWithZeitgeist + GrooveShuffleBoxAdapter
    const [note] = zeitgeistRule([{ position: 4080, duration: 120, pitch: 60, cent: 0, velocity: 1 }], groove, new Set());
    expect(note.position).toBeCloseTo(3840 + 357.6, 0);
    expect(note.duration).toBe(120);
    const [dev] = zeitgeistRule([{ position: 4080, duration: 120, pitch: 60, cent: 0, velocity: 1 }], groove, new Set(["zeitgeist-warps-note-off"]));
    expect(dev.duration).toBeCloseTo(groove.warp(4200) - groove.warp(4080), 9);
  });
});

describe("composeRules", () => {
  it("applies index 0 first: Pitch then Arpeggio walks the shifted stack; Arpeggio then Pitch shifts the walk — equal pitches, cents differ under the cent deviation", () => { /* assert out pitches equal, cents 12.5 vs 0 with the deviation on */ });
});

describe("markReadability", () => {
  it("marks same-pitch intersections overlap, different-pitch polyphonic, a 2 ms note too-short, velocity 0.005 too-quiet, the rest readable", () => { /* four notes, one each, bpm 120 */ });
  it("the 1 ms release makes abutting steps overlap: Arpeggio gate 1 is unreadable, gate 0.5 readable", () => { /* two steps 240 apart, durations 240 vs 120 */ });
});

describe("DEVIATION_SUBSETS", () => {
  it("lists the empty set first, then singletons, then pairs", () => {
    expect(DEVIATION_SUBSETS(["arpeggio-drops-cent", "arpeggio-velocity-matrix"]).map((s) => [...s].sort().join("+"))).toEqual(["", "arpeggio-drops-cent", "arpeggio-velocity-matrix", "arpeggio-drops-cent+arpeggio-velocity-matrix"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRules.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the rules**

Pure functions; the only SDK import is `PPQN` from `@opendaw/lib-dsp` for the ms conversion in `markReadability` (`PPQN.pulsesToSeconds`). The Zeitgeist position stays a float, as the placement rule does. Every function cites its crate line in a one-line comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsRules.ts src/lib/audit/midiEffectSemanticsRules.test.ts
git commit -m "feat(audit): device rules, readability marking and the known-deviation registry for the semantics audit"
```

---

### Task 4: The rows

**Files:**
- Create: `src/lib/audit/midiEffectSemanticsRows.ts`
- Create: `src/lib/audit/midiEffectSemanticsRows.test.ts`

**Interfaces:**
- Consumes: `Pattern`, `PATTERN_BPM`, `BAR_PPQN`, `PATTERN_PPQN`, `patternById` from `@/lib/midiEffects/patterns`; `DeviceSetting`, `ArpeggioSettings`… from Task 3.
- Produces:
  - Constants: `REGION_POSITION_PPQN = BAR_PPQN` (3840), `REGION_DURATION_PPQN = PATTERN_PPQN` (7680), `RENDER_TAIL_SECONDS = 0.25`, `SAMPLE_SECONDS = 4`, `SAMPLE_HZ = 440`, `ROOT_KEY = 69`, `NANO_ATTACK_SECONDS = 0.001`, `NANO_RELEASE_SECONDS = 0.001`, `HELD_NOTE_PPQN = 1750`, `ONSET_TOLERANCE_MS = 1`, `CENTS_TOLERANCE = 2`, `VELOCITY_TOLERANCE = 0.01`, `END_TOLERANCE_MS = 2`, `UNSTABLE_JITTER_CENTS = 10`.
  - Audit patterns as `Pattern` objects: `HELD_NOTE` (`held-note`: pitch 60, velocity 1, position 0, duration 1750), `HELD_CHORD` (`held-chord`: 60/64/67, velocity 0.8, duration 1750), `CHROMATIC` (`chromatic`: twelve sixteenths 60..71 each held a thirty-second at velocity 1); `AUDIT_PATTERNS: readonly Pattern[]` = those three plus the demo's `chords`, `sixteenths`, `melody`; `type SemanticsPatternId = "held-note" | "held-chord" | "chromatic" | "chords" | "sixteenths" | "melody"`.
  - `type RowGroup = "dry" | "arpeggio" | "pitch" | "velocity" | "zeitgeist" | "order" | "disabled"`
  - `interface SemanticsRow { id: string; label: string; group: RowGroup; pattern: SemanticsPatternId; chain: readonly { setting: DeviceSetting; enabled: boolean }[]; quick: boolean }` — `chain` in index order; `[]` for a dry row.
  - `const ARPEGGIO_BASE: ArpeggioSettings = { modeIndex: 0, numOctaves: 1, rateIndex: 9, gate: 0.5, repeat: 1, velocity: 1 }`, `PITCH_BASE = { semiTones: 0, cents: 0, octaves: 0 }`, `VELOCITY_BASE = { magnetPosition: 0.5, magnetStrength: 0, randomAmount: 0, offset: 0, mix: 1 }`, `ZEITGEIST_BASE = { amount: 0.6, duration: 480 }`.
  - `const SEMANTICS_ROWS: readonly SemanticsRow[]` built by generators, in this order and with these id schemes:
    - dry: `dry-sixteenths` FIRST (the reference), `dry-melody`, `dry-chromatic`, `dry-held-note`.
    - arpeggio, base settings unless named: `arp-mode<0|1|2>-oct<1..5>-held-chord` (15) and `…-chords` (15); `arp-oct<1..5>-held-note` (5); `arp-rate<i>-gate<g>-held-note` for `i ∈ {3, 6, 9, 12, 14, 2, 8, 4, 7}` (1/4, 1/8, 1/16, 1/32, 1/64, 1/3, 1/12, 3/16, 3/32) × `g ∈ {0.25, 0.5, 1, 2}` (36); `arp-repeat<1|2|4|16>-held-chord` (4); `arp-vel<-1|-0.5|0|0.5|1>-held-chord` and `…-held-note` (10). Rates 1/48 and finer are left out: a step at gate 0.5 is under the reader's floor at pitch 60 (the register says so).
    - pitch, on `chromatic` and on `melody`: `pitch-st<-36|-12|-7|0|7|12|36>-<pattern>`, `pitch-oct<-7|-3|-1|0|1|3|7>-<pattern>`, `pitch-ct<-50|-12.5|0|12.5|50>-<pattern>`, plus `pitch-combined-<pattern>` (st 7, oct 1, ct 12.5) (40).
    - velocity, on `sixteenths` and on `melody`: `vel-magnet<p>x<s>-<pattern>` for p, s ∈ {0, 0.5, 1} (9 per pattern, coupled); `vel-random<0|0.5|1>-<pattern>` at magnet strength 0; `vel-offset<-1|-0.5|0|0.5>-<pattern>`; `vel-mix<0|0.5|1>-<pattern>` at magnet position 1 strength 1 (38).
    - zeitgeist: `zg-amount<a>-dur<d>-sixteenths` for a ∈ {0, 0.25, 0.5, 0.75, 1} × every DISTINCT value of `GrooveShuffleBoxAdapter.DurationPPQNs` (8; the list holds 960 twice, noted) (40); `zg-amount<a>-dur<480|3840>-melody` (10).
    - order, on `chords`, each device at one non-identity setting (Arpeggio base; Zeitgeist amount 0.75 duration 480; Pitch st 7 ct 12.5; Velocity magnet 1×1): `order-arpeggio-zeitgeist`, `order-zeitgeist-arpeggio`, `order-pitch-arpeggio`, `order-arpeggio-pitch`, `order-velocity-arpeggio`, `order-arpeggio-velocity`.
    - disabled, on `sixteenths`, the same non-identity settings with `enabled: false`: `disabled-<device>`.
    - `quick: true` on: the four dry rows; `arp-mode<m>-oct<1|3>-held-chord`; `arp-rate6-gate0.5-held-note`, `arp-rate12-gate0.5-held-note`; `arp-repeat2-held-chord`; `arp-vel0-held-chord`, `arp-vel0.5-held-chord`; `pitch-st7-chromatic`, `pitch-oct1-chromatic`, `pitch-ct12.5-chromatic`, `pitch-oct7-chromatic`; `vel-magnet1x1-sixteenths`, `vel-random0.5-sixteenths`, `vel-offset-1-sixteenths`, `vel-magnet1x1-melody`; `zg-amount0.25-dur480-sixteenths`, `zg-amount0.75-dur480-sixteenths`, `zg-amount0.75-dur3840-sixteenths`, `zg-amount1-dur480-sixteenths`; every order and disabled row.
  - `interface RowParams { device: string | null; pattern: string | null; rows: string | null }`; `function resolveRows(params: RowParams): SemanticsRow[]` — `?rows=all|quick|<id,id,…>` (unknown id → throw), `?device=all|arpeggio|pitch|velocity|zeitgeist|order|disabled` filters by group, `?pattern=` by pattern id; the dry rows are always kept and `dry-sixteenths` is always first.
  - `function renderSeconds(bpm: number): number` = `PPQN.pulsesToSeconds(REGION_POSITION_PPQN + REGION_DURATION_PPQN, bpm) + RENDER_TAIL_SECONDS`.
  - `function rowNotes(row: SemanticsRow): RuleNote[]` — the pattern's notes made absolute (`position + REGION_POSITION_PPQN`).
  - `function predictedVariants(row: SemanticsRow, context: RuleContext): { deviations: ReadonlySet<DeviationName>; notes: RuleNote[] }[]` — `composeRules` over the ENABLED devices of the chain for every subset of the deviations applicable to those devices; a disabled device is skipped (`wiring.rs:1063`).
  - `function applySettings(box: EffectBox, setting: DeviceSetting): void` — writes the raw box fields (`modeIndex`, `numOctaves`, `rateIndex`, `gate`, `repeat`, `velocity`; `semiTones`, `cents`, `octaves`; `magnetPosition`, `magnetStrength`, `randomAmount`, `offset`, `mix`; the groove box's `amount`, `duration` via `zeitgeistGrooveBox`). Called inside a transaction by the page. Imports box CLASSES from `@opendaw/studio-boxes` (Node loads them; the test imports this file).
  - `const FACTORY_KEYS: Record<SemanticsDevice, "Arpeggio" | "Pitch" | "Velocity" | "Zeitgeist">`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("SEMANTICS_ROWS", () => {
  it("has unique ids, dry-sixteenths first, every group present, between 180 and 320 rows", () => { /* Set size === length; [0].id; groups; length bounds */ });
  it("the quick subset has 30 to 60 rows and every order and disabled row", () => {});
  it("every row's notes fit the sample: duration_s × 2^((pitch − 69)/12) ≤ 4 over every variant, including uncapped note-offs", () => {
    // context: range from rows, computeVelocity identity, warp identity (the fit does not depend on them)
    for (const row of SEMANTICS_ROWS) for (const variant of predictedVariants(row, context)) for (const n of variant.notes)
      expect(PPQN.pulsesToSeconds(n.duration, PATTERN_BPM) * 2 ** ((n.pitch - 69) / 12)).toBeLessThanOrEqual(SAMPLE_SECONDS);
  });
  it("the held-note pattern ends off the grid so the base Arpeggio row's last step is capped (70 pulses)", () => {});
  it("the zeitgeist rows cover each distinct duration once (8 values, 960 once)", () => {});
});
describe("resolveRows", () => {
  it("quick, a device, a pattern, a named list; unknown values throw", () => {});
});
describe("applySettings", () => {
  it("writes every Arpeggio field and the Zeitgeist groove fields", () => { /* midiEffectFixture("arpeggio") / ("zeitgeist"), transact, read back */ });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRows.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the rows**

Generators per group; ids as above; labels human (`"Arpeggio UpDown, 3 octaves — held chord"`). Record the row sampling rationale (one parameter at a time, the two coupled pairs) in the file header; the register note repeats it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRows.test.ts`
Expected: PASS. If the sample-fit test fails for a row, shorten that row's note (not the sample).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsRows.ts src/lib/audit/midiEffectSemanticsRows.test.ts
git commit -m "feat(audit): semantics audit rows — full range per parameter, coupled sweeps, quick subset"
```

---

### Task 5: The two judgements and the verdict

**Files:**
- Create: `src/lib/audit/midiEffectSemanticsVerdict.ts`
- Create: `src/lib/audit/midiEffectSemanticsVerdict.test.ts`

**Interfaces:**
- Consumes: `NoteFigure` (Task 2), `PredictedFigure`, `DeviationName` (Task 3, type-only), tolerances (Task 4). No SDK import of any kind: the table script loads this file under Node.
- Produces:
  - `interface Tolerances { onsetMs: number; cents: number; velocity: number; endMs: number; unstableJitterCents: number }` and `const TOLERANCES: Tolerances` from Task 4's constants.
  - `interface Variant { deviations: ReadonlySet<DeviationName>; predicted: PredictedFigure[] }` (already in ms; the page converts with `toPredictedFigures`)
  - `interface Mismatch { index: number; field: "count" | "onset" | "pitch" | "cents" | "velocity" | "end" | "extra" | "missing"; expected: number | string; got: number | string }`
  - `interface RuleJudgement { kind: "holds" | "deviation" | "broken" | "none"; deviations: DeviationName[]; readable: number; unreadable: number; mismatch: Mismatch | null }`
  - `function judgeRule(read: readonly NoteFigure[], variants: readonly Variant[], tolerances: Tolerances): RuleJudgement` — for each variant in order: drop every read note whose onset lies inside an unreadable predicted span (±`onsetMs`) or whose `jitterCents` exceeds `unstableJitterCents`; the remaining read notes must pair one-to-one with the readable predicted notes in onset order (count first, then per note onset / pitch / cents / velocity / end, the first failure recorded); the first variant that matches wins: empty set → `holds`, else `deviation` with its names; none → `broken` with the EMPTY-set variant's first mismatch; a row whose readable prediction is empty in every variant and whose read list is empty → `holds` (a predicted-silent row); readable prediction empty but read notes present → `broken` with `extra`; a row where every variant's prediction is entirely unreadable and read notes exist → `none` (tracked).
  - `type RegisterJudgement = "as-registered" | "changed" | "unregistered"`; `interface RegisterRow { notes: NoteFigure[]; unreadable: number }`; `function compareRegister(figure: RegisterRow, registered: RegisterRow | undefined, tolerances: Tolerances): { kind: RegisterJudgement; mismatch: Mismatch | null }` — same tolerances, counts first.
  - `function verdictOf(rule: RuleJudgement, register: RegisterJudgement, error: string | null): string` — `error` → `"error"`; `none` → `"no rule"`; otherwise `<prefix><body>` with prefix `""` for `as-registered` when the body is `rule holds` (giving exactly `"as-registered"`), `"as-registered, "` otherwise, `"changed, "` for changed, and suffix `", unregistered"` for unregistered; body `rule holds` | `matches-known-deviation a+b` | `rule broken`. So: `as-registered`, `as-registered, matches-known-deviation x`, `as-registered, rule broken`, `changed, rule holds`, `changed, matches-known-deviation x`, `changed, rule broken`, `rule holds, unregistered`, `matches-known-deviation x, unregistered`, `rule broken, unregistered`.
  - `function describeMismatch(m: Mismatch): string` — e.g. `note 3 velocity 0.812 expected 0.900`, `extra note at 2037.5 ms`, `count 7 expected 8`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("judgeRule", () => {
  it("holds when every readable note matches within tolerance and ignores read notes inside unreadable spans", () => {});
  it("prefers the empty set, then the smallest deviation set that matches", () => {});
  it("a sounding render against a silent prediction is broken, naming the extra note", () => {
    const j = judgeRule([{ onsetMs: 2000, endMs: 2060, pitch: 60, cents: 0, velocity: 1, jitterCents: 0.1 }], [{ deviations: new Set(), predicted: [] }], TOLERANCES);
    expect(j.kind).toBe("broken");
    expect(j.mismatch?.field).toBe("extra");
  });
  it("a silent render against a silent prediction holds", () => {});
  it("a fully unreadable prediction with sound is tracked (none), with silence is none too", () => {});
  it("a pitch 2.5 cents off, a velocity 0.011 off, an onset 1.2 ms off and an end 2.5 ms off each break, naming the field", () => {});
  it("an unstable read note (jitter above 10 cents) is dropped before matching", () => {});
});
describe("compareRegister", () => {
  it("a missing register entry is unregistered", () => { expect(compareRegister(fig, undefined, TOLERANCES).kind).toBe("unregistered"); });
  it("equal within tolerance is as-registered; a different unreadable count or any field out of tolerance is changed", () => {});
});
describe("verdictOf", () => {
  it.each([...nine combinations as strings above, plus error and no rule])("…", () => {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsVerdict.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the verdict**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsVerdict.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsVerdict.ts src/lib/audit/midiEffectSemanticsVerdict.test.ts
git commit -m "feat(audit): rule and register judgements and the two-axis verdict for the semantics audit"
```

---

### Task 6: The artifacts: envelope schema and register

**Files:**
- Create: `src/lib/audit/midiEffectSemanticsArtifacts.ts`
- Create: `src/lib/audit/midiEffectSemanticsArtifacts.test.ts`

**Interfaces:**
- Consumes: `NoteFigure`, `RuleJudgement`, `RegisterJudgement`, `Mismatch`, `DeviceSetting`, `RowGroup`.
- Produces:
  - `const MIDI_SEMANTICS_SCHEMA_VERSION = 1`; `function summaryFileName(runToken: number): string` → `midisem-summary-<token>.json`; `const SUMMARY_NAME = /^midisem-summary-(\d+)\.json$/`.
  - `interface SemanticsRowRecord { id: string; label: string; group: RowGroup; pattern: string; chain: { setting: DeviceSetting; enabled: boolean }[]; predicted: PredictedFigure[] (the intent variant); ruleSentence: string; read: NoteFigure[]; unreadable: number; rule: RuleJudgement["kind"]; deviations: DeviationName[]; register: RegisterJudgement; verdict: string; figure: string | null; error: string | null; renderMs: number }`
  - `interface SemanticsSummary { schemaVersion: number; runToken: number; userAgent: string; sdkVersion: string; sampleRate: number; bpm: number; rowsParam: string; deviceParam: string; patternParam: string; registerSource: string | null; registerSdkVersion: string | null; calibration: { referencePeak: number; instrumentOffsetFrames: number; onsetThreshold: number; attackMs: number; gapMs: number }; rows: SemanticsRowRecord[] }`
  - `function parseSemanticsSummary(json: unknown, runToken: number): SemanticsSummary` — schema version, `rows` array, each row's `read` array and `verdict` string checked, as the placement parser does.
  - `function roundFigure(note: NoteFigure): NoteFigure` — onset/end to 0.1 ms, cents to 0.1, velocity to 0.005 (the register's resolution; the page stores rounded figures).
  - `interface SemanticsRegister { schemaVersion: 1; sdkVersion: string; acceptedRunToken: number; acceptedAt: string; sampleRate: number; bpm: number; rows: Record<string, { notes: NoteFigure[]; unreadable: number }> }`
  - `function parseSemanticsRegister(json: unknown): SemanticsRegister`.
  - `function registerFromSummary(summary: SemanticsSummary, options: { force: boolean; acceptedAt: string }): SemanticsRegister` — every row's `{ notes: read, unreadable }` keyed by id; THROWS listing the ids when any row is `error` or `rule: "broken"` unless `force`.
  - `function registerDiff(previous: SemanticsRegister | null, next: SemanticsRegister): { added: string[]; removed: string[]; changed: string[] }` (changed by `compareRegister` at the tolerances).
- This file has no SDK imports (the table script loads it under Node); `DeviceSetting` and `RowGroup` are type-only imports.

- [ ] **Step 1: Write the failing tests**

```ts
it("names the summary by run token", () => expect(summaryFileName(1)).toBe("midisem-summary-1.json"));
it("parses the current schema and rejects another, a missing rows array, a row without read or verdict", () => {});
it("roundFigure rounds to the register's resolution", () => {});
it("registerFromSummary keys figures by id and refuses a run with an error or a broken row unless forced", () => {
  expect(() => registerFromSummary(withBroken, { force: false, acceptedAt })).toThrow(/arp-vel0-held-chord/);
  expect(Object.keys(registerFromSummary(withBroken, { force: true, acceptedAt }).rows)).toContain("arp-vel0-held-chord");
});
it("registerDiff reports added, removed and changed ids", () => {});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsArtifacts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the artifacts**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsArtifacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsArtifacts.ts src/lib/audit/midiEffectSemanticsArtifacts.test.ts
git commit -m "feat(audit): envelope schema and JSON register for the semantics audit"
```

---

### Task 7: The page

**Files:**
- Create: `midi-effect-semantics-audit-debug-demo.html` (copy of the placement page's HTML, title "MIDI Effect Semantics Audit", script `/src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx`)
- Create: `src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx`
- Modify: `vite.config.ts:202` (add `midiEffectSemanticsAudit: resolve(__dirname, "midi-effect-semantics-audit-debug-demo.html")`)

**Interfaces:**
- Consumes: Task 1 (`buildNanoProject`, `removeMidiEffects`, `uploadSummary`, `RunAbort`), Task 2 (`sineSample`, `readNotes`, `toFigure`, `READER_DEFAULTS`), Task 3 (`markReadability`, `DEVIATIONS`), Task 4 (rows, `resolveRows`, `applySettings`, `predictedVariants`, `renderSeconds`, `FACTORY_KEYS`, constants), Task 5 (`judgeRule`, `compareRegister`, `verdictOf`, `describeMismatch`, `TOLERANCES`), Task 6 (summary, register parse, `roundFigure`); `writePattern` from `@/lib/midiEffects/patterns`; `midiEffectsFieldOf`; `renderOfflineSlice`; `zeitgeistGrooveBox`; `resolveRate` from `midiEffectScenarios`.
- URL: `midi-effect-semantics-audit-debug-demo.html[?rate=48000|44100][&rows=all|quick|<ids>][&device=…][&pattern=…]`; bpm fixed at `PATTERN_BPM` (the patterns are written for it).
- Flow per run: fetch the register (404 → null, shown in the status line); for each row: `writePattern` (held boxes in a ref, as the placement page); insert each chain device in index order (`insertEffect` in one transaction, `enabled` + `applySettings` in the next); build the `RuleContext` from the live adapters (`project.boxAdapters.adapterFor(box, VelocityDeviceBoxAdapter).computeVelocity` bound, `adapterFor(box, ZeitgeistDeviceBoxAdapter).groove().warp` bound; identity functions when the chain has no such device); `predictedVariants`; `renderOfflineSlice(project, 0, renderSeconds(PATTERN_BPM), RATE)`; `readNotes(channels[0], RATE, READER_DEFAULTS)`; on `dry-sixteenths`: `referencePeak = max peak`, `instrumentOffsetFrames = first onset − round(pulsesToSeconds(3840) × RATE)`, abort the run (`RunAbort`) if the count is not 32; `toFigure` + `roundFigure` on every note; `markReadability` then `toPredictedFigures` on every variant; `judgeRule`, `compareRegister`, `verdictOf`; `ruleSentence` = the chain's `RULE_SENTENCES` joined with " → " (shown with the figure when the verdict says `rule broken`); `removeMidiEffects` in `finally` (a failure → `RunAbort`). Console line per row `[midi-semantics] <id>: <verdict>` and the figure. Summary uploaded at the end.
- UI: the placement page's layout (status callout with `#audit-state`, a `TestStep` with the Run button, a results table: row | verdict | notes read / readable predicted (unreadable) | figure | render ms), a `DebugLinkBar` to the register note, a footer with the calibration figures and the register source. Verdict badge colours: green for `as-registered` and `rule holds, unregistered`; amber for `changed, rule holds`, any `matches-known-deviation`, `no rule`; red for any `rule broken` and `error`.

- [ ] **Step 1: Create the HTML entry and the Vite input**

- [ ] **Step 2: Write the page**

Model it on the placement page; keep every reading in the library (the page converts, loops and renders only).

- [ ] **Step 3: Typecheck and unit tests**

Run: `npm run typecheck && npx vitest run src/lib/audit`
Expected: exit 0, PASS.

- [ ] **Step 4: First browser run, quick subset**

Dev server up; open `https://localhost:5173/midi-effect-semantics-audit-debug-demo.html?rows=quick`; a REAL click on Run; wait for `#audit-state` = `done` (poll in calls under 100 s). Expect: every dry row `rule holds, unregistered`; `dry-sixteenths` velocities 1.0 and 0.6 within 0.01 (the velocity-linearity check); the Arpeggio rows `matches-known-deviation` naming `arpeggio-velocity-matrix` only where velocity 0 is set and the chord's 0.8 differs from 1.0, `arpeggio-uncapped-note-off` on the held-note rows, `arpeggio-drops-cent` only on `order-pitch-arpeggio`; Pitch, Velocity rows `rule holds`; Zeitgeist rows `matches-known-deviation zeitgeist-warps-note-off` where the off-beat's duration changes measurably, else `rule holds`; `zg-amount1-dur480-sixteenths` `no rule`; disabled rows `rule holds`. Anything else is read first as a reader or rule error on this side: inspect the figure, fix, re-run. Only a finding that survives the rule's crate citation is an engine finding; file nothing in this task.

- [ ] **Step 5: Commit**

```bash
git add midi-effect-semantics-audit-debug-demo.html src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx vite.config.ts
git commit -m "feat(audit): MIDI effect semantics audit page"
```

---

### Task 8: The table script

**Files:**
- Create: `scripts/audit/midi-effect-semantics/table.ts`
- Modify: `scripts/audit/table-scripts-load.test.ts:12-17` (add the script)
- Create: `scripts/audit/midi-effect-semantics/table.test.ts`

**Interfaces:**
- `node scripts/audit/midi-effect-semantics/table.ts [runToken] [--accept] [--force]` — newest `midisem-summary-*.json` in `.verify-output/` when no token. Prints one line per row: `id | verdict | figure | read / readable (unreadable) | max |Δonset| ms | max |Δcents| | max |Δvel| | render ms`, then the run line (`run <token> | sdk <v> | <rate> Hz | <bpm> bpm | reference peak <p> | instrument offset <n> frames | register <source or none> | rows <n> | holds <n> deviation <n> broken <n> none <n> error <n>`). `--accept` calls `registerFromSummary`, prints `registerDiff` against the file it is about to replace, writes `debug/2026-11-03-midi-effect-semantics/register/<rate>.json` (pretty JSON) and prints the path; a refusal (Task 6) exits 1 with the ids; `--force` passes through and prints `FORCED` on its own line.
- Pure helpers exported for the test: `function formatRows(summary: SemanticsSummary): string[]`, `function runLine(summary: SemanticsSummary): string`, `function acceptPath(rate: number): string`. The script body runs only when `import.meta.url` is the entry (`process.argv[1]` resolves to the file), so the test can import the helpers.

- [ ] **Step 1: Write the failing tests**

`table.test.ts`: `formatRows` on a two-row summary fixture gives the expected two strings; `runLine` counts the verdict classes; `acceptPath(48000)` ends in `register/48000.json`. Add the script path to `SCRIPTS` in `table-scripts-load.test.ts` (the existing test spawns it with token `1` and asserts no module-resolution error).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/audit`
Expected: FAIL (module not found; the load test fails on the missing file).

- [ ] **Step 3: Implement the script**

Relative `.ts` imports of `midiEffectSemanticsArtifacts.ts` and `midiEffectSemanticsVerdict.ts` only (Node type stripping; neither reaches the SDK's dist). A broken row's line carries its `ruleSentence` after the figure.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/audit && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/audit/midi-effect-semantics/ scripts/audit/table-scripts-load.test.ts
git commit -m "feat(audit): semantics audit table script with --accept"
```

---

### Task 9: First runs, the register, the note and the docs

**Files:**
- Create: `debug/2026-11-03-midi-effect-semantics/note.md`
- Create: `debug/2026-11-03-midi-effect-semantics/register/48000.json`, `register/44100.json` (by `--accept`)
- Modify: `debug/README.md` (index row, newest first)
- Modify: `CLAUDE.md` (a standing-sweep bullet right after the placement audit's, `CLAUDE.md:764-772`)
- Modify: `src/demos/midi/CLAUDE.md` (a section after "MIDI Effect Placement Audit (unlisted)")
- Modify: `src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx` (the `DebugLinkBar` register URL)
- Delete: `docs/superpowers/specs/2026-11-03-midi-effect-semantics-audit-design.md`, `docs/superpowers/plans/2026-11-03-midi-effect-semantics-audit.md`

- [ ] **Step 1: Full run at 48 kHz, device at 44.1 kHz**

Confirm the Mac's output device rate (Audio MIDI Setup) and note it. `?rows=all` (default), a real click on Run, wait for `done` (several minutes; poll). `node scripts/audit/midi-effect-semantics/table.ts` — read every `rule broken` and `no rule` row: a broken row is a reader or rule fault on this side until the crate citation says otherwise. Fix and re-run until the only non-`holds` verdicts are the listed deviations and the `no rule` rows the register explains. Then `--accept`.

- [ ] **Step 2: Full run at 44.1 kHz**

`?rate=44100`; the same reading; `--accept` writes `register/44100.json`.

- [ ] **Step 3: Re-run once per rate against the register**

Expect every row `as-registered` or `as-registered, matches-known-deviation …` or `no rule` (offline renders are deterministic). A row that reads `changed` on a re-run is a non-determinism finding; record it in the note before anything else.

- [ ] **Step 4: Write the note**

`note.md` with the other registers' shape (`debug/2026-10-21-midi-effect-placement/note.md`): title, SDK pin 0.0.180, harness URL and parameters, the measurement library files, "What a row measures" (the instrument, the reader and its tested accuracy, the calibration figures from the dry row: reference peak, instrument offset, the threshold crossing's velocity dependence), the rule sources table (device → rule sentence → crate line → adapter line), the known deviations table (name, sentence, crate line, release first seen, retired on), the row sampling rationale (one parameter at a time; mode × octaves and rate × gate coupled; rates below 1/64 left out; the duplicate 960 in the groove durations; gate 1 and 2 unreadable through the 1 ms release, the placement audit holding gate 1's timing), the runs (the table output per rate, device rate noted), "Reading" (what the engine does, in sentences, with the deviations called by name), "Status" (standing check), "Open items" (an abutting-note reader for gate 1; the arpeggio velocity intent is the builder's reading of the crate's comment and is flagged for the user; the Pitch out-of-range drop taken as the rule, TS passed raw).

- [ ] **Step 5: Index and docs**

`debug/README.md`: a row above the placement audit's with the summary and the standing-check status. `CLAUDE.md`: the bullet — URL, both rates, "a real click on Run, deterministic, no hardware, about N minutes per rate" (the measured figure), expected verdicts, register and table paths, "a `changed` row is the finding; a `matches-known-deviation` the register lists is not; `--accept` only after a person's read". `src/demos/midi/CLAUDE.md`: URL parameters, the verdict meanings, the reading recipe, the readability rules, the deviations by name, the `--accept` rule. Set the page's `DebugLinkBar` href to the note's GitHub URL.

- [ ] **Step 6: Delete the spec and the plan, typecheck, full test run**

Run: `npm run typecheck && npx vitest run`
Expected: exit 0, all PASS.

- [ ] **Step 7: Commit and push, open the PR**

```bash
git add -A debug/2026-11-03-midi-effect-semantics debug/README.md CLAUDE.md src/demos/midi/CLAUDE.md src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx
git rm docs/superpowers/specs/2026-11-03-midi-effect-semantics-audit-design.md docs/superpowers/plans/2026-11-03-midi-effect-semantics-audit.md
git commit -m "docs(audit): semantics audit register, first runs at 48 and 44.1 kHz, standing-sweep entry"
git push -u origin feat/midi-effect-semantics-audit
gh pr create --base main --title "MIDI effect semantics audit: full parameter range, rule vs register verdicts, known deviations" --body-file <drafted body>
```

The PR body flags the three calls for the user: the Arpeggio velocity intent, the Pitch out-of-range drop taken as the rule, and `zeitgeist-warps-note-off` listed as a deviation although both the crate and the TS processor warp every event. Then `/pr-review-toolkit:review-pr` and fix Critical + Important before merge.
