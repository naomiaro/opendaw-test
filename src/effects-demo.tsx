// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef, memo } from "react";
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
import { EffectChain, type EffectInstance } from "./components/EffectChain";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW, setLoopEndFromTracks } from "./lib/projectSetup";
import { useEffectChain } from "./hooks/useEffectChain";
import { useDynamicEffect } from "./hooks/useDynamicEffect";
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
 * Component to render individual effect instances (memoized to prevent re-renders)
 */
const EffectRenderer: React.FC<{
  effect: EffectInstance;
  trackName: string;
  audioBox: any;
  onRemove: (id: string) => void;
  project: Project | null;
}> = memo(({ effect, trackName, audioBox, onRemove, project }) => {
  const dynamicEffect = useDynamicEffect({
    id: effect.id,
    type: effect.type,
    trackName,
    project,
    audioBox
  });

  return (
    <EffectPanel
      title={effect.label}
      description={`${effect.type} effect`}
      isActive={true}
      onToggle={() => onRemove(effect.id)}
      isBypassed={dynamicEffect.isBypassed}
      onBypass={dynamicEffect.handleBypass}
      parameters={dynamicEffect.parameters}
      onParameterChange={dynamicEffect.handleParameterChange}
      presets={dynamicEffect.presets}
      onPresetChange={(preset) => dynamicEffect.loadPreset(preset)}
    />
  );
});

