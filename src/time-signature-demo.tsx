import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Button } from "@radix-ui/themes";
import { Project } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";

// --- Pattern Types & Data ---

type SignatureChange = {
  barOffset: number; // bars of previous signature before this change
  nominator: number;
  denominator: number;
};

type SignaturePattern = {
  name: string;
  description: string;
  changes: SignatureChange[];
};

const PATTERNS: SignaturePattern[] = [
  {
    name: "Standard \u2192 Waltz",
    description: "4/4 for 4 bars, then 3/4 for 4 bars",
    changes: [
      { barOffset: 4, nominator: 3, denominator: 4 },
    ],
  },
  {
    name: "Prog Rock",
    description: "4/4 \u2192 7/8 \u2192 5/4 \u2192 4/4, each for 2 bars",
    changes: [
      { barOffset: 2, nominator: 7, denominator: 8 },
      { barOffset: 2, nominator: 5, denominator: 4 },
      { barOffset: 2, nominator: 4, denominator: 4 },
    ],
  },
  {
    name: "Film Score",
    description: "6/8 \u2192 4/4 \u2192 3/4 \u2192 6/8, each for 2 bars",
    changes: [
      { barOffset: 2, nominator: 4, denominator: 4 },
      { barOffset: 2, nominator: 3, denominator: 4 },
      { barOffset: 2, nominator: 6, denominator: 8 },
    ],
  },
  {
    name: "Alternating",
    description: "Alternates 4/4 and 7/8 every 2 bars",
    changes: [
      { barOffset: 2, nominator: 7, denominator: 8 },
      { barOffset: 2, nominator: 4, denominator: 4 },
      { barOffset: 2, nominator: 7, denominator: 8 },
    ],
  },
];

// --- Bar computation ---

type BarInfo = {
  startPpqn: ppqn;
  durationPpqn: ppqn;
  nominator: number;
  denominator: number;
  barNumber: number;
};

function getInitialSignature(pattern: SignaturePattern): [number, number] {
  if (pattern.name === "Film Score") return [6, 8];
  return [4, 4];
}

function getLastSectionBars(pattern: SignaturePattern): number {
  // Standard -> Waltz: 4 bars for last section, others: 2
  if (pattern.changes.length === 1 && pattern.changes[0].barOffset === 4) return 4;
  return 2;
}

function computeBars(pattern: SignaturePattern): BarInfo[] {
  const bars: BarInfo[] = [];
  const [initNom, initDenom] = getInitialSignature(pattern);
  let currentNom = initNom;
  let currentDenom = initDenom;
  let ppqnAccum: ppqn = 0 as ppqn;
  let barNumber = 1;

  // Initial section: barOffset of first change, using initial signature
  const firstChangeOffset = pattern.changes.length > 0 ? pattern.changes[0].barOffset : 8;
  for (let b = 0; b < firstChangeOffset; b++) {
    const dur = PPQN.fromSignature(currentNom, currentDenom);
    bars.push({
      startPpqn: ppqnAccum as ppqn,
      durationPpqn: dur as ppqn,
      nominator: currentNom,
      denominator: currentDenom,
      barNumber: barNumber++,
    });
    ppqnAccum = (ppqnAccum + dur) as ppqn;
  }

  // Each change
  const lastSectionBars = getLastSectionBars(pattern);
  for (let i = 0; i < pattern.changes.length; i++) {
    const change = pattern.changes[i];
    currentNom = change.nominator;
    currentDenom = change.denominator;
    const numBars = (i + 1 < pattern.changes.length) ? pattern.changes[i + 1].barOffset : lastSectionBars;
    for (let b = 0; b < numBars; b++) {
      const dur = PPQN.fromSignature(currentNom, currentDenom);
      bars.push({
        startPpqn: ppqnAccum as ppqn,
        durationPpqn: dur as ppqn,
        nominator: currentNom,
        denominator: currentDenom,
        barNumber: barNumber++,
      });
      ppqnAccum = (ppqnAccum + dur) as ppqn;
    }
  }

  return bars;
}

