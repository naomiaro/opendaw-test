/**
 * The browser half of the acoustic round trip for Chromium 388871416
 * (`?issue=output-latency&roundtrip=1`). The click opens the built-in microphone (echo
 * cancellation, noise suppression and gain control off, as the capture-gaps probe does) into a
 * worklet recorder, reads the context's reported latencies one second after resume, and plays
 * `CLICKS` reference clicks (6 kHz, 8 ms: the constants of `loopbackInjection.ts`) one second
 * apart at known context times. Each click's arrival is found in the capture by
 * `chromiumRoundTrip.ts`; the round trip is the arrival minus the scheduled time, and includes
 * the microphone's own input latency, which is the same for any output and cancels in a
 * difference between two outputs. `&sink=<text>` routes the context to the audio output whose
 * label contains the text (the `sinkId` option of a context made after the microphone is open, when labels are readable), so a
 * run does not depend on the system's default output. The recorder reuses the capture-gaps probe's chunked pattern.
 */

import { WavFile } from "@opendaw/lib-dsp";
import { withDeadline } from "@/lib/deadline";
import { REF_CLICK_DURATION_SEC, REF_CLICK_GAIN, REF_CLICK_HZ } from "./loopbackInjection";
import { recorderChunkFrames } from "./chromiumCaptureGaps";
import { findClickOffsets, median, percentile } from "./chromiumRoundTrip";
import { browserOf, newRunToken, platformOf, runDate, type PlatformNavigator, type ProbeEnvelope } from "./chromiumWatched";

export const CLICKS = 10;
export const MIN_CLICKS_FOUND = 5;

const PROCESSOR_NAME = "chromium-round-trip-recorder";
const DEADLINE_MS = 5000;
const SETTLE_MS = 1000;
const FIRST_CLICK_AFTER_SEC = 0.5;
const TAIL_SEC = 1.5;
const QUANTUM = 128;

/** Copies channel 0 into whole-quantum chunks, the first message also naming the context frame it began at. */
const PROCESSOR_SOURCE = `
class RoundTripRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.total = options.processorOptions.frames;
    this.chunkFrames = options.processorOptions.chunkFrames;
    this.taken = 0;
    this.startFrame = null;
    this.begin();
  }
  begin() {
    this.chunk = new Float32Array(Math.min(this.chunkFrames, this.total - this.taken));
    this.filled = 0;
  }
  process(inputs) {
    if (this.taken >= this.total) return false;
    if (this.startFrame === null) this.startFrame = currentFrame;
    const input = inputs[0];
    const count = Math.min(${QUANTUM}, this.chunk.length - this.filled);
    if (input.length > 0) this.chunk.set(input[0].subarray(0, count), this.filled);
    this.filled += count;
    this.taken += count;
    if (this.filled === this.chunk.length) {
      this.port.postMessage({ samples: this.chunk, startFrame: this.startFrame }, [this.chunk.buffer]);
      if (this.taken < this.total) this.begin();
    }
    return this.taken < this.total;
  }
}
registerProcessor("${PROCESSOR_NAME}", RoundTripRecorder);
`;

const stepOf = (error: unknown): string => String(error instanceof Error ? error.message : error).replace(/\s+/g, "-");
const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

async function saveWav(samples: Float32Array, sampleRate: number, runToken: string): Promise<string> {
  const name = `chromium-output-latency-${runToken}.wav`;
  if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return "not-dev-server";
  try {
    const body = WavFile.encodeFloats({ sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples });
    const put = await fetch("/__verify/" + name, { method: "PUT", body });
    return put.ok ? name : `http-${put.status}`;
  } catch (error) {
    return stepOf(error);
  }
}

