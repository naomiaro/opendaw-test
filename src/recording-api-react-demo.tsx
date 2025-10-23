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
  Workers
} from "@opendaw/studio-core";
import { AnimationFrame } from "@opendaw/lib-dom";
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
  const [useCountIn, setUseCountIn] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [armStatus, setArmStatus] = useState('Click "Arm Track" to prepare for recording');
  const [recordStatus, setRecordStatus] = useState("Arm a track first");
  const [playbackStatus, setPlaybackStatus] = useState("No recording available");

  // Refs for non-reactive values - these don't need to trigger re-renders
  const tapeUnitRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  // Sync metronome enabled state with engine
  useEffect(() => {
    if (!project) return;

    console.debug("Setting metronome enabled:", metronomeEnabled);
    project.engine.metronomeEnabled.setValue(metronomeEnabled);
  }, [project, metronomeEnabled]);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        console.debug("openDAW -> headless -> Recording API React demo");
        console.debug("WorkersUrl", WorkersUrl);
        console.debug("WorkletsUrl", WorkletsUrl);
        assert(crossOriginIsolated, "window must be crossOriginIsolated");
        console.debug("booting...");

        // CRITICAL: Start the AnimationFrame loop that reads state from the worklet!
        console.debug("Starting AnimationFrame loop...");
        AnimationFrame.start(window);
        console.debug("AnimationFrame started!");

        setStatus("Booting...");
        await Workers.install(WorkersUrl);
        AudioWorklets.install(WorkletsUrl);

        const { status: testStatus, error: testError } = await Promises.tryCatch(testFeatures());
        if (testStatus === "rejected") {
          alert(`Could not test features (${testError})`);
          return;
        }

        const newAudioContext = new AudioContext({ latencyHint: 0 });
        console.debug(`AudioContext state: ${newAudioContext.state}, sampleRate: ${newAudioContext.sampleRate}`);

        const { status: workletStatus, error: workletError } = await Promises.tryCatch(
          AudioWorklets.createFor(newAudioContext)
        );
        if (workletStatus === "rejected") {
          alert(`Could not install Worklets (${workletError})`);
          return;
        }

        const sampleManager = new DefaultSampleLoaderManager({
          fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[any, SampleMetaData]> => {
            console.debug(`Sample manager fetch called for UUID: ${UUID.toString(uuid)}`);
            return OpenSampleAPI.get().load(newAudioContext, uuid, progress);
          }
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

        console.debug("Project ready!");

        // Subscribe to engine state changes
        newProject.engine.isPlaying.subscribe(obs => console.debug("[ENGINE] isPlaying:", obs.getValue()));
        newProject.engine.isRecording.subscribe(obs => console.debug("[ENGINE] isRecording:", obs.getValue()));
        newProject.engine.position.subscribe(obs => console.debug("[ENGINE] position:", obs.getValue()));

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
      // Disarm
      console.debug("Disarming track...");
      const captures = project.captureDevices.filterArmed();
      captures.forEach(capture => capture.armed.setValue(false));
      setIsArmed(false);
      setArmStatus("Track disarmed");
      setRecordStatus("Arm a track first");

      // Stop microphone
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
      return;
    }

    try {
      console.debug("Arming track for recording...");
      setArmStatus("Requesting microphone access...");

      // Request microphone access first
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.debug("Got microphone stream");

      // Create a tape instrument if doesn't exist
      if (!tapeUnitRef.current) {
        console.debug("Creating tape instrument...");
        project.editing.modify(() => {
          const { audioUnitBox } = project.api.createInstrument(InstrumentFactories.Tape);
          tapeUnitRef.current = audioUnitBox;
        });
        console.debug("Created tape instrument:", tapeUnitRef.current);
      }

      // Get the capture device for this audio unit and arm it
      const uuid = tapeUnitRef.current.address.uuid;
      console.debug("Getting capture device for UUID:", UUID.toString(uuid));

      const captureOption = project.captureDevices.get(uuid);
      console.debug("Capture device option:", captureOption);

      if (captureOption.isEmpty()) {
        throw new Error("Could not get capture device");
      }

      const capture = captureOption.unwrap();
      console.debug("Got capture device, arming it...");
      capture.armed.setValue(true);

      // Connect microphone to capture device
      console.debug("Connecting microphone to capture device...");
      // TODO: Need to figure out how to connect MediaStream to capture device

      setIsArmed(true);
      setArmStatus("Track is armed and ready to record");
      setRecordStatus("Ready to record");

      console.debug("Track armed successfully!");
    } catch (error) {
      console.error("Failed to arm track:", error);
      setArmStatus(`Error: ${error}`);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
    }
  }, [project, isArmed]);

  const handleStartRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    try {
      setRecordStatus(useCountIn ? "Count-in starting..." : "Starting recording...");
      setIsRecording(true);

      // Resume AudioContext if suspended (required for user interaction)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Step 1: Prepare recording (arms captures, prepares engine state)
      console.debug(`Starting recording with count-in: ${useCountIn}`);
      project.startRecording(useCountIn);

      // Step 2: Start playback to actually begin recording
      project.engine.play();

      setRecordStatus(useCountIn ? "Count-in... then recording" : "Recording...");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecordStatus(`Error: ${error}`);
      setIsRecording(false);
    }
  }, [project, audioContext, useCountIn]);

  const handleStopRecording = useCallback(() => {
    if (!project) return;

    project.engine.stopRecording();
    setIsRecording(false);
    setRecordStatus("Recording stopped");
    setPlaybackStatus("Recording ready to play");
  }, [project]);

  const handlePlayRecording = useCallback(async () => {
    if (!project || !audioContext) return;

    console.debug("Playing recording...");
    console.debug("AudioContext state before play:", audioContext.state);

    // Resume AudioContext if suspended
    if (audioContext.state === "suspended") {
      console.debug("Resuming AudioContext for playback...");
      await audioContext.resume();
      console.debug("AudioContext resumed, state:", audioContext.state);
    }

    console.debug("Setting position to 0...");
    project.engine.setPosition(0);

    console.debug("Calling engine.play()...");
    project.engine.play();

    // Wait to see if observables fire
    await new Promise(resolve => setTimeout(resolve, 100));

    console.debug("After 100ms:");
    console.debug("engine.isPlaying:", project.engine.isPlaying.getValue());
    console.debug("engine.position:", project.engine.position.getValue());

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
