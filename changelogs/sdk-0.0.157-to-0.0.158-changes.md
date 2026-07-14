# OpenDAW SDK Changelog: 0.0.157 → 0.0.158

A single point release, but a substantive one: a **recording reliability fix** (ring-buffer
reader moved to a blocking worker — hidden-tab recording no longer drops audio), a
**zero-duration-sample eradication campaign** (import guards + storage purge + two new
project-load migrations), **box-schema constraint alignment** for five effect parameters,
**click-free lookahead toggles** on Compressor and Maximizer, and lib-box fixes to undo
grouping and `PointerHub` removal balance.

**No breaking changes for opendaw-headless.** No exports were removed or renamed in any
package we import from. One code touch was made proactively (Maximizer UI slider range,
see below); everything else is docs.

## Out-of-cycle release note

> As always, the `studio-sdk` CHANGELOG carries only "version bump only" notes; the real
> changes live in the sub-packages. Every sub-package bumped exactly one patch this cycle.

## Behavior changes & fixes visible to consumers

### Recording: RingBuffer reader now drains on a dedicated worker (upstream #290)

The headline fix. `RingBuffer.reader` (`@opendaw/studio-adapters`) no longer runs on the
calling thread with a `canBlock` self-detect (`Atomics.wait` in workers, `setTimeout(step, 1)`
polling on the main thread). It now **spawns a dedicated worker from a blob URL** that blocks
on `Atomics.wait`, drains all available chunks per wake-up, and transfers them back via
`postMessage`. The `append` callback still runs on the main thread; `Reader.stop()` now
terminates the worker and revokes the blob URL.

**Why:** Chrome throttles main-thread timers in hidden tabs to ~1s. The old ring held only
~0.34s of audio at 48kHz (128 chunks), so recording in a backgrounded tab overran the ring
and **silently dropped audio**. Alongside the worker move, `CaptureAudio.prepareRecording`
now allocates the recording worklet with **1024 ring chunks (~2.7s at 48kHz)** instead of
`RenderQuantum` (128).

