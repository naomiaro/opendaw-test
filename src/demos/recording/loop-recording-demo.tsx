import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type { SampleLoaderState } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { getAllRegions } from "@/lib/adapterUtils";
import { waitForLoadingComplete } from "@/lib/engineLoading";
import { useEnginePreference } from "@/hooks/useEnginePreference";
import { FINALIZATION_TIMEOUT_MS } from "@/hooks/useRecordingSession";
import { useAudioDevicePermission } from "@/hooks/useAudioDevicePermission";
import { useRecordingTapes } from "@/hooks/useRecordingTapes";
import { useTakeDiscovery } from "./useTakeDiscovery";
import { LoopSetupPanel } from "./LoopSetupPanel";
import { TakesPreferencesPanel } from "./TakesPreferencesPanel";
import type { OlderTakeAction, OlderTakeScope } from "./TakesPreferencesPanel";
import { LoopRecordingReference } from "./LoopRecordingReference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { RecordingTapeCard } from "@/components/RecordingTapeCard";
import { TakeTimeline } from "./TakeTimeline";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Text,
  Button,
  Flex,
  Card,
  Callout,
  Badge,
} from "@radix-ui/themes";

// --- Constants ---

const MAX_TAPES = 4;
const BAR_PPQN = PPQN.Quarter * 4; // one bar in 4/4 time

// Loop progress bar — the width transition is smoothing only, so it is
// dropped (not the bar itself) under prefers-reduced-motion.
const PAGE_STYLES = `
.lr-progress {
  width: 100%;
  height: 6px;
  background: var(--mc-line);
  border-radius: 3px;
  overflow: hidden;
}
.lr-progress-fill {
  height: 100%;
  transition: width 0.05s linear;
}
@media (prefers-reduced-motion: reduce) {
  .lr-progress-fill { transition: none; }
}
`;

