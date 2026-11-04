// @vitest-environment jsdom
import { driveFrames, installFakeContext2d, layOut, resize } from "@/lib/testing/domSetup";
import React, { createRef } from "react";
import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { velocityColor } from "@/lib/midiEffects/velocityColor";
import { VelocityStrip, type Stem, type VelocityStripHandle } from "./VelocityStrip";

const WIDTH = 400;
const RANGE = 7680;
const HEIGHT = 64;

function show(ghosts: () => readonly Stem[], stems: () => readonly Stem[], ref?: React.Ref<VelocityStripHandle>) {
  const ctx = installFakeContext2d();
  const frames = driveFrames();
  const { container } = render(<VelocityStrip ref={ref} title="t" ghosts={ghosts} stems={stems} rangePpqn={RANGE} height={HEIGHT} />);
  const canvas = container.querySelector("canvas")!;
  layOut(canvas, { left: 0, top: 0, width: WIDTH, height: HEIGHT });
  resize(canvas);
  frames.tick();
  return { ctx, container, frames };
}

const fillRects = (calls: string[]) => calls.filter((c) => c.startsWith("fillRect("));
const args = (call: string) => call.slice("fillRect(".length, -1).split(",").map(Number);

describe("VelocityStrip", () => {
  it("draws one stem per emitted note with height by velocity", () => {
    const { ctx } = show(() => [], () => [{ at: 1920, velocity: 0.5 }]);
    const rects = fillRects(ctx.calls).map(args).filter(([x]) => x >= 100 && x <= 104);
    expect(rects.length).toBe(1);
    expect(rects[0][3]).toBeCloseTo(0.5 * (HEIGHT - 14), 1);
  });

  it("clamps a velocity above 1 to the full stem height", () => {
    const { ctx } = show(() => [], () => [{ at: 1920, velocity: 1.5 }]);
    const rects = fillRects(ctx.calls).map(args).filter(([x]) => x >= 100 && x <= 104);
    expect(rects.length).toBe(1);
    expect(rects[0][3]).toBeCloseTo(HEIGHT - 14, 1);
  });

  it("draws a ghost before the stem at the same onset, in the structural colour", () => {
    const { ctx } = show(() => [{ at: 1920, velocity: 1 }], () => [{ at: 1920, velocity: 0.5 }]);
    const styles = ctx.sets.map((s) => s.set).filter((s) => s.startsWith("fillStyle="));
    expect(styles.indexOf(`fillStyle=${CANVAS_COLORS.structural}`)).toBeGreaterThanOrEqual(0);
    expect(styles.indexOf(`fillStyle=${velocityColor(0.5)}`)).toBeGreaterThanOrEqual(0);
    expect(styles.indexOf(`fillStyle=${CANVAS_COLORS.structural}`)).toBeLessThan(styles.indexOf(`fillStyle=${velocityColor(0.5)}`));
  });

  it("draws the stem one pixel right of its ghost at the same onset, both at the stem width", () => {
    const { ctx } = show(() => [{ at: 1920, velocity: 1 }], () => [{ at: 1920, velocity: 0.5 }]);
    const rects = fillRects(ctx.calls).map(args).filter(([x]) => x >= 100 && x <= 104);
    expect(rects.map(([x, , w]) => [x, w])).toEqual([[100, 3], [101, 3]]);
  });

  it("repaints on requestUpdate", () => {
    const ref = createRef<VelocityStripHandle>();
    let stems: Stem[] = [];
    const { ctx, frames } = show(() => [], () => stems, ref);
    const before = fillRects(ctx.calls).length;
    stems = [{ at: 0, velocity: 1 }];
    frames.tick();
    expect(fillRects(ctx.calls).length).toBe(before);
    act(() => ref.current!.requestUpdate());
    frames.tick();
    expect(fillRects(ctx.calls).length).toBeGreaterThan(before);
    expect(fillRects(ctx.calls).map(args).some(([x, , w]) => x === 1 && w === 3)).toBe(true);
  });
});
