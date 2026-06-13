# Demo Audit Wave 6 — Effects + Werkstatt + Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit + fix + console-restyle the last three demos (effects, werkstatt, export) per the campaign spec, then close the campaign (delete spec + this plan in the PR).

**Architecture:** Same shape as waves 1–5: one read-only source-verification audit task first (tag-pinned against the installed SDK), then one fix+restyle task per demo (each browser-verified), then docs/CLAUDE.md corrections, og-images, wave integration review, PR. The audit task produces the findings list that drives the per-demo tasks; pre-seeded findings below are starting points, not the ceiling.

**Tech Stack:** React + Radix Themes, `@opendaw/studio-sdk` 0.0.154 (sub-packages: `studio-core@0.0.152`, `studio-adapters@0.0.116`, `studio-boxes@0.0.94`, `lib-dsp@0.0.84`, `lib-std@0.0.78`), console design tokens in `src/lib/design/consoleTheme.ts`, Playwright over the HTTPS dev server.

**Campaign context:**
- Spec: `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md` (this is the LAST wave — the PR deletes the spec and this plan)
- Design language: `docs/design/2026-06-11-mastering-console-editorial.md`; reference implementation `src/demos/warp/warp-overview.tsx`
- Error-card convention (wave 5): `<Callout.Root color="red" role="alert">` for any failure the user must see
- openDAW source checkout: `/Users/naomiaro/Code/openDAW/` — run `git fetch --tags` there first; tags are `@opendaw/<pkg>@<version>`
- Wave PR description carries: per-demo checklist results, audit findings table (confirmed / nuanced / wrong), follow-up list

**Files in scope:**

| Demo | Page | Support files |
|---|---|---|
| effects | `src/demos/effects/effects-demo.tsx` (790) | `src/hooks/useDynamicEffect.ts` (496), `src/hooks/useEffectChain.ts` (48), `src/lib/effectPresets.ts` (582), `src/components/EffectPanel.tsx` (168), `src/components/EffectChain.tsx` (81), `src/hooks/useAudioExport.ts` (182) |
| werkstatt | `src/demos/effects/werkstatt-demo.tsx` (604) | `src/lib/werkstattScripts.ts` (411) |
| export | `src/demos/export/export-demo.tsx` (671) | `src/lib/rangeExport.ts` (351) |
| docs | `src/demos/effects/CLAUDE.md`, `src/demos/export/CLAUDE.md` | `documentation/11-effects.md`, `documentation/10-export.md` (only where a demo audit proves a claim wrong) |

**audio-verify condition:** Run `/audio-verify` ONLY if a task modifies `src/lib/beats/`, warp scenarios, or shared engine-facing render code. `rangeExport.ts` fixes that change render behavior (not just types/labels) count as engine-facing → run it. Pure chrome/restyle changes do not.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the wave branch from up-to-date main**

```bash
git checkout main && git pull && git checkout -b demo-audit-wave-6
```

- [ ] **Step 2: Commit this plan file** (campaign convention: plans are in-flight work, committed on the branch, deleted when the wave completes)

```bash
git add docs/superpowers/plans/2026-06-12-demo-audit-wave-6.md
git commit -m "docs: wave 6 audit plan (effects + werkstatt + export)"
```

---

### Task 1: Source-verification audit (read-only — produces the findings table)

**Files:**
- Read: all in-scope files above, `src/demos/effects/CLAUDE.md`, `src/demos/export/CLAUDE.md`
- Read: `changelogs/sdk-0.0.135-to-0.0.138-changes.md` through `changelogs/sdk-0.0.150-to-0.0.154-changes.md` (5 files — demos last touched at ~0.0.135)
- Read (openDAW checkout, tag-pinned): `packages/studio/adapters/`, `packages/studio/core/`, `packages/lib/dsp/` at the installed versions
- Create: `debug/wave6-audit-findings.md` (working notes; deleted before PR merge or graduated into the PR description)

**Verification method (per claim):** locate the claim's SDK symbol in `/Users/naomiaro/Code/openDAW` via `git show "@opendaw/<pkg>@<version>:<path>"` (NOT the working tree — it may be ahead), or in `node_modules/@opendaw/<pkg>/dist/**/*.d.ts`. Record verdict: confirmed / nuanced / wrong, with file:line evidence.

