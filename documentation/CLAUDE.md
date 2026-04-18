# Documentation (VitePress)

## Structure
- Config: `documentation/.vitepress/config.ts`
- Output: `dist/docs/` (coexists with Vite demo output in `dist/`)
- Base path: `/docs/` — all VitePress internal links resolve under this prefix

## Gotchas
- VitePress validates internal markdown links at build time — stale references fail the build
- Sitemap `hostname` ignores VitePress `base` config — use `transformItems` to prepend `/docs/`
- Adding/renaming a chapter: update sidebar in `.vitepress/config.ts` and fix cross-references
- VitePress 1.x bundles React 18 via `@docsearch/js@3.x` (unused — we use local search). After installing/updating VitePress, regenerate `package-lock.json` with `npm install` or Cloudflare's `npm ci` will fail
