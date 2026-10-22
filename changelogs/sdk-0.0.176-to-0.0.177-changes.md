# OpenDAW SDK Changelog: 0.0.176 → 0.0.177

One publish (0.0.177 on 2026-10-22; 67 commits tag-to-tag, 60 of them non-merge, 186 files,
two days after 0.0.176). Most of the release is the studio's **script views** work (a sandboxed
UI per scriptable device) and its examples, which are app code; the SDK side of it, and a
handful of fixes, are what matters for this repo:

1. **Take numbers continue across recordings** — a new recording on an audio unit numbers
   its takes after the highest "Take N" already among the unit's regions
   (`RecordTrack.lastTakeNumber`, read once at record start; `RecordMidi` the same), where
   every recording used to start at "Take 1" again. Three recordings on one tape now read
   Take 1, Take 2, Take 3. **This changed demo behaviour**: `useTakeDiscovery` treated
   "Take 1" as the lead-in take, and a second recording on the same tape merged its regions
   into the first recording's take rows (same numbers); the hook now tells the lead-in take by
   its position and a second recording appears as new rows (see follow-ups).
2. **Stopping a recording no longer deletes the take once the input tail has arrived (#483)**
   — the tail timeout 0.0.176 added read the worklet's frame count after the worklet had saved
   and released its chunks, saw zero frames and resized the take to nothing; it now does
   nothing once the recording is saved. The repo's sweeps did not hit it (their takes end
   with the tail already in; the report came from a Windows machine), so the fix is pinned
   by the upstream test, not by a harness reading.
3. **A pointer set in a box constructor and changed again in the same transaction keeps its
   order** — the constructor update of a pointer used to be processed at the end of the
   transaction, after the later change, so the pointer resolved to its constructor target,
   `BoxEditing` recorded the step in the wrong order (undo and redo failed) and an aborted
   transaction failed in the rollback. Now the constructor updates of a pointer and its later
   change resolve first, in order, and the listeners run after. This is the race behind
   CLAUDE.md's "re-route in a separate transaction" rule (`createInstrument` routes
   `output` to master in the constructor); the rule is rewritten and a regression test
   pins the fixed order against the installed `lib-box` (see follow-ups).
4. **The DSP-load meter reads a spinning clock worker** — the `Atomics.wait` handshake
   dropped about half of all blocks (the slowest ones most), was off by up to a millisecond and
   cost the audio thread two notifies per block. `HRClockWorker` now spins
   `performance.now()` into one shared float, only while leased (`lease(): Terminable`;
   `EngineWorklet` holds a lease while `debug.dspLoadMeasurement` is on; the worker is
   terminated when the last lease ends), and the processor reads it twice per block; an
   elapsed of 0 is not written. On a machine with fewer than four hardware threads the lease is
   empty and the meter reports nothing.
5. **Clipping a seconds region no longer leaves its remainder on another region's start**
   (studio live errors 1186, 1187) — a seconds region ends at its successor, so when a clip
   ended exactly where a musical region starts, the split or start-trim put an empty remainder
   on that start and the next re-sort failed with "regions overlap". `RegionClipResolver`
   drops the remainder: a split keeps the left part, a start trim removes the region.
