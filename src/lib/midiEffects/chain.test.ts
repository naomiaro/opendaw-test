import { describe, expect, it } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { BoxEditing } from "@opendaw/lib-box";
import { ArpeggioDeviceBox, PitchDeviceBox, VelocityDeviceBox, type AudioUnitBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import type { EffectBox, EffectFactory, Project } from "@opendaw/studio-core";
import { graphWithZeitgeist, transact } from "@/lib/testing/boxGraphFixtures";
import { deviceIdOf } from "./devices";
import { chainBoxes, moveDevice, reconcileChain, removeDevice, setDeviceEnabled, type Factories, type MidiEffectsField } from "./chain";

/** Pitch at 0, Velocity at 1, Arpeggio at 2 on one unit's MIDI chain. */
function threeDevices(): { unit: AudioUnitBox; boxes: EffectBox[]; editing: BoxEditing } {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  return transact(boxGraph, () => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    const at = (index: number) => (box: { index: { setValue(v: number): void }; host: { refer(target: unknown): void } }) => {
      box.index.setValue(index);
      box.host.refer(unit.midiEffects);
    };
    const boxes: EffectBox[] = [
      PitchDeviceBox.create(boxGraph, UUID.generate(), at(0)),
      VelocityDeviceBox.create(boxGraph, UUID.generate(), at(1)),
      ArpeggioDeviceBox.create(boxGraph, UUID.generate(), at(2)),
    ];
    return { unit, boxes, editing: new BoxEditing(boxGraph) };
  });
}

const ids = (unit: AudioUnitBox) => chainBoxes(unit.midiEffects).map(deviceIdOf);

describe("chain", () => {
  it("chainBoxes reads the chain in index order", () => {
    const { unit } = threeDevices();
    expect(ids(unit)).toEqual(["pitch", "velocity", "arpeggio"]);
  });

  it("moveDevice(2, 0) puts the last device first", () => {
    const { unit, editing } = threeDevices();
    moveDevice(editing, unit.midiEffects, 2, 0);
    expect(ids(unit)).toEqual(["arpeggio", "pitch", "velocity"]);
  });

  it("moveDevice(0, 2) puts the first device last", () => {
    const { unit, editing } = threeDevices();
    moveDevice(editing, unit.midiEffects, 0, 2);
    expect(ids(unit)).toEqual(["velocity", "arpeggio", "pitch"]);
  });

  it("setDeviceEnabled writes the enabled field", () => {
    const { boxes, editing } = threeDevices();
    setDeviceEnabled(editing, boxes[0], false);
    expect(boxes[0].enabled.getValue()).toBe(false);
  });

  it("removeDevice leaves the chain without it", () => {
    const { unit, boxes, editing } = threeDevices();
    removeDevice(editing, unit.midiEffects, boxes[1]);
    expect(ids(unit)).toEqual(["pitch", "arpeggio"]);
  });

  it("removeDevice compacts the survivors' indices", () => {
    const { unit, boxes, editing } = threeDevices();
    removeDevice(editing, unit.midiEffects, boxes[0]);
    expect(chainBoxes(unit.midiEffects).map((b) => b.index.getValue())).toEqual([0, 1]);
  });

  it("removeDevice of a zeitgeist takes its groove with it", () => {
    const { boxGraph, unit, device, groove } = graphWithZeitgeist();
    removeDevice(new BoxEditing(boxGraph), unit.midiEffects, device);
    expect(chainBoxes(unit.midiEffects)).toHaveLength(0);
    expect(groove.isAttached()).toBe(false);
  });
});

describe("reconcileChain", () => {
  /** A Project double: `insertEffect` creates the device box by hand on the field, as the SDK factories do. */
  function double(): { unit: AudioUnitBox; project: Pick<Project, "editing" | "api">; factories: Factories } {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    const { boxGraph } = skeleton;
    const unit = transact(boxGraph, () => AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None));
    const editing = new BoxEditing(boxGraph);
    const classes = { Arpeggio: ArpeggioDeviceBox, Pitch: PitchDeviceBox, Velocity: VelocityDeviceBox } as const;
    const factoryFor = (key: keyof typeof classes): EffectFactory =>
      ({ type: "midi", create: () => { throw new Error("unused"); }, boxName: key } as unknown as EffectFactory & { boxName: string });
    const factories = { Arpeggio: factoryFor("Arpeggio"), Pitch: factoryFor("Pitch"), Velocity: factoryFor("Velocity"), Zeitgeist: factoryFor("Arpeggio") };
    const api = {
      insertEffect: (field: MidiEffectsField, factory: EffectFactory): EffectBox => {
        const key = (factory as unknown as { boxName: keyof typeof classes }).boxName;
        const index = chainBoxes(field).length;
        return classes[key].create(boxGraph, UUID.generate(), (box) => {
          box.index.setValue(index);
          box.host.refer(field);
        });
      },
    } as unknown as Project["api"];
    return { unit, project: { editing, api }, factories };
  }

  it("inserts one device into an empty chain", () => {
    const { unit, project, factories } = double();
    const { changed } = reconcileChain(project, unit.midiEffects, ["arpeggio"], factories);
    expect(changed).toBe(true);
    expect(ids(unit)).toEqual(["arpeggio"]);
  });

  it("swaps a single device", () => {
    const { unit, project, factories } = double();
    reconcileChain(project, unit.midiEffects, ["arpeggio"], factories);
    reconcileChain(project, unit.midiEffects, ["pitch"], factories);
    expect(ids(unit)).toEqual(["pitch"]);
  });

  it("reorders without inserting or removing", () => {
    const { unit, project, factories } = double();
    reconcileChain(project, unit.midiEffects, ["pitch", "velocity", "arpeggio"], factories);
    const before = chainBoxes(unit.midiEffects);
    reconcileChain(project, unit.midiEffects, ["arpeggio", "velocity", "pitch"], factories);
    expect(ids(unit)).toEqual(["arpeggio", "velocity", "pitch"]);
    expect(new Set(chainBoxes(unit.midiEffects))).toEqual(new Set(before));
  });

  it("a remove followed by an insert leaves dense, distinct indices", () => {
    const { unit, project, factories } = double();
    reconcileChain(project, unit.midiEffects, ["arpeggio", "pitch", "velocity"], factories);
    reconcileChain(project, unit.midiEffects, ["pitch", "velocity"], factories);
    reconcileChain(project, unit.midiEffects, ["pitch", "velocity", "arpeggio"], factories);
    expect(chainBoxes(unit.midiEffects).map((b) => b.index.getValue())).toEqual([0, 1, 2]);
    expect(ids(unit)).toEqual(["pitch", "velocity", "arpeggio"]);
  });

  it("reports no change for the same list twice", () => {
    const { unit, project, factories } = double();
    reconcileChain(project, unit.midiEffects, ["pitch", "velocity"], factories);
    expect(reconcileChain(project, unit.midiEffects, ["pitch", "velocity"], factories).changed).toBe(false);
  });
});