- [ ] **Step 1: Fetch tags in the openDAW checkout**

```bash
git -C /Users/naomiaro/Code/openDAW fetch --tags
```

- [ ] **Step 2: Verify every claim in `src/demos/effects/CLAUDE.md`** — minimum set:
  - `insertEffect()` return union + direct cast idiom
  - `ScriptCompiler.create({headerTag, registryName, functionName})` triple for werkstatt/apparat/spielwerk; `compile()` / `load()` / `stripHeader()` signatures at `studio-adapters@0.0.116`
  - the `// @werkstatt js 1 <update>` header write-back + processor `update === 0` silence claim
  - `block.flags & 4` = transport-playing flag (find the BlockFlag enum; confirm bit value and that the SDK does not clear output buffers between blocks)
  - `ScriptDeclaration.parseGroups()` return shape (`DeclarationSection[]`, `group: {label, color} | null`)
  - Werkstatt parameter access via `parameters.pointerHub.incoming()` → `WerkstattParameterBox` fields
  - CompressorDeviceBoxAdapter parameter table (all 12 rows, ranges)
  - the one-line adapter claims (Crusher inverted, StereoTool bipolar -1..1, Tidal 17-entry RateFractions, Delay 21-entry Fractions, Dattorro DefaultDecibel wet/dry)

- [ ] **Step 3: Verify every claim in `src/demos/export/CLAUDE.md`** — minimum set:
  - `ExportConfiguration.countStems()` mixdown-branch claim; stems record shape incl. `skipChannelStrip`, `range`
  - `AudioOfflineRenderer.start()` / `OfflineEngineRenderer.start()` / `.create()` / `.render()` signatures at `studio-core@0.0.152`
  - `project.copy()` shares sampleManager but not engine preferences; engine-worklet 2-output rule
  - `WavFile.encodeFloats` duck-typed input (at `lib-dsp@0.0.84`)
  - `TransferRegions.transfer` / `TransferAudioUnits.transfer` / `PresetEncoder` / `PresetDecoder` signatures
  - metronome gain schema (`max(0)`, default -6)

- [ ] **Step 4: Verify demo-code SDK usage not covered by CLAUDE.md claims:**
  - `project.lastRegionAction()` (export-demo.tsx:132) — confirm it exists at `studio-core@0.0.152` and returns what the demo assumes (last region end in ppqn); flag rename/semantic drift
  - AudioUnit `volume` field mapping — confirm `decibel(-96, -9, +6)` and what happens on out-of-range `setValue(+12)` (effects-demo slider max is 12)
  - `genBox.index.setValue(0)` to reorder an effect — confirm index reordering is the supported idiom vs. a newer move API
  - `regionBox.mute` / `waveformOffset` / loop fields used by werkstatt-demo init
  - everything `src/lib/rangeExport.ts` and `src/hooks/useAudioExport.ts` call (offline context setup, `AudioWorklets.createFor`, `createEngine({project, exportConfiguration})`, `queryLoadingComplete`, mutate-copy-restore)
  - `src/hooks/useDynamicEffect.ts` + `src/lib/effectPresets.ts`: every parameter name/range against the adapter sources (known traps: compressor `makeup` not `gain`; crusher inverted; EQ field names)

- [ ] **Step 5: Changelog sweep 0.0.135 → 0.0.154** — list new/changed APIs relevant to effects, scriptable devices, or export (e.g. new EffectFactories entries, ScriptCompiler changes, offline-render additions). Each relevant one becomes either a cheap improvement (applied in Tasks 2–4) or a follow-up in the PR description.

- [ ] **Step 6: Write `debug/wave6-audit-findings.md`** with the verdict table (claim | verdict | evidence | action) and the improvement-candidate list. Commit:

```bash
git add debug/wave6-audit-findings.md
git commit -m "docs: wave 6 audit findings (source-verified against SDK 0.0.154 sub-packages)"
```

---

### Task 2: Effects demo — fixes + console restyle