// --- Main App ---

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  // Post-init failures (add tape, start recording/playback). The `status`
  // string is only rendered on the pre-init screen, so errors must not go there.
  const [uiError, setUiError] = useState<string | null>(null);
  // Finalization-barrier failures (loader "error" state or 30s timeout).
  const [finalizationError, setFinalizationError] = useState<string | null>(
    null
  );
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);

  // Audio input/output configuration
  const { audioInputDevices, audioOutputDevices, hasPermission, requestPermission } =
    useAudioDevicePermission();
  const { recordingTapes, armedCount, addTape, removeTape, handleArmedChange } =
    useRecordingTapes({
      project,
      audioInputDevices,
      maxTapes: MAX_TAPES,
      onError: (msg) => setUiError(`Add tape failed: ${msg}`),
    });

  // Settings
  const [useCountIn, setUseCountIn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [leadInBars, setLeadInBars] = useState(0);
  const [loopLengthBars, setLoopLengthBars] = useState(2);

  // Takes preferences
  const [allowTakes, setAllowTakes] = useState(true);
  const [olderTakeAction, setOlderTakeAction] =
    useState<OlderTakeAction>("mute-region");
  const [olderTakeScope, setOlderTakeScope] =
    useState<OlderTakeScope>("previous-only");

  // Engine preferences
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(
    project,
    ["metronome", "enabled"]
  );
  // Reactive take discovery (adapter-layer subscriptions while recording)
  const {
    takeIterations,
    setTakeIterations,
    updateTakeMuteInState,
    terminateDiscovery,
    snapshotLoaders,
  } = useTakeDiscovery({
    project,
    audioContext,
    isRecording,
    recordingTapes,
    leadInBars,
  });

  // Finalization subscriptions for cleanup
  const finalizationSubsRef = useRef<Terminable[]>([]);

  // Cleanup finalization subscriptions on unmount
  useEffect(() => {
    return () => {
      for (const sub of finalizationSubsRef.current) {
        sub.terminate();
      }
      finalizationSubsRef.current = [];
    };
  }, []);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;
    let animSub: Terminable | null = null;
    const subs: Terminable[] = [];

    (async () => {
      try {
        const { project: newProject, audioContext: ctx } =
          await initializeOpenDAW({
            onStatusUpdate: setStatus,
          });

        if (!mounted) return;

        setAudioContext(ctx);
        setProject(newProject);
        setStatus("Ready!");

        // Set initial loop area (leadInBars=0, loopLengthBars=2)
        const loopEnd = BAR_PPQN * 2;
        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(loopEnd);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });

        // Enable takes by default
        const settings = newProject.engine.preferences.settings;
        settings.recording.allowTakes = true;
        settings.recording.olderTakeAction = "mute-region";
        settings.recording.olderTakeScope = "previous-only";

        // Subscribe to engine state
        subs.push(
          newProject.engine.isRecording.catchupAndSubscribe((obs) => {
            if (mounted) setIsRecording(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isPlaying.catchupAndSubscribe((obs) => {
            if (mounted) setIsPlaying(obs.getValue());
          })
        );
        subs.push(
          newProject.engine.isCountingIn.catchupAndSubscribe((obs) => {
            if (mounted) setIsCountingIn(obs.getValue());
          })
        );

        animSub = AnimationFrame.add(() => {
          if (mounted)
            setCurrentPosition(newProject.engine.position.getValue());
        });

        // Enable metronome by default for loop recording
        setMetronomeEnabled(true);
      } catch (error) {
        console.error("Init error:", error);
        if (!mounted) return;
        setInitError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      mounted = false;
      animSub?.terminate();
      subs.forEach((s) => s.terminate());
    };
  }, []);

  // Sync BPM to project
  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }, [project, bpm]);

  // Update loop area when leadInBars or loopLengthBars changes
  useEffect(() => {
    if (!project) return;
    const loopFrom = leadInBars * BAR_PPQN;
    const loopTo = loopFrom + loopLengthBars * BAR_PPQN;
    project.editing.modify(() => {
      project.timelineBox.loopArea.from.setValue(loopFrom);
      project.timelineBox.loopArea.to.setValue(loopTo);
    });
  }, [project, leadInBars, loopLengthBars]);

  // Sync takes preferences to engine
  useEffect(() => {
    if (!project) return;
    const settings = project.engine.preferences.settings;
    settings.recording.allowTakes = allowTakes;
    settings.recording.olderTakeAction = olderTakeAction;
    settings.recording.olderTakeScope = olderTakeScope;
  }, [project, allowTakes, olderTakeAction, olderTakeScope]);

  // --- Recording handlers ---

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext || armedCount === 0) return;

    setUiError(null);
    setFinalizationError(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();

      // Safety: request permission if not granted
      if (!hasPermission) {
        await requestPermission();
      }

      // Configure loop area with lead-in
      const loopFrom = leadInBars * BAR_PPQN;
      const loopTo = loopFrom + loopLengthBars * BAR_PPQN;

      project.editing.modify(() => {
        project.timelineBox.loopArea.from.setValue(loopFrom);
        project.timelineBox.loopArea.to.setValue(loopTo);
        project.timelineBox.loopArea.enabled.setValue(true);
      });

      project.engine.setPosition(0);
      project.startRecording(useCountIn);
    } catch (error) {
      console.error("Failed to start recording:", error);
      setUiError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [
    project,
    audioContext,
    useCountIn,
    leadInBars,
    loopLengthBars,
    armedCount,
    hasPermission,
    requestPermission,
  ]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;

    // 1. Terminate pointer hub subs before stopRecording() to prevent late
    //    SDK events from adding stale regions to state
    terminateDiscovery();

    // 2. Stop recording. stop(true) would reset position/processors while
    //    finalization is still in flight — the position reset also triggers
    //    spurious loop-wrap detection that mutes the last take. Reset only
    //    after all loaders reach a terminal state (barrier below).
    project.engine.stopRecording();

    // 3. Cleanup old finalization subscriptions
    for (const sub of finalizationSubsRef.current) {
      sub.terminate();
    }
    finalizationSubsRef.current = [];

    // 4. Snapshot discovered sampleLoaders (the hook copies and clears its set)
    const loaders = snapshotLoaders();

    if (loaders.size > 0) {
      let finalized = 0;
      const total = loaders.size;
      let timedOut = false;

      // Safety timeout: a RecordingWorklet failure produces NO terminal state
      // (the loader stays in "record" forever), so this timeout is the only
      // net that catches it — it must surface to the UI, not just the console.
      const timeout = window.setTimeout(() => {
        if (finalized < total) {
          timedOut = true;
          console.warn(`Finalization timed out (${finalized}/${total} terminal)`);
          setFinalizationError(
            `Finalization timed out after ${FINALIZATION_TIMEOUT_MS / 1000}s — ` +
              "engine reset; the recording may be incomplete"
          );
          for (const sub of finalizationSubsRef.current) sub.terminate();
          finalizationSubsRef.current = [];
          project.engine.stop(true);
        }
      }, FINALIZATION_TIMEOUT_MS);

      // Errored loaders still count toward the barrier so the engine reset
      // always runs; the error is surfaced separately.
      const countTerminal = (state: SampleLoaderState) => {
        if (state.type === "error") {
          setFinalizationError(
            `Recording finalization failed: ${state.reason || "unknown"}`
          );
        }
        finalized++;
        if (finalized === total) {
          clearTimeout(timeout);
          for (const sub of finalizationSubsRef.current) sub.terminate();
          finalizationSubsRef.current = [];
          project.engine.stop(true);
        }
      };

      for (const loader of loaders) {
        // Pre-check: handle already-terminal loaders without subscribing —
        // subscribe() fires synchronously for terminal states.
        const initialState = loader.state;
        if (initialState.type === "loaded" || initialState.type === "error") {
          countTerminal(initialState);
          continue;
        }
        finalizationSubsRef.current.push(
          loader.subscribe((state) => {
            if (timedOut) return;
            if (state.type !== "loaded" && state.type !== "error") return;
            countTerminal(state);
          })
        );
      }
    } else {
      project.engine.stop(true);
    }
  }, [project, terminateDiscovery, snapshotLoaders]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;

    setUiError(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();

      // Wait for audio to load with timeout
      await waitForLoadingComplete(project);

      // Keep loop area enabled so playback loops over takes
      project.editing.modify(() => {
        project.timelineBox.loopArea.enabled.setValue(true);
      });

      project.engine.stop(true);
      project.engine.play();
    } catch (error) {
      console.error("Failed to start playback:", error);
      setUiError(
        `Failed to start playback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  const handleToggleTakeMute = useCallback(
    (takeNumber: number) => {
      if (!project) return;

      const take = takeIterations.find((t) => t.takeNumber === takeNumber);
      if (!take) return;

      // Compute new mute values before the transaction to avoid stale reads
      const newMuteValues = take.regions.map((r) => ({
        regionBox: r.regionBox,
        newMuted: !r.regionBox.mute.getValue(),
      }));

      project.editing.modify(() => {
        for (const { regionBox, newMuted } of newMuteValues) {
          regionBox.mute.setValue(newMuted);
        }
      });

      // Pointer hub mute subscriptions handle this during recording.
      // After recording stops (subscriptions terminated in handleStopRecording), sync state manually.
      if (!isRecording) {
        for (const { regionBox, newMuted } of newMuteValues) {
          updateTakeMuteInState(regionBox, newMuted);
        }
      }
    },
    [project, takeIterations, isRecording, updateTakeMuteInState]
  );

  const handleClearTakes = useCallback(() => {
    if (!project) return;
    project.editing.modify(() => {
      for (const region of getAllRegions(project)) {
        if (region.label.startsWith("Take ")) {
          region.box.delete();
        }
      }
    });
    setTakeIterations([]);
  }, [project, setTakeIterations]);

  // --- Derived values ---

  const takeCount = takeIterations.length;
  const totalBars = leadInBars + loopLengthBars;
  const totalPPQN = totalBars * BAR_PPQN;
  const timeInSeconds = PPQN.pulsesToSeconds(currentPosition, bpm);
  const loopProgress =
    totalPPQN > 0 ? (currentPosition % totalPPQN) / totalPPQN : 0;

  const recordingTapeLabels = useMemo(
    () => recordingTapes.map((t, i) => ({ id: t.id, label: `Tape ${i + 1}` })),
    [recordingTapes]
  );

  // --- Render ---

  return (
    <Theme
      appearance="dark"
      accentColor="amber"
      radius="large"
      style={{ background: "var(--mc-bg)" }}
    >
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex
          direction="column"
          gap="6"
          style={{ maxWidth: 1200, margin: "0 auto" }}
        >
          <div>
            <div className="mc-kicker">Recording — Loop &amp; Takes · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              LOOP RECORDING
            </h1>
            <p className="mc-intro">
              Multi-track loop recording with takes and a pre-loop lead-in. Add
              audio input tapes, configure the lead-in and loop region, then
              record — each time the loop wraps, the SDK creates a new take
              across all armed tapes. Compare and mute takes in the timeline
              below.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Text align="center" color="gray">
              {status}
            </Text>
          ) : (
            <>
              {/* Audio Inputs */}
              <Card>
                <Flex direction="column" gap="4">
                  <Flex justify="between" align="center">
                    <Text size="2" weight="bold" color="gray">
                      Audio Inputs
                    </Text>
                    {hasPermission && (
                      <Badge color="gray" size="1">
                        {armedCount} of {recordingTapes.length} tape
                        {recordingTapes.length !== 1 ? "s" : ""} armed
                      </Badge>
                    )}
                  </Flex>

                  {!hasPermission ? (
                    <Flex direction="column" gap="3" align="center">
                      <Text size="2" color="gray">
                        Grant microphone access to see available audio input
                        devices.
                      </Text>
                      <Button
                        onClick={requestPermission}
                        color="amber"
                        size="2"
                        variant="soft"
                      >
                        Request Microphone Permission
                      </Button>
                    </Flex>
                  ) : (
                    <Flex direction="column" gap="3">
                      {recordingTapes.length === 0 && (
                        <Text
                          size="2"
                          color="gray"
                          style={{ fontStyle: "italic" }}
                        >
                          No recording tapes. Click "Add Tape" to create one.
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
                          disabled={isRecording || isCountingIn}
                          onRemove={removeTape}
                          onArmedChange={handleArmedChange}
                        />
                      ))}

                      <Button
                        onClick={addTape}
                        color="amber"
                        variant="soft"
                        disabled={
                          isRecording ||
                          isCountingIn ||
                          recordingTapes.length >= MAX_TAPES
                        }
                      >
                        + Add Tape{" "}
                        {recordingTapes.length >= MAX_TAPES ? "(max 4)" : ""}
                      </Button>
                    </Flex>
                  )}
                </Flex>
              </Card>

              {/* Setup */}
              <LoopSetupPanel
                bpm={bpm}
                onBpmChange={setBpm}
                leadInBars={leadInBars}
                onLeadInBarsChange={setLeadInBars}
                loopLengthBars={loopLengthBars}
                onLoopLengthBarsChange={setLoopLengthBars}
                useCountIn={useCountIn}
                onUseCountInChange={setUseCountIn}
                metronomeEnabled={metronomeEnabled}
                onMetronomeEnabledChange={setMetronomeEnabled}
                disabled={isRecording}
              />

              {/* Takes Preferences */}
              <TakesPreferencesPanel
                allowTakes={allowTakes}
                onAllowTakesChange={setAllowTakes}
                olderTakeAction={olderTakeAction}
                onOlderTakeActionChange={setOlderTakeAction}
                olderTakeScope={olderTakeScope}
                onOlderTakeScopeChange={setOlderTakeScope}
                disabled={isRecording}
              />

              {/* Transport */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">
                    Transport
                  </Text>

                  <Callout.Root color="amber">
                    <Callout.Text>
                      Press <strong>Record</strong> and perform over the loop.
                      Each time the loop wraps, a new take is created across all
                      armed tapes. Stop recording when satisfied and compare
                      takes below.
                    </Callout.Text>
                  </Callout.Root>

                  <Flex gap="3" wrap="wrap" justify="center">
                    <Button
                      onClick={handleStartRecording}
                      color="red"
                      size="3"
                      variant="solid"
                      disabled={
                        isRecording ||
                        isCountingIn ||
                        isPlaying ||
                        armedCount === 0
                      }
                    >
                      Record
                      {armedCount > 0
                        ? ` (${armedCount} tape${armedCount !== 1 ? "s" : ""})`
                        : ""}
                    </Button>
                    <Button
                      onClick={handlePlay}
                      disabled={
                        isRecording ||
                        isCountingIn ||
                        isPlaying ||
                        takeCount === 0
                      }
                      color="green"
                      size="3"
                      variant="solid"
                    >
                      Play
                    </Button>
                    <Button
                      onClick={isRecording ? handleStopRecording : handleStop}
                      color="gray"
                      size="3"
                      variant="solid"
                    >
                      Stop
                    </Button>
                    <Button
                      onClick={handleClearTakes}
                      color="red"
                      size="1"
                      variant="ghost"
                      disabled={isRecording || takeCount === 0}
                    >
                      Clear All Takes
                    </Button>
                  </Flex>

                  <Flex justify="center" gap="3" align="center">
                    {isRecording && (
                      <Badge color="red" size="2">
                        Recording
                      </Badge>
                    )}
                    {isCountingIn && (
                      <Badge color="amber" size="2">
                        Count-in
                      </Badge>
                    )}
                    {isPlaying && !isRecording && (
                      <Badge color="green" size="2">
                        Playing
                      </Badge>
                    )}
                    <Badge color="gray" size="1">
                      {takeCount} take{takeCount !== 1 ? "s" : ""}
                    </Badge>
                    <Text
                      size="2"
                      style={{
                        fontFamily: "var(--mc-mono)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {timeInSeconds.toFixed(2)}s
                    </Text>
                  </Flex>

                  {finalizationError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{finalizationError}</Callout.Text>
                    </Callout.Root>
                  )}

                  {uiError && (
                    <Callout.Root color="red" role="alert">
                      <Callout.Text>{uiError}</Callout.Text>
                    </Callout.Root>
                  )}

                  {/* Loop progress bar */}
                  {(isRecording || isPlaying) && (
                    <div className="lr-progress">
                      <div
                        className="lr-progress-fill"
                        style={{
                          width: `${loopProgress * 100}%`,
                          background: isRecording
                            ? "var(--red-9)"
                            : "var(--green-9)",
                        }}
                      />
                    </div>
                  )}
                </Flex>
              </Card>

              {/* TakeTimeline */}
              {takeCount > 0 && (
                <TakeTimeline
                  takeIterations={takeIterations}
                  recordingTapeLabels={recordingTapeLabels}
                  currentPosition={currentPosition}
                  leadInBars={leadInBars}
                  loopLengthBars={loopLengthBars}
                  isRecording={isRecording}
                  isPlaying={isPlaying}
                  sampleRate={audioContext?.sampleRate ?? 44100}
                  onToggleMute={handleToggleTakeMute}
                />
              )}

              <LoopRecordingReference />
            </>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
