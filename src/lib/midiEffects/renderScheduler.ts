const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type SchedulerStatus = "idle" | "stale" | "rendering";

export type RenderSchedulerOptions = {
  settleMs: number;
  onStatus: (status: SchedulerStatus) => void;
  onError: (message: string) => void;
};

export class RenderScheduler {
  readonly #run: () => Promise<void>;
  readonly #options: RenderSchedulerOptions;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #pending = false;
  #disposed = false;
  #status: SchedulerStatus = "idle";

  constructor(run: () => Promise<void>, options: RenderSchedulerOptions) {
    this.#run = run;
    this.#options = options;
  }

  request(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#running) {
      this.#pending = true;
      return;
    }
    this.#setStatus("stale");
    this.#startTimer();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimer();
  }

  #setStatus(status: SchedulerStatus): void {
    if (this.#status === status) {
      return;
    }
    this.#status = status;
    try {
      this.#options.onStatus(status);
    } catch (error) {
      console.error("[render-scheduler] onStatus threw: " + messageOf(error));
    }
  }

  #report(error: unknown): void {
    if (this.#disposed) {
      return;
    }
    try {
      this.#options.onError(messageOf(error));
    } catch (callbackError) {
      console.error("[render-scheduler] onError threw: " + messageOf(callbackError));
    }
  }

  #clearTimer(): void {
    if (this.#timer === null) {
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #startTimer(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#execute();
    }, this.#options.settleMs);
  }

  async #execute(): Promise<void> {
    this.#running = true;
    try {
      this.#setStatus("rendering");
      await this.#run();
    } catch (error) {
      this.#report(error);
    } finally {
      // a throw anywhere above must never leave the scheduler running for the life of the page
      this.#running = false;
    }
    if (this.#disposed) {
      return;
    }
    if (this.#pending) {
      this.#pending = false;
      this.#setStatus("stale");
      this.#startTimer();
    } else {
      this.#setStatus("idle");
    }
  }
}
