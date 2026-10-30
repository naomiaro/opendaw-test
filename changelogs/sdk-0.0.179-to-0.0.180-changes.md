# OpenDAW SDK Changelog: 0.0.179 → 0.0.180

Published 2026-10-30 14:05 UTC, a day after 0.0.179. 11 commits tag-to-tag (all non-merge), 144
files. The release is the maintainer's **capture rewrite**: audio and MIDI capture move behind
ports (`studio-core/src/io`), a `RecordingSession` per project replaces the static `Recording`
state, the engine reports every transport start, jump and stop in context time, and audio
captures can measure and store their real round trip. It closes two issues this repo filed
(openDAW#491, #492). What matters for this repo:

1. **A loop take ends where the engine wrapped.** `RecordAudio` used to cut a take when the
   main-thread position went backwards, at `tempoMap.intervalToSeconds(position, loopTo)` past its
   start. It now cuts at the engine's wrap anchor (`engine.subscribeTransportAnchors`, a `"jump"`
   stamped in context time at the sample the engine rendered), so every lap becomes a take on a
   hidden page too, and a take's duration is the rendered lap. **This moves the recording sweep's
   `loop-wrap` rows**: on 0.0.179 each later take of a repeat sat about 0.02 ms earlier than the
   one before at three of four rate / tempo pairs (44.1 kHz 120 bpm 1.13 → 1.07 ms netted); on
   0.0.180 they hold (1.16 ×4). Every other scenario reads as on 0.0.179.
2. **A recording finishes on the engine's stop**, not on the next animation frame:
   `RecordingSession` finalizes on a `"stop"` anchor with `recording: true`. `Recording` stays as a
   static facade (`Recording.start`, `Recording.isRecording` = any project records,
   `wasCountingIn()`, `wasStartingAt()`); its instance fields `countIn` / `startPosition` are gone
   (no demo read them).
3. **MIDI notes land where they were heard** — openDAW#491, filed from this repo, CLOSED.
   `CaptureMidi`'s clock (`BrowserContextClock.audibleTimeAt`) maps a key's `timeStamp` to the
   heard context time through `getOutputTimestamp()`, `RecordMidi` subtracts
   `engine.compensationLatency` and places it on a `TransportLog` of the engine's
   anchors instead of extrapolating the frame-stale position plus the output latency (the +32 ms
   this repo measured). Firefox's MIDI stamps, on a clock of their own, are converted
   (`MidiClock`). A key between the loop end and the wrap's arrival is held and replayed into the
   new take. **Measured here: the IAC sweep reads 36 of 36 rows `aligned`, medians 0.00–0.01 ms
   against the heard beat** (0.0.176–0.0.179: about +32 ms, the `MIDI_KNOWN_DEFECTS` band, which
   now only catches a regression back to the old recorder); the note on the loop end lands in the new
   take, 0.007 ms off. The combined MIDI + audio cell, calibrated, now reads `together` — key and
   sound both on the beat, 0.00 ms apart (on 0.0.176 the key landed 33 ms after the sound); its band
   follows the build (`midiPlacesAtHeardTime`), so an uncalibrated cell reads the sound late by the
   untold input part (63.80 ms) with the key on the beat.
4. **A release keeps its length through a main-thread block** — openDAW#492, filed from this
   repo, CLOSED. The note-off is written from its own stamp on the anchor log
   (`transport.advance`), not from the first frame after the block. Measured: 0 collapsed releases
   and duration error 0.00 ms on every `janked-start` / `janked-mid` row (150 ms blocks).
