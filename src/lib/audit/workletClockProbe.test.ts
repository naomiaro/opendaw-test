import { describe, expect, it } from "vitest";
import {
  behindRangeQuanta, classifyClockProbe, clockProbeConfigFrom, countOffs, summarizeClockWatch, summarizeFreshRecorders,
  type ClockConditionResult,
} from "./workletClockProbe";

const QUANTUM = 128;
/** A ramp of 4800 frames started at context frame 1280: sample i holds (i + 1) / length. */
const START = 1280;
const LENGTH = 4800;
/** The first sample a quantum that begins at `frame` is handed; 0 before the ramp starts. */
const firstSampleAt = (frame: number): number =>
  frame < START ? 0 : Math.fround((frame - START + 1) / LENGTH);

/** `quanta` calls from context frame 0; the calls listed in `stale` read the frame of the call before. */
function watch(quanta: number, stale: number[] = []) {
  const frames = new Float64Array(quanta);
  const first = new Float32Array(quanta);
  for (let call = 0; call < quanta; call++) {
    const trueFrame = call * QUANTUM;
    frames[call] = stale.includes(call) ? trueFrame - QUANTUM : trueFrame;
    first[call] = firstSampleAt(trueFrame);
  }
  return { frames, first };
}

describe("summarizeClockWatch", () => {
  it("checks every quantum the ramp reached and finds a true clock true", () => {
    const { frames, first } = watch(30);
    const summary = summarizeClockWatch(frames, first, START, LENGTH);
    // 10 quanta pass before the ramp starts: nothing says which frame they are
    expect(summary.checked).toBe(20);
    expect(summary.offs).toEqual({ "0": 20 });
    expect(summary.steps).toEqual({ "128": 29 });
    expect(summary.firstOffs).toEqual([]);
  });

  it("reports a stamp that is one quantum behind the frame its sample names", () => {
    const { frames, first } = watch(30, [15]);
    const summary = summarizeClockWatch(frames, first, START, LENGTH);
    expect(summary.offs).toEqual({ "0": 19, "-128": 1 });
    expect(summary.steps).toEqual({ "128": 27, "0": 1, "256": 1 });
    expect(summary.firstOffs).toEqual([{ call: 15, stamp: 14 * QUANTUM, trueFrame: 15 * QUANTUM, off: -128 }]);
  });

  it("keeps only the first few stale calls as examples, and counts them all", () => {
    const stale = Array.from({ length: 18 }, (_, i) => 11 + i);
    const { frames, first } = watch(30, stale);
    const summary = summarizeClockWatch(frames, first, START, LENGTH);
    expect(summary.offs["-128"]).toBe(18);
    expect(summary.firstOffs).toHaveLength(12);
  });
});

describe("summarizeFreshRecorders", () => {
  it("counts each recorder's first stamp against the frame its first sample names", () => {
    const calls = [
      { frame: 2560, first: firstSampleAt(2560) },
      { frame: 2688 - QUANTUM, first: firstSampleAt(2688) },
      { frame: 3840, first: firstSampleAt(3840) },
    ];
    expect(summarizeFreshRecorders(calls, 7, START, LENGTH)).toEqual({ built: 7, answered: 3, offs: { "0": 2, "-128": 1 } });
  });
});

