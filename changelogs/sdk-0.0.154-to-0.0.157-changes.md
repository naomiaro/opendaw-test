# OpenDAW SDK Changelog: 0.0.154 → 0.0.157

Three point releases (0.0.155, 0.0.156, 0.0.157). This is a **large** cycle dominated by
production-hardening the alternative **WASM engine** (a switchable `EngineVariant`), plus
freeze/stems/monitoring export work, a generic **composite instrument**, audio + value **clips**
on the engine, `MIDIOutput`, and a Nextcloud/shared-folder cloud path. Almost all of it is
additive or app-only.

**One breaking change affects opendaw-headless:** the internal `Open*API` helpers
(`OpenSampleAPI`, `OpenSoundfontAPI`, `OpenPresetAPI`) and `OpenDAWHeaders` were **removed
from `@opendaw/studio-core`** and relocated into the app-studio package. We imported
`OpenSoundfontAPI` in `src/lib/projectSetup.ts`; that one call site changed.

## Out-of-cycle release note

> As in prior cycles, these tags were published from upstream **`dev`**. The `studio-sdk`
> CHANGELOG only carries "version bump only" notes; the real changes live in `studio-core`,
> `studio-adapters`, `studio-boxes`/`forge-boxes`, `studio-enums`, and this time also several
> `@opendaw/lib-*` packages (box, std, dsp, dom, fusion) which all bumped for the
> transaction-integrity / WASM-engine work.

## Breaking Changes

### `Open{Sample,Soundfont,Preset}API` and `OpenDAWHeaders` removed from `@opendaw/studio-core`

These were `@internal` classes that fetched openDAW's own asset endpoints
(`api.opendaw.studio` / `assets.opendaw.studio`). They have been **deleted from
`@opendaw/studio-core`** and now live only in the app-studio package
(`packages/app/studio/src/opendaw-api/`), which is not published as SDK surface.

| Deleted from core | Old location | Replacement in core |
|---|---|---|
| `OpenSampleAPI` | `samples/OpenSampleAPI.ts` | none — implement `SampleProvider` yourself |
| `OpenSoundfontAPI` | `soundfont/OpenSoundfontAPI.ts` | none — implement `SoundfontProvider` yourself |
| `OpenPresetAPI` | `presets/OpenPresetAPI.ts` | `PresetBundle` (see below) for the local encode/decode half |
| `OpenDAWHeaders` | `OpenDAWHeaders.ts` | none (was just a request-header constant) |

`samples/index.ts`, `soundfont/index.ts` and `presets/index.ts` no longer re-export them;
`presets/index.ts` now exports `PresetBundle` in place of `OpenPresetAPI`.

**opendaw-headless impact — one change applied.** `src/lib/projectSetup.ts` built its
`SoundfontProvider` from `OpenSoundfontAPI.get().load(uuid, progress)`. Since this project
deliberately avoids `api.opendaw.studio` (CORS in dev) and no demo uses soundfont instruments,
the provider was never actually exercised. The import was dropped and the provider now rejects
with a clear message, mirroring how `sampleProvider` handles the no-local-buffer case:

```typescript
// before (0.0.154)
import { /* … */ OpenSoundfontAPI, /* … */ } from "@opendaw/studio-core";
const soundfontProvider: SoundfontProvider = {
  fetch: async (uuid, progress) => OpenSoundfontAPI.get().load(uuid, progress)
};

// after (0.0.157) — OpenSoundfontAPI import removed
const soundfontProvider: SoundfontProvider = {
  fetch: async (uuid, _progress) => {
    throw new Error(`Soundfont not available locally: ${UUID.toString(uuid)}. `
      + `Soundfont loading is disabled in opendaw-headless.`);
  }
};
```

Our custom `sampleProvider` never used `OpenSampleAPI`, and we never used `OpenPresetAPI` or
`OpenDAWHeaders`, so those removals need no code changes here.

## Additive APIs

### `EngineVariant` — switchable engine backend (opt-in, new export from `@opendaw/studio-core`)

The headline of the cycle. `EngineWorklet` can now boot an **alternative
`AudioWorkletProcessor`** (the WASM engine) instead of the built-in TS `"engine-processor"`,
as long as it speaks the same message contract. Selection is global and resolved per engine
construction:

