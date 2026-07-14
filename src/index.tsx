import React from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container } from "@radix-ui/themes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { CONSOLE_STYLES } from "./lib/design/consoleTheme";

interface Demo {
  href: string;
  title: string;
  blurb: string;
}

interface Group {
  label: string;
  /** Category accent — a --mc-* token; drives the group label and the cards' chips. */
  color: string;
  demos: Demo[];
}

const GROUPS: Group[] = [
  {
    label: "Playback & Timeline",
    color: "var(--mc-amber)",
    demos: [
      {
        href: "/looping-demo.html",
        title: "Looping Capabilities",
        blurb:
          "Control timeline loop areas, enable/disable looping, adjust loop boundaries, and watch loop iterations in real time.",
      },
      {
        href: "/clip-looping-demo.html",
        title: "Clip Looping",
        blurb:
          "Set a loop region within an audio clip and extend it to tile automatically. Interactive controls for loop duration, offset, and region length with waveform visualization.",
      },
      {
        href: "/clip-fades-demo.html",
        title: "Clip Fades",
        blurb:
          "Explore audio clip fade types — logarithmic, linear, and exponential curves. See visual curve representations and hear how each fade sounds.",
      },
      {
        href: "/timebase-demo.html",
        title: "TimeBase Comparison",
        blurb:
          "Musical vs Seconds TimeBase. See how Musical regions change duration with BPM while Seconds regions stay constant, and which to use when.",
      },
      {
        href: "/track-editing-demo.html",
        title: "Track Editing",
        blurb:
          "Interactive audio region editing with Dark Ride stems. Split regions at the playhead, move regions around the timeline, and experiment with non-destructive edits.",
      },
      {
        href: "/drum-scheduling-demo.html",
        title: "Drum Pattern Scheduling",
        blurb:
          "Schedule drum samples across a timeline to build rhythmic patterns, with a visual timeline of clips and a playhead that tracks playback.",
      },
    ],
  },
  {
    label: "Mixing & Effects",
    color: "var(--mc-cyan)",
    demos: [
      {
        href: "/effects-demo.html",
        title: "Effects & Mixer",
        blurb:
          "Multi-track mixer with professional audio effects, waveforms, volume faders, pan, and mute/solo. Reverb, Compressor, Delay, Lo-Fi Crusher, Stereo Width, and more.",
      },
      {
        href: "/mixer-groups-demo.html",
        title: "Mixer Groups",
        blurb:
          "Route tracks through group buses for sub-mixing. Rhythm and Melodic groups with independent volume, mute, and solo show the Track → Group → Master signal flow.",
      },
      {
        href: "/werkstatt-demo.html",
        title: "Werkstatt",
        blurb:
          "Write custom audio effects in JavaScript. Browse pre-built effects (tremolo, ring mod, filter, chorus, phaser) or explore the Werkstatt API with runnable examples.",
      },
      {
        href: "/apparat-demo.html",
        title: "Apparat",
        blurb:
          "Write custom polyphonic instruments in JavaScript. Hot-swap synth engines (sine, supersaw, FM bell, Karplus pluck) over a looping chord pattern and play live on an on-screen keyboard.",
      },
      {
        href: "/comp-lanes-demo.html",
        title: "Comp Lanes",
        blurb:
          "Comp between simulated takes using volume-automation crossfades. Select which take is active per zone with seamless crossfade transitions.",
      },
    ],
  },
  {
    label: "Tempo & Automation",
    color: "var(--mc-green)",
    demos: [
      {
        href: "/tempo-automation-demo.html",
        title: "Tempo Automation",
        blurb:
          "Apply preset tempo patterns (accelerando, ritardando, stepped changes) and hear the metronome and drum loop respond to tempo changes in real time.",
      },
      {
        href: "/time-signature-demo.html",
        title: "Time Signature Changes",
        blurb:
          "Apply preset time-signature sequences (standard to waltz, prog rock, film score) and hear the metronome adapt to changing meters in real time.",
      },
      {
        href: "/track-automation-demo.html",
        title: "Track Automation",
        blurb:
          "Automate volume, pan, and effect parameters with preset patterns. Visualize automation envelopes and see the JSON a server would store to save and restore state.",
      },
    ],
  },
  {
    label: "Recording & MIDI",
    color: "var(--mc-rose)",
    demos: [
      {
        href: "/recording-api-react-demo.html",
        title: "Recording API",
        blurb:
          "Record audio from your microphone using OpenDAW's Recording API. Uses React with useRef to efficiently store the tape unit reference.",
      },
      {
        href: "/loop-recording-demo.html",
        title: "Loop Recording & Takes",
        blurb:
          "Record multiple takes over a loop region. Each loop iteration creates a new take with independent waveforms. Compare and manage takes with mute controls.",
      },
      {
        href: "/midi-recording-demo.html",
        title: "MIDI Recording",
        blurb:
          "Record MIDI notes with device selection, channel filtering, an on-screen piano keyboard, and step-recording mode for precise note-by-note entry.",
      },
    ],
  },
  {
    label: "Warp & Pitch",
    color: "var(--mc-violet)",
    demos: [
      {
        href: "/warp-demos.html",
        title: "Warp: Who Bends?",
        blurb:
          "Three ways to reconcile a song's beat map with the project grid — varispeed, set tempo from clip, and time-stretch — with the DAW features they correspond to.",
      },
      {
        href: "/time-pitch-demo.html",
        title: "Time & Pitch",
        blurb:
          "Switch a region between NoStretch, PitchStretch (varispeed), and TimeStretch (transient-aware) play modes. Pitch-shift up to ±1 octave in cents.",
      },
    ],
  },
  {
    label: "Export",
    color: "var(--mc-slate)",
    demos: [
      {
        href: "/export-demo.html",
        title: "Audio Export",
        blurb:
          "Export audio with range selection and metronome control. Render metronome-only, clean stems, or stem + metronome mixes for any bar range using offline rendering.",
      },
    ],
  },
  {
    label: "Engine",
    color: "var(--mc-violet)",
    demos: [
      {
        href: "/wasm-engine-demo.html",
        title: "WASM Engine A/B",
        blurb:
          "Toggle OpenDAW's audio backend between the built-in TypeScript engine and the WASM (Rust) engine live during playback, with an opt-in DSP-load readout.",
      },
    ],
  },
];