5. **A measured round trip replaces both reported latencies.** `CaptureAudio.measureRoundTrip()`
   plays three maximum-length-sequence noise bursts and finds them in the input; a steady result
   (all three heard, spread ≤ 1.5 ms) is stored in `localStorage["opendaw:round-trips"]` per output
   device name, input label and sample rate. While an entry exists for a capture's output device
   name, input label and sample rate, and the capture's own
   `captureBox.inputLatency` is Inherit records with `outputLatency = roundTrip`, `inputLatency = 0`,
   and the preference `recording.inputLatency` is not read. `roundTrip`, `forgetRoundTrip()`,
   `subscribeRoundTrip()`; `project.captureDevices.audio(uuid)` returns `Option<CaptureAudio>`.
   **An audit that leaves its Tapes on Inherit would read a stored entry as an SDK shift**: the
   recording-alignment and hidden-page pages now refuse to run while one exists (follow-ups); the
   combined page sets the Tape's own value and is not affected.
6. **A live input is rebuilt after another stream opens.** A `MediaStreamAudioSourceNode` reads
   about 24 ms late for good after another stream opened or closed, the device list changed or the
   context resumed (the maintainer's measurement); `BrowserAudioInput` now builds a fresh source on
   the same stream 250 ms after any of those (deferred while a recording uses it) and keeps a
   silent sink on the destination so the source stays pulled. `AudioDevices.subscribeStreamsChanged`
   / `notifyStreamsChanged` are new. The multi-mic sweep, which taps every source node the SDK
   builds and nets each tape's node delay, reads as on 0.0.179 (one node per tape per repeat on 29
   of 32 tapes; netted skew 0.00).
7. **New API around it**: `project.recordingSession` (`start(countIn)`, `isRecording`,
   `wasCountingIn`, `startPosition`; `RecordingSession.anyRecording`); `engine.subscribeTransportAnchors`
   on `Engine` / `EngineFacade` / `EngineWorklet` and `TransportAnchor` in `studio-adapters`;
   `TakePolicy.applyOlderTakeAction` and `TransportLog` (exported from `capture`); the `io` module
   exported from `studio-core` (`AudioInputPort`, `MidiInputPort`, `MonitorPort`, `ContextClock`,
   `RecordingLatency`, `RecordingSink`, `RoundTrip`, and `BrowserAudioInput`, `BrowserContextClock`,
   `BrowserMidiInput`, `BrowserRecordingLatency`, `BrowserRoundTrips`, `MidiClock`; `BrowserMonitor`
   is not exported);
   `RecordingWorklet.capturedFrames`; `CaptureAudio.input`; optional constructor parameters on
   `CaptureAudio` (an `InputFactory`) and `CaptureMidi` (an input port and a clock) for tests.
   `RecordAudio.start` takes a `sink: RecordingSink` instead of `recordingWorklet` + `sourceNode`
   (internal; no demo calls it).
