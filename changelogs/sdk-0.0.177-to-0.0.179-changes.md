# OpenDAW SDK Changelog: 0.0.177 → 0.0.179

Two publishes on one day: 0.0.178 (2026-10-29 08:31 UTC, 146 commits after 0.0.177) and 0.0.179
(12:46 UTC, 28 more: the Korpus release and the MIDI-effect voice fix). The repo goes straight from
0.0.177 to 0.0.179, so this file covers both: 174 commits tag-to-tag, 160 of them non-merge, 533
files. Most of the range is studio app code (WebCLAP device panels and updates, a sample editor
page, SoundCloud upload, colour schemes, the community-scripts dialog) and the new Korpus
instrument. What matters for this repo:

1. **A position jump crossfades audio regions over 5 ms** — at a seek, a loop wrap or a marker
   jump, every native or pitch read still sounding at the old position is released as a
   fade-out tail, and a region entered partway in fades in over the same 5 ms; a region entered
   at its own start keeps its hard onset. A loop over audio used to hard-cut at every wrap. **This
   changes what the demos play** at every loop wrap and seek over an audio region (no click
   now); no demo reads a value from it, and the standing sweeps do not measure it (their
   loop-wrap family plays a note region) — see follow-ups.
2. **A change to an instrument's MIDI effect chain drops its sounding voices** — bypassing,
   removing or adding a MIDI effect while a note sounds used to leave the note hanging (the new
   chain never ended a note the old one started). Now the instrument resets its voices and a
   MIDI Output sends note offs for the notes it holds; a change that leaves the MIDI effects as
   they were (an audio effect added) keeps the notes. No demo toggles a MIDI effect while
   notes sound (the placement audit sets `enabled` before an offline render).
3. **A user-created sample is no longer deleted when its last box goes** — the project used
   to ask "Keep Sample?" (or follow the `auto-delete-orphaned-samples` preference, now removed)
   and delete it from storage. Now it MARKS it in `samples/v2/garbage.json`
   (`SampleGarbage.mark`; an undo that brings the box back unmarks it), and only
   `SampleGarbage.purge(inUse?)` deletes. The demos never call `trackUserCreatedSample` and
   sweep the whole folder at page load, so nothing changes for them; the troubleshooting chapter
   and root CLAUDE.md described the old rule and are rewritten.
4. **MIDI Output can be a layer of an Instrument Composite** — `InstrumentFactories.isLayerInstrument`
   accepts every notes instrument now (the MIDI Output exclusion is gone), and the engine wires
   a layer's MIDI Output through the track's MIDI effects and its own. The engine's MIDI Output
   wiring (`crates/engine/src/audio_unit/wiring.rs`, `midi_output.rs`) was rewritten for it —
   the path the MIDI output timing audit measures, which needs the IAC Driver and was not run
   in this session (follow-ups).
5. **Byte fields sync the range that changed** — a `ByteArrayField` change travels as a new
   `update-bytes` task (`{address, offset, deleteCount, bytes}`) when that is smaller than the
   value; `ByteArrayField` gains `setBytes`, `setByte`, `setLength`; `BytesSplice` in
   `lib-box`. The Rust mirror resolves it into an ordinary primitive update. The repo's Node
   tests that feed a live `SyncSource` through `serializeUpdateTasks` into `engine.wasm` pass
   unchanged.
6. **`BoxEditing.checkpoint()` and boxes outside the history** — a checkpoint folds everything
   edited after it into ONE undo step on `commit()`, or reverts it on `rollback()`; the
   constructor takes an `outsideHistory` predicate, and `Project` passes
   `box => box instanceof WclapParameterBox` so an undo that removes a WebCLAP device takes the
   parameter boxes the engine created along.
7. **A live key release no longer cancels other pitches' pending note-ons** — the note
   sequencer's raw note-off used to drop every never-started note it walked past, so a
   staccato key released in the same event batch as a chord strum silenced the chord. It now
   cancels or gates off only its own pitch.
