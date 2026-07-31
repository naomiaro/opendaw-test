# Signalsmith Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `AudioSignalsmithBox` (spectral phase-vocoder play mode) full demo coverage: a dedicated warp demo with a transpose story, a fourth A/B mode in the timestretch demo, a fourth mode in time-pitch-demo, an audio-verify scenario, and "why choose what" guidance across all three pages plus doc 18.

**Architecture:** All box work rides the existing warp scenario library (`applyWarpToGrid` shared body — Signalsmith has the same warp-marker shape as PitchStretch plus a `transpose` Float32 field). Demos are Vite multi-page React entries following the mastering-console design language. Verification is the existing offline-render harness + audio-analyzer MCP.

**Tech Stack:** React 18, Radix UI Themes, OpenDAW SDK 0.0.163 (WASM engine only), Vite, Playwright MCP + audio-analyzer MCP for verification.

**Spec:** `docs/superpowers/specs/2026-07-31-signalsmith-warp-demos-design.md`

## Global Constraints

- WASM engine only — there is no other engine; never add engine switches.
- `AudioSignalsmithBoxAdapter.cents = transpose * 100` and **neither the adapter nor the box clamps** (box numeric constraints are no-ops). Clamp transpose to **[−24, +24]** semitones at every UI write site.
- `AudioTimeStretchBoxAdapter.cents` DOES clamp playbackRate to [0.5, 2.0] (±1200 cents) — the two adapters differ; never assume symmetry.
- All box-graph writes inside `project.editing.modify()`; `refer()` replaces pointers atomically (never `defer()` + `refer()` in one transaction); post-swap `setPosition` only when `!isPlaying` (read live: `project.engine.isPlaying.getValue()`).
- PPQN `position` fields are Int32 — `Math.round()` any `PPQN.secondsToPulses` result.
- In-browser audio transport must be started with a REAL click (Playwright/claude-in-chrome coordinate click), never programmatic `.click()`.
- Verify audio by measuring output (RMS/WAV analysis), never by `isPlaying`/disabled buttons.
- `noUnusedLocals` is strict but `npm run build` doesn't run tsc — verify with `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/'` and judge against the parent commit's error set (some old demos carry pre-existing errors).
- Chapter docs (`documentation/*.md`) are present-tense — NO "SDK 0.0.xxx" version pins. Grep edited chapter docs for `0\.0\.[0-9]` before committing.
- No `package.json` changes anywhere in this plan — if you think you need one, stop and ask.
- Reuse an already-running dev server across verification rounds (kill by PID with `lsof -ti :<port> | xargs kill` if needed); don't stack fresh `npm run dev` instances.
- Terminology: "why choose what" copy must give TimeStretch's transient-preservation strength equal billing — guidance, not advocacy. Only claim audible characteristics you have actually heard/measured on the WASM engine.

---

### Task 1: Branch setup, `applySignalsmith` scenario builder, verify-harness scenarios, engine spot-check

This task retires the biggest risk first: proving the WASM engine actually renders
`AudioSignalsmithBox` regions (non-silent, beat-locked) before any UI is built on it.

**Files:**
- Modify: `src/demos/warp/lib/warpScenarios.ts`
- Modify: `src/demos/warp/audio-verify-debug.tsx`

**Interfaces:**
- Produces: `export type WarpStretchBox = AudioPitchStretchBox | AudioTimeStretchBox | AudioSignalsmithBox` and `export function applySignalsmith(ctx: WarpScenarioContext, anchors: ReadonlyArray<WarpAnchor>, transposeSemitones?: number): AudioSignalsmithBox` from `src/demos/warp/lib/warpScenarios.ts`. `WarpScenarioContext.prevStretchBox` widens to `WarpStretchBox | null`. Tasks 3, 4 consume these.
- Consumes: existing `applyWarpToGrid`, `buildWarpAnchors`, verify sink.

- [x] **Step 1: Create the working branch; move the spec commits off local main**

The two spec commits (`docs(specs): …`) were made on local `main`. Carry them onto the feature branch and reset local main to origin:

```bash
cd /Users/naomiaro/Code/opendaw-test
git checkout -b feat/signalsmith-demos
git fetch origin
git branch -f main origin/main
git log --oneline main..HEAD   # expect exactly the two docs(specs) commits
```

- [x] **Step 2: Capture the tsc baseline for the parent commit**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-baseline.txt
wc -l /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-baseline.txt
```

(TS5101 without the flag is environmental noise; `^src/` filters node_modules DOM-lib cascades.)

- [x] **Step 3: Add `WarpStretchBox` union + `applySignalsmith` to warpScenarios.ts**

In `src/demos/warp/lib/warpScenarios.ts`:

Add `AudioSignalsmithBox` to the `@opendaw/studio-boxes` import list (line 5-10).

Add the union type after the imports and use it in the context + shared body:

```typescript
/** Any of the three warp-marker play-mode boxes. */
export type WarpStretchBox =
  | AudioPitchStretchBox
  | AudioTimeStretchBox
  | AudioSignalsmithBox;
```

Change `WarpScenarioContext.prevStretchBox` from
`AudioPitchStretchBox | AudioTimeStretchBox | null` to `WarpStretchBox | null`.

Change `applyWarpToGrid`'s `createBox` parameter type and return type from
`AudioPitchStretchBox | AudioTimeStretchBox` to `WarpStretchBox` (both spots, and the
`let created!:` declaration inside).

Append after `applyTimeStretch`:

```typescript
/**
 * Signalsmith: beats lock via the same anchors, spectral phase-vocoder stretch,
 * independent pitch via `transpose` (semitones). No transient markers needed.
 * Neither the box nor the adapter clamps transpose — clamp here (±24 st).
 */
