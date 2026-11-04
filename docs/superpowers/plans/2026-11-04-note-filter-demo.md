# Note Filter in the MIDI Effects demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The stock Note Filter MIDI effect becomes the fifth card on the MIDI Effects demo and its Rendered sub-demo, with the semantics rule the Rendered page predicts through.

**Architecture:** The device registry (`src/lib/midiEffects/devices.ts`) gains the device and a control kind per parameter; the card renders a `ParamSwitch` for the boolean and dims the parameter Set ignores. The semantics rule layer (`src/lib/audit/midiEffectSemanticsRules.ts`, `…Rows.ts`) gains `noteFilterRule`, the `DeviceSetting` variant and the settings reader / writer, so `useRenderedNotes` predicts a chain holding the device. No audit rows, no register change.

**Tech Stack:** TypeScript, React 18 + Radix Themes, Vitest (Node; jsdom for `.dom.test.tsx`), `@opendaw/studio-sdk@0.0.181`.

**Spec:** `docs/superpowers/specs/2026-11-04-note-filter-demo-design.md`

## Global Constraints

- Branch `feat/note-filter-demo` off `main` in THIS tree (the dev server on 5173 serves it; no worktree). Commit AND push; the PR is squash-merged by the user.
- `devices.ts` stays loadable in Node: no value import of `@opendaw/studio-core` (factory as key). `midiEffectSemanticsRules.ts` keeps `PPQN` as its only SDK import.
- Card writes go through `writeParameterUnit` / `useParameterUnit` only (never a raw field write from a control).
- The rule: a note passes when `min <= pitch <= max` (both included); then `pitch = set ? key : pitch + transpose`; a result outside 0..127 is DROPPED, never clamped; position, duration, cent, velocity unchanged.
- Card order `["arpeggio", "note-filter", "pitch", "velocity", "zeitgeist"]`; parameter order Min, Max, Set, Semitones, Key; label "Note Filter"; factory key `"NoteFilter"`.
- `npm run typecheck` exits 0 and `npm test` is green before every commit. Comments say why, one line where possible. No edits under `src/` while a browser run is on.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. Min above Max: the rule returns no notes and the Rendered page draws only ghosts, no error. Pinned in Task 2 (`noteFilterRule` test "min above max passes nothing").
2. Set on with Key far from the pattern (e.g. C-2): every note lands on Key; the lane counts a pitch below 36 "out of range" as it does for Pitch. Pinned in Task 2 (Set test at key 0) and read in Task 5.
3. A transposed result past 127 on Melody at +60 st: key 71 is dropped, key 60 becomes 120. Pinned in Task 2 ("transpose drops a result outside 0..127, not clamped") and read on the Rendered page in Task 5.
4. Undo after the switch write: the switch flips back through the binding's subscription and the dimming follows. Pinned in Task 3 (`ParamSwitch.dom.test.tsx` undo case).
5. A chain with Note Filter after Pitch: the filter judges the SHIFTED pitch (index 0 first). Pinned in Task 2 (`composeRules` test).

---

### Task 1: Register the device (registry, fixture, parameter control kinds)

**Files:**
- Modify: `src/lib/midiEffects/devices.ts` (`DeviceId`, `FactoryKey`, `DEVICE_IDS`, `DEVICES`, `DeviceParameter`, `deviceIdOf`, `deviceParameters`, header comment)
- Modify: `src/lib/testing/boxGraphFixtures.ts:126-175` (`midiEffectFixture` case + adapter)
- Modify: `src/lib/midiEffects/chain.test.ts:103-106` (the factories stub gains `NoteFilter`)
- Test: `src/lib/midiEffects/devices.test.ts`

**Interfaces:**
- Produces: `DeviceId` includes `"note-filter"`; `FactoryKey` includes `"NoteFilter"`; `DEVICES["note-filter"]: DeviceSpec`; `DeviceParameter` gains `readonly control?: "switch"` (absent = slider) and `readonly dimWhen?: { readonly key: string; readonly on: boolean }` ("dimmed while the parameter named `key` reads on / off"); `deviceParameters(adapter)` for a `NoteFilterDeviceBoxAdapter` returns keys `["min", "max", "set", "transpose", "key"]` with `positions` 128 / 128 / — / 255 / 128, `set` with `control: "switch"`, `transpose` with `dimWhen: { key: "set", on: true }`, `key` with `dimWhen: { key: "set", on: false }`; `midiEffectFixture("note-filter")` returns a `NoteFilterDeviceBox` with a `NoteFilterDeviceBoxAdapter`.

