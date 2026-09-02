/**
 * Task 7c fix round 1 — the numbers that go into the register.
 *
 *   enum        replay population census (snapshot-bounded)
 *   census      off-grid census over every persisted row that carries geometry
 *   gate        replay fidelity: does my re-match reproduce the persisted row?
 *   regress     the four regression runs, BOTH grids on the SAME WAVs
 *   correct     candidate/upstream matrix cell means, old grid and absolute grid
 *   fencepost   the old grid's missing-beat fencepost vs "no click before the region start"
 *   missingrows every persisted row with missingBeats > 0, with its geometry
 *   ppqn        take-0 regionPositionPpqn distribution by build
 *
 * `RECAUDIT_MAX_RUN=<runToken>` bounds the snapshot (see artifacts.ts).
 */
import { replayAll } from "./task7c-fix1-replay.ts";
import { MAX_RUN, loadSummaries, mean, phiMs } from "./artifacts.ts";

const mode = process.argv[2] ?? "census";

function fmt(x: number | null | undefined, d = 2): string {
  return x === null || x === undefined ? "—" : x.toFixed(d);
}

if (mode === "census") {
  // Every persisted row with geometry, grouped by scenario.
  const byScenario = new Map<string, { rows: number; off: number; maxPhi: number; phis: number[]; runs: Set<string> }>();
  for (const s of loadSummaries()) {
    for (const r of s.summary.rows) {
      if (r.regionStartSec === undefined) continue;
      const e = byScenario.get(r.scenario) ?? { rows: 0, off: 0, maxPhi: 0, phis: [], runs: new Set<string>() };
      const phi = phiMs(r);
      e.rows++;
      e.runs.add(s.runId);
      if (phi > 1e-3) { e.off++; e.phis.push(phi); e.maxPhi = Math.max(e.maxPhi, phi); }
      byScenario.set(r.scenario, e);
    }
  }
  console.log("| scenario | rows with geometry | off-grid (phi > 1 us) | max phi (ms) | runs |");
  let totRows = 0, totOff = 0, nonMidOff = 0, nonMidRows = 0;
  for (const [k, e] of [...byScenario.entries()].sort()) {
    console.log(`| ${k} | ${e.rows} | ${e.off} | ${e.maxPhi.toFixed(2)} | ${e.runs.size} |`);
    totRows += e.rows; totOff += e.off;
    if (k !== "midtimeline-start") { nonMidOff += e.off; nonMidRows += e.rows; }
  }
  console.log(`| TOTAL | ${totRows} | ${totOff} | | |`);
  console.log(`non-midtimeline: ${nonMidOff} off-grid of ${nonMidRows} rows`);
  // Same census split by build probe, and the headMissingRawMs distribution —
  // both quoted in the register next to the table above.
  const byProbe = new Map<string, { n: number; off: number; max: number; loopT5: number }>();
  const head = new Map<string, number[]>();
  for (const s2 of loadSummaries()) {
    const probe = s2.summary.sdkBuildProbe;
    for (const r of s2.summary.rows) {
      if (typeof r.headMissingRawMs === "number") {
        const l = head.get(r.scenario) ?? []; l.push(r.headMissingRawMs); head.set(r.scenario, l);
      }
      if (r.regionStartSec === undefined || r.scenario === "midtimeline-start") continue;
      const k = probe + " non-midtimeline";
      const e = byProbe.get(k) ?? { n: 0, off: 0, max: 0, loopT5: 0 };
      e.n++;
      const phi = phiMs(r);
      if (phi > 1e-3) { e.off++; e.max = Math.max(e.max, phi); if (r.scenario === "loop-wrap" && r.takeIndex === 5) e.loopT5++; }
      byProbe.set(k, e);
    }
  }
  console.log("\n-- off-grid split by build probe (non-midtimeline rows) --");
  for (const [k, e] of [...byProbe.entries()].sort()) {
    console.log(`${k}: ${e.off} off-grid of ${e.n}, max phi ${e.max.toFixed(2)}ms, of which loop-wrap take 5: ${e.loopT5}`);
  }
  console.log("\n-- headMissingRawMs distribution (every persisted row carrying the field) --");
  for (const [k, a] of [...head.entries()].sort()) {
    const v = [...a].sort((x, y) => x - y);
    const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    console.log(`${k.padEnd(18)} n=${v.length} min=${v[0].toFixed(2)} median=${med.toFixed(2)} max=${v[v.length - 1].toFixed(2)}`);
  }
  // the discriminator: is a captured click within P/2 of old grid point 0?
  console.log("\n-- clicks captured before the region start (old grid point 0's only possible match) --");
  const rep = replayAll().filter((r) => r.notReplayable === null);
  const byS = new Map<string, { n: number; withPre: number; firstMin: number; firstMax: number; phiMin: number; phiMax: number }>();
  for (const r of rep) {
    if (r.row.takeIndex !== 0) continue;
    const e = byS.get(r.row.scenario) ?? { n: 0, withPre: 0, firstMin: Infinity, firstMax: -Infinity, phiMin: Infinity, phiMax: -Infinity };
    e.n++;
    if ((r.clicksBeforeOffset ?? 0) > 0) e.withPre++;
    e.firstMin = Math.min(e.firstMin, r.firstClickMs ?? Infinity);
    e.firstMax = Math.max(e.firstMax, r.firstClickMs ?? -Infinity);
    e.phiMin = Math.min(e.phiMin, r.phiMs); e.phiMax = Math.max(e.phiMax, r.phiMs);
    byS.set(r.row.scenario, e);
  }
  for (const [k, e] of [...byS.entries()].sort()) {
    console.log(`${k.padEnd(18)} takes=${e.n} withClickBeforeOffset=${e.withPre} firstClickMs=${e.firstMin.toFixed(1)}..${e.firstMax.toFixed(1)} phiMs=${e.phiMin.toFixed(2)}..${e.phiMax.toFixed(2)}`);
  }
}

