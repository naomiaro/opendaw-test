# OpenDAW SDK Changelog: 0.0.183 → 0.0.184

Published 2026-11-10 12:39 UTC, a day after 0.0.183. 85 commits tag-to-tag (six merges, five of them inside the track-groups branch,
openDAW PR #496 by a contributor), 99 files under `packages/lib`, the studio sub-packages and `crates`. For this repo the release
**closes both issues filed on 2026-11-09** (openDAW#536 from the export regression harness, #537 from the frame-clock sweep) and brings
the studio's **track groups** into the SDK. What matters for this repo:

1. **A pulse inside a block lands on its frame (openDAW#536 FIXED, `527870ac5`).** Each `Block` (`crates/abi`) carries `anchor` (the
   pulse the transport counts its frames from) and `anchor_frame`, and `dsp::ppqn::frame_at(pulse, anchor, anchor_frame, bpm, rate)`
   places a pulse with one division. The metronome, the audio region player, the time-stretch player and the note sequencer use it, so a
   region, a note or a click on a whole frame inside a 128-frame block plays on that frame, not one early (about half of them were),
   across loop wraps and tempo changes too. **What the registers read of it:** the export harness's five `in-block-pulse-rounds-early`
   rows moved onto their frames at both rates (the four metronome stems from frame 24 000 / 110 250, −31.0 / −30.2 dB; the in-block region
   `changed shift 1`) and the label is retired. Recording alignment measures against metronome clicks, so its reference moved: the
   multi-mic netted figure is **+1.167 ms on every row (was +1.146 on every release since the arm existed), exactly one frame at 48 kHz**,
   and single-tape rows moved up across hundredth-of-a-millisecond lines. The take itself did not move: its placement fields match
   0.0.183's and the first-frame check reads 0 on every tape of both runs (an engine-only A/B cannot run: the 0.0.183 engine's mirror
   rejects the new `AudioUnitBox` fields). The sample-rate audit's maxima did not move.
2. **A parameter written just after Stop no longer suspends its lane through the next playback (openDAW#537 FIXED, `e6bac5c64`).**
   `Engine::suspend_automation` returns unless the transport is playing; the main thread still sends the suspension in the frame gap
   after Stop, and the stopped engine refuses it. `automation-suspended-after-stop-debug-demo.html` reads **FIXED** (writes at 0.2 and
   10.7 ms after Stop, `isPlaying` still true, both follow the curve on the next play). The suspension DURING playback is unchanged, by
   design (`docs/known-sdk-limitations.md`).
3. **Track groups (openDAW PR #496).** `AudioUnitBox` keys 33 `isGroup` and 34 `groupCollapsed`; `AudioUnitUserInterface` key 2
   `height` (Int32, 0..`MaxTrackHeight`). A group is a bus whose unit has `isGroup`; membership is read from the routing
   (`AudioUnitGroups.parent(unit)`: the unit's `output` points at a bus whose unit is a group), so a hand-built bus such as the
   mixer-groups demo's is NOT a group. New: `AudioUnitGroups` and `AudioUnitLayout` (studio-adapters), `project.grouping`
   (`AudioUnitGrouping`: `create`, `move`, `moveOutOfGroup`, `ungroup`, `deleteGroup`, `duplicate`, `canMove` / `canRoute` /
   `canDrop`), `project.audioUnitLayout` (`AudioUnitLayoutState`), `project.audioUnitSelection`; `ProjectApi` gains
   `createInstrumentAfterSelection`, `insertionAfterSelection` / `insertionAfterEditing` / `insertionAfter` / `insertionBefore`,
   `createInstrumentAt`, `importAudioUnitsAt`, `placeAudioUnitsAt` and the `AudioUnitInsertion` type. An optional trailing `destination?:
   AudioBusBox` on `AudioBusFactory.create`, `AudioUnitFactory.create`, `PresetDecoder.decode` and `InstrumentOptions`;
   `TransferAudioUnits` options `layoutOrder`, `includeGroupDescendants`, `preserveExternalConnections`; `TransferUtils.reorderAudioUnits`
   takes `layoutOrder`. A group unit hosts no MIDI chain (`midiEffects` / `midiEffectsField` → `None`, `hostsInstrument` false);
   `deleteAudioUnit` on a group deletes its subtree. `AudioUnitFactory.orderAndGetIndex` now walks `AudioUnitGroups.ordered` and shifts
   the indices at and after the slot by one instead of renumbering from 0; with no groups and gap-free indices it picks the same slot.
   **What the demos read of it:** nothing; every demo's units are ungrouped, every test passes, and the multi-unit audits (export mixdowns
   with fixed UUIDs, recording multi-mic) read as before apart from item 1.
4. **Breaking: `TimelineFocus` is `TrackFocus`** (`project.trackFocus`; `track`, `focus(track)`, `clear()`; the region focus is gone).
   Nothing here used it.
5. **A sample too large for the engine's memory plays silence instead of crashing the engine** (`4619070bd`, live errors 1227–1238). A
   sample, soundfont, frozen track or click sound whose allocation is refused (or larger than 4 GiB) is left out and logged through
   `EngineToClient.log` (`sample not loaded: removed or does not fit into the engine memory (<n> bytes)`). Test
   `core-wasm/test/sample-allocation-refused.test.ts`.
6. **The Compressor publishes fast levels** (`50ace7ffa`, openDAW#535, filed by a third party): `[input dB, output dB]` at
   `address.append(1)`, a 10 ms peak fall-off like the Gate's, computed only while subscribed. `append(0)` (`[input, reduction, output]`,
   500 ms) is unchanged. No demo reads it.

## Sub-package versions

| package | 0.0.183 | 0.0.184 | dist |
|---|---|---|---|
| `studio-core` | 0.2.17 | 0.3.0 | 29 files differ (`AudioUnitGrouping`, `AudioUnitLayoutState` new; `TimelineFocus` → `TrackFocus`) |
| `studio-adapters` | 0.3.15 | 0.4.0 | 28 files differ (`AudioUnitGroups`, `AudioUnitLayout` new) |
| `studio-core-wasm` | 0.0.28 | 0.1.0 | 36 files differ; 30 wasm binaries changed |
| `studio-boxes` | 0.0.121 | 0.0.122 | 6 files differ (`AudioUnitBox`, `AudioUnitUserInterface`) |
| `studio-sdk` | 0.0.183 | 0.0.184 | `version.js` / `.d.ts` |
| `lib-box` 0.0.103, `lib-dawproject` 0.0.87, `lib-dom` 0.0.96, `lib-dsp` 0.0.102, `lib-fusion` 0.0.113, `lib-jsx` 0.0.98, `lib-midi` 0.0.83, `lib-runtime` 0.0.90, `lib-std` 0.0.89, `lib-xml` 0.0.75, `studio-enums` 0.1.13, `nam-wasm` 1.2.0 | | | unchanged |

Licences unchanged (AGPL-3.0-or-later; `nam-wasm` MIT). Wasm binaries (`studio-core-wasm/dist/wasm`, `cmp` against the installed 0.0.183):
`engine.wasm` 1 407 690 → 1 409 698 bytes; `device_compressor.wasm` 13 899 → 14 428; `device_wclap_midi.wasm` 8 005 → 8 191; 19 other
plugins grew by 20–63 bytes (the `Block` struct's two new fields); `device_cubed`, `device_crusher`, `device_dattorro_reverb`,
`device_reverb`, `device_werkstatt`, `device_tubular`, `device_apparat` and `device_nano` kept their size with new bytes; the other 7 of
the 36 plugins are byte-identical. `OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.184"`.

## The block anchor (`527870ac5`)

`abi::Block` gains `anchor: f64` and `anchor_frame: i64` (frames in the coordinates of `s0`); `dispatch_range` and `render_effect` carry
them into sub-blocks (`anchor_frame − cursor` for an instrument's chunk). `ppqn::pulses_to_frames` is one division and `frame_at` floors it
from the anchor. `metronome.rs` places a click at `frame_at(position, …) − s0` (it was `floor(pulses_to_samples(position − p0))`);
`audio_region_player.rs` (+106 / −36), `time_stretch.rs` and `processors/src/sequencer.rs` place a start the same way. Tests
`metronome.rs::clicks_land_on_their_whole_frames` (blocks from the real transport, 4 s at 120 bpm, clicks at `beat × 24000`), the
`engine-env` and `transport` tests (+63), `audio_unit/tests.rs`.

## The suspension refused when stopped (`e6bac5c64`)

`suspend_automation` (the export) calls `Engine::suspend_automation`, which returns while `!self.transport.is_playing()`. Test
`a_suspension_reaching_the_stopped_engine_is_ignored` (play, stop, suspend → nothing suspended; play → the curve; suspend while playing →
suspended).

## Track groups (PR #496 and `55aaac96a`, `dd99f2351`, `c91c1a332`, `31eda7f71`, `8bb45e3a7`)

`AudioUnitGrouping.create` builds a bus named "Group Bus" (numbered when taken) with `IconSymbol.Merge`, `Colors.orange` and unit volume
0 dB, nested in the units' common parent, sets `isGroup`, moves the group before the first unit and the units into it, and renumbers every
unit's `index` in layout order. `move` re-points `output` only for a unit whose parent changes, refuses a route that would feed itself
(`canRoute` follows outputs and aux sends), and keeps the Output unit last. `duplicate` copies whole subtrees through `TransferAudioUnits`
with external connections preserved. `AudioUnitLayout` builds the rows (`depth`, `indent` 5 px per level, `RailWidth` 4, `visibleIndex`,
`collapsed`) and `boundaries`. Migration accepts the obsolete folder keys 31/32 (`RouteMembershipCompatibility.test.ts`). Tests
`AudioUnitGrouping.test.ts` (804), `core-wasm/test/track-groups.test.ts` (152: a group's bus sums its members in the engine).

## Studio-app only

Track selection like files (click, Shift range, Cmd toggle), group rails, lines and washes, the timeline and mixer group UI, the clip
launcher's group scenes and scroller, the device dialog listing stock devices first, the mastering panel's Test Mono switch (a local
field of the mastering device, not in the SDK's wasm), the modulation panel colours, the Errors page's status line (live error 1225), a
drag crash with a hidden automation lane (live error 1226), and the maintainer's `issues/` analyses (66 commits touch `packages/app`).

## opendaw-headless follow-ups shipped with this upgrade

- **Forced by nothing:** the bare bump typechecks and passes 2572 of 2572 tests.
- **Found by reading the release:** nothing in the demos reads the changed values (track ordering with no groups, the focus rename, the
  allocation path).
- **Export regression harness:** `in-block-pulse-rounds-early` retired from `exportRegressionFindings.ts` with the evidence only it read
  (`frameOffsets`, the verdict's `predicted` frames, `metronomeClickFrame`); its tests now assert that a click or region start a frame off
  reads `failing` with no label. `exportRegressionInBlock.ts` keeps the 0.0.183 arithmetic as the row picker only, so the in-block rows do
  not move.
- **Standing sweeps** (Chrome, the Playwright browser, the tab visible, the Mac's output device at 44.1 kHz; every row read against its
  register): sample-rate **240 of 240**, every family maximum unchanged (metronome 0.08, loop-wrap 0.54, seam 0.2, region-fencepost 0.03,
  note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos 0.07, audio-wrap-click 0.39 / -onsets 0.05 / -dip
  0.02 ms; the dip −3.1 dB, the wrapped loop-start hit −2.8…−2.9 dB / +1.00…+1.08 ms); recording alignment 48 kHz **10 of 10** `aligned`,
  tally 1.17 ×27 / 1.15 ×15 / 1.16 ×12 / 1.10 ×6 (0.0.183: 1.15 ×27 / 1.16 ×24 / 1.10 ×6 / 1.17 ×3), 44.1 kHz **10 of 10**,
  +1.09…+1.19, 0 head deficits, 1 tail row at 0.01 ms; multi-mic **+1.167 on all 32 rows** (item 1); forced 48 of 48 at 0 / 0 in three
  runs; the one-quantum tally **0 in 76**; #459 page **FIXED**; #537 page **FIXED**; delay compensation **lag 0** on every row;
  render-section **no frames lost** on 12 rows at both page rates (6 "fixed", 6 "clean"; the register's "7" counted the page's own
  description line); MIDI effect placement **15 of 15** at both rates; Nano play modes **11 of 11** at both rates; MIDI effect semantics
  holds 357 / deviation 0 / broken 0 / no rule 23 at both rates, 377 as registered and 3 `changed, rule holds` at each rate (48 kHz run
  1794331718758: `vel-random1-melody`, `zg-amount0-dur320-sixteenths`, `zg-amount1-dur3840-sixteenths`; 44.1 kHz run 1794331799959:
  `vel-random1-melody`, `zg-amount0-dur320-sixteenths`, `zg-amount1-dur960-sixteenths`), each a figure the reader marks unreadable (at 48 kHz 0.0.183's changes reversed, the notes back on their 0.0.182 frames),
  **accepted as the registers on the user's word** (re-runs 1794335902568, 1794335968026: 380 as registered, 0 changed); export regression 48 kHz (run 1794331943838) and
  44.1 kHz (1794332071775) 303 identical / 5 changed, the five #536 rows; re-run with the label retired (1794332300101, 1794332419210)
  clean 251 / known 57 / failing 0 / errored 0 at both rates, **accepted as the registers on the user's word** (library commit
  `4a73ec6`; re-runs 1794336061513, 1794336175047: 308 of 308 `identical`); loudness **28 of 28** at both rates, every judged metric the 0.0.183 value to the hundredth (runs 1794333205620, 1794334377504; the unjudged after-the-end range moves by its usual LU steps). Chromium probe, hardware-free rows: first-read `STALE FIRST READ` 14 of 15 (none 4, large 5, slow 5, as on 0.0.183), suspend-resume `HALF RATE` on the first run (ratio about 0.50 from cycle 9), capture-gaps loopback `CLEAN` at 48 000 / `START GAPS` (one 441-frame start run) at 44 100, opfs-flush median 0.69 ms per 1 MiB / 1.66 ms per 16 MiB, opfs-usage in-session `COUNTED` — each the register's reading. **One row off the register:** across a restart of Playwright's Chrome, opfs-usage read `COUNTED`, not `NEGATIVE USAGE`: saved usage +2 112 558 411 bytes, drift +3 871 342 592 since the 2026-11-09 restart (that one saved −1 758 784 181). Not attributed: the day's sweeps wrote to the same origin's OPFS between the two restarts, and a counter driven positive by writes cannot show the negative reading; the register entry is unchanged until a restart round on a quiet profile reads it. Bugzilla: no watched entry changed since 2026-11-09 apart from a triage update on Firefox 2082870; the Chromium tracker and the new-issue searches were not re-read (done on 2026-11-09).
- **IAC rows (2026-11-10, the IAC Driver online):** MIDI input sweep **36 of 36** `aligned`, every median 0.00 ms, max deviation 0.005 ms,
  0 missing / extra / stuck, count-in 2 of 6 pickups per cell (#493 open) (run 1794335107196); loop-wrap five repeats 48 / 48 each,
  `aligned` (1794335497099); effect arms `arpeggio` and `pitch` `aligned`, 48 / 48 (1794335559027, 1794335579414).
  MIDI output timing in the user's Chrome: Runs A, B (jank) and C every PAGE cell `bus-true`, every engine cell `on-time`, live medians
  9.92–10.20 ms, janked inside-block medians 9.98 / 10.02 ms (1794336333568, 1794336416115, 1794336505235).
- **Not run (hardware or a hand):** the combined MIDI + audio sweep, the hidden-page
  `cover` and `modal` rows, the Chromium bfcache / freeze / restart / microphone / Bluetooth rows, the 48 kHz device pass.
- **Docs:** `documentation/07-building-a-complete-app.md` ("The SDK's Own Group Buses"); `src/demos/playback/CLAUDE.md` (the same, short);
  `src/demos/automation/CLAUDE.md` and `docs/known-sdk-limitations.md` (#537 fixed); `src/demos/export/CLAUDE.md` (#536 fixed); root
  `CLAUDE.md` and the `sdk-upgrade` skill (retiring a fixed export label). Every new signature checked against the installed `.d.ts`.
- **Loops closed:** openDAW#536 (the export notes, the finding table, `debug/README.md`) and #537 (the frame-clock note, the page's
  verdict, `debug/README.md`).
