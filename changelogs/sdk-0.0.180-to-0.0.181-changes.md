# OpenDAW SDK Changelog: 0.0.180 → 0.0.181

Published 2026-11-03 20:43 UTC, four days after 0.0.180. 86 commits tag-to-tag (two merges bring
the `follow-live-room` and `live-room-stability` branches in), 190 files under `packages/lib`, the
studio sub-packages and `crates`. The release is the maintainer's **live-room and WebCLAP week**
with, for this repo, a faded stop, hardware MIDI output timed on the audio clock, a MIDI effect that
ends its notes when it leaves the chain, a new MIDI effect (Note Filter), Nano play modes, an audio
track's channel mapping, and two issues filed from this repo closed (openDAW#494, #523). What matters
for this repo:

1. **A user's Stop fades the mix out over one quantum, then resets every device.** The worklet's
   stop now calls the engine's `stop_faded` (`crates/engine/src/lib.rs`): the next rendered quantum
   is multiplied by a ramp from full to silence (128 frames, 2.7 ms at 48 kHz, 2.9 ms at 44.1 kHz),
   and every plugin resets after it; a Play before that quantum resets first, so playback never
   starts inside the fade. An offline render keeps the immediate `stop`. **What the demos read of
   it:** every page's Stop goes through the engine facade, so a tail that used to be cut now fades,
   and a loopback recording of the output carries that fade in its last quantum. The
   recording-alignment sweep judges a take's tail against the engine's stop stamp: a tail row that
   moves by up to one quantum on this release is the fade, not a stop-path regression (the closed
   openDAW#479's kind). Measured: **no tail row moved** — 0 deficit rows of 60 at 48 kHz, 8 rows under 0.1 ms at 44.1 kHz (the frame rounding earlier sweeps read at 0.04–0.14 ms), every cell `aligned`, the multi-mic and forced rows 0 / 0; the fade sits inside the take after the netted stop stamp. The offline-only audits (sample-rate, semantics, placement, delay compensation) keep the immediate stop and read unchanged.
2. **A script that throws while its module loads is reported** — openDAW#523, filed from this
   repo, CLOSED. `ScriptCompiler`'s wrapper (`packages/studio/adapters/src/ScriptCompiler.ts`) now
   builds the processor class inside a try: an error thrown while the module evaluates (a
   misnamed `Processor`, a top-level `throw`) is caught, the new version is still registered, and
   its processor rethrows the error on construction, so the device is silenced and the error
   arrives through `engine.subscribeDeviceMessage(uuid, …)` as it does for a throwing constructor.
   Before, `addModule` resolved, the registry kept the old version playing behind the new
   script's parameters, and nothing was reported. `compile` still resolves (the main thread
   cannot see the worklet scope), so the Spielwerk demo's main-thread preflight
   (`preflightScript`) stays an earlier refusal. Measured here on the Spielwerk demo: a script that throws
   only inside the worklet (past the preflight) compiles without an editor error and the device message
   "Failed to instantiate Processor: Error: boom at worklet load" arrives about 0.5 s later, the device
   silenced (on 0.0.180: no message, the old script playing on).
3. **A sample of 1200 frames or fewer loads** — openDAW#494, filed from this repo, CLOSED.
   `Peaks` (`lib-fusion`) no longer returns an empty stage list when the first stage's ratio is
   at or under 1, so a short one-shot or a take stopped within 25 ms of its start gets a single
   peak stage like any sample up to about 9600 frames; longer samples keep exactly the stages
   they had (`SamplePeakWorker.test.ts`, 72 lines). The MIDI effect placement page's `?sampleMs=20`
   row, which reproduced the refusal, now loads the 20 ms (960-frame) sample and renders the Pitch rows
   `as-predicted`; `?importMs=20` imports a 20 ms take `ok` (both were `error:` on 0.0.180).
