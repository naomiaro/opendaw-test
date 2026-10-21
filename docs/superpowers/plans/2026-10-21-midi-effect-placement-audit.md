# MIDI Effect Placement Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline-render page that reads how far each stock MIDI effect moves a note against the position its own rule predicts, an `&effect=` arm on the MIDI input alignment sweep, a register for both, and the three held upstream drafts brought up to date with what was measured.

**Architecture:** Pure measurement and rule code lives in `src/lib/audit/midiEffect*.ts` (Node-tested); the page `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx` only builds the Nano project, inserts devices, renders through `renderOfflineSlice` and calls the library. Part 2 threads one `effect` value through the existing sweep's context builder, row, summary and table script. Registers and drafts are edited after the two browser runs.

**Tech Stack:** TypeScript (strict), React + Radix (page only), Vitest in Node (real box graph via `src/lib/testing/boxGraphFixtures.ts`), openDAW SDK (`EffectFactories`, `ScriptCompiler`, `OfflineEngineRenderer` through `renderOfflineSlice`), the dev server's `/__verify` sink.

**Spec:** `docs/superpowers/specs/2026-10-21-midi-effect-placement-audit-design.md`

## Global Constraints

- Branch `audit/midi-effect-placement` off `main`; squash-merged PR; the spec and this plan are deleted in the PR's last commit.
- `editing.modify()` for every box change; device insertion and its parameter writes in separate transactions; the Spielwerk compile outside any transaction; Option API only (`isEmpty()` / `unwrap()`, never `?.` on an Option); integer PPQN positions; `strict` TypeScript.
- No edits under `src/` or `public/` while a browser run is in progress; `debug/*.md` edits are safe.
- Nothing in the PR names the fork or its trackers (`grep -ri moises` on the diff before pushing); no session URLs anywhere; no version qualifiers ("0.0.176", "since") outside `changelogs/` and `debug/` (`grep -nE '0\.0\.1[0-9]{2}' on the diff outside those dirs`).
- `npm run typecheck`, `npx vitest run`, `npm run build` clean before the PR; the comprehensive PR review runs once the PR is open and Critical/Important findings are fixed before merge.
- Drafts stay `TO-REVIEW-*`; nothing is posted upstream in this PR.
- Every tolerance names its mechanism; the pass-through tolerance is `lag === 0`, the rule tolerance `|onset − expected| ≤ 1` frame. Neither is widened to fit a row.
- SDK facts this plan relies on (verified in the checkout and the installed `.d.ts`): MIDI effect `enabled` is a `BooleanField` on every device box; `insertEffect(field, factory, insertIndex?)` returns the `EffectBox` union (cast); `EffectFactories.Zeitgeist` creates its own `GrooveShuffleBox` (`duration` 480, `amount` 0.6) and the device's `groove` pointer is mandatory, as is an incoming edge on the groove box; `ScriptCompiler` is in `@opendaw/studio-adapters`, config `{ headerTag: "spielwerk", registryName: "spielwerkProcessors", functionName: "spielwerk" }`, and `OfflineEngineRenderer` only re-registers a Spielwerk whose `code` carries the compiled header; `ZeitgeistDeviceBoxAdapter.groove()` is a method returning a `GrooveAdapter` with `warp(ppqn)`; the arpeggiator steps on the absolute grid `k × rate`, a note whose start is at or before a grid line is in the stack at that line, `rateIndex` 9 = 1/16 = 240 pulses, output velocity is 1.0 at the default `velocity` 0; Zeitgeist warps note-on and note-off positions per `duration` cell with the cell start fixed; Pitch and Velocity copy the record and never touch `position`; `createNoteEvent({ owner, position, duration, pitch, velocity?, cent?, chance? })` accepts the `NoteRegionBox` as `owner` and defaults velocity to 1.0; `PPQN.Quarter` 960, `PPQN.SemiQuaver` 240, `BAR_PPQN` 3840 (`src/lib/audit/auditExpectations.ts`).

## Review Focus

1. A render that is silent (the burst did not load, a device muted it): the page must report `error` on that row with the peak, never `as-predicted` from `bestLag` of two zero arrays (lag 0, score 0). Test in Task 3 (`judgePassThrough` with a silent candidate).
2. A rule row that finds more onsets than the rule predicts (an arpeggiator emitting twice, a Spielwerk forwarding AND yielding): the count mismatch must be the verdict, not a per-onset figure against a shorter expected list. Test in Task 3.
3. A `?device=` value that is not a device, a `?rate=` that is not 44100 or 48000, a `?bpm=` that is not a positive number: the page must set `error:<message>` in `#audit-state` before any render. Tests in Task 4 (`resolveDevices`) and Task 6 (`resolveRate`, `resolveBpm`).
4. Deleting the Zeitgeist device without its groove box: the transaction rolls back ("Target … requires an edge") and the next render still carries the device. Test in Task 5 on a real box graph.
5. A schema-2 MIDI sweep summary read by the updated table script: `effect` must default to `"none"` for every row and for the run line, not print `undefined`. Test in Task 8.

---

### Task 1: Rule functions

**Files:**
- Create: `src/lib/audit/midiEffectRules.ts`
- Modify: `src/lib/testing/boxGraphFixtures.ts` (add `graphWithZeitgeist`)
- Test: `src/lib/audit/midiEffectRules.test.ts`

**Interfaces:**
- Consumes: `PPQN` from `@opendaw/lib-dsp`; `GrooveShuffleBoxAdapter`, `ParameterFieldAdapters`, `BoxAdaptersContext` from `@opendaw/studio-adapters`; `ZeitgeistDeviceBox`, `GrooveShuffleBox` from `@opendaw/studio-boxes`.
- Produces:
  - `arpeggioSteps(holdFrom: number, holdTo: number, ratePpqn: number): number[]` — every `k × ratePpqn` with `holdFrom ≤ k × ratePpqn < holdTo`, ascending.
  - `echoCopies(position: number, delayPpqn: number, repeats: number): number[]` — `position + i × delayPpqn` for `i = 0 … repeats − 1`.
  - `zeitgeistWarped(positions: readonly number[], groove: { warp(position: number): number }): number[]` — each position through `groove.warp`, rounded to an integer pulse.
  - `expectedFrames(positions: readonly number[], bpm: number, rate: number, instrumentOffsetFrames: number): number[]` — `Math.round(PPQN.pulsesToSeconds(p, bpm) × rate) + instrumentOffsetFrames` per position.
  - `instrumentOffsetFrames(dryFirstOnset: number, firstPositionPpqn: number, bpm: number, rate: number): number` — `dryFirstOnset − Math.round(PPQN.pulsesToSeconds(firstPositionPpqn, bpm) × rate)`.
  - Fixture `graphWithZeitgeist(): { boxGraph: Graph; unit: AudioUnitBox; device: ZeitgeistDeviceBox; groove: GrooveShuffleBox }` — one instrument unit with a `ZeitgeistDeviceBox` on `unit.midiEffects` (`host.refer(unit.midiEffects)`, `index` 0, label "Zeitgeist") pointing at a `GrooveShuffleBox` (label "Shuffle", `duration` 480, `amount` 0.6), all in one `transact`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { GrooveShuffleBoxAdapter, ParameterFieldAdapters, type BoxAdaptersContext } from "@opendaw/studio-adapters";
