import React from "react";
import { PPQN } from "@opendaw/lib-dsp";
import { Button, Flex, Text, Badge, Separator } from "@radix-ui/themes";

const { Quarter } = PPQN;

interface TransportControlsProps {
  isPlaying: boolean;
  currentPosition: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

export const TransportControls: React.FC<TransportControlsProps> = ({
  isPlaying,
  currentPosition,
  onPlay,
  onPause,
  onStop
}) => {
  return (
    <Flex gap="3" align="center">
      <Button
        color="green"
        variant={isPlaying ? "solid" : "soft"}
        onClick={onPlay}
        disabled={isPlaying}
      >
        ▶ Play
      </Button>
      <Button
        color="orange"
        onClick={onPause}
        disabled={!isPlaying}
      >
        ⏸ Pause
      </Button>
      <Button
        color="red"
        onClick={onStop}
        disabled={!isPlaying}
      >
        ⏹ Stop
      </Button>
      <Separator orientation="vertical" size="2" />
      <Text size="2" color="gray">
        Position: {(currentPosition / Quarter).toFixed(2)} quarters
      </Text>
      <Badge color={isPlaying ? "green" : "gray"}>
        {isPlaying ? "Playing" : "Stopped"}
      </Badge>
    </Flex>
  );
};
