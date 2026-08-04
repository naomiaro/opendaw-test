# Neon Instrument Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live-play synth explorer demo page for Neon (the SDK 0.0.164 CZ-101 phase-distortion instrument): authored `.syx`-round-tripped presets, drop zone, box-graph-bound parameter panel, read-only envelope visualizer, on-screen keyboard.

**Architecture:** One React page (`src/demos/instruments/neon-demo.tsx`, new category) with a single Neon instrument created at init and its `CaptureMidi` armed. All parameter UI reads/writes box-graph fields directly (no shadow state). Presets are `CzTone` literals round-tripped through `CzSysex.encode → decode → NeonPreset.apply` on every load.

**Tech Stack:** React 19 + Radix Themes, `@opendaw/studio-sdk` 0.0.164 (`InstrumentFactories.Neon`, `NeonDeviceBoxAdapter`, `CzSysex`, `NeonPreset` from `@opendaw/studio-adapters`; `NeonDeviceBox`, `NeonEnvelope` from `@opendaw/studio-boxes`), vitest, Vite multi-page build.

**Spec:** `docs/superpowers/specs/2026-08-04-neon-instrument-demo-design.md`

## Global Constraints

- Branch: `neon-demo` (already created; spec committed on it).
- All box-graph writes inside `project.editing.modify(() => …)`; never call `modify` inside an `editing.subscribe` callback.
- Every `catchupAndSubscribe`/`subscribe` return value is stored and `.terminate()`d in effect cleanup.
- Option types: `.isEmpty()` / `.unwrap()` — never `?.`/`??` on an `Option`.
- Resolve the capture only AFTER the `createInstrument` transaction commits (separate step); `armed.setValue(true)` is a runtime observable — no transaction around it.
- Design language: `docs/design/2026-06-11-mastering-console-editorial.md`; reference implementation `src/demos/warp/warp-overview.tsx`; palette tokens from `src/lib/design/consoleTheme.ts` (canvas code imports `CANVAS_COLORS` — canvas 2D can't read CSS vars).
- Console logging: strings only, never objects.
- Dev server is HTTPS; reuse a running server, don't spawn new ones per verification round (kill by PID via `lsof -ti :<port>` if needed).
- In-browser audio start needs a REAL click (untrusted `.click()` silently fails to start the AudioContext).
- Verify demos by measuring output signal (analyser RMS), not UI state.
- tsc gate: `npx tsc --noEmit --ignoreDeprecations "6.0"` must show zero `src/` errors (Vite build does not run tsc).
- `noUnusedLocals` is strict: introduce state in the commit that first READS it.
- PPQN/AudioContext/HMR gotchas per repo CLAUDE.md; judge init errors on fresh page loads only (HMR throws "Workers are already installed").

---

### Task 1: Authored presets + sysex round-trip test

**Files:**
- Create: `src/demos/instruments/neonPresets.ts`
- Test: `src/demos/instruments/neonPresets.test.ts`

**Interfaces:**
- Consumes: `CzSysex`, `CzTone`, `CzEnvelope` from `@opendaw/studio-adapters` (root exports).
- Produces: `NEON_PRESETS: ReadonlyArray<NeonPresetDef>` where `type NeonPresetDef = { name: string; description: string; tone: CzTone }`. Task 3 imports `NEON_PRESETS` and `NeonPresetDef`.

**Codec reality (why the test is a fixpoint test):** `CzSysex` maps the 0–99 panel domain onto hardware bytes (levels through 0–127, DCW rates through a 119-step table) — encode/decode is quantized, so `decode(encode(tone))` is NOT guaranteed deep-equal to `tone`. It IS a projection: once a tone has been through the codec, further round-trips are stable. Test that fixpoint property, plus closeness (±1) to authored values so presets keep their intent.

- [ ] **Step 1: Write the failing test**

```typescript
// src/demos/instruments/neonPresets.test.ts
import { describe, expect, it } from "vitest";
import { CzSysex, CzTone } from "@opendaw/studio-adapters";
import { NEON_PRESETS } from "./neonPresets";

const flatten = (tone: CzTone): number[] => [
  tone.lineSelect, tone.modulation, tone.octave, tone.detuneNote, tone.detuneFine,
  tone.vibratoWave, tone.vibratoDelay, tone.vibratoRate, tone.vibratoDepth,
  ...tone.lines.flatMap((line) => [
    line.wave1, line.wave2, line.dcwKeyFollow, line.dcaKeyFollow,
    ...[line.pitchEnv, line.dcwEnv, line.dcaEnv].flatMap((env) => [
      ...env.rates, ...env.levels, env.sustain, env.end,
    ]),
  ]),
];

describe("NEON_PRESETS", () => {
  it("has 4-6 uniquely named presets", () => {
    expect(NEON_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(NEON_PRESETS.length).toBeLessThanOrEqual(6);
    expect(new Set(NEON_PRESETS.map((p) => p.name)).size).toBe(NEON_PRESETS.length);
  });

  it("every preset encodes to a valid tone dump", () => {
    for (const preset of NEON_PRESETS) {
      expect(CzSysex.isToneDump(CzSysex.encode(preset.tone))).toBe(true);
    }
  });

  it("rejects garbage bytes", () => {
    expect(CzSysex.isToneDump(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(CzSysex.isToneDump(new Uint8Array(300).fill(0x42))).toBe(false);
  });

  it("decode(encode(tone)) is a codec fixpoint within ±1 of authored values", () => {
    for (const preset of NEON_PRESETS) {
      const once = CzSysex.decode(CzSysex.encode(preset.tone));
      const twice = CzSysex.decode(CzSysex.encode(once));
      expect(twice).toEqual(once); // fixpoint: second round-trip exact
      const authored = flatten(preset.tone);
      const projected = flatten(once);
      expect(projected.length).toBe(authored.length);
      projected.forEach((value, i) => {
        expect(Math.abs(value - authored[i]), `${preset.name} field #${i}`).toBeLessThanOrEqual(1);
      });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/demos/instruments/neonPresets.test.ts`
Expected: FAIL — cannot resolve `./neonPresets`.

- [ ] **Step 3: Write the presets**

Five original patches in classic CZ territory. `env(rates, levels, sustain, end)` helper keeps literals compact; all values are ints 0–99 (the codec's panel domain), `sustain` 0–8 (0 = none), `end` 1–8, arrays length 8 (unused stages 0).

```typescript
// src/demos/instruments/neonPresets.ts
import { CzEnvelope, CzTone } from "@opendaw/studio-adapters";

