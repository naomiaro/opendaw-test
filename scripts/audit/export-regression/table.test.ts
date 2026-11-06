import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acceptPath, compareDeviceRates, formatRows, hashSamples, parseArgs, runLine } from "./table.ts";
import { sha256OfSamples } from "../../../src/lib/audit/exportRegressionReader.ts";
import { encodeFloatWav } from "../../../src/lib/audit/exportRegressionWav.ts";
import { buildRows } from "../../../src/lib/audit/exportRegressionRows.ts";
import { wavFileName, type ExportSummary, type RowRecord } from "../../../src/lib/audit/exportRegressionArtifacts.ts";

const SCRIPT = resolve(import.meta.dirname, "table.ts");
const samples = [Float32Array.from([0, 0.5, -0.25, 1]), Float32Array.from([0.125, 0, 0, -1])];

const record = (over: Partial<RowRecord> = {}): RowRecord => ({
  id: "a", label: "A", group: "core", read: {
    hash: "0123456789abcdef", frames: 4, channels: 2, peak: 1, nonFinite: 0, impulseHits: [1],
    largestStep: { step: 0.1, frame: 1 }, energyPastRange: null
  }, reportedLatencyFrames: 0, invariants: [{ invariant: "proves-something", holds: true, detail: "", finding: null }], register: "unregistered", shiftFrames: null, standing: "clean",
  wavUploaded: true, error: null, renderMs: 5, ...over
});
const summary = (rows: RowRecord[], over: Partial<ExportSummary> = {}): ExportSummary => ({
  schemaVersion: 1, runToken: 7, userAgent: "ua", sdkVersion: "0.0.182", engineWasmSha256: "e".repeat(64), sampleRate: 48000,
  uuidOrder: "ascending", rowsParam: "all", fill: false, registerSdkVersion: null, latencyReads: [], deviceRateHz: null, rows, ...over
});

/** A scratch tree with the summary, and the WAV of each row id in `wavs`; returns the root and a library path. */
const scratch = (s: ExportSummary, wavs: Record<string, readonly Float32Array[]> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "exportreg-"));
  const library = join(root, "library");
  mkdirSync(library);
  mkdirSync(join(root, ".verify-output"));
  writeFileSync(join(root, ".verify-output", `exportreg-summary-${s.runToken}.json`), JSON.stringify(s));
  for (const [id, channels] of Object.entries(wavs)) {
    writeFileSync(join(root, ".verify-output", wavFileName(s.runToken, id)), new Uint8Array(encodeFloatWav(channels, s.sampleRate)));
  }
  return { root, library };
};
const run = (root: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, EXPORT_REGRESSION_ROOT: root, EXPORT_WAV_LIBRARY: "", ...env }
  });

describe("hashSamples", () => {
  it("agrees with the page reader's sha256OfSamples", async () => {
    expect(hashSamples(samples)).toBe(await sha256OfSamples(samples));
  });
});

describe("parseArgs", () => {
  it("reads --compare-device with two tokens, and refuses it beside other work", () => {
    expect(parseArgs(["--compare-device", "1", "2"], {}).compareDevice).toEqual(["1", "2"]);
    expect(() => parseArgs(["--compare-device", "1"], {})).toThrow(/two/);
    expect(() => parseArgs(["--compare-device", "1", "2", "--accept"], {})).toThrow(/combine/);
  });
  it("reads the token, flags and values", () => {
    expect(parseArgs(["17", "--accept", "--force", "--library", "/x/lib"], {}))
      .toEqual({ token: "17", accept: true, force: true, diff: undefined, library: "/x/lib" });
    expect(parseArgs(["--diff", "row"], {})).toMatchObject({ token: undefined, accept: false, diff: "row" });
  });
  it("takes the library from the environment, and is null when nothing resolves", () => {
    expect(parseArgs([], { EXPORT_WAV_LIBRARY: "/e/lib" }).library).toBe("/e/lib");
    expect(parseArgs([], {}, "/nonexistent/root/x").library).toBeNull();
  });
  it("refuses an unknown flag and a flag without its value", () => {
    expect(() => parseArgs(["--acept"], {})).toThrow('unknown flag "--acept"');
    expect(() => parseArgs(["--library"], {})).toThrow(/needs a value/);
  });
  it("refuses two tokens, and --accept with --diff, instead of choosing one", () => {
    expect(() => parseArgs(["7", "8"], {})).toThrow(/one run token/);
    expect(() => parseArgs(["7", "--accept", "--diff", "a"], {})).toThrow(/--accept.*--diff/);
  });
});

