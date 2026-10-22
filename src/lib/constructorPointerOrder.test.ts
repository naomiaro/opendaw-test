// A pointer set in a box constructor (an audio unit's output, routed to the primary bus by
// AudioUnitFactory) and changed again in the same transaction keeps its order: the later
// change wins in the resolved target, in the undo step and in a rollback. The box graph used to
// process the constructor update at the end of the transaction, after the change, so the
// pointer resolved to its constructor target and undo / redo failed. CLAUDE.md's rule to
// re-route in a separate transaction came from that; these tests pin the fixed order against
// the installed lib-box through the SDK's own factories.
import { describe, expect, it } from "vitest";
import { Option } from "@opendaw/lib-std";
import { BoxEditing } from "@opendaw/lib-box";
import type { AudioBusBox, AudioUnitBox } from "@opendaw/studio-boxes";
import { AudioBusFactory, AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType, Colors, IconSymbol } from "@opendaw/studio-enums";

function skeletonWithBus() {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const editing = new BoxEditing(skeleton.boxGraph);
  const bus = editing
    .modify(() => AudioBusFactory.create(skeleton, "Aux", IconSymbol.AudioBus, AudioUnitType.Bus, Colors.green))
    .unwrap("no bus");
  const primaryInput = skeleton.mandatoryBoxes.primaryAudioBusBox.input;
  const primaryCount = primaryInput.pointerHub.size();
  const busCount = bus.input.pointerHub.size();
  return { skeleton, editing, bus, primaryInput, primaryCount, busCount };
}

const target = (unit: AudioUnitBox, bus: AudioBusBox) =>
  unit.output.targetAddress.mapOr((address) => (address.equals(bus.input.address) ? "bus" : "other"), "none");

describe("an audio unit re-routed in the transaction that creates it", () => {
  it("points at the new bus, and the primary bus holds no edge from it", () => {
    const { skeleton, editing, bus, primaryInput, primaryCount, busCount } = skeletonWithBus();
    const unit = editing
      .modify(() => {
        const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
        unit.output.refer(bus.input);
        return unit;
      })
      .unwrap("no unit");
    expect(target(unit, bus)).toBe("bus");
    expect(unit.output.targetVertex.unwrap().address.equals(bus.input.address)).toBe(true);
    expect(primaryInput.pointerHub.size()).toBe(primaryCount);
    expect(bus.input.pointerHub.size()).toBe(busCount + 1);
  });

  it("undo removes the unit and its edge, redo restores it on the new bus", () => {
    const { skeleton, editing, bus, primaryInput, primaryCount, busCount } = skeletonWithBus();
    const unit = editing
      .modify(() => {
        const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
        unit.output.refer(bus.input);
        return unit;
      })
      .unwrap("no unit");
    const uuid = unit.address.uuid;
    expect(target(unit, bus)).toBe("bus");
    expect(bus.input.pointerHub.size()).toBe(busCount + 1);
    expect(editing.undo()).toBe(true);
    expect(skeleton.boxGraph.findBox(uuid).isEmpty()).toBe(true);
    expect(bus.input.pointerHub.size()).toBe(busCount);
    expect(primaryInput.pointerHub.size()).toBe(primaryCount);
    expect(editing.redo()).toBe(true);
    const redone = skeleton.boxGraph.findBox<AudioUnitBox>(uuid).unwrap("redo did not restore the unit");
    expect(target(redone, bus)).toBe("bus");
    expect(bus.input.pointerHub.size()).toBe(busCount + 1);
    expect(primaryInput.pointerHub.size()).toBe(primaryCount);
  });

  it("an aborted transaction rolls the unit and both edges back", () => {
    const { skeleton, editing, bus, primaryInput, primaryCount, busCount } = skeletonWithBus();
    const before = skeleton.boxGraph.boxes().length;
    expect(() =>
      editing.modify(() => {
        const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
        unit.output.refer(bus.input);
        throw new Error("forced failure");
      })
    ).toThrow("forced failure");
    expect(skeleton.boxGraph.boxes().length).toBe(before);
    expect(bus.input.pointerHub.size()).toBe(busCount);
    expect(primaryInput.pointerHub.size()).toBe(primaryCount);
  });
});
