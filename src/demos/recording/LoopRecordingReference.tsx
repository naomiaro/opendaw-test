import React from "react";
import { Code, Text } from "@radix-ui/themes";

const codeStyle = {
  display: "block" as const,
  whiteSpace: "pre" as const,
  padding: 12,
  overflowX: "auto" as const,
  background: "var(--mc-bg)",
  border: "1px solid var(--mc-line)",
  borderRadius: 4,
  marginTop: 8,
};

/** Static SDK-reference section for the loop-recording demo. */
export const LoopRecordingReference: React.FC = () => (
  <section className="mc-anchors">
    <h2 className="mc-anchors-head">SDK reference</h2>

    <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
      Pre-Loop Lead-In Recording:
    </Text>
    <Code size="2" style={codeStyle}>
      {`// Set loop area with lead-in
const barPPQN = PPQN.Quarter * 4;
const loopFrom = leadInBars * barPPQN;
const loopTo = loopFrom + loopLengthBars * barPPQN;

project.editing.modify(() => {
  project.timelineBox.loopArea.from.setValue(loopFrom);
  project.timelineBox.loopArea.to.setValue(loopTo);
  project.timelineBox.loopArea.enabled.setValue(true);
});

// Start at position 0 — Take 1 includes lead-in
project.engine.setPosition(0);
project.startRecording(useCountIn);`}
    </Code>

    <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
      Multi-Track Loop Recording:
    </Text>
    <Code size="2" style={codeStyle}>
      {`// Create and arm multiple tracks
const { audioUnitBox } = project.api
  .createInstrument(InstrumentFactories.Tape);
const capture = project.captureDevices
  .get(audioUnitBox.address.uuid).unwrap();

// Arm deterministically — captureDevices.setArm() is a
// TOGGLE (its second param is exclusivity, not the value)
capture.armed.setValue(true);

// startRecording() records ALL armed captures
project.startRecording(useCountIn);

// Multi-track finalization barrier — count BOTH terminal
// states ("loaded" and "error") or the barrier can hang
const loaders = new Set<SampleLoader>();
// ... collect loaders from take regions ...
let finalized = 0;
for (const loader of loaders) {
  loader.subscribe(state => {
    if (state.type === "loaded" || state.type === "error") {
      if (++finalized === loaders.size) {
        project.engine.stop(true);
      }
    }
  });
}`}
    </Code>

    <Text size="2" weight="bold" style={{ display: "block", marginTop: 16 }}>
      Takes Preferences:
    </Text>
    <Code size="2" style={codeStyle}>
      {`const settings = project.engine.preferences.settings;
settings.recording.allowTakes = true;
settings.recording.olderTakeAction = "mute-region";
settings.recording.olderTakeScope = "previous-only";`}
    </Code>
  </section>
);
