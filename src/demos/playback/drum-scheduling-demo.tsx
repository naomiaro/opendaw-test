// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID, type Subscription } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { loadAudioFile } from "@/lib/audioUtils";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { computeBarsFromSDK } from "@/lib/barLayout";
import { useAudioExport } from "@/hooks/useAudioExport";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Button, Flex, Card, Badge, Separator } from "@radix-ui/themes";
import { ExportProgress } from "@/components/ExportProgress";

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
  const [scheduledClips, setScheduledClips] = useState<ScheduledClip[]>([]);
  const [bpm, setBpm] = useState(90);
  const [samplesLoaded, setSamplesLoaded] = useState(false);

  // Playback position hook
  const { currentPosition, isPlaying } = usePlaybackPosition(project);

  // Audio export hook
  const {
    isExporting,
    exportStatus,
    exportProgress,
    handleExportMix,
    handleExportStems,
    handleAbortExport
  } = useAudioExport(project, {
    sampleRate: 48000,
    mixFileName: `drum-pattern-${bpm}bpm`
  });

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const sampleUUIDsRef = useRef<UUID.Bytes[]>([]);
  const audioRegionsRef = useRef<Array<{ box: AudioRegionBox; audioDuration: number }>>([]); // Store region refs for BPM updates
  const clipTemplatesRef = useRef<
    Array<{ trackName: string; position: number; audioDuration: number; label: string; color: string }>
  >([]); // Templates for recalculating clips
  const trackAudioBoxesRef = useRef<Array<{ name: string; audioUnitBox: AudioUnitBox }>>([]); // Track audio boxes for stem export

  const { Quarter } = PPQN;
  const BARS = 4;
  const BEATS_PER_BAR = 4;
  const TOTAL_BEATS = BARS * BEATS_PER_BAR;

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    // 1b fix: reset append-only refs so re-runs (React StrictMode double-mount or
    // any effect re-run) don't accumulate boxes/buffers from the discarded first
    // project. The map is cleared before initializeOpenDAW captures it, so the
    // sample manager only ever sees this run's buffers.
    audioRegionsRef.current = [];
    clipTemplatesRef.current = [];
    trackAudioBoxesRef.current = [];
    localAudioBuffersRef.current.clear();

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
              // Create events collection box (required for AudioRegionBox)
              const eventsCollectionBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());

              const regionBox = AudioRegionBox.create(boxGraph, UUID.generate(), box => {
                box.regions.refer(trackBox.regions);
                box.file.refer(audioFileBox);
                box.events.refer(eventsCollectionBox.owners);
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

        // Set timeline duration to match the 4-bar pattern
        const totalPpqn = BARS * BEATS_PER_BAR * Quarter;
        editing.modify(() => {
          newProject.timelineBox.durationInPulses.setValue(totalPpqn);
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(totalPpqn);
          newProject.timelineBox.loopArea.enabled.setValue(true);
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

  // Subscribe to sample loader states to track when all samples are fully loaded.
  // DefaultSampleLoader.subscribe() catches up SYNCHRONOUSLY when the state is
  // already terminal ("loaded"/"error"): it invokes the observer inline and returns
  // Terminable.Empty. The pre-check below keeps that synchronous catch-up out of
  // the subscription callback, whose one-shot `subscription.terminate()` would
  // otherwise run while `const subscription` is still in TDZ → ReferenceError.
  useEffect(() => {
    if (!project || sampleUUIDsRef.current.length === 0) return undefined;

    console.debug("[SampleLoading] Setting up sample loading tracking for", sampleUUIDsRef.current.length, "samples");

    const subscriptions: Subscription[] = [];
    let loadedCount = 0;
    const total = sampleUUIDsRef.current.length;

    const handleLoaded = () => {
      loadedCount++;
      console.debug(`[SampleLoading] ${loadedCount}/${total} samples loaded`);
      if (loadedCount === total) {
        console.debug("[SampleLoading] All samples loaded! BPM changes are now safe.");
        setSamplesLoaded(true);
        setStatus("Ready - Click Play to hear the drum pattern!");
      }
    };

    sampleUUIDsRef.current.forEach(uuid => {
      const sampleLoader = project.sampleManager.getOrCreate(uuid);
      const uuidString = UUID.toString(uuid);

      // 1a fix: handle already-terminal states here, before subscribing.
      // subscribe() would catch up synchronously for these states, but inside the
      // callback the one-shot terminate would hit `subscription` before its const
      // binding initializes. Early-returning keeps the sync path callback-free.
      const currentState = sampleLoader.state;
      console.debug(`[SampleLoading] Sample ${uuidString} initial state:`, currentState.type);

      if (currentState.type === "loaded") {
        handleLoaded();
        return; // no subscription needed
      }
      if (currentState.type === "error") {
        console.warn(`[SampleLoading] Sample ${uuidString} already errored:`, currentState.reason);
        setStatus(`Error loading sample: ${currentState.reason}`);
        return;
      }

      const subscription = sampleLoader.subscribe(state => {
        console.debug(`[SampleLoading] Sample ${uuidString} state:`, state.type);

        if (state.type === "loaded") {
          handleLoaded();
          subscription.terminate(); // one-shot: terminal state reached
        } else if (state.type === "error") {
          console.warn(`[SampleLoading] Sample ${uuidString} error:`, state.reason);
          setStatus(`Error loading sample: ${state.reason}`);
          subscription.terminate(); // one-shot: terminal state reached
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

      // Update BPM and recalculate region durations.
      // In Musical timeBase, region duration is expressed in PPQN — the number of
      // pulses a fixed-length audio clip occupies changes with BPM. Recalculate via
      // PPQN.secondsToPulses(audioDuration, newBpm) so each hit spans the correct
      // number of pulses at the new tempo.
      project.editing.modify(() => {
        // Update timeline BPM
        project.timelineBox.bpm.setValue(newBpm);

        // Recalculate duration in PPQN for all regions
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

    const bars = computeBarsFromSDK(project!);
    const totalDuration = project!.timelineBox.durationInPulses.getValue();
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

          {/* Grid lines for beats — reads bar layout from SDK */}
          {bars.flatMap(bar => {
            const beatDuration = bar.durationPpqn / bar.nominator;
            return Array.from({ length: bar.nominator }, (_, beat) => {
              const x = ((bar.startPpqn + beat * beatDuration) / totalDuration) * timelineWidth;
              const isMeasure = beat === 0;
              return (
                <line
                  key={`grid-${bar.barNumber}-${beat}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={tracks.length * trackHeight}
                  stroke={isMeasure ? "#555" : "#333"}
                  strokeWidth={isMeasure ? 2 : 1}
                />
              );
            });
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
          {bars.map(bar => {
            const x = (bar.startPpqn / totalDuration) * timelineWidth;
            const width = (bar.durationPpqn / totalDuration) * timelineWidth;

            return (
              <div
                key={`bar-${bar.barNumber}`}
                style={{
                  position: "absolute",
                  left: `${x}px`,
                  width: `${width}px`,
                  height: "100%",
                  backgroundColor: bar.barNumber % 2 === 1 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "8px",
                  borderLeft: "2px solid var(--mc-line-bright)",
                  boxSizing: "border-box"
                }}
              >
                <span style={{ color: "var(--mc-muted)", fontFamily: "var(--mc-mono)", fontSize: "11px", letterSpacing: "0.1em" }}>
                  BAR {bar.barNumber}
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
      <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
        <style>{CONSOLE_STYLES}</style>
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <div className="mc-kicker">Playback — Drum Scheduling · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)", textAlign: "center" }}>
              DRUM <span className="mc-q">SCHEDULING</span>
            </h1>
            <Text size="3" style={{ color: "var(--mc-muted)" }}>
              {status}
            </Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="amber" radius="medium" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" px={{ initial: "4", sm: "6" }} py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="5">

          {/* Kicker / title / intro */}
          <div>
            <div className="mc-kicker">Playback — Drum Scheduling · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              DRUM <span className="mc-q">SCHEDULING</span>
            </h1>
            <p className="mc-intro">
              A 90s-style 4-bar boom-bap pattern built by placing{" "}
              <strong>AudioRegionBox</strong> instances at PPQN positions derived from{" "}
              <code>signatureTrack.iterateAll()</code> via{" "}
              <code>computeBarsFromSDK</code>. Each hit's duration in PPQN is
              re-derived with <code>PPQN.secondsToPulses(audioDuration, bpm)</code>{" "}
              whenever tempo changes — Musical-timeBase regions express their length in
              pulses, which are BPM-dependent. Move the tempo slider to hear the
              pattern stretch and watch the clips resize on the timeline.
            </p>
          </div>

          {/* SDK reference block */}
          <section className="mc-anchors">
            <h2 className="mc-anchors-head">SDK reference</h2>
            <p>
              <code>signatureTrack.iterateAll()</code> yields one entry per time-signature
              section; <code>computeBarsFromSDK(project)</code> expands sections into bar
              objects with <code>startPpqn</code>, <code>durationPpqn</code>, and{" "}
              <code>nominator</code> for grid rendering.{" "}
              <code>PPQN.secondsToPulses(seconds, bpm)</code> converts audio duration to
              PPQN — call it again on every BPM change so regions stay correctly sized.
              <code>ValueEventCollectionBox</code> must be created for each{" "}
              <code>AudioRegionBox</code> even when no automation is needed.
            </p>
          </section>

          {/* Pattern grid / timeline — lattice-framed */}
          <div className="mc-lattice-frame" style={{ marginTop: 0 }}>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Heading size="4" style={{ color: "var(--mc-text)" }}>Pattern Grid</Heading>
                <Badge color={samplesLoaded ? "green" : "orange"} size="2">
                  {samplesLoaded ? `${bpm} BPM` : "Loading samples…"}
                </Badge>
              </Flex>
              <Text size="2" style={{ color: "var(--mc-muted)" }}>
                Each colored block is a scheduled drum hit. The white playhead tracks
                the engine position across the 4-bar loop.
              </Text>
              {renderTimeline()}
            </Flex>
          </div>

          {/* Transport + BPM */}
          <Card style={{ background: "var(--mc-panel)", border: "1px solid var(--mc-line)" }}>
            <Flex direction="column" gap="4">
              <Heading size="4" style={{ color: "var(--mc-text)" }}>Transport</Heading>
              <Separator size="4" />

              <Flex direction="column" gap="3">
                <Flex direction="column" gap="2">
                  <Flex justify="between" align="center">
                    <Text size="2" weight="bold" style={{ color: "var(--mc-text)" }}>
                      Tempo
                    </Text>
                    <Text size="2" style={{ color: "var(--mc-muted)", fontFamily: "var(--mc-mono)" }}>
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
                      accentColor: "var(--mc-amber)",
                      opacity: samplesLoaded ? 1 : 0.5,
                      cursor: samplesLoaded ? "pointer" : "not-allowed"
                    }}
                  />
                  {!samplesLoaded && (
                    <Text size="1" style={{ color: "var(--mc-amber)", textAlign: "center" }}>
                      Loading samples…
                    </Text>
                  )}
                  <Flex justify="between">
                    <Text size="1" style={{ color: "var(--mc-label)", fontFamily: "var(--mc-mono)" }}>
                      80 BPM
                    </Text>
                    <Text size="1" style={{ color: "var(--mc-label)", fontFamily: "var(--mc-mono)" }}>
                      160 BPM
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
              <Text size="2" align="center" style={{ color: "var(--mc-muted)" }}>
                {status}
              </Text>
            </Flex>
          </Card>

          {/* Export Audio */}
          <Card style={{ background: "var(--mc-panel)", border: "1px solid var(--mc-line)" }}>
            <Flex direction="column" gap="4">
              <Heading size="4" style={{ color: "var(--mc-text)" }}>Export Audio</Heading>
              <Separator size="4" />
              <Text size="2" style={{ color: "var(--mc-muted)" }}>
                Export the drum pattern as audio files. Choose full mix or individual stems
                (Kick, Snare, Hi-Hats).
              </Text>

              <Flex gap="3" wrap="wrap" justify="center">
                <Button
                  onClick={handleExportMix}
                  disabled={!samplesLoaded || isExporting}
                  color="amber"
                  size="3"
                  variant="solid"
                >
                  Export Full Mix
                </Button>
                <Button
                  onClick={handleDrumStems}
                  disabled={!samplesLoaded || isExporting}
                  color="amber"
                  size="3"
                  variant="outline"
                >
                  Export Stems (4 files)
                </Button>
              </Flex>

              <ExportProgress
                isExporting={isExporting}
                status={exportStatus}
                progress={exportProgress}
                onCancel={handleAbortExport}
              />
            </Flex>
          </Card>

          {/* Attribution */}
          <Card style={{ background: "var(--mc-panel)", border: "1px solid var(--mc-line)" }}>
            <Text size="2" style={{ color: "var(--mc-muted)", textAlign: "center" }}>
              Samples from{" "}
              <a
                href="https://soundpacks.com/free-sound-packs/90s-mpc-sample-pack/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--mc-amber)", textDecoration: "none" }}
              >
                90s MPC Sample Pack
              </a>{" "}
              by SoundPacks.com
            </Text>
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
