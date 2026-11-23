**Target:** a new issue on `andremichelle/openDAW`. Not posted.
**Title:** The WAV download offer for an unstored recording never ends when no `RuntimeNotifier` is installed

---

Hi, Naomi's Claude here.

SDK 0.0.189. `UnstoredRecording.offerDownload` loops until a save succeeds or `RuntimeNotifier.approve` answers no:

```ts
while (await RuntimeNotifier.approve({headline: "Recording Not Saved", …})) {
    const saved = await Promises.tryCatch(Files.save(WavFile.encodeFloats(audio), {…}))
    if (saved.status === "resolved") {return true}
}
return false
```

With no notifier installed, `RuntimeNotifier.approve` resolves `true`. `Files.save` rejects when the picker is
cancelled, and for a picker error other than `NotAllowedError` it calls `RuntimeNotifier.info` (which resolves without
a notifier) and rejects too. So for an SDK user who has not called `RuntimeNotifier.install`:

- nobody is asked, the save picker is requested at once;
- a refused save is followed by the next request at once, and no answer ends the loop;
- every turn encodes the take to WAV again;
- the take's `AudioFileBox` and regions were already deleted by `RecordAudio`'s `onFailed`, so the offer is the only
  copy of the audio.

The studio installs a notifier in `boot.ts`, and `UnstoredRecording.test.ts` installs one, so neither meets the case.

**Measured**

Against the installed `studio-core/dist/UnstoredRecording.js`, in vitest with jsdom, `window.showSaveFilePicker`
stubbed to refuse 50 times and then never answer:

| Picker refuses with | Notifier | Picker calls | Offer settled |
|---|---|---|---|
| `AbortError` | none | 51 | no |
| `SecurityError` | none | 51 | no |
| `AbortError` | installed, answers yes then no | 1 | yes, `false` |

In Chrome under Playwright, `UnstoredRecording.offerDownload` called directly on a page with no notifier, the picker
wrapped to count: 201 calls in under 3 s, the offer still pending. Playwright aborts file pickers by itself, so that
run is a user cancelling every time; I have not run it in an ordinary Chrome window, and I called the offer directly
without filling the storage.

- Test: https://github.com/naomiaro/opendaw-test/blob/main/src/lib/unstoredRecordingPrompt.test.ts
- Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-unstored-recording-download-loop/note.md

**Related, read only, not run:** `Promises.approvedRetry` retries for as long as `approve` says yes with no count, so
the same default would retry a failing cloud upload without end.

Is an SDK user expected to install a notifier? The readme does not mention `RuntimeNotifier`.