export function applySignalsmith(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>,
  transposeSemitones: number = 0
): AudioSignalsmithBox {
  const transpose = Math.max(-24, Math.min(24, transposeSemitones));
  return applyWarpToGrid(ctx, anchors, (project) =>
    AudioSignalsmithBox.create(project.boxGraph, UUID.generate(), (b) => {
      b.transpose.setValue(transpose);
    })
  ) as AudioSignalsmithBox;
}
```

- [x] **Step 4: Add `signalsmith` + `signalsmith-transposed` scenarios to the verify harness**

In `src/demos/warp/audio-verify-debug.tsx`:

```typescript
const SCENARIOS = [
  "raw",
  "varispeed",
  "timestretch",
  "signalsmith",
  "signalsmith-transposed",
  "grid-conform",
  "grid-rigid",
] as const;
```

Import `applySignalsmith` from `./lib/warpScenarios`. Add to the `switch`:

```typescript
    case "signalsmith":
      applySignalsmith(ctx, anchors);
      endPpqn = anchors[anchors.length - 1].tick;
      break;
    case "signalsmith-transposed":
      // +3 st: verify pitch does not move time (beat alignment must still hold).
      applySignalsmith(ctx, anchors, 3);
      endPpqn = anchors[anchors.length - 1].tick;
      break;
```

Also update the file's header comment scenario list.

- [x] **Step 5: Typecheck against baseline**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-task1.txt
comm -13 /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-baseline.txt /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-task1.txt
```

Expected: empty output (zero NEW errors).

- [x] **Step 6: Spot-check — render the signalsmith scenario and prove it is non-silent and beat-locked**

Start (or reuse) the dev server: `npm run dev -- --port 5181 --host 127.0.0.1` (background). Navigate Playwright to
`https://localhost:5181/audio-verify-debug.html?scenario=signalsmith`, poll
`#verify-state`'s `data-verify-state` until `done` (~15–30 s; on `error:<msg>` STOP and report).

Then check the WAV is real audio:

```bash
ls -la .verify-output/verify-signalsmith.wav   # expect ~99 MB, not ~0
```

Use audio-analyzer `spectral_features` on `.verify-output/verify-signalsmith.wav` with
`start_time: 60, end_time: 80` — expect RMS/loudness comparable to a music signal
(NOT digital silence). If silent: STOP — the engine may not support the box; investigate
against `studio-core-wasm` dists before building any UI (this is spec verify-item 1's
hard gate).

- [x] **Step 7: Commit**

```bash
git add src/demos/warp/lib/warpScenarios.ts src/demos/warp/audio-verify-debug.tsx
git commit -m "feat(warp): applySignalsmith scenario builder + verify-harness scenarios"
```

---

### Task 2: Numeric verification + audio-verify SKILL.md update

**Files:**
- Modify: `.claude/skills/audio-verify/SKILL.md`

**Interfaces:**
- Consumes: Task 1's rendered `verify-signalsmith.wav` + `verify-signalsmith-transposed.wav`, `scripts/expected-beats.ts`, `scripts/compare-beats.py`, audio-analyzer MCP.
- Produces: measured medians recorded in SKILL.md; later tasks rely on nothing from this task.

- [x] **Step 1: Render the transposed scenario**

Navigate Playwright to
`https://localhost:5181/audio-verify-debug.html?scenario=signalsmith-transposed`, poll to `done`.

- [x] **Step 2: Generate expected times and analyze both WAVs**

```bash
node scripts/expected-beats.ts > /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/expected.json
```

audio-analyzer `rhythm_analysis` on each WAV at windows **[60, 80] s** and **[120, 140] s**. Then for each window:

```bash
python3 scripts/compare-beats.py /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/expected.json gridTimes "<detected beats>"
```

Pass criteria (medians): `signalsmith` vs gridTimes **≤ 75 ms** on both windows (same
line as timestretch's WASM expectation; if it lands ≤ 60 ms, record that as the
assertion), and `signalsmith-transposed` vs gridTimes within **10 ms of untransposed**
per window (pitch must not move time). Also run `harmonic_analysis` pitch-class
distributions on [120, 140] for both: the transposed render's distribution must NOT
correlate best with the untransposed one at lag 0 — a +3 st shift rotates pitch classes;
assert `corr(untransposed, transposed rotated by −3)` > `corr(untransposed, transposed)`.
If any criterion fails: STOP, report numbers.

- [x] **Step 3: Update SKILL.md**

In `.claude/skills/audio-verify/SKILL.md`: change "five warp scenarios" to "seven";
add `signalsmith`, `signalsmith-transposed` to the `?scenario=` list in the Workflow
section; add two assertion-table rows with the criteria above **and the medians you
actually measured** (follow the existing "Measured YYYY-MM-DD" convention, dated
2026-07-31).

- [x] **Step 4: Commit**

```bash
git add .claude/skills/audio-verify/SKILL.md
git commit -m "docs(audio-verify): signalsmith scenarios, measured assertions"
```

---

### Task 3: Signalsmith as fourth mode in warp-timestretch-demo

**Files:**
- Modify: `src/demos/warp/warp-timestretch-demo.tsx`
- Modify: `warp-timestretch-demo.html` (meta copy only)

**Interfaces:**
- Consumes: `applySignalsmith`, `WarpStretchBox` from Task 1.
- Produces: nothing later tasks depend on.

- [x] **Step 1: Extend the mode union and refs**

In `src/demos/warp/warp-timestretch-demo.tsx`:

```typescript
type WarpMode = "raw" | "varispeed" | "timestretch" | "signalsmith";
```

Import `applySignalsmith` and `type WarpStretchBox` from `./lib/warpScenarios`;
import `AudioSignalsmithBox` from `@opendaw/studio-boxes`. Change
`stretchBoxRef`'s type to `useRef<WarpStretchBox | null>(null)`.

- [x] **Step 2: Wire the mode into switchMode**

In the `switchMode` ternary chain (no transient detection needed for signalsmith):

