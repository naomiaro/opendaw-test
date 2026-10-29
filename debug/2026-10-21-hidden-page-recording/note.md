# Recording while the page is hidden — register & results

**Title:** Recording while the page is hidden or its main thread blocked — what the recorder
does at the start, the middle and the stop of a take, and a frame driver that keeps the
demos' engine sync alive behind another window

**SDK Pin:** `@opendaw/studio-sdk@0.0.177` (installed npm package; WASM engine only; the rows below were measured on 0.0.176, the three `modal` rows re-run on 0.0.177)

**Harness:** unlisted debug demo
`recording-hidden-window-debug-demo.html[?driver=window|hidden-safe][&interrupt=cover|modal][&hideAt=start|mid|stop][&hiddenSeconds=<n>][&rate=48000|44100][&bpm=<n>]`
on the dev server, Chrome on macOS, a real click on Run. One Tape records the recording
alignment harness's synthetic loopback (a click on every beat scheduled on the audio clock, no
microphone) for eight bars at 120 bpm, is interrupted at the chosen moment, and a second take
runs uninterrupted. The summary JSON (`hiddenrec-summary-<runToken>.json`) lands in
`.verify-output/` via the dev server's `/__verify` sink.

**Measurement library:** `src/lib/audit/hiddenRecordingVerdict.ts` (verdicts, the position
freeze and sync resume figures), `hiddenRecordingArtifacts.ts` (summary schema); the harness's
own readers (`recordingAlignment.ts`, `onsetDetection.ts`, `recordingCellRunner.ts`). The
driver: `src/lib/frameScheduler.ts` (the rules, Node-tested), `hiddenSafeFrameDriver.ts`
(the binding), `workerTicker.ts`; installed by `initializeOpenDAW` (`frameDriver` option).

**Design spec:** `docs/superpowers/specs/2026-10-21-hidden-page-recording-design.md`
(deleted in the PR that completes this work, per repo convention; git history keeps it).

## What #290 fixed and what it left

openDAW#290 (closed, shipped in 0.0.158): the recording's ring buffer was drained on the main
thread by a timer, throttled in hidden tabs, and the ring held 0.37 s, so a take recorded
across a tab switch lost most of its audio. The fix drains the ring on a dedicated worker. The
issue named, as "related, lesser", what it left: the engine's main-thread sync runs on
animation frames (`packages/studio/core/src/EngineWorklet.ts`, `AnimationFrame.add(() =>
reader.tryRead())`), and `RecordAudio` resolves the take's file inside its `engine.position`
subscription (`packages/studio/core/src/capture/RecordAudio.ts`, the `catchupAndSubscribe`
at the take's creation). Chrome stops animation frames for a hidden document and a fully
covered window, so while hidden the page's view of the engine stands still: the position, the
recording flags, the take's live length, and anything that waits on them.

The standing recording sweep showed the shape on 2026-10-21: a take started while the window
was behind another app never finalized within the harness's deadlines, and every later repeat
of the run timed out waiting on a position that never settled, because the window stayed
covered for the whole run. The harness's deadlines, not the recorder, were what gave up.

## What a row measures

Two interruptions, three moments:

- `cover`: the page is hidden by a hand (another tab in front, or the Chrome application
  hidden) and waits until it is: before the record request (`start`), at bar 1 with the take
  running (`mid`), or a bar before the stop request (`stop`). It measures the real
  `visibilitychange`, the longest gap between animation frames (`FrameWatch`), the position
  the main thread reads sampled every 100 ms from a worker tick (a flat line while recording
  is `positionFrozenMs`), and how long after the page became visible the position moved
  again (`syncResumeMs`). A run whose interruption lasted under `MIN_HIDDEN_SPAN_MS` (1 s: a
  `cover` that never saw the page hidden, a hand that flicked, an alert dismissed at once by
  a dialog handler) reads `not-hidden` and judges nothing about the interruption.
- `modal`: the page opens its own `alert()` right after the record request, at bar 1, or
  right after the stop request. That blocks the main thread outright: frames, worker
  messages and `visibilitychange` alike. No frame driver can help there; the row says
  whether the recorder survives it.

Per take: finalized (the take's region and file exist and the file's loader reaches `loaded`
within 30 s), the region's length against eight bars less the harness's stop lead (a take
may be SHORT of it by at most 50 ms: the stop request is a frame-old position read landing
on a quantum; a longer take is a stop that landed late, which only adds), the beats matched
and missing by the harness's reader (the metronome's clicks in the low band are the grid;
the reference clicks in the high band anchor the buffer), and the judged median: the
harness's release profile, the adjusted median minus the loopback path's own delay for the
take, tolerance `ALIGNED_TOLERANCE_MS` (2 ms). Verdicts: `intact`, `not-finalized`,
`audio-damaged`, `session-stuck` (the second take never started), `not-hidden`.

