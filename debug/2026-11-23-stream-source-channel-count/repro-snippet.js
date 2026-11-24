// Repro for Chromium issue 589817009: a MediaStreamAudioSourceNode on a stream whose track reports one
// channel hands an AudioWorklet two channels. Paste into the DevTools console of any page after a click
// (the console allows top-level await). No microphone is used and nothing is played.
//
// Logs the track's channelCount and, per input width, how many of 300 render quanta the worklet was
// handed. Chrome 158.0.8127.89 logs: track channelCount 1 quanta per input width {2: 300}.
// Firefox 159 and Safari 18.6 hand over one channel (Firefox does not report the track's channelCount).
const ctx = new AudioContext();
await ctx.resume();
await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
  registerProcessor("count", class extends AudioWorkletProcessor {
    constructor() { super(); this.n = 0; this.seen = {}; }
    process(inputs) {
      this.seen[inputs[0].length] = (this.seen[inputs[0].length] || 0) + 1;
      if (++this.n === 300) this.port.postMessage(this.seen);
      return true;
    }
  });`], { type: "text/javascript" })));
const osc = new OscillatorNode(ctx);
const dest = new MediaStreamAudioDestinationNode(ctx, { channelCount: 1, channelCountMode: "explicit" });
osc.connect(dest);
osc.start();
const source = ctx.createMediaStreamSource(dest.stream);
const counter = new AudioWorkletNode(ctx, "count", { numberOfInputs: 1, numberOfOutputs: 0 });
counter.port.onmessage = (e) => console.log("track channelCount", dest.stream.getAudioTracks()[0].getSettings().channelCount, "quanta per input width", e.data);
source.connect(counter);
