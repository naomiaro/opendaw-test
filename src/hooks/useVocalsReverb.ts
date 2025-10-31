import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { TrackData } from "../components/TrackRow";
import type { EffectParameter } from "../components/EffectPanel";

export const useVocalsReverb = (project: Project | null, tracks: TrackData[]) => {
  const [isActive, setIsActive] = useState(false);
  const [wet, setWet] = useState(-6.0);
  const [decay, setDecay] = useState(0.6);
  const [preDelay, setPreDelay] = useState(0.02);
  const [damp, setDamp] = useState(0.7);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || isActive) return;

    const vocalsTrack = tracks.find(t => t.name === "Vocals");
    if (!vocalsTrack) return;

    project.editing.modify(() => {
      const reverb = project.api.insertEffect(
        vocalsTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Reverb
      );

      reverb.label.setValue("Vocal Reverb");
      (reverb as any).wet.setValue(wet);
      (reverb as any).decay.setValue(decay);
      (reverb as any).preDelay.setValue(preDelay);
      (reverb as any).damp.setValue(damp);

      effectRef.current = reverb;

      (reverb as any).wet.catchupAndSubscribe((obs: any) => setWet(obs.getValue()));
      (reverb as any).decay.catchupAndSubscribe((obs: any) => setDecay(obs.getValue()));
      (reverb as any).preDelay.catchupAndSubscribe((obs: any) => setPreDelay(obs.getValue()));
      (reverb as any).damp.catchupAndSubscribe((obs: any) => setDamp(obs.getValue()));

      console.log("Added reverb to Vocals track");
    });

    setIsActive(true);
  }, [project, tracks, isActive, wet, decay, preDelay, damp]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log("Removed reverb from Vocals track");
    });

    setIsActive(false);
  }, [project, isActive]);

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

  return {
    isActive,
    parameters,
    handleToggle: isActive ? handleRemove : handleAdd,
    handleParameterChange
  };
};
