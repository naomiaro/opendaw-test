// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TrackRow } from "./components/TrackRow";
import { TransportControls } from "./components/TransportControls";
import { TimelineRuler } from "./components/TimelineRuler";
import { TracksContainer } from "./components/TracksContainer";
import { initializeOpenDAW } from "./lib/projectSetup";
import { loadTracksFromFiles } from "./lib/trackLoading";
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
  Box as RadixBox,
  Switch,
  Separator,
  TextField,
  IconButton
} from "@radix-ui/themes";
import { InfoCircledIcon, LoopIcon, PlayIcon } from "@radix-ui/react-icons";

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
  const [loopEnabled, setLoopEnabled] = useState(true);
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
    let animationFrameSubscription: any;

    (async () => {
      try {
        setStatus("Initializing OpenDAW...");

        const localAudioBuffers = localAudioBuffersRef.current;

        // Initialize OpenDAW with custom BPM
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: status => {
            if (mounted) setStatus(status);
          }
        });

        if (mounted) {
          setProject(newProject);
          setAudioContext(newAudioContext);
          bpmRef.current = BPM;
        }

        // Subscribe to playback state
        newProject.engine.isPlaying.catchupAndSubscribe(obs => {
          if (mounted) setIsPlaying(obs.getValue());
        });

        // Subscribe to position for display
        newProject.engine.position.catchupAndSubscribe(obs => {
          if (mounted) {
            const pos = Math.max(0, obs.getValue());
            currentPositionRef.current = pos;
            setCurrentPosition(pos);
          }
        });

        // Subscribe to AnimationFrame for efficient playhead position updates
        animationFrameSubscription = AnimationFrame.add(() => {
          const position = Math.max(0, newProject.engine.position.getValue());
          currentPositionRef.current = position;

          // Detect loop wraparound
          if (mounted && newProject.engine.isPlaying.getValue()) {
            if (position < previousPositionRef.current - 1000) { // Threshold to detect jump back
              setLoopCount(prev => prev + 1);
            }
            previousPositionRef.current = position;
            setCurrentPosition(position);
          }
        });

        // Configure initial loop area
        const timelineBox = newProject.timelineBoxAdapter.box;
        const { loopArea } = timelineBox;

        // Set loop to first 4 bars
        const fourBars = PPQN.fromSignature(4, 1);
        loopArea.from.setValue(0);
        loopArea.to.setValue(fourBars);
        loopArea.enabled.setValue(true);

        // Subscribe to loop area changes
        loopArea.enabled.subscribe(obs => {
          if (mounted) setLoopEnabled(obs.getValue());
        });
        loopArea.from.subscribe(obs => {
          if (mounted) setLoopStart(obs.getValue());
        });
        loopArea.to.subscribe(obs => {
          if (mounted) setLoopEnd(obs.getValue());
        });

        // Load audio files and create tracks
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [
            { name: "Drums", file: "/audio/DarkRide/02_Drums.ogg" },
            { name: "Bass", file: "/audio/DarkRide/03_Bass.ogg" },
            { name: "Guitar", file: "/audio/DarkRide/04_ElecGtrs.ogg" }
          ],
          localAudioBuffers,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            }
          }
        );

        if (mounted) {
          setTracks(loadedTracks);
          setStatus("Loading waveforms...");
        }
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

    // Resume AudioContext if suspended
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // If resuming from pause, restore the position
    if (pausedPositionRef.current !== null) {
      project.engine.setPosition(pausedPositionRef.current);
      pausedPositionRef.current = null;
    } else {
      // On first play, explicitly set position to 0
      project.engine.setPosition(0);
      setLoopCount(0); // Reset loop counter
    }

    project.engine.play();
  }, [project, audioContext]);

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
    const timelineBox = project.timelineBoxAdapter.box;
    project.editing.modify(() => {
      timelineBox.loopArea.enabled.setValue(checked);
    });
  }, [project]);

  const handleSetLoopStart = useCallback((bars: number) => {
    if (!project) return;
    const timelineBox = project.timelineBoxAdapter.box;
    const ppqnValue = PPQN.fromSignature(bars, 1);
    project.editing.modify(() => {
      timelineBox.loopArea.from.setValue(ppqnValue);
    });
  }, [project]);

  const handleSetLoopEnd = useCallback((bars: number) => {
    if (!project) return;
    const timelineBox = project.timelineBoxAdapter.box;
    const ppqnValue = PPQN.fromSignature(bars, 1);
    project.editing.modify(() => {
      timelineBox.loopArea.to.setValue(ppqnValue);
    });
  }, [project]);

  const handleJumpToLoopStart = useCallback(() => {
    if (!project) return;
    const timelineBox = project.timelineBoxAdapter.box;
    const loopStartPos = timelineBox.loopArea.from.getValue();
    project.engine.setPosition(loopStartPos);
    setCurrentPosition(loopStartPos);
  }, [project]);

  const handleJumpToLoopEnd = useCallback(() => {
    if (!project) return;
    const timelineBox = project.timelineBoxAdapter.box;
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

  return (
    <Theme appearance="dark" accentColor="violet">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <MoisesLogo />

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
                    <Button size="1" onClick={() => handleSetLoopStart(0)} disabled={!project}>
                      0 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopStart(2)} disabled={!project}>
                      2 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopStart(4)} disabled={!project}>
                      4 bars
                    </Button>
                  </Flex>
                  <Text size="2" color="gray" style={{ fontFamily: "monospace", minWidth: "80px" }}>
                    {formatPosition(loopStart)}
                  </Text>
                </Flex>

                <Flex align="center" justify="between" gap="3">
                  <Text size="2" style={{ minWidth: "80px" }}>Loop End:</Text>
                  <Flex gap="2" style={{ flex: 1 }}>
                    <Button size="1" onClick={() => handleSetLoopEnd(2)} disabled={!project}>
                      2 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopEnd(4)} disabled={!project}>
                      4 bars
                    </Button>
                    <Button size="1" onClick={() => handleSetLoopEnd(8)} disabled={!project}>
                      8 bars
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
                    {/* Timeline grid */}
                    {Array.from({ length: 17 }).map((_, i) => {
                      const x = (i / 16) * 100;
                      return (
                        <line
                          key={i}
                          x1={`${x}%`}
                          y1="0"
                          x2={`${x}%`}
                          y2="40"
                          stroke="#333"
                          strokeWidth="1"
                        />
                      );
                    })}

                    {/* Loop area visualization */}
                    {loopEnabled && (
                      <>
                        <rect
                          x={`${(loopStart / (PPQN.Bar * 16)) * 100}%`}
                          y="0"
                          width={`${((loopEnd - loopStart) / (PPQN.Bar * 16)) * 100}%`}
                          height="40"
                          fill="rgba(147, 51, 234, 0.2)"
                          stroke="rgb(147, 51, 234)"
                          strokeWidth="2"
                        />

                        {/* Loop start handle */}
                        <circle
                          cx={`${(loopStart / (PPQN.Bar * 16)) * 100}%`}
                          cy="20"
                          r="6"
                          fill="rgb(147, 51, 234)"
                        />

                        {/* Loop end handle */}
                        <circle
                          cx={`${(loopEnd / (PPQN.Bar * 16)) * 100}%`}
                          cy="20"
                          r="6"
                          fill="rgb(147, 51, 234)"
                        />
                      </>
                    )}

                    {/* Playhead */}
                    <line
                      x1={`${(currentPosition / (PPQN.Bar * 16)) * 100}%`}
                      y1="0"
                      x2={`${(currentPosition / (PPQN.Bar * 16)) * 100}%`}
                      y2="40"
                      stroke="#ff0066"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
              </div>

              <TimelineRuler
                currentPosition={currentPosition}
                maxDuration={16 * PPQN.Bar}
                bpm={BPM}
              />

              <TracksContainer>
                {(() => {
                  // Calculate max duration in seconds from audio buffers
                  const maxDuration = Math.max(
                    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
                    1
                  );

                  return tracks.map((track, index) => {
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
                        maxDuration={maxDuration}
                      />
                    );
                  });
                })()}
              </TracksContainer>
            </Flex>
          </Card>

          {/* Instructions */}
          <Card>
            <Flex direction="column" gap="3">
              <Text size="3" weight="bold">How to Use</Text>
              <Flex direction="column" gap="2" style={{ fontSize: "0.9rem" }}>
                <Text size="2">
                  <strong>1. Basic Looping:</strong> Press Play and watch the playhead loop back when it reaches the loop end point (default: 4 bars)
                </Text>
                <Text size="2">
                  <strong>2. Adjust Loop Boundaries:</strong> Use the Loop Start/End buttons to change the loop region size
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
                  💡 Try playing through bar 3 and watch it automatically jump back to the loop start at bar 4!
                </Text>
              </Flex>
            </Flex>
          </Card>
        </Flex>
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
