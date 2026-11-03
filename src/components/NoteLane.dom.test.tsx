// @vitest-environment jsdom
import { driveFrames, installFakeContext2d, layOut, resize } from "@/lib/testing/domSetup";
import React, { createRef } from "react";
import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { NoteLane, type LaneNote, type NoteLaneHandle } from "./NoteLane";

const WIDTH = 400;
const RANGE = 7680;

function show(notes: () => readonly LaneNote[], ref?: React.Ref<NoteLaneHandle>) {
  const ctx = installFakeContext2d();
  const frames = driveFrames();
  const { container } = render(
    <NoteLane ref={ref} title="t" notes={notes} rangePpqn={RANGE} pitchLow={36} pitchHigh={96} height={96} shadeByVelocity={false} />
  );
  const canvas = container.querySelector("canvas")!;
  layOut(canvas, { left: 0, top: 0, width: WIDTH, height: 96 });
  resize(canvas);
  frames.tick();
  return { ctx, container, frames };
}

const fillRects = (calls: string[]) => calls.filter((c) => c.startsWith("fillRect("));

describe("NoteLane", () => {
  it("draws one bar at the note's x range", () => {
    const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840 }]);
    // 1920/7680 × 400 = 100 wide from x 100
    expect(fillRects(ctx.calls).some((c) => c.startsWith("fillRect(100,") && c.split(",")[2] === "100")).toBe(true);
  });

  it("out-of-range note marked", () => {
    const { ctx, container } = show(() => [{ pitch: 100, from: 0, to: 960 }]);
    expect(fillRects(ctx.calls).some((c) => /^fillRect\(\d+(\.\d+)?,0,\d+(\.\d+)?,3\)$/.test(c))).toBe(true);
    expect(container.textContent).toContain("1 out of range");
  });

  it("requestUpdate repaints with the new notes", () => {
    const ref = createRef<NoteLaneHandle>();
    let notes: LaneNote[] = [];
    const { ctx, frames } = show(() => notes, ref);
    const before = fillRects(ctx.calls).length;
    notes = [{ pitch: 60, from: 0, to: 960 }];
    frames.tick();
    expect(fillRects(ctx.calls).length).toBe(before);
    act(() => ref.current!.requestUpdate());
    frames.tick();
    expect(fillRects(ctx.calls).length).toBeGreaterThan(before);
  });
});
