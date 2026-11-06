# Export regression: what the harness found on its first runs

**Title:** Every SDK export path, 289 rows at two page rates: what holds, what each row that does not hold measured, and why a
full run can stall in the OPFS worker

**Status: WAITING FOR THE USER'S READ.** No register is accepted: `--accept` waits for this read, and every row reads
`unregistered`. Nothing is posted and nothing is in the WAV library. Three drafts wait (below). The other findings are the
user's call, each with the read it got.

**Verified against:** `@opendaw/studio-sdk@0.0.182`, engine `9c44973549a7`, checkout at the tag (`766204efe`). Chrome
156.0.8078.81 (Playwright's), macOS 15.6.1. The Mac's output device read 44100 Hz (`new AudioContext().sampleRate` on a page,
2026-11-06). These renders are offline, and the page's own context takes the rate in the URL. Source citations are read at the tag.

**Labels:** *Measured* is from a run's WAVs or a probe's output. *Read* is code read in the checkout. *Computed* is arithmetic on
those. *Inferred* is a conclusion that nothing here observed directly.

## The harness

**Page:** [`export-regression-audit-debug-demo.html`](../../export-regression-audit-debug-demo.html)
`[?rate=48000|44100][&uuid=descending][&fill=1][&rows=<id,id>|&group=<group>][&failAt=<rowId>]`. A real click on Run, about 95 s for all
rows, no audio plays. Logic: `src/lib/audit/exportRegression*.ts`. Table and accept: `node scripts/audit/export-regression/table.ts [runToken] [--accept] [--force] [--library <path>] [--diff <rowId>]`.

Each row renders a copy of one project through one SDK export path (`step` in one call and in chunks, `start`, `renderSection`, stems, the
bounce's exported pieces, `setPosition`, a loop area) with one latency case (none, Autotune, Compressor on a track, a bus or an aux,
Maximizer, Fold, scripts, several together). The row is held to its invariants and later compared with the accepted register by hash.

**A label is not a pass.** A failed invariant whose render matches a measured signature reads `known-finding`, with the finding's
name. It means read and understood, not fine. A failed invariant with no such match reads `failing`, and `--accept` refuses it even forced.

## The runs

| rate | token | run line's counts |
|---|---|---|
| 48000 | 1794005822217 | clean 233, known finding 56, failing 0, errored 0 (289 rows) |
| 44100 | 1794005688755 | clean 218, known finding 71, failing 0, errored 0 (289 rows) |

Both with `?fill=1`, real clicks 30 s after load, every latency read `visible`. Tables: `.verify-output/exportreg-table-<rate>.txt`
(local; the run lines are the figures above).

| group | 48000 clean / known | 44100 clean / known |
|---|---|---|
| core | 89 / 32 | 78 / 43 |
| master | 19 / 3 | 19 / 3 |
| mix + stems | 28 / 0 | 28 / 0 |
| bounce | 16 / 4 | 12 / 8 |
| position | 0 / 12 | 0 / 12 |
| one-frame | 46 / 2 | 46 / 2 |
| tail | 4 / 3 | 4 / 3 |
| sweep | 22 / 0 | 22 / 0 |
| control | 9 / 0 | 9 / 0 |

| finding | rows at 48000 | rows at 44100 | where it stands |
|---|---|---|---|
| `loop-pass-one-frame-short` | 2 | 17 | [draft](./drafts/TO-REVIEW-openDAW-loop-pass-one-frame-short.md) |
| `loop-bounce-last-frame-silent` | 0 | 4 (the same rows as 4 of the 17) | in the same draft |
| `trailing-silence-trimmed` | 2 | 2 | [draft, a question](./drafts/TO-REVIEW-openDAW-entire-song-trailing-silence.md) |
| `jump-fade-at-start` | 30 | 30 | the user's call |
| `jump-fade-cold-maximizer` | 2 | 2 | the user's call |
| `reset-keeps-compensation-delay` | 11 | 11 | the user's call |
| `range-missing-tail` | 1 | 1 | the user's call |
| `loop-wrap-keeps-old-read` | 4 | 4 | the user's call |
| `merge-seam-reseats-read` | 4 | 4 | the user's call |

**Size.** Uploaded WAVs, 289 per rate: 428.3 MB at 48 kHz, 390.3 MB at 44.1 kHz. Most rows share a render: 69 distinct hashes, 91.3 MB at
48 kHz; 71 distinct, 86.8 MB at 44.1 kHz. No hash is shared between the two rates, so the library will take about 178 MB
(a private repository with LFS, `opendaw-export-wavs`, one commit so far: nothing accepted, no WAV in it).

## The controls

**An older SDK fires (measured).** `?group=core` on 0.0.181, 48 kHz, token 1794001338597, engine `3da5083093`: 47 clean, 74
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
- `planAccept` refuses both descending runs, unforced and forced.

**The neutral chains prove latency, not processing, so two controls say what they cannot (measured, both rates).**

- `control-compressor-engaged` (threshold −24, ratio 4, look-ahead on): tone peak 0.1059 against the neutral 0.5000, −13.48 dB, reported latency unchanged at 240 / 220.
- The bounce's three taps on that Compressor with the unit's fader at −6 dB: pre-fx bit-identical to the no-device render (tone 0.5000); pre-fader bit-identical to `control-compressor-engaged` (0.1059); post-fader exactly −6.000 dB from pre-fader (0.0531).

## Finding 1: a looped pass runs one frame short at some rate, length and bpm

**Draft:** [`drafts/TO-REVIEW-openDAW-loop-pass-one-frame-short.md`](./drafts/TO-REVIEW-openDAW-loop-pass-one-frame-short.md). This answers the unexplained
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
- In the rest of the catalogue: 11 `core-*-section-loop-twice` and 4 `bounce-*-bounce-loop` rows at 44.1 kHz (4 s, 120 bpm), on every latency case.

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

**The emulation predicts exactly the failing rows and no others.** It was written from the source after the rows had read, so it explains them rather than having called them in advance. Two reviewers checked it, and I wrote it again for this note with the same result. It covers positions, not the audio.

**The looped bounce's last frame (measured, 44.1 kHz, 120 bpm, 4 s, 4 rows, `loop-bounce-last-frame-silent`).** Exactly one frame differs from the stepped loop: frame 176399, the last, on channel 0. The bounce
holds 0 on both channels, and the stepped loop holds 0.07072490, which is the source's frame 1. So the stepped loop is one frame into its third pass, which fits a second pass one short.
*Read:* `AudioBounce.ts:130` makes the region two loop durations long and the render keeps the second, so a short first pass ends the region a frame before the span does. Past the region's end nothing reads.

**Inferred, not measured:**

- A bounce of a loop laid back on a timeline to loop has a one-sample dropout at each repeat.
- Live playback shares this transport, and so this loop length.
- The looped bounce at 48 kHz and 137 bpm does the same. The catalogue has `bounce-loop` at 120 bpm only. Its loop is `audio_region_player.rs`'s, which I did not emulate.

## Finding 2: an entire-song render stops after 10 s of silence

**Draft, written as a question:** [`drafts/TO-REVIEW-openDAW-entire-song-trailing-silence.md`](./drafts/TO-REVIEW-openDAW-entire-song-trailing-silence.md). The user decides whether it goes.

**The catalogue's rows (measured, `tail-none-section-entire-long`, `tail-none-start-long`).** A 4 s region holding a 0.2 s burst through a default Reverb. The render is bit-identical to the 4 s reference as far as
it goes, then ends: 80992 of 192000 frames at 48 kHz, 74001 of 176400 at 44.1 kHz.

**A region after a long gap (measured once at 48 kHz, a console probe on the page, not a catalogue row).** The same project with the region copied to a later position, through `OfflineEngineRenderer.start`:

| second region at | `lastRegionAction`, s | frames rendered | seconds | last sample over 0.01 at |
|---|---|---|---|---|
| none | 4 | 80992 | 1.687 | 0.562 s |
| 6 s | 10 | 368992 | 7.687 | 6.562 s |
| **16 s** | **20** | **80992** | **1.687** | **0.562 s: the second region is not in the render** |
| **30 s** | **34** | **80992** | **1.687** | **0.562 s: the second region is not in the render** |

**Read.** `offline-worker.ts:426` breaks out of `render` once 10 s of silence has passed (`:399`), and `:440` keeps at most a quarter of a second of it. Nothing in that loop looks at the song's end.
`MixdownSection.ts:21` gives "Entire song" `tail: true`, and `Mixdowns.ts:28` sends it to `start`. A bounce keeps its span: "The exact span is always kept, a tail only adds what is still audible after it" (`AudioBounce.ts:138`).

**Computed.** Last frame over the −72 dB threshold: 68992 at 48 kHz (80992 − 12000), 62976 at 44.1 kHz (74001 − 11025), about 1.43 s. So on this project a region starting after about 11.4 s is lost.

Not run: the last marker section, which `collect` also marks `tail: true`, with a gap. Unknown: whether upstream means this. **I would add a catalogue row for the gap if the user wants it standing.**

## The others: the user's call, no drafts

Each paragraph gives what was measured, then my read. My read is not a decision.

**`jump-fade-at-start`** (30 rows at each rate: `section-marker`, `section-marker-last`, `setposition-*`). At 48 kHz the row differs on frames 0..239 only, rendered / reference exactly i/240, then bit-identical. At 44.1 kHz the same fade over 221 frames, then a
difference across the whole render on the impulses: −56.6 dB from a 1 s start, −47.0 from 3 s, −50.0 from 2.13 s. Read: `audio_region_player.rs:862` fades in when a block is discontinuous and past the region's start, and upstream's test
`transport_jump_inside_a_native_region_crossfades` pins it. The 44.1 kHz remainder is `:849` dividing two f32 rates, so a free-running read drifts 3.73e-8 source frames per output frame; computed × the 0.9 impulse, that gives all three figures exactly. My read: by design for a live
jump, a question for an export, whose first block is treated as a jump. The drift is rounding-class. A residual: on the 4 `setposition-off-quantum` rows at 44.1 kHz a single click fits the per-frame allowance, up to +0.0073 / −0.0024 (bisected).

**`jump-fade-cold-maximizer`** (2 rows at each rate: `master-{none,compressor-track}-section-marker`). The fade above, and the master Maximizer starting cold. At 48 kHz the render differs on frames 0..3430, up to 1.48× the reference after the fade, largest difference −0.7 dB. It is within
rounding of the warm limiter from frame 1168 at 48 kHz and 1627 at 44.1, bit-identical from 3431 at 48 kHz. Not an invariant of any row: the section's peak is 1.46, its 182 samples over 1.0 end at frame 445; `master-none-step-one` has 166 over 1.0 ending at frame 205, peak 1.50. Read: with look-ahead off the Maximizer applies its gain
directly with no hard clamp (`device-maximizer/src/lib.rs`). My read: by design. A hot render through the default Maximizer exceeds 1.0 for its first 5 to 10 ms.

**`reset-keeps-compensation-delay`** (11 rows at each rate: the latent `*-step-reset`). A second play on one renderer after a stop with reset: from `latency` on, the render is the reference delayed by exactly the reported frames, bit-identical on all 11 at both rates. The first frames are silent (`several`: at most 0.0031 at 48 kHz, 0.0023 at 44.1).
Read: `offline-worker.ts` spends the trim once, in `settle` and `trimStart`. Inferred, not checked across every caller: no SDK export path replays on one renderer. My read: a limit more than a defect today.

**`range-missing-tail`** (1 row at each rate: `tail-none-section-marker`). A section starting after the region's end renders silence, peak 0, over 96000 / 88200 frames, against a reference still ringing at about −54 dB. Read: a render starts cold and `renderSection` has no pre-roll. My read: by design as coded. It costs a user any tail from before the range, and whether that is acceptable is the user's question.

**`loop-wrap-keeps-old-read`** (4 rows at each rate: `position-*-loop-on-copy`). At a wrap to the region's start the new pass is at full level with the old read on top, fading linearly from 1.0 to 0 over 240 frames at 48 kHz, 221 at 44.1. A 0.5 sine reaches 0.975, about +5.8 dB; the largest step is 0.1299 at frame 96001 (0.1411 at 88201). Past the window it is
bit-identical to a fresh pass. 997 Hz × 2 s is a whole number of cycles, the worst case by construction. Read: `audio_region_player.rs:322` seeds the old read's tail and `:862` fades in only past the start; upstream's test `transport_jump_to_the_region_start_keeps_the_onset` says "only the old read fades out", runs below full scale and pins no level. My read: by design, with an unpinned side effect. In-phase material doubles for 5 ms, which could clip a hot loop; not measured on hot material.

**`merge-seam-reseats-read`** (4 rows at each rate: `bounce-*-bounce-merge`). At 48 kHz, 225 frames differ between 96014 and 96959, inside the 20 ms after the seam, largest −150.5 dB; channel 1 is identical. At 44.1 kHz, bit-identical to the seam, then −73.4 dB on the tone and −50.6 dB on the two hits past the seam. Read: `audio_region_player.rs:942`, the first region's tail overlaps the
second's fade-in on the same frames, and the second read is seated at the exact position (`:884-888`), leaving the free-running drift behind; computed 2 s × 44100 × 3.73e-8 × 0.9 = −50.6 dB, matching. My read: by design, rounding-class.

## The OPFS hang

**Symptom (measured).** A full run stalls at `one-frame-none-step-one-44100-2-120`, row 235, always that row, at either rate. The console reads `[OPFS] write 'samples/v2/8731c112-4aba-4cee-acef-72e7c030da12/audio.wav' runs for 5.0s at 'create sync access handle'`, then `has no answer from the worker after 10.0s`.
Then the row and those sharing its sample time out at 60 s each; a later row with another sample was never reached in the runs logged. `peaks.bin` and `meta.json` of that sample were written and `audio.wav` is 0 bytes. The renders are not affected: 235 WAVs from two aborted runs were byte-identical to the completed run. No summary is written.

| Run clicked, after load | rate | hangs |
|---|---|---|
| about 2 s, full catalogue | 44.1 kHz | 3 of 4 (the three in a row earlier, then one pass, token 1794007165739, on this task's re-run) |
| about 2 s, full catalogue | 48 kHz | 0 of 1 |
| about 30 s, full catalogue | both | 1 of 13 (8 at 48 kHz, 5 at 44.1; the hang at 48 kHz) |
| about 2 s, `?group=one-frame`, the same sample | 44.1 kHz | 0 of 2 |

**What the hang is not.**

- *Two writes holding one content-addressed sample's handle.* Read: `GlobalSampleLoaderManager.#load` keeps one load per uuid through `#pending`, and `OpfsWorker.#acquireLock` serialises each path. A second handle on an open file rejects rather than waits (a web-platform test reads so). Measured earlier: with the page hung, a fresh worker opened that same `audio.wav` through `createSyncAccessHandle` in 0.7 ms, so nothing held it.
- *The sweep at page load.* Read: `clearStoredSamples` is awaited before the page goes on, and the file is created long after it. No evidence for it, and it does not explain one row.
- *A harness fault.* The harness only asks for samples. The call that never settles is the SDK worker's, on a file it has just created.

**The cause, reproduced: the promise is lost when the `FileSystemFileHandle` is collected in flight.**

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
- *Burn, wrapper holds each handle until its promise settles:* 0 collected while pending, none lost in the 1347 opens read before the end, the run completed (token 1794006971612), all 289 hashes equal to the 44.1 kHz run above.

**Inferred, and not caught.** That the natural hang is this. The evidence: the same step and lines, a promise that never settles and never rejects, a file nothing holds, and only one of the three files lost, which fits a collection landing inside one open's flight.
What I did not get: an observed natural hang with the observer attached. Two runs with a wrapper at the 2 s click (one watching every open, tokens 1794006553434; one only `audio.wav`, 1794007066683) and the plain re-run all passed, and a wrapper changes the worker's allocations. So the wrappers may have moved the collection, or the hang may have been rarer than its first three runs read.

**Also inferred.**
- Why one row: the worker's allocations follow the catalogue, so a collection lands at the same place, and row 235's fresh 705 KB message is a large allocation. An idle wait before Run changes the heap, hence the click-time difference.
- Why not early opens: first losses at open 172 and 190, and the SDK's at 557, fit an optimizing tier saving only live registers across the await, with the frame unoptimized before that holding the handle. I have no trace of that tier-up.

**Reach (read).** Every `Workers.Opfs` read and write opens through `#resolveFile`. A lost open never answers and keeps that path's lock for the life of the worker, so later operations on the path wait behind it. A sample's load or a recording's save is built on those calls and would wait with them; I measured the load only. The SDK's 5 s and 10 s warnings are what names it.

**Standing.** Not a harness fault. A Chromium behaviour reproduced without the SDK, with an SDK path exposed to it, so a draft: [`drafts/TO-REVIEW-chromium-sync-access-handle-lost-on-collection.md`](./drafts/TO-REVIEW-chromium-sync-access-handle-lost-on-collection.md). Not tried: Firefox, Safari, the user's own Chrome. The Chromium tracker has not been searched; a web search found no report, so search it before posting. No entry in `docs/known-vendor-issues.md` yet: it goes in with the user's read.

**For a person running the page.** A run stuck on a row with those two console lines is this. Its rows error at 60 s each. Reload and wait about 30 s before Run: both times that was done right after a hang, the run passed. Reloading and clicking at about 2 s hung again twice. This lowers the odds at best, on small counts. It is not a fix.

## Reading recipe for an SDK bump

1. `export-regression-audit-debug-demo.html?rate=48000`, a real click on Run about 30 s after load, the tab visible, about 95 s, then `?rate=44100`. A stall as above: reload, wait and run again.
2. `node scripts/audit/export-regression/table.ts <token>`, one per rate. Always pass the token: with none it reads the newest summary, a control run included.
3. Read `failing` first: a failed invariant no label matches. Then `changed` against the register: a render moved, and the line says by how much (`--diff <rowId>` with the library). Then any "no longer reproducing" line, which is a defect here being fixed.
4. A `known-finding` is a row whose signature still matches. It is not a pass: this note's reads are what it rests on.
5. `--accept` only after a person has read that run's table.

Once a release ships a fix, the row's invariant holds, its hash moves so it reads `changed`, and the table prints `no longer reproducing: <finding>`. Retire the finding from `exportRegressionFindings.ts` then, and say so here.

## Limits

- One machine, one browser: Chrome on a Mac. Firefox and Safari have not run this page.
- **The neutral chains prove latency only.** A Compressor at ratio 1 and a Maximizer that never engages show that their delay is compensated, not that they process. The two engaged controls above are the only exception. Device coverage, every device through one path, is the second phase by the user's decision.
- `?uuid=descending` was not repeated for the 3 bounce tap rows.
- The gap measurement above is one console probe at 48 kHz, on `start`.
- Parked items and known small gaps, from the build's ledger:
  - `position-*-loop-on-copy`: the second pass is judged only through its label, so once upstream changes the wrap it reads through the register alone. With the old read's tail gone *and* a second defect, nothing else sees it (ruled: a narrow blind spot).
  - The read allowance on `setposition-off-quantum` at 44.1 kHz fits a click near a zero crossing (above); `merge-seam-reseats-read`'s allowance at 44.1 kHz is shaped the same, up to +6.4e-4 / −2.1e-4, and an impulse past the seam 0.3 % low reads known. A register catches each after the first accept.
  - `section-marker-last`: only the frames inside the range are compared. A render short by up to 1000 frames past them reads through the register alone.
  - Not provoked: a row that fails while others reference it; the page's error path for a failed read; nothing compares `bounce-tail` and `section-entire` on the frames they share.
  - Rows and tests: a stems row through `start` on a looped project; a mono shift; a WAV with an extra or odd-sized chunk; a structural test that a row needing a reference has one; `readRender`'s parts tested only together.
  - Register: the copy and the write are not atomic; `runToken` and read fields are not validated on parse; a full run older than the register's `acceptedRunToken` overwrites it.
  - Small harness tidying: a remover's failure hides the original error, a no-op `loopArea.enabled` write on the live project, an unused pair of parameters on `buildHarnessProject`, a comment overstating "the parallel path".
