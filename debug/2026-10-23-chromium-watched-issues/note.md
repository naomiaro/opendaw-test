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
| `capture-gaps` | [40103985](https://issues.chromium.org/issues/40103985) — zero-filled gaps and duplicated blocks in `getUserMedia` input | Records 60 s of a `MediaStreamAudioSourceNode` (`&source=loopback` or `mic`, at 48 000 and 44 100) through a worklet; counts zero runs of 100 frames or more after the head and 128-frame blocks identical to the one before | `GAPS`, `CLEAN`, `NOT CHECKED` | not yet run |
| `opfs-usage` | [436552046](https://issues.chromium.org/issues/436552046) / [401692415](https://issues.chromium.org/issues/401692415) — OPFS usage not counted for sync-handle writes, negative after a delete | Writes through a sync access handle in a worker, reads `estimate()` before, after the write and after the delete; the user quits and reopens Chrome and the page judges the restart reading on load (`&truncateFirst=1` for the reporter's workaround) | `NOT COUNTED`, `COUNTED`, `NEGATIVE USAGE`, `NOT CHECKED` | not yet run |
| `opfs-flush` | [40909520](https://issues.chromium.org/issues/40909520) — slow `flush()` on Mac | Times 20 writes of 1 MiB and 20 of 16 MiB, each followed by `flush()`, in a worker; median, p95 and max per size | `MEASURED` (figures only: the tracker's claim is a comparison with other browsers this repo does not make) | not yet run |
| — | [541725401](https://issues.chromium.org/issues/541725401) / [40068799](https://issues.chromium.org/issues/40068799) — a quota overrun returns a sentinel | No probe: needs the origin's quota exhausted or an incognito profile | — | out of scope, stays watched |
| — | [388871416](https://issues.chromium.org/issues/388871416) — `outputLatency` with a Bluetooth headset | No page probe: needs a Bluetooth output device (plan Task 7) | — | not yet run |

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
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=loopback
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
run stored as soon as it loads, with no click, and saves that envelope.

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

Not yet run.

### capture-gaps (40103985)

Not yet run.

### opfs-usage (436552046 / 401692415)

Not yet run.

### opfs-flush (40909520)

Not yet run.
