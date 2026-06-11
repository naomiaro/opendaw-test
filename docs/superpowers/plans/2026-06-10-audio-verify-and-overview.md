# Audio-Verify Skill + Warp Overview Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (a) A public "Who Bends?" overview/TOC page replacing the three warp index cards; (b) an `audio-verify` project skill that offline-renders the five warp scenarios to WAVs on disk and asserts beat alignment via the audio-analyzer MCP.

**Architecture:** Demo mode-switch transactions get factored into shared `warpScenarios.ts` apply-functions consumed by both the demo pages and a new unlisted harness page. The harness renders full-song mixdowns through the existing `rangeExport.ts` pipeline (`WavFile.encodeFloats` for WAV) and PUTs bytes to a dev-only Vite middleware that writes `.verify-output/*.wav`. A pure `expectedTimes.ts` module (unit-tested) computes per-scenario expected onset times; `SKILL.md` codifies the Playwright + analyzer workflow and tolerances.

**Tech Stack:** OpenDAW SDK 0.0.154 (`rangeExport.ts` render pipeline, `WavFile.encodeFloats`), Vite dev middleware, Vitest, Playwright MCP, audio-analyzer MCP, Node ≥ 23 type-stripping for the script.

**Specs:** `docs/superpowers/specs/2026-06-10-audio-verify-skill-design.md`, `docs/superpowers/specs/2026-06-10-warp-overview-page-design.md`

**Branch:** `beat-map-triptych-demos`, worktree `/Users/naomiaro/Code/opendaw-headless/.claude/worktrees/beat-map-triptych` — ALL work happens there. PR #67 is open; these land as additional commits.

---

## Verified facts (do not re-derive)

