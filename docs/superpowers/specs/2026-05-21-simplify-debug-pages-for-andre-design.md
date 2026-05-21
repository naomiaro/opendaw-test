---
date: 2026-05-21
status: draft
---

# Simplify debug pages for Andre

## Why

Andre asked: "If possible, can you update the HTML pages with instructions (1,2,3,...) on what to test and what you expected versus what you got? Right now, I am randomly pressing buttons, but I am not sure if I understand the actual problem."

The three current debug demo pages — `voice-fadein-clip-fadein-product-debug-demo`, `pure-webaudio-target-debug-demo`, `shared-source-double-process-debug-demo` — present the artifact in narrative prose with a free-form button row. To run a test the reader has to derive the order from the prose. The empirical numbers in the `debug/*.md` notes are absent from the page, so there is no "expected" reference against which to compare a freshly-rendered scan output.

## What changes

For each of the three pages, replace the single "Reproduce" card with a **numbered procedure** that walks the reader through one test per step. Each step contains:

- A **heading** (e.g. `1. Baseline: HARD-CUT`).
- A short **action** line — what to click and what to listen for.
- The action **button(s)** for that step, rendered inline within the step block (not in a shared button row at the bottom).
- An **Expected vs Got** two-column table populated after the scan, with values lifted from the corresponding `debug/*.md` note as the expected column.

Additionally:

- Add a **link bar** at the top of each page linking the two sibling demos and the relevant `debug/*.md` note(s). Renders as a small horizontal row of links between `BackLink` and the page heading.
- Rewrite the **top callout** as a 1–2 sentence problem statement framing what the page proves (and on `voice-fadein-clip-fadein-product`, a second short callout for the project-copy deletion side-effect, since that page exposes both artifacts).
- Keep the existing **Configuration** and **What to inspect** cards, moved below the numbered steps. Drop their content if it duplicates the new numbered steps; otherwise keep as reference detail.
- Keep the existing **Status / Position** card unchanged — Andre uses the playhead readout to time the audible cue.

The `Stop` button stays as a standalone control (orthogonal to the steps).

## Per-page content

### Page 1 — `voice-fadein-clip-fadein-product-debug-demo`

**Top callout (1):** "A 40 ms linear clip crossfade between two regions with different `sourceUuid`s produces a measurable dip on the incoming voice's fade-in side. Cause: `PitchVoice` multiplies its 20 ms voice-fade-in by the region's clip-fade gain buffer, turning a linear fade-in into a quadratic ramp over the first 20 ms."

**Top callout (2):** "This page also surfaces a second artifact: same-track overlapping regions are silently deleted by `project.copy()`, so the offline scan returns silence in CROSSFADE mode. To measure the dip empirically, use the Target page (two-track workaround)."

**Steps:**

1. **Baseline: HARD-CUT.** No clip fades, regions touch at the seam.
   - Action: `Play (HARD-CUT)` → listen at 30 s for a clean transition (just the 20 ms voice fade).
   - Then: `Scan current scenario`.
   - Expected: `peak ≈ 0.5`, `min / reference ≈ 1.0` (no dip).
2. **CROSSFADE — live audio.** Live engine path plays both overlapping regions.
   - Action: `Stop`, then `Play (CROSSFADE)` → listen for an amplitude dip ~10 ms BEFORE the 30 s seam.
   - Expected: dip subtly audible on the 440 Hz sine.
   - (No scan in this step — the dip is live-audible; the next step shows what the offline scan reveals.)
3. **CROSSFADE — offline scan exposes the overlap-deletion artifact.**
   - Action: `Scan current scenario`.
   - Expected (in isolation, no overlap deletion): some dip near `min / reference ≈ 0.875` (−1.16 dB predicted) on the V2-fadeIn side.
   - Got: `peak = 0` (silence) — `project.copy()` validator deletes both overlapping regions before the offline render starts.
   - For the measured dip number, see the Target page (two-track configuration that dodges the deletion).

### Page 2 — `pure-webaudio-target-debug-demo`

**Top callout:** "Same crossfade scenario rendered three ways for direct A/B/C comparison. ALIGNED (pure Web Audio + phase correlation + linear crossfade) is the audible target at −0.00 dB. UNALIGNED (no phase correction) is the control showing what mis-aligned linear crossfade sounds like at −4.57 dB. OPENDAW renders the same configuration through `TapeDeviceProcessor` and shows a residual −1.56 dB dip on the V2-fadeIn side — this is the artifact."

**Steps:**

1. **Target: ALIGNED (pure Web Audio).**
   - Action: `Play (ALIGNED — target)` → listen for a seamless crossfade at 30 s.
   - Then: `Scan current scenario`.
   - Expected: `min / reference ≈ 0.9998` (−0.00 dB).
