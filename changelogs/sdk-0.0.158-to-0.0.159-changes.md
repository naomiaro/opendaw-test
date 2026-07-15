# OpenDAW SDK Changelog: 0.0.158 → 0.0.159

The release that closes **both upstream issues this repo filed** — openDAW#311
(touching-seam sample discontinuity) and openDAW#312 (voice-fade × clip-fade product) —
plus a **new fourth audio play mode** backed by the Signalsmith phase vocoder
(`AudioSignalsmithBox`), editable/selectable transient markers, and a `Range.set`
zero-width-invariant fix in lib-std.

Versioning note: `studio-adapters` (0.0.120 → **0.1.0**) and `studio-core`
(0.0.156 → **0.1.0**) took their first minor bumps; `studio-core-processors` is 0.0.127,
`studio-boxes` 0.0.98, `studio-enums` 0.0.81.

**No breaking changes for opendaw-headless.** All API changes are additive.

## Tape engine fixes (openDAW#311 / #312) — core-processors 0.0.127

Both issues were closed by Andre with "Fixed in SDK 0.0.159. Make sure to run the wasm
audio engine." All three TS-path fixes (two commits) are present in the published tarball
(verified in `@opendaw/studio-core@0.1.0/dist/processors.js`):

- **#311a** (`dbc7f9c`): `TapeDeviceProcessor` floors the block-partition **endpoints**
  (`(bp1|0) − (bp0|0)`) instead of the span, so touching regions tile with no dropped
  sample — matches the Rust engine's `sample_of(end) − sample_of(start)`.
- **#311b** (`4f641cc`): a region that ends inside a block now fades its own tail to
  silence **at the region end** and is removed before the next block — previously the
  voice leaked into the next block and was faded there at unit gain reading past the
  region end, producing the ~20 ms destructive crossfade with a touching successor.
- **#312** (`dbc7f9c`): `PitchVoice.process` combines the internal 20 ms declick fade with
  the region clip-fade by **`Math.min` instead of product** — the quadratic crossfade
  entry (−1.2 dB dip) is gone. Mirrors Rust `audio_region_player.rs::fade_gain`.

**Measured status at 0.0.159** (this repo's repro pages, see `debug/`):

| Signature | TS engine | WASM engine | 0.0.158 |
|---|---|---|---|
| #311 seam-Δ/pre-Δ (4-cell matrix) | 1.87 — still ~2× | **1.00 — fixed** | 2.00 |
| #312 OPENDAW crossfade dip | **−0.05 dB — fixed** | **−0.05 dB — fixed** | −1.21 dB |

So #312 is fixed on both engines despite the wasm-scoped issue comment; #311 is fully
fixed only on the WASM engine. Both repro pages now accept `?engine=wasm`.

## New play mode: `AudioSignalsmithBox` (Signalsmith phase vocoder)

A fourth `AudioPlayMode` alongside NoStretch / PitchStretch / TimeStretch:

- Schema (`forge-boxes`): `warp-markers` collection + `transpose` float32
  (−24..+24 st, unit "st"), accepts `Pointers.AudioPlayMode`. **No transient markers /
  transient play-modes** — the spectral stretch doesn't need them.
- Adapter (`studio-adapters`): `AudioSignalsmithBoxAdapter` with `warpMarkers`,
  `transpose` (semitones), `cents` (derived), `clone()`. Registered in `BoxAdapters`.
- `AudioPlayMode` union + `isAudioPlayMode` extended; `AudioContentBoxAdapter` (and both
  `AudioRegionBoxAdapter` / `AudioClipBoxAdapter`) gain **`asPlayModeSignalsmith`**.
- `AudioContentModifier` gains **`toSignalsmith(adapters)`**; all three mode-swap helpers
  (`toPitchStretch` / `toTimeStretch` / `toSignalsmith`) now share a private
  `adoptWarpMarkers` helper (re-own markers when the old box is exclusively held, clone
  when shared, seed defaults from NoStretch). Behavior of the existing two is unchanged.
- `AudioContentHelpers.addDefaultWarpMarkers` accepts the new box type.
- `IconSymbol.Signalsmith` added (`studio-enums`).

Our docs updated: `documentation/18-time-and-pitch.md` (four-mode table, accessor
examples), `src/demos/playback/CLAUDE.md` (play-mode API notes).

## Editable transient markers (upstream #114)

`TransientMarkerBoxAdapter` (studio-adapters) is now `Selectable`: gains
`onSelected()` / `onDeselected()` / `isSelected`, and subscribes to its box
(`Propagation.Children`) so position edits notify subscribers. Supports the studio's
new transient-marker editing UI; additive for consumers.

## lib-std: `Range.set` upholds the minimum-width invariant

`Range.set(min, max)` (the low-level mutator every range operation funnels through:
`scaleBy`, `center`, `moveTo`, `showUnitInterval`, …) now rejects non-finite input and
clamps to the range's `minimum` width. Previously a zero-width or inverted range could be
established and `scaleBy`'s `(minimum − range) / range` divided by zero, producing a
non-finite range. Relevant to anyone driving SDK `Range` objects from UI code.

## Misc

- `PresetDecoder.insertEffectChain` guards against truncated input (`byteLength < 8` →
  `Attempts.err("Invalid preset header")` instead of a throw).
- `ysync/Reconcile` gains logic for reconciling collaborative edits (p2p path — not used
  by this repo).
- Upstream repo additions not in the npm SDK: a new `packages/app/transient` playground,
  Signalsmith UI in the studio's audio editors, wasm-app test loops.

## opendaw-headless follow-ups shipped with this upgrade

- `?engine=wasm` opt-in on both repro pages (`installWasmEngine` + `setWasmEnabled` +
  `ensureWasmReady` via `onBeforeEngineStart`), plus an engine badge.
- `renderOfflineSlice` routes through `OfflineEngineRenderer` (`variant: true`) when the
  WASM engine is active — `OfflineAudioContext` + `createEngine` hangs with the WASM
  `EngineVariant` (see `src/demos/engine/CLAUDE.md`).
- `debug/shared-source-double-process.md`, `debug/voice-fadein-clip-fadein-product.md`,
  and `debug/README.md` updated with fixed-status sections and 0.0.159 measurements.
