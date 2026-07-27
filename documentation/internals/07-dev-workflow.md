# Repo Layout and Dev Workflow

> **Audience:** contributors to openDAW. This is the final internals chapter — the practical "how do I actually work on this repo" guide. After this, you should be able to clone, build, test, change a box, regenerate, and submit a PR that lands.
>
> **Prereqs:** the previous six chapters get you the *what*. This chapter is the *how*.

If chapters 01–06 told you what every layer of openDAW is, this one tells you the mechanics of being a contributor: where the code lives, how the build works, which commands matter, and — most importantly — how to ship a PR without breaking anything.

## Top-level layout

The repo (`github.com/andremichelle/openDAW`) is a Lerna + Turbo monorepo with npm workspaces. Top-level directories:

| Path | What's in it |
|---|---|
| `packages/` | All TypeScript source, organized by domain (see below) |
| `crates/` | The Rust audio engine + its DSP libraries, a Cargo workspace compiled to WebAssembly |
| `plans/` | AI-assisted contribution documentation (~50 markdown files) |
| `scripts/` | Utility shell + Node scripts (cert generation, cleanup, sample conversion) |
| `certs/` | Locally-generated HTTPS certificates for the dev server |
| `deploy/` | SFTP deploy + Discord webhook scripts |
| `wiki/` | Long-form articles |
| `assets/` | Branding + screenshots |
| `audits/` | Security/code-quality audit artifacts |
| `test-files/` | Sample audio + MIDI for tests |

Root files worth knowing:

- **`package.json`** — npm workspace definition + root scripts
- **`turbo.json`** — task pipeline + caching
- **`lerna.json`** — independent versioning + publishing
- **`CLAUDE.md`** — coding style rules (quoted in full below)
- **`README.md`** — project overview + contribution policy
- **`.github/workflows/`** — CI/CD (deploy-only, see below)

## Monorepo structure: `packages/`

The package layout splits roughly into four tiers, with strict dependency direction `config → lib/* → studio/* → app/*`:

```
packages/
├── config/                         build-system configs
│   ├── eslint/                       @opendaw/eslint-config
│   └── typescript/                   @opendaw/typescript-config
├── lib/                            framework-independent libraries
│   ├── std/                          Option, UUID, Observable, tryCatch, ...
│   ├── runtime/                      Messenger, Communicator, Promises
│   ├── dom/                          AnimationFrame, dom utilities
│   ├── jsx/                          lightweight JSX runtime (Studio UI)
│   ├── dsp/                          PPQN, AudioData, ctagdrc compressor, transient detection
│   ├── box/                          box graph, fields, transactions (ch. 02)
│   ├── box-forge/                    schema-to-class code generator
│   ├── fusion/                       PeaksPainter, SyncStream, Schema
│   ├── xml/                          minimal XML reader/writer
│   ├── midi/                         standard MIDI file parser
│   ├── dawproject/                   DAW Project interchange (ch. 06)
│   └── inference/                    ML model inference helpers
├── studio/                         DAW-specific code
│   ├── enums/                        Pointers and shared enums
│   ├── forge-boxes/                  box schema definitions (input to forge)
│   ├── boxes/                        generated box classes (output of forge)
│   ├── adapters/                     typed adapters around boxes (ch. 02/05)
│   ├── core/                         Project, EngineFacade, SampleManager (ch. 04, 06)
│   ├── core-wasm/                    TS glue for the Rust engine: boot, device linker,
│   │                                 worklet host, offline worker (ch. 01, 03)
│   ├── core-processors/              the engine-independent worklets: meters, recording
│   ├── core-workers/                 Web Worker code: peaks, OPFS, transients (ch. 03, 04)
│   ├── scripting/                    user-script execution for modular devices
│   ├── p2p/                          peer-to-peer collaboration (experimental)
│   └── sdk/                          public SDK meta-package
├── app/
│   ├── studio/                       the web UI (Vite + JSX)
│   ├── wasm/                         the engine test app + its render-assertion suite
│   ├── lab/                          scratch app for DSP experiments
│   ├── transient/                    transient-detection harness
│   └── nam-test/                     Neural Amp Modeler harness
└── server/
    └── (yjs-server, deploy support)
```

The packages most contributors touch are: `studio/forge-boxes`, `studio/boxes` (read-only — generated), `studio/adapters`, `studio/core`, and — for anything engine-side — `studio/core-wasm` plus the Rust crates below. The rest are mature foundations you usually consume rather than change.

## The Rust engine: `crates/`

The audio engine is a Cargo workspace at the repo root, compiled to WebAssembly and shipped inside `@opendaw/studio-core-wasm`. `crates/Cargo.toml` lists the members:

| Crate | What's in it |
|---|---|
| `engine` | The engine itself: a downstream `BoxGraph` mirror fed by the forward-only sync stream, plus the timeline, transport, audio units, routing, freeze, metronome, time-stretch |
| `engine-env` | The engine's shared standard library — the vocabulary the engine and every device speak (buffers, blocks, event receivers, processors) |
| `boxgraph` / `studio-boxes` | The Rust mirror of the box graph, and the openDAW schema registry generated from the *same* forge schema that generates the TS box classes |
| `bindings` | The Rust counterpart of `studio-adapters`: reads boxes via the edge model and materialises owned runtime values |
| `processors` | Timeline → audio: the note sequencer and instrument rendering |
| `stock-devices/device-*` | One crate per shipped device, each built as a PIC side module (`device_*.wasm`) |
| `abi` | The device boundary shim — the one place holding `unsafe` in the device path |
| `math`, `dsp`, `value`, `transport`, `voicing`, `signalsmith` | Shared primitives: math, DSP, automation curves, PPQN/transport, polyphony, resampling |
| `stretch`, `stretch-wasm` | A standalone time-stretch core matured in isolation, ahead of replacing `engine/src/time_stretch.rs` |

Two members are deliberately excluded from the workspace (`stretch-lab`, `signalsmith-wasmbench`) because they path-depend on sibling checkouts that don't exist in CI. Build those directly from their own directories.

Everything is `no_std` + `alloc` on the wasm target and builds with `std` for native `cargo test`, so the same code is exhaustively testable on the host and heap-disciplined in the browser.

## Root scripts

From `package.json` at the repo root:

```json
"scripts": {
  "cert": "bash ./scripts/cert.sh",
  "clean": "bash ./scripts/clean.sh",
  "build": "turbo build --output-logs=full",
  "build-wasm": "npm run build:wasm -w @opendaw/studio-core-wasm",
  "dev:studio": "turbo run dev --filter=@opendaw/app-studio",
  "dev:lab": "turbo run dev --filter=@opendaw/lab",
  "dev:nam-test": "turbo run dev --filter=@opendaw/nam-test",
  "dev:yjs-server": "turbo run dev --filter=yjs-server",
  "test": "turbo run test --concurrency=1",
  "lint": "turbo run lint",
  "format": "prettier --write \"**/*.{ts,tsx,md}\"",
  "publish-sdk": "lerna publish"
}
```

The ones you'll use constantly:

- **`npm run dev:studio`** — start the Vite dev server for the web UI at `https://localhost:8080`.
- **`npm run build`** — full Turbo build, ordered by dependencies, with caching. This *includes* compiling the Rust engine.
- **`npm run build-wasm`** — rebuild only the engine + device wasm modules. Much faster than the full build when you're iterating on Rust.
- **`npm run test`** — all TypeScript tests, `--concurrency=1` (to avoid resource contention on workers).
- **`npm run lint`** — ESLint across all packages.
- **`npm run format`** — Prettier on everything (ts/tsx/md).

Node ≥23 is required at the repo root. CI uses Node 22 (a deliberate pin — they want to verify behaviour on the version they ship to). Most local dev works on either.

### The Rust toolchain is a build prerequisite