- `src/lib/rangeExport.ts` has the full manual offline pipeline as private `renderRange(project, startPpqn, endPpqn, sampleRate, exportConfiguration?, mutateBeforeCopy?, restoreAfterCopy?, metronomeEnabled=false, metronomeGain=-6): Promise<Float32Array[]>` — mixdown when `exportConfiguration` undefined; metronome set on `engineWorklet.preferences` (prefs don't travel with `project.copy()`); loop disabled on the copy; 30 s sample-loading timeout. Also exports `channelsToAudioBuffer(channels, sampleRate)`.
- WAV encoding: `WavFile.encodeFloats(audioBuffer): ArrayBuffer` from `@opendaw/lib-dsp` (float32 WAV). Full song @ 48 kHz stereo float32 ≈ 99 MB — middleware cap is 150 MB (spec said 100; deviation noted).
- Scenario transactions live inline in the three demo pages (Tasks 6–8 of the previous plan); the loop-area write (`timelineBox.loopArea.to`) is inside each mode-switch transaction.
- `barsToTempoEvents(markers, 960)` → 130 events; `buildWarpAnchors(markers, duration, 960)` → 513 anchors (lead-in + 511 markers + outro); `gridAnchorTicks` → `{firstBeatTick: 2880, firstDownbeatTick: 3840}`; `round(averageBpm) = 123`.
- Demo 2's end tick: `firstBeatTick + (markers.length - 1) * QUARTER + BAR`.
- Node in worktree is v24 — `node script.ts` works via default type stripping (engines requires ≥ 23).
- Playwright MCP drives `https://localhost:<port>/...` (HTTPS certs copied into the worktree already).
- audio-analyzer MCP reads absolute paths on local disk; `rhythm_analysis` returns detected beat lists; tolerances measured earlier: onset jitter ~20–50 ms vs the beat map.

## File structure

```
src/demos/warp/lib/warpScenarios.ts          # Task 1 — shared apply-functions
src/lib/rangeExport.ts                       # Task 2 — export renderMixdownRange wrapper (modify)
vite.config.ts                               # Task 2 — verifySink dev middleware (modify)
.gitignore                                   # Task 2 — .verify-output/ (modify)
src/lib/beats/expectedTimes.ts               # Task 3 — pure expected-times math
src/lib/beats/expectedTimes.test.ts          # Task 3
scripts/expected-beats.ts                    # Task 3 — thin CLI printing JSON
audio-verify-debug.html                      # Task 4 — unlisted harness entry
src/demos/warp/audio-verify-debug.tsx        # Task 4
.claude/skills/audio-verify/SKILL.md         # Task 5
src/demos/warp/warp-overview.tsx             # Task 6 — overview page
warp-demos.html                              # Task 6
src/index.tsx, public/sitemap.xml            # Task 6 (modify)
public/og-image-warp-overview.png            # Task 6
src/demos/warp/warp-*-demo.tsx               # Task 1 (refactor) + Task 6 (overview links)
```

---

### Task 1: Extract shared scenario builders (`warpScenarios.ts`) and refactor the three demos

**Files:**
- Create: `src/demos/warp/lib/warpScenarios.ts`
- Modify: `src/demos/warp/warp-varispeed-demo.tsx`, `src/demos/warp/warp-timestretch-demo.tsx`, `src/demos/warp/warp-grid-follows-file-demo.tsx`

No unit tests (SDK/browser-bound); verification = tsc + build + a browser spot-check that demo behavior is unchanged.

- [ ] **Step 1: Create `src/demos/warp/lib/warpScenarios.ts`**

```typescript
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import {
  AudioFileBox,
  AudioRegionBox,
  AudioPitchStretchBox,
  AudioTimeStretchBox,
  WarpMarkerBox,
} from "@opendaw/studio-boxes";
import { TransientPlayMode } from "@opendaw/studio-enums";
import type { BeatMarker } from "@/lib/beats/beatsParser";
import {
  gridAnchorTicks,
  clipStartSeconds,
  type WarpAnchor,
  type TempoEvent,
} from "@/lib/beats/beatMapConversions";

const QUARTER = PPQN.Quarter;
const BAR = PPQN.fromSignature(4, 4);

/** Everything an apply-function needs. Demos pass their setup + current stretch box. */
export interface WarpScenarioContext {
  project: Project;
  region: AudioRegionBox;
  audioFileBox: AudioFileBox;
  audioBuffer: AudioBuffer;
  markers: BeatMarker[];
  projectBpm: number;
  /** Stretch box from a previous apply call; deleted inside the next transaction. */
  prevStretchBox: AudioPitchStretchBox | AudioTimeStretchBox | null;
}

/** Raw-mode timeline end: file duration in ticks at the rigid project tempo. */
export function rawEndPpqn(ctx: Pick<WarpScenarioContext, "audioBuffer" | "projectBpm">): number {
  return Math.round(PPQN.secondsToPulses(ctx.audioBuffer.duration, ctx.projectBpm));
}

/** Grid demo timeline end: last tracked beat + one bar of outro headroom. */
export function gridEndTick(markers: ReadonlyArray<BeatMarker>): number {
  const { firstBeatTick } = gridAnchorTicks(markers, QUARTER);
  return firstBeatTick + (markers.length - 1) * QUARTER + BAR;
}

/**
 * NoStretch / Seconds timeBase / full-file durations. One transaction.
 * Returns null (no stretch box in raw mode).
 */
export function applyRaw(ctx: WarpScenarioContext): null {
  const { project, region, audioBuffer } = ctx;
  project.editing.modify(() => {
    project.timelineBox.loopArea.to.setValue(rawEndPpqn(ctx));
    region.playMode.defer();
    if (ctx.prevStretchBox) ctx.prevStretchBox.delete();
    region.timeBase.setValue(TimeBase.Seconds);
    region.duration.setValue(audioBuffer.duration);
    region.loopOffset.setValue(0);
    region.loopDuration.setValue(audioBuffer.duration);
  });
  return null;
}

/**
 * Shared body for both warp-to-grid modes: create the stretch box, pin one
 * WarpMarkerBox per anchor, swap the region's playMode (refer replaces
 * atomically; delete prev AFTER refer), flip to Musical timeBase. One
 * transaction, per the SDK's AudioContentModifier pattern.
 */
function applyWarpToGrid(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>,
  createBox: (project: Project) => AudioPitchStretchBox | AudioTimeStretchBox
): AudioPitchStretchBox | AudioTimeStretchBox {
  const { project, region } = ctx;
  const endTick = anchors[anchors.length - 1].tick;
  let created: AudioPitchStretchBox | AudioTimeStretchBox = null as never;
  project.editing.modify(() => {
    project.timelineBox.loopArea.to.setValue(endTick);
    created = createBox(project);
    for (const anchor of anchors) {
      WarpMarkerBox.create(project.boxGraph, UUID.generate(), (m) => {
        m.owner.refer(created.warpMarkers);
        m.position.setValue(anchor.tick);
        m.seconds.setValue(anchor.second);
      });
    }
    region.playMode.refer(created);
    if (ctx.prevStretchBox) ctx.prevStretchBox.delete();
    region.timeBase.setValue(TimeBase.Musical);
    region.duration.setValue(endTick);
    region.loopOffset.setValue(0);
    region.loopDuration.setValue(endTick);
  });
  return created;
}

/** Varispeed: beats lock to the grid, pitch follows rate. */
export function applyVarispeed(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>
): AudioPitchStretchBox {
  return applyWarpToGrid(ctx, anchors, (project) =>
    AudioPitchStretchBox.create(project.boxGraph, UUID.generate())
  ) as AudioPitchStretchBox;
}

/**
 * TimeStretch: beats lock, pitch preserved (rate 1.0). Caller MUST await
 * ensureTransientMarkers on the file box first — zero transients renders silence.
 */
export function applyTimeStretch(
  ctx: WarpScenarioContext,
  anchors: ReadonlyArray<WarpAnchor>,
  transientPlayMode: TransientPlayMode
): AudioTimeStretchBox {
  return applyWarpToGrid(ctx, anchors, (project) =>
    AudioTimeStretchBox.create(project.boxGraph, UUID.generate(), (b) => {
      b.transientPlayMode.setValue(transientPlayMode);
      b.playbackRate.setValue(1.0);
    })
  ) as AudioTimeStretchBox;
}

/**
 * Grid demo region placement: audio's first tracked beat sounds at
 * firstBeatTick; waveformOffset trims the file's pre-beat lead-in. One
 * transaction. Region stays NoStretch / Seconds timeBase.
 */
export function applyGridPlacement(ctx: WarpScenarioContext): void {
  const { project, region, audioBuffer, markers } = ctx;
  const { firstBeatTick } = gridAnchorTicks(markers, QUARTER);
  const s0 = clipStartSeconds(markers);
  project.editing.modify(() => {
    region.position.setValue(firstBeatTick);
    region.duration.setValue(audioBuffer.duration - s0);
    region.loopDuration.setValue(audioBuffer.duration - s0);
    region.waveformOffset.setValue(s0);
    project.timelineBox.loopArea.to.setValue(gridEndTick(markers));
  });
}

/**
 * Rewrite the tempo track with stepped events (conform = barsToTempoEvents
 * output; rigid = [{tick: 0, bpm: projectBpm}]). One transaction.
 */
export function applyGridTempoEvents(
  ctx: Pick<WarpScenarioContext, "project">,
  events: ReadonlyArray<TempoEvent>
): void {
  const { project } = ctx;
  const adapter = project.timelineBoxAdapter;
  project.editing.modify(() => {
    // ValueEventCollectionBoxAdapter is not exported from @opendaw/studio-adapters.
    adapter.tempoTrackEvents.ifSome((collection: any) => {
      collection.events.asArray().forEach((event: any) => event.box.delete());
      for (const event of events) {
        collection.createEvent({
          position: event.tick as ppqn,
          index: 0,
          value: event.bpm,
          interpolation: Interpolation.None,
        });
      }
    });
  });
}
```

- [ ] **Step 2: Refactor `warp-varispeed-demo.tsx`**

Replace the body of `toggleWarp`'s transaction logic with the shared functions. The
`rawEndPpqn` computation, the `editing.modify` block, and the loop-area write all move
into the apply-functions; the page keeps position reset, refs, and React state:

```typescript
const toggleWarp = useCallback(
  (next: boolean) => {
    if (!setup) return;
    const { project } = setup;
    const ctx: WarpScenarioContext = {
      project,
      region: setup.region,
      audioFileBox: setup.audioFileBox,
      audioBuffer: setup.audioBuffer,
      markers: setup.markers,
      projectBpm: setup.projectBpm,
      prevStretchBox: stretchBoxRef.current,
    };
    stretchBoxRef.current = next
      ? applyVarispeed(ctx, anchorsRef.current)
      : applyRaw(ctx);
    // timeBase+duration+playMode writes reset engine.position to 0 — restore.
    project.engine.setPosition(0);
    pausedPositionRef.current = 0;
    warpedRef.current = next;
    setWarped(next);
    setStatus(
      next
        ? "Ready — warped: beats lock to the click, pitch follows rate"
        : "Ready — warp is OFF, the file will drift off the click"
    );
    setRepaintKey((k) => k + 1);
  },
  [setup, pausedPositionRef]
);
```

Imports: add `applyRaw, applyVarispeed, type WarpScenarioContext` from
`./lib/warpScenarios`; REMOVE now-unused imports (`UUID`, `TimeBase`,
`AudioPitchStretchBox`'s create-usage stays as a TYPE for the ref — keep
`import { AudioPitchStretchBox } from "@opendaw/studio-boxes"` only if still
referenced as a type; `WarpMarkerBox` goes). `noUnusedLocals` is strict — verify with
tsc, not the build.

- [ ] **Step 3: Refactor `warp-timestretch-demo.tsx`**

Same shape: `switchMode`'s transaction becomes:

```typescript
const ctx: WarpScenarioContext = {
  project, region, audioFileBox, audioBuffer,
  markers: setup.markers, projectBpm: setup.projectBpm,
  prevStretchBox: stretchBoxRef.current,
};
stretchBoxRef.current =
  next === "raw"
    ? applyRaw(ctx)
    : next === "varispeed"
      ? applyVarispeed(ctx, anchors)
      : applyTimeStretch(ctx, anchors, transientMode);
```

The `ensureTransientMarkers` await, switching guard, error reconciliation, position
reset, and status texts stay in the page exactly as they are. Remove now-unused
imports (`UUID`, `TimeBase`, `WarpMarkerBox`; keep box types used by `stretchBoxRef`'s
type and the `instanceof` checks in the catch + transient-mode handler).

- [ ] **Step 4: Refactor `warp-grid-follows-file-demo.tsx`**

- Setup-effect placement transaction → `applyGridPlacement(ctx)` (ctx built with
  `prevStretchBox: null`).
- `toggleConform`'s transaction → `applyGridTempoEvents({ project }, next ? tempoEventsRef.current : [{ tick: 0, bpm: projectBpm }])`.
- Remove now-unused imports (`Interpolation`, `type ppqn` if no longer referenced).
- The `endTickRef` computation can now call `gridEndTick(markers)` instead of inlining
  the formula — do it (one source of truth).

- [ ] **Step 5: Verify — type-check, build, behavior spot-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "warp|beats" | grep -v vite-plugin || echo CLEAN
npm run build
```

Then dev server (`npm run dev -- --port 5181 --host 127.0.0.1`) + Playwright: on
warp-varispeed-demo, toggle warp ON → segment readout shows live rate (unchanged
behavior); on warp-grid-follows-file-demo, conform ON → badge 130 events, residual
~0.00 ms. Kill server.

- [ ] **Step 6: Commit**

```bash
git add src/demos/warp/lib/warpScenarios.ts src/demos/warp/warp-varispeed-demo.tsx src/demos/warp/warp-timestretch-demo.tsx src/demos/warp/warp-grid-follows-file-demo.tsx
git commit -m "refactor: extract shared warp scenario builders from demo pages"
```

---

### Task 2: Render wrapper export + verify-sink middleware

**Files:**
- Modify: `src/lib/rangeExport.ts` (add exported wrapper; do NOT change `renderRange`)
- Modify: `vite.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Export a mixdown wrapper in `src/lib/rangeExport.ts`**

Add below `renderRange` (which stays private):

```typescript
/**
 * Render a plain mixdown of the live project for a tick range — no track
 * muting, optional metronome. Used by the audio-verify harness.
 */
export async function renderMixdownRange(options: {
  project: Project;
  startPpqn: ppqn;
  endPpqn: ppqn;
  sampleRate?: number;
  metronomeEnabled?: boolean;
  metronomeGain?: number;
}): Promise<ExportResult> {
  const {
    project, startPpqn, endPpqn,
    sampleRate = 48000, metronomeEnabled = false, metronomeGain = 0,
  } = options;
  const channels = await renderRange(
    project, startPpqn, endPpqn, sampleRate,
    undefined, undefined, undefined,
    metronomeEnabled, metronomeGain
  );
  return {
    label: "Mixdown",
    channels,
    sampleRate,
    durationSeconds: project.tempoMap.intervalToSeconds(startPpqn, endPpqn),
  };
}
```

- [ ] **Step 2: Add the verify-sink middleware to `vite.config.ts`**

Above `defineConfig`:

```typescript
import {mkdirSync, writeFileSync} from "fs"
import type {Plugin} from "vite"

// Dev-only sink for the audio-verify harness: PUT /__verify/<name>.wav writes
// the body to .verify-output/ so the audio-analyzer MCP can read it from disk.
// Never part of the production build (apply: "serve").
const MAX_VERIFY_BYTES = 150 * 1024 * 1024 // full-song float32 WAV ≈ 99 MB
const verifySink = (): Plugin => ({
    name: "verify-sink",
    apply: "serve",
    configureServer(server) {
        server.middlewares.use("/__verify", (req, res) => {
            const name = (req.url ?? "").replace(/^\//, "")
            if (req.method !== "PUT" || !/^[a-z0-9-]+\.wav$/.test(name)) {
                res.statusCode = req.method !== "PUT" ? 405 : 400
                res.end(req.method !== "PUT" ? "PUT only" : "bad name")
                return
            }
            const chunks: Buffer[] = []
            let size = 0
            req.on("data", (chunk: Buffer) => {
                size += chunk.length
                if (size > MAX_VERIFY_BYTES) {
                    res.statusCode = 413
                    res.end("too large")
                    req.destroy()
                    return
                }
                chunks.push(chunk)
            })
            req.on("end", () => {
                if (res.writableEnded) return
                mkdirSync(resolve(__dirname, ".verify-output"), {recursive: true})
                writeFileSync(resolve(__dirname, ".verify-output", name), Buffer.concat(chunks))
                res.statusCode = 200
                res.end("ok")
            })
            req.on("error", () => {
                if (!res.writableEnded) {
                    res.statusCode = 500
                    res.end("read error")
                }
            })
        })
    },
})
```

and add `verifySink()` to the `plugins` array.

- [ ] **Step 3: Gitignore the output dir**

Append to `.gitignore`:

```
.verify-output/
```

- [ ] **Step 4: Verify middleware with curl**

```bash
npm run dev -- --port 5181 --host 127.0.0.1 &   # background
sleep 3
printf 'RIFFTEST' | curl -sk -X PUT --data-binary @- https://localhost:5181/__verify/curl-test.wav
ls -la .verify-output/curl-test.wav
curl -sk -X PUT --data-binary 'x' https://localhost:5181/__verify/../evil.wav -o -; echo
curl -sk -X POST https://localhost:5181/__verify/a.wav -o -; echo
rm .verify-output/curl-test.wav
```

Expected: first PUT → `ok` + file exists with 8 bytes; traversal name → `bad name`
(or 404 from URL normalization); POST → `PUT only`. Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rangeExport.ts vite.config.ts .gitignore
git commit -m "feat: renderMixdownRange export and dev-only verify-sink middleware"
```

---

### Task 3: Expected-times math (TDD) + CLI script

**Files:**
- Create: `src/lib/beats/expectedTimes.test.ts`
- Create: `src/lib/beats/expectedTimes.ts`
- Create: `scripts/expected-beats.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/beats/expectedTimes.test.ts
import { describe, it, expect } from "vitest";
import type { BeatMarker } from "./beatsParser";
import { computeExpectedTimes } from "./expectedTimes";

const Q = 960;

// Otherside head: pickup beatInBar 4 → firstBeatTick 2880, projectBpm from the
// full fixture below is round(averageBpm) — use a fixture engineered to 120 BPM
// so numbers stay readable: beats every 0.5 s.
const MARKERS: BeatMarker[] = [
  { second: 1.0, beatInBar: 4 },  // pickup
  { second: 1.5, beatInBar: 1 },
  { second: 2.0, beatInBar: 2 },
  { second: 2.5, beatInBar: 3 },
  { second: 3.0, beatInBar: 4 },
  { second: 3.5, beatInBar: 1 },
];
// averageBpm = 5 * 60 / 2.5 = 120 exactly; firstBeatTick = 2880 (p = 1).

describe("computeExpectedTimes", () => {
  const t = computeExpectedTimes(MARKERS, Q, 4.0);

  it("gridTimes: marker n at (firstBeatTick + n*Q) ticks at the rigid tempo", () => {
    // tick 2880 at 120 BPM = 3 beats * 0.5 s = 1.5 s
    expect(t.gridTimes[0]).toBeCloseTo(1.5, 9);
    expect(t.gridTimes[1]).toBeCloseTo(2.0, 9);
    expect(t.gridTimes).toHaveLength(MARKERS.length);
  });

  it("fileTimes: raw playback = marker seconds verbatim", () => {
    expect(t.fileTimes).toEqual([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
  });

  it("fileTimesRigid: region at firstBeatTick under the flat map, file shifted by s0", () => {
    // region start second = 1.5; marker 0 (s0) sounds there; others offset by (s - s0)
    expect(t.fileTimesRigid[0]).toBeCloseTo(1.5, 9);
    expect(t.fileTimesRigid[5]).toBeCloseTo(1.5 + 2.5, 9);
  });

  it("rigidClickTimes: every beat tick to the grid end at the flat tempo", () => {
    expect(t.rigidClickTimes[0]).toBeCloseTo(0, 9);
    expect(t.rigidClickTimes[1]).toBeCloseTo(0.5, 9);
    // gridEndTick = 2880 + 5*960 + 3840 = 11520 ticks = 12 beats → 13 click times (0..12 inclusive? exclusive end)
    expect(t.rigidClickTimes[t.rigidClickTimes.length - 1]).toBeLessThanOrEqual(12 * 0.5);
  });

  it("projectBpm is rounded averageBpm", () => {
    expect(t.projectBpm).toBe(120);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/beats/expectedTimes.test.ts
```

Expected: FAIL — cannot resolve `./expectedTimes`.

- [ ] **Step 3: Implement**

```typescript
// src/lib/beats/expectedTimes.ts
import type { BeatMarker } from "./beatsParser";
import { averageBpm, gridAnchorTicks, clipStartSeconds } from "./beatMapConversions";

/** Per-scenario expected onset times (render-relative seconds, render from tick 0). */
export interface ExpectedTimes {
  readonly projectBpm: number;
  /** Locked scenarios (varispeed/timestretch): marker n at firstBeatTick + n*quarter ticks. */
  readonly gridTimes: ReadonlyArray<number>;
  /** raw (region at 0, file from 0) AND grid-conform (map anchors render time = file time). */
  readonly fileTimes: ReadonlyArray<number>;
  /** grid-rigid music: region at firstBeatTick under the FLAT map, file shifted by s0. */
  readonly fileTimesRigid: ReadonlyArray<number>;
  /** grid-rigid metronome clicks: every beat tick to the grid end at the flat tempo. */
  readonly rigidClickTimes: ReadonlyArray<number>;
}

export function computeExpectedTimes(
  markers: ReadonlyArray<BeatMarker>,
  quarterPpqn: number,
  fileDurationSeconds: number,
  beatsPerBar: number = 4
): ExpectedTimes {
  const projectBpm = Math.round(averageBpm(markers));
  const { firstBeatTick } = gridAnchorTicks(markers, quarterPpqn, beatsPerBar);
  const s0 = clipStartSeconds(markers);
  const secondsPerTick = 60 / projectBpm / quarterPpqn;

  const gridTimes = markers.map((_, n) => (firstBeatTick + n * quarterPpqn) * secondsPerTick);
  const fileTimes = markers.map((m) => m.second);
  const regionStartRigid = firstBeatTick * secondsPerTick;
  const fileTimesRigid = markers.map((m) => regionStartRigid + (m.second - s0));

  const ticksPerBar = beatsPerBar * quarterPpqn;
  const gridEnd = firstBeatTick + (markers.length - 1) * quarterPpqn + ticksPerBar;
  const rigidClickTimes: number[] = [];
  for (let tick = 0; tick <= gridEnd; tick += quarterPpqn) {
    rigidClickTimes.push(tick * secondsPerTick);
  }
  // fileDurationSeconds bounds nothing here (renders end at the grid end tick),
  // but keep the parameter: callers state the file they computed against.
  void fileDurationSeconds;
  return { projectBpm, gridTimes, fileTimes, fileTimesRigid, rigidClickTimes };
}
```

NOTE: if `void fileDurationSeconds;` looks awkward, drop the parameter entirely and
update the test — implementer's choice; do NOT leave an unused param (noUnusedParameters
may flag it).

- [ ] **Step 4: Run tests, verify all pass**

```bash
npx vitest run src/lib/beats/
```

Expected: all green (existing 27 + 5 new).

- [ ] **Step 5: CLI script**

```typescript
// scripts/expected-beats.ts
// Print per-scenario expected onset times for the audio-verify skill.
// Run from the repo root: node scripts/expected-beats.ts  (Node >= 23, type stripping)
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseBeatsFile } from "../src/lib/beats/beatsParser.ts";
import { computeExpectedTimes } from "../src/lib/beats/expectedTimes.ts";

const QUARTER = 960; // PPQN.Quarter — hardcoded; this script must stay SDK-free
const OTHERSIDE_DURATION_SECONDS = 257.712;

const beatsPath = resolve(import.meta.dirname, "../public/audio/Otherside.beats");
const markers = parseBeatsFile(readFileSync(beatsPath, "utf-8"));
const expected = computeExpectedTimes(markers, QUARTER, OTHERSIDE_DURATION_SECONDS);
process.stdout.write(JSON.stringify(expected, null, 2) + "\n");
```

NOTE: Node type-stripping requires explicit `.ts` extensions in relative imports
(shown above). If `import.meta.dirname` is unavailable in the installed Node, use
`new URL("../public/audio/Otherside.beats", import.meta.url)`.

- [ ] **Step 6: Run the script, sanity-check output**

```bash
node scripts/expected-beats.ts | head -20
node scripts/expected-beats.ts | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['projectBpm'], d['gridTimes'][0], d['fileTimes'][0], d['fileTimesRigid'][0])"
```

Expected: `123 1.4634… 1.26 1.4634…` (gridTimes[0] = 2880/960 · 60/123; fileTimes[0] = 1.26).

- [ ] **Step 7: Commit**

```bash
git add src/lib/beats/expectedTimes.ts src/lib/beats/expectedTimes.test.ts scripts/expected-beats.ts
git commit -m "feat: expected onset times per warp scenario + CLI script"
```

---

### Task 4: Verify harness page

**Files:**
- Create: `src/demos/warp/audio-verify-debug.tsx`
- Create: `audio-verify-debug.html`
- Modify: `vite.config.ts` (input)

- [ ] **Step 1: Create the harness page**

Plain DOM-ish React (no Radix needed beyond nothing — keep it dependency-light), all
state surfaced through `data-verify-state`:

```tsx
// src/demos/warp/audio-verify-debug.tsx
// Unlisted offline-render harness for the audio-verify skill. Renders one warp
// scenario (?scenario=raw|varispeed|timestretch|grid-conform|grid-rigid) to a
// full-song WAV and PUTs it to the dev server's /__verify sink.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, WavFile } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  buildWarpAnchors,
  barsToTempoEvents,
} from "@/lib/beats/beatMapConversions";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import { renderMixdownRange, channelsToAudioBuffer } from "@/lib/rangeExport";
import { setupWarpDemo } from "./lib/setupWarpDemo";
import {
  applyRaw,
  applyVarispeed,
  applyTimeStretch,
  applyGridPlacement,
  applyGridTempoEvents,
  rawEndPpqn,
  gridEndTick,
  type WarpScenarioContext,
} from "./lib/warpScenarios";

const QUARTER = PPQN.Quarter;
const SCENARIOS = ["raw", "varispeed", "timestretch", "grid-conform", "grid-rigid"] as const;
type Scenario = (typeof SCENARIOS)[number];

function isScenario(value: string | null): value is Scenario {
  return SCENARIOS.includes(value as Scenario);
}

async function runScenario(
  scenario: Scenario,
  setState: (state: string, detail?: string) => void
): Promise<void> {
  setState("setup");
  const localAudioBuffers = new Map<string, AudioBuffer>();
  const setup = await setupWarpDemo({
    localAudioBuffers,
    onStatusUpdate: (s) => setState("setup", s),
  });
  const { project, audioBuffer, markers, projectBpm } = setup;
  const ctx: WarpScenarioContext = {
    project,
    region: setup.region,
    audioFileBox: setup.audioFileBox,
    audioBuffer,
    markers,
    projectBpm,
    prevStretchBox: null,
  };
  const anchors = buildWarpAnchors(markers, audioBuffer.duration, QUARTER);

  let endPpqn: number;
  let metronome = false;
  switch (scenario) {
    case "raw":
      applyRaw(ctx);
      endPpqn = rawEndPpqn(ctx);
      break;
    case "varispeed":
      applyVarispeed(ctx, anchors);
      endPpqn = anchors[anchors.length - 1].tick;
      break;
    case "timestretch":
      setState("setup", "Detecting transients...");
      await ensureTransientMarkers(project, setup.audioFileBox, audioBuffer);
      applyTimeStretch(ctx, anchors, TransientPlayMode.Pingpong);
      endPpqn = anchors[anchors.length - 1].tick;
      break;
    case "grid-conform":
    case "grid-rigid": {
      applyGridPlacement(ctx);
      const events =
        scenario === "grid-conform"
          ? barsToTempoEvents(markers, QUARTER)
          : [{ tick: 0, bpm: projectBpm }];
      applyGridTempoEvents({ project }, events);
      endPpqn = gridEndTick(markers);
      // The audio is identical in both grid scenarios by design — the grid is
      // only audible via the metronome, so the clicks must be in the render.
      metronome = true;
      break;
    }
  }

  setState("rendering", `0..${endPpqn} ticks, metronome ${metronome ? "on" : "off"}`);
  const result = await renderMixdownRange({
    project,
    startPpqn: 0 as ppqn,
    endPpqn: endPpqn as ppqn,
    metronomeEnabled: metronome,
    metronomeGain: 0,
  });

  setState("uploading");
  const wav = WavFile.encodeFloats(channelsToAudioBuffer(result.channels, result.sampleRate));
  const response = await fetch(`/__verify/verify-${scenario}.wav`, {
    method: "PUT",
    body: wav,
  });
  if (!response.ok) {
    throw new Error(`verify sink rejected upload: HTTP ${response.status}`);
  }
  setState("done", `verify-${scenario}.wav (${(wav.byteLength / 1e6).toFixed(1)} MB)`);
}

function AudioVerifyHarness() {
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const scenario = new URLSearchParams(window.location.search).get("scenario");
    const update = (s: string, d?: string) => {
      setState(s);
      if (d !== undefined) setDetail(d);
    };
    if (!isScenario(scenario)) {
      update(`error:unknown scenario "${scenario}" — use ?scenario=${SCENARIOS.join("|")}`);
      return;
    }
    runScenario(scenario, update).catch((err) => {
      update(`error:${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);

  return (
    <main style={{ fontFamily: "monospace", padding: 24, color: "#ddd", background: "#111", minHeight: "100vh" }}>
      <h1>audio-verify harness</h1>
      <p>
        state: <span id="verify-state" data-verify-state={state}>{state}</span>
      </p>
      <p>{detail}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AudioVerifyHarness />);
```

ONE caveat to check while implementing: `renderMixdownRange` renders the LIVE
project via `project.copy()` inside `renderRange` — the harness page never starts
live playback, so there is no liveStreamReceiver conflict. If `project.copy()`
throws because engine prefs/loop state, surface it via the error path (it already
will — runScenario catches everything).

- [ ] **Step 2: HTML entry + vite input**

`audio-verify-debug.html` — copy any debug entry (e.g. `comp-lanes-debug-demo.html`)
as the template: MUST have `<meta name="robots" content="noindex" />`, minimal
title (`audio-verify harness (unlisted)`), NO og tags needed, NO GoatCounter
(it's a test harness), script src `/src/demos/warp/audio-verify-debug.tsx`.

`vite.config.ts` input (debug section):

```typescript
audioVerifyDebug: resolve(__dirname, "audio-verify-debug.html"),
```

- [ ] **Step 3: End-to-end smoke test (one scenario)**

Dev server on 5181, Playwright: navigate
`https://localhost:5181/audio-verify-debug.html?scenario=raw`, poll the
`#verify-state` element's `data-verify-state` until `done` (full-song offline render
— allow up to ~3 min; poll every 10 s; `error:*` → report and stop). Then:

```bash
ls -la .verify-output/verify-raw.wav
```

and confirm the audio-analyzer MCP can read it (the implementer does NOT have the
MCP — instead verify the WAV header: `file .verify-output/verify-raw.wav` reports
WAV audio; `python3 -c "import wave"` won't read float32 WAV, so `file` + size
(~99 MB) is the check). Kill the server. Leave the WAV on disk (gitignored) for the
controller's analyzer run.

- [ ] **Step 4: Commit**

```bash
git add src/demos/warp/audio-verify-debug.tsx audio-verify-debug.html vite.config.ts
git commit -m "feat: unlisted audio-verify render harness"
```

---

### Task 5: The skill — `.claude/skills/audio-verify/SKILL.md`

**Files:**
- Create: `.claude/skills/audio-verify/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
---
name: audio-verify
description: Verify warp/audio-engine behavior by offline-rendering the warp demo scenarios to WAVs and asserting beat alignment numerically with the audio-analyzer MCP. Use after changes to src/lib/beats/, src/demos/warp/, stretch-engine or tempo-track behavior, or when asked to verify audio output without listening.
---

# audio-verify

Renders the five warp scenarios full-song through the OpenDAW offline engine and
asserts beat alignment against expected times computed from the beat map. Replaces
"needs human ears" with numbers. Requires: the dev server (HTTPS certs present),
Playwright MCP, audio-analyzer MCP.

## Workflow

1. **Start the dev server** from the branch/worktree under test:
   `npm run dev -- --port 5181 --host 127.0.0.1`
2. **Render each scenario** (sequentially — each is a full-song offline render,
   allow up to ~3 minutes): navigate Playwright to
   `https://localhost:5181/audio-verify-debug.html?scenario=<s>` for
   `raw`, `varispeed`, `timestretch`, `grid-conform`, `grid-rigid`.
   Poll the `#verify-state` element's `data-verify-state` attribute every ~15 s:
   `setup → rendering → uploading → done`. On `error:<msg>`: stop, report the
   message. WAVs land at `.verify-output/verify-<scenario>.wav`.
3. **Expected times**: `node scripts/expected-beats.ts` → JSON with `projectBpm`,
   `gridTimes`, `fileTimes`, `fileTimesRigid`, `rigidClickTimes` (render-relative
   seconds).
4. **Analyze** each WAV with audio-analyzer `rhythm_analysis`: one full-track
   summary call (no resolution), then three high-resolution windows at
   [10, 30] s, [120, 140] s, [220, 240] s. Collect detected beat lists per window.
5. **Compare** per window: for each detected beat, distance to the nearest
   expected time; take the median per window.

## Assertions

| Scenario | Expected list | Pass criteria |
| --- | --- | --- |
| raw (negative control) | gridTimes | median < 100 ms in intro window AND > 300 ms in outro window — drift must GROW. If raw doesn't drift, the harness is broken: STOP. |
| varispeed | gridTimes | median ≤ 35 ms per window, no window > 60 ms |
| timestretch | gridTimes | median ≤ 35 ms per window, no window > 60 ms |
| grid-conform | fileTimes | median ≤ 35 ms per window (music + clicks coincide) |
| grid-rigid (negative control) | fileTimesRigid ∪ rigidClickTimes | the two lists themselves diverge > 300 ms by the outro; detected onsets match the UNION better than either list alone |

Pitch (informational until baseline numbers exist — then promote to hard
assertions and update this table): `harmonic_analysis` pitch-class distribution on
the [120, 140] s window — `timestretch` must correlate with `raw`; `varispeed`
must deviate.

Report a pass/fail table with the medians. Stop at the first failed scenario with
the numbers collected so far.

## Troubleshooting

- **Page won't load / cert errors**: dev server must be HTTPS (COOP/COEP);
  `localhost-key.pem`/`localhost.pem` must exist in the directory the server runs
  from. Check the port matches the URL.
- **`error:verify sink rejected upload`**: the middleware only exists in dev mode
  (`apply: "serve"`); a preview/production server has no `/__verify`. HTTP 413 =
  render exceeded the 150 MB cap.
- **`error:Transient detection returned no positions`**: timestretch needs
  transients; the audio file is silent/featureless — wrong file or broken load.
- **State stuck at `rendering`**: check the browser console via Playwright;
  offline render of the full song takes ~1–3 min (it is faster than realtime but
  not instant). If > 5 min, capture console messages and report.
- **Onset medians look huge for ALL scenarios including controls inverted**:
  check render-relative alignment — renders start at tick 0; expected lists are
  render-relative by construction. Re-run `node scripts/expected-beats.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/audio-verify/SKILL.md
git commit -m "feat: audio-verify project skill"
```

---

### Task 6: Warp overview page ("Who Bends?")

**Files:**
- Create: `src/demos/warp/warp-overview.tsx`, `warp-demos.html`
- Modify: `vite.config.ts`, `src/index.tsx`, `public/sitemap.xml`,
  the three `warp-*-demo.tsx` explanation cards
- Create: `public/og-image-warp-overview.png`

- [ ] **Step 1: Create the overview page**

`src/demos/warp/warp-overview.tsx` — static Radix page, same shell as the demos
(Theme dark/iris, Container, GitHubCorner, BackLink, MoisesLogo inside Container).
Content per the spec, structured as:

1. Heading `Beat Maps & Warping: Who Bends?` + intro Text (beat tracker / sidecar
   metadata yields `{second, beat}` pins; once a beat map exists, file and grid must
   be reconciled; every DAW surfaces exactly three answers: bend the sound, bend the
   grid, or slice).
2. A Radix `Table.Root` — rows: Varispeed / Grid follows file / Time-stretch;
   columns: What happens · What you hear · DAWs call it · Demo (Link).
   - Varispeed: file → grid · beats lock, pitch shifts with tempo · Ableton *Re-Pitch* · `/warp-varispeed-demo.html`
   - Grid follows file: grid → file · audio untouched, metronome & ruler bend · Ableton *Set tempo from clip*, Logic Smart Tempo *ADAPT* · `/warp-grid-follows-file-demo.html`
   - Time-stretch: file → grid, sliced · beats lock, key survives · Ableton *Beats/Complex*, Logic *Flex Time* · `/warp-timestretch-demo.html`
3. Three `Card` blocks, each: Heading (scenario), "Who wants this" paragraph (use the
   spec's audience text verbatim: DJs/tape-aesthetic remixes + artifact-free conform;
   performances recorded without a click — live drummer, archival multitrack, field
   recording — MIDI/quantize/metronome follow the player; acapellas over new beats +
   sample-pack loops at project tempo, the modern DAW default), and a Link to the demo.
4. A final Card: engine-agnostic anchors callout (identical warp-marker list drives
   both stretch engines — why Ableton lets you switch a clip's warp mode without
   touching its markers), linking `/warp-timestretch-demo.html`.

No audio, no engine imports, no hooks beyond none — this is a static page; do NOT
import setupWarpDemo or OpenDAW packages.

- [ ] **Step 2: HTML entry + vite input**

`warp-demos.html` from the `warp-varispeed-demo.html` template: title
`OpenDAW Warp Demos — Who Bends: the File or the Grid?`; description
`Three ways a DAW reconciles a song's beat map with the project grid — varispeed, set-tempo-from-clip, and time-stretch — with working OpenDAW SDK demos of each and the commercial DAW features they correspond to.`;
canonical/og/twitter URLs → `warp-demos.html`; og-image →
`og-image-warp-overview.png`; script src `/src/demos/warp/warp-overview.tsx`;
GoatCounter kept. Vite input (public section): `warpOverview: resolve(__dirname, "warp-demos.html"),`

- [ ] **Step 3: Index card swap**

In `src/index.tsx`, REPLACE the three warp cards (Warp: Varispeed 📌, Warp: Set
Tempo from Clip 📐, Warp: Time-Stretch 🧩) with ONE card:

```tsx
<Card asChild>
  <Link href="/warp-demos.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
    <Flex direction="column" gap="3">
      <Flex direction="column" align="center" gap="2">
        <Text size="8">🗺️</Text>
        <Heading size="5">Warp: Who Bends?</Heading>
      </Flex>
      <Text size="2" color="gray">
        Three ways to reconcile a song&apos;s beat map with the project grid —
        varispeed, set-tempo-from-clip, and time-stretch — with the DAW features
        they correspond to and a working demo of each.
      </Text>
    </Flex>
  </Link>
</Card>
```

- [ ] **Step 4: Sitemap + demo cross-links**

`public/sitemap.xml`: add `warp-demos.html` (keep the three demo URLs).
In each demo page's explanation card, add a sentence linking the overview, e.g.
`… See the <Link href="/warp-demos.html">warp overview</Link> for who uses which approach.`
(exact phrasing may flex; one link per page, inside the existing explanation Card).

- [ ] **Step 5: og-image + verify**

```bash
npx tsc --noEmit 2>&1 | grep -E "warp|index" | grep -v vite-plugin || echo CLEAN
npm run build
```

Dev server + Playwright: load `/warp-demos.html` at 1200x630, screenshot →
`public/og-image-warp-overview.png` (downscale with `sips -z 630 1200` if retina);
click through all four links (three demos + a demo's overview backlink) — all
resolve; index shows exactly ONE warp card. Kill server.

- [ ] **Step 6: Commit**

```bash
git add src/demos/warp/warp-overview.tsx warp-demos.html vite.config.ts src/index.tsx public/sitemap.xml public/og-image-warp-overview.png src/demos/warp/warp-varispeed-demo.tsx src/demos/warp/warp-grid-follows-file-demo.tsx src/demos/warp/warp-timestretch-demo.tsx
git commit -m "feat: warp overview page — who bends, DAW context, single index card"
```

---

### Task 7: Run the skill end-to-end (controller task — NOT a subagent)

The controller (with audio-analyzer MCP access) executes `.claude/skills/audio-verify/SKILL.md`
verbatim against this branch:

- [ ] **Step 1:** All five scenarios render; five WAVs in `.verify-output/`.
- [ ] **Step 2:** All five assertions pass (raw + grid-rigid as negative controls).
- [ ] **Step 3:** Falsifiability check: evaluate the `raw` WAV against the
  varispeed assertion (gridTimes, ≤ 35 ms) — it MUST fail.
- [ ] **Step 4:** Record the pitch-correlation numbers from `harmonic_analysis`;
  if they cleanly separate timestretch (≈ raw) from varispeed (≠ raw), promote the
  pitch check to a hard assertion in SKILL.md with measured thresholds.
- [ ] **Step 5:** Fold measured timings (render minutes per scenario, actual onset
  medians) into SKILL.md's troubleshooting/expectations and, if any SDK behavior was
  learned, into `src/demos/warp/CLAUDE.md` (directive style).
- [ ] **Step 6:** Commit doc updates:

```bash
git add .claude/skills/audio-verify/SKILL.md src/demos/warp/CLAUDE.md
git commit -m "docs: audio-verify thresholds from first end-to-end run"
```

- [ ] **Step 7:** Push the branch (PR #67 updates) and comment on the PR with the
  verification table.

---

## Done criteria

- `npm test` green (27 + 5 expectedTimes tests), `npm ci` + `npm run build` green.
- Demos behave identically after the Task 1 refactor (browser spot-check).
- `/warp-demos.html` live, index has exactly one warp card, all links resolve.
- Five WAVs rendered; all five SKILL.md assertions pass; falsifiability check fails
  as designed; SKILL.md carries measured numbers.
- PR #67 updated with the new commits and a verification-table comment.
