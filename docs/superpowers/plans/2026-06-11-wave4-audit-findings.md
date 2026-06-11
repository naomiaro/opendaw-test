# Wave-4 Automation Demo Audit — Findings (working file)

Tag-pinned source audit for `src/demos/automation/` (tempo-automation, time-signature,
track-automation), the category CLAUDE.md, and the exercised doc-chapter claims.

**Method:** all upstream reads via `git -C /Users/naomiaro/Code/openDAW show "<tag>:<path>"`.
Installed versions confirmed to match tags: studio-sdk@0.0.154 → studio-adapters@0.0.116,
studio-core@0.0.152, studio-boxes@0.0.94, lib-dsp@0.0.84, lib-std@0.0.78, lib-box@0.0.86,
studio-enums@0.0.77. Citations below use `<tag>:<path>:<line-or-anchor>`.

## Verdict summary

| # | Claim | Verdict |
|---|-------|---------|
| 1 | Engine tempo map honors Curve interpolation; canvas matches | NUANCED — curve honored, canvas math exact; playback-time integration quantized to the 80-PPQN TempoChangeGrid |
| 2 | Delete+create tempo events in ONE `editing.modify()` is safe | CONFIRMED safe — no restructure of `applyPattern` needed |
| 3 | `signatureTrack.deleteAdapter(a)` is the right deletion idiom | CONFIRMED (demo's reverse-order `box.delete()` is equivalent for clear-all only) |
| 4 | `durationInPulses` + `loopArea` fields on TimelineBox | CONFIRMED (both Int32 / Int32 from+to) |
| 5 | Pan unitValue 0→L, 0.5→C, 1→R | CONFIRMED (`ValueMapping.bipolar()`, anchor 0.5) |
| 6 | Reverb wet/dry use `DefaultDecibel` | CONFIRMED mapping; WRONG label — "50%" is actually −12 dB |
| 7 | `VolumeMapper` = decibel(−96,−9,+6); `.x(0)` ≈ 0.734 | CONFIRMED (0.73394…) |
| 8 | `createTrackRegion` returns `Option<AnyRegionBox>`; cast required | CONFIRMED |
| 9 | `createAutomationTrack(audioUnitBox, field)` → `TrackBox` | CONFIRMED (3rd optional `insertIndex` param) |
| 10 | Same `(position,index)` panics; no preset hits it | CONFIRMED (panic exists; all presets have distinct positions) |
| 11 | `Curve.normalizedAt` formula + slope semantics | CONFIRMED |
| 12 | `PPQN.fromSignature` = `Math.floor(3840/denom)*nom` | CONFIRMED |
| 13 | `LoopableRegion.globalToLocal` formula | CONFIRMED |
| 14 | `event.box.delete()` for tempo/value events | CONFIRMED — REQUIRED for curve events (cascade deletes `ValueEventCurveBox`) |
| — | API sweep (CLAUDE.md lines 93–185) | 3 deviations, all WRONG: reset() wording and valueAt position space (detailed in the sweep section); unstageBox idiom (detailed under claim 14) |

---

### 1. Tempo curve interpolation — engine honors `Interpolation.Curve` [tempo-automation] [claude-md]

`VaryingTempoMap` lives in **studio-adapters** (not lib-dsp).
`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/VaryingTempoMap.ts` —
`TempoGridCursor.#bpmAt()` handles all three interpolation types; for curve:

```ts
const {m, q} = Curve.coefficients({slope: interpolation.slope, steps: (b.position - a.position) / TempoChangeGrid, y0: a.value, y1: b.value})
...
return this.#lastBpm = Curve.valueAt({slope: interpolation.slope, steps: b.position - a.position, y0: a.value, y1: b.value}, position - a.position)
```

`Curve.valueAt` is defined as `normalizedAt(x / steps, slope) * (y1 - y0) + y0`
(`@opendaw/lib-std@0.0.78:packages/lib/std/src/curve.ts:23-24`). So the demo canvas,
which plots `prevY + Curve.normalizedAt(t, slope) * (y - prevY)`
(`tempo-automation-demo.tsx:228-233`), is mathematically identical to the engine's curve.

`getTempoAt(position)` returns `collection.valueAt(position, storageBpm)` →
`ValueEvent.valueAt` → `interpolate()` which also uses `Curve.valueAt`
(`@opendaw/lib-dsp@0.0.84:packages/lib/dsp/src/value.ts`, `interpolate`).

**Nuance:** for PPQN↔seconds *integration* the tempo map steps the
`TempoChangeGrid` = `PPQN.fromSignature(1, 48)` = **80 PPQN** (~10 ms) as a step
function "matching BlockRenderer" (class docstring + 
`@opendaw/lib-dsp@0.0.84:packages/lib/dsp/src/constants.ts:4`). Sub-80-PPQN tempo
detail is quantized in actual playback timing; visually irrelevant at demo scale.

Wiring: `TimelineBoxAdapter.tempoTrackEvents` is a
`MutableObservableOption<ValueEventCollectionBoxAdapter>` fed by
`box.tempoTrack.events.catchupAndSubscribe(...)`
(`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/TimelineBoxAdapter.ts:41-56`).
`#resolveTempoAutomation()` returns `Option.None` when `tempoTrack.enabled` is false or
no events exist — schema default for `enabled` is `true`
(`@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/TimelineBox.ts`, tempo-track field 20).

**Verdict:** NUANCED — engine honors Curve via `Curve.valueAt`/`normalizedAt` and the
canvas math matches exactly, but playback-time integration is quantized to the 80-PPQN
TempoChangeGrid (sub-grid tempo detail is stepped, not continuous). No demo change
needed. Graduation: add the TempoChangeGrid quantization note to the category
CLAUDE.md tempo section (doc 02 makes no contrary claim — it never mentions grid
resolution — so no doc edit).

### 2. Delete + create tempo events in ONE `editing.modify()` [tempo-automation] [claude-md]

`ValueEventCollectionBoxAdapter.createEvent`
(`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/collection/ValueEventCollectionBoxAdapter.ts`):

```ts
const existing = this.#adapters.values().find(event => event.position === intPosition && event.index === index)
// the adapters might be out of sync until the current transaction ends. Therefore, we check with isAttached.
if (isDefined(existing) && existing.box.isAttached()) { ...update existing... }
```

- The SDK *explicitly designed* this method for in-transaction staleness: the cached
  `#adapters` set is stale (pointerHub notifications are deferred), but
  `isAttached()` reads live graph state — `graph.findBox(uuid).nonEmpty()`
  (`@opendaw/lib-box@0.0.86:packages/lib/box/src/box.ts:122`), and `unstageBox`
  removes from `#boxes` synchronously within the transaction
  (`graph.ts`, `unstageBox`). So a deleted-then-recreated event at the same
  `(position, index)` correctly creates a fresh box.
- No comparator panic at flush: pointerHub `onRemoved`/`onAdded` dispatch at
  `#finalizeTransaction()` sorted by chronological state-entry index
  (`@opendaw/lib-box@0.0.86:packages/lib/box/src/graph.ts`, `#finalizeTransaction`).
  Deletions (executed first in `applyPattern`) register state entries before
  creations (whose pointer updates are deferred via `#constructingBox` and only
  prepared at `endTransaction`), so the old adapter leaves the `EventCollection`
  before the new one enters — the two never co-exist during a sort.
- This contrasts with `SignatureTrackAdapter.createEvent`, which computes
  `relativePosition`/indices from `iterateAll()` over the stale
  `IndexedBoxAdapterCollection` with **no** isAttached-style guard
  (`SignatureTrackAdapter.ts`, `createEvent`) — the one-modify-per-event rule is
  signature-track-specific and remains correct.

**Verdict:** CONFIRMED safe — `applyPattern` (`tempo-automation-demo.tsx:96-129`) does
NOT need restructuring. The category CLAUDE.md is correct to scope the
one-modify-per-event rule to the signature track only. Graduation: Task 8 should ADD
a positive directive to the category CLAUDE.md — single-transaction delete+create is
safe for `ValueEventCollectionBoxAdapter` (the `isAttached()` guard is by design);
one-modify-per-event stays signature-track-only.

### 3. Signature event deletion idiom [time-signature] [claude-md]

`SignatureTrackAdapter.deleteAdapter(adapter)` exists at
`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/timeline/SignatureTrackAdapter.ts`
(method `deleteAdapter`). Beyond `adapter.box.delete()` it **recalculates
`relativePosition` for every event after the deleted one** so their absolute PPQN
positions are preserved (positions are stored bar-relative to the previous event —
`SignatureEventBox.relative-position`, unit "bars",
`@opendaw/studio-boxes@0.0.94:.../schema/std/timeline/SignatureEventBox.ts`).

Bare `box.delete()` on a middle event shifts all subsequent events earlier. The demo
(`time-signature-demo.tsx:86-91`) deletes ALL events in reverse order (last first),
each in its own transaction — the last event never has successors, so this is
functionally equivalent for a full clear. Still, the prescribed helper is the right
general idiom and the demo should use it for consistency:
`signatureTrack.adapterAt(e.index).ifSome(a => signatureTrack.deleteAdapter(a))`.

**Verdict:** CONFIRMED — `deleteAdapter` exists and preserves successor positions;
CLAUDE.md line 15 is correct. Demo's reverse-order `box.delete()` clear-all is
functionally equivalent but should switch to `deleteAdapter` (low-risk consistency fix).

### 4. `durationInPulses` + `loopArea` on TimelineBox [tempo-automation] [time-signature]

Schema at `@opendaw/studio-boxes@0.0.94:packages/studio/forge-boxes/src/schema/std/timeline/TimelineBox.ts`:
- field 30: `{type: "int32", name: "durationInPulses", value: PPQN.fromSignature(128, 1), ...PPQNDurationConstraints}` → **Int32**
- field 11 `loop-area` object: `enabled` boolean (default **true**), `from` **Int32** (0),
  `to` **Int32** (default `PPQN.fromSignature(4,1)`) — both `PPQNPositionConstraints`
- field 31: `bpm` Float32 {min 30, max 999, exponential}

Installed d.ts confirms accessor names: `get loopArea(): LoopArea`,
`get durationInPulses(): Int32Field`
(`node_modules/@opendaw/studio-boxes/dist/TimelineBox.d.ts:32,38`).

Both demos write integer PPQN values (BAR multiples / sums of `PPQN.fromSignature`) ✓.

**Verdict:** CONFIRMED.

### 5. Pan automation mapping [track-automation]

`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/audio-unit/AudioUnitBoxAdapter.ts:127-130`:

```ts
panning: this.#parametric.createParameter(box.panning, ValueMapping.bipolar(), StringMapping.panning, "panning", 0.5)
```

`ValueMapping.bipolar()` = `linear(-1.0, 1.0)`
(`@opendaw/lib-std@0.0.78:packages/lib/std/src/value-mapping.ts`, namespace bottom).
unitValue 0 → −1 (full L), 0.5 → 0 (center), 1 → +1 (full R). Anchor is 0.5.
Schema: `panning` Float32 `BipolarConstraints`
(`@opendaw/studio-boxes@0.0.94:.../schema/std/AudioUnitBox.ts`, field 13).

**Verdict:** CONFIRMED — demo labels L/C/R at 0/0.5/1 (`track-automation-demo.tsx:163-167`) are correct.

### 6. Reverb `wet`/`dry` mapping [track-automation]

`@opendaw/studio-adapters@0.0.116:packages/studio/adapters/src/devices/audio-effects/ReverbDeviceBoxAdapter.ts`
(`#wrapParameters`): `dry` and `wet` both use `ValueMapping.DefaultDecibel`.
`DefaultDecibel = decibel(-72.0, -12.0, 0.0)`
(`@opendaw/lib-std@0.0.78:packages/lib/std/src/value-mapping.ts`, `DefaultDecibelInstance`).
Numerically (formula from `Decibel` class, verified with node): x(0 dB)=1.0,
x(−12 dB)=0.5, y(0.5)=−12 dB.

- Demo's raw write `reverbBox.wet.setValue(-6)` (`track-automation-demo.tsx:632`) is a
  valid raw-dB box write (schema: `wet` Float32, constraints "decibel", default −3 dB —
  `@opendaw/studio-boxes@0.0.94:.../audio-effects/ReverbDeviceBox.ts`).
- **Flag:** the y-axis label "50%" at unitValue 0.5 (`track-automation-demo.tsx:176`)
  is actually **−12 dB wet**, not 50% wet mix. "Wet" at 1.0 = 0 dB wet; "Dry" at 0.0
  = wet channel −∞ (dry path is independent and stays at its own level). Preset value
  0.8 ≈ −2.9 dB.

**Verdict:** CONFIRMED mapping; WRONG label — change "50%" to "−12 dB" (and consider
"0 dB"/"−∞" instead of "Wet"/"Dry", or keep words but document dB equivalents).

### 7. `VOLUME_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0)` [track-automation]

`@opendaw/studio-adapters@0.0.116:.../audio-unit/AudioUnitBoxAdapter.ts:19`:
`static VolumeMapper = ValueMapping.decibel(-96.0, -9.0, +6.0)`.
Computed with the tag's `Decibel` formula: `x(0) = 0.7339449541284403` ≈ 0.734 ✓.
Demo's volume y-labels (`+6 dB`@1.0, `0 dB`@0.734, `−9 dB`@0.5, `−∞`@0.0) all check out.

**Verdict:** CONFIRMED.

### 8. `createTrackRegion` return [track-automation] [claude-md]

`@opendaw/studio-core@0.0.152:packages/studio/core/src/project/ProjectApi.ts`:

```ts
createTrackRegion(trackBox: TrackBox, position: ppqn, duration: ppqn, {name, hue}: ClipRegionOptions = {}): Option<AnyRegionBox>
```

Returns `Option.None` for `duration <= 0` or non-Notes/Value track types. For
`TrackType.Value` it creates a `ValueRegionBox` (+ fresh `ValueEventCollectionBox`)
with `loopDuration = duration`, `position = Math.max(position, 0)`. The
`as ValueRegionBox` cast (`track-automation-demo.tsx:200`) is still required (static
type is the `AnyRegionBox` union). `ValueRegionBox.position`/`duration`/`loopOffset`/
`loopDuration` are all **Int32**
(`@opendaw/studio-boxes@0.0.94:.../timeline/ValueRegionBox.ts`, fields 10-13;
installed `dist/ValueRegionBox.d.ts:27-29` agrees). Demo passes integers ✓.

**Verdict:** CONFIRMED — cast still required; Int32-strict positions hold.

### 9. `createAutomationTrack` signature [track-automation] [claude-md]

Same file:

```ts
createAutomationTrack(audioUnitBox: AudioUnitBox, target: Field<Pointers.Automation>, insertIndex: int = Number.MAX_SAFE_INTEGER): TrackBox
```

Returns `TrackBox` directly (never null/Option) — internally `#createTrack` with
`trackType: TrackType.Value` and `box.target.refer(target)`. The demo's
outer-variable capture inside `editing.modify` (`track-automation-demo.tsx:644-654`)
is the correct pattern (modify doesn't forward return values). Note: the demo's
`else console.warn("Failed to create automation track…")` branch is unreachable on
the happy path — failure would throw out of `editing.modify`, not yield null.

**Verdict:** CONFIRMED.

### 10. Same-position composite key panic [track-automation] [claude-md]

Panic lives in `ValueEventBoxAdapter.Comparator`
(`@opendaw/studio-adapters@0.0.116:.../timeline/event/ValueEventBoxAdapter.ts:32-39`):
compares position, then index, then `panic("…are identical in terms of comparison")`
for distinct adapters with identical `(position, index)`. Same guard exists in
`ValueEvent.Comparator` (`@opendaw/lib-dsp@0.0.84:.../value.ts`). The comparator runs
when the `EventCollection`'s backing array sorts (lazy, on read after add —
`events.ts`, `EventArrayImpl.#sort`).

Preset audit: every wave-4 preset has strictly increasing positions —
volume (Fade In/Out, Swell, Ducking: 0,2,3,5,6,8 bars), pan (L-R, Ping-Pong,
Center Hold), reverb (Dry-to-Wet, Wet-to-Dry, Pulse: 0,2,4,6,8 bars), and all tempo
patterns. `applyAutomationEvents` always passing `index: 0` is therefore safe today.
`eventsToJson`'s duplicate-position `index: 1` branch (`track-automation-demo.tsx:254`)
is dead code for current presets (and only handles a single adjacent duplicate, not runs).

**Verdict:** CONFIRMED — panic real, composite key `(position, index)`; no current
preset can trigger it. Disposition for the `eventsToJson` `index: 1` branch: **keep,
no change** — it implements the documented same-position-index pattern and no preset
hits it.

### 11. `Curve.normalizedAt` formula + slope semantics [tempo-automation] [track-automation] [claude-md]

`@opendaw/lib-std@0.0.78:packages/lib/std/src/curve.ts:26-33`:

```ts
export const normalizedAt = (x: unitValue, slope: unitValue): unitValue => {
    if (slope > 0.499999 && slope < 0.500001) { return x }
    const p = clamp(slope, EPLISON, 1.0 - EPLISON)
    return (p * p) / (1.0 - p * 2.0) * (Math.pow((1.0 - p) / p, 2.0 * x) - 1.0)
}
```

Matches the CLAUDE.md formula exactly. `normalizedAt(0.5, slope) === slope`
(algebraically: the (1-p)/p power at x=0.5 collapses), so **slope = curve height at
the midpoint** — consistent with root CLAUDE.md's FadingAdapter wording ("slope =
curve height at the fade midpoint; 0.5 = exact linear"). 0.75 → 75% of the change by
half-time → steep start, flat end (logarithmic feel); 0.25 → flat start, steep end ✓
(category CLAUDE.md lines 66-71 ✓). Bonus: `Interpolation.Curve(0.5)` literally
returns `Interpolation.Linear` (`@opendaw/lib-dsp@0.0.84:.../value.ts:7-11`).

**Verdict:** CONFIRMED.

### 12. `PPQN.fromSignature` [time-signature]

`@opendaw/lib-dsp@0.0.84:packages/lib/dsp/src/ppqn.ts:14`:
`const fromSignature = (nominator, denominator) => Math.floor(Bar / denominator) * nominator`
with `Bar = 960 << 2 = 3840`.

**Verdict:** CONFIRMED. No action needed — CLAUDE.md and doc 02 both state the
formula correctly.

### 13. `LoopableRegion.globalToLocal` [claude-md]

`@opendaw/lib-dsp@0.0.84:packages/lib/dsp/src/events.ts` (LoopableRegion namespace):
`globalToLocal = (region, ppqn) => mod(ppqn - region.position + region.loopOffset, region.loopDuration)` ✓.
`ValueRegionBoxAdapter.valueAt` calls it before the event lookup
(`@opendaw/studio-adapters@0.0.116:.../region/ValueRegionBoxAdapter.ts:94-97`).

**Verdict:** CONFIRMED — formula and doc 09's framing are correct; no doc action.
The only action lives in API-sweep deviation 2 ([claude-md]): the category CLAUDE.md
line 167 describes `valueAt(position, fallback)`'s position as "region-local" — it is
GLOBAL (the adapter converts internally). The *event positions inside the collection*
are region-local; the `valueAt` query position is absolute timeline PPQN.

### 14. Tempo/value event deletion idiom [tempo-automation] [track-automation] [claude-md]

`ValueEventBox.interpolation` is an Int32 field accepting `Pointers.ValueInterpolation`
pointers; `Interpolation.Curve(slope)` is persisted as a **separate `ValueEventCurveBox`**
whose `event` pointer is `mandatory: true`
(`@opendaw/studio-boxes@0.0.94:.../timeline/ValueEventBox.ts` field 12,
`ValueEventCurveBox.ts` field 1;
`@opendaw/studio-adapters@0.0.116:.../event/InterpolationFieldAdapter.ts`, `write`).

`box.delete()` computes `graph.dependenciesOf(this)`, defers incoming pointers, and
unstages dependent boxes (`@opendaw/lib-box@0.0.86:packages/lib/box/src/box.ts:185-196`)
— so deleting a curve-interpolated ValueEventBox cascade-deletes its
`ValueEventCurveBox`. Bare `boxGraph.unstageBox(eventBox)` would leave the curve box
behind with a dangling mandatory pointer.

**Verdict:** CONFIRMED — `event.box.delete()` (used by both demos and the doc
examples) is the correct idiom. **The category CLAUDE.md line 184-185 ("Delete via
`boxGraph.unstageBox(adapter.box)`") is WRONG for curve events — fix to
`adapter.box.delete()`.**

---

### API-surface sweep — category CLAUDE.md lines 93-185 [claude-md]

Checked every listed member against `@opendaw/studio-adapters@0.0.116` sources
(`AutomatableParameterFieldAdapter.ts`, `ParameterFieldAdapters.ts`,
`ParameterAdapterSet.ts`, `ValueRegionBoxAdapter.ts`, `ValueEventBoxAdapter.ts`).

**Sweep result: ~45 members checked, deviations: 3.**

1. **`parameter.reset()`** — **WRONG** — CLAUDE.md says "restore to resetValue (or
   anchor)". Source: `reset(): void {this.setValue(this.#resetValue.unwrapOrElse(this.#field.initValue))}` —
   fallback is the **field's initValue**, not the anchor. Fix the CLAUDE.md wording to
   "restore to resetValue (or the field's initValue)".
2. **`ValueRegionBoxAdapter.valueAt(position, fallback)`** — **WRONG** — CLAUDE.md says
   "unitValue at a region-local PPQN". Source converts the input from GLOBAL to
   region-local itself (`LoopableRegion.globalToLocal(this, position)`), so the
   parameter is an absolute timeline position. Passing a region-local value would be
   double-converted whenever `region.position`/`loopOffset` ≠ 0. Fix to "unitValue at a
   global timeline PPQN (converted to region-local internally)".
3. **`ValueEventBoxAdapter` deletion line** — **WRONG** — "Delete via
   `boxGraph.unstageBox(adapter.box)`" is wrong for curve events (detailed under
   claim 14); use `adapter.box.delete()`.

