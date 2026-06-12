# Design Decision: Mastering-Console Editorial

**Date:** 2026-06-11
**Status:** Adopted (warp overview); demo pages adopt during the per-demo audit campaign
**Reference implementation:** `src/demos/warp/warp-overview.tsx` (`warp-demos.html`)

## Decision

Demo and overview pages use the **mastering-console editorial** design language:
refined-technical instrument-panel restraint, executed with one signature element
per page that carries information (never decoration for its own sake).

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--mc-bg` | `#0d0c0a` | page background (warm near-black) |
| `--mc-panel` | `#151310` | panel/card surfaces |
| `--mc-line` / `--mc-line-bright` | `#2a2620` / `#3d3729` | hairline rules, borders |
| `--mc-text` | `#d8d2c8` | primary text (12.3:1 on panel) |
| `--mc-muted` | `#948c7d` | prose (5.6:1) |
| `--mc-label` | `#8b8273` | smallest text — micro-labels, indices (4.9:1, the floor) |
| `--mc-faint` | `#5f594e` | **decorative strokes only — fails AA for text**; structural canvas lines |
| `--mc-shade` | `#221d15` | alternating region fill on data canvases (≈1.17:1 on bg) |
| `--mc-amber` | `#e8a33d` | the single accent; also "audio file" in diagrams |
| `--mc-cyan` | `#5fb4c9` | "project grid" in diagrams; scenario chip |
| `--mc-green` | `#7fbf6a` | scenario chip (time-stretch/slicing) |

## Rules

- **Type:** IBM Plex Mono (400/600) for display, micro-labels, code; Radix default
  for prose. Load fonts with `crossorigin` on preconnect AND stylesheet links
  (COOP/COEP). Micro-labels: ≥10px, 600, letter-spaced 0.14–0.22em, uppercase.
  Tabular numerals for anything numeric.
- **Color:** one amber accent per page; scenario identity via small DAW-style color
  chips, never full-surface coloring. Every text/background pair ≥4.5:1 (verify with
  a contrast computation, not by eye — `--mc-faint` exists precisely because it fails).
  Multi-lane pages may carry a lane's chip color into that lane's drawn data line and its small controls.
- **Signature element:** one per page, drawn from the page's actual data/concept
  (the overview's warp lattice plots real-shaped wobbly beats against the grid).
- **Motion:** one staggered load reveal (`animation-delay`), restrained hovers
  (border/color + small transform), at most one ambient animation (playhead sweep).
  Everything gated behind `prefers-reduced-motion: reduce`.
- **Accessibility floors:** keyboard `:focus-visible` outlines on all interactive
  elements; `role="img"` + `aria-label` on informational SVGs; rail/axis labels in
  HTML (fixed px), not SVG text (which scales below legibility on mobile); semantic
  heading order; prose capped ~62–72ch.
- **Layout:** panels joined by 1px gap over the line color (engraved-strip look);
  3-up grids collapse to one column ≤880px; `clamp()` display type.
- **Data canvases (timeline/bar layouts):** pick line weight by what the line *means*,
  not by a single grid color. Three tiers on a `--mc-bg` canvas:
  - tertiary grid (beat subdivisions): `--mc-line` — texture, may sit near-invisible;
  - supporting grid (bar lines under a drawn data line, e.g. the tempo curve):
    `--mc-line-bright`;
  - structural lines (when the layout itself IS the data, e.g. a bar-structure
    timeline): `--mc-faint` (≈2.8:1) — canvas strokes only, never text.
  Alternating region fills use `--mc-shade`; `--mc-panel` reads as flat black on
  canvas (≈1.05:1) and must not be used as a region fill. Amber on a data canvas
  marks **transitions** (meter changes, markers) — never repeated per-cell labels;
  repetition dilutes the accent until nothing reads as a change. Canvas text is
  IBM Plex Mono ≥10px at the `--mc-label` floor.

## Scope

The site shell (GitHubCorner, BackLink, MoisesLogo, Radix Theme wrapper) stays
unchanged across pages. Interactive demo panels keep their existing
`InputLatencyPanel`-style restraint; this language governs page chrome, headers,
explanatory sections, and overview/TOC pages, and is applied per-demo during the
audit campaign rather than as a big-bang restyle.
