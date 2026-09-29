// Node-tap probe, injected with page.addInitScript BEFORE the audit page's own scripts.
//
// A loopback stream's delay belongs to the consuming MediaStreamAudioSourceNode, and a
// second listener on the SAME node reads that node's delay exactly
// (two-tap-spike.page.js). So this probe listens to the SDK's own source nodes:
//
//   reference  the first node connected to a MediaStreamAudioDestinationNode of a
//              context is also recorded, continuously, with every quantum stamped
//              with currentFrame
//   tap        150 ms after the SDK connects a capture chain's gain to its recording
//              worklet, a recorder is attached to that chain's SOURCE NODE for 2 s
//
// A tap's delay is the lag, in whole frames, at which it comes closest to the
// reference — read on the context clock; nothing of the SDK's is used. Attaching after
// the SDK's own connection leaves the moment the node starts being pulled as it was.
// A tap that was not read has `unread` set to the reason and a null in `lags` for every
// window that gave none; it is read when `unread` is null.
(() => {
  const QUANTUM = 128;
  const TAP_SECONDS = 2;
  const TAP_ATTACH_DELAY_MS = 150;
  const WINDOW = 512;
  const probe = (window.__nodeTap = { taps: [], errors: [], refChunks: 0, contexts: 0 });
  const fail = (where, error) => {
    probe.errors.push(where + ": " + String(error));
    console.warn("[node-tap probe] " + where + ": " + String(error));
  };

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
  // before the first take: a module still loading when a take starts delays that take's
  // first frame.
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
    // The probe's own failure must not become the page's.
    try { destinations.add(node); stateOf(this); } catch (error) { fail("createMediaStreamDestination", error); }
    return node;
  };

  const nativeCreateSource = AudioContext.prototype.createMediaStreamSource;
  AudioContext.prototype.createMediaStreamSource = function (stream) {
    const node = nativeCreateSource.call(this, stream);
    try {
      sources.set(node, { node, deviceId: streams.get(stream) ?? "(unknown stream)", createdAtSec: this.currentTime, context: this });
      stateOf(this);
    } catch (error) { fail("createMediaStreamSource", error); }
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
      unread: "the tap has not finished",
    };
    probe.taps.push(record);
    state.module.catch(() => { record.unread = "the recorder module did not load"; });
    state.module.then(() => setTimeout(() => {
      try {
        let received = 0;
        const node = recorder(context, quanta, quanta, (chunk) => {
          chunks.push(chunk);
          received += chunk.count;
          if (received >= quanta) {
            try {
              info.node.disconnect(node);
            } catch (error) {
              // The SDK has taken the chain down already, and the tap's connection with it.
              if (!(error instanceof DOMException) || error.name !== "InvalidAccessError") fail("disconnect", error);
            }
            // The reference trails by up to one chunk of its own: wait for it to cover the tap.
            setTimeout(() => measure(state, chunks, record), 600);
          }
        });
        record.tapAttachSec = context.currentTime;
        nativeConnect.call(info.node, node);
      } catch (error) {
        record.unread = "the tap could not be attached: " + String(error);
        fail("attachTap", error);
      }
    }, TAP_ATTACH_DELAY_MS)).catch(() => { /* recorded above: the module did not load */ });
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
      const reasons = [];
      // Three windows, each opened 64 frames before the first loud sample found from
      // 0.3 s, 0.9 s and 1.5 s into the tap.
      for (const fromSec of [0.3, 0.9, 1.5]) {
        let onset = -1;
        for (let i = Math.round(fromSec * record.sampleRate); i + WINDOW < tap.length; i++) {
          if (Math.abs(tap[i]) > 0.05) { onset = i; break; }
        }
        if (onset < 0) {
          record.lags.push(null); record.mad.push(null); record.secondMad.push(null); record.windowFrames.push(null);
          reasons.push("no signal from " + String(fromSec) + " s on");
          continue;
        }
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
        record.lags.push(refused || best < 0 ? null : best);
        record.mad.push(refused || best < 0 ? null : bestSad / WINDOW);
        record.secondMad.push(refused || best < 0 || second === Infinity ? null : second / WINDOW);
        record.windowFrames.push(first + t0);
        if (refused || best < 0) reasons.push("a quantum is missing at frame " + String(first + t0));
        else if (bestSad > 0) reasons.push("no exact match at frame " + String(first + t0));
      }
      if (reasons.length === 0 && new Set(record.lags).size > 1) reasons.push("the delay moved inside the tap: " + record.lags.join(" / "));
      record.unread = reasons.length === 0 ? null : reasons.join("; ");
    } catch (error) {
      record.unread = "the measurement threw: " + String(error);
      fail("measure", error);
    }
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
