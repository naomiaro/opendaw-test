# Known vendor issues to work around

A register of browser, platform and hosting behaviours outside the SDK that this repo has
measured and works around. Read it before debugging a symptom that matches one: a listed
behaviour is not a new finding, and each entry says where its workaround lives, or what is
still to do.
It is a register, so it carries versions and dates; the chapter docs and CLAUDE.md state the
present only. Add an entry when a vendor behaviour costs a session; retire it (keep the row,
mark it fixed, name the version) when the vendor ships a fix and a re-measurement confirms it.

Each entry: the tracker and its status, the symptom, where it shows up here, the workaround and
where it lives, the evidence, and when it was last checked. An entry marked **watched** is an open
upstream issue read from the tracker that would reach this repo but has not been reproduced here;
its "Where it bites here" says what a matching symptom would look like. An entry without the mark
was measured here.

## Chromium 442866743 — a worklet's clock stands still while the main thread changes the audio graph

- **Tracker:** [issues.chromium.org/issues/442866743](https://issues.chromium.org/issues/442866743),
  "currentTime and currentFrame sometimes freeze for a render quantum". Filed 2025-09-03, **open**;
  reproduced by Chromium triage on 142–144 and back to M-132. The cause (the render thread moves the
  clock on only when it gets the audio graph lock, which the main thread holds while it connects or
  disconnects nodes, builds a worklet node or a stream source, or disposes nodes — bulk node creation
  stalls it through the garbage collector's dispose, inferred from the source) and a quicker trigger are on the issue as comment 5 (2026-10-01,
  from this repo). SDK side: openDAW#424 (filed 2026-10-01).
- **Symptom:** every `process()` call of some quanta reads the previous quantum's `currentFrame` /
  `currentTime`, or an older one, never a later one, while the main thread connects or disconnects
  nodes or constructs a worklet node. A busy main thread alone does not do it. Chrome only: Firefox
  157 and Safari 18.6 read a true clock under the same probe.
- **Where it bites here:** any worklet that stamps its quanta with `currentFrame`. Both start-of-take
  stamps are taken while a take's nodes are being built, so a raw read is a quantum early on a rare
  repeat: a netted median one quantum above the run's usual, a first-frame check of minus one
  quantum, or both.
- **Workaround:** the SDK's `QuantumClock` (lib-dsp) keeps each processor's frame on a 128-frame
  lattice anchored at the largest `currentFrame − calls·128` read so far, so a stale read is
  corrected at once and a stale first read once a true one arrives; the engine stamps the recording
  start from it and the recording worklet sends its first-quantum time 16 calls late. In this repo
  the node taps and the reference recorder repair their own stamps (`repairFrames` in
  `src/lib/audit/nodeTap.ts`: the clock is only ever behind). A worklet you write must do the same.
- **Evidence:** `debug/2026-10-01-worklet-clock-stale/note.md` (mechanism from Chromium's source,
  three natural events, forced churn); SDK-free probe `worklet-clock-debug-demo.html`; forced with
  `&graphChurn=on` on the recording-alignment harness (48 of 48 rows at 0 / 0 quanta since the
  workaround); natural tally `node scripts/audit/recording-alignment/one-quantum-events.ts`.
- **Last checked:** 2026-10-22 (SDK 0.0.177 sweep: 0 events in 76 repeats, forced 48 / 48). The
  browser is unchanged; re-read the tracker at each SDK upgrade and retire the repairs only on a
  Chrome that reads true under the probe.

## Chromium 571344687 — a worklet processor made right after its module loads reads a stale first clock (watched)

- **Tracker:** [issues.chromium.org/issues/571344687](https://issues.chromium.org/issues/571344687),
  "AudioWorklet: currentTime is stale in the constructor and first process() after slow module loading".
  Filed 2026-10-08, **open**, P2; reproduced by Chromium triage on Linux, Windows and macOS, Chrome 155 to
  Canary 157 and back to M-144 (not a regression). Chrome only: Firefox 157 reads true.
- **Symptom:** in a running context, a processor constructed shortly after `addModule()` resolves reads
  `currentTime` / `currentFrame` in its constructor and first `process()` from about the moment module
  loading STARTED (32–107 ms stale in the report, scaling with the load time); the second `process()`
  jumps to the true frame and advances normally. A processor that seeds a clock from the constructor
  value and counts samples from there keeps the offset for its whole life. The reporter's reading of the
  source: the global scope's frame is a snapshot taken when the worklet object proxy is created and is
  only updated once the worklet thread renders its first quantum.
- **Where it bites here:** every recording's worklet (one `RecordingWorklet` per armed capture per
  recording; loop takes share it) and, on boot, the engine worklet, which is constructed right after its
  `addModule()` resolves and so sits exactly in the issue's window; the recorder's module is loaded once
  at engine install, so a recording's worklet is made long after it. The recording CLAUDE.md's rule
  "anything that loads an AudioWorklet module must have it loaded before the first take: a load still
  running when a take starts delays that take's first frame (117 ms measured)" is the same window. The
  two are not shown to be one mechanism: the harness measured a first frame that ARRIVED late (a true
  delay, a head deficit in the audio with the placement still right), this report a clock read that
  LAGS; a lagging read alone would place a take early, not late.
- **Workaround:** the SDK's `QuantumClock` corrects a stale first read once a true read arrives (the
  anchor is the largest `currentFrame − calls·128` seen), and the recording worklet sends its
  first-quantum time 16 calls late for that reason; the report's own workaround for processor authors is
  the same in spirit (re-read `currentTime` every `process()`, never seed a clock from the constructor).
  In this repo: load worklet modules before the first take; any worklet of ours that stamps from the
  constructor is wrong by this issue.
