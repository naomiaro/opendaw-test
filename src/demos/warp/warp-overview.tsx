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
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

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
    chip: "var(--mc-amber)",
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
    chip: "var(--mc-cyan)",
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
    chip: "var(--mc-green)",
    name: "Time-stretch",
    direction: "FILE → GRID, SLICED",
    hear: "Beats lock, key survives",
    daws: ["Ableton Beats/Complex", "Logic Flex Time"],
    href: "/warp-timestretch-demo.html",
    prose:
      "Remixing and beatmatching where the key must survive: acapellas dropped over new beats, sample-pack loops brought to project tempo, stem imports from a different session. The algorithm slices the file at transient boundaries and stretches each slice independently, locking beats to the grid while the pitch stays fixed. This is the modern DAW default.",
  },
] as const;


function Lattice() {
  return (
    <div className="mc-lattice-frame">
      <div className="mc-lattice-label" style={{ color: "var(--mc-cyan)" }}>
        Project grid &mdash; 123 BPM
      </div>
      <svg
        className="mc-lattice"
        viewBox="0 0 800 84"
        role="img"
        aria-label="Diagram: evenly spaced project-grid beats above, irregular audio-file beats below, with warp pins connecting each pair"
      >
        <line x1="0" y1="18" x2="800" y2="18" stroke="var(--mc-line-bright)" strokeWidth="1" />
        <line x1="0" y1="66" x2="800" y2="66" stroke="var(--mc-line-bright)" strokeWidth="1" />
        {FILE_BEATS.map((fileX, n) => {
          const gridX = 10 + n * GRID_STEP;
          return (
            <g key={n}>
              <path
                d={`M ${gridX} 22 C ${gridX} 42, ${fileX} 44, ${fileX} 62`}
                stroke="var(--mc-faint)"
                strokeWidth="1"
                fill="none"
              />
              <line x1={gridX} y1={12} x2={gridX} y2={24} stroke="var(--mc-cyan)" strokeWidth="2" />
              <line x1={fileX} y1={60} x2={fileX} y2={72} stroke="var(--mc-amber)" strokeWidth="2" />
            </g>
          );
        })}
        <g className="mc-playhead">
          <rect x="9" y="8" width="1.5" height="68" fill="var(--mc-amber)" opacity="0.5" />
        </g>
      </svg>
      <div className="mc-lattice-label" style={{ color: "var(--mc-amber)" }}>
        Audio file &mdash; tracked beats
      </div>
    </div>
  );
}

