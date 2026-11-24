# Safari delivers a mono microphone as two channels with the second silent (echo cancellation off)

**Status: measured 2026-11-24 without the SDK, Safari 18.6 on macOS 15.6.1 (24G90), by hand. A browser behaviour,
not an SDK defect, and already on WebKit's tracker: [259193](https://bugs.webkit.org/show_bug.cgi?id=259193) and
[281978](https://bugs.webkit.org/show_bug.cgi?id=281978), both open. Entry in
[`docs/known-vendor-issues.md`](../../docs/known-vendor-issues.md). No new report; a comment for 259193 waits in
[`drafts/`](./drafts/TO-REVIEW-webkit-259193-comment.md). Not measured through the SDK.** Found on the harness of
[the stream-source note](../2026-11-23-stream-source-channel-count/note.md), while checking whether Safari's
silent two-channel first quantum was worth a report (it was not; that note has it).

Repro page: `stream-source-channels-debug-demo.html?input=mic` (SDK-free; `&echo=on` asks for the microphone with
echo cancellation), run by hand in a normal Safari window: under WebDriver (`drive-safari.ts`) Safari answers
`getUserMedia` with "Mock audio device 1", two channels both carrying signal, which says nothing about a
microphone. The page asks with `noiseSuppression` and `autoGainControl` off and `channelCount` ideal 1, then 2;
each stream goes through `createMediaStreamSource` into an AudioWorklet that counts the channels of 300 render
quanta and takes a peak per channel, and into a `StereoPannerNode` whose gains are read at pan −1 / 0 / +1.

## Measured

"MacBook Pro Microphone" (built in, one channel in Chrome's track settings), context at 44.1 kHz.

By hand in a normal Safari 18.6 window, `?input=mic`, 2026-11-24, one run, "MacBook Pro Microphone", echo
cancellation off (as the page asked on that day): 2 ch × 300 from quantum 0 for ideal 1 and for ideal 2, the
channels NOT identical (largest difference equal to the peak, 0.0150 and 0.0161), and the panner after it reads
centre ×1.00 / ×0.00, hard ×1.00 / ×1.00. Those two readings together say the second channel is silent: the
panner's stereo branch with nothing on the right gives exactly that (left only at centre, the left channel
moved across at hard right). Inferred, not read directly: that run recorded one peak over both channels. The
page now prints a peak per channel, and `&echo=on` asks with echo cancellation.

Read directly on the page as it is now, two more runs by hand the same day (any room sound):

| Request | Delivered | Peaks, first / second channel | Panner after it |
|---|---|---|---|
| echo cancellation off, ideal 1 | 2 ch × 300 from quantum 0 | 0.0784 / 0.0000 | centre ×1.00 / ×0.00, hard ×1.00 / ×1.00 |
| the same node again; a second node | 2 ch × 300 | 0.0646 / 0.0000; 0.0652 / 0.0000 | |
| echo cancellation off, ideal 2 | 2 ch × 300 from quantum 0 | 0.0646 / 0.0000 | centre ×1.00 / ×0.00, hard ×1.00 / ×1.00 |
| the same node again; a second node | 2 ch × 300 | 0.0743 / 0.0000; 0.0767 / 0.0000 | |
| echo cancellation on, ideal 1 | 2 ch × 195 silent (quanta 0..194), then 1 ch × 105 | 0.0864 | centre ×0.71 / ×0.71 (the paste is cut after "har") |
| the same node again; a second node | 1 ch × 300; 2 ch × 2 silent then 1 ch × 298 | 0.0856; 0.0432 | |
| echo cancellation on, ideal 2 | 2 ch × 18 silent (quanta 0..17), then 1 ch × 282 | 0.0522 | centre ×0.71 / ×0.71, hard ×1.00 / ×1.00 |
| the same node again; a second node | 1 ch × 300; 2 ch × 2 silent then 1 ch × 298 | 0.0273; 0.0276 | |

So the second channel is silent with echo cancellation off, on every node, and with echo cancellation on the
microphone arrives as one channel (281978 reports two there). The page's verdict reads INCONCLUSIVE on these
runs because Safari's track reports no channel count to judge the rows against. The silent two-channel start is
the one the stream-source note describes on a synthetic stream; it lasts until the stream's first audio, 195
quanta (0.57 s) on the first microphone open.

So in Safari a mono microphone asked for without echo cancellation, played through a source node with nothing
fixing the channels, sounds on the left only at centre pan. This is already on WebKit's tracker, twice, both
NEW with no engineer comment (read 2026-11-24): [259193](https://bugs.webkit.org/show_bug.cgi?id=259193)
"1-channel hardware devices from getUserMedia() appears to have silence in a second track" (2023-07, Safari
15.4 and 16, MacBook microphone, echo cancellation off, rdar 112602770) and
[281978](https://bugs.webkit.org/show_bug.cgi?id=281978) "Disabling echoCancellation in getUserMedia request
results in left channel audio only" (2024-10, Safari 17 and 18.0, rdar 138921708; with echo cancellation on
both channels carry audio). **No new report**: a comment on 259193 with the Safari 18.6 figures is the most
there is to add (draft: [`drafts/TO-REVIEW-webkit-259193-comment.md`](./drafts/TO-REVIEW-webkit-259193-comment.md)).
Both are in the vendor register's WebKit measured entries ([`docs/known-vendor-issues.md`](../../docs/known-vendor-issues.md)).

## Where it bites here

The SDK opens its capture with `echoCancellation: false` (`BrowserAudioInput.ts`, `#requestStream`, read in the
SDK checkout), and its direct monitoring connects the source to a `StereoPannerNode` with nothing fixing the
channels. So in Safari a mono microphone would be monitored on the left only at centre pan, and a two-channel
take would carry it on the left only. The SDK page's one-sided rows (`monitor-pan-law-debug-demo.html`, a
synthetic stream with the signal on the left) show what the SDK does with that shape in Chrome: the monitor's
pan moves it, the strip's pan at +1 removes it, and a mono request records the ×0.50 mixdown.

## Not measured

- Through the SDK in Safari: `monitor-pan-law-debug-demo.html?input=mic` has not been run there.
- Another mono input (a USB microphone), iOS, and an earlier or later Safari.
- A real microphone in Firefox.
