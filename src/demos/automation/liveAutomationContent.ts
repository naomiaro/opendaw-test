import { UUID } from "@opendaw/lib-std";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, DelayDeviceBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { DelayDeviceBoxAdapter, InstrumentFactories, type AutomatableParameterFieldAdapter } from "@opendaw/studio-adapters";
import { EffectFactories, type Project } from "@opendaw/studio-core";
import { audioEffectsFieldOf, audioUnitAdapterFor } from "@/lib/adapterUtils";
import { loadAudioFile } from "@/lib/audioUtils";
import { CANVAS_COLORS } from "@/lib/design/consoleTheme";
import { LOOP_PPQN, WINDOW_PPQN } from "./laneRenderModel";

const DRUM_FILE = "/audio/BassDrums30.mp3";

export type LaneId = "volume" | "pan" | "wet";
export type LaneSpec = { id: LaneId; label: string; color: string; adapter: AutomatableParameterFieldAdapter<number> };
export type LiveAutomationSetup = {
  audioUnitBox: AudioUnitBox;
  delayBox: DelayDeviceBox;
  lanes: ReadonlyArray<LaneSpec>;
};

export async function buildLiveAutomationContent(
  project: Project,
  audioContext: AudioContext,
  audioBuffers: Map<string, AudioBuffer>,
  onStatus?: (status: string) => void,
): Promise<LiveAutomationSetup> {
  const { boxGraph } = project;

  onStatus?.("Loading drum loop...");
  const drumBuffer = await loadAudioFile(audioContext, DRUM_FILE);
  const drumUUID = UUID.generate();
  audioBuffers.set(UUID.toString(drumUUID), drumBuffer);

  onStatus?.("Building project...");
  // Transaction 1: instrument + region. −6 dB headroom (Delay wet sums on top).
  let audioUnitBox: AudioUnitBox | null = null;
  project.editing.modify(() => {
    const tape = project.api.createInstrument(InstrumentFactories.Tape);
    audioUnitBox = tape.audioUnitBox;
    tape.audioUnitBox.volume.setValue(-6);
    const fileBox = AudioFileBox.create(boxGraph, drumUUID, box => {
      box.fileName.setValue("BassDrums30");
      box.endInSeconds.setValue(drumBuffer.duration);
    });
    const eventsBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());
    // The arrangement window is 8 bars, but the drum loop is only 4 bars long.
    // Span the region across the whole window (duration = WINDOW_PPQN) while
    // keeping loopDuration at the 4-bar loop — the SDK region-loops the audio
    // content internally, repeating the drum loop twice over the full 8 bars.
    // This is independent of the transport Loop switch (timelineBox.loopArea,
    // set up below), which only controls whether the transport itself wraps
    // after the first 4 bars.
    AudioRegionBox.create(boxGraph, UUID.generate(), box => {
      box.regions.refer(tape.trackBox.regions);
      box.file.refer(fileBox);
      box.events.refer(eventsBox.owners);
      box.position.setValue(0);
      box.duration.setValue(WINDOW_PPQN);
      box.loopOffset.setValue(0);
      box.loopDuration.setValue(LOOP_PPQN);
      box.label.setValue("Drums");
    });
  });
  const unitBox = audioUnitBox!;

  // Transaction 2: insert the Delay (field resolved OUTSIDE, after tx 1 committed).
  const effectsField = audioEffectsFieldOf(project, unitBox);
  let delayBox: DelayDeviceBox | null = null;
  project.editing.modify(() => {
    delayBox = project.api.insertEffect(effectsField, EffectFactories.Delay) as DelayDeviceBox;
  });

  // The LoopArea schema defaults to enabled=true, from=0, to=15360 — so a fresh
  // project already loops over the first four bars. The page's Loop switch starts
  // OFF, so without this the switch would lie and every first take would be split
  // at an invisible wrap. Pin the range to this page's loop and start it disabled.
  project.editing.modify(() => {
    const { loopArea } = project.timelineBox;
    loopArea.from.setValue(0);
    loopArea.to.setValue(LOOP_PPQN);
    loopArea.enabled.setValue(false);
  });

  // Subject of the demo — explicit even though it defaults to true.
  project.engine.preferences.settings.recording.automationEnabled = true;

  // Adapters resolved AFTER commits (same-transaction traversal is stale).
  const unitAdapter = audioUnitAdapterFor(project, unitBox);
  const delayAdapter = project.boxAdapters.adapterFor(delayBox!, DelayDeviceBoxAdapter);
  const lanes: LaneSpec[] = [
    { id: "volume", label: "Volume", color: CANVAS_COLORS.amber, adapter: unitAdapter.namedParameter.volume },
    { id: "pan", label: "Pan", color: CANVAS_COLORS.cyan, adapter: unitAdapter.namedParameter.panning },
    { id: "wet", label: "Delay Wet", color: CANVAS_COLORS.green, adapter: delayAdapter.namedParameter.wet },
  ];
  return { audioUnitBox: unitBox, delayBox: delayBox!, lanes };
}
