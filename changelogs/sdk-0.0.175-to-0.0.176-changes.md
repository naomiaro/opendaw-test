# OpenDAW SDK Changelog: 0.0.175 → 0.0.176

One publish (0.0.176 on 2026-10-20; 17 commits tag-to-tag, 166 files, one day after
0.0.175). Three of the sixteen non-publish commits close issues filed from this repo. What
matters for this repo:

1. **Plug-in delay compensation (#482, filed from this repo)** — devices report their latency
   (Compressor and Maximizer look-ahead, Fold oversampling, Autotune's PSOLA buffer, a WebCLAP
   plug-in through `clap.latency`, a Werkstatt script through `// @latency <ms>` or
   `this.latency` when positive), and every point where signals meet delays its earlier inputs to the latest
   one: a bus or the master, an aux send into a return, a composite sum, an effects stack's dry
   path, a device's sidechain inputs. The metronome, take placement (`RecordAudio`,
   `RecordMidi`), MIDI out, mixdowns and stems follow the total latency; automation and
   modulation behind a latent device read where that audio was rendered. Measured on the
   release: `plugin-delay-compensation-debug-demo.html` reads **lag 0 frames on every row**
   (Compressor and Maximizer, look-ahead on; was +240 frames / 5.00 ms), peak 0.500 and
   correlation 1.000 unchanged. The page is the regression test from here on. New surface:
   `engine.compensationLatency` (seconds, observable), `engine.querySignalGraph()`,
   `EngineState.compensationLatency`, `EngineExports.compensation_latency` /
   `compensation_pending` / `signal_graph_report`, `settleCompensation` / `readSignalGraph`.
   A compensation delay is capped at 0.1 s per stage; a change crossfades over 10 ms.