import { graphWithZeitgeist, transact } from "@/lib/testing/boxGraphFixtures";
import { arpeggioSteps, echoCopies, expectedFrames, instrumentOffsetFrames, zeitgeistWarped } from "./midiEffectRules";

describe("arpeggioSteps", () => {
  it("lands on the absolute grid, includes a start on a grid line and excludes an end on one", () => {
    expect(arpeggioSteps(3840, 5760, 240)).toEqual([3840, 4080, 4320, 4560, 4800, 5040, 5280, 5520]);
    expect(arpeggioSteps(3850, 5760, 240)).toEqual([4080, 4320, 4560, 4800, 5040, 5280, 5520]);
  });
});

describe("echoCopies", () => {
  it("yields the original and repeats − 1 copies", () => {
    expect(echoCopies(3840, 120, 3)).toEqual([3840, 3960, 4080]);
    expect(echoCopies(3840, 120, 1)).toEqual([3840]);
  });
});

describe("zeitgeistWarped", () => {
  const adapterFor = (amount: number) => {
    const { boxGraph, groove } = graphWithZeitgeist();
    transact(boxGraph, () => groove.amount.setValue(amount));
    const context = { parameterFieldAdapters: new ParameterFieldAdapters(), isMainThread: false } as unknown as BoxAdaptersContext;
    return new GrooveShuffleBoxAdapter(context, groove);
  };
  it("keeps every cell start where it is and pushes the off-beat later at the factory amount", () => {
    const warped = zeitgeistWarped([3840, 4080, 4320, 4560], adapterFor(0.6));
    expect(warped[0]).toBe(3840);
    expect(warped[2]).toBe(4320);
    expect(warped[1]).toBeGreaterThan(4080);
    expect(warped[1]).toBeLessThan(4320);
    expect(warped[3]).toBe(4560 + (warped[1] - 4080));
  });
  it("is the identity at amount 0.5", () => {
    expect(zeitgeistWarped([3840, 4080, 4320], adapterFor(0.5))).toEqual([3840, 4080, 4320]);
  });
});

