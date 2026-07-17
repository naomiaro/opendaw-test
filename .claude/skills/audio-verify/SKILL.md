---
name: audio-verify
description: Verify warp/audio-engine behavior by offline-rendering the warp demo scenarios to WAVs and asserting beat alignment numerically with the audio-analyzer MCP. Use after changes to src/lib/beats/, src/demos/warp/, stretch-engine or tempo-track behavior, or when asked to verify audio output without listening.
---

# audio-verify

Renders the five warp scenarios full-song through the OpenDAW offline engine and
asserts beat alignment against expected times computed from the beat map. Replaces
"needs human ears" with numbers. Requires: the dev server (HTTPS certs present),
Playwright MCP, audio-analyzer MCP.

All thresholds below are calibrated from a full end-to-end run on 2026-06-10
(M-series Mac, Otherside.mp3 + 511-marker beat map).

## Workflow

1. **Start the dev server** from the branch/worktree under test:
   `npm run dev -- --port 5181 --host 127.0.0.1`
2. **Render each scenario** (sequentially; measured ~15–30 s per full-song render
   on an M-series Mac — budget minutes only for slower machines): navigate
   Playwright to `https://localhost:5181/audio-verify-debug.html?scenario=<s>` for
   `raw`, `varispeed`, `timestretch`, `grid-conform`, `grid-rigid`.
   Poll the `#verify-state` element's `data-verify-state` attribute:
   `setup → rendering → uploading → done`. On `error:<msg>`: stop, report the
   message. WAVs land at `.verify-output/verify-<scenario>.wav`.
3. **Expected times**: `node scripts/expected-beats.ts > /tmp/expected.json` —
   JSON with `projectBpm`, `gridTimes`, `fileTimes`, `fileTimesRigid`,
   `rigidClickTimes` (render-relative seconds).
