import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import type { Terminable } from "@opendaw/lib-std";
import { Project, AudioDevices, CaptureAudio } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { AnimationFrame } from "@opendaw/lib-dom";
import { PPQN } from "@opendaw/lib-dsp";
import { AudioRegionBox, AudioUnitBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { enumerateOutputDevices } from "@/lib/audioUtils";
import { useEnginePreference } from "@/hooks/useEnginePreference";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { BpmControl } from "@/components/BpmControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";
import { RecordingTrackCard } from "@/components/RecordingTrackCard";
import { TakeTimeline } from "@/components/TakeTimeline";
import type { TakeRegion, TakeIteration } from "@/components/TakeTimeline";
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
  Select,
  Callout,
  Separator,
  Badge,
  Code,
} from "@radix-ui/themes";

// --- Types ---

interface RecordingInputTrack {
  id: string; // UUID.toString(audioUnitBox.address.uuid)
  capture: CaptureAudio;
  audioUnitBox: AudioUnitBox;
  label: string;
}

// --- Constants ---

const MAX_TRACKS = 4;
const BAR_PPQN = PPQN.Quarter * 4; // one bar in 4/4 time

const codeStyle = {
  display: "block" as const,
  whiteSpace: "pre" as const,
  padding: 12,
  overflowX: "auto" as const,
};

