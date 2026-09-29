// Joins a node-tap probe to the multi-mic summary of the same run.
// node scripts/audit/recording-alignment/stream-tap/node-tap.read.cjs <node-tap json> <recaudit-mt-summary json>
const fs = require("fs");
const [tapFile, summaryFile] = process.argv.slice(2);
const probe = JSON.parse(fs.readFileSync(tapFile));
const summary = JSON.parse(fs.readFileSync(summaryFile));
const rate = summary.rate;
console.log("probe errors:", probe.errors.length, "| taps:", probe.taps.length, "| rows:", summary.rows.length);
console.log("cell verdicts:", JSON.stringify(summary.cellVerdicts));
// A tap is read when every window gave a lag, the same lag, with nothing between the
// tap and the reference at it. An artifact written before the probe said so itself has
// no `unread`; it is judged here by the same rule.
const isRead = (t) => Array.isArray(t.lags) && t.lags.length === 3 && t.lags.every((lag) => typeof lag === "number" && lag >= 0)
  && new Set(t.lags).size === 1 && t.mad.every((mad) => mad === 0) && (t.unread === undefined || t.unread === null);
const taps = probe.taps.map((t) => ({ ...t, read: isRead(t), tape: t.deviceId === "loopback-injection" ? "a" : t.deviceId === "loopback-injection-2" ? "b" : "?" }));
const unread = taps.filter((t) => !t.read);
console.log("taps read:", taps.length - unread.length, "of", taps.length,
  "| skipped quanta", taps.reduce((s, t) => s + (t.skippedQuanta ?? 0), 0));
for (const t of unread) console.log("  not read, tape", t.tape, "connected at", t.sdkConnectSec, ":", t.unread ?? (Array.isArray(t.lags) ? "lags " + t.lags.join(" / ") : "the tap did not finish"));
// Rows in run order; each row takes the unused tap of its tape whose SDK connection is the
// latest one at or before the row's first-frame time.
const used = new Set();
const joined = summary.rows.map((row) => {
  let best = null;
  for (const tap of taps) {
    if (tap.tape !== row.tape || used.has(tap)) continue;
    if (tap.sdkConnectSec > row.firstQuantumTimeSec + 1e-9) continue;
    if (best === null || tap.sdkConnectSec > best.sdkConnectSec) best = tap;
  }
  if (best !== null) used.add(best);
  return { row, tap: best };
});
console.log("rows without a tap:", joined.filter((j) => j.tap === null).length, "| taps unused:", taps.length - used.size);
const f = (sec) => Math.round(sec * rate);
console.log("\nscenario          r tape  nodeDelay  loopbackDelay  diff   firstQuantum-sdkConnect  anchorT0(fr) firstQ(fr) waveOff(fr)");
const diffs = [];
for (const { row, tap } of joined) {
  if (tap === null || !tap.read) continue;
  const node = tap.lags[0];
  const loop = row.loopbackDelayMs * rate / 1000;
  diffs.push(loop - node);
  console.log(`${row.scenario.padEnd(17)} ${row.repeat} ${row.tape}     ${String(node).padStart(5)}      ${loop.toFixed(1).padStart(7)}     ${(loop - node).toFixed(1).padStart(6)}   ${String(f(row.firstQuantumTimeSec) - f(tap.sdkConnectSec)).padStart(6)}                 ${f(row.anchorT0Sec)} ${f(row.firstQuantumTimeSec)} ${(row.waveformOffsetSec * rate).toFixed(1)}`);
}
const tally = (a) => { const c = {}; for (const v of a) c[v] = (c[v] ?? 0) + 1; return Object.entries(c).sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k}×${v}`).join(" "); };
console.log("\nloopbackDelay − nodeDelay, frames:", tally(diffs.map((d) => d.toFixed(1))));
console.log("\nper repeat: raw skew (b − a), node delay difference (b − a), what is left");
const byRepeat = new Map();
for (const j of joined) { const k = j.row.scenario + " r" + j.row.repeat; byRepeat.set(k, { ...(byRepeat.get(k) ?? {}), [j.row.tape]: j }); }
const left = [];
for (const [k, pair] of byRepeat) {
  if (!pair.a || !pair.b || !pair.a.tap || !pair.b.tap) { console.log(k, "incomplete"); continue; }
  if (!pair.a.tap.read || !pair.b.tap.read) { console.log(k.padEnd(24), "a tap was not read"); continue; }
  const raw = pair.b.row.medianSkewMs;            // b − a, the sign the rows carry
  const rawBeat = pair.b.row.medianBeatErrorMs - pair.a.row.medianBeatErrorMs;
  const node = (pair.b.tap.lags[0] - pair.a.tap.lags[0]) / rate * 1000;
  const fq = (pair.b.row.firstQuantumTimeSec - pair.a.row.firstQuantumTimeSec) * 1000;
  // A later arrival in tape b puts the sound LATER on b's timeline: the skew the two node delays alone produce is +node.
  left.push(rawBeat - node);
  console.log(`${k.padEnd(24)} rawSkew(row) ${raw.toFixed(2).padStart(7)}  beatErr b−a ${rawBeat.toFixed(2).padStart(7)}  nodeDelay b−a ${node.toFixed(2).padStart(7)}  left ${(rawBeat - node).toFixed(2).padStart(7)}  firstQuantum b−a ${fq.toFixed(2).padStart(6)}  netted ${pair.b.row.medianSkewMsNetted.toFixed(2)}  ${pair.a.row.status}`);
}
console.log("\nleft over, ms:", tally(left.map((v) => v.toFixed(2))));
