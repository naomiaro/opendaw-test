import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Button, Callout, Code } from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Project } from "@opendaw/studio-core";
import { PPQN } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { computeBarsFromSDK } from "@/lib/barLayout";
import type { BarInfo } from "@/lib/barLayout";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { CONSOLE_STYLES, CANVAS_COLORS, CANVAS_FONT_BOLD, CANVAS_FONT_SMALL } from "@/lib/design/consoleTheme";

// --- Pattern Types & Data ---

type SignatureChange = {
  barOffset: number; // bars of previous signature before this change
  nominator: number;
  denominator: number;
};

type SignaturePattern = {
  name: string;
  description: string;
  initialSignature: [number, number];
  /** Bars held by the final signature section (after the last change event, before loop end). */
  lastSectionBars: number;
  changes: SignatureChange[];
};

const PATTERNS: SignaturePattern[] = [
  {
    name: "Standard \u2192 Waltz",
    description: "4/4 for 4 bars, then 3/4 for 4 bars",
    initialSignature: [4, 4],
    lastSectionBars: 4,
    changes: [
      { barOffset: 4, nominator: 3, denominator: 4 },
    ],
  },
  {
    name: "Prog Rock",
    description: "4/4 \u2192 7/8 \u2192 5/4 \u2192 4/4, each for 2 bars",
    initialSignature: [4, 4],
    lastSectionBars: 2,
    changes: [
      { barOffset: 2, nominator: 7, denominator: 8 },
      { barOffset: 2, nominator: 5, denominator: 4 },
      { barOffset: 2, nominator: 4, denominator: 4 },
    ],
  },
  {
    name: "Film Score",
    description: "6/8 \u2192 4/4 \u2192 3/4 \u2192 6/8, each for 2 bars",
    initialSignature: [6, 8],
    lastSectionBars: 2,
    changes: [
      { barOffset: 2, nominator: 4, denominator: 4 },
      { barOffset: 2, nominator: 3, denominator: 4 },
      { barOffset: 2, nominator: 6, denominator: 8 },
    ],
  },
  {
    name: "Alternating",
    description: "Alternates 4/4 and 7/8 every 2 bars",
    initialSignature: [4, 4],
    lastSectionBars: 2,
    changes: [
      { barOffset: 2, nominator: 7, denominator: 8 },
      { barOffset: 2, nominator: 4, denominator: 4 },
      { barOffset: 2, nominator: 7, denominator: 8 },
    ],
  },
];

// --- Bar computation ---

