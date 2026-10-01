# Recording finalization has no failure terminal state

A recording's `SampleLoader` (the `RecordingWorklet` itself, while recording) only
ever reaches the terminal state `{type: "loaded"}`. If finalization does not
complete, the loader stays in `{type: "record"}` indefinitely — there is no
`{type: "error"}` and no other terminal signal. A consumer waiting on
`loader.subscribe(...)` for completion therefore cannot distinguish a *slow*
finalization from one that will *never* finish; a timeout is the only safety net.

**Pin:** `@opendaw/studio-sdk` 0.0.154 / `@opendaw/studio-core` 0.0.152.

## Symptom (observed in the wild, not reproduced on demand)

On `loop-recording-demo.html`, the first record→stop cycle in a fresh browser
*occasionally* left the take's loader non-terminal: the finalization barrier
logged "0/1 terminal", the 30 s safety timeout fired, and a subsequent Play hung
(`queryLoadingComplete` never resolved). An immediate retry in the same session
finalized normally in ~1 s. Seen twice (2026-06-12), both times loop-recording,
first cycle, fresh context. It is rare and non-deterministic — see "Status" below.

## What the debug page measures

`recording-finalize-debug-demo.html` (unlisted) mirrors loop-recording's config
(loop 0→2 bars, takes, metronome, 1-bar count-in), records one cycle with the real
microphone, then polls the loader through finalization and intercepts the SDK's
own `[RecordAudio]` console breadcrumbs. For each cycle it reports a verdict
(FINALIZED / STUCK / ERROR) plus the raw numbers, also written to
`window.__finalizeDebug` for scripted runs.

The relevant quantities at the moment recording stops:

- `numberOfFrames` — frames the loader has actually drained from the ring buffer.
- `limitSamples` = `ceil((waveformOffset + duration) * sampleRate)` — the frame
  count finalization waits for (the value passed to `recordingWorklet.limit(...)`).
- `deficit` = `limitSamples − numberOfFrames`.

Finalization completes only while `numberOfFrames >= limitSamples` (i.e. `deficit
<= 0`). Across **26 valid cycles** in this environment (real MacBook mic, headed
Chromium; 10 same-context reloads + 16 fresh `browser.newContext()` loads) every
cycle finalized in ~100 ms with `deficit` between **−1407 and −1920 frames**
(≈ 32–44 ms surplus at 44.1 kHz). The margin is real but thin: if it ever inverts
(`deficit > 0`), the gate is never satisfied and finalization does not run.

## Mechanism candidate (INFERRED from source — not observed failing at runtime)

Traced in the installed dist; line numbers decay, re-verify before quoting.

- `RecordingWorklet.js`: initial state is `{type: "record"}` (`:17`). The only
  `#setState({type: "loaded"})` is inside `#finalize()` (`:87`). No code sets an
  error state.
- `#finalize()` is called from two places only — the ring-buffer reader callback
  (`:37`) and `limit(count)` (`:46`) — **both gated on `numberOfFrames >=
  limitSamples`** (`limit()` at `:43–48`). Its promise rejections are swallowed by
  `.catch(error => console.warn(error))` (`:37`, `:46`). `#finalize` itself can
  reject via `panic("No recording data available")` (`:75`) or a rejected
  `sampleService.importRecording(...)`.
- `subscribe(observer)` synchronously fires only for `{type: "loaded"}`; otherwise
  it just registers the observer (`:58–64`).
- `RecordAudio.js`: on stop, the source node is disconnected (`:144`), then for a
  non-empty take `recordingWorklet.limit(Math.ceil((currentWaveformOffset +
  duration) * sampleRate))` is called (`:167`). `duration` is written each engine
  position tick from an earlier `numberOfFrames` snapshot (`:253–256`). If the
  stop-time `numberOfFrames` has not reached that `limitSamples`, `limit()` does
  not finalize and waits for more ring-buffer frames — but the source is already
  disconnected, so they may never arrive.

The inferred consequence (consistent with the wild sighting): a `deficit > 0` at
stop, or a swallowed `#finalize` rejection, leaves the loader in `{type: "record"}`
with no terminal event. This session measured the gate and margin directly but did
not catch a failing cycle, so the failure path itself remains source-traced.

(`RecordAudio` also has a legitimate non-finalizing path: stopping before any take
is created — e.g. during count-in — takes the abort branch at `:145`
[`numberOfFrames === 0 || fileBox.isEmpty()`], terminating the worklet with no
loader. That is **not** this issue; the debug page records past count-in so a take
always exists, confirmed by the `[RecordAudio] stop` breadcrumb.)

## How to reproduce / use the page

```
npm run dev -- --port 5180 --host 127.0.0.1
# open https://localhost:5180/recording-finalize-debug-demo.html
```

1. Click **Arm Tape (mic)** (grant microphone access).
2. Click **Record**, perform a few seconds, **Stop** — or click **Auto cycle**
   for a deterministic record→stop (records past count-in).
3. Read the verdict and the JSON result. FINALIZED prints `deficit < 0` (surplus);
   STUCK with a `[RecordAudio] stop` breadcrumb in the log is the symptom (loader
   stayed `"record"`, no terminal event, `deficit` shown).

Scripted fishing (mic granted at the context level, fresh context per attempt):

```js
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ["microphone"] });
const p = await ctx.newPage();
await p.goto(url);
await p.getByRole('button', { name: 'Arm Tape (mic)' }).click();
await p.getByRole('button', { name: 'Record', exact: true }).waitFor();
await p.evaluate(() => window.__runAutoCycle());
// poll window.__finalizeDebug for { verdict, deficit, numberOfFrames, limitSamples, sawWarn }
```

Note: running many contexts *concurrently* is not a valid amplifier — Chromium
throttles background-tab `setTimeout` and AudioContext rendering, starving the
cycle before a take is recorded (verdict STUCK with `sawStop: false`,
`numberOfFrames: null`). Run cycles sequentially.

## Status

Symptom **not reproduced on demand** in this session: 0 genuine STUCK cycles in 26
valid sequential attempts (all FINALIZED, `deficit` −1407…−1920). The page is
retained as the capture instrument — `window.__finalizeDebug` records the verdict
and margin whenever the race does occur. The design observation (no failure
terminal state) holds independent of reproducing the race.
