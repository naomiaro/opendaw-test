/**
 * Task 7c fix round 1 — Ruling A replay.
 *
 * For every persisted matrix-run row that carries per-row geometry AND whose
 * capture WAV is PROVABLY the one that row was measured from, recompute the
 * take alignment under BOTH grids:
 *   OLD: expected beats at regionStartSec + k*P, k = 0 .. floor((D-0.001)/P)
 *   NEW: expected beats at k*P,  k = ceil((S-1e-6)/P) .. floor((S+D-0.001)/P)
 *
 * Provenance rule (never join by filename alone):
 *   - the WAV's frame count must equal round(row.bufferDurationSec * row.rate)
 *   - the WAV's sample rate must equal row.rate
 *   - the WAV's mtime must fall inside [run id ms, summary file mtime ms]
 * Rows failing any check are reported as NOT replayable, with the reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bandSplit } from "../../../src/lib/audit/recordingAlignment.ts";
import { detectOnsets } from "../../../src/lib/audit/onsetDetection.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");

export interface Row {
  scenario: string; bpm: number; rate: number; repeat: number; takeIndex: number;
  medianBeatErrorMs: number | null; medianBeatErrorMsAdjusted: number | null;
  matchedBeats: number; missingBeats: number;
  headMissingRawMs?: number | null; headMissingMs?: number | null;
  bufferDurationSec?: number; regionPositionPpqn?: number; regionDurationSec?: number;
  regionStartSec?: number; waveformOffsetSec?: number;
  status?: string;
}

export function decodeWav(path: string): { sampleRate: number; channel: Float32Array } {
  const buf = readFileSync(path);
  let pos = 12, sampleRate = 0, channels = 1, bits = 16;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") { channels = buf.readUInt16LE(body + 2); sampleRate = buf.readUInt32LE(body + 4); bits = buf.readUInt16LE(body + 14); }
    else if (id === "data") data = buf.subarray(body, body + size);
    pos = body + size + (size % 2);
  }
  if (!data || !sampleRate || bits !== 16) throw new Error("bad wav " + path);
  const frames = data.length / 2 / channels;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = data.readInt16LE(i * 2 * channels) / 32768;
  return { sampleRate, channel: out };
}

export const bpmToken = (b: number) => String(b).replace(".", "p");

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface MatchResult {
  expectedCount: number; matched: number; missing: number;
  unmatchedIndices: number[]; median: number | null; adjusted: number | null;
  matchedIndices: number[];
}

/** Greedy nearest-first match, identical loop to the shipped function. */
export function matchGrid(
  lowOnsets: number[], regionStartSec: number, waveformOffsetSec: number,
  regionDurationSec: number, bpm: number, mode: "old" | "new", biasSec: number,
): MatchResult {
  const P = 60 / bpm;
  const timelineOnsets = lowOnsets.map((t) => regionStartSec + (t - waveformOffsetSec));
  const expected: number[] = [];
  const indices: number[] = [];
  if (mode === "old") {
    const last = Math.floor((regionDurationSec - 0.001) / P);
    for (let k = 0; k <= last; k++) { expected.push(regionStartSec + k * P); indices.push(k); }
  } else {
    const first = Math.ceil((regionStartSec - 1e-6) / P);
    const last = Math.floor((regionStartSec + regionDurationSec - 0.001) / P);
    for (let k = first; k <= last; k++) { expected.push(k * P); indices.push(k); }
  }
  const tol = P / 2;
  const cands: { b: number; o: number; d: number }[] = [];
  for (let k = 0; k < expected.length; k++) {
    for (let o = 0; o < timelineOnsets.length; o++) {
      const d = Math.abs(timelineOnsets[o] - expected[k]);
      if (d <= tol) cands.push({ b: k, o, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const ub = new Set<number>(), uo = new Set<number>();
  const errs: number[] = [];
  const matchedIdx: number[] = [];
  for (const c of cands) {
    if (ub.has(c.b) || uo.has(c.o)) continue;
    ub.add(c.b); uo.add(c.o);
    errs.push((timelineOnsets[c.o] - expected[c.b]) * 1000);
    matchedIdx.push(indices[c.b]);
  }
  const unmatched: number[] = [];
  for (let k = 0; k < expected.length; k++) if (!ub.has(k)) unmatched.push(indices[k]);
  const med = medianOf(errs);
  return {
    expectedCount: expected.length, matched: ub.size, missing: expected.length - ub.size,
    unmatchedIndices: unmatched, median: med, adjusted: med === null ? null : med + biasSec * 1000,
    matchedIndices: matchedIdx.sort((a, b) => a - b),
  };
}

export interface ReplayRow {
  runId: string; summaryFile: string; probe: string;
  row: Row; phiMs: number;
  wav: string | null; notReplayable: string | null;
  old: MatchResult | null; neu: MatchResult | null;
  clickGapsMs: [number, number] | null; clickCount: number | null;
  firstClickMs: number | null; clicksBeforeOffset: number | null;
}

/**
 * Optional snapshot bound. `RECAUDIT_MAX_RUN=<runId>` restricts every population
 * to runs with an id at or below that token, so a number quoted in the register
 * stays reproducible after later runs land in `.verify-output/`.
 */
export const MAX_RUN = process.env.RECAUDIT_MAX_RUN ? Number(process.env.RECAUDIT_MAX_RUN) : Infinity;

export function loadSummaries() {
  return readdirSync(VERIFY_DIR)
    .filter((f) => /^recaudit-summary-\d+\.json$/.test(f))
    .filter((f) => Number(f.replace(/^recaudit-summary-|\.json$/g, "")) <= MAX_RUN)
    .sort()
    .map((f) => ({
      file: f,
      runId: f.replace(/^recaudit-summary-|\.json$/g, ""),
      mtimeMs: statSync(VERIFY_DIR + "/" + f).mtimeMs,
      j: JSON.parse(readFileSync(VERIFY_DIR + "/" + f, "utf8")),
    }));
}

export function replayAll(scenarioFilter?: string): ReplayRow[] {
  const out: ReplayRow[] = [];
  // Which runs recorded each cell, in chronological order. Capture WAV names
  // written before the run-token change are not run-unique, so only the LAST
  // run of a cell still has its audio on disk.
  const cellOwners = new Map<string, number[]>();
  for (const s of loadSummaries()) {
    const probe0 = s.j.sdkBuildProbe ?? "unknown";
    for (const r of (s.j.rows ?? []) as Row[]) {
      const k = `${r.scenario}|${r.bpm}|${r.rate}|${r.repeat}`;
      // A run that wrote a run-unique capture name never competed for the
      // legacy name, so it is not an owner of it.
      // A repeat that errored uploaded no capture at all, so it never owned any
      // capture name and must not displace the run that did.
      if (r.status === "error") continue;
      const uniq = `${VERIFY_DIR}/recaudit-${r.scenario}-${bpmToken(r.bpm)}-${r.rate}-r${r.repeat}-${probe0}-${s.runId}.wav`;
      try { statSync(uniq); continue; } catch { /* legacy-named run */ }
      const list = cellOwners.get(k) ?? [];
      const id = Number(s.runId);
      if (!list.includes(id)) list.push(id);
      cellOwners.set(k, list);
    }
  }
  for (const list of cellOwners.values()) list.sort((a, b) => a - b);
  const wavCache = new Map<string, { sampleRate: number; channel: Float32Array; lowOnsets: number[]; mtimeMs: number }>();
  for (const s of loadSummaries()) {
    const rows: Row[] = s.j.rows ?? [];
    if (rows.length === 0) continue;
    const bias = s.j.harnessPathBiasSec ?? 0;
    const probe = s.j.sdkBuildProbe ?? "unknown";
    const runStartMs = Number(s.runId);
    // Reconstruct each take's presented duration. A single-take scenario's
    // region runs to the end of the buffer; a loop-wrap repeat's takes tile the
    // same buffer, so each take runs to the NEXT take's waveform offset.
    const nextOffset = new Map<Row, number | null>();
    const byRepeat = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.scenario}|${r.bpm}|${r.rate}|${r.repeat}`;
      const list = byRepeat.get(k) ?? [];
      list.push(r); byRepeat.set(k, list);
    }
    for (const list of byRepeat.values()) {
      const sorted = [...list].sort((a, b) => a.takeIndex - b.takeIndex);
      for (let i = 0; i < sorted.length; i++) {
        const nxt = sorted[i + 1];
        nextOffset.set(sorted[i], nxt !== undefined && nxt.waveformOffsetSec !== undefined ? nxt.waveformOffsetSec : null);
      }
    }
    for (const r of rows) {
      if (scenarioFilter && r.scenario !== scenarioFilter) continue;
      if (r.regionStartSec === undefined || r.waveformOffsetSec === undefined) {
        out.push({
          runId: s.runId, summaryFile: s.file, probe, row: r, phiMs: NaN,
          wav: null, notReplayable: "no per-row geometry in summary", old: null, neu: null,
          clickGapsMs: null, clickCount: null, firstClickMs: null, clicksBeforeOffset: null,
        });
        continue;
      }
      const P = 60 / r.bpm;
      const phiRaw = r.regionStartSec - Math.round(r.regionStartSec / P) * P;
      const phiMs = Math.abs(phiRaw) < 1e-9 ? 0 : (r.regionStartSec / P - Math.floor(r.regionStartSec / P)) * P * 1000;
      // Run-unique name first (harness change of this fix round); the legacy
      // name is only usable when this run is still the cell's last owner.
      const uniqueName = `recaudit-${r.scenario}-${bpmToken(r.bpm)}-${r.rate}-r${r.repeat}-${probe}-${s.runId}.wav`;
      const legacyName = `recaudit-${r.scenario}-${bpmToken(r.bpm)}-${r.rate}-r${r.repeat}.wav`;
      let name = uniqueName;
      let runUnique = true;
      try { statSync(VERIFY_DIR + "/" + uniqueName); } catch { name = legacyName; runUnique = false; }
      const path = VERIFY_DIR + "/" + name;
      let st;
      try { st = statSync(path); } catch {
        out.push({ runId: s.runId, summaryFile: s.file, probe, row: r, phiMs, wav: null, notReplayable: "WAV absent", old: null, neu: null, clickGapsMs: null, clickCount: null, firstClickMs: null, clicksBeforeOffset: null });
        continue;
      }
      // provenance: this run must be the LAST run that recorded this cell (every
      // run overwrites the previous run's capture of the same cell, and the
      // summary's own token is written at the end of the run), and the WAV must
      // have been written between the previous such run and this one.
      const cellKey = `${r.scenario}|${r.bpm}|${r.rate}|${r.repeat}`;
      const owners = cellOwners.get(cellKey) ?? [];
      const lastOwner = owners[owners.length - 1];
      const prevOwner = owners.length > 1 ? owners[owners.length - 2] : 0;
      if (!runUnique && lastOwner !== runStartMs) {
        out.push({ runId: s.runId, summaryFile: s.file, probe, row: r, phiMs, wav: null, notReplayable: `WAV overwritten by a later run of the same cell (last owner run ${lastOwner})`, old: null, neu: null, clickGapsMs: null, clickCount: null, firstClickMs: null, clicksBeforeOffset: null });
        continue;
      }
      if (!runUnique && !(st.mtimeMs > prevOwner && st.mtimeMs <= s.mtimeMs + 2000)) {
        out.push({ runId: s.runId, summaryFile: s.file, probe, row: r, phiMs, wav: null, notReplayable: `WAV overwritten (mtime ${new Date(st.mtimeMs).toISOString()} outside run window ${new Date(runStartMs).toISOString()}..${new Date(s.mtimeMs).toISOString()})`, old: null, neu: null, clickGapsMs: null, clickCount: null, firstClickMs: null, clicksBeforeOffset: null });
        continue;
      }
      let dec = wavCache.get(path);
      if (dec === undefined) {
        const d = decodeWav(path);
        const { low } = bandSplit(d.channel, d.sampleRate);
        dec = { ...d, lowOnsets: detectOnsets(low, d.sampleRate, { refractorySec: 0.1 }), mtimeMs: st.mtimeMs };
        wavCache.set(path, dec);
      }
      // provenance: frame count + rate must match the row's own recorded buffer
      const expFrames = r.bufferDurationSec === undefined ? null : Math.round(r.bufferDurationSec * r.rate);
      if (dec.sampleRate !== r.rate || (expFrames !== null && Math.abs(dec.channel.length - expFrames) > 1)) {
        out.push({ runId: s.runId, summaryFile: s.file, probe, row: r, phiMs, wav: null, notReplayable: `WAV/row mismatch (wav ${dec.channel.length}fr @${dec.sampleRate} vs row ${expFrames}fr @${r.rate})`, old: null, neu: null, clickGapsMs: null, clickCount: null, firstClickMs: null, clicksBeforeOffset: null });
        continue;
      }
      const bufferDurationSec = dec.channel.length / dec.sampleRate;
      const nxt = nextOffset.get(r);
      const regionDurationSec = r.regionDurationSec !== undefined
        ? r.regionDurationSec
        : (nxt !== undefined && nxt !== null ? nxt : bufferDurationSec) - r.waveformOffsetSec;
      const old = matchGrid(dec.lowOnsets, r.regionStartSec, r.waveformOffsetSec, regionDurationSec, r.bpm, "old", bias);
      const neu = matchGrid(dec.lowOnsets, r.regionStartSec, r.waveformOffsetSec, regionDurationSec, r.bpm, "new", bias);
      const gaps: number[] = [];
      for (let i = 1; i < dec.lowOnsets.length; i++) gaps.push((dec.lowOnsets[i] - dec.lowOnsets[i - 1]) * 1000);
      out.push({
        runId: s.runId, summaryFile: s.file, probe, row: r, phiMs,
        wav: name, notReplayable: null, old, neu,
        clickGapsMs: gaps.length ? [Math.min(...gaps), Math.max(...gaps)] : null,
        clickCount: dec.lowOnsets.length,
        firstClickMs: dec.lowOnsets.length ? dec.lowOnsets[0] * 1000 : null,
        clicksBeforeOffset: dec.lowOnsets.filter((t) => t < r.waveformOffsetSec!).length,
      });
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("task7c-fix1-replay.ts")) {
  const filter = process.argv[2];
  const rows = replayAll(filter);
  const rep = rows.filter((r) => r.notReplayable === null);
  console.log("total rows considered: " + rows.length + "  replayable: " + rep.length + "  not: " + (rows.length - rep.length));
  // reproduction fidelity against the persisted numbers
  let reproOld = 0, reproNew = 0, checked = 0;
  for (const r of rep) {
    checked++;
    const persistedMed = r.row.medianBeatErrorMs;
    if (persistedMed === null) continue;
    if (r.old!.median !== null && Math.abs(r.old!.median - persistedMed) < 0.05 && r.old!.matched === r.row.matchedBeats && r.old!.missing === r.row.missingBeats) reproOld++;
    if (r.neu!.median !== null && Math.abs(r.neu!.median - persistedMed) < 0.05 && r.neu!.matched === r.row.matchedBeats && r.neu!.missing === r.row.missingBeats) reproNew++;
  }
  console.log("reproduces persisted row under OLD grid: " + reproOld + "/" + checked + "; under NEW grid: " + reproNew + "/" + checked);
  for (const r of rows) {
    const tag = `${r.runId} ${r.probe.padEnd(9)} ${r.row.scenario.padEnd(18)} ${String(r.row.bpm).padStart(5)} ${r.row.rate} r${r.row.repeat} t${r.row.takeIndex}`;
    if (r.notReplayable !== null) { console.log(`SKIP ${tag} phi=${isNaN(r.phiMs) ? "?" : r.phiMs.toFixed(2)} :: ${r.notReplayable}`); continue; }
    console.log(
      `OK   ${tag} phi=${r.phiMs.toFixed(2)}ms` +
      ` | persisted m/miss=${r.row.matchedBeats}/${r.row.missingBeats} med=${r.row.medianBeatErrorMs?.toFixed(2)} adj=${r.row.medianBeatErrorMsAdjusted?.toFixed(2)}` +
      ` | OLD m/miss=${r.old!.matched}/${r.old!.missing} unm=[${r.old!.unmatchedIndices.join(",")}] adj=${r.old!.adjusted?.toFixed(2)}` +
      ` | NEW m/miss=${r.neu!.matched}/${r.neu!.missing} unm=[${r.neu!.unmatchedIndices.join(",")}] adj=${r.neu!.adjusted?.toFixed(2)}` +
      ` | clicks=${r.clickCount} gaps=${r.clickGapsMs?.[0].toFixed(1)}-${r.clickGapsMs?.[1].toFixed(1)} first=${r.firstClickMs?.toFixed(1)} preOff=${r.clicksBeforeOffset}` +
      ` | headRaw=${r.row.headMissingRawMs?.toFixed(2)}`
    );
  }
}
