/**
 * Race a promise against a hard deadline. SDK offline-render waits
 * (`OfflineEngineRenderer.play/waitForLoading`, worker `step`) poll or await
 * with no ceiling of their own — a broken worker would otherwise hang the
 * caller forever with no error surfaced.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
