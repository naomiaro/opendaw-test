/**
 * The SDK writes every sample it loads into the browser's private file system
 * (OPFS) and removes none of them on its own. The demos make new samples under
 * new ids on every page load and never read a stored one back, so without a
 * sweep the folder only grows. This clears it when a page loads.
 *
 * The folder belongs to the whole site, not to one page. A page that is
 * already open may still be writing to it (a recording being saved), so the
 * sweep is skipped while another page of the site is open. Pages announce
 * themselves with a shared Web Lock held for as long as they live; the browser
 * releases it when the page closes or crashes.
 */
import { withDeadline } from "./deadline";

export const PAGE_OPEN_LOCK = "opendaw-demos:page-open";

/** The part of the browser's LockManager this module uses */
export interface PageLocks {
  request(
    name: string,
    options: { mode: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => unknown
  ): Promise<unknown>;
}

export type ClearOutcome = "cleared" | "kept: another page is open" | `failed: ${string}`;

export interface ClearStoredSamplesOptions {
  /** `navigator.locks`, or undefined in a browser without it */
  readonly locks: PageLocks | undefined;
  /** Removes a folder and everything in it */
  readonly deleteFolder: (path: string) => Promise<void>;
  /** The SDK's delete reports nothing when it fails, so the result is checked with this */
  readonly folderExists: (path: string) => Promise<boolean>;
  readonly folder: string;
  /**
   * How long the lock manager may take to ANSWER before the page loads without
   * a sweep. It does not limit the clear itself: carrying on beside a delete
   * that is still running would let it remove the samples the page stores next.
   */
  readonly deadlineMs?: number;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Clear the stored samples unless another page of the site is open, then mark
 * this page as open. Never throws: a page must load whether or not the sweep worked.
 */
export async function clearStoredSamples({
  locks, deleteFolder, folderExists, folder, deadlineMs = 5000,
}: ClearStoredSamplesOptions): Promise<ClearOutcome> {
  const clear = async (): Promise<ClearOutcome> => {
    try {
      await deleteFolder(folder);
      return (await folderExists(folder)) ? "failed: the folder is still there" : "cleared";
    } catch (error) {
      return `failed: ${messageOf(error)}`;
    }
  };
  // Without a lock manager there is no telling whether another page is open.
  // Clearing is the better default: unbounded growth is certain, a clash is not.
  if (locks === undefined) return clear();

  let markedOpen: Promise<void> = Promise.resolve();
  const markOpen = (): void => {
    markedOpen = new Promise<void>((resolve, reject) => {
      locks
        .request(PAGE_OPEN_LOCK, { mode: "shared" }, () => {
          resolve();
          // Held until the page goes away.
          return new Promise<never>(() => {});
        })
        .catch(reject);
    });
  };

  // Set when the page stopped waiting for the lock manager. An answer that
  // comes after that must not clear: the page is running by then.
  let givenUp = false;
  let answered: () => void = () => {};
  const hasAnswered = new Promise<void>(resolve => {
    answered = resolve;
  });

  const sweep = (async (): Promise<ClearOutcome> => {
    const outcome = await locks.request(
      PAGE_OPEN_LOCK,
      // Only if it is free right now. A plain request would wait until every
      // other page had closed and then clear under whichever page is running.
      { mode: "exclusive", ifAvailable: true },
      async lock => {
        answered();
        const result: ClearOutcome =
          lock === null || givenUp ? "kept: another page is open" : await clear();
        // Asked for while the exclusive lock is still held, so it is next in
        // line: no other page can take the exclusive lock between the two.
        markOpen();
        return result;
      }
    );
    await markedOpen;
    return outcome as ClearOutcome;
  })();
  // Observed below, or abandoned after the deadline; either way never unhandled.
  sweep.catch(() => {});

  try {
    await withDeadline(Promise.race([hasAnswered, sweep]), deadlineMs, "Waiting for the page locks");
    return await sweep;
  } catch (error) {
    givenUp = true;
    return `failed: ${messageOf(error)}`;
  }
}