```typescript
export type EngineWorkletVariant = {
    readonly processorName: string                                   // processor to instantiate
    readonly attachment: Record<string, unknown>                     // structured-clone extras
    readonly connectSync: (messenger, project) => Terminable         // variant's box-graph sync
    readonly connectFrozenAudio?: (messenger) => FrozenAudioWriter   // optional freeze-PCM path
}

export class EngineVariant {
    static install(provider: Provider<Nullable<EngineWorkletVariant>>): void
    static current(): Nullable<EngineWorkletVariant>   // null → built-in TS engine
}
```

`EngineWorklet` reads `EngineVariant.current()` in its constructor: null keeps the existing
`"engine-processor"` + `SyncSource` behaviour byte-for-byte; a non-null variant swaps the
processor name, hands `variant.attachment` to `processorOptions.variant`, replaces the sync
source with `variant.connectSync(...)`, and (if provided) routes `setFrozenAudio` through
`variant.connectFrozenAudio` so the WASM engine can write freeze PCM into shared memory from
the main thread instead of the audio thread.

**opendaw-headless impact:** none. We never call `EngineVariant.install(...)`, so
`current()` returns null and every demo uses the built-in TS engine exactly as before.

### `OfflineEngineRenderer` — variant + stems support

`OfflineEngineRenderer` gains static helpers to mirror the engine toggle into background
renders, plus multi-stem output:

```typescript
static installVariant(url: string, attachment: Record<string, unknown>): void
static hasVariant(): boolean
static installVariantPolicy(policy: () => boolean): void   // default for freeze/consolidation renders
static getWorkerUrl(): string
```

`start(...)` and `create(...)` gain a trailing **optional** `variant?: boolean` parameter
(defaulting through `variantPolicy()`), and the render protocol now returns
`Float32Array[]` **per stem**. Existing 5-arg calls are unchanged:

```typescript
// still valid — variant defaults to the installed policy (false when none installed)
OfflineEngineRenderer.start(source, optConfig, progress, abortSignal?, sampleRate?)
```

**opendaw-headless impact:** none required. `src/lib/projectSetup.ts` only calls
`OfflineEngineRenderer.install(OfflineEngineUrl)`, and the export demo's call sites keep the
old positional signature (the new param is optional and last).

### `Project.copyWithNewIdentities(env?)` — deep clone with fresh UUIDs

```typescript
copyWithNewIdentities(env?: Partial<ProjectEnv>): Project
```

Serializes the whole box graph via the new `BoxGraphCopy` helper, deserializes into a fresh
`BoxGraph` with regenerated identities, and returns a new `Project`. Useful for
"duplicate project / save-as" flows without UUID collisions. Additive.

### `BufferUnderrunDetector` and `FactoryCatalog` — new core exports

Both newly re-exported from `@opendaw/studio-core/index.ts`. `BufferUnderrunDetector` reads
the browser's `AudioPlaybackStats` to surface glitch counts (telemetry); `FactoryCatalog`
is a lookup table over the device/instrument factories. Additive; opendaw-headless doesn't
consume either yet.

### `PresetBundle` — replaces `OpenPresetAPI` in `presets/index`

The local encode/decode half of the old `OpenPresetAPI` (the network half stayed in
app-studio). Exports preset bundling helpers used by the new template/cloud storage. Additive.

### Composite instrument boxes: `CompositeDeviceBox` + `CompositeCellBox` (new)

A generic **composite instrument** for the WASM engine: `CompositeDeviceBox` hosts a
collection of `CompositeCellBox` cells (field `cells`, accepts `Pointers.CompositeCell`),
and each cell wraps **one instrument plus its own MIDI/audio-effect chains** — instruments
and effects attach by their normal `host` pointers, so no plugin changes are needed to live
inside a composite. Unlike Playfield (per-slot note routing), every cell receives the full
note stream. New pointer type `Pointers.CompositeCell` was added to `studio-enums`.

**opendaw-headless impact:** none. No demo constructs composite devices.

### Cloud / templates (app-oriented, additive)

New in `@opendaw/studio-core`: `NextcloudHandler`, `SharedFolderSync`, `CloudBackupTemplates`,
`TemplateStorage`, `TemplatePaths`. These back a Nextcloud + shared-folder sync path and a
project-template store. app-only; opendaw-headless doesn't wire the cloud handlers.

