import { describe, expect, it } from "vitest";
import { buildRows, expectedFrames, expectedLatencyFrames, lastReaders, LOOP_ON_COPY_SECONDS, selectRows, setPositionStart, SET_POSITION_SECONDS } from "./exportRegressionRows.ts";

describe("exportRegressionRows", () => {
  it("gives the latency figures the crates and the #530 note read", () => {
    const table = [["none", 0, 0], ["autotune-muted", 1280, 1280], ["compressor-track", 240, 220], ["compressor-muted", 240, 220],
      ["maximizer-muted", 240, 221], ["fold-muted", 15, 15], ["script-10ms-muted", 480, 441], ["script-150ms-parallel", 4800, 4410],
      ["compressor-bus", 240, 220], ["compressor-aux", 240, 220], ["several", 255, 235]] as const;
    for (const [id, at48, at44] of table) {
      expect(expectedLatencyFrames(id, 48000)).toBe(at48);
      expect(expectedLatencyFrames(id, 44100)).toBe(at44);
    }
  });
  it("uses ids the verify sink accepts, each once", () => {
    const rows = buildRows(48000);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    rows.forEach((r) => expect(r.id).toMatch(/^[a-z0-9-]+$/));
  });
  it("crosses every core path with every latency case", () => {
    const rows = buildRows(44100).filter((r) => r.group === "core");
    expect(rows.length).toBe(11 * 11);
  });
  it("points every reference at a row that exists and renders first", () => {
    for (const rate of [48000, 44100]) {
      const seen = new Set<string>();
      for (const r of buildRows(rate)) {
        if (r.referenceId !== null) expect(seen.has(r.referenceId), r.id).toBe(true);
        if (r.noLatencyReferenceId !== null) expect(seen.has(r.noLatencyReferenceId), r.id).toBe(true);
        if (r.warmReferenceId !== null) expect(seen.has(r.warmReferenceId), r.id).toBe(true);
        seen.add(r.id);
      }
    }
  });
  it("drives the default master Maximizer over its limit on the render paths", () => {
    const rows = buildRows(48000).filter((r) => r.group === "master" && r.masterMaximizer);
    expect(rows.length).toBe(2 * 10);
    rows.forEach((r) => expect(r.signal, r.id).toBe("hot"));
    expect(new Set(rows.map((r) => r.path)).size).toBe(10);
    expect(rows.filter((r) => r.path === "step-one").every((r) => r.invariants.includes("differs-from-reference"))).toBe(true);
    rows.forEach((r) => expect(r.invariants, r.id).not.toContain("no-jump"));
  });
  it("never gives a resampled row an exact-frame invariant", () => {
    buildRows(44100).filter((r) => r.sourceRate !== 44100)
      .forEach((r) => expect(r.invariants, r.id).not.toContain("impulse-on-computed-frame"));
  });
  it("holds the one-frame axis the note asks for", () => {
    const axis = buildRows(44100).filter((r) => r.group === "one-frame");
    expect(new Set(axis.map((r) => r.sourceRate))).toEqual(new Set([48000, 44100]));
    expect(new Set(axis.map((r) => r.seconds))).toEqual(new Set([0.9, 2, 4]));
    expect(new Set(axis.map((r) => r.bpm))).toEqual(new Set([120, 137]));
  });
  it("gives every row proves-something and every row but the disabled controls latency-as-expected", () => {
    for (const r of buildRows(48000)) {
      expect(r.invariants, r.id).toContain("proves-something");
      if (r.id.startsWith("control-disabled-")) expect(r.invariants, r.id).not.toContain("latency-as-expected");
      else expect(r.invariants, r.id).toContain("latency-as-expected");
    }
  });
  it("repeats every none and compressor-track row", () => {
    for (const r of buildRows(48000)) {
      const repeated = r.latencyCase === "none" || r.latencyCase === "compressor-track";
      expect(r.repeat, r.id).toBe(repeated);
      expect(r.invariants.includes("repeat-identical"), r.id).toBe(repeated);
    }
  });
  it("reads stems against a bed mix, and only these rows, the control and the gap's stem rows carry the bed", () => {
    const rows = buildRows(48000);
    const bed = rows.filter((r) => r.withBed).map((r) => r.group + ":" + r.path);
    expect(new Set(bed)).toEqual(new Set(["stems:step-one", "stems:stems-fx", "stems:stems-dry", "stems:stems-sends",
      "stems:stems-metronome", "stems:stems-start", "stems:stems-section-loop", "control:step-one",
      "tail:stems-single-step", "tail:stems-single-start", "tail:step-one", "tail:start"]));
    rows.filter((r) => ["stems-fx", "stems-dry", "stems-sends", "stems-metronome"].includes(r.path))
      .forEach((r) => expect(r.referenceId, r.id).toMatch(/^mix-/));
  });
  it("reads the studio's stem route against the stepped stems of the same case", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      expect(rows.filter((r) => r.group === "stems").length, String(rate)).toBe(4 * 7);
      for (const latencyCase of ["none", "autotune-muted", "compressor-track", "compressor-muted"]) {
        for (const path of ["stems-start", "stems-section-loop"]) {
          const row = rows.find((r) => r.id === `stems-${latencyCase}-${path}`)!;
          expect(row.path).toBe(path);
          expect(row.group).toBe("stems");
          expect(row.withBed, row.id).toBe(true);
          expect(row.referenceId, row.id).toBe(`stems-${latencyCase}-stems-fx`);
          expect(row.invariants, row.id).toEqual(expect.arrayContaining(["proves-something", "latency-as-expected", "section-is-slice"]));
          expect(row.invariants, row.id).not.toContain("stems-sum-to-mix");
          expect([row.rangeStartSeconds, row.rangeSeconds], row.id).toEqual([0, row.seconds]);
        }
      }
    }
  });
  it("starts the section windows where the brief puts them", () => {
    const rows = buildRows(48000);
    const marker = rows.find((r) => r.id === "core-none-section-marker")!;
    const last = rows.find((r) => r.id === "core-none-section-marker-last")!;
    expect([marker.rangeStartSeconds, marker.rangeSeconds]).toEqual([1, 2]);
    expect([last.rangeStartSeconds, last.rangeSeconds]).toEqual([3, 1]);
  });
  it("reads a loop on the copy against the loop's pattern, never the unlooped reference's hits", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate).filter((r) => r.path === "loop-on-copy");
      expect(rows.length).toBe(4);
      rows.forEach((r) => {
        expect(r.invariants, r.id).toContain("impulse-follows-loop");
        expect(r.invariants, r.id).not.toContain("impulse-on-reference");
        expect(r.referenceId, r.id).toMatch(/^core-.*-step-one$/);
      });
      buildRows(rate).filter((r) => r.path !== "loop-on-copy")
        .forEach((r) => expect(r.invariants, r.id).not.toContain("impulse-follows-loop"));
    }
    expect(LOOP_ON_COPY_SECONDS).toBe(2);
  });
  it("holds every exact-range path with no slice to its frames, and no other", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      const held = rows.filter((r) => r.invariants.includes("frames-as-expected"));
      for (const r of rows) {
        const exact = r.path === "step-loop-twice" || r.group === "sweep"
          || (r.path.startsWith("bounce-") && r.path !== "bounce-tail")
          || ["stems-fx", "stems-dry", "stems-sends", "stems-metronome", "stems-single-step"].includes(r.path);
        expect(held.includes(r), r.id).toBe(exact);
      }
      expect(held.filter((r) => r.group === "bounce")).toHaveLength(20);
      expect(rows.find((r) => r.id === "tail-none-bounce-tail")!.invariants).not.toContain("frames-as-expected");
      expect(rows.find((r) => r.id === "tail-none-bounce-pre-fader")!.invariants).toContain("frames-as-expected");
      expect(rows.find((r) => r.id === "stems-none-stems-start")!.invariants).not.toContain("frames-as-expected");
    }
  });
  it("expects a loop's pass in whole ppqn, as its render computes it, and the range's frames elsewhere", () => {
    const of = (rate: number, id: string) => expectedFrames(buildRows(rate).find((r) => r.id === id)!, rate);
    expect(of(48000, "one-frame-none-step-loop-twice-48000-0p9-137")).toBe(43204);
    expect(of(44100, "one-frame-none-step-loop-twice-48000-0p9-137")).toBe(39694);
    expect(of(48000, "one-frame-none-step-loop-twice-48000-0p9-120")).toBe(43200);
    expect(of(44100, "core-none-step-loop-twice")).toBe(176400);
    expect(of(48000, "bounce-none-bounce-loop")).toBe(192000);
    expect(of(48000, "tail-none-bounce-pre-fader")).toBe(9600);
  });
  it("carries a mix of three audible units so the summing order can reach the bits", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      const third = rows.filter((r) => r.withThird);
      expect(third.map((r) => r.id)).toEqual(["control-mix-three-units"]);
      const [row] = third;
      expect(row).toMatchObject({ group: "control", path: "step-one", withBed: true, masterMaximizer: false, latencyCase: "none", signal: "probe" });
      expect(row.invariants).toEqual(expect.arrayContaining(["proves-something", "latency-as-expected"]));
      expect(row.invariants).not.toContain("impulse-on-computed-frame");
      expect(row.invariants).not.toContain("impulse-on-reference");
    }
  });
  it("carries a Compressor that compresses, held to differ from the neutral one", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      const engaged = rows.filter((r) => r.engagedCompressor);
      expect(engaged.map((r) => r.id)).toEqual([
        "control-compressor-engaged", "control-bounce-tap-pre-fx", "control-bounce-tap-pre-fader", "control-bounce-tap-post-fader"]);
      const [row] = engaged;
      expect(row).toMatchObject({ group: "control", path: "step-one", latencyCase: "compressor-track", referenceId: "core-compressor-track-step-one" });
      expect(row.invariants).toContain("differs-from-reference");
    }
  });
  it("holds every bounce to samples, and a loop on the copy over its first pass", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      for (const r of rows.filter((x) => x.group === "bounce")) {
        expect(r.invariants, r.id).toContain(r.path === "bounce-loop" ? "samples-equal-warm-pass" : "section-is-slice");
      }
      for (const r of rows.filter((x) => x.path === "loop-on-copy")) expect(r.invariants, r.id).toContain("samples-equal-reference");
    }
  });
  it("proves the bounce's tap points on a device that acts and a fader that is not at 0 dB, each against the tap before it", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      const byId = (id: string) => rows.find((r) => r.id === id)!;
      const taps = [
        ["control-bounce-tap-pre-fx", "bounce-pre-fx", "core-none-step-one", "section-is-slice"],
        ["control-bounce-tap-pre-fader", "bounce-pre-fader", "control-bounce-tap-pre-fx", "differs-from-reference"],
        ["control-bounce-tap-post-fader", "bounce-post-fader", "control-bounce-tap-pre-fader", "differs-from-reference"]
      ] as const;
      for (const [id, path, referenceId, invariant] of taps) {
        const row = byId(id);
        expect(row).toMatchObject({ group: "control", path, referenceId, latencyCase: "compressor-track", engagedCompressor: true, volumeDb: -6 });
        expect(row.invariants, id).toContain(invariant);
        expect(rows.indexOf(byId(referenceId)), id).toBeLessThan(rows.indexOf(row));
      }
      expect(rows.filter((r) => r.volumeDb !== 0).map((r) => r.id)).toEqual(taps.map(([id]) => id));
    }
  });
  it("has 296 rows at each rate", () => {
    expect(buildRows(48000)).toHaveLength(296);
    expect(buildRows(44100)).toHaveLength(296);
  });
  it("labels the one frame only where it was measured", async () => {
    const { findingFor, NO_EVIDENCE } = await import("./exportRegressionFindings.ts");
    const row = buildRows(44100).find((r) => r.id === "core-none-section-loop-twice")!;
    const one = { ...NO_EVIDENCE, earlyFrames: 1, warmHolds: () => true };
    expect(findingFor(row, "impulse-on-reference", 44100, one)?.name).toBe("loop-pass-one-frame-short");
    expect(findingFor(row, "impulse-on-reference", 48000, one)).toBeNull();
    expect(findingFor(row, "section-is-slice", 44100, one)).toBeNull();
    expect(findingFor(row, "no-jump", 44100, one)).toBeNull();
  });
});

