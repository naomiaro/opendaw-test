import { describe, it, expect } from "vitest";
import { clearStoredSamples, PAGE_OPEN_LOCK, type PageLocks } from "./storedSamples";

/**
 * A stand-in for the browser's lock manager, for one lock name. `otherPageOpen`
 * models another page of this site holding the shared lock.
 */
class FakeLocks implements PageLocks {
  readonly log: string[] = [];
  heldShared = false;

  constructor(private readonly otherPageOpen: boolean) {}

  request(
    name: string,
    options: { mode: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => unknown
  ): Promise<unknown> {
    if (options.mode === "exclusive") {
      const granted = !this.otherPageOpen && !this.heldShared;
      this.log.push(`exclusive ${name} ${granted ? "granted" : "refused"}`);
      return Promise.resolve(callback(granted ? { name } : null));
    }
    this.log.push(`shared ${name} granted`);
    this.heldShared = true;
    return Promise.resolve(callback({ name }));
  }
}

function deleter(fail = false): { deleted: string[]; deleteFolder: (path: string) => Promise<void> } {
  const deleted: string[] = [];
  return {
    deleted,
    deleteFolder: async path => {
      if (fail) throw new Error("storage is locked");
      deleted.push(path);
    },
  };
}

describe("clearStoredSamples", () => {
  it("clears the sample folder when no other page of the site is open", async () => {
    const locks = new FakeLocks(false);
    const { deleted, deleteFolder } = deleter();

    const outcome = await clearStoredSamples({ locks, deleteFolder, folder: "samples/v2" });

    expect(outcome).toBe("cleared");
    expect(deleted).toEqual(["samples/v2"]);
  });

  it("keeps the samples when another page of the site is open", async () => {
    const locks = new FakeLocks(true);
    const { deleted, deleteFolder } = deleter();

    const outcome = await clearStoredSamples({ locks, deleteFolder, folder: "samples/v2" });

    expect(outcome).toBe("kept: another page is open");
    expect(deleted).toEqual([]);
  });

  it.each([false, true])("marks this page as open afterwards (other page open: %s)", async otherPageOpen => {
    const locks = new FakeLocks(otherPageOpen);

    await clearStoredSamples({ locks, deleteFolder: deleter().deleteFolder, folder: "samples/v2" });

    expect(locks.heldShared).toBe(true);
    expect(locks.log[locks.log.length - 1]).toBe(`shared ${PAGE_OPEN_LOCK} granted`);
  });

  it("asks to clear before it marks itself open, so it does not refuse itself", async () => {
    const locks = new FakeLocks(false);

    await clearStoredSamples({ locks, deleteFolder: deleter().deleteFolder, folder: "samples/v2" });

    expect(locks.log).toEqual([`exclusive ${PAGE_OPEN_LOCK} granted`, `shared ${PAGE_OPEN_LOCK} granted`]);
  });

  it("clears when the browser has no lock manager", async () => {
    const { deleted, deleteFolder } = deleter();

    const outcome = await clearStoredSamples({ locks: undefined, deleteFolder, folder: "samples/v2" });

    expect(outcome).toBe("cleared");
    expect(deleted).toEqual(["samples/v2"]);
  });

  it("reports a failed clear without throwing, and still marks the page open", async () => {
    const locks = new FakeLocks(false);

    const outcome = await clearStoredSamples({ locks, deleteFolder: deleter(true).deleteFolder, folder: "samples/v2" });

    expect(outcome).toBe("failed: storage is locked");
    expect(locks.heldShared).toBe(true);
  });

  it("reports a lock manager that throws without throwing itself", async () => {
    const locks: PageLocks = { request: () => Promise.reject(new Error("locks are blocked")) };
    const { deleted, deleteFolder } = deleter();

    const outcome = await clearStoredSamples({ locks, deleteFolder, folder: "samples/v2" });

    expect(outcome).toBe("failed: locks are blocked");
    expect(deleted).toEqual([]);
  });

  it("gives up waiting for the locks after the deadline and lets the page load", async () => {
    const locks: PageLocks = { request: () => new Promise(() => {}) };

    const outcome = await clearStoredSamples({
      locks, deleteFolder: deleter().deleteFolder, folder: "samples/v2", deadlineMs: 20,
    });

    expect(outcome).toMatch(/^failed: .*timed out/);
  });
});
