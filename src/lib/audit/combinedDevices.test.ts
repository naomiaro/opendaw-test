import { describe, expect, it } from "vitest";
import { pickAudioDevice } from "./combinedDevices";

const d = (deviceId: string, label: string, kind: "audioinput" | "audiooutput" = "audioinput") => ({ deviceId, label, kind });

describe("pickAudioDevice", () => {
  it("prefers the built-in MacBook device when no substring is given", () => {
    expect(pickAudioDevice([d("x", "USB Audio CODEC"), d("m", "MacBook Pro Microphone (Built-in)")], "audioinput", null))
      .toEqual({ deviceId: "m", label: "MacBook Pro Microphone (Built-in)" });
  });
  it("falls back to the first device of the kind", () => {
    expect(pickAudioDevice([d("s", "Speakers", "audiooutput"), d("x", "USB Audio CODEC")], "audioinput", null))
      .toEqual({ deviceId: "x", label: "USB Audio CODEC" });
  });
  it("matches a substring case-insensitively and lists the labels when nothing matches", () => {
    expect(pickAudioDevice([d("x", "USB Audio CODEC")], "audioinput", "usb")).toEqual({ deviceId: "x", label: "USB Audio CODEC" });
    expect(pickAudioDevice([d("x", "USB Audio CODEC")], "audioinput", "Scarlett")).toMatchObject({ error: expect.stringContaining("USB Audio CODEC") });
  });
  it("names the permission step when there is no device of the kind", () => {
    expect(pickAudioDevice([d("s", "Speakers", "audiooutput")], "audioinput", null)).toMatchObject({ error: expect.stringMatching(/microphone|permission/i) });
  });
});
