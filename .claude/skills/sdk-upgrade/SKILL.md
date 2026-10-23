---
name: sdk-upgrade
description: Use when upgrading @opendaw/studio-sdk to a new release in this repo ("update to SDK 0.0.x", "bump the SDK", "like usual, with a changelog"), or when re-running the standing verification sweeps after one.
---

# sdk-upgrade

One SDK release at a time, on a branch, as one squash-merged PR that carries the bump, the
changelog, the doc audit, any demo compensation, and the sweep readings in the registers.
Root CLAUDE.md "Build & Verification" holds the READING rules per sweep (what a cell means,
what is a known defect); this skill holds the ORDER, the commands and the recipes. The
previous `changelogs/sdk-<a>-to-<b>-changes.md` is the template for the new one.

Budget: the hardware-free sweeps take about an hour and a half of browser time; write the
changelog and the docs while they run (`.md` edits do not reload the page).

## 1. Snapshot, then bump

```bash
git checkout main && git pull && git checkout -b chore/sdk-<new>
mkdir -p <scratch>/old && cp -R node_modules/@opendaw <scratch>/old/        # the installed dists, byte-exact
sed -i '' 's/"@opendaw\/studio-sdk": "<old>"/"@opendaw\/studio-sdk": "<new>"/' package.json
rm -rf node_modules package-lock.json && npm install && npm ci              # clean lockfile; npm ci must pass
rm -rf node_modules/.vite
```

Bump `@opendaw/studio-sdk` only; sub-packages resolve transitively; never a `file:` reference.
The copy replaces `npm pack` per sub-package: it IS the installed 0.0.<old>, and it is what the
dist diff, the wasm hashes and a flip-proof (below) run against.

## 2. Read the release

```bash
cd <openDAW checkout, path in .claude/local.md> && git fetch --tags && git checkout "@opendaw/studio-sdk@<new>"
git log --oneline "@opendaw/studio-sdk@<old>..@opendaw/studio-sdk@<new>"          # merges bring main's commits into the range
git diff --stat "@opendaw/studio-sdk@<old>..@opendaw/studio-sdk@<new>" -- packages/lib packages/studio crates | grep -v 'package.json\|CHANGELOG'
```

