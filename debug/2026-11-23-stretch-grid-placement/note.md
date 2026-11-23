# Where a click lands in a stretched region: Signalsmith on the grid

**Status:** measured, no defect. With no stretch and no transpose a Signalsmith region plays every burst on its frame, with the source's width and level. With either, there is no constant offset, and a short click is spread across the stretcher's block. A standing check after SDK upgrades (deterministic, no hardware, about five seconds per rate).
**SDK:** `@opendaw/studio-sdk@0.0.189`, with `0.0.184` as the positive control.
**Page:** [`stretch-placement-debug-demo.html`](../../stretch-placement-debug-demo.html) `[?rate=48000|44100][&row=all|<id>]`.
**Code:** rows and readers `src/lib/audit/stretchPlacement.ts` (Node tests beside it), page `src/demos/warp/stretch-placement-debug-demo.tsx`.

## Question

SDK 0.0.189 removed a delay of 0 to 7 render quanta that every Signalsmith region carried, derived from its uuid
(`changelogs/sdk-0.0.184-to-0.0.189-changes.md`, "Signalsmith timing"). The upgrade measured that the delay no longer
depends on the uuid, by comparing whole-song renders at a few milliseconds' resolution. It did not measure where a
Signalsmith region's audio sits against the grid. Does a click in the source come out where the warp map puts it?

## Method

The source is four seconds of silence with eight bursts in it: 2 kHz under a 2 ms Hann window, a cosine about its
centre so the burst is symmetric, centred on whole frames 0.25 s, 0.75 s, … 3.75 s into the source. One Tape plays it
in one audio region, the master Maximizer removed, 120 bpm. A row sets the play mode (none, `AudioPitchStretchBox`,
`AudioSignalsmithBox`), a stretch through two warp markers (pulse 0 at 0 s, the region's last pulse at 4 s) and a
transpose, and where the region starts (one quarter note in, 0.5 s, which is inside a render quantum at both rates;
one row at 0). The page renders the row offline (`renderOfflineSlice`) and reads each burst in 100 ms either side of
where the warp map puts its centre: `region start + source frame × stretch`, the stretch taken from the region's whole
pulses. Two figures per burst, in frames after (+) or before (−) the expected centre: the **energy centroid** and the
**largest sample**; and the **spread**, the RMS width of the energy about its centroid (13.6 frames for the source's
own burst at 48 kHz).

A row whose audio is not processed (no play mode, varispeed, Signalsmith with stretch 1 and transpose 0) is expected
within one frame on every burst. A processed Signalsmith row is judged for a constant offset only: the median centroid
within a quarter of the stretcher's hop (256 frames) and no burst's centroid further than half its block (2048 frames).
The engine's preset is a 4096-frame block every 1024 frames at any sample rate (`preset_default`,
`crates/signalsmith/src/stretch.rs:102-105`); the C++ original's default is a block of 0.12 s every 0.03 s
(`presetDefault`, `signalsmith-stretch.h:63-64`).

## Result on 0.0.189

Chrome, the Playwright browser, 2026-11-23. Twelve rows, **12 `as-expected`** at both page rates.

### 48 kHz (`stretch-placement-summary-1795460005459.json`)

