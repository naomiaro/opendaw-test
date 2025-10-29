// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { InstrumentFactories, Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW } from "./lib/projectSetup";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card
} from "@radix-ui/themes";

/**
 * Main Playback Demo App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tracks, setTracks] = useState<Array<{ name: string; uuid: UUID.Bytes }>>([]);
  const [peaksReady, setPeaksReady] = useState(false);

  // Refs for non-reactive values - these don't need to trigger re-renders
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());

  // Channel padding in pixels (matches OpenDAW pattern)
  const CHANNEL_PADDING = 4;

  // Initialize CanvasPainters for each track
  useEffect(() => {
    if (tracks.length === 0) return undefined;

    console.debug("[CanvasPainter] Initializing painters for", tracks.length, "tracks");

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
      const painter = new CanvasPainter(canvas, (_, context) => {
        const peaks = trackPeaksRef.current.get(uuidString);
        if (!peaks) {
          // Clear canvas if no peaks
          context.fillStyle = "#000";
          context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
          return;
        }

        // Clear canvas
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

        console.debug(`[Peaks] Rendering waveform for "${track.name}": ${peaks.numFrames} frames, ${peaks.numChannels} channels`);

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
      });

      canvasPaintersRef.current.set(uuidString, painter);
    });

    return () => {
      console.debug("[CanvasPainter] Cleaning up painters");
      canvasPaintersRef.current.forEach(painter => painter.terminate());
      canvasPaintersRef.current.clear();
    };
  }, [tracks, CHANNEL_PADDING]);

  // Subscribe to sample loader state changes for peaks
  useEffect(() => {
    if (!project || tracks.length === 0) return undefined;

    console.debug("[Peaks] Subscribing to sample loader state for", tracks.length, "tracks");

    const subscriptions: Array<{ terminate: () => void }> = [];
    let renderedCount = 0;

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
              renderedCount++;

              // Check if all peaks are rendered
              if (renderedCount === tracks.length) {
                console.debug("[Peaks] All waveforms rendered!");
                setPeaksReady(true);
                setStatus("Ready - Click Play to start");
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

  // Subscribe to engine observables - single source of truth!
  useEffect(() => {
    if (!project) return undefined;

    console.debug("[Playback] Subscribing to engine.isPlaying observable...");

    const playingSubscription = project.engine.isPlaying.catchupAndSubscribe(obs => {
      const playing = obs.getValue();
      console.debug("[ENGINE] isPlaying:", playing);
      setIsPlaying(playing);

      // Update status based on playing state and pause flag
      if (playing) {
        isPausedRef.current = false;
        setStatus("Playing...");
      } else if (isPausedRef.current) {
        setStatus("Paused");
      } else {
        setStatus("Stopped");
      }
    });

    // const positionSubscription = project.engine.position.subscribe(obs => {
    //   console.debug("[ENGINE] position:", obs.getValue());
    // });

    return () => {
      console.debug("[Playback] Cleaning up subscriptions...");
      playingSubscription.terminate();
      // positionSubscription.terminate();
    };
  }, [project]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Initialize OpenDAW with custom sample loading
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        const { Quarter } = PPQN;

        console.debug("Loading audio files...");
        setStatus("Loading audio files...");

        // Load all audio files from the public folder
        const audioFiles = [
          { name: "Bass & Drums", url: "/audio/BassDrums30.mp3" },
          { name: "Guitar", url: "/audio/Guitar30.mp3" },
          { name: "Piano & Synth", url: "/audio/PianoSynth30.mp3" },
          { name: "Vocals", url: "/audio/Vocals30.mp3" }
        ];

        const audioBuffers = await Promise.all(audioFiles.map(file => loadAudioFile(newAudioContext, file.url)));

        if (!mounted) return;

        console.debug("Audio files loaded, creating tracks...");
        setStatus("Creating tracks...");

        const { editing, api, boxGraph } = newProject;
        const loadedTracks: Array<{ name: string; uuid: UUID.Bytes }> = [];

        editing.modify(() => {
          // Create a tape track for each audio file
          audioFiles.forEach((file, index) => {
            const { audioUnitBox, trackBox } = api.createInstrument(InstrumentFactories.Tape);
            audioUnitBox.volume.setValue(-3);

            // Create an audio region for the full duration of the audio
            const audioBuffer = audioBuffers[index];
            const durationInPPQN = Math.ceil(((audioBuffer.duration * 120) / 60) * Quarter); // Assuming 120 BPM

            // Generate a UUID for this audio file
            const fileUUID = UUID.generate();
            const fileUUIDString = UUID.toString(fileUUID);

            // Store the audio buffer so our sample manager can load it
            localAudioBuffersRef.current.set(fileUUIDString, audioBuffer);

            // Store track info for waveform rendering (store UUID.Bytes, not string)
            loadedTracks.push({ name: file.name, uuid: fileUUID });

            // Create AudioFileBox
            const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
              box.fileName.setValue(file.name);
              box.endInSeconds.setValue(audioBuffer.duration);
            });

            // Create AudioRegionBox
            AudioRegionBox.create(boxGraph, UUID.generate(), box => {
              box.regions.refer(trackBox.regions);
              box.file.refer(audioFileBox);
              box.position.setValue(0); // Start at the beginning
              box.duration.setValue(durationInPPQN);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(durationInPPQN);
              box.label.setValue(file.name);
              box.mute.setValue(false);
            });

            console.debug(`Created track "${file.name}"`);
            console.debug(`  - Audio duration: ${audioBuffer.duration}s`);
            console.debug(`  - Duration in PPQN: ${durationInPPQN}`);
            console.debug(`  - AudioFile UUID: ${fileUUIDString}`);
          });
        });

        setTracks(loadedTracks);

        console.debug("Tracks created, generating waveforms...");
        console.debug(`Timeline position: ${newProject.engine.position.getValue()}`);
        console.debug(`BPM: ${newProject.bpm}`);

        // Make sure the timeline is at the beginning
        newProject.engine.setPosition(0);

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);
        setStatus("Generating waveforms...");
      } catch (error) {
        console.error("Initialization error:", error);
        setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

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
    // Note: setIsPlaying and setStatus are handled by the observable subscription
  }, [project, audioContext]);

  const handlePause = useCallback(() => {
    if (!project) return;

    console.debug("Pause button clicked");

    // Read current position from observable
    const currentPosition = project.engine.position.getValue();
    console.debug(`Current position from observable: ${currentPosition}`);

    // Save it for resume
    pausedPositionRef.current = currentPosition;
    console.debug(`Saved paused position: ${pausedPositionRef.current}`);

    // Mark as paused so the observable subscription shows "Paused" instead of "Stopped"
    isPausedRef.current = true;

    // Stop playback (don't reset position)
    project.engine.stop(false);
    // Note: setIsPlaying and setStatus are handled by the observable subscription
  }, [project]);

  const handleStop = useCallback(() => {
    if (!project) return;

    console.debug("Stop button clicked");
    // Clear any saved pause position
    pausedPositionRef.current = null;
    isPausedRef.current = false;
    // Stop and reset to beginning
    project.engine.stop(true);
    project.engine.setPosition(0);
    // Note: setIsPlaying and setStatus are handled by the observable subscription
  }, [project]);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">OpenDAW Multi-track Playback</Heading>
            <Text size="3" color="gray">{status}</Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" align="center" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">OpenDAW Multi-track Playback</Heading>
            <Text size="3" color="gray">Four-track audio playback demo</Text>
          </Flex>

          {tracks.length > 0 && (
            <Card style={{ width: "100%" }}>
              <Flex direction="column" gap="4">
                <Heading size="5" color="blue">Tracks {peaksReady && <Text size="2" color="gray" style={{ display: "inline" }}>(waveforms ready)</Text>}</Heading>
                <Flex direction="column" gap="3">
                  {tracks.map(track => {
                    const uuidString = UUID.toString(track.uuid);
                    return (
                      <Flex key={uuidString} direction="column" gap="2">
                        <Text size="2" weight="medium">{track.name}</Text>
                        <div style={{ background: "var(--gray-3)", borderRadius: "var(--radius-3)", padding: "var(--space-2)" }}>
                          <canvas
                            ref={el => {
                              if (el) canvasRefs.current.set(uuidString, el);
                            }}
                            style={{ width: "100%", height: "80px", display: "block" }}
                          />
                        </div>
                      </Flex>
                    );
                  })}
                </Flex>
              </Flex>
            </Card>
          )}

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Transport Controls</Heading>

              <Flex gap="3" wrap="wrap" justify="center">
                <Button
                  onClick={handlePlay}
                  disabled={isPlaying}
                  color="green"
                  size="3"
                  variant="solid"
                >
                  Play
                </Button>
                <Button
                  onClick={handlePause}
                  disabled={!isPlaying}
                  color="orange"
                  size="3"
                  variant="solid"
                >
                  Pause
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={!isPlaying}
                  color="red"
                  size="3"
                  variant="solid"
                >
                  Stop
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">{status}</Text>
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

// Bootstrap the React app
const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