const App: React.FC = () => {
  let index = 0;
  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <GitHubCorner />
      <Container size="4" px="4" py="8">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Header */}
          <header className="mc-reveal">
            <div className="mc-kicker">OpenDAW &middot; Headless SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(34px, 6vw, 60px)" }}>
              OpenDAW Demos
            </h1>
            <p className="mc-intro">
              Worked examples of the OpenDAW headless audio engine &mdash; playback, recording,
              automation, effects, warping, and export. Each is a self-contained page you can read
              and run.{" "}
              <a
                href="/docs/"
                style={{ color: "var(--mc-amber)", textDecoration: "none", borderBottom: "1px solid var(--mc-amber)" }}
              >
                Read the Handbook &rarr;
              </a>
            </p>
          </header>

          {/* Category groups */}
          {GROUPS.map((group, gi) => (
            <section
              key={group.label}
              className="mc-group mc-reveal"
              style={{ ["--mc-cat" as string]: group.color, animationDelay: `${(gi + 1) * 70}ms` }}
            >
              <h2 className="mc-group-head">
                <span>{group.label}</span>
                <span className="mc-group-rule" />
                <span className="mc-group-count">{String(group.demos.length).padStart(2, "0")}</span>
              </h2>
              <div className="mc-cards">
                {group.demos.map((demo) => {
                  index += 1;
                  return (
                    <a key={demo.href} className="mc-panel" href={demo.href}>
                      <div className="mc-panel-head">
                        <span className="mc-chip" aria-hidden="true" />
                        <span className="mc-index">{String(index).padStart(2, "0")}</span>
                        <h3 className="mc-name">{demo.title}</h3>
                      </div>
                      <p className="mc-prose">{demo.blurb}</p>
                      <span className="mc-open">
                        Open <span className="mc-arrow">&rarr;</span>
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          ))}

          <MoisesLogo />
        </div>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