| Row | Verdict | Median centroid, frames | Centroid range | Spread | Peak level (source 0.8) |
|---|---|---|---|---|---|
| `none` | as-expected | 0 (0.00 ms) | 0 … 0 | 13.58 (0.28 ms) | 0.8 |
| `varispeed-1` | as-expected | 0 (0.00 ms) | 0 … 0 | 13.58 (0.28 ms) | 0.8 |
| `varispeed-1.5` | as-expected | 0 (0.00 ms) | 0 … 0 | 20.37 (0.42 ms) | 0.8 |
| `signalsmith-1-at-0` | as-expected | 0 (0.00 ms) | 0 … 0 | 13.58 (0.28 ms) | 0.8 |
| `signalsmith-1` | as-expected | 0 (0.00 ms) | 0 … 0 | 13.58 (0.28 ms) | 0.8 |
| `signalsmith-1.02` | as-expected | −0.58 (−0.01 ms) | −176.49 … 31.81 (−3.68 … 0.66 ms) | 151.6 (3.16 ms) | 0.569 |
| `signalsmith-0.98` | as-expected | 28.97 (0.60 ms) | −153.48 … 529.36 (−3.20 … 11.03 ms) | 302.24 (6.30 ms) | 0.391 |
| `signalsmith-1.5` | as-expected | 9.09 (0.19 ms) | −795.06 … 280.3 (−16.56 … 5.84 ms) | 643.11 (13.40 ms) | 0.494 |
| `signalsmith-0.75` | as-expected | 188.95 (3.94 ms) | −11.26 … 304.38 (−0.23 … 6.34 ms) | 299.67 (6.24 ms) | 0.351 |
| `signalsmith-1-up3` | as-expected | −103.81 (−2.16 ms) | −868.02 … 483.07 (−18.08 … 10.06 ms) | 797.97 (16.62 ms) | 0.34 |
| `signalsmith-1-down3` | as-expected | 131.09 (2.73 ms) | −12.88 … 318.91 (−0.27 … 6.64 ms) | 607.29 (12.65 ms) | 0.282 |
| `signalsmith-1.5-up3` | as-expected | −108.76 (−2.27 ms) | −613.81 … 378.27 (−12.79 … 7.88 ms) | 1006.48 (20.97 ms) | 0.456 |

### 44.1 kHz (`stretch-placement-summary-1795460008701.json`)

| Row | Verdict | Median centroid, frames | Centroid range | Spread | Peak level (source 0.8) |
|---|---|---|---|---|---|
| `none` | as-expected | 0 (0.00 ms) | 0 … 0 | 12.45 (0.28 ms) | 0.8 |
| `varispeed-1` | as-expected | 0 (0.00 ms) | 0 … 0 | 12.45 (0.28 ms) | 0.8 |
| `varispeed-1.5` | as-expected | 0 (0.00 ms) | 0 … 0 | 18.68 (0.42 ms) | 0.789 |
| `signalsmith-1-at-0` | as-expected | 0 (0.00 ms) | 0 … 0 | 12.45 (0.28 ms) | 0.8 |
| `signalsmith-1` | as-expected | 0 (0.00 ms) | 0 … 0 | 12.45 (0.28 ms) | 0.8 |
| `signalsmith-1.02` | as-expected | 0.3 (0.01 ms) | −1.47 … 6.91 (−0.03 … 0.16 ms) | 17.09 (0.39 ms) | 0.612 |
| `signalsmith-0.98` | as-expected | −2.23 (−0.05 ms) | −6.26 … 8.39 (−0.14 … 0.19 ms) | 15.12 (0.34 ms) | 0.362 |
| `signalsmith-1.5` | as-expected | 0.1 (0.00 ms) | −0.17 … 55.11 (0.00 … 1.25 ms) | 218.17 (4.95 ms) | 0.498 |
| `signalsmith-0.75` | as-expected | 7.1 (0.16 ms) | −58.51 … 56.32 (−1.33 … 1.28 ms) | 72.78 (1.65 ms) | 0.483 |
| `signalsmith-1-up3` | as-expected | −49.28 (−1.12 ms) | −334.01 … 163.06 (−7.57 … 3.70 ms) | 559.54 (12.69 ms) | 0.418 |
| `signalsmith-1-down3` | as-expected | 169.44 (3.84 ms) | −222.36 … 809.73 (−5.04 … 18.36 ms) | 733.13 (16.62 ms) | 0.244 |
| `signalsmith-1.5-up3` | as-expected | −27.85 (−0.63 ms) | −429.3 … 277.17 (−9.73 … 6.29 ms) | 676.5 (15.34 ms) | 0.465 |

## Reading

- **No stretch, no transpose: on the frame.** A Signalsmith region with an identity warp map gives every burst the
  source's centroid (0 frames off), width (13.58 frames) and level (0.8), at a region start of 0 and at one inside a
  quantum. The page reads those three figures; it does not subtract the render from the source sample by sample.
