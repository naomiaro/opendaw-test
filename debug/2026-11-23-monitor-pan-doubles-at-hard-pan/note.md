# The monitor's own pan follows a different law from every other pan in the SDK

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23. To be filed (the user's decision,
2026-11-23); draft waiting for a read:
[`drafts/TO-REVIEW-opendaw-monitor-pan-law.md`](./drafts/TO-REVIEW-opendaw-monitor-pan-law.md).** Two findings came out of this one and have their own notes:
[the browser's channel count](../2026-11-23-stream-source-channel-count/note.md) (a vendor behaviour) and
[a mono request in direct monitoring](../2026-11-23-mono-request-not-in-direct-monitoring/note.md). Found with the harness of
[the mono-return note](../2026-11-23-fx-monitor-mono-return/note.md).

**Repro page:** `monitor-pan-law-debug-demo.html` (`src/demos/engine/monitor-pan-law-debug-demo.tsx`), a real
click on Run, about thirty-five seconds, silent, no hardware. Verdict on `#verdict[data-verdict]`, with
`data-strip-law`, `data-monitor-law` (requestChannels 2), `data-monitor-law-mono` (requestChannels 1)
(`doubles` / `unity` / `equal-power` / `other` / `not-measurable`), `data-channels-reaching`, `data-stack`
(`as-composed` / `other`), `data-one-sided` (`monitor-moves-strip-removes` / `other`), `data-mono-direct`
(`not-mixed-down` / `mixed-down` / `other`, a separate finding, see below); each can read `failed`
or `not-run`. `?input=mic` adds the direct-mode rows on the real default microphone (`data-mic-law`,
`data-mic-law-mono`, `data-mic-channels`). The six "(measurement)" rows on
`monitoring-mono-return-debug-demo.html` (`data-monitor-pan`, `data-monitor-pan-mono`) are the first version of
the same reading and stay there.

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`.

## What happens

A Tape has two pans: the unit's, on the channel strip in the engine (`audioUnitBox.panning`), and the
capture's own monitor pan (`capture.monitorPan`), a Web Audio `StereoPannerNode` after the monitoring signal.
They follow different laws:

- The strip's pan is a balance. Turning it to one side fades the other side out and leaves the remaining side
  at its centre level.
- The monitor's pan moves the far side's signal into the near side. With the same signal on both sides (a
  mono source), hard left or right carries TWICE the centre level (+6 dB). With the signal on one side only,
  the monitor's pan carries it across to the other side, where the strip's pan removes it.

In effects monitoring both pans are in the path, one after the other.

## Measured

Playwright's Chrome 158, macOS, page and device at 44.1 kHz, four runs, the last on the page as committed,
all identical to the second decimal. A Tape's `CaptureAudio`, its input a synthetic stream carrying a 440 Hz tone (a
`MediaStreamAudioDestinationNode` handed over by a patched `getUserMedia`). Every figure is a gain: the level
on a side after the pan over the level of the signal before it, both read together.

### The two pans, an input with the same signal on both sides

| Pan | at −1 | at 0 | at +1 | reads |
|---|---|---|---|---|
| Strip (`audioUnitBox.panning`), effects mode, monitor pan 0 | L ×1.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×1.00 | `unity` |
| Monitor (`capture.monitorPan`), direct mode, requestChannels 2 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 | `doubles` |
| Monitor, direct mode, requestChannels 1 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 | `doubles` |

The input was a one-channel stream (its track reports `channelCount` 1). Two channels reach the monitor's pan
node at both requests.

Controls, on a `StereoPannerNode` the page makes itself, no SDK involved: fed one channel it reads centre
×0.71, hard ×1.00 (`equal-power`); fed two identical channels it reads centre ×1.00, hard ×2.00 (`doubles`).
So the taps tell the three laws apart, and the monitor's figures are the node's stereo algorithm.

### A real mono microphone

The user's Chrome, macOS 15.6.1, `?input=mic`, two runs on 2026-11-23 (158.0.8127.88, then 158.0.8127.89
after an update), identical; their synthetic rows read as in the
tables here. The microphone is "MacBook Pro Microphone (Built-in)", the default input, with steady noise.

| Monitor, direct mode | at −1 | at 0 | at +1 | channels reaching the pan | the track reports |
|---|---|---|---|---|---|
| `requestChannels` 2 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 | two, identical | 1 |
| `requestChannels` 1 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 | two, identical | 1 |

`data-mic-law` and `data-mic-law-mono` read `doubles`. So in Chrome ONE channel never reaches the pan node,
even from a mono microphone, and the equal-power case does not occur there.

### An input with the signal on the left only

A two-channel stream, the tone on the left, the right silent (as from an interface with a microphone on its
first input).

| Pan | at −1 | at 0 | at +1 |
|---|---|---|---|
| Monitor, direct mode | L ×1.00, R ×0.00 | L ×1.00, R ×0.00 | L ×0.00, R ×1.00 |
| Strip, effects mode, monitor pan 0 | L ×1.00, R ×0.00 | L ×1.00, R ×0.00 | L ×0.00, R ×0.00 |

At +1 the monitor's pan carries the signal to the right; the strip's pan leaves silence
(`data-one-sided="monitor-moves-strip-removes"`).

### Both pans stacked, effects mode

The one-channel input, requestChannels 2, read after the monitor's pan, over the capture's input.

| Strip pan | monitor −1 | monitor 0 | monitor +1 |
|---|---|---|---|
| −1 | L ×1.00, R ×0.00 | L ×1.00, R ×0.00 | L ×0.00, R ×1.00 |
| 0 | L ×2.00, R ×0.00 | L ×1.00, R ×1.00 | L ×0.00, R ×2.00 |
| +1 | L ×1.00, R ×0.00 | L ×0.00, R ×1.00 | L ×0.00, R ×1.00 |

Every cell is the strip's row put through a pan that folds the far side into the near one
(`data-stack="as-composed"`). Nothing new comes from the stacking itself; two cells show the two laws
against each other: with the strip hard right and the monitor hard left the signal is heard on the left at
the centre level, and with the strip centred a hard monitor pan is +6 dB.

### Why two channels reach the pan node (the browser's half)

Measured apart from the SDK on `stream-source-channels-debug-demo.html`
([its note](../2026-11-23-stream-source-channel-count/note.md)): in Chrome 158 a `MediaStreamAudioSourceNode`
on a stream whose track reports `channelCount` 1 delivers TWO identical channels on every one of 300 render
quanta, and a `StereoPannerNode` after it reads centre ×1.00, hard ×2.00. Firefox 159.0.1 and Safari 18.6
deliver ONE channel for the same stream, and the panner reads centre ×0.71, hard ×1.00. The specification
says the node's output "corresponds to the number of channels of the MediaStreamTrack"; Chromium issue
40774165 is Chrome's behaviour, closed as fixed without a change.

So the monitor's law in direct mode depends on the browser: the stereo fold in Chrome, equal power in
Firefox and Safari for a one-channel input.

### A mono request is not applied in direct monitoring (a second, separate finding)

The same page's last synthetic row: `requestChannels` 1 on the left-only two-channel stream records and
effects-monitors the mono mixdown (×0.50 on both sides) and direct-monitors the raw channels (L ×1.00,
R ×0.00); `data-mono-direct="not-mixed-down"`. Its own note:
[mono-request-not-in-direct-monitoring](../2026-11-23-mono-request-not-in-direct-monitoring/note.md).

## Not measured

- **The SDK page in Firefox and Safari.** Started once in Firefox 159 through the repo's driver: the
  page-made panner controls read as in Chrome, then the capture's input did not open within the page's
  ten-second deadline (not looked into). The Firefox and Safari figures above are the browser's nodes on the
  SDK-free probe, in the same chain the SDK builds for direct monitoring (stream source, a default gain node,
  a `StereoPannerNode`).
- **A real input with two channels.** On the synthetic input the `requestChannels` 1 row repeats the
  `requestChannels` 2 row by construction (the patched `getUserMedia` ignores the requested channel count and
  no node on the direct path applies it), and the mono microphone gives a one-channel track at both requests.
  The page's verdict reads the first row.
- **A two-channel input whose channels differ** (a stereo source): the page reads `not-measurable` for a law
  there. From the node's algorithm the near side then carries the sum of both channels.
- **The other pans of the SDK**, below: read from the source, none measured except the strip.

## Every pan in the SDK (read from the source, at the release commit)

Searched with XERJ and with `grep` over `crates/` and `packages/` for `pan`, `panning`, `balance`,
`Mixing::`, `equal power`, `StereoPanner`, `createPanner`; every hit read.

| Pan | Law | Where | Measured? |
|---|---|---|---|
| Channel strip (`AudioUnitBox.panning`) | balance: left `1 − max(pan, 0)`, right `1 + min(pan, 0)` | `crates/engine-env/src/channel_strip.rs:116-117` | yes, above |
| Aux send (`send-pan`) | the same balance; its header says "the same linear BALANCE law as the channel strip (center = unity on both channels, NOT constant-power)" | `crates/engine-env/src/aux_send.rs:5-7`, `:78-79` | read |
| Effect-composite entry pan, instrument-composite layer pan, Playfield slot `panning` | each is a `ChannelStripProcessor`: the same balance | `crates/engine/src/effect_composite.rs:19-20`, `crates/engine/src/composite.rs:799-803`, `:829` | read |
| Nano `panning` | the same balance | `crates/stock-devices/device-nano/src/lib.rs:257-258` | read |
| Vaporisateur unison spread | `Mixing::Linear`: `[min(1 − x, 1), min(1 + x, 1)]`, the same curve as the balance | `crates/stock-devices/device-vaporisateur/src/voice.rs:131`, `crates/dsp/src/panning.rs:19` | read |
| Stereo Tool `panning`, default mode | `Mixing::Linear`, the same curve | `crates/stock-devices/device-stereo-tool/src/lib.rs:70` | read |
| Stereo Tool `panning`, `panning-mixing` = 1 | equal power per channel: left `cos`, right `sin` of `(x + 1)·π/4`; centre ×0.71, hard ×1; the far side is faded, not folded | `device-stereo-tool/src/lib.rs:170`, `crates/dsp/src/panning.rs:20-23` | read |
| Soundfont voice pan (from the soundfont's region data, no user control) | equal power on a mono voice | `crates/stock-devices/device-soundfont/src/voice.rs:199-201` | read |
| Korpus mode taps (internal spread under `width-a` / `width-b`) | `sqrt(1 − pan)`, `sqrt(pan)` on mono modes | `crates/stock-devices/device-korpus/src/engine/bow.rs:92-93`, `driven.rs:203-204` | read |
| Tidal | an LFO on each channel's gain (auto-pan), no pan position | `crates/stock-devices/device-tidal/src/lib.rs:1` | read |
| **Monitor (`capture.monitorPan`)** | a Web Audio `StereoPannerNode`: equal power for a one-channel input, far side folded into the near side for a two-channel input | `packages/studio/core/src/io/browser/BrowserMonitor.ts:35-37`, `:56-59` | yes, above |

Every pan a user sets in the engine is the balance, or the Stereo Tool's equal-power choice, and none of them
moves one side's signal to the other. The monitor's pan is the only `StereoPannerNode` (and the only Web Audio
panner) in the SDK, and the only pan that raises a side above the level of the signal entering it.

## Mechanism (read from the source)

- `BrowserMonitor` builds `gainNode → panNode`, a `StereoPannerNode` (`BrowserMonitor.ts:33-37`), and writes
  `pan` to it (`:56-59`).
- Direct mode connects the input's source to the monitor's gain node (`BrowserMonitor.ts:132`). Without a
  channel mapping that source is the `MediaStreamAudioSourceNode` itself (`BrowserAudioInput.ts:381`, `:388`,
  `:407`); the gain node is created with defaults (`BrowserMonitor.ts:33`). Nothing in the SDK fixes the
  channel count on this path, so the browser's source node decides it. No node on the direct path applies
  `requestChannels`: it sets the `ideal` channel count of the stream request (`BrowserAudioInput.ts:139`,
  `:328`), and the mono mixdown node feeds the engine only (`:395-400`, `:407`).
- Effects mode returns from the engine into the same gain node (`BrowserMonitor.ts:136`) through a two-channel
  merger (`packages/studio/core/src/MonitoringRouter.ts:77-85`), so the stereo algorithm always applies there.
- A `StereoPannerNode` with a two-channel input adds the far channel into the near one, scaled by the pan
  (Web Audio specification, StereoPannerNode's panning algorithm): at pan −1 the left output is left + right.
  With a one-channel input it is an equal-power pan.
- The channel strip: `crates/engine-env/src/channel_strip.rs:114-117`.
- The plan names the node without a law: `plans/done/advanced-monitoring.md:141`
  (`readonly #monitorPanNode: StereoPannerNode   // pan`), and its test list says "Adjust pan → signal moves."
  (`:276`). It calls the monitoring chain "**always stereo**" (`:51`).

## After a fix

The page reads FIXED when the monitor's pan in direct mode reads `unity` at both requests (the strip's law).
A monitor pan made equal-power for every input would read `equal-power` and keep BUG PRESENT, since the page
judges against the strip; that would be a decision to record here, not a failure.

