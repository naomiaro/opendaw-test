// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project, PeaksWriter } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Peaks, PeaksPainter } from "@opendaw/lib-fusion";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { getAllRegions } from "@/lib/adapterUtils";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
import { useRecordingSession } from "@/hooks/useRecordingSession";
import type { RecordingState } from "@/hooks/useRecordingSession";
import { useAudioDevicePermission } from "@/hooks/useAudioDevicePermission";
import { useRecordingTapes } from "@/hooks/useRecordingTapes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { TimeSignatureControl } from "@/components/TimeSignatureControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { RecordingTapeCard } from "@/components/RecordingTapeCard";
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

/** Per-tape peaks monitoring state stored in a ref */
interface TapePeaksState {
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
 * Multi-Device Recording Demo - Supports multiple simultaneous recording tapes
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Recording session state machine
  const session = useRecordingSession({ project });

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

  // Audio devices and recording tapes
  const { audioInputDevices, audioOutputDevices, hasPermission, requestPermission } =
    useAudioDevicePermission();
  const { recordingTapes, armedCount, addTape, removeTape, handleArmedChange } =
    useRecordingTapes({ project, audioInputDevices });

  // Keep ref in sync to avoid tearing down pointerHub subscriptions on tape changes
  const recordingTapesRef = useRef(recordingTapes);
  recordingTapesRef.current = recordingTapes;

  // Per-tape canvas refs — keyed by tape index
  const canvasRefsMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const canvasPaintersMap = useRef<Map<number, CanvasPainter>>(new Map());

  // Per-tape peaks state — keyed by tape index
  const tapePeaksRef = useRef<Map<number, TapePeaksState>>(new Map());

  const userMetronomePreferenceRef = useRef<boolean>(false);


  // Derived UI state from session
  const isActive = session.state !== "idle" && session.state !== "ready";
  const canRecord = (session.state === "idle" || session.state === "ready") && armedCount > 0;
  const canPlay = session.state === "ready";
  const canStop = session.state === "recording" || session.state === "counting-in" || session.state === "playing";
  const statusMessage = getStatusMessage(session.state, session.countInBeatsRemaining);

  // Canvas ref callback for a given tape index
  const getCanvasRef = useCallback((tapeIndex: number) => {
    return (el: HTMLCanvasElement | null) => {
      if (el) {
        canvasRefsMap.current.set(tapeIndex, el);
      } else {
        // Cleanup painter when canvas unmounts
        const painter = canvasPaintersMap.current.get(tapeIndex);
        if (painter) {
          painter.terminate();
          canvasPaintersMap.current.delete(tapeIndex);
        }
        canvasRefsMap.current.delete(tapeIndex);
      }
    };
  }, []);

