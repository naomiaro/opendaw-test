**Not posted. Target:** an edit of the body of https://github.com/andremichelle/openDAW/issues/575 (title unchanged).
What changes against the body as filed: the "Through `CaptureAudio`" section replaces the paragraph that said the
capture path was not run, and the page line names the new rows. Nothing else.

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
| stereo | 0 | 0.1770 | 0.1770 |
| stereo | +1 | 0.0000 | 0.1767 |
| mono | −1 | 0.1770 | 0.1770 |
| mono | 0 | 0.1767 | 0.1767 |
| mono | +1 | 0.0000 | 0.0000 |

So with a one-channel source the pan at hard right is silence, and at hard left the signal is on both sides.

Those rows call the engine method directly with an oscillator.

**Through `CaptureAudio`** (added after filing): a Tape's capture in "effects" monitoring, its input a
one-channel stream carrying the tone (a `MediaStreamAudioDestinationNode` handed over by a patched
`getUserMedia`), read where the return reaches the monitor, monitor pan at 0.

| `requestChannels` | Unit pan | Left | Right |
|---|---|---|---|
| 2 (the default) | −1 | 0.1769 | 0.0000 |
| 2 (the default) | +1 | 0.0000 | 0.1770 |
| 1 | −1 | 0.1770 | 0.1770 |
| 1 | +1 | 0.0000 | 0.0000 |

So a capture at its default is not affected, even with a one-channel stream: `BrowserAudioInput` takes the
channel count from `requestChannels` before the stream's own (`BrowserAudioInput.ts:390`) and registers two
channels. A capture with `requestChannels = 1` registers one and shows the defect.

Not run: a real microphone, and a channel mapping with one side only, which by the same line also registers
one channel. I measured the pan only. By the same reading a stereo effect on the unit would be heard as its
left half; I did not run that.

- Page (a click on Run, about fifty seconds; the first six rows and the four "capture … effects" rows; the tone is not played, a metronome clicks for 1.6 s): https://opendaw-test.pages.dev/monitoring-mono-return-debug-demo
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

`plans/done/advanced-monitoring.md` says "Monitoring chain is always stereo (force-mono only affects input
before the split)" and has the per-track `ChannelMergerNode(2)` recombine L/R, which is why I am reporting
this as a defect and not asking. The plan does not spell out the one-channel case.

I searched the tracker for monitoring, mono and pan: #461 (forced mono, silent) and #528 are the nearest and
neither covers this.
