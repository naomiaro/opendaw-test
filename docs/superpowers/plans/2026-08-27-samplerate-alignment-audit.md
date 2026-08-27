# Sample-Rate / Quantum-Alignment Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-rate differential audit of the openDAW engine: ~180 offline renders (9 families × 5 BPMs × 4 sample rates) judged against analytic expectations, a static suspect register for triage, live forced-rate recording measurements, and publication of confirmed findings as debug notes + draft-reviewed upstream issues — leaving behind a permanent regression harness.

**Architecture:** Three pure, TDD-able modules (analytic expectations, onset detection, verdict engine) feed one unlisted harness debug page that builds scenario projects, renders them via `renderOfflineSlice` at arbitrary sample rates, and uploads verdict JSON + flagged WAVs through the existing `/__verify` middleware. A static sweep of the Rust crates + recording glue produces the suspect register that triages matrix divergences. Live forced-rate `AudioContext` sessions cover recording-path math and the #367 known-positive.

**Tech Stack:** OpenDAW SDK 0.0.170 (WASM offline renderer), React debug page (repo conventions), vitest for pure modules, browser automation (Playwright MCP / claude-in-chrome) for matrix runs, audio-analyzer MCP for deep dives.

**Spec:** `docs/superpowers/specs/2026-08-27-samplerate-alignment-audit-design.md`

## Global Constraints

- Audit target is the INSTALLED SDK: `@opendaw/studio-sdk@0.0.170`; source read in `/Users/naomiaro/Code/openDAWOriginal` at that tag; upstream `main` consulted only for the fixed-on-main gate.
- Evidence bar: an upstream issue requires a measured deviation from analytic expectation that the suspect register PREDICTS (rates, BPMs, magnitude). Source-only suspicions stay in the campaign note.
- Issues: measured signature + cause analysis, NO suggested-fix section; body drafted under `debug/drafts/` and posted ONLY after the user reviews and approves (CLAUDE.md convention).
- Matrix axes exactly per spec: rates {44100, 48000, 88200, 96000}; BPMs {120, 90, 124, 133, 97.3}; 120/48k is the alignment-friendly control.
- Tolerance model: verdicts compare against analytic expectations; per-family detector calibration is measured on the 120/48k control row in Task 6 before any matrix conclusion; the bug discriminator is RATE-DEPENDENT divergence, not absolute deviation.
- The harness page is UNLISTED: root HTML with `<meta name="robots" content="noindex">`, no index card, no sitemap entry, no og-image.
- All offline-renderer awaits bounded with `withDeadline` (`src/lib/deadline.ts`) — the repo rule; never an unbounded `await renderer.*`.
- Option API (`isEmpty()`/`unwrap()`), `editing.modify()` transaction discipline (throw to abort), `Math.round()` before Int32 PPQN fields, adapter-layer traversal — all repo CLAUDE.md rules apply.
- `npx tsc --noEmit` adds zero `^src/` errors; `npm test` stays green; `npm run build` passes.
- Do not modify shipped demos; the only shared-file edit is the optional export-config parameter added to `renderOfflineSlice` (backward-compatible, default `Option.None`).

---

### Task 1: Branch + scenario catalog & analytic expectations (TDD)

**Files:**
- Create: `src/lib/audit/auditExpectations.ts`
- Test: `src/lib/audit/auditExpectations.test.ts`

**Interfaces:**
- Produces (later tasks rely on these exact names):

```typescript
export type AuditFamily =
  | "metronome" | "loop-wrap" | "seam" | "region-fencepost" | "note-onsets"
  | "automation" | "tempo-ramp" | "signature" | "transport-pos";
export const AUDIT_RATES: readonly number[]; // [44100, 48000, 88200, 96000]
export const AUDIT_BPMS: readonly number[];  // [120, 90, 124, 133, 97.3]
export const BAR_PPQN: number;               // PPQN.Quarter * 4
export interface AuditScenario {
  family: AuditFamily;
  renderBars: number;         // total bars to render
  description: string;
}
export const AUDIT_SCENARIOS: Record<AuditFamily, AuditScenario>;
/** Expected audible event onsets in seconds from render start. */
export function expectedOnsets(family: AuditFamily, bpm: number): number[];
```

Scenario definitions (encode these exactly; every constant reappears in the Task 4 builders — keep them in this one module and import from there):

