# OpenDAW SDK Changelog: 0.0.182 → 0.0.183

Published 2026-11-09 09:02 UTC, three days after 0.0.182. 45 commits tag-to-tag (one a merge, `99a86514d`, the `scales`
branch), 121 files under `packages/lib`, the studio sub-packages and `crates`. The release is the maintainer's **key and chord
week**, and for this repo it closes the two issues the export regression harness filed (openDAW#533, #534). What matters
for this repo:

1. **The transport counts frames from an anchor, so every position moves at sub-frame level (openDAW#533 FIXED).**
   `crates/transport/src/transport.rs` no longer adds `samples_to_pulses(128)` per quantum: the position is
   `anchor + frames_to_pulses(frames since the anchor)`, re-anchored on a seek, a loop wrap, a marker jump and a bpm change. A loop
   that is a whole number of frames long now plays exactly that many on every pass, live and offline, and a looped bounce no longer
   ends on a silent frame. A loop end or marker exactly on a block end now flags the next block as a jump, and a marker there repeats
   or falls through as it should. **What the registers read of it:** the export harness's `loop-pass-one-frame-short` (19 rows) and
   `loop-bounce-last-frame-silent` (4 rows) no longer reproduce, and the 34 loop-twice / bounce-loop rows at 44.1 kHz and 4 at 48 kHz
   (137 bpm) read `changed shift 1`; `render-section-latency` at 44.1 kHz lost its "1 early" two-pass baseline (now 0); a metronome
   click whose beat falls mid-block can land one frame earlier (the metronome floors `pulses_to_samples(beat − p0)`, so a float a hair
   under a whole frame drops one: the 4 metronome stems per rate differ from one click on, frame 72 000 at 48 kHz and 22 050 at 44.1,
   −31 / −30 dB, the same click count; at 48 kHz that click's onset moved from frame 72 007 to 72 006 and the other seven did not); the
   MIDI effect semantics audit reads 2 rows `changed, rule holds` at 48 kHz and 4 at 44.1, every one a note the reader cannot judge
   (overlapping notes; the judged tally is unchanged). Recording alignment moved a tally bucket by 0.01 ms (below).
2. **An entire-song render runs at least to the end of the last region, and keeps a quarter second after the last sound (openDAW#534 FIXED).**
   `OfflineEngineRenderer` passes `minDurationSeconds` (the range's length; new optional field on `OfflineEngineRenderConfig`) and
   the silence check moved into `core-wasm/src/silence-tail.ts` (`SilenceTail`): 10 s at or below −72 dB ends a render only after
   that minimum. The kept tail is a whole `sampleRate / 4`, **128 frames more than before**, so every entire-song and `start` export
   is 128 frames longer with the shared span bit-identical (measured on every such row of the export harness, both rates). The gap
   rows render their full range (789 600 frames at 48 kHz, was 21 472). A direct `render()` without `minDurationSeconds` still stops
   at the first 10 s gap.
3. **A transaction that ends with two warp markers at one position panics.** `Project` installs `WarpMarkerGuard`
   (`core/src/project/audio/WarpMarkerGuard.ts`): at the end of every transaction it checks the play-mode boxes whose markers were
   touched and `panic`s on a duplicate position; states inside the transaction are not checked. Migration now also dedups
   `AudioSignalsmithBox` markers, and trimming a stretched region's start shifts its markers in an order that never lands one on
   its neighbour. **What the demos write of it:** `buildWarpAnchors` (`src/lib/beats/beatMapConversions.ts`) could round a file end
   less than half a pulse after the last beat onto the last beat's tick; it now drops that outro anchor (Node test). Every other
   marker writer here writes distinct ticks (beats a quarter apart, the time-pitch demos' `0` and the region's length).
4. **Schema defaults for parameters that had none.** Revamp Pass `order` 1 and `q` √½, Shelf / Bell `gain` 6 dB, Bell `q` √½;
   Reverb `preDelay` 0.001 s (was 0.0, under its own minimum); Vaporisateur cutoff 8000 Hz, resonance 0.1, attack 0.005 s, release 0.5 s.
   These match what the factories already set, so a device made by a factory is unchanged; a box loaded from a project resets to them
   (`AutomatableParameterFieldAdapter.resetValue`, new getter). The low and high-pass biquads clamp Q to 1e-6, so a Q of 0 no longer
   turns the output NaN. Nothing here creates these boxes outside a factory.
5. **Key and chord tracks, Scale Matrix, and devices that follow them.** `TimelineBox` keys 24 `keyTrack` and 25 `chordTrack`
   (`KeyTrack`: `events`, `root`, `scale`, `enabled`; `ChordTrack`: `events`, `enabled`); `KeyEventBox`, `ChordEventBox` and adapters;
   `TimelineBoxAdapter.keyTrack.keyAt(ppqn)` → `Harmony.Key`, `.chordTrack.chordAt(ppqn)` → `Option<Harmony.Chord>`; `ChordOverlaps`;
   lib-dsp exports `harmony` and `chord-detection`. A new MIDI effect **Scale Matrix** (`EffectFactories.ScaleMatrix`, in `MidiNamed`
   between Pitch and Spielwerk; `ScaleMatrixDeviceBox`, `ScaleMatrixDeviceBoxAdapter`, `device_scale_matrix.wasm`). The Arpeggio gains
   `followChords` (key 21, default off) and Autotune `follow` (key 16, default off). Scripts in Spielwerk, Werkstatt and Apparat read
   `this.keyAt(position)` → `{root, steps}` and `this.chordAt(position)` → `{root, notes} | null`. `Pointers.KeyTrack = 68`,
   `ChordTrack = 69`; studio settings gain `key` and `chords` track visibility. Nothing here uses them; the MIDI Effects pages pick
   their five devices by key, so the new entry in `MidiNamed` changes nothing there (the intro's "the five stock MIDI effects" now
   reads "five stock MIDI effects").
6. **The Arpeggio ends its sounding notes when the transport starts or stops** (`b6afafb18`). A step note used to sound on after a
   stop until the engine's own count passed its end. No audit row stops the transport mid-note; the semantics registers hold.
7. **The engine survives a sidechain feedback loop** (`7ec71eed4`, live errors 1223/1224). The engine recognises a loop and sends
   `EngineToClient.notice` (`EngineNotice`: `sidechain-loop` {device, source} or `non-finite` {device}); a device on the loop that
   overflows is silenced and reset. Nothing here builds such a loop.
8. **Smaller fixes**: the engine takes one allocation per sample request and ignores a second, and frames past the allocation crash
   with a report (`97da0d7ad`); Flatten waits for its transient detection and creates nothing when the track was deleted meanwhile
   (`AudioConsolidation`); a context menu closes when its target is deleted (`ContextMenu.closeWhen`); `EngineVariant` options take an
   optional `recordSampleLoad`, `WasmEngine.recentUpdates()` lists the last 32 box edits for error reports; a test-only heap-guard engine
   build (`build-guard-engine.sh`, off by default).

## Sub-package versions

| package | 0.0.182 | 0.0.183 | dist |
|---|---|---|---|
| `studio-core` | 0.2.16 | 0.2.17 | 53 files differ |
| `studio-adapters` | 0.3.14 | 0.3.15 | 48 files differ |
| `studio-boxes` | 0.0.120 | 0.0.121 | 42 files differ |
| `studio-core-wasm` | 0.0.27 | 0.0.28 | 29 files differ; 6 wasm binaries changed, 1 new |
| `lib-dsp` | 0.0.101 | 0.0.102 | 11 files differ (`harmony`, `chord-detection`, `biquad-coeff`) |
| `studio-enums` | 0.1.12 | 0.1.13 | 3 files differ (`KeyTrack`, `ChordTrack`) |
| `studio-sdk` | 0.0.182 | 0.0.183 | `version.js` / `.d.ts` |
| `lib-dawproject` 0.0.87, `lib-midi` 0.0.83 | | | byte-identical bumps |
| `lib-box` 0.0.103, `lib-dom` 0.0.96, `lib-fusion` 0.0.113, `lib-jsx` 0.0.98, `lib-runtime` 0.0.90, `lib-std` 0.0.89, `lib-xml` 0.0.75, `nam-wasm` 1.2.0 | | | unchanged |

Licences unchanged (AGPL-3.0-or-later; `nam-wasm` MIT). Wasm binaries (`studio-core-wasm/dist/wasm`, `cmp` against the installed 0.0.182):
`engine.wasm` 1 343 068 → 1 407 690 bytes; `plugins/device_arpeggio.wasm` 14 296 → 14 961; `device_autotune.wasm` 23 142 → 23 168;
`device_revamp.wasm` 24 538 → 24 620; `device_vaporisateur.wasm` 53 084 → 53 125; same size, new bytes: `device_delay`; new:
`device_scale_matrix.wasm` 4 791. The other plugins are byte-identical. `OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.183"`.

## The transport anchor (`5f6b53791`)

`Transport` gains `anchor`, `anchor_bpm`, `anchor_offset`; `pulse_at(sample)` is the anchor plus `frames_to_pulses` of the frames since it, one
division each, so a whole frame or pulse count converts exactly. `process_quantum` and `render_quantum` re-anchor when the bpm changed; a marker
jump, a tempo split and a loop wrap re-anchor at the split frame; `emit_until` counts the split frame from the anchor. A marker exactly on the block's
end now fires (`next.position <= p1`), and a jump on the quantum's last frame flags the next quantum's first block. Tests
`transport/tests/loop_area.rs` (+52), `markers.rs` (+35 / −8), `transport.rs`, `audio_region_player.rs`
`second_loop_cycle_starts_on_its_whole_frame` (the #533 bounce, 44.1 kHz, 120 bpm), `core-wasm/test/midi-output.test.ts` (its expected offsets moved).

## The silence tail (`0f2b76d76`)

`SilenceTail.accept(channels)` counts silent frames only after the first sound and returns false once `framesNeeded` silent frames follow at least
`minFrames` rendered; `framesToKeep` is the frames before the silence plus `min(keepFrames, silentFrames)`, `keepFrames` = `sampleRate / 4`.
`OfflineEngineRenderer.render` passes the range's length as `minDurationSeconds` for mixes and stems. Test `core-wasm/test/silence-tail.test.ts` (60).

## Warp markers (`906d1b620`)

`WarpMarkerGuard.install(boxGraph)` subscribes to every update and to the transaction end; `AudioRegionBoxAdapter.moveContentStart` shifts markers in
reverse for a negative delta; `MigrateWarpMarkers` and `ProjectMigration` visit `AudioSignalsmithBox`. Test `WarpMarkerGuard.test.ts` (151).

## Reset values (`57aae921c`, `baf0b1a49`)

Schema `value`s as above; `RevampDeviceBoxAdapter`, `VaporisateurDeviceBoxAdapter` and `TubularDeviceBoxAdapter` set per-parameter reset values to the
factory's sound; `BiquadCoeff` (lib-dsp) and `crates/dsp/src/biquad.rs` clamp the resonance. Tests `ResetValueAfterLoad.test.ts` (83),
`ParameterResetParity.test.ts` (90).

## Harmony (`8b2d1990e`, `e526af38c`, `f664d793e`, `3d036330e`, `896a8471b`, `81bcdf730`, `fdc823a44`, `8ce3918b8`, `f8b13773d`, `05e048865`, `73bd45151`, `afdf63451`)

`crates/engine/src/harmony_track.rs` (391) serves `host_harmony_at` to devices and scripts; `crates/math/src/harmony.rs` (217) and lib-dsp `harmony.ts`
(140) share the scale and chord arithmetic; `device-scale-matrix` (423) quantises to a scale or its custom grid (one offset per pitch class, −6..+12, 12 muting it), following the key when `follow`
is on; the Arpeggio's chord mode builds its pool from the chord track (`device-arpeggio/src/lib.rs` +147); Autotune's `follow`. Live notes on a stopped
transport take the key at the playhead. Tests `scale-matrix.test.ts` (204), `arpeggio-follow-chords.test.ts` (135), `script-harmony.test.ts` (102),
`chord-detection.test.ts` (92), `harmony.test.ts` (137), `ChordOverlaps.test.ts` (59). Manuals `devices/midi/scale-matrix.md` (new), `arpeggio.md` (+3),
`spielwerk.md` (+16 / −2).

## Studio-app only

The chord track's selection, drag and clipboard, chord pads on the software keyboard, Detect Key / Detect Chords, the key display, Shift+K / Shift+C,
the printable shortcuts page, the device dialog's delayed load, region groove labels in italic, the panel tab colours, the manual's search shadow, error
reports made anonymous and logged for engine traps, the WebRTC offer collision, the privacy policy (31 commits touch `packages/app`).

## opendaw-headless follow-ups shipped with this upgrade

- **Forced by nothing:** the bare bump typechecks and passes 2585 of 2585 tests.
- **Found by reading the release:** the warp-anchor outro (item 3, a test that fails on the old rule); the MIDI Effects intro's count.
- **Export regression harness:** `loop-pass-one-frame-short`, `loop-bounce-last-frame-silent` and `long-silence-ends-render` retired
  from `exportRegressionFindings.ts` (their fixture uses in the verdict, artifact and table tests moved to `trailing-silence-trimmed` and
  `loop-wrap-keeps-old-read`); `trailing-silence-trimmed` (by design) now pins 81 120 / 74 129 frames, the whole quarter second. The
  evidence only those labels read (`earlyFrames`, `framePeak`, `referencePeakOver`, `warmHolds`, and the per-row early-frames read) is
  removed. New tests: the gap rows' old measured stop (21 472 / 19 729 frames) reads failing with no name, and `staleFindings` holds a
  name with two entries live while either entry's invariant fails (`range-missing-tail`, shown to fail without the `live` filter).
- **Citations moved:** `midiEffectSemanticsRules.ts`, `.test.ts`, `arpeggioWalk.ts` and the semantics note's rule-source table now cite
  `device-arpeggio/src/lib.rs:638-692,731-739`, `:306-345`, `:220-230`, `:420-423`, `:199-211`, `:43-52`, `:24-26`, `arpeggio.md:175-178`
  (each checked against the 0.0.182 text). Three test-name citations pointed at the wrong code on 0.0.182 already (`mode_run`, a function
  the crate does not have, and two ranges inside other functions); they now cite `up_down` `:237-244`, `collect_pool`'s order `:530-545`
  and its half-open check `:502`, each read at the tag. Pitch, Velocity, Zeitgeist, Note Filter, `crates/abi` (`:39-51`)
  and `wiring.rs` citations stand.
- **Standing sweeps** (Chrome, the Playwright browser, the tab visible, the Mac's output device at 44.1 kHz; every row read against its
  register): sample-rate **240 of 240**, every family maximum unchanged (metronome 0.08, loop-wrap 0.54, seam 0.2, region-fencepost 0.03,
  note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos 0.07, audio-wrap-click 0.39 / -onsets 0.05 / -dip 0.02 ms;
  the dip −3.1 dB, the wrapped loop-start hit −2.8 dB / +1.07…+1.08 ms); recording alignment 48 kHz **10 of 10** `aligned`, tally 1.15 ×27 /
  1.16 ×24 / 1.10 ×6 / 1.17 ×3 (0.0.182: 1.15 ×27 / 1.17 ×15 / 1.16 ×12 / 1.10 ×6), 44.1 kHz **10 of 10**, +1.09…+1.18, 0 head deficits,
  1 tail row at 0.09 ms; multi-mic +1.146 on all 32 rows; forced 48 of 48 at 0 / 0 in three runs; the one-quantum tally **0 in 76**; #459
  page **FIXED**; delay compensation **lag 0** on every row; render-section **no frames lost** on 12 rows at both page rates, 7 reading
  "fixed: no frames lost", the 44.1 kHz two-pass baseline now 0 early; MIDI effect placement **15 of 15** at both rates; Nano play modes
  **11 of 11** at both rates; MIDI effect semantics holds 357 / deviation 0 / broken 0 / no rule 23 at both rates, 378 as registered and
  2 `changed, rule holds` at 48 kHz (run 1794245971298), 376 and 4 at 44.1 (run 1794246058210), **accepted as the registers on the user's word**
  (re-runs 1794249134609, 1794249208718: 380 as registered, 0 changed);
  export regression 48 kHz (run 1794244340183) 240 identical / 56 changed, 44.1 kHz (run 1794244550684) 210 / 86, every changed row one of
  items 1–2 above; re-run with the labels retired (1794246918474, 1794247036602) clean 242 / known 54 / failing 0 / errored 0 at both rates,
  the same register counts; **accepted as the registers on the user's word** (library commit `26b06b7`; re-runs 1794248944040, 1794249053719:
  296 of 296 `identical`); loudness **28 of 28** at both rates, every judged metric the 0.0.182 value to the hundredth (runs 1794246874519, 1794247814976; the unjudged after-the-end range moves by its usual 0.1 LU steps). Chromium probe, hardware-free rows: first-read `STALE FIRST READ` 14 of 15 (none 4, large 5, slow 5; 15 of 15 on 0.0.182, the verdict the same), suspend-resume `HALF RATE` on the first run (ratio about 0.50 from cycle 1), capture-gaps loopback `CLEAN` at 48 000 / `START GAPS` (one 441-frame start run) at 44 100, opfs-flush median 0.64 ms per 1 MiB / 1.58 ms per 16 MiB, opfs-usage in-session `COUNTED`, across a restart of Playwright's Chrome `NEGATIVE USAGE` (saved figure −1 758 784 181; drift −436 499 918 bytes since the 2026-11-06 restart, the probe's plain delete plus deletes between the two restarts not attributed here) — every one the register's reading. Bugzilla: the watched WebKit 328462 (Enhanced Security and `SharedArrayBuffer`) resolved fixed in WebKit main on 2026-11-09, 328618 gained a pull request; register entries updated.
- **IAC rows (2026-11-09, the IAC Driver online):** MIDI input sweep **36 of 36** `aligned`, every median 0.00 ms, max deviation 0.005 ms,
  0 missing / extra / stuck, count-in 2 of 6 pickups per cell (#493 open) (run 1794249280926); loop-wrap five repeats 48 / 48 each, `aligned`
  (1794249670312); effect arms `arpeggio` and `pitch` `aligned`, 48 / 48 (1794249729332, 1794249750215). MIDI output timing in the user's
  Chrome: Runs A, B (jank) and C every PAGE cell `bus-true`, every engine cell `on-time`, live medians 9.94–10.14 ms, janked inside-block
  medians 9.97 / 13.37 ms (1794249788138, 1794249865711, 1794249944019).
- **Not run (hardware or a hand):** the combined MIDI + audio sweep (microphone and speakers), the hidden-page `cover` and `modal` rows,
  the Chromium bfcache / freeze / microphone / Bluetooth rows, the 48 kHz device pass.
- **Docs:** `documentation/` chapters 02 (key and chord tracks), 10 and 13 (the export stop rule), 11 (Reverb / Revamp defaults, Scale
  Matrix in the lists), 16 (Scale Matrix, Arpeggio `followChords` and its stop release), 17 (`keyAt` / `chordAt`), 18 (the warp-marker
  guard), 19 (`recordSampleLoad`), internals 01 (the transport anchor), 03 (`notice`), 05 (sidechain loops), 06 (`SilenceTail`); root and
  category CLAUDE.md files. Every new signature checked against the installed `.d.ts`.
- **Loops closed:** openDAW#533 and #534 (the export regression note, its finding table, `debug/README.md`).
