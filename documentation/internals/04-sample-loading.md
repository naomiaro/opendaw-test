# Sample Loading and Peaks

> **Audience:** contributors to openDAW. This chapter is the full lifecycle of a sample: file bytes in, decoded `AudioData` + persistent peaks + on-demand worklet copy out.
>
> **Prereqs:** [`02-box-system`](./02-box-system.md) (so `AudioFileBox` makes sense), [`03-cross-thread-protocols`](./03-cross-thread-protocols.md) (so `Workers.Peak` and `fetchAudio` make sense). This chapter assumes those.

Samples are the heaviest single thing the SDK manages. A three-minute stereo WAV is roughly 30 MB of audio frames plus another megabyte or so of peaks. The pipeline has to decode it without blocking the UI, generate multi-resolution peaks for fast scrolling, cache to disk so the next open is instant, deduplicate concurrent requests, ref-count usage so memory frees on delete, and hand decoded frames to the audio worklet lazily on demand.

This chapter walks every step of that path. The pieces in order:

| Stage | Component | Thread | What it does |
|---|---|---|---|
| Decode | `SampleService.importFile()` | Main | Bytes → `AudioData` (WAV fast path + Web Audio fallback) |
| Peaks | `Workers.Peak.generateAsync()` | Worker | `AudioData` → multi-scale packed peaks |
| Persist | `SampleStorage.save()` | Worker (OPFS) | Audio + peaks + meta to `samples/v2/{uuid}/` |
| Index | `AudioFileBox` | Main | Lookup key + transient markers in the box graph |
| Cache | `GlobalSampleLoaderManager` | Main | In-memory dedup + ref-counted retention |
| Stream | `SampleManagerWorklet` | Worklet | Lazy fetch of audio frames via `fetchAudio` RPC |
| Render | `PeaksWriter` (recording only) | Worklet | Live peaks for in-progress recordings |

## Entry point: `SampleService.importFile()`

Everything starts here (`packages/studio/core/src/samples/SampleService.ts:33`):

```typescript
async importFile(
    {uuid, name, bpm, arrayBuffer, progressHandler = Progress.Empty, origin = "import"}
        : AssetService.ImportArgs,
    transformMeta?: (meta: SampleMetaData, audioData: Readonly<AudioData>) => Promise<void>
): Promise<Sample> {
    uuid ??= await UUID.sha256(arrayBuffer)
    const audioData = await this.#decodeAudio(arrayBuffer)
    const duration = audioData.numberOfFrames / audioData.sampleRate
    const shifts = SamplePeaks.findBestFit(audioData.numberOfFrames)
    const peaks = await Workers.Peak.generateAsync(
        progressHandler, shifts,
        audioData.frames, audioData.numberOfFrames, audioData.numberOfChannels
    ) as ArrayBuffer
    const meta: SampleMetaData = {
        bpm: bpm ?? estimateBpm(duration),
        name: name ?? "Unnnamed",
        duration,
        sample_rate: audioData.sampleRate,
        origin
    }
    if (isDefined(transformMeta)) { await transformMeta(meta, audioData) }
    const sample = {uuid: UUID.toString(uuid), ...meta}
    await SampleStorage.get().save({uuid, audio: audioData, peaks, meta})
    this.notifier.notify([sample, audioData])
    return sample
}
```

Three subtle things here:

1. **UUID is content-addressed.** When the caller doesn't pass a `uuid`, `UUID.sha256(arrayBuffer)` hashes the raw bytes. Two identical files get the same UUID, which means re-importing the same file is idempotent. This is why `AudioFileBox.Resource = "preserved"` ([chapter 02](./02-box-system.md#resource-types)) — the UUID is meaningful across projects.
2. **Decoded peaks come before the box.** The pipeline saves the audio + peaks + meta to storage *before* notifying the caller. By the time any `AudioFileBox` references this UUID, the resource is fully on disk.
3. **Notifier signals "sample is ready"** with both the `Sample` (lightweight metadata) and the in-memory `AudioData`. The UI uses this to update the sample browser without re-loading from disk.

### Decoding: `WavFile.decodeFloats` then `decodeAudioData` fallback

