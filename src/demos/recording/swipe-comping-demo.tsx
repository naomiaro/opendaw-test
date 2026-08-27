import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Terminable } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type { SampleLoaderState, AudioRegionBoxAdapter } from "@opendaw/studio-adapters";
import { AudioUnitBoxAdapter, TrackBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";
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
import { SwipeCompLanes, LANE_COLORS, type SwipeTakeLane } from "./SwipeCompLanes";
import {
  assignRange,
  assignZoneAt,
  moveBoundary,
  splitRange,
  nudgeZone,
  compSpans,
  takeExtentPpqn,
  ensureCompTrack,
  rebuildCompRegions,
  deriveCompStateFromCompTrack,
  type CompState,
  type RecordedTakeSource,
} from "@/lib/compLaneUtils";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
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
  Select,
} from "@radix-ui/themes";

const BAR_PPQN = PPQN.Quarter * 4; // one bar in 4/4

type SnapGrid = "off" | "1/4" | "1/8" | "1/16";
const SNAP_PPQN: Record<SnapGrid, number> = {
  off: 0,
  "1/4": PPQN.Quarter,
  "1/8": PPQN.Quarter / 2,
  "1/16": PPQN.Quarter / 4,
};

const PAGE_STYLES = `
.scl-lanes { transition: max-height 160ms ease; }
.scl-disclosure { display: inline-block; transition: transform 160ms ease; }
@media (prefers-reduced-motion: reduce) {
  .scl-lanes, .scl-disclosure { transition: none; }
}
`;

/** A comp lane + its box-graph source, derived from one take region. */
interface CompLaneData {
  lane: SwipeTakeLane;
  source: RecordedTakeSource;
}

/** Scan the Tape's take regions in chronological order (track index, then
 *  region position). Labels are re-derived from scan order so takes from a
 *  second recording session (whose SDK take numbers restart at 1) still get
 *  unique lane labels. */
