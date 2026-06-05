import React, { useEffect, useRef, useState } from "react";
import { Card, Flex, Text, Heading, TextField, Button, Callout, Code, Link, Separator } from "@radix-ui/themes";

interface InputLatencyPanelProps {
  audioContext: AudioContext;
  /** Engine preference `recording.inputLatency` in seconds (from useEnginePreference). */
  inputLatencySec: number | undefined;
  /** Setter from useEnginePreference. SDK validates `value >= -1`. */
  onInputLatencySecChange: (seconds: number) => void;
  disabled?: boolean;
}

const formatMs = (seconds: number): string => `${(seconds * 1000).toFixed(2)} ms`;

export const InputLatencyPanel: React.FC<InputLatencyPanelProps> = ({
  audioContext,
  inputLatencySec,
  onInputLatencySecChange,
  disabled = false
}) => {
  // outputLatency can drift (browser remeasures); poll on AnimationFrame for live display.
  const [outputLatencySec, setOutputLatencySec] = useState<number>(() => audioContext.outputLatency ?? 0);
  const [baseLatencySec] = useState<number>(() => audioContext.baseLatency ?? 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      setOutputLatencySec(audioContext.outputLatency ?? 0);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [audioContext]);

  // Local state for the millisecond text inputs (so partial typing isn't fought by the SDK round-trip).
  const [inputLatencyMsDraft, setInputLatencyMsDraft] = useState<string>("");
  const [roundtripMsDraft, setRoundtripMsDraft] = useState<string>("");

  useEffect(() => {
    if (inputLatencySec === undefined) return;
    // Only overwrite the draft when external value changes and differs meaningfully from what's typed.
    const parsedDraft = parseFloat(inputLatencyMsDraft);
    const currentMs = inputLatencySec * 1000;
    if (Number.isNaN(parsedDraft) || Math.abs(parsedDraft - currentMs) > 0.01) {
      setInputLatencyMsDraft(currentMs.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputLatencySec]);

  const commitInputLatencyMs = () => {
    const ms = parseFloat(inputLatencyMsDraft);
    if (Number.isNaN(ms)) return;
    const seconds = ms / 1000;
    // SDK constraint: value must be >= -1. Allow exactly -1 for "equals output latency" sentinel.
    const clamped = Math.max(-1, seconds);
    onInputLatencySecChange(clamped);
  };

  const deriveInputLatencyFromRoundtrip = () => {
    const roundtripMs = parseFloat(roundtripMsDraft);
    if (Number.isNaN(roundtripMs)) return;
    // inputLatency = roundtrip - outputLatency (paper: roundtrip = input + output)
    const inputMs = Math.max(0, roundtripMs - outputLatencySec * 1000);
    setInputLatencyMsDraft(inputMs.toFixed(2));
    onInputLatencySecChange(inputMs / 1000);
  };

  const useEqualsOutputSentinel = () => {
    setInputLatencyMsDraft((-1 * 1000).toFixed(2));
    onInputLatencySecChange(-1);
  };

  const resetToZero = () => {
    setInputLatencyMsDraft("0.00");
    onInputLatencySecChange(0);
  };

  const isEqualsOutputSentinel = inputLatencySec !== undefined && inputLatencySec < 0;
  const appliedMsWhenSentinel = outputLatencySec * 1000;

  return (
    <Card>
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1">
          <Heading size="5">Input Latency Compensation</Heading>
          <Text size="2" color="gray">
            Pushes the recorded waveform's start offset deeper into the capture buffer so playback lines up
            with what you heard. Only the mic→engine portion — the engine already compensates the engine→speaker
            half automatically via <Code>audioContext.outputLatency</Code>.
          </Text>
        </Flex>

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">Browser-reported latencies (read-only)</Text>
          <Flex gap="4" wrap="wrap">
            <Flex direction="column">
              <Text size="1" color="gray">outputLatency (live)</Text>
              <Code size="2">{formatMs(outputLatencySec)}</Code>
            </Flex>
            <Flex direction="column">
              <Text size="1" color="gray">baseLatency</Text>
              <Code size="2">{formatMs(baseLatencySec)}</Code>
            </Flex>
          </Flex>
          <Text size="1" color="gray">
            Per-input-device latency (browser-reported) is logged at recording start as{" "}
            <Code>inputLatencyReported</Code> in the <Code>[CaptureAudio] latency report</Code> debug line.
            It is not auto-applied — set the value below to compensate.
          </Text>
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">Project default input latency</Text>
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              type="number"
              step="0.1"
              value={inputLatencyMsDraft}
              onChange={e => setInputLatencyMsDraft(e.target.value)}
              onBlur={commitInputLatencyMs}
              onKeyDown={e => { if (e.key === "Enter") commitInputLatencyMs(); }}
              disabled={disabled}
              style={{ width: 110 }}
              aria-label="Project default input latency, milliseconds"
            >
              <TextField.Slot side="right">
                <Text size="1" color="gray">ms</Text>
              </TextField.Slot>
            </TextField.Root>
            <Button size="1" variant="soft" onClick={resetToZero} disabled={disabled}>
              Reset to 0
            </Button>
            <Button
              size="1"
              variant={isEqualsOutputSentinel ? "solid" : "soft"}
              color={isEqualsOutputSentinel ? "blue" : "gray"}
              onClick={useEqualsOutputSentinel}
              disabled={disabled}
            >
              Use −1 (= outputLatency)
            </Button>
            {isEqualsOutputSentinel && (
              <Text size="1" color="gray">
                Applied: {formatMs(appliedMsWhenSentinel / 1000)} (mirrors outputLatency)
              </Text>
            )}
          </Flex>
          <Text size="1" color="gray">
            Stored as seconds on <Code>engine.preferences.settings.recording.inputLatency</Code>.
            Per-tape override below.
          </Text>
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">Measured roundtrip → input latency helper</Text>
          <Text size="1" color="gray">
            If you measured your roundtrip with an MLS-based tool (e.g.{" "}
            <Link href="https://github.com/gilpanal/weblatencytest" target="_blank" rel="noopener noreferrer">
              gilpanal/weblatencytest
            </Link>
            ), enter the measured value below and we'll subtract <Code>outputLatency</Code> for you. Method
            and reference numbers (Firefox/Chrome/Safari × Ubuntu/Windows/macOS, range ≈ 39–105 ms) are
            in Gil&nbsp;Panal et&nbsp;al., WAC&nbsp;2025 —{" "}
            <Link
              href="https://zenodo.org/records/17642262"
              target="_blank"
              rel="noopener noreferrer"
            >
              zenodo:17642262
            </Link>
            .
          </Text>
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              type="number"
              step="0.1"
              placeholder="Measured roundtrip"
              value={roundtripMsDraft}
              onChange={e => setRoundtripMsDraft(e.target.value)}
              disabled={disabled}
              style={{ width: 160 }}
              aria-label="Measured roundtrip latency, milliseconds"
            >
              <TextField.Slot side="right">
                <Text size="1" color="gray">ms</Text>
              </TextField.Slot>
            </TextField.Root>
            <Button
              size="1"
              variant="solid"
              onClick={deriveInputLatencyFromRoundtrip}
              disabled={disabled || roundtripMsDraft.trim() === ""}
            >
              Apply (subtract outputLatency)
            </Button>
          </Flex>
        </Flex>

        <Callout.Root color="amber" size="1">
          <Callout.Text>
            For accurate measurement, the source tool should disable browser audio constraints
            (<Code>echoCancellation</Code>, <Code>noiseSuppression</Code>, <Code>autoGainControl</Code>)
            and avoid Bluetooth devices. See the paper's Section 3 for full constraints.
          </Callout.Text>
        </Callout.Root>
      </Flex>
    </Card>
  );
};
