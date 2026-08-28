import { assert, Progress, UUID } from "@opendaw/lib-std";
import { Promises } from "@opendaw/lib-runtime";
import { PPQN } from "@opendaw/lib-dsp";
import { BpmDetector, SampleMetaData, SoundfontMetaData } from "@opendaw/studio-adapters";
import type { AudioData } from "@opendaw/lib-dsp";
import { audioBufferToAudioData } from "./audioUtils";
import {
  AudioWorklets,
  GlobalSampleLoaderManager,
  GlobalSoundfontLoaderManager,
  Project,
  Workers,
  SampleProvider,
  SoundfontProvider,
  SampleService,
} from "@opendaw/studio-core";
import type { SoundfontService } from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { testFeatures } from "../features";
import { installWasmEngine, ensureWasmReady } from "./wasmEngine";
import { withDeadline } from "./deadline";

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";

/**
 * Configuration options for custom sample loading
 */
export interface ProjectSetupOptions {
  /**
   * Map of local audio buffers for sample loading.
   * Key: UUID string, Value: AudioBuffer
   */
  localAudioBuffers?: Map<string, AudioBuffer>;

  /**
   * Optional custom BPM for the project (default: 120)
   */
  bpm?: number;

  /**
   * Optional status update callback for progress messages
   */
  onStatusUpdate?: (status: string) => void;

  /**
   * Optional forced AudioContext sample rate, e.g. for sample-rate-alignment
   * audit sessions (see debug/sample-rate-alignment-audit.md). Threaded into
   * `new AudioContext({ sampleRate })`. Omit for default (device-native) rate —
   * browsers reject unsupported rates by throwing from the AudioContext
   * constructor, which surfaces as an initialization failure.
   */
  audioContextSampleRate?: number;
}

/**
 * Result of OpenDAW project setup
 */
export interface ProjectSetupResult {
  project: Project;
  audioContext: AudioContext;
}

/**
 * Initialize OpenDAW with all required setup steps.
 * This includes:
 * - AnimationFrame initialization (required for observables)
 * - Workers and Worklets installation
 * - Feature testing
 * - AudioContext creation
 * - Sample and soundfont manager setup
 * - Project creation and engine initialization
 *
 * @param options - Optional configuration for custom sample loading and BPM
 * @returns Promise resolving to initialized Project and AudioContext
 * @throws Error if initialization fails or features are not supported
 *
 * @example
 * ```typescript
 * // Basic setup
 * const { project, audioContext } = await initializeOpenDAW();
 *
 * // With custom audio buffers
 * const localBuffers = new Map<string, AudioBuffer>();
 * localBuffers.set(uuidString, audioBuffer);
 *
 * const { project, audioContext } = await initializeOpenDAW({
 *   localAudioBuffers: localBuffers,
 *   bpm: 90,
 *   onStatusUpdate: (status) => console.log(status)
 * });
 * ```
 */