- **Stretched or transposed: no constant offset.** The median centroid stays within 4 ms of the warp map on every row
  at both rates (the largest: +3.94 ms at 48 kHz for 0.75, +3.84 ms at 44.1 kHz for −3 semitones), and its sign changes
  from row to row.
- **A click is smeared, and its centre moves with where it falls.** One burst's centroid sits up to 18 ms from the map.
  The tables' spread and level are each row's median over its eight bursts: up to 21 ms RMS where the source's is
  0.28 ms, and 0.24 to 0.61 where the source peaks at 0.8. Single bursts go further: the widest reads 32 ms RMS
  (29 ms at 44.1 kHz) and the quietest peaks at 0.11 (0.09). Eight bursts 24 000 source frames apart fall at eight
  different places in the 1024-frame hop, and each reads differently.
  This is what a phase vocoder with an 85 ms block does to a 2 ms event, and the original's block is longer. It is not
  compared against the C++ original here: no claim that the port smears more or less than it.
- **The two rates differ in size, not in kind.** At 44.1 kHz the stretch rows are tighter (2% longer: range −0.03 …
  0.16 ms against −3.68 … 0.66 ms at 48 kHz). The block is the same 4096 frames at both rates, so the bursts fall at
  other places in the hop (22 050 frames apart). With eight bursts per row this page cannot separate that from an effect
  of the rate itself.

## Positive control: 0.0.184

The same page and readers served against SDK 0.0.184 (a worktree of the commit before the upgrade, its own dev server),
48 kHz, three page loads. `none`, `varispeed-1` and `varispeed-1.5` read 0 on every load. The two unprocessed
Signalsmith rows read a whole number of render quanta late, the same on all eight bursts, a different number per
region and per load:

| Load | `signalsmith-1-at-0` | `signalsmith-1` |
|---|---|---|
| 1 | +640 frames (5 quanta, 13.33 ms) | +640 (5 quanta, 13.33 ms) |
| 2 | +128 (1 quantum, 2.67 ms) | +768 (6 quanta, 16.00 ms) |
| 3 | +384 (3 quanta, 8.00 ms) | +512 (4 quanta, 10.67 ms) |

The processed rows carried the same delay on top of their smear (2% longer: median +895, −0.58 and +767 frames on the
three loads, where 0.0.189 reads −0.58). The page read `investigate` on 8, 6 and 9 of the 9 Signalsmith rows. So the
two **unprocessed** Signalsmith rows, held to one frame, see a delay of a single render quantum, and 0.0.189 has none
on them. A processed row is allowed a median of 256 frames, so it reads `as-expected` with a delay of no quanta
(a region that drew slot 0) and can with one or two: the processed rows are not the guard against that delay.

## What this settles from the upgrade

The upgrade's whole-song comparison found the 0.0.189 Signalsmith render's envelope 11 to 12 ms later than the
varispeed render of the same song. This page shows no such offset on clicks: with a 2% stretch, the size of that song's
warp, the median is within 0.6 ms. The song figure compares two different processes on music (varispeed changes pitch
and keeps transients sharp, the stretcher softens them), so it most likely reflects how each lays out an onset's
energy and not a delay. Nothing here measured the song figure's cause.

## `audio-verify` after the change

The skill's Signalsmith cells were calibrated while the uuid delay was in. Re-measured 2026-11-23 on 0.0.189 (first 20
beats per window, median distance to `gridTimes`): `signalsmith` [60, 80] **39.6 ms** (was 17.9; under the 60 ms line);
`signalsmith-transposed` **96.1 / 83.8 ms** (was 19.6 … 35.6; over the line), with a p90 of 229 to 238 ms in every
window, the tracker hitting offbeats as the skill describes for the untransposed render's second window. The skill's
deciding check holds: the untransposed and the transposed render's envelopes peak at a lag of **0 ms** ([60, 80],
correlation 0.70) and **+1 ms** ([120, 140], 0.69), so the transpose does not move time. The beat tracker's median on
these two renders is not a placement measurement; this page is. The pitch-class rotation check was not re-run.
