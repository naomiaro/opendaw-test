# Spielwerk Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A listed demo page where the visitor browses, edits and compiles Spielwerk scripts (the scriptable MIDI effect) over the same looping pattern and synth as the MIDI Effects demo, with declared parameters as knobs and an API reference whose examples load into the editor.

**Architecture:** PR 2, stacked on `feat/midi-effects-demos` (plan `2026-11-03-midi-effects-demo.md`); it reuses `patterns.ts`, `NoteLane`, `EmittedBars` and the chain helpers. New: the script catalogue and reference text as data, a shared script-parameter reader extracted from the Werkstatt demo, an editor component that compiles on demand only, and the page. The spec file is deleted in this PR.

**Tech Stack:** React 19, Radix Themes, OpenDAW SDK 0.0.180 (`EffectFactories.Spielwerk`, `ScriptCompiler`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-midi-effects-demos-design.md`

## Global Constraints

- Everything in PR 1's Global Constraints.
- Compile only on the Compile button and Cmd/Ctrl+Enter; never on a typing pause.
- The device keeps its last good script on a failed compile.
- One Spielwerk on the chain, inserted at init, with an enabled toggle; nothing else on the chain.
- Every pre-built script and every reference example compiles and runs on the installed SDK, verified in the browser before the PR; none ships commented out.
- Branch: `feat/spielwerk-demo` off `feat/midi-effects-demos`; PR base is `feat/midi-effects-demos`, retargeted to `main` once PR 1 merges and before its branch is deleted.

## Review Focus

- A compile that fails at module evaluation after the box write (the compiler validates syntax first but writes `code` before `addModule`): the restore path must put the previous source back (Task 3 test "restores the previous source on a rejected compile").
- A script with `// @no-pass` and an empty generator silences the unit: the page must say so under the editor rather than look broken (Task 4 Step 2 check).
- A `@param` renamed by an edit: the old knob must disappear and the new one appear after compile (Task 2 test "readScriptParams reflects the current declarations").
- Cmd/Ctrl+Enter while the textarea is not focused must not compile; the button always does (Task 3 test).
- Loading a pre-built script over unsaved edits: the "Restore previous" link must bring the edits back once (Task 3 test "restore previous brings back the replaced text").

---

### Task 1: Scripts and reference data

**Files:**
- Create: `src/lib/midiEffects/spielwerkScripts.ts`
- Test: `src/lib/midiEffects/spielwerkScripts.test.ts`

**Interfaces:**
```ts
export type ScriptId = "echo" | "chord" | "humanize" | "octave-jump" | "strum" | "note-filter" | "blank";
export interface SpielwerkScript { id: ScriptId; label: string; blurb: string; source: string; params: readonly string[] }
export const SPIELWERK_SCRIPTS: readonly SpielwerkScript[];   // in the design's order, blank last
export interface ReferenceEntry { name: string; signature: string; doc: string; example: string }
export const SPIELWERK_REFERENCE: readonly ReferenceEntry[];   // process, block, events, note-on/off shapes, yield, @no-pass, @param, paramChanged, reset, pulse grid
```
Each script is a `class Processor` with `* process(block, events)` and the `@param` lines the design table lists (`// @param delay 240 60 960 int`, `// @param repeats 3 1 8 int`, `// @param decay 0.6`, and so on; a pulses parameter uses `int`). Values arrive through `paramChanged(label, value)` stored on `this`. Start from the audit's `SPIELWERK_ECHO` shape (`src/lib/audit/midiEffectScenarios.ts`). Reference text is written in this repo's words from the studio's `script-entry-points.ts` NOTE entries, never copied.

- [ ] **Step 1: Write the failing tests**

```ts
it("lists the seven scripts, blank last", () => expect(SPIELWERK_SCRIPTS.map((s) => s.id)).toEqual(["echo", "chord", "humanize", "octave-jump", "strum", "note-filter", "blank"]));
it("every script is a Processor with a process generator", () => { for (const s of SPIELWERK_SCRIPTS) { expect(s.source).toMatch(/class Processor/); expect(s.source).toMatch(/\*\s*process\s*\(\s*block\s*,\s*events\s*\)/); } });
it("declared params match the @param lines", () => { for (const s of SPIELWERK_SCRIPTS) { const declared = [...s.source.matchAll(/^\/\/ @param (\w+)/gm)].map((m) => m[1]); expect(declared).toEqual([...s.params]); } });
it("no-pass scripts say so", () => { for (const id of ["humanize", "octave-jump", "strum", "note-filter"]) expect(SPIELWERK_SCRIPTS.find((s) => s.id === id)!.source).toMatch(/^\/\/ @no-pass/m); });
it("every reference entry has a runnable example", () => { for (const e of SPIELWERK_REFERENCE) expect(e.example).toMatch(/class Processor/); });
```

- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Write the scripts and entries.** — [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat(spielwerk): script catalogue and reference"`.

---

### Task 2: Shared script-parameter reader

**Files:**
- Create: `src/lib/scriptParams.ts`
- Modify: `src/demos/effects/werkstatt-demo.tsx` (replace its inline `readWerkstattParams` and the body of `updateEffectParam` with the shared functions)
- Test: `src/lib/scriptParams.test.ts`

**Interfaces:**
```ts
export interface ScriptParam { label: string; value: number }
export function readScriptParams(box: { parameters: Field<Pointers.Parameter> }): ScriptParam[];   // label, value from each parameter box on the pointer hub
export function writeScriptParam(editing: Editing, box: { parameters: Field<Pointers.Parameter> }, label: string, value: number): boolean;  // false when no such label
```

- [ ] **Step 1: Write the failing tests** on a real graph: a `SpielwerkDeviceBox` on a unit's `midiEffects` (by hand, as `midiEffectFixture` does) with two `ParameterBox`es (the SDK's parameter box class for scripts; find it where `ScriptCompiler` creates them in the openDAW checkout) pointing at `box.parameters`. "readScriptParams reflects the current declarations": two labels read; delete one, one label reads. `writeScriptParam` of a known label changes `value`; of an unknown label returns false.
- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Implement, and sweep the Werkstatt demo onto it.** `npm run typecheck` exits 0; load `werkstatt-demo.html`, change a parameter while playing, hear it apply.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit and push** — `"refactor: shared script parameter reader, used by Werkstatt"`.

---

### Task 3: Editor component

**Files:**
- Create: `src/demos/midi/SpielwerkEditor.tsx`
- Test: `src/demos/midi/SpielwerkEditor.dom.test.tsx` (jsdom)

**Interfaces:**
```ts
export interface SpielwerkEditorProps {
  source: string;
  onChange(source: string): void;
  onCompile(source: string): Promise<void>;     // rejects with the compiler's error
  busy: boolean;
  restorable: string | null;                     // the text a load replaced; null when none
  onRestore(): void;
}
```
A `<textarea>` styled as code (monospace, `--mc-panel`), spellcheck off, tab inserts two spaces; a Compile `Button`; Cmd/Ctrl+Enter inside the textarea calls `onCompile(source)`; the rejection's message shows in a `Callout` under the editor, cleared on the next successful compile; a "Restore previous" link when `restorable !== null`.

- [ ] **Step 1: Write the failing tests** with `@testing-library/react` and `userEvent`: the button calls `onCompile` with the current text; Cmd+Enter in the textarea calls it; Cmd+Enter on the document body does not; a rejected `onCompile` shows its message; "restore previous brings back the replaced text" (`onRestore` called, the link gone when `restorable` becomes null).
- [ ] **Step 2: Run to verify failure.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run tests and typecheck** → PASS.
- [ ] **Step 5: Commit and push** — `"feat(spielwerk): editor component"`.

---

### Task 4: The page

**Files:**
- Create: `src/demos/midi/spielwerk-demo.tsx`, `src/demos/midi/SpielwerkReference.tsx`, `src/demos/midi/useSpielwerkCompile.ts`
- Create: `spielwerk-demo.html` (title "OpenDAW Spielwerk Demo", description "Write a scriptable MIDI effect in JavaScript: echo, chords, humanize and more over a looping synth pattern"; og-image `og-image-spielwerk.png`)
- Modify: `vite.config.ts` (input `spielwerk`), `src/index.tsx` (card after MIDI Effects), `public/sitemap.xml`, `README.md` (table row, tree entry), `src/demos/midi/midi-effects-demo.tsx` (nothing to change: its link already points at `/spielwerk-demo.html`)
- Delete: `docs/superpowers/specs/2026-11-03-midi-effects-demos-design.md`

**Interfaces:**
- `useSpielwerkCompile(project, audioContext, box: SpielwerkDeviceBox)` returns `{ compile(source): Promise<void>; busy: boolean; params: ScriptParam[]; writeParam(label, value) }`. `compile` snapshots `box.code.getValue()`, awaits `compiler.compile(audioContext, project.editing, box, source)` (compiler from `ScriptCompiler.create({ headerTag: "spielwerk", registryName: "spielwerkProcessors", functionName: "spielwerk" })`, created once in a ref), on rejection restores the snapshot with `editing.modify` if `box.code.getValue()` changed, then rethrows; on success re-reads `params` and, if `project.engine.isPlaying.getValue()`, calls `project.engine.setPosition(0)`.
- `SpielwerkReference({ entries, onLoad(example) })`: a list of entries with name, signature, doc, and a "Load example" link.

Page wiring: as PR 1's page (init, Vaporisateur, region, `writePattern` with `melody` default, loop, transport, pattern picker, the two lanes at half height) with one Spielwerk inserted via `insertDevice`-style `project.api.insertEffect(field, EffectFactories.Spielwerk)` at init and the Echo script compiled at once; an enabled `Switch`; the scripts row (`Button` per `SPIELWERK_SCRIPTS`, the active one highlighted); loading a script sets `restorable` to the editor's current text when it differs from the loaded script's source, writes the source, compiles; the `SpielwerkEditor`; a `ParamSlider`-like row of plain Radix `Slider`s over `params` (script params are raw values, not unit parameters: `writeScriptParam` on change); the reference panel; a note under the editor: "A `// @no-pass` script that yields nothing silences the unit."

- [ ] **Step 1: Build the hook, the reference component and the page.** `npm run typecheck` exits 0.
- [ ] **Step 2: Run it.** Open `spielwerk-demo.html`, real click on Play. Check in this order: Echo audible and its three onsets per note on the emitted lane; each of the other scripts loads, compiles without error, and sounds as its blurb says; every reference example loads and compiles; a deliberate syntax error shows the message and the sound continues unchanged; a `// @no-pass` blank script silences the unit and the note under the editor explains it; changing `delay` on Echo moves the echoes. Fix scripts that the runtime rejects.
- [ ] **Step 3: Checklist edits** and `npm run build` exits 0.
- [ ] **Step 4: Commit and push** — `"feat(spielwerk): the Spielwerk demo page"`.

---

### Task 5: Audio verification, og-image, PR

- [ ] **Step 1: Measure the output** as PR 1's Task 9 Step 1, on the `melody` pattern: Spielwerk disabled → 16 onsets per two bars; Echo enabled with 3 repeats → 48. Record the figures.
- [ ] **Step 2: Screenshot** at 1200×630 with Echo loaded and the lanes populated; save as `public/og-image-spielwerk.png`; commit and push.
- [ ] **Step 3: Delete the spec file**, commit `"docs: remove the MIDI effects demos spec (work complete)"`, push.
- [ ] **Step 4: Open the PR** with base `feat/midi-effects-demos`: body states the page, the figures, the Werkstatt sweep onto `scriptParams.ts`, and the follow-up (semantics audit and the emitted lane's second source) as a note, not a promise. Run `/pr-review-toolkit:review-pr`, fix Critical and Important findings. After PR 1 merges, `gh pr edit --base main`.
