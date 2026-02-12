import { useCallback } from "react";
import { Project } from "@opendaw/studio-core";

interface TransportControlsOptions {
  project: Project | null;
  audioContext: AudioContext | null;
  pausedPositionRef: React.MutableRefObject<number | null>;
}

interface TransportControlsResult {
  handlePlay: () => Promise<void>;
  handlePause: () => void;
  handleStop: () => void;
}

/**
 * Hook for common transport control handlers (play, pause, stop).
 *
 * Handles AudioContext resumption (including iOS Safari re-suspension),
 * paused position restoration, and engine start/stop. Designed to work
 * with `usePlaybackPosition` which provides the `pausedPositionRef`.
 *
 * @param options.project - The OpenDAW project instance
 * @param options.audioContext - The AudioContext (needed for suspend/resume)
 * @param options.pausedPositionRef - Ref tracking paused position, from usePlaybackPosition
 * @returns Play, pause, and stop handler callbacks
 *
 * @example
 * ```typescript
 * const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
 * const { handlePlay, handlePause, handleStop } = useTransportControls({
 *   project,
 *   audioContext,
 *   pausedPositionRef,
 * });
 * ```
 */
export function useTransportControls({
  project,
  audioContext,
  pausedPositionRef,
}: TransportControlsOptions): TransportControlsResult {
  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    if (pausedPositionRef.current !== null) {
      project.engine.setPosition(pausedPositionRef.current);
      pausedPositionRef.current = null;
    }
    project.engine.play();
  }, [project, audioContext, pausedPositionRef]);

  const handlePause = useCallback(() => {
    if (!project) return;
    pausedPositionRef.current = project.engine.position.getValue();
    project.engine.stop(false);
  }, [project, pausedPositionRef]);

  const handleStop = useCallback(() => {
    if (!project) return;
    pausedPositionRef.current = null;
    project.engine.stop(true);
  }, [project, pausedPositionRef]);

  return { handlePlay, handlePause, handleStop };
}
