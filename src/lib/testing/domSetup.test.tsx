// @vitest-environment jsdom
import { driveFrames, installFakeContext2d, layOut, resize } from "./domSetup";
import { describe, it, expect } from "vitest";
import { AnimationFrame } from "@opendaw/lib-dom";

const context2d = (): CanvasRenderingContext2D =>
  document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;

describe("the fake 2D context", () => {
  it("gives a canvas no context until one is installed", () => {
    expect(document.createElement("canvas").getContext("2d")).toBeNull();
  });

  it("records the calls made on it, in order", () => {
    const { calls } = installFakeContext2d();
    const context = context2d();

    context.clearRect(0, 0, 10, 20);
    context.fillRect(1, 2, 3, 4);

    expect(calls).toEqual(["clearRect(0,0,10,20)", "fillRect(1,2,3,4)"]);
  });

  it("keeps the values written to it", () => {
    installFakeContext2d();
    const context = context2d();

    context.fillStyle = "#fff";
    context.globalAlpha = 0.3;

    expect(context.fillStyle).toBe("#fff");
    expect(context.globalAlpha).toBe(0.3);
  });

  it("throws for a call a real context does not have", () => {
    installFakeContext2d();
    const context = context2d() as unknown as Record<string, () => void>;

    expect(() => context.fillrect()).toThrow('A 2D canvas context has no "fillrect"');
  });

  it("throws for a value a real context does not have", () => {
    installFakeContext2d();
    const context = context2d() as unknown as Record<string, unknown>;

    expect(() => { context.fillColor = "#fff"; }).toThrow('A 2D canvas context has no "fillColor"');
  });

  it("is gone again in the next test", () => {
    expect(document.createElement("canvas").getContext("2d")).toBeNull();
  });
});

describe("driveFrames", () => {
  it("runs frame work only when told to", () => {
    const clock = driveFrames();
    let runs = 0;
    const frame = AnimationFrame.add(() => { runs++; });

    expect(runs).toBe(0);
    clock.tick();
    clock.tick();

    expect(runs).toBe(2);
    frame.terminate();
  });

  it("still runs frames in a later test", () => {
    const clock = driveFrames();
    let runs = 0;
    const frame = AnimationFrame.add(() => { runs++; });

    clock.tick();

    expect(runs).toBe(1);
    frame.terminate();
  });
});

describe("resize", () => {
  it("tells the observers of an element, and only those", () => {
    const watched = document.createElement("div");
    const other = document.createElement("div");
    let calls = 0;
    const observer = new ResizeObserver(() => { calls++; });
    observer.observe(watched);

    expect(resize(other)).toBe(0);
    expect(resize(watched)).toBe(1);
    expect(calls).toBe(1);
  });

  it("tells nobody once the observer has disconnected", () => {
    const watched = document.createElement("div");
    let calls = 0;
    const observer = new ResizeObserver(() => { calls++; });
    observer.observe(watched);

    observer.disconnect();

    expect(resize(watched)).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("layOut", () => {
  it("gives an element the size and place a browser's layout would", () => {
    const element = document.createElement("div");

    layOut(element, { left: 100, top: 10, width: 640, height: 180 });

    expect(element.clientWidth).toBe(640);
    expect(element.clientHeight).toBe(180);
    expect(element.getBoundingClientRect().left).toBe(100);
    expect(element.getBoundingClientRect().right).toBe(740);
  });
});
