// Stretch Placement Audit — unlisted page.
//
//   stretch-placement-debug-demo.html[?rate=48000|44100][&row=all|<id>]
//
// One Tape plays a train of eight short tone bursts. Each row puts the train in one audio region with a play mode
// (none, varispeed, Signalsmith), a stretch and a transpose, renders offline and reads where each burst comes out
// against where the warp map puts it. Rows and readers: src/lib/audit/stretchPlacement.ts; register:
// debug/2026-11-23-stretch-grid-placement/note.md. DOM contract: #audit-state carries data-audit-state walking
// idle → running:<row> → done | error:<message>. The summary goes to the dev server's /__verify sink as
// stretch-placement-summary-<runToken>.json.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { TimeBase } from "@opendaw/lib-dsp";
import { OPENDAW_SDK_VERSION } from "@opendaw/studio-sdk";
import type { Project } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import {
  AudioFileBox, AudioPitchStretchBox, AudioRegionBox, AudioSignalsmithBox, ValueEventCollectionBox, WarpMarkerBox, type TrackBox,
} from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DebugLinkBar } from "@/components/DebugLinkBar";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { renderOfflineSlice } from "@/lib/offlineScan";
import { resolveRate, type RenderRate } from "@/lib/audit/midiEffectScenarios";
import { awaitSampleLoaded, uploadSummary } from "@/lib/audit/midiEffectBootstrap";
import { removeMasterMaximizer } from "@/lib/audit/midiEffectChain";
import {
  CENTRED_FRAMES, CLICK_COUNT, CLICK_HZ, CLICK_SECONDS, clickTrain, judgePlacement, PLACEMENT_BPM, regionPulses, renderSeconds, resolveRows,
  SIGNALSMITH_BLOCK_FRAMES, SIGNALSMITH_HOP_FRAMES, SMEAR_LIMIT_FRAMES, SOURCE_SECONDS, type ClickRead, type PlacementRow, type PlacementStatus,
} from "@/lib/audit/stretchPlacement";
import "@radix-ui/themes/styles.css";
import { Badge, Button, Callout, Card, Container, Flex, Heading, Table, Text, Theme } from "@radix-ui/themes";
import { InfoCircledIcon, PlayIcon } from "@radix-ui/react-icons";

const params = new URLSearchParams(window.location.search);
let PARAM_ERROR: string | null = null;
let RATE: RenderRate = 48000;
let ROWS: readonly PlacementRow[] = [];
try {
  RATE = resolveRate(params.get("rate"));
  ROWS = resolveRows(params.get("row"));
} catch (error) {
  PARAM_ERROR = error instanceof Error ? error.message : String(error);
}

const NOTE_URL = "https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-23-stretch-grid-placement/note.md";
const SCHEMA_VERSION = 1;

interface RowRecord {
  id: string;
  label: string;
  status: PlacementStatus | "error";
  figure: string;
  values: Readonly<Record<string, number | null>>;
  clicks: readonly ClickRead[];
  renderMs: number;
}

interface Built {
  project: Project;
  trackBox: TrackBox;
  fileUuid: UUID.Bytes;
}

/** What a row left on the track, by uuid: a held box does not survive a transaction that deletes it. */
interface Placed {
  region: UUID.Bytes;
  playMode: UUID.Bytes | null;
}

async function build(localAudioBuffers: Map<string, AudioBuffer>, onStatus: (s: string) => void): Promise<Built> {
  const { project, audioContext } = await initializeOpenDAW({ localAudioBuffers, bpm: PLACEMENT_BPM, audioContextSampleRate: RATE, onStatusUpdate: onStatus });
  const train = clickTrain(RATE);
  const buffer = audioContext.createBuffer(2, train.length, RATE);
  buffer.getChannelData(0).set(train);
  buffer.getChannelData(1).set(train);
  const fileUuid = UUID.generate();
  localAudioBuffers.set(UUID.toString(fileUuid), buffer);
  const { trackBox } = project.editing
    .modify(() => {
      project.timelineBox.loopArea.enabled.setValue(false);
      return project.api.createInstrument(InstrumentFactories.Tape);
    })
    .unwrap("createInstrument");
  const master = project.rootBoxAdapter.audioUnits.adapters().find((unit) => unit.isOutput);
  if (master === undefined) throw new Error("the project has no master unit");
  const removed = removeMasterMaximizer(project.editing, master.audioEffects.unwrap("the master hosts no audio-effect chain").adapters());
  if (removed !== 1) throw new Error(`expected one Maximizer on the master, removed ${removed}`);
  return { project, trackBox, fileUuid };
}

