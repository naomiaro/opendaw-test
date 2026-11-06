# Effects monitoring reaches the output twice: main mix and monitor output

**Title:** In "With Effects" monitoring the live input leaves the engine on both outputs, and only the main
output follows delay compensation

**Issue:** [openDAW#528](https://github.com/andremichelle/openDAW/issues/528) (filed 2026-11-05, asks whether the main-mix route is intended); [openDAW#529](https://github.com/andremichelle/openDAW/issues/529) (filed 2026-11-05, the reported figure past the 100 ms cap).

**Verified against:** the public app, https://opendaw.studio, build `adc1d47d-eda2-406c-a1ef-87a7bbd61f83`
(`/build-info.json`, built 2026-11-04), Chrome on macOS, app sample rate 48 kHz. Source citations are read
at `@opendaw/studio-sdk@0.0.181` (`5820e7791`). The app build is newer than that tag and may differ from it.

## What was measured

A short tone burst every 0.5 s stands in for the microphone, so no acoustic path and no feedback are involved.
The engine worklet's output 0 (main) and output 1 (monitor, channel 0) are recorded side by side through one
`ChannelMerger` and `ScriptProcessor`, so the two are sample-aligned against each other. The worklet is reached by
patching `AudioNode.prototype.connect` on the dashboard, before **New Project** starts the engine (after that the
patch cannot see it); `getUserMedia` returns the burst stream. See [Probe](#probe).

Steps in the app: **New Project**, **Add audio track**, track menu → **Monitoring** (this arms the track), set **Mode**.

| Monitoring mode | Project | Main output peak | Monitor output peak | Main minus monitor |
|---|---|---|---|---|
| Off | one armed track | 0 | 0 | n/a |
| Direct | one armed track | 0 | 0 | n/a (does not enter the engine) |
| With Effects | one armed track | 0.3 | 0.3 | **0 frames** on 5 of 5 bursts |
| With Effects, dialog **Mute** ticked | one armed track | 0.3 | 0.3 (tapped before the mute gain) | 0 frames |
| With Effects | plus a second track, **muted**, holding Autotune | 0.3 | 0.3 | **+1280 frames (26.67 ms)** on 5 of 5 bursts |

The input peak is 0.3, and the footer read `PDC 26.7ms` on the last row. The app's main meter (top right) and the
master strip show the monitored input in With Effects, also with the dialog's Mute ticked.

Connections logged while switching to With Effects: `ChannelMerger → Gain`, `StereoPanner → AudioDestination`. So the
monitor output reaches the destination beside output 0, which is connected to it directly.

## Reading

- The two routes sum at the destination. With no latent device they coincide, which by addition is 0.6 from a 0.3 input
  (+6 dB). With a latent device anywhere in the project, muted included, they arrive that latency apart.
- **Heard on this build (2026-11-05, one listener, headphones, real microphone):** with a Werkstatt declaring a large
  `// @latency` on a muted track, a second, later copy is audible in With Effects and goes away in Direct. Keyboard clicks
  do not show this: a click also reaches the ear through the air, so one monitored copy can sound double.
- **Not measured on this build:** the sum at the destination itself (`AudioDestinationNode` has no output to tap).
- **Above 100 ms the footer overstates the delay** (measured with the same probe, Werkstatt on a muted track):
  `// @latency 99` reads `PDC 99.0ms` and main minus monitor is 4752 frames (99 ms); `// @latency 150` reads `PDC 150.0ms`
  and main minus monitor is 4800 frames (100 ms). `PDC` shows the uncapped arrival, and `CompensationDelay::set_delay` clamps
  to `MAX_COMPENSATION_SECONDS` (0.1 s). Use a value under 100 for this test. The only place the limit surfaces is the
  Signal Graph page, which marks an edge `exceeded` when `edge.delay > graph.maxCompensation`
  (`SignalGraphPage.tsx:175`); nothing warns in the footer or at compile. Where a take or a render lands above the limit
  was not measured: both use the uncapped figure.

## Mechanism (source, 0.0.181)

- `crates/engine/src/audio_region_player.rs:358`: an armed tape sums the staged input into the player output.
- `crates/engine/src/audio_unit/wiring.rs:825`: the strip output is routed to the unit's output bus, so to the master.
- `crates/engine/src/lib.rs:2171`, `copy_monitor_outputs`: the same strip output is copied to the worklet's second output.
- `packages/studio/core/src/MonitoringRouter.ts:28` and `io/browser/BrowserMonitor.ts:135`: that output goes through the
  monitor gain and pan to the destination.

Compensation delays sit at the junctions after the strip, so the master copy moves and the tapped copy does not.

## The two documents disagree

- `plans/done/advanced-monitoring.md:317`, test 24: "Effects monitoring not in main mix".
- `plans/delay-compensation.md:153`, phase 7, listed as open at line 71: "A unit with live input monitoring hears its input
  through compensation as well".
- `plans/delay-compensation.md:126`: "Mute and solo do not change compensation (static, like every DAW)", so a muted
  device holding its latency is by design. It is not the question here: it only makes the two copies arrive apart.
- `plans/delay-compensation.md:125`: a disabled device is bypassed by the wiring and its latency drops out. Not measured here.

Whether the main-mix route is intended is the maintainer's call, so the issue asks.

## Probe

Paste in the console on the dashboard of https://opendaw.studio, before **New Project**. It replaces the microphone for
the tab. Then after each step run `__an(await __cap())`.

```js
const T = {rec: {on: false, ch: [[], []]}}, prev = AudioNode.prototype.connect
const attach = w => {
    if (T.w) {return}
    T.w = w
    const ctx = w.context, merger = ctx.createChannelMerger(2), split = ctx.createChannelSplitter(8)
    prev.call(w, merger, 0, 0)
    prev.call(w, split, 1)
    prev.call(split, merger, 0, 1)
    const sp = ctx.createScriptProcessor(4096, 2, 1), g = ctx.createGain()
    g.gain.value = 0
    prev.call(merger, sp)
    prev.call(sp, g)
    prev.call(g, ctx.destination)
    sp.onaudioprocess = e => {
        if (T.rec.on) {for (let c = 0; c < 2; c++) {T.rec.ch[c].push(new Float32Array(e.inputBuffer.getChannelData(c)))}}
    }
}
AudioNode.prototype.connect = function (t, ...a) {
    if (this instanceof AudioWorkletNode && this.numberOfOutputs === 2) {attach(this)}
    return prev.call(this, t, ...a)
}
const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
navigator.mediaDevices.getUserMedia = async c => {
    if (!c?.audio) {return gum(c)}
    if (!T.fake) {
        const ctx = new AudioContext()
        await ctx.resume()
        const r = ctx.sampleRate, b = ctx.createBuffer(1, r / 2, r), d = b.getChannelData(0), n = Math.round(r * .005)
        for (let i = 0; i < n; i++) {d[i] = .3 * Math.sin(2 * Math.PI * 1500 * i / r) * Math.sin(Math.PI * i / n) ** 2}
        const s = ctx.createBufferSource()
        s.buffer = b
        s.loop = true
        T.fake = ctx.createMediaStreamDestination()
        T.fake.channelCount = 1
        s.connect(T.fake)
        s.start()
    }
    return new MediaStream([T.fake.stream.getAudioTracks()[0].clone()])
}
window.__cap = async (sec = 2.5) => {
    T.rec.ch = [[], []]
    T.rec.on = true
    await new Promise(r => setTimeout(r, sec * 1000))
    T.rec.on = false
    return T.rec.ch.map(a => {
        const o = new Float32Array(a.reduce((q, x) => q + x.length, 0))
        let k = 0
        for (const x of a) {
            o.set(x, k)
            k += x.length
        }
        return o
    })
}
window.__an = ([main, mon]) => {
    const on = c => {
        const mx = c.reduce((m, v) => Math.max(m, Math.abs(v)), 0), o = []
        if (mx < .005) {return {pk: 0, on: o}}
        let last = -1e9
        c.forEach((v, j) => {
            if (Math.abs(v) > .25 * mx) {
                if (j - last > 5000) {o.push(j)}
                last = j
            }
        })
        return {pk: +mx.toFixed(3), on: o}
    }
    const a = on(main), b = on(mon)
    return {main: a.pk, monitor: b.pk, mainMinusMonitor: b.on.map(x => a.on.map(y => y - x)
        .filter(d => Math.abs(d) < 9000).sort((p, q) => Math.abs(p) - Math.abs(q))[0])}
}
```

## Pitfalls met here

- The production build minifies class names, so match `instanceof AudioWorkletNode`, not a name.
- The patch must be in place before **New Project**: once the engine is running, later connects did not reveal it.
- Give the app's menu a moment to open before clicking an item; a missed click leaves nothing armed, and a silent
  reading then looks like a clean result. Check that `getUserMedia` was called before reading a row.
