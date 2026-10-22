import { describe, expect, it } from "vitest";
import {
  GIB,
  judgeOpfsUsage,
  parseStoredUsageRun,
  summarizeFlush,
  usageEnvelope,
  type StoredUsageRun,
} from "./chromiumOpfs";

const MIB = 1024 * 1024;
const WRITTEN = 64 * MIB;

const storedRun = (over: Partial<StoredUsageRun> = {}): StoredUsageRun => ({
  runToken: "mvk9abcd-q1w2",
  chrome: "Google Chrome 155",
  userAgent: "Mozilla/5.0",
  chromeFullVersion: "155.0.8059.85",
  osVersion: "15.6.1",
  date: "2026-10-22",
  truncateFirst: false,
  writtenBytes: WRITTEN,
  sizeReadBack: WRITTEN,
  beforeWrite: 1000,
  afterWrite: 1000 + WRITTEN,
  afterDelete: 1000,
  quota: 300 * GIB,
  opfsBytesAtRun: 0,
  storedAt: 1_000_000,
  ...over,
});

describe("judgeOpfsUsage", () => {
  it("reads a ~4 GB usage after a restart with no files as NEGATIVE USAGE, whatever the session read", () => {
    const judged = judgeOpfsUsage({ beforeWrite: 0, afterWrite: 0, afterDelete: 0, afterRestart: 4_032_000_000 }, 64_000_000);
    expect(judged.verdict).toBe("NEGATIVE USAGE");
    expect(judged.detail).toContain("restart: 4032000000");
  });

  it("reads a write that the session counts as COUNTED, with the restart half NOT CHECKED in the detail", () => {
    const judged = judgeOpfsUsage({ beforeWrite: 0, afterWrite: 67_108_864, afterDelete: 0, afterRestart: null }, WRITTEN);
    expect(judged.verdict).toBe("COUNTED");
    expect(judged.detail).toContain("in-session: COUNTED");
    expect(judged.detail).toContain("restart: NOT CHECKED");
  });

  it("reads a write the session's usage barely moves for as NOT COUNTED", () => {
    const judged = judgeOpfsUsage({ beforeWrite: 5000, afterWrite: 5000 + 1024, afterDelete: 5000, afterRestart: null }, WRITTEN);
    expect(judged.verdict).toBe("NOT COUNTED");
    expect(judged.detail).toContain("in-session: NOT COUNTED");
  });

  it("puts a small restart figure in the detail and keeps the in-session verdict", () => {
    const judged = judgeOpfsUsage({ beforeWrite: 0, afterWrite: WRITTEN, afterDelete: 0, afterRestart: 2048 }, WRITTEN);
    expect(judged.verdict).toBe("COUNTED");
    expect(judged.detail).toContain("restart: 2048");
  });

  it("does not call a large restart figure negative when the origin's files account for it", () => {
    const judged = judgeOpfsUsage({ beforeWrite: 0, afterWrite: WRITTEN, afterDelete: 0, afterRestart: 3 * GIB }, WRITTEN, 3 * GIB);
    expect(judged.verdict).toBe("COUNTED");
  });

  it("reads NOT CHECKED when an in-session reading is missing", () => {
    const judged = judgeOpfsUsage({ beforeWrite: Number.NaN, afterWrite: WRITTEN, afterDelete: 0, afterRestart: null }, WRITTEN);
    expect(judged.verdict).toBe("NOT CHECKED");
  });
});

describe("summarizeFlush", () => {
  it("gives the median, the nearest-rank 95th percentile and the max", () => {
    const ms = [5, 1, 3, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100];
    expect(summarizeFlush(ms)).toEqual({ median: 10.5, p95: 19, max: 100 });
    expect(summarizeFlush([3, 1, 2])).toEqual({ median: 2, p95: 3, max: 3 });
  });

  it("refuses an empty list", () => {
    expect(() => summarizeFlush([])).toThrow();
  });
});

describe("the stored readings judged on a later load", () => {
  it("parses what the run stored and refuses anything else", () => {
    const run = storedRun();
    expect(parseStoredUsageRun(JSON.stringify(run))).toEqual(run);
    expect(parseStoredUsageRun("{not json")).toBeNull();
    expect(parseStoredUsageRun(JSON.stringify({ runToken: "x" }))).toBeNull();
  });

  it("judges the in-session envelope with the restart half NOT CHECKED", () => {
    const envelope = usageEnvelope(storedRun(), null, "mvk9abcd-q1w2", 1_000_500);
    expect(envelope.issue).toBe("opfs-usage");
    expect(envelope.verdict).toBe("COUNTED");
    expect(envelope.figures.afterRestart).toBeNull();
    expect(String(envelope.figures.detail)).toContain("restart: NOT CHECKED");
  });

  it("judges a stored run against a restart reading of 2^32 minus the deleted size as NEGATIVE USAGE", () => {
    const afterRestart = 2 ** 32 - WRITTEN;
    const envelope = usageEnvelope(
      storedRun({ afterWrite: 1000, afterDelete: 1000 }),
      { usage: afterRestart, quota: 300 * GIB, testFiles: 0, opfsBytes: 0 },
      "mvkzzzzz-r3st",
      1_000_000 + 95_000
    );
    expect(envelope.verdict).toBe("NEGATIVE USAGE");
    expect(envelope.runToken).toBe("mvkzzzzz-r3st");
    expect(envelope.figures.storedRunToken).toBe("mvk9abcd-q1w2");
    expect(envelope.figures.afterRestart).toBe(afterRestart);
    expect(envelope.figures.secondsSinceStored).toBe(95);
    expect(envelope.figures.testFilesAtRestart).toBe(0);
  });

  it("names a phantom usage that was already there at the run, and the drift across the restart", () => {
    const wrapped = 2 ** 32 - 405_562_444;
    const run = storedRun({ beforeWrite: wrapped, afterWrite: wrapped + WRITTEN, afterDelete: wrapped });
    const inSession = usageEnvelope(run, null, "mvk9abcd-q1w2", 1_000_500);
    expect(inSession.figures.unexplainedAtRunBytes).toBe(wrapped);
    expect(inSession.figures.restartDriftBytes).toBeNull();
    const restarted = usageEnvelope(run, { usage: wrapped - WRITTEN, quota: 300 * GIB, testFiles: 0, opfsBytes: 0 }, "mvkzzzzz-r3st", 1_090_000);
    expect(restarted.verdict).toBe("NEGATIVE USAGE");
    expect(restarted.figures.restartDriftBytes).toBe(-WRITTEN);
    expect(String(restarted.figures.detail)).toContain("already unexplained at the run");
  });

  it("judges a restart reading near the run's own baseline as the in-session verdict", () => {
    const envelope = usageEnvelope(storedRun(), { usage: 1000, quota: 300 * GIB, testFiles: 0, opfsBytes: 0 }, "mvkzzzzz-r3st", 1_010_000);
    expect(envelope.verdict).toBe("COUNTED");
    expect(String(envelope.figures.detail)).toContain("restart: 1000");
  });
});
