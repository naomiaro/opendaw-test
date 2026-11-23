/**
 * The demos' answer to the SDK's questions. The SDK asks an app through `RuntimeNotifier` (`approve`, `info`,
 * `notify`, `progress`), and with nothing installed `approve` resolves yes: a recording that could not be stored is
 * then offered as a download nobody was asked about, again and again for as long as the save is refused
 * (debug/2026-11-23-unstored-recording-download-loop/note.md). `initializeOpenDAW` installs this notifier, so every
 * `approve` is a real question a person answers.
 *
 * Plain DOM, so it works on every demo whatever its React tree. Colours are the console theme's tokens, with their
 * values as fallbacks for pages that do not load the theme.
 *
 * - `approve`: a bar with the question and two buttons. It resolves when one is clicked, and `false` if the
 *   request's `abortSignal` fires first. Clicking the approving button is a user gesture, which a save picker needs.
 * - `info`: the same bar with one button. It resolves AT ONCE, as it did with nothing installed, so no SDK flow that
 *   awaits it starts waiting for a click; the bar stays until dismissed.
 * - `notify`: a line that goes away by itself, and a console line.
 * - `progress`: a console line; the demos start none of the SDK's own long tasks.
 */
import { RuntimeNotifier, type RuntimeNotification } from "@opendaw/lib-std";

export const SDK_NOTICES_ID = "sdk-notices";
/** How long a `notify` line stays. */
export const NOTIFY_MS = 6000;

type ButtonSpec = { label: string; primary: boolean; onClick: () => void };

function container(doc: Document): HTMLElement {
  const existing = doc.getElementById(SDK_NOTICES_ID);
  if (existing !== null) return existing;
  const stack = doc.createElement("div");
  stack.id = SDK_NOTICES_ID;
  Object.assign(stack.style, {
    position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "10000", display: "flex", flexDirection: "column",
    font: "14px/1.4 var(--mc-mono, ui-monospace, Menlo, monospace)",
  });
  (doc.body ?? doc.documentElement).append(stack);
  return stack;
}

function bar(doc: Document, role: "alertdialog" | "status", headline: string | undefined, message: string, buttons: readonly ButtonSpec[]): HTMLElement {
  const element = doc.createElement("div");
  element.setAttribute("role", role);
  Object.assign(element.style, {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "10px 16px",
    background: "var(--mc-panel, #151310)", color: "var(--mc-text, #d8d2c8)", borderTop: "2px solid var(--mc-amber, #e8a33d)",
  });
  const text = doc.createElement("span");
  text.dataset.role = "message";
  text.style.flex = "1 1 280px";
  if (headline !== undefined && headline.length > 0) {
    const strong = doc.createElement("strong");
    strong.textContent = `${headline}. `;
    text.append(strong);
  }
  text.append(doc.createTextNode(message));
  element.append(text);
  for (const { label, primary, onClick } of buttons) {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, {
      padding: "6px 14px", cursor: "pointer", font: "inherit", borderRadius: "4px", border: "1px solid var(--mc-amber, #e8a33d)",
      color: primary ? "var(--mc-bg, #0d0c0a)" : "var(--mc-text, #d8d2c8)", background: primary ? "var(--mc-amber, #e8a33d)" : "transparent",
    });
    button.addEventListener("click", onClick);
    element.append(button);
  }
  container(doc).append(element);
  return element;
}

/** The notifier itself, on `doc`. Exported for tests; a page gets it through `installRuntimeNotifier`. */
export function createDomNotifier(doc: Document): RuntimeNotification.Notifier {
  return {
    approve: ({ headline, message, approveText, cancelText, abortSignal }) =>
      new Promise<boolean>((resolve) => {
        if (abortSignal?.aborted === true) {
          resolve(false);
          return;
        }
        const answer = (value: boolean): void => {
          abortSignal?.removeEventListener("abort", onAbort);
          element.remove();
          resolve(value);
        };
        const onAbort = (): void => answer(false);
        const element = bar(doc, "alertdialog", headline, message, [
          { label: approveText ?? "OK", primary: true, onClick: () => answer(true) },
          { label: cancelText ?? "Cancel", primary: false, onClick: () => answer(false) },
        ]);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
      }),
    info: ({ headline, message, okText }) => {
      const element = bar(doc, "alertdialog", headline, message, [{ label: okText ?? "OK", primary: true, onClick: () => element.remove() }]);
      return Promise.resolve();
    },
    notify: ({ message }) => {
      console.info(`[openDAW] ${message}`);
      const element = bar(doc, "status", undefined, message, []);
      setTimeout(() => element.remove(), NOTIFY_MS);
    },
    progress: ({ headline, message }) => {
      console.debug(`[openDAW] ${headline}${message === undefined ? "" : `: ${message}`}`);
      return { set message(value: string) { console.debug(`[openDAW] ${headline}: ${value}`); }, terminate: () => {} };
    },
  };
}

// On `window`, not in the module: a hot reload evaluates this module again, and the SDK asserts on a second install.
const INSTALLED_FLAG = "__opendawDemosNotifierInstalled";

/** Installs the notifier once per page. Returns whether this call installed it. */
export function installRuntimeNotifier(win: Window): boolean {
  const flags = win as unknown as Record<string, unknown>;
  if (flags[INSTALLED_FLAG] === true) return false;
  RuntimeNotifier.install(createDomNotifier(win.document));
  flags[INSTALLED_FLAG] = true;
  return true;
}
