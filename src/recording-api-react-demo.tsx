// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { assert, Procedure, Progress, unitValue, UUID } from "@opendaw/lib-std";
import { Promises } from "@opendaw/lib-runtime";
import { SampleMetaData, SoundfontMetaData } from "@opendaw/studio-adapters";
import {
  AudioWorklets,
  DefaultSampleLoaderManager,
  DefaultSoundfontLoaderManager,
  InstrumentFactories,
  OpenSampleAPI,
  OpenSoundfontAPI,
  Project,
  Workers,
  SampleStorage
} from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Peaks, PeaksPainter } from "@opendaw/lib-fusion";
import { testFeatures } from "./features";

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";

/**
 * Main Recording Demo App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);

  // UI state
  const [isArmed, setIsArmed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isCountingIn, setIsCountingIn] = useState(false);
  const [countInBeatsRemaining, setCountInBeatsRemaining] = useState(0);
  const [useCountIn, setUseCountIn] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [armStatus, setArmStatus] = useState('Click "Arm Track" to prepare for recording');
  const [recordStatus, setRecordStatus] = useState("Arm a track first");
  const [playbackStatus, setPlaybackStatus] = useState("No recording available");
  const [hasPeaks, setHasPeaks] = useState(false);

  // Refs for non-reactive values - these don't need to trigger re-renders
  const tapeUnitRef = useRef<{ audioUnitBox: any; trackBox: any } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const renderPeaksDirectly = useCallback((peaks: any) => {
    if (!canvasRef.current) return false;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    // Clear canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Check if this is a PeaksWriter (during recording) or Peaks (after recording)
    const isPeaksWriter = "dataIndex" in peaks;

    if (isPeaksWriter) {
      // PeaksWriter: Use actual written peaks count from dataIndex
      const numWrittenPeaks = peaks.dataIndex[0]; // All channels should have same index

      if (numWrittenPeaks === 0) {
        return false; // No peaks written yet
      }

      // Calculate actual number of frames from written peaks
      const actualFrames = numWrittenPeaks * peaks.unitsEachPeak();

      // Set waveform color
      ctx.fillStyle = "#4a9eff";

      // Render each channel
      for (let channel = 0; channel < peaks.numChannels; channel++) {
        const channelHeight = canvas.height / peaks.numChannels;
        const y0 = channel * channelHeight;
        const y1 = (channel + 1) * channelHeight;

        PeaksPainter.renderBlocks(ctx, peaks, channel, {
          x0: 0,
          x1: canvas.width,
          y0,
          y1,
          u0: 0,
          u1: actualFrames,
          v0: -1,
          v1: 1
        });
      }
    } else {
      // Regular Peaks object (after recording completes)
      ctx.fillStyle = "#4a9eff";

      for (let channel = 0; channel < peaks.numChannels; channel++) {
        const channelHeight = canvas.height / peaks.numChannels;
        const y0 = channel * channelHeight;
        const y1 = (channel + 1) * channelHeight;

        PeaksPainter.renderBlocks(ctx, peaks, channel, {
          x0: 0,
          x1: canvas.width,
          y0,
          y1,
          u0: 0,
          u1: peaks.numFrames,
          v0: -1,
          v1: 1
        });
      }
    }

    setHasPeaks(true);
    return true;
  }, []);

  // Subscribe to count-in and recording observables
  useEffect(() => {
    if (!project) return undefined;

    const countingInSubscription = project.engine.isCountingIn.catchupAndSubscribe(obs => {
      const countingIn = obs.getValue();
      setIsCountingIn(countingIn);

      // Update status when count-in finishes
      if (!countingIn && isRecording) {
        setRecordStatus("Recording...");
      }
    });

    const beatsRemainingSubscription = project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
      setCountInBeatsRemaining(Math.ceil(obs.getValue()));
    });

    const recordingSubscription = project.engine.isRecording.catchupAndSubscribe(obs => {
      const recording = obs.getValue();

      if (recording) {
        // Update status when recording starts (after count-in)
        if (!project.engine.isCountingIn.getValue()) {
          setRecordStatus("Recording...");
        }
      } else {
        // Update status when recording stops
        setRecordStatus("Recording stopped");
      }
    });

    return () => {
      countingInSubscription.terminate();
      beatsRemainingSubscription.terminate();
      recordingSubscription.terminate();
    };
  }, [project, isRecording]);

  // Watch for new AudioRegionBox creation during recording to get live peaks
  useEffect(() => {
    if (!project || !tapeUnitRef.current || !isRecording) return undefined;

    console.log("[LIVE PEAKS] Effect started, isRecording:", isRecording);
    const { trackBox } = tapeUnitRef.current;
    let animationFrameId: number;
    let currentRecordingWorklet: any = null;

    const pollForPeaks = () => {
      if (!isRecording || !currentRecordingWorklet) {
        return;
      }

      // RecordingWorklet.peaks returns Option<PeaksWriter> during recording
      const peaksOption = currentRecordingWorklet.peaks;
      console.log("[LIVE PEAKS] peaksOption:", peaksOption, "isEmpty:", peaksOption?.isEmpty());

      if (peaksOption && !peaksOption.isEmpty()) {
        const peaks = peaksOption.unwrap();
        const isPeaksWriter = "dataIndex" in peaks;
        console.log("[LIVE PEAKS] Got peaks, isPeaksWriter:", isPeaksWriter);

        if (isPeaksWriter) {
          console.log("[LIVE PEAKS] dataIndex[0]:", peaks.dataIndex[0], "numChannels:", peaks.numChannels);
        }

        const rendered = renderPeaksDirectly(peaks);
        console.log("[LIVE PEAKS] Rendered:", rendered);
      }

      // Continue polling at 60fps for smooth waveform updates
      animationFrameId = requestAnimationFrame(pollForPeaks);
    };

    // Check for new AudioRegionBox created by RecordAudio.start()
    const checkForRecording = () => {
      // Access regions via pointerHub.incoming() - same pattern as in Recording.js
      const regions = trackBox.regions.pointerHub.incoming().map(({ box }) => box);
      console.log("[LIVE PEAKS] Checking for regions, count:", regions.length);

      if (regions.length > 0) {
        const latestRegion = regions[regions.length - 1];

        // Check if the pointer is set
        if (latestRegion.file.isEmpty()) {
          console.log("[LIVE PEAKS] File pointer is empty, checking again...");
          setTimeout(checkForRecording, 100);
          return;
        }

        // Get the recording UUID - targetAddress is an Option type, so unwrap it
        const targetAddressOption = latestRegion.file.targetAddress;

        if (targetAddressOption.isEmpty()) {
          console.log("[LIVE PEAKS] No target address yet, checking again...");
          setTimeout(checkForRecording, 100);
          return;
        }

        const targetAddress = targetAddressOption.unwrap();
        const recordingUUID = targetAddress.uuid;
        console.log("[LIVE PEAKS] Recording UUID:", UUID.toString(recordingUUID));

        // Get the RecordingWorklet from the sample manager
        currentRecordingWorklet = project.sampleManager.getOrCreate(recordingUUID);
        console.log("[LIVE PEAKS] Got worklet:", currentRecordingWorklet);
        console.log("[LIVE PEAKS] Worklet type:", currentRecordingWorklet?.constructor?.name);

        // Start polling for live peaks
        pollForPeaks();
      } else {
        // AudioRegionBox not created yet, check again soon
        console.log("[LIVE PEAKS] No regions yet, checking again...");
        setTimeout(checkForRecording, 100);
      }
    };

    checkForRecording();

    return () => {
      console.log("[LIVE PEAKS] Cleaning up");
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [project, isRecording, renderPeaksDirectly]);

  // Sync metronome enabled state with engine
  useEffect(() => {
    if (!project) return;
    project.engine.metronomeEnabled.setValue(metronomeEnabled);
  }, [project, metronomeEnabled]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        assert(crossOriginIsolated, "window must be crossOriginIsolated");

        // CRITICAL: Start the AnimationFrame loop that reads state from the worklet!
        AnimationFrame.start(window);

        setStatus("Booting...");
        await Workers.install(WorkersUrl);
        AudioWorklets.install(WorkletsUrl);

        // Delete obsolete samples
        SampleStorage.cleanDeprecated().then();

        const { status: testStatus, error: testError } = await Promises.tryCatch(testFeatures());
        if (testStatus === "rejected") {
          alert(`Could not test features (${testError})`);
          return;
        }

        const newAudioContext = new AudioContext({ latencyHint: 0 });

        const { status: workletStatus, error: workletError } = await Promises.tryCatch(
          AudioWorklets.createFor(newAudioContext)
        );
        if (workletStatus === "rejected") {
          alert(`Could not install Worklets (${workletError})`);
          return;
        }

        const sampleManager = new DefaultSampleLoaderManager({
          fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[any, SampleMetaData]> =>
            OpenSampleAPI.get().load(newAudioContext, uuid, progress)
        });

        const soundfontManager = new DefaultSoundfontLoaderManager({
          fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
            OpenSoundfontAPI.get().load(uuid, progress)
        });

        const audioWorklets = AudioWorklets.get(newAudioContext);
        const newProject = Project.new({
          audioContext: newAudioContext,
          sampleManager,
          soundfontManager,
          audioWorklets
        });
        newProject.startAudioWorklet();
        await newProject.engine.isReady();

        if (!mounted) return;

        setAudioContext(newAudioContext);
        setProject(newProject);
        setStatus("Ready!");
      } catch (error) {
        console.error("Initialization error:", error);
        setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleArmTrack = useCallback(async () => {
    if (!project) return;

    if (isArmed) {
      // Disarm - this automatically stops the microphone stream
      const captures = project.captureDevices.filterArmed();
      captures.forEach(capture => capture.armed.setValue(false));
      setIsArmed(false);
      setArmStatus("Track disarmed");
      setRecordStatus("Arm a track first");
      return;
    }

    try {
      setArmStatus("Preparing to record...");

      // Create a tape instrument if doesn't exist
      if (!tapeUnitRef.current) {
        project.editing.modify(() => {
          const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);
          tapeUnitRef.current = { audioUnitBox, trackBox };
        });
      }

      // Get the capture device for this audio unit
      const uuid = tapeUnitRef.current.audioUnitBox.address.uuid;
      const captureOption = project.captureDevices.get(uuid);

      if (captureOption.isEmpty()) {
        throw new Error("Could not get capture device");
      }

      const capture = captureOption.unwrap();

      // Arming automatically requests microphone access via CaptureAudio.prepareRecording()
      // The system handles: getUserMedia(), stream management, and cleanup
      capture.armed.setValue(true);

      setIsArmed(true);
      setArmStatus("Track is armed and ready to record");
      setRecordStatus("Ready to record");
    } catch (error) {
      console.error("Failed to arm track:", error);
      setArmStatus(`Error: ${error}`);
    }
  }, [project, isArmed]);

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    try {
      setIsRecording(true);

      // Resume AudioContext if suspended (required for user interaction)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Ensure engine is stopped before starting recording
      project.engine.stop(true);
      project.engine.setPosition(0);

      // Start recording (with or without count-in)
      // The count-in state is tracked by the observable subscriptions in useEffect
      project.startRecording(useCountIn);

      setRecordStatus(useCountIn ? "Count-in..." : "Recording...");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecordStatus(`Error: ${error}`);
      setIsRecording(false);
    }
  }, [project, audioContext, useCountIn]);

  const handleStopRecording = useCallback(async () => {
    if (!project) return;

    project.engine.stopRecording();
    setIsRecording(false);
    setPlaybackStatus("Recording ready to play");
    // Peaks are already rendered live during recording!
  }, [project]);

  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    // Resume AudioContext if suspended
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    project.engine.setPosition(0);
    project.engine.play();
    setPlaybackStatus("Playing...");
  }, [project, audioContext]);

  const handleStopPlayback = useCallback(() => {
    if (!project) return;

    project.engine.stop(true);
    project.engine.setPosition(0);
    setPlaybackStatus("Playback stopped");
  }, [project]);

  if (!project) {
    return (
      <div className="container">
        <h1>Recording API React Demo</h1>
        <p className="subtitle">{status}</p>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Recording API React Demo</h1>
      <p className="description">Testing OpenDAW's high-level Recording API with React</p>
      <div className="tech-note">
        <strong>Note:</strong> This demo uses the Recording.start() API which requires arming a track and depends on
        engine observables. The tape unit reference is stored in a React useRef to avoid unnecessary re-renders and
        searching.
      </div>

      <div className="section">
        <h2>Setup</h2>
        <div className="button-group">
          <button onClick={handleArmTrack} className={isArmed ? "armed" : ""}>
            {isArmed ? "✓ Track Armed (click to disarm)" : "🎯 Arm Track for Recording"}
          </button>
        </div>
        <div className="status">{armStatus}</div>
      </div>

      <div className="section">
        <h2>Record Audio</h2>
        <div className="checkbox-group">
          <label>
            <input type="checkbox" checked={useCountIn} onChange={e => setUseCountIn(e.target.checked)} />
            <span>Use count-in before recording</span>
          </label>
        </div>
        <div className="checkbox-group">
          <label>
            <input type="checkbox" checked={metronomeEnabled} onChange={e => setMetronomeEnabled(e.target.checked)} />
            <span>Enable metronome (you'll hear clicks during count-in and recording)</span>
          </label>
        </div>

        {isCountingIn && (
          <div className="count-in-display">
            <div className="count-in-icon">🎵</div>
            <div className="count-in-text">Count-in: {countInBeatsRemaining} beats remaining</div>
          </div>
        )}

        <div className="button-group">
          <button
            onClick={handleStartRecording}
            disabled={!isArmed || isRecording}
            className={isRecording ? "recording" : ""}
          >
            ⏺ Start Recording
          </button>
          <button onClick={handleStopRecording} disabled={!isRecording}>
            ⏹ Stop Recording
          </button>
        </div>
        <div className="status">{recordStatus}</div>
      </div>

      <div className="section">
        <h2>Playback</h2>
        <div className="button-group">
          <button onClick={handlePlayRecording} disabled={isRecording}>
            ▶ Play Recording
          </button>
          <button onClick={handleStopPlayback}>⏹ Stop</button>
        </div>
        <div className="status">{playbackStatus}</div>
        <div className="waveform-container" style={{ display: hasPeaks ? "flex" : "none" }}>
          <canvas ref={canvasRef} width={800} height={200} className="waveform-canvas" />
        </div>
      </div>
    </div>
  );
};

// Bootstrap the React app
const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
