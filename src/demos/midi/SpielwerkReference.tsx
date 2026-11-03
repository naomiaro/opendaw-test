/**
 * The Spielwerk API reference panel: one entry per thing a script can use, with a "Load example"
 * that puts a complete Processor in the editor.
 */
import React from "react";
import { Button, Flex, Text } from "@radix-ui/themes";
import type { ReferenceEntry } from "@/lib/midiEffects/spielwerkScripts";

export interface SpielwerkReferenceProps {
  entries: readonly ReferenceEntry[];
  onLoad(example: string): void;
}

export const SpielwerkReference: React.FC<SpielwerkReferenceProps> = ({ entries, onLoad }) => (
  <div className="mc-panel" style={{ padding: "18px 20px", gap: 0 }}>
    <div className="mc-kicker" style={{ marginBottom: 6 }}>Spielwerk API</div>
    {entries.map((entry) => (
      <div key={entry.name} style={{ padding: "10px 0", borderBottom: "1px solid var(--mc-line)" }}>
        <Flex justify="between" align="start" gap="3">
          <div style={{ minWidth: 0 }}>
            <Text size="2" weight="bold" style={{ display: "block" }}>{entry.name}</Text>
            <code style={{ fontFamily: "var(--mc-mono)", fontSize: 11.5, color: "var(--mc-amber)", wordBreak: "break-word" }}>{entry.signature}</code>
          </div>
          <Button size="1" variant="ghost" color="gray" onClick={() => onLoad(entry.example)} style={{ flex: "none" }}>
            Load example
          </Button>
        </Flex>
        <Text size="1" color="gray" style={{ display: "block", marginTop: 4, lineHeight: 1.5 }}>{entry.doc}</Text>
      </div>
    ))}
  </div>
);
