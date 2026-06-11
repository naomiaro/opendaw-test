// src/demos/warp/audio-verify-debug.tsx
// Unlisted offline-render harness for the audio-verify skill. Renders one warp
// scenario (?scenario=raw|varispeed|timestretch|grid-conform|grid-rigid) to a
// full-song WAV and PUTs it to the dev server's /__verify sink.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PPQN, WavFile } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { TransientPlayMode } from "@opendaw/studio-enums";
import {
  buildWarpAnchors,
  barsToTempoEvents,
} from "@/lib/beats/beatMapConversions";
import { ensureTransientMarkers } from "@/lib/transientDetection";
import { renderMixdownRange } from "@/lib/rangeExport";
import { setupWarpDemo } from "./lib/setupWarpDemo";
import {
  applyRaw,
  applyVarispeed,
  applyTimeStretch,
  applyGridPlacement,
  applyGridTempoEvents,
  rawEndPpqn,
  gridEndTick,
  type WarpScenarioContext,
} from "./lib/warpScenarios";

const QUARTER = PPQN.Quarter;
const SCENARIOS = ["raw", "varispeed", "timestretch", "grid-conform", "grid-rigid"] as const;
type Scenario = (typeof SCENARIOS)[number];

function isScenario(value: string | null): value is Scenario {
  return SCENARIOS.includes(value as Scenario);
}

async function runScenario(
  scenario: Scenario,
  setState: (state: string, detail?: string) => void
): Promise<void> {
  setState("setup");
  const localAudioBuffers = new Map<string, AudioBuffer>();
  const setup = await setupWarpDemo({
    localAudioBuffers,
    onStatusUpdate: (s) => setState("setup", s),
  });
  const { project, audioBuffer, markers, projectBpm } = setup;
  const ctx: WarpScenarioContext = {
    project,
    region: setup.region,
    audioBuffer,
    markers,
    projectBpm,
    prevStretchBox: null,
  };
  const anchors = buildWarpAnchors(markers, audioBuffer.duration, QUARTER);

  let endPpqn: number;
  let metronome = false;
  switch (scenario) {
    case "raw":
      applyRaw(ctx);
      endPpqn = rawEndPpqn(ctx);
      break;
    case "varispeed":
      applyVarispeed(ctx, anchors);
      endPpqn = anchors[anchors.length - 1].tick;
      break;
    case "timestretch":
      setState("setup", "Detecting transients...");
      await ensureTransientMarkers(project, setup.audioFileBox, audioBuffer);
      applyTimeStretch(ctx, anchors, TransientPlayMode.Pingpong);
      endPpqn = anchors[anchors.length - 1].tick;
      break;
    case "grid-conform":
    case "grid-rigid": {
      applyGridPlacement(ctx);
      const events =
        scenario === "grid-conform"
          ? barsToTempoEvents(markers, QUARTER)
          : [{ tick: 0, bpm: projectBpm }];
      applyGridTempoEvents({ project }, events);
      endPpqn = gridEndTick(markers);
      // The audio is identical in both grid scenarios by design — the grid is
      // only audible via the metronome, so the clicks must be in the render.
      metronome = true;
      break;
    }
  }

  setState("rendering", `0..${endPpqn} ticks, metronome ${metronome ? "on" : "off"}`);
  const result = await renderMixdownRange({
    project,
    startPpqn: 0 as ppqn,
    endPpqn: endPpqn as ppqn,
    metronomeEnabled: metronome,
    metronomeGain: 0,
  });

  setState("uploading");
  // Duck-typed AudioBufferLike: skips channelsToAudioBuffer's ~48 MB copy of
  // the full-song render before encoding.
  const wav = WavFile.encodeFloats({
    sampleRate: result.sampleRate,
    length: result.channels[0].length,
    numberOfChannels: result.channels.length,
    getChannelData: (i: number) => result.channels[i],
  });
  const response = await fetch(`/__verify/verify-${scenario}.wav`, {
    method: "PUT",
    body: wav,
  });
  if (!response.ok) {
    throw new Error(`verify sink rejected upload: HTTP ${response.status}`);
  }
  setState("done", `verify-${scenario}.wav (${(wav.byteLength / 1e6).toFixed(1)} MB)`);
}

function AudioVerifyHarness() {
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const scenario = new URLSearchParams(window.location.search).get("scenario");
    const update = (s: string, d?: string) => {
      setState(s);
      setDetail(d ?? ""); // clear stale progress detail on undetailed transitions (e.g. errors)
    };
    if (!isScenario(scenario)) {
      update(`error:unknown scenario "${scenario}" — use ?scenario=${SCENARIOS.join("|")}`);
      return;
    }
    runScenario(scenario, update).catch((err) => {
      console.error("[audio-verify]", err);
      update(`error:${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);

  return (
    <main style={{ fontFamily: "monospace", padding: 24, color: "#ddd", background: "#111", minHeight: "100vh" }}>
      <h1>audio-verify harness</h1>
      <p>
        state: <span id="verify-state" data-verify-state={state}>{state}</span>
      </p>
      <p>{detail}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AudioVerifyHarness />);
