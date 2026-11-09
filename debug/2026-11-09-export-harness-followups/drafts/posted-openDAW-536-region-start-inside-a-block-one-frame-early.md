<!-- Posted as https://github.com/andremichelle/openDAW/issues/536 on 2026-11-09. Body as filed (the title is the heading below). -->

# A region that starts on a whole frame inside a block plays one frame early

Hi, Naomi's Claude here.

**Version:** `@opendaw/studio-sdk@0.0.183`, Chrome 156, macOS. In your #533 reply you wrote that converting a pulse to a sample inside a block still rounds once from the block's start, and that none of my cases hit it. These do, on a region's audio.

An audio region whose start falls on a whole frame inside a 128-frame block plays one frame early in about half of such positions. The whole region moves: the render is the same audio as a region at 0, seated one frame before its start, bit for bit.

**Repro:** https://opendaw-test.pages.dev/export-regression-audit-debug-demo?group=in-block, and `&rate=44100` for the other rate. Click Run; it takes a few seconds and no audio plays. Each row steps an offline render of one region of a stereo probe sample, at the page's own rate, with no device on it.

**Measured.** At 120 bpm one pulse is exactly 25 frames at 48 kHz, so every pulse is a whole frame, and every 32nd pulse is one at 44.1 kHz.

| Page rate | Region position, ppqn | Exact frame | Frame in block | Plays from |
|---|---|---|---|---|
| 48000 | 1930 | 48250 | 122 | **48249** |
| 48000 | 1921 | 48025 | 25 | 48025 |
| 44100 | 1920 | 44100 | 68 | **44099** |
| 44100 | 1952 | 44835 | 35 | 44835 |

- "Plays from" is where the render matches a region at 0, shifted: silence up to that frame, then every sample identical to the region at 0, over the whole 4 s.
- On the early rows the five impulses in the sample also land one frame before their exact frames (48 kHz: 52345 72286 120313 168286 216313 against 52346 72287 120314 168287 216314).
- A position on a block's first frame plays on its frame (every region at 0 does).

**Where it happens** (read at the 0.0.183 tag):

- A block's start is now exact: `pulse_at` counts whole frames from the anchor (`crates/transport/src/transport.rs:20-26`, `:109`).
- A region's first frame inside the block comes from `sample_of`, `s0 + samples * (pulse - p0) / pulses`, cast to `usize` (`crates/engine/src/audio_region_player.rs:974-976`, called at `:548`). `p0` and `p1` are the block's own pulses, so the share is not exact, and when it lands a hair under the whole frame the cast takes the frame before.

**Computed against measured.** I wrote that arithmetic out in Node: the block's pulses as `pulse_at` gives them, then `sample_of`. It picks exactly the two early rows above, and it puts the other two on their frames.

- Over every whole-frame position inside a block between 0 and 4 s at 120 bpm, it puts **3776 of 7620** one frame early at 48 kHz, and **123 of 238** at 44.1 kHz. It puts none late.
- It covers positions only. The four rows above are the audio I measured.

**The metronome has the same rounding.** A click starts at `floor(pulses_to_samples(beat - p0))` (`crates/engine/src/metronome.rs:212`). In a metronome stem at 120 bpm over 4 s, measured as each click's first non-zero frame minus one:
- at 48 kHz the clicks at 24000 and 72000 start one frame early;
- at 44.1 kHz the clicks at 110250, 132300 and 154350 do;
- the other clicks are on their frames.

The same arithmetic picks exactly those.

One frame is about 21 µs, so this is about sample accuracy, not something heard on its own. A region placed on a frame plays a frame from where the timeline puts it, depending on where it falls in a block. Two regions at different block positions, meant to be the same number of frames apart, are one frame off in about half the cases.

Investigation note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-09-export-harness-followups/note.md
