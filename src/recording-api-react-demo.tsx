// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { assert, Procedure, Progress, unitValue, UUID } from "@opendaw/lib-std";
import { Promises } from "@opendaw/lib-runtime";
import { AudioFileBoxAdapter, SampleMetaData, SoundfontMetaData } from "@opendaw/studio-adapters";
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
import { AudioFileBox, AudioRegionBox } from "@opendaw/studio-boxes";
import { PPQN } from "@opendaw/lib-dsp";
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
  const micStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const beforeRecordingSamplesRef = useRef<Set<string>>(new Set());

  // Subscribe to count-in observables
  useEffect(() => {
    if (!project) return undefined;

    const countingInSubscription = project.engine.isCountingIn.catchupAndSubscribe(obs => {
      setIsCountingIn(obs.getValue());
    });

    const beatsRemainingSubscription = project.engine.countInBeatsRemaining.catchupAndSubscribe(obs => {
      setCountInBeatsRemaining(Math.ceil(obs.getValue()));
    });

    return () => {
      countingInSubscription.terminate();
      beatsRemainingSubscription.terminate();
    };
  }, [project]);

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

        // Delete obsolete samples
        SampleStorage.cleanDeprecated().then();

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
        newProject.engine.isCountingIn.subscribe(obs => console.debug("[ENGINE] isCountingIn:", obs.getValue()));
        newProject.engine.countInBeatsRemaining.subscribe(obs =>
          console.debug("[ENGINE] countInBeatsRemaining:", obs.getValue())
        );

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
          const { audioUnitBox, trackBox } = project.api.createInstrument(InstrumentFactories.Tape);
          tapeUnitRef.current = { audioUnitBox, trackBox };
        });
        console.debug("Created tape instrument:", tapeUnitRef.current);
      }

      // Get the capture device for this audio unit and arm it
      const uuid = tapeUnitRef.current.audioUnitBox.address.uuid;
      console.debug("Getting capture device for UUID:", UUID.toString(uuid));

      const captureOption = project.captureDevices.get(uuid);
      console.debug("Capture device option:", captureOption);

      if (captureOption.isEmpty()) {
        throw new Error("Could not get capture device");
      }

      const capture = captureOption.unwrap() as any;
      console.debug("Got capture device, arming it...");

      // Connect microphone stream to capture device
      console.debug("Connecting microphone to capture device...");
      if (capture.stream && micStreamRef.current) {
        capture.stream.wrap(micStreamRef.current);
        console.debug("Microphone stream connected!");
      }

      // Arm the track
      capture.armed.setValue(true);

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
      setIsRecording(true);

      // Snapshot existing samples before recording
      const existingSamples = await SampleStorage.get().list();
      beforeRecordingSamplesRef.current = new Set(existingSamples.map(s => s.uuid));
      console.debug(`Before recording: ${beforeRecordingSamplesRef.current.size} samples in storage`);

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

      // IMPORTANT: RecordAudio.start() creates AudioFileBox/AudioRegionBox on first position update
      // So we need the engine to be playing/transporting for position to update
      // We call play() AFTER startRecording() so count-in works correctly
      if (!useCountIn) {
        // If no count-in, start playing immediately
        project.engine.play();
      }
      // If count-in is enabled, startRecording() handles play() internally

      setRecordStatus(useCountIn ? "Count-in..." : "Recording...");
    } catch (error) {
      console.error("Failed to start recording:", error);
      setRecordStatus(`Error: ${error}`);
      setIsRecording(false);
    }
  }, [project, audioContext, useCountIn]);

  const renderPeaksFromAdapter = useCallback((adapter: AudioFileBoxAdapter) => {
    console.debug("renderPeaksFromAdapter called");
    console.debug("canvasRef.current:", canvasRef.current);

    if (!canvasRef.current) {
      console.debug("No canvas found!");
      return false;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    console.debug("Canvas context:", ctx);

    if (!ctx) {
      console.debug("No canvas context!");
      return false;
    }

    const peaksOption = adapter.peaks;
    console.debug("Peaks option:", peaksOption);
    console.debug("Peaks isEmpty:", peaksOption.isEmpty());

    if (peaksOption.isEmpty()) {
      console.debug("Peaks option is empty!");
      return false;
    }

    const peaks = peaksOption.unwrap();
    console.debug(`Rendering peaks: ${peaks.numFrames} frames, ${peaks.numChannels} channels`);

    // Clear canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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
        u1: peaks.numFrames,
        v0: -1,
        v1: 1
      });
    }

    setHasPeaks(true);
    return true;
  }, []);

  const createRegionFromRecording = useCallback((recordingUUID: UUID.Bytes, duration: number) => {
    if (!project || !tapeUnitRef.current) return;

    const { boxGraph, editing } = project;
    const { trackBox } = tapeUnitRef.current;
    const { Quarter } = PPQN;

    editing.modify(() => {
      // Check if AudioFileBox already exists, otherwise create it
      const existingBoxOption = boxGraph.findBox(recordingUUID);
      let audioFileBox;

      if (existingBoxOption.isEmpty()) {
        audioFileBox = AudioFileBox.create(boxGraph, recordingUUID, box => {
          box.fileName.setValue("Recording");
          box.endInSeconds.setValue(duration);
        });
        console.debug("Created AudioFileBox:", UUID.toString(recordingUUID));
      } else {
        audioFileBox = existingBoxOption.unwrap();
        console.debug("Found existing AudioFileBox:", UUID.toString(recordingUUID));
      }

      // Calculate duration in PPQN (assuming 120 BPM)
      const durationInPPQN = Math.ceil(((duration * 120) / 60) * Quarter);

      // Create AudioRegionBox and link to track
      AudioRegionBox.create(boxGraph, UUID.generate(), box => {
        box.regions.refer(trackBox.regions);
        box.file.refer(audioFileBox);
        box.position.setValue(0);
        box.duration.setValue(durationInPPQN);
        box.loopOffset.setValue(0);
        box.loopDuration.setValue(durationInPPQN);
        box.label.setValue("Recording");
        box.mute.setValue(false);
      });

      console.debug("Created AudioRegionBox, duration:", durationInPPQN, "PPQN");
    });
  }, [project]);

  const handleStopRecording = useCallback(async () => {
    if (!project || !tapeUnitRef.current) return;

    project.engine.stopRecording();
    setIsRecording(false);
    setRecordStatus("Recording stopped");
    setPlaybackStatus("Recording ready to play");

    // Wait a moment for the sample to be saved to storage
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Find the new sample by comparing with the before snapshot
    const allSamples = await SampleStorage.get().list();
    const newSample = allSamples.find(s => !beforeRecordingSamplesRef.current.has(s.uuid));

    if (!newSample) {
      console.error("Could not find new recording in storage!");
      return;
    }

    const recordingUUID = UUID.parse(newSample.uuid);
    console.debug("Found new recording:", newSample.uuid);
    console.debug("Recording metadata:", newSample);

    // Get the sample loader for this recording and subscribe to it
    const loader = project.sampleManager.getOrCreate(recordingUUID);
    console.debug("Got sample loader, subscribing to load state...");

    let subscription: any;
    subscription = loader.subscribe(state => {
      console.debug("Recording loader state:", state.type);

      if (state.type === "loaded") {
        console.debug("Recording loaded! Creating boxes...");
        if (subscription) {
          subscription.terminate();
        }

        // Create the boxes
        createRegionFromRecording(recordingUUID, newSample.duration || 5.0);

        // Wait for boxes to be created, then render peaks
        setTimeout(() => {
          console.debug("Attempting to render peaks...");
          const trackBox = tapeUnitRef.current?.trackBox;
          if (!trackBox) {
            console.debug("No trackBox found!");
            return;
          }

          console.debug("Found trackBox, checking for regions...");
          console.debug("trackBox.regions:", trackBox.regions);
          const regions = trackBox.regions?.children;
          console.debug("Regions children:", regions ? regions.length : "none", regions);

          if (regions && regions.length > 0) {
            const firstRegion = regions[0];
            console.debug("First region:", firstRegion);
            const audioFileBox = firstRegion.file.get();
            console.debug("AudioFileBox from region:", audioFileBox);

            if (audioFileBox) {
              const adapter = project.boxAdapters.adapterFor(audioFileBox, AudioFileBoxAdapter);
              console.debug("Got adapter, calling renderPeaksFromAdapter...");
              renderPeaksFromAdapter(adapter);
            } else {
              console.debug("No audioFileBox found in region!");
            }
          } else {
            console.debug("No regions found or regions empty! Trying to find AudioFileBox directly...");

            // Try to get the AudioFileBox directly from the boxGraph
            const audioFileBoxOption = project.boxGraph.findBox(recordingUUID);
            if (!audioFileBoxOption.isEmpty()) {
              const audioFileBox = audioFileBoxOption.unwrap();
              console.debug("Found AudioFileBox directly from boxGraph:", audioFileBox);
              const adapter = project.boxAdapters.adapterFor(audioFileBox, AudioFileBoxAdapter);
              console.debug("Got adapter, calling renderPeaksFromAdapter...");
              renderPeaksFromAdapter(adapter);
            } else {
              console.debug("Could not find AudioFileBox in boxGraph!");
            }
          }
        }, 500);
      } else if (state.type === "error") {
        console.error("Recording loader error:", state.reason);
        if (subscription) {
          subscription.terminate();
        }
      }
    });
  }, [project, createRegionFromRecording, renderPeaksFromAdapter]);

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
