# Effects monitoring: the return of a mono source is the strip's left channel on both sides

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23. Not filed yet:** the issue draft is
[`drafts/TO-REVIEW-openDAW-fx-monitor-mono-return.md`](./drafts/TO-REVIEW-openDAW-fx-monitor-mono-return.md).

**Repro page:** `monitoring-mono-return-debug-demo.html` (unlisted; a real click on Run, about twenty seconds, one run per
load; the monitored tone is never heard, the one thing played is a 1.6 s metronome check). Source `src/demos/engine/monitoring-mono-return-debug-demo.tsx`.

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`. Upstream main on 2026-11-23
(`363e54eac`) has the same `MonitoringRouter.ts` and `monitor.rs`.

## What happens

A unit monitored "with effects" whose source has ONE channel returns its channel strip's left output on both
sides of the monitor return. The strip's right output is dropped. So:

- the unit's pan at hard right gives silence;
- the unit's pan at hard left gives the signal on BOTH sides, at the centre too: the pan only changes the level;
- a stereo effect on the unit (a reverb, a ping-pong delay, a widener) is heard as its left half alone.

A source with two channels returns both strip channels and follows the pan.

## Measured

Playwright's Chrome 158, macOS, the output device and the page at 44.1 kHz. A 440 Hz tone at gain 0.25 registered with
`engine.registerMonitoringSource(uuid, node, numChannels, destination)` on a Tape unit with nothing else in
the project; the destination is a gain node connected to two analysers only. RMS of the return per channel,
600 ms after each pan write. The master Maximizer is removed first. Four runs, the same to three decimals;
the last, on the page as merged:

| Source | Unit pan | Return left | Return right |
|---|---|---|---|
| stereo (control) | −1 | 0.1769 | 0.0000 |
| stereo (control) | 0 | 0.1770 | 0.1770 |
| stereo (control) | +1 | 0.0000 | 0.1767 |
| mono | −1 | 0.1770 | 0.1770 |
| mono | 0 | 0.1767 | 0.1767 |
| mono | +1 | 0.0000 | 0.0000 |

The page calls the engine's method directly, with an oscillator in place of a microphone. It does not go
through `CaptureAudio` / `BrowserMonitor`; that those register a one-channel input with `numChannels` 1 is
read from the code (below), not run. No stereo effect was put on the unit: the second and third bullets above
follow from the left channel alone being returned, and only the pan was measured.

## Mechanism (read from the source)

- `packages/studio/core/src/io/browser/BrowserMonitor.ts:136` registers the monitor mixdown with the chain's
  channel count.
- `packages/studio/core/src/MonitoringRouter.ts:66-76` gives a source one worklet channel per source channel
  and sends the map entry `{uuid, channels}`; `core-wasm/src/processor.ts:337-347` encodes a one-channel entry
  with `right = -1`.
- In: `crates/engine/src/monitor.rs:58-63` (`MonitorMix`) adds the one staged channel to both sides of the
  unit's chain start. The chain and the strip then run in stereo.
- Out: `crates/engine/src/lib.rs:2331-2349` (`copy_monitor_outputs`) copies the strip's left buffer to the
  entry's left channel, and the right buffer only when the entry has a right channel. A one-channel entry's
  right buffer goes nowhere.
- Return: `MonitoringRouter.ts:81-84` connects that one return channel to both inputs of the source's output
  merger.

`plans/done/advanced-monitoring.md` says "Monitoring chain is **always stereo** (force-mono only affects input
before the split)" (line 51) and that the per-track `ChannelMergerNode(2)` "recombines L/R" (line 37). It does
not say what a one-channel source's return should carry.

## The page also guards openDAW#528

[The 2026-11-05 note](../2026-11-05-effects-monitoring-two-routes/note.md) measured #528 with a probe pasted
into a demo page; no page was kept. This page taps the engine's main output while each source is monitored
and expects silence there (peak 0.00000 on every run), with the metronome as the tap's control (peak 0.50).
That row has no positive control for a leak: a build with #528 back was not run.

## Found with the same harness

[Monitoring is silent after the engine worklet is replaced](../2026-11-23-fx-monitor-lost-on-engine-restart/note.md)
(the page's last three rows). That note also holds a check that read clean: a second source registering does
not disturb a monitored one.

## After a fix

The page reads FIXED when all three mono rows follow the pan like the stereo rows. It reads BUG PRESENT only
on the whole signature (silent at +1, the signal on both sides at −1 and 0); a mono return that is silent at
every pan reads INCONCLUSIVE. Re-run it on the release that
changes this and record the figures here.

## Fix ideas (internal, not for the issue)

Give a one-channel source two worklet channels and connect its one input to both. The engine then holds a
two-channel entry whose inputs are identical: `MonitorMix` adds the same signal as now, and
`copy_monitor_outputs` returns both strip channels. Nothing changes in the engine, the worklet or the map
format. The cost is capacity: 4 sources in the 8 channels, where 8 one-channel sources fit now.