describe("setPositionStart", () => {
  it("throws on a non-finite start, which would otherwise never find a frame", () => {
    for (const seconds of [NaN, Infinity, -Infinity]) {
      expect(() => setPositionStart(seconds, 120, 48000, true), String(seconds)).toThrow("ppqn");
    }
  });
  it("lands a whole multiple of 128 frames at 48 kHz on quantum, and off it when asked", () => {
    const on = setPositionStart(1, 120, 48000, true);
    expect(on.offQuantumFrames).toBe(0);
    expect(Number.isInteger(on.ppqn)).toBe(true);
    expect(on.ppqn).toBeGreaterThanOrEqual(1920);
    expect(setPositionStart(1, 120, 48000, false).offQuantumFrames).toBeGreaterThan(0);
  });
  it("lands a whole multiple of 128 frames at 44.1 kHz", () => {
    const { ppqn, offQuantumFrames } = setPositionStart(1, 120, 44100, true);
    const frame = ppqn * 60 / (960 * 120) * 44100;
    expect(offQuantumFrames).toBe(0);
    expect(Math.abs(frame / 128 - Math.round(frame / 128))).toBeLessThan(1e-9);
    expect(setPositionStart(1, 120, 44100, false).ppqn).toBe(ppqn + 1);
  });
  it("starts each setposition row at its own frame", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate).filter((r) => r.path.startsWith("setposition-"));
      expect(rows.length).toBe(8);
      rows.forEach((r) => {
        expect(r.rangeStartSeconds, r.id).toBeGreaterThan(0);
        expect(r.rangeStartSeconds + r.rangeSeconds, r.id).toBeCloseTo(r.seconds, 9);
        // what the render path recomputes from the same constant, and refuses to run on if the two drift apart
        const { ppqn } = setPositionStart(SET_POSITION_SECONDS, r.bpm, rate, r.path === "setposition-on-quantum");
        expect(ppqn / (16 * r.bpm), r.id).toBeCloseTo(r.rangeStartSeconds, 9);
      });
    }
  });
});

