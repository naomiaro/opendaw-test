import { useState, useCallback } from "react";
import { AudioDevices } from "@opendaw/studio-core";
import { enumerateOutputDevices } from "@/lib/audioUtils";

export interface AudioDevicePermissionResult {
  audioInputDevices: readonly MediaDeviceInfo[];
  audioOutputDevices: readonly MediaDeviceInfo[];
  hasPermission: boolean;
  /** Requests mic permission and enumerates devices. Throws on permission denial. */
  requestPermission: () => Promise<void>;
}

/**
 * Manages microphone permission and audio device enumeration.
 * Enumerates both input devices (via AudioDevices) and output
 * devices (via enumerateOutputDevices) after permission is granted.
 *
 * Throws on permission denial so callers can handle it (e.g., show an error).
 * Output device enumeration failures are non-fatal — permission is still granted.
 */
export function useAudioDevicePermission(): AudioDevicePermissionResult {
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);

  const requestPermission = useCallback(async () => {
    // Let permission errors propagate to the caller for user-facing feedback
    await AudioDevices.requestPermission();
    await AudioDevices.updateInputList();
    setAudioInputDevices([...AudioDevices.inputs]);
    setHasPermission(true);

    // Output device enumeration is non-fatal — setSinkId is Chrome/Edge only
    try {
      setAudioOutputDevices(await enumerateOutputDevices());
    } catch (e) {
      // Non-fatal — setSinkId is Chrome/Edge only, input devices still work
      console.warn("[AudioDevicePermission] Output device enumeration failed:", e);
    }
  }, []);

  return { audioInputDevices, audioOutputDevices, hasPermission, requestPermission };
}
