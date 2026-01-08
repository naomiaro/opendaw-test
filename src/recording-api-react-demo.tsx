// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Project } from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "./lib/CanvasPainter";
import { initializeOpenDAW } from "./lib/projectSetup";
import { useEnginePreference, CountInBarsValue } from "./hooks/useEnginePreference";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
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
  const [countInBars, setCountInBars] = useEnginePreference(
    project,
    ["recording", "countInBars"]
  );

  // Status messages
  const [recordStatus, setRecordStatus] = useState("Click Record to start");
  const [playbackStatus, setPlaybackStatus] = useState("No recording available");

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasPainterRef = useRef<CanvasPainter | null>(null);
  const currentPeaksRef = useRef<any>(null);
  const userMetronomePreferenceRef = useRef<boolean>(false); // Track user's metronome preference for restore after playback

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
          u0: 0,
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

  // Monitor live peaks during recording using the production-ready approach:
  // 1. Find AudioRegionBox with label "Take N" (SDK 0.0.91+) or "Recording" (older SDKs)
  // 2. Get AudioFileBox UUID from the region
  // 3. Use sampleManager.getOrCreate(uuid) to access the SampleLoader (public API)
  // 4. Access SampleLoader.peaks for live waveform data
  useEffect(() => {
    if (!project || !isRecording) return undefined;

    let animationFrameTerminable: any = null;
    let sampleLoader: any = null;

    // Use AnimationFrame to monitor for recording peaks
    animationFrameTerminable = AnimationFrame.add(() => {
      // Find the recording region in the box graph
      if (!sampleLoader) {
        const boxes = project.boxGraph.boxes();

        // In SDK 0.0.91+, recording regions are labeled "Take N" instead of "Recording"
        const recordingRegion = boxes.find((box: any) => {
          const label = box.label?.getValue?.();
          return label === "Recording" || (label && label.startsWith("Take "));
        });

        if (recordingRegion && (recordingRegion as any).file) {
          // Get the AudioFileBox from the region's file pointer
          // PointerField.targetVertex returns the Box itself (Box extends Vertex)
          const fileVertexOption = (recordingRegion as any).file.targetVertex;
          if (fileVertexOption && !fileVertexOption.isEmpty()) {
            const audioFileBox = fileVertexOption.unwrap();
            // Use the public API to get the SampleLoader
            // Box stores UUID in address.uuid, not directly in uuid
            if (audioFileBox && (audioFileBox as any).address?.uuid) {
              const uuid = (audioFileBox as any).address.uuid;
              sampleLoader = project.sampleManager.getOrCreate(uuid);
            }
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
  }, [project, isRecording]);

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

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          onStatusUpdate: setStatus
        });

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

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    try {
      console.log("[Recording] Starting recording...");

      // Resume AudioContext if needed
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Request microphone permission with constraints to prevent echo/feedback
      try {
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (error) {
        setRecordStatus(`Microphone error: ${error}`);
        return;
      }

      // Delete any previous recording before starting a new one
      // Using the high-level delete() API which handles all dependencies automatically
      project.editing.modify(() => {
        const allBoxes = project.boxGraph.boxes();
        const recordingRegions: any[] = [];

        // Find all Recording AudioRegionBox instances
        // In SDK 0.0.91+, recording regions are labeled "Take N" instead of "Recording"
        for (const box of allBoxes) {
          if (box.name === "AudioRegionBox") {
            const regionBox = box as any;
            const label = regionBox.label?.getValue();

            if (label === "Recording" || (label && label.startsWith("Take "))) {
              recordingRegions.push(regionBox);
            }
          }
        }

        // Delete all previous recording regions
        // The delete() method automatically handles clearing pointers and deleting dependent boxes (like AudioFileBox)
        console.log(`[Recording] Deleting ${recordingRegions.length} previous recording(s)`);
        recordingRegions.forEach(region => region.delete());
      });

      // Reset peaks state
      currentPeaksRef.current = null;
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

  const handleStopRecording = useCallback(() => {
    if (!project) return;

    console.log("[Recording] Stopping recording...");

    project.engine.stopRecording();
    project.engine.stop(true);
    project.engine.setPosition(0);

    setRecordStatus("Recording stopped");

    // After recording stops, set the timeline loop end to match the recording duration
    setTimeout(() => {
      // Find the Recording AudioRegionBox and set loop end to its duration
      // In SDK 0.0.91+, recording regions are labeled "Take N" instead of "Recording"
      const allBoxes = project.boxGraph.boxes();
      for (const box of allBoxes) {
        if (box.name === "AudioRegionBox") {
          const regionBox = box as any;
          const label = regionBox.label?.getValue();

          if (label === "Recording" || (label && label.startsWith("Take "))) {
            const duration = regionBox.duration.getValue();
            console.log("[Recording] Setting timeline loop end to:", duration);

            // Set the timeline loop end to match the recording duration
            project.editing.modify(() => {
              project.timelineBox.loopArea.to.setValue(duration);
            });
            break;
          }
        }
      }

      setHasPeaks(true);
      setPlaybackStatus("Recording ready to play");
    }, 500);

    console.log("[Recording] Recording stopped");
  }, [project]);

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

    project.engine.setPosition(0);
    project.engine.play();
    setPlaybackStatus("Playing...");
  }, [project, audioContext, metronomeEnabled]);

  const handleStopPlayback = useCallback(() => {
    if (!project) return;

    project.engine.stop(true);
    project.engine.setPosition(0);

    // Restore metronome to user's preference (saved before playback started)
    setMetronomeEnabled(userMetronomePreferenceRef.current);

    setPlaybackStatus("Playback stopped");
  }, [project, setMetronomeEnabled]);

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
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    BPM:
                  </Text>
                  <TextField.Root
                    type="number"
                    value={bpm.toString()}
                    onChange={e => setBpm(Number(e.target.value))}
                    disabled={isRecording}
                    style={{ width: 80 }}
                  />
                </Flex>

                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Time Signature:
                  </Text>
                  <Flex align="center" gap="1">
                    <TextField.Root
                      type="number"
                      value={timeSignatureNumerator.toString()}
                      onChange={e => setTimeSignatureNumerator(Number(e.target.value))}
                      disabled={isRecording}
                      style={{ width: 60 }}
                    />
                    <Text size="3" color="gray" weight="bold">
                      /
                    </Text>
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
              <Heading size="5">Record Audio</Heading>

              <Callout.Root color="orange">
                <Callout.Text>
                  🎧 <strong>Use headphones when recording with metronome enabled!</strong> Without headphones, your
                  microphone will pick up the metronome sound from your speakers, causing echo/doubling during playback.
                </Callout.Text>
              </Callout.Root>

              <Flex direction="column" gap="2">
                <Flex asChild align="center" gap="2">
                  <Text as="label" size="2">
                    <Checkbox checked={useCountIn} onCheckedChange={checked => setUseCountIn(checked === true)} />
                    Use count-in before recording
                  </Text>
                </Flex>
                <Flex asChild align="center" gap="2">
                  <Text as="label" size="2">
                    <Checkbox
                      checked={metronomeEnabled ?? false}
                      onCheckedChange={checked => setMetronomeEnabled(checked === true)}
                    />
                    Enable metronome
                  </Text>
                </Flex>
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
                <Button onClick={handleStartRecording} disabled={isRecording} color="red" size="3" variant="solid">
                  ⏺ Start Recording
                </Button>
                <Button onClick={handleStopRecording} disabled={!isRecording} color="orange" size="3" variant="solid">
                  ⏹ Stop Recording
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">
                {recordStatus}
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

          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Playback</Heading>

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
              <Text size="2" align="center" color="gray">
                {playbackStatus}
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
