import React from "react";
import { Button, Flex, Text, Badge, Card, Slider } from "@radix-ui/themes";
import { Project } from "@opendaw/studio-core";

export type EffectParameter = {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (value: number) => string;
};

interface EffectPanelProps {
  title: string;
  description: string;
  isActive: boolean;
  onToggle: () => void;
  parameters?: EffectParameter[];
  onParameterChange?: (paramName: string, value: number) => void;
  project?: Project;
  badgeText?: string;
}

export const EffectPanel: React.FC<EffectPanelProps> = ({
  title,
  description,
  isActive,
  onToggle,
  parameters = [],
  onParameterChange,
  badgeText
}) => {
  return (
    <Card variant="surface">
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Flex direction="column" gap="1">
            <Text weight="bold">{title}</Text>
            <Text size="2" color="gray">
              {description}
            </Text>
          </Flex>
          <Button
            color={isActive ? "red" : "purple"}
            onClick={onToggle}
          >
            {isActive ? "− Remove" : "+ Add"}
          </Button>
        </Flex>

        {isActive && (
          <>
            {badgeText && (
              <Badge color="purple">{badgeText}</Badge>
            )}

            {/* Parameter controls */}
            {parameters.length > 0 && onParameterChange && (
              <Flex direction="column" gap="3" style={{ marginTop: "8px" }}>
                {parameters.map(param => (
                  <Flex key={param.name} direction="column" gap="1">
                    <Flex justify="between" align="center">
                      <Text size="2" weight="medium">{param.label}</Text>
                      <Text size="2" color="gray">
                        {param.format
                          ? param.format(param.value)
                          : `${param.value.toFixed(param.step < 1 ? 2 : 0)}${param.unit || ''}`
                        }
                      </Text>
                    </Flex>
                    <Slider
                      value={[param.value]}
                      onValueChange={(values) => onParameterChange(param.name, values[0])}
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      style={{ width: "100%" }}
                    />
                  </Flex>
                ))}
              </Flex>
            )}
          </>
        )}
      </Flex>
    </Card>
  );
};
