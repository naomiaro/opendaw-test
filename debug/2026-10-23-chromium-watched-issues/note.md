# Chromium watched issues, measured on this repo's own probes

**Started:** 2026-10-23. **Plan:** `docs/superpowers/plans/2026-10-22-chromium-watched-issues-measurement.md`,
deleted in the PR that completed it (git history keeps it); this note and the register carry its decisions.
**Spec:** `docs/known-vendor-issues.md`, "# Chromium / ## Watched — read from the tracker, not reproduced
here", plus the unmeasured half of the measured OPFS entry (436552046: the persisted usage going negative
after a delete and a restart).
**SDK:** none. The probes load no SDK: they say what Chrome does, not what the SDK repairs. Where an SDK
path is the witness (the first-read issue), the finding names the installed release.
**Page:** [`chromium-watched-issues-debug-demo.html?issue=<name>`](../../chromium-watched-issues-debug-demo.html)
(`src/demos/recording/chromium-watched-issues-debug-demo.tsx`; shared shape `src/lib/audit/chromiumWatched.ts`).

Each entry either moves to "Measured here" in the register with a figure, or stays watched with "not
reproduced on Chrome N, <date>" and the probe that failed to show it. A run that could not exercise the
condition reads `NOT CHECKED <reason>` and is recorded as such, never as "not reproduced".

## Summary

Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22. One line per entry: the verdict, then what the register
did with it.

- **571344687, stale first clock read:** `STALE FIRST READ` in 14 of 15 runs, lag tracking the module
  load (5.8 / 29.0 / 110.3 ms at most). Moved to "Measured here".
- **575891839, half-speed clock after a back/forward-cache restore:** `HALF SPEED` twice in the user's
  Chrome (windows 0.49–0.50), and the looping demo restored at 0.4996. Moved to "Measured here".
  Follow-up PR (not in this one): handle `pageshow` with `persisted` true in the demos — reload or tear the engine down — so a visitor pressing Back on a playing demo does not hear the half-speed clock; verify with the demo reading in the note (injected pageshow listener, transport ratio).
- **560233271, distortion after suspend / resume:** reproduced, and the trigger is found. An 80 ms
  synchronous task on the worklet thread right before `suspend()` / `resume()` halves the render rate.
  The processor runs 172.3 calls per second against 344.5 before, the context clock runs at 0.50, and
  the state persists to the end of the run. Without the stall, 20 cycles stay true. The user heard it
  on the tracker's own repro page twice: on the first attempt the tone was distorted after five
  clicks about a second apart, driven through the browser extension; on the user's own second
  attempt it broke on the first click. The entry should move to "Measured here", with
  "avoid suspend / resume, above all after a long worklet task" as the standing rule; the register is
  not edited in this commit.
- **40103985, zero-filled gaps in captured input:** no gap or duplicate after the first 0.1 s in any
  unspliced minute; `START GAPS` in two of four cells (441 zeros at loopback 44 100, 128 at mic 48 000).
  Stays watched for the steady-state symptom; the stream-start zero run is recorded in the entry.
- **436552046 / 401692415, OPFS usage going negative:** `NEGATIVE USAGE` after a real restart of the
  user's Chrome, and a truncate-first delete left the saved figure alone across a second restart. The
  measured entry's unmeasured half is now measured, and the workaround is confirmed.
- **40909520, slow `flush()`:** `MEASURED`, median 0.53–0.57 ms per 1 MiB, 1.44–1.46 ms per 16 MiB.
  Stays watched with the figures; no slowness here.
- **541725401 / 40068799, quota sentinel:** no probe (needs the quota exhausted or an incognito
  profile). Stays watched, out of scope.
- **388871416, `outputLatency` with Bluetooth:** built-in speaker only (base 5.8 ms, output 28 ms). The
  Bluetooth half was not run; it needs hardware. Stays watched.

Runs made with an earlier version of a probe are kept below as data and not quoted for a verdict: the
gated suspend / resume runs, the 44 100 capture minutes spliced at chunk boundaries (their start events
stand), the single-window bfcache runs, and the OPFS stored-readings load before the session marker.

## The issues

