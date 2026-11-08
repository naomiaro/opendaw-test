import { describe, expect, it } from "vitest";
import { decodeFloatWav, encodeFloatWav } from "./exportRegressionWav.ts";

describe("float WAV codec", () => {
  it("round-trips every bit through a WAV, NaN payload and negative zero included", () => {
    const left = new Float32Array([0, -0, 0.1, NaN, 1e-40]);
    const right = new Float32Array([1, 2, 3, 4, 5]);
    const decoded = decodeFloatWav(encodeFloatWav([left, right], 44100));
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels).toHaveLength(2);
    expect(new Uint8Array(decoded.channels[0].buffer)).toEqual(new Uint8Array(left.buffer));
    expect(Array.from(decoded.channels[1])).toEqual(Array.from(right));
  });
  it("keeps a NaN payload that a sample-by-sample copy would canonicalise", () => {
    const left = new Float32Array(new Uint32Array([0x7fc00001, 0xffc12345]).buffer);
    const decoded = decodeFloatWav(encodeFloatWav([left], 48000));
    expect(Array.from(new Uint32Array(decoded.channels[0].buffer))).toEqual([0x7fc00001, 0xffc12345]);
  });
  it("refuses a 16-bit WAV", () => {
    const pcm16 = new ArrayBuffer(48);
    const view = new DataView(pcm16);
    const tag = (at: number, text: string) => [...text].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
    tag(0, "RIFF");
    tag(8, "WAVE");
    tag(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true);
    view.setUint16(34, 16, true);
    tag(36, "data");
    view.setUint32(40, 4, true);
    expect(() => decodeFloatWav(pcm16)).toThrow(/32-bit float/);
  });
});
