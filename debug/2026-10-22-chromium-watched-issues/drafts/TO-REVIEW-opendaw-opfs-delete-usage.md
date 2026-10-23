# DRAFT, awaiting the user's read: not posted. Target: a new issue on andremichelle/openDAW.

The repro page and the note link resolve only once repo PR #175 (`debug/chromium-watched-issues`) is merged and
deployed. Until then the hosted URL serves the demo index. Every figure is from `../note.md`, section
"opfs-usage (436552046 / 401692415)". The fix idea stays in the note.

---

**Title:** OPFS: deleting a file written through a sync access handle drives Chrome's saved per-origin usage negative, and the next start reports ~4 GB used

**Body:**

In Chrome, writes through a `FileSystemSyncAccessHandle` never update the origin's saved file-system usage, but `removeEntry()` subtracts the file's full size from it. The saved figure goes negative, and the next browser start reads it back as 2³² + value. This is Chromium [436552046](https://issues.chromium.org/issues/436552046) / [401692415](https://issues.chromium.org/issues/401692415), both open. `OpfsWorker` writes every sample through a sync access handle and deletes with `removeEntry()` alone. So every sample it deletes lowers the origin's saved usage by that sample's size, and the origin's reported usage after a restart is a wrapped negative number.

**Where it happens.** `packages/lib/fusion/src/opfs/OpfsWorker.ts` at `@opendaw/lib-fusion@0.0.108` (`@opendaw/studio-sdk@0.0.177`):
- `write()` opens the file with `createSyncAccessHandle()` ([line 155](https://github.com/andremichelle/openDAW/blob/b78d6b0df53bc563010808a01789dd0a98b7a459/packages/lib/fusion/src/opfs/OpfsWorker.ts#L155)), then `truncate(data.length)`, `write`, `flush` ([line 23](https://github.com/andremichelle/openDAW/blob/b78d6b0df53bc563010808a01789dd0a98b7a459/packages/lib/fusion/src/opfs/OpfsWorker.ts#L23)). Chrome does not add these bytes to the saved usage.
- `delete()` calls `folder.removeEntry(name, {recursive: true})` ([line 75](https://github.com/andremichelle/openDAW/blob/b78d6b0df53bc563010808a01789dd0a98b7a459/packages/lib/fusion/src/opfs/OpfsWorker.ts#L75)). `clear()` calls `root.removeEntry(name)` and `root.removeEntry(name, {recursive: true})` ([lines 101 and 103](https://github.com/andremichelle/openDAW/blob/b78d6b0df53bc563010808a01789dd0a98b7a459/packages/lib/fusion/src/opfs/OpfsWorker.ts#L101-L103)). None of these paths truncates a file first. Chrome subtracts each removed file's full size.

In the published dist these lines are `dist/opfs/OpfsWorker.js` 158, 19, 81, 108 and 111.

**Measured signature.** Chrome 155.0.8059.85, macOS 15.6.1, 2026-10-22. The page is an SDK-free probe: a dedicated worker writes 64 MiB in 1 MiB `write()` calls through a sync access handle, then `flush()` and `close()`, then `removeEntry()`. `navigator.storage.estimate()` is read before and after, and again on the first load after Chrome is quit fully and reopened. The probe reads only that estimate after a restart. It decodes that figure as the saved one (a reading of 2³¹ or more minus 2³²) and walks the origin's OPFS to count what is actually stored.

1. **A plain delete, then a restart.** In the session, `estimate()` went 1 750 486 588 → 1 817 595 632 → 1 750 486 588: it follows the write and the delete. After the restart it read **4 278 445 047 bytes, which is 2³² − 16 522 249: a saved figure of −16 522 249.** No probe file was left (`test/` empty). The other files in the origin's OPFS totalled 238 135 417 bytes.
2. **A delete with `truncate(0)` through the handle first, then a restart.** Before this round, the 238 135 417 bytes of sample files (9 files, written through sync handles) were removed by hand. The prediction, written down before the result: if the truncate-first delete leaves the saved figure alone, the saved figure moves by −238 135 417, the samples' removal alone. After the restart, `estimate()` read 4 040 307 190, a saved figure of −254 660 106. **The drift was −238 137 857 against −238 135 417 predicted.** The 2 440-byte difference is accounted for by directory overhead: the session's own figure dropped by the same 238 137 857 when the samples were removed. A plain delete of the probe's file would have added another −67 108 864. The origin held 0 bytes of files at that restart.
3. **The saved figure read off disk**, in a second, persistent Chrome profile on the same machine. Per origin, `File System/<n>/t/.usage` holds the saved usage as a little-endian int64 in its last 8 bytes. Around two runs of the same probe:

   | moment | saved value (bytes) | change |
   |---|---|---|
   | before a plain run | −22 727 648 332 | — |
   | after the plain run | −22 794 757 196 | −67 108 864 |
   | after a truncate-first run | −22 794 757 196 | 0 |

   That origin's OPFS held no file, and `estimate()` reported 3 889 404 852 (all of it under `usageDetails.fileSystem`). It is the origin the demos use, and they write and delete samples through `OpfsWorker`.

So a sync-handle write adds nothing to the saved figure, a plain `removeEntry()` subtracts the full size, and a `removeEntry()` after `truncate(0)` subtracts nothing. The SDK's write and delete paths are the first two.

**Effect.** After a restart, `navigator.storage.estimate()` reports about 4 GB used on an origin that stores nothing, or 3.89 GB in the profile above. Not measured here: a browser that enforces a per-site quota or evicts on that usage would treat such an origin as nearly full.

**Repro.** https://opendaw-test.pages.dev/chromium-watched-issues-debug-demo.html?issue=opfs-usage (unlisted, no SDK loaded). Click Run, quit Chrome fully, and reopen the URL by hand, not through a restored session. The page judges the restart reading on load and shows the decoded saved figure (`savedUsageSigned`). `&truncateFirst=1` runs the truncate-first delete. The page writes only under its own `test/` folder. Figures, both restart rounds and the off-disk readings: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-22-chromium-watched-issues/note.md (section "opfs-usage (436552046 / 401692415)").
