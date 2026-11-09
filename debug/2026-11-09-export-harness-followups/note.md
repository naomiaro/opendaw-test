# Export harness follow-ups: twelve rows from the #533 and #534 replies

**Title:** A region that starts on a whole frame inside a block plays one frame early, an export range's end is a minimum, and what markers, loop wraps and a gap inside a range do on 0.0.183

**Status: MEASURED. The region start is FILED as [openDAW#536](https://github.com/andremichelle/openDAW/issues/536) (2026-11-09)**, body as filed in
[`drafts/posted-openDAW-536-region-start-inside-a-block-one-frame-early.md`](./drafts/posted-openDAW-536-region-start-inside-a-block-one-frame-early.md).
The range question is withdrawn, because upstream's own plan answers it (5, below):
[`drafts/withdrawn-openDAW-export-range-end-is-a-minimum.md`](./drafts/withdrawn-openDAW-export-range-end-is-a-minimum.md). The 12 rows are accepted into the register (2026-11-09, the user's word): runs 1794253004161 (48 kHz) and 1794253155843 (44.1 kHz), 9 WAVs per rate, library commit `e5dcaa1`.
The user's decision stands for #533 and #534: no follow-up comments there.

**Verified against:** `@opendaw/studio-sdk@0.0.183`, engine `447481d683c6`, checkout at the tag (`81dc378c8`). Chrome 156 (Playwright's),
macOS 15.6.1. The rows, the harness, the register and its reading recipe are the export regression harness's:
[`2026-11-06-export-regression/note.md`](../2026-11-06-export-regression/note.md), whose run table lists these runs.

**Labels:** *Measured* is from a run's WAVs or a probe's output. *Read* is code read in the checkout. *Computed* is arithmetic on those.

**Repro:** [`export-regression-audit-debug-demo.html`](../../export-regression-audit-debug-demo.html) with `?group=in-block`, `?group=marker`,
`?group=wrap`, `?rows=gap-none-range-start,gap-none-range-stem-start` or `?rows=range-none-start-ends-in-sound`, and `&rate=44100`.


Upstream's replies to [#533](https://github.com/andremichelle/openDAW/issues/533) and [#534](https://github.com/andremichelle/openDAW/issues/534)
named four behaviours no row reached. 11 rows cover them, and the stems' metronome rows carry one new invariant; a twelfth row (5, below)
asks what an export range does at its end. **The user's
decision: no follow-up upstream**, not on either issue and not as a new one. The new rows read `unregistered` until a person accepts them.
Runs 1794251449772 (48 kHz) and 1794251607099 (44.1 kHz), both `&fill=1`, 2026-11-09, `@opendaw/studio-sdk@0.0.183`, engine `447481d683c6`, the device at 44.1 kHz,
307 rows each: **clean 246, known 61, failing 0, errored 0** at both rates. The 296 accepted rows read `identical`, so nothing in them moved.

**1. A pulse inside a block rounds early (measured; label `in-block-pulse-rounds-early`; filed as [openDAW#536](https://github.com/andremichelle/openDAW/issues/536), the region start and the click together).** Upstream: "Converting a pulse
to a sample inside a block still rounds once from the block's start … none of your cases hit it." Since 0.0.183 a block's start is
exact (a whole frame count from the anchor, one division), and a pulse inside the block is converted from that start's pulse.
`exportRegressionInBlock.ts` writes out the engine's two conversions. *Read:* a click at
`floor(pulses_to_samples(beat − p0))` (`crates/engine/src/metronome.rs:212`) and a region's start at `sample_of`, the block's share of the
pulse, truncated (`audio_region_player.rs:974-976`). Its tests hold it to the clicks measured on 0.0.183.

- *Clicks.* `clicks-on-beat-frame` on the 4 `stems-*-stems-metronome` rows holds each click to its beat's frame (120 bpm: every beat
  a whole frame), read as the first non-zero frame on the metronome stem, less one. Measured: 48 kHz, the clicks at 24000 and 72000
  start a frame early. 44.1 kHz: 110250, 132300 and 154350. The other clicks are on their frames, and the arithmetic marks exactly these, at both rates.
- *A region's start (new).* The `in-block` rows start the probe's region on a whole frame inside a block, at the page's own rate. One start is the first
  after 1 s that the arithmetic places a frame early, the other the first it places on its frame: 48 kHz ppqn 1930 (frame 48250) and 1921
  (48025); 44.1 kHz ppqn 1920 (44100) and 1952 (44835). **Measured: the predicted-early region plays a frame early at both
  rates, all five impulses one frame before their computed frames** (48 kHz: 52345 … 216313 against 52346 … 216314). And it is the
  whole region: `region-seated-on-start` reads the render as silence up to frame 48249 (44099 at 44.1 kHz), then the same-rate reference
  from its first frame, bit for bit, over all 4 s (runs 1794252503374 and 1794252536982, `?group=in-block`). The on-time control holds
  both invariants, seated on its own frame. Computed over 1 to 4 s at 120 bpm: of the whole-frame starts inside a block, 3776 of 7620
  land early at 48 kHz and 123 of 238 at 44.1. So about half of them do, by one frame, and the region's whole read moves with its start.
- The signature holds every event to the arithmetic's frame and needs at least one off its exact frame. On a region, the events are
  the impulses and the seat. Only a render that is the reference seated exactly at the arithmetic's frame matches. A region a frame early with
  anything else wrong reads `failing`, and so does one two frames off. A click or a region early
  where the arithmetic says on time, a late one, or a missing one stays `failing` (tested).
- *Not covered:* a note-on inside a block (the harness has Tapes only), and other bpm. Upstream said none of the filed cases hit the rounding. The region rows
  are the first case here that does, on audio. Whether that changes "label, not file" is the user's call.

**2. A marker's section played twice, then falling through (measured, clean).** `MarkerBox.plays` (schema default 1, 0 is forever).
`crates/transport/src/transport.rs:317-328` repeats while `count + 1 < plays` and otherwise falls through with no jump. Upstream fixed a
marker exactly on a block's end being missed. The `marker` rows put Marker 1 at 1 s (ppqn 1920) and Marker 2 at the first whole frame from 2 s
on a block's end (48 kHz ppqn 3840, frame 96000; 44.1 kHz ppqn 4096, frame 94080) or 64 frames into a block (3904 / 97600; 6144 / 141120),
at the page's own rate. They are stepped with the marker track on, which `renderSection` turns off.

- `marker-none-plays1-block-end`: played once, the render is the reference's bit for bit (the same hash at 48 kHz). A control
  that markers alone change nothing, not coverage of the block-end fix: with one play a missed marker is not heard. The plays-2 rows
  carry that.
- `marker-none-plays2-*`: `impulse-follows-playback` (the reference's hits carried through 0..M2, M1..M2 again, then M2 on) and
  `jumps-crossfade` (below) hold on a block's end and inside one, at both rates.
- `marker-none-plays2-block-end-start`: `start` leaves the markers on, and its render is the stepped one over the stepped one's range,
  bit for bit. It runs past that range by the quarter second of silence it keeps.

**3. The jump flag on a wrap at a block's end (measured, clean).** Upstream fixed a wrap on a block's last frame that lost the
discontinuous flag for the next block. *Read:* the flag is what seeds the old read's 5 ms fade-out (`audio_region_player.rs:321`) and, past a
region's start, the new read's fade-in (`:862`). So a lost flag shows in the samples. The `wrap` rows loop on the copy from 0 to the
first whole frame from 1.5 s that is on a block's end, on its last frame, or a frame past it. At 48 kHz that is ppqn 2944 / 2903 / 2985, frames 73600 / 72575 /
74625. At 44.1 kHz it is 4096 / 3104 / 5088, frames 94080 / 71295 / 116865 (from 2 s, the last-frame end would be 3.75 s). Page rate as source rate.
`jumps-crossfade` holds the whole render to a model of what plays. Each segment is the reference from its source frame. At a jump, the
read it left goes on from where it was, fading linearly to 0 over 5 ms, and, past the region's start, the new read fades in over
the same window. Holds within 2e-7 on all six rows, every wrap included. A wrap with no old read under it fails (tested). The 48 kHz
2 s loop the `position` rows already had is on a block's end too. It did not move on 0.0.183: computed, the old accumulated position put
that wrap a hair after the block's end, at the next block's start, where the flag was raised in the block itself.

**4. The gap inside an `ExportConfiguration.range` (measured, clean but for the start's fade).** 0.0.183 sets `minDurationSeconds` to the range's
length (`OfflineEngineRenderer.ts:271-282`). `gap-none-range-start` (mix) and `gap-none-range-stem-start` (the source's stem alone)
pass a range from 0.1 s to 16.2 s through `start`. It starts inside the first burst, so the range holds sound before the gap, since silence
before the first sound never counts. **Both render the whole range, the second burst included**: 784864 frames at 48 kHz, 721041 at 44.1.
They are bit-identical to the stepped gap from frame 240 at 48 kHz, and within the 48 kHz source's read drift at 44.1. Their one difference is the start's 5 ms fade, a jump into a region, so
they carry `jump-fade-at-start`. On an exported range that label now accepts a render longer than the range, since `start` keeps its quarter second of silence.
Before 0.0.183 these would have stopped at about 10.2 s (computed from [Finding 2's rule](../2026-11-06-export-regression/note.md#finding-2-an-entire-song-render-stops-at-10-s-of-silence-even-when-regions-follow-and-they-are-missing-from-the-file)).

**The device rate moves none of them (measured).** The same catalogue with the device at 48 kHz: 1794252210443 (48 kHz page) and
1794252329469 (44.1 kHz page), each clean 246 / known 61, and `table.ts --compare-device` against the runs above reads `307 of 307 rows
identical` at both page rates. That covers the 11 rows and the four single-stem rows the first device proof never rendered.

**5. A range whose end is inside sound does not stop there (measured; label `range-end-is-a-minimum`, as upstream's plan records it).**
`range-none-start-ends-in-sound` passes a range of 0 to 2 s of the 4 s probe, which sounds throughout, to `start`. It comes back as **204000
frames at 48 kHz and 187537 at 44.1** (runs 1794252850097 and 1794252902633). Those are the quantum holding the song's last sample (192000,
176512) plus exactly a quarter second. That is the whole song, bit for bit the stepped reference over its 4 s, so 2 s of music past the range's
end. *Read:* `start` makes the range's length `minDurationSeconds` and adds 30 s for `maxDurationSeconds`
(`OfflineEngineRenderer.ts:271-282`), and `render` stops only on 10 s of silence past the minimum. The API does not document the end as a minimum (upstream's plan does, below): `ExportRange` carries no comment, and the commit that added it (`33b4e72ba`, "export config") has no description. The
studio passes no range: every `start` caller was read on 2026-11-09 (the mixdown and stems export with `{stems}` or `{stems,
metronome}`, freeze with `{stems}`, SoundCloud, Publish, AutoEq and Contest with none). Our export chapter said the render runs on "until the tail has decayed", which
understates it. The timeline plays on, so it now says that. `frames-as-expected` holds the row to the range's 2 s. The label
matches only a render that ran to the song's last quantum and a quarter second, and anything else reads `failing`.
No demo here passes a `range`. The demos' range exports step an exact frame count (`src/lib/rangeExport.ts`, whose header already
says `render` "would render past the range while content continues", and `renderOfflineSlice`), and `start` serves only the full song.
So this costs the demos nothing; it is for other callers of the SDK. Upstream has written this down, in a plan rather than in the API: openDAW
`plans/issues/434-mixdown-sections.md:21-24` says `start` with a range "stops on 10 s silence or `end + 30 s`. So a range today still
renders a tail, never ends sample-exact", and that no UI sets it. Its remedy was `renderSection`, which ends sample-exact for every
section except Entire song and the last marker (`:14`, `:54-56`). Found through XERJ after the question was drafted, so the draft is
withdrawn: [`drafts/withdrawn-openDAW-export-range-end-is-a-minimum.md`](./drafts/withdrawn-openDAW-export-range-end-is-a-minimum.md).
