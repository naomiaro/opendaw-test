/**
 * Task 12c — the register's real-device calibration tables, recomputed offline.
 *
 * Reads the six `?input=real` envelopes (`.verify-output/calib-summary-*.json`,
 * `inputMode: "real"`) and recomputes every figure the register's "Real-device
 * calibration (2026-09-03)" section quotes FROM THE PER-CALL FIELDS — never from
 * the page's persisted `realSummary` or `repeatSummary`. The per-chain rules
 * (mode at frame resolution, the one half-quantum state rule) are imported from
 * `src/lib/audit/realInputSummary.ts` so the classifications here agree with the
 * page's by construction; the tables, the applied call's placement, the burst
 * detail of the two `noisy` calls and the cross-run page-load comparison are
 * this script's own.
 *
 * Run: `node scripts/audit/recording-alignment/task12c-real-input-tables.ts [mode]`
 * Modes: `runs` | `chains` | `events` | `all` (default).
 *  - `runs`   — per run and per chain: calls, verdicts, the modal round trip
 *               and input part, the within-chain spread, ratio range, bursts,
 *               the largest anchor disagreement, and where the applied call sat.
 *  - `chains` — the page-load table: every chain instance's mode at each rate
 *               and the pairwise differences in frames, ms and render quanta.
 *  - `events` — every call (repeats and the applied call) whose anchor A or B
 *               is at least half a quantum off its chain's mode, classified as
 *               `anchor-disagreement`, `state-transition` or `isolated`.
 */
import { modeAtFrameResolution, sameState } from "../../../src/lib/audit/realInputSummary.ts";
import { loadCalibrationSummary, type CalibrationCall, type LoadedCalibrationSummary } from "./artifacts.ts";

/** The six real-device runs, in run order. Declared, not globbed, like task12b's builds. */
const RUNS = ["1788463872683", "1788463933323", "1788464100870", "1788464254347", "1788464404625", "1788464591756"];

/** The SDK head the override build was served from for every run above. */
const SDK_HEAD = "9d0cccb88";

/** The page's `?repeat=` rows carry the chain they ran on; the applied call has none and runs on the last chain. */
type RealCall = CalibrationCall & { chainIndex?: number; burstDelays?: (number | null)[][]; outputLatencySeconds?: number; outputLatencyReported?: boolean };

/** One call in the order the run made it: the repeats, then the applied call (label `applied`). */
interface SequencedCall {
  label: string;
  /** 0-based position among the repeats, or null for the applied call. */
  index: number | null;
  chainIndex: number;
  call: RealCall;
}

const f3 = (x: number) => x.toFixed(3);
const usable = (call: RealCall) => Number.isFinite(call.roundTripSeconds) && Number.isFinite(call.inputLatencySeconds);
const framesOf = (seconds: number, rate: number) => seconds * rate;

function load(runId: string): LoadedCalibrationSummary {
  const summary = loadCalibrationSummary(runId);
  if (summary.inputMode !== "real") throw new Error(`calib-summary-${runId}.json is not a real-input envelope (inputMode ${summary.inputMode})`);
  if (summary.applied === null) throw new Error(`calib-summary-${runId}.json has no applied call`);
  return summary;
}

/** The repeats in order, then the applied call on the chain of the last repeat. */
function sequence(summary: LoadedCalibrationSummary): SequencedCall[] {
  const repeats = (summary.repeats as RealCall[]).map((call, index) => {
    if (typeof call.chainIndex !== "number") throw new Error(`run ${summary.runToken}: repeat ${index} carries no chainIndex`);
    return { label: String(index), index, chainIndex: call.chainIndex, call };
  });
  const lastChain = repeats.length === 0 ? 0 : repeats[repeats.length - 1].chainIndex;
  return [...repeats, { label: "applied", index: null, chainIndex: lastChain, call: summary.applied as RealCall }];
}

/** The chain's modal round trip over its usable REPEAT calls (the applied call is judged against it, not part of it). */
function chainMode(seq: SequencedCall[], chainIndex: number, rate: number): { value: number; count: number; population: number } {
  const values = seq.filter((c) => c.index !== null && c.chainIndex === chainIndex && usable(c.call)).map((c) => c.call.roundTripSeconds);
  if (values.length === 0) throw new Error(`chain ${chainIndex} has no usable repeat call`);
  const mode = modeAtFrameResolution(values, rate);
  return { ...mode, population: values.length };
}

