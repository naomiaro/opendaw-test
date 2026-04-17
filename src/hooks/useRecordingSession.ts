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
 * After stopRecording(), the SDK finalizes the recording internally —
 * the hook does NOT call engine.stop(true) during finalization.
 * The component signals peak readiness via signalPeaksReady() to
 * transition from "finalizing" to "ready".
 */
export function useRecordingSession({
  project,
}: UseRecordingSessionOptions): RecordingSessionResult {
  const [state, setState] = useState<RecordingState>("idle");
  const stateRef = useRef<RecordingState>("idle");
  const [countInBeatsRemaining, setCountInBeatsRemaining] = useState(0);
  const sampleLoadersRef = useRef<SampleLoader[]>([]);

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
          if (sampleLoadersRef.current.length === 0) {
            // Nothing to finalize (e.g., cancelled during count-in)
            project.engine.stop(true);
            transition("idle");
          } else {
            // SDK handles finalization internally after stopRecording().
            // Wait for signalPeaksReady() from the component.
            transition("finalizing");
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

    return () => subs.forEach((s) => s.terminate());
  }, [project]);

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