4. **Hardware MIDI output is timed on the audio clock** — openDAW#356 (another user's), CLOSED.
   The ring the worklet drains MIDI into (`MIDISender`, `studio-core-processors`) now carries each
   message's due time as a `Float64` **context time in ms** (`quantumStartMs + offset`, the ring
   grew from two `Int32` words to 16 bytes per slot); `MIDIReceiver.create(clock, callback)` takes
   a `MIDIClock` (a provider of a context-ms → `performance.now()` function, read once per ring
   read) instead of an output-latency provider, and `MIDIReceiver.outputClock(context,
   compensationMs)` builds it from `getOutputTimestamp()` (fallback: `currentTime` plus
   `outputLatency`, 20 ms on an offline context); `MIDIReceiver.immediateClock` is the offline
   renderer's. The callback's third argument is now the `performance.now()` timestamp to hand to
   `MIDIOutput.send`; `Project.sendMIDIFromEngine(deviceId, data, timestamp)` is the new entry
   (`receivedMIDIFromEngine(deviceId, data, relativeTimeInMs)` stays and adds `performance.now()`).
   Before, the base was the moment the main thread read the ring, so a late handler (UI work, a
   GC pause, a heavy frame) landed on the note in one direction, and times were rounded to whole
   milliseconds. MIDI CC messages now get the device delay **added** like notes (the engine
   multiplied `relativeBlockTime × 1000 × delay`, a mirrored TS quirk, now removed;
   `midi_output.rs` tests `a_cc_is_timed_like_a_note_its_offset_plus_the_device_delay`,
   `a_cc_with_zero_delay_keeps_its_offset`). **This is the mechanism the MIDI output timing audit
   named `midi-out-main-thread-base`** (its one known defect, pinned on the janked cell): on this
   release a janked engine cell should read `on-time`, and a cell still reading
   `matches-known-defect` would mean the base did not move. The audit needs the IAC Driver and a
   hand (see follow-ups).
5. **Disabling or removing a MIDI effect ends every note it started.** A MIDI effect may export
   `release_all(state_ptr, position, out_ptr, max) → count` (Arpeggio, Spielwerk, WebCLAP MIDI and
   the new Note Filter do; `device_set_release_all` registers the table slot after
   `device_register`, `abi::script_release_notes` ends a Spielwerk script's notes); when a pull
   chain is rebuilt, every effect missing from the new chain (`PullLink::release_leavers`) writes
   its note-offs, which the instrument's next pull hands out first (`released` in
   `plugin_instrument.rs` / `plugin_midi_effect.rs`) and the MIDI Output sends. Arpeggio and
   Spielwerk start clean when enabled again (`release_all_into` on a discontinuous block too), a
   WebCLAP MIDI effect forgets the keys it held. Before, notes from those effects could keep
   sounding when the instrument did not drop its voices on its own. The MIDI effect semantics
   audit sets `enabled` before it renders, so no row sees it: 211 holds / 1 known deviation /
   18 no rule at both rates, as registered. The midi CLAUDE.md's chain-change paragraph now says
   both halves (a rebuild drops the voices; a leaving effect ends its notes).
6. **New MIDI effect: Note Filter** (`0fe8e500c`). `NoteFilterDeviceBox` (`studio-boxes`): `min`
   (Int32 0..127, default 0), `max` (0..127, default 127), `set` (boolean, default false),
   `transpose` (Int32 −127..127, unit "st", default 0), `key` (0..127, default 60), all
   automatable / modulatable / MIDI-controllable; `NoteFilterDeviceBoxAdapter` with
   `namedParameter.min / max / set / transpose / key` (min, max and key print note names and parse
   a name or a 0..127 number); `EffectFactories.NoteFilter` (`type: "midi"`, `boxName:
   "NoteFilterDeviceBox"`, manual `manuals/devices/midi/note-filter`), in `MidiNamed` between
   `Arpeggio` and `Pitch`; `device_note_filter.wasm` (2 379 bytes, `crates/stock-devices/
   device-note-filter`). Rule, from the manual and the crate: only notes between Min and Max
   (both included; none when Min > Max) pass, then either `transpose` semitones are added (a
   result outside 0..127 is ignored) or every passing note plays as `key` (Set); velocity and
   cent are preserved; a note ends on the key it started with even if the parameters change
   while it sounds; disabling or removing it ends the notes it let through. Not in the MIDI
   Effects demo, the placement audit or the semantics audit yet (a follow-up, below). The demos'
   `Factories` type is a `Pick` of `MidiNamed`, so the new key compiled through unnoticed.
