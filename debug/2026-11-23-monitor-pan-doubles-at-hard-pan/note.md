# The monitor's own pan doubles the level at hard left and right

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23. To be filed (the user's decision,
2026-11-23); no draft yet.** Open before drafting: the survey of every pan in the SDK and the run on a real
microphone (see "Open"). Found with the harness of
[the mono-return note](../2026-11-23-fx-monitor-mono-return/note.md).

**Repro page:** `monitoring-mono-return-debug-demo.html`, the six rows marked "(measurement)"; the outcomes are
`data-monitor-pan` (requestChannels 2) and `data-monitor-pan-mono` (requestChannels 1) on `#verdict`
(`doubles` / `unity` / `equal-power` / `other` / `not-measurable`, or `failed` / `not-run`). `?input=mic` runs them on the real default microphone.

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`.

## What happens

A capture's monitor has a pan of its own, `capture.monitorPan`, after the monitoring signal and before the
output. With the pan at hard left or hard right, the side that remains carries TWICE the level it has at the
centre (+6 dB). The unit's own pan, on the channel strip, keeps the remaining side at the centre level.

## Measured

Playwright's Chrome 158, macOS, 44.1 kHz. A Tape's `CaptureAudio` in direct monitoring, its input a
one-channel stream carrying a 440 Hz tone (a `MediaStreamAudioDestinationNode` handed over by a patched
`getUserMedia`).

### As gains through the pan node (the page as merged)

What leaves `capture.monitorPanNode` over what reaches it (`capture.monitorGainNode`, through a discrete
splitter), both read at the same moment, direct mode, the one-channel synthetic input:

| `requestChannels` | Channels reaching the pan | Pan −1 | Pan 0 | Pan +1 |
|---|---|---|---|---|
| 2 | two | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 |
| 1 | two | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 |

Two channels reach the pan node although the stream's track reports one channel, at both requests. That is
what selects the node's stereo law.

For comparison, the unit's strip pan on the same page (the mono-return note's first table, a two-channel
source): 0.1769 / 0 at pan −1, 0.1770 / 0.1770 at the centre, 0 / 0.1767 at +1. The side that remains keeps
the centre level.

Earlier the same day, on the page before it read gains and on a scratch probe that was not kept, the levels
leaving the pan node were 0.354 / 0.177 / 0.354 for pan −1 / 0 / +1, in direct and in effects mode, with a
one-channel and a two-channel stream, at both requests.

**Not measured:** a real microphone. The input was synthetic and the two channels reaching the pan were
identical; with channels that differ, the fold gives the sum of the two, not twice one (the page then reads
`not-measurable`).

## Open

- **A real microphone** (`?input=mic`, not run). If a one-channel microphone reaches the pan node as ONE
  channel, the node applies its mono law instead: centre ×0.71, hard ×1 (`equal-power`). Then the monitor's
  law would also depend on the input, and a mono input would be 3 dB down at the centre against the strip.
- **Why two channels reach the pan node** for a one-channel stream in direct mode. The SDK's half is read:
  the chain is the stream's `MediaStreamAudioSourceNode` (no mapping: `BrowserAudioInput.ts:388,407`) into the
  monitor's gain node (`BrowserMonitor.ts:132`), which is created with defaults (`:33`), so nothing in the SDK
  up-mixes. The two channels come from the source node the browser builds; whether a real one-channel
  microphone does the same is the open half. In effects mode the return always arrives through a two-channel
  merger, so the stereo law always applies there.
- **Every pan in the SDK**, to say what the monitor's differs from: the channel strip, the aux send
  (`aux_send.rs:6`: "the same linear BALANCE law as the channel strip (center = unity on both channels, NOT
  constant-power)") and Nano are a balance; Vaporisateur's voice pan and the Stereo Tool default are
  `Mixing::Linear`, which is the same curve; the Stereo Tool offers equal-power as a choice. Read from the
  source, none of these measured here except the strip.
- **Effects mode stacks two pans** (the strip's in the engine, then the monitor's): the combinations were not
  swept.

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

The user's decision on 2026-11-23 is to file it. For it: one track has two pan controls with different laws, and moving the
monitor's from the centre to a side raises the heard level by 6 dB for a mono or centred input. Against it:
the node does what the Web Audio specification says, and the plan
(`plans/done/advanced-monitoring.md:141`) names a `StereoPannerNode` for the monitor without stating a law.
The plan also calls the monitoring nodes "always stereo" (`:51`, `:138`), but the direct path forces no channel
count, which is where the mono law could come in.
If it is judged a choice, it belongs in `docs/known-sdk-limitations.md`.
