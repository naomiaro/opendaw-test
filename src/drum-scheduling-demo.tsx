// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { AudioPlayback } from "@opendaw/studio-enums";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW } from "./lib/projectSetup";
import { useAudioExport } from "./hooks/useAudioExport";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Button, Flex, Card, Badge, Separator } from "@radix-ui/themes";

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
  const [samplesLoaded, setSamplesLoaded] = useState(false);

  // Audio export hook
  const {
    isExporting,
    exportStatus,
    handleExportMix,
    handleExportStems
  } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: `drum-pattern-${bpm}bpm`
  });

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const sampleUUIDsRef = useRef<UUID.Bytes[]>([]);
  const audioRegionsRef = useRef<Array<{ box: any; audioDuration: number }>>([]); // Store region refs for BPM updates
  const clipTemplatesRef = useRef<
    Array<{ trackName: string; position: number; audioDuration: number; label: string; color: string }>
  >([]); // Templates for recalculating clips
  const trackAudioBoxesRef = useRef<Array<{ name: string; audioUnitBox: any }>>([]); // Track audio boxes for stem export

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

    // Use AnimationFrame to throttle position updates to once per frame
    const positionSubscription = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
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

        // Load drum samples (selected for short duration to prevent overlapping regions)
        const drumSamples = [
          { name: "Kick", url: "/audio/90sSamplePack/Kick/Kick 2.wav", color: "#ef4444" },
          { name: "Snare", url: "/audio/90sSamplePack/Snare/Snare 5.wav", color: "#f59e0b" },
          { name: "Hi-Hat Closed", url: "/audio/90sSamplePack/Hats/Hi Hat 27.wav", color: "#10b981" },
          { name: "Hi-Hat Open", url: "/audio/90sSamplePack/Hats/Hi Hat 29.wav", color: "#06b6d4" }
        ];

        const audioBuffers = await Promise.all(drumSamples.map(sample => loadAudioFile(newAudioContext, sample.url)));

        if (!mounted) return;

        console.debug("Drum samples loaded, creating pattern...");
        setStatus("Creating drum pattern...");

        const { editing, api, boxGraph } = newProject;
        const clips: ScheduledClip[] = [];
        const sampleUUIDs: UUID.Bytes[] = [];

        editing.modify(() => {
          // Create a tape track for each drum type
          drumSamples.forEach((sample, index) => {
            const { audioUnitBox, trackBox } = api.createInstrument(InstrumentFactories.Tape);
            audioUnitBox.volume.setValue(0);

            const audioBuffer = audioBuffers[index];

            // Generate a UUID for this audio file
            const fileUUID = UUID.generate();
            const fileUUIDString = UUID.toString(fileUUID);

            // Store track name for stem export (we'll get UUIDs from project.rootBoxAdapter later)
            trackAudioBoxesRef.current.push({
              name: sample.name,
              audioUnitBox: audioUnitBox
            });

            // Store the UUID for sample loading tracking
            sampleUUIDs.push(fileUUID);

            // Store the audio buffer first
            localAudioBuffersRef.current.set(fileUUIDString, audioBuffer);

            // Create AudioFileBox with proper duration
            const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
              box.fileName.setValue(sample.name);
              box.endInSeconds.setValue(audioBuffer.duration);
            });

            // Calculate clip duration using OpenDAW's utility function
            const clipDurationInPPQN = PPQN.secondsToPulses(audioBuffer.duration, bpm);

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
              const regionBox = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
                box.regions.refer(trackBox.regions);
                box.file.refer(audioFileBox);
                box.playback.setValue(AudioPlayback.NoSync); // NoSync: plays at original speed/pitch, ignores BPM
                box.position.setValue(position);
                box.duration.setValue(clipDurationInPPQN);
                box.loopOffset.setValue(0);
                box.loopDuration.setValue(clipDurationInPPQN);
                box.label.setValue(`${sample.name} ${clipIndex + 1}`);
                box.mute.setValue(false);
              });

              // Store region reference for BPM updates
              audioRegionsRef.current.push({
                box: regionBox,
                audioDuration: audioBuffer.duration
              });

              // Store clip template for BPM-based recalculation
              clipTemplatesRef.current.push({
                trackName: sample.name,
                position,
                audioDuration: audioBuffer.duration,
                label: `${sample.name} ${clipIndex + 1}`,
                color: sample.color
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
        console.debug(`BPM: ${newProject.timelineBox.bpm.getValue()}`);

        // Make sure the timeline is at the beginning
        newProject.engine.setPosition(0);

        if (!mounted) return;

        // Store sample UUIDs for loading tracking
        sampleUUIDsRef.current = sampleUUIDs;

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);
      } catch (error) {
        console.error("Initialization error:", error);
        setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to sample loader states to track when all samples are fully loaded
  useEffect(() => {
    if (!project || sampleUUIDsRef.current.length === 0) return undefined;

    console.debug("[SampleLoading] Setting up sample loading tracking for", sampleUUIDsRef.current.length, "samples");

    const subscriptions: Array<{ terminate: () => void }> = [];
    let loadedCount = 0;

    sampleUUIDsRef.current.forEach(uuid => {
      const sampleLoader = project.sampleManager.getOrCreate(uuid);
      const uuidString = UUID.toString(uuid);

      const subscription = sampleLoader.subscribe(state => {
        console.debug(`[SampleLoading] Sample ${uuidString} state:`, state.type);

        if (state.type === "loaded") {
          loadedCount++;
          console.debug(`[SampleLoading] ${loadedCount}/${sampleUUIDsRef.current.length} samples loaded`);

          if (loadedCount === sampleUUIDsRef.current.length) {
            console.debug("[SampleLoading] All samples loaded! BPM changes are now safe.");
            setSamplesLoaded(true);
            setStatus("Ready - Click Play to hear the drum pattern!");
          }
        }
      });

      subscriptions.push(subscription);
    });

    return () => {
      console.debug("[SampleLoading] Cleaning up sample loading subscriptions");
      subscriptions.forEach(sub => sub.terminate());
    };
  }, [project]);

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

  const handleBpmChange = useCallback(
    (newBpm: number) => {
      if (!project || !samplesLoaded) {
        console.warn("Cannot change BPM: samples not fully loaded yet");
        return;
      }

      console.debug(`[BPM Change] Changing from ${bpm} to ${newBpm}`);

      // Update BPM and recalculate region durations
      project.editing.modify(() => {
        // Update timeline BPM
        project.timelineBox.bpm.setValue(newBpm);

        // Recalculate duration in PPQN for all regions
        // Even with NoSync mode, the duration needs to match the timeline's PPQN units
        audioRegionsRef.current.forEach(({ box, audioDuration }) => {
          const newDurationInPPQN = PPQN.secondsToPulses(audioDuration, newBpm);
          box.duration.setValue(newDurationInPPQN);
          box.loopDuration.setValue(newDurationInPPQN);
        });
      });

      // Recalculate clip durations for timeline visualization
      const updatedClips = clipTemplatesRef.current.map(template => {
        const newDurationInPPQN = PPQN.secondsToPulses(template.audioDuration, newBpm);
        return {
          trackName: template.trackName,
          position: template.position,
          duration: newDurationInPPQN,
          label: template.label,
          color: template.color
        };
      });
      setScheduledClips(updatedClips);

      // Update local state
      setBpm(newBpm);
    },
    [project, samplesLoaded, bpm]
  );

  // Wrapper for stems export with drum demo configuration
  const handleDrumStems = useCallback(async () => {
    await handleExportStems({
      includeAudioEffects: false, // No effects in drum demo
      includeSends: false
    });
  }, [handleExportStems]);

  // Timeline visualization
  const renderTimeline = () => {
    if (scheduledClips.length === 0) return null;

    const totalDuration = BARS * BEATS_PER_BAR * Quarter;
    const timelineWidth = 800;
    const trackHeight = 90;
    const tracks = ["Kick", "Snare", "Hi-Hat Closed", "Hi-Hat Open"];

    return (
      <div style={{ position: "relative", width: `${timelineWidth}px`, margin: "0 auto" }}>
        {/* Timeline background */}
        <svg
          width={timelineWidth}
          height={tracks.length * trackHeight}
          style={{ background: "#1a1a1a", borderRadius: "8px" }}
        >
          {/* SVG Filter Definitions */}
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid lines for beats */}
          {Array.from({ length: TOTAL_BEATS + 1 }, (_, i) => {
            const x = ((i * Quarter) / totalDuration) * timelineWidth;
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

          {/* Track labels with colored backgrounds */}
          {tracks.map((track, i) => {
            // Find the color for this track from the scheduled clips
            const trackClip = scheduledClips.find(clip => clip.trackName === track);
            const trackColor = trackClip?.color || "#888";

            return (
              <g key={`label-${i}`}>
                {/* Background rectangle for label */}
                <rect x={0} y={i * trackHeight} width={150} height={20} fill="#000" opacity={0.7} />
                {/* Track label text */}
                <text
                  x={8}
                  y={i * trackHeight + 14}
                  fill={trackColor}
                  fontSize="14"
                  fontWeight="bold"
                  fontFamily="system-ui"
                >
                  {track}
                </text>
              </g>
            );
          })}

          {/* Clips */}
          {scheduledClips.map((clip, i) => {
            const trackIndex = tracks.indexOf(clip.trackName);
            const x = (clip.position / totalDuration) * timelineWidth;
            const width = Math.max(4, (clip.duration / totalDuration) * timelineWidth);
            const y = trackIndex * trackHeight + 25; // Start below label
            const height = trackHeight - 30; // More padding for label space

            // Check if playhead is inside this clip AND we're playing
            const isActive =
              isPlaying && currentPosition >= clip.position && currentPosition < clip.position + clip.duration;

            return (
              <g key={`clip-${i}`}>
                {/* Glow effect when active */}
                {isActive && (
                  <rect
                    x={x - 2}
                    y={y - 2}
                    width={width + 4}
                    height={height + 4}
                    fill={clip.color}
                    rx={5}
                    opacity={0.4}
                    filter="url(#glow)"
                  />
                )}
                {/* Main clip rectangle */}
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={clip.color}
                  rx={3}
                  opacity={isActive ? 1.0 : 0.8}
                  style={{
                    transition: "opacity 0.1s ease-in-out"
                  }}
                />
              </g>
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

        {/* Bar labels with alternating colored backgrounds */}
        <div style={{ position: "relative", marginTop: "8px", height: "32px", width: `${timelineWidth}px` }}>
          {Array.from({ length: BARS }, (_, barIndex) => {
            const x = ((barIndex * BEATS_PER_BAR * Quarter) / totalDuration) * timelineWidth;
            const width = ((BEATS_PER_BAR * Quarter) / totalDuration) * timelineWidth;
            const isOddBar = barIndex % 2 === 0; // Bar 1 and 3 (index 0, 2)

            return (
              <div
                key={`bar-${barIndex}`}
                style={{
                  position: "absolute",
                  left: `${x}px`,
                  width: `${width}px`,
                  height: "100%",
                  backgroundColor: isOddBar ? "var(--gray-3)" : "var(--gray-4)",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "8px",
                  borderLeft: "2px solid var(--gray-6)",
                  boxSizing: "border-box"
                }}
              >
                <span style={{ color: "var(--gray-12)", fontWeight: "bold", fontSize: "12px" }}>
                  Bar {barIndex + 1}
                </span>
              </div>
            );
          })}
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
            <Text size="3" color="gray">
              {status}
            </Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Drum Scheduling Demo</Heading>
            <Text size="3" color="gray">
              90s-style drum pattern with visual timeline
            </Text>
          </Flex>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Heading size="5" color="blue">
                  Pattern Info
                </Heading>
                <Badge color="green" size="2">
                  {bpm} BPM
                </Badge>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Flex justify="between">
                  <Text size="2" color="gray">
                    Total Clips:
                  </Text>
                  <Text size="2" weight="bold">
                    {scheduledClips.length}
                  </Text>
                </Flex>
                <Flex justify="between">
                  <Text size="2" color="gray">
                    Duration:
                  </Text>
                  <Text size="2" weight="bold">
                    {BARS} bars ({TOTAL_BEATS} beats)
                  </Text>
                </Flex>
                <Flex justify="between">
                  <Text size="2" color="gray">
                    Pattern:
                  </Text>
                  <Text size="2" weight="bold">
                    Classic boom-bap with hi-hats
                  </Text>
                </Flex>
              </Flex>
            </Flex>
          </Card>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">
                Timeline
              </Heading>
              <Text size="2" color="gray">
                Each colored block represents a scheduled drum hit. Watch the white playhead move across the timeline as
                the pattern plays.
              </Text>
              {renderTimeline()}
            </Flex>
          </Card>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">
                Transport Controls
              </Heading>

              <Flex direction="column" gap="3">
                <Flex direction="column" gap="2">
                  <Flex justify="between" align="center">
                    <Text size="2" weight="bold">
                      Tempo
                    </Text>
                    <Text size="2" color="gray">
                      {bpm} BPM
                    </Text>
                  </Flex>
                  <input
                    type="range"
                    min="80"
                    max="160"
                    value={bpm}
                    onChange={e => handleBpmChange(Number(e.target.value))}
                    disabled={!samplesLoaded}
                    style={{
                      width: "100%",
                      accentColor: "var(--accent-9)",
                      opacity: samplesLoaded ? 1 : 0.5,
                      cursor: samplesLoaded ? "pointer" : "not-allowed"
                    }}
                  />
                  {!samplesLoaded && (
                    <Text size="1" color="orange" style={{ textAlign: "center" }}>
                      Loading samples...
                    </Text>
                  )}
                  <Flex justify="between">
                    <Text size="1" color="gray">
                      60 BPM
                    </Text>
                    <Text size="1" color="gray">
                      180 BPM
                    </Text>
                  </Flex>
                </Flex>

                <Separator size="4" />

                <Flex gap="3" wrap="wrap" justify="center">
                  <Button onClick={handlePlay} disabled={isPlaying} color="green" size="3" variant="solid">
                    Play Pattern
                  </Button>
                  <Button onClick={handleStop} disabled={!isPlaying} color="red" size="3" variant="solid">
                    Stop
                  </Button>
                </Flex>
              </Flex>
              <Text size="2" align="center" color="gray">
                {status}
              </Text>
            </Flex>
          </Card>

          {/* Export Audio Card */}
          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="purple">
                Export Audio
              </Heading>

              <Flex direction="column" gap="3">
                <Text size="2" color="gray">
                  Export your drum pattern as audio files. Choose full mix or individual stems (Kick, Snare, Hi-Hats).
                </Text>

                <Separator size="4" />

                <Flex gap="3" wrap="wrap" justify="center">
                  <Button
                    onClick={handleExportMix}
                    disabled={!samplesLoaded || isExporting}
                    color="purple"
                    size="3"
                    variant="solid"
                  >
                    Export Full Mix
                  </Button>
                  <Button
                    onClick={handleDrumStems}
                    disabled={!samplesLoaded || isExporting}
                    color="purple"
                    size="3"
                    variant="outline"
                  >
                    Export Stems (4 files)
                  </Button>
                </Flex>

                {/* Export status */}
                {(exportStatus || isExporting) && (
                  <>
                    <Separator size="4" />
                    <Flex direction="column" gap="2" align="center">
                      <Text size="2" weight="medium">
                        {exportStatus}
                      </Text>
                      {isExporting && (
                        <Text size="1" color="gray" align="center">
                          Rendering offline (may take a moment for long tracks)
                        </Text>
                      )}
                    </Flex>
                  </>
                )}
              </Flex>
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
                </a>{" "}
                by SoundPacks.com
              </Text>
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