EffectRenderer.displayName = 'EffectRenderer';

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
  const guitarLeadAudioBox = tracks.find(t => t.name === "Guitar Lead")?.audioUnitBox || null;
  const guitarAudioBox = tracks.find(t => t.name === "Guitar")?.audioUnitBox || null;
  const drumsAudioBox = tracks.find(t => t.name === "Drums")?.audioUnitBox || null;
  const bassAudioBox = tracks.find(t => t.name === "Bass")?.audioUnitBox || null;
  const masterAudioBox = project?.rootBox.outputDevice.pointerHub.incoming().at(0)?.box || null;

  // Effect chain hooks for each track and master
  const introEffects = useEffectChain(project, tracks.find(t => t.name === "Intro")?.audioUnitBox || null, "Intro");
  const vocalsEffects = useEffectChain(project, vocalsAudioBox, "Vocals");
  const guitarLeadEffects = useEffectChain(project, guitarLeadAudioBox, "Guitar Lead");
  const guitarEffects = useEffectChain(project, guitarAudioBox, "Guitar");
  const drumsEffects = useEffectChain(project, drumsAudioBox, "Drums");
  const bassEffects = useEffectChain(project, bassAudioBox, "Bass");
  const effectReturnsEffects = useEffectChain(project, tracks.find(t => t.name === "Effect Returns")?.audioUnitBox || null, "Effect Returns");
  const masterEffects = useEffectChain(project, masterAudioBox, "Master");

  // Memoized render functions to prevent unnecessary re-renders
  const renderIntroEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Intro"
      audioBox={tracks.find(t => t.name === "Intro")?.audioUnitBox}
      onRemove={introEffects.removeEffect}
      project={project}
    />
  ), [project, tracks, introEffects.removeEffect]);

  const renderVocalsEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Vocals"
      audioBox={vocalsAudioBox}
      onRemove={vocalsEffects.removeEffect}
      project={project}
    />
  ), [project, vocalsAudioBox, vocalsEffects.removeEffect]);

  const renderGuitarLeadEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Guitar Lead"
      audioBox={guitarLeadAudioBox}
      onRemove={guitarLeadEffects.removeEffect}
      project={project}
    />
  ), [project, guitarLeadAudioBox, guitarLeadEffects.removeEffect]);

  const renderGuitarEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Guitar"
      audioBox={guitarAudioBox}
      onRemove={guitarEffects.removeEffect}
      project={project}
    />
  ), [project, guitarAudioBox, guitarEffects.removeEffect]);

  const renderDrumsEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Drums"
      audioBox={drumsAudioBox}
      onRemove={drumsEffects.removeEffect}
      project={project}
    />
  ), [project, drumsAudioBox, drumsEffects.removeEffect]);

  const renderBassEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Bass"
      audioBox={bassAudioBox}
      onRemove={bassEffects.removeEffect}
      project={project}
    />
  ), [project, bassAudioBox, bassEffects.removeEffect]);

  const renderEffectReturnsEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Effect Returns"
      audioBox={tracks.find(t => t.name === "Effect Returns")?.audioUnitBox}
      onRemove={effectReturnsEffects.removeEffect}
      project={project}
    />
  ), [project, tracks, effectReturnsEffects.removeEffect]);

  const renderMasterEffect = useCallback((effect: EffectInstance) => (
    <EffectRenderer
      key={effect.id}
      effect={effect}
      trackName="Master"
      audioBox={masterAudioBox}
      onRemove={masterEffects.removeEffect}
      project={project}
    />
  ), [project, masterAudioBox, masterEffects.removeEffect]);

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
      const painter = new CanvasPainter(canvas, (_, context) => {
        const peaks = trackPeaksRef.current.get(uuidString);
        if (!peaks) {
          // Clear canvas if no peaks
          context.fillStyle = "#000";
          context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
          return;
        }

        // Skip rendering if peaks haven't changed
        if (lastRenderedPeaks.get(uuidString) === peaks) {
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

        lastRenderedPeaks.set(uuidString, peaks);
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
    const renderedTracks = new Set<string>();

    tracks.forEach(track => {
      const uuidString = UUID.toString(track.uuid);

      // Get the sample loader and subscribe to state changes
      const sampleLoader = project.sampleManager.getOrCreate(track.uuid);

      const subscription = sampleLoader.subscribe(state => {
        console.debug(`[Peaks] Sample loader state for "${track.name}":`, state.type);

        // When state becomes "loaded", peaks are ready
        if (state.type === "loaded" && !renderedTracks.has(uuidString)) {
          const peaksOption = sampleLoader.peaks;

          if (!peaksOption.isEmpty()) {
            const peaks = peaksOption.unwrap();

            // Store peaks and request render
            trackPeaksRef.current.set(uuidString, peaks);
            const painter = canvasPaintersRef.current.get(uuidString);
            if (painter) {
              painter.requestUpdate();
              renderedTracks.add(uuidString);

              // Check if all peaks are rendered
              if (renderedTracks.size === tracks.length) {
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
          bpm: 124,
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

    // Define audio files to load (DarkRide tracks) - all 7 tracks
    const samples = [
      { name: "Intro", file: "/audio/DarkRide/01_Intro.ogg" },
      { name: "Vocals", file: "/audio/DarkRide/06_Vox.ogg" },
      { name: "Guitar Lead", file: "/audio/DarkRide/05_ElecGtrsLead.ogg" },
      { name: "Guitar", file: "/audio/DarkRide/04_ElecGtrs.ogg" },
      { name: "Drums", file: "/audio/DarkRide/02_Drums.ogg" },
      { name: "Bass", file: "/audio/DarkRide/03_Bass.ogg" },
      { name: "Effect Returns", file: "/audio/DarkRide/07_EffectReturns.ogg" }
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

  // Show loading overlay while status is not "Ready to play!"
  const isLoading = status !== "Ready to play!";

  return (
    <Theme appearance="dark" accentColor="green" radius="medium">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          {/* Loading Overlay */}
          {isLoading && (
            <div style={{
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
            }}>
              <div style={{
                width: "50px",
                height: "50px",
                border: "4px solid rgba(74, 158, 255, 0.3)",
                borderTop: "4px solid #4a9eff",
                borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
              <Text size="5" weight="medium" style={{ color: "#fff" }}>{status}</Text>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}

          <BackLink />

          {/* Header */}
          <Flex direction="column" gap="3">
            <Heading size="8">OpenDAW Effects Demo</Heading>
            <Text size="4" color="gray">
              Multi-track mixer featuring DarkRide stems with professional audio effects (Reverb, Delay, Lo-Fi Crusher, Compressor, Stereo Width)
            </Text>
          </Flex>

          {/* Info callout */}
          <Callout.Root color="blue">
            <Callout.Text>
              💡 This demo shows OpenDAW's mixer controls and professional audio effects with all 7 unmastered tracks from Dark Ride's 'Deny Control'.
              Each track has independent volume, pan, mute, and solo controls. Add studio-quality effects
              to individual tracks (Compressors to tighten Drums/Bass, Reverb + Compressor on Vocals, Delay on Guitar Lead, Lo-Fi Crusher for creative effects) or the master output (Compressor for mix glue, Stereo Width for spaciousness).
              <br /><br />
              ✨ <strong>New:</strong> Each effect now includes presets! Try loading presets like "Drum Punch", "Bass Control", "Vocal Smooth", "Slap Back Delay", and more to hear how different parameter combinations sound.
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
                  These are the same effects used in professional DAWs! Each effect includes preset options - try loading presets to quickly explore different sounds, then fine-tune the parameters to your liking.
                  Try adding Compressors to Drums and Bass to tighten up these unmastered stems, or add Reverb to Vocals with Compressor for a polished vocal chain.
                </Callout.Text>
              </Callout.Root>

              {/* Per-Track Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Per-Track Effects</Heading>

                <EffectChain
                  trackName="Intro"
                  effects={introEffects.effects}
                  onAddEffect={introEffects.addEffect}
                  onRemoveEffect={introEffects.removeEffect}
                  renderEffect={renderIntroEffect}
                />

                <EffectChain
                  trackName="Vocals"
                  effects={vocalsEffects.effects}
                  onAddEffect={vocalsEffects.addEffect}
                  onRemoveEffect={vocalsEffects.removeEffect}
                  renderEffect={renderVocalsEffect}
                />

                <EffectChain
                  trackName="Guitar Lead"
                  effects={guitarLeadEffects.effects}
                  onAddEffect={guitarLeadEffects.addEffect}
                  onRemoveEffect={guitarLeadEffects.removeEffect}
                  renderEffect={renderGuitarLeadEffect}
                />

                <EffectChain
                  trackName="Guitar"
                  effects={guitarEffects.effects}
                  onAddEffect={guitarEffects.addEffect}
                  onRemoveEffect={guitarEffects.removeEffect}
                  renderEffect={renderGuitarEffect}
                />

                <EffectChain
                  trackName="Drums"
                  effects={drumsEffects.effects}
                  onAddEffect={drumsEffects.addEffect}
                  onRemoveEffect={drumsEffects.removeEffect}
                  renderEffect={renderDrumsEffect}
                />

                <EffectChain
                  trackName="Bass"
                  effects={bassEffects.effects}
                  onAddEffect={bassEffects.addEffect}
                  onRemoveEffect={bassEffects.removeEffect}
                  renderEffect={renderBassEffect}
                />

                <EffectChain
                  trackName="Effect Returns"
                  effects={effectReturnsEffects.effects}
                  onAddEffect={effectReturnsEffects.addEffect}
                  onRemoveEffect={effectReturnsEffects.removeEffect}
                  renderEffect={renderEffectReturnsEffect}
                />
              </Flex>

              {/* Master Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Master Output Effects</Heading>

                <EffectChain
                  trackName="Master"
                  effects={masterEffects.effects}
                  onAddEffect={masterEffects.addEffect}
                  onRemoveEffect={masterEffects.removeEffect}
                  renderEffect={renderMasterEffect}
                />
              </Flex>

              <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                💡 Tip: Adjust effect parameters while playback is active to hear the changes in real-time!
              </Text>
            </Flex>
          </Card>

          {/* Technical details */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Technical Details</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">Dynamic Effect Chain System:</Text>
                <Text size="2">
                  • Dynamic effect system allows adding multiple effects of any type to each track
                </Text>
                <Text size="2">
                  • Effects are managed via <code>useEffectChain</code> hook per track/master
                </Text>
                <Text size="2">
                  • Individual effects use <code>useDynamicEffect</code> for full lifecycle management
                </Text>
                <Separator size="1" />
                <Text size="2" weight="bold">Available Effects (7 Total):</Text>
                <Text size="2">
                  • <strong>Reverb:</strong> Space simulation with decay, pre-delay, and damping controls
                </Text>
                <Text size="2">
                  • <strong>Compressor:</strong> Dynamic range control with threshold, ratio, attack, release, and makeup gain
                </Text>
                <Text size="2">
                  • <strong>Parametric EQ:</strong> 3-band EQ (Low 250Hz, Mid 1kHz, High 4kHz) with ±24dB gain range
                </Text>
                <Text size="2">
                  • <strong>Delay:</strong> Tempo-synced echo with feedback, cross-feedback, and filtering
                </Text>
                <Text size="2">
                  • <strong>Lo-Fi Crusher:</strong> Bit-crushing and sample rate reduction for digital degradation
                </Text>
                <Text size="2">
                  • <strong>Wavefolder:</strong> Distortion/saturation with drive and oversampling for harmonic generation
                </Text>
                <Text size="2">
                  • <strong>Stereo Width:</strong> Stereo imaging with width, panning, and phase controls
                </Text>
                <Separator size="1" />
                <Text size="2" weight="bold">Implementation:</Text>
                <Text size="2">
                  • Effect insertion: <code>project.api.insertEffect(audioBox.audioEffects, EffectFactories.AudioNamed.*)</code>
                </Text>
                <Text size="2">
                  • All modifications within <code>project.editing.modify()</code> transactions
                </Text>
                <Text size="2">
                  • State observation via <code>catchupAndSubscribe()</code>
                </Text>
                <Text size="2">
                  • Each effect includes presets and bypass functionality
                </Text>
              </Flex>
            </Flex>
          </Card>

          {/* Audio Attribution */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Audio Attribution</Heading>
              <Separator size="4" />
              <Text size="2">
                Mix stems from Dark Ride's 'Deny Control'. This file is provided for educational purposes only,
                and the material contained in it should not be used for any commercial purpose without the express
                permission of the copyright holders. Please refer to{" "}
                <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-9)" }}>
                  www.cambridge-mt.com
                </a>{" "}
                for further details.
              </Text>
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