```typescript
        stretchBoxRef.current =
          next === "raw"
            ? applyRaw(ctx)
            : next === "varispeed"
              ? applyVarispeed(ctx, anchors)
              : next === "timestretch"
                ? applyTimeStretch(ctx, anchors, transientMode)
                : applySignalsmith(ctx, anchors);
```

Add the status string:

```typescript
            : next === "timestretch"
              ? "Ready — time-stretch: beats lock, pitch preserved (transient-segmented)"
              : "Ready — signalsmith: beats lock, pitch preserved (spectral)"
```

In the error-reconciliation branch add before the AudioTimeStretchBox check:

```typescript
        else if (current instanceof AudioSignalsmithBox) setMode("signalsmith");
```

- [x] **Step 3: Extend the segment readout and the segmented control**

Segment readout: extend the mode ternary so signalsmith reads like timestretch but names
the algorithm — `` `segment ${n + 1}/${bpms.length} · rate ${rate.toFixed(3)} · pitch unchanged (spectral)` ``.
(Use `modeRef.current === "varispeed"` / `=== "timestretch"` / else-signalsmith branches.)

Add the fourth item to the mode SegmentedControl:

```tsx
<SegmentedControl.Item value="signalsmith">Signalsmith</SegmentedControl.Item>
```

The transient-play-mode wrapper already gates on `mode !== "timestretch"` — signalsmith
correctly leaves it dimmed. No change needed there.

- [x] **Step 4: Update copy — intro + thesis section carry the "why choose what" contrast**

Replace the intro `<p className="mc-intro">` content: keep the existing triptych
sentences, then extend the final sentence about `AudioTimeStretchBox`, and append:

```tsx
            {" "}<em>Signalsmith</em> is the second pitch-preserving answer: the same
            markers through a spectral phase vocoder (<code>AudioSignalsmithBox</code>)
            — no transient markers required, pitch shiftable ±24 st. Percussive
            material tends to favor time-stretch&apos;s preserved attacks; sustained and
            harmonic material tends to favor the spectral path. A/B them here, and see
            the <a href="/warp-signalsmith-demo.html">signalsmith demo</a> for the
            transpose story.
```

