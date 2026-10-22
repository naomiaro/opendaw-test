/**
 * Chromium 436552046 / 401692415 and 40909520: the judgement of the OPFS probes
 * (`?issue=opfs-usage`, `?issue=opfs-flush`), pure and Node-testable. The browser half is
 * `chromiumOpfsProbe.ts`; the worker that writes is `chromiumOpfsWorker.ts`.
 *
 * The usage cause as a reporter found it: writes through a sync access handle never update
 * the persisted per-origin usage, `removeEntry()` subtracts the file's full size, and the
 * saved value goes negative; the next browser start reads it as 2³² + value. So the probe
 * judges two halves: in the session (does `estimate()` count the write at all?) and after a
 * restart (does the origin read gigabytes with nothing stored?).
 */

import type { ProbeEnvelope } from "./chromiumWatched";

export const GIB = 1024 * 1024 * 1024;

export type OpfsUsageVerdict = "NEGATIVE USAGE" | "COUNTED" | "NOT COUNTED" | "NOT CHECKED";

/** `navigator.storage.estimate()` usage at each stage of a run, in bytes; null where not read. */
export interface UsageReadings {
  beforeWrite: number;
  /** After the write, the flush and the handle's close. */
  afterWrite: number;
  afterDelete: number;
  /** On a later page load, after the browser was quit and reopened. */
  afterRestart: number | null;
}

/**
 * `NEGATIVE USAGE` when the restart reading exceeds what the origin stores by 1 GiB or more;
 * otherwise the in-session verdict, `NOT COUNTED` when the usage moved by under half the
 * bytes written; `NOT CHECKED` when an in-session reading is missing. The detail names both
 * halves. `storedBytesAtRestart` is the size of every file in the origin's OPFS at the
 * restart reading (0 when it holds none).
 */
export function judgeOpfsUsage(
  reported: UsageReadings,
  writtenBytes: number,
  storedBytesAtRestart: number = 0
): { verdict: OpfsUsageVerdict; detail: string } {
  const { beforeWrite, afterWrite, afterDelete, afterRestart } = reported;
  const restart = afterRestart === null ? "restart: NOT CHECKED" : `restart: ${afterRestart} bytes`;
  if (afterRestart !== null && afterRestart - storedBytesAtRestart >= GIB) {
    return {
      verdict: "NEGATIVE USAGE",
      detail: `${restart}, ${storedBytesAtRestart} bytes stored, ${afterRestart - storedBytesAtRestart} unexplained`,
    };
  }
  if (![beforeWrite, afterWrite, afterDelete, writtenBytes].every(Number.isFinite)) {
    return { verdict: "NOT CHECKED", detail: `in-session: readings missing; ${restart}` };
  }
  const counted = afterWrite - beforeWrite;
  const inSession: OpfsUsageVerdict = counted < writtenBytes / 2 ? "NOT COUNTED" : "COUNTED";
  return {
    verdict: inSession,
    detail: `in-session: ${inSession} (+${counted} of ${writtenBytes} bytes, ${afterDelete - beforeWrite} left after the delete); ${restart}`,
  };
}

/** Median, nearest-rank 95th percentile and maximum of a list of times. Throws on an empty list. */
export function summarizeFlush(ms: number[]): { median: number; p95: number; max: number } {
  if (ms.length === 0) throw new Error("summarizeFlush: no times");
  const sorted = [...ms].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)];
  return { median, p95, max: sorted[sorted.length - 1] };
}

/** What the run's first page load keeps in `localStorage` for a later load to judge. */
export interface StoredUsageRun {
  runToken: string;
  chrome: string;
  userAgent: string;
  chromeFullVersion: string | null;
  osVersion: string | null;
  date: string;
  truncateFirst: boolean;
  writtenBytes: number;
  /** The file's size read back through the handle (`getSize()`) before the delete. */
  sizeReadBack: number;
  beforeWrite: number;
  afterWrite: number;
  afterDelete: number;
  quota: number;
  /** The size of every file in the origin's OPFS just before the write. */
  opfsBytesAtRun: number;
  /** `Date.now()` when the readings were stored. */
  storedAt: number;
}

const NUMBER_FIELDS = ["writtenBytes", "sizeReadBack", "beforeWrite", "afterWrite", "afterDelete", "quota", "opfsBytesAtRun", "storedAt"] as const;

/** The stored run, or null when the text is not one. */
export function parseStoredUsageRun(raw: string): StoredUsageRun | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const run = value as Record<string, unknown>;
  if (typeof run.runToken !== "string" || typeof run.chrome !== "string" || typeof run.date !== "string") return null;
  if (typeof run.truncateFirst !== "boolean") return null;
  if (!NUMBER_FIELDS.every((field) => typeof run[field] === "number")) return null;
  return value as StoredUsageRun;
}

/** What the later load reads: `estimate()` once, what the origin's OPFS holds, and its own browser. */
export interface RestartReading {
  usage: number;
  quota: number;
  /** Files left under the probe's own `test/` folder. */
  testFiles: number;
  /** The size of every file anywhere in the origin's OPFS. */
  opfsBytes: number;
  /**
   * The run's `sessionStorage` marker was still there: the same browsing session, a reload and
   * not a restart (Chrome's session restore can carry it over too, so the recipe reopens by hand).
   */
  sessionMarkerPresent: boolean;
  /** The restart load's own browser, OS and date: quitting Chrome is when a pending update installs. */
  chrome: string;
  userAgent: string;
  chromeFullVersion: string | null;
  osVersion: string | null;
  date: string;
}

