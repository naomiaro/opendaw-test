import { assert, Procedure, Progress, unitValue, UUID } from "@opendaw/lib-std";
import { Promises } from "@opendaw/lib-runtime";
import { PPQN } from "@opendaw/lib-dsp";
import { AudioData, SampleMetaData, SoundfontMetaData } from "@opendaw/studio-adapters";
import {
  AudioWorklets,
  DefaultSampleLoaderManager,
  DefaultSoundfontLoaderManager,
  OpenSampleAPI,
  OpenSoundfontAPI,
  Project,
  Workers
} from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { testFeatures } from "../features";

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";

/**
 * Configuration options for custom sample loading
 */
export interface ProjectSetupOptions {
  /**
   * Optional map of local audio buffers to use instead of fetching from OpenSampleAPI
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
  const { localAudioBuffers, bpm = 120, onStatusUpdate } = options;

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

  // Install workers and worklets
  await Workers.install(WorkersUrl);
  AudioWorklets.install(WorkletsUrl);

  // Test browser features
  const { status: testStatus, error: testError } = await Promises.tryCatch(testFeatures());
  if (testStatus === "rejected") {
    throw new Error(`Could not test features: ${testError}`);
  }

  // Create AudioContext
  const audioContext = new AudioContext({ latencyHint: 0 });
  console.debug(`AudioContext state: ${audioContext.state}, sampleRate: ${audioContext.sampleRate}`);

  onStatusUpdate?.("Installing audio worklets...");

  // Create audio worklets
  const { status: workletStatus, error: workletError } = await Promises.tryCatch(AudioWorklets.createFor(audioContext));
  if (workletStatus === "rejected") {
    throw new Error(`Could not install Worklets: ${workletError}`);
  }

  // Create sample manager with optional local audio buffer support
  const sampleManager = new DefaultSampleLoaderManager({
    fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, SampleMetaData]> => {
      const uuidString = UUID.toString(uuid);
      console.debug(`Sample manager fetch called for UUID: ${uuidString}`);

      // Check if we have a local audio buffer for this UUID
      if (localAudioBuffers) {
        const audioBuffer = localAudioBuffers.get(uuidString);

        if (audioBuffer) {
          console.debug(
            `Found local audio buffer for ${uuidString}, channels: ${audioBuffer.numberOfChannels}, duration: ${audioBuffer.duration}s`
          );
          const audioData = OpenSampleAPI.fromAudioBuffer(audioBuffer);
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

      // Fall back to OpenSampleAPI for built-in samples
      console.debug(`No local buffer found for ${uuidString}, falling back to OpenSampleAPI`);
      return OpenSampleAPI.get().load(audioContext, uuid, progress);
    }
  });

  // Create soundfont manager
  const soundfontManager = new DefaultSoundfontLoaderManager({
    fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
      OpenSoundfontAPI.get().load(uuid, progress)
  });

  onStatusUpdate?.("Creating project...");

  // Create project
  const audioWorklets = AudioWorklets.get(audioContext);
  const project = Project.new({
    audioContext,
    sampleManager,
    soundfontManager,
    audioWorklets
  });

  // Set BPM if custom value provided
  if (bpm !== 120) {
    project.editing.modify(() => {
      project.timelineBox.bpm.setValue(bpm);
    });
  }

  // Start audio worklet and wait for engine to be ready
  project.startAudioWorklet();
  await project.engine.isReady();

  console.debug("Engine is ready!");
  onStatusUpdate?.("Loading tracks...");

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
