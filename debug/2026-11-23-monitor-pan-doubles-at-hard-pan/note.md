# The monitor's own pan doubles the level at hard left and right

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23. Not drafted, not filed:** whether this is a
defect or a choice is open (see "Is it a defect?"). Found with the harness of
[the mono-return note](../2026-11-23-fx-monitor-mono-return/note.md).

**Repro page:** `monitoring-mono-return-debug-demo.html`, the three rows marked "(measurement)"; the outcome is
`data-monitor-pan` on `#verdict` (`doubles` / `unity` / `equal-power` / `other`).

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`.

## What happens

A capture's monitor has a pan of its own, `capture.monitorPan`, after the monitoring signal and before the
output. With the pan at hard left or hard right, the side that remains carries TWICE the level it has at the
centre (+6 dB). The unit's own pan, on the channel strip, keeps the remaining side at the centre level.

## Measured

Playwright's Chrome 158, macOS, 44.1 kHz. A Tape's `CaptureAudio`, default `requestChannels` (2), its input a
one-channel stream carrying a 440 Hz tone (a `MediaStreamAudioDestinationNode` handed over by a patched
`getUserMedia`). RMS of what leaves `capture.monitorPanNode`, 600 ms after each write.

| Mode | Monitor pan | Strip pan | Left | Right |
|---|---|---|---|---|
| direct | −1 | 0 | 0.3538 | 0.0000 |
| direct | 0 | 0 | 0.1770 | 0.1770 |
| direct | +1 | 0 | 0.0000 | 0.3537 |
| effects | 0 | −1 | 0.1765 | 0.0000 |
| effects | 0 | +1 | 0.0000 | 0.1768 |

The direct rows and the effects rows are the page as merged. On a scratch probe that was not kept, the monitor
pan read the same 0.353 / 0.177 / 0.353 in effects mode, and with a two-channel stream, and with
`requestChannels = 1`, in both modes (eight combinations).

**Not measured:** a real microphone. The input was synthetic and its two channels were identical wherever it
had two; with input channels that differ, the fold gives the sum of the two, not twice one.

## Mechanism (read from the source)

- `BrowserMonitor` builds `gainNode → panNode`, a `StereoPannerNode` (`BrowserMonitor.ts:33-37`), and writes
  `pan` to it (`:56-59`).
- A `StereoPannerNode` given a two-channel input folds the channel on the far side into the near one: at pan −1
  the left output is left + right (Web Audio specification, the stereo panning algorithm). With the same signal
  on both channels that is twice the level.
- The channel strip uses a balance: left gain `1 − max(pan, 0)`, right gain `1 + min(pan, 0)`
  (`crates/engine-env/src/channel_strip.rs:114-117`), so a hard pan only removes the far side.
- Why the panner saw two channels for a one-channel stream in direct mode was not traced.

## Is it a defect?

Not settled, so nothing is drafted. For it: one track has two pan controls with different laws, and moving the
monitor's from the centre to a side raises the heard level by 6 dB for a mono or centred input. Against it:
the node does what the Web Audio specification says, and the plan
(`plans/done/advanced-monitoring.md`) names a `StereoPannerNode` for the monitor without stating a law.
If it is judged a choice, it belongs in `docs/known-sdk-limitations.md`.
