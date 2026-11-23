/**
 * Every bus is a group to the SDK: a unit whose output points at the bus of a `Bus` unit is
 * that unit's child, with no flag set. `project.api.deleteAudioUnit(busUnit)` hands a group to
 * `AudioUnitGrouping.deleteGroup`, which deletes `AudioUnitGroups.subtree` leaves first, so a
 * hand-built bus (the mixer-groups demo's, the convolver demo's send bus) takes the units
 * routed into it along when it is deleted through the API.
 *
 * `deleteAudioUnit` needs a `Project`, which Node cannot build. These tests pin what decides
 * the deletion: which units read as groups and the list `deleteGroup` walks. The deletion
 * itself was measured in the browser on the mixer-groups demo (the SDK changelog that
 * introduced the rule has the figures).
 *
 * Before the flag was retired these read: not a group, no parent, a subtree of one.
 */
import { describe, expect, it } from "vitest";
import { Option } from "@opendaw/lib-std";
import { AudioUnitBox, type AudioBusBox } from "@opendaw/studio-boxes";
import { AudioBusFactory, AudioUnitFactory, AudioUnitGroups, InstrumentFactories, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType, Colors, IconSymbol } from "@opendaw/studio-enums";
import { transact } from "@/lib/testing/boxGraphFixtures";

function emptyProject() {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph, mandatoryBoxes: { rootBox } } = skeleton;
  const unitOf = (bus: AudioBusBox): AudioUnitBox => {
    const unit = bus.output.targetVertex.unwrap("the bus has no unit").box;
    if (!(unit instanceof AudioUnitBox)) throw new Error("the bus does not output into an audio unit");
    return unit;
  };
  const bus = (name: string, type: AudioUnitType): AudioBusBox =>
    AudioBusFactory.create(skeleton, name, IconSymbol.AudioBus, type, Colors.blue);
  /** An instrument unit routed into `into`, or left on the master when none is given */
  const instrument = (name: string, into?: AudioBusBox): AudioUnitBox => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    InstrumentFactories.Nano.create(boxGraph, unit.input, name, IconSymbol.NanoWave);
    if (into !== undefined) unit.output.refer(into.input);
    return unit;
  };
  return { boxGraph, rootBox, unitOf, bus, instrument };
}

describe("a hand-built bus is a group", () => {
  it("reads as a group without any flag", () => {
    const { boxGraph, unitOf, bus, instrument } = emptyProject();
    const { busUnit, member } = transact(boxGraph, () => {
      const drums = bus("Drums", AudioUnitType.Bus);
      return { busUnit: unitOf(drums), member: instrument("Kick", drums) };
    });
    // precondition: nothing set the retired flag
    expect(busUnit.isGroup.getValue()).toBe(false);
    expect(AudioUnitGroups.isGroup(busUnit)).toBe(true);
    expect(AudioUnitGroups.isGroup(member)).toBe(false);
  });

  it("does not read the retired flag", () => {
    const { boxGraph, instrument } = emptyProject();
    const flagged = transact(boxGraph, () => {
      const unit = instrument("Flagged");
      unit.isGroup.setValue(true);
      return unit;
    });
    expect(AudioUnitGroups.isGroup(flagged)).toBe(false);
  });

  it("owns the unit routed into it, and only that one", () => {
    const { boxGraph, rootBox, unitOf, bus, instrument } = emptyProject();
    const { busUnit, member, outside } = transact(boxGraph, () => {
      const drums = bus("Drums", AudioUnitType.Bus);
      return { busUnit: unitOf(drums), member: instrument("Kick", drums), outside: instrument("Bass") };
    });
    expect(AudioUnitGroups.parent(member).unwrapOrNull()).toBe(busUnit);
    expect(AudioUnitGroups.parent(outside).isEmpty()).toBe(true);
    // the list deleteGroup walks. toEqual would compare structure, so each slot by identity
    const subtree = AudioUnitGroups.subtree(rootBox, busUnit);
    expect(subtree).toHaveLength(2);
    expect(subtree[0]).toBe(busUnit);
    expect(subtree[1]).toBe(member);
    expect(subtree.includes(outside)).toBe(false);
  });

  it("lists a nested bus and its members parents first, so the reversed list deletes leaves first", () => {
    const { boxGraph, rootBox, unitOf, bus, instrument } = emptyProject();
    const { outerUnit, innerUnit, inInner, inOuter } = transact(boxGraph, () => {
      const outer = bus("Band", AudioUnitType.Bus);
      const inner = bus("Drums", AudioUnitType.Bus);
      unitOf(inner).output.refer(outer.input);
      return { outerUnit: unitOf(outer), innerUnit: unitOf(inner), inInner: instrument("Kick", inner), inOuter: instrument("Bass", outer) };
    });
    expect(AudioUnitGroups.parent(innerUnit).unwrapOrNull()).toBe(outerUnit);
    expect(AudioUnitGroups.parent(inInner).unwrapOrNull()).toBe(innerUnit);
    const subtree = AudioUnitGroups.subtree(rootBox, outerUnit);
    expect(subtree).toHaveLength(4);
    expect(subtree[0]).toBe(outerUnit);
    expect(new Set(subtree)).toEqual(new Set([outerUnit, innerUnit, inInner, inOuter]));
    // every unit comes after its parent
    expect(subtree.indexOf(inInner)).toBeGreaterThan(subtree.indexOf(innerUnit));
    expect(subtree.indexOf(inOuter)).toBeGreaterThan(subtree.indexOf(outerUnit));
  });
});

describe("an aux bus is not a group", () => {
  it("owns nothing, so deleting it through the API leaves the units routed into it", () => {
    const { boxGraph, rootBox, unitOf, bus, instrument } = emptyProject();
    const { auxUnit, sender } = transact(boxGraph, () => {
      const aux = bus("Space", AudioUnitType.Aux);
      return { auxUnit: unitOf(aux), sender: instrument("Vox", aux) };
    });
    expect(AudioUnitGroups.isGroup(auxUnit)).toBe(false);
    expect(AudioUnitGroups.parent(sender).isEmpty()).toBe(true);
    const subtree = AudioUnitGroups.subtree(rootBox, auxUnit);
    expect(subtree).toHaveLength(1);
    expect(subtree[0]).toBe(auxUnit);
  });
});
