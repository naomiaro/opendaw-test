import { PPQN, Interpolation } from "@opendaw/lib-dsp";
import type { ppqn } from "@opendaw/lib-dsp";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";

// 4/4 time: one bar = 3840 PPQN
export const BAR = PPQN.fromSignature(4, 4); // 3840
export const NUM_BARS = 8;
export const TOTAL_PPQN = BAR * NUM_BARS; // 30720

// ─── Automation Event Types ──────────────────────────────────────────────

export type AutomationEvent = {
  position: ppqn;
  value: number; // unitValue 0..1
  interpolation: Interpolation;
};

type AutomationPreset = {
  name: string;
  events: AutomationEvent[];
};

export type AutomationTrackConfig = {
  label: string;
  parameterName: string;
  color: string;
  yLabels: { value: number; label: string }[];
  presets: AutomationPreset[];
};

// unitValue that maps to 0 dB through the VolumeMapper
const VOLUME_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0);

// ─── Preset Definitions ─────────────────────────────────────────────────

const volumePresets: AutomationPreset[] = [
  {
    name: "Fade In",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 4) as ppqn, value: VOLUME_0DB, interpolation: Interpolation.None }
    ]
  },
  {
    name: "Fade Out",
    events: [
      { position: 0 as ppqn, value: VOLUME_0DB, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.None }
    ]
  },
  {
    name: "Swell",
    events: [
      { position: 0 as ppqn, value: 0.2, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 4) as ppqn, value: 1.0, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 8) as ppqn, value: 0.2, interpolation: Interpolation.None }
    ]
  },
  {
    name: "Ducking",
    events: [
      { position: 0 as ppqn, value: VOLUME_0DB, interpolation: Interpolation.Linear },
      { position: (BAR * 2) as ppqn, value: VOLUME_0DB, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 3) as ppqn, value: 0.2, interpolation: Interpolation.None },
      { position: (BAR * 5) as ppqn, value: 0.2, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 6) as ppqn, value: VOLUME_0DB, interpolation: Interpolation.Linear },
      { position: (BAR * 8) as ppqn, value: VOLUME_0DB, interpolation: Interpolation.None }
    ]
  }
];

const panPresets: AutomationPreset[] = [
  {
    name: "L-R Sweep",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Linear },
      { position: (BAR * 8) as ppqn, value: 1.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Ping-Pong",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Linear },
      { position: (BAR * 2) as ppqn, value: 1.0, interpolation: Interpolation.Linear },
      { position: (BAR * 4) as ppqn, value: 0.0, interpolation: Interpolation.Linear },
      { position: (BAR * 6) as ppqn, value: 1.0, interpolation: Interpolation.Linear },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Center Hold",
    events: [
      { position: 0 as ppqn, value: 0.5, interpolation: Interpolation.None },
      { position: (BAR * 8) as ppqn, value: 0.5, interpolation: Interpolation.None }
    ]
  }
];

const reverbWetPresets: AutomationPreset[] = [
  {
    name: "Dry to Wet",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.Curve(0.25) },
      { position: (BAR * 8) as ppqn, value: 1.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Wet to Dry",
    events: [
      { position: 0 as ppqn, value: 1.0, interpolation: Interpolation.Curve(0.75) },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.Linear }
    ]
  },
  {
    name: "Pulse",
    events: [
      { position: 0 as ppqn, value: 0.0, interpolation: Interpolation.None },
      { position: (BAR * 2) as ppqn, value: 0.8, interpolation: Interpolation.None },
      { position: (BAR * 4) as ppqn, value: 0.0, interpolation: Interpolation.None },
      { position: (BAR * 6) as ppqn, value: 0.8, interpolation: Interpolation.None },
      { position: (BAR * 8) as ppqn, value: 0.0, interpolation: Interpolation.None }
    ]
  }
];

// Section accents — mastering-console tokens
// (docs/design/2026-06-11-mastering-console-editorial.md)
export const TRACK_CONFIGS: AutomationTrackConfig[] = [
  {
    label: "Volume",
    parameterName: "volume",
    color: "#e8a33d", // --mc-amber
    yLabels: [
      { value: 1.0, label: "+6 dB" },
      { value: VOLUME_0DB, label: "0 dB" },
      { value: 0.5, label: "−9 dB" },
      { value: 0.0, label: "−∞ dB" }
    ],
    presets: volumePresets
  },
  {
    label: "Pan",
    parameterName: "panning",
    color: "#5fb4c9", // --mc-cyan
    yLabels: [
      { value: 1.0, label: "R" },
      { value: 0.5, label: "C" },
      { value: 0.0, label: "L" }
    ],
    presets: panPresets
  },
  {
    label: "Reverb Wet",
    parameterName: "wet",
    color: "#7fbf6a", // --mc-green
    yLabels: [
      { value: 1.0, label: "Wet" },
      { value: 0.5, label: "−12 dB" },
      { value: 0.0, label: "Dry" }
    ],
    presets: reverbWetPresets
  }
];

// ─── Helpers: Convert Events to JSON for Server Persistence ─────────────

function interpolationToJson(interp: Interpolation): Record<string, unknown> {
  if (interp.type === "none") return { type: "none" };
  if (interp.type === "linear") return { type: "linear" };
  return { type: "curve", slope: (interp as { type: "curve"; slope: number }).slope };
}

export function eventsToJson(events: AutomationEvent[], parameterName: string, targetUnitId: string): Record<string, unknown> {
  return {
    automationTrack: {
      targetParameter: parameterName,
      targetUnitId,
      enabled: true,
      events: events.map((evt, i) => ({
        position: evt.position,
        value: evt.value,
        index: i > 0 && events[i - 1].position === evt.position ? 1 : 0,
        interpolation: interpolationToJson(evt.interpolation)
      }))
    }
  };
}
