import {assert, Progress} from "@opendaw/lib-std";
import {DefaultObservableValue, ObservableValue} from "@opendaw/lib-std";
import {Promises} from "@opendaw/lib-runtime";
import {
    AudioWorklets,
    DefaultSampleLoaderManager,
    DefaultSoundfontLoaderManager,
    OpenSampleAPI,
    OpenSoundfontAPI,
    Project,
    Workers
} from "@opendaw/studio-core";
import {testFeatures} from "./features";

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url";
import WorkletsUrl from "@opendaw/studio-core/processors.js?url";

const logContainer = document.querySelector("#log") as HTMLElement;

function log(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

(async () => {
    log("Initializing OpenDAW...", 'info');
    assert(crossOriginIsolated, "window must be crossOriginIsolated");

    await Workers.install(WorkersUrl);
    AudioWorklets.install(WorkletsUrl);

    const {status, error} = await Promises.tryCatch(testFeatures());
    if (status === "rejected") {
        log(`Feature test failed: ${error}`, 'error');
        return;
    }

    const audioContext = new AudioContext({latencyHint: 0});
    log(`AudioContext created: ${audioContext.sampleRate}Hz`, 'success');

    await AudioWorklets.createFor(audioContext);

    const sampleManager = new DefaultSampleLoaderManager({
        fetch: async (uuid, progress) => OpenSampleAPI.get().load(audioContext, uuid, progress)
    });

    const soundfontManager = new DefaultSoundfontLoaderManager({
        fetch: async (uuid, progress: Progress.Handler) => OpenSoundfontAPI.get().load(uuid, progress)
    });

    const audioWorklets = AudioWorklets.get(audioContext);
    const project = Project.new({audioContext, sampleManager, soundfontManager, audioWorklets});
    project.startAudioWorklet();
    await project.engine.isReady();

    log("Project initialized successfully!", 'success');

    // Test 1: Create a custom observable and verify it works
    const testObservableButton = document.querySelector("#testObservable") as HTMLButtonElement;
    testObservableButton.addEventListener("click", () => {
        log("--- Testing Custom Observables ---", 'warning');

        // Test DefaultObservableValue (what we've been using)
        log("Test 1: DefaultObservableValue", 'info');
        const customObservable1 = new DefaultObservableValue(0);
        log("Created DefaultObservableValue with value: 0", 'info');

        customObservable1.subscribe((obs) => {
            log(`✓ DefaultObservableValue fired! New value: ${obs.getValue()}`, 'success');
        });

        log("Subscribed to DefaultObservableValue", 'info');
        log("Setting value to 42...", 'info');
        customObservable1.setValue(42);

        log("Setting value to 100...", 'info');
        customObservable1.setValue(100);

        // Test ObservableValue.make (factory method)
        log("Test 2: ObservableValue.make() factory", 'info');
        const customObservable2 = ObservableValue.make(false);
        log("Created ObservableValue via factory with value: false", 'info');

        customObservable2.subscribe((obs) => {
            log(`✓ ObservableValue factory fired! New value: ${obs.getValue()}`, 'success');
        });

        log("Subscribed to ObservableValue", 'info');
        log("Calling getValue()...", 'info');
        log(`Current value: ${customObservable2.getValue()}`, 'info');

        // Log engine observable types for comparison
        log("--- Engine Observable Types ---", 'warning');
        log(`engine.isPlaying type: ${project.engine.isPlaying.constructor.name}`, 'info');
        log(`engine.position type: ${project.engine.position.constructor.name}`, 'info');
        log(`Custom observable type: ${customObservable1.constructor.name}`, 'info');

        log("Custom observable tests complete", 'warning');
    });

    // Subscribe to engine observables
    log("--- Subscribing to Engine Observables ---", 'warning');

    log("Subscribing to isPlaying...", 'info');
    project.engine.isPlaying.subscribe((obs) => {
        log(`✓ ENGINE.isPlaying FIRED! Value: ${obs.getValue()}`, 'success');
    });

    log("Subscribing to isRecording...", 'info');
    project.engine.isRecording.subscribe((obs) => {
        log(`✓ ENGINE.isRecording FIRED! Value: ${obs.getValue()}`, 'success');
    });

    log("Subscribing to position...", 'info');
    project.engine.position.subscribe((obs) => {
        log(`✓ ENGINE.position FIRED! Value: ${obs.getValue()}`, 'success');
    });

    log("All subscriptions registered", 'warning');

    // Get current values
    log(`Current isPlaying: ${project.engine.isPlaying.getValue()}`, 'info');
    log(`Current isRecording: ${project.engine.isRecording.getValue()}`, 'info');
    log(`Current position: ${project.engine.position.getValue()}`, 'info');

    // Test controls
    const playButton = document.querySelector("#playButton") as HTMLButtonElement;
    const stopButton = document.querySelector("#stopButton") as HTMLButtonElement;
    const setPositionButton = document.querySelector("#setPositionButton") as HTMLButtonElement;
    const clearLogButton = document.querySelector("#clearLog") as HTMLButtonElement;

    playButton.addEventListener("click", async () => {
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }
        log("Calling engine.play()...", 'warning');
        project.engine.play();
        log(`isPlaying after play(): ${project.engine.isPlaying.getValue()}`, 'info');
        playButton.disabled = true;
        stopButton.disabled = false;
    });

    stopButton.addEventListener("click", () => {
        log("Calling engine.stop(true)...", 'warning');
        project.engine.stop(true);
        log(`isPlaying after stop(): ${project.engine.isPlaying.getValue()}`, 'info');
        playButton.disabled = false;
        stopButton.disabled = true;
    });

    setPositionButton.addEventListener("click", () => {
        log("Calling engine.setPosition(1000)...", 'warning');
        project.engine.setPosition(1000);
        log(`position after setPosition(): ${project.engine.position.getValue()}`, 'info');
    });

    clearLogButton.addEventListener("click", () => {
        logContainer.innerHTML = '';
        log("Log cleared", 'info');
    });

    log("Ready! Click buttons to test", 'success');
})();
