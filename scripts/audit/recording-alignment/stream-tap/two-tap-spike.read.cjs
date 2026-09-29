// Tabulates every spike-two-tap artifact in .verify-output/ (two-tap-spike.page.js). node scripts/audit/recording-alignment/stream-tap/two-tap-spike.read.cjs
const fs = require("fs");
const dir = ".verify-output/";
const files = fs.readdirSync(dir).filter((f) => f.startsWith("spike-two-tap-") && f.endsWith(".json")).sort();
const tally = (a) => { const c = {}; for (const v of a) c[v] = (c[v] ?? 0) + 1; return Object.entries(c).sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k}×${v}`).join(" "); };
const names = ["A", "B", "C", "D"];
for (const f of files) {
  const a = JSON.parse(fs.readFileSync(dir + f));
  const rows = a.rows; const sr = a.cfg.sampleRate; const variant = a.cfg.variants[0];
  const ms = (fr) => (fr / sr * 1000).toFixed(2);
  console.log(`\n== ${f}  (${variant}, ${sr} Hz, ${rows.length} opens, baseLatency ${(a.baseLatency * 1000).toFixed(3)} ms)`);
  const taps = rows.flatMap((r) => names.map((n) => r.taps[n]));
  console.log(" worst mean abs difference at the matched lag:", Math.max(...taps.flatMap((t) => t.mad)), "| smallest at the runner-up lag:", Math.min(...taps.flatMap((t) => t.secondMad)));
  console.log(" refused windows (lag < 0):", taps.flatMap((t) => t.lags).filter((l) => l < 0).length, "of", taps.length * 3);
  console.log(" recorders with skipped quanta:", taps.filter((t) => t.gaps.length > 0).length, "of", taps.length, "| reference:", rows.filter((r) => r.refGaps.length > 0).length, "of", rows.length,
    "| where:", tally(taps.flatMap((t) => t.gaps.map((g) => `q${g.afterQuantum}+${g.missingFrames}`))));
  const unstable = rows.filter((r) => names.some((n) => new Set(r.taps[n].lags).size > 1));
  console.log(" opens where a tap's lag moved inside the recording:", unstable.length, unstable.map((r) => r.open + ": " + names.map((n) => n + " " + r.taps[n].lags.join("/")).join(", ")).join(" | "));
  const lag = (r, n) => r.taps[n].lags[0];
  const all = rows.flatMap((r) => names.map((n) => lag(r, n)));
  console.log(` delay, all taps: ${Math.min(...all)}…${Math.max(...all)} frames = ${ms(Math.min(...all))}…${ms(Math.max(...all))} ms; distinct ${new Set(all).size}`);
  if (new Set(all).size <= 24) console.log("   ", tally(all));
  console.log(" delay mod 32:", tally(all.map((l) => l % 32)));
  const pairs = (list) => rows.flatMap((r) => list.map(([x, y]) => lag(r, y) - lag(r, x)));
  const describe = (d) => `${d.filter((v) => v === 0).length} of ${d.length} equal; |difference| up to ${Math.max(...d.map(Math.abs))} frames = ${ms(Math.max(...d.map(Math.abs)))} ms; in quanta: ${tally(d.map((v) => Number((Math.abs(v) / 128).toFixed(2))))}`;
  if (variant === "sameNode") {
    // B listens to A's node and D to C's: two recorders on one consumer.
    console.log(" SAME NODE, two recorders (A,B) (C,D):", describe(pairs([["A", "B"], ["C", "D"]])));
    console.log(" TWO clones, two nodes, same start (A,C):", describe(pairs([["A", "C"]])));
    continue;
  }
  console.log(" SAME clone, two nodes (A,B) (C,D):  ", describe(pairs([["A", "B"], ["C", "D"]])));
  console.log(" TWO clones, two nodes (A,C) (B,D):  ", describe(pairs([["A", "C"], ["B", "D"]])), variant === "together" ? "" : "(each pair started in one task)");
  console.log(" all four taps equal:", rows.filter((r) => new Set(names.map((n) => lag(r, n))).size === 1).length, "of", rows.length);
  // Is the delay readable from the silent head (frames from the recorder's first quantum to the first non-zero sample)?
  const head = taps.map((t) => ({ head: t.firstSignalFrame - t.firstFrame, lag: t.lags[0] }));
  console.log(" silent head − delay:", tally(head.map((h) => h.head - h.lag)));
}
