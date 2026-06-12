import type { Project } from "@opendaw/studio-core";

const DEFAULT_LOADING_TIMEOUT_MS = 10_000;

/**
 * Wait until the engine reports all audio loaded, polling
 * queryLoadingComplete() per animation frame. Rejects after `timeoutMs`.
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
    const timeout = setTimeout(
      () => reject(new Error("Audio loading timed out")),
      timeoutMs
    );
    const checkLoaded = async () => {
      if (await project.engine.queryLoadingComplete()) {
        clearTimeout(timeout);
        resolve();
      } else {
        requestAnimationFrame(checkLoaded);
      }
    };
    checkLoaded();
  });
}
