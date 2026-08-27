import React from "react";
import { PPQN } from "@opendaw/lib-dsp";
import { Button, Flex, Text, Badge, Separator } from "@radix-ui/themes";
import { formatDuration } from "@/lib/audioUtils";

interface TransportControlsProps {
  isPlaying: boolean;
  currentPosition: number;
  bpm: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

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
  // "floor": a live clock must never display a time the playhead hasn't reached
  const formattedTime = formatDuration(timeInSeconds, "mm:ss.cc", "floor");

  return (
    <Flex gap="3" align="center" wrap="wrap">
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
