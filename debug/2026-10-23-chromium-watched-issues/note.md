# Chromium watched issues, measured on this repo's own probes

**Started:** 2026-10-23. **Plan:** `docs/superpowers/plans/2026-10-22-chromium-watched-issues-measurement.md`.
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

## The issues

| `?issue=` | Chromium issue | What the probe does | Verdict words | Status |
|---|---|---|---|---|
| `first-read` | [571344687](https://issues.chromium.org/issues/571344687) — stale first clock read after a slow module load | Builds a worklet node right after `addModule()` resolves (a slow module, a large module, none), five runs each in a running context; the processor reports `currentFrame` from its constructor and first three `process()` calls, judged against the main thread's frame read just before the node was made | `STALE FIRST READ`, `FIRST READ TRUE`, `NOT CHECKED` | **reproduced**: `STALE FIRST READ` on Chrome 155, 2026-10-22 |
| `bfcache` | [575891839](https://issues.chromium.org/issues/575891839) — half-speed worklet clock after a back/forward-cache restore | Measures the context clock against `performance.now()` with a worklet tone and an oscillator control playing, navigates away and back; on `pageshow.persisted` re-measures in three one-second windows and judges on the last two, otherwise records the `notRestoredReasons` | `HALF SPEED`, `NORMAL`, `NOT CHECKED` | **reproduced**: `HALF SPEED` on Chrome 155, 2026-10-22, all three restore windows; a playing demo also restores at half speed (the user's Chrome; Playwright's cannot enter the cache) |
| `suspend-resume` | [560233271](https://issues.chromium.org/issues/560233271) — distortion after suspend / resume cycles | A worklet-rendered 440 Hz tone into an analyser; a two-second baseline, then 20 `suspend()` / `resume()` cycles with a purity window after each, judged on harmonic purity against the baseline and on dropouts | `DISTORTED`, `CLEAN`, `NOT CHECKED` | not yet run |
| `capture-gaps` | [40103985](https://issues.chromium.org/issues/40103985) — zero-filled gaps and duplicated blocks in `getUserMedia` input | Records 60 s of a `MediaStreamAudioSourceNode` (`&source=loopback` or `mic`, `&rate=48000` or `44100`) through a worklet; counts zero runs of 100 frames or more after the head and 128-frame blocks identical to the one before, the first 0.1 s after the head reported apart | `GAPS`, `START GAPS`, `CLEAN`, `NOT CHECKED` | **start gaps only**: one zero run in the first 55 ms of a capture (loopback 44 100: 441 frames; mic 48 000: 128 frames; every run of those cells), none after it, no duplicate, Chrome 155, 2026-10-22 |
| `opfs-usage` | [436552046](https://issues.chromium.org/issues/436552046) / [401692415](https://issues.chromium.org/issues/401692415) — OPFS usage not counted for sync-handle writes, negative after a delete | Writes through a sync access handle in a worker, reads `estimate()` before, after the write and after the delete; the user quits and reopens Chrome and the page judges the restart reading on load (`&truncateFirst=1` for the reporter's workaround) | `NOT COUNTED`, `COUNTED`, `NEGATIVE USAGE`, `NOT CHECKED` | **in-session half run, restart half needs a hand**: `COUNTED` on Chrome 155, 2026-10-22; the persisted figure, read off disk, is negative and drops by the deleted size on a plain delete, by 0 after a truncate |
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
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=suspend-resume
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

Read the restart envelope's `restartDriftBytes` (the restart reading minus the run's own baseline):
the reported cause predicts minus the file's size for a plain delete and 0 after a truncate.
`unexplainedAtRunBytes` says whether a phantom was already there before the run. When it is 1 GiB or
more, the restart reading alone cannot tell this run's effect from the phantom, so the drift decides:
within 1 MiB of minus the written size reads `NEGATIVE USAGE`, within 1 MiB of 0 reads `COUNTED` (the
phantom named in the detail), anything else `NOT CHECKED phantom-before-run`.

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

**Not reproduced under 20 quick cycles on an idle graph on this macOS.** The run is Chrome 155.0.8059.85
on macOS 15.6.1 (Apple silicon), in Playwright's Chrome with the window visible, on 2026-10-22, at
44 100 Hz. Both real runs read **`CLEAN`**. Two positive controls read **`DISTORTED`**, and every
navigation had 0 console errors. Each envelope carries `chromeFullVersion` and `osVersion` itself.

Each run takes one real click and reads the tone for a two-second baseline. It then runs 20 cycles of
`suspend()` / `resume()`, each raced against a 5 s deadline, with a one-second window after each resume.
The tone is a 440 Hz sine that the worklet processor renders itself. It goes into an analyser
(FFT 32 768, no smoothing), then through a −30 dB gain to the destination. Each window reads the
analyser once at its end, so every sample read was rendered after the resume. A window is judged three
ways:
- **Purity.** This is the tone's own bin over the power sum of every other bin, with the window's main
  lobe (±3 bins) counted as the tone. No bin is gated, so noise spread thin over the spectrum still
  adds up.
- **Dropouts.** A dropout is a 128-frame stretch whose RMS is under a tenth of the baseline's.
- **Clicks.** A click is a sample whose second difference exceeds 20 times the baseline window's own
  99.9th percentile. Here the threshold is 3.93 × 10⁻², about twenty times what the clean sine's
  curvature reaches.

A run reads `DISTORTED` on any one of three things: a purity more than 12 dB under the baseline,
dropouts in two consecutive windows, or a window with more than 2 clicks above the baseline's count.

| envelope | run | cycles | baseline purity | purity after the cycles | clicks per window | dropouts | suspend ms, median / max | resume ms, median / max | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `chromium-suspend-resume-mvk2auh7-7vhg.json` | real | 20 | 66.51 dB | 66.51 dB, every cycle | 0 | 0 | 0.50 / 0.67 | 5.85 / 7.72 | `CLEAN` |
| `chromium-suspend-resume-mvk2bm5g-d5aw.json` | real | 20 | 66.51 dB | 66.51 dB, every cycle | 0 | 0 | 0.50 / 0.70 | 5.82 / 8.38 | `CLEAN` |
| `chromium-suspend-resume-mvk2ce9z-vsxm.json` | `&control=crackle` | 20 | 66.51 dB | 7.58 dB from cycle 7 | 2 251–2 259 from cycle 7 | 0 | — | — | `DISTORTED` |
| `chromium-suspend-resume-mvk2d80b-fihu.json` | `&control=harmonic` | 20 | 66.51 dB | 12.83 dB from cycle 7 | 0 | 0 | — | — | `DISTORTED` |

The context read `running` after the last resume in every run.

What the instrument can see:
- **The crackle control shows the click rule and the purity rule both firing.** From cycle 7 on, the
  processor flips the sign of three samples per quantum. Purity falls 59 dB and each window holds
  about 2 255 clicks.
- **The harmonic control shows the purity rule alone.** From cycle 7 on, the processor soft-clips the
  tone. Purity falls 54 dB and the window holds no click. The two rules see different damage.
- **Both controls are gross.** They prove that the detectors fire in this browser on this graph. They
  do not measure the smallest damage the detectors would catch.
- **The detection floor below the controls comes from the rules, not a measurement.** One flipped
  sample of the 0.5 tone gives three clicks against a baseline of 0, and that reads `DISTORTED` (the
  classifier's tests), when the sample is larger than about 0.02. On the purity side, damage reads
  distorted once its power, summed over the whole spectrum, comes within about 54 dB of the tone. That
  is −74 dB on the analyser's scale, where the tone's bin reads −19.6 dB, wherever in the spectrum the
  damage falls.
- **The clean figures are the baseline's to two decimals.** A clean sine's out-of-lobe power,
  −86.11 dB, is the window's own sidelobe leakage, and it does not move across 20 cycles. The
  worst-purity cycle figure only picks out float rounding in a clean run.
- **The earlier `CLEAN` runs do not count.** Three runs used an earlier gated measure that counted only
  bins above −80 dB and had no click rule: `mvk21dt6-catu`, `mvk22th1-syvs` and `mvk23knk-55i8`. That
  measure could not see crackle spread thin over the spectrum, nor a click, so those runs are not
  quoted.

What it means:
- **`CLEAN` means not reproduced here, not fixed.** The tracker says the distortion comes "eventually",
  bisects it to Chrome 152 and reproduces it on macOS only. Here it is macOS on Chrome 155. So either 20
  cycles a second apart on a one-node graph do not hit the race, or a fix landed between 152 and 155.
  The probe cannot tell which, and the tracker is still open.
- **Neither the demos nor the SDK call `suspend()`.** A grep for `.suspend(` finds nothing in `src/`
  outside this probe, and nothing in any `@opendaw/*` dist. `initializeOpenDAW` only resumes. A
  `DISTORTED` reading would have moved the entry up with "avoid suspend / resume" as the standing rule,
  not a code change. The entry stays watched, with this reading.

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

**The in-session half reads `COUNTED`. The restart half was not run: it needs a hand.** But the profile
the runs used already carries the restart half's symptom, and its saved figure was read off disk. The
runs are Chrome 155.0.8059.85 on macOS 15.6.1, in Playwright's Chrome with the window visible, on
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
- **What the restart half would add.** It would show the next start reading a figure derived from the
  saved one, and how. The tracker's form is 2³² + value. On this profile the saved value is already
  below −2³² and the reported figure does not match that form. So the restart half is now a question
  about the conversion; the defect itself is shown.

**Not run: the restart half (needs a hand).** Nobody may quit the user's Chrome while they are away.
The Playwright browser is shared with other agents of this session, so it was not closed either.
The recipe is under "Run recipe". The stored-readings path ran end to end by a plain reload, twice:
- **Before the session marker existed.** `chromium-opfs-usage-mvk3j1q2-hxdm.json`, `secondsSinceStored` 27,
  read `NEGATIVE USAGE` on the profile's standing 3.89 GB with 0 bytes of files and used up the stored
  run. That verdict is the profile's, not the run's, and the reload was not a restart. It is superseded.
- **With the marker.** A plain run (`chromium-opfs-usage-mvk3tw5x-n7al.json`, `COUNTED`), then a reload
  (`chromium-opfs-usage-mvk3tz69-4nl1.json`, `secondsSinceStored` 4): `NOT CHECKED not-restarted`,
  `sessionMarkerPresent` yes, drift 0, and the stored readings were still there afterwards. The judgement from stored readings and a restart
figure is covered by Node tests (`src/lib/audit/chromiumOpfs.test.ts`). Every run's stored readings
were cleared from the Playwright profile's `localStorage` once its figures were taken, so a later load
there judges nothing.

What it means for the register:
- **The entry's cause is now measured here, not only read.** A sync-handle write leaves the saved usage
  alone, a `removeEntry()` subtracts the full size, and truncating first through the handle leaves it
  alone. The demos' page-load sweep deletes `samples/v2` without truncating. So every swept sample
  should lower the saved usage of its origin by its size. That is the likely source of the −22.7 GB on
  `localhost:5173`, though no sweep was measured against the file.
- **The phantom reaches `estimate()` on a later start.** This origin reports 3.89 GB with nothing
  stored. On a browser with a hard quota or an eviction policy that reads `usage`, this is the cost. In
  this profile the quota is 14.6 GB.
- **Truncating to 0 through a sync handle before `removeEntry()` keeps the saved figure where it was.**
  That is the workaround the tracker names. The sweep deletes a folder through the SDK's
  `Workers.Opfs.delete`, so taking it up would mean truncating each file first.

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
