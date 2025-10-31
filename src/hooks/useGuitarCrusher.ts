import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { TrackData } from "../components/TrackRow";
import type { EffectParameter } from "../components/EffectPanel";

export const useGuitarCrusher = (project: Project | null, tracks: TrackData[]) => {
  const [isActive, setIsActive] = useState(false);
  const [bits, setBits] = useState(4);
  const [crush, setCrush] = useState(0.95);
  const [boost, setBoost] = useState(0.6);
  const [mix, setMix] = useState(0.8);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || isActive) return;

    const guitarTrack = tracks.find(t => t.name === "Guitar");
    if (!guitarTrack) return;

    project.editing.modify(() => {
      const crusher = project.api.insertEffect(
        guitarTrack.audioUnitBox.audioEffects,
        EffectFactories.AudioNamed.Crusher
      );

      crusher.label.setValue("Guitar Lo-Fi");
      (crusher as any).bits.setValue(bits);
      (crusher as any).crush.setValue(crush);
      (crusher as any).boost.setValue(boost);
      (crusher as any).mix.setValue(mix);

      effectRef.current = crusher;

      (crusher as any).bits.catchupAndSubscribe((obs: any) => setBits(obs.getValue()));
      (crusher as any).crush.catchupAndSubscribe((obs: any) => setCrush(obs.getValue()));
      (crusher as any).boost.catchupAndSubscribe((obs: any) => setBoost(obs.getValue()));
      (crusher as any).mix.catchupAndSubscribe((obs: any) => setMix(obs.getValue()));

      console.log("Added lo-fi crusher to Guitar track");
    });

    setIsActive(true);
  }, [project, tracks, isActive, bits, crush, boost, mix]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log("Removed lo-fi crusher from Guitar track");
    });

    setIsActive(false);
  }, [project, isActive]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const crusher = effectRef.current;
      switch (paramName) {
        case 'bits':
          (crusher as any).bits.setValue(value);
          break;
        case 'crush':
          (crusher as any).crush.setValue(value);
          break;
        case 'boost':
          (crusher as any).boost.setValue(value);
          break;
        case 'mix':
          (crusher as any).mix.setValue(value);
          break;
      }
    });
  }, [project]);

  const parameters: EffectParameter[] = [
    {
      name: 'bits',
      label: 'Bit Depth',
      value: bits,
      min: 1,
      max: 16,
      step: 1,
      format: (v) => `${v.toFixed(0)} bits`
    },
    {
      name: 'crush',
      label: 'Crush Amount',
      value: crush,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${(v * 100).toFixed(0)}%`
    },
    {
      name: 'boost',
      label: 'Boost',
      value: boost,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${(v * 100).toFixed(0)}%`
    },
    {
      name: 'mix',
      label: 'Wet/Dry Mix',
      value: mix,
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
