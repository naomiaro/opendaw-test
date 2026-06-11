# Demo Audit Wave 3 — Playback Rest

Branch: `demo-audit-wave-3-playback-rest`. Spec: `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md`.
Delete this plan in the PR that completes the wave.

## Scope

Audit + restyle (mastering-console design via `src/lib/design/consoleTheme.ts`):
- `src/demos/playback/time-pitch-demo.tsx` (742 lines) — carry-over: switch raw cents math to `AudioTimeStretchBoxAdapter.cents`
- `src/demos/playback/mixer-groups-demo.tsx` (580)
- `src/demos/playback/drum-scheduling-demo.tsx` (754)
- `src/demos/playback/comp-lanes-demo.tsx` (760)

Correctness-only (NO restyle — unlisted debug pages):
- `comp-lanes-debug-demo.tsx` (813), `fade-out-end-of-file-debug-demo.tsx` (326),
  `pure-webaudio-target-debug-demo.tsx` (857), `shared-source-double-process-debug-demo.tsx` (747),
  `time-pitch-start-position-debug-demo.tsx` (711), `voice-fadein-clip-fadein-product-debug-demo.tsx` (570)

## Ground rules (from waves 1–2)

- Source verification: tag-pinned `git show` ONLY against `/Users/naomiaro/Code/openDAW`
  (`@opendaw/studio-adapters@0.0.116`, `@opendaw/studio-core@0.0.152`, `@opendaw/studio-boxes@0.0.94`
  via forge-boxes; SDK meta 0.0.154). Never read the working tree.
- Restyle = chrome only: kicker / mc-title / mc-intro / mc-anchors / mc-lattice-frame; controls
  untouched; copy verbatim unless the audit falsifies it; regenerate og-images (1200x630).
- Behavior-affecting audio changes (the cents carry-over) require `/audio-verify` or an explicit
  stated skip justification in the PR.
- Repo-wide grep sweep after every semantic correction (stale-comment survivors were the
  recurring wave-1/2 failure mode).
- Verify with `npx tsc --noEmit` + `npm test` + `npm run build`; LSP is advisory only.

## Tasks

1. **Source audit** — extract every SDK claim the 10 files rely on (inline comments, derived
   behavior, CLAUDE.md statements they exercise); verify each at the pinned tags; produce a
   findings table (confirmed / nuanced / wrong) that feeds tasks 2–6 and the PR body.
2. **time-pitch-demo** — apply audit findings, switch to `AudioTimeStretchBoxAdapter.cents`
   (verify the adapter's clamp/rounding semantics first), restyle, og-image.
3. **mixer-groups-demo** — audit findings, restyle, og-image.
4. **drum-scheduling-demo** — audit findings, restyle, og-image.
5. **comp-lanes-demo** — audit findings, restyle, og-image.
6. **Debug pages correctness pass** — fix wrong claims/comments and real bugs in the 6 debug
   pages; no visual changes; keep their experiment narratives intact (they document
   investigations — only correct what the source audit falsified).
7. **Close-out** — repo-wide consistency sweeps, wave final review (2 rounds), PR with findings
   table, comprehensive PR review round (fix Critical+Important, comment the round), report.

Each of tasks 2–6: fresh implementer subagent + spec-compliance review + code-quality review.
