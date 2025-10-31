import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

interface DelayParams {
  wet: number;
  feedback: number;
  delay: number;
  filter: number;
}

export const useDelay = (
  project: Project | null,
  audioBox: any,
  defaultParams: DelayParams,
  label: string
) => {
  const [isActive, setIsActive] = useState(false);
  const [isBypassed, setIsBypassed] = useState(false);
  const [wet, setWet] = useState(defaultParams.wet);
  const [feedback, setFeedback] = useState(defaultParams.feedback);
  const [delay, setDelay] = useState(defaultParams.delay);
  const [filter, setFilter] = useState(defaultParams.filter);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || !audioBox || isActive) return;

    project.editing.modify(() => {
      const delayEffect = project.api.insertEffect(
        (audioBox as any).audioEffects,
        EffectFactories.AudioNamed.Delay
      );

      delayEffect.label.setValue(label);
      (delayEffect as any).wet.setValue(wet);
      (delayEffect as any).feedback.setValue(feedback);
      (delayEffect as any).delay.setValue(delay);
      (delayEffect as any).filter.setValue(filter);

      effectRef.current = delayEffect;

      (delayEffect as any).wet.catchupAndSubscribe((obs: any) => setWet(obs.getValue()));
      (delayEffect as any).feedback.catchupAndSubscribe((obs: any) => setFeedback(obs.getValue()));
      (delayEffect as any).delay.catchupAndSubscribe((obs: any) => setDelay(obs.getValue()));
      (delayEffect as any).filter.catchupAndSubscribe((obs: any) => setFilter(obs.getValue()));
      delayEffect.enabled.catchupAndSubscribe((obs: any) => setIsBypassed(!obs.getValue()));

      console.log(`Added delay: ${label}`);
    });

    setIsActive(true);
  }, [project, audioBox, isActive, wet, feedback, delay, filter, label]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log(`Removed delay effect: ${label}`);
    });

    setIsActive(false);
  }, [project, isActive, label]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const delayEffect = effectRef.current;
      switch (paramName) {
        case 'wet':
          (delayEffect as any).wet.setValue(value);
          break;
        case 'feedback':
          (delayEffect as any).feedback.setValue(value);
          break;
        case 'delay':
          (delayEffect as any).delay.setValue(value);
          break;
        case 'filter':
          (delayEffect as any).filter.setValue(value);
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
      name: 'feedback',
      label: 'Feedback',
      value: feedback,
      min: 0,
      max: 0.95,
      step: 0.01,
      format: (v) => `${(v * 100).toFixed(0)}%`
    },
    {
      name: 'delay',
      label: 'Delay Time',
      value: delay,
      min: 0,
      max: 16,
      step: 1,
      format: (v) => {
        const notes = ['1/1', '1/2', '1/3', '1/4', '3/16', '1/6', '1/8', '3/32', '1/12', '1/16', '3/64', '1/24', '1/32', '1/48', '1/64', '1/96', '1/128'];
        return notes[Math.floor(v)] || `${v}`;
      }
    },
    {
      name: 'filter',
      label: 'Filter',
      value: filter,
      min: -1,
      max: 1,
      step: 0.01,
      format: (v) => v < 0 ? `LP ${Math.abs(v * 100).toFixed(0)}%` : v > 0 ? `HP ${(v * 100).toFixed(0)}%` : 'Off'
    }
  ];

  const loadPreset = useCallback((params: DelayParams) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const delayEffect = effectRef.current;
      (delayEffect as any).wet.setValue(params.wet);
      (delayEffect as any).feedback.setValue(params.feedback);
      (delayEffect as any).delay.setValue(params.delay);
      (delayEffect as any).filter.setValue(params.filter);
    });
  }, [project]);

  const handleBypass = useCallback(() => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const delayEffect = effectRef.current;
      delayEffect.enabled.setValue(!delayEffect.enabled.getValue());
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
