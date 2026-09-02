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
import { classifyCell } from "../../../src/lib/audit/recordingAlignment.ts";
import { RECORDING_AUDIT_BPMS, RECORDING_AUDIT_SCENARIOS, signatureBandsFor } from "../../../src/lib/audit/recordingAuditCalibration.ts";
import { appliedHarnessPathBiasMs, type AuditRow, type LoadedAuditSummary } from "../../../src/lib/audit/recordingAuditArtifacts.ts";
import { asClassifiable, cellPopulation, loadMultitrackSummary, loadSummary, mean, withMedian } from "./artifacts.ts";

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const UP = { 48000: env("T9_UP48", "1788310164556"), 44100: env("T9_UP44", "1788310817094") } as const;
const BR = { 48000: env("T9_BR48", "1788328219906"), 44100: env("T9_BR44", "1788328656062") } as const;
const MT_BRANCH = env("T9_MT", "1788325557229");
const MT_UPSTREAM = env("T9_MT_UP", "1788302627819").split(",");
const PROBE_RUNS = env("T9_PROBE", "").split(",").filter((x) => x.length > 0);

/** Every run this script compares was made after outputLatency persistence; a
 *  null here means a wrong run id, not a legacy generation. */
const load = (id: string): LoadedAuditSummary & { outputLatency: number } => {
  const s = loadSummary(id);
  if (s.outputLatencySec === null) throw new Error(`run ${id} (${s.generation}) persists no outputLatency; this script needs a G3+ run`);
  return { ...s, outputLatency: s.outputLatencySec };
};
const fmt = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(d));
const SCENARIOS = RECORDING_AUDIT_SCENARIOS;
const BPMS = RECORDING_AUDIT_BPMS;
/**
 * Before the harness read `audioContext.outputLatency` once after output started,
 * Chrome's initial 0 could reach the first repeat of a fresh session as its
 * path-bias term, so that row was adjusted with 0 instead of the run's 0.023 s.
 * Detect it from the row itself (applied bias = adjusted − raw, see
 * `appliedHarnessPathBiasMs`) and report the row re-adjusted with the run's own
 * top-level `outputLatency`. The harness now persists the applied bias per row
 * and reads it once, so this is a guard on future runs, not a workaround.
 */
const readjusted = (r: AuditRow, outputLatency: number) => r.medianBeatErrorMs! + outputLatency * 1000;
const biasAnomaly = (r: AuditRow, outputLatency: number) => {
  const applied = appliedHarnessPathBiasMs(r);
  return applied !== null && Math.abs(applied - outputLatency * 1000) > 0.01;
};

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
    if (up.sdkBuildProbe !== "upstream" || br.sdkBuildProbe !== "candidate") throw new Error(`probe mismatch: ${UP[rate]}=${up.sdkBuildProbe} ${BR[rate]}=${br.sdkBuildProbe}`);
    if (up.beatGrid !== "absolute" || br.beatGrid !== "absolute") throw new Error(`grid mismatch: ${UP[rate]}=${up.beatGrid} ${BR[rate]}=${br.beatGrid}; both must be absolute`);
    for (const scenario of SCENARIOS) for (const bpm of BPMS) {
      // Classification sees every non-error repeat (a null-median repeat forces
      // `investigate`, as live); means are over the repeats with a median.
      const uPop = cellPopulation(up.rows, scenario, bpm); const bPop = cellPopulation(br.rows, scenario, bpm);
      const u = withMedian(uPop); const b = withMedian(bPop);
      const bMean = b.length ? mean(b.map((r) => r.medianBeatErrorMsAdjusted)) : NaN;
      for (const r of b) if (biasAnomaly(r, br.outputLatency)) anomalies.push(`${rate}/${scenario}/${bpm}/r${r.repeat}/take${r.takeIndex}: applied bias ${fmt(appliedHarnessPathBiasMs(r))} ms (run outputLatency ${br.outputLatency}); persisted adjusted ${fmt(r.medianBeatErrorMsAdjusted)}, re-adjusted ${fmt(readjusted(r, br.outputLatency))}; cell mean re-adjusted ${fmt(mean(b.map((x) => readjusted(x, br.outputLatency))))}`);
      for (const r of u) if (biasAnomaly(r, up.outputLatency)) anomalies.push(`UPSTREAM ${rate}/${scenario}/${bpm}/r${r.repeat}/take${r.takeIndex}: applied bias ${fmt(appliedHarnessPathBiasMs(r))} ms`);
      const uMean = u.length ? mean(u.map((r) => r.medianBeatErrorMsAdjusted)) : NaN;
      const cls = bPop.length ? classifyCell(bPop.map((r) => asClassifiable(r)), signatureBandsFor(scenario), br.alignedToleranceMs) : null;
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
      const takes = withMedian(br.rows.filter((r) => r.scenario === "loop-wrap" && r.bpm === bpm && r.repeat === repeat && r.takeIndex >= 1 && r.takeIndex <= 4));
      if (takes.length < 2) continue;
      const xs = takes.map((r) => r.medianBeatErrorMsAdjusted);
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
    const rows = withMedian(run.rows.filter((r) => r.takeIndex === 0 && r.status !== "error" && r.firstQuantumTimeSec !== undefined && r.anchorT0Sec != null));
    for (const r of rows) {
      const hop = (r.firstQuantumTimeSec! - r.anchorT0Sec!) * 1000;
      const adjusted = biasAnomaly(r, run.outputLatency) ? readjusted(r, run.outputLatency) : r.medianBeatErrorMsAdjusted;
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
    const run = loadMultitrackSummary(id);
    console.log(`${label} run ${id} (probe ${run.sdkBuildProbe}, ${run.rate} Hz, per-tape medians on the ${run.beatGrid} grid):`);
    const errRepeats = new Set(run.rows.filter((r) => r.status === "error").map((r) => `${r.scenario}/${r.bpm}/r${r.repeat}`));
    const repeats = new Set(run.rows.map((r) => `${r.scenario}/${r.bpm}/r${r.repeat}`));
    for (const key of repeats) {
      const err = run.rows.find((r) => r.status === "error" && `${r.scenario}/${r.bpm}/r${r.repeat}` === key);
      const cs = run.cellSkews.find((c) => `${c.scenario}/${c.bpm}/r${c.repeat}` === key);
      const a = run.rows.find((r) => r.tape === "a" && `${r.scenario}/${r.bpm}/r${r.repeat}` === key);
      const b = run.rows.find((r) => r.tape === "b" && `${r.scenario}/${r.bpm}/r${r.repeat}` === key);
      console.log(`  ${key}: ${err ? "ERROR — " + err.errorMessage : `skew median ${fmt(cs?.skew.medianSkewMs, 3)} ms, max|skew| ${fmt(cs?.skew.maxAbsSkewMs, 3)}; tape a ${fmt(a?.medianBeatErrorMsAdjusted)} / tape b ${fmt(b?.medianBeatErrorMsAdjusted)} adjusted`}`);
    }
    const skews = run.cellSkews.map((c) => c.skew.medianSkewMs).filter((x): x is number => typeof x === "number");
    console.log(`  => ${errRepeats.size} of ${repeats.size} repeats errored; ${skews.length} skew values: ${skews.map((x) => x.toFixed(3)).join(", ")}; outside 2 ms: ${skews.filter((x) => Math.abs(x) > 2).length}\n`);
  }
}

