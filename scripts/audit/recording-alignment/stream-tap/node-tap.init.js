// Node-tap probe, injected with page.addInitScript BEFORE the audit page's own scripts.
//
// The two-tap spike showed that a loopback stream's delay belongs to the consuming
// MediaStreamAudioSourceNode, and that a second listener on the SAME node reads the
// node's delay exactly. So this probe listens to the SDK's own source nodes:
//
//   reference  whatever is connected to the loopback's MediaStreamAudioDestinationNode is
//              also recorded, continuously, with every quantum stamped with currentFrame
//   tap        150 ms after the SDK connects a capture chain's gain to its recording
//              worklet, a recorder is attached to that chain's SOURCE NODE for 2 s
//
// A tap's delay is the lag, in whole frames, at which it equals the reference — read on
// the context clock; nothing of the SDK's is used. Attaching after the SDK's own
// connection leaves the moment the node starts being pulled as it was.
(() => {
  const QUANTUM = 128;
  const TAP_SECONDS = 2;
  const TAP_ATTACH_DELAY_MS = 150;
  const WINDOW = 512;
  const probe = (window.__nodeTap = { taps: [], errors: [], refChunks: 0, contexts: 0 });
  const fail = (where, error) => probe.errors.push(where + ": " + String(error));

  const workletSource = `
    class NodeTapRecorder extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this.total = options.processorOptions.quanta;   // 0 = run until the node dies
        this.chunk = options.processorOptions.chunkQuanta;
        this.done = 0;
        this.reset();
      }
      reset() {
        this.buf = new Float32Array(this.chunk * 128);
        this.frames = new Float64Array(this.chunk);
        this.i = 0;
      }
      flush() {
        if (this.i === 0) return;
        this.port.postMessage({ buf: this.buf, frames: this.frames, count: this.i }, [this.buf.buffer, this.frames.buffer]);
        this.reset();
      }
      process(inputs) {
        if (this.total > 0 && this.done >= this.total) return false;
        const input = inputs[0];
        this.frames[this.i] = currentFrame;
        if (input.length > 0) this.buf.set(input[0], this.i * 128);
        this.i++;
        this.done++;
        if (this.i === this.chunk || (this.total > 0 && this.done === this.total)) this.flush();
        return true;
      }
    }
    registerProcessor("node-tap-recorder", NodeTapRecorder);`;
  const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" }));

  const nativeConnect = AudioNode.prototype.connect;
  const contexts = new Map();        // AudioContext -> { module, ref: [{frames, buf, count}], dests }
  const streams = new WeakMap();     // MediaStream -> requested deviceId
  const sources = new WeakMap();     // MediaStreamAudioSourceNode -> info
  const gains = new WeakMap();       // GainNode fed by a source -> info
  const ours = new WeakSet();        // recorders of this probe

  const stateOf = (context) => {
    let state = contexts.get(context);
    if (state === undefined) {
      state = { module: context.audioWorklet.addModule(moduleUrl), ref: [], refAttached: false, index: probe.contexts++ };
      state.module.catch((error) => fail("addModule", error));
      contexts.set(context, state);
    }
    return state;
  };
  const recorder = (context, quanta, chunkQuanta, onChunk) => {
    const node = new AudioWorkletNode(context, "node-tap-recorder", {
      numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit",
      processorOptions: { quanta, chunkQuanta },
    });
    node.port.onmessage = (event) => onChunk(event.data);
    ours.add(node);
    return node;
  };

  // The stream each getUserMedia call hands out, by the device it was asked for. The
  // harness assigns its own override later; the accessor wraps whatever is assigned.
  let innerGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const requestedId = (constraints) => {
    const audio = constraints && constraints.audio;
    if (typeof audio !== "object" || audio === null) return "(none)";
    const id = audio.deviceId;
    if (typeof id === "string") return id;
    if (Array.isArray(id)) return String(id[0]);
    if (typeof id === "object" && id !== null) {
      const value = id.exact ?? id.ideal;
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
    return "(none)";
  };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    get() {
      return async (constraints) => {
        const stream = await innerGetUserMedia(constraints);
        streams.set(stream, requestedId(constraints));
        return stream;
      };
    },
    set(fn) { innerGetUserMedia = fn; },
  });

  // The recorder module is loaded when a context is CONSTRUCTED, so the load is over long
  // before the first take. Loaded at the loopback's attach() instead, it made the first
  // take of a run start 117 ms after its record request (run 1790716387848, head deficit
  // 81.7 ms on both tapes of repeat 1).
  const NativeAudioContext = window.AudioContext;
  window.AudioContext = new Proxy(NativeAudioContext, {
    construct(target, args, newTarget) {
      const context = Reflect.construct(target, args, newTarget);
      try { stateOf(context); } catch (error) { fail("construct", error); }
      return context;
    },
  });

  const nativeCreateDestination = AudioContext.prototype.createMediaStreamDestination;
  const destinations = new WeakSet();
  AudioContext.prototype.createMediaStreamDestination = function (...args) {
    const node = nativeCreateDestination.apply(this, args);
    destinations.add(node);
    stateOf(this);
    return node;
  };

  const nativeCreateSource = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (stream) {
    const node = nativeCreateSource.call(this, stream);
    sources.set(node, { node, deviceId: streams.get(stream) ?? "(unknown stream)", createdAtSec: this.currentTime, context: this });
    stateOf(this);
    return node;
  };

  const attachTap = (info, sdkConnectSec) => {
    const context = info.context;
    const state = stateOf(context);
    const chunks = [];
    const quanta = Math.ceil((context.sampleRate * TAP_SECONDS) / QUANTUM);
    const record = {
      context: state.index, sampleRate: context.sampleRate, deviceId: info.deviceId,
      sourceCreatedAtSec: info.createdAtSec, sdkConnectSec, tapAttachSec: null,
      firstFrame: null, skippedQuanta: null, lags: null, mad: null, secondMad: null, windowFrames: null,
    };
    probe.taps.push(record);
    state.module.then(() => setTimeout(() => {
      try {
        let received = 0;
        const node = recorder(context, quanta, quanta, (chunk) => {
          chunks.push(chunk);
          received += chunk.count;
          if (received >= quanta) {
            try { info.node.disconnect(node); } catch (error) { /* chain already destroyed */ }
            // The reference trails by up to one chunk of its own: wait for it to cover the tap.
            setTimeout(() => measure(state, chunks, record), 600);
          }
        });
        record.tapAttachSec = context.currentTime;
        nativeConnect.call(info.node, node);
      } catch (error) { fail("attachTap", error); }
    }, TAP_ATTACH_DELAY_MS));
  };

  // Quanta laid out on the frame axis from `first`; a quantum never delivered stays NaN.
  const layOut = (chunks, first, length) => {
    const out = new Float32Array(length).fill(NaN);
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count; i++) {
        const at = chunk.frames[i] - first;
        if (at < 0 || at + QUANTUM > length) continue;
        out.set(chunk.buf.subarray(i * QUANTUM, (i + 1) * QUANTUM), at);
      }
    }
    return out;
  };

  const measure = (state, chunks, record) => {
    try {
      const frames = chunks.flatMap((chunk) => Array.from(chunk.frames.subarray(0, chunk.count)));
      const first = frames[0];
      const last = frames[frames.length - 1];
      record.firstFrame = first;
      record.skippedQuanta = (last - first) / QUANTUM + 1 - frames.length;
      const tap = layOut(chunks, first, last - first + QUANTUM);
      const maxLag = Math.round(record.sampleRate * 0.12);
      const refFirst = first - maxLag;
      const ref = layOut(state.ref, refFirst, tap.length + maxLag);
      record.lags = []; record.mad = []; record.secondMad = []; record.windowFrames = [];
      // Three windows, each opened 64 frames before the first loud sample found from
      // 0.3 s, 0.9 s and 1.5 s into the tap.
      for (const fromSec of [0.3, 0.9, 1.5]) {
        let onset = -1;
        for (let i = Math.round(fromSec * record.sampleRate); i + WINDOW < tap.length; i++) {
          if (Math.abs(tap[i]) > 0.05) { onset = i; break; }
        }
        if (onset < 0) { record.lags.push(-2); record.mad.push(-1); record.secondMad.push(-1); record.windowFrames.push(-1); continue; }
        const t0 = onset - 64;
        let best = -1, bestSad = Infinity, second = Infinity, refused = false;
        for (let lag = 0; lag <= maxLag; lag++) {
          const r0 = t0 - lag + maxLag;
          let sad = 0;
          for (let k = 0; k < WINDOW; k++) sad += Math.abs(tap[t0 + k] - ref[r0 + k]);
          if (Number.isNaN(sad)) { refused = true; break; }
          if (sad < bestSad) { second = bestSad; bestSad = sad; best = lag; }
          else if (sad < second) second = sad;
        }
        record.lags.push(refused ? -3 : best);
        record.mad.push(refused ? -1 : bestSad / WINDOW);
        record.secondMad.push(refused ? -1 : second / WINDOW);
        record.windowFrames.push(first + t0);
      }
    } catch (error) { fail("measure", error); }
  };

  AudioNode.prototype.connect = function (target, output, input) {
    const result = nativeConnect.call(this, target, output, input);
    try {
      if (destinations.has(target)) {
        const state = stateOf(this.context);
        if (!state.refAttached) {
          state.refAttached = true;
          const source = this;
          state.module.then(() => {
            const node = recorder(source.context, 0, 64, (chunk) => { state.ref.push(chunk); probe.refChunks++; });
            nativeConnect.call(source, node);
          }).catch((error) => fail("reference", error));
        }
      } else if (sources.has(this) && target instanceof GainNode) {
        gains.set(target, sources.get(this));
      } else if (gains.has(this) && target instanceof AudioWorkletNode && !ours.has(target)) {
        attachTap(gains.get(this), this.context.currentTime);
      }
    } catch (error) { fail("connect", error); }
    return result;
  };
})();
