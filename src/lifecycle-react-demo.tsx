// noinspection PointlessArithmeticExpressionJS

import React, {useEffect, useState, useCallback} from "react"
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
import {AudioFileBox, AudioRegionBox, AudioUnitBox, TrackBox} from "@opendaw/studio-boxes"
import {AnimationFrame} from "@opendaw/lib-dom"
import {testFeatures} from "./features"

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

// Type definitions
type TrackData = {
    name: string
    trackBox: TrackBox
    audioUnitBox: AudioUnitBox
}

// Helper function to load audio files
async function loadAudioFile(audioContext: AudioContext, url: string): Promise<AudioBuffer> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return await audioContext.decodeAudioData(arrayBuffer)
}

/**
 * TransportDisplay - React component that displays global playback state
 * Demonstrates useEffect cleanup with subscriptions
 */
const TransportDisplay: React.FC<{project: Project}> = ({project}) => {
    const [isPlaying, setIsPlaying] = useState(false)
    const [position, setPosition] = useState(0)
    const [updateCount, setUpdateCount] = useState(0)

    useEffect(() => {
        console.debug("[TransportDisplay] Component mounted, subscribing...")

        // Subscribe to engine state
        const playingSubscription = project.engine.isPlaying.subscribe((obs) => {
            setUpdateCount(prev => prev + 1)
            setIsPlaying(obs.getValue())
        })

        const positionSubscription = project.engine.position.subscribe((obs) => {
            setUpdateCount(prev => prev + 1)
            setPosition(obs.getValue())
        })

        console.debug("[TransportDisplay] Subscribed")

        // Cleanup function - React will call this when component unmounts
        return () => {
            console.debug("[TransportDisplay] Component unmounting, cleaning up...")
            playingSubscription.terminate()
            positionSubscription.terminate()
            console.debug("[TransportDisplay] Subscriptions terminated")
        }
    }, [project]) // Re-run only if project changes

    return (
        <div className="transport-display">
            <h3>
                Transport Display <span className="badge">Active</span>
            </h3>
            <div className="state-row">
                <strong>Playing:</strong>
                <span style={{color: isPlaying ? "#4caf50" : "#f44336"}}>
                    {isPlaying ? "▶ Playing" : "⏸ Stopped"}
                </span>
            </div>
            <div className="state-row">
                <strong>Position:</strong> <span>{position.toFixed(2)}</span>
            </div>
            <div className="state-row">
                <strong>Updates:</strong> <span>{updateCount}</span>
            </div>
        </div>
    )
}

/**
 * TrackMonitor - React component that monitors a specific track
 * Demonstrates per-component lifecycle management
 */
const TrackMonitor: React.FC<{
    track: TrackData
    onRemove: () => void
}> = ({track, onRemove}) => {
    const [volume, setVolume] = useState(0)
    const [muted, setMuted] = useState(false)
    const [soloed, setSoloed] = useState(false)
    const [updateCount, setUpdateCount] = useState(0)

    useEffect(() => {
        console.debug(`[TrackMonitor:${track.name}] Component mounted, subscribing...`)

        // Subscribe to track state changes
        const volumeSubscription = track.audioUnitBox.volume.subscribe((obs) => {
            setUpdateCount(prev => prev + 1)
            setVolume(obs.getValue())
        })

        const muteSubscription = track.audioUnitBox.mute.subscribe((obs) => {
            setUpdateCount(prev => prev + 1)
            setMuted(obs.getValue())
        })

        const soloSubscription = track.audioUnitBox.solo.subscribe((obs) => {
            setUpdateCount(prev => prev + 1)
            setSoloed(obs.getValue())
        })

        console.debug(`[TrackMonitor:${track.name}] Subscribed`)

        // Cleanup function
        return () => {
            console.debug(`[TrackMonitor:${track.name}] Component unmounting, cleaning up...`)
            volumeSubscription.terminate()
            muteSubscription.terminate()
            soloSubscription.terminate()
            console.debug(`[TrackMonitor:${track.name}] Subscriptions terminated`)
        }
    }, [track])

    return (
        <div className="track-monitor">
            <div className="track-header">
                <h4>{track.name}</h4>
                <button className="remove-btn" onClick={onRemove}>
                    Remove
                </button>
            </div>
            <div className="track-stats">
                <div className="stat-row">
                    <strong>Volume:</strong> <span>{volume.toFixed(1)} dB</span>
                </div>
                <div className="stat-row">
                    <strong>Muted:</strong> <span>{muted ? "🔇 Yes" : "🔊 No"}</span>
                </div>
                <div className="stat-row">
                    <strong>Soloed:</strong> <span>{soloed ? "⭐ Yes" : "No"}</span>
                </div>
                <div className="stat-row">
                    <strong>Updates:</strong> <span>{updateCount}</span>
                </div>
            </div>
        </div>
    )
}

