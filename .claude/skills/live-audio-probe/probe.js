// Page-side measurement rig (see SKILL.md beside this file). Install as early after navigation as possible:
// a node pair wired before the patch is in place is never seen. Silent: nothing here reaches the speakers.
// Times are FRAMES of the audio clock (P.now()), so a span can be cut exactly.
(() => {
  if (window.__probe) return "already installed";
  const nativeConnect = AudioNode.prototype.connect;
  const P = (window.__probe = { nativeConnect, rules: [], teed: 0, pairs: [], results: {}, blocks: [], clicks: [], micRequests: 0 });
  const BLOCK = 2048;

  // Tee at wiring time. An app that wires a path on demand wires a NEW pair each time; a tap attached
  // afterwards misses the first milliseconds and reads low while it settles.
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioNode) {
      // The wiring order, to find which pair to match: read P.pairs after switching the path on.
      // Clear it (P.pairs.length = 0) just before the switch whose wiring you want to read.
      const output = typeof rest[0] === "number" ? rest[0] : 0;
      if (P.pairs.length < 2000) P.pairs.push(this.constructor.name + (output ? "[" + output + "]" : "") + ">" + dest.constructor.name);
      for (const rule of P.rules) {
        let hit = false;
        try { hit = rule.match(this, dest, output); } catch { /* a throwing rule never breaks the app */ }
        if (hit) attach(this, output, rule.sink);
      }
    }
    return nativeConnect.call(this, dest, ...rest);
  };
  // The tee takes the SAME output of the source the app connected (a worklet's second output stays the second).
  // It reads what LEAVES the source: the destination node's own gain is not in it. Every pair that matches
  // is teed and stays teed, summed into the sink: make the rule narrow, and P.teed should rise by one per switch.
  const attach = (source, output, sink) => {
    if (!P[sink]) { P.waiting.push([source, output, sink]); return; } // matched before P.start: attached there
    try { nativeConnect.call(source, P[sink], output); P.teed++; } catch (error) { P.teeErrors.push(String(error)); }
  };
  P.waiting = []; P.teeErrors = [];
  // sink: "out" (the path under test) or "mix" (a second tap, for the shared output).
  P.tee = (match, sink = "out") => { P.rules.push({ match, sink }); return P.rules.length; };

  // One recorder, three channels in the SAME render quantum: 0 = reference (what was sent in),
  // 1 = the path under test, 2 = a second tap ("mix"). Two analysers read one after the other are not frame-aligned.
  // It records on the audio thread, so a blocked main thread delays blocks but loses none.
  // Works on a suspended context (nothing is recorded until it runs). Keeps the last 1500 blocks: about 65 s.
  P.start = async (ctx) => {
    P.ctx = ctx; P.rate = ctx.sampleRate;
    const mono = () => { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = "explicit"; return g; };
    P.ref = mono(); P.out = mono(); P.mix = mono();
    const merger = ctx.createChannelMerger(3), mute = ctx.createGain(); mute.gain.value = 0;
    [P.ref, P.out, P.mix].forEach((node, i) => nativeConnect.call(node, merger, 0, i));
    const keep = (f0, channels) => { P.blocks.push({ f0, channels }); if (P.blocks.length > 1500) P.blocks.shift(); };
    for (const [source, output, sink] of P.waiting.splice(0)) attach(source, output, sink);
    let recorder;
    try {
      const code = `registerProcessor("probe-recorder", class extends AudioWorkletProcessor {
        constructor() { super(); this.n = 0; this.c = [0, 1, 2].map(() => new Float32Array(${BLOCK})); }
        process(inputs) { if (this.n === 0) this.f0 = currentFrame;
          for (let k = 0; k < 3; k++) { const x = inputs[0][k]; if (x) this.c[k].set(x, this.n); else this.c[k].fill(0, this.n, this.n + 128); }
          this.n += 128; if (this.n === ${BLOCK}) { this.port.postMessage({ f0: this.f0, channels: this.c.map((x) => x.slice()) }); this.n = 0; }
          return true; } });`;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      recorder = new AudioWorkletNode(ctx, "probe-recorder", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 3, channelCountMode: "explicit", channelInterpretation: "discrete" });
      recorder.port.onmessage = (event) => keep(event.data.f0, event.data.channels);
      P.recorder = "worklet";
    } catch {
      // A page that refuses a blob worklet: main-thread recorder. It DROPS blocks when the main thread
      // is blocked, and its frame numbers run one buffer ahead; say so in the report.
      recorder = ctx.createScriptProcessor(BLOCK, 3, 1);
      recorder.onaudioprocess = (e) => keep(Math.round(e.playbackTime * P.rate), [0, 1, 2].map((k) => e.inputBuffer.getChannelData(k).slice()));
      P.recorder = "script-processor";
    }
    nativeConnect.call(merger, recorder); nativeConnect.call(recorder, mute); nativeConnect.call(mute, ctx.destination);
    // Every pointer press with the audio clock read at that moment (good to a few ms; a keyboard
    // shortcut is not logged): P.clicks.at(-1).frame is where a span around a click starts.
    addEventListener("pointerdown", (e) => P.clicks.push({ frame: P.now(), what: ((e.target.closest && e.target.closest("button")) || e.target).textContent.trim().slice(0, 30) }), true);
    return `recording at ${P.rate} Hz (${P.recorder})`;
  };
  P.now = () => Math.round(P.ctx.currentTime * P.rate);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  P.wait = wait;
  // Frames [from, to) of one channel, and how many blocks of that span are missing.
  P.span = (channel, from, to = P.now()) => {
    const end = P.blocks.length ? P.blocks[P.blocks.length - 1].f0 + BLOCK : from;
    to = Math.min(to, end);
    const x = new Float32Array(Math.max(0, to - from)); let covered = 0;
    for (const block of P.blocks) {
      const a = Math.max(from, block.f0), b = Math.min(to, block.f0 + BLOCK);
      if (b <= a) continue;
      x.set(block.channels[channel].subarray(a - block.f0, b - block.f0), a - from); covered += b - a;
    }
    return { x, missingFrames: x.length - covered };
  };

  // A microphone that survives: apps stop the track they were given when input is released,
  // so every request gets a FRESH stream fed from the one bus. P.micRequests counts them:
  // if it did not rise when the input was switched on, the app is not using this microphone.
  P.fakeMic = () => {
    P.micBus = P.ctx.createGain();
    nativeConnect.call(P.micBus, P.ref);
    navigator.mediaDevices.getUserMedia = async () => {
      P.micRequests++;
      const destination = P.ctx.createMediaStreamDestination(); destination.channelCount = 1;
      nativeConnect.call(P.micBus, destination);
      return destination.stream;
    };
    return "fake microphone installed";
  };
  // Use multiples of 1 kHz (1000, 2000, 3000): whole cycles in the envelope's steps, and clear of the
  // 5 kHz delay bursts. Call P.fakeMic() first.
  P.tone = (hz, gain = 0.05, into = P.micBus) => {
    const osc = P.ctx.createOscillator(); osc.frequency.value = hz;
    const g = P.ctx.createGain(); g.gain.value = gain;
    nativeConnect.call(osc, g); nativeConnect.call(g, into); osc.start();
    return { stop: () => osc.stop(), gain: g.gain };
  };

  // The positive control for an envelope: mute a tone for `ms`, starting 0.5 s from now.
  P.mute = (tone, ms = 30) => { const g = tone.gain, level = g.value, t = P.ctx.currentTime + 0.5; g.setValueAtTime(0, t); g.setValueAtTime(level, t + ms / 1000); return P.now(); };

  // Delay of the path: n bursts on the audio clock, each onset found in both channels.
  // A delay longer than 0.8 of gapMs reads as null: raise gapMs.
  P.delay = async (n = 8, gapMs = 250, hz = 5000) => {
    if (P.ctx.state !== "running") throw new Error("the AudioContext is " + P.ctx.state);
    const from = P.now(), t0 = P.ctx.currentTime + 0.3;
    for (let i = 0; i < n; i++) {
      const osc = P.ctx.createOscillator(); osc.frequency.value = hz;
      const g = P.ctx.createGain(); g.gain.value = 0.2;
      nativeConnect.call(osc, g); nativeConnect.call(g, P.micBus);
      osc.start(t0 + (i * gapMs) / 1000); osc.stop(t0 + (i * gapMs) / 1000 + 0.003);
    }
    await wait(300 + n * gapMs + 500);
    const r = P.span(0, from), o = P.span(1, from), ref = r.x, out = o.x;
    const peak = (x, a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
    const refPeak = peak(ref, 0, ref.length), gapFrames = Math.round((gapMs / 1000) * P.rate), lags = [];
    for (let i = 0; i < ref.length && refPeak > 0; i++) {
      if (Math.abs(ref[i]) < 0.5 * refPeak) continue;
      const end = Math.min(out.length, i + Math.round(gapFrames * 0.8)), outPeak = peak(out, i, end);
      let j = i; while (j < end && Math.abs(out[j]) < 0.5 * outPeak) j++;
      // A burst that never came out is reported, not skipped.
      lags.push(outPeak < 0.02 * refPeak || j === end ? null : +(((j - i) / P.rate) * 1000).toFixed(2));
      i += Math.round(gapFrames * 0.8);
    }
    const found = lags.filter((l) => l !== null).sort((a, b) => a - b);
    return { sent: n, lagsMs: lags, medianMs: found.length ? found[found.length >> 1] : null,
      spreadMs: found.length ? +(found[found.length - 1] - found[0]).toFixed(2) : null, missingFrames: r.missingFrames };
  };

  // The fake microphone's own cost: a stream destination read back by a stream source, nothing else.
  // Run it while the path under test is NOT wired (both would land on P.out and the earlier onset wins).
  P.bridge = async () => {
    const destination = P.ctx.createMediaStreamDestination(); destination.channelCount = 1;
    nativeConnect.call(P.micBus, destination);
    const source = P.ctx.createMediaStreamSource(destination.stream);
    nativeConnect.call(source, P.out);
    const result = await P.delay();
    source.disconnect(); P.micBus.disconnect(destination);
    return result;
  };

  // Level over time in 1 ms steps: the range against the median, and every run under half or over
  // 1.5 times the median (atMs counts from `from`). With `hz`: that one frequency in 5 ms steps, and
  // the runs where it is present, to follow one tone inside a mix.
  P.envelope = (from, to = P.now(), { channel = 1, hz = 0 } = {}) => {
    const { x, missingFrames } = P.span(channel, from, to), stepMs = hz ? 5 : 1, step = Math.round((P.rate * stepMs) / 1000), level = [];
    const w = (2 * Math.PI * hz) / P.rate;
    for (let i = 0; i + step <= x.length; i += step) {
      let s = 0, re = 0, im = 0;
      for (let k = i; k < i + step; k++) { s += x[k] * x[k]; if (hz) { re += x[k] * Math.cos(w * k); im += x[k] * Math.sin(w * k); } }
      level.push(hz ? (2 * Math.hypot(re, im)) / step : Math.sqrt(s / step));
    }
    const sorted = [...level].sort((a, b) => a - b), median = sorted[sorted.length >> 1] || 0, peak = sorted[sorted.length - 1] || 0, runs = [];
    for (let i = 0; i < level.length; i++) {
      // One frequency: where it is PRESENT (at least half its own peak). Whole signal: where it leaves the median.
      const kind = hz ? (peak > 1e-4 && level[i] >= 0.5 * peak ? "present" : null)
        : level[i] < 0.5 * median ? "low" : level[i] > 1.5 * median ? "high" : null;
      const last = runs[runs.length - 1];
      if (kind && last && last.kind === kind && last.atMs + last.ms === i * stepMs) last.ms += stepMs;
      else if (kind) runs.push({ kind, atMs: i * stepMs, ms: stepMs });
    }
    const db = (v) => (median > 0 && v > 0 ? +(20 * Math.log10(v / median)).toFixed(2) : null);
    return { spanMs: level.length * stepMs, median: +median.toFixed(5), peak: +peak.toFixed(5), silent: peak < 1e-4,
      minDb: db(sorted[0]), maxDb: db(peak), runs: runs.filter((r) => r.ms >= 2 * stepMs), missingFrames };
  };

  // A tool call that runs past its limit is cut off: start the work, poll P.results[name].
  P.run = (name, work) => { P.results[name] = "running"; work().then((r) => (P.results[name] = r), (e) => (P.results[name] = "THREW " + (e && e.message))); return "started " + name; };
  // Some tool layers block output that looks like a query string.
  P.text = (value) => JSON.stringify(value).replace(/[=&?]/g, "~");
  return "probe installed";
})();