export type NeonPresetDef = { name: string; description: string; tone: CzTone };

const env = (
  rates: number[], levels: number[], sustain: number, end: number,
): CzEnvelope => ({
  rates: [...rates, ...Array(8 - rates.length).fill(0)],
  levels: [...levels, ...Array(8 - levels.length).fill(0)],
  sustain, end,
});

// Flat pitch envelope shared by patches that don't bend.
const FLAT_PITCH = env([99], [0], 0, 1);

// Wave indices (Neon.Waves): 0 Saw, 1 Square, 2 Pulse, 3 Double Sine, 4 Saw-Pulse,
// 5 Resonance Saw, 6 Resonance Triangle, 7 Resonance Trapezoid. wave2: 0 = Off, 1-8 = wave+1.
// modulation: 0 Off, 1 Ring, 2 Noise. vibratoWave: 0 Triangle, 1 Saw Up, 2 Saw Down, 3 Square.

export const NEON_PRESETS: ReadonlyArray<NeonPresetDef> = [
  {
    name: "PD Bass",
    description: "Punchy phase-distortion bass — fast DCW sweep, tight decay",
    tone: {
      lineSelect: 0, modulation: 0, octave: -1, detuneNote: 0, detuneFine: 0,
      vibratoWave: 0, vibratoDelay: 0, vibratoRate: 0, vibratoDepth: 0,
      lines: [
        {
          wave1: 0, wave2: 2, dcwKeyFollow: 2, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 45], [99, 20], 2, 3),
          dcaEnv: env([99, 60], [99, 0], 0, 2),
        },
        {
          wave1: 0, wave2: 0, dcwKeyFollow: 0, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH, dcwEnv: env([99], [50], 1, 2), dcaEnv: env([99], [99], 1, 2),
        },
      ],
    },
  },
  {
    name: "Glass Bell",
    description: "Ring-modulated bell — detuned second line, long DCA release",
    tone: {
      lineSelect: 3, modulation: 1, octave: 0, detuneNote: 7, detuneFine: 4,
      vibratoWave: 0, vibratoDelay: 0, vibratoRate: 0, vibratoDepth: 0,
      lines: [
        {
          wave1: 3, wave2: 0, dcwKeyFollow: 4, dcaKeyFollow: 3,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 30], [90, 10], 0, 2),
          dcaEnv: env([99, 25], [99, 0], 0, 2),
        },
        {
          wave1: 1, wave2: 0, dcwKeyFollow: 5, dcaKeyFollow: 3,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 22], [80, 0], 0, 2),
          dcaEnv: env([99, 20], [99, 0], 0, 2),
        },
      ],
    },
  },
  {
    name: "Hollow Pad",
    description: "Slow square pad — gentle DCW bloom, both lines, slow release",
    tone: {
      lineSelect: 2, modulation: 0, octave: 0, detuneNote: 0, detuneFine: 12,
      vibratoWave: 0, vibratoDelay: 40, vibratoRate: 30, vibratoDepth: 12,
      lines: [
        {
          wave1: 1, wave2: 0, dcwKeyFollow: 1, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([28, 18], [70, 45], 2, 3),
          dcaEnv: env([35, 30, 18], [99, 90, 0], 2, 3),
        },
        {
          wave1: 1, wave2: 0, dcwKeyFollow: 1, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([25, 15], [60, 40], 2, 3),
          dcaEnv: env([30, 28, 16], [99, 88, 0], 2, 3),
        },
      ],
    },
  },
  {
    name: "Rez Brass",
    description: "Resonance-saw brass — DCW attack blip, key-followed brightness",
    tone: {
      lineSelect: 0, modulation: 0, octave: 0, detuneNote: 0, detuneFine: 0,
      vibratoWave: 0, vibratoDelay: 55, vibratoRate: 45, vibratoDepth: 10,
      lines: [
        {
          wave1: 5, wave2: 1, dcwKeyFollow: 6, dcaKeyFollow: 2,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([70, 40, 50], [99, 55, 70], 3, 4),
          dcaEnv: env([85, 50], [99, 85], 2, 3),
        },
        {
          wave1: 0, wave2: 0, dcwKeyFollow: 0, dcaKeyFollow: 0,
          pitchEnv: FLAT_PITCH, dcwEnv: env([99], [50], 1, 2), dcaEnv: env([99], [99], 1, 2),
        },
      ],
    },
  },
  {
    name: "Noise Perc",
    description: "Noise-modulated percussive hit — instant attack, no sustain",
    tone: {
      lineSelect: 3, modulation: 2, octave: 1, detuneNote: 0, detuneFine: 0,
      vibratoWave: 0, vibratoDelay: 0, vibratoRate: 0, vibratoDepth: 0,
      lines: [
        {
          wave1: 2, wave2: 0, dcwKeyFollow: 7, dcaKeyFollow: 5,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 70], [99, 0], 0, 2),
          dcaEnv: env([99, 75], [99, 0], 0, 2),
        },
        {
          wave1: 7, wave2: 0, dcwKeyFollow: 7, dcaKeyFollow: 5,
          pitchEnv: FLAT_PITCH,
          dcwEnv: env([99, 72], [90, 0], 0, 2),
          dcaEnv: env([99, 78], [99, 0], 0, 2),
        },
      ],
    },
  },
];
```

- [ ] **Step 4: Run the test until it passes**

Run: `npx vitest run src/demos/instruments/neonPresets.test.ts`
Expected: PASS. If the ±1 closeness assertion fails on a particular field, the codec
quantized harder than ±1 there — nudge that authored value to the projected value the
failure message reports (the projection IS the canonical patch). Do not loosen the
fixpoint assertion.

- [ ] **Step 5: Full test suite + tsc, then commit**

Run: `npx vitest run && npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' || true`
Expected: all tests pass; no `src/` tsc output.

