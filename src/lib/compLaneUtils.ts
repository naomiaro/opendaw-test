import { PPQN } from "@opendaw/lib-dsp";
import { AudioUnitBoxAdapter } from "@opendaw/studio-adapters";
import type { TrackBox } from "@opendaw/studio-boxes";
import type { TrackData } from "./types";

export const BPM = 124;
export const BAR = PPQN.fromSignature(4, 4); // 3840
export const BEAT = BAR / 4; // 960
export const NUM_BARS = 8;
export const TOTAL_PPQN = BAR * NUM_BARS;
export const MAX_TAKES = 4;
export const STAGGER_OFFSETS = [0, BEAT, BEAT * 2, BEAT * 3];
export const TAKE_COLORS = ["#4ade80", "#f59e0b", "#ef4444", "#a78bfa"];
export const VOL_0DB = AudioUnitBoxAdapter.VolumeMapper.x(0);
export const VOL_SILENT = 0.0;

export type CompMode = "automation" | "splice";

export interface TakeData {
  trackData: TrackData;
  automationTrackBox: TrackBox;
  audioFileBox: any;
  offset: number;
  color: string;
  label: string;
}

export interface CompState {
  boundaries: number[];
  assignments: number[];
}
