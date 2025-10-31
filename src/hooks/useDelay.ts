import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

interface DelayParams {
  wet: number;
  feedback: number;
  time: number;
  filter: number;
}

export const useDelay = (
  project: Project | null,
  audioBox: any,
  defaultParams: DelayParams,
  label: string
) => {
  const [isActive, setIsActive] = useState(false);
  const [wet, setWet] = useState(defaultParams.wet);
  const [feedback, setFeedback] = useState(defaultParams.feedback);
  const [time, setTime] = useState(defaultParams.time);
  const [filter, setFilter] = useState(defaultParams.filter);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || !audioBox || isActive) return;

    project.editing.modify(() => {
      const delay = project.api.insertEffect(
        (audioBox as any).audioEffects,
        EffectFactories.AudioNamed.Delay
      );

      delay.label.setValue(label);
      (delay as any).wet.setValue(wet);
      (delay as any).feedback.setValue(feedback);
      (delay as any).time.setValue(time);
      (delay as any).filter.setValue(filter);

      effectRef.current = delay;

      (delay as any).wet.catchupAndSubscribe((obs: any) => setWet(obs.getValue()));
      (delay as any).feedback.catchupAndSubscribe((obs: any) => setFeedback(obs.getValue()));
      (delay as any).time.catchupAndSubscribe((obs: any) => setTime(obs.getValue()));
      (delay as any).filter.catchupAndSubscribe((obs: any) => setFilter(obs.getValue()));

      console.log(`Added delay: ${label}`);
    });

    setIsActive(true);
  }, [project, audioBox, isActive, wet, feedback, time, filter, label]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log(`Removed delay: ${label}`);
    });

    setIsActive(false);
  }, [project, isActive, label]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const delay = effectRef.current;
      switch (paramName) {
        case 'wet':
          (delay as any).wet.setValue(value);
          break;
        case 'feedback':
          (delay as any).feedback.setValue(value);
          break;
        case 'time':
          (delay as any).time.setValue(value);
          break;
        case 'filter':
          (delay as any).filter.setValue(value);
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
      name: 'time',
      label: 'Delay Time',
      value: time,
      min: 1,
      max: 16,
      step: 1,
      format: (v) => {
        const notes = ['1/16', '1/8', '1/4', '1/2', '1'];
        const index = Math.round((v - 1) / 3);
        return notes[Math.min(index, notes.length - 1)] || `${v} PPQN`;
      }
    },
    {
      name: 'filter',
      label: 'Filter',
      value: filter,
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
