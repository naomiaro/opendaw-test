# Documentation (VitePress)

## Structure
- Config: `documentation/.vitepress/config.ts`
- Output: `dist/docs/` (coexists with Vite demo output in `dist/`)
- Base path: `/docs/` — all VitePress internal links resolve under this prefix

## Gotchas
- `README.md` is the docs homepage — VitePress `rewrites` maps it to `index.md` at build time. Do NOT rename to `index.md` (breaks GitHub folder rendering)
- VitePress validates internal markdown links at build time — stale references fail the build
- Sitemap `hostname` ignores VitePress `base` config — use `transformItems` to prepend `/docs/`
- Adding/renaming a chapter: update sidebar in `.vitepress/config.ts` and fix cross-references
- VitePress 1.x bundles React 18 via `@docsearch/js@3.x` (unused — we use local search). After installing/updating VitePress, regenerate `package-lock.json` with `npm install` or Cloudflare's `npm ci` will fail
- **User handbook chapters** (`documentation/01-*.md` through `12-*.md`, `00-system-architecture.md`, and `documentation/README.md`): never reference openDAW internal source paths (`packages/studio/...`) — use npm package import references (e.g., `CompressorDeviceBox` from `@opendaw/studio-boxes`). This audience builds apps against the SDK and shouldn't depend on the upstream repo layout.
- **Internals chapters** (`documentation/internals/`): internal source paths are allowed and encouraged, since the audience is reading or contributing to the openDAW codebase itself. Cite paths like `packages/studio/core-processors/src/EngineProcessor.ts:350` so contributors can navigate to the entry point. Treat line numbers as approximate — they decay over time.
- **Demo links from chapter docs** use the production URL: `[Recording API Demo](https://opendaw-test.pages.dev/recording-api-react-demo.html)`. Don't use relative paths — VitePress base is `/docs/`, demos live at root, and a relative link would resolve to a 404.
- Use present-tense framing — describe the current contract as fact, not "as of SDK X.Y.Z". The `changelogs/` folder is the durable record of *when* changes happened; chapter docs describe *what's true now*. Version qualifiers in prose decay over time.
- Mermaid cross-subgraph edges collide with destination subgraph titles — mermaid routes edges through the top of the subgraph where the title lives. Workaround: drop subgraphs and use `classDef` color coding to convey grouping, or shorten subgraph titles to one word. Verify visually via Playwright on the running docs server (`localhost:5174/docs/...`, screenshot `svg[id^="mermaid"]`) — text review of the mermaid source misses this.
