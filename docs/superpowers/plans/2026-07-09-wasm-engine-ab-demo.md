# WASM Engine A/B Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser demo that boots the SDK's WASM (Rust) engine and lets the user toggle the audio backend between the built-in TypeScript engine and the WASM engine **live during playback**, with an opt-in performance readout.

**Architecture:** A reusable `src/lib/wasmEngine.ts` wires the `WasmEngine` façade (install + ensureReady + a live `switchEngine` reboot). A Vite plugin serves the shipped `.wasm` binaries under `/wasm-engine` (nothing binary committed). `projectSetup.ts` gets one optional `onBeforeEngineStart` hook so the first `EngineWorklet` already boots the chosen engine. A new `src/demos/engine/` demo plays a deterministic Vaporisateur synth loop through reverb+delay and drives the two toggles.

**Tech Stack:** TypeScript, Vite, React 18 + Radix UI Themes, `@opendaw/studio-sdk@0.0.157`, `@opendaw/studio-core-wasm@0.0.2`.

## Global Constraints

- **SDK:** `@opendaw/studio-sdk@0.0.157`; WASM engine from `@opendaw/studio-core-wasm@0.0.2` (already installed).
- **No committed binaries.** The `.wasm` files are served from `node_modules/@opendaw/studio-core-wasm/dist` — never copied into the repo.
- **Dev-server safety:** any sync `fs` call inside a Vite `configureServer` middleware MUST be wrapped in `try/catch` (a throw runs outside connect's try/catch and kills the dev server).
- **Real click for audio:** transport Play/Stop must be started by a genuine pointer click. A programmatic `button.click()` or dispatched event is untrusted and silently fails to start the AudioContext/transport. Untrusted clicks are fine for non-audio buttons.
- **No per-frame `setState`:** continuously-updating readouts write DOM/canvas directly inside `AnimationFrame.add(...)`; never `setState` per frame.
- **Option types:** anything typed `Option<T>` uses `.isEmpty()`/`.nonEmpty()`/`.unwrap()` — never `?.`/`??`.
- **`editing.modify()`:** all box-graph mutations run inside it; `createInstrument`/`insertEffect` results are captured via an outer variable (the callback doesn't forward returns).
- **Verification baseline:** `npx tsc --noEmit --ignoreDeprecations "6.0"` must show **zero new errors vs the parent commit** (the repo has ~14 pre-existing `src/` errors; `node_modules` DOM-lib TS2304s are environmental). `npm run build` must pass. Browser smoke is judged on a **fresh page load** ("Console: N errors" per navigation, not `all:true` history).
- **Dev server is HTTPS** (COOP/COEP). Reuse a running dev server across checks; don't spawn a fresh `npm run dev` each round (`lsof -ti :5173 | xargs kill` to reclaim a port).
- **Branch:** work on `feat/wasm-engine-ab-demo` (already created; the spec is committed there).

---

## File Structure

- **Create** `src/lib/wasmEngine.ts` — WASM wiring: URL imports, `installWasmEngine`, `ensureWasmReady`, `switchEngine`, `EngineStatus` type + pure `describeEngineStatus` helper, re-exports of `setWasmEnabled`/`isWasmEnabled`/`isWasmReady`.
- **Create** `src/lib/wasmEngine.test.ts` — Vitest unit test for the pure `describeEngineStatus` helper.
- **Modify** `vite.config.ts` — add `wasmEngineAssets()` plugin (dev middleware + build emit) and the `wasmEngine` build input entry.
- **Modify** `src/lib/projectSetup.ts` — add optional `onBeforeEngineStart` to `ProjectSetupOptions`; invoke it just before `project.startAudioWorklet()`.
- **Create** `src/demos/engine/patternContent.ts` — `buildWasmDemoContent(project)`: Vaporisateur + reverb+delay + a looping note region + loop area.
- **Create** `src/demos/engine/wasm-engine-demo.tsx` — the React demo (badge, engine toggle, transport, perf toggle + readout).
- **Create** `wasm-engine-demo.html` — entry point at repo root.
- **Create** `src/demos/engine/CLAUDE.md` — scoped SDK notes for the new category.
- **Modify** `src/index.tsx` — add the demo card.
- **Modify** `public/sitemap.xml` — add the URL.
- **Create** `public/og-image-wasm-engine.png` — 1200×630 social image (captured during browser smoke).

---

## Task 1: Vite plugin — serve the WASM binaries under `/wasm-engine`

**Files:**
- Modify: `vite.config.ts` (add plugin near `verifySink`, register in `plugins`, add build input)

**Interfaces:**
- Produces: HTTP route `/wasm-engine/wasm/engine.wasm` and `/wasm-engine/wasm/plugins/device_*.wasm` in dev, and emitted assets at the same paths in the production build. `src/lib/wasmEngine.ts` (Task 2) passes `wasmUrl: "/wasm-engine"`, and `loadEngineModules` fetches `${wasmUrl}/wasm/engine.wasm` etc.

- [ ] **Step 1: Add the plugin factory**

In `vite.config.ts`, add imports at the top (extend the existing `fs`/`path` imports):

```typescript
import {readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync} from "fs"
import {resolve, join, extname} from "path"
```

Add this plugin factory just below `verifySink` (before the `certKeyPath` consts):

```typescript
// Serves the WASM engine artifacts shipped in @opendaw/studio-core-wasm's dist/ under
// /wasm-engine (dev: middleware straight from node_modules; build: emitFile the wasm/ tree).
// Nothing binary is committed; loadEngineModules(base="/wasm-engine") fetches
// /wasm-engine/wasm/engine.wasm + /wasm-engine/wasm/plugins/device_*.wasm.
const WASM_DIST = resolve(__dirname, "node_modules/@opendaw/studio-core-wasm/dist")
const MIME: Record<string, string> = {".wasm": "application/wasm", ".js": "text/javascript", ".map": "application/json"}

const wasmEngineAssets = (): Plugin => ({
    name: "wasm-engine-assets",
    apply: "serve",
    configureServer(server) {
        server.middlewares.use("/wasm-engine", (req, res, next) => {
            // Runs outside connect's try/catch — a sync throw kills the dev server.
            try {
                const rel = (req.url ?? "/").split("?")[0].replace(/^\/+/, "")
                const file = resolve(WASM_DIST, rel)
                if (!file.startsWith(WASM_DIST) || !existsSync(file) || !statSync(file).isFile()) {
                    return next()
                }
                res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream")
                res.end(readFileSync(file))
            } catch (err) {
                console.error("[wasm-engine-assets] serve failed:", String(err))
                next()
            }
        })
    }
})

// Build-time counterpart: emit the wasm/ subtree so production serves /wasm-engine/wasm/**.
const wasmEngineEmit = (): Plugin => ({
    name: "wasm-engine-emit",
    apply: "build",
    buildStart() {
        const root = resolve(WASM_DIST, "wasm")
        if (!existsSync(root)) {
            this.warn("wasm-engine-emit: no artifacts in node_modules/@opendaw/studio-core-wasm/dist/wasm — WASM engine will be unavailable in the build")
            return
        }
        const walk = (dir: string): string[] =>
            readdirSync(dir).flatMap(name => {
                const full = join(dir, name)
                return statSync(full).isDirectory() ? walk(full) : [full]
            })
        for (const full of walk(root)) {
            if (extname(full) !== ".wasm") continue
            const rel = full.slice(WASM_DIST.length + 1).split("\\").join("/") // e.g. wasm/plugins/device_x.wasm
            this.emitFile({type: "asset", fileName: `wasm-engine/${rel}`, source: readFileSync(full)})
        }
    }
})
```

- [ ] **Step 2: Register the plugins and the build input**

In the `plugins` array, add both:

```typescript
    plugins: [
        react(),
        crossOriginIsolation(),
        verifySink(),
        wasmEngineAssets(),
        wasmEngineEmit()
    ]
```

In `build.rollupOptions.input`, add (after the `recordingFinalizeDebug` entry):

```typescript
                recordingFinalizeDebug: resolve(__dirname, "recording-finalize-debug-demo.html"),
                wasmEngine: resolve(__dirname, "wasm-engine-demo.html")
```

- [ ] **Step 3: Verify dev serving**

Reuse a running HTTPS dev server (or start one: `npm run dev -- --port 5173 --host localhost`). Then:

Run: `curl -sk -o /dev/null -w "%{http_code} %{content_type}\n" https://localhost:5173/wasm-engine/wasm/engine.wasm`
Expected: `200 application/wasm`

Run: `curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:5173/wasm-engine/wasm/plugins/device_vaporisateur.wasm`
Expected: `200`

Run: `curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:5173/wasm-engine/wasm/nope.wasm`
Expected: `404` (falls through to `next()`, does not crash the server)

- [ ] **Step 4: Verify the build entry is wired (no full build needed yet)**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" vite.config.ts 2>&1 | grep -c "vite.config.ts" || true`
Expected: `0` (no type errors introduced in `vite.config.ts`)

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts
git commit -m "feat(vite): serve WASM engine binaries under /wasm-engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: WASM engine wiring helper (`src/lib/wasmEngine.ts`)

**Files:**
- Create: `src/lib/wasmEngine.ts`
- Test: `src/lib/wasmEngine.test.ts`

**Interfaces:**
- Consumes: `/wasm-engine` route from Task 1; `WasmEngine` from `@opendaw/studio-core-wasm`; `Project`/`EngineWorklet` from `@opendaw/studio-core`.
- Produces:
  - `installWasmEngine(): void` — idempotent; registers the EngineVariant provider.
  - `ensureWasmReady(ctx: BaseAudioContext): Promise<boolean>` — compiles + registers; `false` ⇒ artifacts missing.
  - `setWasmEnabled(enabled: boolean): void`, `isWasmEnabled(): boolean`, `isWasmReady(): boolean`.
  - `type EngineStatus = { requested: "wasm" | "ts"; active: "wasm" | "ts"; fellBack: boolean }`.
  - `describeEngineStatus(s: EngineStatus): { label: string; sub: string }` — pure, UI-facing.
  - `switchEngine(project: Project, ctx: BaseAudioContext, wasm: boolean): Promise<EngineStatus>` — live reboot preserving playback.

- [ ] **Step 1: Write the failing test for the pure helper**

Create `src/lib/wasmEngine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { describeEngineStatus } from "./wasmEngine";

describe("describeEngineStatus", () => {
  it("labels an active WASM engine", () => {
    const r = describeEngineStatus({ requested: "wasm", active: "wasm", fellBack: false });
    expect(r.label).toBe("WASM (Rust)");
    expect(r.sub).toBe("ready");
  });

  it("labels the TypeScript engine", () => {
    const r = describeEngineStatus({ requested: "ts", active: "ts", fellBack: false });
    expect(r.label).toBe("TypeScript");
    expect(r.sub).toBe("ready");
  });

  it("reports a fallback when WASM was requested but unavailable", () => {
    const r = describeEngineStatus({ requested: "wasm", active: "ts", fellBack: true });
    expect(r.label).toBe("TypeScript");
    expect(r.sub).toBe("WASM unavailable — using TypeScript");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/wasmEngine.test.ts`
Expected: FAIL — `Failed to resolve import "./wasmEngine"` (file does not exist yet).

- [ ] **Step 3: Create `src/lib/wasmEngine.ts`**

```typescript
import { WasmEngine } from "@opendaw/studio-core-wasm";
import type { Project, EngineWorklet } from "@opendaw/studio-core";

// Vite serves these from the package dist; ?url / ?worker&url give hashed same-origin URLs.
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url";
import wasmOfflineWorkerUrl from "@opendaw/studio-core-wasm/wasm-offline-worker.js?worker&url";

/** Base dir the Vite plugin (wasm-engine-assets) serves the .wasm binaries from. */
const WASM_BASE_URL = "/wasm-engine";

let installed = false;

/** Register the EngineVariant provider + offline variant. Safe to call more than once. */
export function installWasmEngine(): void {
  if (installed) { return; }
  installed = true;
  WasmEngine.install({
    processorUrl: wasmProcessorUrl,
    offlineWorkerUrl: wasmOfflineWorkerUrl,
    wasmUrl: WASM_BASE_URL,
  });
}

/** Compile the wasm modules + register the processor. false ⇒ artifacts unavailable (fall back to TS). */
export function ensureWasmReady(ctx: BaseAudioContext): Promise<boolean> {
  return WasmEngine.ensureReady(ctx);
}

export function setWasmEnabled(enabled: boolean): void { WasmEngine.setEnabled(enabled); }
export function isWasmEnabled(): boolean { return WasmEngine.isEnabled(); }
export function isWasmReady(): boolean { return WasmEngine.isReady(); }

export type EngineStatus = {
  requested: "wasm" | "ts";
  active: "wasm" | "ts";
  fellBack: boolean;
};

/** Pure, UI-facing description of an EngineStatus. */
export function describeEngineStatus(s: EngineStatus): { label: string; sub: string } {
  const label = s.active === "wasm" ? "WASM (Rust)" : "TypeScript";
  const sub = s.fellBack ? "WASM unavailable — using TypeScript" : "ready";
  return { label, sub };
}

/**
 * Swap the audio backend live. Sets the WasmEngine flag, (re)compiles wasm if enabling,
 * then reboots ONLY the EngineWorklet — EngineWorklet reads EngineVariant.current() at
 * construction. Playback position (and play state) are captured and restored so the swap
 * is seamless mid-loop. Returns the engine that ACTUALLY booted.
 */
export async function switchEngine(
  project: Project,
  ctx: BaseAudioContext,
  wasm: boolean,
): Promise<EngineStatus> {
  const engine = project.engine;
  setWasmEnabled(wasm);

  let ready = false;
  if (wasm) {
    ready = await ensureWasmReady(ctx);
  }

  const wasPlaying = engine.isPlaying.getValue();
  const position = engine.position.getValue();

  engine.releaseWorklet();
  const worklet: EngineWorklet = project.startAudioWorklet(
    { unload: async () => {}, load: (w: EngineWorklet) => engine.setWorklet(w) },
    {},
  );
  engine.setWorklet(worklet);
  await worklet.isReady();

  engine.setPosition(position);
  if (wasPlaying) { engine.play(); }

  const active: "wasm" | "ts" = wasm && isWasmReady() ? "wasm" : "ts";
  return { requested: wasm ? "wasm" : "ts", active, fellBack: wasm && !ready };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/wasmEngine.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Type-check the new file**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep "src/lib/wasmEngine.ts" || echo "no new errors in wasmEngine.ts"`
Expected: `no new errors in wasmEngine.ts`

> Note: if `?url` / `?worker&url` imports raise TS2307 ("Cannot find module … or its type declarations"), add a triple-slash ambient in the file or confirm `src/vite-env.d.ts` references `vite/client`. Check first: `grep -rn "vite/client" src/*.d.ts`. If absent, create `src/vite-env.d.ts` with `/// <reference types="vite/client" />` and commit it with this task.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wasmEngine.ts src/lib/wasmEngine.test.ts src/vite-env.d.ts 2>/dev/null
git commit -m "feat(engine): WasmEngine wiring helper + live switchEngine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `onBeforeEngineStart` hook in `projectSetup.ts`

**Files:**
- Modify: `src/lib/projectSetup.ts` (`ProjectSetupOptions` interface ~line 46; call site ~line 235)

**Interfaces:**
- Produces: `ProjectSetupOptions.onBeforeEngineStart?: (audioContext: AudioContext) => Promise<void>` — awaited immediately before `project.startAudioWorklet()`. Undefined ⇒ unchanged behavior.
- Consumes: nothing new.

- [ ] **Step 1: Add the option to the interface**

In `src/lib/projectSetup.ts`, inside `ProjectSetupOptions` (after `onStatusUpdate`), add:

```typescript
  /**
   * Optional async hook run AFTER worklets/project are created but immediately BEFORE
   * project.startAudioWorklet(). Use it to install an EngineVariant (e.g. the WASM engine)
   * so the very first EngineWorklet boots the chosen backend. Receives the live AudioContext.
   */
  onBeforeEngineStart?: (audioContext: AudioContext) => Promise<void>;
```

- [ ] **Step 2: Destructure and invoke the hook**

Change the destructure line (currently `const { localAudioBuffers, bpm = 120, onStatusUpdate } = options;`) to:

```typescript
  const { localAudioBuffers, bpm = 120, onStatusUpdate, onBeforeEngineStart } = options;
```

Then, immediately before `project.startAudioWorklet();` (the line after the BPM block, ~line 235), insert:

```typescript
  // Optional engine-variant install (e.g. WASM) — must run before the first worklet boots.
  if (onBeforeEngineStart) {
    await onBeforeEngineStart(audioContext);
  }

```

- [ ] **Step 3: Verify no new type errors and existing demos still build**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep "src/lib/projectSetup.ts" || echo "no new errors in projectSetup.ts"`
Expected: `no new errors in projectSetup.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/projectSetup.ts
git commit -m "feat(setup): add onBeforeEngineStart hook for engine-variant install

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Demo content builder (`src/demos/engine/patternContent.ts`)

**Files:**
- Create: `src/demos/engine/patternContent.ts`

**Interfaces:**
- Consumes: `Project` from `@opendaw/studio-core`; `InstrumentFactories` from `@opendaw/studio-adapters`; `EffectFactories` from `@opendaw/studio-core`; `NoteEventCollectionBox`, `NoteRegionBox` from `@opendaw/studio-boxes`; `PPQN` from `@opendaw/lib-dsp`; `UUID` from `@opendaw/lib-std`.
- Produces: `buildWasmDemoContent(project: Project): void` — creates a Vaporisateur instrument with reverb+delay, a 2-bar looping note region, and enables the timeline loop area over those 2 bars.

- [ ] **Step 1: Create the content builder**

This mirrors the proven pattern in `src/demos/midi/StepRecordingSection.tsx:104-137` (box-level
region creation, then adapter-level `createEvent`).

```typescript
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project, EffectFactories } from "@opendaw/studio-core";
import { InstrumentFactories, NoteEventCollectionBoxAdapter } from "@opendaw/studio-adapters";
import { NoteEventCollectionBox, NoteRegionBox } from "@opendaw/studio-boxes";
import type { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";

const QUARTER = PPQN.Quarter;   // 960 ticks
const BAR = QUARTER * 4;        // 4/4
const PATTERN_BARS = 2;
const PATTERN_LEN = BAR * PATTERN_BARS;

// A deterministic 2-bar arpeggio (region-local ticks). pitch = MIDI note number.
const PATTERN: ReadonlyArray<{ position: number; pitch: number }> = [
  { position: 0 * QUARTER, pitch: 60 },
  { position: 1 * QUARTER, pitch: 64 },
  { position: 2 * QUARTER, pitch: 67 },
  { position: 3 * QUARTER, pitch: 72 },
  { position: 4 * QUARTER, pitch: 67 },
  { position: 5 * QUARTER, pitch: 64 },
  { position: 6 * QUARTER, pitch: 60 },
  { position: 7 * QUARTER, pitch: 64 },
];

/**
 * Build the demo's musical content: a Vaporisateur synth through reverb + delay, playing a
 * looping 2-bar pattern. Exercises the WASM instrument + effect plugins (device_vaporisateur/
 * reverb/delay.wasm) so the TS↔WASM A/B is a meaningful "sounds identical" comparison.
 */
export function buildWasmDemoContent(project: Project): void {
  // 1) Instrument (createInstrument routes output to master internally). Capture via outer vars —
  //    editing.modify() does not forward return values.
  let audioUnitBox: AudioUnitBox | null = null;
  let trackBox: TrackBox | null = null;
  project.editing.modify(() => {
    const product = project.api.createInstrument(InstrumentFactories.Vaporisateur);
    audioUnitBox = product.audioUnitBox;
    trackBox = product.trackBox;
  });
  if (!audioUnitBox || !trackBox) {
    throw new Error("buildWasmDemoContent: createInstrument did not return a unit/track");
  }
  // Cast defeats TS closure-narrowing to `never` after the modify() callback (see midi CLAUDE.md).
  const unit = audioUnitBox as AudioUnitBox;
  const track = trackBox as TrackBox;

  // 2) Audio effects (reverb then delay) on the instrument's audio-effect chain.
  project.editing.modify(() => {
    project.api.insertEffect(unit.audioEffects, EffectFactories.AudioNamed.Reverb);
    project.api.insertEffect(unit.audioEffects, EffectFactories.AudioNamed.Delay);
  });

  // 3) A note region holding the pattern, spanning PATTERN_LEN ticks (box path mirrors
  //    StepRecordingSection: create collection + region, wire the regions/events pointers).
  let collectionBox: NoteEventCollectionBox | null = null;
  project.editing.modify(() => {
    const collection = NoteEventCollectionBox.create(project.boxGraph, UUID.generate());
    collectionBox = collection;
    NoteRegionBox.create(project.boxGraph, UUID.generate(), (box: NoteRegionBox) => {
      box.regions.refer(track.regions);
      box.events.refer(collection.owners);
      box.position.setValue(0);
      box.duration.setValue(PATTERN_LEN);
      box.label.setValue("WASM A/B Pattern");
    });
  });

  // 4) Populate the events via the collection adapter (createEvent is the prescribed path).
  const collection = collectionBox as NoteEventCollectionBox;
  const collectionAdapter = project.boxAdapters.adapterFor(collection, NoteEventCollectionBoxAdapter);
  project.editing.modify(() => {
    for (const note of PATTERN) {
      collectionAdapter.createEvent({
        position: note.position,
        duration: Math.round(QUARTER * 0.9),
        pitch: note.pitch,
        cent: 0,
        velocity: 0.8,
        chance: 100,
        playCount: 1,
      });
    }
  });

  // 5) Loop the transport over the pattern so it repeats under the A/B toggle.
  project.editing.modify(() => {
    const { loopArea } = project.timelineBox;
    loopArea.from.setValue(0);
    loopArea.to.setValue(PATTERN_LEN);
    loopArea.enabled.setValue(true);
  });
}
```

> **Two things to confirm with the LSP before running (each has a working reference, so this is
> verification, not guesswork):**
> - `AudioUnitBox.audioEffects` is the correct `insertEffect` field — reference `src/hooks/useDynamicEffect.ts:426`
>   (`project.api.insertEffect(audioBox.audioEffects, …)`).
> - `NoteRegionBox.duration` exists and is settable; if the region needs `loopDuration`/`loopOffset`
>   for correct playback, mirror what `StepRecordingSection.tsx` / the SDK's `createNoteRegion` set.
>   (The transport `loopArea` handles repetition here, so region-internal looping is not required —
>   the region only needs `duration >= PATTERN_LEN`.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep "src/demos/engine/patternContent.ts" || echo "no new errors in patternContent.ts"`
Expected: `no new errors in patternContent.ts`

(Runtime behavior is exercised by the browser smoke in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/demos/engine/patternContent.ts
git commit -m "feat(engine-demo): Vaporisateur + reverb/delay looping content builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Demo React component + HTML entry

**Files:**
- Create: `wasm-engine-demo.html`
- Create: `src/demos/engine/wasm-engine-demo.tsx`

**Interfaces:**
- Consumes: `initializeOpenDAW` (Task 3 hook); `installWasmEngine`/`ensureWasmReady`/`setWasmEnabled`/`switchEngine`/`describeEngineStatus`/`EngineStatus` (Task 2); `buildWasmDemoContent` (Task 4); Radix UI; `GitHubCorner`/`BackLink`/`MoisesLogo`; `CONSOLE_STYLES` from `@/lib/design/consoleTheme`; `AnimationFrame` from `@opendaw/lib-dom`.

- [ ] **Step 1: Create the HTML entry**

Create `wasm-engine-demo.html` (copy of the MIDI entry with WASM-engine metadata):

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>OpenDAW WASM Engine A/B — TypeScript vs Rust Audio Engine</title>
    <meta name="title" content="OpenDAW WASM Engine A/B — TypeScript vs Rust Audio Engine" />
    <meta name="description"
        content="Switch OpenDAW's audio backend between the built-in TypeScript engine and the WASM (Rust) engine live during playback, and watch engine load in real time." />
    <meta name="keywords"
        content="OpenDAW, WASM engine, Rust audio engine, AudioWorklet, EngineVariant, DSP load, browser audio" />
    <meta name="author" content="Moises AI" />
    <meta name="theme-color" content="#e8a33d" />

    <link rel="canonical" href="https://opendaw-test.pages.dev/wasm-engine-demo.html" />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://opendaw-test.pages.dev/wasm-engine-demo.html" />
    <meta property="og:title" content="OpenDAW WASM Engine A/B" />
    <meta property="og:description"
        content="Toggle OpenDAW's audio engine between TypeScript and WASM (Rust) live during playback." />
    <meta property="og:image" content="https://opendaw-test.pages.dev/og-image-wasm-engine.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="OpenDAW Demos" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="OpenDAW WASM Engine A/B" />
    <meta name="twitter:description"
        content="Toggle OpenDAW's audio engine between TypeScript and WASM (Rust) live during playback." />
    <meta name="twitter:image" content="https://opendaw-test.pages.dev/og-image-wasm-engine.png" />

    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
    <link rel="stylesheet" crossorigin
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap"/>
    <style>
        body { margin: 0; background: #0d0c0a; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/demos/engine/wasm-engine-demo.tsx"></script>
<script data-goatcounter="https://opendaw-handbook.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the demo component**

Create `src/demos/engine/wasm-engine-demo.tsx`:

```tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import {
  installWasmEngine,
  ensureWasmReady,
  setWasmEnabled,
  isWasmReady,
  switchEngine,
  describeEngineStatus,
  type EngineStatus,
} from "@/lib/wasmEngine";
import { buildWasmDemoContent } from "./patternContent";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Flex, Text, Card, Button, Badge, Switch, Separator } from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [project, setProject] = useState<Project | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ requested: "wasm", active: "ts", fellBack: false });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [cpuPct, setCpuPct] = useState(0);
  const [dropouts, setDropouts] = useState<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const isSwitchingRef = useRef(false);
  const perfLifeRef = useRef<{ terminate: () => void } | null>(null);

  // ---- Init ----
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { project, audioContext } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
          // Install + ready the WASM engine BEFORE the first worklet so it boots on WASM.
          onBeforeEngineStart: async (ctx) => {
            installWasmEngine();
            setWasmEnabled(true);
            await ensureWasmReady(ctx);
          },
        });
        if (disposed) { project.terminate(); return; }
        audioCtxRef.current = audioContext;
        buildWasmDemoContent(project);
        setProject(project);
        setEngineStatus({ requested: "wasm", active: isWasmReady() ? "wasm" : "ts", fellBack: !isWasmReady() });
        setStatus("Ready");
      } catch (err) {
        console.error("[wasm-engine-demo] init failed:", String(err));
        setStatus(`Init error: ${String(err)}`);
      }
    })();
    return () => { disposed = true; };
  }, []);

  // Reflect transport state.
  useEffect(() => {
    if (!project) { return; }
    const sub = project.engine.isPlaying.catchupAndSubscribe((obs) => setIsPlaying(obs.getValue()));
    return () => sub.terminate();
  }, [project]);

  // ---- Transport (REAL click required to start the AudioContext) ----
  const onPlay = useCallback(async () => {
    if (!project) { return; }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "running") { await ctx.resume(); }
    project.engine.play();
  }, [project]);

  const onStop = useCallback(() => {
    project?.engine.stop(true);
  }, [project]);

  // ---- Engine A/B toggle ----
  const onToggleEngine = useCallback(async (wantWasm: boolean) => {
    const ctx = audioCtxRef.current;
    if (!project || !ctx || isSwitchingRef.current) { return; }
    isSwitchingRef.current = true;
    setIsSwitching(true);
    setStatus(`Switching to ${wantWasm ? "WASM" : "TypeScript"} engine…`);
    try {
      const result = await switchEngine(project, ctx, wantWasm);
      setEngineStatus(result);
      // Re-assert perf flag on the fresh worklet if reporting is on.
      if (reporting) { project.engine.preferences.settings.debug.dspLoadMeasurement = true; }
      setStatus("Ready");
    } catch (err) {
      console.error("[wasm-engine-demo] engine switch failed:", String(err));
      setStatus(`Switch error: ${String(err)}`);
    } finally {
      isSwitchingRef.current = false;
      setIsSwitching(false);
    }
  }, [project, reporting]);

  // ---- Performance reporting toggle (drives settings.debug.dspLoadMeasurement) ----
  const onToggleReporting = useCallback((on: boolean) => {
    if (!project) { return; }
    setReporting(on);
    project.engine.preferences.settings.debug.dspLoadMeasurement = on;

    // Tear down any prior perf loop.
    perfLifeRef.current?.terminate();
    perfLifeRef.current = null;

    if (!on) { setCpuPct(0); setDropouts(null); return; }

    const engine = project.engine;
    const ctx = audioCtxRef.current;
    // Chromium-only dropout counter.
    const stats = (ctx as unknown as { playbackStats?: { underrunEvents: number } } | null)?.playbackStats;
    setDropouts(stats ? stats.underrunEvents : null);

    const cpuSub = engine.cpuLoad.catchupAndSubscribe((obs) =>
      setCpuPct(Math.round(obs.getValue() * 100)),
    );
    const frame = AnimationFrame.add(() => {
      if (stats) { setDropouts(stats.underrunEvents); }
    });
    perfLifeRef.current = { terminate: () => { cpuSub.terminate(); frame.terminate(); } };
  }, [project]);

  useEffect(() => () => { perfLifeRef.current?.terminate(); }, []);

  const desc = describeEngineStatus(engineStatus);
  const isWasm = engineStatus.active === "wasm";

  return (
    <Theme appearance="dark" accentColor="amber" grayColor="sand" radius="small" scaling="100%">
      <div style={CONSOLE_STYLES.page as React.CSSProperties}>
        <GitHubCorner />
        <Container size="2" style={{ padding: "2rem 1rem" }}>
          <BackLink />
          <Flex align="center" justify="between" mb="4">
            <Text size="6" weight="bold">WASM Engine A/B</Text>
            <MoisesLogo />
          </Flex>

          <Text as="p" size="2" color="gray" mb="4">
            The same Vaporisateur synth loop plays through either audio backend. Toggle live during
            playback — the sound is identical by design; the WASM (Rust) engine is a drop-in
            replacement for the built-in TypeScript one.
          </Text>

          {/* Engine badge */}
          <Card mb="3">
            <Flex align="center" justify="between">
              <Flex direction="column" gap="1">
                <Text size="1" color="gray">ACTIVE ENGINE</Text>
                <Flex align="center" gap="2">
                  <Badge color={isWasm ? "amber" : "gray"} size="2">{desc.label}</Badge>
                  <Text size="1" color={engineStatus.fellBack ? "red" : "gray"}>{desc.sub}</Text>
                </Flex>
              </Flex>
              <Flex align="center" gap="2">
                <Text size="1" color="gray">TypeScript</Text>
                <Switch checked={isWasm} disabled={isSwitching || !project}
                        onCheckedChange={(v) => onToggleEngine(v)} />
                <Text size="1" color="gray">WASM</Text>
              </Flex>
            </Flex>
          </Card>

          {/* Transport */}
          <Card mb="3">
            <Flex align="center" gap="3">
              <Button onClick={onPlay} disabled={!project || isPlaying}>▶ Play</Button>
              <Button variant="soft" onClick={onStop} disabled={!project || !isPlaying}>■ Stop</Button>
              <Separator orientation="vertical" />
              <Text size="1" color="gray">{status}</Text>
            </Flex>
          </Card>

          {/* Performance reporting */}
          <Card>
            <Flex align="center" justify="between" mb={reporting ? "3" : "0"}>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">Performance reporting</Text>
                <Text size="1" color="gray">
                  Off by default — measuring DSP load perturbs the load it measures.
                </Text>
              </Flex>
              <Switch checked={reporting} disabled={!project}
                      onCheckedChange={(v) => onToggleReporting(v)} />
            </Flex>
            {reporting && (
              <Flex gap="5" mt="2">
                <Flex direction="column">
                  <Text size="1" color="gray">DSP LOAD</Text>
                  <Text size="6" weight="bold">{cpuPct}%</Text>
                </Flex>
                <Flex direction="column">
                  <Text size="1" color="gray">DROPOUTS</Text>
                  <Text size="6" weight="bold">
                    {dropouts === null ? "n/a" : dropouts}
                  </Text>
                  {dropouts === null && <Text size="1" color="gray">Chromium only</Text>}
                </Flex>
              </Flex>
            )}
          </Card>
        </Container>
      </div>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
```

> **Implementer notes (verify, don't assume):**
> - Confirm `CONSOLE_STYLES` has a `page` key: `grep -n "page" src/lib/design/consoleTheme.ts`. If the shape differs, use the same wrapper an existing console-theme demo uses (e.g. `src/demos/warp/warp-overview.tsx`) — match its root element exactly.
> - Confirm `BackLink` needs no props: `grep -n "BackLink" src/components/BackLink.tsx`.
> - Confirm `project.engine.preferences.settings.debug.dspLoadMeasurement` is directly assignable (upstream `PerformanceStats.tsx` assigns it directly). If `settings` is read-only in the local types, use the SDK's setter path shown by `hover`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep -E "src/demos/engine/wasm-engine-demo.tsx" || echo "no new errors in wasm-engine-demo.tsx"`
Expected: `no new errors in wasm-engine-demo.tsx`

- [ ] **Step 4: Browser smoke test (the critical verification)**

Start/reuse the HTTPS dev server. In a browser (Playwright MCP or claude-in-chrome), navigate to `https://localhost:5173/wasm-engine-demo.html` on a **fresh load**, then:

1. Wait for status `Ready`; badge shows **WASM (Rust)** / `ready` (or **TypeScript** / "WASM unavailable" if artifacts missing — investigate a fallback here since Task 1 curl proved them served).
2. **Real-click** ▶ Play → the arpeggio loops audibly.
3. Flip the engine switch to **TypeScript** → badge updates, playback continues seamlessly mid-loop.
4. Flip back to **WASM** → badge = WASM, still seamless.
5. Check the network panel: 200s for `/wasm-engine/wasm/engine.wasm` and `device_vaporisateur.wasm` / `device_reverb.wasm` / `device_delay.wasm`.
6. Turn **Performance reporting** on → DSP LOAD shows a live non-negative %; DROPOUTS shows a number (Chromium) or `n/a`. Toggle the engine with reporting on and confirm the % keeps updating. Turn reporting off → readout disappears.
7. Confirm per-navigation **"Console: 0 errors"** (ignore the known dev-only HMR "Workers are already installed" only if it appears on an HMR remount, not a fresh load).

Record the outcome (pass/fail per step) in the task notes.

- [ ] **Step 5: Capture the OG image**

While on the page (playing, reporting on for a richer shot), take a 1200×630 screenshot and save it as `public/og-image-wasm-engine.png`. (Playwright: set viewport 1200×630 and screenshot; or crop a full-page capture to 1200×630.)

- [ ] **Step 6: Commit**

```bash
git add wasm-engine-demo.html src/demos/engine/wasm-engine-demo.tsx public/og-image-wasm-engine.png
git commit -m "feat(engine-demo): WASM A/B demo page (badge, live toggle, perf readout)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Registration, category CLAUDE.md, and full build

**Files:**
- Modify: `src/index.tsx` (add a card)
- Modify: `public/sitemap.xml` (add the URL)
- Create: `src/demos/engine/CLAUDE.md`

**Interfaces:**
- Consumes: the demo page from Task 5.

- [ ] **Step 1: Add the index card**

In `src/index.tsx`, add a new group (or extend an existing one) in `GROUPS`. Add this group after the last existing group (match the surrounding object shape exactly):

```typescript
  {
    label: "Engine",
    color: "var(--mc-violet)",
    demos: [
      {
        href: "/wasm-engine-demo.html",
        title: "WASM Engine A/B",
        blurb:
          "Toggle OpenDAW's audio backend between the built-in TypeScript engine and the WASM (Rust) engine live during playback, with an opt-in DSP-load readout.",
      },
    ],
  },
```

> Confirm `--mc-violet` exists in the theme: `grep -n "mc-violet" src/lib/design/consoleTheme.ts src/**/*.css 2>/dev/null`. If it doesn't, reuse an existing accent token used by another group (e.g. `var(--mc-cyan)`).

- [ ] **Step 2: Add the sitemap entry**

In `public/sitemap.xml`, copy an existing `<url>` block and change the `<loc>` to `https://opendaw-test.pages.dev/wasm-engine-demo.html` (match the surrounding `<lastmod>`/`<changefreq>`/`<priority>` fields of a sibling demo entry).

- [ ] **Step 3: Create the category CLAUDE.md**

Create `src/demos/engine/CLAUDE.md`:

```markdown
# Engine Demos — OpenDAW SDK Reference

Demos about the audio engine backend itself (as opposed to musical content).

## WASM (Rust) engine — EngineVariant / WasmEngine

The WASM engine is a switchable `AudioWorkletProcessor` that speaks the same message contract
as the built-in TS `"engine-processor"`. `EngineWorklet` reads `EngineVariant.current()` at
**construction time**: null ⇒ built-in TS engine (unchanged); non-null ⇒ boots the WASM processor.

Wire it via the `WasmEngine` façade from `@opendaw/studio-core-wasm` (see `src/lib/wasmEngine.ts`):
- `WasmEngine.install({ processorUrl, offlineWorkerUrl, wasmUrl })` — registers the EngineVariant
  provider (once). `wasmUrl` is a base dir; `loadEngineModules` fetches `${wasmUrl}/wasm/engine.wasm`
  + `${wasmUrl}/wasm/plugins/device_*.wasm`.
- `WasmEngine.ensureReady(ctx)` — `ctx.audioWorklet.addModule(processorUrl)` + compile; returns
  `false` when artifacts are missing (fall back to the TS engine). Must run BEFORE the first
  `startAudioWorklet()` — this repo uses `initializeOpenDAW`'s `onBeforeEngineStart` hook.
- `WasmEngine.setEnabled(bool)` persists a localStorage flag (`opendaw-wasm-engine`, default on);
  the provider returns null while disabled or not-ready.

**Serving the binaries:** the `.wasm` files ship in `@opendaw/studio-core-wasm/dist/wasm/` and are
served under `/wasm-engine` by the `wasm-engine-assets` (dev) / `wasm-engine-emit` (build) Vite
plugins — nothing binary is committed. `loadEngineModules` uses `fetch` + `WebAssembly.compile`,
so no `Content-Type` is required.

## Live engine swap (no reload)

`project.engine` is a persistent `EngineFacade` that outlives worklets. Swap engines with
`releaseWorklet()` → `startAudioWorklet(restart, {})` (re-reads `EngineVariant.current()`), capturing
`engine.position`/`engine.isPlaying` and restoring them so playback is seamless. See
`switchEngine()` in `src/lib/wasmEngine.ts`.

## Performance reporting is itself a cost

DSP-load measurement runs in the audio thread and perturbs the load it measures, so it is
**off by default** (`settings.debug.dspLoadMeasurement`, schema default `false`). Both engines read
it live: the TS engine per render; the WASM engine via a preference-path subscription. Read the
result from `project.engine.cpuLoad` (`ObservableValue<number>`, swap-safe on the facade) and
`project.engine.perfBuffer`. Dropout counts come from the **browser**: `audioContext.playbackStats.underrunEvents`
(Chromium-only — guard with a feature check); the SDK's `BufferUnderrunDetector` exposes no public
getter and logs nothing to the console.

## Reference Files
- WASM wiring + live swap: `src/lib/wasmEngine.ts`
- Content builder: `src/demos/engine/patternContent.ts`
- Demo: `src/demos/engine/wasm-engine-demo.tsx`
```

- [ ] **Step 4: Full build + zero-new-errors check**

Run: `npm run build`
Expected: succeeds (Vite + VitePress); the `wasmEngine` input builds; `wasm-engine/wasm/*.wasm` assets are emitted into `dist/`.

Run: `ls dist/wasm-engine/wasm/engine.wasm dist/wasm-engine/wasm/plugins/device_vaporisateur.wasm`
Expected: both paths exist.

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /tmp/branch-errors.txt; git stash; git worktree add /tmp/wasm-parent HEAD~7 2>/dev/null; echo "compare against parent baseline per CLAUDE.md 'zero new errors' recipe"`
Expected: the new `src/` files introduce **no** errors beyond the pre-existing ~14. (Use the CLAUDE.md `comm -13` recipe against the pre-branch parent commit if in doubt; clean up the worktree + `git stash pop` after.)

- [ ] **Step 5: Verify the index card renders**

Navigate to `https://localhost:5173/index.html` (fresh load) and confirm the "WASM Engine A/B" card appears and links to `/wasm-engine-demo.html`.

- [ ] **Step 6: Commit**

```bash
git add src/index.tsx public/sitemap.xml src/demos/engine/CLAUDE.md
git commit -m "feat(engine-demo): register WASM A/B demo (card, sitemap, category docs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Final verification & PR

**Files:** none (verification + PR)

- [ ] **Step 1: Regenerate lockfile only if package.json changed**

This feature adds no dependency (`@opendaw/studio-core-wasm` is already a transitive dep of the SDK). Confirm: `git diff --name-only main... | grep -E "package(-lock)?.json" || echo "no package.json change — no lockfile regen needed"`. If `package.json` did change, run `rm -rf node_modules package-lock.json && npm install` then `npm ci` per CLAUDE.md.

> If `@opendaw/studio-core-wasm` is NOT resolvable at build time (import fails), it may not be a declared dependency of `opendaw-headless`. In that case add it to `package.json` at the exact version in `node_modules/@opendaw/studio-core-wasm/package.json` (0.0.2), regenerate the lockfile as above, and verify with `npm ci`.

- [ ] **Step 2: Full clean verification**

Run: `npm run build && npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | wc -l`
Expected: build passes; `src/` error count equals the parent baseline (no new errors).

- [ ] **Step 3: Final browser smoke on the built output or dev server**

Re-run the Task 5 Step 4 checklist once more on a fresh load. All 7 checks pass.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/wasm-engine-ab-demo
gh pr create --title "feat: WASM engine A/B demo" --body "$(cat <<'EOF'
Adds a demo that boots the SDK's switchable WASM (Rust) engine and toggles TS↔WASM live during playback, with an opt-in DSP-load readout.

- src/lib/wasmEngine.ts — WasmEngine wiring + live switchEngine
- vite.config.ts — serve the shipped .wasm binaries under /wasm-engine (no committed binaries)
- projectSetup.ts — onBeforeEngineStart hook (engine-agnostic; other demos unaffected)
- src/demos/engine/ — Vaporisateur loop + reverb/delay content, demo UI, category CLAUDE.md
- Perf reporting gated on settings.debug.dspLoadMeasurement (off by default — observer effect)

Verified: build + tsc (zero new errors), browser smoke (seamless live swap, .wasm 200s, live DSP-load meter).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: PR review**

Run the comprehensive PR review (`/pr-review-toolkit:review-pr`, applicable aspects) and fix Critical + Important findings before merge, per CLAUDE.md. Note fixes in a PR comment.

---

## Self-Review Notes

**Spec coverage:** every spec component maps to a task — wasmEngine helper (T2), Vite serving (T1), projectSetup hook (T3), content (T4), UI incl. engine badge / live toggle / transport / perf toggle+readout (T5), registration + category CLAUDE.md (T6), error handling (graceful fallback in T2/T5; dev-middleware try/catch in T1), verification plan (T5/T6/T7). Non-goals (offline-render-through-WASM, composite/MIDIOutput, multitrack) are intentionally excluded.

**Type consistency:** `EngineStatus`/`describeEngineStatus`/`switchEngine` signatures are defined in T2 and consumed unchanged in T5; `buildWasmDemoContent(project)` defined in T4, called in T5; `onBeforeEngineStart(audioContext)` defined in T3, passed in T5.

**Known soft spots flagged for the implementer (not placeholders — each has a concrete reference):** the `patternContent.ts` adapter/box typings (reference `StepRecordingSection.tsx`), the `CONSOLE_STYLES.page` wrapper (reference `warp-overview.tsx`), and direct assignability of `settings.debug.dspLoadMeasurement` (reference upstream `PerformanceStats.tsx`). Each names the exact file to mirror.
