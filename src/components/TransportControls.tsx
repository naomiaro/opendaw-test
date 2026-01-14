import React from "react";
import { PPQN } from "@moises-ai/lib-dsp";
import { Button, Flex, Text, Badge, Separator } from "@radix-ui/themes";

interface TransportControlsProps {
  isPlaying: boolean;
  currentPosition: number;
  bpm: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

/**
 * Format seconds to mm:ss.ms format
 */
const formatTime = (seconds: number): string => {
  // Handle invalid values
  if (!isFinite(seconds) || isNaN(seconds)) {
    return "00:00.00";
  }

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
};

export const TransportControls: React.FC<TransportControlsProps> = ({
  isPlaying,
  currentPosition,
  bpm,
  onPlay,
  onPause,
  onStop
}) => {
  // Convert PPQN position to seconds
  const timeInSeconds = PPQN.pulsesToSeconds(currentPosition, bpm);
  const formattedTime = formatTime(timeInSeconds);

  return (
    <Flex gap="3" align="center">
      <Button color="green" variant={isPlaying ? "solid" : "soft"} onClick={onPlay} disabled={isPlaying}>
        ▶ Play
      </Button>
      <Button color="orange" onClick={onPause} disabled={!isPlaying}>
        ⏸ Pause
      </Button>
      <Button color="red" onClick={onStop} disabled={!isPlaying}>
        ⏹ Stop
      </Button>
      <Separator orientation="vertical" size="2" />
      <Text size="3" weight="medium" style={{ fontFamily: "monospace", minWidth: "80px" }}>
        {formattedTime}
      </Text>
      <Badge color={isPlaying ? "green" : "gray"}>{isPlaying ? "Playing" : "Stopped"}</Badge>
    </Flex>
  );
};
