import { describe, expect, it } from "vitest";
import { installBfcacheReloadGuard } from "./bfcacheReloadGuard";

const pageShow = (persisted: boolean): Event => Object.assign(new Event("pageshow"), { persisted });

describe("installBfcacheReloadGuard", () => {
  it("reloads when the page is restored from the back/forward cache", () => {
    const page = new EventTarget();
    let reloads = 0;
    installBfcacheReloadGuard(page, () => { reloads++; });
    page.dispatchEvent(pageShow(true));
    expect(reloads).toBe(1);
  });

  it("leaves a page shown by a fresh navigation alone", () => {
    const page = new EventTarget();
    let reloads = 0;
    installBfcacheReloadGuard(page, () => { reloads++; });
    page.dispatchEvent(pageShow(false));
    expect(reloads).toBe(0);
  });

  it("leaves a pageshow that carries no persisted flag alone", () => {
    const page = new EventTarget();
    let reloads = 0;
    installBfcacheReloadGuard(page, () => { reloads++; });
    page.dispatchEvent(new Event("pageshow"));
    expect(reloads).toBe(0);
  });

  it("stops listening once terminated", () => {
    const page = new EventTarget();
    let reloads = 0;
    installBfcacheReloadGuard(page, () => { reloads++; }).terminate();
    page.dispatchEvent(pageShow(true));
    expect(reloads).toBe(0);
  });
});