describe("acceptPath", () => {
  it("ends in register/<rate>.json", () => {
    expect(acceptPath(48000)).toMatch(/debug\/2026-11-06-export-regression\/register\/48000\.json$/);
  });
});

describe("formatRows and runLine", () => {
  it("prints id, standing, register, hash prefix, frames, latency and the failing invariants", () => {
    const failing = record({
      id: "b", standing: "known-finding", register: "changed", shiftFrames: -1, reportedLatencyFrames: 64,
      invariants: [{ invariant: "section-is-slice", holds: false, detail: "", finding: "loop-pass-one-frame-short" }]
    });
    expect(formatRows(summary([record(), failing]))).toEqual([
      "a | clean | unregistered | 0123456789 | 4 | 0 | -",
      "b | known-finding | changed shift -1 | 0123456789 | 4 | 64 | section-is-slice (loop-pass-one-frame-short)"
    ]);
  });
  it("counts the three standings and the errored on the run line", () => {
    const line = runLine(summary([record(), record({ standing: "known-finding" }), record({ standing: "failing" }),
      record({ standing: "errored", error: "x", read: null })]));
    expect(line).toContain("clean 1, known finding 1, failing 1, errored 1");
    expect(line).toContain("sdk 0.0.182");
    expect(line).toContain("engine eeeeeeeeeeee");
  });
});

describe("the device rate on the run line", () => {
  it("prints the rate, or unknown", () => {
    expect(runLine(summary([record()], { deviceRateHz: 44100 }))).toContain("| device 44100 Hz |");
    expect(runLine(summary([record()]))).toContain("| device unknown |");
  });
});

describe("compareDeviceRates", () => {
  const at = (device: number | null, hashes: Record<string, string>, over: Partial<ExportSummary> = {}) =>
    summary(Object.entries(hashes).map(([id, hash]) => record({ id, read: { ...record().read!, hash } })),
      { deviceRateHz: device, ...over });
  it("counts identical rows and succeeds when none differ", () => {
    const result = compareDeviceRates(at(44100, { a: "h1", b: "h2" }, { runToken: 1 }), at(48000, { a: "h1", b: "h2" }, { runToken: 2 }));
    expect(result.differing).toBe(0);
    expect(result.lines).toEqual(["device rates 44100 and 48000: 2 of 2 rows identical"]);
  });
  it("names each differing row with both hashes", () => {
    const result = compareDeviceRates(at(44100, { a: "h1", b: "h2" }), at(48000, { a: "h1", b: "h3" }));
    expect(result.differing).toBe(1);
    expect(result.lines).toEqual(["b | h2 | h3", "device rates 44100 and 48000: 1 of 2 rows identical"]);
  });
  it("counts a row missing from one run, or errored, as differing", () => {
    const errored = record({ id: "b", read: null, error: "x", standing: "errored" });
    const result = compareDeviceRates(at(44100, { a: "h1", b: "h2" }), summary([record({ id: "a", read: { ...record().read!, hash: "h1" } }), errored], { deviceRateHz: 48000 }));
    expect(result.lines[0]).toBe("b | h2 | -");
    const missing = compareDeviceRates(at(44100, { a: "h1", b: "h2" }), at(48000, { a: "h1" }));
    expect(missing.lines[0]).toBe("b | h2 | -");
  });
  it("refuses a page-rate mismatch, equal device rates and an unknown device rate", () => {
    expect(() => compareDeviceRates(at(44100, { a: "h" }), at(48000, { a: "h" }, { sampleRate: 44100 }))).toThrow(/page rate/);
    expect(() => compareDeviceRates(at(44100, { a: "h" }), at(44100, { a: "h" }))).toThrow(/equal/);
    expect(() => compareDeviceRates(at(44100, { a: "h" }), at(null, { a: "h" }))).toThrow(/unknown/);
  });
});

