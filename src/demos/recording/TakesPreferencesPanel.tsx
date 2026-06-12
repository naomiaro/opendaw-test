import React from "react";
import { Card, Checkbox, Flex, Select, Text } from "@radix-ui/themes";
import { EngineSettings } from "@opendaw/studio-adapters";

// Derived from the SDK's allowed-value constants — stays in sync with the schema
export type OlderTakeAction =
  (typeof EngineSettings.OlderTakeActionOptions)[number];
export type OlderTakeScope =
  (typeof EngineSettings.OlderTakeScopeOptions)[number];

interface TakesPreferencesPanelProps {
  allowTakes: boolean;
  onAllowTakesChange: (value: boolean) => void;
  olderTakeAction: OlderTakeAction;
  onOlderTakeActionChange: (value: OlderTakeAction) => void;
  olderTakeScope: OlderTakeScope;
  onOlderTakeScopeChange: (value: OlderTakeScope) => void;
  disabled: boolean;
}

/** Takes preferences card: allowTakes, olderTakeAction, olderTakeScope. */
export const TakesPreferencesPanel: React.FC<TakesPreferencesPanelProps> = ({
  allowTakes,
  onAllowTakesChange,
  olderTakeAction,
  onOlderTakeActionChange,
  olderTakeScope,
  onOlderTakeScopeChange,
  disabled,
}) => (
  <Card>
    <Flex direction="column" gap="4">
      <Text size="2" weight="bold" color="gray">
        Takes Preferences
      </Text>
      <Flex gap="4" wrap="wrap" align="center">
        <Flex asChild align="center" gap="2">
          <Text as="label" size="2">
            <Checkbox
              checked={allowTakes}
              onCheckedChange={(c) => onAllowTakesChange(c === true)}
              disabled={disabled}
            />
            Allow takes (loop recording)
          </Text>
        </Flex>
        <Flex align="center" gap="2">
          <Text size="2" weight="medium">
            Older Take Action:
          </Text>
          <Select.Root
            value={olderTakeAction}
            onValueChange={(v) => onOlderTakeActionChange(v as OlderTakeAction)}
            disabled={disabled}
          >
            <Select.Trigger style={{ width: 150 }} />
            <Select.Content>
              <Select.Item value="mute-region">Mute Region</Select.Item>
              <Select.Item value="disable-track">Disable Track</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex align="center" gap="2">
          <Text size="2" weight="medium">
            Scope:
          </Text>
          <Select.Root
            value={olderTakeScope}
            onValueChange={(v) => onOlderTakeScopeChange(v as OlderTakeScope)}
            disabled={disabled}
          >
            <Select.Trigger style={{ width: 150 }} />
            <Select.Content>
              <Select.Item value="previous-only">Previous Only</Select.Item>
              <Select.Item value="all">All Previous</Select.Item>
              <Select.Item value="none">None</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>
      <Text size="1" color="gray">
        {olderTakeScope === "previous-only"
          ? "Only the most recent take is affected when a new take is recorded. Use this for layering — unmute an older take and it stays audible through subsequent recordings."
          : olderTakeScope === "all"
            ? "All older takes are affected each time a new take is recorded. Use this for comping — keeps a clean slate so you only hear the latest take."
            : "Older takes are left untouched — every take stays audible as recorded. Mute takes manually in the timeline below."}
      </Text>
    </Flex>
  </Card>
);
