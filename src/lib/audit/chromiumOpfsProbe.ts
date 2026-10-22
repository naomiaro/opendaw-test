/**
 * The browser half of the OPFS probes. The writing happens in a dedicated worker
 * (`chromiumOpfsWorker.ts`); the judgement is `chromiumOpfs.ts`.
 *
 * `?issue=opfs-usage` (436552046 / 401692415): the click writes 64 MiB through a sync access
 * handle, deletes it, judges whether the session's `estimate()` counted the write, and keeps
 * the readings in `localStorage`. The persisted figure only goes wrong across a browser
 * restart, which no page can do: quit Chrome fully and reopen the same URL, and
 * `judgeStoredOpfsUsageOnLoad` reads `estimate()` once, judges, and clears the readings.
 * `&truncateFirst=1` truncates the file to 0 through the handle before `removeEntry()`
 * (the tracker's workaround).
 *
 * `?issue=opfs-flush` (40909520): 20 writes of 1 MiB and 20 of 16 MiB, each flushed, timed.
 */

import { withDeadline } from "@/lib/deadline";
import { browserOf, newRunToken, platformOf, runDate, type PlatformNavigator, type ProbeEnvelope } from "./chromiumWatched";
import { parseStoredUsageRun, summarizeFlush, usageEnvelope, type StoredUsageRun } from "./chromiumOpfs";
import {
  OPFS_WORKER_SOURCE,
  type FlushResult,
  type OpfsWorkerAnswer,
  type OpfsWorkerRequest,
  type ScanResult,
  type UsageResult,
} from "./chromiumOpfsWorker";

const STORAGE_KEY = "chromium-watched:opfs-usage";
/** Set at Run in `sessionStorage`: a later load that still finds it is the same session, not a restart. */
const SESSION_MARKER_KEY = "chromium-watched:opfs-usage:session";
const USAGE_MIB = 64;
const FLUSH_COUNT = 20;
const USAGE_DEADLINE_MS = 30_000;
const FLUSH_DEADLINE_MS = 60_000;
const SCAN_DEADLINE_MS = 30_000;

