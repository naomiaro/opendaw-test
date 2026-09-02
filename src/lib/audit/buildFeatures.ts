/**
 * Which SDK surfaces the served build exposes, probed at page load and persisted
 * per run as the envelope's `buildFeatures`.
 *
 * Why a list and not just the `sdkBuildProbe` label: that label is one bit
 * ("candidate" for EVERY branch build this campaign has measured), so it cannot
 * say which branch, and the classifier's band table has to follow what the build
 * actually does. A list of named surfaces also survives being read years later
 * from a JSON on disk, where "candidate" means nothing on its own.
 *
 * Detection is a presence check on the live objects — no version strings, no
 * source greps: a build either hands the page the member or it does not.
 *  - `recordingStart`: the engine's one-shot audio-thread report of where and
 *    when recording began (`ObservableOption` on the engine facade), from the
 *    recording start-alignment fix.
 *  - `calibrateInputLatency`: the loopback input-latency calibration on
 *    `CaptureAudio`'s prototype.
 *  - `latencyProbes`: `LatencyProbes` exported by `@opendaw/lib-dsp`, the
 *    configurable calibration probe.
 *
 * The keep-alive sink has NO detectable surface — it is a graph edge inside
 * `#rebuildAudioChain`, not a member — so it is deliberately absent here rather
 * than guessed at from a source fetch or inferred from a measurement. What the
 * profile keys on is `calibrateInputLatency`; see `profileKeyFor` in
 * recordingAuditCalibration.ts for that rule and its known limit.
 *
 * This module imports the SDK, so it is used by the browser harnesses only; the
 * offline scripts read the persisted names through recordingAuditCalibration.ts,
 * which stays SDK-free.
 */
import * as LibDsp from "@opendaw/lib-dsp";
import { CaptureAudio } from "@opendaw/studio-core";
import type { AuditBuildFeature } from "./recordingAuditCalibration";

/**
 * Probe the live SDK. `engine` is `project.engine`; everything else is read from
 * the modules this file imports, so a caller cannot pass an inconsistent view.
 */
export function detectBuildFeatures(engine: unknown): AuditBuildFeature[] {
  const features: AuditBuildFeature[] = [];
  const facade = engine as { recordingStart?: { isEmpty?: unknown } };
  if (typeof facade?.recordingStart?.isEmpty === "function") features.push("recordingStart");
  const capturePrototype = CaptureAudio.prototype as unknown as { calibrateInputLatency?: unknown };
  if (typeof capturePrototype.calibrateInputLatency === "function") features.push("calibrateInputLatency");
  if ((LibDsp as Record<string, unknown>).LatencyProbes !== undefined) features.push("latencyProbes");
  return features;
}
