---
name: live-audio-probe
description: Use when measuring or verifying what a running page actually outputs as sound through browser automation (claude-in-chrome or Playwright) - a level, a delay or latency, a dropout or dip, whether an input or an effect is really heard, monitoring - or when page-side JavaScript taps an AudioContext, fakes a microphone, reads an AnalyserNode, or a browser tool call times out, returns "[BLOCKED: Cookie/query string data]", or a click seems to do nothing.
---

# live-audio-probe

Measure the signal, on a rig whose own behaviour is known. Most wrong readings on a live page are the
instrument: a tap attached late, a tap on a shared node, a short read of a long analyser, a dead input stream.

For OFFLINE renders to WAV use `/audio-verify`. For a finding that should be filed, `/sdk-issue` (a repro page
that classifies itself outranks a console probe). How the demos' audits are run and read is in root CLAUDE.md.

## The helper

`probe.js` beside this file installs `window.__probe`. It is silent. Each tool call is its own scope, so reach
it as `window.__probe` every time. Install as early after navigation as you can: a pair wired before the patch
is never seen.

```js
// On this repo's dev server (checked). On any other page, paste the file's text into the call instead.
const src = (await import("/@fs/<absolute repo path>/.claude/skills/live-audio-probe/probe.js?raw")).default;
(0, eval)(src);
const P = window.__probe;
// Rules may be registered before the context exists; a pair matched early is attached at P.start.
P.tee((source, dest, output) => source instanceof AudioWorkletNode && output === 1, "out");   // the path
P.tee((source, dest) => dest instanceof AudioDestinationNode, "mix");                          // optional second tap
await P.start(theAppsAudioContext);   // fine on a suspended context; nothing is recorded until it runs
P.fakeMic();                          // after start: getUserMedia now answers with a fresh stream fed from P.micBus
```

A context is resumed by a real click on the page, never from the console.

Times are FRAMES of the audio clock. `P.now()` is the current frame; every pointer press after `P.start` is
logged with its frame in `P.clicks` (`P.clicks.at(-1).frame`, good to a few ms; keyboard shortcuts are not
logged), so a span can start a second before a click.

