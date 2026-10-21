<!-- Draft for andremichelle/openDAW. Not posted. Target: a pull request on `@opendaw/lib-dom`
     (packages/lib/dom/src/frames.ts), offered as an OPTION beside no issue: nothing measured in
     debug/2026-10-21-hidden-page-recording/note.md is a defect — the recorder survives a hidden page
     and a blocked main thread at every moment measured — so this is an improvement to what a
     hidden page shows and to anything that waits on the engine's position, not a fix. The user
     decides whether to offer it (2026-10-21). The code below is the shape; the maintainer's style
     (minimal comments) applies to the actual diff. -->

# AnimationFrame: keep pumping from a worker tick while the document is hidden and the transport is active

**What changes.** `AnimationFrame.start(owner, options?)` gains an optional activity predicate.
While `document.visibilityState === "hidden"` and the predicate reads true (or did within a
grace of two seconds, or a transport request was made within that grace), the next callback is
scheduled from a dedicated worker's `setInterval` message (20 ms) instead of
`requestAnimationFrame`; while the document is visible nothing changes. A hidden page with the
transport idle stays idle, as today.

**Why.** Chrome stops animation frames for a hidden document and for a fully covered window.
The engine's main-thread sync (`EngineWorklet`: `AnimationFrame.add(() => reader.tryRead())`),
the position and recording-state observables, and `RecordAudio`'s take creation and live length
all run on those frames, so behind another tab or a dialog from another app the page's view of
the engine stands still for the whole hidden span. Measured (Chrome 155, macOS, SDK 0.0.176):
on the stock path a take hidden for 5.5 s mid-way shows `engine.position` frozen for 5.4 s and
the view catching up 9 ms after the page is back; a take whose stop was requested while hidden
finalizes only when the page is back (1.3 s later for a 1.3 s hide); a take begun 22 s before
the page came back ran long because the page's own stop wait was frozen with it. The audio was
whole in every case (the ring drains on a worker since #290), so this is about what the page can
see and act on while hidden, not about the take. With the change, the same 4.7 s hide showed a
longest frame gap of 0.64 s and the position never frozen.

**Why the request gate.** The engine's flags reach the page through the sync these ticks pump:
a page hidden and idle when a transport request arrives (a MIDI controller's Record, a timer)
would otherwise never see the flag flip and never tick. `EngineFacade` would call
`AnimationFrame.transportRequested()` from `play`, `stop`, `setPosition`,
`prepareRecordingState`, `stopRecording` and the clip scheduling methods.

**Shape of the change** (`packages/lib/dom/src/frames.ts`):

```ts
export namespace AnimationFrame {
    export const start = (owner: WindowProxy, options?: { isActive?: () => boolean }): void => { … }
    export const transportRequested = (): void => { … }
    // hidden && (isActive() || within grace): schedule `exe` from a worker tick (blob worker,
    // setInterval 20 ms, one pending callback); visibilitychange moves a pending request between
    // the two paths without firing it twice; cancel works across the move.
}
```

A pure scheduler with the rules (visible → frame; hidden and active → tick; hidden and idle →
parked; the moves on visibility and activity changes; cancel across a move; ids) is what the
tests cover, with the clock, the flags and the two schedulers injected; the binding to `window`,
`document` and the worker is thin. The downstream version this is ported from:
`src/lib/frameScheduler.ts` and `src/lib/hiddenSafeFrameDriver.ts` in
https://github.com/naomiaro/opendaw-test (MIT), with the measurement in
https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-hidden-page-recording/note.md.

**What it does not do.** A blocked main thread (a page-level `alert()`, a long synchronous
task) stops frames and worker messages alike; the recorder survives that too (measured at the
start, the middle and the stop of a take, 9 to 13 s each), and nothing here changes it.