/**
 * The row's region in place of the previous one, one transaction. Deleting a region takes what only it pointed at
 * along: its event collection, its play mode with the warp markers, and the file box (a box that must have a
 * pointer goes with its last one). So the file box is rebuilt under the same uuid for every row, which is why the
 * caller waits for the sample's loader again each time.
 */
function place({ project, trackBox, fileUuid }: Built, row: PlacementRow, previous: Placed | null): Placed {
  const { boxGraph } = project;
  const pulses = regionPulses(row);
  return project.editing
    .modify((): Placed => {
      if (previous !== null) {
        boxGraph.findBox(previous.region).unwrap("the previous region is gone").delete();
        // already gone with the region; kept in case a later SDK stops cascading to it
        if (previous.playMode !== null) boxGraph.findBox(previous.playMode).ifSome((box) => box.delete());
      }
      const fileBox = boxGraph.findBox<AudioFileBox>(fileUuid).unwrapOrElse(() =>
        AudioFileBox.create(boxGraph, fileUuid, (box) => {
          box.fileName.setValue("click-train.wav");
          box.endInSeconds.setValue(SOURCE_SECONDS);
        }));
      const playMode = row.mode === "none" ? null
        : row.mode === "varispeed" ? AudioPitchStretchBox.create(boxGraph, UUID.generate())
        : AudioSignalsmithBox.create(boxGraph, UUID.generate(), (box) => box.transpose.setValue(row.transpose));
      if (playMode !== null) {
        // the whole source over the region's length: (0, 0 s) and (end, the source's length)
        for (const [position, seconds] of [[0, 0], [pulses, SOURCE_SECONDS]] as const) {
          WarpMarkerBox.create(boxGraph, UUID.generate(), (marker) => {
            marker.owner.refer(playMode.warpMarkers);
            marker.position.setValue(position);
            marker.seconds.setValue(seconds);
          });
        }
      }
      const events = ValueEventCollectionBox.create(boxGraph, UUID.generate());
      const region = AudioRegionBox.create(boxGraph, UUID.generate(), (box) => {
        box.regions.refer(trackBox.regions);
        box.file.refer(fileBox);
        box.events.refer(events.owners);
        box.position.setValue(row.position);
        box.loopOffset.setValue(0);
        box.label.setValue(row.id);
        if (playMode === null) {
          box.timeBase.setValue(TimeBase.Seconds);
          box.duration.setValue(SOURCE_SECONDS);
          box.loopDuration.setValue(SOURCE_SECONDS);
        } else {
          box.playMode.refer(playMode);
          box.timeBase.setValue(TimeBase.Musical);
          box.duration.setValue(pulses);
          box.loopDuration.setValue(pulses);
        }
      });
      return { region: region.address.uuid, playMode: playMode === null ? null : playMode.address.uuid };
    })
    .unwrap(`no region placed for ${row.id}`);
}

