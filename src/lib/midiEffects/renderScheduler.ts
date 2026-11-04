export type SchedulerStatus = "idle" | "stale" | "rendering"

export type RenderSchedulerOptions = {
    settleMs: number
    onStatus: (status: SchedulerStatus) => void
    onError: (message: string) => void
}

export class RenderScheduler {
    readonly #run: () => Promise<void>
    readonly #options: RenderSchedulerOptions
    #timer: ReturnType<typeof setTimeout> | null = null
    #running = false
    #pending = false
    #disposed = false
    #status: SchedulerStatus = "idle"

    constructor(run: () => Promise<void>, options: RenderSchedulerOptions) {
        this.#run = run
        this.#options = options
    }

    request(): void {
        if (this.#disposed) {return}
        if (this.#running) {
            this.#pending = true
            return
        }
        this.#setStatus("stale")
        this.#startTimer()
    }

    dispose(): void {
        this.#disposed = true
        this.#clearTimer()
    }

    #setStatus(status: SchedulerStatus): void {
        if (this.#status === status) {return}
        this.#status = status
        this.#options.onStatus(status)
    }

    #clearTimer(): void {
        if (this.#timer === null) {return}
        clearTimeout(this.#timer)
        this.#timer = null
    }

    #startTimer(): void {
        this.#clearTimer()
        this.#timer = setTimeout(() => {
            this.#timer = null
            void this.#execute()
        }, this.#options.settleMs)
    }

    async #execute(): Promise<void> {
        this.#running = true
        this.#setStatus("rendering")
        try {
            await this.#run()
        } catch (error) {
            if (!this.#disposed) {
                this.#options.onError(error instanceof Error ? error.message : String(error))
            }
        }
        this.#running = false
        if (this.#disposed) {return}
        if (this.#pending) {
            this.#pending = false
            this.#setStatus("stale")
            this.#startTimer()
        } else {
            this.#setStatus("idle")
        }
    }
}