2. **Stopping a recording keeps the input still in flight (#479, filed from this repo)** —
   the engine state carries `recordingStopTime` (the context time of the first frame the
   stop excludes, set with `isRecording` falling), `RecordAudio` limits the take to that time
   netted like the start (`+ outputLatency + inputLatency`, plus the compensation latency),
   keeps the source connected until the tail has arrived, and trims the take to what did
   arrive if the tail is still incomplete after the shortfall plus one second. New surface: `engine.recordingStop:
   Option<{contextTime}>`, `EngineState.recordingStopTime` (double, NaN while recording or
   never stopped). Sweep readings on the release are below.
3. **A pointer write through a box instance that undo replaced no longer reaches the live
   graph (#480, filed from this repo)** — `BoxGraph.onPointerAddressUpdated` skips a pointer
   whose box is detached (outside box construction), like `onPrimitiveValueUpdate` has since
   0.0.175. No ghost edge, no update for the live address, the sync mirror and the engine stay
   in checksum, a mandatory-edge target is released by its last real user as before. The five
   "flips when fixed" tests in `src/lib/staleBoxPointerWrite.test.ts` failed on the release,
   which is the signal the test file documents; they are inverted in this upgrade.
4. **Werkstatt and Apparat scripts declare named sidechains** (`// @sidechain <name>`,
   #211) — each declaration is a `WerkstattSidechainBox` (new box: `owner` →
   `Pointers.ScriptSideChain`, `label`, `index`, `source` → `Pointers.SideChain`) under the
   device's new `side-chains` field 13; the engine turns each into a sidechain port (id 2 +
   bound count + index) and the script reads `this.sidechains[name]` as `[left, right]`
   (silence while unconnected). `ScriptDeclaration.parseSidechains`,
   `ScriptCompiler.reconcileSidechainBoxes`, `AudioUnitFreeze.hasSidechainDependents` sees
   them (freezing a tapped unit is refused). **A failing script now renders silence** — the
   bridge used to leave the output untouched on an error, so the last quantum looped; a thrown
   `process()` keeps the device muted until the next compile, a script not yet loaded mutes
   each block until it is.
5. **A Werkstatt script receives its `@sample` files as `this.samples`** (#353), like Apparat
   — the device's `observe_sample_collection_field` (12) and `sample_changed` are wired, the
   bridge re-resolves the slots every block for both kinds. The repo's docs said the data was
   not routed to the processor; updated.
6. **Monitoring with effects on a forced-mono input mixes both channels down** (#461) —
   `CaptureAudio` registers a unity `speakers` mixdown at the chain's channel count as the
   monitoring source instead of the raw source node (the engine splits its monitoring input
   discretely, so a stereo source reached a mono chain as channel 0 only).
7. **A script device registers each script version once per audio context**
   (`ScriptCompiler`) — a compile cost two `addModule` calls, opening the editor or
   switching screens one per device; now a `WeakMap<BaseAudioContext, WeakMap<box, update>>`
   claims the version before the compile writes the code and releases it if `addModule`
   fails. Undo, redo and a new context still register. The Werkstatt demo's
   `compiler.compile(audioContext, editing, box, script)` calls are unchanged.
8. **Mixdown and stems export render a chosen section** (#434) — `MixdownSection.collect
   (project)` lists the entire song, the loop area (once, and in two passes with the second
   kept), and every marker section; `OfflineEngineRenderer.renderSection(source, optConfig,
   section, progress, abortSignal?, sampleRate?)` renders it (the loop and marker track states
   are set for the render and restored after). The studio dialog is app code; the core API is
   installed.
9. **Launching a clip while paused restarts from the last start position** (#414) — the
   processor's `scheduleClipPlay` sets the position to the playback timestamp when the
   transport is not running and timestamp playback is enabled, like pressing play.

Sub-package versions (installed): `studio-adapters` 0.3.8 (was 0.3.7), `studio-core` 0.2.10
(0.2.9), `studio-core-wasm` 0.0.21 (0.0.20), `studio-boxes` 0.0.114 (0.0.113),
`studio-enums` 0.1.7 (0.1.6), `lib-box` 0.0.98 (0.0.97), `lib-fusion` 0.0.107 (0.0.106,
version bump only: its `dist` is byte-identical). Unchanged: `lib-dsp` 0.0.96, `lib-std`
0.0.87, `lib-dom` 0.0.92, `lib-jsx` 0.0.94, `lib-midi` 0.0.77, `lib-dawproject` 0.0.81,
`lib-runtime` 0.0.88, `lib-xml` 0.0.73, `nam-wasm` 1.2.0. Licences unchanged
(AGPL-3.0-or-later; `nam-wasm` MIT). The Publish commit touches `package.json` files only.
WASM: **34 binaries under `studio-core-wasm`, 9 changed** — `engine.wasm` (1 109 891 →
1 177 823 bytes: the compensation pass, the playhead history and lagged update clock, the
signal graph report, the sidechain ports, the stop stamp is TS-side), `device_compressor`
(13 859 → 13 899), `device_maximizer` (11 775 → 11 818), `device_fold` (8 690 → 8 773),
`device_autotune` (23 114 → 23 142) and `device_apparat` (10 004 → 10 047), `device_werkstatt`
(2 406 → 2 638: `sample_changed`, latency, sidechains), `device_wclap` (4 603 → 4 687) and
`device_wclap_instrument` (13 714 → 13 804: `host_wclap_latency`). The 24 other device
plugins and `stretch_wasm.wasm` are byte-identical; `nam.wasm` ships with the unchanged
`nam-wasm`. `OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.176"`.

## #482: plug-in delay compensation (`df8c72f90`, `1bfbdcb50`, `54ac2db89`, `49699d3a7`)

The design (upstream `plans/delay-compensation.md`): every node reports its own latency, the
engine walks the processor graph and computes the latency at which each signal arrives
(`arrival(n) = own(n) + max(arrival(p))` over the data predecessors), and at every junction
the earlier inputs are delayed to the latest one. The junctions own the delay lines — no new
graph nodes, no rewiring. A project without latent devices computes zero everywhere, holds
no delay line and renders bit-identical (test "settling leaves a project without latency
bit-identical").

- **Reporting.** ABI import `host_set_latency(frames)`, callable from `init`,
  `parameter_changed` or `process`; the engine keeps a `Cell<u32>` per device binding
  (`LATENCIES`, keyed by state block) and marks `LATENCY_CHANGED`. `Processor::latency()`
  defaults to 0. Measured by upstream (impulse onset and cross-correlation, 48 kHz):
  Compressor and Maximizer look-ahead 240 frames when on, 0 when off; Fold oversampling
  15 / 23 / 26 frames for 2× / 4× / 8×; Autotune 1280 frames (`2 * MAX_PERIOD`; the envelope
  lags about half a pitch period less, pitch-dependent, not compensable); zero for Convolver,
  Crusher, Dattorro, Delay, Gate, Revamp, Reverb, Stereo Tool, Tidal, Waveshaper. WebCLAP: the
  bridge reads the `clap.latency` extension after `activate` and on the plug-in's
  `latency.changed` callback, and honours `request_restart` (deactivate, activate, read
  latency, start processing) — `plugin.restartRequested`. A Werkstatt script: `// @latency
  <ms>` (`ScriptDeclaration.parseLatency`, a malformed or negative value fails the compile)
  or `this.latency = frames` at runtime (the bridge's `host_script_latency`).
- **Junctions** (`crates/engine-env/src/compensation.rs`): `CompensationDelay` (a stereo ring
  sized outside render, `process` never allocates), `CompensatedInput` (a delayed copy a
  device reads through a fixed pointer, used for the metronome and the stems). `EngineContext
  ::compensate(limits)` runs outside render when a latency changed or the graph was re-wired;
  `arrival_of(node)` gives the output latency. A node reading sidechains
  (`aligns_inputs`) aligns its main input and every sidechain to the latest of them — a late
  sidechain delays the consumer's main input and the paths downstream compensate; a sidechain
  from downstream (feedback) stays unaligned. Limits: `MAX_COMPENSATION_SECONDS` 0.1 (a path
  that needs more stays unaligned and is reported), `COMPENSATION_CROSSFADE_SECONDS` 0.01 (a
  delay change crossfades the old and new read taps).
- **Timeline alignment.** The metronome is delayed by `arrival(master)` (`metronome_delay`),
  so the click matches the heard music; `RecordAudio` and `RecordMidi` add
  `engine.compensationLatency` to the take offset (the player heard the mix that late);
  MIDI out follows the total latency; the offline worker **settles** before a render
  (`settleCompensation`: idle quanta until every device reported — a script or hosted plug-in
  reports on its first process — and no pass is pending, then reset to the requested
  position) and trims `compensation_latency()` frames from the start, for `render`,
  `step` and the stems, each stem aligned to the master; a frozen unit's buffer is trimmed by
  its own chain latency and reports 0.
- **Automation and modulation behind a latent device** (`1bfbdcb50`, `54ac2db89`): the engine
  records the playhead of the last 0.1 s per block (`playhead_history.rs`) and every
  modulator's value per quantum; a processor whose input is `lag` frames late resolves its
  parameters, channel strip, aux sends, dry/wet and sinks through `resolve_lagged` —
  exact across tempo changes, loop jumps and locates — and walks a lagged update clock
  (`update_clock.rs`): its ticks sit where the position its audio was rendered at crosses
  the grid, so an automation step lands on the same sample of the audio as without latency,
  also under tempo automation. Solo and MIDI-out CC automation stay unshifted.
- **Surface.** `Engine.compensationLatency: ObservableValue<number>` (seconds the heard
  output lags the timeline), `Engine.querySignalGraph(): Promise<SignalGraph>` (`nodes` with
  `id`, `label`, `owner` uuid, `latency`, `arrival`; `edges` with `data` false for an
  ordering-only sidechain edge and `delay`; `sampleRate`, `maxCompensation`), on
  `EngineFacade` and `EngineWorklet` (the offline worker answers an empty graph).
  `EngineState.compensationLatency: Schema.float`. `EngineWorklet` adds it to the output
  latency its `MIDIReceiver` times engine MIDI out by. The studio shows the total as "PDC" in its footer and draws the
  graph on a debug Signal Graph page (app code).
- **For this repo.** The effects demos that enable look-ahead (`useDynamicEffect` sets
  `lookahead` on the Compressor and Maximizer) now play aligned with the other tracks; the
  `plugin-delay-compensation-debug-demo.html` rows read 0 (above). Nothing here reads the
  state schema by offset, so the two new fields cost nothing; `scripts/` and the audit
  harnesses read `recordingStart` through the facade. Open upstream per the plan: monitoring
  through compensation (phase 7, opt-in later), the playhead (subtracts no latency), and a
  WebCLAP bundle with `clap.latency` untested against a real plug-in.

## #479: the take ends at the engine's stop plus the input latency (`8280789a4`)

- `core-wasm/src/processor.ts`: `#recordingStopTime` is set to the end of the last rendered
  quantum when `isRecording` falls in render (`#announceRecordingEdges`, which also fires
  `recordingStarted` as before) or when a `stopRecording` / `stop` command runs between
  renders (`#closeRecordingEdge`; "the last rendered quantum's end is the first frame the
  stop excludes"); `prepareRecordingState` resets it to NaN. `RecordingStartEdge` exposes
  `wasRecording`. The offline worker writes NaN.
- `EngineStateSchema`: `recordingStopTime: Schema.double` after `isRecording`.
  `EngineWorklet` turns it into `recordingStop: Option<RecordingStop>` (`Option.None` while
  NaN), `EngineFacade.recordingStop` reads through to the worklet. `Engine` interface gains
  `get recordingStop(): Option<RecordingStop>`; `RecordingStop = {contextTime}`.
- `RecordAudio`: the terminator computes `stopFrames(deliveredFrames)` — while the engine
  still records (the take ended for another reason) the delivered frames; otherwise
  `round((stop.contextTime − firstQuantumTime + outputLatency + inputLatency) · sampleRate)`,
  with the latency pair the placement used (`placementLatency`, the start pair until the
  first take is placed). The source stays connected (the disconnect moved to `onSaved` and
  the abort path), `limit(numberOfFrames)` is set at the netted count, `endInSeconds` at
  its seconds, and when fewer frames have arrived a timeout of the shortfall plus
  `TAIL_WAIT_SECONDS` (1 s) resizes the take and the file to the arrived frames and re-limits
  if the tail never came (`[RecordAudio] input tail never arrived` warning). Tests: "keeps the
  input still in flight when the engine stopped", "cuts a take the ring delivered past the
  stop at the stop", "ends the take at the delivered frames once the input tail never
  arrives", "does not wait for the tail once it arrived", "ignores an earlier recording's
  stop when the take ends while the engine still records".
- For this repo: the alignment harness's `tailMissingMs` (stop request context time minus
  the end of the saved buffer) should read ≤ 0 on every row now, and the post-stop margin
  (`finalizeNumberOfFramesAtLimit − finalizeNumberOfFramesAtStop`) becomes the netted
  input delay rather than "whatever had crossed". The sweep readings are in the follow-ups.

## #480: the pointer path guards detachment (`8ac680cc2`)

`lib-box/src/graph.ts` `onPointerAddressUpdated`: after the transaction assert,
`if (!this.#constructingBox && !pointerField.isAttached()) {return}` — the same guard
`onPrimitiveValueUpdate` gained with the instance-identity `isAttached()` in 0.0.175. A stale
field's `refer()` still stores its own value on the detached instance (as a scalar write
does) but connects no edge and emits no update. Upstream tests in `editing.test.ts`: "undo
restores a new instance and the old one reports detached", "leaves no ghost edge on the
target", "emits no update, so a synced copy cannot diverge", "the ghost does not keep a
mandatory target alive once its real user is gone", "a live edge survives a stale write
elsewhere and both targets stay deletable". The repo's `staleBoxPointerWrite.test.ts` covers
the same five effects against the installed `lib-box`, the SDK's sync mirror and the
installed `engine.wasm`; inverted in this upgrade (see follow-ups). The rule in CLAUDE.md
stays: re-resolve a box held across an undo with `boxGraph.findBox(uuid)` — the write is
now dropped instead of misrouted, which is still a lost write.

## Script devices: sidechains, samples, one registration (`f6192f2b8`, `b33ba14a2`, `417429357`)

- **Boxes** (`forge-boxes` → `studio-boxes`): `WerkstattSidechainBox` (fields 1 `owner`
  pointer `ScriptSideChain` mandatory, 2 `label`, 3 `index`, 4 `source` pointer `SideChain`
  optional); `WerkstattDeviceBox` and `ApparatDeviceBox` field 13 `side-chains`
  (`accepts: [Pointers.ScriptSideChain]`); `Pointers.ScriptSideChain` in `studio-enums`;
  `BoxIO` / `BoxVisitor` list the new box; `test-files/all-boxes.od` regenerated.
- **Adapters**: `ScriptDeclaration.parseSidechains(code)` (`// @sidechain <name>`, one token,
  duplicates fold to one, `__proto__` rejected — `checkName` also guards `@param` and
  `@sample` labels now), `parseGroups` yields `{type: "sidechain"}` items,
  `ScriptCompiler.reconcileSidechainBoxes(hub, declared)` keeps a box per label (a reordered
  line keeps its source, a removed one deletes its box), `compile` runs it for a box with
  `sideChains`; `WerkstattDeviceBoxAdapter.sideChains` / `ApparatDeviceBoxAdapter.sideChains`.
  The compiled registry entry carries `sidechains`, `readsSidechains` (the code mentions
  `this.sidechains`) and `latency`.
- **Bridge** (`core-wasm/src/script-bridge.ts`): `#deliverSidechains` resolves port
  `2 + index` through `host_resolve_input` inside the device's `process` (silence buffers for
  an unconnected one); `proc.sidechains` is a `Proxy` that throws a named error for an
  undeclared name ("No @sidechain 'x' declared (declared: …)"), and a `TypeError` in a script
  that reads `this.sidechains` without a declaration gets the hint appended. **Every failure
  path now mutes the output** (`mute()`), where before a missing bridge or a thrown
  `process` left the previous quantum in the buffer. `device_set_sidechain_collection_field`
  / `observe_sidechain_collection_field` in the linker.
- **Samples for Werkstatt**: `device_werkstatt` exports `observe_sample_collection_field`
  (12) and `sample_changed(state, id, handle, present)`; the bridge's per-block sample
  re-resolution runs for every kind but MIDI effects (was instruments only). Test
  "reads a loaded sample identically to a direct (TS) invocation".
- **Freeze**: `AudioUnitFreeze.hasSidechainDependents` walks the `WerkstattSidechainBox`
  edges into a unit's devices too (tests for a Werkstatt tap, an Apparat tap on a channel
  strip, and the Compressor sidechain as before).
- **Registration** (`417429357`): `claimRegistration` / `registerClaimed` in `ScriptCompiler`;
  tests "loading the same version again registers nothing", "concurrent loads of the same
  version register once", "a compile registers once, even when another editor reloads on the
  code change", "a different version (undo, recompile) registers again", "another audio
  context registers its own copy", "a failed registration is retried by the next load".
- The studio adds Sidechain Ducker / Sidechain Mixer (Werkstatt) and Sidechain Gate
  (Apparat) examples and a sidechain cell per declaration in the device editor (app code).

## Capture: monitoring mixdown (#461, `84a6aead3`)

`CaptureAudio.#audioChain` gains `monitorMixdown` (a `GainNode` at 1.0, `channelCount` =
the chain's count, `channelCountMode: "explicit"`, `channelInterpretation: "speakers"`), fed
by the source node; `registerMonitoringSource` receives it instead of `sourceNode` in
`"effects"` mode, and `#destroyAudioChain` disconnects it. `"direct"` mode is unchanged.
Tests: "registers a speakers mixdown, not the raw source, when mono is forced", "registers a
stereo mixdown at unity gain for a stereo capture".

## Mixdown sections (#434, `42232752f`)

`studio-core` `MixdownSection` (`type: "song" | "loop" | "marker"`, `key`, `label`, `start`,
`end` ppqn, `passes: 1 | 2`, `tail`): `collect(project)` — "Entire song" `[0,
lastRegionAction()]` with tail, "Loop Area" and "Loop Area (two passes)" when `loopArea.to >
from` (offered while the loop is disabled too), one entry per marker to the next marker
(the last to the song end, with tail; zero-length and past-end sections skipped; an unlabelled
marker is "Marker N"); `find(sections, key)` falls back to the first.
`OfflineEngineRenderer.renderSection`: for a `tail` section `render({maxDurationSeconds:
seconds + 30}, start, end, …)`, otherwise `#renderFrames(start, numFrames, passes, …)` —
`step`s of 375 quanta, the first `(passes − 1) · numFrames` discarded, so a two-pass loop
keeps the second pass with the first's tail in it. The loop area is enabled and set to the
section for a two-pass render, the marker track disabled for every render, both restored
after (`beginTransaction` / `endTransaction`, not `editing.modify`, so no undo entry).

## Clips (`d348d1d6f`)

`processor.ts` `scheduleClipPlay`: `if (!this.#isTransporting() && timestampEnabled)
engine.set_position(this.#playbackTimestamp)` before scheduling; `#isTransporting()` reads
the engine state's `isPlaying` byte or the local flag (the `stop` path uses it too). The
studio's clip button launches the clip that was playing before the pause again instead of
scheduling a stop (app code).

## Studio-app only (no SDK surface)

Marker drag keeps the grab offset (`MarkerTrackBody.tsx`); the Format dropdown text is
centred; the Mixdown dialog's section selector (`MixdownSectionSelector`); the Signal Graph
page and the PDC footer read-out; the code editor footer reports runtime errors after a
compile ("Successfully compiled, but …") and clears the device's error icon on a code
change; Werkstatt / Apparat starter prompts and manual pages (`@sidechain`, `@latency`,
`this.samples`, `this.latency`); `plans/capture.md` (a plan for a capture pipeline with IO
behind ports, `studio-io`, and one audio-frame clock — a plan, nothing shipped) and
`plans/issues/434-mixdown-sections.md`, `plans/issues/211-werkstatt-sidechain-input.md`.

## Upstream tests

`lib-box` `editing.test.ts` (+80, the five #480 tests); `studio-adapters`
`ScriptCompiler.test.ts` (+110), `ScriptDeclaration.test.ts` (+81: sidechains, reserved
names, `@latency`); `core-wasm/test/` `delay-compensation.test.ts` (12 cases: master, bus,
aux return, effects-stack dry path, look-ahead switched off at runtime, a late sidechain, the
stems, a Werkstatt `this.latency` and `// @latency`, settling before an offline render, a
project without latency bit-identical), `device-latency.test.ts` (191: Compressor, Maximizer,
Fold per factor, Autotune), `automation-compensation.test.ts` (channel strip mute, device
parameter, aux send gain, modulator), `automation-compensation-tempo.test.ts` (167),
`signal-graph.test.ts`, `script-sidechain.test.ts` (12 cases), `script-error-silence.test.ts`,
`werkstatt-sample-parity.test.ts`, `recording-start-edge.test.ts` (+13),
`helpers/compensation-harness.ts`; `studio-core` `RecordAudio.test.ts` (+102, the five #479
cases), `CaptureAudio.test.ts` (+36), `AudioUnitFreeze.test.ts`, `MixdownSection.test.ts`
(seven cases); `crates/engine` `audio_unit/tests.rs` (+12), `crates/engine-env/tests/`
`audio_sink.rs`, `aux_send.rs`, `channel_strip.rs`, `composite_mix.rs` (the update-clock
hook).

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler**: `npm run typecheck` exits 0 before and after the
  bump. Nothing in `src/` implements `Engine` / `EngineCommands` by hand (the audit harness
  reads `recordingStart` through the facade), builds an `EngineState` by offset, or calls
  `ScriptCompiler` other than through `create` / `compile`.
- **#480 closed out** — the five "flips when fixed" tests failed on the release exactly as
  the file said they would (no ghost edge: `incomingEdgesOf` 1, `pointerHub.size()` 1,
  `updates` empty; the mandatory-edge control throws again after the stale write; the sync
  mirror's checksum request resolves; the engine's checksum equals the source's). Inverted
  into regression tests asserting the fixed behaviour, plus two that pin the editing side (a
  stale write leaves the undo and redo stacks alone; a stale refer-then-defer emits nothing on
  the disconnect path either). Proven against the installed `lib-box` with the guard line
  disabled: 7 of the 8 tests fail, only the scalar control passes. The note, `debug/README.md`
  and the memory say fixed.
- **#482 closed out** — `plugin-delay-compensation-debug-demo.html` on the release, one
  click: every row `onset 12000 (250.00 ms), peak 0.500, lag 0 frames (0.00 ms), score
  1.000` (the two look-ahead-on rows read `lag 240 frames (5.00 ms)` on 0.0.175). The
  page's expected column and link bar, the note and the index row say fixed; the page is the
  regression test.
- **#479 closed out** — recording start-alignment on the release, 48 kHz and 44.1 kHz, 60 rows
  each, 0 error rows, every repeat finalized: **no tail deficit on any row at 48 kHz (0.0.175:
  15 rows at 0.29–5.63 ms) and two rows at 0.02 / 0.04 ms at 44.1 kHz (0.0.175: 16 rows at
  0.80–6.64 ms)** — one to two frames of rounding between the stop request and the engine's
  quantum-end stamp, nowhere near the 2 ms tolerance. The post-stop capture margin reads
  16.0–37.3 ms / 20.3–40.6 ms and is now the netted input delay plus the stop's lead, not the
  chunks that happened to have crossed. **Placement is the 0.0.175 placement to the row**
  (48 kHz netted tally 1.15 ×33, 1.17 ×15, 1.07 / 1.10 / 1.13 / 1.14 ×3 each; 44.1 kHz
  +0.97…+1.19 per cell as before); multi-mic 32 rows, netted +1.146 on every row, netted skew
  0.00, raw skew 0 quanta on 16 of 16 repeats, no tail deficit (0.0.175: 4 rows), both cells
  `aligned`; three forced-churn runs (`&graphChurn=on`, 48 rows, 193–203 clock stalls each,
  58 000–76 000 connect / disconnect pairs per repeat): **every row at 0 / 0 quanta** off the
  usual placement, no tail deficit (0.0.175: 2 / 4 / 2 rows); one-quantum tally **0 in 76**
  (0.0.175: 0 in 76). The one cell not `aligned`: `nominal-start/120` repeat 1 at 48 kHz, a
  3523.7 ms HEAD deficit on the very first recording after the fresh `npm install` and dev
  server (the cold-start event every sweep since 0.0.173 has recorded at that place, 79–104 ms
  before, an order of magnitude longer on a server pre-bundling every dependency; the 44.1 kHz
  run on the same server has none). Rows in the register's "Standing sweep on 0.0.176"; the
  register's issue candidate 2 is closed, the index row, `src/demos/recording/CLAUDE.md` and
  CLAUDE.md read the stop as netted.
- **Docs for what changed**: `documentation/17-modular-devices.md` and
  `documentation/11-effects.md` (Werkstatt `this.samples` is wired, `@sidechain`,
  `@latency`, `this.latency`, a failing script renders silence),
  `documentation/internals/03-cross-thread-protocols.md` (the two state fields,
  `recordingStop`, `compensationLatency`, `querySignalGraph`),
  `documentation/10-export.md` (`renderSection` / `MixdownSection`, the compensation settle
  and trim), `documentation/08-recording.md` (the take's end), `src/demos/effects/CLAUDE.md`,
  `src/demos/recording/CLAUDE.md` (reading a tail cell on a release that nets the stop),
  `src/demos/export/CLAUDE.md`, `src/demos/engine/CLAUDE.md` (compensation), CLAUDE.md.
- **Standing sweeps on the release, beyond the recording one**: sample-rate /
  quantum-alignment **180 of 180** cells pass (`audit-1792516369791.json`; every family's
  maximum deviation the 0.0.175 value to the hundredth of a millisecond — metronome 0.08,
  loop-wrap 0.54, seam 0.20, region-fencepost 0.03, note-onsets 0.48, automation 0.94,
  tempo-ramp 2.67, signature 0.07, transport-pos 0.07 ms). Loudness meter **28 of 28 rows at
  48 kHz and at 44.1 kHz** (`loudness-audit-1792515622408.json`, `…1792516320522.json`; every
  judged metric the 0.0.175 value to the hundredth; rows in
  `debug/2026-10-02-loudness-meter/note.md` under "SDK 0.0.176"). The #459 page
  (`param-write-enabled-flip-debug-demo.html`) still reads **FIXED** (step 2 tail 2100 ms,
  step 3 400 ms, every step ok).
- **Verification**: `npm run typecheck` 0 errors, 1073 of 1073 vitest tests (the five inverted
  #480 tests and two added ones included), `npm run build`, `npm ci` on the regenerated lockfile.
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`, diffed
  against the installed 0.0.175 sub-packages): `OPENDAW_SDK_VERSION = "0.0.176"`; the
  `isAttached` guard line in `lib-box/dist/graph.js`; `recordingStopTime` and
  `compensationLatency` in `EngineStateSchema`, `SignalGraph` / `SignalGraphNode` /
  `SignalGraphEdge` and `querySignalGraph` in `protocols.d.ts`, `parseSidechains`,
  `parseLatency`, `reconcileSidechainBoxes`, `sideChains` on both script adapters in
  `studio-adapters`; `WerkstattSidechainBox`, field 13 on `WerkstattDeviceBox` /
  `ApparatDeviceBox` in `studio-boxes`; `Pointers.ScriptSideChain` in `studio-enums`;
  `recordingStop`, `compensationLatency`, `querySignalGraph` on `Engine` / `EngineFacade` /
  `EngineWorklet`, `MixdownSection`, `renderSection`, `hasSidechainDependents`,
  `monitorMixdown`, `TAIL_WAIT_SECONDS` in `studio-core`; `settleCompensation`,
  `readSignalGraph`, `compensation_latency`, `compensation_pending`, `signal_graph_report`,
  `host_set_latency`, `host_script_latency`, `host_wclap_latency`, `clap.latency`,
  `restartRequested`, `wasRecording` in `studio-core-wasm`; the nine changed and 25
  byte-identical wasm binaries (hashed against `studio-core-wasm@0.0.20`).
