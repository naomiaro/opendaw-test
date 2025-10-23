// noinspection PointlessArithmeticExpressionJS

import React, {useEffect, useState, useCallback, useRef} from "react"
import {createRoot} from "react-dom/client"
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
import {AnimationFrame} from "@opendaw/lib-dom"
import {testFeatures} from "./features"

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

// Helper function to load audio files
async function loadAudioFile(audioContext: AudioContext, url: string): Promise<AudioBuffer> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return await audioContext.decodeAudioData(arrayBuffer)
}

/**
 * Main Playback Demo App Component
 */
const App: React.FC = () => {
    const [status, setStatus] = useState("Loading...")
    const [project, setProject] = useState<Project | null>(null)
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)

    // Refs for non-reactive values - these don't need to trigger re-renders
    const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map())
    const pausedPositionRef = useRef<number | null>(null)

    // Initialize OpenDAW
    useEffect(() => {
        let mounted = true

        ;(async () => {
            try {
                console.log("========================================")
                console.log("openDAW -> headless -> playback demo (React)")
                console.log("WorkersUrl", WorkersUrl)
                console.log("WorkletsUrl", WorkletsUrl)
                console.log("crossOriginIsolated:", crossOriginIsolated)
                console.log("SharedArrayBuffer available:", typeof SharedArrayBuffer !== "undefined")
                console.log("========================================")
                assert(crossOriginIsolated, "window must be crossOriginIsolated")
                console.debug("booting...")

                // CRITICAL: Start the AnimationFrame loop that reads state from the worklet!
                console.debug("Starting AnimationFrame loop...")
                AnimationFrame.start(window)
                console.debug("AnimationFrame started!")

                setStatus("Booting...")
                await Workers.install(WorkersUrl)
                AudioWorklets.install(WorkletsUrl)

                const {status: testStatus, error: testError} = await Promises.tryCatch(testFeatures())
                if (testStatus === "rejected") {
                    alert(`Could not test features (${testError})`)
                    return
                }

                const newAudioContext = new AudioContext({latencyHint: 0})
                console.debug(`AudioContext state: ${newAudioContext.state}, sampleRate: ${newAudioContext.sampleRate}`)

                const {status: workletStatus, error: workletError} = await Promises.tryCatch(
                    AudioWorklets.createFor(newAudioContext)
                )
                if (workletStatus === "rejected") {
                    alert(`Could not install Worklets (${workletError})`)
                    return
                }

                const {Quarter} = PPQN

                // Custom sample provider that can load local audio files
                const sampleManager = new DefaultSampleLoaderManager({
                    fetch: async (
                        uuid: UUID.Bytes,
                        progress: Procedure<unitValue>
                    ): Promise<[AudioData, SampleMetaData]> => {
                        const uuidString = UUID.toString(uuid)
                        console.debug(`Sample manager fetch called for UUID: ${uuidString}`)
                        const audioBuffer = localAudioBuffersRef.current.get(uuidString)

                        if (audioBuffer) {
                            console.debug(
                                `Found local audio buffer for ${uuidString}, channels: ${audioBuffer.numberOfChannels}, duration: ${audioBuffer.duration}s`
                            )
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
                        return OpenSampleAPI.get().load(newAudioContext, uuid, progress)
                    }
                })

                const soundfontManager = new DefaultSoundfontLoaderManager({
                    fetch: async (
                        uuid: UUID.Bytes,
                        progress: Progress.Handler
                    ): Promise<[ArrayBuffer, SoundfontMetaData]> => OpenSoundfontAPI.get().load(uuid, progress)
                })

                const audioWorklets = AudioWorklets.get(newAudioContext)
                const newProject = Project.new({
                    audioContext: newAudioContext,
                    sampleManager,
                    soundfontManager,
                    audioWorklets
                })
                newProject.startAudioWorklet()
                await newProject.engine.isReady()
                console.debug("Engine is ready!")

                // Subscribe to engine state changes
                newProject.engine.isPlaying.subscribe((obs) => {
                    console.debug("[ENGINE] isPlaying:", obs.getValue())
                })
                newProject.engine.position.subscribe((obs) => {
                    console.debug("[ENGINE] position:", obs.getValue())
                })

                if (!mounted) return

                console.debug("Loading audio files...")
                setStatus("Loading audio files...")

                // Load all audio files from the public folder
                const audioFiles = [
                    {name: "Bass & Drums", url: "/audio/BassDrums30.mp3"},
                    {name: "Guitar", url: "/audio/Guitar30.mp3"},
                    {name: "Piano & Synth", url: "/audio/PianoSynth30.mp3"},
                    {name: "Vocals", url: "/audio/Vocals30.mp3"}
                ]

                const audioBuffers = await Promise.all(audioFiles.map(file => loadAudioFile(newAudioContext, file.url)))

                if (!mounted) return

                console.debug("Audio files loaded, creating tracks...")
                setStatus("Creating tracks...")

                const {editing, api, boxGraph} = newProject
                editing.modify(() => {
                    // Create a tape track for each audio file
                    audioFiles.forEach((file, index) => {
                        const {audioUnitBox, trackBox} = api.createInstrument(InstrumentFactories.Tape)
                        audioUnitBox.volume.setValue(-3)

                        // Create an audio region for the full duration of the audio
                        const audioBuffer = audioBuffers[index]
                        const durationInPPQN = Math.ceil(((audioBuffer.duration * 120) / 60) * Quarter) // Assuming 120 BPM

                        // Generate a UUID for this audio file
                        const fileUUID = UUID.generate()
                        const fileUUIDString = UUID.toString(fileUUID)

                        // Store the audio buffer so our sample manager can load it
                        localAudioBuffersRef.current.set(fileUUIDString, audioBuffer)

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
                console.debug(`Timeline position: ${newProject.engine.position.getValue()}`)
                console.debug(`BPM: ${newProject.bpm}`)

                // Make sure the timeline is at the beginning
                newProject.engine.setPosition(0)

                if (!mounted) return

                setAudioContext(newAudioContext)
                setProject(newProject)
                setStatus("Ready - Click Play to start")
            } catch (error) {
                console.error("Initialization error:", error)
                setStatus(`Error: ${error}`)
            }
        })()

        return () => {
            mounted = false
        }
    }, [])

    const handlePlay = useCallback(async () => {
        if (!project || !audioContext) return

        console.debug("Play button clicked")

        // Resume AudioContext if suspended
        if (audioContext.state === "suspended") {
            console.debug("Resuming AudioContext...")
            await audioContext.resume()
            console.debug(`AudioContext resumed (${audioContext.state})`)
        }

        // If resuming from pause, restore the position
        if (pausedPositionRef.current !== null) {
            console.debug(`Restoring paused position: ${pausedPositionRef.current}`)
            project.engine.setPosition(pausedPositionRef.current)
            pausedPositionRef.current = null
        }

        console.debug("Starting playback...")
        project.engine.play()

        setIsPlaying(true)
        setStatus("Playing...")
    }, [project, audioContext])

    const handlePause = useCallback(() => {
        if (!project) return

        console.debug("Pause button clicked")

        // Read current position from observable
        const currentPosition = project.engine.position.getValue()
        console.debug(`Current position from observable: ${currentPosition}`)

        // Save it for resume
        pausedPositionRef.current = currentPosition
        console.debug(`Saved paused position: ${pausedPositionRef.current}`)

        // Stop playback (don't reset position)
        project.engine.stop(false)

        setIsPlaying(false)
        setStatus("Paused")
    }, [project])

    const handleStop = useCallback(() => {
        if (!project) return

        console.debug("Stop button clicked")
        // Clear any saved pause position
        pausedPositionRef.current = null
        // Stop and reset to beginning
        project.engine.stop(true)
        project.engine.setPosition(0)
        setIsPlaying(false)
        setStatus("Stopped")
    }, [project])

    if (!project) {
        return (
            <div id="controls">
                <h1>OpenDAW Multi-track Playback</h1>
                <div id="status">{status}</div>
            </div>
        )
    }

    return (
        <div id="controls">
            <h1>OpenDAW Multi-track Playback</h1>
            <div id="buttonGroup">
                <button id="playButton" onClick={handlePlay} disabled={isPlaying}>
                    Play
                </button>
                <button id="pauseButton" onClick={handlePause} disabled={!isPlaying}>
                    Pause
                </button>
                <button id="stopButton" onClick={handleStop} disabled={!isPlaying}>
                    Stop
                </button>
            </div>
            <div id="status">{status}</div>
        </div>
    )
}

// Bootstrap the React app
const rootElement = document.getElementById("root")
if (rootElement) {
    const root = createRoot(rootElement)
    root.render(<App />)
}
