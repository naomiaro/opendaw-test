// MIDI Effect Placement Audit — unlisted page.
//
//   midi-effect-placement-audit-debug-demo.html[?rate=48000|44100][&bpm=<n>][&device=all|pitch|velocity|note-filter|arpeggio|zeitgeist|spielwerk][&sampleMs=<n>][&importMs=<n>]
//
// One Nano sampler plays a 20 ms burst on a note pattern. The pattern is rendered offline dry,
// then through each stock MIDI effect (and each effect disabled), and every row is read against
// what the device's own rule predicts: a pass-through device against the dry render by
// cross-correlation, a device meant to move notes (Arpeggio, Zeitgeist, a Spielwerk echo) by its
// onsets against the frames the rule names. A live key enters the same event chain as a region
// note, so one render covers the heard path of live playing too (the recorder reads the capture's
// raw note signals before the chain; the sweep's `&effect=` arm shows that). Register and
// reading recipe: debug/2026-10-21-midi-effect-placement/note.md. DOM contract: #audit-state
// carries data-audit-state walking setup → running:<row> → done | error:<message>; a row that
// failed on its own is a red row under `done`, a failure that voids the later rows (a device that
// could not be removed) ends the run in `error:`. `?sampleMs=` sets the loaded sample's length
// (a loader that refuses it, as the SDK's did for 1200 frames or fewer before openDAW#494 was fixed, reads
// `error:sample load failed: …`);
// `?importMs=` first runs a synthetic recording of that length through the sample service's
// recording import and reports it in the status line, `error:` when it fails.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { AudioData, type ppqn } from "@opendaw/lib-dsp";
import { EffectFactories, type EffectBox, type Project } from "@opendaw/studio-core";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import {
  ArpeggioDeviceBox, NoteFilterDeviceBox, PitchDeviceBox, SpielwerkDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox, type NoteEventBox,
} from "@opendaw/studio-boxes";
import { ScriptCompiler, ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TestStep, type TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { withDeadline } from "@/lib/deadline";
import {
  ARPEGGIO_RATE_INDEX, ARPEGGIO_RATE_PPQN, burstSample, DRY_PATTERN, ECHO_DELAY_PPQN, ECHO_REPEATS, expectedOnsetCount,
  MAX_LAG_FRAMES, NANO_ATTACK_SECONDS, NANO_RELEASE_SECONDS, NOTE_PITCH, ONSET_SKIP_MS, ONSET_THRESHOLD, REGION_DURATION_PPQN,
  REGION_POSITION_PPQN, renderSeconds, resolveBpm, resolveDevices, resolveImportMs, resolveRate, resolveSampleMs, RULE_TOLERANCE_FRAMES, SCORE_FLOOR,
  ZEITGEIST_AMOUNT, ZEITGEIST_DURATION_PPQN, type MidiEffectDevice, type MidiEffectScenario, type PatternNote, type RenderRate,
} from "@/lib/audit/midiEffectScenarios";
import { arpeggioSteps, echoCopies, expectedFrames, instrumentOffsetFrames, zeitgeistWarped } from "@/lib/audit/midiEffectRules";
import { judgePassThrough, judgeRule, onsetsOf, peakOf, type RowVerdict } from "@/lib/audit/midiEffectPlacement";
import { zeitgeistGrooveBox, removeMidiEffect } from "@/lib/audit/midiEffectChain";
import { buildNanoProject, RunAbort, uploadSummary, type NanoProject } from "@/lib/audit/midiEffectBootstrap";
import { MIDI_EFFECT_SCHEMA_VERSION, summaryFileName, type MidiEffectRowRecord, type MidiEffectSummary } from "@/lib/audit/midiEffectArtifacts";
import "@radix-ui/themes/styles.css";
import { Badge, Button, Callout, Card, Code, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

const params = new URLSearchParams(window.location.search);
let PARAM_ERROR: string | null = null;
let RATE: RenderRate = 48000;
let BPM = 120;
let SCENARIOS: MidiEffectScenario[] = [];
let SAMPLE_MS = 1000;
let IMPORT_MS: number | null = null;
try {
  RATE = resolveRate(params.get("rate"));
  BPM = resolveBpm(params.get("bpm"));
  SCENARIOS = resolveDevices(params.get("device"));
  SAMPLE_MS = resolveSampleMs(params.get("sampleMs"));
  IMPORT_MS = resolveImportMs(params.get("importMs"));
} catch (error) {
  PARAM_ERROR = error instanceof Error ? error.message : String(error);
}
const DEVICE_PARAM = params.get("device") ?? "all";

const REGISTER_URL = "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-21-midi-effect-placement/note.md";
const DRY_ABSOLUTE = DRY_PATTERN.map((note) => REGION_POSITION_PPQN + note.position);
const SPIELWERK_COMPILER = ScriptCompiler.create({ headerTag: "spielwerk", registryName: "spielwerkProcessors", functionName: "spielwerk" });
const FACTORIES = {
  pitch: EffectFactories.Pitch,
  velocity: EffectFactories.Velocity,
  "note-filter": EffectFactories.NoteFilter,
  arpeggio: EffectFactories.Arpeggio,
  zeitgeist: EffectFactories.Zeitgeist,
  spielwerk: EffectFactories.Spielwerk,
} as const;
const COMPILE_DEADLINE_MS = 30_000;
const SAMPLE_LOAD_DEADLINE_MS = 30_000;

interface Built extends NanoProject {
  /** What `?importMs=` did, shown beside the status for the page's lifetime. */
  importNote: string | null;
}

/** `?importMs=`'s synthetic take right after init, on the project as init left it (the shared bootstrap's `afterInit`),
 *  then the burst on a Nano at bar 1. */
async function buildProject(localAudioBuffers: Map<string, AudioBuffer>, onStatus: (s: string) => void): Promise<Built> {
  const importMs = IMPORT_MS;
  const imported: { note: string | null } = { note: null };
  const afterInit = async (project: Project): Promise<void> => {
    if (importMs === null) return;
    onStatus(`Importing a ${importMs} ms recording...`);
    imported.note = await importShortRecording(project, importMs);
  };
  const nano = await buildNanoProject({
    localAudioBuffers, bpm: BPM, rate: RATE, sample: burstSample(RATE, SAMPLE_MS), fileName: "burst.wav", rootKey: NOTE_PITCH,
    attackSeconds: NANO_ATTACK_SECONDS, releaseSeconds: NANO_RELEASE_SECONDS,
    regionPositionPpqn: REGION_POSITION_PPQN, regionDurationPpqn: REGION_DURATION_PPQN, removeMaximizer: false, onStatus, afterInit,
  });
  return { ...nano, importNote: imported.note };
}

/** The burst as a synthetic take through `importRecording`, the function a finished recording's audio goes through. */
async function importShortRecording(project: Project, ms: number): Promise<string> {
  const channel = burstSample(RATE, ms);
  const audioData = AudioData.create(RATE, channel.length, 2);
  audioData.frames[0].set(channel);
  audioData.frames[1].set(channel);
  try {
    await withDeadline(project.env.sampleService.importRecording(UUID.generate(), audioData, BPM, "short take"), SAMPLE_LOAD_DEADLINE_MS, "recording import");
    return `recording import of ${ms} ms (${channel.length} frames): ok`;
  } catch (error) {
    throw new Error(`recording import of ${ms} ms (${channel.length} frames) failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applySettings(box: EffectBox, device: MidiEffectDevice): void {
  switch (device) {
    case "pitch": {
      const pitch = box as PitchDeviceBox;
      pitch.semiTones.setValue(0);
      pitch.cents.setValue(0);
      pitch.octaves.setValue(0);
      return;
    }
    case "velocity": {
      const velocity = box as VelocityDeviceBox;
      velocity.magnetStrength.setValue(0);
      velocity.randomAmount.setValue(0);
      velocity.offset.setValue(0);
      velocity.mix.setValue(1);
      return;
    }
    case "note-filter": {
      const filter = box as NoteFilterDeviceBox;
      filter.min.setValue(0);
      filter.max.setValue(127);
      filter.set.setValue(false);
      filter.transpose.setValue(0);
      filter.key.setValue(60);
      return;
    }
    case "arpeggio": {
      const arpeggio = box as ArpeggioDeviceBox;
      arpeggio.modeIndex.setValue(0);
      arpeggio.numOctaves.setValue(1);
      arpeggio.rateIndex.setValue(ARPEGGIO_RATE_INDEX);
      arpeggio.gate.setValue(1);
      arpeggio.repeat.setValue(1);
      arpeggio.velocity.setValue(0);
      return;
    }
    case "zeitgeist": {
      const groove = zeitgeistGrooveBox(box as ZeitgeistDeviceBox);
      groove.amount.setValue(ZEITGEIST_AMOUNT);
      groove.duration.setValue(ZEITGEIST_DURATION_PPQN);
      return;
    }
    case "spielwerk":
      return;
  }
}

/** The positions a rule row's device is expected to sound, absolute pulses. Resolved while the device exists
 *  (Zeitgeist's warp is read through the device's groove, so the page uses the mapping the engine ports). */
function expectedPositions(scenario: MidiEffectScenario, project: Project, box: EffectBox | null): number[] {
  switch (scenario.rule) {
    case "arpeggio":
      return arpeggioSteps(REGION_POSITION_PPQN, REGION_POSITION_PPQN + REGION_DURATION_PPQN, ARPEGGIO_RATE_PPQN);
    case "zeitgeist": {
      if (!(box instanceof ZeitgeistDeviceBox)) throw new Error("zeitgeist row without a Zeitgeist device");
      const adapter = project.boxAdapters.adapterFor(box, ZeitgeistDeviceBoxAdapter);
      return zeitgeistWarped(DRY_ABSOLUTE, adapter.groove().unwrap("Zeitgeist has no groove"));
    }
    case "echo":
      return echoCopies(REGION_POSITION_PPQN, ECHO_DELAY_PPQN, ECHO_REPEATS);
    case null:
      return DRY_ABSOLUTE;
  }
}

const figureOf = (verdict: RowVerdict): string | null =>
  verdict.status === "investigate" ? verdict.figure : verdict.status === "error" ? verdict.message : null;

const errorRecord = (scenario: MidiEffectScenario, message: string): MidiEffectRowRecord => ({
  id: scenario.id, label: scenario.label, device: scenario.device, enabled: scenario.enabled, judge: scenario.judge,
  status: "error", figure: message, lag: null, score: null, peak: 0, onsets: [], expected: [], deltas: [],
  expectedCount: expectedOnsetCount(scenario),
});

const App: React.FC = () => {
  const [status, setStatus] = useState(PARAM_ERROR === null ? "Loading..." : `Error: ${PARAM_ERROR}`);
  const [auditState, setAuditState] = useState(PARAM_ERROR === null ? "idle" : `error:${PARAM_ERROR}`);
  const [built, setBuilt] = useState<Built | null>(null);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<MidiEffectRowRecord[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const eventsRef = useRef<NoteEventBox[]>([]);
  const patternRef = useRef<readonly PatternNote[] | null>(null);

  useEffect(() => {
    if (PARAM_ERROR !== null) return;
    let mounted = true;
    buildProject(localAudioBuffersRef.current, setStatus)
      .then((result) => {
        if (!mounted) return;
        setBuilt(result);
        setStatus("Ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to initialize: " + message);
        if (mounted) {
          setStatus(`Error: ${message}`);
          setAuditState(`error:${message}`);
        }
      });
    return () => { mounted = false; };
  }, []);

  const runAudit = useCallback(async (b: Built): Promise<void> => {
    const { project, audioContext, audioUnitBox, regionBox } = b;
    const runToken = Date.now();
    const records: MidiEffectRowRecord[] = [];
    let dryLeft: Float32Array | null = null;
    let instrumentOffset = 0;

    const writePattern = (pattern: readonly PatternNote[]): void => {
      if (patternRef.current === pattern) return;
      const held = eventsRef.current;
      // Cleared before the delete: a throw between the two transactions must not leave the old pattern claimed.
      patternRef.current = null;
      eventsRef.current = [];
      project.editing.modify(() => { for (const box of held) if (box.isAttached()) box.delete(); });
      // Creation in a second transaction, folded into the same undo step.
      eventsRef.current = project.editing
        .append(() => pattern.map((note) => project.api.createNoteEvent({
          owner: regionBox, position: note.position as ppqn, duration: note.duration as ppqn, pitch: NOTE_PITCH, velocity: 1,
        })))
        .unwrap("createNoteEvent");
      patternRef.current = pattern;
    };

    const insertDevice = async (scenario: MidiEffectScenario): Promise<EffectBox | null> => {
      if (scenario.device === null) return null;
      const device = scenario.device;
      const field = midiEffectsFieldOf(project, audioUnitBox);
      const box = project.editing.modify(() => project.api.insertEffect(field, FACTORIES[device])).unwrap("insertEffect");
      try {
        // Settings in their own transaction after the insert commits (repo rule on pointers created in the same transaction).
        project.editing.modify(() => {
          box.enabled.setValue(scenario.enabled);
          applySettings(box, device);
        });
        if (device === "spielwerk") {
          if (scenario.script === null) throw new Error(`row ${scenario.id} has no script`);
          // The compiler opens its own transaction, so it runs outside ours.
          await withDeadline(
            SPIELWERK_COMPILER.compile(audioContext, project.editing, box as SpielwerkDeviceBox, scenario.script),
            COMPILE_DEADLINE_MS,
            `Spielwerk compile for ${scenario.id}`,
          );
        }
      } catch (error) {
        // The insert has committed: a device whose settings or compile failed must not stay on the chain for the later rows.
        try {
          removeMidiEffect(project.editing, box);
        } catch (cleanupError) {
          throw new RunAbort(`${scenario.id}: ${String(error)}; and the device could not be removed: ${String(cleanupError)}`);
        }
        throw error;
      }
      return box;
    };

    for (const scenario of SCENARIOS) {
      setAuditState(`running:${scenario.id}`);
      setStatus(`Rendering: ${scenario.label}`);
      let box: EffectBox | null = null;
      try {
        writePattern(scenario.pattern);
        box = await insertDevice(scenario);
        const positions = expectedPositions(scenario, project, box);
        const { channels } = await renderOfflineSlice(project, 0, renderSeconds(BPM), RATE);
        const left = channels[0];
        const onsets = onsetsOf(left, RATE, ONSET_THRESHOLD, ONSET_SKIP_MS);
        const peak = peakOf(left);
        let record: MidiEffectRowRecord;
        if (scenario.id === "dry") {
          if (onsets.length !== DRY_PATTERN.length) {
            throw new Error(`dry render found ${onsets.length} onsets, expected ${DRY_PATTERN.length}`);
          }
          dryLeft = left;
          instrumentOffset = instrumentOffsetFrames(onsets[0], REGION_POSITION_PPQN, BPM, RATE);
          setOffset(instrumentOffset);
          // The dry row is read against its own grid: its deltas show what the sampler itself does to spacing.
          const judgement = judgeRule(onsets, expectedFrames(positions, BPM, RATE, instrumentOffset), RULE_TOLERANCE_FRAMES, RATE, peak);
          record = {
            id: scenario.id, label: scenario.label, device: null, enabled: true, judge: "rule",
            status: judgement.verdict.status, figure: figureOf(judgement.verdict), lag: 0, score: 1, peak,
            onsets, expected: judgement.expected, deltas: judgement.deltas, expectedCount: DRY_PATTERN.length,
          };
        } else if (scenario.judge === "pass-through") {
          if (dryLeft === null) throw new Error("no dry reference");
          const judgement = judgePassThrough(dryLeft, left, MAX_LAG_FRAMES, SCORE_FLOOR, RATE, onsets.length, expectedOnsetCount(scenario));
          record = {
            id: scenario.id, label: scenario.label, device: scenario.device, enabled: scenario.enabled, judge: "pass-through",
            status: judgement.verdict.status, figure: figureOf(judgement.verdict), lag: judgement.lag, score: judgement.score, peak: judgement.peak,
            onsets, expected: [], deltas: [], expectedCount: expectedOnsetCount(scenario),
          };
        } else {
          const judgement = judgeRule(onsets, expectedFrames(positions, BPM, RATE, instrumentOffset), RULE_TOLERANCE_FRAMES, RATE, peak);
          record = {
            id: scenario.id, label: scenario.label, device: scenario.device, enabled: scenario.enabled, judge: "rule",
            status: judgement.verdict.status, figure: figureOf(judgement.verdict), lag: null, score: null, peak,
            onsets, expected: judgement.expected, deltas: judgement.deltas, expectedCount: expectedOnsetCount(scenario),
          };
        }
        records.push(record);
        console.log(`[midi-effect-audit] ${scenario.id}: ${record.status}${record.figure === null ? "" : " — " + record.figure}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[midi-effect-audit] ${scenario.id} failed: ${message}`);
        records.push(errorRecord(scenario, message));
        if (scenario.id === "dry" || error instanceof RunAbort) {
          setRows([...records]);
          throw new Error(message);
        }
      } finally {
        if (box !== null) {
          try {
            removeMidiEffect(project.editing, box);
          } catch (cleanupError) {
            // Every later row would render through this device beside its own: the run ends here.
            setRows([...records]);
            throw new RunAbort(`${scenario.id}: the device could not be removed after the render: ${String(cleanupError)}`);
          }
        }
      }
      setRows([...records]);
    }

    const summary: MidiEffectSummary = {
      schemaVersion: MIDI_EFFECT_SCHEMA_VERSION,
      runToken,
      userAgent: navigator.userAgent,
      sdkVersion: OPENDAW_SDK_VERSION,
      sampleRate: RATE,
      bpm: BPM,
      instrumentOffsetFrames: instrumentOffset,
      deviceParam: DEVICE_PARAM,
      rows: records,
    };
    await uploadSummary(summaryFileName(runToken), summary);
    console.log(`[midi-effect-audit] summary ${summaryFileName(runToken)} uploaded, ${records.length} rows`);
  }, []);

  const handleRun = useCallback(() => {
    if (built === null || running) return;
    setRunning(true);
    setRows([]);
    setOffset(null);
    setAuditState("setup");
    runAudit(built)
      .then(() => { setAuditState("done"); setStatus("Done"); })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setAuditState(`error:${message}`);
        setStatus(`Error: ${message}`);
      })
      .finally(() => setRunning(false));
  }, [built, running, runAudit]);

  const expected: TestStepRow[] = SCENARIOS.map((scenario) => ({
    label: scenario.label,
    value: scenario.id === "dry"
      ? `${DRY_PATTERN.length} onsets on the sixteenth grid (its spacing is the sampler's own)`
      : scenario.judge === "pass-through"
        ? `lag 0, score ≥ ${SCORE_FLOOR}`
        : `${expectedOnsetCount(scenario)} onsets, each within ${RULE_TOLERANCE_FRAMES} frame of the ${scenario.rule} rule`,
  }));
  const got: TestStepRow[] = rows.map((row) => ({
    label: row.label,
    value: row.status + (row.figure === null ? "" : ` — ${row.figure}`)
      + (row.judge === "pass-through" && row.lag !== null && row.score !== null ? ` (lag ${row.lag}, score ${row.score.toFixed(3)})` : "")
      + (row.judge === "rule" ? ` (${row.onsets.length}/${row.expectedCount} onsets)` : ""),
  }));
  const ms = (frames: number): string => ((frames / RATE) * 1000).toFixed(2);

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Flex align="center" gap="3">
            <MoisesLogo />
            <Heading size="7">MIDI Effect Placement Audit</Heading>
          </Flex>
          <DebugLinkBar links={[
            { label: "Register: debug/2026-10-21-midi-effect-placement/note.md", href: REGISTER_URL, kind: "note" },
            { label: "openDAW#494 (a short sample never loads)", href: "https://github.com/andremichelle/openDAW/issues/494", kind: "note" },
          ]} />
          <Text size="2" color="gray">
            A Nano sampler plays a 20 ms burst on eight sixteenths at bar 1. The same pattern is rendered offline dry, then
            through each stock MIDI effect and through each effect disabled. A device that passes timing through (Pitch,
            Velocity, a Spielwerk that forwards or re-yields) is read by cross-correlation against the dry render of the
            same run; a device meant to move notes (Arpeggio, Zeitgeist, a Spielwerk echo) by its onsets against the frames
            its own rule predicts. A live key enters the same event chain as a region note, so this render covers the heard
            path of live playing too. Offline render at {RATE} Hz, {BPM} bpm.
          </Text>
          <Callout.Root color="gray">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Status: {status}{" "}
              <Badge id="audit-state" data-audit-state={auditState} color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}>
                {auditState}
              </Badge>
              {built !== null && built.importNote !== null ? <> — {built.importNote}</> : null}
            </Callout.Text>
          </Callout.Root>
          <TestStep
            index={1}
            title="Each MIDI effect against its own rule"
            description={
              <>
                <Code>lag</Code> is the cross-correlation maximum against the dry render (positive = later); an onset is the first
                frame above {ONSET_THRESHOLD} absolute, read again {ONSET_SKIP_MS} ms past each one. The dry row's first onset
                gives the sampler's own offset, added to every expected frame.
              </>
            }
            actions={
              <Button onClick={handleRun} disabled={built === null || running} data-testid="run">
                <PlayIcon /> {running ? "Rendering…" : "Run audit"}
              </Button>
            }
            expected={expected}
            got={rows.length === 0 ? null : got}
          />
          {rows.length > 0 && (
            <Card>
              <Table.Root size="1" variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>status</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>lag / score</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>onsets</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>deltas (frames)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>figure</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.Cell>{row.id}</Table.Cell>
                      <Table.Cell>
                        <Badge color={row.status === "as-predicted" ? "green" : row.status === "investigate" ? "amber" : "red"}>{row.status}</Badge>
                      </Table.Cell>
                      <Table.Cell>{row.lag === null || row.score === null ? "—" : `${row.lag} / ${row.score.toFixed(3)}`}</Table.Cell>
                      <Table.Cell>{row.onsets.length} / {row.expectedCount}</Table.Cell>
                      <Table.Cell>{row.deltas.length === 0 ? "—" : row.deltas.join(", ")}</Table.Cell>
                      <Table.Cell>{row.figure ?? "—"}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <Text size="1" color="gray">
                Instrument offset {offset === null ? "—" : `${offset} frames (${ms(offset)} ms)`} from the dry row's first onset; {RATE} Hz, {BPM} bpm, device {DEVICE_PARAM}, sample {SAMPLE_MS} ms.
                Pass-through tolerance: lag 0 (the chain works in pulses and the instrument resolves the same pulses to the same frames).
                Rule tolerance: {RULE_TOLERANCE_FRAMES} frame (the pulse-to-frame rounding of the expected position).
              </Text>
            </Card>
          )}
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
