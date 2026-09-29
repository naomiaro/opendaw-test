/**
 * Digital-loopback capture injection for the recording start-alignment audit.
 *
 * Patches navigator.mediaDevices.getUserMedia/enumerateDevices BEFORE SDK init
 * so CaptureAudio's capture stream is a MediaStreamAudioDestinationNode in the
 * SAME AudioContext the engine runs in (the cross-context variant is known to
 * read silent — see src/demos/recording/CLAUDE.md). Three inputs feed the node:
 *  - engine output through a lowpass (the metronome "performer", low band)
 *  - scheduled reference clicks (REF_CLICK_HZ tone bursts, high band)
 *  - optionally, whatever is connected to audioContext.destination while
 *    `captureDestinationDuring` is armed (the input-latency calibration probe)
 * All three pass through ONE return DelayNode (`setReturnDelay`) on their way
 * into the stream, so a known delay can be injected into the whole return path.
 * getUserMedia hands out stream CLONES so a consumer's track.stop() (tape
 * disarm/remove) cannot kill the source stream.
 *
 * With `nodeTaps` it also listens: to what goes into the stream, and to the
 * source nodes the SDK builds on the clones (`prepareNodeTaps`,
 * `tapSourceNodes`). A source node hands its stream on with a delay of its own,
 * 9 to 23 ms here and different from one node to the next, so the delay a
 * capture recorded with can only be read from the node it recorded through.
 */
import { withDeadline } from "@/lib/deadline";
import { NODE_TAP_MAX_LAG_SEC, NODE_TAP_QUANTUM_FRAMES, NODE_TAP_SECONDS, spanOf, type TapChunk } from "./nodeTap";

export const LOOPBACK_DEVICE_ID = "loopback-injection";
export const LOW_BAND_CUTOFF_HZ = 1500;
export const REF_CLICK_HZ = 6000;
export const REF_CLICK_DURATION_SEC = 0.008;
export const REF_CLICK_GAIN = 0.5;
/** Ceiling for both delay lines below — a round trip this synthetic path can never exceed. */
export const MAX_LOOPBACK_DELAY_SEC = 1;

/** The device a stream is filed under when the request named none. */
export const LOOPBACK_UNNAMED_DEVICE = "(default)";
/** How much of what went into the stream is kept for the node taps to be compared with. */
const REFERENCE_KEEP_SEC = 30;
/** Render quanta per message of the reference recorder: 171 ms at 48 kHz. */
const REFERENCE_CHUNK_QUANTA = 64;
/** How long a tap may take beyond its own length before it is given up. */
const NODE_TAP_GRACE_MS = 3000;
const NODE_TAP_PROCESSOR = "loopback-node-tap";

/**
 * The recorder behind the node taps: copies its input, one render quantum per
 * `process` call, and stamps each with `currentFrame`. With `quanta` above zero
 * it stops after that many; with zero it runs for as long as the node lives.
 * It posts every `chunkQuanta` quanta, and what is left when it stops.
 */
const NODE_TAP_PROCESSOR_SOURCE = `
class LoopbackNodeTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.quanta = options.processorOptions.quanta;
    this.chunkQuanta = options.processorOptions.chunkQuanta;
    this.done = 0;
    this.begin();
  }
  begin() {
    this.samples = new Float32Array(this.chunkQuanta * 128);
    this.frames = new Float64Array(this.chunkQuanta);
    this.count = 0;
  }
  process(inputs) {
    if (this.quanta > 0 && this.done >= this.quanta) return false;
    const input = inputs[0];
    this.frames[this.count] = currentFrame;
    if (input.length > 0) this.samples.set(input[0], this.count * 128);
    this.count++;
    this.done++;
    if (this.count === this.chunkQuanta || (this.quanta > 0 && this.done === this.quanta)) {
      this.port.postMessage(
        { frames: this.frames, samples: this.samples, count: this.count },
        [this.frames.buffer, this.samples.buffer]
      );
      this.begin();
    }
    return true;
  }
}
registerProcessor("${NODE_TAP_PROCESSOR}", LoopbackNodeTap);
`;

