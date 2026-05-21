# Simplify Debug Pages for Andre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape three debug demo pages (`voice-fadein-clip-fadein-product`, `pure-webaudio-target`, `shared-source-double-process`) into guided test scripts where each step says what to click, what to listen for, and what numbers to expect — addressing Andre's "I am randomly pressing buttons" feedback.

**Architecture:** Two new shared components (`TestStep`, `DebugLinkBar`) under `src/components/`. Each page's existing single-Card "Reproduce" section is replaced with a sequence of `<TestStep>` cards, each carrying its own action buttons and an "Expected vs Got" table that populates after a scan. Page 1 additionally switches its engine setup from one Tape track (overlapping regions — gets deleted by `project.copy()`) to two Tape tracks (crossfade mixes at master), matching the Target page's pattern and making the offline scan measure the dip instead of returning silence.

**Tech Stack:** React 19 + TypeScript + Radix UI Themes + Vite. No test framework in this project — verification is `npm run build` (type-check) plus manual browser checks against the documented expected numbers.

---

## File structure

**Create:**
- `src/components/TestStep.tsx` — numbered step card with title, description, action slot, Expected/Got table
- `src/components/DebugLinkBar.tsx` — horizontal row of cross-demo and debug-note links

**Modify:**
- `src/demos/playback/voice-fadein-clip-fadein-product-debug-demo.tsx` — switch to two-track engine setup; rewrite UI top-to-bottom
- `src/demos/playback/pure-webaudio-target-debug-demo.tsx` — UI restructure only (engine already two-track)
- `src/demos/playback/shared-source-double-process-debug-demo.tsx` — UI restructure only

**No changes:**
- `vite.config.ts`, `public/sitemap.xml`, `src/index.tsx`, HTML entry points — all unaffected (these are unlisted debug demos already wired up).

---

### Task 1: Create `<TestStep>` shared component

**Files:**
- Create: `src/components/TestStep.tsx`

- [ ] **Step 1: Write the component**

Write `src/components/TestStep.tsx` with this exact content:

```tsx
import React from "react";
import { Badge, Card, Code, Flex, Separator, Text } from "@radix-ui/themes";

export interface TestStepRow {
  label: string;
  value: string;
}

export interface TestStepProps {
  index: number;
  title: string;
  description: React.ReactNode;
  actions: React.ReactNode;
  expected: TestStepRow[];
  got?: TestStepRow[] | null;
}

export const TestStep: React.FC<TestStepProps> = ({
  index,
  title,
  description,
  actions,
  expected,
  got,
}) => {
  const gotByLabel = new Map((got ?? []).map((r) => [r.label, r.value]));
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <Badge color="amber" size="2" radius="full">
            Step {index}
          </Badge>
          <Text size="3" weight="bold">
            {title}
          </Text>
        </Flex>
        <Separator size="4" />
        <Text size="2">{description}</Text>
        <Flex gap="3" wrap="wrap">
          {actions}
        </Flex>
        {expected.length > 0 && (
          <Flex direction="column" gap="2" style={{ paddingTop: 4 }}>
            <Flex gap="3">
              <Text size="2" weight="bold" style={{ flex: 1 }}>
                Expected
              </Text>
              <Text size="2" weight="bold" style={{ flex: 1 }}>
                Got
              </Text>
            </Flex>
            <Separator size="4" />
            {expected.map((row) => (
              <Flex gap="3" key={row.label} align="start">
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="1" color="gray">
                    {row.label}
                  </Text>
                  <Code size="2">{row.value}</Code>
                </Flex>
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="1" color="gray">
                    &nbsp;
                  </Text>
                  <Code size="2">{gotByLabel.get(row.label) ?? "—"}</Code>
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Card>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: completes with no TypeScript errors. (VitePress build at the end is fine; we only care about Vite's TS pass over `src/`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/TestStep.tsx
git commit -m "feat: add TestStep component for guided debug-page steps

Numbered step card with title, description, action buttons slot, and an
Expected vs Got table populated by per-step scan handlers. Used by the
three 440 Hz-fixture debug demos to give Andre a scripted walkthrough.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create `<DebugLinkBar>` shared component

**Files:**
- Create: `src/components/DebugLinkBar.tsx`

- [ ] **Step 1: Write the component**

Write `src/components/DebugLinkBar.tsx` with this exact content:

```tsx
import React from "react";
import { Flex, Text } from "@radix-ui/themes";

export interface DebugLink {
  label: string;
  href: string;
  kind: "demo" | "note";
}

export interface DebugLinkBarProps {
  links: DebugLink[];
}