### `RuntimeNotifier.notify(NotifyRequest)` — non-blocking toast (`@opendaw/lib-std`)

A fire-and-forget sibling to the existing blocking `RuntimeNotifier.info(...)` (which returns
a `Promise<void>`). `Project.handleCpuOverload()` switched from `info` to `notify` so a CPU
overload no longer awaits a modal.

### `AudioClipBoxAdapter.optFile` — Option-returning file getter (new)

```typescript
get file(): AudioFileBoxAdapter          // throws if empty (existing)
get optFile(): Option<AudioFileBoxAdapter> // new — safe read
```

Mirrors the established `Option<T>` pattern; prefer `optFile` over guarding `file`.

### `Option.unwrap(message?)` — optional debug label

`Option.unwrap()` now accepts an optional message string that surfaces in the thrown error.
Adapters across `studio-adapters` were updated to pass labels (e.g.
`targetVertex.unwrap("file.target")`). **No call-site break** — our existing no-arg
`.unwrap()` calls remain valid.

## Behavior changes & fixes visible to consumers

### `StereoToolDeviceBox` default panning law: `EqualPower` → `Linear`

The `panning-mixing` field's default value changed from `Mixing.EqualPower` to `Mixing.Linear`
(the enum still accepts both). This affects **newly created** StereoTool boxes only.

**opendaw-headless note:** the `StereoWidth` effect in `src/hooks/useDynamicEffect.ts`
(`EffectFactories.AudioNamed.StereoTool`) sets `stereo` and `panning` but not
`panning-mixing`, so new instances now default to the Linear panning law. Audible difference
only appears when the user drags the Pan control **off-center** (Linear = straight amplitude
taper, EqualPower = constant-perceived-loudness); at center (the demo default `pan = 0`) the
two are identical. Left as-is to track upstream's intended default; set
`b["panning-mixing"].setValue(Mixing.EqualPower)` in `initDefaults` if the old law is wanted.

### Muted value clips no longer contribute automation

`TrackBoxAdapter`'s value read at a section boundary now checks `!clip.mute` before returning
`clip.valueAt(...)`. A muted value clip previously still drove its automation target at the
clip's start position; it now correctly contributes nothing.

### Transaction / undo integrity hardening (#1014, #1019, #1020, #1023)

Fixes in `@opendaw/lib-box` and `@opendaw/lib-std` (the box `0.0.86 → 0.0.88` and std
`0.0.78 → 0.0.80` bumps):

- **box:** rollback now replays optimized updates (a phantom create+delete collapses),
  skips (and warns on) updates whose vertex diverged, `stageBox` cleans up failed
  constructions, and `abortTransaction` resolves recreation-deferred pointers.
  `optimizeUpdates` moved to `updates.ts` (re-exported). Net effect: aborting/rolling back a
  transaction leaves the graph in a consistent state more reliably — relevant to any
  `editing.modify()` that throws.
- **std:** `Range.innerWidth` clamps to `>= 1` so a collapsed layout can't poison min/max
  with `NaN` via an `xToValue` divide-by-zero.

### Touch "ghost re-trigger" fix (#1020)

Surface pointer tracking now also clears on `pointercancel`, so the synthetic-`pointerup`
workaround no longer re-fires against a stale target. app-surface fix; benefits touch UIs.

### Other upstream fixes bundled

- **#264** — `@opendaw/lib-std` strips a unit suffix before parsing so a digit-leading unit
  isn't merged into the numeric value; `@opendaw/studio-adapters` no longer blocks project
  load on an invalid script identifier.
- **#265** — Playfield sample-slot effects are now kept in instrument presets
  (`PresetEncoder`/`PresetDecoder`).

## Tweaks visible to consumers

### `studio-enums` — palette nudge + new `IconSymbol`s + new `Pointers` value

- `Colors.gray` `(197,31,90) → (197,31,88)` and `panelBackgroundBright`
  `(197,11,16) → (197,13,15)`. opendaw-headless uses Radix Themes for its palette, so this
  only matters if you pull `Colors` directly.
- `IconSymbol` gains `Nextcloud`, `Notification`, `Share`, `Warning`. The enum is
  auto-numbered — don't persist icon indices numerically.