describe("the warm pass", () => {
  it("gives every section-loop-twice row a warm and a cold reference, each rendering first", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const index = new Map(rows.map((r, i) => [r.id, i]));
      const looped = rows.filter((r) => r.path === "section-loop-twice");
      expect(looped.length).toBe(11 + 2 + 12);
      for (const row of looped) {
        const warm = byId.get(row.warmReferenceId!)!;
        const cold = byId.get(row.referenceId!)!;
        expect(warm.path, row.id).toBe("step-loop-twice");
        expect(cold.path, row.id).toBe("step-one");
        expect(index.get(warm.id)!, row.id).toBeLessThan(index.get(row.id)!);
        expect(index.get(cold.id)!, row.id).toBeLessThan(index.get(row.id)!);
        const same = (r: typeof row) => [r.latencyCase, r.signal, r.sourceRate, r.seconds, r.bpm, r.group, r.masterMaximizer, r.withBed, r.rangeStartSeconds, r.rangeSeconds];
        expect(same(warm), row.id).toEqual(same(row));
        expect(row.invariants, row.id).toContain("samples-equal-warm-pass");
        expect(row.invariants, row.id).not.toContain("section-is-slice");
      }
    }
  });

  it("holds the probe's loop rows to the cold reference's impulses, which is what reads a shift", () => {
    const looped = buildRows(48000).filter((r) => r.path === "section-loop-twice" && r.signal === "probe");
    expect(looped.length).toBe(11 + 12);
    looped.forEach((r) => expect(r.invariants, r.id).toContain("impulse-on-reference"));
  });

  it("has one step-loop-twice row per section-loop-twice row, judged by the row that reads it", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate).filter((r) => r.path === "step-loop-twice");
      expect(rows.length).toBe(11 + 2 + 12);
      for (const row of rows) {
        expect(row.referenceId, row.id).toBeNull();
        expect(row.warmReferenceId, row.id).toBeNull();
        expect(row.invariants.filter((i) => i !== "repeat-identical"), row.id).toEqual(["proves-something", "latency-as-expected", "frames-as-expected"]);
      }
    }
  });

  it("leaves every other row without a warm reference", () => {
    buildRows(48000).filter((r) => r.path !== "section-loop-twice" && r.path !== "bounce-loop").forEach((r) => {
      expect(r.warmReferenceId, r.id).toBeNull();
      expect(r.invariants, r.id).not.toContain("samples-equal-warm-pass");
    });
  });
});

