# WASM-Engine-Only Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every demo (live and offline) runs exclusively on the WASM (Rust) engine; all TypeScript-engine paths are removed from this repo, with full audio verification and upstream issue filing for regressions.

**Architecture:** `initializeOpenDAW()` installs, force-enables, and readies the WASM engine centrally before the first `startAudioWorklet()` — hard-throwing if it can't boot. Per-demo engine wiring (`onBeforeEngineStart`, `?engine=wasm`, `switchEngine`) is deleted; offline renders always pass `variant: true`.

**Tech Stack:** OpenDAW SDK 0.0.160 (`@opendaw/studio-core-wasm` `WasmEngine` façade), React demos, Vite, vitest, Playwright/claude-in-chrome + audio-analyzer MCP for verification.

**Spec:** `docs/superpowers/specs/2026-07-16-wasm-engine-only-design.md`

## Global Constraints

- Branch: `wasm-engine-only` (already created; spec committed).
- `documentation/*.md` is present-tense with **no SDK version pins** (`grep '0\.0\.[0-9]'` edited chapter docs before committing). `changelogs/`, `debug/`, CLAUDE.md files may keep pins.
- Verify audio demos by **measuring output signal (RMS)**, never by `isPlaying`/disabled buttons. Transport must be started with a REAL browser click (untrusted `.click()` silently fails to start audio).
- Reuse one dev server across verification rounds (kill by PID via `lsof -ti :<port> | xargs kill` if needed; don't leak ports).
- Vite skips `tsc` — "zero new errors" is judged by `npx tsc --noEmit --ignoreDeprecations "6.0"` baseline-diffed against main, filtered to `^src/`.
- PRs are squash-merged. Once the PR is open, run `/pr-review-toolkit:review-pr` and fix Critical + Important findings before merge.
- Spec and this plan file are deleted in the PR that completes the work.
- SDK bug reports go to `andremichelle/openDAW` as GitHub issues: live repro page URL + `debug/*.md` write-up + measured signature + suggested fix; cross-link the issue number back into the repro page's DebugLinkBar and debug note header.

---

### Task 1: Central WASM boot in `initializeOpenDAW` + remove per-demo engine wiring

**Files:**
- Modify: `src/lib/wasmEngine.ts:14-22` (force-enable in `installWasmEngine`)
- Modify: `src/lib/projectSetup.ts:46-69,109-110,242-245` (central boot, drop `onBeforeEngineStart`)
- Modify: `src/demos/engine/wasm-engine-demo.tsx` (full repurpose — WASM status page)
- Modify: `src/demos/playback/pure-webaudio-target-debug-demo.tsx:229-253` (+ badge/prose)
- Modify: `src/demos/playback/shared-source-double-process-debug-demo.tsx:128-151` (+ badge/prose)
- Modify: `src/demos/engine/wasm-ensure-ready-second-context-debug-demo.tsx:123-192` (init only; step prose is Task 4)

**Interfaces:**
- Produces: `initializeOpenDAW(options)` — `ProjectSetupOptions` no longer has `onBeforeEngineStart`; the function throws `Error("WASM engine failed to initialize …")` when `ensureWasmReady` returns false. `installWasmEngine()` now also calls `WasmEngine.setEnabled(true)` on every invocation.
- Consumes: existing `installWasmEngine` / `ensureWasmReady` from `src/lib/wasmEngine.ts`.

- [ ] **Step 1: Force-enable inside `installWasmEngine`** — in `src/lib/wasmEngine.ts` replace the function body:

```typescript
/** Register the EngineVariant provider + offline variant. Safe to call more than once. */
export function installWasmEngine(): void {
  // Force-enable on every call: `opendaw-wasm-engine` in localStorage is a persisted
  // opt-out shared across the whole origin (the retired A/B demo could leave it false),
  // and a stale `false` makes EngineVariant.current() return null — the boot would
  // silently come up with no engine variant.
  WasmEngine.setEnabled(true);
  if (installed) { return; }
  installed = true;
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: WASM_BASE_URL,
  });
}
```

- [ ] **Step 2: Central boot in `projectSetup.ts`.**
  - Add import: `import { installWasmEngine, ensureWasmReady } from "./wasmEngine";`
  - Delete the `onBeforeEngineStart` property (and its doc comment) from `ProjectSetupOptions` and from the destructure on line 110.
  - Replace lines 242-245 (`// Optional engine-variant install …` block) with:

```typescript
  // WASM (Rust) engine only — the TypeScript engine is being removed upstream and this
  // repo no longer wires it. Must run BEFORE the first startAudioWorklet():
  // EngineWorklet reads EngineVariant.current() at construction time.
  installWasmEngine();
  onStatusUpdate?.("Compiling WASM engine...");
  const wasmReady = await ensureWasmReady(audioContext);
  if (!wasmReady) {
    throw new Error(
      "WASM engine failed to initialize (artifacts missing or compilation failed). " +
        "There is no TypeScript fallback — check that /wasm-engine assets are served " +
        "(wasm-engine-assets Vite plugin) and that the browser supports WebAssembly."
    );
  }
```

- [ ] **Step 3: Repurpose `wasm-engine-demo.tsx`.** Rewrite the file: delete `switchEngine`/`describeEngineStatus`/`EngineStatus`/`setWasmEnabled`/`ensureWasmReady`/`installWasmEngine`/`isWasmReady` imports and all A/B state (`engineStatus`, `isSwitching`, `isSwitchingRef`, `onToggleEngine`, the engine `Switch` UI, the switch-rebaseline block inside it). Keep transport, perf reporting, pattern content. Init becomes plain `initializeOpenDAW({ onStatusUpdate: setStatus })`. Replace header/intro/badge:

```tsx
// Init effect body:
const { project, audioContext } = await initializeOpenDAW({ onStatusUpdate: setStatus });
if (disposed) { project.terminate(); return; }
audioCtxRef.current = audioContext;
buildWasmDemoContent(project);
setProject(project);
setStatus("Ready");
```

```tsx
<div className="mc-kicker">Engine — WASM · OpenDAW SDK</div>
<h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>WASM ENGINE</h1>
<p className="mc-intro">
  A Vaporisateur synth loop playing through the WASM (Rust) audio engine — the only
  engine these demos run; the TypeScript engine is deprecated upstream and no longer
  wired here. <code>initializeOpenDAW</code> installs and compiles the engine before
  the first <code>EngineWorklet</code> boots. Toggle{" "}
  <code>settings.debug.dspLoadMeasurement</code> below to watch DSP load live; it is
  off by default because measuring load perturbs the load it measures.
</p>

{/* Engine badge */}
<Card>
  <Flex direction="column" gap="1">
    <Text size="1" color="gray">ACTIVE ENGINE</Text>
    <Flex align="center" gap="2">
      <Badge color={project ? "amber" : "gray"} size="2">
        {project ? "WASM (Rust)" : "Booting…"}
      </Badge>
      <Text size="1" color="gray">
        {project ? "the only engine — TypeScript engine removed" : "compiling WASM…"}
      </Text>
    </Flex>
  </Flex>
</Card>
```

  The `Switch` import stays (perf-reporting toggle uses it); drop `Separator` only if it becomes unused. Perf reporting card: keep, but delete the `dropoutBaseRef` re-baseline logic that lived in `onToggleEngine` (the one in `onToggleReporting` stays).

- [ ] **Step 4: Simplify the three debug pages' init.** In each of `pure-webaudio-target-debug-demo.tsx`, `shared-source-double-process-debug-demo.tsx`, `wasm-ensure-ready-second-context-debug-demo.tsx`:
  - Delete the `?engine=wasm` comment block, `const wasmRequested = wasmRequestedByUrl();`, the `if (wasmRequested) { installWasmEngine(); setWasmEnabled(true); }` block, `let wasmBooted = false;`, and the `onBeforeEngineStart:` property — leaving a plain `initializeOpenDAW({ localAudioBuffers…, bpm: BPM, onStatusUpdate: setStatus })` call.
  - Delete `setEngineActive(...)` / `setEngineFellBack(...)` calls and the `engineActive` / `engineFellBack` `useState` declarations. `grep -n "engineActive\|engineFellBack" <file>` to find every render usage; replace badge JSX with a static `<Badge color="amber" size="2">WASM (Rust)</Badge>` (drop any fell-back warning text).
  - In `wasm-ensure-ready-second-context-debug-demo.tsx` also delete the now-redundant standalone `installWasmEngine();` at line 183 (central init already installed it).
  - Remove the now-unused `@/lib/wasmEngine` imports from all three files (the second-context page keeps `ensureWasmReady` — its offline test steps call it; keep `setWasmEnabled` there ONLY if a step still references it — that step is handled in Task 4, so leave any in-step `setWasmEnabled` usage compiling for now).
  - Update in-page prose that says the page "takes `?engine=wasm`" (pure-webaudio ~line 742, shared-source ~line 531): replace with one sentence, e.g. for shared-source: `These demos now run the WASM (Rust) engine exclusively — the engine the openDAW#311 fix shipped in — so all four cells scan at seam-Δ/pre-Δ = 1.00.` For pure-webaudio: `These demos now run the WASM (Rust) engine exclusively; the openDAW#312 fix measures −0.05 dB vs the −0.00 dB pure-Web-Audio target here.`

- [ ] **Step 5: Compile check.** Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/'`
  Expected: same error set as main (pre-existing comp-lanes-demo errors only); no new errors. `switchEngine`/`describeEngineStatus` still exported (removed in Task 3) so no unused-export issue.

- [ ] **Step 6: Check demo copy for stale "A/B" wording.** Run: `grep -rn "A/B\|TypeScript" src/index.tsx wasm-engine-demo.html`. Update the index card title/description and the HTML `<title>`/meta tags to "WASM Engine" wording if they mention A/B or the TypeScript engine.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(engine): boot the WASM engine centrally in initializeOpenDAW; remove per-demo engine selection"
```

---

### Task 2: `offlineScan.ts` — single WASM render path

**Files:**
- Modify: `src/lib/offlineScan.ts:1-122`

**Interfaces:**
- Produces: `renderOfflineSlice(project, startSeconds, endSeconds, sampleRate?)` — same signature/return, now always `OfflineEngineRenderer` with `variant: true`; throws `Error("WASM engine is not ready …")` if called before init.
- Consumes: `isWasmReady` from `src/lib/wasmEngine.ts`.

- [ ] **Step 1: Remove the TS branch.** Replace the import on line 1 with `import { Project, OfflineEngineRenderer } from "@opendaw/studio-core";`, drop `Wait`/`TimeSpan` from the `@opendaw/lib-runtime`/`lib-std` imports (keep `Option`), and change the wasmEngine import to `import { isWasmReady } from "@/lib/wasmEngine";`. Then:
  - Replace the gate comment + `if (isWasmInstalled() && isWasmEnabled() && isWasmReady()) {` with:

```typescript
    // WASM offline worker is the only render path (the TS engine is removed from this
    // repo). OfflineAudioContext + createEngine is NOT usable here: ensureReady
    // registers the processor module only on the FIRST context it ever sees
    // (see debug/wasm-ensure-ready-second-context.md), and the live engine already
    // consumed that registration at initializeOpenDAW time.
    if (!isWasmReady()) {
      throw new Error(
        "WASM engine is not ready — initializeOpenDAW() must complete before renderOfflineSlice()."
      );
    }
```

  - De-indent the renderer block (it is no longer inside an `if`), and delete the entire trailing TS path (the `const context = new OfflineAudioContext(…)` block through its `return { channels, sampleRate: buffer.sampleRate };`).
  - Update the function's doc comment: it renders via `OfflineEngineRenderer` `variant: true` only; drop the "(TS engine)" alternative sentence.

- [ ] **Step 2: Compile check.** Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep offlineScan`
  Expected: no output (unused-import errors are the likely failure — fix by removing them).

- [ ] **Step 3: Commit**

```bash
git add src/lib/offlineScan.ts && git commit -m "refactor(offline): renderOfflineSlice runs the WASM offline worker only"
```

---

### Task 3: `rangeExport.ts` always `variant: true` + export-demo snippet

**Files:**
- Modify: `src/lib/rangeExport.ts:7,41-52,73,82-84,103-108`
- Modify: `src/demos/export/export-demo.tsx:690-708`

**Interfaces:**
- Produces: `renderRange` (private) and all exported render helpers unchanged in signature; every `OfflineEngineRenderer.create` call passes `variant: true`.

- [ ] **Step 1: Edit `rangeExport.ts`.**
  - Delete `import { installWasmEngine } from "./wasmEngine";` (line 7).
  - Delete `const metronomeAudible = ExportConfiguration.isMetronomeAudible(optConfig);` (line 73) and the `if (metronomeAudible) installWasmEngine();` block with its comment (lines 82-84).
  - Change the `OfflineEngineRenderer.create(projectCopy, optConfig, sampleRate, metronomeAudible)` call to pass `true` as the 4th argument.
  - Rewrite the doc-comment paragraphs about metronome/variant (lines 41-52) to:

```
 * **Metronome** (openDAW#316): expressed in the export configuration —
 * `{metronome: {includeInMixdown: true}}` mixes the click into a mixdown;
 * `{stems, metronome: {stem: {fileName}}}` appends a click stem AFTER the unit stems
 * (`countStems` counts the extra pair). `settings` overrides gain/beatSubDivision/
 * monophonic (schema defaults otherwise); enabled is implied by presence.
 * Every render runs the WASM offline worker (`variant: true`) — the only engine in
 * this repo; the worker is registered by initializeOpenDAW's installWasmEngine().
```

- [ ] **Step 2: Update the export-demo code sample** (`export-demo.tsx:690-708`). Replace the snippet body so it reads:

```
const config = {
  stems,                                               // omit for a stereo mixdown
  metronome: { includeInMixdown: true,                 // or stem: { fileName: "Metronome" }
               settings: { gain: -6 } },               // enabled is implied by presence
};
const copy = project.copy();
const renderer = await OfflineEngineRenderer.create(
  copy, Option.wrap(config), sampleRate,
  true,  // WASM offline worker — the only engine; it also renders the click
);
renderer.setPosition(startPpqn);
await renderer.play();           // transport + first queryLoadingComplete
await renderer.waitForLoading(); // bound with a deadline — polls forever otherwise
// render(config, start, end, …) runs to SILENCE, not to end — step() is exact:
const channels = await renderer.step(numSamples);      // metronome stem pair comes LAST
renderer.stop(); renderer.terminate(); copy.terminate();
```

  Also grep the surrounding prose in export-demo.tsx for "TS worker"/"TypeScript" (`grep -n "TS worker\|TypeScript\|isMetronomeAudible" src/demos/export/export-demo.tsx`) and update any sentence claiming non-metronome renders stay on the TS worker.

- [ ] **Step 3: Compile check + commit**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep -E "rangeExport|export-demo"   # expect empty
git add src/lib/rangeExport.ts src/demos/export/export-demo.tsx
git commit -m "refactor(export): all offline renders run the WASM offline worker (variant: true)"
```

---

### Task 4: Second-context debug page — always-WASM expected values

The page's purpose (repro for the ensureReady-second-context SDK bug) survives, but the
live engine is now always WASM, so the "first run on a fresh page works" narrative is gone
and any TS-engine control step must be removed (Task 5 deletes `setWasmEnabled`).

**Files:**
- Modify: `src/demos/engine/wasm-ensure-ready-second-context-debug-demo.tsx` (steps, Expected rows ~lines 390-460, summary block ~line 516)
- Modify: `debug/wasm-ensure-ready-second-context.md:24-26,78,89`

- [ ] **Step 1: Audit the page's steps.** Run: `grep -n "setWasmEnabled\|ensureWasmReady\|installWasmEngine\|TypeScript\|TS engine\|engine=wasm\|first run\|1st run" src/demos/engine/wasm-ensure-ready-second-context-debug-demo.tsx` and Read the step definitions.
  - Delete any step (card + runner) that pins the TS engine via `setWasmEnabled(false)` — that control no longer exists. Remove the corresponding import.
  - Update every Expected cell / prose row that distinguishes "1st run on fresh page: OK" vs later runs: with a live WASM engine always booted, the one-and-only processor registration is consumed at init, so the OfflineAudioContext+createEngine step now reads: `Expected: THREW on every run — the live WASM boot consumed the one-and-only processor registration (ensureWasmReady still returns true).` Update the summary block (~line 516) `Live engine:` line to `Live engine: WASM (always — the only engine)`.

- [ ] **Step 2: Update the debug note** `debug/wasm-ensure-ready-second-context.md`:
  - Add under the header: `**Update 2026-07-16:** this repo now boots the WASM engine on every page (TypeScript engine removed). The "fresh page first run OK" row below is historical — the live boot always consumes the registration, so the second-context throw reproduces on the first click.`
  - Line 24 (TS-engine control row): mark `(historical — TS engine no longer wired in this repo)`.
  - Line 78 (workaround bullet `setWasmEnabled(false)`): mark historical the same way.
  - Line 89 run instructions: replace the `?engine=wasm` sentence with `The live engine is always WASM — step 2 throws on the first click.`

- [ ] **Step 3: Compile check + commit**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep second-context   # expect empty
git add -A && git commit -m "fix(debug): second-context repro page reflects always-WASM boot"
```

---

### Task 5: Shrink `wasmEngine.ts` + rewrite its test

**Files:**
- Modify: `src/lib/wasmEngine.ts` (full rewrite below)
- Modify: `src/lib/wasmEngine.test.ts` (full rewrite below)

**Interfaces:**
- Produces: module exports exactly `installWasmEngine(): void`, `ensureWasmReady(ctx: BaseAudioContext): Promise<boolean>`, `isWasmReady(): boolean`. Everything else is deleted.

- [ ] **Step 1: Confirm no remaining consumers of removed symbols.** Run:

```bash
grep -rn "switchEngine\|describeEngineStatus\|EngineStatus\|wasmRequestedByUrl\|setWasmEnabled\|isWasmEnabled\|isWasmInstalled" src/ | grep -v "src/lib/wasmEngine"
```

Expected: no output. If anything appears, fix that call site first (it was missed in Tasks 1-4).

- [ ] **Step 2: Write the failing test** — replace `src/lib/wasmEngine.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";

// `wasmEngine.ts` imports the real `@opendaw/studio-core-wasm` package, which transitively
// imports `@opendaw/studio-core`'s `EngineWorklet` — a class that `extends AudioWorkletNode`
// at module-eval time. `AudioWorkletNode` doesn't exist in vitest's default Node test
// environment, so mock the module purely to neutralize this import-time side effect.
vi.mock("@opendaw/studio-core-wasm", () => ({
  WasmEngine: {
    install: vi.fn(),
    ensureReady: vi.fn(async () => true),
    setEnabled: vi.fn(),
    isReady: vi.fn(() => true),
  },
}));

import { WasmEngine } from "@opendaw/studio-core-wasm";
import { installWasmEngine } from "./wasmEngine";

describe("installWasmEngine", () => {
  it("installs the variant once but force-enables on every call", () => {
    installWasmEngine();
    installWasmEngine();
    expect(vi.mocked(WasmEngine.install)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(WasmEngine.setEnabled)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(WasmEngine.setEnabled)).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run the test** — `npx vitest run src/lib/wasmEngine.test.ts`
  Expected: FAILS only if Task 1's force-enable edit is missing; if Task 1 landed, it PASSES against the un-shrunk module — that's fine, proceed (the shrink below must keep it green).

- [ ] **Step 4: Rewrite `src/lib/wasmEngine.ts`** to:

```typescript
import { WasmEngine } from "@opendaw/studio-core-wasm";

// Vite serves these from the package dist; ?url / ?worker&url give hashed same-origin URLs.
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

/** Base dir the Vite plugin (wasm-engine-assets) serves the .wasm binaries from. */
const WASM_BASE_URL = "/wasm-engine";

let installed = false;

/**
 * Register the EngineVariant provider + offline variant. Safe to call more than once.
 * The WASM (Rust) engine is the ONLY engine these demos run — the TypeScript engine
 * is deprecated upstream and no longer wired here; initializeOpenDAW() calls this and
 * throws if the engine cannot compile.
 */
export function installWasmEngine(): void {
  // Force-enable on every call: `opendaw-wasm-engine` in localStorage is a persisted
  // opt-out shared across the whole origin (the retired A/B demo could leave it false),
  // and a stale `false` makes EngineVariant.current() return null — the boot would
  // silently come up with no engine variant.
  WasmEngine.setEnabled(true);
  if (installed) { return; }
  installed = true;
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: WASM_BASE_URL,
  });
}

