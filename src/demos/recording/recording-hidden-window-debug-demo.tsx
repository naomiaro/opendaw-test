// Recording while the page is hidden — unlisted repro and standing check.
//
//   recording-hidden-window-debug-demo.html[?driver=window|hidden-safe][&interrupt=cover|modal][&hideAt=start|mid|stop][&hiddenSeconds=<n>][&rate=48000|44100][&bpm=<n>]
//   (the driver is this page's own `?driver=`; `?frameDriver=` is not read here)
//
// One Tape records the recording harness's synthetic loopback (a click per beat scheduled on
// the audio clock) for eight bars. At the chosen moment the page is interrupted: `cover` asks
// for the page to be hidden by a hand (another tab in front, or another app's window fully
// over it) and waits until it is, measuring the real visibilitychange and its frame gaps —
// nothing the page can do hides itself: a second tab or a popup of its own, even one larger
// than its window, left Chrome reporting it visible — and `modal` opens the page's own
// alert(), which blocks the main thread outright. After Stop the take is read with the harness's reader and judged;
// a second, uninterrupted take then shows whether the session still records. The frame driver
// is the before/after: `window` is the SDK's own animation frame and the demos' default,
// `hidden-safe` the opt-in worker tick while the page is hidden and the transport active. Register:
// debug/2026-10-21-hidden-page-recording/note.md. DOM contract: #audit-state carries
// data-audit-state walking setup → recording:take1 → waiting:hide → hidden → visible →
// stopping → finalizing → recording:take2 → done | error:<message> (a `modal` run has no
// waiting:hide, and its hidden → visible sit around the alert, after `stopping` for `stop`);
// data-hide-now flips to "1" while the page asks to be hidden.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Callout, Card, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";
import { CaptureAudio, type Project } from "@opendaw/studio-core";
import { InstrumentFactories, type AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { GitHubCorner } from "@/components/GitHubCorner";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { createWorkerTicker } from "@/lib/workerTicker";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID } from "@/lib/audit/loopbackInjection";
import { bandSplit, buildReferenceSchedule, measureTakeAlignment, type ReferenceSchedule } from "@/lib/audit/recordingAlignment";
import { detectOnsets } from "@/lib/audit/onsetDetection";
import {
  FINALIZE_DEADLINE_MS, readFirstQuantumTimeSec, resetForNextCell, resolveHarnessPathBias, STOP_LEAD_PPQN, waitForLoaderTerminal,
  waitForPosition, waitForPositionSettled, waitForTakeCount, type HarnessPathBias,
} from "@/lib/audit/recordingCellRunner";
import { ALIGNED_TOLERANCE_MS } from "@/lib/audit/recordingAuditCalibration";
import { FrameWatch } from "@/lib/audit/midiInputCellRunner";
import { BAR_PPQN } from "@/lib/audit/auditExpectations";
import { assertNoStoredRoundTrip } from "@/lib/audit/storedRoundTrips";
import { classifyRow, classifyTake, frameBlockedMs, positionFrozenMs, syncResumeMs, type PositionSample, type TakeFigures } from "@/lib/audit/hiddenRecordingVerdict";
import {
  HIDDEN_RECORDING_SCHEMA_VERSION, summaryFileName, type HiddenRecordingDriver, type HiddenRecordingHideAt, type HiddenRecordingInterrupt,
  type HiddenRecordingRow, type HiddenRecordingSummary, type HiddenRecordingTakeRecord,
} from "@/lib/audit/hiddenRecordingArtifacts";

const TAKE_BARS = 8;
const HIDE_AT_PPQN = BAR_PPQN;
const SAMPLE_INTERVAL_MS = 100;
/** How long a `cover` run waits for the hand before the start or stop moment goes ahead unhidden. */
const HIDE_WAIT_DEADLINE_MS = 120_000;
const REGISTER_URL = "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-hidden-page-recording/note.md";

