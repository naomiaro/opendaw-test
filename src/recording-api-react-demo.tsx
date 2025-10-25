// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { assert, Procedure, Progress, unitValue, UUID } from "@opendaw/lib-std";
import { Promises } from "@opendaw/lib-runtime";
import { SampleMetaData, SoundfontMetaData } from "@opendaw/studio-adapters";
import {
  AudioWorklets,
  DefaultSampleLoaderManager,
  DefaultSoundfontLoaderManager,
  InstrumentFactories,
  OpenSampleAPI,
  OpenSoundfontAPI,
  Project,
  Workers,
  SampleStorage
} from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";
import { testFeatures } from "./features";
import { GitHubCorner } from "./components/GitHubCorner";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card,
  Checkbox,
  TextField,
  Select,
  Callout,
  Separator
} from "@radix-ui/themes";

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";

/**
 * Main Recording Demo App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // UI state
  const [isArmed, setIsArmed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [countInBeatsRemaining, setCountInBeatsRemaining] = useState(0);
  const [useCountIn, setUseCountIn] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [armStatus, setArmStatus] = useState('Click "Arm Track" to prepare for recording');
  const [recordStatus, setRecordStatus] = useState("Arm a track first");
  const [playbackStatus, setPlaybackStatus] = useState("No recording available");
  const [hasPeaks, setHasPeaks] = useState(false);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [timeSignatureNumerator, setTimeSignatureNumerator] = useState(3);
  const [timeSignatureDenominator, setTimeSignatureDenominator] = useState(4);
  const [countInBars, setCountInBars] = useState(1);

  // Ref to track if we're currently in a recording/counting-in session (not subject to re-renders)
  const isRecordingSessionRef = useRef(false);

  // Refs for non-reactive values - these don't need to trigger re-renders
  const tapeUnitRef = useRef<{ audioUnitBox: any; trackBox: any } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasPainterRef = useRef<CanvasPainter | null>(null);
  const currentPeaksRef = useRef<any>(null);

  // Channel padding in pixels (matches OpenDAW pattern)
  const CHANNEL_PADDING = 4;

  /**
   * Update the current peaks data and request a canvas repaint.
   * Returns false if no valid peaks data to render.
   */
  const updatePeaks = useCallback((peaks: any): boolean => {
    if (!peaks) {
      return false;
    }

    // Check if this is a PeaksWriter (during recording) or Peaks (after recording)
    const isPeaksWriter = "dataIndex" in peaks;

    if (isPeaksWriter) {
      const numWrittenPeaks = peaks.dataIndex[0];
      if (numWrittenPeaks === 0) {
        return false; // No peaks written yet
      }
    }

    // Store peaks and request render
    currentPeaksRef.current = peaks;
    canvasPainterRef.current?.requestUpdate();

    setHasPeaks(true);
    return true;
  }, []);

  // Initialize CanvasPainter when canvas becomes available (when recording starts or has peaks)
  useEffect(() => {
    // Only initialize when canvas should be visible
    if (!isRecording && !hasPeaks) {
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      console.log('[CanvasPainter] Canvas ref not available yet');
      return undefined;
    }

    // Don't reinitialize if already exists
    if (canvasPainterRef.current) {
      console.log('[CanvasPainter] Painter already initialized');
      return undefined;
    }

    console.log('[CanvasPainter] Initializing painter');

    // Create painter with rendering callback
    const painter = new CanvasPainter(canvas, (_, context) => {
      const peaks = currentPeaksRef.current;
      if (!peaks) {
        // Clear canvas if no peaks
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        return;
      }

      // Clear canvas
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // Check if this is a PeaksWriter (during recording) or Peaks (after recording)
      const isPeaksWriter = "dataIndex" in peaks;

      let actualFrames: number;
      if (isPeaksWriter) {
        const numWrittenPeaks = peaks.dataIndex[0];
        actualFrames = numWrittenPeaks * peaks.unitsEachPeak();
        console.log(`[Peaks] Rendering ${numWrittenPeaks} peaks (${actualFrames} frames) for ${peaks.numChannels} channels`);
      } else {
        actualFrames = peaks.numFrames;
        console.log(`[Peaks] Rendering final peaks: ${actualFrames} frames for ${peaks.numChannels} channels`);
      }

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
          u1: actualFrames,
          v0: -1,
          v1: 1
        });
      }
    });

    canvasPainterRef.current = painter;

    return () => {
      console.log('[CanvasPainter] Terminating painter');
      painter.terminate();
      canvasPainterRef.current = null;
    };
  }, [isRecording, hasPeaks]); // Initialize when canvas becomes visible

  // Subscribe to count-in and recording observables
  useEffect(() => {
    if (!project) return undefined;

    const countingInSubscription = project.engine.isCountingIn.catchupAndSubscribe(obs => {
      const countingIn = obs.getValue();
      setIsCountingIn(countingIn);

      // Update status when count-in finishes
      if (!countingIn && project.engine.isRecording.getValue()) {
        setRecordStatus("Recording...");
      }

      // If count-in just ended but we're not recording anymore, clear the session ref
      if (!countingIn && !project.engine.isRecording.getValue()) {
        isRecordingSessionRef.current = false;
        console.log('[CountIn Observable] Count-in ended without recording, cleared sessionRef');
      }
    });

    const beatsRemainingSubscription = project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
      setCountInBeatsRemaining(Math.ceil(obs.getValue()));
    });

    const recordingSubscription = project.engine.isRecording.catchupAndSubscribe(obs => {
      const recording = obs.getValue();

      if (recording) {
        // Update status when recording starts (after count-in)
        if (!project.engine.isCountingIn.getValue()) {
          setRecordStatus("Recording...");
        }
      } else {
        // Update status when recording stops
        setRecordStatus("Recording stopped");

        // Also clear the session ref when recording actually stops
        isRecordingSessionRef.current = false;
        console.log('[Recording Observable] Recording stopped, cleared sessionRef');
      }
    });

    const playingSubscription = project.engine.isPlaying.catchupAndSubscribe(obs => {
      const playing = obs.getValue();
      const currentlyRecording = project.engine.isRecording.getValue();
      const currentlyCountingIn = project.engine.isCountingIn.getValue();

      // Use ref to check if we're in a recording session (more reliable than state)
      const inRecordingSession = isRecordingSessionRef.current || currentlyRecording || currentlyCountingIn;

      console.log('[Playback Observable] playing=', playing, 'recording=', currentlyRecording, 'countingIn=', currentlyCountingIn, 'sessionRef=', isRecordingSessionRef.current, 'inSession=', inRecordingSession);

      // Only update playback state if we're not in a recording session
      if (!inRecordingSession) {
        setIsPlayingBack(playing);

        if (playing) {
          setPlaybackStatus("Playing...");
        } else if (!playing && hasPeaks) {
          setPlaybackStatus("Playback stopped");
        } else if (!playing) {
          setPlaybackStatus("No recording available");
        }
      } else {
        // If we're in a recording session, ensure playback state is false
        setIsPlayingBack(false);
        // Don't change playback status while recording - it should show recording-related status
      }
    });

    return () => {
      countingInSubscription.terminate();
      beatsRemainingSubscription.terminate();
      recordingSubscription.terminate();
      playingSubscription.terminate();
    };
  }, [project, hasPeaks]); // Removed isRecording from deps - it causes re-subscription on every recording state change

  // Watch for new AudioRegionBox creation during recording to get live peaks
  // This effect starts when recording begins and continues until final peaks are received
  useEffect(() => {
    if (!project) return undefined;

    console.log('[Peaks] Effect mounted, waiting for recording to start...');

    let regionCheckTerminable: any = null;
    let livePeaksTerminable: any = null;
    let currentRecordingWorklet: any = null;
    let lastLogTime = 0;
    let monitoringStarted = false;

    // Subscribe to recording state to know when to start monitoring
    const recordingSubscription = project.engine.isRecording.catchupAndSubscribe(obs => {
      const recording = obs.getValue();

      console.log('[Peaks] Recording observable fired, recording=', recording, 'monitoringStarted=', monitoringStarted);

      // Only start monitoring once when recording begins
      if (recording && !monitoringStarted) {
        monitoringStarted = true;
        console.log('[Peaks] Recording started, using AnimationFrame for region monitoring...');

        // Check if tape unit exists now
        if (!tapeUnitRef.current) {
          console.error('[Peaks] ERROR: No tape unit found when recording started!');
          return;
        }

        console.log('[Peaks] Tape unit found, adding AnimationFrame callback...');

        // Use AnimationFrame to check for region creation on each frame
        regionCheckTerminable = AnimationFrame.add(() => {
          checkForRecording();
        });
      }
    });

    const monitorLivePeaks = () => {
      if (!currentRecordingWorklet) {
        return;
      }

      // RecordingWorklet.peaks returns Option<PeaksWriter> during recording, then Option<Peaks> after
      const peaksOption = currentRecordingWorklet.peaks;

      if (peaksOption && !peaksOption.isEmpty()) {
        const peaks = peaksOption.unwrap();
        const rendered = updatePeaks(peaks);

        // Check if this is the final Peaks (not PeaksWriter)
        const isPeaksWriter = "dataIndex" in peaks;

        // If we got final Peaks (not PeaksWriter), stop monitoring
        if (!isPeaksWriter && rendered) {
          console.log('[Peaks] Received final peaks, stopping monitoring');
          if (livePeaksTerminable) {
            livePeaksTerminable.terminate();
            livePeaksTerminable = null;
          }
          return;
        }
      } else {
        // Only log once per second to avoid spam
        const now = Date.now();
        if (now - lastLogTime > 1000) {
          console.log('[Peaks] Waiting for peaks...');
          lastLogTime = now;
        }
      }
    };

    // Check for new AudioRegionBox created by RecordAudio.start()
    const checkForRecording = () => {
      // If we already found the recording worklet, no need to check again
      if (currentRecordingWorklet) {
        return;
      }

      // Get trackBox at call time, not from closure
      if (!tapeUnitRef.current) {
        console.error('[Peaks] No tape unit in checkForRecording');
        return;
      }

      const { trackBox } = tapeUnitRef.current;
      const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);

      console.log('[Peaks] Checking for regions, found:', regions.length);

      if (regions.length > 0) {
        const latestRegion = regions[regions.length - 1];

        // Check if the file pointer is set
        if (latestRegion.file.isEmpty()) {
          console.log('[Peaks] Region file is empty, will check on next animation frame...');
          return;
        }

        // Get the recording UUID
        const targetAddressOption = latestRegion.file.targetAddress;

        if (targetAddressOption.isEmpty()) {
          console.log('[Peaks] Target address is empty, will check on next animation frame...');
          return;
        }

        const targetAddress = targetAddressOption.unwrap();
        const recordingUUID = targetAddress.uuid;

        console.log('[Peaks] Found recording UUID:', recordingUUID);

        // Terminate region checking now that we found what we need
        if (regionCheckTerminable) {
          regionCheckTerminable.terminate();
          regionCheckTerminable = null;
          console.log('[Peaks] Terminated region check AnimationFrame');
        }

        // Get the RecordingWorklet from the sample manager
        currentRecordingWorklet = project.sampleManager.getOrCreate(recordingUUID);

        console.log('[Peaks] Got worklet, starting live peaks monitoring with AnimationFrame...');

        // Start monitoring live peaks using AnimationFrame
        livePeaksTerminable = AnimationFrame.add(monitorLivePeaks);
      } else {
        // AudioRegionBox not created yet, will check on next animation frame
        console.log('[Peaks] No regions yet, waiting for next animation frame...');
      }
    };

    return () => {
      console.log('[Peaks] Cleanup: stopping monitoring');
      recordingSubscription.terminate();
      if (regionCheckTerminable) {
        regionCheckTerminable.terminate();
      }
      if (livePeaksTerminable) {
        livePeaksTerminable.terminate();
      }
    };
  }, [project, updatePeaks]);

  // Initialize BPM and time signature from project
  useEffect(() => {
    if (!project) return;

    // Get initial values from project
    const initialBpm = project.bpm;
    const signature = project.timelineBox.signature;

    if (signature?.nominator && signature?.denominator) {
      const initialNominator = signature.nominator.getValue();
      const initialDenominator = signature.denominator.getValue();

      setBpm(initialBpm);
      setTimeSignatureNumerator(initialNominator);
      setTimeSignatureDenominator(initialDenominator);
    }
  }, [project]);

  // Sync BPM to project
  useEffect(() => {
    if (!project?.timelineBox?.bpm) return;
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }, [project, bpm]);

  // Sync time signature to project when user changes it
  // Skip running on initial project mount to avoid overwriting initial signature
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!project?.timelineBox) return;

    // Skip the first run when project is initially set (it already has correct signature from initialization)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    project.editing.modify(() => {
      const signature = project.timelineBox.signature;
      if (signature?.nominator && signature?.denominator) {
        signature.nominator.setValue(timeSignatureNumerator);
        signature.denominator.setValue(timeSignatureDenominator);
      }
    });
  }, [project, timeSignatureNumerator, timeSignatureDenominator]);

  // Sync metronome enabled state with engine
  useEffect(() => {
    if (!project) return;
    project.engine.metronomeEnabled.setValue(metronomeEnabled);
  }, [project, metronomeEnabled]);

  // Sync count in bars with engine
  useEffect(() => {
    if (!project) return;
    project.engine.countInBarsTotal.setValue(countInBars);
  }, [project, countInBars]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        assert(crossOriginIsolated, "window must be crossOriginIsolated");

        // CRITICAL: Start the AnimationFrame loop that reads state from the worklet!
        AnimationFrame.start(window);

        setStatus("Booting...");
        await Workers.install(WorkersUrl);
        AudioWorklets.install(WorkletsUrl);

        // Delete obsolete samples
        SampleStorage.cleanDeprecated().then();

        const { status: testStatus, error: testError } = await Promises.tryCatch(testFeatures());
        if (testStatus === "rejected") {
          alert(`Could not test features (${testError})`);
          return;
        }

        const newAudioContext = new AudioContext({ latencyHint: 0 });

        const { status: workletStatus, error: workletError } = await Promises.tryCatch(
          AudioWorklets.createFor(newAudioContext)
        );
        if (workletStatus === "rejected") {
          alert(`Could not install Worklets (${workletError})`);
          return;
        }

        const sampleManager = new DefaultSampleLoaderManager({
          fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[any, SampleMetaData]> =>
            OpenSampleAPI.get().load(newAudioContext, uuid, progress)
        });

        const soundfontManager = new DefaultSoundfontLoaderManager({
          fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
            OpenSoundfontAPI.get().load(uuid, progress)
        });

        const audioWorklets = AudioWorklets.get(newAudioContext);
        const newProject = Project.new({
          audioContext: newAudioContext,
          sampleManager,
          soundfontManager,
          audioWorklets
        });

        newProject.startAudioWorklet();
        await newProject.engine.isReady();

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);
        setStatus("Ready!");
      } catch (error) {
        console.error("Initialization error:", error);
        setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleArmTrack = useCallback(async () => {
    if (!project) return;

    if (isArmed) {
      // Disarm - this automatically stops the microphone stream
      const captures = project.captureDevices.filterArmed();
      captures.forEach(capture => capture.armed.setValue(false));
      setIsArmed(false);
      setArmStatus("Track disarmed");
      setRecordStatus("Arm a track first");
      return;
    }

    try {
      setArmStatus("Preparing to record...");

      // Create a tape instrument if doesn't exist
      if (!tapeUnitRef.current) {
        project.editing.modify(() => {
          const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);
          tapeUnitRef.current = { audioUnitBox, trackBox };
        });
      }

      // Get the capture device for this audio unit
      const uuid = tapeUnitRef.current.audioUnitBox.address.uuid;
      const captureOption = project.captureDevices.get(uuid);

      if (captureOption.isEmpty()) {
        throw new Error("Could not get capture device");
      }

      const capture = captureOption.unwrap();

      // Arming automatically requests microphone access via CaptureAudio.prepareRecording()
      // The system handles: getUserMedia(), stream management, and cleanup
      capture.armed.setValue(true);

      setIsArmed(true);
      setArmStatus("Track is armed and ready to record");
      setRecordStatus("Ready to record");
    } catch (error) {
      console.error("Failed to arm track:", error);
      setArmStatus(`Error: ${error}`);
    }
  }, [project, isArmed]);

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    try {
      console.log('[Recording] Starting recording...');

      // Set ref FIRST to prevent observable from updating status
      isRecordingSessionRef.current = true;
      console.log('[Recording] Set sessionRef to TRUE');

      // Resume AudioContext if suspended (required for user interaction)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      project.engine.setPosition(0);

      // Start recording (with or without count-in)
      // The count-in state is tracked by the observable subscriptions in useEffect
      project.startRecording(useCountIn);

      // Set recording state AFTER starting recording so engine observables are already set
      setIsRecording(true);
      setIsPlayingBack(false);

      setRecordStatus(useCountIn ? "Count-in..." : "Recording...");

      // Playback status will be set by the playingSubscription observable
      console.log('[Recording] Recording started');
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecordStatus(`Error: ${error}`);
      setIsRecording(false);
      isRecordingSessionRef.current = false;
    }
  }, [project, audioContext, useCountIn]);

  const handleStopRecording = useCallback(async () => {
    if (!project || !tapeUnitRef.current) return;

    console.log('[Recording] Stopping recording...');
    project.engine.stopRecording();
    project.engine.stop(true); // Stop playback completely
    project.engine.setPosition(0); // Reset to beginning

    // Clear recording session ref
    isRecordingSessionRef.current = false;

    // Update state after engine operations
    setIsRecording(false);
    setIsPlayingBack(false);
    setRecordStatus("Recording stopped");

    // Get the recording UUID from the latest region
    const { trackBox } = tapeUnitRef.current;
    const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);

    if (regions.length > 0) {
      const latestRegion = regions[regions.length - 1];
      const targetAddressOption = latestRegion.file.targetAddress;

      if (!targetAddressOption.isEmpty()) {
        const targetAddress = targetAddressOption.unwrap();
        const recordingUUID = targetAddress.uuid;

        // Subscribe to the sample loader to know when final peaks are ready
        const sampleLoader = project.sampleManager.getOrCreate(recordingUUID);
        const subscription = sampleLoader.subscribe(state => {
          if (state.type === "loaded") {
            console.log('[Recording] Final peaks loaded');
            setPlaybackStatus("Recording ready to play");
            subscription.terminate();
          }
        });

        console.log('[Recording] Subscribed to sample loader for final peaks');
      }
    }

    console.log('[Recording] Recording stopped, sessionRef set to false');
  }, [project]);

  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    console.log('[Playback] Starting playback...');

    // Resume AudioContext if suspended
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    project.engine.setPosition(0);
    project.engine.play();
    setIsPlayingBack(true); // Set state immediately for responsive UI
    setPlaybackStatus("Playing...");
    console.log('[Playback] Playback started');
  }, [project, audioContext]);

  const handleStopPlayback = useCallback(() => {
    if (!project) return;

    console.log('[Playback] Stopping playback...');
    project.engine.stop(true);
    project.engine.setPosition(0);
    setIsPlayingBack(false); // Set state immediately for responsive UI
    setPlaybackStatus("Playback stopped");
    console.log('[Playback] Playback stopped');
  }, [project]);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">Recording API React Demo</Heading>
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
        <Flex direction="column" align="center" gap="6" style={{ maxWidth: 700, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Recording API React Demo</Heading>
            <Text size="3" color="gray">Testing OpenDAW's high-level Recording API with React</Text>
          </Flex>

          <Callout.Root color="orange">
            <Callout.Text>
              <strong>Note:</strong> This demo uses the Recording.start() API which requires arming a track and depends on
              engine observables. The tape unit reference is stored in a React useRef to avoid unnecessary re-renders and
              searching.
            </Callout.Text>
          </Callout.Root>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Setup</Heading>

              <Flex gap="4" wrap="wrap">
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">BPM:</Text>
                  <TextField.Root
                    type="number"
                    value={bpm.toString()}
                    onChange={e => setBpm(Number(e.target.value))}
                    disabled={isRecording}
                    style={{ width: 80 }}
                  />
                </Flex>

                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">Time Signature:</Text>
                  <Flex align="center" gap="1">
                    <TextField.Root
                      type="number"
                      value={timeSignatureNumerator.toString()}
                      onChange={e => setTimeSignatureNumerator(Number(e.target.value))}
                      disabled={isRecording}
                      style={{ width: 60 }}
                    />
                    <Text size="3" color="gray" weight="bold">/</Text>
                    <Select.Root
                      value={timeSignatureDenominator.toString()}
                      onValueChange={value => setTimeSignatureDenominator(Number(value))}
                      disabled={isRecording}
                    >
                      <Select.Trigger style={{ width: 70 }} />
                      <Select.Content>
                        <Select.Item value="2">2</Select.Item>
                        <Select.Item value="4">4</Select.Item>
                        <Select.Item value="8">8</Select.Item>
                        <Select.Item value="16">16</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </Flex>
                </Flex>

                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">Count in bars:</Text>
                  <Select.Root
                    value={countInBars.toString()}
                    onValueChange={value => setCountInBars(Number(value))}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 70 }} />
                    <Select.Content>
                      <Select.Item value="1">1</Select.Item>
                      <Select.Item value="2">2</Select.Item>
                      <Select.Item value="3">3</Select.Item>
                      <Select.Item value="4">4</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
              </Flex>

              <Separator size="4" />

              <Flex direction="column" gap="3">
                <Button
                  onClick={handleArmTrack}
                  color={isArmed ? "pink" : "purple"}
                  size="3"
                  variant="solid"
                >
                  {isArmed ? "✓ Track Armed (click to disarm)" : "🎯 Arm Track for Recording"}
                </Button>
                <Text size="2" align="center" color="gray">{armStatus}</Text>
              </Flex>
            </Flex>
          </Card>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Record Audio</Heading>

              <Flex direction="column" gap="2">
                <Flex asChild align="center" gap="2">
                  <Text as="label" size="2">
                    <Checkbox checked={useCountIn} onCheckedChange={checked => setUseCountIn(checked === true)} />
                    Use count-in before recording
                  </Text>
                </Flex>
                <Flex asChild align="center" gap="2">
                  <Text as="label" size="2">
                    <Checkbox checked={metronomeEnabled} onCheckedChange={checked => setMetronomeEnabled(checked === true)} />
                    Enable metronome (you'll hear clicks during count-in and recording)
                  </Text>
                </Flex>
              </Flex>

              {isCountingIn && (
                <Callout.Root color="amber">
                  <Callout.Text>
                    <span className="count-in-icon">🎵</span> <strong>Count-in: {countInBeatsRemaining} beats remaining</strong>
                  </Callout.Text>
                </Callout.Root>
              )}

              <Separator size="4" />

              <Flex gap="3" wrap="wrap" justify="center">
                <Button
                  onClick={handleStartRecording}
                  disabled={!isArmed || isRecording}
                  color="red"
                  size="3"
                  variant="solid"
                >
                  ⏺ Start Recording
                </Button>
                <Button
                  onClick={handleStopRecording}
                  disabled={!isRecording}
                  color="orange"
                  size="3"
                  variant="solid"
                >
                  ⏹ Stop Recording
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">{recordStatus}</Text>

              {(isRecording || hasPeaks) && (
                <Flex justify="center" align="center" mt="4" style={{ background: "var(--gray-3)", borderRadius: "var(--radius-3)", padding: "var(--space-3)" }}>
                  <canvas ref={canvasRef} style={{ width: "800px", height: "200px", display: "block" }} className="waveform-canvas" />
                </Flex>
              )}
            </Flex>
          </Card>

          <Card style={{ width: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Playback</Heading>

              <Flex gap="3" wrap="wrap" justify="center">
                <Button
                  onClick={handlePlayRecording}
                  disabled={isRecording || isPlayingBack || !hasPeaks}
                  color="green"
                  size="3"
                  variant="solid"
                >
                  ▶ Play Recording
                </Button>
                <Button
                  onClick={handleStopPlayback}
                  disabled={!isPlayingBack || isRecording}
                  color="orange"
                  size="3"
                  variant="solid"
                >
                  ⏹ Stop
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">{playbackStatus}</Text>
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