In the "The thesis" anchors section, change "The same anchors driving varispeed drive
this engine untouched" wording to mention both stretch engines consume the identical
list (the sentence already makes the point — add "— and the spectral
Signalsmith engine consumes the identical list" after "untouched").

In `warp-timestretch-demo.html`, update `description` metas (all three: meta name,
og:description, twitter:description) from "the identical warp markers through
OpenDAW's transient-aware stretch engine" to "…through OpenDAW's transient-aware and
spectral stretch engines".

- [x] **Step 5: Typecheck**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-task3.txt
comm -13 /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-baseline.txt /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-task3.txt
```

Expected: empty.

- [x] **Step 6: Browser verification (real click, RMS tap)**

Load `https://localhost:5181/warp-timestretch-demo.html` fresh (claude-in-chrome).
Click "Signalsmith" (mode switches only when stopped — that's by design here), then
Play **by coordinates from a screenshot** (real click). Verify:
1. Output is non-silent: monkeypatch `AudioNode.prototype.connect` BEFORE clicking Play
   (javascript_tool) to tee `AudioDestinationNode` connections through an
   `AnalyserNode`; RMS over ~2 s must be ≳ 0.01.
2. Position advances (`project.engine.position` via React fiber, or the segment
   readout text changes).
3. Switch Stop → "Varispeed" → Play and confirm the pitch difference is audible in the
   spectral centroid (optional: two `spectral_features`-style analyser reads) — at
   minimum confirm no errors in console and both modes produce signal.
If the window is occluded and the UI freezes, `resize_window` first (known rAF
suspension, not a bug).

- [x] **Step 7: Commit**

```bash
git add src/demos/warp/warp-timestretch-demo.tsx warp-timestretch-demo.html
git commit -m "feat(warp): signalsmith joins the timestretch demo A/B"
```

---

### Task 4: New warp-signalsmith-demo page

**Files:**
- Create: `src/demos/warp/warp-signalsmith-demo.tsx`
- Create: `warp-signalsmith-demo.html`
- Modify: `vite.config.ts` (rollupOptions.input, after line ~153 `warpOverview`)

**Interfaces:**
- Consumes: `applySignalsmith`, `applyTimeStretch`, `applyRaw`, `WarpStretchBox`, `setupWarpDemo`, `WarpWaveform`, `usePlaybackPosition`, `useTransportControls`, `ensureTransientMarkers`.
- Produces: the page Task 5 wires into index/sitemap/overview.

- [x] **Step 1: Create `src/demos/warp/warp-signalsmith-demo.tsx`**

Full file (modeled on warp-timestretch-demo; three modes — raw baseline, signalsmith,
timestretch-for-A/B — plus a transpose slider that persists across mode switches):

```tsx
// src/demos/warp/warp-signalsmith-demo.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { TransientPlayMode } from "@opendaw/studio-enums";
import { AudioSignalsmithBox, AudioTimeStretchBox } from "@opendaw/studio-boxes";
import {
  AudioSignalsmithBoxAdapter,
  AudioTimeStretchBoxAdapter,
} from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { buildWarpAnchors, type WarpAnchor } from "@/lib/beats/beatMapConversions";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import { setupWarpDemo, type WarpDemoSetup } from "./lib/setupWarpDemo";
import {
  applyRaw,
  applySignalsmith,
  applyTimeStretch,
  type WarpScenarioContext,
  type WarpStretchBox,
} from "./lib/warpScenarios";
import { WarpWaveform, type WaveformSegment } from "./lib/WarpWaveform";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Badge,
  Separator,
  SegmentedControl,
  Slider,
  Button,
} from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const QUARTER = PPQN.Quarter;
const BAR = PPQN.fromSignature(4, 4);
// Adapter/box do NOT clamp transpose — the UI is the only clamp (±24 st).
const TRANSPOSE_MIN = -24;
const TRANSPOSE_MAX = 24;
// TimeStretch cents clamp is ±1200 → the A/B pitch-match only holds within ±12 st.
const TIMESTRETCH_MATCH_LIMIT = 12;
const PRESETS = [-2, 0, 3, 12] as const;

type WarpMode = "raw" | "signalsmith" | "timestretch";

function clampTranspose(st: number): number {
  return Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, st));
}

function WarpSignalsmithDemo() {
  const [setup, setSetup] = useState<WarpDemoSetup | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WarpMode>("raw");
  const [transpose, setTranspose] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [repaintKey, setRepaintKey] = useState(0);

  const anchorsRef = useRef<WarpAnchor[]>([]);
  const modeRef = useRef<WarpMode>("raw");
  const stretchBoxRef = useRef<WarpStretchBox | null>(null);
  const switchingRef = useRef(false);
  const transposeRef = useRef(0);
  transposeRef.current = transpose;
  const readoutRef = useRef<HTMLSpanElement | null>(null);
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

  // Live readout: mode + effective pitch.
  useEffect(() => {
    if (!setup) return undefined;
    const terminable = AnimationFrame.add(() => {
      const el = readoutRef.current;
      if (!el) return;
      const st = transposeRef.current;
      if (modeRef.current === "raw") {
        el.textContent = "— (raw: file plays at its own wobbly tempo, source pitch)";
      } else if (modeRef.current === "signalsmith") {
        el.textContent = `spectral stretch · transpose ${st >= 0 ? "+" : ""}${st} st`;
      } else {
        const matched = clampTranspose(st);
        const clamped = Math.abs(matched) > TIMESTRETCH_MATCH_LIMIT;
        const applied = Math.max(-TIMESTRETCH_MATCH_LIMIT, Math.min(TIMESTRETCH_MATCH_LIMIT, matched));
        el.textContent = `transient-segmented stretch · cents ${applied >= 0 ? "+" : ""}${applied * 100}${clamped ? " (clamped — TimeStretch range is ±12 st)" : ""}`;
      }
    });
    return () => terminable.terminate();
  }, [setup]);

  const switchMode = useCallback(
    async (next: WarpMode) => {
      if (!setup || switchingRef.current) return;
      const anchors = anchorsRef.current;
      switchingRef.current = true;
      setSwitching(true);
      try {
        setError(null);
        if (next === "timestretch") {
          setStatus("Detecting transients...");
          await ensureTransientMarkers(setup.project, setup.audioFileBox, setup.audioBuffer);
        }
        const ctx: WarpScenarioContext = {
          project: setup.project,
          region: setup.region,
          audioBuffer: setup.audioBuffer,
          markers: setup.markers,
          projectBpm: setup.projectBpm,
          prevStretchBox: stretchBoxRef.current,
        };
        stretchBoxRef.current =
          next === "raw"
            ? applyRaw(ctx)
            : next === "signalsmith"
              ? applySignalsmith(ctx, anchors, transposeRef.current)
              : applyTimeStretch(ctx, anchors, TransientPlayMode.Pingpong);
        if (next === "timestretch") {
          // Match the A/B pitch to the transpose value, within TimeStretch's clamp.
          const box = stretchBoxRef.current as AudioTimeStretchBox;
          setup.project.editing.modify(() => {
            setup.project.boxAdapters.adapterFor(box, AudioTimeStretchBoxAdapter).cents =
              clampTranspose(transposeRef.current) * 100;
          });
        }
        if (!setup.project.engine.isPlaying.getValue()) {
          setup.project.engine.setPosition(0);
          pausedPositionRef.current = 0;
        }
        modeRef.current = next;
        setMode(next);
        setRepaintKey((k) => k + 1);
        setStatus(
          next === "raw"
            ? "Ready — raw playback drifts off the click"
            : next === "signalsmith"
              ? "Ready — signalsmith: beats lock, pitch is yours to set"
              : "Ready — time-stretch: beats lock, pitch matched for A/B"
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed");
        const current = stretchBoxRef.current;
        if (current === null) setMode("raw");
        else if (current instanceof AudioSignalsmithBox) setMode("signalsmith");
        else setMode("timestretch");
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [setup, pausedPositionRef]
  );

  // Transpose writes are live controls — field reads happen per render block.
  const onTransposeChange = useCallback(
    (value: number) => {
      const st = clampTranspose(Math.round(value));
      setTranspose(st);
      if (!setup) return;
      const box = stretchBoxRef.current;
      if (box instanceof AudioSignalsmithBox) {
        setup.project.editing.modify(() => {
          setup.project.boxAdapters.adapterFor(box, AudioSignalsmithBoxAdapter).transpose = st;
        });
      } else if (box instanceof AudioTimeStretchBox) {
        setup.project.editing.modify(() => {
          setup.project.boxAdapters.adapterFor(box, AudioTimeStretchBoxAdapter).cents =
            st * 100; // adapter clamps to ±1200
        });
      }
    },
    [setup]
  );

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
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <div className="mc-kicker">Warp 04 — Signalsmith · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
            WARP TO GRID: SIGNALSMITH
          </h1>
          <p className="mc-intro">
            The spectral answer. The <strong>identical warp-marker list</strong> that
            drives <a href="/warp-varispeed-demo.html">varispeed</a> and{" "}
            <a href="/warp-timestretch-demo.html">time-stretch</a> here feeds an{" "}
            <code>AudioSignalsmithBox</code> — a Signalsmith phase-vocoder stretch that
            locks beats to the grid with <strong>no transient markers</strong> and lets
            you transpose the whole song ±24 semitones while the tempo stays put.
            Change the key without touching the clock.
          </p>
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
                  opacity: switching || isPlaying ? 0.5 : 1,
                  pointerEvents: switching || isPlaying || !setup ? "none" : "auto",
                }}
              >
                <SegmentedControl.Root
                  value={mode}
                  onValueChange={(v) => {
                    if (switchingRef.current || isPlaying) return;
                    void switchMode(v as WarpMode);
                  }}
                  size="3"
                >
                  <SegmentedControl.Item value="raw">Raw</SegmentedControl.Item>
                  <SegmentedControl.Item value="signalsmith">Signalsmith</SegmentedControl.Item>
                  <SegmentedControl.Item value="timestretch">Time-Stretch (A/B)</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
              <div
                style={{
                  opacity: switching || !setup || mode === "raw" ? 0.4 : 1,
                  pointerEvents: switching || !setup || mode === "raw" ? "none" : "auto",
                }}
              >
                <Flex direction="column" gap="2">
                  <Flex justify="between">
                    <Text size="2" weight="medium">
                      Transpose
                    </Text>
                    <Text size="2" color="gray">
                      {transpose >= 0 ? "+" : ""}
                      {transpose} st
                    </Text>
                  </Flex>
                  <Slider
                    value={[transpose]}
                    onValueChange={([v]) => onTransposeChange(v)}
                    min={TRANSPOSE_MIN}
                    max={TRANSPOSE_MAX}
                    step={1}
                  />
                  <Flex gap="2" wrap="wrap">
                    {PRESETS.map((st) => (
                      <Button
                        key={st}
                        size="1"
                        variant={transpose === st ? "solid" : "soft"}
                        color="gray"
                        onClick={() => onTransposeChange(st)}
                      >
                        {st >= 0 ? "+" : ""}
                        {st} st
                      </Button>
                    ))}
                  </Flex>
                  <Text size="1" color="gray">
                    Live during playback. Signalsmith range ±24 st (the UI clamps —
                    neither the box nor the adapter does). In Time-Stretch A/B the same
                    value drives <code>cents</code>, clamped by the adapter to ±12 st.
                  </Text>
                </Flex>
              </div>
              <Text size="2" color="gray">
                Project grid: {setup?.projectBpm ?? "..."} BPM — both stretch modes lock
                to it; raw drifts.
              </Text>
              <Text size="2" color="gray">
                Engine: <span ref={readoutRef}>—</span>
              </Text>
            </Flex>
          </Card>
          {setup && (
            <div className="mc-lattice-frame">
              <WarpWaveform
                project={setup.project}
                fileUuid={setup.fileUuid}
                getSegments={getSegments}
                getBarLines={getBarLines}
                getPlayheadFrac={getPlayheadFrac}
                repaintKey={repaintKey}
                onError={setError}
              />
            </div>
          )}
          <Card>
            <Flex direction="column" gap="3" p="3">
              <Heading size="4">Transport</Heading>
              <Flex gap="2">
                <Button onClick={handlePlay} disabled={!setup || isPlaying} color="green">
                  Play
                </Button>
                <Button onClick={handlePause} disabled={!setup || !isPlaying}>
                  Pause
                </Button>
                <Button onClick={handleStop} disabled={!setup} variant="soft" color="gray">
                  Stop
                </Button>
              </Flex>
            </Flex>
          </Card>
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">Which stretch, when?</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="mc-choice-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Pitch ↔ time</th>
                    <th>Pitch range</th>
                    <th>Needs</th>
                    <th>Reach for it when</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>NoStretch</td>
                    <td>both fixed at source</td>
                    <td>—</td>
                    <td>nothing</td>
                    <td>audio shouldn&apos;t follow tempo; it drifts under BPM changes</td>
                  </tr>
                  <tr>
                    <td>Varispeed</td>
                    <td>coupled</td>
                    <td>follows tempo</td>
                    <td>warp markers</td>
                    <td>the tape sound is fine or the point; cheapest, artifact-free</td>
                  </tr>
                  <tr>
                    <td>Time-stretch</td>
                    <td>decoupled</td>
                    <td>±12 st</td>
                    <td>warp markers + ≥2 transient markers</td>
                    <td>percussive material — transient-segmented playback keeps attacks sharp</td>
                  </tr>
                  <tr>
                    <td>Signalsmith</td>
                    <td>decoupled</td>
                    <td>±24 st</td>
                    <td>warp markers only</td>
                    <td>sustained or harmonic material, big transposes, or files where transient detection has nothing to find</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The transient dependency is the sharp edge: <code>AudioTimeStretchBox</code>{" "}
              renders <strong>silence</strong> with fewer than two transient markers on
              the file, so sparse material — pads, drones, a solo sustained vocal — can
              defeat it outright. <code>AudioSignalsmithBox</code> has no such
              dependency. The trade runs the other way on drums: the segment player
              re-syncs at every attack, while a phase vocoder must reconstruct attacks
              spectrally. A/B the two pitch-preserving modes above on the same song and
              judge with your own ears; the{" "}
              <a href="/time-pitch-demo.html">time &amp; pitch demo</a> covers the same
              four modes as API mechanics, and the{" "}
              <a href="/warp-demos.html">warp overview</a> maps them onto the DAWs you
              know.
            </p>
          </section>
          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpSignalsmithDemo />);
```

Note on the table: check `src/lib/design/consoleTheme.ts` for an existing table class
before inventing `mc-choice-table`. If none exists, add minimal styles to the page via
the existing `<style>` block pattern (borders `var(--mc-line-bright)`, header in the
kicker type style) — do NOT edit the shared theme for one page unless a table style
already half-exists there.

- [x] **Step 2: Create `warp-signalsmith-demo.html`**

Copy `warp-timestretch-demo.html` exactly, then change: `<title>`/meta titles to
"OpenDAW Warp Demo — Signalsmith: Lock the Beats, Change the Key"; descriptions to
"Conform a full song to the grid with OpenDAW's Signalsmith spectral stretch and
transpose it ±24 semitones live — no transient markers, tempo untouched. A/B against
transient-aware time-stretch."; canonical/og:url to
`https://opendaw-test.pages.dev/warp-signalsmith-demo.html`; og:image/twitter:image to
`https://opendaw-test.pages.dev/og-image-warp-signalsmith.png`; script src to
`/src/demos/warp/warp-signalsmith-demo.tsx`. Keep the GoatCounter script line and the
crossorigin font links verbatim.

- [x] **Step 3: Add the Vite entry**

In `vite.config.ts` after the `warpOverview` line (~154):

```typescript
                warpSignalsmith: resolve(__dirname, "warp-signalsmith-demo.html"),
```

- [x] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-task4.txt
comm -13 /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-baseline.txt /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-task4.txt
npm run build 2>&1 | tail -5
```

Expected: no new tsc errors; build succeeds.

- [x] **Step 5: Browser verification — the three spec verify-items land here**

Fresh load of `https://localhost:5181/warp-signalsmith-demo.html` (claude-in-chrome,
window visible):

1. **Engine renders it live**: click Signalsmith, Play by real coordinate click, tap
   output RMS via the AnalyserNode monkeypatch (≳ 0.01 over 2 s).
2. **Live transpose (spec verify-item 1)**: while playing, drag the transpose slider
   0 → +12. Confirm (a) `project.engine.position` keeps advancing monotonically (no
   reset), (b) pitch audibly/measurably rises — compare analyser spectral centroid
   before/after, expect a clear upward shift. If position resets or writes are
   inaudible until restart, add an `!isPlaying` gate + helper text to the slider and
   note the finding in the demo copy and warp CLAUDE.md.
3. **A/B toggle**: Stop, switch Time-Stretch (A/B) with transpose +3, Play — both
   modes sound at the same pitch class. Switch back. No console errors on a fresh
   load.
4. **Mobile clipping**: at 390px width, verify the table's container scrolls
   horizontally (`el.scrollWidth > el.clientWidth` on the wrapper is OK, on `body` is
   not).

- [x] **Step 6: Listen and true-up the copy (spec verify-item 3)**

Play 20–30 s in each of signalsmith and timestretch at +3 st and at −12 st. If the
"percussive favors time-stretch / sustained favors spectral" claim does NOT match what
the WASM engine actually sounds like on Otherside, rewrite those copy sentences (here
and in Task 3's intro) to describe the actual audible difference. Record what you heard
in the task summary.

- [x] **Step 7: Commit**

```bash
git add src/demos/warp/warp-signalsmith-demo.tsx warp-signalsmith-demo.html vite.config.ts
git commit -m "feat(warp): signalsmith demo — spectral grid conform with live transpose"
```

---

### Task 5: Launch collateral — index card, sitemap, warp-overview panel, og-image

**Files:**
- Modify: `src/index.tsx` (Warp & Pitch section, ~line 150)
- Modify: `public/sitemap.xml`
- Modify: `src/demos/warp/warp-overview.tsx`
- Create: `public/og-image-warp-signalsmith.png`

**Interfaces:**
- Consumes: Task 4's live page.
- Produces: nothing downstream.

- [x] **Step 1: Index card**

In `src/index.tsx`, in the "Warp & Pitch" section after the "Warp: Who Bends?" entry:

```typescript
      {
        href: "/warp-signalsmith-demo.html",
        title: "Warp: Signalsmith",
        blurb:
          "Conform a song to the grid with the Signalsmith spectral stretch and transpose it ±24 semitones live — no transient markers needed. A/B against transient-aware time-stretch.",
      },
```

Also update the "Time & Pitch" card blurb in the same section to:

```typescript
        blurb:
          "Switch a region between NoStretch, PitchStretch (varispeed), TimeStretch (transient-aware), and Signalsmith (spectral) play modes. Independent pitch in cents on both decoupled modes.",
```

- [x] **Step 2: Sitemap**

In `public/sitemap.xml`, next to the other warp URLs:

```xml
  <url><loc>https://opendaw-test.pages.dev/warp-signalsmith-demo.html</loc></url>
```

- [x] **Step 3: Fourth panel + copy updates in warp-overview.tsx**

Append to the `SCENARIOS` array:

```typescript
  {
    index: "04",
    chip: "var(--mc-violet)",
    name: "Signalsmith",
    direction: "FILE → GRID, SPECTRAL",
    hear: "Beats lock, key is yours to choose",
    daws: ["Ableton Complex/Complex Pro", "Serato Pitch 'n Time"],
    href: "/warp-signalsmith-demo.html",
    prose:
      "The second pitch-preserving answer, built for what defeats the slicer: sustained pads, drones, and sparse material where transient detection has nothing to find — and for big transposes, up to ±24 semitones while the tempo stays put. A phase vocoder stretches the spectrum rather than slicing at attacks, so the trade runs the other way on drums.",
  },
```

Check `--mc-violet` exists in `consoleTheme.ts`; if not, pick an existing token that
isn't amber/cyan/green. Update the header intro sentence "Every DAW surfaces exactly
three answers" — with Signalsmith the honest framing is three *directions* with two
pitch-preserving engines; rewrite as:
"Every DAW surfaces exactly three answers: <strong>bend the file</strong>,
<strong>bend the grid</strong>, or <strong>slice and stretch</strong> — and the third
answer ships two engines: slice at transients, or stretch the spectrum."
Update the "Engine-agnostic anchors" section sentence to include
`AudioSignalsmithBox` in the list of boxes the same anchors drive, and mention the
signalsmith demo alongside the timestretch demo link. Check whether the `mc-grid` CSS
handles 4 panels acceptably at desktop and mobile widths (screenshot both); adjust
only if a panel overflows.

- [x] **Step 4: og-image**

With the dev server running, screenshot the loaded warp-signalsmith page at 1200×630
(Playwright `browser_resize` to 1200×630 then screenshot; or claude-in-chrome
resize_window — re-screenshot after resize per the known coordinate-drift issue).
Save as `public/og-image-warp-signalsmith.png`. Verify file size is reasonable
(`ls -la public/og-image-warp-signalsmith.png`, expect > 50 KB).

- [x] **Step 5: Typecheck + visual check**

tsc baseline diff (same command pattern as Task 4 Step 4, output to `tsc-task5.txt`) —
expect empty. Load `https://localhost:5181/` and `https://localhost:5181/warp-demos.html`,
screenshot both, confirm the new card and fourth panel render without layout breakage.

- [x] **Step 6: Commit**

```bash
git add src/index.tsx public/sitemap.xml src/demos/warp/warp-overview.tsx public/og-image-warp-signalsmith.png
git commit -m "feat(warp): wire signalsmith demo into index, sitemap, overview"
```

---

### Task 6: Fourth mode in time-pitch-demo

**Files:**
- Modify: `src/demos/playback/time-pitch-demo.tsx`
- Modify: `time-pitch-demo.html` (meta copy only)

**Interfaces:**
- Consumes: `AudioSignalsmithBox` (box), `AudioSignalsmithBoxAdapter` — direct SDK use; this page intentionally does NOT use warpScenarios (it builds trivial endpoint markers, not beat maps).
- Produces: nothing downstream.

**Decision (spec verify-item 4, resolved):** the A4 auto-engage path keeps targeting
TimeStretch when no decoupled mode is active — minimal diff, existing copy stays true.
When the active mode is already Signalsmith, the tuning offset is applied to the
Signalsmith box instead (no mode change). State this in the Reference Pitch card copy.

- [ ] **Step 1: Extend the mode union, imports, and refs**

```typescript
type PlayMode = "none" | "pitch" | "time" | "smith";
```

Add `AudioSignalsmithBox` to the `@opendaw/studio-boxes` import and
`AudioSignalsmithBoxAdapter` to the `@opendaw/studio-adapters` import. Widen
`stretchBoxRef` to `useRef<AudioPitchStretchBox | AudioTimeStretchBox | AudioSignalsmithBox | null>(null)`.

- [ ] **Step 2: Extend switchMode**

In the transient-detection guard, `nextMode === "time"` stays the only detection case
("smith" needs none). In the box-creation ternary:

```typescript
          const nextBox =
            nextMode === "pitch"
              ? AudioPitchStretchBox.create(boxGraph, UUID.generate())
              : nextMode === "smith"
                ? AudioSignalsmithBox.create(boxGraph, UUID.generate())
                : AudioTimeStretchBox.create(boxGraph, UUID.generate(), (b) => {
                    b.transientPlayMode.setValue(transientMode);
                  });
```

After the existing `if (nextBox instanceof AudioTimeStretchBox)` tuning block, add:

```typescript
          if (nextBox instanceof AudioSignalsmithBox) {
            // Same tuning carry-over; Signalsmith cents = transpose*100, unclamped
            // by the adapter — the UI clamp (±2400) lives in onCentsChange.
            project.boxAdapters.adapterFor(
              nextBox,
              AudioSignalsmithBoxAdapter
            ).cents = computeTuningCents(
              referencePitchRef.current,
              initialPitchRef.current
            );
          }
```

In the error-reconciliation branch add before the TimeStretch check:

```typescript
        else if (current instanceof AudioSignalsmithBox) setPlayMode("smith");
```

- [ ] **Step 3: Extend onCentsChange to drive whichever decoupled box is active**

Replace the body's early-return + adapter write with:

```typescript
      if (!project) return;
      const box = stretchBoxRef.current;
      if (!box) return;
      const total =
        value +
        computeTuningCents(referencePitchRef.current, initialPitchRef.current);
      if (box instanceof AudioTimeStretchBox) {
        const adapter = project.boxAdapters.adapterFor(box, AudioTimeStretchBoxAdapter);
        project.editing.modify(() => {
          adapter.cents = total; // adapter clamps rate to [0.5, 2.0]
        });
      } else if (box instanceof AudioSignalsmithBox) {
        const adapter = project.boxAdapters.adapterFor(box, AudioSignalsmithBoxAdapter);
        project.editing.modify(() => {
          // No adapter clamp — enforce ±2400 cents (±24 st) here.
          adapter.cents = Math.max(-2400, Math.min(2400, total));
        });
      } else {
        return;
      }
      setCents(value);
```

- [ ] **Step 4: Extend onReferencePitchChange**

Inside the existing `editing.modify`, after the TimeStretch branch, add a Signalsmith
branch with the same `centsRef.current + computeTuningCents(...)` write via
`AudioSignalsmithBoxAdapter` (clamped ±2400 as above). Change the auto-engage guard
`if (currentBox instanceof AudioTimeStretchBox) return;` to also return for
`AudioSignalsmithBox` (already-decoupled — no engage needed).

- [ ] **Step 5: UI — fourth segment, cents slider in smith mode, readouts**

- Add `<SegmentedControl.Item value="smith">Signalsmith</SegmentedControl.Item>`.
- The cents/transient block is gated `playMode === "time"` — change the gate to
  `playMode === "time" || playMode === "smith"`, keep the transient-mode sub-block
  gated on `playMode === "time"` only.
- Slider `min`/`max`: `playMode === "smith" ? ±2400 : ±1200`; step stays 50. When
  switching modes, `setCents(0)` already runs — no range-crossing bug.
- Rate/clamp readout: the `computePlaybackRate` display is TimeStretch-specific.
  For smith mode display `transpose {(cents/100).toFixed(2)} st · tempo unchanged`
  instead of `rate N×` (spectral shift does not change the read rate). Gate
  `isCentsClamped` display to time mode.
- Add a mode-description branch to the two `playMode === …` copy ternaries:
  - Play Mode card: `{playMode === "smith" && (<><Code>AudioSignalsmithBox</Code>{" "}
    attached with two warp markers. Spectral phase-vocoder stretch — pitch is
    independent (±24 st) and no transient markers are needed.</>)}`
  - Project BPM card: `{playMode === "smith" && (<><strong>Signalsmith:</strong> the
    file follows the BPM; pitch stays where you set it — the spectrum is stretched
    rather than sliced, so no transient markers are involved.</>)}`
- Intro copy: "the three audio play modes" → "the four audio play modes"; append to
  the SDK-reference paragraph: `AudioSignalsmithBox` = spectral stretch;
  `AudioSignalsmithBoxAdapter.cents` maps to `transpose` (×100) and — unlike the
  TimeStretch adapter — applies **no clamp**, so the UI enforces ±2400. Link the
  warp-signalsmith demo for the musical story.
- Reference Pitch card copy: append a sentence — "In Signalsmith mode the retune is
  applied spectrally to the same box; auto-engage (from NoStretch/PitchStretch) still
  targets TimeStretch."

- [ ] **Step 6: HTML meta copy**

In `time-pitch-demo.html`, update title/description metas mentioning "three play
modes" to four, adding "Signalsmith (spectral)". (Read the file first; it was not
inspected during planning.)

- [ ] **Step 7: Typecheck + browser verification**

tsc baseline diff (output `tsc-task6.txt`) — expect empty. Fresh load of
`https://localhost:5181/time-pitch-demo.html`: click Signalsmith (mode switch works
stopped), real-click Play, RMS-tap non-silent; drag cents to +2400 and confirm two
octaves up audibly/spectrally; switch to TimeStretch and confirm slider range drops to
±1200 with cents reset to 0; drag A4 slider in smith mode and confirm no mode change
occurs and pitch shifts by the tuning offset. No console errors on fresh load.

- [ ] **Step 8: Commit**

```bash
git add src/demos/playback/time-pitch-demo.tsx time-pitch-demo.html
git commit -m "feat(playback): signalsmith as fourth mode in time-pitch demo"
```

---

### Task 7: Documentation — doc 18 decision matrix + CLAUDE.md notes

**Files:**
- Modify: `documentation/18-time-and-pitch.md`
- Modify: `src/demos/warp/CLAUDE.md`
- Modify: `src/demos/playback/CLAUDE.md`

**Interfaces:** none — docs only.

- [ ] **Step 1: Extend the Decision Matrix tree in doc 18 (~line 40)**

Replace the final `└── Yes …` branch of the tree with:

```
         └── Yes (musical time-stretch) → two engines:
             │
             ├── Percussive / rhythmic material, pitch within ±1 octave
             │   → TimeStretch. Transient-segmented playback preserves
             │     attacks. Requires ≥2 transient markers on the file
             │     (fewer renders silence).
             │
             └── Sustained / harmonic material, big transposes (±24 st),
                 or no usable transients → Signalsmith. Spectral
                 phase-vocoder stretch; no transient markers needed.
```

Update the chapter's demo link line (~624): "switch a region between the three play
modes" → "switch a region between the four play modes", and mention the Signalsmith
cents range. Add a demo link for the warp-signalsmith page next to the existing warp
demo links if the chapter has a demo-links block. Grep the edited file for
`0\.0\.[0-9]` — must return nothing new (present-tense rule).

- [ ] **Step 2: CLAUDE.md notes**

`src/demos/warp/CLAUDE.md` — extend the "Warp anchors are engine-agnostic" bullet to
name all three boxes and `applySignalsmith`; add one bullet:
"`AudioSignalsmithBoxAdapter.cents` = `transpose * 100`, NO clamp (unlike
`AudioTimeStretchBoxAdapter.cents` which clamps rate to [0.5, 2.0]) — clamp ±24 st at
the UI. Signalsmith needs no transient markers; TimeStretch silences below 2."
Add the live-transpose finding from Task 4 Step 5 (whichever way it landed).
`src/demos/playback/CLAUDE.md` — the play-modes paragraph already covers Signalsmith;
update only if Task 6 contradicted anything written there (e.g. the clamp note:
"adapter exposes `transpose`/`cents`" should gain "(unclamped)").

