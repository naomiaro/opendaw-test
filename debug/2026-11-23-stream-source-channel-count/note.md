# Chrome's `MediaStreamAudioSourceNode` delivers two channels for a one-channel track

**Status: measured 2026-11-23 without the SDK, Chrome 158 against Firefox 159 and Safari 18.6. A browser
behaviour, not an SDK defect: entry in [`docs/known-vendor-issues.md`](../../docs/known-vendor-issues.md).
Chromium issue [40774165](https://issues.chromium.org/issues/40774165) is this behaviour, closed as fixed in
2025 without a change; a NEW Chromium issue is drafted and waits for a read
([`drafts/TO-REVIEW-chromium-stream-source-two-channels.md`](./drafts/TO-REVIEW-chromium-stream-source-two-channels.md));
the earlier report's own condition, a mono microphone, reproduces in the user's Chrome (below).** Found while tracing why two channels
reach the SDK's monitor pan ([the monitor pan note](../2026-11-23-monitor-pan-doubles-at-hard-pan/note.md)).

**Probe page:** `stream-source-channels-debug-demo.html` (`src/demos/engine/stream-source-channels-debug-demo.ts`),
no SDK, a real click on Run, about fifteen seconds, silent. `#verdict[data-verdict]` reads `SPEC`, `UPMIXES`
or `INCONCLUSIVE`; `?input=mic` adds two rows on the default microphone (asked for with `channelCount`
ideal 1, then ideal 2). It carries the hooks of the repo's browser drivers:
`node scripts/audit/loudness/drive-firefox.ts "https://localhost:5180/stream-source-channels-debug-demo.html" 90`
(and `drive-safari.ts`).

## What the specification says

Web Audio API, the MediaStreamAudioSourceNode interface (read from the specification's source,
`WebAudio/web-audio-api` `index.bs`, on 2026-11-23): "The number of channels of the output corresponds to the
number of channels of the {{MediaStreamTrack}}." (the braces are the source's markup for a link).
The same sentence, followed by "When the MediaStreamTrack ends, this AudioNode outputs one channel of
silence.", stands in all three texts read on 2026-11-23: the W3C Recommendation (Web Audio API 1.0,
`w3.org/TR/webaudio-1.0/`), the current Working Draft (Web Audio API 1.1, `w3.org/TR/webaudio/`) and the
editor's draft source. A search of the specification's issues (`WebAudio/web-audio-api`:
"MediaStreamAudioSourceNode channels", "MediaStreamAudioSourceNode mono") returned nothing.

The StereoPannerNode's algorithm in the same document has a mono and a stereo branch: for mono input
`outputL = input * gainL; outputR = input * gainR` with `x = (pan + 1) / 2`; for stereo input and
`pan <= 0`, `outputL = inputL + inputR * gainL; outputR = inputR * gainR`. So what the source node delivers
decides which pan a `StereoPannerNode` after it applies.

## Measured

macOS, context at 44.1 kHz, a 440 Hz tone into a `MediaStreamAudioDestinationNode` with an explicit
`channelCount`; its stream through `createMediaStreamSource` into an AudioWorklet that records the number of
channels of each of 300 render quanta, and into a `StereoPannerNode` whose gains are read at pan −1 / 0 / +1.
One run per browser on the page as committed (an earlier run each, before the row status was judged against
the built channel count, read the same channels and gains).

| Stream | Chrome 158 (Playwright's) | Firefox 159.0.1 | Safari 18.6 |
|---|---|---|---|
| destination with 1 channel | 2 ch × 300, identical; panner centre ×1.00, hard ×2.00 | 1 ch × 300; panner centre ×0.71, hard ×1.00 | 1 ch × 299, 2 ch × 1; panner centre ×0.71, hard ×1.00 |
| the same stream, cloned | the same | the same | the same |
| destination with 2 channels | 2 ch × 300; centre ×1.00, hard ×2.00 | 2 ch × 300; centre ×1.00, hard ×2.00 | 2 ch × 300; centre ×1.00, hard ×2.00 |
| track's `getSettings().channelCount` for the 1-channel stream | 1 | not reported | not reported |
| verdict | `UPMIXES` | `SPEC` | `SPEC` |

Controls in every browser: a gain node with an explicit channel count of 1 (no stream) is counted as one
channel and reads centre ×0.71, hard ×1.00; with a count of 2, two channels and centre ×1.00, hard ×2.00.

Safari hands over one quantum of two channels before the one-channel ones.

### A real mono microphone (the earlier report's condition)

The user's Chrome (build to be added from `chrome://version`), macOS 15.6.1, `?input=mic`, one run, the
synthetic rows and controls as in the table above. The microphone is "MacBook Pro Microphone (Built-in)",
opened with echo cancellation, noise suppression and gain control off.

| Asked for | Track reports | Delivered | Identical | Peak | Panner after it |
|---|---|---|---|---|---|
| `channelCount` ideal 1 | 1 | 2 ch × 300 | yes | 0.0100 | centre ×1.00, hard ×2.00 |
| `channelCount` ideal 2 | 1 | 2 ch × 300 | yes | 0.0081 | centre ×1.00, hard ×2.00 |

Verdict `UPMIXES`. Asked for two channels, the mono microphone still gives a track that reports one.

## Not measured

- A real microphone in Firefox and Safari.
- Chrome on Windows or Linux, and Chrome's source (two fetches were rate-limited): what in Chrome widens the
  stream is not read.
- A stream of more than two channels.

## Where it bites here

The SDK's direct monitoring connects the capture's `MediaStreamAudioSourceNode` to a `StereoPannerNode` with
nothing fixing the channel count between them. In Chrome a mono input therefore gets the stereo branch (hard
pan is +6 dB against the centre); in Firefox and Safari, by the table above, it would get the mono branch
(centre 3 dB down). The SDK page (`monitor-pan-law-debug-demo.html`) measured the Chrome half; it was started
once in Firefox, where its capture did not open within the page's ten-second deadline (not looked into).

## The tracker

Searched through the user's Chrome on 2026-11-23 (`MediaStreamAudioSourceNode mono channel`, seven results,
all read by title, 40774165 in full). 40774165, "Web Audio: incorrect channelCount inferred from Stream to
Worklet": filed 2021-06 against Chrome 91 with a mono microphone and a fiddle that logs a worklet's input
channel count (Chrome 2, Firefox 1); confirmed by Chromium triage on Mac, Windows and Linux back to M-84; a
Chromium engineer noted in 2021 that the node reports `channelCount: 2`; marked fixed on 2025-04-14 by a
tester who wrote "It looks like it isn't repro anymore" on Windows 11 and asked for it to be reactivated if it
reproduces, with a track-settings dump (`"channelCount": 1`) as the evidence. No change is linked.