```bash
git add src/demos/instruments/neonPresets.ts src/demos/instruments/neonPresets.test.ts
git commit -m "feat: Neon demo presets with sysex fixpoint round-trip test"
```

---

### Task 2: Demo scaffold — page boots, Neon sounds

**Files:**
- Create: `neon-demo.html` (repo root)
- Create: `src/demos/instruments/neon-demo.tsx`
- Modify: `vite.config.ts` (rollup input map — add one line)

**Interfaces:**
- Consumes: `initializeOpenDAW` from `@/lib/projectSetup` (same call shape as `src/demos/midi/midi-recording-demo.tsx:108`), `PianoKeyboard` from `@/demos/midi/PianoKeyboard` (props `{activeNotes: Set<number>, onNoteOn(note), onNoteOff(note), disabled?}`), `InstrumentFactories`, `MidiDevices` per the MIDI demo's imports.
- Produces: the page component with `project`, `audioContext`, `neonBox: NeonDeviceBox | null` state and `deviceBoxRef` — Tasks 3–5 add sections to this file and consume `neonBox`.

- [ ] **Step 1: HTML entry point**

Copy `midi-recording-demo.html` → `neon-demo.html`, then replace title/description/URLs (GoatCounter script at the bottom carries over verbatim). Head content:

```html
<title>OpenDAW Neon Demo - CZ-101 Phase Distortion Synth in the Browser</title>
<meta name="title" content="OpenDAW Neon Demo - CZ-101 Phase Distortion Synth in the Browser" />
<meta name="description"
    content="Play Neon, OpenDAW's Casio CZ-101 phase-distortion synthesizer. Load .syx tone dumps, tweak waves and ring/noise modulation, and inspect 8-stage envelopes." />
<meta name="keywords"
    content="OpenDAW, Neon, CZ-101, phase distortion, sysex, web synth, browser synthesizer, Casio CZ" />
<link rel="canonical" href="https://opendaw-test.pages.dev/neon-demo.html" />
```

