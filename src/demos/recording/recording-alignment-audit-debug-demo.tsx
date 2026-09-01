// src/demos/recording/recording-alignment-audit-debug-demo.tsx
// Unlisted harness for the recording start-alignment audit
// (`.superpowers/sdd/2026-09-01-recording-start-alignment-audit/`). This
// task implements ONLY `?scenario=probe` — the HARD GATE that decides
// whether the same-context loopback injection topology (see
// src/lib/audit/loopbackInjection.ts) actually reaches CaptureAudio with
// signal, before the rest of the campaign is built on top of it.
//
// Probe procedure: boot the engine with the loopback device installed,
// arm a Tape onto it, schedule reference clicks, record ~4s (no count-in —
// startRecording(false) — with the metronome routed into the loopback's low
// band), then measure the RMS of the resulting take region. PASS (rms > 0.005) proves the
// SAME-context MediaStreamAudioDestinationNode topology is viable; FAIL
// means the cross-context silent-capture failure mode also affects this
// topology, and the campaign cannot proceed without a real-mic or
// virtual-audio-device fallback (see the "Don't Synthesize Input" rule in
// src/demos/recording/CLAUDE.md).
//
// DOM contract: #audit-state carries data-audit-state walking
// setup -> running:probe -> done (or error:<message>).
// #probe-verdict carries data-verdict={verdict} once the probe completes.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Flex, Heading, Table, Text, Theme, Container } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { CaptureAudio } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import { installLoopbackCapture, LOOPBACK_DEVICE_ID } from "@/lib/audit/loopbackInjection";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { withDeadline } from "@/lib/deadline";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";

const params = new URLSearchParams(window.location.search);
const rate = Number(params.get("rate") ?? "48000");
/** RMS floor above which capture is judged non-silent — see module header. */
const RMS_PASS_THRESHOLD = 0.005;
/** How long to record before stopping (no count-in — startRecording(false)). */
const RECORD_WINDOW_MS = 4000;
const FINALIZE_DEADLINE_MS = 30_000;

// Installed at module scope, BEFORE any SDK code can touch mediaDevices.
const loopback = installLoopbackCapture();

type ProbeRow = { label: string; value: string };

