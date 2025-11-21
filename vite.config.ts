import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"
import crossOriginIsolation from "vite-plugin-cross-origin-isolation"
import {readFileSync, existsSync} from "fs"
import {resolve} from "path"

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
                timebase: resolve(__dirname, "timebase-demo.html")
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
        crossOriginIsolation()
    ]
})