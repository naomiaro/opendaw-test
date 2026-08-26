import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import { InstrumentFactories, type AutomatableParameterFieldAdapter } from "@opendaw/studio-adapters";
import type { Project } from "@opendaw/studio-core";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { TestStep, type TestStepRow } from "@/components/TestStep";
import { audioUnitAdapterFor } from "@/lib/adapterUtils";
import { SimplifierCanvas, LatchTrimStrip, type CurvePoint, type DeviationMarker } from "@/demos/automation/SimplifierDebugCanvases";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Heading, Text, Flex, Card, Callout, Badge, Button, Code,
} from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

// Repro for `debug/automation-simplifier-flattening.md`.
//
// A slow, smooth automation gesture recorded with the transport loop on comes
// back after the wrap as (very nearly) a straight line. Two independent
// mechanisms can produce that, and this page measures both in one run:
//
//   (A) `RecordAutomation.simplifyRecordedEvents` — the finalize-time thinning
//       pass. It is NOT Ramer–Douglas–Peucker: it walks the take once and drops
//       the middle point `b` of the last kept pair whenever `b` sits within
//       ε = 0.01 of the chord `a → incoming event`. Because `b` is always the
//       point ADJACENT to the chord's far end, the arc-to-chord error is
//       evaluated where it is smallest by construction (t → 1), so the chord
//       keeps growing and a smooth arc can collapse entirely — with a real
//       deviation many times ε.
//   (B) Latch overdub front-trim — after the wrap `RecordAutomation` opens a
//       NEW take for the same parameter holding the last value (latch: the
//       producer never lifts off), and `updateRegionDurations` grows that
//       region with the playhead even with zero further gestures. As it grows
//       past the previous pass's region, `RegionClipResolver.#trimStart`
//       front-trims the older region (`position += delta`,
//       `loopOffset = mod(loopOffset + delta, loopDuration)`), so what covers
//       the gesture's timeline range afterwards is the new pass's flat hold.
//       This one is by-design latch semantics, not a defect.
//
// Everything here is programmatic: `editing.modify(() => adapter.setUnitValue(v),
// false)` is exactly what a fader drag does, and `parameterFieldAdapters
// .subscribeWrites` cannot tell the difference — so no trusted gesture is
// needed beyond the Run click that resumes the AudioContext.

const BPM = 122;
const BAR = 3840; // PPQN, 4/4
const LOOP_PPQN = 8 * BAR; // transport loop: bars 0–8 (~15.7 s at 122 BPM)
const ARC_FROM = 2 * BAR; // gesture starts at bar 2
const ARC_TO = 4 * BAR; // …and ends at bar 4
const TAIL_TO = 5 * BAR; // pass 2: run this far past the wrap before stopping
const EPSILON = 0.01; // the SDK simplifier's advertised tolerance
// One pass is ~15.7 s and the run needs a pass and a bit — a run that has not
// settled in 90 s is hung, not slow.
const RUN_TIMEOUT_MS = 90_000;

type Outcome = "OK" | "HUNG" | "THREW";
type Verdict = "A" | "B" | "BOTH" | "NEITHER";

type RegionSnap = {
  key: string;
  position: number;
  duration: number;
  loopOffset: number;
  loopDuration: number;
  events: Array<[number, number]>; // [region-local position, unitValue]
};

type RegionHistory = {
  first: RegionSnap;
  prev: RegionSnap;
  last: RegionSnap;
  rawBeforeDrop: RegionSnap | null; // last state before the event count fell
  afterDrop: RegionSnap | null; // first state after it fell (i.e. simplified)
};

type Evidence = {
  verdict: Verdict;
  writes: Array<[number, number]>; // [absolute ppqn, unitValue] — every write the page injected
  arcRegion: RegionHistory | null;
  rawN: number;
  keptN: number;
  simplifierDeviation: number;
  deviationMarker: { position: number; rawValue: number; keptValue: number } | null;
  endToEndDeviation: number;
  uncoveredWrites: number;
  finalRegions: RegionSnap[];
  trimmed: boolean;
  note: string;
};

