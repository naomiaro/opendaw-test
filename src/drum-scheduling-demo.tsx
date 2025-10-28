// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { InstrumentFactories, Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "./components/GitHubCorner";
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
  Card,
  Badge,
  Separator
} from "@radix-ui/themes";

// Type for scheduled clip
type ScheduledClip = {
  trackName: string;
  position: number; // in PPQN
  duration: number; // in PPQN
  label: string;
  color: string;
};

/**
 * Main Drum Scheduling Demo App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduledClips, setScheduledClips] = useState<ScheduledClip[]>([]);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [bpm, setBpm] = useState(90);

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  const { Quarter } = PPQN;
  const BARS = 4;
  const BEATS_PER_BAR = 4;
  const TOTAL_BEATS = BARS * BEATS_PER_BAR;

  // Subscribe to engine observables
  useEffect(() => {
    if (!project) return undefined;

    console.debug("[Playback] Subscribing to engine observables...");

    const playingSubscription = project.engine.isPlaying.catchupAndSubscribe(obs => {
      setIsPlaying(obs.getValue());
    });

    const positionSubscription = project.engine.position.catchupAndSubscribe(obs => {
      setCurrentPosition(obs.getValue());
    });

    return () => {
      console.debug("[Playback] Cleaning up subscriptions...");
      playingSubscription.terminate();
      positionSubscription.terminate();
    };
  }, [project]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Initialize OpenDAW with custom sample loading and BPM
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: localAudioBuffersRef.current,
          bpm: bpm,
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        console.debug("Loading drum samples...");
        setStatus("Loading drum samples...");

        // Load drum samples
        const drumSamples = [
          { name: "Kick", url: "/audio/90sSamplePack/Kick/Kick 1.wav", color: "#ef4444" },
          { name: "Snare", url: "/audio/90sSamplePack/Snare/Snare 1.wav", color: "#f59e0b" },
          { name: "Hi-Hat Closed", url: "/audio/90sSamplePack/Hats/Hi Hat 1.wav", color: "#10b981" },
          { name: "Hi-Hat Open", url: "/audio/90sSamplePack/Hats/Hi Hat 20.wav", color: "#06b6d4" }
        ];

        const audioBuffers = await Promise.all(drumSamples.map(sample => loadAudioFile(newAudioContext, sample.url)));

        if (!mounted) return;

        console.debug("Drum samples loaded, creating pattern...");
        setStatus("Creating drum pattern...");

        const { editing, api, boxGraph } = newProject;
        const clips: ScheduledClip[] = [];

        editing.modify(() => {
          // Create a tape track for each drum type
          drumSamples.forEach((sample, index) => {
            const { audioUnitBox, trackBox } = api.createInstrument(InstrumentFactories.Tape);
            audioUnitBox.volume.setValue(0);

            const audioBuffer = audioBuffers[index];

            // Generate a UUID for this audio file
            const fileUUID = UUID.generate();
            const fileUUIDString = UUID.toString(fileUUID);

            // Store the audio buffer
            localAudioBuffersRef.current.set(fileUUIDString, audioBuffer);

            // Create AudioFileBox
            const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
              box.fileName.setValue(sample.name);
              box.endInSeconds.setValue(audioBuffer.duration);
            });

            // Calculate clip duration - most drum hits are short, use actual duration
            const clipDurationInPPQN = Math.ceil(((audioBuffer.duration * bpm) / 60) * Quarter);

            // Create a drum pattern based on the drum type
            let positions: number[] = [];

            if (sample.name === "Kick") {
              // Kick on beats 1 and 3 of each bar (every 4 quarter notes)
              positions = Array.from({ length: BARS * 2 }, (_, i) => i * Quarter * 2);
            } else if (sample.name === "Snare") {
              // Snare on beats 2 and 4 of each bar
              positions = Array.from({ length: BARS * 2 }, (_, i) => Quarter + i * Quarter * 2);
            } else if (sample.name === "Hi-Hat Closed") {
              // Closed hi-hat on every eighth note (alternating with open)
              positions = Array.from({ length: TOTAL_BEATS * 2 }, (_, i) => i * (Quarter / 2)).filter(
                (_, i) => i % 2 === 0
              );
            } else if (sample.name === "Hi-Hat Open") {
              // Open hi-hat on alternating eighth notes
              positions = Array.from({ length: TOTAL_BEATS * 2 }, (_, i) => i * (Quarter / 2)).filter(
                (_, i) => i % 2 === 1
              );
            }

            // Create AudioRegionBox for each position
            positions.forEach((position, clipIndex) => {
              AudioRegionBox.create(boxGraph, UUID.generate(), box => {
                box.regions.refer(trackBox.regions);
                box.file.refer(audioFileBox);
                box.position.setValue(position);
                box.duration.setValue(clipDurationInPPQN);
                box.loopOffset.setValue(0);
                box.loopDuration.setValue(clipDurationInPPQN);
                box.label.setValue(`${sample.name} ${clipIndex + 1}`);
                box.mute.setValue(false);
              });

              // Store clip info for visualization
              clips.push({
                trackName: sample.name,
                position,
                duration: clipDurationInPPQN,
                label: `${sample.name} ${clipIndex + 1}`,
                color: sample.color
              });
            });

            console.debug(`Created track "${sample.name}" with ${positions.length} clips`);
          });
        });

        setScheduledClips(clips);

        console.debug("Pattern created!");
        console.debug(`Timeline position: ${newProject.engine.position.getValue()}`);
        console.debug(`BPM: ${newProject.bpm}`);

        // Make sure the timeline is at the beginning
        newProject.engine.setPosition(0);

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);
        setStatus("Ready - Click Play to hear the drum pattern!");
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

    console.debug("Starting playback...");
    project.engine.play();
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;

    console.debug("Stop button clicked");
    project.engine.stop(true);
    project.engine.setPosition(0);
  }, [project]);

  const handleBpmChange = useCallback((newBpm: number) => {
    if (!project) return;

    console.debug(`BPM changed to ${newBpm}`);

    // Update BPM in OpenDAW project
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(newBpm);
    });

    // Update local state
    setBpm(newBpm);
  }, [project]);

  // Timeline visualization
  const renderTimeline = () => {
    if (scheduledClips.length === 0) return null;

    const totalDuration = BARS * BEATS_PER_BAR * Quarter;
    const timelineWidth = 800;
    const trackHeight = 60;
    const tracks = ["Kick", "Snare", "Hi-Hat Closed", "Hi-Hat Open"];

    return (
      <div style={{ position: "relative", width: `${timelineWidth}px`, margin: "0 auto" }}>
        {/* Timeline background */}
        <svg width={timelineWidth} height={tracks.length * trackHeight} style={{ background: "#1a1a1a", borderRadius: "8px" }}>
          {/* Grid lines for beats */}
          {Array.from({ length: TOTAL_BEATS + 1 }, (_, i) => {
            const x = (i * Quarter / totalDuration) * timelineWidth;
            const isMeasure = i % BEATS_PER_BAR === 0;
            return (
              <line
                key={`grid-${i}`}
                x1={x}
                y1={0}
                x2={x}
                y2={tracks.length * trackHeight}
                stroke={isMeasure ? "#555" : "#333"}
                strokeWidth={isMeasure ? 2 : 1}
              />
            );
          })}

          {/* Track separators */}
          {tracks.map((_, i) => (
            <line
              key={`track-${i}`}
              x1={0}
              y1={(i + 1) * trackHeight}
              x2={timelineWidth}
              y2={(i + 1) * trackHeight}
              stroke="#333"
              strokeWidth={1}
            />
          ))}

          {/* Track labels */}
          {tracks.map((track, i) => (
            <text
              key={`label-${i}`}
              x={10}
              y={i * trackHeight + 25}
              fill="#888"
              fontSize="12"
              fontFamily="system-ui"
            >
              {track}
            </text>
          ))}

          {/* Clips */}
          {scheduledClips.map((clip, i) => {
            const trackIndex = tracks.indexOf(clip.trackName);
            const x = (clip.position / totalDuration) * timelineWidth;
            const width = Math.max(4, (clip.duration / totalDuration) * timelineWidth);
            const y = trackIndex * trackHeight + 10;
            const height = trackHeight - 20;

            return (
              <rect
                key={`clip-${i}`}
                x={x}
                y={y}
                width={width}
                height={height}
                fill={clip.color}
                rx={3}
                opacity={0.8}
              />
            );
          })}

          {/* Playhead */}
          {isPlaying && (
            <line
              x1={(currentPosition / totalDuration) * timelineWidth}
              y1={0}
              x2={(currentPosition / totalDuration) * timelineWidth}
              y2={tracks.length * trackHeight}
              stroke="#fff"
              strokeWidth={2}
            />
          )}
        </svg>

        {/* Beat numbers */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", color: "#888", fontSize: "12px" }}>
          {Array.from({ length: TOTAL_BEATS + 1 }, (_, i) => (
            <div key={`beat-${i}`} style={{ width: `${100 / TOTAL_BEATS}%`, textAlign: i === 0 ? "left" : "center" }}>
              {i % BEATS_PER_BAR === 0 ? `Bar ${i / BEATS_PER_BAR + 1}` : ""}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">Drum Scheduling Demo</Heading>
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
            <Heading size="8">Drum Scheduling Demo</Heading>
            <Text size="3" color="gray">90s-style drum pattern with visual timeline</Text>
          </Flex>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Heading size="5" color="blue">Pattern Info</Heading>
                <Badge color="green" size="2">{bpm} BPM</Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Flex justify="between">
                  <Text size="2" color="gray">Total Clips:</Text>
                  <Text size="2" weight="bold">{scheduledClips.length}</Text>
                </Flex>
                <Flex justify="between">
                  <Text size="2" color="gray">Duration:</Text>
                  <Text size="2" weight="bold">{BARS} bars ({TOTAL_BEATS} beats)</Text>
                </Flex>
                <Flex justify="between">
                  <Text size="2" color="gray">Pattern:</Text>
                  <Text size="2" weight="bold">Classic boom-bap with hi-hats</Text>
                </Flex>
              </Flex>
            </Flex>
          </Card>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Timeline</Heading>
              <Text size="2" color="gray">
                Each colored block represents a scheduled drum hit. Watch the white playhead move across the timeline as the pattern plays.
              </Text>
              {renderTimeline()}
              <Flex direction="column" gap="2" mt="3">
                <Flex gap="4" wrap="wrap">
                  <Flex align="center" gap="2">
                    <div style={{ width: 16, height: 16, background: "#ef4444", borderRadius: 3 }} />
                    <Text size="2">Kick</Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <div style={{ width: 16, height: 16, background: "#f59e0b", borderRadius: 3 }} />
                    <Text size="2">Snare</Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <div style={{ width: 16, height: 16, background: "#10b981", borderRadius: 3 }} />
                    <Text size="2">Closed Hat</Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <div style={{ width: 16, height: 16, background: "#06b6d4", borderRadius: 3 }} />
                    <Text size="2">Open Hat</Text>
                  </Flex>
                </Flex>
              </Flex>
            </Flex>
          </Card>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Transport Controls</Heading>

              <Flex direction="column" gap="3">
                <Flex direction="column" gap="2">
                  <Flex justify="between" align="center">
                    <Text size="2" weight="bold">Tempo</Text>
                    <Text size="2" color="gray">{bpm} BPM</Text>
                  </Flex>
                  <input
                    type="range"
                    min="60"
                    max="180"
                    value={bpm}
                    onChange={(e) => handleBpmChange(Number(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: "var(--accent-9)"
                    }}
                  />
                  <Flex justify="between">
                    <Text size="1" color="gray">60 BPM</Text>
                    <Text size="1" color="gray">180 BPM</Text>
                  </Flex>
                </Flex>

                <Separator size="4" />

                <Flex gap="3" wrap="wrap" justify="center">
                  <Button
                    onClick={handlePlay}
                    disabled={isPlaying}
                    color="green"
                    size="3"
                    variant="solid"
                  >
                    Play Pattern
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
              </Flex>
              <Text size="2" align="center" color="gray">{status}</Text>
            </Flex>
          </Card>

          <Card style={{ width: "100%", background: "var(--gray-2)" }}>
            <Flex direction="column" gap="2">
              <Text size="2" color="gray" align="center">
                Samples from{" "}
                <a
                  href="https://soundpacks.com/free-sound-packs/90s-mpc-sample-pack/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent-9)", textDecoration: "none" }}
                >
                  90s MPC Sample Pack
                </a>
                {" "}by SoundPacks.com
              </Text>
            </Flex>
          </Card>
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
