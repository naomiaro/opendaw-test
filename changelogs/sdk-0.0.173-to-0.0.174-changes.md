# OpenDAW SDK Changelog: 0.0.173 → 0.0.174

One publish (0.0.174 on 2026-10-09; 73 commits tag-to-tag). What matters for this repo:

1. **The loudness meter is the standard's (#426, #427, #428 — filed from this repo; the EBU
   test suite from PR #430 imported)** — BS.1770 pre-filter coefficients bilinear-transformed at
   the running rate in place of the RBJ stages, an Annex 2 4× true-peak interpolator per
   channel in place of the sample peak, and a `reset()` that runs when the loudness address
   gains its first subscriber. Measured on the release: the harness's 28 rows pass at both
   rates (was 16 of 28); see the follow-ups.
2. **A live-stream packet written while nobody subscribed is skipped (#429, filed from this
   repo)** — `LiveStreamReceiver` no longer hands a subscriber an array the processor never
   filled.
3. **The SDK's two start-of-take stamps no longer trust Chrome's stale worklet clock (#424,
   filed from this repo)** — a new `QuantumClock` in `lib-dsp` keeps each processor's frame on
   a 128-frame lattice anchored at the largest `currentFrame − calls·128` seen; the engine
   stamps the recording start from it, and the recording worklet holds its first-quantum
   report back 16 calls so a true read repairs a stale first stamp. The browser defect
   (Chromium 442866743) is NOT fixed — this is openDAW's workaround, and it changes nothing
   where the clock is true (Firefox, Safari).
4. **The capture's audio chain lifecycle (PR #418, from this repo)** — an armed capture's
   source node stays pulled through a zero-gain sink, a capture naming no device reuses its
   stream across recordings, `terminate()` tears the chain down and releases the microphone,
   and a stream exists only while the capture is armed and alive. Nothing else from #380 and
   nothing from #378 is in this release.
5. **WebCLAP** — CLAP plugins compiled to WebAssembly (`.wclap.tar.gz` bundles) hosted as an
   instrument or an audio effect: three new boxes, two adapters, `InstrumentFactories.Wclap`
   / `EffectFactories.Wclap`, fifteen new engine-protocol members, a `wclap/` namespace in
   `studio-core` (bundle fetch, OPFS storage, parameter reconcile, state, GUI relay), and a
   ~1000-line JS bridge in `core-wasm` that runs each plugin as its own wasm32 instance beside
   the engine. No demo here uses it yet.

Plus: automation recording writes a hold-then-step after a pause over 100 ms instead of a
ramp (#443); a recording whose save is rejected stays playable instead of crashing (live
errors 1166 / 1167); `ProjectApi.duplicateRegion` rounds a fractional `complete` up (1164);
clipboard paste floors the playhead once (1165) and a pasted modulator depth lane is
re-indexed (1155 / 1156); a failed undo / redo step is logged before its rollback (1159,
watched); `EngineHost` (lib-inference) recovers from a crashed worker (PR #406); the Waveshaper
scripting API accepts only the six equation names.

Sub-package versions (installed): `studio-adapters` 0.3.6 (was 0.3.5), `studio-core` 0.2.8
(was 0.2.7), `studio-core-wasm` 0.0.19 (was 0.0.18), `studio-boxes` 0.0.112 (was 0.0.111),
`studio-enums` 0.1.5 (was 0.1.4), `lib-box` 0.0.96 (was 0.0.95), `lib-dsp` 0.0.95 (was
0.0.94), `lib-fusion` 0.0.105 (was 0.0.104), `lib-midi` 0.0.76 (was 0.0.75), `lib-dawproject`
0.0.80 (was 0.0.79); `lib-std` 0.0.86, `lib-dom` 0.0.91, `lib-jsx` 0.0.93, `lib-runtime` 0.0.87,
`lib-xml` 0.0.72 and `nam-wasm` 1.2.0 unchanged. Licences unchanged (AGPL-3.0-or-later;
`nam-wasm` MIT). The only sub-package CHANGELOG with content is `studio-core`'s (the four
`capture:` commits of PR #418); every other one is "Version bump only". WASM: **35 binaries
(was 33), 1 changed and 2 new** — `engine.wasm` (1 089 283 → 1 089 924 bytes; `crates/engine`
has no source change, the engine links the box registry which gained the three WebCLAP boxes)
and the new `device_wclap.wasm` (4.6 KB) and `device_wclap_instrument.wasm` (12 KB); all 30
other device plugins, `stretch_wasm.wasm` and `nam.wasm` are byte-identical.
`OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.174"`.

## Loudness meter: BS.1770 filters, true peak, reset (#426, #427, #428)

All in `studio-core-wasm` `src/analysis-dsp.ts` (upstream `4406971f8`; the EBU suite imported
in `6779433de`). The meter still runs only in the live processor; the offline worker has none.

- **#426 — the pre-filter is the standard's**: `LoudnessMeter.#setPreFilter` bilinear-transforms
  BS.1770-4's two prototypes at the running rate (shelf `fc` 1681.97 Hz, `Q` 0.7071752, gain
  3.99984 dB with the lower-shelf exponent 0.49967; high-pass `fc` 38.1355 Hz, `Q` 0.5003270)
  and writes them with `setNormalizedCoefficients`, keeping the high-pass numerator
  `(a0, −2·a0, a0)` UN-normalised — the +0.04 dB the RBJ high-pass dropped. Before, the
  constructor fed those prototype parameters to lib-dsp's RBJ `setHighShelfParams` /
  `setHighpassParams`, which is the 0.26 dB-at-1 kHz / 0.49 dB-at-1.5 kHz profile the
  harness measured. At 48 kHz the result is the printed Table 1 / 2 filter (the suite asserts
  +0.691 dB at 997 Hz against it).
- **#427 — true peak**: a `TruePeak` stage per channel, the Annex 2 4× interpolator (12 taps ×
  4 phases, the printed coefficients, `Float64Array`), fed per sample; `process` takes
  `max(truePeakL, truePeakR)` instead of `max(|l|, |r|)`. The fifth stream value is dBTP now.
