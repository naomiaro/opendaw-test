// noinspection PointlessArithmeticExpressionJS

import {assert, Procedure, Progress, unitValue, UUID, Terminable} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import {Promises} from "@opendaw/lib-runtime"
import {SampleMetaData, SoundfontMetaData} from "@opendaw/studio-adapters"
import type {AudioData} from "@opendaw/studio-adapters"
import {
    AudioWorklets,
    DefaultSampleLoaderManager,
    DefaultSoundfontLoaderManager,
    InstrumentFactories,
    OpenSampleAPI,
    OpenSoundfontAPI,
    Project,
    Workers,
    Recording
} from "@opendaw/studio-core"
import {AudioFileBox, AudioRegionBox, CaptureAudioBox} from "@opendaw/studio-boxes"
import {testFeatures} from "./features"

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

// Import RecordingWorklet type from its direct path
import type {RecordingWorklet} from "@opendaw/studio-core/RecordingWorklet"

// Global state
let recordingTerminator: any = null;
let recordingStartTime: number = 0;
let recordingDurationInterval: number | null = null;

(async () => {
    console.debug("openDAW -> headless -> recording demo");
    console.debug("WorkersUrl", WorkersUrl);
    console.debug("WorkletsUrl", WorkletsUrl);
    assert(crossOriginIsolated, "window must be crossOriginIsolated");
    console.debug("booting...");

    const preloader = document.querySelector("#preloader") as HTMLElement;
    const mainContent = document.querySelector("#mainContent") as HTMLElement;
    const recordButton = document.querySelector("#recordButton") as HTMLButtonElement;
    const stopRecordButton = document.querySelector("#stopRecordButton") as HTMLButtonElement;
    const playRecordingButton = document.querySelector("#playRecordingButton") as HTMLButtonElement;
    const stopPlaybackButton = document.querySelector("#stopPlaybackButton") as HTMLButtonElement;
    const recordStatus = document.querySelector("#recordStatus") as HTMLElement;
    const playbackStatus = document.querySelector("#playbackStatus") as HTMLElement;
    const recordingInfo = document.querySelector("#recordingInfo") as HTMLElement;
    const recordDuration = document.querySelector("#recordDuration") as HTMLElement;
    const recordSampleRate = document.querySelector("#recordSampleRate") as HTMLElement;
    const waveform = document.querySelector("#waveform") as HTMLElement;

    const updateStatus = (text: string) => {
        if (preloader) preloader.textContent = text;
    };

    updateStatus("Booting...");
    await Workers.install(WorkersUrl);
    AudioWorklets.install(WorkletsUrl);
    {
        const {status, error} = await Promises.tryCatch(testFeatures());
        if (status === "rejected") {
            alert(`Could not test features (${error})`);
            return;
        }
    }
    const audioContext = new AudioContext({latencyHint: 0});
    console.debug(`AudioContext state: ${audioContext.state}, sampleRate: ${audioContext.sampleRate}`);
    {
        const {status, error} = await Promises.tryCatch(AudioWorklets.createFor(audioContext));
        if (status === "rejected") {
            alert(`Could not install Worklets (${error})`);
            return;
        }
    }

    // Custom sample provider that can load recorded audio
    const localAudioData = new Map<string, AudioData>();
    let recordingUUID: UUID.Bytes | null = null;

    const sampleManager = new DefaultSampleLoaderManager({
        fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, SampleMetaData]> => {
            const uuidString = UUID.toString(uuid);
            console.debug(`Sample manager fetch called for UUID: ${uuidString}`);
            const audioData = localAudioData.get(uuidString);

            if (audioData) {
                console.debug(`Found local audio data for ${uuidString}, channels: ${audioData.numberOfChannels}, frames: ${audioData.numberOfFrames}`);
                const duration = audioData.numberOfFrames / audioData.sampleRate;
                const metadata: SampleMetaData = {
                    name: "Recording",
                    bpm: 120,
                    duration: duration,
                    sample_rate: audioData.sampleRate,
                    origin: "import"
                };
                return [audioData, metadata];
            }

            console.debug(`No local data found for ${uuidString}, falling back to OpenSampleAPI`);
            return OpenSampleAPI.get().load(audioContext, uuid, progress);
        }
    });

    const soundfontManager = new DefaultSoundfontLoaderManager({
        fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
            OpenSoundfontAPI.get().load(uuid, progress)
    });

    const audioWorklets = AudioWorklets.get(audioContext);
    const project = Project.new({audioContext, sampleManager, soundfontManager, audioWorklets});

    console.debug("Starting AudioWorklet...");
    const engineWorklet = project.startAudioWorklet();
    console.debug("AudioWorklet started:", engineWorklet);
    console.debug("  Type:", engineWorklet?.constructor?.name);
    console.debug("  Context:", engineWorklet?.context);
    console.debug("  Context state:", engineWorklet?.context?.state);

    console.debug("Waiting for engine ready...");
    await project.engine.isReady();
    console.debug("Engine is ready");

    // Check if the worklet node is connected
    console.debug("EngineWorklet details:");
    console.debug("  numberOfInputs:", engineWorklet?.numberOfInputs);
    console.debug("  numberOfOutputs:", engineWorklet?.numberOfOutputs);
    console.debug("  channelCount:", engineWorklet?.channelCount);

    // Listen for worklet errors
    engineWorklet.addEventListener("error", (event) => {
        console.error("[WORKLET ERROR]", event);
    });
    engineWorklet.addEventListener("processorerror", (event) => {
        console.error("[WORKLET PROCESSOR ERROR]", event);
    });

    // Note: startAudioWorklet() already connects to destination at Project.js:119
    console.debug("EngineWorklet should already be connected to destination by startAudioWorklet()");

    console.debug("OpenDAW initialized, ready to record");
    console.debug("Engine methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(project.engine)));
    console.debug("Has stop method:", 'stop' in project.engine);
    console.debug("Has stopRecording method:", 'stopRecording' in project.engine);

    // Subscribe to engine state changes to debug
    project.engine.isPlaying.subscribe({
        notify: (obs) => console.debug("[ENGINE STATE] isPlaying changed to:", obs.getValue())
    });
    project.engine.isRecording.subscribe({
        notify: (obs) => console.debug("[ENGINE STATE] isRecording changed to:", obs.getValue())
    });
    project.engine.position.subscribe({
        notify: (obs) => console.debug("[ENGINE STATE] position changed to:", obs.getValue())
    });

    // Test if worklet is responsive by setting position
    console.debug("Testing worklet responsiveness - setting position to 100");
    project.engine.setPosition(100);
    await new Promise(resolve => setTimeout(resolve, 100));
    console.debug("After setPosition(100), position is:", project.engine.position.getValue());

    // Try calling play to see if that activates the processor
    console.debug("Testing with engine.play()");
    project.engine.play();
    await new Promise(resolve => setTimeout(resolve, 300));
    console.debug("After engine.play():");
    console.debug("  isPlaying:", project.engine.isPlaying.getValue());
    console.debug("  position:", project.engine.position.getValue());

    // Stop it
    project.engine.stop(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Hide preloader, show main content
    if (preloader) preloader.style.display = "none";
    if (mainContent) mainContent.style.display = "flex";

    // Function to draw a simple waveform from AudioData
    const drawWaveform = (audioData: AudioData) => {
        const canvas = document.createElement('canvas');
        canvas.width = waveform.clientWidth * 2; // 2x for retina
        canvas.height = 80 * 2;
        canvas.style.width = '100%';
        canvas.style.height = '80px';

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Check if frames data exists
        if (!audioData.frames || audioData.frames.length === 0) {
            console.error("No frames data available in audioData:", audioData);
            waveform.innerHTML = '';
            waveform.appendChild(canvas);
            return;
        }

        // Get first channel data
        const data = audioData.frames[0];
        if (!data || data.length === 0) {
            console.error("First channel is empty");
            waveform.innerHTML = '';
            waveform.appendChild(canvas);
            return;
        }

        const step = Math.ceil(data.length / canvas.width);
        const amp = canvas.height / 2;

        ctx.fillStyle = '#4a9eff';
        ctx.beginPath();

        for (let i = 0; i < canvas.width; i++) {
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            const y1 = (1 + min) * amp;
            const y2 = (1 + max) * amp;

            ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
        }

        waveform.innerHTML = '';
        waveform.appendChild(canvas);
    };

    // Recording functionality - manual approach since Recording API position sync is broken
    recordButton.addEventListener("click", async () => {
        try {
            // Resume AudioContext if needed
            if (audioContext.state === "suspended") {
                await audioContext.resume();
            }

            console.debug("Starting manual recording...");

            // Ensure we have a tape instrument
            const allBoxes = Array.from(project.boxGraph.boxes());
            let tapeUnit = allBoxes.find((box: any) =>
                box.constructor.name === "_AudioUnitBox" &&
                box.type?.getValue() === "instrument"
            );

            if (!tapeUnit) {
                console.debug("No tape instrument found, creating one...");
                const created = project.editing.modify(() =>
                    project.api.createInstrument(InstrumentFactories.Tape)
                );

                if (created) {
                    tapeUnit = created.audioUnitBox;
                    console.debug("Created tape instrument:", tapeUnit);
                } else {
                    throw new Error("Failed to create tape instrument");
                }
            }

            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.debug("Got microphone stream");

            // Create a RecordingWorklet directly
            const recordingWorklet = audioWorklets.createRecording(1, 512, audioContext.outputLatency || 0);
            console.debug("Created RecordingWorklet");

            // Connect microphone to recording worklet
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(recordingWorklet);

            console.debug("Connected microphone to RecordingWorklet");

            // Register with sample manager
            sampleManager.record(recordingWorklet);

            recordingTerminator = {
                worklet: recordingWorklet,
                stream: stream,
                source: source
            } as any;

            recordingStartTime = Date.now();

            // Update duration display
            recordingDurationInterval = window.setInterval(() => {
                const duration = (Date.now() - recordingStartTime) / 1000;
                recordDuration.textContent = `${duration.toFixed(1)}s`;
            }, 100);

            recordButton.disabled = true;
            recordButton.classList.add('recording');
            stopRecordButton.disabled = false;
            recordStatus.textContent = "Recording...";
            recordingInfo.style.display = "block";
            recordSampleRate.textContent = `${audioContext.sampleRate}Hz`;

            console.debug("Manual recording started");
        } catch (error) {
            console.error("Error starting recording:", error);
            alert("Could not start recording: " + error);
        }
    });

    stopRecordButton.addEventListener("click", () => {
        if (!recordingTerminator) {
            console.warn("Stop called but recording not active");
            return;
        }

        console.debug("Stopping recording...");

        const { worklet, stream, source } = recordingTerminator as any;

        if (recordingDurationInterval) {
            clearInterval(recordingDurationInterval);
            recordingDurationInterval = null;
        }

        console.debug("Stopping recording...");
        console.debug("  numberOfFrames captured:", worklet.numberOfFrames);

        // Set the limit to trigger finalization on the next audio callback
        // The worklet is still connected and recording, so the next render quantum
        // will trigger the finalize when it sees we've reached the limit
        console.debug("Setting limit to trigger finalization...");
        worklet.limit(worklet.numberOfFrames);

        // Subscribe to state changes to know when finalization completes
        const subscription = worklet.subscribe((state: any) => {
            console.debug("RecordingWorklet state changed to:", state);
            if (state.type === 'loaded') {
                subscription.terminate();

                // Now disconnect audio
                source.disconnect();
                stream.getTracks().forEach(track => track.stop());

                const audioData = worklet.data.unwrapOrNull();
                console.debug("Recording finalized, audioData:", audioData);

                processRecordedAudio(audioData, worklet);
            }
        });

        // If finalization doesn't happen within 2 seconds, give up
        setTimeout(() => {
            if (worklet.state.type !== 'loaded') {
                console.warn("Finalization timeout, cleaning up anyway");
                subscription.terminate();
                source.disconnect();
                stream.getTracks().forEach(track => track.stop());

                recordButton.disabled = false;
                recordButton.classList.remove('recording');
                stopRecordButton.disabled = true;
                recordStatus.textContent = "Recording failed";
                recordingTerminator = null;
            }
        }, 2000);
    });

    function processRecordedAudio(audioData: AudioData | null, worklet: any) {
        if (audioData && audioData.numberOfFrames > 0) {
            console.debug("Got recorded audio data:");
            console.debug("  Frames:", audioData.numberOfFrames);
            console.debug("  Channels:", audioData.numberOfChannels);
            console.debug("  Sample rate:", audioData.sampleRate);

            // Draw waveform
            drawWaveform(audioData);

            // Store for playback - create AudioFileBox and AudioRegionBox manually
            const uuid = worklet.uuid;
            const uuidString = UUID.toString(uuid);
            localAudioData.set(uuidString, audioData);
            recordingUUID = uuid;

            // Manually create the audio file and region boxes
            project.editing.modify(() => {
                // Find or create a tape track first
                const allBoxes = Array.from(project.boxGraph.boxes());
                const tapeUnit = allBoxes.find((box: any) =>
                    box.constructor.name === "_AudioUnitBox" &&
                    box.type?.getValue() === "instrument"
                );

                if (!tapeUnit) {
                    console.error("No tape instrument found!");
                    return;
                }

                console.debug("Found tape instrument:", tapeUnit);

                // Find the track box for this audio unit
                const trackBox = allBoxes.find((box: any) =>
                    box.constructor.name === "_TrackBox"
                );

                console.debug("Found track box:", trackBox);

                if (!trackBox) {
                    console.error("No track box found!");
                    return;
                }

                // Create the region first (without file reference)
                const regionBox = AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
                    box.regions.refer(trackBox.regions);
                    box.position.setValue(0);
                    const durationPPQN = PPQN.secondsToPulses(audioData.numberOfFrames / audioData.sampleRate, project.bpm);
                    box.duration.setValue(durationPPQN);
                    box.loopDuration.setValue(durationPPQN);
                    box.label.setValue("Recording");
                });

                console.debug("Created AudioRegionBox");

                // Now create the file box and connect it to the region
                const fileBox = AudioFileBox.create(project.boxGraph, uuid, box => {
                    box.fileName.setValue("Manual Recording");
                    box.endInSeconds.setValue(audioData.numberOfFrames / audioData.sampleRate);
                });

                // Connect file to region
                regionBox.file.refer(fileBox);

                console.debug("Created AudioFileBox and connected to region");
            });

            recordStatus.textContent = "Recording complete";
            playRecordingButton.disabled = false;
            playbackStatus.textContent = "Ready to play";
        } else {
            console.warn("No audio data recorded");
            recordStatus.textContent = "Recording failed - no data";
        }

        recordButton.disabled = false;
        recordButton.classList.remove('recording');
        stopRecordButton.disabled = true;
        recordingTerminator = null;
    }

    // Playback functionality - the recording is already in the project as a track
    playRecordingButton.addEventListener("click", async () => {
        // Resume AudioContext if suspended
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }

        console.debug("Playing recording...");

        // Debug: Check what tracks exist
        const allBoxes = Array.from(project.boxGraph.boxes());
        console.debug("Total boxes in project:", allBoxes.length);

        const audioUnits = allBoxes.filter(box => box.constructor.name.includes("AudioUnit"));
        console.debug("AudioUnit boxes:", audioUnits.length);

        audioUnits.forEach((box: any) => {
            console.debug("AudioUnit:", box.constructor.name, "UUID:", box.address?.uuid);
            console.debug("  Type:", box.type?.getValue());
        });

        // Check for audio regions
        const audioRegions = allBoxes.filter(box => box.constructor.name.includes("AudioRegion"));
        console.debug("AudioRegion boxes:", audioRegions.length);

        audioRegions.forEach((box: any) => {
            console.debug("AudioRegion:", box.constructor.name, "UUID:", box.address?.uuid);
            console.debug("  Position:", box.position?.getValue());
            console.debug("  Duration:", box.duration?.getValue());
        });

        // The Recording API has already created the tracks with the recorded audio
        // We just need to play the project from the beginning
        project.engine.setPosition(0);
        project.engine.play();

        playRecordingButton.disabled = true;
        stopPlaybackButton.disabled = false;
        playbackStatus.textContent = "Playing...";
    });

    stopPlaybackButton.addEventListener("click", () => {
        project.engine.stop(true);
        project.engine.setPosition(0);
        playRecordingButton.disabled = false;
        stopPlaybackButton.disabled = true;
        playbackStatus.textContent = "Playback stopped";
    });
})();
