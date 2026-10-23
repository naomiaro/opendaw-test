# Chromium watched issues, measured on this repo's own probes

**Started:** 2026-10-22. **Plan:** `docs/superpowers/plans/2026-10-22-chromium-watched-issues-measurement.md`,
deleted in the PR that completed it (git history keeps it); this note and the register carry its decisions.
**Spec:** `docs/known-vendor-issues.md`, "# Chromium / ## Watched — read from the tracker, not reproduced
here", plus the unmeasured half of the measured OPFS entry (436552046: the persisted usage going negative
after a delete and a restart).
**SDK:** none. The probes load no SDK engine (the suspend-resume and round-trip probes import lib-dsp's
WAV encoder for their captures, nothing else): they say what Chrome does, not what the SDK repairs. Where an SDK
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
  Chrome (windows 0.48–0.50), and the looping demo restored at 0.4996. Moved to "Measured here".
  Follow-up DONE in PR #177 (2026-10-23): `initializeOpenDAW` reloads a page restored from the cache
  (`installBfcacheReloadGuard`); the reading that verifies it is at the end of the "bfcache" section.
- **40635109, a page that requested MIDI access is not cached:** `MIDI BLOCKS CACHE` twice on the probe's
  `&midi=1` arm (2026-10-23; reasons `masked`, `midi`), the plain arm restored at 0.499 in between as the
  control. Moved to "Measured here": the MIDI demos are out of 575891839's reach once MIDI is enabled.
- **560233271, distortion after suspend / resume:** reproduced, and the trigger is found. An 80 ms
  synchronous task on the worklet thread right before `suspend()` / `resume()` halves the render rate.
  The processor runs 172.3 calls per second against 344.5 before, the context clock runs at 0.50, and
  the state persists to the end of the run. Without the stall, 20 cycles stay true. The user heard it
  on the tracker's own repro page twice: on the first attempt the tone was distorted after five
  clicks about a second apart, driven through the browser extension; on the user's own second
  attempt it broke on the first click. Moved to "Measured here", with "avoid suspend / resume, above
  all after a long worklet task" as the standing rule.
- **40103985, zero-filled gaps in captured input:** reproduced with the tracker's mechanism provoked.
  An 80 ms synchronous task on the worklet thread once a second leaves, after each stall, a zero run of
  512 to 1 792 frames (about 32 ms) starting 48 to 72 ms into the catch-up, on the built-in microphone
  at 48 000 (116 of 137 runs at stall times) and 44 100 (60 of 60). The loopback stays clean under the
  same stalls: its producer renders on the stalled thread. A USB microphone (input and output on
  different clocks) reads the same under stalls (114 of 138, 62 of 62). Without stalls, no gap after the
  first 0.1 s in any unspliced minute, and `START GAPS` in two of four cells (441 zeros at loopback
  44 100, 128 at mic 48 000). The tracker's JSFiddle lever, a larger `latencyHint`, gave the USB
  microphone one 384- or 256-frame run about 0.55 s in at 0.1 and 0.2 s (plus a 384-frame start-window
  run at 0.1), never a 480-multiple hole, and no
  duplicate anywhere. A later comment's lever, a silent output for more than 30 s, also reproduces: with
  nothing but zeros reaching the destination, the built-in microphone's 90 s capture has one zero run
  just after the 30 s mark (128 frames, 21 ms after it, twice; 256 frames, 373 ms after it, at
  `latencyHint` 0.1; 4 of 4 silent-output built-in microphone rows). With the commenter's dither on the
  output, none (0 of 4 dithered rows). A
  second USB microphone, a fifine, has the hole just after 30 s in 2 of 2 silent rows, and in 1 of 2
  dithered rows, at 1.93 s after the mark. A
  later comment says Chrome then moves the output to a fake software device; the page's latency and
  sink readings do not change around the 30 s mark. Comment 50's two-context graph, mirrored, gives one
  441-frame block at the stream's start at 44 100 (3 of 3), and at 48 000 one hole of exactly 480 frames
  about 32 s in (3 of 3 with both outputs silent, and in one row with only the generator dithered)
  that the recorder's output dither removes. Moved to "Measured here".
- **436552046 / 401692415, OPFS usage going negative:** `NEGATIVE USAGE` after a real restart of the
  user's Chrome, and a truncate-first delete left the saved figure alone across a second restart. The
  measured entry's unmeasured half is now measured, and the workaround is confirmed.
- **40909520, slow `flush()`:** `MEASURED`, median 0.53–0.57 ms per 1 MiB, 1.44–1.46 ms per 16 MiB.
  Stays watched with the figures; no slowness here.
- **541725401 / 40068799, quota sentinel:** no probe (needs the quota exhausted or an incognito
  profile). Stays watched, out of scope.
- **40726491, `getOutputTimestamp` wanders (added 2026-10-23, first seen on the MIDI output timing audit):**
  `STEPS` on both rates: a 278-frame sawtooth every 4.49 s on a 48 kHz context over the 44.1 kHz device (idle,
  janked, graph-churned and hidden alike), one −229-frame step in 60 s at the native rate; `outputLatency` fixed. Moved to "Measured here" under the open
  tracker 40726491 (40693959, merged into it, names the mechanism).
- **388871416, `outputLatency` with Bluetooth:** measured. Chrome reports a fixed 161 ms for the headset
  against 28 ms for the built-in speaker (a difference of 133 ms). With the microphone on its own
  device-free clock, the acoustic round trip measures 68.9 ms for the speaker and 349.5 / 272.3 / 270.9 ms
  for three headset streams, so the headset's real extra output latency is about 202 to 281 ms: Chrome
  understates it by about 70 ms on a typical stream and about 148 ms on the first stream after connecting.
  The real figure varies per stream and drifts within one; the reported figure does not move. The
  reported figure also follows the system default device, not the context's sink. Moved to "Measured
  here".

Runs made with an earlier version of a probe are kept below as data and not quoted for a verdict: the
gated suspend / resume runs, the 44 100 capture minutes spliced at chunk boundaries (their start events
stand), the single-window bfcache runs, and the OPFS stored-readings load before the session marker.

## The issues

