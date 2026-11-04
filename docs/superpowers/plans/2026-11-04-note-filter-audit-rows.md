# Note Filter Audit Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Note Filter into both standing MIDI effect audits: a 28-row `note-filter` group plus order and disabled rows in the semantics audit, and a pass-through row with its disabled twin in the placement audit, both run at both rates and the semantics registers re-accepted after the user's read.

**Architecture:** The rule (`noteFilterRule`), the setting type and the box read/write already exist on main; this plan adds ROWS that the rule predicts, extends the URL filters and the row-count tests, wires the placement page's factory and identity write, runs both pages, and records the runs. No change to the rule, reader, verdict, artifacts or table scripts.

**Tech Stack:** TypeScript (strict), Vitest in Node against the real box graph, the Vite dev server on 5173 (HTTPS), Chrome driven through the Playwright MCP (a real click), the two table scripts under `scripts/audit/`.

**Spec:** `docs/superpowers/specs/2026-11-04-note-filter-audit-rows-design.md`

## Global Constraints

- SDK pin `@opendaw/studio-sdk@0.0.181`; nothing in `package.json` changes.
- `npm run typecheck` exits 0 before every commit; `npx vitest run` is clean (the repo prints nothing on a clean run).
- Row ids are stable strings, a number printed as JavaScript prints it (`nf-tr-12-melody` is transpose −12). Labels end in ` — <pattern label>` (lower-case label from `patternLabel`).
- `NOTE_FILTER_BASE` = `{ min: 0, max: 127, set: false, transpose: 0, key: 60 }` is the identity; every row spreads it and changes only what its table line says.
- The non-identity setting for order and disabled rows is the window `{ ...NOTE_FILTER_BASE, min: 62, max: 67 }`.
- Every row's notes must pass the existing fit test (`duration_s × 2^((pitch − 69)/12) ≤ 4`).
- Edits under `src/` reload the dev server page: finish every code task before Task 4's runs; the run tasks edit only `.md` files.
- Register `--accept` only after the user has read both tables (Task 5 starts with that read).
- Commit after every task; the branch is `feat/note-filter-audit-rows` off `main`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- `?device=note-filter&rows=quick` must give the dry rows plus the quick Note Filter rows only (the order rows carry a Note Filter but belong to group `order`): pinned in Task 1's `resolveRows` test.
- A row predicted EMPTY (min above max, the two silent transposes) must reach the verdict as a judged row, not `no rule`: pinned in Task 1 by asserting `predictedVariants` gives one variant with `notes: []` (the verdict's empty-prediction path is already tested in `midiEffectSemanticsVerdict.test.ts` for `pitch-oct7-chromatic`'s shape).
- The set row at key 60 on the sixteenths is the identity in effect: its prediction must equal `dry-sixteenths`'s notes so the register holds it as a control: pinned in Task 1.
- A non-identity that is an identity on its pattern silently weakens the order and disabled rows (the #203 review point): the guard test in Task 2 applies each stage's rule to the row's own pattern.
- The placement page's `applySettings` switch has no `default`, so a device added to `MIDI_EFFECT_DEVICES` without a case compiles and writes nothing: Task 3 pins the identity write by asserting on the scenario and adds the case; `npm run typecheck` is the compiler-side guard (`noImplicitReturns` does not fire on a void switch, so the test is the guard).

---

### Task 1: The `note-filter` semantics row group

**Files:**
- Modify: `src/lib/audit/midiEffectSemanticsRows.ts` (`RowGroup`, `QUICK_IDS`, a new `noteFilterRows()`, `SEMANTICS_ROWS`, `DEVICE_FILTERS`, the header comment's sampling paragraph)
- Modify: `src/lib/audit/midiEffectSemanticsRows.test.ts` (`GROUPS`, the counts, new row tests)
- Modify: `src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx:3` (the `?device=` list in the header comment)
- Modify: `src/demos/midi/CLAUDE.md` (the semantics section's URL line, "renders 230 rows", "41-row subset"; the Cards bullet's clause "the audit has no Note Filter ROWS yet")
- Modify: `CLAUDE.md` (the semantics sweep bullet: "about 35 seconds per rate (230 rows)")
- Modify: `debug/2026-11-03-midi-effect-semantics/note.md` (Rule sources table: a Note Filter line; Row sampling: "230 rows" and a Note Filter bullet; the harness line's `?device=` list)

**Interfaces:**
- Consumes: `noteFilterRule`, `NoteFilterSettings` (`midiEffectSemanticsRules.ts`); `NOTE_FILTER_BASE`, `noteFilter()`, `one()`, `patternLabel()`, `signed()` (`midiEffectSemanticsRows.ts`).
- Produces: `RowGroup` gains `"note-filter"`; `function noteFilterRows(): RowDraft[]` placed in `SEMANTICS_ROWS` after `zeitgeistRows()` and before `orderRows()`; `DEVICE_FILTERS` gains `"note-filter"` after `"zeitgeist"`; the row ids below.

The 28 rows, in table order (pattern label in the label as the other groups do):

| id | settings (from base) | label |
|---|---|---|
| `nf-range0-127-melody` | — | `Note Filter 0..127 — melody` |
| `nf-range62-67-melody` | min 62, max 67 | `Note Filter 62..67 — melody` |
| `nf-range65-127-melody` | min 65 | `Note Filter 65..127 — melody` |
| `nf-range0-64-melody` | max 64 | `Note Filter 0..64 — melody` |
| `nf-range64-64-melody` | min 64, max 64 | `Note Filter 64..64 — melody` |
| `nf-range67-62-melody` | min 67, max 62 | `Note Filter 67..62 — melody` |
| `nf-range60-127-chromatic` | min 60 | `Note Filter 60..127 — chromatic` |
| `nf-range61-127-chromatic` | min 61 | `Note Filter 61..127 — chromatic` |
| `nf-range0-71-chromatic` | max 71 | `Note Filter 0..71 — chromatic` |
| `nf-range0-70-chromatic` | max 70 | `Note Filter 0..70 — chromatic` |
| `nf-tr<n>-melody` for n in −12, −7, −1, 0, 1, 7, 12, 24 | transpose n | `Note Filter <signed n> st — melody` |
| `nf-tr68-chromatic`, `nf-tr-72-chromatic` | transpose 68 / −72 | `Note Filter +68 st — chromatic` / `Note Filter -72 st — chromatic` |
| `nf-set-key<k>-<p>` for k in 48, 60, 72 and p in melody, sixteenths | set true, key k | `Note Filter set to <k> — <p>` |
| `nf-set-key72-range62-67-melody` | min 62, max 67, set true, key 72 | `Note Filter 62..67, set to 72 — melody` |
| `nf-set-key72-tr7-melody` | set true, key 72, transpose 7 | `Note Filter set to 72, +7 st — melody` |

Quick ids to add: `nf-range62-67-melody`, `nf-range61-127-chromatic`, `nf-tr7-melody`, `nf-set-key72-melody`.

- [ ] **Step 1: Write the failing tests** in `midiEffectSemanticsRows.test.ts`

Change `GROUPS` to `["dry", "arpeggio", "pitch", "velocity", "zeitgeist", "note-filter", "order", "disabled"]`, the per-group counts to `[4, 88, 40, 38, 50, 28, 6, 4]`, the totals to 234 / 45 (Task 2 raises them to 263 / 50; the test names state the figures). Add a `describe("the Note Filter rows")`:

```ts
const pitchesOf = (id: string) => predictedVariants(rowById(id), context).map((v) => v.notes.map((n) => n.pitch));
it("the melody window keeps 64, 67, 67, 64, 62 per bar and drops 60, 69, 71", () => {
  expect(pitchesOf("nf-range62-67-melody")).toEqual([[64, 67, 67, 64, 62, 64, 67, 67, 64, 62]]);
});
it("the floor, the ceiling and the one-key window keep what the spec says", () => {
  expect(pitchesOf("nf-range65-127-melody")[0]).toEqual([67, 69, 67, 71, 67, 69, 67, 71]);
  expect(pitchesOf("nf-range0-64-melody")[0]).toEqual([60, 64, 64, 62, 60, 64, 64, 62]);
  expect(pitchesOf("nf-range64-64-melody")[0]).toEqual([64, 64, 64, 64]);
});
it("min above max and a transpose past either end predict silence, as one judged variant with no notes", () => {
  for (const id of ["nf-range67-62-melody", "nf-tr68-chromatic", "nf-tr-72-chromatic"]) {
    expect(predictedVariants(rowById(id), context), id).toEqual([{ deviations: new Set(), notes: [] }]);
  }
});
it("the inclusive ends on the chromatic run drop exactly one note one step past each end", () => {
  expect(pitchesOf("nf-range60-127-chromatic")[0].length).toBe(12);
  expect(pitchesOf("nf-range61-127-chromatic")[0]).toEqual([61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]);
  expect(pitchesOf("nf-range0-71-chromatic")[0].length).toBe(12);
  expect(pitchesOf("nf-range0-70-chromatic")[0]).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
});
it("set collapses every passing note to the key, after the range and ignoring the transpose", () => {
  expect(pitchesOf("nf-set-key72-melody")[0]).toEqual(Array(16).fill(72));
  expect(pitchesOf("nf-set-key72-range62-67-melody")[0]).toEqual(Array(10).fill(72));
  expect(pitchesOf("nf-set-key72-tr7-melody")[0]).toEqual(Array(16).fill(72));
  expect(pitchesOf("nf-set-key60-sixteenths")).toEqual([rowNotes(rowById("dry-sixteenths")).map((n) => n.pitch)]);
});
it("the transpose rows move the melody by the setting", () => {
  expect(pitchesOf("nf-tr-12-melody")[0].slice(0, 8)).toEqual([48, 52, 55, 57, 55, 52, 50, 59]);
  expect(pitchesOf("nf-tr24-melody")[0].slice(0, 8)).toEqual([84, 88, 91, 93, 91, 88, 86, 95]);
  expect(SEMANTICS_ROWS.filter((r) => r.id.startsWith("nf-tr") && r.id.endsWith("-melody")).map((r) => r.id))
    .toEqual([-12, -7, -1, 0, 1, 7, 12, 24].map((n) => `nf-tr${n}-melody`));
});
it("labels and placement in the table", () => {
  expect(rowById("nf-range62-67-melody").label).toBe("Note Filter 62..67 — melody");
  expect(rowById("nf-tr-7-melody").label).toBe("Note Filter -7 st — melody");
  expect(rowById("nf-set-key72-range62-67-melody").label).toBe("Note Filter 62..67, set to 72 — melody");
  expect(rowById("nf-set-key72-tr7-melody").label).toBe("Note Filter set to 72, +7 st — melody");
  const groups = SEMANTICS_ROWS.map((r) => r.group);
  expect(groups.lastIndexOf("zeitgeist")).toBeLessThan(groups.indexOf("note-filter"));
  expect(groups.lastIndexOf("note-filter")).toBeLessThan(groups.indexOf("order"));
  expect(SEMANTICS_ROWS.filter((r) => r.group === "note-filter").every((r) => r.chain.length === 1 && r.chain[0].setting.device === "note-filter" && r.chain[0].enabled)).toBe(true);
});
```

In the `resolveRows` test add:

```ts
const nf = resolveRows({ ...none, device: "note-filter" });
expect(nf.length).toBe(4 + 28);
expect(nf.slice(4).every((r) => r.group === "note-filter")).toBe(true);
expect(resolveRows({ ...none, device: "note-filter", rows: "quick" }).slice(4).map((r) => r.id))
  .toEqual(["nf-range62-67-melody", "nf-range61-127-chromatic", "nf-tr7-melody", "nf-set-key72-melody"]);
```

- [ ] **Step 2: Run the file to see it fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRows.test.ts`
Expected: FAIL (`no row nf-range62-67-melody`, the counts, the `unknown device "note-filter"` throw).

- [ ] **Step 3: Implement `noteFilterRows()` and the group**

In `midiEffectSemanticsRows.ts`: add `"note-filter"` to `RowGroup` (between `zeitgeist` and `order`) and to `DEVICE_FILTERS`; add the four quick ids to `QUICK_IDS`; write `function noteFilterRows(): RowDraft[]` with a local `add(id, label, pattern, settings: NoteFilterSettings)` building `{ id, label: \`Note Filter ${label} — ${patternLabel(pattern)}\`, group: "note-filter", pattern, chain: [one(noteFilter(settings))] }`, in the table's order (the range rows as a list of `[min, max, pattern]` tuples, the transposes a loop, the set rows a nested loop, then the two combined rows); splice it into `SEMANTICS_ROWS` between `zeitgeistRows()` and `orderRows()`. Add one sentence to the header comment's sampling paragraph: the Note Filter's range is sampled as windows on the melody and inclusive ends on the chromatic run, its transposes on the melody with two all-dropped rows, its set on both patterns.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRows.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 5: State the new counts and the device list in the docs**

`midi-effect-semantics-audit-debug-demo.tsx:3`: `&device=all|arpeggio|pitch|velocity|zeitgeist|note-filter|order|disabled`. `src/demos/midi/CLAUDE.md`: the same URL in the semantics section (the row counts wait for Task 2), and in the Cards bullet replace "; the audit has no Note Filter ROWS yet" with "; the audit's `note-filter` group samples it (range windows on the melody, inclusive ends on the chromatic run, transposes, set)". The semantics note: the harness line's `?device=` list; the Rule sources table gains the line:

`| Note Filter | Only a note between min and max, both included, passes (`note-filter.md` §1: "If Min is above Max, no note passes"); it then moves by the transpose semitones, or plays as the key when set is on (§2); a result outside 0..127 is ignored (§2). The 64 held-note cap (`MAX_HELD`) is not modelled; no pattern reaches it. | `device-note-filter/src/lib.rs:45-49` (`output_pitch`), `:105-118` (`transform`) | `NoteFilterDeviceBoxAdapter` (key and min/max 0..127, transpose −127..127) |`

and the Row sampling section gains a bullet: "**Note Filter**: range windows on the melody (0..127, 62..67, 65..127, 0..64, 64..64, 67..62) and inclusive ends on the chromatic run (min 60 and 61, max 71 and 70); transpose −12, −7, −1, 0, +1, +7, +12, +24 on the melody and +68 / −72 on the chromatic run (every note dropped, judged on silence); set on with key 48, 60, 72 on the melody and the sixteenths, plus set under a window and set over a transpose on the melody."

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsRows.ts src/lib/audit/midiEffectSemanticsRows.test.ts src/demos/midi/midi-effect-semantics-audit-debug-demo.tsx src/demos/midi/CLAUDE.md CLAUDE.md debug/2026-11-03-midi-effect-semantics/note.md
git commit -m "audit(semantics): a note-filter row group — range windows on the melody, inclusive ends, transposes, set"
```

---

### Task 2: Order and disabled rows, the window as the non-identity, the guard test

**Files:**
- Modify: `src/lib/audit/midiEffectSemanticsRows.ts` (`NON_IDENTITY["note-filter"]`, `ORDERS`, `disabledRows()`)
- Modify: `src/lib/audit/midiEffectSemanticsRows.test.ts`
- Modify: `debug/2026-11-03-midi-effect-semantics/note.md` (Row sampling's Order and disabled bullet)

**Interfaces:**
- Consumes: `composeRules`, `noteFilterRule`, `pitchRule`, `arpeggioRule` (`midiEffectSemanticsRules.ts`); `rowNotes`, `SEMANTICS_ROWS`.
- Produces: row ids `order-pitch-note-filter`, `order-note-filter-pitch`, `order-arpeggio-note-filter`, `order-note-filter-arpeggio`, `disabled-note-filter`; counts 263 total, 50 quick, order 10, disabled 5.

- [ ] **Step 1: Write the failing tests**

Raise the counts: per group `[4, 88, 40, 38, 50, 28, 10, 5]`, total 263, quick 50 (rename the two test titles to the figures). Add:

```ts
// add `composeRules` to the import from "./midiEffectSemanticsRules"
it("the order rows pair the Note Filter with Pitch and Arpeggio both ways, on the chords; the disabled row is on the sixteenths", () => {
  expect(SEMANTICS_ROWS.filter((r) => r.group === "order").map((r) => r.id)).toEqual([
    "order-arpeggio-zeitgeist", "order-zeitgeist-arpeggio", "order-pitch-arpeggio", "order-arpeggio-pitch", "order-velocity-arpeggio", "order-arpeggio-velocity",
    "order-pitch-note-filter", "order-note-filter-pitch", "order-arpeggio-note-filter", "order-note-filter-arpeggio",
  ]);
  expect(rowById("order-note-filter-pitch").chain.map((c) => c.setting.device)).toEqual(["note-filter", "pitch"]);
  expect(SEMANTICS_ROWS.filter((r) => r.group === "order").map((r) => r.pattern)).toEqual([...Array(6).fill("chords"), "melody", "melody", "chords", "chords"]);
  expect(rowById("order-pitch-note-filter").label).toBe("Pitch then NoteFilter — melody");
  expect(rowById("order-arpeggio-zeitgeist").label).toBe("Arpeggio then Zeitgeist — chords");
  expect(rowById("disabled-note-filter")).toMatchObject({ group: "disabled", pattern: "sixteenths", chain: [{ enabled: false, setting: { device: "note-filter", settings: { min: 62, max: 67, set: false, transpose: 0, key: 60 } } }] });
});
it("the Pitch pairs on the melody judge every surviving note and differ by order: Pitch first keeps 2 notes, the filter first keeps 10", () => {
  const pitchFirst = predictedVariants(rowById("order-pitch-note-filter"), context)[0].notes;
  expect(pitchFirst.map((n) => [n.pitch, n.cent])).toEqual([[67, 12.5], [67, 12.5]]);
  const filterFirst = predictedVariants(rowById("order-note-filter-pitch"), context)[0].notes;
  expect(filterFirst.map((n) => n.pitch)).toEqual([71, 74, 74, 71, 69, 71, 74, 74, 71, 69]);
  expect(filterFirst.every((n) => n.cent === 12.5)).toBe(true);
});
it("every order and disabled row's Note Filter and Pitch stage changes the row's own pattern (a non-identity that is an identity there proves nothing)", () => {
  // Velocity and Zeitgeist are context-bound (the test context's computeVelocity and warp are identities). The Arpeggio's
  // non-identity (Up, 1 octave, 1/16, gate 0.5, velocity 1) reproduces the sixteenths exactly, so `disabled-arpeggio`
  // is excluded here and noted as an open item; changing it would move registered order rows.
  for (const row of SEMANTICS_ROWS.filter((r) => r.group === "order" || r.group === "disabled")) {
    const source = rowNotes(row);
    for (const stage of row.chain) {
      if (stage.setting.device !== "note-filter" && stage.setting.device !== "pitch") continue;
      expect(composeRules([stage.setting], context, new Set(), source), `${row.id} ${stage.setting.device}`).not.toEqual(source);
    }
  }
});
it("filter then Arpeggio empties the second half bar of the chords; Arpeggio then filter walks the full triads first", () => {
  const filterFirst = predictedVariants(rowById("order-note-filter-arpeggio"), context)[0].notes;
  expect(filterFirst.some((n) => n.position >= 3840 + 960 && n.position < 3840 + 1920)).toBe(false);
  const arpFirst = predictedVariants(rowById("order-arpeggio-note-filter"), context)[0].notes;
  expect(arpFirst.every((n) => n.pitch >= 62 && n.pitch <= 67)).toBe(true);
  expect(arpFirst.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/audit/midiEffectSemanticsRows.test.ts`
Expected: FAIL on the order ids, the counts and the `min: 60` non-identity.

- [ ] **Step 3: Implement**

`NON_IDENTITY["note-filter"]` becomes `noteFilter({ ...NOTE_FILTER_BASE, min: 62, max: 67 })`. `ORDERS` becomes `readonly (readonly [SemanticsDevice, SemanticsDevice, SemanticsPatternId])[]`: the six existing pairs with `"chords"`, then `["pitch", "note-filter", "melody"]`, `["note-filter", "pitch", "melody"]`, `["arpeggio", "note-filter", "chords"]`, `["note-filter", "arpeggio", "chords"]`; `orderRows()` takes `pattern` from the tuple and labels `… — ${patternLabel(pattern)}` (ids unchanged: `order-${first}-${second}`). `disabledRows()` iterates `["arpeggio", "pitch", "velocity", "zeitgeist", "note-filter"]`. (The order label prints `NoteFilter then Pitch` through `FACTORY_KEYS`; keep it.) The header comment's "Orderings … on the chords" sentence, if it names the pattern, says the Pitch-and-filter pairs sit on the melody because the one-voice reader cannot judge a held triad.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/lib/audit && npm run typecheck`
Expected: PASS, exit 0 (the whole audit folder, so nothing else pinned 230).

- [ ] **Step 5: State the final counts and note the rows**

`src/demos/midi/CLAUDE.md`: "renders 263 rows", "a 50-row subset". Root `CLAUDE.md`: "(263 rows)". The semantics note: Row sampling's lead "263 rows"; its "Order … and disabled" bullet gains "Pitch and Note Filter both ways on the melody (the one-voice reader cannot judge a held triad; the chords pairs all hold an Arpeggio), Arpeggio and Note Filter both ways on the chords" and "the Note Filter's non-identity is the 62..67 window (min 60 drops nothing on the sixteenths or the melody)"; Open items gains: "`disabled-arpeggio` proves nothing: the Arpeggio's non-identity (Up, 1 octave, 1/16, gate 0.5, velocity 1) reproduces the sixteenths exactly, so the row reads dry whether or not the device is skipped. A different non-identity would move the registered order rows; left for a release that changes them anyway."

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit/midiEffectSemanticsRows.ts src/lib/audit/midiEffectSemanticsRows.test.ts debug/2026-11-03-midi-effect-semantics/note.md
git commit -m "audit(semantics): Note Filter order and disabled rows; the 62..67 window as its non-identity, guarded"
```

---

### Task 3: The placement audit's Note Filter rows

**Files:**
- Modify: `src/lib/audit/midiEffectScenarios.ts` (`MIDI_EFFECT_DEVICES`, `MIDI_EFFECT_ROW_IDS`, `MIDI_EFFECT_SCENARIOS`)
- Modify: `src/lib/audit/midiEffectScenarios.test.ts`
- Modify: `src/demos/midi/midi-effect-placement-audit-debug-demo.tsx` (header line 3, the `NoteFilterDeviceBox` type import, `FACTORIES`, `applySettings`)
- Modify: `src/demos/midi/CLAUDE.md` (the placement section's URL line), `debug/2026-10-21-midi-effect-placement/note.md:17` (the harness line)

**Interfaces:**
- Consumes: `passThrough(...)` in `midiEffectScenarios.ts`; `EffectFactories.NoteFilter`; `NoteFilterDeviceBox` from `@opendaw/studio-boxes`.
- Produces: `MidiEffectDevice` includes `"note-filter"`; row ids `"note-filter"`, `"note-filter-disabled"`; `resolveDevices("note-filter")` → `["dry", "note-filter", "note-filter-disabled"]`.

- [ ] **Step 1: Write the failing tests**

In `midiEffectScenarios.test.ts`: `resolveDevices(null).length` → 15; add

```ts
expect(resolveDevices("note-filter").map((s) => s.id)).toEqual(["dry", "note-filter", "note-filter-disabled"]);
expect(byId("note-filter")).toMatchObject({ device: "note-filter", enabled: true, judge: "pass-through", rule: null, script: null, pattern: DRY_PATTERN });
expect(byId("note-filter-disabled")).toMatchObject({ device: "note-filter", enabled: false, judge: "pass-through" });
expect(MIDI_EFFECT_SCENARIOS.map((s) => s.id).indexOf("note-filter")).toBe(MIDI_EFFECT_SCENARIOS.map((s) => s.id).indexOf("velocity") + 1);
expect(MIDI_EFFECT_SCENARIOS.map((s) => s.id).indexOf("note-filter-disabled")).toBe(MIDI_EFFECT_SCENARIOS.map((s) => s.id).indexOf("velocity-disabled") + 1);
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/audit/midiEffectScenarios.test.ts`
Expected: FAIL (13 rows, `unknown ?device=`).

- [ ] **Step 3: Implement the rows and the page wiring**

`midiEffectScenarios.ts`: `MIDI_EFFECT_DEVICES = ["pitch", "velocity", "note-filter", "arpeggio", "zeitgeist", "spielwerk"]`; the two ids in `MIDI_EFFECT_ROW_IDS` after `"velocity"` and after `"velocity-disabled"`; `passThrough("note-filter", "Note Filter (C-2..G8, 0 st, Set off)", "note-filter", true)` after the Velocity row and `passThrough("note-filter-disabled", "Note Filter, disabled", "note-filter", false)` after `velocity-disabled`. The page: import the `NoteFilterDeviceBox` type, `FACTORIES["note-filter"] = EffectFactories.NoteFilter` after `velocity`, and a `case "note-filter"` in `applySettings` writing `min 0, max 127, set false, transpose 0, key 60` on `box as NoteFilterDeviceBox`; the header's `&device=` list gains `note-filter` after `velocity`. The midi CLAUDE.md placement URL line and the placement note's harness line get the same list.

- [ ] **Step 4: Run the tests, the typecheck and the build**

Run: `npx vitest run src/lib/audit && npm run typecheck && npm run build`
Expected: PASS, exit 0, the build clean (the page is a Vite entry; the build compiles it).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/midiEffectScenarios.ts src/lib/audit/midiEffectScenarios.test.ts src/demos/midi/midi-effect-placement-audit-debug-demo.tsx src/demos/midi/CLAUDE.md debug/2026-10-21-midi-effect-placement/note.md
git commit -m "audit(placement): a Note Filter pass-through row and its disabled twin"
```

---

### Task 4: Run both audits at both rates, record the runs, stop for the user's read

Edits in this task touch `.md` files only (a save under `src/` would reload a run).

**Files:**
- Modify: `debug/2026-11-03-midi-effect-semantics/note.md` (a new Runs block), `debug/2026-10-21-midi-effect-placement/note.md` (a new Runs block)

- [ ] **Step 1: Confirm the dev server and the SDK**

Run: `curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:5173/midi-effect-semantics-audit-debug-demo.html && node -e "console.log(require('./node_modules/@opendaw/studio-sdk/package.json').version)"`
Expected: `200` and `0.0.181`. If the page 504s on a dependency, `touch vite.config.ts` and retry (the harness refuses to kill the server).

- [ ] **Step 2: Semantics at 48 kHz**

Open `https://localhost:5173/midi-effect-semantics-audit-debug-demo.html` in the Playwright MCP's Chrome, a REAL click on "Run audit", poll `#audit-state[data-audit-state]` in calls under 100 s until `done`; read `data-error-rows` (expect `0`). Run: `node scripts/audit/midi-effect-semantics/table.ts` (newest summary). Expected: 263 rows; every `nf-*` row, the four new `order-*` rows and `disabled-note-filter` read `rule holds, unregistered`; every other row as the 0.0.181 run (211 `as-registered`, 1 `as-registered, matches-known-deviation arpeggio-drops-cent`, 18 `no rule`); the run line's rows 263. Note the run token.

- [ ] **Step 3: Semantics at 44.1 kHz**

The same with `?rate=44100`. Expected: the same verdicts. Note the token.

- [ ] **Step 4: If a new row is not `rule holds`**

Read the row's first mismatch and the envelope's predicted and read notes (`.verify-output/midisem-summary-<token>.json`), then the reader, then the row, then the crate, in that order; a harness fault is fixed with a test and the rate re-run; an engine finding is recorded in the note's Known deviations or Questions and left unaccepted. Do not `--accept`.

- [ ] **Step 5: Placement at both rates**

`https://localhost:5173/midi-effect-placement-audit-debug-demo.html?device=all`, a real click, `#audit-state` to `done`, then `?rate=44100`. Run: `node scripts/audit/midi-effect-placement/table.ts` after each. Expected: 15 rows, every row `as-predicted`, `note-filter` and `note-filter-disabled` at lag 0 and score ≥ 0.9, their channel peak equal to the dry row's.

- [ ] **Step 6: Record the runs**

Semantics note, under Runs, a block `### 2026-11-04, the Note Filter rows (SDK 0.0.181, Chrome, macOS, the Mac's output device at 44.1 kHz)` with a table like the 0.0.181 block's (rate, run token, `as-registered`, deviation, `no rule`, `<rule>, unregistered`, `changed`, `error`) and one sentence per surprise. Placement note, under Runs, `### 2026-11-04, the Note Filter rows (SDK 0.0.181, Chrome, macOS)` with the two tokens, "15 rows, every row `as-predicted`", the two Note Filter rows' lag, score and peak.

- [ ] **Step 7: Commit and stop**

```bash
git add debug/2026-11-03-midi-effect-semantics/note.md debug/2026-10-21-midi-effect-placement/note.md
git commit -m "audit: Note Filter rows measured on 0.0.181 at both rates, registers not yet accepted"
```

Then hand the two semantics tables (the run tokens and the `table.ts` output) to the user for their read. Task 5 waits on it.

---

### Task 5: Accept the registers, finish the docs, open the PR

Starts only after the user has read both tables.

**Files:**
- Modify: `debug/2026-11-03-midi-effect-semantics/register/48000.json`, `register/44100.json` (written by the script)
- Modify: `debug/2026-11-03-midi-effect-semantics/note.md` (Status counts), `debug/README.md` (the semantics row: device list, row count, counts; the placement row's row count if stated)
- Delete: `docs/superpowers/specs/2026-11-04-note-filter-audit-rows-design.md`, `docs/superpowers/plans/2026-11-04-note-filter-audit-rows.md`

- [ ] **Step 1: Accept**

Run: `node scripts/audit/midi-effect-semantics/table.ts <token48> --accept && node scripts/audit/midi-effect-semantics/table.ts <token441> --accept`
Expected: each prints the register path it wrote; `git diff --stat` shows the two register files; `git diff debug/2026-11-03-midi-effect-semantics/register/48000.json | grep -c '^+.*"id": "nf-'` is 28.

- [ ] **Step 2: Prove the register reproduces**

Re-run the semantics page once at 48 kHz (a real click) and `table.ts`. Expected: 0 `unregistered`, 0 `changed`; if every new row held, 244 `as-registered` (211 + the 33 new rows), 1 deviation, 18 `no rule`; otherwise the figures as measured in Task 4. Write the exact figures into the Status paragraph ("on the rule as it stands they read … per rate") and the `debug/README.md` semantics row (device list "Arpeggio, Pitch, Velocity, Zeitgeist, Note Filter", "263 rows", the counts, "re-accepted 2026-11-04 with the Note Filter rows"); the `src/demos/midi/CLAUDE.md` and root `CLAUDE.md` figures from Task 1 are confirmed or corrected.

- [ ] **Step 3: Delete the spec and the plan, run everything once more**

Run: `git rm docs/superpowers/specs/2026-11-04-note-filter-audit-rows-design.md docs/superpowers/plans/2026-11-04-note-filter-audit-rows.md && npm run typecheck && npx vitest run`
Expected: exit 0, no test output.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add -A debug/2026-11-03-midi-effect-semantics debug/README.md src/demos/midi/CLAUDE.md CLAUDE.md
git commit -m "audit: Note Filter rows accepted into the semantics registers at both rates; docs"
git push -u origin feat/note-filter-audit-rows
gh pr create --title "MIDI effect audits: Note Filter rows (semantics group, order and disabled rows, placement pass-through), registers re-accepted on 0.0.181" --body-file <(printf '...')
```

The body: what was added (counts), the two runs per audit with tokens and verdict counts, the register re-accept, the docs touched, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then run `/pr-review-toolkit:review-pr` and fix Critical and Important findings on the branch; hand the user the one-line merge command (`gh pr merge <n> --squash`).
