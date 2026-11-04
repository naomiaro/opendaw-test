// @vitest-environment jsdom
import { driveFrames, installFakeContext2d, layOut, resize } from "@/lib/testing/domSetup";
import React, { createRef } from "react";
import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { NoteLane, type LaneNote, type NoteLaneHandle } from "./NoteLane";

const WIDTH = 400;
const RANGE = 7680;

function show(notes: () => readonly LaneNote[], ref?: React.Ref<NoteLaneHandle>, position?: () => number, shadeByVelocity = false) {
  const ctx = installFakeContext2d();
  const frames = driveFrames();
  const { container } = render(
    <NoteLane ref={ref} title="t" notes={notes} rangePpqn={RANGE} pitchLow={36} pitchHigh={96} height={96} shadeByVelocity={shadeByVelocity} position={position} />
  );
  const canvas = container.querySelector("canvas")!;
  layOut(canvas, { left: 0, top: 0, width: WIDTH, height: 96 });
  resize(canvas);
  frames.tick();
  return { ctx, container, frames };
}

const showShaded = (notes: () => readonly LaneNote[]) => show(notes, undefined, undefined, true);

const fillRects = (calls: string[]) => calls.filter((c) => c.startsWith("fillRect("));
const args = (call: string) => call.slice("fillRect(".length, -1).split(",").map(Number);

describe("NoteLane", () => {
  it("draws one bar at the note's x range", () => {
    const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840 }]);
    // 1920/7680 × 400 = 100 wide from x 100
    expect(fillRects(ctx.calls).some((c) => c.startsWith("fillRect(100,") && c.split(",")[2] === "100")).toBe(true);
  });

  it("draws a higher pitch higher up: pitch 60 sits on row 36 of 61", () => {
    const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840 }]);
    const bar = fillRects(ctx.calls).map(args).find(([x, , w]) => x === 100 && w === 100);
    expect(bar).toBeDefined();
    expect(bar![1]).toBeCloseTo((96 - 60) * (96 / 61), 1);
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
    expect(fillRects(ctx.calls).map(args).some(([x, , w]) => x === 0 && w === 50)).toBe(true);
  });

  it("follows the position: the playhead overlay moves and an open bar ends at it", () => {
    const { ctx, container, frames } = show(() => [{ pitch: 60, from: 1920, to: null }], undefined, () => 3840);
    frames.tick();
    const overlay = container.querySelector("div[style*='pointer-events: none']") as HTMLDivElement;
    expect(overlay.style.left).toBe("200px");
    expect(fillRects(ctx.calls).map(args).some(([x, , w]) => x === 100 && w === 100)).toBe(true);
  });

  it("a zero beat grid does not hang the paint", () => {
    const ctx = installFakeContext2d();
    const frames = driveFrames();
    const { container } = render(
      <NoteLane title="t" notes={() => []} rangePpqn={RANGE} pitchLow={36} pitchHigh={96} height={96} shadeByVelocity={false} beatPpqn={0} />
    );
    const canvas = container.querySelector("canvas")!;
    layOut(canvas, { left: 0, top: 0, width: WIDTH, height: 96 });
    resize(canvas);
    frames.tick();
    expect(ctx.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("fills a shaded bar with the velocity ramp colour", () => {
    const { ctx } = showShaded(() => [{ pitch: 60, from: 1920, to: 3840, velocity: 0.6 }]);
    const i = ctx.calls.findIndex((c) => c.startsWith("fillRect(100,"));
    expect(i).toBeGreaterThan(0);
    expect(ctx.calls.slice(0, i).filter((c) => c.startsWith("fillStyle=")).at(-1)).toBe(`fillStyle=${velocityColor(0.6)}`);
  });
  it("draws a hollow note as an outline and no fill", () => {
    const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840, hollow: true }]);
    expect(ctx.calls.some((c) => c.startsWith("strokeRect(100,"))).toBe(true);
    expect(ctx.calls.some((c) => c.startsWith("fillRect(100,") && c.split(",")[2] === "100")).toBe(false);
  });
  it("dashes the edges of a rule-placed bar", () => {
    const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840, dashedEdges: true }]);
    expect(ctx.calls.some((c) => c.startsWith("setLineDash(2,2"))).toBe(true);
    const last = ctx.calls.filter((c) => c.startsWith("setLineDash(")).at(-1);
    expect(last).toBe("setLineDash()");
  });
  it("writes a note's label beside it", () => {
    const { ctx } = show(() => [{ pitch: 60, from: 1920, to: 3840, label: "+25¢" }]);
    expect(ctx.calls.some((c) => c.startsWith("fillText(+25¢,"))).toBe(true);
  });
});
