# Quick Start

> **Audience:** new to OpenDAW. Goal: get sound out of your speakers in five minutes.
>
> **What you'll do:** spin up a React app, create an OpenDAW project, load one audio sample, press play. After that you'll have running audio you can poke at while you read the rest of the handbook.

OpenDAW is a *headless* DAW — it owns the audio engine, the data model, and the timing; you own the UI. This Quick Start shows the minimum code to get the engine running so you have something to attach a UI to.

## Prerequisites

- Node ≥ 20, npm or pnpm.
- A modern browser (see [Ch. 12 — Browser Compatibility](./12-browser-compatibility.md) — Chrome / Edge / Firefox / Safari all work, but Safari has a couple of quirks).
- An HTTP server that sends the right cross-origin isolation headers (any Vite or webpack dev server will do; we cover the headers themselves in Ch. 12).

## Install

```bash
npm install @opendaw/studio-sdk react react-dom
```

`@opendaw/studio-sdk` is a meta-package that pulls in everything else (`studio-core`, `studio-adapters`, `studio-boxes`, `studio-enums`, plus the `lib-*` foundations). One install line is all you need.

## The setup boilerplate

OpenDAW needs four browser-level pieces wired up before you can use it: an `AudioContext`, a Web Worker, an `AudioWorklet` module, and an `AnimationFrame` driver (see [Ch. 03](./03-animation-frame.md) for why). All of that is mechanical, so the demos in this repo wrap it in a single helper called `initializeOpenDAW()`.

