**Not posted.** Target: `andremichelle/openDAW` issues. Waiting for the user's read. Open question for the read: file it now, measured on a synthetic stream only, or after a run on an interface with two inputs.
**Title:** With `requestChannels` 1 and a two-channel stream, direct monitoring is not mixed down: it differs from the take and from effects monitoring

---

Hi, Naomi's Claude here.

SDK 0.0.189. When a capture asks for one channel and the stream it gets carries two, the take and effects
monitoring are the mono mixdown, and direct monitoring carries the two channels as they arrive. An input with
the signal on one side is recorded in the middle and direct-monitored on that side.

**Measured**

Chrome 158, macOS, 44.1 kHz, two runs. The input is a synthetic two-channel stream (a 440 Hz tone on the left,
silence on the right) handed over by a patched `getUserMedia` whatever channel count is asked for.
`requestChannels` 1, monitor pan and strip pan at the centre. Levels are over the tone's level.

| Read at | Left | Right |
|---|---|---|
| the capture's output node (what is recorded), one channel | ×0.50 | |
| what reaches the monitor, direct mode | ×1.00 | ×0.00 |
| what reaches the monitor, effects mode | ×0.50 | ×0.50 |

Page: https://opendaw-test.pages.dev/monitor-pan-law-debug-demo (a click on Run, about thirty-five seconds,
silent; the last row, `data-mono-direct` on the verdict).
Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-mono-request-not-in-direct-monitoring/note.md

**Read from the source (0.0.189, not measured)**

- `#rebuildAudioChain` sets the requested channel count, explicit, on the record gain node and on the
  monitoring mixdown node (`packages/studio/core/src/io/browser/BrowserAudioInput.ts:390-399`). Effects
  monitoring registers the mixdown node (`BrowserMonitor.ts:136`).
- The monitor is bound with `sourceNode: mappedNode` (`BrowserAudioInput.ts:407`), which without a channel
  mapping is the `MediaStreamAudioSourceNode` (`:388`); direct mode connects it to the monitor's gain node
  (`BrowserMonitor.ts:132`).
- `plans/done/advanced-monitoring.md:51`: "Monitoring chain is **always stereo** (force-mono only affects input
  before the split)".

**Not run**

- A real input. The request passes `channelCount: {ideal: 1}` to `getUserMedia` (`BrowserAudioInput.ts:328`);
  where the browser answers with a one-channel mixdown the three paths agree, and I did not measure what a
  browser hands over for an interface with two inputs.
- A capture with a channel mapping. Read from the code, the mapping's output is what direct monitoring taps.

**Tracker search:** "mono", "monitoring mono", "requestChannels", "force mono" on this repository, open and
closed. Nearest: #461 (closed), effects monitoring in forced mono, and #575.
