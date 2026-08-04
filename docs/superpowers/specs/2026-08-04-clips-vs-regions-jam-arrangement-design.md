# Jam to Arrangement — Clips vs Regions Demo

**Date:** 2026-08-04
**Status:** Approved design, pre-implementation

## Purpose

A new demo that answers "what is an audio clip even for?" by telling the workflow
story: **jam with clips, then commit what works to the timeline as regions.**

- A **region** says *"play this at bar 5"* — it has a timeline position; the
  transport plays it linearly. Regions are the composition.
- A **clip** says *"play this when I trigger it"* — it has no timeline position,
  only a launcher-slot index. It launches quantized to the next bar, loops until
  stopped or replaced, and **takes over its track** (the track's regions are
  silenced while the clip plays). Clips are the jam.

## Verified SDK facts (openDAW source + installed SDK 0.0.164)

These were verified against the openDAW studio/engine source and
`node_modules/@opendaw/*/dist` type declarations:

- `AudioClipBox` fields: `clips` → `trackBox.clips` (how the engine resolves the
  track), `file` → `AudioFileBox` (absent ⇒ clip never sounds), `index` (slot
  column), `duration` (becomes the loop duration), `events` (mandatory pointer to
  a `ValueEventCollectionBox`), optional `playMode`, `mute`, `gain`, `timeBase`.
- Of `ClipPlaybackFields` (`loop`/`reverse`/`speed`/`quantise`/`trigger`), the
  engine reads **only `loop`** (default true). Launch quantization is hard-coded:
  **next bar** when the track is idle, **the playing clip's duration grid** on
  handover. One clip max per track.
- While a clip plays on a track, that track's timeline regions are silenced
  (engine iterates regions only in sections with no active clip). Other tracks
  are unaffected.
- `engine.scheduleClipPlay(clipIds)` / `engine.scheduleClipStop(trackIds)`;
  launching **also starts the transport** if stopped. Transport stop resets the
  clip sequencer (all clips stop).
- `engine.subscribeClipNotification(observer)` delivers
  `{type:"waiting", clips}` (optimistic, on schedule) and
  `{type:"sequencing", changes:{started, stopped, obsolete}}` (engine-confirmed).
- Creation helpers exist on `project.api`: `createNotStretchedClip(props)` and
  `createNotStretchedRegion(props)` (`AudioContentFactory`), taking
  `{boxGraph, targetTrack, audioFileBox, sample, duration?, index | position, …}`.
- A clip loops the **first `duration` worth of its file** (virtual region:
  position 0, loopOffset 0, loopDuration = clip duration).
- Implementation caveat to verify: for non-stretched content the factory's
  `duration` is in **seconds** (Seconds timeBase), not PPQN — compute 1/2/4-bar
  loop lengths at 124 BPM via `PPQN.pulsesToSeconds` and confirm the produced
  clip's `timeBase`/`duration` pairing against `AudioClipBoxAdapter` before
  trusting bar alignment.

## Story / UX (top of page to bottom)