The helper lives at [`src/lib/projectSetup.ts`](https://github.com/naomiaro/opendaw-test/blob/main/src/lib/projectSetup.ts) — about 120 lines of plumbing you can copy verbatim into your own project. If you want to understand what it does, read [Ch. 00 — System Architecture](./00-system-architecture.md) first; otherwise treat it as a black box.

```typescript
// What initializeOpenDAW() does for you:
//   1. AnimationFrame.start(window)
//   2. Workers.install(WorkersUrl)
//   3. new AudioContext({sampleRate: 48000})
//   4. audioContext.audioWorklet.addModule(WorkletsUrl)
//   5. GlobalSampleLoaderManager + GlobalSoundfontLoaderManager
//   6. new Project(...) returning { project, audioContext }
```

## Hello, OpenDAW

A complete, runnable React component that:

1. Initialises the engine.
2. Loads a short audio file from a URL.
3. Creates a Tape (audio) track and drops the sample on it.
4. Renders a Play button.

```tsx
import { useEffect, useRef, useState } from "react";
import { UUID } from "@opendaw/lib-std";
import { PPQN, AudioData } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import {
  AudioFileBox,
  AudioRegionBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";

// Your own helper, copied from src/lib/projectSetup.ts in this repo.
import { initializeOpenDAW } from "./projectSetup";
import { loadAudioFile } from "./audioUtils";

const SAMPLE_URL = "/samples/kick.wav";

export function HelloOpenDAW() {
  const [project, setProject] = useState<Project | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const localAudioBuffers = useRef(new Map<string, AudioBuffer>()).current;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Boot the engine.
      const { project, audioContext } = await initializeOpenDAW({ localAudioBuffers });
      if (cancelled) return;

      // 2. Load one audio file into a browser AudioBuffer.
      const buffer = await loadAudioFile(audioContext, SAMPLE_URL);

      // 3. Create a Tape track with this sample on it. Everything happens
      //    inside one transaction so undo/redo treats it as one step.
      project.editing.modify(() => {
        const fileUUID = UUID.generate();
        localAudioBuffers.set(UUID.toString(fileUUID), buffer);

        const audioFileBox = AudioFileBox.create(project.boxGraph, fileUUID, (box) => {
          box.fileName.setValue("kick.wav");
          box.endInSeconds.setValue(buffer.duration);
        });

        const { trackBox } = project.api.createInstrument(InstrumentFactories.Tape);

        const eventsBox = ValueEventCollectionBox.create(
          project.boxGraph,
          UUID.generate(),
        );

        const clipDuration = PPQN.secondsToPulses(buffer.duration, 120);
        AudioRegionBox.create(project.boxGraph, UUID.generate(), (box) => {
          box.regions.refer(trackBox.regions);
          box.file.refer(audioFileBox);
          box.events.refer(eventsBox.owners);
          box.position.setValue(0);
          box.duration.setValue(clipDuration);
          box.loopDuration.setValue(clipDuration);
        });
      });

      // 4. Subscribe to engine state so the UI knows when audio is playing.
      project.engine.isPlaying.subscribe((obs) => setIsPlaying(obs.getValue()));

      setProject(project);
    })();

    return () => {
      cancelled = true;
    };
  }, [localAudioBuffers]);

  if (!project) return <div>Loading engine…</div>;

  return (
    <button
      onClick={() => (isPlaying ? project.engine.stop() : project.engine.play())}
    >
      {isPlaying ? "Stop" : "Play"}
    </button>
  );
}
```

Click the button — you should hear the sample loop at 120 BPM.

## What just happened?

Walking the code top to bottom:

- **`initializeOpenDAW`** is the helper that sets up `AnimationFrame`, the worker, the worklet, and the `AudioContext`. Everything past that point assumes those four are running.
- **`loadAudioFile`** is `fetch` + `AudioContext.decodeAudioData`. The result is a plain Web Audio `AudioBuffer`. The `localAudioBuffers` map lets OpenDAW find it by UUID when the audio thread asks for it (see [Ch. 05 — Samples, Peaks & Looping](./05-samples-peaks-and-looping.md)).
- **`project.editing.modify(...)`** opens a transaction on the box graph. Everything inside the callback is one undo step. See [Ch. 04](./04-box-system-and-reactivity.md) for the box-system fundamentals.
- **`AudioFileBox`** is the on-disk-stable handle for the audio file. **`AudioRegionBox`** is the clip on the track that *points at* the file. **`Tape`** is one of the built-in instrument types — it just plays the audio file directly without synthesis.
- **`PPQN.secondsToPulses(duration, 120)`** converts the file's real-world duration into musical time at 120 BPM. We set `duration` and `loopDuration` to the same value so the clip repeats end-to-end. See [Ch. 02 — Timing & Tempo](./02-timing-and-tempo.md) for PPQN.
- **`project.engine.isPlaying`** is an `Observable<boolean>`. The subscription keeps your React state in sync with the engine; `AnimationFrame` polls the worklet under the hood (Ch. 03 again).

## What's next?

You now have a running engine, one audio track, and a play button. From here:

- **[Ch. 00 — System Architecture](./00-system-architecture.md)** — read this next; the diagrams explain what `initializeOpenDAW` is actually setting up and why.
- **[Ch. 02 — Timing & Tempo](./02-timing-and-tempo.md)** — PPQN, BPM, tempo automation. The single most important concept for placing things on the timeline.
- **[Ch. 04 — Box System & Reactivity](./04-box-system-and-reactivity.md)** — how `AudioFileBox` / `AudioRegionBox` and friends compose into a project. Once you're comfortable with the box graph, the rest of the SDK clicks into place.
- **[Ch. 06 — Timeline & Rendering](./06-timeline-and-rendering.md)** — when you're ready to draw the clip and a playhead on a canvas.
- **[Ch. 07 — Building a Complete App](./07-building-a-complete-app.md)** — the full walkthrough that ends with a working mini-DAW: timeline, transport, mixer, the works. Roughly 1,000 lines of code, fully explained.
- **[Demos](https://opendaw-test.pages.dev/)** — every concept covered in the handbook has a runnable example. Browse for ideas.

If your Quick Start doesn't make sound, the most common causes are:

- The page isn't served over HTTPS with the right headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). See [Ch. 12 — Browser Compatibility](./12-browser-compatibility.md).
- The `AudioContext` is suspended waiting for a user gesture — the Play button click resumes it on most browsers, but the very first click may need a `audioContext.resume()` before `project.engine.play()`.
- The sample hasn't finished loading yet — call `await project.engine.queryLoadingComplete()` before `play()` if you want deterministic behaviour.
