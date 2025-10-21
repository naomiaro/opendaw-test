// noinspection PointlessArithmeticExpressionJS

import {assert, Procedure, Progress, unitValue, UUID} from "@opendaw/lib-std"
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
import {AudioFileBox, AudioRegionBox} from "@opendaw/studio-boxes"
import {testFeatures} from "./features"

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

// Helper function to load audio files
async function loadAudioFile(audioContext: AudioContext, url: string): Promise<AudioBuffer> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return await audioContext.decodeAudioData(arrayBuffer)
}

(async () => {
    console.debug("openDAW -> headless")
    console.debug("WorkersUrl", WorkersUrl)
    console.debug("WorkletsUrl", WorkletsUrl)
    assert(crossOriginIsolated, "window must be crossOriginIsolated")
    console.debug("booting...")

    const updateStatus = (text: string) => {
        const preloader = document.querySelector("#preloader")
        const status = document.querySelector("#status")
        if (preloader) preloader.textContent = text
        if (status) status.textContent = text
    }

    updateStatus("Booting...")
    await Workers.install(WorkersUrl)
    AudioWorklets.install(WorkletsUrl)
    {
        const {status, error} = await Promises.tryCatch(testFeatures())
        if (status === "rejected") {
            document.querySelector("#preloader")?.remove()
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
    {
        const {Quarter} = PPQN

        // Custom sample provider that can load local audio files
        const localAudioBuffers = new Map<string, AudioBuffer>()

        const sampleManager = new DefaultSampleLoaderManager({
            fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, SampleMetaData]> => {
                const uuidString = UUID.toString(uuid)
                console.debug(`Sample manager fetch called for UUID: ${uuidString}`)
                const audioBuffer = localAudioBuffers.get(uuidString)

                if (audioBuffer) {
                    console.debug(`Found local audio buffer for ${uuidString}, channels: ${audioBuffer.numberOfChannels}, duration: ${audioBuffer.duration}s`)
                    // Convert AudioBuffer to AudioData format expected by OpenDAW
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

                // Fall back to OpenSampleAPI for built-in samples
                console.debug(`No local buffer found for ${uuidString}, falling back to OpenSampleAPI`)
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

        const {editing, api, boxGraph} = project
        editing.modify(() => {
            // Create a tape track for each audio file
            audioFiles.forEach((file, index) => {
                const {audioUnitBox, trackBox} = api.createInstrument(InstrumentFactories.Tape)
                audioUnitBox.volume.setValue(-3)

                // Create an audio region for the full duration of the audio
                const audioBuffer = audioBuffers[index]
                const durationInPPQN = Math.ceil((audioBuffer.duration * 120 / 60) * Quarter) // Assuming 120 BPM

                // Generate a UUID for this audio file
                const fileUUID = UUID.generate()
                const fileUUIDString = UUID.toString(fileUUID)

                // Store the audio buffer so our sample manager can load it
                localAudioBuffers.set(fileUUIDString, audioBuffer)

                // Create AudioFileBox
                const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
                    box.fileName.setValue(file.name)
                    box.endInSeconds.setValue(audioBuffer.duration)
                })

                // Create AudioRegionBox
                AudioRegionBox.create(boxGraph, UUID.generate(), box => {
                    box.regions.refer(trackBox.regions)
                    box.file.refer(audioFileBox)
                    box.position.setValue(0) // Start at the beginning
                    box.duration.setValue(durationInPPQN)
                    box.loopOffset.setValue(0)
                    box.loopDuration.setValue(durationInPPQN)
                    box.label.setValue(file.name)
                    box.mute.setValue(false)
                })

                console.debug(`Created track "${file.name}"`)
                console.debug(`  - Audio duration: ${audioBuffer.duration}s`)
                console.debug(`  - Duration in PPQN: ${durationInPPQN}`)
                console.debug(`  - AudioFile UUID: ${fileUUIDString}`)
            })
        })

        console.debug("Tracks created, ready to play")
        console.debug(`Timeline position: ${project.engine.position.getValue()}`)
        console.debug(`BPM: ${project.bpm}`)

        // Make sure the timeline is at the beginning
        project.engine.setPosition(0)

        updateStatus("Ready - Click Play to start")

        // Hide preloader, show controls
        const preloader = document.querySelector("#preloader") as HTMLElement
        const controls = document.querySelector("#controls") as HTMLElement
        const playButton = document.querySelector("#playButton") as HTMLButtonElement

        if (preloader) preloader.style.display = "none"
        if (controls) controls.style.display = "flex"

        // Setup play button
        if (playButton) {
            playButton.addEventListener("click", async () => {
                console.debug("Play button clicked")

                // Resume AudioContext if suspended
                if (audioContext.state === "suspended") {
                    console.debug("Resuming AudioContext...")
                    await audioContext.resume()
                    console.debug(`AudioContext resumed (${audioContext.state})`)
                }

                // Toggle play/stop
                if (project.engine.isPlaying.getValue()) {
                    console.debug("Stopping playback")
                    project.engine.stop()
                    playButton.textContent = "Play"
                    updateStatus("Stopped")
                } else {
                    console.debug("Starting playback")
                    console.debug(`AudioContext state: ${audioContext.state}`)
                    console.debug(`Master volume: ${project.masterAudioUnit.volume.getValue()}`)
                    project.engine.play()
                    playButton.textContent = "Stop"
                    updateStatus("Playing...")
                }
            })
        }
    }
})()