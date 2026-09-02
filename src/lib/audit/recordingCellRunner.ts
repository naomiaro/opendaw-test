/**
 * Shared per-repeat cell runner for the recording start-alignment harness.
 *
 * Extracted verbatim from `recording-alignment-audit-debug-demo.tsx` (its
 * single-tape matrix path) so a SECOND page — the input-latency calibration
 * ground-truth page — can run the SAME `nominal-start` cell, measured and
 * classified exactly the way the standing sweep measures it, instead of a
 * look-alike reimplementation whose verdict would not be comparable to the
 * campaign register. Every doc comment below is the original one, including
 * the fix-round references; the only edits are the module boundary itself:
 *  - the `loopback` handle, previously a module-scope binding on the page, is
 *    now passed in (`CellRepeatOptions.loopback`, `resetForNextCell`'s second
 *    argument) because each page installs its own;
 *  - `runCellRepeat`'s eleven positional parameters became one options object;
 *  - `lastFinalizeProbe` moved here with `takeLastFinalizeProbe()` as its
 *    reader, since only `runCellRepeat` writes it.
 *
 * Log lines keep the `[recording-alignment-audit]` prefix on BOTH pages: the
 * register and the offline scripts grep for it, and a per-page prefix would
 * split that trail.
 *
 * The multi-mic runner stays on the audit page — nothing else uses it.
 */
import type { Project } from "@opendaw/studio-core";
import type { AudioUnitBoxAdapter, SampleLoader } from "@opendaw/studio-adapters";
import { Terminable } from "@opendaw/lib-std";
import type { LoopbackHandle } from "@/lib/audit/loopbackInjection";
import { detectOnsets } from "@/lib/audit/onsetDetection";
import {
  buildReferenceSchedule,
  bandSplit,
  identifyReferenceClicks,
  estimateAnchorT0,
  measureTakeAlignment,
  type TakeAlignment,
  type ReferenceSchedule,
} from "@/lib/audit/recordingAlignment";
import {
  JANK_MS,
  LOOP_WRAP_TAKES,
  HEAD_MISSING_BASELINE_MS,
  type RecordingScenario,
} from "@/lib/audit/recordingAuditCalibration";
import type { AuditRow, FinalizeProbe } from "@/lib/audit/recordingAuditArtifacts";
import { BAR_PPQN } from "@/lib/audit/auditExpectations";

/** Finalization barrier deadline, shared by every take-finalizing wait on both pages. */
export const FINALIZE_DEADLINE_MS = 30_000;


export interface CapturedBuffer {
  channels: Float32Array[];
  sampleRate: number;
}

export interface CellRepeatResult {
  rows: AuditRow[];
  alignments: { takeIndex: number; alignment: TakeAlignment }[];
  buffer: CapturedBuffer;
}

/** Filename-safe token for a bpm that may carry a decimal (97.3 -> "97p3") —
 *  the /__verify sink's name regex only accepts [a-z0-9-]+ before the extension. */
export function bpmToken(bpm: number): string {
  return String(bpm).replace(".", "p");
}

export function cellLabel(scenario: RecordingScenario, bpm: number, repeat: number): string {
  return `${scenario}/${bpmToken(bpm)}/r${repeat}`;
}

/** The harness-path bias term and how long it took to become readable. */
export interface HarnessPathBias {
  valueSec: number;
  settleMs: number;
}

/**
 * Read `audioContext.outputLatency` ONCE per page load, after output has
 * demonstrably started. Chrome reports 0 until the output stream is running,
 * and a run that read the property per repeat measured its first repeat with
 * a bias of 0 while the summary recorded the later non-zero value (persisted
 * evidence: `nominal-start/120/r1` in four runs, adjusted == raw). Resumes the
 * context if needed, then polls at 50 ms for a non-zero read up to
 * `deadlineMs`; on timeout the (zero) value is returned and warned about, and
 * `settleMs` in the summary shows the wait ran out. The value is applied to
 * EVERY row of the run and persisted both per row and in the envelope, so an
 * offline reader never has to infer which bias a row was adjusted with.
 */
