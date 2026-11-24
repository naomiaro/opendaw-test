# A mono request is applied to the take and to effects monitoring, not to direct monitoring

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23, with a synthetic two-channel stream.
[openDAW#578](https://github.com/andremichelle/openDAW/issues/578) filed 2026-11-23, open; the body as posted
([`drafts/posted-openDAW-578-mono-request-direct-monitoring.md`](./drafts/posted-openDAW-578-mono-request-direct-monitoring.md)).
Whether a browser hands over two channels for a real input when one is asked for is NOT measured, and the
finding only shows then.** Found while reading the direct path for
[the monitor pan note](../2026-11-23-monitor-pan-doubles-at-hard-pan/note.md).

**Repro page:** `monitor-pan-law-debug-demo.html`, its last synthetic row; outcome `data-mono-direct` on
`#verdict` (`not-mixed-down` / `mixed-down` / `other` / `failed`). The page's verdict is about the pan law, not
about this.

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`.

## What happens

With `capture.requestChannels = 1` and a stream that still carries two channels, the SDK mixes the two down
for the take and for effects monitoring. Direct monitoring is connected to the stream's source node itself and
carries the two channels as they are. An input with the signal on one side is then recorded and
effects-monitored in the middle, and direct-monitored on that one side.

## Measured

Playwright's Chrome 158, macOS, 44.1 kHz, two runs on the page as committed. The capture's input is a
two-channel stream with a 440 Hz tone on the left and silence on the right; the patched `getUserMedia` hands it
over whatever channel count is asked for. `requestChannels` 1, monitor pan and strip pan at the centre. Levels
are over the tone's own level.

| Read at | Left | Right |
|---|---|---|
| the capture's output node (what is recorded), one channel | ×0.50 | |
| what reaches the monitor, direct mode | ×1.00 | ×0.00 |
| what reaches the monitor, effects mode | ×0.50 | ×0.50 |

`capture.effectiveChannelCount` reads 1 in both modes.

## Not measured

- **Any real input.** The request sets `channelCount: {ideal: 1}` on `getUserMedia`
  (`BrowserAudioInput.ts:139`, `:328`). If the browser answers a two-input interface with a one-channel
  mixdown, the stream is mono before the SDK sees it and all three paths agree. The SDK's own comment expects
  that a browser may: "a single picked input still opens stereo, or the browser may hand over a mixdown"
  (`BrowserAudioInput.ts:319`). No interface with two inputs was at hand.
- A capture with a channel mapping (`captureBox.leftInputs` / `rightInputs`): read from the code, the mapping's
  output node is what direct monitoring taps (`BrowserAudioInput.ts:386-388`, `:407`), so a mapped mono is
  applied there.

## Mechanism (read from the source)

- `#rebuildAudioChain` gives the record gain node and the monitoring mixdown node the requested channel count
  with `channelCountMode = "explicit"` (`BrowserAudioInput.ts:390-399`); the take is recorded from the first,
  effects monitoring is registered with the second (`BrowserMonitor.ts:136`).
- It binds the monitor with `sourceNode: mappedNode` (`BrowserAudioInput.ts:407`), which without a mapping is
  the `MediaStreamAudioSourceNode` (`:388`), and direct mode connects that to the monitor's gain node
  (`BrowserMonitor.ts:132`).
- The plan says of the monitoring chain: "Monitoring chain is **always stereo** (force-mono only affects input
  before the split)" (`plans/done/advanced-monitoring.md:51`).

## After a fix

`data-mono-direct` reads `mixed-down` (direct monitoring ×0.50 on both sides, as recorded).

## Fix ideas (internal, not for the issue)

- Tap direct monitoring from the monitoring mixdown node instead of the source node.
