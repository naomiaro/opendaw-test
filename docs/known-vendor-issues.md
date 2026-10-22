# Known vendor issues to work around

A register of browser, platform and hosting behaviours outside the SDK that this repo has
measured and works around. Read it before debugging a symptom that matches one: a listed
behaviour is not a new finding, and its workaround is already in place somewhere named below.
It is a register, so it carries versions and dates; the chapter docs and CLAUDE.md state the
present only. Add an entry when a vendor behaviour costs a session; retire it (keep the row,
mark it fixed, name the version) when the vendor ships a fix and a re-measurement confirms it.

Each entry: the tracker and its status, the symptom, where it shows up here, the workaround and
where it lives, the evidence, and when it was last checked.

## Chromium 442866743 — a worklet's clock stands still while the main thread changes the audio graph

- **Tracker:** [issues.chromium.org/issues/442866743](https://issues.chromium.org/issues/442866743),
  "currentTime and currentFrame sometimes freeze for a render quantum". Filed 2025-09-03, **open**;
  reproduced by Chromium triage on 142–144 and back to M-132. The cause (the render thread moves the
  clock on only when it gets the audio graph lock, which the main thread holds while it connects,
  disconnects or builds a node) and a quicker trigger are on the issue as comment 5 (2026-10-01,
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
- **Last checked:** 2026-10-22 (three `modal` rows intact on SDK 0.0.177).

## Chrome — each `MediaStreamAudioSourceNode` delivers its stream with a delay of its own

- **Tracker:** none; measured behaviour, not reported (a node's delay is set when it starts).
- **Symptom:** two source nodes on the same stream clone, created in one task, are a render quantum
  apart in a third to a half of the pairs; nodes started at different moments differ by up to 12 ms; at
  44.1 kHz a node's delay can step by 441 frames (10 ms) in its first second. Two tapes recorded together
  therefore carry a raw skew of 0 to 4 quanta that is the browser's, not the SDK's.
- **Where it bites here:** the multi-mic recording-alignment rows; any two-input recording.
- **Workaround:** none in the SDK (it places each take against its own first-frame time, which the
  skew cancels out of). The harness listens to the SDK's own source nodes (`nodeTaps` in
  `src/lib/audit/loopbackInjection.ts`, `measureNodeDelay` in `src/lib/audit/nodeTap.ts`) and judges the
  netted skew; a raw multi-mic skew is never quoted as an SDK finding. A worklet module must be loaded
  before the first take (a load still running delays that take's first frame, 117 ms measured).
- **Evidence:** `debug/2026-09-02-recording-start-alignment/note.md` (stream-tap measurement, repo PRs
  #136–#138).
- **Last checked:** 2026-10-22 (32 multi-mic rows, raw skew accounted for by the node delays on every repeat).

## Chrome — a `MediaStreamAudioDestinationNode` stream from another `AudioContext` reads silent when captured

- **Tracker:** none; measured behaviour.
- **Symptom:** a `getUserMedia` override returning a destination-node stream made in a different
  AudioContext than the engine's gives flat peaks (the oscillator taps fine directly); and a shared
  stream dies for every consumer once one of them calls `track.stop()` (a tape disarm or remove).
- **Where it bites here:** synthetic input for recording tests.
- **Workaround:** build the loopback in the SAME AudioContext the engine captures into (rms 0.0745 on a
  4 s take, 14.9× the threshold) and hand each `getUserMedia` call a `stream.clone()`; see
  `src/lib/audit/loopbackInjection.ts`. The real microphone otherwise.
- **Evidence:** `src/demos/recording/CLAUDE.md`, "Don't Synthesize Input to Verify Recording".
- **Last checked:** 2026-10-22 (every recording-alignment row runs through it).

## Chrome — `navigator.storage.estimate()` under-reports OPFS usage

- **Tracker:** none; measured.
- **Symptom:** 40 MB reported against 8.7 GB of sample files under `samples/v2`.
- **Where it bites here:** judging whether the per-page sample sweep works; any storage read-out.
- **Workaround:** sum the file sizes under `samples/v2` instead; `clearStoredSamples()` in
  `src/lib/storedSamples.ts` checks with `Workers.Opfs.exists` after a delete because
  `Workers.Opfs.delete` reports nothing when it fails.
- **Evidence:** root CLAUDE.md, "Stored Samples Are Swept at Page Load" (repo PR #132).
- **Last checked:** 2026-10-01.

## Safari — `decodeAudioData` does not decode Ogg Opus, and iOS re-suspends the AudioContext

- **Tracker:** none filed from here; long-standing WebKit behaviour.
- **Symptom:** `canPlayType("audio/ogg; codecs=opus")` answers "maybe", the decode fails. On iOS the
  context can go back to `suspended` after backgrounding or locking, and is not `running` right after
  `resume()` resolves.
- **Where it bites here:** every demo that loads the bundled tracks; playback after a lock.
- **Workaround:** `getAudioExtension()` in `src/lib/audioUtils.ts` picks m4a (AAC) on Apple devices by
  user-agent, not by feature detection; before `play()` check `audioContext.state` and wait for the
  `statechange` event (root CLAUDE.md, "AudioContext Suspension").
- **Last checked:** Safari 18.6 (2026-10-01, for the clock probe); the Opus fallback is exercised on
  every Apple load.

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
- **Last checked:** 2026-10-22 (the override was still set, the build on 24.13.1).

## TypeScript — DOM lib without `FileSystemSyncAccessHandle` and `AudioPlaybackStats`

- **Tracker:** none; the SDK's declaration files name DOM types the TypeScript lib does not have, and
  this repo checks declaration files (`skipLibCheck` off).
- **Workaround:** `types/sdk-dom-gaps.d.ts` declares the missing names, empty; add a name there when an
  SDK upgrade brings a new error of that kind (root CLAUDE.md, "Build & Verification").
- **Last checked:** 2026-10-22 (SDK 0.0.177, no new gap).
