import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Project } from "@opendaw/studio-core";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { getAllRegions } from "@/lib/adapterUtils";
import { waitForLoadingComplete } from "@/lib/engineLoading";
import { useEnginePreference, CountInBarsValue, MetronomeBeatSubDivisionValue } from "@/hooks/useEnginePreference";
import { useRecordingSession } from "@/hooks/useRecordingSession";
import type { RecordingState } from "@/hooks/useRecordingSession";
import { useAudioDevicePermission } from "@/hooks/useAudioDevicePermission";
import { useRecordingTapes } from "@/hooks/useRecordingTapes";
import { useTapePeaks } from "./useTapePeaks";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { TimeSignatureControl } from "@/components/TimeSignatureControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { RecordingTapeCard } from "@/components/RecordingTapeCard";
import { InputLatencyPanel } from "@/components/InputLatencyPanel";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
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
  const [initError, setInitError] = useState<string | null>(null);
  // Post-init failures (add tape, start recording/playback). The `status`
  // string is only rendered on the pre-init screen, so errors must not go there.
  const [uiError, setUiError] = useState<string | null>(null);
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
  const [inputLatencySec, setInputLatencySec] = useEnginePreference(
    project,
    ["recording", "inputLatency"]
  );

  // Audio devices and recording tapes
  const { audioInputDevices, audioOutputDevices, hasPermission, requestPermission } =
    useAudioDevicePermission();
  const { recordingTapes, armedCount, addTape, removeTape, handleArmedChange } =
    useRecordingTapes({
      project,
      audioInputDevices,
      onError: (msg) => setUiError(`Add tape failed: ${msg}`),
    });

  // Per-tape live waveform monitoring + canvas rendering
  const { getCanvasRef, resetPeaks } = useTapePeaks({
    project,
    audioContext,
    recordingTapes,
    sessionState: session.state,
    registerLoader: session.registerLoader,
  });

  const userMetronomePreferenceRef = useRef<boolean>(false);

  // Derived UI state from session
  const isActive = session.state !== "idle" && session.state !== "ready";
  const canRecord = (session.state === "idle" || session.state === "ready") && armedCount > 0;
  const canPlay = session.state === "ready";
  const canStop = session.state === "recording" || session.state === "counting-in" || session.state === "playing";
  const statusMessage = getStatusMessage(session.state, session.countInBeatsRemaining);

  // Set up timeline loop area when recording finishes (transition to "ready")
  useEffect(() => {
    if (!project || session.state !== "ready") return;

    // Recording regions are always labeled "Take N"
    for (const region of getAllRegions(project)) {
      if (region.label.startsWith("Take ")) {
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
        if (!mounted) return;
        setInitError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Standalone permission button — AudioDevices.requestPermission() THROWS on
  // denial, so a bare onClick={requestPermission} is an unhandled rejection.
  const handleRequestPermission = useCallback(async () => {
    setUiError(null);
    try {
      await requestPermission();
    } catch (error) {
      console.error("Microphone permission denied: " + String(error));
      setUiError(
        "Microphone access was denied — recording needs an input device. " +
          "Allow microphone access in the browser's site settings and try again."
      );
    }
  }, [requestPermission]);

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    setUiError(null);
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
          if (region.label.startsWith("Take ")) {
            region.box.delete();
          }
        }
      });

      // Reset peaks state and painters for all tapes
      resetPeaks();
      session.resetLoaders();
      session.clearError();

      project.engine.setPosition(0);
      project.startRecording(useCountIn);
    } catch (error) {
      console.error("Failed to start recording:", error);
      setUiError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext, useCountIn, hasPermission, requestPermission, resetPeaks, session.resetLoaders, session.clearError]);

  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    setUiError(null);
    // Save user's metronome preference before disabling
    userMetronomePreferenceRef.current = metronomeEnabled ?? false;

    try {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      setMetronomeEnabled(false);

      // Wait for audio to be fully loaded before playing (with timeout)
      await waitForLoadingComplete(project);

      project.engine.stop(true);
      project.engine.play();
    } catch (error) {
      console.error("Failed to start playback:", error);
      setUiError(
        `Failed to start playback: ${error instanceof Error ? error.message : String(error)}`
      );
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

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Recording — Multi-Device · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              RECORDING API
            </h1>
            <p className="mc-intro">
              Multi-device recording with OpenDAW's <code>Recording.start()</code> API.
              Add multiple tapes, each with its own input device, then record all armed
              tapes simultaneously — the SDK handles parallel capture with independent{" "}
              <code>RecordingWorklet</code> instances per device.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <>
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Setup</Text>

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
                    <Text size="2" weight="bold" color="gray">Audio Input</Text>
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
                      <Button onClick={handleRequestPermission} size="2" variant="soft">
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
                        variant="soft"
                        disabled={isActive}
                      >
                        + Add Tape
                      </Button>
                    </Flex>
                  )}
                </Flex>
              </Card>

              {audioContext && (
                <InputLatencyPanel
                  audioContext={audioContext}
                  inputLatencySec={inputLatencySec}
                  onInputLatencySecChange={setInputLatencySec}
                  disabled={isActive}
                />
              )}

              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">Record Audio</Text>

                  <Callout.Root color="amber">
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
                                <Text size="1" color="gray" style={{ width: 45, fontVariantNumeric: "tabular-nums" }}>
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
                      Record{armedCount > 0 ? ` (${armedCount} tape${armedCount !== 1 ? "s" : ""})` : ""}
                    </Button>
                    <Button
                      onClick={handlePlayRecording}
                      disabled={!canPlay}
                      color="green"
                      size="3"
                      variant="solid"
                    >
                      Play
                    </Button>
                    <Button onClick={handleStop} disabled={!canStop} color="gray" size="3" variant="solid">
                      Stop
                    </Button>
                  </Flex>
                  <Text size="2" align="center" color="gray">
                    {statusMessage}
                  </Text>

                  {session.error && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{session.error}</Callout.Text>
                    </Callout.Root>
                  )}

                  {uiError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{uiError}</Callout.Text>
                    </Callout.Root>
                  )}

                  {/* Waveform canvases — one per recording tape */}
                  {recordingTapes.length > 0 && (
                    <Flex direction="column" gap="3" mt="4">
                      {recordingTapes.map((tape, index) => (
                        <Flex key={tape.id} direction="column" gap="2">
                          <span className="mc-lattice-label" style={{ color: "var(--mc-label)" }}>
                            Tape {index + 1}
                          </span>
                          <canvas
                            ref={getCanvasRef(index)}
                            style={{
                              width: "100%",
                              height: "120px",
                              display: "block",
                              boxSizing: "border-box",
                              borderRadius: "4px",
                              border: "1px solid var(--mc-line)",
                              background: "var(--mc-bg)"
                            }}
                          />
                        </Flex>
                      ))}
                    </Flex>
                  )}

                  {/* Show a placeholder when no tapes exist */}
                  {recordingTapes.length === 0 && (
                    <Flex
                      justify="center"
                      align="center"
                      mt="4"
                      style={{
                        background: "var(--mc-bg)",
                        borderRadius: "4px",
                        border: "1px solid var(--mc-line)"
                      }}
                    >
                      <Text size="2" color="gray" style={{ padding: "48px 0" }}>
                        Add a tape to see waveforms here
                      </Text>
                    </Flex>
                  )}
                </Flex>
              </Card>
            </>
          )}
        </Flex>
        <MoisesLogo />
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
