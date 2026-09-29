# Follow-ups from the Nano demo (PR #131)

Work found during the Nano demo and its review, and left for a follow-up PR. Each item
says what a person gets today, where the code is, and how to tell it is fixed. Delete
this file in the PR that completes the list.

Not on this list: stored samples piling up in OPFS. That is fixed in PR #132.

## 1. Compile the repo with `strict`

**Today.** `tsconfig.json` sets `noUnusedLocals`, `noUnusedParameters` and
`noImplicitReturns`, and not `strict`. So `| null` in a type is documentation only:
`const s: string = null` compiles, and so does reading a property of a `Map.get()` result.

**Size, measured on `feat/nano-demo`.** `npx tsc --noEmit --strict` reports 12 errors in
5 files under `src/`.

| File | Errors | Cause |
|---|---|---|
| `src/demos/recording/recording-alignment-audit-debug-demo.tsx` | 6 | Four reads of `.address` on a variable assigned inside an `editing.modify()` callback (the compiler narrows it to `never` after the callback); two reads of `medianBeatErrorMsAdjusted`, which may be undefined |
| `src/demos/recording/input-latency-calibration-debug-demo.tsx` | 2 | One of each of the same two |
| `src/lib/audit/loopbackInjection.ts` | 2 | A call with four arguments where two or three are declared; a `GainNode` passed where an `AudioParam` is declared |
| `src/lib/compLaneUtils.ts` | 1 | `AudioFileBox \| null` passed where a box is required |
| `src/demos/automation/track-automation-demo.tsx` | 1 | `.wet` read on a variable narrowed to `never`, same cause as the first row |

The two in `loopbackInjection.ts` look like real defects, not typing gaps. Read them
first.

For the "assigned inside a callback" errors the repo already has two accepted shapes:
return the value from `editing.modify()` and `.unwrap()` it, or cast after the callback
with a comment (see `nanoContent.ts`).

**Flags beyond `strict`, measured on top of it:**

| Flag | Errors | Files | Suggestion |
|---|---|---|---|
| `noFallthroughCasesInSwitch` | 0 more | — | Turn on with `strict`, it is free |
| `noImplicitOverride` | 0 more | — | Turn on with `strict`, it is free |
| `exactOptionalPropertyTypes` | 16 more | 12 | Decide separately |
| `noPropertyAccessFromIndexSignature` | 61 more | 10 | Decide separately |
| `noUncheckedIndexedAccess` | 737 more | 98 | Its own project. It is the flag that would have caught an id without a preset |

**Also in this item.**
- Add an `npm run typecheck` script (`tsc --noEmit`). `npm run build` does not
  type-check, because Vite skips it, so today nothing in CI does.
- Update the "Build & Verification" notes in `CLAUDE.md`, which describe the current
  flags.

**Done when** `npx tsc --noEmit` reports zero `src/` lines with `strict` in
`tsconfig.json`, and the test suite and build pass.

## 2. The empty-region message ignores the LFO

**Today.** With Start equal to End and the LFO on, the engine plays the modulated
region while the page says "The region is empty, so notes play nothing."

**Where.** `src/demos/instruments/nano/NanoWaveform.tsx` reads the stored Start. The
engine reads the modulated one (`getControlledUnitValue()`).

**Done when** the message is absent whenever a note would sound, checked in the browser
with Start equal to End, the LFO on, and a key held.

## 3. A multi-file drop discards the extra files without a word

**Today.** Dropping three files loads the first and says nothing about the other two.

**Where.** `src/demos/instruments/nano/nano-demo.tsx`, the `DropZone` `onFile` handler
ignores `skippedCount`. `src/demos/analysis/bpm-detect-demo.tsx` reports it and is the
pattern to follow.

## 4. Two wrong messages after a dropped file

**Today.**
- A file that cannot be read at all (it moved or was deleted between the drop and the
  read) is reported as "Could not decode … Drop a wav, mp3 or m4a audio file."
- After a dropped sample's loader fails, the drop zone still reads "Loaded: name"
  beside the red error.

**Where.** `loadDroppedFile` and the drop zone text in `nano-demo.tsx`.

## 5. `UnitParameter` exposes the whole adapter through `any`

**Today.** `UnitParameter` is `AutomatableParameterFieldAdapter<any>`. Its name promises
unit access only, but `parameter.setValue("anything")` compiles.

**Fix.** A structural interface with the five methods the binding uses
(`getUnitValue`, `setUnitValue`, `getControlledUnitValue`, `getPrintValue`,
`catchupAndSubscribe`). The type reviewer confirmed it is assignable from the number,
boolean and `PrimitiveValues` adapters.

**Where.** `src/lib/parameterBinding.ts`.

## 6. Two sample tests are weaker than their names

**Today.**
- "jointly peak-normalized" still passes if each channel is normalized on its own.
- "starts and ends near silence" checks one sample at each end of one channel. The
  kick passes it with no fade at all.

**Fix.** Assert the quieter channel's peak (the pluck's left channel should be 0.8885).
Measure the first and last few milliseconds, on both channels.

**Where.** `src/lib/nanoSamples.test.ts`.

## 7. A decision: add a DOM test environment, or not

**Today.** Three things have no unit test because the repo has no DOM test
environment: the wiring of `useParameterUnit`'s effect, the slider thumb's accessible
name (`useSliderThumbLabel`), and keyboard and pointer interaction on the waveform
markers. All three are covered by browser checks that a person or an agent has to run.

**The choice.** Adding `jsdom` and `@testing-library/react` would cover them in
`npm test`. It costs two dev dependencies and the clean lockfile regeneration the repo
requires after any `package.json` change.

## 8. Smaller items

| Item | Where | Today |
|---|---|---|
| The convolver demo discards the handle `watchSampleLoad` returns | `src/demos/effects/convolverContent.ts`, `reportLoadError` | An error for an impulse that is no longer selected can still be shown. Its old code did the same |
| A wrong comment about loader reuse | `src/demos/effects/convolverContent.ts`, above `galleryUUID` | Says re-selecting reuses a cached loader. Deleting a file box ends its loader |
| `NanoDemoSetup` exposes two boxes the page does not read | `src/demos/instruments/nano/nanoContent.ts` | `audioUnitBox` and `nanoBox` |
| A marker at 100 % overhangs the waveform by 12 px on a narrow screen | `NanoWaveform.tsx`, `.nn-marker` | The page does not scroll; the handle sticks out into the card's padding |
| LFO, loop-switch and slider writes are not wrapped in error handling | `nano-demo.tsx`, `parameterBinding.ts` | No path to a throw is known. One would be an uncaught error with nothing on the page |
| A drag folds into another transaction's undo step if one runs mid-drag | `NanoWaveform.tsx`, `writeMarker` | No effect today: the page has no undo |
| A voice exactly at frame −1.0 reads as the end of the list for one packet | `nanoMarkers.ts`, `positionsToUnits` | Needs a voice running backwards at double speed from an odd frame |

## 9. Not yet checked

| What | Why it matters |
|---|---|
| Safari and Firefox | Every measurement is from Chromium |
| External MIDI hardware | The "Enable MIDI input" button was never used with a device |
| A 48 kHz audio context in the browser | The synthesis tests cover both rates; the browser measurements were at 44.1 kHz |
