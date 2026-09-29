# Nano Sampler Demo — Design

Date: 2026-09-29
Branch: `feat/nano-demo` (on `main`; the instrument folder move landed in PR #130)

## Purpose

A public demo page that shows SDK users how to drive the Nano polyphonic sampler
headlessly: attach a sample, play it from a pattern and a keyboard, shape it with the
region, loop, pitch and envelope parameters, and watch the engine's read heads move over
the waveform. `InstrumentFactories.Nano` is used nowhere in `src/` today.

Success means a visitor can hear and see each of these within a minute of loading the page,
and a developer can copy the code reference into their own project.

## Decisions taken

| Question | Decision |
|---|---|
| Sample source | Synthesized in code at load, plus drag-and-drop of the visitor's own file |
| How notes reach the sampler | A looping note pattern on transport Play, with the on-screen keyboard and MIDI input layered on top |
| Modulation | One switchable LFO on Sample Start |
| Page shape | Waveform editor: one large waveform with draggable markers and live playheads, parameter cards below |
| Folder layout | `src/demos/instruments/nano/`; Neon and Cubed move to their own subfolders in a separate prep PR (#130) |
| `CLAUDE.md` | One file stays at `src/demos/instruments/`, with a section per instrument |

## SDK surface used

All verified against the installed `@opendaw/studio-adapters` and `@opendaw/studio-boxes`
type declarations.

- `project.api.createInstrument(InstrumentFactories.Nano, …)` — the factory's attachment
  type is `AudioFileBox`; when given, the device's `file` pointer refers to it.
- `NanoDeviceBoxAdapter.namedParameter`: `volume` (label "Gain"), `octave` (−3..3),
  `tune` (±1200 ct), `rootKey` (0..127, default 60), `attack` (0.001–5 s exponential),
  `release` (0.001–8 s exponential), `sampleStart` / `sampleEnd` (unipolar), `loop` (bool),
  `loopFade` (0.001–1 s exponential), `loopStart` / `loopEnd` (unipolar).
- `NanoDeviceBoxAdapter.file(): Option<AudioFileBoxAdapter>` — never `?.` or `??` on it.
- `NanoDeviceBoxAdapter.positionsAddress` — the device broadcasts up to 16 read-head
  positions in source frames, terminated by −1, read with
  `project.liveStreamReceiver.subscribeFloats(address, positions => …)`.

Engine behaviour the page must describe accurately (from the device's voice source):

- Start past end plays the region backwards.
- The region is captured when a voice starts. Moving the region markers, or modulating
  Sample Start, affects new notes only.
- Root key, octave and tune are read live and retune held notes.
- Loop points are clamped inside the region; a degenerate loop range falls back to the
  region.
- Switching the loop off mid-note lets the voice run out.

## Page layout

```
[ Header: BackLink, title, GitHubCorner, MoisesLogo ]
[ Sample gallery: Pluck | Riser | Pad | Kick | Drop your own ]
[ Waveform: region shading, loop range + fade zones,           ]
[ four draggable markers, playhead overlay                     ]
[ Transport: Play / Stop ]
[ Pitch ] [ Envelope ] [ Loop ] [ Gain ]
[ LFO on Sample Start: on/off, rate, depth, live scope ]
[ Piano keyboard + MIDI input ]
[ Code reference ]
```

Follows `docs/design/2026-06-11-mastering-console-editorial.md`. Reference implementation
for tokens and type: `src/demos/warp/warp-overview.tsx`.

## Built-in samples

Synthesized once at load at the AudioContext's sample rate. Each exists to show one
feature and ships with a preset.

| Sample | Synthesis | Length | Root key | Preset | Shows |
|---|---|---|---|---|---|
| Pluck | Karplus-Strong string, 220 Hz | 1.5 s | 57 | Loop on, loop range over the decaying tail, fade 0.05 s | Crossfade loop sustaining a sound that otherwise dies away |
| Riser | Sine sweep 200 → 2000 Hz with a noise layer, rising amplitude | 1.0 s | 60 | Loop off, start 1.0, end 0.0 | Reverse playback |
| Pad | Three detuned saws, 130.81 Hz, slow low-pass movement | 2.0 s | 48 | Loop on, inner loop 0.35–0.85, fade 0.2 s | Inner loop points and fade length |
| Kick | Sine with a fast downward pitch sweep and short decay | 0.4 s | 60 | Loop off, attack 0.001 s, release 0.1 s | Root key, octave and tune across the keyboard |

Root keys use the MIDI convention where note 69 is 440 Hz. Labels come from the SDK's
`rootKey` string mapping, not hand-written note names.

A dropped file is decoded with `decodeAudioData`, attached the same way, and gets default
parameters: root key 60, full region, loop off. A decode failure shows a callout and leaves
the current sample in place.

Each preset also carries a short note pattern (one or two bars) that suits the sample: held
notes for Pluck and Pad, a rhythmic figure across two octaves for Kick, spaced single notes
for Riser. A dropped file uses a generic four-note pattern.

## Files

### New

| File | Responsibility | Depends on |
|---|---|---|
| `nano-demo.html` | Entry point, meta tags, OG image, GoatCounter | — |
| `src/demos/instruments/nano/nano-demo.tsx` | Page, gallery, transport, parameter cards, LFO card, code reference | everything below |
| `src/demos/instruments/nano/nanoContent.ts` | Build the instrument, attach and swap samples, build and swap the pattern, create the LFO | SDK, `sampleFiles.ts` |
| `src/demos/instruments/nano/NanoWaveform.tsx` | Static waveform canvas, markers, playhead overlay | `nanoMarkers.ts`, `CanvasPainter` |
| `src/demos/instruments/nano/nanoMarkers.ts` | Pure functions: pixel ↔ unit value, clamping, region direction, fade-zone widths | nothing |
| `src/demos/instruments/nano/nanoMarkers.test.ts` | Unit tests for the above | vitest |
| `src/demos/instruments/nano/nanoPresets.ts` | The four presets: parameters and patterns | nothing |
| `src/lib/nanoSamples.ts` | Pure synthesis, returns `{ sampleRate, channels: Float32Array[] }` | nothing |
| `src/lib/nanoSamples.test.ts` | Unit tests for the above | vitest |
| `src/lib/sampleFiles.ts` | Shared helpers extracted from `convolverContent.ts` | SDK |
| `public/og-image-nano.png` | 1200×630 screenshot | — |

### Changed

| File | Change |
|---|---|
| `src/demos/effects/convolverContent.ts` | Use the shared helpers from `src/lib/sampleFiles.ts` |
| `vite.config.ts` | Add the `nano` build input |
| `src/index.tsx` | Add the demo card |
| `public/sitemap.xml` | Add the URL |
| `README.md` | Demo table row and source-tree entries |
| `src/demos/instruments/CLAUDE.md` | New Nano section |
| `CLAUDE.md` | Add Nano to the instruments entry |

## Shared helper extraction

`convolverContent.ts` holds two private functions that the Nano page needs unchanged in
behaviour:

- `referImpulseFile` → `referSampleFile(project, filePointer, uuid, name, durationSeconds)`.
  Refers the pointer to the `AudioFileBox` for `uuid`, creating it if absent, and deletes
  the previous file box when this pointer was its only reference. Returns the deleted
  uuid string or null so the caller can drop the decoded buffer from the local map.
- `watchIRLoad` → `watchSampleLoad(project, uuid, name, onLoadError)`. Reads the loader
  state first and only then subscribes.

The convolver demo migrates to them in the same PR. Its behaviour must not change; its
decay-envelope verification is re-run after the migration.

## Behaviour

### Project setup

1. `initializeOpenDAW` with a `localAudioBuffers` map holding the four synthesized samples.
2. Transaction 1: create the `AudioFileBox` for the first sample and
   `createInstrument(InstrumentFactories.Nano, …)` with it as the attachment.
3. Transaction 2: apply the preset parameters and create the note region
   (`project.api.createNoteRegion` with an explicit `loopDuration`), and set the timeline
   loop area.
4. After both commit: resolve the unit's MIDI capture and arm it.

### Sample swap

Playback continues. In one transaction call `referSampleFile`, then apply the new preset's
parameters. In a following transaction replace the note region's events. Drop the old
buffer from the local map if its file box was deleted.

### Parameter controls

One `useParameter(project, parameter)` hook per control, bound to an
`AutomatableParameterFieldAdapter`. It reads with `catchupAndSubscribe`, writes unit values
inside `editing.modify()`, and formats the displayed value with the parameter's own string
mapping. Typed with the bare `AutomatableParameterFieldAdapter` so number and boolean
parameters share it.

Box numeric constraints do not clamp, so every control clamps to the parameter's range
before writing.

### Waveform

- **Static layer:** peaks read through the adapter layer (`adapter.file()` then the file
  adapter's `peaks`, both `Option`s) and drawn with `PeaksPainter`. Overlaid:
  region shading, a direction arrow that flips when start is past end, the loop range, and
  the two fade zones sized from `loopFade`. Repainted through `CanvasPainter`, invalidated
  by `project.editing.subscribe(() => painter.requestUpdate())`.
- **Markers:** four handles (region start, region end, loop start, loop end). The first
  change of a drag commits with `editing.modify()` and the rest with `editing.append()`,
  giving one undo step per drag. The drag ref is cleared on pointer up, pointer cancel and
  lost pointer capture. Each handle is focusable and moves with the arrow keys.
- **Loop markers** are constrained to the region in the UI, matching the engine's clamp.
  They are hidden when the loop is off.
- **Playhead overlay:** a second canvas with the same box model as the static layer.
  `subscribeFloats` on `positionsAddress` draws one vertical line per position until the
  first −1. No React state is written per packet. Colours come from `CANVAS_COLORS`.

### Transport and keyboard

Play and Stop drive the looping pattern. Play resumes the AudioContext first through the
engine facade. The piano keyboard reuses `PianoKeyboard` from `src/demos/midi/` and plays
over the pattern; external MIDI input works through the armed capture.

### LFO on Sample Start

Created lazily the first time the switch is turned on, in its own transaction:
`project.api.modulation.createLfo(…)` then `assign(box, sampleStart.modulationTarget, depth)`.
After that the modulator's enabled flag toggles it. Controls: on/off, synced rate, depth.
A small scope plots `getControlledUnitValue()`, and the waveform shows a ghost marker at the
modulated start position. The card states that modulation affects new notes only.

## Error handling

| Failure | Response |
|---|---|
| Engine or project init fails | The shared init error card |
| Dropped file fails to decode | Callout with the file name; the current sample stays |
| Sample loader reports an error | Callout through `watchSampleLoad` |
| LFO creation fails | Callout in the LFO card; the switch returns to off |
| Transaction building the instrument fails | Throw, so the transaction aborts as a whole |

## Verification

### Unit tests

- `nanoSamples`: every sample is finite, within ±1, the expected length, and has the
  expected fundamental (Pluck 220 Hz, Pad 130.81 Hz) measured by autocorrelation. The Riser's
  zero-crossing rate rises from the first quarter to the last.
- `nanoMarkers`: pixel ↔ unit round-trips, loop markers clamp inside a forward region and
  inside a reversed region, fade-zone width follows fade time and sample length.

### Measured in the browser

Output tapped through an `AnalyserNode` installed before the engine connects. Transport
started with a real click.

| Check | Expected |
|---|---|
| Pattern plays | Output RMS above zero |
| Pitch at the root key | Matches the sample's native frequency |
| Octave +1 | Frequency doubles |
| Tune +1200 ct on a held note | Frequency doubles without retriggering |
| Pluck, loop on | Output sustains past 1.5 s |
| Pluck, loop off | Output falls silent after the sample ends |
| Riser reversed | Sweep direction flips from rising to falling |
| Playheads | Line count matches sounding voices; none drawn when silent |
| LFO on | Successive notes start at different positions |
| Convolver demo after migration | Decay-envelope measurements unchanged |

Also: `npx tsc --noEmit` reports zero `^src/` lines, `npm test` passes, `npm run build`
passes, and a mobile-width scan finds no clipped elements.

## Order of work

1. **Risk check.** On a throwaway page, create a Nano with an in-memory sample, play one
   note, and confirm both audible output and position packets on `positionsAddress`. If
   either fails, stop and revisit the design.
2. Shared helper extraction and convolver migration, with the convolver re-verified.
3. Sample synthesis with unit tests.
4. Project content: instrument, sample swap, pattern.
5. Page shell, gallery, transport, parameter cards.
6. Waveform, markers and marker math with unit tests, then the playhead overlay.
7. Keyboard and MIDI input.
8. LFO card.
9. Browser verification.
10. New-demo checklist items, OG image, `CLAUDE.md` and README updates.
11. PR, review, fixes.

## Out of scope

- Automation lanes for Nano parameters.
- An LFO target picker or more than one modulator.
- Saving or reloading a dropped sample between visits.
- Multi-sample key zones or velocity layers, which Nano does not have.
- Any change to the Neon or Cubed demos beyond the folder move in PR #130.
