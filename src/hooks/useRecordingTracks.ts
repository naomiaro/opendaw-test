import { useState, useCallback } from "react";
import { UUID } from "@opendaw/lib-std";
import { Project, CaptureAudio } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { RecordingTrack } from "@/components/RecordingTrackCard";

interface UseRecordingTracksOptions {
  project: Project | null;
  audioInputDevices: readonly MediaDeviceInfo[];
  maxTracks?: number;
}

export interface RecordingTracksResult {
  recordingTracks: RecordingTrack[];
  armedCount: number;
  addTrack: () => void;
  removeTrack: (id: string) => void;
  handleArmedChange: () => void;
}

/**
 * Manages recording track creation, removal, and armed state tracking.
 * Creates Tape instruments with capture devices configured for the first
 * available input device, armed non-exclusively.
 */
export function useRecordingTracks({
  project,
  audioInputDevices,
  maxTracks,
}: UseRecordingTracksOptions): RecordingTracksResult {
  const [recordingTracks, setRecordingTracks] = useState<RecordingTrack[]>([]);
  const [armedCount, setArmedCount] = useState(0);

  const addTrack = useCallback(() => {
    if (!project) return;
    if (maxTracks !== undefined && recordingTracks.length >= maxTracks) return;

    let audioUnitBoxRef: AudioUnitBox | null = null;

    project.editing.modify(() => {
      const { audioUnitBox } = project.api.createInstrument(InstrumentFactories.Tape);
      audioUnitBoxRef = audioUnitBox;

      if (audioInputDevices.length > 0) {
        const captureOpt = project.captureDevices.get(audioUnitBox.address.uuid);
        if (!captureOpt.isEmpty()) {
          const cap = captureOpt.unwrap();
          if (cap instanceof CaptureAudio) {
            cap.captureBox.deviceId.setValue(audioInputDevices[0].deviceId);
            cap.requestChannels = 1;
          }
        }
      }
    });

    if (!audioUnitBoxRef) return;

    const captureOpt = project.captureDevices.get(
      (audioUnitBoxRef as AudioUnitBox).address.uuid
    );
    if (captureOpt.isEmpty()) return;
    const capture = captureOpt.unwrap();
    if (!(capture instanceof CaptureAudio)) return;

    project.captureDevices.setArm(capture, false);

    setRecordingTracks((prev) => [
      ...prev,
      {
        id: UUID.toString((audioUnitBoxRef as AudioUnitBox).address.uuid),
        capture,
      },
    ]);
  }, [project, audioInputDevices, recordingTracks.length, maxTracks]);

  const removeTrack = useCallback((id: string) => {
    setRecordingTracks((prev) => {
      const track = prev.find((t) => t.id === id);
      if (track) {
        track.capture.armed.setValue(false);
      }
      const next = prev.filter((t) => t.id !== id);
      setArmedCount(next.filter((t) => t.capture.armed.getValue()).length);
      return next;
    });
  }, []);

  const handleArmedChange = useCallback(() => {
    setArmedCount(
      recordingTracks.filter((t) => t.capture.armed.getValue()).length
    );
  }, [recordingTracks]);

  return {
    recordingTracks,
    armedCount,
    addTrack,
    removeTrack,
    handleArmedChange,
  };
}