- **#428 — `LoudnessMeter.reset()`**: clears the four biquads, both interpolators, the 100 ms
  block rings, the integrated / short-term histories and the running peak. The processor calls
  it when `EngineAddresses.LOUDNESS` goes from no subscriber to one (`processor.ts`:
  `if (hasSubscribers && !this.#loudnessActive) {this.#loudness.reset()}`), so a new
  subscription starts a new measurement; a restarted worklet is no longer the only way to an
  empty meter.
- Unchanged: 100 ms non-overlapping blocks (the standard's 400 ms at 75 % overlap), the gating,
  the 3 s / 400 ms windows. The note's "inferred, not observed" item stands.
- **Tests** (`core-wasm/test/`): `loudness-meter.test.ts` (3341 cases 1 and 2 at 48 and 44.1 kHz,
  the 48 kHz BS.1770 response at a set of frequencies, true-peak cases, reset);
  `loudness-meter-ebu.test.ts` is the suite from PR #430 (per rate 48 000 and 44 100: 3341
  cases 1–5 ±0.1 LU with the gates, 3342 cases 1–4 ±1 LU, 3341 cases 15–18 true peak −6 dBTP
  +0.2 / −0.4 at fs/4, fs/4 at 45°, fs/6 at 60°, fs/8 at 67.5°, and a −20 dBFS tone at 15
  frequencies 25 Hz…20 kHz within 0.05 LU of the weighted level; plus one test that the
  reference filter is the printed 48 kHz one).
- Against the repo's finding: the note's "Cause of the weighting error" named the RBJ stages
  and their two errors, and the fix replaces exactly those two stages; the peak was
  `max(|l|,|r|)`, now the Annex 2 interpolator; the reset is wired to subscription start,
  where the harness's `freshMeter` worklet restart stood in.

## Live stream: a packet written while unsubscribed is skipped (#429)

`lib-fusion` `LiveStreamReceiver` (`4406971f8`): `Package.dispatch` gained a `flagged`
argument; `#dispatch` passes each structure entry its subscription flag
(`flags.unwrap()[index] !== 0`), and `ArrayPackage.dispatch` SKIPS the packet's bytes
(`byteLength(length)`, new abstract: floats and ints `length << 2`, bytes `length`) when the
flag was 0 at write time, instead of handing a subscriber an array the processor never
filled. Test `LiveStreamSubscription.test.ts`: a packet flushed before anyone subscribed is
never delivered; a re-subscriber never sees values left from before. The repo's harness
inferred the cause (the broadcaster writes the array on every flush, the processor fills it
only with a subscriber) and skips a leading all-zero packet on its side; that skip is
redundant on this release and harmless (`isLeadingUnfilled` in `loudnessTap.ts`). The public
`subscribeFloats` signature is unchanged.

## Worklet clock: `QuantumClock` corrects a lagging `currentFrame` (#424)

