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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
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

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = noContext;
});

/**
 * Give every canvas created from now until the end of the test a drawing
 * context that records the calls made on it. Call before rendering.
 */
export function installFakeContext2d(): { calls: string[] } {
  const calls: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, property) => {
      if (typeof property !== "string") return undefined;
      if (property in target) return target[property];
      return (...args: unknown[]) => {
        calls.push(`${property}(${args.join(",")})`);
      };
    },
    set: (target, property, value) => {
      if (typeof property === "string") target[property] = value;
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
