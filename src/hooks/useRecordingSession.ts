import { useState, useEffect, useRef, useCallback } from "react";
import type { Terminable } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type { SampleLoader, SampleLoaderState } from "@opendaw/studio-adapters";

export type RecordingState =
  | "idle"
  | "counting-in"
  | "recording"
  | "finalizing"
  | "ready"
  | "playing";

interface UseRecordingSessionOptions {
  project: Project | null;
}

export interface RecordingSessionResult {
  state: RecordingState;
  countInBeatsRemaining: number;
  shouldMonitorPeaks: boolean;
  /** Call when the AnimationFrame discovers a new sampleLoader during recording.
   *  The hook subscribes eagerly so the "loaded" event is never missed. */
  registerLoader: (loader: SampleLoader) => void;
  /** Reset loaders before starting a new recording. */
  resetLoaders: () => void;
  signalPeaksReady: () => void;
}

/**
 * Manages the recording/playback lifecycle as an explicit state machine.
 *
 * States: idle → counting-in → recording → finalizing → ready → playing → ready
 *
 * Loaders are registered eagerly during recording via registerLoader().
 * Each loader is subscribed immediately so the "loaded" event is never missed.
 * When isRecording fires false, the hook checks if all registered loaders
 * are already loaded — if so, transitions directly to "ready". Otherwise
 * waits for the remaining subscriptions to fire.
 *
 * The hook does NOT call engine.stop(true) during finalization — the SDK
 * handles this internally. stop(true) is only called for the count-in
 * cancel case (no loaders).
 */
export function useRecordingSession({
  project,
}: UseRecordingSessionOptions): RecordingSessionResult {
  const [state, setState] = useState<RecordingState>("idle");
  const stateRef = useRef<RecordingState>("idle");
  const [countInBeatsRemaining, setCountInBeatsRemaining] = useState(0);

  // Eager loader tracking: subscribe as soon as discovered, not when recording stops
  const loadersRef = useRef<SampleLoader[]>([]);
  const loaderSubsRef = useRef<Terminable[]>([]);
  const loadedCountRef = useRef(0);

  function transition(next: RecordingState) {
    stateRef.current = next;
    setState(next);
  }

  function checkFinalizationComplete() {
    if (
      stateRef.current === "finalizing" &&
      loadersRef.current.length > 0 &&
      loadedCountRef.current >= loadersRef.current.length
    ) {
      transition("ready");
    }
  }

  // Register a loader eagerly during recording. Subscribes immediately
  // so the "loaded" event can never be missed.
  const registerLoader = useCallback((loader: SampleLoader) => {
    if (loadersRef.current.includes(loader)) return;
    loadersRef.current.push(loader);

    if (loader.state.type === "loaded") {
      loadedCountRef.current++;
      checkFinalizationComplete();
      return;
    }

    const sub = loader.subscribe((loaderState: SampleLoaderState) => {
      if (loaderState.type === "loaded") {
        sub.terminate();
        loaderSubsRef.current = loaderSubsRef.current.filter((s) => s !== sub);
        loadedCountRef.current++;
        checkFinalizationComplete();
      }
    });
    loaderSubsRef.current.push(sub);
  }, []);

  const resetLoaders = useCallback(() => {
    for (const sub of loaderSubsRef.current) {
      sub.terminate();
    }
    loaderSubsRef.current = [];
    loadersRef.current = [];
    loadedCountRef.current = 0;
  }, []);

  // Subscribe to engine state — depends only on [project]
  useEffect(() => {
    if (!project) return;

    const subs: Terminable[] = [];

    subs.push(
      project.engine.isCountingIn.catchupAndSubscribe((obs) => {
        const countingIn = obs.getValue();
        if (countingIn && (stateRef.current === "idle" || stateRef.current === "ready")) {
          transition("counting-in");
        }
      })
    );

    subs.push(
      project.engine.countInBeatsRemaining.catchupAndSubscribe((obs) => {
        setCountInBeatsRemaining(Math.ceil(obs.getValue()));
      })
    );

    subs.push(
      project.engine.isRecording.catchupAndSubscribe((obs) => {
        const recording = obs.getValue();
        const current = stateRef.current;
        if (recording && (current === "idle" || current === "counting-in" || current === "ready")) {
          transition("recording");
        } else if (
          !recording &&
          (current === "recording" || current === "counting-in")
        ) {
          if (loadersRef.current.length === 0) {
            // Nothing to finalize (e.g., cancelled during count-in)
            project.engine.stop(true);
            transition("idle");
          } else {
            transition("finalizing");
            // Loaders were already subscribed eagerly via registerLoader().
            // Check if they all finished while we were still recording.
            checkFinalizationComplete();
          }
        }
      })
    );

    subs.push(
      project.engine.isPlaying.catchupAndSubscribe((obs) => {
        const playing = obs.getValue();
        const current = stateRef.current;
        if (current === "ready" && playing) {
          transition("playing");
        } else if (current === "playing" && !playing) {
          transition("ready");
        }
        // During "finalizing", isPlaying changes are intentionally ignored.
      })
    );

    return () => {
      subs.forEach((s) => s.terminate());
      resetLoaders();
    };
  }, [project, resetLoaders]);

  const signalPeaksReady = useCallback(() => {
    if (stateRef.current === "finalizing") {
      transition("ready");
    }
  }, []);

  const shouldMonitorPeaks =
    state === "counting-in" || state === "recording" || state === "finalizing";

  return {
    state,
    countInBeatsRemaining,
    shouldMonitorPeaks,
    registerLoader,
    resetLoaders,
    signalPeaksReady,
  };
}
