# Signalsmith Warp Demos — Design

**Date:** 2026-07-31
**Status:** Approved design, pending implementation plan

## Goal

`AudioSignalsmithBox` (spectral phase-vocoder play mode, in the SDK since 0.0.159) is the
only audio play mode with no demo coverage. Add demo coverage in the warp category and
complete the `time-pitch-demo` mode switcher, with demo copy that explicitly tells
readers **when to choose Signalsmith over the other play modes** — the differentiation
story is a first-class deliverable, not a caption.

## Deliverables

### 1. New demo: `warp-signalsmith-demo.html` (warp category)

Three sections, one narrative: *conform → transpose → why this mode exists*.

1. **Grid conform (hero).** The warp song conformed to the grid via `AudioSignalsmithBox`,
   reusing `setupWarpDemo`, `buildWarpAnchors`, and `WarpWaveform`. Same layout language
   as `warp-varispeed-demo` / `warp-timestretch-demo`. Warp anchors are engine-agnostic —
   only the box type differs.
2. **Transpose.** Live ±24 st slider plus musical presets (−2, +3, +12), writing
   `transpose` through `AudioSignalsmithBoxAdapter` during playback.
3. **Mode A/B.** One toggle flipping the same region Signalsmith ↔ TimeStretch (cents
   matched to the transpose value where both support it) so the spectral vs
   transient-segmented character is audible on real material. A prose callout covers the
   transient-marker dependency (TimeStretch renders silence below 2 transient markers;
   Signalsmith has no such dependency). **No synthetic no-transients audio rig** — that
   was considered and dropped as contrived (it requires manufacturing a special clip).

### 2. Extend `warp-timestretch-demo`

Signalsmith joins the existing raw / varispeed / time-stretch A/B as a fourth playback
mode. No transpose UI there — just the stretch comparison.

### 3. Extend `time-pitch-demo` (playback category) to four modes

The page is the API-mechanics companion to `documentation/18-time-and-pitch.md` and the
only home of the reference-pitch (A4) story — it stays standalone. Add Signalsmith as a
fourth mode button:

- Mode swap follows the same transaction pattern as the existing modes
  (`AudioContentModifier.toSignalsmith` ordering).
- The cents slider drives Signalsmith too — `AudioSignalsmithBoxAdapter` exposes both
  `transpose` and `cents` (verified in the installed d.ts), so the existing slider
  pattern extends without new UI concepts. Range widens to Signalsmith's ±2400 cents
  when that mode is active (TimeStretch keeps its ±1200 clamp).
- A4 tuning: the tuning offset applies to the active decoupled mode; whether the
  auto-engage path keeps choosing TimeStretch or prefers Signalsmith is an
  implementation-time decision (verify item 4).
- Page copy updates from "three play modes" to four, and cross-links the new
  warp-signalsmith demo for the musical story. The "why choose what" guidance (below)
  appears here too.

### 4. Shared lib: `applySignalsmith(ctx)`

Added to `src/demos/warp/lib/warpScenarios.ts`, riding on the existing `applyWarpToGrid`
body (same warp anchors, different box type — `AudioSignalsmithBox` has the same shape as
`AudioPitchStretchBox` plus `transpose`). Both demos and the verify harness consume it.

### 5. Audio verify (same PR)

Add a Signalsmith grid-conform scenario to the `/audio-verify` offline-render harness
with the same numeric beat-alignment assertions as varispeed/timestretch. Expected beat
times are identical to the other grid-conform modes (same anchors). Additionally render
one transposed variant (e.g. +3 st) and assert it still beat-aligns — pitch must not
move time.

### 6. Documentation: extend the decision matrix

`documentation/18-time-and-pitch.md` lists Signalsmith in the play-mode table but the
Decision Matrix tree still terminates at TimeStretch. Extend the tree with the
TimeStretch-vs-Signalsmith branch (mirroring the demo copy below), and update the
chapter's demo link text ("switch a region between the three play modes" → four).
Chapter docs stay present-tense — no SDK version qualifiers.

## The "why choose what" copy (core content, all three demo pages)

Grounded in `documentation/18-time-and-pitch.md`; claims about audible character must be
verified by ear against the actual WASM engine during implementation before shipping:

| Mode | Pitch ↔ Time | Pitch range | Needs | Choose it when |
|------|--------------|-------------|-------|----------------|
| NoStretch | Both fixed at source | — | nothing | Audio shouldn't follow tempo; drifts vs grid under BPM changes |
| PitchStretch (varispeed) | Coupled | follows tempo | warp markers | Tape sound is fine or desired; cheapest; loops, drones, FX |
| TimeStretch | Decoupled | ±1200 cents (1 octave, adapter clamp) | warp markers **+ ≥2 transient markers** | Percussive/rhythmic material — transient-segmented playback keeps attacks sharp |
| Signalsmith | Decoupled | ±24 st (2 octaves) | warp markers only | Sustained/harmonic material, big transposes, or files where transient detection fails — spectral stretch with no transient dependency |

Key contrasts to make explicit in the demo text:

- **vs varispeed:** Signalsmith decouples pitch from tempo; varispeed cannot.
- **vs TimeStretch:** twice the pitch range (±24 st vs ±12 st), no transient-marker
  requirement (TimeStretch is *silent* below 2 markers), spectral rather than
  segment-looped rendering between onsets. TimeStretch's counter-argument — transient
  preservation on drums — gets equal billing; the A/B toggle exists to make both sides
  audible.
- The A/B pitch match only holds within ±12 st (TimeStretch cents clamp). Presets beyond
  that show Signalsmith alone, with the UI stating why.

## Verify-first items (before building UI around them)

1. **Live transpose:** confirm the engine reads `transpose` per render block (as it does
   `playbackRate`) so the slider is safe mid-playback. If not, gate writes on stopped
   transport.
2. **Mode-swap ordering:** follow `AudioContentModifier.toSignalsmith` (single
   transaction, `adoptWarpMarkers` helper) for the A/B toggle.
3. **Audible character claims:** listen before writing copy that asserts smearing or
   smoothness; describe what the WASM engine actually does.
4. **A4 auto-engage target:** decide whether the tuning path in `time-pitch-demo`
   keeps auto-engaging TimeStretch or prefers Signalsmith when no decoupled mode is
   active (either works within ±80 Hz of 440; pick one and state it in the demo copy).

## Standard new-demo checklist (applies to deliverable 1)

Vite `rollupOptions.input` entry, card in `src/index.tsx`, `public/sitemap.xml`,
1200×630 og-image + meta tags, GoatCounter script, mastering-console design language
(`docs/design/2026-06-11-mastering-console-editorial.md`), and a link from
`warp-overview.tsx` alongside the other three warp demos.

## Out of scope

- Synthetic no-transients demo clip (dropped — see above).
- Removing or retitling `time-pitch-demo` — considered and rejected; it stays as the
  standalone API-mechanics/A4-tuning page, now covering all four modes.
- Any engine/SDK changes.
