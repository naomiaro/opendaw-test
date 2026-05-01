# Debug investigations

Documented bugs and open questions from working with the OpenDAW SDK. Each file describes a specific behaviour, the mechanism (verified against current SDK source), and how to reproduce it using one of the unlisted debug demo pages.

## Conventions

- **One file per investigation.** Filename in kebab-case, descriptive, no date or number prefix. Sort by topic, not chronology.
- **Each note states the SDK version it was verified against.** Code citations (file:line) are point-in-time and decay — re-verify before quoting.
- **Each note ends with a clear ask** — either "expected behaviour, document the contract" or "should the SDK do X instead." The audience is the OpenDAW maintainers, so the question must be answerable.
- **Repro pages are unlisted.** They live alongside the regular demos but are not added to `src/index.tsx` or `public/sitemap.xml`. The HTML carries `<meta name="robots" content="noindex, nofollow">`. They're reachable only by direct URL and are intentionally minimal — one button, one configuration, one thing to listen for.

## Index

- [splice-click-cross-file.md](./splice-click-cross-file.md) — Click at exact region boundaries when consecutive same-track regions reference different audio files. Repro: [`comp-lanes-debug-demo.html`](../comp-lanes-debug-demo.html).
