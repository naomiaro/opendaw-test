// What the harness's own node taps read, run by run, and — where the external probe ran
// beside them — whether the two agree.
// node scripts/audit/recording-alignment/stream-tap/harness-node-delays.read.cjs <summary run id>[:<node-tap time>] …
const fs = require("fs");
const dir = ".verify-output/";
const tally = (a) => { const c = {}; for (const v of a) c[v] = (c[v] ?? 0) + 1; return Object.entries(c).sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"; };
const range = (a, digits = 2) => (a.length === 0 ? "—" : `${Math.min(...a).toFixed(digits)}…${Math.max(...a).toFixed(digits)}`);
const pooled = {};
for (const arg of process.argv.slice(2)) {
  const [runId, probeId] = arg.split(":");
  const run = JSON.parse(fs.readFileSync(`${dir}recaudit-mt-summary-${runId}.json`));
  const rate = run.rate;
  const rows = run.rows.filter((r) => r.status !== "error");
  const measured = rows.filter((r) => typeof r.nodeDelayFrames === "number");
  const a = rows.filter((r) => r.tape === "a");
  const pairs = a.map((ra) => ({ a: ra, b: rows.find((r) => r.tape === "b" && r.scenario === ra.scenario && r.repeat === ra.repeat && r.bpm === ra.bpm) }));
  const both = pairs.filter((p) => typeof p.a.medianSkewMsUnaccounted === "number");
  console.log(`\nrun ${runId} — ${rate} Hz, rows ${run.rows.length} (error ${run.rows.length - rows.length}), streams opened ${run.getUserMediaOpens}, anchor offset ${run.anchorOffsetMs === undefined ? "absent" : run.anchorOffsetMs === null ? "null" : run.anchorOffsetMs.toFixed(4) + " ms"}`);
  console.log(`  verdicts: ${run.cellVerdicts.map((v) => `${v.scenario} ${v.status}`).join(", ")}`);
  console.log(`  head or tail deficit on ${rows.filter((r) => r.headMissingMs !== 0 || r.tailMissingMs !== 0).length} rows; first take started ${((rows[0].firstQuantumTimeSec - rows[0].recordRequestContextTime) * 1000).toFixed(2)} ms after its request; netted medians ${range(rows.map((r) => r.medianBeatErrorMsNetted), 3)} ms`);
  console.log(`  node delay read on ${measured.length} of ${rows.length} rows; not read: ${tally(rows.filter((r) => typeof r.nodeDelayFrames !== "number").map((r) => JSON.stringify(r.nodeDelayUnmeasured)))}`);
  console.log(`  node delays, frames: ${tally(measured.map((r) => r.nodeDelayFrames))}`);
  console.log(`  loopbackDelayMs − node delay, frames: ${tally(measured.map((r) => (r.loopbackDelayMs * rate / 1000 - r.nodeDelayFrames).toFixed(3)))}`);
  console.log(`  firstFrameCheckMs: ${range(measured.map((r) => r.firstFrameCheckMs), 4)} ms`);
  console.log(`  repeats with both node delays: ${both.length} of ${pairs.length}; raw skew not zero on ${both.filter((p) => Math.abs(p.a.medianSkewMs) > 0.005).length}, up to ${Math.max(0, ...both.map((p) => Math.abs(p.a.medianSkewMs))).toFixed(2)} ms; left over ${range(both.map((p) => p.a.medianSkewMsUnaccounted), 6)} ms`);
  console.log(`  raw skew in render quanta: ${tally(pairs.map((p) => (Math.abs(p.a.medianSkewMs) / (128000 / rate)).toFixed(2)))}`);
  console.log(`  tap attached after the first frame by ${range(measured.map((r) => (r.nodeTapAttachedAtSec - r.firstQuantumTimeSec) * 1000), 0)} ms; nodes built since the tap before: ${tally(rows.map((r) => r.nodeTapNodesBuilt))}`);
  const pool = (pooled[rate] ??= { rows: 0, measured: 0, offsets: [], repeats: 0, both: 0, nonZero: 0, left: [], raw: [], check: [], moved: 0 });
  pool.rows += rows.length; pool.measured += measured.length; pool.repeats += pairs.length; pool.both += both.length;
  pool.nonZero += both.filter((p) => Math.abs(p.a.medianSkewMs) > 0.005).length;
  pool.offsets.push(...measured.map((r) => (r.loopbackDelayMs * rate / 1000 - r.nodeDelayFrames).toFixed(3)));
  pool.left.push(...both.map((p) => Math.abs(p.a.medianSkewMsUnaccounted)));
  pool.raw.push(...both.map((p) => Math.abs(p.a.medianSkewMs)));
  pool.check.push(...measured.map((r) => Math.abs(r.firstFrameCheckMs)));
  pool.moved += rows.filter((r) => String(r.nodeDelayUnmeasured).startsWith("the delay moved")).length;
  if (probeId === undefined) continue;
  const probe = JSON.parse(fs.readFileSync(`${dir}node-tap-${probeId}.json`));
  const used = new Set();
  let bothRead = 0, equal = 0;
  const notes = [];
  for (const row of rows) {
    let best = null;
    for (const tap of probe.taps) {
      const tape = tap.deviceId === "loopback-injection" ? "a" : "b";
      if (tape !== row.tape || used.has(tap) || tap.sdkConnectSec > row.firstQuantumTimeSec + 1e-9) continue;
      if (best === null || tap.sdkConnectSec > best.sdkConnectSec) best = tap;
    }
    if (best === null) { notes.push(`${row.scenario} r${row.repeat}${row.tape}: no probe tap`); continue; }
    used.add(best);
    const stable = new Set(best.lags).size === 1;
    if (typeof row.nodeDelayFrames === "number" && stable) {
      bothRead++;
      if (best.lags[0] === row.nodeDelayFrames) equal++;
      else notes.push(`${row.scenario} r${row.repeat}${row.tape}: harness ${row.nodeDelayFrames}, probe ${best.lags[0]}`);
    } else {
      notes.push(`${row.scenario} r${row.repeat}${row.tape}: harness ${row.nodeDelayFrames === null ? `not read (${row.nodeDelayUnmeasured})` : row.nodeDelayFrames}, probe ${best.lags.join(" / ")}`);
    }
  }
  console.log(`  external probe node-tap-${probeId} (errors ${probe.errors.length}): both read ${bothRead} rows, equal on ${equal}`);
  for (const note of notes) console.log(`    ${note}`);
}
console.log("\npooled");
for (const [rate, p] of Object.entries(pooled)) {
  console.log(`  ${rate} Hz: node delay read on ${p.measured} of ${p.rows} rows (moved inside the tap: ${p.moved}); loopbackDelayMs − node delay, frames: ${tally(p.offsets)}; largest |firstFrameCheckMs| ${Math.max(0, ...p.check).toFixed(4)} ms`);
  console.log(`    repeats with both node delays ${p.both} of ${p.repeats}; raw skew not zero on ${p.nonZero}, up to ${Math.max(0, ...p.raw).toFixed(2)} ms; largest left over ${Math.max(0, ...p.left).toExponential(2)} ms`);
}
