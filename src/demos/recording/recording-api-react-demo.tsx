// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import type { Terminable } from "@opendaw/lib-std";
import { Project, AudioDevices, CaptureAudio, PeaksWriter } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import type { Peaks } from "@opendaw/lib-fusion";
import { PeaksPainter } from "@opendaw/lib-fusion";
import { AudioRegionBox, AudioUnitBox } from "@opendaw/studio-boxes";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { enumerateOutputDevices } from "@/lib/audioUtils";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
import { useRecordingSession } from "@/hooks/useRecordingSession";
import type { RecordingState } from "@/hooks/useRecordingSession";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { TimeSignatureControl } from "@/components/TimeSignatureControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { RecordingTrackCard } from "@/components/RecordingTrackCard";
import type { RecordingTrack } from "@/components/RecordingTrackCard";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card,
  Select,
  Callout,
  Separator,
  Slider,
  Badge
} from "@radix-ui/themes";

const CHANNEL_PADDING = 4;

/** Per-track peaks monitoring state stored in a ref */
interface TrackPeaksState {
  sampleLoader: SampleLoader | null;
  peaks: Peaks | PeaksWriter | null;
  waveformOffsetFrames: number;
}

function getStatusMessage(state: RecordingState, countInBeats: number): string {
  switch (state) {
    case "idle": return "Click Record to start";
    case "counting-in": return `Count-in: ${countInBeats} beats remaining`;
    case "recording": return "Recording...";
    case "finalizing": return "Processing...";
    case "ready": return "Recording ready to play";
    case "playing": return "Playing...";
  }
}

