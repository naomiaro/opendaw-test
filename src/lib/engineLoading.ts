import type { Project } from "@opendaw/studio-core";

const DEFAULT_LOADING_TIMEOUT_MS = 10_000;

/**
 * Wait until the engine reports all audio loaded, polling
 * queryLoadingComplete() per animation frame. Rejects after `timeoutMs`,
 * or immediately with the real error if a poll rejects.
 *
 * Do NOT use this to detect recording data availability —
 * queryLoadingComplete() resolves before sampleLoader.data is set.
 */
export async function waitForLoadingComplete(
  project: Project,
  timeoutMs: number = DEFAULT_LOADING_TIMEOUT_MS
): Promise<void> {
  if (await project.engine.queryLoadingComplete()) return;
  await new Promise<void>((resolve, reject) => {
    // Once settled (timeout, poll rejection, or completion), the rAF loop
    // must stop re-scheduling — otherwise it keeps polling forever.
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error("Audio loading timed out"));
    }, timeoutMs);
    const checkLoaded = async () => {
      if (settled) return;
      try {
        if (await project.engine.queryLoadingComplete()) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        } else if (!settled) {
          requestAnimationFrame(checkLoaded);
        }
      } catch (error) {
        // Reject with the real failure now, not the generic timeout later
        settled = true;
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    checkLoaded();
  });
}
