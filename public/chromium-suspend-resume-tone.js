// The Chromium 560233271 probe's tone (`chromium-watched-issues-debug-demo.html?issue=suspend-resume`),
// in the shape of the tracker's repro (github.com/pioug/chromium-audiocontext, processor.js): a
// stateless 440 Hz sine at 0.2 from `currentFrame`, written to every channel, no idle state.
// Loaded from this file because the tracker's reporter found a Blob URL did not reproduce.
// Messages in:
//   { stall: ms }    busy-wait that long on the worklet thread, then answer { type: "stalled" }
//                    (the repro posts 80 before each suspend / resume)
//   { control: true } start the positive control named in processorOptions: "crackle" flips the
//                    sign of three samples per quantum, "harmonic" soft-clips the tone
// Out, every 250 ms of Date.now(): { type: "calls", calls, at }, the process() calls so far.
class SuspendResumeTone extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.control = options.processorOptions.control;
    this.active = false;
    this.calls = 0;
    this.lastReport = Date.now();
    this.port.onmessage = ({ data }) => {
      if (data.control === true) this.active = true;
      if (typeof data.stall === "number") {
        const deadline = Date.now() + data.stall;
        while (Date.now() < deadline) {}
        this.port.postMessage({ type: "stalled" });
      }
    };
  }
  process(_inputs, outputs) {
    this.calls++;
    const now = Date.now();
    if (now - this.lastReport >= 250) {
      this.lastReport = now;
      this.port.postMessage({ type: "calls", calls: this.calls, at: now });
    }
    const output = outputs[0];
    const crackle = this.active && this.control === "crackle";
    const harmonic = this.active && this.control === "harmonic";
    for (let frame = 0; frame < output[0].length; frame++) {
      let sine = Math.sin((2 * Math.PI * 440 * (currentFrame + frame)) / sampleRate);
      if (harmonic) sine = Math.tanh(2 * sine) / Math.tanh(2);
      if (crackle && (frame === 17 || frame === 63 || frame === 101)) sine = -sine;
      for (const channel of output) channel[frame] = sine * 0.2;
    }
    return true;
  }
}
registerProcessor("chromium-suspend-resume-tone", SuspendResumeTone);