Update all `og:*` / `twitter:*` URLs to `/neon-demo.html` and images to `/og-image-neon.png` (image lands in Task 6). Point the module script at `/src/demos/instruments/neon-demo.tsx`.

- [ ] **Step 2: Vite entry**

In `vite.config.ts`, add to `rollupOptions.input` (alphabetical-ish, near `apparat`):

```typescript
neon: resolve(__dirname, "neon-demo.html"),
```

- [ ] **Step 3: Minimal page component**

`src/demos/instruments/neon-demo.tsx` — follow the MIDI demo's init pattern exactly (`src/demos/midi/midi-recording-demo.tsx:100-150` is the reference). Core wiring:

```tsx
const [project, setProject] = useState<Project | null>(null);
const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
const [neonBox, setNeonBox] = useState<NeonDeviceBox | null>(null);
const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
const [status, setStatus] = useState("Initializing…");
const [initError, setInitError] = useState<string | null>(null);

useEffect(() => {
  let mounted = true;
  (async () => {
    try {
      const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
        onStatusUpdate: setStatus,
      });
      if (!mounted) return;
      setAudioContext(ctx);

      let audioUnitBox: AudioUnitBox | null = null;
      let instrumentBox: NeonDeviceBox | null = null;
      newProject.editing.modify(() => {
        const result = newProject.api.createInstrument(InstrumentFactories.Neon);
        audioUnitBox = result.audioUnitBox;
        instrumentBox = result.instrumentBox as NeonDeviceBox;
      });

      // Resolve the capture AFTER the creation transaction commits (repo rule).
      // armed is a runtime observable — no editing.modify() around setValue.
      const captureOption = audioUnitBox
        ? newProject.captureDevices.get((audioUnitBox as AudioUnitBox).address.uuid)
        : null;
      if (!captureOption || captureOption.isEmpty()) {
        setInitError("Could not arm the MIDI capture — keys would make no sound.");
        return;
      }
      captureOption.unwrap().armed.setValue(true);

      setNeonBox(instrumentBox);
      setProject(newProject);
      setStatus("Ready — play the keyboard");
    } catch (error) {
      if (mounted) setInitError(error instanceof Error ? error.message : String(error));
    }
  })();
  return () => { mounted = false; };
}, []);

const handleNoteOn = useCallback(async (note: number) => {
  if (audioContext && audioContext.state !== "running") await audioContext.resume();
  MidiDevices.softwareMIDIInput.sendNoteOn(note, 0.8);
  setActiveNotes((prev) => new Set(prev).add(note));
}, [audioContext]);

const handleNoteOff = useCallback((note: number) => {
  MidiDevices.softwareMIDIInput.sendNoteOff(note);
  setActiveNotes((prev) => { const next = new Set(prev); next.delete(note); return next; });
}, []);
```

Render: Radix `Theme` + page shell (header with title/blurb, `GitHubCorner`, `BackLink`, `MoisesLogo` — copy the shell from the MIDI demo), init-error card when `initError`, status line, and `<PianoKeyboard activeNotes={activeNotes} onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} disabled={!project} />`. The init tone (line-1 saw, organ DCA) is audible with zero further UI.

- [ ] **Step 4: Verify — tsc + fresh browser load with a real click**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' || true` → no output.
Dev server (reuse if running): `npm run dev` → `https://localhost:5173/neon-demo.html`.
Fresh load, REAL click on a piano key: status reaches "Ready", key press produces sound.
Confirm with the analyser-RMS tap if listening isn't possible (repo CLAUDE.md pattern —
inject the `AudioNode.prototype.connect` monkeypatch immediately after navigation).

- [ ] **Step 5: Commit**

```bash
git add neon-demo.html vite.config.ts src/demos/instruments/neon-demo.tsx
git commit -m "feat: Neon demo scaffold — instrument boots and plays"
```

---

### Task 3: Preset strip + .syx drop zone

**Files:**
- Modify: `src/demos/instruments/neon-demo.tsx`