- `metronome`: 8 bars, metronome clicks every quarter → onsets `k * 60/bpm`, k = 0..31.
- `loop-wrap`: 2-bar loop, rendered for 8 passes (16 bars of output); one short note at the loop start → onsets `n * 2 * 4 * 60/bpm`, n = 0..7.
- `seam`: 2 bars; a continuous synthetic tone split as two butt regions at bar 1. Expected onsets: `[0]` only (continuity family — the seam metric, not onsets, is the judge; the verdict engine treats deviations of a missing-onset list as pass for this family).
- `region-fencepost`: 4 bars; a click-train region STARTING at 7 sixteenths (`position = 7 * PPQN.Quarter / 4`), clicks every quarter within the region → onsets `7 * (60/bpm)/4 + k * 60/bpm` while within 4 bars.
- `note-onsets`: 4 bars; synth notes at PPQN positions `[0, 960, 1920, 2400, 3840, 5040, 7680, 9600, 11520, 13200]` (mix of on-grid and off-grid) → onsets `pos/960 * 60/bpm`.
- `automation`: 4 bars; sustained tone gated by volume steps: full → silent → full at bars 1 and 2, silent→full at bar 3 → rising-energy onsets at `[0, 2, 3] bars` (each `bar * 4 * 60/bpm`); the bar-1 falling edge is not an onset.
- `tempo-ramp`: 8 bars with a LINEAR tempo ramp from `bpm` to `bpm * 0.75` across bars 0..8, metronome quarters. Expected times integrate the ramp: for beat k of K total, with tempo linear in *beat index*, time of beat k is `sum_{i<k} 60/bpm(i)` where `bpm(i) = bpm + (bpm*0.75 - bpm) * (i / K)`. Implement exactly that discrete sum (the engine interpolates continuously; Task 6 calibration decides if a continuous-integral refinement is needed — start discrete, document it).
- `signature`: 6 bars: bars 0-1 in 3/4, then 4/4 (signature event at PPQN `2 * 3 * 960`); metronome quarters → onsets every `60/bpm` regardless (uniform quarters), so the family's discriminator is the ACCENT positions; expectations still return all quarter onsets, and downbeat indices are exported as:

```typescript
export function expectedDownbeatIndices(family: "signature"): number[]; // [0, 3, 6, 10, 14, 18, 22]
```

- `transport-pos`: 2 bars rendered AFTER `setPosition` to `5 * 960 + 240` PPQN (an off-block position); metronome quarters → first onset at the next quarter boundary after the start position, i.e. first expected onset `(6*960 − (5*960+240))/960 * 60/bpm` from render start, then every `60/bpm`.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/samplerate-audit
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/audit/auditExpectations.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  AUDIT_RATES, AUDIT_BPMS, AUDIT_SCENARIOS,
  expectedOnsets, expectedDownbeatIndices,
} from "./auditExpectations";

describe("audit matrix axes", () => {
  it("pins the spec's rates and BPMs", () => {
    expect(AUDIT_RATES).toEqual([44100, 48000, 88200, 96000]);
    expect(AUDIT_BPMS).toEqual([120, 90, 124, 133, 97.3]);
  });
  it("has a scenario per family", () => {
    expect(Object.keys(AUDIT_SCENARIOS).sort()).toEqual([
      "automation", "loop-wrap", "metronome", "note-onsets",
      "region-fencepost", "seam", "signature", "tempo-ramp", "transport-pos",
    ]);
  });
});

