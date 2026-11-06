# `renderSection` loses frames at its first chunk when delay compensation is not whole quanta

**Title:** With delay compensation that is not a whole number of quanta, `OfflineEngineRenderer.renderSection` drops
frames at frame 48000: everything after it comes out early, and a sustained sound jumps there

**Issue:** not filed. Draft: [`drafts/TO-REVIEW-openDAW-render-section-latency-gap.md`](./drafts/TO-REVIEW-openDAW-render-section-latency-gap.md)

**Verified against:** `@opendaw/studio-sdk@0.0.181` (`5820e7791`), Chrome on macOS. Source citations are read at that tag.
The code cited is unchanged on upstream main at `10088021d` (2026-11-05).

**Repro page:** [`render-section-latency-debug-demo`](https://opendaw-test.pages.dev/render-section-latency-debug-demo), and
`?rate=44100` for the other rate (click Run, about ten seconds, no audio plays). Logic and tests:
`src/lib/audit/sectionRenderGap.ts`.

## What was measured

Each row renders the same section twice from the same project: through `renderSection` (`type: "loop"`, `tail: false`),
and in one `step` over the same frames (`renderOfflineSlice`, the reference). Four 20 ms tone bursts at 0.5, 1.5, 2.5 and
3.5 s give positions: the first frame over 0.05 absolute. A steady 997 Hz tone at 0.5 gives the jump: the largest move between
neighbouring samples, leaving out 0.1 s at each end. A latent device on a muted track leaves the signal itself dry, since
a muted device keeps its latency. The source file is 48 kHz in every row. The page's context and the render follow the page rate.

**Page at 48 kHz.** Single step, hits: 24034 72034 120034 168034 (24034 alone on the short section). Largest step on the
tone 0.065.

| Project | Latency (frames) | `renderSection`, hits | Early | Largest step | At frame |
|---|---|---|---|---|---|
| No latent device | 0 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead on the track | 240 | 24034 72018 120018 168018 | **16**, after 48000 | **0.500** | **48000** |
| Compressor look-ahead on a muted track | 240 | 24034 72018 120018 168018 | **16**, after 48000 | **0.500** | **48000** |
| Fold on a muted track | 15 | 24034 71921 119921 167921 | **113**, after 48000 | **0.475** | **48000** |
| Autotune on a muted track | 1280 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead, 0.9 s section | 240 | identical | no hit after 48000 | 0.065 | 21834 |
| No latent device, two passes | 0 | identical | 0 | 0.065 | 21834 |
| Autotune on a muted track, two passes | 1280 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead, two passes | 240 | 24018 72018 120018 168018 | **16**, all four | 0.065 | 21818 |

**Page at 44.1 kHz.** Single step, hits: 22081 66181 110281 154381 (22081 alone on the short section). Largest step on the
tone 0.071.

| Project | Latency (frames) | `renderSection`, hits | Early | Largest step | At frame |
|---|---|---|---|---|---|
| No latent device | 0 | identical | 0 | 0.071 | 160344 |
| Compressor look-ahead on the track | 220 | 22081 66145 110245 154345 | **36**, after 48000 | **0.449** | **48000** |
| Compressor look-ahead on a muted track | 220 | 22081 66145 110245 154345 | **36**, after 48000 | **0.449** | **48000** |
| Fold on a muted track | 15 | 22081 66068 110168 154268 | **113**, after 48000 | **0.893** | **48000** |
| Autotune on a muted track | 1280 | identical | 0 | 0.071 | 160344 |
| Compressor look-ahead, 0.9 s section | 220 | identical | no hit after 48000 | 0.071 | 28044 |
| No latent device, two passes | 0 | 22080 66180 110280 154380 | 1, all four | 0.071 | 160343 |
| Autotune on a muted track, two passes | 1280 | 22080 66180 110280 154380 | 1, all four | 0.071 | 160343 |
| Compressor look-ahead, two passes | 220 | 22044 66144 110244 154344 | **37** (36 + 1), all four | 0.071 | 160307 |

**Device rate.** The output device (MacBook Pro Speakers) ran at 44.1 kHz and at 48 kHz, checked in System Profiler and in
each run's `deviceRateHz`. Each page rate gave the same figures on both, as a hash of every row's data: `c52d0da368e5` at
48 kHz, `dcbcad9c616f` at 44.1 kHz. These are offline renders, and the device rate moves nothing.

Each row's prediction shows on the page before the row runs, and every row of the four passes held. The exception to
a prediction made in advance is the 1 frame below, which was found by the first 44.1 kHz pass and is carried as a baseline.

## The 1 frame on two passes at 44.1 kHz

A two-pass render at 44.1 kHz reads 1 frame early with no latency at all, and with a latency of whole quanta. At 48 kHz it reads
0. So this defect does not cause it, and its share of the 37 is exactly the 36 the formula gives. The page reads each two-pass row against the
no-latency two-pass row, which must show one shift on every hit. Not explained: the source is 48 kHz, so resampling at the loop
wrap is a candidate, but that was not tested. No page rate equal to the source rate shows it.

## Mechanism (read at the tag, and predicted the tables)

- `step` renders whole quanta and returns exactly what was asked, so the rest of its last quantum is discarded
  (`packages/studio/core-wasm/src/offline-worker.ts:382-391`).
- `#renderFrames`, which `renderSection` uses when `tail` is false, knows this and steps in whole quanta:
  "chunks must be quantum multiples: a step discards the rest of its last quantum"
  (`packages/studio/core/src/OfflineEngineRenderer.ts:407-408`, 375 quanta, 48000 frames, at any render rate). That line
  landed in `42232752f` on 2026-10-19.
- The worker also drops the settled compensation from the start of the output (`trimStart`, `offline-worker.ts:93`), landed
  in `df8c72f90` on 2026-10-20. Those frames come out of the first step's budget of quanta. With a latency that is not whole
  quanta, the first chunk ends part way through a quantum, and the rest of that quantum is discarded before the next step.

So the frames dropped, once, at frame 48000 of the output:

```
(128 − (latencyFrames mod 128)) mod 128
```

and nothing is dropped when the whole render fits one chunk, because no later step follows. On two passes the boundary falls
in the first pass, which is discarded, so the jump is not in the output and every kept frame is early.

## Reach

- In the studio, `Mixdowns.render` (`packages/app/studio/src/service/Mixdowns.ts:30`) sends every section but "Entire song"
  to `renderSection`. `tail: false` holds for "Loop Area", "Loop Area (two passes)" and every marker section but the last
  (`MixdownSection.collect`). `MasteringPanel.tsx:207` also renders sections through it.
- A Compressor or Maximizer with look-ahead makes 240 frames at 48 kHz (5 ms floored: 220 at 44.1 kHz). Fold makes 15, 23 or
  26 by oversampling factor (`crates/dsp/src/resampler.rs:159`). Autotune's 1280 is whole quanta, so it reads clean. Only
  one device at a time was run here; a project with several was not.
- From the source, a tail render (`render`, the song and last-marker paths) does not lose frames: it keeps every quantum after the trim.
  Not measured here.

## What this page does not show

- It was not run through the studio's dialog on opendaw.studio: this is the SDK API at the release tag, called the way
  `Mixdowns.ts` calls it. The steps in the draft come from reading that code.
- Nobody has listened to it. The 0.500 step is a measured discontinuity on a test tone, about 7.6 times the tone's own largest
  step. How it sounds on music is not measured.
- Sections not starting at 0 were not run.

## This repo

`rangeExport.ts` and `offlineScan.ts` make one `step` over the whole range, so none of the audits here go through this. The
export demo's `step` is the same. A second `step` on one renderer is only safe when the frames before it, trim included,
come to whole quanta.
