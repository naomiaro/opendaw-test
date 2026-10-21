// MIDI Effect Placement Audit — unlisted page.
//
//   midi-effect-placement-audit-debug-demo.html[?rate=48000|44100][&bpm=<n>][&device=all|pitch|velocity|arpeggio|zeitgeist|spielwerk]
//
// One Nano sampler plays a 20 ms burst on a note pattern. The pattern is rendered offline dry,
// then through each stock MIDI effect (and each effect disabled), and every row is read against
// what the device's own rule predicts: a pass-through device against the dry render by
// cross-correlation, a device meant to move notes (Arpeggio, Zeitgeist, a Spielwerk echo) by its
// onsets against the frames the rule names. A live key enters the same event chain as a region
// note, so one render covers both the heard and the recorded path's effect side. Register and
// reading recipe: debug/2026-10-21-midi-effect-placement/note.md. DOM contract: #audit-state
// carries data-audit-state walking setup → running:<row> → done | error:<message>.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import type { ppqn } from "@opendaw/lib-dsp";
import { EffectFactories, type EffectBox, type Project } from "@opendaw/studio-core";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import {
  ArpeggioDeviceBox, AudioFileBox, PitchDeviceBox, SpielwerkDeviceBox, VelocityDeviceBox, ZeitgeistDeviceBox,
  type AudioUnitBox, type NanoDeviceBox, type NoteEventBox, type NoteRegionBox,
} from "@opendaw/studio-boxes";
import { InstrumentFactories, ScriptCompiler, ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TestStep, type TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { withDeadline } from "@/lib/deadline";
import {
  ARPEGGIO_RATE_INDEX, ARPEGGIO_RATE_PPQN, burstSample, DRY_PATTERN, ECHO_DELAY_PPQN, ECHO_REPEATS, expectedOnsetCount,
  MAX_LAG_FRAMES, NANO_ATTACK_SECONDS, NANO_RELEASE_SECONDS, NOTE_PITCH, ONSET_SKIP_MS, ONSET_THRESHOLD, REGION_DURATION_PPQN,
  REGION_POSITION_PPQN, renderSeconds, resolveBpm, resolveDevices, resolveRate, RULE_TOLERANCE_FRAMES, SCORE_FLOOR,
  ZEITGEIST_AMOUNT, ZEITGEIST_DURATION_PPQN, type MidiEffectDevice, type MidiEffectScenario, type PatternNote, type RenderRate,
} from "@/lib/audit/midiEffectScenarios";
import { arpeggioSteps, echoCopies, expectedFrames, instrumentOffsetFrames, zeitgeistWarped } from "@/lib/audit/midiEffectRules";
import { judgePassThrough, judgeRule, onsetsOf, peakOf, type RowVerdict } from "@/lib/audit/midiEffectPlacement";
import { zeitgeistGrooveBox, removeMidiEffect } from "@/lib/audit/midiEffectChain";
import { MIDI_EFFECT_SCHEMA_VERSION, summaryFileName, type MidiEffectRowRecord, type MidiEffectSummary } from "@/lib/audit/midiEffectArtifacts";
import "@radix-ui/themes/styles.css";
import { Badge, Button, Callout, Card, Code, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

const params = new URLSearchParams(window.location.search);
let PARAM_ERROR: string | null = null;
let RATE: RenderRate = 48000;
let BPM = 120;
let SCENARIOS: MidiEffectScenario[] = [];
try {
  RATE = resolveRate(params.get("rate"));
  BPM = resolveBpm(params.get("bpm"));
  SCENARIOS = resolveDevices(params.get("device"));
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
  arpeggio: EffectFactories.Arpeggio,
  zeitgeist: EffectFactories.Zeitgeist,
  spielwerk: EffectFactories.Spielwerk,
} as const;

interface Built {
  project: Project;
  audioContext: AudioContext;
  audioUnitBox: AudioUnitBox;
  regionBox: NoteRegionBox;
}

/** The burst, the Nano with it attached, the region at bar 1. Two transactions after init: the file box
 *  and the instrument together (the attachment is a mandatory-edge target), then the sampler's settings
 *  and the region. */
async function buildProject(localAudioBuffers: Map<string, AudioBuffer>, onStatus: (s: string) => void): Promise<Built> {
  const { project, audioContext } = await initializeOpenDAW({ localAudioBuffers, bpm: BPM, audioContextSampleRate: RATE, onStatusUpdate: onStatus });
  const channel = burstSample(RATE);
  const buffer = audioContext.createBuffer(2, channel.length, RATE);
  buffer.getChannelData(0).set(channel);
  buffer.getChannelData(1).set(channel);
  const uuid = UUID.generate();
  localAudioBuffers.set(UUID.toString(uuid), buffer);
  const { audioUnitBox, instrumentBox, trackBox } = project.editing
    .modify(() => {
      const fileBox = AudioFileBox.create(project.boxGraph, uuid, (box) => {
        box.fileName.setValue("burst.wav");
        box.endInSeconds.setValue(buffer.duration);
      });
      return project.api.createInstrument(InstrumentFactories.Nano, { attachment: fileBox });
    })
    .unwrap("createInstrument");
  const nanoBox: NanoDeviceBox = instrumentBox;
  const regionBox = project.editing
    .modify(() => {
      nanoBox.attack.setValue(NANO_ATTACK_SECONDS);
      nanoBox.release.setValue(NANO_RELEASE_SECONDS);
      nanoBox.rootKey.setValue(NOTE_PITCH);
      nanoBox.loop.setValue(false);
      project.timelineBox.loopArea.enabled.setValue(false);
      return project.api.createNoteRegion({
        trackBox,
        position: REGION_POSITION_PPQN as ppqn,
        duration: REGION_DURATION_PPQN as ppqn,
        loopDuration: REGION_DURATION_PPQN as ppqn,
        name: "pattern",
      });
    })
    .unwrap("createNoteRegion");
  return { project, audioContext, audioUnitBox, regionBox };
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
 *  (Zeitgeist's warp is read through the device's own groove, so the page uses the mapping the engine ports). */
function expectedPositions(scenario: MidiEffectScenario, project: Project, box: EffectBox | null): number[] {
  switch (scenario.rule) {
    case "arpeggio":
      return arpeggioSteps(REGION_POSITION_PPQN, REGION_POSITION_PPQN + REGION_DURATION_PPQN, ARPEGGIO_RATE_PPQN);
    case "zeitgeist": {
      if (!(box instanceof ZeitgeistDeviceBox)) throw new Error("zeitgeist row without a Zeitgeist device");
      const adapter = project.boxAdapters.adapterFor(box, ZeitgeistDeviceBoxAdapter);
      return zeitgeistWarped(DRY_ABSOLUTE, adapter.groove());
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
        console.error("Failed to initialize: " + String(error));
        if (mounted) {
          setStatus(`Error: ${String(error)}`);
          setAuditState(`error:${String(error)}`);
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
      project.editing.modify(() => { for (const box of held) if (box.isAttached()) box.delete(); });
      // A second transaction: a box created inside the clearing transaction is not yet visible to the
      // collection it joins (repo rule); append folds it into the same undo step.
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
      // Settings in their own transaction after the insert commits (repo rule on pointers created in the same transaction).
      project.editing.modify(() => {
        box.enabled.setValue(scenario.enabled);
        applySettings(box, device);
      });
      if (device === "spielwerk") {
        if (scenario.script === null) throw new Error(`row ${scenario.id} has no script`);
        // Outside any transaction: the compiler opens its own, and registers the module on the live context;
        // the offline renderer re-registers the compiled code from the box's header.
        await SPIELWERK_COMPILER.compile(audioContext, project.editing, box as SpielwerkDeviceBox, scenario.script);
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
        let record: MidiEffectRowRecord;
        if (scenario.id === "dry") {
          if (onsets.length !== DRY_PATTERN.length) {
            throw new Error(`dry render found ${onsets.length} onsets, expected ${DRY_PATTERN.length}`);
          }
          dryLeft = left;
          instrumentOffset = instrumentOffsetFrames(onsets[0], REGION_POSITION_PPQN, BPM, RATE);
          setOffset(instrumentOffset);
          // The dry row is read against its own grid: its deltas show what the sampler itself does to spacing.
          const judgement = judgeRule(onsets, expectedFrames(positions, BPM, RATE, instrumentOffset), RULE_TOLERANCE_FRAMES, RATE);
          record = {
            id: scenario.id, label: scenario.label, device: null, enabled: true, judge: "rule",
            status: judgement.verdict.status, figure: figureOf(judgement.verdict), lag: 0, score: 1, peak: peakOf(left),
            onsets, expected: judgement.expected, deltas: judgement.deltas, expectedCount: DRY_PATTERN.length,
          };
        } else if (scenario.judge === "pass-through") {
          if (dryLeft === null) throw new Error("no dry reference");
          const judgement = judgePassThrough(dryLeft, left, MAX_LAG_FRAMES, SCORE_FLOOR, RATE);
          record = {
            id: scenario.id, label: scenario.label, device: scenario.device, enabled: scenario.enabled, judge: "pass-through",
            status: judgement.verdict.status, figure: figureOf(judgement.verdict), lag: judgement.lag, score: judgement.score, peak: judgement.peak,
            onsets, expected: [], deltas: [], expectedCount: expectedOnsetCount(scenario),
          };
        } else {
          const judgement = judgeRule(onsets, expectedFrames(positions, BPM, RATE, instrumentOffset), RULE_TOLERANCE_FRAMES, RATE);
          record = {
            id: scenario.id, label: scenario.label, device: scenario.device, enabled: scenario.enabled, judge: "rule",
            status: judgement.verdict.status, figure: figureOf(judgement.verdict), lag: null, score: null, peak: peakOf(left),
            onsets, expected: judgement.expected, deltas: judgement.deltas, expectedCount: expectedOnsetCount(scenario),
          };
        }
        records.push(record);
        console.log(`[midi-effect-audit] ${scenario.id}: ${record.status}${record.figure === null ? "" : " — " + record.figure}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[midi-effect-audit] ${scenario.id} failed: ${message}`);
        records.push(errorRecord(scenario, message));
        if (scenario.id === "dry") {
          setRows([...records]);
          throw new Error(message);
        }
      } finally {
        if (box !== null) {
          try {
            removeMidiEffect(project.editing, box);
          } catch (cleanupError) {
            console.error(`[midi-effect-audit] ${scenario.id} cleanup failed: ${String(cleanupError)}`);
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
    await withDeadline(
      (async () => {
        const res = await fetch(`/__verify/${summaryFileName(runToken)}`, { method: "PUT", body: JSON.stringify(summary, null, 2) });
        if (!res.ok) throw new Error(`verify sink rejected JSON: HTTP ${res.status}`);
      })(),
      30_000,
      "summary upload",
    );
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
          <DebugLinkBar links={[{ label: "Register: debug/2026-10-21-midi-effect-placement/note.md", href: REGISTER_URL, kind: "note" }]} />
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
                Instrument offset {offset === null ? "—" : `${offset} frames (${ms(offset)} ms)`} from the dry row's first onset; {RATE} Hz, {BPM} bpm, device {DEVICE_PARAM}.
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
