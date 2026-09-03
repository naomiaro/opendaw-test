/**
 * Task 12b — the register's input-latency-calibration tables, recomputed offline.
 *
 * Reads only the persisted `.verify-output/calib-summary-*.json` (and, for the
 * chain census, the standing sweep and multitrack envelopes) and recomputes
 * every figure the register's "Input-latency calibration (2026-09-02)" section
 * quotes: the per-build ground-truth table, the first build's noise-limited
 * uncertainties, the chain-state census, the one-quantum calibration miss, and
 * the `?repeat=` batches on the final upstream head. The least-squares fits are
 * recomputed here and checked against the value the page persisted, so a table
 * in the register is never the page's arithmetic taken on trust.
 *
 * Run: `node scripts/audit/recording-alignment/task12b-calibration-tables.ts [mode]`
 * Modes: `runs` | `noise` | `chains` | `miss` | `batches` | `all` (default).
 */
import {
  loadCalibrationSummary, loadMultitrackSummary, loadSummary, mean,
  type CalibrationCall, type LoadedCalibrationSummary,
} from "./artifacts.ts";

/**
 * Which SDK head each artifact was measured on. Declared, not inferred: the
 * envelope's `buildFeatures` separates the calibration era from upstream but
 * cannot separate the branch's own heads (the keep-alive sink is a graph edge
 * with no detectable surface), so the mapping comes from the campaign ledger.
 */
const BUILDS: { head: string; note: string; runs: string[] }[] = [
  {
    head: "f0c44b06c",
    note: "first calibration build — no keep-alive sink, no configurable probe",
    runs: [
      "1788380827527", "1788381023857", "1788381518785", "1788381617706", "1788381715449",
      "1788381865054", "1788383382606", "1788383812745", "1788383904062", "1788383997913",
    ],
  },
  {
    head: "ac1c15ea8",
    note: "keep-alive sink added",
    runs: ["1788384874160", "1788385001347", "1788385066131", "1788385161872", "1788385236496", "1788385315180"],
  },
  {
    head: "3484e3265",
    note: "configurable probe (LatencyProbes.mls) on top of the sink",
    runs: [
      "1788387758809", "1788387844291", "1788387924745", "1788388011786", "1788388441928",
      "1788388530136", "1788388610945", "1788388693481", "1788388770256", "1788388847147",
    ],
  },
  {
    head: "546b5bfaa",
    note: "an unstamped capture reuses its audio chain across recordings",
    runs: ["1788389912522", "1788389998986", "1788390783792", "1788391548108"],
  },
  {
    head: "660213857",
    note: "second capture anchor; `?repeat=` batches",
    runs: ["1788392793660", "1788392963167", "1788393319769", "1788393692168"],
  },
];

/** The standing sweep and multitrack runs measured on `3484e3265`. */
const SWEEPS: Record<number, string> = { 48000: "1788386290685", 44100: "1788386775464" };
const MULTITRACK = "1788387238856";

/**
 * The cut between the low and high chain states. Every chain instance on
 * `3484e3265` reads either ≤ 13.18 ms or ≥ 20.29 ms, so any cut inside that gap
 * yields the same census; the script prints both groups' extremes so the gap is
 * visible rather than asserted.
 */
const LOW_STATE_MAX_MS = 18;

const ms = (seconds: number) => seconds * 1000;
const f3 = (x: number) => x.toFixed(3);

/** Least squares of the input part on the injected delay. */
function fitRows(sweep: CalibrationCall[], okOnly: boolean): { slope: number; interceptMs: number; points: number; maxResidualMs: number } | null {
  const rows = sweep.filter((row) => (okOnly ? row.verdict === "ok" : true) && typeof row.requestedDelaySec === "number");
  if (rows.length < 2) return null;
  const xs = rows.map((row) => row.requestedDelaySec as number);
  const ys = rows.map((row) => row.inputLatencySeconds);
  const xBar = mean(xs);
  const yBar = mean(ys);
  const sxx = xs.reduce((sum, x) => sum + (x - xBar) ** 2, 0);
  const sxy = xs.reduce((sum, x, i) => sum + (x - xBar) * (ys[i] - yBar), 0);
  // A run that swept one delay repeatedly (the D = 0 diagnostic) has no leverage.
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  const maxResidual = Math.max(...ys.map((y, i) => Math.abs(y - (intercept + slope * xs[i]))));
  return { slope, interceptMs: ms(intercept), points: rows.length, maxResidualMs: ms(maxResidual) };
}

