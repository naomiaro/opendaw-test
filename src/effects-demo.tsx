// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { InstrumentFactories, Project, EffectFactories } from "@opendaw/studio-core";
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
import { EffectsSection } from "./components/EffectsSection";
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
  Separator,
  Callout
} from "@radix-ui/themes";

const { Quarter } = PPQN;

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
  const [hasGuitarCrusher, setHasGuitarCrusher] = useState(false);
  const [hasBassLoCrusher, setHasBassLoCrusher] = useState(false);
  const [hasMasterCompressor, setHasMasterCompressor] = useState(false);
  const [hasMasterLimiter, setHasMasterLimiter] = useState(false);

  // Vocals Reverb parameters
  const [vocalsReverbWet, setVocalsReverbWet] = useState(-6.0);
  const [vocalsReverbDecay, setVocalsReverbDecay] = useState(0.6);
  const [vocalsReverbPreDelay, setVocalsReverbPreDelay] = useState(0.02);
  const [vocalsReverbDamp, setVocalsReverbDamp] = useState(0.7);

  // Vocals Compressor parameters
  const [vocalsCompThreshold, setVocalsCompThreshold] = useState(-18.0);
  const [vocalsCompRatio, setVocalsCompRatio] = useState(3.0);
  const [vocalsCompAttack, setVocalsCompAttack] = useState(5.0);
  const [vocalsCompRelease, setVocalsCompRelease] = useState(50.0);
  const [vocalsCompKnee, setVocalsCompKnee] = useState(4.0);

  // Guitar Delay parameters
  const [guitarDelayWet, setGuitarDelayWet] = useState(-12.0);
  const [guitarDelayFeedback, setGuitarDelayFeedback] = useState(0.3);
  const [guitarDelayTime, setGuitarDelayTime] = useState(6);
  const [guitarDelayFilter, setGuitarDelayFilter] = useState(0.2);

  // Guitar Crusher parameters
  const [guitarCrusherBits, setGuitarCrusherBits] = useState(4);
  const [guitarCrusherCrush, setGuitarCrusherCrush] = useState(0.95);
  const [guitarCrusherBoost, setGuitarCrusherBoost] = useState(0.6);
  const [guitarCrusherMix, setGuitarCrusherMix] = useState(0.8);

  // Bass Crusher parameters
  const [bassCrusherBits, setBassCrusherBits] = useState(6);
  const [bassCrusherCrush, setBassCrusherCrush] = useState(0.9);
  const [bassCrusherBoost, setBassCrusherBoost] = useState(0.5);
  const [bassCrusherMix, setBassCrusherMix] = useState(0.7);

  // Master Compressor parameters
  const [masterCompThreshold, setMasterCompThreshold] = useState(-12.0);
  const [masterCompRatio, setMasterCompRatio] = useState(2.0);
  const [masterCompAttack, setMasterCompAttack] = useState(5.0);
  const [masterCompRelease, setMasterCompRelease] = useState(100.0);
  const [masterCompKnee, setMasterCompKnee] = useState(6.0);

  // Master Stereo Width parameters
  const [masterStereoWidth, setMasterStereoWidth] = useState(0.8);
  const [masterStereoPan, setMasterStereoPan] = useState(0.0);

  // Refs for non-reactive values
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasPaintersRef = useRef<Map<string, CanvasPainter>>(new Map());
  const trackPeaksRef = useRef<Map<string, any>>(new Map());
  const pausedPositionRef = useRef<number | null>(null);
  const currentPositionRef = useRef<number>(0);
  const bpmRef = useRef<number>(120);
  const tracksContainerRef = useRef<HTMLDivElement>(null);

  // Refs to store effect boxes for removal
  const vocalsReverbRef = useRef<any>(null);
  const vocalsCompressorRef = useRef<any>(null);
  const guitarDelayRef = useRef<any>(null);
  const guitarCrusherRef = useRef<any>(null);
  const bassLoCrusherRef = useRef<any>(null);
  const masterCompressorRef = useRef<any>(null);
  const masterLimiterRef = useRef<any>(null);

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
      (reverb as any).wet.setValue(vocalsReverbWet);
      (reverb as any).decay.setValue(vocalsReverbDecay);
      (reverb as any).preDelay.setValue(vocalsReverbPreDelay);
      (reverb as any).damp.setValue(vocalsReverbDamp);

      // Store reference for removal
      vocalsReverbRef.current = reverb;

      // Subscribe to parameter changes
      (reverb as any).wet.catchupAndSubscribe((obs: any) => setVocalsReverbWet(obs.getValue()));
      (reverb as any).decay.catchupAndSubscribe((obs: any) => setVocalsReverbDecay(obs.getValue()));
      (reverb as any).preDelay.catchupAndSubscribe((obs: any) => setVocalsReverbPreDelay(obs.getValue()));
      (reverb as any).damp.catchupAndSubscribe((obs: any) => setVocalsReverbDamp(obs.getValue()));

      console.log("Added reverb to Vocals track");
    });

    setHasVocalsReverb(true);
  }, [project, tracks, hasVocalsReverb, vocalsReverbWet, vocalsReverbDecay, vocalsReverbPreDelay, vocalsReverbDamp]);

  // Handler for updating vocals reverb parameters
  const handleVocalsReverbParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !vocalsReverbRef.current) return;

    project.editing.modify(() => {
      const reverb = vocalsReverbRef.current;
      switch (paramName) {
        case 'wet':
          (reverb as any).wet.setValue(value);
          break;
        case 'decay':
          (reverb as any).decay.setValue(value);
          break;
        case 'preDelay':
          (reverb as any).preDelay.setValue(value);
          break;
        case 'damp':
          (reverb as any).damp.setValue(value);
          break;
      }
    });
  }, [project]);

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
      (compressor as any).threshold.setValue(vocalsCompThreshold);
      (compressor as any).ratio.setValue(vocalsCompRatio);
      (compressor as any).attack.setValue(vocalsCompAttack);
      (compressor as any).release.setValue(vocalsCompRelease);
      (compressor as any).automakeup.setValue(true);
      (compressor as any).knee.setValue(vocalsCompKnee);

      // Store reference for removal
      vocalsCompressorRef.current = compressor;

      // Subscribe to parameter changes
      (compressor as any).threshold.catchupAndSubscribe((obs: any) => setVocalsCompThreshold(obs.getValue()));
      (compressor as any).ratio.catchupAndSubscribe((obs: any) => setVocalsCompRatio(obs.getValue()));
      (compressor as any).attack.catchupAndSubscribe((obs: any) => setVocalsCompAttack(obs.getValue()));
      (compressor as any).release.catchupAndSubscribe((obs: any) => setVocalsCompRelease(obs.getValue()));
      (compressor as any).knee.catchupAndSubscribe((obs: any) => setVocalsCompKnee(obs.getValue()));

      console.log("Added compressor to Vocals track at index 0");
    });

    setHasVocalsCompressor(true);
  }, [project, tracks, hasVocalsCompressor, vocalsCompThreshold, vocalsCompRatio, vocalsCompAttack, vocalsCompRelease, vocalsCompKnee]);

  const handleVocalsCompressorParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !vocalsCompressorRef.current) return;

    project.editing.modify(() => {
      const comp = vocalsCompressorRef.current;
      switch (paramName) {
        case 'threshold':
          (comp as any).threshold.setValue(value);
          break;
        case 'ratio':
          (comp as any).ratio.setValue(value);
          break;
        case 'attack':
          (comp as any).attack.setValue(value);
          break;
        case 'release':
          (comp as any).release.setValue(value);
          break;
        case 'knee':
          (comp as any).knee.setValue(value);
          break;
      }
    });
  }, [project]);

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
      (delay as any).wet.setValue(guitarDelayWet);
      (delay as any).feedback.setValue(guitarDelayFeedback);
      (delay as any).delay.setValue(guitarDelayTime);
      (delay as any).filter.setValue(guitarDelayFilter);

      // Store reference for removal
      guitarDelayRef.current = delay;

      // Subscribe to parameter changes
      (delay as any).wet.catchupAndSubscribe((obs: any) => setGuitarDelayWet(obs.getValue()));
      (delay as any).feedback.catchupAndSubscribe((obs: any) => setGuitarDelayFeedback(obs.getValue()));
      (delay as any).delay.catchupAndSubscribe((obs: any) => setGuitarDelayTime(obs.getValue()));
      (delay as any).filter.catchupAndSubscribe((obs: any) => setGuitarDelayFilter(obs.getValue()));

      console.log("Added delay to Guitar track");
    });

    setHasGuitarDelay(true);
  }, [project, tracks, hasGuitarDelay, guitarDelayWet, guitarDelayFeedback, guitarDelayTime, guitarDelayFilter]);

  const handleGuitarDelayParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !guitarDelayRef.current) return;

    project.editing.modify(() => {
      const delay = guitarDelayRef.current;
      switch (paramName) {
        case 'wet':
          (delay as any).wet.setValue(value);
          break;
        case 'feedback':
          (delay as any).feedback.setValue(value);
          break;
        case 'time':
          (delay as any).delay.setValue(value);
          break;
        case 'filter':
          (delay as any).filter.setValue(value);
          break;
      }
    });
  }, [project]);

  const handleRemoveGuitarDelay = useCallback(() => {
    if (!project || !hasGuitarDelay || !guitarDelayRef.current) return;

    project.editing.modify(() => {
      guitarDelayRef.current.delete();
      guitarDelayRef.current = null;
      console.log("Removed delay from Guitar track");
    });

    setHasGuitarDelay(false);
  }, [project, hasGuitarDelay]);

  const handleAddGuitarCrusher = useCallback(() => {
    if (!project || hasGuitarCrusher) return;

    const guitarTrack = tracks.find(t => t.name === "Guitar");
    if (!guitarTrack) return;

    project.editing.modify(() => {
      const crusher = project.api.insertEffect(
        guitarTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Crusher
      );

      // Configure crusher for very obvious lo-fi effect on guitar
      crusher.label.setValue("Guitar Lo-Fi");
      (crusher as any).bits.setValue(guitarCrusherBits);
      (crusher as any).crush.setValue(guitarCrusherCrush);
      (crusher as any).boost.setValue(guitarCrusherBoost);
      (crusher as any).mix.setValue(guitarCrusherMix);

      // Store reference for removal
      guitarCrusherRef.current = crusher;

      // Subscribe to parameter changes
      (crusher as any).bits.catchupAndSubscribe((obs: any) => setGuitarCrusherBits(obs.getValue()));
      (crusher as any).crush.catchupAndSubscribe((obs: any) => setGuitarCrusherCrush(obs.getValue()));
      (crusher as any).boost.catchupAndSubscribe((obs: any) => setGuitarCrusherBoost(obs.getValue()));
      (crusher as any).mix.catchupAndSubscribe((obs: any) => setGuitarCrusherMix(obs.getValue()));

      console.log("Added lo-fi crusher to Guitar track");
    });

    setHasGuitarCrusher(true);
  }, [project, tracks, hasGuitarCrusher, guitarCrusherBits, guitarCrusherCrush, guitarCrusherBoost, guitarCrusherMix]);

  const handleGuitarCrusherParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !guitarCrusherRef.current) return;

    project.editing.modify(() => {
      const crusher = guitarCrusherRef.current;
      switch (paramName) {
        case 'bits':
          (crusher as any).bits.setValue(value);
          break;
        case 'crush':
          (crusher as any).crush.setValue(value);
          break;
        case 'boost':
          (crusher as any).boost.setValue(value);
          break;
        case 'mix':
          (crusher as any).mix.setValue(value);
          break;
      }
    });
  }, [project]);

  const handleRemoveGuitarCrusher = useCallback(() => {
    if (!project || !hasGuitarCrusher || !guitarCrusherRef.current) return;

    project.editing.modify(() => {
      guitarCrusherRef.current.delete();
      guitarCrusherRef.current = null;
      console.log("Removed lo-fi crusher from Guitar track");
    });

    setHasGuitarCrusher(false);
  }, [project, hasGuitarCrusher]);

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
      (crusher as any).bits.setValue(bassCrusherBits);
      (crusher as any).crush.setValue(bassCrusherCrush);
      (crusher as any).boost.setValue(bassCrusherBoost);
      (crusher as any).mix.setValue(bassCrusherMix);

      // Store reference for removal
      bassLoCrusherRef.current = crusher;

      // Subscribe to parameter changes
      (crusher as any).bits.catchupAndSubscribe((obs: any) => setBassCrusherBits(obs.getValue()));
      (crusher as any).crush.catchupAndSubscribe((obs: any) => setBassCrusherCrush(obs.getValue()));
      (crusher as any).boost.catchupAndSubscribe((obs: any) => setBassCrusherBoost(obs.getValue()));
      (crusher as any).mix.catchupAndSubscribe((obs: any) => setBassCrusherMix(obs.getValue()));

      console.log("Added lo-fi crusher to Bass & Drums track");
    });

    setHasBassLoCrusher(true);
  }, [project, tracks, hasBassLoCrusher, bassCrusherBits, bassCrusherCrush, bassCrusherBoost, bassCrusherMix]);

  const handleBassCrusherParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !bassLoCrusherRef.current) return;

    project.editing.modify(() => {
      const crusher = bassLoCrusherRef.current;
      switch (paramName) {
        case 'bits':
          (crusher as any).bits.setValue(value);
          break;
        case 'crush':
          (crusher as any).crush.setValue(value);
          break;
        case 'boost':
          (crusher as any).boost.setValue(value);
          break;
        case 'mix':
          (crusher as any).mix.setValue(value);
          break;
      }
    });
  }, [project]);

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
        (masterAudioUnit as any).audioEffects,
        EffectFactories.AudioNamed.Compressor
      );

      // Configure mastering compressor
      compressor.label.setValue("Master Glue");
      (compressor as any).threshold.setValue(masterCompThreshold);
      (compressor as any).ratio.setValue(masterCompRatio);
      (compressor as any).attack.setValue(masterCompAttack);
      (compressor as any).release.setValue(masterCompRelease);
      (compressor as any).automakeup.setValue(true);
      (compressor as any).knee.setValue(masterCompKnee);

      // Store reference for removal
      masterCompressorRef.current = compressor;

      // Subscribe to parameter changes
      (compressor as any).threshold.catchupAndSubscribe((obs: any) => setMasterCompThreshold(obs.getValue()));
      (compressor as any).ratio.catchupAndSubscribe((obs: any) => setMasterCompRatio(obs.getValue()));
      (compressor as any).attack.catchupAndSubscribe((obs: any) => setMasterCompAttack(obs.getValue()));
      (compressor as any).release.catchupAndSubscribe((obs: any) => setMasterCompRelease(obs.getValue()));
      (compressor as any).knee.catchupAndSubscribe((obs: any) => setMasterCompKnee(obs.getValue()));

      console.log("Added compressor to master output");
    });

    setHasMasterCompressor(true);
  }, [project, hasMasterCompressor, masterCompThreshold, masterCompRatio, masterCompAttack, masterCompRelease, masterCompKnee]);

  const handleMasterCompressorParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !masterCompressorRef.current) return;

    project.editing.modify(() => {
      const comp = masterCompressorRef.current;
      switch (paramName) {
        case 'threshold':
          (comp as any).threshold.setValue(value);
          break;
        case 'ratio':
          (comp as any).ratio.setValue(value);
          break;
        case 'attack':
          (comp as any).attack.setValue(value);
          break;
        case 'release':
          (comp as any).release.setValue(value);
          break;
        case 'knee':
          (comp as any).knee.setValue(value);
          break;
      }
    });
  }, [project]);

  const handleRemoveMasterCompressor = useCallback(() => {
    if (!project || !hasMasterCompressor || !masterCompressorRef.current) return;

    project.editing.modify(() => {
      masterCompressorRef.current.delete();
      masterCompressorRef.current = null;
      console.log("Removed compressor from master output");
    });

    setHasMasterCompressor(false);
  }, [project, hasMasterCompressor]);

  const handleAddMasterLimiter = useCallback(() => {
    if (!project || hasMasterLimiter) return;

    project.editing.modify(() => {
      // Access the master audio unit (first incoming pointer to outputDevice)
      const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

      if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
      }

      const stereoTool = project.api.insertEffect(
        (masterAudioUnit as any).audioEffects,
        EffectFactories.AudioNamed.StereoTool
      );

      // Configure stereo tool for wider stereo field
      stereoTool.label.setValue("Master Width");
      (stereoTool as any).stereo.setValue(masterStereoWidth);
      (stereoTool as any).panning.setValue(masterStereoPan);

      // Store reference for removal
      masterLimiterRef.current = stereoTool;

      // Subscribe to parameter changes
      (stereoTool as any).stereo.catchupAndSubscribe((obs: any) => setMasterStereoWidth(obs.getValue()));
      (stereoTool as any).panning.catchupAndSubscribe((obs: any) => setMasterStereoPan(obs.getValue()));

      console.log("Added stereo width to master output");
    });

    setHasMasterLimiter(true);
  }, [project, hasMasterLimiter, masterStereoWidth, masterStereoPan]);

  const handleMasterStereoParamChange = useCallback((paramName: string, value: number) => {
    if (!project || !masterLimiterRef.current) return;

    project.editing.modify(() => {
      const stereo = masterLimiterRef.current;
      switch (paramName) {
        case 'width':
          (stereo as any).stereo.setValue(value);
          break;
        case 'pan':
          (stereo as any).panning.setValue(value);
          break;
      }
    });
  }, [project]);

  const handleRemoveMasterLimiter = useCallback(() => {
    if (!project || !hasMasterLimiter || !masterLimiterRef.current) return;

    project.editing.modify(() => {
      masterLimiterRef.current.delete();
      masterLimiterRef.current = null;
      console.log("Removed stereo width from master output");
    });

    setHasMasterLimiter(false);
  }, [project, hasMasterLimiter]);

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
                  isActive={hasVocalsReverb}
                  onToggle={hasVocalsReverb ? handleRemoveVocalsReverb : handleAddVocalsReverb}
                  parameters={[
                    {
                      name: 'wet',
                      label: 'Wet/Dry Mix',
                      value: vocalsReverbWet,
                      min: -60,
                      max: 0,
                      step: 0.1,
                      unit: ' dB'
                    },
                    {
                      name: 'decay',
                      label: 'Decay Time',
                      value: vocalsReverbDecay,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'preDelay',
                      label: 'Pre-Delay',
                      value: vocalsReverbPreDelay,
                      min: 0,
                      max: 0.1,
                      step: 0.001,
                      format: (v) => `${(v * 1000).toFixed(0)} ms`
                    },
                    {
                      name: 'damp',
                      label: 'Damping',
                      value: vocalsReverbDamp,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    }
                  ]}
                  onParameterChange={handleVocalsReverbParamChange}
                />

                <EffectPanel
                  title="Vocals - Compressor"
                  description="Smooths vocal dynamics (adds at index 0, before reverb)"
                  isActive={hasVocalsCompressor}
                  onToggle={hasVocalsCompressor ? handleRemoveVocalsCompressor : handleAddVocalsCompressor}
                  parameters={[
                    {
                      name: 'threshold',
                      label: 'Threshold',
                      value: vocalsCompThreshold,
                      min: -60,
                      max: 0,
                      step: 0.5,
                      unit: ' dB'
                    },
                    {
                      name: 'ratio',
                      label: 'Ratio',
                      value: vocalsCompRatio,
                      min: 1,
                      max: 20,
                      step: 0.1,
                      format: (v) => `${v.toFixed(1)}:1`
                    },
                    {
                      name: 'attack',
                      label: 'Attack',
                      value: vocalsCompAttack,
                      min: 0.1,
                      max: 100,
                      step: 0.1,
                      unit: ' ms'
                    },
                    {
                      name: 'release',
                      label: 'Release',
                      value: vocalsCompRelease,
                      min: 10,
                      max: 1000,
                      step: 10,
                      unit: ' ms'
                    },
                    {
                      name: 'knee',
                      label: 'Knee',
                      value: vocalsCompKnee,
                      min: 0,
                      max: 12,
                      step: 0.5,
                      unit: ' dB'
                    }
                  ]}
                  onParameterChange={handleVocalsCompressorParamChange}
                />

                <EffectPanel
                  title="Guitar - Delay"
                  description="Adds rhythmic echo effect to guitar track"
                  isActive={hasGuitarDelay}
                  onToggle={hasGuitarDelay ? handleRemoveGuitarDelay : handleAddGuitarDelay}
                  parameters={[
                    {
                      name: 'wet',
                      label: 'Wet/Dry Mix',
                      value: guitarDelayWet,
                      min: -60,
                      max: 0,
                      step: 0.1,
                      unit: ' dB'
                    },
                    {
                      name: 'feedback',
                      label: 'Feedback',
                      value: guitarDelayFeedback,
                      min: 0,
                      max: 0.95,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'time',
                      label: 'Delay Time',
                      value: guitarDelayTime,
                      min: 1,
                      max: 16,
                      step: 1,
                      format: (v) => {
                        const notes = ['1/16', '1/8', '1/4', '1/2', '1'];
                        const index = Math.round((v - 1) / 3);
                        return notes[Math.min(index, notes.length - 1)] || `${v} PPQN`;
                      }
                    },
                    {
                      name: 'filter',
                      label: 'Filter',
                      value: guitarDelayFilter,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    }
                  ]}
                  onParameterChange={handleGuitarDelayParamChange}
                />

                <EffectPanel
                  title="Guitar - Lo-Fi Crusher"
                  description="Heavy bit-crushing for very obvious lo-fi distortion effect"
                  isActive={hasGuitarCrusher}
                  onToggle={hasGuitarCrusher ? handleRemoveGuitarCrusher : handleAddGuitarCrusher}
                  parameters={[
                    {
                      name: 'bits',
                      label: 'Bit Depth',
                      value: guitarCrusherBits,
                      min: 1,
                      max: 16,
                      step: 1,
                      format: (v) => `${v.toFixed(0)} bits`
                    },
                    {
                      name: 'crush',
                      label: 'Crush Amount',
                      value: guitarCrusherCrush,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'boost',
                      label: 'Boost',
                      value: guitarCrusherBoost,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'mix',
                      label: 'Wet/Dry Mix',
                      value: guitarCrusherMix,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    }
                  ]}
                  onParameterChange={handleGuitarCrusherParamChange}
                />

                <EffectPanel
                  title="Bass & Drums - Lo-Fi Crusher"
                  description="Extreme bit-crushing for dramatic lo-fi distortion (very obvious!)"
                  isActive={hasBassLoCrusher}
                  onToggle={hasBassLoCrusher ? handleRemoveBassLoCrusher : handleAddBassLoCrusher}
                  parameters={[
                    {
                      name: 'bits',
                      label: 'Bit Depth',
                      value: bassCrusherBits,
                      min: 1,
                      max: 16,
                      step: 1,
                      format: (v) => `${v.toFixed(0)} bits`
                    },
                    {
                      name: 'crush',
                      label: 'Crush Amount',
                      value: bassCrusherCrush,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'boost',
                      label: 'Boost',
                      value: bassCrusherBoost,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'mix',
                      label: 'Wet/Dry Mix',
                      value: bassCrusherMix,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    }
                  ]}
                  onParameterChange={handleBassCrusherParamChange}
                />
              </Flex>

              {/* Master Effects */}
              <Flex direction="column" gap="3">
                <Heading size="3">Master Output Effects</Heading>

                <EffectPanel
                  title="Master - Compressor"
                  description='"Glue" compressor for cohesive mix on all tracks'
                  isActive={hasMasterCompressor}
                  onToggle={hasMasterCompressor ? handleRemoveMasterCompressor : handleAddMasterCompressor}
                  parameters={[
                    {
                      name: 'threshold',
                      label: 'Threshold',
                      value: masterCompThreshold,
                      min: -60,
                      max: 0,
                      step: 0.5,
                      unit: ' dB'
                    },
                    {
                      name: 'ratio',
                      label: 'Ratio',
                      value: masterCompRatio,
                      min: 1,
                      max: 20,
                      step: 0.1,
                      format: (v) => `${v.toFixed(1)}:1`
                    },
                    {
                      name: 'attack',
                      label: 'Attack',
                      value: masterCompAttack,
                      min: 0.1,
                      max: 100,
                      step: 0.1,
                      unit: ' ms'
                    },
                    {
                      name: 'release',
                      label: 'Release',
                      value: masterCompRelease,
                      min: 10,
                      max: 1000,
                      step: 10,
                      unit: ' ms'
                    },
                    {
                      name: 'knee',
                      label: 'Knee',
                      value: masterCompKnee,
                      min: 0,
                      max: 12,
                      step: 0.5,
                      unit: ' dB'
                    }
                  ]}
                  onParameterChange={handleMasterCompressorParamChange}
                />

                <EffectPanel
                  title="Master - Stereo Width"
                  description="Widens the stereo field for a bigger, more spacious sound"
                  isActive={hasMasterLimiter}
                  onToggle={hasMasterLimiter ? handleRemoveMasterLimiter : handleAddMasterLimiter}
                  parameters={[
                    {
                      name: 'width',
                      label: 'Stereo Width',
                      value: masterStereoWidth,
                      min: 0,
                      max: 2,
                      step: 0.01,
                      format: (v) => `${(v * 100).toFixed(0)}%`
                    },
                    {
                      name: 'pan',
                      label: 'Pan',
                      value: masterStereoPan,
                      min: -1,
                      max: 1,
                      step: 0.01,
                      format: (v) => v === 0 ? 'Center' : v < 0 ? `L${Math.abs(v * 100).toFixed(0)}` : `R${(v * 100).toFixed(0)}`
                    }
                  ]}
                  onParameterChange={handleMasterStereoParamChange}
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