if (mode === "gate") {
  const rep = replayAll().filter((r) => r.notReplayable === null);
  const perRun = new Map<string, { ok: number; bad: number; grid: Set<string> }>();
  for (const r of rep) {
    const p = r.row.medianBeatErrorMs;
    const oldOk = p !== null && r.old!.median !== null && Math.abs(r.old!.median - p) < 0.05 && r.old!.matched === r.row.matchedBeats && r.old!.missing === r.row.missingBeats;
    const newOk = p !== null && r.neu!.median !== null && Math.abs(r.neu!.median - p) < 0.05 && r.neu!.matched === r.row.matchedBeats && r.neu!.missing === r.row.missingBeats;
    const e = perRun.get(r.runId) ?? { ok: 0, bad: 0, grid: new Set<string>() };
    if (oldOk || newOk) { e.ok++; e.grid.add(oldOk && newOk ? "either" : oldOk ? "old" : "new"); } else e.bad++;
    perRun.set(r.runId, e);
    if (!oldOk && !newOk) {
      console.log(`UNREPRODUCED ${r.runId} ${r.row.scenario}/${r.row.bpm}/r${r.row.repeat}/t${r.row.takeIndex} persisted m/miss=${r.row.matchedBeats}/${r.row.missingBeats} med=${fmt(p)} | OLD ${r.old!.matched}/${r.old!.missing} ${fmt(r.old!.median)} | NEW ${r.neu!.matched}/${r.neu!.missing} ${fmt(r.neu!.median)}`);
    }
  }
  console.log("\n| run | reproduced | unreproduced | grid in force |");
  for (const [k, e] of [...perRun.entries()].sort()) console.log(`| ${k} | ${e.ok} | ${e.bad} | ${[...e.grid].join("/")} |`);
}