- [ ] **Step 3: Commit**

```bash
git add documentation/18-time-and-pitch.md src/demos/warp/CLAUDE.md src/demos/playback/CLAUDE.md
git commit -m "docs: signalsmith branch in decision matrix; adapter clamp notes"
```

---

### Task 8: Final verification, PR, review

**Files:** none new.

- [ ] **Step 1: Full check**

```bash
npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' | sort > /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-final.txt
comm -13 /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-baseline.txt /private/tmp/claude-501/-Users-naomiaro-Code-opendaw-test/83cbd9ad-e452-4ae7-aa93-08bd3ad9ec71/scratchpad/tsc-final.txt
npm run build 2>&1 | tail -3
npm test 2>&1 | tail -5
```

Expected: no new tsc errors, build green, existing vitest suite green (beats lib —
untouched, but confirm; remember worktrees double test counts if any exist).

- [ ] **Step 2: Re-render one verify scenario as a regression spot-check**

`?scenario=signalsmith` once more on the final code; confirm `done` and WAV size
matches Task 1's within a few MB (guards against a late copy/wiring change breaking
the harness).

- [ ] **Step 3: Delete the spec + plan (repo convention), push, open PR**

```bash
git rm docs/superpowers/specs/2026-07-31-signalsmith-warp-demos-design.md docs/superpowers/plans/2026-07-31-signalsmith-demos.md
git commit -m "chore: remove completed signalsmith spec/plan (docs convention)"
git push -u origin feat/signalsmith-demos
gh pr create --title "feat: Signalsmith play-mode demo coverage" --body "..."
```

PR body: summarize the six deliverables, the measured audio-verify medians (Task 2),
the live-transpose finding (Task 4), and end with the standard Claude Code footer.

- [ ] **Step 4: PR review**

Run `/pr-review-toolkit:review-pr` (applicable aspects), FIX Critical + Important
findings, push fixes, note them in a PR comment. Merge is squash (`gh pr merge --squash`)
— but only when the user says to merge.