/**
 * Main App Component
 */
const App: React.FC = () => {
    const [status, setStatus] = useState("Loading...")
    const [project, setProject] = useState<Project | null>(null)
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
    const [tracks, setTracks] = useState<TrackData[]>([])
    const [isPlaying, setIsPlaying] = useState(false)
    const [showTransport, setShowTransport] = useState(false)
    const [activeMonitors, setActiveMonitors] = useState<Set<number>>(new Set())
    const [selectedTrack, setSelectedTrack] = useState(0)

    // Initialize OpenDAW
    useEffect(() => {
        let mounted = true

        ;(async () => {
            try {
                console.log("========================================")
                console.log("openDAW -> headless -> React lifecycle demo")
                console.log("WorkersUrl", WorkersUrl)
                console.log("WorkletsUrl", WorkletsUrl)
                console.log("crossOriginIsolated:", crossOriginIsolated)
                console.log("SharedArrayBuffer available:", typeof SharedArrayBuffer !== "undefined")
                console.log("========================================")
                assert(crossOriginIsolated, "window must be crossOriginIsolated")

                // Start AnimationFrame loop
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
                setAudioContext(newAudioContext)

                const {status: workletStatus, error: workletError} = await Promises.tryCatch(
                    AudioWorklets.createFor(newAudioContext)
                )
                if (workletStatus === "rejected") {
                    alert(`Could not install Worklets (${workletError})`)
                    return
                }

                const {Quarter} = PPQN

                // Custom sample provider
                const localAudioBuffers = new Map<string, AudioBuffer>()

                const sampleManager = new DefaultSampleLoaderManager({
                    fetch: async (
                        uuid: UUID.Bytes,
                        progress: Procedure<unitValue>
                    ): Promise<[AudioData, SampleMetaData]> => {
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
                const newProject = Project.new({audioContext: newAudioContext, sampleManager, soundfontManager, audioWorklets})
                newProject.startAudioWorklet()
                await newProject.engine.isReady()
                console.debug("Engine is ready!")

                if (!mounted) return

                setStatus("Loading audio files...")

                // Load audio files
                const audioFiles = [
                    {name: "Bass & Drums", url: "/audio/BassDrums30.mp3"},
                    {name: "Guitar", url: "/audio/Guitar30.mp3"},
                    {name: "Piano & Synth", url: "/audio/PianoSynth30.mp3"},
                    {name: "Vocals", url: "/audio/Vocals30.mp3"}
                ]

                const audioBuffers = await Promise.all(audioFiles.map(file => loadAudioFile(newAudioContext, file.url)))

                if (!mounted) return

                setStatus("Creating tracks...")

                // Store track references
                const newTracks: TrackData[] = []

                const {editing, api, boxGraph} = newProject
                editing.modify(() => {
                    audioFiles.forEach((file, index) => {
                        const {audioUnitBox, trackBox} = api.createInstrument(InstrumentFactories.Tape)
                        audioUnitBox.volume.setValue(-3)

                        newTracks.push({name: file.name, trackBox, audioUnitBox})

                        const audioBuffer = audioBuffers[index]
                        const durationInPPQN = Math.ceil((audioBuffer.duration * 120) / 60 * Quarter)

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

                if (!mounted) return

                newProject.engine.setPosition(0)
                setProject(newProject)
                setTracks(newTracks)
                setStatus("Ready - Add monitors to see React lifecycle in action!")
                console.debug("Demo ready!")
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
        if (audioContext.state === "suspended") {
            await audioContext.resume()
        }
        project.engine.play()
        setIsPlaying(true)
    }, [project, audioContext])

    const handleStop = useCallback(() => {
        if (!project) return
        project.engine.stop(true)
        project.engine.setPosition(0)
        setIsPlaying(false)
    }, [project])

    const handleToggleTransport = useCallback(() => {
        setShowTransport(prev => !prev)
    }, [])

    const handleAddMonitor = useCallback(() => {
        if (activeMonitors.has(selectedTrack)) {
            alert(`Monitor for "${tracks[selectedTrack].name}" already exists`)
            return
        }
        setActiveMonitors(prev => new Set(prev).add(selectedTrack))
    }, [selectedTrack, activeMonitors, tracks])

    const handleRemoveMonitor = useCallback((trackIndex: number) => {
        setActiveMonitors(prev => {
            const newSet = new Set(prev)
            newSet.delete(trackIndex)
            return newSet
        })
    }, [])

    const handleMuteTrack = useCallback(
        (index: number) => {
            if (!project) return
            const track = tracks[index]
            const currentMute = track.audioUnitBox.mute.getValue()
            project.editing.modify(() => {
                track.audioUnitBox.mute.setValue(!currentMute)
            })
        },
        [project, tracks]
    )

    const handleSoloTrack = useCallback(
        (index: number) => {
            if (!project) return
            const track = tracks[index]
            const currentSolo = track.audioUnitBox.solo.getValue()
            project.editing.modify(() => {
                track.audioUnitBox.solo.setValue(!currentSolo)
            })
        },
        [project, tracks]
    )

    if (!project) {
        return (
            <div className="container">
                <h1>OpenDAW React Lifecycle Demo</h1>
                <p className="subtitle">{status}</p>
            </div>
        )
    }

    return (
        <div className="container">
            <h1>OpenDAW React Lifecycle Demo</h1>
            <p className="subtitle">Demonstrating proper subscription cleanup with React useEffect</p>

            <div className="info-box">
                <strong>What is this demo?</strong>
                <br />
                This demo shows how to properly manage OpenDAW observable subscriptions in React using useEffect cleanup
                functions. Components automatically clean up their subscriptions when unmounted. Watch the console to see
                subscription lifecycle events!
            </div>

            {/* Playback Controls */}
            <div className="section">
                <h2>Playback Controls</h2>
                <div className="button-group">
                    <button onClick={handlePlay} disabled={isPlaying} className="btn-success">
                        ▶ Play
                    </button>
                    <button onClick={handleStop} disabled={!isPlaying} className="btn-danger">
                        ■ Stop
                    </button>
                </div>
                <div id="status">{status}</div>
            </div>

            {/* Track Controls */}
            <div className="section">
                <h2>Track Controls</h2>
                <p style={{color: "#888", fontSize: "13px", marginBottom: "15px"}}>
                    Modify track state to see monitors update in real-time
                </p>
                <div className="track-controls">
                    {tracks.map((track, index) => (
                        <React.Fragment key={index}>
                            <button onClick={() => handleMuteTrack(index)} className="btn-warning">
                                Mute {track.name}
                            </button>
                            <button onClick={() => handleSoloTrack(index)} className="btn-primary">
                                Solo {track.name}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* Component Management */}
            <div className="section">
                <h2>Component Management</h2>
                <div className="controls-section">
                    <div className="control-group">
                        <label>Transport Display</label>
                        <button
                            onClick={handleToggleTransport}
                            className={`btn-primary ${showTransport ? "active" : ""}`}
                        >
                            {showTransport ? "Hide Transport" : "Show Transport"}
                        </button>
                        <div id="transport-container">
                            {showTransport && <TransportDisplay project={project} />}
                        </div>
                    </div>
                    <div className="control-group">
                        <label>Track Monitors</label>
                        <div className="button-group">
                            <select value={selectedTrack} onChange={e => setSelectedTrack(Number(e.target.value))}>
                                {tracks.map((track, index) => (
                                    <option key={index} value={index}>
                                        {track.name}
                                    </option>
                                ))}
                            </select>
                            <button onClick={handleAddMonitor} className="btn-success">
                                Add Monitor
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Active Monitors */}
            <div className="section">
                <h2>Active Monitors</h2>
                <p style={{color: "#888", fontSize: "13px", marginBottom: "15px"}}>
                    Each monitor is a React component with its own useEffect. Click "Remove" to unmount and watch
                    subscriptions clean up automatically!
                </p>
                <div id="monitors-container" className="monitors-grid">
                    {Array.from(activeMonitors).map(trackIndex => (
                        <TrackMonitor
                            key={trackIndex}
                            track={tracks[trackIndex]}
                            onRemove={() => handleRemoveMonitor(trackIndex)}
                        />
                    ))}
                    {activeMonitors.size === 0 && (
                        <p style={{color: "#666", fontStyle: "italic"}}>
                            No active monitors. Add some to see lifecycle management in action!
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

// Bootstrap the React app
const rootElement = document.getElementById("root")
if (rootElement) {
    const root = createRoot(rootElement)
    root.render(<App />)
}
