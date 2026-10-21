/**
 * A tick from a dedicated worker: `setInterval` on a worker thread is not throttled when the
 * document is hidden, and its messages reach the main thread as soon as it is free. The
 * hidden-safe frame driver pumps the SDK's frame subscribers from it while the page is hidden.
 */
export interface WorkerTicker {
  subscribe(fn: () => void): { terminate(): void };
  terminate(): void;
}

/** A worker that fails to start (a CSP `worker-src` block arrives as an `error` event, not a
 *  throw) would leave every subscriber waiting on a tick that never comes; the failure is reported. */
export function createWorkerTicker(
  intervalMs: number,
  onError: (message: string) => void = (message) => console.warn(`[workerTicker] the tick worker failed, nothing will tick: ${message}`),
): WorkerTicker {
  const subscribers = new Set<() => void>();
  let worker: Worker | null = null;
  let url: string | null = null;
  const ensure = (): void => {
    if (worker !== null) return;
    const src = `setInterval(() => postMessage(0), ${Math.max(1, Math.round(intervalMs))})`;
    url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = (): void => { for (const fn of [...subscribers]) fn(); };
    worker.onerror = (event): void => { onError(event.message || "error event without a message"); };
  };
  return {
    subscribe(fn) {
      subscribers.add(fn);
      ensure();
      return { terminate: (): void => { subscribers.delete(fn); } };
    },
    terminate() {
      subscribers.clear();
      worker?.terminate();
      worker = null;
      if (url !== null) URL.revokeObjectURL(url);
      url = null;
    },
  };
}
