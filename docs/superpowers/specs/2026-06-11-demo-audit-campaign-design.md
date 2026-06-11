# Demo Audit Campaign — Design

**Date:** 2026-06-11
**Status:** Approved scope (all demos, in waves), pre-execution
**Design language:** `docs/design/2026-06-11-mastering-console-editorial.md`

## Purpose

Audit every demo on three dimensions, category by category, one PR per wave:

1. **Is everything correct?** — verify each SDK call against the openDAW source
   (active checkout per `.claude/local.md`, tags fetched, compared at the installed
   `@opendaw/studio-sdk` version) and against the category CLAUDE.md's claims; run
   the demo in the browser; run `/audio-verify` whenever a wave touches
   `src/lib/beats/`, warp scenarios, or engine-facing behavior.
2. **Can we do better?** — SDK APIs added since the demo was written (check
   `changelogs/`), dead code, error-handling gaps versus the standards established
   in PR #67/#68 (no silent failures, error cards, `:focus-visible`), UX friction.
3. **Apply the design language** — page chrome, headers, and explanation sections
   move to mastering-console editorial; interactive panels keep instrument-panel
   restraint; each page keeps/earns ONE data-drawn signature element only where one
   exists naturally (no forced decoration); og-images regenerated for restyled pages.

## Inventory and waves

22 public demos + 6 unlisted debug pages. Debug pages get the correctness pass only
(dimension 1) — **no restyle** (they are investigation scratch by convention).

| Wave | Scope | Pages |
| --- | --- | --- |
| 1 | warp | warp-varispeed, warp-grid-follows-file, warp-timestretch (+ audio-verify-debug correctness-only; overview already conforms) |
| 2 | playback core | looping, clip-looping, clip-fades, timebase, track-editing |
| 3 | playback rest | time-pitch, mixer-groups, drum-scheduling, comp-lanes (+ 5 playback debug pages correctness-only) |
| 4 | automation | tempo-automation, time-signature, track-automation |
| 5 | recording + midi | recording-api-react, loop-recording, midi-recording |
| 6 | effects + export | effects, werkstatt, export |

Wave 1 first deliberately: freshest code, the design applies most naturally, and
audio-verify guards regressions — it calibrates the per-demo checklist before the
older categories.

## Per-demo checklist (executed per page, recorded in the wave PR)

- [ ] Every `@opendaw/*` import/call verified against the source checkout at the
      installed version (run `git fetch --tags` there first); deviations from
      current best practice noted or fixed.
- [ ] Category CLAUDE.md claims that this demo embodies re-verified; stale claims
      corrected (directive style).
- [ ] Demo loads and its primary interaction works over the HTTPS dev server
      (Playwright, real pointer events); console clean.
- [ ] Error handling meets the current bar: no silent failures, error card wired,
      async guards where mode switches exist.
- [ ] Improvement candidates listed; cheap ones applied, larger ones filed as
      follow-ups in the PR description (not silently skipped).
- [ ] Design language applied (public pages only): tokens, Plex Mono display
      (`crossorigin` font links), micro-labels ≥10px at ≥4.5:1, `:focus-visible`,
      `prefers-reduced-motion`, og-image regenerated.
- [ ] Sitemap/index/meta untouched unless the page's description changed.

## Execution shape

- One branch + PR per wave; subagent-driven development with the established
  two-stage review (spec compliance, then quality), plus a wave-level final review.
- Wave plans are authored just-in-time (one plan per wave) — a single up-front plan
  for 28 pages would go stale by wave 3.
- `/audio-verify` is mandatory in wave 1 and in any later wave that touches shared
  audio paths; its thresholds may not be loosened to make a wave pass.
- CLAUDE.md corrections land in the same wave PR as the demo they concern.
- A small correction rides wave 1: the root CLAUDE.md Playwright-screenshot line
  ("custom names can write outside the repo") is wrong — custom-named screenshots
  land in the **project root**; fix the wording.

## Out of scope

- `documentation/` chapter rewrites (separate effort; only touched if a demo audit
  finds a factually wrong doc claim).
- New demos or feature work beyond "cheap improvements" — those become follow-up
  issues in wave PR descriptions.
- Restyling the shared site shell (GitHubCorner, BackLink, MoisesLogo, index page).

## Done criteria (per wave)

`npm test` + `npm ci` + `npm run build` green; all wave pages browser-verified;
audio-verify green where applicable; PR description carries the per-demo checklist
results and the follow-up list.
