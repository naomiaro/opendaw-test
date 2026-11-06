# Export regression harness: design

## Why

A latency trim in an SDK release broke exports silently: frames lost at a chunk boundary, a jump in a sustained
sound (openDAW#530). It was found by hand. The user's goal: "a hardcore export harness to catch any regressions in the
future like the added latency did to export", by "sending test signals through a variety of chains, dry, with
effects, with latency in the mix", backed by "a wav library to benchpress against". When a hash differs between
SDK versions, "we could either file a bug, or accept it as better rendering".

## Goals

- At each SDK bump, one page run tells a person, per render, whether the output is bit-identical to the accepted
  render, with the invariants' verdicts and any shift. For a changed row, the table script then says what moved and by how much
  against the accepted WAV.
- Named invariants catch defects with no baseline to compare with, so a defect already in the first accepted run
  still reads as a finding.
- **The unexplained 1-frame early render at page 44.1 kHz (openDAW#530 comment, not addressed upstream) reads as a finding, never as a
  baseline.** It is the first thing the harness must catch.
- A failure comes with enough to act on: a filed bug or a person's accept.

## Non-goals

- Anything outside the SDK's own export paths (the user's decision).
- CI. It runs by hand at each SDK bump, like the other standing audits (the user's decision).
- Every device through every path. The first version is every path against the latency cases; every effect and
  instrument through one path is the second phase (the user's decision).
- Live playback, recording, other browsers, other machines.

## Anti-goals

- A green run that proves nothing: a silent row, a device that leaves its input unchanged, an instrument that cannot fire.
- A baseline that absorbs a defect. `readBaseline` / `MAX_BASELINE_FRAMES` in `src/lib/audit/sectionRenderGap.ts` absorb the 1 frame on
  purpose, because that page only judges #530. Do not copy that logic.
- Auto-accepting a change because it is small. Size is a label for the reader; accepting stays a person's read.
- WAVs in this repo, or anything that could touch the Cloudflare deploy (the user's decision).

## What is already measured

`debug/2026-11-06-mixdown-uuid-order/note.md` and `src/demos/export/CLAUDE.md` hold the figures. In short: renders are bit-identical on the
same project, and across builds for one unit and for stems. A mix of several units differs in its last bits across builds because an
offline render sums units in UUID order. An ascending `UUID.generate` installed before `initializeOpenDAW` fixes that, and holds when
the SDK makes more calls. A render takes about 120 ms per 2 s, measured on rows of one unit and on mixes of five.

## The harness

An unlisted page, `export-regression-audit-debug-demo.html`, with a real click on Run and `#audit-state[data-audit-state]`, offline, no
hardware. Model: the MIDI effect semantics audit (rows, reader, verdict, artifacts modules under `src/lib/audit/`, a table script
under `scripts/audit/`, a register a person accepts). Logic stays in `src/lib/audit/exportRegression*.ts`, tested in Node.

### Project

Built by the page with ascending UUIDs, asserting that the units' UUIDs read back as expected. Source samples are generated in memory, never decoded,
at a stated rate. The master Maximizer is removed for the level-true rows, with one case keeping it. Renders start from a `project.copy()`.

Latency is exercised by real devices, not a simulated offset, and each row reads `engine.compensationLatency` back before rendering. A figure that differs from the row's expectation fails that row's invariant 11; the row is still rendered and hashed, and the run goes on, so one device changing its latency cannot blank a run and the positive control can show #529. (This differs from the #530 page, which ends its run.) Only a broken harness ends a run: the units' UUIDs not reading back, or the engine failing to boot. Device settings come from the row, not defaults (the Compressor's rows use settings that apply no gain reduction, so look-ahead is all it adds).

### Signals

- **Impulses:** one-sample impulses for exact position, on a quantum boundary and off one (4096 is exactly 32 quanta, and #530 turned on that alignment), read as the
  peak sample, as Soundcraft's PDC tests do (`soundcraft crates/mix/src/lib.rs`, `delay_compensation_aligns_latent_tracks`). The idea of a lone impulse comes from
  mediabunny.dev/blog/project-sync.
- **Full-range log sweep:** lag by correlation and a fingerprint of the chain's response.
- **Steady sine:** jumps and fades, and devices that barely respond to an impulse.
- **A tail-maker:** content ending before a range, into a reverb or delay.

### Latency cases (first version)

None; whole quanta (Autotune, 1280 frames); not whole quanta (Compressor look-ahead 240 / 220, Maximizer 240 / 221, Fold 15); a script `// @latency` at a chosen figure; past the 100 ms cap with a
parallel path (openDAW#529); a latent device on a muted track; on a bus; on an aux return; several latent paths at once.

### Paths (first version)

One `step`; chunked `step`s; `OfflineEngineRenderer.start`; `renderSection` (entire, loop once, loop twice, marker), `tail` on and off; stems (`includeAudioEffects`, `includeSends`, the metronome stem last); `AudioBounce`
(`pre-fx`, `pre-fader`, `post-fader`, `merge`, `loop`, `tail`); `setPosition` starts on and off the quantum; loop on the copy.

### The axes that find what the 1 frame depends on

Measured so far: a 4 s two-pass render at page 44.1 kHz reads 1 early, with no latency and with whole-quanta latency; 0 at 48 kHz; 0 on a 0.9 s two-pass at both rates. The 48 kHz source
makes resampling at the loop wrap a candidate, not tested. A group of rows varies the source rate (48 and 44.1 kHz), the section length and the bpm. When it is understood, it is a draft for the user's read and a new issue citing the #530 comment.

### Rates and lengths

Page rates 48 and 44.1 kHz. The device-rate pass is a one-time proof for an offline-only audit (root `CLAUDE.md`). Renders long enough to pass the 48000-frame chunk, and 4 s where the 1 frame needs it.

## Verdicts

Two layers, reported separately on every row.

### Invariants: need no accepted run, name what broke

The reference for positions and sections is a one-step render of the same project, with no allowance.

1. Chunked `step`s equal one `step`, sample for sample.
2. A section equals the slice of the reference it covers (dry; a chain that rings carries history, see the rule per row).
3. An impulse lands where the reference has it, on all hits. The 1 frame fails here.
   A reference can be wrong too: a defect in compensation or the trim would move the one-step render with every path. So two more checks hold the reference itself: the same impulse lands on the same frame with a latent device as without it (the brief's "burst position unchanged by latency"), and on the frame computed from its position wherever the source rate equals the page rate, with no allowance. A resampled impulse has no exact frame: the page records its shift against the computed frame as a reading, which the register then pins.
4. No jump: the sine's largest move between neighbouring samples stays at the tone's own.
5. A latent device on a muted track leaves the frames as they are without it. `CompensationDelay` has a fade (`openDAW/crates/engine-env/src/compensation.rs`), so whether this holds bit-exactly or only past a fade is the first thing to read, and the row states what was read.
6. A disabled device gives the output with no device, bit-identical (the approach of upstream's `core-wasm/test/differential-audio.test.ts`).
7. Stems sum to the mix where routing allows, within rounding.
8. The same render twice is bit-identical. A reset or a second render carries no history (`soundcraft`, `reset_clears_delay_compensation_history`).
9. Tail on has content past the range, tail off does not (`core-wasm/test/audio-bounce.test.ts`).
10. The row proves something: not silent, no NaN, and a device that should change the signal does.
11. Reported latency equals what the row expects.

**A failing invariant and the register are separate.** A failing row's hash can be registered, so a later fix reads `changed`, and the invariant keeps failing, so the row can never read clean. `--accept` refuses a failing invariant unless the row carries a named known-finding label in `src/lib/audit/exportRegressionFindings.ts` (a name, the invariant, the issue or note it points at), so a new defect cannot be accepted by accident. The 1 frame and the undocumented behaviour below start with such labels. The run's summary line counts rows clean, rows with a known finding (filed or not), and rows failing unlabelled.

**When this work is done** is the user's call: "once all sdk bugs are filed, or everything passes as clean". So a labelled row counts as done once its issue is filed.

### Register: anything that changed

A per-rate register in git, `debug/2026-11-06-export-regression/register/<rate>.json`: for each row, the SHA-256 of its float samples, frames, channels, peak and the readings, plus the header's SDK version and engine hash.

The page reads a row as `identical`, `changed` or `unregistered`, with what it can read with no accepted samples: frames, channels, peak and the impulse shift. The library is not needed for a verdict.

`table.ts` reads the rest from the uploaded WAV and the accepted WAV in a local library clone: the first differing frame, the largest difference in dB, and the label `rounding-sized` for a difference under −100 dBFS with no shift, chosen because the UUID-order rounding read at most −113 dBFS. It is still `changed`, and it still needs a person. With no clone present, the script says so and reports what the page read.

`table.ts --accept` writes the register after a person's read, as the semantics audit does. An errored row is never accepted.

## The WAV library

A separate, private repo with Git LFS, `naomiaro/opendaw-export-wavs`, and the first fill is part of this work (the user's decisions; Git LFS was the user's idea). `git-lfs` is not installed on this machine yet: `brew install git-lfs`. This repo holds hashes only, so a run compares with no WAVs present and a Cloudflare clone can never pull them.

- Files named by the hash, `wav/<sha256>.wav`, 32-bit float, so an unchanged render across SDK versions adds nothing. The hash covers the float samples, not the WAV header.
- The page uploads a WAV only for a row that is not `identical` (and for every row when the library is first filled), through the dev server's `/__verify` sink into `.verify-output/`, so a run does not leave hundreds of MB behind.
- `table.ts --accept` copies the accepted WAVs into a local clone of the library (a path argument or environment variable), and a person commits them.
- A diff command reads a changed row's accepted WAV from the library against the new one, and writes both for the audio-analyzer MCP. Any older SDK can also be re-rendered through `SDK_DIST_OVERRIDE`, so a lost WAV is not a lost baseline.

GitHub Free LFS: 10 GiB of storage and 10 GiB of bandwidth a month, and every download counts. Estimate for the first fill: about 150 renders of about 4 s, about 225 MB (the builder's row count replaces this).

## Proof it can catch something

- **Positive control:** a run on SDK 0.0.181 through `SDK_DIST_OVERRIDE` (`node scripts/audit/sdk-override.ts 582f9ff <dir>`, this repo's revision naming that release) must show #530 and #529. Its output is recorded in the note, and not accepted.
- **Hash:** a row with one unit's volume nudged by 0.0001 dB must read `changed`.
- **Order:** a run with descending UUIDs must read `changed` on the summed rows and `identical` on the single-unit rows, and the table script labels the summed rows `rounding-sized`.

## Undocumented behaviour (my call; the user can override)

A `setPosition` start's cold effects and its 5 ms fade, and a range's missing tails, have nothing documenting what the SDK should do. Pin them as they are in the register, each with a named label and a line in the note, and raise upstream only where one reads as a defect. Drafts go through the usual route: a debug note, a repro, `drafts/TO-REVIEW-*`, the user's read, then openDAW's tracker, with no suggested fix.

## Wiring

- A row in `.claude/skills/sdk-upgrade/SKILL.md`'s table and in root `CLAUDE.md`'s "Build & Verification", and a line in `src/demos/export/CLAUDE.md`.
- A register note `debug/2026-11-06-export-regression/note.md`, with a row in `debug/README.md`.
- Unlisted page rules: `<meta name="robots" content="noindex">`, not in `src/index.tsx` or `public/sitemap.xml`, no product logo (it is written against upstream).

## Constraints

- **Retrieve with XERJ before writing code against the SDK or engine** (root `CLAUDE.md`), for each path and device, and cite `project/file:line`. The openDAW corpus is AGPL: adapt the approach, never copy code. Upstream's `core-wasm/test/{stem-export,audio-bounce,delay-compensation,differential-audio}.test.ts` come first. No peer found so far keeps a golden audio library, so that part has no prior art to follow.
- Public repo: the private-material rule in the project's memory applies to pages, notes, PR bodies and commit messages; grep the diff before pushing.
- `renderSection` writes to the project it gets, so hand it a copy. Tail renders stop at silence or a cap, so a row must not ring forever.
- Do not edit under `src/` or `public/` during a run: Vite reloads the page and the run is lost.
- `npm run typecheck` exits 0 before a commit. Tests in Node where they can be (`src/lib/testing/boxGraphFixtures.ts`).

## Left to the builder

Row list and ids; sampling one axis at a time rather than the full cross; whether one source carries several signals to save renders; the reader's module split; the page's look, which is a debug page; tolerances for `rounding-sized` on stems; how `AudioBounce` is driven (`bounce` writes through `SampleService`, while `prepareCopy`, `exportConfiguration`, `renderSpan` and `renderFrames` are also exported).

## My calls, for the user to check

- Hash over float samples, SHA-256 rather than MD5 (browsers have it built in).
- The −100 dBFS `rounding-sized` label.
- Uploading WAVs only for rows that changed.
- Pinning undocumented behaviour, as above.
- Checks added beyond the brief: disabled device, reset history, proves-something, reported latency, the positive-control rows, the descending-UUID run.
- The page gives the hash verdict and the table script gives the sample-level figures, so a run needs no WAVs present.
- A latency mismatch fails its row and the run goes on.
- `--accept` registers a failing row only under a named known-finding label.
- A resampled impulse's shift is a pinned reading, not an invariant.