interface Params {
  driver: HiddenRecordingDriver;
  interrupt: HiddenRecordingInterrupt;
  hideAt: HiddenRecordingHideAt;
  hiddenSeconds: number;
  rate: number;
  bpm: number;
}

function oneOf<T extends string>(name: string, value: string | null, allowed: readonly T[], fallback: T): T {
  if (value === null) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`invalid ?${name}= "${value}" — ${allowed.join("|")}`);
}

function positive(name: string, value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid ?${name}= "${value}"`);
  return n;
}

function resolveParams(search: string): Params {
  const p = new URLSearchParams(search);
  return {
    driver: oneOf("driver", p.get("driver"), ["window", "hidden-safe"] as const, "hidden-safe"),
    interrupt: oneOf("interrupt", p.get("interrupt"), ["cover", "modal"] as const, "cover"),
    hideAt: oneOf("hideAt", p.get("hideAt"), ["start", "mid", "stop"] as const, "mid"),
    hiddenSeconds: positive("hiddenSeconds", p.get("hiddenSeconds"), 5),
    rate: oneOf("rate", p.get("rate"), ["48000", "44100"] as const, "48000") === "44100" ? 44100 : 48000,
    bpm: positive("bpm", p.get("bpm"), 120),
  };
}

let PARAMS: Params | null = null;
let PARAM_ERROR: string | null = null;
try {
  PARAMS = resolveParams(window.location.search);
} catch (error) {
  PARAM_ERROR = error instanceof Error ? error.message : String(error);
}

const loopback = installLoopbackCapture(1);

interface Context {
  project: Project;
  audioContext: AudioContext;
  unitAdapter: AudioUnitBoxAdapter;
  bias: HarnessPathBias;
}

async function createContext(params: Params): Promise<Context> {
  const { project, audioContext } = await initializeOpenDAW({
    bpm: params.bpm,
    audioContextSampleRate: params.rate,
    frameDriver: params.driver,
    engineTap: (node) => loopback.engineTap(node),
  });
  loopback.attach(audioContext);
  const bias = await resolveHarnessPathBias(audioContext);
  const audioUnitBox: AudioUnitBox = project.editing
    .modify(() => project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox)
    .unwrap("createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap("no capture for the tape");
  if (!(capture instanceof CaptureAudio)) throw new Error("capture is not CaptureAudio");
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  // As the harness: the metronome's clicks ARE the beat grid the reader matches in the low band.
  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;
  settings.recording.allowTakes = true;
  settings.recording.olderTakeAction = "mute-region";
  settings.recording.inputLatency = 0;
  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters().find((u) => u.box === audioUnitBox);
  if (unitAdapter === undefined) throw new Error("no audio unit adapter for the tape");
  return { project, audioContext, unitAdapter, bias };
}

let contextPromise: Promise<Context> | null = null;
function getContext(params: Params): Promise<Context> {
  contextPromise ??= createContext(params);
  return contextPromise;
}

interface TakeOutcome {
  record: HiddenRecordingTakeRecord;
  figures: TakeFigures;
  hiddenAtMs: number | null;
  visibleAtMs: number | null;
  frameGapMaxMs: number | null;
  samples: PositionSample[];
  started: boolean;
}

interface TakeOptions {
  ctx: Context;
  params: Params;
  label: "take1" | "take2";
  interrupt: boolean;
  /** Called once the take's record request is about to go out, so a take that then fails is not "never started". */
  onStarted?: () => void;
  setState: (s: string) => void;
  setHideNow: (on: boolean) => void;
}

async function runTake({ ctx, params, label, interrupt, setState, setHideNow, onStarted }: TakeOptions): Promise<TakeOutcome> {
  const { project, audioContext, unitAdapter, bias } = ctx;
  const engine = project.engine;
  const samples: PositionSample[] = [];
  const t0 = performance.now();
  let hiddenAtMs: number | null = null;
  let visibleAtMs: number | null = null;
  const onVisibility = (): void => {
    const at = performance.now() - t0;
    if (document.visibilityState === "hidden") {
      if (hiddenAtMs === null) { hiddenAtMs = at; setState("hidden"); }
    } else if (hiddenAtMs !== null && visibleAtMs === null) {
      visibleAtMs = at;
      setHideNow(false);
      setState("visible");
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (document.visibilityState === "hidden") hiddenAtMs = 0;
  const sampler = createWorkerTicker(SAMPLE_INTERVAL_MS);
  const samplerSub = sampler.subscribe(() => {
    samples.push({ atMs: performance.now() - t0, positionPpqn: engine.position.getValue(), recording: engine.isRecording.getValue() });
  });
  // `modal`: the page's own alert at the moment. `cover`: the page asks to be hidden and WAITS
  // until it is (a hide within a frame of a request is not something a person can do): before
  // the record request, at bar 1 with the take running, or a bar before the stop request.
  const doInterrupt = async (): Promise<void> => {
    if (!interrupt) return;
    if (params.interrupt === "modal") {
      setState("hidden");
      const before = performance.now() - t0;
      window.alert(`Recording — dismiss this after about ${params.hiddenSeconds} seconds`);
      hiddenAtMs = before;
      visibleAtMs = performance.now() - t0;
      setState("visible");
      return;
    }
    setState("waiting:hide");
    setHideNow(true);
    // A hide that already happened since the take started counts: the hand may be early.
    const deadline = performance.now() + HIDE_WAIT_DEADLINE_MS;
    while (hiddenAtMs === null && document.visibilityState !== "hidden" && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const figures: TakeFigures = {
    appeared: false, finalized: false, finalizeMs: null, regionDurationSec: null,
    expectedDurationSec: project.tempoMap.intervalToSeconds(0, TAKE_BARS * BAR_PPQN - STOP_LEAD_PPQN),
    beatsMatched: 0, beatsMissing: 0, medianBeatErrorMs: null, alignedToleranceMs: ALIGNED_TOLERANCE_MS, finalizeReason: null,
  };
  let started = false;
  let schedule: ReferenceSchedule | null = null;
  let recordRequestContextTime: number | null = null;
  let stopRequestContextTime: number | null = null;
  try {
    setState(`recording:${label}`);
    engine.setPosition(0);
    await waitForPositionSettled(project, 0, 30_000);
    started = true;
    onStarted?.();
    // The hide wait comes first for a `start` cover: the reference clicks that anchor the buffer run
    // about a minute, and a hand that takes longer than that would leave the take without an anchor.
    if (params.hideAt === "start" && params.interrupt === "cover") await doInterrupt();
    assertNoStoredRoundTrip();
    schedule = buildReferenceSchedule(audioContext.currentTime + 0.2, 120, 0.25, 0.005);
    loopback.scheduleReferenceClicks(schedule.times);
    recordRequestContextTime = audioContext.currentTime;
    project.startRecording(false);
    if (params.hideAt === "start" && params.interrupt === "modal") await doInterrupt();
    if (params.hideAt === "mid") {
      await waitForPosition(project, HIDE_AT_PPQN, 20_000);
      await doInterrupt();
    }
    if (params.hideAt === "stop" && params.interrupt === "cover") {
      await waitForPosition(project, (TAKE_BARS - 1) * BAR_PPQN, 90_000);
      await doInterrupt();
    }
    await waitForPosition(project, TAKE_BARS * BAR_PPQN - STOP_LEAD_PPQN, 90_000);
    setState("stopping");
    const takeBeforeStop = unitAdapter.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion())[0];
    stopRequestContextTime = audioContext.currentTime;
    const stopAt = performance.now();
    engine.stopRecording();
    if (params.hideAt === "stop" && params.interrupt === "modal") await doInterrupt();

    setState("finalizing");
    let take = takeBeforeStop;
    if (take === undefined) {
      try {
        await waitForTakeCount([unitAdapter], 1, FINALIZE_DEADLINE_MS);
      } catch {
        // no take appeared: judged below
      }
      take = unitAdapter.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion())[0];
    }
    if (take === undefined) return { record: finish(), figures, hiddenAtMs, visibleAtMs, frameGapMaxMs: null, samples, started };
    figures.appeared = true;
    const loader = take.file.getOrCreateLoader();
    try {
      await waitForLoaderTerminal(loader, FINALIZE_DEADLINE_MS, `${label} finalization`);
      figures.finalized = loader.state.type === "loaded";
      figures.finalizeMs = performance.now() - stopAt;
    } catch (error) {
      figures.finalized = false;
      figures.finalizeReason = error instanceof Error ? error.message : String(error);
    }
    if (!figures.finalized) return { record: finish(), figures, hiddenAtMs, visibleAtMs, frameGapMaxMs: null, samples, started };
    const dataOpt = loader.data;
    if (dataOpt.isEmpty()) return { record: finish(), figures, hiddenAtMs, visibleAtMs, frameGapMaxMs: null, samples, started };
    const data = dataOpt.unwrap();
    const mono = data.frames[0];
    const { low, high } = bandSplit(mono, data.sampleRate);
    const lowOnsets = detectOnsets(low, data.sampleRate, { refractorySec: 0.1 });
    const highOnsets = detectOnsets(high, data.sampleRate, { refractorySec: 0.05 });
    const region = unitAdapter.tracks.values().flatMap((t) => [...t.regions.adapters.values()]).filter((r) => r.isAudioRegion())[0];
    const regionStartSec = project.tempoMap.ppqnToSeconds(region.position);
    const regionDurationSec = project.tempoMap.intervalToSeconds(region.position, region.position + region.duration);
    const alignment = measureTakeAlignment({
      lowOnsets, highOnsets, regionStartSec,
      waveformOffsetSec: region.box.waveformOffset.getValue(),
      regionDurationSec,
      bufferDurationSec: data.numberOfFrames / data.sampleRate,
      bpm: params.bpm, schedule, recordRequestContextTime, stopRequestContextTime,
      harnessPathBiasSec: bias.valueSec,
    });
    // The harness's release profile: the judged median is the adjusted one minus the loopback path's
    // own delay for this take (the first-quantum time the recorder reports minus the clicks' anchor).
    const firstQuantumTimeSec = readFirstQuantumTimeSec(loader);
    const loopbackDelayMs = typeof firstQuantumTimeSec === "number" && alignment.anchorT0Sec !== null
      ? (firstQuantumTimeSec - alignment.anchorT0Sec) * 1000 : null;
    figures.regionDurationSec = regionDurationSec;
    figures.beatsMatched = alignment.matchedBeats;
    figures.beatsMissing = alignment.missingBeats;
    figures.medianBeatErrorMs = loopbackDelayMs !== null && alignment.medianBeatErrorMsAdjusted !== null
      ? alignment.medianBeatErrorMsAdjusted - loopbackDelayMs : alignment.medianBeatErrorMsAdjusted;
    return { record: finish(), figures, hiddenAtMs, visibleAtMs, frameGapMaxMs: null, samples, started };
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
    samplerSub.terminate();
    sampler.terminate();
    setHideNow(false);
  }

  function finish(): HiddenRecordingTakeRecord {
    const c = classifyTake(figures);
    return { ...figures, verdict: c.verdict, detail: c.detail };
  }
}

async function runAudit(params: Params, setState: (s: string) => void, setHideNow: (on: boolean) => void, onRow: (row: HiddenRecordingRow) => void): Promise<void> {
  setState("setup");
  const ctx = await getContext(params);
  const runToken = Date.now();
  // A second click on Run must not judge the previous run's region.
  const preWarning = await resetForNextCell(ctx.project, loopback, ctx.unitAdapter);
  const frames1 = new FrameWatch();
  frames1.start();
  let take1: TakeOutcome;
  try {
    take1 = await runTake({ ctx, params, label: "take1", interrupt: true, setState, setHideNow });
  } catch (error) {
    frames1.stop();
    throw new Error(`take 1: ${error instanceof Error ? error.message : String(error)}`);
  }
  const gaps1 = frames1.stop();
  const cleanupWarning = await resetForNextCell(ctx.project, loopback, ctx.unitAdapter);
  let take2: TakeOutcome | null = null;
  let take2Error: string | null = null;
  let take2Started = false;
  try {
    take2 = await runTake({ ctx, params, label: "take2", interrupt: false, setState, setHideNow, onStarted: () => { take2Started = true; } });
  } catch (error) {
    take2Error = `take 2: ${error instanceof Error ? error.message : String(error)}`;
  }
  const verdicts = classifyRow({
    interrupt: params.interrupt, hiddenSpanMs: take1.hiddenAtMs !== null && take1.visibleAtMs !== null ? take1.visibleAtMs - take1.hiddenAtMs : null,
    take1: take1.figures, take2: take2?.figures ?? null, take2Started,
  });
  const row: HiddenRecordingRow = {
    driver: params.driver, interrupt: params.interrupt, hideAt: params.hideAt, hiddenSeconds: params.hiddenSeconds,
    hiddenAtMs: take1.hiddenAtMs, visibleAtMs: take1.visibleAtMs,
    hiddenSpanMs: take1.hiddenAtMs !== null && take1.visibleAtMs !== null ? take1.visibleAtMs - take1.hiddenAtMs : null,
    frameGapMaxMs: frameBlockedMs(gaps1),
    positionFrozenMs: positionFrozenMs(take1.samples),
    syncResumeMs: take1.visibleAtMs === null ? null : syncResumeMs(take1.samples, take1.visibleAtMs),
    take1: { ...take1.record, verdict: verdicts.take1 },
    take2: take2 === null ? null : { ...take2.record, verdict: verdicts.take2 ?? take2.record.verdict },
    take2Started,
    samples: take1.samples,
    error: [preWarning, cleanupWarning, take2Error].filter((e): e is string => e !== null).join("; ") || null,
  };
  onRow(row);
  const summary: HiddenRecordingSummary = {
    schemaVersion: HIDDEN_RECORDING_SCHEMA_VERSION, runToken, userAgent: navigator.userAgent, sdkVersion: OPENDAW_SDK_VERSION,
    sampleRate: ctx.audioContext.sampleRate, bpm: params.bpm, rows: [row],
  };
  await withDeadline(
    (async () => {
      const res = await fetch(`/__verify/${summaryFileName(runToken)}`, { method: "PUT", body: JSON.stringify(summary, null, 2) });
      if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
    })(),
    30_000,
    "summary upload",
  );
  console.log(`[hidden-recording] summary ${summaryFileName(runToken)} uploaded: take1 ${row.take1.verdict}, take2 ${row.take2?.verdict ?? "—"}`);
}

const ms = (v: number | null): string => (v === null ? "—" : v.toFixed(1));

function App() {
  const [state, setState] = useState(PARAM_ERROR === null ? "idle" : `error:${PARAM_ERROR}`);
  const [hideNow, setHideNow] = useState(false);
  const [running, setRunning] = useState(false);
  const [row, setRow] = useState<HiddenRecordingRow | null>(null);

  const handleRun = useCallback(() => {
    if (PARAMS === null || running) return;
    setRunning(true);
    setRow(null);
    runAudit(PARAMS, setState, setHideNow, setRow)
      .then(() => setState("done"))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[hidden-recording] run error: " + message);
        setState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const p = PARAMS;
  const takeCells = (t: HiddenRecordingTakeRecord | null) => t === null ? <Table.Cell colSpan={5}>—</Table.Cell> : (
    <>
      <Table.Cell><Badge color={t.verdict === "intact" ? "green" : t.verdict === "not-hidden" ? "gray" : "red"}>{t.verdict}</Badge></Table.Cell>
      <Table.Cell>{t.finalizeMs === null ? "—" : `${t.finalizeMs.toFixed(0)} ms`}</Table.Cell>
      <Table.Cell>{t.regionDurationSec === null ? "—" : `${t.regionDurationSec.toFixed(3)} / ${t.expectedDurationSec.toFixed(3)} s`}</Table.Cell>
      <Table.Cell>{t.beatsMatched} / {t.beatsMatched + t.beatsMissing}{t.medianBeatErrorMs === null ? "" : `, median ${t.medianBeatErrorMs.toFixed(2)} ms`}</Table.Cell>
      <Table.Cell>{t.detail}</Table.Cell>
    </>
  );

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <DebugLinkBar links={[
          { label: "debug/2026-10-21-hidden-page-recording/note.md", href: REGISTER_URL, kind: "note" },
          { label: "openDAW#290", href: "https://github.com/andremichelle/openDAW/issues/290", kind: "note" },
        ]} />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">Recording While the Page Is Hidden</Heading>
          <Text size="2" color="gray" align="center">
            One Tape records the loopback's click per beat for eight bars; the page is interrupted at the chosen moment, then a
            second take runs uninterrupted. Driver <code>{p?.driver}</code>, interrupt <code>{p?.interrupt}</code> at <code>{p?.hideAt}</code>,
            about {p?.hiddenSeconds} s, {p?.rate} Hz, {p?.bpm} bpm.
          </Text>
          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">State:</Text>
              <Badge id="audit-state" data-audit-state={state} data-hide-now={hideNow ? "1" : "0"} color={state.startsWith("error") ? "red" : state === "done" ? "green" : "amber"}>{state}</Badge>
              <Button onClick={handleRun} disabled={PARAMS === null || running}><PlayIcon /> Run</Button>
            </Flex>
          </Card>
          {hideNow && (
            <Callout.Root color="amber" size="3">
              <Callout.Icon><InfoCircledIcon /></Callout.Icon>
              <Callout.Text>
                <strong>Hide this page now for about {p?.hiddenSeconds} seconds</strong> — switch to another tab, or put another app's window over it — then come back.
              </Callout.Text>
            </Callout.Root>
          )}
          {row !== null && (
            <Card>
              <Table.Root size="1" variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>take</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>verdict</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>finalized in</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>region / expected</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>beats matched / sent</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>detail</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row><Table.Cell>1 (interrupted)</Table.Cell>{takeCells(row.take1)}</Table.Row>
                  <Table.Row><Table.Cell>2 (control)</Table.Cell>{takeCells(row.take2)}</Table.Row>
                </Table.Body>
              </Table.Root>
              <Text size="1" color="gray">
                hidden span {ms(row.hiddenSpanMs)} ms · longest frame gap {ms(row.frameGapMaxMs)} ms · position frozen {ms(row.positionFrozenMs)} ms ·
                sync resumed {ms(row.syncResumeMs)} ms after visible · take 2 started: {row.take2Started ? "yes" : "no"}
                {row.error === null ? "" : ` · ${row.error}`}
              </Text>
            </Card>
          )}
          <Card>
            <Text size="1" color="gray" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
{`?driver=window|hidden-safe   the SDK's own animation frame (the demos' default), or the opt-in worker tick while hidden and the transport active
?interrupt=cover|modal       hidden by another tab or window (measured on visibilitychange), or the page's own alert() (blocks the main thread)
?hideAt=start|mid|stop       cover: before the record request, at bar 1, or a bar before the stop request, the page waiting for your hide; modal: right after the record request, at bar 1, or right after the stop request
?hiddenSeconds=<n>           what the prompt asks for (default 5); the page measures the actual span
Verdicts: intact | not-finalized | audio-damaged | session-stuck (take 2 never started) | not-hidden (a cover run that never hid: judged nothing)`}
            </Text>
          </Card>
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