| Call | Gives | Checked on a stand-in graph (Chrome, 44.1 kHz) |
|---|---|---|
| `P.pairs` | every `Source[output]>Dest` connection since install, in order (first 2000; `P.pairs.length = 0` before the switch you want to read): how to find the pair to match | |
| `P.tee(match(source, dest, output), "out" \| "mix")` | tees the SAME output of the source into recorder channel 1 or 2. It reads what leaves the source (the destination node's own gain is not in it); every matching pair stays teed and sums, so keep the rule narrow | a path on output 1 of a splitter read alone: a tone on output 0 was 2% of its level there |
| `P.teed`, `P.micRequests` | must RISE when the path is switched on; if not, the rule or the microphone is not in use | |
| `await P.bridge()` | the fake microphone's own delay. Run it while the path is NOT wired | 21.61 ms, spread 0 |
| `await P.delay(n = 8, gapMs = 250)` | per-burst delay of the teed path, median, spread; a burst that never came out, or a delay over 0.8 of `gapMs`, is `null` | a 25 ms `DelayNode` added 25.01 ms |
| `P.envelope(from, to)` | 1 ms steps: `minDb` / `maxDb` against the median, runs under half or over 1.5 times it, `silent` | a 30 ms mute read as one low run of 30 ms |
| `P.envelope(from, to, {hz, channel})` | one frequency in 5 ms steps: its `peak` and the runs where it is at least half that peak. Compare PEAKS between tones: an absent tone still reads a few percent of the other by leakage. `channel: 2` reads the second tap | an 80 ms tone inside another read as one run of 80 ms; the absent one had no run |
| `P.tone(hz)` | a steady tone into the fake microphone (`.gain`, `.stop()`); use 1000, 2000, 3000 Hz | |
| `P.mute(tone, ms = 30)` | the positive control: mutes the tone 0.5 s from now, returns the frame to read from | |
| `P.span(channel, from, to)` | the raw frames (`x`) and `missingFrames` | |
| `P.run(name, fn)` / `P.results[name]` | start long work, poll for it | |
| `P.text(value)` | JSON with `=`, `&`, `?` replaced | |

The recorder keeps about 65 s. It runs on the audio thread (`P.recorder` reads `worklet`): a main thread blocked for 400 ms lost no
frame. On a page that refuses a blob worklet it falls back to `script-processor`, which does lose blocks and
whose frame numbers run a buffer ahead: say so in the report. A stereo source teed into `P.out` reads at the
MEAN of its channels: a tone of gain 0.05 on one side reads 0.025.

## Rules for the rig

1. **Tee at wiring time.** An app that wires a path on demand makes a new node pair each time. `P.tee` matches
   the pair as it is connected. A tap attached afterwards misses the start and reads low while it settles,
   which looks exactly like a dip.
2. **Tap the LAST pair that belongs to the path alone.** After it, on a node the main mix shares, you measure
   the mix; before it, a gain or pan the path applies later is invisible. Switch the path on once, read
   `P.pairs` for the order, write the rule, reload, and check `P.teed` rose. Name the pair in the report and
   say what lies after it (a duck on the shared output is not covered).
3. **A microphone request gets a fresh stream.** Apps stop the track they were given when the input is
   released; one shared stream is dead from then on and every later reading is silence.
4. **For timing use the recorder, never an analyser.** An analyser read describes the past (0.37 s for 16384
   frames at 44.1 kHz), and an array shorter than `fftSize` holds the OLDEST part of the window (checked on a
   ramp from 0 to 1: `short[0]` 0.000 while the newest sample was 1.000). Two analysers read one after the
   other are not frame-aligned.
5. **Report a delay beside `P.bridge()`.** The fake microphone costs about 20 ms by itself, and stream nodes
   differ from one another, so path minus bridge is an estimate: give both figures. Neither includes a real
   input's hardware latency or the output latency.
6. **`missingFrames` must be 0** for a span to count. If it is not, the row reads "not measured".
7. **Tell live input from old material by frequency.** Record the earlier material with one tone as the
   microphone, switch to another, then press the control under test: `P.envelope(from, to, {hz})` on each
   tone says which was heard and when. A level alone cannot. The first press, with no earlier material, is
   the control row. "The old tone was not on the path" counts only with proof it was sounding at all: tee
   the shared output into `"mix"` and show the old tone there in the same span. Cover a count-in, within 65 s.

## Rules for the evidence

- A row is run INSIDE the condition it claims. A value that arrives by a second, slower path (a saved state
  re-applied a second later) makes the row pass for the wrong reason: read inside the window, with a control
  that fails when the claimed path is cut.
- Every instrument fires on a positive control before a clean reading counts (schedule a 30 ms mute of the
  tone and see the envelope report it).
- Before comparing render hashes, render the unchanged state twice. Renders through third-party plug-ins
  are not always bit-stable; compare against that floor or use a project without them.
- A table is re-measured whole on the final commit. A row from before a later commit is dropped or labelled.
- Say what the setup really was (which tracks, which build, which browser, what stood in for the microphone).
- Start transport and recording with a REAL click. A real click is also what resumes a suspended context.

## Tapping this repo's demos

A tap at the destination answers one question only: is the page silent or not. For anything about one
path, a delay or a moment in time, use the helper above.

- Verify in-browser AUDIO demos by measuring the actual OUTPUT SIGNAL, not `isPlaying`/a
  disabled Play button — a transport reports "playing" while the engine renders silence
  (e.g. a note region with `loopDuration:0`). Tap output: monkeypatch
  `AudioNode.prototype.connect` to tee any `AudioDestinationNode` connection through an
  `AnalyserNode`, read `getFloatTimeDomainData` → RMS over ~2s (RMS≈0 = silent). Inspect the
  live box graph by pulling `project` from the React fiber (`root.__reactContainer$…` → walk
  `memoizedState` hooks for the obj with `.engine` + `.rootBoxAdapter`). That fiber is the one made at `createRoot`, and React
  swaps current and alternate on every commit, so for STATE that changes start from `root.__reactContainer$….stateNode.current`:
  the bare fiber reads the previous commit on every other update, which looks exactly like a page stuck in a stale state. The engine's `connect`
  fires seconds AFTER page load (during "Starting engine…") — inject the patch immediately
  after navigation and the race is winnable on a fresh load; claude-in-chrome's post-load
  round-trip usually loses it. If the race is lost, don't reload-and-retry: swap in a fresh
  receiver and restart the worklet via the SDK's own crash-recovery path —
  `project.liveStreamReceiver = new (project.liveStreamReceiver.constructor)();
  const w = project.startAudioWorklet(); await w.isReady()` — the new (tapped) worklet
  re-points the engine facade via `setWorklet`; the old worklet idles stopped. The receiver
  swap is required: `LiveStreamReceiver.connect` asserts "Already connected" and aborts the
  EngineWorklet constructor mid-build without it. (Verified on warp/time-pitch demos.)
  The SDK's own taps (peaks, spectrum, waveform, stereo, gonio, loudness) read the engine's
  analysis mix WITHOUT the metronome; to measure a click, tap the destination yourself.

## Browser tool limits

- A claude-in-chrome `javascript_tool` call is cut off at about 45 s (a Playwright MCP call past 120 s is
  moved to the background): start the work with `P.run` and poll.
- claude-in-chrome ref-based clicks (from `find`) can silently fail to trigger React
  handlers on these demos — click by coordinates from a screenshot instead. Also:
  `javascript_tool` results dumping page text can trip the extension's
  "[BLOCKED: Cookie/query string data]" filter — read results via screenshot.
- After `resize_window`, screenshot pixel coordinates can stop mapping 1:1 to the
  viewport (screenshot 1456×814 vs a 1400×900 window) — coordinate clicks then miss
  silently (button looks clicked, handler never fires; reads as "transport dead" while
  `engine.play()` from the console works). Re-screenshot after any resize and verify one
  click took effect (state change) before trusting a click sequence. For handler-only
  tests with the AudioContext already running, DOM `.click()` is a valid cross-check.
- claude-in-chrome `read_console_messages`: timestamps are backfilled to when console
  tracking attached, and message blocks can appear duplicated across reads — trust only
  relative message order, never elapsed time between entries. Missing console lines are
  NOT evidence of a hang — the tracker drops messages. Before diagnosing "hung", check
  the page's own error surface (e.g. a Got/error table row you haven't scrolled to).
  Debug pages should self-classify failures: record a stage trail and race every await
  against a deadline so the verdict is OK/HUNG/THREW with the last stage named (see
  `wasm-ensure-ready-second-context-debug-demo.tsx` `raceHang`).