8. **The spectrum resolves the low end** — below 300 Hz the engine's new low-band analyser
   (`LowBandAnalyser` in `lib-dsp`, `low_band_analyser.rs`) gives about 6 Hz bins instead of 47 Hz,
   broadcast at `EngineAddresses.SPECTRUM_LOW` (and Revamp's `spectrumLow` address) to whoever
   subscribes; `EngineAddresses.SPECTRUM` is unchanged (#515, another user's).
9. **Smaller fixes**: a rolled-back transaction that recreates deleted boxes now re-points pointer
   listeners at the new instances (`BoxGraph` severed pointers — selections no longer keep a
   region the rollback replaced; live errors 1194–1196, 1159); a script that swaps an instrument
   for one of the other input type (Vaporisateur → Tape) replaces the old tracks with one empty
   matching track.

openDAW#493 (count-in pickups) and #494 (short sample) stay open: `RecordMidi` still holds keys
pressed before the first lap and writes them at position 0 when it opens.

Sub-package versions (installed): `studio-core` 0.2.14 (was 0.2.13), `studio-core-wasm` 0.0.25
(0.0.24), `studio-adapters` 0.3.12 (0.3.11), `lib-box` 0.0.102 (0.0.101), `lib-dsp` 0.0.100
(0.0.99), `studio-sdk` 0.0.180. Bumped with a byte-identical `dist` (version bump only):
`studio-boxes` 0.0.118, `lib-fusion` 0.0.111, `lib-midi` 0.0.81, `lib-dawproject` 0.0.85.
Unchanged: `lib-dom` 0.0.95, `lib-jsx` 0.0.97, `lib-runtime` 0.0.90, `lib-std` 0.0.89, `lib-xml`
0.0.75, `studio-enums` 0.1.10, `nam-wasm` 1.2.0. Licences unchanged (AGPL-3.0-or-later; `nam-wasm`
MIT). WASM: **12 of 36 binaries changed** — `engine.wasm` 1 231 649 → 1 232 086 bytes (the
transport-jump exports), `device_revamp` 21 807 → 24 538 (its low-band display), and ten rebuilt
stock devices at or within 11 bytes of their 0.0.179 size (`device_autotune`,
`device_neural_amp`, `device_maximizer`, `device_dattorro_reverb`, `device_waveshaper`,
`device_convolver`, `device_fold`, `device_tubular`, `device_compressor`, `device_vocoder`); the
other 24 are byte-identical. `OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.180"`.

## Capture rewrite (`4f0dd46e2`)

Engine: `crates/engine/src/lib.rs` keeps the discontinuous blocks of each quantum
(`transport_jumps`, the sample inside the quantum and the position after the jump) and the sample
where `pauseOnLoopDisabled` paused; the worklet reads them after the quantum
(`transport_jump_count` / `_sample(i)` / `_position(i)`, `transport_pause_sample`), stamps them in
context time and derives start and stop edges from the transport flags
(`core-wasm/src/transport-anchor-edges.ts`), then sends `EngineToClient.transportAnchors(anchors)`.
Rendering is unchanged.

`RecordAudio`: the first take waits for both `engine.recordingStart` and the sink's first-quantum
time (the 0.0.179 fallback that estimated the start from the count-in after a wait is gone) and
places with the same formula. Jumps arriving with `recording: true` and loop takes allowed split
the take at `jump.contextTime + ringOffset − currentWaveformOffset`; a seek flagged in the
recording's first quantum is skipped. The stop path (stamped stop, wait for the input in flight,
trim after a second) is 0.0.179's, now against a `RecordingSink`. `TakePolicy` holds the
older-take action both recorders share.

`RecordMidi`: `timeOf(stamp) = clock.audibleTimeAt(min(stamp, now)) − compensationLatency`; a lap is
`{take, from, position}` per anchor; a note's write position is `transport.positionAt(time)`, its
duration `transport.advance(onTime, offTime)` (jumps excluded). A key heard past the loop end
before the wrap arrived waits in `lateSignals` and is replayed on the wrap.

`BrowserAudioInput` holds everything the old `CaptureAudio` did with Web Audio and `getUserMedia`
(stream, chain, monitor, the recording worklet) behind `AudioInputPort`; `BrowserMonitor` the
monitoring nodes. `CaptureAudio`'s public getters are kept (`stream`, `streamDeviceId`,
`outputNode`, `monitorGainNode`, …) and read through the port.

The commit also adds `scripts/capture-audit/` upstream (MIDI over a virtual CoreMIDI source,
audio through BlackHole, no person needed) and `plans/capture.md`.

## Round-trip calibration (`2c92f20da`, `03b2bf85b`, `d03eee4ff`)

