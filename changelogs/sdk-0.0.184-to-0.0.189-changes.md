# OpenDAW SDK Changelog: 0.0.184 → 0.0.189

Five releases in ten days: 0.0.185 (2026-11-17 16:34 UTC), 0.0.186 (11-18 11:23), 0.0.187 (11-18 15:36), 0.0.188 (11-18 17:48) and
0.0.189 (2026-11-20 19:49 UTC). 52 commits tag-to-tag (two merges), 154 files under `packages/lib`, the studio sub-packages and
`crates`. No issue filed from this repo is in the range; five of the fixes were reported by another SDK user. What matters for this
repo:

1. **Every bus is a group bus (breaking, `ecbf99356`).** `AudioUnitGroups.isGroup(unit)` is `unit.type === AudioUnitType.Bus`; the
   `isGroup` field (key 33) is deprecated and no longer read or written. A unit whose `output` points at any bus is that bus unit's
   child. **What the demos read of it:** the hand-built buses of the mixer-groups demo, the convolver demo's send bus and the export
   harness's `Bus` are groups now. `project.api.deleteAudioUnit(busUnit)` deletes the bus and every unit routed into it
   (`grouping.deleteGroup` walks `AudioUnitGroups.subtree`); `midiEffects` / `midiEffectsField` / `hostsInstrument` on a bus unit read
   `None` / `None` / `false`; `AudioUnitFactory`'s insert order counts every bus with the instruments. No demo deletes a bus (the two
   `audioUnitBox.delete()` calls, `jamSetup.ts` and the BPM page, are on instrument units, and a bare `delete()` does not go through
   the group code), none reads a bus's MIDI chain, and the export harness reads 308 of 308 rows identical, its bus and aux rows
   included. New test `src/lib/busIsGroup.test.ts` pins the rule on a real box graph (a bus owns what is routed into it, a nested
   bus lists parents before children, the retired flag is not read, an `Aux` unit is not a group) and fails against the 0.0.184
   `AudioUnitGroups.js`.
2. **Collapse states and heights are per user (breaking, `ecbf99356`).** `AudioUnitBox.groupCollapsed`,
   `AudioUnitBox.userInterface` (`automationCollapsed`, `height`) and `TrackBox.height` are deprecated. The values live in
   `ViewStateBox` entries (new, ephemeral: `user`, `target`, `groupCollapsed`, `automationCollapsed`, `height`) pointing at a
   `UserInterfaceBox`'s new `viewStates` field, read through `project.userEditingManager.viewStates` (`ViewStates`:
   `groupCollapsed(unit)`, `automationCollapsed(unit)`, `height(unit | track)`, each a `MutableObservableValue`).
   `AudioUnitBoxAdapter.automationCollapsed` is gone; `AudioUnitGroups.hidden(unit, isCollapsed)` and `new AudioUnitLayout(root,
   isCollapsed)` take the predicate. `migrateViewStates` moves a loaded project's old values into the first user. Nothing here read
   any of them.
3. **Signalsmith regions play on the grid (`d02dc79b8`).** Each Signalsmith region was delayed by 0 to 7 render quanta (up to
   18.7 ms at 48 kHz), the slot derived from the region's uuid, live and in offline renders. `set_phase_offset` is gone; a frame's
   work now runs in steps spread over the interval before it is due (`splitComputation`, on by default), with output bit-identical
   to whole frames while tempo and pitch hold. **Measured here:** see "Signalsmith timing" below.
4. **A recording that cannot be stored ends in `"error"` (`c882bdccc`).** `RecordingWorklet` used to keep the take in memory and show
   "Storage Unavailable". It now drops its data, goes to `{type: "error", reason, cause}`, and `RecordAudio` deletes the take's
   `AudioFileBox` (regions with it) and asks through `RuntimeNotifier.approve` whether to download the take as a WAV
   (`UnstoredRecording.offerDownload`). **What the demos read of it:** the finalization barriers already count `"error"` as terminal
   (`LoopRecordingReference.tsx`, `loop-recording-demo.tsx`); `src/demos/recording/CLAUDE.md` said the worklet never emits it, and is
   corrected. Not provoked here (it needs a full origin). **Found after the upgrade (2026-11-23):** with no
   `RuntimeNotifier` installed, as in these demos, `approve` resolves yes, so nobody is asked, the save picker is requested at once,
   and a refused save is requested again without end (`debug/2026-11-23-unstored-recording-download-loop/note.md`).