6. **Bounce regions to audio** (#301) — `AudioBounce` in `studio-core`: a region renders solo
   through its instrument (`tap` pre-fx / pre-fader / post-fader, optional tail until silent
   at most 30 s, merged per instrument, or one loop pass rendered twice with the second kept),
   lands on a new Tape unit below the instrument, the originals muted, the samples filed in a
   "Bounces" folder, one undo. The studio's region menu is app code; no demo uses the API.
7. **Script devices: data, streams, views (processor side)** — new boxes `ScriptRecordBox`,
   `ScriptValueBox`, `ScriptBufferBox`, `ScriptBufferChunkBox` (`Pointers.ScriptRecord` 61,
   `ScriptValue` 62, `ScriptBuffer` 63, `ScriptBufferChunk` 64); `WerkstattDeviceBox`,
   `ApparatDeviceBox` and `SpielwerkDeviceBox` gain fields 14 `records` and 15 `buffers`;
   `ScriptDeclaration` parses `@collection` / `@field` / `@record`, `@buffer`, `@stream`
   (value / ring / fft), `@view`, `@window` and `[omit-default-ui]` on a `@param`;
   `ScriptCompiler.Config` takes optional `records` / `buffers`, `wrap` gains an `enforce`
   flag, `wrapView` wraps view code, `replace(audioContext, editing, deviceBox, source,
   create)` swaps a device for a fresh one in one undo step (#488: loading an example used to
   hand the new parameter values to the old processor). The bridge resolves `this.data.<name>`
   per block, binds `this.streams.<name>`, delivers `host.send` messages to `message()` before
   the next `process()` (`afterRender` drops the queue of a device that did not render), and
   `Engine` / `EngineFacade` / `EngineWorklet` / the processor protocol gain
   `scriptMessage(uuid, message)`. `instantiateWasmEngine` returns `{engine, scriptBridges}`
   and takes a `broadcaster` provider; `ScriptBridges` takes it too. New adapter modules:
   `ScriptBuffers`, `ScriptEntryPoints`, `ScriptRecords`, `ScriptTokenizer`, `ScriptTopLevel`,
   `ScriptViewLayout`.
8. **Script params and samples keep their values when `@param` or `@sample` lines are
   reordered** — the engine read a parameter's declaration index once at bind, so a reorder
   delivered every value under its old index (a swapped param, a NaN, a sample under another
   name). It now watches each param's index and re-binds on a change; sample slots read their
   index at delivery. **A saved script with a malformed `@collection`, `@stream` or `@buffer`
   line still loads** (a warning; compiling still refuses it).
9. **OPFS stalls report themselves** — the OPFS worker warns `[OPFS] <op> '<path>' runs for
   <n>s at '<step>'` when a lone operation holds for 5 s, and `Workers` wraps every OPFS call
   with a 10 s "no answer from the worker" warning (and one when it finally answers).

Sub-package versions (installed): `studio-adapters` 0.3.9 (was 0.3.8), `studio-core` 0.2.11
(0.2.10), `studio-core-wasm` 0.0.22 (0.0.21), `studio-boxes` 0.0.115 (0.0.114),
`studio-enums` 0.1.8 (0.1.7), `lib-box` 0.0.99 (0.0.98), `lib-fusion` 0.0.108 (0.0.107).
Bumped with a byte-identical `dist` (version bump only): `lib-dsp` 0.0.97, `lib-std` 0.0.88,
`lib-dom` 0.0.93, `lib-jsx` 0.0.95, `lib-midi` 0.0.78, `lib-dawproject` 0.0.82,
`lib-runtime` 0.0.89, `lib-xml` 0.0.74. Unchanged: `nam-wasm` 1.2.0. Licences unchanged
(AGPL-3.0-or-later; `nam-wasm` MIT). WASM: **34 binaries under `studio-core-wasm`, 4
changed** — `engine.wasm` (1 177 823 → 1 215 110 bytes: the script data / buffer / stream
paths, the param re-bind), `device_apparat` (10 047 → 10 192), `device_spielwerk` (1 170 →
1 316) and `device_werkstatt` (2 638 → 2 783: `observe_record_collection_field`,
`observe_buffer_collection_field`, `data_changed`). The 30 other binaries are byte-identical.
`OPENDAW_SDK_VERSION` in the installed `studio-sdk` reads `"0.0.177"`.

## Takes number on from the unit (`bc3e192b7`, `717b2a4ef`)

- `RecordTrack.lastTakeNumber(audioUnitBox): int` — the highest `Take N` (`/^Take (\d{1,9})$/`)
  among the regions of every track of the unit, 0 without one; regions renamed by the user
  drop out of the count. `RecordAudio` and `RecordMidi` start their counter there at record
  start and count up per take as before (the first commit asked per take through a
  `nextTakeNumber`; the second reads once). Each audio unit counts its own takes; one unit
  has one capture, so two recorders never number on the same unit.
- Upstream tests: `RecordMidi.test.ts` (a second recording after a first, a second recording
  that wraps the loop; the setup gains `restart()`), `RecordAudio.test.ts` (a take placed on
  a unit that already holds "Take 3"), `RecordTrack.test.ts` (the count).
- For this repo: the MIDI audits order takes by label RELATIVELY (`orderTakes` in
  `src/lib/audit/midiInputRecorded.ts` re-indexes from 1), the alignment harness records one
  take per fresh tape, the recording-api demo reads the `Take ` prefix only — unaffected.
  `useTakeDiscovery`, the swipe-comping and loop-recording demos are the ones that read the
  number (follow-ups).

## #483: the tail timeout does nothing once saved (`cf4748d98`)

`RecordAudio.ts`: an `isSaved` flag set in `onSaved`; the tail timeout returns when it is set.
Upstream test "does not resize the take once the recording is saved" (+26 lines). The
0.0.176 changelog described the timeout as "trims the take to what arrived if the tail is
still incomplete after the shortfall plus one second"; on a machine where the save completes
before that deadline the trim read zero frames through the released worklet. The repo's
sweep rows never showed it (every tail arrived within the margin, and the sweep reads the
saved buffer, which was not affected on the machines it ran on).

## Constructor pointer order (`daca0d5c3`)

`lib-box/src/graph.ts`: `#deferredPointerFields` (a `Set<PointerField>`) beside
`#deferredPointerUpdates`; when a pointer that has a deferred constructor update changes
outside box construction, `#takeDeferredPointerUpdates(pointerField)` pulls its constructor
updates out, they and the new update are pushed to the transaction updates and resolved in
order (`#resolvePointerUpdate`), then dispatched to the listeners; the end-of-transaction
pass (`#processDeferredPointerUpdates`) loops until the array stays empty because a listener
can add to it; `#finalizeTransaction` clears the set. Upstream tests in `editing.test.ts`
(+137): clear-then-undo-redo, second-target-then-undo-redo, a listener changing another
constructor pointer, a listener's change kept, every pointer resolved in a load without
validation, an aborted transaction rolled back. The repo's test is in the follow-ups.

## DSP-load clock (`e9200bd0e`)

- `HRClockWorker`: the SAB is one float64; the worker code is one line (`while (true)
  {now[0] = performance.now()}`); `lease()` creates the worker on the first lease and
  terminates it on the last release (the float reset to 0); `navigator.hardwareConcurrency <
  4` returns `Terminable.Empty`. `EngineWorklet` owns a lease through its
  `debug.dspLoadMeasurement` preference subscription.
- `HRClock` (core-processors): `start()` copies the float, `end()` returns the difference or
  0 when the start read 0. The processor writes `elapsed` to the perf buffer only when
  positive; the 0.0.176 `start()` returned the PREVIOUS quantum's validated time.
- Upstream `plans/`: the measurement findings (handshake vs spinning clock, Chrome and
  Firefox, spec status).

## Seconds-region remainder (`62b147c6f`)

`RegionClipResolver`: `#claimedStarts(tasks)` lists where every non-seconds region will start
once the tasks ran (untouched ones keep theirs, trimmed ones and the right parts of separated
ones start at the mask end); `emptyRemainder(region, start)` is a seconds region
(`RegionOverlap.endsAtSuccessor`) whose remainder would start on a claimed start within the
boundary tolerance — such a `start` task deletes the region, such a `separate` keeps the left
part (`#trimComplete`). Test `Region1186SecondsRemainder.test.ts` (116 lines). For this repo:
the demos never clip a seconds region against a musical one; the rule documented in
`documentation/02-timing-and-tempo.md` (a Seconds region may reach over its successor) holds.

## Bounce (`ce55cb428`)

`studio-core` `AudioBounce` namespace: `Tap`, `Options {tap, tail, merge, loop}`, `Job`,
`Span`, `FolderName` "Bounces", `MaxTailSeconds` 30, `TailSilenceSeconds` 1,
`SilenceThreshold`, `ChunkFrames`, `DefaultOptions`, `isBounceable`, `canBounce`,
`canMerge`, `collectJobs(regions, merge, loop)`, `stemConfiguration(tap, fileName)`,
`exportConfiguration(job, tap)`, `prepareCopy(copy, job)`, `audibleLength`, `assignLanes`,
`fileInto`, `bounce(project, sampleService, regions, options, abortSignal?)`, `frameCount`,
`renderSpan`, `renderFrames(step, span, sampleRate, onProgress?, abortSignal?)`,
`applyEdit(project, rendered)`. Rendered through the offline renderer on a project copy
(`prepareCopy` solos the job), a loop job in two passes with the second kept. Upstream tests
`AudioBounce.test.ts` (848 lines) and `core-wasm/test/audio-bounce.test.ts` (346).

## Script views, data and streams (`81e9b7c9b` … `2c82edaf3`, `c75af19b2`, `349b2258f`, `46f81cc33`, `eba65b923`)

- **Boxes** (`forge-boxes` → `studio-boxes`): `ScriptRecordBox` (one row of a collection),
  `ScriptValueBox` (one cell), `ScriptBufferBox` (bulk floats; field 4 is the legacy whole
  blob, read while the box has no chunks) with `ScriptBufferChunkBox` children of 256 floats
  so an edit records and syncs only the chunks it touches (a 300-move stroke on a 16 384-float
  wavetable kept 37.5 MB in one undo entry; now 0.59 MB); `records` (14) and `buffers` (15)
  on the three script device boxes; `BoxIO` / `BoxVisitor` list the four boxes;
  `test-files/all-boxes.od` regenerated.
- **Adapters**: `ScriptDeclaration` — `ViewDeclaration {className, column, row, columns,
  rows}`, `WindowDeclaration {className, width, height}`, `CollectionDeclaration {name,
  index, fields, records}`, `BufferDeclaration {name, index, length}`, `StreamDeclaration
  {name, index, length, kind}`, `ParamDeclaration.omitDefaultUi`, a `{type: "view"}` group
  item, `parseCollections` / `parseBuffers` / `parseStreams` / `parseViews` /
  `parseWindows`; `ScriptTokenizer`, `ScriptTopLevel` (a script with a view keeps no
  top-level state), `ScriptEntryPoints`, `ScriptRecords`, `ScriptBuffers`,
  `ScriptViewLayout` (controls fill the free cells, overlaps shown red in the studio).
  `ScriptCompiler`: `Config.records` / `Config.buffers`, `wrap(config, uuid, update,
  userCode, enforce?)`, `wrapView(userCode)`, `replace(...)`; param and sample boxes keep
  their values when their lines are reordered (re-numbered, not recreated).
- **Engine**: `abi` `host_script_data(handle, collection, ptr, records, fields)` (one
  `@collection` snapshot, f32 record-major, NaN = no value box; collection `u32::MAX` resets
  all); `engine-exports` `device_set_record_collection(deviceId, recordField, bufferField,
  dataChangedIndex)`; the device linker's optional `observe_record_collection_field`,
  `observe_buffer_collection_field`, `data_changed`; `script_device.rs` (+264) and
  `params.rs` (the index watch); the three script device crates export the two observers.
  **Bridge** (`script-bridge.ts`): `pendingData` per collection, `toRecords` / `toBuffer`
  build frozen `this.data`, `#syncData` runs before each `process` (a failing sync mutes a
  Werkstatt and forwards a Spielwerk), `#bindStreams` / `#unbindStreams` publish `this.streams`
  through the live-stream broadcaster (composite replicas share the device address, the
  first wins), `message(uuid, message)` queues a view's `host.send` for every instance of the
  device, `#deliverMessages` hands the queue to `proc.message` before `process` (a thrown
  `message` silences the device like a thrown `process`), `afterRender()` drops the queue of a
  device that did not render this quantum. `processor.ts` handles the `scriptMessage` command
  and calls `afterRender` after each quantum.
- **Studio (app code, no SDK surface)**: the sandboxed view frame (`ScriptViewFrame`,
  `view-runtime.js`: keys forwarded only while the view has focus, no API for a page the frame
  navigated to, a script error cancels the view's frames, right-clicks ignored, Control+Click
  on macOS as a right click, `host.attachParameter` opens the parameter menu,
  `host.params.<name>.sources`), the device panel keeping editors attached across chain
  changes, `@window` floating windows, the starter prompts and manuals, the examples
  (Wavetable synth with Serum-style bend, Tonematrix, Parametric EQ over a live spectrum,
  Pulsate, XY Filter, Chaos Pad; names drop the "(View)" suffix), the Bounce dialog and
  `Bounces.ts`, the WebCLAP device's Update button (`supersedes` in the index), publishing
  uploads in 4 MiB chunks with byte progress, a `studio-scripting` package publishing the
  editor declarations, three plans (script views, script storage in OPFS, `opendaw-commons`),
  the DSP-load findings plan, error triage (live errors 1186 / 1187 fixed; 1185, an engine
  restart loop until out of memory, under investigation upstream).

## Upstream tests

`lib-box` `editing.test.ts` (+137); `lib-fusion` `OpfsWorker.test.ts` (+26);
`studio-adapters` `ScriptBuffers.test.ts` (152), `ScriptCollections.test.ts` (62),
`ScriptCompiler.test.ts` (+75), `ScriptDeclaration.test.ts` (+48),
`ScriptEntryPoints.test.ts` (277), `ScriptRecords.test.ts` (179), `ScriptTopLevel.test.ts`
(163), `ScriptViewLayout.test.ts` (81); `core-wasm/test/` `audio-bounce.test.ts` (346),
`script-example-replace.test.ts` (537), `script-param-reorder.test.ts` (135),
`script-records.test.ts` (202), `script-streams.test.ts` (112); `studio-core`
`AudioBounce.test.ts` (848), `RecordAudio.test.ts` (+62), `RecordMidi.test.ts` (+33),
`RecordTrack.test.ts` (46), `Region1186SecondsRemainder.test.ts` (116),
`DevicesClipboardHandler.test.ts` (+32); `crates/engine` `audio_unit/tests.rs` (+151).

## opendaw-headless follow-ups shipped with this upgrade

- **No code change forced by the compiler**: `npm run typecheck` exits 0 before and after the
  bump; nothing in `src/` or `scripts/` calls `instantiateWasmEngine`, constructs
  `ScriptBridges`, implements `Engine`, or reads `HRClockWorker`.
- **Take numbering**: `src/demos/recording/takeLeadIn.ts` — `isLeadInTake(positionPpqn,
  leadInBars)` (the lead-in take starts before the loop area) and the shared `BAR_PPQN`;
  `useTakeDiscovery` carries each region's `positionPpqn` and judges the lead-in by it, so a
  second recording on the same tape shows as new rows with the SDK's numbers (it used to merge
  into the first recording's rows, every recording being "Take 1" again); the three demos
  that defined their own `BAR_PPQN` import the shared one. Tests in `takeLeadIn.test.ts`.
  Browser check on the release, the built-in microphone, a real click per recording: in the
  loop-recording demo (1-bar lead-in, 2-bar loop, count-in) a first recording gave Take 1 to
  Take 4, the second on the same tape Take 5 to Take 8 — Take 1 and Take 5 drawn full-width as
  the lead-in takes, the six loop takes at the loop's width, the mute button of Take 5
  toggling that row alone; in the swipe-comping demo (4-bar loop) "Record More Takes" after
  two takes gave four lanes, the SDK's regions labelled Take 1 to Take 4 (every recording used
  to start at "Take 1" again and the second's rows merged into the first's).
