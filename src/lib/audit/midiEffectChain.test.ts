import { describe, expect, it } from "vitest";
import { BoxEditing } from "@opendaw/lib-box";
import { Option, UUID } from "@opendaw/lib-std";
import type { Box } from "@opendaw/lib-box";
import { MaximizerDeviceBox, PitchDeviceBox, StereoToolDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { graphWithZeitgeist, transact } from "@/lib/testing/boxGraphFixtures";
import { removeMasterMaximizer, removeMidiEffect, removeMidiEffects, zeitgeistGrooveBox } from "./midiEffectChain";

describe("removeMidiEffect", () => {
  it("deletes a Zeitgeist and leaves the project's groove, whose settings a later Zeitgeist finds", () => {
    const { boxGraph, unit, device, groove } = graphWithZeitgeist();
    expect(zeitgeistGrooveBox(device)).toBe(groove);
    const editing = new BoxEditing(boxGraph);
    editing.modify(() => groove.amount.setValue(0.8));
    removeMidiEffect(editing, device);
    expect(boxGraph.findBox(device.address.uuid).isEmpty()).toBe(true);
    expect(unit.midiEffects.pointerHub.incoming().length).toBe(0);
    expect(boxGraph.findBox(groove.address.uuid).unwrap()).toBe(groove);
    expect(groove.amount.getValue()).toBeCloseTo(0.8, 6);
  });
  it("two Zeitgeists of a project share the Global Shuffle: a write through one is the other's", () => {
    const { boxGraph, unit, device, groove } = graphWithZeitgeist();
    const second = transact(boxGraph, () => ZeitgeistDeviceBox.create(boxGraph, UUID.generate(), (box) => {
      box.label.setValue("Zeitgeist");
      box.index.setValue(1);
      box.groove.refer(groove);
      box.host.refer(unit.midiEffects);
    }));
    expect(zeitgeistGrooveBox(second)).toBe(zeitgeistGrooveBox(device));
  });
});

describe("removeMidiEffects", () => {
  const pitchAndVelocity = () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    const { boxGraph } = skeleton;
    return transact(boxGraph, () => {
      const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
      const pitch = PitchDeviceBox.create(boxGraph, UUID.generate(), (box) => {
        box.label.setValue("Pitch");
        box.index.setValue(0);
        box.host.refer(unit.midiEffects);
      });
      const velocity = VelocityDeviceBox.create(boxGraph, UUID.generate(), (box) => {
        box.label.setValue("Velocity");
        box.index.setValue(1);
        box.host.refer(unit.midiEffects);
      });
      return { boxGraph, unit, pitch, velocity, editing: new BoxEditing(boxGraph) };
    });
  };
  it("removes every box and names a box that cannot go", () => {
    const { unit, pitch, velocity, editing } = pitchAndVelocity();
    expect(unit.midiEffects.pointerHub.incoming().length).toBe(2);
    removeMidiEffects(editing, [pitch, velocity]);
    expect(unit.midiEffects.pointerHub.incoming().length).toBe(0);
    expect(pitch.isAttached()).toBe(false);
    expect(() => removeMidiEffects(editing, [pitch])).toThrow(/Pitch/);
  });
  it("keeps the failure as the cause of the error that names the box", () => {
    const { pitch, editing } = pitchAndVelocity();
    const failure = new Error("graph refused");
    const refusing = { modify: () => { throw failure; } };
    let caught: unknown = null;
    try { removeMidiEffects(refusing, [pitch]); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Pitch could not be removed: graph refused");
    expect((caught as Error).cause).toBe(failure);
    expect(pitch.isAttached()).toBe(true);
    removeMidiEffects(editing, [pitch]);
  });
  it("refuses a box still attached after its transaction: a delete that did nothing is not a removal", () => {
    const { pitch } = pitchAndVelocity();
    const inert = { modify: () => undefined };
    expect(() => removeMidiEffects(inert, [pitch])).toThrow("Pitch could not be removed: the box is still attached after the delete");
  });
  it("goes in reverse array order and leaves the earlier boxes removed when one throws", () => {
    const { unit, pitch, velocity, editing } = pitchAndVelocity();
    removeMidiEffect(editing, pitch);
    // reverse order: Velocity goes first, then the detached Pitch throws
    expect(() => removeMidiEffects(editing, [pitch, velocity])).toThrow(/Pitch/);
    expect(velocity.isAttached()).toBe(false);
    expect(unit.midiEffects.pointerHub.incoming().length).toBe(0);
  });
});

describe("removeMasterMaximizer", () => {
  // The page passes the master adapter's audio effects (each carries its `box`); here the chain's pointers carry it the same way.
  const chainOf = (unit: { audioEffects: { pointerHub: { incoming(): ReadonlyArray<{ box: Box }> } } }) => unit.audioEffects.pointerHub.incoming();
  it("deletes the Master Maximizer the skeleton created and reports one", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: true, createDefaultUser: false });
    const unit = skeleton.mandatoryBoxes.primaryAudioUnitBox;
    expect(chainOf(unit).length).toBe(1);
    expect(removeMasterMaximizer(new BoxEditing(skeleton.boxGraph), chainOf(unit))).toBe(1);
    expect(chainOf(unit).length).toBe(0);
  });
  it("reports zero on a master without one", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    expect(removeMasterMaximizer(new BoxEditing(skeleton.boxGraph), chainOf(skeleton.mandatoryBoxes.primaryAudioUnitBox))).toBe(0);
  });
  it("counts and deletes only Maximizers, leaving another effect in the chain", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: true, createDefaultUser: false });
    const unit = skeleton.mandatoryBoxes.primaryAudioUnitBox;
    const editing = new BoxEditing(skeleton.boxGraph);
    const second = editing.modify(() => MaximizerDeviceBox.create(skeleton.boxGraph, UUID.generate(), (box) => {
      box.label.setValue("Second");
      box.index.setValue(1);
      box.host.refer(unit.audioEffects);
    })).unwrap("second Maximizer");
    const stereo = editing.modify(() => StereoToolDeviceBox.create(skeleton.boxGraph, UUID.generate(), (box) => {
      box.label.setValue("Stereo");
      box.index.setValue(2);
      box.host.refer(unit.audioEffects);
    })).unwrap("stereo tool");
    expect(chainOf(unit).length).toBe(3);
    expect(removeMasterMaximizer(editing, chainOf(unit))).toBe(2);
    expect(second.isAttached()).toBe(false);
    expect(chainOf(unit).map((pointer) => pointer.box)).toEqual([stereo]);
  });
});