**Interfaces:**
- Consumes: `NEON_PRESETS`, `NeonPresetDef` (Task 1); `neonBox`, `project` state (Task 2); `CzSysex`, `NeonPreset` from `@opendaw/studio-adapters`.
- Produces: `activePatch: string` state ("Init", a preset name, `Imported: <file>`, or "Custom") — Task 4's field subscriptions set it to "Custom"; `applyTone(tone: CzTone, label: string)` used by both preset cards and the drop zone.

- [ ] **Step 1: Apply path (round-trips the codec on every click)**

```tsx
const [activePatch, setActivePatch] = useState("Init");
const [syxError, setSyxError] = useState<string | null>(null);
const suppressCustomRef = useRef(false); // Task 4 reads this to skip "Custom" during preset apply

const applyTone = useCallback((tone: CzTone, label: string) => {
  if (!project || !neonBox) return;
  // Deliberately through both codec directions: the applied patch is the projection
  // real hardware would receive, and encode/decode are exercised on every click.
  const roundTripped = CzSysex.decode(CzSysex.encode(tone));
  suppressCustomRef.current = true;
  project.editing.modify(() => NeonPreset.apply(neonBox, roundTripped));
  suppressCustomRef.current = false;
  setActivePatch(label);
  setSyxError(null);
}, [project, neonBox]);
```

- [ ] **Step 2: Preset cards + drop zone UI**

Preset strip: one card per `NEON_PRESETS` entry (name + description, active card highlighted by `activePatch === preset.name`), `onClick={() => applyTone(preset.tone, preset.name)}`. Drop zone: a bordered target with `onDragOver={e => e.preventDefault()}` and:

```tsx
const handleSyxFile = useCallback(async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!CzSysex.isToneDump(bytes)) {
    console.log(`Neon demo: rejected ${file.name} — not a CZ-101 tone dump`);
    setSyxError(`"${file.name}" is not a CZ-101 tone dump (.syx single-tone format).`);
    return;
  }
  applyTone(CzSysex.decode(bytes), `Imported: ${file.name}`);
}, [applyTone]);
```

Wire to both `onDrop` and a hidden `<input type="file" accept=".syx">` fallback for
click-to-browse. Show `syxError` inline under the drop zone (non-blocking). UI copy notes
that bank files are read as a single tone if accepted, rejected otherwise.

- [ ] **Step 3: Verify in browser**

Fresh load: click each of the 5 presets, play a key after each — timbre changes, active
card highlights. Export one preset's bytes from the console
(`CzSysex.encode(...)` → `Blob` → download) and drop the file back: applies as
`Imported: <name>`. Drop a `.txt` file: inline error, patch unchanged.

- [ ] **Step 4: tsc + tests, commit**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' || true` and `npx vitest run`.

```bash
git add src/demos/instruments/neon-demo.tsx
git commit -m "feat: Neon demo preset strip and .syx drop zone"
```

---

### Task 4: Parameter panel bound to the box graph

**Files:**
- Modify: `src/demos/instruments/neon-demo.tsx`

**Interfaces:**
- Consumes: `neonBox` (Task 2), `setActivePatch` + `suppressCustomRef` (Task 3), `Neon` namespace label arrays from `@opendaw/studio-adapters` (`Neon.Waves` [8], `Neon.LineSelect` [4], `Neon.Modulation` [3], `Neon.VibratoWaves` [4]).
- Produces: `useNeonField` hook reused by Task 5's invalidation.

- [ ] **Step 1: The field-binding hook**

Box field getters (verified in `node_modules/@opendaw/studio-boxes/dist/NeonDeviceBox.d.ts`): `lineSelect`, `modulation`, `octave`, `detune`, `tune`, `glideTime`, `voicingMode` (Int32/Float32Field), `vibrato.{wave, delay, rate, depth}`, `lines.fields()[i].{wave1, wave2, dcwKeyFollow, dcaKeyFollow}`.

```tsx
// One hook per bound control. Reads catch up immediately; writes go through a
// transaction; any change (user, preset apply, undo) flows back via the subscription.
function useNeonField(
  project: Project | null,
  field: Int32Field | Float32Field | null,
  onExternalChange?: () => void,
): [number, (v: number) => void] {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!field) return;
    const sub = field.catchupAndSubscribe((obs) => {
      setValue(obs.getValue());
      onExternalChange?.();
    });
    return () => sub.terminate();
  }, [field]); // onExternalChange intentionally excluded — stable ref pattern below
  const write = useCallback((v: number) => {
    if (!project || !field) return;
    project.editing.modify(() => field.setValue(v));
  }, [project, field]);
  return [value, write];
}
```

