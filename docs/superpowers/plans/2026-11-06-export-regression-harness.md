# Export Regression Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hand-run page that renders every SDK export path against the latency cases, judges each render by named invariants and against an accepted hash register, and keeps the accepted WAVs in a private LFS repo.

**Architecture:** Pure, Node-tested modules under `src/lib/audit/exportRegression*.ts` (rows, signals, reader, verdict, findings, artifacts, diff, WAV). Two browser-only modules build the project and drive the render paths. An unlisted page runs them and uploads a summary and changed WAVs to the dev server's `/__verify` sink. `scripts/audit/export-regression/table.ts` prints the table, compares sample by sample, and accepts into the register and the library. Model: the MIDI effect semantics audit.

**Tech Stack:** TypeScript strict, React + Radix for the page, vitest, `@opendaw/studio-core` `OfflineEngineRenderer` / `MixdownSection` / `AudioBounce`, Git LFS, Node ≥23 type stripping for the script.

**Spec:** `docs/superpowers/specs/2026-11-06-export-regression-harness-design.md`

## Global Constraints

- **Retrieve with XERJ before writing code against the SDK or engine, for each path and device**, and cite `project/file:line` in the commit body: `xerj code webdaw "<plain words>" --lang typescript|rust`, with `XERJ_DISABLE_FEEDBACK=true`. openDAW is AGPL: adapt the approach, never copy code. Never post to the XERJ tracker. Read upstream's `packages/studio/core-wasm/test/{stem-export,audio-bounce,delay-compensation,differential-audio}.test.ts` first (checkout path in `.claude/local.md`).
- Public repo: before every push, `git diff main | grep -iE 'moises|studio ?2'` (the `MoisesLogo` component aside) must come back empty. No session URLs in public text.
- `npm run typecheck` exits 0 before every commit. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit to `feat/export-regression-harness`.
- Modules the table script loads run under plain Node: value imports carry `.ts`, SDK imports are type-only. That covers `exportRegressionRows`, `Verdict`, `Findings`, `Artifacts`, `Diff` and `Wav`.
- Page rates 48000 and 44100. Render from a `project.copy()` and terminate it. `renderSection` writes to the project it gets. Wrap every await on a worker in `withDeadline` (`src/lib/deadline.ts`).
- Never edit under `src/` or `public/` during a browser run: Vite reloads the page. Start renders with a real click on Run. Reuse the running dev server (`https://localhost:5173`, check with `lsof -i :5173`).
- No allowance on positions: do not copy `readBaseline` / `MAX_BASELINE_FRAMES`. `src/lib/audit/sectionRenderGap.ts`'s `largestStep` and `toneStep` may be imported; `lagEstimate.ts`'s `bestLag` too.
- Only state current behaviour in `CLAUDE.md` and `documentation/`; version numbers live in `debug/` and `changelogs/`.
- Accepting a change is a person's read. The agent runs `--accept` only after the user has read that run's table.

## Review Focus

1. **`--accept` with a changed row whose WAV was never uploaded** (a run without the sink, a deleted `.verify-output`): refuse, name the rows, and write nothing, neither register nor library. Pinned in Task 5.
2. **A missing register:** the dev server and the public host answer a missing file with HTML and status 200, so every row must read `unregistered` and not crash. Pinned in Task 4.
3. **A hash change with no numeric difference** (`-0` against `0`, or NaN payloads): the diff must report `bit-only`, not "0 dB, first frame -1". Pinned in Task 2.
4. **A summary and a register that do not match** (44.1 kHz summary on the 48 kHz register, an old schema), and **a known-finding label that stopped failing** (a fix landing): the first is refused, the second is printed as `no longer reproduces`, never silently dropped. Pinned in Tasks 3 and 5.
5. **A row whose render throws or hangs, or a tail that never ends:** that row reads errored, the run goes on, and an errored row is never accepted. Pinned in Tasks 4 and 8.

---

### Task 1: Signals, ascending UUIDs and readers

**Files:**
- Create: `src/lib/audit/exportRegressionSignals.ts`, `src/lib/audit/exportRegressionSignals.test.ts`
- Create: `src/lib/audit/ascendingUuids.ts`, `src/lib/audit/ascendingUuids.test.ts`
- Create: `src/lib/audit/exportRegressionReader.ts`, `src/lib/audit/exportRegressionReader.test.ts`

**Interfaces:**
- Produces, in Signals: `IMPULSE_SOURCE_FRAMES: readonly number[]` = `[4096, 24037, 72064, 120037, 168064]`; `PROBE_TONE_HZ = 997`; `PROBE_TONE_LEVEL = 0.5`; `IMPULSE_LEVEL = 0.9`; `probeSource(sourceRate: number, seconds: number): [Float32Array, Float32Array]` (left a sine, right impulses on silence); `sweepSource(sourceRate, seconds): [Float32Array, Float32Array]` (log sweep 20 Hz to 20 kHz at 0.4, the same on both channels); `tailSource(sourceRate, seconds): [Float32Array, Float32Array]` (a 200 ms 440 Hz burst at 0.5 from the start, then silence); `bedSource(sourceRate, seconds): [Float32Array, Float32Array]` (220 Hz + 3329.6 Hz at 0.15 each, for the second unit in mix and stem rows); `hotSource(sourceRate, seconds): [Float32Array, Float32Array]` (a 997 Hz sine at 1.5 on both channels, so the master Maximizer must limit it).
- Produces, in `ascendingUuids.ts`: `type UuidNamespace = { generate: () => Uint8Array }`; `installUuidOrder(uuid: UuidNamespace, order: "ascending" | "descending"): void`; `assertUuidOrder(uuids: readonly Uint8Array[], order: "ascending" | "descending"): void`, which throws if the bytes are not strictly in that order.
- Produces, in Reader: `sha256OfSamples(channels: readonly Float32Array[]): Promise<string>` (lower-case hex, `crypto.subtle`, channels concatenated in order); `findImpulses(channel: Float32Array, threshold: number, minGapFrames: number): number[]` (the PEAK sample of each cluster over threshold); `computedFrame(sourceFrame: number, sourceRate: number, pageRate: number): number` (`Math.round(sourceFrame * pageRate / sourceRate)`); `readRender(channels: readonly Float32Array[], options: { rangeFrames: number; pageRate: number }): Promise<RenderRead>`; `RenderRead = { hash: string; frames: number; channels: number; peak: number; nonFinite: number; impulseHits: number[]; largestStep: { step: number; frame: number }; energyPastRange: number | null }`. `largestStep` leaves out 0.1 s at each end of the range, on channel 0. `impulseHits` reads channel 1 with threshold 0.05 and a gap of 1000 frames. `energyPastRange` is the RMS past `rangeFrames` on all channels, null when the render ends at the range.

- [ ] **Step 1: Write the failing tests**

