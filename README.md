# OpenDAW Headless Demos

Interactive demos showcasing the OpenDAW SDK for building web-based audio applications.

## Quick Start

```bash
npm install
npm run dev
```

Visit http://localhost:5173 to explore the demos.

## Demos

- **Effects & Mixer** - Multi-track mixer with professional audio effects (reverb, compressor, delay, crusher, stereo width)
- **Recording API** - Real-time microphone recording with smooth 60fps live waveform visualization
- **Drum Scheduling** - Timeline-based drum pattern programming with visual playback
- **Drum Scheduling (AudioFit)** - Same pattern using AudioFit mode with `AutofitUtils.changeBpm()`

## Documentation

📚 **[Full Documentation](./documentation/README.md)** - Complete guides for building DAW interfaces with OpenDAW

Quick links:
- [Introduction](./documentation/01-introduction.md) - DAW concepts and system architecture
- [PPQN Fundamentals](./documentation/02-ppqn-fundamentals.md) - Understanding timing systems
- [AnimationFrame Guide](./documentation/03-animation-frame.md) ⚠️ **Required reading** - Observable updates
- [Box System](./documentation/04-box-system.md) - Data model and state management
- [Sample Management & Peaks](./documentation/05-sample-management-and-peaks.md) - Audio loading and waveform rendering
- [Timeline Rendering](./documentation/06-timeline-rendering.md) - Building timeline UI
- [Complete Example](./documentation/07-putting-it-together.md) - Full working application

## Deployment

**⚠️ Important:** OpenDAW requires `SharedArrayBuffer`, which needs these HTTP headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

### Recommended Free Hosting

All configuration files are included - just connect your repo:

- **[Cloudflare Pages](https://pages.cloudflare.com/)** ⭐ (Unlimited bandwidth)
- **[Netlify](https://www.netlify.com/)** (100 GB/month)
- **[Vercel](https://vercel.com/)** (100 GB/month)

**Build settings:**
- Build command: `npm run build`
- Output directory: `dist`

> **Note:** GitHub Pages does not support custom headers and cannot be used.

## Building for Production

```bash
npm run build     # Build to dist/
npm run preview   # Preview build locally
```

## Project Structure

```
src/
├── components/          # Reusable UI components
├── hooks/              # Custom React hooks for effects
├── lib/                # Shared utilities
│   ├── projectSetup.ts # OpenDAW initialization
│   └── audioUtils.ts   # Audio loading helpers
├── effects-demo.tsx    # Multi-track mixer demo
├── recording-api-react-demo.tsx  # Recording with live peaks
├── drum-scheduling-demo.tsx      # Drum pattern (NoSync mode)
└── drum-scheduling-autofit-demo.tsx  # Drum pattern (AudioFit mode)
```

## Key Learnings

### Recording API Simplification
The recording demo uses OpenDAW's high-level `Recording.start()` API which automatically:
- Creates Tape instrument and arms tracks
- Manages MediaStream lifecycle
- Creates AudioRegionBox and AudioFileBox
- Handles live peak generation with PeaksWriter

### Smooth Live Waveform Rendering (60fps)
For smooth progressive waveform rendering during recording:
```typescript
// During recording: Use dataIndex for smooth updates at 60fps
const isPeaksWriter = "dataIndex" in peaks;
const unitsToRender = isPeaksWriter
  ? peaks.dataIndex[0] * peaks.unitsEachPeak()  // Grows smoothly
  : peaks.numFrames;                              // Final render

PeaksPainter.renderBlocks(context, peaks, channel, {
  u0: 0,
  u1: unitsToRender  // Only render written data
});
```

**Why:** `peaks.numFrames` jumps in 0.5-second chunks, but `dataIndex[0]` updates every frame.

### Box Deletion
Use OpenDAW's high-level `box.delete()` API which automatically handles:
- Finding all dependencies
- Clearing pointer references
- Unstaging dependent boxes

```typescript
project.editing.modify(() => {
  region.delete();  // Handles all cleanup automatically
});
```

## License

See [LICENSE](LICENSE) for details.