function WarpOverview() {
  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <main className="mc-root">
          <header className="mc-reveal" style={{ marginTop: 28 }}>
            <div className="mc-kicker">Beat Maps &amp; Warping &mdash; OpenDAW SDK</div>
            <h1 className="mc-title">
              WHO BENDS<span className="mc-q">?</span>
            </h1>
            <p className="mc-intro">
              A beat tracker &mdash; or sidecar metadata in an ACID chunk, an Apple
              Loops header, or an Ableton <code>.asd</code> analysis file &mdash; yields
              a list of <code>&#123;second, beat&#125;</code> pins: the time in the file
              where each beat lands. Once that map exists, the file and the project grid
              must be reconciled. Every DAW surfaces exactly three answers:{" "}
              <strong>bend the file</strong>, <strong>bend the grid</strong>, or{" "}
              <strong>slice and stretch</strong>.
            </p>
          </header>

          <div className="mc-reveal" style={{ animationDelay: "120ms" }}>
            <Lattice />
          </div>

          <section className="mc-grid mc-reveal" style={{ animationDelay: "240ms" }}>
            {SCENARIOS.map((s) => (
              <article className="mc-panel" key={s.index}>
                <div className="mc-panel-head">
                  <span className="mc-chip" style={{ background: s.chip }} />
                  <span className="mc-index">{s.index}</span>
                  <h2 className="mc-name">{s.name}</h2>
                </div>
                <div className="mc-direction">{s.direction}</div>
                <dl className="mc-rows">
                  <div className="mc-row">
                    <dt>HEAR</dt>
                    <dd>{s.hear}</dd>
                  </div>
                  <div className="mc-row">
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
                <p className="mc-prose">{s.prose}</p>
                <a className="mc-open" href={s.href}>
                  Open demo <span className="mc-arrow">&rarr;</span>
                </a>
              </article>
            ))}
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "360ms" }}>
            <h2 className="mc-anchors-head">Engine-agnostic anchors</h2>
            <p>
              The same <code>&#123;tick, second&#125;</code> pins &mdash; the beat
              map&apos;s <code>&#123;second, beat&#125;</code> rows mapped onto grid
              ticks &mdash; drive an <code>AudioPitchStretchBox</code> and an{" "}
              <code>AudioTimeStretchBox</code> without modification. That is why
              Ableton can switch a clip&apos;s warp mode without touching its markers:
              the anchors describe the beat map, not the stretch algorithm. The{" "}
              <a href="/warp-timestretch-demo.html">time-stretch demo</a> makes the A/B
              audible with raw, varispeed, and time-stretch on one page.
            </p>
          </section>

          <section
            id="two-kinds-of-markers"
            className="mc-anchors mc-reveal"
            style={{ animationDelay: "480ms" }}
          >
            <h2 className="mc-anchors-head">Two kinds of markers</h2>
            <p>
              OpenDAW does run its own audio analysis &mdash; but it detects{" "}
              <strong>transients</strong>, never beats. The two marker types are easy
              to conflate and do different jobs: one is acoustic, detected, and owned
              by the file; the other is musical, authored, and owned by the stretch
              box. Only the second ever sees the beat map.
            </p>
            <div className="mc-markers">
              <article className="mc-marker-panel">
                <div className="mc-marker-head">
                  <svg
                    className="mc-marker-glyph"
                    width="56"
                    height="18"
                    viewBox="0 0 56 18"
                    aria-hidden="true"
                  >
                    {[3, 9, 13, 22, 30, 34, 45, 52].map((x) => (
                      <line
                        key={x}
                        x1={x}
                        y1="3"
                        x2={x}
                        y2="15"
                        stroke="var(--mc-amber)"
                        strokeWidth="1.5"
                      />
                    ))}
                  </svg>
                  <h3 className="mc-marker-name">Transient</h3>
                  <span className="mc-marker-box">TransientMarkerBox</span>
                </div>
                <dl className="mc-rows">
                  <div className="mc-row">
                    <dt>WHAT</dt>
                    <dd>
                      Onsets &mdash; physically detectable attacks in the waveform.
                      No musical meaning.
                    </dd>
                  </div>
                  <div className="mc-row">
                    <dt>SOURCE</dt>
                    <dd>
                      Detected by the SDK: <code>Workers.Transients.detect()</code>
                    </dd>
                  </div>
                  <div className="mc-row">
                    <dt>OWNER</dt>
                    <dd>
                      The <code>AudioFileBox</code> &mdash; one set per file
                    </dd>
                  </div>
                  <div className="mc-row">
                    <dt>ROLE</dt>
                    <dd>
                      Splice boundaries for time-stretch. Fewer than two: silence.
                    </dd>
                  </div>
                </dl>
                <p>
                  An onset is acoustic evidence, not interpretation: ghost notes and
                  vocal consonants onset without being beats; a sustained pad may
                  never onset at all. Detection tells the engine where it may cut
                  &mdash; not which attack is beat one of bar twelve.
                </p>
              </article>
              <article className="mc-marker-panel">
                <div className="mc-marker-head">
                  <svg
                    className="mc-marker-glyph"
                    width="56"
                    height="18"
                    viewBox="0 0 56 18"
                    aria-hidden="true"
                  >
                    {[
                      [6, 8],
                      [21, 17],
                      [35, 38],
                      [50, 48],
                    ].map(([gridX, fileX]) => (
                      <g key={gridX}>
                        <path
                          d={`M ${gridX} 4 C ${gridX} 9, ${fileX} 9, ${fileX} 14`}
                          stroke="var(--mc-faint)"
                          strokeWidth="1"
                          fill="none"
                        />
                        <line
                          x1={gridX}
                          y1="1"
                          x2={gridX}
                          y2="5"
                          stroke="var(--mc-cyan)"
                          strokeWidth="1.5"
                        />
                        <line
                          x1={fileX}
                          y1="13"
                          x2={fileX}
                          y2="17"
                          stroke="var(--mc-amber)"
                          strokeWidth="1.5"
                        />
                      </g>
                    ))}
                  </svg>
                  <h3 className="mc-marker-name">Warp</h3>
                  <span className="mc-marker-box">WarpMarkerBox</span>
                </div>
                <dl className="mc-rows">
                  <div className="mc-row">
                    <dt>WHAT</dt>
                    <dd>
                      Musical pins &mdash; <code>&#123;tick, second&#125;</code>{" "}
                      pairs: this file moment <em>is</em> this grid position.
                    </dd>
                  </div>
                  <div className="mc-row">
                    <dt>SOURCE</dt>
                    <dd>
                      Authored from the beat map (or trivial endpoint defaults).
                      The SDK never derives them from audio.
                    </dd>
                  </div>
                  <div className="mc-row">
                    <dt>OWNER</dt>
                    <dd>
                      The stretch box &mdash; <code>AudioPitchStretchBox</code> /{" "}
                      <code>AudioTimeStretchBox</code>
                    </dd>
                  </div>
                  <div className="mc-row">
                    <dt>ROLE</dt>
                    <dd>
                      Linear interpolation between consecutive pins maps playhead
                      tick to file second.
                    </dd>
                  </div>
                </dl>
                <p>
                  Beat tracking supplies the seconds half of every pin; the grid
                  supplies the ticks. These demos derive ~513 pins from a 511-row
                  beat map — one per tracked beat, plus a lead-in and an outro
                  anchor.
                </p>
              </article>
            </div>
            <p>
              The two populations meet in the{" "}
              <a href="/time-pitch-demo.html">time &amp; pitch demo</a>: hundreds of
              detected transients, but only two default warp pins (file start, file
              end). Analysis without a beat map yields places to cut &mdash; not a
              map of where each beat belongs.
            </p>
          </section>

          <MoisesLogo />
        </main>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpOverview />);