export async function runRoundTripProbe(_signal: AbortSignal, report: (step: string) => void): Promise<ProbeEnvelope> {
  const platform = await platformOf(navigator as unknown as PlatformNavigator);
  const base = { issue: "output-latency" as const, chrome: browserOf(navigator), date: runDate(), runToken: newRunToken() };
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  try {
    report("open-mic");
    try {
      stream = await withDeadline(
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
        30000,
        "getUserMedia",
      );
    } catch (error) {
      return { ...base, verdict: `NOT CHECKED mic-${stepOf(error)}`, figures: {} };
    }
    const track = stream.getAudioTracks()[0];
    if (track === undefined) return { ...base, verdict: "NOT CHECKED mic-no-audio-track", figures: {} };
    const sinkWanted = new URLSearchParams(window.location.search).get("sink");
    let sinkLabel: string | null = null;
    let sinkId: string | undefined;
    if (sinkWanted !== null) {
      const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
      const target = outputs.find((d) => d.label.toLowerCase().includes(sinkWanted.toLowerCase()) && d.deviceId !== "default");
      if (target === undefined) throw new Error(`no-output-labelled-${sinkWanted}-among-${outputs.map((d) => d.label).join("+")}`);
      sinkId = target.deviceId;
      sinkLabel = target.label;
    }
    context = new AudioContext({ latencyHint: "interactive", ...(sinkId === undefined ? {} : { sinkId }) } as AudioContextOptions);
    await withDeadline(context.resume(), DEADLINE_MS, "resume");
    if (context.state !== "running") throw new Error(`context-${context.state}`);
    const url = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }));
    try {
      await withDeadline(context.audioWorklet.addModule(url), DEADLINE_MS, "addModule");
    } finally {
      URL.revokeObjectURL(url);
    }
    const rate = context.sampleRate;
    const seconds = SETTLE_MS / 1000 + FIRST_CLICK_AFTER_SEC + CLICKS + TAIL_SEC;
    const frames = Math.round(seconds * rate);
    const recorder = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      processorOptions: { frames, chunkFrames: recorderChunkFrames(rate) },
    });
    const samples = new Float32Array(frames);
    let startFrame: number | null = null;
    const captured = new Promise<void>((resolve, reject) => {
      let offset = 0;
      recorder.port.onmessage = (event: MessageEvent<{ samples: Float32Array; startFrame: number }>) => {
        startFrame ??= event.data.startFrame;
        samples.set(event.data.samples, offset);
        offset += event.data.samples.length;
        if (offset >= frames) resolve();
      };
      recorder.onprocessorerror = () => reject(new Error("recorder-threw"));
    });
    new MediaStreamAudioSourceNode(context, { mediaStream: stream }).connect(recorder);
    report("settle");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const reportedOutputMs = context.outputLatency * 1000;
    const reportedBaseMs = context.baseLatency * 1000;
    report("clicks");
    const clickGain = Number(new URLSearchParams(window.location.search).get("gain") ?? REF_CLICK_GAIN);
    const burst = context.createBuffer(1, Math.round(REF_CLICK_DURATION_SEC * rate), rate);
    const data = burst.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = clickGain * Math.sin((2 * Math.PI * REF_CLICK_HZ * i) / rate);
    const firstAt = Math.ceil((context.currentTime + FIRST_CLICK_AFTER_SEC) * rate) / rate;
    const scheduled: number[] = [];
    for (let k = 0; k < CLICKS; k++) {
      const at = firstAt + k;
      const source = new AudioBufferSourceNode(context, { buffer: burst });
      source.connect(context.destination);
      source.start(at);
      scheduled.push(at);
    }
    await withDeadline(captured, (seconds + 10) * 1000, "capture");
    report("judge");
    const begin = startFrame as number | null;
    if (begin === null) throw new Error("recorder-never-started");
    const expected = scheduled.map((at) => at * rate - begin);
    const offsets = findClickOffsets(samples, rate, expected, REF_CLICK_HZ, REF_CLICK_DURATION_SEC);
    const roundTripsMs = offsets.map((o) => (o === null ? null : (o / rate) * 1000));
    const found = roundTripsMs.filter((v): v is number => v !== null);
    const missed = roundTripsMs.flatMap((v, i) => (v === null ? [i + 1] : []));
    const wav = await saveWav(samples, rate, base.runToken);
    const settings = track.getSettings();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const output = devices.find((d) => d.kind === "audiooutput" && d.deviceId === "default");
    const usedSink = (context as AudioContext & { sinkId?: unknown }).sinkId;
    const verdict = found.length < MIN_CLICKS_FOUND ? `NOT CHECKED ${found.length}-of-${CLICKS}-clicks-found-missed-${missed.join("-")}` : "MEASURED";
    return {
      ...base,
      verdict,
      figures: {
        roundTripsMs: roundTripsMs.map((v) => (v === null ? "miss" : round(v))).join(" "),
        medianMs: median(found) === null ? null : round(median(found) as number),
        p95Ms: percentile(found, 95) === null ? null : round(percentile(found, 95) as number),
        clicksFound: found.length,
        clicksMissed: missed.join(" "),
        reportedOutputLatencyMs: round(reportedOutputMs),
        clickGain,
        reportedOutputLatencyAtEndMs: round(context.outputLatency * 1000),
        reportedBaseLatencyMs: round(reportedBaseMs),
        outputLabel: sinkLabel ?? (output?.label || "(label hidden)"),
        sinkRequested: sinkWanted,
        sinkIdUsed: typeof usedSink === "string" && usedSink !== "" ? usedSink : "(default)",
        micLabel: track.label,
        micSampleRate: settings.sampleRate ?? null,
        micChannelCount: settings.channelCount ?? null,
        micEchoCancellation: settings.echoCancellation === undefined ? null : String(settings.echoCancellation),
        micLatency: (settings as { latency?: number }).latency ?? null,
        sampleRate: rate,
        wav,
        userAgent: platform.userAgent,
        uaFullVersion: platform.uaFullVersion,
        platformVersion: platform.platformVersion,
      },
    };
  } catch (error) {
    return { ...base, verdict: `NOT CHECKED ${stepOf(error)}`, figures: {} };
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
    void context?.close();
  }
}
