// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOCK_SLOW_NOTICE_ID, showClockSlowNotice } from "./clockSlowNotice";

afterEach(() => {
  document.getElementById(CLOCK_SLOW_NOTICE_ID)?.remove();
  vi.restoreAllMocks();
});

const buttons = () => [...document.querySelectorAll(`#${CLOCK_SLOW_NOTICE_ID} button`)] as HTMLButtonElement[];

describe("showClockSlowNotice", () => {
  it("shows an alert that says how slow the audio runs, and logs it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(document.getElementById(CLOCK_SLOW_NOTICE_ID)).toBeNull();
    showClockSlowNotice(document, 0.5, () => {});
    const bar = document.getElementById(CLOCK_SLOW_NOTICE_ID)!;
    expect(bar.getAttribute("role")).toBe("alert");
    expect(bar.textContent).toContain("50% speed");
    expect(bar.textContent).toContain("Reload the page");
    expect(bar.textContent).toContain("discards anything you have not exported");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reloads only when the visitor presses Reload", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();
    showClockSlowNotice(document, 0.5, reload);
    expect(reload).not.toHaveBeenCalled();
    buttons().find((b) => b.textContent === "Reload")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("goes away on Dismiss without reloading", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();
    showClockSlowNotice(document, 0.5, reload);
    buttons().find((b) => b.textContent === "Dismiss")!.click();
    expect(document.getElementById(CLOCK_SLOW_NOTICE_ID)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows one bar however often it is raised, with the latest reading", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    showClockSlowNotice(document, 0.5, () => {});
    showClockSlowNotice(document, 0.48, () => {});
    expect(document.querySelectorAll(`#${CLOCK_SLOW_NOTICE_ID}`)).toHaveLength(1);
    expect(document.getElementById(CLOCK_SLOW_NOTICE_ID)!.textContent).toContain("48% speed");
  });
});
