# Export regression: what the harness found on its first runs

**Title:** Every SDK export path, 296 rows at two page rates: what holds, what each row that does not hold measured, and a full run's stall in the OPFS worker

**Status: FINDINGS 1 AND 2 FIXED IN `@opendaw/studio-sdk@0.0.183`** (re-measured 2026-11-09, [below](#sdk-0183-both-findings-fixed); their labels are retired). **The 0.0.183 runs are NOT accepted: they wait for a person's read.** Before: register accepted on 0.0.182, library filled; findings 1 and 2 filed as [openDAW#533](https://github.com/andremichelle/openDAW/issues/533) and [openDAW#534](https://github.com/andremichelle/openDAW/issues/534) on 2026-11-08. The user read the findings and approved the labels and the first fill. Both page rates are accepted, a re-run of each reads every row `identical`, and a changed render is caught (below). Nothing is posted. Three drafts wait (below). `trailing-silence-trimmed` is ruled by design and not raised upstream. The other findings are the
user's call, each with the read it got.

**The catalogue holds 296 rows and none reads `failing`.** `gap-none-start`, `gap-none-section-entire` and `gap-none-stem-start` carry `long-silence-ends-render` (Finding 2), which is a defect with a draft: a label means read and understood, not fine.

**Verified against:** `@opendaw/studio-sdk@0.0.182`, engine `9c44973549a7`, checkout at the tag (`766204efe`). Chrome
156.0.8078.81 (Playwright's), macOS 15.6.1. The Mac's output device read 44100 Hz for every run below unless it says otherwise; each summary since the device rate was added records it (`deviceRateHz`). These renders are offline, and the page's own context takes the rate in the URL. Source citations are read at the tag.

**Labels:** *Measured* is from a run's WAVs or a probe's output. *Read* is code read in the checkout. *Computed* is arithmetic on
those. *Inferred* is a conclusion that nothing here observed directly.

## The harness

**Page:** [`export-regression-audit-debug-demo.html`](../../export-regression-audit-debug-demo.html)
`[?rate=48000|44100][&uuid=descending][&fill=1][&rows=<id,id>|&group=<group>][&failAt=<rowId>]`. A real click on Run, 73 to 74 s for all
rows (95 to 98 s with `&fill=1`), no audio plays. Logic: `src/lib/audit/exportRegression*.ts`. Table and accept: `node scripts/audit/export-regression/table.ts [runToken] [--accept] [--force] [--library <path>] [--diff <rowId>]`.

Each row renders a copy of one project through one SDK export path (`step` in one call and in chunks, `start`, `renderSection`, stems, the
bounce's exported pieces, `setPosition`, a loop area) with one latency case (none, Autotune, Compressor on a track, a bus or an aux,
Maximizer, Fold, scripts, several together). The row is held to its invariants and later compared with the accepted register by hash.

`latency-as-expected` reads the LIVE engine's reported compensation latency with the same devices inserted, not the offline worker's: the render's own latency is proven by the other invariants (the impulse frames, the sample comparisons). The row's detail says "live engine". `frames-as-expected` also holds `section-loop-twice`, because a pass longer than the range (0.9 s at 137 bpm: 43204 frames, range 43200) would otherwise read clean 4 frames short.

**A label is not a pass.** A failed invariant whose render matches a measured signature reads `known-finding`, with the finding's
name. It means read and understood, not fine. A failed invariant with no such match reads `failing`, and `--accept` refuses it even forced.

## The runs

| what | rate | token | rows | run line's counts | register |
|---|---|---|---|---|---|
| accepted, `?fill=1` | 48000 | 1794012843131 | 296, all | clean 237, known finding 59, failing 0, errored 0 | none yet, 296 uploaded |
| accepted, `?fill=1` | 44100 | 1794012980176 | 296, all | clean 222, known finding 74, failing 0, errored 0 | none yet, 296 uploaded |
| re-run | 48000 | 1794013197246 | 296, all | the same | 296 `identical`, 0 uploaded |
| re-run | 44100 | 1794013308862 | 296, all | the same | 296 `identical`, 0 uploaded |
| re-run after the final review (`section-loop-twice` holds `frames-as-expected`) | 48000 | 1794014622292 | 296, all | 237 / 59, failing 0, errored 0 | 296 `identical`, 0 uploaded |
| the same | 44100 | 1794014737287 | 296, all | 222 / 74, failing 0, errored 0 | 296 `identical`, 0 uploaded |
| re-run after the PR review (the page, `table.ts` and the accept gate; no render touched) | 48000 | 1794015800836 | 296, all | 237 / 59, failing 0, errored 0 | 296 `identical`, 0 uploaded |
| the same | 44100 | 1794015919591 | 296, all | 222 / 74, failing 0, errored 0 | 296 `identical`, 0 uploaded |
| `?uuid=descending&group=control` | 48000 | 1794013420891 | 11 | clean 11 | 10 `identical`, 1 `changed` |

SDK 0.0.182, engine `9c44973549a7`, the device at 44100 (read in `system_profiler` and in each summary). Real clicks 30 s after load, the tab visible, no stall in any of them. Tables: `.verify-output/exportreg-table-<rate>.txt`
(local; the run lines are the figures above).

**What is still on disk.** In `.verify-output/` (local, git-ignored), after the clean-up of 2026-11-06: the accepted runs 1794012843131 and 1794012980176, summary and 296 WAVs each; the re-runs 1794013197246, 1794013308862, 1794014622292, 1794014737287, 1794015800836 and 1794015919591, summary only; the descending run 1794013420891, summary and its one WAV; the device-proof runs 1794009335901, 1794010354018, 1794010135751 and 1794010487551, summary only. Any other token this note cites is gone, summary and WAVs: its figures here are the record.

**Measured against the runs read before the accept.** Every hash of the 292-row runs (1794010354018, 1794010487551) and of the 14-row tail runs (1794012321608, 1794012363406) is unchanged in the accepted runs, so the 30 bed rows that `bedSeconds` moved onto a changed path are unchanged by a run too. Three rows changed standing, and only those: the gap rows above, `failing` to `known-finding`. The 292 can be compared again from the summaries kept. The 4 single-stem rows were only in the tail runs, whose summaries are gone, so their comparison can no longer be re-run.

| group | 48000 clean / known / failing | 44100 clean / known / failing |
|---|---|---|
| core | 89 / 32 / 0 | 78 / 43 / 0 |
| master | 19 / 3 / 0 | 19 / 3 / 0 |
| mix + stems | 28 / 0 / 0 | 28 / 0 / 0 |
| bounce | 16 / 4 / 0 | 12 / 8 / 0 |
| position | 0 / 12 / 0 | 0 / 12 / 0 |
| one-frame | 46 / 2 / 0 | 46 / 2 / 0 |
| tail | 8 / 6 / 0 | 8 / 6 / 0 |
| sweep | 22 / 0 / 0 | 22 / 0 / 0 |
| control | 9 / 0 / 0 | 9 / 0 / 0 |

| finding | rows at 48000 | rows at 44100 | where it stands |
|---|---|---|---|
| `loop-pass-one-frame-short` | 2 | 17 | [openDAW#533](https://github.com/andremichelle/openDAW/issues/533): [body](./drafts/posted-openDAW-533-loop-pass-one-frame-short.md); **fixed in 0.0.183, label retired** |
| `loop-bounce-last-frame-silent` | 0 | 4 (the same rows as 4 of the 17) | in the same draft; **fixed in 0.0.183, label retired** |
| `trailing-silence-trimmed` | 2 | 2 | by design, the user's read; not raised upstream |
| `jump-fade-at-start` | 30 | 30 | the user's call |
| `jump-fade-cold-maximizer` | 2 | 2 | the user's call |
| `reset-keeps-compensation-delay` | 11 | 11 | the user's call |
| `range-missing-tail` | 1 | 1 | the user's call |
| `loop-wrap-keeps-old-read` | 4 | 4 | the user's call |
| `merge-seam-reseats-read` | 4 | 4 | the user's call |
| `long-silence-ends-render` | 3 | 3 | a defect, [openDAW#534](https://github.com/andremichelle/openDAW/issues/534): [body](./drafts/posted-openDAW-534-entire-song-ends-at-silence.md); **fixed in 0.0.183, label retired** |

**The register and the library (measured).**

| | 48000 | 44100 |
|---|---|---|
| `register/<rate>.json` | 296 rows, 114 KB | 296 rows, 114 KB |
| uploaded by the `?fill=1` run | 296 WAVs, 456.5 MB | 296 WAVs, 416.2 MB |
| distinct renders, each one WAV | 73, 112.3 MB | 75, 106.1 MB |

No hash is shared between the two rates. The library holds **148 WAVs, 218.4 MB**, against the spec's estimate of about 150 renders and about 225 MB, and 2 % of GitHub Free's 10 GiB of LFS storage. It is the private repository `opendaw-export-wavs`, commit `dad053d`, pushed through LFS. A re-run uploads nothing, so a run leaves nothing behind unless a render moved.

**The register catches a change (measured).** The descending run above has the same project with its units summed in the other order, and its invariants all hold, so only the register can see it. It reads `changed` on `control-mix-three-units`, where three units sum, and `identical` on the other 10:

```
control-mix-three-units: rounding-sized, first differing frame 2, largest -138.5 dB, shift 0 frames, frames 192000 -> 192000
```

`table.ts 1794013420891 --diff control-mix-three-units --library <clone>` prints that line and writes both WAVs: the accepted one's samples hash to the register's entry, the new one's to the run's row (checked). That is the same reading as the earlier temporary register's, now from the accepted baseline and the library.

## The device rate moves no render

**Measured.** Each page rate at both device rates, `node scripts/audit/export-regression/table.ts --compare-device`:

| page rate | device 48000 | device 44100 | result |
|---|---|---|---|
| 48000 | 1794009335901 | 1794010354018 | `292 of 292 rows identical` |
| 44100 | 1794010135751 | 1794010487551 | `292 of 292 rows identical` |

SDK 0.0.182, engine `9c44973549a7`, full runs. The page reads the device rate once, before a run (`readDeviceRate`, a bare `new AudioContext().sampleRate`, closed again), and records it in the summary. So a run says its footing, but a device change during a run would not show. These pairs were compared when the catalogue held 292 rows. The same command now prints `292 of 296` and exits 1, which is right: those runs never rendered the four new rows, and a hash comparison of the 292 (re-done by hand) still reads identical. Only a run at each device rate on the 296 rows would cover them.

## The controls

**An older SDK fires (measured; summary and WAVs removed in the clean-up of 2026-11-06, the figures here are the record).** `?group=core` on 0.0.181, 48 kHz, token 1794001338597, engine `3da5083093`: 47 clean, 74
failing, 0 errored. openDAW#530 reads as filed: `core-compressor-track-section-*` 16 frames early (4096 to 4080),
`core-fold-muted-section-*` 113 early (4096 to 3983). openDAW#529 too: `script-150ms-parallel` reports 7200 frames, 4800 expected, on all 11 rows.
Those WAVs re-judged in Node with the labels as they stood after the first fix round: 47 clean, 53 failing, 21 known, and every #530 and #529 row named here
stays failing, so the labels do not hide those two defects.

**UUID order fires, on the second attempt (measured).** `?uuid=descending` at 48 kHz, against a temporary register built from an ascending run and removed afterwards.

- **First attempt, did not fire:** tokens 1794001426866 (`group=core`) and 1794001512204 (all rows) read every row `identical`. `core`
  has no summed row at all (bed and holder muted), and mix and stem rows sum exactly two audible units. Inferred: two float32 terms add
  commutatively, so their order cannot reach the bits ([the order note](../2026-11-06-mixdown-uuid-order/note.md) measured its cause on five units).
- **Second attempt, fired:** the catalogue gained `control-mix-three-units`, three audible units. Token 1794004015579 reads that row
  `changed` and the other 285 `identical`: `rounding-sized, first differing frame 2, largest -138.5 dB, shift 0 frames, frames 192000 -> 192000`.
  The three bounce tap rows came later and were not in this run.
- `planAccept` refuses all three descending runs, unforced and forced.

**The neutral chains prove latency, not processing, so two controls say what they cannot (measured, both rates).**

- `control-compressor-engaged` (threshold −24, ratio 4, look-ahead on): tone peak 0.1059 against the neutral 0.5000, −13.48 dB, reported latency unchanged at 240 / 220.
- The bounce's three taps on that Compressor with the unit's fader at −6 dB: pre-fx bit-identical to the no-device render (tone 0.5000); pre-fader bit-identical to `control-compressor-engaged` (0.1059); post-fader exactly −6.000 dB from pre-fader (0.0531).

## Finding 1: a looped pass runs one frame short at some rate, length and bpm

**FIXED in 0.0.183** (`5f6b53791`, the transport counts frames from an anchor): see [SDK 0.0.183](#sdk-0183-both-findings-fixed).

**Filed:** [openDAW#533](https://github.com/andremichelle/openDAW/issues/533), body as filed in [`drafts/posted-openDAW-533-loop-pass-one-frame-short.md`](./drafts/posted-openDAW-533-loop-pass-one-frame-short.md). This answers the unexplained
frame in [the #530 note](../2026-11-05-render-section-latency-gap/note.md) and the
[#530 comment](https://github.com/andremichelle/openDAW/issues/530#issuecomment-6680737221), which left it open as "the single early frame at 44.1 kHz".

**The axis (measured, the `one-frame` rows at both page rates).** Page rate, source rate, section length and bpm crossed: 24 cells.

| page rate | section | bpm | source rate | one pass, impulses | two passes, kept pass, impulses |
|---|---|---|---|---|---|
| 48000 | 4 s | **137** | 48000 | 4096 24037 72064 120037 168064 | **4095 24036 72063 120036 168063** |
| 48000 | 4 s | **137** | 44100 | 4458 26163 78437 130653 182927 | **4457 26162 78436 130652 182926** |
| 44100 | 4 s | **120** | 48000 | 3763 22084 66209 110284 154409 | **3762 22083 66208 110283 154408** |
| 44100 | 4 s | **120** | 44100 | 4096 24037 72064 120037 168064 | **4095 24036 72063 120036 168063** |

- The other 20 cells read their one-pass impulses exactly: 0.9 s and 2 s at both bpm and both rates, 4 s at 120 at 48 kHz, 4 s at 137 at 44.1 kHz.
- **Not specific to 44.1 kHz:** it depends on the page rate, the length and the bpm together. The #530 note's "at 44.1 kHz" was read at one bpm.
- **Not resampling, the candidate the #530 note named:** the source rate does not move it, and the cell with source and page both at 48 kHz fails.
- **Not `renderSection`:** `step-loop-twice`, the loop area stepped by hand, carries the same hits and is bit-identical to `section-loop-twice`.
- The kept pass holds `samples-equal-warm-pass`, so its samples are the stepped loop's. The shift is the whole of the difference against one pass.
- In the rest of the catalogue, at 44.1 kHz, 4 s, 120 bpm: the 11 `core-*-section-loop-twice` rows, one per latency case, and the 4 `bounce-*-bounce-loop` rows, on 4 of those cases.

**The cause (read).** `render_quantum` advances the position by adding `samples_to_pulses(128, …)` per quantum (`crates/transport/src/transport.rs:218, :281`), so the position
carries accumulated float error. At the loop's end the block is split by converting the remaining pulses to samples and truncating (`emit_until`, `:342`, `as i64`). The comment above the
loop check says "the pulse math is exact for round rates" (`:250`).

**Computed against measured.** I emulated those positions in Node, positions only (`render_quantum`, `emit_until`, `crates/dsp/src/ppqn.rs`), and asked where each wrap lands. Where
the accumulated position sits a hair above the exact one, the remaining frames come out just under a whole number and truncate one lower.

| rate | section | bpm | loop end, ppqn | exact frames | last split, raw | first four passes |
|---|---|---|---|---|---|---|
| 48000 | 0.9 s | 120 | 1728 | 43200 | 64.0000000004 | 43200 each |
| 48000 | 0.9 s | 137 | 1973 | 43204.38 | 68.3795620435 | 43204 each |
| 48000 | 2 s | 120 | 3840 | 96000 | 1.48e-9 | 96000 each |
| 48000 | 2 s | 137 | 4384 | 96000 | 3.39e-10 | 96000 each |
| 48000 | 4 s | 120 | 7680 | 192000 | 3.52e-9 | 192000 each |
| **48000** | **4 s** | **137** | **8768** | **192000** | **127.999999997** | **191999 each** |
| 44100 | 0.9 s | 120 | 1728 | 39690 | 10.0000000002 | 39690 each |
| 44100 | 0.9 s | 137 | 1973 | 39694.02 | 14.0237226280 | 39694 each |
| 44100 | 2 s | 120 | 3840 | 88200 | 8.00000000089 | 88200 each |
| 44100 | 2 s | 137 | 4384 | 88200 | 8.00000000103 | 88200 each |
| **44100** | **4 s** | **120** | **7680** | **176400** | **15.9999999955** | **176399 each** |
| 44100 | 4 s | 137 | 8768 | 176400 | 16.0000000008 | 176400 each |

**The emulation marks exactly the failing rows and no others.** It was written from the source after the rows had read, so it explains them rather than having called them in advance. Two reviewers checked it, and I wrote it again for this note with the same result. It covers positions, not the audio.

**The looped bounce's last frame (measured, 44.1 kHz, 120 bpm, 4 s, 4 rows, `loop-bounce-last-frame-silent`).** Exactly one frame differs from the stepped loop: frame 176399, the last, on channel 0. The bounce
holds 0 on both channels, and the stepped loop holds 0.07072490, which is the source's frame 1. So the stepped loop is one frame into its third pass, which fits a second pass one short.
*Read, then computed:* the bounce has no loop area: it makes the region two loop durations long and keeps the second (`AudioBounce.ts:130`). The second cycle's start goes through `sample_of`, which truncates the same accumulated position (`audio_region_player.rs:868-869, :974-976`); emulated, it lands on frame 176399, not 176400 (raw 15.9999999955 in its quantum). The region still ends at 352800, so the read reaches the source's end one frame early and the span's last frame reads past it: 176400 × 1.08843541 = 192000.0066 against 192000 source frames (`:903-905`). My source is exactly one loop long; with a longer one the read would continue (read, not measured). At 48 kHz, 4 s, 120 bpm the region's end lands on 383999 yet the last frame reads −0.0651 and all 192000 frames equal the stepped loop, so the region's end is not what silences the frame.

**Inferred, not measured:**

- A bounce of a loop laid back on a timeline to loop has a one-sample dropout at each repeat.
- Live playback shares this transport, and so this loop length.
- The looped bounce at 48 kHz and 137 bpm does the same. The catalogue has `bounce-loop` at 120 bpm only. Computed: the emulation of the cycle start marks the same two of 12 combinations short as the transport's, and at this one the last frame's read lands on exactly 192000 of 192000, past the end. Still unmeasured.

## Finding 2: an entire-song render stops at 10 s of silence even when regions follow, and they are missing from the file

**FIXED in 0.0.183** (`0f2b76d76`, `minDurationSeconds` and `SilenceTail`): see [SDK 0.0.183](#sdk-0183-both-findings-fixed).

**Filed:** [openDAW#534](https://github.com/andremichelle/openDAW/issues/534), body as filed in [`drafts/posted-openDAW-534-entire-song-ends-at-silence.md`](./drafts/posted-openDAW-534-entire-song-ends-at-silence.md). Label: `long-silence-ends-render`, approved by the user (below).

**The label holds the three rows to the render as measured.** The frames are the rule's, computed from the row and not copied: 21472 and 19729 (the rule below). Those frames are the reference's bit for bit, and the reference is exact zeros from there to 16 s and holds its second burst, peak at least 0.49. Failing, on real renders at both rates (the three rows each): 128 short, 1 short, 1 long, 1e-7 on a frame, 1e-6 on the last frame, a −0 in the silence, gain 0.999, a NaN, the second burst with the frames still short (16.1 s, and a quantum short of the range). Unit tests add a reference with no second burst, a quiet one, and something in the gap. A render that reaches the range reads `clean`, and `staleFindings` then names the label (tested); swapping the channels is no mutation here, since the two are identical on these rows (checked).

**The user's read, 2026-11-06:** "The trim should end the song if it's just silence", and the draft is about what follows. So a render that ends on trailing silence with nothing after it is by design and not raised upstream: `trailing-silence-trimmed`, the `tail-none-section-entire-long` and `tail-none-start-long` rows, 80992 of 192000 frames at 48 kHz, 74001 of 176400 at 44.1 kHz, bit-identical to the 4 s reference as far as they go.

**The gap (measured).** 200 ms burst regions at 0 and at 16 s, no device, so the gap is exact zeros. Rows `gap-none-*`, full runs 1794010354018 (48 kHz) and 1794010487551 (44.1 kHz). "Bursts" is `impulseHits`, each burst's largest sample on channel 1.

| page rate | row | path | frames | bursts |
|---|---|---|---|---|
| 48000 | `gap-none-step-one` | `step`, 18 s | 864000 | 300, 768300 |
| 48000 | `gap-none-start` | `start` | **21472** | **300** |
| 48000 | `gap-none-section-entire` | `renderSection`, song | **21472** | **300** |
| 44100 | `gap-none-step-one` | `step`, 18 s | 793800 | 7542, 713142 |
| 44100 | `gap-none-start` | `start` | **19729** | **7542** |
| 44100 | `gap-none-section-entire` | `renderSection`, song | **19729** | **7542** |

`start` and `renderSection` have one hash per rate and are bit-identical to the step as far as they go (checked on the WAVs). `section-is-slice` holds them to the second region's end, 777600 and 714420 frames, and reads `only 21472 of the range's 777600 frames could be compared`.

**A single stem (measured, tail runs 1794012321608 and 1794012363406; 1794011464378 and 1794011505218 read the same).** The same source as the only stem, `stems-single-step` and `stems-single-start`.

| page rate | row | frames | bursts | hash against |
|---|---|---|---|---|
| 48000 | `gap-none-stem-step` | 864000 | 300, 768300 | equal to `gap-none-step-one` |
| 48000 | `gap-none-stem-start` | **21472** | **300** | equal to `gap-none-start` |
| 44100 | `gap-none-stem-step` | 793800 | 7542, 713142 | equal to `gap-none-step-one` |
| 44100 | `gap-none-stem-start` | **19729** | **7542** | equal to `gap-none-start` |

**Was the mix playing through that render?**

- *Why the rows needed a change.* `withBed: true` alone would not have done it: the bed took the row's `seconds`, so these rows would have had a 200 ms bed and a silent mix, and the render would have read short for the wrong reason. `bedSeconds: 18` gives them an 18 s bed from 0, and its unit is not in the stems configuration.
- *Measured, on a sibling render.* A stem render hands back only its stems, so the mix cannot be read from it. `gap-none-stem-mix` renders the same project as a mix over the 18 s: all 6750 quanta at 48 kHz and all 6202 at 44.1 kHz are over −72 dB, the quietest block's peak 0.295 and 0.291, and the peak is about 0.30 both across the 1..16 s gap and in the last 100 ms.
- *Measured, the positive control.* `gap-none-stem-mix-start` puts that project, compared field by field with the stem rows in a test, through `start` as a mix: the path the stem stopped on.

  | page rate | frames | seconds | `section-is-slice` against the stepped mix | peak 15.9..16.0 s | peak 16.0..16.2 s | peak 16.2..16.3 s |
  |---|---|---|---|---|---|---|
  | 48000 | 875872 | 18.247 | holds: 864000 frames bit-identical, 11872 past the reference | 0.300 | 0.759 | 0.300 |
  | 44100 | 804753 | 18.248 | holds: 793800 frames bit-identical, 10953 past the reference | 0.300 | 0.758 | 0.299 |

  So the bed keeps the render going past 16.2 s, with the second burst in it, and the render then ends on the silence after the bed: 875872 = 864000 − 128 + 12000, 804753 = 793856 − 128 + 11025 (computed, the rule below). `impulseHits` cannot show the burst here: the bed keeps channel 1 over its threshold, so the whole render is one cluster ([6080], [5586]). The peaks are read from the WAVs. One project, one path, and what differs is which channels the render returns, so the stem's own silence is what ended `gap-none-stem-start`.
- *Read, in the stem render itself.* A unit that is not a stem stays wired with default options (`crates/engine/src/lib.rs:2270-2277`), and `engine.render` fills the output before `copy_stem_outputs` (`:3125-3127`). Inferred from those: the bed is rendered in the stem render as it is in the mix's. Nothing here observed that buffer, and the control does not change that: it shows what the check does on the mix's channels, not what the stem render's master holds.

**What the worker's silence check reads (read, `packages/studio/core-wasm/src/offline-worker.ts`).** The stems configuration names one unit (`stemsConfiguration` in `exportRegressionPaths.ts`, tested), so `stemPairs` is 1 and `numberOfChannels` 2 (`:250`, `:361`). `renderQuantum` copies the stem staging into those two channels and returns before it reads the master output (`:112-119`). `render`'s `maxSample` runs over those channels only (`:416-423`). So with a stem alone its own silence ends the render. With several stems the check covers all of theirs (read, not measured).

**The cause (read).** `render` breaks once audio has played and 10 s has stayed at or below −72 dB (`offline-worker.ts:424-426`, defaults `:398-399`: `start` and `renderSection` pass only `maxDurationSeconds`, `core/src/OfflineEngineRenderer.ts:279`, `:312`), and `:440` keeps at most a quarter of a second of it. `maxDurationSeconds` is the span plus 30 s (`OfflineEngineRenderer.ts:276`, `:312`), a cap only (`offline-worker.ts:400`, `:409`): the silence break does not consult it. `render`'s own `endPosition` parameter reaches only the progress display (`OfflineEngineRenderer.ts:438-443`). Silence before the first audio does not count (`hasHadAudio`, `:404`, `:423-424`). The render resolves normally.
`MixdownSection.ts:21` gives "Entire song" `tail: true`, `:39` the last marker section, and `Mixdowns.ts:28-29` sends the song to `start`.

**Computed from the measured figures.** The first burst's last frame over −72 dB is 9599 at 48 kHz and 8819 at 44.1, in the quanta ending at 9600 and 8832. The kept length is that end less one quantum plus a quarter second: 21472 = 9600 − 128 + 12000, 19729 = 8832 − 128 + 11025. So on these rows the render stops at 10.2 s, and a region starting after that is lost.

**An earlier probe (measured once at 48 kHz, on the console, `start`, a Reverb on the source, 4 s regions; not catalogue rows).**

| second region at | `lastRegionAction`, s | frames rendered | last sample over 0.01, channel 0 |
|---|---|---|---|
| none | 4 | 80992 | 0.562 s |
| 6 s | 10 | 368992 | 6.562 s |
| 16 s | 20 | 80992 | 0.562 s: not in the render |
| 30 s | 34 | 80992 | 0.562 s: not in the render |

Not run: the mix inside the stem render itself, the last marker section with a gap, a gap of any other length in the catalogue, an export of several stems, a stem through `renderSection`, and the studio's own Export dialog.

## The others: the user's call, no drafts

Each paragraph gives what was measured, then my read. My read is not a decision.

**`jump-fade-at-start`** (30 rows at each rate: `section-marker`, `section-marker-last`, `setposition-*`). At 48 kHz the row differs on frames 0..239 only, rendered / reference exactly i/240, then bit-identical. At 44.1 kHz the same fade over 221 frames, then a
difference across the whole render on the impulses: −56.6 dB from a 1 s start, −47.0 from 3 s, −50.0 from 2.13 s. Read: `audio_region_player.rs:862` fades in when a block is discontinuous and past the region's start, and upstream's test
`transport_jump_inside_a_native_region_crossfades` pins it. The 44.1 kHz remainder is `:849` dividing two f32 rates, so a free-running read drifts 3.73e-8 source frames per output frame; computed × the 0.9 impulse, that gives all three figures exactly. `setposition-off-quantum` at 44.1 kHz adds −29.4 dB from the row's start falling 0.031 frame off a whole frame, which is the comparison's own rounding. My read: by design for a live
jump, a question for an export, whose first block is treated as a jump. The drift is rounding-class. A residual: on the 4 `setposition-off-quantum` rows at 44.1 kHz a single click fits the per-frame allowance, up to +0.0073 / −0.0024 (bisected).

**`jump-fade-cold-maximizer`** (2 rows at each rate: `master-{none,compressor-track}-section-marker`). The fade above, and the master Maximizer starting cold. At 48 kHz the render differs on frames 0..3430, up to 1.48× the reference after the fade, largest difference −0.7 dB. It is within
rounding of the warm limiter from frame 1168 at 48 kHz and 1627 at 44.1, bit-identical from 3431 at 48 kHz. Not an invariant of any row: the section's peak is 1.46, its 182 samples over 1.0 end at frame 445; `master-none-step-one` has 166 over 1.0 ending at frame 205, peak 1.50. Read: with look-ahead off the Maximizer applies its gain
directly with no hard clamp (`device-maximizer/src/lib.rs`). My read: by design. At 48 kHz a hot render through the default Maximizer exceeds 1.0 only in its first 5 to 10 ms; at 44.1 kHz samples past 10 ms still do: 68 on `master-none-section-marker`, up to 1.0007, and 116 on `master-none-step-one`, up to 1.0002.

**`reset-keeps-compensation-delay`** (11 rows at each rate: the latent `*-step-reset`). A second play on one renderer after a stop with reset: from `latency` on, the render is the reference delayed by exactly the reported frames, bit-identical on all 11 at both rates. The first frames are silent (`several`: at most 0.0031 at 48 kHz, 0.0023 at 44.1).
Read: `offline-worker.ts` spends the trim once, in `settle` and `trimStart`. Inferred, not checked across every caller: no SDK export path replays on one renderer. My read: a limit more than a defect today.

**`range-missing-tail`** (1 row at each rate: `tail-none-section-marker`). A section starting after the region's end renders silence, peak 0, over 96000 / 88200 frames, against a reference still ringing at about −54 dB. Read: a render starts cold and `renderSection` has no pre-roll. My read: by design as coded. It costs a user any tail from before the range, and whether that is acceptable is the user's question.

**`loop-wrap-keeps-old-read`** (4 rows at each rate: `position-*-loop-on-copy`). At a wrap to the region's start the new pass is at full level with the old read on top, fading linearly from 1.0 to 0 over 240 frames at 48 kHz, 221 at 44.1. A 0.5 sine reaches 0.975, about +5.8 dB; the largest step is 0.1299 at frame 96001 (0.1411 at 88201). Past the window it is
bit-identical to a fresh pass. 997 Hz × 2 s is a whole number of cycles, the worst case by construction. Read: `audio_region_player.rs:322` seeds the old read's tail and `:862` fades in only past the start; upstream's test `transport_jump_to_the_region_start_keeps_the_onset` says "only the old read fades out", runs below full scale and pins no level. My read: by design, with an unpinned side effect. In-phase material doubles for 5 ms, which could clip a hot loop; not measured on hot material.

**`merge-seam-reseats-read`** (4 rows at each rate: `bounce-*-bounce-merge`). At 48 kHz, 225 frames differ between 96014 and 96959, inside the 20 ms after the seam, largest −150.5 dB; channel 1 is identical. At 44.1 kHz, bit-identical to the seam, then −73.4 dB on the tone and −50.6 dB on the two hits past the seam. Read: `audio_region_player.rs:942`, the first region's tail overlaps the
second's fade-in on the same frames, and the second read is seated at the exact position (`:884-888`), leaving the free-running drift behind; computed 2 s × 44100 × 3.73e-8 × 0.9 = −50.6 dB, matching. My read: by design, rounding-class.

## The OPFS hang

**Symptom (measured).** A full run stalls at `one-frame-none-step-one-44100-2-120`, row 235, always that row, at either rate. The console reads `[OPFS] write 'samples/v2/8731c112-4aba-4cee-acef-72e7c030da12/audio.wav' runs for 5.0s at 'create sync access handle'`, then `has no answer from the worker after 10.0s`.
Then the row and those sharing its sample, 8 rows, time out at 60 s each. Later rows with other samples render: run 1794009473058 went on past those 8 and finished, with a summary, and they are its only errors. `peaks.bin` and `meta.json` of that sample were written and `audio.wav` is 0 bytes. The renders are not affected: 235 WAVs from two aborted runs were byte-identical to the completed run. A run left to finish writes its summary with those 8 rows errored; the earlier runs were stopped before that.

| Run clicked, after load | rate | hangs |
|---|---|---|
| about 2 s, full catalogue | 44.1 kHz | 3 of 4 (the three in a row earlier, then one pass, token 1794007165739, on this task's re-run) |
| about 2 s, full catalogue | 48 kHz | 0 of 1 |
| about 30 s, full catalogue | both | 2 in about 20 (one at 48 kHz; one at 44.1 kHz, run 1794009473058, device 48 kHz, its console holding the same two lines on the same file, and a re-run, 1794010135751, cleared the 8 rows). The last 4 of them are the accepted runs and their re-runs, 2 at each rate, none stalled |
| about 2 s, `?group=one-frame`, the same sample | 44.1 kHz | 0 of 2 |

**What the hang is not.**

- *Two writes holding one content-addressed sample's handle.* Read: `GlobalSampleLoaderManager.#load` keeps one load per uuid through `#pending`, and `OpfsWorker.#acquireLock` serialises each path. A second handle on an open file rejects rather than waits (the web-platform test `file-system-access/sandboxed_FileSystemFileHandle-sync-access-handle-lock.https.tentative.worker.js` reads so). Measured earlier: with the page hung, a fresh worker opened that same `audio.wav` through `createSyncAccessHandle` in 0.7 ms, so nothing held it.
- *The sweep at page load.* Read: `clearStoredSamples` is awaited before the page goes on, and the file is created long after it. No evidence for it, and it does not explain one row.
- *A harness fault.* The harness only asks for samples. The call that never settles is the SDK worker's, on a file it has just created.

**A mechanism that reproduces: the promise is lost when the handle is collected in flight. Whether the natural stall is this is inferred, below.**

**Without the SDK (measured, [`sync-handle-gc-probe.js`](./sync-handle-gc-probe.js), a dedicated worker).** A microtask allocates 800 MB of ArrayBuffers right after the call, so a collection runs before the reply can be delivered. Lost means pending 2 s or more after the arm's last open. The controls: the accounting reads a never-settling promise as pending, and a sentinel object is finalized by the burn.

| arm | first run | as committed |
|---|---|---|
| handle kept in an array, burn | 40 of 40 settled, 0 finalized | 40 of 40 settled, 0 finalized |
| only reference a local, cleared after the call, burn | **33 of 40 lost**, the first eight among them | **2 of 40 lost**, 2 finalized |
| the same, no burn | 100 of 100 settled | 100 of 100 settled |
| an async function, the handle a local not read after the await, burn | **178 of 718 lost**, the first at open 172 | **182 of 791 lost**, the first at open 190 |
| the same function with the local read after the await, burn | 3000 of 3000 settled | 3000 of 3000 settled |

No promise rejected in any arm. The fourth arm has the shape of `OpfsWorker.ts:150`, `return await fileHandle.createSyncAccessHandle()`.

**On the SDK's worker, on the real page (measured, `?rate=44100&fill=1`, a wrapper around `createSyncAccessHandle` in the worker, the same burn per open).**

- *Burn, wrapper keeps no reference:* 556 opens settled. Then open 557, 558 and 559 were all reported `collected while its open is pending`, and the page printed the same lines as the hang, one step on: `[OPFS] read 'samples/v2/1670ee0d-…/audio.wav' runs for 5.0s at 'create sync access handle'`, then `has no answer from the worker after 10.0s`.
- *Burn, wrapper holds each handle until its promise settles:* 0 collected while pending, none lost in the 1347 opens read before the end, the run completed (token 1794006971612), all 289 hashes equal to the 44.1 kHz run of the catalogue as it stood then, 1794005688755.

**Inferred, and not caught.** That the natural hang is this. The evidence: the same step and lines, a promise that never settles and never rejects, a file nothing holds, and only one of the three files lost, which fits a collection landing inside one open's flight.
What I did not get: an observed natural hang with the observer attached. Two runs with a wrapper at the 2 s click (one watching every open, tokens 1794006553434; one only `audio.wav`, 1794007066683) and the plain re-run all passed, and a wrapper changes the worker's allocations. So the wrappers may have moved the collection, or the hang may have been rarer than its first three runs read.

**The probes' own runs, all deleted after the hash compare.** None was an unforced full run, so "3 of 4" stands, and across every full run the count is 5 in about 25. All at 44.1 kHz with `?fill=1` unless named. Which is which comes from the click order and the gaps between the tokens.

| token | what it was | files |
|---|---|---|
| 1794006553434 | full, wrapper on every open, no burn | summary, hashes equal |
| 1794006690745 | `?group=core`, forced burn, stopped by my 16 s window, no summary | 48 |
| 1794006709211 | `?group=core`, forced burn with the handle held, stopped by the window, no summary | 47 |
| 1794006902080 | full, forced burn, the forced stall above, no summary | 139 |
| 1794006971612 | full, forced burn with the handle held | summary, hashes equal |
| 1794007066683 | full, wrapper on `audio.wav` only, no burn | summary, hashes equal |
| 1794007165739 | full, plain, no wrapper: the one unforced run here | summary, hashes equal |
| 1794007349562 | `?rate=48000&rows=tail-none-section-entire-long,tail-none-step-one`, the page state for the gap probe of Finding 2 | summary and 2 WAVs |

**Also inferred.**
- Why one row: the worker's allocations follow the catalogue, so a collection lands at the same place, and row 235's fresh 705 KB message is a large allocation. An idle wait before Run changes the heap, hence the click-time difference.
- Why not early opens: first losses at open 172 and 190, and the SDK's at 557, fit an optimizing tier saving only live registers across the await, with the frame unoptimized before that holding the handle. I have no trace of that tier-up.

**Reach (read).** Every `Workers.Opfs` read and write opens through `#resolveFile`. A lost open never answers and keeps that path's lock for the life of the worker, so later operations on the path wait behind it. A sample's load or a recording's save is built on those calls and would wait with them; I measured the load only. The SDK's 5 s and 10 s warnings are what names it.

**Standing.** Not a harness fault. A Chromium behaviour reproduced without the SDK, with an SDK path exposed to it, so a draft, which is not ready to post (its head says what is missing): [`drafts/TO-REVIEW-chromium-sync-access-handle-does-not-settle.md`](./drafts/TO-REVIEW-chromium-sync-access-handle-does-not-settle.md). Not tried: Firefox, Safari, the user's own Chrome. **The Chromium tracker was searched** by the controller in the user's Chrome on 2026-11-06, read-only: no matching issue. Queries, with result counts: `createSyncAccessHandle` (23); OPFS with hang, hangs, "never resolves", "never settles", pending or stuck (47); FileSystemFileHandle with "garbage collected", GC, "garbage collection", mojo or "never resolves" (28); SyncAccessHandle with hang, "never resolves", "does not resolve", pending or deadlock (1); promise never resolved plus garbage collection in FileSystem, OPFS or worker (65, first 50 read, mostly web-platform-test noise). Closest, none the same: 40279881 (locks out of order, a wrong-order error), 453704691 (a stale NoModificationAllowedError, Windows), 513127261 (an Atomics.waitAsync hang, fixed in 149). No entry in `docs/known-vendor-issues.md` yet: it goes in with the user's read.

**For a person running the page.** A run stuck on a row with those two console lines is this. Its rows error at 60 s each. Reload and wait about 30 s before Run: both times that was done right after a hang, the run passed. Reloading and clicking at about 2 s hung again twice. This lowers the odds at best, on small counts. It is not a fix.

## SDK 0.0.183: both findings fixed

Runs 1794244340183 (48 kHz) and 1794244550684 (44.1 kHz), 2026-11-09, `@opendaw/studio-sdk@0.0.183`, engine `447481d683c6`, the device at
44.1 kHz, 296 rows each, errored 0. Against the 0.0.182 register: 48 kHz 240 identical / 56 changed, 44.1 kHz 210 / 86. Every changed row
is one of three causes, read row by row in `table.ts` and, for the metronome stems, sample by sample:

- **The quarter-second tail is whole now** (`0f2b76d76`): every entire-song and `start` render, mix and stem, and the
  `section-marker-last` rows are 128 frames longer with no differing frame in the shared span (e.g. `core-none-start` 203 872 → 204 000).
  The by-design `trailing-silence-trimmed` rows read 81 120 / 74 129 frames (were 80 992 / 74 001); its pinned figure moved with them.
- **The gap rows render their range** (#534 fixed): 21 472 → 789 600 frames at 48 kHz, and they hold `section-is-slice`.
- **A loop pass is its whole frame count** (#533 fixed, `5f6b53791`): the 4 `one-frame` rows at 48 kHz (137 bpm) and 34 loop-twice /
  bounce-loop rows at 44.1 kHz (120 bpm) read `changed shift 1`, and hold their invariants; the larger figures (up to +5.0 dB) are the same
  one-frame shift on the denser aux, several and master signals. The same transport change moves one metronome click per stem: the
  metronome places a click at `floor(pulses_to_samples(beat − p0))`, and at 48 kHz the click at frame 72 000 now starts one frame earlier
  (onset 72 007 → 72 006; the other seven unchanged); the 4 metronome stems per rate differ from that click on, −31 dB (−30.2 at 44.1).

The table printed `no longer reproducing` for `loop-pass-one-frame-short`, `loop-bounce-last-frame-silent` and `long-silence-ends-render`;
all three are retired from `exportRegressionFindings.ts`. Standing in those runs: clean 242 / known 52 / failing 2 at both rates, the two
failing rows the trimmed-tail rows, whose label pinned the old frame count (`TRIMMED_FRAMES`, now 81 120 / 74 129). Re-run with the retired labels and the new figure, runs 1794246918474 (48 kHz) and 1794247036602 (44.1 kHz): **clean 242, known 54, failing 0,
errored 0** at both rates, against the register 240 / 56 and 210 / 86 as before (the renders are deterministic). The expected line below
moves to these counts once a person accepts the runs.

**Not accepted.** `--accept` writes the register and copies the WAVs of the changed rows into the library; it waits for a person's read
of the runs' tables.

## Reading recipe for an SDK bump

1. `export-regression-audit-debug-demo.html?rate=48000` on the dev server, a real click on Run about 30 s after load, the tab visible, 73 to 74 s, then `?rate=44100`. Standing is about the invariants alone, so read it with `data-register-counts` (identical, changed, unregistered) beside `data-standing-counts`: expect `296,0,0`. On the public host the page finds no register and has no sink, so every row reads `unregistered`, a callout says the run proves the invariants only, the state ends in `done:no-summary`, and `table.ts` finds no summary. The page reads `register/<rate>.json` and uploads a WAV only for a row that is not `identical`. A stall as above: reload, wait and run again.
2. `node scripts/audit/export-regression/table.ts <token> --library <clone>`, one per rate. Always pass the token: with none it reads the newest summary, a control run included, and prints that run's token and age first. A token whose summary is missing fails. The standings it prints are recomputed from the invariants by this build's findings, so a label retired since the run reads `failing`. A clone at `../opendaw-export-wavs` is found by itself. Cloning fetches the WAVs through LFS, and every download counts against the LFS bandwidth. With no clone, a run still reads `identical` or `changed` from the hashes.
3. Read `failing` first: a failed invariant no label matches. It cannot be accepted, even forced, a shift under a label included: read it, then change the label's rule or draft a defect. Then `changed` against the register: a render moved, and the line says by how much. `rounding-sized` is under −100 dB with no shift, and it is still `changed` and still needs a person. `--diff <rowId>` writes both WAVs for the audio-analyzer. Then any "no longer reproducing" line, which is a defect here being fixed.
4. A `known-finding` is a row whose signature still matches. It is not a pass: this note's reads are what it rests on.
5. `--accept --library <clone>` only after a person has read that run's table, and never on a run with a row failing or errored, a descending run, a row the catalogue does not hold or holds with other invariants (a summary from before the catalogue changed) or, without `--force`, a partial one. It writes the register and copies the new WAVs. Then in the clone `git add wav`, commit and push, and commit the register here.

**Expected on 0.0.182:** 296 of 296 `identical`; 48 kHz clean 237, known 59; 44.1 kHz clean 222, known 74.

Once a release ships a fix, the row's invariant holds, its hash moves so it reads `changed`, and the table prints `no longer reproducing: <finding>`. Retire the finding from `exportRegressionFindings.ts` then, and say so here.

## Limits

- One machine, one browser: Chrome on a Mac. Firefox and Safari have not run this page. The four single-stem rows have run with the device at 44.1 kHz only.
- **The neutral chains prove latency only.** A Compressor at ratio 1 and a Maximizer that never engages show that their delay is compensated, not that they process. The two engaged controls above are the only exception. Device coverage, every device through one path, is the second phase by the user's decision.
- `?uuid=descending` has run on `group=control` against the accepted register, the 3 bounce tap rows included, and not on the gap rows or the rest of the catalogue since those were added.
- The gap is one length, 15.8 s, at one bpm. The mix during a stem render is measured on two sibling renders and read in the engine, not observed inside the render (Finding 2).
- Parked items and known small gaps, from the build's ledger:
  - `position-*-loop-on-copy`: the second pass is judged only through its label, so once upstream changes the wrap it reads through the register alone. With the old read's tail gone *and* a second defect, nothing else sees it (ruled: a narrow blind spot).
  - The read allowance on `setposition-off-quantum` at 44.1 kHz fits a click near a zero crossing (above); `merge-seam-reseats-read`'s allowance at 44.1 kHz is shaped the same, up to +6.4e-4 / −2.1e-4, and an impulse past the seam 0.3 % low reads known. A register catches each after the first accept.
  - `section-marker-last`: only the frames inside the range are compared. A render short by up to 1000 frames past them reads through the register alone.
  - Not provoked: a row that fails while others reference it; the page's error path for a failed read; nothing compares `bounce-tail` and `section-entire` on the frames they share.
  - Rows and tests: a stems row through `start` on a looped project; a mono shift; a WAV with an extra or odd-sized chunk; a structural test that a row needing a reference has one; `readRender`'s parts tested only together.
  - Register: the copy and the write are not atomic; `runToken` and the read's other fields (`nonFinite`, `largestStep`, `energyPastRange`) are not validated on parse; a full run older than the register's `acceptedRunToken` overwrites it.
  - Small harness tidying: a remover's failure hides the original error, a no-op `loopArea.enabled` write on the live project, an unused pair of parameters on `buildHarnessProject`, a comment overstating "the parallel path".