describe("classifyClockProbe", () => {
  const condition = (
    name: ClockConditionResult["condition"],
    offs: Record<string, number>,
    fresh?: Record<string, number>
  ): ClockConditionResult => {
    const checked = Object.values(offs).reduce((sum, n) => sum + n, 0);
    const answered = fresh === undefined ? 0 : Object.values(fresh).reduce((sum, n) => sum + n, 0);
    return {
      condition: name, quanta: checked, checked, bursts: 1, operations: 1, offs, steps: {}, firstOffs: [],
      ...(fresh === undefined ? {} : { freshRecorders: { built: answered, answered, offs: fresh } }),
    };
  };

  it("is CLOCK TRUE when every stamp of every condition named its own quantum", () => {
    const verdict = classifyClockProbe([condition("idle", { "0": 100 }), condition("stream", { "0": 100 }, { "0": 40 })]);
    expect(verdict.verdict).toBe("CLOCK TRUE");
    expect(verdict.headline).toBe("CLOCK TRUE: 200 quanta and 40 fresh worklets, every currentFrame named its own quantum");
  });

  it("is STALE CLOCK when a quantum read an old frame, and says how many fresh worklets did", () => {
    const verdict = classifyClockProbe([
      condition("idle", { "0": 100 }),
      condition("connect", { "0": 60, "-128": 30, "-256": 10 }),
      condition("stream", { "0": 99, "-128": 1 }, { "0": 38, "-128": 2 }),
    ]);
    expect(verdict.verdict).toBe("STALE CLOCK");
    expect(verdict.staleQuanta).toBe(41);
    expect(verdict.checkedQuanta).toBe(300);
    expect(verdict.freshEarly).toBe(2);
    expect(verdict.freshAnswered).toBe(40);
    expect(verdict.late).toBe(0);
    expect(verdict.headline).toBe(
      "STALE CLOCK: 2 of 40 fresh worklets read their first currentFrame early; 41 of 300 quanta read a currentFrame behind their own"
    );
  });

  it("is STALE CLOCK on stale quanta alone, when no fresh worklet was built", () => {
    const verdict = classifyClockProbe([condition("connect", { "0": 60, "-128": 40 })]);
    expect(verdict.verdict).toBe("STALE CLOCK");
    expect(verdict.headline).toBe("STALE CLOCK: 40 of 100 quanta read a currentFrame behind their own");
  });

  describe("a run that checked too little says so instead of CLOCK TRUE", () => {
    const cfg = { sampleRate: 48000, seconds: 10, burstMs: 8, gapMs: 2, conditions: ["idle", "connect", "stream"] as const };
    /** A condition as a healthy foreground run gives it: every quantum checked, about a thousand stretches of work. */
    const healthy = (name: ClockConditionResult["condition"], fresh?: Record<string, number>): ClockConditionResult =>
      ({ ...condition(name, { "0": 3693 }, fresh), quanta: 3750, bursts: 900 });

    it("is CLOCK TRUE for a healthy run", () => {
      const verdict = classifyClockProbe([healthy("idle"), healthy("connect"), healthy("stream", { "0": 1900 })], cfg);
      expect(verdict.verdict).toBe("CLOCK TRUE");
    });

    it("is NOT CHECKED when no condition ran", () => {
      const verdict = classifyClockProbe([], cfg);
      expect(verdict.verdict).toBe("NOT CHECKED");
      expect(verdict.headline).toBe("NOT CHECKED: no condition was watched");
    });

    it("is NOT CHECKED when a condition's quanta mostly carried no ramp", () => {
      const starved = { ...healthy("connect"), checked: 100, offs: { "0": 100 } };
      const verdict = classifyClockProbe([healthy("idle"), starved], cfg);
      expect(verdict.verdict).toBe("NOT CHECKED");
      expect(verdict.headline).toBe("NOT CHECKED: connect checked 100 of 3750 quanta");
    });

    it("is NOT CHECKED when the main thread's work was throttled: a tab in the background does a stretch a second", () => {
      const throttled = { ...healthy("connect"), bursts: 12 };
      const verdict = classifyClockProbe([healthy("idle"), throttled], cfg);
      expect(verdict.verdict).toBe("NOT CHECKED");
      expect(verdict.headline).toBe(
        "NOT CHECKED: connect did 12 stretches of work where about 1000 were due: keep the page visible (a hidden or covered page is throttled)"
      );
    });

    it("names the throttled conditions in one clause", () => {
      const verdict = classifyClockProbe([{ ...healthy("idle"), bursts: 14 }, { ...healthy("connect"), bursts: 11 }], cfg);
      expect(verdict.headline).toBe(
        "NOT CHECKED: idle, connect did 11 to 14 stretches of work where about 1000 were due: keep the page visible (a hidden or covered page is throttled)"
      );
    });

    it("is NOT CHECKED when no fresh worklet answered", () => {
      const verdict = classifyClockProbe([healthy("stream", {})], cfg);
      expect(verdict.verdict).toBe("NOT CHECKED");
      expect(verdict.headline).toBe("NOT CHECKED: stream built 0 fresh worklets that answered");
    });

    it("still says STALE CLOCK when a starved run found a stale stamp: found is found", () => {
      const throttled = { ...healthy("connect"), bursts: 12, offs: { "0": 3672, "-128": 21 } };
      const verdict = classifyClockProbe([healthy("idle"), throttled], cfg);
      expect(verdict.verdict).toBe("STALE CLOCK");
      expect(verdict.headline).toContain("connect did 12 stretches of work where about 1000 were due");
    });

    it("carries the reasons as a list, for a saved result to be sorted by", () => {
      expect(classifyClockProbe([healthy("idle"), { ...healthy("connect"), bursts: 12 }], cfg).shortfalls)
        .toEqual(["connect did 12 stretches of work where about 1000 were due: keep the page visible (a hidden or covered page is throttled)"]);
      expect(classifyClockProbe([healthy("idle"), healthy("connect")], cfg).shortfalls).toEqual([]);
    });

    it("is NOT CHECKED for a stream condition that reports no fresh worklets at all", () => {
      const verdict = classifyClockProbe([healthy("stream")], cfg);
      expect(verdict.verdict).toBe("NOT CHECKED");
      expect(verdict.headline).toBe("NOT CHECKED: stream built 0 fresh worklets that answered");
    });

    it("says CLOCK AHEAD with the same caveat when a starved run found a stamp ahead", () => {
      const verdict = classifyClockProbe([{ ...healthy("connect"), bursts: 12, offs: { "0": 3692, "128": 1 } }], cfg);
      expect(verdict.verdict).toBe("CLOCK AHEAD");
      expect(verdict.headline).toContain("connect did 12 stretches of work where about 1000 were due");
    });

    it("does not expect more stretches than a browser's timers give: nested timeouts come at 4 ms at the soonest", () => {
      // 1 ms of work and no pause would be 1000 stretches a second; a focused page does about 250
      const quick = { ...cfg, burstMs: 1, gapMs: 0 };
      expect(classifyClockProbe([{ ...healthy("idle"), bursts: 2400 }], quick).verdict).toBe("CLOCK TRUE");
      expect(classifyClockProbe([{ ...healthy("idle"), bursts: 12 }], quick).verdict).toBe("NOT CHECKED");
    });

    it("judges nothing about throttling without a configuration", () => {
      expect(classifyClockProbe([{ ...healthy("connect"), bursts: 12 }]).verdict).toBe("CLOCK TRUE");
    });
  });

  it("counts a stamp AHEAD of its quantum apart: a stale clock cannot make one", () => {
    const ahead = classifyClockProbe([condition("connect", { "0": 99, "128": 1 })]);
    expect(ahead.verdict).toBe("CLOCK AHEAD");
    expect(ahead.staleQuanta).toBe(0);
    expect(ahead.late).toBe(1);
    expect(ahead.headline).toBe("CLOCK AHEAD: 1 stamp(s) read a currentFrame AHEAD of their own quantum, of 100 quanta");
    const both = classifyClockProbe([condition("stream", { "0": 98, "-128": 2 }, { "0": 9, "128": 1 })]);
    expect(both.verdict).toBe("STALE CLOCK");
    expect(both.late).toBe(1);
    expect(both.headline).toBe(
      "STALE CLOCK: 0 of 10 fresh worklets read their first currentFrame early; 2 of 100 quanta read a currentFrame behind their own; 1 stamp(s) AHEAD of their own quantum"
    );
  });
});