```typescript
// exportRegressionSignals.test.ts
it("mixes impulses on a quantum boundary and off one", () => {
  expect(IMPULSE_SOURCE_FRAMES.filter((f) => f % 128 === 0)).toEqual([4096, 72064, 168064]);
  expect(IMPULSE_SOURCE_FRAMES.filter((f) => f % 128 !== 0)).toEqual([24037, 120037]);
});
it("puts one-sample impulses on the right channel and a sine on the left", () => {
  const [left, right] = probeSource(48000, 4);
  expect(left.length).toBe(192000);
  expect(right[4096]).toBeCloseTo(0.9, 6);
  expect(right[4095]).toBe(0);
  expect(right[4097]).toBe(0);
  expect(right.filter((s) => s !== 0).length).toBe(5);
  expect(Math.max(...left.subarray(0, 4800))).toBeCloseTo(0.5, 2);
});
it("drops impulses past the end of a short source", () => {
  expect(probeSource(48000, 0.9)[1].filter((s) => s !== 0).length).toBe(2);
});
it("drives the master Maximizer over its limit", () => {
  expect(Math.max(...hotSource(48000, 1)[0].subarray(0, 4800))).toBeGreaterThan(1.4);
});
it("sweeps the full range", () => {
  const [left] = sweepSource(48000, 4);
  const crossings = (from: number, to: number) => { let n = 0; for (let i = from + 1; i < to; i++) if (left[i - 1] < 0 !== left[i] < 0) n++; return n; };
  expect(crossings(0, 4800)).toBeLessThan(crossings(187200, 192000) / 50);
});

// ascendingUuids.test.ts
it("hands out strictly ascending, well-formed bytes", () => {
  const uuid = { generate: () => new Uint8Array(16) };
  installUuidOrder(uuid, "ascending");
  const [a, b] = [uuid.generate(), uuid.generate()];
  expect(a[6]).toBe(0x40);
  expect(a[8]).toBe(0x80);
  expect(a.buffer.byteLength).toBe(16);
  expect(UUID.Comparator(a, b)).toBeLessThan(0);
});
it("hands out strictly descending bytes on request", () => {
  const uuid = { generate: () => new Uint8Array(16) };
  installUuidOrder(uuid, "descending");
  expect(UUID.Comparator(uuid.generate(), uuid.generate())).toBeGreaterThan(0);
});
it("names a wrong order", () => {
  const uuid = { generate: () => new Uint8Array(16) };
  installUuidOrder(uuid, "descending");
  const list = [uuid.generate(), uuid.generate()];
  expect(() => assertUuidOrder(list, "ascending")).toThrow(/ascending/);
  expect(() => assertUuidOrder(list, "descending")).not.toThrow();
});

// exportRegressionReader.test.ts
it("reads the same hash for the same samples and another for one changed bit", async () => {
  const a = new Float32Array([0, 0.5]);
  const b = new Float32Array([-0, 0.5]);
  expect(await sha256OfSamples([a])).toBe(await sha256OfSamples([a.slice()]));
  expect(await sha256OfSamples([a])).not.toBe(await sha256OfSamples([b]));
});
it("finds an impulse's peak, not its first sample over the threshold", () => {
  const c = new Float32Array(3000);
  c[100] = 0.2; c[101] = 0.9; c[102] = 0.2; c[2000] = -0.8;
  expect(findImpulses(c, 0.05, 1000)).toEqual([101, 2000]);
});
it("computes a resampled frame", () => {
  expect(computedFrame(24037, 48000, 44100)).toBe(22084);
  expect(computedFrame(24037, 48000, 48000)).toBe(24037);
});
it("counts NaN and Infinity and reads energy past the range", async () => {
  const left = new Float32Array(96000); left[10] = NaN; left[11] = Infinity;
  const read = await readRender([left, new Float32Array(96000)], { rangeFrames: 48000, pageRate: 48000 });
  expect(read.nonFinite).toBe(2);
  expect(read.energyPastRange).toBe(0);
  expect((await readRender([left, left], { rangeFrames: 96000, pageRate: 48000 })).energyPastRange).toBeNull();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/audit/exportRegressionSignals.test.ts src/lib/audit/ascendingUuids.test.ts src/lib/audit/exportRegressionReader.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Implement the three modules**

`installUuidOrder` writes the counter big-endian into bytes 12-15, ascending from 1, descending from `0x7fffffff`; byte 6 is `0x40`, byte 8 is `0x80`; each call allocates its own 16-byte buffer (`UUID.toDataOutput` reads `uuid.buffer`). The caller casts `UUID` to `UuidNamespace`. `sweepSource`'s phase is the integral of an exponential frequency. `readRender` excludes non-finite samples from `peak`.

- [ ] **Step 4: Run them to see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/exportRegressionSignals* src/lib/audit/ascendingUuids* src/lib/audit/exportRegressionReader*
git commit -m "feat: export regression signals, ordered UUIDs and render reader"
```

### Task 2: WAV and sample diff

**Files:**
- Create: `src/lib/audit/exportRegressionWav.ts`, `src/lib/audit/exportRegressionWav.test.ts`
- Create: `src/lib/audit/exportRegressionDiff.ts`, `src/lib/audit/exportRegressionDiff.test.ts`

**Interfaces:**
- Produces: `encodeFloatWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer`; `decodeFloatWav(bytes: ArrayBuffer | Uint8Array): { sampleRate: number; channels: Float32Array[] }`, which throws on anything but format 3, 32-bit.
- Produces: `diffRenders(accepted: readonly Float32Array[], next: readonly Float32Array[]): RenderDiff`; `RenderDiff = { kind: "identical" | "bit-only" | "rounding-sized" | "different"; acceptedFrames: number; nextFrames: number; firstDifferingFrame: number | null; largestDifference: number; largestDifferenceDb: number | null; shiftFrames: number | null }`; `ROUNDING_DB = -100`.

- [ ] **Step 1: Write the failing tests**

