import React, { useEffect, useRef, useState } from "react";
import { Card, Flex, Text, Heading, TextField, Button, Code, Link } from "@radix-ui/themes";
import { InputLatency } from "@opendaw/studio-core";

interface InputLatencyPanelProps {
  audioContext: AudioContext;
  /** Engine preference `recording.inputLatency` in seconds (from useEnginePreference). */
  inputLatencySec: number | undefined;
  /** Setter from useEnginePreference. SDK validates `value >= -1`. */
  onInputLatencySecChange: (seconds: number) => void;
  disabled?: boolean;
}

const PROSE_WIDTH = 560;
const formatMs = (seconds: number): string => `${(seconds * 1000).toFixed(2)} ms`;

interface StatProps { label: string; value: string }
const Stat: React.FC<StatProps> = ({ label, value }) => (
  <Flex direction="column" gap="1" style={{ minWidth: 130 }}>
    <Text
      size="1"
      color="gray"
      style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
    >
      {label}
    </Text>
    <Code size="3" variant="ghost" style={{ fontVariantNumeric: "tabular-nums" }}>
      {value}
    </Code>
  </Flex>
);

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
    // A local `cancelled` flag prevents a re-armed tick from outliving the effect cleanup
    // under React StrictMode's double-mount in dev. Pattern mirrors RecordingTapeCard.tsx.
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setOutputLatencySec(audioContext.outputLatency ?? 0);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [audioContext]);

  // Local string state for the millisecond inputs so partial typing isn't fought by the SDK round-trip.
  const [inputLatencyMsDraft, setInputLatencyMsDraft] = useState<string>("");
  const [roundtripMsDraft, setRoundtripMsDraft] = useState<string>("");

  // Sync the millisecond draft from the engine preference. inputLatencyMsDraft is intentionally
  // omitted from deps — including it would loop (draft change → effect → clobber). The
  // `Math.abs > 0.01` guard tolerates small typing drift without overwriting the user's input.
  // Skip the sync entirely while the sentinel is active so the draft doesn't get clobbered with
  // "-1000.00" and surface stale data when the user switches back to a typed value.
  useEffect(() => {
    if (inputLatencySec === undefined) return;
    if (inputLatencySec === InputLatency.EqualsOutput) return;
    const parsedDraft = parseFloat(inputLatencyMsDraft);
    const currentMs = inputLatencySec * 1000;
    if (Number.isNaN(parsedDraft) || Math.abs(parsedDraft - currentMs) > 0.01) {
      setInputLatencyMsDraft(currentMs.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputLatencySec]);

  // Stricter than parseFloat: rejects trailing garbage ("12abc" → NaN, not 12). Empty string
  // is treated as invalid even though Number("") === 0, because an empty field on blur means
  // "user cleared this — keep the committed value", not "set it to zero".
  const parseStrictMs = (raw: string): number => {
    const trimmed = raw.trim();
    if (trimmed === "") return NaN;
    return Number(trimmed);
  };

  // Snap the draft back to the committed value so an invalid blur visibly reverts.
  const revertDraft = () => {
    if (inputLatencySec === undefined) return;
    setInputLatencyMsDraft((inputLatencySec * 1000).toFixed(2));
  };

  const commitInputLatencyMs = () => {
    const ms = parseStrictMs(inputLatencyMsDraft);
    if (!Number.isFinite(ms)) { revertDraft(); return; }
    // Typed values are always non-negative. The −1 sentinel is reached only via the dedicated
    // button below — clamping typed input to 0 prevents accidental sentinel activation
    // (e.g. typing −2.5 silently flipping into "= outputLatency" mode).
    const clampedSec = Math.max(0, ms / 1000);
    // Reflect the clamp in the draft so the user sees what was actually committed. The
    // draft-sync effect can't always do this — if the engine pref was already at the clamped
    // value (e.g. 0), `inputLatencySec` doesn't change and the effect never fires.
    setInputLatencyMsDraft((clampedSec * 1000).toFixed(2));
    onInputLatencySecChange(clampedSec);
  };

  const deriveInputLatencyFromRoundtrip = () => {
    const rt = parseStrictMs(roundtripMsDraft);
    if (!Number.isFinite(rt)) return;
    // inputLatency = roundtrip - outputLatency  (per Gil Panal et al., roundtrip = input + output)
    const inputMs = Math.max(0, rt - outputLatencySec * 1000);
    setInputLatencyMsDraft(inputMs.toFixed(2));
    onInputLatencySecChange(inputMs / 1000);
  };

  const useEqualsOutputSentinel = () => {
    onInputLatencySecChange(InputLatency.EqualsOutput);
  };

  const resetToZero = () => {
    onInputLatencySecChange(0);
  };

  const isEqualsOutputSentinel = inputLatencySec === InputLatency.EqualsOutput;
  // What the SDK will actually feed into `RecordAudio` right now. Use the SDK resolver so the
  // panel stays in lock-step with the SDK's precedence logic — no local re-implementation drift.
  const appliedMs = inputLatencySec === undefined
    ? 0
    : InputLatency.resolve(InputLatency.Inherit, inputLatencySec, outputLatencySec) * 1000;

  return (
    <Card>
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1" style={{ maxWidth: PROSE_WIDTH }}>
          <Heading size="5">Input Latency Compensation</Heading>
          <Text size="2" color="gray">
            Shifts each take's <Code size="1">waveformOffset</Code> to absorb the mic → engine delay
            your input adds. The engine → speaker side is already handled by{" "}
            <Code size="1">audioContext.outputLatency</Code>.
          </Text>
        </Flex>

        <Flex gap="6" wrap="wrap" align="end">
          <Stat label="outputLatency (live)" value={formatMs(outputLatencySec)} />
          <Stat label="baseLatency" value={formatMs(baseLatencySec)} />
          <Stat label="currently applied" value={formatMs(appliedMs / 1000)} />
        </Flex>

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">Project default</Text>
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              type="number"
              step="0.1"
              value={isEqualsOutputSentinel ? "" : inputLatencyMsDraft}
              onChange={e => setInputLatencyMsDraft(e.target.value)}
              onBlur={commitInputLatencyMs}
              onKeyDown={e => { if (e.key === "Enter") commitInputLatencyMs(); }}
              disabled={disabled || isEqualsOutputSentinel}
              placeholder={isEqualsOutputSentinel ? "(sentinel −1)" : "0.00"}
              style={{ width: 130 }}
              aria-label="Project default input latency, milliseconds"
            >
              <TextField.Slot side="right">
                <Text size="1" color="gray">ms</Text>
              </TextField.Slot>
            </TextField.Root>
            <Button size="2" variant="soft" color="gray" onClick={resetToZero} disabled={disabled}>
              0 ms
            </Button>
            <Button
              size="2"
              variant={isEqualsOutputSentinel ? "solid" : "soft"}
              color={isEqualsOutputSentinel ? "blue" : "gray"}
              onClick={useEqualsOutputSentinel}
              disabled={disabled}
            >
              = outputLatency
            </Button>
          </Flex>
          <Text size="1" color="gray" style={{ maxWidth: PROSE_WIDTH }}>
            {isEqualsOutputSentinel
              ? <>Sentinel −1: live <Code size="1">outputLatency</Code> ({formatMs(outputLatencySec)}) is mirrored every recording.</>
              : <>Stored as seconds on <Code size="1">engine.preferences.settings.recording.inputLatency</Code>. Tapes can override below.</>}
          </Text>
        </Flex>

        <Flex direction="column" gap="2" style={{ maxWidth: PROSE_WIDTH }}>
          <Text size="2" weight="medium" color="gray">From a measured roundtrip</Text>
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              type="number"
              step="0.1"
              placeholder="roundtrip"
              value={roundtripMsDraft}
              onChange={e => setRoundtripMsDraft(e.target.value)}
              disabled={disabled}
              style={{ width: 130 }}
              aria-label="Measured roundtrip latency, milliseconds"
            >
              <TextField.Slot side="right">
                <Text size="1" color="gray">ms</Text>
              </TextField.Slot>
            </TextField.Root>
            <Button
              size="2"
              variant="soft"
              onClick={deriveInputLatencyFromRoundtrip}
              disabled={disabled || roundtripMsDraft.trim() === ""}
            >
              − outputLatency → input
            </Button>
          </Flex>
          <Text size="1" color="gray">
            Measure with{" "}
            <Link href="https://github.com/gilpanal/weblatencytest" target="_blank" rel="noopener noreferrer">
              weblatencytest
            </Link>{" "}
            (MLS); reference numbers and method in{" "}
            <Link href="https://zenodo.org/records/17642262" target="_blank" rel="noopener noreferrer">
              Gil Panal et al., WAC 2025
            </Link>
            . Disable echo cancel / noise suppression / AGC before measuring.
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
};