function anchorsAgree(call: RealCall, rate: number): boolean {
  const b = call.roundTripSecondsSecondary;
  return b === undefined || !Number.isFinite(b) || sameState(b, call.roundTripSeconds, 128 / rate);
}

function printRuns(): void {
  console.log("=== Real-device calibration: per run, per chain ===");
  console.log(`SDK override ${SDK_HEAD}; every figure recomputed from the per-call fields. Frames are at the run's context rate;`);
  console.log("q = one 128-frame render quantum. \"mode\" is the modal round trip at frame resolution over the chain's usable");
  console.log("repeat calls; \"spread at mode\" is max − min over the calls within half a quantum of it, \"spread all\" over every");
  console.log("usable call of the chain. |A−B| is the two capture anchors' round-trip difference. The applied call is not in");
  console.log("the mode population; its offset from the mode is printed on its own.");
  let totalRepeats = 0;
  let totalApplied = 0;
  let ratioMin = Infinity;
  let ratioMax = -Infinity;
  let allThreeBursts = 0;
  let inputMinMs = Infinity;
  let inputMaxMs = -Infinity;
  const perRunInput = new Map<string, { minMs: number; maxMs: number; trackLatency: number | null }>();
  for (const runId of RUNS) {
    const summary = load(runId);
    const rate = summary.rate;
    const q = 128 / rate;
    const seq = sequence(summary);
    const repeats = seq.filter((c) => c.index !== null);
    const verdicts = new Map<string, number>();
    for (const c of repeats) verdicts.set(c.call.verdict, (verdicts.get(c.call.verdict) ?? 0) + 1);
    const reported = repeats.filter((c) => c.call.outputLatencyReported === true).length;
    const outputValues = [...new Set(repeats.map((c) => c.call.outputLatencySeconds))];
    const track = summary.trackSettings as Record<string, unknown> | null;
    const trackLatency = typeof track?.latency === "number" ? track.latency : null;
    const trackRate = typeof track?.sampleRate === "number" ? track.sampleRate : null;
    console.log(
      `\n-- ${runId} ${rate} Hz armState=${summary.armState} repeats=${repeats.length} label="${summary.runLabel}"` +
      ` device="${summary.device?.label}" deviceFallback=${String((summary as unknown as Record<string, unknown>).deviceFallback ?? "n/a (field predates the check)")}` +
      ` opens (arm count on builds before the counter)=${summary.getUserMediaOpens}`
    );
    console.log(
      `   verdicts ${[...verdicts.entries()].map(([k, v]) => `${k}×${v}`).join(", ")};` +
      ` outputLatency reported on ${reported}/${repeats.length} calls, value ${outputValues.map((v) => `${v}`).join("/")} s;` +
      ` track latency setting ${trackLatency === null ? "—" : `${trackLatency} s = ${f3(trackLatency * rate)} fr at ${rate} Hz`}` +
      ` (track sampleRate ${trackRate}, ${trackLatency === null || trackRate === null ? "—" : `${f3(trackLatency * trackRate)} fr at the track's own rate`});` +
      ` baseLatency ${(summary as unknown as { baseLatencySec?: number }).baseLatencySec ?? "—"} s`
    );
    const chains = [...new Set(repeats.map((c) => c.chainIndex))].sort((a, b) => a - b);
    for (const chainIndex of chains) {
      const own = repeats.filter((c) => c.chainIndex === chainIndex);
      const usableOwn = own.filter((c) => usable(c.call));
      const mode = chainMode(seq, chainIndex, rate);
      const modeFrames = framesOf(mode.value, rate);
      const rts = usableOwn.map((c) => framesOf(c.call.roundTripSeconds, rate));
      const atMode = usableOwn.filter((c) => sameState(c.call.roundTripSeconds, mode.value, q)).map((c) => framesOf(c.call.roundTripSeconds, rate));
      const inputs = usableOwn.map((c) => c.call.inputLatencySeconds * 1000);
      const inputMode = modeAtFrameResolution(usableOwn.map((c) => c.call.inputLatencySeconds), rate);
      // null on an `error` row (never usable, but the type says so): narrowed, not assumed.
      const ratios = usableOwn.map((c) => c.call.correlationRatioDb).filter((r): r is number => typeof r === "number");
      const threeOfThree = usableOwn.filter((c) => c.call.identifiedBursts === 3).length;
      const anchorDeltas = usableOwn
        .filter((c) => typeof c.call.roundTripSecondsSecondary === "number" && Number.isFinite(c.call.roundTripSecondsSecondary))
        .map((c) => ({ c, d: Math.abs(framesOf((c.call.roundTripSecondsSecondary as number) - c.call.roundTripSeconds, rate)) }));
      const agreeing = anchorDeltas.filter(({ c }) => anchorsAgree(c.call, rate));
      const disagreeing = anchorDeltas.filter(({ c }) => !anchorsAgree(c.call, rate));
      console.log(
        `   chain ${chainIndex}: calls=${own.length} usable=${usableOwn.length}` +
        ` mode=${f3(modeFrames)} fr = ${f3(mode.value * 1000)} ms on ${mode.count}/${mode.population}` +
        ` input part at mode=${f3(inputMode.value * 1000)} ms (range ${f3(Math.min(...inputs))}…${f3(Math.max(...inputs))} ms)` +
        ` spread at mode=${f3(Math.max(...atMode) - Math.min(...atMode))} fr (${atMode.length} calls)` +
        ` spread all=${f3(Math.max(...rts) - Math.min(...rts))} fr` +
        ` ratio=${ratios.length === 0 ? "—" : `${Math.min(...ratios).toFixed(1)}…${Math.max(...ratios).toFixed(1)} dB`}` +
        ` bursts 3/3 on ${threeOfThree}/${usableOwn.length}` +
        ` |A−B| max=${agreeing.length === 0 ? "—" : f3(Math.max(...agreeing.map(({ d }) => d)))} fr over ${agreeing.length} agreeing` +
        (disagreeing.length > 0 ? `, ${disagreeing.map(({ c, d }) => `${f3(d)} fr on index ${c.index}`).join(", ")} disagreeing` : "")
      );
      totalRepeats += own.length;
      ratioMin = Math.min(ratioMin, ...ratios);
      ratioMax = Math.max(ratioMax, ...ratios);
      allThreeBursts += threeOfThree;
      inputMinMs = Math.min(inputMinMs, ...inputs);
      inputMaxMs = Math.max(inputMaxMs, ...inputs);
    }
    const applied = seq[seq.length - 1];
    const appliedMode = chainMode(seq, applied.chainIndex, rate);
    const dA = framesOf(applied.call.roundTripSeconds - appliedMode.value, rate);
    const b = applied.call.roundTripSecondsSecondary;
    const dB = typeof b === "number" ? framesOf(b - appliedMode.value, rate) : NaN;
    const stored = (summary as unknown as { storedEntry: { inputLatency?: number } | null }).storedEntry;
    const appliedRatio = applied.call.correlationRatioDb;
    console.log(
      `   applied (chain ${applied.chainIndex}): verdict=${applied.call.verdict} round trip ${f3(framesOf(applied.call.roundTripSeconds, rate))} fr,` +
      ` A−mode=${f3(dA)} fr B−mode=${Number.isFinite(dB) ? f3(dB) : "—"} fr (${f3(dA / 128)} q), input part ${f3(applied.call.inputLatencySeconds * 1000)} ms,` +
      ` ratio ${appliedRatio === null ? "—" : appliedRatio.toFixed(1)} dB; stored entry inputLatency ${stored?.inputLatency === undefined ? "—" : `${f3(stored.inputLatency * 1000)} ms`}` +
      ` (${stored?.inputLatency === applied.call.inputLatencySeconds ? "equals the applied call" : "DIFFERS from the applied call"})`
    );
    totalApplied += 1;
    if (appliedRatio !== null) {
      ratioMin = Math.min(ratioMin, appliedRatio);
      ratioMax = Math.max(ratioMax, appliedRatio);
    }
    if (applied.call.identifiedBursts === 3) allThreeBursts += 1;
    inputMinMs = Math.min(inputMinMs, applied.call.inputLatencySeconds * 1000);
    inputMaxMs = Math.max(inputMaxMs, applied.call.inputLatencySeconds * 1000);
    // This run's own input-part range (repeats and applied), for the per-run
    // "minus reported" line below — each run is compared with ITS track's figure.
    const runInputs = [...repeats, applied].filter((c) => usable(c.call)).map((c) => c.call.inputLatencySeconds * 1000);
    perRunInput.set(runId, { minMs: Math.min(...runInputs), maxMs: Math.max(...runInputs), trackLatency });
  }
  console.log(
    `\n   totals: ${totalRepeats} repeat calls + ${totalApplied} applied calls; 3/3 bursts on ${allThreeBursts}/${totalRepeats + totalApplied};` +
    ` ratio ${ratioMin.toFixed(2)}…${ratioMax.toFixed(2)} dB; input part ${f3(inputMinMs)}…${f3(inputMaxMs)} ms`
  );
  console.log("   browser-reported track latency, per run, and this run's measured input part minus it:");
  for (const runId of RUNS) {
    const run = perRunInput.get(runId);
    if (run === undefined) continue;
    const minus = run.trackLatency === null
      ? "— (no track latency reported)"
      : `${f3(run.minMs - 1000 * run.trackLatency)}…${f3(run.maxMs - 1000 * run.trackLatency)} ms`;
    console.log(`     ${runId}: reported ${run.trackLatency === null ? "—" : `${run.trackLatency} s`} → ${minus}`);
  }
}

