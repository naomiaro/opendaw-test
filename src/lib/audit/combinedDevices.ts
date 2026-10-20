/** Audio device choice for the combined audit: the laptop's built-in pair by default, a substring of a label otherwise. */
export interface DeviceLike {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput" | "videoinput";
}

export interface PickedDevice {
  deviceId: string;
  label: string;
}

const KIND_NAME = { audioinput: "microphone", audiooutput: "speakers" } as const;

export function pickAudioDevice(
  devices: readonly DeviceLike[],
  kind: "audioinput" | "audiooutput",
  substring: string | null,
): PickedDevice | { error: string } {
  const ofKind = devices.filter((d) => d.kind === kind);
  if (ofKind.length === 0) {
    return { error: `no ${KIND_NAME[kind]} device listed — allow the ${KIND_NAME[kind] === "microphone" ? "microphone permission" : "audio output"} and reload` };
  }
  const pick = (d: DeviceLike): PickedDevice => ({ deviceId: d.deviceId, label: d.label });
  if (substring === null) {
    const builtIn = ofKind.find((d) => /macbook/i.test(d.label) && /built-in/i.test(d.label));
    return pick(builtIn ?? ofKind[0]);
  }
  const needle = substring.toLowerCase();
  const match = ofKind.find((d) => d.label.toLowerCase().includes(needle));
  if (match === undefined) {
    return { error: `no ${KIND_NAME[kind]} label contains "${substring}" (devices: ${ofKind.map((d) => d.label || "(unnamed)").join(", ")})` };
  }
  return pick(match);
}
