// src/demos/warp/warp-overview.tsx
// Static overview page — no audio, no engine imports, no hooks.
// Aesthetic: mastering-console editorial — warm near-black, single amber accent,
// mono display type, DAW-style scenario color chips, and a warp-lattice header
// graphic that draws the page's whole argument (wobbly file beats pinned to an
// even grid) as data.
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container } from "@radix-ui/themes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";

// Wobbly file-beat positions (px along an 800px rail) — irregular spacings in
// the spirit of real tracker output (the player rushes, drags, rushes again);
// the even grid above is the same count, so every connector visibly bends.
const FILE_BEATS = [
  10, 48, 84, 128, 186, 248, 308, 360, 404, 442, 484, 538, 600, 660, 714, 758,
];
const GRID_STEP = (758 - 10) / (FILE_BEATS.length - 1);

const SCENARIOS = [
  {
    index: "01",
    chip: "var(--wo-amber)",
    name: "Varispeed",
    direction: "FILE → GRID",
    hear: "Beats lock, pitch shifts with tempo",
    daws: ["Ableton Re-Pitch"],
    href: "/warp-varispeed-demo.html",
    prose:
      "DJs and producers working in a tape or vinyl aesthetic reach for this. The pitch shift is a feature, not a flaw — the record speeds up and sharpens, just as it would on a turntable. It is also the only artifact-free conform: no stretch DSP runs at all, only a read-rate change, so there is nothing to smear or double.",
  },
  {
    index: "02",
    chip: "var(--wo-cyan)",
    name: "Grid follows file",
    direction: "GRID → FILE",
    hear: "Audio untouched, metronome and ruler bend",
    daws: ["Ableton Set tempo from clip", "Logic Smart Tempo ADAPT"],
    href: "/warp-grid-follows-file-demo.html",
    prose:
      "Performances recorded without a click — a live drummer, an archival multitrack, a field recording — arrive with a beat map that no rigid tempo can follow. Rather than mangle the audio, this mode treats the music as sacred and bends the grid. After the conform, MIDI, quantize, and the metronome follow the player.",
  },
  {
    index: "03",
    chip: "var(--wo-green)",
    name: "Time-stretch",
    direction: "FILE → GRID, SLICED",
    hear: "Beats lock, key survives",
    daws: ["Ableton Beats/Complex", "Logic Flex Time"],
    href: "/warp-timestretch-demo.html",
    prose:
      "Remixing and beatmatching where the key must survive: acapellas dropped over new beats, sample-pack loops brought to project tempo, stem imports from a different session. The algorithm slices the file at transient boundaries and stretches each slice independently, locking beats to the grid while the pitch stays fixed. This is the modern DAW default.",
  },
] as const;