`onExternalChange` is the "Custom" hook: pass a stable callback that sets
`activePatch` to "Custom" unless `suppressCustomRef.current` is true (preset applies
must not mark the patch Custom) or the incoming value equals the current one. Simplest
robust form: keep a `lastPatchWriteRef` timestamp? NO — keep it simple and subscription-driven:
the callback checks `suppressCustomRef.current` only. First catch-up fires during mount
while `activePatch` is "Init" — gate with a `mountedRef` set after first render of the panel.

- [ ] **Step 2: Controls**

Using existing Radix widgets per repo conventions (`Select`, `Slider`, `SegmentedControl`, `Switch`):

- Line select: `SegmentedControl` over `Neon.LineSelect` → `box.lineSelect`.
- Modulation: `SegmentedControl` over `Neon.Modulation` → `box.modulation`.
- Per line ×2 (cards "Line 1" / "Line 2"): wave1 `Select` over `Neon.Waves`; wave2 `Select` over `["Off", ...Neon.Waves]`; DCW / DCA key-follow `Slider` 0–9 step 1 → `lines.fields()[i]` getters.
- Vibrato card: wave `Select` over `Neon.VibratoWaves`; delay/rate/depth `Slider` 0–99 step 1.
- Global card: octave stepper (−3…+3, `-`/`+` buttons), detune `Slider` −4800…4800 step 1 with `st + ct` readout (`Math.trunc(v/100)` st, `v%100` ct), tune `Slider` −1200…1200, glide `Slider` 0–1 step 0.01, voicing `Switch` Mono/Poly (`VoicingMode.Monophonic`/`.Polyphonic` from `@opendaw/studio-enums`).
- Line 2 card gets `opacity: 0.45` + a "line 1 only" hint when `lineSelect === 0` (value 0 = "1") — de-emphasized, still interactive.

Layout per spec: parameter panel left (2 columns of cards), envelope visualizer right (Task 5 fills it; render a placeholder card "Envelopes" now ONLY if Task 5 is not in the same PR — otherwise skip the placeholder).

- [ ] **Step 3: Verify in browser**

Fresh load: move detune → pitch audibly bends, patch label flips to "Custom". Load
"Glass Bell" → every control snaps to the patch's values (subscription round-trip),
label shows the preset name, NOT Custom. Toggle modulation Off/Ring/Noise while holding
a key → timbre changes. Undo (`project.editing` undo via Cmd+Z is not wired — skip undo
verification; subscriptions are still exercised by preset loads).

- [ ] **Step 4: tsc + tests, commit**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' || true` and `npx vitest run`.

```bash
git add src/demos/instruments/neon-demo.tsx
git commit -m "feat: Neon demo parameter panel bound to box fields"
```

---

### Task 5: Envelope visualizer (read-only canvas)

**Files:**
- Modify: `src/demos/instruments/neon-demo.tsx`

**Interfaces:**
- Consumes: `neonBox.envelopes.fields()` (`NeonEnvelope[6]`, order: line1 pitch/DCW/DCA, line2 pitch/DCW/DCA), `Neon.envelopeIndex(line, kind)` from `@opendaw/studio-adapters`, `CANVAS_COLORS` from `@/lib/design/consoleTheme`, `CanvasPainter` from `@/lib/CanvasPainter`.
- Produces: nothing consumed later.

- [ ] **Step 1: Selector + painter**

Selector state: `const [envSel, setEnvSel] = useState<{line: 0 | 1, kind: "pitch" | "dcw" | "dca"}>({line: 0, kind: "dca"})`. Six `SegmentedControl`-style buttons (L1/L2 × Pitch/DCW/DCA). Resolve the envelope object inside the painter callback via a ref (repo canvas rule: refs, not per-frame React state):

```tsx
const envSelRef = useRef(envSel);
envSelRef.current = envSel;

useEffect(() => {
  const canvas = envCanvasRef.current;
  if (!canvas || !neonBox) return;
  // CanvasPainter callback signature is (painter, context) — verified in
  // src/lib/CanvasPainter.ts:21. Dimensions come from the canvas's CSS box
  // (the painter handles devicePixelRatio internally).
  const painter = new CanvasPainter(canvas, (_painter, context) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const { line, kind } = envSelRef.current;
    const envelope = neonBox.envelopes.fields()[Neon.envelopeIndex(line, kind)];
    const rates = [envelope.rate1, envelope.rate2, envelope.rate3, envelope.rate4,
      envelope.rate5, envelope.rate6, envelope.rate7, envelope.rate8].map((f) => f.getValue());
    const levels = [envelope.level1, envelope.level2, envelope.level3, envelope.level4,
      envelope.level5, envelope.level6, envelope.level7, envelope.level8].map((f) => f.getValue());
    const sustain = envelope.sustain.getValue(); // 1-8, 0 = none
    const end = envelope.end.getValue();         // 1-8
    drawEnvelope(context, width, height, rates, levels, sustain, end);
  });
  return () => painter.terminate();
}, [neonBox]);
```

