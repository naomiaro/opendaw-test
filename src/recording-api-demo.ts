// noinspection PointlessArithmeticExpressionJS

import {assert, Procedure, Progress, unitValue, UUID} from "@opendaw/lib-std";
import {Promises} from "@opendaw/lib-runtime";
import {SampleMetaData, SoundfontMetaData} from "@opendaw/studio-adapters";
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
import {AnimationFrame} from "@opendaw/lib-dom";
import {testFeatures} from "./features";

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";

(async () => {
    console.debug("openDAW -> headless -> Recording API demo");
    console.debug("WorkersUrl", WorkersUrl);
    console.debug("WorkletsUrl", WorkletsUrl);
    assert(crossOriginIsolated, "window must be crossOriginIsolated");
    console.debug("booting...");

    // CRITICAL: Start the AnimationFrame loop that reads state from the worklet!
    console.debug("Starting AnimationFrame loop...");
    AnimationFrame.start(window);
    console.debug("AnimationFrame started!");

    const updateStatus = (text: string) => {
        const preloader = document.querySelector("#preloader");
        if (preloader) preloader.textContent = text;
    };

    updateStatus("Booting...");
    await Workers.install(WorkersUrl);
    AudioWorklets.install(WorkletsUrl);
    {
        const {status, error} = await Promises.tryCatch(testFeatures());
        if (status === "rejected") {
            document.querySelector("#preloader")?.remove();
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

    const sampleManager = new DefaultSampleLoaderManager({
        fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[any, SampleMetaData]> => {
            console.debug(`Sample manager fetch called for UUID: ${UUID.toString(uuid)}`);
            return OpenSampleAPI.get().load(audioContext, uuid, progress);
        }
    });

    const soundfontManager = new DefaultSoundfontLoaderManager({
        fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
            OpenSoundfontAPI.get().load(uuid, progress)
    });

    const audioWorklets = AudioWorklets.get(audioContext);
    const project = Project.new({audioContext, sampleManager, soundfontManager, audioWorklets});
    project.startAudioWorklet();
    await project.engine.isReady();

    console.debug("Project ready!");

    // Subscribe to engine state changes
    project.engine.isPlaying.subscribe((obs) =>
        console.debug("[ENGINE] isPlaying:", obs.getValue())
    );
    project.engine.isRecording.subscribe((obs) =>
        console.debug("[ENGINE] isRecording:", obs.getValue())
    );
    project.engine.position.subscribe((obs) =>
        console.debug("[ENGINE] position:", obs.getValue())
    );

    // Hide preloader, show controls
    const preloader = document.querySelector("#preloader") as HTMLElement;
    const mainContent = document.querySelector("#mainContent") as HTMLElement;
    const armButton = document.querySelector("#armButton") as HTMLButtonElement;
    const armStatus = document.querySelector("#armStatus") as HTMLElement;
    const recordButton = document.querySelector("#recordButton") as HTMLButtonElement;
    const stopRecordButton = document.querySelector("#stopRecordButton") as HTMLButtonElement;
    const recordStatus = document.querySelector("#recordStatus") as HTMLElement;
    const playRecordingButton = document.querySelector("#playRecordingButton") as HTMLButtonElement;
    const stopPlaybackButton = document.querySelector("#stopPlaybackButton") as HTMLButtonElement;
    const playbackStatus = document.querySelector("#playbackStatus") as HTMLElement;

    if (preloader) preloader.style.display = "none";
    if (mainContent) mainContent.style.display = "flex";

    let isArmed = false;
    let micStream: MediaStream | null = null;

    // Arm button - creates tape track and arms it for recording
    armButton.addEventListener("click", async () => {
        if (isArmed) {
            // Disarm
            console.debug("Disarming track...");
            const captures = project.captureDevices.filterArmed();
            captures.forEach(capture => capture.armed.setValue(false));
            isArmed = false;
            armButton.classList.remove("armed");
            armButton.textContent = "🎯 Arm Track for Recording";
            armStatus.textContent = "Track disarmed";
            recordButton.disabled = true;
            recordStatus.textContent = "Arm a track first";

            // Stop microphone
            if (micStream) {
                micStream.getTracks().forEach(track => track.stop());
                micStream = null;
            }
            return;
        }

        try {
            console.debug("Arming track for recording...");
            armStatus.textContent = "Requesting microphone access...";

            // Request microphone access first
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.debug("Got microphone stream");

            // Create a tape instrument if doesn't exist
            const allBoxes = Array.from(project.boxGraph.boxes());
            let tapeUnit = allBoxes.find((box: any) =>
                box.constructor.name === "_AudioUnitBox" &&
                box.type?.getValue() === "instrument"
            );

            if (!tapeUnit) {
                console.debug("Creating tape instrument...");
                project.editing.modify(() => {
                    const {audioUnitBox} = project.api.createInstrument(InstrumentFactories.Tape);
                    tapeUnit = audioUnitBox;
                });
                console.debug("Created tape instrument:", tapeUnit);
            }

            // Get the capture device for this audio unit and arm it
            const uuid = (tapeUnit as any).address.uuid;
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

            isArmed = true;
            armButton.classList.add("armed");
            armButton.textContent = "✓ Track Armed (click to disarm)";
            armStatus.textContent = "Track is armed and ready to record";
            recordButton.disabled = false;
            recordStatus.textContent = "Ready to record";

            console.debug("Track armed successfully!");
        } catch (error) {
            console.error("Failed to arm track:", error);
            armStatus.textContent = `Error: ${error}`;
            if (micStream) {
                micStream.getTracks().forEach(track => track.stop());
                micStream = null;
            }
        }
    });

    // Record button - uses project.startRecording() then engine.play()
    recordButton.addEventListener("click", async () => {
        try {
            recordStatus.textContent = "Starting recording...";
            recordButton.classList.add("recording");
            recordButton.disabled = true;
            stopRecordButton.disabled = false;

            // Resume AudioContext if suspended (required for user interaction)
            if (audioContext.state === "suspended") {
                await audioContext.resume();
            }

            // Step 1: Prepare recording (arms captures, prepares engine state)
            project.startRecording(false); // false = no count-in

            // Step 2: Start playback to actually begin recording
            project.engine.play();

            recordStatus.textContent = "Recording...";

        } catch (error) {
            console.error("Failed to start recording:", error);
            recordStatus.textContent = `Error: ${error}`;
            recordButton.classList.remove("recording");
            recordButton.disabled = false;
            stopRecordButton.disabled = true;
        }
    });

    // Stop recording button
    stopRecordButton.addEventListener("click", () => {
        project.engine.stopRecording();

        recordButton.classList.remove("recording");
        recordButton.disabled = false;
        stopRecordButton.disabled = true;
        recordStatus.textContent = "Recording stopped";
        playRecordingButton.disabled = false;
        playbackStatus.textContent = "Recording ready to play";
    });

    // Play recording button - test if engine.play() works at all
    playRecordingButton.addEventListener("click", async () => {
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

        playRecordingButton.disabled = true;
        stopPlaybackButton.disabled = false;
        playbackStatus.textContent = "Playing...";
    });

    // Stop playback button
    stopPlaybackButton.addEventListener("click", () => {
        project.engine.stop(true);
        project.engine.setPosition(0);
        playRecordingButton.disabled = false;
        stopPlaybackButton.disabled = true;
        playbackStatus.textContent = "Playback stopped";
    });
})();
