# Arming a capture whose input is refused leaves it armed with no stream

**Status: measured on `@opendaw/studio-sdk@0.0.189`, 2026-11-23. Not filed; draft waiting for a read:
[`drafts/TO-REVIEW-opendaw-capture-armed-without-input.md`](./drafts/TO-REVIEW-opendaw-capture-armed-without-input.md).**
Noticed while reading the capture path for
[the monitor pan note](../2026-11-23-monitor-pan-doubles-at-hard-pan/note.md).

**Repro page:** `capture-armed-without-input-debug-demo.html`
(`src/demos/recording/capture-armed-without-input-debug-demo.tsx`), a real click on Run, about twenty seconds,
silent, no microphone opened. Verdict on `#verdict[data-verdict]`, with `data-after-refusal`
(`armed-no-stream` / `disarmed` / `stream-open`), `data-signal` (`unhandled-rejection-only` / `notice` /
`none` / `unhandled-rejection-other`), `data-retry` (`no-retry` / `opened` / `retried-no-stream`),
`data-monitoring`, `data-recording-start`.

**Verified against:** SDK 0.0.189, source read at the release commit `d143a4f5`.

## What happens

`capture.armed.setValue(true)` on a `CaptureAudio` asks the browser for the input. When the browser refuses
(`getUserMedia` rejects, as with a denied microphone permission), the capture stays armed and has no stream.
Nothing tells the app: no notice goes to the `RuntimeNotifier`, `armed` does not change, and the only trace
is an unhandled promise rejection on the window whose reason is the SDK's `Errors.Warning`. The capture does
not try again while it stays armed. `capture.monitoringMode = "direct"` and `project.startRecording()` end the
same way: an unhandled rejection, and no monitoring or recording.

## Measured

Playwright's Chrome 158, macOS, 44.1 kHz, one run on the page as committed (two earlier runs, before the
notice count was made a count of notices added, read the same in every other column).
`navigator.mediaDevices.getUserMedia` is patched: it returns a silent synthetic stream, or rejects with
`new DOMException("Permission denied", "NotAllowedError")`. Each row watches for 2 s after the action.

| Row | armed | stream | `getUserMedia` calls | unhandled rejections | notices |
|---|---|---|---|---|---|
| control: a notice the page sends through `RuntimeNotifier.notify` | | | | | 1 counted |
| control: `armed.setValue(true)`, the input opens | true | open | 1 | 0 | 0 |
| `armed.setValue(true)`, refused | true | none | 2 | 1: `Errors.Warning`, "Error: NotAllowedError: Permission denied" | 0 |
| the same capture left armed, the input available again, 2 s | true | none | 0 | 0 | 0 |
| control: disarmed and armed again, the input opens | true | open | 1 | 0 | 0 |
| `monitoringMode = "direct"`, refused | true (mode reads `direct`) | none | 2 | 1: `Errors.Warning`, "Error: NotAllowedError: Permission denied" | 0 |
| `project.startRecording(false)`, the capture armed, refused | true | none | 2 | 1: `Errors.Warning`, "Error: Error: NotAllowedError: Permission denied" | 0 |

After the refused `startRecording`, `project.isRecording()` and `engine.isRecording` read false.

## Not measured

- A real denied permission. The refusal is a patched `getUserMedia`; a browser's own denial rejects with the
  same `NotAllowedError`.
- Other rejections (`NotFoundError` with no input device, `NotReadableError` with a device in use): read from
  the code, they take the same path.
- An app with no `RuntimeNotifier` installed: the page boots with this site's notifier.
- Firefox and Safari.

## Mechanism (read from the source)

- `AudioDevices.requestStream` turns a rejected `getUserMedia` into a thrown `Errors.Warning` carrying
  `String(error)` (`packages/studio/core/src/AudioDevices.ts:21-30`; `Errors.warn` throws `new Warning(issue)`,
  `packages/lib/std/src/errors.ts:4-7`).
- The two `getUserMedia` calls: `BrowserAudioInput.#requestStream` asks for the default device by its id
  first and, on any failure, once more without a device (`BrowserAudioInput.ts:323-339`); both are refused.
- `BrowserAudioInput.open()` awaits that request with nothing around it (`BrowserAudioInput.ts:119-156`, the await at `:141`), so
  the rejection leaves `open()`.
- `CaptureAudio` calls it from the observer of `armed`, an `async` function whose promise nobody holds
  (`packages/studio/core/src/capture/CaptureAudio.ts:61-68`): the rejection is unhandled, and `armed` is not
  written back. The observers of the input mapping and of `deviceId` do the same (`:34-42`, `:56-60`).
- `monitoringMode`'s setter sets the mode and then `armed.setValue(true)` (`:75-81`): the same path.
- `RecordingSession.start` catches the failed `prepareRecording`, resets its own recording flag and throws
  `Errors.warn(String(error))` (`packages/studio/core/src/capture/RecordingSession.ts:109-116`);
  `Project.startRecording` calls `Recording.start(this, countIn).finally()` with no handler
  (`packages/studio/core/src/project/Project.ts:388-392`), so that rejection is unhandled too.
- No retry: `open()` runs when `armed`, `deviceId` or the mapping changes, at a recording start and in
  `measureRoundTrip` (every call of `#streamGenerator` in `capture/CaptureAudio.ts`, the only caller of
  `open()` in `packages/studio/core/src`); nothing calls it for a capture that sits armed without a stream.
- The plans do not describe a refused input: `plans/capture.md` and `plans/done/advanced-monitoring.md` were
  searched for "denied", "refus", "reject", "permission", "fail", "unavailable", "NotAllowed"; the hits are
  about `setSinkId` failing, channel exhaustion, two `AudioDevices` classes, a permission request as something
  that disturbs a source node (`plans/capture.md:310`), and two unrelated uses of "reject" and "fail"
  (`plans/capture.md:121`, `:319`).

## Where an SDK app meets it

A user who denies the microphone (or has none) and arms a Tape sees it armed; monitoring is silent and Record
does nothing. An app can find out only by listening for `unhandledrejection` on the window and testing the
reason against `Errors.Warning`, or by comparing `capture.armed` with `capture.stream` after a wait.

## After a fix

The page reads FIXED when a refused arm leaves no unhandled rejection and the app is told another way: the
capture reads disarmed, or a notice is shown. Anything else reads INCONCLUSIVE and is read by hand.

## Fix ideas (internal, not for the issue)

- Catch the failed open in the `armed` observer, set `armed` back to false and send a
  `RuntimeNotifier.notify` / `info`.
- Give `Project.startRecording` a handler that notifies, or return its promise.
