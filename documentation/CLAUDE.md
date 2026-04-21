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
- Never reference openDAW internal source paths (`packages/studio/...`) in documentation chapters — use npm package import references (e.g., `CompressorDeviceBox` from `@opendaw/studio-boxes`)
