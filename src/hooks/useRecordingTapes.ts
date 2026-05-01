import { useState, useCallback } from "react";
import { UUID } from "@opendaw/lib-std";
import { Project, CaptureAudio } from "@opendaw/studio-core";
import { InstrumentFactories } from "@opendaw/studio-adapters";
import type { AudioUnitBox } from "@opendaw/studio-boxes";
import type { RecordingTape } from "@/components/RecordingTapeCard";

interface UseRecordingTapesOptions {
  project: Project | null;
  audioInputDevices: readonly MediaDeviceInfo[];
  maxTapes?: number;
}

export interface RecordingTapesResult {
  recordingTapes: RecordingTape[];
  armedCount: number;
  addTape: () => void;
  removeTape: (id: string) => void;
  handleArmedChange: (id: string, armed: boolean) => void;
}

/**
 * Manages recording tape creation, removal, and armed state tracking.
 * Creates Tape instruments with capture devices configured for the first
 * available input device, armed non-exclusively.
 */
export function useRecordingTapes({
  project,
  audioInputDevices,
  maxTapes,
}: UseRecordingTapesOptions): RecordingTapesResult {
  const [recordingTapes, setRecordingTapes] = useState<RecordingTape[]>([]);
  const [armedCount, setArmedCount] = useState(0);

  const addTape = useCallback(() => {
    if (!project) return;
    if (maxTapes !== undefined && recordingTapes.length >= maxTapes) return;

    // Create instrument in its own transaction (pointer re-routing guideline:
    // captureDevices.get() must be in a separate transaction after createInstrument commits)
    let audioUnitBoxRef: AudioUnitBox | null = null;
    project.editing.modify(() => {
      const { audioUnitBox } = project.api.createInstrument(InstrumentFactories.Tape);
      audioUnitBoxRef = audioUnitBox;
    });

    if (!audioUnitBoxRef) {
      console.error("[useRecordingTapes] createInstrument did not return audioUnitBox");
      return;
    }

    // Resolve capture after creation transaction commits
    const captureOpt = project.captureDevices.get(
      (audioUnitBoxRef as AudioUnitBox).address.uuid
    );
    if (captureOpt.isEmpty()) {
      console.error("[useRecordingTapes] No capture device found for new instrument");
      return;
    }
    const capture = captureOpt.unwrap();
    if (!(capture instanceof CaptureAudio)) {
      console.error("[useRecordingTapes] Capture device is not CaptureAudio");
      return;
    }

    // Configure capture in a separate transaction
    if (audioInputDevices.length > 0) {
      project.editing.modify(() => {
        capture.captureBox.deviceId.setValue(audioInputDevices[0].deviceId);
        capture.requestChannels = 1;
      });
    }

    project.captureDevices.setArm(capture, false);

    setRecordingTapes((prev) => [
      ...prev,
      {
        id: UUID.toString((audioUnitBoxRef as AudioUnitBox).address.uuid),
        capture,
      },
    ]);
  }, [project, audioInputDevices, recordingTapes.length, maxTapes]);

  const removeTape = useCallback((id: string) => {
    setRecordingTapes((prev) => {
      const tape = prev.find((t) => t.id === id);
      if (tape) {
        tape.capture.armed.setValue(false);
      }
      const next = prev.filter((t) => t.id !== id);
      setArmedCount(next.filter((t) => t.capture.armed.getValue()).length);
      return next;
    });
  }, []);

  const handleArmedChange = useCallback((_id: string, armed: boolean) => {
    setArmedCount((prev) => prev + (armed ? 1 : -1));
  }, []);

  return {
    recordingTapes,
    armedCount,
    addTape,
    removeTape,
    handleArmedChange,
  };
}