const STYLES = `
:root {
  --wo-bg: #0d0c0a;
  --wo-panel: #151310;
  --wo-panel-hover: #1a1713;
  --wo-line: #2a2620;
  --wo-line-bright: #3d3729;
  --wo-text: #d8d2c8;
  --wo-muted: #948c7d;
  /* label: smallest readable text (4.9:1 on panel); faint: decorative strokes only */
  --wo-label: #8b8273;
  --wo-faint: #5f594e;
  --wo-amber: #e8a33d;
  --wo-cyan: #5fb4c9;
  --wo-green: #7fbf6a;
  --wo-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
body { background: var(--wo-bg); }
.wo-root { color: var(--wo-text); }
.wo-kicker {
  font-family: var(--wo-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--wo-amber);
  text-transform: uppercase;
}
.wo-title {
  font-family: var(--wo-mono);
  font-weight: 600;
  font-size: clamp(40px, 7vw, 72px);
  line-height: 0.95;
  letter-spacing: -0.02em;
  margin: 10px 0 0;
  color: var(--wo-text);
}
.wo-title .wo-q { color: var(--wo-amber); }
.wo-intro {
  max-width: 62ch;
  font-size: 15px;
  line-height: 1.65;
  color: var(--wo-muted);
  margin: 18px 0 0;
}
.wo-intro code {
  font-family: var(--wo-mono);
  font-size: 0.88em;
  color: var(--wo-text);
  background: var(--wo-panel);
  border: 1px solid var(--wo-line);
  border-radius: 3px;
  padding: 0.08em 0.35em;
}
.wo-intro strong { color: var(--wo-text); font-weight: 600; }

.wo-lattice-frame {
  margin-top: 34px;
  border: 1px solid var(--wo-line);
  border-radius: 4px;
  padding: 14px 16px 12px;
  background:
    repeating-linear-gradient(90deg, transparent 0 49px, rgba(255,255,255,0.018) 49px 50px),
    var(--wo-panel);
}
.wo-lattice {
  display: block;
  width: 100%;
  height: auto;
}
.wo-lattice-label {
  font-family: var(--wo-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
@keyframes wo-sweep {
  from { transform: translateX(0); }
  to { transform: translateX(748px); }
}
.wo-playhead {
  animation: wo-sweep 16s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .wo-playhead { animation: none; visibility: hidden; }
  .wo-reveal { animation: none !important; opacity: 1 !important; }
}

.wo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--wo-line);
  border: 1px solid var(--wo-line);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 56px;
}
@media (max-width: 880px) {
  .wo-grid { grid-template-columns: 1fr; }
}
.wo-panel {
  background: var(--wo-panel);
  padding: 26px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
  transition: background 160ms ease;
}
.wo-panel:hover { background: var(--wo-panel-hover); }
.wo-panel-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.wo-chip {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  align-self: center;
  flex: none;
}
.wo-index {
  font-family: var(--wo-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--wo-label);
}
.wo-name {
  font-family: var(--wo-mono);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--wo-text);
  margin: 0;
}
.wo-direction {
  font-family: var(--wo-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--wo-muted);
  margin-top: 10px;
}
.wo-rows {
  margin-top: 18px;
  border-top: 1px solid var(--wo-line);
}
.wo-row {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--wo-line);
  font-size: 12.5px;
  line-height: 1.5;
}
.wo-row dt {
  font-family: var(--wo-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--wo-label);
  padding-top: 2px;
}
.wo-row dd { margin: 0; color: var(--wo-muted); }
.wo-row dd em { color: var(--wo-text); font-style: italic; }
.wo-prose {
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--wo-muted);
  margin: 16px 0 0;
  flex: 1;
}
.wo-open {
  font-family: var(--wo-mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--wo-text);
  border: 1px solid var(--wo-line-bright);
  border-radius: 3px;
  padding: 9px 14px;
  margin-top: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  transition: border-color 160ms ease, color 160ms ease;
}
.wo-open .wo-arrow { transition: transform 160ms ease; }
.wo-open:hover { border-color: var(--wo-amber); color: var(--wo-amber); }
.wo-open:hover .wo-arrow { transform: translateX(3px); }
.wo-open:focus-visible,
.wo-anchors a:focus-visible {
  outline: 2px solid var(--wo-amber);
  outline-offset: 2px;
  border-radius: 3px;
}

.wo-anchors {
  margin-top: 56px;
  border: 1px solid var(--wo-line);
  border-left: 2px solid var(--wo-amber);
  border-radius: 4px;
  background: var(--wo-panel);
  padding: 24px 26px;
}
.wo-anchors-head {
  font-family: var(--wo-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--wo-amber);
  margin: 0;
}
.wo-anchors p {
  max-width: 72ch;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--wo-muted);
  margin: 12px 0 0;
}
.wo-anchors code {
  font-family: var(--wo-mono);
  font-size: 0.88em;
  color: var(--wo-text);
  background: var(--wo-bg);
  border: 1px solid var(--wo-line);
  border-radius: 3px;
  padding: 0.08em 0.35em;
}
.wo-anchors a { color: var(--wo-amber); text-decoration: none; border-bottom: 1px solid transparent; }
.wo-anchors a:hover { border-bottom-color: var(--wo-amber); }

@keyframes wo-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.wo-reveal {
  opacity: 0;
  animation: wo-rise 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
`;

