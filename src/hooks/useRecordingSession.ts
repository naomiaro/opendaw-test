import { useState, useEffect, useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import type { Terminable } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type { SampleLoader } from "@opendaw/studio-adapters";

export type RecordingState =
  | "idle"
  | "counting-in"
  | "recording"
  | "finalizing"
  | "ready"
  | "playing";

interface UseRecordingSessionOptions {
  project: Project | null;
  audioContext: AudioContext | null;
}

export interface RecordingSessionResult {
  state: RecordingState;
  countInBeatsRemaining: number;
  shouldMonitorPeaks: boolean;
  sampleLoadersRef: MutableRefObject<SampleLoader[]>;
  signalPeaksReady: () => void;
}

/**
 * Manages the recording/playback lifecycle as an explicit state machine.
 *
 * States: idle → counting-in → recording → finalizing → ready → playing → ready
 *
 * After stopRecording(), the SDK finalizes the recording internally.
 * The hook waits for all sampleLoaders to reach "loaded" state, then
 * transitions to "ready". The component can also call signalPeaksReady()
 * to trigger the transition (e.g., from an AnimationFrame peaks monitor).
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
  const sampleLoadersRef = useRef<SampleLoader[]>([]);
  const finalizationSubsRef = useRef<Terminable[]>([]);

  function transition(next: RecordingState) {
    console.log(`[RecordingSession] ${stateRef.current} → ${next}`);
    stateRef.current = next;
    setState(next);
  }

  // Subscribe to engine state — depends only on [project]
  useEffect(() => {
    if (!project) return;

    const subs: Terminable[] = [];

    subs.push(
      project.engine.isCountingIn.catchupAndSubscribe((obs) => {
        const countingIn = obs.getValue();
        if (countingIn && stateRef.current === "idle") {
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
        if (recording && (current === "idle" || current === "counting-in")) {
          transition("recording");
        } else if (
          !recording &&
          (current === "recording" || current === "counting-in")
        ) {
          if (sampleLoadersRef.current.length === 0) {
            // Nothing to finalize (e.g., cancelled during count-in)
            project.engine.stop(true);
            transition("idle");
          } else {
            transition("finalizing");
            startFinalizationBarrier();
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
      cleanupFinalizationSubs();
    };
  }, [project]);

  function cleanupFinalizationSubs() {
    for (const sub of finalizationSubsRef.current) {
      sub.terminate();
    }
    finalizationSubsRef.current = [];
  }

  function startFinalizationBarrier() {
    cleanupFinalizationSubs();

    const loaders = sampleLoadersRef.current;
    console.log(`[RecordingSession] finalization barrier: ${loaders.length} loaders`);
    let finalized = 0;

    const checkComplete = () => {
      console.log(`[RecordingSession] finalization progress: ${finalized}/${loaders.length}, state=${stateRef.current}`);
      if (finalized === loaders.length && stateRef.current === "finalizing") {
        transition("ready");
      }
    };

    for (const loader of loaders) {
      // Check if already loaded (race: short recordings may finalize
      // before the barrier subscribes)
      console.log(`[RecordingSession] loader state: ${loader.state.type}`);
      if (loader.state.type === "loaded") {
        finalized++;
        continue;
      }

      const sub = loader.subscribe((loaderState: { type: string }) => {
        console.log(`[RecordingSession] loader event: ${loaderState.type}`);
        if (loaderState.type === "loaded") {
          sub.terminate();
          finalizationSubsRef.current = finalizationSubsRef.current.filter(
            (s) => s !== sub
          );
          finalized++;
          checkComplete();
        }
      });
      finalizationSubsRef.current.push(sub);
    }

    // If all were already loaded, complete immediately
    checkComplete();
  }

  const signalPeaksReady = useCallback(() => {
    console.log(`[RecordingSession] signalPeaksReady called, state=${stateRef.current}`);
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
    sampleLoadersRef,
    signalPeaksReady,
  };
}
