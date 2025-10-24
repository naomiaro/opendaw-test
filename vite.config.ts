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
                playback: resolve(__dirname, "playback-demo-react.html"),
                recordingApi: resolve(__dirname, "recording-api-react-demo.html"),
                lifecycle: resolve(__dirname, "lifecycle-react-demo.html")
            }
        }
    },
    server: {
        port: 8080,
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