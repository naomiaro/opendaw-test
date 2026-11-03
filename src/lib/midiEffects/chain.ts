/**
 * The MIDI effects demo's chain operations over a unit's MIDI effect host field: read the chain in
 * index order, insert, remove, enable and move a device. A move has `arrayMove` semantics on top of
 * `IndexedBox.moveIndices`, whose drop index is a gap in the ORIGINAL order.
 */
import { IndexedBox, type Field } from "@opendaw/lib-box";
import type { Editing } from "@opendaw/lib-std";
import type { Pointers } from "@opendaw/studio-enums";
import type { EffectBox, EffectFactory, Project } from "@opendaw/studio-core";
import { removeMidiEffect } from "@/lib/audit/midiEffectChain";
import { DEVICES, type DeviceId, type FactoryKey } from "./devices";

export type MidiEffectsField = Field<Pointers.MIDIEffectHost>;
/** `EffectFactories[key]`, resolved by the page: the factories cannot be imported here (see `devices.ts`). */
export type Factories = Readonly<Record<FactoryKey, EffectFactory>>;

/** The boxes on the chain, sorted by their index field. */
export function chainBoxes(field: MidiEffectsField): EffectBox[] {
  return field.pointerHub
    .incoming()
    .map((pointer) => pointer.box as EffectBox)
    .sort((a, b) => a.index.getValue() - b.index.getValue());
}

export function insertDevice(
  project: Pick<Project, "editing" | "api">,
  field: MidiEffectsField,
  id: DeviceId,
  factories: Factories
): EffectBox {
  const factory = factories[DEVICES[id].factoryKey];
  return project.editing.modify(() => project.api.insertEffect(field, factory)).unwrap("insertEffect");
}

/** One transaction; a Zeitgeist takes its groove box with it. */
export function removeDevice(editing: Editing, box: EffectBox): void {
  removeMidiEffect(editing, box);
}

export function setDeviceEnabled(editing: Editing, box: EffectBox, enabled: boolean): void {
  editing.modify(() => box.enabled.setValue(enabled));
}

/** The device at `fromIndex` ends at `toIndex` (`arrayMove` semantics). */
export function moveDevice(editing: Editing, field: MidiEffectsField, fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  const dropIndex = fromIndex < toIndex ? toIndex + 1 : toIndex;
  editing.modify(() => IndexedBox.moveIndices(field, [fromIndex], dropIndex));
}
