import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

interface StereoWidthParams {
  width: number;
  pan: number;
}

export const useStereoWidth = (
  project: Project | null,
  audioBox: any,
  defaultParams: StereoWidthParams,
  label: string
) => {
  const [isActive, setIsActive] = useState(false);
  const [isBypassed, setIsBypassed] = useState(false);
  const [width, setWidth] = useState(defaultParams.width);
  const [pan, setPan] = useState(defaultParams.pan);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || !audioBox || isActive) return;

    project.editing.modify(() => {
      const stereoTool = project.api.insertEffect(
        (audioBox as any).audioEffects,
        EffectFactories.AudioNamed.StereoTool
      );

      stereoTool.label.setValue(label);
      (stereoTool as any).stereo.setValue(width);
      (stereoTool as any).panning.setValue(pan);

      effectRef.current = stereoTool;

      (stereoTool as any).stereo.catchupAndSubscribe((obs: any) => setWidth(obs.getValue()));
      (stereoTool as any).panning.catchupAndSubscribe((obs: any) => setPan(obs.getValue()));
      stereoTool.enabled.catchupAndSubscribe((obs: any) => setIsBypassed(!obs.getValue()));

      console.log(`Added stereo width: ${label}`);
    });

    setIsActive(true);
  }, [project, audioBox, isActive, width, pan, label]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log(`Removed stereo width: ${label}`);
    });

    setIsActive(false);
  }, [project, isActive, label]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const stereo = effectRef.current;
      switch (paramName) {
        case 'width':
          (stereo as any).stereo.setValue(value);
          break;
        case 'pan':
          (stereo as any).panning.setValue(value);
          break;
      }
    });
  }, [project]);

  const parameters: EffectParameter[] = [
    {
      name: 'width',
      label: 'Stereo Width',
      value: width,
      min: 0,
      max: 2,
      step: 0.01,
      format: (v) => `${(v * 100).toFixed(0)}%`
    },
    {
      name: 'pan',
      label: 'Pan',
      value: pan,
      min: -1,
      max: 1,
      step: 0.01,
      format: (v) => v === 0 ? 'Center' : v < 0 ? `L${Math.abs(v * 100).toFixed(0)}` : `R${(v * 100).toFixed(0)}`
    }
  ];

  const loadPreset = useCallback((params: StereoWidthParams) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const stereo = effectRef.current;
      (stereo as any).stereo.setValue(params.width);
      (stereo as any).panning.setValue(params.pan);
    });
  }, [project]);

  const handleBypass = useCallback(() => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const stereoTool = effectRef.current;
      stereoTool.enabled.setValue(!stereoTool.enabled.getValue());
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
