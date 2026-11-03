import { describe, expect, it } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { BoxEditing } from "@opendaw/lib-box";
import { SpielwerkDeviceBox, WerkstattParameterBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { transact } from "@/lib/testing/boxGraphFixtures";
import { readScriptParams, writeScriptParam } from "./scriptParams";

/** A Spielwerk with two declared parameters, the way the compiler registers them. */
function fixture() {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  return transact(boxGraph, () => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    const device = SpielwerkDeviceBox.create(boxGraph, UUID.generate(), (box) => {
      box.label.setValue("Spielwerk");
      box.index.setValue(0);
      box.host.refer(unit.midiEffects);
    });
    const param = (label: string, index: number, value: number) =>
      WerkstattParameterBox.create(boxGraph, UUID.generate(), (box) => {
        box.label.setValue(label);
        box.index.setValue(index);
        box.value.setValue(value);
        box.defaultValue.setValue(value);
        box.owner.refer(device.parameters);
      });
    const delay = param("delay", 0, 240);
    const repeats = param("repeats", 1, 3);
    return { boxGraph, device, delay, repeats, editing: new BoxEditing(boxGraph) };
  });
}

describe("scriptParams", () => {
  it("readScriptParams reflects the current declarations, in index order", () => {
    const { device, delay, editing } = fixture();
    expect(readScriptParams(device)).toEqual([{ label: "delay", value: 240 }, { label: "repeats", value: 3 }]);
    editing.modify(() => delay.delete());
    expect(readScriptParams(device)).toEqual([{ label: "repeats", value: 3 }]);
  });

  it("writeScriptParam changes a known label's value and reports it", () => {
    const { device, repeats, editing } = fixture();
    expect(writeScriptParam(editing, device, "repeats", 5)).toBe(true);
    expect(repeats.value.getValue()).toBe(5);
  });

  it("writeScriptParam of an unknown label writes nothing and returns false", () => {
    const { device, delay, repeats, editing } = fixture();
    expect(writeScriptParam(editing, device, "decay", 0.5)).toBe(false);
    expect([delay.value.getValue(), repeats.value.getValue()]).toEqual([240, 3]);
  });
});
