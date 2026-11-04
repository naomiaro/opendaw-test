// Nano Play Modes Audit — unlisted page.
//
//   nano-play-modes-debug-demo.html[?rate=48000|44100][&row=all|<id>]
//
// One Nano sampler holds a 1 s sine at 440 Hz (root key 60, attack and release 1 ms). Each row writes its own note
// pattern, sets the sampler's play-mode fields (Mono / Poly, One-shot, Fixed pitch, Pan, plus Loop and Octave where
// the row needs them), renders offline and reads the render: the 440 Hz envelope across a second note's onset, one
// note's length, the notes' frequencies, or the channels' peaks. Rows and readers: src/lib/audit/nanoPlayModes.ts;
// register: debug/2026-11-04-nano-play-modes/note.md. DOM contract: #audit-state carries data-audit-state walking
// idle → running:<row> → done | error:<message>; a row that failed on its own is a red row under `done`. The summary
// goes to the dev server's /__verify sink as nano-play-modes-summary-<runToken>.json.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import type { NoteEventBox } from "@opendaw/studio-boxes";
import type { ppqn } from "@opendaw/lib-dsp";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { writePattern } from "@/lib/midiEffects/patterns";
import { resolveRate, type RenderRate } from "@/lib/audit/midiEffectScenarios";
import { sineSample } from "@/lib/audit/midiEffectSemanticsReader";
import { buildNanoProject, uploadSummary, type NanoProject } from "@/lib/audit/midiEffectBootstrap";
import {
  applyPlayModeSettings, instrumentOffsetFrames, judgePlayModeRow, PLAY_MODE_ATTACK_SECONDS, PLAY_MODE_BPM, PLAY_MODE_REGION_DURATION_PPQN,
  PLAY_MODE_REGION_POSITION_PPQN, PLAY_MODE_RELEASE_SECONDS, PLAY_MODE_ROOT_KEY, PLAY_MODE_SAMPLE_HZ, PLAY_MODE_SAMPLE_SECONDS, renderSeconds,
  resolveRows, type PlayModeRow, type PlayModeStatus,
} from "@/lib/audit/nanoPlayModes";
import "@radix-ui/themes/styles.css";
import { Badge, Button, Callout, Card, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

const params = new URLSearchParams(window.location.search);
let PARAM_ERROR: string | null = null;
let RATE: RenderRate = 48000;
let ROWS: readonly PlayModeRow[] = [];
try {
  RATE = resolveRate(params.get("rate"));
  ROWS = resolveRows(params.get("row"));
} catch (error) {
  PARAM_ERROR = error instanceof Error ? error.message : String(error);
}

const NOTE_URL = "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-04-nano-play-modes/note.md";
export const PLAY_MODE_SCHEMA_VERSION = 1;

export interface PlayModeRowRecord {
  id: string;
  label: string;
  status: PlayModeStatus | "error";
  figure: string;
  values: Readonly<Record<string, number | null>>;
  renderMs: number;
  error?: string;
}

export interface PlayModeSummary {
  schemaVersion: number;
  runToken: number;
  sdkVersion: string;
  rate: number;
  bpm: number;
  userAgent: string;
  /** The sampler's own latency in frames, from the first row's first read note. */
  instrumentOffsetFrames: number | null;
  rows: PlayModeRowRecord[];
}

const App: React.FC = () => {
  const [status, setStatus] = useState(PARAM_ERROR === null ? "Loading..." : `Error: ${PARAM_ERROR}`);
  const [auditState, setAuditState] = useState(PARAM_ERROR === null ? "idle" : `error:${PARAM_ERROR}`);
  const [built, setBuilt] = useState<NanoProject | null>(null);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<PlayModeRowRecord[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const eventsRef = useRef<NoteEventBox[]>([]);

  useEffect(() => {
    if (PARAM_ERROR !== null) return;
    let mounted = true;
    buildNanoProject({
      localAudioBuffers: localAudioBuffersRef.current, bpm: PLAY_MODE_BPM, rate: RATE,
      sample: sineSample(RATE, PLAY_MODE_SAMPLE_SECONDS, PLAY_MODE_SAMPLE_HZ), fileName: "sine-440.wav", rootKey: PLAY_MODE_ROOT_KEY,
      attackSeconds: PLAY_MODE_ATTACK_SECONDS, releaseSeconds: PLAY_MODE_RELEASE_SECONDS,
      regionPositionPpqn: PLAY_MODE_REGION_POSITION_PPQN, regionDurationPpqn: PLAY_MODE_REGION_DURATION_PPQN, removeMaximizer: true, onStatus: setStatus,
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
    const { project, regionBox, nanoBox } = b;
    const runToken = Date.now();
    const out: PlayModeRowRecord[] = [];
    let offsetFrames: number | null = null;
    for (const row of ROWS) {
      setAuditState(`running:${row.id}`);
      setStatus(`Rendering: ${row.label}`);
      const started = performance.now();
      try {
        eventsRef.current = writePattern(project, regionBox, eventsRef.current, {
          notes: row.notes.map((note) => ({ position: note.position as ppqn, duration: note.duration as ppqn, pitch: note.pitch, velocity: 1 })),
        });
        project.editing.modify(() => applyPlayModeSettings(nanoBox, row.settings));
        const { channels } = await renderOfflineSlice(project, 0, renderSeconds(), RATE);
        if (offsetFrames === null) {
          offsetFrames = instrumentOffsetFrames(row, channels[0], RATE);
          setOffset(offsetFrames);
        }
        const verdict = judgePlayModeRow(row, channels, RATE, offsetFrames ?? 0);
        out.push({ id: row.id, label: row.label, status: verdict.status, figure: verdict.figure, values: verdict.values, renderMs: Math.round(performance.now() - started) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[nano-play-modes] ${row.id}: ${message}`);
        out.push({ id: row.id, label: row.label, status: "error", figure: message, values: {}, renderMs: Math.round(performance.now() - started), error: message });
      }
      setRows([...out]);
    }
    const summary: PlayModeSummary = {
      schemaVersion: PLAY_MODE_SCHEMA_VERSION, runToken, sdkVersion: OPENDAW_SDK_VERSION, rate: RATE, bpm: PLAY_MODE_BPM,
      userAgent: navigator.userAgent, instrumentOffsetFrames: offsetFrames, rows: out,
    };
    try {
      await uploadSummary(`nano-play-modes-summary-${runToken}.json`, summary);
      setStatus(`Done — nano-play-modes-summary-${runToken}.json`);
    } catch (error) {
      // the sink exists on the dev server only; the public host answers 404 or 405 and the run still stands
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[nano-play-modes] summary not uploaded: ${message}`);
      setStatus(`Done (summary not uploaded: ${message})`);
    }
    setAuditState("done");
  }, []);

  const handleRun = useCallback(() => {
    if (built === null || running) return;
    setRunning(true);
    setRows([]);
    runAudit(built)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[nano-play-modes] run failed: " + message);
        setStatus(`Error: ${message}`);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [built, running, runAudit]);

  const color = (s: PlayModeRowRecord["status"]): "green" | "amber" | "red" => (s === "as-expected" ? "green" : s === "investigate" ? "amber" : "red");

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Flex align="center" gap="3">
            <MoisesLogo />
            <Heading size="7">Nano Play Modes Audit</Heading>
          </Flex>
          <DebugLinkBar links={[
            { label: "Register: debug/2026-11-04-nano-play-modes/note.md", href: NOTE_URL, kind: "note" },
            { label: "Nano demo", href: "/nano-demo.html", kind: "demo" },
          ]} />
          <Text size="2" color="gray">
            A Nano sampler holds a 1 s sine at {PLAY_MODE_SAMPLE_HZ} Hz, root key {PLAY_MODE_ROOT_KEY}, attack and release 1 ms. Each row writes
            its own notes at bar 1, sets Mode, One-shot, Fixed pitch and Pan as the row says, renders offline and reads the render: the
            {" "}{PLAY_MODE_SAMPLE_HZ} Hz envelope across a second note's onset (Mono / Poly), one note's length (One-shot), the notes'
            frequencies (Fixed pitch) or the two channels' peaks (Pan). Offline render at {RATE} Hz, {PLAY_MODE_BPM} bpm, SDK {OPENDAW_SDK_VERSION}.
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
          <Card>
            <Flex direction="column" gap="3">
              <Button onClick={handleRun} disabled={built === null || running} data-testid="run" style={{ alignSelf: "flex-start" }}>
                <PlayIcon /> {running ? "Rendering…" : "Run audit"}
              </Button>
              <Table.Root size="1" variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>row</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>status</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>figure</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>render</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {ROWS.map((row) => {
                    const record = rows.find((r) => r.id === row.id);
                    return (
                      <Table.Row key={row.id}>
                        <Table.Cell>
                          <Flex direction="column">
                            <Text size="1" weight="bold">{row.id}</Text>
                            <Text size="1" color="gray">{row.label}</Text>
                          </Flex>
                        </Table.Cell>
                        <Table.Cell>{record === undefined ? <Badge color="gray">pending</Badge> : <Badge color={color(record.status)}>{record.status}</Badge>}</Table.Cell>
                        <Table.Cell>{record?.figure ?? "—"}</Table.Cell>
                        <Table.Cell>{record === undefined ? "—" : `${record.renderMs} ms`}</Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
              <Text size="1" color="gray">
                Instrument offset {offset === null ? "—" : `${offset} frames`} from the first row's first note, applied to the overlap reader's windows.
                A row reads <Badge color="amber">investigate</Badge> when the render misses the row's expectation; the expectation is the crate's documented
                behaviour (Mono fades over 5 ms, One-shot plays to the region's end unless the loop is on, Fixed pitch plays the root key with Octave applied,
                Pan keeps the near side at 1 and turns the far side down).
              </Text>
            </Flex>
          </Card>
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