if (mode === "regress") {
  const runs = ["1788307141361", "1788307183605", "1788307228648", "1788307304777"];
  const rep = replayAll().filter((r) => r.notReplayable === null && runs.includes(r.runId));
  console.log("| run | scenario | repeat | take | phi (ms) | OLD m/miss | OLD adj median | NEW m/miss | NEW adj median | delta |");
  for (const r of rep) {
    const d = r.old!.adjusted !== null && r.neu!.adjusted !== null ? r.neu!.adjusted - r.old!.adjusted : null;
    console.log(`| ${r.runId} | ${r.row.scenario} | ${r.row.repeat} | ${r.row.takeIndex} | ${r.phiMs.toFixed(2)} | ${r.old!.matched}/${r.old!.missing} | ${fmt(r.old!.adjusted)} | ${r.neu!.matched}/${r.neu!.missing} | ${fmt(r.neu!.adjusted)} | ${fmt(d)} |`);
  }
}

if (mode === "ppqn") {
  // take-0 regionPositionPpqn distribution, split by build and by whether the
  // scenario punches in mid-timeline. Backs the register's placement claim.
  const groups = new Map<string, number[]>();
  for (const s2 of loadSummaries()) {
    const probe = s2.summary.sdkBuildProbe;
    for (const r of s2.summary.rows) {
      if (r.takeIndex !== 0 || r.regionPositionPpqn === undefined) continue;
      const k = `${probe} ${r.scenario === "midtimeline-start" ? "midtimeline" : "non-midtimeline"}`;
      const l = groups.get(k) ?? []; l.push(r.regionPositionPpqn); groups.set(k, l);
    }
  }
  for (const [k, a] of [...groups.entries()].sort()) {
    const v = [...a].sort((x, y) => x - y);
    console.log(`${k}: rows=${v.length} min=${v[0]} max=${v[v.length - 1]} zeros=${v.filter((x) => x === 0).length} above92=${v.filter((x) => x > 92).length}`);
  }
  console.log("\n-- non-midtimeline take-0 rows above 92 PPQN, and every upstream zero --");
  for (const s2 of loadSummaries()) {
    const probe = s2.summary.sdkBuildProbe;
    for (const r of s2.summary.rows) {
      if (r.takeIndex !== 0 || r.regionPositionPpqn === undefined || r.scenario === "midtimeline-start") continue;
      if (r.regionPositionPpqn > 92) console.log(`  ABOVE92 ${s2.runId} ${probe} ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat} ppqn=${r.regionPositionPpqn} matched=${r.matchedBeats} missing=${r.missingBeats}`);
      else if (r.regionPositionPpqn === 0 && probe === "upstream") console.log(`  UPSTREAM-ZERO ${s2.runId} ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat}`);
      else if (r.regionPositionPpqn > 0 && r.regionPositionPpqn < 5 && probe === "upstream") console.log(`  LOW ${s2.runId} ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat} ppqn=${r.regionPositionPpqn}`);
    }
  }
}

if (mode === "missingrows") {
  // Every persisted row with missingBeats > 0, with the geometry each carries
  // and whether its capture buffer still exists. Backs the register's
  // "unresolved candidates" table.
  const rep = new Map<string, string>();
  for (const r of replayAll()) {
    rep.set(`${r.runId}|${r.row.scenario}|${r.row.bpm}|${r.row.rate}|${r.row.repeat}|${r.row.takeIndex}`, r.notReplayable ?? "REPLAYABLE");
  }
  const allRows = replayAll();
  const replayable = allRows.filter((r) => r.notReplayable === null);
  console.log(`replayable rows (geometry + own capture audio): ${replayable.length}`);
  console.log(`  reporting a missing beat under the ABSOLUTE grid: ${replayable.filter((r) => r.neu!.missing > 0).length}`);
  console.log(`  reporting one under the region-anchored grid: ${replayable.filter((r) => r.old!.missing > 0).length}`);
  console.log(`rows with persisted missingBeats > 0: ${allRows.filter((r) => r.row.missingBeats > 0).length}, of which buffer gone: ${allRows.filter((r) => r.row.missingBeats > 0 && r.notReplayable !== null).length}`);
  console.log("");
  console.log("| run | build | cell | matched/missing | S (regionStartSec) | phi (ms) | adjusted median | headMissingRawMs | buffer |");
  for (const s2 of loadSummaries()) {
    const probe = s2.summary.sdkBuildProbe;
    for (const r of s2.summary.rows) {
      if (!(r.missingBeats > 0)) continue;
      const key = `${s2.runId}|${r.scenario}|${r.bpm}|${r.rate}|${r.repeat}|${r.takeIndex}`;
      const P = 60 / r.bpm;
      const phi = r.regionStartSec === undefined ? null : phiMs(r);
      const tol = P * 500; // half a beat, in ms
      const adj = r.medianBeatErrorMsAdjusted;
      const raw = r.medianBeatErrorMs;
      const margin = typeof raw === "number" ? tol - Math.abs(raw) : null;
      console.log(`| ${s2.runId} | ${probe} | ${r.scenario}/${r.bpm}/${r.rate} r${r.repeat} t${r.takeIndex} | ${r.matchedBeats}/${r.missingBeats} | ${r.regionStartSec === undefined ? "not persisted" : r.regionStartSec} | ${phi === null ? "—" : phi.toFixed(2)} | ${typeof adj === "number" ? adj.toFixed(2) : "—"} | ${r.headMissingRawMs === undefined || r.headMissingRawMs === null ? "not persisted" : r.headMissingRawMs.toFixed(2)} | ${rep.get(key) === "REPLAYABLE" ? "ON DISK" : "gone"} | margin-to-half-beat=${margin === null ? "—" : margin.toFixed(2)}ms`);
    }
  }
}

