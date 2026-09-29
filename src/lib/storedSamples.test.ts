import { describe, it, expect } from "vitest";
import { clearStoredSamples, PAGE_OPEN_LOCK, type PageLocks } from "./storedSamples";

type LockOptions = { mode: "exclusive" | "shared"; ifAvailable?: boolean };

/**
 * A stand-in for the browser's lock manager, for one lock name, with the two
 * rules the design depends on:
 * - a request made with `ifAvailable` is refused unless it can be granted at once
 * - a request made while a conflicting lock is held waits in line until that
 *   lock is released, which is when its holder's callback has settled
 * `otherPageOpen` models another page of the site holding the shared lock.
 */
class FakeLocks implements PageLocks {
  readonly log: string[] = [];
  readonly requests: Array<{ name: string; options: LockOptions }> = [];
  exclusiveHeld = false;
  heldShared = false;
  #waiting: Array<() => void> = [];

  constructor(private readonly otherPageOpen: boolean) {}

  request(name: string, options: LockOptions, callback: (lock: { name: string } | null) => unknown): Promise<unknown> {
    this.requests.push({ name, options });
    if (options.mode === "exclusive") {
      const free = !this.otherPageOpen && !this.heldShared && !this.exclusiveHeld;
      if (!free) {
        if (options.ifAvailable !== true) {
          // A plain exclusive request would wait for every other page to close.
          this.log.push("exclusive waits");
          return new Promise(() => {});
        }
        this.log.push("exclusive refused");
        return Promise.resolve(callback(null));
      }
      this.log.push("exclusive granted");
      this.exclusiveHeld = true;
      return Promise.resolve(callback({ name })).finally(() => {
        this.exclusiveHeld = false;
        this.log.push("exclusive released");
        const waiting = this.#waiting;
        this.#waiting = [];
        waiting.forEach(grant => grant());
      });
    }
    const grant = (): void => {
      this.log.push("shared granted");
      this.heldShared = true;
      void callback({ name });
    };
    if (this.exclusiveHeld) {
      this.log.push("shared asked while exclusive is held");
      this.#waiting.push(grant);
    } else {
      this.log.push("shared asked");
      grant();
    }
    return new Promise(() => {});
  }
}

interface Storage {
  readonly deleted: string[];
  readonly deleteFolder: (path: string) => Promise<void>;
  readonly folderExists: (path: string) => Promise<boolean>;
}

function storage(behaviour: "removes" | "throws" | "leaves it there" = "removes", delayMs = 0): Storage {
  const deleted: string[] = [];
  let present = true;
  return {
    deleted,
    deleteFolder: async path => {
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (behaviour === "throws") throw new Error("storage is locked");
      deleted.push(path);
      if (behaviour === "removes") present = false;
    },
    folderExists: async () => present,
  };
}

const FOLDER = "samples/v2";