function Lattice() {
  return (
    <div className="wo-lattice-frame">
      <div className="wo-lattice-label" style={{ color: "var(--wo-cyan)" }}>
        Project grid &mdash; 123 BPM
      </div>
      <svg
        className="wo-lattice"
        viewBox="0 0 800 84"
        role="img"
        aria-label="Diagram: evenly spaced project-grid beats above, irregular audio-file beats below, with warp pins connecting each pair"
      >
        <line x1="0" y1="18" x2="800" y2="18" stroke="var(--wo-line-bright)" strokeWidth="1" />
        <line x1="0" y1="66" x2="800" y2="66" stroke="var(--wo-line-bright)" strokeWidth="1" />
        {FILE_BEATS.map((fileX, n) => {
          const gridX = 10 + n * GRID_STEP;
          return (
            <g key={n}>
              <path
                d={`M ${gridX} 22 C ${gridX} 42, ${fileX} 44, ${fileX} 62`}
                stroke="var(--wo-faint)"
                strokeWidth="1"
                fill="none"
              />
              <line x1={gridX} y1={12} x2={gridX} y2={24} stroke="var(--wo-cyan)" strokeWidth="2" />
              <line x1={fileX} y1={60} x2={fileX} y2={72} stroke="var(--wo-amber)" strokeWidth="2" />
            </g>
          );
        })}
        <g className="wo-playhead">
          <rect x="9" y="8" width="1.5" height="68" fill="var(--wo-amber)" opacity="0.5" />
        </g>
      </svg>
      <div className="wo-lattice-label" style={{ color: "var(--wo-amber)" }}>
        Audio file &mdash; tracked beats
      </div>
    </div>
  );
}

function WarpOverview() {
  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--wo-bg)" }}>
      <style>{STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <main className="wo-root">
          <header className="wo-reveal" style={{ marginTop: 28 }}>
            <div className="wo-kicker">Beat Maps &amp; Warping &mdash; OpenDAW SDK</div>
            <h1 className="wo-title">
              WHO BENDS<span className="wo-q">?</span>
            </h1>
            <p className="wo-intro">
              A beat tracker &mdash; or sidecar metadata in an ACID chunk, an Apple
              Loops header, or an Ableton <code>.asd</code> analysis file &mdash; yields
              a list of <code>&#123;second, beat&#125;</code> pins: the time in the file
              where each beat lands. Once that map exists, the file and the project grid
              must be reconciled. Every DAW surfaces exactly three answers:{" "}
              <strong>bend the file</strong>, <strong>bend the grid</strong>, or{" "}
              <strong>slice and stretch</strong>.
            </p>
          </header>

          <div className="wo-reveal" style={{ animationDelay: "120ms" }}>
            <Lattice />
          </div>

          <section className="wo-grid wo-reveal" style={{ animationDelay: "240ms" }}>
            {SCENARIOS.map((s) => (
              <article className="wo-panel" key={s.index}>
                <div className="wo-panel-head">
                  <span className="wo-chip" style={{ background: s.chip }} />
                  <span className="wo-index">{s.index}</span>
                  <h2 className="wo-name">{s.name}</h2>
                </div>
                <div className="wo-direction">{s.direction}</div>
                <dl className="wo-rows">
                  <div className="wo-row">
                    <dt>HEAR</dt>
                    <dd>{s.hear}</dd>
                  </div>
                  <div className="wo-row">
                    <dt>DAWS</dt>
                    <dd>
                      {s.daws.map((d, i) => (
                        <span key={d}>
                          <em>{d}</em>
                          {i < s.daws.length - 1 ? "; " : ""}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
                <p className="wo-prose">{s.prose}</p>
                <a className="wo-open" href={s.href}>
                  Open demo <span className="wo-arrow">&rarr;</span>
                </a>
              </article>
            ))}
          </section>

          <section className="wo-anchors wo-reveal" style={{ animationDelay: "360ms" }}>
            <h2 className="wo-anchors-head">Engine-agnostic anchors</h2>
            <p>
              The warp-marker list is identical for varispeed and time-stretch. The same{" "}
              <code>&#123;tick, second&#125;</code> pins (the beat map&apos;s{" "}
              <code>&#123;second, beat&#125;</code> rows mapped onto grid ticks) drive an{" "}
              <code>AudioPitchStretchBox</code> and an <code>AudioTimeStretchBox</code>{" "}
              without modification. This is why Ableton lets you switch a clip&apos;s
              warp mode without touching its markers &mdash; the anchors describe the
              beat map, not the stretch algorithm. The{" "}
              <a href="/warp-timestretch-demo.html">time-stretch demo</a> makes the A/B
              audible with raw, varispeed, and time-stretch all available on one page.
            </p>
          </section>

          <MoisesLogo />
        </main>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpOverview />);
