# Known vendor issues to work around

A register of browser, platform and hosting behaviours outside the SDK that this repo has
measured and works around. Read it before debugging a symptom that matches one: a listed
behaviour is not a new finding, and each entry says where its workaround lives, or what is
still to do.
It is a register, so it carries versions and dates; the chapter docs and CLAUDE.md state the
present only. Add an entry when a vendor behaviour costs a session; retire it (keep the row,
mark it fixed, name the version) when the vendor ships a fix and a re-measurement confirms it.

Each entry: the tracker and its status, the symptom, where it shows up here, the workaround and
where it lives, the evidence, and when it was last checked. Every vendor section keeps two kinds
apart: **Measured here** — behaviours reproduced in this repo, each with its workaround in place,
which a matching sweep cell is read against instead of filed — and **Watched** — open upstream
issues read from the tracker and never reproduced here, whose "Where it bites here" says what a
matching symptom would look like. A watched entry is a candidate, not an attribution: reproduce
first (an SDK regression can look the same), and move the entry up only on a measurement.

Grouped by vendor: Chromium (Chrome, Edge, Brave), Firefox, WebKit (Safari, iOS, WKWebView), then the gaps that
span them, then the hosting and tooling entries. The three browser sections were swept from their trackers on
2026-10-22 (`node .claude/skills/sdk-upgrade/scripts/bugzilla.cjs <host> search|read …` for the two Bugzillas; the
Chromium tracker through the browser).

# Chromium

## Measured here

### Chromium [442866743](https://issues.chromium.org/issues/442866743) — a worklet's clock stands still while the main thread changes the audio graph

