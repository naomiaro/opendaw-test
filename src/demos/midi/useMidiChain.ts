/**
 * The unit's MIDI chain as React state, rebuilt from the box graph on every change: the chip row
 * and the tab card render from this, never from an order the page holds itself, so a drag that did
 * not land shows nothing.
 */
import { useEffect, useState } from "react";
import type { Terminable } from "@opendaw/lib-std";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { EffectBox, Project } from "@opendaw/studio-core";
import { audioUnitAdapterFor, midiEffectsFieldOf } from "@/lib/adapterUtils";
import { chainBoxes } from "@/lib/midiEffects/chain";
import { deviceIdOf, type DeviceId } from "@/lib/midiEffects/devices";

export interface ChainEntry {
  readonly box: EffectBox;
  readonly id: DeviceId;
  readonly enabled: boolean;
}

/** Entries for the boxes the demo knows, in the order given (callers pass `chainBoxes(field)`). */
export function entriesFrom(boxes: readonly EffectBox[]): ChainEntry[] {
  const entries: ChainEntry[] = [];
  for (const box of boxes) {
    const id = deviceIdOf(box);
    if (id !== null) entries.push({ box, id, enabled: box.enabled.getValue() });
  }
  return entries;
}

export function useMidiChain(project: Project | null, audioUnitBox: AudioUnitBox | null): ChainEntry[] {
  const [entries, setEntries] = useState<ChainEntry[]>([]);
  useEffect(() => {
    if (!project || !audioUnitBox) return undefined;
    const field = midiEffectsFieldOf(project, audioUnitBox);
    const collection = audioUnitAdapterFor(project, audioUnitBox).midiEffects.unwrap("no midi chain");
    const enabledSubs = new Map<EffectBox, Terminable>();
    const refresh = () => setEntries(entriesFrom(chainBoxes(field)));
    const subscription = collection.catchupAndSubscribe({
      onAdd: (adapter) => {
        enabledSubs.get(adapter.box as EffectBox)?.terminate();
        enabledSubs.set(adapter.box as EffectBox, adapter.enabledField.subscribe(refresh));
        refresh();
      },
      onRemove: (adapter) => {
        enabledSubs.get(adapter.box as EffectBox)?.terminate();
        enabledSubs.delete(adapter.box as EffectBox);
        refresh();
      },
      onReorder: refresh,
    });
    return () => {
      subscription.terminate();
      for (const sub of enabledSubs.values()) sub.terminate();
    };
  }, [project, audioUnitBox]);
  return entries;
}
