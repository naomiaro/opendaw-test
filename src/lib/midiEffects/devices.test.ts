import { describe, expect, it } from "vitest";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";
import { VelocityDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { DEVICES, DEVICE_IDS, deviceIdOf, deviceParameters, reseedVelocity } from "./devices";

describe("devices", () => {
  it("registers the four devices, each naming its factory", () => {
    expect(DEVICE_IDS).toEqual(["arpeggio", "pitch", "velocity", "zeitgeist"]);
    expect(DEVICE_IDS.map((id) => DEVICES[id].factoryKey)).toEqual(["Arpeggio", "Pitch", "Velocity", "Zeitgeist"]);
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

  it("the zeitgeist snippet narrows the groove before reading its parameters", () => {
    expect(DEVICES.zeitgeist.snippet).toContain("instanceof GrooveShuffleBoxAdapter");
  });

  it("deviceIdOf names a box by its class", () => {
    expect(deviceIdOf(midiEffectFixture("pitch").box)).toBe("pitch");
  });
});
