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
  counted. The inverse is measured too, in the user's Chrome across a full quit and reopen: after a
  64 MiB file written through a sync handle was deleted with a plain `removeEntry()`, the next start read
  the origin as 4 278 445 047 bytes, 2³² + a saved figure of −16 522 249. That is about +50.6 MB before
  the delete if the delete took the full 64 MiB, as the off-disk reading below and round 2 show. A truncate-first run and a second restart moved the saved figure by
  −238 137 857 against −238 135 417 predicted for the 238 MB of demo samples deleted by hand in between,
  so the truncated delete subtracted nothing. In-session `estimate()` follows the write and the delete
  (`COUNTED`, +67 109 044 for 67 108 864 bytes). The saved per-origin file read off disk in Playwright's
  Chrome dropped by exactly 67 108 864 on a plain delete and by 0 on a truncate-first one; that
  profile's `localhost:5173` figure stood at about −22.7 GB, read as 3.89 GB with no file stored. On a
  browser with a hard per-site quota (Brave: 2 GiB) such a reading makes the origin look over quota.
- **Where it bites here:** judging whether the per-page sample sweep works; any storage read-out; a quota
  check before a write.
- **Workaround:** sum the file sizes under `samples/v2` instead; never trust `estimate()` for OPFS. The
  reporter's: truncate a file to 0 through a sync access handle before `removeEntry()`, which keeps the
  saved usage from going negative, confirmed here on the saved figure across a restart. The SDK's OPFS
  worker writes through sync access handles (`createSyncAccessHandle`,
  `node_modules/@opendaw/lib-fusion/dist/opfs/OpfsWorker.js:158`) and deletes without truncating
  (`removeEntry` at `:81`, `:108`, `:111`), so the demos' page-load sweep lowers the saved figure by
  every sample it removes: a candidate upstream suggestion, not drafted. (`clearStoredSamples()` in `src/lib/storedSamples.ts` also checks
  with `Workers.Opfs.exists` after a delete because `Workers.Opfs.delete` reports nothing when it fails
  — an SDK quirk, not the browser's.)
- **Evidence:** root CLAUDE.md, "Stored Samples Are Swept at Page Load" ([repo PR #132](https://github.com/naomiaro/opendaw-test/pull/132));
  `debug/2026-10-23-chromium-watched-issues/note.md`, "opfs-usage"; probe
  `chromium-watched-issues-debug-demo.html?issue=opfs-usage` (`&truncateFirst=1`), restart envelopes
  `chromium-opfs-usage-mvk4oyf2-4spf.json` (plain; uploaded before the decode, its figures re-judged
  `NEGATIVE USAGE`, pinned by the Node test) and `chromium-opfs-usage-mvk4zzeo-oolp.json`
  (truncate-first), in-session runs `mvk4ksbd-jmyd`, `mvk4yy1c-cddi`, `mvk3l4wh-mr7j`, `mvk3ldkp-0zna`.
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22: `NEGATIVE USAGE` after a restart of
  the user's Chrome, probe `?issue=opfs-usage`; the truncate-first workaround confirmed on the saved
  figure across a second restart.

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

### Chromium [571344687](https://issues.chromium.org/issues/571344687) — a worklet processor made right after its module loads reads a stale first clock

- **Tracker:** [issues.chromium.org/issues/571344687](https://issues.chromium.org/issues/571344687),
  "AudioWorklet: currentTime is stale in the constructor and first process() after slow module loading".
  Filed 2026-10-08, **open**, P2; reproduced by Chromium triage on Linux, Windows and macOS, Chrome 155 to
  Canary 157 and back to M-144 (not a regression). Chrome only: Firefox 157 reads true. The reporter's
  reading of the source: the global scope's frame is a snapshot taken when the worklet object proxy is
  created and is only updated once the worklet thread renders its first quantum.
- **Symptom here:** in a running context, a processor built right after `addModule()` resolves reads the
  same frame in its constructor and its first `process()`: the frame the clock stood at when the first
  `addModule()` STARTED. The second `process()` reads the node's creation frame plus 128, and the clock is
  true from then on. The lag tracks the load time: at most 5.8 ms with no extra module (the probe's own
  module is the context's first load, so this is the issue at its smallest, not a control), 29.0 ms
  after a module of 12 000 exported functions (20–27 ms load), 110.3 ms after a top level that
  busy-waits 100 ms. 14 of 15 runs stale. A processor that seeds a counter from its constructor's
  `currentFrame` keeps the lag for its whole life.
- **Where it bites here:** the engine worklet, built at boot right after its module loads, so in the
  window whenever the context is already running at boot. It does not read the clock in its
  constructor, and its `QuantumClock` takes the true frame from the second quantum on. A recording's
  worklet is made long after the recorder's module loads (once, at engine install), outside the window.
  The recording CLAUDE.md's rule that a worklet module must be loaded before the first take (a load
  still running delays that take's first frame, 117 ms measured) is a different reading: that first
  frame ARRIVED late, this issue's read LAGS, and a lagging read alone would place a take early.
- **Workaround:** the SDK's `QuantumClock` (lib-dsp) anchors at the largest `currentFrame − calls·128`
  seen, so a stale first read is corrected by the first true one; the recording worklet sends its
  first-quantum time 16 calls late for that reason. A worklet of ours must re-read the clock in
  `process()` and never seed one from its constructor; check any new worklet for that.
- **Evidence:** `debug/2026-10-23-chromium-watched-issues/note.md`, "first-read"; probe
  `chromium-watched-issues-debug-demo.html?issue=first-read`, envelope
  `chromium-first-read-mvk1dr2x-2os8.json` (each run's raw frames).
- **Last checked:** Chrome 155, macOS, Playwright's Chrome, 2026-10-22: `STALE FIRST READ`, 14 of 15
  runs, probe `?issue=first-read`.

### Chromium [575891839](https://issues.chromium.org/issues/575891839) — the worklet clock runs at half speed after a back/forward-cache restore

- **Tracker:** [issues.chromium.org/issues/575891839](https://issues.chromium.org/issues/575891839),
  "AudioWorklet clock slows to ~0.5× after BFCache restoration, causing distorted playback". Filed
  2026-10-21, **open**, unconfirmed; macOS, Chrome 155 and Canary 158; not in Firefox or Safari.
  The reporter's symptom: a running context with a worklet node, restored from the cache, keeps
  `running` but advances at half speed, its output lower-pitched and distorted; a context with a plain
  OscillatorNode is unaffected. `suspend()` / `resume()` does not repair it, a reload does; it disappears with
  `--disable-features=WebAudioBypassOutputBuffering` (the reporter's isolation).
- **Symptom here:** a page with a running context and a worklet node, restored from the cache
  (`pageshow.persisted` true), keeps `state: running` and runs its clock at half the wall clock in every
  window measured. Three one-second windows after the restore read 0.4867 / 0.4988 / 0.4986 and
  0.4813 / 0.5046 / 0.4984 in two runs, against 1.0008 and 0.9774 before. Analysers read both tones at
  their exact pitch before and after: the samples are right, the graph renders them at half speed.
- **Where it bites here:** a demo that is playing when the user leaves it and comes back with Back. The
  looping demo, playing, entered the cache despite its held Web Lock, came back with no
  `notRestoredReasons` and still "Playing", and its position advanced 1.50 s in 3.00 s of wall clock
  (0.4996); a fresh load of it ran at 0.993. One run, through an injected `pageshow` listener, not swept.
  The dev server's HMR socket and COOP / COEP did not keep the probe page out of the cache either.
- **Workaround:** none applied. The option is to handle `pageshow` with `persisted` by tearing the engine
  down or asking for a reload; the measurement now backs that decision. (A `pagehide` listener does not
  keep a page out of the cache; an `unload` listener did, and Chrome is deprecating that;
  `Cache-Control: no-store` is no longer an absolute block in Chrome either.) Run the probe in a Chrome
  the user launched: Playwright's Chrome runs with `--disable-back-forward-cache` and reads
  `NOT CHECKED not-cached`.
  Follow-up PR (not in this one): handle `pageshow` with `persisted` true in the demos — reload or
  tear the engine down — so a visitor pressing Back on a playing demo does not hear the half-speed
  clock; verify with the demo reading in the note (injected pageshow listener, transport ratio).
- **Evidence:** `debug/2026-10-23-chromium-watched-issues/note.md`, "bfcache"; probe
  `chromium-watched-issues-debug-demo.html?issue=bfcache`, envelopes `chromium-bfcache-mvk1sddg-wilz.json`
  and `chromium-bfcache-mvk1suit-b7ru.json`.
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, the user's Chrome, 2026-10-22: `HALF SPEED`
  twice, probe `?issue=bfcache`.

### Chromium [560233271](https://issues.chromium.org/issues/560233271) — worklet playback stays at half rate, distorted, after an AudioContext suspend / resume that follows a worklet-thread stall

- **Tracker:** [issues.chromium.org/issues/560233271](https://issues.chromium.org/issues/560233271),
  "AudioWorklet playback becomes persistently distorted after AudioContext suspend/resume". Filed
  2026-09-11, **open**, P1, assigned, treated upstream as the root-cause tracker for the suspend / resume
  race in the bypass-output-buffering path ([issue 528653884](https://issues.chromium.org/issues/528653884) was closed by demoting a CHECK, which turned a
  renderer crash into partial output buffers). Bisected to Chrome 152.0.7949.0; macOS only so far; the
  reporter is BandLab, whose fix was to never suspend. The reporter's reduction
  ([github.com/pioug/chromium-audiocontext](https://github.com/pioug/chromium-audiocontext), `BUG_REPORT.md`;
  repro page [pioug.github.io/chromium-audiocontext](https://pioug.github.io/chromium-audiocontext/)) names
  the preconditions: 44.1 kHz requested explicitly, one restart on Play, an 80 ms synchronous worklet
  task before each cycle, a module file, a continuous stateless sine.
- **Symptom here:** a `suspend()` / `resume()` that follows an 80 ms synchronous task on the worklet
  thread halves the render rate, and it stays halved. The processor's `process()` calls fall from 344.5
  per second (44 100 / 128) to 172.3, and the context clock runs at 0.50 of the wall clock, for every
  window to the end of the run: one 128-frame quantum per 256-frame output callback, as the reporter's
  trace says. It is audible: on the microphone the tone's purity fell from 11.3 dB to −40…−63 dB, and
  the recording's strongest pitch class moved from A (1.00) to G (0.996, A 0.66), centroid 725 → 2 560 Hz,
  flatness 0.040 → 0.142. By ear on the tracker's repro page, in the user's Chrome, twice: distorted
  after five clicks about a second apart on the first attempt, on the first click on the second.
  Controls: without the stall, 20 cycles stay `CLEAN`, so the stall is the trigger; a Blob-URL module
  reproduces here too, unlike for the reporter; a 500 ms gap between `suspend()` and `resume()` only
  delays the failure, to cycle 10. Without the stall, two 40-cycle runs and one paced run broke on
  the microphone alone with the clock true; those are candidates, not reproductions: the room was
  unattended, and one of them was shown to be a 0.4 s room sound.
- **Where it bites here:** neither the demos nor the SDK call `suspend()`; `initializeOpenDAW` only
  resumes after a user gesture. The browser's own suspensions (iOS backgrounding, a context created
  suspended under autoplay policy and resumed once) are single cycles. The engine worklet's per-quantum
  load makes a worklet-thread stall before any future suspend likely, so a page that suspends and
  resumes after a long WASM compile, a large message or a heavy `process()` can lose half its render
  rate until a reload. The probe's earlier graph-only `CLEAN` rows (no stall, and an in-graph analyser
  on a phase-accumulating tone, which cannot see the output-path fault) are a limit of that probe, not
  evidence against the issue.
- **Workaround:** keep it that way: never add a suspend / resume cycle to a demo. A reload or a new
  context recovers; another `suspend()` / `resume()` does not.
  `--disable-features=WebAudioBypassOutputBuffering` for a local check.
- **Evidence:** `debug/2026-10-23-chromium-watched-issues/note.md`, "suspend-resume"; probe
  `chromium-watched-issues-debug-demo.html?issue=suspend-resume&tracker=1` (`&witness=mic` adds the
  microphone and a WAV; `&manual=1` takes one click per cycle, as on the tracker's page); envelopes
  `chromium-suspend-resume-mvk64uts-dikg.json` (graph), `…-mvk65nh4-kjz3.json` (microphone, with its
  WAV), `…-mvk5tg8m-hx60.json` and `…-mvk5vayw-hnhh.json` (earlier tracker-precondition runs, re-judged
  `HALF RATE`); controls `…-mvk67nwz-e5jp.json` (no stall, `CLEAN`), `…-mvk66w4s-yjmr.json` (Blob
  module), `…-mvk69i2k-w85k.json` (500 ms gap), `…-mvk66fux-d534.json` (5 cycles, `NOT CHECKED`);
  microphone-only candidates `…-mvk5pda3-2kmc.json`, `…-mvk5rajg-qii2.json`, `…-mvk68gjz-2bwp.json`.
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22: `HALF RATE` with
  `?issue=suspend-resume&tracker=1`, and by ear on the tracker's repro page.

### Chromium [388871416](https://issues.chromium.org/issues/388871416) — `outputLatency` understates a Bluetooth headset's output latency, and follows the system default device, not the context's sink

- **Tracker:** [issues.chromium.org/issues/388871416](https://issues.chromium.org/issues/388871416).
  Filed 2025-01 against Chrome Dev 133 on macOS with AirPods (`outputLatency` 33 ms on the speaker,
  17 ms on the headset); Chromium triage on M142 through M144 (2025-11) reads 200+ ms on the headset with
  or without the output-buffering flag. Open, needs feedback.
- **Symptom here:** a Defunc TRUE AUDIO Bluetooth headset reports `outputLatency` 161 ms against 28 ms
  for the built-in speaker (base 5.8 ms both), a difference of 133 ms. An acoustic round trip through
  the built-in microphone measures 306.96 ms with the headset against 103.22 ms with the speaker, a
  difference of 204 ms. Chrome understates the headset's output latency by about 70 ms (the mic path
  is the same for both and cancels). Separately, `outputLatency` follows the system default
  device, not the context's sink: a context made on the speakers' sink while the headset was the
  default still read 161 ms. The first read after `resume()` is 0 ms on every output.
- **Where it bites here:** take placement nets `outputLatency`, so a take recorded with this headset as
  the output is placed about 70 ms early, and a context on a sink other than the default is netted with
  the default device's figure.
- **Workaround:** the loopback calibration branch or a per-capture input-latency setting, as for any
  device whose reported latency is wrong; read `audioContext.outputLatency` a second after `resume()`,
  never at the instant after. One run per route, one
  headset; an unexplained run is in the note (the speakers' sink with the headset connected measured the
  headset's trip).
- **Evidence:** `debug/2026-10-23-chromium-watched-issues/note.md`, "output-latency"; probe
  `chromium-watched-issues-debug-demo.html?issue=output-latency&roundtrip=1` (`&sink=<label text>&gain=1`);
  envelopes `chromium-output-latency-mvk7f761-cq4x.json` (speaker, 103 ms), `…-mvk7dex7-o1zq.json`
  (headset, 307 ms), `…-mvk7bppn-2mc0.json` (speakers' sink, headset connected, 306 ms), and the
  readout pair `…-mvk3xjzv-1180.json` (28 ms) / `…-mvk6xq4h-115y.json` (161 ms).
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22.

## Watched — read from the tracker, not reproduced here

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
  stream-start FIFO or resampler artifact. The bare probe (no SDK, 60 s per cell) measured a stream-start
  zero run: one 441-frame run (10 ms) 441 frames after the tone arrives on the loopback at 44 100, and one
  128-frame run on the built-in microphone at 48 000, every run of those cells, all within the first
  55 ms; loopback 48 000 and microphone 44 100 were clean. That run is the same node path as the
  441-frame step and the same size, but not the same timing: it comes in the first 32 ms of a bare
  capture, the step 0.4–1.0 s into a capture beside the engine. A real-device recording with a 10 ms hole or a drifting beat
  is a candidate for this issue — reproduce and attribute before concluding, since an SDK ring-buffer
  regression would look the same.
- **Workaround:** none; a `MediaRecorder` capture of the same stream was clean in the reports (not what
  the SDK does). Keep the audio graph small during a take; check `tailMissingMs` and the per-beat errors
  of a real-device take before blaming placement.
- **Evidence:** `debug/2026-09-02-recording-start-alignment/note.md` (the 441-frame step and the
  stream-start duplicate); `src/demos/recording/CLAUDE.md` (the step);
  `debug/2026-10-23-chromium-watched-issues/note.md`, "capture-gaps" (envelopes
  `chromium-capture-gaps-mvk38gho-fzko.json`, `…-mvk35pnx-czdb.json`, `…-mvk39txh-gxhd.json`,
  `…-mvk37334-0nth.json`).
- **Last checked:** steady-state gaps not reproduced on Chrome 155.0.8059.85 / macOS 15.6.1, 2026-10-22,
  probe `?issue=capture-gaps`: no zero run and no duplicate after the first 0.1 s in any unspliced
  minute; `START GAPS` at loopback 44 100 and microphone 48 000, `CLEAN` at loopback 48 000 and
  microphone 44 100. The tracker ties the steady-state gaps to a large graph and to devices on different
  clocks, neither of which the probe had.

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
- **Evidence:** `debug/2026-10-23-chromium-watched-issues/note.md`, "opfs-flush"; envelopes
  `chromium-opfs-flush-mvk3i5ql-rcug.json`, `chromium-opfs-flush-mvk3ibtu-y9rp.json`.
- **Last checked:** the flush: not slow on Chrome 155.0.8059.85 / macOS 15.6.1, 2026-10-22, probe
  `?issue=opfs-flush`, `MEASURED`: median 0.53–0.57 ms per 1 MiB flush, 1.44–1.46 ms per 16 MiB, in two
  runs (one 25.65 ms outlier among 40 16 MiB flushes). The tracker's claim is a comparison with other
  browsers, which this repo does not make. The sentinel: no probe, out of scope; it needs the origin's
  quota exhausted or an incognito profile.

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
  processing until it delivers. Up to about 70 empty calls were seen before a `MediaElementAudioSourceNode` delivered (about 10 after a suspend and resume; the bug names a `MediaStreamAudioSourceNode` as the same case).
- **Where it bites here:** the recording worklet: a stamp taken on the first `process()` call would predate the input.
- **Workaround:** in place in the SDK — `RecordingProcessor` records its first-quantum call only once `inputs[0]`
  carries the expected channel count, and stamps from there (read on the 0.0.177 tag; the empty calls themselves
  were not counted here). A worklet of ours that reads input must do the same.
- **Last checked:** 2026-10-22 (tracker read).

### Firefox [2070740](https://bugzilla.mozilla.org/show_bug.cgi?id=2070740) — suspend / resume / close promise settlement can get out of order

- **Tracker:** [bugzilla 2070740](https://bugzilla.mozilla.org/show_bug.cgi?id=2070740), new, S3, 2026-09: a main-thread short circuit added for "closed before
  resume completed" rejections can settle out of order with the graph thread's suspend and close; the spec does not say
  whether a pending resume promise resolves or rejects when a later suspend or close overrides it.
- **Where it bites here:** `initializeOpenDAW` awaits `resume()` before the first `play()`; nothing here suspends,
  but three demos close the context on unmount (the jam-arrangement, clip-looping and Nano demos, the last right after
  creation when unmounted mid-boot), so the race could show on an HMR remount or a navigation during a pending resume.
- **Last checked:** 2026-10-22 (tracker read).

### Firefox OPFS — [2076609](https://bugzilla.mozilla.org/show_bug.cgi?id=2076609), [2072928](https://bugzilla.mozilla.org/show_bug.cgi?id=2072928), [2072923](https://bugzilla.mozilla.org/show_bug.cgi?id=2072923), [2060133](https://bugzilla.mozilla.org/show_bug.cgi?id=2060133)

- **Trackers:** [2076609](https://bugzilla.mozilla.org/show_bug.cgi?id=2076609) every `createSyncAccessHandle()` in an origin fails with `UnknownError` after an
  unclean shutdown while a handle was open (Firefox 156, a syntactically invalid SQL statement in the usage tracking;
  only clearing site data recovers); [2072928](https://bugzilla.mozilla.org/show_bug.cgi?id=2072928) creating, opening, closing and deleting a file costs about
  21 fsyncs, about 75 ms per file on Linux against 0.6 ms in Chromium, and [2072923](https://bugzilla.mozilla.org/show_bug.cgi?id=2072923) `write()` costs
  30–37 µs per call regardless of size; [2060133](https://bugzilla.mozilla.org/show_bug.cgi?id=2060133) `write()` past the quota does not throw
  `QuotaExceededError` (the same shape as Chromium's sentinel return).
- **Where they would bite here:** the SDK's OPFS worker writes every fetched sample and every finished recording
  through sync access handles, three files per sample (audio, peaks, meta), and the page sweep deletes the folder on load: a Firefox profile
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
  `interrupted` state is not a valid `AudioContextState`) and [276687](https://bugs.webkit.org/show_bug.cgi?id=276687)
  (silent after closing another tab that had audio) — the bugs 281566 links as related; not linked from it but of the
  same shape: [232640](https://bugs.webkit.org/show_bug.cgi?id=232640) (stops when wired headphones are unplugged) and
  [291892](https://bugs.webkit.org/show_bug.cgi?id=291892) "silent after a PWA returns from background even after
  resume" (a reporter saw it fixed on iOS 26.2 beta 3, the bug stays open).
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
  "Out of memory". Pull request [77672](https://github.com/WebKit/WebKit/pull/77672) open (2026-10-20). See also [272813](https://bugs.webkit.org/show_bug.cgi?id=272813).
- **Where it bites here:** the engine runs in a worklet with its Wasm memory; a demo reloaded many times in one Safari
  tab would eventually fail to boot. Not measured here (the reload cases measured so far are Chrome's).
- **Workaround:** none in the SDK; open the page in a new tab instead of reloading, until the fix ships.
- **Last checked:** 2026-10-22 (tracker read).

### WebKit [327552](https://bugs.webkit.org/show_bug.cgi?id=327552) — previously played audio is heard when resuming a context that has a worklet

- **Tracker:** [bugs.webkit.org 327552](https://bugs.webkit.org/show_bug.cgi?id=327552), new, 2026-10-14, macOS 26 nightly: after `suspend()` then
  `resume()` a stretch of the pre-suspend audio plays, the worklet's `process()` is then called rapidly as the clock
  catches up, and the audio clock has a discontinuity; Chromium resumes smoothly. Pull request [77683](https://github.com/WebKit/WebKit/pull/77683) open.
- **Where it bites here:** nothing here suspends a context; the browser's own iOS suspension and resume would.
- **Last checked:** 2026-10-22 (tracker read).

### WebKit [327275](https://bugs.webkit.org/show_bug.cgi?id=327275) — a background tab holding a Web Audio context glitches audio system-wide (macOS 27)

- **Tracker:** [bugs.webkit.org 327275](https://bugs.webkit.org/show_bug.cgi?id=327275), new, 2026-10-12, Safari 27 on macOS 27: the GPU process serves
  CoreAudio a 128-frame IO cycle (2.7 ms); once Safari is not frontmost, RunningBoard demotes that process to
  background priority, the HAL thread misses its deadline under moderate load, and every app on the machine clicks.
- **Where it bites here:** any demo left open in a background Safari tab; the hidden-page cases measured here are
  Chrome's. Related: [328063](https://bugs.webkit.org/show_bug.cgi?id=328063) "fade in RemoteAudioDestination output after a ring buffer underrun" (pull request
  [77508](https://github.com/WebKit/WebKit/pull/77508): WebKit fades to silence on an underrun and currently comes back with a step), [319504](https://bugs.webkit.org/show_bug.cgi?id=319504) "click or pop on
  AudioContext initialization after a page reload" (Safari 26, not in Chrome), [325501](https://bugs.webkit.org/show_bug.cgi?id=325501) "[iOS] output permanently
  distorted after switching the route to AirPlay" (iOS 26.7, only a new context recovers).
- **Last checked:** 2026-10-22 (trackers read).

### WebKit [326286](https://bugs.webkit.org/show_bug.cgi?id=326286) — iOS 26.2 to 27: output crackles while an echo-cancelled microphone capture is open

- **Tracker:** [bugs.webkit.org 326286](https://bugs.webkit.org/show_bug.cgi?id=326286), new, P2 Major, 2026-10-04, re-confirmed on iPhone 16 Pro and 16 Pro Max
  on iOS 27.0.1 in Safari and a WKWebView app: any audio the page plays while a `getUserMedia` stream with
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
  become idle" (Safari 26 and 27, 2026-10; Chromium and Firefox complete them during a main-thread block); [293955](https://bugs.webkit.org/show_bug.cgi?id=293955)
  "increase the `FileSystemSyncAccessHandle` per-origin limit beyond 256" (open handles fail past about 252; Chromium
  and Firefox allow thousands); [279739](https://bugs.webkit.org/show_bug.cgi?id=279739) "OPFS can deadlock the browser and inspector" (P2 Critical, 2024,
  Emscripten users reproduce it); plus [327929](https://bugs.webkit.org/show_bug.cgi?id=327929), [326347](https://bugs.webkit.org/show_bug.cgi?id=326347), [326135](https://bugs.webkit.org/show_bug.cgi?id=326135) (`InvalidStateError` where a disk-full or
  a lock error is meant; 326135 has pull request [76510](https://github.com/WebKit/WebKit/pull/76510) open).
- **Where they would bite here:** the SDK's OPFS worker is a dedicated worker; on Safari its sample writes and the
  page sweep wait on the page's main thread, which is exactly what a long synchronous task or a blocked frame driver
  stalls — the "[OPFS] … runs for <n>s" warnings could fire for the browser's reason; tell the two apart
  (a blocked main thread on Safari, a slow write anywhere) before attributing. A sample library
  with more than about 250 handles open at once cannot exist on Safari. None measured here.
- **Last checked:** 2026-10-22 (descriptions read).

### WebKit [328462](https://bugs.webkit.org/show_bug.cgi?id=328462) — "Enhanced Security" disables `SharedArrayBuffer`

- **Tracker:** [bugs.webkit.org 328462](https://bugs.webkit.org/show_bug.cgi?id=328462), new, 2026-10-22, pull request [77899](https://github.com/WebKit/WebKit/pull/77899) open: Safari's Enhanced
  Security setting switches `SharedArrayBuffer` off. The SDK needs it for the engine's sync stream, the recording ring
  buffer and the engine state (the pages are cross-origin isolated for that reason). With it [327924](https://bugs.webkit.org/show_bug.cgi?id=327924) "[iPadOS]
  cross-origin isolation parity with macOS" (COEP credentialless, reporting why isolation failed).
- **Where it bites here:** every demo on a Safari with the setting on would fail at `Workers.install`; not measured.
- **Last checked:** 2026-10-22 (tracker read).

# Across vendors

- **`AudioContext.setSinkId` is Chrome and Edge only.** Firefox: [1942786](https://bugzilla.mozilla.org/show_bug.cgi?id=1942786) (unconfirmed, 2025); WebKit: [280303](https://bugs.webkit.org/show_bug.cgi?id=280303)
  (filed 2024-09, pull request [74675](https://github.com/WebKit/WebKit/pull/74675) open since 2026-09). Gate on `"setSinkId" in AudioContext.prototype`; enumerate outputs through
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