/** Compile the wasm modules + register the processor. false ⇒ artifacts unavailable. */
export function ensureWasmReady(ctx: BaseAudioContext): Promise<boolean> {
  return WasmEngine.ensureReady(ctx);
}

export function isWasmReady(): boolean { return WasmEngine.isReady(); }
```

- [ ] **Step 5: Run test + full suite** — `npx vitest run`
  Expected: PASS (note: if a `.claude/worktrees/**` worktree exists, test counts double — judge per-file results).

- [ ] **Step 6: Commit**

```bash
git add src/lib/wasmEngine.ts src/lib/wasmEngine.test.ts
git commit -m "refactor(engine): shrink wasmEngine.ts to the WASM-only surface"
```

---

### Task 6: Documentation sweep

**Files:**
- Modify: `src/demos/engine/CLAUDE.md`
- Modify: `src/demos/export/CLAUDE.md`
- Modify: `src/demos/playback/CLAUDE.md`
- Modify: `CLAUDE.md` (root, ~line 706)
- Modify: `documentation/19-wasm-engine.md`, `documentation/10-export.md`, `documentation/20-apparat.md`
- Modify: `debug/README.md:16,32`, `debug/shared-source-double-process.md:5-10`, `debug/voice-fadein-clip-fadein-product.md:7`
- Leave: `documentation/CLAUDE.md:18` (meta-lesson citing the old inversion — historical, still valid as a lesson)

Rewrite rule for all of these: the WASM engine is the only engine; TS-engine alternatives, fallbacks, per-engine comparisons, and `?engine=wasm` instructions are either deleted (chapter docs — present tense, no pins) or marked historical (debug notes — they are investigation records; add a dated update line, keep measurements).

- [ ] **Step 1: `src/demos/engine/CLAUDE.md`.** Rewrite: engine wiring section says `initializeOpenDAW()` installs/enables/readies WASM automatically and throws without fallback (`onBeforeEngineStart` no longer exists); delete the "Live engine swap (no reload)" section (switchEngine removed); keep the offline second-context pitfall, the DSP-load section, the live transport quirk note, and the NoteRegion loopDuration section; reference files list drops `switchEngine`.
- [ ] **Step 2: `src/demos/export/CLAUDE.md`.** In the metronome/variant section: replace the "Drive `variant` with `isMetronomeAudible` … others stay on the TS worker" bullet with "every render passes `variant: true` — the WASM offline worker is the only render path"; delete the "Manual approach (reference only …)" `OfflineAudioContext` block (its sole use was a TS-pinned metronome render); update the roadmap bullet to past tense ("this repo removed its TS paths; audio-verify recalibrated" — fill in actual outcome after Task 9).
- [ ] **Step 3: `src/demos/playback/CLAUDE.md`.** Seam/Crossfade status section: state both fixes are in effect on the WASM engine (the only engine); delete the "TS engine still measures ≈1.87×, keep the workaround there" guidance and the "Both repro pages accept `?engine=wasm`" sentence (pages always run WASM now).
- [ ] **Step 4: Root `CLAUDE.md` ~line 706.** Replace the per-engine verification bullet ("Upstream fixes/features may land in ONE engine only…") with: "The demos run the WASM engine exclusively (TS engine deprecated upstream and unwired here) — verify upstream fixes/features against the WASM dists (`studio-core-wasm`); TS-dist greps are only for historical comparison."
- [ ] **Step 5: `documentation/19-wasm-engine.md`.** Largest rewrite (grep hits at lines 3, 28, 33, 41, 80-87, 110, 120, 131, 154, 175, 214, 261): remove the "Skip if" opt-in framing; the engine-selection narrative becomes "the SDK still exposes `EngineVariant` with a TS default, but this project installs the WASM variant unconditionally and treats a failed `ensureReady` as fatal"; delete the fallback-to-TS code sample (line ~80) and the live-swap/recovery section (~154); keep provider mechanics, binary serving, offline variant policy (state that this repo always passes `variant: true` explicitly), DSP-load reading, and the per-origin localStorage caveat (now framed as why `installWasmEngine` force-enables). NO version pins.
- [ ] **Step 6: `documentation/10-export.md`.** Line 846: change the pinned `false` to `true` with comment `// WASM offline worker — the only engine wired in this project`; lines 876-887: keep "only the WASM offline worker consumes `config.metronome`" as an SDK fact, delete the "metronome on the TS engine remains possible via OfflineAudioContext" escape-hatch paragraph and the manual-approach subsection if its only justification was the TS metronome (verify by reading the section). NO version pins.
- [ ] **Step 7: `documentation/20-apparat.md` line 7.** "…runs on the AudioWorklet thread inside the engine — a thin wasm bridge calls the same JavaScript once per block over shared memory ([WASM engine](./19-wasm-engine.md))."
- [ ] **Step 8: debug notes.** `debug/README.md:16`: replace the "Engine-scoped verification: … accept `?engine=wasm`" bullet with "All demo pages boot the WASM engine (the only engine wired in this repo)." `debug/README.md:32` + `debug/shared-source-double-process.md:5-10`: add dated update lines noting the TS-path residual is no longer reachable from the repro page (WASM-only); keep measurements. `debug/voice-fadein-clip-fadein-product.md:7`: append "(page now always runs the WASM engine)".
- [ ] **Step 9: Pin check on chapter docs.** Run: `grep -n "0\.0\.[0-9]" documentation/19-wasm-engine.md documentation/10-export.md documentation/20-apparat.md`
  Expected: no output. Fix any hits.
- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "docs: sweep TS-engine guidance — WASM is the only engine"
```

---

### Task 7: Static verification (baseline diff, build, tests)

- [ ] **Step 1: tsc baseline diff vs main** (per root CLAUDE.md recipe):

```bash
git worktree add /tmp/wasm-baseline main && cd /tmp/wasm-baseline && npm ci && \
  npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /tmp/baseline.txt
cd /Users/naomiaro/Code/opendaw-test && \
  npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /tmp/branch.txt
comm -13 /tmp/baseline.txt /tmp/branch.txt   # expect empty
git worktree remove /tmp/wasm-baseline
```

  Expected: `comm` output empty (zero NEW errors; comp-lanes pre-existing errors appear in both).
- [ ] **Step 2:** `npm run build` — Expected: exits 0 (Vite + VitePress).
- [ ] **Step 3:** `npx vitest run` — Expected: all pass (remove the baseline worktree BEFORE this step so counts aren't doubled — done above).
- [ ] **Step 4:** Commit any stragglers; otherwise no commit.

---

### Task 8: Browser verification — live demos on WASM (output RMS, not UI)

Recording and MIDI demos have never run on the WASM engine in this repo; this task is where that risk is retired. Known quirk to watch (0.0.159 observation): position can take 20-30 s to start advancing after `play()` while `isPlaying` flips immediately.

- [ ] **Step 1: Dev server.** Reuse a running one if present (`lsof -ti :5180`); else `npm run dev -- --port 5180 --host 127.0.0.1` (background). Pages load at `https://localhost:5180/<demo>.html`.
- [ ] **Step 2: For each page** — `looping-demo.html` (playback), the multitrack recording demo, `midi-demo.html` (or the MIDI demo entry HTML), `wasm-engine-demo.html`, `shared-source-double-process-debug-demo.html`:
  1. Fresh load; confirm no init error card and console has no `WASM engine failed` error.
  2. Ensure the window is visible (`resize_window` if needed — occluded windows freeze rAF-driven state sync; not an SDK bug).
  3. Install the output tap BEFORE starting transport (per root CLAUDE.md recipe): monkeypatch `AudioNode.prototype.connect` to tee `AudioDestinationNode` connections through an `AnalyserNode`; read `getFloatTimeDomainData` → RMS over ~2 s.
  4. Start transport with a REAL click (claude-in-chrome `computer` click by coordinates; ref-based clicks can silently fail).
  5. Assert: RMS > 0.01 within 5 s of the click AND `project.engine.position` advancing within 5 s. Record time-to-first-audio and time-to-position-advance per page.
  6. Recording demo additionally: arm a tape, record ~3 s (real click), stop, confirm a take region appears and plays back with RMS > 0.01.
- [ ] **Step 3: Quirk triage.** If position/audio takes > 5 s on any page, re-test twice on fresh loads. Consistent multi-page delay = regression candidate for Task 10 (collect exact timings + console logs as the measured signature).
- [ ] **Step 4:** Record results (per-page RMS + timings) in the PR description draft; no commit.

---

### Task 9: Full audio analysis across features

- [ ] **Step 1: audio-verify run.** Invoke the `audio-verify` skill (dev server from Task 8). IMPORTANT calibration note: `raw`/`varispeed`/`timestretch` scenarios previously rendered on the TS offline worker (assertion medians calibrated there); they now render on the WASM worker. Judge as follows:
  - All assertions in the skill's table pass → done.
  - Locked-scenario medians shift but stay ≤ 60 ms (and negative controls stay ≥ 100 ms) → PASS; update the measured-values paragraph in `.claude/skills/audio-verify/SKILL.md` with a dated re-measurement line (this is recalibration, not regression).
  - Any locked scenario > 60 ms or a broken negative control → regression candidate: render the same scenario from `main` (TS worker) in the baseline worktree for an A/B WAV, and take it to Task 10.
- [ ] **Step 2: Debug-page signatures (regression tests for closed upstream issues).** Using each page's own scan UI (real clicks):
  - `shared-source-double-process-debug-demo.html`: all 4 cells expect seam-Δ/pre-Δ = **1.00** (openDAW#311 fixed on WASM).
  - `pure-webaudio-target-debug-demo.html`: OPENDAW scenario expects ≈ **−0.05 dB** vs the −0.00 dB target (openDAW#312).
  - `wasm-ensure-ready-second-context-debug-demo.html`: steps match the Task 4 expected values.
- [ ] **Step 3: Export renders.** On `export-demo.html`, render (a) full mixdown, (b) stems, (c) mixdown + metronome; download WAVs to the scratchpad and analyze each with audio-analyzer (`full_analysis` low resolution; `rhythm_analysis` on the metronome render to confirm click grid at project BPM): assert non-silent (RMS > −60 dBFS), no full-scale clipping, stems sum ≈ mixdown (compare tool), metronome clicks on the beat grid.
- [ ] **Step 4: MIDI synth.** On the wasm-engine-demo (Vaporisateur pattern): capture ~5 s of output via the analyser tap → assert RMS > 0.01 and, via a spectral read (or audio-analyzer on a recorded WAV if easy), energy concentrated at musical pitches rather than broadband noise.
- [ ] **Step 5: Count-in timing analysis (user-requested).** External testing at SDK 0.0.158 (default config: 1 bar, 4/4, ~120 BPM) heard an EXTRA DOWNBEAT — "1 + 2 + 3 + 4 + 1" — before recording started, i.e. the clip did not start recording on the 1. **Primary hypothesis to test: count-in runs one beat long (5 clicks / ~2.5 s at 120 BPM instead of 4 clicks / 2.000 s), or equivalently recording punches in one beat after the bar boundary.** Count the audible clicks before `isRecording` flips (analyser-tap onsets) and measure the duration precisely — an off-by-one-beat result confirms the user's report and goes straight to an issue draft. On `recording-api-react-demo.html` (BPM known, metronome enabled, real clicks), measure on the WASM engine:
  1. **Count-in duration**: wall-clock from the Record click (or from `isCountingIn` flipping true) to `isRecording` flipping true. Expected `bars × beatsPerBar × 60/BPM` (e.g. 1 bar of 4/4 at 120 BPM = 2.000 s). Test `countInBars` = 1 and 2, and a second BPM (e.g. 90) for one of them. Instrument via `catchupAndSubscribe` on `engine.isCountingIn`/`engine.isRecording` + `performance.now()` logged as strings.
  2. **Click spacing during count-in**: analyser-tap onset times of the metronome clicks — expect exactly `60/BPM` apart, first click at count-in start.
  3. **`countInBeatsRemaining` sequence**: values and flip times vs the beat grid (4→3→2→1 at 120 BPM should flip every 0.5 s).
  4. **Post-count-in alignment**: record ~3 s of signal, stop, and check the finalized take — the region must start at the punch-in position with count-in audio skipped (`waveformOffset` mechanism; see `recording-finalize-debug-demo.html` and `src/demos/recording/CLAUDE.md`). A systematic start offset in the recorded region is exactly the "slightly off" symptom to hunt.
  Tolerances: flag anything beyond ~30 ms systematic (one audio block at 128 frames/48 kHz ≈ 2.7 ms; scheduling jitter allows a few ms — tens of ms is a defect). A wrong beat COUNT or duration off by a whole beat/bar is an unambiguous defect. If off: re-measure twice, capture numbers, and add an issue draft per Task 10 Step 1.
- [ ] **Step 6: Write up results** as a table (feature × metric × expected × measured × verdict) in the PR description draft. Any FAIL rows go to Task 10.

---

### Task 10: Regression triage → upstream issues; open PR

- [ ] **Step 1: For each confirmed regression from Tasks 8-9** (reproduced twice, measured signature captured): DRAFT the issue content into `.superpowers/sdd/issue-drafts.md` — one section per issue with proposed title and full body (live repro page URL, link to a new/updated `debug/<topic>.md` write-up per `debug/README.md` convention, the measured signature — numbers, not adjectives — and a suggested fix if the mechanism is identifiable). **Present the drafts to the user and WAIT for their approval before running any `gh issue create` (user directive 2026-07-16).** After filing approved issues, cross-link the issue numbers into the repro page's DebugLinkBar and the debug note header (commit those edits).
- [ ] **Step 2: Delete in-flight docs** (they're completed by this PR): `git rm docs/superpowers/specs/2026-07-16-wasm-engine-only-design.md docs/superpowers/plans/2026-07-16-wasm-engine-only.md` and commit.
- [ ] **Step 3: Open the PR.**

```bash
git push -u origin wasm-engine-only
gh pr create --title "feat(engine): run all demos exclusively on the WASM engine" --body "<summary + verification tables + issue links>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Run the comprehensive PR review** (`/pr-review-toolkit:review-pr`, applicable aspects); FIX Critical + Important findings, push to the branch, note fixes in a PR comment.
- [ ] **Step 5: Report to the user** with the verification tables, any filed issues, and the PR link. Merge only on their go-ahead (`gh pr merge <n> --squash`).
