/**
 * The SDK-free pieces of the Nano-based MIDI effect audits' bootstrap (`midiEffectBootstrap.ts`), here so Node tests reach
 * them: the run-voiding error and the wait for a sample loader's terminal state. The loader is typed by its shape, which
 * the SDK's `SampleLoader` (`studio-adapters`) satisfies.
 */
import { withDeadline } from "@/lib/deadline";

/** A failure that voids every later row: the run ends in `error:` instead of continuing. */
export class RunAbort extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunAbort";
  }
}

export interface SampleLoaderStateLike { readonly type: string; readonly reason?: string }

export interface SampleLoaderLike {
  readonly state: SampleLoaderStateLike;
  subscribe(observer: (state: SampleLoaderStateLike) => void): { terminate(): void };
}

/**
 * The loader's terminal state, read first and then awaited (the SDK's loader has `subscribe` only). An error carries the
 * loader's own reason; the deadline rejects. However the wait ends, the subscription is terminated once, after the promise
 * settles: by then its handle exists even when the observer fired inside `subscribe` itself.
 */
export function awaitSampleLoader(loader: SampleLoaderLike, deadlineMs: number): Promise<void> {
  const failed = (state: SampleLoaderStateLike) => new Error(`sample load failed: ${state.reason ?? "no reason given"}`);
  if (loader.state.type === "loaded") return Promise.resolve();
  if (loader.state.type === "error") return Promise.reject(failed(loader.state));
  const held: { sub: { terminate(): void } | null } = { sub: null };
  const waiting = new Promise<void>((resolve, reject) => {
    held.sub = loader.subscribe((state) => {
      if (state.type === "loaded") resolve();
      else if (state.type === "error") reject(failed(state));
    });
  });
  return withDeadline(waiting, deadlineMs, "sample load").finally(() => held.sub?.terminate());
}
