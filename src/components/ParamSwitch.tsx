import React from "react";
import { Flex, Switch, Text } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { useParameterUnit, type UnitParameter } from "@/hooks/useParameterUnit";

export interface ParamSwitchProps {
  project: Pick<Project, "editing">;
  parameter: UnitParameter;
  label: string;
}

/**
 * Labelled switch bound to a boolean parameter, the readout printed by the
 * parameter's own string mapping ("On" / "Off"). The SDK's bool mapping reads
 * a unit of 0.5 or above as on, so the switch writes 1 or 0.
 */
export const ParamSwitch: React.FC<ParamSwitchProps> = ({ project, parameter, label }) => {
  const [unit, print, write] = useParameterUnit(project, parameter);
  return (
    <Flex direction="column" gap="1" flexGrow="1" style={{ minWidth: 0 }}>
      <Flex justify="between" gap="2">
        <Text size="1" color="gray">{label}</Text>
        <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{print}</Text>
      </Flex>
      <Flex align="center" style={{ height: 20 }}>
        <Switch size="1" checked={unit >= 0.5} onCheckedChange={(on) => write(on ? 1 : 0)} aria-label={label} />
      </Flex>
    </Flex>
  );
};