5. **A library sample that cannot be stored plays from memory (`c882bdccc`).** `GlobalSampleLoaderManager.#fetchFromApi` warns and
   still sets the loader `"loaded"`; before, a full storage ended the loader in `"error"` and the project did not open. Samples and
   soundfonts are written one file after the other with `meta.json` last (`Storage.saveEntry`), a failed save removes the folder it
   began, a partial OPFS write rejects as `QuotaExceededError` and restores the old bytes. `SampleLoaderState` and
   `SoundfontLoaderState` errors carry an optional `cause`. The page-load sweep (`clearStoredSamples`) uses only `Workers.Opfs.delete`
   / `exists` on the folder, which did not change.
6. **Measure Latency no longer stores a wrong round trip (`37abf966b`).** A silent input read as a perfect peak at 0 ms and was
   stored `"ok"`; it reads `"no-signal"` now, and a trip under `RoundTrip.MinSeconds` (1 ms) is not counted. One measurement at a
   time (the same capture shares the running one, another capture is refused, 30 s timeout). New:
   `measureRoundTrip({store: false})` and `CaptureAudio.storeRoundTrip(result)`. No demo calls it; the audits' stored-entry guard
   (`storedRoundTrips.ts`) reads `localStorage` and is unaffected.
7. **Sample length rule (`f39794179`).** `SampleLength.musicalPulses(seconds, bpm, origin)` (studio-adapters): a recording keeps its
   exact length, other audio snaps to sixteenths only when it lies within 1% of a sixteenth of the grid, lengths are whole pulses.
   `AudioContentFactory` (region and clip creation) and `AudioContentModifier` (conversion to a stretched play mode) use it; before,
   every length of a sixteenth or more was rounded to the sixteenth grid. The demos build their regions and warp markers by hand
   (`trackLoading.ts`, `warpScenarios.ts`) and call neither.
8. **Armed state can be stored (`e7216d537`, `be3349f4a`).** `CaptureAudioBox` / `CaptureMidiBox` key 3 `armed`. It is written only
   when `ProjectEnv.storeArmed` is `true` (the studio sets it; default off, as on 0.0.184), outside undo, never in a live room. The SDK only writes it: every capture starts disarmed, and re-arming on load is studio-app
   code (`ArmedCaptures.ts`).
   `AudioUnitCapture` (`deriveUUID`, `restore`) is exported: migration and room repair give an instrument that lost its capture a
   new one under an id derived from the unit instead of deleting the unit.
9. **Engine memory (`9068eceb9`).** talc 5.0.4: the engine no longer grows to 4 GB for a sample just under a 64 KiB page multiple and
   no longer corrupts its heap after freeing 16 MiB or more; engine pointers are read unsigned (`withUnsignedPointers`), so memory
   above 2 GiB works. `VaryingTempoMap.intervalToPPQN` maps seconds before zero symmetrically, so a take recorded during the count-in
   keeps its length when resized.
10. **New in studio-core:** `OpusEncoder` (WebCodecs Ogg Opus, 48 kHz only, at most four one-second blocks queued, optional
    `AbortSignal`; brings `mediabunny` as a dependency, loaded on first encode); `FFmpegWorker.load(progress?, {coreURL, wasmURL}?)`
    with `FFmpegWorker.DefaultCoreURLs` (the class is imported from `@opendaw/studio-core/FFmpegWorker`; only the second argument
    is new); `OpfsQuota` (`install(handler)`, `retry`), `AssetCache` / `StorageScan`
    (which stored samples and soundfonts are in use, cached and freeable), `GlobalSampleLoaderManager.isInUse(uuid)`,
    `MIDILearning.numberOfConnections`; lib-box exports `GraphValidationError` (the pointer-rule failures throw it).

