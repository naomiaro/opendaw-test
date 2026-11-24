**Posted 2026-11-23:** https://issues.chromium.org/issues/589817009 — filed by the user through the tracker's wizard (role Web Developer, kind API, component Blink>WebAudio, Mac OS, Stable, 158.0.8127.89, "Yes - This is just a Chrome problem"), from the user's moises.ai account by the user's choice.
**Title as filed (the wizard's summary allows 100 characters):** MediaStreamAudioSourceNode outputs 2 channels for a 1-channel track (40774165 still reproduces)

As filed, the text below went into the wizard's two fields ("Steps to reproduce problem": the steps and the snippet; "Please describe the problem": the rest), with the tables written as plain lists and "×" as "x", and one closing line added: "The synthetic rows were also read in a Playwright-launched Chrome 158 on the same machine, with the same result."

Known flaw of the filed text: the tracker rendered the fields as Markdown, so the console snippet shows on one line and the two backticks of its template literal were taken as inline-code marks. Copied from the rendered page it does not run; the page link is the working repro. The snippet is checked in as [`repro-snippet.js`](../repro-snippet.js) and a short follow-up comment linking it was typed into the issue's comment box on 2026-11-23 for the user to submit (the comment form has a CAPTCHA).

Notes written for the read before posting, not part of the issue:
- Why a new issue and not a comment: 40774165 has been closed for nineteen months and an outside reporter
  cannot reopen it. After filing, one line on 40774165 pointing at the new issue is enough.
- The main repro is a `MediaStreamAudioDestinationNode`'s stream, so it needs no microphone. 40774165's own
  condition, a mono MICROPHONE, was run in the user's Chrome on 2026-11-23 and is the second table.
  That Chrome was 158.0.8127.88 (arm64) and then 158.0.8127.89 after an update; both runs read the microphone
  and the synthetic rows the same.
- The page URL works once this repo's PR is merged and deployed. The page loads no openDAW code. The inline
  snippet below is the same measurement without the page; it was run as written in Chrome 158 on 2026-11-23
  (`track channelCount 1`, `{2: 300}`).
- Chrome's source was not read; the issue names no cause.
- The tracker was searched through the user's Chrome on 2026-11-23 (`MediaStreamAudioSourceNode mono channel`).

---

**Steps to reproduce**

1. Open https://opendaw-test.pages.dev/stream-source-channels-debug-demo and click Run (about fifteen seconds,
   silent, no microphone), or run this in the console of any page after a click:

```js
const ctx = new AudioContext();
await ctx.resume();
await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
  registerProcessor("count", class extends AudioWorkletProcessor {
    constructor() { super(); this.n = 0; this.seen = {}; }
    process(inputs) {
      this.seen[inputs[0].length] = (this.seen[inputs[0].length] || 0) + 1;
      if (++this.n === 300) this.port.postMessage(this.seen);
      return true;
    }
  });`], { type: "text/javascript" })));
const osc = new OscillatorNode(ctx);
const dest = new MediaStreamAudioDestinationNode(ctx, { channelCount: 1, channelCountMode: "explicit" });
osc.connect(dest);
osc.start();
const source = ctx.createMediaStreamSource(dest.stream);
const counter = new AudioWorkletNode(ctx, "count", { numberOfInputs: 1, numberOfOutputs: 0 });
counter.port.onmessage = (e) => console.log("track channelCount", dest.stream.getAudioTracks()[0].getSettings().channelCount, "quanta per input width", e.data);
source.connect(counter);
```

**Expected**

One channel. The Web Audio specification says of MediaStreamAudioSourceNode: "The number of channels of the
output corresponds to the number of channels of the MediaStreamTrack." (the same sentence in the 1.0
Recommendation, the 1.1 Working Draft and the editor's draft)

**Actual**

Chrome 158.0.8127.89 (macOS): the track reports `channelCount` 1 and the worklet is handed two identical channels on 300
of 300 render quanta.

| Stream | Chrome 158 | Firefox 159.0.1 | Safari 18.6 |
|---|---|---|---|
| destination with `channelCount` 1 | 2 channels on 300 of 300 quanta, identical | 1 channel on 300 of 300 | 1 channel on 299, 2 on the first |
| destination with `channelCount` 2 | 2 channels | 2 channels | 2 channels |
| control: a gain node with an explicit count of 1, no stream | 1 channel | 1 channel | 1 channel |

A mono microphone ("MacBook Pro Microphone (Built-in)", echo cancellation, noise suppression and gain control
off), the page with `?input=mic`, Chrome 158.0.8127.89 (arm64) on macOS 15.6.1 (158.0.8127.88 read the same):

| Asked for | Track's `channelCount` | Channels the worklet is handed | Identical |
|---|---|---|---|
| `channelCount: {ideal: 1}` | 1 | 2 on 300 of 300 quanta | yes |
| `channelCount: {ideal: 2}` | 1 | 2 on 300 of 300 quanta | yes |

**Why it matters**

A node after the source that behaves differently for mono and stereo input takes the stereo branch in Chrome.
On the same page a `StereoPannerNode` after the source reads, for the one-channel stream: Chrome centre ×1.00
and hard left or right ×2.00 (the stereo algorithm with two identical channels); Firefox and Safari centre
×0.71 and hard ×1.00 (the mono algorithm). A mono input panned to one side is 6 dB louder than at the centre
in Chrome only, and an app cannot tell from the track, which reports one channel.

**Earlier report**

40774165 (2021, a mono microphone into an AudioWorkletNode: Chrome logs 2, Firefox 1; confirmed by triage back
to M-84) was closed on 2025-04-14 as no longer reproducing, without a linked change, with a request to
reactivate it if it does.

**Version:** Chrome 158.0.8127.89 (Official Build) (arm64), macOS 15.6.1 (24G90): the microphone rows, and the
synthetic rows repeated in the same run. 158.0.8127.88 read the same the same day. The table's Chrome column was first read in a Playwright-launched
Chrome 158.
