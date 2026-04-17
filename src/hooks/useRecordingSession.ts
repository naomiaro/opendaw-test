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

export function useRecordingSession({
  project,
  audioContext,
}: UseRecordingSessionOptions): RecordingSessionResult {
  const [state, setState] = useState<RecordingState>("idle");
  const stateRef = useRef<RecordingState>("idle");
  const [countInBeatsRemaining, setCountInBeatsRemaining] = useState(0);
  const sampleLoadersRef = useRef<SampleLoader[]>([]);
  const finalizationSubsRef = useRef<Terminable[]>([]);

  function transition(next: RecordingState) {
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
          transition("finalizing");
          startFinalizationBarrier(project);
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
      for (const sub of finalizationSubsRef.current) {
        sub.terminate();
      }
      finalizationSubsRef.current = [];
    };
  }, [project]);

  function startFinalizationBarrier(proj: Project) {
    // Clean up any prior finalization subs
    for (const sub of finalizationSubsRef.current) {
      sub.terminate();
    }
    finalizationSubsRef.current = [];

    const loaders = sampleLoadersRef.current;
    if (loaders.length === 0) {
      // Nothing to finalize (e.g., cancelled during count-in)
      proj.engine.stop(true);
      transition("idle");
      return;
    }

    let finalized = 0;
    for (const loader of loaders) {
      const sub = loader.subscribe((loaderState: { type: string }) => {
        if (loaderState.type === "loaded") {
          sub.terminate();
          finalizationSubsRef.current = finalizationSubsRef.current.filter(
            (s) => s !== sub
          );
          finalized++;
          if (finalized === loaders.length) {
            proj.engine.stop(true);
            // Don't transition to "ready" here — wait for signalPeaksReady()
            // which fires when the component's AnimationFrame detects final peaks.
          }
        }
      });
      finalizationSubsRef.current.push(sub);
    }
  }

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
    sampleLoadersRef,
    signalPeaksReady,
  };
}