/** The per-take hops the applied cell recorded, in row order. */
const hopsMs = (summary: LoadedCalibrationSummary): number[] => summary.harnessLoopbackHopPerRowSec.map(ms);

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function printRuns(): void {
  console.log("=== Calibration ground truth, per SDK build ===");
  console.log("slope/intercept are recomputed here over the `ok` sweep rows. Runs before `404a70b`");
  console.log("fitted every row, noisy ones included, so their persisted figure is printed too");
  console.log("([page … over all rows]) rather than the register quoting one and the artifact the other.");
  console.log("L = the applied calibration's input part; hop = the harness's independent");
  console.log("firstQuantumTime − anchorT0, one per recorded take of the applied cell.");
  for (const build of BUILDS) {
    console.log(`\n-- SDK ${build.head} (${build.note})`);
    for (const runId of build.runs) {
      const summary = loadCalibrationSummary(runId);
      const fit = fitRows(summary.sweep, true);
      const delays = summary.sweep.map((row) => row.requestedDelayMs ?? NaN);
      const span = delays.length > 0 ? `${Math.min(...delays)}–${Math.max(...delays)}` : "—";
      const applied = summary.applied === null ? null : ms(summary.applied.inputLatencySeconds);
      const hops = hopsMs(summary);
      const medians = summary.cell.rows.map((row) => row.medianBeatErrorMsAdjusted).filter((m): m is number => m !== null);
      // A null head or tail figure is "integrity unmeasured" (no reference click
      // anchored the take — see `asClassifiable` in artifacts.ts), never 0: it is
      // left out of the max and counted, so an unanchored row cannot print as a
      // clean 0.00.
      const heads = summary.cell.rows.map((row) => row.headMissingMs).filter((h): h is number => typeof h === "number");
      const tails = summary.cell.rows.map((row) => row.tailMissingMs).filter((t): t is number => typeof t === "number");
      const unmeasured = (summary.cell.rows.length - heads.length) + (summary.cell.rows.length - tails.length);
      let persisted = "";
      if (fit !== null && summary.fit !== null && Math.abs(fit.slope - summary.fit.slope) > 1e-9) {
        const all = fitRows(summary.sweep, false);
        const overAllRows = all !== null && Math.abs(all.slope - summary.fit.slope) < 1e-9;
        persisted = ` [page slope ${summary.fit.slope.toFixed(6)} intercept ${f3(ms(summary.fit.interceptSec))}` +
          `${overAllRows ? " over all rows, one noisy" : " — UNEXPLAINED"}]`;
      }
      const noisy = summary.sweep.filter((row) => row.verdict !== "ok").length;
      console.log(
        `  ${runId} ${summary.rate} Hz ${summary.armState ?? "—"}` +
        ` mode=${summary.captureMode ?? "(not persisted)"} opens=${summary.getUserMediaOpens ?? "—"}` +
        ` D=${span} ms n=${summary.sweep.length}${noisy > 0 ? ` (${noisy} noisy)` : ""}` +
        ` slope=${fit === null ? "—" : fit.slope.toFixed(6)}` +
        ` icpt=${fit === null ? "—" : f3(fit.interceptMs)}` +
        ` maxres=${fit === null ? "—" : fit.maxResidualMs.toExponential(2)}` +
        ` L=${applied === null ? "—" : f3(applied)}` +
        ` hops=${hops.map(f3).join("/")}` +
        ` L−medianHop=${applied === null || hops.length === 0 ? "—" : (applied - median(hops)).toFixed(3)}` +
        ` medians=[${medians.map((m) => m.toFixed(2)).join(", ")}]` +
        ` head/tail max=${Math.max(...heads, 0).toFixed(2)}/${Math.max(...tails, 0).toFixed(2)}` +
        (unmeasured > 0 ? ` (${unmeasured} head/tail figure(s) unmeasured — null, excluded from the max)` : "") +
        ` cell=${summary.cell.status}${persisted}`
      );
    }
  }
}