The Chromium defect (issue 442866743: the worklet scope's clock is moved on at the end of a
render quantum only when the audio graph lock is free, so a `process()` call can read the
previous quantum's time while the main thread connects nodes) is open and unchanged. This
release stops the SDK's two start-of-take stamps from trusting that read.

New `lib-dsp` `QuantumClock` (`src/quantum-clock.ts`, exported from the package index;
`4406971f8`):

```
advance(currentFrame) { origin = max(origin, currentFrame − calls·128); return frameOf(calls++) }
frameOf(call) = origin + call·128
```

The processor's frame is its call count on a 128-frame lattice anchored at the LARGEST
`currentFrame − calls·128` seen so far: a read that stands still (only ever early) is
corrected at once, a forward jump (calls skipped) moves the origin forward, and a stale
FIRST read is corrected retroactively once a true read arrives (`frameOf(0)` moves). Tests in
`quantum-clock.test.ts` cover exactly those four cases.

- **The engine's recording start** (`core-wasm/src/processor.ts`): `process` opens with
  `this.#quantumFrame = this.#quantumClock.advance(currentFrame)`, and
  `#announceRecordingStart` reports `(quantumFrame + RenderQuantum) / sampleRate` instead of
  `currentTime + RenderQuantum / sampleRate`. `worklet.d.ts` declares `currentFrame`. This is
  the "engine's stamp" repair the repo's note proposed (`max(currentFrame, previous + 128)`),
  in the same shape.
- **The recording worklet's first quantum** (`core-processors/src/RecordingProcessor.ts`): a
  `QuantumClock` per processor; the call index of the first quantum with the expected channel
  count is kept (`#firstQuantumCall`), and `firstQuantum(...)` is sent only `SETTLE_QUANTA = 16`
  calls later, as `clock.frameOf(firstQuantumCall) / sampleRate` — so any true read among the
  16 calls that follow repairs a stale first stamp. This is the note's way 1 ("hold the report
  back for N calls, send the largest `stamp − 128·callIndex`"), with N = 16: the first-quantum
  time reaches the main thread about 43 ms (48 kHz) / 46 ms (44.1 kHz) later than before.
  The note weighed N against stalls measured up to 7 quanta at a fresh worklet's first read
  under natural conditions and 41 under a node-creation loop, and put N = 32 as the value
  with margin; N = 16 covers the natural cases seen, not the forced ones. Whether the repaired
  stamp still shows events under `&graphChurn=on` is a question for that sweep, not a claim.
- `RenderQuantum` (lib-dsp) is the lattice; the clock assumes consecutive calls are consecutive
  quanta, which the ring buffer already assumed (ring frame 0 = call 0).
- The harness reads `firstQuantumTime` after the take has finalized
  (`recordingCellRunner.ts` `readFirstQuantumTimeSec(loader)` once the loader is loaded), so
  the 16-quantum delay changes nothing in how a row is judged.

## Capture: the audio chain's lifecycle (PR #418, from this repo)

Merged as four commits on `capture/CaptureAudio.ts` (+50, test +383); the installed
`dist/capture/CaptureAudio.js` carries `keepAliveSink` and `#wantsStream`. Nothing under
`project/ProjectEnv.ts`, `project/Project.ts`, `project/ProjectDecoder.ts`, `Workers.ts`,
`AudioWorklets.ts`, `samples/`, `capture/Capture.ts`, `capture/CaptureDevices.ts` or
`capture/CaptureMidi.ts` changed.

- **An armed capture's source node stays pulled** (`fa9627dec`): `#rebuildAudioChain` adds
  a `GainNode` at 0 between the `MediaStreamAudioSourceNode` and `audioContext.destination`
  for as long as the chain exists (`#audioChain.keepAliveSink`, disconnected in
  `#destroyAudioChain`). A source nobody pulls keeps its stream buffered, so with monitoring
  off the first pull after an idle period (a calibration, then a take; take after take on a
  reused stream) read a markedly shorter input delay than every later one — a stored input
  latency held for only one of the two states. Everything reaching the destination renders
  every quantum; a gain of zero adds no output. Monitoring adds and removes its own edges as
  before.
- **A capture naming no device reuses its chain across recordings** (`868e97b43`):
  `#updateStream` returned early only when the id the box names equalled the id the open
  track reports; a box naming no device asks for the default input, whose empty id never
  matched, so every `prepareRecording` tore the stream down and built a fresh source node —
  and a fresh node's first pull reads a shorter delay than every later pull on it. The named
  id the stream was opened with is now held beside it (`#streamNamedDeviceId`): an unnamed
  box keeps an open stream that was itself requested unnamed; clearing a named device back to
  the default still re-opens; a named device differing from the reported one, the
  exact-device fallback retry and a channel-count rebuild on the open stream are untouched.
  The box is never written to, so arming does not dirty the document.
- **A terminated capture tears its chain down** (`d82837c3e`): the terminator ran
  `#disconnectMonitoring` only, so the chain and its stream outlived `Capture.terminate()`
  (called by `CaptureDevices` on project termination and audio-unit removal) — and with the
  keep-alive sink on the destination a stranded chain would be rendered for the life of the
  page, one per armed capture per project switch or deleted armed track. It now runs the
  disarm teardown (`#discardPreparedWorklet` + `#stopStream`), which also releases the
  microphone.
- **The review round's three gaps** (`475ea5caa`): (1) one rule for a stream's lifetime — it
  exists only while the capture is armed and not terminated (`#wantsStream()`, a `VitalSigns`
  owned by the capture), checked when an update starts, before the default-input fallback
  request, and again when a request resolves; `getUserMedia` cannot be cancelled and the
  generator is sequentialized, so a stream that arrives unwanted, or for a device the box no
  longer names, has its tracks stopped instead of being installed with nobody to tear it down.
  A request pending across a disarm and re-arm is kept. `prepareRecording` opens no stream on
  a disarmed capture and rejects for want of a chain. (2) An ended track re-opens the stream:
  reuse compared ids only, so an unplugged device's ended track was handed to the next take
  (`openTrack.readyState === "live"` is now part of the reuse test). (3) A prepared worklet
  that `startRecording` never consumed is discarded on `terminate()` (it stayed registered in
  the sample manager and running).
- Tests (`CaptureAudio.test.ts`): "keeping the input path pulled", "reusing the audio chain
  across recordings", "preparing / starting a recording" — 383 lines.
- **Not in this release**: nothing from #380 beyond these — no `calibrateInputLatency`, no
  `InputLatencyCalibration`, no `LatencyProbes`; `CaptureAudio.prototype` still lacks the
  probe marker the audit pages key on, so the build probe reads `upstream`. #378
  (`InputLatency.resolve` / `Reported`) is also absent.

## Automation recording: a held value records as a step (#443)

`capture/RecordAutomation.ts` (`a4134128c`, one of three WebCLAP fixes): a preset change
after a pause jumped every value and the recorded take ramped into the jump. A recorder
state now carries `lastWriteTime` (`performance.now()`); when a write on a **floating**
parameter lands at a new relative position more than `HoldMillis = 100` after the previous
write and with a different value, the recorder first creates a `ValueEventBox` at the new
position holding the OLD value (index 0) and then the new value at index 1 — a hold then a
step, instead of a `Linear` ramp from the last event. Writes that follow within 100 ms, a
write that does not change the value, and stepped parameters (`Interpolation.None`, e.g.
mute) are unchanged. Tests under "held pauses".

## RecordingWorklet: a rejected save no longer loses the take (live 1166 / 1167)

`RecordingWorklet.ts` (`746fedeea`): `#finalize` wraps `importRecording` in
`Promises.tryCatch`. On rejection (storage unavailable) the take stays in memory with a
synthesized meta (`name: "Recording", bpm, duration, sample_rate, origin: "recording"`), no
peaks are loaded, the state still goes `"loaded"` and `#onSaved` fires, and a
`RuntimeNotifier.info` "Storage Unavailable — … It stays playable until you close the tab."
is shown instead of an uncaught rejection. Test `RecordingWorklet.finalize.test.ts`.

## `ProjectApi.duplicateRegion` rounds a fractional `complete` up (live 1164)

`project/ProjectApi.ts` (`1287874af`): a musical audio region converted from seconds has a
float32 duration (the report: 2880.04345703125), so `region.complete` is fractional while
`position` is Int32. `duplicateRegion` placed the copy at `complete` and masked the overlap
from the same fractional value: the stored position truncated to 2880, inside the source
region, and `validateTrack` panicked ("regions overlap: prev.complete(2880.043…) >
next.position(2880)"). Both branches now `Math.ceil` — the `findFreeSpace` walk and the
explicit / default position — the rule `RegionClipResolver` already applies to its trims.
Tests `Region1164DuplicateFractional.test.ts`. Upstream's triage note says other callers
writing a computed ppqn into an Int32 `position` may truncate the same way; only
`duplicateRegion` is covered. No caller in this repo (the demos copy regions through
`adapter.copyTo`).

## Clipboard, undo

- **Paste floors the playhead once** (`746fedeea`, live 1165): `RegionsClipboard`,
  `NotesClipboard` and `ValuesClipboard` paste used the raw engine position (fractional —
  copy sets it to the selection's `maxPosition`, a float32 audio `complete`, and a stopped
  transport rests on a fractional value), so the clip mask was built from a position the
  pasted boxes could not store. `pastePosition = Math.max(0, Math.floor(getPosition()))` is
  now the one value used for the offset, the mask and the post-paste `setPosition`. Tests
  `RegionsClipboardHandler.test.ts`.
- **A pasted depth lane joining an existing modulator's collection** (`cccd602b2`, live
  1155 / 1156): an assignment's depth lane lives in the MODULATOR's `tracks`, so a unit copy
  carries a `TrackBox` targeting `ModulationBox.depth` into `LfoModulatorBox.tracks`. A
  same-project paste skips the existing modulator, and the lane arrived with its copied
  `index` (colliding with the lanes already there). `BoxGraphCopy` now maps a skipped identity
  box the target graph already holds to its own address (pointers at it keep their target),
  and `DevicesClipboard.reindexModulatorLanes` re-numbers each touched modulator's lanes with
  the existing ones first, pasted ones after, from both `AudioUnitsClipboard` paste paths.
- `ContextMenu.MenuFactory` is `(menuItem, event: MouseEvent) => void` (was `(menuItem,
  client: Client)`; `08d22e20c`, with the studio's new layers component).
- **A failed undo / redo step says so** (`52408ea0f` "watching 1159", `lib-box` `editing.ts`,
  the package's only source change): `undo()` / `redo()` already rolled back a step whose
  inverse / forward threw; they now `console.warn("[BoxEditing] undo step failed and was rolled
  back", stack)` (and the redo twin) first. The 1159 defect itself is watched, not fixed:
  `adapters` `VertexSelection.test.ts` +2 `it.fails` cases (a transaction that deletes a
  selected `SelectionBox` and rolls back recreates the box as a NEW instance under the same
  uuid; the old instance's deferred `onRemoved` is discarded, so `catchupAndSubscribe`'s
  `added` set swallows the new instance's `onAdded` and a later deselect unstages a box the
  graph no longer holds), and core's `UndoSelectionReplay.test.ts` replays the session from
  the undo side.

## WebCLAP

A WebCLAP is a CLAP plugin compiled to WebAssembly (`.wclap.tar.gz` bundle holding
`module.wasm` plus GUI files; format at github.com/free-audio/web-clap). The release hosts one
as an instrument or as an audio effect; the device box holds the bundle url, the plugin id and
the plugin's state blob, and every parameter is a child box the engine binds by CLAP id
(upstream branch `webclap`, merged `0020063e6`; `e2ac5a7fa` "init webclap", `fc4784326`
"add automation", `b61b3f4ed` "rename", `d9c12745f` "wasm api", `db411a255` "resize").

### Boxes, adapters, factories, protocol (`studio-boxes`, `studio-adapters`)

- **Boxes** (`forge-boxes` schema; confirmed in the installed `studio-boxes` .d.ts):
  - `WclapDeviceBox` = `DeviceFactory.createAudioEffect` (`index`, `label`, `enabled`,
    `minimized`, `host: Pointers.AudioEffectHost`) plus `10 url: string`, `11 clap-id: string`
    (getter `clapId`), `12 state: string` (the `clap_plugin_state` blob, base64),
    `13 parameters: field` accepting `Pointers.Parameter`, not mandatory.
  - `WclapInstrumentBox` = `DeviceFactory.createInstrument(…, "notes")` (`label`, `icon`,
    `enabled`, `minimized`, `host: Pointers.InstrumentHost | AudioOutput`) plus the same four.
  - `WclapParameterBox` — one automatable CLAP parameter: `1 owner: pointer<Pointers.Parameter>`
    (mandatory, → the device's `parameters` field), `2 label: string ""`, `3 clap-id: int32`
    (getter `clapId`), `4 value: float32` with `ParameterPointerRules` (Modulation / Automation /
    MIDIControl can point at it), `5 defaultValue`, `6 min`, `7 max: float32`, `8 flags: int32`
    (the `clap_param_info_flags` bits), `9 module: string ""` (the CLAP module path the editor
    groups by). All numeric fields are `constraints: "any"`, `unit: ""` — plain CLAP units,
    not unit-values. Keys 3 and 4 are what the engine binds.
  - `DeviceDefinitions` gains the three; `test-files/all-boxes.od` re-generated (`16d9ea995`).
- **Adapters**: `WclapDeviceBoxAdapter` (`type "audio-effect"`, `accepts "audio"`) and
  `WclapInstrumentBoxAdapter` (`type "instrument"`, `accepts "midi"`, `defaultTrackType Notes`,
  `acceptsMidiEvents true`) expose `urlField`, `clapIdField`, `parameters: ParameterAdapterSet`,
  `deviceHost()`, `audioUnitBoxAdapter()`, `labeledAudioOutputs()`; `manualUrl =
  DeviceManualUrls.Wclap` (`"manuals/devices/audio/wclap"`, new constant). Both registered in
  `BoxAdapters` (`visitWclapDeviceBox` / `visitWclapInstrumentBox`).
- **`WclapParameterAdapters.subscribe(parametric, parameters)`** (shared by both adapters):
  `catchupAndSubscribe` on the `parameters` pointer hub creates one parameter adapter per
  `WclapParameterBox` (`parametric.createParameter(box.value, valueMapping, stringMapping,
  label, undefined, defaultValue)`) and removes it on `onRemoved`. Mapping:
  `ValueMapping.linearInteger(min, max)` when `flags & CLAP_PARAM_IS_STEPPED` (bit 0), else
  `ValueMapping.linear(min, max)`; string mapping `StringMapping.numeric({unit: "",
  fractionDigits: stepped ? 0 : 2})`; `min` / `max` / `flags` subscriptions call
  `adapter.updateMappings` so a plugin that re-publishes its ranges is followed.
- **`InstrumentFactories.Wclap`** — `InstrumentFactory<void, WclapInstrumentBox>`, defaultName
  "WebCLAP", `IconSymbol.WebClap`, `trackType Notes`; `create` sets label, icon and `host` only
  (the editor writes url / clapId after the user picks a bundle — a headless consumer writes
  `box.url` and `box.clapId` itself; the state and parameter children are filled by the engine
  once the plugin loads). `Named` gains `Wclap` (12 entries); the `InstrumentBox` union gains
  `WclapInstrumentBox`. `keyOfBox` is one regex now, `box.name.replace(/(Device|Instrument)?Box$/,
  "")` (was `DeviceBox$` then `Box$`), so `WclapInstrumentBox` → `"Wclap"`; every existing entry
  resolves as before, and no existing factory entry changed shape.
- **`EffectFactories.Wclap`** (`studio-core`, `e2ac5a7fa`; `a6cf2ee6e` re-sorts the audio list):
  `defaultName: "WebCLAP"`, `boxName: "WclapDeviceBox"`, `type: "audio"`, `IconSymbol.WebClap`,
  `DeviceManualUrls.Wclap`; listed in `AudioNamed` between `Waveshaper` and `Werkstatt`. The
  `EffectBox` union gains `WclapDeviceBox`.
- **`protocols.ts`** (the worklet RPC) — new types `WclapBundleFile {path, bytes}`,
  `WclapBundle {files}`, `WclapGuiInfo {uri, width, height, resizable, aspectRatio}` (`uri ""`
  = not ready, 0 sizes = the plugin names none, `aspectRatio 0` = free), `WclapGuiSize`,
  `WclapPluginInfo {clapId, name, vendor, features}`, `WclapParamInfo {id, name, module, min,
  max, defaultValue, value, flags}`, `WclapStatus {state: "loading" | "ready" | "failed",
  message}`, `WclapParamGesture = 0 | 1 | 2` (value / gesture begin / gesture end).
  - `EngineCommands` +6: `wclapOpenGui(uuid): Promise<WclapGuiInfo>`, `wclapCloseGui(uuid)`,
    `wclapResizeGui(uuid, w, h): Promise<WclapGuiSize>`, `wclapReceive(uuid, bytes)` (webview →
    plugin relay), `wclapSaveState(uuid)` (answered through `wclapState` when it changed),
    `wclapDescribe(url): Promise<ReadonlyArray<WclapPluginInfo>>` (fetches and instantiates the
    module once, cached per url).
  - `EngineToClient` +9: `fetchWclapBundle(url): Promise<WclapBundle>` (beside `fetchAudio` /
    `fetchSoundfont` / `fetchNamWasm`), `wclapSend`, `wclapState`, `wclapParams` (the parameter
    list, once per load), `wclapParam(uuid, paramId, value, gesture)` (the plugin's own
    changes), `wclapHovered` (`clap.param-hovered`, −1 = none), `wclapResizeGui` (the plugin's
    `request_resize`, logical pixels), `wclapStatus`, `wclapRequestSave` (the host answers with
    `wclapSaveState` between render quanta). Anything implementing `EngineToClient` by hand
    must add these; this repo lets `EngineWorklet` build it.
- **Icons**: `IconSymbol.WebClap` (= 189) and `IconSymbol.ZoomFit` (= 190) appended at the end
  of the enum (`e2ac5a7fa`, `5cab4d2ac`); existing ordinals unchanged.

### `studio-core`: the `wclap/` namespace (exported from the package root)

- **Engine surface** (`Engine.ts`, `EngineFacade.ts`, `EngineWorklet.ts`): the six `wclap*`
  methods above on the `Engine` interface plus `subscribeWclapStatus(uuid, listener)` (replays
  the last status on subscribe). The facade maps the no-worklet case to inert defaults
  (`{uri: "", width: 0, …}`, `{width, height}`, `[]`) except `subscribeWclapStatus`, which
  `unwrap`s the worklet like `subscribeDeviceMessage`. `OfflineEngineRenderer` wires
  `fetchWclapBundle` to `WclapBundles.fetch` and the rest to no-ops, so an offline render of
  a project holding a WebCLAP device loads the plugin; its `create` / `start` signatures are
  unchanged.
- `WclapBundles.fetch(url)` — fetched once per url (`opfs:` urls through `WclapStorage.load`,
  others through `globalThis.fetch`), gunzipped with `DecompressionStream`, untarred (ustar
  regular files and GNU long names, one top directory stripped), cached as a
  `Promise<WclapBundle>`; `register(url, archive)` makes a not-yet-stored archive describable;
  `file(bundle, path)`.
- `WclapStorage` — locally imported bundles live in OPFS `wclap/<sha256>/bundle.tar.gz` with a
  `meta.json` (`storedAt`), addressed by `opfs:<sha256>`; `store(archive)` hashes and saves,
  `load(url)` reads or asks an installed `RemoteFetcher` (a live-room peer) and verifies the
  hash, `remove(id)` deletes and writes a tombstone (`wclap/tombstones.json`; a later
  `storedAt` revives), `discard(id)` drops the local copy only, `list()`. A new OPFS folder
  beside `samples/v2` — this repo's sample sweep deletes `SampleStorage.Folder` only, so it is
  untouched.
- `WclapParameters.reconcile(project, uuid, params)` — the host is the source of truth: inside
  one `editing.modify(…, false)` existing `WclapParameterBox`es keep value and links and have
  label / module / flags / min / max / default refreshed, boxes for parameters the plugin no
  longer reports are deleted, missing automatable ones (not hidden, not read-only) are
  created under a uuid derived from the device uuid XOR the clap id (last byte flipped so clap
  id 0 cannot equal the device's uuid; every live-room client derives the same uuid, so two
  engines reporting at once create one box). `apply(project, uuid, paramId, value, gesture)`
  writes a plugin-originated value through `project.parameterFieldAdapters.opt(field.address)`
  when an adapter exists ("like a knob or MIDI learn, so automation recording and suspension
  see the write"), gesture 0 only.
- `WclapStates.store(project, uuid, bytes)` — the plugin's own state blob, pushed by the bridge
  after it changed, kept base64 on `box.state` (no-op when unchanged, `modify(…, false)`).
- `WclapGuis` — registry of open plugin webviews by device uuid (`register`, `deliver`,
  `hover` / `hoveredParam` / `subscribeHovered`, `resize` / `subscribeResize`).
- `WclapFailures.report` — once per failure transition a `RuntimeNotifier` warning naming the
  device label and `clapId`: "could not load … The device passes audio through."
- `ProjectBundle` (`.odb`): encode writes every `opfs:` bundle referenced by a
  `WclapDeviceBox` / `WclapInstrumentBox` into `wclap/<id>/bundle.tar.gz` (public urls are
  re-fetched, not bundled) and notifies "N WebCLAP bundle(s) are not on this device and were
  left out" for ones it cannot load; decode saves each archive whose hash matches its folder
  id as freshly stored. Tests `ProjectBundle.wclap.test.ts`.
- `CloudBackupWclaps` — seventh backup stage (`Progress.split(…, 7)`): catalog
  `wclaps/index.json`, tombstones merged both ways, purge / upload / download with hash
  verification. `StudioSettings` gains `"webclap": {"default-zoom": 50 | 75 | 100 | 125}`
  (default 75) — studio UI only.
- Tests: `WclapStorage.test.ts`, `WclapFailures.test.ts`, `WclapParameters.collab.test.ts`
  (live-room: a late joiner reuses, two engines create once, clap id 0, two states converge).

### The bridge (`core-wasm/src/wclap/`, new) and the Rust host side

The JS host of a WebCLAP plugin: a wasm32 CLAP module (`clap-abi.ts` fixes the CLAP 1.2.2
struct offsets on ILP32) with ITS OWN memory, instantiated per device next to the engine, the
NAM pattern. `WclapBridges` (`wclap-bridge.ts`, ~990 lines) supplies the `host_wclap_*`
imports: `create` keys a slot by the device box uuid (a rebind reuses it), `load` fetches the
bundle through `EngineToClient.fetchWclapBundle(url)`, compiles it once per url, instantiates
it with a minimal WASI preview1 shim (`wasi-shim.ts`: console output, clocks, random bytes, no
filesystem; memory limits read from the module's import, 256 MB initial at most, 1 GB
maximum), calls `clap_entry.init` / the plugin factory / `create_plugin` by id, activates it at
the engine's sample rate and 128-frame quantum; host callbacks a plugin needs
(`get_extension`, `request_*`, param / state / gui / log extensions) are JS closures entered
through `trampoline.ts` (a one-function wasm module that imports and re-exports a closure so it
can sit in a funcref table). `process` writes up to 128 param events, 128 note events and the
transport (`bpm`, pulse position at PPQN 960, playing flag) into a CLAP event list and runs
the plugin on a sub-quantum chunk; a plugin that is not up yet returns "not ready" and the
Rust device passes through. The engine hands the bridge each parameter's raw kind, value and
modulation sum and the bridge resolves them (`Unit` → the plugin's own `min..max`, real values
as is; the modulation sum → `clap_event_param_mod` for a parameter flagged modulatable, folded
into the clamped value for the rest); host
values that arrive before the plugin is up are queued per clap id and applied with the first
process call; plugin-side changes are polled (`POLL_PER_CHUNK` 16 get_value calls per quantum,
stopping once the plugin emits `PARAM_VALUE` itself — #446) and reported once; a host value is
never reported back. State is `clap_plugin_state` base64 (`base64.ts`, no `atob` in the
worklet scope; `utf8.ts` gained `encodeUtf8`), saved ~100 ms after the last change
(`SAVE_DELAY_CHUNKS` 40) through `wclapRequestSave`, and a blob the bridge saved itself is
skipped on the way back in. GUI: `openGui` / `closeGui` / `resizeGui` over the engine protocol;
the plugin's page talks to the host through `wclapSend` / `wclapReceive` byte messages (16 MB
cap). Console output per instance is muted after 200 lines. `createWclapDescriber(loadBundle)`
(exported from the package) lists a bundle's plugins on the main thread without an engine.
`boot.ts`: `createWclapBridges(memory, sampleRate, engineToClient, track)` builds the bridge
with its nine `EngineToClient` callbacks, and `instantiateWasmEngine` takes it as an optional
fifth argument; `track` feeds every plugin load into the processor's `#pendingResources`, so
`queryLoadingComplete` (export, first render) waits for plugins too. The offline worker
(`offline-worker.ts`) wires the same bridge and answers the six new `ClientToEngine` calls
with empty stubs. Tests: `wclap-bridge.test.ts` (18 cases against a bundled
`basics.wclap.tar.gz`: describe once per url, pass-through until loaded, unit / real /
modulated mapping, queued values, state round trip, failed load reported without throwing
into the engine, rebind reload, no echo of host values, sub-quantum chunks, gui resize);
`load-full-engine.ts` constructs a rejecting bridge so the existing node tests pass through
the two new devices.

**`crates/engine` and `crates/engine-env` have no source change this release.** The Rust
changes are the host side: `crates/abi` gains the `host_wclap_*` import family (`create`,
`load`, `process`, `note`, `param`, `state`, `reset`, `release`) with the same native no-op
stubs as the NAM bridge; a new `wclap-common` crate (`WclapLink`: observes the box's `url` (10),
`clap-id` (11) and `state` (12) string fields, reloads only when url or id changed, passes the
input through while the plugin is not ready, the instrument ADDS the plugin's output); two new
side-module crates `device-wclap` (audio effect, `parameters` hub key 13, children bind `value`
(4) with `clap-id` (3) as id) and `device-wclap-instrument` (notes forwarded as `wclap_note`);
`studio-boxes/registry.rs` registers the three boxes. `build-wasm.sh` adds both crates to
`DEVICE_CRATES` and sources a new `cargo-env.sh` (rustup's `.cargo/env` on Unix, `.cargo/bin`
on the PATH on Windows — PR #397 follow-up `d6e4988df`); `engine-modules.ts` lists
`device_wclap.wasm` → `WclapDeviceBox` and `device_wclap_instrument.wasm` →
`WclapInstrumentBox` in `DEVICES`.

## Lib

- **`lib-inference` `EngineHost` — recover instead of hanging when the worker crashes (PR #406,
  `0ee5f7652` + `8a95a97f4`)**: an `error` / `messageerror` listener outside the init promise
  terminates the dead worker, clears `#worker`, `#ready`, `#loadedTasks` and `#names`, and
  rejects every `#pending` call (identity-guarded so a listener of an already-replaced worker
  cannot act on the current one); the next call spawns a fresh worker. A `messageerror` during
  init now rejects the init promise too. Before, a crash after init (a native ORT abort) left
  every pending promise unsettled and `#ready` resolved forever, so every later call hung on
  "Loading model" until a reload. +3 tests. No use in this repo.
- `core-wasm/test/reorder-no-rebuild.test.ts`: settles on `sync.checksum(...)` round trips
  instead of a `setTimeout` tick.

## Scripting and P2P (not part of the installed SDK)

- **Waveshaper `equation` typed** (`d44e28584`): the scripting API declared `equation: string`
  ("preset name or custom equation") and bound the box field directly, so
  `addAudioEffect("Waveshaper", {equation: "tanh(x)"})` stored a string the engine does not
  know. Now `equation: "hardclip" | "cubicSoft" | "tanh" | "sigmoid" | "arctan" | "asymmetric"`
  (`Waveshaper.Equation` from `lib-dsp`, which already shipped the union), validated with
  `Guard.oneOf`, `RangeError` on anything else.
- **Bundles travel between live-room peers** (`7bafb39d4`, `88b87b874`): `AssetReader`
  `hasWclap` / `readWclap`, `AssetServer` answers `"wclap"` asset requests from OPFS as raw
  bytes, `PeerAssetProvider.fetchWclap`, `ChainedWclapProvider` (`attachPeer` / `detachPeer`,
  rejecting with no peer — bundles have no cloud fallback), `WCLAP_DISCOVERY_TIMEOUT_MS =
  5_000` for wclap requests only.

## Build / tooling (no SDK surface)

PR #397 (`ff4706dbf`, `a5699f806`, `cd2b53f16`, follow-up `d6e4988df`): studio, lab and manual
dev servers serve HTTPS only when BOTH `certs/localhost-key.pem` and `localhost.pem` exist and
bind the network only over HTTPS, build and `test:rust` share one cargo env, Windows paths
fixed; the manual pre-renders every markdown page to its own `.html` (+`.br`, `Prerender.ts`);
`turbo.json` passes `VITE_WCLAP_ORIGIN` through.

## Upstream tests

`core-wasm/test/`: `loudness-meter.test.ts`, `loudness-meter-ebu.test.ts` (PR #430),
`wclap-bridge.test.ts` (+ `assets/basics.wclap.tar.gz`); `lib-dsp` `quantum-clock.test.ts`;
`lib-fusion` `LiveStreamSubscription.test.ts`; `lib-inference` `EngineHost.test.ts` (+137);
`studio-core`: `CaptureAudio.test.ts` (+383), `RecordAutomation.test.ts`,
`RecordingWorklet.finalize.test.ts`, `Region1164DuplicateFractional.test.ts`,
`UndoSelectionReplay.test.ts`, `AudioUnitsClipboardHandler.test.ts`,
`RegionsClipboardHandler.test.ts`, `ProjectBundle.wclap.test.ts`, `CloudBackupWclaps.test.ts`,
`WclapFailures.test.ts`, `WclapParameters.collab.test.ts`, `WclapStorage.test.ts`;
`studio-adapters` `VertexSelection.test.ts`; `studio-p2p` `AssetServer.test.ts`,
`ChainedProviders.test.ts`, `WclapDiscoveryTimeout.test.ts`; `app-manual` `Prerender.test.ts`.

## Studio-app only (no SDK surface)

The WebCLAP device editor (plugin box with download / load progress and a **Failed** state
that passes audio through, a Load Plugin menu — Cloud index from `assets.opendaw.studio/wclaps`
grouped in folders, Local imports, "Import WebCLAP…" for a `.wclap.tar.gz` with a plugin
picker, Open / Close UI, the parameter list grouped by CLAP module with Enter Percentage /
Create Automation / Learn MIDI / Modulate / Reset), the plugin window as a new `FloatingWindow`
on a `Layers` surface (`08d22e20c`; z-order and event priority, resize within what the
plugin's `clap.gui` accepts, default zoom 75 % with a Preferences › WebCLAP setting and a
Fit-zoom button, pop-out into a real browser window `855f75863`, keyboard shortcuts passed
through), the plugin page isolated in `wclap-frame.html` behind a service worker
(`2feba95ad`), a **WebCLAP** tab on the dashboard listing stored bundles, #444 (a lost
`pointerup` is delivered on the first button-less move), a new manual page
`devices/audio/wclap.md`, menu colours, tooltip rework, error triage: 1155 / 1156 / 1164–1167
fixed in core, 1157 / 1158 ignored (Brave's cosmetic-filter user script rejecting with a
foreign `TypeError`, `ErrorInfo` now recognises it), 1159 watched.

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler**: `npm run typecheck` exits 0 before and after the
  bump. Nothing in `src/` implements `EngineCommands` / `EngineToClient` by hand, enumerates
  `InstrumentFactories.Named`, calls `keyOfBox`, `duplicateRegion` or a clipboard handler,
  reads a numeric `IconSymbol` ordinal, or imports `studio-scripting` / `studio-p2p`.
  `src/lib/projectSetup.ts` constructs the same `ProjectEnv` (unchanged `.d.ts`); no new
  member for WebCLAP — the worklet fetches bundles itself.
- **Loudness meter closed out** — `loudness-meter-audit-debug-demo.html` is the regression
  test: **28 of 28 rows pass at 48 kHz and at 44.1 kHz** (envelopes `loudness-audit-1791567000907.json` /
  `…1791567720437.json` in the local, untracked `.verify-output/`; the rows are in the register
  section "SDK 0.0.174" of `debug/2026-10-02-loudness-meter/note.md`; the 0.0.173 runs read
  16 of 28). Every row that failed reads within
  0.05 LU of its level; the K-weighting rows read their weighted level to the hundredth. The
  harness keeps its worklet restart between cases (it also empties the meter) and its
  leading-zero skip (the release never sends that packet; the comment says so). The link bar
  says the four issues are fixed; `src/demos/engine/CLAUDE.md` describes the standard's
  filter, dBTP and the reset-on-subscribe; `debug/2026-10-02-loudness-meter/note.md` carries
  the two 0.0.174 register tables and `debug/README.md` the status. One observation there, not
  a finding: the sweep case's running true peak reads −19.81 / −19.68 dBTP for −20 dBFS tones
  (the interpolated peak of a tone high in the band, within the +0.2 dB the peak cases allow,
  not a judged reading).
- **Worklet clock closed out on the SDK's side** — the browser defect stays open and the
  debug index says so; `debug/2026-10-01-worklet-clock-stale/note.md` has the resolution
  (which of its two proposed repairs each stamp got, and N = 16 against the note's N = 32);
  `src/demos/recording/CLAUDE.md` describes the stamps as repaired. Measured in the register
  (section "Standing sweep on 0.0.174"): under forced graph churn (`&graphChurn=on`, three
  runs, 48 rows, 190–220 clock stalls per run) **every row sits at 0 / 0 quanta off the usual
  placement** — on 0.0.173 the same experiment put 24 of 46 rows one to three quanta off. The
  natural tally reads 0 in 92 repeats (interval 0–3.9 %), too few to show a sub-one-per-cent
  rate moving; the forced runs are the measurement that can. The 16-quantum delay of the
  recorder's first-quantum report changes nothing for the harness, which reads
  `firstQuantumTime` after the take has finalized.
- **#418 closed out** — `src/demos/recording/CLAUDE.md` (upstream status, chain reuse as
  release behaviour, the `LatencyProbes` proxy now naming the calibration branch rather than
  "the build after the keep-alive sink"), the register's contribution table and its
  "Would upstream PR #418 change it" section, the worklet-clock note's upstream paragraph and
  `debug/README.md`. The build probe still reads `upstream` (nothing from #380 or #378 is in
  the release).
- **Standing sweeps on the release**: sample-rate / quantum-alignment **180 of 180** cells
  pass; recording start-alignment 48 kHz and 44.1 kHz, 60 rows each, 0 error rows, every
  repeat finalized, netted medians +1.07…+1.17 ms and +0.97…+1.19 ms — the 0.0.173 ranges to
  the hundredth; multi-mic two runs, 64 rows, netted +1.146 on every row, node delays read on
  all, no collision, no hang, every repeat finalized both tapes. One cell reads `investigate`
  at 48 kHz on a first-repeat head deficit of 79 ms: the first recording of the first page
  load after `node_modules/.vite` was deleted for the upgrade, the same cold-start event the
  0.0.173 sweep recorded (84 ms) at the same place in the session; the 44.1 kHz run's first
  repeats are all at 0.
- **Docs for what is new**: `documentation/11-effects.md` (WebCLAP in the effect inventory),
  `documentation/internals/03-cross-thread-protocols.md` (both protocol interfaces with the
  `wclap*` members) and `14-glossary.md`, `documentation/internals/05-devices-and-effects.md`
  (WebCLAP as the second NAM-pattern device), `src/demos/midi/CLAUDE.md` and
  `src/demos/effects/CLAUDE.md` (the two adapters, what a headless consumer writes),
  `src/demos/automation/CLAUDE.md` and `documentation/09-editing-fades-and-automation.md`
  (the hold-then-step after a pause). No demo loads a WebCLAP bundle: a demo needs a bundle
  source (the studio's cloud index is app code, not SDK) and is a follow-up.
- **Verification**: `npm run typecheck` 0 errors, 1054 of 1054 vitest tests, `npm run build`,
  `npm ci` on the regenerated lockfile.
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`):
  `OPENDAW_SDK_VERSION = "0.0.174"`; `QuantumClock` exported from `lib-dsp`; `byteLength` on
  the live-stream packages and the `flagged` dispatch in `lib-fusion`; `keepAliveSink` /
  `wantsStream` in `studio-core`'s `CaptureAudio.js`, `lastWriteTime` in `RecordAutomation.js`,
  "Storage Unavailable" in `RecordingWorklet.js`, `Math.ceil` at the three `duplicateRegion`
  sites, the six `wclap*` `Engine` methods, `EffectFactories.Wclap`, `StudioSettings.webclap`,
  `MenuFactory = (menuItem, event: MouseEvent)`; the "undo step failed" warn in
  `lib-box/dist/editing.js`; `WclapDeviceBox` / `WclapInstrumentBox` / `WclapParameterBox` in
  `studio-boxes`; `WclapDeviceBoxAdapter` / `WclapInstrumentBoxAdapter` /
  `InstrumentFactories.Wclap` / `DeviceManualUrls.Wclap` in `studio-adapters`;
  `IconSymbol.WebClap` 189 / `ZoomFit` 190; the two new wasm binaries and the 32 byte-identical
  ones (compared against the published `studio-core-wasm@0.0.18` and `nam-wasm@1.2.0`).
