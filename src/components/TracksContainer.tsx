import React from "react";
import { Flex } from "@radix-ui/themes";
import { Playhead, type PlayheadProps } from "./Playhead";

export interface TracksContainerProps {
  /**
   * Children to render inside the container (typically TimelineRuler and TrackRows)
   */
  children: React.ReactNode;

  /**
   * Current playback position in PPQN
   */
  currentPosition: number;

  /**
   * Beats per minute for playhead positioning
   */
  bpm: number;

  /**
   * Maximum duration in seconds for playhead calculation
   */
  maxDuration: number;

  /**
   * Left offset for playhead (e.g., width of track controls area)
   * Default: 200
   */
  leftOffset?: number;

  /**
   * Color of the playhead line
   * Default: "#fff"
   */
  playheadColor?: string;

  /**
   * Whether to show a border around the container
   * Default: false
   */
  showBorder?: boolean;
}

/**
 * TracksContainer - Container for timeline, tracks, and playhead overlay
 *
 * Provides a relative-positioned container for timeline and tracks,
 * with an absolutely-positioned playhead overlay on top.
 *
 * @example
 * ```tsx
 * <TracksContainer
 *   currentPosition={currentPosition}
 *   bpm={120}
 *   maxDuration={30}
 *   leftOffset={200}
 * >
 *   <TimelineRuler maxDuration={30} />
 *   {tracks.map(track => <TrackRow key={track.id} {...track} />)}
 * </TracksContainer>
 * ```
 */
export const TracksContainer: React.FC<TracksContainerProps> = ({
  children,
  currentPosition,
  bpm,
  maxDuration,
  leftOffset = 200,
  playheadColor = "#fff",
  showBorder = false
}) => {
  return (
    <Flex
      direction="column"
      gap="0"
      style={{
        position: "relative",
        ...(showBorder && { border: "1px solid var(--gray-6)" })
      }}
    >
      {children}

      {/* Playhead overlay */}
      <Playhead
        currentPosition={currentPosition}
        bpm={bpm}
        maxDuration={maxDuration}
        leftOffset={leftOffset}
        color={playheadColor}
      />
    </Flex>
  );
};
