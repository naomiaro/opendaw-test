// noinspection PointlessArithmeticExpressionJS

import {assert, Procedure, Progress, unitValue, UUID} from "@opendaw/lib-std"
import {Terminator} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import {Promises} from "@opendaw/lib-runtime"
import {AudioData, SampleMetaData, SoundfontMetaData} from "@opendaw/studio-adapters"
import {
    AudioWorklets,
    DefaultSampleLoaderManager,
    DefaultSoundfontLoaderManager,
    InstrumentFactories,
    OpenSampleAPI,
    OpenSoundfontAPI,
    Project,
    Workers
} from "@opendaw/studio-core"
import {AudioFileBox, AudioRegionBox, AudioUnitBox, TrackBox} from "@opendaw/studio-boxes"
import {AnimationFrame} from "@opendaw/lib-dom"
import {testFeatures} from "./features"

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

/**
 * TransportDisplay - A component that displays global playback state
 * Demonstrates lifecycle management with subscriptions
 */
class TransportDisplay {
    private lifecycle = new Terminator()
    private container: HTMLElement
    private playingElement: HTMLElement
    private positionElement: HTMLElement
    private updateCount = 0

    constructor(container: HTMLElement, project: Project) {
        this.container = container
        this.container.innerHTML = `
            <div class="transport-display">
                <h3>Transport Display <span class="badge">Active</span></h3>
                <div class="state-row">
                    <strong>Playing:</strong> <span id="transport-playing">-</span>
                </div>
                <div class="state-row">
                    <strong>Position:</strong> <span id="transport-position">-</span>
                </div>
                <div class="state-row">
                    <strong>Updates:</strong> <span id="transport-updates">0</span>
                </div>
            </div>
        `

        this.playingElement = this.container.querySelector("#transport-playing")!
        this.positionElement = this.container.querySelector("#transport-position")!
        const updatesElement = this.container.querySelector("#transport-updates")!

        // Subscribe to engine state and own the subscriptions
        this.lifecycle.own(
            project.engine.isPlaying.subscribe((obs) => {
                this.updateCount++
                const isPlaying = obs.getValue()
                this.playingElement.textContent = isPlaying ? "▶ Playing" : "⏸ Stopped"
                this.playingElement.style.color = isPlaying ? "#4caf50" : "#f44336"
                updatesElement.textContent = this.updateCount.toString()
            })
        )

        this.lifecycle.own(
            project.engine.position.subscribe((obs) => {
                this.updateCount++
                const position = obs.getValue()
                this.positionElement.textContent = position.toFixed(2)
                updatesElement.textContent = this.updateCount.toString()
            })
        )

        console.debug("[TransportDisplay] Created and subscribed")
    }

    terminate() {
        console.debug("[TransportDisplay] Terminating...")
        this.lifecycle.terminate()
        this.container.innerHTML = `
            <div class="transport-display terminated">
                <h3>Transport Display <span class="badge terminated">Terminated</span></h3>
                <p>Subscriptions cleaned up. Final updates: ${this.updateCount}</p>
            </div>
        `
        console.debug("[TransportDisplay] Terminated")
    }
}

/**
 * TrackMonitor - A component that monitors a specific track
 * Demonstrates per-component lifecycle management
 */
class TrackMonitor {
    private lifecycle = new Terminator()
    private container: HTMLElement
    private updateCount = 0
    private trackName: string

