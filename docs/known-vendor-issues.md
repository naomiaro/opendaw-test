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
Chromium tracker through the browser) for Web Audio, worklet, OPFS, `getUserMedia` and `SharedArrayBuffer` issues, and
on 2026-10-23 for Web MIDI (the Chromium component Blink>WebMIDI's 74 open issues, `WebMIDI` / `MIDI` quicksearches
on the two Bugzillas): the SDK's `MidiDevices` is a Web MIDI client, and the MIDI sweeps' figures are Chrome's
`MIDIMessageEvent.timeStamp`.

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
  The bare cross-context path without the SDK or a `getUserMedia` override (the Chromium 40103985
  probe's `&source=crosscontext`) reads the tone at full scale. It carries that issue's 441-frame start
  block and 30 s silence hole instead; see the 40103985 entry.
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
  worker (lib-fusion's `OpfsWorker`) writes through sync access handles (`createSyncAccessHandle` on its
  write path) and deletes through `removeEntry` on its delete paths with no `truncate(0)` before them,
  so the demos' page-load sweep lowers the saved figure by every sample it removes (the dist lines are
  in the note). An upstream issue is drafted for review. (`clearStoredSamples()` in `src/lib/storedSamples.ts` also checks
  with `Workers.Opfs.exists` after a delete because `Workers.Opfs.delete` reports nothing when it fails
  — an SDK quirk, not the browser's.)
- **Evidence:** root CLAUDE.md, "Stored Samples Are Swept at Page Load" ([repo PR #132](https://github.com/naomiaro/opendaw-test/pull/132));
  `debug/2026-10-22-chromium-watched-issues/note.md`, "opfs-usage"; probe
  `chromium-watched-issues-debug-demo.html?issue=opfs-usage` (`&truncateFirst=1`), restart envelopes
  `chromium-opfs-usage-mvk4oyf2-4spf.json` (plain; uploaded before the two's-complement decode, the file
  reads `NOT CHECKED phantom-before-run`; its figures re-judged `NEGATIVE USAGE`, pinned by the Node test) and `chromium-opfs-usage-mvk4zzeo-oolp.json`
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
- **Evidence:** `debug/2026-10-22-chromium-watched-issues/note.md`, "first-read"; probe
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
  A page that has requested MIDI access is never put in the cache ([40635109](https://issues.chromium.org/issues/40635109)
  below), so the MIDI recording demo, the Nano demo and the two MIDI audit pages that request access are out of its
  reach once the visitor has enabled MIDI on them; before that click they are cacheable like the rest.
  The dev server's HMR socket and COOP / COEP did not keep the probe page out of the cache either.
- **Workaround:** in place. Every demo that boots through `initializeOpenDAW` installs
  `installBfcacheReloadGuard` (`src/lib/bfcacheReloadGuard.ts`) before its first await: on `pageshow`
  with `persisted` the page reloads itself, so a visitor who comes back with Back lands on the demo as
  on a first visit. A reload is the one repair a page can apply that the tracker reports working, and the
  one verified here (the restored looping demo reloaded, then ran at 0.999; note, "bfcache", the dated
  update). The guard fires in every browser that restores from the cache; the defect is Chrome's, the
  reload is unconditional. The SDK-free probe page does not boot through init and still measures the
  raw behaviour. (Keeping the page out of
  the cache was not an option: a `pagehide` listener does not do it, an `unload` listener did and Chrome
  is deprecating that, and `Cache-Control: no-store` is no longer an absolute block in Chrome either.)
  Run the probe in a Chrome the user launched: Playwright's Chrome runs with
  `--disable-back-forward-cache` and reads `NOT CHECKED not-cached`.
- **Evidence:** `debug/2026-10-22-chromium-watched-issues/note.md`, "bfcache"; probe
  `chromium-watched-issues-debug-demo.html?issue=bfcache`, envelopes `chromium-bfcache-mvk1sddg-wilz.json`
  and `chromium-bfcache-mvk1suit-b7ru.json`.
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, the user's Chrome, 2026-10-22: `HALF SPEED`
  twice, probe `?issue=bfcache`. Workaround verified 2026-10-23 on `looping-demo.html` (navigation type
  `reload` after Back, ratio 0.999).

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
- **Evidence:** `debug/2026-10-22-chromium-watched-issues/note.md`, "suspend-resume"; probe
  `chromium-watched-issues-debug-demo.html?issue=suspend-resume&tracker=1` (`&witness=mic` adds the
  microphone and a WAV; `&manual=1` takes one click per cycle, as on the tracker's page); envelopes
  `chromium-suspend-resume-mvk64uts-dikg.json` (graph), `…-mvk65nh4-kjz3.json` (microphone, with its
  WAV), `…-mvk5tg8m-hx60.json` and `…-mvk5vayw-hnhh.json` (earlier tracker-precondition runs, re-judged
  `HALF RATE`); controls `…-mvk67nwz-e5jp.json` (no stall, `CLEAN`), `…-mvk66w4s-yjmr.json` (Blob
  module), `…-mvk69i2k-w85k.json` (500 ms gap), `…-mvk66fux-d534.json` (5 cycles, `NOT CHECKED`);
  microphone-only candidates `…-mvk5pda3-2kmc.json`, `…-mvk5rajg-qii2.json`, `…-mvk68gjz-2bwp.json`.
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22: `HALF RATE` with
  `?issue=suspend-resume&tracker=1`, and by ear on the tracker's repro page.

### Chromium [388871416](https://issues.chromium.org/issues/388871416) — `outputLatency` reports a fixed 161 ms for a Bluetooth headset whose real extra output latency is 200 to 280 ms

- **Tracker:** [issues.chromium.org/issues/388871416](https://issues.chromium.org/issues/388871416).
  Filed 2025-01 against Chrome Dev 133 on macOS with AirPods (`outputLatency` 33 ms on the speaker,
  17 ms on the headset); Chromium triage on M142 through M144 (2025-11) reads 200+ ms on the headset with
  or without the output-buffering flag. Open, needs feedback.
- **Symptom here:** a Defunc TRUE AUDIO Bluetooth headset reports `outputLatency` 161 ms, fixed, against
  28 ms for the built-in speaker (base 5.8 ms both): 133 ms more. An acoustic round trip through the
  built-in mic, with the mic on its own device-free clock (a capture context on a `none` sink), measures
  68.86 ms for the speaker and 349.47, 272.30 and 270.86 ms for three headset streams: the headset adds
  202 to 281 ms. Chrome understates the headset's extra output latency by about 70 ms on a typical stream
  (70.4 and 69.0 ms) and by about 148 ms on the first stream after connecting (147.6 ms). The real figure
  varies per stream and drifts within one (about ±1 ms per click); the reported figure stays at 161 ms.
  `outputLatency` also follows the system default device, not the context's sink (161 ms on the speakers'
  sink while the headset was the default), and reads 0 ms the instant after `resume()` on every output.
- **Where it bites here:** take placement nets `outputLatency`, so a take recorded with this headset as
  the output is placed about 70 to 150 ms early, and a context on a sink other than the default is netted
  with the default device's figure.
- **Workaround:** the loopback calibration branch or a per-capture input-latency setting, as for any
  device whose reported latency is wrong; read `audioContext.outputLatency` a second after `resume()`,
  never at the instant after. The per-stream variation means a figure measured once on a headset is
  not valid for the next stream.
- **Evidence:** `debug/2026-10-22-chromium-watched-issues/note.md`, "output-latency"; probe
  `chromium-watched-issues-debug-demo.html?issue=output-latency&roundtrip=1&isolate=1` (`&sink=<label text>&gain=1`);
  isolated envelopes `chromium-output-latency-mvk7n65m-w5yf.json` (speaker, 68.86 ms),
  `…-mvk7p08l-k8r6.json` (349.47 ms), `…-mvk7pwdv-1qu8.json` (272.30 ms), `…-mvk7qhlz-ty15.json`
  (270.86 ms); readout pair `…-mvk3xjzv-1180.json` (28 ms) / `…-mvk6xq4h-115y.json` (161 ms);
  single-context runs kept as data, not used for the figure (`…-mvk7f761-cq4x.json` 103 ms,
  `…-mvk7dex7-o1zq.json` 307 ms, `…-mvk7bppn-2mc0.json` 306 ms: their capture path sat in the output
  device's clock domain).
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22.

### Chromium [40103985](https://issues.chromium.org/issues/40103985) — a render-thread stall leaves zeros in `getUserMedia` input (the sink's FIFO underruns)

- **Tracker:** [issues.chromium.org/issues/40103985](https://issues.chromium.org/issues/40103985),
  "Webaudio inserts zero filled parts into buffers supplied by getUserMedia". Filed 2019, **open**, P3,
  "Available". A Microsoft engineer traced it to `WebAudioMediaStreamAudioSink::ProvideInput` writing
  zeros on a FIFO underrun (2024-12) and prototyped a fix; nothing landed. The reports: 480-sample
  (10 ms at 48 kHz) zero-filled inserts and, with input and output on different clocks (USB in, USB
  out), 128-frame duplications about once a second, worse on slow machines and under a large graph.
- **Symptom here:** an 80 ms synchronous task on the worklet thread, once a second, leaves a zero run in
  the built-in microphone's input after every stall. The run is 512 to 1 792 frames long (about 32 ms)
  and starts 48 to 72 ms into the catch-up after the stall frame. This was 116 of 137 runs at 48 000 and
  60 of 60 at 44 100. At 48 000, 21 single-quantum runs also came between stalls, where an unstalled
  microphone minute holds none. There were no duplicates, since the microphone and speakers share a clock.
  The same-context loopback stays clean under the same stalls, because its producer renders on the
  stalled thread. A USB microphone, on its own clock apart from the built-in output, reads the same
  under stalls (114 of 138, 62 of 62) and also has no duplicates. Without a stall there is no gap after the first 0.1 s of any minute. A stream-start zero run
  does appear in two cells, every run: 441 frames, 441 frames after the tone arrives, on the loopback at
  44 100, and 128 frames on the microphone at 48 000, all within the first 55 ms. The tracker's JSFiddle
  lever, a larger `latencyHint`, gave the USB microphone one 384- or 256-frame run about 0.55 s in at
  0.1 and 0.2 s (`baseLatency` capped at 92.9 ms). The 0.1 s row also had a 384-frame run in the start
  window. The fiddle's 480-multiple holes
  (Windows, Chrome 77) were not seen here: every hole is whole render quanta. A later comment's lever,
  more than 30 s of complete silence on the output, reproduces too. With nothing but zeros reaching the
  destination, a 90 s built-in microphone capture has one zero run just after the 30 s mark of context
  time: 128 frames 21 to 32 ms after it in three rows, and 256 frames 373 ms after it at `latencyHint`
  0.1. With the commenter's dither, `(n & 1) / 10000` written to the output, there was none in four rows.
  A fifine USB microphone has the same hole, 13 and 21 ms after the mark, in 2 of 2 silent rows. With
  the dither it still had one 128-frame run, 1.93 s after the mark, in 1 of 2 rows. That device is very
  quiet (RMS 0.0005 to 0.0018), and a gate in the microphone would read the same.
  A later comment on the tracker says Chrome moves a silent output to a fake software device after
  30 s. The context's `baseLatency`, `outputLatency` and `sinkId`, read each second, did not change at
  around the 30 s mark, and in those microphone rows the clock never dipped under 0.92 in any second. Shipped Chrome fills an underrun with
  zeros. "Duplicated blocks" describe a tracker engineer's unshipped prototype that repeats the prior
  frame, so zero duplicates is the expected reading here. Tracker comment 50's two-context graph (one
  context generating, another recording the first's `MediaStreamAudioDestinationNode` stream; neither
  outputs to the speakers), mirrored by `&source=crosscontext`, gives two readings:
  - **At 44 100 on both contexts:** one block of exactly 441 zeros at the stream's start, 3 of 3.
  - **At 48 000 on both:** one hole of exactly 480 frames (10 ms) about 32 s in, 3 of 3 with both outputs
    silent and once more with only the generator dithered. The recording
    context's output dither removes it; the generator's alone does not.
- **Where it bites here:** any recording through a `MediaStreamAudioSourceNode`. An 80 ms render-thread
  stall cost about 32 ms of input. The sink's buffer of about 48 ms is inferred from where the zeros
  start, not measured, since only 80 ms stalls were run. A long WASM compile, a large message handled on
  the worklet thread, or a heavy `process()` during a take could do it. The recording-alignment harness
  cannot see it, because its loopback producer stalls with the consumer. The stream-start run meets a
  take only when arming and recording start together (`CaptureAudio` opens its stream on arm). The
  loopback's 441-frame stream-start run is the same node path and size as the 441-frame delay step
  (`debug/2026-09-02-recording-start-alignment/note.md`), but not the same timing. The step comes
  0.4–1.0 s into a capture beside the engine, so the link is not settled. A real-device take with a hole
  is a candidate for this issue. Reproduce and attribute it before concluding, since an SDK ring-buffer
  regression would look the same.
- **Workaround:** keep the worklet thread free of long tasks during a take; keep the audio graph small.
  Never let the output go completely silent for more than 30 s during a take: a dither of
  `(n & 1) / 10000` on an output removed the post-30 s hole in every built-in microphone row here and
  in 1 of 2 rows on a fifine USB microphone. An engine that renders
  exact zeros while recording (nothing playing, metronome off, monitoring off) would be moved to the
  fake device after 30 s. Whether the engine's output is exactly zero then is not measured. A dither in
  the engine output while recording is an upstream suggestion candidate, not drafted.
  A `MediaRecorder` capture of the same stream was clean in the reports (not what the SDK does).
  Check a stall-prone change on a real input, not the loopback.
- **Evidence:** `debug/2026-10-22-chromium-watched-issues/note.md`, "capture-gaps" and its "Render-thread
  stalls"; probe `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&stallMs=80&stallEvery=1000`
  (`&rate=44100`; `&source=loopback` for the clean comparison); stall envelopes
  `chromium-capture-gaps-mvk8sh5j-wdul.json` (mic 48 000), `…-mvk8tv7j-emkw.json` (mic 44 100),
  `…-mvk8ibbw-6u1w.json` and `…-mvk8juge-cjxt.json` (loopback), control `…-mvk8qfyt-uyws.json`;
  USB microphone (`&input=USB`) `…-mvk95l34-fnpf.json` and `…-mvk96z7f-ftoi.json` (stalls),
  `…-mvk9469i-pqmu.json` (no stall), `…-mvk8zu9c-3vg1.json`, `…-mvk918b0-8vcw.json`, `…-mvk92m9e-0dhp.json`
  (`&latencyHint` 0.04 / 0.1 / 0.2), loopback `…-mvk98cij-giwz.json` (`&latencyHint=0.2`);
  unstalled envelopes `…-mvk38gho-fzko.json`, `…-mvk35pnx-czdb.json`, `…-mvk39txh-gxhd.json`,
  `…-mvk37334-0nth.json`; silent output against dither over 90 s (`&seconds=90&speakerTone=0`, `&dither=1`)
  `…-mvk9nuuo-s3x1.json`, `…-mvk9wabz-l4w8.json`, `…-mvk9s0lh-u9sp.json` (silent),
  `…-mvka3ha2-0d3j.json` (silent, with the latency and sink witness), `…-mvk9pzn2-83bx.json`,
  `…-mvk9ybig-f9be.json`, `…-mvk9u1pc-xmca.json`, `…-mvka5n99-y698.json` (dither); fifine USB microphone (`&input=fifine`) `…-mvkazeel-sexy.json`,
  `…-mvkb5nr6-uwfr.json` (silent), `…-mvkb1ev7-mdld.json`, `…-mvkb3lxu-snp9.json` (dither); cross-context (`&source=crosscontext&seconds=90`)
  `…-mvkacrmf-k8rx.json`, `…-mvkaes9g-srld.json`, `…-mvkagspp-oi2e.json` (44 100 exact mirror),
  `…-mvkaj06l-m0om.json`, `…-mvkalf9k-bm9r.json`, `…-mvkb9tol-97v7.json` (48 000, both outputs silent),
  `…-mvkannu4-bvse.json` (48 000, generator dithered only),
  `…-mvkapr64-7nb1.json`, `…-mvkart84-a3fm.json` (recorder dither), `…-mvkattvu-a4v5.json`,
  `…-mvkbbup9-z9ax.json` (mixed rates; `…-mvka9y3q-ofr0.json`, an earlier build, kept as data); loopback
  `…-mvk9lpjr-ddsz.json`.
- **Last checked:** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22: `GAPS`, with the zero runs at stall
  times, on the built-in and a USB microphone at both rates; one zero run just after 30 s of silent
  output, none with dither, on the built-in microphone.

## Watched — read from the tracker, not reproduced here

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
- **Evidence:** `debug/2026-10-22-chromium-watched-issues/note.md`, "opfs-flush"; envelopes
  `chromium-opfs-flush-mvk3i5ql-rcug.json`, `chromium-opfs-flush-mvk3ibtu-y9rp.json`.
- **Last checked:** the flush: not slow on Chrome 155.0.8059.85 / macOS 15.6.1, 2026-10-22, probe
  `?issue=opfs-flush`, `MEASURED`: median 0.53–0.57 ms per 1 MiB flush, 1.44–1.46 ms per 16 MiB, in two
  runs (one 25.65 ms outlier among 40 16 MiB flushes). The tracker's claim is a comparison with other
  browsers, which this repo does not make. The sentinel: no probe, out of scope; it needs the origin's
  quota exhausted or an incognito profile.

### Chromium [327611574](https://issues.chromium.org/issues/327611574) — the macOS Web MIDI backend was rewritten onto CoreMIDI's UMP API, and the legacy path is gone

- **Tracker:** [issues.chromium.org/issues/327611574](https://issues.chromium.org/issues/327611574), "Mac MIDI code
  should not use soft-deprecated APIs", **in progress**, P2, assigned to the Web MIDI owner. `MidiManagerMac` left the
  `MIDIPacketList` / `MIDISend` / `MIDIInputPortCreate` API (deprecated in macOS 14) for the UMP `MIDIEventList` API:
  the migration landed on main on 2026-07-21, the new path was switched on for Apple platforms behind the
  `kMidiMacUmp` feature from 152.0.7966.0, and the flag and the legacy code were removed on 2026-10-13. The owner
  wrote that the change turned out "much [more] complicated than we expect, and beyond a simple API migration", which
  is why it shipped behind a flag first. No regression is filed against the new path.
- **Where it bites here:** every MIDI figure in this repo is a figure of the new backend. The three MIDI sweeps
  (`debug/2026-10-20-midi-input-alignment/`, `debug/2026-10-20-midi-audio-combined/`,
  `debug/2026-10-21-midi-effect-placement/`) ran on 2026-10-20 and 21 in the user's Chrome (which read 155.0.8059.85
  two days later; the notes record no version) over the IAC Driver, which the rewritten manager enumerates, stamps and
  delivers; the legacy backend was never measured here. A MIDI band that moves after a Chrome
  update (`MIDI_KNOWN_DEFECTS` in `src/lib/audit/midiInputAlignment.ts`) is read against this entry before the SDK:
  the stamp a `MIDIMessageEvent` carries is what the new path assigns. Nothing attributable to it has been seen: the
  placement findings ([openDAW#491](https://github.com/andremichelle/openDAW/issues/491),
  [#492](https://github.com/andremichelle/openDAW/issues/492), [#493](https://github.com/andremichelle/openDAW/issues/493)) are explained by the SDK's own arithmetic (the latency term's sign
  and a frame-stale position base, `debug/2026-10-20-midi-input-alignment/note.md`). No open Chromium issue concerns `MIDIMessageEvent.timeStamp`, MIDI input latency or jitter
  (searched 2026-10-23: `midi` with timestamp, latency, jitter, CoreMIDI and IAC), so the campaign's +32 ms has no
  vendor candidate.
- **Last checked:** 2026-10-23 (tracker read; no probe — the sweeps are the measurement).

### Chromium [40635109](https://issues.chromium.org/issues/40635109) — a page that has requested MIDI access is not put in the back/forward cache

- **Tracker:** [issues.chromium.org/issues/40635109](https://issues.chromium.org/issues/40635109), the "BFCache
  Correctness: pages in BFCache should not break platform APIs" umbrella, **in progress**, P2 (demoted from P1 in the
  2026-06 debt sweep). Among its commits the browser test `WebMidiNotCached` (relanded 2019-12-04), which pins that a
  document holding a `MIDIAccess` is not cached; Blink's scheduler tracks the request as
  `WebSchedulerTrackedFeature::kRequestedMIDIPermission` (`web_scheduler_tracked_feature.cc`, read 2026-10-23), which
  a Back navigation reports in `performance.getEntriesByType("navigation")[0].notRestoredReasons` as
  `requested midi permission`.
- **Where it bites here:** it narrows [575891839](https://issues.chromium.org/issues/575891839) above. The MIDI
  recording demo and the Nano demo call `MidiDevices.requestPermission()` when the visitor enables MIDI, the two MIDI
  audit pages when Run is clicked; from that moment a visitor who leaves them and comes back with Back gets a fresh load
  from the browser itself, and the reload guard never fires there. Before that click, and on the audio-only demos, the
  half-speed clock remains the risk the guard covers. The Neon and Apparat demos only use the SDK's software
  input, never request access, and are cacheable like the rest. Not measured here (the `?issue=bfcache` probe does not
  request MIDI).
- **Last checked:** 2026-10-23 (tracker read).

### Chromium Web MIDI — read and not reaching here

The rest of the component's 74 open issues, read 2026-10-23, do not reach a macOS Chrome page: the Windows WinMM
backend's deadlocks and missed disconnects ([566965142](https://issues.chromium.org/issues/566965142) Chrome 154 with
a SysEx buffer queued, [558101305](https://issues.chromium.org/issues/558101305), [41436976](https://issues.chromium.org/issues/41436976),
[416712838](https://issues.chromium.org/issues/416712838), [505045927](https://issues.chromium.org/issues/505045927));
Android ([568322991](https://issues.chromium.org/issues/568322991) a USB piano silencing Web Audio) and Linux
enumeration ([533891244](https://issues.chromium.org/issues/533891244), [40794512](https://issues.chromium.org/issues/40794512));
the unimplemented `MIDIPort.open()` / `close()` and `MIDIOutput.clear()` backends ([40411676](https://issues.chromium.org/issues/40411676),
[40411677](https://issues.chromium.org/issues/40411677)) and `send()` backpressure ([40370059](https://issues.chromium.org/issues/40370059)) —
the SDK calls none of the three: it listens for `midimessage` events, and for a MIDI output it calls
`send(data, performance.now() + offset)` from `Project.receivedMIDIFromEngine` (a scheduled send that, with no
`clear()`, cannot be recalled — `MidiDevices.panic()` sends immediate note-offs instead); the
`PermissionStatus` change event not firing for `midi` ([352700376](https://issues.chromium.org/issues/352700376),
Chrome 126 regression) — the SDK never queries it; `MIDIAccess` in a worker ([379805727](https://issues.chromium.org/issues/379805727));
and the feature requests for virtual ports ([41487942](https://issues.chromium.org/issues/41487942)) and MIDI 2.0
([40671162](https://issues.chromium.org/issues/40671162)).

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

### Firefox [1798742](https://bugzilla.mozilla.org/show_bug.cgi?id=1798742) / [1802149](https://bugzilla.mozilla.org/show_bug.cgi?id=1802149) — a virtual MIDI device switched on or off is not seen until the browser restarts; no hot-plug

- **Trackers:** [1798742](https://bugzilla.mozilla.org/show_bug.cgi?id=1798742) (new, P3, 2022): switching a macOS
  virtual MIDI device online or offline in Audio MIDI Setup changes nothing in Firefox until a restart, where Chrome's
  enumeration follows the change live; it waits on [1802149](https://bugzilla.mozilla.org/show_bug.cgi?id=1802149)
  hot-plug support (new, 19 comments; Firefox's `midir` fork gained a `hotplug` branch in 2026-01 — Linux working, the
  macOS code "to clean up", Windows not started). [1758488](https://bugzilla.mozilla.org/show_bug.cgi?id=1758488) asks
  whether a device's status survives a reload on macOS (new, P3, no description). Web MIDI itself shipped in Firefox 108
  behind a site-permission add-on prompt ([1742635](https://bugzilla.mozilla.org/show_bug.cgi?id=1742635), new, P2): a
  refusal and a missing add-on both reject `requestMIDIAccess` alike.
- **Where it bites here:** the three MIDI sweeps' recipe "IAC Driver online (Audio MIDI Setup)" (root CLAUDE.md): in
  Firefox the driver must be online before the browser starts, and a device plugged in
  during a session is missing until a restart. A rejected request rejects `requestPermission()` with the SDK's "Could
  not request MIDI" warning, whichever of the two causes it; the MIDI recording and Nano demos catch it and show the
  refusal in their info area, where a Firefox visitor also reads about the fixed device list and the add-on prompt from
  load (`MidiSupportNotice`, user-agent gated). The sweeps run in Chrome; none of this is measured here. Not reaching
  here: `MIDIOutput.clear()` not cancelling scheduled sends ([1869483](https://bugzilla.mozilla.org/show_bug.cgi?id=1869483)),
  the unbounded send queue on a closed port ([2031623](https://bugzilla.mozilla.org/show_bug.cgi?id=2031623)),
  `MIDIAccess` not transferable to a worker ([1937056](https://bugzilla.mozilla.org/show_bug.cgi?id=1937056)), the
  error-name alignment ([2007071](https://bugzilla.mozilla.org/show_bug.cgi?id=2007071)).
- **Last checked:** 2026-10-23 (tracker read).

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

### WebKit [107250](https://bugs.webkit.org/show_bug.cgi?id=107250) — no Web MIDI API

- **Tracker:** [bugs.webkit.org 107250](https://bugs.webkit.org/show_bug.cgi?id=107250), the master bug for a
  `WebCore/Modules/webmidi` implementation, new, P2, filed 2013-01, unassigned; ten comments, the last two (2024-11,
  2025-07) asking for it. `navigator.requestMIDIAccess` is undefined in Safari on macOS and iOS and in every WKWebView.
- **Where it bites here:** `MidiDevices.canRequestMidiAccess()` is false, `requestPermission()` rejects with the SDK's
  "This browser does not support MIDI" warning, and `inputDevices()` lists the software input alone. The MIDI recording
  demo, the Nano demo and the two MIDI audit pages have no hardware input in Safari; their on-screen keyboards (the SDK's
  `softwareMIDIInput`) work. The Neon and Apparat demos only drive the software input and are unaffected. The MIDI
  recording demo and the Nano demo say so in the info area at the top of the page (`MidiSupportNotice`,
  `src/lib/midiSupportNotice.ts`, gated on `canRequestMidiAccess()`); the two audit pages are Chrome-only debug pages
  and fail at their MIDI-access step with the SDK's warning instead.
- **Last checked:** 2026-10-23 (tracker read).

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
- **Web MIDI is Chromium's alone in practice.** Chrome and Edge: full, on a macOS backend rewritten in 2026
  ([327611574](https://issues.chromium.org/issues/327611574) above). Firefox: since 108, behind a site-permission
  add-on prompt, with a device list fixed at browser start ([1798742](https://bugzilla.mozilla.org/show_bug.cgi?id=1798742)
  above). Safari and WKWebView: none ([107250](https://bugs.webkit.org/show_bug.cgi?id=107250) above). The SDK's
  `MidiDevices.canRequestMidiAccess()` is the gate; its software input (`MidiDevices.softwareMIDIInput`) works
  everywhere, so a page that offers hardware MIDI should say which browsers have it.

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
