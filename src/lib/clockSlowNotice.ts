/**
 * The notice `installFreezeClockCheck` raises: a bar fixed to the top of the page, in plain DOM
 * so it works on every demo whatever its React tree. It says what happened and offers a reload;
 * it never reloads by itself. Colours are the console theme's tokens, with their values as
 * fallbacks for pages that do not load the theme.
 */

export const CLOCK_SLOW_NOTICE_ID = "clock-slow-notice";

export function clockSlowMessage(ratio: number): string {
  return (
    `Chrome slowed this page's audio after the tab was frozen in the background: it is running at ` +
    `${Math.round(ratio * 100)}% speed, lower and distorted. Reload the page to fix it.`
  );
}

/** Show the notice (once: a second call updates the one already shown) and log the reading. */
export function showClockSlowNotice(doc: Document, ratio: number, reload: () => void): HTMLElement {
  console.warn(`[freeze-clock-check] the audio clock runs at ${ratio.toFixed(3)} of real time after a resume (Chromium 575891839)`);
  const existing = doc.getElementById(CLOCK_SLOW_NOTICE_ID);
  if (existing !== null) {
    const text = existing.querySelector("[data-role=message]");
    if (text !== null) text.textContent = clockSlowMessage(ratio);
    return existing;
  }
  const bar = doc.createElement("div");
  bar.id = CLOCK_SLOW_NOTICE_ID;
  bar.setAttribute("role", "alert");
  Object.assign(bar.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    zIndex: "10000",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
    padding: "10px 16px",
    background: "var(--mc-panel, #151310)",
    color: "var(--mc-text, #d8d2c8)",
    borderBottom: "2px solid var(--mc-amber, #e8a33d)",
    font: "14px/1.4 var(--mc-mono, ui-monospace, Menlo, monospace)",
  });
  const text = doc.createElement("span");
  text.dataset.role = "message";
  text.style.flex = "1 1 280px";
  text.textContent = clockSlowMessage(ratio);
  const button = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const element = doc.createElement("button");
    element.type = "button";
    element.textContent = label;
    Object.assign(element.style, {
      padding: "6px 14px",
      cursor: "pointer",
      font: "inherit",
      color: primary ? "var(--mc-bg, #0d0c0a)" : "var(--mc-text, #d8d2c8)",
      background: primary ? "var(--mc-amber, #e8a33d)" : "transparent",
      border: "1px solid var(--mc-amber, #e8a33d)",
      borderRadius: "4px",
    });
    element.addEventListener("click", onClick);
    return element;
  };
  bar.append(text, button("Reload", true, reload), button("Dismiss", false, () => bar.remove()));
  doc.body.append(bar);
  return bar;
}