if (mode === "fencepost") {
  // Which takes have NO click captured before the region start, and does that
  // predict the region-anchored grid's missing-beat fencepost? Backs the
  // register's "5 of 92" table under "The confirmed mechanism".
  const rep = replayAll().filter((r) => r.notReplayable === null && r.row.takeIndex === 0);
  const nonMid = rep.filter((r) => r.row.scenario !== "midtimeline-start");
  const mid = rep.filter((r) => r.row.scenario === "midtimeline-start");
  const noPre = nonMid.filter((r) => (r.clicksBeforeOffset ?? 0) === 0);
  console.log(`midtimeline take-0 rows: ${mid.length}, of which with a click before the region start: ${mid.filter((r) => (r.clicksBeforeOffset ?? 0) > 0).length}`);
  console.log(`other scenarios' take-0 rows: ${nonMid.length}, with such a click: ${nonMid.length - noPre.length}, without: ${noPre.length}`);
  console.log("\n| run | build | cell | phi (ms) | clicks | first click | OLD grid | NEW grid |");
  for (const r of noPre) {
    console.log(`| ${r.runId} | ${r.probe} | ${r.row.scenario}/${r.row.bpm}/${r.row.rate} r${r.row.repeat} | ${r.phiMs.toFixed(2)} | ${r.clickCount} | ${r.firstClickMs!.toFixed(1)} ms | ${r.old!.matched} matched, ${r.old!.missing} missing, unmatched [${r.old!.unmatchedIndices}] | ${r.neu!.matched} matched, ${r.neu!.missing} missing |`);
  }
  const fenceAll = rep.filter((r) => r.old!.missing === 1 && r.old!.unmatchedIndices.length === 1 && r.old!.unmatchedIndices[0] === 0);
  const fenceNonMid = fenceAll.filter((r) => r.row.scenario !== "midtimeline-start");
  console.log(`\nrows showing the old grid's fencepost (missing=1, unmatched=[0]): ${fenceAll.length} total, ${fenceNonMid.length} non-midtimeline`);
  console.log(`every no-pre-click non-midtimeline row shows it: ${noPre.every((r) => r.old!.missing === 1 && r.old!.unmatchedIndices[0] === 0)}`);
  console.log(`every fencepost non-midtimeline row lacks a pre-click: ${fenceNonMid.every((r) => (r.clicksBeforeOffset ?? 0) === 0)}`);
  const jk = rep.filter((r) => r.row.scenario === "janked-start" && r.row.bpm === 120 && r.row.rate === 48000 && r.probe === "upstream");
  console.log(`upstream janked-start/120/48000 replayable repeats: ${jk.length}, showing the fencepost: ${jk.filter((r) => r.old!.missing === 1).length}`);
  const midPhi120 = mid.filter((r) => r.row.bpm === 120).map((r) => r.phiMs);
  const midPhi97 = mid.filter((r) => r.row.bpm === 97.3).map((r) => r.phiMs);
  const rng = (a: number[], P: number) => `${(P - Math.max(...a)).toFixed(1)}-${(P - Math.min(...a)).toFixed(1)}`;
  console.log(`midtimeline P-phi: @120 ${rng(midPhi120, 500)} ms (tol 250.0), @97.3 ${rng(midPhi97, 60000 / 97.3)} ms (tol ${(60000 / 97.3 / 2).toFixed(1)})`);
  const spreads = new Map<string, number[]>();
  for (const r of mid) { const k = `${r.runId}/${r.row.bpm}`; const l = spreads.get(k) ?? []; l.push(r.phiMs); spreads.set(k, l); }
  const sp = [...spreads.values()].map((a) => Math.max(...a) - Math.min(...a));
  console.log(`midtimeline per-cell phi spread across ${sp.length} cells: ${Math.min(...sp).toFixed(2)}-${Math.max(...sp).toFixed(2)} ms; per cell ${sp.map((x) => x.toFixed(2)).join(", ")}; exceeding the 50 ms poll interval: ${sp.filter((x) => x > 50).length}`);
  const fc120 = mid.filter((r) => r.row.bpm === 120).map((r) => r.firstClickMs!);
  const fc97 = mid.filter((r) => r.row.bpm === 97.3).map((r) => r.firstClickMs!);
  console.log(`midtimeline first click in buffer: @120 ${Math.min(...fc120).toFixed(1)}-${Math.max(...fc120).toFixed(1)} ms, @97.3 ${Math.min(...fc97).toFixed(1)}-${Math.max(...fc97).toFixed(1)} ms`);
  const hr = mid.map((r) => r.row.headMissingRawMs!).sort((a, b) => a - b);
  console.log(`midtimeline headMissingRawMs over those ${hr.length} takes: ${hr[0].toFixed(2)}-${hr[hr.length - 1].toFixed(2)} ms`);
  for (const bpm of [120, 97.3]) {
    const g = mid.filter((r) => r.row.bpm === bpm);
    console.log(`midtimeline click gaps @${bpm}: ${Math.min(...g.map((r) => r.clickGapsMs![0])).toFixed(1)}-${Math.max(...g.map((r) => r.clickGapsMs![1])).toFixed(1)} ms, clicks ${[...new Set(g.map((r) => r.clickCount))].join(",")}`);
  }
}

