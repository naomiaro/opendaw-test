<!-- FOR NAOMI, REMOVE BEFORE POSTING: beyond the two drafts you expected, written because the cause reproduced without the SDK. Before posting: search the Chromium tracker through your own Chrome (a web search found no report, the tracker itself is unsearched), run the script in your Chrome, and decide whether openDAW gets a note too, since its worker is where this bit. The script link works once feat/export-regression-harness is merged. What ties this to the natural hang on the page is inferred; the note says so. -->

# createSyncAccessHandle's promise never settles if the FileSystemFileHandle is garbage collected while the call is in flight

**Version:** Chrome 156.0.8078.81, macOS 15.6.1. Not tried on other versions or platforms.

In a dedicated worker, when the only reference to a `FileSystemFileHandle` goes away while its `createSyncAccessHandle()` is in flight, a garbage collection in that window leaves the returned promise pending for good. It neither resolves nor rejects. A garbage collection is not supposed to be observable like this.

**Repro:** https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/sync-handle-gc-probe.js. Paste it into DevTools on any https page, then `await syncHandleGcProbe()`, about 80 s. It uses no library. It forces the collection with a microtask allocating 800 MB of ArrayBuffers right after the call, before the reply can be delivered.

```js
// In a dedicated worker. The handle is not read after the await.
const open = async (dir, name) => {
  const handle = await dir.getFileHandle(name, { create: true });
  return await handle.createSyncAccessHandle();
};
```

**Measured.** "Lost" is pending 2 s or more after the arm's last open. Two runs:

| Arm | Run 1 | Run 2 |
|---|---|---|
| Handle kept in an array, allocation | 40 of 40 settled | 40 of 40 settled |
| Only reference a local, cleared after the call, allocation | **33 of 40 lost** | **2 of 40 lost** |
| The same, no allocation | 100 of 100 settled | 100 of 100 settled |
| The function above, allocation | **178 of 718 lost**, the first at open 172 | **182 of 791 lost**, the first at open 190 |
| The function above with `handle.kind` read after the await, allocation | 3000 of 3000 settled | 3000 of 3000 settled |

No promise rejected in any arm. In the array arm no handle was finalized (a `FinalizationRegistry` on each). Two controls run first: the accounting reads a promise that never settles as pending, and a sentinel object is finalized by the same allocation.

**The file stays free.** On a page stalled in what looks like this case (below), a new worker opened the same file through `createSyncAccessHandle` in 0.7 ms, so nothing held the file.

**Where I met it.** A real page without forced allocation stalled at this call, 4 times in 18 full runs, in a worker running openDAW's `OpfsWorker`, whose code is the function above. With the same forced allocation in that worker, a `FinalizationRegistry` reported three handles collected while their opens were pending, and the page stalled in the same step. With each handle kept until its promise settled, the same run completed. Whether the unforced stalls are this case is my inference: with an observer attached and on one plain re-run they did not recur.

**My guess at the first-loss figures, unverified:** opens 172 and 190 fit an optimizing tier saving only live registers across the await, since the arm reading `handle` afterwards loses none.

Note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-06-export-regression/note.md
