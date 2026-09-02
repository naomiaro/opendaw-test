/**
 * Task 9 — branch-measured verification of the reworked upstream fix.
 *
 * Before = the two fresh upstream matrix runs (installed 0.0.170, absolute beat
 * grid). After = the two matrix runs on the reworked branch, served through
 * SDK_DIST_OVERRIDE. Every figure the register's "Task 9" section quotes comes
 * from here; nothing is carried over from earlier prose.
 *
 *   node scripts/audit/recording-alignment/task9-branch-verification.ts [cells|hang|hop|mt|probe|integrity|all]
 *
 * Run ids are the defaults below; override with T9_UP48/T9_UP44/T9_BR48/T9_BR44
 * (matrix runs) and T9_MT (multi-mic run on the branch), T9_MT_UP (comma-separated
 * upstream multi-mic runs) if the register ever cites different ones.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCell, type TakeAlignment } from "../../../src/lib/audit/recordingAlignment.ts";
import { SIGNATURE_BANDS } from "../../../src/lib/audit/recordingAuditCalibration.ts";

const VERIFY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.verify-output");
const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const UP = { 48000: env("T9_UP48", "1788310164556"), 44100: env("T9_UP44", "1788310817094") } as const;
const BR = { 48000: env("T9_BR48", "1788328219906"), 44100: env("T9_BR44", "1788328656062") } as const;
const MT_BRANCH = env("T9_MT", "1788325557229");
const MT_UPSTREAM = env("T9_MT_UP", "1788302627819").split(",");

interface Row {
  scenario: string; bpm: number; rate: number; repeat: number; takeIndex: number;
  medianBeatErrorMs: number | null; medianBeatErrorMsAdjusted: number | null;
  matchedBeats: number; missingBeats: number;
  headMissingMs: number | null; headMissingRawMs?: number | null; tailMissingMs?: number | null;
  anchorT0Sec?: number | null; firstQuantumTimeSec?: number; recordRequestContextTime?: number | null;
  regionStartSec?: number; waveformOffsetSec?: number;
  finalizeMs?: number; status?: string; errorMessage?: string; matchedSignature?: string | null; detail?: string;
  bufferDurationSec?: number; stopRequestContextTime?: number | null;
  finalizeNumberOfFramesAtStop?: number; finalizeLimitCalls?: number[]; finalizeNumberOfFramesAtLimit?: number[];
  finalizeOvershootFrames?: number[]; finalizeNumberOfFramesAfter?: number; finalizeLoaderState?: string;
}
const PROBE_RUNS = env("T9_PROBE", "").split(",").filter((x) => x.length > 0);
interface MtRow extends Row { tape: "a" | "b"; medianSkewMs: number | null; maxAbsSkewMs: number | null; pairedSkewBeats: number }

const load = (id: string) => {
  const j = JSON.parse(readFileSync(`${VERIFY_DIR}/recaudit-summary-${id}.json`, "utf8"));
  return { rows: (j.rows ?? []) as Row[], tol: (j.alignedToleranceMs ?? 2) as number, probe: j.sdkBuildProbe as string,
           outputLatency: j.outputLatency as number, rate: j.rate as number };
};
interface CellSkew { scenario: string; bpm: number; repeat: number; skew?: { medianSkewMs: number | null; maxAbsSkewMs: number | null; pairedBeats?: number } }
const loadMt = (id: string) => {
  const j = JSON.parse(readFileSync(`${VERIFY_DIR}/recaudit-mt-summary-${id}.json`, "utf8"));
  return { rows: (j.rows ?? []) as MtRow[], probe: j.sdkBuildProbe as string, rate: j.rate as number, cellSkews: (j.cellSkews ?? []) as CellSkew[] };
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(d));
const SCENARIOS = ["nominal-start", "janked-start", "midtimeline-start", "countin-start", "loop-wrap"];
const BPMS = [120, 97.3];
/** The population classifyCell sees: loop-wrap classifies over wrap takes 1..4 (0-based). */
const cellPop = (rows: Row[], scenario: string, bpm: number) => {
  const list = rows.filter((r) => r.scenario === scenario && r.bpm === bpm && r.medianBeatErrorMsAdjusted !== null);
  return scenario === "loop-wrap" ? list.filter((r) => r.takeIndex >= 1 && r.takeIndex <= 4) : list;
};
/**
 * The harness reads `audioContext.outputLatency` per cell as its path-bias term; Chrome reports 0
 * until output has actually started, so the first cell of a fresh session can be measured with a
 * bias of 0 instead of the run's 0.023 s. Detect it from the row itself (applied bias = adjusted −
 * raw) and report the row re-adjusted with the run's own top-level `outputLatency`.
 */