export async function initializeOpenDAW(options: ProjectSetupOptions = {}): Promise<ProjectSetupResult> {
  const { localAudioBuffers, bpm = 120, onStatusUpdate, audioContextSampleRate } = options;

  console.log("========================================");
  console.log("openDAW -> headless -> initializing");
  console.log("WorkersUrl", WorkersUrl);
  console.log("WorkletsUrl", WorkletsUrl);
  console.log("crossOriginIsolated:", crossOriginIsolated);
  console.log("SharedArrayBuffer available:", typeof SharedArrayBuffer !== "undefined");
  console.log("========================================");

  // CRITICAL: Ensure cross-origin isolation is enabled
  assert(crossOriginIsolated, "window must be crossOriginIsolated");

  // CRITICAL: Start the AnimationFrame loop for observable updates
  console.debug("Starting AnimationFrame loop...");
  AnimationFrame.start(window);
  console.debug("AnimationFrame started!");

  onStatusUpdate?.("Booting...");

  // Install workers and worklets. The offline engine worker is registered by
  // installWasmEngine() below — WasmEngine.install wires its own worker into
  // OfflineEngineRenderer (the TS offline worker was removed with the TS engine).
  await Workers.install(WorkersUrl);
  AudioWorklets.install(WorkletsUrl);

  // Test browser features
  const { status: testStatus, error: testError } = await Promises.tryCatch(testFeatures());
  if (testStatus === "rejected") {
    throw new Error(`Could not test features: ${testError}`);
  }

  // Create AudioContext
  const audioContext = new AudioContext(
    audioContextSampleRate !== undefined
      ? { latencyHint: 0, sampleRate: audioContextSampleRate }
      : { latencyHint: 0 }
  );
  console.debug(`AudioContext state: ${audioContext.state}, sampleRate: ${audioContext.sampleRate}`);

  onStatusUpdate?.("Installing audio worklets...");

  // Create audio worklets
  const { status: workletStatus, error: workletError } = await Promises.tryCatch(AudioWorklets.createFor(audioContext));
  if (workletStatus === "rejected") {
    throw new Error(`Could not install Worklets: ${workletError}`);
  }

  // Create sample manager with optional local audio buffer support
  const sampleProvider: SampleProvider = {
    fetch: async (uuid: UUID.Bytes, _progress: Progress.Handler): Promise<[AudioData, SampleMetaData]> => {
      const uuidString = UUID.toString(uuid);
      console.debug(`Sample manager fetch called for UUID: ${uuidString}`);

      // Check if we have a local audio buffer for this UUID
      if (localAudioBuffers) {
        const audioBuffer = localAudioBuffers.get(uuidString);

        if (audioBuffer) {
          console.debug(
            `Found local audio buffer for ${uuidString}, channels: ${audioBuffer.numberOfChannels}, duration: ${audioBuffer.duration}s`
          );
          const audioData = audioBufferToAudioData(audioBuffer);
          const metadata: SampleMetaData = {
            name: uuidString,
            bpm,
            duration: audioBuffer.duration,
            sample_rate: audioBuffer.sampleRate,
            origin: "import"
          };
          return [audioData, metadata];
        }
      }

      // No local buffer found — warn instead of hitting the OpenDAW API (CORS fails in dev)
      console.warn(`No local audio buffer found for UUID: ${uuidString}. The sample will not be available.`);
      throw new Error(`Sample not found locally: ${uuidString}`);
    }
  };
  const sampleManager = new GlobalSampleLoaderManager(sampleProvider);

  // Create soundfont manager.
  // OpenSoundfontAPI was removed from @opendaw/studio-core in SDK 0.0.155 (moved into the
  // app-studio package). It fetched from api.opendaw.studio (CORS issues in dev) and none of
  // the demos use soundfont instruments, so this provider is never exercised — reject with a
  // clear message, mirroring how sampleProvider handles the no-local case.
  const soundfontProvider: SoundfontProvider = {
    fetch: async (uuid: UUID.Bytes, _progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> => {
      const uuidString = UUID.toString(uuid);
      // Warn before throwing (matches sampleProvider) — the SDK loader also logs the rejection,
      // but a descriptive pre-throw line keeps both providers symmetric.
      console.warn(`No soundfont available for UUID: ${uuidString}. Soundfont loading is disabled in opendaw-headless.`);
      throw new Error(`Soundfont not available locally: ${uuidString}. Soundfont loading is disabled in opendaw-headless.`);
    }
  };
  const soundfontManager = new GlobalSoundfontLoaderManager(soundfontProvider);

  onStatusUpdate?.("Creating project...");

  // Clear persisted engine preferences before project creation so demos start fresh.
  // This prevents settings from a previous session affecting the current demo.
  try {
    localStorage.removeItem("engine-preferences");
  } catch (error) {
    // Storage-blocked contexts (sandboxed iframe, storage disabled) throw a raw
    // SecurityError here. A stale persisted flag can't exist in such a context
    // either, so there is nothing to clear — warn and continue.
    console.warn("localStorage unavailable — cannot clear persisted engine preferences: " + String(error));
  }

  // Create sample service (0.0.124+: required for recording finalization).
  // 0.0.167 requires a BpmDetector: it only runs in importFile when no bpm is
  // given, and every path that reaches importFile in this repo supplies an
  // explicit bpm (recording finalization via importRecording, which delegates
  // to importFile with the capture bpm), so the no-op detector never runs. To
  // get real tempo detection for bpm-less imports, mirror the studio app:
  // new WasmBpmDetector(<url of studio-core-wasm/dist/wasm/stretch_wasm.wasm>).
  const sampleService = new SampleService(audioContext, BpmDetector.Unknown);
  // Skip SoundfontService — its constructor fetches from api.opendaw.studio (CORS issues
  // in dev, and none of the demos use soundfont instruments). The SDK declares
  // soundfontService in ProjectEnv but never reads it internally (verified in 0.0.128).
  // Proxy guard ensures a clear error if a future SDK version starts accessing it.
  const soundfontService = new Proxy({} as SoundfontService, {
    get(_target, prop) {
      throw new Error(
        `SoundfontService.${String(prop)} was accessed, but SoundfontService is disabled. ` +
        `Its constructor fetches from api.opendaw.studio (CORS issues in dev). ` +
        `To enable, replace this proxy with: new SoundfontService()`
      );
    },
  });

  // Create project
  const audioWorklets = AudioWorklets.get(audioContext);
  const project = Project.new({
    audioContext,
    sampleManager,
    soundfontManager,
    audioWorklets,
    sampleService,
    soundfontService,
  });

  // Set BPM if custom value provided
  if (bpm !== 120) {
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }

  // WASM (Rust) engine only — the TypeScript engine is being removed upstream and this
  // repo no longer wires it. Must run BEFORE the first startAudioWorklet():
  // EngineWorklet reads EngineVariant.current() at construction time.
  installWasmEngine();
  onStatusUpdate?.("Compiling WASM engine...");
  // Compile + fetch of the wasm binaries has no ceiling of its own — a processor that
  // compiles but errors at worklet construction would otherwise hang every page load
  // at "Compiling WASM engine..." forever. Generous budget: this covers first-visit
  // cold fetch of the wasm binaries, not just compilation.
  const wasmReady = await withDeadline(
    ensureWasmReady(audioContext),
    60_000,
    "WASM engine compile"
  );
  if (!wasmReady) {
    // WasmEngine.ensureReady() (@opendaw/studio-core-wasm) already logs
    // `console.warn("WASM engine unavailable:", error)` on the failure path — no need to
    // duplicate it here, just point the thrown error at it.
    throw new Error(
      "WASM engine failed to initialize (artifacts missing or compilation failed). " +
        "There is no TypeScript fallback — check that /wasm-engine assets are served " +
        "(wasm-engine-assets Vite plugin) and that the browser supports WebAssembly. " +
        "See the 'WASM engine unavailable' console warning for the underlying error."
    );
  }

  onStatusUpdate?.("Starting engine...");

  // Start audio worklet and wait for engine to be ready
  project.startAudioWorklet();
  // engine.isReady() resolves once the worklet reports ready, or HANGS forever — it never
  // rejects. A processor that compiles cleanly but throws during worklet construction
  // (e.g. inside processorOptions handling) would otherwise stick every page at "Starting
  // engine..." with no error surfaced. 30s matches the previous switchEngine() REBOOT_TIMEOUT_MS.
  await withDeadline(project.engine.isReady(), 30_000, "engine boot");

  console.debug("Engine is ready!");
  onStatusUpdate?.("Loading tracks...");

  // Resume AudioContext on first user interaction if it starts suspended
  // (browsers require a user gesture before audio can play)
  if (audioContext.state === "suspended") {
    const resume = () => {
      audioContext.resume();
      document.removeEventListener("click", resume);
      document.removeEventListener("keydown", resume);
    };
    document.addEventListener("click", resume);
    document.addEventListener("keydown", resume);
  }

  // First-click fix: the document-level resume listener above fires AFTER React's
  // click handler (bubble order), so a demo's very first Play click calls
  // engine.play() while the context is still suspended — and that transport command
  // is LOST (verified: fresh load, first Play click leaves the position at 0.000;
  // the second click plays). Wrap the persistent facade's play() to resume the
  // context first — one central guarantee instead of `await resume()` at every
  // demo call site. resume() here always runs inside a user gesture (the click
  // that invoked the handler), so autoplay policy is satisfied.
  const facadePlay = project.engine.play.bind(project.engine);
  project.engine.play = (): void => {
    if (audioContext.state === "running") {
      facadePlay();
      return;
    }
    void audioContext.resume()
      .then(facadePlay)
      .catch(e => console.error("[projectSetup] play resume failed: " + String(e)));
  };

  // Same fix, same reason: clip-launcher demos have no Play button — the
  // first user gesture on a fresh load is a clip-cell click, and
  // scheduleClipPlay forwards straight to the worklet with no resume of its
  // own (unlike play(), which the SDK's EngineFacade already resumes
  // internally). Wrap scheduleClipStop too for symmetry, though stopping a
  // clip can't itself be the first gesture in practice.
  const facadeScheduleClipPlay = project.engine.scheduleClipPlay.bind(project.engine);
  project.engine.scheduleClipPlay = (clipIds): void => {
    if (audioContext.state === "running") {
      facadeScheduleClipPlay(clipIds);
      return;
    }
    void audioContext.resume().then(() => facadeScheduleClipPlay(clipIds));
  };
  const facadeScheduleClipStop = project.engine.scheduleClipStop.bind(project.engine);
  project.engine.scheduleClipStop = (trackIds): void => {
    if (audioContext.state === "running") {
      facadeScheduleClipStop(trackIds);
      return;
    }
    void audioContext.resume().then(() => facadeScheduleClipStop(trackIds));
  };

  return { project, audioContext };
}

/**
 * Sets the timeline loop end to accommodate the longest audio track.
 *
 * By default, OpenDAW's timeline loop end is set to 15360 PPQN (~16 seconds at 120 BPM).
 * For demos with longer tracks, call this function after loading audio to extend the loop
 * to match the longest track duration.
 *
 * @param project - The OpenDAW project instance
 * @param audioBuffers - Map of audio buffers (UUID string -> AudioBuffer)
 * @param bpm - Optional BPM override (defaults to project's current BPM)
 *
 * @example
 * ```typescript
 * // After loading tracks
 * const audioBuffers = new Map<string, AudioBuffer>();
 * audioBuffers.set(uuid1, buffer1);
 * audioBuffers.set(uuid2, buffer2);
 *
 * // Set loop end to longest track
 * setLoopEndFromTracks(project, audioBuffers);
 * ```
 */
export function setLoopEndFromTracks(project: Project, audioBuffers: Map<string, AudioBuffer>, bpm?: number): void {
  if (audioBuffers.size === 0) {
    console.warn("No audio buffers provided to setLoopEndFromTracks");
    return;
  }

  // Get BPM from project if not provided
  const effectiveBpm = bpm ?? project.timelineBox.bpm.getValue();

  // Calculate the max duration from the audio buffers
  const maxDurationSeconds = Math.max(...Array.from(audioBuffers.values()).map(buf => buf.duration));

  // Convert to PPQN
  const loopEndInPPQN = PPQN.secondsToPulses(maxDurationSeconds, effectiveBpm);

  // Set the loop end in a transaction
  project.editing.modify(() => {
    project.timelineBox.loopArea.to.setValue(loopEndInPPQN);
  });

  console.debug(
    `[setLoopEndFromTracks] Set loop end to ${loopEndInPPQN} PPQN (${maxDurationSeconds.toFixed(2)}s at ${effectiveBpm} BPM)`
  );
}
