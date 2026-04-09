# Automation Demos — OpenDAW SDK Reference

### Time Signature Events
```typescript
// Access signature track
const signatureTrack = project.timelineBoxAdapter.signatureTrack;

// Create event at PPQN position
signatureTrack.createEvent(position, nominator, denominator);

// Iterate all events (index -1 is storage signature)
const events = Array.from(signatureTrack.iterateAll());

// Delete event
signatureTrack.adapterAt(event.index).ifSome(a => a.box.delete());

// PPQN per bar: PPQN.fromSignature(nom, denom) = Math.floor(3840/denom) * nom
```

### SignatureTrack: One editing.modify() Per Event
`SignatureTrackAdapter.createEvent()` calls `iterateAll()` internally. Inside a single
`editing.modify()` transaction, adapter collection notifications are deferred, so subsequent
calls see stale state. Use separate `editing.modify()` per `createEvent` and per deletion.

### Tempo Automation Events
```typescript
// Access tempo track events
project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
  // Clear existing
  collection.events.asArray().forEach(event => event.box.delete());
  // Create event
  collection.createEvent({ position, index: 0, value: bpm, interpolation });
});
// Interpolation: Interpolation.Linear, Interpolation.None from @opendaw/lib-dsp
```

### Track Automation (Volume, Pan, Effects)
```typescript
// Create automation track targeting a parameter field
let trackBox: TrackBox;
project.editing.modify(() => {
  trackBox = project.api.createAutomationTrack(audioUnitBox, audioUnitBox.volume);
});

// Create a region and add events
project.editing.modify(() => {
  const regionOpt = project.api.createTrackRegion(trackBox, position, duration);
  const regionBox = regionOpt.unwrap() as ValueRegionBox;
  const adapter = project.boxAdapters.adapterFor(regionBox, ValueRegionBoxAdapter);
  const collection = adapter.optCollection.unwrap();
  collection.createEvent({ position: 0 as ppqn, index: 0, value: 0.5, interpolation: Interpolation.Linear });
});
```

**Automation event positions are REGION-LOCAL, not absolute.**
`ValueRegionBoxAdapter.valueAt()` calls `LoopableRegion.globalToLocal(region, ppqn)` =
`mod(ppqn - region.position + region.loopOffset, region.loopDuration)` before looking up events.
Events at absolute positions will fall outside the region duration and never trigger.

### Automation Events at Same Position Must Have Different Index
The SDK uses `(position, index)` as composite key. Two events at the same PPQN with
the same index cause a panic: "are identical in terms of comparison". When building
automation events that may land on the same position (e.g., crossfade boundaries),
assign incrementing `index` values per position.

### Curve Rendering Must Use SDK's Curve.normalizedAt
Canvas rendering of automation curves must use `Curve.normalizedAt(t, slope)` from `@opendaw/lib-std`,
not quadratic bezier approximations. The SDK uses an exponential formula:
`(p²)/(1-2p) * (((1-p)/p)^(2x) - 1)` (Möbius-Ease) — visually different from bezier.
Slope semantics: 0.75 = steep start, flat end (logarithmic feel); 0.25 = flat start, steep end.
For a round swell: use Curve(0.75) rising, Curve(0.25) falling.

### Effects Parameter Architecture
Effects use a 3-layer chain: Box (raw storage) → Adapter (UI mapping) → Processor (DSP).
`box.field.setValue()` stores raw values that the processor reads directly via `getValue()`.
`ValueMapping` in adapters only affects UI display/automation — NOT audio processing.

**Gotchas discovered during SDK 0.0.115 audit:**
- Delay has its own 21-entry `Fractions` array (Off→1/1) — different from Tidal's 17-entry `RateFractions` (1/1→1/128)
- Crusher processor inverts crush: `setCrush(1.0 - value)` — higher box value = MORE crushing
- DattorroReverb `preDelay` is in milliseconds (0-1000), standard Reverb is in seconds (0.001-0.5)
- DattorroReverb `dry` uses `DefaultDecibel` mapping (-60 to 6 dB), not -60 to 0
- StereoTool `stereo` (width) is bipolar (-1..1), not unipolar — 0 = normal, not center of 0-2 range
- `DefaultDecibel` mapping: `decibel(-72, -12, 0)` — unitValue 0.0 = -inf, 0.5 = -12 dB, 1.0 = 0 dB
- AudioUnit `VolumeMapper`: `decibel(-96, -9, +6)` — different range, unitValue 0.0 = -inf, 1.0 = +6 dB
- Automation values (unitValue 0-1) go through ValueMapping before reaching the processor:
  `AutomatableParameterFieldAdapter.valueAt()` calls `valueMapping.y(unitValue)` to convert to dB/raw
- Convert dB ↔ unitValue: `AudioUnitBoxAdapter.VolumeMapper.x(0)` → unitValue for 0 dB (~0.734);
  `.y(0.5)` → -9 dB. Import `AudioUnitBoxAdapter` from `@opendaw/studio-adapters`.
  For effects: `ValueMapping.DefaultDecibel` from `@opendaw/lib-std`.
- To verify parameter ranges, audit all 3 layers: schema (Box), adapter (ValueMapping), and processor (how value is consumed)

## Reference Files
- Track automation demo: `src/demos/automation/track-automation-demo.tsx`
- Tempo automation demo: `src/demos/automation/tempo-automation-demo.tsx`
- Time signature demo: `src/demos/automation/time-signature-demo.tsx`
- Track automation docs: `documentation/19-track-automation.md`
