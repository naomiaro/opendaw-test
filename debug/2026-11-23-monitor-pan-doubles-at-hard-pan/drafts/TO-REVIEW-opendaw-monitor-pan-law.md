**Not posted.** Target: `andremichelle/openDAW` issues. Waiting for the user's read.
**Title:** A capture's monitor pan follows a different law from the channel strip's: hard left or right is +6 dB for a mono input

---

Hi, Naomi's Claude here.

SDK 0.0.189. A Tape has two pans: the unit's (`audioUnitBox.panning`, the channel strip) and the capture's
monitor pan (`capture.monitorPan`). The strip's pan is a balance: the side that remains keeps its centre level.
The monitor's pan is a `StereoPannerNode`, and with the same signal on both sides, hard left or right carries
twice the centre level. With the signal on one side only, the monitor's pan moves it to the other side, where
the strip's pan removes it.

**Measured**

Chrome 158, macOS, 44.1 kHz, four runs with the same figures. A Tape's `CaptureAudio` with a synthetic input
(a 440 Hz tone on a `MediaStreamAudioDestinationNode`, handed over by a patched `getUserMedia`). Each figure is
a gain: the level on a side after the pan over the level of the signal before it.

An input with the same signal on both sides (a one-channel stream):

| Pan | at −1 | at 0 | at +1 |
|---|---|---|---|
| Strip, capture monitored with effects, monitor pan 0 | L ×1.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×1.00 |
| Monitor, direct mode, `requestChannels` 2 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 |
| Monitor, direct mode, `requestChannels` 1 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 |

A real mono microphone (a laptop's built-in one, Chrome 158.0.8127.89, two runs) reads the same in direct mode at both
requests: centre L ×1.00, R ×1.00; hard left L ×2.00, R ×0.00; hard right L ×0.00, R ×2.00. Its track reports
`channelCount` 1 and two identical channels reach the pan node.

An input with the signal on the left only (a two-channel stream, the right silent):

| Pan | at −1 | at 0 | at +1 |
|---|---|---|---|
| Monitor, direct mode | L ×1.00, R ×0.00 | L ×1.00, R ×0.00 | L ×0.00, R ×1.00 |
| Strip, effects mode, monitor pan 0 | L ×1.00, R ×0.00 | L ×1.00, R ×0.00 | L ×0.00, R ×0.00 |

Both pans in the path (effects mode, the one-channel input, read after the monitor's pan):

| Strip pan | monitor −1 | monitor 0 | monitor +1 |
|---|---|---|---|
| −1 | L ×1.00, R ×0.00 | L ×1.00, R ×0.00 | L ×0.00, R ×1.00 |
| 0 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 |
| +1 | L ×1.00, R ×0.00 | L ×0.00, R ×1.00 | L ×0.00, R ×1.00 |

The page's controls: a `StereoPannerNode` it makes itself reads centre ×0.71, hard ×1.00 when fed one channel
and centre ×1.00, hard ×2.00 when fed two identical channels.

The stream's track reports `channelCount` 1, and two channels reach the monitor's pan node. Both monitor rows
read the same stream: the patched `getUserMedia` ignores the requested channel count.

Measured apart from the SDK (a page with no openDAW code,
https://opendaw-test.pages.dev/stream-source-channels-debug-demo), the same chain of browser nodes, a
one-channel stream into `createMediaStreamSource` into a `StereoPannerNode`:

| Browser | Channels the source node delivers | The panner after it |
|---|---|---|
| Chrome 158 | 2, identical | centre ×1.00, hard ×2.00 |
| Firefox 159.0.1 | 1 | centre ×0.71, hard ×1.00 |
| Safari 18.6 | 1 (2 on the first quantum) | centre ×0.71, hard ×1.00 |

So in direct mode the monitor's law for a mono input also depends on the browser. Chrome's two channels are
Chromium issue 40774165.

Page: https://opendaw-test.pages.dev/monitor-pan-law-debug-demo (a click on Run, about thirty-five seconds, silent,
no hardware; `?input=mic` repeats the direct-mode rows on the default microphone).
Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-monitor-pan-doubles-at-hard-pan/note.md

**Read from the source (0.0.189, not measured)**

- `BrowserMonitor` builds `gainNode → panNode` with `createStereoPanner()` and writes `pan` to it
  (`packages/studio/core/src/io/browser/BrowserMonitor.ts:33-37`, `:56-59`). Direct mode connects the input's
  source node to that gain node (`:132`); effects mode returns from the engine into it through a two-channel
  merger (`:136`, `MonitoringRouter.ts:77-85`).
- On the direct path nothing sets a channel count: without a channel mapping the source is the
  `MediaStreamAudioSourceNode` itself (`BrowserAudioInput.ts:381`, `:388`, `:407`) and the gain node has its
  defaults. So the number of channels the browser's source node delivers selects the pan node's algorithm:
  equal power for one channel (centre ×0.71, hard ×1), the fold of the far side into the near side for two.
- The channel strip's gains are `1 − max(pan, 0)` on the left and `1 + min(pan, 0)` on the right
  (`crates/engine-env/src/channel_strip.rs:116-117`).
- The other pans, searched over `crates/` and `packages/` (`pan`, `panning`, `balance`, `Mixing::`,
  `equal power`, `StereoPanner`, `createPanner`), every hit read: the aux send (`aux_send.rs:78-79`), the composite entry and
  layer strips and the Playfield slot (a `ChannelStripProcessor`: `effect_composite.rs:19-20`,
  `composite.rs:799-803`, `:829`) and Nano (`device-nano/src/lib.rs:257-258`) use the strip's balance; Vaporisateur's
  unison spread and the Stereo Tool's default are `Mixing::Linear`, the same curve (`dsp/src/panning.rs:19`);
  the Stereo Tool's equal-power mode fades each side (`panning.rs:20-23`). None of them moves one side into the
  other, and none raises a side above the level of its input (the equal-power mode goes from ×0.71 at the
  centre to ×1 at hard pan). `BrowserMonitor` is the only place a `StereoPannerNode` is
  made.
- `plans/done/advanced-monitoring.md` names the node (`:141`, `readonly #monitorPanNode: StereoPannerNode   // pan`)
  and does not state a law.

**Not run**

- An input device with two channels. The tables are a synthetic input, plus the one mono microphone above.
- The SDK itself in Firefox and Safari. The table above is the browsers' nodes without the SDK; the SDK page
  was started once in Firefox, where its capture did not open within the page's deadline, and I did not look
  into that.
- A stereo input whose two channels differ.

**Tracker search:** "pan", "panning", "pan law", "monitor pan", "StereoPanner" on this repository, open and
closed. Nearest: #116 (closed), the Stereo Tool's choice of panning behaviours, and #575, the effects-monitoring
return of a one-channel source.
