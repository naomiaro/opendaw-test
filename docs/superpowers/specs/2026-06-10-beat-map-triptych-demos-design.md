# Beat-Map Triptych Demos — Design

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation

## Purpose

Demonstrate the three ways a DAW reconciles an audio file's beat map with a project
grid — the "triptych" from the warp-markers tutorial (`/Users/naomiaro/Code/warp-markers`,
chapters 07–09 and the *in-the-wild* appendix) — each implemented with the OpenDAW SDK:

| Demo | warp-markers chapter | Strategy | OpenDAW machinery | Commercial analogue |
| --- | --- | --- | --- | --- |
| 1. Varispeed | 07 · ppqn-grid | Conform file → grid, pitch follows rate | `AudioPitchStretchBox` + `WarpMarkerBox` per beat | Ableton Re-Pitch |
| 2. Grid follows file | 08 · grid-follows-file | Conform grid → file, audio untouched | Stepped tempo events on the tempo track; region stays NoStretch | Ableton *Set tempo from clip*, Logic Smart Tempo ADAPT |
| 3. Time-stretch | 09 · time-stretch | Conform file → grid, pitch preserved | `AudioTimeStretchBox` + warp markers + transient markers | Ableton Beats/Complex, Logic Flex Time |

**SDK support finding:** all three approaches are natively supported. No caveats needed.
The chapter-09 thesis — warp anchors and rates are engine-agnostic; only the consumer
changes — is demonstrated concretely: demos 1 and 3 consume the *identical* warp-marker
list through two different stretch boxes.

## Source data

- **Audio:** `public/audio/Otherside.mp3` (already in repo, 257.7 s).
- **Beat map:** copy `warp-markers/08-grid-follows-file/public/samples/otherside-repaired.beats`
  → `public/audio/Otherside.beats`. Real beat_this tracker output, repaired per
  warp-markers ch 06. 510 beats spanning 1.26 s – 249.26 s; average tempo ≈ 123 BPM.
  Verified to align with this repo's `Otherside.mp3`.
- **Format:** text lines `<time-seconds>\t<beatInBar>`, `#` comments. First row is a
  pickup (`beatInBar 4`); first downbeat is row 2.

## Shared infrastructure

### `src/lib/beats/beatsParser.ts`

`parseBeatsFile(text: string): BeatMarker[]` where
`BeatMarker = { readonly second: number; readonly beatInBar: number }`.

- Skips comments/blank lines; validates each row (two numeric columns, `beatInBar` ≥ 1).
- Validates strictly increasing seconds (monotonicity — a non-monotonic map has no
  inverse) and ≥ 2 markers. Throws `Error` with row number on violation.

### `src/lib/beats/beatMapConversions.ts`

Pure functions, no SDK imports beyond constants. All PPQN outputs integer
(`Math.round`) per the Int32 field rule.

- `segmentBpms(markers): number[]` — `60 / (s[n+1] − s[n])` per gap (ch 01/05's
  instantaneous BPM).
- `averageBpm(markers): number` — `(N−1) · 60 / (s_last − s_first)`; demos 1/3 round
  this for the rigid project BPM so varispeed rates hover near 1.0.
- `pickupBeats(markers, beatsPerBar = 4): number` — from the first row's `beatInBar`:
  `(beatsPerBar − beatInBar + 1) % beatsPerBar` (first row `beatInBar 4` in 4/4 → 1).
- `gridAnchorTicks(markers, ppqn, beatsPerBar = 4): { firstBeatTick, firstDownbeatTick }`
  — ch 08's full-bars rule: `firstDownbeatTick = ceil(p·ppqn / ticksPerBar) · ticksPerBar`,
  `firstBeatTick = firstDownbeatTick − p·ppqn`. Downbeats land on bar boundaries; the
  pickup fills the end of the lead-in bar.
- `beatsToWarpMarkers(markers, ppqn, beatsPerBar = 4): { positionPpqn, seconds }[]` —
  marker *n* pins file second `s[n]` to `firstBeatTick + n·ppqn`. Consumed by demos 1 and 3.
