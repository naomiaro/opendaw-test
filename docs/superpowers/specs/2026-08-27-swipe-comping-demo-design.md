# Quick Swipe Comping Demo — Design

**Date:** 2026-08-27
**Status:** Approved design, pre-implementation
**Demo:** `swipe-comping-demo.html` / `src/demos/recording/swipe-comping-demo.tsx`

## Purpose

Recreate Logic Pro's Quick Swipe Comping workflow end-to-end in the browser with the
OpenDAW SDK: cycle-record real takes from the microphone, then swipe across take lanes
to assemble a composite, with the engine's transparent seam behavior doing the
crossfades. It completes the missing third piece between two existing demos:

- **Loop Recording & Takes** (`loop-recording-demo.tsx`) — records takes, no comping.
  Stays untouched; the new demo cross-links it.
- **Comp Lanes** (`comp-lanes-demo.tsx`) — comps simulated takes via clicks and
  volume-automation crossfades. **Retired after this demo ships** (see Retirement
  below).

## Decisions (settled during brainstorming)

1. **Take source: live loop recording.** Real mic input, cycle-recording over a loop
   region. No preloaded/simulated takes.
2. **Comp engine: splice regions.** Real `AudioRegionBox` splices, not
   volume-automation crossfades.
3. **Structure: one Tape, take lanes as sibling tracks.** The SDK already creates one
   TrackBox per loop pass under the Tape's AudioUnitBox, all sharing one continuous
   `AudioFileBox` with per-take `waveformOffset`. The comp is one additional TrackBox
   under the same Tape. No second audio unit.
4. **Seams: butt splices only.** Since SDK 0.0.165 the engine plays the outgoing voice
   ~20 ms past a region end at falling gain (release tail reading the source past the
   boundary) while fading the incoming mid-source region in — a true overlapping
   crossfade, scheduled automatically. At a comp seam between different takes this is
   materially Logic's default behavior. No checkerboard/two-track crossfade mode, no
   adjustable crossfade time (YAGNI; measured transparent in this repo).
5. **Styling: console-editorial, interactions: Logic.** All visuals follow
   `docs/design/2026-06-11-mastering-console-editorial.md`; the interaction model
   copies the video (swipe, per-zone click, lanes dim/lit, take-folder collapse).

## Data model

- **Tape audio unit** — created at init (`InstrumentFactories.Tape` + `CaptureAudio`),
  armed for recording. `settings.recording.allowTakes = true`,
  `olderTakeAction: "mute-region"`, `olderTakeScope: "all"` so finished takes sit muted.
- **Take lanes** — the SDK's own take TrackBoxes under the Tape. Never play back
  directly after recording (regions muted); they are the swipe surface.
