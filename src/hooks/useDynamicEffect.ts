import { useState, useCallback, useRef, useEffect } from "react";
import { Project, EffectFactories, EffectFactory, EffectBox } from "@opendaw/studio-core";
import {
  ReverbDeviceBox,
  CompressorDeviceBox,
  DelayDeviceBox,
  CrusherDeviceBox,
  StereoToolDeviceBox,
  RevampDeviceBox,
  FoldDeviceBox,
  DattorroReverbDeviceBox,
  TidalDeviceBox,
  MaximizerDeviceBox,
  AudioUnitBox
} from "@opendaw/studio-boxes";
import type { Terminable } from "@opendaw/lib-std";
import type { EffectParameter } from "../components/EffectPanel";
import type { EffectType } from "../lib/types";
import {
  REVERB_PRESETS,
  COMPRESSOR_PRESETS,
  DELAY_PRESETS,
  CRUSHER_PRESETS,
  STEREO_WIDTH_PRESETS,
  EQ_PRESETS,
  FOLD_PRESETS,
  DATTORRO_REVERB_PRESETS,
  TIDAL_PRESETS,
  MAXIMIZER_PRESETS
} from "../lib/effectPresets";
import type {
  EffectPreset,
  ReverbParams,
  CompressorParams,
  DelayParams,
  CrusherParams,
  StereoWidthParams,
  EQParams,
  FoldParams,
  DattorroReverbParams,
  TidalParams,
  MaximizerParams
} from "../lib/effectPresets";

interface DynamicEffectConfig {
  id: string;
  type: EffectType;
  trackName: string;
  project: Project | null;
  audioBox: AudioUnitBox | null;
}

// ---------------------------------------------------------------------------
// Per-effect param union (used for preset loading)
// ---------------------------------------------------------------------------

type EffectParams =
  | ReverbParams
  | CompressorParams
  | DelayParams
  | CrusherParams
  | StereoWidthParams
  | EQParams
  | FoldParams
  | DattorroReverbParams
  | TidalParams
  | MaximizerParams;

// ---------------------------------------------------------------------------
// Effect configuration interface
// ---------------------------------------------------------------------------

interface EffectConfig {
  factory: EffectFactory;
  initDefaults(box: EffectBox): Record<string, number>;
  applyParam(box: EffectBox, paramName: string, value: number): void;
  getParameterDefinitions(params: Record<string, number>): EffectParameter[];
  presets: EffectPreset<EffectParams>[];
}

// ---------------------------------------------------------------------------
// Effect registry — one entry per EffectType
// ---------------------------------------------------------------------------