Everything else confirmed, including: full
`AutomatableParameterFieldAdapter` surface (name/address/anchor/type/field/
valueMapping/stringMapping/track; getValue/setValue/getUnitValue/setUnitValue/
getControlledValue/getControlledUnitValue/getPrintValue/getControlledPrintValue/
setPrintValue/valueAt/subscribe/catchupAndSubscribe/
catchupAndSubscribeControlSources/registerMidiControl/registerTracks/updateMappings/
terminate); touch lifecycle (`touchStart` also fires `notifyWrite`); registry API
(`isTouched`/`touchStart`/`touchEnd`/`getMode` default `"read"`/`setMode`/
`subscribeTouchEnd: Observer<Address>`/`subscribeWrites: Observer<ParameterWriteEvent>`
where `ParameterWriteEvent = {adapter, previousUnitValue}`); `ParameterAdapterSet.parameters()`
and `.parameterAt(address)` (throws when absent); `ValueRegionBoxAdapter`
`.events`/`.hasCollection`/`.incomingValue`/`.outgoingValue` (fallback returned when no
collection/empty events ✓); `ValueEventBoxAdapter`
`.position`/`.index`/`.value`/`.interpolation` (settable)/`.collection`/`.isSelected`/
`.type === "value-event"`/`.copyTo({position?, index?, value?, interpolation?, events?})`/
`.copyFrom`.

