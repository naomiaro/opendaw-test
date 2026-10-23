// The Chromium 40103985 probe's render-thread stall (`chromium-watched-issues-debug-demo.html
// ?issue=capture-gaps&stallMs=<ms>`): a node with no audio of its own whose message handler holds
// the render thread, as the suspend/resume probe's tone does before each cycle.
// Message in: { stall: ms }, busy-wait that long on the worklet thread.
// Out: { type: "stalled", frame }, `currentFrame` when the stall began (it does not move during it).
class CaptureStall extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (typeof data.stall !== "number") return;
      const frame = currentFrame;
      const deadline = Date.now() + data.stall;
      while (Date.now() < deadline) {}
      this.port.postMessage({ type: "stalled", frame });
    };
  }
  process() {
    return true;
  }
}
registerProcessor("chromium-capture-stall", CaptureStall);