/** Every chain instance the runs contain: how it was built, and its mode. */
interface ChainInstance { runId: string; chainIndex: number; built: string; modeSec: number; inputMs: number; calls: number; label: string }

function chainInstances(rate: number): ChainInstance[] {
  const out: ChainInstance[] = [];
  for (const runId of RUNS) {
    const summary = load(runId);
    if (summary.rate !== rate) continue;
    const seq = sequence(summary);
    const chains = [...new Set(seq.filter((c) => c.index !== null).map((c) => c.chainIndex))].sort((a, b) => a - b);
    for (const chainIndex of chains) {
      const mode = chainMode(seq, chainIndex, rate);
      const inputs = seq.filter((c) => c.index !== null && c.chainIndex === chainIndex && usable(c.call)).map((c) => c.call.inputLatencySeconds);
      out.push({
        runId, chainIndex,
        built: chainIndex === 0 ? "arm at page load" : "disarm/re-arm mid-run",
        modeSec: mode.value,
        inputMs: modeAtFrameResolution(inputs, rate).value * 1000,
        calls: mode.population,
        label: summary.runLabel ?? "",
      });
    }
  }
  return out;
}

function printChains(): void {
  console.log("\n=== Page-load table: every chain instance's mode, and how far apart they sit ===");
  console.log("One page load = one arm = chain 0; a fresh run's chain 1 is the re-arm inside the same page. Differences are");
  console.log("later minus earlier in run order, in frames at the rate, ms, and render quanta; \"mod 128\" and \"mod 32\" are the");
  console.log("residues, so a difference on the quantum lattice, or on the loopback's 32-frame lattice, reads 0.");
  for (const rate of [48000, 44100]) {
    const q = 128 / rate;
    const chains = chainInstances(rate);
    console.log(`\n   ${rate} Hz — ${chains.length} chain instances`);
    for (const c of chains) {
      console.log(
        `     ${c.runId} chain ${c.chainIndex} (${c.built}, ${c.calls} calls): mode ${f3(framesOf(c.modeSec, rate))} fr = ${f3(c.modeSec * 1000)} ms,` +
        ` input part ${f3(c.inputMs)} ms  "${c.label}"`
      );
    }
    console.log("     pairwise (later − earlier):");
    for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i];
        const b = chains[j];
        const dSec = b.modeSec - a.modeSec;
        const dFrames = framesOf(dSec, rate);
        const residue = ((Math.round(dFrames) % 128) + 128) % 128;
        const residue32 = ((dFrames % 32) + 32) % 32;
        const same = a.runId === b.runId;
        console.log(
          `       ${b.runId}/${b.chainIndex} − ${a.runId}/${a.chainIndex}${same ? " (same page, re-arm)" : ""}:` +
          ` ${dFrames >= 0 ? "+" : ""}${f3(dFrames)} fr = ${dSec * 1000 >= 0 ? "+" : ""}${f3(dSec * 1000)} ms = ${dSec / q >= 0 ? "+" : ""}${(dSec / q).toFixed(2)} q, mod 128 = ${residue}, mod 32 = ${residue32.toFixed(2)}`
        );
      }
    }
  }
}

