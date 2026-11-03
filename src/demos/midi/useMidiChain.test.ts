import { describe, expect, it } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { ArpeggioDeviceBox, PitchDeviceBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { transact } from "@/lib/testing/boxGraphFixtures";
import { chainBoxes } from "@/lib/midiEffects/chain";
import { entriesFrom } from "./useMidiChain";

describe("entriesFrom", () => {
  it("maps the chain's boxes to entries in index order with their enabled state", () => {
    const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
    const { boxGraph } = skeleton;
    const unit = transact(boxGraph, () => {
      const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
      ArpeggioDeviceBox.create(boxGraph, UUID.generate(), (box) => {
        box.index.setValue(1);
        box.host.refer(unit.midiEffects);
        box.enabled.setValue(false);
      });
      PitchDeviceBox.create(boxGraph, UUID.generate(), (box) => {
        box.index.setValue(0);
        box.host.refer(unit.midiEffects);
      });
      return unit;
    });
    const entries = entriesFrom(chainBoxes(unit.midiEffects));
    expect(entries.map((e) => [e.id, e.enabled])).toEqual([["pitch", true], ["arpeggio", false]]);
  });
});