```typescript
// SampleService.ts:69
async #decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioData> {
    const wavResult = tryCatch(() => WavFile.decodeFloats(arrayBuffer))
    if (wavResult.status === "success") {return wavResult.value}
    console.debug("decoding with web-api-api (fallback)")
    const {status, value: audioBuffer} = await Promises.tryCatch(
        this.audioContext.decodeAudioData(arrayBuffer)
    )
    if (status === "rejected") {
        return Promise.reject(new Error("Could not decode audio file"))
    }
    const audioData = AudioData.create(
        audioBuffer.sampleRate, audioBuffer.length, audioBuffer.numberOfChannels
    )
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        audioData.frames[channel].set(audioBuffer.getChannelData(channel))
    }
    return audioData
}
```

WAV is the fast path because `WavFile.decodeFloats` runs on the main thread synchronously, skipping the AudioContext entirely. It returns floats already-laid-out as `Float32Array[]` (one per channel). MP3, AAC, OGG, FLAC, and Opus fall through to `decodeAudioData()` — slower (involves audio thread allocation) but supported as a browser API.

`AudioData` itself is a simple type (`@opendaw/lib-dsp`):

```typescript
type AudioData = {
    sampleRate: number
    numberOfFrames: number
    numberOfChannels: number
    frames: Float32Array[]   // one per channel, length === numberOfFrames
}
```

Plain data — no methods, no class. Easy to ship between threads via structured clone.

## Peaks generation: `Workers.Peak.generateAsync`

The peaks worker lives in `packages/studio/core-workers/` and is reached via the `Workers.Peak` client in `Workers.ts:26`:

```typescript
static get Peak(): SamplePeakProtocol {
    return Communicator.sender<SamplePeakProtocol>(
        this.messenger.unwrap().channel("peaks"),
        router => new class implements SamplePeakProtocol {
            async generateAsync(
                progress: Procedure<number>,
                shifts: Uint8Array,
                frames: ReadonlyArray<FloatArray>,
                numFrames: int,
                numChannels: int
            ): Promise<ArrayBufferLike> {
                return router.dispatchAndReturn(
                    this.generateAsync, progress, shifts, frames, numFrames, numChannels
                )
            }
        })
}
```

