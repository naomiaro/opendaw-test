import {assert, ProgressHandler, UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {AudioData, SampleMetaData} from "@opendaw/studio-adapters"
import {MainThreadSampleManager, Project, SampleProvider, WorkerAgents, Worklets} from "@opendaw/studio-core"
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
        const provider: SampleProvider = {
            fetch: (uuid: UUID.Format, progress: ProgressHandler): Promise<[AudioData, SampleMetaData]> =>
                SampleApi.load(context, uuid, progress)
        }
        const sampleManager = new MainThreadSampleManager(provider, context)
        const project = Project.load({sampleManager}, await fetch("subset.od").then(x => x.arrayBuffer()))
        const worklet = Worklets.get(context).createEngine(project)
        await worklet.isReady()
        while (!await worklet.queryLoadingComplete()) {}
        worklet.connect(context.destination)
        worklet.isPlaying().setValue(true)
    }
    if (context.state === "suspended") {
        window.addEventListener("click",
            async () => await context.resume().then(() =>
                console.debug(`AudioContext resumed (${context.state})`)), {capture: true, once: true})
    }
    document.querySelector("#preloader")?.remove()
    document.body.textContent = "running..."
})()