- **Tracker:** [issues.chromium.org/issues/442866743](https://issues.chromium.org/issues/442866743),
  "currentTime and currentFrame sometimes freeze for a render quantum". Filed 2025-09-03, **open**;
  reproduced by Chromium triage on 142–144 and back to M-132. The cause (the render thread moves the
  clock on only when it gets the audio graph lock, which the main thread holds while it connects or
  disconnects nodes, builds a worklet node or a stream source, or disposes nodes — bulk node creation
  stalls it through the garbage collector's dispose, inferred from the source) and a quicker trigger are on the issue as comment 5 (2026-10-01,
  from this repo). SDK side: [openDAW#424](https://github.com/andremichelle/openDAW/issues/424) (filed 2026-10-01).
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

### Chrome — animation frames stop for a hidden document and a fully covered window

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

### Chrome — each `MediaStreamAudioSourceNode` delivers its stream with a delay of its own

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
- **Evidence:** `debug/2026-09-02-recording-start-alignment/note.md` (stream-tap measurement, repo PRs [#136](https://github.com/naomiaro/opendaw-test/pull/136) and [#138](https://github.com/naomiaro/opendaw-test/pull/138)).
- **Last checked:** 2026-10-22 (32 multi-mic rows, raw skew accounted for by the node delays on every repeat).

### A `MediaStreamAudioDestinationNode` stream from another `AudioContext` reads silent when captured

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

### Chromium [436552046](https://issues.chromium.org/issues/436552046) / [401692415](https://issues.chromium.org/issues/401692415) — OPFS usage written through sync access handles is not counted, and a delete drives the saved figure negative

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
- **Evidence:** root CLAUDE.md, "Stored Samples Are Swept at Page Load" ([repo PR #132](https://github.com/naomiaro/opendaw-test/pull/132)); the tracker's
  repro page for the cause.
- **Last checked:** 2026-10-22 (tracker read; the negative-usage half not reproduced here).

### Chromium [516995393](https://issues.chromium.org/issues/516995393) — no input-latency figure in the Web Audio API (a spec gap)

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
  calibration branch ([openDAW PR #380](https://github.com/andremichelle/openDAW/pull/380), unreleased; this repo's `input-latency-calibration-debug-demo.html`
  measures it). The browser's own `MediaStreamTrack.getSettings().latency` is nominal: 2.67 ms reported
  against 35–63 ms measured on the built-in microphone.
- **Last checked:** 2026-10-22 (tracker read).

## Watched — read from the tracker, not reproduced here

### Chromium [571344687](https://issues.chromium.org/issues/571344687) — a worklet processor made right after its module loads reads a stale first clock

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

### Chromium [575891839](https://issues.chromium.org/issues/575891839) — the worklet clock runs at half speed after a back/forward-cache restore

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

### Chromium [560233271](https://issues.chromium.org/issues/560233271) — worklet playback stays distorted after an AudioContext suspend / resume cycle

- **Tracker:** [issues.chromium.org/issues/560233271](https://issues.chromium.org/issues/560233271),
  "AudioWorklet playback becomes persistently distorted after AudioContext suspend/resume". Filed
  2026-09-11, **open**, P1, assigned, treated upstream as the root-cause tracker for the suspend / resume
  race in the bypass-output-buffering path ([issue 528653884](https://issues.chromium.org/issues/528653884) was closed by demoting a CHECK, which turned a
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

### Chromium [40103985](https://issues.chromium.org/issues/40103985) — zero-filled 10 ms gaps and duplicated blocks in `getUserMedia` input under underrun

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
  is a candidate for this issue — reproduce and attribute before concluding, since an SDK ring-buffer
  regression would look the same.
- **Workaround:** none; a `MediaRecorder` capture of the same stream was clean in the reports (not what
  the SDK does). Keep the audio graph small during a take; check `tailMissingMs` and the per-beat errors
  of a real-device take before blaming placement.
- **Evidence:** `debug/2026-09-02-recording-start-alignment/note.md` (the 441-frame step and the
  stream-start duplicate); `src/demos/recording/CLAUDE.md` (the step).
- **Last checked:** 2026-10-22 (tracker read; no gap identified here).

### Chromium [40909520](https://issues.chromium.org/issues/40909520) / [541725401](https://issues.chromium.org/issues/541725401) / [40068799](https://issues.chromium.org/issues/40068799) — OPFS: slow `flush()` on Mac, and a quota overrun that returns a sentinel

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

### Chromium [388871416](https://issues.chromium.org/issues/388871416) — `outputLatency` and a Bluetooth headset

- **Tracker:** [issues.chromium.org/issues/388871416](https://issues.chromium.org/issues/388871416).
  Filed 2025-01 against Chrome Dev 133 on macOS with AirPods (`outputLatency` 33 ms on the speaker,
  17 ms on the headset); Chromium triage on M142 through M144 (2025-11) reads 200+ ms on the headset with
  or without the output-buffering flag, so current builds report it. Open, needs feedback.
- **Where it would bite here:** take placement nets `outputLatency`; a Bluetooth output that reported
  17 ms instead of 200 ms would place every take about 180 ms early. Not measured here (no Bluetooth
  device in any sweep); on a Bluetooth recording session, read `audioContext.outputLatency` first.
- **Last checked:** 2026-10-22 (tracker read).

# Firefox

## Measured here

### Firefox — graph calls queue on the render thread, which renders late under churn

- **Trackers:** the cost is known upstream as a family of quadratic graph operations: [1945316](https://bugzilla.mozilla.org/show_bug.cgi?id=1945316)
  "N sine waves spends infinite time in GraphRunner" (reopened, P3; the 2026-10-16 analysis: `AudioNode::Connect`
  scans every input of the destination, so one context with many nodes into one destination is quadratic),
  [2044891](https://bugzilla.mozilla.org/show_bug.cgi?id=2044891) "disconnecting the graph 24× slower than Chrome", [2044952](https://bugzilla.mozilla.org/show_bug.cgi?id=2044952) "suspending N nodes is quadratic",
  [2044896](https://bugzilla.mozilla.org/show_bug.cgi?id=2044896) "1 node and N automation events 1800× slower, quadratic in events" — all open, with work-in-progress
  patches moved under [1945316](https://bugzilla.mozilla.org/show_bug.cgi?id=1945316) (2026-10-04). The late rendering under churn measured here is not reported as such.
- **Symptom:** a stretch of about 21 000 connect / disconnect pairs in 8 ms left the context rendering
  2.98 s of audio in 5.01 s; creating about 12 000 gain nodes in a stretch rendered 0.48 s in 5 s, then
  nothing, and contexts made afterwards in the same browser did not resume until it was restarted. At
  1000 pairs or 50 nodes a stretch it keeps real time. No `currentFrame` repeated or skipped in any of it.
- **Where it bites here:** the worklet-clock probe's dose; any stress test that churns the graph.
- **Workaround:** the probe caps its dose (`MAX_CONNECTS_PER_STRETCH`) and runs bulk node creation only
  on request (`?conditions=create`); a Firefox that stops rendering under it needs a restart.
- **Evidence:** `debug/2026-10-01-worklet-clock-stale/note.md`, "Firefox, and the probe's dose".
- **Last checked:** 2026-10-22 (trackers read; the churn figures measured 2026-10-01).

## Watched — read from the tracker, not reproduced here

### Firefox [1629478](https://bugzilla.mozilla.org/show_bug.cgi?id=1629478) — `inputs[0]` is empty for the first process() calls until the source is actively processing (by spec)

- **Tracker:** [bugzilla 1629478](https://bugzilla.mozilla.org/show_bug.cgi?id=1629478), unconfirmed, P5, 2020; the answer on it is the spec: `inputs[n]` is an
  empty array while no actively-processing node feeds input n, and a media or stream source is not actively
  processing until it delivers. Up to about 70 empty calls were seen before a `MediaStreamAudioSourceNode` delivered.
- **Where it bites here:** the recording worklet: a stamp taken on the first `process()` call would predate the input.
- **Workaround:** in place in the SDK — `RecordingProcessor` records its first-quantum call only once `inputs[0]`
  carries the expected channel count, and stamps from there (read on the 0.0.177 tag; the empty calls themselves
  were not counted here). A worklet of ours that reads input must do the same.
- **Last checked:** 2026-10-22 (tracker read).

### Firefox [2070740](https://bugzilla.mozilla.org/show_bug.cgi?id=2070740) — suspend / resume / close promise settlement can get out of order

- **Tracker:** [bugzilla 2070740](https://bugzilla.mozilla.org/show_bug.cgi?id=2070740), new, S3, 2026-09: a main-thread short circuit added for "closed before
  resume completed" rejections can settle out of order with the graph thread's suspend and close; the spec does not say
  whether a pending resume promise resolves or rejects when a later suspend or close overrides it.
- **Where it bites here:** `initializeOpenDAW` awaits `resume()` before the first `play()`; nothing here suspends or
  closes a context after that, so the race needs a close during a pending resume to show.
- **Last checked:** 2026-10-22 (tracker read).

### Firefox OPFS — [2076609](https://bugzilla.mozilla.org/show_bug.cgi?id=2076609), [2072928](https://bugzilla.mozilla.org/show_bug.cgi?id=2072928), [2072923](https://bugzilla.mozilla.org/show_bug.cgi?id=2072923), [2060133](https://bugzilla.mozilla.org/show_bug.cgi?id=2060133)

- **Trackers:** [2076609](https://bugzilla.mozilla.org/show_bug.cgi?id=2076609) every `createSyncAccessHandle()` in an origin fails with `UnknownError` after an
  unclean shutdown while a handle was open (Firefox 156, a syntactically invalid SQL statement in the usage tracking;
  only clearing site data recovers); [2072928](https://bugzilla.mozilla.org/show_bug.cgi?id=2072928) creating, opening, closing and deleting a file costs about
  21 fsyncs, about 75 ms per file on Linux against 0.6 ms in Chromium, and [2072923](https://bugzilla.mozilla.org/show_bug.cgi?id=2072923) `write()` costs
  30–37 µs per call regardless of size; [2060133](https://bugzilla.mozilla.org/show_bug.cgi?id=2060133) `write()` past the quota does not throw
  `QuotaExceededError` (the same shape as Chromium's sentinel return).
- **Where they would bite here:** the SDK's OPFS worker writes every fetched sample and every finished recording
  through sync access handles, one file per sample, and the page sweep deletes the folder on load: a Firefox profile
  that crashed mid-recording would refuse every sample write until its site data is cleared, and a sample library of
  many files loads and sweeps slowly. None measured here (the sweeps run in Chrome).
- **Last checked:** 2026-10-22 (titles and descriptions read).

### Firefox [2034508](https://bugzilla.mozilla.org/show_bug.cgi?id=2034508) — `renderQuantumSize` not implemented

- **Tracker:** [bugzilla 2034508](https://bugzilla.mozilla.org/show_bug.cgi?id=2034508), new, 2026-04. The engine assumes the 128-frame quantum everywhere;
  a context constructed with another `renderSizeHint` is not something this repo does, so the gap is harmless here.
- **Last checked:** 2026-10-22.

# WebKit

## Measured here

### Safari — `decodeAudioData` does not decode Ogg Opus, and iOS re-suspends the AudioContext

- **Trackers:** Opus: [327697](https://bugs.webkit.org/show_bug.cgi?id=327697) "decodeAudioData refuses Opus WebM in every mapping family but 0" (new, 2026-10,
  Safari 27; the Ogg Opus case this repo hit is older and unfiled). The iOS suspension family: [281566](https://bugs.webkit.org/show_bug.cgi?id=281566)
  "`AudioContext.resume()` never resolves if the browser is suspended to background" (2024, open; the workaround on it
  is a `suspend()` then `resume()` from a user gesture), with [202846](https://bugs.webkit.org/show_bug.cgi?id=202846) (stops on `visibilitychange`), [263627](https://bugs.webkit.org/show_bug.cgi?id=263627)
  (not consistently resumed on foreground), [274954](https://bugs.webkit.org/show_bug.cgi?id=274954), [276016](https://bugs.webkit.org/show_bug.cgi?id=276016), [240646](https://bugs.webkit.org/show_bug.cgi?id=240646) (WKWebView), [206695](https://bugs.webkit.org/show_bug.cgi?id=206695) (the
  `interrupted` state is not a valid `AudioContextState`), [232640](https://bugs.webkit.org/show_bug.cgi?id=232640) (stops when wired headphones are unplugged);
  [291892](https://bugs.webkit.org/show_bug.cgi?id=291892) "silent after a PWA returns from background even after resume" (a reporter saw it fixed on iOS 26.2 beta
  3, the bug stays open).
- **Symptom:** `canPlayType("audio/ogg; codecs=opus")` answers "maybe", the decode fails. On iOS the
  context can go back to `suspended` after backgrounding or locking, and is not `running` right after
  `resume()` resolves.
- **Where it bites here:** every demo that loads the bundled tracks; playback after a lock.
- **Workaround:** `getAudioExtension()` in `src/lib/audioUtils.ts` picks m4a (AAC) on Apple devices by
  user-agent, not by feature detection; before `play()` check `audioContext.state` and wait for the
  `statechange` event (root CLAUDE.md, "AudioContext Suspension").
- **Last checked:** 2026-10-22 (trackers read); never re-measured here, the Opus fallback is exercised on every Apple load.

## Watched — read from the tracker, not reproduced here

### WebKit [256023](https://bugs.webkit.org/show_bug.cgi?id=256023) — a worklet's thread and heap outlive the page, so reloads leak until `WebAssembly.Memory` fails

- **Tracker:** [bugs.webkit.org 256023](https://bugs.webkit.org/show_bug.cgi?id=256023), new, P2, 2023; re-confirmed 2026-10-20 on the iOS 27 simulator
  with an analysis that it is not Wasm-specific: an AudioWorklet's thread and heap outlive the page, so whatever the
  processor references (a `WebAssembly.Memory`, a `SharedArrayBuffer`) stays resident after each reload, and even an
  empty processor leaks its thread; the eighth load of a page with a 256 MB memory in its processor fails with
  "Out of memory". Pull request 77672 open (2026-10-20). See also [272813](https://bugs.webkit.org/show_bug.cgi?id=272813).
- **Where it bites here:** the engine runs in a worklet with its Wasm memory; a demo reloaded many times in one Safari
  tab would eventually fail to boot. Not measured here (the reload cases measured so far are Chrome's).
- **Workaround:** none in the SDK; open the page in a new tab instead of reloading, until the fix ships.
- **Last checked:** 2026-10-22 (tracker read).

### WebKit [327552](https://bugs.webkit.org/show_bug.cgi?id=327552) — previously played audio is heard when resuming a context that has a worklet

- **Tracker:** [bugs.webkit.org 327552](https://bugs.webkit.org/show_bug.cgi?id=327552), new, 2026-10-14, macOS 26 nightly: after `suspend()` then
  `resume()` a stretch of the pre-suspend audio plays, the worklet's `process()` is then called rapidly as the clock
  catches up, and the audio clock has a discontinuity; Chromium resumes smoothly. Pull request 77683 open.
- **Where it bites here:** nothing here suspends a context; the browser's own iOS suspension and resume would.
- **Last checked:** 2026-10-22 (tracker read).

### WebKit [327275](https://bugs.webkit.org/show_bug.cgi?id=327275) — a background tab holding a Web Audio context glitches audio system-wide (macOS 27)

- **Tracker:** [bugs.webkit.org 327275](https://bugs.webkit.org/show_bug.cgi?id=327275), new, 2026-10-12, Safari 27 on macOS 27: the GPU process serves
  CoreAudio a 128-frame IO cycle (2.7 ms); once Safari is not frontmost, RunningBoard demotes that process to
  background priority, the HAL thread misses its deadline under moderate load, and every app on the machine clicks.
- **Where it bites here:** any demo left open in a background Safari tab; the hidden-page cases measured here are
  Chrome's. Related: [328063](https://bugs.webkit.org/show_bug.cgi?id=328063) "fade in RemoteAudioDestination output after a ring buffer underrun" (pull request
  77508: WebKit fades to silence on an underrun and currently comes back with a step), [319504](https://bugs.webkit.org/show_bug.cgi?id=319504) "click or pop on
  AudioContext initialization after a page reload" (Safari 26, not in Chrome), [325501](https://bugs.webkit.org/show_bug.cgi?id=325501) "[iOS] output permanently
  distorted after switching the route to AirPlay" (iOS 26.7, only a new context recovers).
- **Last checked:** 2026-10-22 (trackers read).

### WebKit [326286](https://bugs.webkit.org/show_bug.cgi?id=326286) — iOS 26.2 to 27: output crackles while an echo-cancelled microphone capture is open

- **Tracker:** [bugs.webkit.org 326286](https://bugs.webkit.org/show_bug.cgi?id=326286), new, P2 Major, 2026-10-04, re-confirmed on iPhone 16 Pro / iOS
  27.0.1 in Safari and a WKWebView app: any audio the page plays while a `getUserMedia` stream with
  `echoCancellation: true` is open crackles; with echo cancellation off the output is clean but moves to the receiver
  at low volume; `applyConstraints` to false reads back false and changes nothing.
- **Where it bites here:** recording on an iPhone with monitoring: the capture's stream opens with the browser's
  default constraints. Not measured here (no iOS device in any sweep). With it: [211959](https://bugs.webkit.org/show_bug.cgi?id=211959) "all Web Audio output
  mono after capturing the microphone" (iOS, 2020, open), [210231](https://bugs.webkit.org/show_bug.cgi?id=210231) "no stereo `getUserMedia`, no `channelCount`
  constraint" (open; a request for two channels gets the left channel only — the demos' stereo capture is Chrome-only
  in practice), [283037](https://bugs.webkit.org/show_bug.cgi?id=283037) "Web Audio while recording does not use Bluetooth headphones" (iOS 17).
- **Last checked:** 2026-10-22 (trackers read).

### WebKit OPFS and workers — [326901](https://bugs.webkit.org/show_bug.cgi?id=326901) / [326345](https://bugs.webkit.org/show_bug.cgi?id=326345), [293955](https://bugs.webkit.org/show_bug.cgi?id=293955), [279739](https://bugs.webkit.org/show_bug.cgi?id=279739)

- **Trackers:** [326901](https://bugs.webkit.org/show_bug.cgi?id=326901) "worker storage and network operations complete only when the main thread of the
  page runs" and [326345](https://bugs.webkit.org/show_bug.cgi?id=326345) "dedicated-worker fetch and OPFS operations wait for the page main thread to
  become idle" (Safari 27, 2026-10; Chromium and Firefox complete them during a main-thread block); [293955](https://bugs.webkit.org/show_bug.cgi?id=293955)
  "increase the `FileSystemSyncAccessHandle` per-origin limit beyond 256" (open handles fail past about 252; Chromium
  and Firefox allow thousands); [279739](https://bugs.webkit.org/show_bug.cgi?id=279739) "OPFS can deadlock the browser and inspector" (P2 Critical, 2024,
  Emscripten users reproduce it); plus [327929](https://bugs.webkit.org/show_bug.cgi?id=327929), [326347](https://bugs.webkit.org/show_bug.cgi?id=326347), [326135](https://bugs.webkit.org/show_bug.cgi?id=326135) (`InvalidStateError` where a disk-full,
  lock or no-such-file error is meant).
- **Where they would bite here:** the SDK's OPFS worker is a dedicated worker; on Safari its sample writes and the
  page sweep wait on the page's main thread, which is exactly what a long synchronous task or a blocked frame driver
  stalls — the "[OPFS] … runs for <n>s" warnings could fire for the browser's reason; tell the two apart
  (a blocked main thread on Safari, a slow write anywhere) before attributing. A sample library
  with more than about 250 handles open at once cannot exist on Safari. None measured here.
- **Last checked:** 2026-10-22 (descriptions read).

### WebKit [328462](https://bugs.webkit.org/show_bug.cgi?id=328462) — "Enhanced Security" disables `SharedArrayBuffer`

- **Tracker:** [bugs.webkit.org 328462](https://bugs.webkit.org/show_bug.cgi?id=328462), new, 2026-10-22, pull request 77899 open: Safari's Enhanced
  Security setting switches `SharedArrayBuffer` off. The SDK needs it for the engine's sync stream, the recording ring
  buffer and the engine state (the pages are cross-origin isolated for that reason). With it [327924](https://bugs.webkit.org/show_bug.cgi?id=327924) "[iPadOS]
  cross-origin isolation parity with macOS" (COEP credentialless, reporting why isolation failed).
- **Where it bites here:** every demo on a Safari with the setting on would fail at `Workers.install`; not measured.
- **Last checked:** 2026-10-22 (tracker read).

# Across vendors

- **`AudioContext.setSinkId` is Chrome and Edge only.** Firefox: [1942786](https://bugzilla.mozilla.org/show_bug.cgi?id=1942786) (unconfirmed, 2025); WebKit: [280303](https://bugs.webkit.org/show_bug.cgi?id=280303)
  (open, 2026-09). Gate on `"setSinkId" in AudioContext.prototype`; enumerate outputs through
  `navigator.mediaDevices.enumerateDevices()` filtering `kind === "audiooutput"` (root CLAUDE.md, "Output Device
  Enumeration"; `src/lib/audioUtils.ts`); `AudioDevices` handles inputs only.
- **No `performance.now()` in `AudioWorkletGlobalScope`** — agreed at TPAC 2025
  ([web-audio-api#2413](https://github.com/WebAudio/web-audio-api/issues/2413)), filed with every engine: Chromium
  [392542574](https://issues.chromium.org/issues/392542574) (P1, in progress), Firefox [2001624](https://bugzilla.mozilla.org/show_bug.cgi?id=2001624) (patch in progress), WebKit [326586](https://bugs.webkit.org/show_bug.cgi?id=326586). The
  SDK's DSP-load meter exists in its spinning-worker form because of this gap
  (`documentation/internals/03-cross-thread-protocols.md`); once the API lands everywhere the worker can go.
- **No input-latency figure** — Chromium [516995393](https://issues.chromium.org/issues/516995393) above; the other engines have none either.

# Hosting and tooling

## Measured here

### Cloudflare Pages — `NODE_VERSION=<major>` resolves to the build image's default, not the newest release

- **Tracker:** none; observed in the build logs of this project.
- **Symptom:** with `NODE_VERSION=24` the build installed Node 24.13.1 on 2026-10-22, nine minor releases
  behind the security release of the day before (v24.22.1), with four `EBADENGINE` warnings from jsdom 30
  and its dependencies. The image updates node-build at the start of each build, and node-build can lag
  a Node release by a day: v24.22.1 was absent on 2026-10-21 (the reason the override was set, [repo PR #164](https://github.com/naomiaro/opendaw-test/pull/164) having pinned `.nvmrc` to it) and present on 2026-10-22.
- **Where it bites here:** the deploy's Node is the override's, so a `.nvmrc` bump changes nothing while
  the variable is set; Node runs at build time only (tsc, vite, vitepress), nothing of it is deployed.
- **Workaround:** pin `.nvmrc` to the exact release and leave `NODE_VERSION` unset in both environments;
  when a build fails right after a `.nvmrc` bump because node-build lacks the version, wait a day or set
  `NODE_VERSION` to the exact version, never to a bare major, and remove it again. Verify in the build log
  ("Installing nodejs <version>").
- **Status:** `NODE_VERSION=24` is still set in Production and Preview; delete it in both to let
  `.nvmrc` drive the deploy.
- **Last checked:** 2026-10-22 (the override still set, the build on 24.13.1).

### TypeScript — DOM lib without `FileSystemSyncAccessHandle` and `AudioPlaybackStats`

- **Tracker:** none; the SDK's declaration files name DOM types the TypeScript lib does not have, and
  this repo checks declaration files (`skipLibCheck` off).
- **Workaround:** `types/sdk-dom-gaps.d.ts` declares the missing names, empty; add a name there when an
  SDK upgrade brings a new error of that kind (root CLAUDE.md, "Build & Verification").
- **Last checked:** 2026-10-22 (SDK 0.0.177, no new gap).
