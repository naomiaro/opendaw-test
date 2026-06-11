# Warp Overview Page ("Who Bends?") — Design

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation
**Target:** PR #67 (branch `beat-map-triptych-demos`)

## Purpose

A public TOC/overview page that frames the three warp demos with real-world context:
which commercial DAW feature each scenario corresponds to, why the technique exists,
and who reaches for it. Replaces the three warp cards on the main index with one card
to keep the index compact.

## Page

`warp-demos.html` → `src/demos/warp/warp-overview.tsx`. Static content page — no
OpenDAW engine, no audio; Radix Theme layout with GitHubCorner/BackLink/MoisesLogo
(same shell as the demos). Fully registered: vite input, sitemap entry, og-image
(`og-image-warp-overview.png` + meta tags), GoatCounter.

## Content (sourced from the warp-markers in-the-wild appendix, reframed for SDK users)

1. **Intro** — a beat tracker (or sidecar metadata: ACID chunks, Apple Loops, `.asd`
   analysis files) yields `{second, beat}` pins. Once a beat map exists, the file and
   the project grid must be reconciled, and every DAW surfaces exactly three answers:
   bend the sound, bend the grid, or slice.
2. **Triptych table** — one row per scenario: what happens · what you hear · what DAWs
   call it (Ableton *Re-Pitch* / Ableton *Set tempo from clip* + Logic Smart Tempo
   *ADAPT* / Ableton *Beats/Complex* + Logic *Flex Time*) · link to the demo page.
3. **Per-scenario "who wants this"** sections (3 short blocks):
   - *Varispeed* (`warp-varispeed-demo.html`) — DJs and tape/vinyl-aesthetic remixes;
     the cheap, characterful lock where detune is a feature; the only artifact-free
     conform (no stretch DSP at all).
   - *Grid follows file* (`warp-grid-follows-file-demo.html`) — importing a performance
     recorded without a click (live drummer, archival multitrack, field recording): the
     music is sacred, the grid adapts; MIDI, quantize, and the metronome then follow
     the player.
   - *Time-stretch* (`warp-timestretch-demo.html`) — remixing and beatmatching where
     the key must survive: acapellas over new beats, sample-pack loops at project
     tempo; the modern DAW default.
4. **Engine-agnostic anchors callout** — the identical warp-marker list drives both
   stretch engines (why Ableton lets you switch a clip's warp mode without touching its
   markers), linking the time-stretch demo where the A/B is audible.

## Index + cross-link changes

- `src/index.tsx`: the three warp cards are replaced by ONE card — 🗺️ "Warp: Who
  Bends?" — linking `/warp-demos.html`, with text naming the three scenarios.
- Each demo page's explanation card gains a link to the overview (alongside the
  existing sibling cross-links).
- `public/sitemap.xml`: the three demo URLs stay; `warp-demos.html` is added.

## Out of scope

- No interactive audio on the overview page.
- No changes to demo behavior.

## Testing

`npm run build` clean; page loads over the dev server; all four links resolve; index
shows exactly one warp card.
