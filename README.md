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

## Documentation

**[Full Documentation](./documentation/README.md)** — Guides for building DAW interfaces with OpenDAW:

- [Introduction](./documentation/01-introduction.md) — DAW concepts and system architecture
- [PPQN Fundamentals](./documentation/02-ppqn-fundamentals.md) — Timing systems
- [AnimationFrame](./documentation/03-animation-frame.md) — Observable updates (**required reading**)
- [Box System](./documentation/04-box-system.md) — Data model and state management
- [Sample Management & Peaks](./documentation/05-sample-management-and-peaks.md) — Audio loading and waveforms
- [Timeline Rendering](./documentation/06-timeline-rendering.md) — Building timeline UI
- [Complete Example](./documentation/07-putting-it-together.md) — Full working application
- [Recording Guide](./documentation/08-recording-and-live-peaks.md) — Audio/MIDI recording, takes, monitoring, live peaks
- [Track Editing & Fades](./documentation/09-track-editing-and-fades.md) — Region editing and fade support
- [Audio Export](./documentation/audio-export.md) — Mix and stems export
- [Tempo Automation](./documentation/14-tempo-automation.md) — Variable BPM playback
- [Time Signature Changes](./documentation/15-time-signature-changes.md) — Signature events
- [Track Automation](./documentation/19-track-automation.md) — Volume, pan, and effect automation
- [Clip Looping](./documentation/20-clip-looping.md) — Region looping and tiling
- [Mixer Groups](./documentation/17-mixer-groups.md) — Sub-mixing and track routing

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
├── effects-demo.tsx                   # Multi-track mixer with effects
├── track-editing-demo.tsx             # Region split/move editing
├── recording-api-react-demo.tsx       # Audio recording with live peaks
├── midi-recording-demo.tsx            # MIDI recording + step recording
├── loop-recording-demo.tsx            # Loop recording with takes
├── drum-scheduling-demo.tsx           # Drum pattern scheduling
├── looping-demo.tsx                   # Loop area controls
├── timebase-demo.tsx                  # Musical vs Seconds TimeBase
├── tempo-automation-demo.tsx          # Tempo automation patterns
├── time-signature-demo.tsx            # Time signature changes
├── track-automation-demo.tsx           # Volume/pan/effect automation
├── clip-looping-demo.tsx              # Region loop tiling
├── clip-fades-demo.tsx                # Fade curve types
└── mixer-groups-demo.tsx              # Group bus sub-mixing
```

## License

This project uses the [OpenDAW](https://github.com/andremichelle/openDAW) SDK. See OpenDAW for licensing details.