**opendaw-headless impact:** none code-wise — `prepareRecording` injects everything
automatically. Recording demos gain background-tab robustness for free. The blob-URL worker
works under our COOP/COEP dev server (`blob:` inherits the creator's origin;
`require-corp` doesn't block it). Signature of `RingBuffer.reader(config, append)` is
unchanged.

### Zero-duration samples eradicated (import guard + purge + migrations)

A historical bug let zero-length audio become duration-0 samples → duration-0 regions →
`validateTrack` panics. 0.0.158 attacks it at every layer:

- `SampleService.importRecording` / `importFile` now **`panic` on 0-frame audio**
  ("Cannot import recording '…': the take is empty (0 frames)" /
  "Cannot import '…': the audio is empty (0 frames)").
- `SampleService.collectAllFiles` **purges already-stored samples with `!(duration > 0)`**
  (also catches NaN) from `SampleStorage` on every list — self-healing, logs
  `Purging N zero-duration sample(s)`.
- `ProjectMigration` gains two new passes that run on **every project load**:
  1. `migrateZeroDurationRegions` — drops regions with non-positive derived duration.
  2. `migrateAudioRegionOverlaps` — heals sub-PPQN overlaps between seconds-based audio
     regions left by Int32 position truncation.

> **Tag vs. tarball:** the upstream release tag also contains a third pass,
> `migrateCaptureTrackMismatch` (drops content tracks whose type no longer matches their
> unit's capture device — fixes the "No CaptureMidi available" crash), but the **published
> `studio-core@0.0.156` tarball was built without it** (verified: not in
> `dist/project/migration/`, not run by `dist/project/ProjectMigration.js`). Expect it in
> the next release.

**opendaw-headless impact:** none expected — our recording path can't produce 0-frame takes
(0.0.157 already dropped non-positive-duration takes in `finalizeTake`). Note for tests and
future code: importing an empty `AudioData` now **throws** (via `panic`) instead of silently
creating a broken sample. The overlap-heal migration is consistent with the
"overlaps disallowed by design" stance (see memory note from 2026-05-21).

### `AudioRegionBox.duration` schema constraint: `"any"` → `"positive"`

Schema-level statement of the same invariant. **Not enforced at runtime** (constraints
don't clamp — see CLAUDE.md "Box Numeric Constraints Do Not Clamp"), but headless writers
should treat non-positive durations as illegal (they always were; now migrations delete them).

### Box schema constraints aligned with adapter value mappings (upstream #303, #304)

The schema is what project files and headless consumers introspect; the adapter's
`ValueMapping` is what the UI actually clamps to. Five parameters disagreed and were fixed
**by taking the adapter's range into the schema** (no runtime behavior change, no default
moved):

| Box | Field | Old schema | New schema (== adapter) |
|---|---|---|---|
| `MaximizerDeviceBox` | `threshold` | −30..0 dB | **−24..0 dB** |
| `GateDeviceBox` | `threshold` | −60..0 dB | **−80..0 dB** |
| `GateDeviceBox` | `attack` | 0..50 ms | **0..1000 ms** |
| `TidalDeviceBox` | `rate` | `"unipolar"` | **0..16 linear** (a `RateFractions` index) |
| `CrusherDeviceBox` | `mix` | `"unipolar"` | **0.001..1 exponential** |
| `VocoderDeviceBox` | `band-count` | 8..16 range | **discrete {8, 12, 16}** (what both DSPs accept) |

**opendaw-headless impact — one code touch.** Our Maximizer control in
`src/hooks/useDynamicEffect.ts` offered a −30..0 dB slider; values below −24 were outside
the adapter/DSP range. Slider min updated to **−24** (all `MAXIMIZER_PRESETS` were already
≥ −12, unaffected). Our Tidal rate control already used 0..16 integer steps; Crusher mix
slider min 0 vs schema 0.001 is cosmetically stale but harmless (we set raw box values).
`documentation/11-effects.md` parameter tables updated for all five.

### Compressor & Maximizer: lookahead toggle no longer clicks (upstream #79)

Both processors (TS engine, `@opendaw/studio-core-processors`) now run the immediate and
delayed paths in parallel and **crossfade over 15 ms** (`Ramp.linear`) when `lookahead`
toggles, instead of hard-switching the output latency (which clicked). DSP-internal; no API
change. Steady-state output is identical.

### Undo grouping: marked `modify()` folds leftover unmarked pending (upstream #208, #306)

`BoxEditing.modify(modifier, mark = true)` no longer pre-seals pending unmarked
modifications as their own history entry — it **folds them into the new marked entry**.
Fixes duplicate/phantom undo steps when placing notes/regions/automation nodes (UI-state
writes like selection used to become their own undo step). Consumers that relied on
`modify(fn, false)` + later `modify(fn)` producing **two** undo entries would now get one;
opendaw-headless never calls `modify` with `mark = false`, so no impact.

### `PointerHub.catchupAndSubscribe`: balanced onRemoved (upstream #1034)

`onRemoved` is now forwarded **only for pointers that were announced via `onAdded`**. A
subscription created mid-transaction could previously receive an `onRemoved` for a pointer
its catch-up snapshot never saw, unbalancing listeners (and panicking downstream
`SortedSet.removeByKey`). Strictly a robustness fix — our subscription patterns
(CLAUDE.md pointerHub chain) are unaffected but now safer if a subscribe races a transaction.

### Engine: pointer edges maintained incrementally; checksum off the audio path

`lib-box` sync no longer takes a full-graph checksum + hub sweep per transaction on the
audio thread, and the box graph maintains pointer edges incrementally (fixes audio dropouts
when making large selections in the UI). Performance-only; no API change.

### `studio-enums` palette brightened

`Colors.black/background/panelBackground/panelBackgroundBright/panelBackgroundDark` all
gained a few points of lightness (e.g. `background` L 7 → 9). Only matters if you pull
`Colors` directly; opendaw-headless uses Radix Themes + `CANVAS_COLORS`.

## Additive APIs

- **`Color.lerp(other, t)`** (`@opendaw/lib-std`) — hue-aware color interpolation
  (lerps in the S/H polar plane, shortest path).
- **`fastLog2(x)`** (`@opendaw/lib-dsp` `fast-math`) — IEEE-754 exponent extraction +
  atanh-series mantissa, max error ~1e-8. `fastExp2` internals rewritten allocation-free
  (bit-twiddled scale instead of a multiply loop); same results bit-for-bit.
- **`ProjectMigration`** now exports `migrateAudioRegionOverlaps` and
  `migrateZeroDurationRegions` from `migration/index`.
- **YSync `Reconcile`** — prototype deterministic reconciliation for collab constraint
  conflicts + a large multi-peer convergence test suite. Not in our surface.

## Other touches (not in opendaw-headless's SDK surface)

- WASM engine: strip mute/solo automation fixes (#305), master-output live-effect
  reconciliation, self-contained sync tasks (#287), engine switcher moved to Preferences.
- app-studio only: cursor-aware automation node placement (#275), node-placement snapping
  (#274), automation curve/deletion/selection fixes (#291, #292, #289, #297), vocoder band-Q
  gradient direction (#302), "Add Midi-Effect" hidden for non-MIDI instruments, menu/UI work,
  GitHub issue templates.
- `DevicesClipboardHandler` paste fixes (#1049–#1051) — clipboard is app-studio UI.

## Library bumps

Every sub-package moved exactly one patch:

| Package | 0.0.157 | 0.0.158 | Notes |
|---|---|---|---|
| `@opendaw/lib-std` | 0.0.80 | 0.0.81 | `Color.lerp` |
| `@opendaw/lib-box` | 0.0.88 | 0.0.89 | undo folding, PointerHub balance, incremental pointer edges |
| `@opendaw/lib-dsp` | 0.0.86 | 0.0.87 | `fastLog2`, `fastExp2` rewrite, ctagdrc conversation tweaks |
| `@opendaw/lib-dom` | 0.0.85 | 0.0.86 | minor |
| `@opendaw/lib-fusion` | 0.0.96 | 0.0.97 | minor |
| `@opendaw/lib-runtime` | 0.0.81 | 0.0.82 | messenger 1-line |
| `@opendaw/lib-jsx` / `lib-midi` / `lib-xml` / `lib-dawproject` | — | +1 patch | version bumps only |
| `@opendaw/studio-enums` | 0.0.79 | 0.0.80 | palette brightness |
| `@opendaw/studio-boxes` | 0.0.96 | 0.0.97 | schema constraint alignment, `duration` positive |
| `@opendaw/studio-adapters` | 0.0.119 | 0.0.120 | RingBuffer worker reader, Vocoder adapter tweak |
| `@opendaw/studio-core` | 0.0.155 | 0.0.156 | recording ring size, SampleService guards, 2 new migrations, RegionClipResolver rework |
| `@opendaw/studio-core-wasm` | 0.0.2 | 0.0.3 | engine fixes (#287, #305), offline worker |

## opendaw-headless changes made alongside this upgrade

- `src/hooks/useDynamicEffect.ts` — Maximizer threshold slider min −30 → −24 (schema/adapter range).
- `src/lib/effectPresets.ts` — `MaximizerParams` range comment updated.
- `documentation/11-effects.md` — Gate/Maximizer/Tidal/Crusher parameter tables updated to
  the aligned schema ranges; lookahead crossfade notes added to Compressor and Maximizer.
- `documentation/internals/03-cross-thread-protocols.md` — RingBuffer reader section
  rewritten for the worker-based reader (old `canBlock`/`setTimeout` description was stale);
  critical-invariant #6 updated.

## Upgrade test plan

- [x] `rm -rf node_modules package-lock.json && npm install` regenerates the lockfile cleanly.
- [x] `npm ci` passes from the regenerated lockfile (only the audit advisory, no sync error).
- [x] `npm run build` (Vite + VitePress) succeeds.
- [x] `npx tsc --noEmit --ignoreDeprecations "6.0"` shows **zero new errors** vs the parent
      commit (same 14 pre-existing `src/` errors as the 0.0.157 baseline).
- [ ] Smoke-test a recording demo in the browser — recording now drains via a blob-URL
      worker; verify takes finalize normally under our COOP/COEP headers.
- [ ] Re-check the two open SDK issues (touching-seam discontinuity, voice fade-in product)
      at 0.0.158 — last verified at 0.0.147.
