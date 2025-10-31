import React from "react";
import { Flex, Heading, Separator, Callout, Text } from "@radix-ui/themes";

interface EffectsSectionProps {
  children: React.ReactNode;
}

export const EffectsSection: React.FC<EffectsSectionProps> = ({ children }) => {
  return (
    <Flex direction="column" gap="4">
      <Heading size="4">Audio Effects</Heading>
      <Separator size="4" />

      <Callout.Root color="purple">
        <Callout.Text>
          ✨ Add professional audio effects and adjust their parameters in real-time!
          Try tweaking the knobs while the music is playing to hear the changes.
        </Callout.Text>
      </Callout.Root>

      {children}

      <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
        💡 Tip: Adjust effect parameters while playback is active to hear the changes in real-time!
      </Text>
    </Flex>
  );
};