## Sub-package versions

| package | 0.0.184 | 0.0.189 | dist |
|---|---|---|---|
| `studio-core` | 0.3.0 | 0.3.5 | 174 files differ |
| `studio-adapters` | 0.4.0 | 0.4.3 | 28 files differ (`ViewStates`, `SampleLength` new) |
| `studio-core-wasm` | 0.1.0 | 0.1.5 | 13 files differ; 1 wasm binary changed |
| `studio-boxes` | 0.0.122 | 0.0.124 | 26 files differ (`ViewStateBox` new; `AudioUnitBox`, `TrackBox`, `UserInterfaceBox`, capture boxes) |
| `studio-enums` | 0.1.13 | 0.1.14 | 6 files differ (`Pointers.ViewState`, one icon) |
| `lib-box` | 0.0.103 | 0.0.105 | 10 files differ (`GraphValidationError`, dropped undo steps) |
| `lib-fusion` | 0.0.113 | 0.0.115 | 5 files differ (OPFS worker, `StorageWalk`) |
| `studio-sdk` | 0.0.184 | 0.0.189 | `version.js` / `.d.ts` |
| `lib-dawproject` 0.0.87, `lib-dom` 0.0.96, `lib-dsp` 0.0.102, `lib-jsx` 0.0.98, `lib-midi` 0.0.83, `lib-runtime` 0.0.90, `lib-std` 0.0.89, `lib-xml` 0.0.75, `nam-wasm` 1.2.0 | | | unchanged |

Licences unchanged (AGPL-3.0-or-later; `nam-wasm` MIT). New transitive dependency: `mediabunny` 1.66.2 (MPL-2.0), which brings
`@types/dom-webcodecs` and `@types/dom-mediacapture-transform`. Wasm binaries (`studio-core-wasm/dist/wasm`, `cmp` against the
installed 0.0.184): `engine.wasm` 1 409 698 → 1 413 773 bytes; the other 37 are byte-identical. `OPENDAW_SDK_VERSION` in the installed
`studio-sdk` reads `"0.0.189"`. The MIDI effect crates (`device-arpeggio`, `-pitch`, `-velocity`, `-zeitgeist`), `crates/abi` and
`audio_unit/wiring.rs` did not change, so the semantics audit's line citations hold; of the MIDI manuals only `spielwerk.md` gained
five lines.

## Every bus a group, view states per user (`ecbf99356`, `26c7ea9b4`, `462bca54e`, `deacce9f4`)

`AudioUnitGrouping.create` no longer sets a flag; `ungroup` keeps the bus when its members cannot move out. `AudioUnitLayoutState`
rebuilds on a unit's `type` and on the user's `groupCollapsed` view state only (not on every resize). `ViewStates.follow(userInterfaceBox)`
binds the manager to a user; a value is created as a `ViewStateBox` on first write. `Mixer` marks the buses a soloed channel outputs
into as virtually soloed (the display; the engine already played them). Tests `MigrateViewStates.test.ts`,
`RouteMembershipCompatibility.test.ts`, the Rust box fixtures regenerated with `ViewStateBox`.

## Signalsmith timing (`d02dc79b8`)

