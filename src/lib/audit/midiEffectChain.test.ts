import { describe, expect, it, vi } from "vitest";
import { BoxEditing } from "@opendaw/lib-box";
import { Option, UUID } from "@opendaw/lib-std";
import { PitchDeviceBox, VelocityDeviceBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { graphWithZeitgeist, transact } from "@/lib/testing/boxGraphFixtures";
import { removeMasterMaximizer, removeMidiEffect, removeMidiEffects, zeitgeistGrooveBox } from "./midiEffectChain";

describe("removeMidiEffect", () => {
  it("deletes a Zeitgeist together with its groove, leaving no box behind", () => {
    const { boxGraph, unit, device, groove } = graphWithZeitgeist();
    expect(zeitgeistGrooveBox(device)).toBe(groove);
    removeMidiEffect(new BoxEditing(boxGraph), device);
    expect(boxGraph.findBox(device.address.uuid).isEmpty()).toBe(true);
    expect(boxGraph.findBox(groove.address.uuid).isEmpty()).toBe(true);
    expect(unit.midiEffects.pointerHub.incoming().length).toBe(0);
  });
  it("relies on the box graph taking the groove with the device: no throw, no warning, no orphan", () => {
    const { boxGraph, device, groove } = graphWithZeitgeist();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => new BoxEditing(boxGraph).modify(() => device.delete())).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(boxGraph.findBox(groove.address.uuid).isEmpty()).toBe(true);
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
  it("deletes the Master Maximizer the skeleton created and reports one", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: true, createDefaultUser: false });
    const unit = skeleton.mandatoryBoxes.primaryAudioUnitBox;
    expect(unit.audioEffects.pointerHub.incoming().length).toBe(1);
    expect(removeMasterMaximizer(new BoxEditing(skeleton.boxGraph), unit)).toBe(1);
    expect(unit.audioEffects.pointerHub.incoming().length).toBe(0);
  });
  it("reports zero on a master without one", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    expect(removeMasterMaximizer(new BoxEditing(skeleton.boxGraph), skeleton.mandatoryBoxes.primaryAudioUnitBox)).toBe(0);
  });
});
