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
| **Effects & Mixer** | Multi-track mixer with reverb, compressor, delay, lo-fi crusher, and stereo width effects |
| **Track Editing** | Split, move, and rearrange audio regions on a timeline |
| **Recording API** | Microphone recording with live 60fps waveform, device selection, mono/stereo, input gain, and monitoring modes |
| **MIDI Recording** | Record MIDI notes with device/channel selection, on-screen piano keyboard, and step recording |
| **Loop Recording & Takes** | Record multiple takes over a loop region with per-take waveforms and mute controls |
| **Drum Pattern Scheduling** | Schedule drum samples across a timeline with visual playback |
| **Looping** | Timeline loop areas, adjustable boundaries, and real-time loop iteration tracking |
| **TimeBase Comparison** | Musical vs Seconds TimeBase and how regions behave with BPM changes |
| **Tempo Automation** | Preset tempo patterns (accelerando, ritardando, stepped) with real-time metronome response |
| **Time Signature Changes** | Preset signature sequences (waltz, prog rock, film score) with adaptive metronome |
| **Track Automation** | Volume, pan, and effect parameter automation with preset patterns and canvas visualization |
| **Clip Looping** | Set loop regions within audio clips and extend to tile automatically with waveform visualization |
| **Clip Fades** | Logarithmic, linear, and exponential fade curves with visual representations |
| **Mixer Groups** | Sub-mixing with group buses: Track → Group → Master signal flow |
| **Comp Lanes** | Comp between simulated takes using volume automation crossfades with configurable duration |
| **Werkstatt** | Write custom audio effects in JavaScript with pre-built examples and runnable code |
| **Audio Export** | Export audio with range selection, metronome control, and offline rendering |

## Documentation

**[Full Documentation](./documentation/README.md)** — Guides for building DAW interfaces with OpenDAW:

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
    │   ├── timebase-demo.tsx          # Musical vs Seconds TimeBase
    │   └── track-editing-demo.tsx     # Region split/move editing
    ├── recording/                     # Recording demos
    │   ├── recording-api-react-demo.tsx   # Audio recording with live peaks
    │   └── loop-recording-demo.tsx    # Loop recording with takes
    ├── midi/                          # MIDI demos
    │   └── midi-recording-demo.tsx    # MIDI recording + step recording
    ├── automation/                    # Automation demos
    │   ├── track-automation-demo.tsx  # Volume/pan/effect automation
    │   ├── tempo-automation-demo.tsx  # Tempo automation patterns
    │   └── time-signature-demo.tsx    # Time signature changes
    ├── effects/                       # Effects demos
    │   ├── effects-demo.tsx           # Multi-track mixer with effects
    │   └── werkstatt-demo.tsx         # Custom scriptable audio effects
    └── export/                        # Export demos
        └── export-demo.tsx            # Audio export with range selection
```

## License

This project uses the [OpenDAW](https://github.com/andremichelle/openDAW) SDK. See OpenDAW for licensing details.
