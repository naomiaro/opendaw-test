import React from "react";
import { Flex, Text, Checkbox } from "@radix-ui/themes";

interface RecordingPreferencesProps {
  useCountIn: boolean;
  onUseCountInChange: (value: boolean) => void;
  metronomeEnabled: boolean | undefined;
  onMetronomeEnabledChange: (value: boolean) => void;
  disabled?: boolean;
  /** Hide the metronome checkbox when the page owns its own click control. */
  showMetronome?: boolean;
}

export const RecordingPreferences: React.FC<RecordingPreferencesProps> = React.memo(
  ({ useCountIn, onUseCountInChange, metronomeEnabled, onMetronomeEnabledChange, disabled = false, showMetronome = true }) => (
    <Flex gap="5" wrap="wrap" align="center">
      <Flex asChild align="center" gap="2">
        <Text as="label" size="2">
          <Checkbox checked={useCountIn} onCheckedChange={c => onUseCountInChange(c === true)} disabled={disabled} />
          Count-in
        </Text>
      </Flex>
      {showMetronome && (
        <Flex asChild align="center" gap="2">
          <Text as="label" size="2">
            <Checkbox
              checked={metronomeEnabled ?? false}
              onCheckedChange={c => onMetronomeEnabledChange(c === true)}
              disabled={disabled}
            />
            Metronome
          </Text>
        </Flex>
      )}
    </Flex>
  )
);

RecordingPreferences.displayName = "RecordingPreferences";