- **Constructor pointer order**: `src/lib/constructorPointerOrder.test.ts` creates an audio
  unit through `AudioUnitFactory` (output routed to the primary bus in the constructor) and
  re-routes it to an aux bus in the SAME transaction — target, edges, undo, redo and an
  aborted transaction's rollback. All three pass on the release and **all three fail with the
  0.0.176 `lib-box/dist/graph.js` swapped in** (the pointer resolves to the primary bus,
  undo leaves the edge, the rollback leaves the box). CLAUDE.md's "Pointer Re-Routing"
  section now says a same-transaction re-route is correct and keeps the separate-transaction
  advice for READS (`targetVertex`, `captureDevices.get`), which still resolve at commit.
- **Docs for what changed**: `documentation/internals/03-cross-thread-protocols.md` (the
  HRClock section rewritten for the spinning clock and the lease),
  `documentation/15-performance-and-debugging.md` (the clock; `cpuLoad` is a 0–100 integer,
  the example multiplied it by 100 again), `documentation/14-glossary.md`,
  `documentation/19-wasm-engine.md`, `src/demos/engine/CLAUDE.md` (the lease and the
  four-thread floor), `documentation/08-recording.md` and `src/demos/recording/CLAUDE.md`
  (take numbers continue on the unit), `documentation/17-modular-devices.md` (a "Script data,
  streams and views" section: the declarations, `this.data`, `this.streams`, `host.send`,
  `[omit-default-ui]`, the reorder rule, the malformed-line rule, `ScriptCompiler.replace`),
  `documentation/10-export.md` (`AudioBounce`), `documentation/13-troubleshooting.md` (the
  OPFS stall warnings), root CLAUDE.md (the pointer rule).
