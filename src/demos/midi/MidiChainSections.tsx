/**
 * The two chain sections of the MIDI Effects pages: "One at a time" (tabs, one card) and "Stack them"
 * (chips). Both dispatch the page's reducer actions; the page owns the state and renders the cards.
 */
import React from "react";
import type { Project } from "@opendaw/studio-core";
import { SegmentedControl, Text } from "@radix-ui/themes";
import { DEVICES, DEVICE_IDS } from "@/lib/midiEffects/devices";
import type { PageAction, PageState, Tab } from "@/lib/midiEffects/pageState";
import type { ChainEntry } from "./useMidiChain";
import { MidiEffectStack } from "./MidiEffectStack";

export interface MidiChainSectionsProps {
  state: PageState;
  dispatch: React.Dispatch<PageAction>;
  entries: readonly ChainEntry[];
  project: Project | null;
  renderCard: (entry: ChainEntry, compact: boolean) => React.ReactNode;
}

export const MidiChainSections: React.FC<MidiChainSectionsProps> = ({ state, dispatch, entries, project, renderCard }) => {
  const singleEntry = state.mode === "single" ? entries.find((e) => e.id === state.tab) ?? null : null;
  const stackEntries = state.mode === "stack" ? entries : [];
  return (
    <>
      <section style={{ marginBottom: 28 }}>
        <div className="mc-kicker" style={{ marginBottom: 10 }}>One at a time</div>
        <div style={{ opacity: state.mode === "stack" ? 0.4 : 1, pointerEvents: state.mode === "stack" ? "none" : undefined }}>
          <SegmentedControl.Root value={state.tab} onValueChange={(v) => dispatch({ type: "selectTab", tab: v as Tab })} size="2">
            <SegmentedControl.Item value="dry">Dry</SegmentedControl.Item>
            {DEVICE_IDS.map((id) => <SegmentedControl.Item key={id} value={id}>{DEVICES[id].label}</SegmentedControl.Item>)}
          </SegmentedControl.Root>
        </div>
        <div style={{ marginTop: 12 }}>
          {state.mode === "stack" ? (
            <Text size="2" color="gray">The stack below owns the chain. Clear it to come back to one device at a time.</Text>
          ) : singleEntry && project ? (
            renderCard(singleEntry, false)
          ) : (
            <Text size="2" color="gray">No device: the pattern as written.</Text>
          )}
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div className="mc-kicker" style={{ marginBottom: 10 }}>Stack them</div>
        <Text size="2" color="gray" style={{ display: "block", marginBottom: 10 }}>
          Add devices to build a chain and drag them into an order. Order matters: an Arpeggio before a Zeitgeist
          grooves the steps, after it arpeggiates grooved chords.
          {state.mode === "single" && state.tab !== "dry" && ` Adding carries ${DEVICES[state.tab].label} over as the first chip.`}
        </Text>
        <MidiEffectStack
          entries={stackEntries}
          onMove={(from, to) => dispatch({ type: "moveInStack", from, to })}
          onRemove={(id) => dispatch({ type: "removeFromStack", id })}
          onAdd={(id) => dispatch({ type: "addToStack", id })}
          onClear={() => dispatch({ type: "clearStack" })}
          renderCard={(entry) => renderCard(entry, true)}
        />
      </section>
    </>
  );
};
