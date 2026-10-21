import { afterEach, describe, expect, it } from "vitest";
import { createWorkerTicker } from "./workerTicker";

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminated = false;
  constructor(public readonly url: string) { FakeWorker.last = this; }
  terminate(): void { this.terminated = true; }
}

const g = globalThis as unknown as { Worker?: unknown; URL: { createObjectURL?: unknown; revokeObjectURL?: unknown } };
const saved = { Worker: g.Worker, create: g.URL.createObjectURL, revoke: g.URL.revokeObjectURL };
afterEach(() => { g.Worker = saved.Worker; g.URL.createObjectURL = saved.create; g.URL.revokeObjectURL = saved.revoke; });

function install(): void {
  g.Worker = FakeWorker;
  g.URL.createObjectURL = () => "blob:fake";
  g.URL.revokeObjectURL = () => {};
}

describe("createWorkerTicker", () => {
  it("reports a worker that fails instead of leaving its subscribers waiting", () => {
    install();
    const reported: string[] = [];
    const ticker = createWorkerTicker(20, (m) => reported.push(m));
    let ticks = 0;
    ticker.subscribe(() => ticks++);
    const worker = FakeWorker.last as FakeWorker;
    worker.onerror?.({ message: "Refused to create a worker" });
    expect(reported).toEqual(["Refused to create a worker"]);
    worker.onmessage?.({});
    expect(ticks).toBe(1);
    ticker.terminate();
    expect(worker.terminated).toBe(true);
  });
});