`npm run build` builds `@opendaw/studio-core-wasm`, whose `build` script shells out to `packages/studio/core-wasm/build-wasm.sh` and runs `cargo`. Without a Rust toolchain the root build fails. What the deploy workflow installs is exactly what you need locally:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
rustup target add wasm32-unknown-unknown
rustup toolchain install nightly --profile minimal --component rust-src
rustup target add wasm32-unknown-unknown --toolchain nightly
brew install binaryen        # or: apt-get install binaryen
```

Two toolchains, for a reason. The engine host module builds on **stable**. The device side modules are position-independent wasm (`-C relocation-model=pic -shared`), and PIC has to reach *every* object linked in — including `core` itself, which ships precompiled non-PIC. Rebuilding `core` as PIC needs `-Zbuild-std`, which is **nightly**-only. `binaryen`'s `wasm-opt` is optional: the build guards on it and ships larger modules if it's missing.

## Turbo: pipeline + caching

`turbo.json` defines the build graph. Two parts matter for contributors:

### The default `build` task

```json
"build": {
    "dependsOn": ["^build"],
    "inputs": ["$TURBO_DEFAULT$", ".env*"],
    "outputs": ["dist/**"]
}
```

`"^build"` means "first build every package this one depends on." So if you run `npm run build` at the root, Turbo topologically sorts the packages and builds them in order. Outputs cached under `dist/**`; second runs are near-instant when nothing changed.

### The forge-generation cascade

```json
"@opendaw/studio-forge-boxes#build": {
    "dependsOn": ["^build"],
    "outputs": ["../boxes/src/**"]
},
"@opendaw/studio-boxes#build": {
    "dependsOn": ["@opendaw/studio-forge-boxes#build"],
    "outputs": ["dist/**"]
},
"@opendaw/studio-core-workers#build": {
    "dependsOn": ["^build"],
    "outputs": ["../core/dist/workers-main.js", "../core/dist/workers-main.js.map"]
},
"@opendaw/studio-core-processors#build": {
    "dependsOn": ["^build"],
    "outputs": ["../core/dist/processors.js", "../core/dist/processors.js.map"]
},
"@opendaw/studio-core#build": {
    "dependsOn": [
        "^build",
        "@opendaw/studio-core-workers#build",
        "@opendaw/studio-core-processors#build"
    ],
    "outputs": ["dist/**"]
}
```

Both bundles land in `core/dist/` rather than their own package's, so `studio-core` ships them as part of its published artifact. `processors.js` registers exactly two worklets — `meter-processor` and `recording-processor`, the ones the studio needs whatever engine is running. The engine's own worklet is `engine-wasm-processor`, which lives in `wasm-processor.js`, is built and published by `studio-core-wasm`, and is added to the context by `WasmEngine.ensureReady`.

### The Rust inputs declaration

The one non-obvious entry is the wasm package's, because its inputs live *outside* its own directory:

```json
"@opendaw/studio-core-wasm#build": {
    "dependsOn": ["^build"],
    "inputs": [
        "$TURBO_DEFAULT$",
        ".env*",
        "$TURBO_ROOT$/crates/**",
        "!$TURBO_ROOT$/crates/target/**"
    ],
    "outputs": ["dist/**"]
}
```

`$TURBO_ROOT$/crates/**` is what makes a Rust edit invalidate the cache — without it, Turbo would happily serve a stale `engine.wasm` after you changed a crate. The `!.../crates/target/**` negation excludes Cargo's own build directory, which would otherwise churn the hash on every compile.

The critical chain when you change a box schema:

```
forge-boxes#build      regenerates  packages/studio/boxes/src/**
         ↓
boxes#build            compiles the generated TypeScript
         ↓
core#build             pulls in the new types
         ↓
app-studio#build       picks up the cascade
```

That's why `npm run build` from the root just works — the dependency graph carries forge's output forward.

The worker and processor packages don't go through `tsc`; they're bundled into single ESM files via `esbuild` (the inputs are TypeScript, the outputs live next to `core/dist/`). This is why the AudioWorklet can `import` them as one URL without needing a separate loader.

## Per-package scripts (the patterns)

There are five shapes a package's `scripts` block can take:

### Library (default)

```json
"scripts": {
  "build": "tsc",
  "lint": "eslint \"**/*.ts\"",
  "test": "vitest run"
}
```

Used by `lib/std`, `lib/dsp`, `studio/core`, `studio/adapters`, etc. Plain TypeScript compilation, ESLint, Vitest.

### Bundled processor / worker

```json
"scripts": {
  "lint": "eslint \"**/*.ts\"",
  "typecheck": "tsc --noEmit",
  "build": "tsc --noEmit && esbuild src/register.ts --bundle --format=esm --platform=browser --minify --sourcemap --outfile=../core/dist/processors.js",
  "test": "vitest run"
}
```

`core-processors` and `core-workers` use this. The `tsc --noEmit` is a type-check pass; `esbuild` does the actual bundling. Output goes into a sibling package's `dist/` so `core` ships them as part of its published artifact.

### Wasm package (three-stage)

```json
"scripts": {
  "build": "npm run build:wasm && npm run build:bundles && npm run build:api",
  "build:wasm": "sh ./build-wasm.sh",
  "build:bundles": "esbuild src/processor.ts --bundle --format=esm --platform=browser --minify --sourcemap --outfile=dist/wasm-processor.js && esbuild src/offline-worker.ts --bundle --format=esm --platform=browser --minify --sourcemap --outfile=dist/wasm-offline-worker.js",
  "build:api": "tsc --project tsconfig.build.json",
  "typecheck": "tsc --noEmit",
  "lint": "eslint \"**/*.ts\"",
  "test": "vitest run"
}
```

Only `studio/core-wasm` looks like this, and the three stages are independent: `build:wasm` runs cargo and emits `dist/wasm/engine.wasm` plus `dist/wasm/plugins/device_*.wasm`; `build:bundles` esbuilds the two entry points the host loads by URL (the worklet module and the offline render worker); `build:api` is a normal `tsc` emitting the package's public types. When you're only iterating on Rust, `npm run build-wasm` from the root runs just the first stage.

### Forge (the generator)

```json
"scripts": {
  "lint": "eslint \"**/*.ts\"",
  "format": "prettier --write \"../boxes/src/**/*.ts\" --ignore-path /dev/null",
  "clear": "rm -rf ../boxes/src/*",
  "build": "npm run clear && npx tsx src/forge.ts && npm run format",
  "test": "echo \"No tests to run\""
}
```

This is the one that *generates code* instead of compiling. `build` clears the output, runs the schema generator (`tsx src/forge.ts`), and prettifies the result. The output is committed (yes — generated files are in version control).

### Web app

```json
"scripts": {
  "dev": "CI=true vite --clearScreen false --host",
  "build": "tsc && vite build",
  "preview": "vite preview --host",
  "lint": "eslint \"src/**/*.ts\""
}
```

The `app/*` packages look like this — Vite for both dev and build. `app/wasm` adds `prebuild` / `predev` hooks that rebuild the wasm modules first, so its dev server always serves a current engine.

## Forge regeneration: the most important workflow you'll learn

When you change a box schema (`packages/studio/forge-boxes/src/schema/...`), the generated TypeScript classes (`packages/studio/boxes/src/*.ts`) **must** be regenerated. Forgetting this is the #1 contributor mistake.

### What you change vs. what gets regenerated

You edit:
```
packages/studio/forge-boxes/src/schema/devices/audio-effects/CompressorDeviceBox.ts
```

Forge regenerates:
```
packages/studio/boxes/src/CompressorDeviceBox.ts                  (the class)
packages/studio/boxes/src/BoxVisitor.ts                            (visitor case)
packages/studio/boxes/src/io.ts                                    (dispatch)
packages/studio/boxes/src/index.ts                                 (exports)
crates/studio-boxes/src/registry.rs                                (the Rust schema registry)
```

Plus any cross-cutting files (`BoxIO.TypeMap`, the visitor union) that mention every box.

**Forge emits Rust too.** `packages/studio/forge-boxes/src/forge.ts` declares a `rust` output target pointing at `../../../crates/studio-boxes/src/registry.rs`, so the engine's schema registry comes out of the same run and the same source schema — there is no second place to keep in sync, and no drift between the TypeScript box classes and what the engine decodes. It also means a schema change touches files in *two* trees, and both belong in your commit.

### Two ways to regenerate

**Targeted** (when iterating on schema):

```bash
cd packages/studio/forge-boxes
npm run build
```

Runs `clear → tsx src/forge.ts → format`. Output appears immediately under `packages/studio/boxes/src/`.

**Full** (when you want everything coherent):

```bash
npm run build  # from the repo root
```

Turbo sees forge-boxes changed, runs its build, sees `boxes` depends on that, rebuilds it, and so on up the chain. Slower but guaranteed coherent.

### Committing generated files

The `packages/studio/boxes/src/` files are *generated*, but they **are committed**. That's intentional — TypeScript needs them to resolve imports, and you don't want every contributor to have to run forge before they can typecheck. So:

- When you change a schema, commit *both* the schema change *and* the regenerated files.
- The generated files have a banner `// auto-generated | do not edit`. Respect it; if your IDE wants to tidy them, undo.
- If a reviewer sees a schema change without matching generated changes, that's a bug.

### No pre-commit hook

The repo has no `.husky/` or `pre-commit` configuration. Forge regeneration is on the contributor's discipline, not automated. If you forget, the build fails at the typecheck step on `npm run build`. Only engine changes get automatic CI (see the CI/CD section below); everything else is unverified until someone builds locally — which is why running `npm run build` before committing is non-negotiable.

## Tests

Three suites, run three different ways.

### The TypeScript suite (Vitest)

`.test.ts` files colocated with source (`x.ts` and `x.test.ts` in the same folder). The heaviest concentrations:

| Package | Tests | Notes |
|---|---|---|
| `lib/std` | 28 | Option, UUID, Observable, lang helpers |
| `lib/dsp` | 12 | DSP primitives, PPQN, tempo math |
| `lib/box` | 4 | Graph transactions, editing, addressing |
| `lib/inference` | 7 | ML inference helpers |
| `studio/core` | 25 | Project, sample manager, dawproject round-trips |
| `studio/adapters` | 14 | Adapter coverage |
| `studio/p2p` | 9 | P2P sync |

Run them with:

```bash
npm run test              # all packages, sequentially
cd packages/lib/std && npm run test    # one package
```

The `--concurrency=1` on the root `test` script matters: many tests spawn Web Workers, and running multiple packages in parallel can saturate the event loop on slower machines.

Note that the root `test` script deliberately stays Rust-free — it does not cover the engine.

### The Rust suite (cargo)

Native `cargo test` across the whole crate workspace. Every engine crate builds with `std` on the host, so the DSP, box-graph mirror, transport math, and time-stretch logic are all exhaustively testable without a browser:

```bash
cargo test --manifest-path crates/Cargo.toml --workspace
# or, from the wasm app:
npm run test:rust -w @opendaw/app-wasm
```

### The engine behaviour suite (`app/wasm`)

`packages/app/wasm/test/` is the largest single suite in the repo — dozens of tests that boot the real wasm engine, feed it a project, render, and assert on the resulting audio: per-device renders, freeze pipeline, clip and region playback, sidechain taps, live meter teardown, heap-cycle probes, fuzzers for enable/disable and chain edits.

```bash
npm run test -w @opendaw/app-wasm     # builds the wasm, then runs cargo + the render tests
```

The `pretest:parity` hook rebuilds the wasm modules first, so this command is self-contained but slow. If you're iterating and the wasm is already current, run `npx vitest run --config vitest.config.ts` from `packages/app/wasm` directly.

### Vitest config quirks

`packages/studio/core/vitest.config.ts` uses `environment: "jsdom"` (for DOM-touching code) and aliases `@test-files` to `test-files/` at the repo root. If your test needs an audio fixture, put it under `test-files/` and import as `@test-files/foo.wav`.

## Code conventions — the openDAW `CLAUDE.md`

The repo root has its own `CLAUDE.md` that codifies the coding style. These rules are enforced by reviewers (no pre-commit hook). Verbatim:

```
- Minimize comments. Code should be self-explanatory. Only add comments when the
  logic is truly non-obvious.
- No blank lines inside methods. Keep method bodies compact without empty line
  separators.
- Keep destructuring compact. Group multiple destructured properties on the same
  line rather than one per line.
- Never use single-letter abbreviations in lambdas. Use descriptive names like
  `entry`, `text`, `value`, `event`, etc.
- Use types and functions from `@opendaw/lib-std` instead of inline checks:
  - Use `Optional<T>` instead of `T | undefined`
  - Use `Nullable<T>` instead of `T | null`
  - Use `isDefined(value)` instead of `value !== undefined` or `value !== null`
  - Use `!isDefined(value)` instead of `value === undefined` or `value === null`
  - Use `isAbsent(value)` instead of `value === undefined || value === null`
  - Never use falsy checks like `!value` or `if (!value)` for null/undefined
    checks — always use `!isDefined(value)` or `isAbsent(value)`
  - Never write `| null` or `| undefined` inline — always use the lib-std types.
  - Use `MutableObservableOption<T>` instead of `DefaultObservableValue<Nullable<T>>`.
    Use `wrap(value)` / `clear()` instead of `setValue(value)` / `setValue(null)`.
- Never use `!` definite assignment assertions to suppress compiler errors.
  Create elements as `const` upfront and embed them in JSX with `{el}`.
- Use the `.hidden` CSS class instead of `element.style.display = "none"`.
- Never use `as any` — always define proper types instead.
- Never use `try/catch` — use `tryCatch()` from `@opendaw/lib-std`.
- Never use `"foo" in bar` for type checks — use proper type guards.
- Never use `Set` / `Map` with `UUID.Bytes` — use `UUID.newSet` / `UUID.newMap`
  (SortedSet) for correct byte-level comparison.
- Use `Option<T>`, not `Optional<T>`, for fallible return types.
- Use the actual type from its source — never create ad-hoc structural types
  like `{ name: string, value: number }` when a proper type exists.
- Move complex field initializations into the constructor rather than using
  inline field initializers.
- Always use `--noEmit` when type-checking to avoid generating waste `.js` / `.d.ts` files.
```

A few of these have non-obvious motivations worth knowing:

- **`tryCatch()` over `try/catch`** — the helper returns a `Result<T, E>` discriminated union. It composes with other monadic code in lib-std and you never accidentally swallow an exception by writing an empty `catch`.
- **`UUID.newSet` / `UUID.newMap`** — JavaScript's `Set`/`Map` compare by reference for objects, not by content. UUIDs are `Int8Array`-backed, so two byte-identical UUIDs would not be equal in a plain `Set`. The lib-std variants use sorted byte comparison.
- **`Option<T>` vs `Optional<T>`** — `Optional<T>` is the type alias `T | undefined`; `Option<T>` is the monadic wrapper (`Some` / `None`). Use `Optional` when an absence is just "nothing happened"; use `Option` when you want to chain `.map`/`.match`/`.unwrap`.
- **No `as any`** — the codebase has a near-total ban. If you're stuck on a typing problem, ask for help rather than escape with `as any`. Most "needs `any`" problems have a Vertex type or a visitor pattern that solves them.

### ESLint enforcement

`packages/config/eslint/index.js` adds one mechanical guard worth knowing:

```javascript
"no-restricted-imports": ["error", {
    "patterns": [{
        "group": ["**/src/**", "@opendaw/*/src/**"],
        "message": "Direct imports from src folders are not allowed. Use package exports instead."
    }]
}]
```

If you find yourself writing `import { X } from "@opendaw/studio-core/src/Foo"`, ESLint stops you. Use the published surface (`import { X } from "@opendaw/studio-core"`). This keeps encapsulation honest.

## `plans/` — the contribution-design folder

`plans/` holds about fifty markdown files, each describing the design of a non-trivial change. The `README.md` policy:

> "AI-assisted code is fine, but every contributor must **understand every line of code they submit**. If you use AI tools, please document your process in `/plans`. Keep pull requests small and focused. Large PRs will not be reviewed."

The convention for a plan file (see `plans/base-frequency.md`, `plans/audio-region-fades.md`, etc.):

1. **Context** — what's the problem, why does it matter, what's the current state.
2. **Call site analysis** — a table of every place the new feature lands (file, line, thread, dependencies).
3. **Overview of changes** — numbered list of files to add/modify with the key snippets.
4. **Key files modified** — summary table for reviewers.
5. **Notes** — edge cases, deferred work, caveats.

Existing plans cover: device additions (Apparat, Vocoder, NAM), feature work (Audio region fades, capture MIDI, freeze AudioUnit), refactors (parameter wrapper, automation), and UI changes (device selection, preset browser).

When you open a PR for a non-trivial change, a matching plan file should land in the same PR. For a one-line bugfix you can skip it; for "add a new device" it's expected.

## CI/CD

`.github/workflows/` contains a small number of workflows. Two matter.

**`deploy.yml`** — ships the studio to production:

- Triggered only via `workflow_dispatch` (manual button click).
- Installs Node 22 **and** the Rust toolchains + binaryen, runs `npm ci`, fetches the GitHub sponsor list, `npm run build`, then deploys over SFTP.
- **No test step.** Tests are the contributor's responsibility.
- **No automatic PR gating.** PRs run no checks; only manual review.

**`parity.yml`** — the engine's test harness, and the only workflow that runs automatically:

- Triggers on `push` when `crates/**`, `packages/app/wasm/**`, or the workflow itself changes (plus `workflow_dispatch`).
- Installs stable + nightly Rust with the `wasm32-unknown-unknown` target, builds `@opendaw/app-wasm`'s dependencies via `npx turbo run build --filter=@opendaw/app-wasm^...`, then runs `npm run test -w @opendaw/app-wasm` — the full cargo workspace plus the engine render tests.
- It's kept separate from the main `turbo test` run precisely so that suite stays Rust-free.

Practically this means: **`npm run lint && npm run test && npm run build` before you push**, and if you touched `crates/`, `npm run test -w @opendaw/app-wasm` too. Everything except the engine path is unverified until someone builds locally, and that someone might be you on the next branch.

Other workflows (`deploy-wasm.yml`, `discord.yml`, `test-sftp.yml`, `deploy-yjs.yml`, `restart-yjs.yml`) are deploy and notification utilities; they don't gate code.

## Dev server

```bash
npm install
npm run cert        # one-time: generate localhost.pem + localhost-key.pem
npm run build       # one-time: hydrate Turbo cache
npm run dev:studio  # repeatedly: start the Vite dev server
```

You should see Vite listening on **`https://localhost:8080`**. Notice the `https://` — it's mandatory:

1. `SharedArrayBuffer` requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (see [ch. 03 COOP/COEP](./03-cross-thread-protocols.md#coop--coep--required-browser-headers)).
2. These headers are only honoured under HTTPS by most browsers in modern releases.

`scripts/cert.sh` uses `mkcert` to generate a locally-trusted cert. If you skip this step, the dev server falls back to HTTP, the engine fails to initialize, and you'll get a misleading "engine could not start" error in the console.

The Vite config (`packages/app/studio/vite.config.ts`) sets the headers explicitly:

```typescript
server: {
    port: 8080,
    host: "localhost",
    https: { /* cert paths */ },
    headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "cross-origin"
    }
}
```

When you deploy to production, the SFTP target server has to send the same headers. The pattern repeats in the `vercel.json` of the documentation site too (see this docs repo).

## Vite build specifics

The studio app's Vite build (`packages/app/studio/vite.config.ts`) does a few things you'd want to know if you touched its config:

1. **UUID-based filenames.** Each build generates a fresh UUID and stamps every bundle filename with it (`name.{uuid}.js`). This is for cache busting at the CDN.
2. **`modulePreload: false`.** The default modulepreload polyfill injection conflicts with the worker bootstrap; disabled by design.
3. **`optimizeDeps.exclude`** for big libraries (`@ffmpeg/ffmpeg`, `monaco-editor`, `onnxruntime-web`). They're pre-bundled themselves and shouldn't go through Vite's dep optimizer.
4. **Branch-aware base path.** In CI, `BRANCH_NAME` env determines whether output goes to `/main/releases/{uuid}/` or `/dev/releases/{uuid}/`. The studio is served from a Cloudflare-style versioned-path scheme so old builds remain reachable.
5. **Brotli compression** via `vite-plugin-compression`.

If you add a new bundled worklet or worker entry point, you'll likely need to add an `esbuild` invocation in the relevant package's `build` script (matching the pattern in `core-wasm`'s `build:bundles` or `core-workers`) and an output declaration in `turbo.json`. Forgetting the latter means Turbo won't cache it and re-runs every time.

## How to create a proper PR

This is the section you came for. Here's the canonical flow.

### One-time setup

```bash
git clone https://github.com/andremichelle/openDAW.git
cd opendaw
npm install
npm run cert
npm run build            # needs the Rust toolchains — see "The Rust toolchain is a build prerequisite"
npm run dev:studio       # confirm it boots on https://localhost:8080
```

### Branch + change

```bash
git checkout -b feature/short-descriptive-name
```

### Iterate (the inner loop)

For most changes, the inner loop is:

```bash
# Edit code in your editor
npm run lint                # check ESLint as you go
cd packages/<the-one>
npm run test                # test the specific package
cd ../../..
npm run build               # full build when you're ready to verify
```

If the dev server is running (`npm run dev:studio` in another terminal), Vite reloads automatically on most changes — except when:

- You changed a box schema (run forge regen first; see next section).
- You changed the worklet/worker bundles (run `npm run build` to re-bundle).
- You changed anything under `crates/` (run `npm run build-wasm`, then reload).

### If you changed a box schema

This is the most common contributor pitfall. After editing anything under `packages/studio/forge-boxes/src/schema/`:

```bash
cd packages/studio/forge-boxes
npm run build                # regenerates ../boxes/src/** AND crates/studio-boxes/src/registry.rs
cd ../../..
npm run build                # rebuilds boxes -> core -> app, and the wasm engine
git status                   # confirm the regenerated files appear in BOTH trees
git add packages/studio/forge-boxes/ packages/studio/boxes/ crates/studio-boxes/
```

**All three** — the schema change, the regenerated TypeScript, and the regenerated Rust registry — belong in the commit. A schema-only diff will leave the repo in an inconsistent state and the build on the next person to pull will fail.

### Pre-PR checklist

Before opening the PR, run all three:

```bash
npm run lint              # all packages ESLint-clean
npm run test              # all tests pass (sequential)
npm run build             # full build succeeds, no type errors
```

Then:

- Confirm any generated files (`packages/studio/boxes/src/`, `crates/studio-boxes/src/registry.rs`) are committed.
- If the change is non-trivial: write a `plans/your-feature.md` documenting the design ([see plans format](#plans--the-contribution-design-folder)).
- If you used AI assistance: document the process in the plan file. The maintainer expects this.

### PR shape

Per the README:

> "Keep pull requests small and focused. Large PRs will not be reviewed. Split big contributions into smaller commits that add requirements gradually and maintain operations of the app."

A good PR for adding a new device looks like this:

- **Title:** `feat: add SidechainCompressor audio effect` (under ~70 chars, conventional commit prefix).
- **Body:**
  - 1–3 sentence summary.
  - List of files modified (or `git diff --stat` output if many).
  - A note on testing — what you verified locally.
  - Link to the `plans/sidechain-compressor.md` file if applicable.
- **Commits:** ideally one logical commit per layer (schema + regen → adapter → device crate → build + module registrations → UI panel), or one squashed commit if the change is small.
- **Diff scope:** one feature. Don't bundle "add new effect" with "refactor the channel strip."

### After opening

PRs don't have automated CI gates; review is the gate. Expect a maintainer to:

- Read every line — per the policy, you should be able to explain every line too.
- Verify it still builds (`npm run build`) and tests still pass.
- Check that generated files match the schema.
- Confirm the change is small and focused.

Push additional commits to address feedback; don't force-push during review (it loses the review thread). Once approved, the maintainer merges (usually squash).

## Common PR mistakes (the ones reviewers see most)

In rough order of frequency:

1. **Schema change without regeneration.** The schema file diff is there, but `packages/studio/boxes/src/` and `crates/studio-boxes/src/registry.rs` are unchanged. Run `cd packages/studio/forge-boxes && npm run build`, then `git add` both trees.
2. **Generated file edits.** Someone hand-edits a file under `packages/studio/boxes/src/` (it has the "do not edit" banner) and their changes get blown away the next time someone runs forge. Edit the schema instead.
3. **New device added but not registered in all three places.** A device is only reachable when its crate is built *and* its module is loaded *and* its box type is mapped. Miss any one and the engine's `device_for_type(box_type)` lookup returns nothing — no panic, no error, the unit just renders silence, which is a miserable thing to debug. The three places:
   - a crate under `crates/stock-devices/device-<name>/`;
   - its crate name appended to `DEVICE_CRATES` in `packages/studio/core-wasm/build-wasm.sh` (this is what builds and copies `device_<name>.wasm`);
   - a `{url, boxType}` entry in the `DEVICES` list in `packages/studio/core-wasm/src/engine-modules.ts`, mapping the wasm module to the box type it realises.

   See [ch. 05's worked example](./05-devices-and-effects.md) for the full walkthrough.
4. **`as any` or `try/catch` slipped in.** Both are banned by `CLAUDE.md`; reviewers reject these. Use `tryCatch()` from `@opendaw/lib-std` and proper types.
5. **Field renumbering on an existing box.** Field keys are stable forever (see [ch. 02 invariants](./02-box-system.md#critical-invariants)). Renumbering breaks every saved project.
6. **Import from `@opendaw/foo/src/...`.** ESLint catches it, but only at lint time. Use the package's public exports.
7. **PR too large.** A common ask: split into one PR per box, then one PR per device crate, with a `plans/` file linking them together. Maintainer's review bandwidth is finite.
8. **Lint or test was skipped.** No pre-commit hook means it's on you. `npm run lint && npm run test && npm run build` before `git push`.

## Critical invariants for contributors

If you read nothing else, read this list:

1. **Schema and generated files travel together.** Both in the same commit. Both in the same PR. "Generated" means the TypeScript box classes *and* `crates/studio-boxes/src/registry.rs`.
2. **`packages/studio/boxes/src/` is read-only at the human level.** All edits go through the schema and forge. So is the Rust registry.
3. **`npm run build` is the canonical gate.** If that succeeds, your types resolve and the engine compiles; if it fails, fix it before pushing.
4. **Tests are local-only outside the engine.** `parity.yml` covers `crates/**` and `packages/app/wasm/**` on push; everything else is your discipline.
5. **Stick to the CLAUDE.md style.** Reviewers don't bend on `Option<T>`, `tryCatch()`, `UUID.newSet`, or the `as any` ban.
6. **Field keys, pointer types, and resource types are forever.** Adding new ones is free; changing existing ones breaks the wild.
7. **HTTPS + COOP/COEP everywhere.** Dev server, deployed app, docs site, anywhere `SharedArrayBuffer` lives.
8. **Big PRs get rejected.** Split. Even if it's already done, split it.

## Further reading

- **`README.md`** at the repo root — the contribution policy, link to discord, ambassadors.
- **`CLAUDE.md`** at the repo root — the canonical coding-style rulebook.
- **`plans/`** — every existing design doc. Skim a few to see the format before writing your own. `plans/wasm-audio/` is the engine's own design record.
- **`turbo.json`** — when you need to understand why a build cascaded the way it did, the answers are here.
- **`packages/studio/core-wasm/build-wasm.sh`** — the wasm build in full, and the best single explanation of why the devices need nightly Rust.
- **`crates/Cargo.toml`** — the workspace membership and the per-crate optimisation profiles.
- **[Ch. 02 — Box System](./02-box-system.md#forge--code-generation)** for what forge generates and the schema shape.
- **[Ch. 03 — Cross-Thread Protocols](./03-cross-thread-protocols.md#coop--coep--required-browser-headers)** for why HTTPS + COOP/COEP are mandatory.
- **[Ch. 05 — Devices and Effects](./05-devices-and-effects.md)** for the canonical "add a new device" walkthrough; this chapter's PR workflow assumes you're following that shape.

That's the whole guided tour. From clone to commit, you now have the map.
