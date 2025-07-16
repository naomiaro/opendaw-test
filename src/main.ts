// noinspection PointlessArithmeticExpressionJS

import {assert, ProgressHandler, UUID} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import {Promises} from "@opendaw/lib-runtime"
import {NoteEventBox, NoteEventCollectionBox, NoteRegionBox} from "@opendaw/studio-boxes"
import {AudioData, SampleMetaData} from "@opendaw/studio-adapters"
import {
    InstrumentFactories,
    MainThreadSampleManager,
    Project,
    SampleProvider,
    WorkerAgents,
    Worklets
} from "@opendaw/studio-core"
import {testFeatures} from "./features"
import {SampleApi} from "./SampleApi"

import WorkersUrl from "@opendaw/studio-core/workers.js?worker&url"
import WorkletsUrl from "@opendaw/studio-core/processors.js?url"

(async () => {
    console.debug("openDAW -> headless")
    assert(crossOriginIsolated, "window must be crossOriginIsolated")
    console.debug("booting...")
    document.body.textContent = "booting..."
    WorkerAgents.install(WorkersUrl)
    {
        const {status, error} = await Promises.tryCatch(testFeatures())
        if (status === "rejected") {
            document.querySelector("#preloader")?.remove()
            alert(`Could not test features (${error})`)
            return
        }
    }
    const context = new AudioContext({latencyHint: 0})
    console.debug(`AudioContext state: ${context.state}, sampleRate: ${context.sampleRate}`)
    {
        const {status, error} = await Promises.tryCatch(Worklets.install(context, WorkletsUrl))
        if (status === "rejected") {
            alert(`Could not install Worklets (${error})`)
            return
        }
    }
    {
        const sampleProvider = new class implements SampleProvider {
            fetch(uuid: UUID.Format, progress: ProgressHandler): Promise<[AudioData, SampleMetaData]> {
                return SampleApi.load(context, uuid, progress)
            }
        }
        const sampleManager = new MainThreadSampleManager(sampleProvider, context)
        const project = Project.new({sampleManager})
        const worklet = Worklets.get(context).createEngine(project)
        await worklet.isReady()
        while (!await worklet.queryLoadingComplete()) {}
        worklet.connect(context.destination)
        worklet.isPlaying().setValue(true)
        const {boxGraph, editing, api} = project
        editing.modify(() => {
            const {trackBox: {regions}} = api.createInstrument(InstrumentFactories.Vaporisateur)
            const collectionBox = NoteEventCollectionBox.create(boxGraph, UUID.generate())
            NoteEventBox.create(boxGraph, UUID.generate(), box => {
                box.position.setValue(PPQN.SemiQuaver * 0)
                box.duration.setValue(PPQN.SemiQuaver * 1)
                box.pitch.setValue(60)
                box.events.refer(collectionBox.events)
            })
            NoteEventBox.create(boxGraph, UUID.generate(), box => {
                box.position.setValue(PPQN.SemiQuaver * 1)
                box.duration.setValue(PPQN.SemiQuaver * 1)
                box.pitch.setValue(63)
                box.events.refer(collectionBox.events)
            })
            NoteEventBox.create(boxGraph, UUID.generate(), box => {
                box.position.setValue(PPQN.SemiQuaver * 2)
                box.duration.setValue(PPQN.SemiQuaver * 1)
                box.pitch.setValue(65)
                box.events.refer(collectionBox.events)
            })
            NoteRegionBox.create(boxGraph, UUID.generate(), box => {
                box.position.setValue(PPQN.Quarter * 0)
                box.duration.setValue(PPQN.Bar * 4)
                box.loopDuration.setValue(PPQN.Quarter * 1)
                box.events.refer(collectionBox.owners)
                box.regions.refer(regions)
            })
        })
    }
    if (context.state === "suspended") {
        window.addEventListener("click",
            async () => await context.resume().then(() =>
                console.debug(`AudioContext resumed (${context.state})`)), {capture: true, once: true})
    }
    document.querySelector("#preloader")?.remove()
    document.body.textContent = "running..."
})()