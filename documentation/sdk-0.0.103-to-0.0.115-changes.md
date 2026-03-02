# OpenDAW SDK Changes: 0.0.103 → 0.0.115

## Summary

No breaking changes affect our demos. All changes are additive, internal renames hidden behind abstractions, or new features we don't use.

---

## 1. Property Renames (Project)

**`masterBusBox` → `primaryAudioBusBox`**
**`masterAudioUnit` → `primaryAudioUnitBox`**

On the `Project` class:
```typescript
// Old (0.0.103)
project.masterBusBox    // AudioBusBox
project.masterAudioUnit // AudioUnitBox

// New (0.0.115)
project.primaryAudioBusBox  // AudioBusBox
project.primaryAudioUnitBox // AudioUnitBox
```

`ProjectMandatoryBoxes` type also renamed:
```typescript
// Old
{ primaryAudioBus: AudioBusBox, primaryAudioOutputUnit: AudioUnitBox }

// New
{ primaryAudioBusBox: AudioBusBox, primaryAudioUnitBox: AudioUnitBox }
```

**Demo impact:** None. Our demos pass `project.skeleton` as an opaque object to `AudioBusFactory.create()` and `AudioUnitFactory.create()`, which destructure the fields internally.

New getter added: `project.primaryAudioUnitBoxAdapter` (convenience accessor).

---

## 2. AudioUnit Freeze (New Feature)

New `AudioUnitFreeze` class exported from `@opendaw/studio-core`.

- `project.audioUnitFreeze` — manages frozen state per audio unit
- `engine.setFrozenAudio(uuid, audioData)` — loads frozen audio for an audio unit
- `CaptureDevices.setArm()` and `filterArmed()` now skip frozen tracks
- `MidiDeviceChain` skips wiring for frozen units
- New `FrozenPlaybackProcessor` plays back pre-rendered audio in place of live processing

**Demo impact:** None. Purely additive feature.

---

## 3. `allowTakes` Default Changed

```typescript
// Old (0.0.103) — only true on localhost/dev
allowTakes: isDevOrLocalhost

// New (0.0.115) — always true
allowTakes: true
```

**Demo impact:** None. Our loop recording demo already explicitly sets `settings.recording.allowTakes = true`.

---

## 4. RecordAutomation Rewrite

Major refactor of `RecordAutomation.start()`:

- Now loop-aware: creates new automation regions at loop boundaries
- Uses quantized positions (`quantizeFloor`/`quantizeCeil` to `PPQN.SemiQuaver`)
- Adds `Interpolation.Linear` or `Interpolation.None` based on `valueMapping.floating()`
- Includes event simplification (removes collinear points within epsilon 0.01)
- Deselects regions before recording into tracks
- `parameterFieldAdapters.notifyWrite()` now passes `previousUnitValue` for initial event creation

**Demo impact:** None. This is internal to `project.startRecording()` / `project.stopRecording()`.

---

## 5. `project.stopRecording()` Now Marks Undo

```typescript
// Old
stopRecording(): void { this.engine.stopRecording() }

// New
stopRecording(): void {
    this.engine.stopRecording()
    this.editing.mark() // adds undo checkpoint
}
```

New method: `project.isRecording()` — returns `Recording.isRecording` boolean.

**Demo impact:** None. Additive behavior improvement.

---

## 6. `createTrackRegion` Return Type Change

```typescript
// Old
createTrackRegion(trackBox, position, duration, options?): void

// New
createTrackRegion(trackBox, position, duration, options?): Option<AnyRegionBox>
// Returns Option.None if duration <= 0
```

**Demo impact:** None. Our demos don't call this method directly.

---

## 7. Region Selection API

New `project.regionSelection` — `FilteredSelection<AnyRegionBoxAdapter>` for selecting/deselecting regions.

Used internally by `RecordAutomation` to deselect regions before recording and by `Recording.start()` to deselect armed track regions.

**Demo impact:** None. Additive API.

---

## 8. Base Frequency Support

New `RootBox` field: `base-frequency` (Float32, 400-480 Hz, default 440.0).

`VaporisateurDeviceProcessor.computeFrequency()` now uses `context.baseFrequency` instead of hardcoded `440.0`.

New adapter: `BaseFrequencyRange = {min: 400, max: 480, default: 440.0}`.

New studio setting: `"base-frequency": boolean` (default `false`) — toggles UI visibility.

**Demo impact:** None. Default is 440.0, matching previous behavior.

---

## 9. Export Stems: `skipChannelStrip` Option

```typescript
// ExportStemConfiguration gained optional field
type ExportStemConfiguration = {
    includeAudioEffects: boolean
    includeSends: boolean
    useInstrumentOutput: boolean
    skipChannelStrip?: boolean  // NEW — defaults to false
    fileName: string
}
```

Used by `AudioDeviceChain` to bypass the channel strip when exporting stems.

**Demo impact:** None. Optional field, our exports don't set it.

---

## 10. Box Schema Changes

| Box | Change |
|-----|--------|
| `RootBox` | Added `base-frequency` field (Float32, default 440.0) |
| `MetaDataBox` | `value` field now defaults to `"{}"` (JSON string) |
| `NoteEventCollectionBox` | Added `resource: "shared"` |
| `ValueEventCollectionBox` | Added `resource: "shared"` |
| `VelocityDeviceBox` | Added `pointerRules: ParameterPointerRules` to `random-seed` field |

**Demo impact:** None. All additive or internal.

---

## 11. Other Internal Changes

- `AudioDeviceChain` — new frozen audio wiring path, `skipChannelStrip` path, `setPreChannelStripSource`
- `AudioUnit` — `frozen` getter, `setFrozenAudio()`, `skipChannelStrip` getter, `setPreChannelStripSource()`
- `AudioUnitOptions` — added `skipChannelStrip: boolean` (default false)
- `EngineContext` — added `baseFrequency` getter
- Canvas/renderer utilities moved to SDK (`capturing.ts`, `painter.ts`, `scale.ts`, `audio.ts`, `fading.ts`, `notes.ts`, `value.ts`)
- `RegionClipResolver` — refactored from class-based to functional, signature changes
- `RegionOverlapResolver` — internal refactoring
- `SampleService` / `AssetService` — internal changes
- `ProjectUtils` — removed (was used for clipboard copy operations)
- `polyfill.ts` — new file added

---

## Version Map

| Package | 0.0.103 | 0.0.115 |
|---------|---------|---------|
| studio-sdk | 0.0.103 | 0.0.115 |
| studio-core | ~0.0.85 | ~0.0.94 |
| studio-adapters | ~0.0.82 | ~0.0.91 |
| studio-boxes | 0.0.74 | 0.0.78 |
| studio-core-processors | 0.0.85 | 0.0.94 |
| studio-enums | 0.0.63 | 0.0.66 |
| lib-box | 0.0.72 | 0.0.75 |
| lib-dsp | 0.0.71 | 0.0.74 |
| lib-std | 0.0.68 | 0.0.70 |
| lib-runtime | 0.0.69 | 0.0.71 |
