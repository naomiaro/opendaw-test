/**
 * Chrome restores a page from the back/forward cache with its AudioContext still
 * running and the worklet clock at half speed (Chromium 575891839, measured on the
 * looping demo: a position readout advancing 1.50 s per 3.00 s of wall clock). A
 * reload is the one repair that works, so a restored demo reloads itself and the
 * visitor lands on the page as on a first visit.
 *
 * `docs/known-vendor-issues.md`, the Chromium section, has the entry.
 */
import type { Terminable } from "@opendaw/lib-std";

/** The part of a `pageshow` event this guard reads */
interface PageShowLike {
  readonly persisted?: boolean;
}

/**
 * Reload the page when it comes back from the back/forward cache. Returns the
 * listener's handle; a page never needs to terminate it, tests do.
 */
export function installBfcacheReloadGuard(page: EventTarget, reload: () => void): Terminable {
  const onPageShow = (event: Event): void => {
    if ((event as PageShowLike).persisted === true) reload();
  };
  page.addEventListener("pageshow", onPageShow);
  return { terminate: () => page.removeEventListener("pageshow", onPageShow) };
}
