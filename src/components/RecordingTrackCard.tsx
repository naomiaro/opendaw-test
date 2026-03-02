import React, { useState, useCallback, useEffect } from "react";
import { Flex, Text, Select, Button, Slider, Badge, Card } from "@radix-ui/themes";
import { Project, CaptureAudio } from "@opendaw/studio-core";
import type { MonitoringMode } from "@opendaw/studio-core";
import { probeDeviceChannels } from "../lib/audioUtils";

export interface RecordingTrack {
  id: string;
  capture: CaptureAudio;
}

interface RecordingTrackCardProps {
  track: RecordingTrack;
  trackIndex: number;
  project: Project;
  audioInputDevices: readonly MediaDeviceInfo[];
  disabled: boolean;
  onRemove: (id: string) => void;
  onArmedChange?: (id: string, armed: boolean) => void;
}

export const RecordingTrackCard: React.FC<RecordingTrackCardProps> = ({
  track,
  trackIndex,
  project,
  audioInputDevices,
  disabled,
  onRemove,
  onArmedChange
}) => {
  const { capture } = track;

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    const deviceOpt = capture.deviceId.getValue();
    return deviceOpt.isEmpty() ? (audioInputDevices[0]?.deviceId ?? "") : deviceOpt.unwrap();
  });
  const [isMono, setIsMono] = useState<boolean>(() => {
    const chOpt = capture.requestChannels;
    return chOpt.isEmpty() ? true : chOpt.unwrap() === 1;
  });
  const [inputGainDb, setInputGainDb] = useState<number>(() => capture.gainDb);
  const [monitoringMode, setMonitoringModeState] = useState<MonitoringMode>("off");
  const [maxChannels, setMaxChannels] = useState<1 | 2>(2);
  const [isArmed, setIsArmed] = useState<boolean>(() => capture.armed.getValue());

  // Probe device channel capabilities when device changes
  useEffect(() => {
    if (!selectedDeviceId) return;
    let cancelled = false;
    probeDeviceChannels(selectedDeviceId).then(channels => {
      if (cancelled) return;
      setMaxChannels(channels);
      if (channels === 1) setIsMono(true);
    });
    return () => { cancelled = true; };
  }, [selectedDeviceId]);

  // Subscribe to armed state changes and notify parent
  useEffect(() => {
    const sub = capture.armed.catchupAndSubscribe(obs => {
      const armed = obs.getValue();
      setIsArmed(armed);
      onArmedChange?.(track.id, armed);
    });
    return () => sub.terminate();
  }, [capture, track.id, onArmedChange]);

  // Sync box graph fields — require a transaction
  useEffect(() => {
    project.editing.modify(() => {
      if (selectedDeviceId) {
        capture.captureBox.deviceId.setValue(selectedDeviceId);
      }
      capture.requestChannels = isMono ? 1 : 2;
      capture.captureBox.gainDb.setValue(inputGainDb);
    });
  }, [project, capture, selectedDeviceId, isMono, inputGainDb]);

  // Sync monitoring mode — manipulates Web Audio nodes, outside transaction
  useEffect(() => {
    (capture as any).monitoringMode = monitoringMode;
  }, [capture, monitoringMode]);

  const handleToggleArm = useCallback(() => {
    if (isArmed) {
      // Disarm: set armed to false directly
      capture.armed.setValue(false);
    } else {
      // Arm non-exclusively so other tracks stay armed
      project.captureDevices.setArm(capture, false);
    }
  }, [project, capture, isArmed]);

  const handleRemove = useCallback(() => {
    onRemove(track.id);
  }, [onRemove, track.id]);

  return (
    <Card style={{ background: "var(--gray-2)" }}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Flex align="center" gap="2">
            <Text size="2" weight="bold">Track {trackIndex + 1}</Text>
            {isArmed && <Badge color="red" size="1">Armed</Badge>}
          </Flex>
          <Flex gap="2">
            <Button
              size="1"
              variant={isArmed ? "solid" : "soft"}
              color={isArmed ? "red" : "gray"}
              onClick={handleToggleArm}
              disabled={disabled}
            >
              {isArmed ? "● Disarm" : "○ Arm"}
            </Button>
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={handleRemove}
              disabled={disabled}
            >
              Remove
            </Button>
          </Flex>
        </Flex>

        <Flex gap="4" wrap="wrap" align="end">
          <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 200 }}>
            <Text size="2" weight="medium">Input Device:</Text>
            <Select.Root
              value={selectedDeviceId}
              onValueChange={setSelectedDeviceId}
              disabled={disabled}
            >
              <Select.Trigger placeholder="Select input device..." />
              <Select.Content>
                {audioInputDevices.map(device => (
                  <Select.Item key={device.deviceId} value={device.deviceId}>
                    {device.label || `Input ${device.deviceId.slice(0, 8)}...`}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex direction="column" gap="1">
            <Flex align="center" gap="1">
              <Text size="2" weight="medium">Channels:</Text>
              {maxChannels === 1 && <Text size="1" color="gray">(mono only)</Text>}
            </Flex>
            <Flex gap="2">
              <Button
                size="1"
                variant={isMono ? "soft" : "solid"}
                color={isMono ? "gray" : "blue"}
                onClick={() => setIsMono(false)}
                disabled={disabled || maxChannels === 1}
              >
                Stereo
              </Button>
              <Button
                size="1"
                variant={isMono ? "solid" : "soft"}
                color={isMono ? "blue" : "gray"}
                onClick={() => setIsMono(true)}
                disabled={disabled}
              >
                Mono
              </Button>
            </Flex>
          </Flex>

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">Monitoring:</Text>
            <Select.Root
              value={monitoringMode}
              onValueChange={value => setMonitoringModeState(value as MonitoringMode)}
              disabled={disabled}
            >
              <Select.Trigger style={{ width: 110 }} />
              <Select.Content>
                <Select.Item value="off">Off</Select.Item>
                <Select.Item value="direct">Direct</Select.Item>
                <Select.Item value="effects">Effects</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
        </Flex>

        <Flex align="center" gap="3">
          <Text size="2" weight="medium" style={{ minWidth: 80 }}>Input Gain:</Text>
          <Slider
            value={[inputGainDb + 60]}
            onValueChange={values => setInputGainDb(values[0] - 60)}
            min={0}
            max={72}
            step={0.5}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <Text size="1" color="gray" style={{ minWidth: 55, fontFamily: "monospace" }}>
            {inputGainDb > 0 ? "+" : ""}{inputGainDb.toFixed(1)} dB
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
};
