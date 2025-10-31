import { useState, useCallback } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectType } from "../components/EffectChain";

interface EffectInstanceData {
  id: string;
  type: EffectType;
  label: string;
  effectRef: any;
  isBypassed: boolean;
  parameters: any;
}

export const useEffectChain = (project: Project | null, audioBox: any, trackName: string) => {
  const [effects, setEffects] = useState<EffectInstanceData[]>([]);

  const addEffect = useCallback(
    (type: EffectType) => {
      if (!project || !audioBox) return;

      const effectId = `${trackName}-${type}-${Date.now()}`;
      const label = `${trackName} ${type}`;

      project.editing.modify(() => {
        let effectBox;

        switch (type) {
          case "Reverb":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.Reverb);
            effectBox.label.setValue(label);
            (effectBox as any).wet.setValue(-18);
            (effectBox as any).decay.setValue(0.5);
            (effectBox as any).preDelay.setValue(0.02);
            (effectBox as any).damp.setValue(0.5);
            break;

          case "Compressor":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.Compressor);
            effectBox.label.setValue(label);
            (effectBox as any).threshold.setValue(-20);
            (effectBox as any).ratio.setValue(3);
            (effectBox as any).attack.setValue(5);
            (effectBox as any).release.setValue(100);
            (effectBox as any).automakeup.setValue(true);
            (effectBox as any).knee.setValue(6);
            break;

          case "Delay":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.Delay);
            effectBox.label.setValue(label);
            (effectBox as any).wet.setValue(-12);
            (effectBox as any).feedback.setValue(0.4);
            (effectBox as any).delay.setValue(4);
            (effectBox as any).filter.setValue(0);
            break;

          case "Crusher":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.Crusher);
            effectBox.label.setValue(label);
            (effectBox as any).bits.setValue(8);
            (effectBox as any).crush.setValue(0.5);
            (effectBox as any).boost.setValue(0.5);
            (effectBox as any).mix.setValue(0.8);
            break;

          case "StereoWidth":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.StereoTool);
            effectBox.label.setValue(label);
            (effectBox as any).stereo.setValue(1.0);
            (effectBox as any).panning.setValue(0);
            break;

          case "EQ":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.Revamp);
            effectBox.label.setValue(label);
            // Enable mid bell by default for quick EQ adjustments
            (effectBox as any).midBell.enabled.setValue(true);
            (effectBox as any).midBell.frequency.setValue(1000);
            (effectBox as any).midBell.gain.setValue(0);
            (effectBox as any).midBell.q.setValue(1.0);
            break;

          case "Fold":
            effectBox = project.api.insertEffect((audioBox as any).audioEffects, EffectFactories.AudioNamed.Fold);
            effectBox.label.setValue(label);
            (effectBox as any).drive.setValue(0);
            (effectBox as any).overSampling.setValue(0);
            (effectBox as any).volume.setValue(0);
            break;

          default:
            return;
        }

        const newEffect: EffectInstanceData = {
          id: effectId,
          type,
          label,
          effectRef: effectBox,
          isBypassed: false,
          parameters: {} // Will be populated per effect type
        };

        setEffects(prev => [...prev, newEffect]);
        console.log(`Added ${type} effect to ${trackName}`);
      });
    },
    [project, audioBox, trackName]
  );

  const removeEffect = useCallback(
    (effectId: string) => {
      if (!project) return;

      const effect = effects.find(e => e.id === effectId);
      if (!effect) return;

      project.editing.modify(() => {
        effect.effectRef.delete();
        console.log(`Removed ${effect.type} from ${trackName}`);
      });

      setEffects(prev => prev.filter(e => e.id !== effectId));
    },
    [project, effects, trackName]
  );

  const toggleBypass = useCallback(
    (effectId: string) => {
      if (!project) return;

      const effect = effects.find(e => e.id === effectId);
      if (!effect) return;

      project.editing.modify(() => {
        const currentValue = effect.effectRef.enabled.getValue();
        effect.effectRef.enabled.setValue(!currentValue);
      });

      setEffects(prev => prev.map(e => (e.id === effectId ? { ...e, isBypassed: !e.isBypassed } : e)));
    },
    [project, effects]
  );

  return {
    effects,
    addEffect,
    removeEffect,
    toggleBypass
  };
};
