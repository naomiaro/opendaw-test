/**
 * What a component test needs that jsdom does not have. Import this first in a
 * test file that starts with `// @vitest-environment jsdom`. For unit tests
 * only — nothing in the app imports this file.
 *
 * jsdom lays nothing out: every element measures 0 x 0 unless a test says
 * otherwise (see `layOut`), and a canvas has no drawing context.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { AnimationFrame } from "@opendaw/lib-dom";

// jsdom lays nothing out, so nothing ever changes size by itself. `resize()`
// tells the observers of an element that it did.
const observers = new Set<ResizeObserverStub>();

class ResizeObserverStub {
  readonly targets = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    observers.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    observers.delete(this);
  }
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

/** Tell whoever observes `element` that its size changed. Returns how many were told. */
export function resize(element: Element): number {
  let told = 0;
  for (const observer of [...observers]) {
    if (!observer.targets.has(element)) continue;
    observer.callback([], observer as unknown as ResizeObserver);
    told++;
  }
  return told;
}

// Pointer capture is what keeps a drag alive when the pointer leaves the handle.
const captured = new WeakMap<Element, Set<number>>();
Element.prototype.setPointerCapture = function (pointerId: number): void {
  const ids = captured.get(this) ?? new Set<number>();
  ids.add(pointerId);
  captured.set(this, ids);
};
Element.prototype.releasePointerCapture = function (pointerId: number): void {
  captured.get(this)?.delete(pointerId);
};
Element.prototype.hasPointerCapture = function (pointerId: number): boolean {
  return captured.get(this)?.has(pointerId) ?? false;
};
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function (): void {};
}

// jsdom has no canvas and says so loudly on every call. Components here
// already cope with a missing context; `installFakeContext2d` gives them one.
const noContext = function (): null {
  return null;
} as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.getContext = noContext;

let framesRunning = false;
// lib-dom keeps the last frame's time for the life of the module, and skips a
// frame whose time does not move on. So this only ever rises, across tests too.
let frameTime = 1000;

afterEach(() => {
  cleanup();
  observers.clear();
  HTMLCanvasElement.prototype.getContext = noContext;
  if (framesRunning) {
    AnimationFrame.terminate();
    framesRunning = false;
  }
});

/**
 * Run the SDK's animation frames by hand. Nothing in a component that waits
 * for a frame (a canvas repaint, a marker that follows a value) happens until
 * `tick()` is called. Call before rendering.
 */
export function driveFrames(): { tick: (milliseconds?: number) => void } {
  let callback: ((time: number) => void) | null = null;
  const owner = {
    requestAnimationFrame: (next: (time: number) => void): number => {
      callback = next;
      return 1;
    },
    cancelAnimationFrame: (): void => {},
  };
  AnimationFrame.start(owner as unknown as Window);
  framesRunning = true;
  return {
    tick: (milliseconds = 20) => {
      frameTime += milliseconds;
      callback?.(frameTime);
    },
  };
}

const CONTEXT_2D_METHODS = new Set([
  "arc", "beginPath", "bezierCurveTo", "clearRect", "clip", "closePath", "createLinearGradient",
  "drawImage", "fill", "fillRect", "fillText", "getImageData", "lineTo", "measureText", "moveTo",
  "putImageData", "quadraticCurveTo", "rect", "resetTransform", "restore", "rotate", "save",
  "scale", "setLineDash", "setTransform", "stroke", "strokeRect", "strokeText", "translate",
]);
const CONTEXT_2D_PROPERTIES = new Set([
  "fillStyle", "font", "globalAlpha", "globalCompositeOperation", "imageSmoothingEnabled",
  "lineCap", "lineDashOffset", "lineJoin", "lineWidth", "strokeStyle", "textAlign", "textBaseline",
]);

/**
 * Give every canvas created from now until the end of the test a drawing
 * context that records the calls made on it. Call before rendering.
 *
 * It knows the names a real 2D context has and throws for any other, so a
 * misspelt call fails here as it would on a real canvas. All canvases share
 * the one list of calls.
 */
export function installFakeContext2d(): { calls: string[] } {
  const calls: string[] = [];
  const values: Record<string, unknown> = {};
  const context = new Proxy({} as Record<string, unknown>, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      if (CONTEXT_2D_PROPERTIES.has(property)) return values[property];
      if (CONTEXT_2D_METHODS.has(property)) {
        return (...args: unknown[]) => {
          calls.push(`${property}(${args.join(",")})`);
        };
      }
      throw new Error(`A 2D canvas context has no "${property}"`);
    },
    set: (_target, property, value) => {
      if (typeof property !== "string" || !CONTEXT_2D_PROPERTIES.has(property)) {
        throw new Error(`A 2D canvas context has no "${String(property)}"`);
      }
      values[property] = value;
      return true;
    },
  });
  HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement["getContext"];
  return { calls };
}

/** Give an element a size and a place, as a browser's layout would */
export function layOut(element: Element, box: { left: number; top: number; width: number; height: number }): void {
  const rect = {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  };
  element.getBoundingClientRect = () => rect as DOMRect;
  Object.defineProperty(element, "clientWidth", { configurable: true, value: box.width });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: box.height });
}
