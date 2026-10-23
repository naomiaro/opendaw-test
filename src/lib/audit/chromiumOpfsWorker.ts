/**
 * The dedicated worker of the OPFS probes, as source text (started from a Blob URL, the
 * pattern of `src/lib/workerTicker.ts`, so no bundler worker plumbing). Sync access handles
 * exist only in a dedicated worker. Everything it writes is under the origin's `test/`
 * folder; it never touches `samples/`, which the demos' page-load sweep owns.
 *
 * Requests (`postMessage`), each answered with one message:
 * - `{ kind: "usage", runToken, mib, truncateFirst }`: write `test/<runToken>.bin` in 1 MiB
 *   `write()` calls, `flush()`, `close()`; reopen, read `getSize()`, truncate to 0 through
 *   the handle when asked, close, `removeEntry()`. `estimate()` usage before the write, after
 *   the close and after the delete; the bytes of every file in the origin's OPFS before the write.
 * - `{ kind: "flush", runToken, counts }`: `test/<runToken>-flush.bin`, `counts` writes of
 *   1 MiB then of 16 MiB, each followed by a `flush()`; the write and the flush timed apart.
 * - `{ kind: "scan" }`: `estimate()`, the files left under `test/`, the bytes of every file.
 * A failure answers `{ ok: false, error }`; no sync access handle answers `{ ok: false, unavailable }`.
 * A usage or flush request always closes its handle and removes its file, each step tried on its
 * own, and a failure reports the first error (the write's before a cleanup's): a file left behind
 * would count in every later scan. `estimate()` without a usage or quota reads null, not NaN.
 */

export interface UsageRequest { kind: "usage"; runToken: string; mib: number; truncateFirst: boolean }
export interface FlushRequest { kind: "flush"; runToken: string; counts: number }
export interface ScanRequest { kind: "scan" }
export type OpfsWorkerRequest = UsageRequest | FlushRequest | ScanRequest;

export interface UsageResult {
  ok: true; kind: "usage"; writtenBytes: number; sizeReadBack: number; truncated: boolean; opfsBytesAtRun: number;
  beforeWrite: number | null; afterWrite: number | null; afterDelete: number | null; quota: number | null; removed: boolean;
}
export interface FlushResult {
  ok: true; kind: "flush";
  writeMs1: number[]; flushMs1: number[]; writeMs16: number[]; flushMs16: number[];
  finalSize: number; removed: boolean; quota: number | null;
}
export interface ScanResult { ok: true; kind: "scan"; usage: number | null; quota: number | null; testFiles: number; opfsBytes: number }
export type OpfsWorkerAnswer =
  | UsageResult | FlushResult | ScanResult
  | { ok: false; unavailable: string } | { ok: false; error: string };

export const OPFS_WORKER_SOURCE = `
const MIB = 1024 * 1024;
const estimate = async () => {
  const e = await navigator.storage.estimate();
  return { usage: typeof e.usage === "number" ? e.usage : null, quota: typeof e.quota === "number" ? e.quota : null };
};
// Runs \`body\`, then each cleanup step on its own; rethrows the body's error first, else the first cleanup's.
const withCleanup = async (body, steps) => {
  let failure = null;
  let result;
  try { result = await body(); } catch (e) { failure = { error: e }; }
  for (const step of steps) {
    try { await step(); } catch (e) { if (failure === null) failure = { error: e }; }
  }
  if (failure !== null) throw failure.error;
  return result;
};
const testDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("test", { create: true });
const exists = async (dir, name) => {
  try { await dir.getFileHandle(name); return true; } catch (e) { if (e && e.name === "NotFoundError") return false; throw e; }
};
const chunk = (bytes) => {
  const data = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) data[i] = (i * 31 + 7) & 255;
  return data;
};
const usage = async (req) => {
  const dir = await testDir();
  const name = req.runToken + ".bin";
  const atRun = await walk(await navigator.storage.getDirectory());
  const before = await estimate();
  const file = await dir.getFileHandle(name, { create: true });
  let handle = null;
  let written = 0, afterWrite, sizeReadBack;
  await withCleanup(async () => {
    handle = await file.createSyncAccessHandle();
    const data = chunk(MIB);
    for (let i = 0; i < req.mib; i++) written += handle.write(data, { at: i * MIB });
    handle.flush();
    const closing = handle;
    handle = null;
    closing.close();
    afterWrite = await estimate();
    handle = await file.createSyncAccessHandle();
    sizeReadBack = handle.getSize();
    if (req.truncateFirst) { handle.truncate(0); handle.flush(); }
  }, [
    () => { if (handle !== null) { const open = handle; handle = null; open.close(); } },
    () => dir.removeEntry(name),
  ]);
  const afterDelete = await estimate();
  return { ok: true, kind: "usage", writtenBytes: written, sizeReadBack, truncated: req.truncateFirst, opfsBytesAtRun: atRun.bytes,
    beforeWrite: before.usage, afterWrite: afterWrite.usage, afterDelete: afterDelete.usage,
    quota: afterDelete.quota, removed: !(await exists(dir, name)) };
};
const flush = async (req) => {
  const dir = await testDir();
  const name = req.runToken + "-flush.bin";
  const handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  const timed = (bytes) => {
    const data = chunk(bytes);
    const writeMs = [], flushMs = [];
    for (let i = 0; i < req.counts; i++) {
      const t0 = performance.now();
      handle.write(data, { at: handle.getSize() });
      const t1 = performance.now();
      handle.flush();
      const t2 = performance.now();
      writeMs.push(t1 - t0);
      flushMs.push(t2 - t1);
    }
    return { writeMs, flushMs };
  };
  let one, sixteen, finalSize;
  await withCleanup(async () => {
    one = timed(MIB);
    sixteen = timed(16 * MIB);
    finalSize = handle.getSize();
  }, [() => handle.close(), () => dir.removeEntry(name)]);
  const { quota } = await estimate();
  return { ok: true, kind: "flush", writeMs1: one.writeMs, flushMs1: one.flushMs, writeMs16: sixteen.writeMs,
    flushMs16: sixteen.flushMs, finalSize, removed: !(await exists(dir, name)), quota };
};
const walk = async (dir) => {
  let files = 0, bytes = 0;
  for await (const [, entry] of dir.entries()) {
    if (entry.kind === "file") { files++; bytes += (await entry.getFile()).size; }
    else { const inner = await walk(entry); files += inner.files; bytes += inner.bytes; }
  }
  return { files, bytes };
};
const scan = async () => {
  const root = await navigator.storage.getDirectory();
  const all = await walk(root);
  let testFiles = 0;
  try { testFiles = (await walk(await root.getDirectoryHandle("test"))).files; }
  catch (e) { if (!e || e.name !== "NotFoundError") throw e; }
  const { usage, quota } = await estimate();
  return { ok: true, kind: "scan", usage, quota, testFiles, opfsBytes: all.bytes };
};
self.onmessage = async (event) => {
  const req = event.data;
  try {
    if (req.kind !== "scan" && (typeof FileSystemFileHandle === "undefined" || !("createSyncAccessHandle" in FileSystemFileHandle.prototype))) {
      self.postMessage({ ok: false, unavailable: "no-createSyncAccessHandle" });
      return;
    }
    const answer = req.kind === "usage" ? await usage(req) : req.kind === "flush" ? await flush(req) : await scan();
    self.postMessage(answer);
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.name) + ": " + String(e && e.message) });
  }
};
`;
