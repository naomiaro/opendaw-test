import { useState, useCallback, useRef, useEffect } from "react";
import { Project, EffectFactories } from "@opendaw/studio-core";
import type { EffectParameter } from "../components/EffectPanel";
import type { EffectType } from "../components/EffectChain";
import {
  REVERB_PRESETS,
  COMPRESSOR_PRESETS,
  DELAY_PRESETS,
  CRUSHER_PRESETS,
  STEREO_WIDTH_PRESETS,
  EQ_PRESETS,
  FOLD_PRESETS
} from "../lib/effectPresets";

interface DynamicEffectConfig {
  id: string;
  type: EffectType;
  trackName: string;
  project: Project | null;
  audioBox: any;
}

export const useDynamicEffect = (config: DynamicEffectConfig) => {
  const { id, type, trackName, project, audioBox } = config;
  const [isBypassed, setIsBypassed] = useState(false);
  const [parameters, setParameters] = useState<{ [key: string]: number }>({});
  const effectRef = useRef<any>(null);

  // Initialize effect when component mounts
  useEffect(() => {
    if (!project || !audioBox || effectRef.current) return;

    const label = `${trackName} ${type}`;

    project.editing.modify(() => {
      let effectBox;

      switch (type) {
        case "Reverb":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.Reverb
          );
          effectBox.label.setValue(label);
          (effectBox as any).wet.setValue(-18);
          (effectBox as any).decay.setValue(0.5);
          (effectBox as any).preDelay.setValue(0.02);
          (effectBox as any).damp.setValue(0.5);
          setParameters({ wet: -18, decay: 0.5, preDelay: 0.02, damp: 0.5 });
          break;

        case "Compressor":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.Compressor
          );
          effectBox.label.setValue(label);
          (effectBox as any).threshold.setValue(-20);
          (effectBox as any).ratio.setValue(3);
          (effectBox as any).attack.setValue(5);
          (effectBox as any).release.setValue(100);
          (effectBox as any).automakeup.setValue(true);
          (effectBox as any).knee.setValue(6);
          setParameters({ threshold: -20, ratio: 3, attack: 5, release: 100, knee: 6 });
          break;

        case "Delay":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.Delay
          );
          effectBox.label.setValue(label);
          (effectBox as any).wet.setValue(-12);
          (effectBox as any).feedback.setValue(0.4);
          (effectBox as any).delay.setValue(4);
          (effectBox as any).filter.setValue(0);
          setParameters({ wet: -12, feedback: 0.4, delay: 4, filter: 0 });
          break;

        case "Crusher":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.Crusher
          );
          effectBox.label.setValue(label);
          (effectBox as any).bits.setValue(8);
          (effectBox as any).crush.setValue(0.5);
          (effectBox as any).boost.setValue(0.5);
          (effectBox as any).mix.setValue(0.8);
          setParameters({ bits: 8, crush: 0.5, boost: 0.5, mix: 0.8 });
          break;

        case "StereoWidth":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.StereoTool
          );
          effectBox.label.setValue(label);
          (effectBox as any).stereo.setValue(1.0);
          (effectBox as any).panning.setValue(0);
          setParameters({ width: 1.0, pan: 0 });
          break;

        case "EQ":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.Revamp
          );
          effectBox.label.setValue(label);
          // Simple 3-band EQ setup
          (effectBox as any).lowBell.enabled.setValue(true);
          (effectBox as any).lowBell.frequency.setValue(250);
          (effectBox as any).lowBell.gain.setValue(0);
          (effectBox as any).lowBell.q.setValue(1.0);
          (effectBox as any).midBell.enabled.setValue(true);
          (effectBox as any).midBell.frequency.setValue(1000);
          (effectBox as any).midBell.gain.setValue(0);
          (effectBox as any).midBell.q.setValue(1.0);
          (effectBox as any).highBell.enabled.setValue(true);
          (effectBox as any).highBell.frequency.setValue(4000);
          (effectBox as any).highBell.gain.setValue(0);
          (effectBox as any).highBell.q.setValue(1.0);
          setParameters({ lowGain: 0, midGain: 0, highGain: 0 });
          break;

        case "Fold":
          effectBox = project.api.insertEffect(
            (audioBox as any).audioEffects,
            EffectFactories.AudioNamed.Fold
          );
          effectBox.label.setValue(label);
          (effectBox as any).drive.setValue(0);
          (effectBox as any).overSampling.setValue(0);
          (effectBox as any).volume.setValue(0);
          setParameters({ drive: 0, volume: 0 });
          break;
      }

      if (effectBox) {
        effectRef.current = effectBox;
        effectBox.enabled.catchupAndSubscribe((obs: any) => setIsBypassed(!obs.getValue()));
      }
    });

    return () => {
      if (effectRef.current && project) {
        project.editing.modify(() => {
          effectRef.current.delete();
        });
      }
    };
  }, [project, audioBox, type, trackName]);

  const handleBypass = useCallback(() => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const effect = effectRef.current;
      effect.enabled.setValue(!effect.enabled.getValue());
    });
  }, [project]);

  const handleParameterChange = useCallback((paramName: string, value: number) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const effect = effectRef.current;

      // Handle nested EQ parameters
      if (type === "EQ") {
        if (paramName === "lowGain") {
          (effect as any).lowBell.gain.setValue(value);
        } else if (paramName === "midGain") {
          (effect as any).midBell.gain.setValue(value);
        } else if (paramName === "highGain") {
          (effect as any).highBell.gain.setValue(value);
        }
      } else {
        (effect as any)[paramName].setValue(value);
      }
    });

    setParameters(prev => ({ ...prev, [paramName]: value }));
  }, [project, type]);

  const getParameterDefinitions = (): EffectParameter[] => {
    switch (type) {
      case "Reverb":
        return [
          {
            name: 'wet',
            label: 'Wet/Dry Mix',
            value: parameters.wet || -18,
            min: -60,
            max: 0,
            step: 0.1,
            unit: ' dB'
          },
          {
            name: 'decay',
            label: 'Decay Time',
            value: parameters.decay || 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          },
          {
            name: 'preDelay',
            label: 'Pre-Delay',
            value: parameters.preDelay || 0.02,
            min: 0,
            max: 0.1,
            step: 0.001,
            format: (v) => `${(v * 1000).toFixed(0)} ms`
          },
          {
            name: 'damp',
            label: 'Damping',
            value: parameters.damp || 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          }
        ];

      case "Compressor":
        return [
          {
            name: 'threshold',
            label: 'Threshold',
            value: parameters.threshold || -20,
            min: -60,
            max: 0,
            step: 0.1,
            unit: ' dB'
          },
          {
            name: 'ratio',
            label: 'Ratio',
            value: parameters.ratio || 3,
            min: 1,
            max: 20,
            step: 0.1,
            format: (v) => `${v.toFixed(1)}:1`
          },
          {
            name: 'attack',
            label: 'Attack',
            value: parameters.attack || 5,
            min: 0,
            max: 100,
            step: 0.1,
            unit: ' ms'
          },
          {
            name: 'release',
            label: 'Release',
            value: parameters.release || 100,
            min: 5,
            max: 1500,
            step: 1,
            unit: ' ms'
          },
          {
            name: 'knee',
            label: 'Knee',
            value: parameters.knee || 6,
            min: 0,
            max: 24,
            step: 0.1,
            unit: ' dB'
          }
        ];

      case "Delay":
        return [
          {
            name: 'wet',
            label: 'Wet/Dry Mix',
            value: parameters.wet || -12,
            min: -60,
            max: 0,
            step: 0.1,
            unit: ' dB'
          },
          {
            name: 'feedback',
            label: 'Feedback',
            value: parameters.feedback || 0.4,
            min: 0,
            max: 0.95,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          },
          {
            name: 'delay',
            label: 'Delay Time',
            value: parameters.delay || 4,
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
            value: parameters.filter || 0,
            min: -1,
            max: 1,
            step: 0.01,
            format: (v) => v < 0 ? `LP ${Math.abs(v * 100).toFixed(0)}%` : v > 0 ? `HP ${(v * 100).toFixed(0)}%` : 'Off'
          }
        ];

      case "Crusher":
        return [
          {
            name: 'bits',
            label: 'Bit Depth',
            value: parameters.bits || 8,
            min: 1,
            max: 16,
            step: 1,
            format: (v) => `${v.toFixed(0)} bits`
          },
          {
            name: 'crush',
            label: 'Crush Amount',
            value: parameters.crush || 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          },
          {
            name: 'boost',
            label: 'Boost',
            value: parameters.boost || 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          },
          {
            name: 'mix',
            label: 'Wet/Dry Mix',
            value: parameters.mix || 0.8,
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          }
        ];

      case "StereoWidth":
        return [
          {
            name: 'width',
            label: 'Stereo Width',
            value: parameters.width || 1.0,
            min: 0,
            max: 2,
            step: 0.01,
            format: (v) => `${(v * 100).toFixed(0)}%`
          },
          {
            name: 'pan',
            label: 'Pan',
            value: parameters.pan || 0,
            min: -1,
            max: 1,
            step: 0.01,
            format: (v) => v === 0 ? 'Center' : v < 0 ? `L${Math.abs(v * 100).toFixed(0)}` : `R${(v * 100).toFixed(0)}`
          }
        ];

      case "EQ":
        return [
          {
            name: 'lowGain',
            label: 'Low (250 Hz)',
            value: parameters.lowGain || 0,
            min: -24,
            max: 24,
            step: 0.1,
            unit: ' dB'
          },
          {
            name: 'midGain',
            label: 'Mid (1 kHz)',
            value: parameters.midGain || 0,
            min: -24,
            max: 24,
            step: 0.1,
            unit: ' dB'
          },
          {
            name: 'highGain',
            label: 'High (4 kHz)',
            value: parameters.highGain || 0,
            min: -24,
            max: 24,
            step: 0.1,
            unit: ' dB'
          }
        ];

      case "Fold":
        return [
          {
            name: 'drive',
            label: 'Drive',
            value: parameters.drive || 0,
            min: 0,
            max: 40,
            step: 0.1,
            unit: ' dB'
          },
          {
            name: 'volume',
            label: 'Output',
            value: parameters.volume || 0,
            min: -40,
            max: 20,
            step: 0.1,
            unit: ' dB'
          }
        ];

      default:
        return [];
    }
  };

  const getPresets = () => {
    switch (type) {
      case "Reverb": return REVERB_PRESETS;
      case "Compressor": return COMPRESSOR_PRESETS;
      case "Delay": return DELAY_PRESETS;
      case "Crusher": return CRUSHER_PRESETS;
      case "StereoWidth": return STEREO_WIDTH_PRESETS;
      case "EQ": return EQ_PRESETS;
      case "Fold": return FOLD_PRESETS;
      default: return [];
    }
  };

  const loadPreset = useCallback((preset: any) => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const effect = effectRef.current;
      Object.entries(preset.params).forEach(([key, value]) => {
        // Handle special case for StereoWidth which uses different param names
        if (type === "StereoWidth") {
          const paramName = key === "width" ? "stereo" : key === "pan" ? "panning" : key;
          (effect as any)[paramName].setValue(value);
        }
        // Handle special case for EQ which has nested parameters
        else if (type === "EQ") {
          if (key === "lowGain") {
            (effect as any).lowBell.gain.setValue(value);
          } else if (key === "midGain") {
            (effect as any).midBell.gain.setValue(value);
          } else if (key === "highGain") {
            (effect as any).highBell.gain.setValue(value);
          }
        }
        // Default case
        else {
          (effect as any)[key].setValue(value);
        }
      });
    });

    setParameters(preset.params);
  }, [project, type]);

  return {
    isBypassed,
    parameters: getParameterDefinitions(),
    presets: getPresets(),
    handleBypass,
    handleParameterChange,
    loadPreset
  };
};
