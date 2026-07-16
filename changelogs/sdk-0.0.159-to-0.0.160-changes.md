# OpenDAW SDK Changelog: 0.0.159 → 0.0.160

The release that closes **openDAW#316** (filed by this repo): the metronome is now part of
`ExportConfiguration`, so offline renders can include a click — in the mixdown or as its
own stem — with no renderer wiring. Also: `IconSymbol` additions, an OPFS worker fix, and
lib-jsx router changes.

Sub-package versions (installed): `studio-adapters` 0.1.1, `studio-core` 0.1.1,
`studio-core-wasm` 0.0.5, `studio-boxes` 0.0.99, `studio-enums` 0.0.82
(`studio-core-processors` is bundled into `studio-core`'s dist, not independently
installed — version bump only per its upstream CHANGELOG).

**No breaking changes for opendaw-headless.** All API changes are additive — but see the
roadmap note at the bottom.

## Metronome in ExportConfiguration (openDAW#316) — adapters 0.1.1 + core-wasm 0.0.5

New `ExportMetronomeConfiguration` on `ExportConfiguration`:

```ts
export type ExportMetronomeConfiguration = {
  includeInMixdown?: boolean;                 // click mixed INTO a (no-stems) mixdown
  stem?: { fileName: string };                // click as its own stereo pair, appended LAST after unit stems
  settings?: Partial<Omit<EngineSettings["metronome"], "enabled">>; // gain/beatSubDivision/monophonic
  clickSounds?: { downbeat?: AudioData; beat?: AudioData };         // custom PCM (else synthesized 880/440 Hz)
};
```

Semantics (verified in installed `EngineProcessorAttachment.js` + `wasm-offline-worker.js`):

- **Enabled is implied by presence** — `isMetronomeAudible` = `includeInMixdown === true`
  (no stems) or `metronome.stem` defined (with stems). No metronome key = silent; an
  existing mixdown can never pick up a click by accident.
- **`countStems` counts the metronome pair** — `{stems: N, metronome: {stem}}` renders
  `(N+1)×2` channels with the click pair LAST (matching `stemFileNames` order and the
  Rust engine's `set_stem_export(unitCount, metronomeFlag)` staging). A metronome-ONLY
  stem render is `{stems: {}, metronome: {stem}}` (guarded upstream).
- `sanitizeExportNamesInPlace` sanitizes the metronome stem LAST so a filename collision
  renames the click, not a project stem.
- `settings` merges over `EngineSettingsSchema.parse({}).metronome` defaults; click PCM
  travels in the config (not `loadClickSound`) because the offline render loop never
  yields — a racing command would land after the render finished.

### ⚠ WASM offline worker only

The config is consumed by `core-wasm/offline-worker.ts` (`set_metronome_enabled/gain/
beat_sub_division/monophonic`, `click_allocate`/`set_click_sound`). **The TS
`EngineProcessor` and the TS offline worker ignore `config.metronome` entirely** — a
`variant: false` render with a metronome config produces no click (and no error). Consumers
must route metronome renders through the WASM offline worker (`OfflineEngineRenderer`
`variant: true`, or the `useForExports()` default policy).

This repo's `rangeExport.ts` now drives `variant` with
`ExportConfiguration.isMetronomeAudible(config)` and retired the legacy
`OfflineAudioContext` + `EngineWorklet.preferences` metronome path entirely.

## Roadmap note: the TypeScript audio engine is going away

Closing openDAW#315 (wontfix), Andre: use `OfflineEngineRenderer` instead of the deprecated
`AudioOfflineRenderer` — "The Typescript audio-engine will be removed soon." Plan
accordingly: `variant: false` pinning, the TS-engine residual of #311 (seam ratio 1.87),
and the manual `OfflineAudioContext` render pattern are all on borrowed time; the
audio-verify calibration will need a WASM-engine pass when the switch happens.

## Misc

- `IconSymbol`: +4 new symbols (`studio-enums` 0.0.82).
- `lib-fusion` OPFS worker: guards a write path (`OpfsProtocol`/`OpfsWorker` + test).
- `lib-jsx`: router additions (`routes.ts`, `Router.tsx`) — studio-app-facing.
- `core-wasm` gains a dist smoke test; `EngineProcessorAttachment` adds an empty
  `ProcessorOptions` placeholder and the `options?` field.
- `ysync/YService` tweak (collaboration path, unused here).

## opendaw-headless follow-ups shipped with this upgrade

- `renderRange` collapsed to a single `OfflineEngineRenderer` path; metronome expressed in
  the export config; `exportStemsRange` renders unit stems + metronome stem in ONE pass
  (previously a second muted-mixdown render).
- Verified: new-API metronome mixdown is metric-identical to the 0.0.159
  preferences-path render (LUFS/peaks/spectral/stereo all ~same); metronome stem is a pure
  click track (125 BPM detected vs project 124, stability 0.989); audio-verify full pass
  with grid scenarios (metronome renders, now WASM-worker) matching every calibrated
  median exactly (30/32/30/33/153 ms).