1. **Clip grid (the jam).** 4 rows × 3 columns.
   - Rows = Dark Ride stems at 124 BPM: Drums, Bass, Guitars, Vox
     (`public/audio/DarkRide/02_Drums`, `03_Bass`, `04_ElecGtrs`, `06_Vox`).
   - Columns = loop length: **1, 2, 4 bars** (each clip loops its stem's first
     N bars — the SDK's native clip-loop mechanic supplies the variety).
   - Each cell: mini waveform (peaks via adapter layer), state visual —
     idle / **waiting** (blinking until the bar boundary; makes quantized launch
     visible) / **playing** (radial or bar progress driven by engine position).
   - Clicking an idle cell launches it; clicking the playing cell stops the
     track (`scheduleClipStop([trackId])`). Clicking a different cell on a
     playing track demonstrates quantized handover.
   - Column headers: scene-launch button (`scheduleClipPlay` with that column's
     four clip ids). One global **Stop clips** button (all track ids).
2. **Commit button.** Stamps the currently-playing combo into the arrangement:
   for each track with an active clip, create an `AudioRegionBox` in the next
   free 4-bar section — same `AudioFileBox`, loopDuration = the clip's loop
   length, region duration = 4 bars (loops fill the section). Tracks with no
   playing clip stay empty — silence is part of the arrangement. UI shows
   "Section N committed (bars X–Y)".
3. **Arrangement panel.** Canvas timeline: bar ruler, one lane per track,
   committed regions as colored blocks with waveforms, playhead overlay
   (direct-DOM AnimationFrame pattern). Buttons: **Play arrangement**, **Stop**,
   **Clear arrangement**.
4. **Explainer copy** woven through the page: clips = "what if" (no position,
   launch-quantized, loop, take over the track), regions = "when" (positioned,
   linear). Mention the studio's real "Convert to Region" menu as the production
   equivalent of Commit.

## Architecture

Single project, shared tracks — the clip grid and the arrangement are two views
of the **same four tracks**, which is how openDAW actually works and what makes
the takeover rule demonstrable.

New demo category `src/demos/clips/` (clip-launcher SDK knowledge is a distinct
area; category CLAUDE.md accumulates learnings per repo convention).

### Components

| Unit | Responsibility |
|---|---|
| `clips/jam-arrangement-demo.tsx` | Page assembly, transport wiring, commit action |
| `useClipStates` hook | Subscribes `engine.subscribeClipNotification` + catch-up; exposes `Map<clipUuidString, "idle"\|"waiting"\|"playing">` and per-track active clip |
| `ClipCell` / `ClipGrid` components | Grid rendering, launch/stop/scene clicks, waveform + state visuals |
| `ArrangementCanvas` component | Bar ruler, region blocks, playhead overlay |
| Setup module | Project boot: 4 audio units (Tape), load stems via sample manager, build 12 clips via `project.api.createNotStretchedClip` |

### Key flows

- **Boot:** `initializeOpenDAW` → create 4 instruments → load 4 stem files →
  one `editing.modify` per SDK rules (captures/pointer re-routing in separate
  transactions per CLAUDE.md) → create 12 clips (indexes 0..2 per track).
- **Jam:** first launch parks the playhead far past the arrangement
  (seek to `JAM_PARK_BAR` ≈ bar 1000, one-time) so committed regions on
  clip-less tracks never intersect the free-running playhead. Launch auto-starts
  the transport (engine behavior) — no separate jam Play button.
- **Commit:** read active clips from `useClipStates`; next free section derived
  from existing regions (max region end ÷ 4 bars) — no duplicated counter state;
  regions written in one `editing.modify`.
- **Play arrangement:** `engine.stop()` (resets clip sequencer → all clips
  stop) → `position = 0` → `engine.play()` (facade already resumes
  AudioContext).
- **Clear arrangement:** delete all committed region boxes in one
  `editing.modify` (`box.delete()` for cascade).

### Error handling

- Stem load failures surface in the existing init error card path.
- Commit with zero playing clips: button disabled (derived from clip states).
- Safari: stems ship as `.opus` + `.m4a`; use `getAudioExtension()`.

## Out of scope (YAGNI)

Per-clip gain/reverse/speed (engine ignores most), clip recording, region
editing after commit, per-clip convert-to-region parity, tempo changes,
scene naming/management, note/value clips.

## Testing & verification

- `npx tsc --noEmit --ignoreDeprecations "6.0"` — zero new errors vs parent
  commit (filter `^src/`).
- Browser verification (repo conventions): real click for the first
  transport-starting gesture; verify audio with an AnalyserNode RMS tap, not UI
  state; verify quantized launch by observing waiting→playing transition near a
  bar boundary; commit two different combos, Play arrangement from bar 0, and
  confirm per-section RMS is non-zero where regions exist and near-zero in an
  empty lane section.
- Verify takeover: with a committed region under the playhead and its track's
  clip playing, the region is silent; stopping the clip restores it.

## Demo scaffolding checklist

1. `jam-arrangement-demo.html` at repo root (meta tags, robots ok, GoatCounter)
2. `src/demos/clips/jam-arrangement-demo.tsx` (Radix Theme, GitHubCorner,
   BackLink, MoisesLogo, mastering-console design language)
3. `vite.config.ts` rollup input entry
4. Card in `src/index.tsx` under a new "Clips" category
5. `public/sitemap.xml` entry
6. 1200×630 screenshot → `public/og-image-jam-arrangement.png` + meta tags
7. `src/demos/clips/CLAUDE.md` seeded with the verified SDK facts above
