# OpenDAW SDK Changes: 0.0.115 → 0.0.119

## Summary

Four functional commits between these versions: a soundfont manager rename (breaking), a
recording alignment fix, region type guard additions, and AudioConsolidation moved to the SDK.

**Breaking change:** `DefaultSoundfontLoaderManager` renamed to `GlobalSoundfontLoaderManager`.
Same constructor, same interface — just a name change. See Section 1.

---

## 1. `DefaultSoundfontLoaderManager` → `GlobalSoundfontLoaderManager`

**File renamed:** `DefaultSoundfontLoaderManager.ts` → `GlobalSoundfontLoaderManager.ts`

```typescript
// Old (0.0.115)
import { DefaultSoundfontLoaderManager } from "@opendaw/studio-core";
const soundfontManager = new DefaultSoundfontLoaderManager(soundfontProvider);

// New (0.0.119)
import { GlobalSoundfontLoaderManager } from "@opendaw/studio-core";
const soundfontManager = new GlobalSoundfontLoaderManager(soundfontProvider);
```

The constructor signature is identical — takes a `SoundfontProvider`. The class implements
the same `SoundfontLoaderManager` and `SoundfontProvider` interfaces. `DefaultSoundfontLoader`
(the per-UUID loader) was NOT renamed, only its manager class.

**Demo impact:** `src/lib/projectSetup.ts` updated import and usage on lines 9 and 181.

---

## 2. Recording Alignment Fix ("fixes miss-aligned recording")

Two changes fix recordings that start while the engine is already playing (e.g., punch-in):

### 2a. `Recording.start()` — Count-In Guard

```typescript
// Old (0.0.115)
this.#instance = Option.wrap(new Recording(countIn, engine.position.getValue()))

// New (0.0.119)
this.#instance = Option.wrap(new Recording(countIn && !engine.isPlaying.getValue(), engine.position.getValue()))
```

If `engine.isPlaying` is already true when recording starts, `countIn` is forced to `false`.
This prevents count-in logic from firing during punch-in recording (where the transport is
already running).

### 2b. `RecordAudio` — Centralized Count-In Tracking

```typescript
// Old (0.0.115) — local variable tracked count-in state
let hadCountIn: boolean = false
// ... later in position subscription:
if (isCountingIn) {
    hadCountIn = true
    return
}
const waveformOffset = hadCountIn ? preRecordingSeconds : outputLatency
const position = quantizeFloor(currentPosition, beats)

// New (0.0.119) — uses Recording singleton
// hadCountIn removed, replaced by:
if (isCountingIn) {return}
const countedIn = Recording.wasCountingIn()
const waveformOffset = countedIn ? preRecordingSeconds : outputLatency
const position = countedIn ? quantizeFloor(currentPosition, beats) : currentPosition
```

Key behavioral changes:
- Count-in state is now read from `Recording.wasCountingIn()` (static singleton) instead of
  a local `hadCountIn` flag
- Position quantization (`quantizeFloor`) is now **conditional** — only applied when count-in
  was used. Without count-in, the raw `currentPosition` is used directly. This fixes recording
  regions starting at the wrong position during punch-in

**Demo impact:** None. These are internal to `startRecording()`. Our demos don't use punch-in
recording (they always start from a stopped state).

---

## 3. Region Type Guards (New API)

`RegionBoxAdapter` interface gained three type guard methods:

```typescript
interface RegionBoxAdapter<CONTENT> {
    // ... existing members ...

    isAudioRegion(): this is AudioRegionBoxAdapter  // NEW
    isNoteRegion(): this is NoteRegionBoxAdapter    // NEW
    isValueRegion(): this is ValueRegionBoxAdapter  // NEW
}
```

Each region adapter class implements these (returns `true` for its own type, `false` for
others). This replaces `instanceof` checks with type-safe discriminators.

**Demo impact:** None. Additive API. Useful for future code that processes mixed region types.

---

## 4. AudioConsolidation (Moved to SDK)

`AudioConsolidation` was moved from the app layer to `@opendaw/studio-core` and is now
a public export.