- **Standing sweeps on the release — every reading the 0.0.176 reading**: sample-rate /
  quantum-alignment **180 of 180** cells pass (every family's maximum deviation the 0.0.176
  value to the hundredth — metronome 0.08, loop-wrap 0.54, seam 0.20, region-fencepost 0.03,
  note-onsets 0.48, automation 0.94, tempo-ramp 2.67, signature 0.07, transport-pos 0.07 ms).
  Recording start-alignment, 48 kHz and 44.1 kHz, 60 rows each, 0 error rows, every repeat
  finalized: 48 kHz netted tally 1.15 ×33, 1.17 ×15, 1.07 / 1.10 / 1.13 / 1.14 ×3 each (the
  0.0.174–0.0.176 tally exactly), **0 tail deficits**, one head deficit of 94.4 ms on
  `nominal-start/120` repeat 1 — the first recording after the fresh `npm install` and dev
  server, the cold-start event every sweep since 0.0.173 has recorded at that place
  (`recaudit-summary-1792689656151.json`); 44.1 kHz **10 of 10 cells aligned**, netted
  +0.97…+1.19, two tail rows at 0.06 / 0.14 ms (one to six frames of rounding, as the 0.0.176
  sweep's 0.02 / 0.04; `…1792690074147.json`). Multi-mic 32 rows netted +1.146 on every row,
  netted skew 0.00, raw skew 0 quanta on 16 of 16 repeats, no tail deficit, both cells
  `aligned` (`recaudit-mt-summary-1792690492685.json`); three forced-churn runs 48 rows,
  60 433–74 024 connect / disconnect pairs per repeat, 97–121 clock stalls per run, **every
  row at 0 / 0 quanta** off the usual placement, no tail deficit; one-quantum tally **0 in 76**
  (0.0.176: 0 in 76). `param-write-enabled-flip-debug-demo.html` **FIXED** (step 2 tail
  2100 ms, step 3 400 ms). `plugin-delay-compensation-debug-demo.html` **lag 0 frames on every
  row** (onset 12000, peak 0.500, score 1.000). MIDI effect placement **every row
  `as-predicted`** at 48 kHz and 44.1 kHz (the note-moving devices on their own rule's frame,
  the pass-through devices at lag 0 / 1.000). Loudness meter **28 of 28 rows at 48 kHz and at
  44.1 kHz** (`loudness-audit-1792691761676.json`, `…1792692465613.json`; every judged metric
  the 0.0.176 value to the hundredth; rows in `debug/2026-10-02-loudness-meter/note.md` under
  "SDK 0.0.177"). Rows and reading in the recording register under "Standing sweep on
  0.0.177". Not run this time (they need the IAC Driver, a quiet room with the built-in
  microphone, or a hand hiding the window): the MIDI input sweeps, the combined MIDI + audio
  sweep, the hidden-page `cover` rows.