- Playwright `browser_console_messages` with `all: true` returns history across prior agent
  sessions on the same browser context (HMR `createRoot` errors, other agents' test output) —
  judge your run on the per-navigation "Console: N errors" count, not the `all: true` log.
- Which browser for which probe: the Playwright MCP's Chrome runs with
  `--disable-back-forward-cache` (read on `chrome://version`), so a back/forward-cache run there
  always reads not-cached — run those through the user's Chrome (claude-in-chrome). Two agents on
  the one Playwright browser navigate each other's runs away: hand it over explicitly ("browser
  free") before a second agent uses it. After the user quits and reopens Chrome (an OPFS restart
  round), claude-in-chrome can stop answering for the rest of the session; fetch public pages with
  curl instead. A 30 s probe run is cut by any save under `src/` (Vite reload) — hold edits while a
  run is on.
- The harness refuses page-side OPFS deletes (`removeEntry`) and even `localStorage.setItem` as
  irreversible: hand the user the one-liners to paste into DevTools instead of retrying. A real
  restart of the USER'S Chrome needs the user (Cmd+Q, the URL typed by hand — session restore carries
  `sessionStorage` over); the Playwright MCP's Chrome restarts on `browser_close` (its last page, same profile, OPFS kept),
  which the OPFS usage probe reads as a restart.
- Playwright MCP screenshots: omit the `filename` param — custom-named files land
  loose in the MCP server's CWD (which may be a DIFFERENT repo than the one you're
  working in); default-named files land in `.playwright-mcp/`.
- Radix Slider in browser tests: click the slider, then send the `End`/`Home` key —
  jumps to max/min through the real onValueChange path (no fragile drag math).
- Playwright text assertions: JSX expressions split DOM text nodes — XPath
  `contains(text(),…)` misses strings spanning the split; use
  `document.body.innerText.includes(…)`.
- Mobile-clipping checks must be per-element: `overflow:hidden` containers clip without
  any document scrollbar — compare `el.scrollWidth > el.clientWidth`. Grid items holding
  unbreakable content (code tokens) need `min-width: 0` or the 1fr track widens past
  its container.
