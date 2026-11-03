import { describe, expect, it } from "vitest";
import { midiEffectFixture } from "@/lib/testing/boxGraphFixtures";
import { DEVICES, DEVICE_IDS, deviceIdOf, deviceParameters } from "./devices";

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

  it("deviceIdOf names a box by its class", () => {
    expect(deviceIdOf(midiEffectFixture("pitch").box)).toBe("pitch");
  });
});