- `Pointers.CompositeCell` added (see composite boxes above). Same auto-numbering caveat as
  every prior pointer addition; accept-rules use the identifier and are unaffected.

## Library Bumps

Unlike the previous two cycles, the `@opendaw/lib-*` packages **did** move this time:

| Package | 0.0.154 | 0.0.157 | Notes |
|---|---|---|---|
| `@opendaw/lib-std` | `^0.0.78` | `^0.0.80` | `RuntimeNotifier.notify`, `Option.unwrap(message?)`, `Range` NaN clamp (#1019) |
| `@opendaw/lib-box` | `^0.0.86` | `^0.0.88` | transaction-abort/rollback integrity (#1014/#1023), `optimizeUpdates` re-export |
| `@opendaw/lib-dsp` | `^0.0.84` | `^0.0.86` | WASM-engine / tempo-edge DSP support |
| `@opendaw/lib-dom` | `^0.0.83` | `^0.0.85` | — |
| `@opendaw/lib-jsx` | `^0.0.83` | `^0.0.85` | — |
| `@opendaw/lib-fusion` | `^0.0.94` | `^0.0.96` | — |
| `@opendaw/lib-runtime` | `^0.0.79` | `^0.0.81` | — |
| `@opendaw/lib-midi` | `^0.0.66` | `^0.0.68` | MIDIOutput groundwork |
| `@opendaw/lib-xml` | `^0.0.64` | `^0.0.66` | — |
| `@opendaw/lib-dawproject` | `^0.0.70` | `^0.0.72` | — |
| `@opendaw/studio-enums` | `^0.0.77` | `^0.0.79` | palette, IconSymbols, `Pointers.CompositeCell` |
| `@opendaw/studio-boxes` | `^0.0.94` | `^0.0.96` | Composite boxes, StereoTool default |
| `@opendaw/studio-adapters` | `^0.0.116` | `^0.0.119` | `optFile`, muted-value-clip fix, `unwrap` labels, preset fixes |
| `@opendaw/studio-core` | `^0.0.152` | `^0.0.155` | `EngineVariant`, WASM hardening, `Open*API` removal, freeze/stems, cloud/templates |
| `@opendaw/studio-core-wasm` | — | `^0.0.2` | **new dependency** — WASM engine artifacts |

## Other touches in the diff (not in opendaw-headless's SDK surface)

- WASM engine production hardening, SIMD, `OfflineEngineRenderer` telemetry, device
  enable/disable (bypass), track enable/disable, monophonic-strategy and solo/value-channel
  fixes, output-peaks fix — engine-internal; observed only through the switchable engine.
- Vocoder, soundfont, scriptable-devices, and "PerformancePage" work landed in
  `@opendaw/app-studio`, not the SDK packages we consume.
- `Nextcloud`/shared-folder sync and latency stats are app-studio UI.

## opendaw-headless docs touched alongside this upgrade

- `documentation/internals/04-sample-loading.md` — the two references to
  `packages/studio/core/src/samples/OpenSampleAPI.ts` as the example `SampleProvider` are now
  stale (the file moved out of the SDK); updated to point at the `SampleProvider` interface
  and note the relocation.
- `src/demos/playback/CLAUDE.md` — the `OpenSampleAPI` mention updated to reflect that the
  helper is no longer part of `@opendaw/studio-core`.

## Upgrade test plan

- [x] `rm -rf node_modules package-lock.json && npm install` regenerates the lockfile cleanly.
- [x] `npm ci` passes from the regenerated lockfile (only the audit advisory, no sync error).
- [x] `npm run build` (Vite + VitePress) succeeds.
- [x] `npx tsc --noEmit --ignoreDeprecations "6.0"` shows **zero new errors** vs the parent
      commit (14 pre-existing `src/` errors, byte-identical set; the `node_modules` DOM-lib
      TS2304s are the known `FilePickerOptions`/`AudioPlaybackStats` environmental cascade).
- [ ] Smoke-test loop-recording, playback, and export demos in the browser — engine behaviour
      should be identical (built-in TS engine; no `EngineVariant` installed).
- [ ] Confirm the StereoWidth effect still sounds right when panned; decide whether to pin
      `panning-mixing` to `EqualPower` if the Linear default is undesirable.
