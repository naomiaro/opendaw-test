// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { InstrumentFactories, Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { RegionEditing } from "@opendaw/studio-adapters";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TrackRow, type TrackData } from "./components/TrackRow";
import { TransportControls } from "./components/TransportControls";
import { TimelineRuler } from "./components/TimelineRuler";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW, setLoopEndFromTracks } from "./lib/projectSetup";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Button,
  Separator,
  Callout,
  Badge,
  IconButton,
  Box
} from "@radix-ui/themes";

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
  const [regionInfo, setRegionInfo] = useState<Map<string, any[]>>(new Map());

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());
  const visuallyRenderedTracksRef = useRef<Set<string>>(new Set());
  const pausedPositionRef = useRef<number | null>(null);
  const currentPositionRef = useRef<number>(0);
  const bpmRef = useRef<number>(124);
  const tracksContainerRef = useRef<HTMLDivElement>(null);

  const CHANNEL_PADDING = 4;
  const BPM = 124; // Dark Ride BPM

  // Initialize CanvasPainters for waveform rendering
  useEffect(() => {
    if (tracks.length === 0 || !project) return undefined;

    console.debug("[CanvasPainter] Initializing painters for", tracks.length, "tracks");

    const lastRenderedPeaks = new Map<string, any>();

    tracks.forEach(track => {
      const uuidString = UUID.toString(track.uuid);
      const canvas = canvasRefs.current.get(uuidString);

      if (!canvas) {
        console.debug(`[CanvasPainter] Canvas not ready for "${track.name}"`);
        return;
      }

      // Don't reinitialize if painter already exists
      if (canvasPaintersRef.current.has(uuidString)) {
        return;
      }

      console.debug(`[CanvasPainter] Creating painter for "${track.name}"`);

      // Create painter with rendering callback
      const painter = new CanvasPainter(canvas, (canvasPainter, context) => {
        const peaks = trackPeaksRef.current.get(uuidString);
        if (!peaks) {
          // Clear canvas if no peaks
          context.fillStyle = "#000";
          context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
          return;
        }

        // Skip rendering if peaks haven't changed AND canvas wasn't resized
        if (lastRenderedPeaks.get(uuidString) === peaks && !canvasPainter.wasResized) {
          return;
        }

        // Clear canvas
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

        // Set waveform color
        context.fillStyle = "#4a9eff";

        // Calculate channel layout with padding
        const totalHeight = canvas.clientHeight;
        const numChannels = peaks.numChannels;
        const channelHeight = totalHeight / numChannels;

        // Render each channel with padding
        for (let channel = 0; channel < numChannels; channel++) {
          const y0 = channel * channelHeight + CHANNEL_PADDING / 2;
          const y1 = (channel + 1) * channelHeight - CHANNEL_PADDING / 2;

          PeaksPainter.renderBlocks(context, peaks, channel, {
            x0: 0,
            x1: canvas.clientWidth,
            y0,
            y1,
            u0: 0,
            u1: peaks.numFrames,
            v0: -1,
            v1: 1
          });
        }

        lastRenderedPeaks.set(uuidString, peaks);
      });

      canvasPaintersRef.current.set(uuidString, painter);
    });

    return () => {
      console.debug("[CanvasPainter] Cleaning up painters");
      canvasPaintersRef.current.forEach(painter => painter.terminate());
      canvasPaintersRef.current.clear();
    };
  }, [tracks, project]);

  // Subscribe to sample loader state changes for peaks
  useEffect(() => {
    if (!project || tracks.length === 0) return undefined;

    console.debug("[Peaks] Subscribing to sample loader state for", tracks.length, "tracks");

    const subscriptions: Array<{ terminate: () => void }> = [];

    tracks.forEach(track => {
      const uuidString = UUID.toString(track.uuid);

      // Get the sample loader and subscribe to state changes
      const sampleLoader = project.sampleManager.getOrCreate(track.uuid);

      const subscription = sampleLoader.subscribe(state => {
        console.debug(`[Peaks] Sample loader state for "${track.name}":`, state.type);

        // When state becomes "loaded", peaks are ready
        if (state.type === "loaded") {
          const peaksOption = sampleLoader.peaks;

          if (!peaksOption.isEmpty()) {
            const peaks = peaksOption.unwrap();

            // Store peaks and request render
            trackPeaksRef.current.set(uuidString, peaks);
            const painter = canvasPaintersRef.current.get(uuidString);
            if (painter) {
              painter.requestUpdate();
              visuallyRenderedTracksRef.current.add(uuidString);
              console.debug(`[CanvasPainter] Rendered "${track.name}"`);

              // Check if all tracks are loaded
              if (visuallyRenderedTracksRef.current.size === tracks.length) {
                console.debug("[Rendering] All waveforms loaded!");
                setStatus("Ready to play!");
              }
            }
          }
        }
      });

      subscriptions.push(subscription);
    });

    return () => {
      console.debug("[Peaks] Cleaning up sample loader subscriptions");
      subscriptions.forEach(sub => sub.terminate());
    };
  }, [project, tracks]);

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
          if (mounted) setCurrentPosition(obs.getValue());
        });

        // Subscribe to AnimationFrame for efficient playhead position updates
        animationFrameSubscription = AnimationFrame.add(() => {
          // Update position for playhead rendering (used by SVG overlay)
          const position = newProject.engine.position.getValue();
          currentPositionRef.current = position;

          // Update React state to trigger playhead re-render
          if (mounted && newProject.engine.isPlaying.getValue()) {
            setCurrentPosition(position);
          }
        });

        // Load audio files and create tracks
        await setupTracks(newProject, newAudioContext, localAudioBuffers);

        if (mounted) {
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

  // Setup tracks with audio files
  const setupTracks = async (proj: Project, ctx: AudioContext, audioBuffers: Map<string, AudioBuffer>) => {
    const bpm = proj.timelineBox.bpm.getValue();
    const boxGraph = proj.boxGraph;

    // Define audio files to load - only 4 tracks for editing demo
    const samples = [
      { name: "Drums", file: "/audio/DarkRide/02_Drums.ogg" },
      { name: "Bass", file: "/audio/DarkRide/03_Bass.ogg" },
      { name: "Guitar", file: "/audio/DarkRide/04_ElecGtrs.ogg" },
      { name: "Vocals", file: "/audio/DarkRide/06_Vox.ogg" }
    ];

    const loadedTracks: TrackData[] = [];

    for (const sample of samples) {
      try {
        // Load audio file
        const audioBuffer = await loadAudioFile(ctx, sample.file);
        const fileUUID = UUID.generate();
        const uuidString = UUID.toString(fileUUID);

        audioBuffers.set(uuidString, audioBuffer);

        proj.editing.modify(() => {
          // Create track with Tape instrument
          const { audioUnitBox, trackBox } = proj.api.createInstrument(InstrumentFactories.Tape);

          // Set default volume
          audioUnitBox.volume.setValue(0);

          // Create audio file box
          const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
            box.fileName.setValue(sample.name);
            box.endInSeconds.setValue(audioBuffer.duration);
          });

          // Create audio region for the full duration of the audio
          const clipDurationInPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);

          AudioRegionBox.create(boxGraph, UUID.generate(), box => {
            box.regions.refer(trackBox.regions);
            box.file.refer(audioFileBox);
            box.position.setValue(0); // Start at the beginning
            box.duration.setValue(clipDurationInPPQN);
            box.loopOffset.setValue(0);
            box.loopDuration.setValue(clipDurationInPPQN);
            box.label.setValue(sample.name);
            box.mute.setValue(false);
          });

          console.debug(`Created track "${sample.name}"`);
          console.debug(`  - Audio duration: ${audioBuffer.duration}s`);
          console.debug(`  - Duration in PPQN: ${clipDurationInPPQN}`);
          console.debug(`  - AudioFile UUID: ${uuidString}`);

          loadedTracks.push({
            name: sample.name,
            trackBox,
            audioUnitBox,
            uuid: fileUUID
          });
        });
      } catch (error) {
        console.error(`Failed to load ${sample.name}:`, error);
      }
    }

    setTracks(loadedTracks);

    // Set loop end to accommodate the longest track
    setLoopEndFromTracks(proj, audioBuffers, bpm);

    // Update region info
    updateRegionInfo(proj);

    console.debug("Tracks created, generating waveforms...");
    console.debug(`Timeline position: ${proj.engine.position.getValue()}`);
    console.debug(`BPM: ${bpm}`);

    // Make sure the timeline is at the beginning
    proj.engine.setPosition(0);
  };

  // Update region information for all tracks
  const updateRegionInfo = useCallback((proj: Project) => {
    if (!proj) return;

    const regionMap = new Map<string, any[]>();

    // Access regions using pointerHub to get all region boxes
    tracks.forEach((track, index) => {
      const regionList: any[] = [];

      // Get all pointers from the regions collection
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({box: regionBox}) => {
        if (!regionBox) return;

        regionList.push({
          uuid: UUID.toString(regionBox.address.uuid),
          position: regionBox.position.getValue(),
          duration: regionBox.duration.getValue(),
          label: regionBox.label.getValue()
        });
      });

      regionMap.set(track.name, regionList);
    });

    setRegionInfo(regionMap);
  }, [tracks]);

  // Initial region info update
  useEffect(() => {
    if (!project || tracks.length === 0) return;
    updateRegionInfo(project);
  }, [project, tracks, updateRegionInfo]);

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
    const playheadPosition = currentPositionRef.current;

    console.debug(`Splitting track "${track.name}" at position ${playheadPosition}`);

    project.editing.modify(() => {
      // Get all regions from this track using pointerHub
      const pointers = track.trackBox.regions.pointerHub.incoming();

      // Find region that contains the playhead
      pointers.forEach(({box: regionBox}) => {
        if (!regionBox) return;

        const regionAdapter = project.adapters.audioRegionBox.get(regionBox);
        if (!regionAdapter) return;

        const regionStart = regionAdapter.position;
        const regionEnd = regionStart + regionAdapter.duration;

        // Check if playhead is within this region
        if (playheadPosition > regionStart && playheadPosition < regionEnd) {
          console.debug(`Found region to split: ${regionAdapter.box.label.getValue()}`);
          RegionEditing.cut(regionAdapter, playheadPosition, true);
        }
      });
    });

    updateRegionInfo(project);
  }, [project, selectedTrackIndex, tracks, updateRegionInfo]);

  const handleMoveRegionForward = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    const moveAmount = PPQN.secondsToPulses(1, BPM); // Move by 1 second

    console.debug(`Moving regions in track "${track.name}" forward by ${moveAmount} PPQN`);

    project.editing.modify(() => {
      // Get all regions from this track using pointerHub
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({box: regionBox}) => {
        if (!regionBox) return;

        const currentPosition = regionBox.position.getValue();
        regionBox.position.setValue(currentPosition + moveAmount);
      });
    });

    updateRegionInfo(project);
  }, [project, selectedTrackIndex, tracks, updateRegionInfo]);

  const handleMoveRegionBackward = useCallback(() => {
    if (!project || selectedTrackIndex === null) return;

    const track = tracks[selectedTrackIndex];
    const moveAmount = PPQN.secondsToPulses(1, BPM); // Move by 1 second

    console.debug(`Moving regions in track "${track.name}" backward by ${moveAmount} PPQN`);

    project.editing.modify(() => {
      // Get all regions from this track using pointerHub
      const pointers = track.trackBox.regions.pointerHub.incoming();

      pointers.forEach(({box: regionBox}) => {
        if (!regionBox) return;

        const currentPosition = regionBox.position.getValue();
        const newPosition = Math.max(0, currentPosition - moveAmount);
        regionBox.position.setValue(newPosition);
      });
    });

    updateRegionInfo(project);
  }, [project, selectedTrackIndex, tracks, updateRegionInfo]);

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
  const maxDuration = Math.max(
    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
    30
  );

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
                  <strong>2. Use transport controls</strong> to play, pause, or stop the audio
                </Text>
                <Text size="2">
                  <strong>3. Split regions</strong> - Position the playhead and click "Split at Playhead" to cut the
                  region
                </Text>
                <Text size="2">
                  <strong>4. Move regions</strong> - Use "Move Forward" / "Move Backward" buttons to reposition
                  regions (1 second increments)
                </Text>
              </Flex>
              <Callout.Root size="1" color="blue">
                <Callout.Text>
                  All edits are non-destructive! The original audio files remain unchanged.
                </Callout.Text>
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
                  <Text size="2" color="gray">
                    Selected track: <strong>{tracks[selectedTrackIndex]?.name}</strong>
                  </Text>
                  <Flex gap="2" wrap="wrap">
                    <Button onClick={handleSplitAtPlayhead} variant="soft" size="2">
                      Split at Playhead
                    </Button>
                    <Button onClick={handleMoveRegionBackward} variant="soft" size="2">
                      ← Move Backward (1s)
                    </Button>
                    <Button onClick={handleMoveRegionForward} variant="soft" size="2">
                      Move Forward (1s) →
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

              {/* Timeline Ruler */}
              <TimelineRuler maxDuration={maxDuration} />

              {/* Track List */}
              <div ref={tracksContainerRef}>
                {tracks.map((track, index) => {
                  const uuidString = UUID.toString(track.uuid);
                  const regions = regionInfo.get(track.name) || [];

                  return (
                    <div
                      key={uuidString}
                      onClick={() => setSelectedTrackIndex(index)}
                      style={{
                        cursor: "pointer",
                        border: selectedTrackIndex === index ? "2px solid var(--blue-9)" : "2px solid transparent",
                        borderRadius: "4px",
                        marginBottom: "8px",
                        backgroundColor:
                          selectedTrackIndex === index ? "var(--blue-2)" : "transparent",
                        transition: "all 0.2s ease"
                      }}
                    >
                      <TrackRow
                        track={track}
                        project={project}
                        allTracks={tracks}
                        peaks={trackPeaksRef.current.get(uuidString)}
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

                      {/* Region info */}
                      {regions.length > 0 && (
                        <Box px="4" pb="2">
                          <Flex gap="2" wrap="wrap">
                            {regions.map((region, idx) => (
                              <Badge key={region.uuid} size="1" color="gray">
                                Region {idx + 1}: {PPQN.pulsesToSeconds(region.position, BPM).toFixed(1)}s -{" "}
                                {PPQN.pulsesToSeconds(region.position + region.duration, BPM).toFixed(1)}s
                              </Badge>
                            ))}
                          </Flex>
                        </Box>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Playhead overlay */}
              {currentPosition > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: `calc(200px + ${(PPQN.pulsesToSeconds(currentPosition, BPM) / maxDuration) * 100}%)`,
                    top: 0,
                    bottom: 0,
                    width: "2px",
                    backgroundColor: "var(--red-9)",
                    pointerEvents: "none",
                    zIndex: 10
                  }}
                />
              )}
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
