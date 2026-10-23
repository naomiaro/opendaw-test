import { describe, expect, it } from "vitest";
import { ManualSession, type ManualState } from "./chromiumSuspendResumeManual";

const row = (cycle: number) => ({ cycle, graphPurityDb: 60, micPurityDb: null, micClicks: null, clockRatio: 1 });

describe("ManualSession", () => {
  it("hands each press to the cycle waiting for it, and shows the table to every listener", async () => {
    const session = new ManualSession();
    const seen: ManualState[] = [];
    session.subscribe((state) => seen.push(state));
    session.start();
    const first = session.nextAction();
    expect(seen.at(-1)).toMatchObject({ active: true, awaiting: true });
    session.press("cycle");
    expect(await first).toBe("cycle");
    expect(seen.at(-1)).toMatchObject({ awaiting: false });
    session.addRow(row(1));
    const second = session.nextAction();
    session.press("finish");
    expect(await second).toBe("finish");
    session.end();
    expect(seen.at(-1)).toMatchObject({ active: false, awaiting: false, rows: [row(1)] });
  });

  it("ignores a press while no cycle waits for one", async () => {
    const session = new ManualSession();
    session.start();
    session.press("cycle");
    const next = session.nextAction();
    session.press("finish");
    expect(await next).toBe("finish");
  });

  it("stops telling a listener once it unsubscribes", () => {
    const session = new ManualSession();
    const seen: ManualState[] = [];
    const unsubscribe = session.subscribe((state) => seen.push(state));
    unsubscribe();
    session.start();
    expect(seen).toHaveLength(1);
  });
});