- [ ] **Step 1: Write the failing tests** in `devices.test.ts` (replace the first test, add three):

```ts
it("registers the five devices in the SDK's order, each naming its factory", () => {
  expect(DEVICE_IDS).toEqual(["arpeggio", "note-filter", "pitch", "velocity", "zeitgeist"]);
  expect(DEVICE_IDS.map((id) => DEVICES[id].factoryKey)).toEqual(["Arpeggio", "NoteFilter", "Pitch", "Velocity", "Zeitgeist"]);
});
it("note filter parameters: card order, key names, the Set switch and what it dims", () => {
  const { adapter } = midiEffectFixture("note-filter");
  const params = deviceParameters(adapter);
  expect(params.map((p) => p.key)).toEqual(["min", "max", "set", "transpose", "key"]);
  expect(params.map((p) => p.positions)).toEqual([128, 128, undefined, 255, 128]);
  expect(params[0].parameter.getPrintValue().value).toBe("C-2");
  expect(params[4].parameter.getPrintValue().value).toBe("C3"); // MidiKeys.toFullString: C-2 is key 0
  expect(params[2].control).toBe("switch");
  expect(params[3].dimWhen).toEqual({ key: "set", on: true });
  expect(params[4].dimWhen).toEqual({ key: "set", on: false });
  expect(params.filter((p) => p.key !== "set").every((p) => p.control === undefined)).toBe(true);
});
it("deviceIdOf names a note filter box", () => {
  expect(deviceIdOf(midiEffectFixture("note-filter").box)).toBe("note-filter");
});
```