describe("expectedOnsets", () => {
  it("metronome at 120 BPM: 32 quarters, 0.5 s apart", () => {
    const onsets = expectedOnsets("metronome", 120);
    expect(onsets).toHaveLength(32);
    expect(onsets[0]).toBe(0);
    expect(onsets[1]).toBeCloseTo(0.5, 9);
    expect(onsets[31]).toBeCloseTo(15.5, 9);
  });
  it("loop-wrap at 120 BPM: 8 wraps 4 s apart", () => {
    const onsets = expectedOnsets("loop-wrap", 120);
    expect(onsets).toHaveLength(8);
    expect(onsets[3]).toBeCloseTo(12, 9);
  });
  it("region-fencepost at 97.3 BPM starts at 7/4 of a beat", () => {
    const beat = 60 / 97.3;
    const onsets = expectedOnsets("region-fencepost", 97.3);
    expect(onsets[0]).toBeCloseTo((7 * beat) / 4, 9);
    expect(onsets[1]).toBeCloseTo((7 * beat) / 4 + beat, 9);
  });
  it("note-onsets maps PPQN to seconds at 90 BPM", () => {
    const onsets = expectedOnsets("note-onsets", 90);
    expect(onsets[1]).toBeCloseTo((960 / 960) * (60 / 90), 9);
    expect(onsets[3]).toBeCloseTo((2400 / 960) * (60 / 90), 9);
  });
  it("automation rising edges at bars 0, 2, 3", () => {
    const bar = 4 * (60 / 124);
    expect(expectedOnsets("automation", 124)).toEqual(
      [0, 2 * bar, 3 * bar].map((t) => expect.closeTo(t, 9)) as unknown as number[]
    );
  });
  it("tempo-ramp is monotonically slowing (intervals grow)", () => {
    const onsets = expectedOnsets("tempo-ramp", 120);
    const d0 = onsets[1] - onsets[0];
    const dEnd = onsets[onsets.length - 1] - onsets[onsets.length - 2];
    expect(d0).toBeCloseTo(0.5, 3);
    expect(dEnd).toBeGreaterThan(d0);
  });
  it("transport-pos first onset is 3/4 beat after the odd start", () => {
    const beat = 60 / 133;
    const onsets = expectedOnsets("transport-pos", 133);
    expect(onsets[0]).toBeCloseTo(0.75 * beat, 9);
    expect(onsets[1]).toBeCloseTo(0.75 * beat + beat, 9);
  });
  it("signature downbeat indices follow 3/4,3/4 then 4/4", () => {
    expect(expectedDownbeatIndices("signature")).toEqual([0, 3, 6, 10, 14, 18, 22]);
  });
  it("seam family has a single origin onset", () => {
    expect(expectedOnsets("seam", 120)).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run tests, verify FAIL** — `npx vitest run src/lib/audit/auditExpectations.test.ts` (module missing).

- [ ] **Step 4: Implement `auditExpectations.ts`** exactly per the scenario definitions above. Pure module: no SDK imports except `PPQN` from `@opendaw/lib-dsp` for the 960 constant (`PPQN.Quarter`). Every family's onset list must derive from the constants in `AUDIT_SCENARIOS` (bars, positions) — no duplicated magic numbers in the functions.

- [ ] **Step 5: Run tests, verify PASS.** Also `npx tsc --noEmit 2>&1 | grep '^src/'` → empty.

- [ ] **Step 6: Commit** — `feat: audit scenario catalog + analytic expectations`

---

### Task 2: Onset detection (pure DSP, TDD)

**Files:**
- Create: `src/lib/audit/onsetDetection.ts`
- Test: `src/lib/audit/onsetDetection.test.ts`

**Interfaces:**
- Produces:

```typescript
export interface OnsetOptions {
  hopSize?: number;        // default 64 samples
  thresholdRatio?: number; // default 0.25 of max envelope rise
  refractorySec?: number;  // default 0.05 — min gap between onsets
}
/** Detect rising-energy onsets; returns seconds, refined to the first sample
 *  whose |x| exceeds 25% of the local peak (sub-hop accuracy). */
export function detectOnsets(
  channel: Float32Array, sampleRate: number, options?: OnsetOptions
): number[];
/** Max |x[n]−x[n−1]| in a ±window around the given time (seam discontinuity). */
export function maxStepAround(
  channel: Float32Array, sampleRate: number, atSec: number, windowSec?: number
): number;
```

- [ ] **Step 1: Write the failing tests** — synthetic buffers with clicks at known offsets:

```typescript
import { describe, it, expect } from "vitest";
import { detectOnsets, maxStepAround } from "./onsetDetection";

function clickTrain(sampleRate: number, onsetsSec: number[], length: number): Float32Array {
  const buf = new Float32Array(length);
  for (const t of onsetsSec) {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < Math.min(480, length - start); i++) {
      buf[start + i] += Math.sin((i / 480) * Math.PI) * Math.exp(-i / 160);
    }
  }
  return buf;
}

describe("detectOnsets", () => {
  it("finds synthetic clicks within 1 ms at 44100", () => {
    const truth = [0.1, 0.6, 1.11731, 2.0];
    const buf = clickTrain(44100, truth, 44100 * 3);
    const found = detectOnsets(buf, 44100);
    expect(found).toHaveLength(4);
    truth.forEach((t, i) => expect(Math.abs(found[i] - t)).toBeLessThan(0.001));
  });
  it("same buffer content at 96000 yields the same times within 1 ms", () => {
    const truth = [0.25, 0.75321, 1.5];
    const found = detectOnsets(clickTrain(96000, truth, 96000 * 2), 96000);
    truth.forEach((t, i) => expect(Math.abs(found[i] - t)).toBeLessThan(0.001));
  });
  it("refractory window merges double-triggers", () => {
    const buf = clickTrain(48000, [0.5, 0.503], 48000);
    expect(detectOnsets(buf, 48000)).toHaveLength(1);
  });
  it("silence yields no onsets", () => {
    expect(detectOnsets(new Float32Array(48000), 48000)).toHaveLength(0);
  });
});

describe("maxStepAround", () => {
  it("flags a hard discontinuity and passes a continuous tone", () => {
    const sr = 48000;
    const buf = new Float32Array(sr);
    for (let i = 0; i < sr; i++) buf[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5;
    const smooth = maxStepAround(buf, sr, 0.5);
    for (let i = Math.floor(sr * 0.75); i < sr; i++) buf[i] = -buf[i]; // hard flip
    const hard = maxStepAround(buf, sr, 0.75);
    expect(hard).toBeGreaterThan(smooth * 5);
  });
});
```

- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** — energy envelope over `hopSize` hops; onset = hop where envelope rise exceeds `thresholdRatio × max rise`, then refine backward/forward to the first sample whose `|x|` exceeds 25% of the local (±10 ms) peak; enforce `refractorySec`. `maxStepAround`: scan ±`windowSec` (default 0.01) for max adjacent-sample delta.
- [ ] **Step 4: Verify PASS + tsc clean.**
- [ ] **Step 5: Commit** — `feat: onset detection + seam step metric for the samplerate audit`

---

### Task 3: Verdict engine (pure, TDD)

**Files:**
- Create: `src/lib/audit/auditVerdict.ts`
- Test: `src/lib/audit/auditVerdict.test.ts`

**Interfaces:**
- Consumes: `AuditFamily` from Task 1.
- Produces:

```typescript
export interface CellMeasurement {
  family: AuditFamily; bpm: number; rate: number;
  onsets: number[]; expected: number[];
  seamStep?: number;         // seam family only
  calibrationSec?: number;   // detector bias measured on the control row (subtracted)
}
export interface CellVerdict {
  family: AuditFamily; bpm: number; rate: number;
  matched: number; missing: number; extra: number;
  maxDeviationSec: number; meanDeviationSec: number;
  status: "pass" | "investigate";
}
export function judgeCell(m: CellMeasurement, toleranceSec: number): CellVerdict;
/** Cross-rate discriminator: same family+bpm across rates. "rate-dependent"
 *  when the per-rate max deviations differ by more than spreadToleranceSec. */
export function assessRateConsistency(
  cells: CellVerdict[], spreadToleranceSec: number
): "consistent" | "rate-dependent";
```

- [ ] **Step 1: Failing tests** — nearest-neighbor pairing (each expected onset pairs with the closest detected within 50 ms, unpaired = missing/extra), calibration subtraction, status thresholds, and rate-consistency:

```typescript
import { describe, it, expect } from "vitest";
import { judgeCell, assessRateConsistency, type CellMeasurement } from "./auditVerdict";

const base: CellMeasurement = {
  family: "metronome", bpm: 120, rate: 48000,
  expected: [0, 0.5, 1.0, 1.5], onsets: [0.001, 0.501, 1.001, 1.501],
};

describe("judgeCell", () => {
  it("passes within tolerance and reports deviations", () => {
    const v = judgeCell(base, 0.002);
    expect(v.status).toBe("pass");
    expect(v.matched).toBe(4);
    expect(v.maxDeviationSec).toBeCloseTo(0.001, 6);
  });
  it("subtracts calibration bias before judging", () => {
    const v = judgeCell({ ...base, calibrationSec: 0.001 }, 0.0005);
    expect(v.status).toBe("pass");
    expect(v.maxDeviationSec).toBeLessThan(0.0005);
  });
  it("flags a missing onset as investigate", () => {
    const v = judgeCell({ ...base, onsets: [0.001, 0.501, 1.501] }, 0.002);
    expect(v.missing).toBe(1);
    expect(v.status).toBe("investigate");
  });
  it("flags an extra onset (the #367 shape) as investigate", () => {
    const v = judgeCell({ ...base, onsets: [...base.onsets, 2.0] }, 0.002);
    expect(v.extra).toBe(1);
    expect(v.status).toBe("investigate");
  });
  it("flags out-of-tolerance deviation", () => {
    const v = judgeCell({ ...base, onsets: [0.02, 0.5, 1.0, 1.5] }, 0.002);
    expect(v.status).toBe("investigate");
  });
});

describe("assessRateConsistency", () => {
  const mk = (rate: number, dev: number) =>
    judgeCell({ ...base, rate, onsets: base.expected.map((t) => t + dev) }, 1);
  it("consistent when all rates deviate alike", () => {
    expect(assessRateConsistency(
      [mk(44100, 0.001), mk(48000, 0.0012), mk(96000, 0.0009)], 0.002
    )).toBe("consistent");
  });
  it("rate-dependent when one rate diverges (the bug signature)", () => {
    expect(assessRateConsistency(
      [mk(44100, 0.02), mk(48000, 0.0005), mk(96000, 0.0006)], 0.002
    )).toBe("rate-dependent");
  });
});
```

- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS + tsc.** Seam family special-case in `judgeCell`: when `seamStep !== undefined`, status is "investigate" iff `seamStep > toleranceSec`-independent absolute threshold passed in via `toleranceSec` (document: caller passes the seam step threshold in that slot for the seam family).
- [ ] **Step 5: Commit** — `feat: audit verdict engine with rate-consistency discriminator`

---

### Task 4: Scenario project builders + export-config passthrough

**Files:**
- Modify: `src/lib/offlineScan.ts` (add optional `exportConfig` parameter)
- Create: `src/lib/audit/auditBuilders.ts`

**Interfaces:**
- Consumes: `AuditFamily`, `AUDIT_SCENARIOS`, `BAR_PPQN` (Task 1).
- Produces:

```typescript
/** Mutates a FRESH project (caller creates it) to hold the family's scenario at
 *  the given bpm. Returns what the renderer needs. */
export interface BuiltScenario {
  renderSeconds: number;        // duration to render
  startPositionPpqn: number;    // renderer setPosition before stepping (0 for most)
  needsMetronome: boolean;      // pass the includeInMixdown export config
}
export function buildAuditScenario(
  project: Project, family: AuditFamily, bpm: number,
  localAudioBuffers: Map<string, AudioBuffer>, audioContext: AudioContext
): BuiltScenario;
```

`renderOfflineSlice` gains a final optional parameter, default preserving current behavior:

```typescript
export async function renderOfflineSlice(
  project: Project, startSeconds: number, endSeconds: number,
  sampleRate: number = 48000,
  exportConfig: Option<ExportConfiguration> = Option.None,
  keepLoopEnabled: boolean = false
): Promise<{ channels: Float32Array[]; sampleRate: number }>
```

(`keepLoopEnabled` skips the loop-disable modify — the loop-wrap family needs the loop; also pass `exportConfig` through to `OfflineEngineRenderer.create(projectCopy, exportConfig, sampleRate)`. Also pass a `startPositionPpqn` override: change the internal `renderer.setPosition(startPPQN)` to honor a new optional `startPositionPpqn?: number` parameter when provided — the transport-pos family needs an exact PPQN, not a seconds-derived one. Reconcile the parameter list into an options object if six positional params get unwieldy: `renderOfflineSlice(project, startSeconds, endSeconds, sampleRate, opts?: {exportConfig?, keepLoopEnabled?, startPositionPpqn?})` — options-object form preferred; update the existing call sites (grep for `renderOfflineSlice(`) which pass only the first four args and need no change.)

Builder implementations (follow existing repo patterns — read these BEFORE writing: `src/demos/playback/comp-lanes-debug-demo.tsx` static-setup for synthetic-buffer registration + region building, `src/lib/compLaneUtils.ts` `rebuildSpliceRegions` for AudioRegionBox creation, `src/demos/midi/CLAUDE.md` for Vaporisateur note creation, root CLAUDE.md for signature/tempo/metronome settings):

- Synthetic audio: generate click-train / tone `AudioBuffer`s with `audioContext.createBuffer` (content per family), register via `localAudioBuffers.set(UUID.toString(uuid), buffer)` + `AudioFileBox.create(project.boxGraph, uuid, box => box.fileName.setValue(...))` inside `editing.modify`, then create a Tape instrument track and `AudioRegionBox` referencing the file (position/duration per scenario; `timeBase` Musical with PPQN duration — these are authored regions, not recordings). Set `project.timelineBox.bpm` to the scenario bpm FIRST (content seconds derive from it).
- `metronome`: empty project + bpm; `needsMetronome: true`; renderSeconds = 8 bars.
- `loop-wrap`: loop area [0, 2 bars] enabled; one Vaporisateur note (16th duration, velocity 1.0, sharp-attack default) at PPQN 0; `keepLoopEnabled` path; renderSeconds = 16 bars worth.
- `seam`: 2-bar 220 Hz tone buffer; two butt regions split at bar 1 (region B `loopOffset` = bar-1 PPQN per the splice pattern); expected seam time = bar 1.
- `region-fencepost`: click-train buffer (clicks every beat, 4 bars of content); region at `position = Math.round(7 * PPQN.Quarter / 4)`.
- `note-onsets`: Vaporisateur notes at the Task 1 PPQN list (each a 16th long).
- `automation`: 4-bar tone region + volume automation track on the audio unit with steps (0 dB → silent at bar 1 → 0 dB at bar 2 → silent… matching Task 1's rising edges at bars 0/2/3): events per the repo's automation-demo pattern (`createTrackRegion` + `editing.append` seed-clear rule from root CLAUDE.md).
- `tempo-ramp`: metronome + tempo automation ramp `bpm → 0.75*bpm` over 8 bars (tempo track events, see `src/demos/automation/CLAUDE.md`); `needsMetronome: true`.
- `signature`: signature events 3/4 then 4/4 at `2 * 3 * 960`; `needsMetronome: true`; 6 bars per Task 1.
- `transport-pos`: metronome, empty timeline; `startPositionPpqn = 5 * 960 + 240`; renderSeconds = 2 bars.
- Metronome export config used by the page (Task 5): `Option.wrap({ metronome: { includeInMixdown: true } })`.

No unit tests (SDK/box-graph code — browser-validated in Task 6). Gates: tsc clean, existing vitest green, `npm run build` passes.

- [ ] **Step 1:** Extend `renderOfflineSlice` (options-object form) — read the whole file first; keep `withDeadline` bounds on every await.
- [ ] **Step 2:** Implement `auditBuilders.ts` per the list above (one exported function + one private builder per family; each builder ≤ ~60 lines; throw on invariant failure inside `editing.modify`, never early-return).
- [ ] **Step 3:** Gates: `npx tsc --noEmit | grep '^src/'` empty; `npx vitest run src/lib/audit` green; `npm run build` OK.
- [ ] **Step 4: Commit** — `feat: audit scenario builders + offline render export-config passthrough`

---

### Task 5: Harness debug page

**Files:**
- Create: `src/demos/engine/samplerate-audit-debug-demo.tsx`
- Create: `samplerate-audit-debug-demo.html` (copy `audio-verify-debug.html`'s skeleton: noindex meta, script src updated; NOT added to index/sitemap; no og-image)
- Modify: `vite.config.ts` (input entry `samplerateAudit`)

**Interfaces:**
- Consumes: Tasks 1-4 modules; `initializeOpenDAW` (pass the page-owned `localAudioBuffers` map); `/__verify` upload middleware (POST body → `.verify-output/<name>`; see `vite.config.ts:15` and `audio-verify-debug` page for the exact fetch call shape).
- Produces: URL contract `?family=<AuditFamily|all>&bpm=<number|all>&rate=<number|all>` — runs the selected cells sequentially; DOM contract: container `#audit-state` with `data-audit-state` walking `setup → running:<cell> → uploading → done` (or `error:<message>`), a verdict `<table>` (one row per cell: family, bpm, rate, matched/missing/extra, maxDev ms, status), and per-run artifact upload `audit-<timestamp>.json` (all rows) plus `audit-<family>-<bpm>-<rate>.wav` for every `investigate` cell (16-bit PCM WAV encode — reuse the WAV writer from the audio-verify page; read `src/demos/warp/` for `audioBufferToWav`-style helper or `src/lib/audioUtils.ts` if one exists — if none is importable, copy the audio-verify page's local implementation into `src/lib/audit/wavEncode.ts` and use it from there).

Cell execution: fresh `Project` per cell (same creation path `initializeOpenDAW` returns — reuse the ONE booted engine/project by building each scenario on `project.copy()`? NO — builders need `localAudioBuffers` registration BEFORE sample resolution; follow this order instead: page boots once with a page-lifetime `localAudioBuffers` map; per cell, create the scenario in a fresh project obtained from `project.copy()` of a pristine never-mutated base project, register buffers in the shared map (keyed by fresh UUIDs so cells never collide), build via `buildAuditScenario`, render via `renderOfflineSlice(scenarioProject, 0, built.renderSeconds, rate, {exportConfig, keepLoopEnabled, startPositionPpqn})`, run `detectOnsets` (+ `maxStepAround` for seam), `judgeCell`, append row). `raceHang`-style deadline per cell (90 s) so a wedged render yields `error:<cell>` not a hang (see `wasm-ensure-ready-second-context-debug-demo.tsx` pattern per root CLAUDE.md).

Calibration hook: the page reads optional `?calibration=<json-url-encoded>` map `{family: seconds}` applied via `CellMeasurement.calibrationSec`; Task 6 produces the committed `src/lib/audit/auditCalibration.ts` (`export const AUDIT_CALIBRATION: Partial<Record<AuditFamily, number>>`) which the page imports as the default.

- [ ] **Step 1:** Write the page + HTML + vite entry (create `auditCalibration.ts` with an empty object now so imports compile).
- [ ] **Step 2:** Gates: tsc clean; `npm run build` (page present in dist); vitest green.
- [ ] **Step 3: Commit** — `feat: samplerate audit harness page (unlisted)`

---

### Task 6: Harness validation + calibration (browser)

Procedure task — real browser (reuse the running dev server per repo rules; HTTPS).

- [ ] **Step 1: 44.1 kHz sanity.** Run `?family=metronome&bpm=120&rate=44100`; confirm `data-audit-state` reaches `done`, the render returned `~44100 × 16 s` frames (page logs frame count), and onsets ≈ 0.5 s spacing.
- [ ] **Step 2: Known-clean control.** `?family=seam&bpm=120&rate=48000` — seam step must pass (0.0.165 transparency). If it flags, the harness (not the engine) is wrong — fix before proceeding.
- [ ] **Step 3: Known-positive detector check.** Temporarily run metronome with a deliberately shifted expectation (page supports `?shiftExpectedMs=20` test knob — add it in this task if not present) and confirm the cell flags `investigate`. Remove/keep the knob but never use it in real runs.
- [ ] **Step 4: Calibrate.** Run all 9 families at 120 BPM / 48 kHz (the control row). For each family, record the mean deviation as the detector bias; write `AUDIT_CALIBRATION` in `src/lib/audit/auditCalibration.ts` with one line of comment per value (measured date, run). Biases > 5 ms mean a detector problem — investigate before committing. Re-run the control row WITH calibration: every family must now pass at tolerance 2 ms (except documented block-granular families — record actual pass tolerances per family as `AUDIT_TOLERANCES: Record<AuditFamily, number>` in the same file, chosen as `max(2ms, 2× observed control deviation)`).
- [ ] **Step 5:** Update the page to use `AUDIT_TOLERANCES`. Gates + commit — `feat: audit harness calibrated against 120/48k control row`

---

### Task 7: Static sweep → suspect register

Research task (no code). Parallel subagent readers over: `crates/engine/src/lib.rs`, `crates/transport/`, `crates/engine/src/metronome.rs`, `audio_region_player.rs`, `signature_track.rs`, tempo/value crates, and the recording glue (`openDAWOriginal/packages/studio/core/src/capture/RecordAudio.ts` + capture siblings) — ALL at tag `@opendaw/studio-sdk@0.0.170` (use `git show "@opendaw/studio-sdk@0.0.170:<path>"`; the checkout worktree is pinned there).

Each reader hunts the C1–C6 patterns from the spec and returns register entries: `{site (file:line at tag), class, what it decides, alignment condition, provoking scenario (which matrix family/params), predicted signature}`.

- [ ] **Step 1:** Dispatch readers (one per code area); collect entries.
- [ ] **Step 2:** Create `debug/sample-rate-alignment-audit.md`: campaign header (goal, spec link, harness usage line), the register table, and an empty results section. #367 gets its register row marked CONFIRMED/FILED (the class exemplar).
- [ ] **Step 3:** Add the campaign note to `debug/README.md` (open-questions section).
- [ ] **Step 4: Commit** — `docs: samplerate audit suspect register (static sweep)`

---

### Task 8: Matrix run + triage

Procedure task, batched (browser automation; ~15-30 s/render → run per-family batches: `?family=<f>&bpm=all&rate=all` = 20 cells/batch).

- [ ] **Step 1:** Run all 9 offline families (9 batches). After each batch, pull the uploaded `audit-*.json` from `.verify-output/` and append the verdict rows to the campaign note's results table (one summary line per family × bpm: statuses across the 4 rates + `assessRateConsistency` outcome).
- [ ] **Step 2:** Triage every `investigate`/`rate-dependent` cell: match against the register; the matching entry must PREDICT the measurement (rates/BPMs/magnitude) — write the prediction check into the note. No register match → focused deep-dive (read the family's engine path; add a register entry). Classify: bug / tolerance artifact (fix harness, re-run family) / by-design (record).
- [ ] **Step 3:** Focused re-runs for confirmed bugs: minimal reproduction cell set + WAV export; deep analysis with audio-analyzer MCP where spectral/temporal detail helps.
- [ ] **Step 4:** Fixed-on-main gate per confirmed bug: `git fetch` in the openDAW checkout; diff the responsible code `@0.0.170` vs `origin/main`; already-fixed → "upgrade and re-verify" note instead of an issue.
- [ ] **Step 5:** Commit the updated campaign note per batch — `docs: audit matrix results — <families>`

---

### Task 9: Live forced-rate runs (recording path + #367 known-positive)

Procedure task; needs real mic + real clicks (repo browser rules apply).

- [ ] **Step 1:** Add a dev-only URL knob to the swipe-comping demo page: `?sampleRate=44100` → `initializeOpenDAW` must thread `new AudioContext({sampleRate})`. Check `src/lib/projectSetup.ts` for an existing option; if absent, add `audioContextSampleRate?: number` to its options (backward-compatible) and wire the query param in the audit-relevant pages only. Gates + commit.
- [ ] **Step 2: #367 known-positive.** At `?sampleRate=44100`, 120 BPM, Click "Count-in only", record past one count-in; tap the destination with an AnalyserNode; assert the boundary click IS present (leak) — the live-harness validation. At `?sampleRate=48000` record the observed behavior (either outcome is data — float rounding decides; note it in the campaign table and in issue #367 as a measured datapoint if informative).
- [ ] **Step 3: C5 measurements.** At 44100 and 48000: record 3 takes; read per-take `waveformOffset`/`duration` from the box graph and compare against `headStart + countIn + latencies` expectations and wrap-boundary tempo math (values logged as strings per repo logging rule). Look for rate-dependent drift in take boundaries (>1 ms flag). Record results in the campaign note.
- [ ] **Step 4:** Commit — `docs: audit live-rate results (recording path, #367 validation)`

---

### Task 10: Publish

- [ ] **Step 1:** Finalize the campaign note: register (with per-entry outcomes: confirmed/cleared/open), full matrix table, live results, cleared-suspects section, harness-usage instructions for future SDK upgrades.
- [ ] **Step 2:** Per confirmed bug: individual `debug/<slug>.md` (measured signature, cause at tag, alignment analysis, prediction check) + draft issue body in `debug/drafts/issue-<slug>.md` — measured signature + cause analysis, NO suggested-fix section.
- [ ] **Step 3: STOP — user review gate.** Present the drafts; file ONLY the ones the user approves (`gh issue create` on andremichelle/openDAW); cross-link issue numbers into notes and `debug/README.md`.
- [ ] **Step 4:** Root CLAUDE.md: one line under the build/verification section pointing at the harness as the standing cross-rate regression sweep (`samplerate-audit-debug-demo.html?family=all…` + campaign note path).
- [ ] **Step 5:** Gates (`npm test`, tsc, build), push branch, `gh pr create` (body: campaign summary, matrix stats, findings list, link to campaign note; standard trailer), run the repo's comprehensive PR review per convention, fix Critical/Important, then merge per the user's call. This PR completes the spec → delete `docs/superpowers/specs/2026-08-27-samplerate-alignment-audit-design.md` and this plan file in it.

---

## Self-Review Notes

- **Spec coverage:** matrix axes/judgment (T1/T3/T8), harness + validation rows (T5/T6 — known-positive #367 moved to the LIVE phase T9 because count-in cannot render offline; the spec's harness-validation intent is covered by T6's known-clean seam row + synthetic known-positive knob + T9's live #367 row), suspect register (T7), triage/prediction/fixed-on-main (T8), recording path (T9), publication + review gate + regression-harness documentation (T10). Deviation from spec noted: spec placed the #367 known-positive in the offline harness validation; count-in is a live-transport feature, so it validates the live harness instead — the synthetic shifted-expectation knob (T6.3) replaces it as the offline detector check.
- **Placeholder scan:** builder task references existing repo patterns by exact file for the SDK-heavy parts and defines every scenario's constants in Task 1; no TBDs.
- **Type consistency:** `AuditFamily`/`AUDIT_SCENARIOS`/`expectedOnsets` (T1) ↔ builders (T4) ↔ page (T5) ↔ `CellMeasurement`/`judgeCell`/`assessRateConsistency` (T3) ↔ calibration/tolerances module (T6) — names checked verbatim.
