// Each label is held to a render of the shape it was measured on, and to renders of other defects, which must read failing.
import { describe, expect, it } from "vitest";
import { buildRows, expectedLatencyFrames, type ExportRow } from "./exportRegressionRows.ts";
import { KNOWN_FINDINGS, NO_EVIDENCE, findingFor } from "./exportRegressionFindings.ts";
import { judgeInvariants, rowStanding, type RenderedRow, type Refs } from "./exportRegressionVerdict.ts";
import { probeSource } from "./exportRegressionSignals.ts";
import { largestStep } from "./sectionRenderGap.ts";
import { findImpulses } from "./exportRegressionReader.ts";

type Channels = Float32Array[];

const rowOf = (pageRate: number, id: string): ExportRow => buildRows(pageRate).find((r) => r.id === id)!;

const renderedOf = (row: ExportRow, channels: Channels, pageRate: number): RenderedRow => {
  const rangeFrames = Math.round(row.rangeSeconds * pageRate);
  const guard = Math.round(0.1 * pageRate);
  let peak = 0;
  for (const channel of channels) for (const value of channel) if (Math.abs(value) > peak) peak = Math.abs(value);
  return {
    samples: channels,
    reportedLatencyFrames: expectedLatencyFrames(row.latencyCase, pageRate),
    repeatHash: "h",
    read: {
      hash: "h", frames: channels[0].length, channels: channels.length, peak, nonFinite: 0,
      impulseHits: channels.length > 1 ? findImpulses(channels[1], 0.05, 1000) : [],
      largestStep: largestStep(channels[0], guard, rangeFrames - guard),
      energyPastRange: null
    }
  };
};

const judge = (row: ExportRow, channels: Channels, pageRate: number, references: Partial<Record<keyof Refs, Channels>>) => {
  const ref = (channels?: Channels): RenderedRow | null => (channels === undefined ? null : renderedOf(row, channels, pageRate));
  const results = judgeInvariants(row, renderedOf(row, channels, pageRate), {
    reference: ref(references.reference), noLatency: ref(references.noLatency), warm: ref(references.warm)
  }, pageRate);
  return { standing: rowStanding(results, null), findings: results.filter((r) => !r.holds).map((r) => r.finding) };
};

const interpolated = (source: Float32Array, at: number): number => {
  const base = Math.floor(at);
  const frac = at - base;
  return (source[base] ?? 0) * (1 - frac) + (source[base + 1] ?? 0) * frac;
};

const SOURCE_RATE = 48000;
const SOURCE = probeSource(SOURCE_RATE, 4);
const framesAt = (rate: number): number => 4 * rate;
const ratio = (rate: number): number => SOURCE_RATE / rate;

/** What the engine reads running through: the advance is a single-precision ratio, as `audio_region_player.rs` has it. */
const freeRunning = (rate: number): Channels => SOURCE.map((source) =>
  Float32Array.from({ length: framesAt(rate) }, (_, i) => interpolated(source, i * Math.fround(ratio(rate)))));

/** What it reads when seated at a start: the exact position, then the same advance, with the 5 ms ramp over it. */
const seatedAt = (rate: number, startSeconds: number, frames: number): Channels => {
  const fade = 0.005 * rate;
  return SOURCE.map((source) => Float32Array.from({ length: frames }, (_, i) =>
    interpolated(source, startSeconds * SOURCE_RATE + i * Math.fround(ratio(rate))) * Math.min(1, i / fade)));
};

const edit = (channels: Channels, change: (out: Channels) => void): Channels => {
  const out = channels.map((channel) => channel.slice());
  change(out);
  return out;
};
const short = (channels: Channels, frames: number): Channels => channels.map((channel) => channel.slice(0, channel.length - frames));
const gained = (channels: Channels, gain: number): Channels => channels.map((channel) => channel.map((v) => v * gain));

