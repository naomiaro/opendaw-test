// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { InstrumentFactories, Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { TrackRow, type TrackData } from "./components/TrackRow";
import { TransportControls } from "./components/TransportControls";
import { TimelineRuler } from "./components/TimelineRuler";
import { EffectPanel } from "./components/EffectPanel";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW, setLoopEndFromTracks } from "./lib/projectSetup";
import { useReverb } from "./hooks/useReverb";
import { useCompressor } from "./hooks/useCompressor";
import { useDelay } from "./hooks/useDelay";
import { useCrusher } from "./hooks/useCrusher";
import { useStereoWidth } from "./hooks/useStereoWidth";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Separator,
  Callout
} from "@radix-ui/themes";

/**
 * Main Effects Demo App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [tracks, setTracks] = useState<TrackData[]>([]);

  // Get audio boxes for effects
  const vocalsAudioBox = tracks.find(t => t.name === "Vocals")?.audioUnitBox || null;
  const guitarAudioBox = tracks.find(t => t.name === "Guitar")?.audioUnitBox || null;
  const bassAudioBox = tracks.find(t => t.name === "Bass & Drums")?.audioUnitBox || null;
  const masterAudioBox = project?.rootBox.outputDevice.pointerHub.incoming().at(0)?.box || null;

  // Effect hooks with generic implementations
  const vocalsReverb = useReverb(project, vocalsAudioBox, { wet: -18, decay: 0.7, preDelay: 0.02, damp: 0.5 }, "Vocals Reverb");
  const vocalsCompressor = useCompressor(project, vocalsAudioBox, { threshold: -24, ratio: 3, attack: 5, release: 100, knee: 6 }, "Vocals Comp", 0);
  const guitarDelay = useDelay(project, guitarAudioBox, { wet: -12, feedback: 0.4, time: 6, filter: 0.3 }, "Guitar Delay");
  const guitarCrusher = useCrusher(project, guitarAudioBox, { bits: 4, crush: 0.95, boost: 0.6, mix: 0.8 }, "Guitar Lo-Fi");
  const bassCrusher = useCrusher(project, bassAudioBox, { bits: 6, crush: 0.9, boost: 0.5, mix: 0.7 }, "Bass Lo-Fi");
  const masterCompressor = useCompressor(project, masterAudioBox, { threshold: -12, ratio: 2, attack: 5, release: 100, knee: 6 }, "Master Glue");
  const masterStereoWidth = useStereoWidth(project, masterAudioBox, { width: 0.8, pan: 0.0 }, "Master Width");

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const currentPositionRef = useRef<number>(0);
  const bpmRef = useRef<number>(120);
  const tracksContainerRef = useRef<HTMLDivElement>(null);

  const CHANNEL_PADDING = 4;

  // Initialize CanvasPainters for waveform rendering
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
    let animationFrameSubscription: { terminate: () => void } | null = null;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        localAudioBuffersRef.current = localAudioBuffers;

        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);

        // Store BPM for playhead calculations
        bpmRef.current = newProject.timelineBox.bpm.getValue();

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
  const setupTracks = async (
    proj: Project,
    ctx: AudioContext,
    audioBuffers: Map<string, AudioBuffer>
  ) => {
    const bpm = proj.timelineBox.bpm.getValue();
    const boxGraph = proj.boxGraph;

    // Define audio files to load (Muse tracks) - ordered Vocals first
    const samples = [
      { name: "Vocals", file: "/audio/Vocals30.mp3" },
      { name: "Piano & Synth", file: "/audio/PianoSynth30.mp3" },
      { name: "Guitar", file: "/audio/Guitar30.mp3" },
      { name: "Bass & Drums", file: "/audio/BassDrums30.mp3" }
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
          const { audioUnitBox, trackBox } = proj.api.createInstrument(
            InstrumentFactories.Tape
          );

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

    // Set loop end to accommodate the longest track (all tracks are 30 seconds)
    setLoopEndFromTracks(proj, audioBuffers, bpm);

    console.debug("Tracks created, generating waveforms...");
    console.debug(`Timeline position: ${proj.engine.position.getValue()}`);
    console.debug(`BPM: ${bpm}`);

    // Make sure the timeline is at the beginning
    proj.engine.setPosition(0);
  };

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

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="green" radius="medium">
        <Container size="4" style={{ padding: "32px" }}>
          <Heading size="8">OpenDAW Effects Demo</Heading>
          <Text size="4">{status}</Text>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          {/* Header */}
          <Flex direction="column" gap="3">
            <Heading size="8">OpenDAW Effects Demo</Heading>
            <Text size="4" color="gray">
              Multi-track mixer with professional audio effects (Reverb, Delay, Lo-Fi Crusher, Compressor, Stereo Width)
            </Text>
          </Flex>

          {/* Info callout */}
          <Callout.Root color="blue">
            <Callout.Text>
              💡 This demo shows OpenDAW's mixer controls and professional audio effects.
              Each track has independent volume, pan, mute, and solo controls. Add studio-quality effects
              to individual tracks (Compressor + Reverb on Vocals demonstrates effect chain ordering, Delay + Lo-Fi on Guitar, Lo-Fi Crusher on Bass) or the master output (Compressor for mix glue, Stereo Width for spaciousness).
            </Callout.Text>
          </Callout.Root>

          {/* Transport controls */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Transport</Heading>
              <Separator size="4" />
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={bpmRef.current}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
            </Flex>
          </Card>

          {/* Mixer section */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Mixer</Heading>
              <Separator size="4" />

              {/* Timeline and tracks container with shared border */}
              <Flex direction="column" gap="0" style={{ border: "1px solid var(--gray-6)", position: "relative" }}>
                <div ref={tracksContainerRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
                {/* Timeline - Dynamically calculated duration */}
                <TimelineRuler
                  maxDuration={Math.max(
                    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
                    1
                  )}
                />
                {(() => {
                  // Calculate max duration once for all tracks
                  const maxDuration = Math.max(
                    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
                    1
                  );

                  return tracks.map(track => (
                    <TrackRow
                      key={UUID.toString(track.uuid)}
                      track={track}
                      project={project}
                      allTracks={tracks}
                      peaks={trackPeaksRef.current.get(UUID.toString(track.uuid))}
                      canvasRef={(el) => {
                        if (el) {
                          canvasRefs.current.set(UUID.toString(track.uuid), el);
                        }
                      }}
                      currentPosition={currentPosition}
                      isPlaying={isPlaying}
                      bpm={bpmRef.current}
                      audioBuffer={localAudioBuffersRef.current.get(UUID.toString(track.uuid))}
                      setCurrentPosition={setCurrentPosition}
                      pausedPositionRef={pausedPositionRef}
                      maxDuration={maxDuration}
                    />
                  ));
                })()}

                {/* Single unified playhead overlay spanning all tracks */}
                {currentPosition > 0 && localAudioBuffersRef.current.size > 0 && canvasRefs.current.size > 0 && (() => {
                  const maxDuration = Math.max(
                    ...Array.from(localAudioBuffersRef.current.values()).map(buf => buf.duration),
                    1
                  );
                  const timeInSeconds = PPQN.pulsesToSeconds(currentPosition, bpmRef.current);
                  const xPercent = (timeInSeconds / maxDuration);

                  // Get the first canvas to measure waveform area offset
                  const firstCanvas = Array.from(canvasRefs.current.values())[0];
                  if (!firstCanvas || !tracksContainerRef.current) return null;

                  const containerRect = tracksContainerRef.current.parentElement?.getBoundingClientRect();
                  const canvasRect = firstCanvas.getBoundingClientRect();

                  if (!containerRect) return null;

                  const waveformOffsetLeft = canvasRect.left - containerRect.left;
                  const waveformWidth = canvasRect.width;
                  const xPosition = waveformOffsetLeft + (waveformWidth * xPercent);

                  return (
                    <svg
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                        zIndex: 10
                      }}
                    >
                      <line
                        x1={xPosition}
                        y1="24px"
                        x2={xPosition}
                        y2="100%"
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    </svg>
                  );
                })()}
              </Flex>
            </Flex>
          </Card>

          {/* Audio Effects */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Audio Effects</Heading>
              <Separator size="4" />

              <Callout.Root color="purple">
                <Callout.Text>
                  ✨ Add professional audio effects to individual tracks or the master output.
                  These are the same effects used in professional DAWs! Try adding both Compressor and Reverb to Vocals to see effect chain ordering (Compressor at index 0 → Reverb at index 1).
                </Callout.Text>
              </Callout.Root>

              {/* Per-Track Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Per-Track Effects</Heading>

                <EffectPanel
                  title="Vocals - Reverb"
                  description="Adds spacious ambience to vocal track"
                  isActive={vocalsReverb.isActive}
                  onToggle={vocalsReverb.handleToggle}
                  parameters={vocalsReverb.parameters}
                  onParameterChange={vocalsReverb.handleParameterChange}
                />

                <EffectPanel
                  title="Vocals - Compressor"
                  description="Smooths vocal dynamics (adds at index 0, before reverb)"
                  isActive={vocalsCompressor.isActive}
                  onToggle={vocalsCompressor.handleToggle}
                  parameters={vocalsCompressor.parameters}
                  onParameterChange={vocalsCompressor.handleParameterChange}
                />

                <EffectPanel
                  title="Guitar - Delay"
                  description="Adds rhythmic echo effect to guitar track"
                  isActive={guitarDelay.isActive}
                  onToggle={guitarDelay.handleToggle}
                  parameters={guitarDelay.parameters}
                  onParameterChange={guitarDelay.handleParameterChange}
                />

                <EffectPanel
                  title="Guitar - Lo-Fi Crusher"
                  description="Heavy bit-crushing for very obvious lo-fi distortion effect"
                  isActive={guitarCrusher.isActive}
                  onToggle={guitarCrusher.handleToggle}
                  parameters={guitarCrusher.parameters}
                  onParameterChange={guitarCrusher.handleParameterChange}
                />

                <EffectPanel
                  title="Bass & Drums - Lo-Fi Crusher"
                  description="Extreme bit-crushing for dramatic lo-fi distortion (very obvious!)"
                  isActive={bassCrusher.isActive}
                  onToggle={bassCrusher.handleToggle}
                  parameters={bassCrusher.parameters}
                  onParameterChange={bassCrusher.handleParameterChange}
                />
              </Flex>

              {/* Master Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Master Output Effects</Heading>

                <EffectPanel
                  title="Master - Compressor"
                  description='"Glue" compressor for cohesive mix on all tracks'
                  isActive={masterCompressor.isActive}
                  onToggle={masterCompressor.handleToggle}
                  parameters={masterCompressor.parameters}
                  onParameterChange={masterCompressor.handleParameterChange}
                />

                <EffectPanel
                  title="Master - Stereo Width"
                  description="Widens the stereo field for a bigger, more spacious sound"
                  isActive={masterStereoWidth.isActive}
                  onToggle={masterStereoWidth.handleToggle}
                  parameters={masterStereoWidth.parameters}
                  onParameterChange={masterStereoWidth.handleParameterChange}
                />
              </Flex>

              <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                💡 Tip: Adjust effect parameters while playback is active to hear the changes in real-time!
              </Text>
            </Flex>
          </Card>

          {/* Usage instructions */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">How to Use</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text>• <strong>Volume Fader:</strong> Drag the vertical slider to adjust track volume (-60 dB to +6 dB)</Text>
                <Text>• <strong>Mute Button:</strong> Click to mute/unmute the track (prevents audio output)</Text>
                <Text>• <strong>Solo Button:</strong> Click to solo the track (mutes all other non-soloed tracks)</Text>
                <Text>• <strong>Multiple Solos:</strong> You can solo multiple tracks simultaneously</Text>
                <Text>• <strong>Waveform:</strong> Shows the audio content of each track</Text>
              </Flex>
            </Flex>
          </Card>

          {/* Technical details */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Technical Details</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">Mixer Controls:</Text>
                <Text size="2">
                  • Volume/mute/solo applied through <code>AudioUnitBox</code> properties
                </Text>
                <Text size="2">
                  • Volume range: -60 dB (near silence) to +6 dB (amplification)
                </Text>
                <Text size="2">
                  • Solo behavior: automatically manages mute states across all tracks
                </Text>
                <Separator size="1" />
                <Text size="2" weight="bold">Audio Effects:</Text>
                <Text size="2">
                  • Per-track effects: <code>project.api.insertEffect(audioUnitBox.audioDevices, ...)</code>
                </Text>
                <Text size="2">
                  • Master effects: <code>project.api.insertEffect(masterChannel.audioDevices, ...)</code>
                </Text>
                <Text size="2">
                  • Reverb: Space simulation with decay, pre-delay, and damping controls
                </Text>
                <Text size="2">
                  • Delay: Tempo-synced echo with feedback and filtering
                </Text>
                <Text size="2">
                  • Crusher: Bit-crushing and sample rate reduction for lo-fi distortion
                </Text>
                <Text size="2">
                  • Compressor: Dynamic range control with threshold, ratio, and makeup gain
                </Text>
                <Separator size="1" />
                <Text size="2">
                  • All modifications happen within <code>project.editing.modify()</code> transactions
                </Text>
                <Text size="2">
                  • State changes are observed via <code>catchupAndSubscribe()</code>
                </Text>
              </Flex>
            </Flex>
          </Card>

          <MoisesLogo />
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
