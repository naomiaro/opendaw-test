import { describe, expect, it } from "vitest";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";
import { VelocityDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { DEVICES, DEVICE_IDS, deviceIdOf, deviceParameters, reseedVelocity } from "./devices";

describe("devices", () => {
  it("registers the five devices in the SDK's order, each naming its factory", () => {
    expect(DEVICE_IDS).toEqual(["arpeggio", "note-filter", "pitch", "velocity", "zeitgeist"]);
    expect(DEVICE_IDS.map((id) => DEVICES[id].factoryKey)).toEqual(["Arpeggio", "NoteFilter", "Pitch", "Velocity", "Zeitgeist"]);
  });

  it("note filter parameters: card order, key names, the Set switch and what it dims", () => {
    const { adapter } = midiEffectFixture("note-filter");
    const params = deviceParameters(adapter);
    expect(params.map((p) => p.key)).toEqual(["min", "max", "set", "transpose", "key"]);
    expect(params.map((p) => p.positions)).toEqual([128, 128, undefined, 255, 128]);
    expect(params[0].parameter.getPrintValue().value).toBe("C-2");
    expect(params[4].parameter.getPrintValue().value).toBe("C3"); // MidiKeys.toFullString: C-2 is key 0
    expect(params[2].control).toBe("switch");
    expect(params[3].dimWhen).toEqual({ key: "set", on: true });
    expect(params[4].dimWhen).toEqual({ key: "set", on: false });
    expect(params.filter((p) => p.key !== "set").every((p) => p.control === undefined)).toBe(true);
  });

  it("deviceIdOf names a note filter box", () => {
    expect(deviceIdOf(midiEffectFixture("note-filter").box)).toBe("note-filter");
  });

  it("arpeggio parameters carry the SDK's string mappings", () => {
    const { adapter } = midiEffectFixture("arpeggio");
    const params = deviceParameters(adapter);
    expect(params.map((p) => p.key)).toEqual(["modeIndex", "rate", "numOctaves", "gate", "repeat", "velocity"]);
    const mode = params[0];
    expect(mode.positions).toBe(3);
    expect(mode.parameter.getPrintValue().value).toBe("Up");
  });

  it("zeitgeist parameters come from its own groove", () => {
    const { adapter } = midiEffectFixture("zeitgeist");
    const params = deviceParameters(adapter);
    expect(params.map((p) => p.key)).toEqual(["amount", "duration"]);
  });

  it("reseedVelocity writes a different seed in range", () => {
    const { adapter, box, editing } = midiEffectFixture("velocity");
    if (!(adapter instanceof VelocityDeviceBoxAdapter) || !("randomSeed" in box)) throw new Error("not a velocity fixture");
    const before = box.randomSeed.getValue();
    reseedVelocity(editing, adapter);
    const after = box.randomSeed.getValue();
    expect(after).not.toBe(before);
    expect(Number.isInteger(after)).toBe(true);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(0xffff);
  });

  it("every device carries a lane note per page, and the shared listen-for names no page's lane", () => {
    for (const id of DEVICE_IDS) {
      const { laneNote, listenFor } = DEVICES[id];
      expect(Object.keys(laneNote).sort()).toEqual(["effects", "rendered"]);
      expect(listenFor).not.toMatch(/lane|Rendered page/);
    }
  });

  it("the zeitgeist snippet narrows the groove before reading its parameters", () => {
    expect(DEVICES.zeitgeist.snippet).toContain("instanceof GrooveShuffleBoxAdapter");
  });

  it("deviceIdOf names a box by its class", () => {
    expect(deviceIdOf(midiEffectFixture("pitch").box)).toBe("pitch");
  });
});
