import { describe, expect, it, vi } from "vitest";
import { BoxEditing } from "@opendaw/lib-box";
import { graphWithZeitgeist } from "@/lib/testing/boxGraphFixtures";
import { removeMidiEffect, zeitgeistGrooveBox } from "./midiEffectChain";

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
