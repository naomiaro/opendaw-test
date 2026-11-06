import { describe, expect, it } from "vitest";
import { UUID } from "@opendaw/lib-std";
import { assertUuidOrder, installUuidOrder } from "./ascendingUuids.ts";

describe("ordered UUIDs", () => {
  it("hands out strictly ascending, well-formed bytes", () => {
    const uuid = { generate: () => new Uint8Array(16) };
    installUuidOrder(uuid, "ascending");
    const [a, b] = [uuid.generate(), uuid.generate()];
    expect(a[6]).toBe(0x40);
    expect(a[8]).toBe(0x80);
    expect(a.buffer.byteLength).toBe(16);
    expect(UUID.Comparator(a, b)).toBeLessThan(0);
  });
  it("hands out strictly descending bytes on request", () => {
    const uuid = { generate: () => new Uint8Array(16) };
    installUuidOrder(uuid, "descending");
    expect(UUID.Comparator(uuid.generate(), uuid.generate())).toBeGreaterThan(0);
  });
  it("names a wrong order", () => {
    const uuid = { generate: () => new Uint8Array(16) };
    installUuidOrder(uuid, "descending");
    const list = [uuid.generate(), uuid.generate()];
    expect(() => assertUuidOrder(list, "ascending")).toThrow(/ascending/);
    expect(() => assertUuidOrder(list, "descending")).not.toThrow();
  });
});