Then update the tag in `.claude/local.md` (the checkout's pinned-tag line). For each commit under `packages/lib`,
`packages/studio/{adapters,core,core-wasm,core-processors,enums,forge-boxes,sdk}` or `crates`,
read its message and diff (`git show <sha> -- <path>`); everything else is studio app code
(one line in the changelog's "Studio-app only" paragraph). For an issue a commit "Fixes", run
`gh issue view <n> -R andremichelle/openDAW --json title,author` — one filed from this repo
closes a loop in its `debug/` note, `debug/README.md` and the memory.

Installed surface, the authority over the tag:

```bash
OLD=<scratch>/old/@opendaw
for p in $(ls node_modules/@opendaw); do printf '%s: %s\n' $p "$(diff -rq $OLD/$p/dist node_modules/@opendaw/$p/dist | wc -l)"; done   # 0 + a version change = bump only
for p in $(ls node_modules/@opendaw); do diff -rq $OLD/$p/dist node_modules/@opendaw/$p/dist | grep '\.d\.ts$'; done                 # the surface map
for f in $(cd node_modules/@opendaw/studio-core-wasm/dist && find wasm -name '*.wasm'); do cmp -s $OLD/studio-core-wasm/dist/$f node_modules/@opendaw/studio-core-wasm/dist/$f || echo "CHANGED $f"; done
grep -o 'OPENDAW_SDK_VERSION = "[^"]*"' node_modules/@opendaw/studio-sdk/dist/version.js
```

`diff $OLD/<pkg>/dist/<file>.d.ts node_modules/@opendaw/<pkg>/dist/<file>.d.ts` per changed
declaration gives the exact new signatures the changelog and the docs quote.

## 3. Behaviour the compiler cannot see

`npm run typecheck` and `npx vitest run` passing says nothing about a demo that reads a
VALUE the release changed. For every behaviour commit in `studio-core` / `core-wasm` /
`crates`, grep `src/` for what the demos read of it (labels, field defaults, counts, orders,
preference values) before deciding "unaffected". The take labels were such a case: a release
made take numbers continue across recordings, every test passed, and a hook that read
"Take 1" as the lead-in take was wrong until a browser check. Compensate in the demos in the
same PR, with a Node test for the rule, and name the behaviour in the changelog's first list.

Then load the affected demo fresh in the browser, exercise the changed path (a second
recording on the same tape, the preference the release re-defaults, …) and read the result
off the page or the box graph; the test pins the rule, the browser check pins the demo.

A "flips when fixed" test failing is a fix landing: invert it (root CLAUDE.md). A NEW
regression test of a fix must be shown to flip: swap in the OLD dist file that carried the
fixed code (the commit's path tells which, e.g. `lib-box/dist/graph.js` for a box-graph fix),
expect the test to FAIL, then restore:

```bash
cp node_modules/@opendaw/<pkg>/dist/<file>.js $S/new-<file>.js
cp $OLD/<pkg>/dist/<file>.js node_modules/@opendaw/<pkg>/dist/<file>.js && npx vitest run <test>   # expect FAIL
cp $S/new-<file>.js node_modules/@opendaw/<pkg>/dist/<file>.js && diff -q $S/new-<file>.js node_modules/@opendaw/<pkg>/dist/<file>.js
```

## 4. XERJ corpus (only if `~/.claude/skills/xerj` exists)

```bash
SHA=$(git -C <openDAW checkout> rev-parse HEAD)
cd ~/.xerj-code/corpora/webdaw/openDAW && git fetch --depth=1 origin $SHA && git checkout -q FETCH_HEAD
cd .. && grep -n -A3 '"repo": "openDAW"' corpus.json                        # the previous sha is in the openDAW entry
sed -i '' "s/\"sha\": \"<previous openDAW sha>\"/\"sha\": \"$SHA\"/" corpus.json   # that entry only
xerj corpus index webdaw --fresh      # about four minutes, run in the background; ends "corpus 'webdaw' searchable"
```

Without the skill directory, skip this section and say so in the report.

## 5. Standing sweeps

Dev server: `npm run dev -- --port 5173 --host 127.0.0.1 --strictPort` (reuse a running one).
Playwright MCP, a REAL click on each Run button, the tab visible throughout, one page at a
time. Poll with one `browser_evaluate` per ~95 s:

```js
async () => { const t0 = Date.now(); while (Date.now() - t0 < 95000) { const s = document.querySelector('#audit-state')?.getAttribute('data-audit-state'); if (s === 'done' || s === 'error') return s; await new Promise(r => setTimeout(r, 3000)); } return 'still ' + document.querySelector('#audit-state')?.getAttribute('data-audit-state'); }
```

| page | start | hardware | reads |
|---|---|---|---|
| `samplerate-audit-debug-demo.html?family=all&bpm=all&rate=all` | auto-runs on load | none | header "180 cells — 180 pass"; per-family maxima from the table (evaluate: max of column 7 per family) |
| `recording-alignment-audit-debug-demo.html?scenario=all&bpm=all&rate=48000`, then `&rate=44100`, then `?scenario=multitrack-all&bpm=120&rate=48000`, then THREE `?scenario=multitrack-start&bpm=120&rate=48000&graphChurn=on` | `button:has-text("Run audit")` | none — a synthetic in-context loopback, no microphone, the room does not matter | `node .claude/skills/sdk-upgrade/scripts/recsum.cjs .verify-output/recaudit-summary-<run>.json`; `mtsum.cjs` for `recaudit-mt-summary-<run>.json`; then `node scripts/audit/recording-alignment/one-quantum-events.ts` (the `| <new> |` rows) |
| `param-write-enabled-flip-debug-demo.html` | `button "Run"`, once per load | none | the FIXED line |
| `plugin-delay-compensation-debug-demo.html` | `button "Run"`, disabled until the engine booted | none | every row "lag 0 frames" (read `document.body.innerText` from "Step 1"; there is no table) |
| `midi-effect-placement-audit-debug-demo.html?device=all`, then `&rate=44100` | `button:has-text("Run audit")`, disabled until booted | none | every row `as-predicted` (table) |
| `loudness-meter-audit-debug-demo.html?case=all`, then `&rate=44100` | `#run` | none; silent; ~12 min each | `node .claude/skills/sdk-upgrade/scripts/loudsum.cjs .verify-output/loudness-audit-<run>.json` prints the register's table rows |
| `midi-input-alignment-audit-debug-demo.html?scenario=all&bpm=all`, then `?scenario=loop-wrap&bpm=120&repeats=5`, then `?scenario=nominal-start&bpm=120&effect=arpeggio` and `&effect=pitch` | real click | IAC Driver online (Audio MIDI Setup) | `node scripts/audit/midi-input-alignment/table.ts` |
| `midi-audio-combined-audit-debug-demo.html?scenario=all&bpm=120` | real click | IAC + built-in mic and speakers, quiet room, window uncovered | `node scripts/audit/midi-audio-combined/table.ts` |
| `recording-hidden-window-debug-demo.html?driver=hidden-safe&interrupt=cover&hideAt=start`, then `?interrupt=modal&hideAt=start|mid|stop` | real click | `cover` needs a HAND (Cmd+H, count five, click Chrome in the Dock); `modal` needs the dialog handler after five seconds | both takes `intact` |
| `chromium-watched-issues-debug-demo.html?issue=first-read` | `button "Run"` | none | `#verdict[data-verdict]`; read against the Chromium entries in `docs/known-vendor-issues.md` (`STALE FIRST READ` is the measured entry, `FIRST READ TRUE` would be the fix; `NOT CHECKED context-not-running` or `too-few-runs` judged nothing) |
| `chromium-watched-issues-debug-demo.html?issue=suspend-resume&tracker=1` | `button "Run"` | none | `HALF RATE` while the Chromium bug is open (the register's measured entry); a `CLEAN` there is the finding. A `NOT CHECKED <step>` (a cycle failed, whatever the cycles before it read), `no-signal` (a silent baseline), `no-baseline-purity`, `processor-error-tone` or `<n>-cycles` judged nothing: re-run it |
| `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=loopback&rate=48000`, then `&rate=44100` | `button "Run"` | none; 60 s each | the verdict and the start-window figures against the register's stream-start zero run; `NOT CHECKED source-ended`, `source-muted` or `source-empty-input` (the source failed, its zeros are not the browser's), `no-signal` (nothing in the first 5 s) or `<s>-s` judged nothing |
| `chromium-watched-issues-debug-demo.html?issue=opfs-flush`, then `?issue=opfs-usage` (in-session) | `button "Run"` | none | flush medians against the register's figures; `opfs-usage` in-session reads `COUNTED`, and a `NOT CHECKED write-none`, `write-short`, `write-size-mismatch` or `readings-missing` is a write or an `estimate()` that failed, not kept for a restart |
| `chromium-watched-issues-debug-demo.html?issue=bfcache` | `button "Run"`, then "Navigate away", then the browser's Back | the USER'S Chrome (claude-in-chrome): Playwright's Chrome runs with `--disable-back-forward-cache` and reads `NOT CHECKED not-cached` | `HALF SPEED` is the measured entry, `NORMAL` would be the fix |
| `chromium-watched-issues-debug-demo.html?issue=opfs-usage`, then `&truncateFirst=1`, each followed by a restart | `button "Run"`; the judging load needs no click | a HAND in the user's Chrome: Cmd+Q, start Chrome, type the URL (no session restore) | `NEGATIVE USAGE` with the decoded saved figure; `restartDriftBytes` against the previous restart (about −64 MiB plain, about 0 truncate-first, plus anything else deleted in between); `NOT CHECKED not-restarted` is a reload (readings kept), `restart-no-estimate` an `estimate()` without a usage (not kept as the last restart). A stored entry an older page wrote is cleared with a console warning: run the in-session half again |
| `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&rate=48000`, then `&rate=44100` | `button "Run"` | the built-in microphone, a quiet room | as the loopback rows |
| `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&rate=48000&stallMs=80&stallEvery=1000`, then `&rate=44100`, then `&source=loopback` | `button "Run"` | the built-in microphone, a quiet room; 60 s each | the microphone reads `GAPS` with most zero runs at stall times (`verdictDetail`; about one 32 ms run 48–72 ms after each of the 55 stalls) while the Chromium bug is open, the register's measured entry; `0 of <m>` at stall times there is the finding. The loopback reads `CLEAN` or `START GAPS` under the same stalls; `stallFailed` or a `NOT CHECKED stall-<n>…` is a stall that never answered. `&input=<label text>` picks a USB microphone (`NOT CHECKED mic-Error-no-input-matching-<text>` when none matches; the console lists the inputs) |
| `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&rate=48000&latencyHint=0.04`, then `0.1`, `0.2`; `&source=loopback&latencyHint=0.2` | `button "Run"` | a microphone (`&input=<label text>` for a USB one), a room with its normal noise; 60 s each | the tracker JSFiddle's lever: `START GAPS` or at most one short run about 0.55 s in (384 / 256 frames at 0.1 / 0.2 s, `runLengthsIn480s` under 1) plus a start-window run is the register's reading; a run of whole 480s or a run after the first second is the finding; `captureRms` shows the room was not silent |
| `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=mic&rate=48000&seconds=90&speakerTone=0`, then `&dither=1` | `button "Run"` | a microphone, a room with its normal noise; 90 s each | silent output (`&speakerTone=0`, the recorder writing zeros to the destination) reads `GAPS` with `runsNear30s` 1, one 128-frame run just after the 30 s mark, while the Chromium bug is open; `&dither=1` reads `CLEAN` or `START GAPS` with `runsNear30s` 0 on the built-in microphone (a quiet USB microphone read one run in 1 of 2 dithered rows; see the register). `clockDipSeconds` names any second the context clock ran under 0.75 of the wall clock; `latencyChangedAtSecond` and `sinkIdChanged` name a change in what the context reports (none around the 30 s mark so far) |
| `chromium-watched-issues-debug-demo.html?issue=capture-gaps&source=crosscontext&rate=44100&seconds=90`, then `&rate=48000&generatorRate=48000`, then `&dither=1` | `button "Run"` | none; 90 s each | tracker comment 50's two-context graph: `START GAPS` with one 441-frame start run (`startRunLengthsIn441s` 1) at 44 100, and `GAPS` with one 480-frame run about 32 s in (`runsNear30s` 1) at 48 000, `CLEAN` with `&dither=1`, while the Chromium bug is open; the `generator…` figures are the generator context's witness |
| `chromium-watched-issues-debug-demo.html?issue=suspend-resume&tracker=1&witness=mic` | `button "Run"` | the built-in microphone and speakers, a quiet room | `HALF RATE` as the hardware-free row, and the microphone's purity drop as the audible confirmation; a `DISTORTED (mic only)` with the clock true is a candidate (a room sound reads the same), not a reproduction |
| `chromium-watched-issues-debug-demo.html?issue=output-latency` | `button "Run"` | a Bluetooth output connected and selected during the 30 s | the `outputLatency` rows before and after the switch; no verdict |
| `chromium-watched-issues-debug-demo.html?issue=output-latency&roundtrip=1&isolate=1&gain=1`, then `&sink=<the headset label>` | `button "Run"` | the built-in microphone, a quiet room; the Bluetooth half needs the headset connected and a hand to hold one earbud to the mic | 10 of 10 clicks each; the headset median minus the speaker median (about 200 ms typical, about 280 ms on the first stream after connecting) against the reported difference (133 ms); a `NOT CHECKED 0-of-10` names the output device the clicks went to, `clock-pair-unstable` is page-clock pairs that spread too wide to place the clicks (`outputPairSpreadMs`, `capturePairSpreadMs`), `non-positive-round-trip` a click found at or before it played |

Run the hardware-free rows yourself; the IAC, combined and `cover` rows, and the Chromium
probe's bfcache, OPFS restart, microphone and Bluetooth rows, need the user's Chrome,
hardware or hand — ask for them at the end rather than skipping silently. The Chromium
probe loads no SDK engine (two probes import lib-dsp's WAV encoder, nothing else): its rows say whether a watched browser issue still stands, and a
changed verdict moves the register entry, never the SDK's reading. Judge every cell
against its register (root CLAUDE.md names them) and against `docs/known-vendor-issues.md`;
a changed row is the finding, a listed defect or a listed vendor behaviour is not. Per-release sections, in the shape of the previous release's: "Standing sweep
on <new>" in `debug/2026-09-02-recording-start-alignment/note.md` (single tape table,
multi-mic table, forced table, the one-quantum count, a Reading) and "SDK <new>, 48 kHz /
44.1 kHz" in `debug/2026-10-02-loudness-meter/note.md` (the loudsum rows). The MIDI,
combined and hidden-page registers get a section only when their rows were run; the
sample-rate maxima, the #459 and the delay-compensation pages are recorded in the changelog
only. Envelopes land in `.verify-output/` (untracked).

## 6. Changelog, docs, memory

`changelogs/sdk-<old>-to-<new>-changes.md` in the previous file's shape: a header (publish
date, commits tag-to-tag, files), a numbered list of what matters for this repo (demo
behaviour changes first, repo-filed issues fixed, then features), the sub-package version
table (changed / byte-identical bumps / unchanged, licences, wasm binaries changed with
sizes), one section per item with the mechanism and the upstream tests, a "Studio-app only"
paragraph, and "opendaw-headless follow-ups shipped with this upgrade" with the sweep readings,
the docs touched and the API claims verified against the tarballs.

Docs: grep every changed identifier across `documentation/`, `documentation/internals/`,
root `CLAUDE.md` and the category `CLAUDE.md`s; in `docs/known-vendor-issues.md` re-read each
open tracker (the two Bugzillas through `node .claude/skills/sdk-upgrade/scripts/bugzilla.cjs
<host> read <id>…`, the Chromium tracker through the browser), update "Last checked" on every
entry a sweep exercised, sweep the three trackers for new open Web Audio, worklet, OPFS and Web MIDI
issues (`bugzilla.cjs <host> search "AudioWorklet" "WebMIDI"`; the Chromium components Blink>WebAudio and
Blink>WebMIDI, `status:open WebMIDI` as the search, each sorted by modified), and
add an entry for any vendor behaviour the upgrade ran into; chapter docs state the present, so
`grep -rnE '0\.0\.1[0-9]{2}' src documentation CLAUDE.md` must find no new version
qualifier outside `changelogs/` and `debug/`. `grep -ri moises` over the diff must be empty.

End: `npm run typecheck`, `npx vitest run`, `npm run build`, `npm ci`; commit with the
Co-Authored-By trailer (the skill's own edits travel in the same PR); `gh pr create --base
main` with the body in the previous upgrade PR's shape (`gh pr list --state merged --search
"chore/sdk" --limit 3`); `/pr-review-toolkit:review-pr`, fix Critical and Important, `gh pr
edit --body-file`, no narrative comments. Merging is the user's call (`gh pr merge <n>
--squash`). Record: `project_sdk_<new>_upgrade.md` in the memory directory (what the release
changed for the repo, every sweep figure the next upgrade should expect, what is open) with a
one-line `MEMORY.md` pointer; `reference_opendaw_source.md` to the new tag; a `debug/README.md`
row for any loop the release closed.

## Common mistakes

- Installing before copying `node_modules/@opendaw`: the old dists are gone, and the
  changelog's "byte-identical" and wasm claims have nothing to stand on.
- Reading a cell against a fixed number instead of its register and its own row figures.
- Calling the recording-alignment sweep a microphone measurement: it is a loopback.
- Treating a green typecheck as "no demo impact" (section 3).
- Editing `src/` or `public/` while a sweep runs: Vite reloads the page and the run is lost.
  `.md` files are safe to edit during a run.