/**
 * The six runs of the original ground-truth session on `f0c44b06c`, in run
 * order. The pooled per-call noise is taken over these and no others: the four
 * later `f0c44b06c` runs came after the warm-up and ceiling changes, so mixing
 * them in would pool two different page behaviours.
 */
const FIRST_BUILD_SESSION = ["1788380827527", "1788381023857", "1788381518785", "1788381617706", "1788381715449", "1788381865054"];

function printNoise(): void {
  console.log("\n=== First build (f0c44b06c): the per-call noise the slope bar was measured against ===");
  // The two fresh-chain first pulls (the first call of the two runs that made
  // one before the warm-up commit landed) are excluded: they measure the
  // un-pulled node's low state, not the steady state the rest of the
  // population sits in — pooling them would inflate the sd with a different
  // effect's step.
  const freshFirstPull = new Set(["1788380827527", "1788381023857"]);
  const points: number[] = [];
  for (const runId of FIRST_BUILD_SESSION) {
    const summary = loadCalibrationSummary(runId);
    summary.sweep.forEach((row, index) => {
      if (freshFirstPull.has(runId) && index === 0) return;
      if (typeof row.requestedDelaySec !== "number") return;
      points.push(ms(row.inputLatencySeconds - row.requestedDelaySec));
    });
  }
  const m = mean(points);
  const sd = Math.sqrt(points.reduce((sum, x) => sum + (x - m) ** 2, 0) / (points.length - 1));
  console.log(
    `  pooled input − D over the six runs of the original ground-truth session: n=${points.length}` +
    ` mean=${f3(m)} ms sd=${f3(sd)} ms range=${Math.min(...points).toFixed(2)}…${Math.max(...points).toFixed(2)} ms`
  );
  const sigma = (design: number[]) => {
    const xBar = mean(design);
    const sxx = design.reduce((sum, x) => sum + (x - xBar) ** 2, 0);
    return {
      slope: sd / Math.sqrt(sxx),
      intercept: sd * Math.sqrt(1 / design.length + (xBar * xBar) / sxx),
    };
  };
  for (const [label, design] of [
    ["required span 0,10,25,50", [0, 10, 25, 50]],
    ["wide span 0,80,160,240,320,400", [0, 80, 160, 240, 320, 400]],
    ["wide span 0,100,200,300,400", [0, 100, 200, 300, 400]],
  ] as [string, number[]][]) {
    const s = sigma(design);
    console.log(`  ${label}: 1σ slope ±${s.slope.toFixed(4)}, 1σ intercept ±${s.intercept.toFixed(3)} ms`);
  }
}

