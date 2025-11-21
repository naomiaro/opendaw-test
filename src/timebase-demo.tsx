import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
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
  Separator,
  Slider,
  Callout
} from "@radix-ui/themes";

const { Quarter } = PPQN;

/**
 * TimeBase Demo
 *
 * Demonstrates the difference between Musical TimeBase and Seconds TimeBase:
 * - Musical: Duration changes with BPM, overlaps forbidden
 * - Seconds: Duration stays constant, overlaps allowed
 */
function TimeBaseDemo() {
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [sampleLoaded, setSampleLoaded] = useState(false);

  // Track info
  const [musicalTrackInfo, setMusicalTrackInfo] = useState<{
    trackBox: any;
    audioUnitBox: any;
    regions: Array<{ box: any; position: number }>;
  } | null>(null);

  const [secondsTrackInfo, setSecondsTrackInfo] = useState<{
    trackBox: any;
    audioUnitBox: any;
    regions: Array<{ box: any; position: number }>;
  } | null>(null);

  const [audioFileUUID, setAudioFileUUID] = useState<UUID.Bytes | null>(null);
  const [audioFileBox, setAudioFileBox] = useState<any>(null);
  const [sampleDurationInSeconds, setSampleDurationInSeconds] = useState(0);

  // Create audio buffers map for sample manager
  const [localAudioBuffers] = useState(() => new Map<string, AudioBuffer>());

  // Initialize project
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers
        });
        if (!mounted) return;

        if (!newProject) {
          console.error("Failed to initialize project - returned null/undefined");
          return;
        }

        setProject(newProject);
        setAudioContext(newAudioContext);

        // Set initial BPM
        newProject.editing.modify(() => {
          newProject.timelineBox.bpm.setValue(bpm);
        });
      } catch (error) {
        console.error("Failed to initialize OpenDAW:", error);
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to playback state
  useEffect(() => {
    if (!project) return;

    const playingSub = project.engine.isPlaying.subscribe((obs) => {
      setIsPlaying(obs.getValue());
    });

    const positionSub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });

    return () => {
      playingSub.terminate();
      positionSub.terminate();
    };
  }, [project]);

  // Subscribe to sample loading state
  useEffect(() => {
    if (!project || !audioFileUUID) return;

    const sampleLoader = project.sampleManager.getOrCreate(audioFileUUID);
    const subscription = sampleLoader.subscribe((state) => {
      console.log('Sample loader state:', state.type);
      if (state.type === 'loaded') {
        console.log('Sample fully loaded by sample manager');
        setSampleLoaded(true); // Mark as loaded only when sample manager confirms
      }
    });

    return () => {
      subscription.terminate();
    };
  }, [project, audioFileUUID]);

  // Load sample and create tracks
  const loadSample = useCallback(async () => {
    console.log("loadSample called, project:", !!project, "audioContext:", !!audioContext);
    if (!project || !audioContext) {
      console.error("Cannot load sample - missing project or audioContext");
      return;
    }

    try {
      console.log("Loading audio file...");
      // Load a short kick drum sample for TimeBase demonstration
      const audioBuffer = await loadAudioFile(
        audioContext,
        "/audio/90sSamplePack/Kick/Kick 1.wav"
      );
      console.log("Audio file loaded successfully, duration:", audioBuffer.duration);

      const duration = audioBuffer.duration;
      setSampleDurationInSeconds(duration);

      // Generate UUID and store audio buffer
      const fileUUID = UUID.generate();
      const uuidString = UUID.toString(fileUUID);
      localAudioBuffers.set(uuidString, audioBuffer);
      setAudioFileUUID(fileUUID);

      const { editing, api } = project;

      editing.modify(() => {
        // Disable looping so playback stops at the end instead of looping
        project.timelineBox.loopArea.enabled.setValue(false);

        // Set timeline loop end to accommodate the full audio
        const loopEndInPPQN = PPQN.secondsToPulses(duration, bpm);
        project.timelineBox.loopArea.to.setValue(loopEndInPPQN);

        // Create Musical TimeBase track
        const { audioUnitBox: musicalUnit, trackBox: musicalTrack } =
          api.createInstrument(InstrumentFactories.Tape);
        musicalUnit.volume.setValue(0); // 0 dB (full volume)

        // Create Seconds TimeBase track
        const { audioUnitBox: secondsUnit, trackBox: secondsTrack } =
          api.createInstrument(InstrumentFactories.Tape);
        secondsUnit.volume.setValue(0); // 0 dB (full volume)

        setMusicalTrackInfo({
          trackBox: musicalTrack,
          audioUnitBox: musicalUnit,
          regions: []
        });

        setSecondsTrackInfo({
          trackBox: secondsTrack,
          audioUnitBox: secondsUnit,
          regions: []
        });
      });

      // Note: setSampleLoaded(true) is now called by the sample loader subscription
      // when the sample is fully loaded by the sample manager
    } catch (error) {
      console.error("Failed to load sample:", error);
      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
    }
  }, [project, audioContext, localAudioBuffers]);

  // Add region to Musical track
  const addMusicalRegion = useCallback(
    (beatPosition: number) => {
      if (!project || !musicalTrackInfo || !audioFileUUID) return;

      project.editing.modify(() => {
        const boxGraph = project.boxGraph;

        // Create AudioFileBox if it doesn't exist yet
        let fileBox = audioFileBox;
        if (!fileBox) {
          fileBox = AudioFileBox.create(boxGraph, audioFileUUID, (box) => {
            box.fileName.setValue("Kick 1.wav");
            box.endInSeconds.setValue(sampleDurationInSeconds);
          });
          setAudioFileBox(fileBox);
        }

        const clipDuration = PPQN.secondsToPulses(sampleDurationInSeconds, bpm);
        const regionPosition = beatPosition * Quarter;
        const regionEnd = regionPosition + clipDuration;

        // Extend loop area if region extends beyond current loop
        const currentLoopEnd = project.timelineBox.loopArea.to.getValue();
        if (regionEnd > currentLoopEnd) {
          project.timelineBox.loopArea.to.setValue(regionEnd);
        }

        const regionBox = AudioRegionBox.create(
          boxGraph,
          UUID.generate(),
          (box) => {
            box.regions.refer(musicalTrackInfo.trackBox.regions);
            box.file.refer(fileBox);
            box.timeBase.setValue(TimeBase.Musical); // Musical timebase
            box.playback.setValue(AudioPlayback.NoSync);
            box.position.setValue(regionPosition);
            box.duration.setValue(clipDuration);
            box.loopDuration.setValue(clipDuration);
            box.mute.setValue(false);
          }
        );

        setMusicalTrackInfo((prev) => ({
          ...prev!,
          regions: [
            ...prev!.regions,
            { box: regionBox, position: beatPosition * Quarter }
          ]
        }));
      });
    },
    [project, musicalTrackInfo, audioFileUUID, audioFileBox, bpm, sampleDurationInSeconds]
  );

  // Add region to Seconds track
  const addSecondsRegion = useCallback(
    (beatPosition: number) => {
      if (!project || !secondsTrackInfo || !audioFileUUID) return;

      project.editing.modify(() => {
        const boxGraph = project.boxGraph;

        // Create AudioFileBox if it doesn't exist yet
        let fileBox = audioFileBox;
        if (!fileBox) {
          fileBox = AudioFileBox.create(boxGraph, audioFileUUID, (box) => {
            box.fileName.setValue("Kick 1.wav");
            box.endInSeconds.setValue(sampleDurationInSeconds);
          });
          setAudioFileBox(fileBox);
        }

        // For Seconds TimeBase, duration is in seconds (not PPQN!)
        const durationInSeconds = sampleDurationInSeconds;
        const regionPosition = beatPosition * Quarter;
        const regionEnd = regionPosition + PPQN.secondsToPulses(durationInSeconds, bpm);

        // Extend loop area if region extends beyond current loop
        const currentLoopEnd = project.timelineBox.loopArea.to.getValue();
        if (regionEnd > currentLoopEnd) {
          project.timelineBox.loopArea.to.setValue(regionEnd);
        }

        const regionBox = AudioRegionBox.create(
          boxGraph,
          UUID.generate(),
          (box) => {
            box.regions.refer(secondsTrackInfo.trackBox.regions);
            box.file.refer(fileBox);
            box.timeBase.setValue(TimeBase.Seconds); // Seconds timebase
            box.playback.setValue(AudioPlayback.NoSync);
            box.position.setValue(regionPosition);
            box.duration.setValue(durationInSeconds); // In seconds, not PPQN!
            box.loopDuration.setValue(durationInSeconds); // In seconds, not PPQN!
            box.mute.setValue(false);
          }
        );

        setSecondsTrackInfo((prev) => ({
          ...prev!,
          regions: [
            ...prev!.regions,
            { box: regionBox, position: beatPosition * Quarter }
          ]
        }));
      });
    },
    [project, secondsTrackInfo, audioFileUUID, audioFileBox, bpm, sampleDurationInSeconds]
  );

  // Update BPM
  const handleBpmChange = useCallback(
    (newBpm: number) => {
      if (!project) return;

      project.editing.modify(() => {
        project.timelineBox.bpm.setValue(newBpm);

        // Update Musical regions (duration changes with BPM)
        if (musicalTrackInfo) {
          musicalTrackInfo.regions.forEach(({ box }) => {
            const newDuration = PPQN.secondsToPulses(
              sampleDurationInSeconds,
              newBpm
            );
            box.duration.setValue(newDuration);
            box.loopDuration.setValue(newDuration);
          });
        }

        // Seconds regions stay the same (duration doesn't change)
      });

      setBpm(newBpm);
    },
    [project, musicalTrackInfo, sampleDurationInSeconds]
  );

  // Clear tracks
  const clearMusicalTrack = useCallback(() => {
    if (!project || !musicalTrackInfo) return;

    project.editing.modify(() => {
      musicalTrackInfo.regions.forEach(({ box }) => {
        box.delete();
      });

      // If both tracks are empty after clearing, delete the AudioFileBox
      if (secondsTrackInfo && secondsTrackInfo.regions.length === 0 && audioFileBox) {
        audioFileBox.delete();
        setAudioFileBox(null);
      }
    });

    setMusicalTrackInfo((prev) => ({ ...prev!, regions: [] }));
  }, [project, musicalTrackInfo, secondsTrackInfo, audioFileBox]);

  const clearSecondsTrack = useCallback(() => {
    if (!project || !secondsTrackInfo) return;

    project.editing.modify(() => {
      secondsTrackInfo.regions.forEach(({ box }) => {
        box.delete();
      });

      // If both tracks are empty after clearing, delete the AudioFileBox
      if (musicalTrackInfo && musicalTrackInfo.regions.length === 0 && audioFileBox) {
        audioFileBox.delete();
        setAudioFileBox(null);
      }
    });

    setSecondsTrackInfo((prev) => ({ ...prev!, regions: [] }));
  }, [project, secondsTrackInfo, musicalTrackInfo, audioFileBox]);

  // Playback controls
  const handlePlay = async () => {
    if (!project || !audioContext) return;
    await audioContext.resume(); // Resume AudioContext on user interaction
    project.engine.play();
  };

  const handlePause = () => {
    if (!project) return;
    project.engine.stop(false); // Stop without resetting position
  };

  const handleStop = () => {
    if (!project) return;
    project.engine.stop(); // Stop and reset position
  };

  // Calculate durations for display
  // Musical: stored in PPQN (beats) - duration changes with BPM
  const musicalDurationPPQN = PPQN.secondsToPulses(sampleDurationInSeconds, bpm);
  const musicalDurationBeats = musicalDurationPPQN / Quarter;

  // Seconds: stored in seconds - duration stays constant regardless of BPM
  const secondsDurationSeconds = sampleDurationInSeconds;

  return (
    <Theme accentColor="purple" appearance="dark">
      <GitHubCorner />
      <Container size="4" style={{ paddingTop: "2rem", paddingBottom: "4rem" }}>
        <BackLink />

        <Flex direction="column" gap="4">
          <Flex direction="column" gap="2" align="center">
            
            <Heading size="8" align="center">
              TimeBase Demo
            </Heading>
            <Text size="3" color="gray" align="center">
              Musical vs Seconds TimeBase Comparison
            </Text>
          </Flex>

          {/* Introduction */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">Understanding TimeBase</Heading>
              <Text>
                TimeBase determines how OpenDAW stores and interprets audio region durations. This affects export validation and how your project behaves when you change BPM.
              </Text>

              <Flex direction="column" gap="2">
                <Flex gap="2" align="center">
                  <Badge color="blue" size="2">
                    Musical
                  </Badge>
                  <Text size="2">
                    Duration stored in <strong>beats</strong>. A 0.14s kick at 120 BPM = 0.28 beats.
                    Overlaps cause <strong>export errors</strong>. Use for loops and melodic content.
                  </Text>
                </Flex>

                <Flex gap="2" align="center">
                  <Badge color="green" size="2">
                    Seconds
                  </Badge>
                  <Text size="2">
                    Duration stored in <strong>seconds</strong>. A 0.14s kick = 0.14s always.
                    Overlaps <strong>allowed</strong> (for natural decay). Use for drums and one-shots.
                  </Text>
                </Flex>
              </Flex>

              <Callout.Root size="1">
                <Callout.Text>
                  <strong>Note:</strong> With NoSync playback mode, both TimeBase options sound identical.
                  The difference is in how durations are stored and validated during export.
                  With time-stretching modes (not shown here), there would be audible differences.
                </Callout.Text>
              </Callout.Root>
            </Flex>
          </Card>

          {/* Load Sample */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Step 1: Load Sample</Heading>
              <Button onClick={loadSample} disabled={sampleLoaded} size="3">
                {sampleLoaded ? "✓ Kick Drum Loaded" : "Load Kick Drum"}
              </Button>
              {sampleLoaded && (
                <Text size="2" color="gray">
                  Sample duration: {sampleDurationInSeconds.toFixed(3)} seconds
                </Text>
              )}
            </Flex>
          </Card>

          {/* BPM Control */}
          {sampleLoaded && (
            <Card>
              <Flex direction="column" gap="3">
                <Heading size="4">Step 2: Adjust BPM</Heading>
                <Flex direction="column" gap="2">
                  <Flex justify="between" align="center">
                    <Text weight="bold" size="5">
                      {bpm} BPM
                    </Text>
                    <Text size="2" color="gray">
                      60 - 180 BPM
                    </Text>
                  </Flex>
                  <Slider
                    value={[bpm]}
                    onValueChange={([value]) => handleBpmChange(value)}
                    min={60}
                    max={180}
                    step={1}
                    size="3"
                  />
                </Flex>

                <Callout.Root color="orange" size="1">
                  <Callout.Text>
                    <strong>Watch:</strong> Musical regions will change duration
                    as you adjust BPM. Seconds regions stay constant!
                  </Callout.Text>
                </Callout.Root>
              </Flex>
            </Card>
          )}

          {/* Musical Track */}
          {sampleLoaded && (
            <Card>
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Flex gap="2" align="center">
                    <Heading size="4">Musical TimeBase Track</Heading>
                    <Badge color="blue">Musical</Badge>
                  </Flex>
                  <Button
                    onClick={clearMusicalTrack}
                    variant="soft"
                    color="red"
                    size="1"
                  >
                    Clear
                  </Button>
                </Flex>

                <Text size="2">
                  Region duration: <strong>{musicalDurationBeats.toFixed(2)} beats</strong> = {sampleDurationInSeconds.toFixed(3)}s at {bpm} BPM
                </Text>
                <Text size="1" color="gray">
                  Stored in beats. Duration in beats changes when BPM changes.
                </Text>

                <Flex gap="2" wrap="wrap">
                  <Button onClick={() => addMusicalRegion(0)} size="2">
                    Add at Beat 1
                  </Button>
                  <Button onClick={() => addMusicalRegion(1)} size="2">
                    Add at Beat 2
                  </Button>
                  <Button onClick={() => addMusicalRegion(2)} size="2">
                    Add at Beat 3
                  </Button>
                  <Button onClick={() => addMusicalRegion(0.5)} size="2">
                    Add at Beat 1.5 (overlap test)
                  </Button>
                </Flex>

                <Text size="2" color="gray">
                  Regions: {musicalTrackInfo?.regions.length || 0}
                </Text>

                {musicalTrackInfo && musicalTrackInfo.regions.length > 0 && (
                  <Callout.Root color="blue" size="1">
                    <Callout.Text>
                      Try changing BPM - Musical regions will resize automatically!
                    </Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            </Card>
          )}

          {/* Seconds Track */}
          {sampleLoaded && (
            <Card>
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Flex gap="2" align="center">
                    <Heading size="4">Seconds TimeBase Track</Heading>
                    <Badge color="green">Seconds</Badge>
                  </Flex>
                  <Button
                    onClick={clearSecondsTrack}
                    variant="soft"
                    color="red"
                    size="1"
                  >
                    Clear
                  </Button>
                </Flex>

                <Text size="2">
                  Region duration: <strong>{secondsDurationSeconds.toFixed(3)} seconds</strong> (constant)
                </Text>
                <Text size="1" color="gray">
                  Stored in seconds. Duration never changes regardless of BPM.
                </Text>

                <Flex gap="2" wrap="wrap">
                  <Button onClick={() => addSecondsRegion(0)} size="2">
                    Add at Beat 1
                  </Button>
                  <Button onClick={() => addSecondsRegion(1)} size="2">
                    Add at Beat 2
                  </Button>
                  <Button onClick={() => addSecondsRegion(2)} size="2">
                    Add at Beat 3
                  </Button>
                  <Button onClick={() => addSecondsRegion(0.5)} size="2">
                    Add at Beat 1.5 (overlap allowed!)
                  </Button>
                </Flex>

                <Text size="2" color="gray">
                  Regions: {secondsTrackInfo?.regions.length || 0}
                </Text>

                {secondsTrackInfo && secondsTrackInfo.regions.length > 0 && (
                  <Callout.Root color="green" size="1">
                    <Callout.Text>
                      Try changing BPM - Seconds regions stay the same duration!
                      Overlaps are allowed for natural audio decay.
                    </Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            </Card>
          )}

          {/* Playback Controls */}
          {sampleLoaded && (
            <Card>
              <Flex direction="column" gap="3">
                <Heading size="4">Playback</Heading>
                <Flex gap="2">
                  <Button onClick={handlePlay} disabled={isPlaying} size="3">
                    ▶ Play
                  </Button>
                  <Button onClick={handlePause} disabled={!isPlaying} size="3">
                    ⏸ Pause
                  </Button>
                  <Button onClick={handleStop} size="3">
                    ⏹ Stop
                  </Button>
                </Flex>
                <Text size="2" color="gray">
                  Position: Beat {((currentPosition / Quarter) + 1).toFixed(2)}
                </Text>
              </Flex>
            </Card>
          )}

          {/* Key Takeaways */}
          {sampleLoaded && (
            <Card>
              <Flex direction="column" gap="3">
                <Heading size="4">Key Takeaways</Heading>

                <Flex direction="column" gap="2">
                  <Text size="2">
                    <strong>Musical TimeBase:</strong>
                  </Text>
                  <ul style={{ marginLeft: "1.5rem", marginTop: "0.25rem" }}>
                    <li>Duration in beats - automatically adjusts when BPM changes</li>
                    <li>Overlapping regions are forbidden on export (validation error)</li>
                    <li>Perfect for loops that need to stay in sync with tempo</li>
                    <li>Use for: melodic content, loops, tempo-synced samples</li>
                  </ul>

                  <Text size="2" style={{ marginTop: "1rem" }}>
                    <strong>Seconds TimeBase:</strong>
                  </Text>
                  <ul style={{ marginLeft: "1.5rem", marginTop: "0.25rem" }}>
                    <li>Duration in seconds - stays constant regardless of BPM</li>
                    <li>Overlapping regions are allowed</li>
                    <li>Perfect for one-shot samples with natural decay</li>
                    <li>Use for: drums, percussion, sound effects, vocals</li>
                  </ul>
                </Flex>

                <Separator size="4" />

                <Callout.Root color="red" size="1">
                  <Callout.Text>
                    <strong>Warning:</strong> If you see "Overlapping regions" errors
                    during export, switch Musical regions to Seconds TimeBase!
                  </Callout.Text>
                </Callout.Root>
              </Flex>
            </Card>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

// Mount the app
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<TimeBaseDemo />);
}
