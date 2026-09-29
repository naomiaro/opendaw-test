// Two-tap spike: is a loopback stream's delay a property of the STREAM (clone) or of the
// CONSUMING MediaStreamAudioSourceNode?
//
// One MediaStreamAudioDestinationNode fed with white noise, in the context the harness
// uses ({ latencyHint: 0, sampleRate }). Per open: two clones of its stream, two
// MediaStreamAudioSourceNodes on EACH clone, every source, through a gain of its own,
// into its own recorder worklet that stamps each render quantum with `currentFrame`. A fifth recorder takes the noise
// directly. A tap's delay is the lag, in whole frames, at which its recording equals the
// direct one — read on the context clock, no SDK involved.
//
// Variants:
//   together   all four sources created and connected in one task
//   staggered  sources created in one task, each connected to its recorder after its own
//              wait (A 0 ms, B gap, C 0 ms, D gap) — a consumer that starts pulling later
//   lateCreate A and C created and connected first, B and D created (and connected)
//              `gap` later on the same clones
//   sameNode   ONE source node per clone (A on clone 0, C on clone 1). B is a second
//              recorder on A's gain, D a second recorder on C's source node itself, both
//              attached `gap` after the first recorder — a second listener on the same
//              consumer, not a second consumer
// Page side: loaded with page.addScriptTag, run with window.runTwoTapSpike(cfg) — see
// run-two-tap-spike.playwright.js.
window.runTwoTapSpike = async (cfg) => {
    const QUANTUM = 128;
    const ctx = new AudioContext({ latencyHint: 0, sampleRate: cfg.sampleRate });
    await ctx.resume();
    if (ctx.state !== "running") throw new Error("context not running: " + ctx.state);
    const workletSource = `
      class TapRecorder extends AudioWorkletProcessor {
        constructor(options) {
          super();
          this.n = options.processorOptions.quanta;
          this.buf = new Float32Array(this.n * 128);
          this.frames = new Float64Array(this.n);
          this.chans = new Uint8Array(this.n);
          this.i = 0;
        }
        process(inputs) {
          if (this.i >= this.n) return false;
          const input = inputs[0];
          this.frames[this.i] = currentFrame;
          this.chans[this.i] = input.length;
          if (input.length > 0) this.buf.set(input[0], this.i * 128);
          this.i++;
          if (this.i === this.n) {
            this.port.postMessage({ buf: this.buf, frames: this.frames, chans: this.chans },
              [this.buf.buffer, this.frames.buffer, this.chans.buffer]);
          }
          return true;
        }
      }
      registerProcessor("tap-recorder", TapRecorder);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" })));

    // 20 s of noise, looped: no lag under 20 s is ambiguous.
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 20, ctx.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      samples[i] = ((seed >>> 0) / 0xffffffff - 0.5) * 0.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const bus = ctx.createGain();
    noise.connect(bus);
    const dest = ctx.createMediaStreamDestination();
    bus.connect(dest);
    noise.start();
    await new Promise((r) => setTimeout(r, 500));

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const recorder = (quanta) => {
      const node = new AudioWorkletNode(ctx, "tap-recorder", {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit",
        processorOptions: { quanta },
      });
      const done = new Promise((resolve) => { node.port.onmessage = (e) => resolve(e.data); });
      return { node, done };
    };
    // A recorder's quanta laid out on the context's frame axis. A quantum the worklet was
    // not called for stays NaN, so a window that touches one is refused instead of read
    // at the wrong frame.
    const layOut = (data) => {
      const first = data.frames[0];
      const last = data.frames[data.frames.length - 1];
      const buf = new Float32Array(last - first + QUANTUM).fill(NaN);
      const gaps = [];
      for (let i = 0; i < data.frames.length; i++) {
        buf.set(data.buf.subarray(i * QUANTUM, (i + 1) * QUANTUM), data.frames[i] - first);
        if (i > 0 && data.frames[i] !== data.frames[i - 1] + QUANTUM) {
          gaps.push({ afterQuantum: i - 1, missingFrames: data.frames[i] - data.frames[i - 1] - QUANTUM });
        }
      }
      return { first, buf, gaps, chans: data.chans };
    };
    // Lag (frames) at which tap[f] === ref[f - lag], searched at the window starting at
    // absolute frame f0. Returns the best lag and its mean absolute difference.
    const MAX_LAG = Math.round(ctx.sampleRate * 0.12);
    const WINDOW = 256;
    const findLag = (tap, ref, f0) => {
      const t0 = f0 - tap.first;
      let best = -1, bestSad = Infinity, second = Infinity;
      for (let lag = 0; lag <= MAX_LAG; lag++) {
        const r0 = f0 - lag - ref.first;
        if (r0 < 0) break;
        let sad = 0;
        for (let k = 0; k < WINDOW && sad < second; k++) sad += Math.abs(tap.buf[t0 + k] - ref.buf[r0 + k]);
        if (Number.isNaN(sad)) return { lag: -3, mad: -1, secondMad: -1 };
        if (sad < bestSad) { second = bestSad; bestSad = sad; best = lag; }
        else if (sad < second) second = sad;
      }
      return { lag: best, mad: bestSad / WINDOW, secondMad: second / WINDOW };
    };

    const rows = [];
    const recordQuanta = Math.ceil((ctx.sampleRate * 1.3) / QUANTUM);
    for (const variant of cfg.variants) {
      for (let open = 0; open < cfg.opens; open++) {
        const gapMs = variant === "together" ? 0 : 5 + Math.random() * 95;
        const ref = recorder(recordQuanta + Math.ceil((ctx.sampleRate * 0.2) / QUANTUM));
        bus.connect(ref.node);
        await sleep(150);
        const clones = [dest.stream.clone(), dest.stream.clone()];
        const taps = { A: { clone: 0, late: false }, B: { clone: 0, late: true }, C: { clone: 1, late: false }, D: { clone: 1, late: true } };
        const names = Object.keys(taps);
        const make = (name) => {
          const tap = taps[name];
          tap.createdAt = ctx.currentTime;
          tap.source = ctx.createMediaStreamSource(clones[tap.clone]);
          tap.gain = ctx.createGain();
          tap.source.connect(tap.gain);
        };
        const connect = (name) => {
          const tap = taps[name];
          tap.rec = recorder(recordQuanta);
          tap.connectedAt = ctx.currentTime;
          tap.gain.connect(tap.rec.node);
        };
        if (variant === "together") {
          names.forEach(make);
          names.forEach(connect);
        } else if (variant === "staggered") {
          names.forEach(make);
          names.filter((n) => !taps[n].late).forEach(connect);
          await sleep(gapMs);
          names.filter((n) => taps[n].late).forEach(connect);
        } else if (variant === "sameNode") {
          make("A"); connect("A");
          make("C"); connect("C");
          await sleep(gapMs);
          taps.B.createdAt = taps.A.createdAt; taps.B.source = taps.A.source; taps.B.gain = taps.A.gain;
          connect("B");
          taps.D.createdAt = taps.C.createdAt; taps.D.source = taps.C.source; taps.D.gain = taps.C.source;
          connect("D");
        } else {
          names.filter((n) => !taps[n].late).forEach((n) => { make(n); connect(n); });
          await sleep(gapMs);
          names.filter((n) => taps[n].late).forEach((n) => { make(n); connect(n); });
        }
        const refData = layOut(await ref.done);
        const row = { variant, open, gapMs: Number(gapMs.toFixed(2)), sampleRate: ctx.sampleRate, taps: {} };
        row.refGaps = refData.gaps;
        for (const name of names) {
          const tap = taps[name];
          const data = layOut(await tap.rec.done);
          let firstActive = -1;
          for (let i = 0; i < data.chans.length; i++) if (data.chans[i] > 0) { firstActive = i; break; }
          let firstNonZero = -1;
          for (let i = 0; i < data.buf.length; i++) if (data.buf[i] !== 0 && !Number.isNaN(data.buf[i])) { firstNonZero = i; break; }
          const firstFrame = data.first;
          const lastConnectFrame = Math.round(tap.connectedAt * ctx.sampleRate);
          const lags = [0.4, 0.7, 1.0].map((sec) => {
            const f0 = lastConnectFrame + Math.round(sec * ctx.sampleRate);
            if (f0 + WINDOW > firstFrame + data.buf.length) return { lag: -2, mad: -1, secondMad: -1 };
            return findLag(data, refData, Math.max(f0, firstFrame + QUANTUM));
          });
          row.taps[name] = {
            clone: tap.clone,
            createdAtFrame: Math.round(tap.createdAt * ctx.sampleRate),
            connectedAtFrame: lastConnectFrame,
            firstFrame,
            gaps: data.gaps,
            firstActiveQuantum: firstActive,
            firstSignalFrame: firstNonZero < 0 ? -1 : firstFrame + firstNonZero,
            lags: lags.map((l) => l.lag),
            mad: lags.map((l) => Number(l.mad.toExponential(2))),
            secondMad: lags.map((l) => Number(l.secondMad.toExponential(2))),
          };
          tap.gain.disconnect();
          tap.source.disconnect();
        }
        bus.disconnect(ref.node);
        clones.forEach((c) => c.getTracks().forEach((t) => t.stop()));
        rows.push(row);
      }
    }
    await ctx.close();

    const summary = {};
    for (const variant of cfg.variants) {
      const vr = rows.filter((r) => r.variant === variant);
      const stable = vr.filter((r) => Object.values(r.taps).every((t) => t.lags.every((l) => l === t.lags[0] && l >= 0)));
      const diff = (a, b) => vr.map((r) => r.taps[b].lags[2] - r.taps[a].lags[2]);
      const tally = (values) => {
        const counts = {};
        for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
        return counts;
      };
      summary[variant] = {
        opens: vr.length,
        lagStableWithinRecording: stable.length,
        sameClone_BminusA: tally(diff("A", "B")),
        sameClone_DminusC: tally(diff("C", "D")),
        twoClones_CminusA: tally(diff("A", "C")),
        twoClones_DminusB: tally(diff("B", "D")),
        lagA: tally(vr.map((r) => r.taps.A.lags[2])),
        lagMod32: tally(vr.flatMap((r) => Object.values(r.taps).map((t) => t.lags[2] % 32))),
        worstMad: Math.max(...vr.flatMap((r) => Object.values(r.taps).flatMap((t) => t.mad))),
      };
    }
    const artifact = { cfg, userAgent: navigator.userAgent, baseLatency: ctx.baseLatency, rows, summary };
    const name = "spike-two-tap-" + String(cfg.sampleRate) + "-" + cfg.variants.join("-").toLowerCase() + "-" + String(Date.now()) + ".json";
    const put = await fetch("/__verify/" + name, { method: "PUT", body: JSON.stringify(artifact, null, 1) });
    return { saved: put.ok ? name : "UPLOAD FAILED " + String(put.status), userAgent: navigator.userAgent, summary };
};
