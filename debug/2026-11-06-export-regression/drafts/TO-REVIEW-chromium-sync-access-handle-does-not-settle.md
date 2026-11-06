<!-- FOR NAOMI, REMOVE BEFORE POSTING: NOT READY TO POST. Beyond the two drafts you expected, written because a mechanism reproduced without the SDK. Missing: (1) per-trial evidence that finalization arrived while that promise was pending (the committed script counts finalizations per arm, only the wrapper on the SDK's worker has it per open); (2) the tracker search, through your own Chrome (a web search found no report, the tracker itself is unsearched); (3) the retained arm at the lost arm's size (40 opens against 791); also a run in your own Chrome. Then decide whether openDAW gets a note too, since its worker is where this bit. The script link works once feat/export-regression-harness is merged. What ties this to the natural stall on the page is inferred; the note says so. -->

# createSyncAccessHandle's promise does not settle under allocation pressure when nothing else references the FileSystemFileHandle

**Version:** Chrome 156.0.8078.81, launched by Playwright, macOS 15.6.1. Not tried on other versions or platforms.

In a dedicated worker, when a heavy allocation runs right after `createSyncAccessHandle()` and nothing else references the `FileSystemFileHandle`, the returned promise can stay pending. It neither resolves nor rejects. The longest span measured: the script stops watching 2 s after its last open, by which time the first lost open of a 40 s arm had been pending about 30 s (estimated from its place in the arm, not recorded per trial). On the page below, an unforced stall was still pending 180 s later.

**Repro:** https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/sync-handle-gc-probe.js. Paste it into DevTools on any https page, then `await syncHandleGcProbe()`, about 80 s. It uses no library. A microtask allocates 800 MB of ArrayBuffers right after the call, before the reply can be delivered.

```js
// In a dedicated worker. The handle is not read after the await.
const open = async (dir, name) => {
  const handle = await dir.getFileHandle(name, { create: true });
  return await handle.createSyncAccessHandle();
};
```

**Measured.** One run each. "Lost" is pending 2 s or more after the arm's last open. Run 2 is the linked script. Run 1 was not: an earlier form of the same arms.

| Arm | Run 1 | Run 2 |
|---|---|---|
| Handle kept in an array, allocation | 40 of 40 settled | 40 of 40 settled |
| Only reference a local, cleared after the call, allocation | **33 of 40 lost** | **2 of 40 lost** |
| The same, no allocation | 100 of 100 settled | 100 of 100 settled |
| The function above, allocation | **178 of 718 lost**, the first at open 172 | **182 of 791 lost**, the first at open 190 |
| The function above with `handle.kind` read after the await, allocation | 3000 of 3000 settled | 3000 of 3000 settled |

The fourth arm is the reliable one; the second moved from 33 to 2 between runs. No promise rejected in any arm. In the array arm no handle was finalized (a `FinalizationRegistry` on each). Two controls run first: the accounting reads a promise that never settles as pending, and a sentinel object is finalized by the same allocation.

**The file stays free.** On a page stalled at this call, a new worker opened the same file through `createSyncAccessHandle` in 0.7 ms, so nothing held the file.

**Where I met it.** A real page without forced allocation stalled at this call, 4 times in 18 full runs, in a worker running openDAW's `OpfsWorker`, whose code is the function above. With the same forced allocation in that worker (one run), a `FinalizationRegistry` per open reported three handles collected while their opens were pending, and the page stalled in the same step. With each handle kept until its promise settled (one run), the same run completed. All four unforced stalls were the same file at the same point in the run; the forced stall took three opens on another file. Whether the unforced stalls are this case is my inference: with an observer attached and on one plain re-run they did not recur.

**My guess at the first-loss figures, unverified:** opens 172 and 190 fit an optimizing tier saving only live registers across the await, since the arm reading `handle` afterwards loses none.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
