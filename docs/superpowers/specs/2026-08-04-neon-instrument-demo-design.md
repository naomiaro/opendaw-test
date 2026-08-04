# Neon Instrument Demo — Design

**Date:** 2026-08-04
**Status:** Approved (brainstorm 2026-08-04)
**Follow-up:** a separate regions-vs-clips demo gets its own spec after this ships.

## Goal

A live-play synth explorer for **Neon**, the CZ-101 phase-distortion instrument added in
SDK 0.0.164. One page, one Neon instance: authored presets + `.syx` drop zone, a
parameter panel bound to the box graph, a read-only 8-stage envelope visualizer, and an
on-screen piano keyboard. Showcases the release's new API surface:
`InstrumentFactories.Neon`, `NeonDeviceBoxAdapter` (`namedParameter`, `Neon` namespace
helpers, `envelope()`), `CzSysex` (both codec directions), and `NeonPreset.apply`.

**Out of scope:** recording/transport (covered by the MIDI recording demo), envelope
*editing* (upstream's editor is a large dedicated component), sysex *export* of the
current box state (reverse-mapping box→CzTone adds code for little demo value),
hardware MIDI input configuration UI (software keyboard only; hardware input works
implicitly if present — not surfaced).

## Files

| File | Purpose |
|---|---|
| `src/demos/instruments/neon-demo.tsx` | The demo (new `instruments` category) |
| `src/demos/instruments/neonPresets.ts` | 4–6 authored `CzTone` patches |
| `src/demos/instruments/CLAUDE.md` | Category SDK knowledge (Neon adapter, CzSysex gotchas learned while building) |
| `neon-demo.html` | Entry point at repo root (meta tags, og-image, GoatCounter) |
| `vite.config.ts` | Add rollup input |
| `src/index.tsx` | New "Instruments" card section |
| `public/sitemap.xml` | Add URL |
| `public/og-image-neon.png` | 1200×630 screenshot |

Follows the new-demo checklist in the repo CLAUDE.md and the design language in
`docs/design/2026-06-11-mastering-console-editorial.md` (reference implementation:
`src/demos/warp/warp-overview.tsx`).

## Architecture

### Setup (once, on init)

1. `initializeOpenDAW()` (shared `projectSetup.ts` path).
2. Transaction 1: `project.api.createInstrument(InstrumentFactories.Neon)` →
   `{ audioUnitBox }`.
3. Transaction 2 (separate, per repo rule on capture resolution):
   `project.captureDevices.get(audioUnitBox.address.uuid).unwrap().armed.setValue(true)`.
   Note `armed` is a runtime observable — `setValue` itself needs no transaction; the
   rule being honored is *resolving* the capture only after `createInstrument` commits.
4. Resolve the adapter once:
   `project.boxAdapters.adapterFor(instrumentBox, NeonDeviceBoxAdapter)`; keep
   `NeonDeviceBox` in a ref.

The default (init) tone sounds immediately — line-1 saw, DCW open, organ DCA — so the
keyboard is playable before any preset is loaded.

### Audio path (live-play only)

On-screen `PianoKeyboard` (imported from `src/demos/midi/PianoKeyboard.tsx` — it is
fully decoupled, React+Radix only, no lift needed) → `MidiDevices.softwareMIDIInput`
`sendNoteOn/sendNoteOff` → armed `CaptureMidi` → Neon → speakers. AudioContext resume
guard comes from the shared engine facade (`play()` wrap is not involved here — note-on
must check `audioContext.state` and resume before sending, same pattern as the MIDI
demo's keyboard handling).

### Presets & sysex

`neonPresets.ts` exports `Array<{ name: string, description: string, tone: CzTone }>` —
4–6 original patches in classic CZ territory (PD bass, glass bell, hollow pad,
brass-ish, percussive). Loading one runs:

```typescript
const bytes = CzSysex.encode(preset.tone);        // real .syx bytes
const tone = CzSysex.decode(bytes);               // round-trip
project.editing.modify(() => NeonPreset.apply(box, tone));
```

— deliberately through both codec directions on every click, so the demo continuously
exercises `encode` and `decode`, not just `apply`.

**Drop zone**: accepts a file, reads `Uint8Array`, gates on `CzSysex.isToneDump(bytes)`.
Valid → decode + apply (same path), show the patch as "Imported: <filename>". Invalid →
inline error ("Not a CZ-101 tone dump"), no state change. Errors are surfaced, never
swallowed. A multi-tone bank file only has its first tone read **only if**
`isToneDump` accepts it; otherwise it is rejected — behavior documented in the UI copy.

**UI state**: `activePreset: string | null` tracks the last-applied patch name; any
manual parameter tweak clears it to "Custom" (subscription-driven, not click-driven, so
undo/redo also updates it correctly).

### Parameter panel

All controls read/write the box graph — no shadow state. Writes:
`project.editing.modify(() => field.setValue(v))`. Reads: `catchupAndSubscribe` on each
field, so preset application (which writes fields in one transaction) updates every
control automatically. Terminate all subscriptions on unmount.

| Control | Field / source | Widget |
|---|---|---|
| Line select | `namedParameter.lineSelect` | Segmented (labels from `Neon.LineSelect`) |
| Wave 1 / Wave 2 (per line ×2) | `namedParameter.lines[i].wave1/.wave2` | Select (labels `Neon.Waves`; wave2 adds "Off") |
| Modulation | `namedParameter.modulation` | Segmented (`Neon.Modulation`: Off / Ring / Noise) |
| Vibrato wave | `namedParameter.vibrato.wave` | Select (`Neon.VibratoWaves`) |
| Vibrato delay / rate / depth | `namedParameter.vibrato.*` | Sliders 0–99 |
| Octave | `namedParameter.octave` | Stepper −3…+3 |
| Detune | `namedParameter.detune` | Slider ±4800 ct (display in semitones + cents) |
| Tune | `namedParameter.tune` | Slider ±1200 ct |
| Glide time | `namedParameter.glideTime` | Slider 0–1 |
| Voicing | `namedParameter.voicingMode` | Mono/Poly toggle |

Line 2's wave/key-follow controls are visually de-emphasized (not hidden) when
line-select is "1" — the CZ behavior (line 2 inaudible) stays discoverable.
DCW/DCA key-follow sliders (0–9) are included in the per-line block.

### Envelope visualizer (read-only)

- Selector: 6 buttons (Line 1/2 × Pitch/DCW/DCA), using `Neon.envelopeIndex(line, kind)`
  / `adapter.envelope(line, kind)` to fetch the `NeonEnvelope` object.
- Canvas draws the stage polyline: x = cumulative schematic time (stage width ∝
  `100 − rate`, min width floor for readability), y = level 0–99. Sustain stage marked
  with a hold bar, end stage marked; stages past `end` drawn ghosted.
- Caption states the time axis is schematic — the DSP owns the hardware rate/level
  tables.
- Repaint via `CanvasPainter` with values read inside the render callback from the box
  (refs, not per-frame React state — repo canvas rules). Envelope fields are plain
  (non-automatable) fields; subscribe to the *selected* envelope's fields to invalidate,
  plus repaint on preset apply.

### Layout (mastering-console editorial)

```
[Header: title + blurb + DebugLinkBar/GitHubCorner/BackLink/MoisesLogo]
[Patch strip: preset cards + drop zone + active-patch indicator]
[Main grid: parameter panel (left, 2 cols) | envelope visualizer (right)]
[PianoKeyboard, full width]
[Footer: GoatCounter etc.]
```

Mobile: grid collapses to single column; per-element overflow checks
(`scrollWidth > clientWidth`) per repo rule; keyboard scrolls horizontally in its own
container.

## Error handling

- Init failure → existing error-card pattern (same as other demos; HMR "Workers are
  already installed" judged on fresh load only).
- `.syx` rejection → inline, non-blocking message; console gets a string log
  (repo feedback rule: log strings, not objects).
- AudioContext suspended at first key press → resume, then send note; if resume fails
  the key press shows no sound but no crash (iOS re-suspend pattern from CLAUDE.md).

## Testing & verification

- `npx tsc --noEmit --ignoreDeprecations "6.0"` — zero new `src/` errors.
- Unit: `neonPresets.test.ts` — every authored preset round-trips
  `decode(encode(tone))` back to a deep-equal `CzTone`, and `isToneDump` accepts every
  encoded preset + rejects garbage bytes. Pure data test, no engine, runs in vitest.
- Browser (fresh load, real click for first note): analyser-RMS tap proves keys make
  sound (repo rule: measure output, not UI state); switching presets audibly changes
  timbre (RMS/spectral difference or at minimum non-silence across 3 presets); `.syx`
  drop of an encoded preset file applies (drop a file produced by our own `encode`).
- Standard PR flow: comprehensive review before merge, squash-merge.

## Risks / open questions

- **CZ authenticity of authored presets** is best-effort — they must sound *good* and
  *different from each other*, not match factory patches.
- **`Neon.Waves` label arrays** are the SDK's own names; UI uses them verbatim to avoid
  drift.
- If `PianoKeyboard`'s fixed C3–B5 range proves awkward for bass presets, adjust octave
  via the octave stepper rather than forking the keyboard component.
