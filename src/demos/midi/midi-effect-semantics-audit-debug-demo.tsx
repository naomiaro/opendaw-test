// MIDI Effect Semantics Audit — unlisted page.
//
//   midi-effect-semantics-audit-debug-demo.html[?rate=48000|44100][&rows=all|quick|<id,id,…>][&device=all|arpeggio|pitch|velocity|zeitgeist|order|disabled][&pattern=<id>]
//
// One Nano sampler plays a sine sample on a pattern; each row inserts its chain of MIDI effects, renders
// offline, reads the notes that came out (onset, end, pitch, velocity) and judges them against the rule
// the devices document (the rule's deviations known to the register are tried too), then against the
// accepted register of the same SDK. The page converts, loops and renders; every reading, rule and
// judgement is in `src/lib/audit/midiEffectSemantics*.ts`. DOM contract: #audit-state carries
// data-audit-state walking setup → running:<row> → done | error:<message>; a row that failed on its own
// is a red row under `done`, and #audit-state's data-error-rows counts them (0 on a clean run); a failure
// that voids the later rows ends the run in `error:` (a register fetch that is neither a 404 nor the
// host's fallback page, a register of another rate or bpm, a calibration row that did not run).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PPQN } from "@opendaw/lib-dsp";
import { EffectFactories, type EffectBox } from "@opendaw/studio-core";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import { VelocityDeviceBoxAdapter, ZeitgeistDeviceBoxAdapter } from "@opendaw/studio-adapters";
import type { NoteEventBox, VelocityDeviceBox, ZeitgeistDeviceBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TestStep, type TestStepRow } from "@/components/TestStep";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { midiEffectsFieldOf } from "@/lib/adapterUtils";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { PATTERN_BPM, writePattern } from "@/lib/midiEffects/patterns";
import { resolveRate, type RenderRate } from "@/lib/audit/midiEffectScenarios";
import { buildNanoProject, RunAbort, uploadSummary, type NanoProject } from "@/lib/audit/midiEffectBootstrap";
import { removeMidiEffects } from "@/lib/audit/midiEffectChain";
import {
  calibrationFrom, channelPeak, READER_DEFAULTS, readFigureAt, readNotes, sineSample, toFigure, type Calibration, type NoteFigure,
} from "@/lib/audit/midiEffectSemanticsReader";
import {
  markReadability, questionsFor, RULE_SENTENCES, toPredictedFigures, type RuleContext,
} from "@/lib/audit/midiEffectSemanticsRules";
import {
  applySettings, CALIBRATION_ROW_ID, FACTORY_KEYS, NANO_ATTACK_SECONDS, NANO_RELEASE_SECONDS, predictedVariants, REGION_DURATION_PPQN,
  REGION_POSITION_PPQN, renderRange, renderSeconds, resolveRows, ROOT_KEY, rowNotes, SAMPLE_HZ, SAMPLE_SECONDS, AUDIT_PATTERNS, type SemanticsRow,
} from "@/lib/audit/midiEffectSemanticsRows";
import {
  compareRegister, describeMismatch, judgeRule, silentRenderError, TOLERANCES, verdictColor, verdictOf, type Variant,
} from "@/lib/audit/midiEffectSemanticsVerdict";
import {
  MIDI_SEMANTICS_SCHEMA_VERSION, registerFromFetch, roundFigure, summaryFileName, type SemanticsRegister,
  type SemanticsRowRecord, type SemanticsSummary,
} from "@/lib/audit/midiEffectSemanticsArtifacts";
import "@radix-ui/themes/styles.css";
import { Badge, Button, Callout, Card, Code, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

const params = new URLSearchParams(window.location.search);
let PARAM_ERROR: string | null = null;
let RATE: RenderRate = 48000;
let ROWS: SemanticsRow[] = [];
try {
  RATE = resolveRate(params.get("rate"));
  ROWS = resolveRows({ device: params.get("device"), pattern: params.get("pattern"), rows: params.get("rows") });
} catch (error) {
  PARAM_ERROR = error instanceof Error ? error.message : String(error);
}
const ROWS_PARAM = params.get("rows") ?? "all";
const DEVICE_PARAM = params.get("device") ?? "all";
const PATTERN_PARAM = params.get("pattern") ?? "all";

const NOTE_URL = "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-midi-effect-semantics/note.md";
const REGISTER_PATH = `/debug/2026-11-03-midi-effect-semantics/register/${RATE}.json`;
const CALIBRATION_NOTES = 32;
const MARK_OPTIONS = {
  attackMs: NANO_ATTACK_SECONDS * 1000,
  releaseMs: NANO_RELEASE_SECONDS * 1000,
  gapMs: READER_DEFAULTS.gapMs,
  minCycles: READER_DEFAULTS.minCycles,
  minVelocity: 0.01,
};
const RULE_RANGE = renderRange(PATTERN_BPM);

interface LoadedRegister { register: SemanticsRegister | null; source: string | null }

/** `registerFromFetch` reads the response: no register only on a 404 or the host's HTML fallback; anything else that is not
 *  this rate's and bpm's register throws, and the run ends in `error:`. */
async function fetchRegister(): Promise<LoadedRegister> {
  const response = await fetch(REGISTER_PATH);
  let register: SemanticsRegister | null;
  try {
    register = registerFromFetch(
      { status: response.status, contentType: response.headers.get("content-type") ?? "", body: await response.text() },
      { sampleRate: RATE, bpm: PATTERN_BPM }, REGISTER_PATH,
    );
  } catch (error) {
    throw new RunAbort(`register: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { register, source: register === null ? null : REGISTER_PATH };
}

const recordFigure = (row: SemanticsRowRecord): string => {
  const parts: string[] = [];
  if (row.figure !== null) parts.push(row.figure);
  if (row.verdict.includes("rule broken")) parts.push(row.ruleSentence);
  for (const question of row.questions) parts.push(`questioned: ${question}`);
  return parts.join(" — ");
};

const errorRecord = (row: SemanticsRow, message: string, renderMs: number): SemanticsRowRecord => ({
  id: row.id, label: row.label, group: row.group, pattern: row.pattern, chain: row.chain.map((stage) => ({ ...stage })),
  predicted: [], ruleSentence: ruleSentenceOf(row), read: [], unreadable: 0, rule: "none", deviations: [], questions: [],
  register: "unregistered", verdict: "error", figure: message, error: message, renderMs,
});

const ruleSentenceOf = (row: SemanticsRow): string => row.chain.map((stage) => RULE_SENTENCES[stage.setting.device]).join(" → ");

const App: React.FC = () => {
  const [status, setStatus] = useState(PARAM_ERROR === null ? "Loading..." : `Error: ${PARAM_ERROR}`);
  const [auditState, setAuditState] = useState(PARAM_ERROR === null ? "idle" : `error:${PARAM_ERROR}`);
  const [built, setBuilt] = useState<NanoProject | null>(null);
  const [running, setRunning] = useState(false);
  const [records, setRecords] = useState<SemanticsRowRecord[]>([]);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [registerSource, setRegisterSource] = useState<string | null | undefined>(undefined);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const eventsRef = useRef<NoteEventBox[]>([]);
  const patternRef = useRef<string | null>(null);

  useEffect(() => {
    if (PARAM_ERROR !== null) return;
    let mounted = true;
    buildNanoProject({
      localAudioBuffers: localAudioBuffersRef.current, bpm: PATTERN_BPM, rate: RATE,
      sample: sineSample(RATE, SAMPLE_SECONDS, SAMPLE_HZ), fileName: "sine-440.wav", rootKey: ROOT_KEY,
      attackSeconds: NANO_ATTACK_SECONDS, releaseSeconds: NANO_RELEASE_SECONDS,
      regionPositionPpqn: REGION_POSITION_PPQN, regionDurationPpqn: REGION_DURATION_PPQN, removeMaximizer: true, onStatus: setStatus,
    })
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

  const runAudit = useCallback(async (b: NanoProject): Promise<void> => {
    const { project, audioUnitBox, regionBox } = b;
    const runToken = Date.now();
    const out: SemanticsRowRecord[] = [];
    const { register, source: loadedSource } = await fetchRegister();
    setRegisterSource(loadedSource);
    let calibrated: Calibration = { referencePeak: 1, instrumentOffsetFrames: 0 };
    let calibrationRan = false;

    const useRowPattern = (row: SemanticsRow): void => {
      if (patternRef.current === row.pattern) return;
      const pattern = AUDIT_PATTERNS.find((p) => p.id === row.pattern);
      if (pattern === undefined) throw new RunAbort(`row ${row.id} has unknown pattern ${row.pattern}`);
      const held = eventsRef.current;
      patternRef.current = null;
      eventsRef.current = [];
      try {
        eventsRef.current = writePattern(project, regionBox, held, pattern);
      } catch (error) {
        // the region now holds an unknown pattern: every later row would be judged against it
        throw new RunAbort(`row ${row.id}: the pattern ${row.pattern} could not be written: ${error instanceof Error ? error.message : String(error)}`);
      }
      patternRef.current = row.pattern;
    };

    const insertChain = (row: SemanticsRow, inserted: EffectBox[]): void => {
      for (const stage of row.chain) {
        const field = midiEffectsFieldOf(project, audioUnitBox);
        const box = project.editing
          .modify(() => project.api.insertEffect(field, EffectFactories[FACTORY_KEYS[stage.setting.device]]))
          .unwrap("insertEffect");
        inserted.push(box);
        project.editing.modify(() => {
          box.enabled.setValue(stage.enabled);
          applySettings(box, stage.setting);
        });
      }
    };

    for (const row of ROWS) {
      setAuditState(`running:${row.id}`);
      setStatus(`Rendering: ${row.label}`);
      const inserted: EffectBox[] = [];
      const started = performance.now();
      let renderStart = started;
      let record: SemanticsRowRecord;
      try {
        useRowPattern(row);
        insertChain(row, inserted);
        const context: RuleContext = { range: RULE_RANGE, computeVelocity: (_position, original) => original, warp: (position) => position };
        row.chain.forEach((stage, index) => {
          const box = inserted[index];
          if (stage.setting.device === "velocity") {
            const adapter = project.boxAdapters.adapterFor(box as VelocityDeviceBox, VelocityDeviceBoxAdapter);
            context.computeVelocity = (position, original) => adapter.computeVelocity(position as never, original);
          } else if (stage.setting.device === "zeitgeist") {
            const groove = project.boxAdapters.adapterFor(box as ZeitgeistDeviceBox, ZeitgeistDeviceBoxAdapter).groove();
            context.warp = (position) => groove.warp(position as never);
          }
        });
        const variants = predictedVariants(row, context);
        renderStart = performance.now();
        const { channels } = await renderOfflineSlice(project, 0, renderSeconds(PATTERN_BPM), RATE);
        const renderMs = performance.now() - renderStart;
        const channel = channels[0];
        const notes = readNotes(channel, RATE, READER_DEFAULTS);
        if (row.id === CALIBRATION_ROW_ID) {
          try {
            calibrated = calibrationFrom(notes, RATE, PPQN.pulsesToSeconds(REGION_POSITION_PPQN, PATTERN_BPM), CALIBRATION_NOTES);
          } catch (error) {
            throw new RunAbort(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
          calibrationRan = true;
          setCalibration(calibrated);
        }
        const cal = calibrated;
        const read: NoteFigure[] = notes.map((note) => roundFigure(toFigure(note, RATE, cal.referencePeak, cal.instrumentOffsetFrames)));
        const readAt = (onsetMs: number, endMs: number): NoteFigure => roundFigure(readFigureAt(channel, RATE, onsetMs, endMs, cal));
        const judged: Variant[] = variants.map((variant) => ({
          deviations: variant.deviations,
          predicted: toPredictedFigures(markReadability(variant.notes, PATTERN_BPM, MARK_OPTIONS), PATTERN_BPM),
        }));
        const intent = judged.find((variant) => variant.deviations.size === 0);
        if (intent === undefined) throw new Error("the rule gave no intent variant");
        // a render that is silent where the rule predicts sound did not play the row: an error, not a judgement
        const silent = silentRenderError(channelPeak(channel), judged);
        if (silent !== null) throw new Error(silent);
        const unreadable = intent.predicted.filter((p) => p.readability !== "readable").length;
        const rule = judgeRule(read, judged, TOLERANCES, readAt);
        const registered = compareRegister({ notes: read, unreadable }, register?.rows[row.id], TOLERANCES);
        const enabledChain = row.chain.filter((stage) => stage.enabled).map((stage) => stage.setting);
        const verdict = verdictOf(rule, registered.kind, null);
        const mismatch = rule.kind === "broken" && rule.mismatch !== null ? rule.mismatch : registered.mismatch;
        record = {
          id: row.id, label: row.label, group: row.group, pattern: row.pattern, chain: row.chain.map((stage) => ({ ...stage })),
          predicted: intent.predicted, ruleSentence: ruleSentenceOf(row), read, unreadable, rule: rule.kind,
          deviations: rule.deviations, questions: questionsFor(enabledChain, context, rowNotes(row)), register: registered.kind,
          verdict, figure: mismatch === null ? null : describeMismatch(mismatch), error: null, renderMs,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[midi-semantics] ${row.id} failed: ${message}`);
        record = errorRecord(row, message, performance.now() - renderStart);
        if (error instanceof RunAbort || row.id === CALIBRATION_ROW_ID) {
          out.push(record);
          setRecords([...out]);
          let removal = "";
          try {
            removeMidiEffects(project.editing, inserted.filter((box) => box.isAttached()));
          } catch (cleanupError) {
            removal = `; and the chain could not be removed: ${String(cleanupError)}`;
            console.error(`[midi-semantics] ${row.id}: the chain could not be removed after the failure: ${String(cleanupError)}`);
          }
          throw error instanceof RunAbort ? new RunAbort(message + removal) : new Error(message + removal);
        }
      }
      try {
        removeMidiEffects(project.editing, inserted);
      } catch (cleanupError) {
        out.push(record);
        setRecords([...out]);
        throw new RunAbort(`${row.id}: the chain could not be removed after the render: ${String(cleanupError)}`);
      }
      out.push(record);
      console.log(`[midi-semantics] ${record.id}: ${record.verdict}${recordFigure(record) === "" ? "" : " — " + recordFigure(record)}`);
      setRecords([...out]);
    }
    // every figure after the calibration row is read against its reference peak and offset: without it the run means nothing
    if (!calibrationRan) throw new RunAbort(`the calibration row ${CALIBRATION_ROW_ID} did not run`);

    const summary: SemanticsSummary = {
      schemaVersion: MIDI_SEMANTICS_SCHEMA_VERSION,
      runToken,
      userAgent: navigator.userAgent,
      sdkVersion: OPENDAW_SDK_VERSION,
      sampleRate: RATE,
      bpm: PATTERN_BPM,
      rowsParam: ROWS_PARAM,
      deviceParam: DEVICE_PARAM,
      patternParam: PATTERN_PARAM,
      registerSource: loadedSource,
      registerSdkVersion: register === null ? null : register.sdkVersion,
      calibration: {
        referencePeak: calibrated.referencePeak, instrumentOffsetFrames: calibrated.instrumentOffsetFrames, onsetThreshold: READER_DEFAULTS.onsetThreshold,
        attackMs: READER_DEFAULTS.attackMs, gapMs: READER_DEFAULTS.gapMs,
      },
      rows: out,
    };
    // The `/__verify` sink exists on the dev server only: on the public host the PUT answers 404 or
    // 405, which leaves the run's verdicts on the page and nothing on disk — a warning, not an error.
    try {
      await uploadSummary(summaryFileName(runToken), summary);
      console.log(`[midi-semantics] summary ${summaryFileName(runToken)} uploaded, ${out.length} rows`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/HTTP 40[45]\b/.test(message)) throw error;
      console.warn(`[midi-semantics] summary not uploaded: no /__verify sink on this host (${message})`);
    }
  }, []);

  const handleRun = useCallback(() => {
    if (built === null || running) return;
    setRunning(true);
    setRecords([]);
    setCalibration(null);
    setRegisterSource(undefined);
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

  const expected: TestStepRow[] = ROWS.map((row) => ({ label: row.id, value: ruleSentenceOf(row) === "" ? "the pattern as written" : ruleSentenceOf(row) }));
  const got: TestStepRow[] = records.map((row) => ({ label: row.id, value: row.verdict + (recordFigure(row) === "" ? "" : ` — ${recordFigure(row)}`) }));
  const readable = (row: SemanticsRowRecord): number => row.predicted.filter((p) => p.readability === "readable").length;

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Flex align="center" gap="3">
            <MoisesLogo />
            <Heading size="7">MIDI Effect Semantics Audit</Heading>
          </Flex>
          <DebugLinkBar links={[
            { label: "Register: debug/2026-11-03-midi-effect-semantics/note.md", href: NOTE_URL, kind: "note" },
            { label: "openDAW#524 (Arpeggio velocity: closed, manual corrected)", href: "https://github.com/andremichelle/openDAW/issues/524", kind: "note" },
            { label: "openDAW#525 (Zeitgeist note-offs: closed, manual corrected)", href: "https://github.com/andremichelle/openDAW/issues/525", kind: "note" },
          ]} />
          <Text size="2" color="gray">
            A Nano sampler plays a {SAMPLE_HZ} Hz sine on a note pattern. Each row puts a chain of MIDI effects before it, renders
            offline, reads every note that comes out (onset, end, pitch, velocity) and judges the notes against what the devices
            document, then against the accepted register. Offline render at {RATE} Hz, {PATTERN_BPM} bpm.
          </Text>
          <Callout.Root color="gray">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              Status: {status}{" "}
              <Badge id="audit-state" data-audit-state={auditState} data-error-rows={records.filter((row) => row.error !== null).length} color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}>
                {auditState}
              </Badge>
            </Callout.Text>
          </Callout.Root>
          <TestStep
            index={1}
            title="Each chain against its rule"
            description={
              <>
                A note is read from the render as the first frame above {READER_DEFAULTS.onsetThreshold} absolute until a
                {" "}{READER_DEFAULTS.gapMs} ms gap; its pitch is a zero-crossing fit, its velocity the peak over the dry
                sixteenths' loudest. <Code>{CALIBRATION_ROW_ID}</Code> gives the reference peak and the sampler's own offset.
              </>
            }
            actions={
              <Button onClick={handleRun} disabled={built === null || running} data-testid="run">
                <PlayIcon /> {running ? "Rendering…" : "Run audit"}
              </Button>
            }
            expected={expected}
            got={records.length === 0 ? null : got}
          />
          {records.length > 0 && (
            <Card>
              <Table.Root size="1" variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>verdict</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>read / readable (unreadable)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>figure</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>render ms</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {records.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.Cell>{row.id}</Table.Cell>
                      <Table.Cell><Badge color={verdictColor(row.verdict)}>{row.verdict}</Badge></Table.Cell>
                      <Table.Cell>{row.read.length} / {readable(row)} ({row.unreadable})</Table.Cell>
                      <Table.Cell>{recordFigure(row) === "" ? "—" : recordFigure(row)}</Table.Cell>
                      <Table.Cell>{row.renderMs.toFixed(0)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          )}
          <Text size="1" color="gray">
            Calibration: reference peak {calibration === null ? "—" : calibration.referencePeak.toFixed(4)}, instrument offset{" "}
            {calibration === null ? "—" : `${calibration.instrumentOffsetFrames} frames`}; {RATE} Hz, {PATTERN_BPM} bpm, rows {ROWS_PARAM}, device {DEVICE_PARAM}, pattern {PATTERN_PARAM}.
            Register: {registerSource === undefined ? "—" : registerSource === null ? "none" : registerSource}.
          </Text>
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