export async function resolveHarnessPathBias(audioContext: AudioContext, deadlineMs: number = 5000): Promise<HarnessPathBias> {
  const start = performance.now();
  if (audioContext.state !== "running") await audioContext.resume();
  while (!(audioContext.outputLatency > 0)) {
    if (performance.now() - start > deadlineMs) {
      console.warn("[recording-alignment-audit] outputLatency still " + String(audioContext.outputLatency) + " after " + deadlineMs + "ms; every row of this run will carry that bias");
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const bias = { valueSec: audioContext.outputLatency, settleMs: performance.now() - start };
  console.log("[recording-alignment-audit] harnessPathBiasSec=" + String(bias.valueSec) + " settled in " + bias.settleMs.toFixed(0) + "ms; baseLatency=" + String(audioContext.baseLatency));
  return bias;
}

/**
 * Poll `engine.position` at `intervalMs` until `predicate` holds, or reject
 * after `deadlineMs`. Manages its own deadline (a `withDeadline` wrapper has
 * no way to reach into the promise and stop the poll): the timer and the
 * `settled` flag guarantee the recursive `setTimeout` chain stops on BOTH exit
 * paths — a timed-out wait used to keep polling the box graph for the rest
 * of the page's life, and that orphan poll was also what let a repeat
 * abandoned by the outer cell deadline resolve during the NEXT repeat.
 * `deferFirstCheck` delays even the first read by one interval (see
 * `waitForPositionSettled`).
 */
function pollPosition(
  project: Project,
  predicate: (ppqn: number) => boolean,
  intervalMs: number,
  deadlineMs: number,
  label: string,
  deferFirstCheck: boolean
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let poll: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (poll !== null) clearTimeout(poll);
      reject(new Error(`${label} timed out after ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const check = () => {
      if (settled) return;
      if (predicate(project.engine.position.getValue())) {
        settled = true;
        clearTimeout(timer);
        resolve();
        return;
      }
      poll = setTimeout(check, intervalMs);
    };
    if (deferFirstCheck) poll = setTimeout(check, intervalMs);
    else check();
  });
}

/** Poll of engine.position, per the brief's spec — catches the documented WASM
 *  transport-start-delay flakiness (position never advances) as a timeout
 *  instead of hanging the whole campaign. */
export function waitForPosition(project: Project, targetPpqn: number, deadlineMs: number): Promise<void> {
  return pollPosition(project, (ppqn) => ppqn >= targetPpqn, 50, deadlineMs, `waitForPosition(${targetPpqn})`, false);
}

/**
 * Poll until engine.position reads back within one beat of `expectedPpqn`.
 * Required after every `setPosition()` call, before trusting any later
 * `waitForPosition(..., target)` check: `position.getValue()` can still
 * return the PREVIOUS repeat's stale value for one or more polls
 * immediately after `setPosition()` (the reset is applied on the audio
 * thread and only reflected back asynchronously). Without this settle,
 * a repeat targeting the same musical span as the one before it can read
 * that stale (already-past-target) value on `waitForPosition`'s very
 * first, synchronous check and resolve instantly — stopping the recording
 * before any audio was captured (observed: two consecutive repeats both
 * finalizing with zero take regions, no timeout, right after a prior
 * repeat had ended near the same position). The first check is deferred
 * via setTimeout so it can never resolve on a synchronous stale read.
 */
export function waitForPositionSettled(project: Project, expectedPpqn: number, deadlineMs: number): Promise<void> {
  const tolerancePpqn = BAR_PPQN / 4; // one beat's worth of slack
  return pollPosition(
    project,
    (ppqn) => Math.abs(ppqn - expectedPpqn) <= tolerancePpqn,
    20,
    deadlineMs,
    `waitForPositionSettled(${expectedPpqn})`,
    true
  );
}

/**
 * A repeat's cancellation token. `runRepeatWithDeadline` flips `cancelled`
 * when the outer cell deadline fires; the repeat checks it after every await
 * (`assertCurrent`) so an abandoned repeat can never reach a side effect —
 * `stopRecording()`, patching a loader, overwriting `lastFinalizeProbe` —
 * while the NEXT repeat is already running. `withDeadline` alone has no
 * cancellation: the rejected promise is dropped but the async function
 * behind it keeps executing.
 */
export interface RepeatToken {
  cancelled: boolean;
}

export function assertCurrent(token: RepeatToken, stage: string): void {
  if (token.cancelled) throw new Error(`repeat abandoned by the outer cell deadline before ${stage}`);
}

export function runRepeatWithDeadline<T>(run: (token: RepeatToken) => Promise<T>, ms: number, label: string): Promise<T> {
  const token: RepeatToken = { cancelled: false };
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      token.cancelled = true;
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
    run(token).then(
      (value) => { clearTimeout(timer); resolve(value); },
      // A late rejection from an already-abandoned repeat (its assertCurrent
      // throw) lands on a settled promise and is dropped here, by design.
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Resolves once EVERY one of `unitAdapters` holds >= targetCountEach audio
 * take regions — used by loop-wrap (a single adapter, LOOP_WRAP_TAKES + 1 —
 * the 5 finalized takes plus the in-progress 6th) and by the multi-mic
 * scenarios (two adapters, target 1 each: confirms BOTH tapes' independent
 * RecordingWorklets have actually created their take region before the
 * caller trusts the recording is genuinely underway on both — skipping this
 * check would race exactly the inter-track skew this scenario measures,
 * since each tape's region-creation timing is independent).
 *
 * Watches each adapter's `.tracks` itself (not just a one-time snapshot of
 * `.values()`) — the SDK can land later takes on a newly-created TrackBox
 * (`RecordTrack.findOrCreate` per CLAUDE.md's "Take-to-Track Matching"),
 * which would otherwise be invisible to a fixed set of `regions`
 * subscriptions and stall the cell out to the deadline.
 *
 * Manages its own deadline (rather than wrapping withDeadline around the
 * promise) so every subscription — on every adapter's tracks collection AND
 * on each track's regions — is guaranteed to terminate on every exit path
 * (resolve, or timeout); an external withDeadline wrapper has no way to
 * reach into this promise to clean up subs it never sees.
 */
export function waitForTakeCount(unitAdapters: AudioUnitBoxAdapter[], targetCountEach: number, deadlineMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const subs: Terminable[] = [];
    let settled = false;
    const cleanup = () => subs.forEach((s) => s.terminate());
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`waitForTakeCount(${targetCountEach}x${unitAdapters.length}) timed out after ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const countRegions = (unitAdapter: AudioUnitBoxAdapter) =>
      unitAdapter.tracks
        .values()
        .flatMap((t) => [...t.regions.adapters.values()])
        .filter((r) => r.isAudioRegion()).length;
    const checkAndMaybeResolve = () => {
      if (settled) return;
      if (unitAdapters.every((u) => countRegions(u) >= targetCountEach)) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };
    for (const unitAdapter of unitAdapters) {
      // Fix round 1 (I3): `catchupAndSubscribe` fires synchronously for
      // already-existing tracks/regions. If adapter K's OWN catch-up (via
      // its nested track.regions subscription) satisfies `every(...)` —
      // e.g. because a LATER adapter in this list already had enough
      // regions before this loop even reached it — `checkAndMaybeResolve`
      // sets `settled` and calls `cleanup()` mid-loop, terminating
      // everything pushed to `subs` SO FAR. Any subscription this same
      // iteration pushes AFTER that point (including the outer
      // `tracks.catchupAndSubscribe` call itself, whose nested regions-sub
      // may have just fired synchronously inside it) is invisible to that
      // `cleanup()` call and never terminated — a leak. `beforeLength`
      // brackets everything THIS iteration adds so it can be swept
      // explicitly once the iteration's own synchronous work is done, and
      // the `if (settled) break` guard stops any FURTHER adapter from
      // subscribing at all once a prior iteration already resolved us.
      if (settled) break;
      const beforeLength = subs.length;
      subs.push(
        unitAdapter.tracks.catchupAndSubscribe({
          onAdd: (track) => {
            if (settled) return;
            subs.push(track.regions.catchupAndSubscribe({ onAdded: checkAndMaybeResolve, onRemoved: () => {} }));
          },
          onRemove: () => {},
          onReorder: () => {},
        })
      );
      if (settled) {
        for (let i = beforeLength; i < subs.length; i++) subs[i].terminate();
      }
    }
  });
}

/**
 * Resolves once `loader.state.type` reaches a terminal state ("loaded" or
 * "error"); rejects with the loader's error reason if it errors, or with a
 * timeout error after `deadlineMs`. Pre-checks the already-terminal case
 * (avoids the `subscribe()`-fires-synchronously TDZ hazard — see CLAUDE.md's
 * SampleLoader section) and manages its own deadline so the subscription is
 * guaranteed to terminate on every exit path — resolve, error, or timeout.
 * Shared by the finalization barrier and the between-cells cleanup grace
 * wait so both close the same leak the same way.
 */
export function waitForLoaderTerminal(loader: SampleLoader, deadlineMs: number, label: string): Promise<void> {
  if (loader.state.type === "loaded") return Promise.resolve();
  if (loader.state.type === "error") return Promise.reject(new Error(String(loader.state.reason)));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscribed = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (subscribed) sub.terminate();
      reject(new Error(`${label} timed out after ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const sub = loader.subscribe((state) => {
      if (settled) return;
      if (state.type === "loaded") {
        settled = true;
        clearTimeout(timer);
        resolve();
        if (subscribed) sub.terminate();
      } else if (state.type === "error") {
        settled = true;
        clearTimeout(timer);
        reject(new Error(String(state.reason)));
        if (subscribed) sub.terminate();
      }
    });
    subscribed = true;
  });
}

/** Task 9: the SDK's RecordingWorklet (the take's SampleLoader while it records)
 *  exposes the context time of the buffer's first frame as `firstQuantumTime`
 *  (an Option) on builds carrying the audio-thread anchor fix; the installed
 *  0.0.170 has no such member. Read defensively — undefined means "not exposed". */
export function readFirstQuantumTimeSec(loader: SampleLoader): number | undefined {
  const opt = (loader as unknown as { firstQuantumTime?: { isEmpty(): boolean; unwrap(): number } }).firstQuantumTime;
  if (opt === undefined || typeof opt.isEmpty !== "function") return undefined;
  return opt.isEmpty() ? undefined : opt.unwrap();
}

/**
 * Fix round 2 (N3): subscribes to `engine.isRecording` and, once it first
 * flips true, blocks the main thread for `jankMs` (the `janked-start`
 * provocation — see the C1 fix comment at its call site). Manages its own
 * deadline and guaranteed subscription termination on every exit path
 * (jank-fired, timeout) — same shape as `waitForLoaderTerminal` above and
 * for the same reason: the original inline version had no internal
 * deadline (a never-flipping `isRecording`, e.g. the documented WASM
 * transport-start-delay quirk, left the subscription live past the outer
 * 120s cell deadline, so it could fire the spin during a LATER repeat that
 * reuses the same tape/capture — silent cross-repeat contamination) and
 * used a bare `jankSub!.terminate()` that would null-deref if `isRecording`
 * were already true at subscribe time (catchup fires synchronously, before
 * the assignment to `jankSub` completes) — the same TDZ-shaped hazard
 * CLAUDE.md's SampleLoader section warns about, fixed here with the same
 * `subscribed` boolean guard pattern.
 */
export function armJankOnRecordingFlip(project: Project, jankMs: number, deadlineMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscribed = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (subscribed) sub.terminate();
      reject(new Error(`armJankOnRecordingFlip: isRecording never flipped true within ${deadlineMs / 1000}s`));
    }, deadlineMs);
    const sub = project.engine.isRecording.catchupAndSubscribe((obs) => {
      if (settled || !obs.getValue()) return;
      settled = true;
      clearTimeout(timer);
      const until = performance.now() + jankMs;
      while (performance.now() < until) {
        /* spin */
      }
      if (subscribed) sub.terminate();
      resolve();
    });
    subscribed = true;
  });
}

/** Task 9 fix round 1 (I3): finalization instrumentation, persisted per row so the
 *  loop-wrap hang mechanism (and the ring overshoot behind the `#finalize` head drop)
 *  rests on committed artifacts rather than console logs. The SDK's `RecordingWorklet`
 *  is the take's SampleLoader while it records; its `limit(count)` method is patched
 *  on the INSTANCE (the class method is untouched) to record every call together with
 *  `numberOfFrames` at that moment. A hung finalization is one with NO `limit()` call
 *  and a loader still in the `record` state after the wait. Field contract:
 *  `FinalizeProbe` in recordingAuditArtifacts.ts. */
export function instrumentFinalize(loader: SampleLoader): FinalizeProbe {
  const probe: FinalizeProbe = { finalizeLimitCalls: [], finalizeNumberOfFramesAtLimit: [], finalizeOvershootFrames: [] };
  const l = loader as unknown as { limit?: (count: number) => void; numberOfFrames?: number };
  if (typeof l.limit !== "function" || typeof l.numberOfFrames !== "number") return probe;
  const original = l.limit;
  l.limit = (count: number) => {
    const frames = l.numberOfFrames as number;
    probe.finalizeLimitCalls!.push(count);
    probe.finalizeNumberOfFramesAtLimit!.push(frames);
    probe.finalizeOvershootFrames!.push(frames - count);
    original.call(loader, count);
  };
  return probe;
}

export function settleFinalizeProbe(probe: FinalizeProbe, loader: SampleLoader): void {
  const l = loader as unknown as { numberOfFrames?: number };
  probe.finalizeNumberOfFramesAfter = typeof l.numberOfFrames === "number" ? l.numberOfFrames : undefined;
  probe.finalizeLoaderState = loader.state.type;
}

/** The probe of the repeat currently running, so a repeat that fails (a hung
 *  finalization is exactly the case of interest) still persists it on its error
 *  row. Written only by `runCellRepeat`; the caller reads it through
 *  `takeLastFinalizeProbe()` after a failed repeat and clears it before the next. */
let lastFinalizeProbe: FinalizeProbe | null = null;

/** The finalize probe of the most recent `runCellRepeat` attempt, or null when
 *  that attempt never reached the stop (nothing to report). */
export function takeLastFinalizeProbe(): FinalizeProbe | null {
  return lastFinalizeProbe;
}

/** Clear the carried-over probe before starting a repeat, so a failure that
 *  never reaches the stop cannot persist the PREVIOUS repeat's probe. */
export function clearLastFinalizeProbe(): void {
  lastFinalizeProbe = null;
}


/**
 * Common per-repeat sequence (task-4-brief.md Steps 2-5): set bpm/prefs,
 * schedule reference clicks, run the scenario-specific start, wait for the
 * scenario-specific stop condition, wait for finalization, then measure
 * every take region against the beat grid + reference schedule.
 *
 * Does NOT clean up take regions — that is the outer cell loop's job
 * (`resetForNextCell`, called unconditionally after every repeat attempt,
 * success or failure, so a mid-recording error never leaves stale regions
 * for the next repeat).
 */
export interface CellRepeatOptions {
  project: Project;
  audioContext: AudioContext;
  /** The page's installed loopback injection — reference clicks are scheduled on it
   *  and `resetForNextCell` cancels them through the same handle. */
  loopback: LoopbackHandle;
  unitAdapter: AudioUnitBoxAdapter;
  scenario: RecordingScenario;
  bpm: number;
  rate: number;
  repeat: number;
  onStage: (stage: string) => void;
  // Task 7 recast: audioContext.outputLatency — the register's "term 1" harness-path
  // bias (see debug/recording-start-alignment-audit.md "Bring-up calibration"),
  // passed through to measureTakeAlignment so classifyCell's verdicts run on the
  // adjusted median rather than the raw one. The value is resolved ONCE per page
  // load by `resolveHarnessPathBias` (after output has started, so it is never
  // Chrome's initial 0) and the same value reaches every repeat of every run on
  // this page; it is persisted on each row (`harnessPathBiasSec`) and in the
  // summary envelope, which therefore always describe the same number.
  harnessPathBiasSec: number;
  token: RepeatToken;
}

export async function runCellRepeat(options: CellRepeatOptions): Promise<CellRepeatResult> {
  const {
    project, audioContext, loopback, unitAdapter, scenario, bpm, rate, repeat, onStage,
    harnessPathBiasSec, token,
  } = options;
  onStage("prefs");
  project.editing.modify(() => {
    project.timelineBox.bpm.setValue(bpm);
  });
  const settings = project.engine.preferences.settings;
  settings.metronome.enabled = true;
  settings.recording.countInBars = 1;
  settings.recording.allowTakes = true;
  settings.recording.olderTakeAction = "mute-region";
  settings.recording.inputLatency = 0;

  // Loop area only for loop-wrap; disabled otherwise (same editing.modify).
  const { loopArea } = project.timelineBox;
  project.editing.modify(() => {
    loopArea.from.setValue(0);
    loopArea.to.setValue(2 * BAR_PPQN);
    loopArea.enabled.setValue(scenario === "loop-wrap");
  });

  // Reference clicks: start before recording, cover the longest cell
  // (loop-wrap 5 takes @97.3bpm ~= 25s) + margin.
  const schedule: ReferenceSchedule = buildReferenceSchedule(audioContext.currentTime + 0.2, 120, 0.25, 0.005);
  loopback.scheduleReferenceClicks(schedule.times);

  let recordRequestContextTime: number | null = null;
  let stopRequestContextTime: number | null = null;
  let startPpqn = 0;

  onStage("start");
  switch (scenario) {
    case "nominal-start": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
    }
    case "countin-start":
    case "loop-wrap": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(true); // 1-bar count-in
      break;
    }
    case "janked-start": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      recordRequestContextTime = audioContext.currentTime;
      // Fix round 1 (C1): `project.startRecording()` is fire-and-forget over an
      // ASYNC chain (`Recording.start` AWAITS `capture.prepareRecording()` — the
      // worklet-connect — before `engine.prepareRecordingState()` actually starts
      // the transport). Spinning immediately after the call, as this scenario
      // used to, blocks that continuation too: it defers capture-connect AND
      // transport-start together, which just delays when recording genuinely
      // begins (measured: raw headMissingMs tracked JANK_MS almost exactly,
      // 168.89ms jank mean − 18.58ms nominal baseline ≈ 150.3ms ≈ JANK_MS) —
      // not C's intended provocation (a main thread busy AFTER an audio-thread
      // anchor already exists, before the SDK reads/accepts it). Fix: key the
      // spin off our OWN subscription to `engine.isRecording` actually flipping
      // true (see `armJankOnRecordingFlip` above; fix round 2 rewrote this from
      // an inline, undeadlined Promise to that shared, self-terminating helper)
      // — by definition, everything up to and including
      // `engine.prepareRecordingState()` has already run by then, so capture is
      // genuinely live; only the SDK's post-flip position-tick handling (which
      // creates the take) is still pending and gets blocked by the spin.
      const jankArmed = armJankOnRecordingFlip(project, JANK_MS, 30_000);
      project.startRecording(false);
      await jankArmed;
      break;
    }
    case "midtimeline-start": {
      project.engine.setPosition(0);
      await waitForPositionSettled(project, 0, 30_000);
      assertCurrent(token, "play");
      project.engine.play();
      startPpqn = 2 * BAR_PPQN;
      await waitForPosition(project, startPpqn, 20_000);
      assertCurrent(token, "startRecording");
      recordRequestContextTime = audioContext.currentTime;
      project.startRecording(false);
      break;
    }
  }

  onStage("recording");
  assertCurrent(token, "recording wait");
  if (scenario === "loop-wrap") {
    await waitForTakeCount([unitAdapter], LOOP_WRAP_TAKES + 1, 90_000);
  } else {
    await waitForPosition(project, startPpqn + 4 * BAR_PPQN, 60_000);
  }

  onStage("stopping");
  // The side effects below (loader patch, lastFinalizeProbe, stopRecording)
  // must never run for a repeat the outer deadline already abandoned.
  assertCurrent(token, "stopping");
  // All takes on the tape share one file (see CLAUDE.md "Loop Take Buffer
  // Layout") — wait on any one region's loader. Looked up BEFORE the stop so the
  // finalization probe is armed before the SDK's stop path can call limit().
  const anyTake = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion())[0];
  if (!anyTake) throw new Error("no take regions created");
  const loader = anyTake.file.getOrCreateLoader();
  const finalizeProbe = instrumentFinalize(loader);
  lastFinalizeProbe = finalizeProbe;
  finalizeProbe.finalizeNumberOfFramesAtStop = (loader as unknown as { numberOfFrames?: number }).numberOfFrames;
  stopRequestContextTime = audioContext.currentTime;
  project.engine.stopRecording();

  onStage("finalizing");
  // Fix round 1 (C2): loop-wrap repeats were failing with
  // `finalizing: finalization timed out after 30s` (NOT the `waitForPosition`
  // transport-start quirk this scenario's error rows were previously
  // mis-attributed to). Diagnostic: widened to 90s to test "genuinely needs
  // more time" (harness deadline miscalibration) vs a real hang. Result: 4 of
  // 6 repeats STILL timed out at 90s (3x the original deadline) while the
  // other 2 finalized in under 5s — a binary fast-or-never split, not a slow
  // gradient — refuting the miscalibration hypothesis. Reverted to 30s (a
  // longer deadline bought nothing but wall-clock time); the timing itself
  // is kept as a diagnostic since it's cheap and helps future triage.
  const finalizeDeadlineMs = 30_000;
  const finalizeStart = performance.now();
  try {
    await waitForLoaderTerminal(loader, finalizeDeadlineMs, "finalization");
  } finally {
    settleFinalizeProbe(finalizeProbe, loader);
  }
  assertCurrent(token, "measuring");
  // Fix round 2 (cheap add): persisted per row below (`finalizeMs`) so the C2
  // fast-or-never finalization-timeout evidence is a committed artifact, not
  // console-only.
  const finalizeMs = performance.now() - finalizeStart;
  const firstQuantumTimeSec = readFirstQuantumTimeSec(loader);
  console.log(
    "[recording-alignment-audit] finalize " + cellLabel(scenario, bpm, repeat) +
    " took " + finalizeMs.toFixed(0) + "ms" +
    " (deadline " + finalizeDeadlineMs + "ms)"
  );

  onStage("measuring");
  const takeRegions = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion())
    .sort((a, b) => a.position - b.position);
  const dataOpt = loader.data;
  if (dataOpt.isEmpty()) throw new Error("loader loaded but data empty");
  const data = dataOpt.unwrap();
  const mono = data.frames[0]; // requestChannels = 1
  const { low, high } = bandSplit(mono, data.sampleRate);
  const lowOnsets = detectOnsets(low, data.sampleRate, { refractorySec: 0.1 });
  const highOnsets = detectOnsets(high, data.sampleRate, { refractorySec: 0.05 });

  // Bring-up diagnostic (Task 6, ALIGNED_TOLERANCE_MS calibration): pure
  // detector/graph-path noise, independent of any SDK placement math — each
  // identified reference click's residual against its OWN schedule entry,
  // relative to the median anchor. This isolates onset-detection + zero-phase
  // band-split jitter from everything RecordAudio.ts computes. Fix round 1
  // (I3): captured into variables and persisted on every row below (was
  // console-only), so this evidence lives in a committed artifact.
  let clockNoiseIdentifiedClicks: number | undefined;
  let clockNoiseMaxAbsResidualMs: number | undefined;
  {
    const identified = identifyReferenceClicks(highOnsets, schedule);
    const anchor = estimateAnchorT0(identified, schedule);
    if (anchor !== null && identified.length > 1) {
      const residualsMs = identified.map((c) => (schedule.times[c.index] - c.fileTimeSec - anchor) * 1000);
      const maxAbs = Math.max(...residualsMs.map((r) => Math.abs(r)));
      clockNoiseIdentifiedClicks = identified.length;
      clockNoiseMaxAbsResidualMs = maxAbs;
      console.log(
        "[recording-alignment-audit] clockNoise " + cellLabel(scenario, bpm, repeat) +
        " identifiedClicks=" + identified.length +
        " maxAbsResidualMs=" + maxAbs.toFixed(4) +
        " residualsMs=[" + residualsMs.map((r) => r.toFixed(3)).join(",") + "]"
      );
    }
  }

  const rows: AuditRow[] = [];
  const alignments: { takeIndex: number; alignment: TakeAlignment }[] = [];
  for (const [takeIndex, region] of takeRegions.entries()) {
    const regionStartSec = project.tempoMap.ppqnToSeconds(region.position);
    const waveformOffsetSec = region.box.waveformOffset.getValue();
    const regionDurationSec = project.tempoMap.intervalToSeconds(region.position, region.position + region.duration);
    const bufferDurationSec = data.numberOfFrames / data.sampleRate;
    const alignment = measureTakeAlignment({
      lowOnsets,
      highOnsets,
      regionStartSec,
      waveformOffsetSec,
      regionDurationSec,
      bufferDurationSec,
      bpm,
      schedule,
      recordRequestContextTime,
      stopRequestContextTime,
      headMissingBaselineMs: HEAD_MISSING_BASELINE_MS,
      harnessPathBiasSec,
    });
    alignments.push({ takeIndex, alignment });
    // No reference click identified: head/tail deficits are null and the row is
    // persisted with those nulls (classifyCell reports the cell "integrity
    // unmeasured" for it). Warned here so a live watcher sees it too.
    if (alignment.anchorT0Sec === null) {
      console.warn("[recording-alignment-audit] " + cellLabel(scenario, bpm, repeat) + "/take" + takeIndex + ": no reference-click anchor — head/tail integrity unmeasured for this repeat");
    }
    // Fix round 1 (I3): raw (uncorrected) head-missing, so both the corrected
    // and raw figures are available in the persisted row (was only derivable
    // by reversing HEAD_MISSING_BASELINE_MS by hand from console output).
    const headMissingRawMs =
      alignment.anchorT0Sec !== null && recordRequestContextTime !== null
        ? Math.max(0, (alignment.anchorT0Sec - recordRequestContextTime) * 1000)
        : null;
    // Bring-up diagnostic (Task 6): raw box-graph values behind every alignment
    // number, so a calibration bias can be traced to its source term instead of
    // inferred from the final medianBeatErrorMs alone. Fix round 1 (C3/I3):
    // also persisted on the row itself (was console-only).
    console.log(
      "[recording-alignment-audit] diag " + cellLabel(scenario, bpm, repeat) + "/take" + takeIndex +
      " position=" + String(region.position) +
      " regionStartSec=" + String(regionStartSec) +
      " waveformOffsetSec=" + String(waveformOffsetSec) +
      " anchorT0Sec=" + String(alignment.anchorT0Sec) +
      " recordRequestContextTime=" + String(recordRequestContextTime) +
      " medianBeatErrorMs=" + String(alignment.medianBeatErrorMs) +
      " medianBeatErrorMsAdjusted=" + String(alignment.medianBeatErrorMsAdjusted) +
      " headMissingMs=" + String(alignment.headMissingMs) +
      " headMissingRawMs=" + String(headMissingRawMs) +
      " firstQuantumTimeSec=" + String(firstQuantumTimeSec)
    );
    rows.push({
      scenario,
      bpm,
      rate,
      repeat,
      takeIndex,
      medianBeatErrorMs: alignment.medianBeatErrorMs,
      medianBeatErrorMsAdjusted: alignment.medianBeatErrorMsAdjusted,
      matchedBeats: alignment.matchedBeats,
      missingBeats: alignment.missingBeats,
      headMissingMs: alignment.headMissingMs,
      headMissingRawMs,
      tailMissingMs: alignment.tailMissingMs,
      stopRequestContextTime,
      bufferDurationSec,
      regionPositionPpqn: region.position,
      regionStartSec,
      waveformOffsetSec,
      regionDurationSec,
      anchorT0Sec: alignment.anchorT0Sec,
      recordRequestContextTime,
      finalizeMs,
      firstQuantumTimeSec,
      harnessPathBiasSec,
      ...finalizeProbe,
      clockNoiseIdentifiedClicks,
      clockNoiseMaxAbsResidualMs,
      status: "pending",
      matchedSignature: null,
      detail: "",
    });
  }

  return { rows, alignments, buffer: { channels: [mono], sampleRate: data.sampleRate } };
}