/** One request to a fresh worker, answered once; the worker is gone afterwards. */
async function ask(request: OpfsWorkerRequest, deadlineMs: number): Promise<OpfsWorkerAnswer> {
  const url = URL.createObjectURL(new Blob([OPFS_WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  try {
    const answer = new Promise<OpfsWorkerAnswer>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<OpfsWorkerAnswer>) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(`the OPFS worker failed: ${event.message || "no message"}`));
    });
    worker.postMessage(request);
    return await withDeadline(answer, deadlineMs, `opfs worker ${request.kind}`);
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

/** The answer of the kind asked for; throws on a worker error, null when OPFS is missing (reason in `missing`). */
function answerOf<T extends UsageResult | FlushResult | ScanResult>(answer: OpfsWorkerAnswer, kind: T["kind"]): T | { missing: string } {
  if (!answer.ok) {
    if ("unavailable" in answer) return { missing: answer.unavailable };
    throw new Error(answer.error);
  }
  if (answer.kind !== kind) throw new Error(`the OPFS worker answered ${answer.kind} to ${kind}`);
  return answer as T;
}

function hasGetDirectory(): boolean {
  return typeof navigator.storage?.getDirectory === "function";
}

async function notChecked(issue: "opfs-usage" | "opfs-flush", reason: string, runToken: string): Promise<ProbeEnvelope> {
  const platform = await platformOf(navigator as PlatformNavigator);
  const verdict = `NOT CHECKED opfs-${reason}`;
  return {
    issue,
    chrome: browserOf(navigator),
    date: runDate(),
    runToken,
    verdict,
    figures: {
      verdict,
      opfsGetDirectory: hasGetDirectory() ? "yes" : "no",
      syncAccessHandle: reason === "no-createSyncAccessHandle" ? "no" : null,
      chromeFullVersion: platform.uaFullVersion,
      osVersion: platform.platformVersion,
      userAgent: platform.userAgent,
    },
  };
}

/** The click of `?issue=opfs-usage`: write, read back, delete, store the readings, judge the session half. */
export async function runOpfsUsageProbe(_signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  localStorage.removeItem(STORAGE_KEY);
  const runToken = newRunToken();
  sessionStorage.setItem(SESSION_MARKER_KEY, runToken);
  if (!hasGetDirectory()) return notChecked("opfs-usage", "no-getDirectory", runToken);
  const truncateFirst = new URLSearchParams(window.location.search).get("truncateFirst") === "1";
  report("write-delete");
  const answer = answerOf<UsageResult>(await ask({ kind: "usage", runToken, mib: USAGE_MIB, truncateFirst }, USAGE_DEADLINE_MS), "usage");
  if ("missing" in answer) return notChecked("opfs-usage", answer.missing, runToken);
  if (!answer.removed) throw new Error(`test/${runToken}.bin is still there after removeEntry()`);
  const platform = await platformOf(navigator as PlatformNavigator);
  const run: StoredUsageRun = {
    runToken,
    chrome: browserOf(navigator),
    userAgent: platform.userAgent,
    chromeFullVersion: platform.uaFullVersion,
    osVersion: platform.platformVersion,
    date: runDate(),
    truncateFirst,
    writtenBytes: answer.writtenBytes,
    sizeReadBack: answer.sizeReadBack,
    beforeWrite: answer.beforeWrite,
    afterWrite: answer.afterWrite,
    afterDelete: answer.afterDelete,
    quota: answer.quota,
    opfsBytesAtRun: answer.opfsBytesAtRun,
    storedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  console.log(
    "[chromium-watched] opfs-usage stored: before " + run.beforeWrite + ", after write " + run.afterWrite +
      ", after delete " + run.afterDelete + " bytes; quit Chrome fully and reopen this URL"
  );
  return usageEnvelope(run, null, runToken, Date.now());
}

/**
 * On a page load of `?issue=opfs-usage`: readings an earlier run stored mean this load may be the
 * restart half. The run's `sessionStorage` marker tells a reload apart: still there, the load reads
 * `NOT CHECKED not-restarted` and the readings are KEPT for the real restart. Gone, the load is
 * judged and the readings are cleared. Null when nothing is stored.
 */
export function judgeStoredOpfsUsageOnLoad(): Promise<ProbeEnvelope> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const run = parseStoredUsageRun(raw);
  if (run === null) {
    localStorage.removeItem(STORAGE_KEY);
    console.warn("[chromium-watched] opfs-usage: the stored readings did not parse and were cleared");
    return null;
  }
  const sessionMarkerPresent = sessionStorage.getItem(SESSION_MARKER_KEY) !== null;
  return (async () => {
    const answer = answerOf<ScanResult>(await ask({ kind: "scan" }, SCAN_DEADLINE_MS), "scan");
    if ("missing" in answer) throw new Error(`the scan found no OPFS: ${answer.missing}`);
    const platform = await platformOf(navigator as PlatformNavigator);
    const envelope = usageEnvelope(
      run,
      {
        usage: answer.usage,
        quota: answer.quota,
        testFiles: answer.testFiles,
        opfsBytes: answer.opfsBytes,
        sessionMarkerPresent,
        chrome: browserOf(navigator),
        userAgent: platform.userAgent,
        chromeFullVersion: platform.uaFullVersion,
        osVersion: platform.platformVersion,
        date: runDate(),
      },
      newRunToken(),
      Date.now()
    );
    if (!sessionMarkerPresent) localStorage.removeItem(STORAGE_KEY);
    return envelope;
  })();
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** The click of `?issue=opfs-flush`. */
export async function runOpfsFlushProbe(_signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  const runToken = newRunToken();
  if (!hasGetDirectory()) return notChecked("opfs-flush", "no-getDirectory", runToken);
  report("write-flush");
  const answer = answerOf<FlushResult>(await ask({ kind: "flush", runToken, counts: FLUSH_COUNT }, FLUSH_DEADLINE_MS), "flush");
  if ("missing" in answer) return notChecked("opfs-flush", answer.missing, runToken);
  const platform = await platformOf(navigator as PlatformNavigator);
  const figures: Record<string, number | string | null> = { verdict: "MEASURED" };
  const sizes: [string, number, number[], number[]][] = [
    ["1MiB", 1, answer.writeMs1, answer.flushMs1],
    ["16MiB", 16, answer.writeMs16, answer.flushMs16],
  ];
  for (const [label, mib, writeMs, flushMs] of sizes) {
    const flush = summarizeFlush(flushMs);
    const write = summarizeFlush(writeMs);
    figures[`flush${label}MedianMs`] = round(flush.median, 2);
    figures[`flush${label}P95Ms`] = round(flush.p95, 2);
    figures[`flush${label}MaxMs`] = round(flush.max, 2);
    figures[`write${label}MedianMs`] = round(write.median, 2);
    const totalMs = writeMs.reduce((a, b) => a + b, 0) + flushMs.reduce((a, b) => a + b, 0);
    // Bytes written and flushed per second over the size's whole series, in MB (10^6 bytes).
    figures[`throughput${label}MBps`] = round((mib * 1024 * 1024 * writeMs.length) / 1e6 / (totalMs / 1000), 1);
    figures[`flush${label}AllMs`] = flushMs.map((ms) => ms.toFixed(2)).join(" ");
  }
  Object.assign(figures, {
    count: FLUSH_COUNT,
    finalSizeBytes: answer.finalSize,
    fileRemoved: answer.removed ? "yes" : "no",
    quota: answer.quota,
    opfsGetDirectory: "yes",
    syncAccessHandle: "yes",
    chromeFullVersion: platform.uaFullVersion,
    osVersion: platform.platformVersion,
    userAgent: platform.userAgent,
  });
  return { issue: "opfs-flush", chrome: browserOf(navigator), date: runDate(), runToken, verdict: "MEASURED", figures };
}
