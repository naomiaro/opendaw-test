// SDK-free probe: how many channels does a MediaStreamAudioSourceNode deliver for a track that reports one?
//
// The Web Audio specification says of the node: "The number of channels of the output corresponds to the number
// of channels of the MediaStreamTrack." What it delivers decides which algorithm a StereoPannerNode after it
// applies (one channel: equal power, centre ×0.71; two: the far side folded into the near one, centre ×1 and up
// to ×2 at hard pan for identical channels). Note: `debug/2026-11-23-monitor-pan-doubles-at-hard-pan/note.md`.
//
// Rows (each stream goes through `createMediaStreamSource` into an AudioWorklet that counts the channels of
// every render quantum it is handed, and through a StereoPannerNode whose gains are read at pan −1 / 0 / +1):
//  - control: a gain node with an explicit channel count of 1, no stream (the worklet must count one channel,
//    the panner must read equal-power)
//  - control: the same with an explicit count of 2 (two channels, the panner reads doubles)
//  - a MediaStreamAudioDestinationNode with channelCount 1: its stream, and a clone of it
//  - a MediaStreamAudioDestinationNode with channelCount 2
//  - with `?input=mic`: the default microphone asked for with channelCount ideal 1, then ideal 2 (the browser
//    asks; make steady noise). Nothing is played: no node is connected to the speakers.
//
// A row's status, judged against the channel count the stream was built with (a microphone: against what its
// track reports; Firefox reports none for these streams): "follows-track" (as many channels), "upmixed" (one
// channel in, two delivered), "downmixed", "silent", or "other". The verdict on `#verdict`:
// SPEC when every stream row follows its track, UPMIXES when a one-channel track is delivered as two,
// INCONCLUSIVE when a control fails or nothing was delivered. The DOM carries what the repo's browser drivers
// read (`#run`, `#audit-state[data-audit-state]`, `#summary-note`, rows with `data-row-id` / `data-row-status`).
const USE_MICROPHONE = new URLSearchParams(location.search).get("input") === "mic";
const QUANTA = 300;
const SETTLE_MS = 500;
const PROCESSOR = `registerProcessor("channel-count", class extends AudioWorkletProcessor {
  constructor() { super(); this.calls = 0; this.seen = {}; this.difference = 0; this.peak = 0; }
  process(inputs) {
    const input = inputs[0];
    this.seen[input.length] = (this.seen[input.length] || 0) + 1;
    if (input.length > 0) for (const value of input[0]) this.peak = Math.max(this.peak, Math.abs(value));
    if (input.length > 1) for (let i = 0; i < input[0].length; i++) this.difference = Math.max(this.difference, Math.abs(input[0][i] - input[1][i]));
    if (++this.calls === ${QUANTA}) this.port.postMessage({ seen: this.seen, difference: this.difference, peak: this.peak });
    return true;
  }
});`;

type Counted = { seen: Record<string, number>; difference: number; peak: number };
type Result = { id: string; status: string; delivered: string; reported: string; identical: string; peak: string; panner: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const deadline = <T,>(what: string, promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`deadline passed: ${what}`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });

const root = document.getElementById("root")!;
root.innerHTML = `
  <h1 style="font:600 20px system-ui">MediaStreamAudioSourceNode: channels delivered for a track's channel count (debug)</h1>
  <p style="font:14px system-ui;max-width:60em">No SDK on this page. Each stream is read through <code>createMediaStreamSource</code> by an AudioWorklet that counts
  the channels it is handed, and through a StereoPannerNode. Silent; ${USE_MICROPHONE ? "the last rows open the default microphone: allow it and make steady noise." : "add <code>?input=mic</code> for rows on the default microphone."}</p>
  <button id="run" style="font:16px system-ui;padding:8px 20px">Run</button>
  <span id="audit-state" data-audit-state="idle" style="font:14px system-ui;margin-left:12px">idle</span>
  <p id="verdict" data-verdict="" style="font:600 14px system-ui"></p>
  <p id="summary-note" style="font:14px system-ui"></p>
  <table style="font:13px system-ui;border-collapse:collapse" cellpadding="6" border="1">
    <thead><tr><th>row</th><th>status</th><th>channels delivered (quanta)</th><th>track reports</th><th>channels identical</th><th>peak</th><th>StereoPannerNode after it</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>`;
