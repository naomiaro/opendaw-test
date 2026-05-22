# Repo Layout and Dev Workflow

> **Audience:** contributors to openDAW. This is the final internals chapter — the practical "how do I actually work on this repo" guide. After this, you should be able to clone, build, test, change a box, regenerate, and submit a PR that lands.
>
> **Prereqs:** the previous six chapters get you the *what*. This chapter is the *how*.

If chapters 01–06 told you what every layer of openDAW is, this one tells you the mechanics of being a contributor: where the code lives, how the build works, which commands matter, and — most importantly — how to ship a PR without breaking anything.

## Top-level layout

The repo (`github.com/andremichelle/openDAW`) is a Lerna + Turbo monorepo with npm workspaces. Top-level directories:

| Path | What's in it |
|---|---|
| `packages/` | All source code, organized by domain (see below) |
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
│   ├── core-processors/              AudioWorkletProcessor code (ch. 01, 05)
│   ├── core-workers/                 Web Worker code: peaks, OPFS, offline (ch. 03, 04)
│   ├── scripting/                    user-script execution for modular devices
│   ├── p2p/                          peer-to-peer collaboration (experimental)
│   └── sdk/                          public SDK meta-package
├── app/
│   └── studio/                       the web UI (Vite + JSX)
└── server/
    └── (yjs-server, deploy support)