export const DebugLinkBar: React.FC<DebugLinkBarProps> = ({ links }) => {
  if (links.length === 0) return null;
  return (
    <Flex gap="3" wrap="wrap" align="center" style={{ padding: "0.25rem 0" }}>
      <Text size="2" color="gray" weight="bold">
        See also:
      </Text>
      {links.map((l) => (
        <Text size="2" key={l.href}>
          <a
            href={l.href}
            style={{
              color: "var(--accent-11)",
              textDecoration: "underline",
            }}
            target={l.kind === "note" ? "_blank" : undefined}
            rel={l.kind === "note" ? "noopener noreferrer" : undefined}
          >
            {l.kind === "demo" ? "▶ " : "📄 "}
            {l.label}
          </a>
        </Text>
      ))}
    </Flex>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: completes with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DebugLinkBar.tsx
git commit -m "feat: add DebugLinkBar component for cross-demo navigation

Horizontal row of links above the demo heading: sibling demo pages
(rendered with ▶ prefix) and the underlying debug/*.md notes (with 📄
prefix, opening in a new tab). Used on the three 440 Hz-fixture demos
so Andre can hop between related investigations without URL-typing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Refactor `pure-webaudio-target-debug-demo.tsx`

This page already uses a two-track engine setup for the OPENDAW scenario, so engine code stays untouched. Changes are UI-only: add a `DebugLinkBar`, rewrite the top callout, replace the "Reproduce" card with three `<TestStep>` cards, and refactor `handleScan` to parse its results into structured `TestStepRow[]` per step.

**Files:**
- Modify: `src/demos/playback/pure-webaudio-target-debug-demo.tsx`

- [ ] **Step 1: Add component imports and step-result state**

In the imports block at the top of the file, add the two new component imports. After the existing `import` lines (the last one being `import { InfoCircledIcon, PlayIcon, StopIcon, ActivityLogIcon } from "@radix-ui/react-icons";`), add:

```tsx
import { TestStep, TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
```

Then inside the `App` component, after the existing `useState`/`useRef` declarations, replace the existing `const [scanResult, setScanResult] = useState<ScanResult | null>(null);` line with:

```tsx
const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
```

Remove the `interface ScanResult { text: string; }` declaration above the `App` component — it's no longer used.

- [ ] **Step 2: Refactor `handleScan` to write structured per-step results**

The current `handleScan` builds a multi-line string in `setScanResult({ text: ... })`. Replace it with a step-keyed version. Find the existing `const handleScan = useCallback(async () => { ... }` declaration and replace its entire body so it (a) accepts no argument but uses the current `scenario` to determine the step index, (b) computes the same metrics, and (c) writes a `TestStepRow[]` into `gotByStep[stepIndex]`.

Replace the existing `handleScan` declaration (lines ~490 through ~632 — the entire `useCallback`) with:

```tsx
const handleScan = useCallback(async () => {
  const ctx = audioContextRef.current;
  const bufferA = buffersRef.current.a;
  const bufferB = buffersRef.current.b;
  if (!ctx || !bufferA || !bufferB || !computedShift || scanning) return;
  const stepIndex =
    scenario === "aligned" ? 1 : scenario === "unaligned" ? 2 : 3;
  setScanning(true);
  setGotByStep((prev) => {
    const next = { ...prev };
    delete next[stepIndex];
    return next;
  });
  try {
    const sr = ctx.sampleRate;
    const sliceStart = SEAM_SECONDS - 0.05;
    const sliceEnd = SEAM_SECONDS + 0.05;
    let data: Float32Array;
    let renderedSampleRate: number;
    if (scenario === "opendaw") {
      if (!openDawProject) throw new Error("OpenDAW project not ready");
      if (openDawProject.engine.isPlaying.getValue())
        openDawProject.engine.stop(true);
      const offlineResult = await renderOfflineSlice(
        openDawProject,
        sliceStart,
        sliceEnd,
        sr
      );
      data = offlineResult.channels[0];
      renderedSampleRate = offlineResult.sampleRate;
    } else {
      const sliceSamples = Math.ceil((sliceEnd - sliceStart) * sr);
      const offline = new OfflineAudioContext(1, sliceSamples, sr);
      const shiftForScenario =
        scenario === "aligned" ? computedShift.samples : 0;
      const outputBuffer = buildCrossfadedOutput(
        bufferA,
        bufferB,
        offline,
        SEAM_SECONDS,
        CROSSFADE_MS,
        shiftForScenario
      );
      const source = offline.createBufferSource();
      source.buffer = outputBuffer;
      source.connect(offline.destination);
      source.start(0, sliceStart);
      const rendered = await offline.startRendering();
      data = rendered.getChannelData(0);
      renderedSampleRate = rendered.sampleRate;
    }
    const sr2 = renderedSampleRate;
    const indexAtSeconds = (sec: number) =>
      Math.max(0, Math.min(data.length, Math.round((sec - sliceStart) * sr2)));
    const peakInRange = (startSec: number, endSec: number) => {
      let peak = 0;
      const s = indexAtSeconds(startSec);
      const e = indexAtSeconds(endSec);
      for (let i = s; i < e; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      return peak;
    };
    const minEnvelopeInRange = (
      startSec: number,
      endSec: number,
      windowMs: number
    ) => {
      const winSamples = Math.max(1, Math.round((windowMs / 1000) * sr2));
      const stride = Math.max(1, Math.floor(winSamples / 2));
      let minPeak = Infinity;
      let atIdx = indexAtSeconds(startSec);
      const s = indexAtSeconds(startSec);
      const e = indexAtSeconds(endSec);
      for (let start = s; start + winSamples <= e; start += stride) {
        let localPeak = 0;
        for (let i = start; i < start + winSamples; i++) {
          const abs = Math.abs(data[i]);
          if (abs > localPeak) localPeak = abs;
        }
        if (localPeak < minPeak) {
          minPeak = localPeak;
          atIdx = start + Math.floor(winSamples / 2);
        }
      }
      return {
        minPeak: minPeak === Infinity ? 0 : minPeak,
        atSec: sliceStart + atIdx / sr2,
      };
    };
    const halfFadeSec = CROSSFADE_MS / 2000;
    const ref = peakInRange(
      SEAM_SECONDS - 0.04,
      SEAM_SECONDS - halfFadeSec - 0.005
    );
    const dip = minEnvelopeInRange(
      SEAM_SECONDS - halfFadeSec,
      SEAM_SECONDS + halfFadeSec,
      2.5
    );
    const ratio = ref > 1e-6 ? dip.minPeak / ref : 0;
    const ratioDb = ratio > 1e-6 ? 20 * Math.log10(ratio) : -Infinity;
    const tauMs = (dip.atSec - SEAM_SECONDS) * 1000;
    const rows: TestStepRow[] = [
      { label: "min / reference", value: `${ratio.toFixed(4)}  (${ratioDb.toFixed(2)} dB)` },
      { label: "dip τ (ms relative to seam)", value: `${tauMs.toFixed(2)} ms` },
      { label: "sample rate", value: `${sr2} Hz` },
    ];
    setGotByStep((prev) => ({ ...prev, [stepIndex]: rows }));
  } catch (error) {
    setGotByStep((prev) => ({
      ...prev,
      [stepIndex]: [{ label: "error", value: String(error) }],
    }));
  } finally {
    setScanning(false);
  }
}, [computedShift, openDawProject, scanning, scenario]);
```

- [ ] **Step 3: Replace the JSX — DebugLinkBar, callout, TestSteps**

Find the `return (` line inside the `App` component and replace the entire returned JSX (everything between `return (` and the matching closing `);`) with:

```tsx
return (
  <Theme appearance="dark" accentColor="green">
    <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
      <GitHubCorner />
      <BackLink />
      <DebugLinkBar
        links={[
          {
            label: "Voice-fade × clip-fade product demo",
            href: "/voice-fadein-clip-fadein-product-debug-demo.html",
            kind: "demo",
          },
          {
            label: "Shared-source double-process demo",
            href: "/shared-source-double-process-debug-demo.html",
            kind: "demo",
          },
          {
            label: "debug/voice-fadein-clip-fadein-product.md",
            href: "https://github.com/moises-ai/opendaw-test/blob/main/debug/voice-fadein-clip-fadein-product.md",
            kind: "note",
          },
        ]}
      />

      <Flex direction="column" gap="4">
        <Heading size="7" align="center">
          Target Crossfade — Pure Web Audio vs OpenDAW
        </Heading>

        <Callout.Root color="green">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            Same 40 ms linear crossfade scenario rendered three ways for direct A/B/C
            comparison. <strong>ALIGNED</strong> (pure Web Audio + phase correlation) is the
            audible target — sums to unity through the crossfade.{" "}
            <strong>UNALIGNED</strong> (pure Web Audio, no phase shift) is the control showing
            what a phase-mismatched linear crossfade sounds like. <strong>OPENDAW</strong>{" "}
            renders the same phase-corrected configuration through OpenDAW's{" "}
            <Code>TapeDeviceProcessor</Code> on two Tape tracks (one region per track, mixed at
            master); it produces a residual dip on the incoming voice's side caused by{" "}
            <Code>PitchVoice</Code> multiplying its 20 ms voice-fade-in by the region's
            clip-fade gain buffer.
          </Callout.Text>
        </Callout.Root>

        <Card>
          <Flex align="center" gap="3" wrap="wrap">
            <Text size="2" weight="bold">Status:</Text>
            <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
              {status}
            </Badge>
            {isPlaying && (
              <Badge color="amber">
                Playing:{" "}
                {scenario === "aligned"
                  ? "ALIGNED"
                  : scenario === "unaligned"
                    ? "UNALIGNED"
                    : "OPENDAW"}
              </Badge>
            )}
            <Text size="2" weight="bold">Position:</Text>
            <Badge color={inCrossfadeRegion ? "red" : isPlaying ? "amber" : "gray"} size="2">
              <Code>
                {positionSec.toFixed(3)} s
                {inCrossfadeRegion ? " ← CROSSFADE" : ""}
              </Code>
            </Badge>
            <Text size="2" color="gray">
              (seam at {SEAM_SECONDS}.000 s, crossfade ±{CROSSFADE_MS / 2} ms)
            </Text>
            <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="2">
              <StopIcon /> Stop
            </Button>
          </Flex>
        </Card>

        <TestStep
          index={1}
          title="Target: ALIGNED (pure Web Audio)"
          description={
            <>
              Phase-correlate file A's tail against file B's head, apply the integer-sample
              shift to file B's read offset, build a single AudioBuffer with a linear crossfade,
              play via AudioBufferSourceNode. Two phase-aligned identical-source signals sum to
              unity through the crossfade. <strong>Listen for:</strong> a seamless transition
              at the {SEAM_SECONDS} s seam — no dip.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => handlePlay("aligned")}
                disabled={status !== "Ready" || scanning}
                color="green"
                size="3"
              >
                <PlayIcon /> Play (ALIGNED — target)
              </Button>
              <Button
                onClick={handleScan}
                disabled={status !== "Ready" || scanning || scenario !== "aligned"}
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan ALIGNED"}
              </Button>
            </>
          }
          expected={[
            { label: "min / reference", value: "≈ 0.9998  (−0.00 dB)" },
            { label: "dip τ (ms relative to seam)", value: "n/a (no dip)" },
            { label: "sample rate", value: `${audioContextRef.current?.sampleRate ?? "—"} Hz` },
          ]}
          got={gotByStep[1] ?? null}
        />

        <TestStep
          index={2}
          title="Control: UNALIGNED (shift = 0)"
          description={
            <>
              Identical setup to step 1 except <Code>shift = 0</Code>. Phase mismatch through
              the crossfade produces a sub-unity sum. <strong>Listen for:</strong> an obvious
              dip centred mid-crossfade — confirms the scan correctly detects a dip when one
              exists.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => handlePlay("unaligned")}
                disabled={status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (UNALIGNED — control)
              </Button>
              <Button
                onClick={handleScan}
                disabled={status !== "Ready" || scanning || scenario !== "unaligned"}
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan UNALIGNED"}
              </Button>
            </>
          }
          expected={[
            { label: "min / reference", value: "≈ 0.5906  (−4.57 dB)" },
            { label: "dip τ (ms relative to seam)", value: "near 0 ms (centred on seam)" },
            { label: "sample rate", value: `${audioContextRef.current?.sampleRate ?? "—"} Hz` },
          ]}
          got={gotByStep[2] ?? null}
        />

        <TestStep
          index={3}
          title="OPENDAW: the artifact"
          description={
            <>
              Same phase-corrected configuration as ALIGNED but rendered through OpenDAW's{" "}
              <Code>TapeDeviceProcessor</Code> on two Tape tracks. <strong>Listen for:</strong>{" "}
              a subtler dip on the incoming voice's side, ~10 ms <em>before</em> the seam —
              smaller than UNALIGNED's obvious dip but bigger than ALIGNED's zero. Mechanism:{" "}
              <Code>PitchVoice</Code> multiplies its 20 ms voice-fade-in by the region's
              clip-fade gain, turning the first 20 ms of a linear fade-in into a quadratic
              ramp.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => handlePlay("opendaw")}
                disabled={status !== "Ready" || scanning || !openDawProject}
                color="ruby"
                size="3"
              >
                <PlayIcon /> Play (OPENDAW)
              </Button>
              <Button
                onClick={handleScan}
                disabled={status !== "Ready" || scanning || scenario !== "opendaw"}
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan OPENDAW"}
              </Button>
            </>
          }
          expected={[
            { label: "min / reference", value: "≈ 0.8352  (−1.56 dB)" },
            { label: "dip τ (ms relative to seam)", value: "≈ −7.5 ms (before seam)" },
            { label: "sample rate", value: `${audioContextRef.current?.sampleRate ?? "—"} Hz` },
          ]}
          got={gotByStep[3] ?? null}
        />

        <Card>
          <Flex direction="column" gap="3">
            <Text size="3" weight="bold">Phase correlation</Text>
            <Separator size="4" />
            {computedShift ? (
              <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
                {[
                  `window         : ${(WINDOW_SEC * 1000).toFixed(1)} ms (${(HALF_WINDOW_SEC * 1000).toFixed(1)} ms either side of seam)`,
                  `search range   : ±${(MAX_SHIFT_SEC * 1000).toFixed(1)} ms`,
                  `shift found    : ${computedShift.samples} samples (${((computedShift.samples / (audioContextRef.current?.sampleRate ?? 48000)) * 1000).toFixed(4)} ms)`,
                  `score          : ${computedShift.score.toFixed(6)}  (1.0 = perfect alignment)`,
                ].join("\n")}
              </Code>
            ) : (
              <Text size="2" color="gray">Awaiting audio load…</Text>
            )}
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="2">
            <Text size="3" weight="bold">Configuration</Text>
            <Separator size="4" />
            <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
              {`File A:              test-440hz.wav (${TOTAL_DURATION_SECONDS} s, 440 Hz sine)
File B:              test-440hz-offset30.wav (B delayed ~0.680 ms / ~24° at 440 Hz)
ALIGNED engine:      pure Web Audio (AudioBufferSourceNode → destination)
UNALIGNED engine:    pure Web Audio (shift = 0)
OPENDAW engine:      OpenDAW TapeDeviceProcessor (2 Tape tracks, 1 AudioRegionBox each)
Seam:                ${SEAM_SECONDS} s
Crossfade:           ${CROSSFADE_MS} ms linear (equal-gain), symmetric around seam
Phase window:        ${WINDOW_SEC * 1000} ms straddling the seam
Search range:        ±${MAX_SHIFT_SEC * 1000} ms
Playback start:      ${PLAYBACK_START_SECONDS} s`}
            </Code>
          </Flex>
        </Card>
      </Flex>

      <MoisesLogo />
    </Container>
  </Theme>
);
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: completes with no TypeScript errors. The unused `ScanResult` interface and `scanResult`/`setScanResult` references are gone; no compiler complaints.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`
Open: `https://localhost:5173/pure-webaudio-target-debug-demo.html`
Confirm:
1. The link bar shows "See also: ▶ Voice-fade × clip-fade product demo  ▶ Shared-source double-process demo  📄 debug/voice-fadein-clip-fadein-product.md" above the heading.
2. Three numbered `TestStep` cards render in order with their action buttons.
3. Click step 1's Play (ALIGNED) → wait ~2 s for the crossfade → click Scan ALIGNED. The "Got" column for step 1 populates with a `min / reference` value close to `≈ 0.9998` (within ±0.001 is fine across machines).
4. Click Stop. Step 2 Play (UNALIGNED) → Scan UNALIGNED. Got ≈ 0.5906 ±0.01.
5. Step 3 Play (OPENDAW) → Scan OPENDAW. Got ≈ 0.8352 ±0.05, τ ≈ −7.5 ms ±2 ms.

Quit `npm run dev` (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/demos/playback/pure-webaudio-target-debug-demo.tsx
git commit -m "feat(debug): guided test script for pure-webaudio-target demo

Restructure the page around three numbered TestStep cards (ALIGNED /
UNALIGNED / OPENDAW), each with action buttons and an Expected vs Got
table. Add a DebugLinkBar at the top for cross-navigation to sibling
demos and the underlying debug/*.md note. Refactor handleScan to emit
structured per-step results instead of a single multi-line string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Refactor `shared-source-double-process-debug-demo.tsx`

This page already uses touching (non-overlapping) regions, so the engine code stays untouched. Changes are UI-only: add `DebugLinkBar`, rewrite the top callout, replace the "Reproduce" card and the "Seam position" card with four `<TestStep>` cards that interleave seam toggles with scenario plays, and refactor `handleScan` to write structured per-step results.

**Files:**
- Modify: `src/demos/playback/shared-source-double-process-debug-demo.tsx`

- [ ] **Step 1: Add component imports and step-result state**

After the existing imports, add:

```tsx
import { TestStep, TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
```

Inside the `App` component, replace the line `const [scanResult, setScanResult] = useState<string | null>(null);` with:

```tsx
const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
```

- [ ] **Step 2: Refactor `handleScan` to emit structured per-step results**

Replace the entire `handleScan` useCallback (around lines 321–380) with:

```tsx
const handleScan = useCallback(async () => {
  if (!project || scanning) return;
  if (project.engine.isPlaying.getValue()) project.engine.stop(true);
  const stepIndex =
    seamPosition === "block-aligned"
      ? scenario === "shared"
        ? 1
        : 2
      : scenario === "shared"
        ? 3
        : 4;
  setScanning(true);
  setGotByStep((prev) => {
    const next = { ...prev };
    delete next[stepIndex];
    return next;
  });
  try {
    const sliceStart = seamSeconds - 0.1;
    const sliceEnd = seamSeconds + 0.1;
    const { channels, sampleRate: sr } = await renderOfflineSlice(
      project,
      sliceStart,
      sliceEnd
    );
    const left = channels[0];
    const preDelta = maxDeltaInWindow(
      left,
      sliceStart,
      seamSeconds - 0.05,
      seamSeconds - 0.02,
      sr
    );
    const seamDelta = maxDeltaInWindow(
      left,
      sliceStart,
      seamSeconds - 0.005,
      seamSeconds + 0.005,
      sr
    );
    const preWindow = peakInWindow(
      left,
      sliceStart,
      seamSeconds - 0.05,
      seamSeconds - 0.02,
      sr
    );
    const expectedDelta = (2 * Math.PI * 440 * 0.5) / sr;
    const deltaRatio =
      preDelta.maxDelta > 1e-9 ? seamDelta.maxDelta / preDelta.maxDelta : 0;
    const jumpTauMs =
      (sliceStart + seamDelta.atSecondsFromStart - seamSeconds) * 1000;
    const offsetInBlock = inBlockOffsetSamples(seamSeconds, sr);
    const rows: TestStepRow[] = [
      { label: "pre-seam peak", value: preWindow.peak.toFixed(4) },
      {
        label: "expected clean max |Δ| (= 2π·440·0.5/SR)",
        value: expectedDelta.toFixed(5),
      },
      { label: "seam-band max |Δ|", value: seamDelta.maxDelta.toFixed(5) },
      { label: "seam-Δ / pre-Δ", value: deltaRatio.toFixed(2) },
      { label: "largest jump τ (ms relative to seam)", value: `${jumpTauMs.toFixed(3)} ms` },
      {
        label: "seam in-block offset (samples / 128 at SR)",
        value: `${offsetInBlock} / ${RENDER_QUANTUM} at SR ${sr}`,
      },
    ];
    setGotByStep((prev) => ({ ...prev, [stepIndex]: rows }));
  } catch (error) {
    setGotByStep((prev) => ({
      ...prev,
      [stepIndex]: [{ label: "error", value: String(error) }],
    }));
  } finally {
    setScanning(false);
  }
}, [project, scanning, seamPosition, scenario, seamSeconds]);
```

- [ ] **Step 3: Replace the JSX — DebugLinkBar, callout, four TestSteps**

Find the `return (` line in `App` and replace the entire returned JSX with:

```tsx
return (
  <Theme appearance="dark" accentColor="amber">
    <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
      <GitHubCorner />
      <BackLink />
      <DebugLinkBar
        links={[
          {
            label: "Voice-fade × clip-fade product demo",
            href: "/voice-fadein-clip-fadein-product-debug-demo.html",
            kind: "demo",
          },
          {
            label: "Pure-Web-Audio target demo",
            href: "/pure-webaudio-target-debug-demo.html",
            kind: "demo",
          },
          {
            label: "debug/shared-source-double-process.md",
            href: "https://github.com/moises-ai/opendaw-test/blob/main/debug/shared-source-double-process.md",
            kind: "note",
          },
        ]}
      />

      <Flex direction="column" gap="4">
        <Heading size="7" align="center">
          Touching-Seam Sample Discontinuity
        </Heading>

        <Callout.Root color="blue">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            Two adjacent same-track regions touching at a seam produce a sample-level
            discontinuity 2 samples before the seam, where <Code>max |Δsample|</Code> measures
            ≈ 2× the clean-sine baseline of <Code>2π·440·0.5/SR</Code>. The discontinuity is
            independent of mediaId (SHARED vs DISTINCT <Code>AudioFileBox</Code>) AND
            independent of where the seam falls within the 128-sample render quantum — all four
            scenarios below produce bit-identical offline output. Live playback sometimes sounds
            different across seam positions; the offline scan does not reproduce that.
            Mechanism: open.
          </Callout.Text>
        </Callout.Root>

        <Card>
          <Flex align="center" gap="3" wrap="wrap">
            <Text size="2" weight="bold">Status:</Text>
            <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
              {status}
            </Badge>
            {isPlaying && (
              <Badge color="amber">
                Playing: {scenario === "shared" ? "SHARED" : "DISTINCT"}
              </Badge>
            )}
            <Badge color={seamPosition === "block-aligned" ? "green" : "amber"}>
              Seam: {seamPosition === "block-aligned" ? "block-aligned" : "off-boundary"}
            </Badge>
            <Text size="2" weight="bold">Position:</Text>
            <Badge color={atSeam ? "red" : isPlaying ? "amber" : "gray"} size="2">
              <Code>
                {positionSec.toFixed(3)} s
                {atSeam ? " ← SEAM" : ""}
              </Code>
            </Badge>
            <Text size="2" color="gray">
              (seam at {seamSeconds.toFixed(3)} s, offset{" "}
              {audioContext ? inBlockOffsetSamples(seamSeconds, audioContext.sampleRate) : "—"}/
              {RENDER_QUANTUM} samples into block at SR {audioContext?.sampleRate ?? "—"} Hz)
            </Text>
            <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="2">
              <StopIcon /> Stop
            </Button>
          </Flex>
        </Card>

        <TestStep
          index={1}
          title="Block-aligned seam + SHARED AudioFileBox"
          description={
            <>
              Seam at 30.000 s (PPQN 57600 at BPM 120 — block-aligned at 48 kHz; at other rates
              see the in-block offset in the status row). Both regions reference one
              <Code>AudioFileBox</Code>. <strong>Listen for:</strong> a barely-audible snap at
              the seam; peak amplitude is unchanged.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => applySeamPosition("block-aligned")}
                disabled={!project || status !== "Ready" || scanning}
                variant={seamPosition === "block-aligned" ? "solid" : "outline"}
                color="green"
                size="3"
              >
                Set seam: 30.000 s (block-aligned)
              </Button>
              <Button
                onClick={() => applyScenarioAndPlay("shared")}
                disabled={!project || status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (SHARED file)
              </Button>
              <Button
                onClick={handleScan}
                disabled={
                  !project ||
                  status !== "Ready" ||
                  scanning ||
                  seamPosition !== "block-aligned" ||
                  scenario !== "shared"
                }
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan step 1"}
              </Button>
            </>
          }
          expected={[
            { label: "pre-seam peak", value: "≈ 0.5000" },
            { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
            { label: "seam-band max |Δ|", value: "≈ 0.05747" },
            { label: "seam-Δ / pre-Δ", value: "≈ 1.99 (~2× clean baseline)" },
            { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms (2 samples before seam)" },
            { label: "seam in-block offset (samples / 128 at SR)", value: "0 / 128 at SR 48000" },
          ]}
          got={gotByStep[1] ?? null}
        />

        <TestStep
          index={2}
          title="Block-aligned seam + DISTINCT AudioFileBoxes"
          description={
            <>
              Same seam, two <Code>AudioFileBox</Code>es with identical on-disk content (rules
              out the shared-voice mechanism — voices are keyed per region, so SHARED and
              DISTINCT yield independent voices either way). <strong>Listen for:</strong> the
              same snap as step 1.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => applyScenarioAndPlay("distinct")}
                disabled={!project || status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (DISTINCT files)
              </Button>
              <Button
                onClick={handleScan}
                disabled={
                  !project ||
                  status !== "Ready" ||
                  scanning ||
                  seamPosition !== "block-aligned" ||
                  scenario !== "distinct"
                }
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan step 2"}
              </Button>
            </>
          }
          expected={[
            { label: "pre-seam peak", value: "≈ 0.5000" },
            { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
            { label: "seam-band max |Δ|", value: "≈ 0.05747" },
            { label: "seam-Δ / pre-Δ", value: "≈ 1.99 (bit-identical to step 1)" },
            { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms" },
            { label: "seam in-block offset (samples / 128 at SR)", value: "0 / 128 at SR 48000" },
          ]}
          got={gotByStep[2] ?? null}
        />

        <TestStep
          index={3}
          title="Off-boundary seam + SHARED AudioFileBox"
          description={
            <>
              Seam moved to 30.500 s (PPQN 58560 at BPM 120 — 64 samples into a block at 48 kHz).
              Both regions reference one <Code>AudioFileBox</Code>.{" "}
              <strong>Listen for:</strong> live, the off-boundary snap sometimes sounds louder
              than block-aligned (subjective). Offline scan: same numbers.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => applySeamPosition("off-boundary")}
                disabled={!project || status !== "Ready" || scanning}
                variant={seamPosition === "off-boundary" ? "solid" : "outline"}
                color="amber"
                size="3"
              >
                Set seam: 30.500 s (off-boundary)
              </Button>
              <Button
                onClick={() => applyScenarioAndPlay("shared")}
                disabled={!project || status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (SHARED file)
              </Button>
              <Button
                onClick={handleScan}
                disabled={
                  !project ||
                  status !== "Ready" ||
                  scanning ||
                  seamPosition !== "off-boundary" ||
                  scenario !== "shared"
                }
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan step 3"}
              </Button>
            </>
          }
          expected={[
            { label: "pre-seam peak", value: "≈ 0.5000" },
            { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
            { label: "seam-band max |Δ|", value: "≈ 0.05747 (same as block-aligned offline)" },
            { label: "seam-Δ / pre-Δ", value: "≈ 1.99" },
            { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms" },
            { label: "seam in-block offset (samples / 128 at SR)", value: "64 / 128 at SR 48000" },
          ]}
          got={gotByStep[3] ?? null}
        />

        <TestStep
          index={4}
          title="Off-boundary seam + DISTINCT (confirms all four equivalent)"
          description={
            <>
              Same off-boundary seam, two distinct <Code>AudioFileBox</Code>es. Closes the 2×2
              matrix — all four offline scans return bit-identical numbers, confirming the
              artifact is independent of both mediaId and seam-position-in-block.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => applyScenarioAndPlay("distinct")}
                disabled={!project || status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (DISTINCT files)
              </Button>
              <Button
                onClick={handleScan}
                disabled={
                  !project ||
                  status !== "Ready" ||
                  scanning ||
                  seamPosition !== "off-boundary" ||
                  scenario !== "distinct"
                }
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan step 4"}
              </Button>
            </>
          }
          expected={[
            { label: "pre-seam peak", value: "≈ 0.5000" },
            { label: "expected clean max |Δ| (= 2π·440·0.5/SR)", value: "≈ 0.02880 at SR 48000" },
            { label: "seam-band max |Δ|", value: "≈ 0.05747" },
            { label: "seam-Δ / pre-Δ", value: "≈ 1.99 (bit-identical to steps 1–3)" },
            { label: "largest jump τ (ms relative to seam)", value: "≈ −0.042 ms" },
            { label: "seam in-block offset (samples / 128 at SR)", value: "64 / 128 at SR 48000" },
          ]}
          got={gotByStep[4] ?? null}
        />

        <Card>
          <Flex direction="column" gap="2">
            <Text size="3" weight="bold">Configuration</Text>
            <Separator size="4" />
            <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
              {`BPM:                 ${BPM}
File:                test-440hz.wav (${TOTAL_DURATION_SECONDS} s, 440 Hz sine)
AudioContext SR:     ${audioContext?.sampleRate ?? "—"} Hz
Render quantum:      ${RENDER_QUANTUM} samples
Region A:            position=0,  duration=seam, loopOffset=0
Region B:            position=seam, duration=eof−seam, loopOffset=seam
Fades:               in=0, out=0 (touching seam, no crossfade)
SHARED:              A.file === B.file (one AudioFileBox)
DISTINCT:            A.file !== B.file (two AudioFileBoxes, same content)
Playback start:      ${PLAYBACK_START_SECONDS} s (≈2 s before seam)
Seam (current):      ${seamSeconds.toFixed(3)} s (${seamPosition}, PPQN ${seamSeconds * BPM * 16}, offset ${audioContext ? inBlockOffsetSamples(seamSeconds, audioContext.sampleRate) : "—"}/${RENDER_QUANTUM} in block)`}
            </Code>
          </Flex>
        </Card>
      </Flex>

      <MoisesLogo />
    </Container>
  </Theme>
);
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: completes with no TypeScript errors. The unused `setScanResult` / `scanResult` symbols are gone.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`
Open: `https://localhost:5173/shared-source-double-process-debug-demo.html`
Confirm:
1. Link bar present at the top with two demo links and one note link.
2. Status card shows seam badge, position readout, and a Stop button.
3. Four numbered TestStep cards. Each step's Scan button only enables when both the seam toggle and the play scenario match that step.
4. Walk steps 1→2→3→4 in order. After each Scan, the Got column populates with numbers close to Expected (`seam-Δ / pre-Δ` should be ≈ 1.99 ±0.05; `largest jump τ` ≈ −0.042 ms ±0.005 ms; in-block offset reflects the live SR).
5. The numbers across steps 1–4 should agree to floating-point precision (bit-identical offline output is the point).

Quit `npm run dev`.

- [ ] **Step 6: Commit**

```bash
git add src/demos/playback/shared-source-double-process-debug-demo.tsx
git commit -m "feat(debug): guided test script for shared-source-double-process demo

Replace the seam-position + scenario card pair with a 2×2 matrix of
numbered TestStep cards (block-aligned × SHARED/DISTINCT, off-boundary
× SHARED/DISTINCT). Each step's Scan button enables only when the
seam toggle and scenario match that step. Add DebugLinkBar at the top
and refactor handleScan to emit structured per-step results.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Refactor `voice-fadein-clip-fadein-product-debug-demo.tsx` (engine + UI)

This is the biggest change. Two parts: (a) switch the engine setup from a single Tape track (overlapping regions, deleted by `project.copy()`) to **two** Tape tracks with one region each (same as the Target page's OPENDAW scenario), so the offline scan actually measures the dip; (b) UI restructure to numbered TestSteps with linkbar.

**Files:**
- Modify: `src/demos/playback/voice-fadein-clip-fadein-product-debug-demo.tsx`

- [ ] **Step 1: Add component imports and step-result state**

After the existing imports, add:

```tsx
import { TestStep, TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
```

Inside `App`, replace `const [scanResult, setScanResult] = useState<string | null>(null);` with:

```tsx
const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
```

- [ ] **Step 2: Switch engine setup to two Tape tracks**

The current `useEffect` setup creates ONE Tape track and places both regions on it. Change it to create TWO Tape tracks (one region per track). In the existing `newProject.editing.modify(() => { ... })` block inside the setup `useEffect` (the one that calls `newProject.api.createInstrument(InstrumentFactories.Tape)`), replace the entire block with:

```tsx
let trackBoxA: { regions: unknown };
let trackBoxB: { regions: unknown };
newProject.editing.modify(() => {
  trackBoxA = newProject.api.createInstrument(InstrumentFactories.Tape)
    .trackBox as { regions: unknown };
});
newProject.editing.modify(() => {
  trackBoxB = newProject.api.createInstrument(InstrumentFactories.Tape)
    .trackBox as { regions: unknown };
});
newProject.editing.modify(() => {
  const fileBoxA = AudioFileBox.create(newProject.boxGraph, uuidA, (box) => {
    box.fileName.setValue("test-440hz.wav");
    box.endInSeconds.setValue(bufferA.duration);
  });
  const fileBoxB = AudioFileBox.create(newProject.boxGraph, uuidB, (box) => {
    box.fileName.setValue("test-440hz-offset30.wav");
    box.endInSeconds.setValue(bufferB.duration);
  });

  const eventsA = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
  const regionA = AudioRegionBox.create(
    newProject.boxGraph,
    UUID.generate(),
    (box) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      box.regions.refer((trackBoxA as any).regions);
      box.file.refer(fileBoxA);
      box.events.refer(eventsA.owners);
      box.position.setValue(0);
      box.duration.setValue(seamPPQN);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(fullDurationPPQN);
      box.label.setValue("A (file A)");
      box.mute.setValue(false);
      box.fading.in.setValue(0);
      box.fading.out.setValue(0);
      box.fading.inSlope.setValue(0.5);
      box.fading.outSlope.setValue(0.5);
    }
  );
  const eventsB = ValueEventCollectionBox.create(newProject.boxGraph, UUID.generate());
  const regionB = AudioRegionBox.create(
    newProject.boxGraph,
    UUID.generate(),
    (box) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      box.regions.refer((trackBoxB as any).regions);
      box.file.refer(fileBoxB);
      box.events.refer(eventsB.owners);
      box.position.setValue(seamPPQN);
      box.duration.setValue(fullDurationPPQN - seamPPQN);
      box.loopOffset.setValue(seamPlusOffsetPPQN);
      box.loopDuration.setValue(fullDurationPPQN);
      box.label.setValue("B (file B, loopOffset −30 samples)");
      box.mute.setValue(false);
      box.fading.in.setValue(0);
      box.fading.out.setValue(0);
      box.fading.inSlope.setValue(0.5);
      box.fading.outSlope.setValue(0.5);
    }
  );

  regionsRef.current = { a: regionA, b: regionB };

  newProject.timelineBox.loopArea.enabled.setValue(false);
  newProject.timelineBox.loopArea.from.setValue(0);
  newProject.timelineBox.loopArea.to.setValue(fullDurationPPQN);
});
```

The CROSSFADE/HARD-CUT toggle in `applyScenarioAndPlay` still adjusts `position`, `duration`, `loopOffset`, `fading.in`, and `fading.out` on the same two `AudioRegionBox`es — and now the 40 ms timeline overlap between the two regions is on different tracks, so the per-track no-overlap invariant doesn't fire.

- [ ] **Step 3: Refactor `handleScan` to emit structured per-step results**

The CROSSFADE scenario now renders properly (no project.copy() deletion). Replace the existing `handleScan` useCallback with:

```tsx
const handleScan = useCallback(async () => {
  if (!project || scanning) return;
  if (project.engine.isPlaying.getValue()) project.engine.stop(true);
  const stepIndex = scenario === "hardcut" ? 1 : 3;
  setScanning(true);
  setGotByStep((prev) => {
    const next = { ...prev };
    delete next[stepIndex];
    return next;
  });
  try {
    const sliceStart = SEAM_SECONDS - 0.1;
    const sliceEnd = SEAM_SECONDS + 0.1;
    const { channels, sampleRate: sr } = await renderOfflineSlice(
      project,
      sliceStart,
      sliceEnd
    );
    const left = channels[0];
    const halfFadeSec = CROSSFADE_MS / 2000;
    const refWindow = peakInWindow(
      left,
      sliceStart,
      SEAM_SECONDS - 0.08,
      SEAM_SECONDS - halfFadeSec - 0.005,
      sr
    );
    const dip = minEnvelopeInWindow(
      left,
      sliceStart,
      SEAM_SECONDS - halfFadeSec,
      SEAM_SECONDS + halfFadeSec,
      sr,
      2.5
    );
    const ratio = refWindow.peak > 1e-6 ? dip.minPeak / refWindow.peak : 0;
    const dipDb = ratio > 1e-6 ? 20 * Math.log10(ratio) : -Infinity;
    const tauMs = (sliceStart + dip.atSecondsFromStart - SEAM_SECONDS) * 1000;
    const rows: TestStepRow[] = [
      { label: "reference peak", value: refWindow.peak.toFixed(4) },
      { label: "min envelope peak", value: dip.minPeak.toFixed(4) },
      {
        label: "min / reference",
        value: `${ratio.toFixed(4)}  (${dipDb.toFixed(2)} dB)`,
      },
      { label: "dip τ (ms relative to seam)", value: `${tauMs.toFixed(2)} ms` },
      { label: "sample rate", value: `${sr} Hz` },
    ];
    setGotByStep((prev) => ({ ...prev, [stepIndex]: rows }));
  } catch (error) {
    setGotByStep((prev) => ({
      ...prev,
      [stepIndex]: [{ label: "error", value: String(error) }],
    }));
  } finally {
    setScanning(false);
  }
}, [project, scanning, scenario]);
```

(Step 2 — CROSSFADE live audio — has no scan, so it has no Got rows; the user just listens.)

- [ ] **Step 4: Replace the JSX — DebugLinkBar, callout, three TestSteps**

Replace the entire returned JSX (everything inside `return (` ... `);` in the `App` component) with:

```tsx
return (
  <Theme appearance="dark" accentColor="amber">
    <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
      <GitHubCorner />
      <BackLink />
      <DebugLinkBar
        links={[
          {
            label: "Pure-Web-Audio target demo",
            href: "/pure-webaudio-target-debug-demo.html",
            kind: "demo",
          },
          {
            label: "Shared-source double-process demo",
            href: "/shared-source-double-process-debug-demo.html",
            kind: "demo",
          },
          {
            label: "debug/voice-fadein-clip-fadein-product.md",
            href: "https://github.com/moises-ai/opendaw-test/blob/main/debug/voice-fadein-clip-fadein-product.md",
            kind: "note",
          },
        ]}
      />

      <Flex direction="column" gap="4">
        <Heading size="7" align="center">
          Voice-Fade × Clip-Fade Product
        </Heading>

        <Callout.Root color="blue">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            A 40 ms linear clip crossfade between two regions with different{" "}
            <Code>sourceUuid</Code>s — placed on <strong>separate</strong> Tape tracks so the
            mix happens at the master (overlapping regions on a single track are disallowed by
            design and get deleted by <Code>project.copy()</Code>) — produces a measurable dip
            on the incoming voice's fade-in side. Cause: <Code>PitchVoice</Code> starts every
            new voice in <Code>Fading</Code>/<Code>fadeDirection=1</Code> for{" "}
            <Code>VOICE_FADE_DURATION</Code> (20 ms), and <Code>process()</Code> multiplies
            that voice-fade by the region's clip-fade gain buffer — turning a linear clip
            fade-in into a quadratic ramp over the first 20 ms.
          </Callout.Text>
        </Callout.Root>

        <Card>
          <Flex align="center" gap="3" wrap="wrap">
            <Text size="2" weight="bold">Status:</Text>
            <Badge color={status.includes("Error") ? "red" : status === "Ready" ? "green" : "blue"}>
              {status}
            </Badge>
            {isPlaying && (
              <Badge color="amber">
                Playing: {scenario === "crossfade" ? "CROSSFADE" : "HARD-CUT"}
              </Badge>
            )}
            <Text size="2" weight="bold">Position:</Text>
            <Badge color={inCrossfadeRegion ? "red" : isPlaying ? "amber" : "gray"} size="2">
              <Code>
                {positionSec.toFixed(3)} s
                {inCrossfadeRegion ? " ← CROSSFADE" : ""}
              </Code>
            </Badge>
            <Text size="2" color="gray">
              (seam at {SEAM_SECONDS}.000 s, crossfade ±{CROSSFADE_MS / 2} ms)
            </Text>
            <Button onClick={handleStop} disabled={!isPlaying} variant="soft" size="2">
              <StopIcon /> Stop
            </Button>
          </Flex>
        </Card>

        <TestStep
          index={1}
          title="Baseline: HARD-CUT (no clip fades, regions touch)"
          description={
            <>
              Regions touch at the seam, no <Code>fading.in</Code> / <Code>fading.out</Code>.
              OpenDAW's per-voice 20 ms fade (<Code>VOICE_FADE_DURATION</Code>) handles click
              prevention on its own. <strong>Listen for:</strong> a clean transition at the
              {" "}{SEAM_SECONDS} s seam.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => applyScenarioAndPlay("hardcut")}
                disabled={!project || status !== "Ready" || scanning}
                color="amber"
                size="3"
              >
                <PlayIcon /> Play (HARD-CUT)
              </Button>
              <Button
                onClick={handleScan}
                disabled={!project || status !== "Ready" || scanning || scenario !== "hardcut"}
                variant="soft"
                color="amber"
                size="3"
              >
                <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan HARD-CUT"}
              </Button>
            </>
          }
          expected={[
            { label: "reference peak", value: "≈ 0.5000" },
            { label: "min envelope peak", value: "≈ 0.5000 (no dip)" },
            { label: "min / reference", value: "≈ 1.0000  (−0.00 dB)" },
            { label: "dip τ (ms relative to seam)", value: "n/a (no dip)" },
            { label: "sample rate", value: `${audioContext?.sampleRate ?? "—"} Hz` },
          ]}
          got={gotByStep[1] ?? null}
        />

        <TestStep
          index={2}
          title="CROSSFADE — live listening test"
          description={
            <>
              40 ms linear clip crossfade (slope 0.5), regions extended symmetrically across
              the seam on their separate tracks. <strong>Listen for:</strong> an amplitude dip
              ~10 ms BEFORE the {SEAM_SECONDS} s seam — subtle on this sustained tone but
              audible. The dip happens because the new voice's <em>voice-fade-in</em> and the
              region's <em>clip-fade-in</em> multiply over the first 20 ms.
            </>
          }
          actions={
            <Button
              onClick={() => applyScenarioAndPlay("crossfade")}
              disabled={!project || status !== "Ready" || scanning}
              color="amber"
              size="3"
            >
              <PlayIcon /> Play (CROSSFADE)
            </Button>
          }
          expected={[]}
          got={null}
        />

        <TestStep
          index={3}
          title="CROSSFADE — offline scan measures the dip"
          description={
            <>
              With CROSSFADE active and playback stopped, click <strong>Scan CROSSFADE</strong>{" "}
              to render the seam ±100 ms slice offline and locate the minimum envelope peak
              across the crossfade window. The Target page's OPENDAW scenario (same engine
              configuration) measures <Code>min / reference ≈ 0.8352</Code> (−1.56 dB) at{" "}
              <Code>τ ≈ −7.5 ms</Code> — this page should match.
            </>
          }
          actions={
            <Button
              onClick={handleScan}
              disabled={!project || status !== "Ready" || scanning || scenario !== "crossfade"}
              variant="soft"
              color="amber"
              size="3"
            >
              <ActivityLogIcon /> {scanning ? "Scanning…" : "Scan CROSSFADE"}
            </Button>
          }
          expected={[
            { label: "reference peak", value: "≈ 0.5000" },
            { label: "min envelope peak", value: "≈ 0.418 (dipped)" },
            { label: "min / reference", value: "≈ 0.8352  (−1.56 dB)" },
            { label: "dip τ (ms relative to seam)", value: "≈ −7.5 ms (before seam)" },
            { label: "sample rate", value: `${audioContext?.sampleRate ?? "—"} Hz` },
          ]}
          got={gotByStep[3] ?? null}
        />

        <Card>
          <Flex direction="column" gap="2">
            <Text size="3" weight="bold">Configuration</Text>
            <Separator size="4" />
            <Code size="2" style={{ whiteSpace: "pre-wrap", display: "block", padding: 12 }}>
              {`BPM:                 ${BPM}
File A:              test-440hz.wav
File B:              test-440hz-offset30.wav (delayed by ${(SOURCE_OFFSET_SECONDS * 1000).toFixed(3)} ms = ~24° at 440 Hz; preserved through any decode resample)
Track layout:        2 Tape tracks, 1 AudioRegionBox each (mix at master)
Region A:            position=0, duration=${SEAM_SECONDS}s (+20ms in CROSSFADE)
Region B:            position=${SEAM_SECONDS}s (−20ms in CROSSFADE), loopOffset compensates source delay
Crossfade duration:  ${CROSSFADE_MS} ms (slope 0.5 linear, both sides)
CROSSFADE:           fading.out on A = ${CROSSFADE_MS} ms, fading.in on B = ${CROSSFADE_MS} ms
HARD-CUT:            fading.out=0, fading.in=0 (regions touch, voice-fade handles boundary)
Playback start:      ${PLAYBACK_START_SECONDS} s (≈2 s before seam)
Seam:                ${SEAM_SECONDS} s`}
            </Code>
          </Flex>
        </Card>
      </Flex>

      <MoisesLogo />
    </Container>
  </Theme>
);
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`
Open: `https://localhost:5173/voice-fadein-clip-fadein-product-debug-demo.html`
Confirm:
1. Link bar present; three TestStep cards render.
2. Step 1 Play (HARD-CUT) → Scan HARD-CUT. Got `min / reference ≈ 1.0000` ±0.0005.
3. Step 2 Play (CROSSFADE) → listen for the dip ~10 ms before the seam. (No scan in this step.)
4. Step 3 Scan CROSSFADE (without re-clicking Play — scenario is already set to crossfade from step 2). Got `min / reference ≈ 0.8352` ±0.05, τ ≈ −7.5 ms ±2 ms.
5. The console should NOT log "Overlapping regions" / "Deleting 2 invalid boxes" during the CROSSFADE scan (since regions now live on separate tracks).

Quit `npm run dev`.

- [ ] **Step 7: Commit**

```bash
git add src/demos/playback/voice-fadein-clip-fadein-product-debug-demo.tsx
git commit -m "feat(debug): two tracks + guided test script for voice-fade product demo

Switch engine setup from one Tape track (overlapping regions deleted by
project.copy()) to two Tape tracks (one region each, mix at master) so
the offline scan measures the predicted -1.56 dB dip instead of
returning silence. Andre confirmed 2026-05-21 that overlap on a single
track is disallowed by design; the demo now uses the supported pattern.

UI: replace the Reproduce card with three numbered TestStep cards
(HARD-CUT baseline, CROSSFADE live listen, CROSSFADE scan), add a
DebugLinkBar at the top, and refactor handleScan to emit structured
per-step results.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: End-to-end manual verification + final build

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: completes cleanly, both Vite and VitePress phases succeed.

- [ ] **Step 2: Cross-demo navigation check**

Run: `npm run dev`
Open all three demos in turn and verify each link bar:
- `voice-fadein-clip-fadein-product-debug-demo.html` → links land on `pure-webaudio-target-debug-demo.html` and `shared-source-double-process-debug-demo.html`.
- `pure-webaudio-target-debug-demo.html` → links land on the voice-fade and shared-source pages.
- `shared-source-double-process-debug-demo.html` → links land on the voice-fade and target pages.
- Each note (📄) link opens GitHub in a new tab.

Quit `npm run dev`.

- [ ] **Step 3: Push branch and open PR**

Pause here. The plan is complete; opening the PR is the user's call (they may want to walk through the demos manually first, or coordinate the email to Andre).

Suggested PR title: `debug: guided test scripts for three 440 Hz-fixture debug demos`

Suggested PR body summary points:
- Adds `<TestStep>` and `<DebugLinkBar>` shared components.
- Restructures three demos around numbered TestSteps with Expected vs Got tables.
- Switches `voice-fadein-clip-fadein-product` to a two-track engine setup (Andre confirmed 2026-05-21 that same-track overlap is disallowed by design) so the offline scan measures the −1.56 dB dip instead of returning silence.
- Resolves the open question in `debug/project-copy-deletes-overlapping-regions.md`.

---

## Self-review

**Spec coverage:** Spec's per-page step list maps 1:1 to Tasks 3–5. The two new components map to Tasks 1–2. The spec's verification plan is covered by per-task smoke checks plus Task 6.

**Placeholder scan:** No "TBD" / "implement later" / "add appropriate error handling" — every step has concrete code or commands.

**Type consistency:** `TestStepRow` (defined Task 1) is the same type imported in Tasks 3, 4, 5. `DebugLink.kind` is `"demo" | "note"` everywhere it appears. `gotByStep` is the same `Record<number, TestStepRow[]>` shape across the three pages.

**Out-of-scope respected:** No edits to offline scan math (`src/lib/offlineScan.ts`), audio fixtures, or other debug pages.
