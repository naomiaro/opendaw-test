# DRAFT — not posted. For review before filing on andremichelle/openDAW.

**Title:** `ProjectApi.createNoteRegion` never writes its `loopOffset` parameter

## Symptom

`project.api.createNoteRegion({ …, loopOffset: 960, loopDuration: 1920 })` produces a
`NoteRegionBox` whose `loopOffset` field is still 0. The parameter is accepted by
`NoteRegionParams` and documented as the region's loop offset, but the box keeps its default.

## Cause (`packages/studio/core/src/project/ProjectApi.ts`, same on 0.0.170 and 0.0.172)

```ts
box.duration.setValue(duration)
box.loopDuration.setValue(loopOffset ?? 0)        // writes loopOffset into loopDuration …
box.loopDuration.setValue(loopDuration ?? duration) // … then overwrites it
```

`box.loopOffset` is never assigned. Verified in the published
`@opendaw/studio-core@0.2.6` (`dist/project/ProjectApi.js`).

## Repro

```ts
const region = project.editing.modify(() => project.api.createNoteRegion({
  trackBox, position: 0, duration: 3840, loopOffset: 960, loopDuration: 1920
})).unwrap()
console.log(region.loopOffset.getValue(), region.loopDuration.getValue()) // 0 1920 — expected 960 1920
```
