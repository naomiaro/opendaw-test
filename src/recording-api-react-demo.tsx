// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project, AudioDevices, CaptureAudio, PeaksWriter } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import type { Peaks } from "@opendaw/lib-fusion";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { AudioRegionBox } from "@opendaw/studio-boxes";
import { CanvasPainter } from "./lib/CanvasPainter";
import { initializeOpenDAW } from "./lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "./hooks/useEnginePreference";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { BpmControl } from "./components/BpmControl";
import { TimeSignatureControl } from "./components/TimeSignatureControl";
import { RecordingPreferences } from "./components/RecordingPreferences";
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
  Separator,
  Slider,
  Badge
} from "@radix-ui/themes";
import type { MonitoringMode } from "@opendaw/studio-core";

/**
 * Simplified Recording Demo - Uses Recording.start() API properly
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [countInBeatsRemaining, setCountInBeatsRemaining] = useState(0);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [hasPeaks, setHasPeaks] = useState(false);

  // Settings
  const [useCountIn, setUseCountIn] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [timeSignatureNumerator, setTimeSignatureNumerator] = useState(3);
  const [timeSignatureDenominator, setTimeSignatureDenominator] = useState(4);

  // Engine preferences (using new hook for 0.0.87+ API)
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(
    project,
    ["metronome", "enabled"]
  );
  const [metronomeGain, setMetronomeGain] = useEnginePreference(
    project,
    ["metronome", "gain"]
  );
  const [metronomeBeatSubDivision, setMetronomeBeatSubDivision] = useEnginePreference(
    project,
    ["metronome", "beatSubDivision"]
  );
  const [countInBars, setCountInBars] = useEnginePreference(
    project,
    ["recording", "countInBars"]
  );


  // Audio input configuration
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isMono, setIsMono] = useState(false);
  const [inputGainDb, setInputGainDb] = useState(0);
  const [monitoringMode, setMonitoringMode] = useState<MonitoringMode>("off");
  const [isArmed, setIsArmed] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const captureRef = useRef<CaptureAudio | null>(null);

  // Status messages
  const [recordStatus, setRecordStatus] = useState("Click Record to start");
  const [playbackStatus, setPlaybackStatus] = useState("No recording available");

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasPainterRef = useRef<CanvasPainter | null>(null);
  const currentPeaksRef = useRef<Peaks | PeaksWriter | null>(null);
  const userMetronomePreferenceRef = useRef<boolean>(false); // Track user's metronome preference for restore after playback

  const waveformOffsetFramesRef = useRef<number>(0);
  const recordingSampleLoaderRef = useRef<SampleLoader | null>(null);
  const CHANNEL_PADDING = 4;

  // Initialize CanvasPainter when canvas is available
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasPainterRef.current) return undefined;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const peaks = currentPeaksRef.current;
      if (!peaks) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        return;
      }

      const isPeaksWriter = "dataIndex" in peaks;

      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      context.fillStyle = "#4a9eff";

      const totalHeight = canvas.clientHeight;
      const numChannels = peaks.numChannels;
      const channelHeight = totalHeight / numChannels;

      for (let channel = 0; channel < numChannels; channel++) {
        const y0 = channel * channelHeight + CHANNEL_PADDING / 2;
        const y1 = (channel + 1) * channelHeight - CHANNEL_PADDING / 2;

        // For PeaksWriter: render based on written data (dataIndex * unitsPerPeak)
        // For final Peaks: render full buffer (numFrames)
        // This gives smooth rendering during recording since dataIndex updates frequently
        const unitsToRender = isPeaksWriter
          ? peaks.dataIndex[0] * peaks.unitsEachPeak() // Smooth: updates at 60fps
          : peaks.numFrames; // Final: render all

        PeaksPainter.renderBlocks(context, peaks, channel, {
          x0: 0,
          x1: canvas.clientWidth,
          y0,
          y1,
          u0: waveformOffsetFramesRef.current,
          u1: unitsToRender,
          v0: -1,
          v1: 1
        });
      }
    });

    canvasPainterRef.current = painter;

    return () => {
      painter.terminate();
      canvasPainterRef.current = null;
    };
  }, [canvasRef.current]);

  // Subscribe to engine state
  useEffect(() => {
    if (!project) return undefined;

    const countingInSub = project.engine.isCountingIn.catchupAndSubscribe(obs => {
      const counting = obs.getValue();
      setIsCountingIn(counting);
      if (counting) {
        setRecordStatus("Count-in...");
      } else if (project.engine.isRecording.getValue()) {
        setRecordStatus("Recording...");
      }
    });

    const beatsRemainingSub = project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
      setCountInBeatsRemaining(Math.ceil(obs.getValue()));
    });

    const recordingSub = project.engine.isRecording.catchupAndSubscribe(obs => {
      const recording = obs.getValue();
      setIsRecording(recording);
      if (recording && !project.engine.isCountingIn.getValue()) {
        setRecordStatus("Recording...");
      } else if (!recording) {
        setRecordStatus("Recording stopped");

        // When recording stops, set up the timeline for playback
        // The recording region should be available immediately
        const allBoxes = project.boxGraph.boxes();

        for (const box of allBoxes) {
          if (box.name === "AudioRegionBox") {
            const regionBox = box as AudioRegionBox;
            const label = regionBox.label.getValue();

            if (label === "Recording" || label.startsWith("Take ")) {
              const duration = regionBox.duration.getValue();
              console.log("[Recording] Setting timeline loop area to:", duration);

              project.editing.modify(() => {
                project.timelineBox.loopArea.from.setValue(0);
                project.timelineBox.loopArea.to.setValue(duration);
                project.timelineBox.loopArea.enabled.setValue(false);
              });
              break;
            }
          }
        }
        // Note: hasPeaks is set by the animation frame loop when final peaks are received
      }
    });

    const playingSub = project.engine.isPlaying.catchupAndSubscribe(obs => {
      const playing = obs.getValue();
      const recording = project.engine.isRecording.getValue();

      if (!recording) {
        setIsPlayingBack(playing);
        if (playing) {
          setPlaybackStatus("Playing...");
        } else if (hasPeaks) {
          setPlaybackStatus("Playback stopped");
        } else {
          setPlaybackStatus("No recording available");
        }
      }
    });

    return () => {
      countingInSub.terminate();
      beatsRemainingSub.terminate();
      recordingSub.terminate();
      playingSub.terminate();
    };
  }, [project, hasPeaks]);

  // Track if we should be monitoring peaks (true from recording start until final peaks received)
  const [shouldMonitorPeaks, setShouldMonitorPeaks] = useState(false);

  // Start monitoring when recording starts
  useEffect(() => {
    if (isRecording && !shouldMonitorPeaks) {
      setShouldMonitorPeaks(true);
    }
  }, [isRecording, shouldMonitorPeaks]);

  // Stop monitoring when we have final peaks
  useEffect(() => {
    if (hasPeaks && shouldMonitorPeaks) {
      setShouldMonitorPeaks(false);
    }
  }, [hasPeaks, shouldMonitorPeaks]);

  // Monitor peaks - continues running after recording stops until final peaks are received
  // Uses the production-ready approach:
  // 1. Find AudioRegionBox with label "Take N" (SDK 0.0.91+) or "Recording" (older SDKs)
  // 2. Get AudioFileBox UUID from the region
  // 3. Use sampleManager.getOrCreate(uuid) to access the SampleLoader (public API)
  // 4. Access SampleLoader.peaks for live waveform data
  useEffect(() => {
    // Only run if we should be monitoring peaks
    if (!project || !shouldMonitorPeaks) return undefined;

    let animationFrameTerminable: Terminable | null = null;
    let sampleLoader: SampleLoader | null = null;

    // Use AnimationFrame to monitor for recording peaks
    animationFrameTerminable = AnimationFrame.add(() => {
      // Find the recording region in the box graph
      if (!sampleLoader) {
        const boxes = project.boxGraph.boxes();

        // In SDK 0.0.91+, recording regions are labeled "Take N" instead of "Recording"
        const recordingRegion = boxes.find((box) => {
          if (box.name !== "AudioRegionBox") return false;
          const label = (box as AudioRegionBox).label.getValue();
          return label === "Recording" || label.startsWith("Take ");
        }) as AudioRegionBox | undefined;

        if (recordingRegion) {
          // Read waveformOffset to skip count-in frames in peak rendering
          const waveformOffsetSec = recordingRegion.waveformOffset.getValue();
          if (audioContext && waveformOffsetSec > 0) {
            waveformOffsetFramesRef.current = Math.round(waveformOffsetSec * audioContext.sampleRate);
          }

          // Get the AudioFileBox from the region's file pointer
          // PointerField.targetVertex returns the Box itself (Box extends Vertex)
          const fileVertexOption = recordingRegion.file.targetVertex;
          if (!fileVertexOption.isEmpty()) {
            const fileVertex = fileVertexOption.unwrap();
            const uuid = fileVertex.address.uuid;
            sampleLoader = project.sampleManager.getOrCreate(uuid);
            recordingSampleLoaderRef.current = sampleLoader;
          }
        }
      }

      // Monitor the sample loader for peak updates
      if (sampleLoader) {
        const peaksOption = sampleLoader.peaks;
        if (peaksOption && !peaksOption.isEmpty()) {
          const peaks = peaksOption.unwrap();
          const isPeaksWriter = "dataIndex" in peaks;

          if (isPeaksWriter) {
            // Live recording - update peaks every frame for smooth rendering
            currentPeaksRef.current = peaks;
            canvasPainterRef.current?.requestUpdate();
          } else {
            // Recording finished - received final peaks
            currentPeaksRef.current = peaks;
            canvasPainterRef.current?.requestUpdate();
            setHasPeaks(true);
            setPlaybackStatus("Recording ready to play");
            console.log("[Recording] Final peaks received, playback ready");
            if (animationFrameTerminable) {
              animationFrameTerminable.terminate();
              animationFrameTerminable = null;
            }
          }
        }
      }
    });

    return () => {
      if (animationFrameTerminable) {
        animationFrameTerminable.terminate();
      }
    };
  }, [project, shouldMonitorPeaks]);

  // Initialize project settings from OpenDAW
  useEffect(() => {
    if (!project) return;

    const initialBpm = project.timelineBox.bpm.getValue();
    const signature = project.timelineBox.signature;

    if (signature?.nominator && signature?.denominator) {
      setBpm(initialBpm);
      setTimeSignatureNumerator(signature.nominator.getValue());
      setTimeSignatureDenominator(signature.denominator.getValue());
    }
  }, [project]);

  // Sync settings to project
  useEffect(() => {
    if (!project?.timelineBox?.bpm) return;
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }, [project, bpm]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!project?.timelineBox) return;
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

  // Request audio permission and enumerate devices
  const handleRequestPermission = useCallback(async () => {
    try {
      await AudioDevices.requestPermission();
      await AudioDevices.updateInputList();
      const inputs = AudioDevices.inputs;
      setAudioInputDevices([...inputs]);
      setHasPermission(true);
      if (inputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(inputs[0].deviceId);
      }
    } catch (error) {
      console.error("Failed to get audio devices:", error);
    }
  }, [selectedDeviceId]);

  // Sync capture settings when device/mono/gain/monitoring changes
  useEffect(() => {
    const capture = captureRef.current;
    if (!capture || !project) return;

    // deviceId, gainDb, requestChannels are box graph fields — require a transaction
    project.editing.modify(() => {
      if (selectedDeviceId) {
        capture.captureBox.deviceId.setValue(selectedDeviceId);
      }
      capture.requestChannels = isMono ? 1 : 2;
      capture.captureBox.gainDb.setValue(inputGainDb);
    });
    // monitoringMode manipulates Web Audio graph + may auto-arm — set outside transaction
    capture.monitoringMode = monitoringMode;
  }, [project, selectedDeviceId, isMono, inputGainDb, monitoringMode]);

  // Find and track the capture device after recording starts
  useEffect(() => {
    if (!project) return;
    const checkCapture = () => {
      const armed = project.captureDevices.filterArmed();
      for (const cap of armed) {
        if (cap instanceof CaptureAudio) {
          captureRef.current = cap;
          setIsArmed(true);
          return;
        }
      }
    };
    // Check immediately and after recording changes
    checkCapture();
    const sub = project.engine.isRecording.catchupAndSubscribe(() => checkCapture());
    return () => sub.terminate();
  }, [project, isRecording]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        // Disable looping by default for recording playback
        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.enabled.setValue(false);
        });

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

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    try {
      console.log("[Recording] Starting recording...");

      // Resume AudioContext if needed
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Request microphone permission if not already granted
      if (!hasPermission) {
        try {
          await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          setHasPermission(true);
        } catch (error) {
          setRecordStatus(`Microphone error: ${error}`);
          return;
        }
      }

      // Delete any previous recording before starting a new one
      project.editing.modify(() => {
        const allBoxes = project.boxGraph.boxes();
        const recordingRegions: AudioRegionBox[] = [];

        // Find all Recording AudioRegionBox instances
        for (const box of allBoxes) {
          if (box.name === "AudioRegionBox") {
            const regionBox = box as AudioRegionBox;
            const label = regionBox.label.getValue();
            if (label === "Recording" || label.startsWith("Take ")) {
              recordingRegions.push(regionBox);
            }
          }
        }

        // Delete all previous recording regions
        console.log(`[Recording] Deleting ${recordingRegions.length} previous recording(s)`);
        recordingRegions.forEach(region => region.delete());
      });

      // Reset peaks state
      currentPeaksRef.current = null;
      waveformOffsetFramesRef.current = 0;
      recordingSampleLoaderRef.current = null;
      setHasPeaks(false);

      project.engine.setPosition(0);

      // Recording.start() handles EVERYTHING:
      // - Creates Tape instrument if needed
      // - Auto-arms the track
      // - Sets up MediaStream
      // - Creates AudioRegionBox
      // - Manages peaks
      project.startRecording(useCountIn);

      setRecordStatus(useCountIn ? "Count-in..." : "Recording...");
      console.log("[Recording] Recording started");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecordStatus(`Error: ${error}`);
    }
  }, [project, audioContext, useCountIn]);

  // Play recording from the beginning
  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // Save user's metronome preference before disabling
    userMetronomePreferenceRef.current = metronomeEnabled ?? false;

    // Temporarily disable metronome during playback to avoid double-click with recorded metronome
    // (It will be restored to the user's preference when playback stops)
    setMetronomeEnabled(false);

    // Wait for audio to be fully loaded before playing
    const isLoaded = await project.engine.queryLoadingComplete();
    if (!isLoaded) {
      console.log("[Playback] Waiting for audio to load...");
      setPlaybackStatus("Loading audio...");
      // Poll until loaded
      await new Promise<void>(resolve => {
        const checkLoaded = async () => {
          if (await project.engine.queryLoadingComplete()) {
            resolve();
          } else {
            requestAnimationFrame(checkLoaded);
          }
        };
        checkLoaded();
      });
    }

    // Reset engine and position before playing (like OpenDAW's stop button)
    project.engine.stop(true);
    project.engine.play();
    setPlaybackStatus("Playing...");
  }, [project, audioContext, metronomeEnabled]);

  // Single stop button - stops recording or playback and resets
  const handleStop = useCallback(() => {
    if (!project) return;

    const wasRecording = project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue();

    if (wasRecording) {
      // Use stopRecording() to keep the audio graph alive for finalization.
      // stop(true) kills the graph and prevents RecordingProcessor from
      // writing remaining data to the RingBuffer.
      project.engine.stopRecording();
      setRecordStatus("Recording stopped");

      // Wait for finalization via sampleLoader.subscribe, then reset engine.
      const loader = recordingSampleLoaderRef.current;
      if (loader) {
        const sub = loader.subscribe((state) => {
          if (state.type === "loaded") {
            sub.terminate();
            project.engine.stop(true);
          }
        });
      } else {
        // No sampleLoader found (e.g., count-in cancelled) — stop directly
        project.engine.stop(true);
      }
    } else {
      project.engine.stop(true);
      if (isPlayingBack) {
        setMetronomeEnabled(userMetronomePreferenceRef.current);
      }
      if (hasPeaks) {
        setPlaybackStatus("Playback stopped");
      }
    }
  }, [project, isPlayingBack, hasPeaks, setMetronomeEnabled]);

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">Recording API Demo</Heading>
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
            <Heading size="8">Recording API Demo</Heading>
            <Text size="3" color="gray">
              Simplified recording using Recording.start() API
            </Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Text>
              💡 This demo uses OpenDAW's high-level <strong>Recording.start()</strong> API which automatically: creates
              a Tape instrument, arms the track, manages the microphone stream, creates audio regions, and handles
              peaks.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Setup</Heading>

              <Flex gap="4" wrap="wrap">
                <BpmControl value={bpm} onChange={setBpm} disabled={isRecording} />
                <TimeSignatureControl
                  numerator={timeSignatureNumerator}
                  denominator={timeSignatureDenominator}
                  onNumeratorChange={setTimeSignatureNumerator}
                  onDenominatorChange={setTimeSignatureDenominator}
                  disabled={isRecording}
                />
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Count in bars:
                  </Text>
                  <Select.Root
                    value={(countInBars ?? 1).toString()}
                    onValueChange={value => setCountInBars(Number(value) as CountInBarsValue)}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 70 }} />
                    <Select.Content>
                      <Select.Item value="1">1</Select.Item>
                      <Select.Item value="2">2</Select.Item>
                      <Select.Item value="3">3</Select.Item>
                      <Select.Item value="4">4</Select.Item>
                      <Select.Item value="5">5</Select.Item>
                      <Select.Item value="6">6</Select.Item>
                      <Select.Item value="7">7</Select.Item>
                      <Select.Item value="8">8</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
              </Flex>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Audio Input</Heading>

              {!hasPermission ? (
                <Flex direction="column" gap="3" align="center">
                  <Text size="2" color="gray">
                    Grant microphone access to see available audio input devices.
                  </Text>
                  <Button onClick={handleRequestPermission} color="blue" size="2" variant="soft">
                    Request Microphone Permission
                  </Button>
                </Flex>
              ) : (
                <Flex direction="column" gap="4">
                  <Flex gap="4" wrap="wrap" align="end">
                    <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 200 }}>
                      <Text size="2" weight="medium">Input Device:</Text>
                      <Select.Root
                        value={selectedDeviceId}
                        onValueChange={setSelectedDeviceId}
                        disabled={isRecording}
                      >
                        <Select.Trigger placeholder="Select input device..." />
                        <Select.Content>
                          {audioInputDevices.map(device => (
                            <Select.Item key={device.deviceId} value={device.deviceId}>
                              {device.label || `Input ${device.deviceId.slice(0, 8)}...`}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Flex>

                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Channels:</Text>
                      <Flex gap="2">
                        <Button
                          size="1"
                          variant={isMono ? "soft" : "solid"}
                          color={isMono ? "gray" : "blue"}
                          onClick={() => setIsMono(false)}
                          disabled={isRecording}
                        >
                          Stereo
                        </Button>
                        <Button
                          size="1"
                          variant={isMono ? "solid" : "soft"}
                          color={isMono ? "blue" : "gray"}
                          onClick={() => setIsMono(true)}
                          disabled={isRecording}
                        >
                          Mono
                        </Button>
                      </Flex>
                    </Flex>

                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Monitoring:</Text>
                      <Select.Root
                        value={monitoringMode}
                        onValueChange={value => setMonitoringMode(value as MonitoringMode)}
                        disabled={isRecording}
                      >
                        <Select.Trigger style={{ width: 110 }} />
                        <Select.Content>
                          <Select.Item value="off">Off</Select.Item>
                          <Select.Item value="direct">Direct</Select.Item>
                          <Select.Item value="effects">Effects</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </Flex>
                  </Flex>

                  <Flex align="center" gap="3">
                    <Text size="2" weight="medium" style={{ minWidth: 80 }}>Input Gain:</Text>
                    <Slider
                      value={[inputGainDb + 60]}
                      onValueChange={values => setInputGainDb(values[0] - 60)}
                      min={0}
                      max={72}
                      step={0.5}
                      disabled={isRecording}
                      style={{ flex: 1 }}
                    />
                    <Text size="1" color="gray" style={{ minWidth: 55, fontFamily: "monospace" }}>
                      {inputGainDb > 0 ? "+" : ""}{inputGainDb.toFixed(1)} dB
                    </Text>
                  </Flex>

                  {isArmed && (
                    <Badge color="red" size="1">Armed for Recording</Badge>
                  )}
                </Flex>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Record Audio</Heading>

              <Callout.Root color="orange">
                <Callout.Text>
                  🎧 <strong>Use headphones when recording with metronome enabled!</strong> Without headphones, your
                  microphone will pick up the metronome sound from your speakers, causing echo/doubling during playback.
                </Callout.Text>
              </Callout.Root>

              <Flex direction="column" gap="3">
                <RecordingPreferences
                  useCountIn={useCountIn}
                  onUseCountInChange={setUseCountIn}
                  metronomeEnabled={metronomeEnabled}
                  onMetronomeEnabledChange={setMetronomeEnabled}
                />

                {/* Metronome settings - only show when metronome is enabled */}
                {metronomeEnabled && (
                  <Card style={{ background: "var(--gray-2)" }}>
                    <Flex direction="column" gap="3">
                      <Text size="2" weight="medium" color="gray">
                        Metronome Settings
                      </Text>
                      <Flex gap="4" wrap="wrap" align="center">
                        <Flex align="center" gap="2">
                          <Text size="2">Volume:</Text>
                          <Flex align="center" gap="2" style={{ width: 150 }}>
                            <Slider
                              value={[Math.round(((metronomeGain ?? -6) + 60) * (100 / 60))]}
                              onValueChange={values => {
                                // Convert 0-100 slider to -60 to 0 dB range
                                const dB = (values[0] * 60) / 100 - 60;
                                setMetronomeGain(dB);
                              }}
                              min={0}
                              max={100}
                              step={1}
                              disabled={isRecording}
                            />
                            <Text size="1" color="gray" style={{ width: 45 }}>
                              {Math.round(metronomeGain ?? -6)} dB
                            </Text>
                          </Flex>
                        </Flex>
                        <Flex align="center" gap="2">
                          <Text size="2">Subdivision:</Text>
                          <Select.Root
                            value={(metronomeBeatSubDivision ?? 1).toString()}
                            onValueChange={value =>
                              setMetronomeBeatSubDivision(Number(value) as MetronomeBeatSubDivisionValue)
                            }
                            disabled={isRecording}
                          >
                            <Select.Trigger style={{ width: 120 }} />
                            <Select.Content>
                              <Select.Item value="1">Quarter (1)</Select.Item>
                              <Select.Item value="2">Eighth (2)</Select.Item>
                              <Select.Item value="4">16th (4)</Select.Item>
                              <Select.Item value="8">32nd (8)</Select.Item>
                            </Select.Content>
                          </Select.Root>
                        </Flex>
                      </Flex>
                    </Flex>
                  </Card>
                )}
              </Flex>

              {isCountingIn && (
                <Callout.Root color="amber">
                  <Callout.Text>
                    <strong>Count-in: {countInBeatsRemaining} beats remaining</strong>
                  </Callout.Text>
                </Callout.Root>
              )}

              <Separator size="4" />

              <Flex gap="3" wrap="wrap" justify="center">
                <Button
                  onClick={handleStartRecording}
                  color="red"
                  size="3"
                  variant="solid"
                  disabled={isRecording || isCountingIn || isPlayingBack}
                >
                  ⏺ Record
                </Button>
                <Button
                  onClick={handlePlayRecording}
                  disabled={isRecording || isCountingIn || isPlayingBack || !hasPeaks}
                  color="green"
                  size="3"
                  variant="solid"
                >
                  ▶ Play
                </Button>
                <Button onClick={handleStop} color="gray" size="3" variant="solid">
                  ⏹ Stop
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">
                {isRecording || isCountingIn ? recordStatus : playbackStatus}
              </Text>

              <Flex
                justify="center"
                align="center"
                mt="4"
                style={{ background: "var(--gray-3)", borderRadius: "var(--radius-3)", padding: "var(--space-3)" }}
              >
                <canvas ref={canvasRef} style={{ width: "800px", height: "200px", display: "block" }} />
              </Flex>
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
