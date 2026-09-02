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
 */
export const LOOPBACK_DEVICE_ID = "loopback-injection";
export const LOW_BAND_CUTOFF_HZ = 1500;
export const REF_CLICK_HZ = 6000;
export const REF_CLICK_DURATION_SEC = 0.008;
export const REF_CLICK_GAIN = 0.5;
/** Ceiling for both delay lines below — a round trip this synthetic path can never exceed. */
export const MAX_LOOPBACK_DELAY_SEC = 1;

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
 * up by. With an empty id a calibration measured on this loopback could never
 * be stored, let alone applied. The original settings are merged, not replaced,
 * so `channelCount` (which `CaptureAudio.#rebuildAudioChain` reads) survives.
 *
 * OPT-IN, because it also changes how often the SDK opens a stream, and with it
 * the loopback's own delay. `CaptureAudio.prepareRecording` calls the stream
 * generator on EVERY recording start, and `#updateStream` returns early only
 * when the open stream's reported deviceId equals the requested one. Reporting
 * nothing means that check never passes, so every recording tears the stream
 * down and opens a fresh one — which is why the alignment campaign's baseline
 * loopback hop is 10-23 ms per take: each take runs on a NEW
 * MediaStreamAudioSourceNode. Reporting the id makes the SDK reuse one stream
 * (what it does with a real device), and the reused stream's hop steps to
 * ~64 ms after the first recording and stays there. Measured at 48 kHz,
 * `firstQuantumTimeSec − anchorT0Sec` over three `nominal-start` repeats:
 * reporting off 12.3 / 9.6 / 18.3 ms, reporting on 17.0 / 64.3 / 64.3 ms.
 * The standing sweep therefore leaves this OFF (its register baseline assumes
 * the per-take stream); the calibration page turns it ON, because a stored
 * calibration needs a device id AND is only meaningful on the very stream the
 * take will run on.
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
   * destination (`CaptureAudio.calibrateInputLatency`, whose output route is
   * the monitor destination or, with no monitor device set, the context
   * destination) comes back through this capture stream instead of only
   * through the room.
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
   */
  captureDestinationDuring<T>(virtualOutputDelaySec: number, fn: () => Promise<T>): Promise<T>;
  uninstall(): void;
}

export interface LoopbackOptions {
  /** Report the requested deviceId on the handed-out stream — see `stampDeviceId`. Default false. */
  reportDeviceId?: boolean;
}

export function installLoopbackCapture(deviceCount: number = 1, options: LoopbackOptions = {}): LoopbackHandle {
  const reportDeviceId = options.reportDeviceId === true;
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

  navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (dest === null) throw new Error("loopbackInjection: getUserMedia before attach()");
    const clone = dest.stream.clone();
    const deviceId = requestedDeviceId(constraints);
    const stamped = reportDeviceId && deviceId !== undefined && deviceId !== "";
    if (stamped) stampDeviceId(clone, deviceId as string);
    console.log(
      "[loopbackInjection] getUserMedia requested deviceId=" + String(deviceId ?? "(none)") +
      " reportedOnStream=" + String(stamped)
    );
    return clone;
  };
  navigator.mediaDevices.enumerateDevices = async () => {
    const real = await original.enumerateDevices();
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
    async captureDestinationDuring<T>(virtualOutputDelaySec: number, fn: () => Promise<T>): Promise<T> {
      if (context === null || outputLegDelay === null || teeInput === null) {
        throw new Error("loopbackInjection: captureDestinationDuring before attach()");
      }
      const destination = context.destination;
      const tee = teeInput;
      const leg = clampDelay(virtualOutputDelaySec);
      outputLegDelay.delayTime.value = leg;
      const nativeConnect = AudioNode.prototype.connect;
      let teed = 0;
      const patched = function (this: AudioNode, target: AudioNode | AudioParam, output?: number, input?: number) {
        const result = nativeConnect.call(this, target as AudioNode, output as number, input as number);
        if (target === destination && this !== engineNode) {
          nativeConnect.call(this, tee, output as number);
          teed++;
        }
        return result;
      };
      AudioNode.prototype.connect = patched as typeof AudioNode.prototype.connect;
      console.log("[loopbackInjection] destination tee armed, virtualOutputDelaySec=" + leg.toFixed(6));
      try {
        return await fn();
      } finally {
        AudioNode.prototype.connect = nativeConnect;
        console.log("[loopbackInjection] destination tee disarmed, teedConnections=" + String(teed));
      }
    },
    uninstall() {
      navigator.mediaDevices.getUserMedia = original.getUserMedia;
      navigator.mediaDevices.enumerateDevices = original.enumerateDevices;
    },
  };
}