function printChains(): void {
  console.log("\n=== Chain-state census on 3484e3265 (every fresh chain instance the build's artifacts contain) ===");
  console.log(`  a chain reads low when its delay is below ${LOW_STATE_MAX_MS} ms; both groups' extremes are printed.`);
  console.log("  Two measurements of the same quantity are pooled: a recorded take reports the harness's");
  console.log("  hop (firstQuantumTime − anchorT0) and a calibrated chain reports the routine's own input");
  console.log("  latency. They differ by the harness's constant (+0.29 ms at 48 kHz, +0.30 at 44.1), far");
  console.log("  below the ~8 ms step this census counts; the frame lattice below is taken over the hops only.");
  for (const rate of [48000, 44100] as const) {
    const rows: { source: string; hopMs: number; isHop: boolean }[] = [];
    // Standing sweep: the box names the loopback device on a stream that reports
    // no id, so the SDK rebuilt the chain before every take — one chain per
    // recording, i.e. per (scenario, bpm, repeat).
    const sweep = loadSummary(SWEEPS[rate]);
    const perRecording = new Map<string, number[]>();
    for (const row of sweep.rows) {
      // `anchorT0Sec` is null (not undefined) on a persisted row that found no
      // reference click, and such a row has no hop to contribute.
      if (row.status === "error" || row.firstQuantumTimeSec === undefined || typeof row.anchorT0Sec !== "number") continue;
      const key = `${row.scenario}/${row.bpm}/${row.repeat}`;
      const hop = ms(row.firstQuantumTimeSec - row.anchorT0Sec);
      const list = perRecording.get(key);
      if (list === undefined) perRecording.set(key, [hop]); else list.push(hop);
    }
    for (const [key, hops] of perRecording) {
      if (Math.max(...hops) - Math.min(...hops) > 1e-6) {
        throw new Error(`chain ${key} in run ${SWEEPS[rate]} does not hold one delay: ${hops.join(", ")}`);
      }
      rows.push({ source: "standing sweep", hopMs: hops[0], isHop: true });
    }
    if (rate === 48000) {
      const mt = loadMultitrackSummary(MULTITRACK);
      for (const row of mt.rows) {
        if (row.status === "error" || row.firstQuantumTimeSec === undefined || typeof row.anchorT0Sec !== "number") continue;
        rows.push({ source: "multitrack (one chain per tape per repeat)", hopMs: ms(row.firstQuantumTimeSec - row.anchorT0Sec), isHop: true });
      }
    }
    for (const runId of BUILDS[2].runs) {
      const summary = loadCalibrationSummary(runId);
      if (summary.rate !== rate) continue;
      // A run whose apply stored nothing persists an `error` cell with no rows
      // and an empty applied result: neither figure describes a chain.
      if (summary.cell.status === "error") continue;
      // The chain built at arm is the one the calibration itself measured, so
      // its delay is the routine's own figure rather than a take's hop.
      if (summary.applied !== null) {
        rows.push({ source: "calibration, chain built at arm", hopMs: ms(summary.applied.inputLatencySeconds), isHop: false });
      }
      // `armState=fresh` disarms and re-arms after `apply`, so the takes run on
      // a second chain; all three takes share it (asserted here).
      if (summary.armState === "fresh") {
        const takeHops = hopsMs(summary);
        if (Math.max(...takeHops) - Math.min(...takeHops) > 1e-6) {
          throw new Error(`run ${runId}: the re-armed chain does not hold one delay: ${takeHops.join(", ")}`);
        }
        rows.push({ source: "calibration, chain rebuilt by armState=fresh", hopMs: takeHops[0], isHop: true });
      }
    }
    const low = rows.filter((row) => row.hopMs < LOW_STATE_MAX_MS);
    const high = rows.filter((row) => row.hopMs >= LOW_STATE_MAX_MS);
    console.log(`\n  ${rate} Hz — ${rows.length} chain instances, ${low.length} low (${((100 * low.length) / rows.length).toFixed(0)} %)`);
    const bySource = new Map<string, { n: number; low: number }>();
    for (const row of rows) {
      const entry = bySource.get(row.source) ?? { n: 0, low: 0 };
      entry.n += 1;
      if (row.hopMs < LOW_STATE_MAX_MS) entry.low += 1;
      bySource.set(row.source, entry);
    }
    for (const [source, entry] of bySource) console.log(`    ${source}: ${entry.n} chains, ${entry.low} low`);
    console.log(`    low group: ${low.length === 0 ? "—" : `${Math.min(...low.map((r) => r.hopMs)).toFixed(3)}…${Math.max(...low.map((r) => r.hopMs)).toFixed(3)} ms`}`);
    console.log(`    high group: ${Math.min(...high.map((r) => r.hopMs)).toFixed(3)}…${Math.max(...high.map((r) => r.hopMs)).toFixed(3)} ms`);
    const lattice = [...new Set(rows.filter((row) => row.isHop).map((row) => Math.round((row.hopMs / 1000) * rate)))].sort((a, b) => a - b);
    const residues = [...new Set(lattice.map((frames) => frames % 32))];
    console.log(`    distinct hop values, in frames: ${lattice.length <= 8 ? lattice.join(", ") : `${lattice.length} values, ${lattice[0]}…${lattice[lattice.length - 1]}`}`);
    console.log(`    residues mod 32: ${residues.length === 1 ? `all ≡ ${residues[0]}` : `${residues.length} distinct — no 32-frame lattice`}`);
  }
}

