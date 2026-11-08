/** 32-bit float WAV (format 3), little-endian: the one container the harness stores renders in. */

const HEADER_BYTES = 44;
const FORMAT_FLOAT = 3;

export function encodeFloatWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const dataBytes = frames * count * 4;
  const out = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(out);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_FLOAT, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 4, true);
  view.setUint16(32, count * 4, true);
  view.setUint16(34, 32, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  // Interleave by copying each sample's four bytes, so NaN payloads and -0 are kept as stored.
  const bytes = new Uint8Array(out);
  channels.forEach((channel, c) => {
    if (channel.length !== frames) throw new Error(`encodeFloatWav: channel ${c} has ${channel.length} frames, not ${frames}`);
    const source = new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength);
    for (let f = 0; f < frames; f++) {
      bytes.set(source.subarray(f * 4, f * 4 + 4), HEADER_BYTES + (f * count + c) * 4);
    }
  });
  return out;
}

export function decodeFloatWav(input: ArrayBuffer | Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagAt = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tagAt(0) !== "RIFF" || tagAt(8) !== "WAVE") throw new Error("decodeFloatWav: not a RIFF/WAVE file");
  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tagAt(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true)
      };
    } else if (id === "data") {
      if (format === null) throw new Error("decodeFloatWav: data chunk before fmt chunk");
      if (format.code !== FORMAT_FLOAT || format.bits !== 32) {
        throw new Error(`decodeFloatWav: expected 32-bit float, got format ${format.code} at ${format.bits} bits`);
      }
      const { channels: count, sampleRate } = format;
      const available = Math.min(size, bytes.length - body);
      const frames = Math.floor(available / (count * 4));
      const channels: Float32Array[] = [];
      for (let c = 0; c < count; c++) {
        const copy = new Uint8Array(frames * 4);
        for (let f = 0; f < frames; f++) {
          copy.set(bytes.subarray(body + (f * count + c) * 4, body + (f * count + c) * 4 + 4), f * 4);
        }
        channels.push(new Float32Array(copy.buffer));
      }
      return { sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("decodeFloatWav: no data chunk");
}