  // Initialize CanvasPainter for a specific tape canvas
  const ensureCanvasPainter = useCallback((tapeIndex: number) => {
    const canvas = canvasRefsMap.current.get(tapeIndex);
    if (!canvas || canvasPaintersMap.current.has(tapeIndex)) return;

    const painter = new CanvasPainter(canvas, (_, context) => {
      const tapeState = tapePeaksRef.current.get(tapeIndex);
      const peaks = tapeState?.peaks;

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
      const waveformOffsetFrames = tapeState?.waveformOffsetFrames ?? 0;

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
          // Slight headroom absorbs the SDK Float16 unpack quirk: stored
          // peaks at exactly ±1.0 unpack to ±1.0001219511032104, which
          // would otherwise clamp and produce flat-top "square" waveforms.
          v0: -1.001,
          v1: 1.001
        });
      }
    });

    canvasPaintersMap.current.set(tapeIndex, painter);
  }, []);

  // Set up timeline loop area when recording finishes (transition to "ready")
  useEffect(() => {
    if (!project || session.state !== "ready") return;

    for (const region of getAllRegions(project)) {
      if (region.label === "Recording" || region.label.startsWith("Take ")) {
        const duration = region.box.duration.getValue();
        project.editing.modify(() => {
          project.timelineBox.loopArea.from.setValue(0);
          project.timelineBox.loopArea.to.setValue(duration);
          project.timelineBox.loopArea.enabled.setValue(false);
        });
        break;
      }
    }
  }, [project, session.state]);

  // Discover recording regions via adapter layer subscriptions.
  // Uses AudioUnitBoxAdapter.tracks.catchupAndSubscribe → TrackRegions.catchupAndSubscribe
  // for typed, reactive region discovery. Re-subscribes when tapes change.
  // Peaks rendering is done by CanvasPainter (via AnimationFrame internally).
  useEffect(() => {
    if (!project || !audioContext || recordingTapes.length === 0) return;

    const subs: Terminable[] = [];
    const allAudioUnits = project.rootBoxAdapter.audioUnits.adapters();

    for (let i = 0; i < recordingTapes.length; i++) {
      const tape = recordingTapes[i];
      const audioUnitAdapter = allAudioUnits.find(
        (au) => au.box === tape.capture.audioUnitBox
      );
      if (!audioUnitAdapter) continue;

      const tracksSub = audioUnitAdapter.tracks.catchupAndSubscribe({
        onAdd: (trackAdapter) => {
          const regionsSub = trackAdapter.regions.catchupAndSubscribe({
            onAdded: (regionAdapter) => {
              if (!regionAdapter.isAudioRegion()) return;
              const label = regionAdapter.label;
              if (label !== "Recording" && !label.startsWith("Take ")) return;

              if (!tapePeaksRef.current.has(i)) {
                tapePeaksRef.current.set(i, {
                  sampleLoader: null,
                  peaks: null,
                  waveformOffsetFrames: 0
                });
              }
              const tapeState = tapePeaksRef.current.get(i)!;
              if (tapeState.sampleLoader) return;

              const waveformOffsetSec = regionAdapter.waveformOffset.getValue();
              if (waveformOffsetSec > 0) {
                tapeState.waveformOffsetFrames = Math.round(waveformOffsetSec * audioContext.sampleRate);
              }

              // Adapter resolves sampleLoader internally via file → getOrCreateLoader()
              const fileAdapter = regionAdapter.file;
              const loader = fileAdapter.getOrCreateLoader();
              tapeState.sampleLoader = loader;
              session.registerLoader(loader);
            },
            onRemoved: () => {},
          });
          subs.push(regionsSub);
        },
        onRemove: () => {},
        onReorder: () => {},
      });
      subs.push(tracksSub);
    }

    // AnimationFrame for continuous peaks rendering — no shouldMonitorPeaks guard.
    // Runs every frame; when no sampleLoaders exist it's a no-op. This avoids
    // React batching issues where the ref stays false across recording cycles.
    const animationFrameTerminable = AnimationFrame.add(() => {
      const tapes = recordingTapesRef.current;
      for (let i = 0; i < tapes.length; i++) {
        ensureCanvasPainter(i);

        const tapeState = tapePeaksRef.current.get(i);
        if (!tapeState?.sampleLoader) continue;

        const peaksOption = tapeState.sampleLoader.peaks;
        if (peaksOption && !peaksOption.isEmpty()) {
          tapeState.peaks = peaksOption.unwrap();
          canvasPaintersMap.current.get(i)?.requestUpdate();
        }
      }
    });

    return () => {
      animationFrameTerminable.terminate();
      for (const sub of subs) {
        sub.terminate();
      }
    };
  }, [project, audioContext, recordingTapes, ensureCanvasPainter, session.registerLoader]);

  // Debug: log per-tape recorded frame counts when finalization completes.
  // Compares RecordingWorklet outputs across tapes to surface any drift.
  const prevSessionStateRef = useRef<RecordingState>(session.state);
  useEffect(() => {
    if (prevSessionStateRef.current === "finalizing" && session.state === "ready") {
      const tapes = recordingTapesRef.current;
      const summary = tapes.map((tape, i) => {
        const loader = tapePeaksRef.current.get(i)?.sampleLoader ?? null;
        const dataOpt = loader?.data;
        const data = dataOpt && !dataOpt.isEmpty() ? dataOpt.unwrap() : null;
        const peaksOpt = loader?.peaks;
        const peaks = peaksOpt && !peaksOpt.isEmpty() ? peaksOpt.unwrap() : null;

        // Scan peak data for out-of-range values (>1.0 or <-1.0). PeaksWriter
        // packs min/max as Float16 (range ±65504), so >1.0 values are stored
        // faithfully, but PeaksPainter.renderPixelStrips clamps to the visible
        // [v0, v1] range, producing flat-top "square" waveforms.
        const ranges = peaks
          ? Array.from({ length: peaks.numChannels }, (_, ch) => {
              const channelData = peaks.data[ch];
              let absMin = 0;
              let absMax = 0;
              let overRangeCount = 0;
              const stage = peaks.stages[0];
              const peakCount = stage ? stage.numPeaks : channelData.length;
              for (let p = 0; p < peakCount; p++) {
                const bits = channelData[p];
                const lo = Peaks.unpack(bits, 0);
                const hi = Peaks.unpack(bits, 1);
                if (lo < absMin) absMin = lo;
                if (hi > absMax) absMax = hi;
                if (lo < -1 || hi > 1) overRangeCount++;
              }
              return {
                channel: ch,
                min: absMin,
                max: absMax,
                peakAmplitude: Math.max(Math.abs(absMin), Math.abs(absMax)),
                overRangePeakCount: overRangeCount,
                totalPeaks: peakCount,
                overRangeFraction: peakCount > 0 ? overRangeCount / peakCount : 0,
              };
            })
          : [];

        return {
          tape: i + 1,
          tapeId: tape.id,
          loaderState: loader?.state.type ?? "no-loader",
          dataFrames: data?.numberOfFrames ?? null,
          peakNumFrames: peaks?.numFrames ?? null,
          sampleRate: data?.sampleRate ?? null,
          numChannels: data?.numberOfChannels ?? null,
          ranges,
        };
      });

      const frames = summary
        .map((s) => s.dataFrames)
        .filter((n): n is number => n !== null);
      const minFrames = frames.length > 0 ? Math.min(...frames) : null;
      const maxFrames = frames.length > 0 ? Math.max(...frames) : null;
      const driftFrames =
        minFrames !== null && maxFrames !== null ? maxFrames - minFrames : null;
      const sampleRate = summary[0]?.sampleRate ?? null;
      const driftSeconds =
        driftFrames !== null && sampleRate !== null
          ? driftFrames / sampleRate
          : null;

      console.debug(
        "[recording-finalized] " +
          JSON.stringify({ tapes: summary, driftFrames, driftSeconds })
      );
    }
    prevSessionStateRef.current = session.state;
  }, [session.state]);

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
      // Resume AudioContext if needed
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Request microphone permission if not already granted
      if (!hasPermission) {
        await requestPermission();
      }

      // Delete any previous recording regions before starting a new one
      project.editing.modify(() => {
        for (const region of getAllRegions(project)) {
          if (region.label === "Recording" || region.label.startsWith("Take ")) {
            region.box.delete();
          }
        }
      });

      // Reset peaks state for all tapes
      tapePeaksRef.current.clear();
      session.resetLoaders();

      // Cleanup old painters
      for (const [, painter] of canvasPaintersMap.current) {
        painter.terminate();
      }
      canvasPaintersMap.current.clear();

      project.engine.setPosition(0);
      project.startRecording(useCountIn);
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  }, [project, audioContext, useCountIn, hasPermission, requestPermission, session.resetLoaders]);

  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    // Save user's metronome preference before disabling
    userMetronomePreferenceRef.current = metronomeEnabled ?? false;

    try {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      setMetronomeEnabled(false);

      // Wait for audio to be fully loaded before playing (with timeout)
      const isLoaded = await project.engine.queryLoadingComplete();
      if (!isLoaded) {
        const LOADING_TIMEOUT_MS = 10_000;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Audio loading timed out")),
            LOADING_TIMEOUT_MS
          );
          const checkLoaded = async () => {
            if (await project.engine.queryLoadingComplete()) {
              clearTimeout(timeout);
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
    } catch (error) {
      console.error("Failed to start playback:", error);
      // Restore metronome preference on failure
      setMetronomeEnabled(userMetronomePreferenceRef.current);
    }
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
              Add multiple tapes, each with its own input device, then record all armed tapes simultaneously.
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
                    {armedCount} of {recordingTapes.length} tape{recordingTapes.length !== 1 ? "s" : ""} armed
                  </Badge>
                )}
              </Flex>

              {!hasPermission ? (
                <Flex direction="column" gap="3" align="center">
                  <Text size="2" color="gray">
                    Grant microphone access to see available audio input devices.
                  </Text>
                  <Button onClick={requestPermission} color="blue" size="2" variant="soft">
                    Request Microphone Permission
                  </Button>
                </Flex>
              ) : (
                <Flex direction="column" gap="3">
                  {recordingTapes.length === 0 && (
                    <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                      No recording tapes added. Click "Add Tape" to create one.
                    </Text>
                  )}

                  {recordingTapes.map((tape, index) => (
                    <RecordingTapeCard
                      key={tape.id}
                      tape={tape}
                      tapeIndex={index}
                      project={project}
                      audioInputDevices={audioInputDevices}
                      audioOutputDevices={audioOutputDevices}
                      disabled={isActive}
                      onRemove={removeTape}
                      onArmedChange={handleArmedChange}
                    />
                  ))}

                  <Button
                    onClick={addTape}
                    color="blue"
                    variant="soft"
                    disabled={isActive}
                  >
                    + Add Tape
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
                  ⏺ Record{armedCount > 0 ? ` (${armedCount} tape${armedCount !== 1 ? "s" : ""})` : ""}
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

              {/* Waveform canvases — one per recording tape */}
              {recordingTapes.length > 0 && (
                <Flex direction="column" gap="2" mt="4">
                  {recordingTapes.map((tape, index) => (
                    <Flex
                      key={tape.id}
                      direction="column"
                      gap="1"
                    >
                      <Text size="1" color="gray">Tape {index + 1}</Text>
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

              {/* Show a placeholder canvas when no tapes exist */}
              {recordingTapes.length === 0 && (
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
                    Add a tape to see waveforms here
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
