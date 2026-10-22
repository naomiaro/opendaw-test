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
 * The restart reading decoded as the saved figure it came from: Chrome stores the per-origin usage
 * signed and a start reads a negative one as 2³² + value, so a reading of 2³¹ or more is a negative
 * saved figure read back unsigned.
 */
export function savedUsageSigned(afterRestart: number): number {
  return afterRestart >= 2 ** 31 ? afterRestart - 2 ** 32 : afterRestart;
}

/**
 * `NEGATIVE USAGE` when the restart reading decodes to a negative saved figure (no baseline needed)
 * and the origin's files cannot account for the raw reading (they come within 1 GiB of it only on
 * an origin that really stores 2 GiB or more); otherwise the in-session verdict, `NOT COUNTED` when
 * the usage moved by under half the bytes written; `NOT CHECKED` when an in-session reading is
 * missing. The detail names both halves. `storedBytesAtRestart` is the size of every file in the
 * origin's OPFS at the restart reading (0 when it holds none).
 */
export function judgeOpfsUsage(
  reported: UsageReadings,
  writtenBytes: number,
  storedBytesAtRestart: number = 0
): { verdict: OpfsUsageVerdict; detail: string; savedUsageSigned: number | null } {
  const { beforeWrite, afterWrite, afterDelete, afterRestart } = reported;
  const saved = afterRestart === null ? null : savedUsageSigned(afterRestart);
  const restart =
    afterRestart === null ? "restart: NOT CHECKED" : `restart: ${afterRestart} bytes, saved figure ${saved}, ${storedBytesAtRestart} bytes of files`;
  const inSessionMissing = ![beforeWrite, afterWrite, afterDelete, writtenBytes].every(Number.isFinite);
  const counted = afterWrite - beforeWrite;
  const inSession: OpfsUsageVerdict = inSessionMissing ? "NOT CHECKED" : counted < writtenBytes / 2 ? "NOT COUNTED" : "COUNTED";
  const sessionDetail = inSessionMissing
    ? "in-session: readings missing"
    : `in-session: ${inSession} (+${counted} of ${writtenBytes} bytes, ${afterDelete - beforeWrite} left after the delete)`;
  if (afterRestart !== null && saved !== null && saved < 0 && storedBytesAtRestart + GIB < afterRestart) {
    return { verdict: "NEGATIVE USAGE", detail: `${restart}; ${sessionDetail}`, savedUsageSigned: saved };
  }
  return { verdict: inSession, detail: `${sessionDetail}; ${restart}`, savedUsageSigned: saved };
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
  /** The restart reading an earlier restart load stored, if any: the drift is measured against it. */
  previousRestart: { usage: number; date: string } | null;
}

/** How close a drift must sit to minus the written size, or to 0, to be read as one or the other. */
export const DRIFT_TOLERANCE_BYTES = 1024 * 1024;

/** What the drift since the previous restart matches: a plain delete (about −written) or truncate-first (about 0). */
function driftMatch(drift: number, writtenBytes: number): string {
  if (Math.abs(drift + writtenBytes) <= DRIFT_TOLERANCE_BYTES) return "plain";
  if (Math.abs(drift) <= DRIFT_TOLERANCE_BYTES) return "truncate-first";
  return "neither";
}

/**
 * The restart half judged: `NOT CHECKED not-restarted` when the session marker survived, else
 * `judgeOpfsUsage` on the restart reading. The drift since the previous restart reading (saved
 * figures, signed) is a figure and a sentence in the detail, not a verdict.
 */
function judgeRestart(run: StoredUsageRun, restart: RestartReading): { verdict: string; detail: string; drift: number | null } {
  if (restart.sessionMarkerPresent) {
    return {
      verdict: "NOT CHECKED not-restarted",
      detail: `the run's session marker is still there: a reload, not a restart; restart: ${restart.usage} bytes; readings kept`,
      drift: null,
    };
  }
  const judged = judgeOpfsUsage(
    { beforeWrite: run.beforeWrite, afterWrite: run.afterWrite, afterDelete: run.afterDelete, afterRestart: restart.usage },
    run.writtenBytes,
    restart.opfsBytes
  );
  if (restart.previousRestart === null) {
    return { ...judged, detail: `${judged.detail}; drift: no previous restart reading`, drift: null };
  }
  const drift = savedUsageSigned(restart.usage) - savedUsageSigned(restart.previousRestart.usage);
  const detail =
    `${judged.detail}; drift since the restart of ${restart.previousRestart.date}: ${drift} bytes ` +
    `(plain delete expected ≈ −${run.writtenBytes}, truncate-first expected ≈ 0; this ${run.truncateFirst ? "truncate-first" : "plain"} run matches ${driftMatch(drift, run.writtenBytes)})`;
  return { ...judged, detail, drift };
}

/**
 * The envelope of a usage run: in-session when `restart` is null, else the later load's.
 * A restart envelope gets its own run token (so the in-session file is not overwritten), names
 * the stored run's, and carries the restart load's browser, OS and date at the top level, the
 * run's beside them. `unexplainedAtRunBytes` is usage the session's tally held beyond the origin's
 * files before the write; `savedUsageSigned` is the restart reading decoded as the saved figure;
 * `restartDriftBytes` is how the saved figure moved since the previous restart reading, which the
 * reported cause puts at minus the file's size for a plain delete and 0 after a truncate.
 */
export function usageEnvelope(run: StoredUsageRun, restart: RestartReading | null, runToken: string, now: number): ProbeEnvelope {
  const judged =
    restart === null
      ? {
          ...judgeOpfsUsage({ beforeWrite: run.beforeWrite, afterWrite: run.afterWrite, afterDelete: run.afterDelete, afterRestart: null }, run.writtenBytes),
          drift: null,
        }
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
    savedUsageSigned: restart === null ? null : savedUsageSigned(restart.usage),
    restartDriftBytes: judged.drift,
    previousRestartUsage: restart?.previousRestart?.usage ?? null,
    previousRestartDate: restart?.previousRestart?.date ?? null,
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
