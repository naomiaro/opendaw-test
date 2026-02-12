import React from "react";
import { Flex, Text, TextField, Select } from "@radix-ui/themes";

interface TimeSignatureControlProps {
  numerator: number;
  denominator: number;
  onNumeratorChange: (value: number) => void;
  onDenominatorChange: (value: number) => void;
  disabled?: boolean;
}

export const TimeSignatureControl: React.FC<TimeSignatureControlProps> = React.memo(
  ({ numerator, denominator, onNumeratorChange, onDenominatorChange, disabled = false }) => (
    <Flex align="center" gap="2">
      <Text size="2" weight="medium">Time Signature:</Text>
      <Flex align="center" gap="1">
        <TextField.Root
          type="number"
          value={numerator.toString()}
          onChange={e => onNumeratorChange(Number(e.target.value))}
          disabled={disabled}
          style={{ width: 60 }}
        />
        <Text size="3" color="gray" weight="bold">/</Text>
        <Select.Root
          value={denominator.toString()}
          onValueChange={value => onDenominatorChange(Number(value))}
          disabled={disabled}
        >
          <Select.Trigger style={{ width: 70 }} />
          <Select.Content>
            <Select.Item value="2">2</Select.Item>
            <Select.Item value="4">4</Select.Item>
            <Select.Item value="8">8</Select.Item>
            <Select.Item value="16">16</Select.Item>
          </Select.Content>
        </Select.Root>
      </Flex>
    </Flex>
  )
);

TimeSignatureControl.displayName = "TimeSignatureControl";
