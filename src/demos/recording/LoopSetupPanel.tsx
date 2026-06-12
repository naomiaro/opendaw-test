import React from "react";
import { Card, Flex, Select, Text } from "@radix-ui/themes";
import { BpmControl } from "@/components/BpmControl";
import { RecordingPreferences } from "@/components/RecordingPreferences";

interface LoopSetupPanelProps {
  bpm: number;
  onBpmChange: (value: number) => void;
  leadInBars: number;
  onLeadInBarsChange: (value: number) => void;
  loopLengthBars: number;
  onLoopLengthBarsChange: (value: number) => void;
  useCountIn: boolean;
  onUseCountInChange: (value: boolean) => void;
  metronomeEnabled: boolean | undefined;
  onMetronomeEnabledChange: (value: boolean) => void;
  disabled: boolean;
}

/** Setup card: BPM, pre-loop lead-in, loop length, count-in/metronome prefs. */
export const LoopSetupPanel: React.FC<LoopSetupPanelProps> = ({
  bpm,
  onBpmChange,
  leadInBars,
  onLeadInBarsChange,
  loopLengthBars,
  onLoopLengthBarsChange,
  useCountIn,
  onUseCountInChange,
  metronomeEnabled,
  onMetronomeEnabledChange,
  disabled,
}) => {
  const totalBars = leadInBars + loopLengthBars;

  return (
    <Card>
      <Flex direction="column" gap="4">
        <Text size="2" weight="bold" color="gray">
          Setup
        </Text>
        <Flex gap="4" wrap="wrap" align="center">
          <BpmControl value={bpm} onChange={onBpmChange} disabled={disabled} />
          <Flex align="center" gap="2">
            <Text size="2" weight="medium">
              Lead-in:
            </Text>
            <Select.Root
              value={leadInBars.toString()}
              onValueChange={(v) => onLeadInBarsChange(Number(v))}
              disabled={disabled}
            >
              <Select.Trigger style={{ width: 100 }} />
              <Select.Content>
                <Select.Item value="0">None</Select.Item>
                <Select.Item value="1">1 bar</Select.Item>
                <Select.Item value="2">2 bars</Select.Item>
                <Select.Item value="3">3 bars</Select.Item>
                <Select.Item value="4">4 bars</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex align="center" gap="2">
            <Text size="2" weight="medium">
              Loop Length:
            </Text>
            <Select.Root
              value={loopLengthBars.toString()}
              onValueChange={(v) => onLoopLengthBarsChange(Number(v))}
              disabled={disabled}
            >
              <Select.Trigger style={{ width: 100 }} />
              <Select.Content>
                <Select.Item value="1">1 bar</Select.Item>
                <Select.Item value="2">2 bars</Select.Item>
                <Select.Item value="4">4 bars</Select.Item>
                <Select.Item value="8">8 bars</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
          <RecordingPreferences
            useCountIn={useCountIn}
            onUseCountInChange={onUseCountInChange}
            metronomeEnabled={metronomeEnabled}
            onMetronomeEnabledChange={onMetronomeEnabledChange}
          />
        </Flex>
        {leadInBars > 0 && (
          <Text size="1" color="gray">
            Take 1 records from bar 1 through bar {totalBars} ({leadInBars} bar
            lead-in + {loopLengthBars} bar loop). Subsequent takes record only
            the {loopLengthBars}-bar loop region.
          </Text>
        )}
      </Flex>
    </Card>
  );
};
