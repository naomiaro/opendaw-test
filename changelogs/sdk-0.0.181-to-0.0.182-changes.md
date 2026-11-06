# OpenDAW SDK Changelog: 0.0.181 → 0.0.182

Published 2026-11-06 12:15 UTC, three days after 0.0.181. 43 commits tag-to-tag (none a merge), 186 files
under `packages/lib`, the studio sub-packages and `crates`. The release is the maintainer's **Arpeggio and
groove week**, and for this repo it closes five issues filed from it (openDAW#526, #527, #528, #529, #530).
What matters for this repo:

1. **A new Zeitgeist shares the project's Global Shuffle.** `EffectFactories.Zeitgeist` no longer creates
   a `GrooveShuffleBox` per device: it points at `rootBoxAdapter.groove.box`, so every new Zeitgeist of a project
   plays through one groove, a write through one is the other's, and the groove **stays when the device is
   deleted, its settings included**. `ZeitgeistDeviceBox.groove` is no longer mandatory and a groove has no
   mandatory pointer. `ZeitgeistDeviceBoxAdapter.groove()` is now an `Option<GrooveAdapter>` (`None` passes the
   notes through), and `catchupAndSubscribeGroove` hands the observer that `Option`. **What the demos read of it:**
   four call sites stopped compiling (the placement and semantics pages, `useRenderedNotes`, its test);
   `deviceParameters` and two chain tests failed at run time; a Zeitgeist removed and re-added on the MIDI Effects
   pages keeps the amount it had, where it used to start at 60 % (measured: 100 %, Dry, Zeitgeist again, 100 %). The
   SDK's model, so the pages keep it and say so. The audits write both groove fields on every row, so no row inherits another's.
2. **The Arpeggio has 18 walks, and `modeIndex` 0..17 broke a control the compiler cannot see.** Up, Down and UpDown
   stay at 0..2. The MIDI Effects card asked for 3 slider positions on what is now an 18-position parameter, so it would
   offered Up, Pinky Up and Walk (read off the adapter); it now takes `ArpeggioDeviceBoxAdapter.Modes.length` (Node test; browser
   check: 18 presses of the arrow key read the 18 names in order). The Rendered page draws its windows from the device
   rule, and the rule knew three walks, so it was ported too (below).
3. **openDAW#526 FIXED: a played note keeps its cents.** The crate passes `note.cent` (`device-arpeggio/src/lib.rs:630,641`)
   where it wrote 0. The semantics audit's last deviation, `arpeggio-drops-cent`, is retired; `order-pitch-arpeggio` reads
   `changed, rule holds` at both rates (12.5 cents on every step), the row the 0.0.181 sweep said to watch.
4. **openDAW#528 FIXED: With Effects monitoring reaches the output once.** While a unit is monitored with effects it
   feeds neither its output bus, nor its aux sends, nor an audio sink (`returns_through_monitor`, `routing.rs`); a frozen
   unit keeps its routes, and when monitoring ends everything is routed as before. Measured here with the note's probe on
   `recording-api-react-demo.html`: Effects main peak 0, monitor peak 0.3 on 5 of 5 bursts; Direct and Off silent on both.
   **For a demo this means a monitored Tape no longer shows on the master meters** (nothing here reads them for that).
5. **openDAW#529 FIXED: `compensationLatency` reports the delay the mix gets.** New `engine.compensationExceeded`
   (`Engine`, `EngineFacade`, `EngineWorklet`; `compensation_exceeded` export; `EngineStateSchema`). Measured on
   `werkstatt-demo.html` with a second unit: `// @latency 99` reads 0.099 / false, `// @latency 150` reads 0.100 / true. **With
   nothing parallel to delay the same script reads 0.150 / false**: nothing is capped there, the mix really is 150 ms late. Takes,
   mixdowns, the metronome and automation follow the capped figure (`landing_of` in `engine_context.rs`).
6. **openDAW#530 FIXED: a `step` keeps the rest of its last quantum.** `QuantumStepper` (`core-wasm/src/quantum-stepper.ts`)
   holds it for the next `step`; a `setPosition` or a reset clears it. `render-section-latency-debug-demo.html` at both page
   rates: `Done: no frames lost on any of 12 rows`, 0 frames early, no jump. The page gained a third verdict for it, `no-frames-lost`, so a new loss
   still reads "differs from the formula" and the old one "defect present".
7. **openDAW#527 FIXED: deleting no longer drives Chrome's saved usage negative.** `OpfsWorker` empties every file with
   `truncate(0)` right before `removeEntry`, recursively through a folder, on all its delete paths; a file it cannot open is logged
   with `console.warn` and removed anyway. `clearStoredSamples()`'s page-load sweep goes through it. Measured across two restarts of Playwright's Chrome: the sweep removed 42 files, 245.9 MB, and the drift read −10 090 bytes, where the window before it (two plain deletes by the probes, 423.6 MB) read −423 749 996. A negative figure already saved stays.
8. **Grooves are project resources.** `RootBox.grooves` (a collection, key 12) holds them; `rootBoxAdapter.grooves` lists them,
   `rootBoxAdapter.groove` is now a `GrooveAdapter` (the Global Shuffle, label "Global Shuffle"). New boxes
   `GrooveFunctionBox` (Power, S-Curve), `GrooveRandomBox`, `GrooveOffsetBox`, `GrooveStackBox` + `GrooveStackEntryBox`, with
   adapters and a `Grooves` namespace (`create`, `replace`, `duplicate`, `makeUnique`, `addToStack`, `deleteAll`, `users`, …).
   `GrooveAdapter` is the common shape: `kind`, `warp` / `unwarp`, `amount` / `duration` as `Option`, `cellDuration()`, `users()`,
   `subscribeChange()`; `namedParameter` stays on `GrooveShuffleBoxAdapter`. **`GrooveShuffleBoxAdapter.DurationPPQNs` grew from 9
   entries (960 listed twice) to 19 distinct** (`GrooveDurations`, 1/24 to 16 bars), and the labels of the long ones read "1 bar",
   "2 bars". Old projects move every groove into the list on load (`MigrateGrooveCollection`). `Pointers.GrooveCollection = 66`,
   `GrooveStackEntries = 67`.
9. **A groove follows the loop.** A loop wrap is a jump: every pass plays as if it started at the loop start, a note a groove
   pushes past the loop end or pulls before the loop start is not played, notes sounding at the wrap end there. The Zeitgeist reads
   the loop area through the new `host_loop_area` import. An offline render with the loop area off is untouched: every old Zeitgeist
   row of the semantics audit reads as registered, and so **no audit row can see this**. Measured live on the MIDI Effects page instead (Sixteenths, the two-bar loop at bar 1,
   note-ons per pass read from `NoteStreamReceiver`): up to a 1-bar Duration no note is lost; at 75 %, 25 of 32 play at 2 bars and 3 of 32 at 16 bars, each as `groove.warp` predicts. A 2-bar cell
   loses notes on a 2-bar loop because cells count from position 0 and this loop starts at bar 1. The page's Zeitgeist note now says so; the Rendered page, one pass with the loop off, reads such a note in its tail.
10. **Note and value regions and clips can play through a groove**: an optional `groove` pointer on `NoteRegionBox`,
    `ValueRegionBox`, `NoteClipBox`, `ValueClipBox` (keys 18, 17, 14, 14), starting at the region's loop start; a note the groove moves
    outside its region never plays. `NoteRegionBoxAdapter.flatten(regions, truncate?, groove?: "apply" | "keep")`. `CubedDeviceBox.groove`
    too. Nothing here sets one, and without one a region plays as before.
11. **The rest of the Arpeggio.** `order` (Played / Pitch), `hold`, `retrigger` (Off / Note / Bar / Beat), `offset` 0..15 on
    `namedParameter`; plain fields `seed` (0..999999), `patternLength` (1..64, default 16), seven 64-element lanes (`stepKinds`,
    `stepVelocities`, `stepGates`, `stepTransposes`, `stepOctaves`, `stepChances`, `stepRatchets`), `version`. Statics `Modes`, `Orders`,
    `Retriggers`, `StepCount`, `MaxSeed`. Old projects and presets play as they did (`MigrateArpeggioDeviceBox`, `MigrateAutomation`), and
    presets are migrated on load like projects. A loop wrap no longer cuts the first arpeggio note short (a block split by an automation
    update saw the jump twice). The defaults reduce to the old device (`device-arpeggio/tests/golden.rs`), and 262 of 263 registered rows agree (the other is the cent fix).
12. **Smaller fixes**: the engine orders aux sends by their index field (it read the target-bus field; nothing sounded different);
    `CaptureAudio.subscribeOutputNode` / `AudioInputPort.subscribeOutputNode` let a track's peak meter reconnect when the input chain is
    rebuilt (the meter stayed on the replaced node, and a replaced meter stayed connected); a WebCLAP parameter with an id from 2^31 on reads
    unsigned; `ScrollModel` ignores non-finite positions. The combined audit reads `tapeCapture.outputNode` once for its round trip and is not affected.

## Sub-package versions

| package | 0.0.181 | 0.0.182 | dist |
|---|---|---|---|
| `studio-core` | 0.2.15 | 0.2.16 | 71 files differ |
| `studio-adapters` | 0.3.13 | 0.3.14 | 70 files differ |
| `studio-boxes` | 0.0.119 | 0.0.120 | 48 files differ |
| `studio-core-wasm` | 0.0.26 | 0.0.27 | 29 files differ; 13 wasm binaries changed |
| `lib-dsp` | 0.0.100 | 0.0.101 | 3 files differ (`GrooveCurves`) |
| `studio-enums` | 0.1.11 | 0.1.12 | 3 files differ (`GrooveCollection`, `GrooveStackEntries`) |
| `lib-fusion` | 0.0.112 | 0.0.113 | 2 files differ (`OpfsWorker`) |
| `studio-sdk` | 0.0.181 | 0.0.182 | `version.js` / `.d.ts` |
| `lib-dawproject` 0.0.86, `lib-midi` 0.0.82 | | | byte-identical bumps |
| `lib-box` 0.0.103, `lib-dom` 0.0.96, `lib-jsx` 0.0.98, `lib-runtime` 0.0.90, `lib-std` 0.0.89, `lib-xml` 0.0.75, `nam-wasm` 1.2.0 | | | unchanged |

Licences unchanged (AGPL-3.0-or-later; `nam-wasm` MIT). Wasm binaries (`studio-core-wasm/dist/wasm`, `cmp` against the installed 0.0.181):
`engine.wasm` 1 249 144 → 1 343 068 bytes; `plugins/device_arpeggio.wasm` 7 483 → 14 296; `device_cubed.wasm` 60 545 → 61 328;
`device_zeitgeist.wasm` 2 327 → 1 168 (the groove moved into the engine's registry); `device_pitch.wasm` 2 245 → 2 681;
`device_velocity.wasm` 2 410 → 2 851; `device_note_filter.wasm` 2 379 → 2 811; same size, new bytes: `device_maximizer`,
`device_vaporisateur`, `device_dattorro_reverb`, `device_reverb`, `device_fold`, `device_vocoder` (the shared ABI). The other 24
binaries are byte-identical. `OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.182"`.

## The Arpeggio rewrite (`5108377cc`)

`crates/stock-devices/device-arpeggio/src/lib.rs` (+578 / −134): `walk_index` picks a position in the pool of `notes × octaves`, the first three
modes the legacy arithmetic; the random modes hash `(seed, step, salt)` so a step plays the same note whatever played before it;
`step` reads the 16-step (by default) lanes, a Rest or a Tie moves the walk on and plays nothing, a Chord plays the pool, ratchets
divide the step and those due in a later block wait in `pending`. `abi::bar_at` (`host_bar_at`) serves Retrigger Bar and Beat. Tests
`tests/features.rs` (679), `tests/golden.rs` (164, against `tests/legacy/mod.rs`, 250, the old device), `tests/robustness.rs` (339),
`core-wasm/test/arp-steps.test.ts` (232). Manual `devices/midi/arpeggio.md` rewritten (+107 / −30).

## Grooves (`aeb40142e`, `d7f1736a5`, `085df7648`, `3e780b479`, `20b079e96`, `48ad8deb2`, `0366f7351`, `c97c4d715`, `6a5b85c63`, `3f352661d`, `39bb800fc`, `1e30cf5ab`, `ad010fbf2`, `7fe3e5ed4`, `456ce34cb`)

The engine keeps a groove registry; a device reaches one through `host_observe_groove` / `host_groove_warp` / `host_groove_unwarp`, `abi::GrooveFollower` holding
the slot and the wrap state, so `device_zeitgeist.wasm` halved. Warp and unwarp round trip for every type at extreme settings (`GrooveRoundTrip.test.ts`, 225); below 50 %
a curve mirrors its blend instead of inverting a vertical edge. Shuffle is unchanged, which the registers confirm. `DevicesClipboardHandler`, `RegionsClipboardHandler`,
`TransferUtils` (`withGrooves`, `normalizeGrooves`, `mapRootPointer`) keep a groove within a project and carry it into another. Scripts
(`packages/studio/scripting`) see every groove type. Tests `GrooveActions.test.ts` (578), `TransferGrooves.test.ts` (270), `region-groove.test.ts` (185),
`zeitgeist-offset.test.ts` (249), `zeitgeist-groove.test.ts` (rewritten), `cubed-groove.test.ts` (92), `lib-dsp/grooveCurves.test.ts` (121),
`engine-env/tests/note_sequencer_grooved_clips.rs` (118).

## Delay compensation past the cap (`9402f6450`)

`EngineContext::landing` walks the graph as `arrival` does, each junction delay capped as applied, and `output_latency` is now the output's landing. `compensation_exceeded` is
true when an edge needs more than `limits.max_frames`. The manual gains `delay-compensation.md`. Test `core-wasm/test/delay-compensation.test.ts` (+22, 99 ms → 4752 frames, 150 ms → 4800 and exceeded).

## The offline step (`48ca856dc`)

`offline-worker.ts`'s step body moved to `QuantumStepper.step(numSamples, render)`; `stop` with a reset and `setPosition` clear it. Comments in `AudioBounce.ts` and `OfflineEngineRenderer.ts`
that said a step discards the rest of its quantum went with it. Test `quantum-stepper.test.ts` (80).

## OPFS deletes (`7cf1581ce`)

`OpfsWorker.emptyFile`, `removeHandle`, `removeChild`, `listHandles`. `delete` still reports nothing when it fails, so `clearStoredSamples` keeps its `Workers.Opfs.exists` check. Test `OpfsWorker.test.ts` (+104).

## Studio-app only

The Grooves tab of the modulation panel, the Zeitgeist editor, the region Groove submenu, the Flatten dialog, the footer's orange PDC note, the Arpeggio's step-sequencer panel,
the note editor's "too much recursion" scrolling fix, phones on the contest page, the song contest link, a knob drag past a WebCLAP window's edge, and a plan for rendering a unit's MIDI effects into a note region (27 commits touch `packages/app`).

## opendaw-headless follow-ups shipped with this upgrade

- **Forced by the compiler and the tests** (typecheck 4 errors, 8 of 2119 tests failing on the bare bump): the `Option` at the four call sites; the fixtures (`graphWithZeitgeist`, `midiEffectFixture`) point at the skeleton's Global Shuffle as the factory does; `removeMidiEffect` and `removeDevice` pin that the groove stays, and a new test that two Zeitgeists share it.
- **Not forced, found by reading the release:** the Mode control's positions (a test that walks every position and reads its name); the device rule's walks.
- **`src/lib/audit/arpeggioWalk.ts`** (new, with tests): the 18 walks and the seeded hash. Its table test is the manual's "With C, E, G held" plus vectors from the crate's own `hash` and `walk_index` compiled with rustc (a review compared 1 080 210 values, no mismatch); the render checks the same against the engine. `arpeggioRule` gained Order, Offset and Seed and lost its `deviations` argument. Hold, Retrigger and the lanes are not in the rule, the rows or the demos' cards: a follow-up for the user to pick up, as Note Filter was on 0.0.181; likewise the other groove types.
- **Semantics rows 263 → 380:** 62 Arpeggio (later modes × octaves and the chords, seeds on the random ones, Order on a new `held-rolled` pattern, Offset, Repeat with Offset; a test holds each to predict another walk than its reference row), 55 Zeitgeist (11 new durations × 5 amounts). Quick subset 53.
- **Citations moved:** `midiEffectSemanticsRules.ts`, `arpeggioWalk.ts` and the note's rule-source table now cite `device-arpeggio/src/lib.rs:589-643`, `:679-687`, `:300-339`, `:214-224`, `:414-417`, `:193-205`, `:42-51`, `device-zeitgeist/src/lib.rs:35-49`, `arpeggio.md:122-132`, `zeitgeist.md:53`. Pitch, Velocity, Note Filter and `wiring.rs` are untouched.
- **Loops closed:** openDAW#526 (semantics note, the deviation), #527 (vendor register), #528 and #529 (their note), #530 (its note, the page's text, `sectionRenderGap.ts`'s header), `debug/README.md`.
- **Docs touched:** root `CLAUDE.md` ("Grooves Are Project Resources" replaces the old groove section; `RootBoxAdapter`'s list; the semantics row count), `src/demos/midi/CLAUDE.md`, `src/demos/export/CLAUDE.md`, `documentation/16-midi.md` (the Arpeggio's whole table, Zeitgeist), `documentation/11-effects.md` (the cap), `documentation/10-export.md` (the step), `documentation/08-recording.md` and `documentation/internals/05-devices-and-effects.md` (where With Effects is heard), `docs/known-vendor-issues.md`, the debug notes.
- **Standing sweeps** (Chrome 156.0.8078.81, the Playwright browser, the tab visible, the Mac's output device at 44.1 kHz; every row read against its register): MIDI effect semantics at both rates 357 holds / 0 deviations / 23 no rule, 262 as registered, **1 changed (`order-pitch-arpeggio`, the cent fix)**, 117 new (runs 1793986775632, 1793986853296; **the registers are not re-accepted, that waits for a read**); sample-rate **240 of 240** with every family maximum unchanged (metronome 0.08, loop-wrap 0.54, seam 0.2, region-fencepost 0.03, note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos 0.07, audio-wrap-click 0.39 / -onsets 0.05 / -dip 0.02 ms; the dip −3.1 dB, the wrapped loop-start hit −2.8 dB / +1.06…+1.07 ms in the rows read); recording alignment 48 kHz 10 of 10 cells `aligned`, tally 1.15 ×27 / 1.17 ×15 / 1.16 ×12 / 1.10 ×6 (the 0.0.181 tally exactly), 44.1 kHz 10 of 10, +1.09…+1.19, 0 head deficits, tails 0 rows / 3 rows under 0.13 ms; multi-mic +1.146 on all 32 rows, largest raw skew 0.67 ms, 0.00 left over; forced 48 of 48 at 0 / 0 in three runs; the one-quantum tally **0 in 76**; #459 page **FIXED**; delay compensation **lag 0** on every row; render-section **no frames lost** at both page rates (#530); MIDI effect placement **15 of 15** at both rates; Nano play modes **11 of 11** at both rates; loudness **28 of 28** at both rates, judged metrics unchanged to the hundredth (runs 1793984965545, 1793985660207; the unjudged after-the-end range moves by its usual 0.1 LU steps, and `3341-18` at 44.1 kHz read its 8.60 wobble). Chromium probe, hardware-free rows: first-read `STALE FIRST READ` 15 of 15 (none 5, large 5, slow 5), suspend-resume `HALF RATE` on the first run (ratio about 0.50 from cycle 4), capture-gaps loopback `CLEAN` at 48 000 / `START GAPS` (one 441-frame start run) at 44 100, opfs-flush median 0.65 ms per 1 MiB / 1.53 ms per 16 MiB, opfs-usage in-session `COUNTED`, across a restart `NEGATIVE USAGE` — every one the register's reading. **Not run (hardware or a hand):** the IAC MIDI input sweep and its loop-wrap / effect arms, the MIDI output timing audit, the combined MIDI + audio sweep, the hidden-page `cover` and `modal` rows, the Chromium bfcache / freeze / microphone / Bluetooth rows, the 48 kHz device pass. This release rewrites the Arpeggio and touches the pull chain's jump handling, so the MIDI input sweep's `effect=arpeggio` arm is the one worth asking for first.
- **Vendor register:** `Last checked` moved on the entries the sweeps exercised. Trackers read 2026-11-06: every WebKit and Firefox bug cited (changed since the last sweep: WebKit 328462 and Firefox 2034508, patches still in progress, both already entries); the Chromium tracker's open `WebAudio`, `AudioWorklet`, `WebMIDI` and `FileSystemSyncAccessHandle` issues modified since 2026-11-03 by search: nothing new that reaches here (392542574 and 566965142, already cited, moved; 40140417, a context's `suspended` state on construction, in progress, would change nothing here since the demos read the state before `play`).
- **Verification**: `npm run typecheck` 0 errors, 2230 of 2230 vitest tests (2119 on the bare bump, 8 of them failing), `npm run build`, `npm ci` on the regenerated lockfile; the openDAW checkout and the XERJ corpus clone moved to `766204efe` (the `@opendaw/studio-sdk@0.0.182` tag; the corpus re-indexed).
- **API claims verified against the installed tarballs** (`node_modules/@opendaw/*/dist`, diffed against a copy of the installed 0.0.181 packages taken before the bump): `OPENDAW_SDK_VERSION = "0.0.182"`; `grooves` and `groove: GrooveAdapter` in `RootBoxAdapter.d.ts`; `groove(): Option<GrooveAdapter>` and the `Option` observer in `ZeitgeistDeviceBoxAdapter.d.ts`; `GrooveBox`, `GrooveKind`, `GrooveAdapter` in `grooves/GrooveBoxAdapter.d.ts`; `Grooves`, `GrooveDurations`, `CellGrooveBoxAdapter`, `GrooveFunctionBoxAdapter`, `GrooveOffsetBoxAdapter`, `GrooveRandomBoxAdapter`, `GrooveStackBoxAdapter`, `GrooveStackEntryBoxAdapter` exported from `studio-adapters`; `Modes`, `Orders`, `Retriggers`, `StepCount`, `MaxSeed` and `order` / `hold` / `retrigger` / `offset` on `ArpeggioDeviceBoxAdapter`; `seed`, `step*`, `patternLength`, `version` on `ArpeggioDeviceBox`; `groove` on `NoteRegionBox`, `ValueRegionBox`, `NoteClipBox`, `CubedDeviceBox`; `grooves` on `RootBox`; `flatten(…, groove?)` on `NoteRegionBoxAdapter`; `compensationExceeded` on `Engine`, `EngineFacade`, `EngineWorklet`, `EngineStateSchema`; `subscribeOutputNode` on `CaptureAudio`, `AudioInputPort`, `BrowserAudioInput`; `host_bar_at`, `host_observe_groove`, `host_groove_warp`, `host_groove_unwarp`, `host_loop_area`, `compensation_exceeded` in `engine-exports.d.ts`; `GrooveCollection`, `GrooveStackEntries` in `Pointers`; `GrooveCurves` in `lib-dsp`; the 13 changed and 24 byte-identical wasm binaries.
