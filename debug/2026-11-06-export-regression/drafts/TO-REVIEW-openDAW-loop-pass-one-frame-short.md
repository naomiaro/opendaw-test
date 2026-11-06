<!-- FOR NAOMI, REMOVE BEFORE POSTING: the repro URL and the note link below work only once feat/export-regression-harness is merged. Merge first, or hold this. -->

# A looped pass runs one frame short at some combinations of rate, length and bpm

**Version:** `@opendaw/studio-sdk@0.0.182`, Chrome 156, macOS. This is the frame your [#530 comment](https://github.com/andremichelle/openDAW/issues/530#issuecomment-6680737221) left open as "the single early frame at 44.1 kHz with no latency". That issue is closed, so here it is on its own. It is not specific to 44.1 kHz.

With a loop area on, a pass of a 4 s loop comes out one frame short at 48 kHz and 137 bpm, and at 44.1 kHz and 120 bpm (the first two passes measured, the rest emulated). The same whole-frame loop is exact at the neighbouring bpm.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?group=one-frame, and `&rate=44100` for the other rate (click Run, about fifteen seconds, no audio plays). `?group=core&rate=44100` shows it on every latency case.

**Measured.** Five impulses in a stereo probe sample, no device. "One pass" is one `step` over the section. "Two passes" is `renderSection` with `{type: "loop", passes: 2}`, the second pass kept. The same loop stepped by hand gives the same bits, so `renderSection` is not involved.

| Page rate | Section | Bpm | Source rate | One pass | Two passes, kept pass |
|---|---|---|---|---|---|
| 48000 | 4 s | 137 | 48000 | 4096 24037 72064 120037 168064 | **4095 24036 72063 120036 168063** |
| 48000 | 4 s | 137 | 44100 | 4458 26163 78437 130653 182927 | **4457 26162 78436 130652 182926** |
| 44100 | 4 s | 120 | 48000 | 3763 22084 66209 110284 154409 | **3762 22083 66208 110283 154408** |
| 44100 | 4 s | 120 | 44100 | 4096 24037 72064 120037 168064 | **4095 24036 72063 120036 168063** |

Every impulse is exactly one frame early. The other 20 combinations of page rate, source rate, length (0.9, 2, 4 s) and bpm (120, 137) read the same positions as one pass. The source rate does not move it, and a 48 kHz source on a 48 kHz page shows it, so resampling plays no part. At 44.1 kHz, 120 bpm, 4 s it is the same on all 11 latency cases I run.

**A looped bounce ends in a silent frame.** Through `AudioBounce`'s pieces with `loop: true` at 44.1 kHz, 120 bpm, 4 s, one frame differs from the stepped loop: the last, frame 176399. The bounce holds exactly 0 on both channels. The stepped loop holds 0.0707 on channel 0, its next pass's frame 1, which is also what shows that the second pass is one short. All other frames are bit-identical. The bounce has no loop area: it makes the region two loop durations long and keeps the second (`AudioBounce.ts:130`). The second cycle's start goes through `sample_of`, which truncates the same accumulated position (`audio_region_player.rs:868-869`, `:974-976`); emulated, it lands on frame 176399, not 176400. The region still ends at 352800, so the read reaches the source's end one frame early and the span's last frame reads past it (`:903-905`). My source is exactly one loop long; with a longer one the read would continue (read, not measured).

**Where it happens** (read at the tag):

- `render_quantum` advances the position by adding `samples_to_pulses(128, …)` per quantum (`crates/transport/src/transport.rs:218`, `:281`), so the position carries accumulated float error.
- At the loop's end the block is split by converting the remaining pulses to samples, truncating: `pulses_to_samples(action_position - p0, …) as i64` (`emit_until`, `:342`).
- When the accumulated position sits slightly above the exact one, the remainder comes out just under a whole number and truncates one lower. The comment above the loop check says "the pulse math is exact for round rates" (`:250`).

**Computed against measured.** I emulated those positions in Node, from `render_quantum`, `emit_until` and `crates/dsp/src/ppqn.rs`, for the 12 combinations of rate, length and bpm. It marks exactly the failing rows and no others, and it was written after the rows had read. It covers positions only, not audio.

| Rate | Section | Bpm | Loop end, ppqn | Last split, before truncating | Passes, emulated |
|---|---|---|---|---|---|
| 48000 | 4 s | 137 | 8768 | 127.999999997 | **191999** each |
| 44100 | 4 s | 120 | 7680 | 15.9999999955 | **176399** each |
| 44100 | 4 s | 137 | 8768 | 16.0000000008 | 176400 each |
| 44100 | 2 s | 120 | 3840 | 8.00000000089 | 88200 each |
| 48000 | 4 s | 120 | 7680 | 3.52e-9 | 192000 each |

The note has all 12.

**Not measured:** live playback, which shares this transport (so the same loop length is my inference), a looped bounce at 48 kHz and 137 bpm (I run `bounce-loop` at 120 bpm only; the emulation marks the same two combinations short for the cycle start and computes the same silent frame there), and a bounce laid back on a timeline to loop.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
