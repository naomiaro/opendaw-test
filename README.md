# OpenDAW Headless Demos

Interactive demos showcasing the [OpenDAW](https://github.com/andremichelle/openDAW) SDK for building web-based audio applications.

## Quick Start

```bash
npm install
npm run dev
```

Visit http://localhost:5173 to explore the demos.

## Demos

| Demo | Description |
|------|-------------|
| **[Effects & Mixer](https://opendaw-test.pages.dev/effects-demo.html)** | Multi-track mixer with reverb, compressor, delay, lo-fi crusher, and stereo width effects |
| **[Track Editing](https://opendaw-test.pages.dev/track-editing-demo.html)** | Split, move, and rearrange audio regions on a timeline |
| **[Recording API](https://opendaw-test.pages.dev/recording-api-react-demo.html)** | Microphone recording with live 60fps waveform, device selection, mono/stereo, input gain, and monitoring modes |
| **[MIDI Recording](https://opendaw-test.pages.dev/midi-recording-demo.html)** | Record MIDI notes with device/channel selection, on-screen piano keyboard, and step recording |
| **[Neon: CZ-101 Phase Distortion](https://opendaw-test.pages.dev/neon-demo.html)** | Play OpenDAW's Casio CZ-101 phase-distortion synth — five original patches round-tripped through real `.syx` bytes, a sysex drop zone, live wave/modulation controls, and an 8-stage envelope visualizer |
| **[Cubed: 303-Style Acid Bassline](https://opendaw-test.pages.dev/cubed-demo.html)** | Program Cubed's built-in step sequencer live — notes, gates, slides and accents on a 64-step grid, a random pattern generator, JSON and ABL `.pat` pattern exchange, and a synced LFO sweeping the filter |
| **[Loop Recording & Takes](https://opendaw-test.pages.dev/loop-recording-demo.html)** | Record multiple takes over a loop region with per-take waveforms and mute controls |
| **[Quick Swipe Comping](https://opendaw-test.pages.dev/swipe-comping-demo.html)** | Loop-record takes on a single tape, then swipe across take lanes to splice a comp — Logic-style comping with transparent engine crossfades at every seam, undo per swipe |
| **[Drum Pattern Scheduling](https://opendaw-test.pages.dev/drum-scheduling-demo.html)** | Schedule drum samples across a timeline with visual playback |
| **[Looping](https://opendaw-test.pages.dev/looping-demo.html)** | Timeline loop areas, adjustable boundaries, and real-time loop iteration tracking |
| **[TimeBase Comparison](https://opendaw-test.pages.dev/timebase-demo.html)** | Musical vs Seconds TimeBase and how regions behave with BPM changes |
| **[Tempo Automation](https://opendaw-test.pages.dev/tempo-automation-demo.html)** | Preset tempo patterns (accelerando, ritardando, stepped) with real-time metronome response |
| **[Time Signature Changes](https://opendaw-test.pages.dev/time-signature-demo.html)** | Preset signature sequences (waltz, prog rock, film score) with adaptive metronome |
| **[BPM Detect](https://opendaw-test.pages.dev/bpm-detect-demo.html)** | WASM tempo detection: analyze bundled loops or your own file, get one global BPM (or an honest "no tempo" for pads and speech), then verify the result by ear against the metronome |
| **[Track Automation](https://opendaw-test.pages.dev/track-automation-demo.html)** | Volume, pan, and effect parameter automation with preset patterns and canvas visualization |
| **[Live Automation Recording](https://opendaw-test.pages.dev/live-automation-recording-demo.html)** | Perform volume, pan and delay-wet moves while the transport records — the SDK's latch model captures every write into value regions, simplifies the curve, and lets you overdub across loop wraps or override playback by hand |
| **[Clip Looping](https://opendaw-test.pages.dev/clip-looping-demo.html)** | Set loop regions within audio clips and extend to tile automatically with waveform visualization |
| **[Clip Fades](https://opendaw-test.pages.dev/clip-fades-demo.html)** | Logarithmic, linear, and exponential fade curves with visual representations |
| **[Jam to Arrangement](https://opendaw-test.pages.dev/jam-arrangement-demo.html)** | Jam with a clip launcher — launch-quantized, looping audio clips on four Dark Ride stems — then commit the combos you like to a region timeline and play the arrangement back linearly |
| **[Warp: Who Bends?](https://opendaw-test.pages.dev/warp-demos.html)** | Four ways to reconcile a song's beat map with the project grid, each with its own sub-demo: varispeed, grid-follows-file, transient-aware time-stretch, and Signalsmith spectral stretch with ±24 st live transpose |
| **[Time & Pitch](https://opendaw-test.pages.dev/time-pitch-demo.html)** | Switch a region between NoStretch / PitchStretch / TimeStretch / Signalsmith, retune in cents (±1 octave transient-aware, ±2 octaves spectral), and adjust the project reference pitch (A4) with audible auto-engage |
| **[Mixer Groups](https://opendaw-test.pages.dev/mixer-groups-demo.html)** | Sub-mixing with group buses: Track → Group → Master signal flow |
| **[Comp Lanes](https://opendaw-test.pages.dev/comp-lanes-demo.html)** | Comp between simulated takes using volume automation crossfades with configurable duration |
| **[Convolver](https://opendaw-test.pages.dev/convolver-demo.html)** | Convolution reverb on the WASM engine: six synthesized impulse responses (hall, plate, gated, reverse…), drag-and-drop your own IR, and wet/dry/pre-delay controls with seamless IR swaps |
| **[Werkstatt](https://opendaw-test.pages.dev/werkstatt-demo.html)** | Write custom audio effects in JavaScript with pre-built examples and runnable code |
| **[Apparat](https://opendaw-test.pages.dev/apparat-demo.html)** | Write custom polyphonic instruments in JavaScript — hot-swap synth engines (sine, supersaw, FM bell, Karplus pluck) over a looping chord pattern and play live |
| **[WASM Engine](https://opendaw-test.pages.dev/wasm-engine-demo.html)** | A Vaporisateur synth loop playing through the WASM (Rust) audio engine — the only engine these demos run — with an opt-in DSP-load readout |
| **[Modulators](https://opendaw-test.pages.dev/modulation-demo.html)** | The project-global modulation system: LFO, step-sequencer, random and macro modulators wobbling a synth's cutoff, volume and panning — with live scopes that keep moving while the transport is paused |
| **[Audio Export](https://opendaw-test.pages.dev/export-demo.html)** | Export audio with range selection, metronome control, and offline rendering |

## Documentation

**[Full Documentation](./documentation/README.md)** — Guides for building DAW interfaces with OpenDAW.

To run the documentation site locally with live reload:

```bash
npm run docs:dev      # serves at http://localhost:5173/docs/
npm run docs:build    # static build to dist/docs/
npm run docs:preview  # preview the static build
```

The chapter list below links to the rendered markdown on GitHub:

- [Quick Start](./documentation/quick-start.md) — fastest path from `npm install` to a playing project
- [System Architecture](./documentation/00-system-architecture.md) — thread model, package layout, render pipeline

**Core handbook**

- [Introduction](./documentation/01-introduction.md) — DAW concepts and system architecture
- [Timing & Tempo](./documentation/02-timing-and-tempo.md) — PPQN, tempo automation, time signatures
- [AnimationFrame](./documentation/03-animation-frame.md) — Observable updates
- [Box System & Reactivity](./documentation/04-box-system-and-reactivity.md) — Data model, subscriptions, reactive lifecycle
- [Samples, Peaks & Looping](./documentation/05-samples-peaks-and-looping.md) — Audio loading, waveforms, region looping
- [Timeline & Rendering](./documentation/06-timeline-and-rendering.md) — Building timeline UI
- [Building a Complete App](./documentation/07-building-a-complete-app.md) — Full working application, mixer groups
- [Recording](./documentation/08-recording.md) — Audio/MIDI recording, takes, monitoring, live peaks
- [Editing, Fades & Automation](./documentation/09-editing-fades-and-automation.md) — Region editing, clip fades, track automation, comp lanes
- [Export & Offline Rendering](./documentation/10-export.md) — Mix and stems export, offline rendering
- [Effects](./documentation/11-effects.md) — Effect types, creation, track/master integration

**Feature guides**

- [MIDI Deep Dive](./documentation/16-midi.md) — Notes, hardware input, MIDI effects, synth tuning
- [Modular Devices](./documentation/17-modular-devices.md) — Apparat, Vaporisateur, Playfield, Werkstatt
- [Apparat (Scriptable Instrument)](./documentation/20-apparat.md) — the Processor contract, voices, live MIDI, compile/hot-swap
- [Time & Pitch](./documentation/18-time-and-pitch.md) — NoStretch / PitchStretch / TimeStretch, transients, concert pitch
- [Swappable Audio Engine (WASM)](./documentation/19-wasm-engine.md) — running the Rust/WASM engine, engine variants, offline renders

**Appendix**

- [Browser Compatibility](./documentation/12-browser-compatibility.md) — Supported browsers, headers, SharedArrayBuffer
- [Troubleshooting & FAQ](./documentation/13-troubleshooting.md) — Common errors and fixes
- [Glossary](./documentation/14-glossary.md) — SDK and DAW terminology
- [Performance & Debugging](./documentation/15-performance-and-debugging.md) — Profiling, AnimationFrame patterns, leak hunting

For the SDK-internals series (contributors), see [`documentation/internals/`](./documentation/internals/).

## Deployment

OpenDAW requires `SharedArrayBuffer`, which needs these HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Configuration files for Cloudflare Pages, Netlify, and Vercel are included.

> **Note:** GitHub Pages does not support custom headers and cannot be used.

```bash
npm run build     # Build to dist/
npm run preview   # Preview build locally
```

## Project Structure

```
src/
├── components/                        # Reusable UI components
├── hooks/                             # Custom React hooks
├── lib/
│   ├── projectSetup.ts                # OpenDAW initialization
│   ├── trackLoading.ts                # Track loading with queryLoadingComplete
│   ├── groupTrackLoading.ts           # Group bus creation + track routing
│   ├── audioUtils.ts                  # Format detection, file loading
│   └── CanvasPainter.ts              # Canvas rendering helper
└── demos/
    ├── playback/                      # Playback, editing, and mixing demos
    │   ├── comp-lanes-demo.tsx        # Take comping with volume automation crossfades
    │   ├── clip-fades-demo.tsx        # Fade curve types
    │   ├── clip-looping-demo.tsx      # Region loop tiling
    │   ├── drum-scheduling-demo.tsx   # Drum pattern scheduling
    │   ├── looping-demo.tsx           # Loop area controls
    │   ├── mixer-groups-demo.tsx      # Group bus sub-mixing
    │   ├── time-pitch-demo.tsx        # Play modes, cents, project reference pitch
    │   ├── timebase-demo.tsx          # Musical vs Seconds TimeBase
    │   └── track-editing-demo.tsx     # Region split/move editing
    ├── recording/                     # Recording demos
    │   ├── recording-api-react-demo.tsx   # Audio recording with live peaks
    │   ├── loop-recording-demo.tsx    # Loop recording with takes
    │   ├── swipe-comping-demo.tsx     # Quick Swipe Comping
    │   └── SwipeCompLanes.tsx         # Swipe comp lane component
    ├── midi/                          # MIDI demos
    │   └── midi-recording-demo.tsx    # MIDI recording + step recording
    ├── instruments/                   # Stock instrument demos
    │   ├── neon-demo.tsx              # Neon (CZ-101 phase distortion) + .syx presets
    │   ├── cubed-demo.tsx             # Cubed (303-style acid bassline) step sequencer
    │   └── cubedPatterns.ts           # Hand-authored acid pattern + sound presets
    ├── clips/                         # Clip launcher demos
    │   └── jam-arrangement-demo.tsx   # Clip jamming → committed region arrangement
    ├── automation/                    # Automation demos
    │   ├── track-automation-demo.tsx  # Volume/pan/effect automation
    │   ├── live-automation-recording-demo.tsx  # Latch-model automation recording
    │   ├── tempo-automation-demo.tsx  # Tempo automation patterns
    │   └── time-signature-demo.tsx    # Time signature changes
    ├── analysis/                      # Audio analysis demos
    │   └── bpm-detect-demo.tsx        # WASM tempo detection with metronome verification
    ├── effects/                       # Effects demos
    │   ├── effects-demo.tsx           # Multi-track mixer with effects
    │   ├── convolver-demo.tsx         # Convolution reverb with synthesized IR gallery
    │   ├── convolverContent.ts        # Bus + tracks + Convolver insert + IR swap logic
    │   ├── werkstatt-demo.tsx         # Custom scriptable audio effects
    │   └── apparat-demo.tsx           # Custom scriptable instruments
    ├── warp/                          # Beat-map warping demos
    │   ├── warp-overview.tsx          # Who Bends? — the four conform strategies
    │   ├── warp-varispeed-demo.tsx    # File → grid, pitch follows rate
    │   ├── warp-grid-follows-file-demo.tsx  # Grid → file tempo conform
    │   ├── warp-timestretch-demo.tsx  # Raw / varispeed / time-stretch / signalsmith A/B
    │   ├── warp-signalsmith-demo.tsx  # Spectral conform with live ±24 st transpose
    │   └── lib/                       # Shared setup, scenario builders, waveform
    ├── engine/                        # Engine demos
    │   └── wasm-engine-demo.tsx       # WASM (Rust) engine — the only engine — with DSP-load readout
    ├── modulation/                    # Modulation demos
    │   ├── modulation-demo.tsx        # LFO / Steps / Random / Macro modulators with live scopes
    │   └── modulationContent.ts       # Synth loop + modulator/assignment builder
    └── export/                        # Export demos
        └── export-demo.tsx            # Audio export with range selection
```

## License

This project uses the [OpenDAW](https://github.com/andremichelle/openDAW) SDK. See OpenDAW for licensing details.
