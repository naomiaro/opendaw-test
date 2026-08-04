// Boot for the jam-arrangement demo: 4 Tape tracks from Dark Ride stems, each
// with 3 launcher clips (1/2/4-bar loops of the stem's opening bars). No
// timeline regions are created here — the arrangement is built by Commit.
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import {
  AudioClipBox,
  AudioFileBox,
  AudioUnitBox,
  TrackBox,
  ValueEventCollectionBox,
} from "@opendaw/studio-boxes";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import { getAudioExtension, loadAudioFile } from "@/lib/audioUtils";
import { findContentStart } from "./waveform";

export const CLIP_COLUMNS = [1, 2, 4] as const;

export type JamClip = {
  box: AudioClipBox;
  uuidString: string;
  bars: (typeof CLIP_COLUMNS)[number];
};

export type JamTrack = {
  name: string;
  color: string; // canvas literal mirroring an --mc-* token
  trackBox: TrackBox;
  audioUnitBox: AudioUnitBox;
  fileBox: AudioFileBox;
  audioBuffer: AudioBuffer;
  contentStartSeconds: number; // skips the stem's silent lead-in — see findContentStart
  clips: JamClip[];
};

// Canvas 2D can't read CSS vars — literals mirror consoleTheme tokens.
const STEMS: ReadonlyArray<{ name: string; file: string; color: string }> = [
  { name: "Drums", file: "02_Drums", color: "#e8a33d" },   // --mc-amber
  { name: "Bass", file: "03_Bass", color: "#5fb4c9" },     // --mc-cyan
  { name: "Guitars", file: "04_ElecGtrs", color: "#7fbf6a" }, // --mc-green
  { name: "Vox", file: "06_Vox", color: "#df8a76" },       // --mc-rose
];

export async function createJamSession(
  project: Project,
  audioContext: AudioContext,
  localAudioBuffers: Map<string, AudioBuffer>,
): Promise<JamTrack[]> {
  const ext = getAudioExtension();
  const boxGraph = project.boxGraph;
  const tracks: JamTrack[] = [];
  const committedFileUUIDs: string[] = [];

  try {
    for (const stem of STEMS) {
      const audioBuffer = await loadAudioFile(
        audioContext,
        `/audio/DarkRide/${stem.file}.${ext}`,
      );
      const fileUUID = UUID.generate();
      const fileUUIDString = UUID.toString(fileUUID);
      localAudioBuffers.set(fileUUIDString, audioBuffer);
      // Recorded before the modify below (not after) so a throw inside it still
      // leaves this stem's uuid in the rollback list — otherwise the buffer set
      // above leaks: it's in localAudioBuffers but the catch below only cleans
      // uuids that made it into committedFileUUIDs.
      committedFileUUIDs.push(fileUUIDString);
      // Raw Cambridge-MT stems share a session start well before the first note —
      // skip it so launcher clips loop actual content, not studio silence.
      const contentStartSeconds = findContentStart(audioBuffer);

      project.editing.modify(() => {
        const { audioUnitBox, trackBox } = project.api.createInstrument(
          InstrumentFactories.Tape,
        );
        audioUnitBox.volume.setValue(0);

        const fileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
          box.fileName.setValue(stem.name);
          box.endInSeconds.setValue(audioBuffer.duration);
        });

        const clips: JamClip[] = CLIP_COLUMNS.map((bars, column) => {
          const eventsBox = ValueEventCollectionBox.create(boxGraph, UUID.generate());
          const clipUUID = UUID.generate();
          const box = AudioClipBox.create(boxGraph, clipUUID, clip => {
            clip.clips.refer(trackBox.clips);
            clip.file.refer(fileBox);
            clip.events.refer(eventsBox.owners);
            clip.duration.setValue(bars * PPQN.Bar);
            clip.index.setValue(column);
            clip.label.setValue(`${stem.name} ${bars} bar${bars > 1 ? "s" : ""}`);
            clip.waveformOffset.setValue(contentStartSeconds);
          });
          return { box, uuidString: UUID.toString(clipUUID), bars };
        });

        tracks.push({
          name: stem.name,
          color: stem.color,
          trackBox,
          audioUnitBox,
          fileBox,
          audioBuffer,
          contentStartSeconds,
          clips,
        });
      });
    }

    // Arrangement playback must run linearly — kill the default timeline loop.
    // Inside the try: a failure here still needs the rollback below, same as
    // a per-stem load/modify failure above.
    project.editing.modify(() => {
      project.timelineBox.loopArea.enabled.setValue(false);
    });
    await project.engine.queryLoadingComplete();
  } catch (error) {
    // Each stem above is its own committed transaction — a load failure on a
    // later stem must not leave earlier stems' boxes dangling with no
    // caller-visible handle (the rejected promise gives the caller nothing to
    // clean up). Roll back everything built so far in a fresh transaction,
    // separate from the creation transactions above. audioUnitBox.delete()
    // cascades through its mandatory dependents — TrackBox (mandatory
    // "tracks" pointer), the Tape instrument box (mandatory "host" pointer),
    // every AudioClipBox (mandatory "clips" pointer into trackBox.clips),
    // each clip's private ValueEventCollectionBox (mandatory "events"
    // pointer) — and once the last referencing clip is swept, the shared
    // AudioFileBox too (AudioFileBox itself declares pointerRules.mandatory).
    if (tracks.length > 0) {
      project.editing.modify(() => {
        tracks.forEach(track => track.audioUnitBox.delete());
      });
    }
    committedFileUUIDs.forEach(uuid => localAudioBuffers.delete(uuid));
    throw error;
  }

  project.engine.setPosition(0);
  return tracks;
}
