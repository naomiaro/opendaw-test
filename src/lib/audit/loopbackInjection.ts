/**
 * Digital-loopback capture injection for the recording start-alignment audit.
 *
 * Patches navigator.mediaDevices.getUserMedia/enumerateDevices BEFORE SDK init
 * so CaptureAudio's capture stream is a MediaStreamAudioDestinationNode in the
 * SAME AudioContext the engine runs in (the cross-context variant is known to
 * read silent — see src/demos/recording/CLAUDE.md). Two inputs feed the node:
 *  - engine output through a lowpass (the metronome "performer", low band)
 *  - scheduled reference clicks (REF_CLICK_HZ tone bursts, high band)
 * getUserMedia hands out stream CLONES so a consumer's track.stop() (tape
 * disarm/remove) cannot kill the source stream.
 */
export const LOOPBACK_DEVICE_ID = "loopback-injection";
export const LOW_BAND_CUTOFF_HZ = 1500;
export const REF_CLICK_HZ = 6000;
export const REF_CLICK_DURATION_SEC = 0.008;
export const REF_CLICK_GAIN = 0.5;

/**
 * Device id for the Nth (1-based) synthetic loopback input — `loopbackDeviceId(1)`
 * is exactly `LOOPBACK_DEVICE_ID` (unchanged, so every existing single-tape call
 * site keeps working without edits), `loopbackDeviceId(2)` is
 * "loopback-injection-2", etc. Used by the multi-mic audit to arm N tapes on N
 * distinct deviceIds while every one of them still resolves through the SAME
 * `getUserMedia` override below — which already hands out a clone of the ONE
 * `dest.stream` regardless of which deviceId was requested (constraints are
 * unused), so every tape captures a clone of the identical signal. That's
 * exactly what a cross-track skew measurement needs (see
 * `measureCrossTrackSkew` in `recordingAlignment.ts`): any difference in where
 * matched clicks land between two tapes' takes IS the skew, with every other
 * bias (loopback path latency, metronome content, click schedule) canceling
 * out because both tapes hear the same signal.
 */
export function loopbackDeviceId(index: number): string {
  return index <= 1 ? LOOPBACK_DEVICE_ID : `${LOOPBACK_DEVICE_ID}-${index}`;
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
  uninstall(): void;
}

export function installLoopbackCapture(deviceCount: number = 1): LoopbackHandle {
  const original = {
    getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
    enumerateDevices: navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices),
  };
  let context: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let pendingEngineNode: AudioNode | null = null;
  const pendingClickNodes: { osc: OscillatorNode; gain: GainNode }[] = [];

  navigator.mediaDevices.getUserMedia = async (_constraints?: MediaStreamConstraints) => {
    if (dest === null) throw new Error("loopbackInjection: getUserMedia before attach()");
    return dest.stream.clone();
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
    if (context === null || dest === null || lowpass === null) { pendingEngineNode = node; return; }
    // Output 0 only — output 1 is monitoring (SDK 0.0.133+ dual-output rule).
    node.connect(lowpass, 0);
  };

  return {
    attach(audioContext: AudioContext) {
      context = audioContext;
      dest = audioContext.createMediaStreamDestination();
      lowpass = audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = LOW_BAND_CUTOFF_HZ;
      lowpass.connect(dest);
      if (pendingEngineNode !== null) { connectEngine(pendingEngineNode); pendingEngineNode = null; }
    },
    engineTap(engineNode: AudioNode) { connectEngine(engineNode); },
    scheduleReferenceClicks(times: number[]) {
      if (context === null || dest === null) throw new Error("loopbackInjection: schedule before attach()");
      for (const t of times) {
        const osc = context.createOscillator();
        osc.frequency.value = REF_CLICK_HZ;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(REF_CLICK_GAIN, t + 0.001);
        gain.gain.setValueAtTime(REF_CLICK_GAIN, t + REF_CLICK_DURATION_SEC - 0.002);
        gain.gain.linearRampToValueAtTime(0, t + REF_CLICK_DURATION_SEC);
        osc.connect(gain).connect(dest);
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
    uninstall() {
      navigator.mediaDevices.getUserMedia = original.getUserMedia;
      navigator.mediaDevices.enumerateDevices = original.enumerateDevices;
    },
  };
}