const EFFECT_CONFIGS: Record<EffectType, EffectConfig> = {
  Reverb: {
    factory: EffectFactories.AudioNamed.Reverb,
    initDefaults(box: EffectBox) {
      const b = box as ReverbDeviceBox;
      b.wet.setValue(-18);
      b.decay.setValue(0.5);
      b.preDelay.setValue(0.02);
      b.damp.setValue(0.5);
      return { wet: -18, decay: 0.5, preDelay: 0.02, damp: 0.5 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as ReverbDeviceBox;
      switch (name) {
        case "wet": b.wet.setValue(value); break;
        case "decay": b.decay.setValue(value); break;
        case "preDelay": b.preDelay.setValue(value); break;
        case "damp": b.damp.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "wet", label: "Wet/Dry Mix", value: params.wet || -18, min: -60, max: 0, step: 0.1, unit: " dB" },
      { name: "decay", label: "Decay Time", value: params.decay || 0.5, min: 0, max: 1, step: 0.01, format: v => `${(v * 100).toFixed(0)}%` },
      { name: "preDelay", label: "Pre-Delay", value: params.preDelay || 0.02, min: 0, max: 0.5, step: 0.001, format: v => `${(v * 1000).toFixed(0)} ms` },
      { name: "damp", label: "Damping", value: params.damp || 0.5, min: 0, max: 1, step: 0.01, format: v => `${(v * 100).toFixed(0)}%` }
    ],
    presets: REVERB_PRESETS
  },

  Compressor: {
    factory: EffectFactories.AudioNamed.Compressor,
    initDefaults(box: EffectBox) {
      const b = box as CompressorDeviceBox;
      b.threshold.setValue(-20);
      b.ratio.setValue(3);
      b.attack.setValue(5);
      b.release.setValue(100);
      b.automakeup.setValue(true);
      b.knee.setValue(6);
      return { threshold: -20, ratio: 3, attack: 5, release: 100, knee: 6 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as CompressorDeviceBox;
      switch (name) {
        case "threshold": b.threshold.setValue(value); break;
        case "ratio": b.ratio.setValue(value); break;
        case "attack": b.attack.setValue(value); break;
        case "release": b.release.setValue(value); break;
        case "knee": b.knee.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "threshold", label: "Threshold", value: params.threshold || -20, min: -60, max: 0, step: 0.1, unit: " dB" },
      { name: "ratio", label: "Ratio", value: params.ratio || 3, min: 1, max: 20, step: 0.1, format: v => `${v.toFixed(1)}:1` },
      { name: "attack", label: "Attack", value: params.attack || 5, min: 0, max: 100, step: 0.1, unit: " ms" },
      { name: "release", label: "Release", value: params.release || 100, min: 5, max: 1500, step: 1, unit: " ms" },
      { name: "knee", label: "Knee", value: params.knee || 6, min: 0, max: 24, step: 0.1, unit: " dB" }
    ],
    presets: COMPRESSOR_PRESETS
  },

  Delay: {
    factory: EffectFactories.AudioNamed.Delay,
    initDefaults(box: EffectBox) {
      const b = box as DelayDeviceBox;
      b.wet.setValue(-12);
      b.feedback.setValue(0.4);
      b.delayMusical.setValue(14);
      b.filter.setValue(0);
      return { wet: -12, feedback: 0.4, delayMusical: 14, filter: 0 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as DelayDeviceBox;
      switch (name) {
        case "wet": b.wet.setValue(value); break;
        case "feedback": b.feedback.setValue(value); break;
        case "delayMusical": b.delayMusical.setValue(value); break;
        case "filter": b.filter.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => {
      // Delay Fractions array (21 entries, indices 0-20) — different from Tidal's RateFractions
      const fractions = [
        "Off", "1/128", "1/96", "1/64", "1/48", "1/32", "1/24", "3/64",
        "1/16", "1/12", "3/32", "1/8", "1/6", "3/16", "1/4", "5/16",
        "1/3", "3/8", "7/16", "1/2", "1/1"
      ];
      return [
        { name: "wet", label: "Wet/Dry Mix", value: params.wet || -12, min: -60, max: 0, step: 0.1, unit: " dB" },
        { name: "feedback", label: "Feedback", value: params.feedback || 0.4, min: 0, max: 0.95, step: 0.01, format: v => `${(v * 100).toFixed(0)}%` },
        { name: "delayMusical", label: "Delay Time", value: params.delayMusical || 14, min: 0, max: 20, step: 1, format: (v: number) => fractions[Math.round(v)] || `${v}` },
        { name: "filter", label: "Filter", value: params.filter || 0, min: -1, max: 1, step: 0.01, format: v => (v < 0 ? `LP ${Math.abs(v * 100).toFixed(0)}%` : v > 0 ? `HP ${(v * 100).toFixed(0)}%` : "Off") }
      ];
    },
    presets: DELAY_PRESETS
  },

  Crusher: {
    factory: EffectFactories.AudioNamed.Crusher,
    initDefaults(box: EffectBox) {
      const b = box as CrusherDeviceBox;
      b.bits.setValue(12);
      b.crush.setValue(0.2);
      b.boost.setValue(0);
      b.mix.setValue(0.7);
      return { bits: 12, crush: 0.2, boost: 0, mix: 0.7 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as CrusherDeviceBox;
      switch (name) {
        case "bits": b.bits.setValue(value); break;
        case "crush": b.crush.setValue(value); break;
        case "boost": b.boost.setValue(value); break;
        case "mix": b.mix.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "bits", label: "Bit Depth", value: params.bits || 12, min: 1, max: 16, step: 1, format: v => `${v.toFixed(0)} bits` },
      { name: "crush", label: "Sample Rate Reduction", value: params.crush || 0.2, min: 0, max: 1, step: 0.01, format: v => `${(v * 100).toFixed(0)}%` },
      { name: "boost", label: "Boost", value: params.boost || 0, min: 0, max: 24, step: 0.5, format: v => `${v.toFixed(1)} dB` },
      { name: "mix", label: "Wet/Dry Mix", value: params.mix || 0.8, min: 0, max: 1, step: 0.01, format: v => `${(v * 100).toFixed(0)}%` }
    ],
    presets: CRUSHER_PRESETS
  },

  StereoWidth: {
    factory: EffectFactories.AudioNamed.StereoTool,
    initDefaults(box: EffectBox) {
      const b = box as StereoToolDeviceBox;
      b.stereo.setValue(0);
      b.panning.setValue(0);
      return { width: 0, pan: 0 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as StereoToolDeviceBox;
      switch (name) {
        case "width": b.stereo.setValue(value); break;
        case "pan": b.panning.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "width", label: "Stereo Width", value: params.width ?? 0, min: -1, max: 1, step: 0.01, format: (v: number) => v === 0 ? "Normal" : v < 0 ? `Narrow ${(v * 100).toFixed(0)}%` : `Wide +${(v * 100).toFixed(0)}%` },
      { name: "pan", label: "Pan", value: params.pan || 0, min: -1, max: 1, step: 0.01, format: v => (v === 0 ? "Center" : v < 0 ? `L${Math.abs(v * 100).toFixed(0)}` : `R${(v * 100).toFixed(0)}`) }
    ],
    presets: STEREO_WIDTH_PRESETS
  },

  EQ: {
    factory: EffectFactories.AudioNamed.Revamp,
    initDefaults(box: EffectBox) {
      const b = box as RevampDeviceBox;
      b.lowBell.enabled.setValue(true);
      b.lowBell.frequency.setValue(250);
      b.lowBell.gain.setValue(0);
      b.lowBell.q.setValue(1.0);
      b.midBell.enabled.setValue(true);
      b.midBell.frequency.setValue(1000);
      b.midBell.gain.setValue(0);
      b.midBell.q.setValue(1.0);
      b.highBell.enabled.setValue(true);
      b.highBell.frequency.setValue(4000);
      b.highBell.gain.setValue(0);
      b.highBell.q.setValue(1.0);
      return { lowGain: 0, midGain: 0, highGain: 0 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as RevampDeviceBox;
      switch (name) {
        case "lowGain": b.lowBell.gain.setValue(value); break;
        case "midGain": b.midBell.gain.setValue(value); break;
        case "highGain": b.highBell.gain.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "lowGain", label: "Low (250 Hz)", value: params.lowGain || 0, min: -24, max: 24, step: 0.1, unit: " dB" },
      { name: "midGain", label: "Mid (1 kHz)", value: params.midGain || 0, min: -24, max: 24, step: 0.1, unit: " dB" },
      { name: "highGain", label: "High (4 kHz)", value: params.highGain || 0, min: -24, max: 24, step: 0.1, unit: " dB" }
    ],
    presets: EQ_PRESETS
  },

  Fold: {
    factory: EffectFactories.AudioNamed.Fold,
    initDefaults(box: EffectBox) {
      const b = box as FoldDeviceBox;
      b.drive.setValue(0);
      b.overSampling.setValue(0);
      b.volume.setValue(0);
      return { drive: 0, volume: 0 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as FoldDeviceBox;
      switch (name) {
        case "drive": b.drive.setValue(value); break;
        case "volume": b.volume.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "drive", label: "Drive", value: params.drive || 0, min: 0, max: 30, step: 0.1, unit: " dB" },
      { name: "volume", label: "Output", value: params.volume || 0, min: -18, max: 0, step: 0.1, unit: " dB" }
    ],
    presets: FOLD_PRESETS
  },

  DattorroReverb: {
    factory: EffectFactories.AudioNamed.DattorroReverb,
    initDefaults(box: EffectBox) {
      const b = box as DattorroReverbDeviceBox;
      b.preDelay.setValue(20);
      b.bandwidth.setValue(0.9);
      b.inputDiffusion1.setValue(0.75);
      b.inputDiffusion2.setValue(0.625);
      b.decay.setValue(0.5);
      b.decayDiffusion1.setValue(0.7);
      b.decayDiffusion2.setValue(0.5);
      b.damping.setValue(0.5);
      b.excursionRate.setValue(0.5);
      b.excursionDepth.setValue(0.5);
      b.wet.setValue(-12);
      b.dry.setValue(0);
      return {
        preDelay: 20, bandwidth: 0.9, decay: 0.5, damping: 0.5,
        excursionRate: 0.5, excursionDepth: 0.5, wet: -12, dry: 0
      };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as DattorroReverbDeviceBox;
      switch (name) {
        case "preDelay": b.preDelay.setValue(value); break;
        case "bandwidth": b.bandwidth.setValue(value); break;
        case "decay": b.decay.setValue(value); break;
        case "damping": b.damping.setValue(value); break;
        case "excursionRate": b.excursionRate.setValue(value); break;
        case "excursionDepth": b.excursionDepth.setValue(value); break;
        case "wet": b.wet.setValue(value); break;
        case "dry": b.dry.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "wet", label: "Wet", value: params.wet || -12, min: -60, max: 0, step: 0.1, unit: " dB" },
      { name: "dry", label: "Dry", value: params.dry || 0, min: -60, max: 0, step: 0.1, unit: " dB" },
      { name: "decay", label: "Decay", value: params.decay || 0.5, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` },
      { name: "damping", label: "Damping", value: params.damping || 0.5, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` },
      { name: "preDelay", label: "Pre-Delay", value: params.preDelay || 20, min: 0, max: 500, step: 1, format: (v: number) => `${v.toFixed(0)} ms` },
      { name: "bandwidth", label: "Bandwidth", value: params.bandwidth || 0.9, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` },
      { name: "excursionRate", label: "Mod Rate", value: params.excursionRate || 0.5, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` },
      { name: "excursionDepth", label: "Mod Depth", value: params.excursionDepth || 0.5, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` }
    ],
    presets: DATTORRO_REVERB_PRESETS
  },

  Tidal: {
    factory: EffectFactories.AudioNamed.Tidal,
    initDefaults(box: EffectBox) {
      const b = box as TidalDeviceBox;
      b.slope.setValue(0);
      b.symmetry.setValue(0.5);
      b.rate.setValue(3);
      b.depth.setValue(0.5);
      b.offset.setValue(0);
      b.channelOffset.setValue(0);
      return { slope: 0, symmetry: 0.5, rate: 3, depth: 0.5, offset: 0, channelOffset: 0 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as TidalDeviceBox;
      switch (name) {
        case "slope": b.slope.setValue(value); break;
        case "symmetry": b.symmetry.setValue(value); break;
        case "rate": b.rate.setValue(value); break;
        case "depth": b.depth.setValue(value); break;
        case "offset": b.offset.setValue(value); break;
        case "channelOffset": b.channelOffset.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => {
      const fractions = ["1/1","1/2","1/3","1/4","3/16","1/6","1/8","3/32","1/12","1/16","3/64","1/24","1/32","1/48","1/64","1/96","1/128"];
      return [
        { name: "rate", label: "Rate", value: params.rate || 3, min: 0, max: 16, step: 1, format: (v: number) => fractions[Math.round(v)] || `${v}` },
        { name: "depth", label: "Depth", value: params.depth || 0.5, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` },
        { name: "slope", label: "Slope", value: params.slope ?? 0, min: -1, max: 1, step: 0.01, format: (v: number) => v.toFixed(2) },
        { name: "symmetry", label: "Symmetry", value: params.symmetry || 0.5, min: 0, max: 1, step: 0.01, format: (v: number) => `${(v * 100).toFixed(0)}%` },
        { name: "offset", label: "Phase Offset", value: params.offset ?? 0, min: -180, max: 180, step: 1, format: (v: number) => `${v.toFixed(0)}\u00B0` },
        { name: "channelOffset", label: "Stereo Offset", value: params.channelOffset ?? 0, min: -180, max: 180, step: 1, format: (v: number) => `${v.toFixed(0)}\u00B0` }
      ];
    },
    presets: TIDAL_PRESETS
  },

  Maximizer: {
    factory: EffectFactories.AudioNamed.Maximizer,
    initDefaults(box: EffectBox) {
      const b = box as MaximizerDeviceBox;
      b.threshold.setValue(-3);
      b.lookahead.setValue(true);
      return { threshold: -3 };
    },
    applyParam(box: EffectBox, name: string, value: number) {
      const b = box as MaximizerDeviceBox;
      switch (name) {
        case "threshold": b.threshold.setValue(value); break;
      }
    },
    getParameterDefinitions: (params) => [
      { name: "threshold", label: "Threshold", value: params.threshold || -3, min: -30, max: 0, step: 0.1, unit: " dB" }
    ],
    presets: MAXIMIZER_PRESETS
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface DynamicEffectResult {
  isBypassed: boolean;
  parameters: EffectParameter[];
  presets: EffectPreset<EffectParams>[];
  handleBypass: () => void;
  handleParameterChange: (paramName: string, value: number) => void;
  loadPreset: (preset: EffectPreset<EffectParams>) => void;
}

export const useDynamicEffect = (config: DynamicEffectConfig): DynamicEffectResult => {
  const { type, trackName, project, audioBox } = config;
  const [isBypassed, setIsBypassed] = useState(false);
  const [parameters, setParameters] = useState<Record<string, number>>({});
  const effectRef = useRef<EffectBox | null>(null);

  // Initialize effect when component mounts
  useEffect(() => {
    if (!project || !audioBox || effectRef.current) return;

    const effectConfig = EFFECT_CONFIGS[type];
    const label = `${trackName} ${type}`;

    project.editing.modify(() => {
      const effectBox = project.api.insertEffect(audioBox.audioEffects, effectConfig.factory);
      effectBox.label.setValue(label);
      const defaults = effectConfig.initDefaults(effectBox);
      setParameters(defaults);
      effectRef.current = effectBox;
    });

    // Subscribe to enabled state OUTSIDE the modify transaction
    let subscription: Terminable | null = null;
    if (effectRef.current) {
      subscription = effectRef.current.enabled.catchupAndSubscribe((obs) => {
        setIsBypassed(!obs.getValue());
      });
    }

    return () => {
      if (subscription) {
        subscription.terminate();
      }
      if (effectRef.current && project) {
        project.editing.modify(() => {
          effectRef.current!.delete();
        });
      }
    };
  }, [project, audioBox, type, trackName]);

  const effectConfig = EFFECT_CONFIGS[type];

  const handleBypass = useCallback(() => {
    if (!project || !effectRef.current) return;

    project.editing.modify(() => {
      const effect = effectRef.current!;
      effect.enabled.setValue(!effect.enabled.getValue());
    });
  }, [project]);

  const handleParameterChange = useCallback(
    (paramName: string, value: number) => {
      if (!project || !effectRef.current) return;

      project.editing.modify(() => {
        EFFECT_CONFIGS[type].applyParam(effectRef.current!, paramName, value);
      });

      setParameters(prev => ({ ...prev, [paramName]: value }));
    },
    [project, type]
  );

  const loadPreset = useCallback(
    (preset: EffectPreset<EffectParams>) => {
      if (!project || !effectRef.current) return;

      project.editing.modify(() => {
        const effect = effectRef.current!;
        Object.entries(preset.params).forEach(([key, value]) => {
          EFFECT_CONFIGS[type].applyParam(effect, key, value as number);
        });
      });

      setParameters(preset.params as Record<string, number>);
    },
    [project, type]
  );

  return {
    isBypassed,
    parameters: effectConfig.getParameterDefinitions(parameters),
    presets: effectConfig.presets,
    handleBypass,
    handleParameterChange,
    loadPreset
  };
};
