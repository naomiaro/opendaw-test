import { useState, useCallback } from "react";
import { Project } from "@opendaw/studio-core";
import type { EffectType } from "../components/EffectChain";

/**
 * UI state for effect instances.
 * The actual audio effect is created/deleted by useDynamicEffect.
 */
interface EffectInstanceData {
  id: string;
  type: EffectType;
  label: string;
  accentColor: string;
}

/**
 * Manages UI state for effects on a track.
 * Actual audio effects are handled by useDynamicEffect on mount/unmount.
 */
export const useEffectChain = (project: Project | null, audioBox: any, trackName: string) => {
  const [effects, setEffects] = useState<EffectInstanceData[]>([]);

  const addEffect = useCallback(
    (type: EffectType) => {
      if (!project || !audioBox) return;

      const accentColors = ["purple", "blue", "cyan", "teal", "green", "orange", "red", "pink", "plum", "amber"];

      setEffects(prev => [
        ...prev,
        {
          id: `${trackName}-${type}-${Date.now()}`,
          type,
          label: `${trackName} ${type}`,
          accentColor: accentColors[Math.floor(Math.random() * accentColors.length)]
        }
      ]);
    },
    [project, audioBox, trackName]
  );

  const removeEffect = useCallback((effectId: string) => {
    setEffects(prev => prev.filter(e => e.id !== effectId));
  }, []);

  return { effects, addEffect, removeEffect };
};
