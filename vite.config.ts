import {defineConfig, type Plugin} from "vite"
import react from "@vitejs/plugin-react"
import crossOriginIsolation from "vite-plugin-cross-origin-isolation"
import {readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync} from "fs"
import {resolve, join, extname, sep} from "path"

// Dev-only sink for the audio-verify harness: PUT /__verify/<name>.wav writes
// the body to .verify-output/ so the audio-analyzer MCP can read it from disk.
// Never part of the production build (apply: "serve").
const MAX_VERIFY_BYTES = 150 * 1024 * 1024 // full-song float32 WAV ≈ 99 MB
const verifySink = (): Plugin => ({
    name: "verify-sink",
    apply: "serve",
    configureServer(server) {
        server.middlewares.use("/__verify", (req, res) => {
            const name = (req.url ?? "").replace(/^\//, "")
            if (req.method !== "PUT" || !/^[a-z0-9-]+\.wav$/.test(name)) {
                res.statusCode = req.method !== "PUT" ? 405 : 400
                res.end(req.method !== "PUT" ? "PUT only" : "bad name")
                return
            }
            const chunks: Buffer[] = []
            let size = 0
            req.on("data", (chunk: Buffer) => {
                if (res.writableEnded) return
                size += chunk.length
                if (size > MAX_VERIFY_BYTES) {
                    res.statusCode = 413
                    res.end("too large")
                    req.destroy()
                    return
                }
                chunks.push(chunk)
            })
            req.on("end", () => {
                if (res.writableEnded) return
                // Runs in the event loop, outside connect's try/catch — a sync
                // throw here (disk full, EACCES) would crash the dev server.
                try {
                    mkdirSync(resolve(__dirname, ".verify-output"), {recursive: true})
                    writeFileSync(resolve(__dirname, ".verify-output", name), Buffer.concat(chunks))
                    res.statusCode = 200
                    res.end("ok")
                } catch (err) {
                    console.error("[verify-sink] write failed:", String(err))
                    if (!res.writableEnded) {
                        res.statusCode = 500
                        res.end(`write error: ${String(err)}`)
                    }
                }
            })
            req.on("error", (err: unknown) => {
                console.error("[verify-sink] read failed:", String(err))
                if (!res.writableEnded) {
                    res.statusCode = 500
                    res.end("read error")
                }
            })
        })
    },
})

// Serves the WASM engine artifacts shipped in @opendaw/studio-core-wasm's dist/ under
// /wasm-engine (dev: middleware straight from node_modules; build: emitFile the wasm/ tree).
// Nothing binary is committed; loadEngineModules(base="/wasm-engine") fetches
// /wasm-engine/wasm/engine.wasm + /wasm-engine/wasm/plugins/device_*.wasm.
const WASM_DIST = resolve(__dirname, "node_modules/@opendaw/studio-core-wasm/dist")
// Dev serves ONLY the wasm/ subtree the build emits, so dev and prod expose the same surface
// (the processor/offline-worker URLs are handled by Vite's own ?url pipeline, not this middleware).
const WASM_SERVE_ROOT = resolve(WASM_DIST, "wasm")
const MIME: Record<string, string> = {".wasm": "application/wasm", ".js": "text/javascript", ".map": "application/json"}

const wasmEngineAssets = (): Plugin => ({
    name: "wasm-engine-assets",
    apply: "serve",
    configureServer(server) {
        server.middlewares.use("/wasm-engine", (req, res, next) => {
            // Runs outside connect's try/catch — a sync throw kills the dev server.
            try {
                const rel = (req.url ?? "/").split("?")[0].replace(/^\/+/, "")
                const file = resolve(WASM_DIST, rel)
                if (!(file === WASM_SERVE_ROOT || file.startsWith(WASM_SERVE_ROOT + sep)) || !existsSync(file) || !statSync(file).isFile()) {
                    return next()
                }
                res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream")
                res.end(readFileSync(file))
            } catch (err) {
                console.error("[wasm-engine-assets] serve failed:", String(err))
                next()
            }
        })
    }
})

// Build-time counterpart: emit the wasm/ subtree so production serves /wasm-engine/wasm/**.
const wasmEngineEmit = (): Plugin => ({
    name: "wasm-engine-emit",
    apply: "build",
    buildStart() {
        const root = resolve(WASM_DIST, "wasm")
        if (!existsSync(root)) {
            this.warn("wasm-engine-emit: no artifacts in node_modules/@opendaw/studio-core-wasm/dist/wasm — WASM engine will be unavailable in the build")
            return
        }
        const walk = (dir: string): string[] =>
            readdirSync(dir).flatMap(name => {
                const full = join(dir, name)
                return statSync(full).isDirectory() ? walk(full) : [full]
            })
        for (const full of walk(root)) {
            if (extname(full) !== ".wasm") continue
            const rel = full.slice(WASM_DIST.length + 1).split("\\").join("/") // e.g. wasm/plugins/device_x.wasm
            this.emitFile({type: "asset", fileName: `wasm-engine/${rel}`, source: readFileSync(full)})
        }
    }
})

// Only load SSL certs if they exist (for local dev)
const certKeyPath = "localhost-key.pem"
const certPath = "localhost.pem"
const hasLocalCerts = existsSync(certKeyPath) && existsSync(certPath)

export default defineConfig({
    // For GitHub Pages deployment: set base to '/repo-name/' or use env variable
    // For local dev and production on custom domain, use '/'
    base: process.env.VITE_BASE_PATH || '/',
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src")
        }
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                effects: resolve(__dirname, "effects-demo.html"),
                trackEditing: resolve(__dirname, "track-editing-demo.html"),
                recordingApi: resolve(__dirname, "recording-api-react-demo.html"),
                drumScheduling: resolve(__dirname, "drum-scheduling-demo.html"),
                looping: resolve(__dirname, "looping-demo.html"),
                timebase: resolve(__dirname, "timebase-demo.html"),
                tempoAutomation: resolve(__dirname, "tempo-automation-demo.html"),
                timeSignature: resolve(__dirname, "time-signature-demo.html"),
                clipFades: resolve(__dirname, "clip-fades-demo.html"),
                mixerGroups: resolve(__dirname, "mixer-groups-demo.html"),
                midiRecording: resolve(__dirname, "midi-recording-demo.html"),
                loopRecording: resolve(__dirname, "loop-recording-demo.html"),
                trackAutomation: resolve(__dirname, "track-automation-demo.html"),
                clipLooping: resolve(__dirname, "clip-looping-demo.html"),
                timePitch: resolve(__dirname, "time-pitch-demo.html"),
                warpVarispeed: resolve(__dirname, "warp-varispeed-demo.html"),
                warpGridFollowsFile: resolve(__dirname, "warp-grid-follows-file-demo.html"),
                warpTimestretch: resolve(__dirname, "warp-timestretch-demo.html"),
                warpOverview: resolve(__dirname, "warp-demos.html"),
                werkstatt: resolve(__dirname, "werkstatt-demo.html"),
                apparat: resolve(__dirname, "apparat-demo.html"),
                export: resolve(__dirname, "export-demo.html"),
                compLanes: resolve(__dirname, "comp-lanes-demo.html"),
                compLanesDebug: resolve(__dirname, "comp-lanes-debug-demo.html"),
                fadeOutEndOfFileDebug: resolve(__dirname, "fade-out-end-of-file-debug-demo.html"),
                pureWebaudioTargetDebug: resolve(__dirname, "pure-webaudio-target-debug-demo.html"),
                sharedSourceDoubleProcessDebug: resolve(__dirname, "shared-source-double-process-debug-demo.html"),
                voiceFadeinClipFadeinProductDebug: resolve(__dirname, "voice-fadein-clip-fadein-product-debug-demo.html"),
                timePitchStartPositionDebug: resolve(__dirname, "time-pitch-start-position-debug-demo.html"),
                audioVerifyDebug: resolve(__dirname, "audio-verify-debug.html"),
                recordingFinalizeDebug: resolve(__dirname, "recording-finalize-debug-demo.html"),
                wasmEngine: resolve(__dirname, "wasm-engine-demo.html")
            },
            output: {
                manualChunks: (id) => {
                    // Only split OpenDAW packages, let Vite handle React/UI libraries automatically
                    if (id.includes('node_modules')) {
                        // Split large OpenDAW packages
                        if (id.includes('@opendaw/studio-core')) {
                            return 'opendaw-core';
                        }
                        if (id.includes('@opendaw/studio-boxes')) {
                            return 'opendaw-boxes';
                        }
                        if (id.includes('@opendaw/studio-adapters')) {
                            return 'opendaw-adapters';
                        }
                        if (id.includes('@opendaw/lib-')) {
                            return 'opendaw-libs';
                        }
                    }
                    // Let Vite handle all other chunking automatically
                    return undefined;
                }
            }
        }
    },
    server: {
        port: 5173,
        host: "localhost",
        // Only use HTTPS with local certs in dev mode
        ...(hasLocalCerts && {
            https: {
                key: readFileSync(certKeyPath),
                cert: readFileSync(certPath)
            }
        }),
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
        },
        fs: {
            // Allow serving files from the entire workspace
            allow: [".."]
        }
    },
    plugins: [
        react(),
        crossOriginIsolation(),
        verifySink(),
        wasmEngineAssets(),
        wasmEngineEmit()
    ]
})
