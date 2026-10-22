import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { UUID } from "@opendaw/lib-std";
import type { Terminable } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import type {
  SampleLoader,
  AudioRegionBoxAdapter,
} from "@opendaw/studio-adapters";
import type { AudioRegionBox } from "@opendaw/studio-boxes";
import type { RecordingTape } from "@/components/RecordingTapeCard";
import type { TakeRegion, TakeIteration } from "./TakeTimeline";
import { isLeadInTake, takeIterationNumber, takeNumberOf, trackedTakeBaselines } from "./takeLeadIn";

interface UseTakeDiscoveryOptions {
  project: Project | null;
  audioContext: AudioContext | null;
  isRecording: boolean;
  recordingTapes: RecordingTape[];
  leadInBars: number;
}

export interface UseTakeDiscoveryResult {
  takeIterations: TakeIteration[];
  setTakeIterations: Dispatch<SetStateAction<TakeIteration[]>>;
  /** Sync a region's mute flag into takeIterations (used after recording stops,
   *  when the reactive mute subscriptions have been terminated) */
  updateTakeMuteInState: (regionBox: AudioRegionBox, isMuted: boolean) => void;
  /** Terminate (and clear) the adapter-layer subscriptions — call BEFORE
   *  stopRecording() to prevent late SDK events adding stale regions */
  terminateDiscovery: () => void;
  /** SampleLoaders discovered during recording — returns a snapshot and clears
   *  the internal set; consumed by the finalization barrier in handleStopRecording */
  snapshotLoaders: () => Set<SampleLoader>;
}

/**
 * Reactive take discovery for loop recording: subscribes to the adapter layer
 * (audioUnit tracks → regions) while recording, builds TakeRegion entries from
 * "Take N" regions, groups them into TakeIteration state, and tracks mute
 * changes reactively. The SDK numbers each audio unit's takes on from the
 * highest "Take N" it already holds, so a second recording's labels continue
 * and two tapes recorded together can carry different numbers for one pass
 * of the loop. The rows are therefore grouped by recording pass (the take's
 * ordinal past its unit's baseline, after the rows the recording found), and
 * the lead-in take is told by its position, not by its number.
 */