- [ ] **Step 2: `drawEnvelope` — schematic stage polyline**

```tsx
// Schematic time axis: stage width ∝ (100 − rate), floored so fast stages stay visible.
// The DSP owns the real hardware rate tables; this is a shape sketch, and the caption
// under the canvas says so.
function drawEnvelope(
  context: CanvasRenderingContext2D, width: number, height: number,
  rates: number[], levels: number[], sustain: number, end: number,
): void {
  const pad = 12;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const stageCount = Math.max(1, Math.min(8, end));
  const widths = Array.from({ length: stageCount }, (_, i) => Math.max(8, 100 - rates[i]));
  const total = widths.reduce((a, b) => a + b, 0);
  const y = (level: number) => pad + plotH * (1 - level / 99);

  context.clearRect(0, 0, width, height);
  context.strokeStyle = CANVAS_COLORS.amber;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(pad, y(0));
  let x = pad;
  const stageX: number[] = [];
  for (let i = 0; i < stageCount; i++) {
    x += (widths[i] / total) * plotW;
    stageX.push(x);
    context.lineTo(x, y(levels[i]));
  }
  context.stroke();

  // Sustain marker: vertical dashed line + hold bar at the sustain stage's level.
  if (sustain >= 1 && sustain <= stageCount) {
    const sx = stageX[sustain - 1];
    context.strokeStyle = CANVAS_COLORS.textDim;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(sx, pad);
    context.lineTo(sx, pad + plotH);
    context.stroke();
    context.setLineDash([]);
  }

  // Stage dots.
  context.fillStyle = CANVAS_COLORS.text;
  stageX.forEach((dotX, i) => {
    context.beginPath();
    context.arc(dotX, y(levels[i]), 3, 0, Math.PI * 2);
    context.fill();
  });
}
```

(Adjust `CANVAS_COLORS` key names to what `consoleTheme.ts` actually exports — check the
file; do NOT invent tokens.) `CanvasPainter` repaints every frame, so preset applies and
selector changes render without explicit invalidation; keep the canvas modest
(~full card width × 180px) since per-frame reads of 18 fields are cheap.

- [ ] **Step 3: Verify in browser**

Load "Hollow Pad" → DCA envelope shows slow multi-stage shape with sustain marker; switch
to "Noise Perc" → shape snaps to fast attack/decay, no sustain line (sustain 0). All six
selector buttons switch curves. Mobile width: canvas stays inside its card
(`scrollWidth <= clientWidth` on the card element).

- [ ] **Step 4: tsc + tests, commit**

Run: `npx tsc --noEmit --ignoreDeprecations "6.0" 2>&1 | grep '^src/' || true` and `npx vitest run`.

```bash
git add src/demos/instruments/neon-demo.tsx
git commit -m "feat: Neon demo 8-stage envelope visualizer"
```

---

### Task 6: Site integration + category CLAUDE.md

**Files:**
- Modify: `src/index.tsx` (new "Instruments" section)
- Modify: `public/sitemap.xml`
- Create: `src/demos/instruments/CLAUDE.md`

- [ ] **Step 1: Index card**

In `src/index.tsx`, add a new section to the sections array (after the MIDI/Recording section, matching the existing shape — see the "Warp & Pitch" section at `src/index.tsx:149` for the format):

```tsx
{
  label: "Instruments",
  color: "var(--mc-amber)",
  demos: [
    {
      href: "/neon-demo.html",
      title: "Neon: CZ-101 Phase Distortion",
      blurb:
        "Play OpenDAW's Casio CZ-101 phase-distortion synth. Five original patches round-tripped through real .syx bytes, a sysex drop zone, live wave/modulation controls, and an 8-stage envelope visualizer.",
    },
  ],
},
```

(Verify `--mc-amber` exists in `consoleTheme.ts` / the design tokens; if section colors
are drawn from a specific set, pick an unused token from that set.)

- [ ] **Step 2: Sitemap**

Add to `public/sitemap.xml`, copying an existing `<url>` block:

```xml
<url>
  <loc>https://opendaw-test.pages.dev/neon-demo.html</loc>
</url>
```

