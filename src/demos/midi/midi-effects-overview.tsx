// src/demos/midi/midi-effects-overview.tsx
// Static overview page — no audio, no engine imports, no hooks. Built like
// src/demos/warp/warp-overview.tsx: header, one card per sub-demo, prose sections.
// It states the piano-roll conventions a reader brings, and says per sub-demo what
// that page can and cannot show against them.
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container } from "@radix-ui/themes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

// The shared .mc-grid is two columns (sized for the warp overview's four cards);
// three cards would strand an empty cell, so this page lays them out in three.
const GRID_OF_THREE = `
.mc-grid.mc-grid-3 { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 880px) {
  .mc-grid.mc-grid-3 { grid-template-columns: 1fr; }
}
`;

const PAGES = [
  {
    index: "01",
    chip: "var(--mc-amber)",
    name: "MIDI Effects",
    direction: "HEAR IT ON A SYNTH",
    see: "A written lane on the conventions; an emitted lane read from the engine once per frame",
    cannot: "Show emitted velocity, or timing finer than a frame",
    href: "/midi-effects-demo.html",
    prose:
      "Hear Arpeggio, Pitch, Velocity and Zeitgeist on a synth, one at a time or stacked in any order. The written lane follows the conventions. The emitted lane is read from the engine's held notes once per frame: it shows pitch and timing coarsely and cannot show velocity, so it draws every bar one colour.",
  },
  {
    index: "02",
    chip: "var(--mc-cyan)",
    name: "Rendered",
    direction: "SEE IT EXACTLY",
    see: "Every emitted note's onset, end, pitch with cents and velocity, to the sample",
    cannot: "Read overlapping notes: one voice at a time",
    href: "/midi-effects-rendered-demo.html",
    prose:
      "The same chain on a pure sine, rendered offline after each change and read back note by note. The read is exact: velocity, cents and timing. The reader follows one voice at a time, and the pattern's notes are shortened to 90 % of their length so it finds the gap between them.",
  },
  {
    index: "03",
    chip: "var(--mc-violet)",
    name: "Spielwerk",
    direction: "WRITE YOUR OWN",
    see: "Your own device, compiled from JavaScript, and the notes it emits",
    cannot: "Show emitted velocity: its lane is read like the MIDI Effects one",
    href: "/spielwerk-demo.html",
    prose:
      "Write the device yourself in JavaScript: a Processor whose generator receives the block's note events and yields notes to the synth. Start from a pre-built echo, chord, humanize or strum script, compile it, and turn the knobs it declares.",
  },
] as const;

function MidiEffectsOverview() {
  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES + GRID_OF_THREE}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <main className="mc-root">
          <header className="mc-reveal" style={{ marginTop: 28 }}>
            <div className="mc-kicker">MIDI Effects &mdash; OpenDAW SDK</div>
            <h1 className="mc-title">
              WHAT GETS THROUGH<span className="mc-q">?</span>
            </h1>
            <p className="mc-intro">
              A piano roll draws notes as bars on a pitch grid. A bar&apos;s length is the
              note&apos;s duration. A bar&apos;s colour is its velocity: pale when soft,
              saturated when loud. A velocity strip under the roll shows one stem per note,
              and the stem&apos;s height is the velocity. openDAW&apos;s own note editor,
              Ableton, Logic and Cubase all draw notes this way. The three pages here follow
              these conventions where they can, and say where they cannot.
            </p>
          </header>

          <section className="mc-grid mc-grid-3 mc-reveal" style={{ animationDelay: "120ms" }}>
            {PAGES.map((p) => (
              <article className="mc-panel" key={p.index}>
                <div className="mc-panel-head">
                  <span className="mc-chip" style={{ background: p.chip }} />
                  <span className="mc-index">{p.index}</span>
                  <h2 className="mc-name">{p.name}</h2>
                </div>
                <div className="mc-direction">{p.direction}</div>
                <dl className="mc-rows">
                  <div className="mc-row">
                    <dt>SEE</dt>
                    <dd>{p.see}</dd>
                  </div>
                  <div className="mc-row">
                    <dt>CANNOT</dt>
                    <dd>{p.cannot}</dd>
                  </div>
                </dl>
                <p className="mc-prose">{p.prose}</p>
                <a className="mc-open" href={p.href}>
                  Open demo <span className="mc-arrow">&rarr;</span>
                </a>
              </article>
            ))}
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "240ms" }}>
            <h2 className="mc-anchors-head">What the devices do</h2>
            <p>
              A MIDI effect is a pull link: the instrument draws its note events through
              the chain, and each device hands on what it was given, changed. The Arpeggio
              walks the absolute grid, counted from the project start, so where a region
              sits decides which step a note lands on. A velocity of 0 is silence, not a
              quiet note. The Pitch device drops a note it shifts out of the range 0 to 127
              rather than clamping it.
            </p>
            <p>
              Two devices differ from their manuals, and the pages show what the engine
              does. The Arpeggio&apos;s velocity control is{" "}
              <a href="https://github.com/andremichelle/openDAW/issues/524">openDAW#524</a>:
              the manual says &minus;100 % is full velocity, while the engine is silent at
              &minus;100 % and plays the note&apos;s own velocity at 0 %. Zeitgeist is{" "}
              <a href="https://github.com/andremichelle/openDAW/issues/525">openDAW#525</a>:
              it moves note-offs as well as note-ons, while the manual says durations stay.
            </p>
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "360ms" }}>
            <h2 className="mc-anchors-head">Sources</h2>
            <p>
              The devices&apos; boxes, adapters and parameters are in the handbook&apos;s{" "}
              <a href="/docs/16-midi.html">MIDI deep dive</a>. What each device does, measured
              on an offline render and set against its manual, is in the{" "}
              <a href="https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-03-midi-effect-semantics/note.md">
                MIDI effect semantics audit
              </a>
              .
            </p>
          </section>

          <MoisesLogo />
        </main>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<MidiEffectsOverview />);