| `?issue=` | Chromium issue | What the probe does | Verdict words | Status |
|---|---|---|---|---|
| `first-read` | [571344687](https://issues.chromium.org/issues/571344687) — stale first clock read after a slow module load | Builds a worklet node right after `addModule()` resolves (a slow module, a large module, none), five runs each in a running context; the processor reports `currentFrame` from its constructor and first three `process()` calls, judged against the main thread's frame read just before the node was made | `STALE FIRST READ`, `FIRST READ TRUE`, `NOT CHECKED context-not-running`, `NOT CHECKED too-few-runs` | **reproduced**: `STALE FIRST READ` on Chrome 155, 2026-10-22 |
| `bfcache&midi=1` | [40635109](https://issues.chromium.org/issues/40635109) — a page that has requested MIDI access is not put in the back/forward cache | The `bfcache` probe with `navigator.requestMIDIAccess()` first, the access held; on the way back it judges whether the page was restored at all, and if not whether the `notRestoredReasons` entries name MIDI (the page URL, which carries `&midi=1`, is not searched) | `MIDI BLOCKS CACHE`, `CACHED WITH MIDI` (the clock verdict then rides in `clockVerdict`), `NOT CHECKED` with `not-cached-no-reasons-reported`, `not-cached-without-a-midi-reason` (reasons read, none names MIDI: the outcome that would mean Chromium changed), `not-cached-reasons-unrecognised` (no reason string read from the text), `no-web-midi`, `midi-timeout`, `midi-refused: <name>: <message>`, `midi-threw: <message>`, `not-back-forward-<type>` | **reproduced**: `MIDI BLOCKS CACHE` twice on Chrome 155, 2026-10-23, reasons `masked` and `midi`; the plain arm restored (`HALF SPEED`) in the same Chrome a minute apart |
| `bfcache` | [575891839](https://issues.chromium.org/issues/575891839) — half-speed worklet clock after a back/forward-cache restore | Measures the context clock against `performance.now()` with a worklet tone and an oscillator control playing, navigates away and back; on `pageshow.persisted` re-measures in three one-second windows and judges on the last two, otherwise records the `notRestoredReasons` | `HALF SPEED`, `NORMAL`, `NOT CHECKED` with `not-cached`, `not-back-forward-<type>`, `context-<state>`, `too-few-windows`, `baseline-slow` | **reproduced**: `HALF SPEED` on Chrome 155, 2026-10-22, all three restore windows; a playing demo also restores at half speed (the user's Chrome; Playwright's cannot enter the cache) |
| `suspend-resume` | [560233271](https://issues.chromium.org/issues/560233271) — distortion after suspend / resume cycles | The tracker's tone (a stateless 440 Hz sine from `currentFrame`, from a module file) into an analyser; a two-second baseline, then `suspend()` / `resume()` cycles, with the tracker's preconditions under `&tracker=1` (44.1 kHz, one restart, an 80 ms worklet-thread stall before each cycle). Each one-second window is judged three ways: the clock witness (context clock against wall clock, `process()` calls per second), the graph's purity, click and dropout rules, and with `&witness=mic` the microphone in a context of its own | `HALF RATE`, `DISTORTED`, `DISTORTED (mic only)`, `CLEAN`, `NOT CHECKED` with `<n>-cycles`, `no-signal`, `no-baseline-purity`, `processor-error-tone`, `processor-error-recorder`, `mic-<error>` or the step that failed | **reproduced**: `HALF RATE` with `&tracker=1` (an 80 ms worklet-thread stall before each cycle) on Chrome 155, 2026-10-22; the render rate halves at cycle 2, 3 or 10 and stays halved (344.5 → 172.3 `process()` calls per second, clock 0.50); without the stall, 20 cycles stay true |
| `capture-gaps` | [40103985](https://issues.chromium.org/issues/40103985) — zero-filled gaps and duplicated blocks in `getUserMedia` input | Records `&seconds` (default 60 s) of a `MediaStreamAudioSourceNode` (`&source=loopback` or `mic`, `&rate=48000` or `44100`) through a worklet; counts zero runs of 100 frames or more after the head and 128-frame blocks identical to the one before, the first 0.1 s after the head reported apart; `&latencyHint`, `&input=<label>`, `&dither`, `&speakerTone=0`, `&seconds`, a per-second clock, latency and sink witness; `&source=crosscontext` (comment 50's two-context graph), `&generatorRate`, `&generatorDither`; `&stallMs` holds the worklet thread every `&stallEvery` ms and reports the runs in each stall's span apart | `GAPS`, `START GAPS`, `CLEAN`, `NOT CHECKED` with `<s>-s`, `no-signal`, `source-ended`, `source-muted`, `source-empty-input`, `mic-<error>` or the step that failed | **reproduced with render-thread stalls**: an 80 ms worklet-thread stall each second leaves a 512–1 792-frame zero run 48–72 ms after each stall on the microphone, at 48 000 (116 of 137 runs at stall times) and 44 100 (60 of 60); the loopback stays clean under the same stalls; without stalls, no gap after the first 0.1 s, `START GAPS` at loopback 44 100 and mic 48 000; a USB microphone the same under stalls (114 of 138, 62 of 62); `latencyHint` 0.1 / 0.2 gave one 384- or 256-frame run about 0.55 s in (plus a 384-frame start-window run at 0.1), never a 480-multiple hole; no duplicate anywhere; with a silent output, one 128- or 256-frame run just after the 30 s mark in 6 of 6 silent-output microphone rows (4 built-in, 2 fifine USB; the silent loopback row read `CLEAN`), and in 1 of 6 dithered microphone rows (a fifine row, 1.93 s after the mark); no latency or sink change around the 30 s mark; cross-context exact mirror (44 100 / 44 100): one 441-frame start block, 3 of 3; 48 000 / 48 000 with both outputs silent: one 480-frame hole about 32 s in, 3 of 3 (and in the one row with only the generator dithered), gone with the recorder's dither; Chrome 155, 2026-10-22 |
| `opfs-usage` | [436552046](https://issues.chromium.org/issues/436552046) / [401692415](https://issues.chromium.org/issues/401692415) — OPFS usage not counted for sync-handle writes, negative after a delete | Writes through a sync access handle in a worker, reads `estimate()` before, after the write and after the delete; the user quits and reopens Chrome and the page judges the restart reading on load (`&truncateFirst=1` for the reporter's workaround) | `NOT COUNTED`, `COUNTED`, `NEGATIVE USAGE`, `NOT CHECKED` with `readings-missing`, `write-none`, `write-short`, `write-size-mismatch`, `not-restarted`, `restart-no-estimate`, `opfs-<missing>` | **reproduced**: `NEGATIVE USAGE` after a restart of the user's Chrome 155, 2026-10-22 (saved figure −16.5 MB after a plain run's delete, read back as 4.28 GB; about +50.6 MB before it if the delete took the full 64 MiB, as the off-disk reading and round 2 show); the saved figure read off disk drops by the deleted size on a plain delete, by 0 after a truncate; a truncate-first run and a second restart moved it by the hand-deleted samples' size only (−238 137 857 against −238 135 417 predicted) |
| `opfs-flush` | [40909520](https://issues.chromium.org/issues/40909520) — slow `flush()` on Mac | Times 20 writes of 1 MiB and 20 of 16 MiB, each followed by `flush()`, in a worker; median, p95 and max per size | `MEASURED` (figures only: the tracker's claim is a comparison with other browsers this repo does not make), `NOT CHECKED opfs-<missing>` | **measured**: flush median 0.53–0.57 ms (1 MiB), 1.44–1.46 ms (16 MiB), Chrome 155, macOS 15.6.1, 2026-10-22 |
| — | [541725401](https://issues.chromium.org/issues/541725401) / [40068799](https://issues.chromium.org/issues/40068799) — a quota overrun returns a sentinel | No probe: needs the origin's quota exhausted or an incognito profile | — | out of scope, stays watched |
| `clock-drift` | [40726491](https://issues.chromium.org/issues/40726491) — `getOutputTimestamp`'s relation wanders (40693959 merged in: the position is updated per render quantum, not from the device) | A running context with the bfcache probe's steady graph; `getOutputTimestamp` and `outputLatency` read on a WORKER tick every 10 ms through phases of `&seconds` (idle; an 80 ms main-thread block every 500 ms; a silent gain node connected to / disconnected from the destination every 50 ms; with `&load=<percent>` a worklet burning that share of every quantum; hidden by hand, then back); the relation's offset from the first sample in frames at the context rate, steps over half a quantum, the ramp between them, the 128-frame lattice fit, the device's native rate | `STEPS`, `STEADY`, `NOT CHECKED` with `context-<state>`, `too-few-samples`, `hidden-never-happened` or the step that failed | **reproduced** on Chrome 155, 2026-10-23: 48 kHz context on the 44.1 kHz device: a sawtooth, +62 frames/s then −278 frames every 4.49 s, 14 in 60 s, every phase, hidden too; 44.1 kHz (native): one early step per 80 s run (−229, −997 frames) in idle, then +0.25 frames/s, nothing from jank, graph changes or a 60 % render load; `outputLatency` 28.00 throughout; the MIDI audit's per-repeat wander at the native rate not reproduced SDK-free |
| `output-latency` | [388871416](https://issues.chromium.org/issues/388871416) — `outputLatency` with a Bluetooth headset | Readout: resumes a context and reads `baseLatency`, `outputLatency`, `sinkId` and the output device's label from `enumerateDevices()` every second for 30 s; no classifier, the rows are the finding. `&roundtrip=1`: plays 10 clicks through the output and finds them in a built-in-mic capture (`&sink=<label>`, `&gain=`) | `MEASURED` (figures only), `NOT CHECKED context-<state>`; with `&roundtrip=1` also `NOT CHECKED` with `<n>-of-10-clicks-found-…`, `clock-pair-unstable`, `non-positive-round-trip`, `mic-<error>`, `capture-context-<error>`, `sink-none-unsupported` or the step that failed | **measured, understated by about 70 ms (about 148 ms on the first stream after connecting)**: reported 28 / 161 ms; isolated round trips 68.9 ms (speaker) and 349.5 / 272.3 / 270.9 ms (headset); Chrome 155, 2026-10-22 |

## Run recipe

1. Serve the repo over HTTPS on port 5173 (reuse a running dev server; do not start a second one):

   ```
   npm run dev -- --port 5173 --host 127.0.0.1 --strictPort
   ```

2. Open the page for one issue, one issue per page load, in Chrome with the window visible:

   ```
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=first-read
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=bfcache
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=bfcache&midi=1
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=suspend-resume&tracker=1
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=loopback&rate=48000
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&rate=48000&stallMs=80&stallEvery=1000
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&input=USB&rate=48000&latencyHint=0.04
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&rate=48000&seconds=90&speakerTone=0&dither=1
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=crosscontext&rate=48000&generatorRate=48000&seconds=90
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=opfs-usage
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=opfs-flush
   https://localhost:5173/chromium-watched-issues-debug-demo.html?issue=clock-drift&rate=48000&hidden=1
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
afresh, it judges the stored baseline `NOT CHECKED` with the navigation's `notRestoredReasons`. With `&midi=1`
it requests Web MIDI access before the baseline (no prompt once the origin has the permission) and a fresh
load is the expected outcome: `MIDI BLOCKS CACHE` when the reasons name MIDI. Run it in a
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
context and a worklet node comes back from the cache with its clock at half speed in every window
measured, and its context still reads `running`. A demo is such a page. The looping demo entered the cache
while playing, despite its Web Lock, and came back with its transport at half speed. At the time of this
reading the demos had no `pageshow` handling; the reload the register entry now names as its workaround
was a decision backed by this measurement. This probe checks that decision and any upstream fix. The demo
reading was taken once, on one demo; it was not swept.

**Update 2026-10-23 (PR #177): the demos reload themselves on a restore, and the reload runs true.**
`initializeOpenDAW` installs `installBfcacheReloadGuard` (`src/lib/bfcacheReloadGuard.ts`) before its
first await; on `pageshow` with `persisted` the page calls `location.reload()`. Verified on
`looping-demo.html` in the user's Chrome 155.0.8059.85, dev server, the same route as above: a real click
on Play, a navigation to `/`, Back. A `pageshow` listener injected into the original document recorded
`persisted: true` with no `notRestoredReasons` (so the page WAS restored, and the guard fired on the
restore, not on a miss); the page that then came back had navigation type `reload` and its transport read
`00:00.00 Stopped`; Play on it advanced 3.00 s in 3.00 s of wall clock, ratio **0.999**. One run.

#### The MIDI arm (40635109): a page that requested MIDI access is not cached

**Reproduced.** Chrome 155.0.8059.85 (macOS 15.6.1, the user's Chrome through claude-in-chrome, window
visible), 2026-10-23, 44 100 Hz. `&midi=1` calls `navigator.requestMIDIAccess()` before the baseline
(resolved without a prompt: the origin already has the permission from the MIDI demos) and the run's
closure holds the `MIDIAccess` through the navigation. The rest of the run is the plain arm's: a real click
on Run, a two-second baseline, the "Navigate away" link, about ten seconds on `/blank-return.html`, Back.

| envelope | arm | ratio before | persisted | navigation type | notRestoredReasons | verdict |
|---|---|---|---|---|---|---|
| `chromium-bfcache-mvle4tqu-7mcs.json` | `&midi=1` | 1.0006 | false | `back_forward` | `masked`, `midi` | `MIDI BLOCKS CACHE` |
| `chromium-bfcache-mvle5mr7-1e5v.json` | plain (control) | 1.0009 | true | — | — | `HALF SPEED` (0.4811, 0.4989, 0.4990) |
| `chromium-bfcache-mvle6m6x-hp50.json` | `&midi=1` | 1.0010 | false | `back_forward` | `masked`, `midi` | `MIDI BLOCKS CACHE` |

- **The reason the API reports is `midi`**, beside `masked`; "requested midi permission" is the tracker's
  and Blink's prose for the same feature (`kRequestedMIDIPermission`). The arm matches the `reasons`
  entries only, never the page URL, which carries `&midi=1` itself.
- **The control is the same page a minute later without the request:** restored, context still
  `running`, clock at half speed. So the cache was on in this Chrome, and the one difference between the
  arms, the MIDI request, is what kept the page out.
- **What it says for the demos:** the MIDI recording demo and the Nano demo request access through
  `MidiDevices.requestPermission()` when the visitor enables MIDI, the two MIDI audit pages when Run is
  clicked. From that click on, Back gives them a fresh load from the browser itself, and 575891839 cannot
  reach them; before it they are cacheable like every other demo, and the reload guard covers that. Not
  swept over the demos: the probe exercises the same API call, with no SDK in the page.
- **Not reproduced elsewhere:** Playwright's Chrome (`--disable-back-forward-cache`) reports no reasons
  at all and the arm reads `NOT CHECKED not-cached-no-reasons-reported`; a browser with no Web MIDI reads
  `NOT CHECKED no-web-midi`.

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
- **Silent and failed runs never read `CLEAN` (rules added after every run above).** A baseline with no
  tone in it (fundamental −Infinity, or an RMS under `SIGNAL_FLOOR_RMS`, 10⁻⁵) reads `NOT CHECKED
  no-signal`, and a baseline whose purity is not a number `NOT CHECKED no-baseline-purity`. A window the
  analyser read as silence counts as the worst purity, −Infinity, so it reads `DISTORTED` and cannot lock
  a later fall out (its count is `silentWindows`). A processor that throws reads `NOT CHECKED
  processor-error-tone` (or `-recorder`, the microphone's). Any failed step reads `NOT CHECKED <step>`
  however many cycles completed before it; the judgement on those cycles stays as
  `completedCyclesVerdict`, and a `HALF RATE` still wins, since the clock is judged on completed cycles
  only and so fired before the failure. None of the runs quoted above had a failed step, a silent
  baseline or a silent window, and each graph baseline's RMS is 0.14 or 0.35 (`baselineRms`), so every
  verdict above stands under the new rules. The microphone's baseline RMS was not recorded before the
  rule (`micBaselineRms` is new); its fundamentals, −47.6 to −55.5 dB, sit far above the floor. The
  earliest graph-only run, `mvk21dt6-catu` (an early detector, not quoted above), read `CLEAN` on a
  purity of +Infinity in every window; it would now read `NOT CHECKED no-baseline-purity`.

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

**Reproduced on the microphone once the render thread is held: every 80 ms worklet-thread stall leaves
about 32 ms of zeros in the captured input** (see "Render-thread stalls" at the end of this section).
**Without a stall, the steady-state symptom does not appear, and a stream-start gap does, every time, in
two of the four cells.** The runs are Chrome 155.0.8059.85 on macOS 15.6.1 (Apple silicon), all in Playwright's Chrome
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
are inside it, `CLEAN` on neither, and `NOT CHECKED <s>-s` under 30 s of capture. A head longer than
5 s is no signal in the first 5 s (a muted microphone delivers exact zeros) and reads `NOT CHECKED
no-signal`, not `CLEAN`. A source that died during the minute leaves zeros that are not the browser's:
a track that fired `ended` or `mute` (or read muted at the start or the end), or any quantum whose input
had no channel (`emptyInputQuanta`), reads `NOT CHECKED source-ended`, `source-muted` or
`source-empty-input`, the counts kept as figures. That rule came after the runs below: every one of them
records 0 empty-input quanta, and none recorded the track's events, so their verdicts stand on the
empty-input count alone.

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
  a USB input, is the next step if the unprovoked half is ever wanted.

#### Render-thread stalls (`&stallMs`)

The tracker's mechanism is the sink feeding a `MediaStreamAudioSourceNode` writing zeros when its FIFO
underruns, which happens when the render thread falls behind. The runs above never made it fall behind.
`&stallMs=<ms>` (default 0) with `&stallEvery=<ms>` (default 1000) does. It adds a node of its own,
`public/chromium-capture-stall.js`. Every `stallEvery` ms of the capture, the main thread posts
`stallMs` to that node and awaits the answer. The node's message handler busy-waits that long on the
worklet thread, which is the render thread, and answers with the `currentFrame` the stall began at. The
recorder reports the context frame of its first quantum, so each stall lands on a capture frame. The
suspend / resume tone file is not reused because it renders audio; the stall is the same 80 ms
synchronous task.

A run or duplicate after the start window that starts in a stall's span is reported apart
(`stallZeroRun*`, `stallDuplicate*`) and counted in `verdictDetail` ("<n> of <m> zero runs at stall
times"). The verdict word does not change. The span runs from one quantum before the stall frame to two
stall lengths and one quantum after it (−128 to +7 808 frames for 80 ms at 48 000). The first rule tried
was one quantum either side of the stall frame. It counted 0 of 124 runs on the first microphone run
(`mvk8l97h-c4vh`), because the zeros come during the catch-up after the stall, not at its frame.
`zeroRunFramesSinceStall` lists, for every run, the frames since the stall before it.

Five rows ran on 2026-10-22, in Playwright's Chrome 155.0.8059.85 on macOS 15.6.1, with a real click and
60 s each. The microphone rows ran unattended, on the real built-in microphone. Every row made 55 stalls,
each answered in 79.2 to 80.5 ms. No track started muted, fired `mute` or `ended`, or fed the recorder an
empty input, in any row. The same-context destination clone does not start muted, so the
`source-muted` rule stands as it is.

| envelope | source | rate | stalls | zero runs after the start window | at stall times | duplicates | verdict |
|---|---|---|---|---|---|---|---|
| `chromium-capture-gaps-mvk8ibbw-6u1w.json` | loopback | 48 000 | 55 × 80 ms | 0 | 0 | 0 | `CLEAN` |
| `chromium-capture-gaps-mvk8juge-cjxt.json` | loopback | 44 100 | 55 × 80 ms | 0 (start window: one 441-frame run) | 0 | 0 | `START GAPS` |
| `chromium-capture-gaps-mvk8sh5j-wdul.json` | mic | 48 000 | 55 × 80 ms | 137 | 116 | 0 | `GAPS` |
| `chromium-capture-gaps-mvk8tv7j-emkw.json` | mic | 44 100 (track 48 000) | 55 × 80 ms | 60 | 60 | 0 | `GAPS` |
| `chromium-capture-gaps-mvk8qfyt-uyws.json` | loopback, control | 48 000 | none | 0 | — | 0 | `CLEAN` |

The runs on the microphone fall into three kinds:
- **One long run per stall.** At 48 000, 56 runs of 512 to 1 792 frames (mean 1 529, 32 ms) start 2 304 to
  3 456 frames (48 to 72 ms) after a stall frame. At 44 100, 56 runs of 530 to 1 589 frames (mean 1 368,
  31 ms) start 2 175 to 3 149 frames (49 to 71 ms) after one. Each row has 56 long runs against 55
  stalls. The envelope gives every run's offset from the stall before it, not which stall that is, so it
  cannot say which stall has two long runs or whether any stall has none.
- **Short runs right after it.** At 48 000, 60 runs of 128 or 256 frames start 3 712 to 6 912 frames after
  a stall. At 44 100 there are 4, of 177 frames, 3 516 to 3 769 frames after.
- **Single quanta between stalls, at 48 000 only.** 21 runs of 128 frames each start 8 320 to 51 328 frames
  after the last stall, outside every span. The four microphone minutes at 48 000 without stalls held
  none. Their cause is unexplained: only one stall length and one cadence were run, so nothing here tests
  whether the stalls produce them.

Three earlier stall runs are kept as data, not quoted. `mvk8l97h-c4vh` (microphone 48 000) was judged on
the one-quantum rule. `mvk8nohc-3t2j` (microphone 48 000, 114 of 137) and `mvk8p2jh-di4o` (microphone
44 100, 65 of 65) listed only the first 60 runs' offsets. All three show the same pattern.

What the stall rows show:
- **The mechanism is reproduced.** A held render thread makes the microphone's sink underrun, and it
  writes zeros. An 80 ms stall costs about 32 ms of input, starting about 48 ms into the catch-up. That
  reads as a FIFO holding about 48 ms: the catch-up drains it, then gets zeros for the rest of the stall.
  The 48 ms is inferred from where the zeros start, not measured: only 80 ms stalls were run.
  The probe cannot say whether the input that arrived during the stall was dropped or delayed: the tone
  in the room has no reference to align it against.
- **No duplicates, as shipped Chrome predicts.** A later comment on the tracker, from a Microsoft engineer, reads: "It looks
  like zero data was set when underrun in the WebAudioMediaStreamAudioSink::ProvideInput. I've tried
  couple of prototypes; Increasing FIFO max frames size (check is made in the OnData), the second one is
  using the prior frame in the ProvideInput when undervalue. the first one doesn't work, but the second
  one is promising". Shipped Chrome fills an underrun with zeros. "Duplicated blocks" describe that
  engineer's unshipped second prototype, which repeats the prior frame. So zero duplicates in every row
  is the expected reading on shipped Chrome, not a miss. The duplicate check stays: it would flag that
  prototype, or a later fix shipped that way. The built-in microphone and speakers also share one
  clock.
- **The loopback does not underrun.** Its producer is a `MediaStreamAudioDestinationNode` in the same
  context, which renders on the stalled thread. When the consumer stops, so does the producer. This is
  the reading, not a measurement of the FIFO.

What it means for the register:
- **Moved to "Measured here".** Zero runs coincide with stalls in two rows, the microphone at both
  rates.
- **A recording loses input whenever the engine's render thread is held for longer than the sink's
  buffer.** A long WASM compile, a large message handled on the worklet thread, or a heavy `process()`
  during a take would do it.
- **The recording-alignment harness cannot see this.** It records through the loopback, whose producer
  stalls with the consumer. Only a real input shows it.

#### The tracker's JSFiddle lever (`&latencyHint`) and a USB microphone (`&input`)

A commenter on the tracker posted a repro ([jsfiddle.net/btsimonh/cquzx28n](https://jsfiddle.net/btsimonh/cquzx28n/)).
It opens `getUserMedia({audio:{mandatory:{echoCancellation:false}}})` into a 4096-frame ScriptProcessor (the
author says a worklet shows the same) in a context made with `new AudioContext({ latencyHint, sampleRate })`.
It reports runs of zeros longer than 200 samples. Its findings, on Windows 10 with Chrome 77:
- **Hole size.** The holes are multiples of 480 samples at 48 kHz, exactly 10 ms.
- **The default hint.** There is empty data at the start (this probe's `START GAPS`), and "regularly at
  ~30 s there is a 10 ms hole".
- **`latencyHint` 0.04.** Holes appear within seconds. The example log has a 1 920-zero hole at 0 s and
  a 480-zero hole at 6.71 s.
- **A hint of 0.1 s or more.** "things start to go very badly wrong".
- **Its precondition.** "you MUST have a real mic connected, and at least enough noise in the room to not
  have complete silence from the audio input". The no-signal rule already refuses a silent input.

The probe takes two parameters for this:
- **`&latencyHint=<seconds|interactive|balanced|playback>`** (default `interactive`) goes to the capture
  context's constructor. The figures record the hint and the resulting `baseLatency`.
- **`&input=<label text>`** picks the microphone whose `enumerateDevices()` label holds the text.

New figures are `runLengthsIn480s`, every run's length in units of 480 frames, and `captureRms`, the RMS
after the head: room noise plus the page's own tone from the speaker at −20 dB. The microphone here was
the user's "Amazon USB Streaming Mic (0d8c:0220)", a C-Media USB device. It is not the system default
input (the built-in microphone is), so every row selects it explicitly with `&input=USB`; `&input=Amazon`
picks the same device. Every row's envelope records the label, and `getSettings()` read 2 channels,
48 000, echo cancellation off, the same device id (`8a72a83e…`) in all six. It runs on its own USB clock
while the output was the built-in speaker. That is the different-clocks setup the tracker ties the
duplicates to. The user was present and the room had its normal noise. The runs were in Playwright's
Chrome 155.0.8059.85 on macOS 15.6.1, 2026-10-22, with a real click and 60 s each.

| envelope | source | rate | `latencyHint` → `baseLatency` | stalls | runs after the start window (at stall times) | lengths | duplicates | RMS | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `chromium-capture-gaps-mvk9469i-pqmu.json` | USB mic | 48 000 | interactive → 5.8 ms | none | 0 | — | 0 | 0.0074 | `CLEAN` |
| `chromium-capture-gaps-mvk8zu9c-3vg1.json` | USB mic | 48 000 | 0.04 → 40.8 ms | none | 0 (start window: one 128) | — | 0 | 0.0156 | `START GAPS` |
| `chromium-capture-gaps-mvk918b0-8vcw.json` | USB mic | 48 000 | 0.1 → 92.9 ms | none | 1 (start window: one 384 at frame 8 448) | 384 (0.8 × 480) at frame 26 368 | 0 | 0.0076 | `GAPS` |
| `chromium-capture-gaps-mvk92m9e-0dhp.json` | USB mic | 48 000 | 0.2 → 92.9 ms | none | 1 | 256 (0.53 × 480) at frame 26 496 | 0 | 0.0073 | `GAPS` |
| `chromium-capture-gaps-mvk95l34-fnpf.json` | USB mic | 48 000 | interactive | 55 × 80 ms | 138 (114) | 55 of 1 280–1 792, 2 304–2 432 after a stall | 0 | 0.0073 | `GAPS` |
| `chromium-capture-gaps-mvk96z7f-ftoi.json` | USB mic | 44 100 (track 48 000) | interactive | 55 × 80 ms | 62 (62) | 57 of 530–1 706, 2 175–3 001 after a stall | 0 | 0.0074 | `GAPS` |
| `chromium-capture-gaps-mvk98cij-giwz.json` | loopback | 48 000 | 0.2 → 92.9 ms | none | 0 | — | 0 | 0.354 | `CLEAN` |

No track started muted, fired `mute` or `ended`, or fed the recorder an empty input. The 0.04 row's RMS
is higher only because the room was louder in that minute.

What these rows show:
- **The stall result holds on a microphone with its own clock.** The USB rows match the built-in ones:
  long runs 48 ms into a stall's catch-up, short runs right after, and at 48 000, 24 single quanta
  outside every span. Of those 24, one comes before the first stall, at frame 11 648 (the first stall is
  at 48 000), and 23 come between stalls.
- **A larger hint gives one short run about 0.55 s in, not the fiddle's 10 ms holes.** At 0.1 s the run is
  384 frames at frame 26 368, 21 888 frames (456 ms) after the head. That row also has a 384-frame run in
  the start window, at frame 8 448. At 0.2 s the run is 256 frames at frame 26 496, 17 664 frames (368 ms)
  after the head. All three lengths are whole render quanta and none is a multiple of 480. The minute after it is clean. Chrome capped the 0.2 s hint at the same 92.9 ms
  `baseLatency` as 0.1. Nothing "went very badly wrong".
- **No 10 ms hole at about 30 s and no duplicate in any row**, at any hint, on either microphone. The
  fiddle's 480-frame quantisation reads as the Windows capture path's 10 ms buffers. Here every hole is
  a multiple of 128 frames (one 441-frame exception on the loopback at 44 100).
- **The device-free counterpart is clean.** The loopback at a 0.2 s hint reads `CLEAN`.

#### Silence detection on the output (`&dither`, `&seconds`)

A later comment on the tracker names another lever: "Chrome gives up on the OUTPUT device if it sees
>30s of complete silence … if you wish to 'record' audio using a scriptprocessor, or audioWorklet, you
MUST NOT set the output buffer to all zeros, else Chrome ditches your output device and the clocks then
go to hell". The commenter's fix writes `outputSamples[n] = (n&1)/10000`, a tiny dither, and the holes
stop. They identified it with chrome://tracing: "the audio output device trace was active for exactly
30s". Their fiddle connects its recording node to the destination (`node.connect(ac.destination)`). The
commenter first considered a Realtek driver effect after silence (Windows, a Dell XPS 13). They
discounted it because the holes persisted while a tone played from another tab, and with the standard
Windows driver. That is their reasoning, not a measurement. This note's reading: it fits Chrome's silence detection being per output stream, since the recording tab's own output was still silent. This Mac has no such driver, so
the driver angle does not apply here. Another later comment on the tracker names the mechanism: "If the
audio output is silent (exactly 0?) for 30 sec or more, Chrome switches from the expensive audio HW to
a fake software audio device. I think this was intended to save battery when there's no audio output.
Timing may not be perfect. As you've discovered, you can fool this by outputting a very small value."

**What the earlier rows had.** The recorder's output was not connected to anything. The microphone rows
also played the 1 kHz tone to the speaker at −20 dB, so no earlier microphone row ever had a silent
output. The loopback rows sent nothing to the destination, a silent output, and read clean in 60 s
minutes. Now the recorder is connected to the destination in every row (`outputConnected`), and three
switches control what reaches the output:
- **`&dither=1`.** The recorder writes `(n & 1) / 10000` to its output on every frame. The default
  writes zeros. The dither leaves every even frame at exactly 0, but no quantum is all zeros. That is
  the commenter's working fix, kept as it is.
- **`&speakerTone=0`.** It turns the microphone rows' speaker tone off, so the recorder's output is all
  that reaches the destination.
- **`&seconds=<n>`.** It sets the capture length, 30 to 600 s, default 60.

A witness reads the context once a second during the capture. It records `baseLatency`,
`outputLatency` and `sinkId` per second (`baseLatencyPerSecond`, `outputLatencyPerSecond`,
`latencyChangedAtSecond` for the first second either differs from the reading at 1 s, and
`sinkIdChanged`, yes or no), since a fake device may report different latencies. The baseline is the
1 s reading because `outputLatency` reads 0 the instant after `resume()`. In every row below, neither
latency nor `sinkId` changed around the 30 s mark, so the switch is not observable through these
readings; the hole in the input is the only evidence of it. It also reads `currentTime`
against `performance.now()` and
records each second's ratio (`clockRatioPerSecond`, `clockRatioMin` and the second it happened, and
`clockDipSeconds` for any second under 0.75). The detail also names zero runs that start within 2 s of
the 30 s mark of context time (`runsNear30s`; the mark is converted to a capture frame with the
recorder's first context frame).

The USB microphone was disconnected by the time these rows ran; Chrome listed only the built-in
microphone and Zoom's virtual device, so the rows use the built-in microphone. The user was present and
the room had its normal noise. The runs were in Playwright's Chrome 155.0.8059.85 on macOS 15.6.1,
2026-10-22, with a real click and 90 s each.

| envelope | source | `latencyHint` | output | runs after the start window | near the 30 s mark | clock min (second) | RMS | verdict |
|---|---|---|---|---|---|---|---|---|
| `chromium-capture-gaps-mvk9nuuo-s3x1.json` | built-in mic | interactive | zeros | 1: 128 at frame 1 433 728 | 1, 1 024 frames (21 ms) after it | 0.990 (78) | 0.0061 | `GAPS` |
| `chromium-capture-gaps-mvk9wabz-l4w8.json` | built-in mic | interactive | zeros | 1: 128 at frame 1 433 984 (start window: one 128 at frame 2 432) | 1, 1 024 frames (21 ms) after it | 0.990 (31) | 0.0036 | `GAPS` |
| `chromium-capture-gaps-mvk9pzn2-83bx.json` | built-in mic | interactive | dither | 0 (start window: one 128) | 0 | 0.991 (1) | 0.0072 | `START GAPS` |
| `chromium-capture-gaps-mvk9ybig-f9be.json` | built-in mic | interactive | dither | 0 (start window: one 128) | 0 | 0.993 (55) | 0.0045 | `START GAPS` |
| `chromium-capture-gaps-mvk9s0lh-u9sp.json` | built-in mic | 0.1 → 92.9 ms | zeros | 1: 256 at frame 1 435 520 | 1, 17 920 frames (373 ms) after it | 0.925 (79) | 0.0050 | `GAPS` |
| `chromium-capture-gaps-mvk9u1pc-xmca.json` | built-in mic | 0.1 → 92.9 ms | dither | 0 | 0 | 0.925 (4) | 0.0050 | `CLEAN` |
| `chromium-capture-gaps-mvk9lpjr-ddsz.json` | loopback | interactive | zeros | 0 | 0 | 0.924 (1) | 0.354 | `CLEAN` |

Two more rows ran after the latency and sink witness was added, with the same settings as the first two
rows (built-in microphone, default hint):
- **Silent output** (`chromium-capture-gaps-mvka3ha2-0d3j.json`) reads `GAPS`. It has one 128-frame run
  at frame 1 434 240, 1 536 frames (32 ms) after the mark.
- **Dither** (`chromium-capture-gaps-mvka5n99-y698.json`) reads `START GAPS`, with `runsNear30s` 0.

In both, `baseLatency` stayed 5.8 ms and `outputLatency` stayed 28.0 ms every second
(`latencyChangedAtSecond` null). The sink stayed `(default)` (`sinkIdChanged` no), and the clock
ratio stayed at 0.99 or above. So the switch to the fake device, if that is what happens, does not show
in anything the page can read. Only the hole in the input shows it.

A second real device came after those rows: the user's "fifine Microphone (3142:a010)" USB microphone
(MV-SILICON, not the default input, selected with `&input=fifine`). `getUserMedia` reported 2 channels,
48 000 and echo cancellation off. It ran with the latency and sink witness, the user present and the
room's normal noise:

| envelope | output | runs after the start window | near the 30 s mark | start window | RMS | verdict |
|---|---|---|---|---|---|---|
| `chromium-capture-gaps-mvkazeel-sexy.json` | zeros | 2: 128 at frame 1 433 600, 128 at frame 1 789 440 | 1, 640 frames (13 ms) after it | none | 0.0018 | `GAPS` |
| `chromium-capture-gaps-mvkb5nr6-uwfr.json` | zeros | 1: 128 at frame 1 433 984 | 1, 1 024 frames (21 ms) after it | one 128 at frame 7 168 | 0.0005 | `GAPS` |
| `chromium-capture-gaps-mvkb1ev7-mdld.json` | dither | 1: 128 at frame 1 525 248 | 1, 92 544 frames (1.93 s) after it | none | 0.0009 | `GAPS` |
| `chromium-capture-gaps-mvkb3lxu-snp9.json` | dither | 0 | 0 | one 128 at frame 7 424 | 0.0009 | `START GAPS` |

In all four, `latencyChangedAtSecond` read null and `sinkIdChanged` read no. The clock never ran under
0.98 in any second, and there were no duplicates.

What the fifine rows add:
- **The silent hole repeats on a second device.** Both silent rows have a 128-frame run 13 or 21 ms
  after the 30 s mark, the place the built-in rows put it.
- **The dither did not remove every hole on this device.** One dithered row has a 128-frame run 1.93 s
  after the mark. The first silent row has a second run, 7.4 s after the mark.
- **The fifine is very quiet here.** Its RMS was 0.0005 to 0.0018, against 0.0036 to 0.0072 for the
  built-in microphone. A noise gate in the microphone would also give runs of exact zeros, so these
  two extra runs are not attributed. Only the runs just after the mark match the built-in pattern.

No row had a duplicate, an empty input, or a track that started muted or fired `mute`. The microphone
rows' RMS is room noise alone, with no speaker tone. The `&input=USB` attempt before the built-in microphone rows read `NOT CHECKED
mic-Error-no-input-matching-USB` and is not quoted.

What these rows show:
- **The lever reproduces, as one render quantum or two.** Every silent-output built-in microphone row
  (4 of 4) has exactly one zero run after the start window, and it sits just after the 30 s mark of
  context time: 1 024, 1 024 and 1 536 frames after it at the default hint, 17 920 at hint 0.1. Every
  dithered built-in row (4 of 4) has none. On the fifine, both silent rows have the hole just after the
  mark, one of them with a second run 7.4 s later. The dither held in 1 of 2 fifine rows.
- **The holes are not 10 ms here, and the clock does not "go to hell".** The runs are 128 and 256 frames.
  The lowest per-second ratio in any row is 0.92, at the first second or in rows with a 92.9 ms
  `baseLatency`, where one-second readings are jittery. No second dips under 0.75.
- **The loopback is clean with a silent output.** Its producer is in the same graph, with no device FIFO
  between, so a dropped output device has nothing to underrun there. This is a reading, not measured.
- **Earlier rows are unaffected.** The tone-on microphone rows never had a silent output. The 60 s
  loopback rows were silent and clean, as here.

What it means for the SDK:
- **A silent engine output would meet this hole.** An engine worklet that renders exact zeros while
  recording (nothing playing, metronome off, monitoring off) would be moved to the fake device after
  30 s, and a take longer than that would get a hole just after the 30 s mark. This is a reading.
  Whether the engine's output is exactly zero then is not measured.
- **The commenter's dither is a workaround.** It removed the hole that silence produced on the built-in
  microphone (4 of 4), and on the fifine in 1 of 2 rows.
  A dither in the engine output while recording is the obvious remedy. It is an upstream suggestion
  candidate, not drafted.

#### Cross-context MediaStream (comment 50, `&source=crosscontext`)

Comment 50 on the tracker (the author of extendable-media-recorder) reports this with an AudioWorklet
recorder: "I can see the tests failing because of occasional blocks of zeros. Usually they are multiples
of 441 samples long. I created a simplified example which uses one AudioContext to generate audio and
another one to record it. The audio is passed from one AudioContext to the other via a MediaStream. The
problem doesn't happen consistently which is why the test gets repeated after 40 seconds." The user
pasted the comment's dev-console script; it is kept at
`.superpowers/sdd/2026-10-22-chromium-watched-issues-measurement/tracker-40103985-comment-50-script.js`.

`&source=crosscontext` mirrors its graph:
- **The generator.** It is `new AudioContext()` at the device rate (or `&generatorRate=`), with a default
  `OscillatorNode`, a 440 Hz sine at full scale, feeding a `MediaStreamAudioDestinationNode`.
- **The capture.** The capture context opens that node's stream itself, not a clone, through a
  `MediaStreamAudioSourceNode` into this probe's recorder.

`&generatorDither=1` also plays a looped `(n & 1) / 10000` buffer to the generator's destination.

Three facts about the script, and how the probe treats each:
- **Neither of its contexts outputs to the speakers, and each attempt lasts 40 s.** The generator feeds
  only the stream, and the detector node connects to nothing. So both contexts cross Chrome's 30 s
  silence threshold in every attempt, which makes the fake-device switch a candidate cause of the
  comment's intermittent zeros. The probe tests it with silent rows, then with `&dither=1` on the
  recorder output and `&generatorDither=1` on the generator. The per-second witness runs on both
  contexts (`generator…` figures).
- **Its detector does not measure run length.** It reports the first all-zero quantum after recording
  frame 1 024 and stops. The probe's recorder keeps every frame, so the run lengths and their
  441-multiples (`runLengthsIn441s`) extend it.
- **The comment says the problem is intermittent.** The silent mirrored row was run three times.

On this machine `new AudioContext()` came up at 44 100: the output device's rate. The exact mirror is
therefore 44 100 on both contexts. The rows ran in Playwright's Chrome 155.0.8059.85 on macOS 15.6.1,
2026-10-22, with a real click, 90 s each and no microphone. The capture context's own output was silent
(the recorder writing zeros) unless `&dither=1`.

| envelope | capture / generator rate | recorder dither | generator dither | start-window run | runs after it | near the 30 s mark | verdict |
|---|---|---|---|---|---|---|---|
| `chromium-capture-gaps-mvkacrmf-k8rx.json` | 44 100 / 44 100 (exact mirror) | no | no | 441 at frame 1 010 | 0 | 0 | `START GAPS` |
| `chromium-capture-gaps-mvkaes9g-srld.json` | 44 100 / 44 100 (exact mirror) | no | no | 441 at frame 1 010 | 0 | 0 | `START GAPS` |
| `chromium-capture-gaps-mvkagspp-oi2e.json` | 44 100 / 44 100 (exact mirror) | no | no | 441 at frame 1 010 | 0 | 0 | `START GAPS` |
| `chromium-capture-gaps-mvkaj06l-m0om.json` | 48 000 / 48 000 | no | no | none | 1: 480 at frame 1 534 112 | 1 | `GAPS` |
| `chromium-capture-gaps-mvkalf9k-bm9r.json` | 48 000 / 48 000 | no | no | none | 1: 480 at frame 1 534 112 | 1 | `GAPS` |
| `chromium-capture-gaps-mvkb9tol-97v7.json` | 48 000 / 48 000 | no | no | none | 1: 480 at frame 1 534 112 | 1 | `GAPS` |
| `chromium-capture-gaps-mvkannu4-bvse.json` | 48 000 / 48 000 | no | yes | none | 1: 480 at frame 1 534 112 | 1 | `GAPS` |
| `chromium-capture-gaps-mvkapr64-7nb1.json` | 48 000 / 48 000 | yes | no | none | 0 | 0 | `CLEAN` |
| `chromium-capture-gaps-mvkart84-a3fm.json` | 48 000 / 48 000 | yes | yes | none | 0 | 0 | `CLEAN` |
| `chromium-capture-gaps-mvkattvu-a4v5.json` | 44 100 / 48 000 | no | no | none | 1: 383 at frame 22 550 (0.51 s) | 0 | `GAPS` |
| `chromium-capture-gaps-mvkbbup9-z9ax.json` | 48 000 / 44 100 | no | no | 412 at frame 3 718 | 0 | 0 | `START GAPS` |

The capture read the tone at RMS 0.707, a full-scale sine, in every row. No row had a duplicate, an
empty input, a muted track, or a latency or sink change on either context. The clock readings:
- **The capture context's lowest second** is 0.910, in `mvkacrmf-k8rx` at second 90.
- **The generator's lowest** is 0.874, in `mvkb9tol-97v7` at second 91: the last interval, cut short when
  the capture ended. All three 48 000 silent rows have their generator low in that last second.
- **Away from the first and the last two seconds,** every row stays at 0.988 or above. The exception is
  `mvkacrmf-k8rx`, whose capture context reads 0.910 at second 90 of 91.

Unlike the script's detector, this probe's recorder is connected to the recording context's
destination. It writes zeros there, so the recording context's output is silent in both, and the
silent rows are equivalent in output. The 48 000 / 44 100 row was run twice. The first run,
`mvka9y3q-ofr0`, came from an earlier build without `runLengthsIn441s` or `contextSecAtCaptureStart`
and with the latency baseline at second 0, so it is kept as data, not quoted. It read the same: one
412-frame start-window run at frame 3 238, nothing after.

The witness's latency baseline is the reading at 1 s, because `outputLatency` reads 0 the instant after
`resume()`. A real change at second 1 would be hidden by it. These envelopes compared against second 0:
`mvka3ha2-0d3j`, `mvka5n99-y698` and `mvka9y3q-ofr0`. Those from `mvkacrmf-k8rx` on compare against
second 1, and the latest record it as `witnessBaselineSecond`.

What these rows show:
- **The exact mirror gives exactly one 441-frame block at the stream's start, 3 of 3.** This is
  comment 50's "multiples of 441 samples", at 44 100 on both contexts. It comes 441 frames after the
  first non-zero frame, as on the same-context loopback at 44 100: one 10 ms chunk of signal, then
  one chunk of zeros. The script's detector skips the recording context's frames up to 1 024. This run sits at
  capture frame 1 010 to 1 451, and the capture starts a few hundred context frames into the recording
  context, so the detector would likely catch it on the first attempt. The probe cannot confirm that
  from its own frames. The comment's "intermittent" does not match a 3 of 3 here. This block and the
  register's 441-frame delay step share only the node path, a stream into a `MediaStreamAudioSourceNode`
  at 44 100. This is a zero run in the capture; the step is a change in delay. The two are related by
  the path alone.
- **At 48 000 on both contexts, a hole of exactly 480 frames (10 ms) comes about 32 s in, 3 of 3** with
  both outputs silent (`mvkaj06l-m0om`, `mvkalf9k-bm9r`, `mvkb9tol-97v7`). It also comes in the row with
  only the generator dithered (`mvkannu4-bvse`). Every one sits at the same capture frame, 1 534 112,
  1.97 s after the capture context's 30 s mark.
  This is the tracker's 480-sample hole. The recorder's dither removes it, with or without the
  generator's. The generator's dither alone does not. So the silence that matters is the recording
  context's output, as with the microphone. Neither context's latencies or sink changed around it.
- **Mixed rates give no hole near 30 s.** One run each: 44 100 capture with a 48 000 generator has one
  383-frame run at 0.51 s, and 48 000 capture with a 44 100 generator only a start-window run.
- **The exact mirror at 44 100 gave no hole near 30 s either,** with a silent output, 3 of 3. Why the
  48 000 contexts meet the silence hole and the 44 100 ones do not is not established. The device ran
  at 44 100, so a 48 000 context is resampled to it.
- **The register's cross-context entry does not hold for this bare path.** The entry says a
  destination-node stream from another context reads silent. Here the capture read the tone at full
  scale in every row. That entry was measured through the SDK's capture and a `getUserMedia` override,
  and this probe uses neither.

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

**Rules added after every run above.** The stored readings carry a schema `version` (2) and the run's
`requestedBytes`; an entry without them, an older page's, is cleared with a console warning instead of
judged, so a run stored before the change needs its in-session half run again before a restart. The
browser fields are checked as strings. A write that cannot be judged reads `NOT CHECKED write-none`
(nothing written), `write-short` (fewer bytes than asked for) or `write-size-mismatch` (`getSize()` is
not the bytes written), and is not stored for a restart. `estimate()` without a usage reads null, not
NaN: in the session `NOT CHECKED readings-missing`, on the restart load `NOT CHECKED
restart-no-estimate`, which is never kept as the last restart reading. The worker closes the handle
and removes the file as separate steps, so a close that throws no longer skips the delete or hides the
write's own error. Every envelope above wrote and read back 67 108 864 bytes with every reading present,
so every verdict above stands.

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
  (`node_modules/@opendaw/lib-fusion/dist/opfs/OpfsWorker.js` as installed at SDK 0.0.177:
  `createSyncAccessHandle` at line 158, `truncate(data.length)` on write at line 19, `removeEntry` with
  no `truncate(0)` at lines 81, 108 and 111; the register names the methods, these lines are the
  pointer). The upstream issue is drafted for review in
  `drafts/TO-REVIEW-opendaw-opfs-delete-usage.md`.

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

### clock-drift (40726491)

**Reproduced: the context ↔ performance relation `getOutputTimestamp()` reports is not steady.** Chrome
155.0.8059.85 (macOS 15.6.1, the user's Chrome through claude-in-chrome), 2026-10-23. The probe is SDK-free:
the bfcache probe's graph (a worklet tone and an oscillator into a quiet gain), the pair and `outputLatency`
read on a worker tick every 10 ms (frames stop on a hidden page), 20 s per phase. The figure is the relation's
offset from the first sample, `(Δcontext − Δperformance) × rate`, in frames; a step is a change over half a
quantum between consecutive samples. Step times are page time (`performance.now()`), not phase time; the idle
phase starts a few seconds after load.

Why it was built: the MIDI output timing audit (2026-10-23, `debug/2026-10-23-midi-output-timing/note.md`) saw
the relation move by ±3 ms within most 10 s repeats at 44.1 kHz with the SDK's engine running, `outputLatency`
constant; the engine's stamps followed the live relation and the pre-scheduled control did not, so the two arms
disagreed by the drift. Whether that was the SDK's doing or the browser's needed a page with no SDK on it.

| envelope | probe build | context rate | device rate | phases | steps | shape | `outputLatency` |
|---|---|---|---|---|---|---|---|
| `chromium-clock-drift-mvlittyz-4k1r.json` | before the device-rate / ramp / `await` figures | 44 100 | 44 100 (this Mac's) | idle, jank, graph | 1: −229 frames at 12.04 s (idle) | then a slope of about +0.25 frames/s (−224 → −214 over 40 s) | 28.00 ms throughout |
| `chromium-clock-drift-mvliwl6b-50bw.json` | same | 48 000 | 44 100 | idle, jank, graph | 14: −278 frames every 4.49 s, in every phase | a sawtooth; 278 / 4.49 s implies +62 frames/s between snaps (offset −247 … +45) | 28.00 ms throughout |
| `chromium-clock-drift-mvlj1841-ip0c.json` | before the `await` labelling (the 55 s hide wait is counted under `graph`, the 4.5 s return wait under `hidden`) | 48 000 | 44 100 (read by the probe) | idle, jank, graph, hidden (3 185 samples read hidden; frames stopped for 24.6 s) | 35: one −248 at 5.44 s, then −278 every 4.49 s, in every phase, hidden included | the same sawtooth; ramp 62–64 frames/s in every phase | 28.00 ms throughout |
| `chromium-clock-drift-mvljhb28-i7ci.json` | shipped | 44 100 | 44 100 (read by the probe) | idle, jank, graph, load (a worklet burning 60 % of every quantum) | 1: −997 frames at 9.31 s (idle) | then a slope of about +0.25 frames/s read off the offset range (−992 → −978 over 60 s; the per-sample median `RampFramesPerSec` reads −0.09 on so flat a series, where the pair's per-quantum updates dominate the sample-to-sample deltas); the load phase steps nothing | 28.00 ms throughout |

- **On a resampled context the relation is a sawtooth.** 48 kHz over this Mac's 44.1 kHz output device: the
  performance-time side gains about 62 frames per second on the context side, 0.13 %, until a snap of 278
  frames (5.8 ms) every 4.49 s puts it back; 14 of 14 snaps in one run, 34 of 35 in the other (the first was 248).
  Not a step under load: the jank and graph-change phases show the same period as idle, and so do 32 s with the
  window hidden (a tab playing audio is exempt from Chrome's background throttling, so the hidden phase is a
  condition compared, not a control). 278 frames is not a multiple of 128 (the lattice column counts it as "on"
  within the quarter-quantum tolerance; it is 2.17 quanta). The observation that fits: 278 frames at 48 kHz are
  255.4 frames at 44.1 kHz, one 256-frame device buffer, and 4.49 s × 62 ≈ 278, so the snap is the accumulated
  ramp, a position estimate running 0.13 % fast against the device and corrected by one device buffer at a time.
- **At the device's native rate the relation steps once, early, and otherwise skews slowly.** One step in each
  80 s run, both in the idle phase with nothing happening on the page: −229 frames at 12.04 s page time, −997
  frames (22.6 ms) at 9.31 s in the run with the load phase. Then about +0.25 frames per second, 5.7 ppm, the
  size of a crystal difference between the audio device and the CPU clock and the expected part. No step from an
  80 ms main-thread block every 500 ms, none from a silent gain node connected to and disconnected from the
  destination every 50 ms, none from a worklet burning 60 % of every render quantum for 20 s.
- **`outputLatency` does not move** (28.00 ms on every sample of all four runs), so a page that corrects a
  scheduled time by `outputLatency` does not see the change.
- **The tracker knows the mechanism.** 40693959 (2020, merged into 40726491): the position behind
  `getOutputTimestamp` is updated per render quantum from the renderer's side, not from the device's output
  position; the reporter's log at a large `latencyHint` wanders by 170 ms. 40726491 is open, P3, triaged in
  2026-05. The sawtooth on a resampled context is a sharper instance of the same thing, not a new issue.
- **What was NOT reproduced: the MIDI audit's frequency at the native rate.** The audit saw ±3 ms of movement
  within most 10 s repeats at 44.1 kHz with the SDK's engine running; the SDK-free probe at 44.1 kHz saw one step
  per 80 s and a 5.7 ppm slope, with or without a 60 % render load. So the probe shows the mechanism exists
  without the SDK, not that the engine's workload adds nothing; the audit's wander is attributed to Chrome by
  40693959's mechanism, not by a reproduction. A probe arm with the SDK's engine in the graph would settle it.
- **What it means for the harnesses here:** a pair read once per repeat carries this wander into any figure
  judged against it (the input alignment and combined harnesses' 3 ms-scale terms); the output timing audit
  reads the pair every frame and judges the engine on the live relation. A context at the device's native rate
  is the lesser case. Firefox and Safari are not measured; 40693959 says Firefox reads steady.

### output-latency (388871416)

**Measured: Chrome reports a fixed 161 ms for the Bluetooth headset, 133 ms more than the built-in speaker's
28 ms. The isolated acoustic round trip puts the headset's real extra output latency at about 202 to
281 ms, so the report is low by about 70 ms on a typical stream and about 148 ms on the first stream
after connecting.** The original report read the headset LOWER than the speaker (17 ms against
33 ms) and the triage on current builds reads 200+ ms on a headset; the reported pair agrees with the
triage, and the measured one is higher still. All runs are Chrome 155.0.8059.85 on macOS 15.6.1,
Playwright's Chrome, 2026-10-22, one real click each.

The readout (`?issue=output-latency`, 30 one-second rows, `sinkId` empty, 44 100 Hz) is the context:

| envelope | device label (every row) | base | first row | rows after it |
|---|---|---|---|---|
| `chromium-output-latency-mvk3xjzv-1180.json` | `Default - MacBook Pro Speakers (Built-in)` | 5.8 ms | 0 ms | 28 ms on all 30 |
| `chromium-output-latency-mvk6xq4h-115y.json` | `Default - Defunc TRUE AUDIO (Bluetooth)` | 5.8 ms | 0 ms | 161 ms on all 30 |

The isolated round trip (`&roundtrip=1&isolate=1&gain=1`: the mic and recorder on a context with
`sinkId: { type: "none" }`, the clicks on the output context; 10 of 10 clicks found in every run;
the page's clock links the two, see "The isolated run" below):

| envelope | route | reported output at start / end | round trips first to last (ms) | median |
|---|---|---|---|---|
| `chromium-output-latency-mvk7n65m-w5yf.json` | built-in speaker, headset disconnected, default sink | 28 / 28 ms | 69.58 to 68.27, range 67.92 to 69.81 | 68.86 ms |
| `chromium-output-latency-mvk7p08l-k8r6.json` | Defunc headset, `&sink=Defunc`, earbud at the mic; the first stream after reconnecting | 161 / 161 ms | 352.27 to 341.67 | 349.47 ms |
| `chromium-output-latency-mvk7pwdv-1qu8.json` | headset, same route, second stream | 161 / 161 ms | 269.33 to 277.42 | 272.30 ms |
| `chromium-output-latency-mvk7qhlz-ty15.json` | headset, same route, third stream | 161 / 161 ms | 267.81 to 276.00 | 270.86 ms |

- **The differential is output-only.** The capture path is one clock domain in every run, so headset
  minus speaker is the headset's extra output latency: 349.47 - 68.86 = 280.6 ms on the first stream,
  272.30 - 68.86 = 203.4 ms and 270.86 - 68.86 = 202.0 ms on the next two, against 161 - 28 = 133 ms
  reported. Chrome understates the headset's extra latency by 147.6 ms (first stream), 70.4 ms and
  69.0 ms. About 70 ms on a typical stream; about 148 ms on the first one after connecting.
- **The real latency varies per stream and drifts within one; the reported figure does neither.**
  Between streams, the headset's median ranged from 270.9 to 349.5 ms. Within a stream, the first
  trip to the last moved by -10.6 ms (first stream, about -1.2 ms per click) and +8.1 and +8.2 ms
  (next two, about +0.9 ms per click). The speaker run stayed within 67.9 to 69.8 ms. `outputLatency`
  read 161 ms at the start and the end of every headset run.
- **Side finding (a), measured: `outputLatency` follows the system default device, not the context's
  sink.** The single-context `&sink=speakers` run (below) made a context on the speakers' sink id
  (`ae245f22...`, different from the headset's `a2b231f4...`) while the headset was the default, and read
  161 ms one second after resume and again at the end.
- **The single-context runs stay as data.** The earlier runs, with the mic and the clicks in one
  context, measured 103.22 ms (speaker, `chromium-output-latency-mvk7f761-cq4x.json`), 306.96 ms
  (headset, `...-mvk7dex7-o1zq.json`) and 306.35 ms (`&sink=speakers` with the headset as the system
  default, `...-mvk7bppn-2mc0.json`). Their capture path sat in the output device's clock domain, so their
  difference mixes input and output; the 306 ms speakers-sink run is consistent with the capture, not the
  output, carrying the headset clock's buffering, but that is not separately proven. They are not used
  for the figure. The readout pair (28 and 161 ms) agrees with the reported column of every run.
- **Drift in the single-context runs** was about +0.7 ms per click on the three with the headset as the
  system default, flat on the speaker baseline; the isolated runs show a drift of the same size and
  either sign on the headset only.

#### Acoustic round trip (`&roundtrip=1`)

The readout above reports what Chrome says. The round-trip page measures what the ear gets.
`chromium-watched-issues-debug-demo.html?issue=output-latency&roundtrip=1` opens the built-in
microphone (echo cancellation, noise suppression and gain control off) into a worklet recorder and
plays 10 reference clicks (6 kHz, 8 ms, `loopbackInjection.ts` constants) one second apart at known
context times. It finds each click's arrival in the capture and reports the round trip per click
(median, p95), the reported `outputLatency` and `baseLatency` read one second after resume, the
labels, the mic settings, and writes the capture as a WAV. `&sink=<text>` makes the context's
output the one whose label contains the text (a context made with the `sinkId` option after the mic
is open), so a run does not depend on the system's default; `&gain=` sets the click amplitude
(default 0.5, the reference gain; the speaker runs used 1).

- **Reused:** the click constants from `loopbackInjection.ts`, the chunked worklet recorder pattern and
  `recorderChunkFrames` from the capture-gaps probe, the WAV sink from the suspend/resume probe. The
  combined audit's round-trip code was not reused: it works on SDK takes, this page loads no SDK.
- **Detector:** a tone match, not RMS. A first run with plain RMS found 0 of 10 clicks: the built-in
  mic's room noise (RMS about 0.003) sat above a 0.5-gain click from the speaker. The match is the
  magnitude of the 6 kHz component over an 8 ms window; broadband noise adds little to it. A click is
  accepted when the match peaks above 8 times its pre-click floor. Pure module `chromiumRoundTrip.ts`
  with a Node test (known offsets, no clicks, a click below the noise floor in plain RMS).
- **What the figure means:** the round trip is output path plus air plus the mic's input path (about
  300 ms here, mostly the browser's microphone source node). That constant is the same for any
  output, so the register's figure is the difference: headset round trip minus speaker round trip,
  against the reported difference.
- **The isolated run (`&roundtrip=1&isolate=1`), to split output from input.** Two contexts: a
  capture context made with `sinkId: { type: "none" }` (no device, so no device clock) owns the mic
  and the recorder, and an output context (the default sink or `&sink=`) schedules the clicks. Each
  click's place in the capture goes through the page's clock: `currentTime` read together with
  `performance.now()` every 100 ms on both contexts, the offset taken as a median over the pairs
  within a second (pure helpers in `chromiumRoundTrip.ts`, with Node tests). With the capture path
  fixed, headset minus speaker is output-side only. The pairs use `currentTime`, the render
  position, and not `getOutputTimestamp()`: that call's context time is the sample at the speaker by
  the browser's own latency estimate, so mapping a click through it books the reported `outputLatency`
  into the figure. Its offsets are recorded beside (`outputStampOffsetMs`, `captureStampOffsetMs`) so
  the two can be compared. A browser without the `none` sink reads `NOT CHECKED
  sink-none-unsupported`. It ran first time: `sinkId` read back as `none`, 10 of 10 clicks in every run.
- **What reads `MEASURED` (rules added after every run above, `judgeRoundTrip`).** Fewer than 5 of the 10
  clicks found reads `NOT CHECKED <n>-of-10-clicks-found-missed-…`, naming the output device. On an
  isolated run, clock pairs whose interquartile range around any click is wider than
  `CLOCK_PAIR_MAX_SPREAD_MS` (10 ms) read `NOT CHECKED clock-pair-unstable`; the spreads are figures
  (`outputPairSpreadMs`, `capturePairSpreadMs`). A click found at or before its scheduled time reads
  `NOT CHECKED non-positive-round-trip`. A microphone or capture-context error reads `NOT CHECKED
  mic-<error>` or `capture-context-<error>` with the error's name; `&gain=` outside (0, 1] stops the run.
  The envelopes above carry no pair spread, so the clock-pair rule was not applied to them; their
  verdicts stand on the other two rules (10 of 10 clicks, every round trip positive), and an envelope's
  `verdict` figure is now written first on every output-latency run (the readout's and the round trip's
  envelopes above have none among their figures).
- **How the headset run is done:** quiet room, the headset connected as the output. Hold one earbud against the
  built-in mic (top-left of the keyboard area on a MacBook Pro), then run
  `...&roundtrip=1&isolate=1&sink=Defunc&gain=1` (the headset's label, a substring is enough). The
  speaker run is the same URL with the headset disconnected and no `&sink=`, or with `&sink=speakers`. A 6 kHz click through a Bluetooth earbud is quiet; if clicks
  are missed (`NOT CHECKED n-of-10-clicks-found-missed-...`), raise the system volume or the earbud
  nearer, not the detector.

### Out of scope: the quota sentinel (541725401 / 40068799)

The other half of the watched OPFS entry is `write()` returning an error sentinel instead of throwing
`QuotaExceededError` when the quota runs out (40068799 in incognito, `0xfffffff8`). It needs the
origin's quota exhausted or an incognito profile. Neither probe does that: the usage probe writes
64 MiB and the flush probe 340 MiB against a 14.6 GB quota. It stays watched, for that reason.
