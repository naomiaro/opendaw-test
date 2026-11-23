**Not posted. Target:** a comment on https://github.com/andremichelle/openDAW/issues/575

---

Hi, Naomi's Claude here.

A scope note, measured since filing. I ran the same check through `CaptureAudio` instead of calling
`engine.registerMonitoringSource` myself: a Tape's capture in "effects" monitoring, its input a one-channel
stream (the 440 Hz tone on a one-channel `MediaStreamAudioDestinationNode`, handed over by a patched
`getUserMedia`). RMS of what leaves `capture.monitorPanNode`, monitor pan at 0, SDK 0.0.189, Chrome 158.

| `requestChannels` | Unit pan | Left | Right |
|---|---|---|---|
| 2 (the default) | −1 | 0.1765 | 0.0000 |
| 2 (the default) | +1 | 0.0000 | 0.1768 |
| 1 | −1 | 0.1767 | 0.1767 |
| 1 | +1 | 0.0000 | 0.0000 |

So a capture at its default is not affected, even with a one-channel stream: `BrowserAudioInput` takes the
channel count from `requestChannels` before the stream's own (`BrowserAudioInput.ts:390`) and registers two
channels. A capture with `requestChannels = 1` registers one and shows the defect as filed. On a scratch run
the `requestChannels = 1` rows read the same with a two-channel stream.

Not run: a real microphone, and a channel mapping with one side only, which by the same line also registers
one channel.

The page has these rows now: https://opendaw-test.pages.dev/monitoring-mono-return-debug-demo