/** What one tap heard, and what went into the stream over the same stretch. */
export interface SourceNodeRecording {
  /** The device the stream the node consumes was opened for; `LOOPBACK_UNNAMED_DEVICE` when the request named none. */
  deviceId: string;
  /** Context time the node was created at. */
  sourceCreatedAtSec: number;
  /** Context time the tap was attached at. */
  tapAttachedAtSec: number;
  /** Source nodes built on this device's streams since the tap before this one, the tapped one included. */
  nodesBuilt: number;
  tapChunks: TapChunk[];
  referenceChunks: TapChunk[];
  /** Why there is nothing to measure, or null. */
  failed: string | null;
}

/**
 * Device id for the Nth (1-based) synthetic loopback input — `loopbackDeviceId(1)`
 * is exactly `LOOPBACK_DEVICE_ID` (unchanged, so every existing single-tape call
 * site keeps working without edits), `loopbackDeviceId(2)` is
 * "loopback-injection-2", etc. Used by the multi-mic audit to arm N tapes on N
 * distinct deviceIds while every one of them still resolves through the SAME
 * `getUserMedia` override below — which already hands out a clone of the ONE
 * `dest.stream` regardless of which deviceId was requested (constraints are
 * unused except to stamp the id back onto the clone's settings), so every tape
 * captures a clone of the identical signal. That's exactly what a cross-track
 * skew measurement needs (see `measureCrossTrackSkew` in `recordingAlignment.ts`):
 * any difference in where matched clicks land between two tapes' takes IS the
 * skew, with every other bias (loopback path latency, metronome content, click
 * schedule) canceling out because both tapes hear the same signal.
 */
export function loopbackDeviceId(index: number): string {
  return index <= 1 ? LOOPBACK_DEVICE_ID : `${LOOPBACK_DEVICE_ID}-${index}`;
}

/** The deviceId a `getUserMedia` call asked for, or undefined when it asked for none. */
function requestedDeviceId(constraints?: MediaStreamConstraints): string | undefined {
  const audio = constraints?.audio;
  if (typeof audio !== "object" || audio === null) return undefined;
  const deviceId = (audio as MediaTrackConstraints).deviceId;
  if (typeof deviceId === "string") return deviceId;
  if (Array.isArray(deviceId)) return deviceId[0];
  if (typeof deviceId === "object" && deviceId !== null) {
    const constrain = deviceId as ConstrainDOMStringParameters;
    const value = constrain.exact ?? constrain.ideal;
    return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  }
  return undefined;
}

