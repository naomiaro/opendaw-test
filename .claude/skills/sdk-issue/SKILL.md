---
name: sdk-issue
description: Use when a suspected openDAW SDK defect turns up or is being investigated in this repo, when building an unlisted debug repro page or writing a debug note under debug/, or when drafting, checking or posting an issue or comment for andremichelle/openDAW ("file this", "draft the issue", "is this an SDK bug", "can we look for issues around here").
---

# sdk-issue

From "this looks wrong" to an upstream issue the maintainer can act on. The order is fixed: **measure,
then note, then draft, then the user's read, then post.** Nothing is posted without the user's read.

An issue here is a measurement with a repro, written from the SDK's point of view. Root CLAUDE.md holds how
to RUN and READ pages and audits; `debug/README.md` holds the folder layout and the index. This skill holds
the order and what each piece must contain.

## 1. Find out what is already known

- Read `docs/known-sdk-limitations.md` and `docs/known-vendor-issues.md`: an entry there is a decision not to
  file, or a browser behaviour, not a new finding.
- Search upstream before drafting: `xerj code webdaw "<plain words>"` reaches openDAW's `plans/` as well as
  its code, and `gh search issues "<words>" --repo andremichelle/openDAW` the tracker (closed issues too).
  A plan that already states the behaviour turns an issue into nothing, or into a different question.
- Read the SDK source in the checkout (path in `.claude/local.md`), at the installed release.

## 2. Measure it on a repro page

A claim read from code is a hypothesis. Build an unlisted page (HTML at the repo root with
`<meta name="robots" content="noindex, nofollow">`, a `vite.config.ts` input, NOT in `src/index.tsx` or the
sitemap) that self-classifies. `src/demos/engine/monitoring-mono-return-debug-demo.tsx` is a current example.

The page must:

- end in a verdict on `#verdict[data-verdict]`: BUG PRESENT / FIXED / INCONCLUSIVE / HUNG / THREW, with a
  stage trail and every await raced against a deadline;
- carry a control row for every instrument it reads (a tap that must show a known signal, a stereo row
  beside the mono row). A row with no positive control says so in the note;
- decide BUG PRESENT on the defect's WHOLE signature, never on an absence alone: silence, zero events or an
  empty list is also what a dead harness reads. Anything else is INCONCLUSIVE;
- check its footing at every read (AudioContext running, timers not throttled, the document visible) and
  throw when it does not hold;
- settle each verdict before starting the next arm, so a later failure cannot discard it;
- undo what it changed in a `finally` (sources, transport, engine preferences: they persist per origin);
- remove the master Maximizer first if it reads output levels (`removeMasterMaximizer`, assert 1).

Run it with a real click after a fresh load, on the final code. Re-run after every change to the page: the
figures in the note come from the page as merged. A second finding from the same harness may live as extra
rows on the same page, with its own `data-…` outcome.

## 3. Write the note

`debug/YYYY-MM-DD-topic/note.md`, a NEW dated folder per finding, even when an older harness found it. Add
the index row in `debug/README.md`. The note holds, in this order:

1. Status line: SDK version measured on, filed or not, link to the draft.
2. The repro page and how to run it; what the SDK source was read at.
3. What happens, in a few plain lines.
4. **Measured**: browser, OS, sample rate, the table, how many runs.
5. What was NOT measured, and what is only read from code, labelled as such.
6. Mechanism, with `file:line` citations into the SDK checkout.
7. After a fix: what the page will read.
8. Fix ideas, marked internal. They never go into the issue.

Checks that read clean go in the note too, with what was exercised ("five rounds, idle machine"), and
whether the probe was kept.

## 4. Draft the issue

`debug/<date>-<topic>/drafts/TO-REVIEW-<target>.md`, listed under "Waiting for a read" in `debug/README.md`.
Head of the file: "Not posted", the target tracker, the title. The body is:

1. "Hi, Naomi's Claude here." (every issue and comment posted to openDAW opens with it).
2. The SDK version and the behaviour in two or three sentences.
3. **Measured**: the table and its footing.
4. The page URL (`https://opendaw-test.pages.dev/<page>`, live once merged) and the note's GitHub link.
5. The cause, described precisely from the SDK source, labelled as read.
6. What was not run.
7. The tracker search done and the nearest issues.

Rules for the body:

- **The SDK's point of view only.** What the published packages do and where an SDK app meets it, through
  the SDK's own code paths (`Project`, `EngineFacade`, `CaptureAudio`, `BrowserMonitor`, the engine crates).
  The openDAW studio app (`packages/app/studio`: services, panels, dialogs, "the studio's Restart Engine")
  is not mentioned, in the draft or in the note. The one exception is a defect that is the studio app's own,
  or the user asking for it.
- **No suggested fix**, no "could be solved by". Describe the cause and let the maintainer choose.
- Measured and read-from-code are never mixed in one sentence. "I did not run X" is stated.
- A claim that something never happens, or that nothing calls or subscribes to something, needs a full
  search with every hit read; name what was checked, or scope the claim to where the search was made.
- A quote from an upstream plan is copied exactly and attached to the thing the plan says it about.
- Words like "silent", "no hardware", "about N seconds" describe the page as it is now. Check them against
  the page after its last change.
- No Claude session URL, no private repo or product names.
- A behaviour that is not a defect is not filed: it gets an entry in `docs/known-sdk-limitations.md`.

## 5. Check before the user reads

- Every `file:line` citation re-read against the checkout.
- The figures in note, draft, README row and PR body are the same run.
- Open the PR (page, note, draft, index rows) and run the PR review; fix Critical and Important findings.
  The accuracy pass over the note and draft is part of that review, not optional.

Then hand the user the draft's path. The user reads; edits follow; only then is it posted.

## 6. Post and close the loop

- Post with `gh issue create -R andremichelle/openDAW --title … --body-file …` only on the user's word.
- Rename the draft `posted-<tracker>-<number>[-topic].md`, with the link and date at its head.
- Put the issue number in the note's header, the page's `DebugLinkBar`, the README index row, and drop the
  "Waiting for a read" line. This bookkeeping PR is one Claude merges once green.
- A test that asserts the defect as measured is marked "flips when fixed". When a later SDK release makes it
  fail, invert it, note the release in the debug note and close the loop upstream.
- If the page joins the after-upgrade runs, add its line to root CLAUDE.md "Build & Verification" and to the
  `sdk-upgrade` skill's sweep list.

## Quick reference

| Piece | Where | Named |
|---|---|---|
| Repro page | repo root + `src/demos/<category>/` | `<topic>-debug-demo.html` |
| Note | `debug/YYYY-MM-DD-topic/note.md` | new folder per finding |
| Draft | `debug/…/drafts/` | `TO-REVIEW-<target>.md` → `posted-<tracker>-<n>.md` → or `withdrawn-<topic>.md` |
| Waiting list and index | `debug/README.md` | one line each |
| Not-a-defect | `docs/known-sdk-limitations.md` | an entry with the decision |
| Browser or platform behaviour | `docs/known-vendor-issues.md` | measured or watched |

## Common mistakes

| Mistake | What to do |
|---|---|
| Drafting from a code reading | Build the page and measure first; label what stays read-only |
| BUG PRESENT on silence alone | Require the whole signature; a dead return reads INCONCLUSIVE |
| A paragraph on what the studio app does | Cut it; say where an SDK app is exposed |
| "Nothing subscribes to X" after one grep of one package | Search all of upstream, or scope the sentence |
| A fix proposal in the issue | Move it to the note's internal section |
| Figures from a run before the page's last change | Re-run on the merged code and update every copy |
| Adding the finding to an older investigation's note | New dated folder; the old note links to it |
| Posting, or renaming to `posted-…`, before the user's read | Wait |