This is a textbook `Communicator.sender` (see [chapter 03](./03-cross-thread-protocols.md#communicator--typed-rpc)). The audio frames are passed by structured-clone copy — there's no `Transferable` involved, so the main thread keeps its references while the worker gets its own.

### Why `shifts`?

`SamplePeaks.findBestFit(numFrames)` returns a `Uint8Array` of shift values like `[3, 6, 9]`. Each shift represents a downsampling level:

- shift 3 → `1 << 3 = 8` samples per peak (zoomed in, ~125,000 peaks per million frames)
- shift 6 → `1 << 6 = 64` samples per peak (mid zoom)
- shift 9 → `1 << 9 = 512` samples per peak (zoomed out, ~2,000 peaks per million frames)

The worker computes *all* of these in one pass, then `PeaksPainter` picks the right one at draw time based on the current units-per-pixel. This is why scrolling a long sample stays smooth at every zoom level — no on-demand resampling.

### The packed format

Each peak is one `Int32` packing two `Float16` values (min and max of the chunk):

```typescript
// SamplePeakWorker.pack()
export const pack = (f0: float, f1: float): int => {
    const bits0 = Float16.floatToIntBits(f0)
    const bits1 = Float16.floatToIntBits(f1)
    return bits0 | (bits1 << 16)
}
```

Two 16-bit halves: low half = min, high half = max. Half-float precision is plenty for waveform rendering (you can't see the difference at pixel resolution), and it halves the storage compared to two full Float32s.

### The serialized peaks buffer

`SamplePeaks.toArrayBuffer()` writes everything into one `ArrayBuffer` with this layout (little-endian, all Int32 unless noted):

```
[4 bytes] magic: "PEAKS"
[4 bytes] numStages
  for each stage:
    [4 bytes] dataOffset
    [4 bytes] numPeaks
    [4 bytes] shift
    [4 bytes] reserved (0)
[4 bytes] numChannels
  for each channel:
    [4 bytes] byteLength
    [byteLength bytes] Int8Array of the channel's Int32 peak data
[4 bytes] numFrames
[4 bytes] numChannels
```

`SamplePeaks.from(byteArrayInput)` is the inverse — read the magic, parse the stages, materialize the Int32Arrays. The format is self-describing, so on-disk peaks survive shift-strategy changes (a future build can read old files with different shifts).

## Storage: OPFS layout

`SampleStorage` (`packages/studio/core/src/samples/SampleStorage.ts:17`) is the persistence layer. Everything goes under `samples/v2/`:

```
samples/v2/
  {uuid-as-hex}/
    audio.wav     ← re-encoded as WAV regardless of original format
    peaks.bin     ← the serialized peaks buffer
    meta.json     ← SampleMetaData (bpm, duration, sampleRate, origin, ...)
```

Three small files per sample, all written in parallel:

```typescript
// SampleStorage.ts:25
async save({uuid, audio, peaks, meta}: SampleStorage.NewSample): Promise<void> {
    const path = `${this.folder}/${UUID.toString(uuid)}`
    const data = new Uint8Array(WavFile.encodeFloats({
        frames: audio.frames.slice(),
        numberOfFrames: audio.numberOfFrames,
        numberOfChannels: audio.numberOfChannels,
        sampleRate: audio.sampleRate
    }))
    return Promise.all([
        Workers.Opfs.write(`${path}/audio.wav`, data),
        Workers.Opfs.write(`${path}/peaks.bin`, new Uint8Array(peaks)),
        Workers.Opfs.write(`${path}/meta.json`, new TextEncoder().encode(JSON.stringify(meta)))
    ]).then(EmptyExec)
}
```

`Workers.Opfs` is the same RPC-to-worker pattern as `Workers.Peak`. The OPFS worker actually touches the Origin Private File System; everything is async, all I/O off the main thread.

### Why re-encode to WAV?

A `.mp3` import gets stored as `.wav`. The reason: decoding once is expensive (especially MP3); decoding repeatedly when reloading the project would be infuriating. WAV is just a header on top of raw floats, so re-decoding is instant — `WavFile.decodeFloats` is the fast path.

The trade-off is disk space (10× larger for typical audio), but OPFS is browser-managed and content-addressed, so duplicate uploads collapse automatically.

### Corruption recovery

`load()` has self-healing for corrupt peaks (`SampleStorage.ts:78`):

```typescript
async #readOrRegeneratePeaks(path, bytes, audio, exactBuffer): Promise<Peaks> {
    if (bytes.byteLength > 0) {
        const attempt = tryCatch(() => SamplePeaks.from(new ByteArrayInput(exactBuffer(bytes))))
        if (attempt.status === "success") {return attempt.value}
        console.warn(`peaks.bin is corrupted for '${path}' — regenerating`)
    } else {
        console.warn(`peaks.bin is empty for '${path}' — regenerating`)
    }
    const shifts = SamplePeaks.findBestFit(audio.numberOfFrames)
    const regenerated = await Workers.Peak.generateAsync(
        Progress.Empty, shifts, audio.frames, audio.numberOfFrames, audio.numberOfChannels
    ) as ArrayBuffer
    await Workers.Opfs.write(`${path}/peaks.bin`, new Uint8Array(regenerated))
    return SamplePeaks.from(new ByteArrayInput(regenerated))
}
```

A corrupted or truncated `peaks.bin` doesn't fail the load — it triggers a regenerate from the still-valid audio. The audio itself doesn't have this safety net; if `audio.wav` is corrupt, the load fails and the loader transitions to `"error"`.

## The loader state machine

A `SampleLoader` is the main-thread handle on a sample's load state. Its state is observable:

```typescript
type SampleLoaderState =
    | { readonly type: "idle" }
    | { readonly type: "record" }                                  // PeaksWriter is appending live
    | { readonly type: "progress", progress: unitValue }           // 0.0–1.0
    | { readonly type: "error", readonly reason: string }
    | { readonly type: "loaded" }
```

`DefaultSampleLoader` (`packages/studio/core/src/samples/DefaultSampleLoader.ts`) is the canonical implementation:

```typescript
export class DefaultSampleLoader implements SampleLoader {
    #data: Option<AudioData> = Option.None
    #peaks: Option<Peaks> = Option.None
    #meta: Option<SampleMetaData> = Option.None
    #state: SampleLoaderState = {type: "progress", progress: 0.0}

    setLoaded(data, peaks, meta): void {
        this.#data = Option.wrap(data)
        this.#peaks = Option.wrap(peaks)
        this.#meta = Option.wrap(meta)
        this.#state = {type: "loaded"}
        this.#notifier.notify(this.#state)
    }

    setProgress(progress: number): void { ... }
    setError(reason: string): void { ... }
    invalidate(): void { /* reset to progress 0.0, clear data */ }
}
```

Subscribers see a strict ordering: zero or more `progress`, then either `loaded` (with data accessible) or `error`. Once `loaded`, `subscribe()` short-circuits and calls the observer immediately with the current state — late subscribers don't miss it.

`invalidate()` rolls the loader back to `progress: 0.0` and re-triggers the load. The peak regeneration on storage corruption uses this.

## `GlobalSampleLoaderManager` — the main-thread orchestrator

One per project (or one global). It owns four maps (`GlobalSampleLoaderManager.ts:28`):

| Map | Purpose |
|---|---|
| `#loaders` | UUID → SampleLoader. The set of loaders ever requested for this manager. |
| `#refCounts` | UUID → `{count: int}`. How many things are holding this sample. |
| `#cache` | UUID → `{data, peaks, meta}`. Decoded audio + peaks held in memory. |
| `#pending` | UUID → `{promise}`. Loads currently in flight. |

### `getOrCreate()` — the request entry point

```typescript
// GlobalSampleLoaderManager.ts:92
getOrCreate(uuid: UUID.Bytes): SampleLoader {
    return this.#loaders.getOrCreate(uuid, uuid => {
        const loader = new DefaultSampleLoader(uuid)
        this.#load(loader)
        return loader
    })
}
```

The first caller creates a loader and kicks off `#load()`. Subsequent callers for the same UUID get the same loader instance and observe the in-flight load. The set is keyed by UUID using `UUID.newSet`, which uses byte-level comparison (see [chapter 02](./02-box-system.md#what-is-a-box)).

### The load chain

`#load()` is the fallback ladder:

```typescript
// GlobalSampleLoaderManager.ts:116
#load(loader: DefaultSampleLoader): void {
    const {uuid} = loader
    // 1. Memory cache hit?
    const cached = this.#cache.opt(uuid)
    if (cached.nonEmpty()) {
        const {data, peaks, meta} = cached.unwrap()
        loader.setLoaded(data, peaks, meta)
        return
    }
    // 2. Already loading? Subscribe to the in-flight promise.
    const pending = this.#pending.opt(uuid)
    if (pending.nonEmpty()) {
        pending.unwrap().promise.then(() => {
            const cached = this.#cache.opt(uuid)
            if (cached.nonEmpty()) {
                const {data, peaks, meta} = cached.unwrap()
                loader.setLoaded(data, peaks, meta)
            }
        })
        return
    }
    // 3. Try OPFS. On failure, try the API.
    const promise = SampleStorage.get().load(uuid).then(
        ([data, peaks, meta]) => {
            this.#cache.add({uuid, data, peaks, meta})
            loader.setLoaded(data, peaks, meta)
        },
        () => this.#fetchFromApi(loader)
    ).catch(error => {
        loader.setError(error instanceof Error ? error.message : String(error))
    }).finally(() => this.#pending.removeByKey(uuid))
    this.#pending.add({uuid, promise})
}
```

So the cache hierarchy is:

```
in-memory #cache  →  hit: instant
       ↓ miss
   in-flight #pending  →  hit: piggyback
       ↓ miss
   SampleStorage (OPFS)  →  hit: load + cache
       ↓ miss
   #fetchFromApi (SampleProvider)  →  hit: fetch, generate peaks, save, cache
       ↓ miss
   setError
```

The `#pending` dedup matters more than you'd think: open a project that has thirty regions referencing the same long audio file, and you'd otherwise hit the storage thirty times concurrently. With `#pending`, the first call kicks off real I/O and the other twenty-nine wait for that one to resolve.

### Reference counting

```typescript
// GlobalSampleLoaderManager.ts:65
register(uuid: UUID.Bytes): Terminable {
    const current = this.#refCounts.opt(uuid)
    if (current.nonEmpty()) {
        current.unwrap().count++
    } else {
        this.#refCounts.add({uuid, count: 1})
    }
    return {
        terminate: () => {
            const ref = this.#refCounts.opt(uuid)
            if (ref.isEmpty()) {return}
            const {count} = ref.unwrap()
            if (count <= 1) {
                this.#refCounts.removeByKey(uuid)
                this.#loaders.removeByKeyIfExist(uuid)
                this.#cache.removeByKeyIfExist(uuid)
            } else {
                ref.unwrap().count--
            }
        }
    }
}
```

Adapters call `register(uuid)` when they wire up and `terminate()` when they tear down. When the last reference goes, the manager drops the cached audio and the loader. This is what keeps memory bounded — open and close enough projects and the cache stays roughly project-scoped.

This is also why `AudioFileBoxAdapter` has a `terminate()` ([chapter 02](./02-box-system.md#lifecycle)) — terminating the adapter is what decrements the ref count.

## Worklet-side: `SampleManagerWorklet`

The worklet doesn't keep peaks (they're a UI concern); it just needs the raw audio frames. Each worklet processor's first reference triggers an async fetch through the `EngineToClient.fetchAudio` RPC ([chapter 03](./03-cross-thread-protocols.md#fetchaudio--the-async-resource-pattern)):

```typescript
// SampleManagerWorklet.ts
class SampleLoaderWorklet implements SampleLoader {
    #data: Option<AudioData> = Option.None

    constructor(uuid: UUID.Bytes, engineToClient: EngineToClient) {
        engineToClient.fetchAudio(uuid).then(
            data => this.#data = Option.wrap(data),
            console.warn
        )
    }

    get data(): Option<AudioData> { return this.#data }
    get state(): SampleLoaderState { return {type: "idle"} }
}
```

A processor pattern that uses this looks like:

```typescript
processBlock(block: Block) {
    const optData = this.#sampleLoader.data
    if (optData.isEmpty()) { return }       // silence until the fetch resolves
    const data = optData.unwrap()
    // ... read frames, render audio ...
}
```

The "play silence while loading" pattern is everywhere in the playback processors. It's how the engine starts playing immediately on `play()` even when half the samples are still loading — instead of blocking until all are ready, it plays whatever's loaded and the rest come in one render quantum at a time as their fetches resolve.

If you need to *wait* until everything is loaded (e.g. before a deterministic offline export), call `engine.queryLoadingComplete()` — that resolves when the worklet's `#pendingResources` set is empty.

## `PeaksWriter` — live peaks during recording

Recording is a special case: there's no completed audio buffer to generate peaks from up front. `PeaksWriter` (`packages/studio/core/src/PeaksWriter.ts:5`) builds the peaks incrementally as the audio thread streams frames out via `RingBuffer` ([chapter 03](./03-cross-thread-protocols.md#ringbuffer--bulk-audio-transfer)):

```typescript
export class PeaksWriter implements Peaks, Peaks.Stage {
    readonly data: Array<Int32Array>       // one per channel
    readonly stages: ReadonlyArray<Peaks.Stage>
    readonly dataOffset: int = 0
    readonly shift: int = 7                // 128 samples per peak (RenderQuantum)
    readonly dataIndex: Int32Array

    append(frames: ReadonlyArray<Float32Array>): void {
        for (let channel = 0; channel < this.numChannels; ++channel) {
            const channelFrames = frames[channel]
            assert(channelFrames.length === RenderQuantum, "Invalid number of frames.")
            let min = Number.POSITIVE_INFINITY
            let max = Number.NEGATIVE_INFINITY
            for (let i = 0; i < RenderQuantum; ++i) {
                const frame = channelFrames[i]
                min = Math.min(frame, min)
                max = Math.max(frame, max)
            }
            const channelData = this.data[channel]
            channelData[this.dataIndex[channel]++] = SamplePeakWorker.pack(min, max)
            if (this.dataIndex[channel] === channelData.length) {
                const newArray = new Int32Array(channelData.length << 1)
                newArray.set(channelData, 0)
                this.data[channel] = newArray
            }
        }
    }
}
```

Two notable things:

1. **Single shift (7).** Live peaks are always at one zoom level — 128 samples per peak, the same as the audio worklet's render quantum. The UI shows the recording at one fixed zoom; when recording completes and the audio is finalized via `SampleService.importRecording`, the full multi-scale peaks are generated by `Workers.Peak.generateAsync` and replace these.
2. **Buffer doubles when full.** No fixed-size allocation. The `Int32Array` starts at `1 << 10 = 1024` peaks (about 2.9 seconds of audio at 48 kHz) and doubles every time it fills up. The cost is one allocation + memcpy per doubling, infrequent enough that it doesn't show up in profiles.

When the recording stops, `numFrames` is set and the writer is read like any other `Peaks` for display until the bulk regeneration finishes.

## Transient detection

`AudioFileBox` has a `transientMarkers` field that holds onset positions (kick/snare hits, note starts). Detection runs through `Workers.Transients.detect()`:

```typescript
// packages/lib/dsp/src/transient-protocol.ts
export interface TransientProtocol {
    detect(audioData: AudioData): Promise<Array<number>>
}
```

Returns an array of times in seconds. The implementation (`TransientDetector.detect()` in `packages/lib/dsp/src/transient-detection.ts`) splits the audio into three frequency bands using 48th-order Linkwitz-Riley filters, computes per-band energy envelopes, detects onset peaks weighted by band (low: ×1, mid: ×4, high: ×8), refines to local energy minima, and enforces a 120 ms minimum spacing (capped at 40 transients per second).

Detection is triggered explicitly via `AudioFileBoxFactory.createModifier()` when an audio file is dropped onto the timeline. The factory checks whether transients have already been detected for this file (the `transientMarkers` field is non-empty) and skips re-detection if so. Transients aren't computed for samples that never touch the timeline (e.g. drag into the browser pane but no track), so the cost is opt-in.

## End-to-end: drag-and-drop a `.wav`

The full call stack when you drop a WAV onto an audio track:

1. **UI event** (`packages/app/studio/src/ui/timeline/tracks/audio-unit/TimelineDragAndDrop.ts`) — `drop` event, `file.arrayBuffer()` reads the bytes.
2. **`SampleService.importFile()`** — runs the decode + peaks + storage save described above. Returns a `Sample` (metadata) and notifies subscribers.
3. **`AudioFileBoxFactory.createModifier()`** — if transients are wanted, calls `Workers.Transients.detect()`. Returns a `Provider<AudioFileBox>` that constructs the box inside an `editing.modify()` transaction.
4. **The editing transaction** — creates the `AudioFileBox` with the right UUID, `fileName`, `endInSeconds`, and any `TransientMarkerBox` children. Creates the `AudioRegionBox` that points at it via `box.file.refer(audioFileBox)`.
5. **`AudioRegionBoxAdapter`** — picks up the new box on the next animation frame, subscribes to its `file` pointer, asks `GlobalSampleLoaderManager.register(uuid)` to retain it.
6. **`GlobalSampleLoaderManager.#load()`** — sees the new request, hits the `#cache` (the sample we just imported is already cached), calls `loader.setLoaded()`. Adapters subscribed to the loader see the loaded state and can now request `loader.peaks` for rendering.
7. **First playback** — the worklet's `AudioRegionProcessor` creates a `SampleLoaderWorklet`, which calls `engineToClient.fetchAudio(uuid)`. The main thread's `fetchAudio` handler awaits the loader's `"loaded"` state and resolves with the `AudioData`. The worklet's `#data` becomes non-empty, and the next render quantum starts producing audio.

By design no step requires user-perceptible blocking. Each handoff is async and the UI never freezes — the slowest single operation (peaks generation for a 30-minute file) takes a couple of seconds and runs entirely off the main thread.

## Adding a new sample source

The pluggable bit is `SampleProvider` (`packages/studio/core/src/samples/SampleProvider.ts`). Its one method:

```typescript
interface SampleProvider {
    fetch(uuid: UUID.Bytes, progress: Progress.Handler): Promise<[AudioData, SampleMetaData]>
}
```

`GlobalSampleLoaderManager` calls this when both the in-memory cache and OPFS miss. To plug in a new source (Freesound, your own CDN, etc.):

1. Implement `SampleProvider.fetch(uuid, progress)`. Resolve with `[AudioData, SampleMetaData]` when found; reject with an `Error` when not.
2. Pass your provider when constructing `GlobalSampleLoaderManager`: `new GlobalSampleLoaderManager(myProvider)`. Or wrap an existing one to chain fallbacks: `(uuid, p) => primary.fetch(uuid, p).catch(() => secondary.fetch(uuid, p))`.
3. That's it. The cache + ref counting + dedup behaviour all stays. If your provider is slow, advance the `progress` handler so UIs can show a meaningful spinner.

The built-in `OpenSampleAPI` (`packages/studio/core/src/samples/OpenSampleAPI.ts`) is a working example — it serves the stock samples that ship with openDAW Studio.

To add a new *kind* of sample (say, a SoundFont preset), look at how `SoundfontLoaderManager` mirrors `GlobalSampleLoaderManager` instead — different resource, same shape.

## Errors and edge cases

| Scenario | Behaviour |
|---|---|
| Both decoders fail | `importFile()` rejects with `"Could not decode audio file"`. UI shows error toast; nothing written to storage. |
| `audio.wav` corrupt on load | `SampleStorage.load()` rejects; manager falls through to `#fetchFromApi()`. If API also fails, loader → `"error"`. |
| `peaks.bin` corrupt on load | `#readOrRegeneratePeaks()` regenerates from the still-valid audio; UI sees a one-time peaks recompute. |
| Same UUID imported twice in parallel | `#pending` dedup: the second request `then`s on the first's promise. One decode, one storage write. |
| Sample referenced but missing from OPFS | Cache miss → storage rejects → API tried → if API rejects, loader → `"error"`. Processors that needed the data play silence (`optData.isEmpty()` branch). |
| `register()` mismatched with `terminate()` | Refcount underflow is silently ignored (the `ref.isEmpty()` check). Refcount overflow keeps memory alive longer than expected. Audit balance in your code. |
| Recording stops mid-clip | `PeaksWriter`'s `numFrames` is set to the final frame count. The unfilled tail of the auto-growing `Int32Array` is past `numPeaks`, never read. No truncation needed. |

## Critical invariants

1. **UUID is the only identity.** Two `AudioFileBox`es with the same UUID *must* refer to the same audio. The whole pipeline assumes content-addressed equality.
2. **Storage writes are atomic per-file, not per-sample.** If you crash between the three `Workers.Opfs.write` calls in `save()`, you'll have an inconsistent sample on disk. The corruption-recovery code handles this for peaks; for audio it surfaces as an error.
3. **Don't bypass `getOrCreate()`.** Creating a `DefaultSampleLoader` directly defeats dedup, ref counting, and cache hits.
4. **The worklet only ever needs `data`.** Peaks are a main-thread (UI) concern. If you're adding a feature on the worklet that needs peaks, you have an architecture mistake.
5. **`SampleLoaderState` is monotonic per load.** Once `loaded`, never goes back to `progress` (unless you explicitly `invalidate()`). Subscribers can rely on this.
6. **`register(uuid).terminate()` is paired.** Forgetting `terminate` leaks the cached audio. Adapters' `Terminator` patterns are the safe idiom — `terminator.own(manager.register(uuid))` couples lifetime correctly.
7. **`progress` is `unitValue` (0–1).** Outside that range, UI progress bars look ridiculous; the type doesn't enforce it but the manager always passes 0–1.
8. **`Workers.Peak.generateAsync` shape is in/out, no streaming.** All frames must be in memory before you call it. For very long files (> a few minutes), this is fine because `AudioData` is already in memory anyway.

## Further reading

- **`packages/studio/core/src/samples/OpenSampleAPI.ts`** — the bundled stock-sample provider. Shortest possible `SampleProvider` implementation; read it before writing your own.
- **`packages/studio/core/src/samples/SampleProvider.ts`** — the one-method interface contract.
- **`packages/lib/fusion/src/peaks/`** — `Peaks.ts`, `SamplePeakWorker.ts`, `SamplePeakProtocol.ts`, `PeaksPainter.ts`. The full peaks-format spec, the worker implementation, and the canvas renderer.
- **`packages/lib/dsp/src/transient-detection.ts`** — the onset detector algorithm. Standalone, no dependencies on the rest of the SDK.
- **`packages/studio/core/src/Storage.ts`** — the generic OPFS-backed storage base class that `SampleStorage` extends. Same pattern is reused for projects and presets.
- **[Ch. 03 — Cross-Thread Protocols](./03-cross-thread-protocols.md)** — for `Workers.Peak`, `Workers.Opfs`, `Workers.Transients` and `EngineToClient.fetchAudio` mechanics.
- **[Ch. 02 — Box System](./02-box-system.md)** — for how `AudioFileBox` and the adapter layer fit into the graph.