/**
 * Multi-Device Recording Demo - Supports multiple simultaneous recording tracks
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Recording session state machine
  const session = useRecordingSession({ project, audioContext });

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

  // Audio input/output configuration — multi-track
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const [recordingTracks, setRecordingTracks] = useState<RecordingTrack[]>([]);

  // Per-track canvas refs — keyed by track index
  const canvasRefsMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const canvasPaintersMap = useRef<Map<number, CanvasPainter>>(new Map());

  // Per-track peaks state — keyed by track index
  const trackPeaksRef = useRef<Map<number, TrackPeaksState>>(new Map());

  const userMetronomePreferenceRef = useRef<boolean>(false);

  // Reactive armed count — updated via callback from RecordingTrackCard
  const [armedCount, setArmedCount] = useState(0);

  // Derived UI state from session
  const isActive = session.state !== "idle" && session.state !== "ready";
  const canRecord = (session.state === "idle" || session.state === "ready") && armedCount > 0;
  const canPlay = session.state === "ready";
  const canStop = session.state !== "idle" && session.state !== "ready";
  const statusMessage = getStatusMessage(session.state, session.countInBeatsRemaining);

  // Canvas ref callback for a given track index
  const getCanvasRef = useCallback((trackIndex: number) => {
    return (el: HTMLCanvasElement | null) => {
      if (el) {
        canvasRefsMap.current.set(trackIndex, el);
      } else {
        // Cleanup painter when canvas unmounts
        const painter = canvasPaintersMap.current.get(trackIndex);
        if (painter) {
          painter.terminate();
          canvasPaintersMap.current.delete(trackIndex);
        }
        canvasRefsMap.current.delete(trackIndex);
      }
    };
  }, []);

  // Initialize CanvasPainter for a specific track canvas
  const ensureCanvasPainter = useCallback((trackIndex: number) => {
    const canvas = canvasRefsMap.current.get(trackIndex);
    if (!canvas || canvasPaintersMap.current.has(trackIndex)) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const trackState = trackPeaksRef.current.get(trackIndex);
      const peaks = trackState?.peaks;

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
      const waveformOffsetFrames = trackState?.waveformOffsetFrames ?? 0;

      for (let channel = 0; channel < numChannels; channel++) {
        const y0 = channel * channelHeight + CHANNEL_PADDING / 2;
        const y1 = (channel + 1) * channelHeight - CHANNEL_PADDING / 2;

        const unitsToRender = isPeaksWriter
          ? peaks.dataIndex[0] * peaks.unitsEachPeak()
          : peaks.numFrames;

        PeaksPainter.renderPixelStrips(context, peaks, channel, {
          x0: 0,
          x1: canvas.clientWidth,
          y0,
          y1,
          u0: waveformOffsetFrames,
          u1: unitsToRender,
          v0: -1,
          v1: 1
        });
      }
    });

    canvasPaintersMap.current.set(trackIndex, painter);
  }, []);

  // Recompute armed count when a track's armed state changes
  const handleArmedChange = useCallback(() => {
    setArmedCount(
      recordingTracks.filter(t => t.capture.armed.getValue()).length
    );
  }, [recordingTracks]);

  // Set up timeline loop area when recording finishes (transition to "ready")
  useEffect(() => {
    if (!project || session.state !== "ready") return;

    const allBoxes = project.boxGraph.boxes();
    for (const box of allBoxes) {
      if (box.name === "AudioRegionBox") {
        const regionBox = box as AudioRegionBox;
        const label = regionBox.label.getValue();
        if (label === "Recording" || label.startsWith("Take ")) {
          const duration = regionBox.duration.getValue();
          project.editing.modify(() => {
            project.timelineBox.loopArea.from.setValue(0);
            project.timelineBox.loopArea.to.setValue(duration);
            project.timelineBox.loopArea.enabled.setValue(false);
          });
          break;
        }
      }
    }
  }, [project, session.state]);

  // Reactively discover recording regions via pointerHub subscriptions.
  // When the SDK creates a region during recording, the subscription fires
  // immediately — no AnimationFrame polling needed for structural discovery.
  useEffect(() => {
    if (!project || !session.shouldMonitorPeaks || !audioContext) return;

    const subs: Terminable[] = [];
    let trackIndex = 0;

    for (const track of recordingTracks) {
      const idx = trackIndex++;

      if (!trackPeaksRef.current.has(idx)) {
        trackPeaksRef.current.set(idx, {
          sampleLoader: null,
          peaks: null,
          waveformOffsetFrames: 0
        });
      }

      const trackSub = track.capture.audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
        onAdded: (pointer) => {
          const trackBox = pointer.box;
          const regionSub = (trackBox as any).regions.pointerHub.catchupAndSubscribe({
            onAdded: (regionPointer: any) => {
              const regionBox = regionPointer.box as AudioRegionBox;
              const label = regionBox.label.getValue();
              if (label !== "Recording" && !label.startsWith("Take ")) return;

              const trackState = trackPeaksRef.current.get(idx);
              if (!trackState || trackState.sampleLoader) return;

              const waveformOffsetSec = regionBox.waveformOffset.getValue();
              if (waveformOffsetSec > 0) {
                trackState.waveformOffsetFrames = Math.round(waveformOffsetSec * audioContext.sampleRate);
              }

              const fileVertex = regionBox.file.targetVertex;
              if (!fileVertex.isEmpty()) {
                const loader = project.sampleManager.getOrCreate(fileVertex.unwrap().address.uuid);
                trackState.sampleLoader = loader;
                session.registerLoader(loader);
              }
            },
            onRemoved: () => {},
          });
          subs.push(regionSub);
        },
        onRemoved: () => {},
      });
      subs.push(trackSub);
    }

    return () => {
      for (const sub of subs) {
        sub.terminate();
      }
    };
  }, [project, session.shouldMonitorPeaks, audioContext, recordingTracks, session.registerLoader]);

  // Render waveform peaks — purely visual, reads from trackPeaksRef populated above.
  useEffect(() => {
    if (!session.shouldMonitorPeaks) return;

    const animationFrameTerminable = AnimationFrame.add(() => {
      for (let i = 0; i < recordingTracks.length; i++) {
        ensureCanvasPainter(i);

        const trackState = trackPeaksRef.current.get(i);
        if (!trackState?.sampleLoader) continue;

        const peaksOption = trackState.sampleLoader.peaks;
        if (peaksOption && !peaksOption.isEmpty()) {
          trackState.peaks = peaksOption.unwrap();
          canvasPaintersMap.current.get(i)?.requestUpdate();
        }
      }
    });

    return () => animationFrameTerminable.terminate();
  }, [session.shouldMonitorPeaks, recordingTracks.length, ensureCanvasPainter]);

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
      setAudioInputDevices([...AudioDevices.inputs]);
      setAudioOutputDevices(await enumerateOutputDevices());
      setHasPermission(true);
    } catch (error) {
      console.error("Failed to get audio devices:", error);
    }
  }, []);

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

  // Add a new recording track
  const handleAddTrack = useCallback(() => {
    if (!project) return;

    // Create Tape instrument and configure capture in one transaction.
    // editing.modify() doesn't forward return values, so we capture via outer variable.
    let audioUnitBoxRef: AudioUnitBox | null = null;

    project.editing.modify(() => {
      const { audioUnitBox } = project.api.createInstrument(InstrumentFactories.Tape);
      audioUnitBoxRef = audioUnitBox;

      if (audioInputDevices.length > 0) {
        const captureOpt = project.captureDevices.get(audioUnitBox.address.uuid);
        if (!captureOpt.isEmpty()) {
          const cap = captureOpt.unwrap();
          if (cap instanceof CaptureAudio) {
            cap.captureBox.deviceId.setValue(audioInputDevices[0].deviceId);
            cap.requestChannels = 1; // mono by default
          }
        }
      }
    });

    if (!audioUnitBoxRef) return;

    // Get capture device after transaction commits
    const captureOpt = project.captureDevices.get(audioUnitBoxRef.address.uuid);
    if (captureOpt.isEmpty()) return;
    const capture = captureOpt.unwrap();
    if (!(capture instanceof CaptureAudio)) return;

    // Arm non-exclusively so other tracks stay armed
    project.captureDevices.setArm(capture, false);

    setRecordingTracks(prev => [...prev, {
      id: UUID.toString(audioUnitBoxRef.address.uuid),
      capture
    }]);
  }, [project, audioInputDevices]);

  // Remove a recording track
  const handleRemoveTrack = useCallback((id: string) => {
    setRecordingTracks(prev => {
      const track = prev.find(t => t.id === id);
      if (track) {
        // Disarm before removing
        track.capture.armed.setValue(false);
      }
      const next = prev.filter(t => t.id !== id);
      // Update armed count immediately since the removed track's
      // onArmedChange callback won't fire after unmount
      setArmedCount(next.filter(t => t.capture.armed.getValue()).length);
      return next;
    });
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    // Resume AudioContext if needed
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // Request microphone permission via AudioDevices API if not already granted
    if (!hasPermission) {
      try {
        await AudioDevices.requestPermission();
        await AudioDevices.updateInputList();
        setAudioInputDevices([...AudioDevices.inputs]);
        setAudioOutputDevices(await enumerateOutputDevices());
        setHasPermission(true);
      } catch (error) {
        console.error("Microphone permission error:", error);
        return;
      }
    }

    // Delete any previous recording regions before starting a new one
    project.editing.modify(() => {
      const allBoxes = project.boxGraph.boxes();
      for (const box of allBoxes) {
        if (box.name === "AudioRegionBox") {
          const regionBox = box as AudioRegionBox;
          const label = regionBox.label.getValue();
          if (label === "Recording" || label.startsWith("Take ")) {
            regionBox.delete();
          }
        }
      }
    });

    // Reset peaks state for all tracks
    trackPeaksRef.current.clear();
    session.resetLoaders();

    // Cleanup old painters
    for (const [, painter] of canvasPaintersMap.current) {
      painter.terminate();
    }
    canvasPaintersMap.current.clear();

    project.engine.setPosition(0);
    project.startRecording(useCountIn);
  }, [project, audioContext, useCountIn, hasPermission, session.resetLoaders]);

  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // Save user's metronome preference before disabling
    userMetronomePreferenceRef.current = metronomeEnabled ?? false;
    setMetronomeEnabled(false);

    // Wait for audio to be fully loaded before playing
    const isLoaded = await project.engine.queryLoadingComplete();
    if (!isLoaded) {
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

    project.engine.stop(true);
    project.engine.play();
  }, [project, audioContext, metronomeEnabled, setMetronomeEnabled]);

  const handleStop = useCallback(() => {
    if (!project) return;

    const wasPlaying = session.state === "playing";

    // The hook handles stopRecording() vs stop(true) and finalization
    if (session.state === "recording" || session.state === "counting-in") {
      project.engine.stopRecording();
    } else if (wasPlaying) {
      project.engine.stop(true);
    }

    // Restore metronome preference after playback
    if (wasPlaying) {
      setMetronomeEnabled(userMetronomePreferenceRef.current);
    }
  }, [project, session.state, setMetronomeEnabled]);

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
              Multi-device recording using Recording.start() API
            </Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Text>
              This demo uses OpenDAW's <strong>Recording.start()</strong> API with multi-device support.
              Add multiple recording tracks, each with its own input device, then record all armed tracks simultaneously.
              The SDK handles parallel capture with independent <strong>RecordingWorklet</strong> instances per device.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Setup</Heading>

              <Flex gap="4" wrap="wrap">
                <BpmControl value={bpm} onChange={setBpm} disabled={isActive} />
                <TimeSignatureControl
                  numerator={timeSignatureNumerator}
                  denominator={timeSignatureDenominator}
                  onNumeratorChange={setTimeSignatureNumerator}
                  onDenominatorChange={setTimeSignatureDenominator}
                  disabled={isActive}
                />
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Count in bars:
                  </Text>
                  <Select.Root
                    value={(countInBars ?? 1).toString()}
                    onValueChange={value => setCountInBars(Number(value) as CountInBarsValue)}
                    disabled={isActive}
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
              <Flex justify="between" align="center">
                <Heading size="5">Audio Input</Heading>
                {hasPermission && (
                  <Badge color="gray" size="1">
                    {armedCount} of {recordingTracks.length} track{recordingTracks.length !== 1 ? "s" : ""} armed
                  </Badge>
                )}
              </Flex>

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
                <Flex direction="column" gap="3">
                  {recordingTracks.length === 0 && (
                    <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                      No recording tracks added. Click "Add Track" to create one.
                    </Text>
                  )}

                  {recordingTracks.map((track, index) => (
                    <RecordingTrackCard
                      key={track.id}
                      track={track}
                      trackIndex={index}
                      project={project}
                      audioInputDevices={audioInputDevices}
                      audioOutputDevices={audioOutputDevices}
                      disabled={isActive}
                      onRemove={handleRemoveTrack}
                      onArmedChange={handleArmedChange}
                    />
                  ))}

                  <Button
                    onClick={handleAddTrack}
                    color="blue"
                    variant="soft"
                    disabled={isActive}
                  >
                    + Add Track
                  </Button>
                </Flex>
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Record Audio</Heading>

              <Callout.Root color="orange">
                <Callout.Text>
                  <strong>Use headphones when recording with metronome enabled!</strong> Without headphones, your
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
                              disabled={isActive}
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
                            disabled={isActive}
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

              {session.state === "counting-in" && (
                <Callout.Root color="amber">
                  <Callout.Text>
                    <strong>Count-in: {session.countInBeatsRemaining} beats remaining</strong>
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
                  disabled={!canRecord}
                >
                  ⏺ Record{armedCount > 0 ? ` (${armedCount} track${armedCount !== 1 ? "s" : ""})` : ""}
                </Button>
                <Button
                  onClick={handlePlayRecording}
                  disabled={!canPlay}
                  color="green"
                  size="3"
                  variant="solid"
                >
                  ▶ Play
                </Button>
                <Button onClick={handleStop} disabled={!canStop} color="gray" size="3" variant="solid">
                  ⏹ Stop
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">
                {statusMessage}
              </Text>

              {/* Waveform canvases — one per recording track */}
              {recordingTracks.length > 0 && (
                <Flex direction="column" gap="2" mt="4">
                  {recordingTracks.map((track, index) => (
                    <Flex
                      key={track.id}
                      direction="column"
                      gap="1"
                    >
                      <Text size="1" color="gray">Track {index + 1}</Text>
                      <Flex
                        justify="center"
                        align="center"
                        style={{
                          background: "var(--gray-3)",
                          borderRadius: "var(--radius-3)",
                          padding: "var(--space-2)"
                        }}
                      >
                        <canvas
                          ref={getCanvasRef(index)}
                          style={{ width: "800px", height: "120px", display: "block" }}
                        />
                      </Flex>
                    </Flex>
                  ))}
                </Flex>
              )}

              {/* Show a placeholder canvas when no tracks exist */}
              {recordingTracks.length === 0 && (
                <Flex
                  justify="center"
                  align="center"
                  mt="4"
                  style={{
                    background: "var(--gray-3)",
                    borderRadius: "var(--radius-3)",
                    padding: "var(--space-3)"
                  }}
                >
                  <Text size="2" color="gray" style={{ padding: "40px 0" }}>
                    Add a track to see waveforms here
                  </Text>
                </Flex>
              )}
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
