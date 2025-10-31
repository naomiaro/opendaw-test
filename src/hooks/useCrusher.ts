import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

interface CrusherParams {
  bits: number;
  crush: number;
  boost: number;
  mix: number;
}

export const useCrusher = (
  project: Project | null,
  audioBox: any,
  defaultParams: CrusherParams,
  label: string
) => {
  const [isActive, setIsActive] = useState(false);
  const [isBypassed, setIsBypassed] = useState(false);
  const [bits, setBits] = useState(defaultParams.bits);
  const [crush, setCrush] = useState(defaultParams.crush);
  const [boost, setBoost] = useState(defaultParams.boost);
  const [mix, setMix] = useState(defaultParams.mix);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || !audioBox || isActive) return;

    project.editing.modify(() => {
      const crusher = project.api.insertEffect(
        (audioBox as any).audioEffects,
        EffectFactories.AudioNamed.Crusher
      );

      crusher.label.setValue(label);
      (crusher as any).bits.setValue(bits);
      (crusher as any).crush.setValue(crush);
      (crusher as any).boost.setValue(boost);
      (crusher as any).mix.setValue(mix);

      effectRef.current = crusher;

      (crusher as any).bits.catchupAndSubscribe((obs: any) => setBits(obs.getValue()));
      (crusher as any).crush.catchupAndSubscribe((obs: any) => setCrush(obs.getValue()));
      (crusher as any).boost.catchupAndSubscribe((obs: any) => setBoost(obs.getValue()));
      (crusher as any).mix.catchupAndSubscribe((obs: any) => setMix(obs.getValue()));
      crusher.enabled.catchupAndSubscribe((obs: any) => setIsBypassed(!obs.getValue()));

      console.log(`Added crusher: ${label}`);
    });

    setIsActive(true);
  }, [project, audioBox, isActive, bits, crush, boost, mix, label]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log(`Removed crusher: ${label}`);
    });

    setIsActive(false);
  }, [project, isActive, label]);

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

  const loadPreset = useCallback((params: CrusherParams) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const crusher = effectRef.current;
      (crusher as any).bits.setValue(params.bits);
      (crusher as any).crush.setValue(params.crush);
      (crusher as any).boost.setValue(params.boost);
      (crusher as any).mix.setValue(params.mix);
    });
  }, [project]);

  const handleBypass = useCallback(() => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const crusher = effectRef.current;
      crusher.enabled.setValue(!crusher.enabled.getValue());
    });
  }, [project]);

  return {
    isActive,
    isBypassed,
    parameters,
    handleToggle: isActive ? handleRemove : handleAdd,
    handleParameterChange,
    handleBypass,
    loadPreset
  };
};
