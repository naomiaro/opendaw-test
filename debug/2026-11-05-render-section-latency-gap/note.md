# `renderSection` loses frames at its first chunk when delay compensation is not whole quanta

**Title:** With delay compensation that is not a whole number of quanta, `OfflineEngineRenderer.renderSection` with
`tail: false` drops frames at the first chunk boundary: everything after it comes out early, and a sustained sound jumps there

**Issue:** [openDAW#530](https://github.com/andremichelle/openDAW/issues/530) (filed 2026-11-05). Body as filed: [`drafts/posted-openDAW-530-render-section-latency-gap.md`](./drafts/posted-openDAW-530-render-section-latency-gap.md)

**Verified against:** `@opendaw/studio-sdk@0.0.181` (`5820e7791`), Chrome on macOS. Source citations are read at that tag.
The code cited is unchanged on upstream main at `10088021d` (2026-11-05).

**Repro page:** [`render-section-latency-debug-demo`](https://opendaw-test.pages.dev/render-section-latency-debug-demo), and
`?rate=44100` for the other rate (click Run, about twenty seconds, no audio plays). Logic and tests:
`src/lib/audit/sectionRenderGap.ts`.

## What was measured

Each row renders the same section through `renderSection` (`type: "loop"`, `tail: false`) and in one `step` over the same
frames (`renderOfflineSlice`, the reference), once with bursts and once with a tone. Four 20 ms tone bursts at 0.5, 1.5, 2.5 and
3.5 s give positions: the first frame over 0.05 absolute. A steady 997 Hz tone at 0.5 gives the jump: the largest move between
neighbouring samples, leaving out 0.1 s at each end. A latent device on a muted track leaves the signal itself dry, since
a muted device keeps its latency. The source file is 48 kHz in every row. The page's context and the render follow the page rate.

The latency column is what the engine reports (`engine.compensationLatency`), read back before each row renders; a row whose
latency differs from the figure read in the crates ends the run. So the Autotune controls show their 1280 frames were
present, which their output cannot show.

**Page at 48 kHz.** Single step, hits: 24034 72034 120034 168034 (24034 alone on the 0.9 s sections). Largest step on the
tone 0.065.

| Project | Latency (frames) | `renderSection`, hits | Early | Largest step | At frame |
|---|---|---|---|---|---|
| No latent device | 0 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead on the track | 240 | 24034 72018 120018 168018 | **16**, from 48000 on | **0.500** | **48000** |
| Compressor look-ahead on a muted track | 240 | 24034 72018 120018 168018 | **16**, from 48000 on | **0.500** | **48000** |
| Maximizer, default settings, on a muted track | 240 | 24034 72018 120018 168018 | **16**, from 48000 on | **0.500** | **48000** |
| Fold on a muted track | 15 | 24034 71921 119921 167921 | **113**, from 48000 on | **0.475** | **48000** |
| Autotune on a muted track | 1280 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead, 0.9 s section | 240 | identical | no hit that late | 0.065 | 21834 |
| No latent device, two passes | 0 | identical | 0 | 0.065 | 21834 |
| Autotune on a muted track, two passes | 1280 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead, two passes | 240 | 24018 72018 120018 168018 | **16**, all four | 0.065 | 21818 |
| No latent device, two passes, 0.9 s section | 0 | identical | 0 | 0.065 | 21834 |
| Compressor look-ahead, two passes, 0.9 s section | 240 | 24018 | **16** | **0.552** | **4800** |

**Page at 44.1 kHz.** Single step, hits: 22081 66181 110281 154381 (22081 alone on the 0.9 s sections). Largest step on the
tone 0.071.

| Project | Latency (frames) | `renderSection`, hits | Early | Largest step | At frame |
|---|---|---|---|---|---|
| No latent device | 0 | identical | 0 | 0.071 | 160344 |
| Compressor look-ahead on the track | 220 | 22081 66145 110245 154345 | **36**, from 48000 on | **0.449** | **48000** |
| Compressor look-ahead on a muted track | 220 | 22081 66145 110245 154345 | **36**, from 48000 on | **0.449** | **48000** |
| Maximizer, default settings, on a muted track | 221 | 22081 66146 110246 154346 | **35**, from 48000 on | **0.519** | **48000** |
| Fold on a muted track | 15 | 22081 66068 110168 154268 | **113**, from 48000 on | **0.893** | **48000** |
| Autotune on a muted track | 1280 | identical | 0 | 0.071 | 160344 |
| Compressor look-ahead, 0.9 s section | 220 | identical | no hit that late | 0.071 | 28044 |
| No latent device, two passes | 0 | 22080 66180 110280 154380 | 1, all four | 0.071 | 160343 |
| Autotune on a muted track, two passes | 1280 | 22080 66180 110280 154380 | 1, all four | 0.071 | 160343 |
| Compressor look-ahead, two passes | 220 | 22044 66144 110244 154344 | **37** (36 + 1), all four | 0.071 | 160307 |
| No latent device, two passes, 0.9 s section | 0 | identical | 0 | 0.071 | 28044 |
| Compressor look-ahead, two passes, 0.9 s section | 220 | 22045 | **36** | 0.071, join not readable | 28008 |

**The last row's join does not show on this tone.** A join's move depends on the tone's phase there as well as the shift
(`joinMove`). At frame 8310 the tone sits at nearly the same level on both sides of a 36-frame join: −0.41 and −0.457, a move of about
0.047, under the tone's own 0.071. The page computes this and expects a jump only where it can read one. The shift, which is what shows the frames went missing, reads the same 36.

**Device rate.** The output device (MacBook Pro Speakers) ran at 44.1 kHz and at 48 kHz, checked in System Profiler and in
each run's `deviceRateHz`, on the page's first nine rows. Each page rate gave the same figures on both, as a hash of every row's
data. These are offline renders, and the device rate moves nothing. The rows added since (the Maximizer and the 0.9 s two-pass sections) ran
with the device at 44.1 kHz.

Each row's expected reading shows on the page before the row runs, and every row matched the formula: "defect present" on
the rows that lose frames, "clean" on the others. Once this is fixed upstream, the rows that lose frames read "differs from the
formula", and that is the fix landing. Three things were found along the way and
then built in, not predicted in advance: the 1 frame below, the unreadable join above, and the two-pass rule for sections under
one chunk.

## The 1 frame on a 4 s two-pass render at 44.1 kHz

A 4 s two-pass render at 44.1 kHz reads 1 frame early with no latency at all, and with a latency of whole quanta. At 48 kHz it reads
0, and a 0.9 s two-pass render reads 0 at both rates. So this defect does not cause it, and its share of the 37 is exactly the 36 the formula
gives. The page reads each two-pass row against the no-latency two-pass row of the same length, which must show one shift on every
hit, of at most 1 frame. Not explained: the source is 48 kHz, so resampling at the loop wrap is a candidate, but that was not tested.

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

So the frames dropped, once, at frame 48000 of what is rendered:

```
(128 − (latencyFrames mod 128)) mod 128
```

Nothing is dropped when everything rendered, all passes counted, fits one chunk, because no later step follows. Where the loss
lands in the kept output depends on the passes (`boundaryInOutput`):

- One pass: at frame 48000.
- Two passes, a section of at least 48000 frames: in the discarded first pass, so no jump shows and every kept frame is early.
- Two passes, a shorter section of more than 24000 frames: inside the kept pass, at frame `48000 − section frames`.

## Reach

- In the studio, `Mixdowns.render` (`packages/app/studio/src/service/Mixdowns.ts:30`) sends every section but "Entire song"
  to `renderSection`. `tail: false` holds for "Loop Area", "Loop Area (two passes)" and every marker section but the last
  (`MixdownSection.collect`). `MasteringPanel.tsx:207` also renders sections through it.
- A Maximizer has look-ahead on by default and makes 240 frames at 48 kHz, 221 at 44.1 kHz (it rounds 5 ms up,
  `device-maximizer/src/lib.rs:157`). A Compressor has it off by default and with it on makes 240 and 220 (it floors,
  `crates/dsp/src/ctagdrc.rs:275`). The Maximizer that `Project.new` puts on the master has it off, so it adds nothing. Fold makes 15, 23 or 26 by
  oversampling factor (`crates/dsp/src/resampler.rs:159`). Autotune's 1280 is whole quanta. Only one latent device at a time was run here;
  a project with several was not.
- From the source, a tail render (`render`, the song and last-marker paths) does not lose frames: it keeps every quantum after the trim.
  Not measured here.

## What this page does not show

- The 0.500 step is a measured discontinuity on a test tone, about 7.7 times the tone's own largest step. How it sounds on
  music is not measured.
- Sections not starting at 0 were not run.

## This repo

`rangeExport.ts` and `offlineScan.ts` make one `step` over the whole range, so none of the audits here go through this. The
export demo's `step` is the same. A second `step` on one renderer is only safe when the frames before it, trim included,
come to whole quanta.

When upstream fixes this, remove the paragraphs in `documentation/10-export.md` and `src/demos/export/CLAUDE.md`.