- `beatsToTempoEvents(markers, ppqn, beatsPerBar = 4): { tickPpqn, bpm }[]` — one stepped
  event per segment at `firstBeatTick + n·ppqn` with `segmentBpms[n]`; plus one event at
  tick 0 carrying the first segment's BPM so lead-in bars tick at the incoming tempo.
  Consumed by demo 2.
- `clipStartSeconds(markers): number` — `markers[0].second`; demos place/offset the region
  so the file's first tracked beat sounds exactly at `firstBeatTick`.

### Tests

`src/lib/beats/*.test.ts` (Vitest, TDD): parser fixtures including comment/blank/garbage
rows and a non-monotonic failure case; conversion tests using the worked numbers from
warp-markers docs (wobbly fixture: beats at 100/120/150/120 BPM segments; pickup fixture:
p = 1 → firstBeatTick = 3·ppqn in 4/4). Add a `vitest` devDependency + `npm test` script
if not present (check first); regenerate lockfile per CLAUDE.md rule.

### Demo-side shared piece

`src/demos/warp/lib/useBeatMapProject.ts` (or plain async setup function if a hook adds
no value): init OpenDAW, fetch + decode `Otherside.mp3` into `localAudioBuffers`, fetch +
parse `Otherside.beats`, create the Tape track/region. Each demo then applies its own
conform strategy.

## Demo 1 — `warp-varispeed-demo` (Ch 07)

**Page:** `warp-varispeed-demo.html` → `src/demos/warp/warp-varispeed-demo.tsx`

- Project BPM = `round(averageBpm(markers))` (≈ 123), rigid. Metronome enabled via engine
  preferences so the grid is audible.
- **Warp toggle (the payoff):**
  - *Off* — region in NoStretch (`playMode` empty, `timeBase` Seconds): file plays raw and
    audibly drifts against the metronome.
  - *On* — swap to `AudioPitchStretchBox` (single transaction per the play-mode-swap
    pattern), create one `WarpMarkerBox` per beat from `beatsToWarpMarkers()`,
    `timeBase` Musical. Beats lock to the click; segments where segment BPM ≠ project BPM
    play detuned (rate = projectBpm/segmentBpm).
- **Display:** waveform canvas (CanvasPainter + `renderPixelStrips`, ±1.001) with bar-line
  grid overlay and AnimationFrame playhead (direct-DOM pattern); table or strip of
  per-segment rates from `segmentBpms()`/project BPM, current segment highlighted, rate
  rendered as cents offset (`1200·log2(rate)`) so the detune is legible.
- **Explanation:** the ch 07 rate identity (`rate = projectBpm/segmentBpm`), why pitch
  scales with rate, and that `WarpMarkerBox` is literally the repo's `{beat, second}` pair
  with beats converted to ticks.

## Demo 2 — `warp-grid-follows-file-demo` (Ch 08)

**Page:** `warp-grid-follows-file-demo.html` → `src/demos/warp/warp-grid-follows-file-demo.tsx`

- Region permanently NoStretch / Seconds timeBase — the audio is scheduled once and never
  touched; the *only* thing the conform toggle changes is the tempo track.
- **Conform toggle:**
  - *Rigid* — flat tempo at `round(averageBpm(markers))` (single event / `timelineBox.bpm`):
    metronome fights the music,
    bar ruler is even, waveform beats drift across bar lines.
  - *Conformed* — replace tempo-track events with `beatsToTempoEvents()` (stepped
    interpolation, one per segment): metronome and bar ruler bend to the file; every
    tracked beat clicks in time. Audio signal identical in both states.
