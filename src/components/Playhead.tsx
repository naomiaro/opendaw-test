import React from "react";
import { PPQN } from "@moises-ai/lib-dsp";

export interface PlayheadProps {
  /**
   * Current playhead position in PPQN
   */
  currentPosition: number;

  /**
   * Beats per minute for time conversion
   */
  bpm: number;

  /**
   * Maximum duration in seconds for calculating position
   */
  maxDuration: number;

  /**
   * Left offset in pixels (e.g., for timeline ruler width) (default: 0)
   */
  leftOffset?: number;

  /**
   * Color of the playhead line (default: "var(--red-9)")
   */
  color?: string;

  /**
   * Width of the playhead line in pixels (default: 2)
   */
  width?: number;

  /**
   * Z-index for layering (default: 10)
   */
  zIndex?: number;

  /**
   * Whether to show the playhead (default: true when position > 0)
   */
  visible?: boolean;
}

/**
 * Playhead component for displaying current playback position
 *
 * Renders a vertical line that tracks the current playback position
 * along a timeline. Position is calculated based on PPQN and BPM.
 *
 * @example
 * ```typescript
 * <Playhead
 *   currentPosition={currentPosition}
 *   bpm={120}
 *   maxDuration={30}
 *   leftOffset={200}
 * />
 * ```
 */
export const Playhead: React.FC<PlayheadProps> = ({
  currentPosition,
  bpm,
  maxDuration,
  leftOffset = 0,
  color = "var(--red-9)",
  width = 2,
  zIndex = 10,
  visible
}) => {
  // Calculate visibility
  const isVisible = visible !== undefined ? visible : currentPosition > 0;

  if (!isVisible || maxDuration <= 0) {
    return null;
  }

  // Convert PPQN to seconds
  const timeInSeconds = PPQN.pulsesToSeconds(currentPosition, bpm);

  // Calculate percentage position (0 to 1), clamped to ensure it's never negative
  const positionFraction = Math.max(0, Math.min(1, timeInSeconds / maxDuration));

  // Calculate left position: leftOffset + (percentage of the remaining waveform area)
  // The waveform area is (100% - leftOffset), so we apply the position fraction to that
  const leftPosition = `calc(${leftOffset}px + (100% - ${leftOffset}px) * ${positionFraction})`;

  return (
    <div
      style={{
        position: "absolute",
        left: leftPosition,
        top: 0,
        bottom: 0,
        width: `${width}px`,
        backgroundColor: color,
        pointerEvents: "none",
        zIndex
      }}
      aria-label={`Playhead at ${timeInSeconds.toFixed(2)} seconds`}
    />
  );
};