describe("loop-pass-one-frame-short", () => {
  it("applies where the position arithmetic lands one short: 44.1 kHz at 120 bpm and 48 kHz at 137 bpm, 4 s", () => {
    const [finding] = KNOWN_FINDINGS.filter((f) => f.name === "loop-pass-one-frame-short");
    const applies = (rate: number, id: string) => finding.applies(rowOf(rate, id), rate);
    expect(applies(44100, "core-none-section-loop-twice")).toBe(true);
    expect(applies(44100, "one-frame-none-section-loop-twice-48000-4-120")).toBe(true);
    expect(applies(44100, "bounce-none-bounce-loop")).toBe(true);
    expect(applies(48000, "one-frame-none-section-loop-twice-44100-4-137")).toBe(true);
    expect(applies(48000, "core-none-section-loop-twice")).toBe(false);
    expect(applies(48000, "bounce-none-bounce-loop")).toBe(false);
    expect(applies(44100, "one-frame-none-section-loop-twice-48000-4-137")).toBe(false);
    expect(applies(44100, "one-frame-none-section-loop-twice-48000-2-120")).toBe(false);
    expect(applies(44100, "core-none-section-loop-once")).toBe(false);
  });
  it("reads known on one frame early, failing on anything else about the row", () => {
    const rate = 44100;
    const row = rowOf(rate, "core-none-section-loop-twice");
    const reference = freeRunning(rate);
    const early = (frames: number): Channels => reference.map((channel) => {
      const out = new Float32Array(channel.length);
      out.set(channel.subarray(frames));
      return out;
    });
    const shape = early(1);
    expect(judge(row, shape, rate, { reference, warm: shape })).toEqual({ standing: "known-finding", findings: ["loop-pass-one-frame-short"] });
    expect(judge(row, early(2), rate, { reference, warm: early(2) }).standing).toBe("failing");
    const moved = edit(shape, (out) => { out[0][5000] += 0.01; });
    expect(judge(row, moved, rate, { reference, warm: shape }).standing).toBe("failing");
    const lost = edit(shape, (out) => { out[1].fill(0, 60000); });
    expect(judge(row, lost, rate, { reference, warm: lost }).standing).toBe("failing");
  });
  it("does not name the warm pass or the slice, and needs the warm pass to hold", () => {
    const row = rowOf(44100, "core-none-section-loop-twice");
    const one = { ...NO_EVIDENCE, earlyFrames: 1, warmHolds: () => true };
    expect(findingFor(row, "impulse-on-reference", 44100, one)?.name).toBe("loop-pass-one-frame-short");
    expect(findingFor(row, "impulse-on-reference", 44100, { ...one, warmHolds: () => false })).toBeNull();
    expect(findingFor(row, "samples-equal-warm-pass", 44100, one)).toBeNull();
    expect(findingFor(row, "section-is-slice", 44100, one)).toBeNull();
  });
});

