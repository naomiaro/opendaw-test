import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Button, Callout, Code } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Project } from "@opendaw/studio-core";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { CONSOLE_STYLES, CANVAS_COLORS, CANVAS_FONT, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";

// 4/4 time: one bar = 3840 PPQN
const BAR = PPQN.fromSignature(4, 4); // 3840
const NUM_BARS = 8;
const TOTAL_PPQN = BAR * NUM_BARS; // 30720

type TempoPoint = {
  position: ppqn;
  bpm: number;
  interpolation: "step" | "linear" | { curve: number }; // curve: slope 0-1 (0.5=linear, <0.5=slow start, >0.5=fast start)
};

type TempoPattern = {
  name: string;
  description: string;
  points: TempoPoint[];
};

const PATTERNS: TempoPattern[] = [
  {
    name: "Accelerando",
    description: "Gradual speed up from 100 to 160 BPM",
    points: [
      { position: 0 as ppqn, bpm: 100, interpolation: "linear" },
      { position: (BAR * 8) as ppqn, bpm: 160, interpolation: "linear" },
    ],
  },
  {
    name: "Ritardando",
    description: "Gradual slow down from 140 to 80 BPM",
    points: [
      { position: 0 as ppqn, bpm: 140, interpolation: "linear" },
      { position: (BAR * 8) as ppqn, bpm: 80, interpolation: "linear" },
    ],
  },
  {
    name: "Stepped",
    description: "Discrete BPM jumps every 2 bars",
    points: [
      { position: 0 as ppqn, bpm: 120, interpolation: "step" },
      { position: (BAR * 2) as ppqn, bpm: 140, interpolation: "step" },
      { position: (BAR * 4) as ppqn, bpm: 100, interpolation: "step" },
      { position: (BAR * 6) as ppqn, bpm: 160, interpolation: "step" },
    ],
  },
  {
    name: "Ramp & Return",
    description: "Speed up to 180 BPM at bar 4, back to 100",
    points: [
      { position: 0 as ppqn, bpm: 100, interpolation: "linear" },
      { position: (BAR * 4) as ppqn, bpm: 180, interpolation: "linear" },
      { position: (BAR * 8) as ppqn, bpm: 100, interpolation: "linear" },
    ],
  },
  {
    name: "Logarithmic Accel.",
    description: "Fast initial pickup that eases into final tempo (curve 0.75)",
    points: [
      { position: 0 as ppqn, bpm: 90, interpolation: { curve: 0.75 } },
      { position: (BAR * 8) as ppqn, bpm: 160, interpolation: "step" },
    ],
  },
  {
    name: "Exponential Rit.",
    description: "Holds tempo then drops off steeply at the end (curve 0.25)",
    points: [
      { position: 0 as ppqn, bpm: 150, interpolation: { curve: 0.25 } },
      { position: (BAR * 8) as ppqn, bpm: 80, interpolation: "step" },
    ],
  },
  {
    name: "Breath (Swell)",
    description: "Logarithmic rise to bar 4, exponential fall — like a natural breath",
    points: [
      { position: 0 as ppqn, bpm: 100, interpolation: { curve: 0.75 } },
      { position: (BAR * 4) as ppqn, bpm: 160, interpolation: { curve: 0.25 } },
      { position: (BAR * 8) as ppqn, bpm: 100, interpolation: "step" },
    ],
  },
];

function applyPattern(project: Project, pattern: TempoPattern): void {
  project.editing.modify(() => {
    const adapter = project.timelineBoxAdapter;

    // Clear existing tempo events
    adapter.tempoTrackEvents.ifSome(collection => {
      collection.events.asArray().forEach(event => event.box.delete());
    });

    // Create new events
    adapter.tempoTrackEvents.ifSome(collection => {
      for (const point of pattern.points) {
        let interpolation;
        if (point.interpolation === "linear") {
          interpolation = Interpolation.Linear;
        } else if (point.interpolation === "step") {
          interpolation = Interpolation.None;
        } else {
          interpolation = Interpolation.Curve(point.interpolation.curve);
        }
        collection.createEvent({
          position: point.position,
          index: 0,
          value: point.bpm,
          interpolation,
        });
      }
    });

    // Set timeline duration and loop area
    project.timelineBox.durationInPulses.setValue(TOTAL_PPQN);
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(TOTAL_PPQN);
    project.timelineBox.loopArea.enabled.setValue(true);
  });
}

const CANVAS_HEIGHT = 150;
const BPM_MIN = 60;
const BPM_MAX = 200;

// Canvas semantic aliases — bar lines sit under the drawn tempo curve (supporting tier);
// BPM grid lines are tertiary texture below the curve. Both from CANVAS_COLORS.
const CANVAS_BG = CANVAS_COLORS.bg;
const CANVAS_BAR_LINE = CANVAS_COLORS.gridSupporting; // --mc-line-bright (supporting grid)
const CANVAS_BPM_LINE = CANVAS_COLORS.gridTertiary;   // --mc-line (tertiary y-axis texture)
const CANVAS_LABEL = CANVAS_COLORS.label;
const CANVAS_CURVE = CANVAS_COLORS.amber;
const CANVAS_PLAYHEAD = CANVAS_COLORS.playhead;

interface TempoCanvasProps {
  pattern: TempoPattern;
  playheadPosition: ppqn;
  isPlaying: boolean;
}

const TempoCanvas: React.FC<TempoCanvasProps> = ({ pattern, playheadPosition, isPlaying }) => {
  const curveCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null);
  // Store per-frame values in refs so the AnimationFrame overlay reads live data
  // without the static curve effect re-running every frame.
  const playheadRef = useRef(playheadPosition);
  const isPlayingRef = useRef(isPlaying);
  playheadRef.current = playheadPosition;
  isPlayingRef.current = isPlaying;

  // Static curve rendering — re-runs only when the pattern changes
  useEffect(() => {
    const canvas = curveCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = CANVAS_HEIGHT;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, width, height);

    // Grid lines (bar lines) — use PPQN positions for consistency with engine timing
    const toX = (ppqnPos: number) => (ppqnPos / TOTAL_PPQN) * width;

    ctx.strokeStyle = CANVAS_BAR_LINE;
    ctx.lineWidth = 1;
    for (let bar = 0; bar <= NUM_BARS; bar++) {
      const x = toX(bar * BAR);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (bar < NUM_BARS) {
        ctx.fillStyle = CANVAS_LABEL;
        ctx.font = CANVAS_FONT;
        ctx.fillText(`${bar + 1}`, x + 4, height - 4);
      }
    }

    // BPM grid lines
    ctx.strokeStyle = CANVAS_BPM_LINE;
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 20) {
      const y = height - ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = CANVAS_LABEL;
      ctx.font = CANVAS_FONT_SMALL;
      ctx.textAlign = "right";
      ctx.fillText(`${bpm}`, width - 4, y - 2);
      ctx.textAlign = "left";
    }

    // Draw tempo curve
    const toY = (bpm: number) => height - ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * height;

    ctx.strokeStyle = CANVAS_CURVE;
    ctx.lineWidth = 2;
    ctx.beginPath();

    const points = pattern.points;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const x = toX(point.position);
      const y = toY(point.bpm);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const prevPoint = points[i - 1];
        if (prevPoint.interpolation === "step") {
          ctx.lineTo(x, toY(prevPoint.bpm));
          ctx.lineTo(x, y);
        } else if (typeof prevPoint.interpolation === "object") {
          // Curve interpolation — use Curve.normalizedAt to match engine
          const slope = prevPoint.interpolation.curve;
          const prevX = toX(prevPoint.position);
          const prevY = toY(prevPoint.bpm);
          const segments = 40;
          for (let s = 1; s <= segments; s++) {
            const t = s / segments;
            const normalized = Curve.normalizedAt(t, slope);
            const segX = prevX + t * (x - prevX);
            const segY = prevY + normalized * (y - prevY);
            ctx.lineTo(segX, segY);
          }
        } else {
          ctx.lineTo(x, y);
        }
      }
    }

    // Extend last point to end
    const lastPoint = points[points.length - 1];
    if (lastPoint.position < TOTAL_PPQN) {
      ctx.lineTo(toX(TOTAL_PPQN), toY(lastPoint.bpm));
    }

    ctx.stroke();

    // Dots at tempo points
    ctx.fillStyle = CANVAS_CURVE;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(toX(point.position), toY(point.bpm), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [pattern]);

  // Playhead overlay — AnimationFrame-driven so the curve canvas never repaints per frame
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    if (!canvas) return;

    const af = AnimationFrame.add(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      if (width === 0) return;
      const height = CANVAS_HEIGHT;

      // Only resize canvas when dimensions actually change
      const targetWidth = width * dpr;
      const targetHeight = height * dpr;
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Reset transform and clear (clearRect is cheap, no reflow)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const pos = playheadRef.current;
      if (isPlayingRef.current && pos >= 0) {
        const px = (pos / TOTAL_PPQN) * width;
        ctx.strokeStyle = CANVAS_PLAYHEAD;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
    });

    return () => af.terminate();
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: CANVAS_HEIGHT }}>
      <canvas
        ref={curveCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: CANVAS_HEIGHT,
          boxSizing: "border-box",
          borderRadius: "4px",
          border: "1px solid var(--mc-line)",
        }}
      />
      <canvas
        ref={playheadCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: CANVAS_HEIGHT,
          // transparent border matches the curve canvas's box model so both
          // clientWidths agree and the playhead doesn't drift at the right edge
          boxSizing: "border-box",
          border: "1px solid transparent",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activePatternIndex, setActivePatternIndex] = useState(0);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);

  const { currentPosition: playheadPosition, isPlaying } = usePlaybackPosition(project);

  useEffect(() => {
    let cancelled = false;
    initializeOpenDAW({ onStatusUpdate: setStatus })
      .then(({ project: newProject }) => {
        if (cancelled) return;
        projectRef.current = newProject;
        setProject(newProject);

        const settings = newProject.engine.preferences.settings;
        settings.metronome.enabled = true;
        settings.metronome.gain = -6;

        applyPattern(newProject, PATTERNS[0]);
        setStatus("Ready");
        setIsReady(true);
      })
      .catch((error) => {
        console.error("Tempo automation demo initialization failed:", error);
        if (!cancelled) setInitError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePatternSelect = (index: number) => {
    const project = projectRef.current;
    if (!project) return;
    if (isPlaying) {
      project.engine.stop(true);
    }
    setActivePatternIndex(index);
    applyPattern(project, PATTERNS[index]);
  };

  const handlePlay = () => {
    const project = projectRef.current;
    if (!project) return;
    project.engine.setPosition(0);
    project.engine.play();
  };

  const handleStop = () => {
    const project = projectRef.current;
    if (!project) return;
    project.engine.stop(true);
  };

  const handleMetronomeToggle = () => {
    const project = projectRef.current;
    if (!project) return;
    const newValue = !metronomeEnabled;
    setMetronomeEnabled(newValue);
    project.engine.preferences.settings.metronome.enabled = newValue;
  };

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Automation — Tempo · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              TEMPO AUTOMATION
            </h1>
            <p className="mc-intro">
              Apply preset tempo patterns — linear ramps, stepped jumps, Möbius-Ease curves —
              and hear the metronome follow the tempo map in real time. Each pattern writes
              events into <code>tempoTrackEvents</code> with <code>Interpolation.None</code>,{" "}
              <code>Linear</code>, or <code>Curve(slope)</code>.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{initError}</Callout.Text>
            </Callout.Root>
          ) : !isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <>
              {/* Patterns */}
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Tempo Pattern</Text>
                  <Flex gap="2" wrap="wrap">
                    {PATTERNS.map((pattern, index) => (
                      <Button
                        key={pattern.name}
                        variant={activePatternIndex === index ? "solid" : "outline"}
                        onClick={() => handlePatternSelect(index)}
                      >
                        {pattern.name}
                      </Button>
                    ))}
                  </Flex>
                  <Text size="2" color="gray">{PATTERNS[activePatternIndex].description}</Text>
                </Flex>
              </Card>

              {/* Tempo map */}
              <div className="mc-lattice-frame" style={{ marginTop: 0 }}>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">Tempo Map</Text>
                  <TempoCanvas
                    pattern={PATTERNS[activePatternIndex]}
                    playheadPosition={playheadPosition as ppqn}
                    isPlaying={isPlaying}
                  />
                </Flex>
              </div>

              {/* Transport */}
              <Card>
                <Flex gap="3" align="center">
                  {!isPlaying ? (
                    <Button size="3" onClick={handlePlay}>Play</Button>
                  ) : (
                    <Button size="3" color="red" onClick={handleStop}>Stop</Button>
                  )}
                  <Button
                    variant={metronomeEnabled ? "solid" : "outline"}
                    onClick={handleMetronomeToggle}
                  >
                    Metronome {metronomeEnabled ? "On" : "Off"}
                  </Button>
                </Flex>
              </Card>

              <section className="mc-anchors">
                <h2 className="mc-anchors-head">SDK reference</h2>
                <p>
                  The tempo track is a value-event collection on the timeline. The engine
                  evaluates curves with <code>Curve.valueAt</code> — the canvas above plots the
                  exact same <code>Curve.normalizedAt(t, slope)</code> math, so what you see is
                  what the engine plays. Deleting and recreating events in a single{" "}
                  <code>editing.modify()</code> is safe for this collection.
                </p>
                <Code
                  size="2"
                  style={{
                    display: "block",
                    padding: "12px",
                    backgroundColor: "var(--gray-3)",
                    borderRadius: "4px",
                    whiteSpace: "pre-wrap",
                    marginTop: "12px",
                  }}
                >
{`project.editing.modify(() => {
  project.timelineBoxAdapter.tempoTrackEvents.ifSome(collection => {
    // Clear, then write the new map — safe in one transaction
    collection.events.asArray().forEach(event => event.box.delete());
    collection.createEvent({
      position: 0,            // PPQN
      index: 0,
      value: 100,             // BPM
      interpolation: Interpolation.Curve(0.75),
      // Interpolation.None (step) · .Linear · .Curve(slope)
    });
  });
});`}
                </Code>
                <p>
                  <a href="/docs/02-timing-and-tempo.html">Timing &amp; tempo</a>
                  {" "}&middot;{" "}
                  <a href="/docs/09-editing-fades-and-automation.html">Editing, fades &amp; automation</a>
                </p>
              </section>
            </>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
