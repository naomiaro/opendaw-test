import { describe, expect, it } from "vitest";
import { UUID } from "@opendaw/lib-std";
import type { ClipNotification } from "@opendaw/studio-adapters";
import { applyClipNotification, type ClipStateMap } from "./clipStates";

const a = UUID.generate();
const b = UUID.generate();
const key = (u: UUID.Bytes) => UUID.toString(u);
const empty: ClipStateMap = new Map();

describe("applyClipNotification", () => {
  it("marks scheduled clips waiting", () => {
    const n: ClipNotification = { type: "waiting", clips: [a] };
    expect(applyClipNotification(empty, n).get(key(a))).toBe("waiting");
  });
  it("keeps an already-playing clip playing while another waits (handover)", () => {
    const playing: ClipStateMap = new Map([[key(a), "playing"]]);
    const next = applyClipNotification(playing, { type: "waiting", clips: [b] });
    expect(next.get(key(a))).toBe("playing");
    expect(next.get(key(b))).toBe("waiting");
  });
  it("promotes started clips and clears stopped/obsolete", () => {
    const prev: ClipStateMap = new Map([[key(a), "playing"], [key(b), "waiting"]]);
    const n: ClipNotification = {
      type: "sequencing",
      changes: { started: [b], stopped: [a], obsolete: [] },
    };
    const next = applyClipNotification(prev, n);
    expect(next.get(key(b))).toBe("playing");
    expect(next.has(key(a))).toBe(false);
  });
  it("does not mutate the previous map", () => {
    const prev: ClipStateMap = new Map();
    applyClipNotification(prev, { type: "waiting", clips: [a] });
    expect(prev.size).toBe(0);
  });
  it("clears a waiting clip via a non-empty obsolete list", () => {
    const prev: ClipStateMap = new Map([[key(a), "waiting"]]);
    const n: ClipNotification = {
      type: "sequencing",
      changes: { started: [], stopped: [], obsolete: [a] },
    };
    const next = applyClipNotification(prev, n);
    expect(next.has(key(a))).toBe(false);
  });
  it("resolves the same uuid in both stopped and started to playing (delete-then-set ordering)", () => {
    const prev: ClipStateMap = new Map([[key(a), "playing"]]);
    const n: ClipNotification = {
      type: "sequencing",
      changes: { started: [a], stopped: [a], obsolete: [] },
    };
    const next = applyClipNotification(prev, n);
    expect(next.get(key(a))).toBe("playing");
  });
});
