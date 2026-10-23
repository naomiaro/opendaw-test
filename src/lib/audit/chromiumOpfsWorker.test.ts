import { describe, expect, it } from "vitest";
import { OPFS_WORKER_SOURCE, type OpfsWorkerAnswer } from "./chromiumOpfsWorker";

/** What the stubbed handle does on each call; a name here throws an Error of that message. */
interface Faults {
  write?: string;
  close?: string;
  removeEntry?: string;
}

/**
 * Runs the worker source against a stubbed OPFS: one `test/` folder, one file whose sync access
 * handle fails as `faults` says. Resolves with the worker's answer and the names `removeEntry()`
 * was called with.
 */
async function runWorker(request: unknown, faults: Faults): Promise<{ answer: OpfsWorkerAnswer; removed: string[] }> {
  const removed: string[] = [];
  const present = new Set<string>();
  const fail = (what: string | undefined) => {
    if (what !== undefined) throw new Error(what);
  };
  const handle = () => ({
    write: (data: Uint8Array) => {
      fail(faults.write);
      return data.length;
    },
    flush: () => {},
    close: () => fail(faults.close),
    getSize: () => 0,
    truncate: () => {},
  });
  const notFound = () => Object.assign(new Error("not found"), { name: "NotFoundError" });
  const testDir = {
    kind: "directory",
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (options?.create === true) present.add(name);
      if (!present.has(name)) throw notFound();
      return { kind: "file", createSyncAccessHandle: async () => handle(), getFile: async () => ({ size: 0 }) };
    },
    removeEntry: async (name: string) => {
      removed.push(name);
      fail(faults.removeEntry);
      present.delete(name);
    },
    entries: async function* () {},
  };
  const root = {
    kind: "directory",
    getDirectoryHandle: async () => testDir,
    entries: async function* () {},
  };
  const self: { onmessage: ((event: { data: unknown }) => Promise<void>) | null; postMessage: (answer: OpfsWorkerAnswer) => void } = {
    onmessage: null,
    postMessage: () => {},
  };
  const navigator = { storage: { estimate: async () => ({ usage: 10, quota: 100 }), getDirectory: async () => root } };
  class FileSystemFileHandle {
    createSyncAccessHandle() {}
  }
  new Function("self", "navigator", "FileSystemFileHandle", "performance", OPFS_WORKER_SOURCE)(self, navigator, FileSystemFileHandle, performance);
  const answer = await new Promise<OpfsWorkerAnswer>((resolve) => {
    self.postMessage = resolve;
    void self.onmessage?.({ data: request });
  });
  return { answer, removed };
}

const usage = { kind: "usage", runToken: "t", mib: 2, truncateFirst: false };
const flush = { kind: "flush", runToken: "t", counts: 2 };

describe("the OPFS worker's cleanup", () => {
  it("removes the file and reports the write's error when the write and the close both throw", async () => {
    const { answer, removed } = await runWorker(usage, { write: "write-failed", close: "close-failed" });
    expect(removed).toEqual(["t.bin"]);
    expect(answer).toEqual({ ok: false, error: "Error: write-failed" });
  });

  it("reports the close's error when only the close throws, after removing the file", async () => {
    const { answer, removed } = await runWorker(usage, { close: "close-failed" });
    expect(removed).toEqual(["t.bin"]);
    expect(answer).toEqual({ ok: false, error: "Error: close-failed" });
  });

  it("reports the write's error, not the delete's, when both throw", async () => {
    const { answer } = await runWorker(usage, { write: "write-failed", removeEntry: "remove-failed" });
    expect(answer).toEqual({ ok: false, error: "Error: write-failed" });
  });

  it("does the same for the flush series", async () => {
    const { answer, removed } = await runWorker(flush, { write: "write-failed", close: "close-failed" });
    expect(removed).toEqual(["t-flush.bin"]);
    expect(answer).toEqual({ ok: false, error: "Error: write-failed" });
  });

  it("answers a clean usage run with the bytes written and the file gone", async () => {
    const { answer, removed } = await runWorker(usage, {});
    expect(removed).toEqual(["t.bin"]);
    expect(answer).toMatchObject({ ok: true, kind: "usage", writtenBytes: 2 * 1024 * 1024, removed: true, beforeWrite: 10 });
  });
});
