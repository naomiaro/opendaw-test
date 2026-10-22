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

/** What the later load reads: `estimate()` once, and what the origin's OPFS holds. */
export interface RestartReading {
  usage: number;
  quota: number;
  /** Files left under the probe's own `test/` folder. */
  testFiles: number;
  /** The size of every file anywhere in the origin's OPFS. */
  opfsBytes: number;
}

/**
 * The envelope of a usage run: in-session when `restart` is null, else the later load's.
 * A restart envelope gets its own run token (so the in-session file is not overwritten) and
 * names the stored run's. It cannot know the browser was restarted; `secondsSinceStored` and
 * the user's word are the evidence. `unexplainedAtRunBytes` is usage the origin's files did not
 * account for before the write (a phantom an earlier restart left); `restartDriftBytes` is how
 * the usage moved from the run's baseline across the restart, which the reported cause puts at
 * minus the file's size for a plain delete and 0 after a truncate.
 */
export function usageEnvelope(run: StoredUsageRun, restart: RestartReading | null, runToken: string, now: number): ProbeEnvelope {
  const judged = judgeOpfsUsage(
    { beforeWrite: run.beforeWrite, afterWrite: run.afterWrite, afterDelete: run.afterDelete, afterRestart: restart?.usage ?? null },
    run.writtenBytes,
    restart?.opfsBytes ?? 0
  );
  const unexplainedAtRun = run.beforeWrite - run.opfsBytesAtRun;
  const already =
    judged.verdict === "NEGATIVE USAGE" && unexplainedAtRun >= GIB ? `; already unexplained at the run: ${unexplainedAtRun} bytes` : "";
  const figures: Record<string, number | string | null> = {
    verdict: judged.verdict,
    detail:
      restart === null
        ? judged.detail.replace("restart: NOT CHECKED", "restart: NOT CHECKED — quit Chrome fully and reopen this URL")
        : judged.detail + already,
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
    unexplainedAtRunBytes: unexplainedAtRun,
    restartDriftBytes: restart === null ? null : restart.usage - run.beforeWrite,
    quotaAtRun: run.quota,
    afterRestart: restart?.usage ?? null,
    quotaAtRestart: restart?.quota ?? null,
    testFilesAtRestart: restart?.testFiles ?? null,
    opfsBytesAtRestart: restart?.opfsBytes ?? null,
    secondsSinceStored: restart === null ? null : Math.round((now - run.storedAt) / 1000),
    chromeFullVersion: run.chromeFullVersion,
    osVersion: run.osVersion,
    userAgent: run.userAgent,
    opfsGetDirectory: "yes",
    syncAccessHandle: "yes",
  };
  return { issue: "opfs-usage", chrome: run.chrome, date: run.date, runToken, verdict: judged.verdict, figures };
}