// --- Main App ---

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);

  // Takes
  const [takeIterations, setTakeIterations] = useState<TakeIteration[]>([]);

  // Audio input/output configuration
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    []
  );
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>(
    []
  );
  const [hasPermission, setHasPermission] = useState(false);
  const [recordingTracks, setRecordingTracks] = useState<
    RecordingInputTrack[]
  >([]);
  const [armedCount, setArmedCount] = useState(0);

  // Settings
  const [useCountIn, setUseCountIn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [leadInBars, setLeadInBars] = useState(0);
  const [loopLengthBars, setLoopLengthBars] = useState(2);

  // Takes preferences
  const [allowTakes, setAllowTakes] = useState(true);
  const [olderTakeAction, setOlderTakeAction] = useState<
    "mute-region" | "disable-track"
  >("mute-region");
  const [olderTakeScope, setOlderTakeScope] = useState<
    "all" | "previous-only"
  >("previous-only");

  // Engine preferences
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(
    project,
    ["metronome", "enabled"]
  );
  const [countInBars, setCountInBars] = useEnginePreference(project, [
    "recording",
    "countInBars",
  ]);

  // Finalization subscriptions for cleanup
  const finalizationSubsRef = useRef<Terminable[]>([]);
  // Pointer hub subscriptions for reactive take discovery
  const pointerHubSubsRef = useRef<Terminable[]>([]);
  // SampleLoaders discovered during recording — ref avoids stale closure in handleStopRecording
  const sampleLoadersRef = useRef<Set<SampleLoader>>(new Set());
  // Ref for recordingTracks to avoid restarting pointerHub subscriptions when tracks change
  const recordingTracksRef = useRef<RecordingInputTrack[]>([]);

  // Cleanup subscriptions on unmount (but NOT sampleLoadersRef — handleStopRecording owns that)
  useEffect(() => {
    return () => {
      for (const sub of pointerHubSubsRef.current) {
        sub.terminate();
      }
      pointerHubSubsRef.current = [];
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
        if (mounted) setStatus(`Error: ${error}`);
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

  // Keep recordingTracks ref in sync with state
  useEffect(() => {
    recordingTracksRef.current = recordingTracks;
  }, [recordingTracks]);

  // --- Reactive take discovery via pointerHub subscriptions ---

  // Build a TakeRegion from a regionBox, resolving its sample loader, track assignment, and waveform offset
  const buildTakeRegion = useCallback(
    (regionBox: AudioRegionBox): TakeRegion | null => {
      if (!audioContext || !project) return null;

      const label = regionBox.label.getValue();
      if (!label.startsWith("Take ")) return null;

      const takeNumber = parseInt(label.replace("Take ", ""), 10);
      if (isNaN(takeNumber)) return null;
      const isMuted = regionBox.mute.getValue();
      const sampleRate = audioContext.sampleRate;
      const waveformOffsetSec = regionBox.waveformOffset.getValue();
      const waveformOffsetFrames = Math.round(waveformOffsetSec * sampleRate);
      const durationSec = regionBox.duration.getValue();
      const durationFrames = Math.round(durationSec * sampleRate);

      // Resolve sample loader
      let loader: SampleLoader | null = null;
      const fileVertex = regionBox.file.targetVertex;
      if (!fileVertex.isEmpty()) {
        loader = project.sampleManager.getOrCreate(
          fileVertex.unwrap().address.uuid
        );
      }

      // Match region to input track: regionBox → TrackBox → AudioUnitBox
      let inputTrackId = "";
      const trackVertex = regionBox.regions.targetVertex;
      if (!trackVertex.isEmpty()) {
        const trackBox = trackVertex.unwrap().box;
        const audioUnitVertex = (trackBox as any).tracks?.targetVertex;
        if (audioUnitVertex && !audioUnitVertex.isEmpty()) {
          inputTrackId = UUID.toString(
            audioUnitVertex.unwrap().box.address.uuid
          );
        }
      }

      // Fallback for single track (read from ref to avoid dep on recordingTracks)
      const tracks = recordingTracksRef.current;
      if (!inputTrackId && tracks.length === 1) {
        inputTrackId = tracks[0].id;
      }

      return {
        regionBox,
        inputTrackId,
        takeNumber,
        isMuted,
        sampleLoader: loader,
        waveformOffsetFrames,
        durationFrames,
      };
    },
    [project, audioContext]
  );

  // Insert a TakeRegion into takeIterations state incrementally
  const addTakeRegionToState = useCallback(
    (region: TakeRegion) => {
      setTakeIterations((prev) => {
        const existing = prev.find((t) => t.takeNumber === region.takeNumber);
        if (existing) {
          // Skip if this exact regionBox is already tracked (prevents duplicates on re-subscribe)
          if (existing.regions.some((r) => r.regionBox === region.regionBox)) {
            return prev;
          }
          // Add region to existing take (multi-track: same take, different track)
          const updatedRegions = [...existing.regions, region];
          return prev.map((t) =>
            t.takeNumber === region.takeNumber
              ? {
                  ...t,
                  regions: updatedRegions,
                  isMuted: updatedRegions.every((r) => r.isMuted),
                }
              : t
          );
        }
        // New take iteration
        const newIteration: TakeIteration = {
          takeNumber: region.takeNumber,
          isLeadIn: region.takeNumber === 1 && leadInBars > 0,
          regions: [region],
          isMuted: region.isMuted,
        };
        return [...prev, newIteration].sort(
          (a, b) => a.takeNumber - b.takeNumber
        );
      });
    },
    [leadInBars]
  );

  // Update mute state in takeIterations reactively
  const updateTakeMuteInState = useCallback(
    (regionBox: AudioRegionBox, isMuted: boolean) => {
      setTakeIterations((prev) =>
        prev.map((t) => {
          if (!t.regions.some((r) => r.regionBox === regionBox)) return t;
          const updatedRegions = t.regions.map((r) =>
            r.regionBox === regionBox ? { ...r, isMuted } : r
          );
          return {
            ...t,
            regions: updatedRegions,
            isMuted: updatedRegions.every((r) => r.isMuted),
          };
        })
      );
    },
    []
  );

  // Set up pointerHub subscriptions when recording starts
  useEffect(() => {
    if (!project || !isRecording || recordingTracks.length === 0) return;

    const subs: Terminable[] = [];

    for (const track of recordingTracks) {
      const trackSub =
        track.audioUnitBox.tracks.pointerHub.catchupAndSubscribe({
          onAdded: (pointer) => {
            const trackBox = pointer.box;
            const regionSub = (
              trackBox as any
            ).regions.pointerHub.catchupAndSubscribe({
              onAdded: (regionPointer: any) => {
                const regionBox = regionPointer.box as AudioRegionBox;
                const takeRegion = buildTakeRegion(regionBox);
                if (!takeRegion) return;

                addTakeRegionToState(takeRegion);

                // Track sampleLoader in ref for finalization barrier
                if (takeRegion.sampleLoader) {
                  sampleLoadersRef.current.add(takeRegion.sampleLoader);
                }

                // Subscribe to mute changes for reactive UI updates
                const muteSub = regionBox.mute.subscribe((obs: any) => {
                  updateTakeMuteInState(regionBox, obs.getValue());
                });
                subs.push(muteSub);
              },
              onRemoved: () => {},
            });
            subs.push(regionSub);
          },
          onRemoved: () => {},
        });
      subs.push(trackSub);
    }

    pointerHubSubsRef.current = subs;

    return () => {
      for (const sub of subs) {
        sub.terminate();
      }
      pointerHubSubsRef.current = [];
      // Do NOT clear sampleLoadersRef here — handleStopRecording owns its lifecycle
      // and may still be using the Set reference for the finalization barrier.
    };
  }, [
    project,
    isRecording,
    recordingTracks,
    buildTakeRegion,
    addTakeRegionToState,
    updateTakeMuteInState,
  ]);

  // --- Audio input management ---

  const handleRequestPermission = useCallback(async () => {
    try {
      await AudioDevices.requestPermission();
      await AudioDevices.updateInputList();
      setAudioInputDevices([...AudioDevices.inputs]);

      setAudioOutputDevices(await enumerateOutputDevices());

      setHasPermission(true);
    } catch (error) {
      console.error("Failed to get audio devices:", error);
      setStatus("Microphone permission denied. Please allow access and try again.");
    }
  }, []);

  const handleArmedChange = useCallback(() => {
    setArmedCount(
      recordingTracks.filter((t) => t.capture.armed.getValue()).length
    );
  }, [recordingTracks]);

  const handleAddTrack = useCallback(() => {
    if (!project || recordingTracks.length >= MAX_TRACKS) return;

    let audioUnitBoxRef: AudioUnitBox | null = null;

    // Create instrument in its own transaction (pointer re-routing guideline)
    project.editing.modify(() => {
      const { audioUnitBox } = project.api.createInstrument(
        InstrumentFactories.Tape
      );
      audioUnitBoxRef = audioUnitBox;
    });

    if (!audioUnitBoxRef) return;

    const captureOpt = project.captureDevices.get(
      (audioUnitBoxRef as AudioUnitBox).address.uuid
    );
    if (captureOpt.isEmpty()) return;
    const capture = captureOpt.unwrap();
    if (!(capture instanceof CaptureAudio)) return;

    // Initialize capture settings in separate transaction after creation commits
    if (audioInputDevices.length > 0) {
      project.editing.modify(() => {
        capture.captureBox.deviceId.setValue(audioInputDevices[0].deviceId);
        capture.requestChannels = 1;
      });
    }

    // Arm non-exclusively so other tracks stay armed
    project.captureDevices.setArm(capture, false);

    const trackLabel = `Track ${recordingTracks.length + 1}`;
    setRecordingTracks((prev) => [
      ...prev,
      {
        id: UUID.toString((audioUnitBoxRef as AudioUnitBox).address.uuid),
        capture,
        audioUnitBox: audioUnitBoxRef as AudioUnitBox,
        label: trackLabel,
      },
    ]);
  }, [project, audioInputDevices, recordingTracks.length]);

  const handleRemoveTrack = useCallback(
    (id: string) => {
      const track = recordingTracks.find((t) => t.id === id);
      if (track) {
        track.capture.armed.setValue(false);
      }
      const next = recordingTracks.filter((t) => t.id !== id);
      setRecordingTracks(next);
      setArmedCount(next.filter((t) => t.capture.armed.getValue()).length);
    },
    [recordingTracks]
  );

  // --- Recording handlers ---

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext || armedCount === 0) return;
    if (audioContext.state === "suspended") await audioContext.resume();

    // Safety: request permission if not granted
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
        console.error("Mic error:", error);
        setStatus("Microphone permission denied. Cannot start recording.");
        return;
      }
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
  }, [
    project,
    audioContext,
    useCountIn,
    leadInBars,
    loopLengthBars,
    armedCount,
    hasPermission,
  ]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;

    // 1. Terminate pointer hub subs before stopRecording() to prevent late
    //    SDK events from adding stale regions to state
    for (const sub of pointerHubSubsRef.current) {
      sub.terminate();
    }
    pointerHubSubsRef.current = [];

    // 2. Stop recording (NOT stop(true) which kills the audio graph)
    project.engine.stopRecording();

    // 3. Cleanup old finalization subscriptions
    for (const sub of finalizationSubsRef.current) {
      sub.terminate();
    }
    finalizationSubsRef.current = [];

    // 4. Snapshot sampleLoaders from ref (copy to avoid race with useEffect cleanup)
    const loaders = new Set(sampleLoadersRef.current);
    sampleLoadersRef.current = new Set();

    if (loaders.size > 0) {
      let finalized = 0;
      const total = loaders.size;
      let timedOut = false;

      // Safety timeout: if loaders haven't emitted "loaded" within 10s, give up and reset
      const timeout = window.setTimeout(() => {
        if (finalized < total) {
          timedOut = true;
          console.warn(`Finalization timed out (${finalized}/${total} loaded)`);
          setStatus(`Warning: Recording finalization timed out. Some audio may be incomplete.`);
          for (const sub of finalizationSubsRef.current) sub.terminate();
          finalizationSubsRef.current = [];
          project.engine.stop(true);
        }
      }, 10_000);

      for (const loader of loaders) {
        finalizationSubsRef.current.push(
          loader.subscribe((state) => {
            if (timedOut) return;
            if (state.type === "loaded") {
              finalized++;
              if (finalized === total) {
                clearTimeout(timeout);
                for (const sub of finalizationSubsRef.current) sub.terminate();
                finalizationSubsRef.current = [];
                project.engine.stop(true);
              }
            }
          })
        );
      }
    } else {
      project.engine.stop(true);
    }
  }, [project]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();
    await project.engine.queryLoadingComplete();

    // Keep loop area enabled so playback loops over takes
    project.editing.modify(() => {
      project.timelineBox.loopArea.enabled.setValue(true);
    });

    project.engine.stop(true);
    project.engine.play();
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
      for (const box of project.boxGraph.boxes()) {
        if (box.name !== "AudioRegionBox") continue;
        const regionBox = box as AudioRegionBox;
        if (regionBox.label.getValue().startsWith("Take ")) {
          regionBox.delete();
        }
      }
    });
    setTakeIterations([]);
  }, [project]);

  // --- Derived values ---

  const takeCount = takeIterations.length;
  const totalBars = leadInBars + loopLengthBars;
  const totalPPQN = totalBars * BAR_PPQN;
  const timeInSeconds = PPQN.pulsesToSeconds(currentPosition, bpm);
  const loopProgress =
    totalPPQN > 0 ? (currentPosition % totalPPQN) / totalPPQN : 0;

  const recordingTrackLabels = useMemo(
    () => recordingTracks.map((t) => ({ id: t.id, label: t.label })),
    [recordingTracks]
  );

  // --- Render ---

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="amber" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">Loop Recording & Takes</Heading>
            <Text size="3" color="gray">
              {status}
            </Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="amber" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex
          direction="column"
          gap="6"
          style={{ maxWidth: 1200, margin: "0 auto" }}
        >
          <BackLink />

          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Loop Recording & Takes</Heading>
            <Text size="3" color="gray">
              Multi-track loop recording with pre-loop lead-in and timeline
              comping
            </Text>
          </Flex>

          <Callout.Root color="amber">
            <Callout.Text>
              This demo shows <strong>loop recording with takes</strong>,{" "}
              <strong>multi-track input</strong>, and{" "}
              <strong>pre-loop lead-in</strong> recording. Add audio input
              tracks, configure the lead-in and loop region, then record. Each
              loop iteration creates takes across all armed tracks. Compare
              takes in the timeline below.
            </Callout.Text>
          </Callout.Root>

          {/* Audio Inputs */}
          <Card>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Heading size="5">Audio Inputs</Heading>
                {hasPermission && (
                  <Badge color="gray" size="1">
                    {armedCount} of {recordingTracks.length} track
                    {recordingTracks.length !== 1 ? "s" : ""} armed
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
                    onClick={handleRequestPermission}
                    color="amber"
                    size="2"
                    variant="soft"
                  >
                    Request Microphone Permission
                  </Button>
                </Flex>
              ) : (
                <Flex direction="column" gap="3">
                  {recordingTracks.length === 0 && (
                    <Text
                      size="2"
                      color="gray"
                      style={{ fontStyle: "italic" }}
                    >
                      No recording tracks. Click "Add Track" to create one.
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
                    color="amber"
                    variant="soft"
                    disabled={
                      isRecording ||
                      isCountingIn ||
                      recordingTracks.length >= MAX_TRACKS
                    }
                  >
                    + Add Track{" "}
                    {recordingTracks.length >= MAX_TRACKS ? "(max 4)" : ""}
                  </Button>
                </Flex>
              )}
            </Flex>
          </Card>

          {/* Setup */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Setup</Heading>
              <Flex gap="4" wrap="wrap" align="center">
                <BpmControl
                  value={bpm}
                  onChange={setBpm}
                  disabled={isRecording}
                />
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Lead-in:
                  </Text>
                  <Select.Root
                    value={leadInBars.toString()}
                    onValueChange={(v) => setLeadInBars(Number(v))}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 100 }} />
                    <Select.Content>
                      <Select.Item value="0">None</Select.Item>
                      <Select.Item value="1">1 bar</Select.Item>
                      <Select.Item value="2">2 bars</Select.Item>
                      <Select.Item value="3">3 bars</Select.Item>
                      <Select.Item value="4">4 bars</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Loop Length:
                  </Text>
                  <Select.Root
                    value={loopLengthBars.toString()}
                    onValueChange={(v) => setLoopLengthBars(Number(v))}
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 100 }} />
                    <Select.Content>
                      <Select.Item value="1">1 bar</Select.Item>
                      <Select.Item value="2">2 bars</Select.Item>
                      <Select.Item value="4">4 bars</Select.Item>
                      <Select.Item value="8">8 bars</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <RecordingPreferences
                  useCountIn={useCountIn}
                  onUseCountInChange={setUseCountIn}
                  metronomeEnabled={metronomeEnabled}
                  onMetronomeEnabledChange={setMetronomeEnabled}
                />
              </Flex>
              {leadInBars > 0 && (
                <Text size="1" color="gray">
                  Take 1 records from bar 1 through bar {totalBars} (
                  {leadInBars} bar lead-in + {loopLengthBars} bar loop).
                  Subsequent takes record only the {loopLengthBars}-bar loop
                  region.
                </Text>
              )}
            </Flex>
          </Card>

          {/* Takes Preferences */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Takes Preferences</Heading>
              <Flex gap="4" wrap="wrap" align="center">
                <Flex asChild align="center" gap="2">
                  <Text as="label" size="2">
                    <Checkbox
                      checked={allowTakes}
                      onCheckedChange={(c) => setAllowTakes(c === true)}
                      disabled={isRecording}
                    />
                    Allow takes (loop recording)
                  </Text>
                </Flex>
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Older Take Action:
                  </Text>
                  <Select.Root
                    value={olderTakeAction}
                    onValueChange={(v) =>
                      setOlderTakeAction(
                        v as "mute-region" | "disable-track"
                      )
                    }
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 150 }} />
                    <Select.Content>
                      <Select.Item value="mute-region">
                        Mute Region
                      </Select.Item>
                      <Select.Item value="disable-track">
                        Disable Track
                      </Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <Flex align="center" gap="2">
                  <Text size="2" weight="medium">
                    Scope:
                  </Text>
                  <Select.Root
                    value={olderTakeScope}
                    onValueChange={(v) =>
                      setOlderTakeScope(v as "all" | "previous-only")
                    }
                    disabled={isRecording}
                  >
                    <Select.Trigger style={{ width: 150 }} />
                    <Select.Content>
                      <Select.Item value="previous-only">
                        Previous Only
                      </Select.Item>
                      <Select.Item value="all">All Previous</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>
              </Flex>
              <Text size="1" color="gray">
                {olderTakeScope === "previous-only"
                  ? "Only the most recent take is affected when a new take is recorded. Use this for layering — unmute an older take and it stays audible through subsequent recordings."
                  : "All older takes are affected each time a new take is recorded. Use this for comping — keeps a clean slate so you only hear the latest take."}
              </Text>
            </Flex>
          </Card>

          {/* Transport */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5">Transport</Heading>

              <Callout.Root color="orange">
                <Callout.Text>
                  Press <strong>Record</strong> and perform over the loop. Each
                  time the loop wraps, a new take is created across all armed
                  tracks. Stop recording when satisfied and compare takes below.
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
                    ? ` (${armedCount} track${armedCount !== 1 ? "s" : ""})`
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
                <Badge color="blue" size="1">
                  {takeCount} take{takeCount !== 1 ? "s" : ""}
                </Badge>
                <Text size="2" style={{ fontFamily: "monospace" }}>
                  {timeInSeconds.toFixed(2)}s
                </Text>
              </Flex>

              {/* Loop progress bar */}
              {(isRecording || isPlaying) && (
                <div
                  style={{
                    width: "100%",
                    height: 6,
                    background: "var(--gray-4)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${loopProgress * 100}%`,
                      height: "100%",
                      background: isRecording
                        ? "var(--red-9)"
                        : "var(--green-9)",
                      transition: "width 0.05s linear",
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
              recordingTrackLabels={recordingTrackLabels}
              currentPosition={currentPosition}
              leadInBars={leadInBars}
              loopLengthBars={loopLengthBars}
              isRecording={isRecording}
              isPlaying={isPlaying}
              sampleRate={audioContext?.sampleRate ?? 44100}
              onToggleMute={handleToggleTakeMute}
            />
          )}

          {/* API Reference */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">API Reference</Heading>
              <Separator size="4" />

              <Text size="2" weight="bold">
                Pre-Loop Lead-In Recording:
              </Text>
              <Code size="2" style={codeStyle}>
                {`// Set loop area with lead-in
const barPPQN = PPQN.Quarter * 4;
const loopFrom = leadInBars * barPPQN;
const loopTo = loopFrom + loopLengthBars * barPPQN;

project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(loopFrom);
  project.timelineBox.loopArea.to.setValue(loopTo);
  project.timelineBox.loopArea.enabled.setValue(true);
});

// Start at position 0 — Take 1 includes lead-in
project.engine.setPosition(0);
project.startRecording(useCountIn);`}
              </Code>

              <Text size="2" weight="bold" style={{ marginTop: 8 }}>
                Multi-Track Loop Recording:
              </Text>
              <Code size="2" style={codeStyle}>
                {`// Create and arm multiple tracks
const { audioUnitBox } = project.api
  .createInstrument(InstrumentFactories.Tape);
const capture = project.captureDevices
  .get(audioUnitBox.address.uuid).unwrap();

// Arm non-exclusively (keeps other tracks armed)
project.captureDevices.setArm(capture, false);

// startRecording() records ALL armed captures
project.startRecording(useCountIn);

// Multi-track finalization barrier
const loaders = new Set<SampleLoader>();
// ... collect loaders from take regions ...
let finalized = 0;
for (const loader of loaders) {
  loader.subscribe(state => {
    if (state.type === "loaded") {
      if (++finalized === loaders.size) {
        project.engine.stop(true);
      }
    }
  });
}`}
              </Code>

              <Text size="2" weight="bold" style={{ marginTop: 8 }}>
                Takes Preferences:
              </Text>
              <Code size="2" style={codeStyle}>
                {`const settings = project.engine.preferences.settings;
settings.recording.allowTakes = true;
settings.recording.olderTakeAction = "mute-region";
settings.recording.olderTakeScope = "previous-only";`}
              </Code>
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
