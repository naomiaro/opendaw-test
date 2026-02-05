// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TrackRow } from "./components/TrackRow";
import { TransportControls } from "./components/TransportControls";
import { TimelineRuler } from "./components/TimelineRuler";
import { TracksContainer } from "./components/TracksContainer";
import { Playhead } from "./components/Playhead";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
import { getAudioExtension } from "./lib/audioUtils";
import { useWaveformRendering } from "./hooks/useWaveformRendering";
import type { TrackData } from "./lib/types";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Button,
  Callout,
  Badge,
  Switch,
  Separator,
} from "@radix-ui/themes";
import { InfoCircledIcon, LoopIcon } from "@radix-ui/react-icons";

/**
 * Looping Demo App Component
 *
 * Demonstrates comprehensive looping capabilities:
 * - Timeline loop area (global loop for entire project)
 * - Enable/disable loop functionality
 * - Visual loop boundaries on timeline
 * - Playing through and entering loop sections
 * - Region-level looping (clip looping)
 * - Interactive loop boundary adjustment
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [tracks, setTracks] = useState<TrackData[]>([]);

  // Loop-specific state
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(PPQN.fromSignature(4, 1)); // 4 bars
  const [loopCount, setLoopCount] = useState(0); // Track how many times we've looped

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const currentPositionRef = useRef<number>(0);
  const bpmRef = useRef<number>(124);
  const previousPositionRef = useRef<number>(0);

  const BPM = 124; // Dark Ride BPM

  // Use waveform rendering hook
  useWaveformRendering(project, tracks, canvasRefs.current, localAudioBuffersRef.current, {
    onAllRendered: () => setStatus("Ready to explore looping!"),
    maxDuration: Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 30),
  });

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;
    let animationFrameSubscription: { terminate: () => void } | null = null;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);
        bpmRef.current = BPM;

        // Subscribe to playback state
        newProject.engine.isPlaying.catchupAndSubscribe(obs => {
          if (mounted) setIsPlaying(obs.getValue());
        });

        // Subscribe to position for display
        newProject.engine.position.catchupAndSubscribe(obs => {
          if (mounted) setCurrentPosition(obs.getValue());
        });

        // Subscribe to AnimationFrame for efficient playhead position updates
        animationFrameSubscription = AnimationFrame.add(() => {
          const position = newProject.engine.position.getValue();
          currentPositionRef.current = position;

          // Update React state to trigger playhead re-render
          if (mounted && newProject.engine.isPlaying.getValue()) {
            // Detect loop wraparound
            if (position < previousPositionRef.current - 1000) {
              setLoopCount(prev => prev + 1);
            }
            previousPositionRef.current = position;
            setCurrentPosition(position);
          }
        });

        // Load audio files and create tracks
        const ext = getAudioExtension();
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [
            { name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` },
            { name: "Bass", file: `/audio/DarkRide/03_Bass.${ext}` },
            { name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` }
          ],
          localAudioBuffers,
          {
            autoSetLoopEnd: false, // We manually configure loop area below
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            }
          }
        );

        if (mounted) {
          setTracks(loadedTracks);
          setStatus("Loading waveforms...");
        }

        // Configure initial loop area AFTER tracks are loaded
        console.debug("Configuring loop area...");
        const timelineBox = newProject.timelineBox;
        const { loopArea } = timelineBox;

        // Set loop to bars 8-12 (4 bars starting at bar 8, where audio begins)
        const loopStartBars = PPQN.fromSignature(8, 1);
        const loopEndBars = PPQN.fromSignature(12, 1);
        console.debug("Setting loop area: from=", loopStartBars, "to=", loopEndBars, "enabled=false");
        newProject.editing.modify(() => {
          loopArea.from.setValue(loopStartBars);
          loopArea.to.setValue(loopEndBars);
          loopArea.enabled.setValue(false); // Start with loop disabled
        });
        console.debug("Loop area configured successfully");

        // Subscribe to loop area changes using catchupAndSubscribe to get initial values
        loopArea.enabled.catchupAndSubscribe(obs => {
          if (mounted) {
            console.debug("Loop enabled changed:", obs.getValue());
            setLoopEnabled(obs.getValue());
          }
        });
        loopArea.from.catchupAndSubscribe(obs => {
          if (mounted) {
            console.debug("Loop start changed:", obs.getValue());
            setLoopStart(obs.getValue());
          }
        });
        loopArea.to.catchupAndSubscribe(obs => {
          if (mounted) {
            console.debug("Loop end changed:", obs.getValue());
            setLoopEnd(obs.getValue());
          }
        });
        console.debug("Loop area subscriptions complete");
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
      if (animationFrameSubscription) {
        animationFrameSubscription.terminate();
      }
    };
  }, []);

  // Transport controls
  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;

    console.debug("Play button clicked");

    // Resume AudioContext if suspended
    if (audioContext.state === "suspended") {
      console.debug("Resuming AudioContext...");
      await audioContext.resume();
      console.debug(`AudioContext resumed (${audioContext.state})`);
    }

    // If resuming from pause, restore the position
    if (pausedPositionRef.current !== null) {
      console.debug(`Restoring paused position: ${pausedPositionRef.current}`);
      project.engine.setPosition(pausedPositionRef.current);
      pausedPositionRef.current = null;
    } else {
      // On first play, set position to 0
      project.engine.setPosition(0);
      setLoopCount(0); // Reset loop counter
    }

    console.debug("Starting playback...");
    console.debug("Before play() - isPlaying:", project.engine.isPlaying.getValue());
    project.engine.play();
    console.debug("After play() - isPlaying:", project.engine.isPlaying.getValue());
    console.debug("Engine state:", {
      position: project.engine.position.getValue(),
      isPlaying: project.engine.isPlaying.getValue(),
      tracksCount: tracks.length,
      audioContextState: audioContext.state
    });
  }, [project, audioContext, tracks]);

  const handlePause = useCallback(() => {
    if (!project) return;

    const position = project.engine.position.getValue();
    pausedPositionRef.current = position;
    setCurrentPosition(position);

    project.engine.stop(false);
  }, [project]);

  const handleStop = useCallback(() => {
    if (!project) return;

    pausedPositionRef.current = null;
    project.engine.stop();
    project.engine.setPosition(0);
    setCurrentPosition(0);
    setLoopCount(0);
  }, [project]);

  // Loop control handlers
  const handleToggleLoop = useCallback((checked: boolean) => {
    if (!project) return;
    const timelineBox = project.timelineBox;
    project.editing.modify(() => {
      timelineBox.loopArea.enabled.setValue(checked);
    });
  }, [project]);

  const handleSetLoopStart = useCallback((bars: number) => {
    if (!project) return;
    const timelineBox = project.timelineBox;
    const ppqnValue = PPQN.fromSignature(bars, 1);
    project.editing.modify(() => {
      timelineBox.loopArea.from.setValue(ppqnValue);
    });
  }, [project]);

  const handleSetLoopEnd = useCallback((bars: number) => {
    if (!project) return;
    const timelineBox = project.timelineBox;
    const ppqnValue = PPQN.fromSignature(bars, 1);
    project.editing.modify(() => {
      timelineBox.loopArea.to.setValue(ppqnValue);
    });
  }, [project]);

  const handleJumpToLoopStart = useCallback(() => {
    if (!project) return;
    const timelineBox = project.timelineBox;
    const loopStartPos = timelineBox.loopArea.from.getValue();
    project.engine.setPosition(loopStartPos);
    setCurrentPosition(loopStartPos);
  }, [project]);

  const handleJumpToLoopEnd = useCallback(() => {
    if (!project) return;
    const timelineBox = project.timelineBox;
    const loopEndPos = timelineBox.loopArea.to.getValue();
    project.engine.setPosition(loopEndPos - 1000); // Slightly before end to see the loop
    setCurrentPosition(loopEndPos - 1000);
  }, [project]);

  // Format PPQN to bars/beats for display
  const formatPosition = (ppqn: number): string => {
    const bars = Math.floor(ppqn / PPQN.Bar) + 1;
    const beats = Math.floor((ppqn % PPQN.Bar) / PPQN.Quarter) + 1;
    const sixteenths = Math.floor((ppqn % PPQN.Quarter) / (PPQN.Quarter / 4)) + 1;
    return `${bars}.${beats}.${sixteenths}`;
  };

  // Calculate max duration in seconds and PPQN for playhead/loop visualization
  const maxDurationInSeconds = Math.max(
    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
    1
  );
  const maxDurationInPPQN = PPQN.secondsToPulses(maxDurationInSeconds, BPM);

  return (
    <Theme appearance="dark" accentColor="violet">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <Heading size="8" align="center">
            <LoopIcon style={{ verticalAlign: "middle", marginRight: "0.5rem" }} />
            Looping Capabilities Demo
          </Heading>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              This demo showcases OpenDAW's comprehensive looping features including timeline loop areas with visual boundaries, enable/disable functionality, interactive boundary controls, loop iteration tracking, and quick navigation to loop positions.
            </Callout.Text>
          </Callout.Root>

          {/* Status */}
          <Card>
            <Flex direction="column" gap="2">
              <Text size="2" weight="bold">Status</Text>
              <Badge color={status.includes("Error") ? "red" : status.includes("Ready") ? "green" : "blue"} size="2">
                {status}
              </Badge>
            </Flex>
          </Card>

          {/* Loop Controls */}
          <Card>
            <Flex direction="column" gap="3">
              <Text size="4" weight="bold">Loop Controls</Text>

              <Separator size="4" />

              {/* Enable/Disable Loop */}
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <LoopIcon />
                  <Text size="3">Loop Enabled</Text>
                </Flex>
                <Switch
                  checked={loopEnabled}
                  onCheckedChange={handleToggleLoop}
                  disabled={!project}
                />
              </Flex>

              <Separator size="4" />

              {/* Loop Start/End Controls */}
              <Flex direction="column" gap="3">
                <Flex align="center" justify="between" gap="3">
                  <Text size="2" style={{ minWidth: "80px" }}>Loop Start:</Text>
                  <Flex gap="2" style={{ flex: 1 }}>
                    <Button size="1" onClick={() => handleSetLoopStart(8)} disabled={!project}>
                      8 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopStart(16)} disabled={!project}>
                      16 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopStart(24)} disabled={!project}>
                      24 bars
                    </Button>
                  </Flex>
                  <Text size="2" color="gray" style={{ fontFamily: "monospace", minWidth: "80px" }}>
                    {formatPosition(loopStart)}
                  </Text>
                </Flex>

                <Flex align="center" justify="between" gap="3">
                  <Text size="2" style={{ minWidth: "80px" }}>Loop End:</Text>
                  <Flex gap="2" style={{ flex: 1 }}>
                    <Button size="1" onClick={() => handleSetLoopEnd(12)} disabled={!project}>
                      12 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopEnd(20)} disabled={!project}>
                      20 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopEnd(28)} disabled={!project}>
                      28 bars
                    </Button>
                  </Flex>
                  <Text size="2" color="gray" style={{ fontFamily: "monospace", minWidth: "80px" }}>
                    {formatPosition(loopEnd)}
                  </Text>
                </Flex>
              </Flex>

              <Separator size="4" />

              {/* Jump Controls */}
              <Flex align="center" justify="between" gap="3">
                <Text size="2">Jump to:</Text>
                <Flex gap="2">
                  <Button
                    size="2"
                    variant="soft"
                    onClick={handleJumpToLoopStart}
                    disabled={!project}
                  >
                    Loop Start
                  </Button>
                  <Button
                    size="2"
                    variant="soft"
                    onClick={handleJumpToLoopEnd}
                    disabled={!project}
                  >
                    Loop End
                  </Button>
                </Flex>
              </Flex>

              <Separator size="4" />

              {/* Loop Info */}
              <Flex direction="column" gap="2">
                <Flex align="center" justify="between">
                  <Text size="2" color="gray">Current Position:</Text>
                  <Text size="2" weight="bold" style={{ fontFamily: "monospace" }}>
                    {formatPosition(currentPosition)}
                  </Text>
                </Flex>
                <Flex align="center" justify="between">
                  <Text size="2" color="gray">Loop Duration:</Text>
                  <Text size="2" weight="bold" style={{ fontFamily: "monospace" }}>
                    {((loopEnd - loopStart) / PPQN.Bar).toFixed(1)} bars
                  </Text>
                </Flex>
                <Flex align="center" justify="between">
                  <Text size="2" color="gray">Loop Iterations:</Text>
                  <Badge size="2" color="violet">
                    {loopCount}x
                  </Badge>
                </Flex>
              </Flex>
            </Flex>
          </Card>

          {/* Transport Controls */}
          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">Transport</Text>
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={BPM}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
            </Flex>
          </Card>

          {/* Timeline and Tracks */}
          <Card>
            <Flex direction="column" gap="2">
              <Text size="3" weight="bold">Timeline</Text>

              {/* Custom Loop Area Visualization */}
              <div style={{ display: "flex", flexDirection: "row", alignItems: "stretch", borderRadius: "4px", overflow: "hidden" }}>
                {/* Left spacer matching controls width */}
                <div style={{ width: "200px", backgroundColor: "var(--gray-3)", borderRight: "1px solid var(--gray-6)" }} />

                {/* Timeline area aligned with waveforms */}
                <div style={{ position: "relative", flex: 1, height: "40px", background: "#1a1a1a" }}>
                  <svg
                    width="100%"
                    height="40"
                    style={{ position: "absolute", top: 0, left: 0 }}
                  >
                    {/* Bar markers */}
                    {(() => {
                      const totalBars = Math.ceil(maxDurationInPPQN / PPQN.Bar);
                      return Array.from({ length: totalBars + 1 }).map((_, barIndex) => {
                        const barPPQN = barIndex * PPQN.Bar;
                        const x = (barPPQN / maxDurationInPPQN) * 100;
                        return (
                          <g key={barIndex}>
                            {/* Bar line */}
                            <line
                              x1={`${x}%`}
                              y1="0"
                              x2={`${x}%`}
                              y2="40"
                              stroke={barIndex % 4 === 0 ? "#555" : "#333"}
                              strokeWidth={barIndex % 4 === 0 ? "2" : "1"}
                            />
                            {/* Bar number label */}
                            {barIndex % 4 === 0 && (
                              <text
                                x={`${x}%`}
                                y="12"
                                fill="#888"
                                fontSize="10"
                                textAnchor="middle"
                              >
                                {barIndex + 1}
                              </text>
                            )}
                          </g>
                        );
                      });
                    })()}

                    {/* Loop area visualization */}
                    {loopEnabled && (
                      <>
                        <rect
                          x={`${(loopStart / maxDurationInPPQN) * 100}%`}
                          y="0"
                          width={`${((loopEnd - loopStart) / maxDurationInPPQN) * 100}%`}
                          height="40"
                          fill="rgba(147, 51, 234, 0.2)"
                          stroke="rgb(147, 51, 234)"
                          strokeWidth="2"
                        />

                        {/* Loop start handle */}
                        <circle
                          cx={`${(loopStart / maxDurationInPPQN) * 100}%`}
                          cy="20"
                          r="6"
                          fill="rgb(147, 51, 234)"
                        />

                        {/* Loop end handle */}
                        <circle
                          cx={`${(loopEnd / maxDurationInPPQN) * 100}%`}
                          cy="20"
                          r="6"
                          fill="rgb(147, 51, 234)"
                        />
                      </>
                    )}
                  </svg>

                  {/* Playhead using the reusable Playhead component */}
                  <Playhead
                    currentPosition={currentPosition}
                    bpm={BPM}
                    maxDuration={maxDurationInSeconds}
                    leftOffset={0}
                    color="white"
                    visible={true}
                  />
                </div>
              </div>

              <TimelineRuler maxDuration={maxDurationInSeconds} />

              <TracksContainer
                currentPosition={currentPosition}
                bpm={BPM}
                maxDuration={maxDurationInSeconds}
                leftOffset={200}
                playheadColor="#fff"
              >
                {tracks.map((track) => {
                  const uuidString = UUID.toString(track.uuid);
                  return (
                    <TrackRow
                      key={uuidString}
                      track={track}
                      project={project!}
                      allTracks={tracks}
                      peaks={undefined}
                      canvasRef={canvas => {
                        if (canvas) canvasRefs.current.set(uuidString, canvas);
                      }}
                      currentPosition={currentPosition}
                      isPlaying={isPlaying}
                      bpm={BPM}
                      audioBuffer={localAudioBuffersRef.current.get(uuidString)}
                      setCurrentPosition={setCurrentPosition}
                      pausedPositionRef={pausedPositionRef}
                      maxDuration={maxDurationInSeconds}
                    />
                  );
                })}
              </TracksContainer>
            </Flex>
          </Card>

          {/* Instructions */}
          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">How to Use</Text>
              <Flex direction="column" gap="2" style={{ fontSize: "0.9rem" }}>
                <Text size="2">
                  <strong>1. Basic Looping:</strong> Enable the loop switch and press Play to hear the music loop between bars 8-12
                </Text>
                <Text size="2">
                  <strong>2. Adjust Loop Boundaries:</strong> Use the Loop Start/End buttons to move the loop to different sections of the song
                </Text>
                <Text size="2">
                  <strong>3. Enable/Disable:</strong> Toggle the loop switch to enable or disable looping during playback
                </Text>
                <Text size="2">
                  <strong>4. Jump to Position:</strong> Use the "Jump to" buttons to instantly move the playhead to loop boundaries
                </Text>
                <Text size="2">
                  <strong>5. Watch Loop Counter:</strong> The iteration counter shows how many times you've looped through the section
                </Text>
                <Text size="2" color="gray" style={{ marginTop: "0.5rem" }}>
                  💡 The loop starts at bar 8 where the music begins (the first 8 bars are silent)
                </Text>
              </Flex>
            </Flex>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

// Mount the app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
