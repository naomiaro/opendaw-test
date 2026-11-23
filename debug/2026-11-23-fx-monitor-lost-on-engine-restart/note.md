# Effects monitoring is silent after the engine worklet is replaced

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23. Filed 2026-11-23, open.**

**Issue:** [openDAW#576](https://github.com/andremichelle/openDAW/issues/576); the body as filed is
[`drafts/posted-openDAW-576-fx-monitor-lost-on-engine-restart.md`](./drafts/posted-openDAW-576-fx-monitor-lost-on-engine-restart.md).

Found with the harness of [the mono-return note](../2026-11-23-fx-monitor-mono-return/note.md), which keeps
its own register.

**Repro page:** `monitoring-mono-return-debug-demo.html`, its last three rows; the outcome is `data-restart`
on `#verdict`: `lost`, `kept`, `inconclusive`, `failed` (the restart itself threw or hung) or `not-run`.

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`.

## What happens

A source registered for effects monitoring lives in the `MonitoringRouter` of ONE `EngineWorklet`
(`EngineWorklet.ts:234`, `:473`). When the worklet is replaced, the new worklet's router starts empty and
nothing registers the source again, so the monitor return is silent until the source is registered again.

## Measured

Playwright's Chrome 158, macOS, 44.1 kHz. A 440 Hz tone registered as a two-channel source on a Tape unit at
pan 0, the return read as RMS per channel:

| Step | Return left | Return right |
|---|---|---|
| monitored, before (control) | 0.1767 | 0.1767 |
| after `engine.releaseWorklet()` + `project.startAudioWorklet()`, `isReady` and `queryLoadingComplete` awaited: the loudest of 12 reads over the next 3 s | 0.0000 | 0.0000 |
| after `unregisterMonitoringSource` + `registerMonitoringSource` on the new worklet (control) | 0.1770 | 0.1770 |

The same on a scratch probe that was not kept, with a sample recorder in place of the analysers (the last 20
quanta all exactly zero after the swap).

**Not measured:** an engine error through the SDK's own restart. That it meets this is read from the code:
`Project.startAudioWorklet(restart)`'s error handler terminates the worklet and starts a new one, which it sets
on the engine facade (`Project.ts:352-366`); `EngineFacade.setWorklet` re-subscribes the engine state and
notifies `subscribeWorkletChanged`, which nothing in `studio-core` subscribes to; the only caller of
`registerMonitoringSource` outside tests is `BrowserMonitor.ts:136`, in `#connect` (on a mode change or an
input bind). The page replaces the worklet by hand.

## Also checked, no finding

On a scratch probe that was not kept (the page does not show this). While one source is monitored, registering and unregistering a second source (one whose uuid sorts first, so
the first source's channels move) left the first source's return untouched: five rounds, a constant +0.5 on
the first source and −0.5 on the second, every frame of the first source's return within 0.01 of 0.5 for the
500 ms after each call. The second source's return was at −0.5 from the first frame after its call. The
detector's control (a window starting 50 ms before the second source's registration) showed the 50 ms of
zeros. An idle machine; not run under load.

## Read only, not measured

- `MonitoringRouter.#rebuild` connects every source node to a new input splitter on each rebuild and never
  disconnects the old one (`MonitoringRouter.ts:68-69`; `terminate` leaves them too). The old splitters feed a
  merger that is disconnected from the worklet, so nothing is heard; the nodes stay reachable from the source
  node for as long as it lives.
- Past 8 channels a source is left out of the map with a `console.warn` only (`:58-60`, `:67`); its return is
  silent and nothing tells the app.

## After a fix

The page's `data-restart` reads `kept`. Record the release here.