function printMiss(): void {
  console.log("\n=== The one-quantum calibration miss (546b5bfaa, run 1788389998986, 44.1 kHz) ===");
  const summary = loadCalibrationSummary("1788389998986");
  const quantumMs = (128 / summary.rate) * 1000;
  console.log(`  render quantum ${quantumMs.toFixed(4)} ms`);
  for (const row of summary.sweep) {
    const inputMinusD = ms(row.inputLatencySeconds - (row.requestedDelaySec ?? 0));
    console.log(
      `    D=${row.requestedDelayMs} ms: input=${ms(row.inputLatencySeconds).toFixed(4)} ms` +
      ` input−D=${inputMinusD.toFixed(4)} ms verdict=${row.verdict}` +
      ` spread=${row.spreadSeconds === null ? "—" : row.spreadSeconds.toExponential(2)} s` +
      ` ratio=${row.correlationRatioDb === null ? "—" : row.correlationRatioDb.toFixed(2)} dB bursts=${row.identifiedBursts}`
    );
  }
  // The short call is measured against the median of the other three, not
  // against the run's spread: the D = 25 point sits 0.0037 ms high because
  // 25 ms at 44.1 kHz is a half-frame delay the correlator resolves.
  const values = summary.sweep.map((row) => ms(row.inputLatencySeconds - (row.requestedDelaySec ?? 0)));
  const shortest = Math.min(...values);
  const reference = median(values.filter((value) => value !== shortest));
  const deficit = reference - shortest;
  console.log(
    `  the other three sit at a median of ${reference.toFixed(4)} ms; deficit ${deficit.toFixed(4)} ms` +
    ` = ${((deficit / 1000) * summary.rate).toFixed(3)} frames = ${(deficit / quantumMs).toFixed(4)} render quanta`
  );
  console.log(`  the page's fit over the four ok rows: slope ${summary.fit === null ? "—" : summary.fit.slope.toFixed(4)}` +
    `, intercept ${summary.fit === null ? "—" : f3(ms(summary.fit.interceptSec))} ms` +
    `, max residual ${summary.fit === null ? "—" : summary.fit.maxAbsResidualMs.toFixed(3)} ms` +
    ` (excluded noisy rows: ${summary.fitExcludedNoisy === null ? "(field absent)" : summary.fitExcludedNoisy.count})`);
  console.log(`  warm-up call before it: ${summary.warmup === null ? "—" : ms(summary.warmup.inputLatencySeconds).toFixed(4)} ms;` +
    ` applied call after it: ${summary.applied === null ? "—" : ms(summary.applied.inputLatencySeconds).toFixed(4)} ms`);

  console.log("\n  Every 44.1 kHz sweep call on a keep-alive-era build, by run:");
  let total = 0;
  let misses = 0;
  for (const build of BUILDS.slice(1, 4)) {
    for (const runId of build.runs) {
      const run = loadCalibrationSummary(runId);
      if (run.rate !== 44100 || run.sweep.length === 0) continue;
      const vals = run.sweep.map((row) => ms(row.inputLatencySeconds - (row.requestedDelaySec ?? 0)));
      const range = Math.max(...vals) - Math.min(...vals);
      total += vals.length;
      // "Off its run's first call by more than half a quantum" — a coarser net than
      // the page's +-25 %-of-one-quantum window, so it cannot miss the event and
      // would also catch a half-quantum drift the page's window would ignore.
      const runOff = vals.filter((v) => Math.abs(v - vals[0]) > 0.5 * quantumMs).length;
      misses += runOff;
      console.log(`    ${runId} (${build.head}): ${vals.length} calls, within-run range ${range.toFixed(4)} ms, off-by->half-a-quantum ${runOff}`);
    }
  }
  console.log(`  total ${total} calls, ${misses} off its run's first call by more than half a quantum`);
}