async function runProbe(onRow: (row: ProbeRow) => void): Promise<string> {
  console.log("[recording-alignment-audit] probe: booting engine, rate=" + rate);
  const { project, audioContext } = await initializeOpenDAW({
    bpm: 120,
    audioContextSampleRate: rate,
    engineTap: (node) => loopback.engineTap(node),
  });
  loopback.attach(audioContext);
  onRow({ label: "context rate", value: String(audioContext.sampleRate) });

  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;

  // Tape + capture (three transactions — createInstrument, then capture fields; armed is not a box field)
  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    audioUnitBox = project.api.createInstrument(InstrumentFactories.Tape).audioUnitBox;
  });
  if (audioUnitBox === null) throw new Error("probe: createInstrument did not return audioUnitBox");
  const capture = project.captureDevices.get(audioUnitBox.address.uuid).unwrap();
  if (!(capture instanceof CaptureAudio)) throw new Error("probe: capture is not CaptureAudio");
  project.editing.modify(() => {
    capture.captureBox.deviceId.setValue(LOOPBACK_DEVICE_ID);
    capture.requestChannels = 1;
  });
  capture.armed.setValue(true);
  console.log("[recording-alignment-audit] probe: tape armed on loopback device");

  // Schedule reference clicks covering the whole probe window.
  const now = audioContext.currentTime;
  loopback.scheduleReferenceClicks(Array.from({ length: 30 }, (_, i) => now + 0.5 + i * 0.25));

  project.engine.setPosition(0);
  project.startRecording(false);
  console.log("[recording-alignment-audit] probe: recording started");
  // DIAGNOSTIC (temporary): poll transport state during the record window to
  // distinguish "position never advanced" (known WASM transport-start quirk,
  // see src/demos/engine/CLAUDE.md) from a loopback-routing failure.
  const pollStart = Date.now();
  const pollTimer = setInterval(() => {
    console.log(
      "[recording-alignment-audit] probe: t=" + (Date.now() - pollStart) +
      "ms position=" + project.engine.position.getValue().toFixed(1) +
      " isRecording=" + project.engine.isRecording.getValue() +
      " isCountingIn=" + project.engine.isCountingIn.getValue()
    );
  }, 500);
  await new Promise((r) => setTimeout(r, RECORD_WINDOW_MS));
  clearInterval(pollTimer);
  project.engine.stopRecording();
  console.log("[recording-alignment-audit] probe: recording stopped, waiting for finalization");

  // Find the take region and wait for its loader.
  const unitAdapter = project.rootBoxAdapter.audioUnits.adapters()
    .find((u) => u.box === capture.audioUnitBox);
  if (!unitAdapter) throw new Error("probe: no audio unit adapter");
  const regions = unitAdapter.tracks.values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion());
  onRow({ label: "regions", value: String(regions.length) });
  if (regions.length === 0) return "FAIL: no take region created";

  const loader = regions[0].file.getOrCreateLoader();
  if (loader.state.type !== "loaded") {
    await withDeadline(new Promise<void>((resolvePromise, reject) => {
      let subscribed = false;
      const sub = loader.subscribe((state) => {
        if (state.type === "loaded") { resolvePromise(); if (subscribed) sub.terminate(); }
        if (state.type === "error") { reject(new Error(String(state.reason))); if (subscribed) sub.terminate(); }
      });
      subscribed = true;
    }), FINALIZE_DEADLINE_MS, "probe finalization");
  }
  const dataOpt = loader.data;
  if (dataOpt.isEmpty()) return "FAIL: loader loaded but data empty";
  const data = dataOpt.unwrap();
  const ch0 = data.frames[0];
  let sumSq = 0;
  for (let i = 0; i < ch0.length; i++) sumSq += ch0[i] * ch0[i];
  const rms = Math.sqrt(sumSq / ch0.length);
  onRow({ label: "frames", value: String(data.numberOfFrames) });
  onRow({ label: "rms", value: rms.toFixed(6) });
  project.engine.stop(true);
  console.log("[recording-alignment-audit] probe: measured rms=" + rms.toFixed(6));
  // GATE: cross-context failure mode reads as silence. Same-context must not.
  return rms > RMS_PASS_THRESHOLD ? "PASS" : `FAIL: silent capture (rms=${rms.toFixed(6)})`;
}

function ProbeHarness() {
  const [auditState, setAuditState] = useState("idle");
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const handleRunProbe = useCallback(() => {
    if (running) return;
    setRunning(true);
    setRows([]);
    setVerdict(null);
    setAuditState("setup");
    setAuditState("running:probe");
    runProbe((row) => setRows((prev) => [...prev, row]))
      .then((result) => {
        console.log("[recording-alignment-audit] verdict: " + result);
        setVerdict(result);
        setAuditState("done");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[recording-alignment-audit] probe error: " + message);
        setAuditState(`error:${message}`);
      })
      .finally(() => setRunning(false));
  }, [running]);

  const verdictIsPass = verdict === "PASS";

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Recording Start-Alignment Audit — Feasibility Probe
          </Heading>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Text size="2" weight="bold">
                State:
              </Text>
              <Badge
                id="audit-state"
                data-audit-state={auditState}
                color={auditState.startsWith("error") ? "red" : auditState === "done" ? "green" : "amber"}
              >
                {auditState}
              </Badge>
              <Button onClick={handleRunProbe} disabled={running}>
                Run probe
              </Button>
              {verdict !== null && (
                <Badge id="probe-verdict" data-verdict={verdict} color={verdictIsPass ? "green" : "red"}>
                  {verdict}
                </Badge>
              )}
            </Flex>
          </Card>

          <Card>
            <div style={{ overflowX: "auto" }}>
              <Table.Root size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>metric</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>value</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <Table.Row key={row.label}>
                      <Table.Cell>{row.label}</Table.Cell>
                      <Table.Cell>{row.value}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Card>

          <Card>
            <Heading size="4" style={{ marginBottom: "0.5rem" }}>
              Configuration
            </Heading>
            <pre style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {`?rate=<number>   default 48000 — forced AudioContext sample rate
Record window:    ${RECORD_WINDOW_MS / 1000}s (no count-in — startRecording(false))
Pass threshold:    rms > ${RMS_PASS_THRESHOLD}
Click "Run probe" with a real click — resumes the AudioContext.`}
            </pre>
          </Card>
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<ProbeHarness />);
