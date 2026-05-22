# Project and Persistence

> **Audience:** contributors to openDAW. This chapter ties everything together: the `Project` class, the `.od` file format, the hash-chained transaction log, collaborative editing, dawproject interchange, freeze, and offline render.
>
> **Prereqs:** all five prior internals chapters. This chapter is the integration layer above them.

So far we've documented surfaces: the engine processor that runs audio, the box graph that stores state, the cross-thread protocols that wire them up, the sample loader that feeds them, the device system that fills the chains. What we *haven't* documented is the thing that owns all of those — the `Project` — and the persistence story: how a project becomes bytes on disk, comes back from bytes, syncs across multiple users, exports as `.dawproject`, freezes a track to audio, or renders the whole mix offline.

This chapter is all of that.

## The `Project` class

`Project` (`packages/studio/core/src/project/Project.ts:94`) is the top-level owner of everything else. Its private constructor takes:

```typescript
private constructor(env: ProjectEnv, boxGraph: BoxGraph, {
    rootBox,
    userInterfaceBoxes,
    primaryAudioBusBox,
    primaryAudioUnitBox,
    timelineBox
}: ProjectMandatoryBoxes)
```

It's instantiated through three static factories:

```typescript
static new(env: ProjectEnv, options?: ProjectCreateOptions): Project
static load(env: ProjectEnv, arrayBuffer: ArrayBuffer): Project
static async loadAnyVersion(env: ProjectEnv, arrayBuffer: ArrayBuffer): Promise<Project>
```

`new()` builds an empty project from a `ProjectSkeleton.empty()`. `load()` decodes a current-format `.od` buffer. `loadAnyVersion()` runs the buffer through `ProjectMigration.migrate()` first, so older files keep opening as the format evolves.

### What it composes

The project is a fairly broad object — it owns the entire session. Important fields (`Project.ts:160–225`):

| Field | Type | What it owns |
|---|---|---|
| `boxGraph` | `BoxGraph<BoxIO.TypeMap>` | Serializable state — every track, region, device, event |
| `editing` | `Editing` | Transactional mutation + undo/redo history |
| `selection` | `VertexSelection` | What the user has selected in the UI |
| `boxAdapters` | `BoxAdapters` | Cached typed wrappers around boxes |
| `parameterFieldAdapters` | `ParameterFieldAdapters` | Cached parameter wrappers with `ValueMapping`/`StringMapping` |
| `liveStreamReceiver` | `LiveStreamReceiver` | Receives spectrum/waveform/peak broadcasts from the worklet |
| `sampleManager` | `GlobalSampleLoaderManager` | The cache + ref-counted sample loader from [ch. 04](./04-sample-loading.md) |
| `soundfontManager` | `SoundfontLoaderManager` | Same pattern, for soundfonts |
| `engine` | `EngineFacade` | The observable wrapper around the worklet ([ch. 03](./03-cross-thread-protocols.md)) |
| `tempoMap` | `TempoMap` | PPQN-to-seconds conversion with tempo automation (internally memoised via `TempoGridCursor` so repeated overlapping `intervalToSeconds` calls amortise) |
| `audioUnitFreeze` | `AudioUnitFreeze` | Track-freeze controller (see below) |
| `mixer`, `midiLearning`, `captureDevices`, … | various | The smaller subsystems |

A `Terminator` (`#terminator`) owns the lifetime of every subsystem. When the project closes, terminating it cleans everything up: subscriptions, ref counts, the worklet node, the box graph itself.

### Key operations

```typescript
toArrayBuffer(): ArrayBufferLike       // serialize the project to a .od buffer
copy(env?: Partial<ProjectEnv>): Project  // deep clone: encode + decode through ProjectSkeleton
startAudioWorklet(restart?, options?): Promise<void>  // construct the EngineWorklet
```

`copy()` is what powers freeze and offline render — both run a *separate* project (modified in some way) through an offline `EngineProcessor` without touching the live one.

## `ProjectSkeleton` — the bootstrap payload

`Project` is rich (subscriptions, cached adapters, mixer state). What gets *shipped* between threads or to disk is much smaller: the `ProjectSkeleton` (`packages/studio/adapters/src/project/ProjectSkeleton.ts:28`):

