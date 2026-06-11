import { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN, TimeBase } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import type { TrackBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { loadAudioFile } from "@/lib/audioUtils";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
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
  Slider,
  Callout
} from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const { Quarter } = PPQN;

/**
 * TimeBase Demo
 *
 * Demonstrates the difference between Musical TimeBase and Seconds TimeBase:
 * - Musical: duration stored in PPQN — changes with BPM
 * - Seconds: duration stored in seconds — constant regardless of BPM
 * Overlap rules are identical in both: overlapping regions on one track are
 * invalid by design (runtime-tolerated; project.copy() deletes the pair).
 */
function TimeBaseDemo() {
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [bpm, setBpm] = useState(120);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);

  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({ project, audioContext, pausedPositionRef });

  // Track info
  const [musicalTrackInfo, setMusicalTrackInfo] = useState<{
    trackBox: TrackBox;
    audioUnitBox: AudioUnitBox;
    regions: Array<{ box: AudioRegionBox; position: number }>;
  } | null>(null);

  const [secondsTrackInfo, setSecondsTrackInfo] = useState<{
    trackBox: TrackBox;
    audioUnitBox: AudioUnitBox;
    regions: Array<{ box: AudioRegionBox; position: number }>;
  } | null>(null);

  const [audioFileUUID, setAudioFileUUID] = useState<UUID.Bytes | null>(null);
  // Ref (not state): rapid-click handlers must see the already-staged box
  // synchronously without waiting for React state to flush.
  const audioFileBoxRef = useRef<AudioFileBox | null>(null);
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

  // Playback state is managed by usePlaybackPosition and useTransportControls hooks

  // Subscribe to sample loading state
  useEffect(() => {
    if (!project || !audioFileUUID) return;

    const sampleLoader = project.sampleManager.getOrCreate(audioFileUUID);
    const subscription = sampleLoader.subscribe((state) => {
      if (state.type === 'loaded') {
        setSampleLoaded(true); // Mark as loaded only when sample manager confirms
      }
    });

    return () => {
      subscription.terminate();
    };
  }, [project, audioFileUUID]);

  // Load sample and create tracks
  const loadSample = useCallback(async () => {
    if (!project || !audioContext) return;

    try {
      // Load a short kick drum sample for TimeBase demonstration
      const audioBuffer = await loadAudioFile(
        audioContext,
        "/audio/90sSamplePack/Kick/Kick 1.wav"
      );

      const duration = audioBuffer.duration;
      setSampleDurationInSeconds(duration);

      // Generate UUID and store audio buffer
      const fileUUID = UUID.generate();
      const uuidString = UUID.toString(fileUUID);
      localAudioBuffers.set(uuidString, audioBuffer);
      setAudioFileUUID(fileUUID);

      const { editing, api } = project;

      editing.modify(() => {
        // Disable looping so playback keeps going after the sample ends
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

      // Overlapping regions on one track are invalid by design (all timeBases);
      // project.copy() (export, offline render) deletes the overlapping pair.
      // Read existing regions from the box graph (synchronous snapshot), not React
      // state — batched rapid clicks would otherwise see stale empty region lists.
      const newStart = beatPosition * Quarter;
      const newEnd = newStart + PPQN.secondsToPulses(sampleDurationInSeconds, bpm);
      const existingRegions = musicalTrackInfo.trackBox.regions.pointerHub
        .incoming()
        .map((pointer) => pointer.box as AudioRegionBox);
      const overlap = existingRegions.find((box) => {
        const start = box.position.getValue();
        const end = start + box.duration.getValue(); // Musical: duration already PPQN
        return newStart < end && newEnd > start;
      });
      if (overlap) {
        const overlapBeat = overlap.position.getValue() / Quarter + 1;
        setAddNotice(
          `Skipped: would overlap the region at beat ${overlapBeat.toFixed(2)} — ` +
          `overlapping regions are invalid by design and project.copy() deletes them.`
        );
        return;
      }
      setAddNotice(null);

      project.editing.modify(() => {
        const boxGraph = project.boxGraph;

        // Use ref for synchronous lookup so rapid clicks see the already-staged box
        let fileBox = audioFileBoxRef.current;
        if (!fileBox) {
          fileBox = AudioFileBox.create(boxGraph, audioFileUUID, (box) => {
            box.fileName.setValue("Kick 1.wav");
            box.endInSeconds.setValue(sampleDurationInSeconds);
          });
          audioFileBoxRef.current = fileBox;
        }

        const clipDuration = PPQN.secondsToPulses(sampleDurationInSeconds, bpm);
        const regionPosition = beatPosition * Quarter;
        const regionEnd = regionPosition + clipDuration;

        // Extend loop area if region extends beyond current loop
        const currentLoopEnd = project.timelineBox.loopArea.to.getValue();
        if (regionEnd > currentLoopEnd) {
          project.timelineBox.loopArea.to.setValue(regionEnd);
        }

        // Create events collection box (required for AudioRegionBox)
        const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

        const regionBox = AudioRegionBox.create(
          boxGraph,
          UUID.generate(),
          (box) => {
            box.regions.refer(musicalTrackInfo.trackBox.regions);
            box.file.refer(fileBox);
            box.events.refer(eventsCollectionBox.owners);
            box.timeBase.setValue(TimeBase.Musical); // Musical timebase
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
    [project, musicalTrackInfo, audioFileUUID, bpm, sampleDurationInSeconds]
  );

  // Add region to Seconds track
  const addSecondsRegion = useCallback(
    (beatPosition: number) => {
      if (!project || !secondsTrackInfo || !audioFileUUID) return;

      // Overlapping regions on one track are invalid by design (all timeBases);
      // project.copy() (export, offline render) deletes the overlapping pair.
      // Note: only the live Project.invalid() probe skips Seconds tracks — copy() does not.
      // Read existing regions from the box graph (synchronous snapshot), not React
      // state — batched rapid clicks would otherwise see stale empty region lists.
      const newStart = beatPosition * Quarter;
      const newEnd = newStart + PPQN.secondsToPulses(sampleDurationInSeconds, bpm);
      const existingRegions = secondsTrackInfo.trackBox.regions.pointerHub
        .incoming()
        .map((pointer) => pointer.box as AudioRegionBox);
      const overlap = existingRegions.find((box) => {
        const start = box.position.getValue();
        // Seconds: duration is stored in seconds — convert to PPQN at current BPM
        const end = start + PPQN.secondsToPulses(box.duration.getValue(), bpm);
        return newStart < end && newEnd > start;
      });
      if (overlap) {
        const overlapBeat = overlap.position.getValue() / Quarter + 1;
        setAddNotice(
          `Skipped: would overlap the region at beat ${overlapBeat.toFixed(2)} — ` +
          `overlapping regions are invalid by design and project.copy() deletes them.`
        );
        return;
      }
      setAddNotice(null);

      project.editing.modify(() => {
        const boxGraph = project.boxGraph;

        // Use ref for synchronous lookup so rapid clicks see the already-staged box
        let fileBox = audioFileBoxRef.current;
        if (!fileBox) {
          fileBox = AudioFileBox.create(boxGraph, audioFileUUID, (box) => {
            box.fileName.setValue("Kick 1.wav");
            box.endInSeconds.setValue(sampleDurationInSeconds);
          });
          audioFileBoxRef.current = fileBox;
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

        // Create events collection box (required for AudioRegionBox)
        const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

        const regionBox = AudioRegionBox.create(
          boxGraph,
          UUID.generate(),
          (box) => {
            box.regions.refer(secondsTrackInfo.trackBox.regions);
            box.file.refer(fileBox);
            box.events.refer(eventsCollectionBox.owners);
            box.timeBase.setValue(TimeBase.Seconds); // Seconds timebase
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
    [project, secondsTrackInfo, audioFileUUID, bpm, sampleDurationInSeconds]
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
      if (secondsTrackInfo && secondsTrackInfo.regions.length === 0 && audioFileBoxRef.current) {
        audioFileBoxRef.current.delete();
        audioFileBoxRef.current = null;
      }
    });

    setMusicalTrackInfo((prev) => ({ ...prev!, regions: [] }));
  }, [project, musicalTrackInfo, secondsTrackInfo]);

  const clearSecondsTrack = useCallback(() => {
    if (!project || !secondsTrackInfo) return;

    project.editing.modify(() => {
      secondsTrackInfo.regions.forEach(({ box }) => {
        box.delete();
      });

      // If both tracks are empty after clearing, delete the AudioFileBox
      if (musicalTrackInfo && musicalTrackInfo.regions.length === 0 && audioFileBoxRef.current) {
        audioFileBoxRef.current.delete();
        audioFileBoxRef.current = null;
      }
    });

    setSecondsTrackInfo((prev) => ({ ...prev!, regions: [] }));
  }, [project, secondsTrackInfo, musicalTrackInfo]);

  // Playback controls provided by useTransportControls hook

  // Calculate durations for display
  // Musical: stored in PPQN (beats) - duration changes with BPM
  const musicalDurationPPQN = PPQN.secondsToPulses(sampleDurationInSeconds, bpm);
  const musicalDurationBeats = musicalDurationPPQN / Quarter;

  // Seconds: stored in seconds - duration stays constant regardless of BPM
  const secondsDurationSeconds = sampleDurationInSeconds;

  return (
    <Theme accentColor="amber" appearance="dark" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <GitHubCorner />
      <Container size="4" style={{ paddingTop: "2rem", paddingBottom: "4rem" }}>
        <BackLink />

        <Flex direction="column" gap="4">
          <div>
            <div className="mc-kicker">Playback — TimeBase · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>TIMEBASE</h1>
            <p className="mc-intro">
              <code>timeBase</code> determines how the SDK stores and interprets audio region{" "}
              durations. <strong>Musical</strong>: <code>duration</code> and{" "}
              <code>loopDuration</code> are stored in PPQN — they scale automatically when BPM
              changes. <strong>Seconds</strong>: <code>duration</code> and{" "}
              <code>loopDuration</code> are stored in seconds — they stay constant regardless of
              BPM. In both modes, <code>position</code> is always PPQN (Int32), and overlapping
              regions on one track are invalid by design.
            </p>
          </div>

          {/* SDK context */}
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">SDK reference</h2>
            <p>
              Set <code>box.timeBase.setValue(TimeBase.Musical)</code> and pass{" "}
              <code>duration</code> in PPQN — computed via{" "}
              <code>PPQN.secondsToPulses(seconds, bpm)</code>. For Seconds timeBase pass{" "}
              <code>duration</code> directly in seconds. Both modes use{" "}
              <code>box.position.setValue(beatPosition * Quarter)</code> — position is always
              PPQN. Overlapping regions on one track are invalid by design in BOTH timeBases:
              the live engine tolerates them at runtime, but the <code>project.copy()</code>{" "}
              validator (export, offline render) deletes the overlapping pair —{" "}
              &ldquo;Overlapping regions&rdquo; in the console, no error thrown. Only the live{" "}
              <code>Project.invalid()</code> probe skips Seconds tracks, so Seconds overlaps
              surface no warning before <code>copy()</code> silently deletes them. For
              overlapping one-shots, put each region on its own Tape track.
            </p>
            <p>
              With NoSync playback mode (the default when no <code>playMode</code> box is
              attached), both timeBase values sound identical — the difference is in storage
              unit and export validation only. Audible differences appear with time-stretching
              play modes (<code>AudioTimeStretchBox</code>,{" "}
              <code>AudioPitchStretchBox</code>).
            </p>
          </section>

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
                    Add at Beat 1.5
                  </Button>
                </Flex>

                {addNotice && (
                  <Text size="2" style={{ color: "var(--mc-amber)" }}>
                    {addNotice}
                  </Text>
                )}

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
                    Add at Beat 1.5
                  </Button>
                </Flex>

                {addNotice && (
                  <Text size="2" style={{ color: "var(--mc-amber)" }}>
                    {addNotice}
                  </Text>
                )}

                <Text size="2" color="gray">
                  Regions: {secondsTrackInfo?.regions.length || 0}
                </Text>

                {secondsTrackInfo && secondsTrackInfo.regions.length > 0 && (
                  <Callout.Root color="green" size="1">
                    <Callout.Text>
                      Try changing BPM - Seconds regions stay the same duration!
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
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">When to use each timeBase</h2>
            <p>
              <strong>Musical</strong> — duration tracks tempo. Use for melodic content, loops,
              and samples that must stay grid-aligned.
            </p>
            <p>
              <strong>Seconds</strong> — duration is constant. Use for drums, percussion, sound
              effects, and one-shots whose length must not change with BPM.
            </p>
            <p>
              Overlap rules do not differ by timeBase: overlapping regions on one track are
              invalid by design. The live engine tolerates them at runtime, but{" "}
              <code>project.copy()</code> (export, offline render) deletes the overlapping
              pair — &ldquo;Overlapping regions&rdquo; in the console, no error thrown. Put
              overlapping one-shots on separate Tape tracks.
            </p>
          </section>
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