describe("clockProbeConfigFrom", () => {
  const from = (query: string) => clockProbeConfigFrom(new URLSearchParams(query));

  it("watches all five conditions for ten seconds each at 48 kHz when the page is opened bare", () => {
    expect(from("")).toEqual({
      sampleRate: 48000, seconds: 10, burstMs: 8, gapMs: 2,
      conditions: ["idle", "busy", "connect", "create", "stream"],
    });
  });

  it("takes the length, the rate, the stretches and a choice of conditions from the query", () => {
    expect(from("seconds=60&rate=44100&burstMs=4&gapMs=1&conditions=stream,idle")).toEqual({
      sampleRate: 44100, seconds: 60, burstMs: 4, gapMs: 1, conditions: ["stream", "idle"],
    });
  });

  it("refuses what it does not know instead of running something else", () => {
    expect(() => from("conditions=stream,jank")).toThrow(/conditions/);
    expect(() => from("conditions=")).toThrow(/conditions/);
    expect(() => from("conditions=stream,stream")).toThrow(/conditions/);
    expect(() => from("seconds=0")).toThrow(/seconds/);
    expect(() => from("seconds=abc")).toThrow(/seconds/);
    // digits only: no other way of writing a number
    expect(() => from("seconds=1.5")).toThrow(/seconds/);
    expect(() => from("seconds=0x10")).toThrow(/seconds/);
    expect(() => from("seconds=1e1")).toThrow(/seconds/);
    expect(() => from("gapMs=")).toThrow(/gapMs/);
    expect(() => from("seconds=%2010")).toThrow(/seconds/);
    // the ramp names each frame by a float32, which holds to about 340 s at 48 kHz: the page stops well short
    expect(() => from("seconds=121")).toThrow(/seconds/);
    expect(() => from("rate=1000")).toThrow(/rate/);
    expect(() => from("burstMs=0")).toThrow(/burstMs/);
    expect(() => from("gapMs=-1")).toThrow(/gapMs/);
  });
});

describe("behindRangeQuanta", () => {
  it("is null for a clock that was never behind", () => {
    expect(behindRangeQuanta({ "0": 10 })).toBeNull();
    expect(behindRangeQuanta({ "0": 10, "128": 1 })).toBeNull();
  });

  it("gives the least and the most a stamp was behind, in quanta", () => {
    expect(behindRangeQuanta({ "0": 10, "-128": 3 })).toEqual([1, 1]);
    expect(behindRangeQuanta({ "0": 10, "-128": 3, "-1792": 1, "-384": 2 })).toEqual([1, 14]);
  });
});

describe("countOffs", () => {
  it("adds up the calls whose distance from their own frame is picked", () => {
    const offs = { "0": 10, "-128": 3, "-384": 2, "128": 1 };
    expect(countOffs(offs, (off) => off < 0)).toBe(5);
    expect(countOffs(offs, (off) => off === 0)).toBe(10);
    expect(countOffs(offs, (off) => off > 0)).toBe(1);
    expect(countOffs({}, () => true)).toBe(0);
  });
});