(Match the existing entries' exact child elements — if they carry `lastmod`/`priority`, copy that shape.)

- [ ] **Step 3: Category CLAUDE.md**

Create `src/demos/instruments/CLAUDE.md` capturing what building this taught (write what you actually hit; at minimum):

```markdown
# Instruments Demos — OpenDAW SDK Reference

### Neon (CZ-101 phase distortion)
- Create: `project.api.createInstrument(InstrumentFactories.Neon)`; arm its CaptureMidi
  (resolved AFTER the creation transaction) or keys are silent.
- Box fields: `lineSelect`, `modulation`, `octave`, `detune` (±4800 ct), `tune` (±1200 ct),
  `glideTime`, `voicingMode`, `vibrato.{wave,delay,rate,depth}`,
  `lines.fields()[i].{wave1,wave2,dcwKeyFollow,dcaKeyFollow}`,
  `envelopes.fields()[0..5]` (order: line1 pitch/DCW/DCA, line2 pitch/DCW/DCA —
  or use `Neon.envelopeIndex(line, kind)`).
- UI labels come from the SDK: `Neon.Waves` / `Neon.LineSelect` / `Neon.Modulation` /
  `Neon.VibratoWaves` — don't hand-write wave names.
- `CzSysex` is a LOSSY quantizing codec (panel 0-99 ↔ hardware bytes):
  `decode(encode(tone))` is a projection, not identity — it IS a fixpoint (second
  round-trip is exact). Test round-trips as fixpoint + ±1 closeness, never deep-equal
  on authored values.
- `NeonPreset.apply(box, tone)` must run inside `editing.modify()`.
- `CzSysex.decode` reads the tone at the END of the buffer; `isToneDump` checks
  F0 44 … F7 framing + minimum length.
```

Append any additional gotchas discovered in Tasks 2–5.

- [ ] **Step 4: Build + verify index page, commit**

Run: `npm run build` → passes. Dev server: index page shows the Instruments section, card links to the demo.

```bash
git add src/index.tsx public/sitemap.xml src/demos/instruments/CLAUDE.md
git commit -m "feat: Neon demo site integration — index card, sitemap, category CLAUDE.md"
```

---

### Task 7: Verification pass, og-image, PR

**Files:**
- Create: `public/og-image-neon.png` (1200×630)
- Possibly modify: `src/demos/instruments/neon-demo.tsx` (fixes), `neon-demo.html` (og tags already point at the image)

- [ ] **Step 1: Full audio verification (fresh load, real clicks)**

Per repo CLAUDE.md browser-verification rules (visible window — check
`document.visibilityState` before diagnosing freezes):

1. Fresh load of `https://localhost:<port>/neon-demo.html`; inject the
   `AudioNode.prototype.connect` analyser tap immediately after navigation.
2. REAL click on a piano key → RMS > 0 over ~1s (init tone sounds).
3. For each of the 5 presets: apply (untrusted `.click()` is fine — AudioContext already
   running), hold a key, capture ~1s RMS + a coarse spectral snapshot; assert all 5
   non-silent and at least pairwise-distinct enough to confirm patches differ (exact
   thresholds judged manually).
4. Drop-zone test with a generated `.syx` file (from `CzSysex.encode` of a preset).
5. Mobile-width pass: per-element `scrollWidth > clientWidth` scan (repo rule).

- [ ] **Step 2: og-image**

1200×630 screenshot of the loaded demo (keyboard + envelope visible) →
`public/og-image-neon.png`. Verify `neon-demo.html` og/twitter image tags reference it.

- [ ] **Step 3: Final gates**

Run: `npx vitest run` (all pass, no worktrees inflating counts), `npx tsc --noEmit
--ignoreDeprecations "6.0"` (zero `src/` errors), `npm run build` (passes).

- [ ] **Step 4: Commit, push, PR**

```bash
git add public/og-image-neon.png neon-demo.html
git commit -m "feat: Neon demo og-image and final polish"
git push -u origin neon-demo
gh pr create --title "feat: Neon instrument demo — CZ-101 phase distortion explorer" --body "<summary per repo PR conventions>"
```

Then per repo rule: run the comprehensive PR review (`/pr-review-toolkit:review-pr`,
applicable aspects), fix Critical + Important findings, note them in a PR comment.
The spec + this plan file are deleted in this PR per the docs/superpowers lifecycle rule
(`git rm docs/superpowers/specs/2026-08-04-neon-instrument-demo-design.md
docs/superpowers/plans/2026-08-04-neon-instrument-demo.md` in the final commit), with
durable knowledge already graduated to `src/demos/instruments/CLAUDE.md`.