```typescript
import { AudioConsolidation } from "@opendaw/studio-core";

// Flatten multiple audio regions into a single region
await AudioConsolidation.flatten(project, sampleService, selectedRegions, abortSignal?);
```

Internally, it:
1. Copies the project
2. Deletes non-selected regions in the range
3. Renders offline via `OfflineEngineRenderer`
4. Creates a new `AudioFileBox` with the rendered audio
5. Replaces selected regions with a single merged region

**Demo impact:** None. New feature we don't use.

---

## 5. OPFS `exists()` Method (New API)

New method on `OpfsProtocol` and related classes:

```typescript
// OpfsProtocol interface
exists(path: string): Promise<boolean>

// SampleStorage convenience wrapper
SampleStorage.exists(uuid: UUID.Bytes): Promise<boolean>

// Workers proxy
Workers.Opfs.exists(path: string): Promise<boolean>
```

Returns `true` if the file exists and has size > 0, `false` if empty. Throws if path
doesn't exist or is a directory.

**Demo impact:** None. Internal storage API.

---

## 6. BoxGraph JSON Error Handling

```typescript
// Old (0.0.115)
this.createBox(name, UUID.parse(uuid), box => box.fromJSON(fields))

// New (0.0.119)
this.createBox(name, UUID.parse(uuid), box => {
    try {
        box.fromJSON(fields)
    } catch (reason: unknown) {
        console.warn(reason)
    }
})
```

`BoxGraph.fromJSON()` now catches and warns on per-box deserialization errors instead of
throwing. This makes project loading more resilient to corrupt or partially invalid data.

**Demo impact:** None. Internal resilience improvement.

---

## 7. `NotesRenderer.render()` Signature Change

```typescript
// Old (0.0.115)
NotesRenderer.render(context, range, region: NoteRegionBoxAdapter, bound, contentColor, cycle)

// New (0.0.119)
NotesRenderer.render(context, range, collection: NoteEventCollectionBoxAdapter, bound, contentColor, cycle)
```

The third parameter changed from `NoteRegionBoxAdapter` to `NoteEventCollectionBoxAdapter`.
Callers now pass the collection directly (`region.optCollection.unwrap()`) instead of the
region wrapper.

**Demo impact:** None. Our demos don't use `NotesRenderer` directly.

---

## 8. MetaData.store Type Widening

```typescript
// Old (0.0.115)
MetaData.store(target: Box<Pointers.MetaData>, value, origin)

// New (0.0.119)
MetaData.store(target: Box<Pointers.MetaData | Pointers>, value, origin)
```

The `target` parameter now accepts boxes with either `Pointers.MetaData` or the broader
`Pointers` type, matching the existing `MetaData.read()` signature.

**Demo impact:** None. Additive type widening.

---

## 9. Internal Annotations

`@internal` JSDoc tags added to several `dispatchChange()` methods:
- `MarkerTrackAdapter.dispatchChange()`
- `TrackClips.dispatchChange()`
- `TrackRegions.dispatchChange()` and `TrackRegions.terminate()`

Comment style in `LoopableRegion.LoopCycle` changed from `//` to `/* */` block comments.

**Demo impact:** None. Documentation-only changes.

---

## Version Map

| Package | 0.0.115 | 0.0.119 |
|---------|---------|---------|
| studio-sdk | 0.0.115 | 0.0.119 |
| studio-core | ~0.0.94 | 0.0.117 |
| studio-adapters | ~0.0.91 | 0.0.94 |
| studio-boxes | 0.0.78 | 0.0.80 |
| studio-enums | 0.0.66 | 0.0.66 |
| lib-box | 0.0.75 | 0.0.76 |
| lib-dsp | 0.0.74 | 0.0.75 |
| lib-std | 0.0.70 | 0.0.70 |
| lib-runtime | 0.0.71 | 0.0.71 |
| lib-dom | 0.0.75 | 0.0.75 |
| lib-fusion | 0.0.82 | 0.0.82 |
