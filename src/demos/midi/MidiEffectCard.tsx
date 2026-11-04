/**
 * One stock MIDI effect's card: the enabled switch, its parameters through the SDK's adapter (the
 * sliders print the SDK's strings), what it does and what to listen for, and the insert snippet.
 */
import React, { useMemo } from "react";
import { Button, Flex, Switch, Text } from "@radix-ui/themes";
import { Devices, VelocityDeviceBoxAdapter } from "@opendaw/studio-adapters";
import type { Project } from "@opendaw/studio-core";
import { ParamSlider } from "@/components/ParamSlider";
import { CODE_BLOCK_STYLE } from "@/lib/design/consoleTheme";
import { DEVICES, deviceParameters, reseedVelocity, type LanePage } from "@/lib/midiEffects/devices";
import type { ChainEntry } from "./useMidiChain";

export interface MidiEffectCardProps {
  project: Project;
  entry: ChainEntry;
  onEnabledChange(enabled: boolean): void;
  /** After a write that changes what the chain does (the Velocity reseed), so the pattern restarts. */
  onChainChange(): void;
  /** Without the prose and the snippet: the compact form a stack chip expands to. */
  compact?: boolean;
  /** Which page's lanes the card's lane note describes. */
  page: LanePage;
}

export const MidiEffectCard: React.FC<MidiEffectCardProps> = ({ project, entry, onEnabledChange, onChainChange, compact = false, page }) => {
  const spec = DEVICES[entry.id];
  const adapter = useMemo(() => project.boxAdapters.adapterFor(entry.box, Devices.isMidiEffect), [project, entry.box]);
  const parameters = useMemo(() => deviceParameters(adapter), [adapter]);
  const reseed = adapter instanceof VelocityDeviceBoxAdapter
    ? () => {
        reseedVelocity(project.editing, adapter);
        onChainChange();
      }
    : null;
  return (
    <div className="mc-panel" style={{ padding: compact ? "16px 18px" : undefined, gap: 12 }}>
      <Flex justify="between" align="center" gap="3">
        <Text size="3" weight="bold">{spec.label}</Text>
        <Text as="label" size="1" color="gray">
          <Flex gap="2" align="center">
            <Switch size="1" checked={entry.enabled} onCheckedChange={onEnabledChange} aria-label={`${spec.label} enabled`} />
            enabled
          </Flex>
        </Text>
      </Flex>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px 18px" }}>
        {parameters.map((p) => (
          <ParamSlider key={p.key} project={project} parameter={p.parameter} label={p.label} positions={p.positions} />
        ))}
        {reseed && (
          <Flex align="end">
            <Button size="1" variant="soft" onClick={reseed}>Reseed random</Button>
          </Flex>
        )}
      </div>
      {!compact && (
        <>
          <p className="mc-prose" style={{ marginTop: 4 }}>{spec.what}</p>
          <p className="mc-prose" style={{ marginTop: 6 }}><strong style={{ color: "var(--mc-text)" }}>Listen for:</strong> {spec.listenFor}</p>
          {spec.laneNote[page] !== null && <p className="mc-prose" style={{ marginTop: 6 }}>{spec.laneNote[page]}</p>}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--mc-label)" }}>Code</summary>
            <pre style={{ ...CODE_BLOCK_STYLE, marginTop: 8, fontSize: 12, overflowX: "auto" }}>{spec.snippet}</pre>
          </details>
        </>
      )}
    </div>
  );
};