const appliedBiasMs = (r: Row) => (r.medianBeatErrorMsAdjusted ?? 0) - (r.medianBeatErrorMs ?? 0);
const readjusted = (r: Row, outputLatency: number) => r.medianBeatErrorMs! + outputLatency * 1000;
const biasAnomaly = (r: Row, outputLatency: number) => Math.abs(appliedBiasMs(r) - outputLatency * 1000) > 0.01;
const asAlignment = (r: Row): TakeAlignment => ({
  beatErrors: [], medianBeatErrorMs: r.medianBeatErrorMs, medianBeatErrorMsAdjusted: r.medianBeatErrorMsAdjusted,
  anchorT0Sec: r.anchorT0Sec ?? null, firstRefIndex: null, headMissingMs: r.headMissingMs,
  tailMissingMs: r.tailMissingMs ?? 0, matchedBeats: r.matchedBeats, missingBeats: r.missingBeats, extraLowOnsets: 0,
});

const mode = process.argv[2] ?? "all";

if (mode === "cells" || mode === "all") {
  console.log("## Per-cell means on the absolute grid (medianBeatErrorMsAdjusted, ms; negative = early)\n");
  console.log("| rate | scenario | bpm | upstream mean | upstream n | branch mean | branch n | branch cell status | \\|branch\\| / \\|upstream\\| |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  const anomalies: string[] = [];
  let comparable = 0, smaller = 0, aligned = 0, matches = 0, investigate = 0;
  const allBranch: number[] = [];
  const groups: Record<string, number[]> = {};
  for (const rate of [48000, 44100] as const) {
    const up = load(UP[rate]); const br = load(BR[rate]);
    if (up.probe !== "upstream" || br.probe !== "candidate") throw new Error(`probe mismatch: ${UP[rate]}=${up.probe} ${BR[rate]}=${br.probe}`);
    for (const scenario of SCENARIOS) for (const bpm of BPMS) {
      const u = cellPop(up.rows, scenario, bpm); const b = cellPop(br.rows, scenario, bpm);
      const bMean = b.length ? mean(b.map((r) => r.medianBeatErrorMsAdjusted!)) : NaN;
      for (const r of b) if (biasAnomaly(r, br.outputLatency)) anomalies.push(`${rate}/${scenario}/${bpm}/r${r.repeat}/take${r.takeIndex}: applied bias ${appliedBiasMs(r).toFixed(2)} ms (run outputLatency ${br.outputLatency}); persisted adjusted ${fmt(r.medianBeatErrorMsAdjusted)}, re-adjusted ${fmt(readjusted(r, br.outputLatency))}; cell mean re-adjusted ${fmt(mean(b.map((x) => readjusted(x, br.outputLatency))))}`);
      for (const r of u) if (biasAnomaly(r, up.outputLatency)) anomalies.push(`UPSTREAM ${rate}/${scenario}/${bpm}/r${r.repeat}/take${r.takeIndex}: applied bias ${appliedBiasMs(r).toFixed(2)} ms`);
      const uMean = u.length ? mean(u.map((r) => r.medianBeatErrorMsAdjusted!)) : NaN;
      const cls = b.length ? classifyCell(b.map(asAlignment), (SIGNATURE_BANDS as Record<string, any>)[scenario] ?? [], br.tol) : null;
      if (cls?.status === "aligned") aligned++; else if (cls?.status === "matches-known-defect") matches++; else if (cls) investigate++;
      if (b.length) { allBranch.push(bMean); (groups[scenario] ??= []).push(bMean); }
      let delta = "—";
      if (u.length && b.length) { comparable++; if (Math.abs(bMean) < Math.abs(uMean)) smaller++; delta = `${(Math.abs(bMean) / Math.abs(uMean) * 100).toFixed(0)} % of upstream`; }
      console.log(`| ${rate} | ${scenario} | ${bpm} | ${fmt(uMean)} | ${u.length} | ${fmt(bMean)} | ${b.length} | ${cls ? cls.status + (cls.matchedSignature ? " (" + cls.matchedSignature + ")" : "") : "—"} | ${delta} |`);
    }
  }
  console.log(anomalies.length ? `\nharness-bias anomalies (first-cell outputLatency read as 0):\n  ${anomalies.join("\n  ")}` : "\nno harness-bias anomalies");
  console.log(`\ncomparable cells: ${comparable}; branch |mean| smaller: ${smaller}; branch statuses: aligned ${aligned}, matches-known-defect ${matches}, investigate ${investigate}`);
  console.log(`branch per-cell mean range: ${fmt(Math.min(...allBranch))} … ${fmt(Math.max(...allBranch))} ms over ${allBranch.length} cells`);
  for (const [s, xs] of Object.entries(groups)) console.log(`  ${s}: ${fmt(Math.min(...xs))} … ${fmt(Math.max(...xs))} ms (${xs.length} cells)`);
  console.log("\n### Loop-wrap flatness (max within-repeat spread across takes 1–4, branch)");
  for (const rate of [48000, 44100] as const) {
    const br = load(BR[rate]);
    for (const bpm of BPMS) for (const repeat of [1, 2, 3]) {
      const takes = br.rows.filter((r) => r.scenario === "loop-wrap" && r.bpm === bpm && r.repeat === repeat && r.takeIndex >= 1 && r.takeIndex <= 4 && r.medianBeatErrorMsAdjusted !== null);
      if (takes.length < 2) continue;
      const xs = takes.map((r) => r.medianBeatErrorMsAdjusted!);
      const take0 = br.rows.find((r) => r.scenario === "loop-wrap" && r.bpm === bpm && r.repeat === repeat && r.takeIndex === 0);
      console.log(`  ${rate}/${bpm}/r${repeat}: takes 1–4 spread ${(Math.max(...xs) - Math.min(...xs)).toFixed(3)} ms; take 0 ${fmt(take0?.medianBeatErrorMsAdjusted)} vs takes 1–4 mean ${fmt(mean(xs))}`);
    }
  }
}

if (mode === "hang" || mode === "all") {
  console.log("\n## Loop-wrap finalization (per repeat: finalized / timed out)\n");
  for (const [label, ids] of [["upstream", UP], ["branch", BR]] as const) {
    let failed = 0, total = 0; const ms: number[] = [];
    for (const rate of [48000, 44100] as const) {
      const rows = load(ids[rate]).rows.filter((r) => r.scenario === "loop-wrap");
      for (const bpm of BPMS) for (const repeat of [1, 2, 3]) {
        const rr = rows.filter((r) => r.bpm === bpm && r.repeat === repeat);
        total++;
        const err = rr.find((r) => r.status === "error");
        if (err) { failed++; console.log(`  ${label} ${rate}/${bpm}/r${repeat}: FAILED — ${err.errorMessage}`); }
        else { const f = rr[0]?.finalizeMs; if (f !== undefined) ms.push(f); console.log(`  ${label} ${rate}/${bpm}/r${repeat}: finalized in ${fmt(f, 0)} ms (${rr.length} take rows)`); }
      }
    }
    console.log(`  => ${label}: ${failed} of ${total} repeats failed to finalize; successes ${ms.length ? fmt(Math.min(...ms), 0) + "–" + fmt(Math.max(...ms), 0) + " ms" : "—"}\n`);
  }
  console.log("Branch, all scenarios: rows with status=error");
  for (const rate of [48000, 44100] as const) {
    const rows = load(BR[rate]).rows;
    const errs = rows.filter((r) => r.status === "error");
    console.log(`  ${rate}: ${errs.length} error rows of ${rows.length}${errs.length ? " — " + errs.map((r) => `${r.scenario}/${r.bpm}/r${r.repeat}: ${r.errorMessage}`).join("; ") : ""}`);
  }
}

if (mode === "hop" || mode === "all") {
  console.log("\n## Loopback-hop decomposition on the branch (single-take scenarios, take 0)\n");
  console.log("hop = firstQuantumTimeSec − anchorT0Sec: how much later a signal scheduled on the context reaches the");
  console.log("recording processor through MediaStreamAudioDestinationNode → getUserMedia → MediaStreamAudioSourceNode.");
  console.log("residual = medianBeatErrorMsAdjusted − hop: what is left once the harness path's own delay is netted out.\n");
  console.log("| rate | scenario | bpm | r | adjusted (ms) | hop (ms) | residual (ms) | first frame − request (ms) | headMissingRaw (ms) |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  const residuals: number[] = []; const hops: number[] = [];
  for (const rate of [48000, 44100] as const) {
    const run = load(BR[rate]);
    const rows = run.rows.filter((r) => r.takeIndex === 0 && r.medianBeatErrorMsAdjusted !== null && r.firstQuantumTimeSec !== undefined && r.anchorT0Sec != null);
    for (const r of rows) {
      const hop = (r.firstQuantumTimeSec! - r.anchorT0Sec!) * 1000;
      const adjusted = biasAnomaly(r, run.outputLatency) ? readjusted(r, run.outputLatency) : r.medianBeatErrorMsAdjusted!;
      const res = adjusted - hop;
      const gap = r.recordRequestContextTime != null ? (r.firstQuantumTimeSec! - r.recordRequestContextTime) * 1000 : NaN;
      hops.push(hop); if (r.scenario !== "loop-wrap") residuals.push(res);
      console.log(`| ${rate} | ${r.scenario} | ${r.bpm} | ${r.repeat} | ${fmt(adjusted)}${biasAnomaly(r, run.outputLatency) ? " (re-adjusted)" : ""} | ${fmt(hop)} | ${fmt(res)} | ${fmt(gap)} | ${fmt(r.headMissingRawMs)} |`);
    }
  }
  console.log(`\nhop range ${fmt(Math.min(...hops))} … ${fmt(Math.max(...hops))} ms over ${hops.length} rows; residual (non-loop-wrap) ${fmt(Math.min(...residuals))} … ${fmt(Math.max(...residuals))} ms, mean ${fmt(mean(residuals))} over ${residuals.length} rows`);
  console.log("\nUpstream rows carry no firstQuantumTimeSec (the installed build has no such member), so no hop can be recovered there.");
}

if (mode === "mt" || mode === "all") {
  console.log("\n## Multi-mic (two simultaneously armed captures), 48000 Hz / 120 bpm\n");
  for (const [label, id] of [["branch", MT_BRANCH], ...MT_UPSTREAM.map((x) => ["upstream", x] as const)] as const) {
    const run = loadMt(id);
    console.log(`${label} run ${id} (probe ${run.probe}, ${run.rate} Hz):`);
    const errRepeats = new Set(run.rows.filter((r) => r.status === "error").map((r) => `${r.scenario}/${r.bpm}/r${r.repeat}`));
    const repeats = new Set(run.rows.map((r) => `${r.scenario}/${r.bpm}/r${r.repeat}`));
    for (const key of repeats) {
      const err = run.rows.find((r) => r.status === "error" && `${r.scenario}/${r.bpm}/r${r.repeat}` === key);
      const cs = run.cellSkews.find((c) => `${c.scenario}/${c.bpm}/r${c.repeat}` === key);
      const a = run.rows.find((r) => r.tape === "a" && `${r.scenario}/${r.bpm}/r${r.repeat}` === key);
      const b = run.rows.find((r) => r.tape === "b" && `${r.scenario}/${r.bpm}/r${r.repeat}` === key);
      console.log(`  ${key}: ${err ? "ERROR — " + err.errorMessage : `skew median ${fmt(cs?.skew?.medianSkewMs, 3)} ms, max|skew| ${fmt(cs?.skew?.maxAbsSkewMs, 3)}; tape a ${fmt(a?.medianBeatErrorMsAdjusted)} / tape b ${fmt(b?.medianBeatErrorMsAdjusted)} adjusted`}`);
    }
    const skews = run.cellSkews.map((c) => c.skew?.medianSkewMs).filter((x): x is number => typeof x === "number");
    console.log(`  => ${errRepeats.size} of ${repeats.size} repeats errored; ${skews.length} skew values: ${skews.map((x) => x.toFixed(3)).join(", ")}; outside 2 ms: ${skews.filter((x) => Math.abs(x) > 2).length}\n`);
  }
}

if (mode === "probe" || mode === "all") {
  console.log("\n## Finalization probe (per repeat, take 0 row): limit() calls, numberOfFrames, overshoot, loader state\n");
  const ids = PROBE_RUNS.length ? PROBE_RUNS : [UP[48000], UP[44100], BR[48000], BR[44100]];
  for (const id of ids) {
    const run = load(id);
    const rows = run.rows.filter((r) => r.takeIndex === 0 && r.finalizeLoaderState !== undefined);
    if (rows.length === 0) { console.log(`run ${id} (probe ${run.probe}): no finalization probe fields persisted`); continue; }
    console.log(`run ${id} (probe ${run.probe}, ${run.rate} Hz): ${rows.length} repeats with probe fields`);
    console.log("| scenario | bpm | r | frames at stop | limit() calls | frames at limit | overshoot | frames after | loader state | outcome |");
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(`| ${r.scenario} | ${r.bpm} | ${r.repeat} | ${r.finalizeNumberOfFramesAtStop} | ${r.finalizeLimitCalls?.join(", ") || "none"} | ${r.finalizeNumberOfFramesAtLimit?.join(", ") || "—"} | ${r.finalizeOvershootFrames?.join(", ") || "—"} | ${r.finalizeNumberOfFramesAfter} | ${r.finalizeLoaderState} | ${r.status === "error" ? "ERROR: " + r.errorMessage : "finalized " + fmt(r.finalizeMs, 0) + " ms"} |`);
    }
    const hung = rows.filter((r) => r.finalizeLoaderState !== "loaded");
    const noCall = hung.filter((r) => (r.finalizeLimitCalls?.length ?? 0) === 0);
    const ov = rows.flatMap((r) => r.finalizeOvershootFrames ?? []);
    console.log(`  => not finalized: ${hung.length} of ${rows.length}; of those with NO limit() call: ${noCall.length}; overshoot frames over ${ov.length} calls: ${ov.length ? Math.min(...ov) + " … " + Math.max(...ov) : "—"}\n`);
  }
}

if (mode === "integrity" || mode === "all") {
  console.log("\n## Head/tail integrity (spec §3.7 (d)) and classifier detail reasons\n");
  for (const [label, ids] of [["upstream", UP], ["branch", BR]] as const) {
    for (const rate of [48000, 44100] as const) {
      const run = load(ids[rate]);
      const rows = run.rows.filter((r) => r.medianBeatErrorMs !== null);
      const tails = rows.map((r) => r.tailMissingMs ?? 0);
      const heads = rows.map((r) => r.headMissingMs ?? 0);
      const trueTail = rows.filter((r) => r.takeIndex === 0 && r.firstQuantumTimeSec !== undefined && r.bufferDurationSec !== undefined && r.stopRequestContextTime != null)
        .map((r) => (r.firstQuantumTimeSec! + r.bufferDurationSec! - r.stopRequestContextTime!) * 1000);
      console.log(`${label} ${rate} (${ids[rate]}): rows ${rows.length}; tailMissingMs > 2: ${tails.filter((t) => t > 2).length}, max ${fmt(Math.max(...tails))}, mean ${fmt(mean(tails))}; headMissingMs > 2: ${heads.filter((h) => h > 2).length}, max ${fmt(Math.max(...heads))}${trueTail.length ? `; true-clock file end − stop request (take 0): ${fmt(Math.min(...trueTail))} … ${fmt(Math.max(...trueTail))} ms, ${trueTail.filter((t) => t < 0).length} of ${trueTail.length} end before the request` : ""}`);
    }
  }
  console.log("\nBranch cell verdicts with the classifier's own detail:");
  for (const rate of [48000, 44100] as const) {
    const br = load(BR[rate]);
    for (const scenario of SCENARIOS) for (const bpm of BPMS) {
      const b = cellPop(br.rows, scenario, bpm);
      if (!b.length) continue;
      const cls = classifyCell(b.map(asAlignment), (SIGNATURE_BANDS as Record<string, any>)[scenario] ?? [], br.tol);
      console.log(`  ${rate}/${scenario}/${bpm}: ${cls.status}${cls.matchedSignature ? " (" + cls.matchedSignature + ")" : ""} — ${cls.detail}`);
    }
  }
}