```

The packages most contributors touch are: `studio/forge-boxes`, `studio/boxes` (read-only — generated), `studio/core-processors`, `studio/adapters`, and `studio/core`. The rest are mature foundations you usually consume rather than change.

## Root scripts

From `package.json` at the repo root:

```json
"scripts": {
  "cert": "bash ./scripts/cert.sh",
  "clean": "bash ./scripts/clean.sh",
  "build": "turbo build --output-logs=full",
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

The five you'll use constantly:

- **`npm run dev:studio`** — start the Vite dev server for the web UI at `https://localhost:8080`.
- **`npm run build`** — full Turbo build, ordered by dependencies, with caching.
- **`npm run test`** — all tests, `--concurrency=1` (to avoid resource contention on workers).
- **`npm run lint`** — ESLint across all packages.
- **`npm run format`** — Prettier on everything (ts/tsx/md).

Node ≥23 is required at the repo root. CI uses Node 22 (a deliberate pin — they want to verify behaviour on the version they ship to). Most local dev works on either.

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

There are four shapes a package's `scripts` block can take:

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

Only `app/studio` looks like this. Vite for both dev and build.

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
```

Plus any cross-cutting files (`BoxIO.TypeMap`, the visitor union) that mention every box.

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

The repo has no `.husky/` or `pre-commit` configuration. Forge regeneration is on the contributor's discipline, not automated. If you forget, the build fails at the typecheck step on `npm run build`. CI doesn't run tests, only deploys (see below), so the failing build won't be visible until someone tries to build locally — which is why running `npm run build` before committing is non-negotiable.

## Tests

Vitest, ~80 `.test.ts` files spread across packages, colocated with source (`x.ts` and `x.test.ts` in the same folder). The breakdown (by approximate file count):

| Package | Tests | Notes |
|---|---|---|
| `lib/dsp` | 12 | DSP primitives, PPQN, tempo math |
| `lib/std` | 6 | Option, UUID, Observable, lang helpers |
| `lib/box` | 4 | Graph transactions, editing, addressing |
| `lib/runtime` | 1 | Communicator round-trip |
| `lib/fusion` | 3 | Peaks, broadcasters |
| `lib/xml`, `lib/dawproject` | 2 each | XML round-trip, DAW Project import/export |
| `studio/core` | 3 | Sample manager, project mutations |
| `studio/adapters` | 1 | Adapter coverage |
| `studio/p2p` | 1 | P2P sync |

Run them with:

```bash
npm run test              # all packages, sequentially
cd packages/lib/std && npm run test    # one package
```

The `--concurrency=1` on the root `test` script matters: many tests spawn Web Workers, and running multiple packages in parallel can saturate the event loop on slower machines.

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

`.github/workflows/` contains a small number of workflows. The main one is `deploy.yml`:

- Triggered only via `workflow_dispatch` (manual button click).
- Runs `npm ci`, fetches GitHub sponsor list, `npm run build`, then deploys to production over SFTP.
- **No test step.** Tests are the contributor's responsibility.
- **No automatic PR gating.** PRs run no checks; only manual review.

Practically this means: **`npm run lint && npm run test && npm run build` before you push.** If any of those fail locally, your PR will fail the next time someone tries to build, and that someone might be you on the next branch.

Other workflows (`discord.yml`, `test-sftp.yml`, `deploy-yjs.yml`, `restart-yjs.yml`) are deploy and notification utilities; they don't gate code.

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

If you add a new worklet processor or a new bundled worker, you'll likely need to add an `esbuild` invocation in the relevant package's `package.json` `build` script (matching the pattern in `core-processors`/`core-workers`) and an output declaration in `turbo.json`. Forgetting the latter means Turbo won't cache it and re-runs every time.

## How to create a proper PR

This is the section you came for. Here's the canonical flow.

### One-time setup

```bash
git clone https://github.com/andremichelle/openDAW.git
cd opendaw
npm install
npm run cert
npm run build
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

### If you changed a box schema

This is the most common contributor pitfall. After editing anything under `packages/studio/forge-boxes/src/schema/`:

```bash
cd packages/studio/forge-boxes
npm run build                # regenerates ../boxes/src/**
cd ../../..
npm run build                # rebuilds boxes -> core -> app
git status                   # confirm the regenerated files appear
git add packages/studio/forge-boxes/ packages/studio/boxes/
```

**Both** the schema change *and* the regenerated files belong in the commit. A schema-only diff will leave the repo in an inconsistent state and CI on the next person to pull will fail.

### Pre-PR checklist

Before opening the PR, run all three:

```bash
npm run lint              # all packages ESLint-clean
npm run test              # all tests pass (sequential)
npm run build             # full build succeeds, no type errors
```

Then:

- Confirm any generated files (`packages/studio/boxes/src/`) are committed.
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
- **Commits:** ideally one logical commit per layer (schema + regen → adapter → processor → factory + registrations → UI panel), or one squashed commit if the change is small.
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

1. **Schema change without regeneration.** The schema file diff is there, but `packages/studio/boxes/src/` files are unchanged. Run `cd packages/studio/forge-boxes && npm run build`, then `git add` the result.
2. **Generated file edits.** Someone hand-edits a file under `packages/studio/boxes/src/` (it has the "do not edit" banner) and their changes get blown away the next time someone runs forge. Edit the schema instead.
3. **New effect added but `DeviceProcessorFactory` not updated.** The `asDefined()` wrapper means the engine panics at runtime when it encounters the new box type. See [ch. 05's worked example](./05-devices-and-effects.md#how-to-add-a-new-effect-full-walkthrough).
4. **`as any` or `try/catch` slipped in.** Both are banned by `CLAUDE.md`; reviewers reject these. Use `tryCatch()` from `@opendaw/lib-std` and proper types.
5. **Field renumbering on an existing box.** Field keys are stable forever (see [ch. 02 invariants](./02-box-system.md#critical-invariants)). Renumbering breaks every saved project.
6. **Import from `@opendaw/foo/src/...`.** ESLint catches it, but only at lint time. Use the package's public exports.
7. **PR too large.** A common ask: split into one PR per box, then one PR per processor, with a `plans/` file linking them together. Maintainer's review bandwidth is finite.
8. **Lint or test was skipped.** No pre-commit hook means it's on you. `npm run lint && npm run test && npm run build` before `git push`.

## Critical invariants for contributors

If you read nothing else, read this list:

1. **Schema and generated files travel together.** Both in the same commit. Both in the same PR.
2. **`packages/studio/boxes/src/` is read-only at the human level.** All edits go through the schema and forge.
3. **`npm run build` is the canonical gate.** If that succeeds, your types resolve; if it fails, fix it before pushing.
4. **Tests are local-only.** CI doesn't run them. Your discipline is the only gate.
5. **Stick to the CLAUDE.md style.** Reviewers don't bend on `Option<T>`, `tryCatch()`, `UUID.newSet`, or the `as any` ban.
6. **Field keys, pointer types, and resource types are forever.** Adding new ones is free; changing existing ones breaks the wild.
7. **HTTPS + COOP/COEP everywhere.** Dev server, deployed app, docs site, anywhere `SharedArrayBuffer` lives.
8. **Big PRs get rejected.** Split. Even if it's already done, split it.

## Further reading

- **`/Users/naomiaro/Code/openDAWOriginal/README.md`** — the contribution policy, link to discord, ambassadors.
- **`/Users/naomiaro/Code/openDAWOriginal/CLAUDE.md`** — the canonical coding-style rulebook.
- **`/Users/naomiaro/Code/openDAWOriginal/plans/`** — every existing design doc. Skim a few to see the format before writing your own.
- **`/Users/naomiaro/Code/openDAWOriginal/turbo.json`** — when you need to understand why a build cascaded the way it did, the answers are here.
- **[Ch. 02 — Box System](./02-box-system.md#forge--code-generation)** for what forge generates and the schema shape.
- **[Ch. 03 — Cross-Thread Protocols](./03-cross-thread-protocols.md#coop--coep--required-browser-headers)** for why HTTPS + COOP/COEP are mandatory.
- **[Ch. 05 — Devices and Effects](./05-devices-and-effects.md#how-to-add-a-new-effect-full-walkthrough)** for the canonical "add a new device" walkthrough; this chapter's PR workflow assumes you're following that shape.

That's the whole guided tour. From clone to commit, you now have the map.
