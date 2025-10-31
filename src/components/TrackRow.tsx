import React, { useEffect, useState, useCallback, useRef } from "react";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";
import { Button, Flex, Text, Slider } from "@radix-ui/themes";

export type TrackData = {
  name: string;
  trackBox: TrackBox;
  audioUnitBox: AudioUnitBox;
  uuid: UUID.Bytes;
};

interface TrackRowProps {
  track: TrackData;
  project: Project;
  allTracks: TrackData[];
  peaks: any;
  canvasRef: (el: HTMLCanvasElement | null) => void;
  currentPosition: number;
  isPlaying: boolean;
  bpm: number;
  audioBuffer: AudioBuffer | undefined;
  setCurrentPosition: (position: number) => void;
  pausedPositionRef: React.MutableRefObject<number | null>;
  maxDuration: number;
}

/**
 * TrackRow - Audacity-style track row with mixer controls on left and waveform on right
 */
export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  project,
  allTracks,
  canvasRef,
  currentPosition,
  isPlaying,
  bpm,
  audioBuffer,
  setCurrentPosition,
  pausedPositionRef,
  maxDuration
}) => {
  const [volume, setVolume] = useState(0);
  const [pan, setPan] = useState(0);
  const [muted, setMuted] = useState(false);
  const [soloed, setSoloed] = useState(false);
  const waveformContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to audio unit state
  useEffect(() => {
    const volumeSubscription = track.audioUnitBox.volume.catchupAndSubscribe(obs => {
      setVolume(obs.getValue());
    });

    const panSubscription = track.audioUnitBox.panning.catchupAndSubscribe(obs => {
      setPan(obs.getValue());
    });

    const muteSubscription = track.audioUnitBox.mute.catchupAndSubscribe(obs => {
      setMuted(obs.getValue());
    });

    const soloSubscription = track.audioUnitBox.solo.catchupAndSubscribe(obs => {
      setSoloed(obs.getValue());
    });

    return () => {
      volumeSubscription.terminate();
      panSubscription.terminate();
      muteSubscription.terminate();
      soloSubscription.terminate();
    };
  }, [track]);

  // Handle volume change
  const handleVolumeChange = useCallback(
    (values: number[]) => {
      const newVolume = values[0];
      project.editing.modify(() => {
        track.audioUnitBox.volume.setValue(newVolume);
      });
    },
    [project, track]
  );

  // Handle pan change
  const handlePanChange = useCallback(
    (values: number[]) => {
      const newPan = values[0];
      project.editing.modify(() => {
        track.audioUnitBox.panning.setValue(newPan);
      });
    },
    [project, track]
  );

  // Handle mute toggle
  const handleMuteToggle = useCallback(() => {
    project.editing.modify(() => {
      track.audioUnitBox.mute.setValue(!muted);
    });
  }, [project, track, muted]);

  // Handle solo toggle with DAW-style behavior
  const handleSoloToggle = useCallback(() => {
    project.editing.modify(() => {
      // Simply toggle solo - OpenDAW handles the audio routing
      // This way the mute buttons don't get visually toggled
      track.audioUnitBox.solo.setValue(!soloed);
    });
  }, [project, track, soloed]);

  // Handle waveform click to seek
  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioBuffer || !waveformContainerRef.current) return;

      const rect = waveformContainerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = clickX / rect.width;

      // Calculate position in seconds using maxDuration (same as playhead), then convert to PPQN
      const timeInSeconds = percent * maxDuration;
      const positionInPPQN = PPQN.secondsToPulses(timeInSeconds, bpm);

      // Set the playback position in engine and update state
      project.engine.setPosition(positionInPPQN);
      setCurrentPosition(positionInPPQN);

      // If not playing, save position so play will start from here
      if (!isPlaying) {
        pausedPositionRef.current = positionInPPQN;
      }

      console.debug(`Seek to ${timeInSeconds.toFixed(2)}s (${positionInPPQN} PPQN)`);
    },
    [audioBuffer, bpm, project, setCurrentPosition, isPlaying, pausedPositionRef, maxDuration]
  );

  return (
    <Flex
      gap="0"
      style={{
        borderBottom: "1px solid var(--gray-6)",
        backgroundColor: "var(--gray-2)"
      }}
    >
      {/* Mixer Controls - Left Side (Audacity-style) */}
      <Flex
        direction="column"
        gap="2"
        style={{
          width: "200px",
          padding: "12px",
          backgroundColor: "var(--gray-3)",
          borderRight: "1px solid var(--gray-6)"
        }}
      >
        {/* Track name */}
        <Text size="2" weight="bold" style={{ marginBottom: "4px" }}>
          {track.name}
        </Text>

        {/* Mute and Solo buttons */}
        <Flex gap="2" align="center">
          <Button
            size="1"
            color={muted ? "red" : "gray"}
            variant={muted ? "solid" : "soft"}
            onClick={handleMuteToggle}
            style={{
              width: "32px",
              height: "24px",
              padding: 0,
              fontSize: "12px",
              fontWeight: "bold"
            }}
          >
            M
          </Button>
          <Button
            size="1"
            color={soloed ? "yellow" : "gray"}
            variant={soloed ? "solid" : "soft"}
            onClick={handleSoloToggle}
            style={{
              width: "32px",
              height: "24px",
              padding: 0,
              fontSize: "12px",
              fontWeight: "bold"
            }}
          >
            S
          </Button>
          <Text size="1" color="gray" style={{ marginLeft: "4px" }}>
            {volume.toFixed(1)}dB
          </Text>
        </Flex>

        {/* Volume slider - horizontal */}
        <Slider
          value={[volume]}
          onValueChange={handleVolumeChange}
          min={-60}
          max={6}
          step={0.1}
          style={{ width: "100%" }}
        />

        {/* Pan label */}
        <Flex justify="between" align="center">
          <Text size="1" color="gray">
            Pan
          </Text>
          <Text size="1" color="gray">
            {pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan * 100).toFixed(0)}` : `R${(pan * 100).toFixed(0)}`}
          </Text>
        </Flex>

        {/* Pan slider - horizontal */}
        <Slider value={[pan]} onValueChange={handlePanChange} min={-1} max={1} step={0.01} style={{ width: "100%" }} />
      </Flex>

      {/* Waveform - Right Side */}
      <div
        ref={waveformContainerRef}
        onClick={handleWaveformClick}
        style={{
          flex: 1,
          height: "120px",
          backgroundColor: "#000",
          position: "relative",
          boxSizing: "border-box",
          cursor: "pointer"
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    </Flex>
  );
};