describe("jump-fade-at-start", () => {
  const known = { standing: "known-finding", findings: ["jump-fade-at-start"] };

  for (const rate of [48000, 44100]) {
    const reference = freeRunning(rate);
    const row = rowOf(rate, "core-none-section-marker");
    const frames = 2 * rate;
    const shape = seatedAt(rate, 1, frames);
    const fade = Math.ceil(0.005 * rate);
    describe(`at ${rate}`, () => {
      it("reads known on the ramp and the read as they were measured", () => {
        expect(judge(row, shape, rate, { reference })).toEqual(known);
      });
      it("reads failing on a render that comes up short", () => {
        expect(judge(row, short(shape, 128), rate, { reference }).standing).toBe("failing");
        expect(judge(row, short(shape, frames - 300), rate, { reference }).standing).toBe("failing");
      });
      it("reads failing on another shape inside the window", () => {
        const hardGate = edit(shape, (out) => out.forEach((channel, c) => {
          channel.fill(0, 0, fade - 1);
          channel[fade - 1] = reference[c][rate + fade - 1];
        }));
        expect(judge(row, hardGate, rate, { reference }).standing).toBe("failing");
        const shortFade = edit(shape, (out) => out.forEach((channel, c) => {
          for (let i = 0; i < fade; i++) channel[i] = reference[c][rate + i] * Math.min(1, i / 60);
        }));
        expect(judge(row, shortFade, rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { out[0][100] += 0.45; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { for (let i = 0; i < 200; i++) out[0][i] = -out[0][i]; }), rate, { reference }).standing).toBe("failing");
      });
      it("reads failing on anything past the window that a read's drift does not explain", () => {
        expect(judge(row, gained(shape, 0.999), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { for (let i = 40000; i < frames; i++) out[0][i] += 0.03; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { for (let i = 40000; i < frames; i++) out[0][i] += 0.001; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { out[1][30000] += 0.03; }), rate, { reference }).standing).toBe("failing");
      });
    });
  }

  it("takes a start between two frames into the read's offset, and still reads a step or a gain", () => {
    const rate = 44100;
    const row = rowOf(rate, "position-none-setposition-off-quantum");
    const reference = freeRunning(rate);
    const frames = Math.round(row.rangeSeconds * rate);
    const shape = seatedAt(rate, row.rangeStartSeconds, frames);
    expect(judge(row, shape, rate, { reference })).toEqual(known);
    expect(judge(row, edit(shape, (out) => { for (let i = 40000; i < frames; i++) out[0][i] += 0.03; }), rate, { reference }).standing).toBe("failing");
    expect(judge(row, gained(shape, 0.999), rate, { reference }).standing).toBe("failing");
  });

  it("reads a setposition row like a marker row, at 48 kHz exact", () => {
    const rate = 48000;
    const row = rowOf(rate, "position-none-setposition-on-quantum");
    const reference = freeRunning(rate);
    const shape = seatedAt(rate, row.rangeStartSeconds, Math.round(row.rangeSeconds * rate));
    expect(judge(row, shape, rate, { reference })).toEqual(known);
    expect(judge(row, short(shape, 128), rate, { reference }).standing).toBe("failing");
  });

  it("gives the two devices of `several` their 8 frames, and no other case", () => {
    const rate = 48000;
    const reference = freeRunning(rate);
    const shape = edit(seatedAt(rate, 1, 2 * rate), (out) => { out[0][245] += 3e-5; });
    expect(judge(rowOf(rate, "core-several-section-marker"), shape, rate, { reference })).toEqual(known);
    expect(judge(rowOf(rate, "core-none-section-marker"), shape, rate, { reference }).standing).toBe("failing");
    const past = edit(shape, (out) => { out[0][250] += 3e-5; });
    expect(judge(rowOf(rate, "core-several-section-marker"), past, rate, { reference }).standing).toBe("failing");
  });

  it("stays off the other paths and groups", () => {
    const fade = KNOWN_FINDINGS.filter((f) => f.name === "jump-fade-at-start");
    for (const id of ["core-none-section-entire", "position-none-loop-on-copy", "master-none-section-marker", "tail-none-section-marker"]) {
      expect(fade.some((f) => f.applies(rowOf(48000, id), 48000)), id).toBe(false);
    }
  });
});

describe("jump-fade-cold-maximizer", () => {
  const rate = 48000;
  const row = rowOf(rate, "master-none-section-marker");
  const frames = 2 * rate;
  const WINDOW = 1168;
  const warmGain = 2 / 3;
  const hot = Float32Array.from({ length: framesAt(rate) }, (_, i) => 1.5 * Math.sin((2 * Math.PI * 997 * i) / rate));
  const reference = [hot.map((v) => v * warmGain), hot.map((v) => v * warmGain)];
  const shape = reference.map((channel) => Float32Array.from({ length: frames }, (_, i) => {
    const toWarm = 1 + 0.48 * Math.max(0, 1 - i / (WINDOW - 1));
    return channel[rate + i] * Math.min(1, i / 240) * toWarm;
  }));

  it("reads known on a cold limiter meeting the warm one", () => {
    expect(judge(row, shape, rate, { reference })).toEqual({ standing: "known-finding", findings: ["jump-fade-cold-maximizer"] });
  });
  it("reads failing on a click, a hole, too much level, a short render, or anything past the meeting point", () => {
    expect(judge(row, edit(shape, (out) => { out[0][2000] += 0.9; }), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(shape, (out) => out.forEach((channel) => channel.fill(0, 0, 3000))), rate, { reference }).standing).toBe("failing");
    expect(judge(row, gained(shape, 1.2), rate, { reference }).standing).toBe("failing");
    expect(judge(row, short(shape, 128), rate, { reference }).standing).toBe("failing");
    expect(judge(row, short(shape, frames - 3000), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(shape, (out) => { out[0][50000] += 1e-3; }), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(shape, (out) => { out[0][2000] *= 1.2; }), rate, { reference }).standing).toBe("failing");
  });
});

describe("reset-keeps-compensation-delay", () => {
  const rate = 48000;
  const reference = freeRunning(rate);
  const delayed = (frames: number): Channels => reference.map((channel) => {
    const out = new Float32Array(channel.length);
    out.set(channel.subarray(0, channel.length - frames), frames);
    return out;
  });
  const row = rowOf(rate, "core-compressor-muted-step-reset");

  it("reads known on the reference delayed by the case's figure over a silent head", () => {
    expect(judge(row, delayed(240), rate, { reference })).toEqual({ standing: "known-finding", findings: ["reset-keeps-compensation-delay"] });
  });
  it("reads failing on the wrong delay, garbage in the head, a short render, or a difference past the head", () => {
    expect(judge(row, delayed(239), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(delayed(240), (out) => { for (let i = 0; i < 240; i++) out[0][i] = 0.9 * Math.sin(i); }), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(delayed(240), (out) => { out[0][10] = 1e-4; }), rate, { reference }).standing).toBe("failing");
    expect(judge(row, short(delayed(240), 128), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(delayed(240), (out) => { out[0][90000] += 1e-6; }), rate, { reference }).standing).toBe("failing");
  });
  it("allows `several` the head it was measured with, and not more", () => {
    const several = rowOf(rate, "core-several-step-reset");
    expect(judge(several, edit(delayed(255), (out) => { out[0][100] = 0.003; }), rate, { reference }).standing).toBe("known-finding");
    expect(judge(several, edit(delayed(255), (out) => { out[0][100] = 0.01; }), rate, { reference }).standing).toBe("failing");
  });
  it("does not apply to a case with no latency: a reset there must hold", () => {
    const [finding] = KNOWN_FINDINGS.filter((f) => f.name === "reset-keeps-compensation-delay");
    expect(finding.applies(rowOf(rate, "core-none-step-reset"), rate)).toBe(false);
    expect(finding.applies(rowOf(rate, "master-none-step-reset"), rate)).toBe(false);
    expect(finding.applies(rowOf(rate, "core-none-step-chunked-odd"), rate)).toBe(false);
  });
});

describe("range-missing-tail", () => {
  const rate = 48000;
  const row = rowOf(rate, "tail-none-section-marker");
  const frames = 2 * rate;
  const ringing = Float32Array.from({ length: framesAt(rate) }, (_, i) => (i < 0.2 * rate ? 0.5 : 0.002) * Math.sin(i / 11));
  const reference = [ringing, ringing.slice()];
  const silence = [new Float32Array(frames), new Float32Array(frames)];

  it("reads known, on both invariants, on silence against the ringing reverb", () => {
    expect(judge(row, silence, rate, { reference })).toEqual({ standing: "known-finding", findings: ["range-missing-tail", "range-missing-tail"] });
  });
  it("reads failing on anything but silence", () => {
    const noise = (level: number): Channels => silence.map((channel) => channel.map((_, i) => level * (i % 2 === 0 ? 1 : -1)));
    expect(judge(row, noise(0.001), rate, { reference }).standing).toBe("failing");
    expect(judge(row, silence.map((channel) => channel.map((_, i) => 0.0025 * Math.sin(i / 7))), rate, { reference }).standing).toBe("failing");
  });
  it("reads failing when the reference is silent there too: then no tail is missing, the Reverb stopped", () => {
    const stopped = reference.map((channel) => channel.map((v, i) => (i < 0.2 * rate ? v : 0)));
    expect(judge(row, silence, rate, { reference: stopped }).standing).toBe("failing");
  });
  it("reads failing on a short silent render, and on a reference far louder than a reverb's tail", () => {
    expect(judge(row, short(silence, 128), rate, { reference }).standing).toBe("failing");
    const loud = reference.map((channel) => channel.map((v) => v * 50));
    expect(judge(row, silence, rate, { reference: loud }).standing).toBe("failing");
  });
  it("stays off the rows that ring", () => {
    KNOWN_FINDINGS.filter((f) => f.name === "range-missing-tail")
      .forEach((f) => expect(f.applies(rowOf(rate, "tail-none-section-entire"), rate)).toBe(false));
  });
});

describe("trailing-silence-trimmed", () => {
  const whole = (rate: number): Channels => {
    const channel = Float32Array.from({ length: framesAt(rate) }, (_, i) => 0.25 * Math.sin(i / 11));
    return [channel, channel.slice()];
  };
  it("reads known on the frame count each rate keeps, bit-identical up to there", () => {
    for (const [rate, kept] of [[48000, 80992], [44100, 74001]]) {
      for (const id of ["tail-none-section-entire-long", "tail-none-start-long"]) {
        const reference = whole(rate);
        expect(judge(rowOf(rate, id), reference.map((c) => c.slice(0, kept)), rate, { reference }))
          .toEqual({ standing: "known-finding", findings: ["trailing-silence-trimmed"] });
      }
    }
  });
  it("reads failing at another length, or with a difference in what it kept", () => {
    const rate = 48000;
    const row = rowOf(rate, "tail-none-start-long");
    const reference = whole(rate);
    expect(judge(row, reference.map((c) => c.slice(0, 80000)), rate, { reference }).standing).toBe("failing");
    expect(judge(row, edit(reference.map((c) => c.slice(0, 80992)), (out) => { out[0][3] += 1e-3; }), rate, { reference }).standing).toBe("failing");
  });
  it("stays off the rows that keep their span", () => {
    const [finding] = KNOWN_FINDINGS.filter((f) => f.name === "trailing-silence-trimmed");
    expect(finding.applies(rowOf(48000, "tail-none-section-entire"), 48000)).toBe(false);
  });
});

describe("the gap rows", () => {
  const span = (rate: number): Channels => {
    const channel = new Float32Array(18 * rate);
    channel.fill(0.5, 0, Math.round(0.2 * rate));
    channel.fill(0.5, 16 * rate, Math.round(16.2 * rate));
    return [channel, channel.slice()];
  };
  it("have no label yet: cut at the gap they read failing, on both paths and both rates", () => {
    for (const rate of [48000, 44100]) {
      for (const id of ["gap-none-start", "gap-none-section-entire"]) {
        const row = rowOf(rate, id);
        const reference = span(rate);
        const cut = reference.map((c) => c.slice(0, Math.round(0.45 * rate)));
        expect(KNOWN_FINDINGS.filter((f) => f.applies(row, rate)).map((f) => f.name), id).toEqual([]);
        expect(judge(row, cut, rate, { reference }), id).toEqual({ standing: "failing", findings: [null] });
      }
    }
  });
  it("read clean on a render that reaches the second region's end, however much silence it keeps after", () => {
    for (const rate of [48000, 44100]) {
      const reference = span(rate);
      const kept = reference.map((c) => c.slice(0, Math.round(16.45 * rate)));
      expect(judge(rowOf(rate, "gap-none-start"), kept, rate, { reference }).standing, String(rate)).toBe("clean");
    }
  });
});

describe("loop-wrap-keeps-old-read", () => {
  for (const rate of [48000, 44100]) {
    describe(`at ${rate}`, () => {
      const row = rowOf(rate, "position-none-loop-on-copy");
      const reference = freeRunning(rate);
      const wrap = 2 * rate;
      const fade = 0.005 * rate;
      const wrapped = (oldFadesOver: number): Channels => reference.map((channel) => channel.map((v, i) => {
        if (i < wrap) return v;
        const k = i - wrap;
        return channel[k] + v * Math.max(0, 1 - k / oldFadesOver);
      }));
      const shape = wrapped(fade);

      it("reads known on the new read over the old one's 5 ms fade", () => {
        expect(judge(row, shape, rate, { reference })).toEqual({ standing: "known-finding", findings: ["loop-wrap-keeps-old-read"] });
      });
      it("reads failing when the old read fades longer, or never", () => {
        expect(judge(row, wrapped(fade * 2), rate, { reference }).standing).toBe("failing");
        expect(judge(row, wrapped(Infinity), rate, { reference }).standing).toBe("failing");
      });
      it("reads failing on a jump elsewhere, even under the wrap's own step", () => {
        const jump = edit(shape, (out) => { for (let i = 40960; i < out[0].length; i++) out[0][i] += 0.04; });
        expect(judge(row, jump, rate, { reference }).standing).toBe("failing");
      });
      it("reads failing on a tone lost after the wrap", () => {
        expect(judge(row, edit(shape, (out) => { out[0].fill(0, wrap + 1000); }), rate, { reference }).standing).toBe("failing");
      });
    });
  }
  it("stays off the other rows", () => {
    const [finding] = KNOWN_FINDINGS.filter((f) => f.name === "loop-wrap-keeps-old-read");
    expect(finding.applies(rowOf(48000, "core-none-section-marker"), 48000)).toBe(false);
  });
});

describe("a bounce row is held to samples, so no standing survives whatever they do", () => {
  for (const rate of [48000, 44100]) {
    describe(`at ${rate}`, () => {
      const reference = freeRunning(rate);
      const none = reference;
      for (const path of ["bounce-pre-fx", "bounce-pre-fader", "bounce-post-fader"]) {
        const row = rowOf(rate, `bounce-none-${path}`);
        it(`${path} reads clean on the reference's samples, failing on anything else`, () => {
          expect(judge(row, reference, rate, { reference: none }).standing).toBe("clean");
          expect(judge(row, gained(reference, 0.97), rate, { reference: none }).standing).toBe("failing");
          expect(judge(row, gained(reference, 0.5), rate, { reference: none }).standing).toBe("failing");
          expect(judge(row, edit(reference, (out) => { out[0][100] += 0.45; }), rate, { reference: none }).standing).toBe("failing");
          expect(judge(row, edit(reference, (out) => { out[0][50000] += 1e-6; }), rate, { reference: none }).standing).toBe("failing");
          expect(judge(row, short(reference, 128), rate, { reference: none }).standing).toBe("failing");
        });
      }
    });
  }

  describe("a merge reseats its read at the cut", () => {
    /** The second region reads from the exact position, the first free-ran to it, and they cross within rounding. */
    const merged = (rate: number, reference: Channels): Channels => {
      const seam = 2 * rate;
      return reference.map((channel, c) => channel.map((v, i) =>
        (i < seam ? v : interpolated(SOURCE[c], 2 * SOURCE_RATE + (i - seam) * Math.fround(ratio(rate))))));
    };
    for (const rate of [48000, 44100]) {
      const row = rowOf(rate, "bounce-none-bounce-merge");
      const reference = freeRunning(rate);
      const seam = 2 * rate;
      // a differing frame at the crossfade's rounding at 48 kHz, where the read itself is exact
      const shape = edit(merged(rate, reference), (out) => { out[0][seam + 14] += 3e-8; });
      it(`reads known at ${rate} on the read seated at the cut, failing on anything else`, () => {
        expect(judge(row, shape, rate, { reference })).toEqual({ standing: "known-finding", findings: ["merge-seam-reseats-read"] });
        expect(judge(row, gained(shape, 0.97), rate, { reference }).findings).toEqual([null]);
        expect(judge(row, edit(shape, (out) => { out[0][seam - 1] += 1e-6; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { for (let i = seam + 2000; i < out[0].length; i++) out[0][i] += 1e-3; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { out[0][seam + 100] += 0.1; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, short(shape, 128), rate, { reference }).standing).toBe("failing");
      });
    }
  });

  it("names no finding on a slice that differs: none of the labels applies to these paths", () => {
    const rate = 44100;
    const row = rowOf(rate, "bounce-none-bounce-pre-fader");
    const reference = freeRunning(rate);
    expect(judge(row, gained(reference, 0.97), rate, { reference }).findings).toEqual([null]);
  });

  it("reads a pre-fx bounce on a latent case against the render with no device at all", () => {
    for (const rate of [48000, 44100]) {
      for (const latencyCase of ["none", "autotune-muted", "compressor-track", "compressor-muted"]) {
        expect(rowOf(rate, `bounce-${latencyCase}-bounce-pre-fx`).referenceId).toBe("core-none-step-one");
      }
    }
  });
});

describe("a loop bounce is held to the stepped loop's second pass", () => {
  const rate = 44100;
  const row = rowOf(rate, "bounce-none-bounce-loop");
  const reference = freeRunning(rate);
  const early = reference.map((channel) => {
    const out = new Float32Array(channel.length);
    out.set(channel.subarray(1));
    return out;
  });

  it("names the short pass only while the warm pass holds", () => {
    expect(judge(row, early, rate, { reference, warm: early })).toEqual({ standing: "known-finding", findings: ["loop-pass-one-frame-short"] });
  });
  it("reads failing, with no name on the shift, when the samples moved too", () => {
    for (const mutated of [gained(early, 0.97), gained(early, 0.5), edit(early, (out) => { out[0][100] += 0.45; }), edit(early, (out) => { out[0][50000] += 1e-6; })]) {
      expect(judge(row, mutated, rate, { reference, warm: early })).toEqual({ standing: "failing", findings: [null, null] });
    }
  });
  it("takes the one frame past the short pass, silent in the bounce, on both invariants, and no other frame", () => {
    const last = early[0].length - 1;
    const silentEnd = edit(early, (out) => { out[0][last] = 0; out[1][last] = 0; });
    const warm = edit(early, (out) => { out[0][last] = 0.0707; });
    const names = ["loop-bounce-last-frame-silent", "loop-pass-one-frame-short"];
    expect(judge(row, silentEnd, rate, { reference, warm })).toEqual({ standing: "known-finding", findings: names });
    expect(judge(row, silentEnd, rate, { reference, warm: edit(early, (out) => { out[0][last] = 0.2; }) }).standing).toBe("failing");
    expect(judge(row, edit(silentEnd, (out) => { out[0][last - 1] += 1e-3; }), rate, { reference, warm }).standing).toBe("failing");
    expect(judge(row, gained(silentEnd, 0.97), rate, { reference, warm }).standing).toBe("failing");
  });
  it("reads failing unless that frame is silent on both channels", () => {
    const last = early[0].length - 1;
    const silentEnd = edit(early, (out) => { out[0][last] = 0; out[1][last] = 0; });
    const warm = edit(early, (out) => { out[0][last] = 0.0707; out[1][last] = 0; });
    expect(judge(row, silentEnd, rate, { reference, warm }).standing).toBe("known-finding");
    for (const value of [0.05, 0.14, -0.05, 1e-6]) {
      expect(judge(row, edit(silentEnd, (out) => { out[0][last] = value; }), rate, { reference, warm }).standing, String(value)).toBe("failing");
    }
    expect(judge(row, edit(silentEnd, (out) => { out[1][last] = 0.049; }), rate, { reference, warm }).standing).toBe("failing");
  });
  it("gives a row with its own warm pass no such frame", () => {
    const loop = rowOf(rate, "core-none-section-loop-twice");
    const last = early[0].length - 1;
    const warm = edit(early, (out) => { out[0][last] = 0.0707; });
    expect(judge(loop, early, rate, { reference, warm }).standing).toBe("failing");
  });
  it("reads clean at 48 kHz on a pass that lands exact, failing on any other samples", () => {
    const at48 = rowOf(48000, "bounce-none-bounce-loop");
    const same = freeRunning(48000);
    expect(judge(at48, same, 48000, { reference: same, warm: same }).standing).toBe("clean");
    expect(judge(at48, gained(same, 0.97), 48000, { reference: same, warm: same }).standing).toBe("failing");
  });
  it("reads the same case's stepped loop", () => {
    for (const r of [48000, 44100]) {
      for (const latencyCase of ["none", "autotune-muted", "compressor-track", "compressor-muted"]) {
        const loop = rowOf(r, `bounce-${latencyCase}-bounce-loop`);
        expect(loop.warmReferenceId).toBe(`core-${latencyCase}-step-loop-twice`);
        expect(loop.referenceId).toBe(`core-${latencyCase}-step-one`);
        expect(loop.invariants).toEqual(expect.arrayContaining(["samples-equal-warm-pass", "impulse-on-reference"]));
        expect(loop.invariants).not.toContain("section-is-slice");
      }
    }
  });
});

describe("a loop on the copy is held to the reference over its first pass", () => {
  for (const rate of [48000, 44100]) {
    describe(`at ${rate}`, () => {
      const row = rowOf(rate, "position-none-loop-on-copy");
      const reference = freeRunning(rate);
      const wrap = 2 * rate;
      const shape = reference.map((channel) => channel.map((v, i) => {
        if (i < wrap) return v;
        const k = i - wrap;
        return channel[k] + v * Math.max(0, 1 - k / (0.005 * rate));
      }));
      it("takes the wrap's own frames as the loop's, and holds the first pass bit for bit", () => {
        expect(judge(row, shape, rate, { reference })).toEqual({ standing: "known-finding", findings: ["loop-wrap-keeps-old-read"] });
      });
      it("reads failing at gain 0.5, and on one frame of the first pass moved", () => {
        const half = judge(row, gained(shape, 0.5), rate, { reference });
        expect(half.standing).toBe("failing");
        expect(half.findings).toContain(null);
        expect(judge(row, edit(shape, (out) => { out[0][100] += 1e-6; }), rate, { reference }).standing).toBe("failing");
        expect(judge(row, edit(shape, (out) => { out[0][wrap - 1] += 1e-6; }), rate, { reference }).standing).toBe("failing");
      });
    });
  }
});

it("lists each finding with a note", () => {
  KNOWN_FINDINGS.forEach((f) => expect(f.note.length).toBeGreaterThan(0));
});