/**
 * Make the cloned synthetic track report the deviceId it was opened with, the
 * way a real `getUserMedia` track does. A `MediaStreamAudioDestinationNode`
 * track reports an EMPTY deviceId, and the SDK keys two things on that value:
 * `CaptureAudio.streamDeviceId` (which an input-latency calibration stores its
 * entry under, and which it refuses to store at all when empty) and the
 * `getSettings().deviceId` the placement-time latency provider looks the entry
 * up by. With an empty id a calibration measured here could never be stored,
 * let alone applied. The original settings are merged, not replaced, so
 * `channelCount` (which `CaptureAudio.#rebuildAudioChain` reads) survives;
 * `groupId` is overwritten with the same id, which nothing in the SDK reads.
 *
 * OPT-IN, because it selects which of TWO SDK input-chain states the capture
 * runs in, and on SDK `f0c44b06c` the two differed by ~45 ms of input delay
 * (the ratchet the sink commit removed — the full history is two paragraphs
 * down; on `ac1c15ea8` and later the states are ~8 ms apart).
 * `CaptureAudio.prepareRecording` calls the stream generator on EVERY recording
 * start, and `#updateStream` returns early only when the open track's reported
 * deviceId equals the one the capture box names. Reporting nothing means that
 * check never passes, so every take tears the chain down and builds a fresh
 * `MediaStreamAudioSourceNode` — which is where the alignment campaign's
 * 10-23 ms baseline comes from. Reporting the id makes the check pass and one
 * source node lives across takes, which is the SDK's real-device path whenever
 * the capture box carries a device id — on every build, since a real device
 * always reports the id it was opened with. A box naming NO device rebuilt on
 * every recording too until SDK `546b5bfaa`, which compares what the box names
 * against what the open stream was REQUESTED with; from there an unnamed box
 * reuses its chain (see `serveDefault`, the mode that exercises it).
 *
 * The delay difference is a property of that REUSED SOURCE NODE, not of this
 * loopback: nothing here accumulates (one clone is handed out, the delay lines
 * are fixed-length, and the producing `MediaStreamAudioDestinationNode` does not
 * care whether a consumer pulls). Between uses the reused source node is
 * connected only to `recordGainNode`, which with monitoring off has no path to
 * the destination, so nobody pulls it and its browser-side buffer is not
 * drained. ON SDK `f0c44b06c` (the calibration routine WITHOUT the keep-alive
 * sink) the FIRST pull on a fresh chain reads 13-21 ms — whether that pull is a
 * calibration or a take — and every later pull on the same chain reads
 * 58-69 ms, permanently, until the chain is rebuilt. The sink commit
 * (`ac1c15ea8`) keeps the source pulled for the chain's life and removes that
 * ratchet: on `ac1c15ea8` and later every pull reads ~21 ms, and what remains is
 * a per-chain-instance state set when the chain is built (see the E-band
 * derivation in recordingAuditCalibration.ts). Measured at 48 kHz on
 * `f0c44b06c`,
 * `firstQuantumTimeSec − anchorT0Sec` over three `nominal-start` repeats:
 * reporting off 12.3 / 9.6 / 18.3 ms, reporting on 17.0 / 64.3 / 64.3 ms.
 * The ~41 ms (48 kHz) / ~48 ms (44.1 kHz) step is the size a ~2048-frame sink
 * buffer would have at those rates — INFERRED from the two rates, not read from
 * Chromium source; the state dependence itself is measured.
 *
 * The standing sweep therefore leaves this OFF (its register baseline assumes
 * the per-take chain); the calibration page turns it ON, because a stored
 * calibration needs a device id AND only describes the chain state it ran on.
 */
function stampDeviceId(stream: MediaStream, deviceId: string): void {
  for (const track of stream.getAudioTracks()) {
    const original = track.getSettings.bind(track);
    Object.defineProperty(track, "getSettings", {
      value: () => ({ ...original(), deviceId, groupId: deviceId }),
      configurable: true,
      writable: true,
    });
  }
}

