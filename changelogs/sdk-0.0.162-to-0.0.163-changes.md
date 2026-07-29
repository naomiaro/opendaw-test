# OpenDAW SDK Changelog: 0.0.162 → 0.0.163

One release, one big architectural change: **the engine's linear memory is no longer
shared**. The worklet now creates its own non-shared `WebAssembly.Memory`, which removes
the up-front virtual-address-space reservation that crashed constrained devices
(openDAW #1030, the "Riffle Android crash"). Alongside it: an **Auto-EQ** analysis API,
**Playfield per-slot volume/pan channel strips**, new **Analysis-panel telemetry**
(stereo, goniometer, loudness, heap), and a fix for the silent creator of the
"regions overlap" panics.

Sub-package versions (installed): `studio-adapters` 0.1.4, `studio-core` 0.1.4,
`studio-core-wasm` 0.0.8, `studio-boxes` 0.0.102, `studio-enums` 0.0.83 (unchanged).
All `lib-*` packages unchanged.

## ⚠ Engine memory is now non-shared, worklet-owned (core-wasm 0.0.8)

The old design: `WasmEngine.install` minted a `shared: true` `WebAssembly.Memory` on the
main thread and shipped it to the worklet via `processorOptions`, probing maxima
4 GiB → 2 → 1 → 512 MiB because a shared memory reserves its entire `maximum` as virtual
address space at creation — the reservation ladder that failed outright on low-memory
devices.

The new design (`engine-modules.ts`): `createEngineMemory()` is now just
`new WebAssembly.Memory({initial: 256})` — **non-shared, no maximum, created INSIDE the
worklet/worker that runs the engine** (a non-shared memory cannot be postMessaged).
No reservation, no ladder; talc grows on demand and the runtime may **relocate** the
buffer on grow. Consequences, all verified against the installed dist:

- **`WasmEngineAttachment` no longer carries `memory`** (`protocol.d.ts`) — the
  attachment is modules + composite specs only; the processor constructs the memory
  itself.
- **Every grow detaches existing JS views.** The processor re-reads `memory.buffer`
  after any engine call that can allocate (pointer calls are made BEFORE the buffer
  read throughout `processor.ts` / `offline-worker.ts`), and `#syncBroadcasts()`
  re-registers all broadcast views when the buffer identity changes.
- **The frozen-audio channel is gone.** `WasmFrozenProtocol` and `WASM_FROZEN_CHANNEL`
  are deleted from core-wasm — the main thread can no longer write freeze PCM straight
  into engine memory. The WASM variant no longer supplies the `connectFrozenAudio` hook
  (still an optional member of `EngineWorkletVariant` for custom engines); with the hook
  absent, `EngineWorklet` routes frozen PCM through the existing `setFrozenAudio`
  engine command, copied worklet-side.
- **Cross-origin isolation is STILL required.** The sync stream, control flags,
  HRClock and recording ring are `SharedArrayBuffer`s regardless of the engine heap —
  do not drop COOP/COEP.

This lands the direction of the upstream `plans/wasm-audio/memory-ceiling.md` plan by
dissolving its premise: with a non-shared memory there is no ceiling to reserve, so the
"boot ceiling" and reservation-failure phases no longer apply (upstream marked those
plans current in the same release).

## Regions-overlap panic: silent creator fixed (core 0.1.4)

`AudioContentFactory.calculateDuration` **signature changed**:

```typescript
// before
calculateDuration(sample: Sample, disableQuantize?: boolean): ppqn
// after
calculateDuration(sample: Sample, tempoMap: TempoMap, position: ppqn, disableQuantize?: boolean): ppqn
```

A bpm-less sample becomes a SECONDS-timebase region whose ppqn extent depends on the
project tempo at its position. The old code returned raw seconds as if they were ppqn,
producing a near-zero clip mask — regions underneath a dropped file were left
un-clipped, silently creating the overlaps behind the "regions overlap" panics
(#1054 family, #1080). The conversion now goes through the tempo map
(`intervalToPPQN`), the same math as `TimeBaseConverter.toPPQN`.

`RegionClipResolver` additionally dumps the full track layout (`console.debug`
`"regions-overlap"`) immediately before the overlap panic — diagnostic only, no
behaviour change. Aligns with this repo's "overlap disallowed by design" finding: the
SDK now both prevents the silent creator and instruments the panic path.

## New: AutoEq (core 0.1.4)

`AutoEq.analyze(audio: AudioData, options?: {tiltDbPerOctave?, maxGainDb?}): Result` —
corrective auto-master EQ analysis: measures the audio's spectrum and returns five
band suggestions (`lowShelf`, `lowBell`, `midBell`, `highBell`, `highShelf`, each
`{frequency, gainDb}`; gains capped at ±4.5 dB by default). Pure analysis — applying
the result to an EQ device is the caller's job (the upstream studio wires it to the
output channel strip). Ships with convergence and quality tests upstream.

## Playfield: per-slot volume + panning (boxes 0.0.102, adapters 0.1.4, core-wasm 0.0.8)

`PlayfieldSampleBox` gains field 50 `volume` (Float32, decibel constraint, default 0 dB)
and field 51 `panning` (Float32, bipolar) — a channel strip between a slot's output
(post its own fx chain) and the composite sum. `PlayfieldSampleBoxAdapter` exposes both
as named automatable parameters and includes them in `reset()`/`copyToIndex()`.
`CompositeSpec` grew `childVolumeKey`/`childPanKey` (0 = no per-child strip), threaded
through `composite_register` down to the Rust engine.

## New broadcast telemetry: stereo, goniometer, loudness, heap (adapters 0.1.4, core-wasm 0.0.8)

`EngineAddresses` grew four virtual broadcast addresses beyond
PEAKS/SPECTRUM/WAVEFORM: `STEREO`, `GONIO`, `LOUDNESS`, `HEAP`. The worklet computes
them via a new `analysis-dsp.ts` (`StereoAnalyser`, `GonioCapture`, `LoudnessMeter`) —
**lazily**: each analyser only runs while a UI subscription is active (the spectrum and
waveform analysers are now gated the same way, a small render-path win for headless
consumers that never subscribe). `HEAP` publishes the engine's `heap_used()` /
`heap_claimed()` — a live memory meter over the wasm heap. Upstream these feed the new
mixer Analysis panel and a footer memory readout.

## Misc

- **`Project` restart chain terminated cleanly**: a `#terminated` flag stops the
  processorerror restart handler from booting a fresh worklet after `terminate()` —
  previously a crash racing a teardown could resurrect the engine.
- **`StudioSettings`**: engine settings gained `latency-warning-threshold` (ms,
  default 25) — upstream shows a footer latency warning with a manual page.
- **`MeterWorklet`**: RMS window 0.100 s → 0.300 s.
- **Rust engine** (ships inside the wasm binaries): effects-monitoring now fills the
  tape output so the Tape device carries the live input; the tape player's `enabled`
  observer is unsubscribed on rebuild (leak fix); the device RMS meter ring is
  decimated to per-quantum buckets.
- Upstream studio UI work not in the SDK surface: the mixer Analysis panel
  (VU/stereo/gonio/loudness cards), audio-bus input-sum metering, the latency warning
  UI, footer memory info, and the Auto-EQ action on the output strip.

## opendaw-headless follow-ups shipped with this upgrade

- **No code changes needed**: we never touched `createEngineMemory`, the frozen-audio
  channel, `AudioContentFactory.calculateDuration`, or Playfield — verified by grep;
  `npm ci`, `tsc` and the build pass on the new SDK unchanged.
- `documentation/internals/` updated where it described the shared-memory
  architecture: 01-engine-processor (memory ownership, frozen-audio delivery,
  sample-write path), 03-cross-thread-protocols (channel table, attachment shape,
  `EngineAddresses`, COOP/COEP rationale), 05-devices-and-effects and
  06-project-and-persistence ("shared linear memory" wording, frozen PCM delivery).
