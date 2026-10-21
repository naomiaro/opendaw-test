# Recording while the page is hidden — measurement and a hidden-safe frame driver

**Date:** 2026-10-21
**Status:** approved 2026-10-21; deleted in the PR that completes the work (git history keeps it)
**Register (to be created):** `debug/2026-10-21-hidden-page-recording/note.md`

## Intent

A take is running and the page stops being seen for a few seconds: a dialog lands on top of
the window, or another tab takes the front. Chrome stops animation frames for a hidden
document and for a fully covered window. The SDK drains the recording's ring buffer on a
worker now (openDAW#290, fixed), so the audio survives; but the engine's main-thread sync
(`EngineWorklet`: `AnimationFrame.add(() => reader.tryRead())`), the position observables,
and the take management that waits on them (`RecordAudio` subscribes to `engine.position`)
still run on animation frames. #290 named this as the "related, lesser" issue and left it
open. Today's standing sweep showed its shape: a take started while the window was behind
another app never finalized, and every later repeat in the run timed out waiting on a
position that never settled.

Two deliverables, one page:

1. **Measure the user's case.** A page records a take while the page is hidden for a few
   seconds, then reads whether the take finalized, whether its audio is whole and placed,
   how long the position sync took to resume, and whether the session still records
   afterwards. (The user's words: "something could pop up on screen, or switching tabs";
   "I'm thinking more dialog".)
2. **Make it work in the background.** A frame driver that pumps `AnimationFrame` from a
   worker-posted tick while the document is hidden and from the real animation frame while
   it is visible, installed by `initializeOpenDAW`, with the page measuring the same case
   through both drivers so the fix is proven by the same reading that showed the defect.

## Goals

- A page that produces, per take, a verdict a maintainer can act on: `intact`,
  `not-finalized`, `audio-damaged`, or `session-stuck`, with the figures behind it.
- A driver (`src/lib/hiddenSafeFrameDriver.ts`) that keeps the SDK's main-thread sync alive
  while hidden, with Node tests on its scheduling logic, and a measured before/after.
- A register with both measurements and the standing-run recipe.
- An upstream draft only if the plain-driver measurement fails (expected); whether the
  driver itself is offered upstream (a lib-dom change) or only described is the user's call.

## Non-goals

- The intensive-throttling regime (a page hidden for more than five minutes). The driver
  covers it by construction (worker timers are not throttled), but the page does not
  exercise it; a `?hiddenSeconds=` beyond a minute is allowed but not part of the standing
  run.
- Replacing the sweep harnesses' own frame-gap detection; they keep their "window hidden"
  attributions. (Once the driver is default, a hidden window should no longer cascade; the
  recording harness's cleanup abort remains a separate small change, not in this PR.)
- MIDI recording while hidden. `RecordMidi` stamps notes from Web MIDI timestamps and
  extrapolates from the last position read; it benefits from the driver the same way, but
  is not measured here.

## Anti-goals

- A verdict that depends on the page having been hidden: a run where the page stayed
  visible (a partial cover) must say so and judge nothing about hiding.
- Simulating hiding. The page reacts to the real `visibilitychange` and the real frame gap.
- A driver that pumps at frame rate forever: while visible it must defer to the real
  animation frame exactly as today, so nothing changes for a visible page.

## The driver

`src/lib/hiddenSafeFrameDriver.ts` exports `createHiddenSafeFrameDriver(options)` returning an
object with `requestAnimationFrame(cb): number` and `cancelAnimationFrame(id): void`, the shape
`AnimationFrame.start(owner)` accepts (`@opendaw/lib-dom` `frames.ts`: `start` keeps the
owner, calls `owner.requestAnimationFrame(exe)` once per frame from inside `exe`, and
`exe` drops a callback that comes within 16 ms of the last).

Behaviour:

- While `document.visibilityState === "visible"`: `requestAnimationFrame` forwards to the
  real `window.requestAnimationFrame`; `cancelAnimationFrame` to `window.cancelAnimationFrame`.
  Nothing else runs. A visible page behaves exactly as with `AnimationFrame.start(window)`.
- While hidden and the transport active (`engine.isPlaying`, `isRecording` or
  `isCountingIn`, plus `HIDDEN_GRACE_MS` = 2000 after it goes idle so a stop's finalization
  is pumped): `requestAnimationFrame(cb)` registers `cb` for the next worker tick. The tick
  comes from a dedicated worker created from a blob URL that posts a message every
  `HIDDEN_TICK_MS` (16 ms); the main-thread `onmessage` calls the pending callback with
  `performance.now()`. `cancelAnimationFrame(id)` drops a pending callback. While hidden and
  idle, nothing is pumped: a background tab with the transport stopped stays as idle as
  today (the frame subscribers include every canvas painter, which would otherwise repaint
  at 60 Hz in every background tab for the tab's life). The activity predicate is injected
  (`isActive: () => boolean`), so the scheduler's Node tests cover the gate.
- On `visibilitychange`: when the page becomes hidden, a pending real-frame request is
  cancelled and re-registered for the worker tick (the real frame would never fire); when it
  becomes visible, a pending worker-tick callback is cancelled and re-requested on the real
  frame. The worker is created on first use and kept for the page's life; `terminate()`
  stops it (the demos never call it).
- Ids: one counter for both paths; the driver maps its own id to the underlying id so
  cancellation works across the switch.
- The scheduling logic takes its clock, visibility and the two schedulers as injected
  functions so it is testable in Node without a Worker or a DOM: `createFrameScheduler({
  isHidden, requestFrame, cancelFrame, requestTick, cancelTick, now })` is the pure core;
  `createHiddenSafeFrameDriver()` binds it to `window`, `document` and a worker.

`initializeOpenDAW` gets an option `frameDriver: "window" | "hidden-safe"` (default
`"hidden-safe"` once the measurement in this PR proves it; the experiment page passes the
option from `?driver=`). Every other demo gets the driver by default and must behave as
before on a visible page; the standing sweeps are re-run once with it (the recording
alignment sweep at 48 kHz and the MIDI sweep's nominal-start cell suffice as the check that
nothing moved; both read their registers).

## The page

`recording-hidden-window-debug-demo.html` (unlisted, `noindex, nofollow`), source
`src/demos/recording/recording-hidden-window-debug-demo.tsx`. One button, "Run". URL:

- `?driver=window|hidden-safe` (default `hidden-safe`; `window` is the before).
- `?interrupt=cover|modal` (default `cover`). `cover`: the page is hidden by something on top
  of it, another app's window or another tab; the page prompts and measures the real
  `visibilitychange`. `modal`: the page itself opens `alert()` at the chosen moment, which
  blocks the main thread outright (frames, worker messages and `visibilitychange` alike);
  no driver can help there, the measurement says whether the recorder survives it. The
  user's two cases ("1 or 3": a covering window, a page-level modal).
- `?hideAt=start|mid|stop` (default `mid`). `start`: the interruption begins right after the
  record request, before the first frame (for `modal`, `alert()` is called in the same task as
  `startRecording`; for `cover`, the prompt and the `data-hide-now` flag fire with the request
  and the automation opens the second tab at once). `mid`: at bar 1. `stop`: right after the
  stop request. The three frame-bound moments: a take that begins unseen gets no region or
  file (the recorder resolves the file inside its position subscription) and the stop then
  aborts it; a stop that lands unseen waits for a frame; a mid-take hide is expected to
  survive on the recorder's current code (the live length catches up, the sync is a
  latest-wins slot, the clicks are scheduled on the audio clock) — the control that shows
  the harness reads `intact` where it should.
- `?hiddenSeconds=<n>` (default 5): the interruption's length; the page measures the actual
  span (for `modal`, the dialog is dismissed by the tooling after this long).
- `?rate=48000|44100` (default 48000), `?bpm=120`.

DOM contract as the audit pages: `#audit-state[data-audit-state]` walking `setup →
recording:take1 → waiting:hide → hidden → visible → stopping → finalizing → recording:take2
→ done | error:<message>`.

Source: one Tape unit with the recording alignment harness's synthetic loopback (a click on
every beat scheduled on the audio clock, injected into the capture's stream the way the
harness does; no microphone). Metronome off, count-in off, takes allowed.

Sequence:

1. Start recording at position 0, nominal start. Take 1 runs eight bars (16 s at 120).
2. At the `hideAt` moment the page shows "Hide the page now for about N seconds" (and, for
   automation, a `data-hide-now` attribute flips), or opens the alert itself for `modal`. It records the time the document became hidden, the
   time it became visible again, the longest gap between animation frames across the take
   (a `FrameWatch`, as the MIDI sweep's), and samples `engine.position.getValue()` every
   100 ms from a worker-posted interval (not a timer, not a frame) so the position the
   main thread sees is logged even while hidden: a flat line during the hidden span is
   the mechanism showing itself.
3. Stop at bar 8 less the harness's stop lead. Wait for finalization with a 30 s deadline:
   the take's region and `AudioFileBox` exist and the file's loader reaches `loaded`. A take
   that never got a region or file by the deadline is `not-finalized` too (the aborted-take
   shape), reported as "no take appeared" rather than as a loader state.
4. Take 2: the same, uninterrupted, immediately after. Its purpose is the session: a take
   that cannot start, or a position that never settles, is the cascade.
5. Summary JSON to the `/__verify` sink (`hiddenrec-summary-<runToken>.json`).

Per take the page reads, through the pure library:

- `finalized` (loader state), `finalizeMs`.
- `regionDurationSec` against the expected 16 s (within one render quantum).
- Clicks found / missing / extra and the median beat error via the harness's
  `measureTakeAlignment` on the take's WAV (the harness's reader), tolerance the harness's.
- `hiddenSpanMs` (visible→hidden→visible), `frameGapMaxMs`, `positionFrozenMs` (the longest
  run of unchanged position samples while the engine was recording), `syncResumeMs` (from
  the visible event to the first position sample that moved).
- Verdict: `intact` when finalized, duration within a quantum, no click missing or extra,
  median within the harness tolerance; `not-finalized` when the deadline passed (no take, or
  a loader that never loaded); `audio-damaged` when finalized but clicks missing / extra or
  the duration short; `session-stuck` for take 2 when it could not start or settle;
  `not-hidden` when a `cover` run never saw the page hidden (the partial-cover case: judged
  nothing, reported); `main-thread-blocked` is not a verdict but a figure on every `modal`
  row (the frame gap and the position-sample gap, both as long as the dialog), beside the
  take's own verdict.

Expected (the prediction, written before the first run):

| interrupt | hideAt | driver=window | driver=hidden-safe |
|---|---|---|---|
| cover | mid | `intact`, `positionFrozenMs ≈ hiddenSpanMs`, `syncResumeMs` one frame | `intact`, `positionFrozenMs` under a frame |
| cover | start | `not-finalized` (no take appeared); take 2 `session-stuck` or late | `intact` |
| cover | stop | finalizes only after the page is visible again; take 2 late | `intact` |
| modal | mid / start / stop | the driver cannot help: the same three readings as `window`, with the frame and sample gaps equal to the dialog's span | same as `window` |

The reading, whatever it is, is the register's. A `modal` row that fails is an upstream
matter of the recorder tolerating a blocked main thread (take creation and the stop from
worklet-stamped data), not of any frame driver; the draft says so without proposing it.

Automation: the `cover` case is driven from the browser tooling (open a second tab for
`hiddenSeconds`, close it; the page cannot tell a tab from a covering window, both are
`visibilityState: hidden`), the `modal` case through the Playwright tooling's dialog
handler, which dismisses the page's alert after `hiddenSeconds`. A covering window by hand
(another app dragged over Chrome) is the same `cover` reading and is done once to confirm.

## Measurement library (Node-tested, `src/lib/audit/`)

- `hiddenRecordingVerdict.ts` — `classifyTake(figures, tolerances)` and the figure types;
  `positionFrozenMs(samples)`, `syncResumeMs(samples, visibleAt)`.
- `hiddenRecordingArtifacts.ts` — summary type, `summaryFileName`, parser.
- `src/lib/hiddenSafeFrameDriver.ts` with `createFrameScheduler` tested on a fake clock:
  visible requests go to the frame scheduler; hidden requests to the tick; a request made
  visible and then hidden before it fired moves to the tick without firing twice; the
  reverse move; cancel across the move; ids unique; hidden and idle requests wait (no
  tick) and move to the tick when the transport becomes active, and keep ticking for the
  grace period after it goes idle.

Reuse: `loopbackInjection.ts`, `recordingAlignment.ts` (`measureTakeAlignment`),
`recordingCellRunner.ts` waits (`waitForPositionSettled`, `waitForPosition`), the MIDI
sweep's `FrameWatch`, `withDeadline`.

## Register and docs

- `debug/2026-10-21-hidden-page-recording/note.md`: what the page measures, both runs
  (window driver: tab case and dialog case; hidden-safe driver: the same), the driver's
  description, status. Newest-first row in `debug/README.md`; the page's `DebugLinkBar` links
  the note and openDAW#290.
- Root CLAUDE.md: the "occluded/hidden window freezes the main-thread sync" bullet gains
  the driver (the demos pump from a worker tick while hidden and the transport is active; a
  frozen sync now means the driver is off or broken); a standing-run bullet for the page
  (`?interrupt=cover&hideAt=start`, then `mid`, then `stop`, tab case automated, expect
  both takes `intact`; the `modal` rows read against the register). `src/demos/recording/CLAUDE.md`: a short
  section.
- Upstream draft: `drafts/TO-REVIEW-openDAW-issue-hidden-page-take-not-finalized.md` from
  the window-driver measurement, referencing #290's "related" paragraph; no fix section.
  Whether the driver goes upstream as a lib-dom PR is the user's call after reading.

## Constraints

- Repo rules: `editing.modify()`, Option API, strict TS, no version qualifiers outside
  `changelogs/` and `debug/`, nothing naming the fork; browser transport started with a real
  click; no `src/` edits during a run; drafts wait for the user's read.
- The driver must not change a visible page's behaviour: the check is the two standing
  sweep cells above reading their registers with the driver on.
- The page's verdict rests on the harness's beat matching and tolerances; no new fitted
  number.

## Decided by the user (2026-10-21)

- The driver becomes the default for every demo in this PR, so the demos can run in the
  background ("it makes sense to make it the default driver for demos so they can be in the
  background").
- The issue is filed from the window-driver measurement, and the driver is offered upstream
  as a PR as an option ("file the issue and offer the PR as an option"): the issue draft
  describes the measurement and the cause; a separate draft, `TO-REVIEW-openDAW-pr-hidden-safe-frames.md`,
  holds the PR text for lib-dom's `AnimationFrame` (a hidden-safe path gated on an activity
  predicate the engine supplies), written after the measurement and waiting for the user's
  read like the issue; nothing is posted in this PR.