8. **New API**: the **Korpus** physical-modelling instrument (`InstrumentFactories.Korpus`,
   `KorpusDeviceBox`, `KorpusDeviceBoxAdapter`, `device_korpus.wasm`); WebCLAP note effects as
   MIDI effects (`EffectFactories.WclapMidi`, `WclapMidiEffectBox`,
   `WclapMidiEffectBoxAdapter`, `device_wclap_midi.wasm`);
   `project.api.wrapEffectsIntoComposite(effects)`; `AudioMonoConversion` (sum / equal-power
   mono mixdown that swaps every user of a sample in one undo step);
   `project.untrackUserCreatedSample(uuid)`; `EngineFacade.restart()`;
   `AnimationFrame.clampTo60fps`; `Workers.SampleEffect` and `lib-dsp`'s `sample-effects` /
   `audio-splice`; `SoundCloudApi`; WebCLAP device panels (`wclapOpenPanel`); a WebCLAP plugin
   state in a bytes field (`pluginState`, field 14) with `MigrateWclapState`.
9. **Smaller fixes**: dragging an automation region's content start earlier no longer crashes
   when its points are as far apart as the drag (live error 1192); a script compiled without
   `@label` resets a name the previous `@label` gave (#504, filed by another user); script
   code without a compiler header counts as never compiled, so its first compile creates its
   records; `SMPTE.fromSeconds` rounds once on the subframe grid and carries into the next
   second (#503); a WebCLAP plugin's `CLAP_PROCESS_ERROR` output is discarded (#501) and every
   declared audio port gets buffers (#500); `StudioSettings` replaces `neutral-hue` /
   `neutral-saturation` with `color-scheme` (`setColorScheme("classic" | "modern" |
   "contrast")`, classic the default and unchanged) and adds `clamp-to-60fps` and
   `new-instrument-note-region` (app behaviour only).

No issue this repo filed closes in the range: openDAW#491–#494 stay open.

Sub-package versions (installed): `studio-adapters` 0.3.11 (was 0.3.9), `studio-core` 0.2.13
(0.2.11), `studio-core-wasm` 0.0.24 (0.0.22), `studio-boxes` 0.0.117 (0.0.115), `studio-enums`
0.1.10 (0.1.8), `lib-box` 0.0.101 (0.0.99), `lib-dom` 0.0.95 (0.0.93), `lib-dsp` 0.0.99
(0.0.97). Bumped with a byte-identical `dist` (version bump only): `lib-fusion` 0.0.110,
`lib-std` 0.0.89, `lib-jsx` 0.0.97, `lib-midi` 0.0.80, `lib-dawproject` 0.0.84, `lib-runtime`
0.0.90, `lib-xml` 0.0.75. Unchanged: `nam-wasm` 1.2.0. Licences unchanged (AGPL-3.0-or-later;
`nam-wasm` MIT). WASM: **36 binaries under `studio-core-wasm` (34 before), 18 changed or new** —
`engine.wasm` 1 215 110 → 1 231 649 bytes (the jump crossfade, the MIDI Output wiring and voice
hand-over, the WebCLAP MIDI-effect host, the bytes-splice resolve, the note-sequencer release),
two new (`device_korpus` 47 109, `device_wclap_midi` 6 122), and 15 rebuilt stock devices
within a few hundred bytes of their 0.0.177 size (`device_cubed`, `device_wclap_instrument`,
`device_neural_amp`, `device_maximizer`, `device_wclap`, `device_zeitgeist`,
`device_stereo_tool`, `device_waveshaper`, `device_convolver`, `device_fold`,
`device_playfield_sample`, `device_tubular`, `device_vocoder`, `device_soundfont`,
`device_neon`). The other 18 binaries are byte-identical. `OPENDAW_SDK_VERSION` in the
installed `studio-sdk` reads `"0.0.179"`.

## Jump crossfade (`1ea923eb7`)

`crates/engine/src/audio_region_player.rs`: `JUMP_FADE_DURATION` 0.005 s. On a block flagged
`discontinuous()` while playing, `seed_jump_tails` releases each native read still sounding
(skipping a region whose content ended in the last block) into `jump_tails` as a `ReleaseTail`
whose ramp starts at the read's last envelope level (`level`), so a jump inside a fade does not
pop back to full gain; `render_release_tails(jump_tails, …)` renders them. A read entered at
`from > region.position` gets `fade_in = jump_window` samples and its envelope is the minimum of
the region envelope and the fade-in ramp. Pitch reads go through `begin_crossfade`; a
Signalsmith read blends its already synthesized output into the restarted stream
(`crates/signalsmith/src/stretch.rs`, +34); `release_jumped_out` rings out a granular or
Signalsmith region the jump left. The transport flags the first block after a seek, a loop wrap
(`Action::Loop`) and a marker repeat as discontinuous, so all three crossfade. Upstream test
`core-wasm/test/audio-region-jump-declick.test.ts` (85 lines: a 220 Hz sine region, a jump at
block 20, the largest sample-to-sample step after it); `audio-region-playback.test.ts` adjusted.

## MIDI chain change ends notes (`a5d438fb2`)

`PullLink::same` compares two pull chains (same producers, same order, same choke and gate).
`PluginInstrument::set_pull_chain` resets the instrument when the chain differs (the TS engine's
`setNoteEventSource` did the same); `MidiOutProcessor::set_pull_chain` ends the held notes of a
composite layer's node when its chain changed; a unit's rebuilt MIDI Output node either takes over
the previous node's active notes (`hand_over`, chain unchanged) or ends them;
`teardown_midi_out_device` ends the notes of a node leaving the graph. Upstream test
`core-wasm/test/wclap-midi-effect.test.ts` (+105: a WebCLAP note effect and Pitch, bypassed and
removed, a composite layer, a plugin instrument's voice, the changes that keep notes).

## Sample garbage (`0bca570d8`)

`studio-core` `SampleGarbage` (`mark`, `unmark`, `list`, `purge(inUse?)`, all serialized through
one promise queue; the list lives in `${SampleStorage.Folder}/garbage.json`). `purge` keeps a
uuid in `inUse` or used by any saved project, template or preset (`ProjectStorage` /
`TemplateStorage` / `PresetStorage.listUsedAssets(AudioFileBox)`), skips one already gone,
deletes the rest and rewrites the list with the failures. `Project` marks a user-created
sample's uuid on its `AudioFileBox` delete and unmarks it on a re-create; the private
`#deleteUserCreatedSample` (the prompt and the immediate delete) is gone, and so is the
`storage` section of `StudioSettings`. The studio purges at boot (app code). Upstream test
`AudioMonoConversion.test.ts` (283 lines, the conversion and its garbage marks).

## MIDI Output as a layer (`6eb0f78a5`), wrap into composite (`8db16a866`)

`InstrumentFactories.isLayerInstrument` drops `factory !== MIDIOutput`. The engine wires a
layer's MIDI Output with its own pull chain (the track's MIDI effects, then the layer's), lights
the track's note indicator, picks up CC parameters added later, and mute / solo of a layer stops
its new notes (nested composites too) while a sounding note is still released
(`audio_unit/wiring.rs` +204 / −100, `composite.rs`, `midi_output.rs`). `ProjectApi
.wrapEffectsIntoComposite(effects): Attempt<AudioEffectCompositeBox, string>` (refuses an empty
list, a non-audio effect, effects of different chains; the composite goes at the lowest index,
the effects into its first entry in order, automation follows the moved boxes). Upstream tests
`core-wasm/test/midi-output.test.ts` (+128), `AudioUnitIntoComposite.test.ts` (+75),
`InstrumentCompositeAdapters.test.ts`.

## Bytes splice (`5833f0aa5`), WebCLAP state as bytes (`71396f322`)

`lib-box`: `BytesSplice.of(from, to)` (common prefix and suffix, `None` when equal), `apply`,
`cost`; `ByteArrayField.setBytes(offset, bytes)`, `setByte(index, value)`, `setLength(length)`;
`UpdateTasks.of(update)` emits `update-bytes` when the splice is smaller than the value;
`SyncTarget` applies it; `serializeUpdateTasks` writes it; `crates/boxgraph` resolves it inside
the transaction into a primitive update (observers and the checksum see whole values). In a Yjs
room a value over 16 KB is a map of chunks with generation tags (`YBytes`). `WclapDeviceBox` /
`WclapInstrumentBox` field 14 `pluginState` (`ByteArrayField`); field 12 (base64) is read only
while 14 is empty; `MigrateWclapState` converts on load. Upstream tests `bytes.test.ts` (370),
`YBytes.test.ts` (424), `core-wasm/test/bytes-range-mirror.test.ts` (177),
`crates/boxgraph/tests/bytes_splice.rs` (164), `MigrateWclapState.test.ts` (90).

## Editing checkpoint (`c8de6ef9c`, `a052ad8b7`)

`BoxEditing.checkpoint(): EditingCheckpoint {rollback(), commit()}` (asserts it is not called
inside a modify; settles once; does nothing after `clear()`, which now bumps an epoch);
`new BoxEditing(graph, outsideHistory = Predicates.alwaysFalse)`; `Modification.inverse` deletes
attached boxes matching `outsideHistory` that point at a box the step created before unstaging
it. `Project`'s default editing passes the `WclapParameterBox` predicate. `project.editing` is
still typed `Editing` (lib-std), which has no `checkpoint`. Upstream tests
`editing.checkpoint.test.ts` (144), `WclapParameters.undoCreate.test.ts` (+91).

## Note-sequencer release (`0c369e807`)

`crates/engine-env/src/note_sequencer.rs` `push_raw_note_off(pitch)`: finds the first held note
of that pitch still gated; a never-started one is removed, a started one is gated off; other
pitches are untouched. Rust test `a_staccato_release_must_not_sweep_other_pending_notes`. The
MIDI input sweep's recorder reads the capture's raw note signals, not this sequencer, so its
figures do not depend on it; live monitoring of a chord with a fast key in the same batch does.

## Korpus (`aee804e6a` … `bdcb7c481`)

`KorpusDeviceBox` (fields 1 host … 31; an `exciter` Strike / Breath / Bow / Pick / Wind,
`objectA` / `objectB` among Marimba, Vibraphone, Bell, Membrane, Plate, Piano Wire — under Pick
or Wind object A is a string or a pipe — couple, damping, stroke, level A, tune B and more),
`KorpusDeviceBoxAdapter` with its `namedParameter`s, `InstrumentFactories.Korpus` (a notes
instrument), the engine crate `device-korpus` (16 voices; a stolen voice fades out over a few
milliseconds). The development-only Tune B / Detune B fields, their migration and the factory
presets were removed before the release (`8152b1a39`, `2e72aa1ba`): presets go through the
SDK's preset system. Upstream tests `crates/stock-devices/device-korpus/tests/render.rs`,
`core-wasm/test/korpus-render.test.ts`, `korpus-chords.test.ts`.

## Studio-app only

WebCLAP device panels (a plugin drawing its own 176 px page; `wclapOpenPanel`,
`wclapShowGui` / `wclapHideGui` on the protocol), saves tagged with the plugin's url and clapId,
Update and undo of a build, device names from the plugin; the sample editor page (`/sample-editor`,
work in progress) and its worker effects; SoundCloud upload from Project Info; Convert to Mono
in the region menu; the storage page's "Delete unused" (#497); colour schemes; the 60 fps
preference; a one-bar note region for a new MIDI instrument (a studio setting, not
`createInstrument`); the debug menu's engine restart and garbage purge; script-device header
and view fixes (#505, #506, #507, #510); the Play button menu wording (#509); Escape on the
side pages (#511); the community-scripts dialog; the Werkstatt / Spielwerk / Apparat examples
removed from the repo (the core-wasm tests read their scripts from `test/assets`); live errors
1190–1193.

## Upstream tests

`lib-box` `bytes.test.ts` (370), `editing.checkpoint.test.ts` (144); `lib-dsp`
`audio-splice.test.ts` (97), `sample-effects.test.ts` (235), `smpte.test.ts` (+23);
`studio-adapters` `ScriptCompiler.test.ts` (+48), `ScriptRecords.test.ts` (+9);
`studio-core` `AudioMonoConversion.test.ts` (283), `AudioUnitIntoComposite.test.ts` (+75),
`MoveContentStart.test.ts` (+14), `MigrateWclapState.test.ts` (90), `YBytes.test.ts` (424),
`WclapParameters.*.test.ts`, `WclapStates.name.test.ts` (91), `WclapGuis.test.ts` (68);
`core-wasm/test/` `audio-region-jump-declick.test.ts` (85), `bytes-range-mirror.test.ts` (177),
`midi-output.test.ts` (+128), `wclap-midi-effect.test.ts` (201 + 105),
`wclap-state-bytes-mirror.test.ts` (81), `wclap-bridge.test.ts` (WetChorus, Xenon, Glitchfest,
device panel, audio ports), `korpus-render.test.ts`, `korpus-chords.test.ts`;
`crates/boxgraph/tests/bytes_splice.rs` (164), `crates/stock-devices/device-korpus/tests/render.rs`,
`crates/engine-env` note-sequencer test.

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler or the tests**: `npm run typecheck` exits 0 and
  1526 of 1526 vitest tests pass on the release before any repo change. Nothing in `src/` reads
  `StudioSettings` / `StudioPreferences`, calls `trackUserCreatedSample`, toggles a MIDI effect
  while notes sound, uses WebCLAP, or reads `SMPTE`; `Colors.blue` / `Colors.purple` (mixer
  groups, convolver bus) are the classic scheme's, unchanged.
- **Docs for what changed**: `documentation/13-troubleshooting.md` and root CLAUDE.md (sample
  garbage: marked, not deleted; `SampleGarbage.purge`), `documentation/09-editing-fades-and-automation.md`
  and `documentation/internals/01-engine-processor.md` (the 5 ms jump crossfade),
  `documentation/03-animation-frame.md` (`AnimationFrame.clampTo60fps`),
  `documentation/internals/02-box-system.md` (the `ByteArrayField` writers, checkpoints, boxes
  outside the history), `documentation/internals/03-cross-thread-protocols.md` (`update-bytes`),
  `src/demos/midi/CLAUDE.md` (MIDI Output as a layer, `wrapEffectsIntoComposite`, Korpus, the
  voice drop on a MIDI chain change), `src/lib/frameScheduler.ts`'s comment (the SDK's 16 ms
  frame skip holds while `clampTo60fps` stays on).
- **The sdk-upgrade skill** lists the MIDI output timing audit (built a day after the skill;
  root CLAUDE.md already named it) and says never to skip it on a release that touches the MIDI
  Output device.
- **Standing sweeps on the release — every SDK reading the 0.0.177 reading**:
  sample-rate / quantum-alignment **180 of 180** cells pass (every family's maximum deviation
  the 0.0.177 value to the hundredth — metronome 0.08, loop-wrap 0.54, seam 0.20,
  region-fencepost 0.03, note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07,
  transport-pos 0.07 ms). Recording start-alignment, 48 kHz and 44.1 kHz, 60 rows each, 0 error
  rows, every repeat finalized: 48 kHz netted tally 1.15 ×33, 1.17 ×15, 1.07 / 1.10 / 1.13 / 1.14
  ×3 each (the 0.0.174–0.0.177 tally exactly), **0 tail deficits**, one head deficit of 129.0 ms
  on `nominal-start/120` repeat 1 — the first recording after the fresh `npm install` and dev
  server, the cold-start event every sweep since 0.0.173 has recorded at that place
  (`recaudit-summary-1793288881847.json`); 44.1 kHz **10 of 10 cells aligned**, netted
  +0.97…+1.19, one tail row at 0.14 ms (frame rounding, as on 0.0.177; `…1793289296147.json`).
  Multi-mic 32 rows netted +1.146 on every row, netted skew 0.00, both cells `aligned`, raw skew 0
  on 15 of 16 repeats and −9.33 ms on one janked repeat, all of it the two source nodes' own
  delays (the vendor register's per-node stream delay; `recaudit-mt-summary-1793289709106.json`);
  three forced-churn runs 48 rows, 62 800–78 521 connect / disconnect pairs per repeat, 113–124
  clock stalls per run, **every row at 0 / 0 quanta** off the usual placement, no tail deficit;
  one-quantum tally **0 in 76** (0.0.177: 0 in 76). `param-write-enabled-flip-debug-demo.html`
  **FIXED** (step 2 tail 2100 ms, step 3 400 ms). `plugin-delay-compensation-debug-demo.html`
  **lag 0 frames on every row** (onset 12000, peak 0.500, score 1.000). MIDI effect placement
  **13 of 13 rows `as-predicted`** at 48 kHz and at 44.1 kHz. Loudness meter **28 of 28 rows at
  48 kHz and at 44.1 kHz** (`loudness-audit-1793290834832.json`, `…1793291528283.json`; every
  judged metric the 0.0.177 value to the hundredth; rows in `debug/2026-10-02-loudness-meter/note.md`
  under "SDK 0.0.179"). Recording rows and reading in the recording register under "Standing sweep
  on 0.0.179". The browser moved from Chrome 155 to 156.0.8078.49 since the last sweep; the
  Chromium probe's hardware-free rows read the register's entries: `first-read` `STALE FIRST
  READ` 14 of 15; `suspend-resume&tracker=1` `HALF RATE` on two of three runs and `CLEAN` on the
  first (the race does not fire every run — the skill's row now asks for three); `capture-gaps`
  loopback `CLEAN` at 48 000 and `START GAPS` (the one 441-frame run) at 44 100; `opfs-flush`
  median 0.63 ms per MiB; `opfs-usage` in-session `COUNTED`. Chromium tracker 575891839 gained a
  report (comment #3) that a plain page freeze → resume halves the worklet clock as a
  back/forward-cache restore does, which the reload guard does not cover — recorded as a
  candidate in the register, not reproduced here. Hidden-page recording, the three `modal` rows
  (the alert dismissed through the tooling's dialog handler after at least five seconds): **both
  takes `intact` on every row** (31 / 31 beats, median 1.15 ms; the stop row's finalization waited
  the 14.8 s the dialog was up; rows in `debug/2026-10-21-hidden-page-recording/note.md`). Not run
  this time (they need the IAC Driver, a quiet room with the built-in microphone, or a hand): the
  MIDI input sweeps, **the MIDI output timing audit (the release rewrote the MIDI Output wiring it
  measures)**, the combined MIDI + audio sweep, the hidden-page `cover` rows, and the Chromium
  probe's bfcache, OPFS-restart, microphone and Bluetooth rows.
- **Not measured here**: the audio-region jump crossfade (no standing harness plays an audio
  region across a wrap or a seek; the loop-wrap family is a note region) — pinned by the
  upstream test only.
- **Verification**: `npm run typecheck` 0 errors, 1526 of 1526 vitest tests, `npm run build`,
  `npm ci` on the regenerated lockfile; the openDAW checkout and the XERJ corpus clone moved to
  `652e6caf7` (the `@opendaw/studio-sdk@0.0.179` tag; 38 750 records re-indexed).
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`, diffed
  against a copy of the installed 0.0.177 packages taken before the bump):
  `OPENDAW_SDK_VERSION = "0.0.179"`; `SampleGarbage` (`mark`, `unmark`, `list`, `purge`) exported
  from `studio-core`'s `samples`; `untrackUserCreatedSample` on `Project`; the `storage` section
  gone from `StudioSettings`, `color-scheme` / `clamp-to-60fps` / `new-instrument-note-region`
  added; `checkpoint()` and the `outsideHistory` parameter on `BoxEditing`; `setBytes` /
  `setByte` / `setLength` on `ByteArrayField`; `update-bytes` in `UpdateTask`; `UpdateTasks.of`;
  `BytesSplice`; `Korpus` in `InstrumentFactories` and `InstrumentBox`; `WclapMidi` in
  `EffectFactories`, `WclapMidiEffectBox` in `EffectBox`; `wrapEffectsIntoComposite` on
  `ProjectApi`; `restart()` on `EngineFacade`; `wclapOpenPanel` on `Engine` / `EngineFacade` /
  `EngineWorklet`; `SampleEffect` on `Workers`; `AudioMonoConversion`; `pluginState` (14) on the
  two WebCLAP boxes; `ColorScheme` / `setColorScheme(value)` in `studio-enums`; `host_block_at`
  in `engine-exports`; the 18 changed or new and 18 byte-identical wasm binaries (compared with
  `cmp` against the 0.0.177 copy).