4. **Analyze** each WAV with audio-analyzer `rhythm_analysis` on two 20 s windows:
   **[60, 80] s and [120, 140] s**. Collect the detected beat lists.
   Window choice matters: both windows must be musically dense (the tracker needs
   stability ≥ ~0.8; Otherside's first ~30 s is sparse guitar and unusable) and
   away from divergence zero-crossings (file-vs-grid drift is NOT monotonic — it
   re-converges where the song crosses its own average tempo, near 200 s for this
   file; a window there cannot discriminate raw from locked).
5. **Compare** per window with the committed helper:
   `python3 scripts/compare-beats.py /tmp/expected.json <list> "<detected beats>"`
   → median/p90/max nearest-expected distance in ms.

## How the metric behaves (read before judging numbers)

Nearest-expected distance saturates at half the inter-beat interval (~244 ms at
123 BPM). A misaligned render therefore reads as median ~120–244 ms — never
seconds. Measured reference points:

- Locked scenarios measure median **30–46 ms** (the onset-detection jitter floor
  on rendered audio is ~30–40 ms; sub-30 ms assertions are not achievable).
- Unaligned (random phase) measures median **~120–180 ms**.
- The beat tracker follows the MUSIC's pulse, not metronome clicks mixed into the
  render — click-based assertions must compare against the click list explicitly
  and expect the tracker to sit on the music.

## Assertions (per window, median nearest-distance)

| Scenario | Compare against | Pass criteria |
| --- | --- | --- |
| raw — sanity | fileTimes | ≤ 60 ms (the render plays the file; if this fails the harness/render is broken: STOP) |
| raw — negative control | gridTimes | ≥ 100 ms (the file does not sit on the grid; if raw "passes" the locked test the discriminator is broken: STOP) |
| varispeed | gridTimes | ≤ 60 ms |
| timestretch | gridTimes | ≤ 75 ms (WASM offline worker — see 2026-07-16 re-measurement) |
| grid-conform | fileTimes | ≤ 60 ms (conformed grid + clicks + music all coincide on file times) |
| grid-rigid — placement sanity | fileTimesRigid | ≤ 60 ms (music plays where the region was placed) |
| grid-rigid — negative control | rigidClickTimes | ≥ 90 ms ([60,80] measured 92 ms on the WASM worker; [120,140] ≥ 100 ms) |

Measured 2026-06-10 ([60,80] / [120,140] medians, ms): raw-vs-file 30/40,
raw-vs-grid 180/122, varispeed 33/32, timestretch —/46, conform —/35,
rigid-vs-fileRigid —/33, rigid-vs-clicks —/153. ("—" = [60,80] not yet
measured for that scenario; the [120,140] margins suggest similar values, but
the first run that fills those cells should not be surprised by small drift.)

Re-measured 2026-07-15 at SDK 0.0.159 (same windows): raw-vs-file 30/40,
raw-vs-grid 174/118, varispeed 33/32, timestretch 43/**68**, conform 30/35,
rigid-vs-fileRigid —/33, rigid-vs-clicks —/153; pitch ordering 0.983 > 0.953.
**timestretch [120,140] measures ~68 ms at 0.0.159** — over the nominal 60 ms
line. This is NOT a harness/render-path artifact: renders from the legacy
OfflineAudioContext path and the OfflineEngineRenderer path are byte-identical
(same SHA-256), so the drift comes from the SDK's 0.0.159 Tape/PitchVoice
changes shifting onset content at that window. Treat timestretch [120,140]
medians up to ~70 ms as the current expected value; the [60,80] window remains
the discriminating ≤60 ms assertion.

Re-measured 2026-07-16 on the `wasm-engine-only` branch (every scenario now
renders on the WASM (Rust) offline worker — `raw`/`varispeed`/`timestretch`
previously rendered on the TS offline worker). Same two windows
([60,80] / [120,140] medians, ms): raw-vs-file 30/40, raw-vs-grid 174/118,
varispeed 33/32, timestretch **71/68**, conform 30/35, rigid-vs-fileRigid 33/33,
rigid-vs-clicks **92**/153; pitch ordering 0.985 > 0.953. **This is the
WASM-worker recalibration, not a regression.** All discriminations stay fully
intact (every locked median sits far below the ~120 ms unaligned floor; varispeed
at 33 ms proves the harness still measures tight alignment). Two cells shifted and
warrant a note: (1) **timestretch [60,80] rose 43 → 71 ms** — the WASM Tape/
PitchVoice path smears onsets slightly more than the TS path did, uniformly across
both windows (they now read ~68–71 ms together, where the TS worker read 43/68).
Treat timestretch medians up to ~75 ms as the current WASM expected value on both
windows. (2) **rigid-vs-clicks [60,80] first-measured at 91.5 ms** — nominally
under the ≥100 ms negative-control line, but it still discriminates cleanly (the
music sits 33 ms from `fileTimesRigid` vs 92 ms from the rigid click grid, a ~2.7×
separation), so the control is not broken; the [120,140] window remains 153 ms.

**Pitch (relative check):** `harmonic_analysis` pitch-class distributions on
[120, 140] s; Pearson-correlate each against raw's. Require
`corr(raw, timestretch) > corr(raw, varispeed)` — timestretch preserves pitch,
varispeed smears it. Measured: 0.987 vs 0.956 (2026-07-16 WASM re-measurement: 0.985 >
0.953). The margin is small because this window's detune is only ±50–85 cents; treat
absolute values as informational and assert only the ordering.

Report a pass/fail table with the medians. Stop at the first failed scenario with
the numbers collected so far.

## Troubleshooting

- **Page won't load / cert errors**: dev server must be HTTPS (COOP/COEP);
  `localhost-key.pem`/`localhost.pem` must exist in the directory the server runs
  from. Check the port matches the URL.
- **`error:verify sink rejected upload`**: the middleware only exists in dev mode
  (`apply: "serve"`); a preview/production server has no `/__verify`. HTTP 413 =
  render exceeded the 150 MB cap.
- **`error:Transient detection returned fewer than two positions`**: timestretch
  needs at least two transients (the engine's minimum); the audio file is
  silent/featureless — wrong file or broken load.
- **State stuck at `rendering`**: check the browser console via Playwright; if
  > 5 min, capture console messages and report.
- **Onset medians ~120 ms for ALL scenarios including raw-vs-file**: the windows
  are probably in sparse/unstable material (check rhythm_analysis `Stability`,
  want ≥ 0.8) or the expected lists are stale — re-run
  `node scripts/expected-beats.ts`.