/**
 * Between-cells reset (task-4-brief.md Step 1): cancel any still-pending
 * reference clicks from this repeat's schedule (otherwise a stray onset from
 * an earlier repeat's ~65s schedule can leak into the NEXT repeat's captured
 * buffer and break `identifyReferenceClicks`' gap adjacency), stop any
 * lingering recording state, delete every take region on the tape's tracks
 * AND the shared AudioFileBox they point at (`region.box.delete()`
 * cascade-deletes the region's OWN mandatory dependents, but the file is an
 * outgoing pointer the region merely refers to — the SDK's own
 * `restartRecording()` cleanup path deletes regions the same way and leaves
 * the file box orphaned, verified by reading Project.js — so it must be
 * deleted here explicitly), then reset position.
 *
 * Runs unconditionally (success or failure) so a mid-recording error never
 * leaves stale regions for the next repeat/cell. Per CLAUDE.md's "Never Call
 * stop(true) During Recording Finalization" rule, an error mid-recording
 * (most commonly a `waitForPosition`/`waitForTakeCount` timeout — EXPECTED
 * in this campaign, see the WASM transport-start-delay note) can land here
 * while a take is still finalizing; `stop(true)` racing that finalization is
 * exactly what the rule warns against. So: if a take region exists whose
 * loader hasn't reached a terminal state yet, wait up to a bounded grace
 * period for it before deleting boxes / calling stop(true). If the grace
 * period also expires, proceed anyway (the campaign must not hang on one
 * bad cell) but return a warning string — the caller attaches it to the
 * affected row's `detail` so a human (or Task 6) can spot a cell whose
 * predecessor's cleanup may not have fully settled before it started.
 */
export async function resetForNextCell(
  project: Project,
  loopback: LoopbackHandle,
  unitAdapter: AudioUnitBoxAdapter
): Promise<string | null> {
  loopback.cancelReferenceClicks();
  if (project.engine.isRecording.getValue() || project.engine.isCountingIn.getValue()) {
    project.engine.stopRecording();
  }
  const takeRegions = unitAdapter.tracks
    .values()
    .flatMap((t) => [...t.regions.adapters.values()])
    .filter((r) => r.isAudioRegion());
  let warning: string | null = null;
  if (takeRegions.length > 0) {
    const loader = takeRegions[0].file.getOrCreateLoader();
    if (loader.state.type !== "loaded" && loader.state.type !== "error") {
      try {
        await waitForLoaderTerminal(loader, 10_000, "cleanup finalization grace");
      } catch (err) {
        warning = `finalization grace timed out before deleting take regions: ${String(err)}`;
        console.warn(`[recording-alignment-audit] ${warning}`);
      }
    }
    const fileBox = takeRegions[0].file.box;
    project.editing.modify(() => {
      takeRegions.forEach((r) => r.box.delete());
      fileBox.delete();
    });
  }
  project.engine.stop(true);
  project.engine.setPosition(0);
  return warning;
}