const App: React.FC = () => {
  const [status, setStatus] = useState(PARAM_ERROR === null ? "Loading..." : `Error: ${PARAM_ERROR}`);
  const [auditState, setAuditState] = useState(PARAM_ERROR === null ? "idle" : `error:${PARAM_ERROR}`);
  const [built, setBuilt] = useState<Built | null>(null);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowRecord[]>([]);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const placedRef = useRef<Placed | null>(null);

  useEffect(() => {
    if (PARAM_ERROR !== null) return;
    let mounted = true;
    build(localAudioBuffersRef.current, setStatus)
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
    const runToken = Date.now();
    const out: RowRecord[] = [];
    for (const row of ROWS) {
      setAuditState(`running:${row.id}`);
      setStatus(`Rendering: ${row.label}`);
      const started = performance.now();
      placedRef.current = place(b, row, placedRef.current);
      await awaitSampleLoaded(b.project, b.fileUuid);
      const { channels } = await renderOfflineSlice(b.project, 0, renderSeconds(row), RATE);
      const verdict = judgePlacement(row, channels[0], RATE);
      out.push({ id: row.id, label: row.label, status: verdict.status, figure: verdict.figure, values: verdict.values, clicks: verdict.clicks, renderMs: Math.round(performance.now() - started) });
      setRows([...out]);
    }
    const summary = { schemaVersion: SCHEMA_VERSION, runToken, sdkVersion: OPENDAW_SDK_VERSION, rate: RATE, bpm: PLACEMENT_BPM, userAgent: navigator.userAgent, rows: out };
    try {
      await uploadSummary(`stretch-placement-summary-${runToken}.json`, summary);
      setStatus(`Done — stretch-placement-summary-${runToken}.json`);
    } catch (error) {
      // the sink exists on the dev server only: the public host answers 404 or 405 and the run still stands
      const message = error instanceof Error ? error.message : String(error);
      if (!/HTTP 40[45]\b/.test(message)) throw error;
      console.warn(`[stretch-placement] summary not uploaded: no /__verify sink on this host (${message})`);
      setStatus(`Done (no /__verify sink on this host: ${message})`);
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
        console.error("[stretch-placement] run failed: " + message);
        setStatus(`Error: ${message}`);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [built, running, runAudit]);

  const color = (s: RowRecord["status"]): "green" | "amber" | "red" => (s === "as-expected" ? "green" : s === "investigate" ? "amber" : "red");

  return (
    <Theme appearance="dark" accentColor="orange" radius="medium">
      <GitHubCorner />
      <Container size="3" p="5">
        <Flex direction="column" gap="4">
          <BackLink />
          <Flex align="center" gap="3">
            <MoisesLogo />
            <Heading size="7">Stretch Placement Audit</Heading>
          </Flex>
          <DebugLinkBar links={[
            { label: "Register: debug/2026-11-23-stretch-grid-placement/note.md", href: NOTE_URL, kind: "note" },
            { label: "Signalsmith warp demo", href: "/warp-signalsmith-demo.html", kind: "demo" },
          ]} />
          <Text size="2" color="gray">
            One Tape plays {CLICK_COUNT} bursts of {CLICK_HZ} Hz, {CLICK_SECONDS * 1000} ms each, half a second apart in a {SOURCE_SECONDS} s
            source. Each row puts the source in one audio region with a play mode, a stretch (two warp markers: the whole source over the
            region's length) and a transpose, renders offline and reads each burst against where the warp map puts it: the energy centroid
            and the largest sample, in frames after (+) or before (−) the expected centre. Offline render at {RATE} Hz, {PLACEMENT_BPM} bpm,
            SDK {OPENDAW_SDK_VERSION}.
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
                A row whose audio is not processed (no play mode, varispeed, Signalsmith with no stretch and no transpose) reads{" "}
                <Badge color="green">as-expected</Badge> when every burst is within a frame of the warp map. A processed Signalsmith row
                spreads a burst across its {SIGNALSMITH_BLOCK_FRAMES}-frame block (one every {SIGNALSMITH_HOP_FRAMES} frames), so it is
                judged for a constant offset only: the median centroid within ±{CENTRED_FRAMES} frames and no burst further than
                ±{SMEAR_LIMIT_FRAMES}. <Badge color="amber">investigate</Badge> is anything further,{" "}
                <Badge color="red">unreadable</Badge> a burst that did not sound.
              </Text>
            </Flex>
          </Card>
        </Flex>
      </Container>
    </Theme>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