7. **Nano gets Mono/Poly, Pan, One-Shot and Fixed pitch** — openDAW#467 (another user's), CLOSED.
   `NanoDeviceBox` fields `panning` (28, Float32 bipolar, default 0), `polyphone` (29, boolean,
   default true), `oneShot` (30, default false), `fixedPitch` (31, default false), the same names
   on `NanoDeviceBoxAdapter.namedParameter` (`"Mode"` prints Mono / Poly, `"Pan"` the mixer's
   panning law). Mono fades the sounding note out over 5 ms when a new one starts; One-Shot
   ignores the note-off and plays to the region's end (a looping note still stops); Fixed plays
   every key at the root pitch (Octave and Tune still apply); a choke fades every voice over 5 ms;
   the 64th voice steals the oldest instead of being dropped; lowering Release during a fade-out
   no longer clicks. The defaults keep every existing project's sound. The Nano is the semantics
   audit's instrument (a sine, 1 ms envelopes, loop off): its register did not move (above). The
   Nano demo binds parameters by name and does not list the four new ones (a follow-up candidate).
8. **An audio track picks its input channels** — openDAW#519 (another user's), CLOSED. "Force
   Mono" becomes Channel Mapping: `CaptureAudioBox` fields `leftInputs` (13) and `rightInputs`
   (14), bit n = input channel n feeds that side, both 0 = follow `requestChannels`;
   `ChannelMapping` (exported from `studio-core`'s `io`: `Stereo`, `MonoMixed`, `stereo(i)`,
   `mono(i)`, `fit`, `indices`, `inputCount`, `outputCount`, `MaxInputs = 31`);
   `CaptureAudio.channelMapping` get / set (the two mappings a channel count stands for are stored
   as the count), `AudioInputRequest.mapping`; `BrowserAudioInput` builds a splitter, one averaging
   gain per side and a merger when a mapping is set, and opens the stream with as many inputs as
   the mapping needs (at least two). **`capture.requestChannels = 1` still means Mono 1+2 Mixed**
   and now also clears both masks, so every demo and audit that sets it reads as before; a
   mapping adds nodes to the input chain only when one is set (the multi-mic sweep's taps saw the
   usual one source node per tape).
9. **The Maximizer's envelope** (`89a1f4487`): the gain no longer falls along a straight attack
   ramp restarted by each peak (hard corners, audible on quiet low-passed signals); it jumps to
   the peak and three moving averages ease it across the look-ahead at the same latency, and the
   hold is a true sliding maximum (`PeakWindow`), so a repeated equal or lower peak no longer lets
   it expire into the hard clamp. Every demo project carries the default master Maximizer
   (removed by the level audits, kept by offline renders): the sample-rate audit's 240 cells and
   the loudness audit read as on 0.0.180 (below).
10. **Transport lock and local device overrides** (Follow Playback, `fd05d5bb6`, and the Mastering
    panel's Compare): `EngineFacade.lockTransport(): TransportLock` (`play`, `stop`,
    `setPosition`, `terminate`), `transportLocked: ObservableValue<boolean>`; while locked the
    facade's own `play()`, `stop()`, `setPosition()` and `prepareRecordingState()` are ignored and
    `RecordingSession.start` refuses. Nothing here locks, so the facade's `play` the repo wraps in
    `initializeOpenDAW` (resume-before-play) runs as before. `subscribeWorkletChanged(observer)`
    fires on every new worklet (first boot or a restart). `overrideDeviceField(uuid, key, value)` on
    `Engine` / `EngineFacade` / `EngineWorklet` / the offline renderer (a no-op there) delivers a
    LOCAL value for a device's plain field without writing the box (not undoable, not synced; gone
    with the next box edit of that field or a rebuild); engine export `override_device_field(uuidPtr,
    key, kind, bits)` with `FieldKind {Int, Float, Bool}`.