**Nothing the page can do hides itself.** A second tab from either browser tooling, a
Playwright page brought to the front, a protocol-level minimize of the window, and a popup of
the page's own moved over its window (exact and oversized) all left Chrome reporting the page
visible; the Playwright-launched Chromium also disables renderer backgrounding. The cover rows
below were hidden by hand (Cmd+H on Chrome, or a tab opened in front), and about half of the
hands did not reach the page either (the row then read `not-hidden` and was re-run); the
register keeps the rows that did.

## The driver

`initializeOpenDAW` hands the SDK's `AnimationFrame.start` an owner of its own instead of
`window` (the SDK calls `owner.requestAnimationFrame(exe)` once per frame from inside `exe`
and drops a callback within 16 ms of the last accepted one). The owner forwards to the real
animation frame while the document is visible, and while it is hidden pumps the pending
callback from a dedicated worker's `setInterval` message every 20 ms (worker timers are not
throttled in hidden pages, which the #290 fix relies on; 20 ms rather than 16 so the SDK's
guard does not drop every other tick), but only while the transport is playing, recording
or counting in, or within two seconds of a transport request or of the last observed
activity. The request gate exists because the engine's own flags reach the page through the
sync these ticks pump: a page hidden and idle when a transport request arrives would
otherwise never see the flag flip and never tick. A hidden idle page stays as idle as today
(every canvas painter is a frame subscriber too). The driver is opt-in, `?frameDriver=hidden-safe`
on any demo URL, the SDK's own path being the default; `?frameDriver=throttled&frameEvery=N` delivers every Nth real frame, for
a sweep that wants a slower engine sync than the display gives (the SDK's guard already makes
a faster display irrelevant).

## Runs (2026-10-21, Chrome 155 on macOS, 48 kHz, 120 bpm)

