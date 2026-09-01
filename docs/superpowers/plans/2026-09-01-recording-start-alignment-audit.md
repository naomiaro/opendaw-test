# Recording Start-Alignment Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live-recording audit harness that measures where recorded content lands on the timeline versus where a perfectly-on-the-beat performer would put it, against `@opendaw/studio-sdk@0.0.170`, plus a fix-verification mode against a locally built candidate SDK.

**Architecture:** A getUserMedia injection layer feeds the SDK's capture path a digital loopback (engine metronome, low band) mixed with context-clock reference clicks on a unique-gap schedule (high band, identity-recoverable). A pure measurement library band-splits the finalized take, detects onsets, maps them through region `position` + `waveformOffset` to timeline time, and classifies each cell `aligned` / `matches-known-defect` / `investigate`. An unlisted debug-demo page runs the scenario × rate × bpm matrix live and exports JSON/WAV evidence to `.verify-output/`.

**Tech Stack:** React + Radix (existing demo shell), OpenDAW SDK 0.0.170, vitest for the pure library, vite dev-server `/__verify` sink, claude-in-chrome/Playwright for campaign runs.

**Spec:** `docs/superpowers/specs/2026-09-01-recording-start-alignment-audit-design.md`

**Spec deviations (both strengthen the spec; spec amended alongside this plan):**
1. Ground truth uses a unique-gap reference-click schedule (gap between click *i* and *i+1* = base + *i*·increment) so any two consecutive recovered clicks identify their schedule indices and recover the capture buffer's context-time anchor `T0` — replacing the spec §3.4(4) main-thread context↔transport fit and its §5 uncertainty risk.
2. `src/demos/recording/CLAUDE.md` records a prior FAILED synthetic-input attempt (cross-AudioContext `MediaStreamAudioDestinationNode` reads silent). Task 1 is a hard feasibility gate for the same-context topology; its failure aborts the harness route and forces a fallback decision (documented in Task 1).

## Global Constraints