`audio_region_player.rs` no longer seeds a player with `slot × 128` frames of delay (`slot` = the sum of the region uuid's bytes modulo
the interval in quanta). `crates/signalsmith/src/stretch.rs` splits a frame into `6 + 2 × BAND_STEPS + 2 × stages` steps (window read,
FFT stages, band analysis in four ranges, peak finding, phase locking, inverse FFT, overlap-add) and starts one interval early; peak
cost per quantum in the wasm engine drops (1 voice 8.7% → 1.3%, 3 voices 17% → 3.6%, 5 voices 16% → 8.2%, upstream's figures). Tests
`signalsmith_plays_clicks_on_time` (six clicks within 32 samples), `crates/signalsmith/tests/split.rs`,
`core-wasm/test/signalsmith-alignment.test.ts`.

**Measured here** (`audio-verify-debug.html?scenario=signalsmith`, the full-song offline render of the warp demo's Signalsmith
scenario, 48 kHz; every load gives the region a fresh uuid):

| SDK | renders | WAV SHA-256 | envelope lag against the 0.0.189 render, [60, 80] s |
|---|---|---|---|
| 0.0.189 | 2 | identical (`acfa2735…`) | 0 (the same bytes) |
| 0.0.184 (a worktree of `main`, its own dev server) | 3 | three different (`b6411bf8…`, `b5c07950…`, `d183fe37…`) | −4, +2 and +11 ms |

So on 0.0.184 the same project rendered to a different place on every load, 15 ms apart across three loads, and on 0.0.189 it renders
to the same bytes. The lag is the peak of the cross-correlation of the two renders' RMS envelopes (1 ms steps, 10 ms smoothing,
correlation 0.73 to 0.77): good for a few milliseconds, not for a frame. A sample-exact comparison between the two versions is not
possible, the stretcher's output differs in detail (residual above 0 dB at every whole-quantum shift), so this table shows the
uuid dependence gone, not where on the grid the 0.0.189 render sits; upstream's click test covers that. Against the varispeed render
of the same song the 0.0.189 Signalsmith render's envelope peaks 11 to 12 ms later in both windows (correlation 0.75 to 0.78), an
unlike pair (varispeed changes pitch) that the `audio-verify` skill reads as a locked control, not as a latency figure.

## Undo steps another participant made impossible (`962dd05ce`, `344bdca42`)

`BoxEditing.undo` / `redo` remove a step that fails to apply from the history (it stayed and failed forever), fix the saved-state index
and notify. Only reachable with a second writer on the graph.

## Automation seed node (`44f3dbda8`)

