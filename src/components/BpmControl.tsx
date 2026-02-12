import React from "react";
import { Flex, Text, TextField } from "@radix-ui/themes";

interface BpmControlProps {
  value: number;
  onChange: (bpm: number) => void;
  disabled?: boolean;
}

export const BpmControl: React.FC<BpmControlProps> = React.memo(({ value, onChange, disabled = false }) => (
  <Flex align="center" gap="2">
    <Text size="2" weight="medium">BPM:</Text>
    <TextField.Root
      type="number"
      value={value.toString()}
      onChange={e => onChange(Number(e.target.value))}
      disabled={disabled}
      style={{ width: 80 }}
    />
  </Flex>
));

BpmControl.displayName = "BpmControl";
