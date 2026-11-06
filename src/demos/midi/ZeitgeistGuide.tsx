/**
 * Under the Zeitgeist's controls: a sentence while the settings move nothing on this pattern, and settings to try where the
 * swing is plain. Follows the groove through the parameters' own observers, so a slider and an undo reach it alike.
 */
import React, { useEffect, useState } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import type { GrooveShuffleBoxAdapter } from "@opendaw/studio-adapters";
import type { Editing } from "@opendaw/lib-std";
import { observeParameter } from "@/lib/parameterBinding";
import type { Pattern, PatternId } from "@/lib/midiEffects/patterns";
import { applyZeitgeistTry, STILLNESS_SENTENCE, stillnessOf, SWITCHED_OFF_SENTENCE, ZEITGEIST_TRIES } from "@/lib/midiEffects/zeitgeistGuide";

export interface ZeitgeistGuideProps {
  editing: Editing;
  shuffle: GrooveShuffleBoxAdapter;
  /** The notes in the region, as the engine plays them (the Rendered page's are gapped). */
  pattern: Pattern;
  onPatternChange(id: PatternId): void;
  enabled: boolean;
  onEnabledChange(enabled: boolean): void;
}

export const ZeitgeistGuide: React.FC<ZeitgeistGuideProps> = ({ editing, shuffle, pattern, onPatternChange, enabled, onEnabledChange }) => {
  const { amount, duration } = shuffle.namedParameter;
  const read = () => ({ amount: amount.getValue(), duration: duration.getValue() });
  const [settings, setSettings] = useState(read);
  useEffect(() => {
    const observations = [amount, duration].map((parameter) => observeParameter(parameter, () => setSettings(read())));
    return () => observations.forEach((observation) => observation.terminate());
    // `read` closes over the two parameters alone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, duration]);
  const stillness = stillnessOf(pattern.notes, settings.amount, settings.duration);
  const sentence = !enabled ? SWITCHED_OFF_SENTENCE : stillness === null ? null : STILLNESS_SENTENCE[stillness];
  return (
    <Flex direction="column" gap="2" style={{ marginTop: 4 }}>
      {sentence !== null && (
        <p role="status" className="mc-prose" style={{ margin: 0, color: "var(--mc-text)" }}>{sentence}</p>
      )}
      <Flex gap="2" align="center" wrap="wrap">
        <Text size="1" color="gray">Try at 75 %:</Text>
        {ZEITGEIST_TRIES.map((entry) => (
          <Button
            key={entry.pattern}
            size="1"
            variant="soft"
            onClick={() => {
              applyZeitgeistTry(editing, shuffle, entry);
              onPatternChange(entry.pattern);
              if (!enabled) onEnabledChange(true);
            }}
          >
            {entry.label}
          </Button>
        ))}
      </Flex>
    </Flex>
  );
};
