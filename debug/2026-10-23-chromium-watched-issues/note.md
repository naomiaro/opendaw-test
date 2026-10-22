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
| `first-read` | [571344687](https://issues.chromium.org/issues/571344687) — stale first clock read after a slow module load | Builds a worklet node right after `addModule()` resolves (a slow module, a large module, none), five runs each in a running context; the processor reports `currentFrame` from its constructor and first three `process()` calls, judged against the main thread's frame read just before the node was made | `STALE FIRST READ`, `FIRST READ TRUE`, `NOT CHECKED` | not yet run |
| `bfcache` | [575891839](https://issues.chromium.org/issues/575891839) — half-speed worklet clock after a back/forward-cache restore | Measures the context clock against `performance.now()` with a worklet tone and an oscillator control playing, navigates away and back; on `pageshow.persisted` re-measures and judges, otherwise records the `notRestoredReasons` | `HALF SPEED`, `NORMAL`, `NOT CHECKED` | not yet run |
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

`bfcache` and `opfs-usage` judge on a later page load (after the restore, after the browser restart): the
page judges what the earlier run stored as soon as it loads, with no click, and saves that envelope.

## Findings

One section per issue, filled as each probe runs: the Chrome version and date, the verdict, the figures,
and what it means for the register entry.

### first-read (571344687)

Not yet run.

### bfcache (575891839)

Not yet run.

### suspend-resume (560233271)

Not yet run.

### capture-gaps (40103985)

Not yet run.

### opfs-usage (436552046 / 401692415)

Not yet run.

### opfs-flush (40909520)

Not yet run.