export interface LoopbackHandle {
  /** Call once, right after initializeOpenDAW, with the SDK's AudioContext. */
  attach(audioContext: AudioContext): void;
  /** Pass as ProjectSetupOptions.engineTap — routes engine output into the low band. */
  engineTap(engineNode: AudioNode): void;
  /** Schedule one tone burst per schedule time (absolute context seconds). */
  scheduleReferenceClicks(times: number[]): void;
  /**
   * Stop and disconnect every oscillator scheduled by scheduleReferenceClicks
   * that hasn't already finished. Call between repeats/cells — a fresh
   * schedule (~65s span) is issued every repeat, so without this an earlier
   * repeat's still-sounding clicks can leak stray onsets into the NEXT
   * repeat's captured buffer, breaking `identifyReferenceClicks`' gap
   * adjacency. Safe to call with nothing pending (no-op).
   */
  cancelReferenceClicks(): void;
  /**
   * How many times the `getUserMedia` override has handed out a stream — one per
   * stream the SDK opened. It is the direct evidence for whether an audio chain
   * was reused or rebuilt (one open for a whole cell means every take ran on the
   * same chain), so the harnesses persist it per run instead of leaving it in the
   * console.
   *
   * The counter is CUMULATIVE PER PAGE LOAD, not per run: it is never reset, so
   * a second run started with the page's "Re-run" button persists the total
   * since load rather than that run's own opens. A fresh navigation per run —
   * the campaign's practice — makes the two equal.
   */
  getUserMediaOpens(): number;
  /**
   * Extra delay, in seconds (0 … MAX_LOOPBACK_DELAY_SEC), inserted into the
   * loopback's whole return path — engine tap, reference clicks and the
   * destination tee alike — before it reaches the capture stream. 0 by
   * default and transparent at that value (a DelayNode outside a cycle adds
   * no implicit quantum), so the standing sweep is unaffected.
   *
   * A KNOWN delay is what makes the input-latency calibration checkable: the
   * measured input latency must track this value one-for-one. Because it
   * delays the reference clicks too, a non-zero value shifts the harness's
   * own anchor by the same amount — set it back to 0 before recording a cell.
   */
  setReturnDelay(seconds: number): void;
  /**
   * Run `fn` with everything connected to `audioContext.destination` teed into
   * the loopback return path, so a probe the SDK plays out through the context
   * destination comes back through this capture stream instead of only through
   * the room. `CaptureAudio.calibrateInputLatency` plays there unconditionally,
   * never through a per-capture monitor output: the route has to be the one
   * whose `outputLatency` the measurement subtracts and `RecordAudio` adds back
   * at placement.
   *
   * `virtualOutputDelaySec` is a stand-in for the output device leg the
   * synthetic path never traverses: the harness already models that leg,
   * adding `audioContext.outputLatency` back as `harnessPathBiasSec` before
   * judging a take (see `TakeMeasurementInput.harnessPathBiasSec`), so the
   * probe must traverse it too or the two measurements would sit in different
   * spaces and the calibrated value would be short by exactly that term. Pass
   * the same number the rows are adjusted with; pass 0 to tee the raw path.
   *
   * Implemented by wrapping `AudioNode.prototype.connect` for the duration of
   * `fn` — the ONLY way to observe a connection the SDK makes to the context
   * destination, which has no outputs of its own to tap. The wrapper is armed
   * for as short a window as possible and skips the engine node (already in
   * the low band), so a stray connection from elsewhere cannot be teed in.
   *
   * The deadline is owned HERE, not by a `withDeadline` wrapped around the
   * call: an outer race cannot reach this function's `finally`, so on a timeout
   * the prototype patch would stay armed and every later calibration on the
   * page would tee its probe twice. With `deadlineMs` given, a timeout rejects
   * with `label` AND restores the prototype and disconnects every teed node;
   * without it `fn` is waited on unbounded (the caller owns the wait).
   */
  captureDestinationDuring<T>(
    virtualOutputDelaySec: number,
    fn: () => Promise<T>,
    deadlineMs?: number,
    label?: string
  ): Promise<T>;
  /**
   * Load the tap recorder and start recording what goes into the stream. Needs the
   * `nodeTaps` option and `attach()`. WAIT FOR IT before the first take: a worklet
   * module still loading when a recording starts held that take's first frame back
   * by 117 ms.
   */
  prepareNodeTaps(): Promise<void>;
  /**
   * Listen for `NODE_TAP_SECONDS` to the newest source node built on each device's
   * stream, and hand back what each tap heard with what went into the stream over
   * the same stretch (`measureNodeDelay` in `nodeTap.ts` reads the node's delay
   * from the two). Call it once the recording is running, so that the SDK and
   * nothing else decides when the node starts being pulled; a second listener on
   * a node reads the same delay as the first, whenever it is attached.
   *
   * It never rejects: a tap that fails says so in `failed`. Measure after the
   * take, not during it — the comparison holds the main thread for some tens of
   * milliseconds.
   *
   * A node the SDK has dropped is silent (its stream's tracks are stopped), so a
   * tap on the wrong node reads nothing; it cannot read a wrong delay.
   */
  tapSourceNodes(): Promise<SourceNodeRecording[]>;
  uninstall(): void;
}