function scanCompLanes(
  project: Project,
  audioUnitBox: AudioUnitBox,
  sampleRate: number
): CompLaneData[] {
  const unitAdapter = project.boxAdapters.adapterFor(
    audioUnitBox,
    AudioUnitBoxAdapter
  );
  const tracks = [...unitAdapter.tracks.values()].sort(
    (a, b) => a.box.index.getValue() - b.box.index.getValue()
  );
  const lanes: CompLaneData[] = [];
  for (const track of tracks) {
    const regions = track.regions.adapters
      .values()
      .filter((r): r is AudioRegionBoxAdapter => r.isAudioRegion())
      .filter((r) => r.label.startsWith("Take "));
    for (const regionAdapter of regions) {
      const fileOpt = regionAdapter.optFile;
      if (fileOpt.isEmpty()) continue;
      const fileAdapter = fileOpt.unwrap();
      const index = lanes.length;
      const waveformOffsetSec = regionAdapter.waveformOffset.getValue();
      lanes.push({
        lane: {
          regionBox: regionAdapter.box,
          label: `Take ${index + 1}`,
          color: LANE_COLORS[index % LANE_COLORS.length],
          sampleLoader: fileAdapter.getOrCreateLoader(),
          waveformOffsetFrames: Math.round(waveformOffsetSec * sampleRate),
          durationSec: regionAdapter.box.duration.getValue(),
        },
        source: {
          regionBox: regionAdapter.box,
          audioFileBox: fileAdapter.box,
          waveformOffsetSec,
          durationSec: regionAdapter.box.duration.getValue(),
        },
      });
    }
  }
  return lanes;
}

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [initError, setInitError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [finalizationError, setFinalizationError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const [useCountIn, setUseCountIn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [loopLengthBars, setLoopLengthBars] = useState(4);
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(project, [
    "metronome",
    "enabled",
  ]);

  // Comp state
  const [compLanes, setCompLanes] = useState<CompLaneData[]>([]);
  const [compState, setCompState] = useState<CompState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [auditionTake, setAuditionTake] = useState<number | null>(null);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [snapGrid, setSnapGrid] = useState<SnapGrid>("off");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const compTrackRef = useRef<TrackBox | null>(null);
  const compLanesRef = useRef<CompLaneData[]>([]);
  const isRebuildingRef = useRef(false);
  // Set when compState was just derived FROM the box graph (undo/redo) — the
  // graph already holds those regions, so the next rebuild must be skipped
  // (rebuilding would add a redundant undo entry and kill the redo stack).
  const skipNextRebuildRef = useRef(false);
  const tapeCreatedRef = useRef(false);
  const finalizationSubsRef = useRef<Terminable[]>([]);
  compLanesRef.current = compLanes;

  const { audioInputDevices, audioOutputDevices, hasPermission, requestPermission } =
    useAudioDevicePermission();
  void audioOutputDevices;
  const { recordingTapes, addTape } = useRecordingTapes({
    project,
    audioInputDevices,
    maxTapes: 1,
    onError: (msg) => setUiError(`Tape setup failed: ${msg}`),
  });

  const { takeIterations, setTakeIterations, terminateDiscovery, snapshotLoaders } =
    useTakeDiscovery({
      project,
      audioContext,
      isRecording,
      recordingTapes,
      leadInBars: 0,
    });

  const loopPpqn = loopLengthBars * BAR_PPQN;
  const tapeUnitBox = recordingTapes[0]?.capture.audioUnitBox ?? null;
  const hasComp = compState !== null && compLanes.length > 0;
  const takeCount = takeIterations.length;

  // ── Init ──
  useEffect(() => {
    let mounted = true;
    const subs: Terminable[] = [];
    (async () => {
      try {
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
        });
        if (!mounted) return;
        setAudioContext(ctx);
        setProject(newProject);
        setStatus("Ready!");

        newProject.editing.modify(() => {
          newProject.timelineBox.loopArea.from.setValue(0);
          newProject.timelineBox.loopArea.to.setValue(BAR_PPQN * 4);
          newProject.timelineBox.loopArea.enabled.setValue(true);
        });

        const settings = newProject.engine.preferences.settings;
        settings.recording.allowTakes = true;
        settings.recording.olderTakeAction = "mute-region";
        settings.recording.olderTakeScope = "all";

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
        setMetronomeEnabled(true);
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted)
          setInitError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      mounted = false;
      subs.forEach((s) => s.terminate());
      finalizationSubsRef.current.forEach((s) => s.terminate());
      finalizationSubsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-create the single tape once permission + devices are ready ──
  useEffect(() => {
    if (!project || !hasPermission || audioInputDevices.length === 0) return;
    if (tapeCreatedRef.current || recordingTapes.length > 0) return;
    tapeCreatedRef.current = true;
    addTape();
  }, [project, hasPermission, audioInputDevices, recordingTapes.length, addTape]);

  // ── Sync BPM / loop area ──
  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }, [project, bpm]);

  useEffect(() => {
    if (!project) return;
    project.editing.modify(() => {
      project.timelineBox.loopArea.from.setValue(0);
      project.timelineBox.loopArea.to.setValue(loopPpqn);
      project.timelineBox.loopArea.enabled.setValue(true);
    });
  }, [project, loopPpqn]);

  // ── Comp initialization (runs after the finalization barrier) ──
  // The barrier resolves as soon as every sampleLoader reaches "loaded" —
  // but the box-graph AudioRegionBox for the just-finalized take syncs to
  // the main-thread adapter layer via the engine's own message channel,
  // which can lag the loader's "loaded" event by a frame or more. Scanning
  // immediately can observe 0 lanes even though the take truly finalized.
  // Poll across animation frames (bounded) instead of trusting the first scan.
  const initializeComp = useCallback(() => {
    if (!project || !audioContext || !tapeUnitBox) return;
    let attempt = 0;
    const MAX_ATTEMPTS = 90; // ~1.5s at 60fps — generous margin over the observed 1-frame lag
    const tryScan = () => {
      const lanes = scanCompLanes(project, tapeUnitBox, audioContext.sampleRate);
      if (lanes.length === 0) {
        attempt++;
        if (attempt < MAX_ATTEMPTS) {
          requestAnimationFrame(tryScan);
        } else {
          console.error(
            "[SwipeComping] initializeComp: scanCompLanes still returned 0 lanes " +
              `after ${MAX_ATTEMPTS} frames — giving up`
          );
          setUiError("Couldn't find the recorded takes to build the comp. Try Clear All and record again.");
        }
        return;
      }
      const compTrack = ensureCompTrack(project, tapeUnitBox);
      compTrackRef.current = compTrack;
      // Keep an existing comp; default a new one to the LAST take (Logic's default).
      const existing = deriveCompStateFromCompTrack(project, compTrack);
      const state: CompState =
        existing ?? { boundaries: [], assignments: [lanes.length - 1] };
      // No inline rebuild here — setting state triggers the rebuild effect
      // exactly once (an inline rebuild + the effect would double-rebuild and
      // create two undo entries). The rebuild also re-unmutes a comp that was
      // muted for a "record more takes" pass.
      setCompLanes(lanes);
      setCompState({ ...state });
      setAuditionTake(null);
      setSelectedZone(null);
      setCollapsed(false);
    };
    tryScan();
  }, [project, audioContext, tapeUnitBox]);

  // ── Undo/redo tracking + comp-state re-derivation after undo/redo ──
  useEffect(() => {
    if (!project) return undefined;
    const updateUndoRedo = () => {
      setCanUndo(project.editing.canUndo());
      setCanRedo(project.editing.canRedo());
    };
    updateUndoRedo();
    const sub = project.editing.subscribe(() => {
      updateUndoRedo();
      if (isRebuildingRef.current) return;
      const compTrack = compTrackRef.current;
      if (!compTrack || compLanesRef.current.length === 0) return;
      const derived = deriveCompStateFromCompTrack(project, compTrack);
      if (derived) {
        skipNextRebuildRef.current = true; // graph already holds this comp
        setCompState(derived);
      }
    });
    return () => sub.terminate();
  }, [project]);

  // ── Live lane rescan while recording (recording view: new takes on top) ──
  useEffect(() => {
    if (!project || !audioContext || !tapeUnitBox || !isRecording) return;
    setCompLanes(scanCompLanes(project, tapeUnitBox, audioContext.sampleRate));
  }, [project, audioContext, tapeUnitBox, isRecording, takeIterations]);

  // ── Rebuild comp regions when compState changes (guarded) ──
  useEffect(() => {
    if (!project || compState === null) return;
    if (skipNextRebuildRef.current) {
      skipNextRebuildRef.current = false; // state came from the graph (undo/redo)
      return;
    }
    if (isRecording || isCountingIn || isFinalizing) return; // recording view: no rebuilds
    const compTrack = compTrackRef.current;
    if (!compTrack || compLanes.length === 0) return;
    isRebuildingRef.current = true;
    try {
      rebuildCompRegions(
        project,
        compTrack,
        compLanes.map((l) => l.source),
        compState,
        loopPpqn,
        bpm
      );
    } catch (e) {
      console.error("Comp rebuild failed: " + String(e));
      setUiError(`Comp rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      isRebuildingRef.current = false;
    }
  }, [project, compState, compLanes, loopPpqn, bpm, isRecording, isCountingIn, isFinalizing]);

  // ── Recording handlers (single-tape variant of the loop demo's flow) ──
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
    // useRecordingTapes.armedCount only updates via RecordingTapeCard's
    // onArmedChange callback (not rendered here — this demo has no per-tape
    // arm UI). The single tape is armed unconditionally in addTape(), so
    // recordingTapes.length is the correct readiness check.
    if (!project || !audioContext || recordingTapes.length === 0) return;
    setUiError(null);
    setFinalizationError(null);
    setAuditionTake(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      // Existing comp must not play along while recording new takes.
      // Unmarked modify: not an undo step of its own.
      const compTrack = compTrackRef.current;
      if (compTrack) {
        const adapter = project.boxAdapters.adapterFor(compTrack, TrackBoxAdapter);
        isRebuildingRef.current = true;
        try {
          project.editing.modify(() => {
            for (const region of adapter.regions.adapters.values()) {
              region.box.mute.setValue(true);
            }
          }, false);
        } finally {
          isRebuildingRef.current = false;
        }
      }
      project.engine.setPosition(0);
      project.startRecording(useCountIn);
    } catch (error) {
      console.error("Failed to start recording: " + String(error));
      setUiError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext, recordingTapes, useCountIn]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;
    terminateDiscovery();
    project.engine.stopRecording();
    setIsFinalizing(true);
    for (const sub of finalizationSubsRef.current) sub.terminate();
    finalizationSubsRef.current = [];
    const loaders = snapshotLoaders();

    const finish = () => {
      project.engine.stop(true);
      setIsFinalizing(false);
      initializeComp();
    };

    if (loaders.size > 0) {
      let finalized = 0;
      const total = loaders.size;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        if (finalized < total) {
          timedOut = true;
          setFinalizationError(
            `Finalization timed out after ${FINALIZATION_TIMEOUT_MS / 1000}s — ` +
              "engine reset; the recording may be incomplete"
          );
          for (const sub of finalizationSubsRef.current) sub.terminate();
          finalizationSubsRef.current = [];
          finish();
        }
      }, FINALIZATION_TIMEOUT_MS);
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
          finish();
        }
      };
      for (const loader of loaders) {
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
      finish();
    }
  }, [project, terminateDiscovery, snapshotLoaders, initializeComp]);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    setUiError(null);
    setAuditionTake(null);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      await waitForLoadingComplete(project);
      project.editing.modify(() => {
        project.timelineBox.loopArea.enabled.setValue(true);
      });
      project.engine.stop(true);
      project.engine.play();
    } catch (error) {
      console.error("Failed to start playback: " + String(error));
      setUiError(
        `Failed to start playback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
  }, [project]);

  const handleClearAll = useCallback(() => {
    if (!project) return;
    setAuditionTake(null);
    const compTrack = compTrackRef.current;
    compTrackRef.current = null;
    project.editing.modify(() => {
      for (const region of getAllRegions(project)) {
        if (
          region.label.startsWith("Take ") ||
          region.label.startsWith("comp:") ||
          region.label === "Comp"
        ) {
          region.box.delete();
        }
      }
      if (compTrack) compTrack.delete();
    });
    setCompLanes([]);
    setCompState(null);
    setSelectedZone(null);
    setTakeIterations([]);
  }, [project, setTakeIterations]);

  // ── Comp interaction handlers ──
  const handleSwipe = useCallback(
    (takeIndex: number, fromPpqn: number, toPpqn: number) => {
      if (compState === null) return;
      setAuditionTake(null);
      setSelectedZone(null);
      const lane = compLanes[takeIndex];
      if (!lane) return;
      // Clamp the swipe to the take's recorded extent (spec rule).
      const extent = takeExtentPpqn(lane.source.durationSec, bpm, loopPpqn);
      const next = assignRange(
        compState,
        takeIndex,
        Math.min(fromPpqn, extent),
        Math.min(toPpqn, extent),
        loopPpqn
      );
      if (next !== compState) setCompState(next);
    },
    [compState, compLanes, bpm, loopPpqn]
  );

  const handleZoneClick = useCallback(
    (takeIndex: number, positionPpqn: number) => {
      if (compState === null) return;
      setAuditionTake(null);
      setSelectedZone(null);
      const next = assignZoneAt(compState, takeIndex, positionPpqn, loopPpqn);
      if (next !== compState) setCompState(next);
    },
    [compState, loopPpqn]
  );

  const handleEdgeDrag = useCallback(
    (boundaryIndex: number, newPpqn: number) => {
      if (compState === null) return;
      setAuditionTake(null);
      setSelectedZone(null);
      // Extending the left zone rightward is limited by its take's recorded
      // extent (same clamp rule as swipes).
      const spans = compSpans(compState, loopPpqn);
      const leftLane = compLanes[spans[boundaryIndex]?.take ?? -1];
      const maxPpqn = leftLane
        ? takeExtentPpqn(leftLane.source.durationSec, bpm, loopPpqn)
        : loopPpqn;
      const next = moveBoundary(
        compState,
        boundaryIndex,
        Math.min(newPpqn, maxPpqn),
        loopPpqn
      );
      if (next !== compState) setCompState(next);
    },
    [compState, compLanes, bpm, loopPpqn]
  );

  // Marquee cut: carve the range into its own section, then select it.
  const handleCut = useCallback(
    (fromPpqn: number, toPpqn: number) => {
      if (compState === null) return;
      const next = splitRange(compState, fromPpqn, toPpqn, loopPpqn);
      if (next === compState) return;
      setCompState(next);
      const a = Math.max(0, Math.round(Math.min(fromPpqn, toPpqn)));
      const bIdx = next.boundaries.indexOf(a);
      setSelectedZone(a === 0 ? 0 : bIdx >= 0 ? bIdx + 1 : null);
    },
    [compState, loopPpqn]
  );

  // Nudge the selected section's content in ±deltaMs steps.
  const handleNudge = useCallback(
    (deltaMs: number) => {
      if (compState === null || selectedZone === null) return;
      const spans = compSpans(compState, loopPpqn);
      const span = spans[selectedZone];
      if (!span) return;
      const lane = compLanes[span.take];
      if (!lane) return;
      const deltaPpqn = PPQN.secondsToPulses(deltaMs / 1000, bpm);
      const extent = takeExtentPpqn(lane.source.durationSec, bpm, loopPpqn);
      // The content window [start−nudge, end−nudge] must stay inside the
      // take's own audio [0, extent] — no bleeding into neighboring takes
      // in the shared recording buffer.
      const minNudge = span.end - extent;
      const maxNudge = span.start;
      const next = nudgeZone(compState, selectedZone, deltaPpqn, minNudge, maxNudge);
      if (next !== compState) setCompState(next);
    },
    [compState, selectedZone, compLanes, bpm, loopPpqn]
  );

  // Audition: unmarked mutes — never their own undo step.
  const handleToggleAudition = useCallback(
    (takeIndex: number) => {
      if (!project) return;
      const compTrack = compTrackRef.current;
      if (!compTrack) return;
      const next = auditionTake === takeIndex ? null : takeIndex;
      const adapter = project.boxAdapters.adapterFor(compTrack, TrackBoxAdapter);
      isRebuildingRef.current = true;
      try {
        project.editing.modify(() => {
          const auditioning = next !== null;
          for (const region of adapter.regions.adapters.values()) {
            region.box.mute.setValue(auditioning);
          }
          compLanes.forEach((l, i) => {
            l.source.regionBox.mute.setValue(!(auditioning && i === next));
          });
        }, false);
      } finally {
        isRebuildingRef.current = false;
      }
      setAuditionTake(next);
    },
    [project, auditionTake, compLanes]
  );

  const handleUndo = useCallback(() => {
    project?.editing.undo();
  }, [project]);
  const handleRedo = useCallback(() => {
    project?.editing.redo();
  }, [project]);

  const getPositionPpqn = useCallback(
    () => project?.engine.position.getValue() ?? 0,
    [project]
  );

  const interactive = hasComp && !isRecording && !isCountingIn && !isFinalizing;
  const setupLocked = isRecording || isCountingIn || isFinalizing || takeCount > 0;

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
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Recording — Comping · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              QUICK SWIPE COMPING
            </h1>
            <p className="mc-intro">
              Cycle-record takes on a single tape, then swipe across the take
              lanes to build a composite. Each swipe splices real regions on a
              comp track — the engine's transparent seam crossfades handle every
              joint. Undo reverts one swipe at a time.
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
              {!hasPermission && (
                <Card>
                  <Flex direction="column" gap="3" align="center">
                    <Text size="2" color="gray">
                      Grant microphone access to record takes.
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
                </Card>
              )}

              <LoopSetupPanel
                bpm={bpm}
                onBpmChange={setBpm}
                leadInBars={0}
                onLeadInBarsChange={() => {}}
                loopLengthBars={loopLengthBars}
                onLoopLengthBarsChange={setLoopLengthBars}
                useCountIn={useCountIn}
                onUseCountInChange={setUseCountIn}
                metronomeEnabled={metronomeEnabled}
                onMetronomeEnabledChange={setMetronomeEnabled}
                disabled={setupLocked}
              />

              {/* Transport */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="2" weight="bold" color="gray">
                    Transport
                  </Text>
                  <Flex gap="3" wrap="wrap" justify="center" align="center">
                    <Button
                      onClick={handleStartRecording}
                      color="red"
                      size="3"
                      variant="solid"
                      disabled={
                        isRecording || isCountingIn || isFinalizing ||
                        isPlaying || recordingTapes.length === 0
                      }
                    >
                      {takeCount > 0 ? "Record More Takes" : "Record"}
                    </Button>
                    <Button
                      onClick={handlePlay}
                      disabled={
                        isRecording || isCountingIn || isFinalizing ||
                        isPlaying || !hasComp
                      }
                      color="green"
                      size="3"
                      variant="solid"
                    >
                      Play Comp
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
                      size="2"
                      variant="soft"
                      disabled={!canUndo || !interactive}
                      onClick={handleUndo}
                    >
                      ↩ Undo
                    </Button>
                    <Button
                      size="2"
                      variant="soft"
                      disabled={!canRedo || !interactive}
                      onClick={handleRedo}
                    >
                      ↪ Redo
                    </Button>
                    <Flex align="center" gap="2">
                      <Text size="1" color="gray">
                        Snap
                      </Text>
                      <Select.Root
                        value={snapGrid}
                        onValueChange={(v) => setSnapGrid(v as SnapGrid)}
                      >
                        <Select.Trigger style={{ width: 90 }} />
                        <Select.Content>
                          <Select.Item value="off">Off</Select.Item>
                          <Select.Item value="1/4">1/4</Select.Item>
                          <Select.Item value="1/8">1/8</Select.Item>
                          <Select.Item value="1/16">1/16</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </Flex>
                    <Button
                      onClick={handleClearAll}
                      color="red"
                      size="1"
                      variant="ghost"
                      disabled={isRecording || isFinalizing || takeCount === 0}
                    >
                      Clear All
                    </Button>
                  </Flex>
                  <Flex justify="center" gap="3" align="center">
                    {isCountingIn && <Badge color="amber" size="2">Count-in</Badge>}
                    {isRecording && <Badge color="red" size="2">Recording</Badge>}
                    {isFinalizing && <Badge color="amber" size="2">Finalizing…</Badge>}
                    {isPlaying && !isRecording && (
                      <Badge color="green" size="2">Playing</Badge>
                    )}
                    <Badge color="gray" size="1">
                      {takeCount} take{takeCount !== 1 ? "s" : ""}
                    </Badge>
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
                </Flex>
              </Card>

              {/* Lanes — visible while comping AND while recording (recording view).
                  assignments: [-1] is a no-take sentinel for the first session's
                  live view: no zone lights up, the comp lane stays empty. */}
              {(compState !== null || compLanes.length > 0) && (
                <SwipeCompLanes
                  takes={compLanes.map((l) => l.lane)}
                  compState={compState ?? { boundaries: [], assignments: [-1] }}
                  loopPpqn={loopPpqn}
                  bpm={bpm}
                  sampleRate={audioContext?.sampleRate ?? 44100}
                  interactive={interactive}
                  recordingLive={isRecording || isCountingIn}
                  collapsed={collapsed}
                  onToggleCollapsed={() => setCollapsed((c) => !c)}
                  auditionTake={auditionTake}
                  onToggleAudition={handleToggleAudition}
                  onSwipe={handleSwipe}
                  onZoneClick={handleZoneClick}
                  onEdgeDrag={handleEdgeDrag}
                  onCut={handleCut}
                  selectedZone={selectedZone}
                  onSelectZone={setSelectedZone}
                  snapPpqn={SNAP_PPQN[snapGrid]}
                  getPositionPpqn={getPositionPpqn}
                  showPlayhead={isPlaying || isRecording}
                />
              )}

              {/* Nudge panel — marquee trick: cut on the comp lane, then nudge */}
              {selectedZone !== null && compState !== null && (() => {
                const spans = compSpans(compState, loopPpqn);
                const span = spans[selectedZone];
                if (!span) return null;
                const lane = compLanes[span.take];
                const nudgeMs = PPQN.pulsesToSeconds(span.nudge, bpm) * 1000;
                return (
                  <Card>
                    <Flex align="center" gap="3" justify="center" wrap="wrap">
                      <Text size="2" style={{ fontVariantNumeric: "tabular-nums" }}>
                        Section {selectedZone + 1} · {lane?.lane.label ?? "?"} ·
                        nudge {nudgeMs >= 0 ? "+" : ""}{nudgeMs.toFixed(0)} ms
                      </Text>
                      <Button size="1" variant="soft" disabled={!interactive}
                        onClick={() => handleNudge(-10)}>
                        ◀ −10 ms
                      </Button>
                      <Button size="1" variant="soft" disabled={!interactive}
                        onClick={() => handleNudge(10)}>
                        +10 ms ▶
                      </Button>
                      <Button size="1" variant="ghost"
                        onClick={() => setSelectedZone(null)}>
                        Done
                      </Button>
                    </Flex>
                  </Card>
                );
              })()}
              {compLanes.length === 0 && (isRecording || isCountingIn) && (
                <Text align="center" color="gray" size="2">
                  Recording… the first take lane appears after the first loop
                  pass. Stop to start comping.
                </Text>
              )}

              {/* Explainer */}
              <Card>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="bold" color="gray">
                    Why the seams are silent
                  </Text>
                  <Text size="2" color="gray">
                    Every splice on the comp track is a butt joint — no crossfade
                    is scheduled anywhere. The engine plays the outgoing take a
                    fraction past the cut at falling gain while fading the
                    incoming take in over the same ~20 ms window: a true
                    overlapping crossfade, scheduled automatically at every seam.
                    Comp decisions persist in the box graph (a label on the first
                    comp region), so undo reverts a swipe and its regions
                    atomically. For longer, musical crossfades between takes,
                    volume automation remains the right tool — see the{" "}
                    <a href="/comp-lanes-demo.html">Comp Lanes demo</a>. For
                    multi-track loop recording, see the{" "}
                    <a href="/loop-recording-demo.html">Loop Recording demo</a>.
                  </Text>
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

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