2. **Control: UNALIGNED (pure Web Audio, shift = 0).**
   - Action: `Stop`, then `Play (UNALIGNED — control)` → listen for an obvious dip mid-crossfade (phase mismatch).
   - Then: `Scan current scenario`.
   - Expected: `min / reference ≈ 0.5906` (−4.57 dB).
   - This confirms the scan correctly detects an audible dip.
3. **OPENDAW: the artifact.**
   - Action: `Stop`, then `Play (OPENDAW)` → listen for a subtler dip on the incoming voice's side, ~10 ms BEFORE the seam (between ALIGNED's zero and UNALIGNED's obvious dip).
   - Then: `Scan current scenario`.
   - Expected: `min / reference ≈ 0.8352` (−1.56 dB) at `τ ≈ −7.5 ms` relative to seam.
   - Same phase-corrected configuration as step 1; only the engine differs.

### Page 3 — `shared-source-double-process-debug-demo`

**Top callout:** "Two adjacent same-track regions touching at a seam produce a sample-level discontinuity 2 samples before the seam where `max |Δsample|` measures ~2× the clean-sine baseline. The discontinuity is independent of mediaId (SHARED vs DISTINCT `AudioFileBox`) AND independent of where the seam falls within the 128-sample render quantum — both toggles produce bit-identical offline output. Live playback sounds different across seam positions; the offline scan does not reproduce that. Mechanism: open."

**Steps:**

1. **Block-aligned + SHARED.**
   - Action: select `30.000 s — offset 0/128`, then `Play (SHARED file)` → listen at the seam (barely-audible snap, peak unchanged).
   - Then: `Scan current scenario`.
   - Expected: `peak ≈ 0.5`, `seam-Δ / pre-Δ ≈ 1.99` (~2× clean baseline), largest jump at `τ = −0.042 ms` (2 samples before seam).
2. **Block-aligned + DISTINCT.**
   - Action: `Stop`, then `Play (DISTINCT files)`.
   - Then: `Scan current scenario`.
   - Expected: bit-identical to step 1 (rules out shared-source mechanism).
3. **Off-boundary + SHARED.**
   - Action: `Stop`, select `30.500 s — offset 64/128`, then `Play (SHARED file)` → listen for the seam snap.
   - Then: `Scan current scenario`.
   - Expected: `seam-Δ / pre-Δ ≈ 1.99` at `τ = −0.042 ms` (offline scan does NOT show seam-position difference, even though live playback sometimes does).
4. **(Optional) Off-boundary + DISTINCT.** Confirms all four configurations are equivalent in the offline scan.

## UI components

A single shared component, `<TestStep>`, used by all three pages. Lives at `src/components/TestStep.tsx`.

```tsx
interface TestStepProps {
  index: number;            // 1, 2, 3, …
  title: string;            // "Baseline: HARD-CUT"
  description: React.ReactNode; // short prose
  actions: React.ReactNode; // <Button> children
  expected: Array<{ label: string; value: string }>;
  got?: Array<{ label: string; value: string }> | null;
}
```

Renders a `<Card>` with the step number badge, title, description, action buttons, and an "Expected vs Got" table (Radix `<Table>` or a flex grid of two columns). When `got === null` the Got column shows "—" placeholders.

A second component, `<DebugLinkBar>`, lives at `src/components/DebugLinkBar.tsx`. Takes a `links: Array<{ label: string; href: string; kind: "demo" | "note" }>` prop and renders a horizontal row.

The page-side change is:

- Parse the scan result string into the `got` payload for each step (we control both ends — the scan returns a structured object now instead of a `string`).
- Hold a per-step `got` slot in component state (`Record<number, Got>`).
- Each step's `Scan` button writes into the slot for that step.

## What's out of scope

- No change to the offline scan math, the audio fixtures, or any SDK-side reproduction code.
- No new debug pages.
- No edits to the `debug/*.md` notes (they remain the source of truth for mechanism prose; the pages quote their numbers).
- The `fade-out-end-of-file-debug-demo` and `comp-lanes-debug-demo` pages are out of scope (older debug investigations, different fixtures, separate questions).

## Verification plan

For each page after changes:

1. `npm run dev`, open the page over HTTPS in Chrome.
2. Walk through each step in order. Confirm the button-per-step layout matches the design.
3. Click each step's scan and confirm the "Got" column populates with values that fall within the documented range of the corresponding "Expected" number (small variation across machines is acceptable — the markdown notes capture the central case).
4. Click the link bar links and confirm each one routes correctly: sibling demo pages over HTTPS, `debug/*.md` notes via the repo path (GitHub will resolve them at the repo level once committed; locally they'll 404 — that's fine, the link is for repo-browsing, not the live dev server).
5. Verify the Status / Position card and Configuration card still render unchanged at the bottom.

No automated tests — this is a manual-verification UX change. `npm run build` must still succeed.
