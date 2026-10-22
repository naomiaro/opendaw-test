// The Chromium 560233271 probe's tone (`chromium-watched-issues-debug-demo.html?issue=suspend-resume`),
// loaded from a file because the tracker's reduced case did not reproduce from a Blob URL.
// A 440 Hz sine at 0.5 from the processor's own phase. A message { block: ms } busy-waits that long
// on the worklet thread and answers, as the tracker's repro does before each suspend / resume.
// A message { control: true } starts the positive control named in processorOptions:
// "crackle" flips the sign of three samples per quantum, "harmonic" soft-clips the tone.
class SuspendResumeTone extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.phase = 0;
    this.control = options.processorOptions.control;
    this.active = false;
    this.port.onmessage = ({ data }) => {
      if (data.control === true) this.active = true;
      if (typeof data.block === "number") {
        const deadline = Date.now() + data.block;
        while (Date.now() < deadline) {}
        this.port.postMessage({ blocked: data.block });
      }
    };
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    const step = (2 * Math.PI * 440) / sampleRate;
    const crackle = this.active && this.control === "crackle";
    const harmonic = this.active && this.control === "harmonic";
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0.5 * Math.sin(this.phase);
      this.phase += step;
      if (harmonic) value = (0.5 * Math.tanh(4 * value)) / Math.tanh(2);
      if (crackle && (i === 17 || i === 63 || i === 101)) value = -value;
      for (const channel of channels) channel[i] = value;
    }
    this.phase %= 2 * Math.PI;
    return true;
  }
}
registerProcessor("chromium-suspend-resume-tone", SuspendResumeTone);