type EventClass = "anchor-disagreement" | "state-transition" | "isolated" | "unclassified";

function printEvents(): void {
  console.log("\n=== Event table: every call whose anchor A or B is ≥ ½ q off its chain's mode ===");
  console.log("Index is 0-based among the run's repeats (the register says \"index 10\" or \"call 11 (1-based)\"); \"applied\"");
  console.log("is the applied call, judged against the chain it ran on. Classes: anchor-disagreement = |A−B| ≥ ½ q (the SDK's");
  console.log("own detector); state-transition = A≈B and either the next call stays at the new value or the previous call was");
  console.log("already there (the call holds a state a transition opened; a last call with nothing after it is noted);");
  console.log("isolated = A≈B and the next call is back at the mode. Burst delays are anchor A's three bursts as frames off the");
  console.log("mode, then anchor B's (its first burst is always null: it opens in burst 1's tail).");
  let events = 0;
  let repeatCalls = 0;
  let disagreements = 0;
  let transitions = 0;
  let isolated = 0;
  for (const runId of RUNS) {
    const summary = load(runId);
    const rate = summary.rate;
    const q = 128 / rate;
    const seq = sequence(summary);
    repeatCalls += seq.length - 1;
    const modes = new Map<number, number>();
    for (const c of seq) if (!modes.has(c.chainIndex)) modes.set(c.chainIndex, chainMode(seq, c.chainIndex, rate).value);
    seq.forEach((c, k) => {
      if (!usable(c.call)) return;
      const mode = modes.get(c.chainIndex) as number;
      const a = c.call.roundTripSeconds;
      const b = c.call.roundTripSecondsSecondary;
      const bFinite = typeof b === "number" && Number.isFinite(b);
      const aOff = !sameState(a, mode, q);
      const bOff = bFinite && !sameState(b as number, mode, q);
      if (!aOff && !bOff) return;
      events += 1;
      const next = seq.slice(k + 1).find((n) => n.chainIndex === c.chainIndex && usable(n.call));
      const prev = seq.slice(0, k).reverse().find((p) => p.chainIndex === c.chainIndex && usable(p.call));
      let klass: EventClass;
      let note: string;
      const continues = prev !== undefined && anchorsAgree(prev.call, rate) && sameState(prev.call.roundTripSeconds, a, q);
      if (!anchorsAgree(c.call, rate)) {
        klass = "anchor-disagreement";
        disagreements += 1;
        note = `A ${aOff ? "off" : "at"} the mode, B ${bOff ? "off" : "at"} the mode`;
      } else if (continues) {
        klass = "state-transition";
        note = `holds the state the transition before it opened`;
      } else if (next === undefined) {
        klass = "state-transition";
        transitions += 1;
        note = "opens a new state on the last call of the chain — nothing after it to confirm the hold";
      } else if (sameState(next.call.roundTripSeconds, mode, q)) {
        klass = "isolated";
        isolated += 1;
        note = `next call (${next.label}) back at the mode`;
      } else if (sameState(next.call.roundTripSeconds, a, q)) {
        klass = "state-transition";
        transitions += 1;
        note = `opens a new state; next call (${next.label}) stays there`;
      } else {
        klass = "unclassified";
        note = `next call (${next.label}) at ${f3(framesOf(next.call.roundTripSeconds - mode, rate))} fr off the mode`;
      }
      const bursts = (c.call.burstDelays ?? []).map((anchor) =>
        anchor.map((d) => (d === null ? "null" : f3(framesOf(d - mode, rate)))).join("/"));
      const spreadFrames = c.call.spreadSeconds === null ? NaN : framesOf(c.call.spreadSeconds, rate);
      console.log(
        `   ${runId} ${rate} Hz chain ${c.chainIndex} index ${c.label}${c.index === null ? " (applied)" : ` (call ${c.index + 1} 1-based)`}:` +
        ` verdict=${c.call.verdict} reason=${c.call.reason ?? "—"}` +
        ` A−mode=${f3(framesOf(a - mode, rate))} fr B−mode=${bFinite ? f3(framesOf((b as number) - mode, rate)) : "—"} fr` +
        ` |A−B|=${bFinite ? f3(Math.abs(framesOf((b as number) - a, rate))) : "—"} fr` +
        ` spread=${Number.isFinite(spreadFrames) ? f3(spreadFrames) : "—"} fr ratio=${c.call.correlationRatioDb === null ? "—" : c.call.correlationRatioDb.toFixed(1)} dB bursts=${c.call.identifiedBursts}` +
        ` → ${klass}; ${note}; burst delays off mode: A [${bursts[0] ?? "—"}] B [${bursts[1] ?? "—"}]`
      );
    });
  }
  console.log(
    `\n   ${events} event calls over ${repeatCalls} repeat calls + ${RUNS.length} applied calls:` +
    ` ${disagreements} anchor disagreement(s), ${transitions} state transition(s), ${isolated} isolated deviation(s)`
  );
}

const mode = process.argv[2] ?? "all";
if (!["runs", "chains", "events", "all"].includes(mode)) {
  throw new Error(`unknown mode ${mode} — expected runs | chains | events | all`);
}
if (mode === "runs" || mode === "all") printRuns();
if (mode === "chains" || mode === "all") printChains();
if (mode === "events" || mode === "all") printEvents();
