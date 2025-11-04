// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { RegionEditing, AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
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
import { Theme, Container, Heading, Text, Flex, Card, Button, Callout, Badge, Box as RadixBox } from "@radix-ui/themes";

/**
 * Track Editing Demo App Component
 *
 * Demonstrates interactive track editing capabilities:
 * - Splitting regions at playhead position
 * - Moving regions forward/backward
 * - Real-time waveform display
 * - Multi-track playback
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);
  const [selectedRegionUuid, setSelectedRegionUuid] = useState<string | null>(null);
  const [updateTrigger, setUpdateTrigger] = useState({});

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const currentPositionRef = useRef<number>(0);
  const bpmRef = useRef<number>(124);

  const BPM = 124; // Dark Ride BPM

  // Helper function to get regions from a track
  const getRegionsForTrack = useCallback((track: TrackData) => {
    const regions: any[] = [];
    const pointers = track.trackBox.regions.pointerHub.incoming();

    pointers.forEach(({ box }) => {
      if (!box) return;
      const regionBox = box as AudioRegionBox;

      regions.push({
        uuid: UUID.toString(regionBox.address.uuid),
        position: regionBox.position.getValue(),
        duration: regionBox.duration.getValue(),
        loopOffset: regionBox.loopOffset.getValue(),
        loopDuration: regionBox.loopDuration.getValue(),
        label: regionBox.label.getValue()
      });
    });

    return regions;
  }, []);

  // Use waveform rendering hook with region-aware rendering
  useWaveformRendering(project, tracks, canvasRefs.current, localAudioBuffersRef.current, {
    onAllRendered: () => setStatus("Ready to play!"),
    maxDuration: Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 30),
    updateTrigger
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
            const pos = Math.max(0, obs.getValue()); // Ensure position is never negative
            currentPositionRef.current = pos; // Keep ref in sync
            setCurrentPosition(pos);
          }
        });

        // Subscribe to AnimationFrame for efficient playhead position updates
        animationFrameSubscription = AnimationFrame.add(() => {
          // Update position for playhead rendering (used by SVG overlay)
          const position = Math.max(0, newProject.engine.position.getValue()); // Ensure position is never negative
          currentPositionRef.current = position;

          // Update React state to trigger playhead re-render
          if (mounted && newProject.engine.isPlaying.getValue()) {
            setCurrentPosition(position);
          }
        });

        // Load audio files and create tracks
        const loadedTracks = await loadTracksFromFiles(
          newProject,
          newAudioContext,
          [
            { name: "Vocals", file: "/audio/DarkRide/06_Vox.ogg" },
            { name: "Guitar", file: "/audio/DarkRide/04_ElecGtrs.ogg" },
            { name: "Bass", file: "/audio/DarkRide/03_Bass.ogg" },
            { name: "Drums", file: "/audio/DarkRide/02_Drums.ogg" }
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
      // On first play, explicitly set position to 0 to ensure clean start
      project.engine.setPosition(0);
      console.debug("Set position to 0 for first play");
    }

    console.debug("Starting playback...");
    project.engine.play();
  }, [project, audioContext]);

  const handlePause = useCallback(() => {
    if (!project) return;
    console.debug("Pause button clicked");

    // Read current position from observable
    const position = project.engine.position.getValue();
    console.debug(`Current position from observable: ${position}`);

    // Save it for resume
    pausedPositionRef.current = position;
    console.debug(`Saved paused position: ${pausedPositionRef.current}`);

    // Update state so playhead stays visible
    setCurrentPosition(position);

    // Stop playback without resetting position
    project.engine.stop(false);
  }, [project]);

  const handleStop = useCallback(() => {
    if (!project) return;
    console.debug("Stop button clicked");

    // Clear any paused position
    pausedPositionRef.current = null;

    // Stop and reset position
    project.engine.stop();

    // Reset position to beginning
    project.engine.setPosition(0);
    setCurrentPosition(0);
  }, [project]);

  // Editing operations
  const handleSplitAtPlayhead = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    // Use currentPosition state which is updated when clicking on waveform
    const playheadPosition = currentPosition;

    console.debug(`Splitting track "${track.name}" at position ${playheadPosition}`);

    project.editing.modify(() => {
      // Get all regions from this track using pointerHub
      const pointers = track.trackBox.regions.pointerHub.incoming();

      // Find region that contains the playhead
      pointers.forEach(({ box }) => {
        if (!box) return;
        const regionBox = box as AudioRegionBox;

        const regionAdapter = project.boxAdapters.adapterFor(regionBox, AudioRegionBoxAdapter);
        if (!regionAdapter) return;

        const regionStart = regionAdapter.position;
        const regionEnd = regionStart + regionAdapter.duration;

        // Check if playhead is within this region
        if (playheadPosition > regionStart && playheadPosition < regionEnd) {
          console.debug(`Splitting region "${regionAdapter.box.label.getValue()}" at ${playheadPosition}`);
          RegionEditing.cut(regionAdapter, playheadPosition, true);
        }
      });
    });

    // Force re-render to show updated regions
    setUpdateTrigger({});
  }, [project, selectedTrackIndex, tracks, currentPosition]);

  const handleMoveRegionForward = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    const moveAmount = PPQN.secondsToPulses(1, BPM); // Move by 1 second

    const regionDesc = selectedRegionUuid ? "selected region" : "all regions";
    console.debug(`Moving ${regionDesc} in track "${track.name}" forward by ${moveAmount} PPQN`);

    project.editing.modify(() => {
      // Get all regions from this track using pointerHub
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({ box }) => {
        if (!box) return;
        const regionBox = box as AudioRegionBox;
        const regionUuid = UUID.toString(regionBox.address.uuid);

        // If a region is selected, only move that one
        if (selectedRegionUuid && regionUuid !== selectedRegionUuid) return;

        const currentPosition = regionBox.position.getValue();
        regionBox.position.setValue(currentPosition + moveAmount);
      });
    });

    // Force re-render to show updated regions
    setUpdateTrigger({});
  }, [project, selectedTrackIndex, tracks, selectedRegionUuid]);

  const handleMoveRegionBackward = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    const moveAmount = PPQN.secondsToPulses(1, BPM); // Move by 1 second

    const regionDesc = selectedRegionUuid ? "selected region" : "all regions";
    console.debug(`Moving ${regionDesc} in track "${track.name}" backward by ${moveAmount} PPQN`);

    project.editing.modify(() => {
      // Get all regions from this track using pointerHub
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({ box }) => {
        if (!box) return;
        const regionBox = box as AudioRegionBox;
        const regionUuid = UUID.toString(regionBox.address.uuid);

        // If a region is selected, only move that one
        if (selectedRegionUuid && regionUuid !== selectedRegionUuid) return;

        const currentPosition = regionBox.position.getValue();
        const newPosition = Math.max(0, currentPosition - moveAmount);
        regionBox.position.setValue(newPosition);
      });
    });

    // Force re-render to show updated regions
    setUpdateTrigger({});
  }, [project, selectedTrackIndex, tracks, selectedRegionUuid]);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Track Editing Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  // Show loading overlay while status is not "Ready to play!"
  const isLoading = status !== "Ready to play!";

  // Calculate max duration for ruler
  const maxDuration = Math.max(...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration), 30);

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          {/* Loading Overlay */}
          {isLoading && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.85)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                gap: "20px"
              }}
            >
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  border: "4px solid var(--gray-6)",
                  borderTop: "4px solid var(--green-9)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite"
                }}
              />
              <Text size="5" weight="bold">
                {status}
              </Text>
              <style>
                {`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}
              </style>
            </div>
          )}

          {/* Header */}
          <Flex direction="column" gap="4">
            <BackLink />
            <Heading size="8">Track Editing Demo</Heading>
            <Text size="4" color="gray">
              Interactive audio region editing with Dark Ride stems (124 BPM). Split regions at the playhead, move
              regions around the timeline, and experiment with non-destructive editing.
            </Text>
          </Flex>

          {/* Instructions */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">How to Use</Heading>
              <Flex direction="column" gap="2">
                <Text size="2">
                  <strong>1. Select a track</strong> by clicking on it (highlighted in blue)
                </Text>
                <Text size="2">
                  <strong>2. Select a region</strong> (optional) by clicking on a region badge below the track
                </Text>
                <Text size="2">
                  <strong>3. Use transport controls</strong> to play, pause, or stop the audio
                </Text>
                <Text size="2">
                  <strong>4. Split regions</strong> - Click on waveform to position playhead, then click "Split at
                  Playhead"
                </Text>
                <Text size="2">
                  <strong>5. Move regions</strong> - Use "Move Forward" / "Move Backward" to move selected region (or
                  all if none selected)
                </Text>
              </Flex>
              <Callout.Root size="1" color="blue">
                <Callout.Text>All edits are non-destructive! The original audio files remain unchanged.</Callout.Text>
              </Callout.Root>
            </Flex>
          </Card>

          {/* Transport Controls */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Transport</Heading>
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={BPM}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
              <Text size="2" color="gray">
                Position: {PPQN.pulsesToSeconds(currentPosition, BPM).toFixed(2)}s ({currentPosition} PPQN)
              </Text>
            </Flex>
          </Card>

          {/* Editing Controls */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Editing Tools</Heading>
              {selectedTrackIndex === null ? (
                <Callout.Root size="1" color="gray">
                  <Callout.Text>Select a track below to enable editing controls</Callout.Text>
                </Callout.Root>
              ) : (
                <>
                  <Flex direction="column" gap="2">
                    <Text size="2" color="gray">
                      Selected track: <strong>{tracks[selectedTrackIndex]?.name}</strong>
                    </Text>
                    {selectedRegionUuid && (
                      <Text size="2" color="blue">
                        Selected region:{" "}
                        <strong>
                          Region{" "}
                          {(() => {
                            const regions = getRegionsForTrack(tracks[selectedTrackIndex]);
                            const idx = regions.findIndex(r => r.uuid === selectedRegionUuid);
                            return idx + 1;
                          })()}
                        </strong>{" "}
                        (Click region badge to deselect)
                      </Text>
                    )}
                  </Flex>
                  <Flex gap="2" wrap="wrap">
                    <Button onClick={handleSplitAtPlayhead} variant="soft" size="2">
                      Split at Playhead
                    </Button>
                    <Button onClick={handleMoveRegionBackward} variant="soft" size="2">
                      ← Move {selectedRegionUuid ? "Selected" : "All"} Backward (1s)
                    </Button>
                    <Button onClick={handleMoveRegionForward} variant="soft" size="2">
                      Move {selectedRegionUuid ? "Selected" : "All"} Forward (1s) →
                    </Button>
                  </Flex>
                </>
              )}
            </Flex>
          </Card>

          {/* Tracks */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Tracks</Heading>

              {/* Timeline + Tracks container with playhead overlay */}
              <TracksContainer currentPosition={currentPosition} bpm={BPM} maxDuration={maxDuration} leftOffset={200}>
                {/* Timeline Ruler */}
                <TimelineRuler maxDuration={maxDuration} />

                {/* Track List */}
                <div>
                  {tracks.map((track, index) => {
                    const uuidString = UUID.toString(track.uuid);
                    const regions = getRegionsForTrack(track);

                    return (
                      <div
                        key={uuidString}
                        onClick={() => setSelectedTrackIndex(index)}
                        style={{
                          cursor: "pointer",
                          boxShadow: selectedTrackIndex === index ? "0 0 0 2px var(--blue-9)" : "none",
                          borderRadius: "4px",
                          marginBottom: "8px",
                          backgroundColor: selectedTrackIndex === index ? "var(--blue-2)" : "transparent",
                          transition: "all 0.2s ease"
                        }}
                      >
                        <TrackRow
                          track={track}
                          project={project}
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

                        {/* Region info - clickable to select */}
                        {regions.length > 0 && (
                          <RadixBox px="4" pb="2">
                            <Flex gap="2" wrap="wrap">
                              {regions.map((region, idx) => {
                                const isSelected = selectedRegionUuid === region.uuid;
                                return (
                                  <Badge
                                    key={region.uuid}
                                    size="1"
                                    color={isSelected ? "blue" : "gray"}
                                    variant={isSelected ? "solid" : "soft"}
                                    style={{ cursor: "pointer" }}
                                    onClick={e => {
                                      e.stopPropagation();
                                      setSelectedRegionUuid(isSelected ? null : region.uuid);
                                      setSelectedTrackIndex(index);
                                    }}
                                  >
                                    Region {idx + 1}: {PPQN.pulsesToSeconds(region.position, BPM).toFixed(1)}s -{" "}
                                    {PPQN.pulsesToSeconds(region.position + region.duration, BPM).toFixed(1)}s
                                  </Badge>
                                );
                              })}
                            </Flex>
                          </RadixBox>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TracksContainer>
            </Flex>
          </Card>

          {/* Footer */}
          <Flex justify="center" pt="6">
            <MoisesLogo />
          </Flex>
        </Flex>
      </Container>
    </Theme>
  );
};

// Render the app
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(<App />);