export interface LoopbackOptions {
  /** Report the requested deviceId on the handed-out stream — see `stampDeviceId`. Default false. */
  reportDeviceId?: boolean;
  /**
   * Serve the loopback as the DEFAULT input, for exercising the SDK path where
   * no device is named anywhere. Default false.
   *
   * Leaving the capture box's `deviceId` unset is not enough on its own:
   * `CaptureAudio.#updateStream` falls back to `AudioDevices.defaultInput`, which
   * prefers the enumerated input whose id is `"default"` and otherwise takes the
   * first entry of the list, and this module normally puts its synthetic devices
   * at the head of that list — so the SDK would name
   * the loopback by id anyway and the request would carry an exact-device
   * constraint. With this option `enumerateDevices` reports NO audio inputs at
   * all (the synthetic ones are withheld and real ones filtered, so the SDK
   * cannot name a device this harness would not serve), `defaultInput` resolves
   * to nothing, and the stream request goes out with no `deviceId` constraint —
   * which is the path `CaptureAudio` takes for a box that names no device.
   *
   * `getUserMedia` serves the loopback for that unconstrained request, and with
   * `reportDeviceId` on, the handed-out clone reports `LOOPBACK_DEVICE_ID`: a
   * real default-device stream reports the concrete device the browser chose,
   * not an empty id, and the SDK keys a stored input-latency calibration on
   * exactly that value.
   *
   * Non-audio devices are still passed through, and video inputs are untouched.
   * Two consequences worth knowing: no real input can be opened while this is on,
   * so the mode cannot coexist with a real-device run in the same page load; and
   * with `reportDeviceId` OFF the served clone reports an EMPTY id, so a
   * calibration could not be stored on that stream — chain reuse still holds,
   * because the SDK's unnamed-box rule keys on what the box named when the stream
   * was opened, not on what the track reports.
   */
  serveDefault?: boolean;
  /**
   * Keep track of the source nodes built on the handed-out streams, so that
   * `tapSourceNodes` can listen to them. Default false. It wraps
   * `createMediaStreamSource` on the attached context (that one object, not the
   * prototype) and changes nothing about the node that comes back.
   */
  nodeTaps?: boolean;
}