if (mode === "enum") {
  const all = replayAll();
  const noGeom = all.filter((r) => r.notReplayable === "no per-row geometry in summary").length;
  const overwritten = all.filter((r) => r.notReplayable !== null && r.notReplayable.startsWith("WAV overwritten")).length;
  const other = all.filter((r) => r.notReplayable !== null && r.notReplayable !== "no per-row geometry in summary" && !r.notReplayable.startsWith("WAV overwritten"));
  const rep = all.filter((r) => r.notReplayable === null);
  let repro = 0;
  const bad: string[] = [];
  for (const r of rep) {
    const p = r.row.medianBeatErrorMs;
    const ok = (m: { median: number | null; matched: number; missing: number }) =>
      p !== null && m.median !== null && Math.abs(m.median - p) < 0.05 && m.matched === r.row.matchedBeats && m.missing === r.row.missingBeats;
    if (ok(r.old!) || ok(r.neu!)) repro++;
    else bad.push(`${r.row.scenario}/${r.row.bpm}/r${r.row.repeat}/t${r.row.takeIndex}`);
  }
  const runs = loadSummaries();
  console.log(`snapshot: ${runs.length} summary runs, newest ${runs[runs.length - 1].runId}` + (MAX_RUN === Infinity ? " (unbounded)" : ` (RECAUDIT_MAX_RUN=${MAX_RUN})`));
  console.log(`rows considered            ${all.length}`);
  console.log(`  no per-row geometry      ${noGeom}`);
  console.log(`  capture WAV overwritten  ${overwritten}`);
  console.log(`  other non-replayable     ${other.length}`);
  console.log(`  replayed under both grids ${rep.length}`);
  console.log(`    reproduce persisted row ${repro}`);
  console.log(`    do not reproduce        ${bad.length}`);
  const kinds = new Set(bad.map((b) => b.split("/")[0] + " take " + b.split("/").pop()));
  console.log(`    non-reproducing kinds   ${[...kinds].sort().join("; ")}`);
}