function applyPattern(project: Project, pattern: SignaturePattern): void {
  const [initNom, initDenom] = pattern.initialSignature;
  const signatureTrack = project.timelineBoxAdapter.signatureTrack;

  // Clear existing signature events — each deletion in its own modify
  // so the adapter collection stays in sync between deletions
  const existingEvents = Array.from(signatureTrack.iterateAll()).slice(1);
  for (let i = existingEvents.length - 1; i >= 0; i--) {
    project.editing.modify(() => {
      signatureTrack.adapterAt(existingEvents[i].index).ifSome(a => signatureTrack.deleteAdapter(a));
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

  for (let i = 0; i < pattern.changes.length; i++) {
    const change = pattern.changes[i];
    const position = ppqnAccum;
    project.editing.modify(() => {
      signatureTrack.createEvent(position, change.nominator, change.denominator);
    });

    currentNom = change.nominator;
    currentDenom = change.denominator;

    const numBars = (i + 1 < pattern.changes.length) ? pattern.changes[i + 1].barOffset : pattern.lastSectionBars;
    ppqnAccum = (ppqnAccum + numBars * PPQN.fromSignature(currentNom, currentDenom)) as ppqn;
  }

  const totalPpqn = ppqnAccum;

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
const CANVAS_HEADER_H = 30; // signature-label header row above the bar lanes

// Canvas semantic aliases — bar boundaries ARE the data on this page, so they use the
// structural tier (--mc-faint, ≈2.8:1), not the quiet supporting-grid tier tempo uses.
const CANVAS_BG = CANVAS_COLORS.bg;
const CANVAS_BAR_SHADE = CANVAS_COLORS.shade;       // --mc-shade (alternating region fill; --mc-panel at ≈1.05:1 reads flat on canvas — don't use it here)
const CANVAS_BEAT_LINE = CANVAS_COLORS.gridTertiary; // --mc-line (tertiary grid)
const CANVAS_BAR_LINE = CANVAS_COLORS.structural;    // --mc-faint (bar boundaries ARE the data; strokes only)
const CANVAS_SIGNATURE = CANVAS_COLORS.amber;        // meter CHANGES only — emphasis marks transitions
const CANVAS_LABEL = CANVAS_COLORS.label;
const CANVAS_PLAYHEAD = CANVAS_COLORS.playhead;
const CANVAS_FONT = CANVAS_FONT_BOLD;

interface TimelineCanvasProps {
  bars: BarInfo[];
  playheadPosition: ppqn;
  isPlaying: boolean;
}

const TimelineCanvas: React.FC<TimelineCanvasProps> = ({ bars, playheadPosition, isPlaying }) => {
  const barsCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null);
  // Store per-frame values in refs so the AnimationFrame overlay reads live data
  // without the static bar effect re-running every frame.
  const playheadRef = useRef(playheadPosition);
  const isPlayingRef = useRef(isPlaying);
  const totalPpqnRef = useRef(0);
  playheadRef.current = playheadPosition;
  isPlayingRef.current = isPlaying;
  totalPpqnRef.current = bars.reduce((sum, b) => sum + b.durationPpqn, 0);

  // Static bar rendering — re-runs only when the bar layout changes
  useEffect(() => {
    const canvas = barsCanvasRef.current;
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
    ctx.fillStyle = CANVAS_BG;
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
        ctx.fillStyle = CANVAS_BAR_SHADE;
        ctx.fillRect(barX, CANVAS_HEADER_H, barWidth, height - CANVAS_HEADER_H);
      }

      // Beat grid lines within bar
      const beatPpqn = PPQN.fromSignature(1, bar.denominator);
      const numBeats = bar.nominator;
      ctx.strokeStyle = CANVAS_BEAT_LINE;
      ctx.lineWidth = 0.5;
      for (let beat = 1; beat < numBeats; beat++) {
        const beatX = barX + (beat * beatPpqn / bar.durationPpqn) * barWidth;
        ctx.beginPath();
        ctx.moveTo(beatX, CANVAS_HEADER_H);
        ctx.lineTo(beatX, height);
        ctx.stroke();
      }

      // Bar separator (left edge)
      ctx.strokeStyle = CANVAS_BAR_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(barX, 0);
      ctx.lineTo(barX, height);
      ctx.stroke();

      // Signature label only where the meter changes (DAW convention) —
      // amber marks transitions instead of repeating on every bar
      const meterChanged = i === 0
        || bar.nominator !== bars[i - 1].nominator
        || bar.denominator !== bars[i - 1].denominator;
      if (meterChanged) {
        ctx.strokeStyle = CANVAS_SIGNATURE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barX + 1, 0);
        ctx.lineTo(barX + 1, CANVAS_HEADER_H);
        ctx.stroke();

        ctx.fillStyle = CANVAS_SIGNATURE;
        ctx.font = CANVAS_FONT;
        ctx.textAlign = "center";
        ctx.fillText(`${bar.nominator}/${bar.denominator}`, barX + barWidth / 2, 15);
      }

      // Bar number
      ctx.fillStyle = CANVAS_LABEL;
      ctx.font = CANVAS_FONT_SMALL;
      ctx.textAlign = "center";
      ctx.fillText(`${bar.barNumber}`, barX + barWidth / 2, 27);
    }

    // Right edge
    const lastBar = bars[bars.length - 1];
    const rightX = toX(lastBar.startPpqn + lastBar.durationPpqn);
    ctx.strokeStyle = CANVAS_BAR_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rightX, 0);
    ctx.lineTo(rightX, height);
    ctx.stroke();
  }, [bars]);

  // Playhead overlay — AnimationFrame-driven so the bar canvas never repaints per frame
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
      const totalPpqn = totalPpqnRef.current;
      if (isPlayingRef.current && pos >= 0 && totalPpqn > 0) {
        const px = (pos / totalPpqn) * width;
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
        ref={barsCanvasRef}
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
          // transparent border matches the bar canvas's box model so both
          // clientWidths agree and the playhead doesn't drift at the right edge
          boxSizing: "border-box",
          border: "1px solid transparent",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

// --- App ---

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [activePatternIndex, setActivePatternIndex] = useState(0);
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [bars, setBars] = useState<BarInfo[]>([]);

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
        setBars(computeBarsFromSDK(newProject));
        setStatus("Ready");
        setIsReady(true);
      })
      .catch((error) => {
        console.error("Time signature demo initialization failed:", error);
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
    setBars(computeBarsFromSDK(project));
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
            <div className="mc-kicker">Automation — Time Signature · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              TIME SIGNATURE CHANGES
            </h1>
            <p className="mc-intro">
              Apply preset meter sequences — waltz, prog rock, film score — and hear the
              metronome adapt in real time. Each change writes an event into the timeline&apos;s
              signature track via <code>signatureTrack.createEvent(position, nominator, denominator)</code>,
              one transaction per event.
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
              </Card>

              {/* Bar structure */}
              <div className="mc-lattice-frame" style={{ marginTop: 0 }}>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">Bar Structure</Text>
                  <TimelineCanvas
                    bars={bars}
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
                  The signature track is an event list on the timeline; index -1 holds the
                  storage signature. <code>createEvent</code> reads the adapter collection
                  internally, and collection notifications are deferred inside a transaction —
                  so each <code>createEvent</code> and each deletion needs its own{" "}
                  <code>editing.modify()</code>. The canvas above expands the resulting
                  sections into bars with <code>computeBarsFromSDK</code>{" "}
                  (<code>src/lib/barLayout.ts</code>), which walks{" "}
                  <code>signatureTrack.iterateAll()</code>.
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
{`const signatureTrack = project.timelineBoxAdapter.signatureTrack;

// One editing.modify() per event — createEvent calls iterateAll()
// internally and the adapter collection only syncs between transactions
project.editing.modify(() => {
  signatureTrack.createEvent(position, 7, 8); // PPQN, nominator, denominator
});

// Expand signature sections into bars for rendering
const bars = computeBarsFromSDK(project); // src/lib/barLayout.ts`}
                </Code>
                <p>
                  <a href="/docs/02-timing-and-tempo.html">Timing &amp; tempo</a>
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