- Region placement uses `gridAnchorTicks` + `clipStartSeconds` so the file's first beat
  sounds at `firstBeatTick` — the pickup fills the end of the lead-in bar and the file's
  own lead-in audio plays during it (ch 08's full-bars rule).
- **Display:** waveform with bar lines computed from `project.tempoMap` (they *move* when
  conformed — the visual payoff), playhead, live BPM readout
  (`tempoMap.getTempoAt(position)`), tempo-event count badge.
- **Explanation:** who bends — grid, not file; zero DSP cost; Ableton *Set tempo from
  clip* / Logic ADAPT equivalence; why the region must stay Seconds-timeBase (a Musical
  region would stretch under the new tempo map, defeating the point).
- **Risk to verify first (spike):** stepped tempo events at every beat (~510 events) is
  denser than the existing tempo-automation demo. Verify engine behaviour and
  `VaryingTempoMap` performance early; if per-beat density misbehaves, fall back to
  per-downbeat events (one per bar, 4× sparser) and note the simplification on the page.

## Demo 3 — `warp-timestretch-demo` (Ch 09)

**Page:** `warp-timestretch-demo.html` → `src/demos/warp/warp-timestretch-demo.tsx`

- Same warp markers as demo 1 — same conversion call, byte-identical anchors — but
  consumed by `AudioTimeStretchBox`. Requires transient markers on the file box:
  reuse `ensureTransientMarkers` (`src/lib/transientDetection.ts`).
- **Mode control (3-way, the triptych audible on one page):** Raw (NoStretch) /
  Varispeed (PitchStretch) / TimeStretch — implemented as play-mode swaps re-owning the
  warp markers per the documented single-transaction pattern. Guard with the `switching`
  ref pattern (async transient detection).
- `transientPlayMode` segmented control (Once / Repeat / Pingpong) active in TimeStretch
  mode.
- **Display:** waveform + grid + playhead as demo 1; transient-marker count badge.
- **Explanation:** ch 09 thesis — identical warp plan, different engine; OpenDAW's engine
  is transient-segmented (closer to Ableton Beats mode) rather than granular like the
  chapter's toy engine; honest-limits note (transient smearing, segment looping artifacts
  at extreme rates).

## Cross-linking & registration

- Each page links the other two demos and the corresponding warp-markers chapter, framed
  as "the triptych": bend the sound / bend the grid / bend neither.
- Standard demo checklist per CLAUDE.md, for each of the three pages: HTML entry point at
  repo root, `vite.config.ts` rollup input, card in `src/index.tsx` (new "Warp" section or
  alongside playback cards — match index conventions), `public/sitemap.xml`, 1200×630
  og-image + meta tags, GoatCounter script.
- New `src/demos/warp/CLAUDE.md` capturing SDK knowledge learned during implementation
  (warp-marker creation, tempo-event density limits, play-mode swap gotchas).

## Error handling

- `.beats` fetch/parse failures surface in the demo status/error UI (existing pattern),
  with the parser's row-numbered message.
- `ensureTransientMarkers` already throws on zero detections (demo 3).
- Guard all async mode switches with the `switching` ref + dimmed-controls pattern.

## Testing

- **Unit (Vitest):** parser + conversions, including ch 07/08 worked numbers as fixtures.
- **Manual/Playwright verification:** each demo loads over the HTTPS dev server, plays,
  toggles conform/warp without console errors; demo 2's residual check — at beat *n*,
  `tempoMap.ppqnToSeconds(firstBeatTick + n·ppqn) − (s[n] − clipStartSeconds)` should be
  ~0 while conformed (the spec's equivalence made observable; surface it in the UI as a
  drift readout if cheap).
- No E2E coverage requirement beyond the repo's existing demo conventions.

## Out of scope

- Meter changes / `MeterMap` conformance (fixed 4/4, like warp-markers ch 08).
- Beat detection in-browser (the map is precomputed tracker output — the appendix's
  sidecar-file path).
- User-uploaded audio/beats pairs (bundled pair only; drag-and-drop could be a follow-up).
- Granular engine implementation (OpenDAW's stretch engine is used as-is).

## Build order

1. Shared lib + tests (pure math first, TDD).
2. Demo 2 spike: tempo-event density verification (riskiest unknown).
3. Demo 1 (varispeed) — simplest full demo, establishes the page skeleton.
4. Demo 2 (grid follows file).
5. Demo 3 (time-stretch) — reuses demo 1's marker path + adds transients.
6. Registration sweep (index, sitemap, og-images), `src/demos/warp/CLAUDE.md`.
