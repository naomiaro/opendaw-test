// src/demos/midi/midi-overview.tsx
// Static overview page: no audio, no engine, for a developer who has never seen a piano roll.
// Built like src/demos/warp/warp-overview.tsx. It teaches the roll first (PianoRollExplainer.tsx,
// drawn from the demos' own pattern and shading), then the note names, then one card per demo.
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container } from "@radix-ui/themes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { EffectChainDiagram, NoteDataLink, PianoRollSteps, PIANO_ROLL_STYLES } from "./PianoRollExplainer";

const PAGES = [
  {
    index: "01",
    chip: "var(--mc-rose)",
    name: "MIDI Recording",
    direction: "GET NOTES IN",
    limit: "Lists the last notes played and lights the keys held down, but does not draw what you recorded on a roll",
    href: "/midi-recording-demo.html",
    prose:
      "Play the on-screen keyboard or a connected device and record what you play, or enter notes one step at a time without playing them in real time.",
  },
  {
    index: "02",
    chip: "var(--mc-amber)",
    name: "MIDI Effects",
    direction: "HEAR NOTES CHANGE",
    limit: "The lane of what came out cannot show velocity (every block is one colour) or timing finer than a frame",
    href: "/midi-effects-demo.html",
    prose:
      "Run a pattern through Arpeggio, Note Filter, Pitch, Velocity and Zeitgeist on a synth, one at a time or stacked in any order, and watch what comes out next to what went in.",
  },
  {
    index: "03",
    chip: "var(--mc-cyan)",
    name: "Rendered",
    direction: "SEE EXACTLY WHAT CAME OUT",
    limit: "Reads one voice at a time, so overlapping notes cannot be read",
    href: "/midi-effects-rendered-demo.html",
    prose:
      "The same effects on a pure sine, rendered offline after each change and read back note by note: pitch, fine tuning and velocity on every note, and onsets and ends to the sample wherever notes do not touch.",
  },
  {
    index: "04",
    chip: "var(--mc-violet)",
    name: "Spielwerk",
    direction: "WRITE YOUR OWN EFFECT",
    limit: "Its lane of what came out cannot show velocity either",
    href: "/spielwerk-demo.html",
    prose:
      "Write an effect in JavaScript: a Processor whose generator receives note events and yields notes to the synth. Start from a pre-built echo, chord, humanize or strum script, compile it, and turn the knobs it declares.",
  },
] as const;