## For waveform-playlist #684 (context only, nothing posted)

The same question there is which law a clip's pan follows by channel count. What this survey adds: a
`StereoPannerNode` gives a mono clip an equal-power pan (−3 dB at the centre) and a stereo clip a fold-over
pan (0 dB at the centre, the far channel moved into the near one, up to +6 dB for a dual-mono file), so one
control has two laws depending on the file. openDAW's engine avoids that by using one balance for
everything. And in Chrome a mono `MediaStream` reaches the node as two channels, so a live input gets the
stereo law there even when the track is mono, while Firefox and Safari give it the mono law (measured, the
stream-source note): a monitor built on a `StereoPannerNode` pans differently per browser unless the
channel count is fixed explicitly before the node.

## Fix ideas (internal, not for the issue)

- Replace the panner by two gains following the strip's balance (a splitter, two gain nodes, a merger), with
  the input forced to two channels (`channelCount = 2`, `channelCountMode = "explicit"`) so a mono input is
  the same in every browser.
- Or keep the panner and fix the gain node's channel count at 1 for a mono request: equal-power everywhere,
  still unlike the strip.

## History

The first reading (2026-11-23, on `monitoring-mono-return-debug-demo.html`, PR #240): gains through the pan
node of ×2.00 / ×1.00 / ×2.00 at both requests, two channels reaching the pan; before that, levels of 0.354 /
0.177 / 0.354 on a scratch probe that was not kept.
