// Does createSyncAccessHandle's promise survive its FileSystemFileHandle being garbage collected while the call is in flight?
// No SDK and no page of this repo: paste the function into DevTools on any https page, call it, read the JSON. About 80 s.
// It leaves about a hundred empty files under `FOLDER`. On this repo's origin the page-load sweep removes them.
//
// Every arm opens a file in a dedicated worker. In the arms with `burn`, a microtask allocates 800 MB of ArrayBuffers right
// after the call, so a collection runs before the reply can be delivered. "lost" counts promises still pending 2 s or more after
// the arm's last open.
async function syncHandleGcProbe() {
  const worker = `
const FOLDER = "samples/v2/probe-sync-handle-gc";
const burn = () => { for (let i = 0; i < 100; i++) new Uint8Array(new ArrayBuffer(8 << 20))[0] = 1; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const folder = async () => {
  let dir = await navigator.storage.getDirectory();
  for (const name of FOLDER.split("/")) dir = await dir.getDirectoryHandle(name, { create: true });
  return dir;
};
const collected = new Set();
const registry = new FinalizationRegistry((id) => collected.add(id));
const open = FileSystemFileHandle.prototype.createSyncAccessHandle;

// The handle's only reference is a local, cleared once the call is made. "retained" also keeps it in an array.
const inJob = async (arm, trials, burnMb) => {
  const dir = await folder();
  const held = [];
  const states = [];
  for (let i = 0; i < trials; i++) {
    states[i] = "pending";
    let handle = await dir.getFileHandle(arm + "-" + i + ".bin", { create: true });
    const promise = handle.createSyncAccessHandle();
    registry.register(handle, arm + i);
    if (arm === "retained") held.push(handle);
    handle = null;
    promise.then((access) => { states[i] = "settled"; access.close(); }, () => { states[i] = "rejected"; });
    await null;
    if (burnMb) burn();
    await sleep(0);
  }
  await sleep(4000);
  const finalized = [...collected].filter((id) => id.startsWith(arm)).length;
  return { arm, ran: trials, settled: states.filter((s) => s === "settled").length, rejected: states.filter((s) => s === "rejected").length, lost: states.filter((s) => s === "pending").length, finalized };
};

// A local of an async function, not read again after the await.
const openDead = async (dir, name) => {
  const handle = await dir.getFileHandle(name, { create: true });
  return await handle.createSyncAccessHandle();
};
// The same function with the local read after the await, so it stays live across the suspension.
const openLive = async (dir, name) => {
  const handle = await dir.getFileHandle(name, { create: true });
  const access = await handle.createSyncAccessHandle();
  if (handle.kind !== "file") throw new Error("kind");
  return access;
};
const hot = async (arm, trials) => {
  FileSystemFileHandle.prototype.createSyncAccessHandle = function () { const promise = open.call(this); queueMicrotask(burn); return promise; };
  const dir = await folder();
  const call = arm === "local-live" ? openLive : openDead;
  const states = [];
  const started = performance.now();
  for (let i = 0; i < trials && performance.now() - started < 40000; i++) {
    states[i] = "pending";
    call(dir, arm + "-" + (i % 8) + ".bin").then((access) => { states[i] = "settled"; access.close(); }, () => { states[i] = "rejected"; });
    for (let wait = 0; wait < 40 && states[i] === "pending"; wait++) await sleep(1);
  }
  await sleep(2000);
  const lost = states.flatMap((s, i) => (s === "pending" ? [i] : []));
  return { arm, ran: states.length, settled: states.filter((s) => s === "settled").length, rejected: states.filter((s) => s === "rejected").length, lost: lost.length, firstLost: lost.slice(0, 5) };
};

// The controls: the accounting reads a promise that never settles as pending, and the burn does collect.
const controls = async () => {
  let state = "pending";
  new Promise(() => {}).then(() => { state = "settled"; });
  let sentinelFinalized = false;
  const sentinels = new FinalizationRegistry(() => { sentinelFinalized = true; });
  let sentinel = {};
  sentinels.register(sentinel, 1);
  sentinel = null;
  for (let i = 0; i < 20 && !sentinelFinalized; i++) { burn(); await sleep(50); }
  return { arm: "controls", neverSettlingReads: state, sentinelFinalized };
};

self.onmessage = async ({ data: { arm, trials } }) => {
  try {
    if (arm === "controls") postMessage(await controls());
    else if (arm === "local-dead" || arm === "local-live") postMessage(await hot(arm, trials));
    else postMessage(await inJob(arm, trials, arm !== "cleared-no-burn"));
  } catch (error) {
    postMessage({ arm, error: String(error) });
  }
};`;
  const url = URL.createObjectURL(new Blob([worker], { type: "text/javascript" }));
  const arm = (name, trials, timeoutMs) =>
    new Promise((resolve) => {
      const w = new Worker(url);
      const timer = setTimeout(() => { w.terminate(); resolve({ arm: name, timedOut: true }); }, timeoutMs);
      w.onmessage = ({ data }) => { clearTimeout(timer); w.terminate(); resolve(data); };
      w.onerror = ({ message }) => { clearTimeout(timer); w.terminate(); resolve({ arm: name, workerError: message }); };
      w.postMessage({ arm: name, trials });
    });
  const results = [
    await arm("controls", 0, 15000),
    await arm("retained", 40, 30000),
    await arm("cleared", 40, 30000),
    await arm("cleared-no-burn", 100, 20000),
    await arm("local-dead", 3000, 50000),
    await arm("local-live", 3000, 50000),
  ];
  URL.revokeObjectURL(url);
  return JSON.stringify(results);
}
