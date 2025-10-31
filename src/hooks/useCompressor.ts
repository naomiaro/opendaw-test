import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

interface CompressorParams {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}

export const useCompressor = (
  project: Project | null,
  audioBox: any,
  defaultParams: CompressorParams,
  label: string,
  insertAtIndex?: number
) => {
  const [isActive, setIsActive] = useState(false);
  const [isBypassed, setIsBypassed] = useState(false);
  const [threshold, setThreshold] = useState(defaultParams.threshold);
  const [ratio, setRatio] = useState(defaultParams.ratio);
  const [attack, setAttack] = useState(defaultParams.attack);
  const [release, setRelease] = useState(defaultParams.release);
  const [knee, setKnee] = useState(defaultParams.knee);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || !audioBox || isActive) return;

    project.editing.modify(() => {
      const compressor = project.api.insertEffect(
        (audioBox as any).audioEffects,
        EffectFactories.AudioNamed.Compressor,
        insertAtIndex
      );

      compressor.label.setValue(label);
      (compressor as any).threshold.setValue(threshold);
      (compressor as any).ratio.setValue(ratio);
      (compressor as any).attack.setValue(attack);
      (compressor as any).release.setValue(release);
      (compressor as any).automakeup.setValue(true);
      (compressor as any).knee.setValue(knee);

      effectRef.current = compressor;

      (compressor as any).threshold.catchupAndSubscribe((obs: any) => setThreshold(obs.getValue()));
      (compressor as any).ratio.catchupAndSubscribe((obs: any) => setRatio(obs.getValue()));
      (compressor as any).attack.catchupAndSubscribe((obs: any) => setAttack(obs.getValue()));
      (compressor as any).release.catchupAndSubscribe((obs: any) => setRelease(obs.getValue()));
      (compressor as any).knee.catchupAndSubscribe((obs: any) => setKnee(obs.getValue()));
      compressor.enabled.catchupAndSubscribe((obs: any) => setIsBypassed(!obs.getValue()));

      console.log(`Added compressor: ${label}`);
    });

    setIsActive(true);
  }, [project, audioBox, isActive, threshold, ratio, attack, release, knee, label, insertAtIndex]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log(`Removed compressor: ${label}`);
    });

    setIsActive(false);
  }, [project, isActive, label]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const comp = effectRef.current;
      switch (paramName) {
        case 'threshold':
          (comp as any).threshold.setValue(value);
          break;
        case 'ratio':
          (comp as any).ratio.setValue(value);
          break;
        case 'attack':
          (comp as any).attack.setValue(value);
          break;
        case 'release':
          (comp as any).release.setValue(value);
          break;
        case 'knee':
          (comp as any).knee.setValue(value);
          break;
      }
    });
  }, [project]);

  const parameters: EffectParameter[] = [
    {
      name: 'threshold',
      label: 'Threshold',
      value: threshold,
      min: -60,
      max: 0,
      step: 0.5,
      unit: ' dB'
    },
    {
      name: 'ratio',
      label: 'Ratio',
      value: ratio,
      min: 1,
      max: 20,
      step: 0.1,
      format: (v) => `${v.toFixed(1)}:1`
    },
    {
      name: 'attack',
      label: 'Attack',
      value: attack,
      min: 0.1,
      max: 100,
      step: 0.1,
      unit: ' ms'
    },
    {
      name: 'release',
      label: 'Release',
      value: release,
      min: 10,
      max: 1000,
      step: 10,
      unit: ' ms'
    },
    {
      name: 'knee',
      label: 'Knee',
      value: knee,
      min: 0,
      max: 12,
      step: 0.5,
      unit: ' dB'
    }
  ];

  const loadPreset = useCallback((params: CompressorParams) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const comp = effectRef.current;
      (comp as any).threshold.setValue(params.threshold);
      (comp as any).ratio.setValue(params.ratio);
      (comp as any).attack.setValue(params.attack);
      (comp as any).release.setValue(params.release);
      (comp as any).knee.setValue(params.knee);
    });
  }, [project]);

  const handleBypass = useCallback(() => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const compressor = effectRef.current;
      compressor.enabled.setValue(!compressor.enabled.getValue());
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
