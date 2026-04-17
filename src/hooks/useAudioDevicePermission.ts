import { useState, useCallback } from "react";
import { AudioDevices } from "@opendaw/studio-core";
import { enumerateOutputDevices } from "@/lib/audioUtils";

export interface AudioDevicePermissionResult {
  audioInputDevices: readonly MediaDeviceInfo[];
  audioOutputDevices: readonly MediaDeviceInfo[];
  hasPermission: boolean;
  requestPermission: () => Promise<void>;
}

/**
 * Manages microphone permission and audio device enumeration.
 * Enumerates both input devices (via AudioDevices) and output
 * devices (via enumerateOutputDevices) after permission is granted.
 */
export function useAudioDevicePermission(): AudioDevicePermissionResult {
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState(false);

  const requestPermission = useCallback(async () => {
    await AudioDevices.requestPermission();
    await AudioDevices.updateInputList();
    setAudioInputDevices([...AudioDevices.inputs]);
    setAudioOutputDevices(await enumerateOutputDevices());
    setHasPermission(true);
  }, []);

  return { audioInputDevices, audioOutputDevices, hasPermission, requestPermission };
}