    constructor(
        container: HTMLElement,
        project: Project,
        trackBox: TrackBox,
        audioUnitBox: AudioUnitBox,
        trackName: string
    ) {
        this.container = container
        this.trackName = trackName

        this.container.innerHTML = `
            <div class="track-monitor">
                <div class="track-header">
                    <h4>${trackName}</h4>
                    <button class="remove-btn" data-track="${trackName}">Remove</button>
                </div>
                <div class="track-stats">
                    <div class="stat-row">
                        <strong>Volume:</strong> <span class="track-volume">-</span>
                    </div>
                    <div class="stat-row">
                        <strong>Muted:</strong> <span class="track-muted">-</span>
                    </div>
                    <div class="stat-row">
                        <strong>Soloed:</strong> <span class="track-soloed">-</span>
                    </div>
                    <div class="stat-row">
                        <strong>Updates:</strong> <span class="track-updates">0</span>
                    </div>
                </div>
            </div>
        `

        const volumeElement = this.container.querySelector(".track-volume")!
        const mutedElement = this.container.querySelector(".track-muted")!
        const soloedElement = this.container.querySelector(".track-soloed")!
        const updatesElement = this.container.querySelector(".track-updates")!

        // Subscribe to track state changes
        this.lifecycle.own(
            audioUnitBox.volume.subscribe((obs) => {
                this.updateCount++
                volumeElement.textContent = `${obs.getValue().toFixed(1)} dB`
                updatesElement.textContent = this.updateCount.toString()
            })
        )

        this.lifecycle.own(
            audioUnitBox.mute.subscribe((obs) => {
                this.updateCount++
                const muted = obs.getValue()
                mutedElement.textContent = muted ? "🔇 Yes" : "🔊 No"
                updatesElement.textContent = this.updateCount.toString()
            })
        )

        this.lifecycle.own(
            audioUnitBox.solo.subscribe((obs) => {
                this.updateCount++
                const soloed = obs.getValue()
                soloedElement.textContent = soloed ? "⭐ Yes" : "No"
                updatesElement.textContent = this.updateCount.toString()
            })
        )

        console.debug(`[TrackMonitor:${trackName}] Created and subscribed`)
    }

    terminate() {
        console.debug(`[TrackMonitor:${this.trackName}] Terminating...`)
        this.lifecycle.terminate()
        this.container.innerHTML = `
            <div class="track-monitor terminated">
                <h4>${this.trackName} <span class="badge terminated">Terminated</span></h4>
                <p>Subscriptions cleaned up. Final updates: ${this.updateCount}</p>
            </div>
        `
        console.debug(`[TrackMonitor:${this.trackName}] Terminated`)
    }
}

// Helper function to load audio files
async function loadAudioFile(audioContext: AudioContext, url: string): Promise<AudioBuffer> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return await audioContext.decodeAudioData(arrayBuffer)
}