const stateElement = document.getElementById("audit-state")!;
const setState = (state: string) => { stateElement.dataset.auditState = state; stateElement.textContent = state; };
const addRow = (result: Result) => {
  const row = document.createElement("tr");
  row.dataset.rowId = result.id;
  row.dataset.rowStatus = result.status;
  for (const text of [result.id, result.status, result.delivered, result.reported, result.identical, result.peak, result.panner]) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
  }
  document.getElementById("rows")!.appendChild(row);
  console.log(`[stream-source-channels] ${Object.values(result).join(" | ")}`);
};

async function run(): Promise<void> {
  const context = new AudioContext();
  const opened: MediaStream[] = [];
  try {
    await deadline("AudioContext.resume (needs a real click)", context.resume(), 10_000);
    if (context.state !== "running") throw new Error(`AudioContext is ${context.state}`);
    await deadline("addModule", context.audioWorklet.addModule(URL.createObjectURL(new Blob([PROCESSOR], { type: "text/javascript" }))), 15_000);
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    const level = context.createGain();
    level.gain.value = 0.25;
    oscillator.connect(level);
    oscillator.start();
    const buffer = new Float32Array(4096);
    const rms = (analyser: AnalyserNode) => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) sum += value * value;
      return Math.sqrt(sum / buffer.length);
    };
    const analyserOn = (node: AudioNode, output: number) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      node.connect(analyser, output);
      return analyser;
    };
    const count = (node: AudioNode): Promise<Counted> => deadline("the worklet's count", new Promise<Counted>((resolve) => {
      const worklet = new AudioWorkletNode(context, "channel-count", { numberOfInputs: 1, numberOfOutputs: 0 });
      worklet.port.onmessage = (event) => { node.disconnect(worklet); resolve(event.data as Counted); };
      node.connect(worklet);
    }), 20_000);
    // gains of a StereoPannerNode fed by `node`, each side over the node's first channel
    const panner = async (node: AudioNode): Promise<string> => {
      const pan = context.createStereoPanner();
      node.connect(pan);
      const before = context.createChannelSplitter(2);
      node.connect(before);
      const after = context.createChannelSplitter(2);
      pan.connect(after);
      const taps = { reference: analyserOn(before, 0), left: analyserOn(after, 0), right: analyserOn(after, 1) };
      const gains: number[][] = [];
      for (const position of [-1, 0, 1]) {
        pan.pan.value = position;
        await sleep(SETTLE_MS);
        if (context.state !== "running") throw new Error(`AudioContext is ${context.state} (document ${document.visibilityState})`);
        const reference = rms(taps.reference);
        gains.push(reference > 1e-5 ? [rms(taps.left) / reference, rms(taps.right) / reference] : [NaN, NaN]);
      }
      node.disconnect(pan);
      node.disconnect(before);
      pan.disconnect(after);
      if (gains.some((pair) => pair.some(Number.isNaN))) return "no signal";
      const about = (value: number, target: number) => Math.abs(value - target) < 0.1;
      const centre = gains[1];
      const hard = [gains[0][0], gains[2][1]];
      const law = centre.every((g) => about(g, Math.SQRT1_2)) && hard.every((g) => about(g, 1)) ? "equal-power"
        : centre.every((g) => about(g, 1)) && hard.every((g) => about(g, 2)) ? "doubles" : "other";
      return `${law}: centre ×${centre[0].toFixed(2)} / ×${centre[1].toFixed(2)}, hard ×${hard[0].toFixed(2)} / ×${hard[1].toFixed(2)}`;
    };
    // `built` is the channel count the source was made with (unknown for a microphone); `reported` what its track says
    const measure = async (id: string, node: AudioNode, built: number | undefined, reported: number | undefined): Promise<Result> => {
      setState(`running: ${id}`);
      const counted = await count(node);
      const law = await panner(node);
      const widths = Object.keys(counted.seen).map(Number).filter((width) => width > 0);
      // the width of most quanta: a node can hand over a first quantum at its default width before the stream's format arrives
      const delivered = widths.length === 0 ? 0 : widths.reduce((most, width) => (counted.seen[width] > counted.seen[most] ? width : most));
      const identical = delivered < 2 ? "" : counted.difference < 1e-6 ? "yes" : `no (largest difference ${counted.difference.toFixed(4)})`;
      const carries = built ?? reported;
      const status = counted.peak < 1e-5 ? "silent"
        : carries === undefined ? "other"
        : delivered === Math.min(carries, 2) ? "follows-track"
        : carries === 1 && delivered === 2 ? "upmixed"
        : delivered < carries ? "downmixed" : "other";
      const result: Result = {
        id, status, delivered: Object.entries(counted.seen).map(([width, quanta]) => `${width} ch × ${quanta}`).join(", "),
        reported: `${reported === undefined ? "not reported" : reported}${built === undefined ? "" : ` (built with ${built})`}`, identical, peak: counted.peak.toFixed(4), panner: law,
      };
      addRow(result);
      return result;
    };
    const explicit = (channels: number) => {
      const node = context.createGain();
      node.channelCount = channels;
      node.channelCountMode = "explicit";
      node.channelInterpretation = "speakers";
      level.connect(node);
      return node;
    };
    const controlMono = await measure("control: gain node, 1 channel, no stream", explicit(1), 1, undefined);
    const controlStereo = await measure("control: gain node, 2 channels, no stream", explicit(2), 2, undefined);
    const controlsOk = controlMono.status === "follows-track" && controlMono.panner.startsWith("equal-power")
      && controlStereo.status === "follows-track" && controlStereo.panner.startsWith("doubles");

    const streamRows: Result[] = [];
    const ofStream = async (id: string, stream: MediaStream, built: number | undefined) => {
      const reported = stream.getAudioTracks()[0]?.getSettings().channelCount;
      streamRows.push(await measure(id, context.createMediaStreamSource(stream), built, reported));
    };
    for (const channels of [1, 2]) {
      const destination = context.createMediaStreamDestination();
      destination.channelCount = channels;
      destination.channelCountMode = "explicit";
      destination.channelInterpretation = "speakers";
      level.connect(destination);
      await ofStream(`stream of a MediaStreamAudioDestinationNode, channelCount ${channels}`, destination.stream, channels);
      if (channels === 1) await ofStream("the same stream, cloned", destination.stream.clone(), channels);
    }
    if (USE_MICROPHONE) {
      for (const ideal of [1, 2]) {
        setState(`running: the microphone, channelCount ideal ${ideal} (answer the browser's prompt)`);
        const stream = await deadline("getUserMedia (answer the browser's prompt)", navigator.mediaDevices.getUserMedia({
          audio: { channelCount: { ideal }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        }), 60_000);
        opened.push(stream);
        await ofStream(`microphone "${stream.getAudioTracks()[0]?.label}", channelCount ideal ${ideal}`, stream, undefined);
        stream.getTracks().forEach((track) => track.stop());
      }
    }
    oscillator.stop();
    const judged = streamRows.filter((row) => row.status !== "silent");
    const verdict = !controlsOk || judged.length === 0 ? "INCONCLUSIVE"
      : judged.some((row) => row.status === "upmixed") ? "UPMIXES"
      : judged.every((row) => row.status === "follows-track") ? "SPEC" : "INCONCLUSIVE";
    const verdictElement = document.getElementById("verdict")!;
    verdictElement.dataset.verdict = verdict;
    verdictElement.textContent = verdict;
    document.getElementById("summary-note")!.textContent = `${verdict}: ${streamRows.map((row) => `${row.id}: ${row.status}`).join("; ")}; context ${context.sampleRate} Hz`;
    setState("done");
  } catch (error) {
    document.getElementById("summary-note")!.textContent = String(error);
    document.getElementById("verdict")!.dataset.verdict = "THREW";
    document.getElementById("verdict")!.textContent = `THREW: ${String(error)}`;
    setState(`error: ${String(error)}`);
  } finally {
    opened.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    await context.close().catch(() => undefined);
  }
}

const button = document.getElementById("run") as HTMLButtonElement;
button.addEventListener("click", () => { button.disabled = true; setState("running"); void run(); }, { once: true });
