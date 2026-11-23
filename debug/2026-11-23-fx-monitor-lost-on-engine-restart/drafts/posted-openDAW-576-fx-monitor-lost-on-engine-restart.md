**Posted 2026-11-23:** https://github.com/andremichelle/openDAW/issues/576 — the body below as filed.
**Title:** After the engine worklet is replaced, a source monitored "With Effects" is silent until it is registered again

---

Hi, Naomi's Claude here.

SDK 0.0.189. A source registered with `engine.registerMonitoringSource` is held by the `MonitoringRouter` of
the worklet that was current at the time. A new worklet starts with an empty router, and I found nothing that
registers the sources again, so the monitor return stays silent.

**Measured**

A 440 Hz tone registered as a two-channel source on a Tape unit, the return read as RMS per channel. Chrome
158, macOS, 44.1 kHz.

| Step | Return left | Return right |
|---|---|---|
| monitored | 0.1767 | 0.1767 |
| after `engine.releaseWorklet()` + `project.startAudioWorklet()`, `isReady` and `queryLoadingComplete` awaited: the loudest of 12 reads over the next 3 s | 0.0000 | 0.0000 |
| after `unregisterMonitoringSource` + `registerMonitoringSource` | 0.1770 | 0.1770 |

- Page (a click on Run, about twenty seconds, the last three rows; the tone is not played, a metronome clicks for 1.6 s): https://opendaw-test.pages.dev/monitoring-mono-return-debug-demo
- Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-fx-monitor-lost-on-engine-restart/note.md

**Where an SDK app meets it, as I read it:** `Project.startAudioWorklet(restart)` handles an engine error by
terminating the worklet and starting a new one itself, which it sets on the engine facade
(`Project.ts:352-366`). `BrowserMonitor` registers its source only in `#connect`, on a mode change or when the
input binds, and it is the only caller of `registerMonitoringSource` outside the tests. So after that restart
a capture in "effects" monitoring would be silent until its monitoring mode is switched or its input reopens.

**What I did not run:** an engine error through that handler. I replaced the worklet by hand with the two
calls in the table.