(Key names are `MidiKeys.toFullString`: `C-2` for 0, `C3` for 60, `G8` for 127. Copy that names a slider position uses these names, and the `what` copy ends with one clause saying so: key names as the SDK prints them, middle C as C3.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/midiEffects/devices.test.ts`
Expected: FAIL (type error / `DEVICES["note-filter"]` undefined).

- [ ] **Step 3: Widen the registry** in `devices.ts`: the two unions, `DEVICE_IDS`, the `DEVICES` entry (`id: "note-filter"`, `label: "Note Filter"`, `factoryKey: "NoteFilter"`; `what` / `listenFor` / `laneNote` / `snippet` per the spec's Copy section, the snippet writing `namedParameter.min.setValue(62)` (D3) through `NoteFilterDeviceBoxAdapter`), `deviceIdOf` (`NoteFilterDeviceBox`), `deviceParameters` (`NoteFilterDeviceBoxAdapter`, labels "Min", "Max", "Set", "Semitones", "Key"), and the header comment ("the five stock MIDI effects"). Add the two optional fields to `DeviceParameter` with one-line doc comments.

- [ ] **Step 4: Extend the fixture** in `boxGraphFixtures.ts`: `case "note-filter": return { unit, box: NoteFilterDeviceBox.create(boxGraph, UUID.generate(), common("Note Filter")) };` and `box instanceof NoteFilterDeviceBox ? new NoteFilterDeviceBoxAdapter(context, box)` in the adapter chain. Add `NoteFilter: factoryFor("Pitch")` to the `chain.test.ts` factories stub (the stub only needs the key present; the test's class map stays).

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/lib/midiEffects && npm run typecheck`
Expected: all PASS; typecheck exits 0 (the `pageState` and `chain` suites compile with the wider union).

- [ ] **Step 6: Commit**

```bash
git add src/lib/midiEffects/devices.ts src/lib/midiEffects/devices.test.ts src/lib/testing/boxGraphFixtures.ts src/lib/midiEffects/chain.test.ts
git commit -m "MIDI effects: Note Filter registered as the fifth device, with a control kind per parameter"
```

---

### Task 2: The Note Filter rule in the semantics layer

**Files:**
- Modify: `src/lib/audit/midiEffectSemanticsRules.ts` (`NoteFilterSettings`, `DeviceSetting`, `RULE_SENTENCES`, `noteFilterRule`, `applyStage`)
- Modify: `src/lib/audit/midiEffectSemanticsRows.ts` (`NOTE_FILTER_BASE`, `FACTORY_KEYS`, `NON_IDENTITY`, `settingsOf`, `applySettings`)
- Test: `src/lib/audit/midiEffectSemanticsRules.test.ts`, `src/lib/audit/midiEffectSemanticsRows.test.ts`

**Interfaces:**
- Consumes: `midiEffectFixture("note-filter")` (Task 1).
- Produces: `export interface NoteFilterSettings { min: number; max: number; set: boolean; transpose: number; key: number }`; `DeviceSetting` variant `{ device: "note-filter"; settings: NoteFilterSettings }` (so `SemanticsDevice` includes `"note-filter"`); `export function noteFilterRule(notes: readonly RuleNote[], settings: NoteFilterSettings): RuleNote[]`; `export const NOTE_FILTER_BASE: NoteFilterSettings = { min: 0, max: 127, set: false, transpose: 0, key: 60 }`; `FACTORY_KEYS["note-filter"] === "NoteFilter"` (its value type widened to include `"NoteFilter"`); `settingsOf(box)` reads a `NoteFilterDeviceBox`; `applySettings(box, setting)` writes one.
- Unchanged on purpose: `ORDERS`, `disabledRows`, `DEVICE_FILTERS`, `RowGroup`, `QUESTIONS`, `questionsFor` (rows and the audit filter are the second PR; the drop is documented in this crate's own header).

- [ ] **Step 1: Write the failing rule tests** in `midiEffectSemanticsRules.test.ts`, a `describe("noteFilterRule")` beside `pitchRule`'s, with a helper `const at = (pitch: number, cent = 0): RuleNote => ({ position: 960, duration: 240, pitch, cent, velocity: 0.7 })`:

```ts
it("at the defaults passes everything unchanged", () => {
  const notes = [at(0), at(60, 12.5), at(127)];
  expect(noteFilterRule(notes, NOTE_FILTER_BASE)).toEqual(notes);
});
it("both range ends are included; min above max passes nothing (device-note-filter/src/lib.rs output_pitch)", () => {
  const notes = [34, 35, 36, 37, 38, 39].map((p) => at(p));
  expect(noteFilterRule(notes, { ...NOTE_FILTER_BASE, min: 36, max: 38 }).map((n) => n.pitch)).toEqual([36, 37, 38]);
  expect(noteFilterRule(notes, { ...NOTE_FILTER_BASE, min: 70, max: 50 })).toEqual([]);
});
it("transpose adds semitones and drops a result outside 0..127, not clamped", () => {
  expect(noteFilterRule([at(60), at(71)], { ...NOTE_FILTER_BASE, transpose: 60 }).map((n) => n.pitch)).toEqual([120]);
  expect(noteFilterRule([at(9), at(10)], { ...NOTE_FILTER_BASE, transpose: -10 }).map((n) => n.pitch)).toEqual([0]);
});
it("set plays every passing note as key, ignoring transpose, cent and velocity kept", () => {
  const out = noteFilterRule([at(35), at(36, 12.5), at(48), at(49)], { min: 36, max: 48, set: true, transpose: 12, key: 0 });
  expect(out.map((n) => n.pitch)).toEqual([0, 0]);
  expect(out[0].cent).toBe(12.5);
  expect(out[0].velocity).toBe(0.7);
  expect(out[0].position).toBe(960);
});
```

and in `describe("composeRules")`:

```ts
it("Pitch then Note Filter judges the shifted pitch; Note Filter then Pitch judges the written one", () => {
  const source = [at(60), at(67)];
  const pitch: DeviceSetting = { device: "pitch", settings: { semiTones: 12, cents: 0, octaves: 0 } };
  const filter: DeviceSetting = { device: "note-filter", settings: { ...NOTE_FILTER_BASE, min: 72, max: 127 } };
  expect(composeRules([pitch, filter], context, none, source).map((n) => n.pitch)).toEqual([72, 79]);
  expect(composeRules([filter, pitch], context, none, source).map((n) => n.pitch)).toEqual([]);
});
```

(`context` and `none` as the existing `composeRules` tests build them.) Also add `"RULE_SENTENCES has a sentence per device"`: `expect(Object.keys(RULE_SENTENCES).sort()).toEqual(["arpeggio", "note-filter", "pitch", "velocity", "zeitgeist"])`.

- [ ] **Step 2: Write the failing rows tests** in `midiEffectSemanticsRows.test.ts`: change "FACTORY_KEYS names the four factories" to five (`expect(FACTORY_KEYS).toEqual({ arpeggio: "Arpeggio", "note-filter": "NoteFilter", pitch: "Pitch", velocity: "Velocity", zeitgeist: "Zeitgeist" })`); in `describe("settingsOf")` / `describe("applySettings")`:

```ts
it("reads a Note Filter at its defaults and reads back what applySettings wrote", () => {
  const nf = midiEffectFixture("note-filter");
  expect(settingsOf(nf.box)).toEqual({ device: "note-filter", settings: NOTE_FILTER_BASE });
  const settings = { min: 36, max: 48, set: true, transpose: -5, key: 72 };
  transact(nf.boxGraph, () => applySettings(nf.box, { device: "note-filter", settings }));
  expect(settingsOf(nf.box)).toEqual({ device: "note-filter", settings });
  expect(() => transact(nf.boxGraph, () => applySettings(nf.box, { device: "pitch", settings: PITCH_BASE }))).toThrow();
});
```

Keep the row-count test at 230 / 41: no row is added.

- [ ] **Step 3: Run both files to verify they fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRules.test.ts src/lib/audit/midiEffectSemanticsRows.test.ts`
Expected: FAIL (`noteFilterRule` not exported, `NOTE_FILTER_BASE` missing).

- [ ] **Step 4: Implement the rule layer.** In `…Rules.ts`: the settings interface, the `DeviceSetting` variant, a `RULE_SENTENCES["note-filter"]` sentence stating the rule, `noteFilterRule` (doc comment citing `device-note-filter/src/lib.rs` `output_pitch` and `transform`, lines at the pinned tag), and the `applyStage` case. In `…Rows.ts`: `NOTE_FILTER_BASE`, a `noteFilter(settings)` draft helper in the shape of `pitch(...)` if the file builds settings that way, `FACTORY_KEYS["note-filter"]: "NoteFilter"`, `NON_IDENTITY["note-filter"] = noteFilter({ ...NOTE_FILTER_BASE, min: 60 })` (a filter that drops the low notes; unused by rows until the second PR), the `settingsOf` branch (`NoteFilterDeviceBox`, five `getValue()` reads), and the `applySettings` case (five `setValue` writes, the mismatch throw as the others).

- [ ] **Step 5: Run the audit suites and the typecheck**

Run: `npx vitest run src/lib/audit src/lib/midiEffects src/demos/midi && npm run typecheck`
Expected: PASS; exit 0. (`useRenderedNotes.dom.test.tsx` and the audit pages compile against the wider `SemanticsDevice`; if a `Record<SemanticsDevice, …>` elsewhere fails to compile, add its `"note-filter"` entry.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsRules.ts src/lib/audit/midiEffectSemanticsRules.test.ts src/lib/audit/midiEffectSemanticsRows.ts src/lib/audit/midiEffectSemanticsRows.test.ts
git commit -m "MIDI effect semantics: the Note Filter rule (range both ends included, transpose or set, out-of-range dropped), settings reader and writer; no rows yet"
```

---

### Task 3: `ParamSwitch` and the card's switch + dimming

**Files:**
- Create: `src/components/ParamSwitch.tsx`
- Test: `src/components/ParamSwitch.test.tsx` (markup, Node), `src/components/ParamSwitch.dom.test.tsx` (jsdom: click + undo)
- Modify: `src/demos/midi/MidiEffectCard.tsx`

**Interfaces:**
- Consumes: `DeviceParameter.control` / `.dimWhen` (Task 1); `useParameterUnit(project, parameter): [unit, print, write]`; `observeParameter(parameter, onChange)` from `@/lib/parameterBinding`.
- Produces: `export const ParamSwitch: React.FC<{ project: Pick<Project, "editing">; parameter: UnitParameter; label: string }>` — a Radix `Switch` with `checked={unit >= 0.5}`, `onCheckedChange={(on) => write(on ? 1 : 0)}`, `aria-label={label}`, the label on the left and the parameter's print ("On" / "Off") beside it in the slider's readout style. In the card: a `useSwitchStates(project, parameters): Record<string, boolean>` hook (in `MidiEffectCard.tsx`) that subscribes through `observeParameter` to every parameter with `control === "switch"` and keeps `unit >= 0.5` per key; each control's wrapper gets `style={{ opacity: dimmed ? 0.45 : 1 }}` where `dimmed = p.dimWhen !== undefined && states[p.dimWhen.key] === p.dimWhen.on`, still operable.

- [ ] **Step 1: Write the failing markup test** `ParamSwitch.test.tsx` (the `render` helper from `ParamSlider.test.tsx`), on `midiEffectFixture("note-filter").adapter.namedParameter.set` (narrow with `instanceof NoteFilterDeviceBoxAdapter`):

```ts
it("shows the label, prints Off and renders an unchecked switch named by its label", () => {
  const markup = render(<ParamSwitch project={{ editing }} parameter={set} label="Set" />);
  expect(markup).toContain("Set");
  expect(markup).toContain("Off");
  expect(markup).toMatch(/role="switch"[^>]*aria-checked="false"/);
  expect(markup).toContain('aria-label="Set"');
});
```

- [ ] **Step 2: Write the failing DOM test** `ParamSwitch.dom.test.tsx` (`// @vitest-environment jsdom`, `@/lib/testing/domSetup` first; `@testing-library/react` `render` + `fireEvent.click` on `getByRole("switch")`):

```ts
it("a click writes on through the binding, prints On, and undo flips it back", () => {
  // fixture as above; editing = fixture.editing (a BoxEditing)
  fireEvent.click(screen.getByRole("switch"));
  expect(set.getUnitValue()).toBe(1);
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("On")).toBeTruthy();
  act(() => { editing.undo(); });
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run src/components/ParamSwitch.test.tsx src/components/ParamSwitch.dom.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `ParamSwitch`** per the Interfaces block, in the shape of `ParamSlider` (a `Flex` column; `Text size="1" color="gray"` label and mono readout).

- [ ] **Step 5: Run the two tests to verify they pass**

Run: `npx vitest run src/components/ParamSwitch.test.tsx src/components/ParamSwitch.dom.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire the card.** In `MidiEffectCard.tsx`: `useSwitchStates`, and in the parameter grid render `p.control === "switch" ? <ParamSwitch …/> : <ParamSlider …/>` inside a wrapper `div` carrying the dim opacity and `data-dimmed={dimmed ? "" : undefined}`.

- [ ] **Step 7: Write a card DOM test** in `src/demos/midi/MidiEffectCard.dom.test.tsx` (jsdom; render the card with `midiEffectFixture("note-filter")`'s box as a `ChainEntry` `{ id: "note-filter", box, enabled: true }` and `project = { editing, boxAdapters }` — check `ChainEntry`'s shape in `useMidiChain.ts` and the card's `project` reads (`boxAdapters.adapterFor`, `editing`); build `boxAdapters` as `boxGraphFixtures.ts` does for the Zeitgeist groove, or pass the fixture's adapter through a test-only prop if `adapterFor` cannot be built in Node — the builder's call, named in the test's comment):

```ts
it("dims Key while Set is off and Semitones once it is on", () => {
  const dimmed = () => [...document.querySelectorAll("[data-dimmed]")].map((el) => el.textContent ?? "");
  expect(dimmed()).toHaveLength(1);
  expect(dimmed()[0]).toContain("Key");
  fireEvent.click(screen.getByRole("switch", { name: "Set" }));
  expect(dimmed()).toHaveLength(1);
  expect(dimmed()[0]).toContain("Semitones");
});
```

(The card's `project` prop is typed `Project`; the test passes `{ editing, boxAdapters } as unknown as Project`.)

- [ ] **Step 8: Run the midi suites and the typecheck**

Run: `npx vitest run src/components src/demos/midi && npm run typecheck`
Expected: PASS; exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/components/ParamSwitch.tsx src/components/ParamSwitch.test.tsx src/components/ParamSwitch.dom.test.tsx src/demos/midi/MidiEffectCard.tsx src/demos/midi/MidiEffectCard.dom.test.tsx
git commit -m "MIDI effects card: a ParamSwitch for boolean parameters; the parameter Set ignores is dimmed"
```

---

### Task 4: Copy sweep: five devices everywhere four were named

**Files:**
- Modify: `src/demos/midi/midi-effects-demo.tsx:211-214` ("one of the four stock MIDI effects" → five; "For the fifth device, the scriptable one" → sixth)
- Modify: `src/demos/midi/midi-effects-overview.tsx:33` (name Note Filter in the list)
- Modify: `src/index.tsx:169`; `README.md:22`; `midi-effects-demo.html` `<title>`, `meta name="title"`, `meta name="description"` (and the `og:` / `twitter:` title and description lines if present); `documentation/16-midi.md:306` ("the five built-in effects"); `src/demos/midi/CLAUDE.md` wherever `devices.ts` / the cards are described (grep `devices.ts`, `DEVICE_IDS`, `four`), adding one line: Note Filter's card, the `control` / `dimWhen` fields, and that the Rendered page predicts it through `noteFilterRule`.
- Test: none new; `grep -rn "four stock\|the four stock\|fifth device" src README.md documentation midi-effects-demo.html` returns nothing afterwards.

- [ ] **Step 1: Make the edits** (each list keeps the SDK's order: Arpeggio, Note Filter, Pitch, Velocity, Zeitgeist).

- [ ] **Step 2: Verify**

Run: `grep -rn "four stock\|the four stock\|fifth device\|four built-in" src README.md documentation midi-effects-demo.html midi-effects-rendered-demo.html; npm run typecheck && npx vitest run`
Expected: the grep prints nothing; typecheck 0; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A src README.md documentation midi-effects-demo.html
git commit -m "docs: five stock MIDI effects named wherever four were"
```

---

### Task 5: Browser verification, then the PR

**Files:** none (a note in the PR body).

- [ ] **Step 1: Fresh load of `https://localhost:5173/midi-effects-demo.html`** (the dev server is running; `rm -rf node_modules/.vite` is NOT needed, the SDK did not change). Chrome through the Playwright MCP. A REAL click on Play. Pattern Melody, tab Note Filter, Min to E3 (the slider's name for 64): the emitted lane shows no bars on keys 60 and 62, the other six pitches sound. Pattern Bass, Set on: every root bar lands on key 60 (the Key, printed C3). Screenshot each.

- [ ] **Step 2: Fresh load of `midi-effects-rendered-demo.html`**, the same two settings: the rendered lane agrees (dropped notes are written ghosts with no rendered bar; the set notes sit on key 60), the page's status is not `error` (no red callout, rows not dimmed). Then Melody with Semitones at +60 st: key 71's bar is a ghost only; keys 60, 62, 64 and 67 read on 120, 122, 124 and 127, above the lane's top (the lane's "N out of range" count says 4, the rows stay without error).

- [ ] **Step 3: Undo check**: pull `project` from the React fiber (CLAUDE.md recipe), `project.editing.undo()` after the Set click; the switch reads Off and Key dims again.

- [ ] **Step 4: Open the PR** with `superpowers:finishing-a-development-branch`: push `feat/note-filter-demo`, body = what changed (device, switch + dimming, the rule layer and why it is in this PR, the copy sweep), the verification read (Step 1–3 outcomes with the figures), "second PR: the audit rows". End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then `/pr-review-toolkit:review-pr` and fix Critical + Important findings before handing the user the merge line.

- [ ] **Step 5: Delete this plan and the spec in the PR** (`docs/superpowers/{specs,plans}` hold in-flight work only); the durable facts went into `src/demos/midi/CLAUDE.md` in Task 4.
