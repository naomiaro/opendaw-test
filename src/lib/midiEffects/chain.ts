/**
 * The MIDI effects demo's chain operations over a unit's MIDI effect host field: read the chain in
 * index order, insert, remove, enable and move a device. A move has `arrayMove` semantics on top of
 * `IndexedBox.moveIndices`, whose drop index is a gap in the ORIGINAL order.
 */
import { IndexedBox, type Field } from "@opendaw/lib-box";
import type { Editing } from "@opendaw/lib-std";
import type { Pointers } from "@opendaw/studio-enums";
import type { EffectBox, EffectFactories, Project } from "@opendaw/studio-core";
import { DEVICES, deviceIdOf, type DeviceId, type FactoryKey } from "./devices";

export type MidiEffectsField = Field<Pointers.MIDIEffectHost>;
/** The SDK's own `EffectFactories.MidiNamed`, passed in by the page: the value cannot be imported here (see `devices.ts`). */
export type Factories = Pick<typeof EffectFactories.MidiNamed, FactoryKey>;

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

/**
 * One transaction: the survivors' indices are compacted first (`IndexedBox.removeOrder` takes the
 * box's POSITION in the sorted chain), then the box goes; a Zeitgeist takes its groove box with it.
 * A bare delete would leave a gap, and the SDK's insert (`insertOrder`) appends at `length`, which
 * then collides with a survivor's index.
 */
export function removeDevice(editing: Editing, field: MidiEffectsField, box: EffectBox): void {
  editing.modify(() => {
    const position = chainBoxes(field).indexOf(box);
    if (position >= 0) IndexedBox.removeOrder(field, position);
    box.delete();
  });
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

/**
 * Make the chain read `desired`, in that order: remove boxes whose device is not wanted, insert the
 * missing ones, then move until the order matches. `changed` is false when nothing was written, so a
 * caller re-seeks the transport only on a real change.
 */
export function reconcileChain(
  project: Pick<Project, "editing" | "api">,
  field: MidiEffectsField,
  desired: readonly DeviceId[],
  factories: Factories
): { changed: boolean } {
  if (new Set(desired).size !== desired.length) throw new Error(`duplicate device in desired chain: ${desired.join(",")}`);
  let changed = false;
  for (const box of chainBoxes(field)) {
    const id = deviceIdOf(box);
    if (id === null || !desired.includes(id)) {
      removeDevice(project.editing, field, box);
      changed = true;
    }
  }
  const present = new Set(chainBoxes(field).map(deviceIdOf));
  for (const id of desired) {
    if (!present.has(id)) {
      insertDevice(project, field, id, factories);
      changed = true;
    }
  }
  for (let target = 0; target < desired.length; target++) {
    const current = chainBoxes(field).map(deviceIdOf).indexOf(desired[target]);
    if (current !== target) {
      moveDevice(project.editing, field, current, target);
      changed = true;
    }
  }
  return { changed };
}