if (mode === "probe" || mode === "all") {
  console.log("\n## Finalization probe (per repeat, take 0 row): limit() calls, numberOfFrames, overshoot, loader state\n");
  const ids = PROBE_RUNS.length ? PROBE_RUNS : [UP[48000], UP[44100], BR[48000], BR[44100]];
  for (const id of ids) {
    const run = load(id);
    const rows = run.rows.filter((r) => r.takeIndex === 0 && r.finalizeLoaderState !== undefined);
    if (rows.length === 0) { console.log(`run ${id} (probe ${run.sdkBuildProbe}): no finalization probe fields persisted`); continue; }
    console.log(`run ${id} (probe ${run.sdkBuildProbe}, ${run.rate} Hz): ${rows.length} repeats with probe fields`);
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
      // Both runs persist tailMissingMs/headMissingMs per row; a null on a row
      // means "not anchored", which the classifier now reports as unmeasured —
      // it is counted separately here, never as a 0.
      const tails = rows.map((r) => r.tailMissingMs).filter((t): t is number => typeof t === "number");
      const heads = rows.map((r) => r.headMissingMs).filter((h): h is number => typeof h === "number");
      const unanchored = rows.length - heads.length;
      const trueTail = rows.filter((r) => r.takeIndex === 0 && r.firstQuantumTimeSec !== undefined && r.bufferDurationSec !== undefined && r.stopRequestContextTime != null)
        .map((r) => (r.firstQuantumTimeSec! + r.bufferDurationSec! - r.stopRequestContextTime!) * 1000);
      console.log(`${label} ${rate} (${ids[rate]}): rows ${rows.length}; tailMissingMs > 2: ${tails.filter((t) => t > 2).length}, max ${fmt(Math.max(...tails))}, mean ${fmt(mean(tails))}; headMissingMs > 2: ${heads.filter((h) => h > 2).length}, max ${fmt(Math.max(...heads))}; unanchored rows (null head): ${unanchored}${trueTail.length ? `; true-clock file end − stop request (take 0): ${fmt(Math.min(...trueTail))} … ${fmt(Math.max(...trueTail))} ms, ${trueTail.filter((t) => t < 0).length} of ${trueTail.length} end before the request` : ""}`);
    }
  }
  console.log("\nBranch cell verdicts with the classifier's own detail:");
  for (const rate of [48000, 44100] as const) {
    const br = load(BR[rate]);
    for (const scenario of SCENARIOS) for (const bpm of BPMS) {
      const b = cellPopulation(br.rows, scenario, bpm);
      if (!b.length) continue;
      const cls = classifyCell(b.map((r) => asClassifiable(r)), signatureBandsFor(scenario), br.alignedToleranceMs);
      console.log(`  ${rate}/${scenario}/${bpm}: ${cls.status}${cls.matchedSignature ? " (" + cls.matchedSignature + ")" : ""} — ${cls.detail}`);
    }
  }
}
