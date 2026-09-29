import {configDefaults, defineConfig, mergeConfig} from "vitest/config"
import viteConfig from "./vite.config"

const SDK_ROUTINE = [
    /^@openDAW\/[\w-]+ is now available in /,
    /^New Project created on /,
    /^createAudioUnit type: /,
    /^(undo|redo)$/
]

// Tests run on the app's own Vite config (the `@/` alias, the React plugin),
// plus what only tests need. The build does not read this file.
export default defineConfig(env =>
    mergeConfig(viteConfig(env), defineConfig({
        test: {
            // A worktree under .claude/ holds a second copy of every test.
            exclude: [...configDefaults.exclude, ".claude/**"],
            // What the SDK prints as a matter of course: each library announcing
            // itself, every project and audio unit created, every undo. Hundreds of
            // lines a run, which would bury a warning that matters.
            onConsoleLog: log => (SDK_ROUTINE.some(line => line.test(log.trim())) ? false : undefined)
        }
    }))
)
