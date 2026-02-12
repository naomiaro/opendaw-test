import { useState, useEffect, useRef } from "react";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";

interface PlaybackPositionResult {
  currentPosition: number;
  setCurrentPosition: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  currentPositionRef: React.MutableRefObject<number>;
  pausedPositionRef: React.MutableRefObject<number | null>;
}

/**
 * Hook for tracking playback position and playing state.
 *
 * Consolidates the AnimationFrame + engine position tracking pattern
 * used across demo files. Updates `currentPosition` state every frame
 * while playing, and exposes refs for use in transport controls.
 *
 * @param project - The OpenDAW project instance (can be null during initialization)
 * @returns Position state, playing state, and refs for transport integration
 *
 * @example
 * ```typescript
 * const {
 *   currentPosition,
 *   setCurrentPosition,
 *   isPlaying,
 *   currentPositionRef,
 *   pausedPositionRef,
 * } = usePlaybackPosition(project);
 * ```
 */
export function usePlaybackPosition(project: Project | null): PlaybackPositionResult {
  const [currentPosition, setCurrentPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentPositionRef = useRef<number>(0);
  const pausedPositionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!project) return;

    const playingSub = project.engine.isPlaying.catchupAndSubscribe((obs) => {
      setIsPlaying(obs.getValue());
    });

    const animationFrameSub = AnimationFrame.add(() => {
      const position = project.engine.position.getValue();
      currentPositionRef.current = position;
      if (project.engine.isPlaying.getValue()) {
        setCurrentPosition(position);
      }
    });

    return () => {
      playingSub.terminate();
      animationFrameSub.terminate();
    };
  }, [project]);

  return {
    currentPosition,
    setCurrentPosition,
    isPlaying,
    currentPositionRef,
    pausedPositionRef,
  };
}
