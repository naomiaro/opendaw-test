// Does a worklet's currentFrame always name the block it is handed? No SDK.
//
// A noise source started at a known frame feeds recorder worklets made fresh, as a
// take's are; each records its first quanta with their stamps. The frame a quantum
// really is comes from its content, matched against the noise buffer; `off` is the
// stamp less that frame, 0 when the stamp is true.
//
// Page side: loaded with page.addScriptTag, run with window.runWorkletClock(cfg) — see
// run-worklet-clock.playwright.js.
window.runWorkletClock = async (cfg) => {
  const QUANTUM = 128;
  const ctx = new AudioContext({ latencyHint: 0, sampleRate: cfg.sampleRate });
  await ctx.resume();
  const source = `
    class FirstQuanta extends AudioWorkletProcessor {
      constructor(o) { super(); this.n = o.processorOptions.quanta; this.buf = new Float32Array(this.n * 128); this.frames = new Float64Array(this.n); this.times = new Float64Array(this.n); this.i = 0; }
      process(inputs) {
        if (this.i >= this.n) return false;
        const input = inputs[0];
        this.frames[this.i] = currentFrame;
        this.times[this.i] = currentTime;
        if (input.length > 0) this.buf.set(input[0], this.i * 128); else this.buf.fill(NaN, this.i * 128, (this.i + 1) * 128);
        this.i++;
        if (this.i === this.n) this.port.postMessage({ buf: this.buf, frames: this.frames, times: this.times });
        return true;
      }
    }
    registerProcessor("first-quanta", FirstQuanta);`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([source], { type: "application/javascript" })));
  const length = ctx.sampleRate * 30;
  const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  let seed = 0x9e3779b9;
  for (let i = 0; i < length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; noise[i] = ((seed >>> 0) / 0xffffffff - 0.5) * 0.5; }
  const node = ctx.createBufferSource();
  node.buffer = noiseBuffer; node.loop = true;
  const bus = ctx.createGain();
  node.connect(bus);
  // A source nothing pulls does not run: a silent path to the destination keeps it
  // rendering from its start time on, whether or not a recorder is attached.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  bus.connect(sink);
  sink.connect(ctx.destination);
  const startFrame = Math.round((ctx.currentTime + 0.1) * ctx.sampleRate / QUANTUM) * QUANTUM + 37; // off the quantum grid on purpose
  node.start(startFrame / ctx.sampleRate);
  await new Promise((r) => setTimeout(r, 400));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const trueFrameOf = (quantum, stamp) => {
    // Candidates within ±4 quanta of the stamp; the content says which.
    for (const d of [0, -128, 128, -256, 256, -384, 384, -512, 512]) {
      let same = true;
      for (let k = 0; k < QUANTUM; k += 7) {
        const at = (((stamp + d + k - startFrame) % length) + length) % length;
        if (quantum[k] !== noise[at]) { same = false; break; }
      }
      if (same) return stamp + d;
    }
    return null;
  };
  const rows = [];
  const batch = cfg.batch ?? 1;
  const dest = cfg.streams ? ctx.createMediaStreamDestination() : null;
  if (dest !== null) bus.connect(dest);
  for (let open = 0; open < cfg.opens; open++) {
    // As a take starts: streams opened, source nodes built, recorders made, all in one task.
    const churn = [];
    if (dest !== null) {
      for (let k = 0; k < 2; k++) {
        const clone = dest.stream.clone();
        const node = ctx.createMediaStreamSource(clone);
        const gain = ctx.createGain();
        node.connect(gain);
        churn.push({ clone, node, gain });
      }
    }
    const recorders = [];
    const mainFrameAtConnect = Math.round(ctx.currentTime * ctx.sampleRate);
    for (let b = 0; b < batch; b++) {
      const rec = new AudioWorkletNode(ctx, "first-quanta", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit", processorOptions: { quanta: cfg.quanta } });
      const done = new Promise((resolve) => { rec.port.onmessage = (e) => resolve(e.data); });
      bus.connect(rec);
      recorders.push({ rec, done });
    }
    if (cfg.jankMs > 0) { const until = performance.now() + cfg.jankMs; while (performance.now() < until) { /* hold the main thread */ } }
    for (let b = 0; b < batch; b++) {
      const data = await recorders[b].done;
      bus.disconnect(recorders[b].rec);
      const offs = []; const stampSteps = []; const timeVsFrame = [];
      for (let q = 0; q < cfg.quanta; q++) {
        const quantum = data.buf.subarray(q * QUANTUM, (q + 1) * QUANTUM);
        const stamp = data.frames[q];
        if (Number.isNaN(quantum[0])) { offs.push("no input"); } else {
          const real = trueFrameOf(quantum, stamp);
          offs.push(real === null ? "no match" : stamp - real);
        }
        if (q > 0) stampSteps.push(stamp - data.frames[q - 1]);
        timeVsFrame.push(Math.round(data.times[q] * ctx.sampleRate) - stamp);
      }
      rows.push({ open, recorder: b, mainFrameAtConnect, firstStamp: data.frames[0], offs, stampSteps, timeVsFrame });
    }
    for (const c of churn) { c.node.disconnect(); c.clone.getTracks().forEach((t) => t.stop()); }
    await sleep(cfg.gapMs);
  }
  await ctx.close();
  const tally = (a) => { const c = {}; for (const v of a) c[v] = (c[v] ?? 0) + 1; return c; };
  const summary = {
    recordings: rows.length,
    offFirstQuantum: tally(rows.map((r) => r.offs[0])),
    offLaterQuanta: tally(rows.flatMap((r) => r.offs.slice(1))),
    stampSteps: tally(rows.flatMap((r) => r.stampSteps)),
    currentTimeMinusCurrentFrame: tally(rows.flatMap((r) => r.timeVsFrame)),
    firstStampMinusMainAtConnect: tally(rows.map((r) => r.firstStamp - r.mainFrameAtConnect)),
    opensWithAnOffStamp: rows.filter((r) => r.offs.some((o) => typeof o === "number" && o !== 0)).map((r) => ({ open: r.open, offs: r.offs.join(","), steps: r.stampSteps.join(",") })).slice(0, 12),
  };
  const name = "worklet-clock-" + String(cfg.sampleRate) + "-jank" + String(cfg.jankMs) + "-batch" + String(batch) + (cfg.streams ? "-streams" : "") + "-" + String(Date.now()) + ".json";
  const put = await fetch("/__verify/" + name, { method: "PUT", body: JSON.stringify({ cfg, userAgent: navigator.userAgent, startFrame, rows, summary }, null, 1) });
  return { saved: put.ok ? name : "UPLOAD FAILED", summary };
};