- **Verification**: `npm run typecheck` 0 errors, 1241 of 1241 vitest tests, `npm run build`,
  `npm ci` on the regenerated lockfile; the openDAW checkout and the XERJ corpus clone moved
  to `b78d6b0df` (the `@opendaw/studio-sdk@0.0.177` tag; 38 751 records re-indexed).
- API claims verified against the installed tarballs (`node_modules/@opendaw/*/dist`, diffed
  against a copy of the installed 0.0.176 packages taken before the bump):
  `OPENDAW_SDK_VERSION = "0.0.177"`; `lastTakeNumber` on `RecordTrack`; `scriptMessage` on
  `Engine` / `EngineFacade` / `EngineWorklet` / `protocols.d.ts`; `lease()` on
  `HRClockWorker`; `AudioBounce` exported from `studio-core`; `Pointers` 61–64; the four
  script boxes, fields 14 / 15 on the three script device boxes; `omitDefaultUi`, the five
  declaration interfaces and five parsers on `ScriptDeclaration`, `records` / `buffers` /
  `enforce` / `wrapView` / `replace` on `ScriptCompiler`, the six new adapter modules;
  `device_set_record_collection`, the three optional linker exports, `ScriptBridges.message`
  / `afterRender` and the `broadcaster` parameter, `instantiateWasmEngine`'s return type;
  the four changed and 30 byte-identical wasm binaries (hashed against the 0.0.176 copy).
