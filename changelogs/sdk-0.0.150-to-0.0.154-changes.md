# OpenDAW SDK Changelog: 0.0.150 → 0.0.154

Four point releases (0.0.151, 0.0.152, 0.0.153, 0.0.154). **No breaking changes.** The meaningful work is a new input-latency compensation pipeline (engine preference + per-track override), a `ProjectMetaBox` that puts project metadata into the box graph for P2P sync, multi-user remote-selection infrastructure (`RemoteSelections` / `FilteredRemoteSelection`), one clipboard fix (#983), and a SelectionBox migration.

## Out-of-cycle release note

> Like the previous cycle, these tags were published from upstream **`dev`**. The `studio-sdk` CHANGELOG only carries "version bump only" notes; the actual changes live in `studio-core`, `studio-adapters`, `studio-boxes`/`forge-boxes`, and `studio-enums`. All `@opendaw/lib-*` packages stayed pinned at the 0.0.150 versions — nothing under `lib/` changed in this range.

## Breaking Changes

**None.** No public API has been renamed, removed, or had its signature changed. opendaw-headless's source under `src/` requires no edits for this upgrade.

## Additive APIs

### `EngineSettingsSchema.recording.inputLatency` (new preference)

A new field on the recording-preferences schema, in seconds:

```typescript
// in EnginePreferencesSchema.ts
recording: {
    // ...existing fields...
    inputLatency: z.number().min(-1)   // NEW — default 0
}
```

Semantics (resolved through `InputLatency.resolve()` in `@opendaw/studio-core`):

| Value | Meaning |
|---|---|
| `0` (default) | No additional input compensation; only `audioContext.outputLatency` is applied. |
| `> 0` | Seconds added on top of `outputLatency` to push the waveform offset further into the buffer (compensates measured mic→engine delay). |
| `-1` | Use the engine's measured `outputLatency` as the input latency too — effectively doubles compensation. |

Setting `inputLatency` shifts `RecordAudio`'s `currentWaveformOffset`/`waveformOffset` write by exactly `outputLatency + inputLatency` seconds (instead of just `outputLatency`). The `[CaptureAudio] latency report` debug line now includes an `inputLatencyApplied` field for verification.

**opendaw-headless impact:** none required. Leaving `inputLatency = 0` preserves the previous behaviour. If you build a UI for it, the value must be `≥ -1` (or `-1` for the "equals output" shorthand).

### `CaptureAudioBox.inputLatency` field (per-track override)

A new `float32` field at schema index `12`, `unit: "s"`, default `-2.0`:

```
-2 = inherit engine preferences      // sentinel: fall through to the engine setting above
-1 = equals output latency           // shorthand for "double the compensation"
>=0 = added to output latency        // explicit seconds
```

`CaptureAudio.startRecording()` reads `captureBox.inputLatency.getValue()` and passes it through `InputLatency.resolve(localOverride, preference, outputLatency)`. The result is forwarded to `RecordAudio.start(...)` as a new `inputLatency` field on `RecordAudioContext`.

**opendaw-headless impact:** none required. New `CaptureAudioBox` instances default to `-2` (inherit), so existing recording demos behave identically. If you want per-track latency compensation, set `captureBox.inputLatency.setValue(seconds)` inside `editing.modify()` after `createInstrument(...)` commits (per the standard "set capture fields in a separate transaction" rule from `CLAUDE.md`).

### `RecordAudio.RecordAudioContext` gains `inputLatency: number`

```typescript
// before (0.0.150)
type RecordAudioContext = {
    recordingWorklet: RecordingWorklet
    sourceNode: AudioNode
    sampleManager: SampleManager
    project: Project
    capture: Capture
    outputLatency: number
}

// after (0.0.154) — one new field
type RecordAudioContext = {
    ...
    outputLatency: number
    inputLatency: number   // NEW
}
```

`RecordAudio.start({ ..., inputLatency })` now writes `waveformOffset = headStartSeconds + countInSeconds + outputLatency + inputLatency` to the first take. Subsequent takes still chain from the previous take's offset + duration (unchanged), and consumers should still read `regionBox.waveformOffset.getValue()` directly rather than recomputing.

**opendaw-headless impact:** none required. opendaw-headless does not call `RecordAudio.start` directly — it's invoked internally by `CaptureAudio.startRecording`.

### `InputLatency` namespace (new public export from `@opendaw/studio-core`)

```typescript
export namespace InputLatency {
    export const Inherit = -2.0       // CaptureAudioBox sentinel: inherit engine pref
    export const EqualsOutput = -1.0  // either CaptureAudioBox or engine pref: "= outputLatency"

    export const resolve = (
        localOverride: number,
        preference: number,
        outputLatency: number
    ): number => {
        const value = localOverride <= Inherit ? preference : localOverride
        return value === EqualsOutput ? outputLatency : Math.max(0, value)
    }
}
```

Exported from `@opendaw/studio-core` (`capture/index.ts` re-exports it). Use the sentinel constants when constructing per-track or engine-preference values so you don't bake the magic numbers into call sites.

### `ProjectMetaBox` (new top-level box, P2P-shareable project metadata)

A new mandatory-on-create-but-pointer-optional box that mirrors the in-memory `ProjectMeta` into the box graph so peers see metadata changes through the same `editing.subscribe` channel they already watch for box-graph edits:

```typescript
// new schema (forge-boxes/std/ProjectMetaBox.ts)
ProjectMetaBox {
    projectName: string
    artist: string
    description: string
    tagList: string       // JSON-encoded Array<string>
    notepad: string
    created: string
    modified: string
    coverId: string       // content id of the cover image; empty = no cover
}
```

`Pointers.ProjectMeta` is the new pointer type, and `RootBox.projectMeta` (pointer field at index `101`) optionally references the box.

`ProjectProfile` now:
- Creates a `ProjectMetaBox` if one doesn't exist when constructed, wiring it under `rootBox.projectMeta`.
- Mirrors every `updateMetaData(key, value)` call into the corresponding box field via a private `#runLocal(...)` transaction (skipping `radioToken`, which stays in-memory only).
- Subscribes to `boxGraph.subscribeToAllUpdates` and re-reads the box back into `meta` when a peer changes a field — this is the inbound P2P sync path.
- Exposes new observers `subscribeCover(...)` and `subscribeCoverId(...)`, plus `setFetchedCover(buffer)` for storing cover bytes a peer sent over P2P.

**Disk format unchanged.** `project.od`, `meta.json`, and `image.bin` still live under `projects/v1/{uuid}/` exactly as documented in `documentation/internals/06-project-and-persistence.md`. The new box *parallels* `meta.json`; it doesn't replace it.

**opendaw-headless impact:** none required. opendaw-headless is single-user, so the inbound P2P sync path never fires. The outbound mirror runs on every `updateMetaData(...)` call but only adds one box-graph transaction per change. Existing projects that load without a `ProjectMetaBox` get one created on first construction (see migration note below).

### Multi-user remote selection (new in `@opendaw/studio-adapters`)

Two new classes for collaborative sessions:

```typescript
// adapters/src/selection/RemoteSelections.ts
class RemoteSelections implements Terminable {
    constructor(rootBox: RootBox, followed: ObservableOption<UserInterfaceBox>)
    ownersOf(vertex: SelectableVertex): ReadonlyArray<UserInterfaceBox>
    forEach(p: Procedure<{selectable: SelectableVertex, user: UserInterfaceBox}>): void
    subscribe(listener: RemoteSelectionListener<SelectableVertex>): Subscription
    catchupAndSubscribe(listener: RemoteSelectionListener<SelectableVertex>): Subscription
    createFilteredSelection<T extends Addressable>(
        filter: Predicate<SelectableVertex>,
        mapping: Bijective<T, SelectableVertex>
    ): FilteredRemoteSelection<T>
    terminate(): void
}

// adapters/src/selection/FilteredRemoteSelection.ts
class FilteredRemoteSelection<T extends Addressable> implements Terminable {
    ownersOf(selectable: T): ReadonlyArray<UserInterfaceBox>
    subscribe(listener: RemoteSelectionListener<T>): Subscription
    catchupAndSubscribe(listener: RemoteSelectionListener<T>): Subscription
}
```

The pattern mirrors `VertexSelection` / `FilteredSelection`, but watches *every other user's* `SelectionBox` and emits `(selectable, user)` pairs so painting can ask synchronously "who else has this vertex selected?". The followed user is excluded — the local `FilteredSelection` already renders it.

`VertexSelection` also gains a new public getter:

```typescript
// VertexSelection
get user(): ObservableOption<UserInterfaceBox>   // currently followed user
```

`switch(target)` now wraps `target.box` (when it's a `UserInterfaceBox`) into this observable; `release()` clears it. `RemoteSelections` consumes this to know which user *not* to watch.

### `Project` instantiates the multi-user selection trio automatically

```typescript
// new readonly fields on Project
readonly remoteSelections: RemoteSelections
readonly remoteDeviceSelection: FilteredRemoteSelection<DeviceBoxAdapter>
readonly remoteRegionSelection: FilteredRemoteSelection<AnyRegionBoxAdapter>
```

Constructed alongside the existing `selection` / `deviceSelection` / `regionSelection`. The constructor also re-orders the `tempoMap` initialization earlier so that the filtered-selection mappings can reach `boxAdapters` before they're needed (no observable behaviour change for existing callers).

**opendaw-headless impact:** none required. Single-user projects get empty `remoteSelections` indices; the cost is one `pointerHub.catchupAndSubscribe` on `rootBox.users` per project (negligible).

## Bug Fixes

### `AudioUnitsClipboard.copyAudioUnit` — drop orphan automation lanes (upstream fix #983)

Previously, copying an `AudioUnitBox` whose tracks contained automation lanes targeting *excluded* boxes (e.g. an aux-send level) would serialize the lane's `TrackBox` but drop the target box. On paste, the mandatory `TrackBox.target` pointer was unwired, surfacing as error #983.

The fix lifts the dependency-collection logic into a new exported helper `AudioUnitsClipboard.collectDependencies(audioUnitBox, isOutput)` and adds one extra `excludeBox` rule:

```typescript
if (box instanceof TrackBox) {
    const targetBox = box.target.targetVertex.unwrapOrNull()?.box
    if (isDefined(targetBox) && isExcludedTargetBox(targetBox)) {
        return true   // drop orphaned automation lane from the copy
    }
}
```

Excluded target boxes: `RootBox`, `AudioBusBox`, `AuxSendBox`, `MIDIControllerBox` (plus `CaptureAudioBox` and `CaptureMidiBox` when copying an output unit). 224 lines of test coverage were added alongside this fix.

**opendaw-headless impact:** none required. opendaw-headless doesn't expose audio-unit copy/paste in its UI. If you ever wire `ClipboardManager` into a demo, the new behaviour is strictly better.

### Removes broken `SelectionBox` entries on load (new migration)

A new `migrateSelectionBox(boxGraph, box)` runs as part of `ProjectMigration.migrate()`:

```typescript
// MigrateSelectionBox.ts
if (isInvalid(box.selectable) || isInvalid(box.selection)) {
    console.debug("Migrate remove broken 'SelectionBox'")
    boxGraph.beginTransaction()
    box.delete()
    boxGraph.endTransaction()
}
```

`isInvalid(pointer)` returns true if the pointer either has no target address or the target vertex no longer exists in the graph. Such orphaned `SelectionBox` entries can arise from older sessions where a vertex was deleted before its selection was cleared. They're now removed eagerly when the project is loaded.

**opendaw-headless impact:** none required. The migration is silent for projects that don't have orphan selections, and the only observable effect for projects that do is a `console.debug` line on load.

## Tweaks visible to consumers

### `studio-enums` — `Colors` palette nudged brighter

`packages/studio/enums/src/Colors.ts` updates the lightness component of the neutral palette:

| Color | Before (HSL) | After (HSL) |
|---|---|---|
| `bright` | `(197, 5, 90)` | `(197, 5, 95)` |
| `gray` | `(197, 31, 80)` | `(197, 31, 90)` |
| `dark` | `(197, 15, 60)` | `(197, 15, 70)` |
| `shadow` | `(197, 10, 45)` | `(197, 10, 55)` |
| `black` | `(197, 10, 16)` | `(197, 10, 20)` |
| `background` | `(197, 6, 7)` | `(197, 8, 7)` |
| `panelBackgroundBright` | `(197, 10, 17)` | `(197, 11, 16)` |
| `panelBackgroundDark` | `(197, 14, 8)` | `(197, 14, 7)` |

opendaw-headless doesn't call `initializeColors(root)` (Radix Themes handles our palette), so these changes only matter if you ever pull `@opendaw/studio-enums`'s `Colors` directly into a stylesheet.

### `Pointers.ProjectMeta` (new enum value)

Added between `PianoMode` and `RegionCollection`. The enum is auto-numbered, so any downstream code that compares pointer-type integers numerically (you shouldn't) would shift — accept-rules use the enum identifier and are unaffected.

## Library Bumps

The SDK aggregates these `@opendaw/*` package updates:

| Package | 0.0.150 baseline | 0.0.154 baseline | Notes |
|---|---|---|---|
| `@opendaw/lib-std` | `^0.0.78` | `^0.0.78` | unchanged |
| `@opendaw/lib-runtime` | `^0.0.79` | `^0.0.79` | unchanged |
| `@opendaw/lib-dom` | `^0.0.83` | `^0.0.83` | unchanged |
| `@opendaw/lib-jsx` | `^0.0.83` | `^0.0.83` | unchanged |
| `@opendaw/lib-dsp` | `^0.0.84` | `^0.0.84` | unchanged |
| `@opendaw/lib-box` | `^0.0.86` | `^0.0.86` | unchanged |
| `@opendaw/lib-xml` | `^0.0.64` | `^0.0.64` | unchanged |
| `@opendaw/lib-midi` | `^0.0.66` | `^0.0.66` | unchanged |
| `@opendaw/lib-fusion` | `^0.0.94` | `^0.0.94` | unchanged |
| `@opendaw/lib-dawproject` | `^0.0.70` | `^0.0.70` | unchanged |
| `@opendaw/studio-enums` | `^0.0.75` | `^0.0.77` | +2 (Colors palette, `Pointers.ProjectMeta`) |
| `@opendaw/studio-boxes` | `^0.0.91` | `^0.0.94` | +3 (`ProjectMetaBox`, `CaptureAudioBox.inputLatency`) |
| `@opendaw/studio-adapters` | `^0.0.112` | `^0.0.116` | +4 (`RemoteSelections`/`FilteredRemoteSelection`, `EngineSettingsSchema.inputLatency`, `VertexSelection.user`) |
| `@opendaw/studio-core` | `^0.0.148` | `^0.0.152` | +4 (`InputLatency` namespace, `ProjectMetaBox` wiring in `ProjectProfile`, multi-user selection wiring in `Project`, fix #983, SelectionBox migration) |

The biggest jumps are `studio-core` and `studio-adapters` (the input-latency + remote-selection + project-meta-box work). All `lib-*` packages are pinned at the 0.0.150 versions — nothing under `packages/lib/` changed in this range.

## Other touches in the diff

- A "vocoder" effect is being added upstream (commits `07319a1a add vocoder plan`, `449aae72 add vocoder`, `7c852f96 updates on vocoder`). It is **not yet** exported from any SDK package consumed by opendaw-headless; mentioned here so you don't think it's a feature you missed.
- "Latency stats" and an in-app manual were added to `@opendaw/app-studio` (`0560a879 adds latency stats`, `564bcdb7 adds manual`, `61b7e5a7 updates manual`) — app-only, not in the SDK surface.
- Numerous error-triage commits (`b8f6c976`, `289ca78c`, `e908da01`, `64475544`, `ee78ec7e`, `efdadbae`) are docs in the upstream repo, not code changes.

## opendaw-headless docs touched alongside this upgrade

- `documentation/08-recording.md` — added `inputLatency` row to the recording-preferences table, updated the take-1 `waveformOffset` formula to include `inputLatency`, and corrected the `olderTakeScope` row to include `"none"` (stale since the 0.0.147→0.0.150 cycle).
- `documentation/04-box-system-and-reactivity.md` — added a short "Multi-user views: RemoteSelections" subsection after the existing `FilteredSelection` section, noting that single-user apps can ignore the remote indices.

## Upgrade test plan

- [x] `npm install` regenerates the lockfile cleanly.
- [x] `npm ci` passes from the regenerated lockfile (no "package.json and package-lock.json … are in sync" error).
- [x] `npm run build` (Vite + VitePress) succeeds with no type errors.
- [ ] Smoke-test loop-recording with default settings — recording behaviour at `inputLatency = 0` should be byte-identical to 0.0.150.
- [ ] Optionally try `settings.recording.inputLatency = 0.005` (5 ms) on the loop-recording demo and confirm `[CaptureAudio] latency report` logs `inputLatencyApplied: 0.005`.
- [ ] Open and resave a 0.0.150-era project — confirm the `ProjectMetaBox` is created silently on first open and `meta.json` continues to round-trip identically.