describe("the long tail rows", () => {
  it("hold an entire-song render and a start to the 4 s reference, so a render cut short fails", () => {
    const rows = buildRows(48000);
    for (const [id, path] of [["tail-none-section-entire-long", "section-entire"], ["tail-none-start-long", "start"]] as const) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.path, id).toBe(path);
      expect(row.signal, id).toBe("tail");
      expect([row.seconds, row.rangeSeconds, row.rangeStartSeconds], id).toEqual([4, 4, 0]);
      expect(row.referenceId, id).toBe("tail-none-step-one");
      expect(row.invariants, id).toEqual(expect.arrayContaining(["proves-something", "latency-as-expected", "section-is-slice"]));
    }
  });
});

describe("the gap rows", () => {
  const GAP_IDS = [
    "gap-none-step-one", "gap-none-start", "gap-none-section-entire",
    "gap-none-stem-step", "gap-none-stem-start", "gap-none-stem-mix", "gap-none-stem-mix-start"
  ];

  it("put a second 200 ms region of the same source at 16 s, and only these rows have one", () => {
    for (const rate of [48000, 44100]) {
      const rows = buildRows(rate);
      expect(rows.filter((r) => r.secondRegionSeconds !== null).map((r) => r.id), String(rate)).toEqual(GAP_IDS);
      for (const row of rows.filter((r) => GAP_IDS.includes(r.id))) {
        expect(row.group, row.id).toBe("tail");
        expect(row.signal, row.id).toBe("tail");
        expect(row.latencyCase, row.id).toBe("none");
        expect([row.seconds, row.rangeStartSeconds, row.secondRegionSeconds], row.id).toEqual([0.2, 0, 16]);
      }
    }
  });

  it("step over the 18 s span for the reference, and render it first", () => {
    const rows = buildRows(48000);
    const reference = rows.findIndex((r) => r.id === "gap-none-step-one");
    expect(rows[reference].path).toBe("step-one");
    expect(rows[reference].rangeSeconds).toBe(18);
    expect(rows[reference].referenceId).toBeNull();
    for (const [id, path] of [["gap-none-start", "start"], ["gap-none-section-entire", "section-entire"]] as const) {
      const index = rows.findIndex((r) => r.id === id);
      expect(index, id).toBeGreaterThan(reference);
      expect(rows[index].path, id).toBe(path);
      expect(rows[index].referenceId, id).toBe("gap-none-step-one");
      expect(rows[index].invariants, id).toContain("section-is-slice");
    }
  });

  it("hold the two render paths to the end of the second region, so they judge the gap and not the silence after it", () => {
    const rows = buildRows(48000);
    for (const id of ["gap-none-start", "gap-none-section-entire"]) {
      expect(rows.find((r) => r.id === id)!.rangeSeconds, id).toBeCloseTo(16.2, 9);
    }
  });

  describe("through a single stem", () => {
    const rowOf = (rate: number, id: string) => buildRows(rate).find((r) => r.id === id)!;
    const STEM_PROJECT_IDS = ["gap-none-stem-step", "gap-none-stem-start", "gap-none-stem-mix", "gap-none-stem-mix-start"];

    it("step the source's stem over the 18 s span for the reference, and render it before the row that reads it", () => {
      for (const rate of [48000, 44100]) {
        const rows = buildRows(rate);
        const reference = rowOf(rate, "gap-none-stem-step");
        expect(reference.path).toBe("stems-single-step");
        expect(reference.rangeSeconds).toBe(18);
        expect(reference.referenceId).toBeNull();
        expect(reference.invariants).toEqual(expect.arrayContaining(["proves-something", "latency-as-expected", "frames-as-expected"]));
        // rowOf builds its own catalogue, so the order is read by id: indexOf would find nothing and always pass
        expect(rows.findIndex((r) => r.id === "gap-none-stem-start")).toBeGreaterThan(rows.findIndex((r) => r.id === reference.id));
      }
    });

    it("hold `start` to the second region's end, as the mix's gap rows are", () => {
      const row = rowOf(48000, "gap-none-stem-start");
      expect(row.path).toBe("stems-single-start");
      expect(row.rangeSeconds).toBeCloseTo(16.2, 9);
      expect(row.referenceId).toBe("gap-none-stem-step");
      expect(row.invariants).toEqual(expect.arrayContaining(["proves-something", "latency-as-expected", "section-is-slice"]));
    });

    it("carry a bed that outlasts the span, not one as short as the 200 ms source", () => {
      for (const id of STEM_PROJECT_IDS) {
        const row = rowOf(48000, id);
        expect(row.withBed, id).toBe(true);
        expect(row.bedSeconds, id).toBe(18);
      }
      expect(buildRows(48000).filter((r) => r.bedSeconds !== null).map((r) => r.id).sort())
        .toEqual(["gap-none-stem-mix", "gap-none-stem-mix-start", "gap-none-stem-start", "gap-none-stem-step"]);
    });

    it("show that same project's mix over the same span: what the stem's render cannot show", () => {
      const row = rowOf(48000, "gap-none-stem-mix");
      expect(row.path).toBe("step-one");
      expect(row.rangeSeconds).toBe(18);
      expect(row.referenceId).toBeNull();
    });

    it("hold that mix through `start` to the same 16.2 s against the stepped mix, the positive control of the stem's short render", () => {
      for (const rate of [48000, 44100]) {
        const rows = buildRows(rate);
        const row = rowOf(rate, "gap-none-stem-mix-start");
        expect(row.path).toBe("start");
        expect(row.rangeSeconds).toBe(rowOf(rate, "gap-none-stem-start").rangeSeconds);
        expect(row.referenceId).toBe("gap-none-stem-mix");
        expect(row.invariants).toEqual(expect.arrayContaining(["proves-something", "latency-as-expected", "section-is-slice"]));
        expect(rows.findIndex((r) => r.id === row.id)).toBeGreaterThan(rows.findIndex((r) => r.id === "gap-none-stem-mix"));
      }
    });

    it("are one project: only what a render does with it differs, or the control would prove nothing about the stem", () => {
      const project = ({ signal, sourceRate, seconds, bpm, latencyCase, rangeStartSeconds, secondRegionSeconds, withBed, bedSeconds, withThird, masterMaximizer, disabledDevice, nudgeVolume, engagedCompressor, volumeDb }: ReturnType<typeof rowOf>) =>
        ({ signal, sourceRate, seconds, bpm, latencyCase, rangeStartSeconds, secondRegionSeconds, withBed, bedSeconds, withThird, masterMaximizer, disabledDevice, nudgeVolume, engagedCompressor, volumeDb });
      for (const rate of [48000, 44100]) {
        const expected = project(rowOf(rate, "gap-none-stem-start"));
        for (const id of STEM_PROJECT_IDS) expect(project(rowOf(rate, id)), `${id} at ${rate}`).toEqual(expected);
      }
    });
  });
});