```typescript
it("round-trips every bit through a WAV, NaN payload and negative zero included", () => {
  const left = new Float32Array([0, -0, 0.1, NaN, 1e-40]);
  const decoded = decodeFloatWav(encodeFloatWav([left, left], 44100));
  expect(decoded.sampleRate).toBe(44100);
  expect(new Uint8Array(decoded.channels[0].buffer)).toEqual(new Uint8Array(left.buffer));
});
it("refuses a 16-bit WAV", () => { /* a header with format 1, 16 bits */ expect(() => decodeFloatWav(pcm16)).toThrow(/32-bit float/); });

const ch = (...v: number[]) => new Float32Array(v);
it("reads identical", () => expect(diffRenders([ch(1, 2)], [ch(1, 2)]).kind).toBe("identical"));
it("reads a change of sign on zero as bit-only, with no figures", () => {
  const d = diffRenders([ch(0, 1)], [ch(-0, 1)]);
  expect(d.kind).toBe("bit-only");
  expect(d.firstDifferingFrame).toBe(0);
  expect(d.largestDifferenceDb).toBeNull();
});
it("labels a difference under -100 dB with no shift as rounding-sized", () => {
  const d = diffRenders([ch(0.5, 0.5, 0.5)], [ch(0.5, 0.5 + 1.2e-7, 0.5)]);
  expect(d.kind).toBe("rounding-sized");
  expect(d.firstDifferingFrame).toBe(1);
  expect(d.largestDifferenceDb!).toBeCloseTo(-138.4, 0);
});
it("reads a larger difference as different", () => expect(diffRenders([ch(0.5)], [ch(0.4)]).kind).toBe("different"));
it("reads a one-frame shift as different, whatever its size", () => {
  const impulse = (at: number) => { const c = new Float32Array(4000); c[at] = 1e-6; return c; };
  const d = diffRenders([impulse(2000)], [impulse(1999)]);
  expect(d.shiftFrames).toBe(-1);
  expect(d.kind).toBe("different");
});
it("compares a changed length over the shared frames and never throws", () => {
  const d = diffRenders([ch(1, 2, 3)], [ch(1, 2)]);
  expect(d.kind).toBe("different");
  expect(d.acceptedFrames).toBe(3);
  expect(d.nextFrames).toBe(2);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/audit/exportRegressionWav.test.ts src/lib/audit/exportRegressionDiff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Compare bit patterns (a `Uint32Array` view over each channel) to find the first differing frame, so NaN and `-0` count. `shiftFrames` is `bestLag` from `lagEstimate.ts` over the shared frames of channel 1 (the impulse channel, channel 0 when mono), maximum lag 256, null when the score is under 0.5. A differing frame count is `different`. `lagEstimate.ts` must stay importable under plain Node: check that it has no SDK value imports.

- [ ] **Step 4: Run them to see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/exportRegressionWav* src/lib/audit/exportRegressionDiff*
git commit -m "feat: float WAV codec and bit-exact render diff"
```

### Task 3: Row catalogue and known findings

**Files:**
- Create: `src/lib/audit/exportRegressionRows.ts`, `src/lib/audit/exportRegressionRows.test.ts`
- Create: `src/lib/audit/exportRegressionFindings.ts`, `src/lib/audit/exportRegressionFindings.test.ts`

**Interfaces:**
- Produces: `LatencyCaseId` = `"none" | "autotune-muted" | "compressor-track" | "compressor-muted" | "maximizer-muted" | "fold-muted" | "script-10ms-muted" | "script-150ms-parallel" | "compressor-bus" | "compressor-aux" | "several"`.
- Produces: `PathId` = `"step-one" | "step-chunked-whole" | "step-chunked-odd" | "step-reset" | "start" | "section-entire" | "section-loop-once" | "section-loop-twice" | "section-marker" | "section-marker-last" | "stems-fx" | "stems-dry" | "stems-sends" | "stems-metronome" | "bounce-pre-fx" | "bounce-pre-fader" | "bounce-post-fader" | "bounce-merge" | "bounce-loop" | "bounce-tail" | "setposition-on-quantum" | "setposition-off-quantum" | "loop-on-copy"`.
- Produces: `InvariantId` = `"samples-equal-reference" | "section-is-slice" | "impulse-on-reference" | "impulse-unmoved-by-latency" | "impulse-on-computed-frame" | "no-jump" | "muted-latent-unchanged" | "disabled-equals-absent" | "stems-sum-to-mix" | "repeat-identical" | "tail-present" | "tail-absent" | "proves-something" | "latency-as-expected" | "differs-from-reference"`.
- Produces: `ExportRow = { id: string; label: string; group: "core" | "master" | "stems" | "bounce" | "position" | "one-frame" | "tail" | "sweep" | "control"; latencyCase: LatencyCaseId; path: PathId; signal: "probe" | "sweep" | "tail" | "hot"; sourceRate: number; seconds: number; rangeStartSeconds: number; rangeSeconds: number; bpm: number; masterMaximizer: boolean; disabledDevice: boolean; nudgeVolume: boolean; withBed: boolean; repeat: boolean; referenceId: string | null; noLatencyReferenceId: string | null; invariants: InvariantId[] }`.
- Produces: `buildRows(pageRate: number): ExportRow[]`; `expectedLatencyFrames(latencyCase: LatencyCaseId, pageRate: number): number`.
- Produces: `KnownFinding = { name: string; invariant: InvariantId; note: string; applies: (row: ExportRow, pageRate: number) => boolean }`; `KNOWN_FINDINGS: readonly KnownFinding[]`; `findingFor(row: ExportRow, invariant: InvariantId, pageRate: number): KnownFinding | null`.

