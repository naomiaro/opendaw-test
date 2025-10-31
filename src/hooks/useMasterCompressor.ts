import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

export const useMasterCompressor = (project: Project | null) => {
  const [isActive, setIsActive] = useState(false);
  const [threshold, setThreshold] = useState(-12.0);
  const [ratio, setRatio] = useState(2.0);
  const [attack, setAttack] = useState(5.0);
  const [release, setRelease] = useState(100.0);
  const [knee, setKnee] = useState(6.0);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || isActive) return;

    project.editing.modify(() => {
      const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

      if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
      }

      const compressor = project.api.insertEffect(
        (masterAudioUnit as any).audioEffects,
        EffectFactories.AudioNamed.Compressor
      );

      compressor.label.setValue("Master Glue");
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

      console.log("Added compressor to master output");
    });

    setIsActive(true);
  }, [project, isActive, threshold, ratio, attack, release, knee]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log("Removed compressor from master output");
    });

    setIsActive(false);
  }, [project, isActive]);

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

  return {
    isActive,
    parameters,
    handleToggle: isActive ? handleRemove : handleAdd,
    handleParameterChange
  };
};