describe("the tail rows", () => {
  it("end their region inside the burst wherever a tail is judged, so something still rings there", () => {
    const judged = buildRows(48000).filter((r) => r.invariants.includes("tail-present") || r.invariants.includes("tail-absent"));
    expect(judged.map((r) => r.id)).toEqual(["tail-none-section-entire", "tail-none-bounce-tail", "tail-none-bounce-pre-fader"]);
    for (const row of judged) {
      expect(row.rangeSeconds, row.id).toBe(row.seconds);
      expect(row.seconds, row.id).toBeLessThanOrEqual(0.2);
    }
  });
});

describe("selectRows", () => {
  const catalogue = buildRows(48000);

  it("takes the whole catalogue with no filter", () => {
    expect(selectRows(catalogue, { rows: null, group: null })).toEqual(catalogue);
  });

  it("runs what a group's rows read against, in catalogue order", () => {
    const ids = selectRows(catalogue, { rows: null, group: "control" }).map((r) => r.id);
    expect(ids).toEqual([
      "core-none-step-one", "core-compressor-track-step-one", "control-nudged", "control-disabled-compressor-track",
      "control-disabled-fold-muted", "control-master-maximizer", "control-mix-three-units", "control-compressor-engaged",
      "control-bounce-tap-pre-fx", "control-bounce-tap-pre-fader", "control-bounce-tap-post-fader",
    ]);
  });

  it("follows a reference of a reference and a no-latency reference", () => {
    const ids = selectRows(catalogue, { rows: "core-fold-muted-section-entire", group: null }).map((r) => r.id);
    expect(ids).toEqual(["core-none-step-one", "core-fold-muted-step-one", "core-fold-muted-section-entire"]);
  });

  it("follows a warm reference", () => {
    const ids = selectRows(catalogue, { rows: "core-none-section-loop-twice", group: null }).map((r) => r.id);
    expect(ids).toEqual(["core-none-step-one", "core-none-step-loop-twice", "core-none-section-loop-twice"]);
  });

  it("refuses what it cannot name", () => {
    expect(() => selectRows(catalogue, { rows: "control-nudged,no-such-row", group: null })).toThrow(/no-such-row/);
    expect(() => selectRows(catalogue, { rows: null, group: "no-such-group" })).toThrow(/no-such-group/);
    expect(() => selectRows(catalogue, { rows: "", group: null })).toThrow(/names no row/);
    expect(() => selectRows(catalogue, { rows: "control-nudged", group: "control" })).toThrow(/one of/);
  });

  it("finds every row's references before the row, so a run in catalogue order can read them", () => {
    for (const rate of [48000, 44100]) {
      const seen = new Set<string>();
      for (const row of buildRows(rate)) {
        for (const id of [row.referenceId, row.noLatencyReferenceId]) {
          if (id !== null) expect(seen.has(id), `${row.id} reads ${id}`).toBe(true);
        }
        seen.add(row.id);
      }
    }
  });
});

describe("lastReaders", () => {
  it("gives each referenced row the index of the last row reading it, and leaves out the rest", () => {
    const rows = selectRows(buildRows(48000), { rows: null, group: "control" });
    const last = lastReaders(rows);
    expect(last.get("core-none-step-one")).toBe(rows.findIndex((r) => r.id === "control-bounce-tap-pre-fx"));
    expect(last.get("control-bounce-tap-pre-fader")).toBe(rows.findIndex((r) => r.id === "control-bounce-tap-post-fader"));
    expect(last.has("control-nudged")).toBe(false);
  });

  it("counts a warm reference as read", () => {
    const rows = selectRows(buildRows(48000), { rows: "core-none-section-loop-twice", group: null });
    expect(lastReaders(rows).get("core-none-step-loop-twice")).toBe(2);
  });
});
