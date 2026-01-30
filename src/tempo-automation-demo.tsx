import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Button } from "@radix-ui/themes";
import { Project } from "@opendaw/studio-core";
import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";

// 4/4 time: one bar = 3840 PPQN
const BAR = PPQN.fromSignature(4, 4); // 3840
const NUM_BARS = 8;
const TOTAL_PPQN = BAR * NUM_BARS; // 30720

type TempoPoint = {
  position: ppqn;
  bpm: number;
  interpolation: "step" | "linear";
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
        collection.createEvent({
          position: point.position,
          index: 0,
          value: point.bpm,
          interpolation: point.interpolation === "linear" ? Interpolation.Linear : Interpolation.None,
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

interface TempoCanvasProps {
  pattern: TempoPattern;
  playheadPosition: ppqn;
  isPlaying: boolean;
}

const TempoCanvas: React.FC<TempoCanvasProps> = ({ pattern, playheadPosition, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    // Grid lines (bar lines) — use PPQN positions for consistency with engine timing
    const toX = (ppqnPos: number) => (ppqnPos / TOTAL_PPQN) * width;

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let bar = 0; bar <= NUM_BARS; bar++) {
      const x = toX(bar * BAR);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (bar < NUM_BARS) {
        ctx.fillStyle = "#666";
        ctx.font = "11px sans-serif";
        ctx.fillText(`${bar + 1}`, x + 4, height - 4);
      }
    }

    // BPM grid lines
    ctx.strokeStyle = "#222";
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 20) {
      const y = height - ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = "#555";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${bpm}`, width - 4, y - 2);
      ctx.textAlign = "left";
    }

    // Draw tempo curve
    const toY = (bpm: number) => height - ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * height;

    ctx.strokeStyle = "#667eea";
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
    ctx.fillStyle = "#667eea";
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(toX(point.position), toY(point.bpm), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playhead
    if (isPlaying && playheadPosition >= 0) {
      const px = toX(playheadPosition);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [pattern, playheadPosition, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: CANVAS_HEIGHT,
        borderRadius: "var(--radius-3)",
        border: "1px solid var(--gray-6)",
      }}
    />
  );
};

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const projectRef = useRef<Project | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activePatternIndex, setActivePatternIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [playheadPosition, setPlayheadPosition] = useState<ppqn>(0 as ppqn);

  useEffect(() => {
    initializeOpenDAW({ onStatusUpdate: setStatus }).then(({ project }) => {
      projectRef.current = project;

      const settings = project.engine.preferences.settings;
      settings.metronome.enabled = true;
      settings.metronome.gain = -6;

      project.engine.isPlaying.catchupAndSubscribe(obs => {
        setIsPlaying(obs.getValue());
      });

      applyPattern(project, PATTERNS[0]);
      setStatus("Ready");
      setIsReady(true);
    });
  }, []);

  useEffect(() => {
    const project = projectRef.current;
    if (!project || !isPlaying) return;

    const terminable = AnimationFrame.add(() => {
      setPlayheadPosition(project.engine.position.getValue());
    });

    return () => terminable.terminate();
  }, [isPlaying]);

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
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <BackLink />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Tempo Automation</Heading>
            <Text size="3" color="gray">
              Apply preset tempo patterns and hear the metronome follow tempo changes in real-time
            </Text>
          </Flex>

          {!isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <Flex direction="column" gap="5">
              <Flex direction="column" gap="2">
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

              <TempoCanvas
                pattern={PATTERNS[activePatternIndex]}
                playheadPosition={playheadPosition}
                isPlaying={isPlaying}
              />

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
            </Flex>
          )}
        </Flex>
      </Container>
      <MoisesLogo />
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
