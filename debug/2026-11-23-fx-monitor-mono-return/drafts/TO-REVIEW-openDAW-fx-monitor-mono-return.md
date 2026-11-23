**Not posted. Target:** a new issue on `andremichelle/openDAW`.
**Title:** "With Effects" monitoring of a one-channel source returns the strip's left channel on both sides: panned right it is silent

---

Hi, Naomi's Claude here.

SDK 0.0.189. A unit monitored with effects whose source was registered with one channel comes back on the
monitor return as its channel strip's LEFT output on both sides. The strip's right output is not returned.
A source registered with two channels returns both.

**Measured**

A 440 Hz tone registered with `engine.registerMonitoringSource(uuid, node, numChannels, destination)` on a
Tape unit, nothing else in the project. `destination` is a gain node connected to two analysers; the figures
are the RMS of the return per channel, 600 ms after writing the unit's `panning`. Chrome 158, macOS, 44.1 kHz.

| Source | Unit pan | Return left | Return right |
|---|---|---|---|
| stereo | −1 | 0.1769 | 0.0000 |
| stereo | 0 | 0.1765 | 0.1765 |
| stereo | +1 | 0.0000 | 0.1769 |
| mono | −1 | 0.1770 | 0.1770 |
| mono | 0 | 0.1769 | 0.1769 |
| mono | +1 | 0.0000 | 0.0000 |

So with a one-channel source the pan at hard right is silence, and at hard left the signal is on both sides.

The page calls the engine method directly with an oscillator. I did not run it through a microphone and
`CaptureAudio`; that `BrowserMonitor` registers a one-channel input with `numChannels` 1 is read from
`BrowserMonitor.ts:136`. I measured the pan only. By the same reading a stereo effect on the unit would be
heard as its left half; I did not run that.

- Page (a click on Run, silent, about fifteen seconds; the first six rows): https://opendaw-test.pages.dev/monitoring-mono-return-debug-demo
- Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-fx-monitor-mono-return/note.md

**Where the right channel goes, as I read it**

- `MonitoringRouter.#rebuild` gives a one-channel source one worklet channel; the map entry reaches the engine
  with `right = -1`.
- `MonitorMix::process` (`crates/engine/src/monitor.rs`) adds that channel to both sides of the chain start,
  and the chain and strip run in stereo.
- `copy_monitor_outputs` (`crates/engine/src/lib.rs`) copies the strip's left buffer to the entry's left
  channel and the right buffer only when the entry has a right channel.
- `MonitoringRouter.#rebuild` then connects that one return channel to both inputs of the source's output
  merger.

`plans/done/advanced-monitoring.md` describes the monitoring path as "always stereo" with the per-track
merger recombining L/R, which is why I am reporting it as a defect and not asking.

I searched the tracker for monitoring, mono and pan: #461 (forced mono, silent) and #528 are the nearest and
neither covers this.
