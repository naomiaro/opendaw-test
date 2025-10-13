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
    SampleProvider,
    Workers
} from "@opendaw/studio-core"
import {testFeatures} from "./features"

import WorkersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

(async () => {
    console.debug("openDAW -> headless")
    console.debug("WorkersUrl", WorkersUrl)
    console.debug("WorkletsUrl", WorkletsUrl)
    assert(crossOriginIsolated, "window must be crossOriginIsolated")
    console.debug("booting...")
    document.body.textContent = "booting..."
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
        const {Quarter, Bar, SemiQuaver} = PPQN
        const sampleManager = new DefaultSampleLoaderManager({
            fetch: async (uuid: UUID.Bytes, progress: Procedure<unitValue>): Promise<[AudioData, SampleMetaData]> =>
                OpenSampleAPI.get().load(audioContext, uuid, progress)
        } satisfies SampleProvider)
        const soundfontManager = new DefaultSoundfontLoaderManager({
            fetch: async (uuid: UUID.Bytes, progress: Progress.Handler): Promise<[ArrayBuffer, SoundfontMetaData]> =>
                OpenSoundfontAPI.get().load(uuid, progress)
        })
        const audioWorklets = AudioWorklets.get(audioContext)
        const project = Project.new({audioContext, sampleManager, soundfontManager, audioWorklets})
        project.startAudioWorklet()
        await project.engine.isReady()
        project.engine.play()
        const {editing, api} = project
        editing.modify(() => {
            const {trackBox} = api.createInstrument(InstrumentFactories.Vaporisateur)
            const noteRegionBox = api.createNoteRegion({
                trackBox,
                position: Quarter * 0,
                duration: Bar * 4,
                loopDuration: Quarter
            })
            api.createNoteEvent({owner: noteRegionBox, position: SemiQuaver * 0, duration: SemiQuaver, pitch: 60})
            api.createNoteEvent({owner: noteRegionBox, position: SemiQuaver * 1, duration: SemiQuaver, pitch: 63})
            api.createNoteEvent({owner: noteRegionBox, position: SemiQuaver * 2, duration: SemiQuaver, pitch: 67})
            api.createNoteEvent({owner: noteRegionBox, position: SemiQuaver * 3, duration: SemiQuaver, pitch: 70})
        })
    }
    if (audioContext.state === "suspended") {
        window.addEventListener("click",
            async () => await audioContext.resume().then(() =>
                console.debug(`AudioContext resumed (${audioContext.state})`)), {capture: true, once: true})
    }
    document.querySelector("#preloader")?.remove()
    document.body.textContent = "running..."
})()