11. **Recording in a live room, and what stays the same outside one.** `RecordingSession.editing`
    (what the recorders write through: a `TakeScope` layer in a room, the project's editing
    otherwise) and `holdPublish(): Exec`; `RecordTrack.nextIndex(audioUnitBox)` and
    `createBelow(audioUnitBox, type)`; `RoomTake`; `Project.liveSync: Option<YSync>` and
    `attachLiveSync(sync)`; `Validator.hasOverlappingRegions(boxGraph, skipRegion?)` takes a
    predicate. Outside a room consecutive takes undo together, as before (`bc21207ab`, after an
    interim commit made each take its own step).
12. **`lib-box`**: `Editing.checkpoint()` gains `discard()` (drops the history since the checkpoint
    without touching the graph, and settles it); staging a box under a uuid that is already
    staged panics `"… already staged"` instead of cutting the first box's edges (edges are keyed
    by address; the case: an undo that restores a box a peer re-created under the same uuid,
    `graph.test.ts` "staging a uuid twice"); a listener that throws inside the pointer-transaction
    notification no longer leaves the graph in a transaction forever (the error is rethrown
    after the state is cleared).
13. **`lib-dom`**: `AnimationFrame.dismiss(exec)` removes a queued one-shot (`once`) before it
    fires, and `DeferExec.cancel()` / `terminate()` dismiss their own, so a cancelled defer no
    longer keeps what it captured alive until a frame a hidden tab never renders. The repo's
    hidden-safe frame driver only pumps `AnimationFrame`'s scheduler and is unaffected; the MIDI
    input cell runner's `AnimationFrame.once` use is unchanged.
14. **Smaller fixes**: tempo automation travels as BPM through DAWproject files (openDAW#484,
    another user's: export wrote 120 BPM as 32430, import read BPM as 0..1 fractions; both keep the
    BPM, import clamps it to the supported range); cancelling the large-soundfont prompt aborts the
    import (openDAW#520, another user's; `AssetService` / `SoundfontService`, which this repo
    replaces with a Proxy guard); an Opus encoder in `studio-core`'s ffmpeg module
    (`ffmpeg/opus.ts`, `FFmpegWorker`), used by the studio's contest upload and export dialog.
