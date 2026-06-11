---
name: audio-verify
description: Verify warp/audio-engine behavior by offline-rendering the warp demo scenarios to WAVs and asserting beat alignment numerically with the audio-analyzer MCP. Use after changes to src/lib/beats/, src/demos/warp/, stretch-engine or tempo-track behavior, or when asked to verify audio output without listening.
---

# audio-verify

Renders the five warp scenarios full-song through the OpenDAW offline engine and
asserts beat alignment against expected times computed from the beat map. Replaces
"needs human ears" with numbers. Requires: the dev server (HTTPS certs present),
Playwright MCP, audio-analyzer MCP.

## Workflow

1. **Start the dev server** from the branch/worktree under test:
   `npm run dev -- --port 5181 --host 127.0.0.1`
2. **Render each scenario** (sequentially — each is a full-song offline render,
   allow up to ~3 minutes (measured: the raw scenario rendered in ~15 s on an M-series Mac — budget minutes only for slower machines)): navigate Playwright to
   `https://localhost:5181/audio-verify-debug.html?scenario=<s>` for
   `raw`, `varispeed`, `timestretch`, `grid-conform`, `grid-rigid`.
   Poll the `#verify-state` element's `data-verify-state` attribute every ~15 s:
   `setup → rendering → uploading → done`. On `error:<msg>`: stop, report the
   message. WAVs land at `.verify-output/verify-<scenario>.wav`.
3. **Expected times**: `node scripts/expected-beats.ts` → JSON with `projectBpm`,
   `gridTimes`, `fileTimes`, `fileTimesRigid`, `rigidClickTimes` (render-relative
   seconds).
4. **Analyze** each WAV with audio-analyzer `rhythm_analysis`: one full-track
   summary call (no resolution), then three high-resolution windows at
   [10, 30] s, [120, 140] s, [220, 240] s. Collect detected beat lists per window.
5. **Compare** per window: for each detected beat, distance to the nearest
   expected time; take the median per window.

## Assertions

| Scenario | Expected list | Pass criteria |
| --- | --- | --- |
| raw (negative control) | gridTimes | median < 100 ms in intro window AND > 300 ms in outro window — drift must GROW. If raw doesn't drift, the harness is broken: STOP. |
| varispeed | gridTimes | median ≤ 35 ms per window, no window > 60 ms |
| timestretch | gridTimes | median ≤ 35 ms per window, no window > 60 ms |
| grid-conform | fileTimes | median ≤ 35 ms per window (music + clicks coincide) |
| grid-rigid (negative control) | fileTimesRigid ∪ rigidClickTimes | the two lists themselves diverge > 300 ms by the outro; detected onsets match the UNION better than either list alone |

Pitch (informational until baseline numbers exist — then promote to hard
assertions and update this table): `harmonic_analysis` pitch-class distribution on
the [120, 140] s window — `timestretch` must correlate with `raw`; `varispeed`
must deviate.

Report a pass/fail table with the medians. Stop at the first failed scenario with
the numbers collected so far.

## Troubleshooting

- **Page won't load / cert errors**: dev server must be HTTPS (COOP/COEP);
  `localhost-key.pem`/`localhost.pem` must exist in the directory the server runs
  from. Check the port matches the URL.
- **`error:verify sink rejected upload`**: the middleware only exists in dev mode
  (`apply: "serve"`); a preview/production server has no `/__verify`. HTTP 413 =
  render exceeded the 150 MB cap.
- **`error:Transient detection returned no positions`**: timestretch needs
  transients; the audio file is silent/featureless — wrong file or broken load.
- **State stuck at `rendering`**: check the browser console via Playwright;
  offline render of the full song takes ~1–3 min (it is faster than realtime but
  not instant). If > 5 min, capture console messages and report.
- **Onset medians look huge for ALL scenarios including controls inverted**:
  check render-relative alignment — renders start at tick 0; expected lists are
  render-relative by construction. Re-run `node scripts/expected-beats.ts`.
