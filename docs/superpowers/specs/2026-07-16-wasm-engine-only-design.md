# WASM-Engine-Only Demos — Design

**Date:** 2026-07-16
**Status:** Approved approach C — remove all TypeScript-engine paths from this repo.

## Goal

Every demo (live playback and offline rendering) runs exclusively on the WASM (Rust)
engine. The TypeScript engine is being removed upstream (openDAW#315 closing comment);
this repo stops depending on it now. If the WASM engine cannot boot, initialization
fails loudly (existing init error cards) — there is no TS fallback and no
`?engine=` escape hatch.

## Decisions (from brainstorming)

- **Hard requirement:** WASM must boot or `initializeOpenDAW` throws. No fallback.
- **No `?engine=` param:** neither `wasm` (now the only engine) nor `ts` (removed).
- **wasm-engine-demo is repurposed**, not deleted: the live TS↔WASM swap is gone, the
  page becomes a WASM engine status/diagnostics demo (boot status, DSP-load reporting,
  pattern playback). Same URL/HTML entry.
- **Debug/repro pages** (`pure-webaudio-target`, `shared-source-double-process`,
  `wasm-ensure-ready-second-context`) boot WASM unconditionally; per-page engine
  wiring and engine badges that offer a choice are simplified to state the fact.

## Changes

### 1. `src/lib/projectSetup.ts` — central engine boot
In `initializeOpenDAW()`, before `project.startAudioWorklet()`:
1. `installWasmEngine()` — which now also force-enables via
   `WasmEngine.setEnabled(true)`: the `opendaw-wasm-engine` localStorage flag is an
   opt-out persisted by the old swap demo; a stale `false` would silently make
   `EngineVariant.current()` return null and boot the TS engine.
2. `const ready = await ensureWasmReady(audioContext)`; if `!ready`, throw a
   descriptive error ("WASM engine artifacts failed to load/compile…").

Remove the `onBeforeEngineStart` option entirely (its only purpose was per-demo
engine installs). Update all call sites.

### 2. `src/lib/wasmEngine.ts` — shrink to WASM-only surface
- **Remove:** `switchEngine`, `EngineStatus`, `describeEngineStatus`,
  `wasmRequestedByUrl`, `setWasmEnabled` / `isWasmEnabled` as public exports,
  `withTimeout` + `REBOOT_TIMEOUT_MS` (only used by `switchEngine`).
- **Keep:** `installWasmEngine` (also force-enables), `ensureWasmReady`,
  `isWasmReady`, `isWasmInstalled`.
- Update `src/lib/wasmEngine.test.ts` for the removed exports.

### 3. `src/lib/offlineScan.ts` — single render path
Delete the TS `OfflineAudioContext` + `createEngine` fallback branch. The WASM
`OfflineEngineRenderer` (`variant: true`) path is the only path; replace the
`isWasmInstalled() && isWasmEnabled() && isWasmReady()` gate with a throw-if-not-ready
guard (engine is always installed/enabled/ready after `initializeOpenDAW`).

### 4. `src/lib/rangeExport.ts` + export demo
Remove the conditional `if (metronomeAudible) installWasmEngine()` lines (install is
central now). Pass `variant: true` explicitly on `OfflineEngineRenderer.create` calls
so exports are WASM by construction, not by policy inference.

### 5. Demos
- **`wasm-engine-demo.tsx`:** strip the TS/WASM toggle and `switchEngine` usage;
  keep pattern playback, boot/status readout, DSP-load reporting. Prose: the TS
  engine has been removed from these demos (deprecated upstream).
- **3 debug pages:** remove `wasmRequestedByUrl()` / `onBeforeEngineStart` wiring
  and the "load with `?engine=wasm`" prose; engine badge states WASM. Historical
  per-engine measurements in the page prose stay as history where relevant.

### 6. Documentation
Present-tense updates (no version pins in `documentation/*.md`):
- `src/demos/engine/CLAUDE.md` — engine selection is unconditional; drop swap/
  `onBeforeEngineStart` guidance; keep the second-context pitfall note.
- Root `CLAUDE.md` — engine-related bullets (`?engine=wasm` repro pages, per-engine
  feature verification guidance) updated to the WASM-only reality.
- `documentation/19-wasm-engine.md`, `10-export.md`, `20-apparat.md`,
  `documentation/CLAUDE.md`, `src/demos/export/CLAUDE.md`,
  `src/demos/playback/CLAUDE.md` — same sweep.
- `debug/*.md` are historical investigation records: only update statements about
  how the repro pages boot today; keep measured per-engine history intact.

## Risks

- **Live WASM transport quirk:** at 0.0.159 the debug pages observed `position`
  taking 20–30 s to start advancing after `play()` while `isPlaying` flips true
  immediately. All live demos now run WASM, so this would become user-visible.
  Verification below explicitly watches for it on 0.0.160; if it reproduces, report
  before merge (and likely file upstream).
- **Recording / MIDI demos have never run on WASM** in this repo — capture worklet
  interplay is unverified. Covered by browser verification.
- **Offline render output will differ numerically** from previous TS renders
  (different engine). Expected; audio-verify assertions are numeric beat-alignment
  checks, not golden hashes, and should still pass.

## Out of scope

- Removing the TS engine from the SDK itself (upstream work).
- Deleting the debug investigation notes or their historical measurements.

## Verification

1. `npx tsc --noEmit --ignoreDeprecations "6.0"` — zero new errors vs main
   (baseline-diff, `^src/` filter).
2. `npm run build` clean; `npm test` (vitest) green including updated
   `wasmEngine.test.ts`.
3. Browser (real clicks, measure output RMS, not UI state): playback demo,
   one recording demo, MIDI demo, repurposed wasm-engine-demo, one debug page.
4. **Full audio analysis across features** — since every feature now renders on the
   WASM engine for the first time, verify actual audio per feature area, not just
   boot success:
   - `audio-verify` skill: offline-render the warp demo scenarios, assert beat
     alignment numerically.
   - Offline renders (rangeExport / export demo, incl. metronome via
     `ExportConfiguration.metronome`) analyzed with the audio-analyzer MCP
     (RMS/peaks, spectral sanity, silence detection).
   - Re-run the debug-page measured signatures on WASM: touching-seam ratio
     (#311 — expect 1.00), voice-fade × clip-fade product (#312 — expect ≈0 dB dip),
     shared-source double-process peak, fades/crossfade envelopes.
   - MIDI synth (Vaporisateur) and playback demos: output RMS + rough spectral
     check (non-silent, no clipping).
5. **Regressions → upstream issues:** any behavior that regressed vs the recorded
   TS-engine or 0.0.159-WASM measurements gets a GitHub issue on
   `andremichelle/openDAW` (live repro page URL + `debug/*.md` write-up + measured
   signature + suggested fix, per repo convention), cross-linked back into the
   repro page's DebugLinkBar and the debug note header. Known candidate to check:
   the live-transport position-start delay quirk.
