import React, { useState, memo } from "react";
import { Flex, Text, Select, Button, Separator } from "@radix-ui/themes";
import { EffectPanel } from "./EffectPanel";

export type EffectType = "Reverb" | "Compressor" | "Delay" | "Crusher" | "StereoWidth" | "EQ" | "Fold";

export interface EffectInstance {
  id: string;
  type: EffectType;
  label: string;
  accentColor?: string;
}

interface EffectChainProps {
  trackName: string;
  effects: EffectInstance[];
  onAddEffect: (type: EffectType) => void;
  onRemoveEffect: (id: string) => void;
  renderEffect: (effect: EffectInstance) => React.ReactNode;
}

export const EffectChain: React.FC<EffectChainProps> = memo(
  ({ trackName, effects, onAddEffect, onRemoveEffect, renderEffect }) => {
    const [selectedEffectType, setSelectedEffectType] = useState<string>("");

    const handleAddEffect = () => {
      if (selectedEffectType) {
        onAddEffect(selectedEffectType as EffectType);
        setSelectedEffectType(""); // Reset selection
      }
    };

    return (
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="2">
          <Text size="3" weight="bold">
            {trackName}
          </Text>

          {effects.length === 0 && (
            <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
              No effects added
            </Text>
          )}

          <Flex direction="column" gap="3">
            {effects.map(effect => (
              <div key={effect.id}>{renderEffect(effect)}</div>
            ))}
          </Flex>
        </Flex>

        <Separator size="4" />

        <Flex gap="2" align="center">
          <Select.Root value={selectedEffectType} onValueChange={setSelectedEffectType}>
            <Select.Trigger placeholder="Choose effect..." style={{ flex: 1 }} />
            <Select.Content>
              <Select.Item value="Reverb">Reverb</Select.Item>
              <Select.Item value="Compressor">Compressor</Select.Item>
              <Select.Item value="EQ">Parametric EQ</Select.Item>
              <Select.Item value="Delay">Delay</Select.Item>
              <Select.Item value="Crusher">Lo-Fi Crusher</Select.Item>
              <Select.Item value="Fold">Wavefolder</Select.Item>
              <Select.Item value="StereoWidth">Stereo Width</Select.Item>
            </Select.Content>
          </Select.Root>
          <Button onClick={handleAddEffect} disabled={!selectedEffectType} color="purple">
            + Add Effect
          </Button>
        </Flex>
      </Flex>
    );
  }
);

EffectChain.displayName = "EffectChain";