describe("frames", () => {
  it("maps pulses to frames at the tempo and adds the instrument offset", () => {
    expect(expectedFrames([3840, 4080], 120, 48000, 7)).toEqual([96007, 102007]);
    expect(instrumentOffsetFrames(96007, 3840, 120, 48000)).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audit/midiEffectRules.test.ts`
Expected: FAIL (module and fixture not found).

- [ ] **Step 3: Add `graphWithZeitgeist` to `src/lib/testing/boxGraphFixtures.ts`**

Build it like `graphWithSamplers`: `ProjectSkeleton.empty(...)`, `AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None)`, then inside the same `transact` create the groove box first and the device box second (the groove is a mandatory-edge target, so the pointer must exist when the transaction ends).

- [ ] **Step 4: Implement `src/lib/audit/midiEffectRules.ts`**

The signatures above. `arpeggioSteps` starts at `Math.ceil(holdFrom / ratePpqn)` (an exact division stays on the line). If the `GrooveShuffleBoxAdapter` constructor rejects the minimal context, build the groove the same way the adapter does — `new GroovePattern({ duration, fx: x => moebiusEase(x, h), fy: y => moebiusEase(y, 1 − h) })` with `h = squashUnit(amount, 0.01)` from the SDK — and note the fallback in the file header; the page still reads the warp through the device adapter.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/audit/midiEffectRules.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit/midiEffectRules.ts src/lib/audit/midiEffectRules.test.ts src/lib/testing/boxGraphFixtures.ts
git commit -m "audit: MIDI effect placement — rule functions (arpeggio grid, echo copies, Zeitgeist warp)"
```

---

### Task 2: Scenarios, patterns, scripts

**Files:**
- Create: `src/lib/audit/midiEffectScenarios.ts`
- Test: `src/lib/audit/midiEffectScenarios.test.ts`

**Interfaces:**
- Consumes: `PPQN` (`@opendaw/lib-dsp`), `BAR_PPQN` (`./auditExpectations`).
- Produces:
  - Constants: `BURST_STEP_MS = 10`, `BURST_FALL_MS = 10`, `ONSET_THRESHOLD = 0.05`, `ONSET_SKIP_MS = 30`, `MAX_LAG_FRAMES = 2400`, `SCORE_FLOOR = 0.9`, `RULE_TOLERANCE_FRAMES = 1`, `REGION_POSITION_PPQN = BAR_PPQN`, `REGION_DURATION_PPQN = 2 * PPQN.Quarter`, `ARPEGGIO_RATE_INDEX = 9`, `ARPEGGIO_RATE_PPQN = 240`, `ZEITGEIST_AMOUNT = 0.6`, `ZEITGEIST_DURATION_PPQN = 480`, `ECHO_DELAY_PPQN = 120`, `ECHO_REPEATS = 3`, `RENDER_TAIL_SECONDS = 0.25`, `NANO_ATTACK_SECONDS = 0.001`, `NANO_RELEASE_SECONDS = 0.001`, `NOTE_PITCH = 60`.
  - `MIDI_EFFECT_DEVICES = ["pitch", "velocity", "arpeggio", "zeitgeist", "spielwerk"] as const`; `type MidiEffectDevice`.
  - `MIDI_EFFECT_ROW_IDS = ["dry", "pitch", "velocity", "spielwerk-forward", "spielwerk-yield", "arpeggio", "zeitgeist", "spielwerk-echo", "pitch-disabled", "velocity-disabled", "arpeggio-disabled", "zeitgeist-disabled", "spielwerk-disabled"] as const`; `type MidiEffectRowId`.
  - `interface PatternNote { position: number; duration: number }` (region-local pulses; pitch and velocity are fixed at 60 / 1.0).
  - `interface MidiEffectScenario { id: MidiEffectRowId; label: string; device: MidiEffectDevice | null; enabled: boolean; script: string | null; pattern: readonly PatternNote[]; judge: "pass-through" | "rule"; rule: "arpeggio" | "zeitgeist" | "echo" | null }`.
  - `DRY_PATTERN` (eight notes at `k × 240`, `k = 0 … 7`, duration 120), `HOLD_PATTERN` (one note at 0, duration 1920), `ECHO_PATTERN` (one note at 0, duration 120).
  - `SPIELWERK_FORWARD`, `SPIELWERK_YIELD`, `SPIELWERK_ECHO: string` — see Step 3.
  - `MIDI_EFFECT_SCENARIOS: readonly MidiEffectScenario[]` in the row-id order above; the dry row first.
  - `resolveDevices(param: string | null): MidiEffectScenario[]` — `null` or `"all"` → every scenario; a device name → the dry row plus every scenario of that device (enabled and disabled); anything else throws `unknown ?device= "<x>" — use all|pitch|velocity|arpeggio|zeitgeist|spielwerk`.
  - `renderSeconds(bpm: number): number` — `PPQN.pulsesToSeconds(2 * BAR_PPQN, bpm) + RENDER_TAIL_SECONDS`.
  - `burstChannel(rate: number): Float32Array` — `round(0.02 × rate)` frames: full scale (1.0) for the first `BURST_STEP_MS`, then a linear fall to 0 over `BURST_FALL_MS`.
  - `expectedOnsetCount(scenario: MidiEffectScenario): number` — dry and pass-through rows: `pattern.length`; arpeggio: `REGION_DURATION_PPQN / ARPEGGIO_RATE_PPQN` (8); zeitgeist: 8; echo: `ECHO_REPEATS` (3).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  burstChannel, DRY_PATTERN, expectedOnsetCount, MIDI_EFFECT_SCENARIOS, renderSeconds, resolveDevices,
  SPIELWERK_ECHO, SPIELWERK_FORWARD, SPIELWERK_YIELD,
} from "./midiEffectScenarios";

describe("MIDI_EFFECT_SCENARIOS", () => {
  it("starts with the dry row and judges every device row by exactly one method", () => {
    expect(MIDI_EFFECT_SCENARIOS[0].id).toBe("dry");
    for (const s of MIDI_EFFECT_SCENARIOS) {
      expect(s.judge === "rule").toBe(s.rule !== null);
      expect(s.script !== null).toBe(s.device === "spielwerk");
    }
  });
  it("carries the echo script on the disabled Spielwerk row and the hold pattern on the arpeggio row", () => {
    const byId = (id: string) => MIDI_EFFECT_SCENARIOS.find((s) => s.id === id)!;
    expect(byId("spielwerk-disabled").script).toBe(SPIELWERK_ECHO);
    expect(byId("spielwerk-disabled").enabled).toBe(false);
    expect(byId("arpeggio").pattern).toEqual([{ position: 0, duration: 1920 }]);
    expect(byId("zeitgeist").pattern).toBe(DRY_PATTERN);
  });
  it("declares the pass-through directive only on the yield script", () => {
    expect(SPIELWERK_YIELD).toMatch(/^\/\/ @no-pass$/m);
    expect(SPIELWERK_FORWARD).not.toMatch(/@no-pass/);
    expect(SPIELWERK_ECHO).not.toMatch(/@no-pass/);
  });
});

describe("resolveDevices", () => {
  it("keeps the dry row in every selection and rejects an unknown device", () => {
    expect(resolveDevices(null).length).toBe(13);
    expect(resolveDevices("pitch").map((s) => s.id)).toEqual(["dry", "pitch", "pitch-disabled"]);
    expect(resolveDevices("spielwerk").map((s) => s.id)).toEqual(["dry", "spielwerk-forward", "spielwerk-yield", "spielwerk-echo", "spielwerk-disabled"]);
    expect(() => resolveDevices("compressor")).toThrow(/unknown \?device=/);
  });
});

describe("expectations", () => {
  it("counts the onsets each rule predicts and sizes the render to two bars plus the tail", () => {
    const byId = (id: string) => MIDI_EFFECT_SCENARIOS.find((s) => s.id === id)!;
    expect(expectedOnsetCount(byId("dry"))).toBe(8);
    expect(expectedOnsetCount(byId("arpeggio"))).toBe(8);
    expect(expectedOnsetCount(byId("spielwerk-echo"))).toBe(3);
    expect(renderSeconds(120)).toBeCloseTo(4.25, 6);
  });
  it("builds a burst with a full-scale head that is over within 20 ms", () => {
    const burst = burstChannel(48000);
    expect(burst.length).toBe(960);
    expect(burst[0]).toBe(1);
    expect(burst[479]).toBe(1);
    expect(burst[959]).toBeCloseTo(0, 2);
    expect(burst[720]).toBeCloseTo(0.5, 1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audit/midiEffectScenarios.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/audit/midiEffectScenarios.ts`**

The three scripts, exact user code (no header; `ScriptCompiler.compile` prepends it):

```js
// SPIELWERK_FORWARD — the generator yields nothing; the bridge forwards the input verbatim
class Processor {
    * process(block, events) {
        for (const event of events) {}
    }
}
```

```js
// SPIELWERK_YIELD — `// @no-pass` on its own line, then every note-on yielded unchanged
// @no-pass
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                yield { position: event.position, duration: event.duration, pitch: event.pitch, velocity: event.velocity, cent: event.cent }
            }
        }
    }
}
```

```js
// SPIELWERK_ECHO — the studio's echo example with its parameters fixed (delay 120, repeats 3, duration 120, no decay)
class Processor {
    * process(block, events) {
        for (const event of events) {
            if (event.gate) {
                for (let i = 1; i < 3; i++) {
                    yield { position: event.position + i * 120, duration: Math.min(event.duration, 120), pitch: event.pitch, velocity: event.velocity, cent: event.cent }
                }
            }
        }
    }
}
```

Labels: `dry (no device)`, `Pitch (0 st, 0 ct, 0 oct)`, `Velocity (factory: identity)`, `Spielwerk, forward (generator yields nothing)`, `Spielwerk, yield (@no-pass, every note re-yielded)`, `Arpeggio (Up, 1 octave, 1/16, gate 1, repeat 1)`, `Zeitgeist (amount 0.6, duration 480)`, `Spielwerk, echo (delay 120, 3 repeats)`, and `<Device>, disabled` for the five bypass rows.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audit/midiEffectScenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectScenarios.ts src/lib/audit/midiEffectScenarios.test.ts
git commit -m "audit: MIDI effect placement — scenario table, patterns, Spielwerk scripts, burst"
```

---

### Task 3: Onsets and judgement

**Files:**
- Create: `src/lib/audit/midiEffectPlacement.ts`
- Test: `src/lib/audit/midiEffectPlacement.test.ts`

**Interfaces:**
- Consumes: `bestLag` (`./lagEstimate`), `firstOnsetIndex` (`./clickHead`).
- Produces:
  - `type RowVerdict = { status: "as-predicted" } | { status: "investigate"; figure: string } | { status: "error"; message: string }`.
  - `onsetsOf(samples: Float32Array, rate: number, threshold: number, skipMs: number): number[]` — repeated `firstOnsetIndex(samples, threshold, from)`, each hit followed by `from = hit + round(skipMs / 1000 × rate)`.
  - `interface PassThroughJudgement { kind: "pass-through"; lag: number; score: number; peak: number; verdict: RowVerdict }`
  - `judgePassThrough(reference: Float32Array, candidate: Float32Array, maxLag: number, scoreFloor: number): PassThroughJudgement` — `error` when the candidate's peak is 0 (`render is silent (peak 0)`); `investigate` with `lag <n> frames (<ms> ms), score <s>` when `score ≥ scoreFloor` and `lag !== 0`; `investigate` with `score <s> below <floor>: shift outside ±<maxLag> frames or a different render` when the score is under the floor; else `as-predicted`.
  - `interface RuleJudgement { kind: "rule"; onsets: number[]; expected: number[]; deltas: number[]; verdict: RowVerdict }`
  - `judgeRule(onsets: readonly number[], expected: readonly number[], toleranceFrames: number, rate: number): RuleJudgement` — `investigate` with `<found> onsets, rule predicts <n>` when the counts differ (deltas empty); else deltas `onset − expected` per index, `investigate` naming the largest `|delta|` as `onset <i> off by <d> frames (<ms> ms)` when any exceeds the tolerance; else `as-predicted`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { judgePassThrough, judgeRule, onsetsOf } from "./midiEffectPlacement";

const RATE = 48000;
const burstsAt = (frames: number[], length = RATE): Float32Array => {
  const out = new Float32Array(length);
  for (const at of frames) for (let i = 0; i < 480 && at + i < length; i++) out[at + i] = 1 - i / 480;
  return out;
};

describe("onsetsOf", () => {
  it("finds each burst once and steps past its body", () => {
    expect(onsetsOf(burstsAt([1000, 4000, 7000]), RATE, 0.05, 30)).toEqual([1000, 4000, 7000]);
    expect(onsetsOf(new Float32Array(RATE), RATE, 0.05, 30)).toEqual([]);
  });
});

describe("judgePassThrough", () => {
  it("reads a shifted copy as its shift and an identical one as predicted", () => {
    const dry = burstsAt([1000, 4000]);
    expect(judgePassThrough(dry, dry, 2400, 0.9).verdict).toEqual({ status: "as-predicted" });
    const late = judgePassThrough(dry, burstsAt([1240, 4240]), 2400, 0.9);
    expect(late.lag).toBe(240);
    expect(late.verdict.status).toBe("investigate");
  });
  it("reports a silent render as an error and a different render as a low score", () => {
    const dry = burstsAt([1000, 4000]);
    expect(judgePassThrough(dry, new Float32Array(RATE), 2400, 0.9).verdict.status).toBe("error");
    const different = judgePassThrough(dry, burstsAt([1000, 4000, 7000, 10000]), 2400, 0.9);
    expect(different.verdict.status).toBe("investigate");
    expect((different.verdict as { figure: string }).figure).toMatch(/below 0.9/);
  });
});

describe("judgeRule", () => {
  it("accepts one frame, flags two, and flags a count mismatch before any figure", () => {
    expect(judgeRule([1001, 4000], [1000, 4000], 1, RATE).verdict).toEqual({ status: "as-predicted" });
    const off = judgeRule([1002, 4000], [1000, 4000], 1, RATE);
    expect(off.verdict.status).toBe("investigate");
    expect((off.verdict as { figure: string }).figure).toMatch(/onset 0 off by 2 frames/);
    const count = judgeRule([1000, 4000, 7000], [1000, 4000], 1, RATE);
    expect(count.deltas).toEqual([]);
    expect((count.verdict as { figure: string }).figure).toMatch(/3 onsets, rule predicts 2/);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audit/midiEffectPlacement.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/audit/midiEffectPlacement.ts`** with the signatures above.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audit/midiEffectPlacement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectPlacement.ts src/lib/audit/midiEffectPlacement.test.ts
git commit -m "audit: MIDI effect placement — onset reader and the two judgements"
```

---

### Task 4: Artifacts and the table script

**Files:**
- Create: `src/lib/audit/midiEffectArtifacts.ts`, `scripts/audit/midi-effect-placement/table.ts`
- Test: `src/lib/audit/midiEffectArtifacts.test.ts`

**Interfaces:**
- Consumes: `MidiEffectRowId`, `MidiEffectDevice` (Task 2), `RowVerdict` (Task 3).
- Produces:
  - `MIDI_EFFECT_SCHEMA_VERSION = 1`.
  - `interface MidiEffectRowRecord { id: MidiEffectRowId; label: string; device: MidiEffectDevice | null; enabled: boolean; judge: "pass-through" | "rule"; status: RowVerdict["status"]; figure: string | null; lag: number | null; score: number | null; peak: number; onsets: number[]; expected: number[]; deltas: number[]; expectedCount: number }`.
  - `interface MidiEffectSummary { schemaVersion: number; runToken: number; userAgent: string; sdkVersion: string; sampleRate: number; bpm: number; instrumentOffsetFrames: number; deviceParam: string; rows: MidiEffectRowRecord[] }`.
  - `summaryFileName(runToken: number): string` → `midifx-summary-<runToken>.json`.
  - `parseMidiEffectSummary(json: unknown, runToken: number): MidiEffectSummary` — throws on a non-object, an unknown `schemaVersion`, or `rows` not an array; every row must carry a numeric `peak` and arrays `onsets`/`expected`/`deltas`.
  - `scripts/audit/midi-effect-placement/table.ts` — same shape as the MIDI sweep's table script (newest summary when no token; `.verify-output/`): one line per row `id | status | figure | lag/score | onsets found/expected | max |delta| ms`, then a run line `run <token> | sdk <v> | <rate> Hz | <bpm> bpm | instrument offset <n> frames | rows <n>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { MIDI_EFFECT_SCHEMA_VERSION, parseMidiEffectSummary, summaryFileName } from "./midiEffectArtifacts";

describe("midiEffectArtifacts", () => {
  const row = { id: "dry", peak: 1, onsets: [1], expected: [1], deltas: [0] };
  const ok = { schemaVersion: MIDI_EFFECT_SCHEMA_VERSION, runToken: 1, rows: [row] };
  it("names the summary by run token", () => {
    expect(summaryFileName(1700000000000)).toBe("midifx-summary-1700000000000.json");
  });
  it("parses the current schema and rejects another, a missing rows array and a row without its figures", () => {
    expect(parseMidiEffectSummary(ok, 1).rows.length).toBe(1);
    expect(() => parseMidiEffectSummary({ ...ok, schemaVersion: 2 }, 1)).toThrow(/schemaVersion/);
    expect(() => parseMidiEffectSummary({ ...ok, rows: null }, 1)).toThrow(/rows/);
    expect(() => parseMidiEffectSummary({ ...ok, rows: [{ ...row, onsets: undefined }] }, 1)).toThrow(/onsets/);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/lib/audit/midiEffectArtifacts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the artifacts module and the table script**

The script imports with an explicit `.ts` extension (`../../../src/lib/audit/midiEffectArtifacts.ts`), like `scripts/audit/midi-input-alignment/table.ts`.

- [ ] **Step 4: Run the test to see it pass; run the script against no summary**

Run: `npx vitest run src/lib/audit/midiEffectArtifacts.test.ts` → PASS.
Run: `node scripts/audit/midi-effect-placement/table.ts` → prints `no midifx summary in …/.verify-output` and exits 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectArtifacts.ts src/lib/audit/midiEffectArtifacts.test.ts scripts/audit/midi-effect-placement/table.ts
git commit -m "audit: MIDI effect placement — summary schema and register table script"
```

---

### Task 5: Device chain helper (Zeitgeist removal on a real box graph)

**Files:**
- Create: `src/lib/audit/midiEffectChain.ts`
- Test: `src/lib/audit/midiEffectChain.test.ts`

**Interfaces:**
- Consumes: `graphWithZeitgeist`, `transact` (Task 1 fixture); `BoxEditing` from `@opendaw/lib-box`; `ZeitgeistDeviceBox`, `GrooveShuffleBox` from `@opendaw/studio-boxes`; `EffectBox` from `@opendaw/studio-core`.
- Produces:
  - `zeitgeistGrooveBox(box: ZeitgeistDeviceBox): GrooveShuffleBox` — `box.groove.targetVertex.unwrap("Zeitgeist has no groove").box` as `GrooveShuffleBox`.
  - `removeMidiEffect(editing: { modify(fn: () => void): unknown }, box: EffectBox): void` — one transaction: when the box is a `ZeitgeistDeviceBox`, resolve the groove first, `box.delete()`, then `groove.delete()`; otherwise `box.delete()`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { BoxEditing } from "@opendaw/lib-box";
import { graphWithZeitgeist } from "@/lib/testing/boxGraphFixtures";
import { removeMidiEffect, zeitgeistGrooveBox } from "./midiEffectChain";

describe("removeMidiEffect", () => {
  it("deletes a Zeitgeist together with its groove, leaving no box behind", () => {
    const { boxGraph, unit, device, groove } = graphWithZeitgeist();
    expect(zeitgeistGrooveBox(device)).toBe(groove);
    removeMidiEffect(new BoxEditing(boxGraph), device);
    expect(boxGraph.findBox(device.address.uuid).isEmpty()).toBe(true);
    expect(boxGraph.findBox(groove.address.uuid).isEmpty()).toBe(true);
    expect(unit.midiEffects.pointerHub.incoming().length).toBe(0);
  });
  it("shows why: deleting the device alone is refused, the groove's edge being mandatory", () => {
    const { boxGraph, device } = graphWithZeitgeist();
    const editing = new BoxEditing(boxGraph);
    expect(() => editing.modify(() => device.delete())).toThrow(/requires an edge/);
  });
});
```

If the second test's rollback surfaces as a `console.warn` plus a rolled-back graph rather than a throw, assert that instead: spy on `console.warn` for `requires an edge` and assert `findBox(device uuid).nonEmpty()` afterwards (the warning spy keeps the run's output clean, per `vitest.config.ts`). Keep the test either way: it is Review Focus 4.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audit/midiEffectChain.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/audit/midiEffectChain.ts`**

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audit/midiEffectChain.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectChain.ts src/lib/audit/midiEffectChain.test.ts
git commit -m "audit: MIDI effect placement — remove a device with its groove in one transaction"
```

---

### Task 6: The placement page

**Files:**
- Create: `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx`, `midi-effect-placement-audit-debug-demo.html`
- Modify: `vite.config.ts` (rollup input `midiEffectPlacementAudit` beside `midiAudioCombinedAudit`)

**Interfaces:**
- Consumes: everything Tasks 1–5 export; `initializeOpenDAW` (`@/lib/projectSetup`, with `localAudioBuffers`, `bpm`, `audioContextSampleRate`); `renderOfflineSlice` (`@/lib/offlineScan`); `midiEffectsFieldOf` (`@/lib/adapterUtils`); `TestStep`, `DebugLinkBar`, `GitHubCorner`, `MoisesLogo`, `BackLink`; `EffectFactories`, `OPENDAW_SDK_VERSION`; `ScriptCompiler`, `ZeitgeistDeviceBoxAdapter`, `InstrumentFactories` (`@opendaw/studio-adapters`); `AudioFileBox`, `ArpeggioDeviceBox`, `PitchDeviceBox`, `VelocityDeviceBox`, `ZeitgeistDeviceBox`, `SpielwerkDeviceBox`, `NanoDeviceBox`, `NoteRegionBox`, `NoteEventBox` (`@opendaw/studio-boxes`).
- Produces: the page. Module-level, exported for nothing: `resolveRate(param: string | null): 44100 | 48000` (default 48000; anything else throws `invalid ?rate= "<x>" — 44100 or 48000`), `resolveBpm(param: string | null): number` (default 120; a non-positive or non-finite value throws `invalid ?bpm= "<x>"`).

- [ ] **Step 1: HTML entry and Vite input**

Copy `plugin-delay-compensation-debug-demo.html`; title `MIDI Effect Placement Audit`; script `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx`; keep `noindex, nofollow`. Add the rollup input. Not in `src/index.tsx`, not in the sitemap, no og-image.

- [ ] **Step 2: Page setup (effect on mount)**

Parse `?rate`, `?bpm`, `?device` at module level inside a try; a throw sets `#audit-state` to `error:<message>` and disables Run. On mount: `initializeOpenDAW({ localAudioBuffers, bpm, audioContextSampleRate: rate, onStatusUpdate })`; build the burst `AudioBuffer` (2 channels, `burstChannel(rate)` copied into both); register it under a fresh UUID in `localAudioBuffers`; in ONE transaction create the `AudioFileBox` (fileName `burst.wav`, `endInSeconds` = buffer duration) and `project.api.createInstrument(InstrumentFactories.Nano, { attachment: fileBox })`; in a SECOND transaction set `nanoBox.attack` / `nanoBox.release` to `NANO_ATTACK_SECONDS` / `NANO_RELEASE_SECONDS`, `rootKey` 60, `loop` false, and `project.api.createNoteRegion({ trackBox, position: REGION_POSITION_PPQN, duration: REGION_DURATION_PPQN, loopDuration: REGION_DURATION_PPQN, name: "pattern" })`; disable the timeline loop. Keep `audioUnitBox`, `nanoBox`, `regionBox` and the live `NoteEventBox[]` in refs. Status `Ready`.

- [ ] **Step 3: Pattern writer**

`writePattern(pattern)`: transaction 1 deletes every held `NoteEventBox` (`box.delete()`); transaction 2 (`editing.append`) creates one `createNoteEvent({ owner: regionBox, position, duration, pitch: NOTE_PITCH, velocity: 1 })` per note and replaces the held list. Skip both when the held pattern is the same array reference.

- [ ] **Step 4: Device insert, settings, compile, remove**

`insertDevice(scenario)`: transaction A `project.api.insertEffect(midiEffectsFieldOf(project, audioUnitBox), EffectFactories.<Device>)` cast per device; transaction B writes `box.enabled` = `scenario.enabled` and the settings — Pitch `semiTones` 0, `cents` 0, `octaves` 0; Velocity `magnetStrength` 0, `randomAmount` 0, `offset` 0, `mix` 1; Arpeggio `modeIndex` 0, `numOctaves` 1, `rateIndex` ARPEGGIO_RATE_INDEX, `gate` 1, `repeat` 1, `velocity` 0; Zeitgeist: on `zeitgeistGrooveBox(box)`, `amount` ZEITGEIST_AMOUNT and `duration` ZEITGEIST_DURATION_PPQN. For Spielwerk, after transaction B and outside any transaction: `await ScriptCompiler.create({ headerTag: "spielwerk", registryName: "spielwerkProcessors", functionName: "spielwerk" }).compile(audioContext, project.editing, box, scenario.script)`. Removal: `removeMidiEffect(project.editing, box)` in a `finally`.

- [ ] **Step 5: Run loop**

For each scenario of `resolveDevices(deviceParam)` (dry first): set `#audit-state` to `running:<id>`; `writePattern`; `insertDevice` (none for dry); `renderOfflineSlice(project, 0, renderSeconds(bpm), rate)`; left channel. Dry row: `onsetsOf(left, rate, ONSET_THRESHOLD, ONSET_SKIP_MS)`; its count must equal 8 or the run stops with `error:dry render found <n> onsets, expected 8`; `instrumentOffsetFrames(onsets[0], REGION_POSITION_PPQN, bpm, rate)` is kept for every later row; the dry record is `as-predicted` with its onsets. Pass-through rows: `judgePassThrough(dryLeft, left, MAX_LAG_FRAMES, SCORE_FLOOR)`. Rule rows: expected positions — arpeggio `arpeggioSteps(REGION_POSITION_PPQN, REGION_POSITION_PPQN + REGION_DURATION_PPQN, ARPEGGIO_RATE_PPQN)`; zeitgeist `zeitgeistWarped(DRY absolute positions, adapter.groove())` where `adapter = project.boxAdapters.adapterFor(box, ZeitgeistDeviceBoxAdapter)` resolved while the device exists; echo `echoCopies(REGION_POSITION_PPQN, ECHO_DELAY_PPQN, ECHO_REPEATS)` — then `expectedFrames(positions, bpm, rate, instrumentOffsetFrames)` and `judgeRule(onsets, expected, RULE_TOLERANCE_FRAMES, rate)`. A throw inside one scenario becomes that row's `error` record and the loop continues; the device is removed in `finally`. After the loop: PUT the `MidiEffectSummary` to `/__verify/<summaryFileName(runToken)>` under a 30 s deadline, set `done`.

- [ ] **Step 6: Markup**

Title `MIDI Effect Placement Audit`; `DebugLinkBar` to `https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-midi-effect-placement/note.md`; a gray intro paragraph (what the page renders, that every effect row is judged against the dry row of the same run, that the live key goes through the same chain so one render covers both); a `Badge id="audit-state" data-audit-state`; one `TestStep` whose `expected` rows read `lag 0, score ≥ 0.9` for pass-through rows and `<n> onsets, each within 1 frame of <rule>` for rule rows, and whose `got` rows carry the figure; a Radix `Table` of per-row detail (status, figure, lag/score, onsets found/expected, per-onset deltas in frames and ms). A footer line prints `instrumentOffsetFrames` and the run parameters.

- [ ] **Step 7: Typecheck and first browser run**

Run: `npm run typecheck` → exit 0.
Start the dev server if none is running (`lsof -ti :5173` first; reuse). Open `https://localhost:5173/midi-effect-placement-audit-debug-demo.html` in Chrome through claude-in-chrome, click Run by coordinates, wait for `#audit-state` = `done` (poll under 100 s). Then `node scripts/audit/midi-effect-placement/table.ts`. Read every row against its expectation; a row that is not `as-predicted` is read through the cause named in the spec's tolerance paragraphs (a quantum-boundary voice start shows in the dry row's own spacing first) before anything is changed. Do not widen a tolerance. Repeat with `?rate=44100` and `?bpm=90`. Save the three table outputs for Task 10.

- [ ] **Step 8: Commit**

```bash
git add midi-effect-placement-audit-debug-demo.html src/demos/midi/midi-effect-placement-audit-debug-demo.tsx vite.config.ts
git commit -m "audit: MIDI effect placement page — one Nano burst pattern rendered dry and through each MIDI effect"
```

---

### Task 7: The `&effect=` arm — calibration and artifacts

**Files:**
- Modify: `src/lib/audit/midiInputCalibration.ts`, `src/lib/audit/midiInputArtifacts.ts`
- Test: `src/lib/audit/midiInputArtifacts.test.ts` (extend)

**Interfaces:**
- Produces:
  - `MIDI_EFFECT_ARMS = ["none", "pitch", "arpeggio"] as const`; `type MidiEffectArm`; `isMidiEffectArm(value: string): value is MidiEffectArm`; `resolveEffectArm(param: string | null): MidiEffectArm` (`null` → `"none"`; unknown throws `unknown ?effect= "<x>" — use none|pitch|arpeggio`).
  - `MIDI_AUDIT_SCHEMA_VERSION = 3`, `MIDI_AUDIT_SCHEMA_VERSIONS_READABLE = [1, 2, 3]`; `effect: MidiEffectArm` on `MidiAuditRow` and `MidiAuditSummary`; `parseMidiAuditSummary` fills `effect` with `"none"` on every row and on the summary when absent (schema 1 and 2), and refuses a schema-3 summary whose rows or run lack it.

- [ ] **Step 1: Write the failing tests** (append to `midiInputArtifacts.test.ts`; add `src/lib/audit/midiInputCalibration.test.ts` if none exists for `resolveEffectArm`)

```ts
it("fills effect with none on older schemas and requires it on the current one", () => {
  const row = { missing: 0, receiptsMissing: 0, extra: 0, stuck: 0, collapsed: 0, countInNotes: 0, countInRecorded: 0 };
  const old = { schemaVersion: 2, rows: [row], cellVerdicts: [], runToken: 1 };
  const parsed = parseMidiAuditSummary(old, 1);
  expect(parsed.effect).toBe("none");
  expect(parsed.rows[0].effect).toBe("none");
  const current = { schemaVersion: MIDI_AUDIT_SCHEMA_VERSION, effect: "arpeggio", rows: [{ ...row, effect: "arpeggio" }], cellVerdicts: [], runToken: 1 };
  expect(parseMidiAuditSummary(current, 1).rows[0].effect).toBe("arpeggio");
  expect(() => parseMidiAuditSummary({ ...current, rows: [row] }, 1)).toThrow(/lacks effect/);
});
```

```ts
import { resolveEffectArm } from "./midiInputCalibration";
it("defaults to none and rejects an unknown arm", () => {
  expect(resolveEffectArm(null)).toBe("none");
  expect(resolveEffectArm("arpeggio")).toBe("arpeggio");
  expect(() => resolveEffectArm("zeitgeist")).toThrow(/unknown \?effect=/);
});
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/lib/audit/midiInputArtifacts.test.ts src/lib/audit/midiInputCalibration.test.ts` → FAIL.

- [ ] **Step 3: Implement** — bump the schema comment (`3: effect on every row and the run`), the types, the parser's fill-and-require logic.

- [ ] **Step 4: Run the whole audit test folder** — `npx vitest run src/lib/audit` → PASS (existing tests still construct rows without `effect` only through the parser, which now fills it; a test that builds a `MidiAuditRow` literal needs `effect: "none"` added).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiInputCalibration.ts src/lib/audit/midiInputCalibration.test.ts src/lib/audit/midiInputArtifacts.ts src/lib/audit/midiInputArtifacts.test.ts
git commit -m "audit: MIDI sweep — effect arm on the row and summary schema"
```

---

### Task 8: The `&effect=` arm — page and table

**Files:**
- Modify: `src/demos/midi/midi-input-alignment-audit-debug-demo.tsx`, `scripts/audit/midi-input-alignment/table.ts`

**Interfaces:**
- Consumes: Task 7's `resolveEffectArm`, `MidiEffectArm`; Task 5's `removeMidiEffect` (not needed at runtime: the device lives for the page; nothing removes it); `midiEffectsFieldOf`; `EffectFactories.Pitch` / `.Arpeggio`.

- [ ] **Step 1: Context builder**

`const EFFECT = resolveEffectArm(params.get("effect"))` at module level (inside the same try the other params use, so an unknown value lands in `error:` on Run). In `createMatrixContext`, after the capture transaction: when `EFFECT !== "none"`, transaction A inserts the device on `midiEffectsFieldOf(project, audioUnitBox)`, transaction B writes the same settings Task 6 uses for Pitch / Arpeggio. Log `effect=<arm>` in the existing `[midi-input-audit]` line. The header comment gains `[&effect=none|pitch|arpeggio]`.

- [ ] **Step 2: Rows and summary**

`errorRow` and `resultRow` set `effect: EFFECT`; the summary carries `effect: EFFECT`. The page heading's gray line mentions the arm when it is not `none`: `effect: <arm> on the recorded unit — the recorder reads before the chain, so every figure is expected unchanged`.

- [ ] **Step 3: Table**

Prefix the cell label with the effect when it is not `none` (`nominal-start+arpeggio`), and print `effect <arm>` in the run line.

- [ ] **Step 4: Typecheck and the two standing runs**

Run: `npm run typecheck` → exit 0. Chrome, IAC Driver online, window uncovered: `midi-input-alignment-audit-debug-demo.html?scenario=nominal-start&bpm=120&effect=arpeggio`, then `&effect=pitch`, then `&effect=none` as the same-session control. `node scripts/audit/midi-input-alignment/table.ts` after each. Expected: `notesRecorded === notesSent` (48) on every row, the three cells on the same band with medians inside the sweep's repeat spread of each other. Save the three tables for Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/demos/midi/midi-input-alignment-audit-debug-demo.tsx scripts/audit/midi-input-alignment/table.ts
git commit -m "audit: MIDI sweep — &effect= inserts a Pitch or Arpeggio on the recorded unit"
```

---

### Task 9: Register, index, CLAUDE.md

**Files:**
- Create: `debug/2026-10-21-midi-effect-placement/note.md`
- Modify: `debug/README.md`, `debug/2026-10-20-midi-input-alignment/note.md`, `debug/2026-10-20-midi-audio-combined/note.md`, `CLAUDE.md`, `src/demos/midi/CLAUDE.md`

- [ ] **Step 1: The register**

Header in the MIDI register's format (Title, SDK Pin `@opendaw/studio-sdk@0.0.176`, Harness with the URL and parameters, Measurement library listing the five new files, Design spec path with the deletion note). Sections: "What a row measures" (the burst, the pattern, dry reference, the two judgements with their tolerances and mechanisms, `instrumentOffsetFrames`); "What the engine does (read)" — the four points from the spec, with the file paths the survey confirmed (`crates/engine/src/audio_unit/wiring.rs` `wire_cluster` skipping a disabled device, `audio_unit/params.rs` `note_signal_to_unit`, `plugin_midi_effect.rs`, `RecordMidi.ts` reading the capture's raw signals); the per-device rule table from the spec with the settings used; "Runs" — the Task 6 tables (48 kHz / 120, 44.1 kHz / 120, 48 kHz / 90) pasted as-is with date and run tokens, and the Task 8 tables (effect arm) likewise; "Reading" — per row, as-predicted or what was found, in the register's evidence-not-advocacy voice; "Status" — standing regression check after SDK upgrades; "Open items".

- [ ] **Step 2: Index and the older registers**

`debug/README.md`: a newest-first row (Started 2026-10-21, What, Status, Repro page, Drafts column holding whatever Task 10 creates). "Waiting for a read": the hold bullet becomes "Both harnesses have run (2026-10-21, see the MIDI-effect register): the three drafts are ready for the user's read" and stays above the three links. MIDI register "Open items": replace the hold paragraph with the outcome and link; the "Follow-ups" bullet on MIDI effects becomes "measured, see …". Combined register "Open items": the hold bullet likewise.

- [ ] **Step 3: CLAUDE.md**

Root "Build & Verification": one bullet after the combined-sweep bullet — run `midi-effect-placement-audit-debug-demo.html?device=all` (real click, seconds, expect every row `as-predicted`; then `?rate=44100`), register path, table script; and extend the MIDI-sweep bullet with `?scenario=nominal-start&bpm=120&effect=arpeggio` then `&effect=pitch` (expect the same band and counts as without). `src/demos/midi/CLAUDE.md`: a "MIDI Effect Placement Audit (unlisted)" section — the page's parameters, that a MIDI effect is a pull link and a live key enters the same sequencer, that the recorder reads pre-effect, the two judgements and where the lib lives; and an `&effect=` line in the MIDI sweep section's parameter list. No version numbers in either file.

- [ ] **Step 4: Check the copy rules**

Run: `git diff main --name-only | grep -v '^changelogs/\|^debug/' | xargs grep -nE '0\.0\.1[0-9]{2}'` → no output. Run: `git diff main | grep -i moises` → no output.

- [ ] **Step 5: Commit**

```bash
git add debug/2026-10-21-midi-effect-placement/note.md debug/README.md debug/2026-10-20-midi-input-alignment/note.md debug/2026-10-20-midi-audio-combined/note.md CLAUDE.md src/demos/midi/CLAUDE.md
git commit -m "debug: MIDI effect placement register, index row, build-and-verification bullets"
```

---

### Task 10: The held drafts

**Files:**
- Modify: `debug/2026-10-20-midi-input-alignment/drafts/TO-REVIEW-openDAW-issue-midi-placement-late.md`, `…/TO-REVIEW-openDAW-issue-countin-pickup-notes.md`, `…/TO-REVIEW-openDAW-issue-release-lost-in-block.md`
- Create (only if a Task 6 or Task 8 row read `investigate` or `error` with an SDK cause): `debug/2026-10-21-midi-effect-placement/drafts/TO-REVIEW-openDAW-issue-<topic>.md`

- [ ] **Step 1: The two held-only drafts**

Replace each `HELD (2026-10-20)` header comment with: not posted; the combined harness and the MIDI-effect harness have run (dates); one sentence of what the effect runs showed about the recorded placement (the Arpeggio and Pitch arms recorded 48 of 48 notes on the same band, or what was found); waits for the user's read. Body unchanged unless an effect run touched its claim.

- [ ] **Step 2: The placement draft rewrite its header prescribes**

Do what the HELD comment asks, now that both harnesses have run: (a) a title on the combined measurement — the key lands about 33 ms after a sound recorded at the same heard instant once the audio input latency is calibrated, and about 31 ms before it uncalibrated; (b) replace the "That pairing has not been recorded together yet" sentence and the audio paragraph with the combined register's figures (parts apart in both states, the audio side 0.00 ms on its calibrated position, jitter 7–10 ms all on the MIDI side) and a link to `debug/2026-10-20-midi-audio-combined/note.md`; (c) add the order-of-fixes paragraph from the combined register: a MIDI-only correction moves an uncalibrated player's parts from 31 ms to about 64 ms apart, so the change should land with input-latency calibration or say so; (d) one sentence that a MIDI effect in the chain does not change where the note is written (Task 8's rows), with the register link; (e) the header comment becomes the Step 1 form. Keep the rows, the source reading and the SDK pin; no fix suggestion; no repo page beyond the two links; no fork name.

- [ ] **Step 3: New drafts, if any**

For each placement row that disagreed with its rule for an SDK reason: `TO-REVIEW-openDAW-issue-<topic>.md` in the new folder's `drafts/`, in the three drafts' form (title, SDK line, what happens, repro URL on `opendaw-test.pages.dev`, the table, "Read in the source" with the file paths, the register link; no fix section). Add it to "Waiting for a read" and the index row's Drafts column. If every row read `as-predicted`, create nothing and say so in the register's Status.

- [ ] **Step 4: Commit**

```bash
git add debug/
git commit -m "debug: bring the three held MIDI drafts up to date with the combined and effect runs"
```

---

### Task 11: Verification, PR, review, cleanup

- [ ] **Step 1: Full verification**

Run: `npm run typecheck` → exit 0. `npx vitest run` → all pass, output empty of warnings. `npm run build` → exit 0.

- [ ] **Step 2: Delete the spec and this plan; push; open the PR**

```bash
git rm docs/superpowers/specs/2026-10-21-midi-effect-placement-audit-design.md docs/superpowers/plans/2026-10-21-midi-effect-placement-audit.md
git commit -m "docs: remove the MIDI effect placement spec and plan (shipped)"
git push -u origin audit/midi-effect-placement
gh pr create --title "audit: MIDI effect placement — each stock MIDI effect against its own rule, and an effect arm on the MIDI sweep" --body-file <scratchpad>/pr-body.md
```

The PR body: what the page measures, the first-run table, the effect-arm result, the draft updates, the standing-run bullets; ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Grep the body for `moises` and the session URL before posting.

- [ ] **Step 3: Review and fixes**

Run `/pr-review-toolkit:review-pr` on the open PR; fix Critical and Important findings on the branch; edit the PR body (`gh pr edit --body-file`) to describe the final state. Merge only when the user says so (`gh pr merge <n> --squash`).

---

## Self-review notes

- Spec coverage: Part 1 → Tasks 1–6; Part 2 → Tasks 7–8; register and docs → Task 9; the user's decision on the drafts → Task 10; constraints → Global Constraints and Task 11. The spec's "Left to the builder" items are decided here: row order = `MIDI_EFFECT_ROW_IDS`; the disabled rows always run (no `?bypass=`); the burst is a 10 ms step + 10 ms fall; the table script is standalone.
- Deviation from the spec worth knowing: the Velocity row uses `mix` 1 (the engine's formula is the identity at `magnetStrength` 0, `randomAmount` 0, `offset` 0 whatever `mix` is; 1 is the factory value). The Arpeggio and Zeitgeist settings equal the factory defaults; they are still written explicitly so the register's numbers are the page's, not the SDK's.
- Type consistency: `RowVerdict` (Task 3) is what `MidiEffectRowRecord.status` (Task 4) and the page (Task 6) use; `MidiEffectArm` (Task 7) is what Task 8 threads through; `graphWithZeitgeist` (Task 1) serves Tasks 1 and 5.
