import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

interface ReverbParams {
  wet: number;
  decay: number;
  preDelay: number;
  damp: number;
}

export const useReverb = (
  project: Project | null,
  audioBox: any,
  defaultParams: ReverbParams,
  label: string
) => {
  const [isActive, setIsActive] = useState(false);
  const [wet, setWet] = useState(defaultParams.wet);
  const [decay, setDecay] = useState(defaultParams.decay);
  const [preDelay, setPreDelay] = useState(defaultParams.preDelay);
  const [damp, setDamp] = useState(defaultParams.damp);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || !audioBox || isActive) return;

    project.editing.modify(() => {
      const reverb = project.api.insertEffect(
        (audioBox as any).audioEffects,
        EffectFactories.AudioNamed.Reverb
      );

      reverb.label.setValue(label);
      (reverb as any).wet.setValue(wet);
      (reverb as any).decay.setValue(decay);
      (reverb as any).preDelay.setValue(preDelay);
      (reverb as any).damp.setValue(damp);

      effectRef.current = reverb;

      (reverb as any).wet.catchupAndSubscribe((obs: any) => setWet(obs.getValue()));
      (reverb as any).decay.catchupAndSubscribe((obs: any) => setDecay(obs.getValue()));
      (reverb as any).preDelay.catchupAndSubscribe((obs: any) => setPreDelay(obs.getValue()));
      (reverb as any).damp.catchupAndSubscribe((obs: any) => setDamp(obs.getValue()));

      console.log(`Added reverb: ${label}`);
    });

    setIsActive(true);
  }, [project, audioBox, isActive, wet, decay, preDelay, damp, label]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log(`Removed reverb: ${label}`);
    });

    setIsActive(false);
  }, [project, isActive, label]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const reverb = effectRef.current;
      switch (paramName) {
        case 'wet':
          (reverb as any).wet.setValue(value);
          break;
        case 'decay':
          (reverb as any).decay.setValue(value);
          break;
        case 'preDelay':
          (reverb as any).preDelay.setValue(value);
          break;
        case 'damp':
          (reverb as any).damp.setValue(value);
          break;
      }
    });
  }, [project]);

  const parameters: EffectParameter[] = [
    {
      name: 'wet',
      label: 'Wet/Dry Mix',
      value: wet,
      min: -60,
      max: 0,
      step: 0.1,
      unit: ' dB'
    },
    {
      name: 'decay',
      label: 'Decay Time',
      value: decay,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${(v * 100).toFixed(0)}%`
    },
    {
      name: 'preDelay',
      label: 'Pre-Delay',
      value: preDelay,
      min: 0,
      max: 0.1,
      step: 0.001,
      format: (v) => `${(v * 1000).toFixed(0)} ms`
    },
    {
      name: 'damp',
      label: 'Damping',
      value: damp,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${(v * 100).toFixed(0)}%`
    }
  ];

  const loadPreset = useCallback((params: ReverbParams) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const reverb = effectRef.current;
      (reverb as any).wet.setValue(params.wet);
      (reverb as any).decay.setValue(params.decay);
      (reverb as any).preDelay.setValue(params.preDelay);
      (reverb as any).damp.setValue(params.damp);
    });
  }, [project]);

  return {
    isActive,
    parameters,
    handleToggle: isActive ? handleRemove : handleAdd,
    handleParameterChange,
    loadPreset
  };
};
