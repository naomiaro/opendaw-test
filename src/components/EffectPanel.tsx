import React, { useState } from "react";
import { Button, Flex, Text, Badge, Card, Slider, Select } from "@radix-ui/themes";
import { Project } from "@moises-ai/studio-core";
import type { EffectPreset } from "../lib/effectPresets";

const PresetSelector: React.FC<{
  presets: EffectPreset<any>[];
  onPresetChange: (preset: EffectPreset<any>) => void;
}> = ({ presets, onPresetChange }) => {
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        Presets
      </Text>
      <Select.Root
        value={selectedPreset}
        onValueChange={presetName => {
          setSelectedPreset(presetName);
          const preset = presets.find(p => p.name === presetName);
          if (preset) onPresetChange(preset);
        }}
      >
        <Select.Trigger placeholder="Load a preset...">
          <Flex as="span" align="center">
            {selectedPreset ? presets.find(p => p.name === selectedPreset)?.name : "Load a preset..."}
          </Flex>
        </Select.Trigger>
        <Select.Content position="popper">
          {presets.map(preset => (
            <Select.Item key={preset.name} value={preset.name} style={{ padding: "12px 36px", minHeight: "60px" }}>
              <Flex direction="column" gap="1">
                <Text weight="medium">{preset.name}</Text>
                <Text size="1" color="gray">
                  {preset.description}
                </Text>
              </Flex>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
};

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
  isBypassed?: boolean;
  onBypass?: () => void;
  parameters?: EffectParameter[];
  onParameterChange?: (paramName: string, value: number) => void;
  project?: Project;
  badgeText?: string;
  presets?: EffectPreset<any>[];
  onPresetChange?: (preset: EffectPreset<any>) => void;
  accentColor?: string;
}

export const EffectPanel: React.FC<EffectPanelProps> = ({
  title,
  description,
  isActive,
  onToggle,
  isBypassed = false,
  onBypass,
  parameters = [],
  onParameterChange,
  badgeText,
  presets,
  onPresetChange,
  accentColor = "purple"
}) => {
  return (
    <Card
      variant="surface"
      style={{
        border: "2px solid var(--gray-6)",
        borderLeft: `4px solid var(--${accentColor}-9)`,
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)"
      }}
    >
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Flex direction="column" gap="1">
            <Text weight="bold" size="3">
              {title}
            </Text>
            <Text size="2" color="gray">
              {description}
            </Text>
          </Flex>
          {!isActive ? (
            <Button color="purple" onClick={onToggle}>
              + Add
            </Button>
          ) : (
            <Flex gap="2">
              {onBypass && (
                <Button color={isBypassed ? "gray" : "green"} variant="soft" onClick={onBypass}>
                  {isBypassed ? "Bypassed" : "Active"}
                </Button>
              )}
              <Button color="red" onClick={onToggle}>
                × Remove
              </Button>
            </Flex>
          )}
        </Flex>

        {isActive && (
          <>
            {badgeText && <Badge color="purple">{badgeText}</Badge>}

            {/* Preset Selector */}
            {presets && presets.length > 0 && onPresetChange && (
              <PresetSelector presets={presets} onPresetChange={onPresetChange} />
            )}

            {/* Parameter controls */}
            {parameters.length > 0 && onParameterChange && (
              <Flex direction="column" gap="3" style={{ marginTop: "8px" }}>
                {parameters.map(param => (
                  <Flex key={param.name} direction="column" gap="1">
                    <Flex justify="between" align="center">
                      <Text size="2" weight="medium">
                        {param.label}
                      </Text>
                      <Text size="2" color="gray">
                        {param.format
                          ? param.format(param.value)
                          : `${param.value.toFixed(param.step < 1 ? 2 : 0)}${param.unit || ""}`}
                      </Text>
                    </Flex>
                    <Slider
                      value={[param.value]}
                      onValueChange={values => onParameterChange(param.name, values[0])}
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
