// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { InstrumentFactories, Project, EffectFactories } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW, setLoopEndFromTracks } from "./lib/projectSetup";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card,
  Slider,
  Badge,
  Separator,
  Callout
} from "@radix-ui/themes";

const { Quarter } = PPQN;

// Type definitions
type TrackData = {
  name: string;
  trackBox: TrackBox;
  audioUnitBox: AudioUnitBox;
  uuid: UUID.Bytes;
};

/**
 * TrackRow - Audacity-style track row with mixer controls on left and waveform on right
 */
const TrackRow: React.FC<{
  track: TrackData;
  project: Project;
  allTracks: TrackData[];
  peaks: any;
  canvasRef: (el: HTMLCanvasElement | null) => void;
  currentPosition: number;
  isPlaying: boolean;
  bpm: number;
  audioBuffer: AudioBuffer | undefined;
}> = ({ track, project, allTracks, canvasRef, currentPosition, isPlaying, bpm, audioBuffer }) => {
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [soloed, setSoloed] = useState(false);

  // Subscribe to audio unit state
  useEffect(() => {
    const volumeSubscription = track.audioUnitBox.volume.catchupAndSubscribe(obs => {
      setVolume(obs.getValue());
    });

    const muteSubscription = track.audioUnitBox.mute.catchupAndSubscribe(obs => {
      setMuted(obs.getValue());
    });

    const soloSubscription = track.audioUnitBox.solo.catchupAndSubscribe(obs => {
      setSoloed(obs.getValue());
    });

    return () => {
      volumeSubscription.terminate();
      muteSubscription.terminate();
      soloSubscription.terminate();
    };
  }, [track]);

  // Handle volume change
  const handleVolumeChange = useCallback((values: number[]) => {
    const newVolume = values[0];
    project.editing.modify(() => {
      track.audioUnitBox.volume.setValue(newVolume);
    });
  }, [project, track]);

  // Handle mute toggle
  const handleMuteToggle = useCallback(() => {
    project.editing.modify(() => {
      track.audioUnitBox.mute.setValue(!muted);
    });
  }, [project, track, muted]);

  // Handle solo toggle with DAW-style behavior
  const handleSoloToggle = useCallback(() => {
    const currentSolo = track.audioUnitBox.solo.getValue();

    project.editing.modify(() => {
      // Toggle solo on this track
      track.audioUnitBox.solo.setValue(!currentSolo);

      // If we're soloing this track (turning solo ON)
      if (!currentSolo) {
        // Always unmute this track
        track.audioUnitBox.mute.setValue(false);

        // Mute all other non-soloed tracks
        allTracks.forEach(otherTrack => {
          if (otherTrack.uuid !== track.uuid && !otherTrack.audioUnitBox.solo.getValue()) {
            otherTrack.audioUnitBox.mute.setValue(true);
          }
        });
      } else {
        // If we're un-soloing and no other tracks are soloed, unmute all tracks
        const anyOtherSoloed = allTracks.some(
          t => t.uuid !== track.uuid && t.audioUnitBox.solo.getValue()
        );

        if (!anyOtherSoloed) {
          allTracks.forEach(t => {
            t.audioUnitBox.mute.setValue(false);
          });
        }
      }
    });
  }, [project, track, allTracks]);

  return (
    <Flex gap="0" style={{
      borderBottom: "1px solid var(--gray-6)",
      backgroundColor: "var(--gray-2)"
    }}>
      {/* Mixer Controls - Left Side (Audacity-style) */}
      <Flex
        direction="column"
        gap="2"
        style={{
          width: "200px",
          padding: "12px",
          backgroundColor: "var(--gray-3)",
          borderRight: "1px solid var(--gray-6)"
        }}
      >
        {/* Track name */}
        <Text size="2" weight="bold" style={{ marginBottom: "4px" }}>
          {track.name}
        </Text>

        {/* Mute and Solo buttons */}
        <Flex gap="2" align="center">
          <Button
            size="1"
            color={muted ? "red" : "gray"}
            variant={muted ? "solid" : "soft"}
            onClick={handleMuteToggle}
            style={{
              width: "32px",
              height: "24px",
              padding: 0,
              fontSize: "12px",
              fontWeight: "bold"
            }}
          >
            M
          </Button>
          <Button
            size="1"
            color={soloed ? "yellow" : "gray"}
            variant={soloed ? "solid" : "soft"}
            onClick={handleSoloToggle}
            style={{
              width: "32px",
              height: "24px",
              padding: 0,
              fontSize: "12px",
              fontWeight: "bold"
            }}
          >
            S
          </Button>
          <Text size="1" color="gray" style={{ marginLeft: "4px" }}>
            {volume.toFixed(1)}dB
          </Text>
        </Flex>

        {/* Volume slider - horizontal */}
        <Slider
          value={[volume]}
          onValueChange={handleVolumeChange}
          min={-60}
          max={6}
          step={0.1}
          style={{ width: "100%" }}
        />
      </Flex>

      {/* Waveform - Right Side */}
      <div style={{
        flex: 1,
        height: "120px",
        backgroundColor: "#000",
        position: "relative",
        boxSizing: "border-box"
      }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {/* SVG Playhead Overlay - Shows during playback and when paused */}
        {audioBuffer && currentPosition > 0 && (
          <svg
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none"
            }}
          >
            <line
              x1={`${(PPQN.pulsesToSeconds(currentPosition, bpm) / audioBuffer.duration) * 100}%`}
              y1={0}
              x2={`${(PPQN.pulsesToSeconds(currentPosition, bpm) / audioBuffer.duration) * 100}%`}
              y2="100%"
              stroke="#fff"
              strokeWidth={2}
            />
          </svg>
        )}
      </div>
    </Flex>
  );
};

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
  const [peaksReady, setPeaksReady] = useState(false);
  const [hasVocalsReverb, setHasVocalsReverb] = useState(false);
  const [hasVocalsCompressor, setHasVocalsCompressor] = useState(false);
  const [hasGuitarDelay, setHasGuitarDelay] = useState(false);
  const [hasBassLoCrusher, setHasBassLoCrusher] = useState(false);
  const [hasMasterCompressor, setHasMasterCompressor] = useState(false);

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const currentPositionRef = useRef<number>(0);
  const bpmRef = useRef<number>(120);

  // Refs to store effect boxes for removal
  const vocalsReverbRef = useRef<any>(null);
  const vocalsCompressorRef = useRef<any>(null);
  const guitarDelayRef = useRef<any>(null);
  const bassLoCrusherRef = useRef<any>(null);
  const masterCompressorRef = useRef<any>(null);

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
                setPeaksReady(true);
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

  // Effect management functions
  const handleAddVocalsReverb = useCallback(() => {
    if (!project || hasVocalsReverb) return;

    const vocalsTrack = tracks.find(t => t.name === "Vocals");
    if (!vocalsTrack) return;

    project.editing.modify(() => {
      const reverb = project.api.insertEffect(
        vocalsTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Reverb
      );

      // Configure reverb for vocals
      reverb.label.setValue("Vocal Reverb");
      reverb.wet.setValue(-6.0);  // Subtle reverb
      reverb.decay.setValue(0.6);  // Medium room
      reverb.preDelay.setValue(0.02);  // 20ms pre-delay
      reverb.damp.setValue(0.7);  // Soften high frequencies

      // Store reference for removal
      vocalsReverbRef.current = reverb;

      console.log("Added reverb to Vocals track");
    });

    setHasVocalsReverb(true);
  }, [project, tracks, hasVocalsReverb]);

  const handleRemoveVocalsReverb = useCallback(() => {
    if (!project || !hasVocalsReverb || !vocalsReverbRef.current) return;

    project.editing.modify(() => {
      vocalsReverbRef.current.delete();
      vocalsReverbRef.current = null;
      console.log("Removed reverb from Vocals track");
    });

    setHasVocalsReverb(false);
  }, [project, hasVocalsReverb]);

  const handleAddVocalsCompressor = useCallback(() => {
    if (!project || hasVocalsCompressor) return;

    const vocalsTrack = tracks.find(t => t.name === "Vocals");
    if (!vocalsTrack) return;

    project.editing.modify(() => {
      const compressor = project.api.insertEffect(
        vocalsTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Compressor,
        0  // Add at index 0 (before reverb if it exists)
      );

      // Configure compressor for vocals
      compressor.label.setValue("Vocal Compressor");
      compressor.threshold.setValue(-18.0);  // Moderate threshold
      compressor.ratio.setValue(3.0);  // 3:1 ratio
      compressor.attack.setValue(5.0);  // Fast attack for vocals
      compressor.release.setValue(50.0);  // Medium release
      compressor.automakeup.setValue(true);  // Auto makeup gain
      compressor.knee.setValue(4.0);  // Soft knee

      // Store reference for removal
      vocalsCompressorRef.current = compressor;

      console.log("Added compressor to Vocals track at index 0");
    });

    setHasVocalsCompressor(true);
  }, [project, tracks, hasVocalsCompressor]);

  const handleRemoveVocalsCompressor = useCallback(() => {
    if (!project || !hasVocalsCompressor || !vocalsCompressorRef.current) return;

    project.editing.modify(() => {
      vocalsCompressorRef.current.delete();
      vocalsCompressorRef.current = null;
      console.log("Removed compressor from Vocals track");
    });

    setHasVocalsCompressor(false);
  }, [project, hasVocalsCompressor]);

  const handleAddGuitarDelay = useCallback(() => {
    if (!project || hasGuitarDelay) return;

    const guitarTrack = tracks.find(t => t.name === "Guitar");
    if (!guitarTrack) return;

    project.editing.modify(() => {
      const delay = project.api.insertEffect(
        guitarTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Delay
      );

      // Configure delay for guitar
      delay.label.setValue("Guitar Delay");
      delay.wet.setValue(-12.0);  // Subtle delay
      delay.feedback.setValue(0.3);  // Light feedback
      delay.delay.setValue(6);  // 1/8 note delay
      delay.filter.setValue(0.2);  // Slight high-pass on feedback

      // Store reference for removal
      guitarDelayRef.current = delay;

      console.log("Added delay to Guitar track");
    });

    setHasGuitarDelay(true);
  }, [project, tracks, hasGuitarDelay]);

  const handleRemoveGuitarDelay = useCallback(() => {
    if (!project || !hasGuitarDelay || !guitarDelayRef.current) return;

    project.editing.modify(() => {
      guitarDelayRef.current.delete();
      guitarDelayRef.current = null;
      console.log("Removed delay from Guitar track");
    });

    setHasGuitarDelay(false);
  }, [project, hasGuitarDelay]);

  const handleAddBassLoCrusher = useCallback(() => {
    if (!project || hasBassLoCrusher) return;

    const bassTrack = tracks.find(t => t.name === "Bass & Drums");
    if (!bassTrack) return;

    project.editing.modify(() => {
      const crusher = project.api.insertEffect(
        bassTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Crusher
      );

      // Configure crusher for obvious lo-fi effect
      crusher.label.setValue("Lo-Fi Crusher");
      crusher.bits.setValue(6);  // Extreme bit reduction (very obvious!)
      crusher.crush.setValue(0.9);  // Heavy crushing (0-1 range)
      crusher.boost.setValue(0.5);  // Boost to compensate for level loss (0-1 range)
      crusher.mix.setValue(0.7);  // 70% wet for dramatic but musical effect

      // Store reference for removal
      bassLoCrusherRef.current = crusher;

      console.log("Added lo-fi crusher to Bass & Drums track");
    });

    setHasBassLoCrusher(true);
  }, [project, tracks, hasBassLoCrusher]);

  const handleRemoveBassLoCrusher = useCallback(() => {
    if (!project || !hasBassLoCrusher || !bassLoCrusherRef.current) return;

    project.editing.modify(() => {
      bassLoCrusherRef.current.delete();
      bassLoCrusherRef.current = null;
      console.log("Removed lo-fi crusher from Bass & Drums track");
    });

    setHasBassLoCrusher(false);
  }, [project, hasBassLoCrusher]);

  const handleAddMasterCompressor = useCallback(() => {
    if (!project || hasMasterCompressor) return;

    project.editing.modify(() => {
      // Access the master audio unit (first incoming pointer to outputDevice)
      const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

      if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
      }

      const compressor = project.api.insertEffect(
        masterAudioUnit.audioEffects,
        EffectFactories.AudioNamed.Compressor
      );

      // Configure mastering compressor
      compressor.label.setValue("Master Glue");
      compressor.threshold.setValue(-12.0);  // Gentle threshold
      compressor.ratio.setValue(2.0);  // Gentle ratio
      compressor.attack.setValue(5.0);  // Fast attack
      compressor.release.setValue(100.0);  // Medium release
      compressor.automakeup.setValue(true);  // Auto makeup gain
      compressor.knee.setValue(6.0);  // Soft knee

      // Store reference for removal
      masterCompressorRef.current = compressor;

      console.log("Added compressor to master output");
    });

    setHasMasterCompressor(true);
  }, [project, hasMasterCompressor]);

  const handleRemoveMasterCompressor = useCallback(() => {
    if (!project || !hasMasterCompressor || !masterCompressorRef.current) return;

    project.editing.modify(() => {
      masterCompressorRef.current.delete();
      masterCompressorRef.current = null;
      console.log("Removed compressor from master output");
    });

    setHasMasterCompressor(false);
  }, [project, hasMasterCompressor]);

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
      <GitHubCorner url="https://github.com/moisesai/opendaw" />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          {/* Header */}
          <Flex direction="column" gap="3">
            <Heading size="8">OpenDAW Effects Demo</Heading>
            <Text size="4" color="gray">
              Multi-track mixer with professional audio effects (Reverb, Delay, Lo-Fi Crusher, Compressor)
            </Text>
          </Flex>

          {/* Info callout */}
          <Callout.Root color="blue">
            <Callout.Text>
              💡 This demo shows OpenDAW's mixer controls and professional audio effects.
              Each track has independent volume, mute, and solo controls. Add studio-quality effects
              to individual tracks (Compressor + Reverb on Vocals demonstrates effect chain ordering, Delay on Guitar, Lo-Fi Crusher on Bass) or the master output (Compressor for mix glue).
            </Callout.Text>
          </Callout.Root>

          {/* Transport controls */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Transport</Heading>
              <Separator size="4" />
              <Flex gap="3" align="center">
                <Button
                  color="green"
                  variant={isPlaying ? "solid" : "soft"}
                  onClick={handlePlay}
                  disabled={isPlaying}
                >
                  ▶ Play
                </Button>
                <Button
                  color="orange"
                  onClick={handlePause}
                  disabled={!isPlaying}
                >
                  ⏸ Pause
                </Button>
                <Button
                  color="red"
                  onClick={handleStop}
                  disabled={!isPlaying}
                >
                  ⏹ Stop
                </Button>
                <Separator orientation="vertical" size="2" />
                <Text size="2" color="gray">
                  Position: {(currentPosition / Quarter).toFixed(2)} quarters
                </Text>
                <Badge color={isPlaying ? "green" : "gray"}>
                  {isPlaying ? "Playing" : "Stopped"}
                </Badge>
              </Flex>
            </Flex>
          </Card>

          {/* Mixer section */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Mixer</Heading>
              <Separator size="4" />

              {/* Timeline and tracks container with shared border */}
              <Flex direction="column" gap="0" style={{ border: "1px solid var(--gray-6)" }}>
                {/* Timeline - Shows 30-second duration */}
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  gap: 0,
                  alignItems: "stretch",
                  borderBottom: "1px solid var(--gray-6)"
                }}>
                  {/* Left spacer matching controls width - using inline flex to match TrackRow exactly */}
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    width: "200px",
                    padding: "12px",
                    backgroundColor: "var(--gray-3)",
                    borderRight: "1px solid var(--gray-6)",
                    boxSizing: "border-box"
                  }}
                  ></div>

                  {/* Timeline ruler aligned with waveforms */}
                  <div style={{
                    flex: 1,
                    height: "24px",
                    position: "relative",
                    borderBottom: "1px solid var(--gray-8)",
                    backgroundColor: "var(--gray-2)",
                    boxSizing: "border-box"
                  }}>
                    {/* Generate tick marks every second */}
                    {Array.from({ length: 31 }, (_, i) => {
                      const seconds = i;
                      const percent = (seconds / 30) * 100;
                      const isMajorTick = seconds % 5 === 0;

                      return (
                        <div
                          key={seconds}
                          style={{
                            position: "absolute",
                            left: `${percent}%`,
                            bottom: 0,
                            height: isMajorTick ? "12px" : "6px",
                            width: "1px",
                            backgroundColor: isMajorTick ? "var(--gray-10)" : "var(--gray-7)"
                          }}
                        />
                      );
                    })}

                    {/* Time labels at major intervals */}
                    {[0, 5, 10, 15, 20, 25, 30].map((seconds) => {
                      const percent = (seconds / 30) * 100;
                      return (
                        <div
                          key={`label-${seconds}`}
                          style={{
                            position: "absolute",
                            left: `${percent}%`,
                            top: "-6px",
                            transform: "translateX(-50%)"
                          }}
                        >
                          <Text size="1" color="gray" style={{ fontWeight: "500" }}>
                            {seconds}
                          </Text>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {tracks.map(track => (
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
                  />
                ))}
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

                <Card variant="surface">
                  <Flex direction="column" gap="2">
                    <Flex justify="between" align="center">
                      <Flex direction="column" gap="1">
                        <Text weight="bold">Vocals - Reverb</Text>
                        <Text size="2" color="gray">
                          Adds spacious ambience to vocal track
                        </Text>
                      </Flex>
                      <Button
                        color={hasVocalsReverb ? "red" : "purple"}
                        onClick={hasVocalsReverb ? handleRemoveVocalsReverb : handleAddVocalsReverb}
                      >
                        {hasVocalsReverb ? "− Remove" : "+ Add Reverb"}
                      </Button>
                    </Flex>
                    {hasVocalsReverb && (
                      <Badge color="purple">Active: Medium room, 20ms pre-delay</Badge>
                    )}
                  </Flex>
                </Card>

                <Card variant="surface">
                  <Flex direction="column" gap="2">
                    <Flex justify="between" align="center">
                      <Flex direction="column" gap="1">
                        <Text weight="bold">Vocals - Compressor</Text>
                        <Text size="2" color="gray">
                          Smooths vocal dynamics (adds at index 0, before reverb)
                        </Text>
                      </Flex>
                      <Button
                        color={hasVocalsCompressor ? "red" : "purple"}
                        onClick={hasVocalsCompressor ? handleRemoveVocalsCompressor : handleAddVocalsCompressor}
                      >
                        {hasVocalsCompressor ? "− Remove" : "+ Add Compressor"}
                      </Button>
                    </Flex>
                    {hasVocalsCompressor && (
                      <Badge color="purple">Active: 3:1 ratio, -18dB threshold, at index 0</Badge>
                    )}
                  </Flex>
                </Card>

                <Card variant="surface">
                  <Flex direction="column" gap="2">
                    <Flex justify="between" align="center">
                      <Flex direction="column" gap="1">
                        <Text weight="bold">Guitar - Delay</Text>
                        <Text size="2" color="gray">
                          Adds rhythmic echo effect to guitar track
                        </Text>
                      </Flex>
                      <Button
                        color={hasGuitarDelay ? "red" : "purple"}
                        onClick={hasGuitarDelay ? handleRemoveGuitarDelay : handleAddGuitarDelay}
                      >
                        {hasGuitarDelay ? "− Remove" : "+ Add Delay"}
                      </Button>
                    </Flex>
                    {hasGuitarDelay && (
                      <Badge color="purple">Active: 1/8 note, light feedback</Badge>
                    )}
                  </Flex>
                </Card>

                <Card variant="surface">
                  <Flex direction="column" gap="2">
                    <Flex justify="between" align="center">
                      <Flex direction="column" gap="1">
                        <Text weight="bold">Bass & Drums - Lo-Fi Crusher</Text>
                        <Text size="2" color="gray">
                          Extreme bit-crushing for dramatic lo-fi distortion (very obvious!)
                        </Text>
                      </Flex>
                      <Button
                        color={hasBassLoCrusher ? "red" : "purple"}
                        onClick={hasBassLoCrusher ? handleRemoveBassLoCrusher : handleAddBassLoCrusher}
                      >
                        {hasBassLoCrusher ? "− Remove" : "+ Add Crusher"}
                      </Button>
                    </Flex>
                    {hasBassLoCrusher && (
                      <Badge color="purple">Active: 6-bit depth, heavy crush</Badge>
                    )}
                  </Flex>
                </Card>
              </Flex>

              {/* Master Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Master Output Effects</Heading>

                <Card variant="surface">
                  <Flex direction="column" gap="2">
                    <Flex justify="between" align="center">
                      <Flex direction="column" gap="1">
                        <Text weight="bold">Master - Compressor</Text>
                        <Text size="2" color="gray">
                          "Glue" compressor for cohesive mix on all tracks
                        </Text>
                      </Flex>
                      <Button
                        color={hasMasterCompressor ? "red" : "purple"}
                        onClick={hasMasterCompressor ? handleRemoveMasterCompressor : handleAddMasterCompressor}
                      >
                        {hasMasterCompressor ? "− Remove" : "+ Add Compressor"}
                      </Button>
                    </Flex>
                    {hasMasterCompressor && (
                      <Badge color="purple">Active: 2:1 ratio, -12dB threshold</Badge>
                    )}
                  </Flex>
                </Card>
              </Flex>

              <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                💡 Tip: Try adding and removing effects while playback is active to hear the difference in real-time!
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