if (mode === "correct") {
  // Per-cell means on both grids. NEW = OLD + phi is applied analytically to
  // every row that carries geometry AND satisfies the identity's precondition
  // phi < P/2 (rows past it are listed and excluded — the identity does not
  // hold for them); the identity itself is validated on the rows whose WAV
  // survives (see `gate`).
  const wanted = process.argv.slice(3);
  for (const s of loadSummaries()) {
    if (wanted.length > 0 && !wanted.includes(s.runId)) continue;
    const j = s.summary;
    // The beat grid a run's persisted medians sit on is decided by the loader
    // (persisted from schema version 2; run-id cutoff before that).
    const alreadyAbsolute = j.beatGrid === "absolute";
    console.log(`\n### ${s.file}  probe=${j.sdkBuildProbe} rate=${j.rate}  grid=${alreadyAbsolute ? "absolute (as measured)" : "region-anchored (needs +phi)"} [${j.beatGridSource}]`);
    const cells = new Map<string, typeof j.rows>();
    for (const r of j.rows) {
      const k = `${r.scenario}|${r.bpm}`;
      const l = cells.get(k) ?? []; l.push(r); cells.set(k, l);
    }
    console.log("| scenario | bpm | n | mean adj region-anchored | mean phi | mean adj ABSOLUTE | missing rows | phi >= P/2 (excluded) |");
    for (const [k, list] of [...cells.entries()].sort()) {
      const [scenario, bpm] = k.split("|");
      // loop-wrap cell means use takeIndex 1-4 only (register's I2 population).
      const pop = scenario === "loop-wrap" ? list.filter((r) => r.takeIndex >= 1 && r.takeIndex <= 4) : list;
      const withGeom = pop.filter((r) => typeof r.medianBeatErrorMsAdjusted === "number" && r.regionStartSec !== undefined);
      const halfPeriodMs = (60 / Number(bpm)) * 500;
      const invalid = withGeom.filter((r) => phiMs(r) >= halfPeriodMs);
      const usable = withGeom.filter((r) => phiMs(r) < halfPeriodMs);
      if (usable.length === 0) {
        const anyAdj = pop.filter((r) => typeof r.medianBeatErrorMsAdjusted === "number");
        console.log(`| ${scenario} | ${bpm} | ${anyAdj.length} | ${anyAdj.length ? fmt(mean(anyAdj.map((r) => r.medianBeatErrorMsAdjusted!))) : "—"} | NO GEOMETRY | NO GEOMETRY | ${pop.filter((r) => r.missingBeats > 0).length} | ${invalid.length} |`);
        continue;
      }
      const phis = usable.map(phiMs);
      const asMeasured = mean(usable.map((r) => r.medianBeatErrorMsAdjusted!));
      const absMean = alreadyAbsolute ? asMeasured : mean(usable.map((r, i) => r.medianBeatErrorMsAdjusted! + phis[i]));
      const oldMean = alreadyAbsolute ? mean(usable.map((r, i) => r.medianBeatErrorMsAdjusted! - phis[i])) : asMeasured;
      console.log(`| ${scenario} | ${bpm} | ${usable.length} | ${fmt(oldMean)} | ${fmt(mean(phis))} | ${fmt(absMean)} | ${pop.filter((r) => r.missingBeats > 0).length} | ${invalid.length}${invalid.length ? " (" + invalid.map((r) => `r${r.repeat}/t${r.takeIndex} phi=${phiMs(r).toFixed(2)}`).join(", ") + ")" : ""} |`);
    }
  }
}