class HangError extends Error {
  constructor(readonly lastStage: string, timeoutMs: number) {
    super(`hung: no settle within ${timeoutMs / 1000}s (last stage: ${lastStage})`);
  }
}

/** Race a run against the hang ceiling; report the last stage reached on timeout. */
function raceHang<T>(promise: Promise<T>, stages: () => string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HangError(stages(), RUN_TIMEOUT_MS)), RUN_TIMEOUT_MS);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Linear read of a region's own (region-local) event list. */
function evalLocal(events: ReadonlyArray<[number, number]>, position: number): number {
  if (events.length === 0) return Number.NaN;
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  if (position <= sorted[0][0]) return sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    if (position <= sorted[i][0]) {
      const [pa, va] = sorted[i - 1];
      const [pb, vb] = sorted[i];
      return pb === pa ? vb : va + ((position - pa) / (pb - pa)) * (vb - va);
    }
  }
  return sorted[sorted.length - 1][1];
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "n/a";
}

function geometry(snap: RegionSnap): string {
  return `pos ${snap.position} · dur ${snap.duration} · loopOffset ${snap.loopOffset} · loopDuration ${snap.loopDuration}`;
}

type SimplifierCanvasData = {
  rawCurve: CurvePoint[];
  keptCurve: CurvePoint[];
  deviation: DeviationMarker | null;
};

type TrimStripData = {
  before: RegionSnap;
  after: RegionSnap;
  heldValue: number | null;
  axisMax: number;
  trimmed: boolean;
};

/** Derive the two canvases' draw props from an already-measured run — no new measurements. */
function buildCanvasData(evidence: Evidence): { simplifier: SimplifierCanvasData | null; trim: TrimStripData | null } {
  const arc = evidence.arcRegion;
  if (arc === null || arc.afterDrop === null) return { simplifier: null, trim: null };

  const rawCurve: CurvePoint[] = evidence.writes.map(([position, value]) => ({ x: position, y: value }));
  // Region-local → absolute: global = position - loopOffset + local (afterDrop precedes any front-trim).
  const regionBase = arc.afterDrop.position - arc.afterDrop.loopOffset;
  const keptCurve: CurvePoint[] = [...arc.afterDrop.events]
    .sort((a, b) => a[0] - b[0])
    .map(([position, value]) => ({ x: regionBase + position, y: value }));

  const deviation: DeviationMarker | null =
    evidence.deviationMarker === null
      ? null
      : {
          x: evidence.deviationMarker.position,
          rawY: evidence.deviationMarker.rawValue,
          keptY: evidence.deviationMarker.keptValue,
          label: `${fmt(evidence.simplifierDeviation)} (${(evidence.simplifierDeviation / EPSILON).toFixed(1)}× ε)`,
        };

  const before = arc.afterDrop;
  const after = arc.last;
  // The sibling region latch opened after the wrap — its own held value is the most direct
  // reading of what the eaten range now plays; fall back to this region's own tail otherwise.
  const holdRegion = evidence.finalRegions.find(r => r.key !== after.key) ?? null;
  const heldSource = holdRegion !== null && holdRegion.events.length > 0 ? holdRegion : after;
  const sortedHeld = [...heldSource.events].sort((a, b) => a[0] - b[0]);
  const heldValue = sortedHeld.length > 0 ? sortedHeld[sortedHeld.length - 1][1] : null;
  const axisMax = Math.max(before.position + before.duration, after.position + after.duration, 1);

  return {
    simplifier: { rawCurve, keptCurve, deviation },
    trim: { before, after, heldValue, axisMax, trimmed: evidence.trimmed },
  };
}

