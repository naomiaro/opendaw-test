# Nano play modes: Mono / Poly, One-shot, Fixed pitch, Pan

**Status:** measured, every row as the crate documents it. A standing check after SDK upgrades (deterministic, no hardware, about three seconds per rate).
**SDK:** `@opendaw/studio-sdk@0.0.181` (the release that added the four fields, openDAW#467).
**Page:** [`nano-play-modes-debug-demo.html`](../../nano-play-modes-debug-demo.html) `[?rate=48000|44100][&row=all|<id>]`.
**Code:** rows and readers `src/lib/audit/nanoPlayModes.ts` (Node tests beside it), page `src/demos/instruments/nano/nano-play-modes-debug-demo.tsx`.

## Question

SDK 0.0.181 gave `NanoDeviceBox` four fields, `panning` (28), `polyphone` (29), `oneShot` (30) and `fixedPitch` (31),
and the Nano demo now binds them. Does each do what the crate says (`crates/stock-devices/device-nano/src/lib.rs`,
`voice.rs`, at the 0.0.181 tag): Mono fades the sounding voice over 5 ms (`FAST_RELEASE_SECONDS`, `lib.rs:36`) when a
new note starts; One-shot ignores the note-off unless the loop is on (`releases_on_note_off`, `voice.rs:33-35`); Fixed
pitch plays every key at the root key with Octave and Tune still applied (`voice.rs:171`); Pan keeps the near side at 1
and turns the far side down linearly (`apply_panning`, `lib.rs:255-258`)?

## Method

One Nano holds a 1 s sine at 440 Hz, root key 60, attack and release 1 ms, loop off unless the row says, the master
Maximizer removed. The region sits at bar 1 (120 bpm, so 2.0 s in) and the render covers it plus half a second. Each
row writes its own notes (velocity 1), sets the play-mode fields, renders offline through `renderOfflineSlice` and reads
the render with one of four readers:

- **overlap** (Mono / Poly): a quarter at key 60 (440 Hz) with an eighth at key 72 (880 Hz) starting halfway through it.
  The 440 Hz component's amplitude is read frame by frame by demodulating at 440 Hz and averaging over exactly one
  period (`toneEnvelope`): the period is a fractional frame count (109.09 at 48 kHz, 100.23 at 44.1 kHz) and the
  window's ends are interpolated with a cubic through the prefix sums, so the octave above averages out to under
  −80 dB at both rates. (The first draft rounded the period to whole frames; the octave then leaked at −47 dB at
  44.1 kHz and −55 dB at 48 kHz, and the Mono rows' "level after the fade" measured that leak, not the voice: a review
  finding, fixed before merge, the pass line of −40 dB having stood only 7 dB above the floor.) Figures: the first
  note's level over the 100 ms before the second note (dBFS), its level over 20..40 ms after the second's onset
  relative to that, the ms after that onset where it first reads 40 dB down, and the second note's own level over the
  same 20..40 ms (read at 880 Hz over one 440 Hz period, so the first note averages out of it too). Both notes must
  read above −20 dBFS, or a relative figure on silence (0 − 0 = 0 dB) would pass: a silent render reads
  `investigate`, "first note not sounding". Poly expects the first note within ±1 dB across the onset; Mono expects
  ≤ −40 dB and the 40 dB crossing in 3..9 ms (the voice's linear 5 ms fade is squared, so it reaches 1 % at 4.5 ms,
  and the reader averages over 2.3 ms, which can only move the crossing later: an instant cut reads about 2.5 ms and a
  2 ms fade under 4 ms, both `investigate`).
- **length** (One-shot): one eighth note (250 ms) at key 60; `readNotes` (the semantics audit's reader) gives its onset
  and end. Default and one-shot-with-loop expect 250 ± 10 ms, one-shot expects the whole sample, 1000 ± 10 ms.
- **pitches** (Fixed pitch): a quarter at key 60 and, a half bar later, a quarter at key 67; each read note's
  zero-crossing frequency within 5 cents of the expectation.
- **pan**: one eighth at key 60; each channel's peak over the louder channel's, within 0.01 of the pan law. The louder
  channel must peak above 0.1, or the ratio is read on nothing.

The sampler's own offset (the first row's first read onset against its pulse) places the overlap reader's windows.

## Runs

SDK 0.0.181, Chrome 156, the Mac's output device at 44.1 kHz (an offline-only audit: the device rate is not part of its
footing). Every row `as-expected` at both page rates, on the first run and on the re-run with the corrected reader.
Summaries in `.verify-output/` `nano-play-modes-summary-1793828658367.json` (48 kHz) and `…-1793828672896.json`
(44.1 kHz); the first-draft reader's runs are `…-1793827978887.json` and `…-1793827992644.json` (Mono at −59 / −51 dB,
the reader's floor).

| row | 48 kHz | 44.1 kHz |
| --- | --- | --- |
| poly-overlap | first note +0.00 dB across the second's onset; first −3 dBFS, second −3 dBFS | the same |
| mono-cut | −110.2 dB at 20..40 ms, 40 dB down after 6.1 ms; second −3 dBFS | −104.8 dB, 6.08 ms |
| one-shot-off | sounds 250.8 ms | 250.8 ms |
| one-shot | sounds 999.9 ms | 999.8 ms |
| one-shot-loop | sounds 250.8 ms | 250.8 ms |
| fixed-off | 440.0 Hz, 659.3 Hz | the same |
| fixed-pitch | 440.0 Hz, 440.0 Hz | the same |
| fixed-pitch-octave | 880.0 Hz, 880.0 Hz | the same |
| pan-centre | left 1.000 / right 1.000 | the same |
| pan-left | left 1.000 / right 0.000 | the same |
| pan-half-right | left 0.500 / right 1.000 | the same |

Instrument offset 5 frames at both rates: the reader's threshold crossing on the voice's 1 ms squared attack (a
synthetic tone with the same attack and no latency reads 5 too), not sampler latency; the overlap reader needs the
crossing, not the latency. The one-shot's 999.9 ms is the sine's 1 s less the reader's threshold at the
last cycle; the 0.8 ms over an eighth is the 1 ms release. A velocity-1 note renders at −3 dBFS (peak 0.7079), the
Nano's default gain.

## Reading a later run

A row that reads `investigate` is the finding; its figure says what moved. The expectations are the crate's documented
behaviour, not a register of a previous run, so there is nothing to accept. A row cannot pass on silence: the overlap
rows require both notes above −20 dBFS and the pan rows a peak above 0.1, and an overlap row whose offset could not be
read (no note in the first row's render) refuses rather than assuming zero. A render that throws ends the run in
`error:` (shared machinery); a row whose own pattern or settings are refused is a red row under `done`. A `mono-cut` whose 40 dB crossing leaves
3..9 ms is a changed fade length; a `one-shot-loop` that sounds 1 s is the loop no longer stopping a one-shot on its
note-off; a `fixed-pitch-octave` at 440 Hz is Octave no longer applying under Fixed pitch.
