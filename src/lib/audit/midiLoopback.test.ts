import { describe, expect, it } from "vitest";
import { firstReceiptFor, pairReceipts, pickIacPorts, RECEIPT_WINDOW_MS } from "./midiLoopback";

describe("pickIacPorts", () => {
  const i = (id: string, name: string) => ({ id, name });
  it("pairs the input and output that share a name containing the substring", () => {
    expect(pickIacPorts([i("in1", "IAC Driver Bus 1"), i("in2", "Keystation")], [i("out1", "IAC Driver Bus 1")], "iac"))
      .toEqual({ inputId: "in1", outputId: "out1", name: "IAC Driver Bus 1" });
  });
  it("refuses when no pair exists and names the setup step", () => {
    expect(pickIacPorts([i("in2", "Keystation")], [], "IAC")).toMatchObject({ error: expect.stringContaining("Audio MIDI Setup") });
    expect(pickIacPorts([i("in1", "IAC Driver Bus 1")], [i("out1", "IAC Driver Bus 2")], "IAC")).toMatchObject({ error: expect.any(String) });
  });
  it("refuses an ambiguous set and lists the names", () => {
    const r = pickIacPorts([i("a", "IAC Driver Bus 1"), i("b", "IAC Driver Bus 2")], [i("c", "IAC Driver Bus 1"), i("d", "IAC Driver Bus 2")], "IAC");
    expect(r).toMatchObject({ error: expect.stringMatching(/Bus 1.*Bus 2.*\?bus=/s) });
  });
});

describe("pairReceipts", () => {
  const n = (pitch: number, on: number) => ({ pitch, velocity: 100, onPerfMs: on, offPerfMs: on + 100 });
  it("gives each scheduled note its own on and off receipt in time order", () => {
    const receipts = [
      { kind: "on" as const, pitch: 36, velocity: 100, timeStamp: 1000.4 },
      { kind: "off" as const, pitch: 36, velocity: 0, timeStamp: 1100.3 },
      { kind: "on" as const, pitch: 36, velocity: 100, timeStamp: 2000.6 },
      { kind: "off" as const, pitch: 36, velocity: 0, timeStamp: 2100.2 },
    ];
    expect(pairReceipts([n(36, 1000), n(36, 2000)], receipts))
      .toEqual([{ onPerfMs: 1000.4, offPerfMs: 1100.3 }, { onPerfMs: 2000.6, offPerfMs: 2100.2 }]);
  });
  it("leaves a note without a receipt null instead of stealing a later one", () => {
    const receipts = [{ kind: "on" as const, pitch: 36, velocity: 100, timeStamp: 2000.6 }];
    expect(pairReceipts([n(36, 1000), n(36, 2000)], receipts))
      .toEqual([{ onPerfMs: null, offPerfMs: null }, { onPerfMs: 2000.6, offPerfMs: null }]);
  });
});

describe("firstReceiptFor", () => {
  it("gives the first on-receipt of a pitch at or after a time, or null", () => {
    const receipts = [
      { kind: "on" as const, pitch: 85, velocity: 100, timeStamp: 500 },
      { kind: "off" as const, pitch: 85, velocity: 0, timeStamp: 600 },
      { kind: "on" as const, pitch: 85, velocity: 100, timeStamp: 900 },
    ];
    expect(firstReceiptFor(receipts, 85, 0)?.timeStamp).toBe(500);
    expect(firstReceiptFor(receipts, 85, 700)?.timeStamp).toBe(900);
    expect(firstReceiptFor(receipts, 86, 0)).toBeNull();
  });
});

describe("pairReceipts window", () => {
  it("takes a window: a receipt 300 ms late pairs at 400 and not at the default 50", () => {
    const scheduled = [{ pitch: 60, velocity: 100, onPerfMs: 1000, offPerfMs: 1050 }];
    const receipts = [
      { kind: "on" as const, pitch: 60, velocity: 100, timeStamp: 1300 },
      { kind: "off" as const, pitch: 60, velocity: 0, timeStamp: 1350 },
    ];
    expect(pairReceipts(scheduled, receipts)).toEqual([{ onPerfMs: null, offPerfMs: null }]);
    expect(pairReceipts(scheduled, receipts, 400)).toEqual([{ onPerfMs: 1300, offPerfMs: 1350 }]);
    expect(RECEIPT_WINDOW_MS).toBe(50);
  });
});
