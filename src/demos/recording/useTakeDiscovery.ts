import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { UUID } from "@opendaw/lib-std";
import type { Terminable } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";
import type {
  SampleLoader,
  AudioRegionBoxAdapter,
} from "@opendaw/studio-adapters";
import type { AudioRegionBox } from "@opendaw/studio-boxes";
import type { RecordingTape } from "@/components/RecordingTapeCard";
import type { TakeRegion, TakeIteration } from "@/components/TakeTimeline";

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
  /** Adapter-layer subscriptions — the demo terminates these BEFORE
   *  stopRecording() to prevent late SDK events adding stale regions */
  pointerHubSubsRef: RefObject<Terminable[]>;
  /** SampleLoaders discovered during recording — consumed (and cleared) by the
   *  demo's finalization barrier in handleStopRecording */
  sampleLoadersRef: RefObject<Set<SampleLoader>>;
}

/**
 * Reactive take discovery for loop recording: subscribes to the adapter layer
 * (audioUnit tracks → regions) while recording, builds TakeRegion entries from
 * "Take N" regions, groups them into TakeIteration state, and tracks mute
 * changes reactively.
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

  // Pointer hub subscriptions for reactive take discovery
  const pointerHubSubsRef = useRef<Terminable[]>([]);
  // SampleLoaders discovered during recording — ref avoids stale closure in handleStopRecording
  const sampleLoadersRef = useRef<Set<SampleLoader>>(new Set());
  // Ref for recordingTapes to avoid restarting pointerHub subscriptions when tapes change
  const recordingTapesRef = useRef<RecordingTape[]>([]);

  // Cleanup subscriptions on unmount (but NOT sampleLoadersRef — handleStopRecording owns that)
  useEffect(() => {
    return () => {
      for (const sub of pointerHubSubsRef.current) {
        sub.terminate();
      }
      pointerHubSubsRef.current = [];
    };
  }, []);

  // Keep recordingTapes ref in sync with state
  useEffect(() => {
    recordingTapesRef.current = recordingTapes;
  }, [recordingTapes]);

  // Build a TakeRegion from a region adapter, using the typed adapter layer
  // for sampleLoader resolution and tape matching.
  const buildTakeRegion = useCallback(
    (regionAdapter: AudioRegionBoxAdapter): TakeRegion | null => {
      if (!audioContext) return null;

      const label = regionAdapter.label;
      if (!label.startsWith("Take ")) return null;

      const takeNumber = parseInt(label.replace("Take ", ""), 10);
      if (isNaN(takeNumber)) return null;

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
        isMuted,
        sampleLoader: loader,
        waveformOffsetFrames,
        durationFrames,
      };
    },
    [audioContext]
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
          // Add region to existing take (multi-track: same take, different tape)
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

  // Set up adapter subscriptions when recording starts — typed alternative to raw pointerHub.
  useEffect(() => {
    if (!project || !isRecording || recordingTapes.length === 0) return;

    const subs: Terminable[] = [];
    const allAudioUnits = project.rootBoxAdapter.audioUnits.adapters();

    for (const tape of recordingTapes) {
      const audioUnitAdapter = allAudioUnits.find(
        (au) => au.box === tape.capture.audioUnitBox
      );
      if (!audioUnitAdapter) continue;

      const tracksSub = audioUnitAdapter.tracks.catchupAndSubscribe({
        onAdd: (trackAdapter) => {
          const regionsSub = trackAdapter.regions.catchupAndSubscribe({
            onAdded: (regionAdapter) => {
              if (!regionAdapter.isAudioRegion()) return;
              const takeRegion = buildTakeRegion(regionAdapter);
              if (!takeRegion) return;

              addTakeRegionToState(takeRegion);

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
    recordingTapes,
    buildTakeRegion,
    addTakeRegionToState,
    updateTakeMuteInState,
  ]);

  return {
    takeIterations,
    setTakeIterations,
    updateTakeMuteInState,
    pointerHubSubsRef,
    sampleLoadersRef,
  };
}