`createTrackRegion`'s inherited first node takes `Interpolation.Linear` when the parameter's value mapping is `floating()`, else
`Interpolation.None` (it mapped the parameter type, which a script device's float-stored int and bool dials defeated). The demos
clear the seed node before writing their own.

## Studio-app only

Track menus per track, custom views' key handling, the Script Editor surviving a TypeScript worker failure, the group-bus manual page,
track resizer and folded-group fixes, single-click panel headers, timeline icon colours, the send menu refusing feedback routes, the
device dialog and WebCLAP descriptions, automation step nodes (Cmd/Ctrl + double-click), the "MIDI Blocked" notice and the MIDI
permission prompt for projects with learned controls (`MIDILearning` compares addresses by value now, so a learned control is
recognised after a reload), the Audio-Engine Error dialog naming what the processor threw (`Project.#awaitErrorCause`), the storage
panel built on `AssetCache`, and the maintainer's triage notes (33 commits touch `packages/app`).

## opendaw-headless follow-ups shipped with this upgrade

- **Forced by the bump:** `tsconfig.json` names its `types` (`node`, `wicg-file-system-access`). `mediabunny` installs
  `@types/dom-webcodecs`, which redeclares what TypeScript's `lib.dom` has (TS2717, TS2374, TS2300 with `skipLibCheck` off), and
  without a `types` list every `@types` package is loaded. Tests: 2572 of 2572 on the bare bump.
- **Found by reading the release:** the bus rule (item 1, test added), the recording loader's `"error"` (item 4, doc corrected).
- **Standing sweeps** (Chrome, the Playwright browser, the tab visible, the Mac's output device at 44.1 kHz; every row read against its
  register):
  - sample-rate **240 of 240**, every family maximum unchanged (metronome 0.08, loop-wrap 0.54, seam 0.2, region-fencepost 0.03,
    note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos 0.07, audio-wrap-click 0.39 / -onsets 0.05 /
    -dip 0.02 ms; the dip −3.1 dB, the wrapped loop-start hit −2.8…−2.9 dB / +1.0…+1.1 ms);
  - recording alignment 48 kHz **10 of 10** `aligned`, tally 1.17 ×27 / 1.15 ×15 / 1.16 ×12 / 1.10 ×6 (0.0.184's, bucket for
    bucket), 0 tail and head deficits (run 1795454750343); 44.1 kHz **10 of 10**, +1.09…+1.19, 0 head deficits, one repeat
    (`loop-wrap/120` r2) with a 0.04 ms tail on its six takes, as the 0.0.180 sweep read it (1795455159960); multi-mic **+1.167 on
    all 32 rows** (1795455570107); forced 48 of 48 at 0 / 0 in three runs; the one-quantum tally **0 in 76**;
  - #459 page **FIXED**; delay compensation **lag 0** on every row; render-section **no frames lost** on 12 rows at both page rates;
    MIDI effect placement **15 of 15** `as-predicted` at both rates; Nano play modes **11 of 11** at both rates;
  - MIDI effect semantics holds 357 / deviation 0 / broken 0 / no rule 23, **380 of 380 as registered, 0 changed** at both rates
    (runs 1795456029243, 1795456097750); the registers stay as accepted on 0.0.184;
  - export regression **308 of 308 `identical`** to the register at both page rates, clean 251 / known 57 / failing 0 / errored 0
    (runs 1795456193933, 1795456313972; engine `04c42a6060a7`); the register stays as accepted on 0.0.184. The harness has no
    stretched region, so the Signalsmith change is measured above, not here;
  - loudness **28 of 28** at both rates, every judged metric the 0.0.184 value to the hundredth (runs 1795457142171,
    1795457830863; the unjudged after-the-end range moves by its usual 0.1 LU steps);
  - **IAC rows** (the IAC Driver online, the Playwright browser): MIDI input sweep **36 of 36** `aligned`, every median 0.00 ms,
    max deviation 0.01 ms, 0 missing / extra / stuck, count-in 2 of 6 pickups per cell (#493 open) (run 1795457908873); loop-wrap
    five repeats `aligned` (1795458299394); effect arms `arpeggio` and `pitch` `aligned` (1795458361674, 1795458380810);
  - hidden-page recording, the three `modal` rows (`hideAt=start|mid|stop`, the alert held about five seconds: spans 4047, 5003
    and 5004 ms): both takes **`intact`** on each, 31 of 31 beats, median 1.17 ms.
- **Checked in the browser on a fresh load:** the mixer-groups demo boots with its two buses reading `midiEffects` `None`; on its
  live project `project.api.deleteAudioUnit` on the "Rhythm" bus removed the bus and the two tracks routed into it (10 units → 7),
  and one undo brought all three back. `OpusEncoder.encode` on two seconds of a 48 kHz stereo sine returned a 33 187-byte Ogg file
  (`OggS`) that `decodeAudioData` reads back as two channels, 2.01 s; 44.1 kHz audio is refused ("Opus encodes 48000 Hz audio, got
  44100 Hz"). The dynamic `mediabunny` import resolves under the Vite dev server.
- **Not run, the user's rule for this upgrade:** the vendor rows (`chromium-watched-issues-debug-demo.html`) and the vendor tracker
  re-read. The `sdk-upgrade` skill now runs them only on request.
- **Not run (the user's Chrome, hardware or a hand):** the MIDI output timing audit (the range does not touch
  `crates/engine/src/midi_output.rs`), the combined MIDI + audio sweep, the hidden-page `cover` row, the 48 kHz device pass, and the
  other five `audio-verify` scenarios (only `signalsmith` and `varispeed` were rendered).
- **Docs:** `documentation/07-building-a-complete-app.md` (every bus a group, deleting a bus, view states);
  `documentation/08-recording.md` (`measureRoundTrip` options, `storeRoundTrip`, the silent input);
  `documentation/internals/04-sample-loading.md` (the error `cause`, storage failures, the write order);
  `documentation/internals/08-time-and-pitch.md` (`SampleLength`); `src/demos/playback/CLAUDE.md`, `src/demos/recording/CLAUDE.md`,
  root `CLAUDE.md`; the `sdk-upgrade` skill (vendor rows on request). Every new signature checked against the installed `.d.ts`.
