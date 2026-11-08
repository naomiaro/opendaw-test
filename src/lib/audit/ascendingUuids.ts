export type UuidNamespace = { generate: () => Uint8Array };

/**
 * Replaces `generate` so the bytes rise or fall with each call: audio unit UUIDs set the summing
 * order, so a run fixes it instead of leaving it to chance.
 */
export const installUuidOrder = (uuid: UuidNamespace, order: "ascending" | "descending"): void => {
  let counter = order === "ascending" ? 1 : 0x7fffffff;
  uuid.generate = () => {
    const bytes = new Uint8Array(16);
    bytes[6] = 0x40;
    bytes[8] = 0x80;
    new DataView(bytes.buffer).setUint32(12, counter, false);
    counter += order === "ascending" ? 1 : -1;
    return bytes;
  };
};

const compare = (a: Uint8Array, b: Uint8Array): number => {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export const assertUuidOrder = (uuids: readonly Uint8Array[], order: "ascending" | "descending"): void => {
  const sign = order === "ascending" ? 1 : -1;
  for (let i = 1; i < uuids.length; i++) {
    if (sign * compare(uuids[i - 1], uuids[i]) >= 0) {
      throw new Error(`UUIDs are not strictly ${order}: index ${i - 1} and ${i} break the order`);
    }
  }
};
