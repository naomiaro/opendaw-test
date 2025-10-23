import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"
import crossOriginIsolation from "vite-plugin-cross-origin-isolation"
import {readFileSync} from "fs"
import {resolve} from "path"

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src")
        }
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                playback: resolve(__dirname, "playback-demo.html"),
                recordingApi: resolve(__dirname, "recording-api-demo.html"),
                lifecycle: resolve(__dirname, "lifecycle-demo.html"),
                lifecycleReact: resolve(__dirname, "lifecycle-react-demo.html")
            }
        }
    },
    server: {
        port: 8080,
        host: "localhost",
        https: {
            key: readFileSync("localhost-key.pem"),
            cert: readFileSync("localhost.pem")
        },
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