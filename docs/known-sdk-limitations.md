# Known SDK limitations to work around

A register of openDAW SDK behaviours that this repo has measured and lives with: not defects, not
filed, and not expected to change, each with what it costs here and where the workaround lives.
It is the SDK-side sibling of `known-vendor-issues.md`: a behaviour the SDK could change but has
not chosen to, where the vendor register holds what the browser or platform does. Read it before
debugging a symptom that matches one, and before drafting anything upstream about one: an entry
here records a decision not to file, with the reason.

It is a register, so it carries versions and dates; the chapter docs and CLAUDE.md state the
present only. Add an entry when an SDK behaviour costs a session and the decision is to work
around it rather than file it. Retire an entry (keep the row, mark it, name the release) when the
SDK changes the behaviour and a re-measurement confirms it. A limitation that turns out to be a
defect is filed on `andremichelle/openDAW` as the root CLAUDE.md says, and its entry moves to the
investigation's note with the issue number.

Each entry: the behaviour and where it lives in the SDK, the symptom, where it bites here, the
workaround and where it lives, the evidence, the decision not to file and why, and when it was last
checked.

## Engine view on a hidden page

### The engine's main-thread view runs on animation frames, so a hidden page's view stands still

- **Behaviour (SDK 0.0.181, `studio-core` `EngineWorklet`):** the engine's state reaches the main
  thread through one `AnimationFrame.add(() => reader.tryRead())`, and `lib-dom`'s `AnimationFrame`
  is driven by `requestAnimationFrame` alone. Chrome stops animation frames for a hidden document
  and for a fully covered window, so while the page is hidden the position, the recording and
  playing flags, the meters and every page callback that waits on them do not move; they catch up
  on the first frame after the page is visible again. `lib-dom` acknowledges this in one spot
  (`AnimationFrame.dismiss`, whose comment notes a hidden tab never renders the next frame) and
  leaves the frame source as it is.
- **Not a defect:** the recorder is independent of frames since the 0.0.180 capture rewrite. A
  take hidden at its start, in its middle or at its stop, and a take whose main thread was blocked
  by a page-level `alert()` for 9 to 13 s, finalized whole in every row measured, on the stock
  frame path and on the hidden-safe one alike (the 0.0.181 rows: a take hidden at start or
  mid-way finalizes 54 to 58 ms after its stop anchor). What freezes is the page's VIEW of the
  engine, and anything the page does on that view.
- **Where it bites here:** a harness that polls `engine.position`, `isRecording` or a take count
  with a deadline reads a hidden page as hung (the recording sweep behind Cursor, the start of the
  2026-10-21 investigation); a demo coming back from another tab shows the transport where it was
  when it left for about 100 ms; a page-level stop wait that reads the engine's flags runs long
  by the hidden span.
- **Workaround:** opt-in, `?frameDriver=hidden-safe` on any demo URL (`initializeOpenDAW`'s
  `frameDriver` option; the hidden-page recording page takes `?driver=`): while the document is
  hidden and the transport is playing, recording or counting in (plus a two-second grace, a
  transport request counting), the SDK's `AnimationFrame` is pumped from a worker tick at 20 ms
  (`src/lib/hiddenSafeFrameDriver.ts`, rules and tests in `src/lib/frameScheduler.ts`). Measured:
  a 4.7 s hide with a longest frame gap of 0.64 s and the position never frozen; the 0.0.181 cover
  row, position frozen 0 ms, sync resumed 97 ms after visible. The default stays the SDK's path
  (the user's decision, 2026-10-21): no defect, and the gain for a demo is a view current on
  return instead of about 100 ms later. A blocked main thread stops frames and worker messages
  alike, so the driver does nothing for an `alert()`; the recorder does not need it to. Harness
  rule: judge a frozen sync on a hidden page as the view, never as a recorder defect, and keep the
  window uncovered for a sweep.
- **Evidence:** `debug/2026-10-21-hidden-page-recording/note.md` (ten rows on 0.0.176, the three
  `modal` rows and the `cover` row re-run on 0.0.181), repo PR #167;
  `recording-hidden-window-debug-demo.html`.
- **Decision not to file (2026-11-04):** the driver was drafted as an upstream option
  (`debug/2026-10-21-hidden-page-recording/drafts/withdrawn-hidden-safe-frames.md`) and withdrawn
  unposted. Nothing it would fix is a defect since the capture rewrite, half the draft's figures
  described the recorder before that rewrite, and what remains is a view that catches up within
  114 ms, which the downstream opt-in already covers for the pages that need it. Reopen if a
  release moves anything of the recorder's back onto frames, or if a demo needs its view live
  while hidden.
- **Last checked:** 2026-11-04, SDK 0.0.181, Chrome 156.