```typescript
export type ProjectSkeleton = {
    boxGraph: BoxGraph<BoxIO.TypeMap>
    mandatoryBoxes: ProjectMandatoryBoxes
}
```

`ProjectMandatoryBoxes` is the handful of well-known boxes the engine always expects to find (RootBox, primary AudioBus, primary OutputUnit, TimelineBox, UserInterfaceBox). They're not encoded specially — they're just shortcuts so consumers don't have to walk the graph to find them.

### Binary format

`ProjectSkeleton.encode()` (`ProjectSkeleton.ts:96`) is the canonical encoder:

```typescript
export const encode = (boxGraph: BoxGraph) => {
    const output = ByteArrayOutput.create()
    output.writeInt(MAGIC_HEADER_OPEN)      // 0x4F50454E = "OPEN"
    output.writeInt(FORMAT_VERSION)         // 2
    const boxGraphChunk = boxGraph.toArrayBuffer()
    output.writeInt(boxGraphChunk.byteLength)
    output.writeBytes(new Int8Array(boxGraphChunk))
    return output.toArrayBuffer()
}
```

The layout is exactly:

```
[4 bytes] magic = 0x4F50454E ("OPEN" in ASCII)
[4 bytes] format version = 2
[4 bytes] box-graph byte length
[N bytes] box-graph binary (see ch. 02 for the layout)
```

Magic "OPEN" — not "ODP" or anything project-specific — because the same skeleton format ships across multiple use cases (worklet bootstrap, `.od` file, preset file, sync log payload). All consumers go through `ProjectSkeleton.decode()` (`ProjectSkeleton.ts:106`):

```typescript
export const decode = (arrayBuffer: ArrayBufferLike): ProjectSkeleton => {
    const input = new ByteArrayInput(arrayBuffer)
    assert(input.readInt() === MAGIC_HEADER_OPEN,
        "Corrupt header. Probably not an openDAW project file.")
    assert(input.readInt() === FORMAT_VERSION, "Deprecated Format")
    const boxGraphChunkLength = input.readInt()
    const boxGraphChunk = new Int8Array(boxGraphChunkLength)
    input.readBytes(boxGraphChunk)
    const boxGraph = new BoxGraph<BoxIO.TypeMap>(Option.wrap(BoxIO.create))
    boxGraph.fromArrayBuffer(boxGraphChunk.buffer, false)
    return {boxGraph, mandatoryBoxes: findMandatoryBoxes(boxGraph)}
}
```

The version check is strict — old-format buffers throw `"Deprecated Format"`. That's where `ProjectMigration.migrate()` (`packages/studio/core/src/project/migration/`) comes in: it patches old buffers up to the current version before they hit `decode()`.

### Where the skeleton is used

