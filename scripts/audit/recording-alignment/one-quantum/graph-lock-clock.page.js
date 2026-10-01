// Does a worklet's currentFrame name the block it is handed while the main thread
// changes the audio graph? No SDK.
//
// A buffer source plays a ramp whose every sample says which frame of the buffer it is,
// started at a known context frame. A worklet records, for each `process` call, the
// `currentFrame` it read and the first sample of its input: the frame the quantum really
// is comes from the sample, `off` is the stamp less that frame, 0 when the stamp is true.
// Meanwhile the main thread does one kind of work in bursts (`cfg.conditions`):
//   idle     nothing
//   busy     a loop that touches no audio object
//   connect  connect and disconnect two gain nodes that are in nobody's path
//   create   create gain nodes
//   stream   build a MediaStreamAudioSourceNode on a stream and connect it to a fresh
//            worklet node, as the start of a take does. The fresh worklet also gets the
//            ramp, and reports the `currentFrame` of its FIRST call with the sample it
//            was handed: the read a recorder makes once, at the start of a take.
//
// The result goes to .verify-output/graph-lock-clock-<time>.json.
//
// Page side: loaded with page.addScriptTag, run with window.runGraphLockClock(cfg) — see
// run-graph-lock-clock.playwright.js.
window.runGraphLockClock = async (cfg) => {
  const QUANTUM = 128;
  const ctx = new AudioContext({ latencyHint: 0, sampleRate: cfg.sampleRate });
  try {
    await ctx.resume();
    if (ctx.state !== "running") throw new Error("the context is " + ctx.state + ": the page needs a real click first");
    const within = (promise, ms, what) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(what + " did not come within " + String(ms) + " ms")), ms)),
    ]);
    const source = `
      class ClockWatch extends AudioWorkletProcessor {
        constructor(o) { super(); this.n = o.processorOptions.quanta; this.frames = new Float64Array(this.n); this.first = new Float32Array(this.n); this.i = 0; }
        process(inputs) {
          if (this.i >= this.n) return false;
          const input = inputs[0];
          this.frames[this.i] = currentFrame;
          this.first[this.i] = input.length > 0 ? input[0][0] : NaN;
          this.i++;
          if (this.i === this.n) this.port.postMessage({ frames: this.frames, first: this.first });
          return true;
        }
      }
      registerProcessor("clock-watch", ClockWatch);
      class FreshRecorder extends AudioWorkletProcessor {
        constructor() { super(); this.told = false; }
        process(inputs) {
          const input = inputs[0];
          if (!this.told && input.length > 0 && input[0][0] > 0) {
            this.told = true;
            this.port.postMessage({ frame: currentFrame, first: input[0][0] });
          }
          // done once it has told: thousands of live processors would overload the render thread
          return !this.told;
        }
      }
      registerProcessor("fresh-recorder", FreshRecorder);`;
    const moduleUrl = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
    try {
      await within(ctx.audioWorklet.addModule(moduleUrl), 10000, "the worklet module");
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const rate = ctx.sampleRate;
    const length = Math.round((cfg.seconds + 2) * rate);
    const ramp = ctx.createBuffer(1, length, rate);
    const samples = ramp.getChannelData(0);
    // sample i holds (i + 1) / length: never 0, so silence before the start is told apart
    for (let i = 0; i < length; i++) samples[i] = (i + 1) / length;

    // gain nodes in nobody's path, and a stream to build source nodes on
    const loose = [ctx.createGain(), ctx.createGain()];
    const streamOut = ctx.createMediaStreamDestination();
    const kept = [];
    const work = {
      idle: () => 0,
      busy: (until) => { let n = 0; while (performance.now() < until) n++; return n; },
      connect: (until) => {
        let n = 0;
        while (performance.now() < until) { loose[0].connect(loose[1]); loose[0].disconnect(loose[1]); n++; }
        return n;
      },
      create: (until) => { let n = 0; while (performance.now() < until) { ctx.createGain(); n++; } return n; },
      stream: (_until, take) => {
        const node = ctx.createMediaStreamSource(streamOut.stream);
        const recorder = new AudioWorkletNode(ctx, "fresh-recorder", {
          numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit",
        });
        recorder.port.onmessage = (event) => take.firstCalls.push(event.data);
        node.connect(recorder);
        take.player.connect(recorder);
        kept.push([node, recorder]);
        if (kept.length > 8) {
          const [oldNode, oldRecorder] = kept.shift();
          oldNode.disconnect(oldRecorder);
          try { take.player.disconnect(oldRecorder); } catch { /* a recorder of an earlier condition: its player is gone */ }
        }
        return 1;
      },
    };

    const results = [];
    for (const condition of cfg.conditions) {
      const quanta = Math.round((cfg.seconds * rate) / QUANTUM);
      const player = ctx.createBufferSource();
      player.buffer = ramp;
      const watch = new AudioWorkletNode(ctx, "clock-watch", {
        numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit",
        processorOptions: { quanta },
      });
      player.connect(watch);
      const done = new Promise((resolve) => { watch.port.onmessage = (event) => resolve(event.data); });
      const startFrame = Math.ceil(((ctx.currentTime + 0.15) * rate) / QUANTUM) * QUANTUM;
      player.start(startFrame / rate);
      let running = true;
      let operations = 0;
      let bursts = 0;
      const take = { player, firstCalls: [] };
      const burst = () => {
        if (!running) return;
        operations += work[condition](performance.now() + cfg.burstMs, take);
        bursts++;
        setTimeout(burst, cfg.gapMs);
      };
      setTimeout(burst, 0);
      let data;
      try {
        data = await within(done, (cfg.seconds + 10) * 1000, "the watch of " + condition);
      } finally {
        running = false;
        player.stop();
        player.disconnect();
      }
      const offs = {};
      const steps = {};
      const stale = [];
      let checked = 0;
      for (let i = 0; i < quanta; i++) {
        if (i > 0) {
          const step = String(data.frames[i] - data.frames[i - 1]);
          steps[step] = (steps[step] ?? 0) + 1;
        }
        const value = data.first[i];
        if (!(value > 0)) continue; // before the ramp started, or no input
        const trueFrame = startFrame + Math.round(value * length) - 1;
        const off = data.frames[i] - trueFrame;
        offs[String(off)] = (offs[String(off)] ?? 0) + 1;
        checked++;
        if (off !== 0 && stale.length < 12) stale.push({ call: i, stamp: data.frames[i], trueFrame, off });
      }
      const trueFrameOf = (value) => startFrame + Math.round(value * length) - 1;
      const result = { condition, quanta, checked, bursts, operations, offs, steps, firstOffs: stale };
      if (condition === "stream") {
        // a fresh recorder's first call: the stamp it read against the frame it was handed
        const freshOffs = {};
        for (const call of take.firstCalls) {
          const off = String(call.frame - trueFrameOf(call.first));
          freshOffs[off] = (freshOffs[off] ?? 0) + 1;
        }
        result.freshRecorders = { built: operations, answered: take.firstCalls.length, offs: freshOffs };
      }
      results.push(result);
    }
    const report = { userAgent: navigator.userAgent, sampleRate: rate, cfg, results };
    const name = "graph-lock-clock-" + String(Date.now()) + ".json";
    const put = await fetch("/__verify/" + name, { method: "PUT", body: JSON.stringify(report, null, 1) });
    return { saved: put.ok ? name : "NOT SAVED (" + String(put.status) + ")", ...report };
  } finally {
    await ctx.close();
  }
};
