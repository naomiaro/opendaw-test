# OpenDAW Internals

> **Audience:** developers reading or contributing to the openDAW codebase itself, not just using the SDK.
>
> If you're building an app **with** OpenDAW, start with the [Core Handbook](../README.md) instead. This section is for understanding **how OpenDAW is built**.

The Core Handbook describes the SDK surface as if it were a black box. This section opens the box: how the engine processor schedules audio, how the box graph stores state, how threads talk to each other.

These chapters reference internal source paths inside [`andremichelle/openDAW`](https://github.com/andremichelle/openDAW) (e.g. `packages/studio/core-processors/src/EngineProcessor.ts`). Paths may move as the repo evolves — when in doubt, search by class or method name.

## Conventions used in this section

- **File paths** are relative to the openDAW monorepo root, not the opendaw-test docs repo.
- **Line numbers** point to specific entry points; they decay over time, so treat them as approximate.
- **Code blocks** quote the actual source (sometimes lightly trimmed) — not paraphrased pseudocode.

## Chapters

| # | Chapter | Focus |
|---|---------|-------|
| 01 | [Engine Processor](./01-engine-processor.md) | The AudioWorkletProcessor that runs the audio graph — render loop, BlockRenderer, ClipSequencing, AudioUnit, NoteSequencer, automation |
| 02 | [Box System](./02-box-system.md) | The data layer — lib-box primitives, fields, transactions, pointers, the studio-boxes catalog, adapters, forge code generation, serialization |
| 03 | [Cross-Thread Protocols](./03-cross-thread-protocols.md) | How main, worklet, and workers talk — Messenger + Communicator RPC, SyncStream over SharedArrayBuffer, SyncSource/Target graph sync, control flags, HRClock, RingBuffer, fetchAudio, COOP/COEP |
| 04 | [Sample Loading and Peaks](./04-sample-loading.md) | The full sample lifecycle — decode (WAV fast path + Web Audio fallback), peaks generation (multi-scale, Float16-packed), OPFS storage layout, GlobalSampleLoaderManager cache + dedup + ref counts, worklet-side fetch, PeaksWriter for live recording, transient detection |
| 05 | [Devices and Effects](./05-devices-and-effects.md) | The box/adapter/processor triple, DeviceProcessorFactory dispatch, EffectFactory + InstrumentFactory, a Compressor walked end-to-end, channel strip + aux sends + AudioBus, voicing strategies, modular devices + ScriptCompiler, NAM WASM, "how to add a new effect" |
| 06 | [Project and Persistence](./06-project-and-persistence.md) | The Project class, the `.od` file format (`ProjectSkeleton` encode/decode), hash-chained `SyncLog` history, Y.js collaborative editing, dawproject import/export, track freeze, offline rendering, audio consolidation, preset storage, migrations |
| 07 | [Repo Layout and Dev Workflow](./07-dev-workflow.md) | Top-level layout, Lerna+Turbo monorepo, root + per-package scripts, the forge regeneration flow, tests, code conventions from `CLAUDE.md`, the `plans/` design-doc convention, CI/CD, HTTPS dev server, and a step-by-step "How to create a proper PR" |
| 08 | [Time & Pitch](./08-time-and-pitch.md) | The `TransientDetector` algorithm (LR-48 bands, weighted onset detection, valley-snap refinement, 120 ms / 40-per-sec density rules), `AudioContentModifier` mode-flip transactions, `TimeStretchSequencer` segment selection and voice crossfade, warp-marker interpolation, the cents↔playbackRate adapter math |

## Working with the openDAW monorepo

The codebase is a Lerna + Turbo monorepo. The top-level layout:

```
openDAW/
├── packages/
│   ├── lib/           # foundation libraries (lib-std, lib-dsp, lib-fusion, ...)
│   └── studio/        # the DAW-specific code
│       ├── core/             # main-thread engine surface (Project, EngineFacade, ...)
│       ├── core-processors/  # AudioWorkletProcessor code (EngineProcessor, ...)
│       ├── core-workers/     # Web Worker code (peaks, FFmpeg, offline render)
│       ├── adapters/         # box adapter wrappers
│       ├── boxes/            # box catalog
│       ├── enums/
│       └── sdk/              # bundled studio-sdk meta-package
├── plans/             # contributor design docs (read these before sending big PRs)
└── wiki/              # rendered wiki content
```

The two packages most relevant to engine internals are **`@opendaw/studio-core`** (main thread) and **`@opendaw/studio-core-processors`** (audio thread).
