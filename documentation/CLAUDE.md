# Documentation (VitePress)

## Structure
- Config: `documentation/.vitepress/config.ts`
- Output: `dist/docs/` (coexists with Vite demo output in `dist/`)
- Base path: `/docs/` — all VitePress internal links resolve under this prefix

## Gotchas
- VitePress validates internal markdown links at build time — stale references fail the build
- Sitemap `hostname` ignores VitePress `base` config — use `transformItems` to prepend `/docs/`
- Adding/renaming a chapter: update sidebar in `.vitepress/config.ts` and fix cross-references
