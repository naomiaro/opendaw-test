/**
 * The browser half of the Chromium 388871416 readout (`?issue=output-latency`). The click
 * resumes a context, then every second for `READ_SECONDS` it reads `baseLatency`,
 * `outputLatency`, `sinkId` and the label of the output device in use, and reports each row.
 * There is no classifier: the figures are the finding. Connect a Bluetooth output while it
 * runs and read the rows before and after.
 */

import { withDeadline } from "@/lib/deadline";
import { browserOf, newRunToken, platformOf, runDate, type PlatformNavigator, type ProbeEnvelope } from "./chromiumWatched";

export const READ_SECONDS = 30;
const DEADLINE_MS = 5000;

interface Row {
  t: number;
  baseMs: number;
  outputMs: number;
  sinkId: string;
  label: string;
  /** The matching output was found but its label was empty: no media permission. */
  hidden: boolean;
}

const ms = (seconds: number): number => Math.round(seconds * 1000 * 10) / 10;

/** The label of the output device in use: the `default` entry for an empty sink id. */
async function outputLabel(sinkId: string): Promise<{ label: string; hidden: boolean }> {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    const match = devices.find((d) => d.deviceId === (sinkId === "" ? "default" : sinkId));
    if (match === undefined) return { label: "(no matching output)", hidden: false };
    return match.label === "" ? { label: "(label hidden)", hidden: true } : { label: match.label, hidden: false };
  } catch (error) {
    return { label: "(enumerateDevices threw: " + String(error) + ")", hidden: false };
  }
}

const wait = (signal: AbortSignal, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(id); resolve(); }, { once: true });
  });

export async function runOutputLatencyProbe(
  signal: AbortSignal,
  report: (step: string) => void
): Promise<ProbeEnvelope> {
  const platform = await platformOf(navigator as unknown as PlatformNavigator);
  const context = new AudioContext();
  const base = {
    issue: "output-latency" as const,
    chrome: browserOf(navigator),
    date: runDate(),
    runToken: newRunToken(),
  };
  try {
    report("resume");
    await withDeadline(context.resume(), DEADLINE_MS, "context.resume()");
    if (context.state !== "running") {
      return { ...base, verdict: "NOT CHECKED context-" + context.state, figures: { sampleRate: context.sampleRate } };
    }
    const rows: Row[] = [];
    for (let t = 0; t <= READ_SECONDS && !signal.aborted; t++) {
      const reported = (context as AudioContext & { sinkId?: unknown }).sinkId;
      const sinkId = typeof reported === "string" ? reported : "";
      const device = await outputLabel(sinkId);
      const row: Row = {
        t,
        baseMs: ms(context.baseLatency),
        outputMs: ms(context.outputLatency),
        sinkId,
        label: device.label,
        hidden: device.hidden,
      };
      rows.push(row);
      report(`t=${t}s base ${row.baseMs} ms, output ${row.outputMs} ms, ${row.label}`);
      if (t < READ_SECONDS) await wait(signal, 1000);
    }
    const outputs = rows.map((r) => r.outputMs);
    const first = rows[0];
    const last = rows[rows.length - 1];
    return {
      ...base,
      verdict: "MEASURED",
      figures: {
        rows: rows.map((r) => `${r.t},${r.baseMs},${r.outputMs},${r.label}`).join(" | "),
        firstBaseMs: first.baseMs,
        firstOutputMs: first.outputMs,
        lastBaseMs: last.baseMs,
        lastOutputMs: last.outputMs,
        minOutputMs: Math.min(...outputs),
        maxOutputMs: Math.max(...outputs),
        labelsHidden: rows.every((r) => r.hidden) ? "true" : "false",
        detail: rows.every((r) => r.hidden)
          ? "labels hidden (no media permission): read the outputLatency jump, not the label, as the switch"
          : "labels read",
        deviceLabels: [...new Set(rows.map((r) => r.label))].join(" | "),
        sinkIds: [...new Set(rows.map((r) => r.sinkId === "" ? "(default)" : r.sinkId))].join(" | "),
        sampleRate: context.sampleRate,
        userAgent: platform.userAgent,
        uaFullVersion: platform.uaFullVersion,
        platformVersion: platform.platformVersion,
      },
    };
  } finally {
    void context.close();
  }
}
