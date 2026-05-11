# OpenDAW SDK Changelog: 0.0.139 → 0.0.140

A small, targeted release: one behaviour revert in the audio capture path and
one one-liner selection bug fix. No API surface change.

## Behaviour Changes

### Audio Device Selection Reverts to `{exact}` (with Fallback)

`CaptureAudio.#updateStream()` flipped back from `{ideal: deviceId}` to
`{exact: deviceId}` — but wraps the `requestStream(...)` call in a `.catch(...)`
that retries without the deviceId constraint when the exact device is gone.
The function is also rewritten with `async/await` instead of nested `.then(...)`.

Effective behaviour:

| Scenario | 0.0.138 | 0.0.139 | 0.0.140 |
|----------|---------|---------|---------|
| Requested device available | Returns that exact device | Browser **may** silently substitute | Returns that exact device |
| Requested device gone | Throws via `Errors.warn` | `console.warn`, browser substitutes | `console.warn`, retry without deviceId → default input |
| `selectedDeviceId === activeDeviceId` after stream? | Yes (when available) | **Not guaranteed** | Yes (when available) |

The two-call retry path also drops the post-hoc `if (deviceId !== gotDeviceId)`
mismatch check — it's no longer reachable, since either getUserMedia honoured
the `{exact}` request or the fallback call had no deviceId constraint at all.

**Migration:** The 0.0.139 migration advice ("read `MediaStreamTrack.getSettings().deviceId`
after stream acquisition because the browser may substitute silently") no longer
applies. Selected deviceId now matches the active deviceId whenever the device
is present.

**This project's impact:** None at the code level — our `RecordingTapeCard` and
`useRecordingTapes` flow never depended on the silent-substitution behaviour;
we read `captureBox.deviceId` (the *requested* id, not the stream's actual
settings) when showing the dropdown value. The user-visible change is that
"selected device" now reliably reflects what's actually capturing.

## Bug Fixes

### VertexSelection Skips Detached Vertices (#934)

`VertexSelection.select(selectables)` now guards against vertices that have
already been detached from the box graph:

```typescript
for (const selectable of selectables) {
    if (!selectable.isAttached()) {continue}  // ← new
    if (!this.#selectableMap.hasKey(selectable.address)) {
        SelectionBox.create(...)
    }
}
```

Without this, attempting to create a `SelectionBox` referring to a freed
vertex address would crash inside `boxGraph.findBox(address)` / pointer-refer.

**This project's impact:** None — we don't use `VertexSelection` directly
(no selection UI in the demos). Anything that selects via the studio UI in
the upstream app benefits, but our demos sidestep this code path entirely.

## App-Internal Changes (Not in SDK)

For completeness — these ship in `@opendaw/app-studio`, which we do **not**
depend on. They are not part of the SDK surface:

- `fixes #246`: CodeEditorPage and ShadertoyEditor CSS/markup tweaks.
- `adds optimisation test`: new `SampleReadBenchmark` / `SampleReadRunner` /
  `sample-read-worker` and a `SampleReadPage` route inside the studio app
  for benchmarking sample-read paths against a synthetic workload.

## Library Bumps

Transitive package versions resolved by `^0.0.140` of `@opendaw/studio-sdk`.
All sub-packages got a version bump via Lerna at publish time, but only
`@opendaw/studio-core` (CaptureAudio fix) and `@opendaw/studio-adapters`
(VertexSelection fix) ship real diffs. The rest are pure dependency churn.

| Package | Range |
|---------|-------|
| `@opendaw/lib-box` | `^0.0.84` |
| `@opendaw/lib-dawproject` | `^0.0.68` |
| `@opendaw/lib-dom` | `^0.0.81` |
| `@opendaw/lib-dsp` | `^0.0.82` |
| `@opendaw/lib-fusion` | `^0.0.91` |
| `@opendaw/lib-jsx` | `^0.0.81` |
| `@opendaw/lib-midi` | `^0.0.64` |
| `@opendaw/lib-runtime` | `^0.0.77` |
| `@opendaw/lib-std` | `^0.0.76` |
| `@opendaw/lib-xml` | `^0.0.62` |
| `@opendaw/studio-adapters` | `^0.0.107` |
| `@opendaw/studio-boxes` | `^0.0.89` |
| `@opendaw/studio-core` | `^0.0.138` |
| `@opendaw/studio-enums` | `^0.0.73` |

## Files Changed (SDK Source)

```
packages/studio/core/src/capture/CaptureAudio.ts             # exact + fallback rewrite
packages/studio/adapters/src/selection/VertexSelection.ts    # isAttached() guard
packages/studio/sdk/src/version.ts                           # 0.0.139 → 0.0.140
```