- **Project file on disk** — exactly the encoded skeleton, see [Project file format](#project-file-format) below.
- **Worklet bootstrap** — `EngineProcessor.constructor` ([ch. 01](./01-engine-processor.md#the-process-loop)) receives `processorOptions.project: ArrayBufferLike`, which is exactly this format.
- **SyncLog `Init` commit payload** — the very first commit in a log carries a full skeleton.
- **Preset files** (`.odp`) — same encoding, stripped down to just an `AudioUnitBox` and its devices.
- **`Project.copy()`** — encode + decode + new project instance.

The same magic header on disk and in memory means a `.od` file and a memory buffer are interchangeable. A test that writes a buffer with `encode()` and reads it back with `decode()` covers the on-disk format too.

## Project file format

The on-disk file is `project.od`, stored in OPFS under `projects/v1/{uuid-as-hex}/`. Three files per project (`ProjectPaths.ts`):

```
projects/v1/
  {uuid}/
    project.od    ← exactly an encoded ProjectSkeleton
    meta.json     ← ProjectMeta (name, artist, dates, tags, …)
    image.bin     ← cover image (optional)
```

`ProjectProfile.#writeFiles()` (`packages/studio/core/src/project/ProjectProfile.ts:103`) saves all three in parallel via `Workers.Opfs` ([ch. 03](./03-cross-thread-protocols.md#fetchaudio--the-async-resource-pattern)):

```typescript
static async #writeFiles({uuid, project, meta, cover}: ProjectProfile): Promise<void> {
    return Promise.all([
        Workers.Opfs.write(ProjectPaths.projectFile(uuid),
            new Uint8Array(project.toArrayBuffer())),
        Workers.Opfs.write(ProjectPaths.projectMeta(uuid),
            new TextEncoder().encode(JSON.stringify(meta))),
        cover.match({
            none: () => Promise.resolve(),
            some: x => Workers.Opfs.write(ProjectPaths.projectCover(uuid), new Uint8Array(x))
        })
    ]).then(EmptyExec)
}
```

The separation matters: listing all projects only needs to read `meta.json` for each (cheap, human-readable, no big binary parse). The actual `project.od` is only loaded when you open the project.

### `ProjectMeta`

```typescript
export type ProjectMeta = {
    name: string
    artist: string
    description: string
    tags: Array<string>
    created: Readonly<string>     // ISO 8601, frozen after creation
    modified: string              // ISO 8601, updated on save
    notepad?: string
    radioToken?: string           // for live broadcast feature
}
```

`created` is `Readonly` — once set, never changes. `modified` updates on every save.

### `Storage<>` base class

Both samples ([ch. 04](./04-sample-loading.md#storage-opfs-layout)) and presets follow the same OPFS pattern, generalized into `Storage<ITEM, META, NEW, PARTS>` (`packages/studio/core/src/Storage.ts`). It provides `list()`, `deleteItem()`, and the trash-list pattern; subclasses implement `save()` and `load()`. Projects deliberately don't extend it because they have an extra cover-image dimension, but the spirit is the same.

## SyncLog — hash-chained transaction history

The `.od` file is a *snapshot*. The `SyncLog` (`packages/studio/core/src/sync-log/`) is the *journal*: every transaction that ever happened to a project, hash-chained for tamper detection.

### What a `Commit` looks like

```typescript
// packages/studio/core/src/sync-log/Commit.ts
export const enum CommitType { Init, Open, Updates, NewVersion }

export class Commit {
    static readonly VERSION = 1
    readonly type: CommitType
    readonly prevHash: ArrayBuffer    // 32 bytes (SHA-256)
    readonly thisHash: ArrayBuffer    // 32 bytes (SHA-256)
    readonly payload: ArrayBuffer     // type-dependent
    readonly date: number             // milliseconds since epoch
}
```

Three commit types you'll actually create (`NewVersion` is reserved):

- **`Init`** — first commit ever, payload is the full encoded `ProjectSkeleton`.
- **`Open`** — payload is empty; marks "session started" so consumers can reconstruct edit windows.
- **`Updates`** — payload is a length-prefixed array of serialized `Update` objects (the same `Update` types from [ch. 02](./02-box-system.md#editing--mutations-with-undoredo) — `NewUpdate`, `PrimitiveUpdate`, `PointerUpdate`, `DeleteUpdate`).

### The hash chain

The chain is built in `Commit.#create()`:

```typescript
static async #create(type: CommitType, prevHash: ArrayBuffer, payload: ArrayBuffer): Promise<Commit> {
    const date = Date.now()
    const output = ByteArrayOutput.create()
    const data = output.toArrayBuffer() as ArrayBuffer
    const thisHash = await Hash.fromBuffers(data, prevHash, new Float64Array([date]).buffer)
    return new Commit(type, prevHash, thisHash, payload, date)
}
```

`thisHash = SHA-256(data ++ prevHash ++ timestamp)`. Each commit's hash depends on the previous one's, so you can't insert, remove, or modify a commit without invalidating every later hash.

### Serialized commit layout

```
[4 bytes] commit type (enum)
[4 bytes] version = 1
[32 bytes] prevHash
[32 bytes] thisHash
[4 bytes] payload length
[N bytes] payload
[8 bytes] timestamp (double, ms since epoch)
```

`Commit.serialize()` writes this; `Commit.deserialize()` reads it back and asserts the version matches.

### Writer and reader

`SyncLogWriter.attach(project, observer, lastCommit?)` (`SyncLogWriter.ts:6`) hooks a project's transactions into a commit stream. The first call without a `lastCommit` creates an `Init` commit (with the full project payload), then an `Open` commit. Every subsequent transaction generates an `Updates` commit.

`SyncLogReader.unwrap(env, buffer)` (`SyncLogReader.ts:8`) replays a log:

```typescript
static async unwrap(env: ProjectEnv, buffer: ArrayBuffer): Promise<{
    project: Project,
    lastCommit: Commit,
    numCommits: int
}>
```

It reads the `Init` commit, decodes the payload to a `Project`, then iterates the remaining commits, applying each `Updates` payload. Hash continuity is checked at every step; a break throws. The reader yields back to the event loop periodically so the UI stays responsive while replaying long logs.

### Current role

SyncLog is **the recovery layer** (`Recovery.ts`), not the primary save format. The reason: a `.od` snapshot is much smaller than a log of every transaction that ever happened to a project. The primary persistence is `project.od`; SyncLog is the safety net for "user's browser crashed mid-session," and an audit trail for "what changed when."

## Y.js — collaborative editing (experimental)

`packages/studio/core/src/ysync/` integrates Y.js for CRDT-based multi-user editing. The current state: code is there, tests are there, but it isn't wired into a default deployment. The pieces:

- **`YMapper`** maps the box graph into a Y.js document. Each box becomes a `Y.Map` keyed by UUID; field values become entries in that map. Nested fields (arrays, objects) become nested `Y.Map`s.
- **`YSync`** observes both directions. Y.js → BoxGraph: walks `observeDeep()` events into `BoxGraph` updates inside a transaction. BoxGraph → Y.js: subscribes to graph updates and applies them to the Y document.
- **`YService`** owns the WebSocket connection (`y-websocket`) when there's a server.

The model is "the box graph is the canonical state; Y.js is a CRDT-compatible mirror." Conflicts that the box graph's invariants would reject (e.g. an `exclusive: true` pointer being set twice) cause the Y.js transaction to roll back.

For most contributors today, the relevant thing to know is: **this exists but isn't load-bearing**. If you're not actively working on collaboration, you can ignore the `ysync/` directory. If you are, the design is "box graph stays authoritative, Y.js stays mirror" — don't write to Y.js bypassing the box graph or anything will desync.

## DAW Project — cross-DAW interchange

`.dawproject` is Bitwig's open interchange format ([github.com/bitwig/dawproject](https://github.com/bitwig/dawproject)) — a ZIP file holding XML descriptions of tracks, regions, automation, plus a `resources/` folder of audio. openDAW imports and exports it.

### Library

`packages/lib/dawproject/` is the schema + (de)serializer. It's package-isolated — no openDAW box knowledge — so it can be reused outside the studio.

### Bridge service

`packages/studio/core/src/dawproject/DawProjectService.ts:13` is the studio-side bridge:

```typescript
static async importDawproject(sampleService: SampleService): Promise<Option<ProjectSkeleton>> {
    const file = await Files.open({types: [FilePickerAcceptTypes.DawprojectFileType]})
    const arrayBuffer = await file.arrayBuffer()
    const {project: projectSchema, resources} = await DawProject.decode(arrayBuffer)
    const {skeleton, audioIds} = await DawProjectImport.read(projectSchema, resources)
    // import audio resources via the sample service
    await Promise.all(audioIds.map(uuid => resources.fromUUID(uuid))
        .map(resource => sampleService.importFile({...})))
    return Option.wrap(skeleton)
}

static async exportDawproject(profile: ProjectProfile): Promise<void> {
    const zip = await DawProject.encode(project.skeleton, project.sampleManager, metaData)
    await Files.save(zip, {types: [FilePickerAcceptTypes.DawprojectFileType]})
}
```

The shape is: `.dawproject` → `ProjectSkeleton` (via `DawProjectImporter`) → `Project` (via `Project.load()`). And the reverse via `DawProjectExporter`.

### What maps to what

The mapping is the interesting (and lossy) part. `DawProjectExporter` translates:

- `AudioUnitBox` → DAW Project `Device` (with `Track` for tracks)
- `TrackBox` → DAW Project `Track` (audio / MIDI per the unit type)
- `AudioRegionBox` → DAW Project `Clip` (with an external audio reference)
- Automation curves → DAW Project automation points
- Effect parameter values → vendor-extension XML (because DAW Project doesn't specify every effect)

Status: importable + exportable, but the format-mapping table is still being filled out. If you add a new effect ([ch. 05](./05-devices-and-effects.md#how-to-add-a-new-effect-full-walkthrough)), it'll round-trip with parameters as a vendor extension; full schema mapping is opt-in.

## Track freeze

`AudioUnitFreeze` (`packages/studio/core/src/AudioUnitFreeze.ts:12`) bounces an `AudioUnit` to an offline-rendered buffer that replaces the live chain. The motivation is straightforward: heavy effect chains (NAM convolution, modular synthesis) can cost more than 2.9 ms per quantum, dropping audio. Frozen, they cost a buffer lookup.

### The freeze flow

```typescript
freeze(audioUnitBoxAdapter: AudioUnitBoxAdapter): Promise<void> {
    // 1. Refuse if this unit is a sidechain source — freezing would break the dependent.
    if (this.hasSidechainDependents(audioUnitBoxAdapter)) {
        alert("Cannot freeze; this unit is a sidechain source")
        return
    }

    // 2. Build an offline render config that asks for just this unit's output as a "stem."
    const exportConfiguration: ExportConfiguration = {
        stems: {
            [audioUnitUuid]: {
                includeAudioEffects: true,
                includeSends: false,
                useInstrumentOutput: false,
                skipChannelStrip: true,
                fileName: "freeze"
            }
        }
    }

    // 3. Deep-clone the project, render the clone offline.
    const copiedProject = this.#project.copy()
    const audioData = await OfflineEngineRenderer.start(
        copiedProject, Option.wrap(exportConfiguration),
        progress, abortSignal, engine.sampleRate
    )

    // 4. Ship the frozen buffer to the live engine.
    engine.setFrozenAudio(audioUnitBoxAdapter.uuid, audioData)

    // 5. Track the freeze so it gets cleared if the unit is deleted.
    this.#frozenAudioUnits.set(audioUnitUuid, {audioData, deletionSubscription})
}
```

Key choices:

- **Copy the project, don't render the live one.** The render needs to mute everything except this unit, configure stem export, and run the engine offline. Doing that on the live project would have visible side effects.
- **Render via `OfflineEngineRenderer`** (next section), not on the audio thread.
- **Hand the result to `engine.setFrozenAudio(uuid, audioData)`**, which is an `EngineCommands` RPC. The worklet stores the buffer and `FrozenPlaybackProcessor` ([ch. 05](./05-devices-and-effects.md#special-processors)) starts playing it instead of running the chain.

### What invalidates a freeze

`AudioUnitFreeze` subscribes to the timeline's BPM and tempo automation. A tempo change makes the frozen audio musically misaligned, so it auto-unfreezes. The user can also unfreeze manually, and deleting the unit clears the frozen buffer via the deletion subscription.

## Offline rendering

`OfflineEngineRenderer` (`packages/studio/core/src/OfflineEngineRenderer.ts:38`) is what freeze and export both go through. It spins up a Web Worker, loads the AudioWorkletProcessor module *into the worker* (not as an actual audio worklet), and drives it with explicit `step()` calls.

### How the worker runs `EngineProcessor`

`packages/studio/core-workers/src/offline-engine-main.ts` exposes the `OfflineEngineProtocol` ([ch. 03](./03-cross-thread-protocols.md#offline-renderer--same-processor-different-driver)):

```typescript
Communicator.executor<OfflineEngineProtocol>(
    Messenger.for(self).channel("offline-engine"), {
        async initialize(enginePort: MessagePort, config: OfflineEngineInitializeConfig) {
            setupWorkletGlobals({sampleRate: config.sampleRate})
            await import(config.processorsUrl)
            const ProcessorClass = globals.__registeredProcessors__["engine-processor"]
            state = Option.wrap({
                processor: new ProcessorClass({
                    processorOptions: {
                        project: config.project,
                        exportConfiguration: config.exportConfiguration
                    }
                }),
                ...
            })
        }
    })
```

Two clever bits:

1. **`setupWorkletGlobals`** — pre-populates `sampleRate`, `currentFrame`, etc. globals that AudioWorklet code expects. This lets the *same* `EngineProcessor` class run in a vanilla Worker.
2. **Dynamic `import(config.processorsUrl)`** — loads the worklet bundle, which calls `registerProcessor("engine-processor", EngineProcessor)`. The worker captures that via a stubbed global `registerProcessor`.

After that, the worker has a real `EngineProcessor` instance. `step(samples)` is a tight loop:

```typescript
while (engine.running && engine.totalFrames < maxFrames) {
    const outputs = Arrays.create(() => new Float32Array(RenderQuantum), numberOfChannels)
    updateFrameTime(engine.totalFrames, engine.sampleRate)
    const keepRunning = engine.processor.process([[]], outputs)
    // accumulate samples; detect silence to break early
}
```

### Silence detection

`render()` keeps going until either `maxDurationSeconds` is hit *or* the output has been quieter than `silenceThresholdDb` (default −72 dB) for `silenceDurationSeconds` (default 10s). This is how export "knows when to stop" — it follows the natural decay of the mix instead of cutting at the last region's end position.

### Used by

- **`AudioUnitFreeze.freeze()`** — single-stem render to a buffer.
- **`AudioConsolidation.flatten()`** — merge multiple regions into one rendered file. Same offline pipeline, different export config (no effects, raw audio).
- **The studio export UI** — full-mix or stems export to WAV (and then optionally encoded via FFmpeg worker for MP3/FLAC).

## Audio consolidation (flatten)

`AudioConsolidation.flatten()` (`packages/studio/core/src/AudioConsolidation.ts:14`) does in-project bouncing: pick several audio regions, render them through their tracks (effects + automation included or excluded by config), import the result as a new `AudioFileBox`, replace the original regions with a single one.

The shape:

```typescript
export const flatten = async (
    project: Project,
    sampleService: SampleService,
    regions: ReadonlyArray<AudioRegionBoxAdapter>,
    abortSignal?: AbortSignal
): Promise<void> => {
    // copy project, delete all non-selected regions in range
    // render offline with exportConfiguration tuned to just this track
    // import the result via sampleService.importFile (chapter 04)
    // create a single new AudioRegionBox via AudioContentFactory
}
```

It's the same pattern as freeze: copy + selective delete + offline render + import + integrate. The offline-render workflow is general; freeze and consolidation are two callers.

## Open/save flow (where it all goes)

The "open project" call stack:

1. UI: user picks a project from the list (`ProjectStorage.listProjects()` → `meta.json` for each).
2. `ProjectStorage.loadProject(uuid)` → `Workers.Opfs.read(projectFile(uuid))` → `ArrayBuffer`.
3. `Project.loadAnyVersion(env, arrayBuffer)` → `ProjectMigration.migrate()` → `ProjectSkeleton.decode()` → `Project` instance.
4. The new `Project` constructs `EngineFacade`, and when the user clicks play, `Project.startAudioWorklet()` instantiates the `EngineWorklet`. The worklet receives `processorOptions.project` — the same `.od` bytes — and reconstructs its own copy of the graph.

The "save project" call stack:

1. User clicks save (or auto-save fires).
2. `ProjectProfile.save()` (or `saveAs()` for a new UUID).
3. `Project.toArrayBuffer()` → `ProjectSkeleton.encode(this.boxGraph)`.
4. `ProjectProfile.#writeFiles()` writes `project.od`, `meta.json`, optional `image.bin` in parallel to OPFS.

For *Save As* on the desktop (downloading to the user's file system), the bytes go through `Files.save()` instead, which uses the File System Access API or a download fallback. Same `.od` format either way.

## PresetService

Presets ride the same skeleton format. `PresetStorage` (`packages/studio/core/src/presets/PresetStorage.ts:53`) writes `.odp` files into `presets/user/{uuid}/`:

```typescript
export const save = async (meta: PresetMeta, data: ArrayBufferLike): Promise<void> => {
    await Workers.Opfs.write(fileFor(UUID.parse(meta.uuid)), new Uint8Array(data))
    const current = await readIndex()
    const next = current.filter(entry => entry.uuid !== meta.uuid)
    next.push({...meta, modified: Date.now()})
    await writeAndCache(next)
}
```

The "data" is an encoded `ProjectSkeleton` — but a *minimal* one, with just the device's `AudioUnitBox` and its effect chain. When you load a preset, the studio creates a new `AudioUnit`, decodes the preset's box graph, and grafts the devices into the live project.

## `StudioPreferences`

User settings (theme, sample rate, auto-save interval, etc.) live in `StudioPreferences` (`packages/studio/core/src/StudioPreferences.ts:1`):

```typescript
export const StudioPreferences = Preferences.host("preferences", StudioSettingsSchema)
```

`Preferences.host()` (from `@opendaw/lib-fusion`) handles persistence (to OPFS), schema validation, and cross-thread sync. The worklet reads a subset via the `engine-preferences` channel ([ch. 03](./03-cross-thread-protocols.md#the-engines-rpc-channels)). The main thread reads everything.

If you add a new setting, the place is `StudioSettingsSchema`; existing UI code already knows how to render based on the schema shape.

## Cloud sync

`packages/studio/core/src/cloud/` provides optional cloud backup. It's a thin layer over `ProjectStorage` and friends: instead of writing to OPFS only, it also pushes to Dropbox or Google Drive (driver per provider in `DropboxHandler.ts` / `GoogleDriveHandler.ts`).

Designed-in atomicity: a `lock.json` file in the remote folder prevents concurrent uploaders from racing. If you implement a new provider, follow the existing handlers' shape — they're a few hundred lines of OAuth + upload/download, nothing exotic.

Not load-bearing for the engine; it's a UI feature. Most contributors will never touch it.

## Migration

Format version bumps happen when `FORMAT_VERSION` in `ProjectSkeleton.ts` changes. Old files fail at the `decode()` version assertion. To stay openable:

1. Add a migration in `packages/studio/core/src/project/migration/` that reads the old format and produces the new one.
2. Register it in the migration chain.
3. Bump `FORMAT_VERSION`.
4. `Project.loadAnyVersion()` runs migrations before `decode()`.

The migrations operate on raw bytes — at minimum each one reads the old format, modifies what's needed, and writes the new. Practically they tend to be partial: read just enough of the old buffer to detect what to upgrade, copy the rest. Look at existing migrations for the pattern.

## Critical invariants

1. **`ProjectSkeleton.FORMAT_VERSION` is bumped only with a migration.** Skipping the migration silently breaks every saved file in the wild.
2. **`project.od` is exactly `ProjectSkeleton.encode(boxGraph)`.** No outer wrapper, no metadata embedded. Metadata is `meta.json`. Don't change this without a coordinated bump.
3. **The hash chain in SyncLog is load-bearing for recovery.** Any commit you write must hash from the previous commit; out-of-order or skipped chains break replay.
4. **Freeze cannot capture sidechain dependencies.** If unit A side-chains B, freezing A removes the sidechain source from B's chain. The freeze handler refuses; if you bypass that check, expect silent audio bugs.
5. **`Project.copy()` is the only safe way to deep-clone.** Manual graph cloning misses pointers, automation, or selection state.
6. **`ProjectMigration` is one-way.** Once you save in the new format, the old reader can't open it. Test migrations exhaustively before bumping the version.
7. **The worklet's box graph is a *replica*, not the original.** Mutations made to it directly (skipping `SyncSource`) won't reach the main thread and will be overwritten on the next sync.
8. **Preset files are real `ProjectSkeleton`s.** They're not a separate format; they're just smaller box graphs. The unifier — magic bytes "OPEN" plus version — applies.

## Further reading

- **`packages/studio/core/src/project/Project.md`** — a longer-form design document for `Project`, kept alongside the code. Useful background for *why* the composition is the way it is.
- **`packages/studio/core/src/project/Recovery.ts`** — how SyncLog is consumed during crash recovery; pairs with this chapter's SyncLog section.
- **`packages/studio/core/src/project/ProjectMigration.ts`** and the `migration/` subfolder — the canonical pattern for version bumps.
- **`packages/lib/dawproject/`** — the DAW Project schema and serializer; self-contained, useful for understanding the import/export boundary.
- **`packages/studio/core/src/dawproject/DawProjectExporter.test.ts`** and **`DawProjectImporter.test.ts`** — round-trip tests covering supported subsets of the format.
- **[Ch. 02 — Box System](./02-box-system.md#serialization)** for the box graph serialization that `ProjectSkeleton` wraps.
- **[Ch. 05 — Devices and Effects](./05-devices-and-effects.md#special-processors)** for `FrozenPlaybackProcessor`, the worklet side of freeze.
- **[Ch. 03 — Cross-Thread Protocols](./03-cross-thread-protocols.md#offline-renderer--same-processor-different-driver)** for how the offline-renderer worker reuses `EngineProcessor`.
