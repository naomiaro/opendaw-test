import { describe, expect, it } from "vitest";
import {
  GIB,
  judgeOpfsUsage,
  parseStoredUsageRun,
  summarizeFlush,
  usageEnvelope,
  type RestartReading,
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

/** A restart load's reading: no session marker, a newer Chrome than the run's, a later day. */
const restartReading = (usage: number, over: Partial<RestartReading> = {}): RestartReading => ({
  usage,
  quota: 300 * GIB,
  testFiles: 0,
  opfsBytes: 0,
  sessionMarkerPresent: false,
  chrome: "Google Chrome 156",
  userAgent: "Mozilla/5.0 restart",
  chromeFullVersion: "156.0.1.2",
  osVersion: "15.7",
  date: "2026-10-24",
  ...over,
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
      restartReading(afterRestart),
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

  it("records the restart load's own browser, OS and date beside the run's", () => {
    const envelope = usageEnvelope(storedRun(), restartReading(1000), "mvkzzzzz-r3st", 1_010_000);
    expect(envelope.chrome).toBe("Google Chrome 156");
    expect(envelope.date).toBe("2026-10-24");
    expect(envelope.figures.restartChromeFullVersion).toBe("156.0.1.2");
    expect(envelope.figures.restartOsVersion).toBe("15.7");
    expect(envelope.figures.restartDate).toBe("2026-10-24");
    expect(envelope.figures.chromeFullVersion).toBe("155.0.8059.85");
    expect(envelope.figures.runDate).toBe("2026-10-22");
  });

  it("reads NOT CHECKED not-restarted when the run's session marker survived, whatever the usage", () => {
    const envelope = usageEnvelope(storedRun(), restartReading(4_032_000_000, { sessionMarkerPresent: true }), "mvkzzzzz-r3st", 1_027_000);
    expect(envelope.verdict).toBe("NOT CHECKED not-restarted");
    expect(envelope.figures.sessionMarkerPresent).toBe("yes");
  });

  it("judges a restart reading near the run's own baseline as the in-session verdict", () => {
    const envelope = usageEnvelope(storedRun(), restartReading(1000), "mvkzzzzz-r3st", 1_010_000);
    expect(envelope.verdict).toBe("COUNTED");
    expect(envelope.figures.sessionMarkerPresent).toBe("no");
    expect(String(envelope.figures.detail)).toContain("restart: 1000");
  });
});

describe("a restart on an origin that already carried a phantom at the run", () => {
  const wrapped = 2 ** 32 - 405_562_444;
  const phantomRun = (truncateFirst: boolean) =>
    storedRun({ truncateFirst, beforeWrite: wrapped, afterWrite: wrapped + WRITTEN, afterDelete: wrapped });

  it("names the phantom in the in-session envelope", () => {
    const inSession = usageEnvelope(phantomRun(false), null, "mvk9abcd-q1w2", 1_000_500);
    expect(inSession.figures.unexplainedAtRunBytes).toBe(wrapped);
    expect(inSession.figures.restartDriftBytes).toBeNull();
  });

  it("reads a drift of minus the written size as NEGATIVE USAGE: this run's delete drove the saved figure down", () => {
    const envelope = usageEnvelope(phantomRun(false), restartReading(wrapped - WRITTEN + 4096), "mvkzzzzz-r3st", 1_090_000);
    expect(envelope.verdict).toBe("NEGATIVE USAGE");
    expect(envelope.figures.restartDriftBytes).toBe(-WRITTEN + 4096);
    expect(String(envelope.figures.detail)).toContain("already unexplained at the run");
  });

  it("reads a drift of about 0 as COUNTED, the phantom named: the truncate-first delete left the saved figure alone", () => {
    const envelope = usageEnvelope(phantomRun(true), restartReading(wrapped + 180), "mvkzzzzz-r3st", 1_090_000);
    expect(envelope.verdict).toBe("COUNTED");
    expect(String(envelope.figures.detail)).toContain("already unexplained at the run");
  });

  it("reads any other drift as NOT CHECKED phantom-before-run", () => {
    const envelope = usageEnvelope(phantomRun(false), restartReading(wrapped - 10 * WRITTEN), "mvkzzzzz-r3st", 1_090_000);
    expect(envelope.verdict).toBe("NOT CHECKED phantom-before-run");
  });
});
