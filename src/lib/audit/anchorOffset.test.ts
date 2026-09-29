/**
 * `ANCHOR_OFFSET_MS` is derived from two things that live elsewhere: the shape of
 * a reference click (`loopbackInjection.ts`) and where the onset detector marks
 * it (`onsetDetection.ts`). A change to either moves the harness's anchor while
 * the constant stays; this runs the chain the harness runs, on clicks made the
 * way the loopback makes them, and holds the constant to what comes out.
 */
import { describe, expect, it } from "vitest";
import { bandSplit, buildReferenceSchedule, estimateAnchorT0, identifyReferenceClicks } from "./recordingAlignment";
import { detectOnsets } from "./onsetDetection";
import { ANCHOR_OFFSET_MS } from "./recordingAuditCalibration";
import { REF_CLICK_DURATION_SEC, REF_CLICK_GAIN, REF_CLICK_HZ } from "./loopbackInjection";

/** The gain the loopback schedules for one click: up over 1 ms, held, down over the last 2 ms. */
function clickGain(sinceStartSec: number): number {
  if (sinceStartSec < 0 || sinceStartSec >= REF_CLICK_DURATION_SEC) return 0;
  if (sinceStartSec < 0.001) return REF_CLICK_GAIN * (sinceStartSec / 0.001);
  const holdEnd = REF_CLICK_DURATION_SEC - 0.002;
  if (sinceStartSec < holdEnd) return REF_CLICK_GAIN;
  return REF_CLICK_GAIN * (1 - (sinceStartSec - holdEnd) / 0.002);
}

/** A buffer whose first frame is at context time `firstFrameSec`, holding the schedule's clicks. */
function captured(sampleRate: number, firstFrameSec: number, times: number[], seconds: number): Float32Array {
  const buffer = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < buffer.length; i++) {
    const at = firstFrameSec + i / sampleRate;
    for (const start of times) {
      const since = at - start;
      if (since >= 0 && since < REF_CLICK_DURATION_SEC) {
        buffer[i] += clickGain(since) * Math.sin(2 * Math.PI * REF_CLICK_HZ * since);
      }
    }
  }
  return buffer;
}

describe("ANCHOR_OFFSET_MS", () => {
  it.each([
    [48000, 14],
    [44100, 13],
  ])("is how early the anchor comes out at %i Hz: %i frames", (sampleRate, frames) => {
    // Context times on the quantum grid, as the page's are.
    const firstFrameSec = (400 * 128) / sampleRate;
    const schedule = buildReferenceSchedule(firstFrameSec + (75 * 128) / sampleRate, 12, 0.25, 0.005);
    const buffer = captured(sampleRate, firstFrameSec, schedule.times, 4);
    const onsets = detectOnsets(bandSplit(buffer, sampleRate).high, sampleRate, { refractorySec: 0.05 });
    const identified = identifyReferenceClicks(onsets, schedule);
    expect(identified.length).toBeGreaterThanOrEqual(10);
    const anchor = estimateAnchorT0(identified, schedule);
    expect(anchor).not.toBeNull();
    const earlyMs = (firstFrameSec - anchor!) * 1000;
    expect(Math.round((earlyMs * sampleRate) / 1000)).toBe(frames);
    // One value for both rates: within a fifth of a frame of what is measured at each.
    expect(Math.abs(earlyMs - ANCHOR_OFFSET_MS)).toBeLessThan(0.2 * (1000 / sampleRate));
  });
});
