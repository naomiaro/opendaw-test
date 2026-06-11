// Governing decision: docs/design/2026-06-11-mastering-console-editorial.md
// Usage: pages add <style>{CONSOLE_STYLES}</style> inside their Radix Theme.

export const CONSOLE_STYLES = `
:root {
  --mc-bg: #0d0c0a;
  --mc-panel: #151310;
  --mc-panel-hover: #1a1713;
  --mc-line: #2a2620;
  --mc-line-bright: #3d3729;
  --mc-text: #d8d2c8;
  --mc-muted: #948c7d;
  /* label: smallest readable text (4.9:1 on panel); faint: decorative strokes only */
  --mc-label: #8b8273;
  --mc-faint: #5f594e;
  /* shade: alternating region fill on data canvases (panel is too close to bg) */
  --mc-shade: #221d15;
  --mc-amber: #e8a33d;
  --mc-cyan: #5fb4c9;
  --mc-green: #7fbf6a;
  --mc-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
body { background: var(--mc-bg); }
.mc-root { color: var(--mc-text); }
.mc-kicker {
  font-family: var(--mc-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--mc-amber);
  text-transform: uppercase;
}
.mc-title {
  font-family: var(--mc-mono);
  font-weight: 600;
  font-size: clamp(40px, 7vw, 72px);
  line-height: 0.95;
  letter-spacing: -0.02em;
  margin: 10px 0 0;
  color: var(--mc-text);
}
.mc-title .mc-q { color: var(--mc-amber); }
.mc-intro {
  max-width: 62ch;
  font-size: 15px;
  line-height: 1.65;
  color: var(--mc-muted);
  margin: 18px 0 0;
}
.mc-intro code {
  font-family: var(--mc-mono);
  font-size: 0.88em;
  color: var(--mc-text);
  background: var(--mc-panel);
  border: 1px solid var(--mc-line);
  border-radius: 3px;
  padding: 0.08em 0.35em;
}
.mc-intro strong { color: var(--mc-text); font-weight: 600; }

.mc-lattice-frame {
  margin-top: 34px;
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  padding: 14px 16px 12px;
  background:
    repeating-linear-gradient(90deg, transparent 0 49px, rgba(255,255,255,0.018) 49px 50px),
    var(--mc-panel);
}
.mc-lattice {
  display: block;
  width: 100%;
  height: auto;
}
.mc-lattice-label {
  font-family: var(--mc-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
@keyframes mc-sweep {
  from { transform: translateX(0); }
  to { transform: translateX(748px); }
}
.mc-playhead {
  animation: mc-sweep 16s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .mc-playhead { animation: none; visibility: hidden; }
  .mc-reveal { animation: none !important; opacity: 1 !important; }
}

.mc-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--mc-line);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 56px;
}
@media (max-width: 880px) {
  .mc-grid { grid-template-columns: 1fr; }
}
.mc-panel {
  background: var(--mc-panel);
  padding: 26px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
  transition: background 160ms ease;
}
.mc-panel:hover { background: var(--mc-panel-hover); }
.mc-panel-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.mc-chip {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  align-self: center;
  flex: none;
}
.mc-index {
  font-family: var(--mc-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--mc-label);
}
.mc-name {
  font-family: var(--mc-mono);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--mc-text);
  margin: 0;
}
.mc-direction {
  font-family: var(--mc-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--mc-muted);
  margin-top: 10px;
}
.mc-rows {
  margin-top: 18px;
  border-top: 1px solid var(--mc-line);
}
.mc-row {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--mc-line);
  font-size: 12.5px;
  line-height: 1.5;
}
.mc-row dt {
  font-family: var(--mc-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--mc-label);
  padding-top: 2px;
}
.mc-row dd { margin: 0; color: var(--mc-muted); }
.mc-row dd em { color: var(--mc-text); font-style: italic; }
.mc-prose {
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--mc-muted);
  margin: 16px 0 0;
  flex: 1;
}
.mc-open {
  font-family: var(--mc-mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--mc-text);
  border: 1px solid var(--mc-line-bright);
  border-radius: 3px;
  padding: 9px 14px;
  margin-top: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  transition: border-color 160ms ease, color 160ms ease;
}
.mc-open .mc-arrow { transition: transform 160ms ease; }
.mc-open:hover { border-color: var(--mc-amber); color: var(--mc-amber); }
.mc-open:hover .mc-arrow { transform: translateX(3px); }
.mc-open:focus-visible,
.mc-anchors a:focus-visible {
  outline: 2px solid var(--mc-amber);
  outline-offset: 2px;
  border-radius: 3px;
}

.mc-anchors {
  margin-top: 56px;
  border: 1px solid var(--mc-line);
  border-left: 2px solid var(--mc-amber);
  border-radius: 4px;
  background: var(--mc-panel);
  padding: 24px 26px;
}
.mc-anchors-head {
  font-family: var(--mc-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mc-amber);
  margin: 0;
}
.mc-anchors p {
  max-width: 72ch;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--mc-muted);
  margin: 12px 0 0;
}
.mc-anchors code {
  font-family: var(--mc-mono);
  font-size: 0.88em;
  color: var(--mc-text);
  background: var(--mc-bg);
  border: 1px solid var(--mc-line);
  border-radius: 3px;
  padding: 0.08em 0.35em;
}
.mc-anchors a { color: var(--mc-amber); text-decoration: none; border-bottom: 1px solid transparent; }
.mc-anchors a:hover { border-bottom-color: var(--mc-amber); }

/* Two-up definition panels (engraved-strip look) inside an .mc-anchors section.
   Inner panels use --mc-bg (darker than the section's --mc-panel) so the 1px
   --mc-line gaps stay visible. */
.mc-markers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--mc-line);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 16px;
}
@media (max-width: 880px) {
  .mc-markers { grid-template-columns: 1fr; }
}
.mc-marker-panel {
  background: var(--mc-bg);
  padding: 18px 20px 16px;
  min-width: 0; /* grid item: min-width:auto would let long unbreakable content (code tokens) widen the 1fr track past the container */
}
.mc-marker-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
}
.mc-marker-glyph { flex: none; display: block; }
.mc-marker-name {
  font-family: var(--mc-mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mc-text);
  margin: 0;
}
.mc-marker-box {
  font-family: var(--mc-mono);
  font-size: 10px;
  color: var(--mc-label);
  margin-left: auto;
}

@keyframes mc-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.mc-reveal {
  opacity: 0;
  animation: mc-rise 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
`;
