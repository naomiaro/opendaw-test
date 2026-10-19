# OpenDAW SDK Changelog: 0.0.174 → 0.0.175

One publish (0.0.175 on 2026-10-19; 92 commits tag-to-tag, 284 files). What matters for
this repo:

1. **A parameter write in the same transaction as a chain re-wire reaches the engine (#459,
   filed from this repo)** — `crates/engine` refreshes a unit's parameters after a chain
   reconcile too, not only after a plain field edit. Measured on the release:
   `param-write-enabled-flip-debug-demo.html` reads **FIXED** (step 2 tail 2100 ms, step 3
   400 ms, every step ok); the page is the regression test from here on.
2. **The engine state reaches the main thread every frame, not every other one** — lib-std's
   `SyncStream` checked `Atomics.compareExchange` against the wrong value, so every second
   `tryWrite` and every second `tryRead` was a no-op; `engine.position`, `isPlaying`,
   `isRecording`, BPM and the meter values now update at the frame rate. Nothing to change
   here; anything that reads the transport observables sees them move twice as often.
3. **The master analysis excludes the metronome (#463)** — the engine renders a second
   stereo buffer (`analysis_ptr`) holding the mix without the click; the peak meter, spectrum,
   waveform, stereo, gonio and **loudness** taps read it live, and the offline worker's
   analyser and peaks read it too. `output_ptr` still carries the click. The loudness harness never plays the click, so its rows are unchanged
   by this (verified below).
4. **MIDI recording places a note where its MIDI event was stamped** — `NoteSignal` carries
   the event's `timeStamp`, `RecordMidi` extrapolates the write position from it between
   two playhead updates (never across a loop end the engine wraps at) and writes the duration
   at key-up instead of the next playhead update; a tap shorter than a playhead update keeps
   its real length. Nothing in this repo wrote notes by hand through `noteSignal`.
5. **Whole ticks stay whole in any loop length** — lib-std `mod` is `((v % r) + r) % r` (was
   `fract(v / r) * r`, which read `mod(7200, 6240)` as 959.9999999999993), the Rust
   `mod_euclid` mirrors it (`fmod(fmod(n, m) + m, m)`), and the seven stock device binaries
   that wrap a phase with it changed bytes. Cutting or start-trimming a looped note or
   automation region keeps every event on its tick (PR #469).
6. **Note-region editing** (PRs #468, #470, #471, #472, #474): `NoteRegionBoxAdapter.flatten`
   keeps the region it is called on (id, selection, editor survive) and takes a
   `truncateNotesAtRegionEnd` flag; a new `resetLoopOffset(truncateNotesAtRegionEnd)` makes
   a region's loop start at the region start without changing what it plays;
   `moveContentStart` consolidates a mirrored region first and moves each event exactly once
   (a zero delta is a no-op) on note and value regions; `NoteEventBoxAdapter.copyTo` copies
   `playCurve` (typed `bipolar` now), so duplicated and copied notes keep fine tune, chance,
   play count and play curve.
7. **A box deleted and restored by undo no longer acts through its old instance** —
   `Box.isAttached()` is true only when the graph's box at that uuid IS this instance,
   `Field.isAttached()` asks its box, and `ParameterAdapterSet.removeParameter` terminates
   the adapter it removes (a box recreated at the same address found the old adapter and
   wrote to the deleted field). Code that keeps box instances across an undo (the studio's
   recorders did) now sees the stale instance report detached.

Plus: `WavFile.encodeInts24` (and an odd-sized data chunk padded to an even byte count);
lib-dom `Fullscreen` (`isAvailable` / `request` / `toggle`, a wrapper that throws
synchronously counts as a refusal — live 1181); lib-fusion `StorageWalk` (every file under an
OPFS directory with its size) and an `OpfsWorker` warning after 2 s of waiting for a path lock
that names the holder and the step it hangs at; `TrackBox.height` (field 31, px, 0 = theme
default, `MaxTrackHeight` 240 in `studio-enums`); the Tape factory's `defaultName` is
"Audio Track" (`briefDescription` "Audio Playback") and `InstrumentFactories.Sorted` lists the
factories by name; Tubular always runs the Modern kernel (#423: `Tubular.Engines` removed,
the box's `engine` field deprecated); `AssetService.replaceMissingFiles` fetches no catalogue
for a project without sample or soundfont boxes; the engine mirror keeps lone UTF-16
surrogates byte-exact (a checksum mismatch restarted the engine in a loop) and caches a
per-box checksum fold; WebCLAP instruments get up to eight audio inputs picked like a
side-chain, a plugin's `request_callback` runs between quanta, a failed plugin can be
retried once its bundle is back (`wclapRetry`), `WclapStatus` reports the plugin's input
ports and whether it has an editor, a bare `.wasm` counts as a bundle, the parameter boxes
stay out of the undo history, and a changed parameter range never inverts between its two
writes (live 1175).

Sub-package versions (installed): every sub-package bumped by one — `studio-adapters` 0.3.7
(was 0.3.6), `studio-core` 0.2.9 (0.2.8), `studio-core-wasm` 0.0.20 (0.0.19), `studio-boxes`
0.0.113 (0.0.112), `studio-enums` 0.1.6 (0.1.5), `lib-box` 0.0.97 (0.0.96), `lib-dsp` 0.0.96
(0.0.95), `lib-fusion` 0.0.106 (0.0.105), `lib-midi` 0.0.77 (0.0.76), `lib-dawproject` 0.0.81
(0.0.80), `lib-std` 0.0.87 (0.0.86), `lib-dom` 0.0.92 (0.0.91), `lib-jsx` 0.0.94 (0.0.93),
`lib-runtime` 0.0.88 (0.0.87), `lib-xml` 0.0.73 (0.0.72); `nam-wasm` 1.2.0 unchanged.
Licences unchanged (AGPL-3.0-or-later; `nam-wasm` MIT). No sub-package ships a CHANGELOG
with content (`forge-boxes`'s carries the two app commits that touched a schema). WASM:
**35 binaries, 10 changed** — `engine.wasm` (1 089 924 → 1 109 891 bytes: the analysis
buffer, the checksum cache and `Utf16` field value, instrument side-chain ports, the #459
refresh), `device_wclap_instrument.wasm` (12 044 → 13 714: the eight input ports),
`device_wclap.wasm` (same size, new bytes), and the seven stock devices that wrap a phase with
`mod_euclid`: `device_cubed` (60 490 → 60 523), `device_nano` (20 449 → 20 912),
`device_neon` (47 710 → 47 759), `device_playfield_sample` (24 947 → 25 234),
`device_soundfont` (20 253 → 20 305), `device_vaporisateur` (53 035 → 53 084) and
`device_tubular` (58 917 → 58 908, the engine selector gone). The 23 other device plugins,
`stretch_wasm.wasm` and `nam.wasm` are byte-identical. `OPENDAW_SDK_VERSION` in the installed
`studio-sdk` reads `"0.0.175"`.

## #459: a parameter write next to a chain re-wire (filed from this repo)

`crates/engine/src/audio_unit/mod.rs` (`0d0b318b9`): the plain-field refresh
(`refresh_unit_params`) ran only when `params_changed && !unit_dirty && !automation_changed`;
an `enabled` toggle (or an effect added, removed or reordered) in the same transaction marks
the unit dirty, the chain reconcile left the survivors' values untouched, and the write
stayed in the box. Now the refresh is skipped only after an automation re-bind (which pushes
on its own): `if params_changed && !automation_changed`. Test
`a_parameter_write_in_the_same_transaction_as_an_enabled_toggle_reaches_the_device`
(`audio_unit/tests.rs`) flips `enabled` and writes a parameter in one transaction, both
directions. Measured on the release with the repro page: see the follow-ups.

## `SyncStream`: every write and read call delivers (`b9abd9212`)

`lib-std` `sync-stream.ts`: `Atomics.compareExchange` returns the OLD state, so the writer
must check `=== State.READ` (it checked `WRITING`) and the reader `=== State.WRITTEN` (it
checked `READING`). Before: the first `tryWrite` swapped READ → WRITING and reported failure
without writing; the second found WRITING, failed the exchange, and wrote. Every second call
on both sides was wasted and the engine state reached the main thread at half the frame rate.
Two tests pin it ("delivers a state on every write and read call when the other side keeps
up"; "does not overwrite a state the reader has not taken yet, nor read the same state
twice"). For this repo: `engine.position` / `isPlaying` / `isRecording` / BPM /
`countInBeatsRemaining` and the DSP-load values move every animation frame now. Nothing
reads them at a cadence that mattered; `RecordMidi`'s extrapolation (below) is upstream's
own answer to the frame-rate position.

## The master analysis without the metronome (#463)

- `crates/engine/src/lib.rs`: a second shared static `ANALYSIS` (`RENDER_QUANTUM * 2` floats,
  planar L|R like `OUTPUT`); `render` copies the summed output bus into it BEFORE adding the
  metronome staging ("summing order is bit-identical: 0 + a + b"); export `analysis_ptr()`.
- `core-wasm/src/processor.ts`: the peak meter, the analyser (spectrum / waveform), stereo,
  gonio and the `LoudnessMeter` read `analysis_ptr` instead of the main output channels;
  `offline-worker.ts` feeds its analyser and peaks from it too. `engine-exports.ts` gains
  `analysis_ptr`. Test "the analysis mix excludes the metronome"
  (`metronome-signature.test.ts`): the output still clicks, the analysis mix is silent.
- For this repo: the loudness harness (`loudness-meter-audit-debug-demo.html`) plays its
  signals on a Tape with the metronome off, so its readings are unchanged (28 of 28 rows at
  both rates, see the follow-ups); a page that meters its own click through the SDK's meter
  would read silence for it now.

## MIDI recording: a note starts where its key went down (PR #473)

- `studio-adapters` `NoteSignal`: `NoteSignalOn` / `NoteSignalOff` carry `timeStamp?: number`;
  `NoteSignal.fromEvent` copies `event.timeStamp` from the MIDI message event.
- `studio-core` `RecordMidi.ts`: `writePositionAt(timeStamp)` extrapolates
  `lastPosition + secondsToPulses(min(timeStamp, now) − lastPositionTime)` at the engine's
  BPM, plus the output-latency term as before, and clamps to `lastPosition` when the
  extrapolation would cross the loop end while takes are allowed (the engine wraps there);
  `lastPositionTime` is stamped on every position update. Key-up writes the note's duration
  immediately (`writeDuration`) and grows the take (`growTake`) in a `modify(…, false)`;
  key-down grows the take too. An audition signal (no stamp) uses `performance.now()`. +12
  tests under "note timing" (a key released between two playhead updates, a tap shorter than
  one, a key held while no update arrives, a key pressed after the loop end before the wrap
  update, a stamp later than now is now, a note held across a loop wrap).
- For this repo: `midi-recording-demo.tsx` records through the SDK's capture, so the change
  applies as is; `src/demos/midi/CLAUDE.md` describes it.

## Whole ticks: lib-std `mod`, Rust `mod_euclid`, the loop cutters (PRs #469, #470)

- `lib-std` `math.ts`: `mod = ((value % range) + range) % range`. The old
  `fract(value / range) * range` rounded through the divided domain; `mod(7200, 6240)` read
  959.9999999999993, so a cut or start-trim of a 3/4-bar loop at bar 2 beat 2 put the right
  half's `loopOffset` off its tick and its notes off their beats, and cutting the right-hand
  piece every four beats accumulated drift. `crates/math` `mod_euclid` is
  `fmod(fmod(n, m) + m, m)` (the old body was a BIT-EXACT mirror of the old TS rounding, kept
  so a value-region loop wrap read its curve on the same side of an event in both engines;
  the parity now rests on the exact form). Tests: `LoopableRegion.test.ts` "globalToLocal
  exact wrap" (every whole tick in ±30 000 for four loop lengths), `num.rs`
  `mod_euclid_mirrors_ts_mod_bit_exactly` (960.0 now), `RegionClipResolver.producer.test.ts`
  (five cut / clip / start-trim cases on 3/4 note and automation loops).
- `NoteRegionBoxAdapter.resetLoopOffset(truncateNotesAtRegionEnd: boolean)` (PR #470): when
  `loopOffset` is not a whole number of loops it consolidates (a mirrored region gets its own
  notes), rotates every event inside `[0, loopDuration)` by `mod(position − phase,
  loopDuration)`, shortens a single-hit note that ran past the loop end to what played when
  the flag is on, and sets `loopOffset` to 0; a whole-loop offset only clears the field and
  keeps the notes shared. Pass the engine preference of the same name. Thirteen tests
  (`NoteRegionResetLoopOffset.test.ts`), one of them an eighth-triplet note landing exactly
  on its tick under a 2-beat phase (the `mod` fix).

## Flatten and content start (PRs #471, #472, #474)

- `flatten(regions, truncateNotesAtRegionEnd = false)` keeps the region it is called on (or
  the first of the flattened ones when it is not among them), writes the range, loop and
  label into THAT box, points `events` at the new collection and deletes the replaced
  collection when the region was its only owner; a mirrored sibling keeps looping on the
  original notes. With the flag on, a note whose `playCount` is 1 is cut at the loop line /
  its own region's end (`regionEnd` from `locateLoops`); a ratchet stays whole. Returns the
  kept `NoteRegionBox`. Tests: `NoteRegionFlattenKeepsRegion.test.ts` (ten) and
  `FlattenNoteRegions.test.ts` (six, one matching the engine's truncate test). The studio's
  "unloop" action is this flatten on one region.
- `moveContentStart(delta)` on `NoteRegionBoxAdapter` and `ValueRegionBoxAdapter`: returns
  on `delta === 0`, calls `consolidate()` first (one mirrored region's drag no longer moved
  the other's events), and iterates a `.slice()` of the events so a listener reading the
  collection during the move cannot make an event move twice. `MoveContentStart.test.ts`
  (twelve).
- `NoteEventBoxAdapter`: `playCurve` typed `bipolar` (was `int`), `CopyToParams.playCurve`,
  `copyTo` copies it (consolidating a play-count note writes plain hits with `playCurve` 0);
  `ProjectApi.duplicateNotes` builds its copies with `copyTo` (it hand-copied five fields and
  lost cent, chance, play count and curve). `NoteCopyKeepsFields.test.ts` (eight).

## Undo and stale instances (`f5811409a`, live 1174)

- `lib-box` `Box.isAttached()`: `findBox(uuid).mapOr(box => box === this, false)`;
  `Field.isAttached()`: `this.box.isAttached()`. Undo restores a deleted box as a NEW instance
  under the same uuid; a holder of the old instance (the studio's `RecordAutomation` kept the
  take's region, collection and last event) passed every uuid-only guard, deleted the live
  region through the shared collection on stop and crashed in `SortedSet.removeByKey`; its
  duration writes to the stale instance reached the engine mirror but not the main graph
  (the "checksum mismatch" before the crash). A stale instance reports detached now, so its
  `delete()` is a no-op and its writes emit nothing. `RecordAutomation.test.ts` "a take
  deleted and restored by undo while recording (1174)".
- `studio-adapters` `ParameterAdapterSet.removeParameter` terminates the adapter it removes:
  it stayed registered in the project's `ParameterFieldAdapters`, where a box created again
  at the same address (undo, redo) found it and wrote to the deleted field.
  `wclap-parameter-recreated-mirror.test.ts` keeps the engine mirror in sync through it.
- For this repo: nothing in `src/` calls `isAttached()`; the guard the automation demos rely
  on is the SDK's own (`ValueEventCollectionBoxAdapter.createEvent` checks
  `existing.box.isAttached()` before reusing a cached adapter, as `src/lib/compLaneUtils.ts`
  and `src/demos/automation/CLAUDE.md` describe), and it now rejects a stale instance too;
  uncommitted boxes are still invisible to it, as before. `layer-delete-soak-debug-demo.tsx`
  defines its own uuid-only check on purpose and is unaffected.

## Box graph mirror: strings byte-exact, checksum cached (`6e7117768`, `c6c03d64a`)

- `crates/boxgraph`: `FieldValue::Utf16(Vec<u16>)` keeps ill-formed UTF-16 (a lone surrogate,
  e.g. a WebCLAP parameter name decoded from malformed UTF-8) verbatim, `read_text` returns
  a `String` for well-formed input and the raw units otherwise, `write_utf16` re-serializes
  them. Before, `from_utf16_lossy` replaced the surrogate with U+FFFD, the mirror's checksum
  diverged from the source graph's and the studio restarted the engine in a loop.
  `core-wasm/src/utf8.ts` `decodeUtf8` rejects overlong forms, CESU-8 surrogates, code points
  past U+10FFFF and truncated tails (each to U+FFFD) so its output is always well-formed
  UTF-16 (tests `utf8.test.ts`, eight; `string-field-checksum.test.ts` runs the wasm engine in
  Node and checks the checksum for lone surrogates in a string field).
- Per-box checksum cache: `BoxGraph.checksum()` folds each box once into a cached 32-byte
  fold plus length and appends the folds (`Checksum::append`, `position`); a set field,
  create or delete evicts the box. ASCII strings (a base64 plugin state) serialize and fold
  through a fast path (`write_ascii_units`, block-wise `write_bytes`), bit-identical to the
  byte-by-byte fold (`checksum_cache.rs`: cached equals full fold through create / edit /
  delete / abort; fold equals a naive reference for 76 strings; an ignored timing test for a
  1.1 MB state). The throttled once-a-second checksum compare the studio runs no longer
  re-folds a megabyte plugin state each time.
- Live rooms (`studio-core` `ysync/`): a bytes field travels as a raw `Uint8Array` view
  (`YMapper.toY` / `fromY`); Yjs refused `Int8Array`, so a changed bytes field broke the room
  sync. An older member's number-list encoding still arrives.

## Engine: side-chain inputs for instruments (`3ae072ef2`)

`crates/engine`: a `SidechainSink` trait (`set_sidechains`) implemented by
`PluginAudioEffect` (as before) and now `PluginInstrument`, whose resolved ports (id 2+) are
swapped into `INPUTS` for the device call; `take_or_build_instrument` builds the binding from
the device's declared `sidechain_paths` (shared `build_sidechain`), `for_each_sidechain` and
the routing pass include the instrument. `crates/abi`: `chunk_start()` (the quantum frame the
current `process_audio` chunk starts at, for reading a `resolve_input` buffer that is in
absolute quantum coordinates) and `wclap_input(handle, index, [left, right])`. The only
instrument declaring inputs is WebCLAP's (below); stock instruments are unchanged.

## WebCLAP

### Boxes, adapters, protocol

- `WclapInstrumentBox` field 15 `audio-inputs`: an array of 8 `Pointers.SideChain` pointers
  (one per plugin audio input port, in port order); `WclapInstrumentBoxAdapter.audioInputs`
  returns the fields. `device-wclap-instrument` binds `[15, i]` as side-chains, feeds ports
  1+ through `wclap_input` and port 0 as the instrument's own input (`WclapLink.
  process_instrument(input, …)`, silence when unfed).
- `WclapStatus` gains `inputs: ReadonlyArray<WclapAudioPort>` (`{name, channels}`, empty
  until ready) and `editor?: boolean` (whether the plugin offers a `clap.webview` window);
  the status is sent on every state (loading / ready / failed / rejected state).
- `EngineCommands.wclapRetry(url)` — loads every failed plugin of that url again (its bundle
  became available: re-import of a deleted bundle); `Engine` / `EngineFacade` /
  `EngineWorklet` / `OfflineEngineRenderer` forward it (the offline side is a no-op).
- `AudioUnitFreeze`: a unit is also unfreezable when another unit's INPUT device (an
  instrument with audio inputs) points at it, not only another unit's effects.

### `studio-core` `wclap/`

- `WclapBundles.isWasm(bytes)` (`\0asm`); a bare `.wasm` module counts as a bundle holding
  only `module.wasm` (no GUI). `FilePickerAcceptTypes.WclapFiles` accepts `.gz` / `.tgz` /
  `.wasm`. `WclapStorage` stores an imported bare module under the same name.
- `WclapParameters.reconcile` runs OUTSIDE the undo history: a bare `beginTransaction` /
  `endTransaction` when none is open (the boxes mirror what the loaded plugin reports; an undo
  deleted them while the plugin stayed loaded and reported them again only on reload). It
  writes `max` before `min` when the new `min` is at or above the current `max`, since each
  bound write rebuilds the adapter's mapping and `ValueMapping.linear` asserted on an
  inverted range (live 1175, switching a device to another plugin). Tests
  `WclapParameters.history.test.ts`, `WclapParameters.range.test.ts`.

### The bridge (`core-wasm/src/wclap/`)

- Audio input ports: `#readInputPorts` reads `clap.audio-ports` (new `ClapAbi.AudioPortInfo`,
  276 bytes: name at 4, channel count at 264); `#createProcess` allocates one `clap_audio_buffer`
  per input port, `audio_inputs_count` is the port count (was 0 or 1); `host_wclap_input`
  copies a fed port into its buffers (a mono port gets the mean of L and R), an unfed port is
  silenced once until fed again.
- `request_callback` is honoured: the host callback sets a flag and `on_main_thread` runs
  between render quanta (after `process`, and after a message from the plugin's page), at
  most once per quantum.
- Memory-growth safety: every `DataView` is taken AFTER the `malloc` / plugin call that may
  grow the memory (parameter info read before `get_value`, host strings allocated before the
  host struct is written, the process block's view retaken after the port allocations, the
  poll loop's view per call); the function table is found under any export name (wasm-ld's
  `__indirect_function_table` or the first exported `WebAssembly.Table`).
- `retry(url)` starts every plugin of that url that has a clap id, is not loaded and not
  loading; `#start` is the shared loader. Tests in `wclap-bridge.test.ts` (reload on retry
  once the bundle is back; a loaded plugin is left alone).

## Lib

- **`lib-dsp` `WavFile.encodeInts24(audio, maxLength?)`** — 24-bit PCM, little-endian two's
  complement (`setUint16` low word + `setInt8` high byte), the shared `encodeInts(…, 2 | 3)`
  behind `encodeInts16`; an odd-sized data chunk is padded to an even byte count and the RIFF
  size says so. `wav-file.test.ts` (header, round trips within one step at 16 and 24 bit,
  exact at float, extremes and padding). No 24-bit DECODER was added; `decodeFloats` already
  read 24-bit PCM.
- **`lib-dom` `Fullscreen`** (new module, exported): `isAvailable(element)`,
  `request(element): Promise<boolean>` (a `RuntimeNotifier.info` on an unavailable or refused
  fullscreen; a `requestFullscreen` replaced by a wrapper that throws synchronously — Safari
  user scripts, live 1181 — counts as a refusal via lib-std `tryCatch` before the await),
  `toggle(element)`.
- **`lib-fusion`**: `StorageWalk.walk(root, progress)` → `{files: {path, size}[], failures:
  string[]}` (a file whose `getFile()` rejects, e.g. one locked by a sync access handle, lands
  in `failures`; progress every 64 files and once at the end), `StorageWalk.totalSize(files)`.
  `OpfsWorker` tracks each path lock's holder (`operation`, `since`, `step`: "get root", "get
  directory 'x'", "get file handle", "create sync access handle", "write" / "read" / "remove
  entry") and warns `[OPFS] <op> '<path>' waits N.Ns for <holder op> held for N.Ns at
  '<step>'` after `LockWarnMillis` 2000; the private method signatures in the `.d.ts` carry
  the `step` procedure. For this repo's `clearStoredSamples` (which deletes
  `SampleStorage.Folder` through the same worker) nothing changes; a hang would now say where.
- **`lib-std` `mod`** (above).

## Scripting and scrollbars (not part of the installed SDK)

- `studio-scripting` `AudioUnitFacade.output` returns `null` for the output unit (it points at
  `RootBox.outputDevice`, not a bus; `asInstanceOf` threw). PR #454.
- `studio-scrollbars` `ScrollModel`: `contentSize` keeps the pixel position when the content
  grows or shrinks (it scaled by the new overflow against the old), `position` rounds instead
  of floors (ten tests).

## Studio-app only (no SDK surface)

Timeline track resizing from the control header (`acc7f2442`, `cded480c1`, `59ef743c4`,
`173b5d7a1`, `2af2fe8d6`, `f302d1d97`, `c54b12414`, `011ddddc5`, `4035d1d85`, `0c9b89326`;
heights in `TrackBox.height`, `MaxTrackHeight` 240, clip lanes follow the track height,
`AutoScroll` with `Config.AutoScrollIgnore`); a Storage page listing everything in this
browser's OPFS, its size and which projects use it, scanned in a worker (`719eeb9e4`, plan
`opfs-storage-page.md`, extension of #453); WebCLAP: windows fit a fixed-size plugin (#447),
plugins without UI and bare `wclap.wasm` (`c4ed4a05d`), recovery of plugins whose bundle was
deleted (`1239a946e`), instruments' audio inputs picked like a side-chain in the device editor
(`SidechainButton`), stored cloud plugins not downloaded again, "Open Bundle File from
Disk…" in the File menu; Opus as an export codec (#458, `AudioFormats.ts`,
`AudioFormatSelector`); a warning before DAWproject export that it is no backup format; #88
(shift-click deselects only on release without a move); boot requires `RTCPeerConnection`
(optional at runtime for Firefox with WebRTC disabled, #456 / live 1169), element fullscreen
(live 1170) and `devicePixelRatio` (live 1182–1184, a privacy setting removes it; a Safari
iCloud file not downloaded shows a notice); floating windows scroll content larger than the
screen and may move partly out of the browser; live error 1168 (a sample dropped onto a clip
of the same sample deleted the shared `AudioFileBox`); the htdemucs spike page removed (it
shipped a second 27 MB ONNX runtime); Imprint / Privacy / Manifesto with a back button; a
manual page on openDAW and AI; deploys upload dists in chunks of at most 16 MB / 150 files
with retries and post to Discord only for PROD; `error-triage.md` rows for 1168–1184; plans
`undo-history.md`, `tauri.md`, `ripple-delete.md`, `track-resizing.md`,
`scripting-output-unit-output.md`; `test-files/all-boxes.od` regenerated for the two new
fields.

## Upstream tests

`lib-dom` `fullscreen.test.ts`; `lib-dsp` `wav-file.test.ts`, `LoopableRegion.test.ts`
(+28); `lib-fusion` `StorageWalk.test.ts`, `OpfsWorker.test.ts` (+30); `lib-std`
`sync-stream.test.ts` (+32); `core-wasm/test/` `utf8.test.ts`, `string-field-checksum.test.ts`,
`wclap-parameter-recreated-mirror.test.ts`, `metronome-signature.test.ts` (+24),
`wclap-bridge.test.ts` (+31); `studio-core` `AssetServiceCatalogUnreachable.test.ts`,
`RecordAutomation.test.ts` (+31), `RecordMidi.test.ts` (+171), `FlattenNoteRegions.test.ts`,
`MoveContentStart.test.ts`, `NoteCopyKeepsFields.test.ts`,
`NoteRegionFlattenKeepsRegion.test.ts`, `NoteRegionResetLoopOffset.test.ts`,
`ui/canvas/painter.test.ts`, `RegionClipResolver.producer.test.ts` (+163),
`WclapBundles.test.ts`, `WclapParameters.history.test.ts`, `WclapParameters.range.test.ts`,
`YSyncCollab.test.ts` (+46); `crates/boxgraph/tests/checksum_cache.rs`, `field.rs` (+27);
`crates/engine` `audio_unit/tests.rs` (+61); `crates/math` `num.rs`; `studio-scrollbars`
`ScrollModel.test.ts`; `studio-scripting` `Units.test.ts`.

Also in `studio-core`: `ui/canvas/painter.ts` (the studio's `CanvasPainter`, PR #475) takes
the size from the `ResizeObserver`'s `contentRect` and reads `clientWidth` / `clientHeight`
only before the first observation, so a canvas that resizes or repaints in a frame no longer
forces a layout each; `MigrateAudioFileBox` and the sample / soundfont services print
`[ProjectLoad] …` debug lines (catalogue requested / received, local list, a migration
waiting for a sample).

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler**: `npm run typecheck` exits 0 before and after the
  bump. Nothing in `src/` implements `EngineCommands` / `EngineToClient` by hand, constructs
  a `WclapStatus`, reads `Tubular.Engines`, calls `flatten` / `moveContentStart` /
  `resetLoopOffset`, or depends on a factory's `defaultName` (the Tape instruments are
  labelled by the demos themselves).
- **#459 closed out** — `param-write-enabled-flip-debug-demo.html` on the release, one real
  click: **FIXED**; step 2 (enabled false→true + release 2.5 in one transaction) tail 2100 ms,
  step 3 (true→false + release 0.5) tail 400 ms, controls 400 / 2050 / 2500 / 500 / 1700 ms,
  every step ok. The page's link bar, the note, `debug/README.md` and the index row say
  fixed; the page is the regression test.
- **Standing sweeps on the release**: sample-rate / quantum-alignment **180 of 180** cells
  pass (`audit-1792426134380.json`, every row's max deviation ≤ 0.08 ms). Loudness meter
  **28 of 28 rows at 48 kHz and at 44.1 kHz** (`loudness-audit-1792428220745.json`,
  `…1792428918750.json`; every judged metric the 0.0.174 value to the hundredth, the meter
  now reading the analysis mix; rows in `debug/2026-10-02-loudness-meter/note.md` under
  "SDK 0.0.175"). Recording
  start-alignment, 48 kHz and 44.1 kHz, 60 rows each, 0 error rows, every repeat finalized:
  **placement is the 0.0.174 placement to the row** (48 kHz netted tally 1.15 ×33, 1.17 ×15,
  1.07 / 1.10 / 1.13 / 1.14 ×3 each; 44.1 kHz +0.97…+1.19 per cell as before); multi-mic 32
  rows, netted +1.146 on every row, netted skew 0.00, node delays read on all, no collision,
  no hang, every repeat finalized both tapes; three forced-churn runs (`&graphChurn=on`, 48
  rows, 190–220 clock stalls each): **every row at 0 / 0 quanta off** the usual placement,
  as on 0.0.174. **One finding, and it is new on this release: 31 of 120 single-tape takes
  (and 2 of 16 two-tape repeats, both tapes equally) end 0.3–6.6 ms BEFORE the stop request.**
  The post-stop capture margin (frames received between the stop request and the limit the
  SDK sets) halved: 29–78 ms on 0.0.174, 14.5–43.5 ms on 0.0.175, while the harness's loopback
  hop stayed at 20–23 ms, and on every such row `tailMissingMs = hop − margin`. This is the
  register's issue candidate 2 ("the stop path truncates input in flight beyond its
  incidental post-stop margin"), un-exercised since the keep-alive builds and exercised again
  now: `RecordAudio` limits the take to the chunks the main thread has RECEIVED when it
  observes the stop, and with `SyncStream` delivering every state the observation comes a frame
  sooner (inferred from the code; the margin shift is what is measured). Filed as
  [openDAW#479](https://github.com/andremichelle/openDAW/issues/479)
  (`debug/2026-09-02-recording-start-alignment/drafts/posted-openDAW-479-stop-drops-input-in-flight.md`);
  rows in the register's "Standing sweep on 0.0.175". The one head deficit (104 ms on the
  first recording after the `node_modules/.vite` wipe) is the known cold-start event.
- **Docs for what changed**: `documentation/10-export.md` and `src/demos/export/CLAUDE.md`
  (`encodeInts24`), `documentation/internals/03-cross-thread-protocols.md` (`wclapRetry`,
  `WclapStatus` inputs / editor, the `SyncStream` check), `documentation/internals/01-engine-processor.md`
  (`analysis_ptr`, the metronome added after the analysis copy), `documentation/14-glossary.md`,
  `src/demos/engine/CLAUDE.md` (the analysis mix), `src/demos/midi/CLAUDE.md` (note placement
  at the MIDI stamp, `resetLoopOffset`, `flatten` keeps its region, `playCurve` bipolar,
  Tubular's kernel), `src/demos/playback/CLAUDE.md` and `src/demos/automation/CLAUDE.md`
  (`moveContentStart` consolidates, `isAttached()` is instance identity).
- **Verification**: `npm run typecheck` 0 errors, 1054 of 1054 vitest tests, `npm run build`,
  `npm ci` on the regenerated lockfile.
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`, diffed
  against the published 0.0.174 sub-packages): `OPENDAW_SDK_VERSION = "0.0.175"`;
  `encodeInts24` in `lib-dsp`; `Fullscreen` exported from `lib-dom`; `StorageWalk` and the
  `OpfsWorker` `step` signatures in `lib-fusion`; `NoteSignalOn.timeStamp`,
  `Tubular.Engines` gone, `WclapInstrumentBoxAdapter.audioInputs`, `InstrumentFactories.Sorted`,
  `WclapAudioPort` / `WclapStatus.inputs` / `editor` / `wclapRetry`, `CopyToParams.playCurve`
  and `playCurve: bipolar`, `resetLoopOffset` and the two-argument `flatten` in
  `studio-adapters`; `TrackBox.height` (field 31), `TubularDeviceBox.engine` `@deprecated`,
  `WclapInstrumentBox.audioInputs` (field 15, `ArrayField<PointerField<Pointers.SideChain>>`)
  in `studio-boxes`; `wclapRetry` on `Engine` / `EngineFacade` / `EngineWorklet`,
  `FilePickerAcceptTypes.WclapFiles`, `WclapBundles.isWasm`, `YMapper.toY` / `fromY` in
  `studio-core`; `analysis_ptr` in `EngineExports`, `ClapAbi.AudioPortInfo`,
  `WclapBridges.retry` in `studio-core-wasm`; `MaxTrackHeight` from `studio-enums`; the ten
  changed and 25 byte-identical wasm binaries (hashed against `studio-core-wasm@0.0.19`).