`RoundTrip.probe()` is a 2¹⁴−1 maximum-length sequence; `locate` cross-correlates by FFT and
refines the peak between samples; `analyse` takes the median of the bursts heard ≥ 15 dB over the
correlation floor within 0.6 s. `BrowserRoundTrips` keys entries by the output device's label
(the context's `sinkId`, `"default"` resolved through `enumerateDevices`), the input track's
label and the sample rate. The studio app adds Measure / Forget Latency to an audio track's capture
menu and a manual page; the SDK readme gains a "Latency calibration" section.

## Low-band spectrum (`f2456d33a`)

`LowBandAnalyser` low-passes and decimates the mix by a power of two to about 6 kHz (8 at
48 kHz) and runs its own 1024-point FFT; it broadcasts 64 bins up to the 300 Hz crossover
(`NUM_BINS`, `CROSSOVER`, `binWidth(sampleRate)`), and the processor runs it only while
subscribed. Display only: no audio path changed.

## Rollback re-points pointer listeners (`3d28358bf`)

`BoxGraph.#rollback` records each pointer whose box the rollback recreated as a new instance;
`#finalizeTransaction` removes the old pointer from its target's hub and adds the replacement.
The repo's box-graph tests (`staleBoxPointerWrite.test.ts`, `constructorPointerOrder.test.ts`)
pass unchanged.

## Studio-app only

Ctrl copies and Ctrl+Shift mirrors regions and clips whatever the source's state, with a matching
drag preview (#514, another user's); WebCLAP pages keep their own double-click and right-click
unless a parameter is hovered; the note editor's "No CaptureMidi available" error names its state
(#1198); the Measure / Forget Latency menu items and manual page.

## Upstream tests

`studio-core` `CaptureAudioPort.test.ts` (196), `CaptureMidi.test.ts` (164), `RecordAudio.test.ts`
(+157), `RecordMidi.test.ts` (+166 / −106), `CaptureAudio.test.ts` (+59), `TransportLog.test.ts`
(63), `io/RoundTrip.test.ts` (78), `io/browser/BrowserPorts.test.ts` (82), `MidiClock.test.ts`
(27), `ysync/LiveRegionSelection.test.ts` (267), `ysync/YSyncNoteEditorCapture.test.ts` (209);
`core-wasm/test/` `transport-anchor-edges.test.ts` (56), `transport-jumps.test.ts` (74);
`lib-box` `editing.test.ts` (+77); `lib-dsp` `LowBandAnalyser.test.ts` (93); `scripting`
`Units.test.ts` (+23).

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler or the tests**: `npm run typecheck` exits 0 and 1563 of
  1563 vitest tests pass on the release before any repo change.
  Nothing in `src/` read `Recording`'s removed instance fields, called `RecordAudio.start`, or
  constructed a `CaptureAudio` / `CaptureMidi`.
- **A guard against a stored round trip** (`src/lib/audit/storedRoundTrips.ts`, with a Node test
  shown to fail when the guard is broken): the recording-alignment page (single tape and multi-mic)
  and the hidden-page page refuse a run at its start, before the engine boots, while any entry is
  stored in `localStorage["opendaw:round-trips"]`; `#audit-state` then reads `error:<the refusal>`. They leave their Tapes on Inherit and write the
  preference `recording.inputLatency = 0`, which an entry overrides. Positive control on the page:
  a 50 ms entry for the run's own devices put a loopback take at −25.85 ms netted instead of +1.15
  (the 27 ms between the entry and the reported 23 ms); a guard reading the capture's own
  `roundTrip` missed the first repeat (the stream that arming opens is still opening when the page
  checks; `prepareRecording` waits for it), so
  the guard refuses on any stored entry the SDK would read (its own entry check). A first per-repeat
  version left every repeat an error row and the run `done`; the review moved it to the run's start.
  With the entry the run ends `error:…` at setup; without it, +1.15 on all three repeats. The
  combined MIDI + audio page needs no guard: it sets the Tape's own value. The input-latency
  calibration page, which shares `recordingCellRunner.ts` but runs against an override build without
  round trips, is left unchecked.
- **Docs for what changed**: `documentation/08-recording.md` (the session, takes cut at the engine's
  wrap, the first-take formula without the count-in estimate, a new "Measuring the round trip with
  the SDK" section, the `roundTrip` field of the latency report),
  `documentation/internals/03-cross-thread-protocols.md` (`transportAnchors` on `EngineToClient`,
  the transport-jump exports, the `TransportLog`; the listing brought up to the installed
  interface), `documentation/09-editing-fades-and-automation.md` (`RecordAutomation` starts from the
  session), root CLAUDE.md (the recorders read transport anchors, not frames; a new "Measured Round
  Trip Replaces Reported Latencies" section), `src/demos/recording/CLAUDE.md` (wrap detection, take
  durations, the first-take gate, the monitor chain's keep-alive sink and source rebuild, the stored
  round trip, what a hidden page still waits a frame for), `src/demos/midi/CLAUDE.md` (where a
  recorded note lands now; the measured MIDI bands marked as describing the recorder before the
  rewrite). Registers: #491 / #492 closed in the MIDI input and combined notes and in
  `debug/README.md` (the hidden-safe frame-driver draft marked for a re-read: the recorder no longer
  needs frames to cut or finish a take); `docs/known-vendor-issues.md` re-read: WebKit 256023 and
  327552 landed on WebKit trunk (RESOLVED FIXED 2026-10-30 / 10-29, kept watched until a shipping
  Safari is measured), no new open Bugzilla bug on Web Audio, AudioWorklet, Web MIDI or OPFS since the
  last sweep, no watched Chromium issue changed.
- **Standing sweeps on the release** (Chrome 156.0.8078.74, the Playwright browser, the Mac's output
  device at **44.1 kHz**): sample-rate / quantum-alignment **240 of 240** cells pass, every family's
  maximum the 0.0.179 value (metronome 0.08, loop-wrap 0.54, seam 0.20, region-fencepost 0.03,
  note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos 0.07,
  audio-wrap-click 0.39, -onsets 0.05, -dip 0.02 ms; the dip −3.1 dB, the wrapped loop-start hit
  −2.8 dB / +1.00–1.07 ms). Recording start-alignment, 60 rows at each rate, 0 error rows, every cell
  `aligned`, every repeat finalized: every scenario but `loop-wrap` reads the 0.0.179 netted medians;
  **`loop-wrap` no longer drifts take by take** (44.1 kHz 120 bpm 1.13 → 1.07 on 0.0.179, 1.16 ×4
  now; 48 kHz tally 1.15 ×27, 1.17 ×15, 1.16 ×12, 1.10 ×6); no head deficit (the cold-start event
  0.0.173–0.0.179 recorded on the first row did not occur); one 0.04 ms tail on one 44.1 kHz repeat
  (frame rounding) (`recaudit-summary-1793387813664.json`, `…1793388244953.json`). Multi-mic 32
  rows netted +1.146, raw skew 0.00 on every repeat (`recaudit-mt-summary-1793388667334.json`);
  three forced-churn runs 48 of 48 at 0 / 0 quanta; one-quantum tally **0 in 76**.
  `param-write-enabled-flip-debug-demo.html` **FIXED** (step 2 tail 2050 ms, step 3 400 ms).
  `plugin-delay-compensation-debug-demo.html` **lag 0 frames on every row**. MIDI effect placement
  **13 of 13 `as-predicted`** at 48 and 44.1 kHz. Loudness meter **28 of 28 at both rates**, every
  judged metric the 0.0.179 value (`loudness-audit-1793389813985.json`, `…1793390500647.json`); the
  unjudged "5 s after" range of `3341-15` at 48 kHz read 8.60 against 9.40. Hidden-page `modal` rows
  at start / mid / stop: **both takes `intact`** on every row (31 / 31 beats, median 1.15 ms; the
  stop row's finalization waited the 10.9 s the alert was up). Chromium probe: `first-read` `STALE
  FIRST READ` 15 of 15; `suspend-resume&tracker=1` `HALF RATE` on the first run; `capture-gaps`
  loopback `CLEAN` at 48 000, `START GAPS` (one 441-frame run) at 44 100; `opfs-flush` median 0.80 ms
  per MiB; `opfs-usage` in-session `COUNTED`. Rows in the recording and loudness registers under
  "0.0.180", and in the vendor register's "Last checked" lines.
- **Not run here** (they need the IAC Driver, the built-in microphone in a quiet room, or a hand):
  the MIDI input sweep's `&effect=` arm (its five-repeat loop-wrap row read `aligned`, the note on the
  loop end in the new take on 5 of 5 repeats, within 0.004 ms), the MIDI output timing audit, the hidden-page `cover` rows, and the Chromium probe's bfcache,
  freeze, OPFS-restart, microphone and Bluetooth rows.
- **The output device at 48 kHz** (the second footing root CLAUDE.md asks for; the first time these
  sweeps ran on it): sample-rate 240 of 240 with the same maxima; recording at 48 000 (now the device's
  own rate) the 44.1 kHz device's reading row for row; multi-mic +1.146 on every row; loudness 28 of 28
  at both rates, judged metrics unchanged; capture-gaps loopback `CLEAN` / `START GAPS` (441) as before.
  Recording at 44 100, now **resampled**: one 0.0.180 run had netted medians stepping by exactly 1.00 ms
  between repeats (−0.84…+2.16, four cells `investigate`), the take's `waveformOffset` carrying the
  `outputLatency` Chrome reported at placement as it stepped 0.022 → 0.025 s; a repeat on 0.0.180 and an
  A/B on the byte-exact 0.0.179 packages read every cell `aligned`, so the stepping is the browser's
  report, which both releases read at placement (a new Observations entry in the vendor register).
  Sub-millisecond tail deficits appear on the resampled context on both releases (0.0.179 15 of 60 rows,
  0.0.180 1 and 25), on neither at the device's rate. Rows in the recording register under "Device at
  48 kHz" and the loudness register under "SDK 0.0.180 on the 48 kHz device".
- **Verification**: `npm run typecheck` 0 errors, 1565 of 1565 vitest tests (1563 + the guard's 2),
  `npm run build`, `npm ci` on the regenerated lockfile; the openDAW checkout and the XERJ corpus
  clone moved to `9306eaab6` (the `@opendaw/studio-sdk@0.0.180` tag; 39 125 records re-indexed).
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`, diffed against
  a copy of the installed 0.0.179 packages taken before the bump): `OPENDAW_SDK_VERSION = "0.0.180"`;
  `recordingSession: RecordingSession` on `Project`; `RecordingSession`, `TakePolicy`, `TransportLog`
  exported from `capture`; `export * from "./io"` in `studio-core`'s index (`AudioInputPort`,
  `ContextClock`, `MidiInputPort`, `MonitorPort`, `RecordingLatency`, `RecordingSink`, `RoundTrip`, the
  `Browser*` ports but `BrowserMonitor`, `MidiClock`); `roundTrip`, `forgetRoundTrip`, `subscribeRoundTrip`,
  `measureRoundTrip`, `input` and the `InputFactory` parameter on `CaptureAudio`; the `input` / `clock`
  parameters on `CaptureMidi`; `audio(uuid): Option<CaptureAudio>` on `CaptureDevices`;
  `subscribeTransportAnchors` on `Engine` / `EngineFacade` / `EngineWorklet`; `TransportAnchor` and
  `EngineToClient.transportAnchors` in `studio-adapters`' protocols; `countIn` / `startPosition` and
  the private constructor gone from `Recording`; `RecordAudio.start({sink, …})`; `RecordMidi.start({…,
  clock})`; `capturedFrames` on `RecordingWorklet`; `subscribeStreamsChanged` / `notifyStreamsChanged`
  on `AudioDevices`; `EngineAddresses.SPECTRUM_LOW`, `RevampDeviceBoxAdapter.spectrumLow`;
  `LowBandAnalyser` in `lib-dsp`; `transport_jump_count` / `_sample` / `_position` /
  `transport_pause_sample` in `engine-exports`; the 12 changed and 24 byte-identical wasm binaries
  (compared with `cmp` against the 0.0.179 copy).