function applyPattern(project: Project, pattern: SignaturePattern): void {
  const bars = computeBars(pattern);
  const totalPpqn = bars.reduce((sum, b) => sum + b.durationPpqn, 0);
  const [initNom, initDenom] = getInitialSignature(pattern);

  const signatureTrack = project.timelineBoxAdapter.signatureTrack;

  // Clear existing signature events — each deletion in its own modify
  // so the adapter collection stays in sync between deletions
  const existingEvents = Array.from(signatureTrack.iterateAll()).slice(1);
  for (let i = existingEvents.length - 1; i >= 0; i--) {
    project.editing.modify(() => {
      signatureTrack.adapterAt(existingEvents[i].index).ifSome(a => a.box.delete());
    });
  }

  // Set storage signature
  project.editing.modify(() => {
    project.timelineBox.signature.nominator.setValue(initNom);
    project.timelineBox.signature.denominator.setValue(initDenom);
  });

  // Create signature change events one at a time so the adapter
  // collection updates between calls (createEvent reads iterateAll internally)
  let ppqnAccum: ppqn = 0 as ppqn;
  let currentNom = initNom;
  let currentDenom = initDenom;

  const firstChangeOffset = pattern.changes[0]?.barOffset ?? 8;
  ppqnAccum = (firstChangeOffset * PPQN.fromSignature(currentNom, currentDenom)) as ppqn;

  const lastSectionBars = getLastSectionBars(pattern);
  for (let i = 0; i < pattern.changes.length; i++) {
    const change = pattern.changes[i];
    const position = ppqnAccum;
    project.editing.modify(() => {
      signatureTrack.createEvent(position, change.nominator, change.denominator);
    });

    currentNom = change.nominator;
    currentDenom = change.denominator;

    const numBars = (i + 1 < pattern.changes.length) ? pattern.changes[i + 1].barOffset : lastSectionBars;
    ppqnAccum = (ppqnAccum + numBars * PPQN.fromSignature(currentNom, currentDenom)) as ppqn;
  }

  // Set timeline duration and loop
  project.editing.modify(() => {
    project.timelineBox.durationInPulses.setValue(totalPpqn);
    project.timelineBox.loopArea.from.setValue(0);
    project.timelineBox.loopArea.to.setValue(totalPpqn);
    project.timelineBox.loopArea.enabled.setValue(true);
  });
}

// --- Timeline Canvas ---

const CANVAS_HEIGHT = 120;

interface TimelineCanvasProps {
  bars: BarInfo[];
  playheadPosition: ppqn;
  isPlaying: boolean;
}

const TimelineCanvas: React.FC<TimelineCanvasProps> = ({ bars, playheadPosition, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = CANVAS_HEIGHT;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const totalPpqn = bars.reduce((sum, b) => sum + b.durationPpqn, 0);
    const toX = (ppqnPos: number) => (ppqnPos / totalPpqn) * width;

    // Draw each bar
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const barX = toX(bar.startPpqn);
      const barWidth = toX(bar.startPpqn + bar.durationPpqn) - barX;

      // Alternate bar background
      if (i % 2 === 0) {
        ctx.fillStyle = "#1e1e3a";
        ctx.fillRect(barX, 30, barWidth, height - 30);
      }

      // Beat grid lines within bar
      const beatPpqn = PPQN.fromSignature(1, bar.denominator);
      const numBeats = bar.nominator;
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 0.5;
      for (let beat = 1; beat < numBeats; beat++) {
        const beatX = barX + (beat * beatPpqn / bar.durationPpqn) * barWidth;
        ctx.beginPath();
        ctx.moveTo(beatX, 30);
        ctx.lineTo(beatX, height);
        ctx.stroke();
      }

      // Bar separator (left edge)
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(barX, 0);
      ctx.lineTo(barX, height);
      ctx.stroke();

      // Signature label above bar
      ctx.fillStyle = "#aaa";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${bar.nominator}/${bar.denominator}`, barX + barWidth / 2, 15);

      // Bar number
      ctx.fillStyle = "#666";
      ctx.font = "10px sans-serif";
      ctx.fillText(`${bar.barNumber}`, barX + barWidth / 2, 27);
    }

    // Right edge
    const lastBar = bars[bars.length - 1];
    const rightX = toX(lastBar.startPpqn + lastBar.durationPpqn);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rightX, 0);
    ctx.lineTo(rightX, height);
    ctx.stroke();

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
  }, [bars, playheadPosition, isPlaying]);

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

// --- App ---

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const projectRef = useRef<Project | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activePatternIndex, setActivePatternIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [playheadPosition, setPlayheadPosition] = useState<ppqn>(0 as ppqn);
  const [bars, setBars] = useState<BarInfo[]>([]);

  useEffect(() => {
    initializeOpenDAW({ onStatusUpdate: setStatus }).then(({ project }) => {
      projectRef.current = project;

      const settings = project.engine.preferences.settings;
      settings.metronome.enabled = true;
      settings.metronome.gain = -6;

      project.engine.isPlaying.catchupAndSubscribe(obs => {
        setIsPlaying(obs.getValue());
      });

      const initialBars = computeBars(PATTERNS[0]);
      setBars(initialBars);
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
    const newBars = computeBars(PATTERNS[index]);
    setBars(newBars);
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
            <Heading size="8">Time Signature Changes</Heading>
            <Text size="3" color="gray">
              Apply preset time signature sequences and hear the metronome adapt in real-time
            </Text>
          </Flex>

          {!isReady ? (
            <Text align="center">{status}</Text>
          ) : (
            <Flex direction="column" gap="5">
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold" color="gray">Signature Pattern</Text>
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

              <TimelineCanvas
                bars={bars}
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
