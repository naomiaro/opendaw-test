import React, { useState, useCallback, useEffect } from "react";
import { Flex, Text, Select, Button, Slider, Badge, Card, Separator, TextField, Code } from "@radix-ui/themes";
import { Project, CaptureAudio, InputLatency } from "@opendaw/studio-core";
import { Option } from "@opendaw/lib-std";
import type { MonitoringMode } from "@opendaw/studio-core";
import { probeDeviceChannels } from "../lib/audioUtils";

type InputLatencyMode = "inherit" | "equals-output" | "custom";

const modeFromValue = (value: number): InputLatencyMode => {
  if (value === InputLatency.Inherit) return "inherit";
  if (value === InputLatency.EqualsOutput) return "equals-output";
  return "custom";
};

export interface RecordingTape {
  id: string;
  capture: CaptureAudio;
}

interface RecordingTapeCardProps {
  tape: RecordingTape;
  tapeIndex: number;
  project: Project;
  audioInputDevices: readonly MediaDeviceInfo[];
  audioOutputDevices: readonly MediaDeviceInfo[];
  disabled: boolean;
  onRemove: (id: string) => void;
  onArmedChange?: (id: string, armed: boolean) => void;
}

export const RecordingTapeCard: React.FC<RecordingTapeCardProps> = ({
  tape,
  tapeIndex,
  project,
  audioInputDevices,
  audioOutputDevices,
  disabled,
  onRemove,
  onArmedChange
}) => {
  const { capture } = tape;

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

  // Per-tape input-latency override (CaptureAudioBox.inputLatency).
  // -2 = inherit engine preference, -1 = equals outputLatency, ≥0 = explicit seconds.
  const [inputLatencySec, setInputLatencySec] = useState<number>(() => capture.captureBox.inputLatency.getValue());
  const inputLatencyMode = modeFromValue(inputLatencySec);
  const [inputLatencyMsDraft, setInputLatencyMsDraft] = useState<string>(() =>
    inputLatencyMode === "custom" ? (inputLatencySec * 1000).toFixed(2) : "0.00"
  );

  // Browser-reported track latency from the captured MediaStreamTrack (read-only diagnostic).
  const [reportedTrackLatencyMs, setReportedTrackLatencyMs] = useState<number | null>(null);

  // Monitor controls (SDK 0.0.133+)
  const [monitorVolumeDb, setMonitorVolumeDb] = useState<number>(() => capture.monitorVolumeDb);
  const [monitorPan, setMonitorPan] = useState<number>(() => capture.monitorPan);
  const [monitorMuted, setMonitorMuted] = useState<boolean>(() => capture.monitorMuted);
  const [monitorOutputDeviceId, setMonitorOutputDeviceId] = useState<string>("default");

  // setSinkId is Chrome/Edge only — gate output device selection
  const canSwitchOutput = "setSinkId" in AudioContext.prototype;

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
      onArmedChange?.(tape.id, armed);
    });
    return () => sub.terminate();
  }, [capture, tape.id, onArmedChange]);

  // Surface the browser-reported MediaStreamTrack latency (if any) whenever the active stream changes.
  // MutableObservableOption.catchupAndSubscribe passes the Option directly — no getValue() wrapper.
  // Driver-reported NaN/negative values are rejected at the source so they never reach the box graph.
  useEffect(() => {
    const sub = capture.stream.catchupAndSubscribe(streamOpt => {
      if (streamOpt.isEmpty()) {
        setReportedTrackLatencyMs(null);
        return;
      }
      const track = streamOpt.unwrap().getAudioTracks().at(0);
      const reported = track?.getSettings().latency;
      const valid = typeof reported === "number" && Number.isFinite(reported) && reported >= 0;
      setReportedTrackLatencyMs(valid ? reported * 1000 : null);
    });
    return () => sub.terminate();
  }, [capture]);

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

  // Sync per-tape inputLatency override — box graph field, requires transaction.
  // Guard against NaN (NaN === NaN is false, so a no-op compare wouldn't catch it) and
  // against unrelated re-renders that would open an empty transaction.
  useEffect(() => {
    if (!Number.isFinite(inputLatencySec)) return;
    if (capture.captureBox.inputLatency.getValue() === inputLatencySec) return;
    project.editing.modify(() => {
      capture.captureBox.inputLatency.setValue(inputLatencySec);
    });
  }, [project, capture, inputLatencySec]);

  // Sync monitoring mode — manipulates Web Audio nodes, outside transaction
  useEffect(() => {
    capture.monitoringMode = monitoringMode;
  }, [capture, monitoringMode]);

  // Sync monitor controls — direct property setters, no transaction needed
  useEffect(() => {
    capture.monitorVolumeDb = monitorVolumeDb;
  }, [capture, monitorVolumeDb]);

  useEffect(() => {
    capture.monitorPan = monitorPan;
  }, [capture, monitorPan]);

  useEffect(() => {
    capture.monitorMuted = monitorMuted;
  }, [capture, monitorMuted]);

  useEffect(() => {
    const deviceId = monitorOutputDeviceId === "default"
      ? Option.None
      : Option.wrap(monitorOutputDeviceId);
    capture.setMonitorOutputDevice(deviceId).catch((err) => {
      // Device unavailable (disconnected, permissions) — revert to system default
      console.debug(
        "[RecordingTapeCard] setMonitorOutputDevice failed, reverting to default: " +
          JSON.stringify(String(err))
      );
      setMonitorOutputDeviceId("default");
    });
  }, [capture, monitorOutputDeviceId]);

  const handleToggleArm = useCallback(() => {
    if (isArmed) {
      // Disarm: set armed to false directly
      capture.armed.setValue(false);
    } else {
      // Arm non-exclusively so other tapes stay armed
      project.captureDevices.setArm(capture, false);
    }
  }, [project, capture, isArmed]);

  const handleRemove = useCallback(() => {
    onRemove(tape.id);
  }, [onRemove, tape.id]);

  // Stricter than parseFloat: rejects trailing garbage ("12abc" → NaN, not 12).
  const parseStrictMs = (raw: string): number => {
    const trimmed = raw.trim();
    if (trimmed === "") return NaN;
    return Number(trimmed);
  };

  const handleInputLatencyModeChange = useCallback((mode: InputLatencyMode) => {
    if (mode === "inherit") {
      setInputLatencySec(InputLatency.Inherit);
    } else if (mode === "equals-output") {
      setInputLatencySec(InputLatency.EqualsOutput);
    } else {
      // Switching to custom — seed from draft (or 0 if no draft yet).
      const ms = parseStrictMs(inputLatencyMsDraft);
      setInputLatencySec(Number.isFinite(ms) ? Math.max(0, ms / 1000) : 0);
    }
  }, [inputLatencyMsDraft]);

  const commitInputLatencyMs = useCallback(() => {
    const ms = parseStrictMs(inputLatencyMsDraft);
    if (!Number.isFinite(ms)) {
      // Invalid draft → snap back to current committed value so the user sees the reject.
      const committedMs = inputLatencySec * 1000;
      if (modeFromValue(inputLatencySec) === "custom") {
        setInputLatencyMsDraft(committedMs.toFixed(2));
      }
      return;
    }
    // Typed custom input is always non-negative — sentinels are reached via the Select, not the field.
    setInputLatencySec(Math.max(0, ms / 1000));
  }, [inputLatencyMsDraft, inputLatencySec]);

  const applyReportedLatency = useCallback(() => {
    if (reportedTrackLatencyMs === null || !Number.isFinite(reportedTrackLatencyMs)) return;
    setInputLatencyMsDraft(reportedTrackLatencyMs.toFixed(2));
    setInputLatencySec(Math.max(0, reportedTrackLatencyMs / 1000));
  }, [reportedTrackLatencyMs]);

  return (
    <Card style={{ background: "var(--gray-2)" }}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Flex align="center" gap="2">
            <Text size="2" weight="bold">Tape {tapeIndex + 1}</Text>
            {isArmed && <Badge color="red" size="1">Capture armed</Badge>}
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

        <Flex direction="column" gap="2">
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="2" weight="medium" style={{ minWidth: 80 }}>Input Latency:</Text>
            <Select.Root
              value={inputLatencyMode}
              onValueChange={value => handleInputLatencyModeChange(value as InputLatencyMode)}
              disabled={disabled}
            >
              <Select.Trigger style={{ width: 180 }} />
              <Select.Content>
                <Select.Item value="inherit">Inherit project default</Select.Item>
                <Select.Item value="equals-output">Match outputLatency</Select.Item>
                <Select.Item value="custom">Custom</Select.Item>
              </Select.Content>
            </Select.Root>
            {inputLatencyMode === "custom" && (
              <TextField.Root
                type="number"
                step="0.1"
                value={inputLatencyMsDraft}
                onChange={e => setInputLatencyMsDraft(e.target.value)}
                onBlur={commitInputLatencyMs}
                onKeyDown={e => { if (e.key === "Enter") commitInputLatencyMs(); }}
                disabled={disabled}
                style={{ width: 110 }}
                aria-label="Custom input latency, milliseconds"
              >
                <TextField.Slot side="right">
                  <Text size="1" color="gray">ms</Text>
                </TextField.Slot>
              </TextField.Root>
            )}
          </Flex>
          {reportedTrackLatencyMs !== null && (
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="1" color="gray">
                Browser reported: <Code>{reportedTrackLatencyMs.toFixed(2)} ms</Code>
              </Text>
              <Button
                size="1"
                variant="soft"
                onClick={applyReportedLatency}
                disabled={disabled}
              >
                Use this value
              </Button>
            </Flex>
          )}
        </Flex>

        {monitoringMode !== "off" && (
          <>
            <Separator size="4" />
            <Flex direction="column" gap="3">
              <Flex align="center" gap="2">
                <Text size="2" weight="medium">Monitor</Text>
                <Button
                  size="1"
                  variant={monitorMuted ? "solid" : "soft"}
                  color={monitorMuted ? "orange" : "gray"}
                  onClick={() => setMonitorMuted(!monitorMuted)}
                >
                  {monitorMuted ? "Muted" : "Mute"}
                </Button>
              </Flex>

              <Flex align="center" gap="3">
                <Text size="2" weight="medium" style={{ minWidth: 80 }}>Volume:</Text>
                <Slider
                  value={[monitorVolumeDb + 60]}
                  onValueChange={values => setMonitorVolumeDb(values[0] - 60)}
                  min={0}
                  max={72}
                  step={0.5}
                  disabled={monitorMuted}
                  style={{ flex: 1 }}
                />
                <Text size="1" color="gray" style={{ minWidth: 55, fontFamily: "monospace" }}>
                  {monitorVolumeDb > 0 ? "+" : ""}{monitorVolumeDb.toFixed(1)} dB
                </Text>
              </Flex>

              <Flex align="center" gap="3">
                <Text size="2" weight="medium" style={{ minWidth: 80 }}>Pan:</Text>
                <Slider
                  value={[monitorPan * 50 + 50]}
                  onValueChange={values => setMonitorPan((values[0] - 50) / 50)}
                  min={0}
                  max={100}
                  step={1}
                  disabled={monitorMuted}
                  style={{ flex: 1 }}
                />
                <Text size="1" color="gray" style={{ minWidth: 55, fontFamily: "monospace" }}>
                  {monitorPan === 0 ? "C" : monitorPan < 0 ? `L${Math.round(Math.abs(monitorPan) * 100)}` : `R${Math.round(monitorPan * 100)}`}
                </Text>
              </Flex>

              {canSwitchOutput && audioOutputDevices.length > 0 && (
                <Flex align="center" gap="3">
                  <Text size="2" weight="medium" style={{ minWidth: 80 }}>Output:</Text>
                  <Select.Root
                    value={monitorOutputDeviceId}
                    onValueChange={setMonitorOutputDeviceId}
                  >
                    <Select.Trigger style={{ flex: 1 }} />
                    <Select.Content>
                      <Select.Item value="default">System Default</Select.Item>
                      {audioOutputDevices.map(device => (
                        <Select.Item key={device.deviceId} value={device.deviceId}>
                          {device.label || `Output ${device.deviceId.slice(0, 8)}...`}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
              )}
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
};
