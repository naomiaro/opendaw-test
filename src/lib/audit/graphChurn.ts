/**
 * Graph work on the main thread, for forcing the worklet clock to stand still.
 *
 * Every `connect` and `disconnect` takes the audio graph lock. Chrome moves the worklet
 * scope's `currentFrame` on at the end of a render quantum only if that lock is free, so
 * a main thread that is inside one of these calls at that instant leaves every worklet
 * reading the previous quantum's time for one quantum. The two nodes here are in nobody's
 * path: nothing audible changes.
 */

/** The most pairs one stretch does, so a stretch ends even where `performance.now()` does not advance (fake timers). */
const MAX_PAIRS_PER_STRETCH = 20_000;

/** Whether a page's `?graphChurn=` asks for the churn. Any value but `on` is refused: a
 *  run has to say whether it was forced. */
export function graphChurnFrom(param: string | null): boolean {
  if (param === null) return false;
  if (param !== "on") throw new Error(`invalid ?graphChurn= "${param}" — leave it out, or use graphChurn=on`);
  return true;
}

/**
 * Connect and disconnect two loose gain nodes for `durationMs`, in stretches of
 * `timing.stretchMs` with `timing.gapMs` between. The first stretch runs inside the call.
 * Resolves with the number of connect / disconnect pairs done; rejects when a graph call
 * throws, in whichever stretch.
 */
export function churnGraph(
  audioContext: BaseAudioContext,
  durationMs: number,
  timing: { stretchMs: number; gapMs: number } = { stretchMs: 2, gapMs: 1 }
): Promise<number> {
  if (durationMs <= 0) return Promise.resolve(0);
  const from = audioContext.createGain();
  const to = audioContext.createGain();
  const end = performance.now() + durationMs;
  let pairs = 0;
  return new Promise((resolve, reject) => {
    const stretch = () => {
      if (performance.now() >= end) { resolve(pairs); return; }
      const until = Math.min(end, performance.now() + timing.stretchMs);
      let inStretch = 0;
      try {
        do {
          from.connect(to);
          from.disconnect(to);
          pairs++;
          inStretch++;
        } while (performance.now() < until && inStretch < MAX_PAIRS_PER_STRETCH);
      } catch (error) {
        // A later stretch runs from a timer: without this the promise would never settle.
        reject(error);
        return;
      }
      setTimeout(stretch, timing.gapMs);
    };
    stretch();
  });
}
