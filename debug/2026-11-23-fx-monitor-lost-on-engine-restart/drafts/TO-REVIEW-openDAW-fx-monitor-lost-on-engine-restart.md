**Not posted. Target:** a new issue on `andremichelle/openDAW`.
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
| monitored | 0.1768 | 0.1768 |
| after `engine.releaseWorklet()` + `project.startAudioWorklet()`, `isReady` awaited, 1.5 s later | 0.0000 | 0.0000 |
| after `unregisterMonitoringSource` + `registerMonitoringSource` | 0.1770 | 0.1770 |

- Page (a click on Run, silent, about fifteen seconds; the last three rows): https://opendaw-test.pages.dev/monitoring-mono-return-debug-demo
- Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-fx-monitor-lost-on-engine-restart/note.md

**What I did not run:** the studio. From the code, its "Restart Engine" path looks exposed:
`Project.startAudioWorklet`'s error handler starts a new worklet, the studio's `restart.load` calls
`engine.setWorklet`, and `BrowserMonitor` registers its source only in `#connect`, on a mode change or when
the input binds. `subscribeWorkletChanged` has no subscriber in `studio-core`. So a track in With Effects
would be silent after a restart until its monitoring mode is switched or its input reopens. I did not crash
an engine in the studio to confirm that.