const SCENARIOS = [
  {
    index: 1,
    id: "arc",
    title: "Slow smooth arc, then hands off across the wrap",
    // A parabola: monotone, strongly curved, the friendliest input a thinning
    // pass could be handed. Its own sagitta against the chord is exactly 0.20.
    shape: (t: number) => 0.9 - 0.8 * t * t,
    description:
      "A gradual downward arc is written across bars 2–4, then nothing is touched again. " +
      "The transport wraps at bar 8 and runs on into a second pass.",
  },
  {
    index: 2,
    id: "jagged",
    title: "Fast zig-zag control, same protocol",
    // Eight direction changes across the same span: every turn breaks the
    // chord, so the greedy pass has to keep points.
    shape: (t: number) => 0.5 + 0.4 * Math.sin(2 * Math.PI * 8 * t),
    description:
      "The same span, same protocol, but a fast zig-zag. Direction changes break the " +
      "greedy chord, so this is the control: a gesture the same pass preserves.",
  },
] as const;

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [gotByStep, setGotByStep] = useState<Record<number, TestStepRow[]>>({});
  const [dumpByStep, setDumpByStep] = useState<Record<number, string>>({});
  const [evidenceByStep, setEvidenceByStep] = useState<Record<number, Evidence>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const laneRef = useRef<AutomatableParameterFieldAdapter<number> | null>(null);

  // --- Boot: one Tape unit, its `panning` parameter, an 8-bar transport loop ---

  useEffect(() => {
    let disposed = false;
    let bootProject: Project | null = null;
    (async () => {
      try {
        const { project: newProject, audioContext } = await initializeOpenDAW({
          localAudioBuffers: new Map<string, AudioBuffer>(),
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        bootProject = newProject;
        if (disposed) { newProject.terminate(); return; }
        audioCtxRef.current = audioContext;
        const unitBox = newProject.editing
          .modify(() => newProject.api.createInstrument(InstrumentFactories.Tape).audioUnitBox)
          .unwrap();
        // Separate transaction — same-transaction adapter traversal is stale.
        newProject.editing.modify(() => {
          const { loopArea } = newProject.timelineBox;
          loopArea.from.setValue(0);
          loopArea.to.setValue(LOOP_PPQN);
          loopArea.enabled.setValue(true);
        });
        newProject.engine.preferences.settings.recording.automationEnabled = true;
        laneRef.current = audioUnitAdapterFor(newProject, unitBox).namedParameter.panning;
        setProject(newProject);
        setStatus("Ready");
      } catch (error) {
        console.error("[automation-simplifier-debug] init failed: " + String(error));
        if (!disposed) setInitError(String(error));
        try {
          bootProject?.terminate();
        } catch (terminateError) {
          console.error("[automation-simplifier-debug] terminate threw: " + String(terminateError));
        }
      }
    })();
    return () => { disposed = true; };
  }, []);

  // --- The run --------------------------------------------------------------

  const runScenario = useCallback(
    async (shape: (t: number) => number, stage: (s: string) => void): Promise<Evidence> => {
      const p = project;
      const lane = laneRef.current;
      if (p === null || lane === null) throw new Error("not ready");
      const { engine } = p;

      const snapshot = (): RegionSnap[] => {
        const trackOption = lane.track;
        if (trackOption.isEmpty()) return [];
        const out: RegionSnap[] = [];
        for (const region of trackOption.unwrap().regions.adapters.values()) {
          if (!region.isValueRegion()) continue;
          const eventsOption = region.events;
          out.push({
            key: String(region.box.address),
            position: region.position,
            duration: region.duration,
            loopOffset: region.loopOffset,
            loopDuration: region.loopDuration,
            events: eventsOption.isEmpty()
              ? []
              : eventsOption.unwrap().asArray().map(e => [e.position, e.value] as [number, number]),
          });
        }
        return out;
      };

      stage("reset lane");
      const existing = lane.track;
      if (existing.nonEmpty()) {
        const doomed = [...existing.unwrap().regions.adapters.values()];
        p.editing.modify(() => doomed.forEach(region => region.box.delete()));
      }
      p.editing.modify(() => lane.setUnitValue(shape(0)), false);

      stage("resume context");
      const audioContext = audioCtxRef.current;
      if (audioContext !== null && audioContext.state !== "running") await audioContext.resume();

      stage("startRecording");
      p.startRecording(false);

      const writes: Array<[number, number]> = [];
      const history = new Map<string, RegionHistory>();
      let wrapped = false;
      let lastPosition = 0;

      stage("injecting");
      await new Promise<void>((resolve, reject) => {
        // A throw inside an AnimationFrame callback escapes into lib-dom's
        // shared queue (no try/catch there), so contain it here.
        const frame = AnimationFrame.add(() => {
          try {
            const position = engine.position.getValue();
            if (position < lastPosition) wrapped = true;
            lastPosition = position;
            if (!wrapped && position >= ARC_FROM && position <= ARC_TO) {
              const t = (position - ARC_FROM) / (ARC_TO - ARC_FROM);
              const value = shape(t);
              p.editing.modify(() => lane.setUnitValue(value), false);
              writes.push([Math.round(position), value]);
            }
            for (const snap of snapshot()) {
              const entry = history.get(snap.key);
              if (entry === undefined) {
                history.set(snap.key, { first: snap, prev: snap, last: snap, rawBeforeDrop: null, afterDrop: null });
                continue;
              }
              if (entry.afterDrop === null && snap.events.length < entry.prev.events.length) {
                entry.rawBeforeDrop = entry.prev;
                entry.afterDrop = snap;
              }
              entry.prev = snap;
              entry.last = snap;
            }
            if (wrapped && position >= TAIL_TO) {
              frame.terminate();
              resolve();
            }
          } catch (error) {
            frame.terminate();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });

      stage("stop");
      engine.stopRecording();
      engine.stop(true);
      // Let the finalize transaction commit before reading the box graph.
      await new Promise(r => setTimeout(r, 300));
      stage("measure");

      const finalRegions = snapshot();
      // The arc's own region is the one that captured the most raw events.
      let arcRegion: RegionHistory | null = null;
      for (const entry of history.values()) {
        const n = entry.rawBeforeDrop?.events.length ?? 0;
        if (arcRegion === null || n > (arcRegion.rawBeforeDrop?.events.length ?? 0)) arcRegion = entry;
      }

      // (A) How far the finalize-time thinning moved the curve, in the region's
      // own local coordinates — independent of any later trimming.
      let simplifierDeviation = Number.NaN;
      let deviationMarker: Evidence["deviationMarker"] = null;
      let rawN = 0;
      let keptN = 0;
      if (arcRegion?.rawBeforeDrop != null && arcRegion.afterDrop != null) {
        rawN = arcRegion.rawBeforeDrop.events.length;
        keptN = arcRegion.afterDrop.events.length;
        simplifierDeviation = 0;
        // Convert region-local positions to absolute ppqn so the marker lines
        // up with `writes` (already absolute) on the simplifier canvas.
        const regionBase = arcRegion.afterDrop.position - arcRegion.afterDrop.loopOffset;
        for (const [position, value] of arcRegion.rawBeforeDrop.events) {
          const kept = evalLocal(arcRegion.afterDrop.events, position);
          const deviation = Math.abs(value - kept);
          if (deviation > simplifierDeviation) {
            simplifierDeviation = deviation;
            deviationMarker = { position: regionBase + position, rawValue: value, keptValue: kept };
          }
        }
      }

      // End-to-end: what the finished automation now yields at the very
      // timeline positions the gesture was written at, read through the SDK's
      // own `valueAt` (global position in, unitValue out).
      let endToEndDeviation = 0;
      let uncoveredWrites = 0;
      const trackOption = lane.track;
      const liveRegions = trackOption.isEmpty()
        ? []
        : [...trackOption.unwrap().regions.adapters.values()].filter(r => r.isValueRegion());
      for (const [position, value] of writes) {
        const covering = liveRegions.find(r => position >= r.position && position < r.position + r.duration);
        if (covering === undefined) { uncoveredWrites++; continue; }
        const deviation = Math.abs(value - covering.valueAt(position, value));
        if (deviation > endToEndDeviation) endToEndDeviation = deviation;
      }

      // (B) Did a later pass front-trim the gesture's region out of its range?
      const trimmed =
        arcRegion !== null &&
        (arcRegion.last.position > arcRegion.first.position ||
          !finalRegions.some(r => r.key === arcRegion.last.key));

      // Any deviation several times ε is an ε violation — measured on BOTH
      // shapes here. What separates them is retention: the smooth arc keeps ~3 %
      // of its points (a straight line), the zig-zag ~85 % (a clipped curve).
      const collapsed = Number.isFinite(simplifierDeviation) && simplifierDeviation > EPSILON * 5;
      const verdict: Verdict = collapsed && trimmed ? "BOTH" : collapsed ? "A" : trimmed ? "B" : "NEITHER";
      const ratio = Number.isFinite(simplifierDeviation) ? (simplifierDeviation / EPSILON).toFixed(1) : "?";
      const retained = rawN > 0 ? `${((keptN / rawN) * 100).toFixed(0)} %` : "n/a";
      const note =
        verdict === "BOTH"
          ? `Thinning exceeded ε by ${ratio}× (${retained} of points retained) AND a later pass front-trimmed the region.`
          : verdict === "A"
            ? `Thinning exceeded ε by ${ratio}× (${retained} of points retained).`
            : verdict === "B"
              ? "Thinning stayed within ε; a later pass front-trimmed the region."
              : "Neither mechanism fired in this run.";

      return {
        verdict, writes, arcRegion, rawN, keptN,
        simplifierDeviation, deviationMarker, endToEndDeviation, uncoveredWrites, finalRegions, trimmed, note,
      };
    },
    [project],
  );

  const run = useCallback(
    (index: number, shape: (t: number) => number) => {
      if (project === null || running !== null) return;
      setRunning(index);
      setGotByStep(prev => { const next = { ...prev }; delete next[index]; return next; });
      setEvidenceByStep(prev => { const next = { ...prev }; delete next[index]; return next; });
      const stages: string[] = [];
      const stage = (s: string) => { stages.push(s); };
      const startedAt = performance.now();
      void (async () => {
        let rows: TestStepRow[];
        let dump = "";
        let evidenceResult: Evidence | null = null;
        try {
          const evidence = await raceHang(runScenario(shape, stage), () => stages[stages.length - 1] ?? "(none)");
          evidenceResult = evidence;
          const arc = evidence.arcRegion;
          rows = [
            { label: "outcome", value: "OK" as Outcome },
            { label: "verdict", value: `${evidence.verdict} — ${evidence.note}` },
            { label: "writes injected", value: String(evidence.writes.length) },
            {
              label: "events raw → kept",
              value: `${evidence.rawN} → ${evidence.keptN}` +
                (evidence.rawN > 0 ? ` (${((evidence.keptN / evidence.rawN) * 100).toFixed(0)} % retained)` : ""),
            },
            {
              label: "max deviation (simplifier)",
              value: `${fmt(evidence.simplifierDeviation)} unitValue` +
                (Number.isFinite(evidence.simplifierDeviation)
                  ? ` (${(evidence.simplifierDeviation / EPSILON).toFixed(1)}× ε)`
                  : ""),
            },
            { label: "max deviation (end to end)", value: `${fmt(evidence.endToEndDeviation)} unitValue` },
            { label: "gesture region at finalize", value: arc?.afterDrop ? geometry(arc.afterDrop) : "—" },
            { label: "gesture region at stop", value: arc ? geometry(arc.last) : "—" },
            { label: "writes no longer covered", value: `${evidence.uncoveredWrites} / ${evidence.writes.length}` },
            { label: "stages", value: stages.join(" → ") },
            { label: "elapsed", value: `${((performance.now() - startedAt) / 1000).toFixed(1)} s` },
          ];
          dump = evidence.finalRegions
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(r => `${geometry(r)}\n  events: ${r.events.map(([p, v]) => `${p}@${v.toFixed(4)}`).join("  ")}`)
            .join("\n\n");
        } catch (error) {
          console.error("[automation-simplifier-debug] run failed: " + String(error));
          rows = [
            { label: "outcome", value: (error instanceof HangError ? "HUNG" : "THREW") as Outcome },
            { label: "verdict", value: "—" },
            { label: "stages", value: stages.join(" → ") },
            { label: "elapsed", value: `${((performance.now() - startedAt) / 1000).toFixed(1)} s` },
            { label: "detail", value: String(error) },
          ];
        } finally {
          setRunning(null);
        }
        setGotByStep(prev => ({ ...prev, [index]: rows }));
        setDumpByStep(prev => ({ ...prev, [index]: dump }));
        setEvidenceByStep(prev => {
          if (evidenceResult === null) {
            const next = { ...prev };
            delete next[index];
            return next;
          }
          return { ...prev, [index]: evidenceResult };
        });
      })();
    },
    [project, running, runScenario],
  );

  const ready = project !== null && initError === null;

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar
          links={[
            { label: "Live automation recording demo", href: "/live-automation-recording-demo.html", kind: "demo" },
            {
              label: "debug/automation-simplifier-flattening.md",
              href: "https://github.com/naomiaro/opendaw-test/blob/main/debug/automation-simplifier-flattening.md",
              kind: "note",
            },
            {
              label: "Upstream issue: openDAW#363",
              href: "https://github.com/andremichelle/openDAW/issues/363",
              kind: "note",
            },
          ]}
        />

        <Flex direction="column" gap="4">
          <Heading size="7" align="center">Automation simplifier: smooth gestures flatten on finalize</Heading>

          <Callout.Root color="blue">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Two mechanisms turn a recorded curve into a straight line, and this page
              measures both in one run. <strong>(A)</strong>{" "}
              <Code>RecordAutomation.simplifyRecordedEvents</Code> drops the middle point of the
              last kept pair whenever it lies within <Code>ε = 0.01</Code> of the chord through
              its neighbours. The tested point is always the one ADJACENT to the chord's far
              end, where an arc's error against its chord is smallest by construction — so the
              chord keeps growing and the true deviation is unbounded by ε.{" "}
              <strong>(B)</strong> With the loop on, latch keeps the take open: the next pass
              opens a region holding the last value, and{" "}
              <Code>updateRegionDurations</Code> grows it with the playhead even with nobody
              touching anything, front-trimming the previous pass's region out of the way
              (<Code>RegionClipResolver.#trimStart</Code>). (B) is by-design latch semantics;
              (A) is the candidate defect.
            </Callout.Text>
          </Callout.Root>

          <Card>
            <Flex direction="column" gap="2">
              <Text size="2">
                <strong>Protocol</strong> (identical for both runs, ~26 s each): transport loop{" "}
                <Code>0 → {LOOP_PPQN}</Code> (8 bars at {BPM} BPM), record with no count-in,
                inject writes into the audio unit's <Code>panning</Code> parameter across bars
                2–4 through <Code>editing.modify(() =&gt; adapter.setUnitValue(v), false)</Code>{" "}
                — the same call a fader drag makes — then touch nothing, let the transport wrap
                and run to bar 5 of the next pass, and stop.
              </Text>
              <Text size="2" color="gray">
                Status: <Badge color={initError ? "red" : ready ? "green" : "amber"}>{initError ?? status}</Badge>
              </Text>
            </Flex>
          </Card>

          {SCENARIOS.map(scenario => (
            <React.Fragment key={scenario.id}>
              <TestStep
                index={scenario.index}
                title={scenario.title}
                description={scenario.description}
                actions={
                  <Button
                    onClick={() => run(scenario.index, scenario.shape)}
                    disabled={!ready || running !== null}
                    size="3"
                  >
                    <PlayIcon /> {running === scenario.index ? "Running…" : "Run"}
                  </Button>
                }
                expected={[
                  { label: "outcome", value: "OK" },
                  { label: "verdict", value: "NEITHER (a faithful ε = 0.01 pass, curve intact)" },
                  { label: "writes injected", value: "~200 (one per frame across two bars)" },
                  { label: "events raw → kept", value: "many → enough to hold the shape" },
                  { label: "max deviation (simplifier)", value: "≤ 0.0100 unitValue (1.0× ε)" },
                  { label: "max deviation (end to end)", value: "≤ 0.0100 unitValue" },
                  { label: "gesture region at finalize", value: "covers bars 2–4" },
                  { label: "gesture region at stop", value: "unchanged position" },
                  { label: "writes no longer covered", value: "0 / N" },
                  { label: "stages", value: "reset lane → resume context → startRecording → injecting → stop → measure" },
                  { label: "elapsed", value: "~26 s" },
                ]}
                got={gotByStep[scenario.index] ?? null}
              />
              {evidenceByStep[scenario.index] ? (() => {
                const canvasData = buildCanvasData(evidenceByStep[scenario.index]);
                return (
                  <>
                    {canvasData.simplifier ? (
                      <Card>
                        <Flex direction="column" gap="2">
                          <Text size="2" weight="bold">
                            A — simplifier collapse (step {scenario.index})
                          </Text>
                          <Text size="1" color="gray">
                            Faint line: every write injected. Solid amber: what survived the
                            finalize-time thinning pass — that polyline is what actually plays.
                            The tick marks the single largest gap between them.
                          </Text>
                          <SimplifierCanvas
                            rawCurve={canvasData.simplifier.rawCurve}
                            keptCurve={canvasData.simplifier.keptCurve}
                            epsilon={EPSILON}
                            deviation={canvasData.simplifier.deviation}
                          />
                        </Flex>
                      </Card>
                    ) : (
                      <Card>
                        <Flex direction="column" gap="2">
                          <Text size="2" weight="bold">
                            A — simplifier collapse (step {scenario.index})
                          </Text>
                          <Text size="2" color="amber">
                            No simplifier evidence captured for this run — no gesture region on
                            this lane ever had its event count drop, so there is nothing to
                            compare raw vs. kept.
                          </Text>
                        </Flex>
                      </Card>
                    )}
                    {canvasData.trim ? (
                      <Card>
                        <Flex direction="column" gap="2">
                          <Text size="2" weight="bold">
                            B — latch overdub front-trim (step {scenario.index})
                          </Text>
                          <Text size="1" color="gray">
                            Amber row: the gesture region's own extent right after the finalize-time
                            simplifier ran. Cyan row: the same region at Stop, after the next
                            hands-off pass grew over it — the hatched span is what it no longer
                            covers.
                          </Text>
                          <LatchTrimStrip
                            before={canvasData.trim.before}
                            after={canvasData.trim.after}
                            heldValue={canvasData.trim.heldValue}
                            axisMax={canvasData.trim.axisMax}
                            trimmed={canvasData.trim.trimmed}
                          />
                        </Flex>
                      </Card>
                    ) : (
                      <Card>
                        <Flex direction="column" gap="2">
                          <Text size="2" weight="bold">
                            B — latch overdub front-trim (step {scenario.index})
                          </Text>
                          <Text size="2" color="amber">
                            No trim evidence captured for this run — the finalize-time
                            thinning pass never dropped an event on this lane, so there is
                            no gesture-region history to compare before vs. after.
                          </Text>
                        </Flex>
                      </Card>
                    )}
                  </>
                );
              })() : null}
              {dumpByStep[scenario.index] ? (
                <Card>
                  <Flex direction="column" gap="2">
                    <Text size="2" weight="bold">Final regions on the lane (step {scenario.index})</Text>
                    <pre style={{ margin: 0, overflowX: "auto", fontSize: 11, lineHeight: 1.5 }}>
                      {dumpByStep[scenario.index]}
                    </pre>
                  </Flex>
                </Card>
              ) : null}
            </React.Fragment>
          ))}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
} else {
  console.error("[automation-simplifier-debug] #root is missing — nothing rendered");
}
