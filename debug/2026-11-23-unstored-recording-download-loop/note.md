# A recording that cannot be stored: the download offer loops when no notifier is installed

**Status:** the repeated request measured in Node and in the Playwright browser, the missing exit read from the code; **draft for upstream waiting for a read** ([`drafts/TO-REVIEW-openDAW-unstored-recording-offer-without-notifier.md`](./drafts/TO-REVIEW-openDAW-unstored-recording-offer-without-notifier.md)). Not run in a normal Chrome window.
**SDK:** `@opendaw/studio-sdk@0.0.189` (`studio-core` 0.3.5, `lib-std` 0.0.89, `lib-dom` 0.0.96). The code arrived in 0.0.189 (`c882bdccc`).
**Repro:** `src/lib/unstoredRecordingPrompt.test.ts` (four tests, jsdom, no browser).

## What the SDK does

When a finished take cannot be written to browser storage, `RecordingWorklet` goes to `{type: "error"}`, `RecordAudio`
deletes the take's `AudioFileBox` with its regions, and `UnstoredRecording.offerDownload(audio, name, error)` offers the
audio as a WAV file (`studio-core/dist/UnstoredRecording.js`):

```js
while (await RuntimeNotifier.approve({headline: "Recording Not Saved", …, approveText: "Download WAV", cancelText: "Discard"})) {
    const saved = await Promises.tryCatch(Files.save(WavFile.encodeFloats(audio), {…}))
    if (saved.status === "resolved") {return true}
}
return false
```

The loop ends on a successful save or on the answer no. `RuntimeNotifier.approve` with no notifier installed resolves
`true` (`lib-std/dist/runtime-notifier.js`: `none: () => Promise.resolve(true)`). `Files.save` rejects when the picker
is cancelled (`AbortError`), and for any picker error other than `NotAllowedError` it calls `RuntimeNotifier.info`
(which resolves without a notifier) and rejects as well (`lib-dom/dist/files.js`).

So an app that has installed no notifier is never asked, gets the save picker at once, and when the save is refused
gets the next picker at once, with no answer that ends it. The take is already out of the project when the offer
starts, so the offer is the only copy. Each turn encodes the whole take to WAV again.

The openDAW studio installs a notifier in `boot.ts` (`RuntimeNotifier.install`, the dialogs), so it does not meet this.
Upstream's own tests of `offerDownload` install one too (`UnstoredRecording.test.ts`). Neither the SDK's readme nor the
`plans/` folder says an SDK user must install one (searched for `RuntimeNotifier` in both, 2026-11-23). **This repo's
demos install none** (no `RuntimeNotifier` in `src/` before this note's test).

## Measured

**Node** (`src/lib/unstoredRecordingPrompt.test.ts`, the installed `UnstoredRecording.js`, `showSaveFilePicker` stubbed
to refuse 50 times and then never answer, which parks the loop):

| Picker refuses with | Notifier | Picker calls | How it ended |
|---|---|---|---|
| `AbortError` (the user cancels) | none | 51: each of the 50 refusals was followed by another request | parked by the stub on call 51 |
| `SecurityError` (an error that is neither a cancel nor `NotAllowedError`) | none | 51, the same | parked by the stub on call 51 |
| `AbortError` | installed, answers yes then no | 1 | by itself: the offer resolved `false` |

The stub stops the first two rows, so they do not show that the loop is endless; that is read from the loop's two
exits (a save that resolves, an answer of no), neither of which can happen there. `SecurityError` was picked as an
error `Files.save` treats as "other"; which error a browser gives a picker call without a user gesture was not checked.
A `NotAllowedError` takes `Files.save` to its anchor download, which resolves and ends the offer.

**Browser** (Playwright's Chrome, a page of the dev server, `UnstoredRecording.offerDownload` called directly with one
second of silence, `window.showSaveFilePicker` wrapped to count and to park after 200 calls): **201 calls in under
3 s**, stopped by the wrapper's park, every refusal `AbortError: … Intercepted by Page.setInterceptFileChooserDialog`.
Playwright aborts a file picker by itself, so this run stands in for a user who cancels every time; no picker was
drawn.

## Not measured

- **A normal Chrome window.** Whether the first picker shows depends on whether a user gesture is still active when
  the take finishes storing. After a cancelled picker the gesture is used up, so the next call is expected to be
  refused without drawing anything (with which error name was not checked; the `SecurityError` row stands for it), and the loop to spin unseen until the next click anywhere on the page gives it a
  gesture to open another picker. That is read from the platform's rules, not seen. Not run because it would open real
  file pickers in a loop on the user's screen.
- **The path from a full storage.** The offer was called directly. That a quota failure reaches it is read from
  `RecordingWorklet.#finalize` and `RecordAudio`'s `sink.onFailed`; the upgrade did not provoke it either.
- **Firefox and Safari** have no `showSaveFilePicker`: `Files.save` takes the anchor download, which resolves, so the
  offer ends after one download nobody was asked about.

## The same default elsewhere, read only

`Promises.approvedRetry` (lib-runtime) retries its factory for as long as `approve` says yes, with no count; the cloud
backups upload through it. Without a notifier a failing upload would retry without end. `Network.defaultFetch` asks
the same way when offline but stops after 30 turns. Neither was run.

## What an SDK user can do

Install a notifier before any recording, with an `approve` that can answer no:

```typescript
import { RuntimeNotifier } from "@opendaw/lib-std";

RuntimeNotifier.install({
  info: async ({ headline, message }) => { /* show it */ },
  approve: async ({ headline, message, approveText, cancelText }) => /* ask, resolve true or false */ false,
  progress: () => ({ message: "", terminate: () => {} }),   // a `RuntimeNotification.ProgressUpdater`
  notify: ({ message }) => { /* a toast */ },
});
```

`install` asserts when called twice. The control row above is the measurement behind this: with an `approve` that
answers no, the offer ends. The demos here do not install one yet; that is a decision for the repo's owner, since it
changes every `approve` the SDK makes from "yes" to a question.