---

### Changelog sweep — improvement candidates (not mandates) [tempo-automation] [track-automation] [time-signature]

From `changelogs/` in this repo:

- **0.0.128→0.0.129:** automation *touch recording* rewrite — `AutomationMode = "read" | "touch" | "latch"`,
  `ParameterFieldAdapters.setMode/touchStart/touchEnd/subscribeTouchEnd`. Candidate:
  track-automation demo could add a live "record fader movement" mode. (Listed in the
  changelog as "new API, not used".)
- **0.0.147→0.0.150:** `TempoGridCursor` is now a public export from
  `@opendaw/studio-adapters`; `VaryingTempoMap.intervalToSeconds` memoised. Candidate:
  tempo-automation demo could display wall-clock duration of the 8-bar loop per
  pattern via `project.tempoMap.intervalToSeconds(0, TOTAL_PPQN)` — cheap, shows the
  tempo map API.
- **0.0.133→0.0.135:** `VaryingTempoMap.intervalToSeconds` negative-PPQN fix — no action.
- **0.0.150→0.0.154:** no breaking changes; clipboard orphan-automation-lane fix — no action.
- `SignatureTrackAdapter.changeSignature()` / `moveEvent()` exist at 0.0.116 —
  candidate: time-signature demo could use `changeSignature` instead of raw
  `timelineBox.signature.*.setValue` writes (preserves event positions when changing
  the storage signature; for the demo's clear-all flow the raw writes are fine).

---

### Doc corrections [docs]

Checked only claims the three demos exercise, in
`documentation/02-timing-and-tempo.md` and
`documentation/09-editing-fades-and-automation.md`, against the verdicts above.

**Confirmed correct (no change needed):**
- 02: tempo-track access via `tempoTrackEvents.ifSome` (:400), delete+create in ONE
  modify example (:415-435 — now source-verified safe, claim 2), interpolation table
  incl. slope semantics (:441-443, :489-493), `durationInPulses`/`loopArea` setup
  (:507-510), `PPQN.fromSignature` table (:723-731), one-transaction-per-signature-event
  (:761-780), storage-signature index −1 / `slice(1)` (:716, :790s).
- 09: unitValue pipeline + `valueAt` applies ValueMapping (:939), DefaultDecibel row
  (:944), VolumeMapper ≈0.734 (:988), `globalToLocal` formula (:1062-1065), Möbius-Ease
  formula + "NOT a quadratic bezier" (:1087-1117), Curve(0.5)→Linear (:1128),
  `createAutomationTrack`/`createTrackRegion` examples (:1010-1040, cast included).

**Corrections:**

| File | Line | Wrong claim | Correction |
|------|------|-------------|------------|
| documentation/02-timing-and-tempo.md | ~795-800 (clearing signature events) | Example clears via `a.box.delete()` with only the reverse-order caveat | Mention `signatureTrack.deleteAdapter(a)` as the general-purpose deletion (recalculates successor `relativePosition`); reverse-order `box.delete()` is only equivalent for a full clear |

(No other exercised doc claim deviated from source. The `valueAt` position-space and
`unstageBox` issues live in the category CLAUDE.md, not in these chapters.)

---

### Code-level issues (verified) 

#### A. Missing `.catch` on init [tempo-automation] [time-signature]
Confirmed: `tempo-automation-demo.tsx:292-305` and `time-signature-demo.tsx:262-276`
call `initializeOpenDAW({...}).then(...)` with no `.catch` and no try/catch — a
thrown init (e.g. `assert(crossOriginIsolated)` or worklet failure in
`src/lib/projectSetup.ts:103+`) leaves the page on "Loading..." forever with the
error only in the console. track-automation already has the try/catch + `setStatus`
pattern (`track-automation-demo.tsx:673-678`) — replicate it (or `.catch(err =>
setStatus(...))`). Neither demo has a mounted/cancelled guard either; add one while
touching the effect.
**Verdict: bug — fix in Tasks 2 and 4.**

#### B. Per-frame setState → full canvas redraw [tempo-automation] [time-signature] [track-automation]
Confirmed: `usePlaybackPosition` calls `setCurrentPosition(position)` every frame
while playing (`src/hooks/usePlaybackPosition.ts:47-53`). `TempoCanvas`'s `useEffect`
depends on `playheadPosition` (`tempo-automation-demo.tsx:267`) and redraws grid +
curve + playhead every frame; `TimelineCanvas` in time-signature does the same
(`time-signature-demo.tsx:234`); `AutomationCanvas` in track-automation too
(`track-automation-demo.tsx:404`).
Wave-3 precedent: `src/demos/playback/clip-looping-demo.tsx:168-177` splits a static
waveform canvas (structural deps only) from a playhead layer driven by refs, so the
expensive paint never runs per frame. Root CLAUDE.md prescribes direct-DOM overlays
for moving playheads.
**Verdict: not a crash-level bug (single small ~150px canvas, paint is cheap), but it
violates the repo pattern and wastes a full repaint per frame × 3 demos.
Recommendation: during restyle (Tasks 3/5/7), split playhead into an
absolutely-positioned DOM overlay (or second canvas) updated via
`AnimationFrame.add` reading `engine.position` directly; drop `playheadPosition` from
the paint effect deps.**

#### C. Pattern metadata switch on names/shape [time-signature]
Confirmed: `getInitialSignature` returns `[6,8]` iff `pattern.name === "Film Score"`
(`time-signature-demo.tsx:69-72`); `getLastSectionBars` infers 4 bars from
`changes.length === 1 && changes[0].barOffset === 4` (:74-78). Both are data
masquerading as code — add `initialSignature: [nom, denom]` and `lastSectionBars`
fields to `SignaturePattern` declarations.
**Verdict: cheap improvement — Task 4.**

#### D. `console.warn`-only failures [track-automation]
Confirmed at `track-automation-demo.tsx:197` (createTrackRegion empty), `:205`
(no event collection), `:619` (Guitar region not found), `:652` (automation track
falsy — unreachable per claim 9, since `createAutomationTrack` returns `TrackBox` or
throws). None surface to the UI; per repo error-handling rules they must set status /
visible state. Related hardening: `handlePlaySection` (`:771-773`) reads
`automationTrackBoxesRef.current[sectionIndex]` without a null check before passing
to `applyAutomationEvents` (would throw on `adapterFor(undefined)`).
**Verdict: fix in Task 6 — surface failures via `setStatus`/error state; simplify the
unreachable `:652` branch. Task 6's fix list also includes the reverb y-label fix
from claim 6 ("50%" at unitValue 0.5 → "−12 dB", `track-automation-demo.tsx:176`).**

#### E. 882 lines (cap 800) [track-automation]
Confirmed: `wc -l` → 882. Extraction candidates (clean seams):
1. Preset + track-config data (`track-automation-demo.tsx:30-181`, ~150 lines) →
   `src/demos/automation/lib/automationPresets.ts`.
2. `AutomationCanvas` (`:261-416`, ~155 lines) → own component file (also the place
   to apply the playhead-overlay fix from issue B).
Either alone gets under 800; both leave a ~580-line page.
**Verdict: do extraction 1 (data) at minimum in Task 6; extraction 2 pairs naturally
with the Task 7 restyle.**

#### F. Ref accumulation across StrictMode double-init [track-automation]
Verified NOT a bug in current form:
- `automationTrackBoxesRef.current = trackBoxes` (`track-automation-demo.tsx:656`) and
  `reverbDeviceBoxRef.current = reverbBox` (`:638`) are wholesale assignments, not appends — no accumulation (unlike the
  append-only refs wave 3 had to reset in
  `src/demos/playback/drum-scheduling-demo.tsx:77-85`).
- Each `initializeOpenDAW` call builds a fresh `Project`/`AudioContext`
  (`src/lib/projectSetup.ts:103+`, no singleton), so a discarded first init writes
  boxes only into its own discarded graph.
- `cancelled` guards cover every await boundary: after `initializeOpenDAW` (`:581`)
  and after `loadTracksFromFiles` (`:598`); all box-graph writes after the last guard
  are synchronous to the end of `init()` — no interleaving window. The demos also
  don't render under `<React.StrictMode>`.
- Residual (pre-existing, repo-wide): the discarded init's AudioContext/engine are
  never disposed on unmount. Out of scope for this wave.
**Verdict: no fix needed; optionally add the wave-3-style comment documenting why the
wholesale assignment is double-init-safe.**

---

### Extra findings surfaced during the audit (for later tasks)

- `ValueEventCollectionBoxAdapter.createEvent` truncates positions
  (`Math.trunc(position)`) and *updates the existing event in place* when an attached
  event already sits at `(position, index)` — useful to know for docs; it means
  re-applying a preset without clearing would mutate rather than duplicate.
- `Interpolation.Curve(0.5)` returns `Interpolation.Linear` (lib-dsp value.ts) — the
  curve box is never created for slope 0.5.
- Tempo demo comment `tempo-automation-demo.tsx:23` ("0.5=linear, <0.5=slow start,
  >0.5=fast start") is consistent with verified slope semantics.
- `TempoChangeGrid` quantization (80 PPQN) is the reason the engine docstring says
  tempo is "a step function… sampled at the cell's grid-aligned start".