(async () => {
    console.log("========================================");
    console.log("openDAW -> headless -> lifecycle demo");
    console.log("WorkersUrl", WorkersUrl);
    console.log("WorkletsUrl", WorkletsUrl);
    console.log("crossOriginIsolated:", crossOriginIsolated);
    console.log("SharedArrayBuffer available:", typeof SharedArrayBuffer !== 'undefined');
    console.log("========================================");
    assert(crossOriginIsolated, "window must be crossOriginIsolated");
    console.debug("booting...");

    // CRITICAL: Start the AnimationFrame loop that reads state from the worklet!
    console.debug("Starting AnimationFrame loop...");
    AnimationFrame.start(window);
    console.debug("AnimationFrame started!");

    const updateStatus = (text: string) => {
        const status = document.querySelector("#status")
        if (status) status.textContent = text
    }

    updateStatus("Booting...")
    await Workers.install(WorkersUrl)
    AudioWorklets.install(WorkletsUrl)
    {
        const {status, error} = await Promises.tryCatch(testFeatures())
        if (status === "rejected") {
            alert(`Could not test features (${error})`)
            return
        }
    }
    const audioContext = new AudioContext({latencyHint: 0})
    console.debug(`AudioContext state: ${audioContext.state}, sampleRate: ${audioContext.sampleRate}`)
    {
        const {status, error} = await Promises.tryCatch(AudioWorklets.createFor(audioContext))
        if (status === "rejected") {
            alert(`Could not install Worklets (${error})`)
            return
        }
    }

    const {Quarter} = PPQN

    // Custom sample provider that can load local audio files
    const localAudioBuffers = new Map<string, AudioBuffer>()

    const sampleManager = new DefaultSampleLoaderManager({
        fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, SampleMetaData]> => {
            const uuidString = UUID.toString(uuid)
            const audioBuffer = localAudioBuffers.get(uuidString)

            if (audioBuffer) {
                const audioData = OpenSampleAPI.fromAudioBuffer(audioBuffer)
                const metadata: SampleMetaData = {
                    name: uuidString,
                    bpm: 120,
                    duration: audioBuffer.duration,
                    sample_rate: audioBuffer.sampleRate,
                    origin: "import"
                }
                return [audioData, metadata]
            }

            return OpenSampleAPI.get().load(audioContext, uuid, progress)
        }
    })

    const soundfontManager = new DefaultSoundfontLoaderManager({
        fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
            OpenSoundfontAPI.get().load(uuid, progress)
    })
    const audioWorklets = AudioWorklets.get(audioContext)
    const project = Project.new({audioContext, sampleManager, soundfontManager, audioWorklets})
    project.startAudioWorklet()
    await project.engine.isReady()
    console.debug("Engine is ready!");

    console.debug("Loading audio files...")
    updateStatus("Loading audio files...")

    // Load all audio files from the public folder
    const audioFiles = [
        {name: "Bass & Drums", url: "/audio/BassDrums30.mp3"},
        {name: "Guitar", url: "/audio/Guitar30.mp3"},
        {name: "Piano & Synth", url: "/audio/PianoSynth30.mp3"},
        {name: "Vocals", url: "/audio/Vocals30.mp3"}
    ]

    const audioBuffers = await Promise.all(
        audioFiles.map(file => loadAudioFile(audioContext, file.url))
    )

    console.debug("Audio files loaded, creating tracks...")
    updateStatus("Creating tracks...")

    // Store track references for monitoring
    const tracks: Array<{name: string, trackBox: TrackBox, audioUnitBox: AudioUnitBox}> = []

    const {editing, api, boxGraph} = project
    editing.modify(() => {
        // Create a tape track for each audio file
        audioFiles.forEach((file, index) => {
            const {audioUnitBox, trackBox} = api.createInstrument(InstrumentFactories.Tape)
            audioUnitBox.volume.setValue(-3)

            // Store track reference
            tracks.push({name: file.name, trackBox, audioUnitBox})

            // Create an audio region for the full duration of the audio
            const audioBuffer = audioBuffers[index]
            const durationInPPQN = Math.ceil((audioBuffer.duration * 120 / 60) * Quarter)

            const fileUUID = UUID.generate()
            const fileUUIDString = UUID.toString(fileUUID)
            localAudioBuffers.set(fileUUIDString, audioBuffer)

            const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
                box.fileName.setValue(file.name)
                box.endInSeconds.setValue(audioBuffer.duration)
            })

            AudioRegionBox.create(boxGraph, UUID.generate(), box => {
                box.regions.refer(trackBox.regions)
                box.file.refer(audioFileBox)
                box.position.setValue(0)
                box.duration.setValue(durationInPPQN)
                box.loopOffset.setValue(0)
                box.loopDuration.setValue(durationInPPQN)
                box.label.setValue(file.name)
                box.mute.setValue(false)
            })

            console.debug(`Created track "${file.name}"`)
        })
    })

    console.debug("Tracks created, setting up lifecycle demo...")
    project.engine.setPosition(0)

    // Root lifecycle manager - owns everything
    const appLifecycle = new Terminator()

    // Transport display
    let transportDisplay: TransportDisplay | null = null

    // Track monitors
    const trackMonitors = new Map<string, TrackMonitor>()

    // UI Elements
    const transportContainer = document.querySelector("#transport-container") as HTMLElement
    const monitorsContainer = document.querySelector("#monitors-container") as HTMLElement
    const toggleTransportBtn = document.querySelector("#toggle-transport") as HTMLButtonElement
    const addMonitorSelect = document.querySelector("#add-monitor") as HTMLSelectElement
    const addMonitorBtn = document.querySelector("#add-monitor-btn") as HTMLButtonElement
    const playButton = document.querySelector("#playButton") as HTMLButtonElement
    const stopButton = document.querySelector("#stopButton") as HTMLButtonElement
    const muteButtons = document.querySelectorAll(".mute-track-btn") as NodeListOf<HTMLButtonElement>
    const soloButtons = document.querySelectorAll(".solo-track-btn") as NodeListOf<HTMLButtonElement>

    // Populate track selector
    tracks.forEach((track, index) => {
        const option = document.createElement("option")
        option.value = index.toString()
        option.textContent = track.name
        addMonitorSelect.appendChild(option)
    })

    // Toggle transport display
    toggleTransportBtn.addEventListener("click", () => {
        if (transportDisplay) {
            transportDisplay.terminate()
            transportDisplay = null
            toggleTransportBtn.textContent = "Show Transport"
            toggleTransportBtn.classList.remove("active")
        } else {
            transportDisplay = new TransportDisplay(transportContainer, project)
            appLifecycle.own(transportDisplay)
            toggleTransportBtn.textContent = "Hide Transport"
            toggleTransportBtn.classList.add("active")
        }
    })

    // Add track monitor
    addMonitorBtn.addEventListener("click", () => {
        const trackIndex = parseInt(addMonitorSelect.value)
        const track = tracks[trackIndex]

        if (trackMonitors.has(track.name)) {
            alert(`Monitor for "${track.name}" already exists`)
            return
        }

        const monitorContainer = document.createElement("div")
        monitorContainer.className = "monitor-wrapper"
        monitorsContainer.appendChild(monitorContainer)

        const monitor = new TrackMonitor(
            monitorContainer,
            project,
            track.trackBox,
            track.audioUnitBox,
            track.name
        )

        trackMonitors.set(track.name, monitor)
        appLifecycle.own(monitor)

        // Setup remove button
        const removeBtn = monitorContainer.querySelector(".remove-btn") as HTMLButtonElement
        removeBtn.addEventListener("click", () => {
            monitor.terminate()
            trackMonitors.delete(track.name)
            // Keep the terminated display for 2 seconds, then remove
            setTimeout(() => {
                monitorContainer.remove()
            }, 2000)
        })
    })

    // Play button
    playButton.addEventListener("click", async () => {
        if (audioContext.state === "suspended") {
            await audioContext.resume()
        }
        project.engine.play()
        playButton.disabled = true
        stopButton.disabled = false
        updateStatus("Playing...")
    })

    // Stop button
    stopButton.addEventListener("click", () => {
        project.engine.stop(true)
        project.engine.setPosition(0)
        playButton.disabled = false
        stopButton.disabled = true
        updateStatus("Stopped")
    })

    // Mute buttons
    muteButtons.forEach((btn, index) => {
        btn.addEventListener("click", () => {
            const track = tracks[index]
            const currentMute = track.audioUnitBox.mute.getValue()
            editing.modify(() => {
                track.audioUnitBox.mute.setValue(!currentMute)
            })
            btn.textContent = !currentMute ? "Unmute" : "Mute"
        })
    })

    // Solo buttons
    soloButtons.forEach((btn, index) => {
        btn.addEventListener("click", () => {
            const track = tracks[index]
            const currentSolo = track.audioUnitBox.solo.getValue()
            const isMuted = track.audioUnitBox.mute.getValue()
            editing.modify(() => {
                track.audioUnitBox.solo.setValue(!currentSolo)
                // If soloing a muted track, unmute it (solo takes precedence over mute)
                if (!currentSolo && isMuted) {
                    track.audioUnitBox.mute.setValue(false)
                    console.debug(`[Solo] Track "${track.name}" - Unmuting because solo takes precedence`)
                }
            })
            btn.textContent = !currentSolo ? "Unsolo" : "Solo"
        })
    })

    // Cleanup on page unload
    window.addEventListener("beforeunload", () => {
        console.debug("[App] Cleaning up all lifecycle...")
        appLifecycle.terminate()
        console.debug("[App] All cleaned up!")
    })

    updateStatus("Ready - Add monitors to see lifecycle in action!")
    console.debug("Demo ready!")
})()