- **No origin naming:** committed text and upstream postings never name the candidate build's origin ("a candidate-fix build was verified locally" is the ceiling). No vendor, product, or repository names that identify where the candidate build comes from — anywhere, including commit messages and PR text. When in doubt, grep the diff for origin identifiers before committing (the identifiers themselves are listed in `.claude/local.md`, which is not committed).
- **Unlisted debug demo:** `<meta name="robots" content="noindex, nofollow">`, NOT added to `src/index.tsx`, `public/sitemap.xml`, README, or og-images. Vite `rollupOptions.input` entry IS required.
- **tsc-clean:** `npx tsc --noEmit 2>&1 | grep '^src/'` must print nothing before every commit.
- **TDD** for all pure-library code (`src/lib/audit/*`). Browser-only wiring (injection, page) is browser-verified, not unit-tested — same convention as `auditBuilders.ts`.
- **Option types:** never `?.`/`??` on `Option<T>`; `.isEmpty()`/`.unwrap()`. `PPQN` positions are Int32 — `Math.round()` anything derived from seconds.
- **Console logging:** log strings, never objects.
- **Live-audio pages:** first transport start needs a REAL trusted click; keep the Chrome window visible (occluded windows freeze main-thread sync); reuse the running dev server (kill by PID via `lsof -ti :<port>`, don't spawn duplicates).
- **`/__verify` sink names:** must match `/^[a-z0-9-]+\.(wav|json)$/` — use `bpmToken` style (`97.3` → `97p3`), no dots/underscores.
- **Commits:** one per task minimum, conventional-commit style, on a feature branch `recording-alignment-audit` (create in Task 1).

---

### Task 1: Loopback injection module + feasibility probe (HARD GATE)

The prior in-repo attempt at synthetic capture failed **cross-context** (see `src/demos/recording/CLAUDE.md` "Don't Synthesize Input to Verify Recording"). This task tests the same-context topology: the `MediaStreamAudioDestinationNode` lives in the SAME `AudioContext` the SDK captures into.

**Files:**
- Create: `src/lib/audit/loopbackInjection.ts`
- Create: `src/demos/recording/recording-alignment-audit-debug-demo.tsx` (probe mode only)
- Create: `recording-alignment-audit-debug-demo.html`
- Modify: `vite.config.ts` (add rollup input entry)
- Modify: `src/lib/projectSetup.ts` (optional `engineTap` callback)

**Interfaces:**
- Consumes: `initializeOpenDAW(options: ProjectSetupOptions)` from `src/lib/projectSetup.ts`; `useRecordingTapes`-style arming sequence (inlined, not the hook — the harness has no React device-permission flow).
- Produces: `installLoopbackCapture(): LoopbackHandle`, `ProjectSetupOptions.engineTap?: (engineNode: AudioNode) => void`. Later tasks rely on these exact names.

- [ ] **Step 1: Branch**

```bash
git checkout -b recording-alignment-audit
```

- [ ] **Step 2: Write `src/lib/audit/loopbackInjection.ts`**

```ts
/**
 * Digital-loopback capture injection for the recording start-alignment audit.
 *
 * Patches navigator.mediaDevices.getUserMedia/enumerateDevices BEFORE SDK init
 * so CaptureAudio's capture stream is a MediaStreamAudioDestinationNode in the
 * SAME AudioContext the engine runs in (the cross-context variant is known to
 * read silent — see src/demos/recording/CLAUDE.md). Two inputs feed the node:
 *  - engine output through a lowpass (the metronome "performer", low band)
 *  - scheduled reference clicks (REF_CLICK_HZ tone bursts, high band)
 * getUserMedia hands out stream CLONES so a consumer's track.stop() (tape
 * disarm/remove) cannot kill the source stream.
 */
export const LOOPBACK_DEVICE_ID = "loopback-injection";
export const LOW_BAND_CUTOFF_HZ = 1500;
export const REF_CLICK_HZ = 6000;
export const REF_CLICK_DURATION_SEC = 0.008;
export const REF_CLICK_GAIN = 0.5;

export interface LoopbackHandle {
  /** Call once, right after initializeOpenDAW, with the SDK's AudioContext. */
  attach(audioContext: AudioContext): void;
  /** Pass as ProjectSetupOptions.engineTap — routes engine output into the low band. */
  engineTap(engineNode: AudioNode): void;
  /** Schedule one tone burst per schedule time (absolute context seconds). */
  scheduleReferenceClicks(times: number[]): void;
  uninstall(): void;
}

export function installLoopbackCapture(): LoopbackHandle {
  const original = {
    getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    enumerateDevices: navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices),
  };
  let context: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let pendingEngineNode: AudioNode | null = null;

  navigator.mediaDevices.getUserMedia = async (_constraints?: MediaStreamConstraints) => {
    if (dest === null) throw new Error("loopbackInjection: getUserMedia before attach()");
    return dest.stream.clone();
  };
  navigator.mediaDevices.enumerateDevices = async () => {
    const real = await original.enumerateDevices();
    const synthetic = {
      deviceId: LOOPBACK_DEVICE_ID, groupId: LOOPBACK_DEVICE_ID,
      kind: "audioinput" as MediaDeviceKind, label: "Loopback Injection",
      toJSON() { return this; },
    } as MediaDeviceInfo;
    return [synthetic, ...real];
  };

  const connectEngine = (node: AudioNode) => {
    if (context === null || dest === null || lowpass === null) { pendingEngineNode = node; return; }
    // Output 0 only — output 1 is monitoring (SDK 0.0.133+ dual-output rule).
    node.connect(lowpass, 0);
  };

  return {
    attach(audioContext: AudioContext) {
      context = audioContext;
      dest = audioContext.createMediaStreamDestination();
      lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = LOW_BAND_CUTOFF_HZ;
      lowpass.connect(dest);
      if (pendingEngineNode !== null) { connectEngine(pendingEngineNode); pendingEngineNode = null; }
    },
    engineTap(engineNode: AudioNode) { connectEngine(engineNode); },
    scheduleReferenceClicks(times: number[]) {
      if (context === null || dest === null) throw new Error("loopbackInjection: schedule before attach()");
      for (const t of times) {
        const osc = context.createOscillator();
        osc.frequency.value = REF_CLICK_HZ;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(REF_CLICK_GAIN, t + 0.001);
        gain.gain.setValueAtTime(REF_CLICK_GAIN, t + REF_CLICK_DURATION_SEC - 0.002);
        gain.gain.linearRampToValueAtTime(0, t + REF_CLICK_DURATION_SEC);
        osc.connect(gain).connect(dest);
        osc.start(t);
        osc.stop(t + REF_CLICK_DURATION_SEC + 0.005);
      }
    },
    uninstall() {
      navigator.mediaDevices.getUserMedia = original.getUserMedia;
      navigator.mediaDevices.enumerateDevices = original.enumerateDevices;
    },
  };
}
```

- [ ] **Step 3: Add `engineTap` to `src/lib/projectSetup.ts`**

Add to `ProjectSetupOptions` (after `audioContextSampleRate`):

```ts
  /** Called with the engine worklet node right after it connects to the destination (audit taps). */
  engineTap?: (engineNode: AudioNode) => void;
```

In `initializeOpenDAW`, immediately after the line that connects the engine worklet to `audioContext.destination` (output 0), add:

```ts
  options.engineTap?.(engineWorklet);
```

(The worklet variable name at that site may differ — use whatever `project.startAudioWorklet()`'s result is bound to there. Do not move the connect itself.)

- [ ] **Step 4: Create the HTML entry `recording-alignment-audit-debug-demo.html`**

Copy `samplerate-audit-debug-demo.html`, replace title/description with "Recording Start-Alignment Audit", keep `<meta name="robots" content="noindex, nofollow">`, point the module script at `/src/demos/recording/recording-alignment-audit-debug-demo.tsx`. No GoatCounter, no og-image (unlisted).

- [ ] **Step 5: Add the vite input entry**

In `vite.config.ts` `rollupOptions.input`, after the `samplerateAudit` line:

```ts
        recordingAlignmentAudit: resolve(__dirname, "recording-alignment-audit-debug-demo.html"),
```

- [ ] **Step 6: Write the probe-mode page**

`src/demos/recording/recording-alignment-audit-debug-demo.tsx`. Structure mirrors `samplerate-audit-debug-demo.tsx` (Radix Theme, status badge `<Badge id="audit-state" data-audit-state={auditState}>`, results table) but this task implements only `?scenario=probe`:

```tsx
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { Option } from "@opendaw/lib-std";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID } from "@/lib/audit/loopbackInjection";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
// Copy the exact import sources for InstrumentFactories / CaptureAudio from
// src/hooks/useRecordingTapes.ts — verify against the installed d.ts, don't guess.

const params = new URLSearchParams(window.location.search);
const rate = Number(params.get("rate") ?? "48000");

// Installed at module scope, BEFORE any SDK code can touch mediaDevices.
const loopback = installLoopbackCapture();

type ProbeRow = { label: string; value: string };

async function runProbe(onRow: (row: ProbeRow) => void): Promise<string> {
  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  loopback.attach(audioContext);
  onRow({ label: "context rate", value: String(audioContext.sampleRate) });

  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;

  // Tape + capture (three transactions — createInstrument, then capture fields; armed is not a box field)
  let audioUnitBox: any = null;
  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
  if (!(capture instanceof CaptureAudio)) throw new Error("probe: capture is not CaptureAudio");
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);

  // Schedule reference clicks covering the whole probe window.
  const now = audioContext.currentTime;
  loopback.scheduleReferenceClicks(Array.from({ length: 30 }, (_, i) => now + 0.5 + i * 0.25));

  project.engine.setPosition(0);
  project.startRecording(false);
  await new Promise((r) => setTimeout(r, 4000));
  project.engine.stopRecording();

  // Find the take region and wait for its loader.
  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters()
    .find((u: any) => u.box === capture.audioUnitBox);
  if (!unitAdapter) throw new Error("probe: no audio unit adapter");
  const regions = unitAdapter.tracks.values()
    .flatMap((t: any) => [...t.regions.adapters.values()])
    .filter((r: any) => r.isAudioRegion());
  onRow({ label: "regions", value: String(regions.length) });
  if (regions.length === 0) return "FAIL: no take region created";

  const loader = regions[0].file.getOrCreateLoader();
  if (loader.state.type !== "loaded") {
    await withDeadline(new Promise<void>((resolvePromise, reject) => {
      let subscribed = false;
      const sub = loader.subscribe((state: any) => {
        if (state.type === "loaded") { resolvePromise(); if (subscribed) sub.terminate(); }
        if (state.type === "error") { reject(new Error(String(state.reason))); if (subscribed) sub.terminate(); }
      });
      subscribed = true;
    }), 30_000, "probe finalization");
  }
  const dataOpt = loader.data;
  if (dataOpt.isEmpty()) return "FAIL: loader loaded but data empty";
  const data = dataOpt.unwrap();
  const ch0 = data.frames[0];
  let sumSq = 0;
  for (let i = 0; i < ch0.length; i++) sumSq += ch0[i] * ch0[i];
  const rms = Math.sqrt(sumSq / ch0.length);
  onRow({ label: "frames", value: String(data.numberOfFrames) });
  onRow({ label: "rms", value: rms.toFixed(6) });
  project.engine.stop(true);
  // GATE: cross-context failure mode reads as silence. Same-context must not.
  return rms > 0.005 ? "PASS" : `FAIL: silent capture (rms=${rms.toFixed(6)})`;
}
```

Page shell: a "Run probe" `<Button>` (real click resumes the AudioContext), `auditState` walking `setup → running:probe → done | error:<message>`, rows rendered in a `Table.Root size="1"`, verdict in a green/red `Badge` with `id="probe-verdict"` and `data-verdict={verdict}`. Wrap `runProbe` in try/catch → `error:<message>` state. Log progress as strings via `console.log`.

- [ ] **Step 7: tsc gate + run the probe**

```bash
npx tsc --noEmit 2>&1 | grep '^src/' || echo CLEAN
```
Expected: `CLEAN`. Then on the running dev server, open
`https://localhost:5173/recording-alignment-audit-debug-demo.html?scenario=probe&rate=48000`
in visible Chrome, click "Run probe" with a REAL click (claude-in-chrome coordinate click), read `#probe-verdict`.

**Expected: PASS (rms > 0.005) with ≥1 region, plausible frame count (~4 s + count-in at 48 kHz ≈ 290k+ frames).**

- [ ] **Step 8: GATE decision**

- **PASS** → record the result (screenshot + console line) in a new scratch note `debug/drafts/recording-alignment-probe-note.md`, and update `src/demos/recording/CLAUDE.md`'s "Don't Synthesize Input" rule: keep the cross-context prohibition, add the verified same-context exception ("a `MediaStreamAudioDestinationNode` created in the SAME AudioContext the engine captures into works; hand out `stream.clone()` per getUserMedia call so consumer `track.stop()` can't kill the source — see `src/lib/audit/loopbackInjection.ts`").
- **FAIL** → STOP the plan. Report to the user with the measured evidence and the fallback options (real-mic loopback protocol, or macOS virtual-audio device e.g. BlackHole). Do not proceed to Task 2 without a user decision.

- [ ] **Step 9: Commit**

```bash
git add src/lib/audit/loopbackInjection.ts src/demos/recording/recording-alignment-audit-debug-demo.tsx \
  recording-alignment-audit-debug-demo.html vite.config.ts src/lib/projectSetup.ts src/demos/recording/CLAUDE.md
git commit -m "feat(audit): loopback capture injection + same-context feasibility probe"
```

---

### Task 2: Pure measurement library — schedule, band split, identification

**Files:**
- Create: `src/lib/audit/recordingAlignment.ts`
- Test: `src/lib/audit/recordingAlignment.test.ts`

**Interfaces:**
- Consumes: nothing SDK-side — Float32Array in, numbers out (same contract as `onsetDetection.ts`).
- Produces (used by Tasks 3–5):
  - `buildReferenceSchedule(startSec: number, count: number, baseGapSec?: number, gapIncrementSec?: number): ReferenceSchedule` where `ReferenceSchedule = { times: number[]; baseGapSec: number; gapIncrementSec: number }`
  - `bandSplit(channel: Float32Array, sampleRate: number, lowCutoffHz?: number, highCutoffHz?: number): { low: Float32Array; high: Float32Array }` (zero-phase forward-backward biquads — filtfilt — so filtering adds no onset-time bias)
  - `identifyReferenceClicks(onsets: number[], schedule: ReferenceSchedule, gapToleranceSec?: number): IdentifiedClick[]` where `IdentifiedClick = { index: number; fileTimeSec: number }`
  - `estimateAnchorT0(identified: IdentifiedClick[], schedule: ReferenceSchedule): number | null` — median of `schedule.times[index] − fileTimeSec` (context time of the buffer's first frame)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildReferenceSchedule, bandSplit, identifyReferenceClicks, estimateAnchorT0,
} from "./recordingAlignment";

describe("buildReferenceSchedule", () => {
  it("uses unique growing gaps so consecutive pairs identify their index", () => {
    const s = buildReferenceSchedule(1.0, 5, 0.25, 0.005);
    expect(s.times[0]).toBeCloseTo(1.0, 9);
    expect(s.times[1] - s.times[0]).toBeCloseTo(0.25, 9);
    expect(s.times[2] - s.times[1]).toBeCloseTo(0.255, 9);
    expect(s.times[4] - s.times[3]).toBeCloseTo(0.265, 9);
  });
});

describe("bandSplit", () => {
  it("separates a 440Hz tone from a 6kHz tone", () => {
    const rate = 48000;
    const n = rate; // 1s
    const mixed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mixed[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate)
               + 0.5 * Math.sin((2 * Math.PI * 6000 * i) / rate);
    }
    const { low, high } = bandSplit(mixed, rate);
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
    // Each band keeps its own tone (~0.354 rms) and rejects the other by >20 dB.
    expect(rms(low)).toBeGreaterThan(0.3);
    expect(rms(high)).toBeGreaterThan(0.3);
    const lowOnly = bandSplit(new Float32Array(mixed.map((_, i) =>
      0.5 * Math.sin((2 * Math.PI * 6000 * i) / rate))), rate).low;
    expect(rms(lowOnly)).toBeLessThan(0.035);
  });
  it("is zero-phase: a click's peak position survives filtering within 1ms", () => {
    const rate = 48000;
    const x = new Float32Array(rate);
    const clickAt = Math.round(0.5 * rate);
    for (let i = 0; i < 96; i++) x[clickAt + i] = Math.sin((2 * Math.PI * 6000 * i) / rate);
    const { high } = bandSplit(x, rate);
    let peakIdx = 0, peak = 0;
    for (let i = 0; i < high.length; i++) if (Math.abs(high[i]) > peak) { peak = Math.abs(high[i]); peakIdx = i; }
    expect(Math.abs(peakIdx - (clickAt + 48)) / rate).toBeLessThan(0.001);
  });
});

describe("identifyReferenceClicks / estimateAnchorT0", () => {
  const schedule = buildReferenceSchedule(10.0, 20, 0.25, 0.005);
  it("recovers indices and T0 from a truncated, shifted subset", () => {
    // Buffer starts at context time 11.3 → clicks 0..4 are before the buffer.
    const T0 = 11.3;
    const onsets = schedule.times.filter((t) => t >= T0).map((t) => t - T0);
    const identified = identifyReferenceClicks(onsets, schedule);
    expect(identified.length).toBe(onsets.length);
    expect(identified[0].index).toBe(schedule.times.findIndex((t) => t >= T0));
    expect(estimateAnchorT0(identified, schedule)).toBeCloseTo(T0, 4);
  });
  it("survives one spurious extra onset and one missing click", () => {
    const T0 = 10.0;
    const onsets = schedule.times.map((t) => t - T0);
    onsets.splice(3, 1);          // one missing
    onsets.push(onsets[5] + 0.03); // one spurious
    onsets.sort((a, b) => a - b);
    const identified = identifyReferenceClicks(onsets, schedule);
    // All real clicks except the removed one are identified; the spurious onset is dropped.
    expect(identified.length).toBe(19);
    expect(identified.some((c) => c.index === 3)).toBe(false);
    expect(estimateAnchorT0(identified, schedule)).toBeCloseTo(T0, 4);
  });
  it("returns empty for fewer than two onsets", () => {
    expect(identifyReferenceClicks([1.23], schedule)).toEqual([]);
    expect(estimateAnchorT0([], schedule)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/lib/audit/recordingAlignment.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`buildReferenceSchedule`: loop `t += baseGapSec + i * gapIncrementSec` (as in the interface block above).

`bandSplit`: RBJ biquad coefficients (lowpass at `lowCutoffHz` default 1500, highpass at `highCutoffHz` default 3000, Q = 1/√2), each applied forward then backward (filtfilt) over a copy:

```ts
function biquadCoeffs(type: "lowpass" | "highpass", f0: number, rate: number) {
  const w0 = (2 * Math.PI * f0) / rate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2 / 1); // Q = sqrt(2)/2 → alpha = sin/ (2Q)
  const cosw = Math.cos(w0);
  const a0 = 1 + alpha;
  if (type === "lowpass") {
    return { b0: (1 - cosw) / 2 / a0, b1: (1 - cosw) / a0, b2: (1 - cosw) / 2 / a0,
             a1: (-2 * cosw) / a0, a2: (1 - alpha) / a0 };
  }
  return { b0: (1 + cosw) / 2 / a0, b1: -(1 + cosw) / a0, b2: (1 + cosw) / 2 / a0,
           a1: (-2 * cosw) / a0, a2: (1 - alpha) / a0 };
}
function filtfilt(x: Float32Array, c: ReturnType<typeof biquadCoeffs>): Float32Array {
  const pass = (input: Float32Array): Float32Array => {
    const y = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const v = c.b0 * input[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = input[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  const forward = pass(x);
  forward.reverse();
  const backward = pass(forward);
  backward.reverse();
  return backward;
}
```

`identifyReferenceClicks`: for each consecutive onset pair, `gap = onsets[k+1] − onsets[k]`; candidate index `i = round((gap − baseGapSec) / gapIncrementSec)`; accept when `0 ≤ i < times.length − 1` and `|gap − (baseGapSec + i·gapIncrementSec)| ≤ gapToleranceSec` (default 0.002). Each accepted pair votes `T0 = times[i] − onsets[k]`; take the median vote as the working anchor, then assign EVERY onset to its nearest schedule time given that anchor, keeping assignments within `gapToleranceSec·2` and dropping duplicates/outliers (the spurious-onset test enforces this final filter).

`estimateAnchorT0`: median over identified clicks of `schedule.times[index] − fileTimeSec`; `null` when empty.

- [ ] **Step 4: Run tests, verify pass; tsc gate**

```bash
npx vitest run src/lib/audit/recordingAlignment.test.ts
npx tsc --noEmit 2>&1 | grep '^src/' || echo CLEAN
```
Expected: all green, `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/recordingAlignment.ts src/lib/audit/recordingAlignment.test.ts
git commit -m "feat(audit): reference schedule, zero-phase band split, click identification"
```

---

### Task 3: Pure measurement library — take alignment + cell classification

**Files:**
- Modify: `src/lib/audit/recordingAlignment.ts`
- Test: `src/lib/audit/recordingAlignment.test.ts` (extend)
- Create: `src/lib/audit/recordingAuditCalibration.ts`

**Interfaces:**
- Produces (used by Tasks 4–5):

```ts
export interface TakeMeasurementInput {
  lowOnsets: number[];        // file-time onsets (s), metronome band
  highOnsets: number[];       // file-time onsets (s), reference band
  regionStartSec: number;     // tempoMap.ppqnToSeconds(region position)
  waveformOffsetSec: number;
  regionDurationSec: number;
  bufferDurationSec: number;  // data.numberOfFrames / data.sampleRate
  bpm: number;
  countInBeats: number;       // 0 when recording started without count-in
  schedule: ReferenceSchedule;
  recordRequestContextTime: number | null; // audioContext.currentTime captured just before startRecording; null if unavailable
  stopRequestContextTime: number | null;   // audioContext.currentTime captured just before stopRecording; null if unavailable
}
export interface TakeAlignment {
  beatErrors: { beat: number; errorMs: number }[]; // signed; beat 0 = region start
  medianBeatErrorMs: number | null;                 // null when no beats matched
  anchorT0Sec: number | null;
  firstRefIndex: number | null;
  headMissingMs: number | null; // signal after the record request that never entered the buffer, in ms; null when not computable
  tailMissingMs: number | null; // signal before the stop request missing from the buffer tail: max(0, stopRequestContextTime − (anchorT0 + bufferDurationSec)) * 1000; null when not computable
  matchedBeats: number; missingBeats: number; extraLowOnsets: number;
}
export function measureTakeAlignment(input: TakeMeasurementInput): TakeAlignment;

export type CellStatus = "aligned" | "matches-known-defect" | "investigate";
export interface SignatureBand {
  id: "A" | "B" | "C" | "D";
  kind: "random-band" | "constant-late" | "head-loss";
  minAbsMs: number; maxAbsMs: number;
}
export interface CellClassification { status: CellStatus; matchedSignature: SignatureBand["id"] | null; detail: string }
export function classifyCell(repeats: TakeAlignment[], bands: SignatureBand[], alignedToleranceMs: number): CellClassification;
```

- [ ] **Step 1: Write the failing tests** (append to `recordingAlignment.test.ts`)

```ts
describe("measureTakeAlignment", () => {
  const bpm = 120; // beat = 0.5s
  const schedule = buildReferenceSchedule(0, 40, 0.25, 0.005);
  const base = {
    regionStartSec: 0, waveformOffsetSec: 2.0, regionDurationSec: 4.0,
    bufferDurationSec: 6.0, bpm, countInBeats: 4, schedule,
    recordRequestContextTime: null, stopRequestContextTime: null,
  };
  // Perfect capture: metronome beat k lands at file time waveformOffset + k*0.5.
  const perfectLow = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => 2.0 + k * 0.5);
  it("reports ~0 error for a perfectly placed take", () => {
    const a = measureTakeAlignment({ ...base, lowOnsets: perfectLow, highOnsets: [] });
    expect(a.medianBeatErrorMs).not.toBeNull();
    expect(Math.abs(a.medianBeatErrorMs!)).toBeLessThan(0.01);
    expect(a.matchedBeats).toBe(8);
  });
  it("reports a +30ms error when waveformOffset under-compensates by 30ms", () => {
    // Content actually at +30ms relative to where the region math expects it.
    const late = perfectLow.map((t) => t + 0.030);
    const a = measureTakeAlignment({ ...base, lowOnsets: late, highOnsets: [] });
    expect(a.medianBeatErrorMs!).toBeCloseTo(30, 1);
  });
  it("computes headMissingMs from reference clicks vs the record request time", () => {
    // Buffer starts at context 5.0 (T0), record was requested at context 4.9 →
    // 100ms of post-request signal never reached the buffer.
    const T0 = 5.0;
    const highOnsets = schedule.times.filter((t) => t >= T0).map((t) => t - T0);
    const a = measureTakeAlignment({
      ...base, lowOnsets: perfectLow, highOnsets, recordRequestContextTime: 4.9,
    });
    expect(a.anchorT0Sec).toBeCloseTo(T0, 3);
    expect(a.headMissingMs).toBeCloseTo(100, 0);
  });
  it("computes tailMissingMs when the buffer ends before the stop request", () => {
    // Buffer covers context [5.0, 11.0]; stop was requested at 11.05 → 50ms of tail lost.
    const T0 = 5.0;
    const highOnsets = schedule.times.filter((t) => t >= T0 && t <= T0 + 6).map((t) => t - T0);
    const a = measureTakeAlignment({
      ...base, lowOnsets: perfectLow, highOnsets, stopRequestContextTime: 11.05,
    });
    expect(a.tailMissingMs).toBeCloseTo(50, 0);
  });
});

describe("classifyCell", () => {
  const bands: SignatureBand[] = [
    { id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 },
    { id: "C", kind: "constant-late", minAbsMs: 50, maxAbsMs: 235 },
    { id: "D", kind: "constant-late", minAbsMs: 15, maxAbsMs: 30 },
  ];
  const take = (medianMs: number): TakeAlignment => ({
    beatErrors: [], medianBeatErrorMs: medianMs, anchorT0Sec: null,
    firstRefIndex: 0, headMissingMs: null, tailMissingMs: null,
    matchedBeats: 8, missingBeats: 0, extraLowOnsets: 0,
  });
  it("aligned when every repeat is within tolerance", () => {
    expect(classifyCell([take(0.5), take(-1.1), take(0.9)], bands, 2).status).toBe("aligned");
  });
  it("matches a random-band signature when repeats scatter inside the band", () => {
    const c = classifyCell([take(9), take(-12), take(5)], bands, 2);
    expect(c.status).toBe("matches-known-defect");
    expect(c.matchedSignature).toBe("B");
  });
  it("matches a constant-late signature when repeats agree inside the band", () => {
    const c = classifyCell([take(80), take(85), take(78)], bands, 2);
    expect(c.matchedSignature).toBe("C");
  });
  it("investigate when magnitude fits no band", () => {
    expect(classifyCell([take(400), take(410), take(395)], bands, 2).status).toBe("investigate");
  });
  it("investigate when beats are missing even if placement is aligned", () => {
    const broken = { ...take(0.3), missingBeats: 2 };
    expect(classifyCell([broken, take(0.2), take(0.4)], bands, 2).status).toBe("investigate");
  });
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

```bash
npx vitest run src/lib/audit/recordingAlignment.test.ts
```

- [ ] **Step 3: Implement**

`measureTakeAlignment`:
1. Map each low onset to timeline seconds: `timelineSec = regionStartSec + (fileTime − waveformOffsetSec)`.
2. Expected beats: `k * (60 / bpm)` for `k = 0 … floor(regionDurationSec / (60/bpm))` (relative to region start; count-in beats live at negative timeline positions and are NOT part of the region-presented content, so beat matching starts at 0 — count-in clicks still occur in the raw buffer and simply fall outside the matched set).
3. Match greedily nearest-first within half a beat period; `errorMs = (mapped − expected) * 1000` signed. `medianBeatErrorMs` = median of matched errors (null if none). `missingBeats` = expected beats overlapped by the region with no match; `extraLowOnsets` = low onsets inside the presented range with no matched beat.
4. `identifyReferenceClicks(highOnsets, schedule)` → `anchorT0Sec`, `firstRefIndex`.
5. `headMissingMs`: when `anchorT0Sec` and `recordRequestContextTime` are both available, `max(0, (anchorT0Sec − recordRequestContextTime)) * 1000` — signal after the request that never entered the buffer; else null.
6. `tailMissingMs`: when `anchorT0Sec` and `stopRequestContextTime` are both available, `max(0, (stopRequestContextTime − (anchorT0Sec + bufferDurationSec))) * 1000`; else null. Classification treats `tailMissingMs > tol` exactly like a head deficit (forces `investigate` unless a `head-loss` band matches).

`classifyCell`:
1. Medians `m_i` per repeat (repeats with `medianBeatErrorMs === null` or `missingBeats > 0` or `headMissingMs > alignedToleranceMs` force `investigate` unless a `head-loss` band matches the head deficit).
2. All `|m_i| ≤ tol` → `aligned`.
3. Spread `= max(m_i) − min(m_i)`. For each band: `random-band` matches when spread `> 2·tol` and every `|m_i| ≤ maxAbsMs` and at least one `|m_i| ≥ minAbsMs`; `constant-late` matches when spread `≤ 2·tol` and the mean is within `[minAbsMs, maxAbsMs]` and positive (late); `head-loss` matches when every repeat's `headMissingMs` is within `[minAbsMs, maxAbsMs]`. First matching band wins (order = caller's array order).
4. Otherwise `investigate`. `detail` = a human-readable one-liner with the medians, spread, and head deficits (string, not object).

`src/lib/audit/recordingAuditCalibration.ts` (constants only, calibrated values updated during Task 6 bring-up):

```ts
import type { SignatureBand } from "./recordingAlignment";

export const RECORDING_AUDIT_RATES = [44100, 48000] as const;
export const RECORDING_AUDIT_BPMS = [120, 97.3] as const;
export const RECORDING_AUDIT_SCENARIOS = [
  "nominal-start", "janked-start", "midtimeline-start", "countin-start", "loop-wrap",
] as const;
export type RecordingScenario = (typeof RECORDING_AUDIT_SCENARIOS)[number];
export const REPEATS_PER_CELL = 3;
export const JANK_MS = 150;
export const LOOP_WRAP_TAKES = 5;
/** Bring-up-calibrated verdict floor; provisional 2ms, re-measured in Task 6. */
export const ALIGNED_TOLERANCE_MS = 2;
/** Predicted upstream signatures (spec §1) — predictions to test, not truths. */
export const SIGNATURE_BANDS: Record<RecordingScenario, SignatureBand[]> = {
  "nominal-start": [{ id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 }],
  "janked-start": [
    { id: "C", kind: "constant-late", minAbsMs: 50, maxAbsMs: 235 },
    { id: "A", kind: "head-loss", minAbsMs: 20, maxAbsMs: 300 },
  ],
  "midtimeline-start": [{ id: "A", kind: "head-loss", minAbsMs: 5, maxAbsMs: 300 }],
  "countin-start": [{ id: "B", kind: "random-band", minAbsMs: 4, maxAbsMs: 25 }],
  "loop-wrap": [{ id: "D", kind: "constant-late", minAbsMs: 15, maxAbsMs: 30 }],
};
```

- [ ] **Step 4: Run all audit tests + tsc gate**

```bash
npx vitest run src/lib/audit/
npx tsc --noEmit 2>&1 | grep '^src/' || echo CLEAN
```
Expected: green (existing suites untouched), `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/recordingAlignment.ts src/lib/audit/recordingAlignment.test.ts src/lib/audit/recordingAuditCalibration.ts
git commit -m "feat(audit): take-alignment measurement and three-way cell classification"
```

---

### Task 4: Harness page — full scenario runner

**Files:**
- Modify: `src/demos/recording/recording-alignment-audit-debug-demo.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–3 by the exact names above, plus `detectOnsets` (`src/lib/audit/onsetDetection.ts`), `withDeadline` (`src/lib/deadline.ts`), `WavFile.encodeInts16` (`@opendaw/lib-dsp`), the `/__verify` PUT sink.
- Produces: the page contract Tasks 6–7 automate against: query params `?scenario=<name|all>&bpm=<n|all>&rate=<44100|48000>` (rate is per-page-load — it sets the AudioContext rate at init and is NEVER "all"), `#audit-state` badge (`setup → running:<cell> → uploading → done | error:<msg>`), one results-table row per cell repeat, JSON summary + per-take WAVs uploaded as `recaudit-<scenario>-<bpmToken>-<rate>-r<repeat>[-t<take>].wav` and `recaudit-summary-<timestamp>.json`.

- [ ] **Step 1: Replace the probe-only page with the scenario runner**

Keep probe mode (`?scenario=probe`) working. Add the matrix runner. Core structure:

```tsx
interface AuditRow {
  scenario: RecordingScenario; bpm: number; rate: number; repeat: number;
  takeIndex: number; medianBeatErrorMs: number | null; matchedBeats: number;
  missingBeats: number; headMissingMs: number | null;
  status: CellStatus | "pending" | "error"; matchedSignature: string | null;
  detail: string; errorMessage?: string;
}
```

Cell loop (single page load, one rate): for each scenario × bpm × repeat, `await withDeadline(runCellRepeat(...), 120_000, label)`; catch → error row, continue. One `initializeOpenDAW` per page load with `audioContextSampleRate: rate` and `engineTap: loopback.engineTap`; `loopback.attach(audioContext)` right after. ONE tape created once (probe sequence from Task 1); reused across cells. Between cells: `project.engine.stop(true)`, clear all take regions + their AudioFileBoxes via `project.editing.modify(() => { …regions.forEach(r => r.box.delete()) })` after collecting measurements, `project.engine.setPosition(0)`.

- [ ] **Step 2: Implement `runCellRepeat`**

Common sequence per repeat:

```ts
async function runCellRepeat(scenario: RecordingScenario, bpm: number): Promise<AuditRow[]> {
  const { project, audioContext } = ctx; // page-scoped
  project.editing.modify(() => { project.timelineBox.bpm.setValue(bpm); });
  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;
  settings.recording.allowTakes = true;
  settings.recording.olderTakeAction = "mute-region";
  settings.recording.inputLatency = 0;

  // Loop area only for loop-wrap; disabled otherwise (same editing.modify).
  const { loopArea } = project.timelineBox;
  project.editing.modify(() => {
    loopArea.from.setValue(0);
    loopArea.to.setValue(2 * BAR_PPQN); // BAR_PPQN = 3840 from auditExpectations
    loopArea.enabled.setValue(scenario === "loop-wrap");
  });

  // Reference clicks: start before recording, cover the longest cell (loop-wrap
  // 5 takes @97.3bpm ≈ 25s) + margin.
  const schedule = buildReferenceSchedule(audioContext.currentTime + 0.2, 120, 0.25, 0.005);
  loopback.scheduleReferenceClicks(schedule.times);

  let stage = "prefs";                        // last-stage trail for error rows
  let recordRequestContextTime: number | null = null; // set by each start case, line before startRecording
  let stopRequestContextTime: number | null = null;   // set on the line before stopRecording
  // …scenario-specific start (Step 3)…
  // …scenario-specific stop condition (Step 4)…
  // …finalization barrier + measurement (Step 5)…
}
```

Update `stage` at each phase transition (`"start"`, `"recording"`, `"stopping"`, `"finalizing"`, `"measuring"`); the cell loop's catch builds `errorMessage = stage + ": " + String(error)` so error rows self-classify with the last stage reached (the debug-demo stage-trail convention).

- [ ] **Step 3: Scenario-specific starts** (each captures `recordRequestContextTime = audioContext.currentTime` on the line before its `startRecording` call; the stop sites in Step 4 capture `stopRequestContextTime` the same way)

```ts
switch (scenario) {
  case "nominal-start": {
    project.engine.setPosition(0);
    project.startRecording(false);
    break;
  }
  case "countin-start":
  case "loop-wrap": {
    project.engine.setPosition(0);
    project.startRecording(true); // 1-bar count-in
    break;
  }
  case "janked-start": {
    project.engine.setPosition(0);
    project.startRecording(false);
    // Block the main thread THROUGH the first isRecording observation window.
    const until = performance.now() + JANK_MS;
    while (performance.now() < until) { /* spin */ }
    break;
  }
  case "midtimeline-start": {
    project.engine.setPosition(0);
    project.engine.play();
    await waitForPosition(project, 2 * BAR_PPQN, 20_000); // poll engine.position via rAF-friendly interval
    project.startRecording(false);
    break;
  }
}
```

`waitForPosition(project, targetPpqn, deadlineMs)`: `withDeadline`-wrapped promise polling `project.engine.position.getValue()` every 50 ms.

- [ ] **Step 4: Scenario-specific stop conditions**

- `nominal-start` / `janked-start` / `countin-start` / `midtimeline-start`: record for 4 bars of musical time (`await waitForPosition(project, startPpqn + 4 * BAR_PPQN, 60_000)` where `startPpqn` is 0 or the mid-timeline start), then `project.engine.stopRecording()`.
- `loop-wrap`: subscribe to take-region additions (regions `catchupAndSubscribe`, count `isAudioRegion()` regions on the tape's tracks); when the count reaches `LOOP_WRAP_TAKES + 1` (the in-progress take after the 5th wrap), `project.engine.stopRecording()`. Deadline 90 s.

- [ ] **Step 5: Finalization barrier + measurement per take**

Reuse the Task 1 loader-wait (pre-check `state.type`, `subscribed` flag, `withDeadline` 30 s). All takes on the tape share one file — wait once, then measure EVERY take region:

```ts
const takeRegions = unitAdapter.tracks.values()
  .flatMap((t) => [...t.regions.adapters.values()])
  .filter((r) => r.isAudioRegion())
  .sort((a, b) => a.position - b.position);
const data = loader.data.unwrap();
const mono = data.frames[0]; // requestChannels = 1
const { low, high } = bandSplit(mono, data.sampleRate);
const lowOnsets = detectOnsets(low, data.sampleRate, { refractorySec: 0.1 });
const highOnsets = detectOnsets(high, data.sampleRate, { refractorySec: 0.05 });
for (const [takeIndex, region] of takeRegions.entries()) {
  const regionStartSec = project.tempoMap.ppqnToSeconds(region.position);
  const waveformOffsetSec = region.box.waveformOffset.getValue();
  const regionDurationSec = project.tempoMap.intervalToSeconds(region.position, region.position + region.duration);
  const alignment = measureTakeAlignment({
    lowOnsets, highOnsets, regionStartSec, waveformOffsetSec, regionDurationSec,
    bufferDurationSec: data.numberOfFrames / data.sampleRate,
    bpm, countInBeats: usedCountIn ? 4 : 0, schedule,
    recordRequestContextTime, stopRequestContextTime,
  });
  rowsForRepeat.push(alignment);
}
```

Spec §3.4-5 telemetry, recorded per row (numbers in the summary JSON, not required in the table): each take's `waveformOffsetSec`; for loop-wrap, the delta `take[n].waveformOffset − (take[n−1].waveformOffset + take[n−1].durationSec)` (ideal ≈ 0); and the final-take buffer overshoot `bufferDurationSec − (lastTake.waveformOffset + lastTake.durationSec)` (RenderQuantum-granular by design).

(For loop-wrap, `measureTakeAlignment` receives each region's own geometry — the shared onset arrays are in file time, and each region's `waveformOffset` selects its slice. Discard the final in-progress take from D-classification: its stop-time duration is RenderQuantum-granular by design — see `src/demos/recording/CLAUDE.md` take-durations rule.)

After all repeats of a cell: `classifyCell(perRepeatAlignments, SIGNATURE_BANDS[scenario], ALIGNED_TOLERANCE_MS)` (loop-wrap classifies over the per-take alignments of wrap takes 2..5 across repeats), stamp the classification onto the cell's rows, upload per-repeat WAV (`WavFile.encodeInts16` of the full capture buffer) and stream rows to the table.

- [ ] **Step 6: Summary upload + table**

After the loop: `uploading` state, PUT `recaudit-summary-<Date.now()>.json` (all rows + the schedule constants + rate + SDK build probe from Task 5, `JSON.stringify(..., null, 2)`), then `done`. Results table columns: scenario / bpm / repeat / take / medianErr (ms) / matched / missing / headMiss (ms) / signature / status badge (green aligned, amber matches-known-defect, red investigate/error, `title={detail}`).

- [ ] **Step 7: tsc gate + smoke one cell**

```bash
npx tsc --noEmit 2>&1 | grep '^src/' || echo CLEAN
```
Then run `?scenario=nominal-start&bpm=120&rate=48000` in visible Chrome (real click), confirm: 3 repeat rows, plausible `medianBeatErrorMs` values (any magnitude — upstream defects are expected!), WAV + JSON land in `.verify-output/`. Listen-check one WAV or inspect with the audio-analyzer MCP: metronome clicks + high pips both audible/visible in the spectrum.

- [ ] **Step 8: Commit**

```bash
git add src/demos/recording/recording-alignment-audit-debug-demo.tsx
git commit -m "feat(audit): recording-alignment scenario runner (5 scenarios, live matrix)"
```

---

### Task 5: SDK_DIST_OVERRIDE mechanism + build probe

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/demos/recording/recording-alignment-audit-debug-demo.tsx` (build-probe line)

**Interfaces:**
- Produces: env var `SDK_DIST_OVERRIDE=<abs path>` — a directory laid out like `node_modules` (`<dir>/@opendaw/<pkg>/{package.json,dist}`). When set, `@opendaw/*` module resolution AND the wasm-engine asset route serve from it. Neutral naming only.

- [ ] **Step 1: Add the alias block to `vite.config.ts`**

In the config factory, before the returned object:

```ts
const sdkDistOverride = process.env.SDK_DIST_OVERRIDE;
```

Extend `resolve.alias` (currently only `"@"`). Vite accepts an array form with regex finds — convert:

```ts
resolve: {
  alias: [
    { find: "@", replacement: resolve(__dirname, "./src") },
    ...(sdkDistOverride
      ? [{ find: /^@opendaw\/(.+)$/, replacement: resolve(sdkDistOverride, "@opendaw") + "/$1" }]
      : []),
  ],
},
```

(The replacement points at the package DIRECTORY so vite still honors each package's own `package.json` `exports`. Keep the `"@"` alias FIRST.)

- [ ] **Step 2: Point `wasmEngineAssets` at the override**

In the `wasmEngineAssets` plugin, replace the hardcoded `node_modules/@opendaw/studio-core-wasm/dist/wasm` root with:

```ts
const wasmRoot = sdkDistOverride
  ? resolve(sdkDistOverride, "@opendaw/studio-core-wasm/dist/wasm")
  : resolve(__dirname, "node_modules/@opendaw/studio-core-wasm/dist/wasm");
```

(Keep the existing path-escape guard and MIME map untouched. `wasmEngineEmit` is build-only — the override is a dev-server mechanism; leave it alone.)

- [ ] **Step 3: Build probe in the harness page**

At init, detect which build is live via a capability probe (a fixed build exposes `firstQuantumTime` on `RecordingWorklet`) and show it in the header + summary JSON:

```ts
import { RecordingWorklet } from "@opendaw/studio-core";
const buildProbe = Object.getOwnPropertyDescriptor(RecordingWorklet.prototype, "firstQuantumTime")
  ? "candidate" : "upstream";
```

(If `RecordingWorklet` isn't exported by `@opendaw/studio-core`'s public surface, fall back to `"unknown"` via a try/catch around a dynamic import — do NOT fail init over the probe. Verify the export in `node_modules/@opendaw/studio-core/dist/index.d.ts` first.)

- [ ] **Step 4: Verify both modes + tsc gate**

```bash
npx tsc --noEmit 2>&1 | grep '^src/' || echo CLEAN
# default mode: dev server unchanged, page shows build: upstream
# override smoke: SDK_DIST_OVERRIDE=/nonexistent should fail loudly at resolve-time, not silently fall back
```
Also note in the register (Task 6) protocol: switching modes requires `rm -rf node_modules/.vite` (dep pre-bundle cache holds the previous SDK).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/demos/recording/recording-alignment-audit-debug-demo.tsx
git commit -m "feat(audit): SDK dist override for A/B harness runs + build probe"
```

---

### Task 6: Upstream campaign — bring-up calibration + full matrix run

Measurement task (browser automation + register writing), not code — except calibration-constant updates.

**Files:**
- Create: `debug/recording-start-alignment-audit.md` (campaign register)
- Modify: `src/lib/audit/recordingAuditCalibration.ts` (measured tolerance/band updates)

- [ ] **Step 1: Seed the register** — mirror `debug/sample-rate-alignment-audit.md`'s header structure: Title, SDK pin (`@opendaw/studio-sdk@0.0.170`), harness URL + params, spec pointer, the A–D prediction table (copy from spec §1), and an empty results section. Commit.

- [ ] **Step 2: Bring-up calibration** on the control cell (`nominal-start`, 120 bpm, 48 kHz, extra repeats): verify band separation is clean (no metronome energy detected in the high band and vice versa — if the metronome click bleeds above 3 kHz, raise `REF_CLICK_HZ` to 8000 and `highCutoffHz` to 5000 in ONE place each and re-run), measure the detector/graph-path bias (median error of reference clicks against their own schedule — the loopback graph itself is one render quantum-ish), set `ALIGNED_TOLERANCE_MS` from measured noise (2× the clean-path spread, floor 2 ms). Record every measured number + run id in the register and in `recordingAuditCalibration.ts` comments (same style as `auditCalibration.ts`). Commit.

- [ ] **Step 3: Full matrix, rate 48000** — `?scenario=all&bpm=all&rate=48000`, real first click, visible window. Save the summary JSON name + per-cell verdicts into the register.

- [ ] **Step 4: Full matrix, rate 44100** — same on a fresh page load with `?rate=44100`.

- [ ] **Step 5: Triage** — every `investigate` cell gets a register entry: harness artifact vs candidate new issue, with the evidence (this is the additional-issues funnel; the previous campaign's S27/S28 showed detector tuning is the likely first suspect). Every `matches-known-defect` cell gets its measured magnitude recorded against the predicted band. Every prediction A–D ends the task either **confirmed** (with numbers) or **refuted** (with numbers). Commit the register.

---

### Task 7: Candidate-build verification run

- [ ] **Step 1: Build the candidate dists** — the candidate monorepo path and its build command live in `.claude/local.md` (add them there if absent; NEVER in committed files). Lay out/symlink its built packages as `<override-dir>/@opendaw/<pkg>`. Required packages: every `@opendaw/*` the demo bundle imports (at minimum `studio-sdk` transitive set: `studio-core`, `studio-adapters`, `studio-boxes`, `studio-enums`, `studio-core-wasm`, `lib-*`).
- [ ] **Step 2: Swap** — kill the dev server by PID, `rm -rf node_modules/.vite`, restart with `SDK_DIST_OVERRIDE=<dir>`. Confirm the page header shows `build: candidate`.
- [ ] **Step 3: Re-run both matrices** (48 k then 44.1 k page loads, same protocol). API-drift failures of the page glue are harness work: fix forward in the page (keeping upstream mode compiling), re-verify upstream mode afterwards.
- [ ] **Step 4: Verdict against spec §3.7** — record in the register (neutral wording: "candidate-fix build"): every upstream `matches-known-defect` cell must now be `aligned`; no regressions; head/tail integrity clean. Any criterion that fails is documented precisely (which cell, which number).
- [ ] **Step 5: Restore** — restart the dev server WITHOUT the override, `rm -rf node_modules/.vite`, re-smoke one upstream cell (guards against cache bleed corrupting the upstream numbers). Commit the register updates.

---

### Task 8: Register finalization, issue drafts, PR

- [ ] **Step 1: Finalize the register** — outcome summary at top (same shape as `debug/sample-rate-alignment-audit.md`): matrix tally, confirmed/refuted predictions with magnitudes, `investigate` resolutions, candidate-build verdict, evidence file names in `.verify-output/`.
- [ ] **Step 2: Issue drafts** — one md file per confirmed defect under `debug/drafts/` (e.g. `issue-recording-start-anchor.md`): live repro page URL + register link + measured signature; cause description WITHOUT a suggested-fix section (repo convention); no origin naming. STOP for user review — never `gh issue create` without explicit approval.
- [ ] **Step 3: Docs sweep** — `src/demos/recording/CLAUDE.md` gains the harness pointer (standing regression sweep note, like the samplerate one in root CLAUDE.md's Build & Verification); root CLAUDE.md Build & Verification gains the re-run line for SDK upgrades. Delete `docs/superpowers/specs/2026-09-01-recording-start-alignment-audit-design.md` and this plan file (repo convention: specs/plans die in the PR that completes them). Grep the full branch diff for the origin identifiers listed in `.claude/local.md` — must be zero hits.
- [ ] **Step 4: PR** — push branch, `gh pr create` (body: campaign summary + register link + evidence, PR-body footer per repo convention), run `/pr-review-toolkit:review-pr` applicable aspects, fix Critical/Important findings, squash-merge only on user go-ahead.
