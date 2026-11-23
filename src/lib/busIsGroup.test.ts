/**
 * Every bus is a group to the SDK: a unit whose output points at a bus is that bus unit's
 * child, with no flag set. `project.api.deleteAudioUnit(busUnit)` deletes
 * `AudioUnitGroups.subtree`, so a hand-built bus (the mixer-groups demo's, the convolver
 * demo's send bus) takes the units routed into it along when it is deleted through the API.
 * Before the flag was retired these read: not a group, no parent, a subtree of one.
 */
import { describe, expect, it } from "vitest";
import { Option } from "@opendaw/lib-std";
import { AudioUnitBox } from "@opendaw/studio-boxes";
import { AudioBusFactory, AudioUnitFactory, AudioUnitGroups, InstrumentFactories, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType, Colors, IconSymbol } from "@opendaw/studio-enums";
import { transact } from "@/lib/testing/boxGraphFixtures";

function busWithOneMember() {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph, mandatoryBoxes: { rootBox } } = skeleton;
  return transact(boxGraph, () => {
    const bus = AudioBusFactory.create(skeleton, "Drums", IconSymbol.AudioBus, AudioUnitType.Bus, Colors.blue);
    const busUnit = bus.output.targetVertex.unwrap("the bus has no unit").box;
    if (!(busUnit instanceof AudioUnitBox)) throw new Error("the bus does not output into an audio unit");
    const member = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    InstrumentFactories.Nano.create(boxGraph, member.input, "Kick", IconSymbol.NanoWave);
    member.output.refer(bus.input);
    const outside = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    InstrumentFactories.Nano.create(boxGraph, outside.input, "Bass", IconSymbol.NanoWave);
    return { rootBox, busUnit, member, outside };
  });
}

describe("a hand-built bus is a group", () => {
  it("reads as a group without any flag", () => {
    const { busUnit, member } = busWithOneMember();
    expect(busUnit.isGroup.getValue()).toBe(false);
    expect(AudioUnitGroups.isGroup(busUnit)).toBe(true);
    expect(AudioUnitGroups.isGroup(member)).toBe(false);
  });

  it("owns the unit routed into it, and only that one", () => {
    const { rootBox, busUnit, member, outside } = busWithOneMember();
    expect(AudioUnitGroups.parent(member).unwrapOrNull()).toBe(busUnit);
    expect(AudioUnitGroups.parent(outside).isEmpty()).toBe(true);
    // what deleteAudioUnit(busUnit) deletes
    expect(AudioUnitGroups.subtree(rootBox, busUnit)).toEqual([busUnit, member]);
  });
});