- **Comp track** — one TrackBox under the same Tape, created when recording finalizes.
  Holds one `AudioRegionBox` per comp zone: `position`/`duration` = the zone's timeline
  range (Int32 PPQN, `Math.round()`ed), `loopOffset` aimed at the winning take's frames
  in the shared recording buffer (take's `waveformOffset` + zone-local offset).
  Butt joints, no explicit fades.
- **Comp state** — `CompState { boundaries: number[], assignments: number[] }`
  (from `compLaneUtils.ts`), persisted as a `comp:`-prefixed JSON label on the comp
  track's first region so undo/redo reverts a swipe atomically with its region rebuild. Each swipe or
  zone click = exactly one `editing.modify()` = one undo step.

## Interactions (Logic parity)

- **Swipe:** pointer-down on take lane *i* at time *a*, drag to *b*, release →
  boundaries inserted at *a* and *b*, covered zones assigned to take *i*, adjacent
  zones with equal assignments merged. During the drag only a dashed highlight overlay
  renders; the box-graph rebuild happens once on pointer-up.
- **Zone click:** a plain click on a take lane assigns that whole existing zone to the
  clicked take.
- **Lane rendering:** unselected ranges dim, selected ranges lit in the take's accent
  color; seam lines run vertically through the whole stack; the comp lane shows the
  assembled waveform with per-zone tint matching the source take and seam ticks at each
  boundary (hover: "~20 ms engine crossfade").
- **Audition:** headphone toggle per lane header solos that take (unmute its region,
  mute the comp track), dims the comp lane; flips back on the next swipe.
- **Take-folder collapse:** disclosure triangle on the Comp lane header collapses the
  take lanes (~160 ms height animation). Collapsed = review/playback mode (comp zones +
  seam ticks still visible); swiping requires expanded lanes. Auto-expand when new
  takes arrive.
- **Playhead:** direct-DOM overlay (repo pattern; no per-frame setState).

## Recording flow

1. **Setup strip:** input device picker, loop length in bars (default 4), count-in
   bars, metronome toggle. Locks while recording.
2. **Record:** enable timeline loop area, count-in, each loop wrap finalizes a take
   and starts the next (SDK `allowTakes` behavior). Lanes appear live with growing
   waveforms (adapting `useTakeDiscovery` / `useTapePeaks` patterns to one Tape).
3. **Stop:** recording finalizes (`importRecording` with capture BPM), comp track is
   created and initialized to **the last take across the whole loop** (Logic's
   default), lanes become swipeable.
4. **Record more takes:** re-arms and appends takes; existing comp state survives
   (new lanes join the pool). **Clear all** resets Tape, lanes, and comp.

## UI layout (top to bottom)

Header (category label + title) → setup strip → transport panel (Record/Play/Stop,
bar:beat readout, undo/redo, "record more takes") → lane stack (comp lane with
disclosure + take lanes) → explainer panel ("Why the seams are silent" — the 0.0.165
release-tail crossfade, linking the shared-source debug note) → standard demo chrome
(GitHubCorner, BackLink, MoisesLogo, DebugLinkBar as applicable).

Interactive mockups from the brainstorming session are in
`.superpowers/brainstorm/32175-1787850661/content/` (gitignored, local only):
`lane-ui.html` (style A/B), `page-layout.html` (full page + callouts),
`page-layout-v2.html` (live collapse toggle).

## Shared code

- Generalize the splice rebuild in `src/lib/compLaneUtils.ts` for recorded takes
  (per-take offsets from `waveformOffset` + recorded durations instead of staggered
  constants); the comp-lanes demo keeps working through the same utility until its
  retirement PR removes it.
- Zone math (boundary insert, range assignment, merge-adjacent) lives in
  `compLaneUtils.ts` as pure functions.
- New reusable pieces that emerge (lane waveform painter, swipe surface) go to
  `src/lib/` / `src/components/` per the extract-and-sweep convention.

## Testing & verification

- **Vitest:** pure comp-state math — boundary insertion, swipe-range application,
  zone merge, label encode/decode round-trip.
- **Browser verification:** real-click transport (trusted gesture for AudioContext),
  record takes from a test signal, RMS-tap the output to verify the comp actually
  plays, verify a seam boundary audibly/measurably, verify undo reverts one swipe.

## New-demo checklist (from CLAUDE.md)

HTML entry point with meta tags, vite `rollupOptions.input` entry, index card in
**Recording & Input** ("Quick Swipe Comping"), sitemap URL, 1200x630 og-image,
GoatCounter script, README table row + source-tree entry.

## Non-goals

- No checkerboard/two-track crossfades, no adjustable crossfade time.
- No multi-Tape comping (one Tape only).
- No comp alternatives (Logic's "Comp A/B/…" duplicates) — single comp.
- No changes to the loop-recording demo beyond cross-links.

## Retirement of the Comp Lanes demo

After this demo ships and its browser verification passes, a **separate follow-up PR**
deletes the listed Comp Lanes demo:

- Remove `comp-lanes-demo.html`, `src/demos/playback/comp-lanes-demo.tsx`, its vite
  input entry, index card, sitemap URL, og-image, and README table/source-tree rows.
- Trim `compLaneUtils.ts` paths only that demo used (automation-crossfade rebuild,
  stagger constants, multi-file take loading) — the swipe demo keeps the zone math and
  splice rebuild.
- **Keep all debug pages** (user decision 2026-08-27) — in particular
  `comp-lanes-debug-demo.{html,tsx}` (unlisted): it is the regression check for the
  resolved cross-file splice-click issue (`debug/splice-click-cross-file.md`) and works
  standalone via its static-setup button. Update that debug note's manual repro
  paragraph, which currently points at the deleted `comp-lanes-demo.html`.

## Risks / notes

- `debug/splice-click-cross-file.md` tracked an open question about cross-file splice
  clicks; not applicable here (all takes share one file), and 0.0.165 made seams
  transparent regardless. Re-verify seam silence during browser verification anyway.
- Take 1 can start before the loop region if recording starts earlier (SDK behavior);
  the demo starts recording at the loop start with count-in, so take 1 is loop-scoped.
- A take can be shorter than the loop (recording stopped mid-pass). Rule: swipe
  commits are clamped to the take's recorded extent — the uncovered remainder keeps
  its previous assignment.