| `?issue=` | Chromium issue | What the probe does | Verdict words | Status |
|---|---|---|---|---|
| `first-read` | [571344687](https://issues.chromium.org/issues/571344687) — stale first clock read after a slow module load | Builds a worklet node right after `addModule()` resolves (a slow module, a large module, none), five runs each in a running context; the processor reports `currentFrame` from its constructor and first three `process()` calls, judged against the main thread's frame read just before the node was made | `STALE FIRST READ`, `FIRST READ TRUE`, `NOT CHECKED` | **reproduced**: `STALE FIRST READ` on Chrome 155, 2026-10-22 |
| `bfcache` | [575891839](https://issues.chromium.org/issues/575891839) — half-speed worklet clock after a back/forward-cache restore | Measures the context clock against `performance.now()` with a worklet tone and an oscillator control playing, navigates away and back; on `pageshow.persisted` re-measures in three one-second windows and judges on the last two, otherwise records the `notRestoredReasons` | `HALF SPEED`, `NORMAL`, `NOT CHECKED` | **reproduced**: `HALF SPEED` on Chrome 155, 2026-10-22, all three restore windows; a playing demo also restores at half speed (the user's Chrome; Playwright's cannot enter the cache) |
| `suspend-resume` | [560233271](https://issues.chromium.org/issues/560233271) — distortion after suspend / resume cycles | The tracker's tone (a stateless 440 Hz sine from `currentFrame`, from a module file) into an analyser; a two-second baseline, then `suspend()` / `resume()` cycles, with the tracker's preconditions under `&tracker=1` (44.1 kHz, one restart, an 80 ms worklet-thread stall before each cycle). Each one-second window is judged three ways: the clock witness (context clock against wall clock, `process()` calls per second), the graph's purity, click and dropout rules, and with `&witness=mic` the microphone in a context of its own | `HALF RATE`, `DISTORTED`, `DISTORTED (mic only)`, `CLEAN`, `NOT CHECKED` | **reproduced**: `HALF RATE` with `&tracker=1` (an 80 ms worklet-thread stall before each cycle) on Chrome 155, 2026-10-22; the render rate halves at cycle 2, 3 or 10 and stays halved (344.5 → 172.3 `process()` calls per second, clock 0.50); without the stall, 20 cycles stay true |
| `capture-gaps` | [40103985](https://issues.chromium.org/issues/40103985) — zero-filled gaps and duplicated blocks in `getUserMedia` input | Records 60 s of a `MediaStreamAudioSourceNode` (`&source=loopback` or `mic`, `&rate=48000` or `44100`) through a worklet; counts zero runs of 100 frames or more after the head and 128-frame blocks identical to the one before, the first 0.1 s after the head reported apart | `GAPS`, `START GAPS`, `CLEAN`, `NOT CHECKED` | **start gaps only**: one zero run in the first 55 ms of a capture (loopback 44 100: 441 frames; mic 48 000: 128 frames; every run of those cells), none after it, no duplicate, Chrome 155, 2026-10-22 |
| `opfs-usage` | [436552046](https://issues.chromium.org/issues/436552046) / [401692415](https://issues.chromium.org/issues/401692415) — OPFS usage not counted for sync-handle writes, negative after a delete | Writes through a sync access handle in a worker, reads `estimate()` before, after the write and after the delete; the user quits and reopens Chrome and the page judges the restart reading on load (`&truncateFirst=1` for the reporter's workaround) | `NOT COUNTED`, `COUNTED`, `NEGATIVE USAGE`, `NOT CHECKED` | **reproduced**: `NEGATIVE USAGE` after a restart of the user's Chrome 155, 2026-10-22 (saved figure −16.5 MB after a plain run's delete, read back as 4.28 GB; about +50.6 MB before it if the delete took the full 64 MiB, as the off-disk reading and round 2 show); the saved figure read off disk drops by the deleted size on a plain delete, by 0 after a truncate; a truncate-first run and a second restart moved it by the hand-deleted samples' size only (−238 137 857 against −238 135 417 predicted) |
| `opfs-flush` | [40909520](https://issues.chromium.org/issues/40909520) — slow `flush()` on Mac | Times 20 writes of 1 MiB and 20 of 16 MiB, each followed by `flush()`, in a worker; median, p95 and max per size | `MEASURED` (figures only: the tracker's claim is a comparison with other browsers this repo does not make) | **measured**: flush median 0.53–0.57 ms (1 MiB), 1.44–1.46 ms (16 MiB), Chrome 155, macOS 15.6.1, 2026-10-22 |
| — | [541725401](https://issues.chromium.org/issues/541725401) / [40068799](https://issues.chromium.org/issues/40068799) — a quota overrun returns a sentinel | No probe: needs the origin's quota exhausted or an incognito profile | — | out of scope, stays watched |
| `output-latency` | [388871416](https://issues.chromium.org/issues/388871416) — `outputLatency` with a Bluetooth headset | Resumes a context and reads `baseLatency`, `outputLatency`, `sinkId` and the output device's label from `enumerateDevices()` every second for 30 s; no classifier, the rows are the finding | `MEASURED` (figures only), `NOT CHECKED context-<state>` | **built-in speaker only**: base 5.8 ms / output 28 ms, Chrome 155, 2026-10-22; the Bluetooth half needs hardware, not run |

## Run recipe

1. Serve the repo over HTTPS on port 5173 (reuse a running dev server; do not start a second one):

   ```
   npm run dev -- --port 5173 --host 127.0.0.1 --strictPort
   ```

2. Open the page for one issue, one issue per page load, in Chrome with the window visible:

   ```
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=first-read
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=bfcache
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=suspend-resume&tracker=1
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=loopback&rate=48000
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=opfs-usage
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=opfs-flush
   ```

3. Click **Run** with a real click (Playwright `click`, never a dispatched event): the audio starts from it.
   Do not edit anything under `src/` or `public/` while a run is on; Vite reloads the page.
4. Wait for `#audit-state[data-audit-state]` to read `done` (or `error`). It reads `idle`, then
   `running:<step>`. The verdict word is `#verdict[data-verdict]`; the figures it was judged on are in the
   table below it, with the browser's version and the date.
5. The envelope is written through the dev server's `/__verify` sink to
   `.verify-output/chromium-<issue>-<runToken>.json` (untracked). Its fields: `issue`, `chrome`, `date`,
   `runToken`, `verdict`, `figures`.

`bfcache` stops at `running:awaiting-navigation` with a "Navigate away" link to `/blank-return.html`;
click it, then press Back. Restored from the cache, the page re-measures (three one-second windows) and judges in place. Loaded
afresh, it judges the stored baseline `NOT CHECKED` with the navigation's `notRestoredReasons`. Run it in a
Chrome the user launched (claude-in-chrome): Playwright's Chrome runs with `--disable-back-forward-cache`.
`opfs-usage` judges on a later page load (after the browser restart): the page judges what the earlier
run stored as soon as it loads, with no click, and saves that envelope. A Run click clears any stored
readings before it starts, so a fresh run never judges an older one. The restart half, in the user's
Chrome (claude-in-chrome, or by hand):

1. Open `https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=opfs-usage` and click Run.
   The page writes, reads back and deletes 64 MiB, shows `COUNTED` or `NOT COUNTED`, and keeps the
   readings in `localStorage`.
2. Quit Chrome fully (Cmd+Q, every window), then start it again.
3. Open the same URL **by hand**: type it or pick it from the address bar, not through Reopen Closed Tab
   or a session restore. The page reads `estimate()` once, scans the origin's OPFS, judges and uploads
   the envelope with no click.
4. Repeat with `&truncateFirst=1`.

The Run click sets a `sessionStorage` marker. A later load that still finds it is the same browsing
session, a reload rather than a restart: it reads `NOT CHECKED not-restarted` and keeps the stored
readings for the real restart. Chrome's session restore can carry `sessionStorage` over, which is why
step 3 reopens the URL by hand; a restored tab reads `not-restarted` too. Without the marker the page
still cannot prove that Chrome was restarted, so the person who quit it says so. `secondsSinceStored`
says how long ago step 1 was. The envelope's top-level `chrome` and `date` are the restart load's,
with `restartChromeFullVersion`, `restartOsVersion` and `restartDate` beside the run's own
(`chromeFullVersion`, `osVersion`, `runDate`): quitting Chrome is when a pending update installs.

A restart reading of 2³¹ or more is a negative saved figure read back unsigned: Chrome stores the
per-origin usage signed and a start reads it as 2³² + value. The envelope decodes it
(`savedUsageSigned`) and reads `NEGATIVE USAGE` when it is negative and the origin's files do not come
within 1 GiB of the raw reading. That needs no baseline: the session's own `estimate()` tally is not the
saved figure, and the two differ by whatever the session already miscounted. Each restart load keeps
its reading in `localStorage` (`chromium-watched:opfs-usage:last-restart`, with its date), and the next
restart's `restartDriftBytes` is the saved figure's change since then. The reported cause predicts
minus the file's size for a plain delete and about 0 after a truncate; the detail says which the
drift matches, within 1 MiB. The drift is a figure, not a verdict.

## Findings

One section per issue, filled as each probe runs: the Chrome version and date, the verdict, the figures,
and what it means for the register entry.

### first-read (571344687)

**Reproduced.** Chrome 155 (macOS, Playwright's Chrome, window visible), 2026-10-22, 44 100 Hz, one
click, five runs per variant interleaved, each run in a fresh running context that had run past 0.3 s
before the first `addModule()`. Verdict **`STALE FIRST READ`** on all three variants, 14 of 15 runs.
Envelope `.verify-output/chromium-first-read-mvk1dr2x-2os8.json`; 0 console errors on the navigation. An
earlier run with the same code, before the envelope carried the raw frames
(`chromium-first-read-mvk18ai3-q6py.json`), read the same: 15 of 15 stale, lags 2 / 6–10 / 36 quanta.

| variant | loaded before the probe module | variant load (ms) | lag of the constructor read (quanta) | largest lag | jump, first to second call (quanta) |
|---|---|---|---|---|---|
| `none` | nothing | — | 2, 2, 2, 2, 0 | 5.8 ms | 3, 3, 3, 3, 1 |
| `large` | 12 000 exported functions | 19.9…26.6 | 10, 6, 8, 8, 8 | 29.0 ms | 11, 7, 9, 9, 9 |
| `slow` | a top level that busy-waits 100 ms | 100.9…106.3 | 36, 36, 38, 38, 36 | 110.3 ms | 37, 37, 39, 39, 37 |

The raw frames (figure `<variant>.framesCreationCtorP1P2P3`: the node's creation frame, then
`currentFrame` in the constructor and the first three `process()` calls), `slow` for example:

```
18176/13568/13568/18304/18432; 18432/13824/13824/18560/18688; 18432/13568/13568/18560/18688;
18176/13312/13312/18304/18432; 17920/13312/13312/18048/18176
```

What the frames show, in every one of the 14 stale runs:
- The constructor and the first `process()` read the same frame.
- That frame is 13 312 to 13 824, which is 0.30–0.31 s. That is where the context clock stood when the
  probe started its first `addModule()`, after the 0.3 s settle. The read dates from when module loading
  started, as the tracker says.
- The second `process()` reads exactly the creation frame plus 128, and the third reads 128 more.
  From the second call on, the clock is true.

The one true run (`none`, run 5) read the creation frame in the constructor and first call, and stepped 128
after that.

- **The lag tracks the load time.** `slow` lags 104–110 ms after a 101–106 ms load. `large` lags
  17–29 ms after a 20–27 ms load. `large` and `slow` differ as the tracker says (32–43 ms against
  96–107 ms there). `large` is shorter here because this machine parses the generated module faster.
- **`none` is not a control.** The probe module is itself the context's first module load. So the run
  without a variant shows the issue at its smallest (2 quanta, 5.8 ms) in four runs of five, not its
  absence.

**What it means for the SDK (installed 0.0.177; read in the openDAW checkout, no new code).** The
engine worklet is built at boot after its module loads (`WasmEngine.ensureReady` awaits `addModule()`,
then compiles the engine's WASM, and the node follows), so it can sit in the issue's window whenever the
context is already running at boot (the window is open until the worklet thread renders its first
quantum). It does not read the clock in its constructor; its `process()`
stamps each quantum from `QuantumClock.advance(currentFrame)` (`lib-dsp/src/quantum-clock.ts`), whose
origin is the largest `currentFrame − calls·128` seen. A stale first read gives a low origin, and the
first true read (the second call, by the figures above) raises it, so from the second quantum on the
engine's frame is the true one. The `RecordingProcessor` uses the same clock and reports its
first-quantum frame `SETTLE_QUANTA` (16) calls late, "a stale first read is corrected by any true read
among the following quanta"; this probe's jumps land on the true frame at the second call, well inside
16. A recording's worklet is in any case made long after the recorder module loads (once, at engine
install), outside the window. The figure that says the repair holds end to end is the recording
start-alignment sweep on 0.0.177: netted placement +1.07…+1.17 ms
(`debug/2026-09-02-recording-start-alignment/note.md`, `changelogs/sdk-0.0.176-to-0.0.177-changes.md`).
A worklet that seeded a sample counter from its constructor's `currentFrame` would keep this probe's
lag for its whole life; none of this repo's worklets is known to, but that is the check for any new one.

### bfcache (575891839)

**Reproduced, and it reaches the demos.** Chrome 155.0.8059.85 (macOS 15.6.1, the user's own Chrome
driven through claude-in-chrome, window visible), 2026-10-22, 44 100 Hz. Verdict **`HALF SPEED`** on both
judged runs.

Each run went like this:
1. A real click on Run.
2. A two-second baseline.
3. A click on "Navigate away" to `/blank-return.html`, and about ten seconds there.
4. The browser's Back.

The page came back from the cache (`pageshow.persisted` true) with the context still `running`. The
restore is then measured as three consecutive one-second windows. The verdict is judged on the windows
after the first, so a clock that stalls while it resumes and then runs true reads `NORMAL`.

| envelope | ratio before | windows after the restore | ratio after (windows 2–3) | control Hz before / after | worklet tone Hz before / after |
|---|---|---|---|---|---|
| `chromium-bfcache-mvk1sddg-wilz.json` | 1.0008 | 0.4867, 0.4988, 0.4986 | 0.4987 | 660.01 / 660.01 | 440 / 440 |
| `chromium-bfcache-mvk1suit-b7ru.json` | 0.9774 | 0.4813, 0.5046, 0.4984 | 0.5015 | 660.01 / 660.01 | 440 / 440 |

Each run was away about 12.5 s. Two earlier runs judged one three-second window and read the same
(`chromium-bfcache-mvk1l93d-mc10.json`, 0.4912; `chromium-bfcache-mvk1ly1n-xi7o.json`, 0.4952). They are
superseded because one window cannot tell a slow clock from a stall.

- **It is a lasting slowdown, not a stall.** Every window reads half speed, the first included. The clock
  is at half speed from the moment the page comes back, and it stays there. This matches the tracker's
  figures: 0.967 before and 0.501 after.
- **The analysers cannot hear the drop.** Both tones read their exact pitch before and after. An analyser
  reads the rendered samples, and those are right. What is slow is how fast the graph renders against the
  wall clock, which is how the tracker's "lower-pitched" output reaches the speakers. The pitch figures
  only check that the graph renders the right signal. The clock ratio is the evidence.
- **The dev server does not keep the page out of the cache.** The probe page holds Vite's HMR WebSocket
  and is cross-origin isolated (COOP `same-origin`, COEP `require-corp`, as every demo is). Chrome 155
  cached and restored it anyway.

**A demo enters the cache too, and comes back at half speed.** The probe page above has no SDK. Whether a
demo is cached at all was a separate question. Every demo holds the shared Web Lock
`opendaw-demos:page-open` for its whole life (`src/lib/storedSamples.ts`), and a held lock is on Chrome's
list of reasons not to cache a page. It also runs the SDK's workers and OPFS. So this was measured once on
`looping-demo.html` in the same Chrome, with no change to the demo:

1. A `pageshow` listener was injected through the extension. It writes `persisted` and the navigation's
   `notRestoredReasons` to `sessionStorage`.
2. A real click on Play started playback.
3. A real click on the "Back to demos" link went to `/`.
4. The browser's Back returned to the demo.

The results:
- **The demo was restored.** The listener read `persisted: true` with no `notRestoredReasons`. That
  listener exists only in the original document, so its firing is itself proof of a restore.
- **The demo came back still playing.** Its transport showed "Playing".
- **The demo's clock ran at half speed.** Its own position readout advanced 1.50 s in 3.00 s of wall
  clock, a ratio of **0.4996**.
- **A fresh load of the same demo ran true.** The same readout, with Play clicked on a fresh load,
  advanced 2.98 s in 3.00 s, a ratio of **0.993**.

The held Web Lock did not keep the demo out of the cache on this Chrome. Lock contention can still evict
a cached page. No other page asked for the lock while the demo was cached, because the index page `/`
does not take it.

**Playwright's Chrome cannot run this probe.** Playwright launches Chrome with
`--disable-back-forward-cache`, read on `chrome://version` (same Chrome 155.0.8059.85). Two runs there
both read `NOT CHECKED not-cached` on a `back_forward` navigation, with no `notRestoredReasons` at all,
because Chrome reports none when the cache is switched off:
- one by the link click, `chromium-bfcache-mvk1jlyi-z477.json`, baseline 0.9656;
- one by `page.goto` to the blank page, `chromium-bfcache-mvk1kliu-fsvt.json`, baseline 0.9658.

The first envelope has the string `"null"` in its reasons field, a serialization bug fixed before the
second. The route makes no difference; the switch does. Run this probe in a Chrome the user launched.

**What it means for the register.** The entry moves to measured. On Chrome 155, a page with a running
context and a worklet node comes back from the cache with its clock at half speed for as long as it
lives, and its context still reads `running`. A demo is such a page. The looping demo entered the cache
while playing, despite its Web Lock, and came back with its transport at half speed. The demos have no
`pageshow` handling. The workaround the entry names, tearing the engine down or asking for a reload on
`pageshow` with `persisted`, is now a decision backed by measurement. This probe checks that decision and
any upstream fix. The demo reading was taken once, on one demo; it was not swept.

### suspend-resume (560233271)

**Reproduced: the trigger is an 80 ms task on the worklet thread right before the suspend / resume.**
Chrome 155.0.8059.85, macOS 15.6.1 (Apple silicon), 2026-10-22, 44 100 Hz. Every envelope carries
`chromeFullVersion` and `osVersion` itself.

**By ear, on the tracker's page.** The user opened https://pioug.github.io/chromium-audiocontext/ in
their own Chrome, clicked Play, then "Suspend / resume". There were two attempts, in this order:
1. Five "Suspend / resume" clicks about a second apart, driven through the browser extension. The
   tone was distorted after those five.
2. The user's own clicks. The tone broke on the first one.

The page's
source is at https://github.com/pioug/chromium-audiocontext. Its click handler is:

```js
cycle.onclick = async () => {
  await new Promise(resolve => {
    node.port.onmessage = resolve;
    node.port.postMessage(80);
  });
  await restart(); // await context.suspend(); await context.resume();
};
```

Its processor's message handler busy-waits that long on the worklet thread before it answers:

```js
this.port.onmessage = ({ data }) => {
  const deadline = Date.now() + data;
  while (Date.now() < deadline) {}
  this.port.postMessage(0);
};
```

So each cycle hits a render thread that has just stood still for 80 ms, several quanta of underrun.

**The reporter's account** (`BUG_REPORT.md` in the same repository):
- **Environment:** Chrome 153.0.8010.37 arm64, macOS 26.6.2, an output callback buffer of 256 frames,
  44.1 kHz.
- **Mechanism:** after the failure, each 256-frame output callback renders one 128-frame quantum
  instead of two, and "`frames_to_render` remains 128". The FIFO stays one quantum out of phase. The
  failure persists without further long tasks.
- **Related trackers:** 442866743 (this repo's transient one-quantum clock stall,
  `debug/2026-10-01-worklet-clock-stale/note.md`) and 364501613 (closed).

The reporter lists these reduced preconditions as necessary. This is what the probe does with each:

| reduced precondition (reporter) | the probe |
|---|---|
| "The `AudioContext` explicitly requests 44.1 kHz. Using the device-default sample rate did not reproduce the failure in this reduction." | met: `&rate=44100` (the device's default here is 44 100 too) |
| "The first Play action performs one initial context restart." | met: `&firstCycle=1` |
| "The worklet is loaded from an external module. Loading the same source from a Blob URL did not reproduce the failure in this reduction." | met: `public/chromium-suspend-resume-tone.js`. **Not necessary here:** the `&module=blob` control reproduced too |
| "The processor continuously outputs one 440 Hz sine wave; it has no idle state or synthetic per-render workload." | met: a stateless sine at 0.2 from `currentFrame`, the repro's own formula |
| "Immediately before each explicit context suspend/resume, a synchronous worklet message task runs for 80 ms." | met: `&stallMs=80`. **Necessary here:** the `&stallMs=0` control stays true |

`&tracker=1` is all five plus a one-second pace. One difference remains. The repro connects the node
straight to the destination; the probe passes it through an analyser and a gain, −30 dB, or −20 dB with
the microphone witness.

**The runs** (Playwright's Chrome, window visible, room unattended; each is `chromium-suspend-resume-<token>.json`; 0 console errors on every navigation):

| token | options | verdict | clock against wall clock, per cycle | `process()` calls per second, before → after | in-graph purity (baseline 66.51 dB) | microphone |
|---|---|---|---|---|---|---|
| `mvk64uts-dikg` | `&tracker=1` | `HALF RATE` from cycle 3 | 0.956, 0.960, then 0.48–0.50 | 344.6 → 172.3 | 6.5–25.9 dB from cycle 3, 1–2 clicks per window | — |
| `mvk65nh4-kjz3` (+ WAV) | `&tracker=1&witness=mic` | `HALF RATE` from cycle 2 | 0.997, then 0.499–0.504 | 344.5 → 172.3 | 6.3–25.9 dB from cycle 2 | `DISTORTED`: purity 11.32 → −40…−63 dB, 35–402 clicks per window from cycle 2 |
| `mvk66fux-d534` (+ WAV) | `&tracker=1&witness=mic&cycles=5` | `NOT CHECKED 5-cycles`, clock `TRUE` | 1.000–1.007 | 344.5 → 344.4 | 66.51 dB | 0 clicks |
| `mvk66w4s-yjmr` | `&tracker=1&module=blob` | `HALF RATE` from cycle 2 | 0.962, then 0.48–0.51 | 344.6 → 172.3 | 6.2–25.8 dB from cycle 2 | — |
| `mvk67nwz-e5jp` | `&tracker=1&stallMs=0` | `CLEAN` | 0.954–0.963 | 344.5 → 344.4 | 66.51 dB, 0 clicks | — |
| `mvk69i2k-w85k` | `&tracker=1&gapMs=500` | `HALF RATE` from cycle 10 | 0.99–1.00, then 0.498–0.505 | 344.1 → 172.2 | 6.1–25.4 dB from cycle 10 | — |
| `mvk68gjz-2bwp` (+ WAV) | `&witness=mic&pace=1000`, no stall | `DISTORTED (mic only)`: one microphone window, clock `TRUE` | 1.000–1.008 | 344.4 → 344.4 | 66.51 dB, 0 clicks | one window at −7.39 dB: a room sound (below) |
| `mvk6ah1p-c6ap` | `&tracker=1&manual=1`, two clicks | `NOT CHECKED 2-cycles` | 1.003, 0.957 | 344.4 | 66.51 dB | — |

The last row is the manual mode's smoke test: two real clicks, two rows, Finish, envelope uploaded.

- **The stall is the trigger.** Six runs had the stall on. Four fell into half rate within ten cycles,
  at cycles 2, 2, 3 and 10. Two did not fail:
  - the 5-cycle run `mvk66fux-d534`;
  - the manual smoke test `mvk6ah1p-c6ap`, two cycles with the clock true.

  The two short runs that held are consistent with a failure that has come at cycle 2, 3 or 10.
  Without the stall, 20 cycles stayed true.
- **Neither the module nor a slower restart prevents it.** The Blob-URL module failed at cycle 2. A
  500 ms gap between `suspend()` and `resume()` only delayed the failure to cycle 10.
- **Half rate is exact, and it lasts.** The processor's calls fall from 344.5 per second, which is
  44 100 / 128, to 172.3, exactly half. The context clock reads 0.50 against the wall clock. Both stay
  there for every remaining window, as the reporter's trace says: one quantum per 256-frame callback.
  The `HALF RATE` rule (`judgeHalfRate`) needs a true baseline, a slow window, and every later window
  slow, two at the least. It reuses the bfcache probe's `clockRatio` and its 0.9 and 0.75 thresholds.
  This is the bfcache probe's half-speed signature (575891839, above), reached by another road.
- **The in-graph analyser now sees it too.** With the repro's stateless tone (`sin(2π·440·(currentFrame
  + frame) / sampleRate)`), in-graph purity falls from 66.51 dB to 6–26 dB at the failing cycle. The
  windows also hold 1–2 clicks each. So the fault is visible in the rendered signal, not only in the
  output path. Round 2's earlier `&repro=tracker` runs (a flag `&tracker=1` has replaced), `mvk5tg8m-hx60` and `mvk5vayw-hnhh`, rendered
  a tone that kept its own phase, and their in-graph reading stayed `CLEAN`, at 0 clicks, while their
  clock read 0.50. So the in-graph damage comes from a tone computed from `currentFrame`. A likely
  reading is that `currentFrame` does not step by exactly 128 on every call after the failure. That
  is not measured directly.
- **The microphone hears it, and the analyser confirms it.** On `mvk65nh4-kjz3.wav`, comparing the
  baseline (0.3–2 s) with a late window (18–22 s):

  | figure | baseline | late window |
  |---|---|---|
  | strongest pitch class | A at 1.00, the next at 0.41 | G at 0.996, A at 0.66, all twelve between 0.40 and 1.00 |
  | spectral centroid | 725 Hz | 2 560 Hz |
  | rolloff | 724 Hz | 5 316 Hz |
  | flatness | 0.040 | 0.142 |
  | mid band (0.5–2 kHz) energy | 2.5 × 10⁻⁵ | 1.37 × 10⁻⁴ |

  `mvk5tg8m-hx60.wav`, from round 2's first reproduction, read the same: centroid 912 → 2 861 Hz,
  flatness 0.052 → 0.149.
- **The microphone alone is not a verdict.** The overall verdict takes the clock rule first
  (`HALF RATE`), then the graph's rules (`DISTORTED`). Distortion that only the microphone heard reads
  `DISTORTED (mic only)`, a candidate and not a reproduction, with `verdictDetail` saying so; a sound
  in the room reads the same. In `mvk68gjz-2bwp`, a no-stall run with the clock true and the graph
  clean, one microphone window dipped 14 dB. The WAV shows a single 0.4 s broadband
  event at 15.87–16.12 s, inside cycle 14's window, with the clean tone either side: a sound in the
  unattended room. Round 2's two no-stall 40-cycle runs, `mvk5pda3-2kmc` and `mvk5rajg-qii2`, read
  `DISTORTED (mic only)` the same way, with the clock true. They are not attributed to the issue.
  The clock and the render rate are the figures to quote; the WAV is the audible confirmation.
- **Round 2's runs, re-judged on the clock rule.** Their saved figures (`baselineClockRatio`,
  `clockRatioPerCycle`) were put through `judgeHalfRate` and `overallVerdict`, with the precedence
  above:

  | run | clock | verdict now |
  |---|---|---|
  | `mvk5tg8m-hx60` (tracker preconditions, 40 cycles) | before 1.0023, half rate from cycle 1 | `HALF RATE` |
  | `mvk5vayw-hnhh` (tracker preconditions, 20 cycles) | before 1.0032, half rate from cycle 1 | `HALF RATE` |
  | `mvk5pda3-2kmc`, `mvk5rajg-qii2` (40 cycles, no stall) | true | `DISTORTED (mic only)`, unattributed |
  | `mvk5no0g-o68z`, `mvk5okvv-cw8n` (20 cycles, no stall) | true | `CLEAN` |
- **Earlier runs stay as data.** The graph-only `CLEAN` runs, `mvk2auh7-7vhg` and `mvk2bm5g-d5aw`, had no
  stall; the in-graph analyser cannot see the output path. The positive controls, `mvk2ce9z-vsxm` for
  crackle and `mvk2d80b-fihu` for harmonic, show that the in-graph detectors fire.

**What the probe offers.** All options are in `src/lib/audit/chromiumSuspendResumeOptions.ts`:
- `&tracker=1` is the repro's setup. An explicit `&stallMs`, `&rate`, `&firstCycle` or `&pace` overrides
  its part.
- `&module=blob` and `&gapMs=<ms>` are the controls.
- `&witness=mic` adds the microphone in a context of its own that is never suspended. Its purity
  leaves out the bins below 200 Hz, and the capture is saved as a WAV. The WAV is written with
  `WavFile.encodeFloats` from `@opendaw/lib-dsp`. That is the only SDK import, a file-format utility;
  nothing in the probe's path goes through anything the SDK repairs.
- `&cycles=<n>` sets the cycle count.
- `&manual=1` takes one real click per cycle, as on the repro page, and shows a live row per cycle
  until Finish.

**What it means.** Neither the demos nor the SDK call `suspend()`. A grep for `.suspend(` finds nothing
in `src/` outside this probe, and nothing in any `@opendaw/*` dist; `initializeOpenDAW` only resumes.
The reproduction therefore moves the entry up with "avoid suspend / resume" as the standing rule, not a
code change. The entry's sentence "Not observed here" no longer holds. The stall says where the risk
would be: a page whose worklet thread has just been busy. That can be a long WASM compile, a large
message, or a heavy `process()`. Such a page suspending and resuming once can lose half its render
rate until a reload.

### capture-gaps (40103985)

**The steady-state symptom is not reproduced. A stream-start gap is, every time, in two of the four
cells.** The runs are Chrome 155.0.8059.85 on macOS 15.6.1 (Apple silicon), all in Playwright's Chrome
with the window visible, on 2026-10-22. Each capture is 60 s. The microphone Playwright's Chrome opened is
the real built-in one ("MacBook Pro Microphone (Built-in)"), not a fake device, so no row needed the
user's Chrome. The microphone rows ran unattended: the room was not checked for quiet, which does not
matter to these rules (a run of exact zeros or a bit-identical block is not something room noise makes).

Each run takes one real click and opens a context at the requested rate. The source is one of two:
- **`&source=loopback`.** A 1 kHz oscillator at 0.5 goes into a `MediaStreamAudioDestinationNode` in the
  same context. Its stream is cloned and consumed by a `MediaStreamAudioSourceNode`. This is the node
  path of the alignment harness's loopback, built directly: no SDK is loaded, so the getUserMedia patch
  in `loopbackInjection.ts` is not used.
- **`&source=mic`.** `getUserMedia` opens the microphone with echo cancellation, noise suppression and
  gain control off. The page plays the same tone from the speaker at −20 dB, and the recorder hears only
  the microphone. A microphone that cannot be opened reads `NOT CHECKED mic-<error>`; a denial faked in
  the page read `NOT CHECKED mic-NotAllowedError-Permission-denied`
  (`chromium-capture-gaps-mvk34aaa-zvf4.json`).

A worklet recorder copies channel 0 of the source node into chunks of whole render quanta, about a second
each (48 000 frames at 48 000, 44 160 at 44 100), and transfers them. Nothing else is in the graph. The
main thread joins the minute and judges it:
- **The head** is the run of zeros before the first non-zero frame: the stream starting, not a gap.
- **A zero run** is 100 or more exact zeros after the head. A tone never holds zero that long.
- **A duplicate** is a 128-frame stretch bit-identical to the 128 frames before it, on any alignment,
  and not all zeros.
- **The start window** is the first 0.1 s after the head. Runs and duplicates starting in it are
  reported apart (`startZeroRun*`, `startDuplicate*`).

A run reads `GAPS` on any zero run or duplicate after the start window, `START GAPS` when the only ones
are inside it, `CLEAN` on neither, and `NOT CHECKED` under 30 s of capture.

| envelope | source | rate (track) | head | start-window runs: start, length | runs after it | duplicates | verdict |
|---|---|---|---|---|---|---|---|
| `chromium-capture-gaps-mvk38gho-fzko.json` | loopback | 48 000 (48 000) | 1 345 | none | 0 | 0 | `CLEAN` |
| `chromium-capture-gaps-mvk35pnx-czdb.json` | loopback | 44 100 (44 100) | 825 | 1 266, 441 | 0 | 0 | `START GAPS` |
| `chromium-capture-gaps-mvk39txh-gxhd.json` | mic | 48 000 (48 000) | 2 176 | 2 432, 128 | 0 | 0 | `START GAPS` |
| `chromium-capture-gaps-mvk37334-0nth.json` | mic | 44 100 (48 000) | 2 146 | none | 0 | 0 | `CLEAN` |

Eight earlier runs, made before the start window existed, read the same events as `GAPS`:
- **Loopback 44 100, three runs** (`mvk2nnsk-1o7r`, `mvk2s84n-ie8k`, `mvk2tm6b-svwu`). Each holds one
  441-zero run, 441 frames after the head (at 1 266 or 1 394 after a head of 825 or 953).
- **Mic 48 000, three runs** (`mvk2p7gf-kr1k`, `mvk2v078-l88o`, `mvk2wdou-irk0`). Each holds one 128-zero
  run, 256 or 1 280 frames after the head.
- **Loopback 48 000 and mic 44 100, one run each** (`mvk2m7ao-pq9y`, `mvk2qqe5-nlo9`). Both read clean.

At 44 100 those earlier runs used one-second chunks of 44 100 frames. That is not whole quanta, so the
recorder dropped 60 frames at each chunk boundary. Their start events fall before the first boundary
and stand. Their later minutes are not counted as clean: a gap straddling a boundary could have been cut
under 100 frames. No quantum reached the recorder without a channel in any run.

What the readings show:
- **Every gap sits in the first 55 ms after the head.** Eight minutes recorded without splices hold no
  zero run and no duplicate after that: the four rows above and the four earlier 48 000 runs. The
  tracker's symptom, 10 ms inserts and 128-frame duplications through the stream's life, does not
  appear on this graph.
- **The 44 100 loopback inserts exactly 441 frames (10 ms) of zeros, 441 frames after the tone arrives,
  in 4 of 4 runs.** The stream delivers one 10 ms chunk of tone, then a 10 ms chunk of zeros, then the
  tone without a break. That reads as a 10 ms-chunked FIFO that underran once at its start and wrote
  zeros, the mechanism the tracker names. At 48 000 the same path is clean.
- **Whether this is the register's 441-frame delay step is not settled.** The size matches: a zero run of
  441 frames moves every later frame 441 frames late, which is a delay step of exactly 441. The timing and
  rate do not: the register's step came 0.4 to 1.0 s after the node started, in 6 of 70 opens, inside the
  SDK's capture with the engine running. This one comes in the first 32 ms, in 4 of 4 bare captures. The
  tone cannot tell an insert from an overwrite here, because 441 frames is exactly ten periods of 1 kHz
  at 44 100.
- **The 48 000 microphone drops one render quantum at its start, in 4 of 4 runs.** It reads 128 zeros,
  256 or 1 280 frames after the head. At 44 100, where the 48 kHz microphone is resampled into the
  context, it is clean in 2 of 2.

What it means:
- **A `START GAPS` reading is a stream-start artefact.** The register records it as measured: a capture
  loses 10 ms (loopback, 44 100) or one quantum (microphone, 48 000) in its first 55 ms. It is not the
  tracker's symptom reproduced, and the steady-state entry stays watched.
- **A take meets the start window only when arming and recording start together.** `CaptureAudio` opens
  its stream when the tape is armed, or in `prepareRecording` when it is not open yet. The probe makes the
  stream and the source node together, so it cannot say whether the gap belongs to a new stream or to a
  new source node on an old one (the SDK builds a new node when the requested channels change).
- **The tracker ties the steady-state gaps to a large graph and to devices on different clocks.** This
  graph is empty and the microphone shares the output's clock. A run beside a loaded engine graph, or with
  a USB input, is the next step if the steady-state half is ever wanted.

### opfs-usage (436552046 / 401692415)

**Reproduced in the user's Chrome: a plain run's delete, then a restart, reads `NEGATIVE USAGE`.** The
restart round comes first below, then the in-session runs in Playwright's Chrome.

The restart round is Chrome 155.0.8059.85 on macOS 15.6.1, the user's own Chrome, on 2026-10-22. A
plain run (`chromium-opfs-usage-mvk4ksbd-jmyd.json`) read `COUNTED` in the session: `estimate()` went
from 1 750 486 588 to 1 817 595 632 and back to 1 750 486 588 after the delete. Chrome was then quit
fully and the URL reopened by hand, 194 s after the run
(`chromium-opfs-usage-mvk4oyf2-4spf.json`, no session marker, the same Chrome and OS on both sides):

| figure | value |
|---|---|
| `estimate()` after the restart | 4 278 445 047 |
| that reading as the saved figure, signed | −16 522 249 |
| the saved figure before the run's delete, derived: −16 522 249 + 67 108 864, assuming the delete took the full size | +50 586 615 |
| files in the origin's OPFS at the restart (none under `test/`) | 238 135 417 |
| quota at the run / at the restart | 12 487 904 828 / 15 015 863 287 |

- **The run reproduced the tracker's symptom.** The next start read 4 278 445 047 bytes (3.98 GiB),
  which is 2³² − 16 522 249: a saved figure of −16 522 249 after the delete. This restart measured only
  that figure. It was about +50.6 MB before the delete if the delete took the full 64 MiB and the write
  added nothing, which the off-disk reading in Playwright's Chrome (below) and round 2 show.
- **The saved figure was already wrong before the run.** The origin held 238 MB of files, presumably
  the demos' samples written through sync handles, and the saved figure counted about 50.6 MB (derived as above). The session's
  tally at the run, 1.75 GB, matched neither.
- **The envelope as uploaded reads `NOT CHECKED phantom-before-run`.** The judge then measured the drift
  from the session's `estimate()` baseline, which is not the saved figure. The judge now decodes the
  restart reading instead, and reads this envelope's figures as `NEGATIVE USAGE` with a saved figure of
  −16 522 249 (a Node test pins it).

**Round 2: a truncate-first run and a second restart, the same Chrome, the same day.** Between the
rounds the user deleted `samples/v2` by hand in DevTools: 9 files, 238 135 417 bytes, the demos' sample
cache, written through sync handles. The restart reading above was seeded as the previous restart, in
the page's console:

```
localStorage.setItem("chromium-watched:opfs-usage:last-restart", JSON.stringify({ usage: 4278445047, date: "2026-10-22" }))
```

The prediction was written down before the result: if a truncate-first delete leaves the saved figure
alone, the drift is −238 135 417, the samples' delete alone. The run
(`chromium-opfs-usage-mvk4yy1c-cddi.json`, `&truncateFirst=1`) read `COUNTED` in the session: 4 040 307 190
before the write, 4 107 416 234 after it, 4 040 307 190 after the delete. Chrome was quit fully and the
URL reopened by hand 48 s later (`chromium-opfs-usage-mvk4zzeo-oolp.json`, no session marker, the same
Chrome and OS on both sides):

| figure | value |
|---|---|
| `estimate()` after the restart | 4 040 307 190 |
| that reading as the saved figure, signed | −254 660 106 |
| drift since the first restart (`restartDriftBytes`) | −238 137 857 |
| predicted drift (the samples' delete, nothing for the run) | −238 135 417 |
| difference | −2 440 |
| files in the origin's OPFS at the restart | 0 |
| quota at the run and at the restart | 14 777 725 430 |

- **The truncate-first delete subtracted nothing from the saved figure.** The drift is the samples'
  delete within 2 440 bytes. A plain delete of the run's file would have added −67 108 864 on top.
- **The 2 440 bytes are directory overhead.** The session's own figure dropped by the same 238 137 857
  when the samples were removed: 4 278 445 047 at the first restart, 4 040 307 190 when the round-2 run
  began.
- **The samples' delete is the plain-delete case again, on files the demos wrote.** Nine files written
  through sync handles, never counted, took their full 238 MB off the saved figure, which went from
  −16.5 MB to −254.7 MB. That is the mechanism by which the demos' page-load sweep drives an origin
  negative.
- **The envelope's detail says "this truncate-first run matches neither".** The judge compares the drift
  with −67 108 864 (plain) and 0 (truncate-first), within 1 MiB. The samples were deleted inside the same
  restart interval, so the drift carries them, and neither figure fits. Netting the samples out leaves
  −2 440, which is the truncate-first prediction. The verdict `NEGATIVE USAGE` is the envelope's own,
  judged on the decoded reading.

The in-session runs in Playwright's Chrome came first. That profile already carried the restart half's
symptom, and its saved figure was read off disk. The runs are Chrome 155.0.8059.85 on macOS 15.6.1, in Playwright's Chrome with the window visible, on
2026-10-22. Each run takes one real click. A dedicated worker writes `test/<runToken>.bin`, 64 MiB in
1 MiB `write()` calls through a sync access handle, then `flush()` and `close()`. It reopens the file,
reads `getSize()`, and with `&truncateFirst=1` truncates it to 0 through the handle. Then it closes the
file and calls `removeEntry()`. `estimate()` is read before the write, after the close and after the
delete.

| envelope | run | before write | after write | after delete | counted | verdict |
|---|---|---|---|---|---|---|
| `chromium-opfs-usage-mvk3k4la-782y.json` | plain | 3 889 404 852 | 3 956 513 896 | 3 889 404 852 | +67 109 044 | `COUNTED` |
| `chromium-opfs-usage-mvk3k8kj-wmfy.json` | `&truncateFirst=1` | 3 889 404 852 | 3 956 513 896 | 3 889 404 852 | +67 109 044 | `COUNTED` |
| `chromium-opfs-usage-mvk3l4wh-mr7j.json` | plain | 3 889 404 852 | 3 956 513 896 | 3 889 404 852 | +67 109 044 | `COUNTED` |
| `chromium-opfs-usage-mvk3ldkp-0zna.json` | `&truncateFirst=1` | 3 889 404 852 | 3 956 513 896 | 3 889 404 852 | +67 109 044 | `COUNTED` |

Every run read back 67 108 864 bytes through `getSize()`, removed the file, and found 0 bytes of files
anywhere in the origin's OPFS before the write. The 180 bytes over the written size are presumably the file's own
entry. The earliest plain run, `chromium-opfs-usage-mvk3igq7-p9j9.json`, predates two figures
(`opfsBytesAtRun`, `restartDriftBytes`) and read the same.

- **While the browser runs, `estimate()` follows the sync-handle write.** It rises by the file's size
  and returns to the baseline on the delete, plain or truncated. This is the tracker's "while the browser
  runs, `estimate()` is right", as a difference. The absolute figure is not right.
- **The origin reports 3.89 GB with no file stored.** `usageDetails` puts all of it under
  `fileSystem`. The origin's OPFS holds no file: only the folders `test/` and `samples/`, both
  empty (the demos' sweep emptied the second). That figure is 2³² − 405 562 444, the shape the tracker describes (2³² + a negative
  saved value). This profile is persistent (`--user-data-dir` under
  `~/Library/Caches/ms-playwright-mcp/`, not incognito, quota 14 626 823 092). It has been restarted
  across many sessions of demos that write samples through sync handles and sweep them on load. So
  this is the restart half, met in the wild before the probe ran. It is not a reading this probe
  produced.
- **The saved figure is negative, and a delete moves it exactly as the cause says.** The per-origin
  file `Default/File System/000/t/.usage` holds the saved usage as a little-endian int64 in its last
  8 bytes. The origin map (`File System/Origins`) maps `https_localhost_5173` to `000`. It was read off
  disk around the last two runs:

  | moment | saved value (bytes) | change |
  |---|---|---|
  | before the third run | −22 727 648 332 | — |
  | after the plain run `mvk3l4wh-mr7j` (file rewritten 15:13:31) | −22 794 757 196 | −67 108 864 |
  | after the truncate-first run `mvk3ldkp-0zna` (file rewritten 15:13:42) | −22 794 757 196 | 0 |

  The plain delete subtracted the full 64 MiB from a figure the write had never added to. The
  truncate-first delete subtracted nothing. Chrome writes the file during the session, not only at
  shutdown. `estimate()` did not move with it (3 889 404 852 throughout), so the session reads an
  in-memory figure loaded at start. The other localhost origins' files are negative too: −14 453 538 548
  for `localhost:5180`, −6 483 891 580 for `localhost:5181`. 3 889 404 852 is not the saved value modulo
  2³² (that is 2 975 046 580 now). How a start turns a saved value into the session's figure is not
  settled here.
- **The restart half was run afterwards, in the user's Chrome (above).** There the next start read
  2³² + value, the tracker's form, for a saved value above −2³². On this Playwright profile the saved
  value is already below −2³², and how a start converts it is not settled.

**The stored-readings path, by a plain reload, in Playwright's Chrome.** It ran twice:
- **Before the session marker existed.** `chromium-opfs-usage-mvk3j1q2-hxdm.json`, `secondsSinceStored` 27,
  read `NEGATIVE USAGE` on the profile's standing 3.89 GB with 0 bytes of files and used up the stored
  run. That verdict is the profile's, not the run's, and the reload was not a restart. It is superseded.
- **With the marker.** A plain run (`chromium-opfs-usage-mvk3tw5x-n7al.json`, `COUNTED`), then a reload
  (`chromium-opfs-usage-mvk3tz69-4nl1.json`, `secondsSinceStored` 4): `NOT CHECKED not-restarted`,
  `sessionMarkerPresent` yes, and the stored readings were still there afterwards.

Every run's stored readings were cleared from the Playwright profile's `localStorage` once its figures
were taken, so a later load there judges nothing.

What it means for the register:
- **The symptom is reproduced in the user's Chrome.** After a plain delete the next start read the origin
  as 4.28 GB, a saved figure of −16.5 MB (about +50.6 MB before the delete, derived on the full-size
  subtraction the off-disk reading and round 2 show).
- **The entry's cause is now measured here, not only read.** A sync-handle write leaves the saved usage
  alone, a `removeEntry()` subtracts the full size, and truncating first through the handle leaves it
  alone. The demos' page-load sweep deletes `samples/v2` without truncating. So every swept sample
  should lower the saved usage of its origin by its size. That is the likely source of the −22.7 GB on
  `localhost:5173`, though no sweep was measured against the file.
- **The phantom reaches `estimate()` on a later start.** This origin reports 3.89 GB with nothing
  stored. On a browser with a hard quota or an eviction policy that reads `usage`, this is the cost. In
  this profile the quota is 14.6 GB.
- **Truncating to 0 through a sync handle before `removeEntry()` keeps the saved figure where it was.**
  That is the workaround the tracker names, confirmed twice: on the file read off disk in Playwright's
  Chrome, and across a real restart in the user's Chrome (round 2). The sweep deletes a folder through
  the SDK's `Workers.Opfs.delete`, so taking it up would mean truncating each file first. The SDK's OPFS
  worker writes through sync access handles and deletes without truncating
  (`node_modules/@opendaw/lib-fusion/dist/opfs/OpfsWorker.js`: `createSyncAccessHandle` at line 158,
  `truncate(data.length)` on write at line 19, `removeEntry` with no `truncate(0)` at lines 81, 108 and
  111). That makes an upstream suggestion a candidate; it is not drafted.

### opfs-flush (40909520)

**Measured: a flush is about half a millisecond for 1 MiB and one and a half for 16 MiB.** The runs are
Chrome 155.0.8059.85 on macOS 15.6.1 (Apple silicon), in Playwright's Chrome, on 2026-10-22, on the
persistent on-disk profile described above (quota 14 626 823 092 bytes). Each run takes one real click.
A dedicated worker opens `test/<runToken>-flush.bin` with a sync access handle. It makes 20 `write()`
calls of 1 MiB, then 20 of 16 MiB, each appended and followed by `flush()`. `performance.now()` is
read around the write and around the flush separately. Then the worker closes the file and removes it.

| envelope | size | flush median / p95 / max (ms) | write median (ms) | throughput, write + flush (MB/s) |
|---|---|---|---|---|
| `chromium-opfs-flush-mvk3i5ql-rcug.json` | 1 MiB | 0.53 / 1.03 / 1.20 | 0.09 | 1 451.3 |
| | 16 MiB | 1.46 / 1.55 / 2.28 | 1.14 | 6 293.6 |
| `chromium-opfs-flush-mvk3ibtu-y9rp.json` | 1 MiB | 0.57 / 0.89 / 1.09 | 0.09 | 1 473.2 |
| | 16 MiB | 1.44 / 1.48 / 25.65 | 1.13 | 4 410.1 |

The file held 356 515 840 bytes (340 MiB) at the end of each run and was removed. Every flush is in
the envelope (`flush1MiBAllMs`, `flush16MiBAllMs`). The 25.65 ms is one flush of the second run's
16 MiB series. The rest of that series reads 1.40–1.48 ms.

- **No verdict beyond `MEASURED`.** The tracker's claim is that `flush()` on Mac is very slow compared
  with other browsers. This repo does not run that comparison, so the figures are recorded as they are.
- **A flush this fast reads as no full device sync.** 16 MiB in 1.5 ms is over 10 GB/s. That suggests
  `flush()` on this Chrome and macOS returns once the data is with the OS, without waiting on the drive.
  This is an inference from the figures; Chromium's source was not read for it. The tracker's slowness
  does not appear here at these sizes.
- **The entry stays watched**, with these figures and "not slow on Chrome 155, macOS 15.6.1,
  2026-10-22".

### output-latency (388871416)

**Measured on the built-in speaker only: base 5.8 ms, output 28 ms. The Bluetooth half was not run; it
needs hardware.** Chrome 155 on macOS 15.6.1, Playwright's Chrome, 2026-10-22, one real click, envelope
`chromium-output-latency-mvk3xjzv-1180.json`. The device label read `Default - MacBook Pro Speakers
(Built-in)` on every row, `sinkId` was empty (the default), sample rate 44 100.

- `outputLatency` read 0 ms at the first row (the instant after `resume()`) and 28 ms on each of the 30
  rows after it. A reader that takes one value right after `resume()` gets 0. Wait a second first.
- The register's "Last checked" for this entry stays as it is: the tracker's claim is about a Bluetooth
  headset, and nothing here exercised one.

**To run the Bluetooth half:** open
`https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=output-latency` in Chrome with the
Mac's output on the built-in speaker, click Run, and connect the AirPods (or any Bluetooth output) while
the 30 seconds run, with the system output switched to them. Read the rows: the tracker expects about
33 ms before and 200+ ms after on current builds. The witness for the switch is the `outputLatency`
jump. The label is secondary: it shows the device only when the page has a media permission, and
without one every label reads `(label hidden)` and the `labelsHidden` figure is true. A `sinkId` that
stays empty is the default device following the system. The saved envelope in `.verify-output/` carries
every row.

### Out of scope: the quota sentinel (541725401 / 40068799)

The other half of the watched OPFS entry is `write()` returning an error sentinel instead of throwing
`QuotaExceededError` when the quota runs out (40068799 in incognito, `0xfffffff8`). It needs the
origin's quota exhausted or an incognito profile. Neither probe does that: the usage probe writes
64 MiB and the flush probe 340 MiB against a 14.6 GB quota. It stays watched, for that reason.