- **Evidence:** the tracker's repro page (attached there). Here, in
  `debug/2026-09-02-recording-start-alignment/note.md`: the 117.3 ms late first take when the probe's
  recorder module loaded at loopback attach ("The probe's own effect"), a second 117.3 ms first-take
  delay on a witness run that no module load explains, and the cold-start head deficit every standing
  sweep since 0.0.173 has logged on the first recording of a fresh page load (84.4 / 79.0 / 104.4 /
  3523.7 / 94.4 ms) — all "arrived late" readings in the same window, none shown to be this issue.
- **Last checked:** 2026-10-22 (tracker read; not reproduced here).

## Chromium 575891839 — the worklet clock runs at half speed after a back/forward-cache restore (watched)

- **Tracker:** [issues.chromium.org/issues/575891839](https://issues.chromium.org/issues/575891839),
  "AudioWorklet clock slows to ~0.5× after BFCache restoration, causing distorted playback". Filed
  2026-10-21, **open**, unconfirmed; macOS, Chrome 155 and Canary 158; not in Firefox or Safari.
- **Symptom:** a document with a running `AudioContext` and an `AudioWorkletNode`, navigated away from
  and restored from the back/forward cache (`pageshow.persisted: true`), keeps `state: running` and its
  sample rate but advances `currentTime` at about half wall-clock speed; the output is lower-pitched and
  distorted; `suspend()` / `resume()` does not repair it, a reload does. A plain `OscillatorNode` context
  is unaffected. Disappears with `--disable-features=WebAudioBypassOutputBuffering` (the reporter's
  isolation: the synchronous worklet render path across the cache's pause / resume).
- **Where it bites here:** every demo (the engine is a worklet); a user pressing Back and Forward on a
  playing demo. Not measured here: the demos have no `pageshow` / `pagehide` handling, and no sweep
  exercises a back/forward-cache restore.
- **Workaround:** none applied. The option is to handle `pageshow` with `persisted` by tearing the engine
  down or asking for a reload. (A `pagehide` listener does not keep a page out of the cache — it is the
  event cache-compatible pages are told to use; an `unload` listener did, and Chrome is deprecating that;
  `Cache-Control: no-store` is no longer an absolute block in Chrome either.) Decide after measuring.
- **Last checked:** 2026-10-22 (tracker read; not reproduced here).

## Chromium 560233271 — worklet playback stays distorted after an AudioContext suspend / resume cycle (macOS, watched)

- **Tracker:** [issues.chromium.org/issues/560233271](https://issues.chromium.org/issues/560233271),
  "AudioWorklet playback becomes persistently distorted after AudioContext suspend/resume". Filed
  2026-09-11, **open**, P1, assigned, treated upstream as the root-cause tracker for the suspend / resume
  race in the bypass-output-buffering path (issue 528653884 was closed by demoting a CHECK, which turned a
  renderer crash into partial output buffers). Bisected to Chrome 152.0.7949.0; macOS only so far; the
  reporter is BandLab, whose fix was to never suspend.
- **Symptom:** repeated `suspend()` / `resume()` on a running context with a worklet eventually leaves the
  output permanently distorted; only a reload or a new context recovers.
- **Where it bites here:** neither the demos nor the SDK call `suspend()`; `initializeOpenDAW` only
  resumes after a user gesture. The browser's own suspensions (iOS backgrounding, a context created
  suspended under autoplay policy and resumed once) are single cycles. Not observed here.
- **Workaround:** keep it that way — never add a suspend / resume cycle to a demo on macOS Chrome;
  `--disable-features=WebAudioBypassOutputBuffering` for a local check.
- **Last checked:** 2026-10-22 (tracker read).

## Chromium 40103985 — zero-filled 10 ms gaps and duplicated blocks in `getUserMedia` input under underrun (watched)

- **Tracker:** [issues.chromium.org/issues/40103985](https://issues.chromium.org/issues/40103985),
  "Webaudio inserts zero filled parts into buffers supplied by getUserMedia". Filed 2019, **open**, P3,
  "Available"; a Microsoft engineer traced it to `WebAudioMediaStreamAudioSink::ProvideInput` writing
  zeros on a FIFO underrun (2024-12) and prototyped a fix, nothing landed.
- **Symptom:** a captured stream shows 480-sample (10 ms at 48 kHz) zero-filled inserts and, with an
  input and an output device on different clocks (USB in, USB out), 128-frame duplications about once a
  second; the stream's own time then drifts against the context clock. Reported on Windows, macOS and
  Linux; worse on slow machines and under a large graph.
- **Where it bites here:** any recording through a `MediaStreamAudioSourceNode`, the loopback included
  (the sink this issue is about feeds that node). No zero-filled gap or 128-frame duplication has been
  identified in a take here, and every beat of every take matched on 0.0.174 through 0.0.177 (the
  `aligned` verdict requires no missing beat). The loopback HAS shown two capture-side artifacts on the
  same path that could be this mechanism, unestablished: at 44.1 kHz a node's delay stepping UP by
  exactly 441 frames (10 ms) in 6 of 70 opens, 0.4–1.0 s after the node started, never at 48 kHz in 150
  opens, which the register reads as a 10 ms-chunked FIFO path; and a 44.1 kHz stream-start head
  duplicate (the first click copied about 20 ms later at about 65 %, 14 of 30 cells), read as a
  stream-start FIFO or resampler artifact. A real-device recording with a 10 ms hole or a drifting beat
  would be this, not the SDK.
- **Workaround:** none; a `MediaRecorder` capture of the same stream was clean in the reports (not what
  the SDK does). Keep the audio graph small during a take; check `tailMissingMs` and the per-beat errors
  of a real-device take before blaming placement.
- **Evidence:** `debug/2026-09-02-recording-start-alignment/note.md` (the 441-frame step and the
  stream-start duplicate); `src/demos/recording/CLAUDE.md` (the step).
- **Last checked:** 2026-10-22 (tracker read; no gap identified here).

## Chrome — animation frames stop for a hidden document and a fully covered window

- **Tracker:** none; documented behaviour (page visibility, and occlusion on macOS), not a bug.
- **Symptom:** `requestAnimationFrame` stops, so everything the SDK runs on it freezes: the main-thread
  sync (`SyncStream` reads, position and `isPlaying` observables, `RecordAudio` take management).
  The engine keeps rendering on the audio thread; the page just never observes it. A harness deadline
  acting on the frozen view then fails a run that the recorder completed.
- **Where it bites here:** browser-automation runs with an occluded Chrome window; recording demos
  hidden mid-take. `resize_window` does not unhide a fully occluded window.
- **Workaround:** keep the window visible for sweeps; `?frameDriver=hidden-safe` on any demo URL (or
  `initializeOpenDAW`'s `frameDriver` option) pumps the SDK's `AnimationFrame` from a worker tick while
  the document is hidden and the transport is active (`src/lib/hiddenSafeFrameDriver.ts`). The page's
  own `alert()` blocks frames and worker messages alike; nothing helps there, and nothing needs to:
  the take stays intact and finalization waits for the dialog.
- **Evidence:** `debug/2026-10-21-hidden-page-recording/note.md`; page
  `recording-hidden-window-debug-demo.html`.
- **Last checked:** the hidden-page behaviour and the driver on 2026-10-21 (`cover` rows on SDK 0.0.176:
  the window driver's three rows intact, hidden-safe `start` intact, hidden-safe `mid` / `stop` not yet
  measured by hand); the three `modal` rows, which block frames by other means, re-run intact on 0.0.177
  on 2026-10-22.

## Chrome — each `MediaStreamAudioSourceNode` delivers its stream with a delay of its own

- **Tracker:** none; measured behaviour, not reported (a node's delay is set when it starts).
- **Symptom:** two source nodes on the same stream clone, created in one task, are a render quantum
  apart in a third to a half of the pairs; nodes started at different moments differ by up to 12 ms; at
  44.1 kHz a node's delay can step by 441 frames (10 ms) in its first second. Two tapes recorded together
  therefore carry a raw skew of 0 to 4 quanta that is the browser's, not the SDK's.
- **Where it bites here:** the multi-mic recording-alignment rows; any two-input recording.
- **Workaround:** none in the SDK: it cannot see a node's delay, and two takes recorded together sit
  apart on the timeline by the two nodes' delay difference (0 to 4 quanta measured). The harness nets it
  out: it listens to the SDK's own source nodes (`nodeTaps` in
  `src/lib/audit/loopbackInjection.ts`, `measureNodeDelay` in `src/lib/audit/nodeTap.ts`) and judges the
  netted skew; a raw multi-mic skew is never quoted as an SDK finding. A worklet module must be loaded
  before the first take (a load still running delays that take's first frame, 117 ms measured).
- **Evidence:** `debug/2026-09-02-recording-start-alignment/note.md` (stream-tap measurement, repo PRs
  #136 and #138).
- **Last checked:** 2026-10-22 (32 multi-mic rows, raw skew accounted for by the node delays on every repeat).

## A `MediaStreamAudioDestinationNode` stream from another `AudioContext` reads silent when captured

- **Tracker:** none; measured in Chrome, not tried elsewhere.
- **Symptom:** a `getUserMedia` override returning a destination-node stream made in a different
  AudioContext than the engine's gives flat peaks (the oscillator taps fine directly); and a shared
  stream dies for every consumer once one of them calls `track.stop()` (a tape disarm or remove).
- **Where it bites here:** synthetic input for recording tests.
- **Workaround:** build the loopback in the SAME AudioContext the engine captures into (rms 0.0745 on a
  4 s take, 14.9× the threshold) and hand each `getUserMedia` call a `stream.clone()`; see
  `src/lib/audit/loopbackInjection.ts`. The real microphone otherwise.
- **Evidence:** `src/demos/recording/CLAUDE.md`, "Don't Synthesize Input to Verify Recording".
- **Last checked:** 2026-10-22 (every recording-alignment row runs through it).

## Chromium 436552046 / 401692415 — OPFS usage written through sync access handles is not counted, and a delete drives the saved figure negative

- **Tracker:** [issues.chromium.org/issues/436552046](https://issues.chromium.org/issues/436552046)
  "OPFS data cannot be deleted" (filed 2025-08, **open**, P2, assigned) and
  [401692415](https://issues.chromium.org/issues/401692415) "StorageManager::estimate reports high OPFS
  utilization after purging all files" (open). A reporter's deterministic root cause (2026-09-25, Chrome
  154): writes through `FileSystemSyncAccessHandle` never update the persisted per-origin usage
  (`File System/<n>/t/.usage`), `createWritable()` writes do; `removeEntry()` subtracts the file's full
  size, so the saved value goes negative and the next browser start reads it as 2³² + value, about 4 GB
  for an origin that stores nothing. While the browser runs, `estimate()` is right; only the persisted
  value drifts.
- **Symptom here:** `navigator.storage.estimate()` reported 40 MB against 8.7 GB of sample files under
  `samples/v2` — the SDK's OPFS worker writes samples through sync access handles, so they were never
  counted. The inverse, a ~4 GB usage after the page's sample sweep deletes the folder and the browser
  restarts, is predicted by the same cause and has not been looked for here; on a browser with a hard
  per-site quota (Brave: 2 GiB) that reading makes the origin look over quota.
- **Where it bites here:** judging whether the per-page sample sweep works; any storage read-out; a quota
  check before a write.
- **Workaround:** sum the file sizes under `samples/v2` instead; never trust `estimate()` for OPFS. The
  reporter's: truncate a file to 0 through a sync access handle before `removeEntry()`, which keeps the
  saved usage from going negative — the SDK's OPFS worker deletes without truncating (a candidate
  upstream suggestion, not drafted). (`clearStoredSamples()` in `src/lib/storedSamples.ts` also checks
  with `Workers.Opfs.exists` after a delete because `Workers.Opfs.delete` reports nothing when it fails
  — an SDK quirk, not the browser's.)
- **Evidence:** root CLAUDE.md, "Stored Samples Are Swept at Page Load" (repo PR #132); the tracker's
  repro page for the cause.
- **Last checked:** 2026-10-22 (tracker read; the negative-usage half not reproduced here).

## Chromium OPFS, watched: slow `flush()` on Mac, and a quota overrun that returns a sentinel

- **Trackers:** [40909520](https://issues.chromium.org/issues/40909520)
  "FileSystemSyncAccessHandle.flush() is very slow on Mac compared with other browsers" (open, P2,
  2024); [541725401](https://issues.chromium.org/issues/541725401) "FileSystemSyncAccessHandle.write()
  returns error sentinel instead of throwing QuotaExceededError" and [40068799](https://issues.chromium.org/issues/40068799)
  (the same in incognito, `0xfffffff8`) (open, P2).
- **Where they would bite here:** the SDK's OPFS worker writes every fetched sample and every finished
  recording through sync access handles; a flush held for more than five seconds is reported by the worker as a hold at step `write`
  (`[OPFS] … runs for <n>s at 'write'`; truncate, write and flush share the step), a slower-than-usual
  flush under that stays silent, and a quota overrun on a long recording would come back as a short write count,
  not an exception. Neither observed here.
- **Last checked:** 2026-10-22 (titles read only).

## Safari — `decodeAudioData` does not decode Ogg Opus, and iOS re-suspends the AudioContext

- **Tracker:** none filed from here; long-standing WebKit behaviour.
- **Symptom:** `canPlayType("audio/ogg; codecs=opus")` answers "maybe", the decode fails. On iOS the
  context can go back to `suspended` after backgrounding or locking, and is not `running` right after
  `resume()` resolves.
- **Where it bites here:** every demo that loads the bundled tracks; playback after a lock.
- **Workaround:** `getAudioExtension()` in `src/lib/audioUtils.ts` picks m4a (AAC) on Apple devices by
  user-agent, not by feature detection; before `play()` check `audioContext.state` and wait for the
  `statechange` event (root CLAUDE.md, "AudioContext Suspension").
- **Last checked:** never re-measured; the Opus fallback is exercised on every Apple load.

## Chromium 516995393 — no input-latency figure in the Web Audio API (a spec gap)

- **Tracker:** [issues.chromium.org/issues/516995393](https://issues.chromium.org/issues/516995393),
  "Web Audio API input latency reporting - audio recording latency compensation in DAW app". Filed
  2026-05-27 by a browser-DAW developer with openDAW as the example, P2, **status External Dependency**:
  Chromium's answer (2026-05-28) is that the API has three output-latency measures (`baseLatency`,
  `outputLatency`, `AudioPlaybackStats`) and none for input, that Media Capture and Streams lets a page
  request a latency range but not read the actual one back, and that it needs specification work first.
- **Where it bites here:** the whole recording start-alignment campaign (`debug/2026-09-02-recording-
  start-alignment/note.md`): a take is placed by `outputLatency` plus a guessed input latency, so a real
  device records late by its own input delay (tens of ms, device-dependent) unless calibrated.
- **Workaround:** the SDK's `recording.inputLatency` preference and per-capture `captureBox.inputLatency`
  (`InputLatency.EqualsOutput` doubles the compensation), and the loopback calibration on the upstream
  calibration branch (openDAW PR #380, unreleased; this repo's `input-latency-calibration-debug-demo.html`
  measures it). The browser's own `MediaStreamTrack.getSettings().latency` is nominal: 2.67 ms reported
  against 35–63 ms measured on the built-in microphone.
- **Last checked:** 2026-10-22 (tracker read).

## Chromium 388871416 — `outputLatency` and a Bluetooth headset (watched, low)

- **Tracker:** [issues.chromium.org/issues/388871416](https://issues.chromium.org/issues/388871416).
  Filed 2025-01 against Chrome Dev 133 on macOS with AirPods (`outputLatency` 33 ms on the speaker,
  17 ms on the headset); Chromium triage on M142 through M144 (2025-11) reads 200+ ms on the headset with
  or without the output-buffering flag, so current builds report it. Open, needs feedback.
- **Where it would bite here:** take placement nets `outputLatency`; a Bluetooth output that reported
  17 ms instead of 200 ms would place every take about 180 ms early. Not measured here (no Bluetooth
  device in any sweep); on a Bluetooth recording session, read `audioContext.outputLatency` first.
- **Last checked:** 2026-10-22 (tracker read).

## Chrome and Edge only — `AudioContext.setSinkId`

- **Tracker:** none; a feature gap in Firefox and Safari.
- **Symptom:** output-device routing is unavailable; `AudioDevices` handles inputs only.
- **Workaround:** gate on `"setSinkId" in AudioContext.prototype`; enumerate outputs through
  `navigator.mediaDevices.enumerateDevices()` filtering `kind === "audiooutput"` (root CLAUDE.md,
  "Output Device Enumeration"; `src/lib/audioUtils.ts`).

## Firefox — graph calls queue on the render thread, which renders late under churn

- **Tracker:** none filed; measured on Firefox 157.
- **Symptom:** a stretch of about 21 000 connect / disconnect pairs in 8 ms left the context rendering
  2.98 s of audio in 5.01 s; creating about 12 000 gain nodes in a stretch rendered 0.48 s in 5 s, then
  nothing, and contexts made afterwards in the same browser did not resume until it was restarted. At
  1000 pairs or 50 nodes a stretch it keeps real time. No `currentFrame` repeated or skipped in any of it.
- **Where it bites here:** the worklet-clock probe's dose; any stress test that churns the graph.
- **Workaround:** the probe caps its dose (`MAX_CONNECTS_PER_STRETCH`) and runs bulk node creation only
  on request (`?conditions=create`); a Firefox that stops rendering under it needs a restart.
- **Evidence:** `debug/2026-10-01-worklet-clock-stale/note.md`, "Firefox, and the probe's dose".
- **Last checked:** 2026-10-01.

## Cloudflare Pages — `NODE_VERSION=<major>` resolves to the build image's default, not the newest release

- **Tracker:** none; observed in the build logs of this project.
- **Symptom:** with `NODE_VERSION=24` the build installed Node 24.13.1 on 2026-10-22, nine minor releases
  behind the security release of the day before (v24.22.1), with four `EBADENGINE` warnings from jsdom 30
  and its dependencies. The image updates node-build at the start of each build, and node-build can lag
  a Node release by a day: v24.22.1 was absent on 2026-10-21 (the reason the override was set, repo PR
  #164 having pinned `.nvmrc` to it) and present on 2026-10-22.
- **Where it bites here:** the deploy's Node is the override's, so a `.nvmrc` bump changes nothing while
  the variable is set; Node runs at build time only (tsc, vite, vitepress), nothing of it is deployed.
- **Workaround:** pin `.nvmrc` to the exact release and leave `NODE_VERSION` unset in both environments;
  when a build fails right after a `.nvmrc` bump because node-build lacks the version, wait a day or set
  `NODE_VERSION` to the exact version, never to a bare major, and remove it again. Verify in the build log
  ("Installing nodejs <version>").
- **Status:** `NODE_VERSION=24` is still set in Production and Preview; delete it in both to let
  `.nvmrc` drive the deploy.
- **Last checked:** 2026-10-22 (the override still set, the build on 24.13.1).

## TypeScript — DOM lib without `FileSystemSyncAccessHandle` and `AudioPlaybackStats`

- **Tracker:** none; the SDK's declaration files name DOM types the TypeScript lib does not have, and
  this repo checks declaration files (`skipLibCheck` off).
- **Workaround:** `types/sdk-dom-gaps.d.ts` declares the missing names, empty; add a name there when an
  SDK upgrade brings a new error of that kind (root CLAUDE.md, "Build & Verification").
- **Last checked:** 2026-10-22 (SDK 0.0.177, no new gap).