function MidiOverview() {
  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES + PIANO_ROLL_STYLES}</style>
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <main className="mc-root">
          <header className="mc-reveal" style={{ marginTop: 28 }}>
            <div className="mc-kicker">MIDI &mdash; OpenDAW SDK</div>
            <h1 className="mc-title">
              NOTES, NOT <span className="mc-q">SOUND</span>
            </h1>
            <p className="mc-intro">
              MIDI doesn&apos;t store audio. It stores instructions: which key, when, for how
              long, and how hard. An instrument turns those instructions into sound as they
              play, which is why you can change a note long after it was recorded.
            </p>
          </header>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "120ms" }}>
            <h2 className="mc-anchors-head">How to read a piano roll</h2>
            <p>
              A piano roll is how DAWs draw MIDI: a grid with a piano down the left side and
              time running to the right. openDAW&apos;s own note editor, Ableton, Logic and
              Cubase all draw notes this way. Four ideas are enough to read one.
            </p>
            <PianoRollSteps />
            <p>
              Here the shading follows the square of the velocity, so a note at 0.5 sits only a
              quarter of the way from dim to full. Heights are easier to compare than colours,
              which is why the stems are there.
            </p>
            <p>
              The name is older than computers. About a century ago, a player piano played itself
              from a long roll of paper with holes punched in it. Each hole was a note:{" "}
              <a href="https://www.pianola.co.nz/public/web/about_piano_rolls">
                where it sat and how long it ran
              </a>{" "}
              chose the key and how long it stayed down. Turn that paper on its side and you have
              the grid above, with each block where a hole would be. The MIDI Association calls
              today&apos;s view{" "}
              <a href="https://midi.org/midi-historychapter-2-player-pianos-1850-1930">
                a direct descendant
              </a>{" "}
              of those rolls.
            </p>
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "240ms" }}>
            <h2 className="mc-anchors-head">The same notes as data</h2>
            <p>
              Every block is one object in your code. <code>position</code> and{" "}
              <code>duration</code> are in pulses. openDAW uses 960 pulses per quarter note,
              so 480 here is an eighth note. That resolution is openDAW&apos;s choice and other
              DAWs can use a different one, so read the handbook&apos;s{" "}
              <a href="/docs/02-timing-and-tempo.html#what-is-ppqn">guide to PPQN</a> before
              moving these numbers between programs. <code>pitch</code> is the row and{" "}
              <code>velocity</code> runs from 0 to 1. The numbers along the top count musical bars and
              beats: 1.3 is bar 1, beat 3, which is position 1920. Move over a line or a block
              to see which is which.
            </p>
            <NoteDataLink />
            <p>
              A real note has more fields that the block doesn&apos;t draw, such as{" "}
              <code>cent</code> for fine tuning, <code>chance</code> for how likely it is to
              play, and <code>playCount</code> for repeats. The handbook&apos;s{" "}
              <a href="/docs/16-midi.html">MIDI deep dive</a> has the full list.
            </p>
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "360ms" }}>
            <h2 className="mc-anchors-head">One key, two names</h2>
            <p>
              MIDI numbers its keys 0 to 127 and says key 60 is middle C. It never said which
              octave to call that, so makers chose for themselves, and people have been asking
              about it on forums for at least twenty years.
            </p>
            <dl className="prx-names">
              <dt>C3</dt>
              <dd>openDAW, and so every demo here. Also Ableton Live, Cubase and Yamaha&apos;s instruments.</dd>
              <dt>C4</dt>
              <dd>Scientific pitch notation, used in acoustics and music education. Also Dorico&apos;s default.</dd>
              <dt>Either</dt>
              <dd>Logic Pro (&ldquo;Display Middle C As&rdquo;) and Dorico have a setting. Some plugins have their own.</dd>
            </dl>
            <p>The whole disagreement is one constant: which octave number key 0 gets.</p>
            <code className="prx-code">
              <span className="prx-code-note">{"// openDAW: key 0 is C-2, key 60 is C3, key 127 is G8\n"}</span>
              {"name + (Math.floor(key / 12) - 2)\n\n"}
              <span className="prx-code-note">{"// Scientific pitch: key 0 is C-1, key 60 is C4, key 127 is G9\n"}</span>
              {"name + (Math.floor(key / 12) - 1)"}
            </code>
            <p>
              Many keyboards have a transpose or octave function, which players use to work
              around the mismatch: it shifts the keys up or down an octave so the key they
              expect plays the note they want.
            </p>
            <p>
              So a tutorial, or a keyboard&apos;s printed labels, can name a key one octave away
              from what these pages show. Write and compare the number, and treat the name as a
              label. To print openDAW&apos;s name, call <code>MidiKeys.toFullString(60)</code>.
            </p>
            <p>
              Further reading: the{" "}
              <a href="https://midi.org/community/midi-specifications/midi-octave-and-note-numbering-standard">
                MIDI Association forum
              </a>{" "}
              (&ldquo;only defines Middle C as note number 60&rdquo;), Ableton forum threads from{" "}
              <a href="https://forum.ableton.com/viewtopic.php?t=39722">2006</a> and{" "}
              <a href="https://forum.ableton.com/viewtopic.php?t=148636">2010</a>, and the settings in{" "}
              <a href="https://support.spitfireaudio.com/en/articles/11816081-midi-note-names-when-the-daw-octave-and-plugin-octave-don-t-match">
                Logic
              </a>{" "}
              and{" "}
              <a href="https://steinberg.help/dorico_elements/v5/en/dorico/topics/user_interface/user_interface_middle_c_numbering_convention_changing_t.html">
                Dorico
              </a>
              .
            </p>
          </section>

          <section className="mc-grid mc-reveal" style={{ animationDelay: "480ms" }}>
            {PAGES.map((p) => (
              <article className="mc-panel" key={p.index}>
                <div className="mc-panel-head">
                  <span className="mc-chip" style={{ background: p.chip }} />
                  <span className="mc-index">{p.index}</span>
                  <h2 className="mc-name">{p.name}</h2>
                </div>
                <div className="mc-direction">{p.direction}</div>
                <p className="mc-prose">{p.prose}</p>
                <dl className="mc-rows">
                  <div className="mc-row">
                    <dt>LIMIT</dt>
                    <dd>{p.limit}</dd>
                  </div>
                </dl>
                <a className="mc-open" href={p.href}>
                  Open demo <span className="mc-arrow">&rarr;</span>
                </a>
              </article>
            ))}
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "600ms" }}>
            <h2 className="mc-anchors-head">What the effects do</h2>
            <p>
              A MIDI effect sits between the notes and the instrument. The instrument pulls
              notes through the chain, and each effect hands on what it was given, changed.
            </p>
            <EffectChainDiagram />
            <ul className="prx-effects">
              <li><strong>Arpeggio</strong> plays the notes you hold one at a time, on a grid.</li>
              <li><strong>Note Filter</strong> keeps only a range of keys, then can move them or turn them all into one key.</li>
              <li><strong>Pitch</strong> moves every note up or down.</li>
              <li><strong>Velocity</strong> reshapes how hard each note hits.</li>
              <li><strong>Zeitgeist</strong> swings the timing, so notes between grid lines land later or earlier.</li>
            </ul>
            <p>
              Worth knowing before you use them: the Arpeggio walks the absolute grid, counted
              from the project start, so where a region sits decides which step a note lands
              on. A velocity of 0 is silence, not a quiet note. The Pitch device drops a note it
              shifts out of the range 0 to 127 rather than clamping it.
            </p>
            <p>
              The Arpeggio&apos;s velocity control, as the card prints it, is silent at 0 %,
              plays every note at one fixed velocity rising to full at 50 %, and from there
              blends toward the note&apos;s own velocity, reached at 100 %. Zeitgeist warps time
              itself: it moves note-offs as well as note-ons, so a note&apos;s duration changes
              with its place in the groove cell. The pages show both.
            </p>
          </section>

          <section className="mc-anchors mc-reveal" style={{ animationDelay: "720ms" }}>
            <h2 className="mc-anchors-head">Sources</h2>
            <p>
              The notes, regions and devices are in the handbook&apos;s{" "}
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

createRoot(document.getElementById("root")!).render(<MidiOverview />);