**The catalogue.** All rows default to `signal: "probe"`, `sourceRate: 48000`, `seconds: 4` (the source's length), `rangeStartSeconds: 0`, `rangeSeconds` equal to `seconds`, `bpm: 120`, `masterMaximizer: false`. `section-marker` covers 1 s to 3 s, `section-marker-last` 3 s to the end, and each `setposition-*` starts at its own frame, so a slice of the reference starts at `rangeStartSeconds`. Ids are `<group>-<latencyCase>-<path>`, with the axis values appended on `one-frame` rows, and match `/^[a-z0-9-]+$/`.
- **`core`:** every latency case × `step-one`, `step-chunked-whole` (375 quanta), `step-chunked-odd` (1000 frames), `step-reset`, `start`, `section-entire`, `section-loop-once`, `section-loop-twice`, `section-marker`, `section-marker-last`.
- **`stems`, `bounce`, `position`:** the cases `none`, `autotune-muted`, `compressor-track`, `compressor-muted` × each stems path, each bounce path, the two `setposition-*` paths and `loop-on-copy`. Stem rows have `withBed: true`, and their reference is a `mix-<case>-step-one` row (also `withBed`, in group `stems`), since the bed's signal would hide the impulses on any row that reads them. Only these rows and `control-master-maximizer` carry the bed.
- **`master`:** every project gets a master Maximizer, normal exports go through it, and it is the one device a version check saw change the sound (0.0.180 to 0.0.181, up to -19.5 dBFS, and only on rows over its limit). So `signal: "hot"`, `masterMaximizer: true`, the cases `none` and `compressor-track` × `step-one`, `step-chunked-whole`, `step-chunked-odd`, `step-reset`, `start`, `section-entire`, `section-loop-once`, `section-loop-twice`, `section-marker`. Plus a `master-<case>-bypass` row of each case (`masterMaximizer: false`, `step-one`): each `master-*-step-one` has that row as reference with `differs-from-reference`, so a limiter that stops engaging fails. The other paths' invariants as in `core`, except `no-jump` and the impulse invariants, since the limiter moves the level and the source has no impulses.
- **`one-frame`:** latency `none`, path `section-loop-twice` and `step-chunked-whole`, crossing `sourceRate` 48000 / 44100, `seconds` 0.9 / 2 / 4 and `bpm` 120 / 137. A row of the same axis values with `step-one` is its reference.
- **`tail`:** `signal: "tail"`, a Reverb on the source's unit, reference a `step-one` of the same chain: `section-entire` and `bounce-tail` (`tail-present`), `bounce-pre-fader` (`tail-absent`), and `section-marker`, whose range starts after the 200 ms of content has ended, with `section-is-slice` (a reverb still ringing into the range is what the reference holds: the missing-tail pin).
- **`sweep`:** `signal: "sweep"`, every latency case × `step-one`, `section-loop-once`.
- **`control`:** `control-nudged` (`nudgeVolume`: the source unit's volume 0.0001 dB, reference `core-none-step-one`, invariant `differs-from-reference`); `control-disabled` for `compressor-track` and `fold-muted` (the device present, `enabled` false, invariant `disabled-equals-absent`); `control-master-maximizer` (`masterMaximizer: true`, `withBed: true`, `step-one`).

**Invariants per path.** Every row has `proves-something` and `latency-as-expected`. `step-one`: `impulse-unmoved-by-latency` when the case is not `none`, `impulse-on-computed-frame` when `sourceRate === pageRate`, `no-jump` except on `compressor-aux` and `several` (their chain changes the sine's level), and `muted-latent-unchanged` on the cases hosted on the muted holder. `step-chunked-*`, `step-reset`: `samples-equal-reference`. `section-*` and `start`: `section-is-slice`, `impulse-on-reference`, `no-jump`. Stem paths: `stems-sum-to-mix` on `stems-fx`. A `*-tail` row and `section-entire` on `signal: "tail"`: `tail-present`; a tail-off row: `tail-absent`. `repeat: true` and `repeat-identical` on every `none` and `compressor-track` row.

**Known findings to start with:** `one-frame-early-44100` (invariant `section-is-slice`, also matched for `impulse-on-reference`; note: the openDAW#530 comment; applies to page 44100, `section-loop-twice`, `seconds: 4`), `setposition-cold-start` (invariant `samples-equal-reference`, `setposition-*` paths with a Compressor), `range-missing-tail` (invariant `section-is-slice`, the `tail` group's `section-marker` row). Task 9 corrects these against what is read.

- [ ] **Step 1: Write the failing tests**

```typescript
it("gives the latency figures the crates and the #530 note read", () => {
  const table = [["none", 0, 0], ["autotune-muted", 1280, 1280], ["compressor-track", 240, 220], ["compressor-muted", 240, 220],
    ["maximizer-muted", 240, 221], ["fold-muted", 15, 15], ["script-10ms-muted", 480, 441], ["script-150ms-parallel", 4800, 4410],
    ["compressor-bus", 240, 220], ["compressor-aux", 240, 220], ["several", 255, 235]] as const; // several: Compressor + Fold in series against a Compressor
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
  expect(rows.length).toBe(11 * 10);
});
it("points every reference at a row that exists and renders first", () => {
  const rows = buildRows(48000);
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.referenceId !== null) expect(seen.has(r.referenceId), r.id).toBe(true);
    if (r.noLatencyReferenceId !== null) expect(seen.has(r.noLatencyReferenceId), r.id).toBe(true);
    seen.add(r.id);
  }
});
it("drives the default master Maximizer over its limit on the render paths", () => {
  const rows = buildRows(48000).filter((r) => r.group === "master" && r.masterMaximizer);
  expect(rows.length).toBe(2 * 9);
  rows.forEach((r) => expect(r.signal, r.id).toBe("hot"));
  expect(new Set(rows.map((r) => r.path)).size).toBe(9);
  expect(rows.filter((r) => r.path === "step-one").every((r) => r.invariants.includes("differs-from-reference"))).toBe(true);
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
it("labels the one frame only where it was measured", () => {
  const row = buildRows(44100).find((r) => r.id === "core-none-section-loop-twice")!;
  expect(findingFor(row, "section-is-slice", 44100)?.name).toBe("one-frame-early-44100");
  expect(findingFor(row, "section-is-slice", 48000)).toBeNull();
  expect(findingFor(row, "no-jump", 44100)).toBeNull();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/audit/exportRegressionRows.test.ts src/lib/audit/exportRegressionFindings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both modules as data plus `buildRows`**

Order rows so every reference comes first: `step-one` first within each latency case, `none` first of all. `script-10ms` and `several` figures are expectations from the crates: if the first browser run reads another, correct them in Task 9 with the read figure and its citation.

- [ ] **Step 4: Run them to see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/exportRegressionRows* src/lib/audit/exportRegressionFindings*
git commit -m "feat: export regression row catalogue and known findings"
```

### Task 4: Verdict

**Files:**
- Create: `src/lib/audit/exportRegressionVerdict.ts`, `src/lib/audit/exportRegressionVerdict.test.ts`

**Interfaces:**
- Consumes: `ExportRow`, `InvariantId`, `RenderRead`, `findingFor`, `toneStep`.
- Produces: `RenderedRow = { read: RenderRead; samples: readonly Float32Array[]; reportedLatencyFrames: number; repeatHash: string | null }`.
- Produces: `InvariantResult = { invariant: InvariantId; holds: boolean; detail: string; finding: string | null }`.
- Produces: `judgeInvariants(row: ExportRow, rendered: RenderedRow, refs: { reference: RenderedRow | null; noLatency: RenderedRow | null }, pageRate: number): InvariantResult[]`. `stems-sum-to-mix` reads its `mix-*` row as `reference`.
- Produces: `RegisterEntry = { hash: string; frames: number; channels: number; peak: number; impulseHits: number[]; wav: string }`; `RegisterVerdict = "identical" | "changed" | "unregistered"`; `compareRegister(read: RenderRead, entry: RegisterEntry | null): { verdict: RegisterVerdict; shiftFrames: number | null; framesChanged: boolean }`.
- Produces: `rowStanding(results: readonly InvariantResult[], error: string | null): "clean" | "known-finding" | "failing" | "errored"`.
- Produces: `parseRegisterResponse(contentType: string | null, body: string): unknown | null`, null for an HTML answer or a body starting with `<`.

- [ ] **Step 1: Write the failing tests**

One `it` per invariant holding and one failing, on small arrays, with these exact rules:

```typescript
it("fails section-is-slice on one frame early, with no allowance", () => {
  const ref = rendered([0, 0, 1, 0, 0]);
  const early = rendered([0, 1, 0, 0, 0]);
  const [r] = judgeInvariants(row({ invariants: ["section-is-slice"] }), early, { reference: ref, noLatency: null }, 48000);
  expect(r.holds).toBe(false);
  expect(r.detail).toContain("frame 1");
});
it("compares a longer render over the reference's frames", () => { /* prefix equal, extra tail frames: holds */ });
it("holds no-jump on the tone's own step and fails on a join", () => {
  // limit: the reference's largestStep.step * 1.05 when the row has a reference, else toneStep(PROBE_TONE_LEVEL, PROBE_TONE_HZ, pageRate) * 1.05
});
it("says what muted-latent-unchanged read: exact, or past how many frames", () => {
  // equal from frame 0: detail "bit-identical"; equal from frame 200: holds false, detail "differs up to frame 199"
});
it("holds stems-sum-to-mix within rounding only", () => {
  // |sum - mix| <= 4.8e-7 (2^-21) holds; 1e-4 fails
});
it("fails proves-something on a silent or non-finite render", () => { /* peak 0, nonFinite > 0 */ });
it("fails latency-as-expected and still reports the figures", () => {
  // reported 240, expected 4800: holds false, detail names both
});
it("puts a known finding's name on a failing invariant and only there", () => { /* uses findingFor */ });
it("reads a shift from the register's impulses", () => {
  expect(compareRegister(read({ hash: "b", impulseHits: [99] }), entry({ hash: "a", impulseHits: [100] }))).toEqual({ verdict: "changed", shiftFrames: -1, framesChanged: false });
});
it("reads a missing entry as unregistered", () => expect(compareRegister(read({}), null).verdict).toBe("unregistered"));
it("takes an HTML answer for no register", () => {
  expect(parseRegisterResponse("text/html", "<!doctype html>")).toBeNull();
  expect(parseRegisterResponse("application/json", "<html>")).toBeNull();
  expect(parseRegisterResponse("application/json", '{"rows":{}}')).toEqual({ rows: {} });
});
it("ranks a row's standing", () => {
  expect(rowStanding([holds()], null)).toBe("clean");
  expect(rowStanding([fails("one-frame-early-44100")], null)).toBe("known-finding");
  expect(rowStanding([fails(null), fails("x")], null)).toBe("failing");
  expect(rowStanding([holds()], "worker hung")).toBe("errored");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/audit/exportRegressionVerdict.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`impulse-on-computed-frame` reads `computedFrame` against `read.impulseHits` for the impulses inside the range, no allowance. A slice of a reference starts at `Math.round(row.rangeStartSeconds * pageRate)`: `section-is-slice` and `impulse-on-reference` subtract that from the reference's frames. Sample equality compares bit patterns on all shared channels. `tail-present`: `energyPastRange` over 1e-4. `tail-absent`: `energyPastRange` null or 0, and the frames equal the range. `disabled-equals-absent` and `differs-from-reference` compare hashes.

- [ ] **Step 4: Run it to see it pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/exportRegressionVerdict*
git commit -m "feat: export regression invariants and register comparison"
```

### Task 5: Artifacts and the table script

**Files:**
- Create: `src/lib/audit/exportRegressionArtifacts.ts`, `src/lib/audit/exportRegressionArtifacts.test.ts`
- Create: `scripts/audit/export-regression/table.ts`, `scripts/audit/export-regression/table.test.ts`

**Interfaces:**
- Produces: `EXPORT_REGRESSION_SCHEMA_VERSION = 1`; `SUMMARY_NAME = /^exportreg-summary-(\d+)\.json$/`; `summaryFileName(runToken: number): string`; `wavFileName(runToken: number, rowId: string): string` (`exportreg-<token>-<rowId>.wav`).
- Produces: `RowRecord = { id: string; label: string; group: ExportRow["group"]; read: RenderRead | null; reportedLatencyFrames: number | null; invariants: InvariantResult[]; register: RegisterVerdict | null; shiftFrames: number | null; standing: ReturnType<typeof rowStanding>; wavUploaded: boolean; error: string | null; renderMs: number }`.
- Produces: `ExportSummary = { schemaVersion: number; runToken: number; userAgent: string; sdkVersion: string; engineWasmSha256: string; sampleRate: number; uuidOrder: "ascending" | "descending"; rowsParam: string; fill: boolean; registerSdkVersion: string | null; rows: RowRecord[] }`.
- Produces: `ExportRegister = { schemaVersion: number; sdkVersion: string; engineWasmSha256: string; acceptedRunToken: number; acceptedAt: string; sampleRate: number; rows: Record<string, RegisterEntry> }`.
- Produces: `parseExportSummary(json: unknown, runToken: number): ExportSummary`; `parseExportRegister(json: unknown): ExportRegister`; `planAccept(summary: ExportSummary, onDisk: ExportRegister | null, uploaded: ReadonlySet<string>, options: { force: boolean; acceptedAt: string }): { register: ExportRegister; wavsToCopy: { rowId: string; hash: string }[] }`, which throws the refusal.
- Produces: `staleFindings(summary: ExportSummary): { name: string; rows: string[] }[]`: known findings whose rows now hold.
- Produces, from `table.ts`: `parseArgs(args: readonly string[]): { token?: string; accept: boolean; force: boolean; diff?: string; library: string | null }`, `formatRows(summary): string[]`, `runLine(summary): string`, `acceptPath(rate: number, root?: string): string` (`debug/2026-11-06-export-regression/register/<rate>.json`).
- CLI: `node scripts/audit/export-regression/table.ts [runToken] [--accept] [--force] [--library <path>] [--diff <rowId>]`. The library defaults to `$EXPORT_WAV_LIBRARY`, then `../opendaw-export-wavs`, and is null when that does not exist.

- [ ] **Step 1: Write the failing tests**

```typescript
it("refuses an errored row even when forced", () => {
  expect(() => planAccept(summary([record({ error: "worker hung", standing: "errored" })]), null, new Set(), { force: true, acceptedAt })).toThrow(/errored.*a/);
});
it("refuses a failing invariant with no finding, and takes one with a finding", () => {
  const failing = record({ id: "a", standing: "failing" });
  expect(() => planAccept(summary([failing]), null, new Set(["a"]), { force: false, acceptedAt })).toThrow(/a.*no known finding/);
  const labelled = record({ id: "a", standing: "known-finding", read: read({ hash: "h" }), register: "unregistered" });
  expect(planAccept(summary([labelled]), null, new Set(["a"]), { force: false, acceptedAt }).register.rows.a.hash).toBe("h");
});
it("refuses a changed row with no uploaded WAV, naming the rows, and plans nothing", () => {
  const rows = [record({ id: "a", register: "changed" }), record({ id: "b", register: "changed" })];
  expect(() => planAccept(summary(rows), null, new Set(["b"]), { force: false, acceptedAt })).toThrow(/a/);
});
it("plans a copy only for hashes new to the library", () => { /* identical rows keep their entry and copy nothing */ });
it("refuses a summary whose rate differs from the register's", () => {
  expect(() => planAccept(summary([], { sampleRate: 44100 }), registerAt(48000), new Set(), { force: false, acceptedAt })).toThrow(/44100.*48000/);
});
it("refuses a descending-UUID run outright", () => { /* uuidOrder "descending": "control run" */ });
it("merges a partial run only when forced", () => { /* rowsParam not "all" */ });
it("names a schema it cannot read", () => expect(() => parseExportSummary({ schemaVersion: 99 }, 1)).toThrow(/99/));
it("reports a finding whose rows now hold as no longer reproducing", () => {
  expect(staleFindings(summaryWhereFindingRowsHold)).toEqual([{ name: "one-frame-early-44100", rows: ["core-none-section-loop-twice"] }]);
});

// table.test.ts, on a temp directory
it("--accept writes the register and copies the WAV by hash", () => { /* spawn with a summary, a WAV, --library <tmp> */ });
it("verifies a WAV's samples hash before copying it", () => { /* a WAV whose samples do not match the row's hash: exit 1, nothing written */ });
it("--diff reports figures, and says so when no library is present", () => { /* with: kind, first frame, dB; without: "no library" and the page's figures, exit 0 */ });
it("prints stale findings and the three standing counts on the run line", () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/audit/exportRegressionArtifacts.test.ts scripts/audit/export-regression/table.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both**

Follow `src/lib/audit/midiEffectSemanticsArtifacts.ts` and `scripts/audit/midi-effect-semantics/table.ts` for shape. Table columns: id, standing, register, hash prefix, frames, latency, failing invariants. The run line carries `clean N, known finding N, failing N, errored N`, the SDK and engine hash. For a `changed` row with a library present, the table reads `decodeFloatWav` on both sides and prints `diffRenders`' kind, first frame and dB; `--diff` also writes `.verify-output/exportreg-diff-<rowId>-accepted.wav` and `-new.wav` for the audio-analyzer MCP. `--accept` writes the register only after every WAV has been copied and hash-checked, and prints the commit the person makes in the library.

- [ ] **Step 4: Run them to see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/exportRegressionArtifacts* scripts/audit/export-regression
git commit -m "feat: export regression summary, register and table script"
```

### Task 6: Project builder

**Files:**
- Create: `src/lib/audit/exportRegressionProject.ts`, `src/lib/audit/exportRegressionProject.test.ts`

**Interfaces:**
- Consumes: `ExportRow`, `LatencyCaseId`, the signals, `audioEffectsFieldOf`, `removeMasterMaximizer`.
- Produces: `HarnessProject = { project: Project; units: { source: AudioUnitBox; bed: AudioUnitBox; holder: AudioUnitBox }; tracks: { source: TrackBox; bed: TrackBox }; bus: AudioBusBox; aux: AudioBusBox; sources: Map<string, UUID.Bytes> }`.
- Produces: `buildHarnessProject(project: Project, audioContext: BaseAudioContext, buffers: Map<string, AudioBuffer>, order: "ascending" | "descending"): HarnessProject`, which calls `assertUuidOrder` on the three units and throws on a mismatch.
- Produces: `prepareSources(harness: HarnessProject, rows: readonly ExportRow[], audioContext: BaseAudioContext, buffers: Map<string, AudioBuffer>): Promise<void>`: one `AudioBuffer` per distinct `(signal, sourceRate, seconds)` and one for the bed, each keyed by `UUID.sha256` of its samples. **Content-addressed, not from the ordered `generate`:** fixed uuids would otherwise find a stale sample in OPFS when another page has stopped the sweep, or after the catalogue changes.
- Produces: `applyRow(copy: Project, harness: HarnessProject, row: ExportRow): void`, run on the copy before the renderer exists: creates the row's `AudioFileBox` and `AudioRegionBox` on the copy's source track (and the bed's when `withBed`), sets the row's bpm, mutes per row (the bed unless `withBed`, always the holder), inserts the latency case's devices with the row's settings, removes the master Maximizer unless `masterMaximizer`, nudges the volume, sets a device disabled.
- Produces: `latencyDevices(latencyCase: LatencyCaseId): { host: "source" | "holder" | "bus" | "aux"; device: "Autotune" | "Compressor" | "Maximizer" | "Fold" | "Werkstatt"; script?: string }[]`, a pure table.

**The settings.** The Compressor: `threshold 0, ratio 1, knee 0, inputgain 0, makeup 0, automakeup false, mix 1, lookahead true` (from the #530 page). The Maximizer and Fold: defaults. Scripts: `// @latency 10` and `// @latency 150` through `ScriptCompiler`, with a pass-through `process` (`src/demos/effects/CLAUDE.md`, and upstream's `delay-compensation.test.ts`). `script-150ms-parallel` holds the script on the muted holder, so the source is the parallel path the cap applies to (a muted device keeps its latency, `documentation/11-effects.md`; with nothing parallel it would read 150 ms). The bus and aux are created up front with `AudioBusFactory.create(skeleton, name, IconSymbol.AudioBus, AudioUnitType.Bus / .Aux, color)`, in a transaction of their own. `compressor-bus` routes the source through the bus, with the muted holder as the parallel path; `compressor-aux` adds an aux send to the aux return, as upstream's "aligns a dry path with its aux send" does. Markers: two `MarkerBox`es at 1 s and 3 s, created in `applyRow` for `section-marker*`.

- [ ] **Step 1: XERJ retrieval**

Run: `XERJ_DISABLE_FEEDBACK=true xerj code webdaw "aux send AuxSendBox create target bus routing" --lang typescript`, and read `delay-compensation.test.ts`'s aux and Werkstatt cases. Note the passages for the commit body.

- [ ] **Step 2: Write the failing test of `latencyDevices`**

```typescript
it("places each case's devices", () => {
  expect(latencyDevices("none")).toEqual([]);
  expect(latencyDevices("compressor-muted")).toEqual([{ host: "holder", device: "Compressor" }]);
  expect(latencyDevices("compressor-aux")).toEqual([{ host: "aux", device: "Compressor" }]);
  expect(latencyDevices("several")).toEqual([
    { host: "source", device: "Compressor" }, { host: "source", device: "Fold" }, { host: "holder", device: "Compressor" }]);
  expect(latencyDevices("script-10ms-muted")[0].script).toContain("// @latency 10");
});
```

The box-graph parts are proven by the positive controls and the first browser run (Tasks 8 and 9), since `applyRow` needs a live `Project`.

- [ ] **Step 3: Run it to see it fail, implement, run it to see it pass**

Run: `npx vitest run src/lib/audit/exportRegressionProject.test.ts`
Expected: FAIL, then PASS. The Project reads through adapters (`audioEffectsFieldOf`, `.audioEffects`), resolves fields outside `editing.modify`, and puts capture-free device settings in a second transaction where pointers need the first to commit (root `CLAUDE.md`, "Pointer Re-Routing and Reads After Creation").

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit/exportRegressionProject*
git commit -m "feat: export regression project with latency cases"
```

### Task 7: Render paths

**Files:**
- Create: `src/lib/audit/exportRegressionPaths.ts`, `src/lib/audit/exportRegressionPaths.test.ts`

**Interfaces:**
- Consumes: `ExportRow`, `HarnessProject`, `applyRow`.
- Produces: `chunkSizes(totalFrames: number, chunk: number): number[]` (pure); `setPositionStart(seconds: number, bpm: number, pageRate: number, onQuantum: boolean): { ppqn: number; offQuantumFrames: number }` (pure).
- Produces: `renderPath(harness: HarnessProject, row: ExportRow, pageRate: number): Promise<Float32Array[]>`, throwing on a wedged worker. Each call takes a `project.copy()`, runs `applyRow`, renders, terminates. A `RENDER_DEADLINE_MS = 60_000` wraps the whole call.

**Per path.**
- `step-one`: `create → setPosition → play → waitForLoading → step(frames)`.
- `step-chunked-*`: the same with `chunkSizes`, concatenated.
- `step-reset`: render, `stop`, `setPosition`, `play`, render again, return the second.
- `start`: `OfflineEngineRenderer.start(copy, Option.None, progress, undefined, pageRate)`.
- `section-*`: `MixdownSection.collect(copy)`, the section by `type` and `passes` (the loop area set first on the copy), `renderSection` on the copy.
- `stems-*`: `ExportConfiguration.stems` keyed by `UUID.toString(unit.address.uuid)`, `fileName` required. `stems-sends` sets `includeSends: true`. `stems-metronome` adds `metronome: { stem: { fileName: "Metronome" } }`.
- `bounce-*`: **not `AudioBounce.bounce`, which returns nothing and edits the project.** Mirror its order from the exported pieces: `AudioBounce.collectJobs(regions, merge, loop)`, `prepareCopy(copy, job)`, `renderSpan`, `OfflineEngineRenderer.create(copy, Option.wrap(exportConfiguration(job, tap)), pageRate)`, `waitForLoading`, `setPosition(job.start)`, `play`, `waitForLoading`, `renderFrames((n) => renderer.step(n), span, pageRate)`. Regions are read from the COPY's adapters. A merge job needs two regions: split the source region with `RegionEditing.cut` on the copy.
- `setposition-*`: `step-one` with `setPosition` at a non-zero start from `setPositionStart`.
- `loop-on-copy`: `step-one` with the loop area enabled on the copy across the first 2 s, rendering 4 s.

- [ ] **Step 1: XERJ retrieval**

Run: `XERJ_DISABLE_FEEDBACK=true xerj code webdaw "renderFrames skipFrames prepareCopy exportConfiguration bounce" --lang typescript`, and read `AudioBounce.ts`'s `bounce`, `core/src/OfflineEngineRenderer.ts`'s `renderSection`, and `MixdownSection`'s `collect` in the checkout.

- [ ] **Step 2: Write the failing tests of the pure helpers**

```typescript
it("covers the total in chunks", () => {
  expect(chunkSizes(100000, 48000)).toEqual([48000, 48000, 4000]);
  expect(chunkSizes(3000, 1000)).toEqual([1000, 1000, 1000]);
});
it("lands a start on and off the quantum", () => {
  const on = setPositionStart(1, 120, 48000, true);
  expect(on.offQuantumFrames).toBe(0);
  expect(setPositionStart(1, 120, 48000, false).offQuantumFrames).toBeGreaterThan(0);
  expect(Number.isInteger(on.ppqn)).toBe(true);
});
```

- [ ] **Step 3: Run them to see them fail, implement, run them to see them pass**

Run: `npx vitest run src/lib/audit/exportRegressionPaths.test.ts`
Expected: FAIL, then PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit/exportRegressionPaths*
git commit -m "feat: export regression render paths"
```

### Task 8: The audit page

**Files:**
- Create: `export-regression-audit-debug-demo.html`, `src/demos/export/export-regression-audit-debug-demo.tsx`
- Modify: `vite.config.ts` (`rollupOptions.input`, `exportRegressionAuditDebug`, beside `renderSectionLatencyDebug`)

**Interfaces:**
- Consumes: everything above.
- URL params: `?rate=44100`; `?uuid=descending`; `?fill=1`; `?rows=<id,id>` and `?group=<group>` (a partial run); `?failAt=<rowId>` (throws in that row, a test hook for the errored path).
- Produces: `#audit-state[data-audit-state]` walking `setup → ready → running:<row> → done | error:<message>`, and `data-standing-counts` with `clean,known,failing,errored`.

- [ ] **Step 1: Write the page**

Installing the UUID order is the module's first statement, before `initializeOpenDAW` (`installUuidOrder(UUID as unknown as UuidNamespace, order)`). `initializeOpenDAW({ localAudioBuffers, bpm, audioContextSampleRate: rate })`. A button `Run audit`, disabled until booted. Before the first row: `prepareSources`. Read `compensationLatency` once per latency case on the live engine, the devices inserted on the live project and deleted again (as the #530 page does in `insertDevices` and `waitForReportedLatency`), and read it again for a row only if the row changes the case's routing. A figure that stays off its expectation past the deadline is recorded, not thrown. For each row: `renderPath`, `readRender`, `repeat` a second render when `row.repeat`, `judgeInvariants`, `compareRegister`, then upload a WAV when the row is not `identical` or `?fill=1`, through `encodeFloatWav` and `PUT /__verify/<wavFileName>`. A row that throws records its `error`, and the run goes on. Keep `samples` only for rows some later row references. Fetch the register through `parseRegisterResponse`, and treat 404 and 405 from the sink as no sink. `engineWasmSha256`: the SHA-256 of `/wasm-engine/wasm/engine.wasm`. `sdkVersion`: `OPENDAW_SDK_VERSION`. Page shell per `render-section-latency-debug-demo.tsx`, with `DebugLinkBar`, no product logo, and `<meta name="robots" content="noindex">`. Not added to `src/index.tsx` or `public/sitemap.xml`.

- [ ] **Step 2: Verify the first group in a browser**

Run: `npm run typecheck`. Then open `https://localhost:5173/export-regression-audit-debug-demo.html?group=control`, a real click on Run, wait for `data-audit-state="done"`.
Expected: no `errored` rows, `control-nudged` reads `differs-from-reference` holds, and `.verify-output/exportreg-summary-<token>.json` exists.

- [ ] **Step 3: Verify the errored path**

Open with `?group=control&failAt=control-nudged`, a real click on Run.
Expected: that row reads `errored`, later rows still render, state ends `done`. `node scripts/audit/export-regression/table.ts --accept` refuses, naming it.

- [ ] **Step 4: Commit**

```bash
git add export-regression-audit-debug-demo.html src/demos/export/export-regression-audit-debug-demo.tsx vite.config.ts
git commit -m "feat: export regression audit page"
```

### Task 9: Full runs, controls, library and first fill

**Files:**
- Create: `debug/2026-11-06-export-regression/note.md`, `debug/2026-11-06-export-regression/register/48000.json`, `.../register/44100.json`
- Modify: `src/lib/audit/exportRegressionFindings.ts` and `exportRegressionRows.ts` (figures corrected against what is read), `debug/README.md`
- Create, in a new repo: `naomiaro/opendaw-export-wavs`

- [ ] **Step 1: Create the library**

```bash
brew install git-lfs && git lfs install
gh repo create naomiaro/opendaw-export-wavs --private --clone --description "Accepted renders for the export regression audit"
```

Move the clone to `~/Code/opendaw-export-wavs` (beside this repo). In it: `git lfs track "wav/*.wav"`, a README of a few lines on what it holds and how it is filled, then commit and push `.gitattributes` and the README. Expected: `git lfs track` lists the pattern.

- [ ] **Step 2: Run the whole catalogue at both page rates**

Open the page with no params, then `?rate=44100`, a real click on Run each, `?fill=1` on both. Poll `data-audit-state` in calls under about 100 s. Read `node scripts/audit/export-regression/table.ts <token>`.
Expected: no `errored` rows. Any row reading `failing` is a finding to read, not to fix in the harness unless the harness is wrong. **The 1 frame must read as a failing invariant on `core-none-section-loop-twice` at 44100.** If it does not, stop: the harness has absorbed it or the behaviour moved.

- [ ] **Step 3: Run the positive controls**

The old release is built at `~/Code/opendaw-sdk-override-0.0.181` (`node scripts/audit/sdk-override.ts 582f9ff <dir>` rebuilds it). Serve it: stop the dev server, `rm -rf node_modules/.vite`, `SDK_DIST_OVERRIDE=~/Code/opendaw-sdk-override-0.0.181 npm run dev -- --port 5173 --host 127.0.0.1 --strictPort`. Check `curl -sk https://localhost:5173/wasm-engine/wasm/engine.wasm | shasum -a 256` starts `3da5083093`. Run the page at 48000 with `?group=core`. Then restart on the installed SDK, `rm -rf node_modules/.vite` again. **Before stopping or restarting any dev server, navigate the browser tab to `about:blank`:** Vite reloads an open page when its server comes back, the page re-runs against the new SDK, and its upload overwrites the earlier run's files under the same token rules (measured: a 0.0.181 summary overwritten with 0.0.180). Read each summary's `sdkVersion` before comparing runs.
Expected: `no-jump` or `section-is-slice` fail on `section-*` rows of `compressor-track` and `fold-muted` (#530: 16 and 113 frames early), and `latency-as-expected` fails on `script-150ms-parallel` (#529). Then run `?uuid=descending&group=core`.
Expected: summed rows `changed`, single-unit rows `identical`, the table labels the summed rows `rounding-sized`, and `--accept` refuses that run. Record all of it in the note.

- [ ] **Step 4: Correct the figures and label the findings**

Correct `expectedLatencyFrames` where a read figure differs, with its citation. For each failing row, decide with the user: a defect goes to a draft (Task 10), a pin gets a label in `exportRegressionFindings.ts`. Re-run the rows a change touches. Run `npx vitest run src/lib/audit/exportRegressionRows.test.ts src/lib/audit/exportRegressionFindings.test.ts`. Expected: PASS.

- [ ] **Step 5: Hand the table to the user and accept after their read**

**Stop and show the user both runs' tables and the failing rows.** After their read: `node scripts/audit/export-regression/table.ts <token> --accept --library ~/Code/opendaw-export-wavs` for each rate. In the library: `git add wav && git commit && git push`.
Expected: both registers exist, the library holds a WAV per distinct hash, and a re-run reads `identical` on every row.

- [ ] **Step 6: Write the note and commit**

`debug/2026-11-06-export-regression/note.md`: verified against, the runs with tokens, the standing counts, the controls, the row counts and library size against the spec's estimate, the reading recipe. A row in `debug/README.md`.

```bash
git add debug src/lib/audit
git commit -m "debug: export regression registers, first runs and positive controls"
```

### Task 10: The one frame, and any other defect found

**Files:**
- Modify: `debug/2026-11-06-export-regression/note.md`
- Create: `debug/2026-11-06-export-regression/drafts/TO-REVIEW-openDAW-<topic>.md`, one per defect
- Modify: `debug/README.md` ("Waiting for a read")

- [ ] **Step 1: Read what the 1 frame depends on**

From the `one-frame` rows' table at 44100 and 48000: which of source rate, section length and bpm move it. Read the two-pass path's frame arithmetic in the checkout (`core/src/OfflineEngineRenderer.ts` `#renderFrames`, the worker's `step`). Add rows only if the axis leaves it open. Record in the note what is measured and what is inferred, and label each as such.

- [ ] **Step 2: Write the drafts**

Each draft: title, the signature measured, repro page URL, the note's link, no suggested fix. The 1 frame cites the openDAW#530 comment, since that issue is closed. Name each draft `drafts/TO-REVIEW-<target>.md` and list it under "Waiting for a read". **Post nothing: the user reads first.**

- [ ] **Step 3: Commit**

```bash
git add debug
git commit -m "debug: what the 44.1 kHz early frame depends on, drafts for a read"
```

### Task 11: Wiring and PR

**Files:**
- Modify: `.claude/skills/sdk-upgrade/SKILL.md` (a table row beside `render-section-latency-debug-demo.html`)
- Modify: `CLAUDE.md` ("Build & Verification", an entry in the sweep list), `src/demos/export/CLAUDE.md` (a section: the page, reading recipe, the library's location)
- Delete: `docs/superpowers/specs/2026-11-06-export-regression-harness-design.md`, `docs/superpowers/plans/2026-11-06-export-regression-harness.md`, after their durable decisions are in `src/demos/export/CLAUDE.md` and the note

- [ ] **Step 1: Write the entries**

The sweep entry: `export-regression-audit-debug-demo.html` then `?rate=44100`, a real click on Run, deterministic, no hardware, how long it took. Expected: every row `identical`, or `changed` read through the table; a `failing` unlabelled row is the finding. `--accept` only after a person's read, and it needs `~/Code/opendaw-export-wavs`. An offline-only audit needs the two page rates, not the device-rate pass. At an SDK bump, a `no longer reproduces` line is a fix landing: retire the label in the note.

- [ ] **Step 2: Verify the whole branch**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: exit 0, no test failing. Run: `git diff main | grep -iE 'moises|studio ?2' | grep -v MoisesLogo`. Expected: empty. Run: `du -sh .git`. Expected: no WAV committed here.

- [ ] **Step 3: Push and open the PR**

Body: what it builds, the measured standing, the controls, the test plan, ending with the attribution line. Then run `/pr-review-toolkit:review-pr` and fix Critical and Important findings, updating the body rather than commenting. **The merge is the user's: hand them `gh pr merge <n> --squash`.**