**Files:**
- Modify: `src/demos/effects/effects-demo.tsx`, `src/hooks/useDynamicEffect.ts`, `src/lib/effectPresets.ts` (only where Task 1 found wrong params)
- Possibly create: `src/demos/effects/EffectChainsPanel.tsx` (if the data-driven collapse below pushes the page past structure limits, split — 800-line cap)

**Pre-seeded findings (apply unless Task 1 disproves):**

- [ ] **Step 1: Fix master-volume slider range.** Slider is `min={-60} max={12}` (effects-demo.tsx:452-454) but the SDK AudioUnit volume mapping is `decibel(-96, -9, +6)`. Change to `max={6}` (keep `min={-60}` for usability; label the floor). Verify against Task 1's evidence before assuming clamping semantics.

- [ ] **Step 2: Collapse the 7 copy-pasted `renderXEffect` callbacks + 8 `useEffectChain` calls** (effects-demo.tsx:103-227) into a data-driven structure. Hooks cannot be called in a loop with a dynamic count — but the track list here is STATIC (7 names + master), so a fixed-order array of `{ name, audioBox, chain }` built from 8 explicit hook calls is fine; the render callbacks and the 8 `<EffectChain>` blocks (lines 529-616) become one `.map()`. This also fixes the type bug where `tracks.find(...)?.audioUnitBox` (possibly `undefined`) is passed to a prop typed `AudioUnitBox | null` (lines 123, 207).

```tsx
const TRACK_NAMES = ["Intro", "Vocals", "Guitar Lead", "Guitar", "Drums", "Bass", "Effect Returns"] as const;
const boxFor = (name: string) => tracks.find(t => t.name === name)?.audioUnitBox ?? null;
// 8 explicit hook calls stay (Rules of Hooks), then:
const chains = [
  { name: "Intro", audioBox: boxFor("Intro"), chain: introEffects },
  // ... 6 more + { name: "Master", audioBox: masterAudioBox, chain: masterEffects }
];
// single shared renderEffect factory:
const renderEffect = useCallback((trackName: string, audioBox: AudioUnitBox | null,
    onRemove: (id: string) => void) =>
  (effect: EffectInstance) => (
    <EffectRenderer key={effect.id} effect={effect} trackName={trackName}
      audioBox={audioBox} onRemove={onRemove} project={project} />
  ), [project]);
```

- [ ] **Step 3: Error handling to current bar.** Init catch (line 292-295) currently only sets status text, and the full-screen loading overlay is keyed on `status !== "Ready to play!"` (line 350) — an init or waveform error leaves the spinner up forever. Add an `initError` state; on error, drop the overlay and render `<Callout.Root color="red" role="alert">` with the message. Same for export failures (the `useAudioExport` status path already surfaces text — keep, but failures get the red callout, not plain text).

- [ ] **Step 4: Deduplicate `maxDuration`** — computed three times inline (lines 235, 468, 475-478 + 482-485). Compute once.

- [ ] **Step 5: Apply parameter fixes from Task 1** to `useDynamicEffect.ts` / `effectPresets.ts` (wrong field names, wrong ranges). Each fix cites the finding.