/** How close a drift must sit to minus the written size, or to 0, to be read as one or the other. */
export const DRIFT_TOLERANCE_BYTES = 1024 * 1024;

/**
 * The restart half judged: `NOT CHECKED not-restarted` when the session marker survived. On an
 * origin whose usage was already 1 GiB or more beyond its files at the run, the restart reading
 * cannot tell this run's effect from the earlier phantom, so the drift from the run's baseline
 * decides: about minus the written size is `NEGATIVE USAGE` (this delete drove the saved figure
 * further down), about 0 is `COUNTED` (the delete left it alone), anything else
 * `NOT CHECKED phantom-before-run`. Otherwise `judgeOpfsUsage`.
 */
function judgeRestart(run: StoredUsageRun, restart: RestartReading): { verdict: string; detail: string } {
  const drift = restart.usage - run.beforeWrite;
  const unexplainedAtRun = run.beforeWrite - run.opfsBytesAtRun;
  if (restart.sessionMarkerPresent) {
    return {
      verdict: "NOT CHECKED not-restarted",
      detail: `the run's session marker is still there: a reload, not a restart; restart: ${restart.usage} bytes; readings kept`,
    };
  }
  if (unexplainedAtRun >= GIB) {
    const already = `already unexplained at the run: ${unexplainedAtRun} bytes`;
    const verdict =
      Math.abs(drift + run.writtenBytes) <= DRIFT_TOLERANCE_BYTES ? "NEGATIVE USAGE"
      : Math.abs(drift) <= DRIFT_TOLERANCE_BYTES ? "COUNTED"
      : "NOT CHECKED phantom-before-run";
    return { verdict, detail: `restart: ${restart.usage} bytes, drift ${drift} from the run's baseline (${run.writtenBytes} deleted); ${already}` };
  }
  return judgeOpfsUsage(
    { beforeWrite: run.beforeWrite, afterWrite: run.afterWrite, afterDelete: run.afterDelete, afterRestart: restart.usage },
    run.writtenBytes,
    restart.opfsBytes
  );
}

/**
 * The envelope of a usage run: in-session when `restart` is null, else the later load's.
 * A restart envelope gets its own run token (so the in-session file is not overwritten), names
 * the stored run's, and carries the restart load's browser, OS and date at the top level, the
 * run's beside them. `unexplainedAtRunBytes` is usage the origin's files did not account for
 * before the write (a phantom an earlier restart left); `restartDriftBytes` is how the usage
 * moved from the run's baseline across the restart, which the reported cause puts at minus the
 * file's size for a plain delete and 0 after a truncate.
 */
export function usageEnvelope(run: StoredUsageRun, restart: RestartReading | null, runToken: string, now: number): ProbeEnvelope {
  const judged =
    restart === null
      ? judgeOpfsUsage({ beforeWrite: run.beforeWrite, afterWrite: run.afterWrite, afterDelete: run.afterDelete, afterRestart: null }, run.writtenBytes)
      : judgeRestart(run, restart);
  const figures: Record<string, number | string | null> = {
    verdict: judged.verdict,
    detail:
      restart === null
        ? judged.detail.replace("restart: NOT CHECKED", "restart: NOT CHECKED — quit Chrome fully and reopen this URL by hand")
        : judged.detail,
    storedRunToken: run.runToken,
    truncateFirst: run.truncateFirst ? "yes" : "no",
    writtenBytes: run.writtenBytes,
    sizeReadBack: run.sizeReadBack,
    beforeWrite: run.beforeWrite,
    afterWrite: run.afterWrite,
    afterDelete: run.afterDelete,
    countedBytes: run.afterWrite - run.beforeWrite,
    residualAfterDeleteBytes: run.afterDelete - run.beforeWrite,
    opfsBytesAtRun: run.opfsBytesAtRun,
    unexplainedAtRunBytes: run.beforeWrite - run.opfsBytesAtRun,
    restartDriftBytes: restart === null ? null : restart.usage - run.beforeWrite,
    quotaAtRun: run.quota,
    afterRestart: restart?.usage ?? null,
    quotaAtRestart: restart?.quota ?? null,
    testFilesAtRestart: restart?.testFiles ?? null,
    opfsBytesAtRestart: restart?.opfsBytes ?? null,
    sessionMarkerPresent: restart === null ? null : restart.sessionMarkerPresent ? "yes" : "no",
    secondsSinceStored: restart === null ? null : Math.round((now - run.storedAt) / 1000),
    runDate: run.date,
    chromeFullVersion: run.chromeFullVersion,
    osVersion: run.osVersion,
    userAgent: run.userAgent,
    restartDate: restart?.date ?? null,
    restartChromeFullVersion: restart?.chromeFullVersion ?? null,
    restartOsVersion: restart?.osVersion ?? null,
    restartUserAgent: restart?.userAgent ?? null,
    opfsGetDirectory: "yes",
    syncAccessHandle: "yes",
  };
  return {
    issue: "opfs-usage",
    chrome: restart?.chrome ?? run.chrome,
    date: restart?.date ?? run.date,
    runToken,
    verdict: judged.verdict,
    figures,
  };
}