15. **WebCLAP** (`studio-core-wasm`'s bridge, `crates/wclap-*`, `device_wclap*.wasm`): plugins
    keep their samples in the project (`WclapSampleBox`, a `samples` field, key 16, on
    `WclapDeviceBox` / `WclapInstrumentBox` / `WclapMidiEffectBox`, linking a plugin-chosen key to
    an `AudioFileBox`; the engine delivers them through `abi::wclap_sample`, the bridge copies the
    frames in once resident); a plugin's own change, a parameter drag and a window edit are undo
    steps of their own (`WclapSaveCause = "own" | "params" | "other"`, a fifth argument on the
    `wclapState` protocol message, `WclapStates.store` / `WclapParameters.isDragging`); a plugin
    that ignores its CLAP reset is restarted after a quiet first block (Pro54's ringing voices);
    notes received while a plugin still loads are dropped (a commit that queued them was reverted
    in the same range); a WebCLAP MIDI effect runs along a pulse range outside the current block
    (Zeitgeist's un-warped range) instead of passing input through; `loadEngineModules(base,
    extraDevices?)` and `WasmEngine`'s `extraDevices` let a host hand in device modules the SDK
    does not ship.
16. **Mastering (studio, GPL, not in the SDK)**: `MasteringDeviceBox` + `MasteringDeviceBoxAdapter`
    (`studio-boxes`, `studio-adapters`), `Pointers.MasteringHost = 65`, `AudioUnitBox.mastering`
    (key 27) and the engine's `audio_chain()` (the unit's audio effects by index, then the
    mastering device); the device itself (`crates/device-mastering`, Matchering's analysis and
    limiter ported) lives in a private GPL package the studio hands in as an extra device. **The
    SDK never creates one** (`MasteringDeviceBox.create` exists only in the box factory), an SDK
    engine skips the box and plays such a project unmastered, and `Project.new` still creates the
    master Maximizer only: `removeMasterMaximizer`'s count of 1 holds.

## Sub-package versions

| package | 0.0.180 | 0.0.181 | dist |
|---|---|---|---|
| `studio-core` | 0.2.14 | 0.2.15 | 113 files differ |
| `studio-core-wasm` | 0.0.25 | 0.0.26 | 38 files differ; 8 wasm binaries changed, 1 new |
| `studio-boxes` | 0.0.118 | 0.0.119 | 35 files differ |
| `studio-adapters` | 0.3.12 | 0.3.13 | 24 files differ |
| `studio-enums` | 0.1.10 | 0.1.11 | 7 files differ (`Pointers.MasteringHost`, nine call icons, colours) |
| `lib-box` | 0.0.102 | 0.0.103 | 5 files differ |
| `lib-dom` | 0.0.95 | 0.0.96 | 3 files differ |
| `lib-fusion` | 0.0.111 | 0.0.112 | 2 files differ |
| `studio-sdk` | 0.0.180 | 0.0.181 | `version.js` / `.d.ts` |
| `lib-jsx` | 0.0.97 | 0.0.98 | byte-identical bump |
| `lib-dawproject` 0.0.85, `lib-dsp` 0.0.100, `lib-midi` 0.0.81, `lib-runtime` 0.0.90, `lib-std` 0.0.89, `lib-xml` 0.0.75, `nam-wasm` 1.2.0 | | | unchanged |

Wasm binaries (`studio-core-wasm/dist/wasm`, `cmp` against the installed 0.0.180): `engine.wasm`
1 232 086 → 1 249 144 bytes; `plugins/device_arpeggio.wasm` 7 421 → 7 483; `device_maximizer.wasm`
11 827 → 12 469; `device_nano.wasm` 20 912 → 21 542; `device_spielwerk.wasm` 1 316 → 1 395;
`device_wclap.wasm` 4 808 → 4 916; `device_wclap_instrument.wasm` 13 923 → 14 032;
`device_wclap_midi.wasm` 6 122 → 8 005; **new** `device_note_filter.wasm` 2 379. `stretch_wasm.wasm`
and the other 27 plugin binaries (Pitch, Velocity and Zeitgeist among them) are byte-identical.
`OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.181"`.

## The faded stop (`c414d2f42`, `9ce38198b`)

`EngineState` gains `stop_fading`; `stop_faded()` halts the transport and sets it, `render` multiplies
both output channels of that quantum by `1 − (i + 1) / 128`, `end_faded_stop()` after the quantum
resets every plugin, and `play` resets first when a fade is still pending. `processor.ts` calls
`stop_faded` where it called `stop`; `offline-worker.ts` keeps `stop`. The WebCLAP device's own
fade-before-reset (added one commit earlier for OpenSpatialDelay's echoes) is removed again in favour
of the mix fade. Test `core-wasm/test/stop-fade.test.ts` (69 lines).

## MIDI output on the audio clock (`389224d34`)

`midi-drain.ts` passes the quantum's context time in ms to the drain, so each record's due time is
`quantumStartMs + offsetMs`; `MIDISender` writes it as a `Float64` beside the packed message; the
main-thread `MIDIReceiver` reads the ring, asks its `MIDIClock` once for the current context-ms →
performance-ms relation and sends every message at that mapped time through `MIDIOutput.send`'s
timestamp. The worklet constructs the receiver with `MIDIReceiver.outputClock(context, () =>
compensationLatency × 1000)`. Tests `core-wasm/test/midi-drain.test.ts` (180),
`midi-output-timing.test.ts` (311), `midi-output.test.ts` (+5); `crates/engine/src/midi_output.rs`
(+41, the CC delay and three tests).

## A MIDI effect leaving the chain ends its notes (`a563ccc84`)

`DeviceReg.release_all_index` (0 if the module has no `release_all` export; `device-linker.ts`
registers it); `PullLink::holds` / `release_leavers`; `PluginInstrument` and `PluginMidiEffect`
keep a `released` list that the next `pull` prepends to its output (`released_records` first, then
the block's own events); `MidiOutProcessor::set_pull_chain` releases leavers into a throwaway list
and sends its own note-offs. The Arpeggio's `release_all_into` is shared with the discontinuous-block
path; the Spielwerk's goes through the host (`host_script_release_notes`, `script-spielwerk.ts`
`releaseNotes`). Test `core-wasm/test/midi-fx-disable-release.test.ts` (131).

## Note Filter (`0fe8e500c`)

Crate `crates/stock-devices/device-note-filter/src/lib.rs` (363 lines): `kind()` midi effect,
`process_events` filters by key range, transposes or sets, remembers each passing note-on's emitted
key so its note-off ends the same key, drops a transposed note outside 0..127, `release_all` ends
what it let through. Manual `packages/app/manual/public/devices/midi/note-filter.md` (new, 40
lines). Scripting API `NoteFilter`. Tests `core-wasm/test/note-filter.test.ts` (156),
`param-mapping-parity.test.ts` (+9).

## Nano play modes (`0aa4db2d8`)

`crates/stock-devices/device-nano/src/{lib,voice}.rs` (+114 / +150): the 5 ms mono fade, the pan law
shared with the Playfield slot and the mixer (gliding over 5 ms), one-shot, fixed pitch, choke fade,
voice stealing of the oldest at 64, and the release-lowering click. Tests `tests/play_modes.rs` (111),
`legacy_parity.rs` (+7). Adapter mappings: `panning` `ValueMapping.bipolar()` / `StringMapping.panning`
default 0.5 unit; `polyphone` `StringMapping.values("", [false, true], ["Mono", "Poly"])`.

## Channel mapping (`c0453972e`)

`io/ChannelMapping.ts` (24 lines) and its test (55); `CaptureAudio` subscribes to `leftInputs`
(catch-up) and `rightInputs`, rebuilds the input (`rechannel`) and reopens the stream while armed;
`BrowserAudioInput.#createMapping` (splitter → per-side gains averaging their inputs → merger, or
the single side's gain for a mono mapping) and `#mappedInputs` (a single picked input still opens
stereo). Tests `capture/CaptureAudio.test.ts` (+183), `CaptureAudioPort.test.ts` (+12). Box schema
`forge-boxes/src/schema/std/CaptureBox.ts` keys 13 / 14.

## Maximizer envelope (`89a1f4487`)

`crates/stock-devices/device-maximizer/src/lib.rs` (+178): `PeakWindow` (a sliding maximum over the
look-ahead), the gain jumping to the peak and smoothed by three moving averages, same latency. Test
`core-wasm/test/maximizer-gain-corners.test.ts` (95).

## Studio-app only

Live rooms: audio and video calls above the chat (openDAW#262), Follow Playback (openDAW#325, still
open), scriptable devices recompiled by another participant playing everywhere (`Project` reloads a
script device whose `code` changed, on the transaction's end), overlap resolution between
participants (`ysync/RoomOverlaps.ts`, the whole change taken back like an undo), no renumbering of
units / tracks / effects by the room, device previews and recordings kept local until finished, the
openDAW server (not Google) for direct connections; song contests (`/contests/{name}`, an Opus
mixdown upload); the Mastering panel in the mixer (profiles, analysis up to 10 minutes, live spectrum,
Compare); the convolver speed benchmark moved out of the regular tests (`npm run test:bench`); a
colour-scheme tweak.

## Upstream tests

`studio-core` `AssetServiceImportCancel.test.ts` (196), `EngineFacade.test.ts` (136),
`capture/RecordingSession.test.ts` (+25), `capture/CaptureAudio.test.ts` (+183),
`capture/CaptureAudioPort.test.ts` (+12), `dawproject/DawProjectTempo.test.ts` (90),
`io/ChannelMapping.test.ts` (55), `ysync/LiveRoom.test.ts` (+543 and more), `ysync/LiveRoomFuzz.test.ts`
(+189), `ysync/YSyncLocal.test.ts`, `wclap/WclapParameters.history.test.ts` (+117);
`studio-core-wasm/test/` `maximizer-gain-corners.test.ts` (95), `midi-drain.test.ts` (180),
`midi-fx-disable-release.test.ts` (131), `midi-output-timing.test.ts` (311), `note-filter.test.ts`
(156), `stop-fade.test.ts` (69), `wclap-bridge.test.ts` (+42), `wclap-samples.test.ts` (117);
`studio-adapters` `ScriptCompiler.test.ts` (+32); `lib-box` `editing.checkpoint.test.ts` (+16),
`graph.test.ts` (+18); `lib-fusion` `SamplePeakWorker.test.ts` (72); crates `device-nano/tests/
play_modes.rs` (111), `device-mastering/tests/*`, `matchering/tests/*`.

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler or the tests**: `npm run typecheck` exits 0 and 1950 of
  1950 vitest tests pass on the bare bump. Nothing in `src/` constructs a `MIDIReceiver`, reads
  `receivedMIDIFromEngine`'s argument, or lists `EffectFactories.MidiNamed`'s keys.
- **The semantics audit's Arpeggio citations moved** with the crate (`release_all` added 13 lines
  above the grid loop, one line in the header): `midiEffectSemanticsRules.ts` and its test now cite
  `lib.rs:37-48`, `109-123`, `128-152`, `204-207`, `267-318`, `309-312`, `310` (the dropped cent),
  `139-146`, `288-303`, `280`; the note's rule-source table likewise. The wiring citation
  (`wiring.rs:1061-1066`, `:1063`) and the Pitch, Velocity and Zeitgeist citations are unchanged
  (those crates and the fold are untouched; `wiring.rs` only gained the mastering device after the
  audio chain). The `arpeggio-drops-cent` deviation stays: the maintainer answered openDAW#526 on
  2026-11-04 (the cent was dropped by mistake, the uncapped step is intended, both now in the
  manual) and the fix ships with the next release, not this one (`cent: 0.0` is still at
  `lib.rs:310`; `order-pitch-arpeggio` reads `matches-known-deviation` at both rates).
- **Loops closed**: openDAW#523 (the Spielwerk note's header, `debug/README.md`, the midi
  CLAUDE.md), openDAW#494 (the placement note, the midi CLAUDE.md, the scenario and page comments).
- **Docs touched**: `src/demos/midi/CLAUDE.md` (Note Filter in the adapter list; the chain-change
  paragraph gains the leaving effect's note-offs; the MIDI output "What the SDK does" paragraph now
  describes the audio-clock base and names the old one as the `midi-out-main-thread-base` band; the
  #523 and #494 paragraphs state the fixes as measured); `src/demos/recording/CLAUDE.md` and
  `documentation/08-recording.md` (channel mapping beside `requestChannels`, the import line);
  `documentation/11-effects.md` and `documentation/16-midi.md` (Note Filter in the MIDI effect lists);
  `docs/known-vendor-issues.md` (the Web MIDI paragraph's send path is `sendMIDIFromEngine` with the
  mapped timestamp; Chromium 575891839 assigned 2026-10-27; WebKit 280303 `setSinkId` landed on
  trunk 2026-11-02; 328618's Radar link; the tracker lists re-read: Chromium `Blink>WebAudio` and
  `status:open WebMIDI` by modified time, every WebKit and Firefox bug cited, nothing new that
  reaches here, 530996650 added to the Web MIDI read-only list; "Last checked" moved on the entries
  the sweeps exercised); the three debug notes (semantics: the 0.0.181 run and the #526 answer;
  placement: #494 re-measured; Spielwerk: #523 re-measured) and `debug/README.md`.
- **Standing sweeps** (Chrome 156, the Playwright browser, the tab visible, the Mac's output device at
  44.1 kHz; every row read against its register): MIDI effect semantics 211 holds / 1 known deviation
  (`arpeggio-drops-cent`) / 18 no rule at both rates, no row changed (runs 1793808711783, 1793808780528);
  sample-rate **240 of 240** with every family maximum unchanged (metronome 0.08, loop-wrap 0.54, seam 0.2,
  region-fencepost 0.03, note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos
  0.07, audio-wrap-click 0.39 / -onsets 0.05 / -dip 0.02 ms; the dip −3.1 dB, the wrapped loop-start hit
  −2.8 dB / +1.00…+1.07 ms); recording alignment 48 kHz 10 of 10 cells `aligned`, tally 1.15 ×27 / 1.17 ×15 /
  1.16 ×12 / 1.10 ×6 (the 0.0.180 tally exactly), 44.1 kHz 10 of 10, +1.09…+1.19, 0 head deficits, tails
  0 rows / 8 rows under 0.1 ms; multi-mic +1.146 on all 32 rows, raw skew 0.00 on all 16 repeats; forced
  48 of 48 at 0 / 0 in three runs; the one-quantum tally **0 in 76**; #459 page **FIXED**; delay
  compensation **lag 0** on every row; MIDI effect placement **13 of 13** at both rates, and the Pitch rows
  `as-predicted` on a 20 ms sample; loudness **28 of 28** at both rates, judged metrics unchanged to the
  hundredth (the unjudged after-the-end range moves by its usual 0.1 LU steps). Chromium probe, hardware-free
  rows: first-read `STALE FIRST READ` 13 of 15 (none 3, large 5, slow 5), suspend-resume `HALF RATE` on the
  first run (ratio 0.537 from cycle 2), capture-gaps loopback `CLEAN` at 48 000 / `START GAPS` (one
  441-frame start run) at 44 100, opfs-flush median 0.70 ms per 1 MiB / 1.55 ms per 16 MiB, opfs-usage
  in-session `COUNTED` — every one the register's reading. Not run (hardware or a hand): the IAC MIDI input
  sweep and its loop-wrap / effect arms, the MIDI output timing audit (the #356 re-measure), the combined
  MIDI + audio sweep, the hidden-page `cover` and `modal` rows, the Chromium bfcache / freeze / OPFS-restart /
  microphone / Bluetooth rows, the 48 kHz device pass.
- **Verification**: `npm run typecheck` 0 errors, 1950 of 1950 vitest tests (unchanged: the release forced
  no test change and the citation moves are comments), `npm run build`, `npm ci` on the regenerated lockfile;
  the openDAW checkout and the XERJ corpus clone moved to `5820e7791` (the `@opendaw/studio-sdk@0.0.181` tag;
  40 670 records re-indexed).
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`, diffed against a
  copy of the installed 0.0.180 packages taken before the bump): `OPENDAW_SDK_VERSION = "0.0.181"`;
  `stop_faded`, `override_device_field`, `device_set_release_all` and `FieldKind` in
  `studio-core-wasm`'s `engine-exports.d.ts`, `release_all?` in `device-linker.d.ts`, `ExtraDevice` /
  `extraDevices` in `engine-modules.d.ts` / `WasmEngine.d.ts`; `MIDIClock`, `MIDIReceiver.create(clock,
  callback)`, `outputClock`, `immediateClock` and the `timestamp: number` callback in
  `midi/MIDIReceiver.d.ts`; `sendMIDIFromEngine`, `liveSync`, `attachLiveSync` on `Project`;
  `TransportLock`, `overrideDeviceField` on `Engine`, `lockTransport`, `transportLocked`,
  `subscribeWorkletChanged` on `EngineFacade`; `editing`, `holdPublish` on `RecordingSession`;
  `nextIndex`, `createBelow` on `RecordTrack`; `channelMapping` on `CaptureAudio`, `mapping` on
  `AudioInputRequest`, `ChannelMapping` exported from `io`; `leftInputs` / `rightInputs` (13 / 14) on
  `CaptureAudioBox`; `mastering` (27) on `AudioUnitBox`; `panning` / `polyphone` / `oneShot` /
  `fixedPitch` (28–31) on `NanoDeviceBox` and its adapter; `NoteFilterDeviceBox` (fields 10–14),
  `NoteFilterDeviceBoxAdapter`, `EffectFactories.NoteFilter` and the `MidiNamed` key,
  `DeviceManualUrls.NoteFilter` / `Mastering`; `MasteringDeviceBox`, `WclapSampleBox`,
  `Pointers.MasteringHost = 65`; `WclapSaveCause` and the five-argument `wclapState` in
  `studio-adapters`' protocols; `hasOverlappingRegions(boxGraph, skipRegion?)` on `Validator`;
  `discard()` on the checkpoint in `lib-box`'s `editing.d.ts`; `AnimationFrame.dismiss` in
  `lib-dom`'s `frames.d.ts`; the 8 changed, 1 new and 28 byte-identical wasm binaries.