- [ ] **Step 6: Console restyle.** Per `docs/design/2026-06-11-mastering-console-editorial.md` and `warp-overview.tsx`: page chrome, header, prose sections (the two emoji callouts and the "Technical Details" card become editorial sections; kill the emoji), `CODE_BLOCK_STYLE` for code, Plex Mono display with `crossorigin` font links in `effects-demo.html`, micro-labels ≥10px at ≥4.5:1, `:focus-visible`, `prefers-reduced-motion` (the spinner animation needs the guard). Interactive panels (EffectPanel, mixer, transport) keep instrument-panel restraint — controls/box-graph logic untouched. ONE signature element max, only if natural (the live mixer + effect chain IS the page's data element; do not force another).

- [ ] **Step 7: Browser-verify over HTTPS** (Playwright, real pointer events): load → play → add a Compressor to Drums → tweak a param while playing → load a preset → bypass → remove → export full mix (await completion) → console clean. Mobile 390px per-element clipping scan (`el.scrollWidth > el.clientWidth`), keyboard focus pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: effects demo audit — fixes + console design"
```

---

### Task 3: Werkstatt demo — fixes + console restyle

**Files:**
- Modify: `src/demos/effects/werkstatt-demo.tsx`, `src/lib/werkstattScripts.ts` (only if Task 1 finds script/API drift)

**Pre-seeded findings (apply unless Task 1 disproves):**

- [ ] **Step 1: Surface post-init errors.** `status` is rendered ONLY in the pre-init card (line 370); every post-init failure (`setStatus("Failed to load effect: ...")` at lines 120, 201, 255) is invisible. Add an `actionError` state rendered as `<Callout.Root color="red" role="alert">` near the showcase grid; clear it on the next successful action. Init-path failures keep using the pre-init card but also get the red callout treatment.

- [ ] **Step 2: Async guards on mode switches.** `loadShowcaseEffect`, `loadApiExample`, and `switchAudioSource` are async with no in-flight guard — double-click inserts two Werkstatt boxes, and the slower compile wins the refs. Add a single `busy` state (disable the showcase cards / segmented control / Load buttons while a compile is in flight) — simplest guard consistent with the campaign's "async guards where mode switches exist" bar.

- [ ] **Step 3: Fix the 5-column showcase grid** (`repeat(5, 1fr)`, line 420) for mobile — switch to `repeat(auto-fill, minmax(140px, 1fr))` and verify no 390px clipping.

- [ ] **Step 4: Apply Task 1 findings** (ScriptCompiler claims, `block.flags & 4`, `index.setValue(0)` reorder idiom, param-table rows in the API reference section — the demo's own rendered table at lines 552-558 must match verified SDK behavior).

- [ ] **Step 5: Console restyle.** Same conventions as Task 2, applied to `werkstatt-demo.html` + page. The script source `<pre>` blocks adopt `CODE_BLOCK_STYLE`. Showcase cards + parameter sliders keep instrument-panel restraint. Natural signature element: none forced — the code blocks ARE the content.

- [ ] **Step 6: Browser-verify over HTTPS:** Start engine → play drums → load each of ≥3 showcase effects (params appear, audio audibly processed — assert param boxes exist via UI state) → move a param slider → switch source to Sine then back to Drums → load one API example → Clear Effect → console clean (the compile path logs nothing unexpected). Verify a deliberately broken script path if cheaply reachable (else note as not-covered). Mobile 390px scan, keyboard focus pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: werkstatt demo audit — fixes + console design"
```

---

### Task 4: Export demo — fixes + console restyle

**Files:**
- Modify: `src/demos/export/export-demo.tsx`, `src/lib/rangeExport.ts` (only where Task 1 found drift)

**Pre-seeded findings (apply unless Task 1 disproves):**

- [ ] **Step 1: Resolve `project.lastRegionAction()`** per Task 1's verdict (exists/renamed/wrong-semantic). If wrong, derive max bar from `getAllRegions(project)` (`src/lib/adapterUtils.ts`) — `Math.max(region.position + region.duration)`.

- [ ] **Step 2: `loopingRange` desync.** If playback stops by any path other than the demo's own Stop button (engine reaches end, transport stopped elsewhere), `loopingRange` stays `true` and the button shows "Stop" while idle. Derive it from the engine instead of duplicating state: when `isPlaying` flips false, reset `loopingRange`.

```tsx
useEffect(() => {
  if (!isPlaying) setLoopingRange(false);
}, [isPlaying]);
```

- [ ] **Step 3: Error handling to current bar.** Init catch (line 146-149) → red `role="alert"` callout instead of bare status text (export failures already reach `exportStatus` — render failures in the red callout variant, successes in the neutral one). Replace module-level `let nextResultId = 0` with a `useRef` counter (module state survives HMR remounts and double-mounts in StrictMode).

- [ ] **Step 4: Apply Task 1 findings to `rangeExport.ts`** (worklet connect output-0 rule, ExportConfiguration shape, mutate-copy-restore ordering). If any change here alters rendered audio, flag for `/audio-verify` in Task 6.

- [ ] **Step 5: Console restyle.** Same conventions; `export-demo.html` fonts; range/metronome/export cards keep instrument-panel restraint. Natural signature element candidate: the export-results list with duration/size badges — restyle, don't decorate.

- [ ] **Step 6: Browser-verify over HTTPS:** load → set range bars 2–4 → Play Range (verify loop) → Stop → export mixdown (await result card) → preview-play the result → download WAV (verify download event) → export 2 stems + metronome stem → console clean. Edge: start bar > end bar input → button disabled. Mobile 390px scan, keyboard focus pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: export demo audit — fixes + console design"
```

---

### Task 5: CLAUDE.md + documentation corrections

**Files:**
- Modify: `src/demos/effects/CLAUDE.md`, `src/demos/export/CLAUDE.md` (every nuanced/wrong verdict from Task 1, directive style — no "PR #N"/"recurring failure mode" padding, per the established CLAUDE.md style)
- Modify: `documentation/11-effects.md`, `documentation/10-export.md` — ONLY claims a demo audit proved factually wrong (campaign scope rule)
- Modify: root `CLAUDE.md` — only if a wave finding contradicts a root claim

- [ ] **Step 1: Apply every nuanced/wrong verdict** to the two category CLAUDE.mds. New knowledge discovered during Tasks 2–4 (e.g. verified clamping behavior of out-of-range `volume.setValue`) lands as directives.
- [ ] **Step 2: Sweep `documentation/11-effects.md` + `documentation/10-export.md`** for the specific claims the audit disproved — fix those sections only.
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: effects + export CLAUDE.md and chapter-doc corrections from wave 6 audit"
```

---

### Task 6: og-images + wave verification

**Files:**
- Replace: `public/og-image-effects.png`, `public/og-image-werkstatt.png`, `public/og-image-export.png` (1200×630, post-restyle)

- [ ] **Step 1: Regenerate the three og-images** via Playwright at 1200×630 against the restyled pages (default screenshot naming → `.playwright-mcp/`, then move into `public/`); confirm the HTML `og:image`/`twitter:image` tags still point at the right files.
- [ ] **Step 2: Full verification suite:**

```bash
npm test          # expect 37/37 (or current main count — check worktrees aren't inflating)
npm ci            # lockfile-sync check (campaign done-criterion)
npm run build     # green
npx tsc --noEmit --ignoreDeprecations "6.0"   # zero NEW errors vs main (extract main's error set first)
```

- [ ] **Step 3: `/audio-verify`** — only if Task 4 changed render behavior in `rangeExport.ts` or any shared audio path (record the decision either way in the PR description).
- [ ] **Step 4: Wave integration review** (two-stage, per campaign convention): one review pass for spec compliance against this plan + the campaign checklist, one for quality. Fix all must-fix findings; re-verify.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wave 6 og-images + verification fixes"
```

---

### Task 7: Campaign close-out + PR

**Files:**
- Delete: `docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md` (campaign complete — durable knowledge must already be in CLAUDE.mds/documentation by Task 5)
- Delete: `docs/superpowers/plans/2026-06-12-demo-audit-wave-6.md` (this plan)
- Delete: `debug/wave6-audit-findings.md` (contents graduate into the PR description)

- [ ] **Step 1: Verify nothing durable lives only in the spec/findings file** — anything load-bearing must exist in a CLAUDE.md, `documentation/`, or `docs/design/` before deletion.
- [ ] **Step 2: Delete the three files, commit**

```bash
git rm docs/superpowers/specs/2026-06-11-demo-audit-campaign-design.md \
       docs/superpowers/plans/2026-06-12-demo-audit-wave-6.md \
       debug/wave6-audit-findings.md
git commit -m "docs: demo audit campaign complete — remove spec, wave 6 plan, findings scratch"
```

- [ ] **Step 3: Push + open the PR** following the wave 1–5 description format: audit verdict table, demo-fix summary, design summary, verification section (incl. the audio-verify decision), follow-ups list.

```bash
git push -u origin demo-audit-wave-6
gh pr create --title "feat: demo audit wave 6 — effects + export (source-verified, console design applied, campaign complete)" --body "<wave format>"
```

- [ ] **Step 4: Run `/pr-review-toolkit:review-pr`** (applicable aspects), fix Critical + Important findings on the branch, comment the round on the PR.
- [ ] **Step 5: Squash-merge after review passes** (`gh pr merge --squash`), per repo convention — confirm with the user before merging if anything in the review round was contentious.