| driver | interrupt | hideAt | hidden / blocked span | longest frame gap | position frozen | sync resumed after visible | take 1 | take 2 |
|---|---|---|---|---|---|---|---|---|
| window | cover | start | 22.2 s (from before the record request) | 22.3 s | 0 (no sample while hidden: the sampler's messages queue) | 114 ms | intact: finalized in 65 ms, 44 beats (the page's stop wait froze with the page, so the take ran long), median 1.15 ms | intact |
| window | cover | mid | 5.5 s | 5.5 s | 5.4 s | 9 ms | intact: finalized in 5.6 s, 220 beats, median 1.17 ms | intact |
| window | cover | stop | 1.3 s (the stop request issued while hidden) | 1.3 s | 1.2 s | 53 ms | intact: finalized in 1.29 s (the hide's length), 39 beats, median 1.15 ms | intact |
| hidden-safe | cover | start | 4.7 s | 0.64 s | 0 | 43 ms | intact: finalized in 61 ms, 31 beats, median 1.15 ms | intact |
| hidden-safe | cover | mid | not measured by hand (three attempts never reached the page) | | | | | |
| hidden-safe | cover | stop | not measured by hand | | | | | |
| window | modal | start | 9.7 s | 9.7 s | 0 | — | intact: finalized in 54 ms, 31 beats, median 1.15 ms | intact |
| window | modal | mid | 10.8 s | 10.8 s | 11 ms | 1 ms | intact: finalized in 61 ms, 31 beats, median 1.15 ms | intact |
| window | modal | stop | 13.3 s | 13.3 s | 12 ms | 1 ms | intact: finalized in 13.3 s (the block's length), 31 beats, median 1.15 ms | intact |
| hidden-safe | modal | start | 9.1 s | 9.1 s | 0 | — | intact: finalized in 64 ms, 31 beats, median 1.15 ms | intact |
| hidden-safe | modal | mid | 10.1 s | 10.1 s | 10 ms | 1 ms | intact: finalized in 67 ms, 31 beats, median 1.15 ms | intact |
| hidden-safe | modal | stop | 11.8 s | 11.8 s | 12 ms | 2 ms | intact: finalized in 11.8 s, 31 beats, median 1.15 ms | intact |

Run tokens: 1792619439972, 1792620931503, 1792621084382, 1792621302298, 1792619075464,
1792619022149, 1792619134174, 1792619241885, 1792619194828, 1792619298001. The modal rows'
"position frozen" of 10 to 12 ms is the sampler's own: its worker messages queue during the
block and arrive together afterwards, so the block shows in the frame gap, not in the samples.

### Visible pages unchanged with the driver on

With the driver default-on and the page visible: the recording alignment sweep's
`nominal-start` cells at 48 kHz (`recaudit-summary-1792621632367.json`): 6 rows, 2 of 2
cells `aligned`, netted +1.15 ms on every row, no deficit, as the register's rows without
the driver. The MIDI sweep's `nominal-start/120` cell: the first run (`…1792621736952`)
read `investigate` on one 105 ms frame gap with one note placed 55 ms early (repeat 2,
note 26; medians 33.33 / 32.55 on the band, 48 of 48 notes); the re-run (`…1792621807615`)
read the band with a 26 ms frame gap and a largest deviation of 9.38 ms, as the register's
rows — a one-off main-thread stall, not attributed to the driver (a visible page's requests
all go to the real animation frame; the driver adds a transport-request hook and three
observable subscriptions).

### Slow frames: the MIDI register's 120 Hz arm, replaced

The SDK's frame loop accepts no callback within 16 ms of the last, so on this 120 Hz display
every sweep page measured 16.7 ms between the frames the SDK saw and a faster display cannot
move the recorder's frame-stale term. The throttled driver runs the sync slower instead
(`?frameDriver=throttled&frameEvery=N` on the MIDI sweep's `nominal-start/120` cell):

| frames delivered | sync interval | medians (two repeats) | formula `2 × (23 + 0) − (frame − 2.9)` | largest deviation | verdict |
|---|---|---|---|---|---|
| every 2nd (60 Hz) | 16.67 ms | +32.81 / +32.81 ms | +32.2 | 17.7 ms | band |
| every 4th (30 Hz) | 33.33 ms | +16.67 / +16.67 ms | +15.6 | 3.1 ms | band |
| every 8th (15 Hz) | 66.64 ms | −16.41 / −16.93 ms | −17.7 | 2.9 ms | band |

Runs 1792621884207, 1792621927170, 1792621966735. The median follows the sync interval as the
register's formula says, the band being computed from each row's own frame interval, and the
jitter collapses as the interval grows (the clamp of a stamp before the last read has fewer
reads to land between). At 15 Hz the key is written 17 ms BEFORE the heard beat: the
frame-stale base outweighs the latency term. The mechanism is confirmed in the direction a
display can go.

### SDK 0.0.177 (2026-10-22): the three `modal` rows, re-run

Same page, same browser, the alert dismissed through the Playwright tooling's dialog handler
after at least five seconds (the handler was slow this time, so the spans are long):

| row | take 1 (interrupted) | take 2 (control) | hidden span | finalized in (take 1) |
|---|---|---|---|---|
| `modal`, `hideAt=start` | `intact`, 31 / 31, median 1.15 ms | `intact`, 31 / 31 | 11.9 s | 54 ms |
| `modal`, `hideAt=mid` | `intact`, 48 / 48, median 1.15 ms (region 24.08 s: a late stop, the beats whole) | `intact`, 31 / 31 | 22.0 s | 76 ms |
| `modal`, `hideAt=stop` | `intact`, 31 / 31, median 1.15 ms | `intact`, 31 / 31 | 17.5 s | 17 587 ms (the dialog's span, as on 0.0.176) |

Nothing the release changed reaches this path; the rows read as on 0.0.176. The `cover` rows
still need a hand.

### SDK 0.0.179 (2026-10-29): the three `modal` rows, re-run

Same page, Chrome 156 (Playwright's), the alert dismissed through the tooling's dialog handler
after at least five seconds:

| row | take 1 (interrupted) | take 2 (control) | hidden span | finalized in (take 1) |
|---|---|---|---|---|
| `modal`, `hideAt=start` | `intact`, 31 / 31, median 1.15 ms | `intact`, 31 / 31 | 11.9 s | 61 ms |
| `modal`, `hideAt=mid` | `intact`, 31 / 31, median 1.15 ms | `intact`, 31 / 31 | 13.2 s | 66 ms |
| `modal`, `hideAt=stop` | `intact`, 31 / 31, median 1.15 ms | `intact`, 31 / 31 | 14.8 s | 14 821 ms (the dialog's span, as before) |

The rows read as on 0.0.177 (the `mid` row's late stop of that run did not recur). The `cover`
rows still need a hand.

## Reading

- **The recorder survives every interruption measured.** A take begun 22 s before the page
  came back, a take hidden for 5.5 s in the middle, a stop request issued while hidden, and
  a main thread blocked for 9 to 13 s at any of the three moments: every take finalized whole,
  every beat where the harness places it (median +1.15 ms, the sweep's own figure), and the
  next take recorded normally. The audio is captured by the worklet and drained by a worker
  (#290); the main thread catches up when it runs again, and `RecordAudio` creates or
  finalizes the take from what the worklet stamped. The spec's prediction that a take begun
  or stopped while hidden would not finalize was wrong, and that is the finding: there is no
  defect to file from these rows.
- **What hiding does on the SDK's own frame driver is freeze the page's view** for exactly
  the hidden span: the position (`positionFrozenMs` = the hide, to the sample), the take's
  live length, the recording flags, and anything that waits on them. A harness with
  deadlines, or a page that drives its stop from a position wait, acts on a stale view; a
  user sees a cursor that stands still until the page is back. The sweep's cascade was this
  and a window covered for fourteen minutes.
- **The hidden-safe driver removes the freeze.** On the one cover row measured with it, the
  longest frame gap through a 4.7 s hide was 0.64 s (the moment between the hide and the
  record request, when the transport was idle and the driver parked by design), the position
  never froze, and the take ended on time at 31 beats where the window driver's ran to 44.
  The modal rows read the same on both drivers, as they must: a blocked main thread runs no
  worker message either.
- **A modal in the page is not a hidden page.** Its cost is a finalization that waits as long
  as the dialog is up (13.3 s on the stop row), not a lost take.

## Status

**Standing check after SDK upgrades:** `?driver=hidden-safe&interrupt=cover&hideAt=start`
with the page hidden by hand when it asks (Cmd+H on Chrome, count five, click Chrome in the
Dock), expect both takes `intact` and a frame gap under a second; then the three `modal` rows
on the SDK's path (`?driver=window`) through the Playwright tooling's dialog handler, expect
`intact`. The driver is opt-in: `?frameDriver=hidden-safe` on any demo URL, or the
`frameDriver` option; the SDK's own path is the demos' default (decided 2026-10-21: nothing
measured here is a defect, and what the driver buys a demo is a view that is current the
instant the page returns rather than a hundred milliseconds later).

No upstream issue drafted from this register: nothing measured here is a defect. The driver
is offered upstream as an improvement as an option (`drafts/TO-REVIEW-openDAW-pr-hidden-safe-frames.md`),
on the user's read.

## Open items

- The hidden-safe `mid` and `stop` cover rows, by hand, when a hand reaches the page.
- A dead tick worker (a CSP `worker-src` block arrives as an `error` event) would leave the
  driver's hidden path waiting on a tick that never comes, the page frozen as on the SDK's
  path: the ticker warns in the console, nothing else marks the row. Not reachable here
  (the site serves no CSP). The position sampler is a second blob worker and would die with
  it; an empty sample set reads as "position frozen 0 ms".
- The intensive-throttling regime (a page hidden for more than five minutes): the driver
  covers it by construction (worker timers are not throttled); not exercised.
- MIDI recording while hidden: `RecordMidi` extrapolates from the last position read, which
  the driver keeps fresh; not measured.
- Why a hand's hide reaches the page only some of the time on this machine (two Chrome
  windows, the one the tooling drives behind the other, is the likely reason).