export function useTakeDiscovery({
  project,
  audioContext,
  isRecording,
  recordingTapes,
  leadInBars,
}: UseTakeDiscoveryOptions): UseTakeDiscoveryResult {
  // Takes
  const [takeIterations, setTakeIterations] = useState<TakeIteration[]>([]);

  // Adapter-layer subscriptions for reactive take discovery
  const adapterSubsRef = useRef<Terminable[]>([]);
  // SampleLoaders discovered during recording — ref avoids stale closure in handleStopRecording
  const sampleLoadersRef = useRef<Set<SampleLoader>>(new Set());
  // Ref for recordingTapes to avoid restarting adapter subscriptions when tapes change
  const recordingTapesRef = useRef<RecordingTape[]>([]);
  // Mirror of takeIterations for the recording-start snapshot (how many rows exist already)
  const takeIterationsRef = useRef<TakeIteration[]>([]);
  // Per recording pass: each tape's highest take number among the rows that existed when
  // the pass started, and how many rows those were — set on the recording's rising edge,
  // cleared on its fall. Read off the rows, not the box graph: the SDK creates the first
  // take before the recording flag reaches React, so a graph read would count it as old.
  const passRef = useRef<{ baselines: Map<string, number>; rowsBefore: number } | null>(null);

  // Cleanup subscriptions on unmount (but NOT sampleLoadersRef — handleStopRecording owns that)
  useEffect(() => {
    return () => {
      for (const sub of adapterSubsRef.current) {
        sub.terminate();
      }
      adapterSubsRef.current = [];
    };
  }, []);

  // Keep recordingTapes ref in sync with state
  useEffect(() => {
    recordingTapesRef.current = recordingTapes;
  }, [recordingTapes]);

  useEffect(() => {
    takeIterationsRef.current = takeIterations;
  }, [takeIterations]);

  useEffect(() => {
    if (!isRecording) passRef.current = null;
  }, [isRecording]);

  // Build a TakeRegion from a region adapter, using the typed adapter layer
  // for sampleLoader resolution and tape matching.
  const buildTakeRegion = useCallback(
    (regionAdapter: AudioRegionBoxAdapter): TakeRegion | null => {
      if (!audioContext) return null;

      const takeNumber = takeNumberOf(regionAdapter.label);
      if (takeNumber === null) return null;

      const isMuted = regionAdapter.mute;
      const sampleRate = audioContext.sampleRate;
      const waveformOffsetSec = regionAdapter.waveformOffset.getValue();
      const waveformOffsetFrames = Math.round(waveformOffsetSec * sampleRate);
      const regionBox = regionAdapter.box;
      const durationSec = regionBox.duration.getValue();
      const durationFrames = Math.round(durationSec * sampleRate);

      // Adapter resolves sampleLoader via file → getOrCreateLoader()
      const loader = regionAdapter.file.getOrCreateLoader();

      // Match region to input tape via typed adapter path
      let inputTapeId = "";
      const trackAdapterOpt = regionAdapter.trackBoxAdapter;
      if (!trackAdapterOpt.isEmpty()) {
        inputTapeId = UUID.toString(trackAdapterOpt.unwrap().audioUnit.address.uuid);
      }

      // Fallback for single tape
      const tapes = recordingTapesRef.current;
      if (!inputTapeId && tapes.length === 1) {
        inputTapeId = tapes[0].id;
      }

      return {
        regionBox,
        inputTapeId,
        takeNumber,
        positionPpqn: regionBox.position.getValue(),
        isMuted,
        sampleLoader: loader,
        waveformOffsetFrames,
        durationFrames,
      };
    },
    [audioContext]
  );

  // Insert a TakeRegion into the row of its recording pass
  const addTakeRegionToState = useCallback(
    (region: TakeRegion, iterationNumber: number) => {
      setTakeIterations((prev) => {
        // Skip a regionBox already tracked anywhere (re-subscribe delivers existing regions again)
        if (prev.some((t) => t.regions.some((r) => r.regionBox === region.regionBox))) {
          return prev;
        }
        const existing = prev.find((t) => t.takeNumber === iterationNumber);
        if (existing) {
          // Add region to existing row (multi-track: same pass, different tape)
          const updatedRegions = [...existing.regions, region];
          return prev.map((t) =>
            t.takeNumber === iterationNumber
              ? {
                  ...t,
                  regions: updatedRegions,
                  isMuted: updatedRegions.every((r) => r.isMuted),
                }
              : t
          );
        }
        // New row
        const newIteration: TakeIteration = {
          takeNumber: iterationNumber,
          isLeadIn: isLeadInTake(region.positionPpqn, leadInBars),
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

  // Set up adapter subscriptions when recording starts — typed alternative to raw pointerHub.
  useEffect(() => {
    if (!project || !isRecording || recordingTapes.length === 0) return undefined;

    const subs: Terminable[] = [];
    const allAudioUnits = project.rootBoxAdapter.audioUnits.adapters();

    // The recording's rising edge: snapshot what the rows hold before the new takes arrive
    if (passRef.current === null) {
      passRef.current = {
        baselines: trackedTakeBaselines(takeIterationsRef.current),
        rowsBefore: takeIterationsRef.current.length,
      };
    }
    const pass = passRef.current;

    for (const tape of recordingTapes) {
      const audioUnitAdapter = allAudioUnits.find(
        (au) => au.box === tape.capture.audioUnitBox
      );
      if (!audioUnitAdapter) {
        // Skipped tape = its loader never joins the finalization barrier
        console.error(
          "[useTakeDiscovery] No audioUnit adapter for tape " +
            tape.id +
            " — take discovery skipped for this tape"
        );
        continue;
      }

      const tracksSub = audioUnitAdapter.tracks.catchupAndSubscribe({
        onAdd: (trackAdapter) => {
          const regionsSub = trackAdapter.regions.catchupAndSubscribe({
            onAdded: (regionAdapter) => {
              if (!regionAdapter.isAudioRegion()) return;
              const takeRegion = buildTakeRegion(regionAdapter);
              if (!takeRegion) return;
              const iterationNumber = takeIterationNumber(
                takeRegion.takeNumber,
                pass.baselines.get(takeRegion.inputTapeId) ?? 0,
                pass.rowsBefore
              );
              // A take from before this recording is tracked already, or not this pass's
              if (iterationNumber === null) return;

              addTakeRegionToState(takeRegion, iterationNumber);

              if (takeRegion.sampleLoader) {
                sampleLoadersRef.current.add(takeRegion.sampleLoader);
              }

              // Subscribe to mute changes for reactive UI updates
              // (BooleanField.subscribe passes ObservableValue<boolean>)
              const muteSub = takeRegion.regionBox.mute.subscribe((obs) => {
                updateTakeMuteInState(takeRegion.regionBox, obs.getValue());
              });
              subs.push(muteSub);
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

    adapterSubsRef.current = subs;

    return () => {
      for (const sub of subs) {
        sub.terminate();
      }
      adapterSubsRef.current = [];
      // Do NOT clear sampleLoadersRef here — handleStopRecording owns its lifecycle
      // and may still be using the Set reference for the finalization barrier.
    };
  }, [
    project,
    isRecording,
    recordingTapes,
    buildTakeRegion,
    addTakeRegionToState,
    updateTakeMuteInState,
  ]);

  // Terminate the adapter-layer subscriptions (idempotent) — the demo calls
  // this before stopRecording() so late SDK events can't add stale regions.
  const terminateDiscovery = useCallback(() => {
    for (const sub of adapterSubsRef.current) {
      sub.terminate();
    }
    adapterSubsRef.current = [];
  }, []);

  // Snapshot the discovered loaders and clear the internal set — the copy
  // avoids a race with the subscription effect's cleanup.
  const snapshotLoaders = useCallback(() => {
    const loaders = new Set(sampleLoadersRef.current);
    sampleLoadersRef.current = new Set();
    return loaders;
  }, []);

  return {
    takeIterations,
    setTakeIterations,
    updateTakeMuteInState,
    terminateDiscovery,
    snapshotLoaders,
  };
}