describe("clearStoredSamples", () => {
  it("clears the sample folder when no other page of the site is open", async () => {
    const store = storage();

    const outcome = await clearStoredSamples({ locks: new FakeLocks(false), ...store, folder: FOLDER });

    expect(outcome).toBe("cleared");
    expect(store.deleted).toEqual([FOLDER]);
  });

  it("keeps the samples when another page of the site is open", async () => {
    const store = storage();

    const outcome = await clearStoredSamples({ locks: new FakeLocks(true), ...store, folder: FOLDER });

    expect(outcome).toBe("kept: another page is open");
    expect(store.deleted).toEqual([]);
  });

  // Without `ifAvailable` the request would wait until every other page closed,
  // and then clear the folder under a page that has long been running.
  it("asks for the clearing lock only if it is free right now", async () => {
    const locks = new FakeLocks(true);

    await clearStoredSamples({ locks, ...storage(), folder: FOLDER });

    expect(locks.requests[0]).toEqual({ name: PAGE_OPEN_LOCK, options: { mode: "exclusive", ifAvailable: true } });
    expect(locks.log).not.toContain("exclusive waits");
  });

  it.each([false, true])("has marked this page as open by the time it returns (other page open: %s)", async other => {
    const locks = new FakeLocks(other);

    await clearStoredSamples({ locks, ...storage(), folder: FOLDER });

    expect(locks.heldShared).toBe(true);
    expect(locks.requests[1]).toEqual({ name: PAGE_OPEN_LOCK, options: { mode: "shared" } });
  });

  // Asked while the clearing lock is still held, the request is next in line.
  // Asked after it is released, another page could take the clearing lock in between.
  it("asks to be marked open before it lets go of the clearing lock", async () => {
    const locks = new FakeLocks(false);

    await clearStoredSamples({ locks, ...storage(), folder: FOLDER });

    expect(locks.log).toEqual([
      "exclusive granted",
      "shared asked while exclusive is held",
      "exclusive released",
      "shared granted",
    ]);
  });

  it("has finished clearing before it asks to be marked open", async () => {
    const locks = new FakeLocks(false);
    const store = storage("removes", 30);
    const deletedWhenAsked: number[] = [];
    const request = locks.request.bind(locks);
    locks.request = (name, options, callback) => {
      if (options.mode === "shared") deletedWhenAsked.push(store.deleted.length);
      return request(name, options, callback);
    };

    await clearStoredSamples({ locks, ...store, folder: FOLDER });

    expect(deletedWhenAsked).toEqual([1]);
  });

  // Carrying on beside a delete that is still running would let it remove the
  // samples this page stores next.
  it("waits for a clear that takes longer than the deadline for the locks", async () => {
    const store = storage("removes", 60);

    const outcome = await clearStoredSamples({ locks: new FakeLocks(false), ...store, folder: FOLDER, deadlineMs: 20 });

    expect(outcome).toBe("cleared");
    expect(store.deleted).toEqual([FOLDER]);
  });

  it("clears when the browser has no lock manager", async () => {
    const store = storage();

    const outcome = await clearStoredSamples({ locks: undefined, ...store, folder: FOLDER });

    expect(outcome).toBe("cleared");
    expect(store.deleted).toEqual([FOLDER]);
  });

  it("reports a clear that threw, without throwing, and still marks the page open", async () => {
    const locks = new FakeLocks(false);

    const outcome = await clearStoredSamples({ locks, ...storage("throws"), folder: FOLDER });

    expect(outcome).toBe("failed: storage is locked");
    expect(locks.heldShared).toBe(true);
  });

  // The SDK's delete reports nothing when it fails, so success is checked, not assumed.
  it("reports a clear that left the folder in place", async () => {
    const outcome = await clearStoredSamples({ locks: new FakeLocks(false), ...storage("leaves it there"), folder: FOLDER });

    expect(outcome).toBe("failed: the folder is still there");
  });

  it("reports a lock manager that throws, without throwing itself", async () => {
    const locks: PageLocks = { request: () => Promise.reject(new Error("locks are blocked")) };
    const store = storage();

    const outcome = await clearStoredSamples({ locks, ...store, folder: FOLDER });

    expect(outcome).toBe("failed: locks are blocked");
    expect(store.deleted).toEqual([]);
  });

  // By then the page is running and storing samples of its own.
  it("does not clear when the lock manager answers after the page has given up on it", async () => {
    const locks: PageLocks = {
      request: (name, _options, callback) =>
        new Promise(resolve => setTimeout(() => resolve(callback({ name })), 50)),
    };
    const store = storage();

    const outcome = await clearStoredSamples({ locks, ...store, folder: FOLDER, deadlineMs: 20 });
    await new Promise(resolve => setTimeout(resolve, 80));

    expect(outcome).toMatch(/^failed: .*timed out/);
    expect(store.deleted).toEqual([]);
  });

  it("gives up on a lock manager that never answers, and lets the page load", async () => {
    const locks: PageLocks = { request: () => new Promise(() => {}) };
    const store = storage();

    const outcome = await clearStoredSamples({ locks, ...store, folder: FOLDER, deadlineMs: 20 });

    expect(outcome).toMatch(/^failed: .*timed out/);
    expect(store.deleted).toEqual([]);
  });
});