function printBatches(): void {
  console.log("\n=== `?repeat=` batches on 660213857 (the second capture anchor) ===");
  let calls = 0;
  let misses = 0;
  for (const runId of BUILDS[4].runs) {
    const summary = loadCalibrationSummary(runId);
    if (summary.repeats.length === 0) continue;
    const quantumSec = 128 / summary.rate;
    // Each call's own injected delay removed, so a cycling batch is judged on
    // the constant it is testing rather than on the raw round trip. A batch
    // that held one delay states it once, on the envelope.
    const delayOf = (row: CalibrationCall) => (row.delayMs ?? summary.repeatSummary?.delayMs ?? 0) / 1000;
    const normalized = summary.repeats.map((row) => row.roundTripSeconds - delayOf(row));
    // Grouped at frame resolution: the calls of one batch agree far below a
    // frame, and a miss is a whole render quantum, so the grouping cannot
    // merge a miss into the mode.
    const counts = new Map<number, number[]>();
    for (const value of normalized) {
      const frames = Math.round(value * summary.rate);
      counts.set(frames, [...(counts.get(frames) ?? []), value]);
    }
    const [modeFrames, modeValues] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const mode = mean(modeValues);
    const offByQuantum = normalized.filter((value) => Math.abs(Math.abs(value - mode) / quantumSec - 1) < 0.25).length;
    const secondaryDeltas = summary.repeats
      .filter((row) => typeof row.roundTripSecondsSecondary === "number" && Number.isFinite(row.roundTripSecondsSecondary))
      .map((row) => (row.roundTripSecondsSecondary as number) - row.roundTripSeconds);
    const flagged = summary.repeats.filter((row) => row.flaggedByAnchorCheck === true).length;
    const reasons = new Set(summary.repeats.map((row) => row.reason).filter((r): r is string => typeof r === "string"));
    const verdicts = new Set(summary.repeats.map((row) => row.verdict));
    const delays = [...new Set(summary.repeats.map((row) => ms(delayOf(row))))].sort((a, b) => a - b);
    calls += summary.repeats.length;
    misses += offByQuantum;
    console.log(
      `  ${runId} ${summary.rate} Hz capture=${summary.captureMode} opens=${summary.getUserMediaOpens}` +
      ` D=[${delays.join(",")}] ms calls=${summary.repeats.length}` +
      ` modal round trip (own delay removed)=${ms(mode).toFixed(4)} ms (${modeFrames} frames)` +
      ` on ${modeValues.length}/${summary.repeats.length}` +
      ` quantum=${(quantumSec * 1000).toFixed(4)} ms` +
      ` one-quantum misses=${offByQuantum} anchor-flagged=${flagged}` +
      ` secondary−primary=${Math.min(...secondaryDeltas).toExponential(2)}…${Math.max(...secondaryDeltas).toExponential(2)} s` +
      ` (max ${Math.max(...secondaryDeltas.map((d) => Math.abs(d) * summary.rate)).toFixed(5)} frames)` +
      ` verdicts={${[...verdicts].join(",")}} reasons={${reasons.size === 0 ? "none" : [...reasons].join(",")}}` +
      ` cell=${summary.cell.status}`
    );
  }
  console.log(`  running total: ${calls} calls, ${misses} one-quantum misses`);
}

const mode = process.argv[2] ?? "all";
if (mode === "runs" || mode === "all") printRuns();
if (mode === "noise" || mode === "all") printNoise();
if (mode === "chains" || mode === "all") printChains();
if (mode === "miss" || mode === "all") printMiss();
if (mode === "batches" || mode === "all") printBatches();
if (!["runs", "noise", "chains", "miss", "batches", "all"].includes(mode)) {
  throw new Error(`unknown mode ${mode} — expected runs | noise | chains | miss | batches | all`);
}