describe("the script", () => {
  const good = () => {
    const hash = hashSamples(samples);
    const s = summary([record({ read: { ...record().read!, hash } })]);
    return { s, hash, ...scratch(s, { a: samples }) };
  };

  it("--compare-device exits 0 on identical hashes and 1 on a differing row, writing nothing", () => {
    const withHash = (token: number, device: number, hash: string) =>
      summary([record({ read: { ...record().read!, hash } })], { runToken: token, deviceRateHz: device });
    const { root } = scratch(withHash(1, 44100, "h1"));
    writeFileSync(join(root, ".verify-output", "exportreg-summary-2.json"), JSON.stringify(withHash(2, 48000, "h1")));
    writeFileSync(join(root, ".verify-output", "exportreg-summary-3.json"), JSON.stringify(withHash(3, 48000, "h9")));
    const same = run(root, ["--compare-device", "1", "2"]);
    expect(same.status).toBe(0);
    expect(same.stdout).toContain("device rates 44100 and 48000: 1 of 1 rows identical");
    const differ = run(root, ["--compare-device", "1", "3"]);
    expect(differ.status).toBe(1);
    expect(differ.stdout).toContain("a | h1 | h9");
    expect(differ.stdout).toContain("0 of 1 rows identical");
    expect(existsSync(join(root, "debug"))).toBe(false);
  });

  it("--accept writes the register and copies the WAV by hash", () => {
    const { s, hash, root, library } = good();
    const result = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(result.status).toBe(0);
    expect(existsSync(join(library, "wav", `${hash}.wav`))).toBe(true);
    const register = JSON.parse(readFileSync(acceptPath(s.sampleRate, root), "utf8"));
    expect(register.rows.a).toMatchObject({ hash, wav: `wav/${hash}.wav` });
    expect(result.stdout).toContain("git -C");
  });

  it("a second accept of the same run copies nothing", () => {
    const { root, library } = good();
    run(root, ["7", "--accept", "--force", "--library", library]);
    const again = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("0 WAV(s) copied");
    expect(again.stdout).toContain("no differences");
  });

  it("verifies a WAV's samples hash before copying it, and writes nothing", () => {
    const s = summary([record({ read: { ...record().read!, hash: "f".repeat(64) } })]);
    const { root, library } = scratch(s, { a: samples });
    const result = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nothing written");
    expect(existsSync(join(library, "wav"))).toBe(false);
    expect(existsSync(acceptPath(s.sampleRate, root))).toBe(false);
  });

  it("refuses with no library when there is something to copy, naming how to set it", () => {
    const { s, root } = good();
    const result = run(root, ["7", "--accept", "--force"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--library");
    expect(result.stderr).toContain("EXPORT_WAV_LIBRARY");
    expect(existsSync(acceptPath(s.sampleRate, root))).toBe(false);
  });

  it("refuses a failing row, even forced, and writes nothing", () => {
    const s = summary([record({ standing: "failing", invariants: [{ invariant: "no-jump", holds: false, detail: "", finding: null }] })]);
    const { root, library } = scratch(s, { a: samples });
    const result = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no known finding");
    expect(existsSync(acceptPath(s.sampleRate, root))).toBe(false);
  });

  it("--diff reports figures against the accepted render, and says so when no library is present", () => {
    const { s, hash, root, library } = good();
    run(root, ["7", "--accept", "--force", "--library", library]);
    const moved = [Float32Array.from([0, 0, 0.5, -0.25]), samples[1]];
    const next = summary([record({ read: { ...record().read!, hash: "d".repeat(64) }, register: "changed" })], { runToken: 8 });
    writeFileSync(join(root, ".verify-output", "exportreg-summary-8.json"), JSON.stringify(next));
    writeFileSync(join(root, ".verify-output", wavFileName(8, "a")), new Uint8Array(encodeFloatWav(moved, 48000)));
    const withLibrary = run(root, ["8", "--diff", "a", "--library", library]);
    expect(withLibrary.status).toBe(0);
    expect(withLibrary.stdout).toMatch(/a: different, first differing frame 1, largest/);
    expect(existsSync(join(root, ".verify-output", "exportreg-diff-a-accepted.wav"))).toBe(true);
    expect(existsSync(join(root, ".verify-output", "exportreg-diff-a-new.wav"))).toBe(true);
    const without = run(root, ["8", "--diff", "a"]);
    expect(without.status).toBe(0);
    expect(without.stdout).toContain("no library");
    expect(hash).toBe(s.rows[0].read!.hash);
  });

  it("--accept without a run token is an error, writing nothing", () => {
    const { s, root, library } = good();
    const result = run(root, ["--accept", "--force", "--library", library]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run token");
    expect(existsSync(acceptPath(s.sampleRate, root))).toBe(false);
  });

  it("refuses a library that is not an existing directory, creating nothing", () => {
    const { s, root } = good();
    const missing = join(root, "no-such-library");
    const result = run(root, ["7", "--accept", "--force", "--library", missing]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not an existing directory");
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(acceptPath(s.sampleRate, root))).toBe(false);
  });

  it("refuses a held hash whose WAV the library lacks, naming the row, before any write", () => {
    const { s, hash, root, library } = good();
    run(root, ["7", "--accept", "--force", "--library", library]);
    rmSync(join(library, "wav", `${hash}.wav`));
    const before = readFileSync(acceptPath(s.sampleRate, root), "utf8");
    const result = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(/library lacks.*: a$/);
    expect(readFileSync(acceptPath(s.sampleRate, root), "utf8")).toBe(before);
  });

  it("says the library was not checked when none resolves, and prints a pending library", () => {
    const { root, library } = good();
    run(root, ["7", "--accept", "--force", "--library", library]);
    const unchecked = run(root, ["7", "--accept", "--force"]);
    expect(unchecked.status).toBe(0);
    expect(unchecked.stdout).toContain("library not checked");
    spawnSync("git", ["init", "-q", library]);
    const pending = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(pending.status).toBe(0);
    expect(pending.stdout).toContain("uncommitted changes under wav");
  });

  it("reports the register rows a full run drops, and does not call that no differences", () => {
    const { s, root, library } = good();
    const path = acceptPath(s.sampleRate, root);
    run(root, ["7", "--accept", "--force", "--library", library]);
    const register = JSON.parse(readFileSync(path, "utf8"));
    register.rows.z = { ...register.rows.a };
    writeFileSync(path, JSON.stringify(register));
    const result = run(root, ["7", "--accept", "--force", "--library", library]);
    expect(result.stdout).toContain("removed: z");
    expect(result.stdout).not.toContain("no differences");
  });

  it("refuses a WAV whose rate, channel count or frame count is not the row's", () => {
    const hash = hashSamples(samples);
    const base = record().read!;
    const cases: [string, RowRecord, number][] = [
      ["frames", record({ read: { ...base, hash, frames: 99 } }), 48000],
      ["channels", record({ read: { ...base, hash, channels: 1 } }), 48000],
      ["rate", record({ read: { ...base, hash } }), 44100]
    ];
    for (const [what, row, wavRate] of cases) {
      const s = summary([row]);
      const { root, library } = scratch(s);
      writeFileSync(join(root, ".verify-output", wavFileName(7, "a")), new Uint8Array(encodeFloatWav(samples, wavRate)));
      const result = run(root, ["7", "--accept", "--force", "--library", library]);
      expect(result.status, what).toBe(1);
      expect(result.stderr, what).toContain(what);
      expect(existsSync(acceptPath(s.sampleRate, root)), what).toBe(false);
    }
  });

  it("prints stale findings and the standing counts on the run line", () => {
    const rows = buildRows(44100).filter((r) => r.path === "section-loop-twice" && r.seconds === 4).map((r) => record({
      id: r.id, invariants: r.invariants.map((invariant) => ({ invariant, holds: true, detail: "", finding: null }))
    }));
    expect(rows.length).toBeGreaterThan(0);
    const { root } = scratch(summary(rows, { sampleRate: 44100 }));
    const result = run(root, []);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`clean ${rows.length}, known finding 0, failing 0, errored 0`);
    expect(result.stdout).toContain("no longer reproducing: loop-pass-one-frame-short");
  });
});
