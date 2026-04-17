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
import { initializeOpenDAW } from "@/lib/projectSetup";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
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

/**
 * Multi-Device Recording Demo - Supports multiple simultaneous recording tracks
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

  // Audio input/output configuration — multi-track
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const [recordingTracks, setRecordingTracks] = useState<RecordingTrack[]>([]);

  // Status messages
  const [recordStatus, setRecordStatus] = useState("Click Record to start");
  const [playbackStatus, setPlaybackStatus] = useState("No recording available");

  // Per-track canvas refs — keyed by track index
  const canvasRefsMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const canvasPaintersMap = useRef<Map<number, CanvasPainter>>(new Map());

  // Per-track peaks state — keyed by track index
  const trackPeaksRef = useRef<Map<number, TrackPeaksState>>(new Map());

  // Track which sample loaders we've found (for finalization after stop)
  const recordingSampleLoadersRef = useRef<SampleLoader[]>([]);
  // Track finalization subscriptions for cleanup on unmount
  const finalizationSubsRef = useRef<Terminable[]>([]);

  const userMetronomePreferenceRef = useRef<boolean>(false);

  // Reactive armed count — updated via callback from RecordingTrackCard
  const [armedCount, setArmedCount] = useState(0);

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

  // Cleanup finalization subscriptions on unmount
  useEffect(() => {
    return () => {
      for (const sub of finalizationSubsRef.current) {
        sub.terminate();
      }
      finalizationSubsRef.current = [];
    };
  }, []);

  // Subscribe to engine state
  useEffect(() => {
    if (!project) return;

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
      }
    });

    const playingSub = project.engine.isPlaying.catchupAndSubscribe(obs => {
      const playing = obs.getValue();
      const recording = project.engine.isRecording.getValue();

      // After stopRecording(), the engine keeps playing for finalization.
      // Only treat isPlaying changes as user-facing playback when we're
      // not in recording/finalization mode.
      if (!recording && !shouldMonitorPeaks) {
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
  }, [project, hasPeaks, shouldMonitorPeaks]);

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

  // Monitor peaks for ALL recording tracks
  useEffect(() => {
    if (!project || !shouldMonitorPeaks || !audioContext) return;

    let animationFrameTerminable: Terminable | null = null;

    // Initialize per-track peaks state for each canvas
    for (let i = 0; i < recordingTracks.length; i++) {
      if (!trackPeaksRef.current.has(i)) {
        trackPeaksRef.current.set(i, {
          sampleLoader: null,
          peaks: null,
          waveformOffsetFrames: 0
        });
      }
    }

    let allFinalPeaksReceived = false;

    animationFrameTerminable = AnimationFrame.add(() => {
      // Ensure painters exist for all track canvases
      for (let i = 0; i < recordingTracks.length; i++) {
        ensureCanvasPainter(i);
      }

      // Find recording regions and match them to tracks
      const boxes = project.boxGraph.boxes();
      const recordingRegions: AudioRegionBox[] = [];

      for (const box of boxes) {
        if (box.name !== "AudioRegionBox") continue;
        const label = (box as AudioRegionBox).label.getValue();
        if (label === "Recording" || label.startsWith("Take ")) {
          recordingRegions.push(box as AudioRegionBox);
        }
      }

      // Assign regions to tracks in order (one region per track)
      let finalCount = 0;
      let totalTracked = 0;

      for (let i = 0; i < recordingTracks.length; i++) {
        const trackState = trackPeaksRef.current.get(i);
        if (!trackState) continue;

        // Find the region for this track index
        const region = recordingRegions[i];
        if (!region) continue;

        // Get or create sample loader for this track
        if (!trackState.sampleLoader) {
          const waveformOffsetSec = region.waveformOffset.getValue();
          if (waveformOffsetSec > 0) {
            trackState.waveformOffsetFrames = Math.round(waveformOffsetSec * audioContext.sampleRate);
          }

          const fileVertexOption = region.file.targetVertex;
          if (!fileVertexOption.isEmpty()) {
            const fileVertex = fileVertexOption.unwrap();
            const uuid = fileVertex.address.uuid;
            trackState.sampleLoader = project.sampleManager.getOrCreate(uuid);

            // Track for finalization
            if (!recordingSampleLoadersRef.current.includes(trackState.sampleLoader)) {
              recordingSampleLoadersRef.current.push(trackState.sampleLoader);
            }
          }
        }

        // Monitor the sample loader for peak updates
        if (trackState.sampleLoader) {
          totalTracked++;
          const peaksOption = trackState.sampleLoader.peaks;
          if (peaksOption && !peaksOption.isEmpty()) {
            const peaks = peaksOption.unwrap();
            const isPeaksWriter = "dataIndex" in peaks;

            trackState.peaks = peaks;
            canvasPaintersMap.current.get(i)?.requestUpdate();

            if (!isPeaksWriter) {
              finalCount++;
            }
          }
        }
      }

      // All tracked loaders have final peaks
      if (totalTracked > 0 && finalCount === totalTracked && !allFinalPeaksReceived) {
        allFinalPeaksReceived = true;
        setHasPeaks(true);
        setPlaybackStatus("Recording ready to play");
        console.log("[Recording] Final peaks received for all tracks, playback ready");
        if (animationFrameTerminable) {
          animationFrameTerminable.terminate();
          animationFrameTerminable = null;
        }
      }
    });

    return () => {
      if (animationFrameTerminable) {
        animationFrameTerminable.terminate();
      }
    };
  }, [project, shouldMonitorPeaks, audioContext, recordingTracks.length, ensureCanvasPainter]);

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

      // Enumerate output devices (not handled by AudioDevices)
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputDevices(allDevices.filter(d =>
        d.kind === "audiooutput" && d.deviceId !== "" && d.deviceId !== "default"
      ));

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

    try {
      console.log("[Recording] Starting recording...");

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

          const allDevices = await navigator.mediaDevices.enumerateDevices();
          setAudioOutputDevices(allDevices.filter(d =>
            d.kind === "audiooutput" && d.deviceId !== "" && d.deviceId !== "default"
          ));

          setHasPermission(true);
        } catch (error) {
          setRecordStatus(`Microphone error: ${error}`);
          return;
        }
      }

      // Delete any previous recording regions before starting a new one
      project.editing.modify(() => {
        const allBoxes = project.boxGraph.boxes();
        const recordingRegions: AudioRegionBox[] = [];

        for (const box of allBoxes) {
          if (box.name === "AudioRegionBox") {
            const regionBox = box as AudioRegionBox;
            const label = regionBox.label.getValue();
            if (label === "Recording" || label.startsWith("Take ")) {
              recordingRegions.push(regionBox);
            }
          }
        }

        console.log(`[Recording] Deleting ${recordingRegions.length} previous recording(s)`);
        recordingRegions.forEach(region => region.delete());
      });

      // Reset peaks state for all tracks
      trackPeaksRef.current.clear();
      recordingSampleLoadersRef.current = [];
      setHasPeaks(false);

      // Cleanup old painters
      for (const [, painter] of canvasPaintersMap.current) {
        painter.terminate();
      }
      canvasPaintersMap.current.clear();

      project.engine.setPosition(0);

      // startRecording() uses filterArmed() internally to record ALL armed tracks
      project.startRecording(useCountIn);

      setRecordStatus(useCountIn ? "Count-in..." : "Recording...");
      console.log("[Recording] Recording started");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecordStatus(`Error: ${error}`);
    }
  }, [project, audioContext, useCountIn, hasPermission]);

  // Play recording from the beginning
  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // Save user's metronome preference before disabling
    userMetronomePreferenceRef.current = metronomeEnabled ?? false;

    // Temporarily disable metronome during playback
    setMetronomeEnabled(false);

    // Wait for audio to be fully loaded before playing
    const isLoaded = await project.engine.queryLoadingComplete();
    if (!isLoaded) {
      console.log("[Playback] Waiting for audio to load...");
      setPlaybackStatus("Loading audio...");
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
    setPlaybackStatus("Playing...");
  }, [project, audioContext, metronomeEnabled]);

  // Single stop button - stops recording or playback and resets
  const handleStop = useCallback(() => {
    if (!project) return;

    const wasRecording = project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue();

    if (wasRecording) {
      // Use stopRecording() to keep the audio graph alive for finalization
      project.engine.stopRecording();
      setRecordStatus("Recording stopped");

      // Wait for finalization via sampleLoader.subscribe for ALL loaders
      // Store subscriptions in ref so they can be cleaned up on unmount
      for (const sub of finalizationSubsRef.current) {
        sub.terminate();
      }
      finalizationSubsRef.current = [];

      const loaders = recordingSampleLoadersRef.current;
      if (loaders.length > 0) {
        let finalized = 0;
        for (const loader of loaders) {
          const sub = loader.subscribe((state) => {
            if (state.type === "loaded") {
              sub.terminate();
              finalizationSubsRef.current = finalizationSubsRef.current.filter(s => s !== sub);
              finalized++;
              if (finalized === loaders.length) {
                project.engine.stop(true);
              }
            }
          });
          finalizationSubsRef.current.push(sub);
        }
      } else {
        // No sampleLoaders found (e.g., count-in cancelled) — stop directly
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
                      disabled={isRecording || isCountingIn}
                      onRemove={handleRemoveTrack}
                      onArmedChange={handleArmedChange}
                    />
                  ))}

                  <Button
                    onClick={handleAddTrack}
                    color="blue"
                    variant="soft"
                    disabled={isRecording || isCountingIn}
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
                  disabled={isRecording || isCountingIn || isPlayingBack || armedCount === 0}
                >
                  ⏺ Record{armedCount > 0 ? ` (${armedCount} track${armedCount !== 1 ? "s" : ""})` : ""}
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
