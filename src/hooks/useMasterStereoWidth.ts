import { useState, useCallback, useRef } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";

export const useMasterStereoWidth = (project: Project | null) => {
  const [isActive, setIsActive] = useState(false);
  const [width, setWidth] = useState(0.8);
  const [pan, setPan] = useState(0.0);
  const effectRef = useRef<any>(null);

  const handleAdd = useCallback(() => {
    if (!project || isActive) return;

    project.editing.modify(() => {
      const masterAudioUnit = project.rootBox.outputDevice.pointerHub.incoming().at(0)?.box;

      if (!masterAudioUnit) {
        console.error("Could not find master audio unit");
        return;
      }

      const stereoTool = project.api.insertEffect(
        (masterAudioUnit as any).audioEffects,
        EffectFactories.AudioNamed.StereoTool
      );

      stereoTool.label.setValue("Master Width");
      (stereoTool as any).stereo.setValue(width);
      (stereoTool as any).panning.setValue(pan);

      effectRef.current = stereoTool;

      (stereoTool as any).stereo.catchupAndSubscribe((obs: any) => setWidth(obs.getValue()));
      (stereoTool as any).panning.catchupAndSubscribe((obs: any) => setPan(obs.getValue()));

      console.log("Added stereo width to master output");
    });

    setIsActive(true);
  }, [project, isActive, width, pan]);

  const handleRemove = useCallback(() => {
    if (!project || !isActive || !effectRef.current) return;

    project.editing.modify(() => {
      effectRef.current.delete();
      effectRef.current = null;
      console.log("Removed stereo width from master output");
    });

    setIsActive(false);
  }, [project, isActive]);

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

  return {
    isActive,
    parameters,
    handleToggle: isActive ? handleRemove : handleAdd,
    handleParameterChange
  };
};