export function installLoopbackCapture(deviceCount: number = 1, options: LoopbackOptions = {}): LoopbackHandle {
  const reportDeviceId = options.reportDeviceId === true;
  const serveDefault = options.serveDefault === true;
  const nodeTaps = options.nodeTaps === true;
  const original = {
    getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    enumerateDevices: navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices),
  };
  let context: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  /** Whole-return-path delay — every injected source reaches `dest` through it. */
  let returnDelay: DelayNode | null = null;
  /** The destination tee's own leg, standing in for the output device (see captureDestinationDuring). */
  let outputLegDelay: DelayNode | null = null;
  let teeInput: GainNode | null = null;
  let pendingEngineNode: AudioNode | null = null;
  let engineNode: AudioNode | null = null;
  const pendingClickNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  let getUserMediaOpens = 0;
  const streamDevices = new WeakMap<MediaStream, string>();
  /** The newest source node on each device, and how many were built since the last tap. */
  const sourceNodes = new Map<string, { node: MediaStreamAudioSourceNode; createdAtSec: number; nodesBuilt: number }>();
  let nodeTapsReady: Promise<void> | null = null;
  let referenceRecorder: AudioWorkletNode | null = null;
  let referenceChunks: TapChunk[] = [];

  const tapRecorder = (audioContext: AudioContext, quanta: number, chunkQuanta: number, onChunk: (chunk: TapChunk) => void): AudioWorkletNode => {
    const node = new AudioWorkletNode(audioContext, NODE_TAP_PROCESSOR, {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit",
      processorOptions: { quanta, chunkQuanta },
    });
    node.port.onmessage = (event: MessageEvent<TapChunk>) => onChunk(event.data);
    return node;
  };

  /** One node's tap. Resolves when the tap has its quanta and the reference has caught up, or with `failed`. */
  const tapOne = (
    audioContext: AudioContext,
    deviceId: string,
    entry: { node: MediaStreamAudioSourceNode; createdAtSec: number; nodesBuilt: number }
  ): Promise<SourceNodeRecording> => new Promise((resolve) => {
    const nodesBuilt = entry.nodesBuilt;
    entry.nodesBuilt = 0;
    const tapChunks: TapChunk[] = [];
    const base = { deviceId, sourceCreatedAtSec: entry.createdAtSec, nodesBuilt };
    let tapAttachedAtSec = audioContext.currentTime;
    let settled = false;
    let recorder: AudioWorkletNode | null = null;
    const settle = (failed: string | null, reference: TapChunk[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      if (recorder !== null) {
        try {
          entry.node.disconnect(recorder);
        } catch {
          // The SDK has taken the chain down already, and the tap's connection with it.
        }
      }
      resolve({ ...base, tapAttachedAtSec, tapChunks, referenceChunks: reference, failed });
    };
    const giveUp = setTimeout(
      () => settle(`the tap did not finish within ${NODE_TAP_SECONDS * 1000 + NODE_TAP_GRACE_MS} ms`, []),
      NODE_TAP_SECONDS * 1000 + NODE_TAP_GRACE_MS
    );
    try {
      const quanta = Math.ceil((audioContext.sampleRate * NODE_TAP_SECONDS) / NODE_TAP_QUANTUM_FRAMES);
      let received = 0;
      recorder = tapRecorder(audioContext, quanta, quanta, (chunk) => {
        tapChunks.push(chunk);
        received += chunk.count;
        if (received < quanta) return;
        const span = spanOf(tapChunks);
        if (span === null) { settle("the tap recorded nothing", []); return; }
        const from = span.firstFrame - Math.round(audioContext.sampleRate * NODE_TAP_MAX_LAG_SEC) - NODE_TAP_QUANTUM_FRAMES;
        // The reference posts every REFERENCE_CHUNK_QUANTA quanta, so it trails the tap's end.
        const waitForReference = () => {
          if (settled) return;
          const covered = spanOf(referenceChunks);
          if (covered === null || covered.endFrame < span.endFrame) { setTimeout(waitForReference, 25); return; }
          const needed = referenceChunks.filter((c) => {
            const own = spanOf([c]);
            return own !== null && own.endFrame > from && own.firstFrame < span.endFrame;
          });
          settle(null, needed);
        };
        waitForReference();
      });
      tapAttachedAtSec = audioContext.currentTime;
      entry.node.connect(recorder);
    } catch (error) {
      settle(`the tap could not be attached: ${String(error)}`, []);
    }
  });

  navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (dest === null) throw new Error("loopbackInjection: getUserMedia before attach()");
    const clone = dest.stream.clone();
    getUserMediaOpens++;
    const requested = requestedDeviceId(constraints);
    // An unconstrained request under `serveDefault` is the default-device path:
    // the browser picks a device and the track reports ITS id, so the clone
    // reports the device this harness actually served.
    const deviceId = requested ?? (serveDefault ? LOOPBACK_DEVICE_ID : undefined);
    const stamped = reportDeviceId && deviceId !== undefined && deviceId !== "";
    if (stamped) stampDeviceId(clone, deviceId as string);
    streamDevices.set(clone, requested ?? LOOPBACK_UNNAMED_DEVICE);
    console.log(
      "[loopbackInjection] getUserMedia requested deviceId=" + String(requested ?? "(none — default device)") +
      " served=" + String(deviceId ?? "(none)") +
      " reportedOnStream=" + String(stamped)
    );
    return clone;
  };
  navigator.mediaDevices.enumerateDevices = async () => {
    const real = await original.enumerateDevices();
    if (serveDefault) {
      // Withhold every audio input so `AudioDevices.defaultInput` is undefined and
      // the SDK asks for the default device without naming one — see `serveDefault`.
      return real.filter((device) => device.kind !== "audioinput");
    }
    const synthetic = Array.from({ length: deviceCount }, (_, i) => {
      const id = loopbackDeviceId(i + 1);
      return {
        deviceId: id, groupId: id,
        kind: "audioinput" as MediaDeviceKind,
        label: i === 0 ? "Loopback Injection" : `Loopback Injection ${i + 1}`,
        toJSON() { return this; },
      } as MediaDeviceInfo;
    });
    return [...synthetic, ...real];
  };

  const connectEngine = (node: AudioNode) => {
    engineNode = node;
    if (context === null || dest === null || lowpass === null) { pendingEngineNode = node; return; }
    // Output 0 only — output 1 is monitoring (SDK 0.0.133+ dual-output rule).
    node.connect(lowpass, 0);
  };

  const clampDelay = (seconds: number): number => {
    if (!Number.isFinite(seconds)) throw new Error(`loopbackInjection: delay must be finite, got ${String(seconds)}`);
    return Math.min(MAX_LOOPBACK_DELAY_SEC, Math.max(0, seconds));
  };

  return {
    attach(audioContext: AudioContext) {
      context = audioContext;
      dest = audioContext.createMediaStreamDestination();
      returnDelay = audioContext.createDelay(MAX_LOOPBACK_DELAY_SEC);
      returnDelay.delayTime.value = 0;
      returnDelay.connect(dest);
      lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = LOW_BAND_CUTOFF_HZ;
      lowpass.connect(returnDelay);
      outputLegDelay = audioContext.createDelay(MAX_LOOPBACK_DELAY_SEC);
      outputLegDelay.delayTime.value = 0;
      outputLegDelay.connect(returnDelay);
      teeInput = audioContext.createGain();
      teeInput.connect(outputLegDelay);
      if (pendingEngineNode !== null) { connectEngine(pendingEngineNode); pendingEngineNode = null; }
      if (nodeTaps) {
        const createSource = audioContext.createMediaStreamSource.bind(audioContext);
        audioContext.createMediaStreamSource = (stream: MediaStream) => {
          const node = createSource(stream);
          const deviceId = streamDevices.get(stream);
          // A stream this module did not hand out is not the loopback's: leave it alone.
          if (deviceId !== undefined) {
            const nodesBuilt = (sourceNodes.get(deviceId)?.nodesBuilt ?? 0) + 1;
            sourceNodes.set(deviceId, { node, createdAtSec: audioContext.currentTime, nodesBuilt });
          }
          return node;
        };
      }
    },
    engineTap(node: AudioNode) { connectEngine(node); },
    scheduleReferenceClicks(times: number[]) {
      if (context === null || returnDelay === null) throw new Error("loopbackInjection: schedule before attach()");
      for (const t of times) {
        const osc = context.createOscillator();
        osc.frequency.value = REF_CLICK_HZ;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(REF_CLICK_GAIN, t + 0.001);
        gain.gain.setValueAtTime(REF_CLICK_GAIN, t + REF_CLICK_DURATION_SEC - 0.002);
        gain.gain.linearRampToValueAtTime(0, t + REF_CLICK_DURATION_SEC);
        osc.connect(gain).connect(returnDelay);
        osc.start(t);
        osc.stop(t + REF_CLICK_DURATION_SEC + 0.005);
        pendingClickNodes.push({ osc, gain });
      }
    },
    getUserMediaOpens() { return getUserMediaOpens; },
    cancelReferenceClicks() {
      const now = context?.currentTime ?? 0;
      for (const { osc, gain } of pendingClickNodes) {
        try {
          osc.stop(now);
        } catch {
          // Already past its natural stop time — stop() on an ended node is a no-op in
          // most engines but guard against a stricter implementation throwing.
        }
        osc.disconnect();
        gain.disconnect();
      }
      pendingClickNodes.length = 0;
    },
    setReturnDelay(seconds: number) {
      if (returnDelay === null) throw new Error("loopbackInjection: setReturnDelay before attach()");
      const value = clampDelay(seconds);
      returnDelay.delayTime.value = value;
      console.log("[loopbackInjection] returnDelaySec=" + value.toFixed(6));
    },
    async captureDestinationDuring<T>(
      virtualOutputDelaySec: number,
      fn: () => Promise<T>,
      deadlineMs?: number,
      label: string = "captureDestinationDuring"
    ): Promise<T> {
      if (context === null || outputLegDelay === null || teeInput === null) {
        throw new Error("loopbackInjection: captureDestinationDuring before attach()");
      }
      const destination = context.destination;
      const tee = teeInput;
      const leg = clampDelay(virtualOutputDelaySec);
      outputLegDelay.delayTime.value = leg;
      const originalConnect = AudioNode.prototype.connect;
      // `connect` is overloaded, and `.call` on an overloaded method is typed by
      // its last overload alone. One signature that covers all of them:
      const nativeConnect = originalConnect as (
        this: AudioNode, target: AudioNode | AudioParam, output?: number, input?: number
      ) => AudioNode | void;
      // Every connection this window teed, so the restore can undo it: a probe
      // source the SDK leaves connected to the destination would otherwise stay
      // teed into the return path after the window closed.
      const teed: { node: AudioNode; output: number | undefined }[] = [];
      const patched = function (this: AudioNode, target: AudioNode | AudioParam, output?: number, input?: number) {
        const result = nativeConnect.call(this, target, output, input);
        if (target === destination && this !== engineNode) {
          nativeConnect.call(this, tee, output);
          teed.push({ node: this, output });
        }
        return result;
      };
      AudioNode.prototype.connect = patched as typeof AudioNode.prototype.connect;
      console.log("[loopbackInjection] destination tee armed, virtualOutputDelaySec=" + leg.toFixed(6));
      try {
        return deadlineMs === undefined ? await fn() : await withDeadline(fn(), deadlineMs, label);
      } finally {
        AudioNode.prototype.connect = originalConnect;
        let disconnected = 0;
        for (const { node, output } of teed) {
          try {
            if (output === undefined) node.disconnect(tee); else node.disconnect(tee, output);
            disconnected++;
          } catch {
            // Already disconnected (the SDK tears its probe source down after the
            // measurement) — `disconnect` throws InvalidAccessError on a
            // connection that no longer exists, which is the state we want.
          }
        }
        console.log(
          "[loopbackInjection] destination tee disarmed, teedConnections=" + String(teed.length) +
          " disconnectedOnRestore=" + String(disconnected)
        );
      }
    },
    prepareNodeTaps() {
      if (!nodeTaps) return Promise.reject(new Error("loopbackInjection: prepareNodeTaps without the nodeTaps option"));
      if (context === null || returnDelay === null) {
        return Promise.reject(new Error("loopbackInjection: prepareNodeTaps before attach()"));
      }
      if (nodeTapsReady !== null) return nodeTapsReady;
      const audioContext = context;
      const intoStream = returnDelay;
      const moduleUrl = URL.createObjectURL(new Blob([NODE_TAP_PROCESSOR_SOURCE], { type: "application/javascript" }));
      nodeTapsReady = audioContext.audioWorklet.addModule(moduleUrl).then(() => {
        const keepFrames = REFERENCE_KEEP_SEC * audioContext.sampleRate;
        referenceRecorder = tapRecorder(audioContext, 0, REFERENCE_CHUNK_QUANTA, (chunk) => {
          referenceChunks.push(chunk);
          const newest = chunk.frames[chunk.count - 1];
          while (referenceChunks.length > 0 && referenceChunks[0].frames[0] < newest - keepFrames) referenceChunks.shift();
        });
        // Everything that reaches the stream reaches it through the return delay.
        intoStream.connect(referenceRecorder);
        console.log("[loopbackInjection] node taps ready");
      }).finally(() => URL.revokeObjectURL(moduleUrl));
      return nodeTapsReady;
    },
    async tapSourceNodes(): Promise<SourceNodeRecording[]> {
      if (context === null || nodeTapsReady === null) {
        throw new Error("loopbackInjection: tapSourceNodes before prepareNodeTaps()");
      }
      await nodeTapsReady;
      const audioContext = context;
      return Promise.all([...sourceNodes.entries()].map(([deviceId, entry]) => tapOne(audioContext, deviceId, entry)));
    },
    uninstall() {
      navigator.mediaDevices.getUserMedia = original.getUserMedia;
      navigator.mediaDevices.enumerateDevices = original.enumerateDevices;
      if (context !== null && nodeTaps) {
        // The wrapper sits on the context object itself; removing it uncovers the prototype's.
        delete (context as { createMediaStreamSource?: unknown }).createMediaStreamSource;
      }
      if (referenceRecorder !== null) {
        referenceRecorder.disconnect();
        referenceRecorder.port.onmessage = null;
        try {
          returnDelay?.disconnect(referenceRecorder);
        } catch {
          // Never connected, or disconnected already.
        }
        referenceRecorder = null;
        referenceChunks = [];
      }
    },
  };
}
